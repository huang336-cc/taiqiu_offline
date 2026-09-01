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
  MeshLambertMaterial,
  PlaneGeometry,
  BoxGeometry,
  RingGeometry,
  CircleGeometry,
  ConeGeometry,
  SphereGeometry,
  TorusGeometry,
  LOD,
  BackSide,
  BufferAttribute,
  Color,
  SRGBColorSpace,
} from "three"
import { makeValueNoise2D, fbm2D, makeSeededRng } from "../utils/noise"

/** 台球桌底部世界 y 坐标（实测自 table AABB）—— 仅用于足球/篮球场景 */
const BASE_GROUND_Y = -0.93
/**
 * v1.3.60：地面 / 线高改为可变。
 *
 * 足球场与篮球场原本按「真实米制」搭建（场地 40×25、看台距场心 20、层高 6）。
 * 但球桌只有 1.22×0.6，俯视 fov 20° 时视野半径仅约 0.78 —— 40 米的球场在画面
 * 里只剩脚下一小块草地，看台远在 20 米开外根本不入画，于是用户看到的就是
 * 「3D 做了但视野极差」。
 *
 * 现在这两个场景整体缩到几米量级（见各 build 函数的 FIELD_SCALE）：
 * 缩放前先把 Y 基准按 1/k 抬高，使 group.scale 之后地面仍精确落回 BASE_GROUND_Y。
 */
let GROUND_Y = BASE_GROUND_Y
/** 球场线略高于地面，避免 z-fighting */
let LINE_Y = BASE_GROUND_Y + 0.01

/** 进入「按 k 缩小的球场」构建模式：抬高内部 Y 基准以抵消后续 group.scale */
function beginFieldScale(k: number) {
  GROUND_Y = BASE_GROUND_Y / k
  LINE_Y = GROUND_Y + 0.01 / k
}
/** 退出缩放构建模式，恢复真实世界 Y 基准 */
function endFieldScale() {
  GROUND_Y = BASE_GROUND_Y
  LINE_Y = BASE_GROUND_Y + 0.01
}

/**
 * 台球桌底沿真实世界 z 坐标（Z-up 世界），用于雪山场景：
 * 桌面下沿在 z = -0.203；雪地平面必须贴在这里，避免穿插桌面。
 *
 * 同时导出给 assets.ts —— 立方体房间（没有几何 3D 环境的场景）的地板
 * 也必须落在这个高度，否则地板会悬在球桌上方 1.2m 处，把俯视镜头
 * 的球桌整个盖住（v1.3.62 修复）。
 */
export const GROUND_Z = -0.203

// 通用（足球/篮球/线条）材质：保持原 unlit 观感，未改动
const WHITE = new MeshBasicMaterial({ color: 0xffffff })
const ORANGE = new MeshBasicMaterial({ color: 0xff6a1a })
const GRASS = new MeshBasicMaterial({ color: 0x2f7d32 })
/** 篮球场木地板（偏亮木色，让球桌的绿色在木地板上更跳） */
const WOOD = new MeshBasicMaterial({ color: 0xd3a865 })

/**
 * v1.1.6 雪山材质改为按调用 new（写在 buildSnowMountain 内），
 * 不再使用模块级单例——避免 assets.ts 切场景时的 dispose bug。
 * 旧的 SNOW/ROCK/ROCK_FAR/SNOW_FAR/ICE 模块单例已删除。
 */

/** 雪山天空穹顶半径（必须小于 view.ts 为雪景放大的相机 far） */
/** v1.3.62：天穹半径须大于地形外缘（120），否则地形会穿出天穹 */
export const SNOW_SKY_RADIUS = 145

/** 水平面贴一块白色矩形（球场线） */
function addLine(g: Group, w: number, h: number, x: number, z: number): void {
  const m = new Mesh(new PlaneGeometry(w, h), WHITE)
  m.rotation.x = -Math.PI / 2
  m.position.set(x, LINE_Y, z)
  g.add(m)
}

/** 水平面贴一个白色圆环 */
function addRing(
  g: Group,
  rIn: number,
  rOut: number,
  x: number,
  z: number,
  thetaStart = 0,
  thetaLength = Math.PI * 2
): void {
  const m = new Mesh(
    new RingGeometry(rIn, rOut, 48, 1, thetaStart, thetaLength),
    WHITE
  )
  m.rotation.x = -Math.PI / 2
  m.position.set(x, LINE_Y, z)
  g.add(m)
}

/** 水平面贴一个白色实心圆 */
function addDot(g: Group, r: number, x: number, z: number): void {
  const m = new Mesh(new CircleGeometry(r, 16), WHITE)
  m.rotation.x = -Math.PI / 2
  m.position.set(x, LINE_Y + 0.005, z)
  g.add(m)
}

/**
 * 堆一个多层看台（体育场/体育馆环绕用）。
 * @param cx,cz  看台中心坐标
 * @param len    看台沿该边的长度
 * @param depth  看台向场地外的深度
 * @param tiers  层数
 * @param h      最高层高度
 * @param color  颜色
 * @param axis   "x" 沿 x 轴方向延伸；"z" 沿 z 轴方向延伸
 */
function addStand(
  g: Group,
  cx: number,
  cz: number,
  len: number,
  depth: number,
  tiers: number,
  h: number,
  color: number,
  axis: "x" | "z"
): void {
  const mat = new MeshBasicMaterial({ color })
  for (let i = 0; i < tiers; i++) {
    const w = axis === "x" ? len - i * 0.4 : depth - i * 0.4
    const d = axis === "z" ? len - i * 0.4 : depth - i * 0.4
    const t = 0.5
    const wSize = axis === "x" ? w : d
    const dSize = axis === "x" ? d : w
    const seg = new Mesh(new BoxGeometry(wSize, t, dSize), mat)
    // 每层向外（远离场地中心）平移并向上堆叠
    const dir = axis === "x" ? Math.sign(cx) || 1 : Math.sign(cz) || 1
    const off = (axis === "x" ? cx : cz) + dir * (i * 0.4 + dSize / 2 - d / 2)
    if (axis === "x") {
      seg.position.set(off, GROUND_Y + i * (h / tiers) + t / 2, cz)
    } else {
      seg.position.set(cx, GROUND_Y + i * (h / tiers) + t / 2, off)
    }
    g.add(seg)
  }
}

/**
 * 足球场（v1.3.60 视野改造）。
 *
 * v1.3.60：原版的场地 40×25 + 远处 5 层 6 m 看台，导致俯视下白球只有几个像素，
 * 看不清球路。现改为紧凑布局：场地 22×14、4 座 3 层 2.5 m 看台紧贴场地外缘，
 * 球桌周围的视觉留白基本清空，白球在任何视角（俯视 / 跟随）都能清楚看到走位。
 * 球场仍保留完整标线与两端球门，整体观感与原版接近但更「贴身」。
 */
export function buildFootballField(): Group {
  // v1.3.60：22×14 的场地对 1.22×0.6 的球桌仍是 18 倍，俯视（视野半径约 0.78）
  // 只能看到场地的一小块，等于白做。整体缩到 5.5×3.5，与球桌尺度相称，
  // 俯视 / 跟随两种视角下都能同时看清球场与白球走位。
  const K = 0.25
  beginFieldScale(K)
  const g = new Group()

  // 草地
  const ground = new Mesh(new PlaneGeometry(22, 14), GRASS)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  g.add(ground)

  // 中线 + 中点 + 中圈
  addLine(g, 22, 0.1, 0, 0)
  addDot(g, 0.1, 0, 0)
  addRing(g, 3.0, 3.1, 0, 0)

  // 两端禁区 + 小禁区 + 罚球点 + 罚球弧
  for (const sgn of [-1, 1]) {
    const zBase = sgn * 5.5
    addLine(g, 4.6, 0.08, 0, zBase + sgn * 1.5)
    addLine(g, 4.6, 0.08, 0, zBase - sgn * 1.5)
    addLine(g, 0.08, 3.0, -2.3, zBase)
    addLine(g, 0.08, 3.0, 2.3, zBase)
    addLine(g, 1.8, 0.06, 0, zBase - sgn * 0.8)
    addLine(g, 0.06, 1.4, -0.9, zBase)
    addLine(g, 0.06, 1.4, 0.9, zBase)
    addDot(g, 0.08, 0, zBase - sgn * 1.0)
    addRing(
      g,
      3.0,
      3.06,
      0,
      zBase - sgn * 1.0,
      sgn > 0 ? Math.PI * 1.25 : Math.PI * 0.25,
      Math.PI * 0.5
    )
  }

  // 两端球门
  for (const sgn of [-1, 1]) {
    const z = sgn * 6.5
    const goal = new Group()
    for (const dx of [-1.0, 1.0]) {
      const post = new Mesh(new BoxGeometry(0.08, 0.8, 0.08), WHITE)
      post.position.set(dx, GROUND_Y + 0.4, z)
      goal.add(post)
    }
    const bar = new Mesh(new BoxGeometry(2.0, 0.08, 0.08), WHITE)
    bar.position.set(0, GROUND_Y + 0.8, z)
    goal.add(bar)
    const net = new Mesh(
      new PlaneGeometry(2.0, 0.7),
      new MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.4 })
    )
    net.position.set(0, GROUND_Y + 0.4, z - sgn * 0.04)
    net.rotation.y = sgn > 0 ? Math.PI : 0
    goal.add(net)
    g.add(goal)
  }

  // 体育场看台（紧凑版）：3 层 2.5m，贴场地外缘 (~13/8 单位)
  const STAND_COLOR = 0x4a5560
  // 长边（南北，z 方向）
  addStand(g, 0, 10.5, 26, 4, 3, 2.5, STAND_COLOR, "x")
  addStand(g, 0, -10.5, 26, 4, 3, 2.5, STAND_COLOR, "x")
  // 端边（东西，x 方向）
  addStand(g, 14, 0, 16, 4, 3, 2.5, STAND_COLOR, "z")
  addStand(g, -14, 0, 16, 4, 3, 2.5, STAND_COLOR, "z")

  endFieldScale()
  g.scale.setScalar(K)

  // 天穹挂在外层 wrapper：半径必须 ≤20 —— 非雪景时 camera.far 只有 R*1000≈28.5
  // （见 view.ts），沿用雪山的 130 会被整颗裁掉。
  const wrap = new Group()
  wrap.add(buildSkyDome(0xd2e8ff, 0x2f6fb0, 20))
  wrap.add(g)
  return wrap
}

/**
 * 篮球场（v1.3.60 视野改造）。
 *
 * v1.3.60：原版木地板偏暗，看台太远。改用更亮的木色对比度，球场比例保持 28×15，
 * 但把 4 座看台拉到最近边并降层数（4→3）、降高（4m→2.5m），保证俯视下
 * 仍能清晰看见球桌 + 母球运动轨迹。
 */
export function buildBasketballCourt(): Group {
  // v1.3.60：同足球场，28×15 对球桌过大（俯视只看得到一小块木地板）。
  // 缩到 5.6×3.0，室内顶棚用偏暗的天穹配色以区别于露天球场。
  const K = 0.2
  beginFieldScale(K)
  const g = new Group()

  // 木地板（更亮的木色，让球桌的绿色在木地板上更跳）
  const ground = new Mesh(new PlaneGeometry(28, 15), WOOD)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  g.add(ground)

  // 球场外框
  addLine(g, 28, 0.08, 0, 7.5)
  addLine(g, 28, 0.08, 0, -7.5)
  addLine(g, 0.08, 15, -14, 0)
  addLine(g, 0.08, 15, 14, 0)

  // 中线 + 中圈
  addLine(g, 28, 0.06, 0, 0)
  addRing(g, 1.8, 1.86, 0, 0)

  // 两端：罚球线/罚球圈/三分弧/篮板/篮筐
  for (const sgn of [-1, 1]) {
    const zBase = sgn * 7.5
    const ftZ = zBase - sgn * 2.8

    addLine(g, 3.2, 0.06, 0, ftZ)
    addRing(g, 1.8, 1.86, 0, ftZ)
    const threeStart = sgn > 0 ? Math.PI * 0.15 : Math.PI * 1.15
    addRing(g, 6.4, 6.46, 0, zBase + sgn * 0.6, threeStart, Math.PI * 0.7)
    addLine(g, 0.06, 2.2, -6.5, zBase)
    addLine(g, 0.06, 2.2, 6.5, zBase)

    const board = new Mesh(new PlaneGeometry(1.8, 1.1), WHITE)
    board.position.set(0, GROUND_Y + 1.85, zBase + sgn * 0.4)
    board.rotation.y = sgn > 0 ? Math.PI : 0
    g.add(board)
    const rim = new Mesh(new TorusGeometry(0.23, 0.03, 8, 24), ORANGE)
    rim.position.set(0, GROUND_Y + 1.55, zBase + sgn * 0.7)
    rim.rotation.x = Math.PI / 2
    g.add(rim)
    const support = new Mesh(new BoxGeometry(0.08, 0.08, 0.35), WHITE)
    support.position.set(0, GROUND_Y + 1.55, zBase + sgn * 0.5)
    g.add(support)
  }

  // 体育馆观众席（紧凑版）：3 层 2.5m，贴场地外缘
  const STAND_COLOR = 0x3d4651
  addStand(g, 0, 11, 32, 3.5, 3, 2.5, STAND_COLOR, "x")
  addStand(g, 0, -11, 32, 3.5, 3, 2.5, STAND_COLOR, "x")
  addStand(g, 16, 0, 18, 3.5, 3, 2.5, STAND_COLOR, "z")
  addStand(g, -16, 0, 18, 3.5, 3, 2.5, STAND_COLOR, "z")

  endFieldScale()
  g.scale.setScalar(K)

  // 室内顶棚（暗色天穹），半径同样受限于非雪景的 far≈28.5
  const wrap = new Group()
  wrap.add(buildSkyDome(0x9aa3ad, 0x39404b, 20))
  wrap.add(g)
  return wrap
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
    case "football":
      return buildFootballField()
    case "basketball":
      return buildBasketballCourt()
    case "snow":
      return buildSnowMountainV3()
    default:
      return null
  }
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
 * 仰角压到 38°，让平缓雪坡也能拉开明暗。详见 buildSnowTerrainBand。
 */
const SNOW_BAKE_SUN = [0.6557, -0.4373, 0.6157]

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
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
function snowAzMask(
  r: number,
  ang: number,
  nC: (x: number, y: number) => number
): number {
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
function snowAmpAt(
  r: number,
  ang: number,
  nC: (x: number, y: number) => number
): number {
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
  nA: (x: number, y: number) => number,
  nB: (x: number, y: number) => number,
  nC: (x: number, y: number) => number
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

/**
 * 生成一圈环形地形。RingGeometry 建在 XY 平面，直接把 z 当高度，
 * 天然契合本项目的 Z-up 世界（up = (0,0,1)）。
 *
 * 所有环共用同一组噪声种子与同一个 thetaSegs —— 相邻环在共享半径上的
 * 顶点角度完全对齐、高度函数取值相同，因此接缝处严丝合缝、不会裂缝。
 */
function buildSnowTerrainBand(opts: {
  innerR: number
  outerR: number
  thetaSegs: number
  phiSegs: number
  seedA: number
  seedB: number
  /** v1.3.62c：方位角掩码的独立噪声种子 */
  seedC: number
}): Mesh {
  const { innerR, outerR, thetaSegs, phiSegs, seedA, seedB, seedC } = opts
  const nA = makeValueNoise2D(seedA)
  const nB = makeValueNoise2D(seedB)
  const nC = makeValueNoise2D(seedC)
  const geo = new RingGeometry(innerR, outerR, thetaSegs, phiSegs)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    pos.setZ(
      i,
      snowTerrainZ(Math.hypot(x, y), Math.atan2(y, x), nA, nB, nC)
    )
  }
  geo.computeVertexNormals()

  /**
   * 顶点色 = 反照率 × (天空环境光 + 低角度太阳 × max(0, N·L))，在「显示空间」
   * 直接算出最终颜色，配合 toneMapped=false 所见即所得。
   *
   * 分量的作用分工：
   *  - 相对高度 hT：谷底偏冷蓝 → 峰顶纯白（雪线/冰与新鲜积雪的色差）
   *  - 坡度：陡壁露岩，深灰岩石在白雪上形成强对比（真实雪山的特征）
   *  - 太阳项：制造受光面/背光面的明暗，这是立体感的主要来源
   *
   * 数值经离线分析器校准：太阳仰角取 38°（真实光源 67° 时 NdotL 恒在
   * 0.62~0.99，明暗只差十几个灰阶），使 r=26~120 环带的显示亮度
   * 跨度为 105~255，而非原先挤在 205~225 的死白区间。
   */
  const nrm = geo.attributes.normal
  const colors = new Float32Array(pos.count * 3)
  const cShade = new Color(0x9dbde0) // 谷底/背阴雪：偏冷蓝
  const cSnow = new Color(0xffffff) // 雪线以上：纯白
  // v1.3.62d：整体提亮一档。原 0x39424d/0x66727e 在烘焙光照下最暗处
  // 只有 (23,30,42)，接近纯黑，在白雪里显得像破洞而不是岩石露头。
  const cRockLo = new Color(0x4d5763)
  const cRockHi = new Color(0x7b8794)
  const tmp = new Color()
  const tmp2 = new Color()
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i)
    const py = pos.getY(i)
    const r = Math.hypot(px, py)
    const ang = Math.atan2(py, px)
    const z = pos.getZ(i)
    // 相对高度：0 = 谷底，1 = 峰顶。
    // 平缓区（amp≈0，即山顶平台）没有「谷底」语义，取中值 0.62
    // 让它呈现受光的雪白，而不是塌到最暗的阴影色。
    const amp = snowAmpAt(r, ang, nC)
    const hT = amp < 0.05 ? 0.62 : smoothstep(0, 1, (z - snowFloorZ(r)) / amp)
    tmp.copy(cShade).lerp(cSnow, hT)
    // 陡坡露出岩石（真实雪山：缓坡积雪、陡壁裸露）。
    //
    // v1.3.62d：改为「坡度 × 雪线」双重控制。只用坡度控制时，高山方向
    // （方位掩码 1.45）的坡度能到 1.3（52° 崖壁），整片被判成岩石 ——
    // 实测画面顶部 y=0~60 的地形亮度只有 80~105，比天空（201）还暗，
    // 成了一堵黑石墙。真实雪山恰恰相反：雪线以上积雪、以下才是裸岩。
    // 用 smoothstep(0.30, 0.62, hT) 让峰顶（hT>0.62）彻底无岩、保持雪白，
    // 只有中下部陡坡才露岩。
    const slopeRock = smoothstep(0.06, 0.2, 1 - nrm.getZ(i))
    const rock = slopeRock * (1 - smoothstep(0.3, 0.62, hT))
    if (rock > 0) {
      tmp2.copy(cRockLo).lerp(cRockHi, hT)
      tmp.lerp(tmp2, rock)
    }
    // ── 烘焙太阳光（显示空间）──
    // 场景真实平行光在 (9,-6,26)，仰角高达 67°。缓坡法线几乎都朝上，
    // NdotL 恒在 0.62~0.99，明暗差被 ACES 进一步压平。这里另取一束
    // 仰角约 38°、方位与真实太阳一致的「假想太阳」，只作用于地形网格。
    const nd = Math.max(
      0,
      nrm.getX(i) * SNOW_BAKE_SUN[0] +
        nrm.getY(i) * SNOW_BAKE_SUN[1] +
        nrm.getZ(i) * SNOW_BAKE_SUN[2]
    )
    const ndc = Math.pow(nd, SNOW_SHADE.GAMMA)
    // tmp 的 r/g/b 是线性工作空间分量，先转回显示空间再乘光照系数，
    // 这样写进去的色值就是屏幕上看到的色值（toneMapped=false）。
    let dr = SRGBToDisplay(tmp.r)
    let dg = SRGBToDisplay(tmp.g)
    let db = SRGBToDisplay(tmp.b)
    // 大气透视：按半径淡入天色（见 SNOW_HAZE 注释，替代 scene.fog）
    const haze =
      SNOW_HAZE.MAX * smoothstep(SNOW_HAZE.START, SNOW_HAZE.END, r)
    if (haze > 0) {
      dr += (SNOW_HAZE.COLOR[0] - dr) * haze
      dg += (SNOW_HAZE.COLOR[1] - dg) * haze
      db += (SNOW_HAZE.COLOR[2] - db) * haze
    }
    tmp.setRGB(
      Math.min(1, dr * (SNOW_SHADE.AMB[0] + SNOW_SHADE.SUN[0] * ndc)),
      Math.min(1, dg * (SNOW_SHADE.AMB[1] + SNOW_SHADE.SUN[1] * ndc)),
      Math.min(1, db * (SNOW_SHADE.AMB[2] + SNOW_SHADE.SUN[2] * ndc)),
      SRGBColorSpace
    )
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3))
  // v1.3.62c：MeshLambertMaterial → MeshBasicMaterial + toneMapped=false。
  // 顶点色已经算完了光照，不能再接受场景真实光照（否则 2.53 的辐照度
  // 会把 0.5 以上的反照率全部顶到过曝），也不能再走 ACES（0.5 以上
  // 全被压到 194+，动态范围尽失）。
  // v1.3.62d：fog=false，大气透视改为烘进顶点色（见 SNOW_HAZE）。
  const mesh = new Mesh(
    geo,
    new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
  )
  mesh.name = "SnowTerrain"
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/** 线性工作空间分量 → 显示空间（sRGB 传递函数的正变换） */
function SRGBToDisplay(c: number): number {
  const v = Math.min(1, Math.max(0, c))
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/** 山顶平台上的露头岩石：给俯视窄边和 aim 视角前景补细节 */
function buildSnowRocks(): Group {
  const g = new Group()
  g.name = "SnowRocks"
  const rng = makeSeededRng(4021)
  const cRock = new Color(0x5c6672)
  const cSnow = new Color(0xf4f9ff)
  const tmp = new Color()
  for (let i = 0; i < 24; i++) {
    const ang = rng() * Math.PI * 2
    const r = 2.1 + rng() * 3.2
    const h = 0.1 + rng() * 0.26
    const rad = h * (0.7 + rng() * 0.7)
    const geo = new ConeGeometry(rad, h, 5 + Math.floor(rng() * 3), 1)
    geo.rotateX(Math.PI / 2)
    geo.translate(0, 0, h / 2)
    // 径向随机扰动，破掉规则圆锥感
    const p = geo.attributes.position
    for (let v = 0; v < p.count; v++) {
      const s = 0.78 + rng() * 0.44
      p.setX(v, p.getX(v) * s)
      p.setY(v, p.getY(v) * s)
    }
    geo.computeVertexNormals()
    const nrm = geo.attributes.normal
    const cols = new Float32Array(p.count * 3)
    for (let v = 0; v < p.count; v++) {
      const t = Math.min(1, Math.max(0, p.getZ(v) / h))
      tmp.copy(cRock).lerp(cSnow, smoothstep(0.45, 0.95, t))
      // v1.3.62c：与地形同一套显示空间着色 + toneMapped=false，
      // 否则这 24 块石头会在雪白地形上显得格外平、格外亮，像贴纸。
      const ndc = Math.pow(
        Math.max(
          0,
          nrm.getX(v) * SNOW_BAKE_SUN[0] +
            nrm.getY(v) * SNOW_BAKE_SUN[1] +
            nrm.getZ(v) * SNOW_BAKE_SUN[2]
        ),
        SNOW_SHADE.GAMMA
      )
      tmp.setRGB(
        Math.min(1, SRGBToDisplay(tmp.r) * (SNOW_SHADE.AMB[0] + SNOW_SHADE.SUN[0] * ndc)),
        Math.min(1, SRGBToDisplay(tmp.g) * (SNOW_SHADE.AMB[1] + SNOW_SHADE.SUN[1] * ndc)),
        Math.min(1, SRGBToDisplay(tmp.b) * (SNOW_SHADE.AMB[2] + SNOW_SHADE.SUN[2] * ndc)),
        SRGBColorSpace
      )
      cols[v * 3] = tmp.r
      cols[v * 3 + 1] = tmp.g
      cols[v * 3 + 2] = tmp.b
    }
    geo.setAttribute("color", new BufferAttribute(cols, 3))
    const m = new Mesh(
      geo,
      // 注：MeshBasicMaterial 不做光照，flatShading 无效果（且新版类型里已移除）
      new MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
      })
    )
    m.position.set(Math.cos(ang) * r, Math.sin(ang) * r, snowFloorZ(r))
    m.castShadow = false
    m.receiveShadow = false
    g.add(m)
  }
  return g
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

  g.add(buildSnowRocks())
  return g
}
