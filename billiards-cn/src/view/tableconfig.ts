import { TableGeometry } from "./tablegeometry"
import { PocketGeometry } from "./pocketgeometry"
import { R } from "../model/physics/constants"

/**
 * Single coordinator for table + pocket geometry configuration.
 *
 * `PocketGeometry` is derived from `TableGeometry` (pocket positions read
 * `TableGeometry.tableX/Y/X/Y`), so the two must always be (re)configured
 * together in that order. Previously every caller had to remember the paired
 * incantation; this enforces it in one spot.
 */
export class TableConfig {
  /**
   * Apply table geometry for a rule and the given tableSize, then re-derive
   * pocket geometry from the updated table dimensions.
   */
  static apply(ruleType: string, tableSize: number = 10): void {
    TableGeometry.configureForRule(ruleType, tableSize)
    PocketGeometry.scaleToRadius(R)
  }

  /**
   * v1.3.59：各玩法的默认台面尺寸（英尺）。
   *
   * 斯诺克取 12：真实 12ft 斯诺克台面是 3569 × 1778 mm。此前斯诺克与八球/九球
   * 共用 `R*43 × R*21`（约 2.82 × 1.38 m），比真实台短约 21%、窄约 23%，
   * 玩家反馈「斯诺克桌感觉小了」就是这个原因。
   *
   * 取 12 而不是更接近真实的 12.7：因为 `snooker.ts` 的 `tableModelStretchBySize`
   * 里 `12` 这一档的 GLTF 模型拉伸参数已经调好（{x: 1420, y: 700}），
   * 物理与视觉模型能直接对齐；换成别的尺寸要重新标定模型顶点拉伸量。
   */
  static defaultTableSize(ruleType?: string): number {
    return ruleType === "snooker" ? 12 : 10
  }

  /**
   * Read the `tableSize` URL query parameter.
   *
   * v1.3.59：URL 上没有该参数时改用 `defaultTableSize(ruleType)`，
   * 不再写死 10。显式传入 `?tableSize=` 仍然优先。
   */
  static tableSizeFromUrl(ruleType?: string): number {
    const urlParams = new URLSearchParams(globalThis.location?.search ?? "")
    const raw = urlParams.get("tableSize")
    if (raw === null || raw === "" || Number.isNaN(parseFloat(raw))) {
      return TableConfig.defaultTableSize(ruleType)
    }
    return parseFloat(raw)
  }
}
