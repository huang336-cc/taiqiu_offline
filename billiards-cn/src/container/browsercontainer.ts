import { Container } from "./container"
import { ContainerConfig } from "./containerconfig"
import { Keyboard } from "../events/keyboard"
import { EventUtil } from "../events/eventutil"
import { BreakEvent } from "../events/breakevent"
import { GameEvent } from "../events/gameevent"
import {
  bounceHan,
  bounceHanBlend,
  mathavanAdapter,
} from "../model/physics/physics"
import { strongeAdapter } from "../model/physics/stronge"
import JSONCrush from "jsoncrush"
import { Assets } from "../view/assets"
import { SnookerConfig } from "../utils/snookerconfig"
import { TableConfig } from "../view/tableconfig"
import { ThreeCushionConfig } from "../utils/threecushionconfig"
import { Session } from "../network/client/session"
import { MessageRelay } from "../network/client/messagerelay"
import { BotRelay } from "../network/bot/botrelay"
import { LanRelay } from "../network/client/lanrelay"
import { ScoreReporter } from "../network/client/scorereporter"
import { Logger } from "../network/bot/logger"
import { getUID } from "../utils/uid"
import { applyPhysicsParams } from "../utils/physicsparams"
import { Settings } from "../utils/settings"
import { ruleName } from "../utils/i18n"
import { readReplayFromStorage } from "../utils/replay-nav"
import { TurnTimer } from "../utils/turntimer"

/**
 * Integrate game container into HTML page
 */
export class BrowserContainer {
  container: Container
  canvas3d
  tableId
  clientId
  wss
  lobbyUrl
  ruletype
  playername: string
  replay: string | null
  messageRelay: MessageRelay | null = null
  breakState: {
    init: any
    shots: any[]
    now: number
    score: number
    players?: { player1: string; player2: string }
    tableSize?: number
  } = {
    init: null,
    shots: [],
    now: 0,
    score: 0,
  }
  cushionModel
  spectator
  first
  assets: Assets
  now
  botMode: boolean = false
  botName: string = ""
  /** v1.3.65：局域网对战角色 —— 空（不是联机）/ host（建房）/ join（加入） */
  lanMode: string = ""
  /** v1.3.65：join 模式下对方的 IP（可带 :端口） */
  lanPeer: string = ""
  practiceMode: boolean = false
  drillMode: boolean = false
  analysisMode: boolean = false
  examMode: boolean = false
  speedrun: boolean = false
  localMesh: boolean = false
  turnTimer = new TurnTimer()
  readonly botDelay: number = 500
  constructor(canvas3d, params) {
    this.now = Date.now()
    // 离线单机版：固定本地玩家名，不再从链接读取身份信息
    this.playername = "玩家"
    this.tableId = "local"
    this.clientId = `G_${getUID()}`
    this.replay = params.get("state")
    // v1.2.5：优先读取 ?replayId= 对应的 sessionStorage 完整回放数据。
    // 这样可以传输任意长度的完整对局，规避 Android WebView 对 URL 长度的限制
    // （之前 ?state=<超长压缩串> 被截断，只回放出前几个球）。
    const replayId = params.get("replayId")
    if (replayId) {
      const stored = readReplayFromStorage(replayId)
      if (stored) {
        this.replay = stored
      } else {
        // v1.2.13 #replay：sessionStorage 中找不到对应回放（可能被清理或 WebView 限制），
        // 避免静默进入普通游戏，直接提示并返回菜单。
        console.error(`[replay] sessionStorage missing for replayId=${replayId}`)
        try {
          alert("回放数据已失效或无法读取，请返回菜单重试。")
        } catch {}
        globalThis.location.href = "menu.html"
        return
      }
    }
    this.ruletype = params.get("ruletype") ?? "nineball"
    // 离线版永不建立网络连接
    this.lobbyUrl = null
    this.wss = null
    this.canvas3d = canvas3d
    this.cushionModel = this.cushion(params.get("cushionModel"))
    // 离线版无观战/联机相关模式
    this.spectator = false
    this.first = false
    this.botMode = params.has("bot")
    this.botName = params.get("bot") ?? ""
    // v1.3.65：局域网对战（?lan=host 建房 / ?lan=join&peer=<ip> 加入）
    this.lanMode = params.get("lan") ?? ""
    this.lanPeer = params.get("peer") ?? ""
    const lanMode = this.lanMode === "host" || this.lanMode === "join"
    // 电脑对战每回合倒计时：参数 ?timer=N（N 秒），0 表示无限制
    const timerParam = Number.parseInt(params.get("timer") ?? "0", 10)
    if (this.botMode) {
      this.turnTimer.configure(timerParam > 0 ? timerParam : 0)
    } else {
      this.turnTimer.configure(0)
    }
    this.practiceMode = params.has("practice")
      ? params.get("practice") !== "false"
      : !this.botMode && !lanMode
    this.drillMode = false
    this.analysisMode = false
    this.examMode = false
    this.speedrun = false
    this.localMesh = false
    SnookerConfig.reds = Number.parseInt(params.get("reds") ?? "15") || 15
    ThreeCushionConfig.raceTo =
      Number.parseInt(params.get("raceTo") ?? "7") || 7
    Session.init(
      this.clientId,
      this.playername,
      this.tableId,
      this.spectator,
      this.botMode,
      this.examMode,
      this.practiceMode,
      Settings.lod(),
      this.first,
      this.speedrun
    )
    if (this.botMode) {
      // 比分栏 p2 名字最终由 updateScoreHud → orderedNamesForHud().p2Name
      // （即 Session.opponentName）决定，每次得分更新都会覆盖标签。
      // 因此把难度直接写进 opponentName，比分栏即可稳定显示
      // 「电脑(稳健) / 电脑(激进) / 电脑(专业)」，且双语一致。
      // v1.3.48：补全难度括号（此前菜单可见但游戏内只显示「电脑」）。
      const isEn = Settings.get().language === "en"
      const botName = this.botName || "ClawBreak"
      const diffMap: Record<string, { zh: string; en: string }> = {
        ClawBreak: { zh: "电脑(稳健)", en: "CPU(Steady)" },
        TheFarJaw: { zh: "电脑(激进)", en: "CPU(Aggressive)" },
        Professional: { zh: "电脑(专业)", en: "CPU(Pro)" },
      }
      const d = diffMap[botName] ?? diffMap.ClawBreak
      Session.getInstance().opponentName = isEn ? d.en : d.zh
    }
    applyPhysicsParams(params)
    // v1.3.72：注册 Java 主动推送的 lanInfo 接收函数（兜底双通道），
    // 早于 MainActivity.onPageFinished 的 600ms 推送，避免缓存写入被吞。
    BrowserContainer.installLanPush()
  }

  cushion(model) {
    switch (model) {
      case "bounceHan":
        return bounceHan
      case "bounceHanBlend":
        return bounceHanBlend
      case "stronge": {
        return strongeAdapter
      }
      default:
        return mathavanAdapter
    }
  }

  private createContainer(scoreReporter: ScoreReporter) {
    const config: ContainerConfig = {
      element: this.canvas3d,
      log: console.log,
      assets: this.assets,
      ruletype: this.ruletype,
      keyboard: new Keyboard(this.canvas3d, { disabled: false }),
      id: this.playername,
      relay: this.messageRelay,
      scoreReporter: scoreReporter,
      replayMode: !!this.replay,
      botMode: this.botMode,
      isSinglePlayer: !this.botMode && !this.replay && !this.lanMode,
      examMode: false,
    }
    const c = new Container(config)
    // 把 BrowserContainer 上配置好的 turnTimer 注入到 Container，确保倒计时生效
    c.turnTimer = this.turnTimer
    return c
  }

  start() {
    // If replay state embeds a non-default tableSize and the URL doesn't have
    // one yet, add it and redirect so that TableGeometry, scaleTableModel, and
    // Camera all see the correct value from the start.
    if (this.replay) {
      try {
        const state = this.parse(this.replay)
        const stateTableSize = state.tableSize
        // v1.3.59：比较基准不再是写死的 10，而是当前玩法的默认尺寸。
        // 斯诺克默认改 12 之后，若这里仍按 10 判断，一个 tableSize=12 的
        // 斯诺克回放会被当成「非默认」而反复重定向；反过来一个 tableSize=10 的
        // 旧斯诺克回放则不会被补上参数，载入时会用 12 的默认值重建台面而错位。
        const ruleType =
          state.rulename ??
          new URLSearchParams(globalThis.location.search).get("rule") ??
          undefined
        if (
          stateTableSize !== undefined &&
          stateTableSize !== TableConfig.defaultTableSize(ruleType) &&
          !new URLSearchParams(globalThis.location.search).has("tableSize")
        ) {
          const url = new URL(globalThis.location.href)
          url.searchParams.set("tableSize", String(stateTableSize))
          globalThis.location.href = url.toString()
          return
        }
      } catch {
        // If parsing fails, proceed normally
      }
    }

    this.assets = new Assets(this.ruletype)
    this.assets.loadFromWeb(() => {
      this.onAssetsReady()
    })
  }

  private initBotMode(scoreReporter: ScoreReporter) {
    this.container = this.createContainer(scoreReporter)
    // v1.1.24：容器一建好就启动渲染循环，不再等 init/notify/scoreReporter 完成。
    // 之前 animate() 在 onAssetsReady 末尾才调，若中间任意一行抛异常，
    // 整个渲染循环就死掉，画面永远停在紫色兜底。提前启动可保证：
    //   - 至少看到清屏色（绿）或后续加载的资源
    //   - 异常被 catch 后会上报到诊断浮层，不会静默失败
    this.container.animate(performance.now())
    this.container.init()
    const logs = new Logger()
    this.messageRelay = new BotRelay(logs, this.container)
    this.messageRelay.subscribe(this.tableId, (e) => {
      this.netEvent(e)
    })
// v1.3.58：旧写法只判了 TheFarJaw，选「专业」时开局提示会错显成「电脑 · 稳健」。
const botLabel =
this.botName === "TheFarJaw"
? "电脑 · 激进"
: this.botName === "Professional"
? "电脑 · 专业"
: "电脑 · 稳健"
    this.container.notify({
      type: "Info",
      title: ruleName(this.ruletype),
      subtext: `对战 ${botLabel}`,
      extra: "你先开球",
    } as const)
  }

  /**
   * v1.3.65：局域网对战。
   * 与 bot 模式同构：容器先起来跑渲染，再由 LanRelay 负责与对方的事件收发。
   * 开局不由本地直接触发 —— 主机收到客机的 hello 后才推 BeginEvent（主机先开球），
   * 见 LanRelay.onHello。
   */
  private initLanMode(scoreReporter: ScoreReporter) {
    const role: "host" | "join" = this.lanMode === "host" ? "host" : "join"
    this.container = this.createContainer(scoreReporter)
    this.container.animate(performance.now())
    this.container.init()
    this.messageRelay = new LanRelay(
      role,
      this.lanPeer,
      this.ruletype,
      this.container
    )
    this.messageRelay.subscribe(this.tableId, (e) => {
      this.netEvent(e)
    })
    Session.getInstance().opponentName = "对手"
    // v1.3.70：host 端**主动同步**调一次 JSBridge.lanInfo()（v1.3.68+ 新增）
    // 拿到本机 IP —— 这样弹窗第一次就有 IP 显示（或具体诊断），**不再停在
    // 「等待对手加入…」**。v1.3.67/68/69 之前都是依赖 LanServer.bind 成功后
    // emit started 事件，由 LanRelay 异步调 JSBridge 二次取——某些时序下
    // 二段链路会断（page 收不到事件 / JSBridge 调用失败 / event 回调被吞），
    // 结果就是 detail 永远停留在「等待对手加入…」。这里直接同步读一次，
    // 即使后续 started 事件没到，弹窗也有内容。
    //
    // v1.3.71：v1.3.70 的同步读一次会停在「正在获取本机 IP…」兜底（bridge
    // 还没准备好 / lanInfo() 暂时返回空 / WebView 反射 evaluateJavascript 失败）。
    // 加 300/900/2000ms 三次重试 —— 直到拿到有效 IP 或明确诊断（error /
    // hasWifiIface=false / 拿到 IP），最迟 2.5s 内必出结果，不再卡占位文案。
    // join 端不需要（目标主机即对方 IP，已经填在 lanPeer 里）。
    if (role === "host") {
      const initial = this.readInitialLanDetail()
      this.container.notifyLocal(
        {
          type: "Info",
          title: ruleName(this.ruletype),
          subtext: "局域网对战 · 我的房间",
          sticky: true,
          key: "lan-room",
          detail: initial,
        } as const,
        0
      )
      // 只在拿到"占位 / 失败"时重试（已有 IP/明确诊断就别再刷，避免抖动）
      if (
        initial.value === "正在获取本机 IP…" ||
        initial.label === "房间状态"
      ) {
        this.scheduleIpPoll(300, false)
        this.scheduleIpPoll(900, false)
        // 第 3 次重试：2.5s 到了仍然拿不到 IP → 强制显示"JSBridge 不可用"
        // 诊断（不再让用户停在"正在获取…"干等）。给升级 App / 重启 App 的指引。
        this.scheduleIpPoll(2500, true)
      }
    } else {
      this.container.notifyLocal(
        {
          type: "Info",
          title: ruleName(this.ruletype),
          subtext: `局域网对战 · ${this.lanPeer}`,
          sticky: true,
          key: "lan-room",
          detail: { label: "目标主机", value: this.lanPeer },
        } as const,
        0
      )
    }
  }

  /**
   * v1.3.71：host 端**主动**轮询 __lan.lanInfo()，把弹窗刷新成 IP 或诊断。
   * 不依赖 Java emit 的 started 事件（v1.3.69 验证在某些 ROM 上事件链会断）。
   * 每次只重写 detail（不动 title/subtext）避免抖动；拿到有效内容就停止轮询。
   * 已 dismiss / 被 sticky 守卫换走的弹窗不会刷新（stickyKey 不再是 lan-room）。
   *
   * 关键：第 4 次（forceTime 时）即使还是空也强制刷一次诊断，**不让用户
   * 一直停在「正在获取本机 IP…」**——如果 2.5s 后还没拿到，说明 JSBridge
   * 调不通，应该明确告诉用户去升级 App。
   */
  private scheduleIpPoll(delayMs: number, force: boolean): void {
    globalThis.setTimeout(() => {
      try {
        const n = this.container.notification
        if (!n || n.stickyKey !== "lan-room") return
        const d = this.readInitialLanDetail()
        // 已经拿到 IP / 明确诊断就跳过（force 模式会无视此判断，强制刷新）
        if (
          !force &&
          d.label !== "房间状态" &&
          d.value !== "正在获取本机 IP…"
        ) {
          return
        }
        // force=true 时如果还拿到"正在获取本机 IP…"，改写为明确诊断
        let detail = d
        if (force && d.value === "正在获取本机 IP…") {
          detail = {
            label: "本机 IP 不可用",
            value: "2.5 秒内 JSBridge 仍未返回 IP",
            hint: "请到 设置 → 应用 → 奥特曼的台球 → 强制停止，然后重新打开 App 建房；或重装 APK（v1.3.71+）",
          }
        }
        this.container.notifyLocal(
          {
            type: "Info",
            title: ruleName(this.ruletype),
            subtext: "局域网对战 · 我的房间",
            sticky: true,
            key: "lan-room",
            detail,
          } as const,
          0
        )
      } catch {
        // 静默忽略
      }
    }, delayMs)
  }

  /**
   * v1.3.70：host 端弹窗的初始 detail。同步调 __lan.lanInfo() 读一次 IP，
   * 按分级（IP / 诊断）回填——确保弹窗出来第一秒就显示真实信息，而不是
   * 「等待对手加入…」这种「让用户傻等」的占位文案。错误吞掉：JSBridge
   * 不可用（浏览器调试模式）就让 LanRelay 后续异步覆盖。
   */
  /** v1.3.72：Java 主动推送的 lanInfo 缓存（兜底双通道）。
   * 主通道是页面经 window.__lan.lanInfo() 拉取；部分 ROM 上 JSBridge 注入偏晚时，
   * MainActivity.onPageFinished 会主动 evaluateJavascript 调 window.__lanPush(json)
   * 把诊断推到这里。readInitialLanDetail 在主通道拿不到时回退读它。 */
  private static lanPushCache: string | null = null

  /** 注册全局接收函数（模块加载即生效，早于 Java 的 600ms 推送）。 */
  static installLanPush(): void {
    ;(globalThis as unknown as { __lanPush?: (json: string) => void }).__lanPush = (
      json: string
    ) => {
      try {
        BrowserContainer.lanPushCache = String(json || "")
      } catch {
        /* 忽略 */
      }
    }
  }

  private readInitialLanDetail(): { label: string; value: string; hint?: string } {
    const empty: { label: string; value: string; hint?: string } = {
      label: "房间状态",
      value: "正在获取本机 IP…",
    }
    try {
      const w = globalThis as unknown as {
        __lan?: { lanInfo?: () => string; lanIp?: () => string }
      }
      const bridge = w.__lan
      // v1.3.72：优先主通道（bridge.lanInfo 拉取）；bridge 方法缺失或抛异常时，
      // 回退到 Java 主动推送的缓存（lanPushCache）。两者都拿不到才返回占位，
      // 由 scheduleIpPoll 继续轮询——**不再写死「App 版本过低」死胡同**
      // （v1.3.71 用户装了最新版却仍看到该死文案，正是注解 retention 写错所致，
      // 现已修复，这里也去掉死胡同，改为等待推送/轮询）。
      if (bridge && typeof bridge.lanInfo === "function") {
        const raw = String(bridge.lanInfo() || "")
        if (raw) return BrowserContainer.detailFromRaw(raw)
      }
      if (bridge && typeof bridge.lanIp === "function") {
        const raw = String(bridge.lanIp() || "")
        if (raw) return { label: "本机房间 IP", value: raw }
      }
      // 主通道无效 → 回退推送缓存
      if (BrowserContainer.lanPushCache) {
        return BrowserContainer.detailFromRaw(BrowserContainer.lanPushCache)
      }
      // 连缓存都没有：浏览器调试 / bridge 尚未就绪，返回占位等轮询
      if (!bridge) {
        return {
          label: "本机 IP 不可用",
          value: "没检测到 JSBridge 桥接",
          hint: "请用本游戏的安卓 APK，不要在普通浏览器里测试",
        }
      }
      return empty
    } catch (e) {
      // 主通道抛异常：尝试缓存，缓存也没有就占位
      if (BrowserContainer.lanPushCache) {
        try {
          return BrowserContainer.detailFromRaw(BrowserContainer.lanPushCache)
        } catch {
          /* fallthrough */
        }
      }
      return {
        label: "本机 IP 不可用",
        value: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        hint: "JSBridge 调用异常，请返回菜单重新建房",
      }
    }
  }

  /** v1.3.72：从 lanInfo JSON 串按分级产出 detail（IP / 错误 / 未连 Wi-Fi / 未分配）。 */
  private static detailFromRaw(raw: string): {
    label: string
    value: string
    hint?: string
  } {
    let parsed: {
      ip?: string
      hasWifiIface?: boolean
      error?: string
      iface?: string
    }
    try {
      parsed = JSON.parse(raw) as typeof parsed
    } catch {
      // 旧版 lanIp() 只返回纯 IP 字符串，不是 JSON
      return { label: "本机房间 IP", value: raw }
    }
    const ip = parsed.ip ?? ""
    if (ip) return { label: "本机房间 IP", value: ip }
    if (parsed.error) {
      return {
        label: "取本机 IP 失败",
        value: parsed.error,
        hint: "请确认手机已连 Wi-Fi，然后返回菜单重新建房",
      }
    }
    if (parsed.hasWifiIface === false) {
      return {
        label: "未连接 Wi-Fi",
        value: "没检测到无线网络",
        hint: "局域网对战需要两台手机连同一个 Wi-Fi。请连上后返回菜单重新建房",
      }
    }
    return {
      label: "Wi-Fi 未分配 IP",
      value: "接口已连接但没拿到 IPv4",
      hint: "请到 设置 → Wi-Fi → 当前网络 查看 IP 地址，把地址告诉对手；或重启 Wi-Fi 后重进",
    }
  }

  private initLocalGame(scoreReporter: ScoreReporter) {
    // 单机练习：不创建任何网络中继
    this.messageRelay = null
    this.container = this.createContainer(scoreReporter)
    // v1.1.24：同上，容器一建好立刻跑渲染循环
    this.container.animate(performance.now())
    this.container.init()
    this.container.notify({
      type: "Info",
      title: ruleName(this.ruletype),
      subtext: "自由练习",
      extra: "祝你好运",
    } as const)
  }

  onAssetsReady() {
    // v1.1.58：3D 资源就绪，给 body 加 .game-ready，让 #panel 与 .view3d-loading
    // 同步淡入/淡出，消除「带底部栏的中间页 → 跳转游戏界面」的两个页面错觉。
    document.body.classList.add("game-ready")

    // v1.1.10：资源就绪，淡出 Loading 覆盖层（消除 GLTF 异步加载期间的黑屏窗口）
    const loading = document.getElementById("view3dLoading")
    if (loading) {
      loading.classList.add("is-hidden")
      // 淡出动画结束后彻底移除，避免遮挡 pointer events
      setTimeout(() => loading.remove(), 500)
    }

    const scoreReporter = new ScoreReporter()

    if (this.botMode) {
      this.initBotMode(scoreReporter)
    } else if (this.lanMode) {
      this.initLanMode(scoreReporter)
    } else {
      this.initLocalGame(scoreReporter)
    }

    // v1.1.24：animate() 已在 initLocalGame/initBotMode 内 createContainer 后立即启动，
    // 此处删掉冗余调用，避免双 rAF 调度导致 loop 计数翻倍 / 场景双倍速前进。

    // 余下 setup（broadcast/cushionModel/replayLink/initGameLoop）若抛异常，
    // 不应再把渲染循环拖死——吃掉异常并打印到 console，画面照常刷新。
    try {
      this.container.broadcast = (e) => {
        this.broadcast(e)
      }
      this.container.table.cushionModel = this.cushionModel
      this.setReplayLink()
      this.initGameLoop()
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)
      console.error("[Billiards] onAssetsReady setup failed:", msg)
    }

    globalThis.container = this.container
  }

  /**
   * 离线版开局：
   * - 回放模式：直接播放存档
   * - 单人练习：直接开球
   * - 人机对战：由本地 BotRelay 在 subscribe 时推送 BeginEvent 开局
   */
  private initGameLoop() {
    if (this.replay) {
      this.startReplay(this.replay)
    } else if (this.container.isSinglePlayer) {
      this.container.eventQueue.push(new BreakEvent())
    }
  }

  /**
   * 接收本地 Bot 中继发来的事件（离线版唯一的事件来源）
   */
  netEvent(e: string) {
    const event = EventUtil.fromSerialised(e)
    const session = Session.getInstance()
    if (event.clientId === session.clientId) {
      return
    }
    if (!session.vsNotificationShown) {
      this.container.notification.clear()
    }
    if (event.clientId) {
      session.setOpponentClientId(event.clientId)
    }
    this.container.eventQueue.push(event)
  }

  /**
   * 离线版只把事件交给本地 Bot 中继；纯练习模式下没有中继，直接丢弃
   */
  broadcast(event: GameEvent) {
    if (this.messageRelay) {
      event.clientId = Session.getInstance().clientId
      event.playername = Session.getInstance().playername
      this.messageRelay.publish(this.tableId, EventUtil.serialise(event))
    }
  }

  setReplayLink() {
    const url = globalThis.location.href.split("?")[0]
    const prefix = `${url}?ruletype=${this.ruletype}&state=`
    this.container.linkFormatter.replayUrl = prefix
  }

  startReplay(replay) {
    this.breakState = this.parse(replay)
    const session = Session.getInstance()
    if (this.breakState.players) {
      session.playername = this.breakState.players.player1
      session.opponentName = this.breakState.players.player2
    }
    const orderedScores = session.orderedScoresForHud()
    this.container.updateScoreHud(orderedScores.p1, orderedScores.p2, 0, 0)
    const breakEvent = new BreakEvent(
      this.breakState.init,
      this.breakState.shots
    )
    this.container.eventQueue.push(breakEvent)
  }

  parse(s) {
    try {
      return JSON.parse(s)
    } catch {
      return JSON.parse(JSONCrush.uncrush(s))
    }
  }

  offerUpload() {
    // 离线版不上传成绩
  }
}
