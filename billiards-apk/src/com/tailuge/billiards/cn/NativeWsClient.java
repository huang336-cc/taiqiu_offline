package com.tailuge.billiards.cn;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.security.MessageDigest;
import java.util.Random;

/**
 * v1.3.81：原生 Socket 实现的 WebSocket **客户端**。
 *
 * 为什么需要它（这是局域网对战真正的修复点）
 * ------------------------------------------
 * 真机诊断已经收敛到唯一结论：
 *   - 客机的原生 Socket 能**完整完成**一次 WebSocket 握手（发 GET+Upgrade、
 *     收到 101），也就是 `LanBridge.probePeer` 返回 `ok:101`；
 *   - 桌面 chromium 用 http 页面连同一个服务端，`new WebSocket()` 正常 open；
 *   - 但客机 WebView 自己的 `new WebSocket("ws://<对方IP>:24816")` 始终
 *     `readyState=3` + `close code=1006`（异常断开，未收到关闭帧），连 TCP 都
 *     没建立起来。
 * 即：**同一台手机、同一个目标、同一时刻，原生 Socket 通，WebView 不通。**
 * 问题锁定在 Android WebView 的 Chromium 网络栈（明文 ws:// 在该栈上被拒），
 * 与用户的网络、对方服务端、握手实现都无关。
 *
 * 结论：**不再让 WebView 负责局域网连接**。本类用原生 Socket 实现 RFC6455
 * 客户端，页面通过 JSBridge 把「要发的文本」交给它、它把「收到的文本」推回
 * 页面。整条链路绕开 WebView 网络栈，与已验证可用的 probePeer 同一条通路。
 *
 * 协议实现要点（RFC6455）
 * ----------------------
 *   - 握手：随机 16 字节 Sec-WebSocket-Key（base64），校验回包的 101 与
 *     Sec-WebSocket-Accept；
 *   - 发帧：客户端**必须加掩码**（mask bit=1 + 4 字节随机掩码）；
 *   - 收帧：服务端发来的帧**不带掩码**；处理分片（continuation）与
 *     ping/pong/close 控制帧。
 *
 * 线程模型
 * --------
 *   连接与读循环各占一个 daemon 线程；所有对页面的回调都经 Listener 出去，
 *   由 LanBridge 负责切回 UI 线程 evaluateJavascript。
 */
public class NativeWsClient {

    /** 客户端 → 页面 的事件回调（在**后台线程**触发，调用方负责切 UI 线程） */
    public interface Listener {
        /** 已成功握手并建立连接 */
        void onOpen();
        /** 收到一条完整文本消息 */
        void onMessage(String text);
        /** 连接结束（正常关闭或异常），reason 用于诊断 */
        void onClose(String reason);
        /** 诊断日志 */
        void onLog(String line);
    }

    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    /** 连接（含握手）超时；与页面侧 JOIN_TIMEOUT_MS 协调 */
    private static final int CONNECT_TIMEOUT_MS = 6000;
    /** 握手完成后进入长连接，读操作不再超时 */
    private static final int MAX_HANDSHAKE = 16 * 1024;
    private static final int MAX_FRAME = 2 * 1024 * 1024;

    private final Listener listener;
    private final Object lock = new Object();
    private volatile Socket socket;
    private volatile OutputStream out;
    private volatile boolean running;
    private Thread readThread;
    private final Random random = new Random();

    public NativeWsClient(Listener listener) {
        this.listener = listener;
    }

    /** 是否已连接 */
    public boolean isConnected() {
        Socket s = socket;
        return running && s != null && s.isConnected() && !s.isClosed();
    }

    /**
     * 发起连接。**异步**：结果经 Listener.onOpen / onClose 通知。
     * 重复调用会先关掉上一条连接。
     */
    public void connect(final String host, final int port) {
        close();
        running = true;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                doConnect(host, port);
            }
        }, "NativeWs-connect");
        t.setDaemon(true);
        t.start();
    }

    private void doConnect(String host, int port) {
        Socket s = new Socket();
        try {
            s.setTcpNoDelay(true);
            s.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            s.setSoTimeout(CONNECT_TIMEOUT_MS);
            if (!running) {
                silentClose(s);
                return;
            }
            OutputStream os = s.getOutputStream();
            InputStream is = s.getInputStream();

            // ---- 握手 ----
            String key = randomKey();
            String req = "GET / HTTP/1.1\r\n"
                + "Host: " + host + ":" + port + "\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + key + "\r\n"
                + "Sec-WebSocket-Version: 13\r\n"
                + "\r\n";
            os.write(req.getBytes("UTF-8"));
            os.flush();

            byte[] buf = new byte[MAX_HANDSHAKE];
            int total = 0;
            while (total < MAX_HANDSHAKE) {
                int n = is.read(buf, total, MAX_HANDSHAKE - total);
                if (n < 0) {
                    fail("握手阶段对端断开（已收 " + total + " 字节）");
                    silentClose(s);
                    return;
                }
                total += n;
                if (new String(buf, 0, total, "UTF-8").contains("\r\n\r\n")) break;
            }
            String head = new String(buf, 0, total, "UTF-8");
            int headEnd = head.indexOf("\r\n\r\n");
            if (headEnd < 0) {
                fail("握手响应不完整（" + total + " 字节）");
                silentClose(s);
                return;
            }
            String statusLine = head.substring(0, Math.max(0, head.indexOf("\r\n")));
            if (!statusLine.contains("101")) {
                fail("握手被拒绝：" + statusLine);
                silentClose(s);
                return;
            }
            // 校验 Sec-WebSocket-Accept（协议合规性自检）
            String expect = b64(sha1(key + WS_GUID));
            String got = headerValue(head, "sec-websocket-accept");
            if (got != null && !got.equals(expect)) {
                fail("Sec-WebSocket-Accept 不匹配");
                silentClose(s);
                return;
            }

            synchronized (lock) {
                socket = s;
                out = os;
            }
            // 握手完成 → 转入长连接读循环（读操作不设超时）
            s.setSoTimeout(0);
            log("原生通道已连接 " + host + ":" + port);
            if (listener != null) listener.onOpen();

            // 握手响应可能已夹带后续数据帧，先处理掉
            byte[] leftover = new byte[0];
            if (total > headEnd + 4) {
                leftover = new byte[total - headEnd - 4];
                System.arraycopy(buf, headEnd + 4, leftover, 0, leftover.length);
            }
            readLoop(is, leftover);
        } catch (java.net.ConnectException e) {
            fail("连接被拒绝（对方端口未监听）");
            silentClose(s);
        } catch (java.net.SocketTimeoutException e) {
            fail("连接超时");
            silentClose(s);
        } catch (Throwable t) {
            fail(t.getClass().getSimpleName()
                + (t.getMessage() == null ? "" : ": " + t.getMessage()));
            silentClose(s);
        }
    }

    /** 读循环：解析帧 → 文本消息回调；控制帧就地处理 */
    private void readLoop(InputStream is, byte[] pending) {
        readThread = Thread.currentThread();
        FrameReader rd = new FrameReader(is, pending);
        StringBuilder partial = new StringBuilder();
        try {
            while (running) {
                int opcode = rd.next();
                if (opcode < 0) break;
                if (opcode == 0x1 || opcode == 0x0) {
                    // 文本帧 / 续帧
                    partial.append(rd.text());
                    if (rd.fin()) {
                        String msg = partial.toString();
                        partial.setLength(0);
                        if (listener != null) listener.onMessage(msg);
                    }
                } else if (opcode == 0x8) {
                    close();
                    if (listener != null) listener.onClose("对端关闭连接");
                    return;
                } else if (opcode == 0x9) {
                    // ping → pong
                    try {
                        writeFrame(0xA, rd.payload());
                    } catch (IOException ignored) {
                        break;
                    }
                }
                // 0xA (pong) 无需处理
            }
            if (running) {
                if (listener != null) listener.onClose("对方断开连接");
            }
        } catch (Throwable t) {
            if (running && listener != null) {
                listener.onClose("读取出错：" + t.getClass().getSimpleName());
            }
        } finally {
            running = false;
            silentClose(socket);
        }
    }

    /** 发送一条文本消息（自动加掩码）。返回是否发出 */
    public boolean sendText(String text) {
        if (!isConnected() || text == null) return false;
        try {
            writeFrame(0x1, text.getBytes("UTF-8"));
            return true;
        } catch (Throwable t) {
            log("发送失败：" + t.getClass().getSimpleName());
            return false;
        }
    }

    /** 主动关闭 */
    public void close() {
        running = false;
        Socket s = socket;
        synchronized (lock) {
            socket = null;
            out = null;
        }
        if (s != null) {
            // 尽力发一个 close 帧，失败也无所谓
            try {
                OutputStream os = s.getOutputStream();
                if (os != null) {
                    os.write(new byte[]{(byte) 0x88, (byte) 0x80,
                        (byte) 0x11, (byte) 0x22, (byte) 0x33, (byte) 0x44});
                    os.flush();
                }
            } catch (Throwable ignored) {}
            silentClose(s);
        }
        Thread t = readThread;
        if (t != null && t != Thread.currentThread()) {
            try { t.interrupt(); } catch (Throwable ignored) {}
        }
    }

    // ---------------- 帧编解码 ----------------

    /** 写一帧（客户端 → 服务端，**必须加掩码**） */
    private void writeFrame(int opcode, byte[] payload) throws IOException {
        OutputStream os = out;
        if (os == null) throw new IOException("not connected");
        byte[] mask = new byte[4];
        random.nextBytes(mask);
        int len = payload.length;
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream(len + 14);
        b.write(0x80 | (opcode & 0x0F));
        if (len < 126) {
            b.write(0x80 | len);
        } else if (len < 65536) {
            b.write(0x80 | 126);
            b.write((len >>> 8) & 0xFF);
            b.write(len & 0xFF);
        } else {
            b.write(0x80 | 127);
            long l = len;
            for (int i = 7; i >= 0; i--) b.write((int) ((l >>> (8 * i)) & 0xFF));
        }
        b.write(mask, 0, 4);
        byte[] masked = new byte[len];
        for (int i = 0; i < len; i++) masked[i] = (byte) (payload[i] ^ mask[i & 3]);
        b.write(masked, 0, len);
        synchronized (lock) {
            os.write(b.toByteArray());
            os.flush();
        }
    }

    /** 逐帧读取器（服务端 → 客户端，帧**无掩码**） */
    private static final class FrameReader {
        private final InputStream in;
        private byte[] pending;
        private boolean fin;
        private String text;
        private byte[] payload;

        FrameReader(InputStream in, byte[] pending) {
            this.in = in;
            this.pending = pending == null ? new byte[0] : pending;
        }

        boolean fin() { return fin; }
        String text() { return text; }
        byte[] payload() { return payload; }

        /** 读下一帧，返回 opcode；-1 表示流结束 */
        int next() throws IOException {
            int b0 = readByte();
            if (b0 < 0) return -1;
            int b1 = readByte();
            if (b1 < 0) return -1;
            fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0F;
            long len = b1 & 0x7F;
            if (len == 126) {
                int hi = readByte();
                int lo = readByte();
                if (lo < 0) return -1;
                len = ((hi & 0xFF) << 8) | (lo & 0xFF);
            } else if (len == 127) {
                len = 0;
                for (int i = 0; i < 8; i++) {
                    int v = readByte();
                    if (v < 0) return -1;
                    len = (len << 8) | (v & 0xFF);
                }
            }
            if (len > MAX_FRAME) throw new IOException("帧过大 " + len);
            boolean masked = (b1 & 0x80) != 0;
            byte[] mask = new byte[4];
            if (masked) {
                for (int i = 0; i < 4; i++) {
                    int v = readByte();
                    if (v < 0) return -1;
                    mask[i] = (byte) v;
                }
            }
            byte[] data = new byte[(int) len];
            int got = 0;
            while (got < len) {
                int v = read( data, got, (int) (len - got));
                if (v < 0) return -1;
                got += v;
            }
            if (masked) {
                for (int i = 0; i < data.length; i++) data[i] = (byte) (data[i] ^ mask[i & 3]);
            }
            payload = data;
            text = new String(data, "UTF-8");
            return opcode;
        }

        private int readByte() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n < 0 ? -1 : (one[0] & 0xFF);
        }

        /** 先消费握手里夹带的 pending，再读底层流 */
        private int read(byte[] dst, int off, int len) throws IOException {
            if (pending.length > 0) {
                int n = Math.min(len, pending.length);
                System.arraycopy(pending, 0, dst, off, n);
                byte[] rest = new byte[pending.length - n];
                System.arraycopy(pending, n, rest, 0, rest.length);
                pending = rest;
                return n;
            }
            return in.read(dst, off, len);
        }
    }

    // ---------------- 工具 ----------------

    private void fail(String reason) {
        running = false;
        log("原生通道失败：" + reason);
        if (listener != null) listener.onClose(reason);
    }

    private void log(String line) {
        if (listener != null) listener.onLog(line);
    }

    private static void silentClose(Socket s) {
        if (s == null) return;
        try { s.close(); } catch (Throwable ignored) {}
    }

    /** 生成随机的 Sec-WebSocket-Key（16 字节 → base64） */
    private String randomKey() {
        byte[] k = new byte[16];
        random.nextBytes(k);
        return b64(k);
    }

    private static String headerValue(String head, String name) {
        for (String line : head.split("\r\n")) {
            int c = line.indexOf(':');
            if (c < 0) continue;
            if (line.substring(0, c).trim().toLowerCase().equals(name)) {
                return line.substring(c + 1).trim();
            }
        }
        return null;
    }

    private static String b64(byte[] data) {
        return android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
    }

    private static byte[] sha1(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            return md.digest(s.getBytes("UTF-8"));
        } catch (Throwable t) {
            return new byte[0];
        }
    }
}
