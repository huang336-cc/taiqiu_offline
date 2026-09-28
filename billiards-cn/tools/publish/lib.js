'use strict';

// 沙箱内发布应用 - 共享库
// 职责：读 runtimeId、appName 本地持久化、HTTP 请求、运行时探测、起服务(自启动)、就绪轮询。
// 无外部依赖，仅用 Node 内置模块。本文件是独立沙箱脚本，非主仓 TS 代码，不能 import 主仓工具。

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ==================== 常量 ====================

// 发布走 agentos，域名固定为沙箱内 auth-proxy；鉴权由 space-auth-proxy 自动注入，脚本不处理 token。
const PUBLISH_BASE = 'http://codebuddy.auth-proxy.local';
// 自启动配置接口（沙箱本地数据面 PTY 端口）。
const AUTOSTART_URL = 'http://127.0.0.1:65310/replaceCloudStudioConfig';
// 端口枚举：返回当前监听的端口数组（数据面已放宽为 <50000、排除基础设施端口）。
const GETPORTS_URL = 'http://127.0.0.1:65310/getPorts';
// 自启动日志：按 app name 返回 PTY 纯文本日志，用于探测失败后的分级诊断。
const AUTORUN_LOG_URL = 'http://127.0.0.1:65310/getAutoRunLog';
// 本地状态文件：持久化 appName 与最近一次 releaseId，跨发布复用。
const STATE_DIR = path.join(os.homedir(), '.workbuddy-sandbox-publish');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

const DEFAULT_PORT = 3000;
const READY_MAX_ATTEMPTS = 12;
const READY_INTERVAL_MS = 5000;
// 快速探测：约 5s（10 × 500ms），失败即进入分级诊断，不再死等 60s。
const READY_FAST_ATTEMPTS = 10;
const READY_FAST_INTERVAL_MS = 500;
const DEFAULT_EXPIRE_SECONDS = 157680000; // 约 5 年

// ==================== runtimeId ====================

// 读取沙箱环境的 AGENTOS_RUNTIME_ID，缺失即抛错（严禁虚构）。
// 注意：runtimeId 是大整数，超过 JS Number 安全范围，必须以字符串传递，绝不转 Number（会丢精度）。
function requireRuntimeId() {
  const raw = (process.env.AGENTOS_RUNTIME_ID || '').trim();
  if (!raw) {
    throw new Error(
      '缺少环境变量 AGENTOS_RUNTIME_ID，无法发布。请确认当前处于 WorkBuddy 沙箱环境中。',
    );
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`AGENTOS_RUNTIME_ID 非法：${raw}`);
  }
  return { runtimeIdStr: raw };
}

// ==================== 本地状态持久化 ====================

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// 生成 DNS label 安全的 appName：a<runtimeId 的 md5 前16位>，小写字母数字，长度 ≤ 40。
// 前缀单字母 a 是因为 DNS label 不能以数字开头，而 md5 hex 可能以数字开头。
function generateAppName(runtimeIdStr) {
  const hash = crypto.createHash('md5').update(String(runtimeIdStr)).digest('hex').slice(0, 16);
  return `a${hash}`;
}

// 取或生成 appName：读 state；若无或 runtimeId 不匹配则重新生成并覆盖。
function getOrCreateAppName(runtimeIdStr) {
  let state = readState();
  if (!state || state.runtimeId !== runtimeIdStr || !state.appName) {
    state = {
      runtimeId: runtimeIdStr,
      appName: generateAppName(runtimeIdStr),
      lastReleaseId: null,
      createdAt: Date.now(),
    };
    writeState(state);
  }
  return { state, appName: state.appName };
}

// 更新最近一次 releaseId
function setLastReleaseId(runtimeIdStr, appName, releaseId) {
  const state = readState() || { runtimeId: runtimeIdStr, appName, createdAt: Date.now() };
  state.runtimeId = runtimeIdStr;
  state.appName = appName;
  state.lastReleaseId = releaseId;
  writeState(state);
}

function clearLastReleaseId() {
  const state = readState();
  if (state) {
    state.lastReleaseId = null;
    writeState(state);
  }
}

// ==================== HTTP ====================

// 通用 JSON 请求。仅用于 auth-proxy(agentos) 与本地 65310，均为 http。
// body 可以是对象（自动 JSON.stringify）或已序列化的字符串（rawBody，用于大整数需裸数字场景）。
function requestJson(method, url, body, rawBody) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    let payload;
    if (rawBody !== undefined) {
      payload = Buffer.from(rawBody);
    } else if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
    }
    const options = {
      method,
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    };
    if (payload) {
      options.headers['Content-Length'] = payload.length;
    }
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          /* 保留 raw text */
        }
        // 注意：json 里的大整数字段（如 releaseId）已被 JSON.parse 转成不精确的 Number，
        // 不可信。需要精确大整数时一律从 text 里按字符串提取（见 extractReleaseIdStr）。
        // json 只用于读小整数(code)和字符串字段(msg / data.domains / releaseUrl)。
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`请求超时：${method} ${url}`)));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// ==================== 运行时探测 ====================

function has(dir, file) {
  return fs.existsSync(path.join(dir, file));
}

function hasAnyHtml(dir) {
  try {
    return fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith('.html'));
  } catch {
    return false;
  }
}

function detectLanguage(dir) {
  if (has(dir, 'package.json')) return 'node';
  if (has(dir, 'requirements.txt') || has(dir, 'pyproject.toml') || has(dir, 'Pipfile')) {
    return 'python';
  }
  if (has(dir, 'go.mod')) return 'go';
  if (has(dir, 'index.html') || hasAnyHtml(dir)) return 'static';
  return 'node';
}

function detectNodeInstallCmd(dir) {
  if (has(dir, 'pnpm-lock.yaml')) return 'pnpm install';
  if (has(dir, 'yarn.lock')) return 'yarn install';
  return 'npm install';
}

function isViteProject(pkg) {
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  if (deps && deps.vite) return true;
  const scripts = pkg.scripts || {};
  return Object.values(scripts).some((s) => typeof s === 'string' && /\bvite\b/.test(s));
}

function withViteHostFlags(cmd) {
  if (/--host\b/.test(cmd)) return cmd;
  return `${cmd} -- --host 0.0.0.0`;
}

function detectNodeStartCmd(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    const scripts = pkg.scripts || {};
    const vite = isViteProject(pkg);
    if (scripts.start) return vite ? withViteHostFlags('npm run start') : 'npm run start';
    if (scripts.serve) return vite ? withViteHostFlags('npm run serve') : 'npm run serve';
    if (scripts.dev) return vite ? withViteHostFlags('npm run dev') : 'npm run dev';
    if (pkg.main) return `node ${JSON.stringify(pkg.main)}`;
  } catch {
    /* fall through */
  }
  return 'npm start';
}

// 返回 { language, port, installCmd, startCmd }。
// 端口注入策略：node 用 `PORT=<port>` 环境变量前缀；python/static 把端口烤进命令串
// （自启动配置执行时 $PORT 不在作用域，会展开成空串导致失败）。
function buildRuntimePlan(dir, opts) {
  let language = opts.language && opts.language !== 'auto' ? opts.language : detectLanguage(dir);
  const port = opts.port || DEFAULT_PORT;

  let installCmd = '';
  let startCmd = '';

  if (language === 'node') {
    installCmd = detectNodeInstallCmd(dir);
    startCmd = detectNodeStartCmd(dir);
  } else if (language === 'python') {
    installCmd = has(dir, 'requirements.txt')
      ? 'pip install -r requirements.txt'
      : has(dir, 'pyproject.toml')
        ? 'pip install .'
        : '';
    startCmd = has(dir, 'manage.py')
      ? `python manage.py runserver 0.0.0.0:${port}`
      : has(dir, 'app.py')
        ? 'python app.py'
        : 'python main.py';
  } else if (language === 'go') {
    installCmd = 'go build -o /workspace/app ./...';
    startCmd = '/workspace/app';
  } else {
    // static
    language = 'static';
    installCmd = '';
    startCmd = `python3 -m http.server ${port} --bind 0.0.0.0 --directory ${JSON.stringify(dir)}`;
  }

  if (opts.installCmd !== undefined) installCmd = opts.installCmd;
  if (opts.startCmd) startCmd = opts.startCmd;

  // 兜底：http.server 若既没写死端口、也没引用 $PORT，则默认监听 8000，会和发布/探测用的 port 不一致。
  // 这里显式把 port 补进去，保证「服务实际监听端口」== 「发布/探测端口」。
  startCmd = ensureHttpServerPort(startCmd, port);

  return { language, port, installCmd, startCmd };
}

// 针对 `python(3) -m http.server` 命令：若未显式给端口（且未用 $PORT），补上 <port>，
// 避免落到 http.server 默认的 8000 而与发布端口不符。其它命令原样返回。
function ensureHttpServerPort(cmd, port) {
  if (!/-m\s+http\.server\b/.test(cmd)) return cmd;
  if (/\$\{PORT\}|\$PORT\b/.test(cmd)) return cmd;
  // http.server 的端口是紧跟在 "http.server" 后的第一个位置参数（纯数字）。
  if (/-m\s+http\.server\s+\d+/.test(cmd)) return cmd;
  // 在 "http.server" 后插入端口。
  return cmd.replace(/(-m\s+http\.server)\b/, `$1 ${port}`);
}

// 把命令串里的 $PORT / ${PORT} 字面替换成实际端口。
// 自启动配置执行时 $PORT 不在作用域（会展开成空串），所以凡是非 node（没有 PORT= 环境前缀）
// 的命令，都必须先把 $PORT 替成真实端口，否则命令直接失败（如 python3 -m http.server $PORT）。
function substitutePort(cmd, port) {
  return cmd.replace(/\$\{PORT\}|\$PORT\b/g, String(port));
}

// 组装写入自启动配置的最终 cmd：切到项目目录，注入/替换端口。
// - node：加 `PORT=<port>` 环境前缀，命令里的 $PORT 由该前缀在 sh -c 内展开，无需字面替换。
// - 其余（python/go/static/自定义 start-cmd）：自启动执行时无 $PORT，必须字面替换成真实端口。
function buildAutostartCmd(plan, dir) {
  const cd = `cd ${JSON.stringify(dir)}`;
  if (plan.language === 'node') {
    return `${cd} && PORT=${plan.port} ${plan.startCmd}`;
  }
  return `${cd} && ${substitutePort(plan.startCmd, plan.port)}`;
}

// ==================== 装依赖 ====================

// 依赖安装需要 shell 语义（npm/pip/go 等），通过 sh -c 执行。
// 这是运行在沙箱内的独立脚本，命令来自本地探测或用户显式 --install-cmd 覆盖。
function runInstall(dir, installCmd) {
  if (!installCmd) return;
  const res = spawnSync('/bin/sh', ['-c', installCmd], { cwd: dir, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`依赖安装失败（exit ${res.status}）：${installCmd}`);
  }
}

// ==================== 起服务 + 就绪校验 ====================

async function setAutoStart(port, cmd) {
  const config = { app: [{ name: 'app', port, cmd }], restart: true };
  const res = await requestJson('POST', AUTOSTART_URL, config);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`replaceCloudStudioConfig 失败 (HTTP ${res.status}): ${res.text || ''}`);
  }
  if (res.json && res.json.status === 'error') {
    throw new Error(`replaceCloudStudioConfig 返回错误: ${res.json.message || ''}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 本地轮询 http://127.0.0.1:<port>/ ，<500 视为已就绪。
// 超时可配置：默认走快速探测（约 5s），失败后由上层做分级诊断。
async function waitReady(port, opts = {}) {
  const maxAttempts = opts.maxAttempts || READY_FAST_ATTEMPTS;
  const intervalMs = opts.intervalMs || READY_FAST_INTERVAL_MS;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const code = await probeOnce(port);
    if (code > 0 && code < 500) return true;
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  return false;
}

function probeOnce(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/', method: 'GET', timeout: 3000 },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      },
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });
}

// ==================== 探测失败后的分级诊断 ====================

// 调 65310 /getPorts 拿当前监听端口。数据面已放宽为 <50000、排除基础设施端口。
// 返回 number[]；任何失败（服务不可达/结构异常）都降级返回 []，不抛错。
async function getListeningPorts() {
  try {
    const res = await requestJson('GET', GETPORTS_URL);
    const data = res && res.json && res.json.data && res.json.data.data;
    if (!Array.isArray(data)) return [];
    return data.map((p) => Number(p)).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

// 调 65310 /getAutoRunLog?name= 拿指定 app 的 PTY 纯文本日志。失败返回空串。
async function getAutoRunLog(name = 'app') {
  try {
    const res = await requestJson('GET', `${AUTORUN_LOG_URL}?name=${encodeURIComponent(name)}`);
    const data = res && res.json && res.json.data;
    if (data && typeof data === 'object' && typeof data[name] === 'string') return data[name];
    if (typeof data === 'string') return data;
    return '';
  } catch {
    return '';
  }
}

// 就绪特征词：出现即认为服务已成功监听（只是可能端口对不上）。
const READY_HINTS = [
  /serving http/i,
  /listening on/i,
  /running on/i,
  /Local:\s*http/i,
  /started server/i,
  /server started/i,
  /dev server running/i,
];

// 运行时错误特征：这类问题不是 AI 命令写错造成，不自愈，交回上层如实告知用户。
const RUNTIME_ERROR_HINTS = [
  /EADDRINUSE/i,
  /address already in use/i,
  /ModuleNotFoundError/i,
  /Cannot find module/i,
  /ImportError/i,
  /Traceback \(most recent call last\)/i,
];

// 命令类错误特征：多为 AI 生成的启动命令本身有问题，属可有限自愈范畴。
const CMD_ERROR_HINTS = [
  /\$\{?PORT\}?/, // 命令里残留了未展开的 $PORT
  /command not found/i,
  /No such file or directory/i,
];

// 基于 PTY 纯文本日志做分级诊断（无退出码，只能靠关键词）。
// 返回 { kind: 'ok'|'cmd-error'|'runtime-error', reason }。
// 判定策略：命令类错误优先（可自愈）；其次运行时错误；出现就绪词且无错误 → ok；
// 都判定不了时保守归 runtime-error（宁可告知用户，也不乱自愈）。
function diagnoseStartup(logText) {
  const text = String(logText || '');
  for (const re of CMD_ERROR_HINTS) {
    if (re.test(text)) return { kind: 'cmd-error', reason: `命令类错误：匹配 ${re}` };
  }
  for (const re of RUNTIME_ERROR_HINTS) {
    if (re.test(text)) return { kind: 'runtime-error', reason: `运行时错误：匹配 ${re}` };
  }
  for (const re of READY_HINTS) {
    if (re.test(text)) return { kind: 'ok', reason: `日志显示已就绪：匹配 ${re}` };
  }
  return { kind: 'runtime-error', reason: '无法从日志判定启动状态，保守按运行时错误处理' };
}

// 从真实监听端口里挑一个 != currentPort 的端口。多个时按常见 web 端口权重排序取首。
// 无可用端口返回 null。
const WEB_PORT_WEIGHTS = [3000, 5173, 8080, 8000, 4173, 3001, 8888];
function pickRealPort(realPorts, currentPort) {
  const candidates = (realPorts || []).filter((p) => p !== currentPort);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ia = WEB_PORT_WEIGHTS.indexOf(a);
    const ib = WEB_PORT_WEIGHTS.indexOf(b);
    const wa = ia === -1 ? WEB_PORT_WEIGHTS.length : ia;
    const wb = ib === -1 ? WEB_PORT_WEIGHTS.length : ib;
    if (wa !== wb) return wa - wb;
    return a - b;
  });
  return candidates[0];
}

// 有限自愈：仅覆盖确定安全的命令改写。目前只处理「命令残留字面 $PORT」——
// 复用 substitutePort 替成 plan.port。其它情况返回 null，交回上层告知用户。
function autoFixStartCmd(plan, logText) {
  if (/\$\{?PORT\}?/.test(plan.startCmd)) {
    return { cmd: substitutePort(plan.startCmd, plan.port) };
  }
  return null;
}

// ==================== agentos 发布 / 取消 ====================

async function createArtifactRelease({ runtimeId, appName, port }) {
  // runtimeId 是大整数：后端要 JSON number（Go int64，无 ,string tag），但 JS Number 会丢精度。
  // 因此手动拼 JSON，把已校验为纯数字串的 runtimeId 作为「裸数字」字面量插入（不带引号）。
  const rid = String(runtimeId);
  if (!/^[1-9]\d*$/.test(rid)) {
    throw new Error(`runtimeId 非法：${rid}`);
  }
  const releaseConfig = {
    port,
    skipFork: true,
    appName,
    useAppNameAsDomain: true,
    expire: DEFAULT_EXPIRE_SECONDS,
  };
  const rawBody =
    `{"runtimeId":${rid},"artifactType":"web","persistent":true,` +
    `"releaseConfig":${JSON.stringify(releaseConfig)}}`;

  const res = await requestJson(
    'POST',
    `${PUBLISH_BASE}/v2/agentos/artifact-releases`,
    undefined,
    rawBody,
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`发布失败 (HTTP ${res.status}): ${res.text || ''}`);
  }
  if (!res.json || res.json.code !== 0 || !res.json.data) {
    throw new Error(`发布返回异常: ${res.text || JSON.stringify(res.json)}`);
  }
  // releaseId 同为大整数，从原始文本按字符串提取，避免 JSON.parse 转 Number 丢精度。
  const releaseIdStr = extractReleaseIdStr(res.text);
  return { data: res.json.data, releaseIdStr };
}

// 从响应原始文本里按字符串抓取 releaseId（不经过 Number）。
function extractReleaseIdStr(text) {
  if (!text) return null;
  const m = /"releaseId"\s*:\s*"?(\d+)"?/.exec(text);
  return m ? m[1] : null;
}

async function cancelArtifactRelease(releaseId) {
  const res = await requestJson(
    'POST',
    `${PUBLISH_BASE}/v2/agentos/artifact-releases/${releaseId}/cancel`,
    {},
  );
  return res; // 由调用方判断 status/code
}

// 从发布响应里取稳定分享链接。
//
// 取值顺序（Issue #102515）：
//   1. shareUrl —— 启用 sharecode 的发布，访问链接形如 https://xxx/?sharecode=ABC23XYZ89，
//      只有该字段含码。**必须优先**：若拿 friendlyDomains 自己拼裸域名，
//      sandbox-gateway 会拦成「链接不完整」引导页 —— 发布看起来成功、
//      用户拿到的链接却打不开，且脚本这侧完全无异常可查。
//   2. friendlyDomains[0] —— 未启用 sharecode 时的稳定友好域名（基于 appName）。
//   3. releaseUrl —— 兜底。
//
// 未启用 sharecode 时后端不返 shareUrl，自动回落到原有两级逻辑，行为不变。
function pickShareLink(data) {
  if (data && data.shareUrl) return data.shareUrl;
  const fd = data && data.domains && data.domains.friendlyDomains;
  if (Array.isArray(fd) && fd[0]) return `https://${fd[0]}`;
  if (data && data.releaseUrl) return data.releaseUrl;
  return null;
}

module.exports = {
  PUBLISH_BASE,
  AUTOSTART_URL,
  STATE_FILE,
  requireRuntimeId,
  readState,
  writeState,
  getOrCreateAppName,
  setLastReleaseId,
  clearLastReleaseId,
  requestJson,
  buildRuntimePlan,
  buildAutostartCmd,
  substitutePort,
  ensureHttpServerPort,
  runInstall,
  setAutoStart,
  waitReady,
  getListeningPorts,
  getAutoRunLog,
  diagnoseStartup,
  pickRealPort,
  autoFixStartCmd,
  createArtifactRelease,
  cancelArtifactRelease,
  pickShareLink,
};
