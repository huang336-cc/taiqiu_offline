import { Container } from "../container/container"
import { ReplayEncoder } from "../utils/replay-encoder"

export class LinkFormatter {
  container: Container
  replayUrl: string = ""

  constructor(container: Container) {
    this.container = container
  }

  getReplayUri(state: any): string {
    const serialised = typeof state === "string" ? state : JSON.stringify(state)
    const compressed = ReplayEncoder.crush(serialised)
    return `${this.replayUrl}${ReplayEncoder.fullyEncodeURI(compressed)}`
  }

  /**
   * 离线版没有在线排行榜，高分链接改为本地回放链接
   */
  getHiScoreUri(state: any, score: number): string {
    state.score = score
    return this.getReplayUri(state)
  }

  wholeGameLink(game: any) {
    this.container.ballTray.addGame(game)
  }
}
