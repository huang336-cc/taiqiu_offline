# 场景离线渲染管线

沙箱里**没有 GPU**，但可以用 **Xvfb + ANGLE/SwiftShader** 让 Chrome 跑起
WebGL2 软渲染，从而把场景真的画成 PNG。

这解决了本项目此前最致命的问题：**改完看不见画面，只能靠顶点数/贴图明度
这类与观感无关的指标猜**，每轮都得上真机才发现效果不对。

## 原理

Chrome 的 SwiftShader 走 **ANGLE Vulkan 后端 + XCB 显示**。没有 X server 时
`xcb_connect()` 直接失败 → `eglInitialize SwANGLE failed with EGL_NOT_INITIALIZED`
→ WebGL context 拿不到。所以**必须先起 Xvfb**：

```bash
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
```

实测可用的启动参数组合（`--use-angle=swiftshader` 是核心）：

```
--headless=new --no-sandbox --hide-scrollbars
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

拿到 context 后：`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`。

## 用法

```bash
# 1. 起虚拟显示（只需一次）
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &

# 2. 渲染
DISPLAY=:99 node tools/render/render.js --scene room --view aim
DISPLAY=:99 node tools/render/render.js --scene beach --view free --w 720 --h 1280
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--scene` | `room` | 场景名（room / beach / office / cybercafe / snow / football / basketball / ufc） |
| `--view` | `aim` | 机位：`aim` 贴地平视（球员视角）／`top` 俯视／`free` 斜俯视全景 |
| `--w` `--h` | 540×960 | 视口尺寸（竖屏手机比例） |
| `--settle` | 2500 | 首帧后等待毫秒数（环境构建需要时间） |
| `--out` | `/root/.codebuddy/artifact/render/shots` | 输出目录 |
| `--tag` | — | 文件名后缀 |

输出同时打印渲染诊断：**draw calls / 三角面数 / 场景子节点数 / 相机位置**。

## 依赖

- `puppeteer-core`（devDependency，**不进 APK**）
- `Xvfb`（系统包，已预装）
- Chrome（`/usr/bin/google-chrome`）

## ⚠️ 血泪教训：`?env=` 参数不存在

**v1.3.85 之前，本工具是坏的，而且坏得很隐蔽。**

早期版本拼的 URL 是：

```
file://…/play.html?debug=1&env=<scene>&bot=Professional
```

但**页面从不读 `env`** —— `src/index.ts` 只读 `debug`，场景由
`Settings.get().scene` 决定（默认 `"snow"`）。于是：

- `--scene room/office/cybercafe/beach/…` 拍出来的**全是雪山**；
- 更坏的是它不报错，只是安静地给出错误结果；
- 用这些图做「8 个场景对照诊断」，得到的结论自然全是错的。

**最有价值的一条线索当时被误读了**：8 个场景在 `aim` 机位下的三角面数
**完全相同**（都是 55226）。当时判为「环境不入画」，实际原因是**场景压根
没换**。

### 现在的做法

1. 运行时切场景：`view.applyScene(scene)`（由 `render.js` 在页面就绪后调用）。
2. **强制自检**：切完回读 `sceneEnv.name`，为 null 直接 `exit(3)`。
3. **输出指纹**：每次渲染都往 `_meta.jsonl` 追加
   `envName / envTris / triangles / 光源列表 / toneMapping / shadowMap`，
   多场景横向比对时任何「本该不同却相同」的字段都会立刻暴露。

实测修正后的 `envTris`：`room=51956 / office=50324 / cybercafe=51128`
—— 各不相同，量具可信。

> **通用教训**：验证工具本身也需要验证。一个静默返回错误结果的量具，
> 比没有量具更危险 —— 它会让你在错误的前提上建立一整套自信的结论。

## 注意

- 入口是 `dist/play.html`，不是 `index.html`。
- 应用在 `?debug=1` 时把容器挂在 `globalThis.__bc` —— 这是渲染脚本的接口。
- `view.update()` **每帧**都会调 `camera.update()` 重置机位，所以自定义机位必须
  **劫持 `camera.update`**，只设一次位置会被下一帧覆盖（踩过这个坑）。
- `aim` 机位可见窗口极小（贴地平视，z 范围仅约 0.3m），**场景环境基本不入画**。
  判断「场景好不好看」必须用 `free` 机位。
- 软渲染比真机 GPU 慢很多，`--settle` 给足；复杂场景重建环境可能需 3~5s。
- 截图有随机性（球的位置/朝向每次不同），**对比图不要做逐像素 diff**；
  要判断一致性请看指定的静态区域（如墙面），或比较像素统计量。
