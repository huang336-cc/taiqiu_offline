/**
 * 球杆预览「复用游戏内资源」的打包入口（v1.3.54）。
 *
 * 背景：dist/cue-preview-3d.js 是手写 ES5 脚本，用 window.THREE（dist/three.standalone.js），
 * 不经过 webpack，因此无法 import src/view/cuetexturefactory.ts。旧版预览于是自己
 * 维护了一套"简化版"球杆：L=5.0 / 杆尾半径 0.28（长径比 8.9:1），且只用卡片上的
 * 两个色值铺色，与游戏内真实球杆（长径比 46.8:1 + 程序化分区贴图）完全不一致，
 * 用户看到的就是一根"胖棒槌"。
 *
 * 解决：本入口把游戏内的【真实程序化贴图工厂】与【真实球杆尺寸】原样导出为
 * 一个独立运行时（dist/cue-texture-factory.js，挂 window.CueGameCue）。
 * three 走 external→window.THREE，因此包内不含 three，且返回的 CanvasTexture
 * 与预览用的是同一个 THREE 实例，可直接赋给 material.map。
 *
 * 这样"预览里的球杆"与"游戏里的球杆"共用同一份贴图代码，改主题只需改一处。
 */
import { R } from "../../src/model/physics/constants"
import {
  getCueTexture,
  getCueButtTexture,
} from "../../src/view/cuetexturefactory"
import {
  CUE_THEMES,
  getCueTheme,
  getSkin,
  getTableSkin,
} from "../../src/utils/settings"

export { getCueTexture, getCueButtTexture, getCueTheme, getSkin, getTableSkin, CUE_THEMES }

/**
 * 游戏内球杆的真实几何参数。
 * 与 src/view/cue.ts（length = TableGeometry.tableX = R*43，tip/butt 半径）
 * 以及 src/view/cuemesh.ts（cueGeometry 的四段比例）逐项对齐，
 * 保证预览与实机是同一根杆，而不是"照着感觉抄一份"。
 */
export const CUE_GEOM = {
  /** 球半径常量 R（src/model/physics/constants.ts） */
  R: R,
  /** 杆全长 = TableGeometry.tableX = R * 43 */
  length: R * 43,
  /** 杆头（皮头端）半径 = (R * 0.07) / 0.5 */
  tipRadius: (R * 0.07) / 0.5,
  /** 杆尾端半径 = (R * 0.23) / 0.5 */
  buttRadius: (R * 0.23) / 0.5,
  /** 杆尾段占全长比例（cueGeometry: buttLength = length * 0.28） */
  buttLengthRatio: 0.28,
  /** 杆身段占全长比例（cueGeometry: shaftLength = length * 0.71） */
  shaftLengthRatio: 0.71,
  /** 先角段占全长比例（cueGeometry: ferruleLength = length * 0.007） */
  ferruleLengthRatio: 0.007,
  /** 皮头厚度（cueGeometry 写死的 0.0055） */
  tipHeight: 0.0055,
  /** 皮头顶端半径系数（tipTopRadius = tipRadius * 0.93） */
  tipTopRatio: 0.93,
  /** 杆尾顶端半径系数（buttRadius * 0.9） */
  buttTopRatio: 0.9,
  /** 圆柱周向分段数（cueGeometry 默认 segments = 9） */
  segments: 9,
  /** 先角材质色（cueGeometry: ferruleMat 0xf0e8d6） */
  ferruleColor: 0xf0e8d6,
  /** 先角光泽（cueGeometry: shininess 100） */
  ferruleShininess: 100,
  /** 皮头光泽（cueGeometry: shininess 5） */
  tipShininess: 5,
}
