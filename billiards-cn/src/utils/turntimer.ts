import { Session } from "../network/client/session"

/**
 * 电脑对战每回合倒计时（仅在 vs 电脑模式下生效）
 *
 * 触发条件：
 *   - 当前 controller 是「玩家在打」的阶段（Aim / PlaceBall）
 *   - 倒计时未启用（turnTimerSeconds <= 0）则直接跳过
 *
 * 超时行为：
 *   - 推送一条 NotificationEvent 提示「本回合超时」
 *   - 推送 ConcedeEvent，由 rules.handleGameEnd 判负（玩家认输）
 *
 * HUD 显示交给浏览器侧（CSS 注入等），这里只负责节拍控制。
 */
export class TurnTimer {
  // 倒计时总时长（秒）；0 或负数表示未启用
  seconds: number = 0
  // 剩余时间（秒）
  remaining: number = 0
  // 是否当前正在「玩家回合」中计时
  running: boolean = false
  // 是否已经超时（避免重复推 ConcedeEvent）
  expired: boolean = false
  // 上一帧的剩余时间（用于检测跨秒的整数边界）
  lastWholeSecond: number = 0
  // 倒计时变化回调（可选，由 HUD 订阅）
  onTick: ((remaining: number) => void) | null = null
  onExpire: (() => void) | null = null

  constructor() {
    this.seconds = 0
    this.remaining = 0
    this.running = false
    this.expired = false
    this.lastWholeSecond = 0
  }

  /** 是否启用（即 Session 配了 timer > 0 且处于电脑模式） */
  enabled(): boolean {
    return this.seconds > 0 && Session.isBotMode()
  }

  /** 进入「玩家回合」时调用，重置倒计时 */
  start() {
    if (!this.enabled()) {
      this.running = false
      this.remaining = 0
      this.lastWholeSecond = 0
      return
    }
    this.remaining = this.seconds
    this.lastWholeSecond = Math.ceil(this.remaining)
    this.running = true
    this.expired = false
    if (this.onTick) this.onTick(this.remaining)
  }

  /** 离开「玩家回合」时调用（玩家已击球 / 切到对手回合），停止计时 */
  stop() {
    if (!this.running) return
    this.running = false
    this.remaining = 0
    this.lastWholeSecond = 0
    if (this.onTick) this.onTick(0)
  }

  /** 每帧调用。dt 是这一帧的物理步进秒数。 */
  tick(dt: number): { justExpired: boolean } {
    if (!this.running || this.expired) return { justExpired: false }
    this.remaining = Math.max(0, this.remaining - dt)
    const whole = Math.ceil(this.remaining)
    if (whole !== this.lastWholeSecond) {
      this.lastWholeSecond = whole
      if (this.onTick) this.onTick(this.remaining)
    }
    if (this.remaining <= 0 && !this.expired) {
      this.expired = true
      this.running = false
      if (this.onExpire) this.onExpire()
      return { justExpired: true }
    }
    return { justExpired: false }
  }

  /** 设置当前回合时限（启动游戏时由 BrowserContainer 调用） */
  configure(seconds: number) {
    this.seconds = Math.max(0, Math.floor(seconds || 0))
    this.remaining = 0
    this.running = false
    this.expired = false
    this.lastWholeSecond = 0
  }
}
