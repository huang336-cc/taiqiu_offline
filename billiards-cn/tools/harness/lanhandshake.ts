/**
 * v1.3.79：局域网握手诊断探针。
 *
 * 目的：在桌面环境用**同一套握手算法**（LanServer.java 的 performHandshake）
 * 起一个真实服务端，验证：
 *   ① 标准 RFC6455 握手（浏览器 / WebView 发的格式）能被服务端接受 →
 *      证明「客机连不上」不是握手实现本身的 bug；
 *   ② 非 WebSocket 请求（浏览器 GET /）会被拒绝并落到日志 →
 *      证明诊断日志能区分「别人的请求」与「我们的请求」；
 *   ③ 握手后能正常收发一帧文本消息（端到端）。
 *
 * 这样把 Java 侧算法在 Node 里等价复现，真机拿到的日志（accept 来自 / 首行 /
 * key / upgrade / 握手成功）就能被直接解读。
 */

import { createServer, Socket } from "node:net"
import { createHash } from "node:crypto"

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const MAX_HANDSHAKE = 8192

interface LogEntry {
  line: string
}

const logs: LogEntry[] = []
function log(line: string): void {
  logs.push({ line })
}

/** LanServer.performHandshake 的等价实现（算法逐行对齐） */
function performHandshake(
  chunks: Buffer[]
): { ok: boolean; key: string | null; upgrade: boolean; firstLine: string } {
  const head = Buffer.concat(chunks).toString("utf8")
  let key: string | null = null
  let upgrade = false
  for (const line of head.split("\r\n")) {
    const l = line.toLowerCase()
    if (l.startsWith("sec-websocket-key:")) {
      key = line.substring(line.indexOf(":") + 1).trim()
    } else if (l.startsWith("upgrade:")) {
      upgrade = l.includes("websocket")
    }
  }
  const nl = head.indexOf("\r\n")
  const firstLine = nl > 0 ? head.substring(0, nl) : head
  log(`handshake 收到: ${firstLine} | key=${key === null ? "无" : "有"} | upgrade=${upgrade}`)
  return { ok: key !== null && upgrade, key, upgrade, firstLine }
}

function accept(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64")
}

/** 服务端发帧（不加掩码，同 LanServer.writeFrame） */
function encodeText(text: string): Buffer {
  const payload = Buffer.from(text, "utf8")
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.from([0x81, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

/** 客户端发帧必须加掩码（同浏览器行为） */
function encodeMaskedText(text: string): Buffer {
  const payload = Buffer.from(text, "utf8")
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44])
  const masked = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3]
  const header = Buffer.from([0x81, 0x80 | payload.length])
  return Buffer.concat([header, mask, masked])
}

function decodeServerFrame(buf: Buffer): string | null {
  const b0 = buf[0]
  let len = buf[1] & 0x7f
  let off = 2
  if (len === 126) {
    len = buf.readUInt16BE(2)
    off = 4
  } else if (len === 127) {
    len = Number(buf.readBigUInt64BE(2))
    off = 10
  }
  if (buf.length < off + len) return null
  return buf.subarray(off, off + len).toString("utf8")
}

/** v1.3.80：探测请求（与 LanBridge.probePeer 同款） */
function probeRequest(host: string, port: number): string {
  return (
    "GET / HTTP/1.1\r\n" +
    "Host: " + host + ":" + port + "\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Key: " + PROBE_KEY + "\r\n" +
    "Sec-WebSocket-Version: 13\r\n\r\n"
  )
}

const PROBE_KEY = "dGhlIHNhbXBsZSBub25jZQ=="

/**
 * v1.3.80：模拟 LanBridge.probePeer 的判断逻辑，对四种服务端形态做定论。
 * 这是升级后的核心 —— 旧版只看 connect 成功就返回 ok，会误判。
 */
function probe(port: number, mode: "ws" | "silent" | "http" | "none"): Promise<string> {
  return new Promise((resolve) => {
    if (mode === "none") {
      // 端口没人监听
      const s0 = new Socket()
      s0.connect(port + 1, "127.0.0.1")
      s0.on("error", () => resolve("refused（端口无人监听）"))
      setTimeout(() => { s0.destroy(); resolve("refused（端口无人监听）") }, 1200)
      return
    }
    const sock = new Socket()
    let settled = false
    const done = (v: string) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(v)
    }
    sock.connect(port, "127.0.0.1", () => {
      sock.write(probeRequest("127.0.0.1", port))
    })
    sock.on("data", (d: Buffer) => {
      const s = d.toString("utf8")
      if (s.startsWith("HTTP/1.1 101") || s.startsWith("HTTP/1.0 101")) {
        done("ok:101（服务端完全正常）")
      } else if (s.startsWith("HTTP/")) {
        done("ok:http:" + s.split("\r\n")[0] + "（端口被别的程序占用）")
      } else {
        done("ok:garbage（不是 WebSocket 服务）")
      }
    })
    sock.on("error", () => done("refused（端口无人监听）"))
    setTimeout(() => done("ok:silent（端口有人但不应答）"), 2500)
  })
}

async function main(): Promise<void> {
  // ---- v1.3.80：四种服务端形态下的探测结论 ----
  console.log("=== v1.3.80 握手探测（probePeer）定论能力 ===")

  // A) 正常 WebSocket 服务端
  const good = createServer((sock) => {
    const chunks: Buffer[] = []
    sock.on("data", (d: Buffer) => {
      chunks.push(d)
      if (!Buffer.concat(chunks).toString("utf8").includes("\r\n\r\n")) return
      const keyBuf = Buffer.concat(chunks).toString("utf8")
      const m = /sec-websocket-key:\s*(\S+)/i.exec(keyBuf)
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
          "Connection: Upgrade\r\nSec-WebSocket-Accept: " +
          accept(m ? m[1] : "x") + "\r\n\r\n"
      )
    })
  })
  await new Promise<void>((r) => good.listen(0, "127.0.0.1", r))
  const pGood = (good.address() as { port: number }).port
  console.log("  A 正常服务端     →", await probe(pGood, "ws"))

  // B) 只 accept、不应答（模拟线程卡死 / 系统探测）
  const silent = createServer(() => {
    /* 故意什么都不做 */
  })
  await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r))
  const pSilent = (silent.address() as { port: number }).port
  console.log("  B 只连不应答     →", await probe(pSilent, "silent"))

  // C) 端口被普通 HTTP 服务占用
  const http = createServer((sock) => {
    sock.on("data", () => {
      sock.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi")
    })
  })
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r))
  const pHttp = (http.address() as { port: number }).port
  console.log("  C 被 HTTP 占用   →", await probe(pHttp, "http"))

  // D) 端口没人监听
  const pNone = 59999
  console.log("  D 端口无人监听   →", await probe(pNone, "none"))

  good.close()
  silent.close()
  http.close()

  console.log("\n=== 旧版（只看 connect 成功）对照 ===")
  console.log("  旧判定：A/B/C 三种形态**全部**返回 ok —— 无法区分，正是真机上")
  console.log("  「probePeer 报 ok 但 WebSocket 报 1006」矛盾的来源。")

  // ---- 原有：端到端握手与帧往返 ----
  console.log("\n=== 端到端（标准握手 + 掩码帧） ===")
  const server2 = createServer((sock: Socket) => {
    const chunks: Buffer[] = []
    sock.on("data", (d: Buffer) => {
      chunks.push(d)
      const head = Buffer.concat(chunks).toString("utf8")
      if (!head.includes("\r\n\r\n")) return
      sock.removeAllListeners("data")
      const r = performHandshake(chunks)
      if (!r.ok) {
        log("handshake: 非 WebSocket 请求已拒绝")
        sock.destroy()
        return
      }
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: " + accept(r.key as string) + "\r\n\r\n"
      )
      log("handshake 成功: 已回 101")
      sock.once("data", (f: Buffer) => {
        const txt = decodeMaskedClient(f)
        log("收到客户端帧: " + txt)
        sock.write(encodeText(JSON.stringify({ echo: txt })))
      })
    })
  })
  await new Promise<void>((r) => server2.listen(0, "127.0.0.1", r))
  const port2 = (server2.address() as { port: number }).port

  const a = await wsClient(port2, "/")
  console.log("A 标准握手:", JSON.stringify(a))
  const c = await wsClient(port2, "/", "hello-from-join")
  console.log("C 帧往返:", JSON.stringify(c))
  server2.close()

  console.log("\n=== 服务端日志 ===")
  for (const e of logs) console.log("  " + e.line)
}

/** 模拟浏览器/WebView 的 WebSocket 客户端（标准握手 + 掩码帧） */
function wsClient(
  port: number,
  path: string,
  msg?: string
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const sock = new Socket()
    let buf = Buffer.alloc(0)
    let handshaken = false
    sock.connect(port, "127.0.0.1", () => {
      const key = Buffer.from(
        "dGhlIHNhbXBsZSBub25jZQ=="
      ).toString("base64")
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
          "Host: 127.0.0.1:" + port + "\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: " + key + "\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n"
      )
    })
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      if (!handshaken) {
        const s = buf.toString("utf8")
        if (!s.includes("\r\n\r\n")) return
        handshaken = true
        const ok = s.includes("101 Switching Protocols")
        buf = buf.subarray(s.indexOf("\r\n\r\n") + 4)
        if (!msg) {
          sock.destroy()
          resolve({ ok, detail: ok ? "101 已确认" : s.split("\r\n")[0] })
          return
        }
        sock.write(encodeMaskedText(msg))
        return
      }
      const frame = decodeServerFrame(buf)
      if (frame === null) return
      sock.destroy()
      resolve({ ok: true, detail: frame })
    })
    sock.on("error", (e: Error) => resolve({ ok: false, detail: e.message }))
    setTimeout(() => {
      sock.destroy()
      resolve({ ok: false, detail: "timeout" })
    }, 3000)
  })
}

function decodeMaskedClient(buf: Buffer): string {
  const len = buf[1] & 0x7f
  const mask = buf.subarray(2, 6)
  const payload = buf.subarray(6, 6 + len)
  const out = Buffer.alloc(len)
  for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]
  return out.toString("utf8")
}

/** 模拟非 WebSocket 的普通 HTTP GET */
function rawHttpGet(port: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const sock = new Socket()
    let data = ""
    sock.connect(port, "127.0.0.1", () => {
      sock.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
    })
    sock.on("data", (d: Buffer) => {
      data += d.toString("utf8")
    })
    sock.on("close", () => {
      resolve({ ok: false, detail: data.length === 0 ? "被直接关闭（无响应）" : data.split("\r\n")[0] })
    })
    sock.on("error", () => resolve({ ok: false, detail: "error" }))
    setTimeout(() => {
      sock.destroy()
      resolve({ ok: false, detail: data ? data.split("\r\n")[0] : "timeout/closed" })
    }, 2000)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
