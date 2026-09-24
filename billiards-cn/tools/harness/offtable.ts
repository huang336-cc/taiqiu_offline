/**
 * v1.3.95 无头验证 · 球飞出台面（跳台）不再卡死。
 *
 * 背景：v1.3.94 引入跳球后，`Airborne` 的球会越过库边掉到台面之外，而引擎
 * 里根本没有「出界」这个概念，于是分两条路走向卡死：
 *   A. 落点在库外 5R 以内 → 参与 Cushion.bounceAny 反弹，算出荒谬速度
 *      （实测 vx 翻到 -900+ m/s）→ 连锁碰撞 → `Depth exceeded` 抛错；
 *   B. 落点超过 5R → 被原来的补丁跳过反弹，但没有任何东西让它停下来
 *      → allStationary() 永假 → 本杆永不结算。
 *
 * 本探针锁死这两条路，同时保证「正常贴库 / 进袋」不被误判。
 *
 * 用法：
 *   npx tsx tools/harness/offtable.ts
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball, State } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { PocketGeometry } from "../../src/view/pocketgeometry"
import { Outcome } from "../../src/model/outcome"
import { cueStrike } from "../../src/model/physics/physics"
import { Vector3 } from "three"

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${detail ? "  " + detail : ""}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? "  " + detail : ""}`)
  }
}

const STEP = 0.001953125
const MAX_STEPS = 200000

function makeTable(pos: Vector3): Table {
  const table = new Table([new Ball(pos, 0xffffff, 1)])
  for (const b of table.balls) b.state = State.Stationary
  return table
}

function settle(table: Table, maxSteps = MAX_STEPS) {
  let steps = 0
  let threw = false
  try {
    while (!table.allStationary() && steps < maxSteps) {
      table.advance(STEP)
      steps++
    }
  } catch (e) {
    threw = true
    console.log(`    [异常] ${(e as Error).message.split("\n")[0]}`)
  }
  return { settled: table.allStationary(), steps, threw }
}

console.log("\n=== 球飞出台面不再卡死（v1.3.95）===")

// ── T1：真实跳球飞出台面 → 必须能结算，且产出 OffTable ──────────
console.log("\n[T1] 贴库起跳把球打出台面")
{
  const table = makeTable(new Vector3(TableGeometry.tableX - 8 * R, 0, 0))
  const cue = table.balls[0]
  const strike = cueStrike(0, 5.0, new Vector3(0, 0, 0), (45 * Math.PI) / 180)
  cue.vel.copy(strike.vel)
  cue.rvel.copy(strike.rvel)
  cue.state = State.Airborne
  cue.wasAirborne = true
  table.outcome.length = 0
  const { settled, steps, threw } = settle(table)
  check("未抛出 Depth exceeded", !threw)
  check("本杆能够结算（不再卡死）", settled, `用了 ${steps} 步`)
  const off = Outcome.offTableBalls(table.outcome)
  check(
    "产出 OffTable 事件",
    off.length > 0,
    `出界球数=${off.length}, 最终 offTable=${cue.offTable}`
  )
}

// ── T2：旧「荒谬反弹」支路 ─────────────────────────────────────
// 球位于库外 2R（原 patch 管不到，会被 bounceAny 算出 -900m/s）
console.log("\n[T2] 库外 2R 的腾空球：应判出界，且不得出现荒谬速度")
{
  const table = makeTable(new Vector3(TableGeometry.tableX + 2 * R, 0, 0))
  const b = table.balls[0]
  b.state = State.Rolling
  b.wasAirborne = true
  b.vel.set(3, 0, 0)
  table.outcome.length = 0
  let maxSpeed = 0
  for (let i = 0; i < 500; i++) {
    table.advance(STEP)
    maxSpeed = Math.max(maxSpeed, b.vel.length())
  }
  check("判定为出界", b.offTable)
  check("已停球（速度归零）", b.vel.length() === 0, `|v|=${b.vel.length()}`)
  check(
    "全程无荒谬速度（<20 m/s）",
    maxSpeed < 20,
    `峰值速度=${maxSpeed.toFixed(3)} m/s`
  )
  check("位置被夹回台面内", Math.abs(b.pos.x) <= TableGeometry.tableX)
}

// ── T3：旧「永不静止」支路（超出 5R 补丁范围）──────────────────
console.log("\n[T3] 库外 10R 的球：必须在有限步内结算")
{
  const table = makeTable(new Vector3(TableGeometry.tableX + 10 * R, 0, 0))
  const b = table.balls[0]
  b.state = State.Rolling
  b.vel.set(5, 0, 0)
  table.outcome.length = 0
  const { settled, steps, threw } = settle(table, 5000)
  check("未抛出异常", !threw)
  check("有限步内结算", settled, `用了 ${steps} 步`)
  check("由硬兜底判定出界", b.offTable, `over=${(10 * R).toFixed(4)}m`)
}

// ── T4：正常贴库滚动不得误判 ───────────────────────────────────
console.log("\n[T4] 贴库滚个来回：严禁误判出界")
{
  const table = makeTable(new Vector3(TableGeometry.tableX - 1e-6, 0, 0))
  const b = table.balls[0]
  b.state = State.Rolling
  b.vel.set(0, 2.0, 0)
  table.outcome.length = 0
  let offDuring = 0
  for (let i = 0; i < 4000 && !table.allStationary(); i++) {
    table.advance(STEP)
    offDuring += Outcome.offTableBalls(table.outcome).length
    table.outcome.length = 0
  }
  check("全程零 OffTable", offDuring === 0, `误判次数=${offDuring}`)
  check("仍在台面且未出界", !b.offTable && Math.abs(b.pos.x) <= TableGeometry.tableX + R)
}

// ── T5：六个袋正常入袋不应被判出界（袋口豁免）──────────────────
console.log("\n[T5] 六袋入袋 + 袋口腾空豁免")
{
  let potted = 0
  let falseOff = 0
  for (const p of PocketGeometry.pocketCenters) {
    // (a) 真实入袋：从袋心往台心方向 5R 处朝袋心推
    // pocketCenters 的元素是 Pocket（坐标在 .pos），不是 Vector3
    const inward = p.pos.clone().negate().normalize()
    const start = p.pos.clone().addScaledVector(inward, 5 * R)
    const table = makeTable(start)
    const b = table.balls[0]
    b.state = State.Rolling
    b.vel.copy(inward).multiplyScalar(-2.0)
    table.outcome.length = 0
    for (let i = 0; i < 20000; i++) {
      table.advance(STEP)
      if (b.state === State.InPocket || b.state === State.Falling) break
    }
    const pots = table.outcome.filter((o) => o.ballA === b).length
    if (b.state === State.InPocket || b.state === State.Falling) potted++
    if (Outcome.offTableBalls(table.outcome).length > 0) falseOff++

    // (b) 腾空落在袋心：必须豁免，不能判出界
    const t2 = makeTable(new Vector3(p.pos.x, p.pos.y, 0))
    const b2 = t2.balls[0]
    b2.state = State.Rolling
    b2.wasAirborne = true
    t2.outcome.length = 0
    t2.advance(STEP)
    if (Outcome.offTableBalls(t2.outcome).length > 0) falseOff++
    void pots
  }
  check("全部能正常入袋", potted === PocketGeometry.pocketCenters.length, `成功 ${potted}/${PocketGeometry.pocketCenters.length}`)
  check("入袋/落袋口均未被误判出界", falseOff === 0, `误判=${falseOff}`)
}

// ── T6：出界球可被放回本杆起点（规则层 respot 的依据）──────────
console.log("\n[T6] 出界后起点可还原")
{
  const startPos = new Vector3(TableGeometry.tableX - 8 * R, 0, 0)
  const table = makeTable(startPos)
  const cue = table.balls[0]
  table.hit.length // noop：确保 Table 接口存在
  const strike = cueStrike(0, 5.0, new Vector3(0, 0, 0), (45 * Math.PI) / 180)
  cue.vel.copy(strike.vel)
  cue.rvel.copy(strike.rvel)
  cue.state = State.Airborne
  cue.wasAirborne = true
  cue.shotStart.copy(startPos)
  settle(table)
  check("出界后当前位置已改变", cue.pos.distanceTo(startPos) > 1e-9)
  cue.pos.copy(cue.shotStart)
  cue.setStationary()
  cue.offTable = false
  check("放回 shotStart 后位置精确还原", cue.pos.distanceTo(startPos) < 1e-9)
}

// ── T7：出界球被夹回后不得压在贴库球身上（否则本杆 Depth exceeded）──
//
// 机理：`checkOffTable` 把球心夹到 ±tableX / ±tableY，而那正是**球心可达的
// 极限**——贴库静止的球就停在那里。若出界方向与某颗贴库球重合，夹回后的两球
// 心距 < 2R，`Collision.willCollide` 每一步都成立又推不开，
// `prepareAdvanceAll` 永远返回 false → 100 层后抛 Depth exceeded。
// botcheck3（一半球贴库的用例）实测约 1/3 概率整局崩溃，就是这条路。
console.log("\n[T7] 夹回点必须避开贴库球，且本杆能正常结算")
{
  let crashes = 0
  let overlaps = 0
  let settled = 0
  // 四个库方向各试一遍：肇事球从库内 6R 处垂直冲出该库，飞行轨迹。
  // y0 与贴库球**同线**，于是被夹回后必然落在贴库球身上 —— 这正是真实
  // 对局里最常见的形态（沿垂直库方向打出去）。
  const cases: {
    place: (rail: Ball, flyer: Ball) => void
    vel: Vector3
  }[] = [
    {
      place: (r, f) => {
        r.pos.set(TableGeometry.tableX, 0.3, 0)
        f.pos.set(TableGeometry.tableX - 6 * R, 0.3, 0)
      },
      vel: new Vector3(6, 0, 0),
    },
    {
      place: (r, f) => {
        r.pos.set(-TableGeometry.tableX, -0.3, 0)
        f.pos.set(-TableGeometry.tableX + 6 * R, -0.3, 0)
      },
      vel: new Vector3(-6, 0, 0),
    },
    {
      place: (r, f) => {
        r.pos.set(0.3, TableGeometry.tableY, 0)
        f.pos.set(0.3, TableGeometry.tableY - 6 * R, 0)
      },
      vel: new Vector3(0, 6, 0),
    },
    {
      place: (r, f) => {
        r.pos.set(-0.3, -TableGeometry.tableY, 0)
        f.pos.set(-0.3, -TableGeometry.tableY + 6 * R, 0)
      },
      vel: new Vector3(0, -6, 0),
    },
  ]
  for (const c of cases) {
    // 贴库静止的目标球 + 一颗要飞出台面的「肇事球」（同线、内侧 6R 处）
    const railBall = new Ball(new Vector3(0, 0, 0), 0xff0000, 1)
    const flyer = new Ball(new Vector3(0, 0, 0), 0xffffff, 2)
    c.place(railBall, flyer)
    railBall.setStationary()
    flyer.setStationary()
    const table = new Table([flyer, railBall])
    table.cueball = flyer
    flyer.state = State.Rolling
    flyer.wasAirborne = true
    flyer.vel.copy(c.vel)
    table.outcome.length = 0
    let threw = false
    try {
      for (let i = 0; i < 20000 && !table.allStationary(); i++) {
        table.advance(STEP)
      }
    } catch (e) {
      threw = true
      console.log(`    [异常] ${(e as Error).message.split("\n")[0]}`)
    }
    if (threw) crashes++
    if (flyer.offTable || railBall.offTable) {
      const offBall = flyer.offTable ? flyer : railBall
      const other = offBall === flyer ? railBall : flyer
      if (offBall.pos.distanceTo(other.pos) < 2 * R * 0.99) overlaps++
    }
    if (table.allStationary()) settled++
  }
  check("未抛出 Depth exceeded", crashes === 0, `崩溃 ${crashes}/4`)
  check("夹回点未与其它球重叠", overlaps === 0, `重叠 ${overlaps}/4`)
  check("本杆全部正常结算", settled === 4, `结算 ${settled}/4`)
}

// ── T8：跳球越过贴库球后飞出台面 —— 夹回点不得压在那颗球身上 ──────
//
// 这是 v1.3.95 新引入的路径：空中球不与任何球碰撞（`Collision.willCollide`
// 的距离里含 z），所以它可以从**贴库球头顶飞过**再越过库边。落地判定
// `checkOffTable` 会把 z 强制归零并把球心夹到 ±tableX —— 正好是贴库球所在，
// 两球心距远小于 2R。`prepareAdvanceAll` 从此每一步都解不开，100 层后抛
// Depth exceeded，表现为**整局卡死**。
console.log("\n[T8] 跳球越过贴库球飞出台面：夹回点必须避开它")
{
  let crashes = 0
  let overlaps = 0
  let settled = 0
  let offHappened = 0
  for (const sign of [1, -1]) {
    // 贴库球几乎贴在右库内侧（0.5R），跳球从它头顶飞过
    const railBall = new Ball(
      new Vector3(sign * (TableGeometry.tableX - 0.5 * R), 0.3, 0),
      0xff0000,
      1
    )
    railBall.setStationary()
    const jumper = new Ball(
      new Vector3(sign * (TableGeometry.tableX - 8 * R), 0.3, 5 * R),
      0xffffff,
      2
    )
    jumper.pos.z = 5 * R
    jumper.setStationary()
    const table = new Table([jumper, railBall])
    table.cueball = jumper
    jumper.state = State.Rolling
    jumper.wasAirborne = true
    jumper.vel.set(sign * 9, 0, 0)
    table.outcome.length = 0
    let threw = false
    try {
      for (let i = 0; i < 20000 && !table.allStationary(); i++) {
        table.advance(STEP)
      }
    } catch (e) {
      threw = true
      console.log(`    [异常] ${(e as Error).message.split("\n")[0]}`)
    }
    if (threw) crashes++
    if (jumper.offTable) offHappened++
    if (jumper.pos.distanceTo(railBall.pos) < 2 * R * 0.99) overlaps++
    if (table.allStationary()) settled++
    // 两颗球静止重叠时 allStationary 仍为真 —— 看上去「结算了」，
    // 但下一杆任何一次 movement 都会让 willCollide 立刻成立又推不开。
    // 所以必须再打一杆（推贴库球一下）才算真的验完。
    let nextThrew = false
    try {
      railBall.state = State.Rolling
      railBall.vel.set(-sign * 0.6, 0, 0)
      for (let i = 0; i < 20000 && !table.allStationary(); i++) {
        table.advance(STEP)
      }
    } catch (e) {
      nextThrew = true
      console.log(`    [下一杆异常] ${(e as Error).message.split("\n")[0]}`)
    }
    if (nextThrew) crashes++
  }
  check("确实走到了出界判定（用例有效）", offHappened === 2, `${offHappened}/2`)
  check("未抛出 Depth exceeded", crashes === 0, `崩溃 ${crashes}/2`)
  check("夹回点未压在贴库球身上", overlaps === 0, `重叠 ${overlaps}/2`)
  check("本杆全部正常结算", settled === 2, `结算 ${settled}/2`)
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exit(1)
