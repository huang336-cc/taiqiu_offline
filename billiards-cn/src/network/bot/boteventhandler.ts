import { GameEvent } from "../../events/gameevent"
import { Outcome } from "../../model/outcome"
import { Logger } from "./logger"
import { Container } from "../../container/container"
import { EventType } from "../../events/eventtype"
import { AimCalculator } from "./aimcalculator"
import { StartAimEvent } from "../../events/startaimevent"
import { PlaceBallEvent, RespotBody } from "../../events/placeballevent"
import { WatchEvent } from "../../events/watchevent"
import { EventUtil } from "../../events/eventutil"
import { Respot } from "../../utils/respot"
import { Session } from "../client/session"
import { Ball } from "../../model/ball"
import { Vector3 } from "three"
import { Rules } from "../../controller/rules/rules"
import { RuleFactory } from "../../controller/rules/rulefactory"
import { Professional } from "./strategies/professional"
import { chooseBallInHandPosition as pickBallInHandSpot } from "./decision/ballinhand"
import { TableGeometry } from "../../view/tablegeometry"
import { Snooker } from "../../controller/rules/snooker"
import { SnookerUtils } from "../../controller/rules/snookerutils"
import { isFirstShot } from "../../utils/utils"
import { BotShotContext, BotStrategy } from "./botstrategy"
import {
  DifficultyProfile,
  difficultyFor,
} from "./difficulty"
import { ClawBreak } from "./strategies/clawbreak"
import { TheFarJaw } from "./strategies/thefarjaw"
import { t, foulReason as translateFoul } from "../../utils/i18n"

class BotContainer {
  table
  recorder
  notify() {}
  sendEvent() {}
  // v1.3.59：playSuccess 空壳一并删除 —— Sound 类已无此方法
  sound = {}
  isSinglePlayer = false

  constructor(container: Container) {
    this.table = container.table
    this.recorder = container.recorder
  }
}

export class BotEventHandler {
  private readonly logs: Logger
  private readonly container: Container
  private readonly publishSequenceToPlayer: (
    events: GameEvent[],
    delay?: number
  ) => void
  protected enqueueMessage: (message: string) => void
  private readonly calculator: AimCalculator
  private readonly strategy: BotStrategy
  /** v1.3.58：本局电脑的难度档位参数（瞄准噪声 / 力度抖动 / 各项能力开关） */
  private readonly profile: DifficultyProfile
  protected readonly botRules: Rules
  private shouldStartTurnOnNextControl = false
  private queuedOwnStartAim = false
  /** v1.3.65：bot 侧「本杆是否开球杆」快照。必须在出杆前（handleStartAim /
   * handlePlaceBall）用 isFirstShot 抓取——那一刻 recorder 还没有本杆的 AIM
   * 记录，判断准确；球停后（handleStationary）recorder 已含本杆 AIM，
   * isFirstShot 恒为 false，不能直接用。开球杆进球不分花色（球桌保持开放），
   * 与玩家侧 eightball.ts 的 firstShotPlayed 守卫对称。 */
  private thisShotIsBreak = false

  constructor(
    logs: Logger,
    container: Container,
    publishSequenceToPlayer: (events: GameEvent[], delay?: number) => void,
    enqueueMessage: (message: string) => void
  ) {
    this.logs = logs
    this.container = container
    this.publishSequenceToPlayer = publishSequenceToPlayer
    this.enqueueMessage = enqueueMessage
// v1.3.58：难度不再只是一个 bot 名字字符串 —— 先取本档参数表，
// 再用它构造瞄准计算器与策略，三档才有真实的强弱差异（见 difficulty.ts）。
// 旧代码写死 `new AimCalculator()`（noiseScale 恒为 1）且策略不带任何参数，
// 于是三档出杆策略几乎一致，只剩「打袋口 / 满力打袋角」的区别。
const botName =
new URLSearchParams(globalThis.location.search).get("bot") ?? "ClawBreak"
this.profile = difficultyFor(botName)
this.calculator = new AimCalculator()
this.strategy =
botName === "TheFarJaw"
? new TheFarJaw(this.profile)
: botName === "Professional"
? new Professional(this.profile)
: new ClawBreak(this.profile)
    this.botRules = RuleFactory.create(
      container.rules.rulename,
      new BotContainer(container)
    )
    if (
      container.rules.rulename === "threecushion" ||
      container.rules.rulename === "sagu"
    ) {
      this.botRules.cueball = this.container.table.balls[1]
    }
  }

  /**
   * Main entry point for the bot to handle game events.
   */
  public handle(event: GameEvent): void {
    this.logs.info(`Bot handling event: ${event.type}`)
    switch (event.type) {
      case EventType.STARTAIM:
        if (!this.queuedOwnStartAim) {
          this.shouldStartTurnOnNextControl = true
        }
        this.queuedOwnStartAim = false
        this.handleStartAim()
        break
      case EventType.PLACEBALL:
        this.shouldStartTurnOnNextControl = true
        this.handlePlaceBall(event as PlaceBallEvent)
        break
      case EventType.BEGIN:
        this.handleStationary()
        break
    }
  }

  /**
   * The balls have finished rolling after a shot. Bot applies rules to decide the next action.
   */
  private handleStationary(): void {
    const outcome = this.container.table.outcome
    const botType = this.botType()
    if (this.container.rules.isEndOfGame(outcome, botType)) {
      this.handleGameEnd()
      return
    }
    const foulReason = this.botRules.foulReason(outcome, botType)
    if (foulReason) {
      this.logs.info(`Bot foul: ${foulReason}`)
      if (this.handleEightBallFoul(outcome)) {
        this.botRules.advanceState?.(outcome)
        return
      }
      this.handleFoul(foulReason, outcome)
      this.botRules.advanceState?.(outcome)
      return
    }
    const pots = this.botRules.getAmountScored(outcome)
    this.logs.info(
      `Bot handleStationary: cueball=${this.botRules.cueball?.id}, pots=${pots}, outcomeLen=${outcome.length}`
    )
    if (
      this.container.rules.rulename !== "threecushion" &&
      this.container.rules.rulename !== "sagu"
    ) {
      this.botRules.advanceState?.(outcome)
    }
    if (pots > 0) {
      if (this.handleEightBallEarlyPot(outcome)) {
        return
      }
      // In snooker, don't respot colours once all reds have been potted
      const isSnooker = this.container.rules.rulename === "snooker"
      const redsOnTable = isSnooker
        ? SnookerUtils.redsOnTable(this.container.table)
        : []
      const shouldRespot = !isSnooker || redsOnTable.length > 0
      const respotted = shouldRespot ? this.botRules.respot(outcome) : []
      respotted.forEach((ball) => ball.fround())
      this.handlePot(pots, outcome)
      return
    }
    this.logs.hide()
    this.publishSequenceToPlayer([new StartAimEvent()])
  }

  private botType(): number {
    const p1type = Session.getInstance().p1type
    if (p1type === 1) return 2
    if (p1type === 2) return 1
    return 0
  }

  validTargetBalls(): Ball[] {
    switch (this.container.rules.rulename) {
      case "eightball":
        return this.validEightBallTargets(this.botType())
      case "nineball":
        return this.validNineBallTargets()
      case "snooker":
        return this.validSnookerTargets()
      case "threecushion":
        return this.validThreeCushionTargets()
      case "sagu":
        return this.validSaguTargets()
      default:
        return []
    }
  }

  private validEightBallTargets(botType: number): Ball[] {
    const cueball = this.container.table.cueball
    const balls = this.container.table.balls.filter(
      (ball) => ball !== cueball && ball.onTable()
    )

    if (botType === 0) {
      return balls.filter((ball) => ball.label !== 8)
    }

    const groupBalls = balls.filter((ball) =>
      this.isEightBallType(ball, botType)
    )
    if (groupBalls.length > 0) {
      return groupBalls
    }

    return balls.filter((ball) => ball.label === 8)
  }

  private isEightBallType(ball: Ball, type: number): boolean {
    if (type === 1) {
      return (ball.label ?? 0) >= 1 && (ball.label ?? 0) <= 7
    }
    if (type === 2) {
      return (ball.label ?? 0) >= 9 && (ball.label ?? 0) <= 15
    }
    return false
  }

  private validNineBallTargets(): Ball[] {
    const cueball = this.container.table.cueball
    const lowestBall = this.container.table.balls
      .filter((ball) => ball !== cueball && ball.onTable())
      .sort((a, b) => (a.label ?? 0) - (b.label ?? 0))[0]

    return lowestBall ? [lowestBall] : []
  }

  private validSnookerTargets(): Ball[] {
    if (isFirstShot(this.container.recorder)) {
      return []
    }

    const snookerRules = this.botRules as Snooker
    const table = this.container.table
    const redsOnTable = SnookerUtils.redsOnTable(table)
    const coloursOnTable = SnookerUtils.coloursOnTable(table)

    if (snookerRules.previousPotRed) {
      return coloursOnTable
    }
    if (redsOnTable.length > 0) {
      return redsOnTable
    }

    return coloursOnTable.length > 0 ? [coloursOnTable[0]] : []
  }

  private validThreeCushionTargets(): Ball[] {
    if (isFirstShot(this.container.recorder)) {
      return []
    }

    const cueball = this.container.table.balls[1]
    return this.container.table.balls.filter(
      (ball) => ball !== cueball && ball.onTable()
    )
  }

  private validSaguTargets(): Ball[] {
    if (isFirstShot(this.container.recorder)) {
      return []
    }

    const cueball = this.container.table.balls[1]
    const opponentCue = this.container.table.balls[0]
    return this.container.table.balls.filter(
      (ball) => ball !== cueball && ball !== opponentCue && ball.onTable()
    )
  }

  private handleGameEnd(forcedAmIWinner?: boolean): void {
    const session = Session.getInstance()
    let amIWinner: boolean
    if (forcedAmIWinner !== undefined) {
      amIWinner = forcedAmIWinner
    } else if (
      this.container.rules.rulename === "eightball" ||
      this.container.rules.rulename === "nineball"
    ) {
      // v1.3.57 修复「电脑赢了却显示玩家胜利」。
      // 旧判定 amIWinner = table.cueball.id === session.playerIndex 是从
      // 开伦类规则（threecushion/sagu：双方各有一个母球，母球 id=玩家序号）
      // 照搬来的；但八球/九球全桌只有一个母球（balls[0]，id=0），单机玩家
      // playerIndex 又恒为 0，于是 0 === 0 恒真 —— 无论这杆是谁出的，
      // 电脑合法打进黑八/九号获胜时也弹「你赢了」。
      // 能走到这个无参分支的只有一种情形：bot 出杆后球停（BEGIN 事件）
      // 触发 isEndOfGame 自然结束，出杆方是电脑 → 玩家必输。
      // （玩家出杆的自然结束走 PlayShot → rules.update() → handlePot，
      // 不经过这里；「电脑犯规送黑八判玩家赢」「玩家犯规判负」均显式
      // 传 forcedAmIWinner=true/false，走上面的分支，不受影响。）
      amIWinner = false
    } else {
      const { p1, p2 } = session.orderedScoresForHud()
      amIWinner = session.playerIndex === 0 ? p1 >= p2 : p2 >= p1
    }

    console.log("Bot handleGameEnd, amIWinner=" + amIWinner)
    console.log("Bot handleGameEnd, session", session)
    this.container.updateController(
      // here using player rules why?
      this.container.rules.handleGameEnd(amIWinner)
    )
  }

  private handleEightBallFoul(outcome: Outcome[]): boolean {
    if (this.container.rules.rulename !== "eightball") {
      return false
    }

    const table = this.container.table
    const cueball = table.cueball
    const eightBall = table.balls.find((b) => b.label === 8)
    if (!eightBall || !Outcome.pots(outcome).includes(eightBall)) {
      return false
    }

    const session = Session.getInstance()
    const hasObjectBallsRemaining = table.balls.some(
      (b) => b !== cueball && b.label !== 8 && b.onTable()
    )

    if (session.p1type !== 0 && hasObjectBallsRemaining) {
      const footSpot = new Vector3(TableGeometry.tableX / 2, 0, 0)
      Respot.respotBehind(footSpot, eightBall, table)
      eightBall.fround()
      this.handleFoul("8-ball pocketed early", [], [eightBall])
      return true
    }

    // v1.2.15：bot 犯规打进黑八且没有剩余目标球时，判玩家获胜。
    this.handleGameEnd(true)
    return true
  }

  private handleEightBallEarlyPot(outcome: Outcome[]): boolean {
    if (this.container.rules.rulename !== "eightball") {
      return false
    }

    const table = this.container.table
    const cueball = table.cueball
    const eightBall = table.balls.find((b) => b.label === 8)
    if (!eightBall || !Outcome.pots(outcome).includes(eightBall)) {
      return false
    }

    const session = Session.getInstance()
    const hasObjectBallsRemaining = table.balls.some(
      (b) => b !== cueball && b.label !== 8 && b.onTable()
    )

    if (session.p1type !== 0 && hasObjectBallsRemaining) {
      const footSpot = new Vector3(TableGeometry.tableX / 2, 0, 0)
      Respot.respotBehind(footSpot, eightBall, table)
      eightBall.fround()
      this.handleFoul("8-ball pocketed early", [], [eightBall])
      return true
    }

    return false
  }

  private handleFoul(
    foulReason: string,
    outcome: Outcome[],
    respottedOverride?: Ball[]
  ): void {
    const session = Session.getInstance()
    const cueball = this.container.table.cueball
    const isSnooker = this.container.rules.rulename === "snooker"
    const whitePotted = Outcome.isCueBallPotted(cueball, outcome)
    const ballInHand = !isSnooker || whitePotted

    // v1.3.18：bot 出杆犯规时若同帧打进合法球，按规则过滤后仍计入 bot 累计比分。
    // 与玩家端 eightball/nineball.handleFoul 对称：犯规（母球落袋）只损失球权，
    // 但本杆已落袋的合法球不丢。八号/九号球视规则被 respot 复位，不算分。
    const ruleName = this.container.rules.rulename
    if (ruleName === "eightball" || ruleName === "nineball") {
      const pots = Outcome.pots(outcome)
      const disallowedLabel = ruleName === "eightball" ? 8 : 9
      const foulScoredPots = pots.filter(
        (b) => b !== cueball && b.label !== disallowedLabel
      )
      if (foulScoredPots.length > 0) {
        session.addOpponentScore(foulScoredPots.length)
      }
    }

    if (isSnooker) {
      session.addMyScore(this.snookerFoulPoints(outcome))
    }

    if (this.container.rules.rulename === "sagu") {
      session.setOpponentScore(Math.max(0, session.opponentScore() - 1))
    }

    const { p1: s1, p2: s2 } = session.orderedScoresForHud()
    this.container.sendScoreUpdate(s1, s2, 0, this.myActivePlayer())

    this.container.notify({
      type: "Foul",
      title: t("foul"),
      subtext: translateFoul(foulReason),
      ...(ballInHand ? { extra: t("ballInHand") } : {}),
    })
    if (!ballInHand) {
      ;(respottedOverride ?? this.container.rules.respot(outcome)).forEach(
        (ball) => ball.fround()
      )
      this.publishSequenceToPlayer([new StartAimEvent()])
      return
    }
    if (!cueball.onTable()) {
      Respot.respotBehind(
        this.container.rules.placeBall(),
        cueball,
        this.container.table
      )
    }
    /**
     * ⚠️ v1.3.102 修复「电脑犯规玩家无法摆球」。
     *
     * 病史：本函数处理的是**电脑自己的犯规**（入口 `handleStationary` 里
     * `botRules.foulReason(outcome, botType)` 判的就是 bot 这一杆）。但旧实现
     * 在 ballInHand 分支里调 `chooseBallInHandPosition()` —— 那是「**我方**拿到
     * 自由球时给自己挑一个好点」的评估 —— 并把结果以
     * `PlaceBallEvent(startPos, respot, /*useStartPos* /true)` 发给玩家。
     *
     * `useStartPos=true` 在玩家侧 `WatchShot.handlePlaceBall` 的语义是
     * 「**位置已定**，直接落位、跳过交互」，于是玩家被锁在摆球流程外：
     * 看不到摆球提示、不能拖白球，白球被 AI 摆到**AI 自己挑的**点上直接开打。
     *
     * 语义上，犯规方应**交出球权**（与 `eightball.ts handleFoul` 对称）：
     *   · 玩家犯规 → 发 `PlaceBallEvent(startPos, …, true)` 给 AI → AI 自己挑点
     *     （`botballinhand.ts` 已覆盖这条）
     *   · **电脑犯规 → 必须让玩家拿到自由球** → 这里改发 `useStartPos=false`，
     *     玩家侧据此进入**交互式** `PlaceBall`，由玩家自己拖拽白球。
     *
     * 注意 `startPos` 仍然有意义：它是玩家侧的**初始落点**（母球当前位或
     * 规则默认点），交互式 PlaceBall 会以它为起点让玩家微调。
     */
    const startPos =
      cueball.onTable() && !cueball.offTable
        ? cueball.pos.clone()
        : this.container.rules.placeBall()
    cueball.setStationary()
    const respotted = respottedOverride ?? this.container.rules.respot(outcome)
    let respot: RespotBody | undefined
    if (respotted.length > 0) {
      respot = { id: respotted[0].id, pos: respotted[0].pos.clone() }
    }
    this.publishSequenceToPlayer([new PlaceBallEvent(startPos, respot, false)])
  }

  private snookerFoulPoints(outcome: Outcome[]): number {
    const snookerRules = this.botRules as Snooker
    const info = SnookerUtils.shotInfo(
      this.container.table,
      outcome,
      snookerRules.targetIsRed,
      snookerRules.previousPotRed
    )
    return SnookerUtils.calculateFoul(outcome, info).points
  }

  private myActivePlayer(): 1 | 2 {
    return (Session.getInstance().playerIndex + 1) as 1 | 2
  }

  /**
   * v1.2.5：玩家犯规后电脑获得「自由摆球」（ball in hand）。
   * 不再只放到默认开球线位置，而是在整张球桌上搜索一个「合法（不与任何球重叠）且
   * 能对准目标球」的最佳点：优先选一条能直球命中目标球、距离适中（约 0.5m）的落点，
   * 让电脑像玩家一样自由摆球并争取好球型。
   *
   * v1.3.93：整体重写 —— 交给 `decision/ballinhand.ts`。
   *
   * 旧实现（就地 14×14 网格 + `1/(1+|d−0.5m|)` 打分）只判「不与球重叠」和
   * 「视线不被挡」，**完全不看能不能进球、打完母球停哪、会不会摔袋、下一杆好不好打**。
   * 用户反馈「AI 拿到自由球在乱摆白球」就是这个 —— 摆的位置几何上合法，战术上常是坏签。
   *
   * 新实现复用 decision/ 下已打磨的评估链（enumerateCandidates / refineStopsPhysics /
   * evaluatePosition / evalThreat），与 AI 实际出杆用**同一套判据**，不存在
   * 「以为好、真打时才发现打不进」的脱节。
   */
  private chooseBallInHandPosition(): Vector3 {
    const table = this.container.table
    try {
      const choice = pickBallInHandSpot(
        table,
        this.validTargetBalls(),
        this.profile,
        this.calculator,
        this.buildShotContext(),
        () => this.container.rules.placeBall()
      )
      this.logs.info(
        `Bot ball-in-hand: 选定 (${choice.pos.x.toFixed(3)}, ${choice.pos.y.toFixed(3)}) ` +
          `评分=${choice.score.toFixed(3)} 最难/最易杆难度=${choice.easiestDifficulty.toFixed(2)} ` +
          `摔袋=${choice.risky ? "是" : "否"} 精算点数=${choice.evaluated}`
      )
      return choice.pos
    } catch (e) {
      // 评估链任何一环出错都不应让 AI 卡在这一步 —— 退回规则默认点，
      // 保证「拿自由球后一定能出杆」这个底线。
      this.logs.info(
        `Bot ball-in-hand 评估失败，退回默认点: ${e instanceof Error ? e.message : String(e)}`
      )
      return this.container.rules.placeBall()
    }
  }

  private handlePot(pots: number, outcome: Outcome[]): void {
    this.logs.info(
      `Bot handlePot: scored ${pots} points. Next cueball=${this.botRules.cueball?.id}`
    )
    const session = Session.getInstance()
    session.addOpponentScore(pots)
    this.botRules.currentBreak += pots
    this.assignEightBallType(session, outcome)

    if (
      this.container.rules.rulename === "snooker" &&
      this.botRules.isEndOfGame(outcome, this.botType())
    ) {
      this.handleGameEnd()
      return
    }

    const { p1: s1, p2: s2 } = session.orderedScoresForHud()
    this.container.sendScoreUpdate(
      s1,
      s2,
      0,
      this.container.inferActivePlayer()
    )
    this.publishSequenceToPlayer([
      new WatchEvent(this.container.table.serialise()),
    ])
    this.queuedOwnStartAim = true
    this.enqueueMessage(EventUtil.serialise(new StartAimEvent()))
  }

  private assignEightBallType(session: Session, outcome: Outcome[]): void {
    if (session.p1type !== 0 || this.container.rules.rulename !== "eightball") {
      return
    }
    // v1.3.65：开球杆进球不分配花色，球桌保持开放——与玩家侧
    // eightball.ts 的 firstShotPlayed 守卫对称。否则电脑开球蹭进一颗
    // 全色就被立刻定组，剩下全是难打的球型，进而逼出「场上还有目标球
    // 却直接打黑八」的怪行为（用户报告的专业档 AI 缺陷之一）。
    if (this.thisShotIsBreak) {
      return
    }
    const pottedBalls = Outcome.pots(outcome)
    const hasSolid = pottedBalls.some(
      (b) => (b.label ?? 0) >= 1 && (b.label ?? 0) <= 7
    )
    const hasStripe = pottedBalls.some(
      (b) => (b.label ?? 0) >= 9 && (b.label ?? 0) <= 15
    )
    if (hasSolid && !hasStripe) {
      session.p1type = 2
    } else if (hasStripe && !hasSolid) {
      session.p1type = 1
    }
  }

  private handleStartAim(): void {
    this.startTurnIfNeeded()
    // v1.3.65：出杆前快照「本杆是否开球杆」，供 assignEightBallType 守卫使用。
    this.thisShotIsBreak = isFirstShot(this.container.recorder)
    this.logs.show()
    this.container.table.cue.aim.elevation = 0
    this.publishSequenceToPlayer(this.aim())
  }

  private handlePlaceBall(event: PlaceBallEvent): void {
    this.startTurnIfNeeded()
    // v1.3.65：与 handleStartAim 一致——这里也会直接出杆（ball in hand），
    // 出杆前同样要快照「本杆是否开球杆」。
    this.thisShotIsBreak = isFirstShot(this.container.recorder)
    const table = this.container.table

    if (event.respot) {
      const ball = table.balls.find((b) => b.id === event.respot?.id)
      if (ball) {
        ball.pos.copy(event.respot.pos)
        ball.setStationary()
        ball.fround()
      }
    }

    const cueball = table.cueball

    /**
     * v1.3.95：拿到自由球时要**自己挑一个好位置**，而不是照着 `event.pos` 直接开打。
     *
     * 此前这里无条件 `cueball.pos.copy(event.pos)`，而规则层发来的那个 pos
     * 就是母球**当前**的位置 —— 于是 `decision/ballinhand.ts` 里那套
     * 「网格粗筛 + 前 12 个候选跑真实物理精算」的摆位评估只在 handleFoul
     * 那条支路上被调用，玩家实际看到的永远是「摆球在哪就直接开打」。
     *
     * 只有同时满足下面三条时才走摆位评估：
     *   ① `useStartPos` —— 这是规则层在说「你可以自由球」；
     *   ② `rules.allowsPlaceBall()` —— 三库 / 沙狐恒为 false，它们没有自由球机制；
     *   ③ 不是开球杆 —— 开球必须回到开球线，位置只能由 rules.placeBall() 决定。
     * 其余情况保持原有逻辑不变。
     */
    const canReposition =
      event.useStartPos === true &&
      this.container.rules.allowsPlaceBall() &&
      !this.thisShotIsBreak

    // chooseBallInHandPosition 内部已有 try/catch 兜底：
    // 评估失败会退回规则默认点，保证「拿自由球后一定能出杆」这条底线。
    cueball.pos.copy(
      canReposition
        ? this.chooseBallInHandPosition()
        : event.useStartPos
          ? event.pos
          : this.container.rules.placeBall()
    )
    cueball.setStationary()
    cueball.fround()
    this.container.table.cue.aim.elevation = 0
    this.publishSequenceToPlayer(this.aim())
  }

  private startTurnIfNeeded(): void {
    if (!this.shouldStartTurnOnNextControl) {
      return
    }
    this.botRules.startTurn()
    this.shouldStartTurnOnNextControl = false
  }

  private aim() {
    return this.strategy.aim(this.buildShotContext(), this.calculator)
  }

  private buildShotContext(): BotShotContext {
    const cueBall =
      this.container.rules.rulename === "threecushion" ||
      this.container.rules.rulename === "sagu"
        ? this.container.table.balls[1]
        : this.container.table.cueball

    return {
      table: this.container.table,
      cueBall,
      validTargetBalls: this.validTargetBalls(),
      ballInHand: false,
      pockets: this.calculator.pockets,
    }
  }
}
