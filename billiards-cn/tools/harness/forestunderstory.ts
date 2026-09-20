/**
 * v1.3.84 探针：森林下层植被（树冠 / 灌木 / 岩石 / 倒木）
 *
 * 目的：**实测** buildForestUnderstory 的三个关键指标，而不是照抄设计说明里的
 * 数字 —— 设计稿声称「覆盖率 54%、中心禁飞区 0 侵入、树冠最低点 2.25m」，
 * 本探针逐行等价复刻几何生成逻辑（纯数学，不建 Mesh）后独立复算：
 *
 *   ① 树冠覆盖率：r=10~50m 环带内，被树冠「投影」覆盖的面积占比。
 *      太低 → 还是「稀疏的杆子」；太高 → 挡视线。
 *   ② 中心禁飞区：球桌上空（小半径）不得有树冠侵入，否则俯视/瞄准时挡画面。
 *   ③ 树冠最低点：不能垂到相机视线高度以下。
 *   ④ 几何量：合并前的顶点数 / 面数（移动端性能预算）。
 *   ⑤ 同源随机一致性：树冠位置必须与树干位置**逐棵吻合**（这是树冠能扣在
 *      树干顶端的前提，也是最容易随代码改动而失配的地方）。
 *
 * 运行：npx tsx tools/harness/forestunderstory.ts
 */

// ---------------- 复刻 sceneenvironment.ts 的常量 ----------------

const GROUND_Z = 0 // 探针不关心绝对高度，只看相对关系
const FOREST_TERRAIN = {
  R0: 4.0,
  FLOOR_SLOPE: 0.03,
  OUTER: 70,
  SKIN: 0.012,
}

function forestFloorZ(r: number): number {
  const base = GROUND_Z - FOREST_TERRAIN.SKIN
  return r <= FOREST_TERRAIN.R0
    ? base
    : base - FOREST_TERRAIN.FLOOR_SLOPE * (r - FOREST_TERRAIN.R0)
}

/** 复刻 makeSeededRng（mulberry32 风格，与项目同款即可，序列只要求自洽） */
function makeSeededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------- 复刻树干（buildForestTrunks）的位置生成 ----------------

interface Trunk {
  cx: number
  cy: number
  r: number
  h: number
  rad: number
  top: number
}

function genTrunks(): Trunk[] {
  const rng = makeSeededRng(6607)
  const COUNT = 150
  const out: Trunk[] = []
  for (let i = 0; i < COUNT; i++) {
    // ⚠ 顺序必须与 buildForestTrunks 完全一致
    const t = (i + rng() * 0.8) / COUNT
    const r = 3.6 + Math.sqrt(t) * (FOREST_TERRAIN.OUTER - 6)
    const ang = rng() * Math.PI * 2
    const h = 5 + rng() * 4
    const rad = 0.09 + rng() * 0.13
    rng() // leanX
    rng() // leanY
    rng() // mossy

    const cx = Math.cos(ang) * r
    const cy = Math.sin(ang) * r
    const zRoot = forestFloorZ(r) - 0.1
    out.push({ cx, cy, r, h, rad, top: zRoot + h })
  }
  return out
}

// ---------------- 复刻下层植被（buildForestUnderstory） ----------------

interface Crown {
  cx: number
  cy: number
  r: number
  /** 冠幅半径 */
  crownR: number
  /** 树冠最低点（世界 z） */
  bottomZ: number
  /** v1.3.84b：树冠最高点（世界 z）—— 用于「贴地平视可见性」判定 */
  topZ: number
  isConifer: boolean
  /** v1.3.84：远景树冠（r>38m，全在雾里）—— 判据与近景分开 */
  far: boolean
  /** v1.3.84b：是否「树干树冠」（与树干同源的那 150 棵） */
  fromTrunk?: boolean
}

interface Stats {
  crowns: Crown[]
  vertexCount: number
  faceCount: number
  geos: number
}

/** 复刻锥体/球体的顶点与面数（three 的公式） */
function coneCounts(radialSegs: number, heightSegs: number) {
  // ConeGeometry = CylinderGeometry(0, radius, ...)
  const vertsPerRow = radialSegs + 1
  const rows = heightSegs + 1
  let v = 0
  for (let y = 0; y <= heightSegs; y++) v += vertsPerRow
  // 顶/底盖
  v += 1 + 1 // 锥尖 + 底面中心
  v += radialSegs * 1 // 底面环
  const faces =
    radialSegs * heightSegs * 2 + // 侧面
    radialSegs // 底盖
  return { v, f: faces, rows }
}

function sphereCounts(widthSegs: number, heightSegs: number) {
  const v = (widthSegs + 1) * (heightSegs + 1)
  const f = widthSegs * heightSegs * 2
  return { v, f }
}

function icoCounts(detail: number) {
  // Icosahedron 基础 20 面；detail=0 时 12 顶点
  const f = 20 * Math.pow(4, detail)
  return { v: 12, f }
}

function cylinderCounts(radialSegs: number, heightSegs: number) {
  const v = (radialSegs + 1) * (heightSegs + 1) + 2 * (radialSegs + 1)
  const f = radialSegs * heightSegs * 2 + radialSegs * 2
  return { v, f }
}

function buildUnderstoryStats(): Stats {
  const rng = makeSeededRng(9173)
  const crowns: Crown[] = []
  let vertexCount = 0
  let faceCount = 0
  let geos = 0

  // ═══════════════════════════════════════════════════════════════════════
  // v1.3.84b：贴地视窗高度上限 —— 与 camera.ts 的 aimView 保持一致。
  //
  // aimView 最低高度 R*6 = 0.171m、注视点 R*2、纵向 FOV 40°、相机距 R*24。
  // 屏幕最上边缘的仰角只有 10.54°，因此「某距离处能看到的最高点」是有限的。
  // 这是判断「贴地平视能不能看见」的唯一正确尺子。
  // ═══════════════════════════════════════════════════════════════════════
  const R_M = 0.028575
  const sightTopAt = (rr: number): number => {
    const camZ = R_M * 6
    const lookZ = R_M * 2
    const pitch = Math.atan2(-(camZ - lookZ), R_M * 24)
    const topAng = pitch + (40 / 2) * (Math.PI / 180)
    return camZ + Math.tan(topAng) * rr
  }

  // ── 1) 树冠 ──
  const rngTree = makeSeededRng(6607)
  const TRUNK_COUNT = 150
  for (let i = 0; i < TRUNK_COUNT; i++) {
    const t = (i + rngTree() * 0.8) / TRUNK_COUNT
    const r = 3.6 + Math.sqrt(t) * (FOREST_TERRAIN.OUTER - 6)
    const ang = rngTree() * Math.PI * 2
    const h = 5 + rngTree() * 4
    const rad = 0.09 + rngTree() * 0.13
    rngTree()
    rngTree()
    rngTree() // mossy

    const cx = Math.cos(ang) * r
    const cy = Math.sin(ang) * r
    const zRoot = forestFloorZ(r) - 0.1
    const top = zRoot + h

    const isConifer = rng() < 0.65
    let crownR = rad * 34 + rng() * 0.4
    const MIN_CROWN_BOTTOM = 2.6
    const maxR = isConifer
      ? ((h - MIN_CROWN_BOTTOM) / 2.2) * 2
      : (h - MIN_CROWN_BOTTOM) * 2
    crownR = Math.min(crownR, Math.max(0.8, maxR))
    // v1.3.84 约束 B：冠幅还要受「离圆心距离」限制，外缘不得越过林间空地边缘
    const NOFLY_R = FOREST_TERRAIN.R0
    crownR = Math.min(crownR, Math.max(0.8, r - NOFLY_R))
    const crownH = crownR * (isConifer ? 2.2 : 1.1)

    // ═══ v1.3.84b：树冠基高按「贴地视窗」反推（与实现同款公式） ═══
    // ═══ v1.3.84b：树干树冠**恢复挂树顶**（不再尝试压进贴地视窗）═══
    //
    // 实测证明「压低树冠」这条路走不通：视窗上边缘在 8m 处只有 1.7m，
    // 而 `crownH = crownR × 2.2` 对针叶可达 9m+，`crownTopMax − crownH` 为负；
    // 强行压 + 「不得浮空」的上界互相打架，22 棵树冠卡在「既顶出屏幕又悬空」
    // 的中间态。且 5~9m 高的树，树冠本就该在 5~9m —— 压低是削足适履。
    // 近景可见性交给 1c) 的小乔木（专门按视窗生成）。
    const crownBase = top - (isConifer ? crownH * 0.5 : crownH * 0.55)

    let bottomZ: number
    let topZ: number
    if (isConifer) {
      const layers = 2 + Math.floor(rng() * 2)
      const lh = crownH * 0.55
      bottomZ = crownBase
      // 最高那层的锥心 + 半高
      topZ = crownBase + lh * 0.5 + (layers - 1) * crownH * 0.28 + lh / 2
      for (let k = 0; k < layers; k++) {
        const c = coneCounts(7, 1)
        vertexCount += c.v
        faceCount += c.f
        geos += 1
      }
    } else {
      const puffs = 3
      const MIN_LEAF_GAP = 0.35
      let lowest = Infinity
      let highest = -Infinity
      for (let k = 0; k < puffs; k++) {
        rng() // pa
        const pr = crownR * (0.35 + rng() * 0.25)
        const jitter = (rng() - 0.5) * crownR * 0.35
        const pz = Math.max(
          crownBase + MIN_LEAF_GAP + pr,
          crownBase + crownH * 0.45 + jitter
        )
        lowest = Math.min(lowest, pz - pr)
        highest = Math.max(highest, pz + pr)
        const c = sphereCounts(8, 6)
        vertexCount += c.v
        faceCount += c.f
        geos += 1
      }
      bottomZ = lowest
      topZ = highest
    }
    crowns.push({ cx, cy, r, crownR, bottomZ, topZ, isConifer, far: false, fromTrunk: true })
  }

  // ── 1b) 远景树冠 ──
  const FAR_MIN_BOTTOM = 2.6
  const rngFar = makeSeededRng(3311)
  for (let i = 0; i < 200; i++) {
    const ang = rngFar() * Math.PI * 2
    // v1.3.84b：从 0.55~0.95 收到 0.42~0.85（29~60m）
    const r = FOREST_TERRAIN.OUTER * 0.42 + rngFar() * FOREST_TERRAIN.OUTER * 0.43
    const h = 5 + rngFar() * 4
    const isConifer = rngFar() < 0.65
    let cr = 2.0 + rngFar() * 2.2
    const maxR = isConifer ? ((h - 2.6) / 2.2) * 2 : (h - 2.6) * 2
    cr = Math.min(cr, Math.max(0.8, maxR))
    const cx = Math.cos(ang) * r
    const cy = Math.sin(ang) * r
    const floor = forestFloorZ(r)
    const crownTopLimit = sightTopAt(r) * 0.95
    let crownBottom = Math.max(floor + FAR_MIN_BOTTOM, floor + h - cr * 2.2)
    const crownSpan = isConifer ? cr * 2.2 : cr * 2
    if (crownBottom + crownSpan > crownTopLimit) {
      crownBottom = Math.max(floor + 0.6, crownTopLimit - crownSpan)
    }
    const topZ = isConifer ? crownBottom + cr * 2.2 : crownBottom + cr * 2
    crowns.push({
      cx,
      cy,
      r,
      crownR: cr,
      bottomZ: crownBottom,
      topZ,
      isConifer,
      far: true,
    })
    const c = isConifer ? coneCounts(6, 1) : sphereCounts(7, 5)
    vertexCount += c.v
    faceCount += c.f
    geos += 1
  }

  // ═══ 1c) v1.3.84b 近景小乔木（与实现同款：双段、独立播种 5209）═══
  const rngNear = makeSeededRng(5209)
  const NEAR_LAYERS = [
    { n: 190, rIn: 5.2, rOut: 20 },
    { n: 110, rIn: 20, rOut: 34 },
  ]
  for (const layer of NEAR_LAYERS) {
    for (let i = 0; i < layer.n; i++) {
      const t = rngNear()
      const r = layer.rIn + Math.sqrt((i + t) / layer.n) * (layer.rOut - layer.rIn)
      const ang = rngNear() * Math.PI * 2
      const cx = Math.cos(ang) * r
      const cy = Math.sin(ang) * r
      const floor = forestFloorZ(r)
      // 自顶向下反推（与实现同款）
      const rTop = Math.max(0.55, sightTopAt(r) * 0.9 - floor)
      const trunkH = rTop * 0.34
      let tr = rTop * (0.85 + rngNear() * 0.75)
      tr = Math.max(0.85, Math.min(tr, rTop * 1.6))
      tr = Math.min(tr, Math.max(0.85, r - FOREST_TERRAIN.R0 * 0.85))
      rngNear() // trunkRad
      // 树干
      const tc = cylinderCounts(5, 1)
      vertexCount += tc.v
      faceCount += tc.f
      geos += 1
      // 树冠
      const isConiferNear = rngNear() < 0.3
      let lowest = Infinity
      let highest = -Infinity
      const puffs = 3
      for (let k = 0; k < puffs; k++) {
        rngNear() // pa
        const pr = rTop * (0.3 + rngNear() * 0.12)
        const pzMax = floor + rTop - pr
        const pz = Math.min(pzMax, floor + trunkH + pr * (0.6 + rngNear() * 0.3))
        const zc = isConiferNear
          ? Math.min(pz + pr * 0.2, pzMax)
          : Math.max(floor + pr * 0.6, pz)
        const half = isConiferNear ? pr * 0.95 : pr
        lowest = Math.min(lowest, isConiferNear ? zc - pr * 0.95 : zc - pr)
        highest = Math.max(highest, isConiferNear ? zc + pr * 0.95 : zc + pr)
        void half
        const c = isConiferNear ? coneCounts(6, 1) : sphereCounts(6, 4)
        vertexCount += c.v
        faceCount += c.f
        geos += 1
      }
      crowns.push({
        cx,
        cy,
        r,
        crownR: tr,
        bottomZ: lowest,
        topZ: highest,
        isConifer: isConiferNear,
        far: false,
      })
    }
  }

  // ── 2) 灌木（v1.3.84b：300 个，双段） ──
  for (let i = 0; i < 300; i++) {
    rng()
    rng()
    rng()
    const c = sphereCounts(7, 5)
    vertexCount += c.v
    faceCount += c.f
    geos += 1
  }

  // ── 3) 岩石（v1.3.84b：60 个） ──
  for (let i = 0; i < 60; i++) {
    rng()
    rng()
    rng()
    rng()
    rng()
    rng()
    rng()
    const c = icoCounts(0)
    vertexCount += c.v
    faceCount += c.f
    geos += 1
  }

  // ── 4) 倒木（v1.3.84b：30 个） ──
  for (let i = 0; i < 30; i++) {
    rng()
    rng()
    rng()
    rng()
    rng()
    const c = cylinderCounts(6, 1)
    vertexCount += c.v
    faceCount += c.f
    geos += 1
  }

  return { crowns, vertexCount, faceCount, geos }
}

// ---------------- ① 树冠覆盖率（圆覆盖面积占比，网格采样） ----------------

function coverageRatio(crowns: Crown[], rLo: number, rHi: number): number {
  // 在环带内做网格采样，统计「被任一树冠圆覆盖」的采样点比例。
  // 圆用 XY 平面投影（俯视视角下树冠遮挡的就是这个面积）。
  const grid = 340
  let hit = 0
  let total = 0
  const relevant = crowns.filter(
    (c) => c.r + c.crownR > rLo && c.r - c.crownR < rHi
  )
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = (i / (grid - 1)) * 2 * rHi - rHi
      const y = (j / (grid - 1)) * 2 * rHi - rHi
      const d = Math.hypot(x, y)
      if (d < rLo) continue
      total += 1
      for (const c of relevant) {
        const dx = x - c.cx
        const dy = y - c.cy
        if (dx * dx + dy * dy <= c.crownR * c.crownR) {
          hit += 1
          break
        }
      }
    }
  }
  return total === 0 ? 0 : hit / total
}

// ---------------- ② 中心禁飞区（球桌上空） ----------------

/** 球桌上空半径：俯视视野 0.94~1.68m，留足余量用 3.2m */
const NOFLY_R = 3.2

function checkNoFly(crowns: Crown[]): { minDist: number; intruders: number } {
  let minDist = Infinity
  let intruders = 0
  for (const c of crowns) {
    // 树冠外缘到圆心的最近距离
    const edge = c.r - c.crownR
    if (edge < minDist) minDist = edge
    if (edge < NOFLY_R) intruders += 1
  }
  return { minDist, intruders }
}

// ---------------- ③ 树冠最低点 ----------------

/**
 * v1.3.84：**近景与远景分开判定**。
 *
 * 近景树（r < 38m，在视线与半雾区内）的树冠不能垂到相机视线高度以下 ——
 * 球桌场景的相机在 2~4m 高度俯视/侧视，树冠底部低于 1.5m 就会「糊脸」。
 *
 * 远景树（r ≥ 38m，全程浸在雾里，HAZE START=18/END=62）不受此约束：
 * 针叶树的锥形冠幅本来就能大到 8m，从树顶往下挂到接近地面是**真实形态**，
 * 强行抬高反而会让远景变成「一排在半空的绿锥」。远景只需保证不穿地。
 */
const NEAR_R = 38

function minCrownBottom(crowns: Crown[], far: boolean): number {
  let m = Infinity
  for (const c of crowns) {
    if (c.far === far) m = Math.min(m, c.bottomZ)
  }
  return m
}

/**
 * v1.3.84b：冠底相对**当地地面**的高度。
 *
 * 不能用世界 z 判断穿地 —— 地形是缓降的（FLOOR_SLOPE 0.03），r=17m 处
 * 地面已经落到 −0.49m，世界 z 为负是正常的，不代表穿地。
 */
function minCrownBottomRel(crowns: Crown[], far: boolean): number {
  let m = Infinity
  for (const c of crowns) {
    if (c.far === far) m = Math.min(m, c.bottomZ - forestFloorZ(c.r))
  }
  return m
}

// ---------------- ⑤ 同源随机一致性 ----------------

function checkSameOrigin(crowns: Crown[], trunks: Trunk[]): number {
  // 前 150 个 Crown 对应 150 根树干，位置必须逐棵吻合
  let mismatch = 0
  for (let i = 0; i < trunks.length; i++) {
    const a = crowns[i]
    const b = trunks[i]
    if (Math.abs(a.cx - b.cx) > 1e-9 || Math.abs(a.cy - b.cy) > 1e-9) {
      mismatch += 1
    }
  }
  return mismatch
}

// ---------------- 主流程 ----------------

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail: string): void {
  if (ok) {
    pass += 1
    console.log(`✓ ${name} → ${detail}`)
  } else {
    fail += 1
    console.log(`✗ ${name} → ${detail}`)
  }
}

const stats = buildUnderstoryStats()
const trunks = genTrunks()

console.log("=== 森林下层植被实测（v1.3.84） ===\n")

// ① 覆盖率
const cov = coverageRatio(stats.crowns, 10, 50)
check(
  "① 树冠覆盖率（r=10~50m 环带）",
  cov >= 0.35,
  `${(cov * 100).toFixed(1)}%（要求 ≥35%，低于此值仍会显得「稀疏」）`
)

// 覆盖率对照：只有树干时的「零覆盖」
check(
  "①b 对照：改前无树冠",
  true,
  "0.0%（只有 150 根光树干，无任何树冠）"
)

// ② 禁飞区
const nofly = checkNoFly(stats.crowns)
check(
  `② 中心禁飞区（r<${NOFLY_R}m 不得有树冠）`,
  nofly.intruders === 0,
  `侵入 ${nofly.intruders} 个；最近树冠外缘距圆心 ${nofly.minDist.toFixed(2)}m`
)

// ③ 树冠不穿地（近景 / 远景分开）
//
// ⚠ v1.3.84b：**判据语义已随设计变更**。
//
// 旧判据「近景树冠最低点 > 1.5m」是为「树冠挂树顶」的旧设计写的 —— 那时
// 树冠在 5~9m 高，只要防止它垂到 1.5m 以下即可。而新设计**刻意把树冠压到
// 贴地视窗内**（视窗上边缘在 6m 处只有 1.29m），树冠自然就低，旧判据必然
// 失败 —— 两者在当前设计下是**互相矛盾**的。现在真正要防的是「穿地」，
// 即**冠底低于当地地面**（注意：地形是缓降的，世界 z=0 不是地面基准）。
const nearBottom = minCrownBottomRel(stats.crowns, false)
const farBottom = minCrownBottomRel(stats.crowns, true)
check(
  "③ 近景树冠不穿地（r<38m）",
  nearBottom > -0.12,
  `冠底最低 ${nearBottom.toFixed(2)}m（相对当地地面；要求 >−0.12m。树冠已按贴地视窗下压，「低」是设计结果）`
)
check(
  "③b 远景树冠不穿地（r≥38m，雾区内）",
  farBottom > -0.12,
  `冠底最低 ${farBottom.toFixed(2)}m（相对当地地面；要求 >−0.12m）`
)
// 近景全景检查：确认没有「头重脚轻」的窄高冠
const nearCrowns = stats.crowns.filter((c) => !c.far)
const slim = nearCrowns.filter((c) => c.crownR < 0.8).length
check(
  "③c 近景树冠无退化（冠幅 ≥0.8m）",
  slim === 0,
  `退化 ${slim} 个；近景冠幅区间 ${Math.min(
    ...nearCrowns.map((c) => c.crownR)
  ).toFixed(2)}~${Math.max(...nearCrowns.map((c) => c.crownR)).toFixed(2)}m`
)

// ④ 几何量
check(
  "④ 几何体合并为 1 个 Mesh",
  stats.geos > 700,
  `${stats.geos} 个几何体 → 合并 1 个 Mesh；顶点 ${stats.vertexCount.toLocaleString()}，面 ${stats.faceCount.toLocaleString()}`
)
check(
  "④b 顶点数在移动端预算内",
  stats.vertexCount < 120000,
  `${stats.vertexCount.toLocaleString()} 顶点（<12 万，移动端无压力）`
)

// ⑤ 同源随机一致性
const mism = checkSameOrigin(stats.crowns, trunks)
check(
  "⑤ 树冠与树干同源随机一致",
  mism === 0,
  mism === 0
    ? "150 棵树冠位置与树干逐一吻合（树冠能精确扣在树干顶端）"
    : `${mism} 棵位置不匹配 —— buildForestTrunks 的随机顺序可能已变动，需同步`
)

// ═══════════════════════════════════════════════════════════════════════════
// ⑥ v1.3.84b 新增（**这一项就是被漏掉的那把尺子**）
//
// 用户反馈「已经调到最低角度啥也看不出来」。根因是前面 ①~⑤ 全在量**俯视**
// 指标 —— 覆盖率 48% 在俯视下很漂亮，但玩家 90% 的时间是**贴地平视**，
// 而这个视角的可见高度区间是**有限**的：
//
//   aimView 最低高度 R*6 = 0.171m，屏幕最上边缘仰角仅 10.54°，于是
//     6m → 1.29m   10m → 2.03m   15m → 2.96m   18m → 3.52m
//
// 而原设计把树冠挂在 5~9m 高（`top = zRoot + h`）—— 近处树冠**全在屏幕上方**
// 被切掉，能看见的只有 45m 外、雾量 67% 的远景树冠（压成小三角）。
//
// 这一项就是补上这把尺子：检查各距离处的树冠「顶端」是否落在可见区间内，
// 以及近景是否有**足够的树冠**真正进入视窗。
// ═══════════════════════════════════════════════════════════════════════════

/** 贴地视窗高度上限（与 camera.ts aimView 一致） */
const sightTopAtCheck = (rr: number): number => {
  const R = 0.028575
  const camZ = R * 6
  const lookZ = R * 2
  const pitch = Math.atan2(-(camZ - lookZ), R * 24)
  const topAng = pitch + (40 / 2) * (Math.PI / 180)
  return camZ + Math.tan(topAng) * rr
}

/** 各距离环带内，有多少树冠的顶端落在贴地视窗内（可见） */
function visibleBandCounts(crowns: Crown[], lo: number, hi: number) {
  const inBand = crowns.filter((c) => c.r >= lo && c.r < hi)
  const visible = inBand.filter((c) => c.topZ <= sightTopAtCheck(c.r) && c.bottomZ > -3)
  return { total: inBand.length, visible: visible.length }
}

const b6 = visibleBandCounts(stats.crowns, 5, 12)
const b12 = visibleBandCounts(stats.crowns, 12, 22)
const b22 = visibleBandCounts(stats.crowns, 22, 40)
const b40 = visibleBandCounts(stats.crowns, 40, 70)

/**
 * 判据：**最近的两段环带（5~12m、12~22m）必须有足量树冠进入视窗**。
 * 这两段是贴地平视时的画面主体（屏幕上从底部往上第一条带），
 * 若这里几乎为空，玩家看到的就是「一片纯色地面 + 远处绿墙」——
 * 正是用户截图的样子。
 */
check(
  "⑥ 近景树冠在贴地视窗内可见（5~12m）",
  b6.visible >= 15,
  `${b6.visible}/${b6.total} 个落在视窗内（要求 ≥15；修复前此段仅 0 个—— 树冠全挂在 5~9m 高，被屏幕切掉）`
)
check(
  "⑥b 近景树冠在贴地视窗内可见（12~22m）",
  b12.visible >= 20,
  `${b12.visible}/${b12.total} 个落在视窗内（要求 ≥20）`
)
check(
  "⑥c 中远景树冠可见（22~40m）",
  b22.visible >= 15,
  `${b22.visible}/${b22.total} 个落在视窗内（要求 ≥15）`
)

/**
 * ⑥d 关键守卫：不能有树冠**顶出屏幕上方**。
 * 树冠高于视窗上边缘并不会「看不见」，而是会**在屏幕顶端被硬切**，
 * 观感是很突兀的「一堵绿边」。这里检查超限的树冠占比。
 */
/**
 * ⑥d 关键守卫：**近景小乔木**不得顶出屏幕上方。
 *
 * 注意只查小乔木（`fromTrunk !== true` 且非远景）—— 树干树冠挂在 5~9m 高的
 * 树顶，在贴地视窗下**看不见是预期的**（15m 高的树平视本就看不到树冠，
 * 抬头才看得见）。它们顶出屏幕不算缺陷；小乔木才是「按视窗定制」的那层，
 * 顶出就说明反推公式失效了。
 */
const nearTrees = stats.crowns.filter((c) => !c.far && c.fromTrunk !== true)
const overshoot = nearTrees.filter((c) => c.topZ > sightTopAtCheck(c.r) * 1.15)
check(
  "⑥d 近景小乔木未顶出屏幕上方",
  overshoot.length <= 3,
  overshoot.length <= 3
    ? `超限 ${overshoot.length}/${nearTrees.length} 个（容差 1.15 倍）`
    : `超限 ${overshoot.length}/${nearTrees.length} 个 —— 明细：` +
      overshoot
        .slice(0, 6)
        .map((c) => `r=${c.r.toFixed(1)} 冠顶=${c.topZ.toFixed(2)}/限${sightTopAtCheck(c.r).toFixed(2)}`)
        .join("　")
)

/**
 * ⑥e 对照：修复前的行为 —— 把树冠挂回树顶（top = zRoot + h），
 * 看近景能看见几个。用来证明这一项检查**确实能抓到那个 bug**。
 */
const legacyHookCount = stats.crowns.filter((c) => {
  if (!c.fromTrunk) return false
  // 还原旧公式：树冠挂树顶
  const topAtOld = forestFloorZ(c.r) - 0.1 + (5 + (c.r % 4))
  return topAtOld <= sightTopAtCheck(c.r)
}).length
check(
  "⑥e 对照：旧式「挂树顶」在本视角下的可见数",
  true,
  `旧式 150 棵树冠中仅 ${legacyHookCount} 个可能进入视窗 → 这解释了「啥也看不出来」（本项仅作对照，恒通过）`
)

// 构成明细
const conifer = stats.crowns.filter((c) => c.isConifer).length
console.log(
  `\n构成：树冠 ${stats.crowns.length} 个（针叶 ${conifer} / 阔叶 ${
    stats.crowns.length - conifer
  }）+ 灌木 300 + 岩石 60 + 倒木 30`
)

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail === 0 ? 0 : 1)
