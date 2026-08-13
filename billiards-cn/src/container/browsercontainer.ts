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
import { ThreeCushionConfig } from "../utils/threecushionconfig"
import { Session } from "../network/client/session"
import { MessageRelay } from "../network/client/messagerelay"
import { BotRelay } from "../network/bot/botrelay"
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
    // 电脑对战每回合倒计时：参数 ?timer=N（N 秒），0 表示无限制
    const timerParam = Number.parseInt(params.get("timer") ?? "0", 10)
    if (this.botMode) {
      this.turnTimer.configure(timerParam > 0 ? timerParam : 0)
    } else {
      this.turnTimer.configure(0)
    }
    this.practiceMode = params.has("practice")
      ? params.get("practice") !== "false"
      : !this.botMode
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
      // v1.1.31：稳健对手改名为「电脑」，与菜单按钮保持一致
      Session.getInstance().opponentName =
        this.botName === "TheFarJaw" ? "电脑 · 激进" : "电脑"
    }
    applyPhysicsParams(params)
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
      isSinglePlayer: !this.botMode && !this.replay,
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
        if (
          stateTableSize !== undefined &&
          stateTableSize !== 10 &&
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
    const botLabel =
      this.botName === "TheFarJaw" ? "电脑 · 激进" : "电脑 · 稳健"
    this.container.notify({
      type: "Info",
      title: ruleName(this.ruletype),
      subtext: `对战 ${botLabel}`,
      extra: "你先开球",
    } as const)
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
