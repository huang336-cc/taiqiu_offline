package com.tailuge.billiards.cn;

import android.webkit.JavascriptInterface;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

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

    private final MainActivity activity;
    private final LanServer server;

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
