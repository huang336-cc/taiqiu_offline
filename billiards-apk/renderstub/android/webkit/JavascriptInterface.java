package android.webkit;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 编译期 stub：本机 android-34.jar（老版 SDK，仅 43 个 webkit 类）没有
 * android/webkit/JavascriptInterface.class，javac 无法解析该符号，因此这里
 * 提供一个等价定义参与编译。它不传给 d8、不进最终 dex，运行时由设备框架的
 * 真实注解接管，零冲突。
 *
 * 关键：@Retention 必须是 RUNTIME。
 * WebView.addJavascriptInterface() 在 ART 侧是通过反射
 * method.getAnnotation(JavascriptInterface.class) 逐个筛方法的；
 * RuntimeInvisible（CLASS retention）注解不会写进 dex 的
 * annotation_directory_item，运行时反射一律读不到，结果是注入对象在 JS 里
 * 一个方法都不暴露（window.__lan.lanInfo === undefined）。
 * v1.3.71 及之前「建房弹窗显示 App 版本过低」的真因就在这里。
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD})
public @interface JavascriptInterface {
}
