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
  /**
   * v1.5.4（#70）：本杆归属 —— "player" 玩家 / "ai" 电脑。
   * 进度条上的进球吸附点按此分色（玩家蓝、AI 红），
   * 让用户一眼看出「这一杆是谁进的球」。
   */
  owner: "player" | "ai"
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
   * 这里记录真实轨迹，供 seek / 回顾时参考（v1.5.4 起跟随视角已移除，
   * cueTrack 仅保留在 shotMeta 里备查，不再驱动相机）。
   */
  cueTrack?: [number, number, number][]
  /**
   * v1.5.4（#70）：本杆归属 —— "player" 玩家（保存者本人）/"ai" 对手（电脑）。
   * 来源是录制时 Recorder 打的 ow 标记（本地 sendEvent=1 缺省，对手 eventQueue=2），
   * 进度条进球点按它分色。旧回放数据无 ow，一律视为玩家杆。
   */
  owner: "player" | "ai"
}

/**
* v1.3.93：把本杆白球轨迹采样点并入框定点集。
*
* 轨迹点按 weight 向「三点质心」收缩后再并入 —— 相当于给轨迹打了折扣的
* 取景权重，既保证白球走位不滚出画面，又不会让长台走位把镜头拉到俯视感。
*
* 采样点可能很多（预演时按固定间隔记录），这里做等距抽稀，避免把
* buildReplayAnchor 的包围圆计算和相机插值无谓地拖慢。
*
* 独立成模块级函数（而非类静态私有方法）是为了能在 harness 里直接单测。
*/
export function expandFocusWithTrack(
  base: Vector3[],
  track?: [number, number, number][]
): Vector3[] {
  if (!track || track.length === 0) return base
  // 质心（只用基础三点，作为收缩基准，避免被轨迹自身带偏）
  let cx = 0
  let cy = 0
  for (const p of base) {
    cx += p.x
    cy += p.y
  }
  cx /= base.length
  cy /= base.length
  const WEIGHT = 0.55
  // 抽稀：最多取 8 个轨迹点，均匀分布
  const step = Math.max(1, Math.ceil(track.length / 8))
  const out = base.slice()
  for (let i = 0; i < track.length; i += step) {
    const t = track[i]
    // 已与某基础点几乎重合的轨迹点无信息量，跳过
    let dup = false
    for (const p of base) {
      if (Math.hypot(p.x - t[0], p.y - t[1]) < R * 0.5) {
        dup = true
        break
      }
    }
    if (dup) continue
    out.push(
      new Vector3(
        cx + (t[0] - cx) * WEIGHT,
        cy + (t[1] - cy) * WEIGHT,
        0
      )
    )
  }
  return out
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
  /**
   * v1.5.4（#70）：本杆归属。playNextShot 从原始杆 JSON 的 ow 标记读取
   * （Recorder 录制时打的：本地玩家缺省、对手=2），供逐杆兜底记账时
   * 写入 ShotMeta.owner（整局预计算失败时的降级路径）。
   */
  private pendingOwner: "player" | "ai" = "player"
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
  /**
   * v1.3.75：用户手动暂停（与拖动进度条的临时冻结 `userScrubbing` 分开）。
   * 放在实例字段而不是直接改 `container.replayPaused`，是因为拖动进度条结束时
   * 会把 `replayPaused` 复位成 false —— 那样用户按的暂停会被一次拖动无意取消掉。
   */
  private userPaused = false
  /** v1.3.75：「暂停 / 继续」按钮引用与点击处理 */
  private pauseBtn: HTMLButtonElement | null = null
  private onPauseClick = () => {
    this.userPaused = !this.userPaused
    this.applyPauseState()
    if (this.pauseBtn) {
      this.pauseBtn.textContent = this.userPaused ? "继续" : "暂停"
      this.pauseBtn.classList.toggle("paused", this.userPaused)
    }
  }
  /** v1.3.75：把「用户暂停 ∨ 拖动中」统一写回 container，并同步按钮外观 */
  private applyPauseState(): void {
    const frozen = this.userPaused || this.userScrubbing
    this.container.replayPaused = frozen
    if (this.pauseBtn) {
      this.pauseBtn.textContent = this.userPaused ? "继续" : "暂停"
      this.pauseBtn.classList.toggle("paused", this.userPaused)
    }
  }
  /** v1.2.17 #4：全局倍速按钮引用与点击处理（点击循环切换 0.5x/1x/2x/4x） */
  private speedBtn: HTMLButtonElement | null = null
  private onSpeedClick = () => {
    if (this.speedBtn) {
      this.speedBtn.textContent = this.cycleReplaySpeed()
    }
  }
  /**
   * v1.5.4（#70）：回放**自由视角**。
   *
   * 需求：删除原「跟随 / 俯视」二选一（跟随视角每杆自动框定机位，用户无法控制），
   * 改为用户可以任意转动/缩放的自定义机位，且必须始终对着球台。
   *
   * 实现（几何见 Camera.freeCam / replayFreeView）：
   *   - 单指拖动 → 绕球台中心转动方位角 / 俯仰角（orbitFreeBy）；
   *   - 双指捏合 / 滚轮 → 拉近拉远（zoomFreeBy）；
   *   - 注视点恒为台面中心，因此**任何角度都对着球台**。
   * 指针在 canvas 上监听，按下即按需切换相机到 free 模式。
   */
  private freeCamBound = false
  private freeCamPointers = new Map<number, { x: number; y: number }>()
  private freeCamPinchDist = 0
  private onFreePointerDown = (e: PointerEvent) => {
    const cam = this.container.view.camera
    if (cam.mode !== cam.replayFreeView) cam.forceFreeView()
    this.freeCamPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.freeCamPointers.size === 2) {
      const [a, b] = [...this.freeCamPointers.values()]
      this.freeCamPinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
    // setPointerCapture 只对「活跃指针」合法；自动化测试/合成事件传入的
    // pointerId 不是活跃指针时会抛 NotFoundError，吞掉即可（不影响手势）。
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
      /* 合成指针或指针已释放：忽略 */
    }
  }
  private onFreePointerMove = (e: PointerEvent) => {
    const prev = this.freeCamPointers.get(e.pointerId)
    if (!prev) return
    const cam = this.container.view.camera
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    this.freeCamPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.freeCamPointers.size >= 2) {
      // 双指捏合缩放
      const [a, b] = [...this.freeCamPointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.freeCamPinchDist > 0 && d > 0) {
        cam.zoomFreeBy(this.freeCamPinchDist / d)
      }
      this.freeCamPinchDist = d
      return
    }
    // 单指拖动旋转
    cam.orbitFreeBy(dx, dy)
  }
  private onFreePointerUp = (e: PointerEvent) => {
    this.freeCamPointers.delete(e.pointerId)
    if (this.freeCamPointers.size < 2) this.freeCamPinchDist = 0
  }
  private onFreeWheel = (e: WheelEvent) => {
    const cam = this.container.view.camera
    if (cam.mode !== cam.replayFreeView) cam.forceFreeView()
    e.preventDefault()
    cam.zoomFreeBy(e.deltaY > 0 ? 1.08 : 1 / 1.08)
  }
  /** 绑定自由视角手势（进入回放时调用一次） */
  private setupReplayFreeCam() {
    if (this.freeCamBound) return
    const el = this.container.view.canvas
    const target: HTMLElement | undefined =
      el instanceof HTMLElement ? el : (document.querySelector("canvas") as HTMLElement | undefined)
    if (!target) return
    this.freeCamBound = true
    target.addEventListener("pointerdown", this.onFreePointerDown)
    target.addEventListener("pointermove", this.onFreePointerMove)
    target.addEventListener("pointerup", this.onFreePointerUp)
    target.addEventListener("pointercancel", this.onFreePointerUp)
    target.addEventListener("pointerleave", this.onFreePointerUp)
    target.addEventListener("wheel", this.onFreeWheel, { passive: false })
  }
  private teardownReplayFreeCam() {
    if (!this.freeCamBound) return
    const el = this.container.view.canvas
    const target: HTMLElement | undefined =
      el instanceof HTMLElement ? el : (document.querySelector("canvas") as HTMLElement | undefined)
    this.freeCamBound = false
    this.freeCamPointers.clear()
    if (!target) return
    target.removeEventListener("pointerdown", this.onFreePointerDown)
    target.removeEventListener("pointermove", this.onFreePointerMove)
    target.removeEventListener("pointerup", this.onFreePointerUp)
    target.removeEventListener("pointercancel", this.onFreePointerUp)
    target.removeEventListener("pointerleave", this.onFreePointerUp)
    target.removeEventListener("wheel", this.onFreeWheel)
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
    // v1.5.4（#70）：图解 / 开伦仍沿用固定俯视（这两种是战术示意，不需要自由视角）；
    // 其余一律进入**自由视角** —— 相机永远对着球台，用户可自行转动/缩放。
    if (this.diagram || this.container.rules.rulename == "threecushion") {
      this.container.view.camera.forceMode(this.container.view.camera.topView)
    } else {
      this.container.view.camera.forceFreeView()
      this.setupReplayFreeCam()
    }
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
    // v1.5.4（#70）：从原始杆 JSON 读取归属标记（Recorder 录制时打的 ow），
    // 供 beginShotBookkeeping 的逐杆兜底记账使用。
    this.pendingOwner = (shot as { ow?: number }).ow === 2 ? "ai" : "player"
    this.container.setHudActivePlayer(this.currentActive)
    this.container.table.cueball = this.container.table.balls[aim.i]

    this.container.table.cueball.pos.copy(aim.pos)
    this.container.table.cue.aim = aim
    this.container.updateLastShot()
    // v1.3.58：回放同样要走「出杆即收杆」，每杆重新播放前把球杆亮回来
    this.container.table.cue.aimMode()
    this.container.table.cue.updateAimInput()
    this.container.table.cue.t = 1
  // v1.5.4（#70）：自由视角下不再每杆自动框定机位 —— 相机由用户控制，
  // 只在首次进入回放时定位（见构造函数 forceFreeView + setupReplayFreeCam）。
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
      owner: this.pendingOwner,
    }
    // v1.5.4（#70）：逐杆兜底记账同样要兜住 precomputeShot 的物理异常，
    // 否则 handleHit 会把异常抛进 animate 循环，本杆时长缺失导致回放卡死。
    try {
      this.precomputeShot(meta)
    } catch (e) {
      console.warn("[replay] incremental precompute failed, degrade to zero-duration:", (e as Error)?.message)
      meta.duration = Math.max(meta.duration, 1e-3)
    }
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
    // v1.5.4（#70）：预演物理对 `Depth exceeded resolving collisions` 容错。
    // 碰撞解算 100 层不收敛时 Table.advance 会 throw —— live 游戏靠 animate 的
    // 逐帧 try-catch 自恢复，而预演是固定步长循环，一次 throw 就会整杆报废，
    // 进度条整局预计算随之作废（表现为进度条退化成逐杆叠加、吸附点丢失）。
    // 这里捕获后按「已模拟到的时间/事件」收尾，本杆数据仍然可用。
    try {
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
    } catch {
      // 碰撞解算爆栈：以当前已产生的时间与事件收尾（duration/pots 部分有效）
      console.warn("[replay] precompute sim hit Depth-exceeded, settle with partial result")
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
        pots.push({ t: o.timestamp, ballId, pocketIdx, owner: meta.owner })
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
          // v1.5.4（#70）：归属来自录制时 Recorder 打的 ow 标记（2=对手/AI）
          owner: (shot as { ow?: number }).ow === 2 ? "ai" : "player",
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
    // v1.3.59：seek 重跑等同于一记真实出杆（确定性重跑物理到目标时刻）
    // v1.5.4（#70）：与 precomputeShot 同理，对 Depth-exceeded 物理异常容错，
    // 拖动进度条落到「碰撞解算不收敛」的杆段时按已推进到的位置收尾。
    const step = this.container.step
    let guard = 0
    try {
      while (
        this.container.table.time < localTarget &&
        !this.container.table.allStationary() &&
        guard++ < 500000
      ) {
        this.container.table.advance(step)
      }
    } catch {
      console.warn("[replay] seek advance hit Depth-exceeded, settle at current position")
    }
    this.container.table.updateBallMesh(0)
    // v1.5.4（#70）：自由视角下 seek 不再重定位相机 —— 镜头完全由用户控制，
    // 拖动进度条只重跑球局物理，视角保持用户当前角度不变。
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
    // v1.3.75：用户按了「暂停」→ 直接冻结（timeScale=0）。
    // 即使某处把 container.replayPaused 复位（如拖动进度条松手），
    // 用户显式按下的暂停也不会被悄悄取消。
    if (this.userPaused) return 0
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
        // v1.5.4（#70）：按归属分色 —— 玩家=蓝、AI=红，一眼看出谁进的球
        const cls = p.owner === "ai" ? "snap-ai" : "snap-player"
        html += `<span class="replay-snap ${cls}" style="left:${(f * 100).toFixed(2)}%"></span>`
      }
    }
    this.snapsEl.innerHTML = html
  }

  // ---- 进度条交互（拖动冻结物理、释放恢复；吸附到进球前时间点） ----
  private onSeekStart = () => {
    this.userScrubbing = true
    // v1.3.75：改用 applyPauseState，拖动结束后若用户此前按过暂停会正确恢复冻结
    this.applyPauseState()
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
    // v1.3.75：拖完是否恢复播放取决于用户有没有按过暂停，不能一律复位
    this.applyPauseState()
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
    // v1.3.75：进入回放时复位手动暂停，按钮文案回到「暂停」
    this.userPaused = false
    this.lastSnapSig = ""
    // v1.3.75：挂载「暂停 / 继续」按钮（回放全程常驻，置于倍速按钮之前）
    const pause = document.getElementById(
      "replayPauseBtn"
    ) as HTMLButtonElement | null
    this.pauseBtn = pause
    if (pause) {
      pause.disabled = false
      pause.textContent = "暂停"
      pause.classList.remove("paused")
      pause.addEventListener("click", this.onPauseClick)
    }
    this.container.replayTimeScaleHook = () => this.replayTimeScale()
this.container.replayFrameHook = () => {
this.tickSeekUI()
// v1.5.4（#70）：自由视角 —— 镜头由用户在 canvas 上拖动/缩放控制，
// 每帧回调不再干预相机（详见 setupReplayFreeCam / Camera.replayFreeView）。
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
    // v1.5.4（#70）：原「视角切换按钮（跟随/俯视）」已随跟随视角一并移除，
    // 自由视角不再需要按钮 —— 直接在画面上拖动即可转向、捏合/滚轮缩放。
    // 若旧版 HTML 仍残留该按钮，则主动隐藏，避免出现一个点了没反应的死按钮。
    const cam = document.getElementById("replayCamBtn") as HTMLButtonElement | null
    if (cam) cam.setAttribute("hidden", "")
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
    // v1.3.75：退出回放时复位手动暂停
    this.userPaused = false
    this.container.replayTimeScaleHook = null
    this.container.replayFrameHook = null
    // v1.3.75：解绑并复位暂停按钮
    if (this.pauseBtn) {
      this.pauseBtn.removeEventListener("click", this.onPauseClick)
      this.pauseBtn.textContent = "暂停"
      this.pauseBtn.classList.remove("paused")
      this.pauseBtn = null
    }
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
    // v1.5.4（#70）：解绑自由视角手势（跟随/俯视按钮已移除）
    this.teardownReplayFreeCam()
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
// v1.3.66：回放同样走 handleHit → hit() 出杆（镜头跟随改回每帧三点框定平滑，
// 不再做逐杆锁定 / 追袋口微调）
this.hit()
return this
}

override handleStationary(_) {
// v1.2.6 #232：球已静止，等待下一次击球。
// v1.5.4（#70）：自由视角，相机不随杆复位。
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
      // v1.3.75：整局回放播完后禁用暂停按钮 —— 此时物理已经走完，
      // 再点「继续」只会让空转的 timeScale 恢复，没有任何画面可看。
      if (this.pauseBtn) {
        this.pauseBtn.disabled = true
        this.pauseBtn.textContent = "暂停"
        this.pauseBtn.classList.remove("paused")
      }
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
    // v1.2.6 #232：退出回放，恢复正常速度
    this.container.timeScale = 1
    // v1.2.9 #F5：隐藏回放进度条
    this.hideReplaySeek()
    return new End(this.container)
  }

  retry() {
    clearTimeout(this.timer)
    this.timer = undefined
    // v1.2.6 #232：转实时重打，恢复正常速度
    this.container.timeScale = 1
    // v1.2.9 #F5：隐藏回放进度条
    this.hideReplaySeek()
    this.container.table.updateFromShortSerialised(this.init)
    // v1.5.4（#71）：offTable 是上一杆物理动画留下的运行时标志（渲染层据此
    // 隐藏出界球），重打会完全重置球局，这里必须一并清掉，否则瞄准阶段
    // 白球会因残留标志而隐身。
    this.container.table.balls.forEach((b) => {
      b.offTable = false
      b.wasAirborne = false
    })
    const aim = AimEvent.fromJson(this.firstShot)
    this.container.table.cueball = this.container.table.balls[aim.i]
    this.container.rules.cueball = this.container.table.cueball
    this.container.table.cueball.pos.copy(aim.pos)
    this.container.table.cue.aim = aim
    this.container.view.camera.forceMode(this.container.view.camera.aimView)
    return new Aim(this.container)
  }
}
