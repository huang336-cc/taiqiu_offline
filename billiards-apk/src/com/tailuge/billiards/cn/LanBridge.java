package com.tailuge.billiards.cn;

import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileWriter;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;

/**
 * v1.3.65：局域网对战 JSBridge。
 *
 * 页面（https://billiards.local/）通过注入对象 window.__lan 调用：
 *   - __lan.startServer(24816)      启动进程内 WebSocket 服务端
 *   - __lan.stopServer()            停止（页面卸载/返回菜单时调用）
 *   - __lan.lanIp()                 返回本机局域网 IPv4（页面展示房间地址）
 *
 * Java → 页面回调统一走 window.__lanEvent(jsonText)（evaluateJavascript）：
 *   - {"k":"started","port":24816}    服务端就绪（port 为实际绑定端口）
 *   - {"k":"startfail","reason":".."} 端口全被占用等失败
 *   - {"k":"clients","n":1}           已连接 WebSocket 客户端数变化
 *   - {"k":"log","line":".."}         诊断日志（页面 console 转发）
 *
 * 注意：游戏对局消息不走此桥——主机页面自己也以 WebSocket 客户端身份
 * （ws://127.0.0.1:端口）收发，LanServer 在 Java 层做纯转发。此桥只负责
 * 服务端生命周期与状态通知，与消息转发解耦。
 */
public class LanBridge {

    /** v1.3.73：probePeer 的 TCP 连接超时（毫秒） */
    private static final int PROBE_TIMEOUT_MS = 3000;

    /**
     * v1.3.80：probePeer 用的握手 Key（合法的 16 字节 base64）。
     * 固定值即可 —— 探测不在意服务端算出的 Accept 是否正确，只在意它是否
     * 按 WebSocket 协议回应（101 / 普通 HTTP / 无响应 / 乱码）。
     */
    private static final String WS_PROBE_KEY = "dGhlIHNhbXBsZSBub25jZQ==";

    /** v1.3.79：局域网诊断日志文件名（落在 App 私有外部目录） */
    private static final String LOG_FILE = "lan-diag.log";
    /** v1.3.79：日志文件上限，超过就从头覆盖，避免无限增长 */
    private static final long LOG_MAX_BYTES = 64 * 1024;

    private final MainActivity activity;
    private final LanServer server;

    /**
     * v1.3.81：原生 WebSocket **客户端**（客机侧用它连主机，不再依赖 WebView
     * 的 new WebSocket()）。详见 NativeWsClient 的类注释。
     */
    private volatile NativeWsClient wsClient;

    /**
     * v1.3.81：启动原生 WebSocket 客户端连接。**异步**，结果经 __lanEvent 通知：
     *   {"k":"wsopen"}              握手成功，可以开始发消息
     *   {"k":"wsmsg","d":"..."}     收到一条文本消息
     *   {"k":"wsclose","reason":".."} 连接结束（失败或对方断开）
     *
     * 为什么把客机连接也搬到 Java 侧：真机诊断已收敛到唯一结论 —— 同一台手机、
     * 同一目标、同一时刻，原生 Socket 能完整完成 WebSocket 握手（probePeer 返回
     * ok:101），而 WebView 自己的 new WebSocket() 始终 1006（连 TCP 都没建立）。
     * 即问题在 Android WebView 的 Chromium 网络栈，不在网络与服务端。既然原生
     * 通路已被证明可用，就直接用它承载对局消息，彻底绕开 WebView 网络栈。
     *
     * @param host 对方 IP（或 127.0.0.1 自连）
     * @param port 对方端口
     */
    @JavascriptInterface
    public void wsConnect(final String host, final int port) {
        final String h = host == null ? "" : host.trim();
        final int p = (port <= 0 || port > 65535) ? 24816 : port;
        // 先停掉旧连接，避免重复回调
        closeWsClient();
        final NativeWsClient client = new NativeWsClient(new NativeWsClient.Listener() {
            @Override
            public void onOpen() {
                emit("{\"k\":\"wsopen\"}");
            }

            @Override
            public void onMessage(String text) {
                emit("{\"k\":\"wsmsg\",\"d\":\"" + jsEscape(text) + "\"}");
            }

            @Override
            public void onClose(String reason) {
                emit("{\"k\":\"wsclose\",\"reason\":\"" + jsEscape(reason) + "\"}");
            }

            @Override
            public void onLog(String line) {
                try {
                    diagLog("wsclient: " + line);
                } catch (Throwable ignored) {}
                emit("{\"k\":\"log\",\"line\":\"" + jsEscape(line) + "\"}");
            }
        });
        wsClient = client;
        client.connect(h, p);
    }

    /** v1.3.81：经原生通道发一条文本消息。返回是否发出。 */
    @JavascriptInterface
    public boolean wsSend(String text) {
        NativeWsClient c = wsClient;
        if (c == null) return false;
        return c.sendText(text);
    }

    /** v1.3.81：关闭原生通道连接。 */
    @JavascriptInterface
    public void wsClose() {
        closeWsClient();
    }

    /** v1.3.81：原生通道是否已连接。 */
    @JavascriptInterface
    public boolean wsConnected() {
        NativeWsClient c = wsClient;
        return c != null && c.isConnected();
    }

    private void closeWsClient() {
        NativeWsClient c = wsClient;
        wsClient = null;
        if (c != null) {
            try { c.close(); } catch (Throwable ignored) {}
        }
    }

    /**
     * v1.3.79：把一条局域网诊断记录**同时**写到 logcat 和 App 私有目录下的
     * lan-diag.log，并把结果回读给页面。
     *
     * 为什么要落盘：真机上连接失败时，页面弹窗能显示的日志条数有限、用户也
     * 未必愿意逐字敲；而 adb logcat 需要用户会连电脑。写文件后，用户在手机
     * 「文件管理 → Android/data/com.tailuge.billiards.cn/files/」里就能把整份
     * 现场直接发出来，一次定位。
     *
     * 路径：getExternalFilesDir(null)/lan-diag.log（无需存储权限，卸载即清）。
     *
     * @return 日志文件的绝对路径；写失败时返回错误描述（不会抛异常）
     */
    @JavascriptInterface
    public String diagLog(String line) {
        String text = line == null ? "" : line;
        String stamp = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)
            .format(new Date());
        String entry = "[" + stamp + "] " + text;
        android.util.Log.d("BilliardsLan", entry);
        File dir = null;
        try {
            dir = activity.getExternalFilesDir(null);
        } catch (Throwable ignored) {
            // 外部存储不可用时退回内部私有目录
        }
        if (dir == null) {
            try {
                dir = activity.getFilesDir();
            } catch (Throwable t) {
                return "error:no dir " + t.getMessage();
            }
        }
        if (dir == null) return "error:no dir";
        File f = new File(dir, LOG_FILE);
        try {
            if (f.exists() && f.length() > LOG_MAX_BYTES) {
                // 简单轮转：超限就重写（保留本行即可，避免文件无限增长）
                FileWriter reset = new FileWriter(f, false);
                reset.write(entry + "\n");
                reset.close();
            } else {
                FileWriter w = new FileWriter(f, true);
                w.write(entry + "\n");
                w.close();
            }
            return f.getAbsolutePath();
        } catch (Throwable t) {
            return "error:" + t.getClass().getSimpleName() + " " + t.getMessage();
        }
    }

    public LanBridge(MainActivity activity) {
        this.activity = activity;
        this.server = new LanServer(new LanServer.Listener() {
            @Override
            public void onStarted(int port, String ip, String iface,
                                  boolean hasWifiIface, String error) {
                // v1.3.69：started 事件一次带回 IP 诊断，page 端 onStatus("started")
                // 拿到就能直接写 sticky 弹窗 detail（不再依赖后续异步 JSBridge 调用，
                // v1.3.67/68 实测有时拿不到导致停在「等待对手加入…」）。
                emit("{"
                    + "\"k\":\"started\""
                    + ",\"port\":" + port
                    + ",\"ip\":\"" + jsEscape(ip) + "\""
                    + ",\"iface\":\"" + jsEscape(iface) + "\""
                    + ",\"hasWifiIface\":" + (hasWifiIface ? "true" : "false")
                    + ",\"error\":\"" + jsEscape(error) + "\""
                    + "}");
            }

            @Override
            public void onStartFailed(String reason) {
                emit("{\"k\":\"startfail\",\"reason\":\"" + jsEscape(reason) + "\"}");
            }

            @Override
            public void onClientCount(int count) {
                emit("{\"k\":\"clients\",\"n\":" + count + "}");
            }

            @Override
            public void onMessage(String message) {
                // 游戏消息已经通过 WebSocket 广播到主机页面（它自己也是客户端），
                // 这里不再重复推送，避免双通道乱序。
            }

            @Override
            public void onLog(String line) {
                // v1.3.79：服务端诊断日志双写 —— ① 落文件（主）② 推给页面
                // （辅）。以前只推页面，而页面 onStatus 没有 log 分支，等于全
                // 丢了；现在即使页面不处理，文件里也有完整现场。
                try {
                    diagLog("server: " + line);
                } catch (Throwable ignored) {
                    // 日志写失败绝不能影响服务端
                }
                emit("{\"k\":\"log\",\"line\":\"" + jsEscape(line) + "\"}");
            }
        });
    }

    /** 启动服务端。异步：结果经 __lanEvent 通知页面。 */
    @JavascriptInterface
    public void startServer(int preferredPort) {
        server.start(preferredPort > 0 ? preferredPort : 24816);
    }

    @JavascriptInterface
    public void stopServer() {
        server.stop();
    }

    @JavascriptInterface
    public boolean isRunning() {
        return server.isRunning();
    }

    @JavascriptInterface
    public int clientCount() {
        return server.clientCount();
    }

    /** 返回本机局域网 IPv4（优先 wlan），无则返回空串。兼容旧页面调用。 */
    @JavascriptInterface
    public String lanIp() {
        return parseJsonField(lanInfo(), "ip");
    }

    /**
     * v1.3.68：返回本机网络诊断 JSON，让建房弹窗能给出**准确**的原因提示，
     * 而不是笼统的「等待对手加入」。
     *
     * 返回字段：
     *   {"ip":"192.168.1.5","iface":"wlan0","hasWifiIface":true,
     *    "candidates":["192.168.1.5","10.0.0.3"],"error":""}
     *
     * ip 为空时页面按 hasWifiIface / error 分级提示：
     *   - hasWifiIface=false → 「没检测到 Wi-Fi，请连上 Wi-Fi 后重进房间」
     *   - hasWifiIface=true  → 「Wi-Fi 已连但没拿到 IPv4，请到 设置 → Wi-Fi →
     *                          当前网络 查看 IP 地址并口述给对手」
     *   - error 非空         → 直接展示异常原因（SocketException 等）
     *
     * 注：判断 Wi-Fi 不用 ConnectivityManager —— 本机 android-34.jar 缺
     * android.net.Network / NetworkCapabilities 类定义，且「wlan* 接口 up
     * 且有非 link-local IPv4」本身即等价于"连着 Wi-Fi 且拿到地址"。
     */
    @JavascriptInterface
    public String lanInfo() {
        String ip = "";
        String iface = "";
        String error = "";
        boolean hasWifiIface = false;
        List<String> candidates = new ArrayList<String>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            if (nis == null) {
                error = "getNetworkInterfaces() 返回 null";
            } else {
                // 接口优先级：wlan（Wi-Fi）> eth（USB 网卡）> 其它（排除黑名单）
                NetworkInterface best = null;
                String bestIp = "";
                int bestRank = -1;
                for (NetworkInterface ni : Collections.list(nis)) {
                    if (ni == null || !ni.isUp() || ni.isLoopback()) continue;
                    String name = ni.getName() == null ? "" : ni.getName();
                    if (isBlacklisted(name)) continue;
                    if (name.startsWith("wlan")) hasWifiIface = true;
                    int rank = rankOf(name);
                    if (rank < 0) continue;
                    for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                        if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
                        String s = a.getHostAddress();
                        // 169.254.x.x 是 link-local，对方连不上，跳过
                        if (s == null || s.isEmpty() || s.startsWith("169.254.")) continue;
                        candidates.add(s);
                        if (rank > bestRank) {
                            bestRank = rank;
                            best = ni;
                            bestIp = s;
                        }
                    }
                }
                if (best != null) {
                    ip = bestIp;
                    iface = best.getName() == null ? "" : best.getName();
                }
            }
        } catch (Throwable t) {
            // v1.3.68：不再静默吞异常——把原因带回页面显示，便于定位
            error = t.getClass().getSimpleName() + ": " + t.getMessage();
        }
        StringBuilder sb = new StringBuilder();
        sb.append("{\"ip\":\"").append(jsEscape(ip)).append('"');
        sb.append(",\"iface\":\"").append(jsEscape(iface)).append('"');
        sb.append(",\"hasWifiIface\":").append(hasWifiIface ? "true" : "false");
        sb.append(",\"candidates\":[");
        int limit = Math.min(candidates.size(), 6);
        for (int i = 0; i < limit; i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(jsEscape(candidates.get(i))).append('"');
        }
        sb.append("],\"error\":\"").append(jsEscape(error)).append("\"}");
        return sb.toString();
    }

    /**
     * v1.3.73：TCP 连通性探测（供客机端失败时给出**准确**原因）。
     *
     * 为什么需要它？页面建立 WebSocket 失败时只能拿到一个空的 error 事件，
     * 分不清到底是下面哪种情况：
     *   a) 对方 IP 填错 / 对方还没建房 / 两台手机不在同一网段 → 网络层就不通
     *   b) 网络层是通的，只是 App 内明文流量被系统策略拦了（见 Manifest 的
     *      usesCleartextTraffic 注释）
     *
     * v1.3.80 重要升级：旧实现只判断 `s.connect()` 是否成功就返回 ok ——
     * **这个探测太浅，会给出误导性的 ok**。TCP 三次握手由内核的 listen
     * backlog 完成，只要端口有人在听（哪怕那个程序根本不是我们的服务、
     * 哪怕它收到数据后立刻关闭），connect 都会成功。真机上已经出现
     * 「probePeer 报 ok，但 WebSocket 报 1006」的矛盾组合，正是被它误导。
     *
     * 现在改为**发一次真实的 RFC6455 握手请求并读回响应**，用对端的实际反应
     * 定论（见下方返回码）。这是唯一能区分「端口被别的程序占了」「对端是
     * 我们的服务但握手被吞了」「对端压根不是 WebSocket」的方法。
     *
     * 返回码（v1.3.80 扩展）：
     *   ok:101       对端回了 101 Switching Protocols → 服务端完全正常，
     *                问题在 WebView 侧（混合内容/策略），或客机代码路径
     *   ok:http:<行> 对端回的是普通 HTTP 响应（非 101）→ **端口被别的程序占用**
     *   ok:silent    连上了但对端读完握手请求后**一个字节都不回** →
     *                典型的「对端 accept 了但没有服务在处理」（服务端线程
     *                卡死 / 不在运行 / 被系统冻结）
     *   ok:garbage   对端回了非 HTTP 的字节 → 不是 WebSocket 服务
     *   refused      端口没人监听（主机没建房，或端口被顺延了）
     *   timeout      连不上（IP 错 / 不在同一网段）
     *
     * 同步阻塞：由 JSBridge 线程（JavaBridge）调用，不在主线程，最多阻塞
     * 约 PROBE_TIMEOUT_MS 毫秒，不会 ANR。
     */
    @JavascriptInterface
    public String probePeer(String host, int port) {
        String h = host == null ? "" : host.trim();
        if (h.isEmpty()) return "error:empty host";
        if (port <= 0 || port > 65535) port = 24816;
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(h, port), PROBE_TIMEOUT_MS);
            if (!s.isConnected()) return "error:not connected";
            // v1.3.80：发标准握手请求，用对端的实际反应定论
            s.setSoTimeout(PROBE_TIMEOUT_MS);
            java.io.OutputStream out = s.getOutputStream();
            // 一个固定的、符合 RFC6455 的握手请求（key 是合法的 16 字节 base64）
            String req = "GET / HTTP/1.1\r\n"
                + "Host: " + h + ":" + port + "\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + WS_PROBE_KEY + "\r\n"
                + "Sec-WebSocket-Version: 13\r\n"
                + "\r\n";
            out.write(req.getBytes("UTF-8"));
            out.flush();
            // 读响应（只读第一段，足够判断）
            byte[] buf = new byte[256];
            int n;
            try {
                n = s.getInputStream().read(buf);
            } catch (java.net.SocketTimeoutException te) {
                // 连上了但从不应答 —— 这正是「端口有人但不干活」的特征
                return "ok:silent";
            }
            if (n <= 0) return "ok:silent";
            String resp = new String(buf, 0, n, "UTF-8");
            if (resp.startsWith("HTTP/1.1 101") || resp.startsWith("HTTP/1.0 101")) {
                return "ok:101";
            }
            if (resp.startsWith("HTTP/")) {
                int nl = resp.indexOf("\r\n");
                String firstLine = nl > 0 ? resp.substring(0, nl) : resp;
                return "ok:http:" + firstLine;
            }
            return "ok:garbage";
        } catch (java.net.ConnectException e) {
            // Connection refused：主机在线但端口没人监听
            return "refused:" + (e.getMessage() == null ? "" : e.getMessage());
        } catch (java.net.SocketTimeoutException e) {
            return "timeout";
        } catch (Throwable t) {
            return "error:" + t.getClass().getSimpleName()
                + (t.getMessage() == null ? "" : " " + t.getMessage());
        } finally {
            try { s.close(); } catch (Throwable ignored) {}
        }
    }

    /**
     * 接口优先级：wlan=3（Wi-Fi，优先）> eth=2（USB 网卡）> 其它=1。
     * 返回 -1 表示该接口应被排除（黑名单）。
     */
    private static int rankOf(String name) {
        if (name.startsWith("wlan")) return 3;
        if (name.startsWith("eth")) return 2;
        return 1;
    }

    /**
     * 排除不可能作为局域网地址的接口：
     *   ap0     本机开的热点（192.168.43.1），对方连不上
     *   p2p0    Wi-Fi Direct
     *   rndis / bt-pan / usb  共享网络
     *   dummy / lo / sit / gre / ip_vti  虚拟或隧道接口
     */
    private static boolean isBlacklisted(String name) {
        return name.startsWith("ap0")
                || name.startsWith("p2p")
                || name.startsWith("rndis")
                || name.startsWith("bt-pan")
                || name.startsWith("dummy")
                || name.startsWith("sit")
                || name.startsWith("gre")
                || name.startsWith("ip6tnl");
    }

    /** 从简易 JSON 串里取一个字符串字段（避免依赖 org.json） */
    private static String parseJsonField(String json, String key) {
        if (json == null) return "";
        String mark = "\"" + key + "\":\"";
        int i = json.indexOf(mark);
        if (i < 0) return "";
        int start = i + mark.length();
        int end = json.indexOf('"', start);
        if (end < 0) return "";
        return json.substring(start, end);
    }

    private void emit(final String json) {
        activity.runOnUi(new Runnable() {
            @Override
            public void run() {
                activity.softEvaluate(
                    "(function(){try{window.__lanEvent&&window.__lanEvent(" + json + ")}catch(e){}})()"
                );
            }
        });
    }

    /**
     * v1.3.72：Java 主动把本机网络诊断推给页面（兜底双通道）。
     *
     * 主通道是页面经 window.__lan.lanInfo() 主动拉取（见 v1.3.68+），但部分 ROM
     * 上 WebView 注入 JSBridge 的时机偏晚，page 同步调一次可能拿到空；再加上
     * v1.3.71 曾因 @JavascriptInterface 注解 retention 写错（CLASS 而非 RUNTIME）
     * 导致 bridge 整体不暴露。为防止这类「拉取链路」不可靠，这里由 Java 在
     * onPageFinished / 建房后**主动** evaluateJavascript 调 window.__lanPush(json)，
     * 把 lanInfo 推到页面缓存，页面侧即使 bridge 暂时不可用也能拿到 IP。
     *
     * 注意：本方法本身不需 @JavascriptInterface，它由 MainActivity 经 evaluateJavascript
     * 直接触发，不经 bridge 反射；它也不依赖 bridge 是否暴露，是独立兜底。
     */
    public void pushLanInfo() {
        final String json = lanInfo();
        activity.runOnUi(new Runnable() {
            @Override
            public void run() {
                activity.softEvaluate(
                    "(function(){try{window.__lanPush&&window.__lanPush("
                        + json
                        + ")}catch(e){}})()"
                );
            }
        });
    }

    /** JSON 字符串值转义：反斜杠、双引号与控制字符 */
    private static String jsEscape(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (ch < 0x20) {
                        sb.append(String.format("\\u%04x", (int) ch));
                    } else {
                        sb.append(ch);
                    }
            }
        }
        return sb.toString();
    }
}
