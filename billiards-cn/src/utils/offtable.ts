import { Ball } from "../model/ball"
import { Outcome } from "../model/outcome"
import { Table } from "../model/table"
import { Respot } from "./respot"

/**
 * v1.3.95：跳台犯规（球飞出台面）的统一文案。
 * 四套规则共用同一个理由串，i18n 里已登记对应中英文。
 */
export const OFF_TABLE_FOUL = "球跳出台面"

/**
 * v1.3.95：把本杆出界的**目标球**放回原处。
 *
 * 真实台球规则里，被打出台面的球（非母球）要放回它原来的位置，由
 * `Table.hit()` 记录的 `shotStart` 提供。母球**不在这里处理** —— 它应当
 * 由各规则自己决定给对手自由球，语义各不相同。
 *
 * @returns 被放回的球，供调用方决定是否需要广播重摆事件
 */
export function respotOffTable(table: Table, outcomes: Outcome[]): Ball[] {
  const moved: Ball[] = []
  for (const ball of Outcome.offTableBalls(outcomes)) {
    if (ball === table.cueball) continue

    // 清掉出界标记，让它重新回到「在台上」参与后续游戏
    ball.offTable = false
    const target = ball.shotStart.clone()
    if (!table.overlapsAny(target, ball)) {
      ball.pos.copy(target)
      ball.setStationary()
    } else {
      // 原位被占（本杆中途有别的球停到了那里）→ 沿 x 找最近的空位
      Respot.respotBehind(target, ball, table)
    }
    ball.fround()
    moved.push(ball)
  }
  return moved
}
