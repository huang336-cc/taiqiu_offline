import { Vector3 } from "three"
import { Ball } from "../../../model/ball"
import { Table } from "../../../model/table"
import { Outcome, OutcomeType } from "../../../model/outcome"
import { R } from "../../../model/physics/constants"
import { Cue } from "../../../view/cue"
import { AimEvent } from "../../../events/aimevent"
import { DecisionContext } from "./shotcontext"
import { OffenseCandidate, distToRail } from "./offense"

/**
 * v1.3.91：物理级母球停位预测（专业级 AI 走位规划的地基）。
 *
 * ## 为什么必须重做
 *
 * 改造前的 `estimateStop()` 是一个纯几何近似：母球沿「切线方向」直线滑出，
 * 距离 = f(切球厚薄, 力度)。实测这个模型的 **误差中位数高达 31R（≈1 米）**，
 * P90 达 65R，最大值超过 1900R（母球在台面上弹了几十次库）。
 * 也就是说：它是**错的**。
 *
 * 后果（tools/harness/botpos.ts --cluster 实测）：启用多步走位前瞻后，
 * 「下一杆有球可打」的比例从 89.9% **掉到** 85.9% —— 前瞻在错误的前提下
 * 做规划，越算越糟。这是「走位规划」功能一直没体现出价值的原因。
 *
 * ## 现在怎么做
 *
 * 母球撞后的运动由共享物理引擎决定（摩擦减速、库边反弹、旋转效应、
 * 与其它球的二次碰撞……），这些东西没有一个闭式解。所以这里不再"估算"，
 * 而是**真跑一遍**：把当前局面克隆一份，用与玩家完全相同的
 * `AimCalculator.generateShot()` 生成出杆参数、`table.hit()` 击球、
 * `table.advance()` 推进到全部静止，读出母球最终位置。
 *
 * 关键约束（不可违反）：
 *   ① 用的是**同一套物理**（`table.hit()` → `cueStrike`），AI 无特权；
 *   ② 用的是**同一套出杆生成**（`generateShot`），不含任何 AI 专属分支；
 *   ③ 克隆出来的临时桌上跑，**绝不触碰真实比赛桌**（决策必须是只读的）；
 *   ④ 无噪声（noise = 0）—— 预测的是「计划那一杆」，不是「实际那一杆」。
 *
 * 开销：一次预测 ≈ 一次真实击球的物理推进。走位规划只对排名前几的候选
 * 做前瞻（见 professional.ts rankPlans 的 cutoff），因此整体开销可控。
 */

/** 物理预测的推进步长（与 harness 一致，保证预测与实测同精度） */
const PREDICT_STEP = 0.001953125
/** 单次预测的推进上限（防止极端局面下卡死） */
const MAX_ADVANCE_STEPS = 200000

/**
 * 克隆一张临时台（含母球），用于「试打一杆」而不影响真实比赛桌。
 *
 * `fround()` 与 `setStationary()` 都要调 —— 前者按球台几何修正位置（避免
 * 克隆出越界的球），后者清空速度/旋转状态，否则上一杆的残余动量会让
 * 预测彻底失真。
 */
function cloneTable(ctx: DecisionContext): Table {
  const balls = ctx.table.balls.map((b: Ball) => {
    const nb = new Ball(b.pos.clone(), undefined, b.label)
    nb.setStationary()
    return nb
  })
  const table = new Table(balls)
  table.cue = new Cue()
  table.cueball = balls[0]
  return table
}

/**
 * 用真实物理预测「按候选 cand 的方式击球后，母球会停在哪」。
 *
 * @param ctx   决策上下文（提供真实的球台与袋口）
 * @param cand  选中的进攻候选
 * @param power 计划出杆速度（m/s）
 * @param spin  计划杆法（x 左右塞 / y 高低杆）
 * @returns 母球最终停位；预测失败（物理异常）时返回 null
 */
export function predictCueStop(
  ctx: DecisionContext,
  cand: OffenseCandidate,
  power: number,
  spin: Vector3
): Vector3 | null {
  try {
    const table = cloneTable(ctx)
    const cueball = table.cueball!
    // 注意：这里用 ctx.calculator 的 pockets 与真实局面完全一致，
    // 且瞄准点是候选自带的 ghost 线 —— 与真正出杆时的方向同源。
    const aimPoint = ctx.calculator.getAimPoint(
      cueball.pos,
      cand.ball.pos,
      [cand.pocket]
    )
    const hit = ctx.calculator.generateShot(
      table,
      0, // 无瞄准噪声：预测的是计划那一杆
      power,
      aimPoint,
      spin
    )
    table.cue!.aim = (hit.tablejson as { aim: never }).aim
    table.cue!.hit(cueball)
    let guard = 0
    while (!table.allStationary() && guard++ < MAX_ADVANCE_STEPS) {
      table.advance(PREDICT_STEP)
    }
    if (guard >= MAX_ADVANCE_STEPS) return null
    // 母球落袋：停位无意义（这杆摔袋了），返回 null 让上层按风险处理
    if (!cueball.onTable()) return null
    return cueball.pos.clone()
  } catch {
    return null
  }
}

/**
 * 批量预测多个候选的停位（同一力度/杆法基准）。
 *
 * 返回与输入等长的数组，预测失败的项为 null。
 */
export function predictCueStops(
  ctx: DecisionContext,
  cands: OffenseCandidate[],
  power: number,
  spin: Vector3
): (Vector3 | null)[] {
  return cands.map((c) => predictCueStop(ctx, c, power, spin))
}

/** 停位贴库程度 0~1（与 offense.railHug 同口径） */
export function stopRailHug(stop: Vector3): number {
  return Math.max(0, 1 - distToRail(stop) / (4 * R))
}

/**
 * 停位到最近袋口的距离（米）——用于按**真实停位**复核摔袋风险。
 * 比 `estimateStop` 时代的轨迹近似可靠得多。
 */
export function stopNearestPocket(stop: Vector3, pockets: Vector3[]): number {
  let best = Infinity
  for (const p of pockets) {
    const d = stop.distanceTo(p)
    if (d < best) best = d
  }
  return best
}

/**
 * v1.4.2：按**真实出杆参数**（`AimEvent`，含已经加过噪声的角度/力度/杆法）
 * 在克隆桌上跑完整物理，返回台面与母球引用，供上层读 `table.outcome`。
 *
 * 与 `predictCueStop()` 同源（同克隆、同步长、同引擎），区别只在于：
 * 后者自己生成出杆（无噪声、预测「计划」），这里直接吃**已经生成的那一杆**
 * —— 于是可以校验「真正要打出去的这一杆」的合法性，而不只是计划值。
 * 步长与 container.step 同为 0.001953125，故预测与实际逐位一致（确定性）。
 */
export function simulateAim(
  ctx: DecisionContext,
  aim: AimEvent
): { table: Table; cueball: Ball } | null {
  try {
    const table = cloneTable(ctx)
    const cueball = table.cueball!
    table.cue!.aim = aim
    table.cue!.hit(cueball)
    let guard = 0
    while (!table.allStationary() && guard++ < MAX_ADVANCE_STEPS) {
      table.advance(PREDICT_STEP)
    }
    if (guard >= MAX_ADVANCE_STEPS) return null
    return { table, cueball }
  } catch {
    return null
  }
}

/**
 * v1.4.2：预测这一杆**是否合法**（八球「击球后无球碰库」口径）。
 *
 * 规则见 controller/rules/eightball.ts 第 3 条：
 *   本杆无任何球落袋，且「首次碰撞之后」没有任何 Cushion 事件 → 犯规。
 *
 * 判据与规则实现逐字同源（`Outcome.pots` / `Outcome.firstCollision` /
 * `Outcome.cueBallFirst`），只是跑在克隆桌上。
 *
 * @returns true=合法（有进球或首撞后有球碰库），false=必犯规，null=预测不可用
 */
export function predictsCushionContact(
  ctx: DecisionContext,
  aim: AimEvent
): boolean | null {
  const r = simulateAim(ctx, aim)
  if (!r) return null
  const outcome = r.table.outcome
  // 有球落袋 → 规则直接放行，不看撞库
  if (Outcome.pots(outcome).length > 0) return true
  const first = Outcome.firstCollision(Outcome.cueBallFirst(r.cueball, outcome))
  // 空杆：不是本条管的（首撞闸门负责），这里不判非法，避免与首撞逻辑打架
  if (!first) return true
  return outcome
    .slice(outcome.indexOf(first) + 1)
    .some((o) => o.type === OutcomeType.Cushion)
}

/**
 * 用**真实物理**复核某一杆的摔袋风险。
 *
 * ## 为什么必须有这个函数
 *
 * 摔袋是台球里代价最高的一种失误：母球落袋 = 送对手自由球 + 交出球权。
 * 所以「防摔袋」一直是专业档的核心能力（`avoidScratch`）。但它此前调用的是
 * `offense.reassessScratch()`，内部用 `estimateStop()` 做几何近似 ——
 * 而这个近似的误差中位数是 **32R（约 1 米）**，正是阶段2把走位前瞻整体
 * 切到物理预测的原因。唯独摔袋防护漏改了，导致判据几乎不感知真实风险：
 *
 *   实测（tools/harness/_scratchdiag.ts，299 样本）
 *     几何判据说「安全」的杆里，6.7% 物理上实际会摔袋；
 *     两法停位误差 中位 32.3R / 均值 33.4R / 最大 85.9R。
 *   对局级后果（tools/harness/botmatch.ts）：专业档摔袋率 61.4%/杆，
 *     反而比稳健档 49.1% 更差 —— 难度倒挂。
 *
 * ## 判定口径
 *
 * `predictCueStop()` 在母球落袋时返回 null，这本身就是最确定的摔袋信号；
 * 否则再算停位到最近袋心的距离，`< SCRATCH_SAFE` 视为「贴袋太近、不安全」。
 *
 * @param ctx   决策上下文
 * @param cand  候选（提供击球线）
 * @param power 计划力度（m/s）
 * @param spin  计划杆法（offset）
 */
export function reassessScratchPhysics(
  ctx: DecisionContext,
  cand: OffenseCandidate,
  power: number,
  spin: Vector3
): { stop: Vector3 | null; scratchRisk: number; wouldScratch: boolean } {
  const stop = predictCueStop(ctx, cand, power, spin)
  if (!stop) {
    // 物理预测里母球进袋了 —— 确定的摔袋
    return { stop: null, scratchRisk: 0, wouldScratch: true }
  }
  const nearest = stopNearestPocket(stop, ctx.pockets)
  return { stop, scratchRisk: nearest, wouldScratch: false }
}
