import { Vector3 } from "three"
import { HitEvent } from "../../events/hitevent"
import { Table } from "../../model/table"
import { offCenterLimit, R } from "../../model/physics/constants"
import { atan2 } from "../../utils/utils"
import { Pocket } from "../../model/physics/pocket"
import { PocketGeometry } from "../../view/pocketgeometry"
import { Knuckle } from "../../model/physics/knuckle"
import { TableGeometry } from "../../view/tablegeometry"
import { Ball } from "../../model/ball"

/**
 * v1.4.0：「目标球 → 中袋」连线在库面上的穿越点超出中袋口多少（米）。
 *
 * 【几何原理】中袋（N/S）是上下长库**中间开的豁口**，口半宽 =
 * PocketGeometry.middleKnuckleInset（2.6R，即两个膝盖中心距袋心的距离）。
 * 目标球沿直线滚向袋心，这条线与库面（y = ±tableY）的交点若落在口外，
 * 球会先撞上库面/膝盖弹回 —— 与力度无关，几何上必失。
 *
 * 角袋不适用本判据：角袋开在库的**端点**，球沿库滚动时被库面约束贴库滑行，
 * 滑到库尽头自然坠入袋 jaw（实测贴库球沿库打角袋 100%，而同样的
 * 「穿越点在库面上」的连线画法对角袋也成立 —— 不能用它否决角袋）。
 *
 * 【实测标定】tools/harness/railpocket.ts（每格 32 杆，power = 95R）：
 *   球贴上库（y = 21R − 1.5R），母球贴同库：
 *     球x=−2R  穿越点 1.41R（口内）→ 打中袋 100%
 *     球x=−6R  穿越点 4.23R（口外）→ 打中袋   0%
 *     球x=−10R 穿越点 7.08R（口外）→ 打中袋   0%
 *     球x=−14R 穿越点 9.90R（口外）→ 打中袋 18.8%（噪声尾巴挤进）
 *   判据与全部实测吻合。
 *
 * @returns 穿越点超出中袋口的距离（米）；≤ 0 表示口内（可打）。
 *          非中袋（角袋）或几何上无意义（袋在库内侧 / 连线不朝库外）时
 *          返回 null（不适用）。
 */
export function railMidMouthExcess(
  ballPos: Vector3,
  pocket: Vector3
): number | null {
  // 中袋判定：N/S 袋的 |x| ≈ 0，角袋 |x| ≈ PX ≈ tableX + 2.6R
  if (Math.abs(pocket.x) > TableGeometry.tableX * 0.5) return null
  // 袋在库外哪一侧（N = +y，S = −y）
  const side = Math.sign(pocket.y)
  if (side === 0) return null
  const lineY = side * TableGeometry.tableY
  const dy = pocket.y - ballPos.y
  // 连线必须朝「袋所在的那半场」延伸，否则无穿越意义
  if ((lineY - ballPos.y) * dy <= 0) return null
  const t = (lineY - ballPos.y) / dy
  const crossX = ballPos.x + t * (pocket.x - ballPos.x)
  return Math.abs(crossX) - PocketGeometry.middleKnuckleInset
}

/**
 * v1.4.0：findBestPocket 用的「贴库/跨库打中袋」罚分。
 *
 * 穿越点在口外 → 罚 2.0（切角分值域 [0,2]，任何切角优势都翻不过）；
 * 口内但贴近膝盖（0 ~ 1.3R）→ 渐进罚 0~0.6，让「贴着膝盖的侥幸球」
 * 也让位给干净的角袋线路。null（不适用）→ 0。
 */
export function railMidMouthPenalty(
  ballPos: Vector3,
  pocket: Vector3
): number {
  const excess = railMidMouthExcess(ballPos, pocket)
  if (excess === null) return 0
  if (excess > 0) return 2.0
  // 口内但贴膝盖：excess ∈ (−2.6R, 0]，越接近 0 越悬
  const near = 1 - Math.min(1, -excess / (1.3 * R))
  return near * 0.6
}

/**
 * AimCalculator provides logic for the bot to calculate shot angles and power.
 * It uses a "ghost ball" method to determine where the cue ball should hit the target ball
 * to send it into a pocket.
 */
export class AimCalculator {
  private static readonly POCKET_INSET_FACTOR = 0.94
  private static readonly GHOST_BALL_DISTANCE_FACTOR = 2.001
  private static readonly RANDOM_OFFSET_RANGE = 0.6
  /**
   * v1.3.75：ghost ball 退化保护阈值。
   *
   * 病根：出杆方向 = atan2(ghost − cueBall)。当母球几乎贴在目标球上、且位于
   * 目标球的**袋口侧**时（真实对局里开球后球堆密集、或母球撞完停在球边，
   * 非常常见），ghost 点就在母球脚边，`ghost − cueBall` 的长度趋近 0，
   * 方向完全由浮点残差决定 —— 实测偏 100°~340°，母球朝一个一颗球都没有的
   * 方向飞出去，判「空杆，未击中任何球」直接送自由球。用户反馈的
   * 「ai 还是在乱打，未击打任何球」就是这个。贴球场景实测空杆率 1.7%~3%。
   *
   * 处理：距离小于该阈值时退回「直接瞄准目标球心」——母球→球心 的距离恒 ≥ 2R，
   * 方向稳定，就算打厚打不进，也保证碰到球、不空杆。
   */
  private static readonly MIN_AIM_DISTANCE = 1.2 * R

  static readonly DEFAULT_SHOT_POWER = 90 * R
  static readonly MAX_SHOT_POWER = 110 * R
  public readonly pockets: Vector3[]
  public readonly knuckles: Vector3[]
  /** AI 瞄准噪声缩放：<1 让电脑更精准（专业/更困难模式用）。默认 1。 */
  private readonly noiseScale: number

  constructor(noiseScale = 1) {
    this.noiseScale = noiseScale
    this.pockets = this.extractPocketPositions(PocketGeometry.pocketCenters)
    this.knuckles = this.extractPocketKnucklePositions(PocketGeometry.knuckles)
  }

  /**
   * Calculates the ideal position for the cue ball to be at the moment of impact
   * with the target ball to send it towards the best pocket.
   */
  public getAimPoint(
    cuePos: Vector3,
    targetPos: Vector3,
    pockets: Vector3[] = this.pockets
  ): Vector3 {
    const ghost = this.ghostBallFor(cuePos, targetPos, pockets)
    // v1.3.75：ghost 退化保护（母球贴在目标球袋口侧时方向会失控，见
    // MIN_AIM_DISTANCE 注释）。退回瞄准球心，宁可打厚也不空杆。
    if (cuePos.distanceTo(ghost) < AimCalculator.MIN_AIM_DISTANCE) {
      return targetPos.clone()
    }
    return ghost
  }

  /**
   * v1.3.75：取未做退化保护的原始 ghost 点。
   * 候选枚举（professional.ts 的 enumeratePlans）要用它判断某条
   * 「球 × 袋口」线路是否退化，退化线路应当整个剔除、换别的球打，
   * 而不是像 getAimPoint 那样退化成直击。
   */
  public ghostBallFor(
    cuePos: Vector3,
    targetPos: Vector3,
    pockets: Vector3[] = this.pockets
  ): Vector3 {
    const bestPocket = this.findBestPocket(cuePos, targetPos, pockets)
    return this.calculateGhostBallPos(targetPos, bestPocket)
  }

  /**
   * Adjusts pocket centers slightly inward to ensure balls don't just hit the corner.
   */
  private extractPocketPositions(pockets: Pocket[]): Vector3[] {
    return pockets.map((pocket) =>
      pocket.pos.clone().multiplyScalar(AimCalculator.POCKET_INSET_FACTOR)
    )
  }

  private extractPocketKnucklePositions(knuckles: []): Vector3[] {
    return knuckles
      .map((knuckle) => (knuckle as Knuckle).pos.clone())
      .map((pos) => {
        return pos.lerp(this.closestPocket(pos), 0.5)
      })
  }

  private closestPocket(pos) {
    return [...this.pockets].sort(
      (a, b) => pos.distanceTo(a) - pos.distanceTo(b)
    )[0]
  }

  public closestKnuckles(pos) {
    return [...this.knuckles]
      .sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b))
      .slice(0, 2)
  }

  /**
   * Generates a HitEvent for a shot towards a target position, optionally adding noise.
   *
   * v1.3.91：新增 elevation / elevationNoise 两个**带默认值**的参数，用于
   * 专业级 AI 在贴球场景下打扎杆。默认 0，既有调用点（clawbreak/thefarjaw/
   * professional 的普通杆）行为完全不变。
   *
   * 注意 elevation 走的是与玩家完全相同的物理通道（cueStrike 的
   * velCos = vel·cos(elevation) 牺牲平动、spinRate ∝ 1/cos 放大旋转），
   * AI 不拥有任何特权。
   */
  public generateShot(
    table: Table,
    noise: number,
    power: number,
    targetPos: Vector3 = new Vector3().random(),
    spinOffset: Vector3 = AimCalculator.randomSpin(),
    elevation: number = 0,
    elevationNoise: number = 0
  ): HitEvent {
    const { cueball, cue, balls } = table
    const { aim } = cue

    aim.pos.copy(cueball.pos)
    aim.i = balls.indexOf(cueball)

    const lineTo = targetPos.clone().sub(cueball.pos)
    aim.angle = atan2(lineTo.y, lineTo.x) + (Math.random() - 0.5) * noise * this.noiseScale
    aim.power = power
    aim.offset = spinOffset
    // v1.3.91：抬杆角（扎杆）。噪声只加在扎杆场景，普通杆保持精确 0。
    aim.elevation =
      elevation +
      (elevationNoise > 0 ? (Math.random() - 0.5) * elevationNoise : 0)

    // v1.3.66：原逻辑在「球杆后方被挡」时会把打点强行覆盖成 (0, +offCenterLimit)，
    // 即 +0.45 高杆/跟杆——这会把 AI 精心算好的「低杆防摔袋」抹掉，反而把母球
    // 推进袋口。这里只去掉可能导致杆法异常的侧旋(x)，纵向打点(y，低杆防摔袋)照常保留。
    if (cue.intersectsAnything(table, aim)) {
      aim.offset.x = 0
    }

    return new HitEvent(table.serialiseHit())
  }

  /**
   * Finds the pocket that requires the smallest cut angle for the given shot.
   */
  public findBestPocket(
    cuePos: Vector3,
    targetPos: Vector3,
    pockets: Vector3[]
  ): Vector3 {
    return pockets
      .map((p) => ({
        pocket: p,
        score: this.calculateCutScore(cuePos, targetPos, p),
      }))
      .sort((a, b) => a.score - b.score)[0].pocket
  }

  /**
   * Calculates a score based on the cut angle.
   *
   * v1.4.0：叠加「贴库/跨库打中袋」的可行性惩罚（见 railMidMouthExcess）。
   *
   * 【为什么必须加在 findBestPocket 这一层】
   *   用户反馈：「当白球和击打球靠边库时，电脑还是选择打中袋，而不是打
   *   远处的边袋」。稳健/激进两档的选袋完全走本函数（按切角分挑袋），
   *   专业档的出杆 ghost 也经由 getAimPoint 单袋调用本路径 —— 若只改
   *   decision/offense.ts 的评分层，稳健/激进档根本不受影响。
   *
   *   实测标定（tools/harness/railpocket.ts，每格 32 杆，power = 95R）：
   *   贴上长库的目标球打中袋，只要球→袋心连线与库面的穿越点超出中袋口
   *   （middleKnuckleInset = 2.6R），进球率 0~19%；同一颗球打角袋（沿库
   *   滚入袋 jaw）100%。罚 2.0 分保证任何切角优势都翻不过这道墙。
   */
  private calculateCutScore(
    cuePos: Vector3,
    targetPos: Vector3,
    pocket: Vector3
  ): number {
    const shotLine = this.getDirectionVector(cuePos, targetPos)
    const pocketLine = this.getDirectionVector(targetPos, pocket)
    return 1 - shotLine.dot(pocketLine) + railMidMouthPenalty(targetPos, pocket)
  }

  /**
   * Calculates the position where the cue ball should be to hit the target ball towards the pocket.
   */
  private calculateGhostBallPos(targetPos: Vector3, pocket: Vector3): Vector3 {
    const incidentVector = this.getDirectionVector(pocket, targetPos)
    return targetPos
      .clone()
      .add(
        incidentVector.multiplyScalar(
          R * AimCalculator.GHOST_BALL_DISTANCE_FACTOR
        )
      )
  }

  private getDirectionVector(from: Vector3, to: Vector3): Vector3 {
    return new Vector3().subVectors(to, from).normalize()
  }

  static randomSpin() {
    return new Vector3(
      0,
      (Math.random() - 0.5) * AimCalculator.RANDOM_OFFSET_RANGE
    )
  }

  /**
   * @param pos Current position of the moving ball
   * @param vel Velocity vector of the moving ball
   * @param target Center position of the stationary ball
   */
  static checkCollision(pos: Vector3, vel: Vector3, target: Vector3): boolean {
    // 1. Vector from moving ball to target
    const toTarget = new Vector3().subVectors(target, pos)

    // 2. Project toTarget onto the velocity vector to find the closest point's distance along the path
    const velNormalized = vel.clone().normalize()
    const dParallel = toTarget.dot(velNormalized)

    // 3. If dParallel is negative, the target is "behind" the moving ball
    if (dParallel < 0) return false

    // 4. Calculate the perpendicular distance squared using the Pythagorean theorem:
    // distSq = |toTarget|^2 - dParallel^2
    const distSq = toTarget.lengthSq() - dParallel * dParallel

    // 5. Collision occurs if the closest distance is within the combined radii
    return distSq <= 2 * R * 2 * R
  }

  static ghostBallPosition(
    cue: Vector3,
    target: Vector3,
    overlap: number
  ): Vector3 {
    const baseAngle = Math.atan2(cue.y - target.y, cue.x - target.x)
    const offsetAngle = Math.asin(1 - Math.abs(overlap)) * Math.sign(overlap)
    const angle = baseAngle + offsetAngle
    return new Vector3(
      target.x + Math.cos(angle) * 2 * R,
      target.y + Math.sin(angle) * 2 * R,
      0
    )
  }
  /**
   * Returns the distance to the nearest table corner.
   */
  static cornerDistance(pos: Vector3): number {
    const x = TableGeometry.X
    const y = TableGeometry.Y
    return Math.min(
      pos.distanceTo(new Vector3(-x, y, 0)),
      pos.distanceTo(new Vector3(x, y, 0)),
      pos.distanceTo(new Vector3(-x, -y, 0)),
      pos.distanceTo(new Vector3(x, -y, 0))
    )
  }

  /**
   * Finds the ball closest to any corner.
   */
  static findAnchor(balls: Ball[]): Ball {
    return [...balls].sort(
      (a, b) =>
        AimCalculator.cornerDistance(a.pos) -
        AimCalculator.cornerDistance(b.pos)
    )[0]
  }

  /**
   * Calculates the tangent vector (exit vector) of the cue ball after impact.
   */
  static getTangentVector(
    cue: Vector3,
    target: Vector3,
    ghost: Vector3
  ): Vector3 {
    let tx = -(ghost.y - target.y)
    let ty = ghost.x - target.x
    if (tx * (ghost.x - cue.x) + ty * (ghost.y - cue.y) < 0) {
      tx = -tx
      ty = -ty
    }
    return new Vector3(tx, ty, 0).normalize()
  }

  /**
   * Returns the Y-coordinate of the long rail closest to the given position.
   */
  static getActiveRailY(pos: Vector3): number {
    return Math.abs(pos.y - TableGeometry.Y) < Math.abs(pos.y + TableGeometry.Y)
      ? TableGeometry.Y
      : -TableGeometry.Y
  }

  /**
   * Returns true if the tangent vector points towards the specified rail.
   */
  static isHeadingToRail(
    ghost: Vector3,
    tangent: Vector3,
    railY: number
  ): boolean {
    return (railY - ghost.y) * tangent.y > 0
  }

  /**
   * Calculates a score based on how much the tangent vector points towards the anchor ball.
   * Lower scores mean pointing "more away".
   */
  static getNaturalLongScore(
    tangent: Vector3,
    ghost: Vector3,
    anchor: Vector3
  ): number {
    const toAnchor = new Vector3().subVectors(anchor, ghost).normalize()
    return tangent.dot(toAnchor)
  }

  /**
   * Returns true if clockwise spin (running side) is needed based on incident vector and cushion normal.
   */
  static isClockwiseSpin(v: Vector3, n: Vector3): boolean {
    return new Vector3().crossVectors(v, n).z > 0
  }
}
