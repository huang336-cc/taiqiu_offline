/**
 * 结算面板按钮（离线单机版）
 *
 * 原版的“返回大厅 / 再战一局（联机约战）”按钮已改为本地行为：
 * - menu：回到中文主菜单
 * - reload：原地重开一局
 * - replay：回放本局
 */
export const gameOverButtons = {
  lobby: `<button type="button" class="notification-btn" data-notification-action="menu">返回主菜单</button>`,
  newGame: `<button type="button" class="notification-btn" data-notification-action="reload">再来一局</button>`,
  replay: `<button type="button" class="notification-btn" data-notification-action="replay">回放本局</button>`,
  /** v1.2.4：游戏结束后保存本局回放（编码下载 + 写入本地「我的回放」） */
  saveReplay: `<button type="button" class="notification-btn" data-notification-action="saveReplay">保存回放</button>`,
  /** v1.2.5：游戏结束后直接回放本局（整局）。点击经 sessionStorage 传完整数据，
   *  规避 Android WebView 对 URL 长度的限制，避免只回放前几个球。 */
  viewReplay: `<button type="button" class="notification-btn" data-notification-action="viewReplay">查看回放</button>`,

  rematch(): string {
    return ""
  },

  forMode(): string {
    return this.newGame + " " + this.viewReplay + " " + this.saveReplay + " " + this.lobby
  },
}
