#!/usr/bin/env node
'use strict';

// 沙箱内发布应用：起服务(自启动) + 调 agentos 发布，输出稳定分享链接。
// 用法：node publish.js --dir <项目目录> [--port N] [--language auto|node|python|go|static]
//                       [--install-cmd "..."] [--start-cmd "..."]

const path = require('path');
const lib = require('./lib');

function parseArgs(argv) {
  const opts = { dir: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dir') opts.dir = next();
    else if (a === '--port') opts.port = Number(next());
    else if (a === '--language') opts.language = next();
    else if (a === '--install-cmd') opts.installCmd = next();
    else if (a === '--start-cmd') opts.startCmd = next();
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  return opts;
}

function usage() {
  process.stdout.write(
    'Usage: node publish.js --dir <项目目录> [--port N] [--language auto|node|python|go|static] [--install-cmd "..."] [--start-cmd "..."]\n',
  );
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    usage();
    return;
  }

  const dir = path.resolve(opts.dir);
  const { runtimeIdStr } = lib.requireRuntimeId();
  const { appName } = lib.getOrCreateAppName(runtimeIdStr);

  const plan = lib.buildRuntimePlan(dir, opts);

  // 1. 装依赖
  lib.runInstall(dir, plan.installCmd);

  // effectivePort：最终生效端口（可能被诊断阶段用真实端口纠正）。
  let effectivePort = plan.port;

  // 2. 起服务（写自启动配置）
  await lib.setAutoStart(effectivePort, lib.buildAutostartCmd(plan, dir));

  // 3. 快速就绪校验（约 5s）
  let ready = await lib.waitReady(effectivePort);

  // 4. 探测失败 → 读自启动日志分级诊断
  if (!ready) {
    const log = await lib.getAutoRunLog('app');
    const diag = lib.diagnoseStartup(log);

    if (diag.kind === 'ok') {
      // 服务已起，疑似端口不符：扫真实监听端口，用它重写自启动 + 重探。
      const realPorts = await lib.getListeningPorts();
      const pick = lib.pickRealPort(realPorts, effectivePort);
      if (pick) {
        effectivePort = pick;
        plan.port = pick;
        await lib.setAutoStart(effectivePort, lib.buildAutostartCmd(plan, dir));
        ready = await lib.waitReady(effectivePort);
      }
    } else if (diag.kind === 'cmd-error') {
      // AI 造成的命令类错误 → 有限自愈后重试。
      const fix = lib.autoFixStartCmd(plan, log);
      if (fix) {
        plan.startCmd = fix.cmd;
        await lib.setAutoStart(effectivePort, lib.buildAutostartCmd(plan, dir));
        ready = await lib.waitReady(effectivePort);
      } else {
        throw new Error(startupError(diag, log));
      }
    } else {
      // 运行时错误（缺依赖 / 端口占用等）→ 不自愈、不降级，如实告知用户。
      throw new Error(startupError(diag, log));
    }
  }

  // 5. 调 agentos 发布（runtimeId 用字符串，避免大整数丢精度）
  const { data, releaseIdStr } = await lib.createArtifactRelease({
    runtimeId: runtimeIdStr,
    appName,
    port: effectivePort,
  });

  // 6. 落盘 releaseId（字符串，供 unpublish 直接取消）
  if (releaseIdStr) {
    lib.setLastReleaseId(runtimeIdStr, appName, releaseIdStr);
  }

  const shareLink = lib.pickShareLink(data);
  if (!shareLink) {
    throw new Error(`发布成功但未取到分享链接: ${JSON.stringify(data)}`);
  }

  out({ shareLink, verified: ready });
}

// 组装启动失败的错误信息：诊断原因 + 日志末尾若干行，供上层如实转达用户。
function startupError(diag, log) {
  const tail = String(log || '')
    .split('\n')
    .filter((l) => l.trim())
    .slice(-15)
    .join('\n');
  return `服务启动失败（${diag.reason}）。日志末尾：\n${tail}`;
}

main().catch((err) => {
  out({ error: err && err.message ? err.message : String(err) });
  process.exit(1);
});
