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
  k:
    | "started"
    | "startfail"
    | "clients"
    | "log"
    // v1.3.81：原生 WebSocket 通道事件
    | "wsopen"
    | "wsmsg"
    | "wsclose"
  port?: number
  /** v1.3.69：bind 成功时由 Java 同步带回的本机 IPv4；空串表示没拿到 */
  ip?: string
  iface?: string
  hasWifiIface?: boolean
  error?: string
  n?: number
  reason?: string
  line?: string
  /** v1.3.81：原生通道收到的文本消息 */
  d?: string
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
 *
 * v1.3.78：局域网对战真正跑通的版本。此前 ws:// 一直建不起来，根因是
 *   APP 页面 origin 为 https://billiards.local/，从 https 页面发起 ws:// 属
 *   **主动混合内容**，被 Blink 直接拦截（setMixedContentMode 与
 *   usesCleartextTraffic 都管不到 WebSocket）—— 修复在 Java 侧把虚拟域名协议
 *   换成 http（见 MainActivity.VHOST 注释）。本文件另修正了失败诊断文案：
 *   原来的「说明是 App 内的明文连接被系统策略拦截了」是硬编码猜测，
 *   与当时的真实原因不符（见 diagnoseFailure）。
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
  /**
   * v1.3.81：主机侧服务端**实际**绑定的端口。
   *
   * LanServer 在 24816 被占用时会顺延到 24817/24818…（最多试 10 个），实际
   * 端口经 started 事件带回。旧版房间界面只显示 IP，客机永远只连 24816 ——
   * 一旦顺延就连错端口。现在把它记下来，房间界面展示 "IP:端口"。
   */
  private roomPort = 0
  /**
   * v1.3.79：Java 侧诊断日志环形缓冲（最多 LAN_LOG_KEEP 条）。
   *
   * 为什么需要它：LanServer 在 accept / 握手 / 读帧异常时都会 onLog，但页面端
   * 的 onStatus 从来没有处理 k==="log" 分支，这些日志全部被丢掉 —— 真机上一次
   * 连接失败到底是「ACCEPT 层就没进来」、「握手被当成非 WebSocket 拒绝」还是
   * 「读帧异常」，从界面上完全看不出来，只能靠读代码猜。现在把它们收集起来，
   * 失败时直接显示在弹窗里，用户截图即可定位。
   */
  private readonly logRing: string[] = []
  /** 客机端连接失败后写入的自身侧诊断（WebSocket 的 error/close 详情） */
  private readonly selfDiag: string[] = []
  private static readonly LOG_KEEP = 6

  /**
   * v1.3.82：客机端 `hello` 重发定时器。
   *
   * 为什么需要：一局打完点「继续对战」时，**两台手机都要重载页面**，但两边
   * 重载的耗时不一样 —— 主机要重建容器、重启渲染场景、重新 bind 服务端，
   * 明显比客机慢。客机先连上、先把 hello 发出去，此时主机的 LanRelay 还在
   * 构造中（页面没连上服务端），LanServer 的 broadcast 找不到任何接收者，
   * **这条 hello 就永久丢失了**。主机随后连上来，却永远等不到 hello，
   * 于是 `gotHello` 一直是 false、`BeginEvent` 永远不推 —— 表现就是用户说的
   * 「点继续对战后无法开启游戏」（两边都停在球桌上，谁也不开球）。
   *
   * 对策：客机连上后先发一次 hello，随后每 HELLO_RESEND_MS 重发一次，
   * 直到收到任何有效对局事件（说明主机已开始广播）为止，最多 HELLO_RESEND_MAX 次。
   * hello 是幂等的 —— 主机侧 onHello 有 gotHello 去重，重发不会重复开局。
   */
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private helloSent = 0
  private static readonly HELLO_RESEND_MS = 1200
  private static readonly HELLO_RESEND_MAX = 8
  /**
   * v1.3.82：主机端「宽限开局」定时器。
   *
   * 若客机是更老的 APK（不会重发 hello），或者 hello 在路上又被吞了一次，
   * 主机不能就这么干等下去。收到「客机已连入」（clients 事件 n>=2）后起一个
   * 宽限计时，到点仍无 hello 就自行开局 —— 宁可双方都以为自己是先手（由
   * 后续事件校正），也不要两边一起卡死。
   */
  private graceTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly HELLO_GRACE_MS = 2500

  /**
   * v1.3.83：主机端的「对手来过 / 已提示过退出」标记。
   *
   * 主机自己占服务端 1 条连接，因此「对手在不在」只能由 clients 计数推断：
   * 计数从 1 升到 2 说明对手来了，从 2 掉回 1 说明对手走了。旧代码只看「有人
   * 进来」，对手退出时主机毫无感知（用户反馈第 2 条）。这两个标记用于补上
   * 掉线检测，并保证同一局只提示一次。
   */
  private peerWasHere = false
  private peerLeftShown = false

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
    // v1.3.82：hello 重发 / 宽限开局定时器同样要清，避免页面已离开还在发消息
    this.stopHelloResend()
    this.clearGraceTimer()
    // v1.3.81：原生通道也要断开，否则连接会泄漏到下一局
    try {
      this.nativeBridge()?.wsClose?.()
    } catch {
      // 忽略
    }
    try {
      this.ws?.close()
    } catch {
      // 忽略关闭失败
    }
  }

  // ---------------- 内部实现 ----------------

  /**
   * v1.3.81：当前是否使用原生通道（Android App 内且 bridge 提供了 wsConnect）。
   *
   * 背景：真机诊断已收敛到唯一结论 —— 同一台手机、同一目标、同一时刻，原生
   * Socket 能完整完成 WebSocket 握手（probePeer 返回 ok:101），而 WebView 自己的
   * new WebSocket() 始终 readyState=3 + close 1006（连 TCP 都没建立）。问题在
   * Android WebView 的 Chromium 网络栈，与网络、服务端都无关。既然原生通路已被
   * 证明可用，就直接用它承载对局消息，不再让 WebView 负责局域网连接。
   *
   * 浏览器调试环境（无 bridge）自动退回 WebSocket，保证开发时仍可测。
   */
  private nativeBridge():
    | {
        wsConnect?: (host: string, port: number) => void
        wsSend?: (text: string) => boolean
        wsClose?: () => void
        wsConnected?: () => boolean
      }
    | undefined {
    const b = (
      globalThis as unknown as {
        __lan?: {
          wsConnect?: (host: string, port: number) => void
          wsSend?: (text: string) => boolean
          wsClose?: () => void
          wsConnected?: () => boolean
        }
      }
    ).__lan
    if (b && typeof b.wsConnect === "function") return b
    return undefined
  }

  private send(env: Envelope): void {
    const json = JSON.stringify(env)
    // v1.3.81：优先走原生通道
    const nb = this.nativeBridge()
    if (nb) {
      try {
        nb.wsSend?.(json)
        return
      } catch {
        // 落回 WebSocket
      }
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(json)
    }
  }

  /** v1.3.81：处理原生通道推来的事件（由 onStatus 分派） */
  private onNativeWsEvent(s: LanStatus): void {
    if (s.k === "wsopen") {
      this.clearConnectTimer()
      if (this.role === "join") {
        this.pushSelfDiag("原生通道已连接，发送 hello")
        this.sendHello()
        this.scheduleHelloResend()
        this.setJoinConnected()
        return
      }
      this.notify("局域网对战", "已连接")
      return
    }
    if (s.k === "wsmsg" && s.d !== undefined) {
      this.handleEnvelope(s.d)
      return
    }
    if (s.k === "wsclose") {
      const reason = s.reason ?? "连接结束"
      this.pushSelfDiag(`原生通道关闭：${reason}`)
      if (this.role === "join") {
        if (this.joinState === "connected") {
          this.showDisconnected()
        } else {
          // 连不上时把原生通道给出的原因作为诊断的一部分展示
          this.failJoin(`连接失败（${reason}）`)
        }
        return
      }
      if (!this.closed) {
        this.notify("局域网对战", "与对手的连接已断开")
      }
    }
  }

  /** 解析一条信封消息（WebSocket 与原生通道共用） */
  private handleEnvelope(raw: string): void {
    try {
      const env = JSON.parse(raw) as Envelope
      if (env.k === "hello") {
        // v1.3.82：重新收到 hello = 对方也重载了页面（继续对战）。
        // 这正是「再来一局」的正常流程：双方各自重载，客机会重新发 hello。
        // 必须放行，让 onHello 再推一次 BeginEvent 开新局；否则主机会停留在
        // 上一局的 gotHello=true 上，新的一局永远开不起来。
        this.onHello(env)
      } else if (env.k === "ev" && env.d) {
        // v1.3.82：收到真实对局事件 → 说明主机已经在广播，hello 使命完成
        this.stopHelloResend()
        this.callback?.(env.d)
      }
    } catch {
      // 忽略非法消息
    }
  }

  // ---------------- v1.3.82：hello 重发 / 宽限开局 ----------------

  /** 客机端发一条 hello（幂等，主机侧有 gotHello 去重） */
  private sendHello(): void {
    this.helloSent += 1
    this.send({ k: "hello", ruletype: this.ruletype, name: "玩家" })
  }

  /**
   * 客机端连上后周期重发 hello，直到收到对局事件或次数用尽。
   * 覆盖「客机先重载、主机后重载」导致的 hello 丢失（详见字段注释）。
   */
  private scheduleHelloResend(): void {
    this.stopHelloResend()
    const tick = (): void => {
      if (this.closed) return
      if (this.helloSent >= LanRelay.HELLO_RESEND_MAX) {
        this.pushSelfDiag("hello 重发已达上限，停止")
        return
      }
      this.sendHello()
      this.pushSelfDiag(`hello 未见回应，第 ${this.helloSent} 次重发`)
      this.helloTimer = globalThis.setTimeout(tick, LanRelay.HELLO_RESEND_MS)
    }
    this.helloTimer = globalThis.setTimeout(tick, LanRelay.HELLO_RESEND_MS)
  }

  private stopHelloResend(): void {
    if (this.helloTimer !== null) {
      globalThis.clearTimeout(this.helloTimer)
      this.helloTimer = null
    }
  }

  /**
   * 主机端：收到「对手已连入」后起宽限计时。到点仍没等到 hello 就自行开局，
   * 避免对方是不重发 hello 的旧版本时双方一起卡住。
   */
  private scheduleGraceBegin(): void {
    if (this.role !== "host") return
    if (this.graceTimer !== null) return
    this.graceTimer = globalThis.setTimeout(() => {
      this.graceTimer = null
      if (this.closed || this.gotHello) return
      this.pushSelfDiag("宽限期到，主机主动开局（未收到 hello）")
      this.dismissRoom()
      this.notify("局域网对战", "对手已就绪，你先开球")
      this.callback?.(EventUtil.serialise(new BeginEvent()))
    }, LanRelay.HELLO_GRACE_MS)
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      globalThis.clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
  }

  private open(): void {
    const w = globalThis as unknown as Record<string, unknown>
    // v1.3.79：__lanEvent 改成**两端都注册**。
    //
    // 以前只有 host 分支注册，客机分支直接 startJoin() —— 于是客机拿不到任何
    // Java 侧事件。这不只丢了日志：客机的 join 流程本身不需要 started 事件，
    // 但**需要 log 事件**来诊断。注册是无副作用的（onStatus 按 k 分派，客机
    // 收到 started/startfail 时不会误动作，因为客机根本不会调 startServer）。
    ;(w as { __lanEvent?: (s: LanStatus) => void }).__lanEvent = (s) =>
      this.onStatus(s)
    if (this.role === "host") {
      // 主机：先让 Java 起服务端，拿到实际端口后再连自己
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
    // v1.3.79：先接住诊断日志 —— 它在任何状态下都可能到达，且必须**先于**
    // 其它分支处理，否则客机端（只有 failed 分支有意义）会把它丢掉。
    if (s.k === "log" && s.line) {
      this.pushLog(s.line)
      return
    }
    // v1.3.81：原生 WebSocket 通道事件
    if (s.k === "wsopen" || s.k === "wsmsg" || s.k === "wsclose") {
      this.onNativeWsEvent(s)
      return
    }
    if (s.k === "started" && s.port) {
      // v1.3.82：只接受**合法**端口。
      //
      // LanServer.start() 在「服务端已在运行」时会复用端口，并调
      // notifyStarted(-1, ...) —— 这个 -1 是「端口不变，沿用上次」的哨兵值。
      // 旧判断 `s.port` 对 -1 是 truthy，于是 roomPort 被写成 -1，房间界面
      // 拼出 "192.168.5.8:-1" 这种错误地址（用户实测反馈）。现在过滤掉非法
      // 端口：非 -1 且落在 1..65535 才更新。
      const validPort = s.port > 0 && s.port <= 65535
      if (validPort) this.roomPort = s.port
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
      if (this.role === "host") {
        if (s.n >= 2) {
          // v1.3.83：记下「本局对手来过」，供下面的掉线分支判断
          this.peerWasHere = true
          // v1.3.93：改用 sticky 刷新而不是 dismiss + notify。
          //
          // 旧实现是 dismissRoom() 关掉房间窗，再 notify 一条 3 秒的瞬时提示
          // 「对手已连接，等待开局…」。问题在于：从「对手连入」到「真正开局」
          // 之间有一段**握手真空期**（要等对方 hello / 且最坏要等 2.5s 宽限
          // 超时）。这段时间屏幕上什么都没有，用户看到的就是"窗关了、球桌没人
          // 开球"，很容易以为掉线了。现在把房间窗原地刷成"对手已加入，正在开局"
          // 的等待态，转圈提示进行中，开局时由 init.handleBegin 关窗。
          this.showRoomWaitingPeer()
          // v1.3.82：客机已连入。起一个宽限计时 —— 如果对方是旧版 APK
          // （不重发 hello）或者 hello 又被吞了一次，到点由主机主动开局，
          // 不至于两边一起卡在球桌上。
          this.scheduleGraceBegin()
        } else if (this.peerWasHere && !this.peerLeftShown) {
          // v1.3.83：**主机端对手退出检测**（用户反馈第 2 条）。
          //
          // 为什么之前没有提示：主机自己的连接始终是活的，对手退出时主机侧
          // **不会**收到 wsclose —— 它只能从服务端的客户端计数看出来。而旧代码
          // 的 clients 分支只处理 n>=2（有人进来），n 从 2 掉回 1 时什么都不做，
          // 于是对手退出后主机毫无感知，还在球桌上干等。
          //
          // 主机自己占 1 条连接，所以「对手退出」的判据就是 n 回落到 1 且
          // 此前来过对手。用 peerLeftShown 去重，避免服务端多次上报 1 时反复弹。
          this.peerLeftShown = true
          this.clearGraceTimer()
          this.stopHelloResend()
          this.showPeerLeft()
        }
      }
    }
  }

  /**
   * v1.3.83：对手退出对局的提示（主机端 / 客机端共用）。
   *
   * 为什么不能直接用 notify()：它有「sticky 在屏就丢弃」的守卫（见 notify 注释），
   * 而对手**在开局前**退出时，房间 sticky 窗还挂在屏上（主机端的
   * key="lan-room"），提示会被静默吞掉 —— 用户看到的仍是「等待对手加入…」，
   * 完全不知道人已经走了。这里先 dismissRoom() 关掉 sticky，再直接走
   * container.notify，保证提示一定上屏。
   *
   * 提示带「返回主菜单」按钮：对手已走，这一局无法继续，给用户一个明确出口。
   */
  private showPeerLeft(): void {
    this.pushSelfDiag("对手已离开对局")
    this.dismissRoom()
    try {
      this.container.notifyLocal(
        {
          type: "Info",
          title: "局域网对战",
          subtext: "对手已退出对局",
          // v1.3.93：不再只有一个「返回主菜单」。对方可能只是网络抖动或手滑
          // 退出，直接判死太生硬 —— 给一个「留在房间继续等」的出口（房间窗
          // 会被重新拉起，服务端仍在监听），也明确告知本局已无法继续。
          extra:
            "对方已离开房间，本局无法继续。你可以返回菜单重新建房，或留在房间等待对方重新加入。" +
            '<button type="button" class="notification-btn" ' +
            'data-notification-action="lan-keep-wait">留在房间等待</button>' +
            '<button type="button" class="notification-btn" ' +
            'data-notification-action="menu">返回主菜单</button>',
        },
        0,
        {
          "lan-keep-wait": () => this.keepWaitingForPeer(),
        }
      )
    } catch {
      // 通知失败不影响连接状态机
    }
  }

  /**
   * v1.3.93：「留在房间等待」—— 对手退出后不结束，把房间窗重新拉起来继续监听。
   *
   * 必须重置 peerLeftShown，否则对方重新加入、再次退出时不会再提示
   * （去重标记的本意是"同一段离开只提示一次"，而这里用户已明确选择继续等，
   * 语义上是一段新的等待）。
   */
  private keepWaitingForPeer(): void {
    this.peerLeftShown = false
    this.peerWasHere = false
    this.pushSelfDiag("用户选择留在房间继续等待对手")
    this.showRoomInfo()
  }

  /**
   * v1.3.79：记一条 Java 侧诊断日志（环形，只留最近 LOG_KEEP 条）。
   * 失败弹窗会把它们附在 hint 里，用户截图即可定位。
   */
  private pushLog(line: string): void {
    const t = String(line).trim()
    if (!t) return
    this.logRing.push(t)
    while (this.logRing.length > LanRelay.LOG_KEEP) this.logRing.shift()
  }

  /**
   * v1.3.79：把一条页面侧诊断同时写进环形缓冲与手机上的 lan-diag.log。
   *
   * 为什么要落文件：弹窗正文放不下多少字，用户也难逐字转述；写文件后可以
   * 让用户直接把整份现场发出来。Java 侧 __lan.diagLog 负责真正落盘。
   */
  private fileLog(line: string): void {
    try {
      const bridge = (
        globalThis as unknown as { __lan?: { diagLog?: (s: string) => string } }
      ).__lan
      if (bridge && typeof bridge.diagLog === "function") {
        bridge.diagLog(String(line))
      }
    } catch {
      // 老 APK 没有该方法 / 写失败都不影响连接逻辑
    }
  }

  /** v1.3.79：记一条页面侧诊断（WebSocket 的 error / close 详情） */
  private pushSelfDiag(line: string): void {
    const t = String(line).trim()
    if (!t) return
    this.fileLog("page: " + t)
    if (this.selfDiag.indexOf(t) >= 0) return
    this.selfDiag.push(t)
    while (this.selfDiag.length > LanRelay.LOG_KEEP) this.selfDiag.shift()
  }

  /** v1.3.79：把两侧诊断拼成一段可截图的文本；无日志时返回空串 */
  private diagText(): string {
    const parts: string[] = []
    if (this.selfDiag.length > 0) {
      parts.push("本机：" + this.selfDiag.join(" / "))
    }
    if (this.logRing.length > 0) {
      parts.push("对方：" + this.logRing.join(" / "))
    }
    return parts.join("；")
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
    // v1.3.79：客机建链两端的现场都要留痕，否则失败后无法区分「URL 就错了」
    // 与「URL 对了但被拦/被拒」。
    if (this.role === "join") {
      this.pushSelfDiag(`准备连接 ${url}`)
    }

    // v1.3.81：Android App 内优先走**原生通道**，绕开 WebView 网络栈。
    //
    // 这是局域网对战真正的修复点：真机已证明「原生 Socket 能完整握手，WebView
    // 的 new WebSocket() 连 TCP 都建立不起来」。既然原生通路可用，就不再让
    // WebView 负责连接。浏览器调试环境无 bridge，自动落到下面的 WebSocket 分支。
    const nb = this.nativeBridge()
    if (nb) {
      this.pushSelfDiag(`走原生通道连接 ${t.host}:${t.port}`)
      if (this.role === "join") {
        this.clearConnectTimer()
        this.connectTimer = globalThis.setTimeout(() => {
          this.connectTimer = null
          this.pushSelfDiag("原生通道等待超时（未收到 wsopen/wsclose）")
          this.failJoin("连接超时")
        }, JOIN_TIMEOUT_MS) as unknown as number
      }
      try {
        nb.wsConnect?.(t.host, t.port)
        return
      } catch (e) {
        this.pushSelfDiag(
          `原生通道调用异常：${(e as Error)?.message ?? String(e)}`
        )
        // 落到 WebSocket 分支再试一次
      }
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      // v1.3.79：构造函数抛异常通常意味着被**策略**拦截（最典型是 https 页面
      // 发 ws:// 的混合内容拦截），而不是网络不通 —— 这是最需要区分的一类。
      if (this.role === "join") {
        this.pushSelfDiag(
          `构造 WebSocket 抛异常：${(e as Error)?.message ?? String(e)}`
        )
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
        this.pushSelfDiag("本地等待超时（未收到 open/error/close）")
        this.failJoin("连接超时")
      }, JOIN_TIMEOUT_MS) as unknown as number
    }

    ws.onopen = () => {
      this.clearConnectTimer()
      if (this.role === "join") {
        this.pushSelfDiag("WebSocket 已打开，发送 hello")
        this.send({ k: "hello", ruletype: this.ruletype, name: "玩家" })
        // v1.3.73：连上就明确告诉用户"已连接"，别再让人猜到底连没连上。
        this.setJoinConnected()
        return
      }
      this.notify("局域网对战", "已连接")
    }

    ws.onmessage = (ev) => {
      this.handleEnvelope(String(ev.data))
    }

    ws.onclose = (ev) => {
      // v1.3.79：把 close 的 code/reason 记下来。1006 = 异常断开（没有收到
      // 关闭帧），通常意味着对端在握手阶段就关了 Socket —— 与服务端 onLog
      // 的 "handshake: 非 WebSocket 请求已拒绝" 是同一件事的两面。
      this.pushSelfDiag(
        `close code=${ev?.code ?? "?"}${ev?.reason ? " reason=" + ev.reason : ""}`
      )
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
      // v1.3.79：WebSocket 的 error 事件按规范不带原因（安全考虑），只能记录
      // "发生过 error" + 就绪状态，作为 close code 的补充。
      this.pushSelfDiag(`error readyState=${ws.readyState}`)
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
    // v1.3.81：房间地址带上**实际端口**。
    //
    // 主机建房时若 24816 被占用，LanServer 会顺延到 24817/24818…，实际端口经
    // started 事件带回（this.roomPort）。旧版房间界面只显示 IP，客机永远只连
    // 24816 —— 一旦发生顺延，客机连的就是一个没人监听的端口（或别人的程序）。
    // 现在把 "IP:端口" 完整展示，客机填完整地址即可（resolveTarget 支持带端口）。
    // v1.3.82：只在端口**合法且确实变更**时才拼接端口。
    // 双重防御：即便上游漏进 -1/0/NaN，这里也不会拼出 ":−1" 这种地址。
    const portValid = this.roomPort > 0 && this.roomPort <= 65535
    const portChanged = portValid && this.roomPort !== LAN_DEFAULT_PORT
    const addr = diag.ip
      ? (portChanged ? `${diag.ip}:${this.roomPort}` : diag.ip)
      : ""
    let detail: {
      label: string
      value: string
      hint?: string
      state?: "spin" | "ok" | "warn" | "error"
      mono?: boolean
    }
    if (addr) {
      // v1.3.93：房间地址是"要念给对手/让对方手抄"的内容 —— 用等宽大字展示，
      // 且**不带状态图标**（这里不是"出问题了"，纯信息）。端口被顺延时用
      // 警示态提醒"这串地址和别人不一样，别少抄端口"。
      detail = {
        label: "本机房间地址",
        value: addr,
        hint: portChanged
          ? `默认端口被占用，已改用 ${this.roomPort}。请把上面这串**完整地址**（含端口）告诉对手。`
          : "把这串地址告诉对手，让他在『加入房间』里填写。\n等对方连上后会自动开局，这扇窗会自动关闭。",
        state: portChanged ? "warn" : undefined,
        mono: true,
      }
    } else if (diag.error) {
      detail = {
        label: "取本机 IP 失败",
        value: diag.error,
        hint: "请确认手机已连 Wi-Fi，然后返回菜单重新建房",
        state: "error",
      }
    } else if (!diag.hasWifiIface) {
      detail = {
        label: "未连接 Wi-Fi",
        value: "没检测到无线网络",
        hint: "局域网对战需要两台手机连同一个 Wi-Fi。请连上后返回菜单重新建房",
        state: "error",
      }
    } else {
      detail = {
        label: "Wi-Fi 未分配 IP",
        value: "接口已连接但没拿到 IPv4",
        hint: "请到 设置 → Wi-Fi → 当前网络 查看 IP 地址，把地址告诉对手；或重启 Wi-Fi 后重进",
        state: "warn",
      }
    }
    try {
      this.container.notifyLocal(
        {
          type: "Info",
          title: ruleName(this.ruletype),
          // v1.3.93：subtext 直接说出「在等谁做什么」，而不是只描述房间状态。
          // 主机建房后最常见的困惑就是「然后呢？」，这里明确给出「等对手加入」。
          subtext: addr
            ? "局域网对战 · 等待对手加入"
            : "局域网对战 · 正在准备房间…",
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
   * v1.3.93：主机端「对手已连入，正在开局」的等待态。
   *
   * 为什么不沿用 notify()：走 notify 会先关掉房间窗再弹一条 3 秒瞬时提示，
   * 于是从「对手连入」到「真正开局」之间的握手真空期（等对方 hello、最坏
   * 2.5 秒宽限超时）屏幕上空着，用户容易误判为掉线。这里复用 sticky 窗
   * （key 仍是 "lan-room"），原地刷成等待态并在开局时由 init.handleBegin
   * 统一关闭 —— 全程都有明确反馈，也不新增任何连接逻辑。
   *
   * 注意**不写具体 IP**：这一步双方的连接已经建立，IP 已无用途；写它反而
   * 让用户以为还要再抄一遍地址。
   */
  private showRoomWaitingPeer(): void {
    if (this.role !== "host") return
    // 只在房间窗还在屏上时才刷新（用户已手动关窗 / 已进对局就别再弹回来）
    if (this.container.notification?.stickyKey !== "lan-room") return
    try {
      this.container.notifyLocal(
        {
          type: "Info",
          title: ruleName(this.ruletype),
          subtext: "局域网对战 · 对手已加入",
          sticky: true,
          key: "lan-room",
          detail: {
            label: "连接状态",
            value: "双方已连通，正在开局…",
            hint: "你是先手，开局后由你先击球。",
            state: "spin",
          },
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
    // v1.3.82：去掉 `if (this.gotHello) return` 的一次性拦截。
    //
    // 一局打完后点「继续对战」，双方页面都会重载、LanRelay 重新构造，
    // gotHello 本来就是 false，理论上不受影响；但客机现在会**重发** hello
    // （见 scheduleHelloResend），若这里仍按「只认第一条」拦截，第二条
    // hello 会被丢掉 —— 而第一条可能恰好落在主机还没接管的空窗里。
    // onHello 本身是幂等的（开局 + 通知），重复执行只是多推一次 BeginEvent，
    // 由 Container 侧的去重负责；比「永远不开局」安全得多。
    this.gotHello = true
    this.clearGraceTimer()
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

  /**
   * 已连接后又断开：对方退出房间 / Wi-Fi 掉了。
   *
   * v1.3.83：文案明确成「对手已退出对局」（用户反馈第 2 条 —— 此前写的是
   * 「与对手的连接已断开」，用户看不出是对方主动退出还是网络抖动），并补上
   * 「重新连接」与「返回主菜单」两个出口。仍复用 sticky 窗（key="lan-room"），
   * 因此握手阶段与对局中都能覆盖刷新，不会被粘性守卫吞掉。
   */
  private showDisconnected(): void {
    if (this.joinState !== "connected") return
    this.clearConnectTimer()
    this.stopHelloResend()
    this.joinState = "disconnected"
    this.pushSelfDiag("对手已离开对局（原生通道关闭）")
    this.showJoin(
      "对手已退出对局",
      "对方已离开房间或网络中断，本局无法继续。若对方重新建房，可点『重新连接』。"
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
    this.pushSelfDiag(`判定连接失败：${reason}`)
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
    // v1.3.79：把两侧诊断日志附在提示末尾 —— 真机上这是唯一能把"失败发生在
    // 哪一层"带出来的通道（accept / 握手 / 读帧 / 页面侧 close code）。
    const diag = this.diagText()
    const withDiag = (hint: string): string =>
      diag ? `${hint} 〔诊断〕${diag}` : hint

    // v1.3.80：probePeer 已升级为**真实握手探测**，返回码能定论失败层次。
    // 每一个分支都给出针对该机制的具体指引，不再有"多为系统拦截"这类猜测。
    if (probe.startsWith("ok:101")) {
      // 对端回 101，服务端完全正常 —— 失败必然在客机 WebView 侧
      return {
        value: "对方服务正常，但本机 WebView 未能建链",
        hint: withDiag(
          "对方房间的服务端应答完全正常（已回 101）。问题在本机 WebView 无法发起该连接：" +
            "多为页面协议与 ws:// 不匹配被拦截，或系统/安全软件限制了本应用的联网。" +
            "请检查手机管家的联网权限、关闭省电限制后重试；若仍失败请把本段诊断发回。"
        ),
      }
    }
    if (probe.startsWith("ok:silent")) {
      // 连上了但一个字节都不回 —— 典型的"端口有人但不干活"
      return {
        value: "对方端口有响应但服务未就绪",
        hint: withDiag(
          "对方手机的端口能连通，但服务端没有回应握手数据。" +
            "请让对方**完全退出房间再重新『创建房间』**（不要只是切到后台），" +
            "并确认对方屏幕上房间界面正常显示、没有停在加载中。"
        ),
      }
    }
    if (probe.startsWith("ok:http:")) {
      // 回的是普通 HTTP —— 端口被别的程序占了
      const line = probe.slice(8)
      return {
        value: "对方端口被其他程序占用",
        hint: withDiag(
          `对方 IP 的该端口回应了普通 HTTP（${line}），说明被别的程序占用，` +
            "不是本游戏的服务端。请让对方彻底关闭该应用后重新打开建房，" +
            "或先关闭对方手机上可能在用这个端口的其它软件。"
        ),
      }
    }
    if (probe.startsWith("ok:garbage")) {
      return {
        value: "对方端口响应的不是本游戏服务",
        hint: withDiag(
          "对方 IP 的该端口有响应，但返回的数据不是 WebSocket。" +
            "请确认 IP 填的是对方游戏房间界面显示的地址，且对方确实点开了『创建房间』。"
        ),
      }
    }
    if (probe.startsWith("refused")) {
      return {
        value: "对方手机在线，但房间没开",
        hint: withDiag(
          "请让对方先在主菜单点『创建房间』并停留在该页面，然后你再点『重新连接』。"
        ),
      }
    }
    if (probe.startsWith("timeout")) {
      return {
        value: `${reason}：找不到 ${target}`,
        hint: withDiag(LAN_GUIDE_GENERAL),
      }
    }
    if (probe.startsWith("error")) {
      return {
        value: `${reason}：${probe.slice(6) || target}`,
        hint: withDiag(LAN_GUIDE_GENERAL),
      }
    }
    return { value: `${reason}：${target}`, hint: withDiag(LAN_GUIDE_GENERAL) }
  }

  /** 失败弹窗上的「重新连接」：关掉旧 ws 重走一遍连接流程 */
  private retryJoin(): void {
    try {
      this.ws?.close()
    } catch {
      // 忽略
    }
    // v1.3.81：原生通道也一起关掉再重连
    try {
      this.nativeBridge()?.wsClose?.()
    } catch {
      // 忽略
    }
    this.ws = null
    this.gotHello = false
    // v1.3.79：清掉上一轮的诊断，避免重新连接时把旧日志当成新现场展示
    this.selfDiag.length = 0
    this.logRing.length = 0
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
    let detail: {
      label: string
      value: string
      hint?: string
      state?: "spin" | "ok" | "warn" | "error"
      mono?: boolean
    }
    let extra: string | undefined
    switch (this.joinState) {
      case "connecting":
        // v1.3.93：等待态带转圈 + 进度感文案。
        // 旧版这里只有一行「正在连接 ws://...，请稍候…」，6 秒内页面完全静止，
        // 用户无法判断是"在连"还是"卡死了"。现在有旋转指示器，且把目标地址
        // 单独用等宽大字展示（方便核对是不是抄错了 IP）。
        subtext = "局域网对战 · 正在连接…"
        detail = {
          label: "目标主机",
          value: this.peerHost,
          hint: `正在连接 ${this.targetUrl || this.peerHost}\n若 6 秒内无响应会自动判定超时，可点下方按钮重试。`,
          state: "spin",
          mono: true,
        }
        break
      case "connected":
        subtext = "局域网对战 · 已连接"
        detail = {
          label: "连接状态",
          value: "已连接对方房间",
          hint: "已连上对方房间，正在等待主机开球…",
          state: "ok",
        }
        break
      case "disconnected":
        // v1.3.83：对手已退出 —— 与「连接失败」区分开：失败是我们没连上，
        // 断开是曾经连上过、对方后来走了，两者的处置动作也不同。
        subtext = "局域网对战 · 对手已退出"
        detail = {
          label: "状态",
          value: "对手已退出对局",
          hint: reason ?? "对方已离开房间或网络中断，本局无法继续。",
          state: "warn",
        }
        extra = LAN_FAIL_ACTIONS
        break
      default:
        subtext = "局域网对战 · 连接失败"
        detail = {
          label: "原因",
          value: reason ?? "连接失败",
          hint: hint ?? LAN_GUIDE_GENERAL,
          state: "error",
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
