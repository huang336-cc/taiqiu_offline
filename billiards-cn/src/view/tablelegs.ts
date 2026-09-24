/**
 * v1.3.95：球桌按真实高度摆放所需的**桌腿**几何。
 *
 * ## 背景
 * 物理层严格假定「台面 = z=0 平面」—— Ball.pos.z、Table 的库边/袋口/落袋/
 * 跳球判定全部围绕 z=0 展开。所以 v1.3.95 采用「保持台面不动、只让地面下沉」
 * 的方案（`sceneenvironment.GROUND_Z` 由 -0.203 改到 -0.80）。
 *
 * 由此产生一个问题：桌体几何的下沿仍在 z = -0.203，而现在地面在 -0.80，
 * 桌子会**悬空** 0.597m。本模块补上这段真实高度的桌腿把桌子接到地面。
 *
 * ## 尺寸
 * 真实中式八球 / 斯诺克球桌台面离地 0.76~0.81m，取 0.80m；桌体厚 0.203m，
 * 故桌腿高 = 0.80 − 0.203 = 0.597m。六根立柱（四角 + 长边中点），
 * 与真实球桌的支撑结构一致。
 */
import { BoxGeometry, Group, Mesh, MeshPhongMaterial } from "three"
import { TableGeometry } from "./tablegeometry"
import { GROUND_Z } from "./sceneenvironment"

/** 桌体几何的下沿高度（= 旧 GROUND_Z），桌腿从这里往下接到地面 */
const TABLE_UNDERSIDE_Z = -0.203

export function buildTableLegs(): Group {
  const group = new Group()

  // 桌腿几何尺寸在建役时按当前 GROUND_Z 算定：**紧跟配置**，不写死 0.597，
  // 以免将来调整 GROUND_Z 后桌腿与地面对不上。
  const legHeight = TABLE_UNDERSIDE_Z - GROUND_Z
  if (legHeight <= 0) return group

  const thickness = 0.12
  // Z-up：three 的 BoxGeometry(width=x, height=y, depth=z)，
  // 要让立柱沿"世界竖直方向"延伸，必须给 depth（第三参）赋高度。
  const geometry = new BoxGeometry(thickness, thickness, legHeight)
  const material = new MeshPhongMaterial({
    color: 0x2a2118,
    shininess: 14,
  })

  // 内缩，避免桌腿超出台面轮廓悬在外面
  const inset = 0.15
  const sx = Math.max(0, TableGeometry.tableX - inset)
  const sy = Math.max(0, TableGeometry.tableY - inset)
  const spots: [number, number][] = [
    [sx, sy],
    [-sx, sy],
    [sx, -sy],
    [-sx, -sy],
    // 长边中点：真实球桌的中间支撑（防止长边下沉）
    [0, sy],
    [0, -sy],
  ]

  for (const [x, y] of spots) {
    const leg = new Mesh(geometry, material)
    // 立柱中心：从地面往上 legHeight/2，顶端正好顶到桌体下沿
    leg.position.set(x, y, GROUND_Z + legHeight / 2)
    leg.castShadow = true
    leg.receiveShadow = true
    group.add(leg)
  }

  return group
}
