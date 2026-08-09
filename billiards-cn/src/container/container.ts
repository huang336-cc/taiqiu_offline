import { Input } from "../events/input"
import { GameEvent } from "../events/gameevent"
import { Session } from "../network/client/session"
import { StationaryEvent } from "../events/stationaryevent"
import { Table } from "../model/table"
import { View } from "../view/view"
import { Init } from "../controller/init"
import { AimInputs } from "../view/dom/aiminputs"
import { Keyboard } from "../events/keyboard"
import { Sound } from "../view/sound"
import { Chat } from "../view/chat"
import { ChatEvent } from "../events/chatevent"
import { Throttle } from "../events/throttle"
import { Sliders } from "../view/sliders"
import { Recorder } from "../events/recorder"
import { LinkFormatter } from "../view/link-formatter"
import { Rules } from "../controller/rules/rules"
import { RuleFactory } from "../controller/rules/rulefactory"
import { ThreeCushionConfig } from "../utils/threecushionconfig"
import { Menu } from "../view/menu"
import { Comment } from "../view/comment"
import { Hud } from "../view/hud"
import { NotificationEvent } from "../events/notificationevent"
import { LobbyIndicator } from "../view/lobbyindicator"
import { MessageRelay } from "../network/client/messagerelay"
import { ScoreReporter } from "../network/client/scorereporter"
import {
  Notification,
  NotificationData,
  NotificationActionHandlers,
} from "../view/notification"
import { ScoreEvent } from "../events/scoreevent"
import { ContainerConfig } from "./containerconfig"
import { Controller } from "../controller/controller"
import { ParticleSystem } from "../view/particle-system"
import { End } from "../controller/end"
import { Replay } from "../controller/replay"
import { Aim } from "../controller/aim"
import { PlaceBall } from "../controller/placeball"
import { PlayShot } from "../controller/playshot"
import { WatchAim } from "../controller/watchaim"
import { WatchShot } from "../controller/watchshot"
import { BallTray } from "../view/ball-tray"
import { ExportUtils } from "../utils/export-utils"
import { TurnTimer } from "../utils/turntimer"
import { ConcedeEvent } from "../events/concedeevent"

type ActivePlayer = 0 | 1 | 2

/**
 * Model, View, Controller container.
 */
export class Container {
  table: Table
  particles: ParticleSystem
  view: View
  controller: Controller
  inputQueue: Input[] = []
  eventQueue: GameEvent[] = []
  keyboard?: Keyboard
  sound: Sound
  chat: Chat
  sliders: Sliders
  recorder: Recorder
  linkFormatter: LinkFormatter
  ballTray: BallTray
  id: string
  isSinglePlayer: boolean = true
  rules: Rules
  menu: Menu
  comment: Comment
  hud: Hud
  notification: Notification
  lobbyIndicator: LobbyIndicator
  replayMode: boolean = false
  examMode: boolean = false
  relay: MessageRelay | null = null
  scoreReporter: ScoreReporter | null = null
  frame: (timestamp: number) => void
  turnTimer: TurnTimer = new TurnTimer()
  /** 标记上一次 updateController 时玩家是否在场上（用于启停计时器） */
  private wasPlayerTurn: boolean = false
  /** Multiplier applied to real elapsed time before it's converted to physics
   * steps in `advance()`. 1 everywhere except the shot-analysis view, which
   * sets this higher so shot playback feels snappier without changing the
   * fixed physics step (`this.step`) and therefore without affecting
   * simulation accuracy. */
  timeScale = 1

  private hudScores = {
    p1: 0,
    p2: 0,
  }
  private hudActivePlayer: ActivePlayer = 0
  private wasReplay: boolean = false

  lastShotInit?: string
  lastShotData?: string

  last = performance.now()
  readonly step = 0.001953125 * 1

  broadcast: (event: GameEvent) => void = () => {}
  log: (text: string) => void

  constructor(config: ContainerConfig) {
    const {
      element,
      log,
      assets,
      ruletype,
      keyboard,
      id,
      relay = null,
      scoreReporter = null,
      replayMode = false,
      isSinglePlayer = true,
    } = config
    this.log = log
    this.replayMode = replayMode
    this.examMode = config.examMode ?? false
    this.isSinglePlayer = isSinglePlayer
    this.rules = RuleFactory.create(ruletype, this)
    this.table = this.rules.table()
    this.view = new View(element, this.table, assets)
    // v1.1.25：View 已建（renderer 已 OK），后续 setup（Hud/Notification/Menu/
// LobbyIndicator 等 DOM 依赖 + 资源相关）任一行抛异常都会让 createContainer()
// throw、this.container 没赋值、animate() 永远跑不到。整块包 try/catch，
// 错误上报诊断浮层，构造器总能返回，至少能跑渲染循环看到画面。
try {
    this.table.cue.aimInputs = new AimInputs(this)
    if (keyboard) {
      this.keyboard = keyboard
      // item 1：画布拖动的按下/松手直接驱动辅助线显隐
      keyboard.onDragStart = () => {
        const cue = this.table.cue
        if (!cue.aimInputs || cue.aimInputs.isDisabled()) return
        cue.beginAimInteraction()
      }
      keyboard.onDragEnd = () => {
        this.table.cue.endAimInteraction()
      }
    }
    this.sound = assets.sound
    this.chat = new Chat(this.sendChat)
    this.sliders = new Sliders()
    this.linkFormatter = new LinkFormatter(this)
    this.ballTray = new BallTray(this)
    this.recorder = new Recorder(this, this.linkFormatter)
    this.id = id ?? ""
    this.menu = new Menu(this)
    this.comment = new Comment(this)
    this.table.addToScene(this.view.scene)
    this.view.onLineDrawn = (line) => {
      this.sendEvent(new ChatEvent(this.id, "", line))
    }
    this.view.onBallTap = (ball) => {
      const cue = this.table.cue
      if (!cue.aimInputs || cue.aimInputs.isDisabled()) return
      cue.aimAtNext(this.table.cueball, ball)
      // 点球对准是瞬时操作，没有松手事件，给一个短暂的辅助线可见窗口
      cue.flashAimInteraction()
      cue.rotateAim(0, this.table)
      cue.updateAimInput()
      this.lastEventTime = performance.now()
    }
    // 让球杆能访问 View（用于判断相机模式，控制辅助线显示 / 实时换肤）
    this.table.cue.view = this.view
    const tableSize = parseFloat(
      new URLSearchParams(globalThis.location?.search ?? "").get("tableSize") ||
        "10"
    )
    this.particles = new ParticleSystem({ tableSize })
    this.hud = new Hud()
    this.notification = new Notification()
    this.relay = relay
    this.scoreReporter = scoreReporter
    this.lobbyIndicator = new LobbyIndicator(
      Session.getInstance().botMode,
      this.replayMode,
      this.rules,
      (msg) => this.chat.showMessage(msg),
      config.messagingUrl,
      (url) => this.menu.showOverlay(url)
    )
    this.updateController(new Init(this))
    //  this.updateController(new End(this))
} catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : ""
    console.error("[Container] post-view setup failed:", msg, stack)
}
  }

  init() {
    if (location.port !== "8081" && this.lobbyIndicator) {
      this.lobbyIndicator.init()
    }
  }

  sendChat = (msg) => {
    this.sendEvent(new ChatEvent(this.id, msg))
  }

  throttle = new Throttle(250, (event) => {
    this.broadcast(event)
  })

  sendEvent(event) {
    this.recorder.record(event)
    this.throttle.send(event)
  }

  private myHudSlot(): 1 | 2 {
    return Session.getInstance().playerIndex === 1 ? 2 : 1
  }

  private opponentHudSlot(): 1 | 2 {
    return this.myHudSlot() === 1 ? 2 : 1
  }

  inferActivePlayer(controller: Controller = this.controller): ActivePlayer {
    if (
      controller instanceof Aim ||
      controller instanceof PlaceBall ||
      controller instanceof PlayShot
    ) {
      return this.myHudSlot()
    }
    if (controller instanceof WatchAim || controller instanceof WatchShot) {
      return this.opponentHudSlot()
    }
    return 0
  }

  setHudActivePlayer(active: ActivePlayer) {
    this.hudActivePlayer = active
    this.hud.setActivePlayer(active)
  }

  updateScoreHud(p1: number, p2: number, b: number, active?: ActivePlayer) {
    const session = Session.getInstance()
    session.updateScoresFromNetwork(p1, p2, b)
    const orderedScores = session.orderedScoresForHud()
    this.hudScores = orderedScores
    const orderedNames = session.orderedNamesForHud()

    // Format handicap append next to player names
    const isHandicapRule =
      this.rules.rulename === "sagu" || this.rules.rulename === "threecushion"
    const handicaps = session.getHandicaps()
    const hasHandicaps = isHandicapRule && Object.keys(handicaps).length > 0

    let p1Target = ThreeCushionConfig.raceTo
    let p2Target = ThreeCushionConfig.raceTo

    if (hasHandicaps) {
      const p1ClientId =
        session.playerIndex === 0
          ? session.clientId
          : (session.opponentClientId ?? "opponent")
      const p2ClientId =
        session.playerIndex === 0
          ? (session.opponentClientId ?? "opponent")
          : session.clientId

      p1Target = session.getRaceTargetForPlayer(p1ClientId)
      p2Target = session.getRaceTargetForPlayer(p2ClientId)

      if (orderedNames.p1Name) {
        orderedNames.p1Name = `${orderedNames.p1Name}(${p1Target})`
      }
      if (orderedNames.p2Name) {
        orderedNames.p2Name = `${orderedNames.p2Name}(${p2Target})`
      }
    }

    if (this.rules.rulename === "eightball" && session.p1type !== 0) {
      const typeLabel = session.p1type === 1 ? "solids" : "stripes"
      const mySlot = session.playerIndex === 0 ? "p1Name" : "p2Name"
      if (orderedNames[mySlot]) {
        orderedNames[mySlot] = `${orderedNames[mySlot]}(${typeLabel})`
      }
    }
    const hideScore = this.rules.hideScoreHud?.() ?? false
    const isSagu = this.rules.rulename === "sagu"
    const p1Star = isSagu && orderedScores.p1 === p1Target - 1
    const p2Star = isSagu && orderedScores.p2 === p2Target - 1

    this.hud.updateScores(
      orderedScores.p1,
      orderedScores.p2,
      orderedNames.p1Name,
      orderedNames.p2Name,
      hideScore ? 0 : b,
      hideScore,
      p1Star,
      p2Star
    )
    this.setHudActivePlayer(active ?? this.inferActivePlayer())
  }

  sendScoreUpdate(p1: number, p2: number, b: number, active?: ActivePlayer) {
    const activePlayer = active ?? this.inferActivePlayer()
    const changed =
      this.hudScores.p1 !== p1 ||
      this.hudScores.p2 !== p2 ||
      Session.getInstance().currentBreak !== b ||
      this.hudActivePlayer !== activePlayer
    this.updateScoreHud(p1, p2, b, activePlayer)
    if (changed) {
      this.sendEvent(new ScoreEvent(p1, p2, b, activePlayer))
    }
  }

  notify(data: NotificationData | string, duration?: number) {
    this.notification.show(data, duration)
    this.sendEvent(new NotificationEvent(data, duration))
  }

  notifyLocal(
    data: NotificationData | string,
    duration?: number,
    actionHandlers?: NotificationActionHandlers
  ) {
    this.notification.show(data, duration, actionHandlers)
  }

  advance(elapsed) {
    this.frame?.(elapsed)

    const steps = Math.floor((elapsed * this.timeScale) / this.step)
    const computedElapsed = steps * this.step
    const stateBefore = this.table.allStationary()
    for (let i = 0; i < steps; i++) {
      this.table.advance(this.step)
    }
    this.table.updateBallMesh(computedElapsed)
    this.view.update(computedElapsed, this.table.cue.aim)
    // v1.2.2：刷新积分牌下方的「已进球」整颗球（仅在落袋集合变化时重建 DOM）
    this.hud.updatePocketedBalls(this.table)
    this.table.cue.update(computedElapsed)
    this.particles.update(computedElapsed)
    if (!stateBefore && this.table.allStationary()) {
      this.eventQueue.push(new StationaryEvent())
      this.table.cue.hittingAnimation = false
    }
    this.sound.processOutcomes(this.table.outcome)
  }

  processEvents() {
    if (this.keyboard) {
      const inputs = this.keyboard.getEvents()
      inputs.forEach((i) => this.inputQueue.push(i))
    }

    while (this.inputQueue.length > 0) {
      this.lastEventTime = this.last
      const input = this.inputQueue.shift()
      input && this.updateController(this.controller.handleInput(input))
    }

    // only process events when stationary
    if (this.table.allStationary()) {
      const event = this.eventQueue.shift()
      if (event) {
        this.lastEventTime = performance.now()
        this.recorder.record(event)
        this.updateController(event.applyToController(this.controller))
      }
    }
  }

  lastEventTime = performance.now()

  animate(timestamp): void {
    // 关键：先调度下一帧，再执行业务。否则一旦本帧 render()/物理/相机更新
    // 抛出未捕获异常，requestAnimationFrame 就不会再被调用，动画循环永久死亡，
    // 画面冻结为黑屏。先调度可保证任何单帧异常都不会中断渲染循环。
    requestAnimationFrame((t) => {
      this.animate(t)
    })

    try {
      const dt = (timestamp - this.last) / 1000
      this.advance(dt)
      this.last = timestamp
      this.processEvents()
      const needsRender =
        timestamp < this.lastEventTime + 60000 ||
        !this.table.allStationary() ||
        this.view.sizeChanged()
      if (needsRender) {
        this.view.render()
      }
      // 电脑对战每回合倒计时（仅 vs 电脑 + 配置了 timer 时生效）
      if (this.turnTimer.enabled()) {
        const r = this.turnTimer.tick(dt)
        if (r.justExpired) {
          this.notification.show(
            {
              type: "Info",
              title: "本回合超时",
              subtext: "系统判本局负",
              duration: 2200,
            },
            0,
            {}
          )
          this.eventQueue.push(new ConcedeEvent())
        }
      }
    } catch (e) {
      // 单帧异常不应中断循环（否则会表现为「永久黑屏」）。
      // 错误仅打印到 console（v1.1.28 已移除诊断浮层）。
      const msg = e instanceof Error ? e.message : String(e)
      console.error("animate loop error:", msg, e)
    }
  }

  updateLastShot() {
    const snapshot = ExportUtils.captureSnapshot(this.table)
    this.lastShotInit = snapshot.init
    this.lastShotData = snapshot.shot
  }

  updateController(controller: Controller) {
    this.wasReplay = this.wasReplay || controller instanceof Replay
    if (controller !== this.controller) {
      // a     const playerName = Session.getInstance().playername
      // b     this.log(`${playerName}: Transition to ${controller.name}`)
      this.controller = controller
      const active = this.inferActivePlayer(controller)
      if (
        active !== 0 ||
        controller instanceof Init ||
        controller instanceof End
      ) {
        this.setHudActivePlayer(active)
      }
      // 离线版：分享/图解/分析都依赖外部网站，一律隐藏
      this.menu?.setShareVisible(false)
      this.menu?.setDiagramVisible(false)
      this.menu?.setAnalysisVisible(false)
      // 人机对战时允许认输，练习和回放模式不需要
      this.menu?.setConcedeVisible(Session.isBotMode() && !this.replayMode)
      // 离线版没有聊天对象
      this.comment?.setVisible(false)

      this.controller.onFirst()

      // 电脑对战每回合倒计时：根据 controller 启停
      this.applyTurnTimerForController(controller)
    }
  }

  /**
   * 当 controller 是「玩家在打」的阶段时启动倒计时，其它阶段停止。
   * 玩家回合包括 Aim（瞄准 / 击球）与 PlaceBall（自由球摆位）。
   */
  private applyTurnTimerForController(controller: Controller) {
    if (!this.turnTimer.enabled()) {
      this.turnTimer.stop()
      this.wasPlayerTurn = false
      return
    }
    const isPlayerTurn =
      controller instanceof Aim ||
      controller instanceof PlaceBall ||
      (controller as any).constructor?.name === "Aim"
    if (isPlayerTurn && !this.wasPlayerTurn) {
      this.turnTimer.start()
      this.wasPlayerTurn = true
    } else if (!isPlayerTurn && this.wasPlayerTurn) {
      this.turnTimer.stop()
      this.wasPlayerTurn = false
    }
  }
}
