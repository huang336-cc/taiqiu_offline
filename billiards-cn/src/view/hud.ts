import { id } from "../utils/dom"
import type { Table } from "../model/table"
import type { Ball } from "../model/ball"
import { Session } from "../network/client/session"

export class Hud {
  p1Element: HTMLElement | null
  p2Element: HTMLElement | null
  middleElement: HTMLElement | null
  breakElement: HTMLElement | null
  /** v1.2.6：v2 计分板——选手列容器 + 标签 + 已进球行 */
  private readonly p1PlayerEl: HTMLElement | null
  private readonly p2PlayerEl: HTMLElement | null
  private readonly p1LabelEl: HTMLElement | null
  private readonly p2LabelEl: HTMLElement | null
  private readonly p1BallsEl: HTMLElement | null
  private readonly p2BallsEl: HTMLElement | null
  /** 顶部「break」分（老 HUD 兼容），新 v2 比分栏不展示 */
  breakScoreElement: HTMLElement | null
  timeTextElement: HTMLElement | null

  /**
   * v1.2.6：每位玩家已进球球号集合。在 advance() 每帧调用 updatePocketedBalls 时，
   * 通过对比前后落袋集合，把新增的球号归到「当前回合选手」（setActivePlayer 设置）。
   * 这样进球归属准确：球在 shot 动画期间落袋，active 仍是出杆选手，不会被算到下一杆。
   */
  private readonly playerPocketed: { 1: Set<number>; 2: Set<number> } = {
    1: new Set(),
    2: new Set(),
  }
  private prevPocketedAll = new Set<number>()
  private activePlayer: 1 | 2 = 1

  // 训练模式判定
  private readonly isTrainMode: boolean = false
  private timerId: number | null = null
  private timerStart: number = 0

  constructor() {
    this.p1Element = id("p1Score")
    this.p2Element = id("p2Score")
    this.breakScoreElement = id("breakScore")
    this.p1PlayerEl = document.querySelector<HTMLElement>(".sc-player[data-player='1']")
    this.p2PlayerEl = document.querySelector<HTMLElement>(".sc-player[data-player='2']")
    this.p1LabelEl = id("scP1Label")
    this.p2LabelEl = id("scP2Label")
    this.p1BallsEl = id("p1Balls")
    this.p2BallsEl = id("p2Balls")

    this.middleElement = id("hudMiddle")

    this.timeTextElement = id("scTimeText")

    // v1.2.6：根据模式设置选手标签：p1 永远是「玩家」，p2 在电脑对战时为「电脑」，其他为「对手」
    // v1.3.19：标签随界面语言切换（中文 / English），读取与主菜单共用的 localStorage 设置
    const isEn = (() => {
      try {
        const raw = localStorage.getItem("billiards_cn_settings_v1")
        if (raw) {
          const s = JSON.parse(raw)
          if (s && (s.language === "en" || s.language === "zh")) return s.language === "en"
        }
      } catch (_) {}
      return false
    })()
    if (this.p1LabelEl) this.p1LabelEl.textContent = isEn ? "You" : "玩家"
    if (this.p2LabelEl) {
      this.p2LabelEl.textContent = Session.isBotMode()
        ? (isEn ? "CPU" : "电脑")
        : (isEn ? "Opponent" : "对手")
    }

    // 训练模式 → body.train-mode（CSS 隐藏 p2 列与共享已进球区）
    try {
      const params = new URLSearchParams(location.search)
      const ruleType = params.get("ruletype") ?? ""
      const isPractice = params.get("practice") === "true"
      if (
        ruleType === "train" ||
        ruleType === "training" ||
        ruleType === "practice" ||
        isPractice
      ) {
        document.body.classList.add("train-mode")
      }
    } catch (_) {
      // 忽略 URL 解析失败
    }
    this.isTrainMode = document.body.classList.contains("train-mode")

    if (this.timeTextElement) {
      this.startTimer()
    }
  }

  setActivePlayer(active: 0 | 1 | 2) {
    const p = active === 2 ? 2 : 1
    this.activePlayer = p
    this.p1PlayerEl?.classList.toggle("is-active", active === 1)
    this.p2PlayerEl?.classList.toggle("is-active", active === 2)
  }

  /** v1.1.18：启动用时计时（mm:ss） */
  private startTimer() {
    if (this.timerId !== null) return
    this.timerStart = performance.now()
    const render = () => {
      if (!this.timeTextElement) return
      const elapsedSec = Math.floor((performance.now() - this.timerStart) / 1000)
      const mm = Math.floor(elapsedSec / 60).toString().padStart(2, "0")
      const ss = (elapsedSec % 60).toString().padStart(2, "0")
      this.timeTextElement.textContent = `${mm}:${ss}`
    }
    render()
    this.timerId = window.setInterval(render, 1000)
    window.addEventListener("beforeunload", () => {
      if (this.timerId !== null) {
        clearInterval(this.timerId)
        this.timerId = null
      }
    })
  }

  private setText(element: HTMLElement | null, text: string) {
    if (element) {
      element.textContent = text
    }
  }

  /**
   * v1.2.6：刷新比分栏 + 按选手拆分已进球。
   * - p1Score / p2Score 写入大号进球数（去掉旧的 name+value HTML，标签在专用元素）。
   * - updatePocketedBalls 每帧调用：diff 前后落袋集合 → 新增球号归到「当前回合选手」。
   * - 重开局（桌面无球落袋）时复位双方集合。
   */
  updateScores(
    p1: number,
    p2: number,
    _p1Name?: string,
    _p2Name?: string,
    b: number = 0,
    hideScore: boolean = false,
    _p1Star: boolean = false,
    _p2Star: boolean = false
  ) {
    if (hideScore) {
      // 兼容老调用：练习模式隐藏分数，仅写 p1 占位
      this.setText(this.p1Element, "")
      this.setText(this.p2Element, "")
      return
    }
    this.setText(this.p1Element, String(p1))
    this.setText(this.p2Element, String(p2))
  }

  /**
   * 每帧调用：刷新每位选手已进球的颜色球行。
   * 关键：球在 advance 动画期间落袋，active 仍是出杆选手，
   * 因此把新增球号归到 activePlayer 是正确的。
   */
  updatePocketedBalls(table: Table) {
    const pocketed = table.balls
      .filter(
        (b): b is Ball =>
          typeof b.label === "number" && b.label >= 1 && !b.onTable()
      )
    const currentSet = new Set<number>(pocketed.map((b) => b.label as number))

    // 重开局检测：桌面所有球归位 → 复位双方归因
    if (currentSet.size === 0 && this.prevPocketedAll.size > 0) {
      this.playerPocketed[1].clear()
      this.playerPocketed[2].clear()
    }

    // diff：把新增球号归到当前回合选手
    for (const label of currentSet) {
      if (!this.prevPocketedAll.has(label)) {
        this.playerPocketed[this.activePlayer].add(label)
      }
    }
    this.prevPocketedAll = currentSet

    this.renderPlayerBalls(this.p1BallsEl, this.playerPocketed[1], table)
    this.renderPlayerBalls(this.p2BallsEl, this.playerPocketed[2], table)
  }

  private renderPlayerBalls(
    container: HTMLElement | null,
    labels: Set<number>,
    table: Table
  ) {
    if (!container) return
    // 排序保证稳定的视觉顺序
    const sorted = Array.from(labels).sort((a, b) => a - b)
    // 仅在内容变化时重建（按 label 序列作为 key）
    const key = sorted.join(",")
    if (container.dataset.key === key) return
    container.dataset.key = key
    container.innerHTML = ""
    for (const label of sorted) {
      const ball = table.balls.find((b) => b.label === label)
      const hex = ball?.ballmesh?.color
        ? "#" + ball.ballmesh.color.getHexString()
        : "#cccccc"
      const striped = label > 8
      const div = document.createElement("div")
      div.className = "sc-ball" + (striped ? " striped" : "")
      div.style.background = hex
      div.title = String(label)
      const num = document.createElement("span")
      num.className = "sc-ball-num"
      num.textContent = String(label)
      div.appendChild(num)
      container.appendChild(div)
    }
  }

  /** v1.2.6：新局开始时复位双方归因（Hud 重建时也会经构造函数重新初始化） */
  resetPocketedAttribution() {
    this.playerPocketed[1].clear()
    this.playerPocketed[2].clear()
    this.prevPocketedAll.clear()
    if (this.p1BallsEl) {
      this.p1BallsEl.innerHTML = ""
      delete this.p1BallsEl.dataset.key
    }
    if (this.p2BallsEl) {
      this.p2BallsEl.innerHTML = ""
      delete this.p2BallsEl.dataset.key
    }
  }
}