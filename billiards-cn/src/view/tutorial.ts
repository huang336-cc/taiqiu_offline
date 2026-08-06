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
  /**
   * v1.1.11：本局是否已显示过引导。用于 force 模式（如练习模式带 tutorial=1）
   * 「本局只显示一次」——否则 onFirst 每杆都 force start，表现为「每次击球都
   * 从第一步重新显示」。页面重新加载（重新进对局）时 static 自动重置为 false。
   */
  private static shownThisGame = false

  static get isActive(): boolean {
    return Tutorial.active
  }

  /**
   * 启动引导。
   * @param force 为 true 时忽略 seenGuide，强制显示（用于「重新打开新手引导」/练习模式）
   */
  static start(force = false) {
    if (Tutorial.active) return
    // v1.1.10：多通道兜底判定。鸿蒙折叠恢复后 localStorage 可能被清/抛错，
    // 仅靠 Settings.get().seenGuide 会误判为「未看过」导致引导循环。
    // 这里用 Settings.hasSeenGuide() 综合判定（内存 cache + 独立 key + globalThis）。
    if (!force && Settings.hasSeenGuide()) return
    // v1.1.11：force 模式本局只显示一次。即使每杆 onFirst 都带 force，
    // 也只在进入对局的第一杆显示，后续杆不再重显。
    if (force && Tutorial.shownThisGame) return
    Tutorial.active = true
    Tutorial.step = 1
    Tutorial.shownThisGame = true
    Tutorial.createOverlay()
    Tutorial.renderStep()
  }

  /** 供「重新打开新手引导」入口重置本局标记，确保下次 start(force) 能再次显示 */
  static resetForReplay() {
    Tutorial.shownThisGame = false
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
    // v1.1.10：幂等性强化。若 overlay 已存在（不应发生但防御），先移除旧的不重建。
    if (Tutorial.overlay) {
      Tutorial.overlay.remove()
      Tutorial.overlay = null
    }
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
    // v1.1.10：三通道写入，避免 localStorage 配额/异常导致 seenGuide 丢失。
    Settings.markSeenGuide()
  }
}

// 调试钩子：仅在 ?debug=1 时暴露，供自动化测试。发布版不带 debug 参数，无副作用。
if (typeof globalThis !== "undefined") {
  const dbg = new URLSearchParams(globalThis.location?.search).get("debug")
  if (dbg === "1") {
    ;(globalThis as any).__Tutorial = Tutorial
  }
}
