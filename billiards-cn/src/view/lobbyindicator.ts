import { Rules } from "../controller/rules/rules"

/**
 * 单机离线版占位实现。
 *
 * 原版此处会连接在线大厅（WebSocket 长连接 + 在线人数 + 挑战邀请），
 * 离线版不需要任何网络能力，因此保留同名接口但全部为空实现，
 * 以免改动大量调用点。
 */
export class LobbyIndicator {
  constructor(
    _botMode: boolean,
    _replayMode: boolean,
    _rules: Rules,
    _onChatMessage?: (msg: string) => void,
    _messagingUrl?: string,
    _onShowOverlay?: (url: string) => void
  ) {
    // 隐藏页面上的大厅入口元素
    const el = document.getElementById("lobbyContainer")
    if (el) {
      el.style.display = "none"
    }
  }

  async init(): Promise<void> {
    /* 离线版无需初始化 */
  }

  getMessagingClient(): null {
    return null
  }

  setTableId(_tableId: string | null | undefined): void {
    /* 离线版无需同步桌台 */
  }

  async stop(): Promise<void> {
    /* 离线版无连接可关闭 */
  }
}
