#!/usr/bin/env node
'use strict';

// 取消发布：直接使用本地持久化的 releaseId 调 agentos 取消接口。
// 用法：node unpublish.js

const lib = require('./lib');

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main() {
  const { runtimeIdStr } = lib.requireRuntimeId();

  const state = lib.readState();
  const releaseId =
    state && state.runtimeId === runtimeIdStr ? state.lastReleaseId : null;

  if (!releaseId) {
    out({ status: 'not_found', message: '当前没有可取消的发布记录。' });
    return;
  }

  const res = await lib.cancelArtifactRelease(releaseId);

  // 成功
  if (res.status >= 200 && res.status < 300 && res.json && res.json.code === 0) {
    lib.clearLastReleaseId();
    out({ status: 'unpublished', releaseId });
    return;
  }

  // 已失效 / 不存在：视为已下线，同样清空本地记录
  if (res.status === 404 || (res.json && /not.?found|invalid|已.*(取消|失效|下线)/i.test(res.json.msg || res.json.message || ''))) {
    lib.clearLastReleaseId();
    out({ status: 'already_unpublished', releaseId });
    return;
  }

  out({
    status: 'error',
    releaseId,
    message: `取消发布失败 (HTTP ${res.status}): ${res.text || JSON.stringify(res.json)}`,
  });
  process.exit(1);
}

main().catch((err) => {
  out({ status: 'error', message: err && err.message ? err.message : String(err) });
  process.exit(1);
});
