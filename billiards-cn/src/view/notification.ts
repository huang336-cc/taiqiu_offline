import { id } from "../utils/dom"
import { resetSeries } from "../utils/series"

export interface NotificationHighBreak {
  score: number
  url: string
}

export interface NotificationDetail {
  label?: string
  value: string
  /**
   * v1.3.68：补充指引。取不到本机 IP 等"有原因但用户不知怎么办"的场景，
   * 用它告诉用户下一步操作（如「请到 设置 → Wi-Fi → 当前网络 查看 IP 地址」）。
   */
  hint?: string
  /**
   * v1.3.93：详情块左侧的**进度指示**，取值语义：
   *   "spin"  → 转圈（正在连接 / 正在取 IP 等"等待中"状态）
   *   "ok"    → 对勾（已连上）
   *   "warn"  → 感叹号（连上了但有问题，如端口顺延）
   *   "error" → 叉号（失败）
   *   省略    → 不渲染指示，纯信息（本机房间地址这类"要抄给对手"的内容
   *             不该带状态色，免得被误读成"出问题了"）
   *
   * 局域网对战的四个状态（取 IP / 连接中 / 已连接 / 失败）此前在视觉上
   * **完全一样**，用户只能靠读文字分辦。加这个字段后一眼就能看出处于哪一步。
   */
  state?: "spin" | "ok" | "warn" | "error"
  /**
   * v1.3.93：把 value 渲染成**大号等宽可抄写**样式（IP 地址、目标主机）。
   * 与 state 互斥使用于「本机房间地址」这种"给对方念"的场景。
   */
  mono?: boolean
}

export interface NotificationData {
  type: "Foul" | "GameOver" | "Info"
  title: string
  subtext?: string
  matchScore?: string
  highBreaks?: NotificationHighBreak[]
  extra?: string
  duration?: number
  icon?: string
  extraClass?: string
  // v1.3.67：长驻提示。开启后不设 timeout、不响应触碰关闭，可被同 key 的
  // 后续 notify 覆盖；可被外部 dismiss(key) 主动关闭。
  sticky?: boolean
  /** 身份标识，用于 dismiss(key) 与覆盖判定（仅 sticky 时有意义） */
  key?: string
  /** 长驻提示里的「主信息块」（如本机 IP、目标主机）。会渲染成金边 + 复制按钮 */
  detail?: NotificationDetail
}

export type NotificationActionHandlers = Record<string, () => void>

/**
 * v1.3.76：「再来一局 / 继续对战」的**确定性重开**。
 *
 * 原先直接 `location.reload()`，在真机上偶发「点完继续对战却直接退出游戏」：
 *  1. reload 原样保留当前 URL。若 URL 上还挂着 `?state=` / `?replayId=`
 *     （本页此前看过回放时会残留），重开后 BrowserContainer 会再次走进
 *     回放分支；`?replayId=` 对应的 sessionStorage 数据在重载后已失效，
 *     它会 **不由分说地自动跳回主菜单**（browsercontainer.ts 的兜底分支）——
 *     这正是「没点返回却自己退出」的一种来源。
 *  2. reload 会在历史栈上再叠一条记录，与返回键确认脚本的
 *     pushState / popstate 兜底互相干扰，某些 WebView 上会触发一次意外的
 *     后退导航。
 *
 * 改法：显式重建一个干净 URL（只丢回放相关参数，其余如 bot / ruletype /
 * timer 全部保留），用 `location.replace` 而不是 `reload` —— 不新增历史
 * 条目、不触发后退语义，并用一次性锁杜绝连点/双事件导致的重复导航。
 */
const RESTART_DROP_PARAMS = ["state", "replayId", "replay", "_r"]
let restartPending = false

export function restartGame(): void {
  if (restartPending) return
  restartPending = true
  try {
    const url = new URL(globalThis.location.href)
    for (const key of [...url.searchParams.keys()]) {
      if (RESTART_DROP_PARAMS.includes(key)) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.set("_r", String(Date.now()))
    globalThis.location.replace(url.toString())
    return
  } catch (e) {
    // 极老的 WebView 没有 URL 构造器 → 退回原来的 reload
  }
  globalThis.location.reload()
}

export class Notification {
  element: HTMLDivElement
  overlay: HTMLDivElement | null
  timeoutId: number | null = null
  actionHandlers: NotificationActionHandlers = {}
  /** 是否允许触碰屏幕关闭（仅对无操作按钮的提示生效） */
  private touchDismiss = false
  /** 触碰关闭锁定期截止时间（ms），期间忽略触碰以免把触发提示的那一下也关掉 */
  private touchLockUntil = 0
  /**
   * v1.3.67：当前 sticky 提示的身份 key。仅当一则提示 sticky=true 时设置；
   * dismiss(key) 仅在 key 匹配时清掉它，clear() 默认无 key 等价于 dismiss()，
   // 可被外部强制清空（stickyKey=null）后强制关闭。
   */
  stickyKey: string | null = null

  /**
   * v1.3.76：结算面板（GameOver）当前是否在屏。
   * 比赛已经结束后偶有「最后一杆同时判了犯规」的提示晚一步到达，
   * 它会把结算面板整个替换掉——玩家看到的是「结算按钮凭空消失」，
   * 观感等同自动退出。这里让结算面板在屏时直接忽略犯规提示。
   */
  private showingGameOver = false

  constructor() {
    this.overlay = id("notificationOverlay") as HTMLDivElement | null
    this.element = id("notification") as HTMLDivElement
    this.bindActions()
    // 屏幕触碰即关闭：仅对无操作按钮的提示（如「祝你好运」、犯规）生效。
    // 带确认/继续/上传等按钮的提示（认输、结算、破纪录）不受影响。
    const dismiss = this.dismissOnTouch
    this.overlay?.addEventListener("pointerdown", dismiss)
    this.element.addEventListener("pointerdown", dismiss)
    document.addEventListener("pointerdown", dismiss)
  }

  private getIcon(data: NotificationData): string {
    if (data.icon) return data.icon
    if (data.type === "Foul") return "🎱"
    if (data.type === "GameOver") return "🏆"
    return "🔵"
  }

  show(
    data: NotificationData | string,
    defaultDuration: number = 3000,
    actionHandlers?: NotificationActionHandlers
  ) {
    if (!this.element) return
    this.actionHandlers = actionHandlers ?? {}

    let content: string
    let typeClass: string
    let duration = defaultDuration

    if (typeof data === "string") {
      content = this.renderStringContent(data)
      typeClass = "type-Info"
      // 纯文本提示（如「祝你好运」）允许触碰关闭
      this.touchDismiss = true
    } else {
      const result = this.processData(data)
      content = result.content
      typeClass = result.typeClass
      if (data.duration !== undefined) {
        duration = data.duration
      }
      // 带操作按钮 / 上传按钮的提示（认输、结算、破纪录）不要触碰即关，
      // 否则会挡住用户点击按钮。
      // v1.3.67：sticky 提示也禁用触碰关闭（需要长驻到外部 dismiss）。
      this.touchDismiss =
        !data.sticky && !this.hasActionButtons(data)
    }

    // v1.3.76：结算面板在屏时不再被犯规提示冲掉（见 showingGameOver 注释）
    if (
      typeof data === "object" &&
      data?.type === "Foul" &&
      this.showingGameOver
    ) {
      return
    }

    // v1.3.67：粘性守卫 —— 如果当前有 sticky 提示在屏，且这次不是同 key 的
    // sticky 覆盖也不是新的 sticky（普通提示想显示），则直接把旧的 sticky 关掉
    // 让路（避免瞬时提示被吞）。同 key 的 sticky 走覆盖路径仍允许更新内容。
    if (
      this.stickyKey &&
      !(typeof data === "object" && data.sticky === true)
    ) {
      this.clear()
    }

    this.display(content, typeClass, duration, data)
  }

  private renderStringContent(message: string): string {
    return `
      <div class="notification-banner">
        <div class="notification-text-group">
          <div class="notification-subtext">${message}</div>
        </div>
      </div>
    `
  }

  private processData(data: NotificationData) {
    let typeClass = `type-${data.type}`
    if (data.extraClass) {
      typeClass += ` ${data.extraClass}`
    }
    const icon = this.getIcon(data)
    const footerContentHtml = this.renderFooter(data)
    const detailHtml = this.renderDetail(data)

    const content = `
      <div class="notification-banner">
        <div class="notification-content-wrapper">
          <div class="notification-main">
            <div class="notification-icon">${icon}</div>
            <div class="notification-text-group">
              <div class="notification-title">${data.title}</div>
              ${(() => {
                if (!data.subtext) return ""
                const subtextClass =
                  data.type === "GameOver" ? " notification-subtext-light" : ""
                return `<div class="notification-subtext${subtextClass}">${data.subtext}</div>`
              })()}
            </div>
          </div>
          ${data.matchScore ? `<div class="notification-match-score">${data.matchScore}</div>` : ""}
          ${detailHtml}
        </div>
        ${footerContentHtml}
      </div>
    `

    return { content, typeClass }
  }

  /**
   * v1.3.67：渲染 sticky 提示里的 detail 子块（如本机 IP）。
   * 仅在 data.detail 存在时输出。value 转义避免被当 HTML 解析。
   *
   * v1.3.82：**移除「复制」按钮**（用户要求）。
   * 局域网对战的房间地址现在在弹窗里直接展示为纯文本，用户手抄或直接念给
   * 对方即可 —— 按钮既占地方，在小屏上还容易误触。历史上 v1.3.68 曾按
   * value 是否匹配 `^[0-9a-zA-Z.:_-]{4,64}$` 来决定是否渲染该按钮，现整段删除；
   * 对应的事件处理分支仍保留（见下方 copy-ip），避免旧页面残留按钮时点击报错。
   *
   * v1.3.93：新增状态指示（转圈/对勾/警告/错误）与等宽大字两类渲染。
   * 此前「取 IP 中 / 连接中 / 已连接 / 失败」四种状态在视觉上完全一致，
   * 用户只能读文字分辨；现在左侧有图标、等待态有旋转动画，一眼可辨。
   */
  private renderDetail(data: NotificationData): string {
    if (!data.detail || !data.detail.value) return ""
    const label = data.detail.label
      ? `<div class="notification-detail-label">${this.escapeHtml(data.detail.label)}</div>`
      : ""
    const valueClass = data.detail.mono
      ? "notification-detail-value notification-detail-mono"
      : "notification-detail-value"
    const value = this.escapeHtml(data.detail.value)
    const hint = data.detail.hint
      ? `<div class="notification-detail-hint">${this.escapeHtml(data.detail.hint)}</div>`
      : ""
    const stateClass = data.detail.state
      ? ` notification-detail-state-${data.detail.state}`
      : ""
    const indicator = data.detail.state
      ? `<span class="notification-detail-state"><i class="notification-state-icon"></i></span>`
      : ""
    return `
      <div class="notification-detail${stateClass}">
        ${label}
        <div class="notification-detail-row">
          ${indicator}
          <span class="${valueClass}">${value}</span>
        </div>
        ${hint}
      </div>
    `
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }

  private renderFooter(data: NotificationData): string {
    const highBreaksHtml = this.renderHighBreaks(data.highBreaks)
    const extraHtml = this.renderExtra(data.extra)
    if (!highBreaksHtml && !extraHtml) {
      return ""
    }

    return `
      <div class="notification-footer">
        ${highBreaksHtml}
        ${extraHtml}
      </div>
    `
  }

  private renderExtra(extra?: string): string {
    if (!extra) return ""
    if (extra.includes("<")) {
      return `<div class="notification-actions">${extra}</div>`
    }
    return `<div class="notification-badge">${extra}</div>`
  }

  private renderHighBreaks(highBreaks?: NotificationHighBreak[]): string {
    if (!highBreaks || highBreaks.length === 0) {
      return ""
    }

    const items = highBreaks
      .slice(0, 3)
      .map((highBreak, index) => this.renderHighBreakButton(highBreak, index))
      .join("")

    return `<div class="notification-high-breaks">${items}</div>`
  }

  private renderHighBreakButton(
    highBreak: NotificationHighBreak,
    index: number
  ): string {
    const medals = "🎖️".repeat(Math.max(0, 3 - index))
    // v1.2.5：原项目这里是一个「upload⇗」在线高分上传按钮（跳转外部 URL），
    // 离线单机版无任何服务器，点了只会失效。改为纯信息徽章展示「高杆连击」战绩，
    // 真正的回放功能由结算面板的「查看回放」按钮（经 sessionStorage 传完整数据）提供。
    return `
      <div class="notification-high-break" title="高杆连击 ${highBreak.score}">
        <span class="notification-high-break-label">高杆 ${highBreak.score} 连</span>
        <span class="notification-high-break-icon">${medals}</span>
      </div>
    `
  }

  updateHighBreaks(highBreaks?: NotificationHighBreak[]) {
    const footer = this.element?.querySelector(".notification-footer")
    if (footer) {
      let container = footer.querySelector(
        ".notification-high-breaks"
      ) as HTMLElement | null
      if (!container) {
        container = document.createElement("div")
        container.className = "notification-high-breaks"
        footer.prepend(container)
      }
      container.innerHTML = highBreaks
        ? highBreaks
            .slice(0, 3)
            .map((hb, index) => this.renderHighBreakButton(hb, index))
            .join("")
        : ""
    }
  }

  private display(
    content: string,
    typeClass: string,
    duration: number,
    data?: NotificationData | string
  ) {
    if (!this.element) return
    this.element.innerHTML = content
    this.element.className = "" // Clear previous classes
    this.element.classList.add(...typeClass.split(" "))
    this.showingGameOver = typeClass.includes("type-GameOver")
    this.element.style.display = "flex"
    if (this.overlay) {
      this.overlay.style.pointerEvents = "auto"
    }
    // 锁定一小段时间，避免触发本次提示的那一下触摸被误判为「关闭」
    this.touchLockUntil = performance.now() + 400

    if (this.timeoutId) {
      globalThis.clearTimeout(this.timeoutId)
    }

    // v1.3.67：记录 sticky key，供外部 dismiss(key) 关闭
    if (typeof data === "object" && data?.sticky) {
      this.stickyKey = data.key ?? "__sticky"
    }

    if (duration > 0) {
      this.timeoutId = globalThis.setTimeout(() => {
        this.clear()
      }, duration) as unknown as number
    }
  }

  private bindActions() {
    if (!this.element) {
      return
    }
    ;["pointerdown", "mousedown", "touchstart", "click"].forEach(
      (eventName) => {
        this.element.addEventListener(eventName, (event) => {
          event.stopPropagation()
        })
      }
    )
    this.element.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest(
        "[data-notification-action]"
      ) as HTMLElement | null
      const action = button?.dataset.notificationAction
      if (!action) return
      // v1.3.93：**按钮防连点**。
      //
      // 局域网失败弹窗上的「重新连接」会重走整个建链流程（关 ws → 清诊断 →
      // startJoin → 起 6 秒超时）。用户在"没反应"的等待里习惯性连点，旧代码
      // 每一下都会触发一次完整重连：反复 close/connect、反复重置 6 秒计时器，
      // 结果是**永远等不到那一秒超时**，界面看起来就是"点了没反应"。
      // 这里在点击瞬间把按钮置为忙碌态并停止响应，直到弹窗被下一次
      // show()/clear() 整体重建（新 DOM 天然是可用状态）。
      if (button.dataset.busy === "1") return
      button.dataset.busy = "1"
      button.setAttribute("disabled", "disabled")
      button.classList.add("is-busy")
      this.handleAction(action, button.dataset.notificationUrl)
    })
  }

  private handleAction(action: string, url?: string) {
    const handler = this.actionHandlers[action]
    if (handler) {
      handler()
      return
    }

    switch (action) {
      case "clear":
        this.clear()
        break
      case "reload":
      case "replay":
        // v1.3.76：走确定性重开（干净 URL + replace + 一次性锁），
        // 不再裸调 location.reload()
        restartGame()
        break
      case "menu":
      case "lobby":
        // v1.3.75：结算面板的「返回主菜单」此前直接跳走并静默清零系列赛比分。
        // 现改为与系统返回键共用同一套金棕木纹确认弹窗（提示会清零系列赛比分），
        // 由弹窗在用户确认后才真正 resetSeries + 跳转；无弹窗脚本时退回原行为。
        {
          const confirmExit = (
            globalThis as unknown as { __showExitConfirm?: () => void }
          ).__showExitConfirm
          if (typeof confirmExit === "function") {
            confirmExit()
            break
          }
          // v1.3.65：退回主菜单即结束这轮系列赛，清掉「你 X : Y 电脑」的累计。
          // 不清的话，下次进同一玩法会接着上次的比分算，语义不对。
          resetSeries()
          globalThis.location.href = "menu.html"
        }
        break
      case "rematch":
        if (url) {
          globalThis.location.href = url
        }
        break
      // v1.3.67：sticky 弹窗内的复制按钮 —— 把 detail.value 写入剪贴板。
      case "copy-ip": {
        const v =
          this.element?.querySelector(".notification-detail-value")
            ?.textContent ?? ""
        if (v) {
          try {
            navigator.clipboard?.writeText(v).catch(() => {})
          } catch {
            // 剪贴板权限被拒，忽略
          }
        }
        break
      }
    }
  }

  clear() {
    if (this.element) {
      this.element.innerHTML = ""
      this.element.style.display = "none"
      this.element.className = ""
    }
    if (this.overlay) {
      this.overlay.style.pointerEvents = "none"
    }
    this.actionHandlers = {}
    this.touchDismiss = false
    if (this.timeoutId) {
      globalThis.clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
    // v1.3.67：清掉 sticky 身份，避免影响后续提示判定
    this.stickyKey = null
    // v1.3.76：结算面板已离屏，犯规提示恢复正常显示
    this.showingGameOver = false
  }

  /**
   * v1.3.67：按 key 选择性关闭当前 sticky 提示。
   * - 无 key：仅当当前有 sticky 时关闭（保持开局时 init.handleBegin 的"开局关窗"语义）。
   * - 有 key：仅在 stickyKey 匹配时关闭（避免误关后续犯规/结算提示）。
   * - 不匹配：no-op，原样保留当前显示。
   */
  dismiss(key?: string): void {
    if (!this.stickyKey) return
    if (key !== undefined && key !== this.stickyKey) return
    this.clear()
  }

  /** 提示框当前是否处于显示状态 */
  private isVisible(): boolean {
    return this.element?.style.display === "flex"
  }

  /** 提示是否带可点击的操作 / 上传按钮（这类提示不应触碰即关） */
  private hasActionButtons(data: NotificationData): boolean {
    if (data.highBreaks && data.highBreaks.length > 0) return true
    if (data.extra && data.extra.includes("data-notification-action")) {
      return true
    }
    return false
  }

  /**
   * 触碰屏幕任意位置（遮罩 / 提示框本身 / 文档）即关闭提示。
   * 仅当 touchDismiss 为真且已过锁定期，且提示当前可见时生效。
   */
  private dismissOnTouch = () => {
    if (!this.touchDismiss) return
    if (performance.now() < this.touchLockUntil) return
    if (this.isVisible()) {
      this.clear()
    }
  }
}
