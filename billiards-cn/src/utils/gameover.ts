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

  rematch(): string {
    return ""
  },

  forMode(): string {
    return this.newGame + " " + this.lobby
  },
}
