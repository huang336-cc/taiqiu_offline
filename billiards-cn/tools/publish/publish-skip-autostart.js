#!/usr/bin/env node
'use strict';
/**
 * 发布（跳过 setAutoStart）—— 用于自启动配置已写好、服务已就绪，
 * 但 publish.js 因 setAutoStart 的 restart 竞态在快速探测窗口内误判失败的场景。
 *
 * 与 publish.js 后半段完全同口径：waitReady → createArtifactRelease →
 * setLastReleaseId → pickShareLink。不改动自启动配置，不重启服务。
 *
 * 用法：node publish-skip-autostart.js --dir <项目目录> [--port N]
 */
const path = require('path');
const lib = require('./lib');

function parseArgs(argv) {
  const opts = { dir: process.cwd(), port: 3000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
  }
  return opts;
}
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

async function main() {
  const opts = parseArgs(process.argv);
  const dir = path.resolve(opts.dir);
  const { runtimeIdStr } = lib.requireRuntimeId();
  const { appName } = lib.getOrCreateAppName(runtimeIdStr);

  // 先确认服务确实就绪（10 次 × 500ms，与 publish.js 相同）
  const ready = await lib.waitReady(opts.port);
  if (!ready) {
    const log = await lib.getAutoRunLog('app');
    const diag = lib.diagnoseStartup(log);
    throw new Error(`端口 ${opts.port} 未就绪（诊断：${diag.reason}）。日志末尾：\n` +
      String(log || '').split('\n').filter((l) => l.trim()).slice(-15).join('\n'));
  }

  const { data, releaseIdStr } = await lib.createArtifactRelease({
    runtimeId: runtimeIdStr,
    appName,
    port: opts.port,
  });
  if (releaseIdStr) lib.setLastReleaseId(runtimeIdStr, appName, releaseIdStr);

  const shareLink = lib.pickShareLink(data);
  if (!shareLink) throw new Error(`发布成功但未取到分享链接: ${JSON.stringify(data)}`);
  out({ shareLink, verified: ready, dir, port: opts.port });
}

main().catch((err) => {
  out({ error: err && err.message ? err.message : String(err) });
  process.exit(1);
});
