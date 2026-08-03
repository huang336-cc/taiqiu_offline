import { Settings } from "../utils/settings"

/**
 * 分步实操新手引导（item 6）。
 *
 * 与旧版「一整页文字说明」不同，本引导在玩家进入对局后，
 * 以**非模态横幅**方式逐步引导用户**实际做一次操作**：
 *   步骤 1：在球桌上左右拖动 → 调整瞄准方向
 *   步骤 2：点击右下角「击球」按钮 → 出杆
 * 用户完成击球后引导自动消失，并写入 seenGuide，之后不再自动弹出。
 *
 * 引导不拦截任何输入（pointer-events:none），用户照常操作即可。
 */
export class Tutorial {
  private static active = false
  private static overlay: HTMLElement | null = null
  private static step = 0

  static get isActive(): boolean {
    return Tutorial.active
  }

  /**
   * 启动引导。
   * @param force 为 true 时忽略 seenGuide，强制显示（用于「重新打开新手引导」）
   */
  static start(force = false) {
    if (Tutorial.active) return
    const s = Settings.get()
    if (!force && s.seenGuide) return
    Tutorial.active = true
    Tutorial.step = 1
    Tutorial.createOverlay()
    Tutorial.renderStep()
  }

  /** 用户完成一次瞄准拖动（步骤 1）→ 进入步骤 2 */
  static notifyAimDrag() {
    if (!Tutorial.active) return
    if (Tutorial.step === 1) {
      Tutorial.step = 2
      Tutorial.renderStep()
    }
  }

  /** 用户完成一次击球（步骤 2）→ 结束引导 */
  static notifyShot() {
    if (!Tutorial.active) return
    Tutorial.finish()
  }

  private static renderStep() {
    if (!Tutorial.overlay) return
    const el = Tutorial.overlay.querySelector(".tut-text")
    if (!el) return
    if (Tutorial.step === 1) {
      el.innerHTML =
        "👆 <b>第 1 步</b>：在球桌上<b>左右拖动</b>，调整瞄准方向（绿线指向球的方向）"
    } else if (Tutorial.step === 2) {
      el.innerHTML =
        "👉 <b>第 2 步</b>：点击右下角的 <b>「击球」</b> 按钮，把球打出去！"
    }
  }

  private static createOverlay() {
    const div = document.createElement("div")
    div.className = "tutorial-banner"
    div.innerHTML = '<div class="tut-text"></div>'
    document.body.appendChild(div)
    Tutorial.overlay = div
  }

  private static finish() {
    Tutorial.active = false
    if (Tutorial.overlay) {
      Tutorial.overlay.remove()
      Tutorial.overlay = null
    }
    const s = Settings.get()
    s.seenGuide = true
    Settings.save()
  }
}
