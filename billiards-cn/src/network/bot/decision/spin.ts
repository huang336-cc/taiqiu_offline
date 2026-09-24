import { Vector3 } from "three"
import { R } from "../../../model/physics/constants"
import { DecisionContext } from "./shotcontext"
import { OffenseCandidate, segDistToPoint } from "./offense"
import { PositionPlan } from "./planner"

/**
 * v1.3.91：杆法选择器（专业级 AI 决策层 · 第三优先级）。
 *
 * 改造前 professional.ts 的 chooseSpin 只有一条规则：**默认压低杆防摔袋**。
 * 两个问题：
 *   ① 单调 —— 无论什么局面都在缩杆，看不见职业选手的高杆跟进、斯登停球；
 *   ② 不为走位服务 —— 杆法是走位的手段，不为「下一杆好不好打」服务
 *      就等于没在做走位。
 *
 * 职业选手的杆法逻辑是一条简单的对照：
 *   期望落位 ≈ 自然走位  → 斯登（中杆，母球撞后即停，职业清台最常用）
 *   需要走得更远         → 高杆跟进
 *   需要收住             → 低杆缩杆
 *   需要改变撞库后方向   → 左右加塞
 *   平推完全无法达成     → 扎杆（贴球场景备选，带额外误差）
 *
 * 重要约束：所有杆法的量值都限制在**玩家 UI 可达范围**内
 * （`|offset.x| ≤ 0.24`、`|offset.y| ≤ 0.45`、`elevation ≤ 0.42`），
 * 保证 AI 与玩家共用同一套物理、同一个操作上限，不存在特权。
 */

export type SpinKind = "stun" | "follow" | "draw" | "sidespin" | "jump" | "none"

export interface SpinChoice {
  /** 旋转向量：x = 左右塞，y = 高低杆（+ 跟进 / − 缩杆） */
  spin: Vector3
  /** 抬杆角（弧度），非扎杆时为 0 */
  elevation: number
  /** 是否扎杆 */
  isJump: boolean
  kind: SpinKind
  /** 自然走位与期望走位的差值（米），正值=需要走得更远 */
  delta: number
}

/** 摔袋风险区间：低于该值强制低杆把母球拉住（米） */
const SCRATCH_HARD = 2.0 * R
/** 摔袋风险警戒区：轻度过袋也收杆（米） */
const SCRATCH_SOFT = 5 * R
/** 自然走位与期望走位的容差：落在容差内视为「斯登刚好」（米） */
const STUN_TOLERANCE = 3 * R
/** 玩家 UI 可达的低杆极限（与 offCenterLimit * 玩家实际拖动比例对齐） */
const DRAW_MAX = -0.45
/** 玩家 UI 可达的高杆极限 */
const FOLLOW_MAX = 0.4
/** 左右塞的玩家可达极限 */
const SIDE_MAX = 0.24

/**
 * 选择本杆杆法。
 *
 * @param dctx     决策上下文
 * @param cand     选中的进攻候选
 * @param position 走位规划结果（提供期望落位与质量）
 */
export function chooseSpin(
  dctx: DecisionContext,
  cand: OffenseCandidate,
  position: PositionPlan
): SpinChoice {
  const spin = new Vector3(0, 0, 0)
  const none = (): SpinChoice => ({
    spin,
    elevation: 0,
    isJump: false,
    kind: "none",
    delta: 0,
  })
  if (!dctx.profile.useSpin) return none()

  // 1) 摔袋风险最高优先：用低杆把母球拉住。
  //    力度整体抬到中力后母球跑得远比小力时代远，风险区间相应外扩
  //    （原 1.6R/4R → 2.0R/5R），否则摔袋率会随力度上升而恶化。
  if (cand.scratchRisk < SCRATCH_HARD) {
    spin.y = DRAW_MAX
    return { spin, elevation: 0, isJump: false, kind: "draw", delta: 0 }
  }
  if (cand.scratchRisk < SCRATCH_SOFT) {
    spin.y = cand.stopToNext > 6 * R ? -0.3 : DRAW_MAX
    return { spin, elevation: 0, isJump: false, kind: "draw", delta: 0 }
  }

  // 2) 按走位需求选杆法。
  //    自然走位距离（母球撞后沿切线自然滑出的距离，由切球厚薄决定）：
  //    切得越薄，母球分离角越大、自然走得越远。
  const natural = cand.cueToBall * (1 - cand.cutCos) * 1.6
  const wanted = position.targetTravel
  const delta = wanted - natural

  const jumpOk =
    !!dctx.profile.useJump && dctx.cueTouching && position.quality < 0.4
  let kind: SpinKind = "stun"

  if (Math.abs(delta) < STUN_TOLERANCE) {
    // 斯登：自然走位刚好落在容错区内，中杆撞后即停 —— 职业清台的主力杆法
    spin.y = 0
    kind = "stun"
  } else if (delta > 0 && followIsSafe(dctx, cand)) {
    // 需要母球走得更远 → 高杆跟进。
    // 关键约束：**必须确认跟进方向不会把母球推向袋口**。
    // 首版无条件给高杆，实测摔袋率从 1~2% 升到 5.8%，样本里几乎全是
    // offset.y=+0.4 —— 高杆让母球跟着目标球一起进袋。职业选手也不会
    // 在有摔袋风险时用跟进，这里补上方向校验。
    spin.y = Math.min(FOLLOW_MAX, 0.15 + (delta / (12 * R)) * 0.25)
    kind = "follow"
  } else if (delta < 0) {
    // 需要母球收住 → 低杆缩杆
    spin.y = Math.max(-0.42, -0.15 + (delta / (12 * R)) * 0.27)
    kind = "draw"
  } else {
    // 想跟进但不安全 → 退化为斯登，宁可走位差一点也不能摔袋
    spin.y = 0
    kind = "stun"
  }

  // 3) 薄球母球天然跑得远，再多压低杆，避免走位过头摔袋
  if (cand.cutCos < 0.5) {
    spin.y = Math.min(spin.y, -0.3)
    if (kind === "follow") kind = "draw"
  }

  // 4) 左右加塞：只在需要改变母球撞库后去向时使用，
  //    且严格限制在玩家可复现范围内（|x| ≤ 0.24）。
  if (
    dctx.profile.useSideSpin &&
    cand.railHug > 0.4 &&
    position.quality < 0.45
  ) {
    // 母球贴库且走位不佳时，用一点侧旋把母球带离库边
    const dir = cand.stop.x * cand.stop.y >= 0 ? 1 : -1
    spin.x = Math.max(-SIDE_MAX, Math.min(SIDE_MAX, dir * 0.22))
    if (kind === "stun") kind = "sidespin"
  }

  // 5) 贴球场景：平推无法达成走位目标时，启用扎杆作为**备选**方案。
  //    扎杆有固定执行难度（errorBudget 里叠加 elevationNoise 与 ×1.8 瞄准噪声），
  //    AI 不会稳定打出完美扎杆 —— 这是「玩家可复现」约束的体现。
  if (jumpOk && Math.abs(delta) > 6 * R) {
    const elevation = Math.min(0.42, 0.28 + 0.1 * dctx.pressure)
    return {
      spin: new Vector3(0, DRAW_MAX, 0),
      elevation,
      isJump: true,
      kind: "jump",
      delta,
    }
  }

  spin.y = Math.max(-0.45, Math.min(0.45, spin.y))
  return { spin, elevation: 0, isJump: false, kind, delta }
}

/**
 * 跟进（高杆）是否安全。
 *
 * 高杆会让母球沿着目标球的出球方向继续前进。若这个方向恰好指向某个袋口，
 * 母球就会跟着目标球一起摔袋 —— 这是实测摔袋率反弹的主因（样本里几乎全是
 * offset.y=+0.4）。这里沿「目标球→袋口」方向（即母球跟进的大致方向）
 * 做射线检查，判断继续前进的路径是否会撞进袋口。
 */
export function followIsSafe(
  dctx: DecisionContext,
  cand: OffenseCandidate
): boolean {
  // 母球跟进方向 ≈ 目标球被撞后的运动方向（目标球→袋口方向）
  const dir = cand.pocket.clone().sub(cand.ball.pos).normalize()
  // 从估算停位沿该方向前进（取 0.8m 做保守估计，约半个台长）
  const travel = 0.8
  const end = cand.stop.clone().addScaledVector(dir, travel)
  for (const p of dctx.pockets) {
    // 路径到袋口的最近距离
    if (segDistToPoint(cand.stop, end, p) < 3 * R) return false
    // 终点本身贴近袋口同样不安全
    if (end.distanceTo(p) < 3 * R) return false
  }
  return true
}
