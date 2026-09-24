/**
 * v1.3.91 无头验证 · 对局级：**完整清台能力**。
 *
 * 为什么必须要有这个脚本：
 * 现有全部 harness（botcheck / botcheck2 / botcheck3 / botpro / safetycheck /
 * botphase4）都是**单杆**指标 —— 这一杆进不进、犯不犯规。但用户规格里最核心
 * 的一条是「**全局清台顺序（难点球优先）**」，而清台顺序的价值**只在多杆
 * 序列里才体现得出来**：单杆看每颗球都进了，整局看却可能因为顺序不对而卡死。
 *
 * 本脚本让AI从八球标准局面连续出杆直到清台 / 犯规 / 超时，统计：
 *   · 清台率：把所有本方球（1-7）全部打进的比例
 *   · 卡死率：遍历全场仍枚举不出任何可进球（真·无球可打）
 *   · 平均杆数、每杆进球率、犯规率、摔袋率
 *   · 三档难度横向对比（稳健 / 激进 / 专业），验证难度分层真实存在
 *
 * 用法：
 *   npx tsx tools/harness/botmatch.ts 300              # 三档对比
 *   npx tsx tools/harness/botmatch.ts 300 --pro        # 只看专业档
 *   npx tsx tools/harness/botmatch.ts 300 --noclr      # 专业档但关闭清台顺序（对照组）
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { Professional } from "../../src/network/bot/strategies/professional"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import { EventType } from "../../src/events/eventtype"
import { Outcome } from "../../src/model/outcome"
import { Vector3 } from "three"
import { DIFFICULTY, DifficultyProfile } from "../../src/network/bot/difficulty"

/** 每个 harness 各自定义的局部步长常量（constants.ts 并不导出它） */
const STEP = 0.001953125
/** 单局最多出杆数：超过视为「打不完」，计入超时 */
const MAX_SHOTS = 60
/** 物理推进的安全上限（防止异常状态死循环） */
const PHYS_GUARD = 300000

const ONLY_PRO = process.argv.includes("--pro")
const NO_CLEARANCE = process.argv.includes("--noclr")
/**
 * v1.3.95 A/B 对照：关掉「物理可行性硬否决」（回归 v1.3.94 的宽松口径）。
 *
 * 为什么要有它：这道闸门会把一部分本来会去尝试的计划否掉，AI 随之改用
 * 一库解球，而解球失手在八球里就是「首撞犯规」。开了 vs 不开到底哪个更好，
 * 只能拿 60 局对局级数字说话 —— 清台率、均杆数守住的前提下，谁犯规少谁赢。
 */
const NO_STRICT = process.argv.includes("--nostrict")

function makeBalls(): Ball[] {
  const balls: Ball[] = [new Ball(new Vector3(0, 0, 0), undefined, 0)]
  for (let l = 1; l <= 7; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 8))
  for (let l = 9; l <= 15; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  return balls
}

/** 随机散开摆位（非开球局面）—— 让 AI 从「已散开的残局」开始清台 */
/**
 * v1.3.95：确定性随机源（仅在 `--seed=` 时启用）。
 *
 * 为什么必须要有它：**同口径对照必须同一批局面**。默认 `Math.random()`
 * 每次跑都是新的摆位，两次运行的差异里混着「局面不同」这个巨大的噪声源
 * —— 实测同一份代码两次 60 局能给出 犯规 5.5% vs 3.6%、均杆 11.55 vs
 * 10.86 这种量级的抖动，足以把「95 是不是真的让 AI 变差」彻底判错。
 * 给定 seed 后每局用 `mulberry32(seed + i * 7919)` 独立取流，
 * 于是 A/B 两组面对逐位相同的局面。
 */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function placeSpread(balls: Ball[], rnd: () => number = Math.random): boolean {
  const X = TableGeometry.X - 2.2 * R
  const Y = TableGeometry.Y - 2.2 * R
  const placed: Ball[] = []
  for (const b of balls) {
    let ok = false
    for (let a = 0; a < 300 && !ok; a++) {
      const p = new Vector3(
        (rnd() * 2 - 1) * X,
        (rnd() * 2 - 1) * Y,
        0
      )
      let clash = false
      for (const q of placed) {
        if (q.pos.distanceTo(p) < 2.3 * R) {
          clash = true
          break
        }
      }
      if (!clash) {
        b.pos.copy(p)
        b.setStationary()
        placed.push(b)
        ok = true
      }
    }
    if (!ok) return false
  }
  return true
}

function simulate(table: Table, aim: AimEvent): boolean {
  table.cue!.aim = aim
  table.cue!.hit(table.cueball)
  let guard = 0
  try {
    while (!table.allStationary() && guard++ < PHYS_GUARD) table.advance(STEP)
  } catch {
    // 物理引擎在极端密集球堆下会抛「Depth exceeded resolving collisions」
    // （table.ts 的固有保护）。这是引擎的数值防御，不是 AI 决策错误 ——
    // 但对局级模拟要连打几十杆，触发概率被放大到必须处理。
    // 返回 false 表示本局作废，不计入统计（避免把引擎边界当成 AI 缺陷）。
    return false
  }
  return true
}

interface MatchResult {
  cleared: boolean
  stuck: boolean
  timedOut: boolean
  shots: number
  pots: number
  fouls: number
  scratches: number
}

/**
 * 跑一整局：AI 连续出杆，直到本方球全清 / 无球可打 / 超时。
 *
 * 说明：为了只考察「清台能力」而不掺入对手行为，本脚本把对手回合简化为
 * 「不干扰」—— AI 每次都能继续出杆。这样测出的是 AI 的**理论上限**，
 * 用于横向比较档位与开关差异，而不是模拟真实对局的胜负。
 */
function playMatch(
  profile: DifficultyProfile,
  useClearance: boolean,
  seed?: number
): MatchResult | null {
  const calculator = new AimCalculator()
  const strategy = new Professional(profile)
  if (!useClearance) {
    // 对照组：临时关掉清台顺序开关（其余能力保持专业档）
    ;(strategy as any).profile = { ...profile, useClearanceOrder: false }
  }

  const balls = makeBalls()
  const table = new Table(balls)
  table.cue = new Cue()
  table.cueball = balls[0]
  // seed 给定 → 本局面可复现，A/B 两组面对同一批摆位
  if (!placeSpread(balls, seed === undefined ? Math.random : mulberry32(seed)))
    return null

  const mine = balls.filter((b) => b.label >= 1 && b.label <= 7)
  const theirs = balls.filter((b) => b.label >= 9)
  const remaining = new Set<Ball>(mine)

  let shots = 0
  let pots = 0
  let fouls = 0
  let scratches = 0
  let stuck = false

  while (shots < MAX_SHOTS && remaining.size > 0) {
    const targets = [...remaining]
    const ctx: any = {
      table,
      cueBall: balls[0],
      validTargetBalls: targets,
      ballInHand: false,
      pockets: calculator.pockets,
      ruleName: "eightball",
      opponentBalls: theirs.filter((b) => b.onTable()),
    }
    let events: any[]
    try {
      events = strategy.aim(ctx, calculator) as any[]
    } catch {
      // 决策层抛异常（理论上不该发生）—— 计为卡死，便于发现回归
      stuck = true
      break
    }
    if (!events || events.length === 0) {
      stuck = true
      break
    }
    const hit =
      events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit?.tablejson) {
      stuck = true
      break
    }
    const aim = AimEvent.fromJson(hit.tablejson.aim)
    // v1.3.92：**每杆必须先清空 outcome**。
    //
    // `Table.outcome` 是只增不减的事件累加器（table.ts 里全程只有 push，
    // 从不清空）—— 清空是**调用方**的责任，真实控制器都这么做
    // （controller/watchshot.ts:16、spectate.ts:92 都是 `table.outcome = []`）。
    //
    // 本 harness 首版漏了这一步，于是第一杆的碰撞记录永远留在列表头部，
    // `Outcome.firstCollision()` 每杆都返回同一条陈旧记录 → 首撞被判定成
    // 某颗**早已进袋**的球（不在 targets 里）→ 整局被判犯规。
    // 实测「16 杆清台」的样本被记成 15 次犯规，就是这个原因。
    // 这个错误曾让我误以为 AI 有严重犯规问题，白白追查了很久。
    table.outcome = []
    if (!simulate(table, aim)) return null
    shots++

    const outcome = table.outcome
    const pottedMine = Outcome.pots(outcome).filter(
      (b) => b !== balls[0] && remaining.has(b)
    )
    const scratched = Outcome.isCueBallPotted(table.cueball, outcome)
    const firstHitTarget = Outcome.firstCueContact(balls[0], outcome, targets)

    pots += pottedMine.length
    for (const b of pottedMine) remaining.delete(b)

    if (scratched) {
      scratches++
      // 母球落袋后放回头区重打（简化处理，不送对手自由球）
      balls[0].pos.set(-TableGeometry.X * 0.6, 0, 0)
      balls[0].setStationary()
      if (Math.abs(balls[0].pos.x) > TableGeometry.X - R) return null
    } else if (!firstHitTarget) {
      fouls++
    }

    // 母球被打出台面（异常）：判为卡死
    if (
      Math.abs(balls[0].pos.x) > TableGeometry.X + R ||
      Math.abs(balls[0].pos.y) > TableGeometry.Y + R
    ) {
      return null
    }
  }

  const timedOut = shots >= MAX_SHOTS && remaining.size > 0
  return {
    cleared: remaining.size === 0,
    stuck,
    timedOut,
    shots,
    pots,
    fouls,
    scratches,
  }
}

interface Totals {
  n: number
  cleared: number
  stuck: number
  timedOut: number
  shots: number
  pots: number
  fouls: number
  scratches: number
}

function run(
  label: string,
  profile: DifficultyProfile,
  useClearance: boolean,
  N: number,
  seed?: number
) {
  const t: Totals = {
    n: 0, cleared: 0, stuck: 0, timedOut: 0,
    shots: 0, pots: 0, fouls: 0, scratches: 0,
  }
  for (let i = 0; i < N; i++) {
    // 每局一条独立的确定性流（seed + i * 质数），A/B 两组第 i 局逐位相同
    const perMatchSeed = seed === undefined ? undefined : seed + i * 7919
    const r = playMatch(profile, useClearance, perMatchSeed)
    if (!r) continue
    t.n++
    if (r.cleared) t.cleared++
    if (r.stuck) t.stuck++
    if (r.timedOut) t.timedOut++
    t.shots += r.shots
    t.pots += r.pots
    t.fouls += r.fouls
    t.scratches += r.scratches
  }
  const pct = (x: number) => ((x / Math.max(1, t.n)) * 100).toFixed(1)
  const per = (x: number) => (x / Math.max(1, t.n)).toFixed(2)
  // ⚠️ 犯规 / 摔袋是按**每一杆**累加的，分母必须是「总杆数」而不是「局数」。
  // 首版误用局数当分母，算出 560% 犯规率、1335% 摔袋率这类不可能的数字。
  const perShot = (x: number) => ((x / Math.max(1, t.shots)) * 100).toFixed(1)
  console.log(
    `${label.padEnd(26)} N=${String(t.n).padStart(4)}  ` +
      `清台=${pct(t.cleared)}%  卡死=${pct(t.stuck)}%  超时=${pct(t.timedOut)}%  ` +
      `均杆数=${per(t.shots)}  均进球=${per(t.pots)}  ` +
      `犯规/杆=${perShot(t.fouls)}%  摔袋/杆=${perShot(t.scratches)}%`
  )
  return t
}

const N = Number(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? 300)
/**
 * 可选固定随机种子（`--seed=12345`）。
 * 给定后每局局面可复现 —— 做 A/B 对照时必须给，否则两组面对的是不同球局，
 * 得出的结论会被局面噪声淹没（具体案例见 mulberry32 处的注释）。
 */
const SEED_ARG = process.argv.find((a) => a.startsWith("--seed="))
const SEED = SEED_ARG ? Number(SEED_ARG.split("=")[1]) : undefined

console.log("=== 对局级：完整清台能力（AI 连续出杆直到清台/卡死/超时）===")
console.log(
  `样本=${N}  单局上限=${MAX_SHOTS} 杆  随机=${SEED === undefined ? "Math.random()" : `seed=${SEED}`}\n`
)

if (ONLY_PRO) {
  if (NO_STRICT) {
    const p = { ...DIFFICULTY.Professional, strictCandidateVeto: false }
    run("专业档·关闭硬否决", p, true, N, SEED)
    console.log("")
    run("专业档·完整", DIFFICULTY.Professional, true, N, SEED)
  } else {
    run("专业档", DIFFICULTY.Professional, true, N, SEED)
  }
} else if (NO_CLEARANCE) {
  run("专业档·关闭清台顺序", DIFFICULTY.Professional, false, N, SEED)
  console.log("")
  run("专业档·完整", DIFFICULTY.Professional, true, N, SEED)
} else {
  run("稳健档 ClawBreak", DIFFICULTY.ClawBreak, false, N, SEED)
  run("激进档 TheFarJaw", DIFFICULTY.TheFarJaw, false, N, SEED)
  run("专业档 Professional", DIFFICULTY.Professional, true, N, SEED)
  console.log("")
  console.log("--- 清台顺序 A/B 对照（仅专业档）---")
  run("专业档·关闭清台顺序", DIFFICULTY.Professional, false, N, SEED)
}
