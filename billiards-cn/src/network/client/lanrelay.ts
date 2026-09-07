import { MessageRelay } from "./messagerelay"
import { BeginEvent } from "../../events/beginevent"
import { EventUtil } from "../../events/eventutil"
import { Container } from "../../container/container"
import { ruleName } from "../../utils/i18n"

/** 局域网服务端监听端口（主机侧）；被占用时 LanServer 会顺延，实际端口由回调给出 */
export const LAN_DEFAULT_PORT = 24816

/**
 * v1.3.73：连接失败时的通用引导（三条最常见的翻车点，按排查顺序排列）。
 */
const LAN_GUIDE_GENERAL =
  "请确认：① 两台手机连的是同一个 Wi-Fi；② 对方已点『创建房间』并停留在该页面；③ IP 填的是对方房间界面显示的地址。"

/** v1.3.73：失败弹窗的可操作引导按钮（"menu" 走 notification 的内置返回菜单） */
const LAN_FAIL_ACTIONS =
  '<button type="button" class="notification-btn" data-notification-action="retry-lan">重新连接</button>' +
  '<button type="button" class="notification-btn" data-notification-action="menu">返回主菜单</button>'

/** v1.3.73：join 端连接超时（毫秒）。Android WebView 连不可达地址要几十秒
 *  才回调 onerror，用户会一直以为"没反应"，这里主动判定超时。 */
const JOIN_TIMEOUT_MS = 6000

/** Java → 页面 的状态事件（LanBridge 回调）
 *
 * v1.3.69：started 事件由 Java 端在 bind 成功后立刻附带给 ip / iface /
 * hasWifiIface / error 字段，page 收到就能直接写弹窗 detail，不需要再调
 * JSBridge 异步取（v1.3.67/68 实测有时取不到，导致 detail 永远停在
 * 「等待对手加入…」）。ip 为空时按分级诊断显示。 */
interface LanStatus {
  k: "started" | "startfail" | "clients" | "log"
  port?: number
  /** v1.3.69：bind 成功时由 Java 同步带回的本机 IPv4；空串表示没拿到 */
  ip?: string
  iface?: string
  hasWifiIface?: boolean
  error?: string
  n?: number
  reason?: string
  line?: string
}

/**
 * v1.3.68：LanBridge.lanInfo() 返回的诊断 JSON。
 * 与 LanBridge.java 的字段一一对应，用于取不到 IP 时给出准确原因。
 */
interface LanInfo {
  ip: string
  iface: string
  /** 是否存在 wlan* 网络接口（等价于"连着 Wi-Fi"） */
  hasWifiIface: boolean
  candidates: string[]
  error: string
}

/** 页面 ↔ 页面 的 WebSocket 信封 */
interface Envelope {
  k: "ev" | "hello"
  d?: string
  ruletype?: string
  name?: string
}

/**
 * v1.3.65：局域网对战中继 —— MessageRelay 的 WebSocket 实现。
 *
 * 拓扑（Java 侧 LanServer 是纯转发器，不解析消息）：
 *   主机页面 ──ws://127.0.0.1:port──┐
 *                                   ├─ LanServer 广播给「除发送者外」的所有连接
 *   客机页面 ──ws://<hostIp>:port───┘
 * 两端页面代码完全对称，谁建服务谁是主机，由 URL 参数 ?lan=host|join 决定。
 *
 * 开局握手（hello）：
 *   客机 ws 连上即发 hello（含本机 ruletype）；
 *   主机收到 hello 后校验规则一致，再推 BeginEvent 开局（主机先开球）。
 *   客机端不需要 BeginEvent —— 主机 handleBegin 会顺带广播 WatchEvent，
 *   客机 Init.handleWatch 收到后自动进入"后手待命"。
 *
 * v1.3.73：客机端状态全程可见。此前"正在连接 / 已连接 / 连接失败"全部走
 *   notify()，而客机端一进游戏就有一个 key="lan-room" 的 sticky 弹窗常驻，
 *   notification.show() 的粘性守卫会把这些普通提示**直接丢弃**（见 show()
 *   里 stickyKey 非空即 return 的分支）。结果就是：填对 IP 没反应，随便填个
 *   IP 也没反应，两种完全不同的情况长得一模一样。
 *   现在客机端改为实时刷新 sticky 弹窗本身（同 key 的 sticky 走覆盖路径，
 *   不受守卫影响），并补上 6 秒超时兜底与失败引导按钮。
 */
export class LanRelay implements MessageRelay {
  private ws: WebSocket | null = null
  private callback: ((message: string) => void) | null = null
  private gotHello = false
  private closed = false

  // ---- v1.3.73：客机端连接状态机 ----
  private joinState:
    | "connecting"
    | "connected"
    | "failed"
    | "disconnected" = "connecting"
  /** 是否已定局（连上或失败）。ws 的 error 与 close 常成对触发，靠它去重 */
  private settled = false
  /** 连接超时定时器 */
  private connectTimer: number | null = null
  /** 实际连接目标（拆分过端口），失败提示里展示给用户核对 */
  private targetUrl = ""
  private targetPort = LAN_DEFAULT_PORT

  constructor(
    private readonly role: "host" | "join",
    private readonly peerHost: string,
    private readonly ruletype: string,
    private readonly container: Container
  ) {}

  public subscribe(
    _channel: string,
    callback: (message: string) => void,
    _prefix = ""
  ): void {
    this.callback = callback
    this.open()
  }

  public publish(_channel: string, message: string, _prefix?: string): void {
    this.send({ k: "ev", d: message })
  }

  /** 主动断开（返回菜单等场景） */
  public close(): void {
    this.closed = true
    // v1.3.73：清掉连接超时定时器，否则页面离开后仍会弹一次"连接失败"
    this.clearConnectTimer()
    try {
      this.ws?.close()
    } catch {
      // 忽略关闭失败
    }
  }

  // ---------------- 内部实现 ----------------

  private send(env: Envelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(env))
    }
  }

  private open(): void {
    const w = globalThis as unknown as Record<string, unknown>
    if (this.role === "host") {
      // 主机：先让 Java 起服务端，拿到实际端口后再连自己
      ;(w as { __lanEvent?: (s: LanStatus) => void }).__lanEvent = (s) =>
        this.onStatus(s)
      const bridge = w.__lan as
        | { startServer?: (port: number) => void }
        | undefined
      if (!bridge || typeof bridge.startServer !== "function") {
        // 非 App 环境（浏览器调试）没有 JSBridge：提示后保持等待状态
        this.notify("局域网对战", "本功能需在安卓 App 内使用")
        return
      }
      this.notify("局域网对战", "正在创建房间…")
      bridge.startServer(LAN_DEFAULT_PORT)
      return
    }
    // 客机：直接连对方。v1.3.73：不再用 notify() 报"正在连接"——它会被
    // 客机端常驻的 lan-room sticky 弹窗吞掉（表现为"输入 IP 后毫无反应"）。
    this.startJoin()
  }

  private onStatus(s: LanStatus): void {
    if (s.k === "started" && s.port) {
      // v1.3.69：started 事件由 Java 端在 bind 成功时**同步**带回 ip/iface/
      // hasWifiIface/error 字段（与 LanBridge.lanInfo() 同源算法）。我们把它
      // 一次性喂给 showRoomInfo，避免再异步调 JSBridge —— v1.3.67/68 实测
      // 这种异步链路有时拿不到（detail 永远停在「等待对手加入…」）。
      this.showRoomInfo({
        ip: s.ip ?? "",
        iface: s.iface ?? "",
        hasWifiIface: s.hasWifiIface === true,
        candidates: [],
        error: s.error ?? "",
      })
      // 兜底：旧版 APK 没有 started.ip 字段时，仍然通过重试 JSBridge 来补救
      // —— 但有 started.ip 时不再重试（避免弹窗抖动 / IP 被覆盖）。
      if (!s.ip) {
        this.scheduleIpRetry(800)
        this.scheduleIpRetry(2000)
      }
      this.connect("127.0.0.1", s.port)
    } else if (s.k === "startfail") {
      this.dismissRoom()
      this.notify("局域网对战", `创建房间失败：${s.reason ?? "端口被占用"}`)
    } else if (s.k === "clients" && s.n !== undefined) {
      if (this.role === "host" && s.n >= 2) {
        this.dismissRoom()
        this.notify("局域网对战", "对手已连接，等待开局…")
      }
    }
  }

  /**
   * 连接对方。host 允许带端口（"192.168.1.5:9999"）；不带则默认
   * LAN_DEFAULT_PORT。
   *
   * v1.3.68 修复：旧版无条件拼 `:LAN_DEFAULT_PORT`，若用户在菜单里填了带端口
   * 的地址（menu-cn.js 的注释明确说允许），会拼成 `ws://1.2.3.4:9999:24816`
   * 这种非法 URL，连不上且报错信息很误导。
   */
  private resolveTarget(
    hostAndPort: string,
    defaultPort: number
  ): { host: string; port: number; url: string } {
    let host = String(hostAndPort || "")
    let port = defaultPort
    // 仅当形如 host:port 且尾部是纯数字时才拆端口（避免误伤 IPv6 的冒号）
    const m = /^(.*):(\d{1,5})$/.exec(host)
    if (m && m[1] && !m[1].includes(":")) {
      host = m[1]
      port = Number(m[2])
    }
    return { host, port, url: `ws://${host}:${port}` }
  }

  private connect(hostAndPort: string, defaultPort: number): void {
    const t = this.resolveTarget(hostAndPort, defaultPort)
    this.targetPort = t.port
    this.targetUrl = t.url
    const url = t.url
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      if (this.role === "join") {
        this.failJoin(`地址无效：${url}`)
        return
      }
      this.notify("局域网对战", `连接失败：${url}`)
      return
    }
    this.ws = ws

    // v1.3.73：客机端超时兜底。Android WebView 连不可达 IP 要几十秒才回调
    // onerror，期间页面一点反馈都没有；这里 6 秒主动判失败（连上后清除）。
    if (this.role === "join") {
      this.clearConnectTimer()
      this.connectTimer = globalThis.setTimeout(() => {
        this.connectTimer = null
        this.failJoin("连接超时")
      }, JOIN_TIMEOUT_MS) as unknown as number
    }

    ws.onopen = () => {
      this.clearConnectTimer()
      if (this.role === "join") {
        this.send({ k: "hello", ruletype: this.ruletype, name: "玩家" })
        // v1.3.73：连上就明确告诉用户"已连接"，别再让人猜到底连没连上。
        this.setJoinConnected()
        return
      }
      this.notify("局域网对战", "已连接")
    }

    ws.onmessage = (ev) => {
      try {
        const env = JSON.parse(String(ev.data)) as Envelope
        if (env.k === "hello") {
          this.onHello(env)
        } else if (env.k === "ev" && env.d) {
          this.callback?.(env.d)
        }
      } catch {
        // 忽略非法消息
      }
    }

    ws.onclose = () => {
      if (this.role === "join") {
        // 连上之后才断开 ≠ 连接失败：给"对方退出房间"的专属提示与引导
        if (this.joinState === "connected") {
          this.showDisconnected()
        } else {
          this.failJoin("连接被关闭")
        }
        return
      }
      if (!this.closed) {
        this.notify("局域网对战", "与对手的连接已断开")
      }
    }

    ws.onerror = () => {
      if (this.role === "join") {
        this.failJoin("连接失败")
        return
      }
      this.notify("局域网对战", "网络错误，请确认双方连在同一个 Wi-Fi")
    }
  }

  /**
   * v1.3.68：读取本机网络诊断。优先用 LanBridge.lanInfo()（v1.3.68 新增，
   * 带诊断字段）；老 APK 没有该方法时回退到 lanIp()，此时拿不到诊断信息。
   */
  private readLanInfo(): LanInfo {
    const empty: LanInfo = {
      ip: "",
      iface: "",
      hasWifiIface: false,
      candidates: [],
      error: "",
    }
    try {
      const bridge = (
        globalThis as unknown as {
          __lan?: { lanInfo?: () => string; lanIp?: () => string }
        }
      ).__lan
      if (!bridge) return { ...empty, error: "JSBridge 不可用（需在 App 内运行）" }
      // 新接口：返回 JSON 诊断
      if (typeof bridge.lanInfo === "function") {
        const raw = String(bridge.lanInfo() || "")
        if (!raw) return { ...empty, error: "lanInfo() 返回空" }
        const parsed = JSON.parse(raw) as Partial<LanInfo>
        return {
          ip: parsed.ip ?? "",
          iface: parsed.iface ?? "",
          hasWifiIface: parsed.hasWifiIface === true,
          candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
          error: parsed.error ?? "",
        }
      }
      // 老接口回退：只有 IP，无诊断
      if (typeof bridge.lanIp === "function") {
        return { ...empty, ip: String(bridge.lanIp() || "") }
      }
      return { ...empty, error: "LanBridge 无 lanInfo/lanIp 方法" }
    } catch (e) {
      return {
        ...empty,
        error: `读取网络信息失败：${(e as Error).message ?? "未知错误"}`,
      }
    }
  }

  /**
   * v1.3.68：把建房/host 时的本机 IP（或取不到时的**诊断原因**）写进 sticky
   * 长驻弹窗。弹窗保留到对手 ws 连上、主机收到 hello 触发 BeginEvent 后由
   * init.handleBegin 的 clear() 兜底关掉。
   *
   * 分级逻辑（ip 为空时才需要诊断）：
   *   1. error 非空          → 展示异常原因
   *   2. hasWifiIface=false  → 没连 Wi-Fi，指引去连
   *   3. hasWifiIface=true   → Wi-Fi 已连但没 IPv4（DHCP/IPv6-only），
   *                            指引到系统设置里查地址口述给对手
   */
  private showRoomInfo(info?: LanInfo): void {
    const diag = info ?? this.readLanInfo()
    let detail: { label: string; value: string; hint?: string }
    if (diag.ip) {
      detail = { label: "本机房间 IP", value: diag.ip }
    } else if (diag.error) {
      detail = {
        label: "取本机 IP 失败",
        value: diag.error,
        hint: "请确认手机已连 Wi-Fi，然后返回菜单重新建房",
      }
    } else if (!diag.hasWifiIface) {
      detail = {
        label: "未连接 Wi-Fi",
        value: "没检测到无线网络",
        hint: "局域网对战需要两台手机连同一个 Wi-Fi。请连上后返回菜单重新建房",
      }
    } else {
      detail = {
        label: "Wi-Fi 未分配 IP",
        value: "接口已连接但没拿到 IPv4",
        hint: "请到 设置 → Wi-Fi → 当前网络 查看 IP 地址，把地址告诉对手；或重启 Wi-Fi 后重进",
      }
    }
    try {
      this.container.notifyLocal(
        {
          type: "Info",
          title: ruleName(this.ruletype),
          subtext: diag.ip
            ? "局域网对战 · 我的房间"
            : "局域网对战 · 我的房间（IP 待取）",
          sticky: true,
          key: "lan-room",
          detail,
        },
        0
      )
    } catch {
      // 通知组件不可用，不影响对局逻辑
    }
  }

  /**
   * v1.3.68：延迟重试取 IP（DHCP 下发有延迟，房间刚起时可能还没地址）。
   * 只在弹窗仍是「本机房间」key 且当前没拿到 IP 时才刷新，避免覆盖掉
   * 已经成功显示的 IP 或已被 dismiss 后的其它提示。
   */
  private scheduleIpRetry(delayMs: number): void {
    globalThis.setTimeout(() => {
      try {
        if (this.closed || this.gotHello) return
        // 已经拿到 IP 就别再刷（避免 jitter/按钮状态被重置）
        if (this.readLanInfo().ip) return
        this.showRoomInfo()
      } catch {
        // 忽略重试失败
      }
    }, delayMs)
  }

  /**
   * v1.3.67：精确关闭"局域网房间"sticky 弹窗。无 key 时仍走原逻辑会误关后续
   * 提示，这里强制带 key 仅关自己。
   */
  private dismissRoom(): void {
    try {
      this.container.notification?.dismiss?.("lan-room")
    } catch {
      // 忽略
    }
  }

  /** 主机收到 hello：校验规则一致后开局（主机先开球） */
  private onHello(env: Envelope): void {
    if (this.gotHello) {
      return
    }
    this.gotHello = true
    if (env.ruletype && env.ruletype !== this.ruletype) {
      this.dismissRoom()
      this.notify(
        "规则不一致",
        `对方选择了「${ruleName(env.ruletype)}」，本机是「${ruleName(
          this.ruletype
        )}」，请统一后重进`
      )
      return
    }
    this.dismissRoom()
    this.notify("局域网对战", "对手已就绪，你先开球")
    this.callback?.(EventUtil.serialise(new BeginEvent()))
  }

  // ---------------- v1.3.73：客机端连接状态机 ----------------

  /** 客机端连接入口：算出目标地址 → 弹窗刷成"正在连接" → 建链 */
  private startJoin(): void {
    if (!this.peerHost) {
      this.settled = true
      this.joinState = "failed"
      this.showJoin(
        "没有填对方 IP",
        "请返回主菜单，在『加入房间』里填写对方房间界面显示的 IP 地址。"
      )
      return
    }
    const t = this.resolveTarget(this.peerHost, LAN_DEFAULT_PORT)
    this.targetPort = t.port
    this.targetUrl = t.url
    this.settled = false
    this.closed = false
    this.joinState = "connecting"
    this.showJoin()
    this.connect(this.peerHost, LAN_DEFAULT_PORT)
  }

  private setJoinConnected(): void {
    if (this.settled) return
    this.settled = true
    this.clearConnectTimer()
    this.joinState = "connected"
    this.showJoin()
  }

  /** 已连接后又断开：对方退出房间 / Wi-Fi 掉了 */
  private showDisconnected(): void {
    if (this.joinState !== "connected") return
    this.clearConnectTimer()
    this.joinState = "disconnected"
    this.showJoin(
      "与对手的连接已断开",
      "对方可能退出了房间或网络中断。请让对方重新建房后再点『重新连接』。"
    )
  }

  /**
   * 失败定局：先把"失败"立刻显示出来（不等探测，避免用户继续干等），
   * 再做一次 TCP 探测把笼统原因换成准确原因。
   */
  private failJoin(reason: string): void {
    if (this.settled) return
    this.settled = true
    this.clearConnectTimer()
    try {
      this.ws?.close()
    } catch {
      // 忽略关闭失败
    }
    this.joinState = "failed"
    this.showJoin(reason, LAN_GUIDE_GENERAL)
    // 探测是同步阻塞调用（最多 3 秒），放到下一帧再做，先让失败态上屏
    globalThis.setTimeout(() => {
      if (this.joinState !== "failed") return
      if (this.container.notification?.stickyKey !== "lan-room") return
      const diag = this.diagnoseFailure(reason)
      this.showJoin(diag.value, diag.hint)
    }, 50)
  }

  /**
   * 用 Java 原生 Socket 探对方端口（LanBridge.probePeer，v1.3.73+）。
   * 原生 Socket 不走 HTTP 栈，不受 WebView 的 cleartext / mixed content 策略
   * 限制，因此能把"网络根本不通"和"网络通但 App 内被拦"分开。
   * 老 APK 没这个方法时返回空串，退回通用引导。
   */
  private probePeer(): string {
    try {
      const bridge = (
        globalThis as unknown as {
          __lan?: { probePeer?: (host: string, port: number) => string }
        }
      ).__lan
      if (!bridge || typeof bridge.probePeer !== "function") return ""
      return String(bridge.probePeer(this.peerHost, this.targetPort) || "")
    } catch {
      return ""
    }
  }

  private diagnoseFailure(reason: string): { value: string; hint: string } {
    const probe = this.probePeer()
    const target = this.targetUrl || this.peerHost
    if (probe.startsWith("ok")) {
      return {
        value: "手机之间是通的，但游戏内连接被拒",
        hint:
          "两台手机网络正常，说明是 App 内的明文连接被系统策略拦截了。" +
          "请安装 v1.3.73 或更高版本后重试。",
      }
    }
    if (probe.startsWith("refused")) {
      return {
        value: "对方手机在线，但房间没开",
        hint:
          "请让对方先在主菜单点『创建房间』并停留在该页面，然后你再点『重新连接』。",
      }
    }
    if (probe.startsWith("timeout")) {
      return {
        value: `${reason}：找不到 ${target}`,
        hint: LAN_GUIDE_GENERAL,
      }
    }
    if (probe.startsWith("error")) {
      return {
        value: `${reason}：${probe.slice(6) || target}`,
        hint: LAN_GUIDE_GENERAL,
      }
    }
    return { value: `${reason}：${target}`, hint: LAN_GUIDE_GENERAL }
  }

  /** 失败弹窗上的「重新连接」：关掉旧 ws 重走一遍连接流程 */
  private retryJoin(): void {
    try {
      this.ws?.close()
    } catch {
      // 忽略
    }
    this.ws = null
    this.gotHello = false
    this.startJoin()
  }

  /**
   * 把客机端连接状态写进 sticky 弹窗（key 仍是 "lan-room"）。
   *
   * 为什么不走 notify()：notification.show() 的粘性守卫会在 stickyKey 非空
   * 时把非 sticky 的普通提示整个丢掉（v1.3.67 引入，本意是别让瞬时提示挤掉
   * 建房弹窗）。同 key 的 sticky 提示走的是覆盖路径，不受该守卫影响 ——
   * 所以这里用 notifyLocal 直接刷新 sticky 弹窗本身。
   */
  private showJoin(reason?: string, hint?: string): void {
    if (this.role !== "join") return
    let subtext = "局域网对战 · 加入房间"
    let detail: { label: string; value: string; hint?: string }
    let extra: string | undefined
    switch (this.joinState) {
      case "connecting":
        subtext = "局域网对战 · 正在连接…"
        detail = {
          label: "目标主机",
          value: this.peerHost,
          hint: `正在连接 ${this.targetUrl || this.peerHost}，请稍候…`,
        }
        break
      case "connected":
        subtext = "局域网对战 · 已连接"
        detail = {
          label: "连接状态",
          value: "已连接",
          hint: "已连上对方房间，等待主机开球…",
        }
        break
      default:
        subtext = "局域网对战 · 连接失败"
        detail = {
          label: "原因",
          value: reason ?? "连接失败",
          hint: hint ?? LAN_GUIDE_GENERAL,
        }
        extra = LAN_FAIL_ACTIONS
        break
    }
    try {
      this.container.notifyLocal(
        {
          type: "Info",
          title: ruleName(this.ruletype),
          subtext,
          sticky: true,
          key: "lan-room",
          detail,
          extra,
        },
        0,
        { "retry-lan": () => this.retryJoin() }
      )
    } catch {
      // 通知组件不可用，不影响连接逻辑
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      globalThis.clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private notify(title: string, subtext: string): void {
    // v1.3.67：sticky 房间窗在屏时，LanRelay 的过渡性提示（"已连接"、"正在
    // 创建房间"等）会被粘性守卫吃掉且没必要显示。失败/开局成功的提示已
    // 通过 dismissRoom() 主动关 sticky 后再调 notify，正常出现。
    if (this.container.notification?.stickyKey) {
      return
    }
    try {
      this.container.notify({
        type: "Info",
        title,
        subtext,
      } as const)
    } catch {
      // 通知失败不影响对局逻辑
    }
  }
}
