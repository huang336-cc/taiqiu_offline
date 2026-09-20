import { Color, CubeTexture } from "three"

export class BallCubeTextureFactory {
  private static readonly textureCache: Map<string, CubeTexture> = new Map()
  private static readonly dotColor = "#cc0000"

  /**
   * 取（或创建）球的立方体贴图。
   *
   * ⚠️ v1.3.85 修复「母球带 6 个红点」。
   *
   * 病史：本工厂给**每张面的中心**画一个暗红点，用来在彩球上做定位标记。
   * 但 `Rack.unlabeledAppearance()` 在 lod > 1 时把**母球**也交给
   * `"texturedDots"` 分支，于是纯白母球被贴上 6 个红点 —— 玩家看到的是
   * 一颗"掉色/长斑"的白球，而不是干净的母球。
   *
   * 修复：纯白球（母球）不画点，只填底色。判定放在工厂内部，
   * 这样所有调用方（`texturedDots` / 未来其它分支）都自动正确。
   */
  static getOrCreateTexture(color: Color, size = 128, dotScale = 0.1) {
    // 母球（纯白）不加点标记
    const isCueBall = color.getHex() === 0xffffff
    const key = `${color.getHex()}_${size}_${dotScale}_${isCueBall ? "plain" : "dot"}`
    if (this.textureCache.has(key)) {
      return this.textureCache.get(key)!
    }

    const texture = this.createTexture(
      color,
      size,
      dotScale,
      isCueBall ? null : this.dotColor
    )
    this.textureCache.set(key, texture)
    return texture
  }

  /**
   * @param dotColor  点标记颜色；null = 不画点（母球）
   */
  private static createTexture(
    color: Color,
    size: number,
    dotScale: number,
    dotColor: string | null
  ) {
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    dotScale = color.getHexString() === "ff0000" ? 0.08 : dotScale

    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.fillStyle = `#${color.getHexString()}`
      ctx.fillRect(0, 0, size, size)

      if (dotColor !== null) {
        // 红球用白点（对比度更高），其余球用暗红点
        const dc =
          color.getHexString() === "ff0000" ? "#ffffff" : dotColor
        ctx.beginPath()
        ctx.arc(size / 2, size / 2, size * dotScale, 0, Math.PI * 2)
        ctx.fillStyle = dc
        ctx.fill()
      }
    }

    const texture = new CubeTexture(Array(6).fill(canvas))
    texture.needsUpdate = true
    return texture
  }
}
