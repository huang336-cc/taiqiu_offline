/**
 * v1.3.82 探针：局域网「继续对战」重开时序验证
 *
 * 复现用户反馈的第 4 条问题：
 *   「完成一局局域网对战后点击继续对战，无法开启游戏」
 *
 * 根因假设：点「继续对战」走 location.replace → **两台手机都要重载页面**，
 * 而两边重载耗时不同 —— 主机要重建容器 / 重跑渲染 / 重新 bind 服务端，明显
 * 比客机慢。客机先连上并把 hello 发出去，此时主机的 LanRelay 还没构造完、
 * 页面也没连上服务端，LanServer.broadcast 找不到接收者，**hello 永久丢失**。
 * 主机随后连上来，却永远等不到 hello → gotHello 恒为 false → BeginEvent
 * 永不推出 → 两边都停在球桌上，谁也不开球。
 *
 * 本探针用一个内存版「LanServer 转发器」按真实语义模拟广播（发给除发送者
 * 外的所有在线连接，离线即丢弃），分别跑三种时序：
 *
 *   A. 旧版（不重发 hello）+ 客机先到   → 期望：**卡死**（还原该 bug）
 *   B. 新版（重发 hello）+ 客机先到     → 期望：**开局**
 *   C. 新版 + 客机后到（主机先就绪）     → 期望：**开局**（不回归）
 *
 * 运行：npx tsx tools/harness/lanrematch.ts
 */

interface Conn {
  name: string
  online: boolean
  /** 该连接收到的所有文本（用于断言是否收到开局事件） */
  inbox: string[]
}

/** 极简转发器：语义对齐 LanServer.broadcast(message, sender) */
class FakeLanServer {
  private conns: Conn[] = []

  add(name: string): Conn {
    const c: Conn = { name, online: true, inbox: [] }
    this.conns.push(c)
    return c
  }

  drop(c: Conn): void {
    c.online = false
    this.conns = this.conns.filter((x) => x !== c)
  }

  send(from: Conn, text: string): void {
    // 与 LanServer 一致：只投递给「除发送者外」的**当前在线**连接；
    // 离线连接直接就没了 —— 这正是 hello 会丢的原因。
    for (const c of this.conns) {
      if (c !== from) c.inbox.push(text)
    }
  }
}

/** 主机侧 LanRelay 的最小状态机（只保留与开局相关的部分） */
class Host {
  gotHello = false
  began = 0
  private graceFired = false

  constructor(private readonly server: FakeLanServer, private conn: Conn) {}

  attach(c: Conn): void {
    this.conn = c
  }

  /** 对应 onStatus 的 clients 分支：对手连入 → 起宽限计时 */
  onClientCount(n: number, tick: () => void, graceTicks: number): void {
    if (n >= 2 && !this.graceFired && !this.gotHello) {
      this.graceFired = true
      // 用 tick 计数替代真实定时器，保持探针确定性
      for (let i = 0; i < graceTicks; i++) tick()
    }
  }

  /** 对应 onHello：推 BeginEvent 并广播 */
  onHello(ruletype: string): void {
    this.gotHello = true
    this.began += 1
    this.server.send(this.conn, JSON.stringify({ k: "ev", d: "BeginEvent:" + ruletype }))
  }

  /** 对应 handleEnvelope */
  receive(text: string): void {
    const env = JSON.parse(text)
    if (env.k === "hello") this.onHello(env.ruletype)
  }
}

/** 客机侧 LanRelay 的最小状态机 */
class Client {
  helloSent = 0
  began = false

  constructor(
    private readonly server: FakeLanServer,
    private conn: Conn,
    private readonly resend: boolean,
    private readonly maxResend: number
  ) {}

  attach(c: Conn): void {
    this.conn = c
  }

  /** 连上即发 hello；resend=true 时按次数重发（对应 scheduleHelloResend） */
  onOpen(): void {
    this.sendHello()
    if (!this.resend) return
    // 客户端每 tick 重发一次，直到收到对局事件（对应 stopHelloResend）
    this.pendingResend = this.maxResend
  }

  private pendingResend = 0

  private sendHello(): void {
    this.helloSent += 1
    this.server.send(this.conn, JSON.stringify({ k: "hello", ruletype: "nineball" }))
  }

  /** 每个 tick 走一格：到点重发 hello，并检查是否已收到开局事件 */
  tick(): void {
    for (const t of this.conn.inbox) {
      if (t.indexOf("BeginEvent") >= 0) {
        this.began = true
        this.pendingResend = 0
        return
      }
    }
    if (this.pendingResend > 0) {
      this.pendingResend -= 1
      this.sendHello()
    }
  }

  /** 主机侧 tick：把自己的收件箱喂给 Host（模拟 Java 推事件到页面） */
  drain(host: Host): void {
    const box = this.conn.inbox.splice(0, this.conn.inbox.length)
    for (const t of box) host.receive(t)
  }
}

interface Case {
  name: string
  /** 客机是否重发 hello（v1.3.82 新增） */
  resend: boolean
  /** 主机是否有宽限主动开局（v1.3.82 新增） */
  grace: boolean
  /** 客机是否先于主机就绪 */
  clientFirst: boolean
  /** 期望最终能否开局 */
  expectOpen: boolean
}

const cases: Case[] = [
  {
    name: "A 旧版：都不重发、都无宽限 + 客机先到",
    resend: false,
    grace: false,
    clientFirst: true,
    expectOpen: false,
  },
  {
    name: "B 新版：客机重发 + 主机宽限 + 客机先到",
    resend: true,
    grace: true,
    clientFirst: true,
    expectOpen: true,
  },
  {
    name: "C 新版：客机重发 + 主机宽限 + 客机后到",
    resend: true,
    grace: true,
    clientFirst: false,
    expectOpen: true,
  },
  {
    name: "D 只升级主机（客机仍是旧版，靠宽限兜底）",
    resend: false,
    grace: true,
    clientFirst: true,
    expectOpen: true,
  },
]

let pass = 0
let fail = 0

for (const c of cases) {
  const server = new FakeLanServer()

  // ---- 主机重载：旧连接先断（v1.3.82 新增的 beforeunload close）----
  const oldHostConn = server.add("host-old")
  server.drop(oldHostConn)

  // ---- 客机重载 ----
  const oldClientConn = server.add("client-old")
  server.drop(oldClientConn)
  const clientConn = server.add("client")
  const client = new Client(server, clientConn, c.resend, 8)

  // 主机对象占位：conn 在 attach 前不该收到任何东西
  const host = new Host(server, clientConn)

  // ---- 主机重载较慢：这个空窗期内，服务端上只有客机一条连接 ----
  // 注意：A/B 两个「客机先到」用例中，hello 必须在主机 attach **之前**发出，
  // 否则等于主机已就绪，根本复现不出丢包。这正是真机上的实际先后顺序。
  let hostConn: Conn | null = null

  // 客机先连上就发 hello（真实场景：客机页面先就绪）
  if (c.clientFirst) {
    client.onOpen()
  }

  // 主机页面就绪，连上自己的服务端
  hostConn = server.add("host")
  host.attach(hostConn)

  if (!c.clientFirst) {
    client.onOpen()
  }

  // 对手连入 → 主机起宽限计时（真实是 2500ms，这里压成 3 个 tick）
  let graceTicksLeft = c.grace ? 3 : 0
  host.onClientCount(2, () => {}, 0)

  // 跑 12 个 tick 的稳态：客机重发 + 宽限计时 + 双方收件箱流转
  for (let i = 0; i < 12; i++) {
    client.tick()
    client.drain(host)
    if (graceTicksLeft > 0) {
      graceTicksLeft -= 1
      if (graceTicksLeft === 0 && !host.gotHello) host.onHello("nineball")
    }
    if (client.began) break
  }

  const opened = client.began || host.gotHello
  const expectOpen = c.expectOpen
  const ok = opened === expectOpen

  if (ok) {
    pass += 1
    console.log(
      `✓ ${c.name} → ${opened ? "顺利开局" : "卡死（成功复现 bug）"}` +
        `  [hello×${client.helloSent}，主机 gotHello=${host.gotHello}]`
    )
  } else {
    fail += 1
    console.log(
      `✗ ${c.name} → 期望${expectOpen ? "开局" : "卡死"}，实际${
        opened ? "开局" : "卡死"
      }  [hello×${client.helloSent}，主机 gotHello=${host.gotHello}]`
    )
  }
}

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail === 0 ? 0 : 1)
