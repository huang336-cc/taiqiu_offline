/**
 * 离线验证专用入口（不参与 APK 构建）。
 *
 *   npx webpack --config webpack.verify.js
 *   node /root/.codebuddy/artifact/verify84j.js       # 贴图 + 场景健康
 *   node /root/.codebuddy/artifact/check_beach_pos.js # 沙滩落点回归
 *   node /root/.codebuddy/artifact/verify_indoor.js   # 室内提质验证
 */
import * as THREE from "three"
import { buildSceneEnvironment, ENV_SPECS } from "./src/view/sceneenvironment"
import { getBeachTexture, __texStats } from "./src/view/beachtexturefactory"
import {
  getInteriorTexture,
  __texStats as __interiorTexStats,
  __cachedKinds as __interiorCachedKinds,
} from "./src/view/interiortexturefactory"

/**
 * 遍历场景树统计健康度。
 *   · empty   —— 空几何体（无 position / 0 顶点）：v1.3.84f 真机闪退的元凶
 *   · nan     —— position/normal/color/uv 里的非法数值：NaN 法线的元凶
 *   · mapped  —— 挂了 map 的 Mesh 数
 *   · mapNoUv —— 其中缺 uv 的（贴图会采样到 (0,0)，直接失效）
 */
function __sceneStats(root: any) {
  let meshes = 0
  let verts = 0
  let empty = 0
  let nan = 0
  let mapped = 0
  let mapNoUv = 0
  let shrubMeshes = 0
  /** v1.3.85：材质类型 → 数量。用于 R1（室内应为 MeshStandardMaterial）、R3（范围外应为 MeshBasicMaterial）守门断言 */
  const mats: Record<string, number> = {}
  /**
   * v1.3.85：法线健康度（R2）。
   *
   * 换成 PBR 后法线直接进 `dot(N, L)` —— 若 NaN 或零长度，整个三角形会
   * 黑掉或闪白。basic 材质不用法线，所以这个隐患此前一直被掩盖。
   * `badNrm` 统计逐分量非法或长度明显偏离 1 的顶点数。
   */
  let badNrm = 0
  let nrmChecked = 0
  const texRepeats: Record<string, [number, number]> = {}
  const seenTex = new Map<any, string>()

  root.traverse((o: any) => {
    if (!o.isMesh) return
    meshes++
    const geo = o.geometry
    if (!geo || !geo.attributes || !geo.attributes.position) {
      empty++
      return
    }
    const pos = geo.attributes.position
    if (!pos || pos.count === 0) {
      empty++
      return
    }
    verts += pos.count
    for (const key of ["position", "normal", "color", "uv"]) {
      const a = geo.attributes[key]
      if (!a) continue
      const arr = a.array
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) {
          nan++
          break
        }
      }
    }
    // 逐顶点校验法线（抽样上限 4000，避免大场景遍历过慢）
    const nrm = geo.attributes.normal
    if (nrm && nrm.count) {
      const step = Math.max(1, Math.floor(nrm.count / 4000))
      for (let i = 0; i < nrm.count; i += step) {
        nrmChecked++
        const x = nrm.getX(i)
        const y = nrm.getY(i)
        const z = nrm.getZ(i)
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          badNrm++
          continue
        }
        const len = Math.sqrt(x * x + y * y + z * z)
        // 允许 0.9~1.1 的浮点误差；超出说明法线未归一化或被破坏
        if (len < 0.9 || len > 1.1) badNrm++
      }
    }
    const mat = Array.isArray(o.material) ? o.material[0] : o.material
    const mtype = (mat && mat.type) || "none"
    mats[mtype] = (mats[mtype] || 0) + 1
    const map = mat && mat.map
    if (map) {
      mapped++
      if (!geo.attributes.uv) mapNoUv++
      let label = seenTex.get(map)
      if (!label) {
        const img = map.image as any
        label = `tex${seenTex.size}(${(img && img.width) || 0}x${(img && img.height) || 0})`
        seenTex.set(map, label)
      }
      texRepeats[label] = [map.repeat.x, map.repeat.y]
    }
    if (o.name === "BeachShrubsMesh") shrubMeshes++
  })

  const repeats = Object.values(texRepeats)
  const sorted = repeats.slice().sort((a, b) => b[0] - a[0])
  return {
    meshes,
    verts,
    empty,
    nan,
    badNrm,
    nrmChecked,
    mats,
    mapped,
    mapNoUv,
    shrubMeshes,
    texRepeats: { sand: sorted[0] || null, sandFar: sorted[1] || null, all: texRepeats },
  }
}

/**
 * v1.3.87：球桌模型「材质 ↔ uv」一致性检查器。
 *
 * 补上一个**长期漏检**：`__sceneStats` 的 `mapNoUv` 只被用于场景环境，
 * 而球桌走的是 GLTF 分支，于是「台呢挂了贴图却没有 TEXCOORD_0」这个
 * bug 在回归里一直是绿的（详见 assets.ts `customizeTableScene` 的注释）。
 *
 * 这里直接解析 GLTF 的 JSON chunk，逐 primitive 核对 attributes：
 * 任何「被 paintTable 上色的材质」若所在 primitive 缺 TEXCOORD_0，
 * 就是贴图会采样到 (0,0) 的信号。
 *
 * 注意本函数**不加载 three**，只读文件 —— 因此可以在 node 里零依赖跑。
 */
function __tableUvAudit(modelPath: string) {
  const fs = require("node:fs")
  const raw = JSON.parse(fs.readFileSync(modelPath, "utf8"))
  const prims: Array<{
    index: number
    attributes: string[]
    hasUv: boolean
    material: number
  }> = []
  let index = 0
  for (const mesh of raw.meshes || []) {
    for (const pr of mesh.primitives || []) {
      const attributes = Object.keys(pr.attributes || {})
      prims.push({
        index: index++,
        attributes,
        hasUv: attributes.some((k) => k.startsWith("TEXCOORD")),
        material: pr.material ?? -1,
      })
    }
  }
  const withUv = prims.filter((p) => p.hasUv).length
  return {
    path: modelPath,
    total: prims.length,
    withUv,
    withoutUv: prims.length - withUv,
    prims,
    /** 材质索引 → 材质名，方便把 primitive 和 cloth/wood 对上 */
    materialNames: (raw.materials || []).map((m: any) => m?.name ?? "(unnamed)"),
  }
}

export {
  THREE,
  buildSceneEnvironment,
  ENV_SPECS,
  getBeachTexture,
  __texStats,
  __sceneStats,
  __tableUvAudit,
  getInteriorTexture,
  __interiorTexStats,
  __interiorCachedKinds,
}
