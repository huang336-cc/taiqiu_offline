import { Ball } from "./ball"
import { R } from "./physics/constants"

export enum OutcomeType {
  Pot = "Pot",
  Cushion = "Cushion",
  Collision = "Collision",
  Hit = "Hit",
  Proximity = "Proximity",
  /**
   * v1.3.95：球离开台面（跳台 / 飞出球桌）。
   *
   * v1.3.94 引入跳球后，空中的球会越过库边掉到台面外，而规则层完全没有
   * 「出界」这个概念 —— 于是它要么被 Cushion.bounceAny 算出荒谬速度引发
   * 连锁碰撞（Depth exceeded 直接抛错），要么永不静止使本杆无法结算。
   * 把出界做成一种 Outcome，就能像落袋/撞库一样自然流进四套规则的既有
   * 判决流程（详见 utils/offtable.ts）。
   */
  OffTable = "OffTable",
}

export class Outcome {
  type: OutcomeType
  timestamp: number
  ballA: Ball | null = null
  ballB: Ball | null = null
  incidentSpeed: number
  cushion?: string

  constructor(
    type: OutcomeType,
    ballA: Ball,
    ballB: Ball,
    incidentSpeed: number,
    timestamp: number,
    cushion?: string
  ) {
    this.type = type
    this.ballA = ballA
    this.ballB = ballB
    this.incidentSpeed = incidentSpeed
    this.timestamp = timestamp
    this.cushion = cushion
  }

  static pot(ballA: Ball, incidentSpeed: number, timestamp: number) {
    return new Outcome(OutcomeType.Pot, ballA, ballA, incidentSpeed, timestamp)
  }

  static cushion(
    ballA: Ball,
    incidentSpeed: number,
    timestamp: number,
    cushion?: string
  ) {
    return new Outcome(
      OutcomeType.Cushion,
      ballA,
      ballA,
      incidentSpeed,
      timestamp,
      cushion
    )
  }

  static collision(
    ballA: Ball,
    ballB: Ball,
    incidentSpeed: number,
    timestamp: number
  ) {
    return new Outcome(
      OutcomeType.Collision,
      ballA,
      ballB,
      incidentSpeed,
      timestamp
    )
  }

  static hit(ballA: Ball, incidentSpeed: number, timestamp: number) {
    return new Outcome(OutcomeType.Hit, ballA, ballA, incidentSpeed, timestamp)
  }

  static proximity(
    ballA: Ball,
    ballB: Ball,
    distance: number = 0,
    timestamp: number
  ) {
    return new Outcome(OutcomeType.Proximity, ballA, ballB, distance, timestamp)
  }

  /** v1.3.95：球飞出台面（入射速度用于规则层判定与罚分） */
  static offTable(ballA: Ball, incidentSpeed: number, timestamp: number) {
    return new Outcome(
      OutcomeType.OffTable,
      ballA,
      ballA,
      incidentSpeed,
      timestamp
    )
  }

  /** v1.3.95：本杆所有出界的球 */
  static offTableBalls(outcomes: Outcome[]): Ball[] {
    return outcomes
      .filter((o) => o.type === OutcomeType.OffTable)
      .map((o) => o.ballA!)
  }

  /** v1.3.95：母球是否出台了（决定「是否给对手自由球」） */
  static isCueBallOffTable(cueBall, outcomes: Outcome[]) {
    return Outcome.offTableBalls(outcomes).some((b) => b === cueBall)
  }

  static isCueBallPotted(cueBall, outcomes: Outcome[]) {
    return outcomes.some(
      (o) => o.type == OutcomeType.Pot && o.ballA === cueBall
    )
  }

  static isBallPottedNoFoul(cueBall, outcomes: Outcome[]) {
    return (
      outcomes.some((o) => o.type == OutcomeType.Pot && o.ballA !== null) &&
      !Outcome.isCueBallPotted(cueBall, outcomes)
    )
  }

  static pots(outcomes: Outcome[]): Ball[] {
    return outcomes
      .filter((o) => o.type == OutcomeType.Pot)
      .map((o) => o.ballA!)
  }
  static potCount(outcomes: Outcome[]) {
    return this.pots(outcomes).length
  }

  static onlyRedsPotted(outcomes: Outcome[]) {
    return this.pots(outcomes).every((b) => b.id > 6)
  }

  static firstCollision(outcome: Outcome[]) {
    const collisions = outcome.filter((o) => o.type === OutcomeType.Collision)
    return collisions.length > 0 ? collisions[0] : undefined
  }

  /**
   * v1.3.92：母球**首撞**的球是否落在合法目标集合里（八球规则判定用）。
   *
   * 为什么不能用 `firstCollision()`：
   * 那个方法返回 `collisions[0]` —— 只是 outcome 列表里第一条碰撞记录，
   * **不保证球A是母球**（母球可能先撞库，或两物体球互相碰撞先入列）。
   * harness 直接拿它判「首撞是否为目标球」，会把大量正常击球误判成犯规
   * （实测一局「进7球全部清台」的样本竟被记成 11 次首撞犯规）。
   *
   * 正确口径与 `isThreeCushionPoint` 一致：先用 `cueBallFirst` 把涉及母球的
   * 碰撞规范成 ballA = 母球，再取**第一条** ballA 为母球的碰撞。
   *
   * @returns 首撞球在 targets 内返回 true；母球一球未碰（空杆）返回 false；
   *          首撞对方球 / 黑8 返回 false
   */
  static firstCueContact(
    cueBall,
    outcome: Outcome[],
    targets: { includes(b: unknown): boolean } | unknown[]
  ): boolean {
    const normalised = Outcome.cueBallFirst(cueBall, outcome.slice())
    const first = normalised.find(
      (o) => o.type === OutcomeType.Collision && o.ballA === cueBall
    )
    if (!first) return false
    return (targets as { includes(b: unknown): boolean }).includes(first.ballB)
  }

  static isClearTable(table) {
    const onTable = table.balls.filter((ball) => ball.onTable())
    return onTable.length === 1 && onTable[0] === table.cueball
  }

  static isThreeCushionPoint(cueBall, outcomes: Outcome[]) {
    outcomes = Outcome.cueBallFirst(cueBall, outcomes).filter(
      (outcome) => outcome.ballA === cueBall
    )
    const cannons = new Set()
    let cushions = 0
    for (const outcome of outcomes) {
      if (outcome.type === OutcomeType.Cushion) {
        cushions++
      }
      if (outcome.type === OutcomeType.Collision) {
        cannons.add(outcome.ballB)
        if (cannons.size === 2) {
          return cushions >= 3
        }
      }
    }

    // Pass 2: Proximity point
    const proximity = outcomes.find(
      (o) => o.type === OutcomeType.Proximity && o.ballA === cueBall
    )
    if (proximity) {
      const collisionCount = new Set(
        outcomes
          .filter(
            (o) => o.type === OutcomeType.Collision && o.ballA === cueBall
          )
          .map((o) => o.ballB)
      ).size
      if (collisionCount === 1 && cushions >= 3) {
        return true
      }
    }

    return false
  }

  static getProximityScore(cueBall: Ball, outcomes: Outcome[]): number {
    const proximityOutcomes = outcomes.filter(
      (o) => o.type === OutcomeType.Proximity && o.ballA === cueBall
    )
    if (proximityOutcomes.length === 0) return 0

    const minDistance = Math.min(
      ...proximityOutcomes.map((o) => o.incidentSpeed)
    )

    if (minDistance <= 2 * R) return 3
    if (minDistance <= 3 * R) return 2
    if (minDistance <= 4 * R) return 1
    return 0
  }

  static cueBallFirst(cueBall, outcomes) {
    outcomes.forEach((o) => {
      if (o.type === OutcomeType.Collision && o.ballB === cueBall) {
        o.ballB = o.ballA
        o.ballA = cueBall
      }
    })
    return outcomes
  }

  serialise() {
    const s: any = {
      type: this.type,
      timestamp: this.timestamp,
      incidentSpeed: this.incidentSpeed,
      ballA: this.ballA ? { id: this.ballA.id } : null,
      ballB: this.ballB ? { id: this.ballB.id } : null,
    }
    if (this.cushion) {
      s.cushion = this.cushion
    }
    return s
  }
}
