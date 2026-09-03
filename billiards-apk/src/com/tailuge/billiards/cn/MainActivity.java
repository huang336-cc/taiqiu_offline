package com.tailuge.billiards.cn;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;

public class MainActivity extends Activity {

    private WebView webView;
    /** v1.3.65：局域网对战 JSBridge（页面侧 window.__lan） */
    private LanBridge lanBridge;

    /**
     * 虚拟域名。
     *
     * 为什么不直接用 file:///android_asset/ ？
     *   three.js 的 FileLoader 走 fetch() 加载 gltf / bin / 纹理 / 音效，
     *   而 Blink 内核在 file:// 页面里直接拒绝 fetch 任何 file:// 资源
     *   （"URL scheme file is not supported"），且无法通过任何 WebSettings 开关放开。
     *   结果就是桌子模型和纹理全部加载失败，3D 场景为空 —— 表现为进游戏后一片黑。
     *
     * 解法：把页面挂在一个不存在的 https 域名下，再用 shouldInterceptRequest
     *   把请求转回 APK 内的 assets。这样页面 origin 是 https，fetch 完全正常，
     *   同时所有流量都被本地拦截，不产生任何真实网络请求，依旧是纯离线。
     */
    private static final String VHOST = "https://billiards.local/";
    private static final String ASSET_ROOT = "dist";

    // 对应 android.view.View 的系统 UI 标志（当前 android.jar 常量表不全，用数值兼容）
    private static final int SYSTEM_UI_FLAG_IMMERSIVE_STICKY = 0x00001000;
    private static final int SYSTEM_UI_FLAG_FULLSCREEN = 0x00000004;
    private static final int SYSTEM_UI_FLAG_HIDE_NAVIGATION = 0x00000002;
    private static final int SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN = 0x00000400;
    private static final int SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION = 0x00000200;
    private static final int SYSTEM_UI_FLAG_LAYOUT_STABLE = 0x00000100;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        applyImmersive();

        try {
        webView = new WebView(this);
        // 强制硬件加速，否则部分设备上 WebGL 上下文无法创建
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);      // 已改走虚拟域名，不再需要 file 访问
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // v1.3.7：让 WebView 以设备物理宽度布局（铺满宽度），并禁用「总览缩放」，
        // 配合页面 JS 实测 innerHeight 写入 --vh，使主菜单精确铺满整屏。
        softSet(s, "setUseWideViewPort", true);
        softSet(s, "setLoadWithOverviewMode", false);

        // 这些 setter 在部分精简版 android.jar 里没有声明，用反射调用，
        // 调不到就跳过（不影响虚拟域名方案本身）。
        softSet(s, "setMediaPlaybackRequiresUserGesture", false);
        softSet(s, "setAllowFileAccessFromFileURLs", true);
        softSet(s, "setAllowUniversalAccessFromFileURLs", true);

        // v1.3.65：局域网对战需要 https 页面连 ws://（主机侧 ws://127.0.0.1，
        // 客机侧 ws://<对方IP>）。默认 mixed content 策略会拦截，这里放行。
        // MIXED_CONTENT_ALWAYS_ALLOW = 0。
        softSetInt(s, "setMixedContentMode", 0);

        // v1.3.65：局域网对战 JSBridge —— 页面经 window.__lan 控制进程内
        // WebSocket 服务端（见 LanBridge / LanServer）。
        lanBridge = new LanBridge(this);
        webView.addJavascriptInterface(lanBridge, "__lan");

        webView.setWebViewClient(new WebViewClient() {

            /**
             * 所有请求都在本地解决：命中虚拟域名的转 assets，其余一律拒绝。
             * 这样即使页面里残留了外链，也不会真的发出网络请求。
             */
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                if (url == null) {
                    return null;
                }
                if (url.startsWith(VHOST)) {
                    return serveAsset(url.substring(VHOST.length()));
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    // 离线应用，屏蔽一切外部请求
                    return new WebResourceResponse("text/plain", "utf-8", null);
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) {
                    return false;
                }
                // 站内跳转（menu.html -> index.html）放行
                if (url.startsWith(VHOST)) {
                    return false;
                }
                // 外链（如"关于"页的 GitHub 项目地址）交给系统浏览器打开。
                // 应用自身仍然不发起任何网络请求，也不申请 INTERNET 权限，
                // 离线属性保持不变。
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    openExternally(url);
                }
                return true;
            }

            /**
             * 渲染进程崩溃（通常是 GPU / WebGL 在该机型上不兼容）时，
             * 默认行为是系统直接强杀进程（表现就是"点图标即闪退"）。
             * 这里接管它：返回 true 阻止强杀，并弹出可读的错误信息，
             * 让用户/开发者能看到真实原因，而不是无声闪退。
             */
            // 注意：本机 android-34.jar 的 WebViewClient stub 未声明 onRenderProcessGone，
            // 故此处不加 @Override（否则 javac 报“未覆写”）。方法描述符与运行时框架一致，
            // ART 仍会正确把它当作对 WebViewClient.onRenderProcessGone 的覆写来分派。
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                String reason = (detail != null && detail.didCrash())
                    ? "渲染进程已崩溃（多为 GPU / WebGL 在该机型上不兼容）"
                    : "渲染进程被系统回收（可能内存不足）";
                showFatal(reason + "\n\n建议：\n1. 把『Android System WebView』和『Chrome』都更新到最新\n2. 关闭该游戏的省电/性能限制与安全防护拦截\n3. 重启手机后重试");
                return true;
            }

            /**
             * v1.3.7：页面加载完成后，触发一次 JS 尺寸适配（实测 innerHeight 写入 --vh），
             * 确保 WebView 完成自身布局后再把主菜单铺满整屏。
             */
            @Override
            public void onPageFinished(WebView view, String url) {
                softEvaluate(
                    "(function(){try{window.__fitViewport&&window.__fitViewport()}catch(e){}})()"
                );
                // v1.3.72：页面加载完成后，主动把本机网络诊断推给页面（兜底双通道）。
                // 主通道是页面经 window.__lan.lanInfo() 拉取；这里由 Java 主动 evaluateJavascript
                // 调 window.__lanPush，即使 JSBridge 在某些 ROM 上注入偏晚 / 偶发不暴露，
                // 页面也能拿到 IP（见 LanBridge.pushLanInfo）。延迟 600ms 等页面 JS 注册好
                // window.__lanPush 再推，避免推送过早被吞。
                if (lanBridge != null) {
                    view.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            try { lanBridge.pushLanInfo(); } catch (Throwable ignored) {}
                        }
                    }, 600);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // 把 JS console 转发到 logcat，便于排查渲染问题
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage cm) {
                android.util.Log.d("BilliardsWeb",
                    "[" + cm.messageLevel() + "] " + cm.sourceId()
                    + ":" + cm.lineNumber() + " " + cm.message());
                return true;
            }
        });

        webView.loadUrl(VHOST + "menu.html");
        } catch (Throwable t) {
            showFatal("启动失败（" + t.getClass().getSimpleName() + "）：\n"
                + (t.getMessage() == null ? "无错误信息" : t.getMessage()));
        }
    }

    /** 用系统默认浏览器打开外部链接；没有可用浏览器时静默忽略 */
    private void openExternally(String url) {
        try {
            android.content.Intent i = new android.content.Intent(
                android.content.Intent.ACTION_VIEW,
                android.net.Uri.parse(url)
            );
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Throwable t) {
            android.util.Log.w("BilliardsLink", "无法打开外链: " + url);
        }
    }

    /** 把虚拟域名下的路径映射到 APK 内 assets/dist 下的文件 */
    private WebResourceResponse serveAsset(String rawPath) {
        String path = rawPath;

        // 去掉 query / fragment：index.html?ruletype=nineball 这类要能命中
        int cut = path.indexOf('?');
        if (cut >= 0) {
            path = path.substring(0, cut);
        }
        cut = path.indexOf('#');
        if (cut >= 0) {
            path = path.substring(0, cut);
        }
        if (path.length() == 0) {
            path = "menu.html";
        }
        // 防目录穿越
        if (path.contains("..")) {
            return new WebResourceResponse("text/plain", "utf-8", null);
        }

        try {
            InputStream in = getAssets().open(ASSET_ROOT + "/" + path);
            WebResourceResponse resp = new WebResourceResponse(mimeOf(path), encodingOf(path), in);
            return resp;
        } catch (Exception e) {
            android.util.Log.w("BilliardsAsset", "缺失资源: " + path);
            return new WebResourceResponse("text/plain", "utf-8", null);
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".gltf")) return "model/gltf+json";
        if (p.endsWith(".bin")) return "application/octet-stream";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    /** 二进制资源必须返回 null 编码，否则 WebView 会按文本处理导致数据损坏 */
    private static String encodingOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm") || p.endsWith(".js")
            || p.endsWith(".mjs") || p.endsWith(".css") || p.endsWith(".json")
            || p.endsWith(".gltf") || p.endsWith(".svg")) {
            return "utf-8";
        }
        return null;
    }

    /** 反射调用可能不存在的 WebSettings setter（boolean 版），调不到就静默跳过 */
    private static void softSet(WebSettings s, String method, boolean value) {
        try {
            s.getClass().getMethod(method, boolean.class).invoke(s, Boolean.valueOf(value));
        } catch (Throwable ignored) {
            // 该 API 不存在，忽略
        }
    }

    /** 反射调用可能不存在的 WebSettings setter（int 版），调不到就静默跳过 */
    private static void softSetInt(WebSettings s, String method, int value) {
        try {
            s.getClass().getMethod(method, int.class).invoke(s, Integer.valueOf(value));
        } catch (Throwable ignored) {
            // 该 API 不存在，忽略
        }
    }

    /** LanBridge 回调线程 → UI 线程执行 */
    public void runOnUi(Runnable r) {
        runOnUiThread(r);
    }

    private void applyImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(
            SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | SYSTEM_UI_FLAG_FULLSCREEN
                | SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // 游戏内页面（play.html）由 JS 自己弹"继续游戏 / 返回主菜单"二次确认；
        // 不再走 goBack，避免直接丢掉本局进度。
        String url = webView.getUrl();
        if (url != null && url.contains("/play.html")) {
            softEvaluate(
                "(function(){try{return !!window.__onAndroidBack&&(window.__onAndroidBack(),true)}catch(e){return false}})()"
            );
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    /** 反射调用 WebView.evaluateJavascript(String, ValueCallback)，调不到就忽略 */
    public void softEvaluate(String script) {
        if (webView == null) {
            return;
        }
        try {
            java.lang.reflect.Method m = webView.getClass().getMethod(
                "evaluateJavascript", String.class, android.webkit.ValueCallback.class
            );
            m.invoke(webView, script, null);
        } catch (Throwable t) {
            // 该 API 不存在或调用失败，回退到 loadUrl 触发 JS 执行（不推荐，仅保底）
            try { webView.loadUrl("javascript:void(" + script + ")"); } catch (Throwable ignored) {}
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersive();
    }

    @Override
    protected void onDestroy() {
        // v1.3.65：页面/Activity 销毁时停掉局域网服务端，释放端口与线程
        if (lanBridge != null) {
            try { lanBridge.stopServer(); } catch (Throwable ignored) {}
            lanBridge = null;
        }
        super.onDestroy();
    }

    /**
     * v1.1.10：折叠屏折叠/展开时系统触发 Configuration 变化。
     * AndroidManifest 已声明 configChanges，Activity 不重建，WebView 状态保留。
     * 这里在配置变化时向 WebView 注入一次 resize 事件，让 JS 层主动重建渲染器
     * 并重新渲染一帧，避免折叠后黑屏。
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webView == null) {
            return;
        }
        // 延迟 100ms 注入，等 WebView 完成自身布局尺寸更新
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                softEvaluate(
                    "(function(){try{window.dispatchEvent(new Event('resize'))}catch(e){}})()"
                );
            }
                }, 100);
        }

        /** 把致命错误显示在屏幕上（而非静默闪退），方便用户/开发者看到真实原因 */
        private void showFatal(String msg) {
            try {
                new AlertDialog.Builder(this)
                    .setTitle("奥特曼的台球")
                    .setMessage(msg)
                    .setCancelable(false)
                    .setPositiveButton("确定",
                        new android.content.DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(android.content.DialogInterface d, int w) {
                                d.dismiss();
                            }
                        })
                    .show();
            } catch (Throwable ignored) {
                android.util.Log.e("BilliardsFatal", msg);
            }
        }
    }
