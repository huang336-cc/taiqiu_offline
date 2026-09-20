/**
 * v1.3.83 探针：局域网「局比分」与「对手退出提示」的逻辑验证
 *
 * 复现用户反馈的第 1、2 条：
 *   1. 局域网对战后，继续对战后比分栏未显示局比分
 *   2. 局域网对战任意一方退出后，对方未提示对方已退出
 *
 * 第 1 条根因：系列赛累计与比分栏局比分行**都**写成 `if (Session.isBotMode())`，
 *   而局域网对战（?lan=host|join）的 botMode 为 false，于是既不计分也不显示。
 *   本探针按真实实现复刻三条判据，验证 isSeriesMode() 的覆盖面。
 *
 * 第 2 条根因：主机自己的连接始终是活的，对手退出时主机**收不到 wsclose**，
 *   只能从服务端的客户端计数推断。旧代码的 clients 分支只处理 n>=2（有人进
 *   来），n 从 2 掉回 1 时什么都不做。本探针复刻该状态机并验证掉线提示。
 *
 * 运行：npx tsx tools/harness/lanseries.ts
 */

// ---------------- 第 1 条：模式判据 ----------------

/** 复刻 Session.isSeriesMode()（v1.3.83 新增） */
function isSeriesMode(query: string, botMode: boolean): boolean {
  if (botMode) return true
  const lan = new URLSearchParams(query).get("lan")
  return lan === "host" || lan === "join"
}

/** 复刻 v1.3.83 之前的三处判据（都只看 botMode） */
function legacyShowsSeries(_query: string, botMode: boolean): boolean {
  return botMode
}

interface ModeCase {
  name: string
  query: string
  botMode: boolean
  /** 期望：是否应显示/累计局比分 */
  expect: boolean
}

const modeCases: ModeCase[] = [
  { name: "人机对战 ?bot=ClawBreak", query: "?bot=ClawBreak", botMode: true, expect: true },
  { name: "局域网主机 ?lan=host", query: "?lan=host", botMode: false, expect: true },
  { name: "局域网客机 ?lan=join&peer=x", query: "?lan=join&peer=192.168.1.5", botMode: false, expect: true },
  { name: "单机练习（无参数）", query: "", botMode: false, expect: false },
  { name: "回放 ?replayId=abc", query: "?replayId=abc", botMode: false, expect: false },
  { name: "非法 lan 值 ?lan=foo", query: "?lan=foo", botMode: false, expect: false },
]

let pass = 0
let fail = 0

console.log("=== 第 1 条：局比分的显示/累计判据 ===")
for (const c of modeCases) {
  const now = isSeriesMode(c.query, c.botMode)
  const old = legacyShowsSeries(c.query, c.botMode)
  const ok = now === c.expect
  if (ok) {
    pass += 1
    const note = old !== now ? `（修复前=${old}）` : ""
    console.log(`✓ ${c.name} → ${now ? "显示/累计" : "不显示"}${note}`)
  } else {
    fail += 1
    console.log(`✗ ${c.name} → 期望 ${c.expect}，实际 ${now}`)
  }
}

// ---------------- 第 2 条：对手退出检测 ----------------

/** 复刻 LanServer：主机自己也是 clients 里的一条连接 */
class FakeServer {
  private conns: string[] = []
  add(name: string): void {
    this.conns.push(name)
  }
  remove(name: string): void {
    this.conns = this.conns.filter((x) => x !== name)
  }
  get count(): number {
    return this.conns.length
  }
}

/** 复刻 LanRelay 主机端与退出检测相关的状态 */
class HostState {
  peerWasHere = false
  peerLeftShown = false
  peerLeftNotices = 0
  /** 复刻旧的 clients 分支：只看 n>=2 */
  onClientCountLegacy(n: number): void {
    if (n >= 2) {
      /* 旧代码：dismissRoom + notify("对手已连接") */
    }
    // n < 2 时什么都不做 —— 这就是 bug
  }
  /** 复刻 v1.3.83 的 clients 分支 */
  onClientCount(n: number): void {
    if (n >= 2) {
      this.peerWasHere = true
      return
    }
    if (this.peerWasHere && !this.peerLeftShown) {
      this.peerLeftShown = true
      this.peerLeftNotices += 1
    }
  }
}

interface LeftCase {
  name: string
  /** 对手是否连上过（模拟开局前就退出 vs 开局后退出） */
  peerJoined: boolean
  expectNotice: boolean
}

const leftCases: LeftCase[] = [
  { name: "对手连上后又退出（对局中）", peerJoined: true, expectNotice: true },
  { name: "对手从未连上（没人来过）", peerJoined: false, expectNotice: false },
]

console.log("\n=== 第 2 条：对手退出检测（主机端） ===")
for (const c of leftCases) {
  // --- 旧实现 ---
  const s1 = new FakeServer()
  const h1 = new HostState()
  s1.add("host") // 主机自己先连上自己的服务端
  h1.onClientCountLegacy(s1.count)
  if (c.peerJoined) {
    s1.add("peer")
    h1.onClientCountLegacy(s1.count)
  }
  if (c.peerJoined) {
    s1.remove("peer") // 对手退出
    h1.onClientCountLegacy(s1.count)
  }
  const legacyNotices = h1.peerLeftNotices

  // --- 新实现 ---
  const s2 = new FakeServer()
  const h2 = new HostState()
  s2.add("host")
  h2.onClientCount(s2.count)
  if (c.peerJoined) {
    s2.add("peer")
    h2.onClientCount(s2.count)
  }
  if (c.peerJoined) {
    s2.remove("peer")
    h2.onClientCount(s2.count)
    // 服务端可能多次上报同一个计数 → 验证去重
    h2.onClientCount(s2.count)
    h2.onClientCount(s2.count)
  }
  const nowNotices = h2.peerLeftNotices

  const ok = (nowNotices > 0) === c.expectNotice
  if (ok) {
    pass += 1
    console.log(
      `✓ ${c.name} → ${nowNotices > 0 ? "提示对手已退出" : "不提示"}（去重后 ${nowNotices} 次）` +
        `　修复前=${legacyNotices} 次`
    )
  } else {
    fail += 1
    console.log(
      `✗ ${c.name} → 期望${c.expectNotice ? "提示" : "不提示"}，实际 ${nowNotices} 次`
    )
  }
}

// ---------------- 第 2 条补充：sticky 守卫 ----------------

/**
 * 复刻 notify() 的粘性守卫。对手在**开局前**退出时房间 sticky 窗还在屏上，
 * 若直接走 notify() 提示会被静默吞掉；showPeerLeft() 先 dismissRoom() 再发，
 * 因此一定上屏。
 */
function notifyWithStickyGuard(stickyKey: string | null): boolean {
  return stickyKey ? false : true // 有 sticky 就丢弃
}
function showPeerLeft(stickyKey: string | null): boolean {
  // 先 dismissRoom()（等价于把 stickyKey 清空），再 notify
  return notifyWithStickyGuard(null)
}

console.log("\n=== 第 2 条补充：开局前退出时提示不被 sticky 吞掉 ===")
for (const [label, key] of [
  ["对局中退出（sticky 已关）", null],
  ["开局前退出（sticky 仍在屏）", "lan-room"],
] as [string, string | null][]) {
  const naive = notifyWithStickyGuard(key)
  const fixed = showPeerLeft(key)
  const ok = fixed === true
  if (ok) {
    pass += 1
    const note = naive !== fixed ? `（直接 notify 会被吞：${!naive}）` : ""
    console.log(`✓ ${label} → 提示上屏${note}`)
  } else {
    fail += 1
    console.log(`✗ ${label} → 提示未上屏`)
  }
}

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail === 0 ? 0 : 1)
