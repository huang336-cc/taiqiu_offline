package com.tailuge.billiards.cn;

import android.app.Activity;
import android.content.res.AssetManager;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;

public class MainActivity extends Activity {

    private WebView webView;

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

        // 这些 setter 在部分精简版 android.jar 里没有声明，用反射调用，
        // 调不到就跳过（不影响虚拟域名方案本身）。
        softSet(s, "setMediaPlaybackRequiresUserGesture", false);
        softSet(s, "setAllowFileAccessFromFileURLs", true);
        softSet(s, "setAllowUniversalAccessFromFileURLs", true);

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
                // 站内跳转（menu.html -> index.html）放行，站外一律不跳
                return url != null && !url.startsWith(VHOST);
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

    /** 反射调用可能不存在的 WebSettings setter，调不到就静默跳过 */
    private static void softSet(WebSettings s, String method, boolean value) {
        try {
            s.getClass().getMethod(method, boolean.class).invoke(s, Boolean.valueOf(value));
        } catch (Throwable ignored) {
            // 该 API 不存在，忽略
        }
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
        // 游戏内页面（index.html）由 JS 自己弹"继续游戏 / 返回主菜单"二次确认；
        // 不再走 goBack，避免直接丢掉本局进度。
        String url = webView.getUrl();
        if (url != null && url.contains("/index.html")) {
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
    private void softEvaluate(String script) {
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
}
