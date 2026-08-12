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
  /** 本杆白球在 balls 数组中的下标 */
  cueballId: number
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
   *  true  = 俯视（固定俯视全局视角，相机停在台面上方俯瞰整桌）；
   *  false = 固定（固定侧后视角，相机停在击球点后上方，击球后不切俯视、不跟随）。
   * 默认「固定」，避免回放中击球后被切到俯视；需要俯瞰全局时再切到「俯视」。
   */
  private camTopDown = false
  /** v1.2.26：视角切换按钮（固定/俯视）引用与点击处理 */
  private camBtn: HTMLButtonElement | null = null
  private onCamClick = () => {
    this.camTopDown = !this.camTopDown
    const cam = this.container.view.camera
    if (this.diagram || this.container.rules.rulename === "threecushion") {
      cam.forceMode(cam.topView)
    } else {
      cam.forceMode(this.camTopDown ? cam.topView : cam.spectatorView)
    }
    if (this.camBtn) this.camBtn.textContent = this.currentCamLabel()
  }
  private currentCamLabel(): string {
    return this.camTopDown ? "俯视" : "固定"
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
    this.container.table.cue.updateAimInput()
    this.container.table.cue.t = 1
    // v1.2.17：回放全程使用进入时固定的视角（forceMode），不再每杆重新框定，
    // 也不再在进球前后切换/跟踪镜头，保证「击球→进球」视角稳定、时间间隔不倍速。
    if (this.diagram || this.container.rules.rulename == "threecushion") {
      this.container.view.camera.suggestMode(
        this.container.view.camera.topView
      )
    } else {
      this.container.view.camera.suggestMode(
        this.camTopDown ? this.container.view.camera.topView : this.container.view.camera.spectatorView
      )
    }
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
      cueballId: t.cueball.id,
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
    sim.cueball = sim.balls[meta.cueballId]
    sim.cue.aim = meta.aim.copy()
    sim.time = 0
    sim.outcome.length = 0
    sim.hit()
    const step = this.container.step
    let guard = 0
    while (!sim.allStationary() && guard++ < 500000) {
      sim.advance(step)
    }
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
          cueballId: this.simTable.cueball.id,
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
    t.cueball = t.balls[meta.cueballId]
    t.cue.aim = meta.aim.copy()
    t.time = 0
    t.outcome.length = 0
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
    const localTarget = Math.max(0, target - cum[idx])
    this.currentShotIndex = idx
    this.restoreShotStart(meta)
    this.container.table.hit()
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
   * v1.2.11 #user：回放每帧按当前物理时刻动态切换框定焦点。
   * 若当前处于某次进球的窗口内（球接近袋口），则框定「进球的球 → 对应袋口 → 白球」，
   * 实现「跟随当前进球」的跟踪动态镜头；否则保持本杆默认三点框定。
   */
  private updateReplayCamera() {
    if (this.diagram || this.container.rules.rulename === "threecushion") return
    const meta = this.shotMeta[this.currentShotIndex]
    if (!meta) return
    if (!meta.pots || meta.pots.length === 0) {
      if (meta.defaultFocus) {
        this.container.view.camera.updateReplayFocus(meta.defaultFocus)
      }
      return
    }
    const t = this.container.table.time
    const WINDOW_BEFORE = 220 // 进球前 220ms 开始跟踪
    const WINDOW_AFTER = 480 // 进球后 480ms 结束跟踪
    for (const pot of meta.pots) {
      if (t >= pot.t - WINDOW_BEFORE && t <= pot.t + WINDOW_AFTER) {
        if (pot.ballId >= 0 && pot.pocketIdx >= 0) {
          const ball = this.container.table.balls[pot.ballId]
          const pocket = PocketGeometry.pocketCenters[pot.pocketIdx]
          if (ball && pocket) {
            this.container.view.camera.updateReplayFocus([
              ball.pos,
              pocket.pos,
              this.container.table.cueball.pos,
            ])
            return
          }
        }
        this.container.view.camera.updateReplayFocus(meta.defaultFocus)
        return
      }
    }
    this.container.view.camera.updateReplayFocus(meta.defaultFocus)
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
    // v1.2.24：挂载视角切换按钮（固定/跟随），初始化为当前视角标签并绑定切换
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
    this.hit()
    return this
  }

  override handleStationary(_) {
    // v1.2.6 #232：球已静止，等待下一次击球。
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
