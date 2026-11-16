/**
 * v1.7.0：外部「台球房资源包」接入层。
 *
 * ## 来源
 *
 * 用户用 Blender 4.2 生成的资源包（pool_assets v1.0），按本工程源码参数
 * 建模：玩区 2.8165×1.3755（= R×43 × R×21）、球半径 0.03275、台面 z=0、
 * 地面 z=−0.80、Z-up、6 袋口按游戏物理半径（角 88mm / 中 58mm）。
 *
 * ## 关键约定（与旧 GLTF 完全不同，踩了就错）
 *
 * 1. **米制真尺寸 → 缩放必须是 1**。工程原有的 `importGltf()` 会把模型乘
 *    `R/0.5 = 0.0655`（旧 p8.min.gltf 是「0.5 单位 = 球半径」的老坐标）。
 *    新资源若走那条路会缩成 6.5%，所以这里用**独立的 GLTFLoader**，
 *    `scale.setScalar(1)`。
 * 2. **材质名固定**：cloth / cushion / wood / diamond / pocket / leg / brass /
 *    black_rubber。换肤就是给前四个写 `material.color`（贴图是中性明度图，
 *    颜色由运行时乘入）。
 * 3. 球贴图是 1024×512 等距圆柱投影，`textures/ball_00..15.png`；
 *    00 是母球（带红点训练球）—— 本工程母球**保持纯白**（v1.3.85 玩家反馈
 *    「母球长红斑」，不能用带点贴图）。
 *
 * ## 为什么要按材质合并
 *
 * pool_table.glb 是 74 个 primitive、pool_room.glb 是 224 个 —— 直接挂进
 * 场景就是 74/224 个 draw call（旧 p8 桌只有 7 个）。这里按材质合并几何，
 * 桌面降到材质数（8），房间降到材质数（143，仍偏高，见 loadPoolRoom 注释）。
 */

import {
  Box3,
  BufferAttribute,
  CanvasTexture,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { Settings, getTableSkin } from "../utils/settings"
import { getClothNormalTexture } from "./tableskinfactory"
import { R } from "../model/physics/constants"

const BASE = "models/pool/"

let tablePromise: Promise<Group> | null = null
let cuePromise: Promise<Group> | null = null
let roomPromise: Promise<Group> | null = null
const ballTexCache = new Map<number, Texture>()

function loader(): GLTFLoader {
  return new GLTFLoader()
}

/**
 * 把一棵 GLTF 树里**同材质**的网格合并成一个 Mesh。
 *
 * - 逐网格 clone 几何并烘入 world 矩阵（保证位置/旋转/缩放不丢）；
 * - 只保留 position / normal / uv —— 合并要求属性集合一致，
 *   多余属性（tangent 等）会让 mergeGeometries 返回 null；
 * - 合并后 Mesh 名称取材质名，方便后续按名字找（cloth / wood …）。
 */
export function mergeByMaterial(
  root: Group,
  filter?: (m: Mesh) => boolean
): Group {
  root.updateMatrixWorld(true)
  const buckets = new Map<string, { material: any; geos: any[]; name: string }>()
  const singles: Mesh[] = []

  root.traverse((o) => {
    const m = o as Mesh
    if (!(m as any).isMesh) return
    if (filter && !filter(m)) return
    if (Array.isArray(m.material) && m.material.length > 1) {
      // 多材质网格（GLTF primitive 分组）不参与合并，原样保留
      singles.push(m)
      return
    }
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    if (!mat) return
    const key = mat.uuid
    let b = buckets.get(key)
    if (!b) {
      b = { material: mat, geos: [], name: String(mat.name || "mesh") }
      buckets.set(key, b)
    }
    const g = m.geometry.clone()
    for (const attr of Object.keys(g.attributes)) {
      if (attr !== "position" && attr !== "normal" && attr !== "uv") {
        g.deleteAttribute(attr)
      }
    }
    if (!g.attributes.normal) g.computeVertexNormals()
    if (!g.attributes.uv) {
      const n = g.attributes.position.count
      g.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2))
    }
    g.applyMatrix4(m.matrixWorld)
    b.geos.push(g)
  })

  const out = new Group()
  out.name = root.name || "PoolModel"
  for (const b of buckets.values()) {
    const merged =
      b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false)
    if (!merged) {
      // 合并失败（属性不一致）→ 退回逐个挂载，宁可多 draw call 也不丢件
      b.geos.forEach((g, i) => {
        const m = new Mesh(g, b.material)
        m.name = b.name + "_" + i
        out.add(m)
      })
      continue
    }
    if (b.geos.length > 1) b.geos.forEach((g) => g.dispose())
    const mesh = new Mesh(merged, b.material)
    mesh.name = b.name
    mesh.castShadow = true
    mesh.receiveShadow = true
    out.add(mesh)
  }
  /**
   * v1.8.0：多材质网格也必须把世界矩阵烘进几何再挂到新 Group。
   *
   * 原先这里直接 `out.add(m)` —— 新 Group 没有原父节点的变换，遇到
   * 「整桌挂在一层带旋转/缩放的 holder 下」的写实中8桌（Y-up→Z-up 校准
   * 就挂在外层），这些件会留在原始坐标系里飞出去。与单材质分支保持
   * 同一套属性归一化 + 烘矩阵流程。
   */
  for (const m of singles) {
    const g = m.geometry.clone()
    for (const attr of Object.keys(g.attributes)) {
      if (attr !== "position" && attr !== "normal" && attr !== "uv") {
        g.deleteAttribute(attr)
      }
    }
    if (!g.attributes.normal) g.computeVertexNormals()
    if (!g.attributes.uv) {
      const n = g.attributes.position.count
      g.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2))
    }
    g.applyMatrix4(m.matrixWorld)
    const nm = new Mesh(g, m.material)
    nm.name = m.name || "multi_material"
    nm.castShadow = true
    nm.receiveShadow = true
    out.add(nm)
  }
  return out
}

/**
 * v1.7.0：把「无贴图的纯色网格」烘成顶点色并合并成**一个** draw call。
 *
 * 房间有 143 种材质，其中绝大多数是书脊、花盆、把手这类纯色小件 ——
 * 按材质合并只能到「材质数」个 draw call（实测房间 + 球桌 + 球共 256），
 * 移动端偏高。纯色件不需要各自独立的材质：把 `material.color` 写进
 * 顶点色、统一用一个 vertexColors 的 Standard 材质，一百多个 draw call
 * 塌缩成 1 个。
 *
 * 只处理**完全没有贴图**的件（map / normalMap / roughnessMap 任一存在
 * 就跳过），保证贴图件（地板、墙面、地毯、窗景、皮革）不受影响。
 */
function mergeSolidToVertexColors(geos: any[]): Mesh | null {
  if (!geos.length) return null
  for (const g of geos) {
    if (!g.attributes.color) {
      const n = g.attributes.position.count
      g.setAttribute("color", new BufferAttribute(new Float32Array(n * 3), 3))
    }
  }
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
  if (!merged) return null
  if (geos.length > 1) geos.forEach((g) => g.dispose())
  const mat = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.02,
  })
  mat.name = "solid_batch"
  const mesh = new Mesh(merged, mat)
  mesh.name = "solid_batch"
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** 台球桌（米制，缩放 1）。首次调用后缓存 Promise，重复调用复用同一份。 */
export function loadPoolTable(): Promise<Group> {
  if (tablePromise) return tablePromise
  tablePromise = loader()
    .loadAsync(BASE + "pool_table.glb")
    .then((gltf) => {
      const src = gltf.scene
      src.scale.setScalar(1) // ← 米制，不要乘 R/0.5
      const merged = mergeByMaterial(src)
      merged.name = "PoolTable"
      /**
       * ⚠️ 整桌下移一个球半径（−R = −32.75 mm）。
       *
       * 本工程的视觉约定是「**球心**在 z=0、台呢顶面在 z=−R」——
       * 实测旧 p8 桌的 cloth 顶面就是 −0.0328，球心 0 正好坐在台呢上；
       * 球杆抬杆高度（R*0.12）、白球落点锥、球的自转轴也都以球心 0 为基准。
       * 新资源包按「台呢顶面 = 0」建模（作者自己的文档也这么写），直接挂上去
       * 球会被切掉下半（实机首屏就是一颗白色半球）。整桌下移 R 后两套约定
       * 对齐，球/球杆/阴影一行都不用改。
       * 代价：桌腿下端会没入地面 32.75 mm（地面 z=−0.80，不透明，不可见）。
       */
      merged.position.z = -R
      applyPoolTableSkin(merged, Settings.get().tableSkin)
      return merged
    })
    .catch((e) => {
      tablePromise = null
      throw e
    })
  return tablePromise
}

/**
 * 按当前皮肤给新桌体上色。
 *
 * 只写四个「参数化」材质：cloth / cushion / wood / diamond。
 * pocket / leg / brass / black_rubber 在资源里已是烘焙色，保持不动；
 * 发光皮肤（obsidian / neon / lava …）把 emissive 交给 brass 与 diamond，
 * 让桌沿有一条与皮肤同色的光带 —— 与工程原有 frameGlow 语义一致。
 */
export function applyPoolTableSkin(root: Group, tableSkinId: string): void {
  const ts = getTableSkin(tableSkinId)
  const glow = ts.edgeGlow || ts.frameGlow || 0
  root.traverse((o) => {
    const m = o as Mesh
    if (!(m as any).isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats as any[]) {
      if (!mat) continue
      const n = String(mat.name || "").toLowerCase()
      // 中性明度贴图 × 皮肤色 会整体偏暗一档；补 1.55 的亮度增益，
      // 让台呢/木框在 ACES 下回到与旧模型接近的观感（实测定标）。
      const tint = (hex: number, gain = 1.55) => {
        if (mat.color) {
          mat.color.setHex(hex)
          if (mat.map) mat.color.multiplyScalar(gain)
        }
      }
      if (n === "cloth") {
        // 资源包的台呢贴图实测是「近纯白的中性图」（1024² 全图亮度 0.97±0.02），
        // 乘色后必然是一块平色 —— 织物感必须由法线提供。这里挂工程既有的
        // 无缝绒面法线（周期噪声 + Sobel），按台面尺度给 repeat 24×12，
        // 颗粒约 1~2mm，俯视/瞄准都看得到细密起伏。
        tint(ts.clothColor, 0.46)
        const cn = getClothNormalTexture(tableSkinId)
        if (cn) {
          const nm = cn.clone()
          nm.needsUpdate = true
          nm.wrapS = nm.wrapT = RepeatWrapping
          nm.repeat.set(24, 12)
          mat.normalMap = nm
          if (mat.normalScale) mat.normalScale.set(0.22, 0.22)
        }
        mat.envMapIntensity = 0.18
        if ("sheen" in mat) {
          mat.sheen = 0.3
          mat.sheenRoughness = 0.55
          mat.sheenColor = new Color(ts.clothColor).lerp(
            new Color(0xffffff),
            0.18
          )
        }
      } else if (n === "cushion") {
        tint(ts.cushionColor, 1.35)
        mat.envMapIntensity = 0.45
        if ("emissive" in mat) {
          mat.emissive.setHex(glow || 0x000000)
          mat.emissiveIntensity = glow ? 0.25 : 0
        }
      } else if (n === "wood") {
        tint(ts.frameColor, 1.35)
        mat.envMapIntensity = 0.7
        if ("emissive" in mat) {
          mat.emissive.setHex(ts.frameGlow || 0x000000)
          mat.emissiveIntensity = ts.frameGlow ? 0.9 : 0
        }
      } else if (n === "diamond") {
        if (mat.color) mat.color.setHex(ts.diamondColor ?? 0xc9a86a)
        if ("metalness" in mat) mat.metalness = 0.55
        if ("roughness" in mat) mat.roughness = 0.42
        mat.envMapIntensity = 0.8
        if ("emissive" in mat) {
          const dg = ts.diamondGlow ?? 0
          mat.emissive.setHex(dg ? ts.diamondColor ?? 0xc9a86a : 0x000000)
          mat.emissiveIntensity = dg
        }
      } else if (n === "brass" && glow) {
        if ("emissive" in mat) {
          mat.emissive.setHex(glow)
          mat.emissiveIntensity = 1.8
        }
      }
      mat.needsUpdate = true
    }
  })
}

/** 球杆（1.455m，杆尾在原点、+X 朝杆头）。 */
export function loadPoolCue(): Promise<Group> {
  if (cuePromise) return cuePromise
  cuePromise = loader()
    .loadAsync(BASE + "pool_cue.glb")
    .then((gltf) => {
      const g = gltf.scene
      g.scale.setScalar(1)
      g.traverse((o) => {
        const m = o as Mesh
        if (!(m as any).isMesh) return
        m.castShadow = true
        m.receiveShadow = true
      })
      return g
    })
    .catch((e) => {
      cuePromise = null
      throw e
    })
  return cuePromise
}

/** 球号贴图（0 = 母球，1..15 彩色球）。 */
export function getBallTexture(label: number): Texture {
  const key = Math.max(0, Math.min(15, label))
  const hit = ballTexCache.get(key)
  if (hit) return hit
  const tex = new TextureLoader().load(
    `${BASE}textures/ball_${String(key).padStart(2, "0")}.png`
  )
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.anisotropy = 8
  tex.needsUpdate = true
  ballTexCache.set(key, tex)
  return tex
}

/** 新球材质：号码贴图 + 清漆。母球（label 0）保持纯白，不用带红点贴图。 */
export function createPoolBallMaterial(label: number, fallback: Color) {
  if (label === 0) {
    return new MeshPhysicalMaterial({
      color: 0xf7f6f2,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      reflectivity: 0.3,
    })
  }
  const m = new MeshPhysicalMaterial({
    map: getBallTexture(label),
    // 贴图自带颜色；基色留白避免二次乘暗
    color: 0xffffff,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    reflectivity: 0.3,
  })
  m.userData.fallbackColor = fallback.getHex()
  return m
}

/**
 * 房间与家具（不含桌）。
 *
 * ⚠️ 224 个 primitive / 143 种材质：按材质合并后 draw call ≈ 材质数。
 * 这是静态场景，合并已把顶点数降到最低；若低端机吃紧，后续可在
 * 「同材质但小件很多」的分组（书脊 / 植物）上再做一级实例化。
 */
export function loadPoolRoom(): Promise<Group> {
  if (roomPromise) return roomPromise
  roomPromise = loader()
    .loadAsync(BASE + "pool_room.glb")
    .then((gltf) => {
      const src = gltf.scene
      src.scale.setScalar(1)
      /**
       * 顶棚与吊灯必须单独成组并命名为 CeilingGroup。
       *
       * view.ts 每帧按相机高度开关该组：俯视相机在层高（2.63）之上，
       * 不藏起来的话 —— 顶棚会把整个房间看穿，**吊灯会正对镜头糊成一团
       * 白光**（实机首测就是满屏白斑，三头吊灯的灯罩正好在球桌正上方）。
       *
       * 分类依据是**节点名**（Pendant_Shade / Pendant_Bulb…）与材质名
       * （ceiling）：这两类都挂在天上，俯视一律不该出现。
       */
      const isOverhead = (m: Mesh) => {
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        const matHit = mats.some((mm: any) =>
          /ceiling|pendant_/i.test(mm?.name || "")
        )
        return /^Pendant/i.test(m.name || "") || matHit
      }
      /**
       * 纯色件单独走「顶点色批处理」：先按材质分组，再把**没有贴图**的
       * 那些组的几何烘上颜色、合成一个网格。
       */
      const hasAnyMap = (mat: any) =>
        !!(mat && (mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap))
      const solidGeos: any[] = []
      src.updateMatrixWorld(true)
      src.traverse((o) => {
        const m = o as Mesh
        if (!(m as any).isMesh || isOverhead(m)) return
        const mat = Array.isArray(m.material) ? m.material[0] : m.material
        if (!mat || hasAnyMap(mat)) return
        const g = m.geometry.clone()
        for (const attr of Object.keys(g.attributes)) {
          if (attr !== "position" && attr !== "normal" && attr !== "uv") {
            g.deleteAttribute(attr)
          }
        }
        if (!g.attributes.normal) g.computeVertexNormals()
        if (!g.attributes.uv) {
          const n = g.attributes.position.count
          g.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2))
        }
        const n = g.attributes.position.count
        const col = new Float32Array(n * 3)
        const c = (mat as any).color ?? new Color(0xffffff)
        for (let i = 0; i < n; i++) {
          col[i * 3] = c.r
          col[i * 3 + 1] = c.g
          col[i * 3 + 2] = c.b
        }
        g.setAttribute("color", new BufferAttribute(col, 3))
        g.applyMatrix4(m.matrixWorld)
        solidGeos.push(g)
      })

      const isSolid = (m: Mesh) => {
        const mat = Array.isArray(m.material) ? m.material[0] : m.material
        return !!mat && !hasAnyMap(mat)
      }
      const room = mergeByMaterial(
        src,
        (m) => !isOverhead(m) && !isSolid(m)
      )
      room.name = "PoolRoom"
      const solid = mergeSolidToVertexColors(solidGeos)
      if (solid) room.add(solid)
      const overhead = mergeByMaterial(src, isOverhead)
      const ceilGroup = new Group()
      ceilGroup.name = "CeilingGroup"
      while (overhead.children.length) ceilGroup.add(overhead.children[0])
      room.add(ceilGroup)
      return room
    })
    .catch((e) => {
      roomPromise = null
      throw e
    })
  return roomPromise
}

/* ══════════════════════════════════════════════════════════════════════
 * v1.8.0 · 写实中式八球桌 pool_table_real_cn8.glb
 *
 * 与 pool_table.glb（程序化重建、Z-up、材质名可换肤）完全不同的另一套
 * 模型：来自 VRChat 中8桌 FBX（MIT），只有 4 个材质、整桌共用一张
 * 1024² albedo 图，而且是 **Y-up**（高度在 Y，短边在 Z）。
 *
 * 三件事必须在接入时一次做对，否则实机就是「球陷进桌面 / 桌子躺倒 /
 * 袋口全错位」：
 *
 *  1. Y-up → Z-up：绕 X 轴 +90°，(x,y,z) → (x, −z, y)。
 *  2. **非均匀缩放**对齐玩区，且必须对齐**台呢内沿**而非整桌外框。
 *     工程物理边界是球心口径 `tableX = R×43`，库边内表面在
 *     `X = tableX + R = R×44`；台呢可见矩形正好覆盖到库边内表面。
 *     所以目标尺寸是 **R×44 / R×22**，不是 R×43 / R×21。
 *  3. 台呢顶面落到 z = −R（球心 z=0、球半径 R 时球底贴台呢），
 *     整桌沿 Z 平移 −(clothTopY + R)。
 *
 * ⚠️ v1.8.0 的教训（v1.8.1 修正）：上面这两个数当时是**硬编码猜的**，
 * 而且猜错了 ——
 *   - 拿 `Plane.001` 的整桌外框 bbox（1.392 / 0.757）当成台呢内沿，
 *     缩放后台呢只剩 2.568×1.328，比物理玩区 2.8825×1.441 小一圈，
 *     球滚到贴库位置时会明显「越出台面」；
 *   - 把库边顶面 y=0.043 当成了台呢顶面，整桌多下移 42mm，球悬空 6.5mm。
 * 现改为**运行时几何自校准**：直接量出模型里「朝上且面积最大」的水平面
 * （= 台呢），用它的高度与半长/半宽反算缩放与平移。模型换代也不会再错。
 * 常量只在量测失败时兜底。
 *
 * 换肤：只有一张 albedo，没有 cloth/wood 材质可写。改为按**颜色分区**
 * 重着色——鲜绿台呢区换 clothColor、棕木纹区换 frameColor，黑/灰/白
 * 的金属件与皮革保持原样；亮度比例保留木纹与台呢的细密明暗。
 * ══════════════════════════════════════════════════════════════════════ */

const CN8 = {
  FILE: "pool_table_real_cn8.glb",
  /**
   * 兜底常量（量测失败时才用）。实测值：台呢面 y = 0.0012、
   * 台呢半长 1.3214、半宽 0.6861（原始 Y-up 局部坐标）。
   * 注意 0.028/0.043 那两个高度是**库边顶面**，不是台呢。
   */
  CLOTH_TOP_Y: 0.0012,
  CLOTH_HALF_X: 1.3214,
  CLOTH_HALF_Z: 0.6861,
}

/** 台呢量测结果（模型原始 Y-up 局部坐标） */
interface ClothMeasure {
  topY: number
  halfX: number
  halfZ: number
  /** 球心高度平面上、沿 ±x / ±z 的库边内表面距离（= 球与库边的接触点） */
  wallX: number
  wallZ: number
}

/**
 * 从模型几何里量出「台呢平面」：朝上（法线 ny > 0.9）且面积最大的水平层。
 *
 * 为什么用面积而不是按网格名找：这个 GLB 只有 `Plane.001` / `Cube.017`
 * 两个网格、共用 `Cn9ft_Albedo` 一张贴图，台呢与库边混在同一个 mesh 里，
 * 没有可辨识的命名。面积法对这类「台呢 + 库边 + 桌腿全揉在一起」的
 * FBX 导出件最稳：台呢是整张桌上最大的一块水平面（实测 3.59 m²，
 * 而库边顶面只有 0.86 m²），一抓一个准。
 */
function measureCloth(src: Group): ClothMeasure {
  src.updateMatrixWorld(true)
  const toLocal = new Matrix4().copy(src.matrixWorld).invert()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  const nrm = new Vector3()
  const mat = new Matrix4()

  /** y(2mm 桶) → 累计面积 */
  const buckets = new Map<number, number>()
  /** 逐三角记录，第二遍挑层用（40k 顶点量级，内存可忽略） */
  const tris: { y: number; x0: number; x1: number; z0: number; z1: number; area: number }[] = []

  src.traverse((o) => {
    const m = o as Mesh
    if (!(m as any).isMesh) return
    const g = m.geometry
    const pos = g.attributes.position as BufferAttribute
    if (!pos) return
    const idx = g.index
    const total = idx ? idx.count : pos.count
    mat.multiplyMatrices(toLocal, m.matrixWorld)
    for (let i = 0; i + 2 < total; i += 3) {
      const i0 = idx ? idx.getX(i) : i
      const i1 = idx ? idx.getX(i + 1) : i + 1
      const i2 = idx ? idx.getX(i + 2) : i + 2
      a.fromBufferAttribute(pos, i0).applyMatrix4(mat)
      b.fromBufferAttribute(pos, i1).applyMatrix4(mat)
      c.fromBufferAttribute(pos, i2).applyMatrix4(mat)
      ab.subVectors(b, a)
      ac.subVectors(c, a)
      nrm.crossVectors(ab, ac)
      const len = nrm.length()
      if (len < 1e-9) continue
      if (Math.abs(nrm.y) / len < 0.9) continue // 非水平面
      const area = len * 0.5
      const y = (a.y + b.y + c.y) / 3
      const k = Math.round(y / 0.002)
      buckets.set(k, (buckets.get(k) || 0) + area)
      tris.push({
        y,
        x0: Math.min(a.x, b.x, c.x),
        x1: Math.max(a.x, b.x, c.x),
        z0: Math.min(a.z, b.z, c.z),
        z1: Math.max(a.z, b.z, c.z),
        area,
      })
    }
  })

  let bestKey = NaN
  let bestArea = -1
  for (const [k, v] of buckets) {
    if (v > bestArea) {
      bestArea = v
      bestKey = k
    }
  }
  const fallback: ClothMeasure = {
    topY: CN8.CLOTH_TOP_Y,
    halfX: CN8.CLOTH_HALF_X,
    halfZ: CN8.CLOTH_HALF_Z,
    // 兜底：没有库边量测值时退化用台呢 bbox（会略偏内，但不至于天差地别）
    wallX: CN8.CLOTH_HALF_X,
    wallZ: CN8.CLOTH_HALF_Z,
  }
  if (!isFinite(bestKey) || bestArea < 0.5) return fallback

  const centerY = bestKey * 0.002
  // 该层 ±3mm 内（台呢可能带极轻微的弧度/倾斜）都算台呢，用面积加权求高度
  let wsum = 0
  let ysum = 0
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const t of tris) {
    if (Math.abs(t.y - centerY) > 0.003) continue
    wsum += t.area
    ysum += t.y * t.area
    x0 = Math.min(x0, t.x0)
    x1 = Math.max(x1, t.x1)
    z0 = Math.min(z0, t.z0)
    z1 = Math.max(z1, t.z1)
  }
  if (wsum <= 0 || !isFinite(x0) || x1 <= x0 || z1 <= z0) return fallback
  const topY = ysum / wsum

  /**
   * 第二遍：在「球心高度」平面上沿四个方向打水平射线，量库边内表面。
   *
   * 为什么不能直接用台呢平面的 bbox：模型的库边是**带斜度的包裹结构**，
   * 台呢平面一直延伸到库边底下，真正的「球能碰到的那面墙」比台呢平面
   * 边界内缩约 10cm。用台呢 bbox 去对齐物理边界，球心到达 tableX 时
   * 球已经有 2/3 埋在库边里 —— v1.8.0 实机就是这样。
   *
   * 射线高度取 `topY + R`：世界坐标里球心在台呢面之上 R，正好是这个
   * 平面；库边与球的接触点也在这里，所以量到的距离可以直接当边界用。
   * 四条射线都偏移出台面中线（避开中袋开口），取最小值以免打到袋口内壁。
   */
  const rayY = topY + R
  const a3 = new Vector3()
  const b3 = new Vector3()
  const c3 = new Vector3()
  const e1 = new Vector3()
  const e2 = new Vector3()
  const pv = new Vector3()
  const tv = new Vector3()
  const qv = new Vector3()
  const hit = (ox: number, oz: number, dx: number, dz: number): number => {
    let best = Infinity
    src.traverse((o) => {
      const m = o as Mesh
      if (!(m as any).isMesh) return
      const g = m.geometry
      const pos = g.attributes.position as BufferAttribute
      if (!pos) return
      const idx = g.index
      const total = idx ? idx.count : pos.count
      // 统一到 src 局部坐标（与 topY / rayY 同一空间）
      mat.multiplyMatrices(toLocal, m.matrixWorld)
      const e = mat.elements
      const at = (i: number, out: Vector3) => {
        const x = pos.getX(i)
        const y = pos.getY(i)
        const z = pos.getZ(i)
        out.set(
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14]
        )
        return out
      }
      for (let i = 0; i + 2 < total; i += 3) {
        at(idx ? idx.getX(i) : i, a3)
        at(idx ? idx.getX(i + 1) : i + 1, b3)
        at(idx ? idx.getX(i + 2) : i + 2, c3)
        e1.subVectors(b3, a3)
        e2.subVectors(c3, a3)
        pv.set(dx, 0, dz).cross(e2)
        const det = e1.dot(pv)
        if (Math.abs(det) < 1e-12) continue
        const invDet = 1 / det
        tv.set(ox - a3.x, rayY - a3.y, oz - a3.z)
        const u = tv.dot(pv) * invDet
        if (u < 0 || u > 1) continue
        qv.crossVectors(tv, e1)
        const vv = (dx * qv.x + dz * qv.z) * invDet
        if (vv < 0 || u + vv > 1) continue
        const t = e2.dot(qv) * invDet
        if (t > 1e-6 && t < best) best = t
      }
    })
    return best
  }
  // 沿 +x / −x（z 偏移 0.30 避开中袋），沿 +z / −z（x 偏移 0.55）
  const hx = Math.min(hit(0, 0.30, 1, 0), hit(0, -0.30, -1, 0))
  const hz = Math.min(hit(0.55, 0, 0, 1), hit(-0.55, 0, 0, -1))

  return {
    topY,
    halfX: (x1 - x0) / 2,
    halfZ: (z1 - z0) / 2,
    wallX: isFinite(hx) ? hx : (x1 - x0) / 2,
    wallZ: isFinite(hz) ? hz : (z1 - z0) / 2,
  }
}

let realTablePromise: Promise<Group> | null = null
/** 未重着色的原始 albedo，classic 皮肤直接用它 */
let baseAlbedo: Texture | null = null
const albedoCache = new Map<string, Texture>()

/**
 * 把整张 albedo 按颜色分区换成当前皮肤色，生成一张 CanvasTexture。
 *
 * 取色空间：ImageData 与皮肤 hex 都是 sRGB 8bit，直接按通道比值算即可；
 * 不能用 three.Color（它把 hex 转成线性空间，乘完会整体偏暗）。
 * 亮度系数 k 由原像素亮度 / 该区域基准亮度得到，木纹、台呢的纹理明暗
 * 因此被完整保留，只是色相跟着皮肤走。
 */
function recoloredAlbedo(skinId: string): Texture | null {
  if (!baseAlbedo) return null
  const hit = albedoCache.get(skinId)
  if (hit) return hit
  const src = baseAlbedo
  const img = src.image as any
  if (!img || !img.width || typeof document === "undefined") return null
  const cv = document.createElement("canvas")
  cv.width = img.width
  cv.height = img.height
  const ctx = cv.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const id = ctx.getImageData(0, 0, cv.width, cv.height)
  const d = id.data
  const isClassic = skinId === "classic"
  const ts = getTableSkin(skinId)
  const cr = isClassic ? 1 : (ts.clothColor >> 16) & 255
  const cg = isClassic ? 135 : (ts.clothColor >> 8) & 255
  const cb = isClassic ? 0 : ts.clothColor & 255
  const fr = (ts.frameColor >> 16) & 255
  const fg = (ts.frameColor >> 8) & 255
  const fb = ts.frameColor & 255
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    if (g > r * 1.25 && g > b * 1.25 && g > 45) {
      // 台呢：原始主色约 (1,135,0)，明度全在 G 通道。
      // 工程室内光照偏强（旧程序化桌把 clothColor 乘了 0.46 才压住），
      // 这里给 classic 同样乘 0.55，否则台呢会被洗成荧光绿。
      // 细密确定性颗粒补一点绒面质感，避免整块纯色塑料感。
      const grain = 0.97 + ((((i * 2654435761) >>> 8) & 255) / 255) * 0.06
      const k =
        Math.max(0.3, Math.min(1.7, g / 135)) *
        (isClassic ? 0.55 : 1) *
        grain
      d[i] = Math.min(255, cr * k)
      d[i + 1] = Math.min(255, cg * k)
      d[i + 2] = Math.min(255, cb * k)
    } else if (!isClassic && r > g * 1.08 && g > b * 1.15 && r > 45 && b < g * 0.9) {
      // 木框 / 库边木纹：classic 保留原始写实木纹，其它皮肤才换色
      const lum = r * 0.5 + g * 0.35 + b * 0.15
      const k = Math.max(0.28, Math.min(1.9, lum / 95))
      d[i] = Math.min(255, fr * k)
      d[i + 1] = Math.min(255, fg * k)
      d[i + 2] = Math.min(255, fb * k)
    }
  }
  ctx.putImageData(id, 0, 0)
  const tex = new CanvasTexture(cv)
  // GLTF 贴图 flipY=false；CanvasTexture 默认 true，不复制会整张上下翻
  tex.flipY = src.flipY
  tex.colorSpace = src.colorSpace
  tex.wrapS = src.wrapS
  tex.wrapT = src.wrapT
  tex.anisotropy = 8
  tex.needsUpdate = true
  albedoCache.set(skinId, tex)
  return tex
}

/** 写实桌换肤：分区重着色 albedo + 发光皮肤给金属轨道补 emissive。 */
export function applyRealTableSkin(root: Group, tableSkinId: string): void {
  const ts = getTableSkin(tableSkinId)
  const glow = ts.edgeGlow || ts.frameGlow || 0
  // classic 也走一次重算（压暗台呢 + 绒面颗粒），只是不换色相
  const tex = recoloredAlbedo(tableSkinId) ?? baseAlbedo
  root.traverse((o) => {
    const m = o as Mesh
    if (!(m as any).isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats as any[]) {
      if (!mat) continue
      const n = String(mat.name || "")
      if (n === "Cn9ft_Albedo") {
        if (tex) mat.map = tex
        mat.needsUpdate = true
      } else if (/002|005/.test(n) && "emissive" in mat) {
        mat.emissive?.setHex(glow || 0x000000)
        mat.emissiveIntensity = glow ? 0.5 : 0
        mat.needsUpdate = true
      }
    }
  })
}

/** 写实中式八球桌（米制 Y-up → 工程 Z-up 校准）。 */
export function loadRealCn8Table(): Promise<Group> {
  if (realTablePromise) return realTablePromise
  realTablePromise = loader()
    .loadAsync(BASE + CN8.FILE)
    .then((gltf) => {
      const src = gltf.scene
      /**
       * 运行时自校准（v1.8.1）：量出模型自带的台呢平面，再反算缩放与平移。
       *
       * 目标口径必须是**库边内表面**：
       *   tableX = R×43（球心边界）→ 库边内表面 X = tableX + R = R×44
       *   tableY = R×21（球心边界）→ 库边内表面 Y = tableY + R = R×22
       * 台呢可见矩形覆盖到库边内表面，所以缩放目标就是 R×44 / R×22。
       * 若按 R×43 缩放（v1.8.0 的错法），球心贴库时球面已经越过台呢
       * 半个球径，看起来就是「球跑出台面边缘」。
       */
      const cloth = measureCloth(src)
      /**
       * 校准口径（v1.8.1 修正版）：用**球与库边的接触面**对齐物理边界。
       *
       * 物理：`tableX = R×43` 是球心可达边界，球心到那里时球面正好贴库边，
       * 即库边内表面在 `tableX + R = R×44`（短边同理 `R×22`）。
       * 所以缩放目标就是 R×44 / R×22，基准量是 `wallX / wallZ`（球心高度
       * 平面上的库边内表面），**不是台呢平面 bbox** —— 这个模型的库边是
       * 包裹式斜面，台呢平面一直延伸到库边底下，两者实测差 11cm。用 bbox
       * 校准会让球心还没到 tableX 就先埋进库边，实机表现就是「球越出台面」。
       */
      const sx = (R * 44) / cloth.wallX
      const sy = (R * 22) / cloth.wallZ
      const M = new Matrix4()
        .makeTranslation(0, 0, -(cloth.topY + R))
        .multiply(new Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new Matrix4().makeScale(sx, 1, sy))
      const holder = new Group()
      holder.add(src)
      holder.matrixAutoUpdate = false
      holder.matrix.copy(M)
      holder.updateMatrixWorld(true)

      // 作者标注的「侧边多余深灰记分牌底板」，独立 primitive 的直接剔除
      const filter = (m: Mesh) => {
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        return !mats.some((mm: any) => /mscorecard/i.test(mm?.name || ""))
      }
      const merged = mergeByMaterial(src, filter)
      merged.name = "PoolTableReal"

      merged.traverse((o) => {
        const m = o as Mesh
        if (!(m as any).isMesh) return
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        for (const mat of mats as any[]) {
          if (!mat) continue
          const n = String(mat.name || "")
          if (n === "Cn9ft_Albedo") {
            if (mat.map && !baseAlbedo) baseAlbedo = mat.map
            // FBX→GLB 曾把不透明台呢误标成 BLEND，导致桌腿透到台面上
            // 变成「六根悬浮黑柱」；资源包已修，这里再兜底一次。
            mat.transparent = false
            mat.depthWrite = true
            /**
             * ⚠️ FBX 导出残留 50× 自发光（KHR_materials_emissive_strength：
             * emissive=white、emissiveIntensity=50）。资源包作者把发光贴图
             * 清成全黑来规避「字面被洗成白色」，但材质参数仍在 —— 实机
             * 台呢被洗成荧光亮绿，完全失去写实中8桌的墨绿质感。
             * 这里彻底关掉，颜色只由 albedo 与室内灯光决定。
             */
            if (mat.emissive) mat.emissive.setHex(0x000000)
            mat.emissiveIntensity = 1
            mat.emissiveMap = null
            // 台呢与木框共用一张贴图，环境反射取折中值（旧桌台呢 0.18 /
            // 木框 0.7），避免把刚压回墨绿的台呢又洗亮。
            mat.envMapIntensity = 0.25
            if ("roughness" in mat) mat.roughness = 0.62
            if ("metalness" in mat) mat.metalness = 0.04
            mat.needsUpdate = true
          } else if (/002$/.test(n)) {
            // 金色集球轨道
            if ("metalness" in mat) mat.metalness = 0.65
            if ("roughness" in mat) mat.roughness = 0.38
            mat.envMapIntensity = 0.8
            mat.emissiveIntensity = 1
          } else if (/005$/.test(n)) {
            if ("roughness" in mat) mat.roughness = 0.85
            mat.emissiveIntensity = 1
          }
        }
        m.castShadow = true
        m.receiveShadow = true
      })
      applyRealTableSkin(merged, Settings.get().tableSkin)
      return merged
    })
    .catch((e) => {
      realTablePromise = null
      throw e
    })
  return realTablePromise
}

/* ══════════════════════════════════════════════════════════════════════
 * v1.8.0 · 三个新环境场景（茶室 / 细胞培养舱 / 巨型种子胚囊）
 *
 * 三个 GLB 都是「不含球桌」的纯环境，叠加到常驻球桌上；材质几乎全是
 * 纯色 PBR，正好复用 loadPoolRoom 的顶点色批处理，把上百个网格压到
 * 个位数的 draw call。接入时要处理三件资源包特有的问题：
 *
 *  1. **seed 自带 16 颗摆球与一根球杆**（预览器用的静止道具）。游戏里
 *     已有物理球和随击球动作的球杆，不剔除会看到两套球叠在一起。
 *  2. **保护柱净空**：俯视相机在 z=5.36、fov 20°，可见范围只有
 *     3.361×1.890 m；资源包预览器用 clearPlayView() 把装饰整簇外推。
 *     这里把台面正上方柱状区域内的低空装饰直接丢弃，高位装饰收进
 *     CeilingGroup（俯视自动隐藏、普通机位仍可见），保证两种机位都不挡球。
 *  3. **顶棚 / 囊膜 / 环形肋条**：z 上限远高于层高，俯视会整片糊在
 *     镜头前，一律归入 CeilingGroup。
 * ══════════════════════════════════════════════════════════════════════ */

const ENV_FILES: Record<string, string> = {
  // v1.8.8：room 也从旧 pool_room.glb（房间与家具）升级为资源包新版
  // 「现代台球厅」全场景 —— 自带 16 球 + 球杆，由下面的剔除规则清掉，
  // 只留家具 / 玻璃吊灯 / 装饰画，球桌依旧用游戏自己的常驻桌。
  room: "pool_scene_room.glb",
  tea: "pool_scene_tea.glb",
  cell: "pool_env_cell.glb",
  seed: "pool_env_seed.glb",
}
const envPromises = new Map<string, Promise<Group>>()
/** 台面保护柱半宽 / 半深（俯视可见半宽 1.68/0.945，另留余量） */
const PLAY_COL_X = 2.0
const PLAY_COL_Y = 1.35
/** 高于此 z 的装饰归入 CeilingGroup，俯视隐藏 */
const OVERHEAD_Z = 0.9

/** clone 网格几何、归一化属性集合、烘入世界矩阵（合并前置步骤）。 */
function normalizeGeo(m: Mesh): any {
  const g = m.geometry.clone()
  for (const attr of Object.keys(g.attributes)) {
    if (attr !== "position" && attr !== "normal" && attr !== "uv") {
      g.deleteAttribute(attr)
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals()
  if (!g.attributes.uv) {
    const n = g.attributes.position.count
    g.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2))
  }
  g.applyMatrix4(m.matrixWorld)
  return g
}

/** 把材质的 Base Color 烘进顶点色，供 mergeSolidToVertexColors 合成。 */
function bakeVertexColor(g: any, mat: any): void {
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  const c = mat?.color ?? new Color(0xffffff)
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute("color", new BufferAttribute(col, 3))
}

/**
 * 带贴图 / 半透明 / 自发光的材质不能进顶点色批处理（会丢 alpha 与
 * emissive），按材质合并保留；其余纯色件走批处理。
 */
function isSpecialMaterial(mat: any): boolean {
  if (!mat) return true
  if (mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap) return true
  if (mat.transparent || (typeof mat.opacity === "number" && mat.opacity < 1)) {
    return true
  }
  const e = mat.emissive
  if (e && e.r + e.g + e.b > 0.02) return true
  return false
}

function assembleEnvPart(solidGeos: any[], specialRoot: Group, name: string): Group {
  const out = new Group()
  out.name = name
  const merged = mergeByMaterial(specialRoot)
  while (merged.children.length) out.add(merged.children[0])
  const solid = mergeSolidToVertexColors(solidGeos)
  if (solid) out.add(solid)
  return out
}

/** 加载并预处理一个新环境场景（首次调用后按 id 缓存 Promise）。 */
export function loadPoolEnvironment(id: string): Promise<Group> {
  const file = ENV_FILES[id]
  if (!file) return Promise.reject(new Error("[poolenv] 未知场景: " + id))
  const hit = envPromises.get(id)
  if (hit) return hit
  const p = loader()
    .loadAsync(BASE + file)
    .then((gltf) => {
      const src = gltf.scene
      src.scale.setScalar(1)
      src.updateMatrixWorld(true)

      const mainSolid: any[] = []
      const ceilSolid: any[] = []
      const mainSpecial = new Group()
      const ceilSpecial = new Group()

      src.traverse((o) => {
        const m = o as Mesh
        if (!(m as any).isMesh) return
        const mat: any = Array.isArray(m.material) ? m.material[0] : m.material
        const nodeName = String(m.name || "")
        const matName = String(mat?.name || "")

        // 预览器自带的静止摆球 / 球杆，游戏里必须剔除
        if (
          /^(Ball_\d+|Cue_Placed)$/i.test(nodeName) ||
          /SEED_(Ball|Cue)/i.test(matName) ||
          /SEED_(Ball|Cue)/i.test(nodeName)
        ) {
          return
        }

        const box = new Box3().setFromObject(m)
        // 地面 / 墙 / 护墙板 / 壳 / 格栅等基底不参与净空剔除
        const isStructure =
          /floor|wall|wain|plaster|shell|membrane|ceil|cap|ground|rug|lattice|paper|skirting|plank|rib|grille/i.test(
            nodeName + " " + matName
          )
        const inColumn =
          box.max.x > -PLAY_COL_X &&
          box.min.x < PLAY_COL_X &&
          box.max.y > -PLAY_COL_Y &&
          box.min.y < PLAY_COL_Y &&
          box.max.z > -0.75
        const overhead = box.max.z > OVERHEAD_Z
        // 柱内的低空装饰会挡住俯视球桌 → 丢弃；高位装饰交给 CeilingGroup
        if (!isStructure && inColumn && !overhead) return

        const g = normalizeGeo(m)
        if (isSpecialMaterial(mat)) {
          const clone = new Mesh(g, m.material)
          clone.name = nodeName
          ;(overhead ? ceilSpecial : mainSpecial).add(clone)
        } else {
          bakeVertexColor(g, mat)
          ;(overhead ? ceilSolid : mainSolid).push(g)
        }
      })

      const out = assembleEnvPart(mainSolid, mainSpecial, "PoolEnv_" + id)
      const ceil = assembleEnvPart(ceilSolid, ceilSpecial, "PoolEnvCeiling")
      const cg = new Group()
      cg.name = "CeilingGroup"
      while (ceil.children.length) cg.add(ceil.children[0])
      out.add(cg)

      // 环境是大面积背景：只接收阴影，不投影（否则 shadow camera 被撑爆）
      out.traverse((o) => {
        const mm = o as Mesh
        if (!(mm as any).isMesh) return
        mm.castShadow = false
        mm.receiveShadow = true
      })
      return out
    })
    .catch((e) => {
      envPromises.delete(id)
      throw e
    })
  envPromises.set(id, p)
  return p
}
