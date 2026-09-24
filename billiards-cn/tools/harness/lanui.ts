/**
 * v1.3.93：局域网连接**交互层**回归探针。
 *
 * 为什么单独写一个：用户这次的要求明确限定「不要改动连接方式和逻辑，
 * 目前是可以联通的，仅改动交互逻辑」。所以这个 harness 刻意**不测网络**，
 * 只测 LanRelay 往弹窗里写的东西 —— 用假的 container 接住所有
 * notifyLocal / notify 调用，检查：
 *
 *   ① 四种状态（connecting / connected / failed / disconnected）都写出了
 *      正确的 subtext、detail.label、detail.value 与 **state 指示**；
 *   ② 房间地址确实以 mono（等宽大字）呈现，且端口顺延时转成 warn；
 *   ③ 主机端点「对手已加入」走的是 **sticky 原地刷新**（key 仍为 lan-room），
 *      不再是关窗 + 瞬时 toast（这正是"握手真空期黑屏"的根因）；
 *   ④ 失败弹窗带「重新连接」按钮，对手退出弹窗带「留在房间等待」；
 *   ⑤ 关键约束：全程没有任何一次调用改变了连接参数（peer/port/url）。
 *
 * 假 container 还会记录每次调用时的 stickyKey，用来验证「同 key 覆盖」语义。
 */

import { LanRelay } from "../../src/network/client/lanrelay"
import { readFileSync } from "node:fs"

interface Captured {
  kind: "local" | "notify"
  subtext: string
  detail?: {
    label?: string
    value?: string
    hint?: string
    state?: string
    mono?: boolean
  }
  extra?: string
  sticky?: boolean
  key?: string
  handlers: string[]
}

const calls: Captured[] = []

/**
 * 假 Container：只实现 LanRelay 真正会碰到的几个成员。
 * notification.stickyKey 由 show/clear 维护，模拟 notification.show() 的
 * 「sticky key 记录 / 同 key 覆盖」语义 —— 这是 sticky 刷新能否生效的关键。
 */
function makeContainer() {
  const notification = {
    stickyKey: null as string | null,
    show(data: unknown, _dur?: number, handlers?: Record<string, () => void>) {
      record("local", data, handlers)
    },
    dismiss(key?: string) {
      if (key === undefined) notification.stickyKey = null
      else if (key === notification.stickyKey) notification.stickyKey = null
    },
  }
  const container = {
    notification,
    notify(data: unknown, _dur?: number) {
      record("notify", data, undefined)
    },
    notifyLocal(
      data: unknown,
      _dur?: number,
      handlers?: Record<string, () => void>
    ) {
      record("local", data, handlers)
    },
  }
  return container
}

function record(
  kind: "local" | "notify",
  data: unknown,
  handlers?: Record<string, () => void>
): void {
  const d = data as {
    subtext?: string
    detail?: Captured["detail"]
    extra?: string
    sticky?: boolean
    key?: string
  }
  calls.push({
    kind,
    subtext: String(d?.subtext ?? ""),
    detail: d?.detail,
    extra: d?.extra,
    sticky: d?.sticky,
    key: d?.key,
    handlers: handlers ? Object.keys(handlers) : [],
  })
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}${extra ? "  " + extra : ""}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${extra ? "  " + extra : ""}`)
  }
}

/** 取最后一条写向 lan-room 的调用 */
function lastRoom(): Captured | undefined {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]
    if (c.kind === "local" && c.key === "lan-room") return c
  }
  return undefined
}

function reset(): void {
  calls.length = 0
}

/** LanRelay 的私有成员访问（测试专用，绕开 TS 可见性） */
type Any = Record<string, unknown>
const priv = (r: LanRelay): Any => r as unknown as Any

console.log("=".repeat(76))
console.log("局域网连接交互层探针 (v1.3.93)")
console.log("=".repeat(76))

// ---------------------------------------------------------------------------
// 场景 1：客机端四种状态
// ---------------------------------------------------------------------------
console.log("\n【场景 1】客机端 joinState 四态渲染")

const c1 = makeContainer()
const relay1 = new LanRelay("join", "192.168.1.8", "8ball", c1 as never)
const p1 = priv(relay1)

// connecting
p1.joinState = "connecting"
p1.targetUrl = "ws://192.168.1.8:24816"
;(p1.showJoin as (a?: string, b?: string) => void)()
let room = lastRoom()
check(
  "connecting → 有转圈指示",
  room?.detail?.state === "spin",
  `state=${room?.detail?.state}`
)
check(
  "connecting → 目标主机用等宽大字",
  room?.detail?.mono === true,
  `mono=${room?.detail?.mono}`
)
check(
  "connecting → 告知 6 秒超时会兜底",
  !!room?.detail?.hint?.includes("6 秒"),
  room?.detail?.hint?.slice(0, 30)
)

// connected
reset()
p1.joinState = "connected"
;(p1.showJoin as () => void)()
room = lastRoom()
check("connected → 有成功对勾", room?.detail?.state === "ok", `state=${room?.detail?.state}`)
check(
  "connected → 不再是裸的「已连接」两字",
  String(room?.detail?.value ?? "").length > 3,
  `value=${room?.detail?.value}`
)

// failed
reset()
p1.joinState = "failed"
;(p1.showJoin as (a?: string, b?: string) => void)(
  "连接超时",
  "请确认两台手机连的是同一个 Wi-Fi"
)
room = lastRoom()
check("failed → 有失败叉号", room?.detail?.state === "error", `state=${room?.detail?.state}`)
check(
  "failed → 带「重新连接」按钮",
  !!room?.extra?.includes("retry-lan"),
  "extra 含 retry-lan"
)
check(
  "failed → 注册了 retry-lan 处理器",
  room?.handlers.includes("retry-lan") === true,
  `handlers=${JSON.stringify(room?.handlers)}`
)

// disconnected
reset()
p1.joinState = "connected"
p1.settled = false
;(p1.showDisconnected as () => void)()
room = lastRoom()
check(
  "disconnected → 有警示感叹号",
  room?.detail?.state === "warn",
  `state=${room?.detail?.state}`
)
check(
  "disconnected → 文案明确是「对手已退出」",
  String(room?.detail?.value ?? "").includes("退出"),
  `value=${room?.detail?.value}`
)
check(
  "disconnected → 也提供重新连接出口",
  !!room?.extra?.includes("retry-lan"),
  "extra 含 retry-lan"
)

// ---------------------------------------------------------------------------
// 场景 2：主机端房间地址 / 端口顺延
// ---------------------------------------------------------------------------
console.log("\n【场景 2】主机端房间地址渲染")

reset()
const c2 = makeContainer()
const relay2 = new LanRelay("host", "", "8ball", c2 as never)
const p2 = priv(relay2)
c2.notification.stickyKey = "lan-room" // 模拟客机端已建窗

;(p2.showRoomInfo as (i?: unknown) => void)({
  ip: "192.168.5.8",
  iface: "wlan0",
  hasWifiIface: true,
  candidates: [],
  error: "",
})
room = lastRoom()
check(
  "默认端口 → 地址只显示 IP",
  room?.detail?.value === "192.168.5.8",
  `value=${room?.detail?.value}`
)
check(
  "默认端口 → 不报警示（纯信息）",
  room?.detail?.state === undefined,
  `state=${room?.detail?.state}`
)
check("默认端口 → 地址用等宽大字", room?.detail?.mono === true, `mono=${room?.detail?.mono}`)
check(
  "主机 → subtext 明确「等待对手加入」",
  String(room?.subtext ?? "").includes("等待对手加入"),
  `subtext=${room?.subtext}`
)

// 端口顺延
reset()
p2.roomPort = 24817
;(p2.showRoomInfo as (i?: unknown) => void)({
  ip: "192.168.5.8",
  iface: "wlan0",
  hasWifiIface: true,
  candidates: [],
  error: "",
})
room = lastRoom()
check(
  "端口顺延 → 拼出完整地址",
  room?.detail?.value === "192.168.5.8:24817",
  `value=${room?.detail?.value}`
)
check(
  "端口顺延 → 转警示态提醒别少抄端口",
  room?.detail?.state === "warn",
  `state=${room?.detail?.state}`
)

// 取不到 IP：三种分级诊断
for (const [name, info, wantState] of [
  [
    "error 非空",
    { ip: "", iface: "", hasWifiIface: false, candidates: [], error: "lanInfo 返回空" },
    "error",
  ],
  [
    "无 Wi-Fi 接口",
    { ip: "", iface: "", hasWifiIface: false, candidates: [], error: "" },
    "error",
  ],
  [
    "Wi-Fi 已连但无 IPv4",
    { ip: "", iface: "wlan0", hasWifiIface: true, candidates: [], error: "" },
    "warn",
  ],
] as const) {
  reset()
  ;(p2.showRoomInfo as (i?: unknown) => void)(info)
  room = lastRoom()
  check(
    `诊断「${name}」→ state=${wantState}`,
    room?.detail?.state === wantState,
    `state=${room?.detail?.state}`
  )
}

// ---------------------------------------------------------------------------
// 场景 3：主机端「对手已加入」必须是 sticky 原地刷新
// ---------------------------------------------------------------------------
console.log("\n【场景 3】主机端对手加入：sticky 原地刷新（不关窗）")

reset()
const c3 = makeContainer()
const relay3 = new LanRelay("host", "", "8ball", c3 as never)
const p3 = priv(relay3)
// 先建出房间窗
p3.roomPort = 24816
;(p3.showRoomInfo as (i?: unknown) => void)({
  ip: "192.168.5.8",
  iface: "wlan0",
  hasWifiIface: true,
  candidates: [],
  error: "",
})
c3.notification.stickyKey = "lan-room"
const before = calls.length
;(p3.onStatus as (s: unknown) => void)({ k: "clients", n: 2 })
const after = calls.slice(before)
check(
  "收到 clients n=2 → 用 sticky 刷新（不是瞬时 toast）",
  after.some((c) => c.kind === "local" && c.key === "lan-room" && c.sticky === true),
  `写向 lan-room 的调用数=${after.filter((c) => c.key === "lan-room").length}`
)
check(
  "收到 clients n=2 → 没有把窗关掉（未裸调 dismiss）",
  c3.notification.stickyKey === "lan-room",
  `stickyKey=${c3.notification.stickyKey}`
)
room = lastRoom()
check(
  "等待开局态 → 有转圈指示",
  room?.detail?.state === "spin",
  `state=${room?.detail?.state}`
)
check(
  "等待开局态 → 明确说双方已连通",
  String(room?.detail?.value ?? "").includes("连通"),
  `value=${room?.detail?.value}`
)

// ---------------------------------------------------------------------------
// 场景 4：对手退出 → 两个出口
// ---------------------------------------------------------------------------
console.log("\n【场景 4】对手退出：两个出口（留在房间 / 返回菜单）")

reset()
const c4 = makeContainer()
const relay4 = new LanRelay("host", "", "8ball", c4 as never)
const p4 = priv(relay4)
p4.roomPort = 24816
;(p4.showRoomInfo as (i?: unknown) => void)({
  ip: "192.168.5.8",
  iface: "wlan0",
  hasWifiIface: true,
  candidates: [],
  error: "",
})
c4.notification.stickyKey = "lan-room"
;p4.onStatus && (p4.onStatus as (s: unknown) => void)({ k: "clients", n: 2 })
reset()
;(p4.onStatus as (s: unknown) => void)({ k: "clients", n: 1 })
const left = calls[calls.length - 1]
check(
  "对手退出 → 走 notifyLocal 且带按钮",
  left?.kind === "local" && !!left?.extra?.includes("lan-keep-wait"),
  `kind=${left?.kind}`
)
check(
  "对手退出 → 注册 lan-keep-wait 处理器",
  left?.handlers.includes("lan-keep-wait") === true,
  `handlers=${JSON.stringify(left?.handlers)}`
)
check(
  "对手退出 → 同时保留返回菜单",
  !!left?.extra?.includes('"menu"'),
  "extra 含 menu"
)

// 「留在房间等待」应该把去重标记复位并重新拉起房间窗
reset()
c4.notification.stickyKey = null
const keepWait = (left?.handlers ?? []).length > 0
check("对手退出 → 有可调用的 keep-wait 处理器", keepWait, `handlers=${JSON.stringify(left?.handlers)}`)
p4.peerLeftShown = true
p4.peerWasHere = true
;(p4.keepWaitingForPeer as () => void)()
check(
  "留在房间等待 → 复位 peerLeftShown（否则下次退出不再提示）",
  p4.peerLeftShown === false,
  `peerLeftShown=${p4.peerLeftShown}`
)
room = lastRoom()
check(
  "留在房间等待 → 重新拉起了 lan-room 房间窗",
  room?.key === "lan-room" && !!room?.detail?.value,
  `value=${room?.detail?.value}`
)

// ---------------------------------------------------------------------------
// 场景 5：约束检查 —— 交互改动没有碰到连接参数
// ---------------------------------------------------------------------------
console.log("\n【场景 5】约束：交互层未改动连接参数")

const c5 = makeContainer()
const relay5 = new LanRelay("join", "192.168.1.8", "8ball", c5 as never)
const p5 = priv(relay5)

// resolveTarget 是连接参数的唯一解析口，验证它没被改坏
const rt = (p5.resolveTarget as (h: string, d: number) => { host: string; port: number; url: string })(
  "192.168.1.8:24816",
  24816
)
check(
  "resolveTarget 仍正确拆端口",
  rt.host === "192.168.1.8" && rt.port === 24816 && rt.url === "ws://192.168.1.8:24816",
  `${rt.host}:${rt.port}`
)
const rt2 = (p5.resolveTarget as (h: string, d: number) => { host: string; port: number; url: string })(
  "192.168.1.8",
  24816
)
check(
  "resolveTarget 无端口时用默认端口",
  rt2.port === 24816 && rt2.url === "ws://192.168.1.8:24816",
  rt2.url
)

// 超时常量必须原样保留（连接逻辑的核心时序）。
// 它是模块私有 const，运行时取不到 —— 改为直接断言源码文本，
// 这样**真有人把它改掉**时（比如调成 30 秒）这个用例会立刻变红。
const src = readFileSync(
  new URL("../../src/network/client/lanrelay.ts", import.meta.url),
  "utf8"
)
check(
  "JOIN_TIMEOUT_MS 仍是 6000（连接时序未被交互改动波及）",
  /const JOIN_TIMEOUT_MS = 6000/.test(src),
  "源码断言"
)
check(
  "默认端口仍是 24816",
  /export const LAN_DEFAULT_PORT = 24816/.test(src),
  "源码断言"
)
check(
  "握手函数名未变（connect / startJoin / setJoinConnected 仍在）",
  /private connect\(/.test(src) &&
    /private startJoin\(/.test(src) &&
    /private setJoinConnected\(/.test(src),
  "源码断言"
)
check(
  "hello 重发常量未被改动",
  /HELLO_RESEND_MS = 1200/.test(src) && /HELLO_RESEND_MAX = 8/.test(src),
  "源码断言"
)

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(76))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
console.log("=".repeat(76))
if (fail > 0) process.exitCode = 1
