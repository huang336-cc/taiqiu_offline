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
  PlaneGeometry,
  BoxGeometry,
  RingGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  SphereGeometry,
  BackSide,
  BufferGeometry,
  BufferAttribute,
  Color,
  Matrix4,
  Vector3,
  SRGBColorSpace,
} from "three"
import { makeValueNoise2D, fbm2D, makeSeededRng } from "../utils/noise"

/**
 * 台球桌底沿真实世界 z 坐标（Z-up 世界），用于雪山场景：
 * 桌面下沿在 z = -0.203；雪地平面必须贴在这里，避免穿插桌面。
 *
 * 同时导出给 assets.ts —— 立方体房间（没有几何 3D 环境的场景）的地板
 * 也必须落在这个高度，否则地板会悬在球桌上方 1.2m 处，把俯视镜头
 * 的球桌整个盖住（v1.3.62 修复）。
 */
export const GROUND_Z = -0.203

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
 * `geometric` 目前只有 snow / football / basketball 为 true —— 其余 5 个
 * 场景的几何环境在步 3~6 逐个补上后改为 true（view 仍以 buildSceneEnvironment
 * 是否返回 null 为准，表的字段超前不会出错）。
 */
export const ENV_SPECS: Record<string, EnvSpec> = {
  // ── 室内三件套：墙 + 顶棚，不需要天穹 ──
  room: {
    far: 70, skyRadius: 0, outdoor: false, fog: null,
    realShadow: false, indoor: true, geometric: true,
  },
  office: {
    far: 70, skyRadius: 0, outdoor: false, fog: null,
    realShadow: false, indoor: true, geometric: true,
  },
  cybercafe: {
    far: 70, skyRadius: 0, outdoor: false, fog: null,
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
  forest: {
    far: 130, skyRadius: 100, outdoor: false, fog: null,
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
  // ── 球场：室内体育馆观感，无天穹（步 6 重做后再复核）──
  football: {
    far: 70, skyRadius: 40, outdoor: false, fog: null,
    realShadow: false, indoor: false, geometric: true,
  },
  basketball: {
    far: 70, skyRadius: 40, outdoor: false, fog: null,
    realShadow: false, indoor: false, geometric: true,
  },
  // ── UFC 八角笼：室内暗场馆，同球场用天穹当顶棚 ──
  ufc: {
    far: 70, skyRadius: 40, outdoor: false, fog: null,
    realShadow: false, indoor: false, geometric: true,
  },
}

// ══════════════════════════════════════════════════════════════════════
//                球场（football / basketball）
// ══════════════════════════════════════════════════════════════════════

/**
 * v1.3.63 重做：球场原先是**按 Y-up 建的**（地面躺在 XZ 平面、法线 +Y），
 * 可世界是 Z-up —— 实测 `camera.up = (0,0,1)`，球桌底沿在 z = GROUND_Z。
 * 于是整块球场在世界里是**立起来的**，看台沿世界 Z 方向一层层往上堆。
 * 这才是「3D 做了但视野极差」的真正原因；v1.3.60 只把尺度从 22×14 缩到
 * 5.5×3.5，没碰朝向，等于白调。现在整套改成 Z-up：地面是 XY 平面、法线 +Z，
 * 与雪山 / 室内三件套完全一致。
 *
 * 尺寸按可见性反推（与室内同一套结论）：瞄准相机的可见高度上限是
 * 0.295 + 0.035·d，于是
 *   · 球门在 5m 外 → 只看得到门柱下段 0.47m，横梁与球网恒不入画
 *   · 看台在 7~11m 外 → 可见 0.54~0.68m，排高 0.30m 时刚好看到前 2 排
 *   · 篮板 3.05m、篮筐 3.05m → 怎么都入不了画（竖屏上限也只有 0.9m），
 *     仍然建模，只为让篮球架的支撑结构在近处有个交代
 * 所以看台只做 3 排、座椅只做前 2 排朝向场内的那一面，再往上纯属浪费。
 */
const FB_HX = 5.0 // v1.3.64：足球场半长 8 → 5（球桌 1.4、瞄准相机 5.7m 可见上限，看台已落在远景里）
const FB_HY = 3.2 // v1.3.64：半宽 5 → 3.2
const BK_HX = 4.0 // v1.3.64：篮球场半长 6 → 4
const BK_HY = 2.4 // v1.3.64：半宽 3.5 → 2.4
const FIELD_Z = GROUND_Z - 0.004
const LINE_Z = GROUND_Z + 0.008
/** 天穹半径。相机最大偏心 22.2 → far 需 ≥ 62.2，两个球场都是 70 */
const FIELD_SKY_R = 40

/** 球场线：XY 平面上的一条白条（Z-up 下无需旋转） */
function lineGeo(w: number, l: number, x: number, y: number): BufferGeometry {
  const g = new PlaneGeometry(w, l)
  g.translate(x, y, LINE_Z)
  return g
}

/** 圆环线（中圈 / 罚球弧） */
function ringGeo(
  rIn: number,
  rOut: number,
  x: number,
  y: number,
  thetaStart = 0,
  thetaLength = Math.PI * 2
): BufferGeometry {
  const g = new RingGeometry(rIn, rOut, 72, 1, thetaStart, thetaLength)
  g.translate(x, y, LINE_Z)
  return g
}

/** 实心圆点（中点 / 罚球点） */
function dotGeo(r: number, x: number, y: number): BufferGeometry {
  const g = new CircleGeometry(r, 20)
  g.translate(x, y, LINE_Z + 0.002)
  return g
}

/** 直立件：X=宽 Y=长 Z=高，原点在底面中心 */
function stakeGeo(
  w: number,
  l: number,
  h: number,
  x: number,
  y: number,
  z = FIELD_Z
): BufferGeometry {
  const g = new BoxGeometry(w, l, h)
  g.translate(x, y, z + h / 2)
  return g
}

/** 只合并 position/normal（线条这类统一白色的部件，颜色交给 bakeVertices 生成） */
function mergePlain(geos: BufferGeometry[]): BufferGeometry {
  let total = 0
  for (const g of geos) total += g.attributes.position.count
  const pos = new Float32Array(total * 3)
  const nrm = new Float32Array(total * 3)
  let o = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3)
    nrm.set(g.attributes.normal.array as Float32Array, o * 3)
    o += g.attributes.position.count
    g.dispose()
  }
  const out = new BufferGeometry()
  out.setAttribute("position", new BufferAttribute(pos, 3))
  out.setAttribute("normal", new BufferAttribute(nrm, 3))
  return out
}

/** bakeVertices 的 base 只给法线 z，这里补一版能拿到世界坐标的 */
function bakeByPos(
  geo: BufferGeometry,
  shade: { AMB: number[]; SUN: number[]; GAMMA: number },
  bakeSun: number[],
  albedo: (out: Color, p: Vector3, i: number) => void
): void {
  const pos = geo.attributes.position
  const P = new Vector3()
  bakeVertices(geo, shade, bakeSun, (out, _nz, i) => {
    P.fromBufferAttribute(pos, i)
    albedo(out, P, i)
  })
}

/**
 * 四面看台。台阶是实心 box，座椅只做**朝向场内**的那一面（背面与顶面在
 * 低视角下永远看不见），座椅分隔靠顶点色条纹做出来 —— 这样每排座椅只要
 * 一个 plane，而不是几十个 box。
 */
function buildStands(
  hx: number,
  hy: number,
  lenX: number,
  lenY: number,
  rows: number,
  stepZ: number,
  stepD: number,
  gap: number,
  stepHex: number,
  seatHexes: number[]
): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const step = new Color(stepHex)
  const sides: { onX: boolean; sign: number }[] = [
    { onX: false, sign: 1 },
    { onX: false, sign: -1 },
    { onX: true, sign: 1 },
    { onX: true, sign: -1 },
  ]
  for (const sd of sides) {
    const len = sd.onX ? lenY : lenX
    for (let i = 0; i < rows; i++) {
      const d = (sd.onX ? hx : hy) + gap + i * stepD
      const h = (i + 1) * stepZ
      // 台阶
      const g = sd.onX
        ? stakeGeo(stepD, len, h, sd.sign * d, 0)
        : stakeGeo(len, stepD, h, 0, sd.sign * d)
      out.push(g)
      // 座椅正面：只有前两排排得进画面（见文件头注释）
      if (i < 2) {
        const face = sd.onX
          ? new PlaneGeometry(len, 0.45, Math.round(len * 3), 2)
          : new PlaneGeometry(len, 0.45, Math.round(len * 3), 2)
        if (sd.onX) {
          // 法线默认 +Z，转到 −sign·X（朝场内）
          face.rotateY(sd.sign > 0 ? -Math.PI / 2 : Math.PI / 2)
          face.translate(sd.sign * (d - stepD / 2), 0, FIELD_Z + h + 0.225)
        } else {
          face.rotateY(sd.sign > 0 ? Math.PI / 2 : -Math.PI / 2)
          face.translate(0, sd.sign * (d - stepD / 2), FIELD_Z + h + 0.225)
        }
        out.push(face)
      }
    }
  }
  void step
  void seatHexes
  return out
}

/** 座椅条纹：每 0.55m 一个座位，缝隙压暗；按段换色（主队/客队看台） */
function seatStripe(out: Color, u: number, seatHexes: number[]): void {
  const seg = Math.floor((u + 60) / 0.55)
  out.setHex(seatHexes[seg % seatHexes.length])
  const f = (u + 60) / 0.55 - seg
  if (f < 0.08 || f > 0.92) out.offsetHSL(0, 0, -0.12)
}

/**
 * 场外地面（跑道 / 水泥地）。
 *
 * 必须一直铺到天穹脚下：草皮只盖球场本体，中间那圈裸露的空白在掠射下会
 * 露出天穹的下半球，形成一条突兀的色带。haze 把外缘混向地平线色收边。
 */
function buildOuterGround(
  hx: number,
  hy: number,
  hex: number,
  horizon: number[],
  shade: { AMB: number[]; SUN: number[]; GAMMA: number },
  bakeSun: number[]
): Mesh {
  const W = (hx + 9) * 2
  const L = (hy + 9) * 2
  const geo = new PlaneGeometry(W, L, 64, 52)
  geo.translate(0, 0, FIELD_Z - 0.012)
  const c = new Color(hex)
  const rMax = Math.hypot(hx + 9, hy + 9)
  bakeByPos(geo, shade, bakeSun, (out, P) => {
    out.copy(c)
    const n = hash2(Math.round(P.x * 3), Math.round(P.y * 3))
    out.offsetHSL(0, 0, (n - 0.5) * 0.05)
  })
  // 大气透视单独走一遍（要在光照之后）
  const col = geo.attributes.color as BufferAttribute
  const tmp = new Color()
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i))
    const t = smoothstep(rMax * 0.55, rMax * 0.98, r)
    if (t <= 0) continue
    tmp.setRGB(col.getX(i), col.getY(i), col.getZ(i), SRGBColorSpace)
    const dr = SRGBToDisplay(tmp.r)
    const dg = SRGBToDisplay(tmp.g)
    const db = SRGBToDisplay(tmp.b)
    tmp.setRGB(
      dr + (horizon[0] - dr) * t,
      dg + (horizon[1] - dg) * t,
      db + (horizon[2] - db) * t,
      SRGBColorSpace
    )
    col.setXYZ(i, tmp.r, tmp.g, tmp.b)
  }
  col.needsUpdate = true
  const m = new Mesh(geo, envMaterial())
  m.name = "OuterGround"
  return m
}

// ───────────────────────── 足球场 ─────────────────────────

const FB_SHADE = { AMB: [0.40, 0.42, 0.40], SUN: [0.72, 0.74, 0.66], GAMMA: 1.2 }
const FB_BAKE_SUN = [0.681, -0.454, 0.574]
const FB_HORIZON = [0.941, 0.851, 0.690] // 0xf0d9b0 傍晚地平线
const FB_TURF_A = new Color(0x3f8544)
const FB_TURF_B = new Color(0x357539)

export function buildFootballField(): Group {
  const g = new Group()
  g.name = "Football"
  g.add(
    buildSkyDome(
      0xf0d9b0, // 地平线：傍晚暖黄
      0x7fb0d8, // 中段
      0x2a6bb0, // 天顶
      FIELD_SKY_R,
      0x6a7d5a, // 下半球 = 场外草地，与地面外缘同色
      false,
      [0.012, 0.05]
    )
  )
  g.add(
    buildOuterGround(FB_HX, FB_HY, 0x5f6f52, FB_HORIZON, FB_SHADE, FB_BAKE_SUN)
  )

  // 草皮：横向割草条纹（每 1.6m 交替）—— 掠射下是最强的一根纵深线索
  const turf = new PlaneGeometry(FB_HX * 2, FB_HY * 2, 120, 75)
  turf.translate(0, 0, FIELD_Z)
  bakeByPos(turf, FB_SHADE, FB_BAKE_SUN, (out, P) => {
    const s = Math.floor((P.y + 50) / 1.6) % 2
    out.copy(s === 0 ? FB_TURF_A : FB_TURF_B)
    const n = hash2(Math.round(P.x * 7), Math.round(P.y * 7))
    out.offsetHSL(0, 0, (n - 0.5) * 0.05)
  })
  const tm = new Mesh(turf, envMaterial())
  tm.name = "Turf"
  g.add(tm)

  // 标线
  const lines: BufferGeometry[] = [
    lineGeo(FB_HX * 2, 0.10, 0, FB_HY),
    lineGeo(FB_HX * 2, 0.10, 0, -FB_HY),
    lineGeo(0.10, FB_HY * 2, FB_HX, 0),
    lineGeo(0.10, FB_HY * 2, -FB_HX, 0),
    lineGeo(FB_HX * 2, 0.08, 0, 0), // 中线
    ringGeo(0.9, 0.96, 0, 0), // v1.3.64：中圈 1.75 → 0.9
    dotGeo(0.06, 0, 0),       // v1.3.64：开球点 0.09 → 0.06
  ]
  for (const sgn of [-1, 1]) {
    const yb = sgn * FB_HY
    // 大禁区：v1.3.64 整体按球场缩比缩小（球场 5×3.2，硬编码 6.4×2.6 太大）
    lines.push(lineGeo(4.0, 0.08, 0, yb - sgn * 1.6))      // v1.3.64：6.4×2.6 → 4.0×1.6
    lines.push(lineGeo(0.08, 1.6, -2.0, yb - sgn * 0.8))  // v1.3.64：2.6×3.2 → 1.6×2.0
    lines.push(lineGeo(0.08, 1.6, 2.0, yb - sgn * 0.8))
    // 小禁区
    lines.push(lineGeo(2.0, 0.06, 0, yb - sgn * 0.7))      // v1.3.64：3.2×1.1 → 2.0×0.7
    lines.push(lineGeo(0.06, 0.7, -1.0, yb - sgn * 0.35))  // v1.3.64：1.1×1.6 → 0.7×1.0
    lines.push(lineGeo(0.06, 0.7, 1.0, yb - sgn * 0.35))
    // 罚球点 + 罚球弧
    lines.push(dotGeo(0.06, 0, yb - sgn * 1.2))            // v1.3.64：1.9 → 1.2
    lines.push(
      ringGeo(1.0, 1.06, 0, yb - sgn * 1.2, sgn > 0 ? Math.PI * 1.22 : Math.PI * 0.22, Math.PI * 0.56) // v1.3.64：1.75 → 1.0
    )
    // 角弧
    for (const sx of [-1, 1]) {
      lines.push(
        ringGeo(0.30, 0.36, sx * FB_HX, yb, 0, Math.PI * 2) // v1.3.64：0.42 → 0.30
      )
    }
  }
  const lg = mergePlain(lines)
  bakeByPos(lg, FB_SHADE, FB_BAKE_SUN, (out) => out.setRGB(1, 1, 1))
  const lm = new Mesh(lg, envMaterial())
  lm.name = "FieldLines"
  g.add(lm)

  // 球门（只有门柱下段入画）+ 泛光灯塔（只有塔基入画）
  const props: BufferGeometry[] = []
  for (const sgn of [-1, 1]) {
    for (const sx of [-1, 1]) {
      props.push(stakeGeo(0.08, 0.08, 1.6, sx * 1.0, sgn * FB_HY)) // v1.3.64：sx*1.83 → 1.0，门柱高度 2.44 → 1.6
    }
    props.push(stakeGeo(2.0, 0.08, 0.06, 0, sgn * FB_HY, FIELD_Z + 1.6)) // v1.3.64：横梁 3.9×0.09 → 2.0×0.08
  }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      props.push(stakeGeo(0.5, 0.5, 6.0, sx * 9, sy * 6)) // v1.3.64：sx*15 sy*11 → 9/6（球场缩了，灯塔也内收）
      props.push(stakeGeo(1.0, 1.0, 0.20, sx * 9, sy * 6))
    }

  const standGeos = buildStands(
    FB_HX,
    FB_HY,
    14,            // v1.3.64：22 → 14（球场缩了 8→5，看台也得缩，否则两端溢出天穹）
    10,            // v1.3.64：15 → 10
    2,             // v1.3.64：3 排 → 2 排（顶上一排 z=0.6 已压到台呢视觉上沿，留着只会让红蓝条纹成「红墙」）
    0.20,          // v1.3.64：0.30 → 0.20，最高看台 z=0.4 仍在台呢 z=0.06 之上但不压到相机 z=0.295
    0.80,          // v1.3.64：0.95 → 0.80
    1.2,           // v1.3.64：1.4 → 1.2，球场小了间隙也收一点
    0x545e69,
    [0x2f5d8a]     // v1.3.64：去掉 0x8a3f3a 红色调
  )
  const all = props.concat(standGeos)
  const pg = mergePlain(all)
  bakeByPos(pg, FB_SHADE, FB_BAKE_SUN, (out, P) => {
    // 白色门柱 / 深色塔身 / 看台 / 座椅，靠几何尺寸区分太脆，直接按高度与世界位置判
    const smallFootprint =
      Math.abs(P.x) > 13.5 || Math.abs(P.y) > 9.5
    if (P.z > FIELD_Z + 2.0 && !smallFootprint) {
      out.setHex(0xf2f2ee) // 门柱 / 横梁
      return
    }
    const inField =
      Math.abs(P.x) <= FB_HX + 1.5 && Math.abs(P.y) <= FB_HY + 1.5
    if (smallFootprint) {
      out.setHex(0x3f4650) // 灯塔
      return
    }
    if (inField) {
      out.setHex(0x545e69) // 台阶
      return
    }
    // 座椅正面：法线水平的竖直面
    seatStripe(out, Math.abs(P.x) > Math.abs(P.y) ? P.y : P.x, [
      0x2f5d8a,
      0x8a3f3a,
    ])
  })
  const pm = new Mesh(pg, envMaterial())
  pm.name = "FieldProps"
  g.add(pm)
  return g
}

// ───────────────────────── 篮球场 ─────────────────────────

const BK_SHADE = { AMB: [0.42, 0.42, 0.43], SUN: [0.70, 0.70, 0.72], GAMMA: 1.15 }
const BK_BAKE_SUN = [0.681, -0.454, 0.574]
const BK_HORIZON = [0.847, 0.824, 0.769] // 0xd8d2c4
const BK_WOOD_A = new Color(0xc99f63)
const BK_WOOD_B = new Color(0xbd8f52)

export function buildBasketballCourt(): Group {
  const g = new Group()
  g.name = "Basketball"
  g.add(
    buildSkyDome(
      0xd8d2c4, // 地平线
      0x8fa6bd,
      0x3c5a80,
      FIELD_SKY_R,
      0x9a9184,
      false,
      [0.012, 0.05]
    )
  )
  g.add(
    buildOuterGround(BK_HX, BK_HY, 0x8b8375, BK_HORIZON, BK_SHADE, BK_BAKE_SUN)
  )

  // 木地板：沿 X 的长条拼板
  const floor = new PlaneGeometry(BK_HX * 2, BK_HY * 2, 108, 63)
  floor.translate(0, 0, FIELD_Z)
  bakeByPos(floor, BK_SHADE, BK_BAKE_SUN, (out, P) => {
    const PW = 0.22
    const PL = 1.3
    const row = Math.floor(P.y / PW)
    const sx = P.x + row * PL * 0.4
    out.copy(BK_WOOD_A).lerp(BK_WOOD_B, hash2(Math.floor(sx / PL), row))
    const seam = Math.min(
      Math.min(sx / PL - Math.floor(sx / PL), 1 - (sx / PL - Math.floor(sx / PL))) * PL,
      Math.min(P.y / PW - row, 1 - (P.y / PW - row)) * PW
    )
    out.lerp(new Color(0x6d4f2c), (1 - smoothstep(0, 0.014, seam)) * 0.7)
    // 三分线以内的漆面比外圈亮一档（真实球场就是这么分区上漆的）
    if (Math.hypot(P.x, P.y) < 6.2) out.offsetHSL(0, 0, 0.03)
  })
  const fmesh = new Mesh(floor, envMaterial())
  fmesh.name = "CourtFloor"
  g.add(fmesh)

  // 标线
  const lines: BufferGeometry[] = [
    lineGeo(BK_HX * 2, 0.08, 0, BK_HY),
    lineGeo(BK_HX * 2, 0.08, 0, -BK_HY),
    lineGeo(0.08, BK_HY * 2, BK_HX, 0),
    lineGeo(0.08, BK_HY * 2, -BK_HX, 0),
    lineGeo(BK_HX * 2, 0.06, 0, 0),
    ringGeo(0.9, 0.96, 0, 0), // v1.3.64：中圈 1.75 → 0.9（球场缩了 6×3.5 → 4×2.4，中圈也得缩）
  ]
  for (const sgn of [-1, 1]) {
    const yb = sgn * BK_HY
    const ft = yb - sgn * 2.0  // v1.3.64：罚球线距端线 2.6 → 2.0（球场缩到 2.4 半宽）
    lines.push(lineGeo(3.0, 0.06, 0, ft)) // v1.3.64：罚球线 3.6 → 3.0
    lines.push(ringGeo(1.2, 1.26, 0, ft)) // v1.3.64：罚球弧 1.75 → 1.2
    // 三分弧：以篮筐为圆心的一段 + 两段直边
    const cx = 0
    const cy = yb - sgn * 0.75
    lines.push(
      ringGeo(3.0, 3.06, cx, cy, sgn > 0 ? Math.PI * 0.13 : Math.PI * 1.13, Math.PI * 0.74) // v1.3.64：5.6 → 3.0
    )
    lines.push(lineGeo(0.06, 1.6, -2.8, yb)) // v1.3.64：2.4 → 1.6，位置 5.3 → 2.8
    lines.push(lineGeo(0.06, 1.6, 2.8, yb))
  }
  const lg = mergePlain(lines)
  bakeByPos(lg, BK_SHADE, BK_BAKE_SUN, (out) => out.setRGB(1, 1, 1))
  const lm = new Mesh(lg, envMaterial())
  lm.name = "CourtLines"
  g.add(lm)

  // 篮球架（篮板 3.05m，恒不入画，只建模求个交代）+ 一圈围栏
  const props: BufferGeometry[] = []
  for (const sgn of [-1, 1]) {
    const yb = sgn * BK_HY
    props.push(stakeGeo(1.30, 0.90, 0.14, 0, yb + sgn * 0.55)) // 底座
    props.push(stakeGeo(0.14, 0.14, 2.10, 0, yb + sgn * 0.90)) // 立柱
    props.push(stakeGeo(0.10, 1.30, 0.10, 0, yb + sgn * 0.30, FIELD_Z + 2.05)) // 悬臂
    props.push(stakeGeo(1.80, 0.06, 1.05, 0, yb + sgn * 0.10, FIELD_Z + 2.30)) // 篮板
  }
  // 围栏：每 2.2m 一根竖杆 + 两道横杆
  const fx = BK_HX + 1.6
  const fy = BK_HY + 1.6
  const posts: BufferGeometry[] = []
  const nx = Math.round((fx * 2) / 2.2)
  const ny = Math.round((fy * 2) / 2.2)
  for (let i = 0; i <= nx; i++) {
    const x = -fx + (i / nx) * fx * 2
    posts.push(stakeGeo(0.05, 0.05, 1.10, x, fy))
    posts.push(stakeGeo(0.05, 0.05, 1.10, x, -fy))
  }
  for (let j = 1; j < ny; j++) {
    const y = -fy + (j / ny) * fy * 2
    posts.push(stakeGeo(0.05, 0.05, 1.10, fx, y))
    posts.push(stakeGeo(0.05, 0.05, 1.10, -fx, y))
  }
  for (const hz of [0.55, 1.05]) {
    posts.push(stakeGeo(fx * 2, 0.04, 0.04, 0, fy, FIELD_Z + hz))
    posts.push(stakeGeo(fx * 2, 0.04, 0.04, 0, -fy, FIELD_Z + hz))
    posts.push(stakeGeo(0.04, fy * 2, 0.04, fx, 0, FIELD_Z + hz))
    posts.push(stakeGeo(0.04, fy * 2, 0.04, -fx, 0, FIELD_Z + hz))
  }

  const standGeos = buildStands(
    BK_HX,
    BK_HY,
    11,            // v1.3.64：17 → 11
    8,             // v1.3.64：12 → 8
    2,             // v1.3.64：3 排 → 2 排
    0.20,          // v1.3.64：0.30 → 0.20
    0.80,          // v1.3.64：0.95 → 0.80
    1.6,           // v1.3.64：2.6 → 1.6，球场小了间隙收一点
    0x4d5661,
    [0x2f5d8a]     // v1.3.64：单色，去掉红
  )
  const pg = mergePlain(props.concat(posts, standGeos))
  bakeByPos(pg, BK_SHADE, BK_BAKE_SUN, (out, P) => {
    const ax = Math.abs(P.x)
    const ay = Math.abs(P.y)
    if (P.z > FIELD_Z + 2.0) {
      out.setHex(0xf4f4f0) // 篮板 / 悬臂
      return
    }
    if (ax < fx + 0.4 && ay < fy + 0.4) {
      // 场地内：篮球架底座与立柱
      out.setHex(P.z > FIELD_Z + 0.6 ? 0x4a505a : 0x3a4048)
      return
    }
    if (ax > fx - 0.3 && ax < fx + 0.3 && ay < fy) {
      out.setHex(0x6d747c) // 围栏竖杆 / 横杆
      return
    }
    if (ay > fy - 0.3 && ay < fy + 0.3 && ax < fx) {
      out.setHex(0x6d747c)
      return
    }
    // 看台：台阶 vs 座椅面。座椅面是竖直平面（法线水平），用高度区分不可靠，
    // 改用「是否贴着台阶顶面 + 离场地更远」来判。
    const onSeat = P.z > FIELD_Z + 0.30
    if (onSeat && (ax > 7.4 || ay > 5.0)) {
      seatStripe(out, ax > ay ? P.y : P.x, [0x2f5d8a, 0x8a3f3a])
      return
    }
    out.setHex(0x4d5661)
  })
  const pm = new Mesh(pg, envMaterial())
  pm.name = "CourtProps"
  g.add(pm)
  return g
}

// ══════════════════════════════════════════════════════════════════════
//                        UFC 八角笼（ufc）
//
// 与球场同一套 Z-up 约定：地面躺在 XY 平面、法线 +Z，地面 z = FIELD_Z。
//
// 尺度依据（沿用 v1.3.64 球场踩过的坑）：瞄准相机高 0.295m、俯角 −16.33°，
// 地面要到 d≈5.7m 才从台边露出来。真实 UFC 八角笼**对角 9.8m / 笼高 1.78m**，
// 原样照搬会把笼子整个推出画面，只剩头顶一条网。这里取外接半径 4.3m
// （对边 7.95m、边长 3.29m）、笼高 1.70m —— 与篮球场 8×4.8m 同量级，
// 笼网立柱落在 d≈4.0~4.3m，正卡在可见区内侧，形成「隔着笼网看球桌」的框景。
//
// 笼网**不做整面片**：8 面网各用 17 根竖杆 + 4 道横杆的细 box 拼出，
// 缝隙是真的空的 —— 看台能透出来，纵深感远好于一张半透明面片，也绕开了
// 透明材质的排序问题（envMaterial 是不透明的）。合计 176 个 box / 4224
// 顶点，成本可忽略。
//
// 配色走 UFC 转播的经典观感：**暗场馆 + 笼内被聚光灯打亮的帆布**，
// 帆布（显示亮度约 117）与笼外地面（约 23）拉开近 5 倍，纵深感全靠这个对比。
// ══════════════════════════════════════════════════════════════════════

const UFC_R = 4.3 // 八角笼外接半径（顶点到中心）
const UFC_A = UFC_R * Math.cos(Math.PI / 8) // 边心距 ≈ 3.973（边中点到中心）
const UFC_E = 2 * UFC_R * Math.sin(Math.PI / 8) // 边长 ≈ 3.291
const UFC_H = 1.7 // 笼网高（真实 1.78m）

const UFC_SHADE = { AMB: [0.38, 0.39, 0.42], SUN: [0.62, 0.63, 0.66], GAMMA: 1.15 }
const UFC_BAKE_SUN = [0.681, -0.454, 0.574]
// v1.3.65b：haze 目标色原用 0x2b3138=(43,49,56)，与 clearColor 0x292f36 只差
// 2~3 个灰阶 —— 竖屏 aim 视角能望到 r>10.3m 的远景地面，haze 把那里混成
// clearColor 色，被判成大洞。压暗一档（0x1c212c）并经扫描确认「地面亮色 →
// haze」混合路径全程不进 clearColor±3 色盒。
const UFC_HORIZON = [0.11, 0.129, 0.173] // 0x1c212c 场馆暗调（远地面 haze 收边用）
const UFC_OUT = new Color(0x1c2026) // 笼外地面（与 buildOuterGround 同色）
const UFC_CANVAS = new Color(0x767b83) // 笼内帆布
const UFC_RING = new Color(0x585e67) // 中央圆环带
const UFC_LOGO = new Color(0x41464e) // 中央八边形
const UFC_FENCE = 0x585e68 // 笼网钢丝
const UFC_POST = 0x121418 // 八根角柱（黑漆钢管）

/** 八条边的内法线（(k+0.5)·45°），预计算避免逐顶点重复 8 次三角函数 */
const UFC_NX = [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
  Math.cos((k + 0.5) * (Math.PI / 4))
)
const UFC_NY = [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
  Math.sin((k + 0.5) * (Math.PI / 4))
)

/**
 * 正八边形的有向距离：笼内为负、笼外为正，0 即笼网所在的那条边。
 * 对凸多边形，8 个内法线方向上点积的最大值就是支撑函数，减去边心距即得
 * 「沿最近边法线到边界的距离」（角外侧会略小于真实欧氏距离，做着色够用）。
 *
 * @param R 该八边形的外接半径，默认 UFC_R；中心图案传更小的半径复用。
 */
function octSDF(x: number, y: number, R = UFC_R): number {
  let d = -Infinity
  for (let k = 0; k < 8; k++) {
    const v = x * UFC_NX[k] + y * UFC_NY[k]
    if (v > d) d = v
  }
  return d - R * Math.cos(Math.PI / 8)
}

/**
 * 笼内地垫（帆布）。
 *
 * 用一整块覆盖外接正方形的 plane + 八边形 SDF 着色，而不是几何裁剪出八边形：
 * 后者（CircleGeometry(r,8)）只有 8 个三角形，顶点色根本画不出中央图案。
 * 八边形外的部分**必须**复制 buildOuterGround 的着色（同色 + 同 hash 噪声），
 * 否则接缝处会有一圈色差 —— 好在 haze 要到 r=10.3 才起效，地垫只到 6.08m，
 * 不吃 haze，两遍算出来的颜色天然一致。
 */
function buildOctCanvas(): Mesh {
  const S = UFC_R * 2
  const geo = new PlaneGeometry(S, S, 192, 192)
  geo.translate(0, 0, FIELD_Z)
  bakeByPos(geo, UFC_SHADE, UFC_BAKE_SUN, (out, P) => {
    const d = octSDF(P.x, P.y)
    // 八边形外（含笼内那圈黑边框）：与场外地面同色同噪声，接缝不可见
    if (d > -0.34) {
      out.copy(UFC_OUT)
      const n = hash2(Math.round(P.x * 3), Math.round(P.y * 3))
      out.offsetHSL(0, 0, (n - 0.5) * 0.05)
      return
    }
    // 帆布：细密织纹 + 大块深浅不匀
    out.copy(UFC_CANVAS)
    const weave = hash2(Math.round(P.x * 45), Math.round(P.y * 45))
    const blotch = hash2(Math.round(P.x * 2.2), Math.round(P.y * 2.2))
    out.offsetHSL(0, 0, (weave - 0.5) * 0.03 + (blotch - 0.5) * 0.045)
    const r = Math.hypot(P.x, P.y)
    // 聚光灯打在笼心：由内向外压一档，强化「亮笼子 / 暗场馆」
    out.offsetHSL(0, 0, -0.1 * smoothstep(0.6, UFC_A, r))
    // 中央圆环带（1.10~1.22m）
    const ring =
      smoothstep(1.1, 1.13, r) * (1 - smoothstep(1.19, 1.22, r))
    if (ring > 0) out.lerp(UFC_RING, ring * 0.85)
    // 中央八边形（外接 0.72m）+ 圆心点
    if (octSDF(P.x, P.y, 0.72) < -0.05) out.lerp(UFC_LOGO, 0.6)
    if (r < 0.14) out.offsetHSL(0, 0, 0.1)
  })
  const m = new Mesh(geo, envMaterial())
  m.name = "OctCanvas"
  return m
}

/**
 * 8 面笼网的细杆。
 *
 * 每面网：17 根竖杆（间距 0.206m、截面 22mm）+ 4 道横杆（含顶框）。
 * 竖杆的 box 要绕 Z 转 θ+90°，让长边（BoxGeometry 的 X）贴着该边的走向，
 * 转完再平移到边上的对应位置。
 */
function buildOctFenceGeos(): BufferGeometry[] {
  const out: BufferGeometry[] = []
  for (let k = 0; k < 8; k++) {
    const th = (k + 0.5) * (Math.PI / 4)
    const cx = Math.cos(th) * UFC_A
    const cy = Math.sin(th) * UFC_A
    const dx = -Math.sin(th) // 边的走向（单位向量）
    const dy = Math.cos(th)
    const rot = th + Math.PI / 2
    const N = 16
    for (let i = 0; i <= N; i++) {
      const u = -UFC_E / 2 + (i / N) * UFC_E
      const g = new BoxGeometry(0.022, 0.022, UFC_H)
      g.rotateZ(rot)
      g.translate(cx + dx * u, cy + dy * u, FIELD_Z + UFC_H / 2)
      out.push(g)
    }
    for (const hz of [0.055, 0.55, 1.12, UFC_H]) {
      const g = new BoxGeometry(UFC_E, 0.028, 0.028)
      g.rotateZ(rot)
      g.translate(cx, cy, FIELD_Z + hz)
      out.push(g)
    }
  }
  return out
}

/** 8 根角柱，立在八边形顶点上，比笼网高一点（顶部露出一点柱头） */
function buildOctPostGeos(): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const H = UFC_H + 0.14
  for (let k = 0; k < 8; k++) {
    const th = k * (Math.PI / 4)
    const g = new BoxGeometry(0.115, 0.115, H)
    g.translate(
      Math.cos(th) * UFC_R,
      Math.sin(th) * UFC_R,
      FIELD_Z + H / 2
    )
    out.push(g)
  }
  return out
}

export function buildUfcOctagon(): Group {
  const g = new Group()
  g.name = "UfcOctagon"
  // 场馆顶棚：地平线暗灰蓝 → 天顶近黑。真实 UFC 场馆就是全场暗、只打亮笼内，
  // 顺带让球桌（受光材质）在暗背景上更跳。
  // v1.3.65b：天穹渐变在 **linear 空间**插值（three 的 Color.lerp 语义），
  // 端点色选得不好时整条路径会从渲染器 clearColor 0x292f36=(41,47,54) 的
  // ±3 色盒里穿过去 —— envcheck 的「无空洞」判据（逐通道 |px-clear|>3）就会
  // 把画面顶部那条天空带判成洞，且横屏/竖屏命中 t 段不同、逐屏漂移。
  // 0x143442 经全路径扫描，两端段到 clearColor 色盒的最近余量 10.2 / 18.0。
  g.add(
    buildSkyDome(
      0x363e4a,
      0x143442,
      0x0a0c10,
      FIELD_SKY_R,
      0x101318,
      false,
      [0.012, 0.05]
    )
  )
  g.add(
    buildOuterGround(
      UFC_R,
      UFC_R,
      0x1c2026,
      UFC_HORIZON,
      UFC_SHADE,
      UFC_BAKE_SUN
    )
  )
  g.add(buildOctCanvas())

  const fg = mergePlain(buildOctFenceGeos())
  bakeByPos(fg, UFC_SHADE, UFC_BAKE_SUN, (out) => out.setHex(UFC_FENCE))
  const fm = new Mesh(fg, envMaterial())
  fm.name = "OctFence"
  g.add(fm)

  const stands = buildStands(
    UFC_R,
    UFC_R,
    12, // 看台长边（横屏视野更宽，X 方向铺满）
    10,
    2,
    0.2,
    0.8,
    1.5,
    0x2a2e35,
    [0x22303f]
  )
  const pg = mergePlain(buildOctPostGeos().concat(stands))
  bakeByPos(pg, UFC_SHADE, UFC_BAKE_SUN, (out, P) => {
    const ax = Math.abs(P.x)
    const ay = Math.abs(P.y)
    // 角柱：八边形顶点上，|x|、|y| 都在 UFC_R 以内；看台最近也到 5.4，不会误判
    if (ax < UFC_R + 0.12 && ay < UFC_R + 0.12) {
      out.setHex(UFC_POST)
      return
    }
    // 看台。座椅面在 z=FIELD_Z+0.40 以上，台阶顶面最高只到 +0.40，
    // 取 0.45 把两者分开（第 1 排台阶顶正好 0.40，不会被当成座椅）。
    if (P.z > FIELD_Z + 0.45 && Math.hypot(P.x, P.y) > 5.0) {
      seatStripe(out, ax > ay ? P.y : P.x, [0x22303f, 0x2a2e35])
      return
    }
    out.setHex(0x2a2e35)
  })
  const pm = new Mesh(pg, envMaterial())
  pm.name = "OctProps"
  g.add(pm)
  return g
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
    case "ufc":
      return buildUfcOctagon()
    case "snow":
      return buildSnowMountainV3()
    case "beach":
      return buildBeach()
    case "forest":
      return buildForest()
    case "room":
    case "office":
    case "cybercafe":
      return buildIndoorScene(sceneId)
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
  // v1.3.62c：MeshLambertMaterial → MeshBasicMaterial + toneMapped=false。
  // 顶点色已经算完了光照，不能再接受场景真实光照（否则 2.53 的辐照度
  // 会把 0.5 以上的反照率全部顶到过曝），也不能再走 ACES（0.5 以上
  // 全被压到 194+，动态范围尽失）。
  // v1.3.62d：fog=false，大气透视改为烘进顶点色（见 SNOW_HAZE）。
  const mesh = new Mesh(
    geo,
    new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
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
 */
function mergeColored(geos: BufferGeometry[]): BufferGeometry {
  let total = 0
  for (const g of geos) total += g.attributes.position.count
  const pos = new Float32Array(total * 3)
  const nrm = new Float32Array(total * 3)
  const col = new Float32Array(total * 3)
  let o = 0
  for (const g of geos) {
    const p = g.attributes.position.array as Float32Array
    const n = g.attributes.normal.array as Float32Array
    const c = g.attributes.color.array as Float32Array
    pos.set(p, o * 3)
    nrm.set(n, o * 3)
    col.set(c, o * 3)
    o += g.attributes.position.count
    g.dispose()
  }
  const out = new BufferGeometry()
  out.setAttribute("position", new BufferAttribute(pos, 3))
  out.setAttribute("normal", new BufferAttribute(nrm, 3))
  out.setAttribute("color", new BufferAttribute(col, 3))
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
function bakeVertices(
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
    const nx = nrm.getX(i)
    const ny = nrm.getY(i)
    const nz = nrm.getZ(i)
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
}

/** 环境物体统一材质：顶点色即最终显示色，不吃场景光照也不走色调映射 */
function envMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    fog: false,
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
const BEACH_C_WET = new Color(0xa8875a) // 湿沙/谷底：深
const BEACH_C_DRY = new Color(0xdfc79a) // 干沙/丘顶：亮
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
    out.copy(BEACH_C_WET).lerp(BEACH_C_DRY, smoothstep(0.12, 0.88, hT))
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
  const cNear = new Color(0x3fb3ad) // 近岸浅绿松石
  const cFar = new Color(0x11608f) // 远海深蓝
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
      0.06 * Math.sin(r * 1.7 + ang * 2.3) +
      0.04 * Math.sin(r * 4.1 - ang * 5)
    let dr = SRGBToDisplay(tmp.r) * (AMB[0] + SUN[0] * ndc) * ripple
    let dg = SRGBToDisplay(tmp.g) * (AMB[1] + SUN[1] * ndc) * ripple
    let db = SRGBToDisplay(tmp.b) * (AMB[2] + SUN[2] * ndc) * ripple
    // 岸边碎浪白线
    const surf = 1 - smoothstep(0, 1.8, r - (BEACH_TERRAIN.SHORE - 2))
    if (surf > 0) {
      const s = surf * 0.5
      dr += (SRGBToDisplay(cFoam.r) - dr) * s
      dg += (SRGBToDisplay(cFoam.g) - dg) * s
      db += (SRGBToDisplay(cFoam.b) - db) * s
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
    new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
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
 */
function buildBeachRocks(): Group {
  const g = new Group()
  g.name = "BeachRocks"
  const rng = makeSeededRng(4211)
  const cLo = new Color(0x5c5347)
  const cHi = new Color(0x8d8375)
  const tmp = new Color()
  const { AMB, SUN, GAMMA } = BEACH_SHADE
  // 礁石用固定的斜上方光照，配合低多边形面产生块面感
  const L = [0.681, -0.454, 0.574]
  for (let i = 0; i < 14; i++) {
    const ang = rng() * Math.PI * 2
    const r = 2.6 + rng() * 6.4
    const s = 0.18 + rng() * 0.3
    const geo = new IcosahedronGeometry(s, 0)
    const pos = geo.attributes.position
    for (let v = 0; v < pos.count; v++) {
      // 低多边形石头：顶点随机抖动
      pos.setXYZ(
        v,
        pos.getX(v) * (0.75 + rng() * 0.5),
        pos.getY(v) * (0.75 + rng() * 0.5),
        pos.getZ(v) * (0.5 + rng() * 0.6)
      )
    }
    geo.computeVertexNormals()
    const nrm = geo.attributes.normal
    const colors = new Float32Array(pos.count * 3)
    for (let v = 0; v < pos.count; v++) {
      const nx = nrm.getX(v)
      const ny = nrm.getY(v)
      const nz = nrm.getZ(v)
      tmp.copy(cLo).lerp(cHi, smoothstep(-0.2, 0.8, nz))
      const nd = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
      const ndc = Math.pow(nd, GAMMA)
      let dr = SRGBToDisplay(tmp.r)
      let dg = SRGBToDisplay(tmp.g)
      let db = SRGBToDisplay(tmp.b)
      const haze =
        BEACH_HAZE.MAX * smoothstep(BEACH_HAZE.START, BEACH_HAZE.END, r)
      dr += (BEACH_HAZE.COLOR[0] - dr) * haze
      dg += (BEACH_HAZE.COLOR[1] - dg) * haze
      db += (BEACH_HAZE.COLOR[2] - db) * haze
      tmp.setRGB(
        Math.min(1, dr * (AMB[0] + SUN[0] * ndc)),
        Math.min(1, dg * (AMB[1] + SUN[1] * ndc)),
        Math.min(1, db * (AMB[2] + SUN[2] * ndc)),
        SRGBColorSpace
      )
      colors[v * 3] = tmp.r
      colors[v * 3 + 1] = tmp.g
      colors[v * 3 + 2] = tmp.b
    }
    geo.setAttribute("color", new BufferAttribute(colors, 3))
    const m = new Mesh(
      geo,
      new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
    )
    m.position.set(
      Math.cos(ang) * r,
      Math.sin(ang) * r,
      beachFloorZ(r) - s * 0.25
    )
    m.rotation.z = rng() * Math.PI * 2
    g.add(m)
  }
  return g
}

/**
 * 椰树干（柱廊）。
 *
 * **不做树冠** —— 这是相机几何决定的，不是偷懒：aim 可见窗口
 * z ∈ [0.295 − 0.087·d, 0.295 + 0.0354·d]，d=20m 处只能看到 1.0m 高，
 * d=60m 处才 2.4m。真实椰树 5~8m，树冠要到 d≈282m 才进画 —— 做了
 * 90% 的顶点永不入画。所以只做树干：aim 下看到的就是一片椰林柱廊，
 * 竖屏（fov 50.19，顶边 +8.77°）还能多看到一截。
 */
function buildBeachPalms(): Group {
  const g = new Group()
  g.name = "BeachPalms"
  const rng = makeSeededRng(9042)
  const cLo = new Color(0x6b5334)
  const cHi = new Color(0xa8875a)
  const tmp = new Color()
  const { AMB, SUN, GAMMA } = BEACH_SHADE
  const L = [0.681, -0.454, 0.574]
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + rng() * 0.25
    const r = 4.5 + rng() * 24
    const h = 3.2 + rng() * 1.6
    const rad = 0.075 + rng() * 0.045
    const geo = new CylinderGeometry(rad * 0.72, rad, h, 7, 1)
    const pos = geo.attributes.position
    // 让树干略微弯曲（顶端偏移），破掉「电线杆」感
    const leanX = (rng() - 0.5) * 0.5
    const leanY = (rng() - 0.5) * 0.5
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getZ(v) + h / 2) / h // 0 = 根部, 1 = 顶端
      const bend = t * t
      pos.setXYZ(
        v,
        pos.getX(v) + leanX * bend,
        pos.getY(v) + leanY * bend,
        pos.getZ(v)
      )
    }
    geo.computeVertexNormals()
    const nrm = geo.attributes.normal
    const colors = new Float32Array(pos.count * 3)
    for (let v = 0; v < pos.count; v++) {
      const nx = nrm.getX(v)
      const ny = nrm.getY(v)
      const nz = nrm.getZ(v)
      // 椰树干的环纹：按高度做深浅条纹
      const t = (pos.getZ(v) + h / 2) / h
      const band = 0.5 + 0.5 * Math.sin(t * 34)
      tmp.copy(cLo).lerp(cHi, band * 0.6 + 0.2)
      const nd = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
      const ndc = Math.pow(nd, GAMMA)
      let dr = SRGBToDisplay(tmp.r)
      let dg = SRGBToDisplay(tmp.g)
      let db = SRGBToDisplay(tmp.b)
      const haze =
        BEACH_HAZE.MAX * smoothstep(BEACH_HAZE.START, BEACH_HAZE.END, r)
      dr += (BEACH_HAZE.COLOR[0] - dr) * haze
      dg += (BEACH_HAZE.COLOR[1] - dg) * haze
      db += (BEACH_HAZE.COLOR[2] - db) * haze
      tmp.setRGB(
        Math.min(1, dr * (AMB[0] + SUN[0] * ndc)),
        Math.min(1, dg * (AMB[1] + SUN[1] * ndc)),
        Math.min(1, db * (AMB[2] + SUN[2] * ndc)),
        SRGBColorSpace
      )
      colors[v * 3] = tmp.r
      colors[v * 3 + 1] = tmp.g
      colors[v * 3 + 2] = tmp.b
    }
    geo.setAttribute("color", new BufferAttribute(colors, 3))
    geo.rotateX(Math.PI / 2) // CylinderGeometry 沿 Y 轴 → 转到 Z-up
    const m = new Mesh(
      geo,
      new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
    )
    m.position.set(
      Math.cos(ang) * r,
      Math.sin(ang) * r,
      beachFloorZ(r) + h / 2 - 0.05
    )
    g.add(m)
  }
  return g
}

export function buildBeach(): Group {
  const g = new Group()
  g.name = "Beach"
  g.add(
    buildSkyDome(
      BEACH_HORIZON_HEX, // 地平线：淡蓝白（海天一色）
      0x7cc4e8, // 中段浅蓝
      0x2f8fd0, // 天顶湛蓝
      110,
      BEACH_HORIZON_HEX, // 下半球与 haze 同色 → 海面外缘无缝
      false, // toneMapped=false：跳过 ACES，保住饱和度
      [0.012, 0.05]
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
  for (const b of bands) g.add(buildTerrainBand(b, BEACH_STYLE))
  g.add(buildBeachSea())
  g.add(buildBeachRocks())
  g.add(buildBeachPalms())
  return g
}

// ══════════════════════════════════════════════════════════════════════
// 原始森林（v1.3.63 步 4）
//
// 设计完全由相机几何决定（见文件顶部实测表）：
//   - aim 可见窗口 z ∈ [0.295 − 0.087·d, 0.295 + 0.0354·d]，
//     d=20m 处只能看到 1.0m 高、d=60m 处才 2.4m。
//   - 真实树高 10m 的树冠要 d ≥ 282m 才进画 —— **所以不做树冠**，
//     做了 90% 的顶点永不入画，纯浪费。
// 于是森林 = 起伏林地 + 树干柱廊 + 强绿雾。竖屏 fov 50.19（顶边 +8.77°）
// 能比横屏多看到一截树干，正好强化「林中」的包围感。
// ══════════════════════════════════════════════════════════════════════

const FOREST_TERRAIN = {
  /** 球桌所在的林间空地半径 */
  R0: 4.0,
  /** 地面缓降斜率：林地比雪山平得多（0.082 → 0.03） */
  FLOOR_SLOPE: 0.03,
  /** 起伏振幅：树根隆起与小土丘，量级只有雪山的 1/4 */
  AMP_K: 0.03,
  RAMP0: 4.2,
  RAMP1: 16,
  /** 地形外缘 */
  OUTER: 70,
  SKIN: 0.012,
}

const FOREST_NOISE = {
  /** 特征尺度约 9m —— 介于雪山的 17m 与沙滩的 7m 之间 */
  K: 0.11,
  OCT: 4,
  DET_F: 3.4,
  DET_OCT: 3,
  /** 落叶/苔藓的细碎质感 */
  MICRO_F: 8.5,
  MICRO_OCT: 3,
  MICRO_AMP: 0.022,
  AZ_SCALE: 1.4,
  AZ_OCT: 3,
  AZ_LO: 0.3,
  AZ_HI: 0.7,
  AZ_MIN: 0.45,
  AZ_SPAN: 0.9,
  AZ_DRIFT: 0.008,
}

/**
 * 林下光照：树冠滤过的漫射光，几乎没有直射。
 * 环境光压到 0.26（比沙滩 0.42 低得多）、太阳 0.5、GAMMA 1.15 ——
 * 林下本就阴暗，压暗才能出「原始森林」的幽深感。
 */
const FOREST_SHADE = {
  AMB: [0.26, 0.30, 0.27],
  SUN: [0.52, 0.55, 0.42],
  GAMMA: 1.15,
}

/** 假想太阳：仰角 30°（林间斜射光斑），方位与场景平行光一致 */
const FOREST_BAKE_SUN = [0.748, -0.499, 0.5]

/** 天穹：树冠间隙透出的光 —— 地平线雾绿、天顶深绿 */
const FOREST_HORIZON_HEX = 0xa8bd8a
const FOREST_MID_HEX = 0x74a06a
const FOREST_ZENITH_HEX = 0x2f5a4a
/**
 * 0xa8bd8a 的显示空间分量。
 *
 * 地平线偏「黄绿」、天顶偏「青绿」是刻意的：全绿系会让画面顶部只有
 * 一两个色相桶，看起来就是一堵没有层次的绿墙。拉开 45° 的色相差后
 * 竖屏（顶边 +8.77°，能看到更多天空）才有「林隙透光」的层次。
 */
const FOREST_HAZE_COLOR = [0.659, 0.741, 0.541]

/**
 * 强绿雾：START 18 / END 62 / MAX 1.0。
 *
 * MAX 必须到 1.0 —— 森林地面很平（FLOOR_SLOPE 0.03），地形外缘 r=70 处
 * 的高度只降到 −2.2m，仍在 aim 可见窗口内，雾不到满值就会露出「世界
 * 尽头」的硬边。把 END 压在 62（早于 OUTER 70）让最后 8m 全是纯雾色，
 * 与天穹下半球严丝合缝。
 *
 * 近景 18m 内完全不加雾，保住林地的明暗层次。
 */
const FOREST_HAZE = {
  START: 18,
  END: 62,
  MAX: 1.0,
  COLOR: FOREST_HAZE_COLOR,
}

function forestFloorZ(r: number): number {
  const base = GROUND_Z - FOREST_TERRAIN.SKIN
  return r <= FOREST_TERRAIN.R0
    ? base
    : base - FOREST_TERRAIN.FLOOR_SLOPE * (r - FOREST_TERRAIN.R0)
}

function forestAmpAt(r: number, ang: number, nC: Noise2D): number {
  const k = FOREST_TERRAIN.AMP_K
  const grow = smoothstep(FOREST_TERRAIN.RAMP0, FOREST_TERRAIN.RAMP1, r)
  const u = Math.cos(ang) * FOREST_NOISE.AZ_SCALE + r * FOREST_NOISE.AZ_DRIFT + 55.3
  const v = Math.sin(ang) * FOREST_NOISE.AZ_SCALE - r * FOREST_NOISE.AZ_DRIFT * 0.7 + 12.8
  const n = fbm2D(nC, u, v, FOREST_NOISE.AZ_OCT)
  const mask =
    FOREST_NOISE.AZ_MIN +
    FOREST_NOISE.AZ_SPAN *
      smoothstep(FOREST_NOISE.AZ_LO, FOREST_NOISE.AZ_HI, n)
  return k * r * grow * mask
}

function forestTerrainZ(
  r: number,
  ang: number,
  nA: Noise2D,
  nB: Noise2D,
  nC: Noise2D
): number {
  const k = FOREST_NOISE.K
  const u = Math.cos(ang) * r * k + 61.4
  const v = Math.sin(ang) * r * k + 7.2
  // 圆润起伏（不用 ridged）：林地是缓坡土丘，不是山脊
  const f = fbm2D(nA, u, v, FOREST_NOISE.OCT)
  const det = fbm2D(nB, u * FOREST_NOISE.DET_F, v * FOREST_NOISE.DET_F, FOREST_NOISE.DET_OCT)
  const h = Math.min(1, Math.max(0, f * 0.7 + det * 0.3))
  const micro =
    (fbm2D(nB, u * FOREST_NOISE.MICRO_F + 4.4, v * FOREST_NOISE.MICRO_F + 1.9, FOREST_NOISE.MICRO_OCT) -
      0.5) *
    FOREST_NOISE.MICRO_AMP *
    h
  return forestFloorZ(r) + forestAmpAt(r, ang, nC) * h + micro
}

// 林地调色板
const FOREST_C_MOSS = new Color(0x4a6b3a) // 苔藓（丘顶/干燥）
const FOREST_C_SOIL = new Color(0x3a2c1e) // 腐殖土（谷底/阴湿）
const FOREST_C_LEAF = new Color(0x6b5330) // 落叶

const FOREST_STYLE: TerrainStyle = {
  floorZ: forestFloorZ,
  ampAt: forestAmpAt,
  heightZ: forestTerrainZ,
  shade: FOREST_SHADE,
  bakeSun: FOREST_BAKE_SUN,
  haze: FOREST_HAZE,
  hazeAfterShade: true,
  ampFloor: 0.02,
  hTFallback: 0.6,
  name: "ForestTerrain",
  albedo(out, ctx) {
    const { hT } = ctx
    // 谷底腐殖土 → 丘顶苔藓，中间过渡带混落叶
    out.copy(FOREST_C_SOIL).lerp(FOREST_C_MOSS, smoothstep(0.1, 0.9, hT))
    const leaf = 1 - Math.abs(hT - 0.45) / 0.45
    if (leaf > 0) out.lerp(FOREST_C_LEAF, Math.max(0, leaf) * 0.35)
  },
}

/**
 * 树干柱廊（合并成单个 Mesh）。
 *
 * 只在 r ≥ 3.6 布点：俯视相机视野半径只有 0.94m~1.68m，球桌之外基本
 * 看不见东西，所以柱子不会遮挡俯视；aim 视角水平半角 18.37°，d > 11m
 * 起才看得见 r=3.6 的柱子，正好构成中景柱廊。
 *
 * 树高给到 5~9m（真实高度），但入画的永远只有最下面那一截 —— 竖屏
 * fov 50.19 能多看到 1~2m，横屏则更少。这点「看不到」正是纵深感来源。
 */
function buildForestTrunks(): Mesh {
  const rng = makeSeededRng(6607)
  const geos: BufferGeometry[] = []
  const cBarkLo = new Color(0x3d2f20)
  const cBarkHi = new Color(0x6b5a3e)
  const cMossy = new Color(0x55663f)
  const tmp = new Color()
  const COUNT = 150

  for (let i = 0; i < COUNT; i++) {
    // 平方根分布：近处稀疏、远处密集，避免近处柱子糊成一片
    const t = (i + rng() * 0.8) / COUNT
    const r = 3.6 + Math.sqrt(t) * (FOREST_TERRAIN.OUTER - 6)
    const ang = rng() * Math.PI * 2
    const h = 5 + rng() * 4
    const rad = 0.09 + rng() * 0.13
    const g = new CylinderGeometry(rad * 0.7, rad, h, 6, 1)
    // 弯曲：顶端偏移，破掉「电线杆」感
    const leanX = (rng() - 0.5) * 0.7
    const leanY = (rng() - 0.5) * 0.7
    const pos = g.attributes.position
    for (let v = 0; v < pos.count; v++) {
      const tv = (pos.getZ(v) + h / 2) / h
      const bend = tv * tv
      pos.setXYZ(
        v,
        pos.getX(v) + leanX * bend,
        pos.getY(v) + leanY * bend,
        pos.getZ(v)
      )
    }
    g.rotateX(Math.PI / 2) // CylinderGeometry 沿 Y 轴 → 转到 Z-up
    const cx = Math.cos(ang) * r
    const cy = Math.sin(ang) * r
    const zRoot = forestFloorZ(r) - 0.1
    g.translate(cx, cy, zRoot + h / 2)

    // 每棵树的色调：苔藓覆盖程度不同
    const mossy = rng()
    bakeVertices(
      g,
      FOREST_SHADE,
      FOREST_BAKE_SUN,
      (out, nz, i) => {
        // 相对高度：0 = 根部，1 = 顶端
        const t = Math.min(
          1,
          Math.max(0, (g.attributes.position.getZ(i) - zRoot) / h)
        )
        tmp.copy(cBarkLo).lerp(cBarkHi, 0.3 + 0.5 * Math.max(0, nz))
        if (mossy > 0.45) tmp.lerp(cMossy, (mossy - 0.45) * 1.2)
        // 根部更暗：林下根部几乎受不到光（虽然只有最下面一截入画）
        tmp.multiplyScalar(0.7 + 0.3 * t)
        out.copy(tmp)
      },
      (rgb) => {
        const haze =
          FOREST_HAZE.MAX *
          smoothstep(FOREST_HAZE.START, FOREST_HAZE.END, r)
        rgb[0] += (FOREST_HAZE.COLOR[0] - rgb[0]) * haze
        rgb[1] += (FOREST_HAZE.COLOR[1] - rgb[1]) * haze
        rgb[2] += (FOREST_HAZE.COLOR[2] - rgb[2]) * haze
      }
    )
    geos.push(g)
  }

  const merged = mergeColored(geos)
  const mesh = new Mesh(merged, envMaterial())
  mesh.name = "ForestTrunks"
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

export function buildForest(): Group {
  const g = new Group()
  g.name = "Forest"
  g.add(
    buildSkyDome(
      FOREST_HORIZON_HEX, // 地平线：林间雾绿（偏黄）
      FOREST_MID_HEX, // 中段
      FOREST_ZENITH_HEX, // 天顶：树冠青绿
      100,
      FOREST_HORIZON_HEX, // 下半球与 haze 同色 → 地形外缘无缝
      false,
      [0.02, 0.09]
    )
  )
  const bands: TerrainBand[] = [
    {
      innerR: 0.3, outerR: 6, thetaSegs: 224, phiSegs: 18,
      seedA: 313, seedB: 877, seedC: 149,
    },
    {
      innerR: 6, outerR: 24, thetaSegs: 224, phiSegs: 24,
      seedA: 313, seedB: 877, seedC: 149,
    },
    {
      innerR: 24, outerR: FOREST_TERRAIN.OUTER, thetaSegs: 224, phiSegs: 22,
      seedA: 313, seedB: 877, seedC: 149,
    },
  ]
  for (const b of bands) g.add(buildTerrainBand(b, FOREST_STYLE))
  g.add(buildForestTrunks())
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
 * 道具禁区。瞄准相机绕球公转，最远能到 |x|≈1.408+0.786=2.19、
 * |y|≈0.688+0.786=1.47 —— 留到 2.2/1.75 保证道具永远不会挡在相机与球之间。
 */
const KEEPOUT_X = 2.2
const KEEPOUT_Y = 1.75

interface IndoorLamp {
  pos: number[]
  /** 距离 ≤ near 全亮，≥ far 只剩 floor —— 模拟吊灯的光池衰减 */
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

/** 取 hex 的 sRGB 0~1 分量（自发光要直接写**显示空间**数值，不能用线性值） */
function hexRGB(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

/**
 * 给一个几何体烘焙室内光照。
 *
 * 与户外地形的 `bakeVertices` 同一套显示空间模型（out = albedo × 光照），
 * 区别只有两点：
 *   1. 光源是**吊灯点光**而非平行光 —— 平行光打在水平地面上处处一样亮，
 *      室内会平得像一张贴图；点光才能形成「桌边亮、墙根暗」的光池。
 *   2. 多一项地面反弹光，家具下沿不至于死黑。
 */
function bakeIndoor(
  geo: BufferGeometry,
  pal: IndoorPalette,
  albedo: (out: Color, p: Vector3, i: number) => void,
  post?: (rgb: number[], p: Vector3, i: number) => void
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
    const nx = nrm.getX(i)
    const ny = nrm.getY(i)
    const nz = nrm.getZ(i)
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

/** 压扁的球（盆栽叶簇、坐垫这类有机体块） */
function blobGeo(r: number, sy: number, sz: number, seg = 8): BufferGeometry {
  const g = new SphereGeometry(r, seg, Math.max(4, seg - 2))
  g.scale(1, sy, sz)
  return g
}

/**
 * 道具收集器：把一堆小几何体烘好顶点色后合并成**一个** Mesh。
 *
 * 网咖场景有上百个零件（桌腿 / 机箱 / 椅子五爪），每个一个 Mesh 就是上百个
 * draw call，移动端帧率直接崩。合并后只剩一次 draw call，顶点色还完全可控。
 */
class Props {
  private geos: BufferGeometry[] = []
  constructor(private pal: IndoorPalette) {}

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
      post ? (rgb, p, _i) => post(rgb, p) : undefined
    )
    const ni = g.index ? g.toNonIndexed() : g
    if (ni !== g) g.dispose()
    this.geos.push(ni)
    return this
  }

  mesh(name: string): Mesh {
    const m = new Mesh(mergeColored(this.geos), envMaterial())
    m.name = name
    m.castShadow = false
    m.receiveShadow = false
    return m
  }
}

/** 自发光：直接把显示空间 rgb 顶成指定颜色（灯带、机箱侧透、屏幕） */
function emissive(hex: number, k = 1) {
  const [r, g, b] = hexRGB(hex)
  return (rgb: number[]) => {
    rgb[0] = r * k
    rgb[1] = g * k
    rgb[2] = b * k
  }
}

/** 按权重混入自发光（做灯带的软辉光，而不是硬边贴片） */
function emissiveMix(hex: number, w: number) {
  const [r, g, b] = hexRGB(hex)
  return (rgb: number[]) => {
    rgb[0] += (r - rgb[0]) * w
    rgb[1] += (g - rgb[1]) * w
    rgb[2] += (b - rgb[2]) * w
  }
}

/**
 * 地板：一张细分平面 + 顶点色拼花。
 *
 * 不用贴图是有原因的 —— 环境物体统一走 MeshBasicMaterial + vertexColors +
 * toneMapped:false，光照已经烘进顶点色；贴图要在**线性空间**与光照相乘，
 * 和这套显示空间模型对不上（实测同亮度会差 40%）。拼花靠顶点插值出来反而
 * 更抗锯齿：瞄准视角下地面是极端掠射，远处一行像素跨好几块地砖，贴图必然
 * 摩尔纹，顶点插值只是渐变成一片中间色。
 */
function buildIndoorFloor(pal: IndoorPalette): Mesh {
  const geo = new PlaneGeometry(ROOM_HX * 2, ROOM_HY * 2, 150, 100)
  // PlaneGeometry 默认就在 XY 平面、法线 +Z —— Z-up 世界里这正是地板，无需旋转
  geo.translate(0, 0, ROOM_FLOOR_Z)
  bakeIndoor(geo, pal, (out, P) =>
    pal.floor(out, P.x, P.y, Math.sqrt(P.x * P.x + P.y * P.y))
  )
  const m = new Mesh(geo, envMaterial())
  m.name = "IndoorFloor"
  return m
}

/**
 * 四面墙 + 踢脚线。
 *
 * 只把竖向 26 段里的一半压在 0.5m 以下（真正入画的地方），更高的部分
 * 在两种相机下都不入画，细分纯属浪费。
 */
function buildIndoorWalls(pal: IndoorPalette): Mesh {
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
    bakeIndoor(g, pal, (out, P) =>
      pal.wall(out, P.z - ROOM_FLOOR_Z, w.onX ? P.y : P.x, w.onX)
    )
    const ni = g.index ? g.toNonIndexed() : g
    if (ni !== g) g.dispose()
    geos.push(ni)
  }
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
  const m = new Mesh(geo, envMaterial())
  m.name = "Ceiling"
  g.add(m)
  return g
}

/**
 * 五爪转椅底座：低视角下最出戏的零件（气压柱 + 五个爪）。
 *
 * 不做脚轮 —— 每个轮子直径 5cm，在 3m 外只占半个像素，但一个 CylinderGeometry
 * 就是 96 个顶点；18 把椅子 × 5 个轮子 = 8640 个顶点，占了网咖总面数的两成，
 * 把构建时间顶到 106ms。省掉它们，椅子在画面里完全看不出区别。
 */
function addChair(
  p: Props,
  x: number,
  y: number,
  rotZ: number,
  seatHex: number,
  baseHex: number
): void {
  for (let i = 0; i < 5; i++) {
    const a = rotZ + (i / 5) * Math.PI * 2
    p.add(boxGeo(0.30, 0.055, 0.028), x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, 0.012, a, baseHex)
  }
  p.add(cylGeo(0.032, 0.044, 0.44, 8), x, y, 0.012, 0, 0x3a3f47)
  p.add(boxGeo(0.50, 0.50, 0.10), x, y, 0.45, rotZ, seatHex)
}

/** 盆栽：陶盆 + 土 + 七簇压扁的叶球（整体 0.7m 高，正好在可见窗口里） */
function addPlant(
  p: Props,
  x: number,
  y: number,
  potHex: number,
  leafHex: number,
  s = 1
): void {
  p.add(cylGeo(0.17 * s, 0.13 * s, 0.30 * s, 12), x, y, 0, 0, potHex)
  p.add(cylGeo(0.158 * s, 0.158 * s, 0.03 * s, 12), x, y, 0.30 * s, 0, 0x2e2118)
  const rng = makeSeededRng(1000 + Math.round((x * 13.7 + y * 7.3) * 100))
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng() * 0.6
    const rr = (0.05 + rng() * 0.10) * s
    const h = (0.40 + rng() * 0.28) * s
    const dl = (rng() - 0.5) * 0.12
    p.add(
      blobGeo(0.15 * s, 0.9, 1.5),
      x + Math.cos(a) * rr,
      y + Math.sin(a) * rr,
      0.30 * s + h * 0.42,
      a,
      (out: Color) => out.setHex(leafHex).offsetHSL(0, 0, dl)
    )
  }
}

// ───────────────────────── room：居家台球房 ─────────────────────────

const RM_OAK_A = new Color(0xba8c57)
const RM_OAK_B = new Color(0x95693d)
const RM_SEAM = new Color(0x4a3520)
const RM_RUG = new Color(0x8d4038)
const RM_RUG_D = new Color(0x6d2f2b)
const RM_RUG_EDGE = new Color(0xd6c39c)

/** 长条木地板：板宽 0.24、板长 1.15、隔行错缝；中央再压一块暗红地毯 */
function roomFloor(out: Color, x: number, y: number, r: number): void {
  const PW = 0.24
  const PL = 1.15
  const row = Math.floor(y / PW)
  const sx = x + row * PL * 0.37 // 错缝
  const col = Math.floor(sx / PL)
  const fy = y / PW - row
  const fx = sx / PL - col
  const h = hash2(col, row)
  out.copy(RM_OAK_A).lerp(RM_OAK_B, h)
  // 木纹：沿板长的高频条纹 + 低频色差
  const grain = 0.5 + 0.5 * Math.sin(sx * 47 + h * 31.4)
  out.offsetHSL(0, 0, (grain - 0.5) * 0.045 + (h - 0.5) * 0.05)
  // 板缝：靠近边界压暗（顶点插值出来是柔和暗线，不会摩尔纹）
  const seam = Math.min(Math.min(fx, 1 - fx) * PL, Math.min(fy, 1 - fy) * PW)
  out.lerp(RM_SEAM, (1 - smoothstep(0, 0.016, seam)) * 0.75)
  // 地毯（椭圆，长轴沿 X）：球桌四周那一圈，俯视下唯一能看清的软装
  const e = Math.sqrt((x / 3.55) * (x / 3.55) + (y / 2.55) * (y / 2.55))
  if (e < 1) {
    const dia = 0.5 + 0.5 * Math.sin((x + y) * 7.5)
    out.copy(RM_RUG).lerp(RM_RUG_D, dia * 0.35)
    if (e > 0.9) out.lerp(RM_RUG_EDGE, smoothstep(0.9, 0.93, e))
    out.offsetHSL(0, 0, (hash2(Math.round(x * 26), Math.round(y * 26)) - 0.5) * 0.05)
  }
  // 掠射抗摩尔：远处拼花淡出成一片中间色
  out.lerp(RM_OAK_B, smoothstep(4.5, 9.0, r) * 0.65)
}

const RM_SKIRT = new Color(0xf1ebe0)
const RM_WAINSCOT = new Color(0x6d4a2e)
const RM_BEAD = new Color(0x4e3520)
const RM_RAIL = new Color(0x8a5f3c)
const RM_UPPER = new Color(0xe4dac9)

/** 踢脚线 + 木墙裙 + 米白涂料（只有下沿 0.5m 入画，细节都压在这里） */
function roomWall(out: Color, s: number, u: number): void {
  if (s < 0.11) {
    out.copy(RM_SKIRT)
    if (s > 0.095) out.lerp(RM_BEAD, 0.4)
    return
  }
  if (s < 0.98) {
    out.copy(RM_WAINSCOT)
    // 竖向企口板：每 0.16m 一道凹线
    const t = Math.abs(((u / 0.16) % 1) - 0.5) * 2
    out.lerp(RM_BEAD, (1 - smoothstep(0.55, 0.95, t)) * 0.55)
    out.offsetHSL(0, 0, (hash2(Math.round(u * 9), Math.round(s * 22)) - 0.5) * 0.06)
    if (s > 0.9) out.lerp(RM_RAIL, smoothstep(0.9, 0.95, s)) // 顶部压条
    return
  }
  out.copy(RM_UPPER)
  out.offsetHSL(0, 0, (hash2(Math.round(u * 5), Math.round(s * 5)) - 0.5) * 0.035)
}

const ROOM_PAL: IndoorPalette = {
  name: "Room",
  AMB: [0.30, 0.285, 0.255],
  SUN: [0.88, 0.82, 0.71],
  GAMMA: 1.25,
  lamps: [{ pos: [0, 0, 2.32], near: 1.5, far: 10.5, floor: 0.30 }],
  bounce: [0.10, 0.088, 0.075],
  haze: { color: [0.30, 0.25, 0.21], start: 3.5, end: 10.5, max: 0.34 },
  floor: roomFloor,
  wall: roomWall,
  ceil: (out) => out.setHex(0xdad3c6),
}

function buildRoom(): Group {
  const g = new Group()
  g.name = "Room"
  g.add(buildIndoorFloor(ROOM_PAL))
  g.add(buildIndoorWalls(ROOM_PAL))
  g.add(buildIndoorCeiling(ROOM_PAL))
  const p = new Props(ROOM_PAL)

  // 沙发（贴 +Y 墙）
  p.add(boxGeo(2.30, 0.92, 0.42), 0, 3.32, 0, 0, 0x54626f)
  p.add(boxGeo(2.30, 0.24, 0.56), 0, 3.78, 0.42, 0, 0x4b5866)
  p.add(boxGeo(0.24, 0.92, 0.62), -1.03, 3.32, 0, 0, 0x5c6a78)
  p.add(boxGeo(0.24, 0.92, 0.62), 1.03, 3.32, 0, 0, 0x5c6a78)
  p.add(blobGeo(0.20, 0.62, 0.55), -0.52, 3.10, 0.50, 0.3, 0xb2705a)
  p.add(blobGeo(0.20, 0.62, 0.55), 0.52, 3.10, 0.50, -0.3, 0x9c8a6a)

  // 电视柜 + 电视（贴 −Y 墙）。屏幕给一点冷色自发光，画面右下角有个亮点
  p.add(boxGeo(2.40, 0.46, 0.50), 0, -3.48, 0, 0, 0x5b3d28)
  p.add(boxGeo(1.50, 0.06, 0.86), 0, -3.50, 0.50, 0, 0x171a1e)
  p.add(boxGeo(1.34, 0.012, 0.72), 0, -3.442, 0.55, 0, 0x2b3a44, emissiveMix(0x4d7a92, 0.5))

  // 书架（贴 −X 墙），只摆下面两层书 —— 更高的层不入画
  p.add(boxGeo(0.36, 3.20, 1.85), -5.70, 0, 0, 0, 0x4a3a2a)
  for (let i = 0; i < 4; i++) {
    p.add(boxGeo(0.34, 3.10, 0.035), -5.70, 0, 0.34 + i * 0.44, 0, 0x5e4a34)
  }
  {
    const rng = makeSeededRng(2024)
    for (let s = 0; s < 2; s++) {
      let bx = -1.45
      while (bx < 1.45) {
        const w = 0.035 + rng() * 0.05
        const h = 0.24 + rng() * 0.10
        const c = [0x8c4a3c, 0x3f5d52, 0x6b5a2e, 0x7a4a68, 0x4a4f58][
          Math.floor(rng() * 5)
        ]
        p.add(boxGeo(w, 0.24, h), -5.70, bx + w / 2, 0.375 + s * 0.44, 0, c)
        bx += w + 0.004
      }
    }
  }

  // 落地灯：只做灯杆与底座（灯罩在 1.4m 处不入画）
  p.add(cylGeo(0.17, 0.20, 0.035, 14), -3.20, 2.90, 0, 0, 0x3c3a36)
  p.add(cylGeo(0.022, 0.022, 1.50, 8), -3.20, 2.90, 0.035, 0, 0x6b6257)

  // 茶几
  p.add(boxGeo(0.95, 0.60, 0.06), 2.85, -2.45, 0.40, 0, 0x8a6440)
  for (const sx of [-0.42, 0.42])
    for (const sy of [-0.24, 0.24])
      p.add(boxGeo(0.05, 0.05, 0.40), 2.85 + sx, -2.45 + sy, 0, 0, 0x6f4d30)

  // 球杆架（贴 +X 墙）：杆子 1.34m 立着，只有下截入画
  p.add(boxGeo(0.34, 1.10, 0.06), 5.20, -1.20, 0, 0, 0x6b4a2e)
  p.add(boxGeo(0.05, 0.05, 1.02), 5.06, -1.70, 0.06, 0, 0x5a3d24)
  p.add(boxGeo(0.05, 0.05, 1.02), 5.06, -0.70, 0.06, 0, 0x5a3d24)
  p.add(boxGeo(0.30, 1.10, 0.05), 5.20, -1.20, 1.08, 0, 0x7a5636)
  {
    const rng = makeSeededRng(778)
    for (let i = 0; i < 7; i++) {
      const yy = -1.62 + (i / 6) * 0.84
      const jx = 5.06 + (rng() - 0.5) * 0.02
      const dl = (rng() - 0.5) * 0.09
      p.add(cylGeo(0.008, 0.016, 1.34, 6), jx, yy, 0.11, 0, (out: Color) =>
        out.setHex(0xc09153).offsetHSL(0, 0, dl)
      )
      p.add(cylGeo(0.016, 0.018, 0.44, 6), jx, yy, 0.11, 0, 0x33241a)
    }
  }

  // 盆栽 ×3
  addPlant(p, 3.10, -3.00, 0x8a5a44, 0x2f6b3a)
  addPlant(p, -3.40, -3.05, 0x7d5a4a, 0x3f8a4a, 0.85)
  addPlant(p, 4.60, 2.40, 0x8a5a44, 0x356f42, 1.1)

  g.add(p.mesh("RoomProps"))
  return g
}

// ───────────────────────── office：开放式办公室 ─────────────────────────

const OF_CARPET = new Color(0x59636f)
const OF_CARPET_L = new Color(0x6d7784)
const OF_GROUT = new Color(0x3d444d)

/**
 * 方块地毯 0.60m + 一圈浅色走道。
 *
 * 走道（r∈[2.2,3.4] 的环带）不只是装饰：地面是画面里面积最大的面，纯色
 * 地毯在掠射下会糊成一片，加一条大尺度环带才能看出纵深。
 */
function officeFloor(out: Color, x: number, y: number, r: number): void {
  const T = 0.6
  const fx = x / T - Math.floor(x / T)
  const fy = y / T - Math.floor(y / T)
  const i = Math.floor(x / T)
  const j = Math.floor(y / T)
  out.copy(OF_CARPET)
  out.offsetHSL(0, 0, (hash2(i, j) - 0.5) * 0.07)
  // 走道环带
  out.lerp(OF_CARPET_L, smoothstep(2.0, 2.5, r) * (1 - smoothstep(3.3, 3.8, r)))
  // 砖缝
  const seam = Math.min(Math.min(fx, 1 - fx), Math.min(fy, 1 - fy)) * T
  out.lerp(OF_GROUT, (1 - smoothstep(0, 0.022, seam)) * 0.6)
  out.lerp(OF_CARPET, smoothstep(5.0, 9.5, r) * 0.6)
}

const OF_SKIRT = new Color(0x8f979f)
const OF_GLASS = new Color(0x7fa8bd)
const OF_MULLION = new Color(0xb6bcc2)
const OF_PANEL = new Color(0xa9b0b7)
const OF_UPPER = new Color(0xd7dce0)

/** 玻璃隔断：下沿 0.5m 是玻璃（瞄准视角唯一能看到的墙面部分） */
function officeWall(out: Color, s: number, u: number): void {
  if (s < 0.10) {
    out.copy(OF_SKIRT)
    return
  }
  if (s < 0.50) {
    out.copy(OF_GLASS)
    const t = Math.abs(((u / 1.5) % 1) - 0.5) * 2
    out.lerp(OF_MULLION, (1 - smoothstep(0.6, 0.95, t)) * 0.8)
    out.offsetHSL(0, 0, (hash2(Math.round(u * 4), Math.round(s * 10)) - 0.5) * 0.05)
    return
  }
  if (s < 0.95) {
    out.copy(OF_PANEL)
    const t = Math.abs(((u / 0.6) % 1) - 0.5) * 2
    out.lerp(OF_MULLION, (1 - smoothstep(0.7, 0.98, t)) * 0.45)
    return
  }
  out.copy(OF_UPPER)
  out.offsetHSL(0, 0, (hash2(Math.round(u * 5), Math.round(s * 5)) - 0.5) * 0.03)
}

const OFFICE_PAL: IndoorPalette = {
  name: "Office",
  AMB: [0.34, 0.35, 0.37],
  SUN: [0.78, 0.80, 0.84],
  GAMMA: 1.15,
  // 主灯在球桌正上方，副灯偏 −X 侧 —— 两面侧墙亮度不同才有体积感
  lamps: [
    { pos: [0, 0, 2.55], near: 1.8, far: 11.0, floor: 0.38 },
    { pos: [-4.0, 1.6, 2.40], near: 2.0, far: 9.0, floor: 0.14 },
  ],
  bounce: [0.09, 0.095, 0.10],
  haze: { color: [0.42, 0.45, 0.49], start: 3.5, end: 10.5, max: 0.30 },
  floor: officeFloor,
  wall: officeWall,
  ceil: (out) => out.setHex(0xe8eaec),
}

function buildOffice(): Group {
  const g = new Group()
  g.name = "Office"
  g.add(buildIndoorFloor(OFFICE_PAL))
  g.add(buildIndoorWalls(OFFICE_PAL))
  g.add(buildIndoorCeiling(OFFICE_PAL))
  const p = new Props(OFFICE_PAL)

  /** 办公桌 + 挡板。桌面 0.77m，只有桌腿与挡板入画 —— 这是刻意的 */
  const desk = (x: number, y: number, ry: number) => {
    p.add(boxGeo(1.55, 0.72, 0.05), x, y, 0.72, 0, 0x9c7a52)
    for (const sx of [-0.72, 0.72])
      for (const sy of [-0.31, 0.31])
        p.add(boxGeo(0.05, 0.05, 0.72), x + sx, y + sy, 0, 0, 0x6f747a)
    p.add(boxGeo(1.36, 0.035, 0.55), x, y + ry * 0.33, 0.05, 0, 0x8a6a45)
  }
  desk(-2.90, 2.55, 1)
  desk(2.90, 2.55, 1)
  desk(-2.90, -2.55, -1)
  desk(2.90, -2.55, -1)

  // 办公椅：五爪底座 + 气压柱，低视角下最有辨识度
  addChair(p, -2.90, 1.80, 0.4, 0x3f454d, 0x2f343a)
  addChair(p, 2.90, 1.80, -0.4, 0x3f454d, 0x2f343a)
  addChair(p, -2.90, -1.80, 2.4, 0x3f454d, 0x2f343a)
  addChair(p, 2.90, -1.80, -2.4, 0x3f454d, 0x2f343a)

  // 文件柜（贴 ±X 墙），抽屉缝靠顶点色横带做出来
  for (const sx of [-1, 1]) {
    p.add(
      boxGeo(0.48, 0.90, 1.30),
      sx * 5.68,
      sx > 0 ? 1.90 : -1.90,
      0,
      0,
      (out: Color) => out.setHex(0x8d949c)
    )
    for (let i = 1; i < 4; i++) {
      p.add(
        boxGeo(0.50, 0.86, 0.012),
        sx * 5.68,
        sx > 0 ? 1.90 : -1.90,
        i * 0.32,
        0,
        0x5f666e
      )
    }
  }

  // 纸箱堆 + 饮水机 + 垃圾桶
  p.add(boxGeo(0.55, 0.42, 0.38), -4.90, -3.30, 0, 0, 0xb08a63)
  p.add(boxGeo(0.48, 0.36, 0.32), -4.90, -3.30, 0.38, 0.2, 0xa07c58)
  p.add(boxGeo(0.36, 0.36, 1.00), 5.30, 3.30, 0, 0, 0xdfe3e6)
  p.add(cylGeo(0.15, 0.13, 0.45, 12), 5.30, 3.30, 1.00, 0, 0x9fd4e8)
  p.add(cylGeo(0.14, 0.11, 0.30, 10), -4.60, 3.30, 0, 0, 0x4a5058)
  p.add(cylGeo(0.14, 0.11, 0.30, 10), 4.60, -3.30, 0, 0, 0x4a5058)

  // 绿植 ×2（办公室里唯一的高饱和色，顺带给画面补一个绿相）
  addPlant(p, -5.30, 3.10, 0x9aa0a6, 0x2f7d46)
  addPlant(p, 5.30, -1.20, 0x9aa0a6, 0x357f4a, 0.9)

  g.add(p.mesh("OfficeProps"))
  return g
}

// ───────────────────────── cybercafe：网咖 ─────────────────────────

const CY_TILE = new Color(0x2a2f38)
const CY_GROUT = new Color(0x11141a)
const CY_CYAN = 0x1fd8ff
const CY_MAGENTA = 0xff3ea5

/**
 * 深色地砖 + 发光地缝。
 *
 * 屏幕（0.79m 高）在两种视角下都在画面顶边之上，完全不入画 —— 所以网咖的
 * 视觉全靠**贴地的东西**：发光地缝、机箱侧透（0.04~0.42m）、墙根灯带。
 */
function cyberFloor(out: Color, x: number, y: number, r: number): void {
  const T = 0.55
  const fy = y / T - Math.floor(y / T)
  const fx = x / T - Math.floor(x / T)
  out.copy(CY_TILE)
  out.offsetHSL(0, 0, (hash2(Math.floor(x / T), Math.floor(y / T)) - 0.5) * 0.06)
  const seam = Math.min(Math.min(fx, 1 - fx), Math.min(fy, 1 - fy)) * T
  out.lerp(CY_GROUT, (1 - smoothstep(0, 0.024, seam)) * 0.7)
  out.lerp(CY_TILE, smoothstep(5.0, 9.5, r) * 0.5)
}

/**
 * 地面发光缝：每 3 条横缝里挑 1 条，颜色按 x 分段在青/品红之间交替。
 * 用 smoothstep 做软边（顶点间距 0.08m，硬边会闪）。
 */
function cyberFloorGlow(out: number[], x: number, y: number): void {
  const T = 0.55
  const row = Math.round(y / T)
  if (row % 3 !== 0) return
  const d = Math.abs(y - row * T)
  const w = 1 - smoothstep(0.012, 0.062, d)
  if (w <= 0) return
  const seg = Math.floor((x + 6) / 2.2) % 2
  emissiveMix(seg === 0 ? CY_CYAN : CY_MAGENTA, w * 0.85)(out)
}

const CY_SKIRT = new Color(0x101318)
const CY_WALLP = new Color(0x23282f)
const CY_SLOT = new Color(0x0d1014)
const CY_UPPER = new Color(0x191d24)

function cyberWall(out: Color, s: number, u: number): void {
  if (s < 0.10) {
    out.copy(CY_SKIRT)
    return
  }
  if (s < 1.05) {
    out.copy(CY_WALLP)
    // 每 1.5m 一条竖向灯槽
    const t = Math.abs(((u / 1.5) % 1) - 0.5) * 2
    out.lerp(CY_SLOT, (1 - smoothstep(0.55, 0.9, t)) * 0.85)
    out.offsetHSL(0, 0, (hash2(Math.round(u * 7), Math.round(s * 14)) - 0.5) * 0.05)
    return
  }
  out.copy(CY_UPPER)
}

/** 墙根横向灯带（0.10~0.19m）+ 竖向灯槽发光：墙面唯一入画的部分 */
function cyberWallGlow(out: number[], s: number, u: number): void {
  if (s >= 0.095 && s <= 0.20) {
    const band =
      smoothstep(0.095, 0.125, s) * (1 - smoothstep(0.165, 0.20, s))
    const seg = Math.floor((u + 6) / 1.5) % 2
    emissiveMix(seg === 0 ? CY_CYAN : CY_MAGENTA, band * 0.9)(out)
    return
  }
  if (s > 0.20 && s < 1.05) {
    const t = Math.abs(((u / 1.5) % 1) - 0.5) * 2
    const w = (1 - smoothstep(0.02, 0.34, t)) * 0.55
    if (w <= 0) return
    const seg = Math.floor((u + 6) / 1.5) % 2
    emissiveMix(seg === 0 ? CY_CYAN : CY_MAGENTA, w)(out)
  }
}

const CYBER_PAL: IndoorPalette = {
  name: "Cybercafe",
  // 整体压暗：网咖的亮点靠自发光（灯带/机箱），而不是靠灯照
  AMB: [0.20, 0.21, 0.26],
  SUN: [0.62, 0.64, 0.76],
  GAMMA: 1.2,
  lamps: [{ pos: [0, 0, 2.30], near: 2.0, far: 11.0, floor: 0.26 }],
  bounce: [0.07, 0.075, 0.09],
  haze: { color: [0.16, 0.17, 0.22], start: 3.5, end: 10.5, max: 0.34 },
  floor: cyberFloor,
  wall: cyberWall,
  ceil: (out) => out.setHex(0x14171c),
}

function buildCybercafe(): Group {
  const g = new Group()
  g.name = "Cybercafe"
  const floorGeo = new PlaneGeometry(ROOM_HX * 2, ROOM_HY * 2, 150, 100)
  floorGeo.translate(0, 0, ROOM_FLOOR_Z)
  bakeIndoor(
    floorGeo,
    CYBER_PAL,
    (out, P) => cyberFloor(out, P.x, P.y, Math.sqrt(P.x * P.x + P.y * P.y)),
    (rgb, P) => cyberFloorGlow(rgb, P.x, P.y)
  )
  const fm = new Mesh(floorGeo, envMaterial())
  fm.name = "CyberFloor"
  g.add(fm)

  // 墙面：走一遍定制烘焙（多了发光后处理）
  const H = INDOOR_CEIL_Z - ROOM_FLOOR_Z
  const ax = new Vector3()
  const ay = new Vector3(0, 0, 1)
  const az = new Vector3()
  const wgeos: BufferGeometry[] = []
  for (const w of [
    { onX: true, sign: 1, len: ROOM_HY * 2 },
    { onX: true, sign: -1, len: ROOM_HY * 2 },
    { onX: false, sign: 1, len: ROOM_HX * 2 },
    { onX: false, sign: -1, len: ROOM_HX * 2 },
  ]) {
    const geo = new PlaneGeometry(w.len, H, Math.round(w.len * 8), 26)
    if (w.onX) {
      ax.set(0, w.sign > 0 ? -1 : 1, 0)
      az.set(w.sign > 0 ? -1 : 1, 0, 0)
    } else {
      ax.set(w.sign > 0 ? 1 : -1, 0, 0)
      az.set(0, w.sign > 0 ? -1 : 1, 0)
    }
    geo.applyMatrix4(new Matrix4().makeBasis(ax, ay, az))
    geo.translate(
      w.onX ? w.sign * ROOM_HX : 0,
      w.onX ? 0 : w.sign * ROOM_HY,
      ROOM_FLOOR_Z + H / 2
    )
    bakeIndoor(
      geo,
      CYBER_PAL,
      (out, P) => cyberWall(out, P.z - ROOM_FLOOR_Z, w.onX ? P.y : P.x),
      (rgb, P) => cyberWallGlow(rgb, P.z - ROOM_FLOOR_Z, w.onX ? P.y : P.x)
    )
    const ni = geo.index ? geo.toNonIndexed() : geo
    if (ni !== geo) geo.dispose()
    wgeos.push(ni)
  }
  const wm = new Mesh(mergeColored(wgeos), envMaterial())
  wm.name = "CyberWalls"
  g.add(wm)
  g.add(buildIndoorCeiling(CYBER_PAL))

  const p = new Props(CYBER_PAL)
  // 两排电脑桌（沿 ±Y），每排 9 个机箱位
  for (const sy of [1, -1]) {
    const dy = sy * 2.55
    p.add(boxGeo(10.4, 0.70, 0.05), 0, dy, 0.74, 0, 0x1e222a)
    p.add(boxGeo(10.4, 0.035, 0.55), 0, dy + sy * 0.33, 0.05, 0, 0x171b21)
    for (let i = 0; i < 9; i++) {
      const x = -4.6 + i * 1.15
      p.add(boxGeo(0.20, 0.44, 0.46), x, dy - sy * 0.06, 0, 0, 0x14181e)
      // 侧透板（朝向过道）：这排发光机箱是网咖画面里最主要的内容
      p.add(
        boxGeo(0.20, 0.012, 0.38),
        x,
        dy - sy * 0.29,
        0.04,
        0,
        0x000000,
        emissive(i % 2 === 0 ? CY_CYAN : CY_MAGENTA)
      )
      addChair(p, x, dy - sy * 0.62, (i % 2 ? 0.3 : -0.3), 0x2b3038, 0x22262c)
    }
    // 隔断背板
    p.add(boxGeo(10.4, 0.04, 0.95), 0, dy + sy * 0.72, 0, 0, 0x1a1e25)
  }

  // 饮料冷藏柜（贴 −X 墙）：正面一条竖向自发光
  p.add(boxGeo(0.62, 1.30, 1.85), -5.62, 0, 0, 0, 0x232830)
  p.add(boxGeo(0.012, 0.10, 1.55), -5.31, 0, 0.15, 0, 0x000000, emissive(CY_CYAN))
  // 吧台（贴 +X 墙）+ 一条暖色灯（给画面补第三个色相，避免只有青/品红）
  p.add(boxGeo(0.70, 2.60, 1.05), 5.60, 2.20, 0, 0, 0x2a2520)
  p.add(boxGeo(0.012, 2.30, 0.06), 5.24, 2.20, 0.92, 0, 0x000000, emissive(0xffb457))
  addPlant(p, 5.45, -2.60, 0x2c3138, 0x2c6b52, 0.95)

  g.add(p.mesh("CyberProps"))
  return g
}

/** 室内三件套的统一入口 */
export function buildIndoorScene(sceneId: string): Group | null {
  switch (sceneId) {
    case "room":
      return buildRoom()
    case "office":
      return buildOffice()
    case "cybercafe":
      return buildCybercafe()
    default:
      return null
  }
}
