import { Container } from "../../container/container"
import { NotificationEvent } from "../../events/notificationevent"
import { ScoreEvent } from "../../events/scoreevent"
import { End } from "../../controller/end"
import { Session } from "./session"
import { gameOverButtons } from "../../utils/gameover"
import { VERSION } from "../../utils/version"
import { NotificationHighBreak, NotificationActionHandlers } from "../../view/notification"
import { t } from "../../utils/i18n"
import { downloadText } from "../../utils/download"
import { saveReplayToDB } from "../../utils/replay-store"
import { getUID } from "../../utils/uid"
import { storeReplayAndNavigate } from "../../utils/replay-nav"

export interface MatchResult {
  winner: string
  loser?: string
  winnerScore: number
  loserScore?: number
  ruleType: string
  replayData?: string
  version?: string
  userAgent?: string
  bot?: boolean
}

export class MatchResultHelper {
  static presentGameEnd(
    container: Container,
    rulename: string,
    forcedAmIWinner?: boolean,
    endSubtext?: string
  ): End {
    container.recorder.wholeGameLink()

    const session = Session.getInstance()
    const amIWinner = this.determineWinner(
      session,
      rulename,
      forcedAmIWinner,
      endSubtext
    )
    const subtext = endSubtext ?? this.getScoreSubtext(container, rulename)

    this.notifyEndState(container, amIWinner, subtext)

    const result = this.createMatchResult(rulename, session, amIWinner)

    return new End(container, result)
  }

  private static determineWinner(
    session: Session,
    rulename: string,
    forcedAmIWinner?: boolean,
    endSubtext?: string
  ): boolean {
    const { p1, p2 } = session.orderedScoresForHud()

    const winnerIndex = p1 >= p2 ? 0 : 1
    const playerIndex = session.playerIndex

    if (forcedAmIWinner !== undefined) {
      if (endSubtext?.toLowerCase().includes("conceded")) {
        return forcedAmIWinner
      }
      const isWinnerByScore = winnerIndex === playerIndex
      if (Session.isBotMode()) {
        // If it's a natural end (forcedAmIWinner came from rules), score should be considered
        // If it's a concession (forcedAmIWinner=false passed to rules), forcedAmIWinner should be respected.
        // Rules pass false to handleGameEnd when bot wins by score/legal pot.
        // But BotEventHandler should now be passing the correct winner based on score.
        return forcedAmIWinner
      }
      // For games like NineBall/EightBall, forcedAmIWinner (potting 9-ball/8-ball) is king.
      // For Snooker, score is king.
      if (rulename === "snooker") {
        return isWinnerByScore
      }
      return forcedAmIWinner
    }

    return winnerIndex === playerIndex
  }

  private static notifyEndState(
    container: Container,
    amIWinner: boolean,
    subtext: string
  ): void {
    if (amIWinner) {
      this.notifyWin(container, subtext)
      this.sendLossNotification(container)
    } else if (Session.isSpectator()) {
      this.notifySpectator(container, subtext)
    } else {
      this.notifyLoss(container, subtext)
      this.sendWinNotification(container)
    }
  }

  static isWinner(result: MatchResult): boolean {
    return result.winner === Session.getInstance().playername
  }

  private static notifyWin(container: Container, subtext: string) {
    container.notifyLocal(
      {
        type: "GameOver",
        title: t("youWon"),
        subtext: subtext,
        highBreaks: this.getHighBreaks(container),
        icon: "🏆",
        extraClass: "is-winner",
        extra: this.getGameOverButtons(),
        duration: 0,
      },
      0,
      this.buildSaveReplayHandler(container)
    )
  }

  private static notifyLoss(container: Container, subtext: string) {
    container.notifyLocal(
      {
        type: "GameOver",
        title: t("youLost"),
        subtext: subtext,
        highBreaks: this.getHighBreaks(container),
        icon: "🥈",
        extraClass: "is-loser",
        extra: this.getGameOverButtons(),
        duration: 0,
      },
      0,
      this.buildSaveReplayHandler(container)
    )
  }

  /** v1.2.4：构建「保存回放」按钮的动作处理器。
   *  编码本局录制数据 → Blob 下载 + 写入本地 IndexedDB（「我的回放」），
   *  并在原结算面板的按钮上就地反馈，不替换结算面板。 */
  private static buildSaveReplayHandler(
    container: Container
  ): NotificationActionHandlers {
    return {
      viewReplay: () => {
        try {
          const compressed = container.recorder.getWholeGameCompressed()
          // 经 sessionStorage 传递完整回放数据，避开 WebView URL 长度上限
          // （之前 ?state= 超长被截断，只回放前几个球）。
          storeReplayAndNavigate(compressed, container.rules.rulename)
        } catch (e) {
          console.error("view replay failed", e)
        }
      },
      saveReplay: () => {
        try {
          const compressed = container.recorder.getWholeGameCompressed()
          const rule = container.rules.rulename
          const score = Session.getInstance().myScore()
          const ts = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .slice(0, 19)
          const filename = `奥特曼的台球_${rule}_${ts}.bcr`
          const ok = downloadText(filename, compressed, "application/octet-stream")
          saveReplayToDB({
            id: getUID() + "_" + Date.now(),
            rule,
            compressed,
            createdAt: Date.now(),
            score,
            label: `${this.ruleLabel(rule)} · ${score} 分`,
          }).catch((e) => console.error("saveReplayToDB failed", e))
          const btn = document.querySelector(
            '[data-notification-action="saveReplay"]'
          ) as HTMLButtonElement | null
          if (btn) {
            btn.textContent = ok ? "已保存 ✓" : "已存入回放 ✓"
            btn.disabled = true
            btn.classList.add("is-saved")
          }
        } catch (e) {
          console.error("save replay failed", e)
          const btn = document.querySelector(
            '[data-notification-action="saveReplay"]'
          ) as HTMLButtonElement | null
          if (btn) {
            btn.textContent = "保存失败"
            btn.disabled = true
          }
        }
      },
    }
  }

  private static ruleLabel(rule: string): string {
    const m: Record<string, string> = {
      nineball: "九球",
      eightball: "八球",
      snooker: "斯诺克",
      threecushion: "三颗星",
      sagu: "沙古",
    }
    return m[rule] || rule
  }

  private static notifySpectator(container: Container, subtext: string) {
    container.notifyLocal({
      type: "GameOver",
      title: t("gameOver"),
      subtext: subtext,
      highBreaks: this.getHighBreaks(container),
      icon: "🏆",
      extraClass: "",
      extra: gameOverButtons.lobby,
      duration: 0,
    })
  }

  private static sendLossNotification(container: Container) {
    if (container.isSinglePlayer) return
    const session = Session.getInstance()
    const { p1, p2 } = session.orderedScoresForHud()
    container.sendScoreUpdate(p1, p2, 0)
    container.sendEvent(
      new NotificationEvent({
        type: "GameOver",
        title: t("youLost"),
        icon: "🥈",
        extraClass: "is-loser",
        extra: this.getRemoteGameOverButtons(),
        duration: 0,
      })
    )
  }

  private static sendWinNotification(container: Container) {
    if (container.isSinglePlayer) return
    const session = Session.getInstance()
    const { p1, p2 } = session.orderedScoresForHud()
    container.sendEvent(new ScoreEvent(p1, p2, 0))
    container.sendEvent(
      new NotificationEvent({
        type: "GameOver",
        title: t("youWon"),
        icon: "🏆",
        extraClass: "is-winner",
        extra: this.getRemoteGameOverButtons(),
        duration: 0,
      })
    )
  }

  private static getGameOverButtons(): string {
    return gameOverButtons.forMode()
  }

  private static getRemoteGameOverButtons(): string {
    return gameOverButtons.forMode()
  }

  private static calculateInningsStats(container: Container) {
    const entries = container.recorder.entries
    const shots = entries.filter((e) => e.event && e.event.type === "AIM")

    let whiteInnings = 0
    let yellowInnings = 0

    let previousCueBallIndex: number | null = null

    for (const entry of shots) {
      const currentCueBallIndex = (entry.event as any).i ?? 0

      if (currentCueBallIndex !== previousCueBallIndex) {
        if (currentCueBallIndex === 0) {
          whiteInnings++
        } else {
          yellowInnings++
        }
        previousCueBallIndex = currentCueBallIndex
      }
    }

    return {
      whiteInnings,
      yellowInnings,
    }
  }

  private static getScoreSubtext(
    container: Container,
    rulename: string
  ): string {
    if (rulename === "threecushion" || rulename === "sagu") {
      const stats = this.calculateInningsStats(container)
      if (container.isSinglePlayer) {
        const score = Session.getInstance().myScore()
        const totalInnings = stats.whiteInnings + stats.yellowInnings
        const avg =
          totalInnings > 0 ? (score / totalInnings).toFixed(2) : "0.00"
        return `得分：${score}（平均 ${avg}，共 ${totalInnings} 局回合）`
      } else {
        const { p1, p2 } = Session.getInstance().orderedScoresForHud()
        const names = Session.getInstance().orderedNamesForHud()
        const p1Name = names.p1Name || "玩家一"
        const p2Name = names.p2Name || "玩家二"

        const p1Innings = stats.whiteInnings
        const p2Innings = stats.yellowInnings

        const p1Avg = p1Innings > 0 ? (p1 / p1Innings).toFixed(2) : "0.00"
        const p2Avg = p2Innings > 0 ? (p2 / p2Innings).toFixed(2) : "0.00"

        return (
          `${p1Name}：${p1}（平均 ${p1Avg}／${p1Innings} 回合）\n` +
          `${p2Name}：${p2}（平均 ${p2Avg}／${p2Innings} 回合）`
        )
      }
    }

    if (container.isSinglePlayer) {
      return `得分：${Session.getInstance().myScore()}`
    }

    const { p1, p2 } = Session.getInstance().orderedScoresForHud()
    return `${p1} - ${p2}`
  }

  public static getHighBreaks(container: Container): NotificationHighBreak[] {
    return container.ballTray
      .getTopBreaks(3)
      .map(({ score, hiScoreUri }) => ({ score, url: hiScoreUri }))
  }

  private static createMatchResult(
    rulename: string,
    session: Session,
    iWon: boolean
  ): MatchResult {
    const myScore = session.myScore()
    const opponentScore = session.opponentScore()

    const winnerName = iWon
      ? session.playername || "玩家"
      : session.opponentName || "对手"
    const loserName = iWon
      ? session.opponentName || "对手"
      : session.playername || "玩家"
    const winnerScore = iWon ? myScore : opponentScore
    const loserScore = iWon ? opponentScore : myScore

    const result: MatchResult = {
      winner: winnerName,
      winnerScore: winnerScore,
      ruleType: rulename,
      bot: Session.isBotMode(),
    }

    if (session.opponentName) {
      result.loser = loserName
      result.loserScore = loserScore
    }

    result.version = VERSION
    result.userAgent = navigator?.userAgent
    return result
  }
}
