import { MessageRelay } from "./messagerelay"
import { BeginEvent } from "../../events/beginevent"
import { EventUtil } from "../../events/eventutil"
import { Container } from "../../container/container"
import { ruleName } from "../../utils/i18n"

/** 局域网服务端监听端口（主机侧）；被占用时 LanServer 会顺延，实际端口由回调给出 */
export const LAN_DEFAULT_PORT = 24816

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
 */
export class LanRelay implements MessageRelay {
  private ws: WebSocket | null = null
  private callback: ((message: string) => void) | null = null
  private gotHello = false
  private closed = false

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
    // 客机：直接连对方
    this.notify("局域网对战", `正在连接 ${this.peerHost}…`)
    this.connect(this.peerHost, LAN_DEFAULT_PORT)
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
  private connect(hostAndPort: string, defaultPort: number): void {
    let host = String(hostAndPort || "")
    let port = defaultPort
    // 仅当形如 host:port 且尾部是纯数字时才拆端口（避免误伤 IPv6 的冒号）
    const m = /^(.*):(\d{1,5})$/.exec(host)
    if (m && m[1] && !m[1].includes(":")) {
      host = m[1]
      port = Number(m[2])
    }
    const url = `ws://${host}:${port}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.notify("局域网对战", `连接失败：${url}`)
      return
    }
    this.ws = ws

    ws.onopen = () => {
      if (this.role === "join") {
        this.send({ k: "hello", ruletype: this.ruletype, name: "玩家" })
        // v1.3.67：join 端 ws 已连上，但还没收到主机 hello 推进 BeginEvent。
        // 此时 sticky 弹窗还在；待主机 hello 过来、BeginEvent 触发 handleBegin
        // 后再由 init.handleBegin 的 clear() 兜底关掉。
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
      if (!this.closed) {
        this.notify("局域网对战", "与对手的连接已断开")
      }
    }

    ws.onerror = () => {
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
