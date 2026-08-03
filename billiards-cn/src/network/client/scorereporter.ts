import { MatchResult } from "./matchresult"

/**
 * 单机离线版：比分不再上传到任何服务器。
 * 保留类结构以兼容调用点，方法内为空实现。
 */
export class ScoreReporter {
  constructor(_baseURL?: string) {
    /* 离线版无需服务器地址 */
  }

  async submitMatchResult(_result: MatchResult): Promise<void> {
    /* 离线版不上传比赛结果 */
  }
}
