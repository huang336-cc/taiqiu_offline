import { Settings } from "../utils/settings"

/**
 * v1.2.6：分步实操新手引导改为 3 步：
 *   步骤 1：💡 犯规后可点击球桌任意位置摆白球（说明） + 「知道了」按钮
 *          —— 期间禁用击球/瞄准控件，游戏不会「自动开始」，避免点击「重新打开新手引导」
 *             后立即进入可玩状态。用户读完按「知道了」→ 解锁控件 + 进入步骤 2。
 *   步骤 2：在球桌上左右拖动 / 拉横向瞄准条 → 调整瞄准方向（绿线指向被击球）
 *   步骤 3：点击右下角「击球」按钮 → 出杆
 * 用户完成击球后引导自动消失，并写入 seenGuide，之后不再自动弹出。
 *
 * 引导浮层本身 pointer-events:none，让出触摸；按钮（.tut-actions）单独 pointer-events:auto。
 * 引导激活期间调用 aimInputs.setDisabled(true) 锁定控件；步骤 1 按钮按下后切回 false。
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
  /**
   * v1.2.6：缓存 aimInputs，便于在步骤切换 / 结束时切换禁用态。
   */
  private static aimInputsRef: { setDisabled(d: boolean): void } | null = null

  static get isActive(): boolean {
    return Tutorial.active
  }

  /**
   * 启动引导。
   * @param force 为 true 时忽略 seenGuide，强制显示（用于「重新打开新手引导」/练习模式）
   */
  static start(force = false) {
    if (Tutorial.active) return
    // v1.1.10：多通道兜底判定。仅靠 Settings.get().seenGuide 会误判导致引导循环。
    if (!force && Settings.hasSeenGuide()) return
    // v1.1.11：force 模式本局只显示一次。
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

  /** v1.2.6：步骤 2 推进（用户做了瞄准动作） */
  static notifyAimDrag() {
    if (!Tutorial.active) return
    if (Tutorial.step === 2) {
      Tutorial.step = 3
      Tutorial.renderStep()
    }
  }

  /** v1.2.6：步骤 3 完成 → 结束引导 */
  static notifyShot() {
    if (!Tutorial.active) return
    Tutorial.finish()
  }

  private static renderStep() {
    if (!Tutorial.overlay) return
    const textEl = Tutorial.overlay.querySelector(".tut-text") as HTMLElement | null
    const actionsEl = Tutorial.overlay.querySelector(
      ".tut-actions"
    ) as HTMLElement | null
    if (!textEl) return
    if (Tutorial.step === 1) {
      // v1.2.6：第一步改为「摆白球」说明，并要求用户点「知道了」才解锁。
      textEl.innerHTML =
        "👋 <b>欢迎</b>：犯规后点击球桌<b>任意位置</b>即可放置白球；准备好了点下方按钮开始"
      if (actionsEl) {
        actionsEl.innerHTML =
          '<button type="button" class="tut-btn" data-tut-ack="1">知道了，开始 →</button>'
      }
      // 锁定控件：直到用户按「知道了」
      Tutorial.lockControls(true)
    } else if (Tutorial.step === 2) {
      textEl.innerHTML =
        "👆 <b>第 2 步</b>：在球桌上<b>左右拖动</b>（或拖<b>瞄准条</b>），调整瞄准方向"
      if (actionsEl) actionsEl.innerHTML = ""
      Tutorial.lockControls(false)
    } else if (Tutorial.step === 3) {
      textEl.innerHTML =
        "👉 <b>第 3 步</b>：点击右下角的 <b>「击球」</b> 按钮，把球打出去！"
      if (actionsEl) actionsEl.innerHTML = ""
      Tutorial.lockControls(false)
    }
  }

  private static createOverlay() {
    if (Tutorial.overlay) {
      Tutorial.overlay.remove()
      Tutorial.overlay = null
    }
    const div = document.createElement("div")
    div.className = "tutorial-banner"
    div.innerHTML = '<div class="tut-text"></div><div class="tut-actions"></div>'
    document.body.appendChild(div)
    Tutorial.overlay = div
    // 委托处理「知道了」点击
    div.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const ack = target.getAttribute("data-tut-ack")
      if (ack === "1" && Tutorial.active && Tutorial.step === 1) {
        // 解锁控件 + 进入步骤 2
        Tutorial.step = 2
        Tutorial.renderStep()
      }
    })
  }

  /**
   * v1.2.6：锁定 / 解锁瞄准控件。
   * force 模式下，aim.ts 不立即 setDisabled(false)，
   * 把这一步交给 Tutorial 在步骤切换时控制，避免「重新打开新手引导」后
   * 控件立即可玩（即「游戏自行开启」）。
   */
  private static lockControls(lock: boolean) {
    // 从全局读取 aimInputs（由 aim.ts 提供）。
    // 用一个 globalThis 上的轻量缓存指针，避免循环依赖。
    const ref = (globalThis as any).__AimInputs as
      | { setDisabled(d: boolean): void }
      | undefined
    if (ref && typeof ref.setDisabled === "function") {
      ref.setDisabled(lock)
      Tutorial.aimInputsRef = ref
    }
  }

  private static finish() {
    Tutorial.active = false
    if (Tutorial.overlay) {
      Tutorial.overlay.remove()
      Tutorial.overlay = null
    }
    // v1.2.7 #D1：不再在此处 setDisabled(false)。
    // 出杆瞬间 Aim.playShot() 已 setDisabled(true)，本应让控件在击球动画期间保持禁用，
    // 避免动画中误操作；下一杆 Aim.onFirst 会依据「是否已看过引导」正确重新启用。
    // 此前这里强行 setDisabled(false) 会与 playShot 的禁用打架，且在 force 教程模式下
    // 会掩盖「首杆后控件被永久锁死、无法继续击球」的根因。
    // v1.1.10：三通道写入 seenGuide
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