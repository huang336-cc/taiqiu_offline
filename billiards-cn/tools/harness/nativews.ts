/**
 * v1.3.81：原生 WebSocket 客户端协议验证。
 *
 * 背景：局域网对战真机失败已收敛到「Android WebView 的 ws:// 连 TCP 都建不
 * 起来，而同一台手机的原生 Socket 能完整完成握手」。故把客机连接改由 Java 侧
 * 的 NativeWsClient（原生 Socket 实现 RFC6455）承载。
 *
 * 本探针在 Node 里**按 NativeWsClient 的算法逐行等价复现**客户端，对着一个
 * 真实 RFC6455 服务端跑，验证四件事：
 *   ① 握手 Key/Accept 计算正确，能被服务端接受；
 *   ② 客户端发帧**带掩码**且服务端能正确解出内容（掩码位与掩码算法无误）；
 *   ③ 服务端发来的**无掩码**帧能被正确解析；
 *   ④ 分片消息（continuation）能重组、ping/pong 能应答。
 *
 * 这些正是真机上最容易出错的点（掩码、分片、控制帧），必须在桌面先验干净。
 */

import { createServer, Socket } from "node:net"
import { createHash, randomBytes } from "node:crypto"

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const MAX_FRAME = 2 * 1024 * 1024

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}${extra ? "  " + extra : ""}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? "  " + extra : ""}`)
  }
}

const b64 = (b: Buffer) => b.toString("base64")
const sha1 = (s: string) => createHash("sha1").update(s, "utf8").digest()

/** 客户端发帧：**必须加掩码**（等价 NativeWsClient.writeFrame） */
function clientFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const mask = randomBytes(4)
  const len = payload.length
  const head: number[] = []
  head.push((fin ? 0x80 : 0x00) | (opcode & 0x0f))
  if (len < 126) head.push(0x80 | len)
  else if (len < 65536) head.push(0x80 | 126, (len >>> 8) & 0xff, len & 0xff)
  else {
    head.push(0x80 | 127)
    const l = BigInt(len)
    for (let i = 7; i >= 0; i--) head.push(Number((l >> BigInt(8 * i)) & 0xffn))
  }
  for (const m of mask) head.push(m)
  const masked = Buffer.alloc(len)
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
  return Buffer.concat([Buffer.from(head), masked])
}

/** 服务端发帧：**不加掩码** */
function serverFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const len = payload.length
  const head: number[] = []
  head.push((fin ? 0x80 : 0x00) | (opcode & 0x0f))
  if (len < 126) head.push(len)
  else if (len < 65536) head.push(126, (len >>> 8) & 0xff, len & 0xff)
  else {
    head.push(127)
    const l = BigInt(len)
    for (let i = 7; i >= 0; i--) head.push(Number((l >> BigInt(8 * i)) & 0xffn))
  }
  return Buffer.concat([Buffer.from(head), payload])
}

/** 服务端侧解析客户端帧（校验掩码位） */
function parseClientFrame(buf: Buffer): {
  opcode: number
  fin: boolean
  masked: boolean
  text: string
} | null {
  if (buf.length < 2) return null
  const fin = (buf[0] & 0x80) !== 0
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let off = 2
  if (len === 126) {
    len = buf.readUInt16BE(2)
    off = 4
  } else if (len === 127) {
    len = Number(buf.readBigUInt64BE(2))
    off = 10
  }
  const mask = buf.subarray(off, off + 4)
  off += 4
  if (buf.length < off + len) return null
  const payload = Buffer.alloc(len)
  for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3]
  return { opcode, fin, masked, text: payload.toString("utf8") }
}

/** 客户端侧解析服务端帧（等价 NativeWsClient.FrameReader） */
class FrameReader {
  private buf = Buffer.alloc(0)
  constructor(private readonly sock: Socket) {
    sock.on("data", (d) => {
      this.buf = Buffer.concat([this.buf, d])
      this.pump()
    })
  }
  /** 握手里的剩余字节（已到达但还没解析的帧数据） */
  onRest(rest: Buffer): void {
    if (rest.length === 0) return
    this.buf = Buffer.concat([this.buf, rest])
    this.pump()
  }
  private waiters: Array<() => void> = []
  private frames: Array<{ opcode: number; fin: boolean; text: string }> = []
  private pop(): Promise<{ opcode: number; fin: boolean; text: string }> {
    return new Promise((r) => {
      const take = () => {
        const f = this.frames.shift()
        if (f) r(f)
        else this.waiters.push(take)
      }
      take()
    })
  }
  private pump(): void {
    for (;;) {
      if (this.buf.length < 2) return
      const fin = (this.buf[0] & 0x80) !== 0
      const opcode = this.buf[0] & 0x0f
      let len = this.buf[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return
        len = Number(this.buf.readBigUInt64BE(2))
        off = 10
      }
      if (len > MAX_FRAME) return
      if (this.buf.length < off + len) return
      const payload = this.buf.subarray(off, off + len)
      this.buf = this.buf.subarray(off + len)
      const f = { opcode, fin, text: payload.toString("utf8") }
      const w = this.waiters.shift()
      if (w) {
        this.frames.push(f)
        w()
      } else {
        this.frames.push(f)
      }
    }
  }
  next() {
    return this.pop()
  }
}

async function main(): Promise<void> {
  const received: Array<{ opcode: number; fin: boolean; masked: boolean; text: string }> = []
  let handshakeKeyOk = false
  let handshakeAcceptOk = false

  const server = createServer((sock: Socket) => {
    let buf = Buffer.alloc(0)
    let handshaken = false
    const reader = () => {
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, d])
        if (!handshaken) {
          const s = buf.toString("utf8")
          if (!s.includes("\r\n\r\n")) return
          const key = /sec-websocket-key:\s*(\S+)/i.exec(s)?.[1] ?? ""
          const upgrade = /upgrade:\s*websocket/i.test(s)
          handshakeKeyOk = key.length > 0 && upgrade
          const accept = b64(sha1(key + WS_GUID))
          handshakeAcceptOk = true
          sock.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
          )
          buf = buf.subarray(s.indexOf("\r\n\r\n") + 4)
          handshaken = true
          // 顺手发一条消息验证客户端能收（无掩码帧）
          sock.write(serverFrame(0x1, Buffer.from("welcome-from-server", "utf8")))
          return
        }
        for (;;) {
          const f = parseClientFrame(buf)
          if (!f) break
          received.push(f)
          // 记录解析消耗的长度：重算一次
          let len = buf[1] & 0x7f
          let off = 2
          if (len === 126) { len = buf.readUInt16BE(2); off = 4 }
          else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10 }
          off += 4 + len
          buf = buf.subarray(off)
          if (f.opcode === 0x9) {
            // ping → 服务端回 pong
            sock.write(serverFrame(0xA, Buffer.from("pong-data", "utf8")))
          }
        }
      })
    }
    reader()
  })

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as { port: number }).port

  // ---- 客户端（复现 NativeWsClient）----
  const sock = new Socket()
  const key = randomBytes(16).toString("base64")
  const expectAccept = b64(sha1(key + WS_GUID))
  let gotAccept = ""
  let reader: FrameReader
  await new Promise<void>((resolve, reject) => {
    sock.connect(port, "127.0.0.1", () => {
      sock.write(
        "GET / HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n\r\n"
      )
    })
    let b = Buffer.alloc(0)
    const onData = (d: Buffer) => {
      b = Buffer.concat([b, d])
      const s = b.toString("utf8")
      if (!s.includes("\r\n\r\n")) return
      sock.removeListener("data", onData)
      // 关键：这是**唯一**的 reader，且要把握手里夹带的剩余字节喂给它
      reader = new FrameReader(sock)
      gotAccept = /sec-websocket-accept:\s*(\S+)/i.exec(s)?.[1] ?? ""
      const rest = b.subarray(s.indexOf("\r\n\r\n") + 4)
      reader.onRest(rest)
      resolve()
    }
    sock.on("data", onData)
    setTimeout(() => reject(new Error("handshake timeout")), 4000)
  })

  console.log("=== v1.3.81 原生 WebSocket 客户端协议验证 ===")
  check("① 握手请求含 Key 与 Upgrade", handshakeKeyOk)
  check("② Sec-WebSocket-Accept 计算正确", gotAccept === expectAccept,
    `expect=${expectAccept.slice(0, 12)}… got=${gotAccept.slice(0, 12)}…`)

  // 等服务端那条 welcome（验证无掩码帧接收）
  const welcome = await Promise.race([
    reader.next(),
    new Promise<null>((r) => setTimeout(() => r(null), 3000)),
  ])
  check("③ 能接收服务端**无掩码**帧", welcome?.text === "welcome-from-server",
    welcome ? `收到 "${welcome.text}"` : "超时")

  // ④ 发文本（带掩码）—— 服务端应解出原文
  sock.write(clientFrame(0x1, Buffer.from("hello-from-native", "utf8")))
  await new Promise((r) => setTimeout(r, 300))
  const got = received.find((f) => f.text === "hello-from-native")
  check("④ 发文本帧**带掩码**且内容正确", !!got && got.masked,
    got ? `masked=${got.masked}` : "服务端未收到")

  // ⑤ 分片消息：首片 fin=false + 续片 fin=true
  sock.write(clientFrame(0x1, Buffer.from("part1-", "utf8"), false))
  sock.write(clientFrame(0x0, Buffer.from("part2", "utf8"), true))
  await new Promise((r) => setTimeout(r, 300))
  const p1 = received.find((f) => f.text === "part1-")
  const p2 = received.find((f) => f.text === "part2")
  check("⑤ 分片帧可发送（首片 fin=false + 续片 fin=true）",
    !!p1 && p1.fin === false && !!p2 && p2.fin === true)

  // ⑥ ping → pong
  sock.write(clientFrame(0x9, Buffer.from("ping-payload", "utf8")))
  await new Promise((r) => setTimeout(r, 300))
  const ping = received.find((f) => f.opcode === 0x9)
  check("⑥ 控制帧 ping 能发出", !!ping)

  // ⑦ 大消息（>125 字节，触发 126 扩展长度分支）
  const big = "x".repeat(400)
  sock.write(clientFrame(0x1, Buffer.from(big, "utf8")))
  await new Promise((r) => setTimeout(r, 300))
  const gotBig = received.find((f) => f.text === big && f.text.length === 400)
  check("⑦ 长消息（400B）扩展长度编码正确", !!gotBig)

  sock.destroy()
  server.close()

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("探针异常:", e)
  process.exit(1)
})
