import { id } from "../utils/dom"

export interface NotificationHighBreak {
  score: number
  url: string
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
}

export type NotificationActionHandlers = Record<string, () => void>

export class Notification {
  element: HTMLDivElement
  overlay: HTMLDivElement | null
  timeoutId: number | null = null
  actionHandlers: NotificationActionHandlers = {}
  /** 是否允许触碰屏幕关闭（仅对无操作按钮的提示生效） */
  private touchDismiss = false
  /** 触碰关闭锁定期截止时间（ms），期间忽略触碰以免把触发提示的那一下也关掉 */
  private touchLockUntil = 0

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
      this.touchDismiss = !this.hasActionButtons(data)
    }

    this.display(content, typeClass, duration)
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
        </div>
        ${footerContentHtml}
      </div>
    `

    return { content, typeClass }
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
    return `
      <button
        type="button"
        class="notification-high-break"
        data-notification-upload-url="${highBreak.url}"
        title="Open high break ${highBreak.score}"
      >
        <span class="notification-high-break-label">Break : ${highBreak.score}</span>
        <span class="notification-high-break-icon">${medals}</span>
        <span class="notification-high-break-upload">upload⇗</span>
      </button>
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

  private display(content: string, typeClass: string, duration: number) {
    if (!this.element) return
    this.element.innerHTML = content
    this.element.className = "" // Clear previous classes
    this.element.classList.add(...typeClass.split(" "))
    this.element.style.display = "flex"
    if (this.overlay) {
      this.overlay.style.pointerEvents = "auto"
    }
    // 锁定一小段时间，避免触发本次提示的那一下触摸被误判为「关闭」
    this.touchLockUntil = performance.now() + 400

    if (this.timeoutId) {
      globalThis.clearTimeout(this.timeoutId)
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
      const uploadButton = target?.closest(
        "[data-notification-upload-url]"
      ) as HTMLElement | null
      const uploadUrl = uploadButton?.dataset.notificationUploadUrl
      if (uploadUrl) {
        globalThis.location.replace(uploadUrl)
        return
      }
      const button = target?.closest(
        "[data-notification-action]"
      ) as HTMLElement | null
      const action = button?.dataset.notificationAction
      if (!action) return
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
        globalThis.location.reload()
        break
      case "menu":
      case "lobby":
        globalThis.location.href = "menu.html"
        break
      case "rematch":
        if (url) {
          globalThis.location.href = url
        }
        break
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
