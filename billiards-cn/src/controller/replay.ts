import { HitEvent } from "../events/hitevent"
import { Vector3 } from "three"
import { ControllerBase } from "./controllerbase"
import { AimEvent } from "../events/aimevent"
import { AbortEvent, Controller, Input } from "./controller"
import { BreakEvent } from "../events/breakevent"
import { Aim } from "./aim"
import { GameEvent } from "../events/gameevent"
import { EventType } from "../events/eventtype"
import { RerackEvent } from "../events/rerackevent"
import { PlaceBallEvent } from "../events/placeballevent"
import { End } from "./end"
import { ScoreEvent } from "../events/scoreevent"
import { StationaryEvent } from "../events/stationaryevent"
import { ChatEvent } from "../events/chatevent"
import { share, shorten } from "../utils/shorten"
import { unitAtAngle } from "../utils/three-utils"
import { R } from "../model/physics/constants"
import { PocketGeometry } from "../view/pocketgeometry"
import { LOBBY_URL } from "../network/client/constants"
import { Table } from "../model/table"
import { OutcomeType } from "../model/outcome"
import { State } from "../model/ball"

interface PotInfo {
  /** 相对本杆起点的进球时间戳（ms） */
  t: number
  /** 进袋球在 balls 数组中的下标 */
  ballId: number
  /** 对应袋口在 PocketGeometry.pocketCenters 中的下标 */
  pocketIdx: number
}

interface ShotMeta {
  /** 本杆开始前的完整球局布局快照（位置 / 状态 / 所属球袋索引） */
  layout: { pos: [number, number, number]; state: State; pocket: number }[]
  /**
   * 本杆白球在 balls 数组中的下标。
   * v1.3.59：这里**必须是下标而不是 ball.id**。ball.id 是全局自增的唯一编号，
   * rules.table() 新建出来的桌子 id 是 48~63 这种，与下标 0~15 完全对不上。
   * 字段原本就注释成「下标」，但两处赋值写的都是 .id，属于注释与实现不符。
   */
  cueballIdx: number
  /** 本杆瞄准事件（用于确定性重跑） */
  aim: AimEvent
  /** 头less 预演得到的本杆物理时长（ms） */
  duration: number
  /**
   * v1.2.9 #F3：本杆「最后碰撞/进袋时间戳 + 提前量」。物理时间越过它即进入倍速。
   * 无碰撞且无进袋时为 Infinity（整杆常速，便于看清走位/失误）。
   */
  triggerT: number | null
  /** 本杆各进袋事件（含球与袋口索引），供进度条吸附点与每进球跟踪镜头使用 */
  pots: PotInfo[]
  /** 本杆默认三点框定（白球 / 被击球 / 对应球袋），无进球或跟踪窗口外时使用 */
  defaultFocus: Vector3[]
  /**
   * v1.3.60：本杆白球实际运动轨迹的采样点（预演时顺手记录）。
   *
   * 之前的俯视框定只用「白球 → 被击球 → 袋口」三点包围圆，半径常常只有
   * 一两个 R，而白球撞完目标球后的走位往往横穿半张台——镜头锁死在三点上，
   * 白球后半程直接滚出画面，用户看到的就是「看不到白球轨迹」。
   * 这里记录真实轨迹，框定时把它一起包进去（见 frameCameraForShot）。
   */
  cueTrack?: [number, number, number][]
}

export class Replay extends ControllerBase {
  override get name() {
    return "Replay"
  }
  delay: number
  shots: GameEvent[]
  firstShot: GameEvent
  currentActive: 0 | 1 | 2 = 1
  timer
  init
  diagram?

  /**
   * v1.2.6 #232：回放「运动中提速」倍率（已弃用）。
   * 用户要求回放从击球到进球期间不倍速、不切换视角，故取消自动提速。
   * 倍速改由用户通过底部「倍速」按钮手动选择（见 replaySpeed）。
   */
  private static readonly REPLAY_FAST = 3

  /**
   * v1.2.9 #F3：最后一颗球碰撞 / 最后一次进袋之后，再留出这段提前量（ms）才进入
   * 倍速，让玩家看清最后一次碰撞/进袋的收尾，再快进余下「滚定」过程。
   * v1.2.17：仅用于进度条吸附点定位，不再驱动自动倍速。
   */
  private static readonly REPLAY_LEAD_MS = 80

  /**
   * v1.2.17：回放全局倍速档位（用户手动选择）。
   * 取值为 1 表示常速；击球→进球的真实时间间隔不被压缩、也不被拉长。
   */
  private static readonly REPLAY_SPEEDS = [0.5, 1, 2, 4]
  private replaySpeedIndex = 1 // 默认 1x

  // ---- v1.2.9 #F3 / #F5 状态 ----
  /** 每杆起始快照 + 预演结果（triggerT / duration / pots） */
  private shotMeta: ShotMeta[] = []
  /** 当前正在播放（或正在被拖动）的杆在 shotMeta 中的下标 */
  private currentShotIndex = -1
  /** 头less 预演用的独立 Table 实例（每杆复用，避免扰动实时画面） */
  private simTable: Table | null = null
  /**
   * v1.3.59：原始全量事件副本。
   * this.shots 会被 playNextShot() 用 shift() 逐步消费，一旦拖动进度条跨杆跳转，
   * 队列就与实际播放位置失配（往回拖跳杆、往前拖重播），比分 HUD 也跟着错。
   * 这里留一份不可变的原始序列，供 seekToFraction() 重建队列。
   */
  private allShots: GameEvent[] = []
  /**
   * v1.3.59：shotEventOffsets[k] = 第 k 杆（shotMeta 下标）的 AimEvent 在 allShots
   * 中的下标。一「杆」在事件流里可能占多个条目（Aim 之后还可能跟 SCORE，之前可能
   * 有 PLACEBALL / RERACK），所以不能直接拿 k 当数组下标。
   */
  private shotEventOffsets: number[] = []
  /** 用户正在拖动进度条（拖动期间冻结物理，避免与重跑冲突） */
  private userScrubbing = false
  /** 进度条与吸附点容器 */
  private seekEl: HTMLInputElement | null = null
  private snapsEl: HTMLElement | null = null
  /** 「退出回放」按钮（回放结束常驻） */
  private exitBtn: HTMLButtonElement | null = null
  private exitHandler = () => {
    document.body.classList.remove("replay-mode")
    globalThis.location.href = LOBBY_URL
  }
  /** v1.2.17 #4：全局倍速按钮引用与点击处理（点击循环切换 0.5x/1x/2x/4x） */
  private speedBtn: HTMLButtonElement | null = null
  private onSpeedClick = () => {
    if (this.speedBtn) {
      this.speedBtn.textContent = this.cycleReplaySpeed()
    }
  }
  /**
   * v1.2.26：回放视角模式。
   *  true  = 俯视（固定俯视全局视角，相机停在台面上方俯瞰整桌，不跟随球运动）；
   *  false = 跟随（侧后视角，相机沿母球位置/出杆方向平滑跟随，击球后不切俯视）。
   * 回放默认「跟随」，击球后镜头随母球移动，观感更接近实战；
   * 需要俯瞰全局时再切到「俯视」。
   */
  private camTopDown = false
/**
* v1.3.58：本杆是否已经出杆。
* 出杆前 = 正在摆位/瞄准，相机应停在 frameCameraForShot 定好的机位上；
* 出杆后 = 球在滚，相机默认锁定，只在确有必要时微调。
*/
private shotInFlight = false
  /** v1.2.26：视角切换按钮（跟随/俯视）引用与点击处理 */
  private camBtn: HTMLButtonElement | null = null
  private onCamClick = () => {
    this.camTopDown = !this.camTopDown
    const cam = this.container.view.camera
if (this.diagram || this.container.rules.rulename === "threecushion") {
cam.forceMode(cam.topView)
cam.setReplayNudge(null)
} else if (this.camTopDown) {
cam.forceMode(cam.topView)
cam.setReplayNudge(null)
} else {
// v1.3.58：从俯视切回跟随时，按当前杆重新建立机位并立即定位，
// 否则会退回 spectatorView（只跟母球、不做三点框定）。
this.frameCameraForShot(this.container.table.cue.aim)
}
    if (this.camBtn) this.camBtn.textContent = this.currentCamLabel()
  }
  private currentCamLabel(): string {
    return this.camTopDown ? "俯视" : "跟随"
  }
  /** 吸附点 DOM 缓存签名，避免每帧重建 */
  private lastSnapSig = ""
  constructor(container, init, shots, _retry = false, delay = 1500, diagram?) {
    super(container)
    // v1.2.13 #replay：一进入回放立刻隐藏底部栏，避免预计算/异常导致 onFirst 未执行时
    // 底部栏仍可见。后续 onFirst 会再次设置以作保险。
    document.body.classList.add("replay-mode")
    this.init = init
    this.diagram = diagram
    this.shots = Array.isArray(shots) ? [...shots] : []
    this.firstShot = this.shots[0]
    // v1.3.59：留一份不可变副本并建立「杆 → 事件下标」映射，供拖动进度条时重建队列
    this.allShots = [...this.shots]
    this.shotEventOffsets = this.buildShotOffsets()
    console.log(`[replay] init received, shots=${this.shots.length}`)
    console.log(`init: ${JSON.stringify(init)}`)
    this.delay = diagram ? 0 : delay
    // v1.2.6 #232：回放起步为正常速度（杆间停留/相机移动用正常速度）
    this.container.timeScale = 1
    this.container.table.showTraces(true)
    try {
      this.container.table.updateFromShortSerialised(this.init)
    } catch (e) {
      console.error("[replay] updateFromShortSerialised failed:", e)
    }
    console.log(`shots: ${this.shots.length}`)
    console.log(`shots: ${JSON.stringify(this.shots)}`)
    const suggestCamera =
      this.diagram || this.container.rules.rulename == "threecushion"
        ? this.container.view.camera.topView
        : (this.camTopDown ? this.container.view.camera.topView : this.container.view.camera.spectatorView)
    this.container.view.camera.forceMode(suggestCamera)
    // v1.2.11 #user：进入回放前预跑完整局，填满 shotMeta，
    // 使整局进度条从开局即涵盖全部杆与进球（而非逐杆叠加）。
    if (!this.diagram) {
      try {
        this.precomputeAllShots()
      } catch (e) {
        console.error("[replay] precomputeAllShots failed, fallback to incremental:", e)
        this.shotMeta = []
        this.simTable = null
      }
    }
    try {
      this.playNextShot(this.delay * 1.5)
    } catch (e) {
      console.error("[replay] playNextShot failed:", e)
    }
  }

  override onFirst() {
    console.log("[replay] onFirst fired")
    this.container.table.cue.aimInputs.setDisabled(true)
    const shareButton = this.container.menu.share
    if (shareButton) {
      shareButton.onclick = () => {
        shorten(globalThis.location.href, (url) => {
          const response = share(url)
          this.container.eventQueue.push(new ChatEvent(null, response))
        })
      }
    }
    // v1.2.9 #F5：挂载回放进度条（可滑动 + 进球吸附点）
    this.setupReplaySeek()
    // v1.2.11 #user：进入回放即隐藏底部操作栏，保持全屏
    document.body.classList.add("replay-mode")
    console.log("[replay] replay-mode class present:", document.body.classList.contains("replay-mode"))
  }

  private rerackShot(shot: GameEvent, delay: number): boolean {
    if (shot?.type !== EventType.RERACK) {
      return false
    }
    const rerack = RerackEvent.fromJson((shot as RerackEvent).ballinfo)
    RerackEvent.applyBallinfoToTable(this.container.table, rerack.ballinfo)
    if (this.shots.length > 0) {
      this.playNextShot(delay)
    }
    return true
  }

  private placeBallShot(shot: GameEvent, delay: number): boolean {
    if (shot?.type !== EventType.PLACEBALL) {
      return false
    }
    const place = PlaceBallEvent.fromJson(shot)
    this.container.table.cueball.pos.copy(place.pos)
    this.container.table.cueball.setStationary()
    if (place.respot) {
      const ball = this.container.table.balls[place.respot.id]
      if (ball) {
        ball.pos.copy(place.respot.pos)
        ball.setStationary()
      }
    }
    if (this.shots.length > 0) {
      this.playNextShot(delay)
    }
    return true
  }

  private scoreShot(shot: GameEvent, delay: number): boolean {
    if (shot?.type !== EventType.SCORE) {
      return false
    }
    const score = ScoreEvent.fromJson(shot)
    score.applyToController(this)
    if (score.active !== 0) {
      this.currentActive = score.active
    }
    if (this.shots.length > 0) {
      this.playNextShot(delay)
    }
    return true
  }

  playNextShot(delay) {
    const shot = this.shots.shift()
    if (!shot) {
      return
    }
    if (
      this.rerackShot(shot, delay) ||
      this.placeBallShot(shot, delay) ||
      this.scoreShot(shot, delay)
    ) {
      return
    }

    const aim = AimEvent.fromJson(shot)
    this.container.setHudActivePlayer(this.currentActive)
    this.container.table.cueball = this.container.table.balls[aim.i]

    this.container.table.cueball.pos.copy(aim.pos)
    this.container.table.cue.aim = aim
    this.container.updateLastShot()
    // v1.3.58：回放同样要走「出杆即收杆」，每杆重新播放前把球杆亮回来
    this.container.table.cue.aimMode()
    this.container.table.cue.updateAimInput()
    this.container.table.cue.t = 1
  // v1.3.58：本杆击球前先把相机摆到位（见 frameCameraForShot）。
  // 旧逻辑用 suggestMode 切到 spectatorView 就不管了，镜头只能靠每帧 lerp
  // 慢慢飞向目标机位，出杆瞬间往往还没到位。
  this.shotInFlight = false
  this.frameCameraForShot(aim)
  clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.container.table.proximityIndicator.hide()
      this.container.eventQueue.push(
        new HitEvent(this.container.table.cue.aim.copy())
      )
      this.timer = undefined
    }, delay)
  }

  /**
   * v1.2.6 #232：根据当前这一杆的瞄准，算出回放框定需要的三点：
   *   [0] 白球（击球点）  [1] 被击球  [2] 对应进球的球袋。
   * - 被击球：从白球沿瞄准方向做射线，取第一个会被白球碰到的球（中心线距离 ≤ 2R）。
   * - 对应球袋：被击球大致沿「白球→被击球」中心线方向被推出，
   *   取该方向上夹角最小的球袋作为目标袋（直球/近直球精确，加塞切球为近似）。
   */
  private computeFocusPoints(aim: AimEvent, table: Table = this.container.table): Vector3[] {
    const cue = table.cueball
    const cuePos = cue.pos.clone()
    const dir = unitAtAngle(aim.angle) // XY 平面单位向量

    // 找被击球：射线 (cuePos + t*dir) 上第一个被白球碰到的球
    let best: any = null
    let bestT = Infinity
    for (const b of table.balls) {
      if (b === cue || !b.onTable()) continue
      const vx = b.pos.x - cuePos.x
      const vy = b.pos.y - cuePos.y
      const t = vx * dir.x + vy * dir.y
      if (t <= 0) continue
      const perp = Math.abs(vx * dir.y - vy * dir.x)
      if (perp > 2 * R * 1.02) continue // 白球中心线够不到此球
      if (t < bestT) {
        bestT = t
        best = b
      }
    }

    let struckPos: Vector3
    if (best) {
      struckPos = best.pos.clone()
    } else {
      // 未预判到被击球（罕见）：在瞄准前方放一个虚拟点，保证框定仍有效
      struckPos = cuePos.clone().addScaledVector(dir, 8 * R)
    }

    // 目标球袋：被击球沿「白球→被击球」方向被推出，取该方向上夹角最小的球袋
    const pocketDir = struckPos.clone().sub(cuePos)
    if (pocketDir.lengthSq() < 1e-6) pocketDir.copy(dir)
    pocketDir.normalize()
    // 注意：PocketGeometry.pocketCenters 元素是 Pocket 实例，坐标在 .pos
    let bestPocket: Vector3 = PocketGeometry.pocketCenters[0].pos.clone()
    let bestDot = -Infinity
    for (const p of PocketGeometry.pocketCenters) {
      const pd = p.pos.clone().sub(struckPos)
      if (pd.lengthSq() < 1e-6) continue
      pd.normalize()
      const d = pd.x * pocketDir.x + pd.y * pocketDir.y
      if (d > bestDot) {
        bestDot = d
        bestPocket = p.pos.clone()
      }
    }

    return [cuePos, struckPos, bestPocket]
  }

  /**
   * v1.2.9 #F3 / #F5：每杆起手记账。
   * - 隔离本杆 outcome（回放中原 outcome 跨杆累积，会导致「最后事件」时间戳判定错误）；
   * - 抓取本杆起始布局快照（用于拖动进度条时确定性重跑）；
   * - 头less 预演本杆，算出 triggerT / duration / pots。
   */
  private beginShotBookkeeping() {
    this.currentShotIndex++
    const t = this.container.table
    // 隔离本杆 outcome（每杆以干净数组开始）
    t.outcome.length = 0
    // 若整局已预计算，直接复用对应杆的预计算 meta（duration / pots / defaultFocus / triggerT 已就绪）
    const existing = this.shotMeta[this.currentShotIndex]
    if (existing) {
      return
    }
    // 兜底：未预计算时（如图解模式）现场计算并追加
    if (!this.simTable) {
      this.simTable = this.container.rules.table()
    }
    const meta: ShotMeta = {
      layout: t.balls.map((b) => ({
        pos: [b.pos.x, b.pos.y, b.pos.z] as [number, number, number],
        state: b.state,
        pocket: b.pocket ? PocketGeometry.pocketCenters.indexOf(b.pocket) : -1,
      })),
      cueballIdx: t.balls.indexOf(t.cueball),
      aim: t.cue.aim.copy(),
      duration: 0,
      triggerT: null,
      pots: [],
      defaultFocus: this.computeFocusPoints(t.cue.aim),
    }
    this.precomputeShot(meta)
    this.shotMeta.push(meta)
  }

  /**
   * v1.2.9 #F3 / #F5：用独立 simTable 头less 重跑本杆，得到：
   * - duration：本杆物理时长（ms），供进度条满程与吸附点定位；
   * - triggerT：本杆「最后碰撞/进袋 + 提前量」，物理越过它才倍速（#F3）；
   * - pots：本杆所有进袋时间戳，供进度条吸附点（#F5）。
   */
  private precomputeShot(meta: ShotMeta) {
    const sim = this.simTable!
    meta.layout.forEach((s, i) => {
      const b = sim.balls[i]
      if (!b) return
      b.pos.set(s.pos[0], s.pos[1], s.pos[2])
      b.vel.set(0, 0, 0)
      b.rvel.set(0, 0, 0)
      b.state = s.state
      b.pocket = s.pocket >= 0 ? PocketGeometry.pocketCenters[s.pocket] : undefined
    })
    // v1.3.59：这里原为 sim.balls[meta.cueballId]，而 cueballId 存的是
    // ball.id —— rules.table() 新建的桌子 id 是 48~63，按下标取值恒为
    // undefined，紧接着 sim.hit() → Cue.hit(undefined) 抛
    // "Cannot set properties of undefined (setting 'state')"。
    // precomputeAllShots 捕获该异常后整局预计算作废（shotMeta 清空），
    // 进度条因此拿不到整局总时长，只能逐杆叠加。改为存下标后此处直接按下标取。
    sim.cueball = sim.balls[meta.cueballIdx]
    sim.cue.aim = meta.aim.copy()
    sim.time = 0
    sim.outcome.length = 0
    sim.hit()
    const step = this.container.step
    let guard = 0
    // v1.3.60：顺手采样白球轨迹，供俯视框定包住整条走位（见 ShotMeta.cueTrack）。
    // 采样下限 ~30 步一次：step 通常 1~2ms、整杆数百到数千步，30 步取一点既能
    // 覆盖轨迹弯折（撞库后方向剧变）又不至于点数爆炸。上限 400 点兜底。
    const track: [number, number, number][] = []
    const cueBall = sim.cueball
    const SAMPLE_EVERY = 30
    const MAX_TRACK_POINTS = 400
    while (!sim.allStationary() && guard++ < 500000) {
      sim.advance(step)
      if (
        cueBall &&
        guard % SAMPLE_EVERY === 0 &&
        track.length < MAX_TRACK_POINTS &&
        cueBall.onTable()
      ) {
        track.push([cueBall.pos.x, cueBall.pos.y, cueBall.pos.z])
      }
    }
    if (cueBall && track.length < MAX_TRACK_POINTS) {
      track.push([cueBall.pos.x, cueBall.pos.y, cueBall.pos.z])
    }
    meta.cueTrack = track
    let maxTs = -1
    const pots: PotInfo[] = []
    for (const o of sim.outcome) {
      if (o.type === OutcomeType.Collision || o.type === OutcomeType.Pot) {
        if (o.timestamp > maxTs) maxTs = o.timestamp
      }
      if (o.type === OutcomeType.Pot) {
        const ballId = o.ballA ? o.ballA.id : -1
        const pocketIdx = o.ballA?.pocket
          ? PocketGeometry.pocketCenters.indexOf(o.ballA.pocket)
          : -1
        pots.push({ t: o.timestamp, ballId, pocketIdx })
      }
    }
    meta.duration = sim.time
    // 无碰撞且无进袋 → 整杆常速（便于看清走位/失误）；否则最后事件 + 提前量后倍速
    meta.triggerT = maxTs >= 0 ? maxTs + Replay.REPLAY_LEAD_MS : Infinity
    meta.pots = pots
  }

  /**
   * v1.2.11 #user：进入回放前用独立 simTable 顺序执行全部杆，
   * 预先生成每杆的 layout / aim / duration / triggerT / pots / defaultFocus，
   * 使 gameTotals() 在回放一开始就能给出整局总时长，进度条从开局覆盖到结束，
   * 而非原先「每杆播放后才追加一段」的逐杆叠加表现。
   */
  /**
   * v1.3.59：扫描原始事件序列，算出每一杆的 AimEvent 在 allShots 中的下标。
   *
   * 判定条件与 playNextShot() 逐字一致 —— 只有「不是 RERACK / PLACEBALL / SCORE」
   * 的事件才算一杆的起点（其余三种会被 playNextShot 递归消费掉）。这样无论
   * 整局预计算是否成功、是否图解模式，映射都成立。
   */
  private buildShotOffsets(): number[] {
    const offs: number[] = []
    this.allShots.forEach((e, i) => {
      const t = e?.type
      if (
        t !== EventType.RERACK &&
        t !== EventType.PLACEBALL &&
        t !== EventType.SCORE
      ) {
        offs.push(i)
      }
    })
    return offs
  }

  private precomputeAllShots() {
    this.simTable = this.container.rules.table()
    this.simTable.updateFromShortSerialised(this.init)
    const shots = [...this.shots]
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]
      try {
        if (shot?.type === EventType.RERACK) {
          RerackEvent.applyBallinfoToTable(
            this.simTable,
            RerackEvent.fromJson((shot as RerackEvent).ballinfo).ballinfo
          )
          continue
        }
        if (shot?.type === EventType.PLACEBALL) {
          const place = PlaceBallEvent.fromJson(shot)
          this.simTable.cueball.pos.copy(place.pos)
          this.simTable.cueball.setStationary()
          if (place.respot) {
            const b = this.simTable.balls[place.respot.id]
            if (b) {
              b.pos.copy(place.respot.pos)
              b.setStationary()
            }
          }
          continue
        }
        if (shot?.type === EventType.SCORE) {
          // 计分事件不改变球位，预演布局无需处理
          continue
        }
        // AimEvent：抓取起始布局并预演本杆
        const aim = AimEvent.fromJson(shot)
        this.simTable.cueball = this.simTable.balls[aim.i]
        this.simTable.cueball.pos.copy(aim.pos)
        this.simTable.cue.aim = aim
        const meta: ShotMeta = {
          layout: this.simTable.balls.map((b) => ({
            pos: [b.pos.x, b.pos.y, b.pos.z] as [number, number, number],
            state: b.state,
            pocket: b.pocket ? PocketGeometry.pocketCenters.indexOf(b.pocket) : -1,
          })),
          cueballIdx: this.simTable.balls.indexOf(this.simTable.cueball),
          aim: aim.copy(),
          duration: 0,
          triggerT: null,
          pots: [],
          defaultFocus: this.computeFocusPoints(aim, this.simTable),
        }
        this.precomputeShot(meta)
        this.shotMeta.push(meta)
      } catch (e) {
        console.error(`[replay] precompute shot ${i} failed, abort incremental fallback:`, e)
        // 任一杆预计算失败即放弃整局预计算，改为逐杆现场计算（进度条会回到逐杆叠加，
        // 但回放本身仍可正常播放）。
        this.shotMeta = []
        this.simTable = null
        break
      }
    }
    console.log(`[replay] precomputeAllShots done, metaCount=${this.shotMeta.length}`)
  }

  /** 将实时 Table 还原到某杆起始布局（确定性重跑起点） */
  private restoreShotStart(meta: ShotMeta) {
    const t = this.container.table
    meta.layout.forEach((s, i) => {
      const b = t.balls[i]
      if (!b) return
      b.pos.set(s.pos[0], s.pos[1], s.pos[2])
      b.vel.set(0, 0, 0)
      b.rvel.set(0, 0, 0)
      b.state = s.state
      b.pocket = s.pocket >= 0 ? PocketGeometry.pocketCenters[s.pocket] : undefined
    })
    // v1.3.59：同 precomputeShot，改为按 balls 下标取母球。
    t.cueball = t.balls[meta.cueballIdx]
    t.cue.aim = meta.aim.copy()
    t.time = 0
    t.outcome.length = 0
  }

  /**
   * v1.3.59：把待播队列重建为「从第 idx 杆的 AimEvent 之后开始」。
   *
   * 事件流形如 Aim(k) → SCORE(k) → [PLACEBALL] → Aim(k+1)，而 seekToFraction
   * 已经用 container.table.hit() 消费掉了 Aim(k)，所以队列要从 off + 1 切起。
   * 拿不到映射时（如映射表为空）保持原样，避免把情况变得更糟。
   */
  private rebuildQueueFrom(idx: number) {
    const off = this.shotEventOffsets[idx]
    if (off === undefined) {
      return
    }
    this.shots = this.allShots.slice(off + 1)
    this.restoreScoreBefore(off)
  }

  /**
   * v1.3.59：把比分 HUD 回填到「第 idx 杆开打之前」的状态。
   *
   * 比分完全由事件流里的 SCORE 事件驱动（scoreShot → handleScore →
   * updateScoreHud），重建队列后那些已播过的 SCORE 不会再走一遍，
   * 所以必须手动补一次。
   *
   * 只应用最后一个 SCORE 即可：handleScore 本质是纯 setter，
   * 其另两处副作用 —— session.p1type 赋值（有 `session.p1type === 0` 守卫、
   * 且值黏滞）和三库/沙古终局检查（有 `!replayMode` 守卫）—— 都幂等且回放下不触发。
   *
   * v1.3.60：applyToController 走的是 Replay 的 handleScore（继承自 base，
   * 调 container.updateScoreHud）。但 updateScoreHud 内部还会改 session 的「我方 /
   * 对手」顺序，回放下 playerIndex 与对局时未必一致，导致 HUD 出现「数值对了但
   * 角色反了」的情况。这里再走一次显式同步：把 SCORE.p1/p2 视为「对局时的双方
   * 数值」，按 container.view.hud / Session 的 ordered* 接口压一次，确保 HUD
   * 的 p1Score/p2Score 显示**就是这一刻应有的比分**。
   */
  private restoreScoreBefore(off: number) {
    let last: GameEvent | null = null
    for (let i = 0; i < off; i++) {
      if (this.allShots[i]?.type === EventType.SCORE) {
        last = this.allShots[i]
      }
    }
    const score = last
      ? ScoreEvent.fromJson(last)
      : new ScoreEvent(0, 0, 0, 0)
    score.applyToController(this)
    if (score.active !== 0) {
      this.currentActive = score.active
    }
    // v1.3.60 防御性兜底：直接再调一次 updateScoreHud 与一次 setText，防止
    // 上面链路任意一处因为 recordReplayer 等原因吞掉了写入、而 HUD 上分值仍停在
    // 「拖动前那一刻」。这两步幂等（值不变就不变），不影响下一杆的分数累加。
    try {
      this.container.updateScoreHud(score.p1, score.p2, score.b, score.active)
    } catch (e) {
      /* 容错：HUD 写入失败不应阻塞 seekToFraction */
    }
    try {
      const hud = this.container.hud
      if (hud?.p1Element) hud.p1Element.textContent = String(score.p1)
      if (hud?.p2Element) hud.p2Element.textContent = String(score.p2)
    } catch (e) {
      /* 容错同上 */
    }
  }

  /**
   * v1.2.9 #F5：将回放跳转到本杆进度比例 frac（0..1）处。
   * v1.2.11 #F11：frac 现为整局进度比例。需先定位到对应杆 idx，
   * 再在该杆内确定性重跑到局部目标时刻。
   * 做法：还原本杆起始布局 → 重新击球 → 确定性重跑物理到目标时刻。
   */
  private seekToFraction(frac: number) {
    const { cum, total } = this.gameTotals()
    if (total <= 0) return
    // v1.3.59：清 timer 必须放在这里，不能只放在 onSeekStart。
    // onSeekEnd 同时绑在 change 上（键盘方向键 / 程序触发只走 input + change，
    // 不经过 onSeekStart），不清 timer 的话，杆间 delay 的那个 timer 到期仍会
    // push HitEvent → beginShotBookkeeping 把 currentShotIndex 再 +1，
    // 与下面刚设好的 idx 错一位，后续 shotMeta 全部串位。
    clearTimeout(this.timer)
    this.timer = undefined
    // v1.3.60：拖动跨段会让 container.eventQueue 里残留下一次「静止」事件，
    // 而 processEvents 在「allStationary」成立时立即消费 StationaryEvent → 调度
    // 下一杆。一来一回的进度条拖动会让残留下一个 StationaryEvent 把刚回填好的
    // 时序吃掉、画面停在「拖到的那一刻」但马上又前进。这里把残留事件一次性清空，
    // 拖动结束后由 resumeAfterSeek 重新发 StationaryEvent（如果还需要的话）。
    if (this.container.eventQueue) {
      this.container.eventQueue.length = 0
    }
    const target = Math.max(0, Math.min(1, frac)) * total
    // 找到 target 落在哪一杆
    let idx = this.currentShotIndex
    for (let i = 0; i < this.shotMeta.length; i++) {
      const segEnd = cum[i] + Math.max(this.shotMeta[i].duration, 1e-3)
      if (target <= segEnd || i === this.shotMeta.length - 1) {
        idx = i
        break
      }
    }
    const meta = this.shotMeta[idx]
    if (!meta) return
    // v1.3.59：跨杆跳转时重建剩余事件队列 + 回填比分。
    // this.shots 是被 shift() 消费的队列，只改 currentShotIndex 而不重建它，
    // 会导致后续杆被跳过或重复播放，比分 HUD（靠队列里的 SCORE 事件推进）随之错位。
    // 起点是 off + 1 而不是 off —— 下面 container.table.hit() 已经把本杆的
    // AimEvent 消费掉了，用 off 会让本杆再被完整重播一次。
    if (idx !== this.currentShotIndex) {
      this.rebuildQueueFrom(idx)
    }
    const localTarget = Math.max(0, target - cum[idx])
    this.currentShotIndex = idx
    this.restoreShotStart(meta)
    this.container.table.hit()
    // v1.3.59：seek 重跑等同于一记真实出杆，标记在飞以便允许镜头微调
    this.shotInFlight = true
    const step = this.container.step
    let guard = 0
    while (
      this.container.table.time < localTarget &&
      !this.container.table.allStationary() &&
      guard++ < 500000
    ) {
      this.container.table.advance(step)
    }
    this.container.table.updateBallMesh(0)
    this.container.view.update(0, this.container.table.cue.aim)
    this.container.view.render()
  }

  /**
   * v1.2.11 #F11：计算整局累计时长与每杆起始偏移。
   * cum[i] = 前 i 杆时长之和；total = 所有杆时长之和。
   * 增量方案：只用已记录的 shotMeta，无需预跑整局。
   */
  private gameTotals(): { cum: number[]; total: number } {
    const cum: number[] = []
    let acc = 0
    for (const m of this.shotMeta) {
      cum.push(acc)
      acc += Math.max(m.duration, 1e-3)
    }
    return { cum, total: acc }
  }

  /**
   * v1.2.17：每帧由 container.advance 回调，返回本帧回放倍速。
   * 不再按「最后碰撞/进袋」自动提速——击球到进球的真实时间间隔
   * 完全由用户选择的全局倍速决定。
   * v1.2.27：移除 v1.2.22「击球过程中强制 1x」的限制。此前该限制使「倍速」按钮
   * 仅在杆间短暂等待生效、球运动阶段恒为 1x，用户误以为倍速失效。现全程使用用户
   * 选择的全局倍速：默认 1x（仍看清击球/碰撞/进球），选 2x/4x 即整段回放加速。
   */
  private replayTimeScale(): number {
    // v1.2.27：移除「击球过程中强制 1x」的限制。
    // 此前该限制让用户的倍速选择只在杆间短暂等待里生效，球运动（回放最主要内容）
    // 阶段恒为 1x，导致「倍速」按钮看起来完全无效。
    // 现全程使用用户选择的全局倍速：默认 1x（仍看清击球/碰撞/进球），用户选 2x/4x 即整体加速。
    return Replay.REPLAY_SPEEDS[this.replaySpeedIndex]
  }

  /** 用户点击底部「倍速」按钮：在 0.5x / 1x / 2x / 4x 之间循环切换 */
  private cycleReplaySpeed(): string {
    this.replaySpeedIndex =
      (this.replaySpeedIndex + 1) % Replay.REPLAY_SPEEDS.length
    return this.currentSpeedLabel()
  }

  private currentSpeedLabel(): string {
    const s = Replay.REPLAY_SPEEDS[this.replaySpeedIndex]
    return s === 0.5 ? "0.5x" : s + "x"
  }

  /** v1.2.11 #F11：每帧刷新进度条位置（整局进度）与全局进球吸附点 */
  private tickSeekUI() {
    if (!this.seekEl) return
    if (!this.userScrubbing) {
      const { cum, total } = this.gameTotals()
      if (total > 0) {
        const idx = this.currentShotIndex < 0 ? 0 : this.currentShotIndex
        const cur = cum[idx] + this.container.table.time
        const frac = Math.min(cur / total, 1)
        this.seekEl.value = String(Math.round(frac * 1000))
      }
    }
    this.renderSnaps()
  }

/**
* v1.3.58：本杆击球前的相机定位。
*
* - 图解 / 开伦 / 俯视模式：沿用原来的 suggestMode（全局固定视角，无需框定）；
* - 跟随模式：用本杆「白球 → 被击球 → 目标袋口」三点建立机位锚点，并立刻
*   forceMove 把相机摆到位（不靠 lerp 慢慢飞），实现「每一杆击球前完成定位」。
*   之后出杆即锁定，只在确有必要时做限幅微调（见 updateReplayCamera）。
*
* v1.3.60：俯视模式不再「啥都不管直接切固定机位」。用户从跟随切到俯视时，
* 当前局的所有球都会被桌面下方那个全局正俯视压缩成像素点，根本看不清白球
* 走到哪。把俯视的视线中心锚到「当前 cueball + 1 个最近被击球（若有）」
* 的几何中心，相机高度按这个中心圈的最小包围球半径动态调整：圈越大相机
* 越高，保证整圈始终在画面内；圈越小相机越低，让白球在画面里尽量大。
* 不像跟随模式那样用「白球 / 被击球 / 球袋」框三点，俯视主要看的是「走位
* 轨迹」，所以两三点已经够，三点反而会偏移镜头。
*/
private frameCameraForShot(aim: AimEvent): void {
const cam = this.container.view.camera
if (this.diagram || this.container.rules.rulename === "threecushion") {
  cam.suggestMode(cam.topView)
  cam.setReplayNudge(null)
  return
}
// v1.3.60：用**本杆**的预计算框定。原先取 shotMeta[currentShotIndex + 1]，
// 即「下一杆」的默认框定来摆当前杆的机位——两者 aim 不同，机位因此常常
// 对着错误的一侧。本杆没有预计算时（如图解模式）才退回现场计算。
const mine = this.shotMeta[this.currentShotIndex]
const focus =
  mine && mine.defaultFocus && mine.defaultFocus.length > 0
    ? mine.defaultFocus
    : this.computeFocusPoints(aim)
if (this.camTopDown) {
  const { center, radius } = this.topDownBounds(focus, mine)
  cam.setReplayNudge(null)
  cam.forceMode(cam.topView)
  cam.topViewAtCenter(center, radius)
  return
}
// 跟随模式：三点框定之外再掺入白球轨迹的稀释采样点。纯三点框定会把机位锁在
// 击球瞬间那一小片区域，白球的后续走位一撞库就出画——这正是「看不到白球轨迹」
// 的另一半原因。掺入轨迹后机位会稍微拉远、略偏，但整条走位留在画面内。
cam.setReplayFrame(focus.concat(this.diluteTrack(mine?.cueTrack, 4)))
cam.forceMove(aim)
}

/**
 * v1.3.60：把白球轨迹稀释成至多 n 个点（等距取样，首尾必留）。
 * 直接把几百个采样点丢给 setReplayFrame 会让机位被轨迹的密集段拖偏，
 * 稀释后只保留「白球大致跑向哪」的信息。
 */
private diluteTrack(
  track: [number, number, number][] | undefined,
  n: number
): Vector3[] {
  if (!track || track.length === 0 || n <= 0) {
    return []
  }
  if (track.length <= n) {
    return track.map((t) => new Vector3(t[0], t[1], t[2]))
  }
  const out: Vector3[] = []
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (track.length - 1)) / (n - 1))
    const t = track[idx]
    out.push(new Vector3(t[0], t[1], t[2]))
  }
  return out
}

/**
 * v1.3.60：俯视模式的取景范围。
 *
 * 两组点都要包住：
 *  - focus：白球 / 被击球 / 目标袋口（决定「这一杆在打什么」）；
 *  - cueTrack：白球本杆的真实轨迹（决定「白球跑到哪」）。
 * 只看前者是原先「看不到白球轨迹」的直接原因——focus 三点往往挤在台面一角，
 * 而白球撞击后常横穿半张台，锁死三点等于把后半程走位切出画面。
 *
 * 返回包围盒中心与半对角线长度，交给 Camera.topViewAtCenter 反算视距。
 */
private topDownBounds(
  focus: Vector3[],
  meta?: ShotMeta
): { center: Vector3; radius: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const eat = (x: number, y: number) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const p of focus) {
    eat(p.x, p.y)
  }
  for (const t of meta?.cueTrack ?? []) {
    eat(t[0], t[1])
  }
  // 一个点都没有（极端兜底）：退回整台中心 + 半台尺寸
  if (minX > maxX) {
    return { center: new Vector3(0, 0, 0), radius: R * 24 }
  }
  const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0)
  // 半对角线 = 包围盒外接圆半径；+2R 给球体本身和边距留量
  const radius =
    Math.hypot(maxX - minX, maxY - minY) / 2 + 2 * R
  // 下限 3R：白球原地轻推时轨迹退化成一个点，也要保证有基本视高
  return { center, radius: Math.max(radius, R * 3) }
}

/**
* v1.3.58：回放每帧的相机跟随策略。
*
* 基本原则是「出杆后锁定机位」—— 本杆击球前已经把相机摆到位（见
* frameCameraForShot），出杆后不再重新框定，避免镜头在球滚动期间乱飞。
*
* 只有在「后续进球很可能看不清」时才允许适度微调：
*  - 本杆同时/连续进了多个球（pots >= 2），一个机位很难同时框住多个落点；
*  - 本杆进球链条很长、节奏缓慢，先前框定的袋口已经不在视野里。
* 微调只动「绕注视中心的角度 + 相机高度 + 注视点平移」三项，各自限幅、
* 以 2% 的系数平滑逼近（见 Camera.stepReplayNudge），不会出现镜头跳切。
*/
private updateReplayCamera() {
if (this.diagram || this.container.rules.rulename === "threecushion") return
if (this.camTopDown) return
const cam = this.container.view.camera
const meta = this.shotMeta[this.currentShotIndex]
if (!this.shotInFlight || !meta) {
cam.setReplayNudge(null)
return
}
if (!meta.pots || meta.pots.length === 0) {
cam.setReplayNudge(null)
return
}
if (!this.allowReplayNudge(meta)) {
cam.setReplayNudge(null)
return
}
cam.setReplayNudge(this.currentPotWatchPoint(meta))
}

/**
* v1.3.58：本杆是否允许相机微调。
* 只有「多球同进」或「进球链条长 / 节奏缓慢」两种情形才放开，
* 普通单球进球一律锁定机位，避免无谓的镜头移动。
*/
private allowReplayNudge(meta: ShotMeta): boolean {
// 一杆多球：机位很难一次框住所有落点
if (meta.pots.length >= 2) return true
// 链条长：本杆物理时长超过 2.6 秒，后续进球大概率跑出初始框定范围
if (meta.duration > 2600) return true
// 节奏慢：距首个进球已过去很久、后面还有进球没播完
const t = this.container.table.time
const first = meta.pots[0].t
const last = meta.pots[meta.pots.length - 1].t
if (t > first + 1200 && t < last + 400) return true
return false
}

/**
* v1.3.58：当前应该盯住的进球位置 —— 取时间窗口内最近的一次进球。
* 进球前盯球本身（跟着球进袋），进球后盯袋口（球已消失，看落袋位置）。
*/
private currentPotWatchPoint(meta: ShotMeta): Vector3 | null {
const t = this.container.table.time
const table = this.container.table
// 提前 700ms 开始跟、进球后再跟 500ms，保证「接近袋口 → 落袋」全程在画面内
const LEAD = 700
const TRAIL = 500
let best: PotInfo | null = null
let bestD = Infinity
for (const pot of meta.pots) {
if (t < pot.t - LEAD || t > pot.t + TRAIL) continue
const d = Math.abs(t - pot.t)
if (d < bestD) {
bestD = d
best = pot
}
}
if (!best) return null
const pocket = PocketGeometry.pocketCenters[best.pocketIdx]
if (t < best.t) {
const ball = table.balls[best.ballId]
return ball && ball.onTable() ? ball.pos : pocket ?? null
}
return pocket ?? null
}

  /** v1.2.11 #F11：渲染全局进球吸附点（所有已记录杆的 pots 平移到全局位置） */
  private renderSnaps() {
    if (!this.snapsEl) return
    const { cum, total } = this.gameTotals()
    if (total <= 0) {
      if (this.lastSnapSig !== "") {
        this.snapsEl.innerHTML = ""
        this.lastSnapSig = ""
      }
      return
    }
    // 签名：所有杆的 pots 数 + total，避免每帧重建
    let potCount = 0
    for (const m of this.shotMeta) potCount += m.pots.length
    const sig = potCount + ":" + Math.round(total) + ":" + this.shotMeta.length
    if (sig === this.lastSnapSig) return
    this.lastSnapSig = sig
    let html = ""
    for (let i = 0; i < this.shotMeta.length; i++) {
      const meta = this.shotMeta[i]
      const segDur = Math.max(meta.duration, 1e-3)
      for (const p of meta.pots) {
        const globalT = cum[i] + (p.t - Replay.REPLAY_LEAD_MS)
        const f = Math.max(0, Math.min(1, globalT / total))
        html += `<span class="replay-snap" style="left:${(f * 100).toFixed(2)}%"></span>`
      }
    }
    this.snapsEl.innerHTML = html
  }

  // ---- 进度条交互（拖动冻结物理、释放恢复；吸附到进球前时间点） ----
  private onSeekStart = () => {
    this.userScrubbing = true
    this.container.replayPaused = true
    // 取消挂起的「下一杆」定时器：拖动重跑本杆后再次静止会重新调度一次，
    // 若不取消则原定时器仍会触发，导致下一杆被重复调度。
    clearTimeout(this.timer)
    this.timer = undefined
  }
  private onSeekInput = () => {
    if (!this.seekEl) return
    let frac = Number(this.seekEl.value) / 1000
    // v1.2.11 #F11：吸附检测在全局位置做（所有已记录杆的 pots）
    const { cum, total } = this.gameTotals()
    if (total > 0) {
      const SNAP = 0.025 // 吸附阈值（进度条比例）
      let best = -1
      let bestD = SNAP
      for (let i = 0; i < this.shotMeta.length; i++) {
        const meta = this.shotMeta[i]
        for (const p of meta.pots) {
          const globalT = cum[i] + (p.t - Replay.REPLAY_LEAD_MS)
          const sf = Math.max(0, Math.min(1, globalT / total))
          const d = Math.abs(frac - sf)
          if (d < bestD) {
            bestD = d
            best = sf
          }
        }
      }
      if (best >= 0) {
        frac = best
        this.seekEl.value = String(Math.round(frac * 1000))
      }
    }
    this.seekToFraction(frac)
  }
  private onSeekEnd = () => {
    this.userScrubbing = false
    this.container.replayPaused = false
    this.resumeAfterSeek()
  }

  /**
   * v1.3.59：松手后若台面已经静止，手动把静止事件补进事件队列。
   *
   * 病根：seekToFraction 的确定性重跑循环会在 `allStationary()` 成立时提前退出，
   * 一旦拖到杆末/吸附点/整局末端，seek 结束时台面就是静止的。而 Container.advance
   * 的判据是 `!stateBefore && allStationary()`（帧首已静止则永远不成立），
   * StationaryEvent 再也产生不了 → handleStationary 永不触发 → 而它是唯一的
   * 「静止后调度下一杆」入口 → 回放就此卡死，界面上却没有任何暂停提示。
   *
   * timer === undefined 这一守卫同时挡住了重复调度，以及 change + pointerup
   * 双触发导致的两次 onSeekEnd。
   */
  private resumeAfterSeek() {
    if (!this.container.table.allStationary() || this.timer !== undefined) {
      return
    }
    const hasNext = this.shots.some((e) => {
      const t = e?.type
      return (
        t !== EventType.RERACK &&
        t !== EventType.PLACEBALL &&
        t !== EventType.SCORE
      )
    })
    if (!hasNext) {
      // 整局末端：停住即可，不要重播末杆（与回放自然结束的行为一致）
      this.container.replayPaused = true
      return
    }
    this.container.eventQueue.push(new StationaryEvent())
  }

  /** v1.2.9 #F5：挂载回放进度条 DOM 与每帧/交互回调 */
  private setupReplaySeek() {
    const bar = document.getElementById("replaySeekBar")
    this.seekEl = document.getElementById("replaySeek") as HTMLInputElement | null
    this.snapsEl = document.getElementById("replaySeekSnaps")
    if (bar) bar.removeAttribute("hidden")
    // v1.2.13 #replay：双重保险隐藏底部栏：CSS + 内联 !important
    const panel = document.getElementById("panel")
    if (panel) panel.style.setProperty("display", "none", "important")
    // v1.2.19 #2：CSS + JS 双保险隐藏右上角设置齿轮。部分环境 CSS 规则被缓存或
    // 未生效，导致回放时齿轮仍可见；这里直接用内联 style 强制隐藏。
    const menu = document.getElementById("menu")
    if (menu) menu.style.setProperty("display", "none", "important")
    this.container.replayPaused = false
    this.userScrubbing = false
    this.lastSnapSig = ""
    this.container.replayTimeScaleHook = () => this.replayTimeScale()
this.container.replayFrameHook = () => {
this.tickSeekUI()
// v1.3.58：接上回放跟随镜头。此前 updateReplayCamera() 没有任何调用者，
// 整条「跟随进球」的链路是死的，回放只能停留在进入时的固定机位。
this.updateReplayCamera()
}
    // 显示「退出回放」按钮并绑定（回放全程常驻，结束后供用户离开）
    const exit = document.getElementById("replayExitBtn") as HTMLButtonElement | null
    this.exitBtn = exit
    if (exit) {
      exit.removeAttribute("hidden")
      exit.addEventListener("click", this.exitHandler)
    }
    // v1.2.17 #4：挂载全局倍速按钮，初始化为当前倍速标签并绑定循环切换
    const speed = document.getElementById("replaySpeedBtn") as HTMLButtonElement | null
    this.speedBtn = speed
    if (speed) {
      speed.textContent = this.currentSpeedLabel()
      speed.addEventListener("click", this.onSpeedClick)
    }
    // v1.2.24：挂载视角切换按钮（跟随/俯视），初始化为当前视角标签并绑定切换
    const cam = document.getElementById("replayCamBtn") as HTMLButtonElement | null
    this.camBtn = cam
    if (cam) {
      cam.textContent = this.currentCamLabel()
      cam.addEventListener("click", this.onCamClick)
    }
    if (this.seekEl) {
      this.seekEl.addEventListener("pointerdown", this.onSeekStart)
      this.seekEl.addEventListener("pointerup", this.onSeekEnd)
      this.seekEl.addEventListener("input", this.onSeekInput)
      this.seekEl.addEventListener("change", this.onSeekEnd)
      // 触屏兜底（部分 WebView 不派发 pointer 事件）
      this.seekEl.addEventListener("touchstart", this.onSeekStart, {
        passive: true,
      })
      this.seekEl.addEventListener("touchend", this.onSeekEnd)
    }
  }

  /** v1.2.9 #F5：退出回放时隐藏进度条、解绑事件、清空每帧回调 */
  private hideReplaySeek() {
    const bar = document.getElementById("replaySeekBar")
    if (bar) bar.setAttribute("hidden", "")
    if (this.seekEl) {
      this.seekEl.removeEventListener("pointerdown", this.onSeekStart)
      this.seekEl.removeEventListener("pointerup", this.onSeekEnd)
      this.seekEl.removeEventListener("input", this.onSeekInput)
      this.seekEl.removeEventListener("change", this.onSeekEnd)
      this.seekEl.removeEventListener("touchstart", this.onSeekStart)
      this.seekEl.removeEventListener("touchend", this.onSeekEnd)
    }
    this.container.replayPaused = false
    this.userScrubbing = false
    this.container.replayTimeScaleHook = null
    this.container.replayFrameHook = null
    // 隐藏「退出回放」并解绑
    if (this.exitBtn) {
      this.exitBtn.removeEventListener("click", this.exitHandler)
      this.exitBtn.setAttribute("hidden", "")
      this.exitBtn = null
    }
    // v1.2.17 #4：解绑并复位倍速按钮
    if (this.speedBtn) {
      this.speedBtn.removeEventListener("click", this.onSpeedClick)
      this.speedBtn = null
    }
    // v1.2.24：解绑并复位视角切换按钮
    if (this.camBtn) {
      this.camBtn.removeEventListener("click", this.onCamClick)
      this.camBtn = null
    }
    // v1.2.13 #replay：恢复底部栏显示
    const panel = document.getElementById("panel")
    if (panel) panel.style.removeProperty("display")
    // v1.2.19 #2：恢复设置齿轮显示，并用 opacity 做过渡避免突跳。
    // 先把 display 清掉让元素回到 CSS 默认 flex，下一帧再恢复 opacity。
    const menu = document.getElementById("menu")
    if (menu) {
      menu.style.removeProperty("display")
      menu.style.opacity = "0"
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          menu.style.transition = "opacity 0.18s ease"
          menu.style.opacity = "1"
          // 动画结束后清理内联样式，避免后续 hover/active 被覆盖
          setTimeout(() => {
            menu.style.removeProperty("opacity")
            menu.style.removeProperty("transition")
          }, 200)
        })
      })
    }
    document.body.classList.remove("replay-mode")
  }

  override handleHit(_: HitEvent) {
    this.container.updateLastShot()
    // v1.2.9 #F3 / #F5：每杆起手记账（隔离 outcome + 起始快照 + 头less 预演）
    this.beginShotBookkeeping()
    // v1.2.27：起步不直接写 timeScale（advance 每帧由 replayTimeScaleHook 决定，
    // 该钩子返回用户选择的全局倍速）。保留此赋值仅为兼容旧逻辑，会被每帧覆盖。
this.container.timeScale = 1
// v1.3.58：标记出杆，updateReplayCamera 从此开始判断是否允许微调
this.shotInFlight = true
this.hit()
return this
}

override handleStationary(_) {
// v1.2.6 #232：球已静止，等待下一次击球。
// v1.3.58：本杆结束，撤掉微调目标，机位回到锁定状态等待下一杆重新定位
this.shotInFlight = false
this.container.view.camera.setReplayNudge(null)
this.container.timeScale = 1
    const outcome = this.container.table.outcome
    this.container.recorder.updateBreak(outcome, false, false)
    if (this.shots.length > 0 && this.timer === undefined) {
      this.playNextShot(this.delay)
    }
    if (this.shots.length === 0 && this.timer === undefined) {
      // v1.2.11 #user：回放结束后先暂停，不弹「回放结束」按钮，
      // 保留进度条与「退出回放」按钮，让用户先自行拖动进度条回看本局。
      this.container.timeScale = 1
      this.container.replayPaused = true
      return this
    }
    return this
  }

  override handleInput(input: Input): Controller {
    this.commonKeyHandler(input)
    return this
  }

  override handleBreak(event: BreakEvent): Controller {
    this.container.table.updateFromShortSerialised(event.init)
    this.shots = [...event.shots]
    // v1.3.59：换局后事件序列整批替换，旧的 shotMeta / currentShotIndex 全部失效，
    // 必须一并重置，否则 shotEventOffsets 指向新序列、shotMeta 仍是旧局的，
    // 拖动进度条会定位到完全错误的杆。
    this.allShots = [...this.shots]
    this.shotEventOffsets = this.buildShotOffsets()
    this.currentShotIndex = -1
    this.shotMeta = []
    this.diagram = event.diagram
    this.container.table.showSpin(true)
    if (event.retry) {
      return this.retry()
    }
    this.playNextShot(this.delay)
    return this
  }

  override handleAbort(_: AbortEvent): Controller {
    clearTimeout(this.timer)
    this.timer = undefined
    // v1.2.6 #232：退出回放，恢复正常速度并清除框定焦点
    this.container.timeScale = 1
    this.container.view.camera.clearReplayFrame()
    // v1.2.9 #F5：隐藏回放进度条
    this.hideReplaySeek()
    return new End(this.container)
  }

  retry() {
    clearTimeout(this.timer)
    this.timer = undefined
    // v1.2.6 #232：转实时重打，恢复正常速度并清除框定焦点
    this.container.timeScale = 1
    this.container.view.camera.clearReplayFrame()
    // v1.2.9 #F5：隐藏回放进度条
    this.hideReplaySeek()
    this.container.table.updateFromShortSerialised(this.init)
    const aim = AimEvent.fromJson(this.firstShot)
    this.container.table.cueball = this.container.table.balls[aim.i]
    this.container.rules.cueball = this.container.table.cueball
    this.container.table.cueball.pos.copy(aim.pos)
    this.container.table.cue.aim = aim
    this.container.view.camera.forceMode(this.container.view.camera.aimView)
    return new Aim(this.container)
  }
}
