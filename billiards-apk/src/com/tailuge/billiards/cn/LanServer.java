package com.tailuge.billiards.cn;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/**
 * v1.3.65：局域网对战 —— 进程内 WebSocket 服务端（手写 RFC6455）。
 *
 * 设计：
 *  - 服务端是纯转发器：任一客户端发来的文本帧，广播给「除发送者外」的所有
 *    其它客户端。主机页面自己也是一个 WebSocket 客户端（ws://127.0.0.1:端口），
 *    与客机页面完全对称，Java 层不解析游戏消息、不做任何游戏逻辑。
 *  - RFC6455 要点：HTTP Upgrade 握手（Sec-WebSocket-Accept =
 *    base64(sha1(key + GUID))）；客户端帧必须掩码（服务端解掩码），服务端
 *    出站帧不掩码；文本帧 opcode=1，continuation=0，close=8，ping=9，pong=10；
 *    payload 长度 7bit / 126+2byte / 127+8byte 三档。
 *  - 为什么不用 NanoHTTPD 之类的库？保持 APK 零三方依赖、构建脚本不引入新输入；
 *    RFC6455 服务端所需代码量很小（这里约 300 行），自写更可控。
 *  - Java 8 语法兼容（build-apk.sh 用 -source 1.8 -target 1.8 编译）；
 *    Base64 自带实现（java.util.Base64 是 Android API 26+，minSdk 21 不能用）。
 */
public class LanServer {

    /** 状态回调（由 LanBridge 转发到页面）。全部在网络线程上触发，
     *  LanBridge 负责 runOnUiThread 包装。
     *
     *  v1.3.69：onStarted 增加 ip/iface/hasWifiIface/error 字段。Bind 成功后立刻
     *  取一次网络诊断（与 LanBridge.lanInfo() 同源），随 started 事件一起 emit
     *  给页面。page 端在 onStatus("started") 中就能拿到 IP —— 弹窗一次到位，
     *  不再依赖后续 JSBridge 异步调用（v1.3.67/68 实测有"事件丢了或延迟"导致
     *  detail 永远停在「等待对手加入…」的现象）。ip 为空时仍由 page 端分级提示。 */
    public interface Listener {
        void onStarted(int port, String ip, String iface, boolean hasWifiIface, String error);
        void onStartFailed(String reason);
        void onClientCount(int count);
        void onMessage(String message);
        void onLog(String line);
    }

    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    /** 单条消息上限：HIT 的 tablejson（含整桌球位）在十几 KB 量级，2MB 足够 */
    private static final int MAX_MESSAGE = 2 * 1024 * 1024;
    private static final int MAX_HANDSHAKE = 16 * 1024;

    private final Listener listener;
    private final Object lock = new Object();
    private final List<Client> clients = new ArrayList<Client>();
    private ServerSocket serverSocket;
    private Thread acceptThread;
    private volatile boolean running = false;

    private static class Client {
        Socket socket;
        InputStream in;
        OutputStream out;
        StringBuilder partial;   // 分片消息重组缓冲
    }

    public LanServer(Listener listener) {
        this.listener = listener;
    }

    public boolean isRunning() {
        return running;
    }

    /** 当前已连接客户端数（含主机页面自己的 127.0.0.1 连接） */
    public int clientCount() {
        synchronized (lock) {
            return clients.size();
        }
    }

    /**
     * 在 preferredPort 起 服务端；被占用则依次向后试 9 个端口。
     * 成功回调 onStarted(实际端口)，全部失败回调 onStartFailed。
     */
    public void start(final int preferredPort) {
        if (running) {
            // v1.3.69：已在跑时复用端口（-1 表示复用），仍走一次诊断带回 IP
            // 让 page 端弹窗一次到位。
            String[] probe = probeLanInfo();
            notifyStarted(-1, probe[0], probe[1], "true".equals(probe[2]), probe[3]);
            return;
        }
        running = true;
        acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop(preferredPort);
            }
        }, "LanServer-accept");
        acceptThread.start();
    }

    private void acceptLoop(int preferredPort) {
        ServerSocket ss = null;
        String fail = "unknown";
        for (int i = 0; i < 10; i++) {
            try {
                ss = new ServerSocket(preferredPort + i, 8);
                break;
            } catch (IOException e) {
                fail = e.getMessage() == null ? "bind " + (preferredPort + i) : e.getMessage();
            }
        }
        if (ss == null) {
            running = false;
            if (listener != null) listener.onStartFailed(fail);
            return;
        }
        synchronized (this) { serverSocket = ss; }
        // v1.3.69：bind 成功后再取一次网络诊断（与 LanBridge.lanInfo() 同源算法），
        // 让 onStarted 一次带回 IP，避免 page 端再做一次 JSBridge 异步调用。
        // 失败也不影响 started 本身 —— 把异常原因塞 error 字段，page 端按分级提示。
        String[] probe = probeLanInfo();
        if (listener != null) listener.onStarted(
            ss.getLocalPort(), probe[0], probe[1], "true".equals(probe[2]), probe[3]
        );
        while (running) {
            try {
                final Socket s = ss.accept();
                // 每个连接独立线程处理（握手 + 读循环）。
                // 关键：不能用当前线程直接 handleConnection —— readLoop 会一直
                // 阻塞在这个连接上，accept 线程就再也收不到第二个客户端
                // （实测表现为第二个客户端握手超时）。
                Thread t = new Thread(new Runnable() {
                    @Override
                    public void run() {
                        handleConnection(s);
                    }
                }, "LanServer-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (running && listener != null) listener.onLog("accept: " + e);
                // running=false 时是正常 close() 打断
                break;
            }
        }
        closeAll();
    }

    private void handleConnection(Socket s) {
        try {
            s.setTcpNoDelay(true);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            if (!performHandshake(in, out)) {
                try { s.close(); } catch (IOException ignored) {}
                return;
            }
            Client c = new Client();
            c.socket = s;
            c.in = in;
            c.out = out;
            synchronized (lock) { clients.add(c); }
            notifyCount();
            readLoop(c);
        } catch (IOException e) {
            if (listener != null) listener.onLog("conn: " + e);
        }
    }

    /** RFC6455 握手：读 HTTP 头 → 计算 Sec-WebSocket-Accept → 回 101 */
    private boolean performHandshake(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[MAX_HANDSHAKE];
        int total = 0;
        // 读到 \r\n\r\n（限制总量防恶意客户端）
        while (total < MAX_HANDSHAKE) {
            int n = in.read(buf, total, MAX_HANDSHAKE - total);
            if (n < 0) return false;
            total += n;
            String head = new String(buf, 0, total, "UTF-8");
            if (head.contains("\r\n\r\n")) break;
        }
        String head = new String(buf, 0, total, "UTF-8");
        String key = null;
        boolean upgrade = false;
        for (String line : head.split("\r\n")) {
            String l = line.toLowerCase();
            if (l.startsWith("sec-websocket-key:")) {
                key = line.substring(line.indexOf(':') + 1).trim();
            } else if (l.startsWith("upgrade:")) {
                upgrade = l.contains("websocket");
            }
        }
        if (key == null || !upgrade) {
            if (listener != null) listener.onLog("handshake: 非 WebSocket 请求已拒绝");
            return false;
        }
        String accept = b64(sha1(key + WS_GUID));
        String resp = "HTTP/1.1 101 Switching Protocols\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Accept: " + accept + "\r\n"
            + "\r\n";
        out.write(resp.getBytes("UTF-8"));
        out.flush();
        return true;
    }

    /** 单连接读循环：解析帧 → 文本消息广播给其它客户端 */
    private void readLoop(final Client c) {
        try {
            while (running) {
                int opcode = readFrame(c);
                if (opcode < 0) break; // 连接结束
            }
        } catch (IOException e) {
            if (running && listener != null) listener.onLog("read: " + e);
        } finally {
            boolean removed = false;
            synchronized (lock) {
                removed = clients.remove(c);
            }
            try { c.socket.close(); } catch (IOException ignored) {}
            if (removed) {
                notifyCount();
            }
        }
    }

    /**
     * 读一帧。返回该帧 opcode（0=continuation）；返回 -1 表示连接应结束。
     * 文本消息（含分片重组完成后）就地广播，不向上层返回内容。
     */
    private int readFrame(Client c) throws IOException {
        InputStream in = c.in;
        int b0 = in.read();
        if (b0 < 0) return -1;
        int b1 = in.read();
        if (b1 < 0) return -1;
        boolean fin = (b0 & 0x80) != 0;
        int opcode = b0 & 0x0F;
        boolean masked = (b1 & 0x80) != 0;
        long len = b1 & 0x7F;
        if (len == 126) {
            int hi = in.read(), lo = in.read();
            if (lo < 0) return -1;
            len = ((hi & 0xFF) << 8) | (lo & 0xFF);
        } else if (len == 127) {
            len = 0;
            for (int i = 0; i < 8; i++) {
                int v = in.read();
                if (v < 0) return -1;
                len = (len << 8) | (v & 0xFF);
            }
        }
        if (len > MAX_MESSAGE) {
            if (listener != null) listener.onLog("帧过大 " + len + "，断开");
            return -1;
        }
        byte[] mask = new byte[4];
        if (masked) {
            readN(in, mask, 4);
        }
        byte[] payload = new byte[(int) len];
        if (len > 0) {
            readN(in, payload, (int) len);
            if (masked) {
                for (int i = 0; i < payload.length; i++) {
                    payload[i] = (byte) (payload[i] ^ mask[i & 3]);
                }
            }
        }

        switch (opcode) {
            case 0x8: // close：回 close 帧并结束
                try {
                    byte[] empty2 = {0, 0};
                    writeFrame(c.out, 0x8, empty2);
                } catch (IOException ignored) {}
                return -1;
            case 0x9: // ping → pong
                writeFrame(c.out, 0xA, payload);
                return 0x9;
            case 0xA: // pong 忽略
                return 0xA;
            case 0x0: // continuation：拼到缓冲
            case 0x1: // 文本
            case 0x2: // 二进制（本项目只用文本，按文本处理）
                if (c.partial == null) {
                    if (opcode == 0x0) return opcode; // 无前置分片，丢弃
                    c.partial = new StringBuilder();
                }
                c.partial.append(new String(payload, "UTF-8"));
                if (c.partial.length() > MAX_MESSAGE) {
                    c.partial = null;
                    return -1;
                }
                if (fin) {
                    String msg = c.partial.toString();
                    c.partial = null;
                    broadcast(msg, c);
                }
                return opcode;
            default:
                return opcode;
        }
    }

    /** 把消息广播给除 sender 外的所有客户端 */
    private void broadcast(String message, Client sender) {
        byte[] data;
        try {
            data = message.getBytes("UTF-8");
        } catch (Exception e) {
            return;
        }
        List<Client> targets;
        synchronized (lock) {
            targets = new ArrayList<Client>();
            for (Client c : clients) {
                if (c != sender) targets.add(c);
            }
        }
        for (Client t : targets) {
            try {
                writeFrame(t.out, 0x1, data);
            } catch (IOException e) {
                // 发送失败：踢掉该连接（其读线程会感知并清理）
                try { t.socket.close(); } catch (IOException ignored) {}
                synchronized (lock) { clients.remove(t); }
                notifyCount();
            }
        }
        if (listener != null) listener.onMessage(message);
    }

    /** 服务端出站帧：不掩码 */
    private static void writeFrame(OutputStream out, int opcode, byte[] payload) throws IOException {
        int n = payload.length;
        ByteArrayOutputStream f = new ByteArrayOutputStream(n + 10);
        f.write(0x80 | opcode); // FIN=1
        if (n < 126) {
            f.write(n);
        } else if (n < 65536) {
            f.write(126);
            f.write((n >> 8) & 0xFF);
            f.write(n & 0xFF);
        } else {
            f.write(127);
            // 注意：n 是 int，直接 n >> (8*i) 在 i>=4 时因 int 移位只取低 5 位
            // 会得到错误字节（实测 >65535 的消息客户端收到后长度乱码、立即断开）。
            // 必须转 long 后再移。
            long v = n;
            for (int i = 7; i >= 0; i--) {
                f.write((int) ((v >> (8 * i)) & 0xFF));
            }
        }
        f.write(payload);
        synchronized (out) {
            out.write(f.toByteArray());
            out.flush();
        }
    }

    private static void readN(InputStream in, byte[] buf, int n) throws IOException {
        int off = 0;
        while (off < n) {
            int r = in.read(buf, off, n - off);
            if (r < 0) throw new IOException("EOF");
            off += r;
        }
    }

    public synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {}
        closeAll();
    }

    private void closeAll() {
        synchronized (lock) {
            for (Client c : clients) {
                try { c.socket.close(); } catch (IOException ignored) {}
            }
            clients.clear();
        }
    }

    private void notifyStarted(int port, String ip, String iface, boolean hasWifiIface, String error) {
        if (listener != null) listener.onStarted(port, ip, iface, hasWifiIface, error);
    }

    /**
     * v1.3.69：复用 LanBridge 的网络诊断算法，bind 成功后立刻取一次（同步、无 UI 线程依赖）。
     * 返回 {ip, iface, hasWifiIface("true"/"false"), error}；任何字段为空串即"未取得"。
     */
    static String[] probeLanInfo() {
        String ip = "";
        String iface = "";
        boolean hasWifi = false;
        String error = "";
        try {
            java.util.Enumeration<java.net.NetworkInterface> nis = java.net.NetworkInterface.getNetworkInterfaces();
            if (nis == null) {
                error = "getNetworkInterfaces() 返回 null";
            } else {
                java.net.NetworkInterface best = null;
                String bestIp = "";
                int bestRank = -1;
                for (java.net.NetworkInterface ni : java.util.Collections.list(nis)) {
                    if (ni == null || !ni.isUp() || ni.isLoopback()) continue;
                    String name = ni.getName() == null ? "" : ni.getName();
                    if (isIfaceBlacklisted(name)) continue;
                    if (name.startsWith("wlan")) hasWifi = true;
                    int rank = rankOfIface(name);
                    if (rank < 0) continue;
                    for (java.net.InetAddress a : java.util.Collections.list(ni.getInetAddresses())) {
                        if (!(a instanceof java.net.Inet4Address) || a.isLoopbackAddress()) continue;
                        String s = a.getHostAddress();
                        if (s == null || s.isEmpty() || s.startsWith("169.254.")) continue;
                        if (rank > bestRank) { bestRank = rank; best = ni; bestIp = s; }
                    }
                }
                if (best != null) { ip = bestIp; iface = best.getName() == null ? "" : best.getName(); }
            }
        } catch (Throwable t) {
            error = t.getClass().getSimpleName() + ": " + t.getMessage();
        }
        return new String[]{ip, iface, hasWifi ? "true" : "false", error};
    }

    private static int rankOfIface(String name) {
        if (name.startsWith("wlan")) return 3;
        if (name.startsWith("eth")) return 2;
        return 1;
    }

    private static boolean isIfaceBlacklisted(String name) {
        return name.startsWith("ap0")
                || name.startsWith("p2p")
                || name.startsWith("rndis")
                || name.startsWith("bt-pan")
                || name.startsWith("dummy")
                || name.startsWith("sit")
                || name.startsWith("gre")
                || name.startsWith("ip6tnl");
    }
    private void notifyCount() {
        if (listener != null) listener.onClientCount(clientCount());
    }

    // ---------- 工具：SHA1 与 Base64（minSdk 21 无 java.util.Base64） ----------

    private static byte[] sha1(String s) {
        try {
            return MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-1 不可用", e);
        }
    }

    static byte[] B64T = new byte[0]; // 占位防止误用，无实际用途

    /** 标准 Base64 编码（RFC4648，含 padding） */
    static String b64(byte[] data) {
        char[] tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
        StringBuilder sb = new StringBuilder(((data.length + 2) / 3) * 4);
        int i = 0;
        for (; i + 2 < data.length; i += 3) {
            int v = ((data[i] & 0xFF) << 16) | ((data[i + 1] & 0xFF) << 8) | (data[i + 2] & 0xFF);
            sb.append(tbl[(v >> 18) & 63]).append(tbl[(v >> 12) & 63])
              .append(tbl[(v >> 6) & 63]).append(tbl[v & 63]);
        }
        int rem = data.length - i;
        if (rem == 1) {
            int v = (data[i] & 0xFF) << 16;
            sb.append(tbl[(v >> 18) & 63]).append(tbl[(v >> 12) & 63]).append("==");
        } else if (rem == 2) {
            int v = ((data[i] & 0xFF) << 16) | ((data[i + 1] & 0xFF) << 8);
            sb.append(tbl[(v >> 18) & 63]).append(tbl[(v >> 12) & 63])
              .append(tbl[(v >> 6) & 63]).append('=');
        }
        return sb.toString();
    }
}
