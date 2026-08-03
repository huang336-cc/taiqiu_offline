import { Table } from "../model/table"

export interface ShotSnapshot {
  init: string
  shot: string
}

export class ExportUtils {
  static captureSnapshot(table: Table): ShotSnapshot {
    const init = JSON.stringify(table.shortSerialise())
    const aim = table.cue!.aim
    const shot = JSON.stringify({
      cueBallId: aim.i,
      angle: aim.angle,
      power: aim.power,
      offset: { x: aim.offset.x, y: aim.offset.y },
      elevation: aim.elevation || 0,
    })
    return { init, shot }
  }

}
