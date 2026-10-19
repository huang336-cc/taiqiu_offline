/**
 * v1.6.0（3D 美化工程 P1）：程序化「台球厅」环境贴图。
 *
 * ## 为什么需要它
 *
 * 球（MeshPhysicalMaterial clearcoat）、桌框金属件、球杆上光面这些 PBR
 * 材质的高光需要一个「环境」去反射 —— 没有 scene.environment 时，
 * clearcoat 再强也只能反射一片黑，球因此像哑光塑料珠。这正是此前
 * 「画面停留在 2D 平涂」的管线级根因之一（另两个：室内无色调映射、
 * 环境物体 toneMapped:false 烘焙顶点色）。
 *
 * ## 为什么不下载 HDR
 *
 * 离线构建 + APK 体积零增长是硬约束。这里用 three.js 几何体搭一间
 * 微型「台球厅」，交给 PMREMGenerator 烘焙成 CubeUV 环境贴图：
 *
 *   - 头顶一条**长条形暖白吊灯**（台球桌吊灯是台球厅的灵魂光源，
 *     球面上那道标志性的长条高光就是它）；
 *   - 两侧墙各一块昏暗的暖色补光板（避免暗部死黑）；
 *   - 地板近黑、墙面暗棕 —— 暗环境让吊灯高光更突出。
 *
 * ## 缓存
 *
 * PMREM 纹理按 renderer 实例缓存（renderer 惰性重建后旧的 GL 资源
 * 已失效，必须重新烘焙）。
 */

import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Texture,
  WebGLRenderer,
} from "three"

const cache = new WeakMap<WebGLRenderer, Texture>()
const skyCache = new WeakMap<WebGLRenderer, Texture>()

/** 搭建供 PMREM 采样的微型台球厅场景（纯自发光面片，无真实光源） */
function buildHallScene(): Scene {
  const scene = new Scene()

  // 房间壳：暗暖棕（比纯黑略亮，暗部不至于死黑）
  const room = new Mesh(
    new BoxGeometry(24, 24, 12),
    new MeshBasicMaterial({ side: BackSide })
  )
  ;(room.material as MeshBasicMaterial).color.setRGB(0.16, 0.13, 0.1)
  scene.add(room)

  // 头顶台球吊灯：长条暖白，HDR 亮度（Color 允许 >1，PMREM 会保留 HDR 范围）
  // 尺寸故意拉长 —— 球面反射出的就是这条「长高光」，一眼台球厅。
  const pendant = new Mesh(
    new PlaneGeometry(9, 3),
    new MeshBasicMaterial()
  )
  ;(pendant.material as MeshBasicMaterial).color.setRGB(6.0, 5.2, 4.0)
  pendant.position.set(0, 0, 5.2)
  pendant.rotation.x = Math.PI // 面朝下
  scene.add(pendant)

  // 吊灯两翼的次级灯带（稍暗、稍冷，拉开色温层次）
  for (const dy of [-5.5, 5.5]) {
    const strip = new Mesh(new PlaneGeometry(6, 1.2), new MeshBasicMaterial())
    ;(strip.material as MeshBasicMaterial).color.setRGB(1.4, 1.3, 1.15)
    strip.position.set(0, dy, 5.2)
    strip.rotation.x = Math.PI
    scene.add(strip)
  }

  // 侧墙补光板：昏黄壁灯感，给球的侧面一个暖色反光出处
  for (const dx of [-11.9, 11.9]) {
    const wall = new Mesh(new PlaneGeometry(5, 2.4), new MeshBasicMaterial())
    ;(wall.material as MeshBasicMaterial).color.setRGB(0.9, 0.66, 0.4)
    wall.position.set(dx, 0, 2.2)
    wall.rotation.y = dx > 0 ? -Math.PI / 2 : Math.PI / 2
    scene.add(wall)
  }

  // 地板：近黑微暖（球底部反射一点地板色，避免下半身悬空感）
  const floor = new Mesh(new PlaneGeometry(23, 23), new MeshBasicMaterial())
  ;(floor.material as MeshBasicMaterial).color.setRGB(0.09, 0.07, 0.05)
  floor.position.set(0, 0, -5.9)
  scene.add(floor)

  return scene
}

/**
 * v1.6.0（P4）：户外天空环境贴图。
 *
 * 户外场景（雪山 / 沙滩 / 球场 / UFC）的明暗全部烘焙在顶点色里，球与球杆
 * 却仍是 PBR 材质 —— 没有 environment 时它们拿不到任何天空反射，白球的
 * 清漆高光只能靠平行光的镜面项，观感比室内更"塑料"。
 *
 * 这里烘一张极简天空：上冷下亮的天穹渐变 + 一个高亮太阳盘（球的球形高光
 * 出处）+ 近白地面反光。强度由调用方压得很低（0.3），只影响球的反射层，
 * 不改变已标定好的场景明暗。
 */
function buildSkyScene(): Scene {
  const scene = new Scene()

  // 天穹：顶部冷蓝天、地平线亮白（单面朝内的球体，仅作辐射来源）
  const dome = new Mesh(new SphereGeometry(60, 24, 16), new MeshBasicMaterial({ side: BackSide }))
  const cols = new Float32Array(dome.geometry.attributes.position.count * 3)
  const pos = dome.geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, Math.min(1, pos.getZ(i) / 60 * 0.5 + 0.5))
    // 地平线 (0.62,0.66,0.70) → 天顶 (0.16,0.28,0.52)
    cols[i * 3] = 0.62 + (0.16 - 0.62) * h
    cols[i * 3 + 1] = 0.66 + (0.28 - 0.66) * h
    cols[i * 3 + 2] = 0.70 + (0.52 - 0.70) * h
  }
  dome.geometry.setAttribute("color", new BufferAttribute(cols, 3))
  ;(dome.material as MeshBasicMaterial).vertexColors = true
  scene.add(dome)

  // 地面：近白（雪原 / 沙地 / 木地板的反照率差异不体现在这里，取中性亮色）
  const ground = new Mesh(new PlaneGeometry(200, 200), new MeshBasicMaterial())
  ;(ground.material as MeshBasicMaterial).color.setRGB(0.75, 0.75, 0.78)
  ground.position.set(0, 0, -30)
  scene.add(ground)

  // 太阳盘：HDR 高亮，球面上那一小块锐利高光就是它
  const sun = new Mesh(new CircleGeometry(4, 24), new MeshBasicMaterial())
  ;(sun.material as MeshBasicMaterial).color.setRGB(9, 8.6, 7.6)
  sun.position.set(20, -14, 42)
  sun.lookAt(0, 0, 0)
  scene.add(sun)

  return scene
}

/**
 * 取户外天空环境贴图（按 renderer 缓存单例）。
 */
export function getOutdoorSkyEnvironment(renderer: WebGLRenderer): Texture {
  const hit = skyCache.get(renderer)
  if (hit) return hit

  const pmrem = new PMREMGenerator(renderer)
  const sky = buildSkyScene()
  const rt = pmrem.fromScene(sky, 0.08)
  sky.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      ;(m.material as MeshBasicMaterial).dispose()
    }
  })
  pmrem.dispose()

  skyCache.set(renderer, rt.texture)
  return rt.texture
}

/**
 * 取台球厅环境贴图（按 renderer 缓存单例）。
 *
 * 调用方把它赋给 `scene.environment`，再按场景调
 * `scene.environmentIntensity` 控制反射强度。
 */
export function getBilliardHallEnvironment(
  renderer: WebGLRenderer
): Texture {
  const hit = cache.get(renderer)
  if (hit) return hit

  const pmrem = new PMREMGenerator(renderer)
  const hall = buildHallScene()
  const rt = pmrem.fromScene(hall, 0.06)

  // 烘焙完即可释放采样场景与 PMREM 内部资源（纹理本体由 rt.texture 持有）
  hall.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      ;(m.material as MeshBasicMaterial).dispose()
    }
  })
  pmrem.dispose()

  cache.set(renderer, rt.texture)
  return rt.texture
}
