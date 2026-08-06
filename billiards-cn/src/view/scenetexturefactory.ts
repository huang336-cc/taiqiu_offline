import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture } from "three"
import { getEnvScene } from "../utils/settings"

/**
 * 环境场景墙面贴图工厂（item 4）。
 *
 * 程序化 Canvas 贴图，零外部资源。每个场景一张竖直渐变（顶 wallA →
 * 底 wallB）+ 主题化图案（沙纹 / 树干 / 雪点 / 沙丘 / 办公室隔板 / 霓虹网格），
 * 套在背景「盒子房间」的内壁上，配合环境光色调区分氛围。
 */

const W = 512
const H = 512

const cache = new Map<string, Texture>()

export function getSceneTexture(sceneId: string): Texture {
  if (cache.has(sceneId)) return cache.get(sceneId)!
  const tex = build(sceneId)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(2, 1)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  cache.set(sceneId, tex)
  return tex
}

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0")
}

function build(sceneId: string): CanvasTexture {
  const def = getEnvScene(sceneId)
  const cv = document.createElement("canvas")
  cv.width = W
  cv.height = H
  const ctx = cv.getContext("2d")!

  // 竖直渐变墙面
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, hex(def.wallA))
  g.addColorStop(1, hex(def.wallB))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  switch (def.kind) {
    case "beach":
      // 沙纹横向条带
      ctx.globalAlpha = 0.12
      ctx.fillStyle = "#000000"
      for (let y = 0; y < H; y += 26) ctx.fillRect(0, y + (y % 52 ? 6 : 0), W, 6)
      ctx.globalAlpha = 1
      break
    case "forest":
      // 树干竖纹
      ctx.globalAlpha = 0.18
      ctx.fillStyle = "#0c1a0c"
      for (let x = 30; x < W; x += 70) ctx.fillRect(x, 0, 26, H)
      ctx.globalAlpha = 1
      break
    case "snow":
      // 雪点
      ctx.fillStyle = "rgba(255,255,255,0.5)"
      for (let i = 0; i < 220; i++) {
        ctx.beginPath()
        ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 2 + 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    case "football":
      // 足球场：草地球场 + 白色场地线 + 中圈
      ctx.fillStyle = "#1f5a22"
      for (let y = 0; y < H; y += 34) {
        ctx.fillRect(0, y, W, 17) // 深浅草条纹
      }
      ctx.globalAlpha = 0.92
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 6
      // 外框
      ctx.strokeRect(26, 26, W - 52, H - 52)
      // 中线
      ctx.beginPath(); ctx.moveTo(26, H / 2); ctx.lineTo(W - 26, H / 2); ctx.stroke()
      // 中圈
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 78, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = "#ffffff"
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 9, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
      break
    case "basketball":
      // 篮球场：木地板 + 球场线 + 三分弧 + 罚球区
      ctx.globalAlpha = 0.06
      ctx.strokeStyle = "#3a230c"
      for (let x = 24; x < W; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
      ctx.globalAlpha = 0.95
      ctx.strokeStyle = "#fff4e0"
      ctx.lineWidth = 6
      ctx.strokeRect(26, 26, W - 52, H - 52)
      // 罚球区（矩形）
      ctx.strokeRect(W / 2 - 70, 26, 140, 150)
      ctx.fillStyle = "#fff4e0"
      ctx.beginPath(); ctx.arc(W / 2, 176, 9, 0, Math.PI * 2); ctx.fill()
      // 三分弧（下半场）
      ctx.beginPath(); ctx.arc(W / 2, 176, 150, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke()
      ctx.globalAlpha = 1
      break
    case "office":
      // 办公室隔板网格
      ctx.globalAlpha = 0.1
      ctx.strokeStyle = "#1a2430"
      ctx.lineWidth = 4
      for (let x = 0; x <= W; x += 128) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
      for (let y = 0; y <= H; y += 128) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      }
      ctx.globalAlpha = 1
      break
    case "cybercafe":
      // 霓虹网格
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = "#36e0ff"
      ctx.lineWidth = 2
      for (let x = 0; x <= W; x += 64) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
      for (let y = 0; y <= H; y += 64) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      }
      ctx.globalAlpha = 0.25
      ctx.strokeStyle = "#ff3ca0"
      ctx.lineWidth = 4
      ctx.strokeRect(8, 8, W - 16, H - 16)
      ctx.globalAlpha = 1
      break
    case "room":
    default:
      // 室内：极淡的水平接缝
      ctx.globalAlpha = 0.06
      ctx.fillStyle = "#000000"
      for (let y = 0; y < H; y += 64) ctx.fillRect(0, y, W, 2)
      ctx.globalAlpha = 1
      break
  }

  return new CanvasTexture(cv)
}
