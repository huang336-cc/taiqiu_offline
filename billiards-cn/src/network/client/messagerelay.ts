export interface MessageRelay {
  subscribe(
    channel: string,
    callback: (message: string) => void,
    prefix?: string
  ): void
  publish(channel: string, message: string, prefix?: string): void
  /**
   * v1.3.82：主动断开中继（可选）。
   *
   * LanRelay 需要它 —— 局域网对战的连接是**常驻**的：一局打完点「继续对战」
   * 会重载页面，而原生 WebSocket 客户端活在 Java 侧，不随页面销毁而消失。
   * 页面卸载前必须显式断一次，否则旧连接会以僵尸身份留在 LanServer 的客户端
   * 列表里，让下一局的「对手已连接」判断提前成立。
   *
   * 声明为可选：BotRelay / 其它中继不需要在卸载时做任何事。
   */
  close?(): void
}
