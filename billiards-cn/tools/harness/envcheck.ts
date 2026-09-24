/**
 * v1.3.94 无头验证 · 环境场景：几何完整性 + draw call / 三角形统计。
 *
 * 为什么需要它：
 * 环境场景全部是**程序化几何 + 逐顶点烘焙**（bakeByPos / bakeIndoor），
 * 改动光照明暗或合并策略时，最容易出的错是「几何没建出来」「顶点出现
 * NaN」「合并时丢属性」—— 这些在浏览器里表现为一片黑或物体消失，很难定位。
 * 本脚本在 Node 侧直接跑 buildSceneEnvironment()，对 8 个场景逐个断言。
 *
 * 用法：
 *   npx tsx tools/harness/envcheck.ts
 *
 * 前置 `predom-env` 会开启真实 canvas（程序化贴图工厂需要 2D 上下文）。
 * 默认的 predom 桩故意不开 canvas —— 见 predom.ts 注释（真实 canvas 会改变
 * 贴图工厂的 RNG 消耗，进而污染 AI 对局探针）。
 */
import "./predom-env"
import { ENV_SCENES } from "../../src/utils/settings"
import { buildSceneEnvironment, ENV_SPECS } from "../../src/view/sceneenvironment"
import { Mesh, BufferGeometry, Group } from "three"

interface Stat {
  id: string
  ok: boolean
  meshes: number
  tris: number
  nanVerts: number
  emptyGeos: number
  hasFog: boolean
  problems: string[]
}

function countTris(g: BufferGeometry): number {
  const idx = g.getIndex()
  if (idx) return idx.count / 3
  const pos = g.getAttribute("position")
  return pos ? pos.count / 3 : 0
}

function scan(id: string, root: Group): Stat {
  const st: Stat = {
    id,
    ok: true,
    meshes: 0,
    tris: 0,
    nanVerts: 0,
    emptyGeos: 0,
    hasFog: !!ENV_SPECS[id]?.fog,
    problems: [],
  }
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return
    st.meshes++
    const g = o.geometry as BufferGeometry
    const pos = g.getAttribute("position")
    if (!pos || pos.count === 0) {
      st.emptyGeos++
      st.problems.push(`空几何: ${o.name || "(未命名)"}`)
    } else {
      st.tris += countTris(g)
      // NaN 检查：采样 position（大几何全量扫，成本可接受）
      const arr = pos.array as ArrayLike<number>
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) {
          st.nanVerts++
          break
        }
      }
    }
    const nrm = g.getAttribute("normal")
    if (nrm) {
      const arr = nrm.array as ArrayLike<number>
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) {
          st.problems.push(`法线 NaN: ${o.name || "(未命名)"}`)
          break
        }
      }
    }
  })
  st.ok = st.emptyGeos === 0 && st.nanVerts === 0
  return st
}

const rows: Stat[] = []
for (const s of ENV_SCENES) {
  const root = buildSceneEnvironment(s.id)
  if (!root) {
    rows.push({
      id: s.id,
      ok: false,
      meshes: 0,
      tris: 0,
      nanVerts: 0,
      emptyGeos: 0,
      hasFog: !!ENV_SPECS[s.id]?.fog,
      problems: ["buildSceneEnvironment 返回 null"],
    })
    continue
  }
  rows.push(scan(s.id, root))
}

console.log("\n=== 环境场景检查（v1.3.94）===")
console.log(
  "场景".padEnd(12) +
    "Mesh".padStart(6) +
    "三角形".padStart(10) +
    "雾".padStart(5) +
    "  结果"
)
let bad = 0
for (const r of rows) {
  if (!r.ok) bad++
  console.log(
    r.id.padEnd(12) +
      String(r.meshes).padStart(6) +
      String(Math.round(r.tris)).padStart(10) +
      (r.hasFog ? "  有" : "  -").padStart(5) +
      "  " +
      (r.ok ? "OK" : "FAIL " + r.problems.slice(0, 3).join("; "))
  )
}
const totalMesh = rows.reduce((a, r) => a + r.meshes, 0)
const totalTris = rows.reduce((a, r) => a + r.tris, 0)
console.log(
  `\n合计: ${rows.length} 场景 / ${totalMesh} Mesh / ${Math.round(totalTris)} 三角形`
)
console.log(`通过: ${rows.length - bad}/${rows.length}`)
if (bad > 0) process.exit(1)
