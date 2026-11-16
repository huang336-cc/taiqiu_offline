/**
 * 3D 环境搭建（Request D-v3 / D-v4 / 雪山改造 v1.1.5）。
 *
 * 全部用 three.js 几何体（Plane/Box/Ring/Cone/Sphere/LOD）从零搭建真实 3D 场景，
 * 台球桌（AABB y∈[-0.93,+0.93]）坐在 y=-0.93 的地面上。
 *
 * 用户反馈（D-v4）：参考图要求背景高山占据视野上部 2/3、第一视角有
 * 强烈纵深感与包围感。v3 山体太小太远（俯视下基本不可见），现全面放大。
 *
 * v1.1.5 雪山改造（Req 2/3/4）：
 *  - Req 2：3D 雪山 + 冰川峡谷 + 平整雪原 + 晴天蓝天穹顶（程序化顶点色球形天穹，
 *           非静态 2D 贴图）；相机随瞄准绕台旋转，真实 3D 几何天然产生视差。
 *  - Req 3：雪山改用受光的 MeshLambertMaterial（原 MeshBasicMaterial 不受光、无阴影），
 *           由 view.ts 注入户外平行太阳光(DirectionalLight)+天空天光(HemisphereLight)，
 *           阴影自然投射在台呢与雪原上。
 *  - Req 4：远景雪山使用 THREE.LOD 分级模型，远距离自动降面数，移动端帧率与原版持平。
 */

import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  BoxGeometry,
  RingGeometry,
  CircleGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  SphereGeometry,
  BackSide,
  BufferGeometry,
  BufferAttribute,
  Color,
  Matrix4,
  Vector3,
  Texture,
  SRGBColorSpace,
} from "three"
import { makeValueNoise2D, fbm2D, makeSeededRng } from "../utils/noise"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { loadPoolRoom, loadPoolEnvironment } from "./poolassets"
import { getBeachTexture } from "./beachtexturefactory"

/**
 * 台球桌底沿真实世界 z 坐标（Z-up 世界），用于雪山场景：
 * v1.3.95：球桌按**真实高度**摆放 —— 物理台面保持 z=0 完全不动，只让地面下沉。
 *
 * 真实中式八球 / 斯诺克球桌的台面离地约 0.76~0.81m，这里取 **0.80m**。
 * 此前 GROUND_Z = -0.203（仅等于桌体厚度），桌面离地只有 20cm，
 * 观感就是"整张桌子直接插在地面上"。
 *
 * ## 为什么是「降地面」而不是「抬球桌」
 * 物理层严格假定「台面 = z=0 平面」：Ball.pos.z、Table 的库边/袋口/落袋/跳球
 * 判定全部围绕 z=0 展开。若把球桌整体抬到 +0.597，placeball.ts 等处会把新的
 * z 写回物理坐标 → 落台判定直接失效；相机机位与鼠标拾取（Plane((0,0,1),0)）
 * 也得逐一改。改为让地面下沉则：物理 / 相机 / 拾取**零改动**，
 * 唯一需要补的是 0.597m 桌腿几何（见 view/tablelegs.ts）。
 *
 * 同时导出给 assets.ts —— 立方体房间（没有几何 3D 环境的场景）的地板
 * 也必须落在这个高度，否则地板会悬在球桌上方，把俯视镜头的球桌整个盖住。
 */
export const GROUND_Z = -0.8

// ══════════════════════════════════════════════════════════════════════
// v1.3.63：场景环境规格表（EnvSpec）
//
// 此前 camera.far / 雾 / 户外光照 / 环境光全部硬编码在 view.applyScene 的
// `if (sceneId === "snow")` 分支里。7 个新场景各来一遍就得复制 7 份分支，
// 而且 far 与天穹半径的一致性只能靠注释约定。改表驱动后：
//   - 每个场景只声明自己的参数，view 统一施加；
//   - 新增场景时 far / skyRadius 的自洽性一眼可查。
// ══════════════════════════════════════════════════════════════════════

export interface EnvSpec {
  /**
   * 相机远裁剪面。
   *
   * 约束：skyRadius 必须 ≤ far − 25。相机相对世界原点最大偏心 22.2
   * （俯视竖屏相机可到 z≈11.7，aim 拉远时 |x|≈5.3，再叠加球桌尺寸），
   * 留 25 的余量保证天穹任何一点都不会被 far 裁掉。
   */
  far: number
  /** 天穹半径；0 = 不建天穹（室内用墙 + 顶棚） */
  skyRadius: number
  /** 户外：启用太阳平行光 + 天空半球光 */
  outdoor: boolean
  /** 覆盖 ENV_SCENES 的 amb/ambI（户外需要压暗环境光，让太阳主导） */
  amb?: { color: number; intensity: number }
  /**
   * three 的线性雾；null = 无雾。
   * 地形自带烘焙大气透视（TerrainStyle.haze）时用 null，避免雾两次。
   */
  fog: { color: number; near: number; far: number } | null
  /** true = 用真实太阳阴影，同时隐藏球的程序化接触阴影（避免双重阴影） */
  realShadow: boolean
  /** 室内：顶棚/吊灯等悬空物进 ceilingGroup，按相机高度显隐 */
  indoor: boolean
  /** 该场景已有程序化几何环境（false → view 走立方体房间兜底） */
  geometric: boolean
}

export function getEnvSpec(id: string): EnvSpec {
  return (
    ENV_SPECS[id] ?? {
      far: 70,
      skyRadius: 0,
      outdoor: false,
      fog: null,
      realShadow: false,
      indoor: false,
      geometric: false,
    }
  )
}

/**
 * v1.1.6 雪山材质改为按调用 new（写在 buildSnowMountain 内），
 * 不再使用模块级单例——避免 assets.ts 切场景时的 dispose bug。
 * 旧的 SNOW/ROCK/ROCK_FAR/SNOW_FAR/ICE 模块单例已删除。
 */

/** 雪山天空穹顶半径（必须小于 view.ts 为雪景放大的相机 far） */
/** v1.3.62：天穹半径须大于地形外缘（120），否则地形会穿出天穹 */
export const SNOW_SKY_RADIUS = 145

/**
 * 8 个场景的环境规格（v1.3.63 表驱动，见上方 EnvSpec 注释）。
 *
 * `geometric` 目前 snow / beach / room / tea / cell / seed 均为 true —— 早期
 * 场景的几何环境在步 3~6 逐个补上后改为 true（view 仍以 buildSceneEnvironment
 * 是否返回 null 为准，表的字段超前不会出错）。
 */
export const ENV_SPECS: Record<string, EnvSpec> = {
  // ── 室内场景：墙 + 顶棚，不需要天穹 ──
  //
  // v1.3.85：`amb` 显式置 0，关掉 view.ts 那盏全局 AmbientLight(0x009922, 0.3)。
  // 那盏灯是绿色（R=0,G=0.6,B=0.13），强度 0.3 → 辐照度约 (0, 0.18, 0.04)，
  // 折算照度因子 0.18/π ≈ 5.7% 的绿偏。环境物体升级为 PBR 后会真实吃到它，
  // 画面会泛绿。室内照度全部交给 indoorAmb / indoorDir（纯白），故此处归零。
  room: {
    far: 70, skyRadius: 0, outdoor: false, fog: null,
    amb: { color: 0xffffff, intensity: 0 },
    realShadow: false, indoor: true, geometric: true,
  },
  // ── 户外：地形外缘 60/70，天穹 110/100 ──
  //
  // outdoor 一律 false：开真实太阳光会让球桌与球（受光材质）吃 1.8 的
  // 平行光 + 0.55 半球光，与 ambient 叠加后过曝。所有明暗照旧烘焙进
  // 顶点色（TerrainStyle.bakeSun 是假想太阳，与场景真实光源无关），
  // 环境物体与球桌各走各的着色路径、互不干扰。
  beach: {
    far: 140, skyRadius: 110, outdoor: false, fog: null,
    realShadow: false, indoor: false, geometric: true,
  },
  // ── 雪山（golden 基准，参数与 v1.3.62 完全一致）──
  snow: {
    far: SNOW_SKY_RADIUS + 20,
    skyRadius: SNOW_SKY_RADIUS,
    outdoor: true,
    // 压暗环境光让太阳主导，阴影更自然
    amb: { color: 0xdfeaff, intensity: 0.32 },
    /**
     * v1.3.62d 从 (30,250) 推到 (70,320)：原参数下近景山脊（r=26~62）
     * 就被雾化 0~13%，远山 21%~41% —— 明暗差被 (1-fogFactor) 压平，
     * 山体亮度中位数被抬到 196、p90 只有 215，全挤在亮部发灰。
     */
    fog: { color: 0xd3e9f7, near: 70, far: 320 },
    realShadow: true,
    indoor: false,
    geometric: true,
  },
  // v1.8.3：足球场 / 篮球场 / UFC 八角笼三个场景已下线，对应 EnvSpec 移除
  // v1.8.0：三个资源包 v2 环境。都是全封闭室内布景，复用 room 的
  // 室内三件套灯光（indoorAmb / indoorHemi / indoorDir + 吊灯 SpotLight）
  // 与台球厅环境反射；amb 归零同样是避免那盏绿色全局灯把场景染绿。
  tea: {
    far: 70, skyRadius: 0, outdoor: false, fog: null,
    amb: { color: 0xffffff, intensity: 0 },
    realShadow: false, indoor: true, geometric: true,
  },
  cell: {
    far: 70, skyRadius: 0, outdoor: false, fog: null,
    amb: { color: 0xffffff, intensity: 0 },
    realShadow: false, indoor: true, geometric: true,
  },
  seed: {
    far: 70, skyRadius: 0, outdoor: false, fog: null,
    amb: { color: 0xffffff, intensity: 0 },
    realShadow: false, indoor: true, geometric: true,
  },
}

/**
 * 程序化蓝天穹顶（Req 2）：用顶点色的大球（BackSide）做渐变天空，
 * 完全由几何生成，不存在静态 2D 背景贴图。
 * 地平线淡蓝 → 天顶深蓝，符合「晴天蓝天」。
 *
 * v1.1.6：旋转 sphere 让极点对齐 +Z（Z-up 世界），渐变沿 z 计算。
 */
/**
 * 天空穹顶。v1.3.60 起支持自定义地平线 / 天顶配色，供足球场（室外）与
 * 篮球场（室内顶棚）复用 —— 原先只有雪山挂了天穹，球场场景背景是纯色，
 * 画面又平又空，这也是「视野差」的观感来源之一。
 *
 * v1.3.62：默认配色升级为「晴天湛蓝」三段渐变（近白→中蓝→深天顶），
 *          更接近真实雪山上空的天空色。地平线偏白，天顶饱和度更高。
 */
function buildSkyDome(
  horizonHex = 0xe6f2fc,   // 近白（地平线略偏蓝）
  midHex = 0x6db1e6,        // 中段蓝
  zenithHex = 0x1a56b0,    // 饱和湛蓝天顶
  radius = SNOW_SKY_RADIUS,
  /**
   * v1.3.62：下半球填「云海」。相机在山顶（aim 视角俯角 16.3°），
   * 球桌围栏上沿的视线斜率约 -0.087，比地面渐近线更陡 —— 于是围栏与
   * 远处地形之间会露出一条「空白带」。把它画成云海，正好符合参考图
   * 「雪山顶上一张台球桌、四周云海翻涌」的观感。
   */
  cloudHex = 0xf4f8fc,
  /**
   * v1.3.62c：是否参与 ACES 色调映射。
   *
   * 场景开了 ACESFilmicToneMapping + 曝光 0.95，实测灰阶响应为
   * 「线性 0.45→188、0.70→211、0.95→223、1.50→236」—— 0.5 以上的输入全部
   * 被压到 194+，天空本就只有不到 2° 的可见高度，再被压缩饱和度就成了灰白。
   * 传 false 可让顶点色所见即所得（天穹是纯背景，不参与真实光照，跳过
   * 色调映射不会与受光物体产生割裂）。默认 true 以保持其它场景原样。
   */
  toneMapped = true,
  /**
   * v1.3.62d：上半球渐变的两个停靠点（默认 0.22 / 0.55）。
   *
   * aim 视角画面顶边只有 +2.07°，可见天空全部落在 z/radius ∈ [0, 0.036]
   * —— 默认停靠点意味着这段天空几乎全是地平线色，渐变等于没生效，
   * 天空就是一条没有层次的浅蓝带。雪景传 [0.010, 0.040]，让这 2° 的
   * 可见高度内呈现出「近地浅霾 → 天顶深蓝」的真实梯度（亮度 218 → 170）。
   */
  stops: [number, number] = [0.22, 0.55]
): Mesh {
  const geo = new SphereGeometry(radius, 48, 28)
  geo.rotateX(Math.PI / 2) // Z-up: 把极点从 ±Y 转到 ±Z
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const horizon = new Color(horizonHex)
  const mid = new Color(midHex)
  const zenith = new Color(zenithHex)
  const cloud = new Color(cloudHex)
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / radius // -1..1
    if (z < 0) {
      // 下半球：地平线色 → 云海色，0.32 半径内过渡完
      tmp.copy(horizon).lerp(cloud, Math.min(1, -z / 0.32))
    } else {
      const t = z
      const [s0, s1] = stops
      if (t < s0) {
        tmp.copy(horizon).lerp(mid, t / s0)
      } else if (t < s1) {
        tmp.copy(mid).lerp(zenith, (t - s0) / (s1 - s0))
      } else {
        tmp.copy(zenith)
      }
    }
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3))
  const mat = new MeshBasicMaterial({
    vertexColors: true,
    side: BackSide,
    fog: false,
    depthWrite: false,
    toneMapped,
  })
  const sky = new Mesh(geo, mat)
  sky.name = "SkyDome"
  sky.renderOrder = -1
  sky.castShadow = false
  sky.receiveShadow = false
  return sky
}

/**
 * 根据 sceneId 返回对应 3D 环境（Group）。返回 null 表示继续走立方体房间。
 */
export function buildSceneEnvironment(sceneId: string): Group | null {
  switch (sceneId) {
    case "snow":
      return buildSnowMountainV3()
    case "beach":
      return buildBeach()
    case "room":
      return buildIndoorScene(sceneId)
    case "tea":
    case "cell":
    case "seed":
      return buildPoolEnvScene(sceneId)
    default:
      return null
  }
}

/**
 * v1.8.0：资源包 v2 的三个环境（茶室 / 细胞培养舱 / 种子胚囊）。
 *
 * GLB 必须异步加载，而 buildSceneEnvironment 是同步接口 —— 沿用
 * buildIndoorScene("room") 的「先返回空组、到达后挂子树」模式。资源
 * 到达前的几十毫秒里画面只有球桌，不会阻断游玩；加载失败只留兜底
 * 背景色，不回退到旧的立方体房间（那个盒子的尺度与新场景不兼容）。
 */
function buildPoolEnvScene(sceneId: string): Group {
  const g = new Group()
  g.name = "PoolEnvRoot_" + sceneId
  loadPoolEnvironment(sceneId)
    .then((env) => {
      g.add(env)
    })
    .catch((e) => {
      console.warn(
        "[poolenv] 环境加载失败，仅保留兜底背景:",
        (e as Error)?.message
      )
    })
  return g
}

/* ══════════════════════════════════════════════════════════════════════
 * v1.3.62 雪山 v3 —— 依据实测相机视锥反推的地形
 *
 * 实测数据（Playwright + SwiftShader，1280×720 横屏，八球练习模式）：
 *
 *   ┌ 俯视 topview：pos(0,0,5.363)、pitch -90°、fov 20°
 *   │   → 地面可见范围仅 3.361m × 1.890m；球桌外轮廓实测 3.292 × 1.85，
 *   │     已占 95.9%。桌边只剩约 2% 的窄边，环境在俯视下基本不可见。
 *   │
 *   └ 瞄准 aim：height R*9=0.2948、dist R*24=0.786、fov 36.725°、
 *      稳态 pitch -16.33° → 可见仰角区间 -34.7°…+2.03°。
 *
 * 所以 aim 是唯一能看到环境的档位，且可用纵向空间由两条边界夹出来：
 *   · 下边界 —— 球桌围栏上沿（实测 z≈+0.020，距相机 2.4~3.2m）形成的视线，
 *     斜率 -0.087（顺长边瞄）到 -0.162（顺短边瞄）；低于它会被球桌挡住。
 *   · 上边界 —— 画面顶边 +2.03°（斜率 +0.0354）。
 *   → 可用「窗宽」= 0.1224·d，最大张角约 7.0°，即画面高度的 19%。
 *
 * 地形据此反推（FLOOR_SLOPE 必须 < 0.087，否则远处整片「掉出画面」）：
 *   谷底  z(r) = GROUND_Z - 0.082·(r - R0)     渐近仰角 -4.69°
 *   峰顶  z(r) ≈ 谷底 + 0.087·r                仰角约 -0.3°…+0.2°
 *   → 山体张角约 5°，占画面高度 13.6%；其上 +0.2°…+2.03° 留给蓝天。
 *   围栏与地形之间露出的空隙，由天穹下半球的「云海」填补（见 buildSkyDome）。
 * ══════════════════════════════════════════════════════════════════════ */

const SNOW_TERRAIN = {
  /** 山顶平台半径：球桌外角 r≈1.89，留出约 2m 雪地裙边 */
  R0: 4.0,
  /** 谷底下降斜率 —— 必须 < 0.087，否则远处地形被球桌挡住 */
  FLOOR_SLOPE: 0.082,
  /**
   * 山脊振幅系数（乘上方位掩码后决定峰顶仰角）。
   * v1.3.62d：0.098 → 0.125。实测可见山脊带的坡度中位数只有 0.163
   * （真实雪山在 0.5 以上），山体因此缺乏受光/背光的硬边。加大振幅后
   * 峰顶仰角推到 -2.5°…+5.7° —— 高山方向的峰顶会被画面顶边裁切，
   * 这正是「站在大山脚下」的观感，同时低矮方向仍留出蓝天。
   */
  AMP_K: 0.125,
  /** 振幅渐入区间：避免桌边就长出高山 */
  RAMP0: 4.5,
  RAMP1: 22,
  /** 地形外缘半径，须 < SNOW_SKY_RADIUS */
  OUTER: 120,
  /** 与球桌底面错开，避免共面 z-fighting */
  SKIN: 0.012,
}

/**
 * v1.3.62c 地形噪声参数。
 *
 * 全部经离线分析器（复制本文件函数到 Node 跑，秒级迭代）实测校准，
 * 关键指标是「各环带坡度分布」与「天际线起伏跨度」：
 *   - k=0.03 时近景带 r=6~26 坡度 p50 仅 0.030，烘焙 N·L 被压缩在 0.54~0.84，
 *     渲染出来就是一块死白（实测像素标准差 0.4）。
 *   - k=0.06 后 p50 升到 0.050，中远景带 0.121 / 0.177，明暗才拉得开。
 */
const SNOW_NOISE = {
  /** 主噪声频率：1/0.06 ≈ 17m 特征尺度，一条视线上能穿7~8条山脊 */
  K: 0.06,
  OCT: 6,
  DET_F: 4.6,
  DET_OCT: 4,
  POW: 0.9,
  B0: 0.68,
  B1: 0.44,
  /** 高频微地形：只制造坡度/阴影，不显著改变轮廓 */
  MICRO_F: 9.5,
  MICRO_OCT: 4,
  MICRO_AMP: 0.028,
  MICRO_CAP: 2.4,
  /**
   * 方位角振幅掩码 —— 让天际线真正起伏的关键。
   *
   * 没有它时，沿任意方位角的视线都会穿过若干条山脊，f 的最大值恒在
   * 0.9~1.0，于是所有方向的峰顶仰角都收敛到同一个渐近值 —— 实测天际线
   * 起伏跨度只有 0.63°，轮廓是一条近乎水平的直线，完全不像雪山。
   * 加一层纯方位角（叠加缓慢径向漂移）的掩码后起伏跨度达 5.83°：
   * 高山方向峰顶被画面顶边裁切、低矮方向留出大片蓝天。
   */
  AZ_SCALE: 1.6,
  AZ_OCT: 3,
  AZ_LO: 0.28,
  AZ_HI: 0.72,
  AZ_MIN: 0.35,
  AZ_SPAN: 1.1,
  /** 径向漂移：打破完美放射对称，山脉走向随距离缓慢偏转 */
  AZ_DRIFT: 0.006,
}

/**
 * v1.3.62c 显示空间着色模型。
 *
 * 地形改用 MeshBasicMaterial + toneMapped=false，顶点色即最终显示色：
 *   out = albedo × (环境光 + 太阳光 × max(0, N·L))
 *
 * 为什么必须这样：
 *  1. 原先地形用 MeshLambertMaterial，顶点色里已烘焙过一遍太阳，
 *     接着又要吃场景真实光照（sun1.8 + hemi0.55 + amb0.32 ≈ 2.53 辐照度），
 *     等于光照算了两遍 —— 任何 0.5 以上的反照率都被顶到过曝。
 *  2. ACES 在 0.5 以上几乎全压平（0.5→194、1.5→236），动态范围只剩
 *     「黑到中灰」这一小段可用。toneMapped=false 绕开它，
 *     0.28~1.0 的亮度线性映射成 71~255 灰阶，对比度提升一个量级。
 *
 * 环境光取偏蓝（雪山阴影由蓝天照明），太阳取偏暖，符合雪地实拍观感。
 */
const SNOW_SHADE = {
  /**
   * 蓝天补光：雪山阴影由天空照明，偏冷蓝。最终定在 0.29。
   *
   * 权衡点很硬：抬高环境光会让暗部变灰（失去立体感），压低又让背光面
   * 死黑。雪面之间有强烈的互反射，真实雪山的背光面也有 130~160 的亮度
   * —— 压到 0.26 时高山方向的背光整片掉到 80~131，比天空（203）还暗
   * 一大截，看起来像剪影而不是雪山。取 0.29 使 ndc 的 p10（0.24）落在
   * 145、p50（0.50）落在 212、p90（0.72）削到纯白：亮部压过天空，
   * 暗部仍是带蓝的阴影。
   */
  AMB: [0.29, 0.35, 0.45],
  /** 直射太阳：偏暖。nd 接近 1 处超过 1.0，雪面高光自然削平为纯白 */
  SUN: [1.15, 1.1, 1.02],
  /**
   * N·L 的对比曲线指数。
   * 线性映射下 nd 的 p10~p90（0.34~0.78）只换来 0.37 的亮度跨度，
   * 且中位落在 0.79 —— 整座山偏亮。取 1.35 次幂把中间调压暗，
   * 跨度增到 0.44，同时把中位亮度从 200 拉到 184 左右。
   */
  GAMMA: 1.35,
}

/**
 * 烘焙的大气透视（替代 three 的线性雾）。
 *
 * 为什么不用 scene.fog：three 的 Fog 按视空间深度线性混合，而本地形从
 * r=26 一直铺到 r=120，可见山体几乎全落在雾化区间里 —— 明暗差被整体
 * 乘上 (1-factor)，相当于给整座山套了一层灰纱（实测把亮度中位数抬到
 * 200、标准差压到 21）。改成烘进顶点色后可以用 smoothstep 精确控制：
 * 近景山脊（<28m）完全不加雾，只有远山（>28m）才淡入天色。
 */
const SNOW_HAZE = {
  START: 28,
  END: 118,
  MAX: 0.35,
  COLOR: [0.827, 0.914, 0.969], // 0xd3e9f7 的显示空间分量
}

/**
 * 烘焙用的假想太阳方向（单位向量）：方位与真实平行光 (9,-6,26) 一致，
 * 仰角压到 38°，让平缓雪坡也能拉开明暗。详见 buildTerrainBand。
 */
const SNOW_BAKE_SUN = [0.6557, -0.4373, 0.6157]

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// ══════════════════════════════════════════════════════════════════════
// v1.3.63：通用径向地形带
//
// buildSnowTerrainBand 里不可复用的只有上面那 5 个硬编码常量块。这里把
// 「高度场 + 反照率 + 光照/雾参数」抽成 TerrainStyle 接口，几何与着色
// 流程收敛到 buildTerrainBand 一处，7 个新场景只需各写一个 style。
//
// 抽取纪律：先复制、拿雪山 golden 截图验证逐像素零差异，再让其他场景
// 接入 —— 否则会把已调好的雪山参数搞乱。
// ══════════════════════════════════════════════════════════════════════

type Noise2D = (x: number, y: number) => number

/** 传给 albedo 回调的几何上下文 */
interface ShadeCtx {
  /** 到世界原点的水平距离 */
  r: number
  /** 方位角 */
  ang: number
  /** 该点高度（Z-up 世界的 z） */
  z: number
  /** 相对高度：0 = 谷底，1 = 峰顶 */
  hT: number
  /** 该点的振幅（平缓区可能为 0） */
  amp: number
  /** 法线分量 */
  nx: number
  ny: number
  nz: number
}

interface TerrainHaze {
  START: number
  END: number
  MAX: number
  /** 显示空间的雾色分量 */
  COLOR: number[]
}

interface TerrainStyle {
  /** 谷底高度（不含起伏） */
  floorZ(r: number): number
  /** 该点的起伏振幅；着色阶段算 hT 需要它 */
  ampAt(r: number, ang: number, nC: Noise2D): number
  /** 最终高度 = floorZ + 起伏 */
  heightZ(r: number, ang: number, nA: Noise2D, nB: Noise2D, nC: Noise2D): number
  /**
   * 反照率（线性工作空间），写进 out。
   * 只管「材质本来的颜色」，光照与雾由 buildTerrainBand 统一施加。
   */
  albedo(out: Color, ctx: ShadeCtx): void
  shade: { AMB: number[]; SUN: number[]; GAMMA: number }
  /** 单位向量，烘焙用的假想太阳方向 */
  bakeSun: number[]
  haze: TerrainHaze | null
  /**
   * 大气透视在光照**之后**施加（默认 false = 光照之前，雪山的既有行为）。
   *
   * 差别在于雾色是否被光照压暗。海面/平原这类能看见「世界尽头」的场景
   * 需要 true：雾色即最终显示色，才能与天穹严丝合缝（否则外缘会露出
   * 一条色差的硬边）。雪山用 false —— 它 MAX 只有 0.35，且地形外缘
   * 早被画面顶边裁掉，无需严格衔接。
   */
  hazeAfterShade?: boolean
  /**
   * amp 低于此值视为「无起伏」，hT 直接取 hTFallback。
   * 平缓区没有「谷底」语义，若按公式算会得到 0/0 或噪声放大。
   */
  ampFloor?: number
  hTFallback?: number
  /** 生成网格的 name（默认 "Terrain"） */
  name?: string
  /**
   * v1.3.84j：给地形挂细节贴图（可选）。
   *
   * 返回 null 表示该风格不用贴图（默认）。**规则由调用方保证**：如果 albedo
   * 会把整片地形倒进同一显示色（如雪山：纯白、几乎无明暗），贴图必须返回
   * null —— 因为 `envMaterial` 是 `finalColor = 顶点色 × 贴图色`，纯色地形上
   * 挂一张细节贴图，等于把细节**直接画在**白面上，纹理对比度会加倍暴露、
   * 呈现为噪点。沙滩有从湿沙到干沙的连续明暗过渡，贴图只做 ±5% 的微调，
   * 才安全。
   *
   * 两张不同 repeat 的贴图**各自预建**（见 beachtexturefactory），禁用 clone()：
   * `disposeEnvGroup()` 不 dispose map，clone 出来的贴图的 image 是同一份，
   * 一旦某处释放就会连坐另一处。
   */
  map?: () => Texture | null
}

interface TerrainBand {
  innerR: number
  outerR: number
  thetaSegs: number
  phiSegs: number
  seedA: number
  seedB: number
  /** 方位角掩码的独立噪声种子 */
  seedC: number
}

/**
 * 噪声表按 seed 缓存（v1.3.63）。
 *
 * makeValueNoise2D 会生成 256×256 的 Float32Array —— 8 个场景、每场景
 * 4~5 条环带、每带 3 张表，重复构造既慢又浪费内存。表内容只由 seed
 * 决定（LCG，确定性），跨场景共享完全安全。
 */
const noiseCache = new Map<number, Noise2D>()
function noise2D(seed: number): Noise2D {
  let n = noiseCache.get(seed)
  if (!n) {
    n = makeValueNoise2D(seed)
    noiseCache.set(seed, n)
  }
  return n
}

/**
 * 生成一圈环形地形。RingGeometry 建在 XY 平面，直接把 z 当高度，
 * 天然契合本项目的 Z-up 世界（up = (0,0,1)）。
 *
 * 所有环共用同一组噪声种子与同一个 thetaSegs —— 相邻环在共享半径上的
 * 顶点角度完全对齐、高度函数取值相同，因此接缝处严丝合缝、不会裂缝。
 *
 * 顶点色 = 反照率 × (天空环境光 + 低角度太阳 × max(0, N·L))，在「显示空间」
 * 直接算出最终颜色，配合 toneMapped=false 所见即所得。
 */
function buildTerrainBand(band: TerrainBand, style: TerrainStyle): Mesh {
  const { innerR, outerR, thetaSegs, phiSegs, seedA, seedB, seedC } = band
  const nA = noise2D(seedA)
  const nB = noise2D(seedB)
  const nC = noise2D(seedC)
  const geo = new RingGeometry(innerR, outerR, thetaSegs, phiSegs)
  const pos = geo.attributes.position
  // v1.3.63：把每点的振幅缓存下来，着色阶段复用（原先 ampAt 要算两遍）。
  // 必须是 Float64Array —— 用 Float32 会把 amp 舍到单精度、hT 跟着漂，
  // 最终顶点色差 1~2 个 ULP（实测 6e-8），golden 零差异验证就过不了。
  const amps = new Float64Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const r = Math.hypot(x, y)
    const ang = Math.atan2(y, x)
    amps[i] = style.ampAt(r, ang, nC)
    pos.setZ(i, style.heightZ(r, ang, nA, nB, nC))
  }
  geo.computeVertexNormals()

  const nrm = geo.attributes.normal
  const colors = new Float32Array(pos.count * 3)
  const tmp = new Color()
  const ampFloor = style.ampFloor ?? 0.05
  const hTFallback = style.hTFallback ?? 0.62
  const { AMB, SUN, GAMMA } = style.shade
  const [sx, sy, sz] = style.bakeSun
  const haze = style.haze
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i)
    const py = pos.getY(i)
    const r = Math.hypot(px, py)
    const ang = Math.atan2(py, px)
    const z = pos.getZ(i)
    const nx = nrm.getX(i)
    const ny = nrm.getY(i)
    const nz = nrm.getZ(i)
    const amp = amps[i]
    // 相对高度：0 = 谷底，1 = 峰顶。
    // 平缓区（amp≈0，即山顶平台）没有「谷底」语义，取中值
    // 让它呈现受光的雪白，而不是塌到最暗的阴影色。
    const hT =
      amp < ampFloor ? hTFallback : smoothstep(0, 1, (z - style.floorZ(r)) / amp)
    style.albedo(tmp, { r, ang, z, hT, amp, nx, ny, nz })

    // ── 烘焙太阳光（显示空间）──
    const nd = Math.max(0, nx * sx + ny * sy + nz * sz)
    const ndc = Math.pow(nd, GAMMA)
    // tmp 的 r/g/b 是线性工作空间分量，先转回显示空间再乘光照系数，
    // 这样写进去的色值就是屏幕上看到的色值（toneMapped=false）。
    let dr = SRGBToDisplay(tmp.r)
    let dg = SRGBToDisplay(tmp.g)
    let db = SRGBToDisplay(tmp.b)
    if (style.hazeAfterShade) {
      dr = Math.min(1, dr * (AMB[0] + SUN[0] * ndc))
      dg = Math.min(1, dg * (AMB[1] + SUN[1] * ndc))
      db = Math.min(1, db * (AMB[2] + SUN[2] * ndc))
    }
    // 大气透视：按半径淡入天色（见 SNOW_HAZE 注释，替代 scene.fog）
    if (haze) {
      const h = haze.MAX * smoothstep(haze.START, haze.END, r)
      if (h > 0) {
        dr += (haze.COLOR[0] - dr) * h
        dg += (haze.COLOR[1] - dg) * h
        db += (haze.COLOR[2] - db) * h
      }
    }
    if (style.hazeAfterShade) {
      tmp.setRGB(dr, dg, db, SRGBColorSpace)
    } else {
      tmp.setRGB(
        Math.min(1, dr * (AMB[0] + SUN[0] * ndc)),
        Math.min(1, dg * (AMB[1] + SUN[1] * ndc)),
        Math.min(1, db * (AMB[2] + SUN[2] * ndc)),
        SRGBColorSpace
      )
    }
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3))
  /**
   * v1.3.84j：可选细节贴图。
   *
   * RingGeometry 自带 uv（归一化到 [0,1] 的方形），整块环带只用一张贴图的
   * 一小块，靠 `repeat` 铺开。顶点色的光照与雾都已烘好，贴图只提供
   * ±5% 明度扰动（见 beachtexturefactory 的「明度 ≥0.8」铁律），
   * `finalColor = 顶点色 × 贴图色` 因此只微调明暗、不改色调。
   */
  const mapTex = style.map ? style.map() : null
  // v1.3.62c：MeshLambertMaterial → MeshBasicMaterial + toneMapped=false。
  // 顶点色已经算完了光照，不能再接受场景真实光照（否则 2.53 的辐照度
  // 会把 0.5 以上的反照率全部顶到过曝），也不能再走 ACES（0.5 以上
  // 全被压到 194+，动态范围尽失）。
  // v1.3.62d：fog=false，大气透视改为烘进顶点色（见 SNOW_HAZE）。
  const mesh = new Mesh(
    geo,
    new MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      fog: envFogEnabled,
      ...(mapTex ? { map: mapTex } : {}),
    })
  )
  mesh.name = style.name ?? "Terrain"
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

// ───────────────────────── 雪山地形的 style ─────────────────────────

/**
 * 把一批带顶点色的几何体合并成一个（v1.3.63）。
 *
 * 森林的树干柱廊有上百根柱子 —— 每根一个 Mesh 就是上百个 draw call，
 * 移动端帧率直接崩。InstancedMesh 能省 draw call，但它的 instanceColor
 * 与 vertexColors 是相乘关系、且都在线性空间，没法像顶点色那样精确
 * 控制「每根柱子的明暗 × 色调」。合并几何体则两者兼得：一个 draw call，
 * 顶点色完全可控。
 *
 * 要求所有输入几何体都有 position / normal / color 属性且非索引。
 *
 * v1.3.84j：新增 `opts.uv` —— 合并时一并搬运 uv 属性。
 * 沙滩近景绿植要挂 `foliage` 贴图，而 `map` 必须有 uv 才能采样；
 * 原来这个函数只搬 position/normal/color，合并后 uv 就丢了，贴图会失效。
 * 默认 false，现有调用（球场/UFС/室内等）行为完全不变。
 * 注意：开启时**每个**输入几何体都必须带 uv，否则跳过该属性并保持不合并 uv。
 */
function mergeColored(
  geos: BufferGeometry[],
  opts?: { uv?: boolean }
): BufferGeometry {
  // v1.3.89c：防御性展开 index（现有调用方在 push 前已自行 toNonIndexed，
  // 这里兜底防直传 indexed 件撕裂 —— 机制同 mergePlain 注释）。
  const flat = geos.map((g) => {
    const ni = g.index ? g.toNonIndexed() : g
    if (ni !== g) g.dispose()
    return ni
  })
  let total = 0
  for (const g of flat) total += g.attributes.position.count
  const wantUv = opts?.uv === true && flat.every((g) => !!g.attributes.uv)
  const pos = new Float32Array(total * 3)
  const nrm = new Float32Array(total * 3)
  const col = new Float32Array(total * 3)
  const uv = wantUv ? new Float32Array(total * 2) : null
  let o = 0
  for (const g of flat) {
    const p = g.attributes.position.array as Float32Array
    const n = g.attributes.normal.array as Float32Array
    const c = g.attributes.color.array as Float32Array
    pos.set(p, o * 3)
    nrm.set(n, o * 3)
    col.set(c, o * 3)
    if (uv) {
      uv.set(g.attributes.uv.array as Float32Array, o * 2)
    }
    o += g.attributes.position.count
    g.dispose()
  }
  const out = new BufferGeometry()
  out.setAttribute("position", new BufferAttribute(pos, 3))
  out.setAttribute("normal", new BufferAttribute(nrm, 3))
  out.setAttribute("color", new BufferAttribute(col, 3))
  if (uv) out.setAttribute("uv", new BufferAttribute(uv, 2))
  return out
}

/**
 * 给一个几何体烘焙「显示空间」的顶点色。
 *
 * 与地形同一套模型（见 SNOW_SHADE 注释）：非雪景下 sun/hemi 都是
 * visible=false，环境物体必须自己算完光照写进顶点色，配
 * MeshBasicMaterial + toneMapped=false 所见即所得。
 *
 * @param base  基色回调：拿到法线 z 分量与顶点索引，写线性工作空间的反照率
 * @param post  可选：光照算完后的后处理，直接在**显示空间**改 rgb
 *              （大气透视必须在这里做 —— 见 TerrainStyle.hazeAfterShade）
 */
export function bakeVertices(
  geo: BufferGeometry,
  shade: { AMB: number[]; SUN: number[]; GAMMA: number },
  bakeSun: number[],
  base: (out: Color, nz: number, i: number) => void,
  post?: (rgb: number[], i: number) => void
): void {
  geo.computeVertexNormals()
  const nrm = geo.attributes.normal
  const n = geo.attributes.position.count
  const colors = new Float32Array(n * 3)
  const tmp = new Color()
  const rgb: number[] = [0, 0, 0]
  const [sx, sy, sz] = bakeSun
  for (let i = 0; i < n; i++) {
    /**
     * v1.3.84h：法线 NaN 兜底。
     *
     * `computeVertexNormals()` 对退化三角形（坐标重合，如 RingGeometry /
     * CircleGeometry 的闭合圆心）会算出 0 长度法线 → NaN。NaN 一旦流入
     * `nz` 会同时污染光照项与顶点色，且写进 normal 属性后真机 WebGL 可能
     * 直接抛错（与 v1.3.84f 空几何体闪退同源）。
     * 这里对读到的法线逐分量校验，非法则退化为「朝上」——对贴地标线而言
     * 正是正确朝向，观感零影响。
     */
    let nx = nrm.getX(i)
    let ny = nrm.getY(i)
    let nz = nrm.getZ(i)
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
      nx = 0
      ny = 0
      nz = 1
      // 回写：把修复后的法线写回属性，避免 NaN 残留在 normal 里。
      nrm.setXYZ(i, nx, ny, nz)
    }
    base(tmp, nz, i)
    const nd = Math.max(0, nx * sx + ny * sy + nz * sz)
    const ndc = Math.pow(nd, shade.GAMMA)
    rgb[0] = SRGBToDisplay(tmp.r) * (shade.AMB[0] + shade.SUN[0] * ndc)
    rgb[1] = SRGBToDisplay(tmp.g) * (shade.AMB[1] + shade.SUN[1] * ndc)
    rgb[2] = SRGBToDisplay(tmp.b) * (shade.AMB[2] + shade.SUN[2] * ndc)
    if (post) post(rgb, i)
    tmp.setRGB(
      Math.min(1, Math.max(0, rgb[0])),
      Math.min(1, Math.max(0, rgb[1])),
      Math.min(1, Math.max(0, rgb[2])),
      SRGBColorSpace
    )
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3))
  // 若上面回写过被修复的法线，标记更新，确保上传到 GPU 的是干净数据
  nrm.needsUpdate = true
}

/**
 * 环境物体统一材质。
 *
 * v1.3.85：新增可选 `pbr` 参数，实现**按场景分流**。
 *
 * 背景：顶点色是 CPU 侧烘焙好的「最终显示色」（`bakeIndoor` / `bakeVertices`
 * 用 `tmp.setRGB(..., SRGBColorSpace)` 转成**线性 albedo** 后写入 `color`
 * 属性）。three 的 `vertexColors` 路径**不对顶点色做 sRGB 解码**
 * （`color_vertex.glsl.js` 只有 `vColor.rgb *= color`，解码只存在于贴图
 * 路径），所以属性里的线性值可以直接喂给 PBR。
 *
 * 而 `MeshBasicMaterial` 把顶点色**原样喷到屏幕**，完全不参与光照计算
 * —— 这正是「画面像色块平涂、没有立体感」的根因。
 *
 * ⚠️ 为什么必须传参分流、不能全局换：
 * 本函数同时服务 beach / snow 等户外场景。这些场景
 * `outdoor` 为 false（snow 除外），太阳光与半球光都隐藏，环境物体**只吃**
 * view.ts 里那盏 `AmbientLight(0x009922, 0.3)`（绿、强度 0.3）。全局换 PBR
 * 会让它们整体变暗约九成并染绿。所以默认行为保持 basic 不变，只有显式
 * 传 `pbr` 的调用点（室内场景）才升级。
 *
 * 「零变形」约束：PBR 的 `BRDF_Lambert` 带 1/π，要让改造后亮度与改造前
 * （直接输出顶点色）一致，需满足 `ambient + Σ dir·max(0,N·L) = π`。
 * 光照参数见 view.ts 的 indoorAmb / indoorDir。
 */
/**
 * v1.3.94：环境材质是否参与 scene.fog（修复「雾只雾桌子不雾山」）。
 *
 * 背景：v1.3.62 给雪山加了 `Fog(0xd3e9f7, 70, 320)`，但本文件所有环境材质
 * 都硬编码 `fog:false`，于是这条雾**只作用于球桌/球/球杆**（它们的材质没关
 * 雾），反而把近景球桌洗淡发白；而最该有大气透视的远景雪山地形/天穹/岩石
 * 完全不受雾，靠顶点色 `SNOW_HAZE` 单独做 —— 两套机制并行且方向相反，
 * 表现为「远山贴脸、近桌后退」，纵深关系整体倒挂。
 *
 * 修法：让环境材质跟随场景的 `spec.fog` —— 有雾的场景（当前仅雪山）环境
 * 物体一起受雾，形成统一的大气透视；无雾场景（其余 7 个）保持 `fog:false`，
 * 行为与改前逐位一致（那些场景 scene.fog 为 null，开不开标志都无效果）。
 *
 * 由 View.applyScene() 在切场景时设置。默认 true 与 Three.js 语义一致。
 */
let envFogEnabled = true

/** 由 View.applyScene() 调用：切换环境材质的雾参与状态。 */
export function setEnvFogEnabled(enabled: boolean): void {
  envFogEnabled = enabled
}

function envMaterial(pbr?: {
  roughness?: number
  metalness?: number
}): MeshBasicMaterial | MeshStandardMaterial {
  if (!pbr) {
    return new MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      fog: envFogEnabled,
    })
  }
  return new MeshStandardMaterial({
    vertexColors: true,
    // 材质基色保持默认白：顶点色已是最终 albedo，再乘个底色会二次压暗
    roughness: pbr.roughness ?? 0.9,
    metalness: pbr.metalness ?? 0,
    // NoToneMapping 下与 true 等效；保留是为了防止将来被误共享进 ACES 场景
    toneMapped: false,
    fog: envFogEnabled,
  })
}

/** 谷底高度：R0 以内是球桌所在的山顶平台，之外按 FLOOR_SLOPE 下降 */
function snowFloorZ(r: number): number {
  const base = GROUND_Z - SNOW_TERRAIN.SKIN
  return r <= SNOW_TERRAIN.R0
    ? base
    : base - SNOW_TERRAIN.FLOOR_SLOPE * (r - SNOW_TERRAIN.R0)
}

/** 山脊振幅：随半径线性增长（保证峰顶张角与距离无关），近处渐入 */
function snowAmpZ(r: number): number {
  return SNOW_TERRAIN.AMP_K * r * smoothstep(SNOW_TERRAIN.RAMP0, SNOW_TERRAIN.RAMP1, r)
}

/**
 * 方位角振幅掩码（0.35 ~ 1.45）。
 *
 * 在「平移后的极坐标圆」上采样噪声：u = cos(θ)·s、v = sin(θ)·s。
 * θ=0 与 θ=2π 天然落在同一点，因此无接缝；再叠加一项随半径缓慢漂移的
 * 偏移，避免山体呈完美放射状（那看起来像伞骨，不像山脉）。
 */
function snowAzMask(r: number, ang: number, nC: Noise2D): number {
  const u = Math.cos(ang) * SNOW_NOISE.AZ_SCALE + r * SNOW_NOISE.AZ_DRIFT + 41.2
  const v =
    Math.sin(ang) * SNOW_NOISE.AZ_SCALE - r * SNOW_NOISE.AZ_DRIFT * 0.7 + 17.5
  const n = fbm2D(nC, u, v, SNOW_NOISE.AZ_OCT)
  return (
    SNOW_NOISE.AZ_MIN +
    SNOW_NOISE.AZ_SPAN * smoothstep(SNOW_NOISE.AZ_LO, SNOW_NOISE.AZ_HI, n)
  )
}

/** 某点的实际山脊振幅（基础振幅 × 方位掩码） */
function snowAmpAt(r: number, ang: number, nC: Noise2D): number {
  return snowAmpZ(r) * snowAzMask(r, ang, nC)
}

/**
 * 径向地形高度场。
 *
 * 噪声在「极坐标拉伸后的笛卡尔域」上采样：u = cos(θ)·r·k、v = sin(θ)·r·k。
 * 这样 θ=0 与 θ=2π 天然重合（无接缝），山脉走向也能连续跨半径，
 * 而不是像角向 fbm 那样在 0/2π 处裂开。
 */
function snowTerrainZ(
  r: number,
  ang: number,
  nA: Noise2D,
  nB: Noise2D,
  nC: Noise2D
): number {
  const k = SNOW_NOISE.K
  const u = Math.cos(ang) * r * k + 11.3
  const v = Math.sin(ang) * r * k + 27.9
  // ridged 变换：把 fbm 的 0/1 极值折成山脊，中间值成为谷地
  const ridgeN = fbm2D(nA, u, v, SNOW_NOISE.OCT)
  const ridged = 1 - Math.abs(2 * ridgeN - 1)
  const det = fbm2D(nB, u * SNOW_NOISE.DET_F, v * SNOW_NOISE.DET_F, SNOW_NOISE.DET_OCT)
  // 指数/系数经实测校准：幂次 1.3 会让典型值塌到 0.3，山脊几乎长不起来。
  // 0.9 次幂 + 抬高基底后，典型 f≈0.5、峰顶可达 0.95。
  const f = Math.pow(ridged, SNOW_NOISE.POW) * (SNOW_NOISE.B0 + SNOW_NOISE.B1 * det)
  const fc = Math.min(1, Math.max(0, f))
  // 高频微地形：只制造坡度/阴影变化，不显著改变山体轮廓。
  // 乘以 f 让谷底保持不变，避免把地形压到围栏视线以下产生空洞。
  const micro =
    (fbm2D(nB, u * SNOW_NOISE.MICRO_F + 3.1, v * SNOW_NOISE.MICRO_F + 7.7, SNOW_NOISE.MICRO_OCT) -
      0.5) *
    Math.min(SNOW_NOISE.MICRO_CAP, r * SNOW_NOISE.MICRO_AMP) *
    fc
  return snowFloorZ(r) + snowAmpAt(r, ang, nC) * fc + micro
}

// 雪线调色板（模块级复用，避免每顶点 new Color）
const SNOW_C_SHADE = new Color(0x9dbde0) // 谷底/背阴雪：偏冷蓝
const SNOW_C_SNOW = new Color(0xffffff) // 雪线以上：纯白
// v1.3.62d：整体提亮一档。原 0x39424d/0x66727e 在烘焙光照下最暗处
// 只有 (23,30,42)，接近纯黑，在白雪里显得像破洞而不是岩石露头。
const SNOW_C_ROCK_LO = new Color(0x4d5763)
const SNOW_C_ROCK_HI = new Color(0x7b8794)
const SNOW_TMP2 = new Color()

/** 雪山的 TerrainStyle（数值与 v1.3.62d 完全一致，见 golden 截图验证） */
const SNOW_STYLE: TerrainStyle = {
  floorZ: snowFloorZ,
  ampAt: snowAmpAt,
  heightZ: snowTerrainZ,
  shade: SNOW_SHADE,
  bakeSun: SNOW_BAKE_SUN,
  haze: SNOW_HAZE,
  name: "SnowTerrain",
  albedo(out, ctx) {
    const { hT, nz } = ctx
    out.copy(SNOW_C_SHADE).lerp(SNOW_C_SNOW, hT)
    // 陡坡露出岩石（真实雪山：缓坡积雪、陡壁裸露）。
    //
    // v1.3.62d：改为「坡度 × 雪线」双重控制。只用坡度控制时，高山方向
    // （方位掩码 1.45）的坡度能到 1.3（52° 崖壁），整片被判成岩石 ——
    // 实测画面顶部 y=0~60 的地形亮度只有 80~105，比天空（201）还暗，
    // 成了一堵黑石墙。真实雪山恰恰相反：雪线以上积雪、以下才是裸岩。
    // 用 smoothstep(0.30, 0.62, hT) 让峰顶（hT>0.62）彻底无岩、保持雪白，
    // 只有中下部陡坡才露岩。
    const slopeRock = smoothstep(0.06, 0.2, 1 - nz)
    const rock = slopeRock * (1 - smoothstep(0.3, 0.62, hT))
    if (rock > 0) {
      SNOW_TMP2.copy(SNOW_C_ROCK_LO).lerp(SNOW_C_ROCK_HI, hT)
      out.lerp(SNOW_TMP2, rock)
    }
  },
}

/** 雪山专用薄封装：把 band 交给通用 buildTerrainBand */
function buildSnowTerrainBand(band: TerrainBand): Mesh {
  return buildTerrainBand(band, SNOW_STYLE)
}

/** 线性工作空间分量 → 显示空间（sRGB 传递函数的正变换） */
function SRGBToDisplay(c: number): number {
  const v = Math.min(1, Math.max(0, c))
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

export function buildSnowMountainV3(): Group {
  const g = new Group()
  g.name = "SnowMountain"

  // 天穹：上半球三段渐变（地平线淡蓝 → 中段蓝 → 天顶湛蓝），
  // 下半球云海（填补围栏与地形之间的空隙，呼应「云端的球桌」）
  g.add(
    buildSkyDome(
      // 近地浅霾 → 中段蓝 → 天顶深蓝；停靠点压到 0.010/0.040（见 stops 注释）
      0xc8e4f8,
      0xa8d4f2,
      0x74b4e6,
      SNOW_SKY_RADIUS,
      0xeef6fc,
      false, // toneMapped=false：天空跳过 ACES，保住湛蓝饱和度
      [0.01, 0.04]
    )
  )

  // 地形分 4 环，越远径向分段越粗；thetaSegs 统一 → 接缝无裂缝
  const bands: Array<{ innerR: number; outerR: number; thetaSegs: number; phiSegs: number }> = [
    { innerR: 0.3, outerR: 6, thetaSegs: 224, phiSegs: 22 },
    { innerR: 6, outerR: 26, thetaSegs: 224, phiSegs: 30 },
    { innerR: 26, outerR: 62, thetaSegs: 224, phiSegs: 28 },
    { innerR: 62, outerR: SNOW_TERRAIN.OUTER, thetaSegs: 224, phiSegs: 24 },
  ]
  for (const b of bands) {
    g.add(
      buildSnowTerrainBand({ ...b, seedA: 1337, seedB: 8821, seedC: 5177 })
    )
  }

  // v1.5.5（#74）：删除球桌旁的 24 个锥形「露头岩石」装饰（buildSnowRocks）——
  // 用户要求只保留远处的连绵雪山，桌面附近不要任何锥体小物件。
  return g
}

// ══════════════════════════════════════════════════════════════════════
// 沙滩（v1.3.63 步 3）
//
// 参考雪山的「程序化地形 + 显示空间着色」，但地貌换成沙丘 + 海面。
//
// 与雪山最关键的差别是**海面外缘可见**：雪山地形外缘 r=120 处的视角在
// 画面顶边之外（被裁掉），所以 haze 只需 0.35；而水平海面延伸到无穷远
// 时视角趋近 0°（水平线），恒在画面内 —— 外缘必须靠 haze 淡到 1.0，
// 且雾色要等于天穹下半球色，否则会露出一条「世界尽头」的硬边。
// ══════════════════════════════════════════════════════════════════════

const BEACH_TERRAIN = {
  /** 球桌所在的沙滩平台半径（与雪山一致，留出约 2m 沙地裙边） */
  R0: 4.0,
  /** 岸线半径：沙丘地形到这里结束，之外交给海面 */
  SHORE: 14,
  /**
   * 海平面高度。低于球桌底沿 0.35m —— 由 aim 可见窗口
   * z ∈ [0.295 − 0.087·d, …] 反推：水面要 d > 9.7m 才露出台边。
   */
  SEA_Z: -0.55,
  /** 海面外缘（须 < 天穹半径 110） */
  OUTER: 60,
  SKIN: 0.012,
  /** 沙丘最大高度 */
  DUNE_H: 0.5,
  DUNE_RAMP0: 4.5,
  DUNE_RAMP1: 9,
}

const BEACH_NOISE = {
  /** 沙丘特征尺度约 7m —— 比雪山的 17m 密，沙丘才够碎 */
  K: 0.14,
  OCT: 4,
  DET_F: 3.2,
  DET_OCT: 3,
  /** 风纹：高频细密沙纹，只影响明暗不改轮廓 */
  RIPPLE_F: 7.5,
  RIPPLE_OCT: 3,
  RIPPLE_AMP: 0.05,
  AZ_SCALE: 1.5,
  AZ_OCT: 3,
  AZ_LO: 0.3,
  AZ_HI: 0.7,
  AZ_MIN: 0.4,
  AZ_SPAN: 1.0,
  AZ_DRIFT: 0.01,
}

/**
 * 沙滩着色。沙子反照率比雪低得多（0.85 → 0.62），且沙地互反射强，
 * 所以环境光抬到 0.42（雪山 0.29）、太阳压到 0.78（雪山 1.15）——
 * 否则同一套参数下沙滩会像曝过度的雪。
 */
const BEACH_SHADE = {
  AMB: [0.42, 0.44, 0.47],
  SUN: [0.78, 0.75, 0.68],
  /** 沙丘很平缓，GAMMA 取 1.2（雪山 1.35）避免暗部糊成一片 */
  GAMMA: 1.2,
}

/**
 * 假想太阳：方位与场景真实平行光 (9,-6,26) 一致，仰角压到 35°。
 * 高仰角下近乎水平的沙地 N·L 恒定（≈sin θ），明暗全被抹平。
 */
const BEACH_BAKE_SUN = [0.681, -0.454, 0.574]

/** 天穹地平线色 / 下半球色，同时也是 haze 的目标色（海天一色） */
const BEACH_HORIZON_HEX = 0xe8f4fa
/** 0xe8f4fa 的显示空间分量 —— haze 在显示空间混合，直接用 sRGB 值 */
const BEACH_HAZE_COLOR = [0.9098, 0.9569, 0.9804]

/**
 * 大气透视：MAX 必须到 1.0。
 * START/END 取 26/58 —— 沙丘带（r<14）完全不受雾影响，海面从 26m
 * 起淡出，到 58m 已是纯雾色，与天穹下半球无缝衔接。
 */
const BEACH_HAZE = {
  START: 26,
  END: 58,
  MAX: 1.0,
  COLOR: BEACH_HAZE_COLOR,
}

/** 沙滩地形高度场：R0 平台 → smoothstep 降入海面 → SHORE 之外保持水下 */
function beachFloorZ(r: number): number {
  const base = GROUND_Z - BEACH_TERRAIN.SKIN
  const seaBed = BEACH_TERRAIN.SEA_Z - 0.06
  if (r <= BEACH_TERRAIN.R0) return base
  if (r >= BEACH_TERRAIN.SHORE) return seaBed
  const t = (r - BEACH_TERRAIN.R0) / (BEACH_TERRAIN.SHORE - BEACH_TERRAIN.R0)
  return base + (seaBed - base) * (t * t * (3 - 2 * t))
}

/** 沙丘振幅：从 RAMP0 长起，接近岸线时归零（沙丘不长在水里） */
function beachAmpAt(r: number, ang: number, nC: Noise2D): number {
  const grow = smoothstep(BEACH_TERRAIN.DUNE_RAMP0, BEACH_TERRAIN.DUNE_RAMP1, r)
  const fade = 1 - smoothstep(BEACH_TERRAIN.SHORE - 4, BEACH_TERRAIN.SHORE, r)
  const u =
    Math.cos(ang) * BEACH_NOISE.AZ_SCALE + r * BEACH_NOISE.AZ_DRIFT + 8.4
  const v =
    Math.sin(ang) * BEACH_NOISE.AZ_SCALE - r * BEACH_NOISE.AZ_DRIFT * 0.7 + 23.6
  const n = fbm2D(nC, u, v, BEACH_NOISE.AZ_OCT)
  const mask =
    BEACH_NOISE.AZ_MIN +
    BEACH_NOISE.AZ_SPAN *
      smoothstep(BEACH_NOISE.AZ_LO, BEACH_NOISE.AZ_HI, n)
  return BEACH_TERRAIN.DUNE_H * grow * fade * mask
}

/** 沙丘高度：fbm 取原值（沙丘是圆润的，不用雪山的 ridged 变换） */
function beachTerrainZ(
  r: number,
  ang: number,
  nA: Noise2D,
  nB: Noise2D,
  nC: Noise2D
): number {
  const k = BEACH_NOISE.K
  const u = Math.cos(ang) * r * k + 3.7
  const v = Math.sin(ang) * r * k + 19.1
  const f = fbm2D(nA, u, v, BEACH_NOISE.OCT)
  const det = fbm2D(nB, u * BEACH_NOISE.DET_F, v * BEACH_NOISE.DET_F, BEACH_NOISE.DET_OCT)
  const h = Math.min(1, Math.max(0, f * 0.75 + det * 0.25))
  // 风纹：乘以 h 让谷底保持平整，避免把地形压出空洞
  const ripple =
    (fbm2D(nB, u * BEACH_NOISE.RIPPLE_F + 2.3, v * BEACH_NOISE.RIPPLE_F + 5.1, BEACH_NOISE.RIPPLE_OCT) -
      0.5) *
    BEACH_NOISE.RIPPLE_AMP *
    h
  return beachFloorZ(r) + beachAmpAt(r, ang, nC) * h + ripple
}

// 沙滩调色板
const BEACH_C_WET = new Color(0xb89a66) // 湿沙/谷底：暖深
const BEACH_C_DRY = new Color(0xead2a0) // 干沙/丘顶：亮金
const BEACH_C_FOAM = new Color(0xf2f6f4) // 浪花泡沫

const BEACH_STYLE: TerrainStyle = {
  floorZ: beachFloorZ,
  ampAt: beachAmpAt,
  heightZ: beachTerrainZ,
  shade: BEACH_SHADE,
  bakeSun: BEACH_BAKE_SUN,
  haze: BEACH_HAZE,
  // 海面外缘可见，雾必须在光照之后施加才能与天穹同色（见 TerrainStyle 注释）
  hazeAfterShade: true,
  ampFloor: 0.02,
  hTFallback: 0.55,
  name: "BeachTerrain",
  albedo(out, ctx) {
    const { hT, r } = ctx
    // 湿沙（谷底/近水）→ 干沙（丘顶）
    out.copy(BEACH_C_WET).lerp(BEACH_C_DRY, smoothstep(0.06, 0.94, hT))
    // 岸线泡沫：SHORE 附近一条白带，柔化沙与水的分界
    const foam =
      1 - smoothstep(0.15, 1.5, Math.abs(r - BEACH_TERRAIN.SHORE + 0.25))
    if (foam > 0) out.lerp(BEACH_C_FOAM, foam * 0.55)
  },
}

/**
 * 海面：一块从 SHORE−2 铺到 OUTER 的环，顶点色直接算最终显示色。
 *
 * 不用 TerrainStyle —— 它是平的，只有波纹与远近色变，走专用逻辑更清楚。
 * 关键同样是 haze：r→OUTER 必须淡到 1.0，且与天穹下半球同色。
 */
function buildBeachSea(): Mesh {
  const geo = new RingGeometry(
    BEACH_TERRAIN.SHORE - 2,
    BEACH_TERRAIN.OUTER,
    224,
    24
  )
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const r = Math.hypot(x, y)
    // 极轻微的涌浪：振幅 1.2cm，只为让高光有一点起伏
    const w = Math.sin(r * 0.9 + Math.atan2(y, x) * 3) * 0.012
    pos.setZ(i, BEACH_TERRAIN.SEA_Z + w)
  }
  geo.computeVertexNormals()

  const nrm = geo.attributes.normal
  const colors = new Float32Array(pos.count * 3)
  const cNear = new Color(0x35c9c0) // 近岸青绿松石（更通透）
  const cFar = new Color(0x0a5a9e) // 远海钴蓝（更深邃）
  const cFoam = new Color(0xe8f6f2)
  const tmp = new Color()
  const { AMB, SUN, GAMMA } = BEACH_SHADE
  const [sx, sy, sz] = BEACH_BAKE_SUN
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i)
    const py = pos.getY(i)
    const r = Math.hypot(px, py)
    const ang = Math.atan2(py, px)
    const nx = nrm.getX(i)
    const ny = nrm.getY(i)
    const nz = nrm.getZ(i)
    // 近岸 → 远海的色变：前 25m 完成
    tmp.copy(cNear).lerp(cFar, smoothstep(0, 25, r))
    // 海面反光：涌浪造成的法线扰动 → 明暗
    const nd = Math.max(0, nx * sx + ny * sy + nz * sz)
    const ndc = Math.pow(nd, GAMMA)
    // 波纹：让海面在 aim 下不是一块死板渐变
    const ripple =
      1 +
      0.09 * Math.sin(r * 1.7 + ang * 2.3) +
      0.055 * Math.sin(r * 4.1 - ang * 5)
    let dr = SRGBToDisplay(tmp.r) * (AMB[0] + SUN[0] * ndc) * ripple
    let dg = SRGBToDisplay(tmp.g) * (AMB[1] + SUN[1] * ndc) * ripple
    let db = SRGBToDisplay(tmp.b) * (AMB[2] + SUN[2] * ndc) * ripple
    /**
     * v1.3.84j：海面横向碎光。
     *
     * 原来的 `ripple` 是两条正弦叠加，在极坐标下是**同心圆 + 螺旋**——
     * 静态时看不太出来，一旦相机随球路晃动，整片海面会像唱片一样整体
     * 转，非常假。真实海面的闪烁是「横向的、破碎的、互不相干的」短亮
     * 线，由不同角度、不同波长的毛细波干涉而成。
     *
     * 这里叠两组交叉行波（相位一个随 +ang、一个随 −ang），再**取两者
     * 乘积的正部**：只在两组波峰同时经过的位置出亮点，于是自动得到
     * 「短横线」而不是连续条纹。波段限制在 r ∈ [6, 58]（岸线泡沫到
     * 地平线之间），刚好避开岸边白线与 haze 饱和区。
     *
     * 幅度 0.40 是刻意偏大的：它作用在已经乘完光照的颜色上，属于
     * 「镜面高光」语义，稍亮一点才读得出「波光」而不是「水色不匀」。
     */
    const glintBand = smoothstep(6, 30, r) * (1 - smoothstep(48, 58, r))
    if (glintBand > 0) {
      const g1 = Math.sin(r * 2.7 + ang * 11.0)
      const g2 = Math.sin(r * 5.3 - ang * 19.0)
      const glint = Math.max(0, g1 * g2) * 0.4 * glintBand
      dr += glint
      dg += glint * 0.98
      db += glint * 0.92
    }
    // 岸边碎浪白线
    const surf = 1 - smoothstep(0, 1.8, r - (BEACH_TERRAIN.SHORE - 2))
    if (surf > 0) {
      const s = surf * 0.5
      dr += (SRGBToDisplay(cFoam.r) - dr) * s
      dg += (SRGBToDisplay(cFoam.g) - dg) * s
      db += (SRGBToDisplay(cFoam.b) - db) * s
    }
    /**
     * v1.3.84i：远海「日光带」。
     *
     * 真实海景里海天交界处总有一条比两侧都亮的横带（阳光在海面的高反射
     * 散射）。原实现只有一条 hover 渐变压过去，海平线是「深蓝撞浅蓝」，
     * 分界读起来发闷。这里在 haze 之前先往地平线色提一档亮度，峰值落在
     * r≈42m（正好是海面中远段），形成一条柔和的亮带。
     */
    const sunGlint = smoothstep(18, 42, r) * (1 - smoothstep(44, 58, r))
    if (sunGlint > 0) {
      const g0 = sunGlint * 0.5
      dr += (BEACH_HAZE.COLOR[0] * 1.06 - dr) * g0
      dg += (BEACH_HAZE.COLOR[1] * 1.06 - dg) * g0
      db += (BEACH_HAZE.COLOR[2] * 1.06 - db) * g0
    }
    // 大气透视：到 OUTER 处必须到满值（否则露出世界尽头硬边）
    const haze =
      BEACH_HAZE.MAX * smoothstep(BEACH_HAZE.START, BEACH_HAZE.END, r)
    dr += (BEACH_HAZE.COLOR[0] - dr) * haze
    dg += (BEACH_HAZE.COLOR[1] - dg) * haze
    db += (BEACH_HAZE.COLOR[2] - db) * haze
    tmp.setRGB(
      Math.min(1, Math.max(0, dr)),
      Math.min(1, Math.max(0, dg)),
      Math.min(1, Math.max(0, db)),
      SRGBColorSpace
    )
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3))
  const mesh = new Mesh(
    geo,
    new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: envFogEnabled })
  )
  mesh.name = "BeachSea"
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * 礁石：给 aim 视角中景补细节。
 *
 * 禁区：俯视相机视野半径只有 0.94m（横屏短边）~1.68m（竖屏）—— 俯视时
 * 球桌之外几乎什么都看不见。礁石放在 r ≥ 2.6 之外，俯视完全不入画；
 * aim 视角水平半角 18.37°，d > 7.8m 起才看得见，正好落在中景。
 *
 * ══════════════════════════════════════════════════════════════════════
 * v1.3.84j 重建：修掉「一堆黑色三棱锥纸板」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 真机截图显示礁石是一堆**纯黑的三棱锥纸板**：平面、锐角、全黑、朝同一侧倒。
 * 三个叠加的成因：
 *
 *   1. **面数太少** —— `IcosahedronGeometry(s, 0)` 只有 20 个面，顶点抖动又把
 *      z 压到 0.5~1.1 倍 → 变成扁平的尖锥。20 面在掠射光下就是「纸板三角」。
 *
 *   2. **光照项没有下限** —— 原式 `nd = max(0, 法线·光向)`，背光面 `nd = 0` →
 *      颜色 = `albedo × AMB`，而 `BEACH_SHADE.AMB = [0.42, 0.44, 0.47]`。
 *      深色岩石 `0x5c5347`（≈0.36,0.33,0.28）乘完只剩 **0.15 左右 → 几乎纯黑**。
 *      这是「黑纸板」的主因，不是颜色选错了。
 *
 *   3. **球面 UV 不可用** —— `IcosahedronGeometry` 继承 `PolyhedronGeometry`
 *      的球面 UV，极点畸变严重，直接贴岩石纹理会被拉花成放射状。
 *
 * 对应三条修复：
 *   · 细分 0 → 2（20 面 → 320 面），并**压扁成石块**（`z × 0.62~0.82`）、
 *     法线向天顶混合，得到圆润的鹅卵石／礁石轮廓，而不是尖锥。
 *   · 光照加**半球补光**（`+0.20 × hemi`，hemi = 朝上程度）：背光面不再掉到 0，
 *     同时提亮岩石底色（cLo/cHi 由 0x5c5347/0x8d8375 → 0x7a7062/0x9a9084）。
 *   · **自算三平面 UV**：按顶点法线主轴选投影平面，避免极点畸变。
 *
 * 另挂 `rock` 贴图（明度 ≥0.8 的细节层，见 beachtexturefactory.ts 的铁律）。
 */
function buildBeachRocks(): Group {
  const g = new Group()
  g.name = "BeachRocks"
  const rng = makeSeededRng(4211)
  // v1.3.84j：提亮岩石底色。原来 0x5c5347 太深，在 0.42 的环境光下直接发黑。
  const cLo = new Color(0x7a7062)
  const cHi = new Color(0x9a9084)
  const tmp = new Color()
  const { AMB, SUN, GAMMA } = BEACH_SHADE
  // 礁石用固定的斜上方光照，配合多面体产生块面感
  const L = [0.681, -0.454, 0.574]
  // v1.3.84j：半球补光强度。0.20 让背光面从「纯黑」提到「深灰」，是修复发黑的关键。
  const HEMI = 0.2
  const rockTex = getBeachTexture("rock")
  const rockGeos: BufferGeometry[] = []
  /**
   * v1.3.84i：礁石 14 → 24 块，半径 2.6~9.0m → 2.6~14m。
   * v1.3.84k：**上限从 14m 收到 11.5m** —— 修「石头泡在海里」。
   *
   * 原上限 14m 正好是沙地带的尽头，那里沙地基准已降到 −0.610、低于
   * 海面 −0.55，沙丘振幅也衰减到 0 —— 最外圈礁石会直接泡在水中。
   * 海水浮力/折射都没做，泡水必然穿帮。
   *
   * 出水沙地的实际范围是 r ≈ 7.5~12.8（沙地基准整条带都在海面之下，
   * 全靠沙丘起伏顶出来；且海面环带从 r=12 起铺开、会盖住更外的沙地），
   * 但礁石**可以**放在更近处：它沉 s×0.42、半径也小（r=2.6 处 s 仅
   * 0.18），沙地平台（r<4）够高，近景礁石一直是正常的。所以只收上限、
   * 不动下限 —— 近处保持「半埋在沙里」的既有观感。
   */
  for (let i = 0; i < 24; i++) {
    const ang = rng() * Math.PI * 2
    const r = 2.6 + rng() * 8.9
    const s = 0.18 + rng() * 0.3 + (r - 2.6) * 0.022
    // 细分 2 = 320 面：足够圆润，又不至于顶点爆炸（24 块 × 320 面 ≈ 7.7k 面）
    const geo = new IcosahedronGeometry(s, 2)
    const pos = geo.attributes.position
    // 压扁系数：把球压成「半埋在沙里的石块」（z 轴压到 62%~82%）
    const flattenZ = 0.62 + rng() * 0.2
    for (let v = 0; v < pos.count; v++) {
      // 圆润抖动：0.86~1.08，刻意**不下压 z**（旧版 z×(0.5+rng×0.6) 是尖锥元凶）
      pos.setXYZ(
        v,
        pos.getX(v) * (0.86 + rng() * 0.22),
        pos.getY(v) * (0.86 + rng() * 0.22),
        pos.getZ(v) * (0.86 + rng() * 0.22)
      )
    }
    // 压扁（在 computeVertexNormals 之前做，法线才正确）
    for (let v = 0; v < pos.count; v++) {
      pos.setZ(v, pos.getZ(v) * flattenZ)
    }
    geo.computeVertexNormals()

    // ── 自算三平面 UV（避开 Icosahedron 球面 UV 的极点畸变）──
    const uv = new Float32Array(pos.count * 2)
    const denom = Math.max(1e-6, s * 2)
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v)
      const y = pos.getY(v)
      const z = pos.getZ(v)
      const ax = Math.abs(x)
      const ay = Math.abs(y)
      const az = Math.abs(z)
      let u: number
      let vv: number
      if (az >= ax && az >= ay) {
        // 法线偏 Z（顶/底面）→ 投影到 XY 平面
        u = (x / denom) * 0.5 + 0.5
        vv = (y / denom) * 0.5 + 0.5
      } else if (ax >= ay) {
        // 法线偏 X（侧面）→ 投影到 YZ 平面
        u = (z / denom) * 0.5 + 0.5
        vv = (y / denom) * 0.5 + 0.5
      } else {
        // 法线偏 Y（侧面）→ 投影到 XZ 平面
        u = (x / denom) * 0.5 + 0.5
        vv = (z / denom) * 0.5 + 0.5
      }
      uv[v * 2] = u
      uv[v * 2 + 1] = vv
    }
    geo.setAttribute("uv", new BufferAttribute(uv, 2))

    const nrm = geo.attributes.normal
    const colors = new Float32Array(pos.count * 3)
    for (let v = 0; v < pos.count; v++) {
      const nx = nrm.getX(v)
      const ny = nrm.getY(v)
      const nz = nrm.getZ(v)
      // 朝上的面用亮色、侧面用深色：配合半球补光形成体积感
      tmp.copy(cLo).lerp(cHi, smoothstep(-0.4, 0.9, nz))
      const nd = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
      const ndc = Math.pow(nd, GAMMA)
      /**
       * 半球补光：hemi = 0.5 + 0.5·nz（朝上 1、朝下 0）。
       * 这是修复「背光面纯黑」的核心 —— 原式只有 AMB + SUN·ndc，
       * nd=0 时只剩 AMB=0.42，深色岩石直接黑掉。
       */
      const hemi = 0.5 + 0.5 * nz
      let dr = SRGBToDisplay(tmp.r)
      let dg = SRGBToDisplay(tmp.g)
      let db = SRGBToDisplay(tmp.b)
      const haze =
        BEACH_HAZE.MAX * smoothstep(BEACH_HAZE.START, BEACH_HAZE.END, r)
      dr += (BEACH_HAZE.COLOR[0] - dr) * haze
      dg += (BEACH_HAZE.COLOR[1] - dg) * haze
      db += (BEACH_HAZE.COLOR[2] - db) * haze
      const litR = AMB[0] + SUN[0] * ndc + HEMI * hemi
      const litG = AMB[1] + SUN[1] * ndc + HEMI * hemi
      const litB = AMB[2] + SUN[2] * ndc + HEMI * hemi
      tmp.setRGB(
        Math.min(1, dr * litR),
        Math.min(1, dg * litG),
        Math.min(1, db * litB),
        SRGBColorSpace
      )
      colors[v * 3] = tmp.r
      colors[v * 3 + 1] = tmp.g
      colors[v * 3 + 2] = tmp.b
    }
    geo.setAttribute("color", new BufferAttribute(colors, 3))
    // v1.3.94：把自转与落位烘进几何（mergeColored 只搬属性、不应用矩阵），
    // 24 块礁石合并为单个 Mesh，省下 23 个 draw call。
    geo.rotateZ(rng() * Math.PI * 2)
    geo.translate(
      Math.cos(ang) * r,
      Math.sin(ang) * r,
      // 半埋在沙里：下沉多一点，露出的部分才像「礁石」而不是「摆件」
      beachFloorZ(r) - s * 0.42
    )
    rockGeos.push(geo)
  }
  const rockMesh = new Mesh(
    mergeColored(rockGeos, { uv: true }),
    new MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      fog: envFogEnabled,
      map: rockTex,
    })
  )
  rockMesh.name = "BeachRockMesh"
  rockMesh.castShadow = false
  rockMesh.receiveShadow = false
  g.add(rockMesh)
  return g
}

/**
 * ⚠️ v1.3.84l：**椰树（`buildBeachPalms`）已彻底删除，不要再加回来。**
 *
 * 它存在过两版（84i~84k），两次都被真机截图否定：
 *
 *   84i —— 外沿扩到 40m，**忘了岸线只有 14m**，26 根里 20 根种进海里；
 *          加上不做树冠，用户看到的就是「海里插了一排光杆柱子」。
 *   84k —— 半径收进 8~11.5m 的出水沙地带，位置对了，但**问题不在位置**。
 *
 * 根本矛盾：`aim` 可见窗口 z ∈ [0.295 − 0.087·d, 0.295 + 0.0354·d]，
 * d=20m 处只能看到 1.0m 高 —— <strong>椰树的树干必然被画面顶边截断</strong>，
 * 永远只能看到一个没有顶的圆柱。树冠要到 d≈282m 才进画（那时树干已细到
 * 看不见），所以「树干入画、树冠不入画」是相机几何决定的死结：
 * 只要画树干，就一定是「柱子」；要画得像树，就得做树冠，而树冠永远不可见。
 *
 * 用户最终决定：**整个删掉，不留任何树**。沙滩的高度层改由礁石（r 2.6~11.5）
 * 与矮灌木丛（r 8~11.5，高 ≤0.45m）承担 —— 它们的尺度在可见窗口内是
 * 完整的，不会被截断，也就不会产生「这是个什么东西」的疑问。
 */

/**
 * 近景绿植：沙滩上成丛的矮灌木／海草。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么是「扁平叶簇」而不是「锥体／球体」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 前几个版本的教训很直接：在掠射视角下，**低多边形的锥体会变成尖刺、
 * 低多边形的球体会变成黑色圆盘**。它们都有共同的毛病 —— 轮廓上没有
 * 「叶片」这种细碎、带缺口的结构，一旦法线朝向不利（背光面 nd=0），
 * 整块就是一个纯色多边形，看起来像摆件。
 *
 * 叶片不同：单个叶片是压扁的多面体（z 压到 35%），轮廓本身就是扁的，
 * 掠射时呈现一条斜向的细长面 —— 哪怕单个叶片颜色有偏差，一堆叶片
 * 交错叠在一起也会自动形成「蓬松的团」。这是「形状正确」压过
 * 「光照正确」的少数情况。
 *
 * 位置策略（与礁石同理，见 buildBeachRocks）：
 *   · r ∈ [8, 11.5] —— **必须落在真正能露出水面的沙地上**。这一点踩过坑：
 *     沙地基准 `beachFloorZ(r)` 在整条沙丘带上都低于海面（−0.55），沙子
 *     全靠 `DUNE_H = 0.5` 的沙丘起伏顶出来，而沙丘振幅 `grow × fade` 只在
 *     **r ≈ 7.5~12.8** 之间才够高，且海面环带从 **r = 12** 起铺开。取到
 *     区间外的丛会整丛泡在水里 —— 真机截图里就是「海里插的柱子」那类穿帮。
 *   · 俯视相机视野半径只有 0.94~1.68m，这个半径完全不入画，不会挡球桌。
 *   · 高 ≤ 0.45m —— 必须压在画面下缘附近。aim 可见窗口在 d=8m 处
 *     只有 z ∈ [0.295−0.70, 0.295+0.28] 里可见，太高会顶到画面外。
 *
 * 光照：与礁石同一套（半球补光 HEMI = 0.20），否则背光叶片会掉到
 * `albedo × AMB` ≈ 0.25 亮度，近景一片黑。叶片两面都有，法线方向
 * 分布极散，没有半球补光几乎必然出现黑块。
 */
function buildBeachShrubs(): Group {
  const g = new Group()
  g.name = "BeachShrubs"
  const rng = makeSeededRng(7723)
  // 叶绿：背面深、朝天面亮 —— 插值轴用「法线朝上程度」，与叶片的
  // 双面观感一致（朝上的叶面受光、朝下的叶背在阴影里）
  const cLo = new Color(0x3f6b3a)
  const cHi = new Color(0x6f9f52)
  const tmp = new Color()
  const { AMB, SUN, GAMMA } = BEACH_SHADE
  const L = [0.681, -0.454, 0.574]
  const HEMI = 0.2
  const foliageTex = getBeachTexture("foliage")
  const geos: BufferGeometry[] = []
  /**
   * 18 丛。每丛 6~10 片叶 —— 片数少了不成团，多了顶点数上升但视觉收益
   * 递减（叶片互相遮挡）。18 丛 × 平均 8 片 = 约 144 片，片均
   * `IcosahedronGeometry(_, 1)` = 80 面，合计约 11.5k 面，可接受。
   */
  for (let i = 0; i < 18; i++) {
    const ang = rng() * Math.PI * 2
    // 与椰树/礁石同一段出水沙地：8~11.5m
    const r = 8 + rng() * 3.5
    const cx = Math.cos(ang) * r
    const cy = Math.sin(ang) * r
    // 直接复用地形带的种子，保证灌木丛**贴着**它脚下那块沙丘的高度，
    // 不会悬空或陷进沙里（种子一致 → 高度函数取值一致）。
    // 只用 bands[0] 一组即可：两条带本来就是同一组种子（见 bands 定义），
    // 高度函数在任何半径上取值都相同。
    const cz = beachTerrainZ(
      r,
      ang,
      noise2D(211),
      noise2D(733),
      noise2D(419)
    )
    const blades = 6 + Math.floor(rng() * 5)
    for (let b = 0; b < blades; b++) {
      // 叶片尺寸随机、位置在丛内散开：同一丛的叶片不能太像
      const leaf = 0.1 + rng() * 0.14
      const geo = new IcosahedronGeometry(leaf, 1)
      const pos = geo.attributes.position
      // 每片叶子的主朝向（丛内偏移）：水平半径 0~0.16m、高度 0~0.13m
      const lx = (rng() - 0.5) * 0.32
      const ly = (rng() - 0.5) * 0.32
      const lz = rng() * 0.13
      // 叶片倾角：0.2~0.9 rad 朝上，让叶片呈「张开」的姿态而不是平摊
      const tilt = 0.2 + rng() * 0.7
      const roll = rng() * Math.PI * 2
      const ct = Math.cos(tilt)
      const st = Math.sin(tilt)
      const cr = Math.cos(roll)
      const sr = Math.sin(roll)
      for (let v = 0; v < pos.count; v++) {
        let vx = pos.getX(v)
        let vy = pos.getY(v)
        let vz = pos.getZ(v)
        // 1) 压扁成叶片（z 方向 35%）—— 双面扁体，掠射下呈细长面
        vz *= 0.35
        // 2) 沿叶片长轴拉伸一点，让形状更「叶」而不是「饼」
        vx *= 1.35
        // 3) 绕 X 轴倾斜（叶片立起来）
        const ty = vy * ct - vz * st
        const tz = vy * st + vz * ct
        vy = ty
        vz = tz
        // 4) 绕 Z 轴滚转（每片方向不同，丛内才不呆板）
        const rx = vx * cr - vy * sr
        const ry = vx * sr + vy * cr
        // 5) 在叶尖处加一点下弯（顶端回收），轮廓更像草叶
        const tip = Math.max(0, vx / (leaf * 1.35))
        pos.setXYZ(v, rx + lx, ry + ly, vz + lz - tip * tip * leaf * 0.5)
      }
      geo.computeVertexNormals()
      // 用叶片贴图采样 —— 需要 uv，IcosahedronGeometry 自带（球面 UV）。
      // 球面 UV 在极点有畸变，但叶片贴图本身只是「杂乱叶脉」，
      // 各向异性畸变反而增加了随机感，这里可以接受（不像礁石那样会被
      // 拉成放射状规则的条纹）。
      const nrm = geo.attributes.normal
      const colors = new Float32Array(pos.count * 3)
      for (let v = 0; v < pos.count; v++) {
        const nx = nrm.getX(v)
        const ny = nrm.getY(v)
        const nz = nrm.getZ(v)
        // 朝上的叶面亮、朝下暗
        tmp.copy(cLo).lerp(cHi, smoothstep(-0.5, 0.9, nz))
        const nd = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
        const ndc = Math.pow(nd, GAMMA)
        const hemi = 0.5 + 0.5 * nz
        let dr = SRGBToDisplay(tmp.r)
        let dg = SRGBToDisplay(tmp.g)
        let db = SRGBToDisplay(tmp.b)
        const haze =
          BEACH_HAZE.MAX * smoothstep(BEACH_HAZE.START, BEACH_HAZE.END, r)
        dr += (BEACH_HAZE.COLOR[0] - dr) * haze
        dg += (BEACH_HAZE.COLOR[1] - dg) * haze
        db += (BEACH_HAZE.COLOR[2] - db) * haze
        tmp.setRGB(
          Math.min(1, dr * (AMB[0] + SUN[0] * ndc + HEMI * hemi)),
          Math.min(1, dg * (AMB[1] + SUN[1] * ndc + HEMI * hemi)),
          Math.min(1, db * (AMB[2] + SUN[2] * ndc + HEMI * hemi)),
          SRGBColorSpace
        )
        colors[v * 3] = tmp.r
        colors[v * 3 + 1] = tmp.g
        colors[v * 3 + 2] = tmp.b
      }
      geo.setAttribute("color", new BufferAttribute(colors, 3))
      // 搬到丛中心（几何体自带世界坐标偏移后合并，省掉逐 Mesh 的 transform）
      geo.translate(cx, cy, cz)
      geos.push(geo)
    }
  }
  /**
   * 合并成单个 Mesh：144 个 Mesh 就是 144 个 draw call，移动端帧率会崩。
   *
   * `{ uv: true }` 是必需的 —— `mergeColored` 默认只搬 position/normal/color，
   * 合并后 uv 会丢，`map` 直接失效（贴图采样到全 0 → 叶子变成贴图左上角
   * 一个像素的纯色）。
   */
  const merged = mergeColored(geos, { uv: true })
  const mesh = new Mesh(
    merged,
    new MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      fog: envFogEnabled,
      map: foliageTex,
    })
  )
  mesh.name = "BeachShrubsMesh"
  g.add(mesh)
  return g
}

/**
 * v1.3.88：沙滩签名物 —— 木栈道 + 冲浪板。
 *
 * ## 为什么要加
 *
 * 八场景审计的结论：beach 只有「沙 + 海 + 天」三个元素，没有一件
 * 「人造物」，跟雪山的区分只靠色温 —— 辨识度缺口最大的户外场景。
 *
 * ## 为什么不是椰树 / 遮阳伞（都是踩过的坑）
 *
 * 椰树：树干入画、树冠永远不入画（见上方 v1.3.84l 的死结分析），已删。
 * 遮阳伞：伞面 1.8~2.2m，d=5m 处画面顶边只有 1.10m —— 必然截顶，与
 * 椰树同一类死结。**栈道贴地、冲浪板 ≤1.4m**，都压在可见窗口内，
 * 不会被截断成「悬空的一截」。
 *
 * ## 落位（probe-occlusion.js 的可见带）
 *
 * 相机在 (-1.51, 0, 0.295) 朝 +X。落位经过两层约束（遮挡检测的球桌
 * AABB 有模型空间 bug，第二轮用视线中点手算修正）：
 *   ① 可见性：d 4~6m 处 0.9m 高 → 板顶仰角 < 画面上缘 9.45°；
 *   ② 遮挡：视线中点必须脱离球桌 xy（x±1.65/y±0.93）—— |y|≥1.9
 *     且 d≥4.2 才不被桌角挡。三板位 (3.6,±2.0)/(4.8,-2.0)/(5.6,1.9)
 *     的视线中点 y ∈ ±0.95~1.0，全部擦着桌角外通过。
 */
function buildBeachProps(): Group {
  const g = new Group()
  g.name = "BeachProps"
  const { AMB, SUN, GAMMA } = BEACH_SHADE
  const L = BEACH_BAKE_SUN
  const nA = noise2D(211)
  const nB = noise2D(733)
  const nC = noise2D(419)
  const tmp = new Color()

  // ── 冲浪板 ×3：压扁椭球 + 斜插沙中，橙白条纹按局部高度分段 ──
  // （栈道已删：贴地平铺物在 ±0.5m 振幅的沙丘上必然半埋半悬，
  //   掠射视角下只剩一条黑侧棱 —— 成本收益太差，不做。）

  // ── 冲浪板 ×3：压扁椭球 + 斜插沙中，橙白条纹按局部高度分段 ──
  const surfColors = [0xc4571f, 0x1f7fc4, 0xd69a26]
  const surfSpots: Array<[number, number, number]> = [
    [3.6, 2.0, 0.5],
    [4.8, -2.0, 0.86],
    [5.6, 1.9, 0.24],
  ]
  surfSpots.forEach(([sx, sy, roll], idx) => {
    const r = Math.hypot(sx, sy)
    const ang = Math.atan2(sy, sx)
    const z = beachTerrainZ(r, ang, nA, nB, nC)
    // 椭球压扁成板：1.44 长 × 0.35 宽 × 0.12 厚（长轴 = 局部 x）
    const geo = new SphereGeometry(0.72, 14, 10)
    const pos = geo.attributes.position
    for (let v = 0; v < pos.count; v++) {
      pos.setXYZ(v, pos.getX(v), pos.getY(v) * 0.24, pos.getZ(v) * 0.085)
    }
    /**
     * 斜插姿态（第一版连错两次的教训）：
     *   ① rotateX 转不动 x 长轴 → 板躺平；
     *   ② rotateY(roll) 会把已立起的板掀翻（roll 大时近乎横躺），
     *      视觉上「板飞在天上」。
     * 正确次序：rotateZ 立起（板面正好朝 ±x = 面向相机）→
     * rotateX 只做板内条纹角（不改变板的立姿）→ 上移 0.42 让下端沉沙。
     * d 4.4~5.8 处板顶 1.14m，仰角 8.8° < 画面上缘 9.45°，完整入画。
     */
    geo.rotateZ(Math.PI / 2 - 0.32)
    geo.rotateX(roll * 0.4)
    geo.translate(0, 0, 0.3)
    geo.computeVertexNormals()
    const nrm = geo.attributes.normal
    const cols = new Float32Array(pos.count * 3)
    const cBody = new Color(surfColors[idx % surfColors.length])
    const cStripe = new Color(0xf4f0e6)
    const hz = new Color()
    for (let v = 0; v < pos.count; v++) {
      // 条纹：沿板长轴（局部 y）按 sin 分段
      const t = Math.sin(pos.getY(v) * 11 + idx * 1.7)
      hz.copy(cBody).lerp(cStripe, t > 0.45 ? 0.85 : 0)
      const nd = Math.max(
        0,
        nrm.getX(v) * L[0] + nrm.getY(v) * L[1] + nrm.getZ(v) * L[2]
      )
      const ndc = Math.pow(nd, GAMMA)
      const hemi = 0.5 + 0.5 * nrm.getZ(v)
      // 背光面兜底 0.55：板面朝 -x 时 nd=0，无兜底就是黑色剪影
      const lit = Math.max(
        Math.max(AMB[0] + SUN[0] * ndc + 0.2 * hemi, 0.55),
        Math.max(AMB[1] + SUN[1] * ndc + 0.2 * hemi, 0.55)
      )
      tmp.setRGB(
        Math.min(1, SRGBToDisplay(hz.r) * lit),
        Math.min(1, SRGBToDisplay(hz.g) * lit),
        Math.min(1, SRGBToDisplay(hz.b) * lit),
        SRGBColorSpace
      )
      cols[v * 3] = tmp.r
      cols[v * 3 + 1] = tmp.g
      cols[v * 3 + 2] = tmp.b
    }
    geo.setAttribute("color", new BufferAttribute(cols, 3))
    const m = new Mesh(
      geo,
      new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: envFogEnabled })
    )
    // 几何已在局部坐标立起（中心 z+0.42、下端 -0.3 沉沙），落位即贴沙面
    m.position.set(sx, sy, z)
    m.name = `Surfboard${idx}`
    g.add(m)
  })

  return g
}

export function buildBeach(): Group {
  const g = new Group()
  g.name = "Beach"
  g.add(
    buildSkyDome(
      /**
       * v1.3.84i：地平线改暖金 —— 晴日海景的「霞光带」。
       *
       * 原来三点全是蓝白（0xe8f4fa / 0x7cc4e8 / 0x2f8fd0），海天之间只有
       * 一条同色硬渐变，画面顶部很平。改成「地平线暖白 → 中段浅青 → 天顶
       * 湛蓝」后，可见的 2° 天空里能读出一条暖冷过渡 —— 这正是真实海景
       * 最抓眼的一笔（低空阳光散射偏暖、高空偏冷）。
       */
      0xfdf3dc, // 地平线：暖白（日光散射）
      0x9fd6ea, // 中段浅青
      0x2f8fd0, // 天顶湛蓝
      110,
      /**
       * 下半球色必须 = haze 目标色（0.9098,0.9569,0.9804 ≈ 0xe8f4fa）。
       * 海面 r→60 淡到满值 haze 后与下半球严丝合缝，换成暖金会在海平线
       * 外缘露出一圈色差，所以这里保持冷白不动。
       */
      BEACH_HORIZON_HEX,
      false, // toneMapped=false：跳过 ACES，保住饱和度
      /**
       * stops 从 [0.012, 0.05] 收到 [0.008, 0.034]。
       * aim 顶边只有 +2.07°，可见天空的 z/radius 上限约 0.036 —— 原停靠点
       * 让「暖白→浅青」的过渡只走到一半就被截断，暖色带几乎看不见。
       * 收窄后暖白→浅青→湛蓝三段全部落在可见区间内。
       */
      [0.008, 0.034]
    )
  )
  // 沙丘地形分 2 环：近景密、远景疏
  const bands: TerrainBand[] = [
    {
      innerR: 0.3, outerR: 5, thetaSegs: 224, phiSegs: 18,
      seedA: 211, seedB: 733, seedC: 419,
    },
    {
      innerR: 5, outerR: BEACH_TERRAIN.SHORE, thetaSegs: 224, phiSegs: 22,
      seedA: 211, seedB: 733, seedC: 419,
    },
  ]
  /**
   * v1.3.84j：给两条地形带挂沙地细节贴图。
   *
   * 顶点色已经带有完整的沙丘明暗，这里只是补「沙粒感」这一层高频细节 ——
   * 没有它，近距离的沙面是大片平滑渐变，一眼能看出是程序化平面。
   *
   * 两条环带用的贴图不同（近环是单粒沙、外环是风纹），因此必须**各自
   * 预建一张**（`sand` / `sandFar`），不能在同一个 Texture 上改 repeat ——
   * repeat 是贴图自身的属性，共用会让后设的覆盖先设的；也不能 clone()，
   * 因为 `disposeEnvGroup()` 不 dispose map，clone 之间共享 image，
   * 一旦释放就是连坐。
   *
   * RingGeometry 自带 uv，且整条环带的 uv 只覆盖 [0,1] 方形的四条边 → uv 域
   * 利用率很低，所以贴图必须靠 repeat 铺开：多次平铺后采样点会散布到整张
   * 贴图上，细节密度才够。重复次数按「视觉上沙粒约 2~4cm」估：近环
   * （外径 5m）取 6、外环（外径 20m）取 4，两块屏幕上的纹理尺度才接近。
   */
  const beachBand = (
    kind: "sand" | "sandFar",
    repeat: number
  ): TerrainStyle => {
    const tex = getBeachTexture(kind)
    // repeat 是共享 Texture 的属性，同 kind 只能设一次；两条带用不同 kind
    tex.repeat.set(repeat, repeat)
    return { ...BEACH_STYLE, map: () => tex }
  }
  g.add(buildTerrainBand(bands[0], beachBand("sand", 6)))
  g.add(buildTerrainBand(bands[1], beachBand("sandFar", 4)))
  g.add(buildBeachSea())
  g.add(buildBeachRocks())
  g.add(buildBeachShrubs())
  g.add(buildBeachProps())
  return g
}


// ══════════════════════════════════════════════════════════════════════
//                室内场景（room / office / cybercafe）
// ══════════════════════════════════════════════════════════════════════

/**
 * 室内场景的可见性约束 —— 下面所有取舍都由它决定。
 *
 * 瞄准相机高 0.295、稳态俯角 16.33°，横屏竖直 fov 36.73°，于是画面顶边的
 * 视线斜率只有 +0.035：d 米处的可见高度上限 = 0.295 + 0.035·d。
 *   · 墙在 4~6m 外 → 只看得到墙根 0.44~0.51m
 *   · 1m 高的家具要退到 20m 外才装得进画面，室内根本不可能
 *   · 2.85m 层高、顶棚、吊灯 —— 两种视角下都不入画
 * 俯视相机更极端（z≈5.4~11.7、fov 20°），只看得到桌边一圈 0.26m 的地面。
 *
 * 所以「室内场景」的实际画面构成是 **地面 + 墙根 + 家具下半截**。预算这么分：
 *   1. 地面 —— 占屏面积最大，俯视下几乎是唯一可见的环境
 *   2. 踢脚线 / 墙裙 / 墙根灯带 —— 瞄准视角下墙面唯一入画的一段
 *   3. 家具腿与低矮道具 —— 形成「家具地平线」，顺带遮住空荡的墙根
 * 顶棚永远看不见，但俯视相机在层高之上，不做处理会直接穿过顶棚把房间看穿 ——
 * 所以统一挂进 CeilingGroup，由 view.ts 每帧按相机高度开关。
 */
const ROOM_HX = 6.0 // 房间半宽（X 向墙）
const ROOM_HY = 4.0 // 房间半深（Y 向墙）
/** 层高。必须低于所有俯视机位（最高 z≈11.7），否则相机升到顶棚之上要穿帮 */
export const INDOOR_CEIL_Z = 2.85
/** 地面略低于 GROUND_Z，避免与桌脚/假阴影 z-fighting */
const ROOM_FLOOR_Z = GROUND_Z - 0.004

/**
 * v1.8.9：每个场景「相机净空上界」—— 相机中心允许到达的最高 z。
 *
 * 与 INDOOR_CEIL_Z（顶棚显隐阈值）用途不同：那个是俯视时藏顶棚用的门限，
 * 这个是限制全桌机位 / 回放自由机位**不要穿进天花板**的物理净空。
 *
 * 数值来自模型实测（取天花板板层底面，再留一点余量给相机近裁剪面）：
 *   - room：`pool_scene_room.glb` Ceiling z[2.32,2.42]、Crown 2.16 → 2.32
 *   - tea ：`pool_scene_tea.glb`  Ceiling z[2.30,2.40]、横梁 1.93 → 2.30
 *   - cell/seed：顶部结构在 3.3~5.3，远高于任何机位上限(≤2.45)，不约束 → null
 *   - snow/beach：户外无天花板 → null
 *
 * 未列出的场景一律 null（不约束），保持原行为。相机侧还会再减 CEIL_CLEARANCE。
 */
export const CAMERA_CEILING_Z: Record<string, number | null> = {
  room: 2.32,
  tea: 2.30,
}


/**
 * 道具禁区。瞄准相机绕球公转，最远能到 |x|≈1.408+0.786=2.19、
 * |y|≈0.688+0.786=1.47 —— 留到 2.2/1.75 保证道具永远不会挡在相机与球之间。
 */
const KEEPOUT_X = 2.2
const KEEPOUT_Y = 1.75

interface IndoorLamp {
  pos: number[]
  /**
   * 距离 ≤ near 全亮，≥ far 只剩 floor —— 模拟吊灯的光池衰减。
   *
   * ⚠️ v1.3.85：`far` 必须收在**真实光池尺度**内（2~4m），否则 `att` 在
   * 全房间都接近 1.0，衰减形同虚设 → 整面墙均匀受光 → 平涂色块。
   * v1.3.94：已按本约束改到 3.6~3.8m（此前注释写了要求但数值仍是
   * room 10.5，与实际不符）。
   */
  near: number
  far: number
  floor: number
}

interface IndoorPalette {
  name: string
  AMB: number[]
  SUN: number[]
  GAMMA: number
  lamps: IndoorLamp[]
  /** 地面反弹光：按 max(0,−nz) 补一点，免得家具下沿死黑 */
  bounce: number[]
  /** 大气透视（室内也有）：远处墙角轻微退色，把层次拉开 */
  haze: { color: number[]; start: number; end: number; max: number }
  floor: (out: Color, x: number, y: number, r: number) => void
  wall: (out: Color, s: number, u: number, onX: boolean) => void
  ceil: (out: Color, x: number, y: number) => void
}

/** 0~1 的确定性散列（给每块地板/墙板一个稳定的随机色差） */
function hash2(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/* ══════════════════════════════════════════════════════════════════════
 * v1.3.85：环境遮蔽（AO）—— 室内立体感的真正来源
 *
 * 【为什么需要】
 * 此前 `bakeIndoor` 的光照项只与**法线方向**有关（N·L 和距离衰减）。
 * 同一个盒面的所有顶点法线完全相同 → 算出同一个色值 → 整面一个颜色，
 * 这就是家具像「色块剪纸」的根本原因。
 *
 * 【为什么细分没用（已验证）】
 * 曾给 boxGeo 加 1~4 段面内细分，期望靠「顶点更多」出现渐变 ——
 * 实测逐像素无差异。因为 N·L 只看法线方向，同面法线相同，细分后
 * 每个顶点的光照值依旧相同。顶点数不是瓶颈，**光照模型才是**。
 *
 * 【AO 为什么有效】
 * AO 取决于**顶点位置在世界中的空间关系**（周围有没有别的面挡着），
 * 同面的不同顶点位置不同 → AO 不同 → 面内自然出现明暗渐变。
 * 墙角、家具贴地处、物体相接处会自然变暗，立体感由此产生。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 轻量 AO 采样器：把场景几何灌进一个 XY 空间网格，逐顶点向上半球
 * 打若干条射线，统计被挡比例。
 *
 * 选择「向上半球」而非全球：室内光主要来自上方吊灯与顶棚反射，
 * 顶点上方被遮挡才是视觉上「暗」的主因。这既是物理近似，也能把
 * 采样数压到很低（8 条/顶点），保证构建耗时可控。
/**
 * 室内环境遮蔽（AO）上下文 —— v1.3.85。
 *
 * 【为什么需要 AO】
 * `bakeIndoor` 的光照项只与**法线方向**有关（`N·L` 与到灯的距离衰减）。
 * 同一个盒面的所有顶点法线完全相同 → 算出同一个色值 → 整面一个颜色。
 * 这就是家具像「色块剪纸」、画面像平涂的根本原因。
 *
 * 【为什么「加细分」没用（已实测否定）】
 * 曾给 boxGeo 加 1~4 段面内细分，期望顶点更多就有渐变 —— 实测逐像素
 * 无差异。因为 N·L 只看法线方向，同面法线相同，细分后每个顶点算出的
 * 光照值依旧相同。**瓶颈不是顶点数，是光照模型。**
 *
 * 【AO 为什么能解决】
 * AO 取决于**顶点位置**（离墙多近、上方是否被家具压住），与法线无关。
 * 同一面的不同顶点位置不同 → 遮蔽率不同 → 面内自然出现明暗渐变。
 * 墙角、家具贴地处、物体相接处自然变暗，立体感由此而来。
 *
 * 【实现选择：解析式而非光线投射】
 * 曾写过一个基于空间网格 + Möller–Trumbore 射线求交的采样器（约 170 行），
 * 但它要求「先收集全场景几何、再统一烘焙」，与现有流式构建顺序冲突，
 * 反而引入了脆弱的两遍耦合。改为**解析式**：直接按「顶点与房间六面体
 * 的贴近度」算遮蔽。房间是规整长方体，这个近似与真实 AO 高度吻合，
 * 且零顺序依赖、零额外内存。
 */
interface AoCtx {
  /** 房间半宽（X 方向，到墙面距离） */
  hx: number
  /** 房间半长（Y 方向） */
  hy: number
  /** 地板高度 */
  floorZ: number
  /**
   * 遮蔽影响范围（米）。顶点离墙面/地板在这个距离内开始变暗，
   * 越近越暗 —— 这就是「墙角发暗」的物理来源。
   */
  reach: number
  /** 遮蔽强度 0~1 */
  strength: number
  /** 纵向遮蔽：顶棚对家具上沿的压暗（0 = 关闭） */
  ceilBias: number
}

/**
 * 解析式遮蔽率 0~1（0 = 开阔、1 = 完全贴角）。
 *
 * 三个来源相加后 clamp：
 *   1. 侧向贴墙：min(离四面墙的距离) 越小越暗；
 *   2. 贴地：离地板越近越暗（物体与地面的接触阴影）；
 *   3. 纵向：越靠近顶棚越暗（顶棚对高处家具的压暗）。
 *
 * ⚠️ 与法线无关 —— 这正是它能为「同一个面」产生渐变的原因。
 */
function aoFactor(px: number, py: number, pz: number, nz: number, ao: AoCtx): number {
  // 朝上的面豁免：地板/桌面朝上，上方开阔本就不该被遮蔽。
  // 强行压暗会让地面出现脏斑。
  const expose = 1 - Math.max(0, nz)
  if (expose <= 0) return 0

  // 1. 侧向贴墙
  const dx = ao.hx - Math.abs(px)
  const dy = ao.hy - Math.abs(py)
  const dWall = Math.min(dx, dy)
  const wallO = 1 - smoothstep(0, ao.reach, dWall)

  // 2. 贴地（只对非朝下的面生效，朝下的面由 bounce 项补偿）
  const dFloor = pz - ao.floorZ
  const floorO = 1 - smoothstep(0, ao.reach * 0.7, dFloor)

  // 3. 纵向（靠近顶棚）
  const ceilO = ao.ceilBias > 0 ? smoothstep(1.6, 2.85, pz) * ao.ceilBias : 0

  const o = Math.max(0, Math.min(1, wallO + floorO + ceilO))
  return o * ao.strength * expose
}

/** 各室内场景共用的 AO 参数（reach 按房间尺度 12×8×3 取值） */
const INDOOR_AO: AoCtx = {
  hx: 6,
  hy: 4,
  /**
   * v1.3.97：−0.207 → ROOM_FLOOR_Z(−0.804)。
   * 旧值是 v1.3.95 地坪下沉前的遗物 —— 家具按旧地坪 z≈0 摆时它“碰巧”
   * 让贴地 AO 落在家具中部；本版家具已真正落地（以 ROOM_FLOOR_Z 为基线），
   * AO 的贴地压暗必须跟着对齐，否则家具底部接触阴影错位。
   */
  floorZ: ROOM_FLOOR_Z,
  reach: 1.0,
  strength: 0.55,
  ceilBias: 0.15,
}

/**
 * 给一个几何体烘焙室内光照。
 *
 * 与户外地形的 `bakeVertices` 同一套显示空间模型（out = albedo × 光照），
 * 区别只有两点：
 *   1. 光源是**吊灯点光**而非平行光 —— 平行光打在水平地面上处处一样亮，
 *      室内会平得像一张贴图；点光才能形成「桌边亮、墙根暗」的光池。
 *   2. 多一项地面反弹光，家具下沿不至于死黑。
 *
 * v1.3.85 新增第 3 项：**环境遮蔽（AO）**。这是室内立体感的真正来源 ——
 * 详见 AoCtx 的注释。`ao` 缺省（undefined）时行为与改造前**逐像素
 * 一致**，保证范围外场景不受影响。
 */
function bakeIndoor(
  geo: BufferGeometry,
  pal: IndoorPalette,
  albedo: (out: Color, p: Vector3, i: number) => void,
  post?: (rgb: number[], p: Vector3, i: number) => void,
  ao?: AoCtx
): void {
  geo.computeVertexNormals()
  const pos = geo.attributes.position
  const nrm = geo.attributes.normal
  const n = pos.count
  const colors = new Float32Array(n * 3)
  const tmp = new Color()
  const P = new Vector3()
  const rgb = [0, 0, 0]
  const { AMB, SUN, GAMMA, bounce } = pal
  for (let i = 0; i < n; i++) {
    P.fromBufferAttribute(pos, i)
    albedo(tmp, P, i)
    /**
     * v1.3.85：法线 NaN 兜底（照抄 bakeVertices 的同名处理）。
     *
     * `computeVertexNormals()` 对退化三角形会算出 0 长度法线 → NaN。
     * 此前 `MeshBasicMaterial` 不用法线，NaN 只污染顶点色且被
     * `Math.min(1, Math.max(0, NaN))` 的 NaN 传播掩盖；**换成 PBR 后
     * 法线直接进 `dot(N, L)`，NaN 会让整个三角形黑掉或闪白**。
     * 这里失效时退化为「朝上」（室内墙面/地面出现退化面时是合理近似）。
     */
    let nx = nrm.getX(i)
    let ny = nrm.getY(i)
    let nz = nrm.getZ(i)
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
      nx = 0
      ny = 0
      nz = 1
      nrm.setXYZ(i, nx, ny, nz)
    }
    let lr = AMB[0]
    let lg = AMB[1]
    let lb = AMB[2]
    for (let k = 0; k < pal.lamps.length; k++) {
      const lp = pal.lamps[k]
      const dx = lp.pos[0] - P.x
      const dy = lp.pos[1] - P.y
      const dz = lp.pos[2] - P.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const nd = Math.max(0, (nx * dx + ny * dy + nz * dz) / d)
      const att = lp.floor + (1 - lp.floor) * (1 - smoothstep(lp.near, lp.far, d))
      const ndc = Math.pow(nd, GAMMA) * att
      lr += SUN[0] * ndc
      lg += SUN[1] * ndc
      lb += SUN[2] * ndc
    }
    const up = Math.max(0, -nz)
    lr += bounce[0] * up
    lg += bounce[1] * up
    lb += bounce[2] * up

    /**
     * v1.3.85：环境遮蔽（AO）—— 室内立体感的来源。
     *
     * 此前光照项只与**法线方向**有关（N·L），同一盒面的顶点法线全同 →
     * 整面一个色值 → 家具像色块剪纸。AO 取决于**顶点位置的空间关系**
     * （上方有没有别的面挡着），同面不同位置 → 遮蔽率不同 → 面内出现
     * 渐变。墙角、家具贴地处、物体相接处自然变暗。
     *
     * 只对**非朝上**的面生效：朝上的面（地板/桌面）上方开阔，本就不该
     * 被遮蔽，强行压暗会让地面出现脏斑。`1 - max(0,nz)` 在水平面上为 1、
     * 在朝上的面上为 0，正好实现这个豁免。
     */
    if (ao) {
      const k = 1 - aoFactor(P.x, P.y, P.z, nz, ao)
      lr *= k
      lg *= k
      lb *= k
    }

    rgb[0] = SRGBToDisplay(tmp.r) * lr
    rgb[1] = SRGBToDisplay(tmp.g) * lg
    rgb[2] = SRGBToDisplay(tmp.b) * lb
    if (post) post(rgb, P, i)
    const r = Math.sqrt(P.x * P.x + P.y * P.y)
    const hz = pal.haze.max * smoothstep(pal.haze.start, pal.haze.end, r)
    if (hz > 0) {
      rgb[0] += (pal.haze.color[0] - rgb[0]) * hz
      rgb[1] += (pal.haze.color[1] - rgb[1]) * hz
      rgb[2] += (pal.haze.color[2] - rgb[2]) * hz
    }
    tmp.setRGB(
      Math.min(1, Math.max(0, rgb[0])),
      Math.min(1, Math.max(0, rgb[1])),
      Math.min(1, Math.max(0, rgb[2])),
      SRGBColorSpace
    )
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3))
}

/** 直立盒子：X=宽 Y=长 Z=高，原点在**底面**中心（方便直接按地板高度摆放） */
function boxGeo(w: number, l: number, h: number): BufferGeometry {
  /**
   * v1.3.85：细分尝试已回退。
   *
   * 曾按尺寸给盒子加 1~4 段面内细分，期望靠「顶点更多 → 面内出现光照
   * 渐变」来消除色块感。**实测无效**（room_free_subdiv.png 与
   * room_free_pbr.png 逐像素无差异）。
   *
   * 原因：`bakeIndoor` 的 `nd` 只与**法线方向**有关（`N·L`），而同一个
   * 盒面的所有顶点法线完全相同 —— 细分后每个顶点算出的 `ndc` 仍是同一个
   * 值，面内自然没有渐变。顶点数不是瓶颈，**光照模型才是**。
   * 保留 1 段以免白白增加顶点数。
   */
  const g = new BoxGeometry(w, l, h)
  g.translate(0, 0, h / 2)
  return g
}

/** 立柱/圆台：沿 Z 轴竖立，原点在底面中心 */
function cylGeo(rTop: number, rBot: number, h: number, seg = 10): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBot, h, seg, 1)
  g.rotateX(Math.PI / 2)
  g.translate(0, 0, h / 2)
  return g
}

/**
 * v1.6.0（3D 美化 P3）：圆角盒（软包家具的核心几何）。
 *
 * 为什么必须用圆角而不是平盒子：`boxGeo` 的六个面各自法线恒定，bakeIndoor
 * 的 `N·L` 逐顶点相同 → 一个面就是一整块纯色，视觉上就是"积木"。
 * 圆角盒在棱边处法线连续变化，顶点色随之渐变，直接得到软包沙发那种
 * 「受光面亮、转角暗」的立体转折 —— 这是几何层面的差异，不是贴图能补的。
 *
 * 半径自动夹取到短边的 49%，避免零件过薄时几何自交。
 */
function roundedBoxGeo(
  w: number,
  l: number,
  h: number,
  r: number,
  seg = 3
): BufferGeometry {
  const maxR = Math.min(w, l, h) * 0.49
  const g = new RoundedBoxGeometry(w, l, h, seg, Math.min(r, maxR))
  g.translate(0, 0, h / 2)
  return g
}

/** 横置圆柱：轴向沿局部 X（家具的"卷边/抱枕柱"等） */
function cylGeoX(r: number, len: number, seg = 14): BufferGeometry {
  const g = new CylinderGeometry(r, r, len, seg, 1)
  g.rotateZ(Math.PI / 2)
  return g
}


/**
 * 道具收集器：把一堆小几何体烘好顶点色后合并成**一个** Mesh。
 *
 * 家具场有几十个零件（桌腿 / 椅爪 / 灯杆 / 书本），每个一个 Mesh 就是几十个
 * draw call。合并后只剩一次 draw call，顶点色还完全可控。
 */
class Props {
  private geos: BufferGeometry[] = []
  constructor(
    private pal: IndoorPalette,
    /** v1.3.85：AO 上下文（缺省时不计算遮蔽，行为与改造前一致） */
    private ao?: AoCtx
  ) {}

  add(
    g: BufferGeometry,
    x: number,
    y: number,
    z: number,
    rotZ: number,
    color: number | ((out: Color) => void),
    post?: (rgb: number[], p: Vector3) => void
  ): Props {
    // 禁区安全网：瞄准相机绕球公转的区域（|x|<2.2 且 |y|<1.75 是它的
    // 保守外包矩形）里不许有任何道具。宁可少摆一件，也不能让道具挡在
    // 相机和球之间 —— 丢掉比穿模好排查得多。
    if (Math.abs(x) < KEEPOUT_X && Math.abs(y) < KEEPOUT_Y) {
      g.dispose()
      return this
    }
    if (rotZ) g.rotateZ(rotZ)
    g.translate(x, y, z)
    let fn: (out: Color) => void
    if (typeof color === "function") {
      fn = color
    } else {
      const c = new Color(color)
      fn = (out: Color) => out.copy(c)
    }
    bakeIndoor(
      g,
      this.pal,
      (out, _p, _i) => fn(out),
      post ? (rgb, p, _i) => post(rgb, p) : undefined,
      this.ao
    )
    const ni = g.index ? g.toNonIndexed() : g
    if (ni !== g) g.dispose()
    this.geos.push(ni)
    return this
  }

  mesh(name: string): Mesh {
    const m = new Mesh(mergeColored(this.geos), envMaterial({ roughness: 0.9 }))
    m.name = name
    m.castShadow = false
    m.receiveShadow = false
    return m
  }
}

/**
 * v1.3.96：`emissive()` / `emissiveMix()` 已随 office（屏幕）、cybercafe
 * （灯带 / 机箱侧透 / 霓虹）两个场景一并删除 —— 室内场景里需要自发光的
 * 地方（吊灯发光面、灯罩顶面）直接用 `(out: Color) => out.setRGB(...)`
 * 更直白，不必再走「后处理 rgb 数组」这条路。
 */

/**
 * 地板：一张细分平面 + 顶点色拼花。
 *
 * 不用贴图是有原因的 —— 环境物体统一走 MeshBasicMaterial + vertexColors +
 * toneMapped:false，光照已经烘进顶点色；贴图要在**线性空间**与光照相乘，
 * 和这套显示空间模型对不上（实测同亮度会差 40%）。拼花靠顶点插值出来反而
 * 更抗锯齿：瞄准视角下地面是极端掠射，远处一行像素跨好几块地砖，贴图必然
 * 摩尔纹，顶点插值只是渐变成一片中间色。
 */
function buildIndoorFloor(
  pal: IndoorPalette,
  /**
   * v1.3.84l：可选细节贴图。
   *
   * 与沙滩地形带同一套机制（见 `TerrainStyle.map`）：顶点色已是烘焙好的
   * 最终显示色，贴图只当细节层，**必须接近白**（明度 ≥0.8，见
   * `interiortexturefactory.ts` 的铁律）。
   *
   * 默认 null —— 不传就是原来的行为，其余调用点（含将来的新场景）不受影响。
   *
   * `repeat` 由调用方按平面实际尺寸设置：`PlaneGeometry(12, 8, …)` 的 uv
   * 是线性铺满 [0,1] 的，所以 `repeat = 尺寸 / 期望周期`。注意 `repeat`
   * 是**贴图自身**的属性，不同 repeat 必须各自预建一张，**不得 clone**。
   */
  map?: Texture | null,
  /**
   * v1.3.85：AO 上下文。传入时地板几何会被注册为**遮挡体**（供上方家具
   * 计算遮蔽），同时地板自身也走 AO 烘焙 —— 但地板法线朝上，`expose=0`
   * 会把它豁免掉，所以地板的观感不受影响。
   */
  ao?: AoCtx
): Mesh {
  const geo = new PlaneGeometry(ROOM_HX * 2, ROOM_HY * 2, 150, 100)
  // PlaneGeometry 默认就在 XY 平面、法线 +Z —— Z-up 世界里这正是地板，无需旋转
  geo.translate(0, 0, ROOM_FLOOR_Z)
  // 注册为遮挡体必须在烘焙**之前**（此时 geo 已是最终世界坐标）
  
  bakeIndoor(
    geo,
    pal,
    (out, P) => pal.floor(out, P.x, P.y, Math.sqrt(P.x * P.x + P.y * P.y)),
    undefined,
    ao
  )
  const m = new Mesh(
    geo,
    // v1.3.85：换成受光材质，与墙/顶棚/家具走同一条 PBR 路径。
    // 此前这里是独立的 MeshBasicMaterial —— 若不改，会出现「墙受光、地面
    // 不受光」的割裂：地面亮度与墙面脱节，且在 NoToneMapping 下差异直接
    // 暴露（地面比墙面亮一档）。
    // `map` 是贴图细节层，在 PBR 的 map_fragment 里同样走 sRGB→linear，
    // 与 basic 行为一致，无需特殊处理。
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      toneMapped: false,
      fog: envFogEnabled,
      ...(map ? { map } : {}),
    })
  )
  m.name = "IndoorFloor"
  // v1.3.98：地板不接收实时阴影 —— 掠射角下阴影贴图采样在地板上留波浪状
  // acne（A/B 探针实锤），而参考图的桌影/家具影本就是弥散软影，已直接
  // 烘进 roomFloor 顶点色（blob 系列），实时阴影只剩家具/桌体自身受光。
  m.receiveShadow = false
  return m
}

/**
 * 四面墙 + 踢脚线。
 *
 * 只把竖向 26 段里的一半压在 0.5m 以下（真正入画的地方），更高的部分
 * 在两种相机下都不入画，细分纯属浪费。
 */
function buildIndoorWalls(
  pal: IndoorPalette,
  ao?: AoCtx
): Mesh {
  const H = INDOOR_CEIL_Z - ROOM_FLOOR_Z
  const ax = new Vector3()
  const ay = new Vector3(0, 0, 1)
  const az = new Vector3()
  const specs: { onX: boolean; sign: number; len: number }[] = [
    { onX: true, sign: 1, len: ROOM_HY * 2 },
    { onX: true, sign: -1, len: ROOM_HY * 2 },
    { onX: false, sign: 1, len: ROOM_HX * 2 },
    { onX: false, sign: -1, len: ROOM_HX * 2 },
  ]
  const geos: BufferGeometry[] = []
  for (const w of specs) {
    const g = new PlaneGeometry(w.len, H, Math.round(w.len * 8), 26)
    // 把法线转到朝向房间内侧，同时保证基是右手系（否则背面剔除会翻掉整面墙）
    if (w.onX) {
      ax.set(0, w.sign > 0 ? -1 : 1, 0)
      az.set(w.sign > 0 ? -1 : 1, 0, 0)
    } else {
      ax.set(w.sign > 0 ? 1 : -1, 0, 0)
      az.set(0, w.sign > 0 ? -1 : 1, 0)
    }
    g.applyMatrix4(new Matrix4().makeBasis(ax, ay, az))
    g.translate(
      w.onX ? w.sign * ROOM_HX : 0,
      w.onX ? 0 : w.sign * ROOM_HY,
      ROOM_FLOOR_Z + H / 2
    )
    const ni = g.index ? g.toNonIndexed() : g
    if (ni !== g) g.dispose()
    bakeIndoor(
      ni,
      pal,
      (out, P) => pal.wall(out, P.z - ROOM_FLOOR_Z, w.onX ? P.y : P.x, w.onX),
      undefined,
      ao
    )
    geos.push(ni)
  }
  // v1.3.97：墙改用不受光的 MeshBasicMaterial —— 顶点色（albedo×AMB）就是
  // 最终显示色。PBR 材质下实时方向光/半球光会给不同朝向的墙不同的 N·L，
  // 导致「转身看，四面墙颜色不一样」；Basic 材质 + 无灯烘焙让四面墙在
  // 任意视角、任意机位下严格同色，正符合「统一纯色浅米色」的要求。
  const m = new Mesh(mergeColored(geos), envMaterial())
  m.name = "IndoorWalls"
  return m
}

/** 顶棚。永远不入画，但俯视相机在层高之上，不藏起来会直接把房间看穿 */
function buildIndoorCeiling(pal: IndoorPalette): Group {
  const g = new Group()
  g.name = "CeilingGroup"
  const geo = new PlaneGeometry(ROOM_HX * 2, ROOM_HY * 2, 32, 22)
  geo.rotateX(Math.PI) // 法线 +Z → −Z，朝下
  geo.translate(0, 0, INDOOR_CEIL_Z)
  bakeIndoor(geo, pal, (out, P) => pal.ceil(out, P.x, P.y))
  // v1.3.97：顶棚与墙同理由 Basic 材质呈现（永远不入画，颜色无所谓，但保持一致）
  const m = new Mesh(geo, envMaterial())
  m.name = "Ceiling"
  g.add(m)
  return g
}

/**
 * v1.3.84l：按「期望的世界尺寸周期」取一张已配好 repeat 的地面贴图。
 *
 * 地板平面是 `PlaneGeometry(ROOM_HX*2, ROOM_HY*2)`（12×8m），uv 线性铺满
 * [0,1]，所以 `repeat = 平面尺寸 / 期望周期`。
 *
 * ⚠️ `repeat` 挂在**共享的** Texture 上，同 kind 只能设一次。v1.3.96 之后
 * 室内只剩 room 一种（kind=wood），不存在互相覆盖。
 * 若将来两个场景要共用同一 kind 但不同 repeat，必须**各建一张独立贴图**，
 * 不能用同一张改 repeat，更不能 clone（见 interiortexturefactory 的注释）。
 *
 * @param kind    贴图种类
 * @param period  期望的贴图平铺周期（米/次）
 */
// ═══════════════════ room：居家台球房（v1.3.96 按参考图复刻）═══════════════════
//
// 【参考图特征】
//   ① 墙面：米黄/奶油色涂料，无墙裙、无护墙板，只在墙根一条浅色踢脚线
//   ② 地面：浅色木地板（宽板、直纹、低饱和平铺）
//   ③ 家具：米色布艺简约沙发 + 方腿边几 + 米色灯罩落地灯（左右对称两组）
// ═══════════════════ room：居家台球房（v1.3.97 按用户参考图精确复刻）═══════════════════
//
// 【参考图特征（2026-09-22 定稿图）】
//   ① 墙面：统一纯色浅米色涂料，无踢脚线、无墙裙、无任何装饰与纹理
//   ② 地面：浅暖木地板，保留**柔和**板缝线条，无强烈色差
//   ③ 家具：**只有** 2 米色布艺沙发（贴 ±X 墙）+ 2 小木边几 + 2 锥罩落地灯
//      —— 左右镜像完全对称，全部落在地板上（v1.3.96 曾整体悬空 0.8m，见
//      buildRoom 内的 FLOOR 说明），不摆球杆架/盆栽/格架/扶手椅等任何杂物
//   ④ 光影：柔和漫射环境光，无刺眼光池；阴影边缘柔和（实时 PCF radius）
//
// 【可见性预算不变】瞄准相机高 0.295m / pitch −16.33° → 只有「地面 + 墙根
//   + 家具下半截」入画。所以细节全部压在 0.5m 以下，高处的家具只做剪影。
//
// 【配色基调】用户 2026-09-22 指定：**米黄**；墙面统一纯色，地板浅暖木。

const RM_FLOOR_A = new Color(0xe8c49e) // 浅暖木主色（v1.3.98 像素校色：奶油粉调）
const RM_FLOOR_B = new Color(0xe0b994) // 色差板（仅轻微明度差）
const RM_FLOOR_C = new Color(0xf2d0b0) // 偶发浅板
const RM_SEAM = new Color(0xca9775) // 板缝（柔和暗线，低对比）
const RM_SHADOW = new Color(0x8a623e) // 烘焙软阴影色调（参考图桌影核心 ≈#a1755a）

/**
 * 浅色木地板（v1.3.98 按参考图重做）。
 *
 * 【为什么 v1.3.97 的地板看起来「粗糙/波浪」】两个根因：
 *   ① 板宽 0.34m 与地板顶点网格 0.08m（12m/150 段、8m/100 段）**不对齐** ——
 *      板缝边界落在两个顶点之间，哪个顶点都采不到「正好在缝上」的位置，
 *      插值出来的暗线随行号左右游走，远看就是歪歪扭扭的波浪线；
 *   ② `sin` 高频木纹（波长 0.70m）叠加每板随机相位，在透视压缩下变成
 *      一团斑驳的明暗云。
 * 修复：
 *   · 板宽改 **0.40m = 5×0.08**、板长 1.60m = 20×0.08 —— 板缝**严格落在
 *     顶点行/列上**，插值出的暗线是绝对笔直的软线；
 *   · 删掉 sin 木纹与随机相位，板间只用 hash 低频明度差（参考图的板条
 *     几乎同色，只是极轻的深浅交替）；
 *   · 板缝半宽 0.012→0.06m：与顶点间距同量级，缝线柔和可见且不混叠。
 */
function roomFloor(out: Color, x: number, y: number, r: number): void {
  const PW = 0.40 // 板宽（沿 Y 累进）= 5 × 顶点间距 0.08m
  const PL = 1.60 // 板长（沿 X 累进）= 20 × 0.08m
  const row = Math.floor(y / PW)
  const sx = x + row * PL * 0.5 // 隔行错缝半板长（0.8m 也是 0.08 的整倍数）
  const col = Math.floor(sx / PL)
  const fy = y / PW - row
  const fx = sx / PL - col
  const h = hash2(col, row)

  // 主色 ↔ 色差板（弱差），偶发浅板 —— 参考图的板条几乎均匀，只留极轻差异
  out.copy(RM_FLOOR_A).lerp(RM_FLOOR_B, h * 0.5)
  if (h > 0.86) out.lerp(RM_FLOOR_C, (h - 0.86) / 0.14 * 0.5)

  // 板缝（横向长缝 + 端头错缝）：靠近边界柔和压暗。
  // 半宽 0.06m ≈ 顶点间距 —— 边界顶点全暗、相邻顶点全亮，插值出一条
  // 笔直的软暗线；再窄就会重新混叠出波浪（v1.3.97 实测）。
  const seam = Math.min(Math.min(fx, 1 - fx) * PL, Math.min(fy, 1 - fy) * PW)
  out.lerp(RM_SEAM, (1 - smoothstep(0, 0.06, seam)) * 0.32)

  // 球桌下方一圈自然压暗（实时阴影之外的补底，让球桌有接地感）
  const e = Math.sqrt((x / 3.30) * (x / 3.30) + (y / 2.35) * (y / 2.35))
  if (e < 1) out.lerp(RM_SEAM, (1 - e) * 0.10)

  // ── v1.3.98：烘焙软阴影（替代地板上的实时阴影接收）──
  // 【为什么】实时方向光仰角低（参考图的长影），地板自阴影 acne 沿阴影贴图
  // 纹素网格出波浪状明暗带，normalBias/radius 怎么调都有残留。参考图的
  // 「大软阴影」本来就是无边界的弥散渐变 —— 直接烘进地板顶点色：
  // 无 acne、绝对稳定、边缘任意软。方向与实时灯一致（光从 -Y 上方来 →
  // 影子朝 +Y/镜头方向倒）。
  const blob = (cx: number, cy: number, rx: number, ry: number, a: number): void => {
    const dx = (x - cx) / rx
    const dy = (y - cy) / ry
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < 1) out.lerp(RM_SHADOW, a * (1 - smoothstep(0.35, 1.0, d)))
  }
  blob(0, 0.9, 4.3, 3.5, 0.46) // 球桌主影（朝镜头倒，参考图阴影铺得很开）
  blob(-5.5, -0.7, 1.5, 1.0, 0.22) // 左沙发影
  blob(5.5, -0.7, 1.5, 1.0, 0.22) // 右沙发影
  blob(-4.4, -2.7, 0.7, 0.6, 0.18) // 左边几影
  blob(4.4, -2.7, 0.7, 0.6, 0.18) // 右边几影
  blob(-5.38, -3.0, 0.5, 0.45, 0.15) // 左落地灯影
  blob(5.38, -3.0, 0.5, 0.45, 0.15) // 右落地灯影

  // 掠射抗摩尔：远处拼花淡出成一片中间色
  out.lerp(RM_FLOOR_B, smoothstep(4.5, 9.0, r) * 0.6)
}

/**
 * 统一纯色浅米色墙（v1.3.97）。
 *
 * 【为什么是完全平涂】参考图的墙没有任何装饰：无踢脚线、无斑驳、无墙根
 * 渐变 —— v1.3.96 的「低频斑驳 + 墙根压暗 + 踢脚线」全部按用户要求移除。
 * 墙的照明 = 纯 AMB（法线水平 → 灯项/反弹项全为 0），所以最终显示色
 * = RM_WALL × AMB，两面墙、四个方位完全一致，「整体亮度均匀」。
 */
const RM_WALL = new Color(0xf5d8a4) // 统一浅米色（v1.3.98 加暖，显示 ≈#eed1a0 对齐参考图）

/**
 * 统一纯色浅米色墙（v1.3.97 平涂版）。
 *
 * `s` = 归一化高度（0 在脚、1 在顶），`u` = 沿墙归一化横向坐标。
 * 两参数都被刻意忽略 —— 「无装饰」就是不随位置变化。
 */
function roomWall(out: Color, _s: number, _u: number): void {
  out.copy(RM_WALL)
}

const ROOM_PAL: IndoorPalette = {
  name: "Room",
  /**
   * v1.3.97：按参考图做「柔和漫射、亮度均匀」标定。
   *
   * 【墙面】法线水平 → N·L=0、−nz=0 → 灯/反弹贡献全为 0，墙色 = 纯 AMB ×
   * 反照率。取 AMB≈1.0，让显示色 ≈ albedo 本身（#f2dfba 浅米色）。
   *
   * 【地板】朝上的面额外吃灯项：中心光近桌处 ≈ +0.12 → 显示 ≈0.97（参考图
   * 桌旁地板的亮度），远处回落到 AMB 基线，整体均匀无强光池。
   *
   * 【SUN 压低】0.34→0.20：「没有刺眼强光、没有高光溢色」，光池只做
   * 轻微的暖色起伏，不做戏剧化明暗。
   */
  AMB: [1.0, 0.982, 0.948],
  SUN: [0.20, 0.19, 0.168],
  GAMMA: 1.1,
  /**
   * 三处烘焙光源（均与场景里的家具体):
   *   · 中央顶光（原吊灯位置的柔光，无实体灯具）—— 把房间照均匀；
   *   · 两盏落地灯灯罩内（±5.38,−3.42,高 1.24）—— 罩下地面一圈暖色微光池。
   * `floor` 是灯项保底权重：三盏都给 0.30+，保证远角也有贡献（均匀）。
   */
  lamps: [
    { pos: [0, 0, 2.30], near: 1.6, far: 4.4, floor: 0.14 },
    { pos: [-5.38, -3.42, 1.24], near: 0.7, far: 3.4, floor: 0.26 },
    { pos: [5.38, -3.42, 1.24], near: 0.7, far: 3.4, floor: 0.26 },
  ],
  /** 地面反弹：米黄地板把暖光轻微弹回家具下沿 */
  bounce: [0.105, 0.095, 0.075],
  /** 大气透视收到极轻（参考图远墙依然明亮），只做一点点暖色统一 */
  haze: { color: [0.94, 0.84, 0.66], start: 4.5, end: 11.0, max: 0.10 },
  floor: roomFloor,
  wall: roomWall,
  ceil: (out) => out.setHex(0xf0e4c6),
}

/**
 * 墙 / 顶棚专用的「无灯」调色板（v1.3.97）。
 *
 * 【为什么墙不能共用 ROOM_PAL】烘焙灯项 = SUN × max(0,N·L)^γ × 距离衰减。
 * 中央灯到墙面各点的 N·L 与衰减随位置变化 → 墙面出现「中心暖亮、两角冷暗」
 * 的径向色温差（实测中心 #f4e3b7、墙角 #e2e2c7）—— 与「统一纯色、亮度
 * 均匀」直接冲突。墙/顶棚改用 lamps:[] 的派生调色板烘焙后，墙色 =
 * 纯 albedo × AMB，**每一面墙、每一个顶点严格同色**；地板仍用 ROOM_PAL
 * 保留落地灯的柔和光池。AMB 略提到 1.05 补回灯项被移除的亮度差。
 */
const ROOM_PAL_FLAT: IndoorPalette = {
  ...ROOM_PAL,
  // 按 Basic 直出反解 + v1.3.98 像素校色：目标显示 #f7d6a7（参考图墙采样）
  AMB: [1.0, 0.96, 0.99],
  lamps: [],
}

/**
 * 布艺沙发（v1.3.98 按参考图重做：**带木腿的抬升式扶手椅**）。
 *
 * v1.3.97 版是「无腿落地座箱 + 一摞盒子」，实机看起来粗糙。参考图的沙发
 * 结构清晰可读：
 *   ① 4 条深棕色方木腿（沙发抬离地面 ~0.13m，腿下有接触阴影）；
 *   ② 落在腿上的座箱（布艺深色包边）；
 *   ③ 通长厚坐垫（奶白，顶面略高于扶手之间的座面）；
 *   ④ 整片靠背（与坐垫同色，顶缘 ~0.73m）；
 *   ⑤ 两侧方扶手（深一档，顶面高于坐垫）。
 *
 * 【v1.3.97 修复旋转偏移】旧版把「沿长度 / 沿深度」的偏移直接加在世界
 * 坐标上（`y - 0.04`、`y + 0.25`），rot=0 时碰巧正确；一旦 rot=±π/2
 * （本版沙发贴 ±X 墙必须横转），偏移方向就错了。现在先在**局部坐标系**
 * （du 沿长度、dv 沿深度）取偏移，再旋转到世界 —— 任意朝向都正确。
 *
 * @param rot 绕 Z 旋转；0 = 长边沿 X、靠背朝 +Y
 */
const RM_SOFA_LEG = 0x6f4f30 // 深棕木腿（参考图沙发脚）
function addSofa(
  p: Props,
  x: number,
  y: number,
  rot: number,
  len: number,
  clothHex: number,
  clothDk: number
): void {
  const F = ROOM_FLOOR_Z
  const HL = len / 2
  // 局部（du 沿长度、dv 沿深度，− = 朝前）→ 世界坐标
  const at = (du: number, dv: number): [number, number] => [
    x + Math.cos(rot) * du - Math.sin(rot) * dv,
    y + Math.sin(rot) * du + Math.cos(rot) * dv,
  ]
  let ax: number, ay: number
  // ① 四条圆木腿（略外撇，真实沙发的"削角腿"观感来自圆角）
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ;[ax, ay] = at(sx * (HL - 0.16), sy * 0.26)
      p.add(cylGeo(0.028, 0.034, 0.15, 10), ax, ay, F, rot, RM_SOFA_LEG)
    }
  }
  // ② 座箱（圆角软包基座，F+0.15 → 0.37）
  ;[ax, ay] = at(0, 0)
  p.add(roundedBoxGeo(len, 0.80, 0.22, 0.05), ax, ay, F + 0.15, rot, clothDk)
  // ③ 两段独立坐垫（中间留 3cm 分缝 —— 这是"布艺沙发"最直观的识别特征）
  for (const sx of [-1, 1]) {
    ;[ax, ay] = at(sx * (len / 4), -0.07)
    p.add(
      roundedBoxGeo(len / 2 - 0.035, 0.64, 0.175, 0.055, 4),
      ax,
      ay,
      F + 0.37,
      rot,
      clothHex
    )
  }
  // ④ 靠背（圆角软包，F+0.15 → 0.78）+ 顶部卷边圆柱
  ;[ax, ay] = at(0, 0.30)
  p.add(roundedBoxGeo(len, 0.24, 0.63, 0.06, 4), ax, ay, F + 0.15, rot, clothHex)
  ;[ax, ay] = at(0, 0.31)
  p.add(cylGeoX(0.118, len, 16), ax, ay, F + 0.78 - 0.115, rot, clothHex)
  // ⑤ 两侧扶手：圆角体 + 顶部圆卷（真实沙发扶手的圆柱收口）
  for (const sx of [-1, 1]) {
    ;[ax, ay] = at(sx * (HL - 0.115), 0)
    p.add(roundedBoxGeo(0.23, 0.86, 0.56, 0.055, 4), ax, ay, F + 0.15, rot, clothDk)
    p.add(cylGeoX(0.115, 0.86, 16), ax, ay, F + 0.71 - 0.05, rot, clothDk)
  }
  // ⑥ 两只斜靠的抱枕（生活感；用大圆角薄盒 + 侧倾）
  const PILLOW = 0xf3e6c8
  for (const sx of [-1, 1]) {
    ;[ax, ay] = at(sx * (len / 4 + 0.02), 0.16)
    p.add(roundedBoxGeo(0.36, 0.34, 0.13, 0.062, 4), ax, ay, F + 0.53, rot + sx * 0.22, PILLOW)
  }
}

/**
 * 落地灯（参考图定稿：奶白锥形灯罩 + 细浅色灯杆 + 圆盘底座）。
 *
 * 全部 z 以 ROOM_FLOOR_Z 为基线 —— 底盘贴地（v1.3.97 落地修复）。
 * 灯罩 1.10~1.38m，瞄准视角只见灯杆下段，俯视/平视见灯罩。
 */
function addFloorLamp(
  p: Props,
  x: number,
  y: number,
  shadeHex: number,
  metalHex: number
): void {
  const F = ROOM_FLOOR_Z
  const GLOW = 0xfff8e8
  // 底盘：两级圆盘（大底盘 + 上收的过渡环），比单圆盘更像真灯座
  p.add(cylGeo(0.20, 0.215, 0.022, 20), x, y, F + 0.006, 0, metalHex)
  p.add(cylGeo(0.12, 0.16, 0.03, 20), x, y, F + 0.027, 0, metalHex)
  // 灯杆：下粗上细的锥形杆 + 中部装饰环
  p.add(cylGeo(0.013, 0.019, 1.06, 10), x, y, F + 0.056, 0, metalHex)
  p.add(cylGeo(0.026, 0.026, 0.025, 12), x, y, F + 0.52, 0, metalHex)
  // 灯罩：外锥（下阔）+ 上端收口环 —— 真实灯罩是"上窄下阔的锥台"
  p.add(cylGeo(0.115, 0.19, 0.30, 22), x, y, F + 1.116, 0, shadeHex)
  p.add(cylGeo(0.115, 0.115, 0.014, 22), x, y, F + 1.416, 0, shadeHex)
  // 罩口内胆发光面（朝下的圆盘）—— 灯光出处，与室内吊灯同语言
  p.add(
    cylGeo(0.182, 0.182, 0.008, 22),
    x,
    y,
    F + 1.112,
    0,
    (out: Color) => out.setHex(GLOW)
  )
}

/** 方腿小木边几（参考图定稿：四条方腿 + 一块薄木台面），z 以地坪为基线 */
function addSideTable(
  p: Props,
  x: number,
  y: number,
  topHex: number,
  legHex: number,
  s = 1
): void {
  const F = ROOM_FLOOR_Z
  const HW = 0.30 * s
  // 四条锥形圆木腿（上粗下细）
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      p.add(
        cylGeo(0.019, 0.026, 0.42, 10),
        x + sx * (HW - 0.035),
        y + sy * (HW - 0.035),
        F,
        0,
        legHex
      )
    }
  }
  // 台面：圆角木板 + 一圈收边（下沿比台面略窄 → 有厚度感）
  p.add(roundedBoxGeo(HW * 2, HW * 2, 0.045, 0.018, 3), x, y, F + 0.435, 0, topHex)
  p.add(roundedBoxGeo(HW * 1.86, HW * 1.86, 0.03, 0.012, 3), x, y, F + 0.408, 0, topHex)
}

/**
 * v1.6.0（3D 美化 P3）：台球桌正上方**三头吊灯**（台球厅的灵魂灯具）。
 *
 * ## 为什么必须补这盏灯
 *
 * 此前「中央顶光」只是 ROOM_PAL.lamps 里一条**烘焙用的假光源**
 * （pos [0,0,2.30]，无实体灯具）—— 画面里桌上空无一物，房间像
 * 「家具摆在没有灯的空盒子里」。真实台球厅视觉的第一识别元素就是
 * 悬在球桌正上方的长条吊灯。
 *
 * ## 挂在哪
 *
 * 必须挂进 `CeilingGroup`：俯视相机升到层高（2.85）之上时该组整体
 * 隐藏，吊灯随之消失，**不会挡住俯视看球桌的视线**（这是硬约束）。
 *
 * ## 材质
 *
 * 与房间其它道具一致：烘焙顶点色 + MeshBasicMaterial（不受光、
 * toneMapped:false）。灯罩内胆用近白色表达「灯亮着」，黄铜杆用低亮度
 * 铜色。真正的照明与阴影由 view.ts 的 SpotLight 承担（见 indoorTable）。
 */
function buildBilliardLamp(pal: IndoorPalette): Mesh {
  const geos: BufferGeometry[] = []
  const push = (
    g: BufferGeometry,
    color: number | ((out: Color) => void)
  ): void => {
    bakeIndoor(g, pal, (out) => {
      if (typeof color === "function") color(out)
      else out.setHex(color)
    })
    const ni = g.index ? g.toNonIndexed() : g
    if (ni !== g) g.dispose()
    geos.push(ni)
  }

  const BRASS = 0x8a6a3c
  const BRASS_D = 0x6d5330
  const SHADE_OUT = 0xe8dcc2 // 奶白灯罩外壁（受房间光，亮度中等）

  // ① 吸顶盘（贴天花板 z=2.85）
  const canopy = new CylinderGeometry(0.085, 0.1, 0.05, 16)
  canopy.translate(0, 0, 2.82)
  push(canopy, BRASS_D)

  // ② 中吊杆：吸顶盘 → 横杆（z 2.80 → 2.44）
  const rod = new CylinderGeometry(0.011, 0.011, 0.36, 8)
  rod.translate(0, 0, 2.62)
  push(rod, BRASS_D)

  // ③ 黄铜横杆（沿 X，跨度 1.34m —— 覆盖 2.54m 球桌的长度方向中部）
  const bar = new BoxGeometry(1.34, 0.042, 0.042)
  bar.translate(0, 0, 2.44)
  push(bar, BRASS)

  // ④ 三头灯罩 + 悬杆
  const headX = [-0.6, 0, 0.6]
  for (const x of headX) {
    const stem = new CylinderGeometry(0.009, 0.009, 0.1, 8)
    stem.translate(x, 0, 2.39)
    push(stem, BRASS_D)

    // 灯罩：上窄下宽的开口锥（真实台球灯罩形制），罩口朝下
    const shade = new CylinderGeometry(0.075, 0.175, 0.17, 20, 1, true)
    shade.translate(x, 0, 2.25)
    push(shade, SHADE_OUT)

    // 罩口内胆：一片朝下的发光圆盘，代表灯泡光
    const glow = new CircleGeometry(0.16, 20)
    glow.rotateX(Math.PI) // 法线朝下
    glow.translate(x, 0, 2.168)
    push(glow, (out) => out.setRGB(1, 0.965, 0.88))

    // 罩顶封盖（避免从上方看进罩内是空心）
    const cap = new CircleGeometry(0.078, 16)
    cap.translate(x, 0, 2.335)
    push(cap, SHADE_OUT)
  }

  const m = new Mesh(mergeColored(geos), envMaterial())
  m.name = "billiardLamp"
  m.castShadow = false
  m.receiveShadow = false
  return m
}

function buildRoom(): Group {
  const g = new Group()
  g.name = "Room"
  // 浅色木地板：贴图周期 0.60m（比板宽 0.34m 大，细木纹落在板面内部）
  // 地板 AO 无效（法线朝上被豁免），但仍传 ao 以便将来若改用遮挡体列表；
  // 墙**不传 AO** —— 墙是房间外壳，每个墙顶点都在 dWall=0（最贴墙处），
  // 传 AO 会把整面墙按最大遮蔽压暗，与「亮度均匀的纯色米黄墙」相悖。
  g.add(buildIndoorFloor(ROOM_PAL, null, INDOOR_AO))
  g.add(buildIndoorWalls(ROOM_PAL_FLAT))
  const ceiling = buildIndoorCeiling(ROOM_PAL_FLAT)
  // v1.6.0：三头台球吊灯挂进顶棚组 —— 俯视时随顶棚一起隐藏，不挡视线
  ceiling.add(buildBilliardLamp(ROOM_PAL))
  g.add(ceiling)
  const p = new Props(ROOM_PAL, INDOOR_AO)

  /**
   * 【v1.3.97 关键修复：家具落地】
   *
   * v1.3.95 把地坪从 z=−0.203 下沉到 GROUND_Z=−0.80（真实桌高 0.80m），
   * 但道具构件的 z 仍按**旧地坪（z≈0）**摆放 —— 全部家具悬空 0.80m，
   * 连 AO 上下文的 floorZ 都停在旧值。这就是用户指出「家具、灯具浮空」
   * 的根因。本版所有道具统一以 ROOM_FLOOR_Z 为基线摆放（add* 函数内部
   * 已改为 `ROOM_FLOOR_Z + 高度`），并同步修正 INDOOR_AO.floorZ。
   */

  /**
   * 【布局：左右完全镜像对称（参考图定稿）】
   *
   *   ±X 墙：米色沙发（背靠墙、面向球桌），中心 y=−1.30、长 2.30m
   *   −Y 墙两角：落地灯（±5.38, −3.42）；边几在其内侧（±4.40, −3.18）
   *
   * 只有这 6 件家具 —— 不摆球杆架、盆栽、格架、扶手椅、抱枕、几上小物
   * 等任何杂物。坐标写死（无随机），「房间物体相对位置固定不变」。
   * 全部在道具禁区（|x|<2.2 且 |y|<1.75）之外，永远不会挡瞄准相机。
   */
  const SOFA_CLOTH = 0xe9d6b0 // 米色布艺（v1.3.98 校色：压绿对齐参考图奶油色）
  const SOFA_DK = 0xd6c098 // 同色系暗部（座箱/扶手）
  addSofa(p, -5.50, -1.30, Math.PI / 2, 2.30, SOFA_CLOTH, SOFA_DK)
  addSofa(p, 5.50, -1.30, -Math.PI / 2, 2.30, SOFA_CLOTH, SOFA_DK)

  const TABLE_TOP = 0x9c6f47 // 边几台面（暖棕木）
  const TABLE_LEG = 0x7a5535 // 边几腿（深棕）
  addSideTable(p, -4.40, -3.18, TABLE_TOP, TABLE_LEG, 0.9)
  addSideTable(p, 4.40, -3.18, TABLE_TOP, TABLE_LEG, 0.9)

  const LAMP_SHADE = 0xfaf4e2 // 奶白灯罩（v1.3.98 提亮，参考图灯罩很亮）
  const LAMP_POLE = 0xe6e0d2 // 浅色灯杆（参考图灯杆是浅色而非黑）
  addFloorLamp(p, -5.38, -3.42, LAMP_SHADE, LAMP_POLE)
  addFloorLamp(p, 5.38, -3.42, LAMP_SHADE, LAMP_POLE)

  /**
   * v1.6.0（P3）：踢脚线 + 墙面挂画。
   *
   * 此前墙面是一整片素色，除家具外没有任何建筑细节 —— 这是"空盒子"感
   * 的另一半来源。踢脚线（沿墙脚一圈 9cm 木条）与两幅挂画把墙从
   * 「一块色板」变回「一面墙」。
   */
  const SKIRT = 0xcdb68f // 踢脚线（比墙略深，与地板同色系）
  const FRAME = 0x6b4a2a // 画框（深木）
  const CANVAS = [0xaccbe0, 0xc3d2a8] // 两幅画芯（雾蓝 / 浅苔绿，明快不抢戏）
  const inset = 0.055
  const skirtH = 0.09
  // 四面墙各一条踢脚线（贴墙、只比墙厚一点点）
  p.add(boxGeo(ROOM_HX * 2 - inset * 2, 0.02, skirtH), 0, ROOM_HY - inset, ROOM_FLOOR_Z + 0.001, 0, SKIRT)
  p.add(boxGeo(ROOM_HX * 2 - inset * 2, 0.02, skirtH), 0, -ROOM_HY + inset, ROOM_FLOOR_Z + 0.001, 0, SKIRT)
  p.add(boxGeo(0.02, ROOM_HY * 2 - inset * 2, skirtH), ROOM_HX - inset, 0, ROOM_FLOOR_Z + 0.001, 0, SKIRT)
  p.add(boxGeo(0.02, ROOM_HY * 2 - inset * 2, skirtH), -ROOM_HX + inset, 0, ROOM_FLOOR_Z + 0.001, 0, SKIRT)
  // 两幅挂画（±X 墙上、沙发上方）
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1
    const wx = sx * (ROOM_HX - 0.06)
    // 画框 0.07 厚，内表面在 wx − sx·0.035；画芯必须再往前 0.005 才不会
    // 被画框盒吞掉（首次实机就踩了：画芯整体埋在框里，墙上只有一块深色板）
    p.add(boxGeo(0.07, 1.05, 0.72), wx, -1.30, ROOM_FLOOR_Z + 1.62, 0, FRAME)
    p.add(boxGeo(0.02, 0.92, 0.60), wx - sx * 0.042, -1.30, ROOM_FLOOR_Z + 1.68, 0, CANVAS[i])
  }

  g.add(p.mesh("RoomProps"))

  return g
}

/**
 * 室内场景的唯一入口。
 *
 * v1.3.96：`office`（办公室）与 `cybercafe`（网吧）两个场景已下线，室内只剩
 * `room` 一种。保留 switch 结构是为了将来再加室内场景时改动最小。
 */
export function buildIndoorScene(sceneId: string): Group | null {
  let g: Group | null
  switch (sceneId) {
    case "room":
      // v1.7.0：优先用外部资源包的米制房间（泳池房：地板/墙/窗景/家具/
      // 吊灯全套），异步到达后挂进这个空组；加载失败才回退程序化房间。
      // 为什么要空组：buildIndoorScene 是同步接口，而 GLB 必须异步加载。
      // 资源到达前画面里只有球桌（几十毫秒），可接受。
      g = new Group()
      g.name = "Room"
      // v1.8.8：优先载资源包新版「现代台球厅」（pool_scene_room.glb，
      // 写实 PBR 家具 + 玻璃吊灯 + 自绘装饰画）。它自带 16 球与球杆，
      // loadPoolEnvironment 会按 Ball_XX / Cue_Placed 规则剔除，只留环境。
      // 失败退回旧 pool_room.glb，再失败才用程序化房间。
      const attach = (env: Group) => {
        g!.add(env)
        // 复用统一的阴影参与规则（地面/顶棚/墙只接收不投影）
        applyIndoorShadows(g!)
      }
      loadPoolEnvironment("room")
        .then(attach)
        .catch((e) => {
          console.warn(
            "[room] 新版现代台球厅加载失败，回退旧房间:",
            (e as Error)?.message
          )
          loadPoolRoom()
            .then(attach)
            .catch((e2) => {
              console.warn(
                "[room] 旧资源包房间加载失败，回退程序化房间:",
                (e2 as Error)?.message
              )
              g!.add(buildRoom())
            })
        })
      return g
    default:
      return null
  }
}

/**
 * v1.3.86：给室内环境的所有构件开启阴影参与。
 *
 * ## 为什么必须开
 *
 * 此前室内环境每个 Mesh 都是 `castShadow = false` + `receiveShadow = false`。
 * 后果是**球桌不会在地面留下阴影**、家具不会在地面留下阴影、地面也不接收
 * 任何阴影 —— 画面因此缺失最重要的空间纵深线索：**接地感**。桌子看起来是
 * 「飘」在地面上的，所有物件都像贴片。这是用户反馈「还是以前版本糟糕的
 * 情况」「像 2d 场景」的关键成因之一（另一条是光照 90% 由环境光主导）。
 *
 * ## 为什么要在这里统一设置，而不是逐个 Mesh 改
 *
 * 室内场景由 `buildRoom` 拼装，内部另有 `IndoorBuilder.mesh()`、
 * `buildIndoorFloor/Walls/Ceiling` 等多个出口。逐个改要动 5~6 处，且
 * **将来新增室内场景极易漏**。这里在唯一出口
 * 上递归一次，覆盖全部既有与未来构件。
 *
 * ## 例外：地面与天花板只「接收」不「投影」
 *
 * - **地面**（`IndoorFloor`）：不投影。地面法线朝上、自身就在最底部，
 *   投影只会给自己投出无意义的自阴影（shadow acne 的主要来源）。
 * - **天花板**（`Ceiling`）：不投影。它在所有物体上方，向下投影会把整个
 *   房间罩在阴影里（方向光从上方来，天花板正好挡住），画面会直接变黑。
 *
 * 这两类都**接收**阴影（天花板接收不到实际光源方向的投影，但显式打开
 * 不影响正确性，且保持语义一致）。
 */
function applyIndoorShadows(g: Group) {
  g.traverse((o) => {
    const m = o as Mesh
    if (!(m as unknown as { isMesh?: boolean }).isMesh) return
    const n = m.name || ""
    const isFloor = n === "IndoorFloor"
    const isCeiling = n === "Ceiling"
    const isWall = n === "IndoorWalls"
    /**
     * v1.3.96：墙**不接收**阴影。
     * 球桌/家具会把方向光挡在背墙上，投出一条参考图里没有的暗带，
     * 让米黄墙出现不自然的竖向明暗。墙的立体感交给烘焙光照（AMB+灯池）
     * 就够了，接地感由「地面接收阴影」单独负责。
     *
     * v1.3.98：地面也**不接收**实时阴影 —— 低仰角方向光下地板的阴影采样
     * 沿阴影贴图纹素网格出波浪状 acne（normalBias/radius 调不掉，A/B 探针
     * 实锤）。参考图的桌影/家具影本就是弥散软影，已改为在 roomFloor 顶点色
     * 里直接烘焙（blob 系列，方向与实时灯一致），实时阴影只负责家具/桌体
     * 自身的明暗。
     */
    m.receiveShadow = !(isWall || isCeiling || isFloor)
    m.castShadow = !(isFloor || isCeiling)
  })
}

