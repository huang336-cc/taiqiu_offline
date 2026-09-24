/**
 * 皮肤缩略图「复用游戏内真实资源」的打包入口（v1.3.103）。
 *
 * 背景：dist/skin-preview-3d.js 是手写 ES5 脚本，用 window.THREE
 * （dist/three.standalone.js），不经过 webpack，因此无法 import src/ 下的
 * 贴图工厂与场景构建函数。为了让它能渲染「游戏内真实皮肤」，本入口把这些
 * 真实资源原样导出为一个独立运行时（dist/skin-factory.js，挂 window.CueGameSkin）。
 *
 * 与本文件并列的 tools/cue-textures/entry.ts（window.CueGameCue）只导出了球杆
 * 相关的贴图与几何；本入口补齐缩略图需要的另外两类：
 *   · 台球桌外观 —— tableskinfactory 的台呢 / 桌框 / 法线 / 粗糙度贴图工厂；
 *   · 环境场景   —— sceneenvironment 的三个轻量背景构建函数
 *     （buildIndoorScene / buildBeach / buildUfcOctagon，均无外部单例依赖）。
 *
 * three 走 external→window.THREE，因此包内不含 three，且返回的 CanvasTexture
 * 与缩略图渲染用的是同一个 THREE 实例，可直接赋给 material.map。
 *
 * 【红线】场景构建函数只做几何/材质组装，不触碰 Settings / Assets 单例，
 * 也不加载 GLTF —— 菜单里因此可以安全调用，不影响游戏内状态。
 */
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import {
  getClothTexture,
  getFrameTexture,
  getFrameNormalTexture,
  getFrameRoughnessTexture,
} from "../../src/view/tableskinfactory"
import { getTableSkin, TABLE_SKINS } from "../../src/utils/settings"
import {
  buildIndoorScene,
  buildBeach,
  buildUfcOctagon,
} from "../../src/view/sceneenvironment"

export {
  R,
  TableGeometry,
  getClothTexture,
  getFrameTexture,
  getFrameNormalTexture,
  getFrameRoughnessTexture,
  getTableSkin,
  TABLE_SKINS,
  buildIndoorScene,
  buildBeach,
  buildUfcOctagon,
}
