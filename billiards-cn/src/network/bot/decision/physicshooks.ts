/**
 * v1.3.93：物理钩子的统一注册点。
 *
 * ## 为什么需要这个模块
 *
 * `offense.refineStopsPhysics()` 是「用候选真正会用的力度跑真实物理算停位」的核心修复，
 * 但它不能自己 import `power.ts` / `trajectory.ts` —— 那会形成循环依赖
 * （webpack 下表现为拿到半初始化的空对象，运行时才炸）。所以设计成
 * `registerPhysicsHooks()` 注入。
 *
 * 原先注入语句写在 `strategies/professional.ts` 的模块顶层。这带来一个隐蔽的
 * **加载顺序依赖**：只有 `professional.ts` 被 import 过、且已求值，钩子才就绪；
 * 否则 `refineStopsPhysics` 会**静默退回**几何近似（停位误差中位 31.4R ≈ 1 米）。
 *
 * 这个坑在本版就真实踩到了：新写的 `decision/ballinhand.ts` 在 harness 里
 * 单独加载时 `physicsHooksReady()` 返回 false，评估结果全部退化 —— 而它
 * 表面上仍返回一个"看起来正常"的摆位点，没有任何报错。
 *
 * ## 解法
 *
 * 把注册语句集中到本模块，并让所有需要精确物理的模块都 import 它。
 * 模块只被求值一次，`registerPhysicsHooks` 是幂等的（覆盖写），因此
 * 无论谁先加载，钩子都会在首次使用前就绪。
 */
import { Vector3 } from "three"
import { choosePowerTier } from "./power"
import { predictCueStop } from "./trajectory"
import { registerPhysicsHooks } from "./offense"

let installed = false

/**
 * 安装物理钩子（幂等）。
 *
 * 注册内容刻意与正式出杆路径**完全同源**：
 *   · 力度 → `choosePowerTier()`（与 aim() 主路径同一个函数）
 *   · 停位 → `predictCueStop()`（受控实验误差 0.000R）
 * 这样才能保证「预测的那一杆」就是「要打的那一杆」。
 */
export function installPhysicsHooks(): void {
  if (installed) return
  installed = true
  registerPhysicsHooks(
    (ctx, c) =>
      choosePowerTier(
        ctx,
        c,
        {
          quality: 0.5,
          targetTravel: c.stop.distanceTo(c.ball.pos),
        },
        new Vector3(0, 0, 0)
      ).power,
    (ctx, c, power) => predictCueStop(ctx, c, power, new Vector3(0, 0, 0))
  )
}

// 模块被 import 即安装，保证任何依赖精确停位的调用方都能拿到真实实现。
installPhysicsHooks()
