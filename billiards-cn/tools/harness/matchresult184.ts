/**
 * v1.8.4 探针：局域网胜负判定（MatchResultHelper.determineWinner / isWinner）
 *
 * 用户反馈：「局域网对战：胜负判断错误，主机输了，却判为赢」。
 * 根因是本地视角的分数与座位号混用 —— 座位号 1 的从机永远判反。
 * 这里直接驱动真实实现（private 用 as any 穿透），覆盖两个座位 × 两种分数
 * × 三种终局来源，确保四种组合都判对。
 *
 * 运行：npx tsx tools/harness/matchresult184.ts
 */
import { Session } from "../../src/network/client/session"
import { MatchResultHelper } from "../../src/network/client/matchresult"

const H = MatchResultHelper as unknown as {
  determineWinner: (
    s: Session,
    rule: string,
    forced?: boolean,
    subtext?: string
  ) => boolean
  isWinner: (r: Record<string, unknown>) => boolean
}

let pass = 0
const fails: string[] = []
function check(name: string, got: unknown, want: unknown): void {
  if (got === want) {
    pass++
  } else {
    fails.push(`${name}: 期望 ${String(want)}，实际 ${String(got)}`)
  }
}

/** 造一个局域网座位：座位号 / 双方 clientId / 各自分数 */
function lan(seat: number, my: number, opp: number, bot = false): Session {
  Session.reset()
  Session.init("A", "玩家", "t", false, bot)
  const s = Session.getInstance()
  s.playerIndex = seat
  s.setOpponentClientId("B")
  s.setScoreByClientId("A", my)
  s.setScoreByClientId("B", opp)
  return s
}

// —— 场景 1：分数决定胜负（forced === undefined，双方都没打进 8 号球的关键球）
for (const seat of [0, 1]) {
  check(`座位${seat} 我7:3 应判赢`, H.determineWinner(lan(seat, 7, 3), "eightball"), true)
  check(`座位${seat} 我3:7 应判输`, H.determineWinner(lan(seat, 3, 7), "eightball"), false)
  check(`座位${seat} 我5:5 应判输（平局不算赢）`, H.determineWinner(lan(seat, 5, 5), "eightball"), false)
}

// —— 场景 2：规则给出强制结果（黑8 / 9号球进袋即胜负）
for (const seat of [0, 1]) {
  check(`座位${seat} 对手打进黑8（forced=false）`, H.determineWinner(lan(seat, 9, 1), "eightball", false), false)
  check(`座位${seat} 我打进黑8（forced=true）`, H.determineWinner(lan(seat, 1, 9), "eightball", true), true)
}

// —— 场景 3：斯诺克以分数为准，强制值不作数
check("斯诺克 我50:30 forced=false 仍应判赢", H.determineWinner(lan(1, 50, 30), "snooker", false), true)
check("斯诺克 我20:60 forced=true 仍应判输", H.determineWinner(lan(1, 20, 60), "snooker", true), false)

// —— 场景 4：认输（conceded）尊重调用方给的结果
check("认输时 forced 优先（我认输）", H.determineWinner(lan(0, 9, 1), "eightball", false, "You conceded"), false)
check("认输时 forced 优先（对手认输）", H.determineWinner(lan(0, 1, 9), "eightball", true, "Opponent conceded"), true)

// —— 场景 5：结算面板「我是不是赢家」—— 局域网双方同名，必须靠 clientId
Session.reset()
Session.init("A", "玩家", "t", false)
Session.getInstance().setScoreByClientId("A", 3)
Session.getInstance().setScoreByClientId("B", 7)
check("clientId=B 获奖 → A 判否", H.isWinner({ winner: "玩家", winnerClientId: "B" }), false)
check("clientId=A 获奖 → A 判是", H.isWinner({ winner: "玩家", winnerClientId: "A" }), true)
check(
  "无 clientId 时回退名字比较（本人）",
  H.isWinner({ winner: "玩家" }),
  true
)
check(
  "无 clientId 时回退名字比较（他人）",
  H.isWinner({ winner: "电脑(专业)" }),
  false
)

console.log(`\n${fails.length === 0 ? "✅" : "❌"} 胜负判定 ${pass}/${pass + fails.length} 通过`)
fails.forEach((f) => console.log("   - " + f))

// —— 负向对照：把旧公式（本地视角比分 × 座位号）跑一遍，证明本探针确实能抓到老 bug
let oldWrong = 0
let oldTotal = 0
for (const seat of [0, 1]) {
  for (const [my, opp] of [
    [7, 3],
    [3, 7],
  ]) {
    const s = lan(seat, my, opp)
    const { p1, p2 } = s.orderedScoresForHud() // 本地视角：p1 恒为「我」
    const winnerIndex = p1 > p2 ? 0 : 1
    const oldVerdict = winnerIndex === s.playerIndex // 却与座位号比较
    oldTotal++
    if (oldVerdict !== my > opp) oldWrong++
  }
}
console.log(`   负向对照：旧公式在 ${oldTotal} 个用例中判错 ${oldWrong} 个（座位 1 全错）`)

process.exit(fails.length === 0 ? 0 : 1)
