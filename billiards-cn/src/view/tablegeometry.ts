import { R, setmu } from "../model/physics/constants"

export class TableGeometry {
  static tableX: number
  static tableY: number
  static X: number
  static Y: number
  static hasPockets: boolean = true

  static {
    TableGeometry.scaleToRadius(R)
  }

  static scaleToRadius(R) {
    TableGeometry.tableX = R * 43
    TableGeometry.tableY = R * 21
    TableGeometry.X = TableGeometry.tableX + R
    TableGeometry.Y = TableGeometry.tableY + R
  }

  static configureForRule(ruleType: string, tableSize: number = 10): void {
    const sizeScale = tableSize / 10
    if (ruleType === "threecushion" || ruleType === "sagu") {
      const UMB_TABLE_X = 92.36
      const UMB_TABLE_Y = 46.18
      TableGeometry.tableX = R * (UMB_TABLE_X / 2 - 1) * sizeScale
      TableGeometry.tableY = R * (UMB_TABLE_Y / 2 - 1) * sizeScale
      TableGeometry.hasPockets = false
    } else {
      TableGeometry.tableX = R * 43 * sizeScale
      TableGeometry.tableY = R * 21 * sizeScale
      TableGeometry.hasPockets = true
      // v1.3.65：0.0066 → 0.0141。等效滚动阻力系数 μr = mu/√2 由 0.0047 提到
      // ≈0.0100（真实台呢量级），慢滚距离减半。详见 constants.ts 顶部注释。
      setmu(0.0141)
    }
    TableGeometry.X = TableGeometry.tableX + R
    TableGeometry.Y = TableGeometry.tableY + R
  }
}
