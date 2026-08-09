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
import { gameOverButtons } from "../utils/gameover"
import { Table } from "../model/table"
import { OutcomeType } from "../model/outcome"
import { State } from "../model/ball"

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
  /** 本杆各进袋事件的时间戳（ms，相对本杆起点），供进度条吸附点使用 */
  pots: number[]
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
   * v1.2.6 #232：回放「运动中提速」倍率。
   * 击球后到球静止之间（无论进洞与否）把物理时间倍率调高，加快看回放；
   * 球静止、下一次击球前恢复 1（正常速度）。每帧物理步数随之增加，
   * 但单步 dt 不变，故不影响碰撞稳定性。
   */
  private static readonly REPLAY_FAST = 3

  /**
   * v1.2.9 #F3：最后一颗球碰撞 / 最后一次进袋之后，再留出这段提前量（ms）才进入
   * 倍速，让玩家看清最后一次碰撞/进袋的收尾，再快进余下「滚定」过程。
   */
  private static readonly REPLAY_LEAD_MS = 80

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
  /** 吸附点 DOM 缓存签名，避免每帧重建 */
  private lastSnapSig = ""

  constructor(container, init, shots, _retry = false, delay = 1500, diagram?) {
    super(container)
    this.init = init
    this.diagram = diagram
    console.log(`init: ${JSON.stringify(init)}`)
    this.shots = [...shots]
    this.firstShot = this.shots[0]
    this.delay = diagram ? 0 : delay
    // v1.2.6 #232：回放起步为正常速度（杆间停留/相机移动用正常速度）
    this.container.timeScale = 1
    this.container.table.showTraces(true)
    this.container.table.updateFromShortSerialised(this.init)
    console.log(`shots: ${this.shots.length}`)
    console.log(`shots: ${JSON.stringify(this.shots)}`)
    const suggestCamera =
      this.diagram || this.container.rules.rulename == "threecushion"
        ? this.container.view.camera.topView
        : this.container.view.camera.spectatorView
    this.container.view.camera.forceMode(suggestCamera)
    this.playNextShot(this.delay * 1.5)
  }

  override onFirst() {
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
    // v1.2.6 #232：回放每杆框定「白球 + 被击球 + 对应球袋」三点。
    // 三库/图解模式无明确「被击球→球袋」语义，沿用俯视。
    if (this.diagram || this.container.rules.rulename == "threecushion") {
      this.container.view.camera.suggestMode(
        this.container.view.camera.topView
      )
    } else {
      this.container.view.camera.setReplayFrame(this.computeFocusPoints(aim))
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
  private computeFocusPoints(aim: AimEvent): Vector3[] {
    const table = this.container.table
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
    const t = this.container.table
    // 隔离本杆 outcome（每杆以干净数组开始）
    t.outcome.length = 0
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
    }
    this.precomputeShot(meta)
    this.shotMeta.push(meta)
    this.currentShotIndex = this.shotMeta.length - 1
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
    const pots: number[] = []
    for (const o of sim.outcome) {
      if (o.type === OutcomeType.Collision || o.type === OutcomeType.Pot) {
        if (o.timestamp > maxTs) maxTs = o.timestamp
      }
      if (o.type === OutcomeType.Pot) pots.push(o.timestamp)
    }
    meta.duration = sim.time
    // 无碰撞且无进袋 → 整杆常速（便于看清走位/失误）；否则最后事件 + 提前量后倍速
    meta.triggerT = maxTs >= 0 ? maxTs + Replay.REPLAY_LEAD_MS : Infinity
    meta.pots = pots
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
   * v1.2.9 #F3：每帧由 container.advance 回调，返回本帧回放倍速。
   * 规则：物理时间尚未越过本杆「最后碰撞/进袋 + 提前量」→ 常速；
   *       已越过 → 倍速（REPLAY_FAST）；球已静止（杆间停留）→ 常速。
   */
  private replayTimeScale(): number {
    if (this.container.table.allStationary()) return 1
    const meta = this.shotMeta[this.currentShotIndex]
    if (!meta || meta.triggerT == null) return 1
    return this.container.table.time >= meta.triggerT
      ? Replay.REPLAY_FAST
      : 1
  }

  /** v1.2.11 #F11：每帧刷新进度条位置（整局进度）与全局进球吸附点 */
  private tickSeekUI() {
    if (!this.seekEl) return
    if (!this.userScrubbing) {
      const { cum, total } = this.gameTotals()
      if (total > 0) {
        const idx = this.currentShotIndex
        const cur = cum[idx] + this.container.table.time
        const frac = Math.min(cur / total, 1)
        this.seekEl.value = String(Math.round(frac * 1000))
      }
    }
    this.renderSnaps()
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
        const globalT = cum[i] + (p - Replay.REPLAY_LEAD_MS)
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
          const globalT = cum[i] + (p - Replay.REPLAY_LEAD_MS)
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
    this.container.replayPaused = false
    this.userScrubbing = false
    this.lastSnapSig = ""
    this.container.replayTimeScaleHook = () => this.replayTimeScale()
    this.container.replayFrameHook = () => this.tickSeekUI()
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
  }

  override handleHit(_: HitEvent) {
    this.container.updateLastShot()
    // v1.2.9 #F3 / #F5：每杆起手记账（隔离 outcome + 起始快照 + 头less 预演）
    this.beginShotBookkeeping()
    // v1.2.9 #F3：起步常速，倍速由 container.advance 每帧按本杆 triggerT 动态决定
    this.container.timeScale = 1
    this.hit()
    return this
  }

  override handleStationary(_) {
    // v1.2.6 #232：球已静止，恢复常速，等待下一次击球（杆间停留用正常速度）
    this.container.timeScale = 1
    const outcome = this.container.table.outcome
    this.container.recorder.updateBreak(outcome, false, false)
    if (this.shots.length > 0 && this.timer === undefined) {
      this.playNextShot(this.delay)
    }
    if (this.shots.length === 0 && this.timer === undefined) {
      const outcome = this.container.table.outcome
      if (Array.isArray(outcome) && outcome.length) {
        const first = outcome[0].timestamp
        outcome.forEach((o) => {
          const sec = ((o.timestamp - first) / 1000).toFixed(2)
          console.log(`${o.type} ${sec} sec`)
        })
      }
      this.container.notifyLocal(
        {
          type: "Info",
          title: "回放结束",
          extra: gameOverButtons.replay + " " + gameOverButtons.lobby,
        },
        0,
        { lobby: () => (globalThis.location.href = LOBBY_URL) }
      )
      // v1.2.6 #232：回放结束，清除框定焦点，交还给 End 控制器管理相机
      this.container.view.camera.clearReplayFrame()
      // v1.2.9 #F5：隐藏回放进度条
      this.hideReplaySeek()
      return new End(this.container)
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
