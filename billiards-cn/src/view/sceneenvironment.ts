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
} from "three"
import { makeValueNoise2D, fbm2D } from "../utils/noise"

/** 台球桌底部世界 y 坐标（实测自 table AABB）—— 仅用于足球/篮球场景 */
const GROUND_Y = -0.93
/** 球场线略高于地面，避免 z-fighting */
const LINE_Y = GROUND_Y + 0.01

/**
 * 台球桌底沿真实世界 z 坐标（Z-up 世界），用于雪山场景：
 * 桌面下沿在 z = -0.203；雪地平面必须贴在这里，避免穿插桌面。
 */
const GROUND_Z = -0.203

// 通用（足球/篮球/线条）材质：保持原 unlit 观感，未改动
const WHITE = new MeshBasicMaterial({ color: 0xffffff })
const ORANGE = new MeshBasicMaterial({ color: 0xff6a1a })
const GRASS = new MeshBasicMaterial({ color: 0x2f7d32 })
/** 草地条纹（简化） */
const WOOD = new MeshBasicMaterial({ color: 0xcaa05a })

/**
 * v1.1.6 雪山材质改为按调用 new（写在 buildSnowMountain 内），
 * 不再使用模块级单例——避免 assets.ts 切场景时的 dispose bug。
 * 旧的 SNOW/ROCK/ROCK_FAR/SNOW_FAR/ICE 模块单例已删除。
 */

/** 雪山天空穹顶半径（必须小于 view.ts 为雪景放大的相机 far） */
export const SNOW_SKY_RADIUS = 130

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
 * 足球场（D-v4）：真实几何比例 + 体育场看台。
 * 场地 40×25，含完整标线与球门；四周 4 座多层看台形成体育场包围感。
 */
export function buildFootballField(): Group {
  const g = new Group()

  // 草地
  const ground = new Mesh(new PlaneGeometry(40, 25), GRASS)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  g.add(ground)

  // 中线 + 中点 + 中圈
  addLine(g, 40, 0.12, 0, 0)
  addDot(g, 0.12, 0, 0)
  addRing(g, 4.0, 4.12, 0, 0)

  // 两端禁区 + 小禁区 + 罚球点 + 罚球弧
  for (const sgn of [-1, 1]) {
    const zBase = sgn * 10.7
    addLine(g, 8.4, 0.1, 0, zBase + sgn * 2.2)
    addLine(g, 8.4, 0.1, 0, zBase - sgn * 2.2)
    addLine(g, 0.1, 4.4, -4.2, zBase)
    addLine(g, 0.1, 4.4, 4.2, zBase)
    addLine(g, 3.6, 0.08, 0, zBase - sgn * 1.2)
    addLine(g, 0.08, 2.4, -1.8, zBase)
    addLine(g, 0.08, 2.4, 1.8, zBase)
    addDot(g, 0.1, 0, zBase - sgn * 1.6)
    addRing(
      g,
      4.0,
      4.08,
      0,
      zBase - sgn * 1.6,
      sgn > 0 ? Math.PI * 1.25 : Math.PI * 0.25,
      Math.PI * 0.5
    )
  }

  // 两端球门
  for (const sgn of [-1, 1]) {
    const z = sgn * 12.4
    const goal = new Group()
    for (const dx of [-1.8, 1.8]) {
      const post = new Mesh(new BoxGeometry(0.12, 1.2, 0.12), WHITE)
      post.position.set(dx, GROUND_Y + 0.6, z)
      goal.add(post)
    }
    const bar = new Mesh(new BoxGeometry(3.6, 0.12, 0.12), WHITE)
    bar.position.set(0, GROUND_Y + 1.2, z)
    goal.add(bar)
    const net = new Mesh(
      new PlaneGeometry(3.6, 1.0),
      new MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.35 })
    )
    net.position.set(0, GROUND_Y + 0.6, z - sgn * 0.05)
    net.rotation.y = sgn > 0 ? Math.PI : 0
    goal.add(net)
    g.add(goal)
  }

  // 体育场看台（D-v4 新增）：南北两面长看台 + 东西两端短看台
  const STAND_COLOR = 0x4a5560
  // 南（z 正方向）长看台
  addStand(g, 0, 20, 44, 6, 5, 6, STAND_COLOR, "x")
  // 北（z 负方向）长看台
  addStand(g, 0, -20, 44, 6, 5, 6, STAND_COLOR, "x")
  // 东（x 正方向）端看台
  addStand(g, 24, 0, 22, 6, 4, 5, STAND_COLOR, "z")
  // 西（x 负方向）端看台
  addStand(g, -24, 0, 22, 6, 4, 5, STAND_COLOR, "z")

  return g
}

/**
 * 篮球场（D-v4）：木地板球场 + 观众席。
 */
export function buildBasketballCourt(): Group {
  const g = new Group()

  // 木地板
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

  // 体育馆观众席（D-v4 新增）：四周 4 座矮看台
  const STAND_COLOR = 0x3d4651
  addStand(g, 0, 13, 32, 5, 4, 4, STAND_COLOR, "x")
  addStand(g, 0, -13, 32, 5, 4, 4, STAND_COLOR, "x")
  addStand(g, 18, 0, 18, 5, 3, 3.5, STAND_COLOR, "z")
  addStand(g, -18, 0, 18, 5, 3, 3.5, STAND_COLOR, "z")

  return g
}

/**
 * 程序化蓝天穹顶（Req 2）：用顶点色的大球（BackSide）做渐变天空，
 * 完全由几何生成，不存在静态 2D 背景贴图。
 * 地平线淡蓝 → 天顶深蓝，符合「晴天蓝天」。
 *
 * v1.1.6：旋转 sphere 让极点对齐 +Z（Z-up 世界），渐变沿 z 计算。
 */
function buildSkyDome(): Mesh {
  const geo = new SphereGeometry(SNOW_SKY_RADIUS, 32, 24)
  geo.rotateX(Math.PI / 2) // Z-up: 把极点从 ±Y 转到 ±Z
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const horizon = new Color(0xd2e8ff)
  const zenith = new Color(0x2f6fb0)
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / SNOW_SKY_RADIUS // -1..1
    const t = Math.max(0, Math.min(1, (z + 1) / 2))
    tmp.copy(horizon).lerp(zenith, t)
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
  })
  const sky = new Mesh(geo, mat)
  sky.name = "SkyDome"
  sky.renderOrder = -1
  sky.castShadow = false
  sky.receiveShadow = false
  return sky
}

/**
 * v1.1.6 雪山核心：将 ConeGeometry（默认轴 +Y）旋转 -PI/2 让轴指向 +Z，
 * 沿径向施加 FBM 噪声做顶点位移，使山体轮廓不再像规则的圆锥；
 * 顶点色按高度从岩石深灰渐变到雪冠亮白。
 *
 * 返回的 Group 包含两个子 mesh：岩石底 + 雪冠顶。两 mesh 都接收光照。
 *
 * @param h 总高 @param r 底座半径 @param snowFrac 雪冠占顶部比例
 * @param segs 径向段数 @param heightSegs 高度段数（≥2 才能位移）
 * @param seed FBM 种子（同山每次长相一致）
 */
function buildMountainMeshes(
  h: number,
  r: number,
  snowFrac: number,
  segs: number,
  heightSegs: number,
  seed: number,
  rockMat: MeshLambertMaterial,
  snowMat: MeshLambertMaterial
): Group {
  const grp = new Group()

  // 岩石圆锥：默认轴 +Y，绕 X 转 PI/2 → 轴 +Z，底在 -z 方向
  const rock = new ConeGeometry(r, h, segs, Math.max(2, heightSegs))
  rock.rotateX(Math.PI / 2)
  rock.translate(0, 0, h / 2) // 底贴地（z=0），顶在 z=h
  applyFbmDisplace(rock, h, r, seed, 0.32)
  rock.computeVertexNormals()
  paintRockSnowVertices(rock, h, snowFrac, seed)
  const rockMesh = new Mesh(rock, rockMat)
  rockMesh.castShadow = false // 山不在 shadow frustum 内，省 shadow pass 成本
  rockMesh.receiveShadow = false
  grp.add(rockMesh)

  // 雪冠（嵌套小锥）：从 snowFrac 比例处往上覆盖
  const snowH = Math.max(h * snowFrac, 0.5)
  const snowR = r * 0.65
  const snow = new ConeGeometry(snowR, snowH, segs, Math.max(2, heightSegs - 1))
  snow.rotateX(Math.PI / 2)
  snow.translate(0, 0, h - snowH / 2)
  applyFbmDisplace(snow, snowH, snowR, seed + 17, 0.22)
  snow.computeVertexNormals()
  paintSnowCapVertices(snow, snowH, seed + 31)
  const snowMesh = new Mesh(snow, snowMat)
  snowMesh.castShadow = false
  snowMesh.receiveShadow = false
  grp.add(snowMesh)

  return grp
}

/**
 * 对 ConeGeometry 的径向顶点施加 FBM 噪声位移（沿水平径向），保留轴线顶点。
 * 顶端/底端位移衰减，避免山尖被压平、底边被挤变形。
 */
function applyFbmDisplace(
  geo: import("three").BufferGeometry,
  h: number,
  r: number,
  seed: number,
  amplitude: number
): void {
  const noise = makeValueNoise2D(seed)
  const pos = geo.attributes.position
  // 让频率与 r 相关：大山细节更细密，小山更粗犷
  const baseFreq = 1.4 / r
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const radial = Math.hypot(x, y)
    if (radial < 1e-4) continue // 跳过轴线顶点（山顶/山底尖）
    const nx = x / radial
    const ny = y / radial
    // 高度归一化 0..1（0 底, 1 顶）
    const tHeight = Math.max(0, Math.min(1, z / h))
    // 顶/底两端收缩，中间最强
    const falloff = Math.sin(tHeight * Math.PI)
    // FBM 4 阶
    const n =
      fbm2D(noise, nx * 2 * baseFreq + seed, ny * 2 * baseFreq + seed, 4) - 0.5
    const disp = n * amplitude * r * falloff
    pos.setX(i, x + nx * disp)
    pos.setY(i, y + ny * disp)
  }
  pos.needsUpdate = true
}

/**
 * 岩石圆锥顶点色：底部 #3b4554 → 中部 #7a8696 → 雪线（snowFrac 高度）→ 雪白 #f4f8fc
 */
function paintRockSnowVertices(
  geo: import("three").BufferGeometry,
  h: number,
  snowFrac: number,
  seed: number
): void {
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const cRockBottom = new Color(0x3b4554)
  const cRockMid = new Color(0x7a8696)
  const cRockTop = new Color(0xb9c2cd)
  const cSnowLine = new Color(0xf4f8fc)
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    const t = Math.max(0, Math.min(1, z / h))
    if (t < 0.55) {
      // 0..0.55：岩石渐变
      const tt = t / 0.55
      tmp.copy(cRockBottom).lerp(cRockMid, tt)
    } else if (t < 1 - snowFrac) {
      // 0.55..雪线：岩石中 → 岩石顶
      const tt = (t - 0.55) / Math.max(1 - snowFrac - 0.55, 0.01)
      tmp.copy(cRockMid).lerp(cRockTop, tt)
    } else {
      // 雪线以上 → 雪白
      const tt = (t - (1 - snowFrac)) / Math.max(snowFrac, 0.01)
      tmp.copy(cRockTop).lerp(cSnowLine, tt)
    }
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3))
  void seed
}

/**
 * 雪冠顶点色：底部微冷 → 顶部雪白，模拟高海拔日照直射效果
 */
function paintSnowCapVertices(
  geo: import("three").BufferGeometry,
  h: number,
  seed: number
): void {
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const cBottom = new Color(0xe6effa)
  const cTop = new Color(0xffffff)
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getZ(i) / h))
    // 雪冠底部混入少量冷蓝，往上快速变白
    tmp.copy(cBottom).lerp(cTop, Math.pow(t, 0.6))
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3))
  void seed
}

/**
 * 多峰山簇（v1.1.6 新增）：1 座主峰 + 2 座副峰，
 * 模拟真实山脉多峰簇拥的轮廓。
 *
 * 返回的 Group 已定位到 (x, y, GROUND_Z)。
 */
function makeMountainCluster(
  x: number,
  y: number,
  baseH: number,
  baseR: number,
  snowFrac: number,
  seed: number,
  rockMat: MeshLambertMaterial,
  snowMat: MeshLambertMaterial
): Group {
  const g = new Group()
  g.position.set(x, y, GROUND_Z)

  // 主峰
  const main = buildMountainMeshes(
    baseH,
    baseR,
    snowFrac,
    10,
    4,
    seed,
    rockMat,
    snowMat
  )
  g.add(main)

  // 副峰 1：后侧左，高度 60%，偏移 (-r*0.7, +r*0.55)
  const sub1 = buildMountainMeshes(
    baseH * 0.62,
    baseR * 0.55,
    Math.min(snowFrac + 0.12, 0.6),
    8,
    3,
    seed + 1,
    rockMat,
    snowMat
  )
  sub1.position.set(-baseR * 0.7, baseR * 0.55, 0)
  g.add(sub1)

  // 副峰 2：前侧右，高度 45%，偏移 (+r*0.55, -r*0.6)
  const sub2 = buildMountainMeshes(
    baseH * 0.45,
    baseR * 0.45,
    Math.min(snowFrac + 0.18, 0.65),
    7,
    3,
    seed + 2,
    rockMat,
    snowMat
  )
  sub2.position.set(baseR * 0.55, -baseR * 0.6, 0)
  g.add(sub2)

  return g
}

/**
 * 冰川峡谷（v1.1.6 重写）：Z-up 坐标，中央冰河面 + 两侧非对称冰锥。
 *
 * 冰河面用顶点色从中心向边缘渐变（深裂→浅冰），破对称；
 * 冰锥使用 seededRandom 随机偏转 ±角度 + 高度扰动，模拟自然破碎冰体。
 */
function buildGlacierCanyon(): Group {
  const g = new Group()
  g.name = "GlacierCanyon"

  // 冰河材料（按调用 new，避模块单例 dispose bug）
  const iceMat = new MeshLambertMaterial({
    color: 0xb2e1f3,
    transparent: true,
    opacity: 0.92,
    emissive: 0x1d4866,
    emissiveIntensity: 0.35,
    vertexColors: true,
  })

  // 中央冰河：长方形 plane（PlaneGeometry 默认法向 +Z，正好 Z-up 朝上）
  const river = new PlaneGeometry(12, 30, 8, 12)
  const pos = river.attributes.position
  const riverColors = new Float32Array(pos.count * 3)
  const cCenter = new Color(0x4a90b8)
  const cEdge = new Color(0xc6e6f3)
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    // 用 x/y 距离做径向渐变
    const t = Math.min(1, Math.hypot(x / 6, y / 15))
    tmp.copy(cCenter).lerp(cEdge, t)
    riverColors[i * 3] = tmp.r
    riverColors[i * 3 + 1] = tmp.g
    riverColors[i * 3 + 2] = tmp.b
  }
  river.setAttribute("color", new BufferAttribute(riverColors, 3))
  const riverMesh = new Mesh(river, iceMat)
  riverMesh.position.set(0, GROUND_Z + 0.01, -38)
  riverMesh.receiveShadow = true
  g.add(riverMesh)

  // 不对称冰锥（左右不再镜像）：12 块
  // 借助 makeValueNoise2D 提供 seed 但用 MathUtils.seededRandom 简化
  const peaks: Array<{ x: number; y: number; h: number; r: number; twist: number }> = [
    { x: -8, y: -18, h: 9, r: 5, twist: 0.18 },
    { x: -14, y: -26, h: 11, r: 5.5, twist: -0.22 },
    { x: -22, y: -34, h: 13, r: 6, twist: 0.34 },
    { x: -18, y: -44, h: 8, r: 4.5, twist: -0.16 },
    { x: -26, y: -50, h: 10, r: 5.2, twist: 0.28 },
    { x: -7, y: -56, h: 7, r: 4, twist: -0.2 },
    { x: 9, y: -20, h: 10, r: 5, twist: -0.3 },
    { x: 16, y: -28, h: 12, r: 5.5, twist: 0.25 },
    { x: 24, y: -36, h: 14, r: 6.5, twist: -0.18 },
    { x: 19, y: -46, h: 9, r: 5, twist: 0.32 },
    { x: 12, y: -52, h: 7.5, r: 4.2, twist: -0.14 },
    { x: 4, y: -8, h: 6, r: 3.5, twist: 0.4 },
  ]
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i]
    const c = new ConeGeometry(p.r, p.h, 7, 3)
    c.rotateX(Math.PI / 2)
    c.translate(0, 0, p.h / 2)
    // 冰锥同样小幅 FBM 位移（种子按 index）
    applyFbmDisplace(c, p.h, p.r, 900 + i * 31, 0.18)
    c.computeVertexNormals()
    const m = new Mesh(c, iceMat)
    m.position.set(p.x, p.y, GROUND_Z)
    // 水平随机偏转，破对称
    m.rotation.z = p.twist
    m.castShadow = false
    m.receiveShadow = false
    g.add(m)
  }

  return g
}

/**
 * 雪山（v1.1.6 重写）：Z-up 坐标 + 多峰山簇 + FBM 位移 + 顶点色渐变 +
 * 360° 环状山阵 + 不对称冰川 + 雪地顶点色 + 蓝天穹顶。
 *
 * 关键：游戏世界是 Z-up（utils/three-utils.ts `up = (0,0,1)`），相机在
 * 桌面上方绕 XY 平面旋转瞄准 → 远近景是 XY 平面方向，不是 ±z。
 * 因此山必须放在 XY 平面内围绕桌面 360° 分布，相机转到哪个角度都能
 * 看到对应的山簇。
 *
 * 太阳光 + 半球光 + 阴影由 view.ts 注入；这里只负责几何与材质。
 */
export function buildSnowMountain(): Group {
  const g = new Group()
  g.name = "SnowMountain"

  // ─── 材质（按调用 new，避开模块单例 dispose bug） ───
  const rockMat = new MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
  })
  const snowMat = new MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
  })
  const rockFarMat = new MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
  })
  const snowFarMat = new MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
  })

  // ─── 蓝天穹顶 ───
  g.add(buildSkyDome())

  // ─── 广袤雪原（XY 平面 320×320 plane，PlaneGeometry 法向 +Z 即 Z-up 朝上） ───
  const groundGeo = new PlaneGeometry(320, 320, 32, 32)
  const gpos = groundGeo.attributes.position
  const gcolors = new Float32Array(gpos.count * 3)
  const cCenter = new Color(0xffffff) // 近台反光雪
  const cEdge = new Color(0xdde9f5)   // 远端淡蓝
  const cMid = new Color(0xeef4fb)
  const tmpC = new Color()
  for (let i = 0; i < gpos.count; i++) {
    const x = gpos.getX(i)
    const y = gpos.getY(i)
    const r = Math.hypot(x, y)
    const t = Math.min(1, r / 60)
    if (t < 0.3) {
      tmpC.copy(cCenter).lerp(cMid, t / 0.3)
    } else {
      tmpC.copy(cMid).lerp(cEdge, (t - 0.3) / 0.7)
    }
    gcolors[i * 3] = tmpC.r
    gcolors[i * 3 + 1] = tmpC.g
    gcolors[i * 3 + 2] = tmpC.b
  }
  groundGeo.setAttribute("color", new BufferAttribute(gcolors, 3))
  const ground = new Mesh(
    groundGeo,
    new MeshLambertMaterial({ vertexColors: true })
  )
  ground.position.set(0, 0, GROUND_Z)
  ground.receiveShadow = true
  g.add(ground)

  // ─── 主山脉：环绕桌面 360° 的多峰山簇（共 11 簇） ───
  // angle: 0=+X, 90=+Y, 顺时针；dist: 到桌心距离（XY 平面半径）
  const innerClusters: Array<{
    angle: number
    dist: number
    h: number
    r: number
    snowFrac: number
    seed: number
  }> = [
    { angle: 12, dist: 48, h: 32, r: 22, snowFrac: 0.34, seed: 101 },
    { angle: 48, dist: 44, h: 38, r: 24, snowFrac: 0.3, seed: 113 },
    { angle: 85, dist: 50, h: 36, r: 23, snowFrac: 0.32, seed: 127 },
    { angle: 122, dist: 46, h: 30, r: 20, snowFrac: 0.36, seed: 139 },
    { angle: 160, dist: 52, h: 40, r: 25, snowFrac: 0.3, seed: 149 },
    { angle: 198, dist: 50, h: 34, r: 22, snowFrac: 0.32, seed: 157 },
    { angle: 236, dist: 46, h: 42, r: 26, snowFrac: 0.28, seed: 163 },
    { angle: 272, dist: 50, h: 37, r: 23, snowFrac: 0.32, seed: 173 },
    { angle: 308, dist: 48, h: 39, r: 24, snowFrac: 0.3, seed: 181 },
    { angle: 343, dist: 52, h: 32, r: 21, snowFrac: 0.34, seed: 191 },
    // 一座近景大山（默认视角正前方 +Y 方向，最显眼）
    { angle: 90, dist: 36, h: 28, r: 19, snowFrac: 0.4, seed: 199 },
  ]
  for (const c of innerClusters) {
    const rad = (c.angle * Math.PI) / 180
    const x = Math.cos(rad) * c.dist
    const y = Math.sin(rad) * c.dist
    const levels = [
      { segs: 10, heightSegs: 4, dist: 0 },
      { segs: 7, heightSegs: 3, dist: 24 },
      { segs: 5, heightSegs: 2, dist: 50 },
    ]
    const lod = new LOD()
    lod.position.set(x, y, GROUND_Z)
    for (const lv of levels) {
      const cluster = makeMountainCluster(
        0,
        0,
        c.h,
        c.r,
        c.snowFrac,
        c.seed + lv.segs * 13,
        rockMat,
        snowMat
      )
      lod.addLevel(cluster, lv.dist)
    }
    lod.name = "Mountain"
    g.add(lod)
  }

  // ─── 连绵远山脊（外圈，6 簇，更冷更蓝） ───
  const ridges: Array<{
    angle: number
    dist: number
    h: number
    r: number
    snowFrac: number
    seed: number
  }> = [
    { angle: 28, dist: 88, h: 16, r: 13, snowFrac: 0.5, seed: 211 },
    { angle: 92, dist: 95, h: 19, r: 14, snowFrac: 0.46, seed: 223 },
    { angle: 152, dist: 90, h: 17, r: 13, snowFrac: 0.5, seed: 229 },
    { angle: 212, dist: 92, h: 18, r: 14, snowFrac: 0.46, seed: 233 },
    { angle: 272, dist: 96, h: 15, r: 12, snowFrac: 0.55, seed: 239 },
    { angle: 332, dist: 90, h: 17, r: 13, snowFrac: 0.5, seed: 241 },
  ]
  for (const r of ridges) {
    const rad = (r.angle * Math.PI) / 180
    const x = Math.cos(rad) * r.dist
    const y = Math.sin(rad) * r.dist
    const c = new ConeGeometry(r.r, r.h, 6, 3)
    c.rotateX(Math.PI / 2)
    c.translate(0, 0, r.h / 2)
    applyFbmDisplace(c, r.h, r.r, r.seed, 0.28)
    c.computeVertexNormals()
    paintRockSnowVertices(c, r.h, r.snowFrac, r.seed)
    const mesh = new Mesh(c, rockFarMat)
    mesh.position.set(x, y, GROUND_Z)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.name = "Ridge"
    g.add(mesh)

    // 远山雪冠（更蓝）
    const snowH = r.h * r.snowFrac
    const snowR = r.r * 0.65
    const sc = new ConeGeometry(snowR, snowH, 6, 2)
    sc.rotateX(Math.PI / 2)
    sc.translate(0, 0, r.h - snowH / 2)
    applyFbmDisplace(sc, snowH, snowR, r.seed + 17, 0.2)
    sc.computeVertexNormals()
    paintSnowCapVertices(sc, snowH, r.seed + 31)
    const sm = new Mesh(sc, snowFarMat)
    sm.position.set(x, y, GROUND_Z)
    sm.castShadow = false
    sm.receiveShadow = false
    g.add(sm)
  }

  // ─── 冰川峡谷（默认 +Y 方向，中景纵深） ───
  const glacier = buildGlacierCanyon()
  // 把整个冰川平移到 +Y 方向（约 35m 处）
  glacier.position.set(0, 35, GROUND_Z)
  g.add(glacier)

  // ─── 前景小雪丘（球桌附近，4–6 座纯雪小丘） ───
  const foothills: Array<{ x: number; y: number; h: number; r: number }> = [
    { x: -8, y: 12, h: 3.6, r: 3.6 },
    { x: 10, y: 14, h: 3.2, r: 3.4 },
    { x: -14, y: 6, h: 2.8, r: 3 },
    { x: 14, y: -10, h: 3.4, r: 3.2 },
    { x: -6, y: -14, h: 2.6, r: 2.6 },
    { x: 18, y: 6, h: 3.0, r: 2.8 },
  ]
  for (let i = 0; i < foothills.length; i++) {
    const f = foothills[i]
    const c = new ConeGeometry(f.r, f.h, 7, 2)
    c.rotateX(Math.PI / 2)
    c.translate(0, 0, f.h / 2)
    applyFbmDisplace(c, f.h, f.r, 700 + i * 23, 0.22)
    c.computeVertexNormals()
    paintSnowCapVertices(c, f.h, 800 + i)
    const m = new Mesh(c, snowMat)
    m.position.set(f.x, f.y, GROUND_Z)
    m.castShadow = false
    m.receiveShadow = false
    g.add(m)
  }

  return g
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
      return buildSnowMountain()
    default:
      return null
  }
}
