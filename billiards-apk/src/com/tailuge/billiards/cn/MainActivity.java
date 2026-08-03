package com.tailuge.billiards.cn;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private WebView webView;

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
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // 纯本地离线运行，不访问网络
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl("file:///android_asset/dist/menu.html");
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
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersive();
    }
}
