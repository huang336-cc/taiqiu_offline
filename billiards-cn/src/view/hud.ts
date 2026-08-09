import { id } from "../utils/dom"
import type { Table } from "../model/table"
import type { Ball } from "../model/ball"

export class Hud {
  p1Element: HTMLElement | null
  p2Element: HTMLElement | null
  middleElement: HTMLElement | null
  breakElement: HTMLElement | null
  // v1.1.18 顶部计分板卡（图2 风格）
  tab1Element: HTMLButtonElement | null
  tab2Element: HTMLButtonElement | null
  scoreP1Wrapper: HTMLElement | null
  scoreP2Wrapper: HTMLElement | null
  timeTextElement: HTMLElement | null
  // v1.1.31：训练模式专用的「已进球」计数器（#pocketedCount）
  pocketedElement: HTMLElement | null
  // v1.2.2：积分牌下方「已进球」整颗球列表（#pocketedBallsList）
  private readonly pocketedOuter: HTMLElement | null
  private readonly pocketedList: HTMLElement | null
  private pocketedKey = ""
  // 训练模式判定：body 上有 train-mode 类时，updateScores 把 p1 视作已进球写入这里
  private readonly isTrainMode: boolean = false
  private timerId: number | null = null
  private timerStart: number = 0

  constructor() {
    this.p1Element = id("p1Score")
    this.p2Element = id("p2Score")
    this.breakElement = id("breakScore")
    this.pocketedElement = id("pocketedCount")
    this.pocketedOuter = id("pocketedBalls")
    this.pocketedList = id("pocketedBallsList")

    let middle = id("hudMiddle")
    if (!middle && this.p1Element && this.p1Element.parentNode) {
      middle = document.createElement("div")
      middle.id = "hudMiddle"
      middle.className = "hudMiddle"
      // v1.1.27：v1.1.18 的 tab 计分板把 p1Score/p2Score 拆到不同 wrapper，
      // 此时 p2Element 不是 p1Element.parentNode 的子节点，原 insertBefore 会抛
      // "The node before which the new node is to be inserted is not a child of this node"。
      // 兜底：仅当 p2 确实是同一 parent 的子节点时才 insertBefore，否则 append。
      const parent = this.p1Element.parentNode
      if (this.p2Element && this.p2Element.parentNode === parent) {
        parent.insertBefore(middle, this.p2Element)
      } else {
        parent.appendChild(middle)
      }
    }
    this.middleElement = middle

    this.tab1Element = id("scTab1") as HTMLButtonElement
    this.tab2Element = id("scTab2") as HTMLButtonElement
    this.scoreP1Wrapper = this.p1Element?.parentElement ?? null
    this.scoreP2Wrapper = this.p2Element?.parentElement ?? null
    this.timeTextElement = id("scTimeText")

    // v1.1.18：训练模式 → 给 body 加类，CSS 切换显示（仅显示已进球 + 时间）
    // v1.1.34：菜单「自己练习」(solo) 以 practice=true 启动，同样只显示进球数 + 时间，
    //          彻底去掉「我方 / 对方」与「玩家 (solo)」等名称标签。
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
    // v1.1.31：缓存训练模式判定，updateScores 据此把 p1 写到已进球计数器
    this.isTrainMode = document.body.classList.contains("train-mode")

    // v1.1.31：训练模式也要计时（之前是隐藏时间，本版改为仅显示已进球 + 时间）
    if (this.timeTextElement) {
      this.startTimer()
    }
  }

  setActivePlayer(active: 0 | 1 | 2) {
    this.p1Element?.classList.toggle("is-active", active === 1)
    this.p2Element?.classList.toggle("is-active", active === 2)
    this.tab1Element?.classList.toggle("is-active", active === 1)
    this.tab2Element?.classList.toggle("is-active", active === 2)
    this.scoreP1Wrapper?.classList.toggle("is-active", active === 1)
    if (this.scoreP1Wrapper) {
      this.scoreP1Wrapper.setAttribute("data-player", "1")
    }
    this.scoreP2Wrapper?.classList.toggle("is-active", active === 2)
    if (this.scoreP2Wrapper) {
      this.scoreP2Wrapper.setAttribute("data-player", "2")
    }
  }

  /** v1.1.18：启动用时计时（mm:ss）。每秒刷新一次，离开页面前自动清理。 */
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

  private setHTML(element: HTMLElement | null, html: string) {
    if (element) {
      element.innerHTML = html
    }
  }

  /**
   * v1.2.2：刷新积分牌下方的「已进球」整颗球列表。
   * 取所有已落袋的编号球（不含母球），按号码升序渲染成「实心圆 + 号码」，
   * 花球（号码 > 8）叠加白色横纹带。仅在落袋集合变化时重建 DOM。
   */
  updatePocketedBalls(table: Table) {
    const outer = this.pocketedOuter
    const list = this.pocketedList
    if (!outer || !list) return
    const pocketed = table.balls
      .filter(
        (b): b is Ball =>
          typeof b.label === "number" && b.label >= 1 && !b.onTable()
      )
      .sort((a, b) => (a.label as number) - (b.label as number))
    const key = pocketed.map((b) => b.label).join(",")
    if (key === this.pocketedKey) return
    this.pocketedKey = key
    this.renderPocketedBalls(pocketed)
    outer.hidden = pocketed.length === 0
  }

  private renderPocketedBalls(balls: Ball[]) {
    const list = this.pocketedList
    if (!list) return
    list.innerHTML = ""
    for (const b of balls) {
      const label = b.label as number
      const hex = b.ballmesh?.color
        ? "#" + b.ballmesh.color.getHexString()
        : "#cccccc"
      const striped = label > 8
      const div = document.createElement("div")
      div.className = "pb-ball" + (striped ? " striped" : "")
      div.style.background = hex
      div.title = String(label)
      const num = document.createElement("span")
      num.className = "pb-num"
      num.textContent = String(label)
      div.appendChild(num)
      list.appendChild(div)
    }
  }

  updateBreak(score: number) {
    this.setText(this.p1Element, "")
    this.setText(this.p2Element, "")
    this.setText(this.middleElement, "")
    if (score > 0 && this.breakElement) {
      this.breakElement.textContent = ""
      this.breakElement.appendChild(document.createTextNode("Break"))
      this.breakElement.appendChild(document.createElement("br"))
      this.breakElement.appendChild(document.createTextNode(score.toString()))
    } else {
      this.setText(this.breakElement, "")
    }
  }

  updateScores(
    p1: number,
    p2: number,
    p1Name?: string,
    p2Name?: string,
    b: number = 0,
    hideScore: boolean = false,
    p1Star: boolean = false,
    p2Star: boolean = false
  ) {
    this.setText(this.p1Element, "")
    this.setText(this.p2Element, "")
    this.setText(this.middleElement, "")
    this.setText(this.breakElement, "")

    if (hideScore) {
      // Drill mode: show the player name only, no score count, no break.
      this.setText(this.p1Element, p1Name ?? "")
      return
    }

    // v1.1.31：训练模式仅显示「已进球」+ 时间，p1 值就是已进球数。
    if (this.isTrainMode && this.pocketedElement) {
      this.pocketedElement.textContent = String(p1)
      // 训练模式不再渲染双方分数（CSS 也会隐藏 sc-main）
      return
    }

    const p1Str = p1Star ? `${p1}⭐` : `${p1}`
    const p2Str = p2Star ? `⭐${p2}` : `${p2}`

    if (p1Name && p2Name) {
      this.setHTML(
        this.p1Element,
        `<div class="hud-name">${p1Name}</div><div class="hud-value">${p1Str}</div>`
      )
      this.setHTML(
        this.p2Element,
        `<div class="hud-name">${p2Name}</div><div class="hud-value">${p2Str}</div>`
      )
      this.setHTML(
        this.middleElement,
        `<div class="hud-name">:</div><div class="hud-value"></div>`
      )
    } else if (p1Name) {
      this.setHTML(
        this.p1Element,
        `<div class="hud-name">${p1Name}</div><div class="hud-value">${p1Str}</div>`
      )
    } else if (p2Name) {
      this.setHTML(
        this.p2Element,
        `<div class="hud-name">${p2Name}</div><div class="hud-value">${p2Str}</div>`
      )
    } else {
      this.setHTML(this.p1Element, `<div class="hud-value">${p1Str}</div>`)
    }

    if (b > 0) {
      this.setText(this.breakElement, `Break: ${b}`)
    }
  }
}
