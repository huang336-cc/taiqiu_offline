# v1.3.85 渲染管线诊断报告

> 起因：用户反馈「画面不够好看，你调了几十版，甚至比 4399 小游戏还差」。
> 本文记录从「以为问题在调参」到「定位到真实病灶」的完整过程，
> 包括三个被实测否定的假设 —— 这些否定比结论更有价值。

---

## 一、先说最重要的发现：量具是坏的

在动手改任何代码之前，排查发现**离线渲染工具本身在骗人**。

`tools/render/render.js` 拼的 URL 是 `play.html?debug=1&env=<scene>`，
但**页面从不读 `env`** —— `src/index.ts` 只读 `debug`，场景由
`Settings.get().scene` 决定，默认 `"snow"`。

后果：此前拍的 14 张「8 场景基线图」**全部是雪山**。而工具不报错，
只是安静地返回错误结果。

**当时有一条极有价值的线索被误读了**：8 个场景在 `aim` 机位下三角面数
**完全相同（55226）**。当时判为「环境不入画」并放过了 —— 实际原因是
场景压根没切换。这个误判直接导致后续所有诊断都建立在错误前提上。

> 这条教训适用于任何调试工作：**一个静默返回错误结果的量具，比没有量具
> 更危险**。它会让你在错误的前提上建立一整套自信的结论。

修复后的对照（`envTris`，各场景环境子树三角面数）：

| 场景 | envTris |
|---|---|
| room | 51956 |
| office | 50324 |
| cybercafe | 51128 |

各不相同 → 量具可信。同时加了强制自检（回读 `sceneEnv.name`，为空则退出）
与 `_meta.jsonl` 指纹留档，杜绝同类问题复发。

---

## 二、真实病灶

### 2.1 环境材质完全不参与光照

`sceneenvironment.ts:1580`：

```ts
function envMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
}
```

`MeshBasicMaterial` **不参与任何光照计算** —— 它把顶点色原样喷到屏幕。
顶点色是 CPU 侧烘焙好的「最终显示色」，所以墙面/地板/家具都是一整块死色。

**关键澄清：项目并非没有渲染管线。** 渲染器配置齐全：

- `shadowMap.enabled = true` + `PCFShadowMap`
- `outputColorSpace = SRGBColorSpace`
- `view.ts` 里有完整的 AmbientLight + DirectionalLight（带 1024² shadow map）+ HemisphereLight
- 还有表驱动的 `View.SCENE_TONE` 色调映射

**问题在于：7 个场景全被 `ENV_SPECS.outdoor = false` 关掉了光照**，
而环境材质又是 basic 的，于是「灯亮着，但墙不响应」。

### 2.2 烘焙光照模型太简陋

`bakeIndoor` 的光照项只有：

```
out = albedo × (AMB + Σ SUN·(N·L)^GAMMA·att + bounce·max(0,−nz))
```

两个致命限制：

1. **只与法线方向有关** —— 同一个盒面的所有顶点法线完全相同 → 算出同一个
   色值 → **整面一个颜色**。这就是家具像「色块剪纸」的根因。
2. **无环境遮蔽、无接触阴影** —— 物体与地面/墙面的交界处没有变暗，
   所以物体看起来「浮」着。

---

## 三、三个被实测否定的假设

记录下来，因为它们解释了「为什么调了几十版都没效果」。

### ❌ 假设 1：换 PBR 材质就会有立体感

改完（`MeshBasicMaterial` → `MeshStandardMaterial` + 真实光源）后，
画面与改造前**几乎逐像素一致**。

**原因**：为了让亮度「零变形」，我把照度设计成 `ambient + Σ dir·N·L = π`，
经 PBR 的 `BRDF_Lambert`（含 1/π）后**结果恰好等于原来的顶点色**。
等于换了个更贵的灯泡，去照一张已经画好的画。

> 换材质只是打通了管线，它本身不产生观感提升。

### ❌ 假设 2：给几何加细分就会有面内渐变

给 `boxGeo` 按尺寸加 1~4 段细分，期望「顶点更多 → 面内出现光照渐变」。
**实测逐像素无差异。**

**原因**：`N·L` 只看法线**方向**，同面法线相同 → 细分后每个顶点算出的
光照值依旧相同。**瓶颈不是顶点数，是光照模型。**

### ❌ 假设 3：收窄光池就能出层次

把 `lamps[].far` 从 10.5（房间对角线才 ~14m）收到 3.2，期望出现局部光池。
**结果更平**：对比度标准差从 35.6 降到 21.1，且整体暗 35%。

**原因**：`far` 收窄后大量区域落入 `floor` 底线值，变成均匀暗面。

---

## 四、真正有效的改动：环境遮蔽（AO）

### 4.1 为什么 AO 有效

AO 取决于**顶点位置**（离墙多近、离地多高），**与法线无关**。
同一面的不同顶点位置不同 → 遮蔽率不同 → **面内自然出现明暗渐变**。

这正是假设 1/2 缺失的那一环：它们都试图在「法线」维度上做文章，
而 AO 换到了「位置」维度。

### 4.2 实现选择：解析式而非光线投射

先写了一个基于空间网格 + Möller–Trumbore 射线求交的采样器（约 170 行），
但要求「先收集全场景几何、再统一烘焙」，与现有**流式构建顺序**冲突，
需要把 `Props` 改成延迟烘焙，反而引入脆弱的两遍耦合 —— 写到一半就发现
自己在反复调整实现细节，这是设计不对的信号。

改为**解析式**：房间是规整长方体，直接按「顶点与房间六面体的贴近度」
算遮蔽：

```ts
const wallO  = 1 - smoothstep(0, reach, min(hx-|px|, hy-|py|))  // 贴墙
const floorO = 1 - smoothstep(0, reach*0.7, pz - floorZ)        // 贴地
const ceilO  = smoothstep(1.6, 2.85, pz) * ceilBias             // 近顶棚
```

三个来源相加后 clamp。**零顺序依赖、零额外内存、约 40 行。**

朝上的面（地板/桌面）通过 `expose = 1 - max(0, nz)` 豁免 —— 它们上方开阔，
强行压暗会让地面出现脏斑。

### 4.3 参数

```ts
const INDOOR_AO = { hx: 6, hy: 4, floorZ: -0.207, reach: 1.0, strength: 0.55, ceilBias: 0.15 }
```

### 4.4 AO 的亮度补偿

AO 会压暗间接光（平均约 8%），若照度仍定在 π，画面会整体暗一档
（实测均亮 83.5 → 72.6）。所以 `view.ts` 把环境光提到 `1.08π` 补偿，
方向光同步放大到保持 9:1 比例。

**设计意图**：画面平均亮度回到改造前水平，而**明暗层次由 AO 提供**。

---

## 五、实测结果

| 场景 | 指标 | 改造前 | PBR 零变形 | PBR + AO |
|---|---|---|---|---|
| room | 均亮 / 对比度 | 75.4 / 33.5 | 83.5 / 35.6 | 80.4 / **37.6** |
| office | 均亮 / 对比度 | 121.8 / 66.7 | 129.7 / 66.7 | 137.8 / **71.6** |
| cybercafe | 均亮 / 对比度 | 33.8 / 24.6 | 43.9 / 26.5 | 45.6 / **27.3** |

**三个场景的对比度全部提升**，亮度保持在合理区间。

视觉上可辨识的改善：
- 墙根变暗，墙面出现纵向渐变
- 沙发出现侧面暗部与接触阴影，不再「贴墙漂浮」
- 地毯与地板交界更自然
- cybercafe 桌面有了明暗层次（此前几乎是纯黑色块）

---

## 六、回归验证

| 脚本 | 项数 | 结果 |
|---|---|---|
| `verify_indoor.js` | 38 | ✅ 全绿 |
| `verify84j.js` | 23 | ✅ 全绿 |
| `verify_pbr.js`（新增） | 27 | ✅ 全绿 |
| `check_beach_pos.js` | — | ✅ 全绿 |

### 既有脚本为何没能发现这个问题

三套既有回归检查的维度是「贴图 stats / cache / 几何健康 / map 挂载计数」，
**没有一条涉及材质类型**。这既是好消息（改造不破坏现状），
也说明它们**无法验证本次改造**，所以新增了 `verify_pbr.js`。

### 新增断言要点

- **R1**：室内材质为 `MeshStandardMaterial` 且 `vertexColors === true`
- **R2**：法线全部有限且长度≈1（**最重要** —— NaN/零长度会让 PBR 崩）
- **R3**：**守门断言** —— beach/football/basketball/ufc/snow 仍为 `MeshBasicMaterial`
- **R4**：照度因子含 AO 补偿后在设计区间内
- **R7**：材质构成明细（人工核对用）

### 顺带发现的既有隐患

范围外场景存在**零长度法线**（basic 材质下当前无害，升级 PBR 前必须修）：

| 场景 | badNrm | 来源 |
|---|---|---|
| football | 384 / 12036 | `FieldProps`（RingGeometry 闭合圆心） |
| basketball | 378 / 14332 | 同上 |
| ufc | 384 / 14237 | 同上 |
| snow | 24 / 26369 | 球体极点，每几何 1 个 |

`bakeVertices` 的 NaN 兜底只处理 `NaN`，零长度法线不算 NaN 所以漏过。
已在 `bakeIndoor` 补上（室内路径，照抄现有兜底的写法）。

---

## 七、遗留问题（未解决）

### 7.1 `aim` 视角下场景基本不入画

实战视角（贴地平视）的可见窗口 z 范围仅约 **0.3m**，画面**几乎全是球桌**，
环境只在边缘露一条。这意味着：**即使室内环境做得再好，玩家在瞄准时也看不到。**

这是一个独立于渲染管线的问题（属于**视角构图**），但它的影响可能比渲染更大
—— 因为它是玩家真正看到的画面。

### 7.2 顶点色的信息量上限

本次改造提升了「光照如何作用于顶点色」，但顶点色本身仍是「albedo × 简化光照」
的烘焙结果，没有法线贴图、没有真实材质的粗糙度变化。要再上一个台阶，
需要引入贴图法线/粗糙度，属于下一步的工作。

### 7.3 其余 5 个场景仍是 basic 材质

本次只改室内三件套。beach / football / basketball / ufc / snow 仍是
`MeshBasicMaterial`（守门断言保证未被误伤）。升级前需先修 7.3 章节列出的
零长度法线隐患。

---

## 八、关键代码位置

| 文件 | 内容 |
|---|---|
| `src/view/sceneenvironment.ts` `envMaterial()` | 材质分流（可选 `pbr` 参数，不传参保持 basic） |
| `src/view/sceneenvironment.ts` `AoCtx` / `aoFactor()` | 解析式 AO |
| `src/view/sceneenvironment.ts` `bakeIndoor()` | 烘焙光照 + NaN 法线兜底 + AO 接入 |
| `src/view/sceneenvironment.ts` `ENV_SPECS` | 室内三场景加 `amb: {intensity: 0}` 消除绿偏 |
| `src/view/view.ts` `INDOOR_AMB_I` / `INDOOR_DIR_I` | 室内光源强度（含推导注释） |
| `src/view/view.ts` `applyScene()` | 表驱动开关 indoorAmb / indoorDir |
| `tools/render/render.js` | 运行时切场景 + 强制自检 + `_meta.jsonl` 指纹 |
| `/root/.codebuddy/artifact/verify_pbr.js` | R1~R7 断言 |

---

# 第九轮：瞄准视角「白色尖楔」追凶

## 9.1 症状

修好机位（`--view aim` 终于拍到真实球员视角）后，画面里母球旁边出现
**4 片不规则白色楔形**，围绕母球呈十字分布；此外母球是「弹珠」——
纯白球面上有红斑。

我最初的判断是「瞄准辅助线（AimLine）渲染错了」。**这个判断是错的**，
而且错得很典型。

## 9.2 定位过程（值得复用的手法）

### 手法一：量具先行 —— 直接读顶点缓冲，不要看截图猜

新建 `tools/render/probe-aimline.js`，进入页面后从 `__bc` 句柄读取
`AimLine.group` 下两个 Ribbon 的 `drawRange` / 顶点包围盒 / alpha 分布。

结果：

```
solid: quads=4, tris=8, bbox.x=[-0.724,-0.717] (宽 7mm), bbox.y=[0,0.6877]
```

**几何完全正确**：7mm 宽、687mm 长的细条，正是瞄准线该有的样子。
所以白楔**不是瞄准线**。

### 手法二：逐个隐藏对象 + 截图

遍历场景顶层可见对象，逐个 `visible=false` 后截图：

| 隐藏对象 | 白楔是否消失 |
|---|---|
| `AimLine` | ❌ 仍在 |
| `ball` | ❌ 仍在 |
| `SnowMountain` | ❌ 仍在 |
| `models/p8.min.gltf` | ✅ 消失（但连球桌一起没了） |

隐藏 `AimLine` 后白楔仍在 —— **直接否定了我的假设**。

### 手法三：全场景网格普查 + 世界包围盒

列出所有可见 Mesh 的材质类型/颜色/世界包围盒，筛「白色 或 尺寸 > 0.5m」。
在结果末尾抓到三条：

```
(unnamed) MeshPhongMaterial #ffffff c=[-0.689,-0.058,0.033] sz=[0.068,0.070,0.049] v=19
(unnamed) MeshPhongMaterial #ffffff c=[-0.663, 0.031,0.033] sz=[0.070,0.068,0.049] v=19
(unnamed) MeshPhongMaterial #ffffff c=[-0.752, 0.058,0.033] sz=[0.068,0.070,0.049] v=19
```

三片 7cm 见方、19 顶点的白色 `MeshPhongMaterial`，全部紧贴母球
`(-0.72, 0, 0)`。19 顶点 + 白色 `MeshPhongMaterial` → 直指
`CueMesh.createPlacer()`：

```ts
static createPlacer() {
  const pyramidGeo = new ConeGeometry(0.75 * R, 1.6 * R, 4)  // 4 面锥 = 19 顶点
  for (let i = 0; i < 4; i++) { ... position 绕球排布 ... }
}
static readonly placermaterial = new MeshPhongMaterial({ color: 0xffffff })
```

**白楔 = 摆球指示锥（4 个四棱锥）。**

### 手法四：读状态机状态，闭环验证

再读一次实际状态：

```
controller:      "PlaceBall"   ← 应该是 Aim
cueMeshVisible:  false         ← 应该是 true
placerVisible:   true          ← 应该是 false
```

假设完全闭环。

## 9.3 根因：人机模式下玩家侧永久卡在 PlaceBall

`PlaceBall` 是**交互式**摆球控制器：构造时 `cue.placeBallMode()`（显示 4 个
指示锥 + 隐藏球杆 + 切俯视相机），然后一直等 `SpaceUp` 才 `placed()`。

但人机模式下**摆球是机器人做的**：

```
BotEventHandler.handlePlaceBall()   // boteventhandler.ts:592
  → 直接把球放到 event.pos
  → publishSequenceToPlayer(this.aim())
  → 从不发 SpaceUp
```

而玩家侧收到 `PlaceBallEvent` 的两条路径都无条件进入交互式 `PlaceBall`：

1. `Init.handleBegin()` / `handleBreak()` — 开球（`initialController` 对八球
   未定义，于是 fallback 到 `new PlaceBall`）
2. `WatchShot.handlePlaceBall()` — 机器人犯规后的自由球

结果**整局卡死**：4 个指示锥常驻、玩家球杆永久不可见、相机停在俯视。

### 为什么此前一直没被发现

因为此前 `--view aim` 拍出来一直是俯视图（第二个量具缺陷），**正好和
PlaceBall 的俯视机位撞在一起**，看起来"合理"。两个 bug 互相掩护。

## 9.4 修复

事件里已经带了机器人的最终决策（`event.pos`），玩家侧**不需要再交互一次**。

- `watchshot.ts handlePlaceBall()`：应用 `event.pos` → 落位 → `cue.aimMode()`
  → `new Aim(...)`。删掉 `new PlaceBall` 分支与 import。
- `init.ts handleBegin()/handleBreak()`：加 `Session.isBotMode()` 守卫，
  人机模式直接落位进 `Aim`。

## 9.5 顺带修掉的两个缺陷

### 母球红斑

`Rack.unlabeledAppearance()` 在 `lod > 1` 时把母球也交给 `"texturedDots"`，
于是 `BallCubeTextureFactory` 在**每张面中心**画一个 `#cc0000` 点 —— 纯白母球
被贴上 6 个红点。

修复：工厂内部按球色判定，纯白球 `dotColor = null`（只填底色）。
`BallMesh.addDots()` 同样加了 `dotColor: number | null`，母球走 `null`
（缓存 key 带上 `"cue"` 避免与同色彩球共用几何）。

### 瞄准辅助管

`CueMesh.helpermaterial` 三个叠加问题：`dot(N,L)` 未 clamp（负色变黑）、
alpha 写死 `0.075` 且 `depthTest=false`（盖住母球）。

修复：改加性混合 + 边缘增强（正对镜头透、掠射留边）+ `alpha = 0.055*edge*fade`，
`renderOrder` 从 `-1` 提到 `4`，恢复 `depthTest`。

### 绿色实心锥 —— 不是 bug

画面下半那根绿色锥体，排查到最后是**球杆本体**（`cueShaft`）。
隐藏 `cueShaft` 后中轴像素从 `(105,181,114)` 变 `(26,43,23)`（台呢暗色）。

原因是默认 `cueTheme: "auto"`（随台面）从台呢色派生球杆色：

```ts
const ts = getTableSkin(Settings.get().tableSkin)
const base = ts.clothColor            // classic = 0x1f6b34 墨绿
const shaft = isButt ? shade(base, -0.28) : shade(base, 0.12)
```

`shade(0x1f6b34, +0.12)` = `0x3a7d4c`、`shade(-0.28)` = `0x164d25` ——
与探针读到的实测值**逐位吻合**。行为本身正确（球杆配台面），
但在默认机位下正对杆轴看，杆身铺满下半屏，观感像"绿锥"。
这是**构图问题**，不是渲染缺陷。

## 9.6 复现与验证命令

```bash
# 几何普查（读 AimLine 顶点缓冲）
DISPLAY=:99 node tools/render/probe-aimline.js

# 状态机 + 球/辅助管实物探针
DISPLAY=:99 node tools/render/probe-cueball.js

# 绿色锥体归属（逐个隐藏 + 像素采样）
DISPLAY=:99 node tools/render/probe-green.js

# 回归
node /root/.codebuddy/artifact/verify_aim.js      # 17 项
node /root/.codebuddy/artifact/verify_pbr.js      # 27 项
node /root/.codebuddy/artifact/verify_indoor.js   # 38 项
node /root/.codebuddy/artifact/verify84j.js       # 23 项
```

## 9.7 教训

1. **「看起来像」是最贵的错觉**。白楔在母球旁边、瞄准线也从母球出发，
   于是我一口咬定是瞄准线。**读一次顶点缓冲只要 20 行代码，却直接推翻
   了这个猜测**。凡是有句柄可读的状态，都不要靠看截图推理。
2. **逐个隐藏对象**是定位「画面里这个东西是谁」的最快手段，成本极低。
3. **两个 bug 会互相掩护**。俯视机位缺陷让 PlaceBall 泄漏看起来"正常"，
   所以修好一个之后才暴露出另一个。修完量具要**重看一遍所有结论**。
4. **验证脚本本身要防注释误伤**。`verify_aim.js` R1a 一开始红了，原因是
   正则命中了注释里描述"病史"的 `return new PlaceBall` 文字 ——
   断言前必须先剥注释。

## 9.8 关键代码位置（本轮）

| 文件 | 内容 |
|---|---|
| `src/controller/watchshot.ts` | `handlePlaceBall()` 改为落位进 Aim + `aimMode()` |
| `src/controller/init.ts` | `handleBegin()` / `handleBreak()` 加 bot 模式守卫 |
| `src/view/ballcubetexturefactory.ts` | 纯白母球不画点（`dotColor = null`） |
| `src/view/ballmesh.ts` | `addDots(geo, color, dotColor)` + 缓存 key 区分母球 |
| `src/view/cuemesh.ts` | `helpermaterial` 加性混合 + 边缘增强 + depthTest |
| `src/view/aimline.ts` | 软边渐变 + `begin()` 清零 alpha + `trace()` 拖尾 |
| `tools/render/probe-*.js` | 几何 / 状态 / 归属三类探针 |
| `/root/.codebuddy/artifact/verify_aim.js` | 17 项瞄准视角回归 |

---

# 第十轮：auto 球杆主题架空 skin（含上一轮结论的修正）

## 10.1 用户提问

> 球杆有很多皮肤颜色，为什么染成台呢色？

这个问题直接指向了第九轮我下的"绿色锥体不是 bug"的结论 —— 结论方向对
（它确实来自球杆），但对**成因的判断不完整**。

## 10.2 真正的问题：auto 把 skin 整个覆盖

`cueTheme` 有两层设置：

| 设置 | 作用 |
|---|---|
| `skin` | 球杆几何自带配色（`shaftColor` / `buttColor` / `tipColor`） |
| `cueTheme` | 套在几何之上的主题：`auto`（随台面）+ 屠龙斩/青龙/火麒麟… |

`applyCueTheme()` 里，**只有贴图类主题会真正换色**；`auto` 是无贴图档，
走 else 分支。旧版 else 分支是这样写的：

```ts
const ts = getTableSkin(Settings.get().tableSkin)
const base = ts.clothColor                                   // classic = 0x1f6b34
const shaft = isButt ? shade(base, -0.28) : shade(base, 0.12)
mat.color.setHex(shaft)                                      // ← 无条件覆盖
```

而 `cueGeometry()` 在**创建几何时刚按 skin 上完色**：

```ts
const skin = getSkin(Settings.get().skin)
const ashWoodMat = new MeshPhongMaterial({ color: skin.shaftColor, ... })
...
this.applyCueTheme(cueBody, Settings.get().cueTheme, Settings.get().skin)  // ← 紧接着覆盖
```

**后果**：只要 `cueTheme === "auto"`（默认值），设置面板里五个球杆皮肤
**全部失效**，切 classic→emerald→gold 画面毫无变化。

**佐证**：该方法签名原本是 `_skinId`（下划线前缀 = 未使用），
等于自认 skin 在这条路径上没作用。

`0x3a7d4c` 正是 `shade(0x1f6b34, +0.12)` 的结果 —— 与第九轮探针读到的
实测值逐位吻合。数值对得上，但我当时只追到"它来自台呢色"就收手了，
**没有继续问"那 skin 设置去哪了"**。

## 10.3 修复（方案 A：auto 尊重 skin）

```ts
const CLOTH_TINT = 0.12
const cloth = getTableSkin(Settings.get().tableSkin).clothColor
const skin = getSkin(skinId)
...
const base = isButt ? skin.buttColor : skin.shaftColor
mat.color.setHex(mixHex(base, cloth, CLOTH_TINT))
```

- `mixHex(a, b, t)`：按权重把 `a` 往 `b` 混。`t` 必须小（0.12），
  只把球杆往台面色偏一点点，保留"随台面协调"的意图，但绝不会把
  原木杆 `0xe3c79a` 变成绿色。
- 签名 `_skinId` → `skinId`（正式启用）。
- 删掉已无调用点的 `shade()`，避免死代码。

## 10.4 实测：五档皮肤真实生效

探针 `node tools/render/probe-cueskin.js`：

| skin | cueShaft | cueButt |
|---|---|---|
| classic | `cbbc8e` | `614e1d` |
| emerald | `498b59` | `134522` |
| crimson | `a36a51` | `531e18` |
| sapphire | `5376a8` | `0d223f` |
| golden | `d0bd70` | `45320f` |

**不同杆身色数量 = 5 / 5**（旧版恒为 1 / 5，全是 `3a7d4c`）。

视觉对比（`render-cueskins.js`）逐像素差异：约 **1250 像素**不同，
最大差 **242**（旧版仅 36 像素不同，且全部来自左上角计分板的抗锯齿噪点）。

## 10.5 ⚠️ 修正第九轮的一个错误结论

第九轮我说：

> 「隐藏 `cueShaft` 后中轴像素从 `(105,181,114)` 掉到 `(26,43,23)` ——
> 它就是**球杆本体**。」

**这个推论只对了一半。** 隐藏 `cueShaft` 确实会改变那些像素，但真正的
原因是：屏幕投影计算显示，在 `--view aim` 机位下球杆**几乎全在画面外**：

| 部件 | 世界 x | 屏幕 y | 可见（画布高 960） |
|---|---|---|---|
| `cueTip` | -0.84 | 592 | ✅ |
| `cueFerrule` | -0.85 | 592 | ✅ |
| `cueShaft` | -1.35 | **1149** | ❌ 画面下方 |
| `cueButt` | -2.03 | **30** | ❌ 上方边缘 |

画面里那根贯穿下半屏的"亮锥"是**母球的高光 + 台面反光**，不是球杆。
只剩球杆尖端极近处的一小片参与成像，而它恰好压在那些采样点上。

**教训**：`visible` 翻转能改变像素，**不等于**能证明"这个物体是画面里
那个东西"。要证明归属，必须同时核对**屏幕投影位置**。

这个错误还引出一个实际后果：我第一版 `render-cueskins.js` 用
`forceMode("aim")` 拍照，五张皮肤截图**逐像素相同**（仅 36 像素噪点差异），
看起来像"修复没生效"，实际是**球杆根本不在画面里**。改用斜俯视机位
（相机退到球桌外上方）后，球杆完整入画，差异才显现出来。

## 10.6 复现与验证

```bash
# 断言五档皮肤互不相同（退出码 0 = 全部生效）
DISPLAY=:99 node tools/render/probe-cueskin.js

# 出五档皮肤视觉对比图
DISPLAY=:99 node tools/render/render-cueskins.js

# 回归
node /root/.codebuddy/artifact/verify_aim.js      # 22 项（本轮 +5）
```

## 10.7 关键代码位置（本轮）

| 文件 | 内容 |
|---|---|
| `src/view/cuemesh.ts` | `applyCueTheme()` auto 分支改为 skin 为主 + `CLOTH_TINT` 轻混 |
| `src/view/cuemesh.ts` | 新增 `mixHex()`；移除死代码 `shade()` |
| `tools/render/probe-cueskin.js` | 五档皮肤颜色断言探针 |
| `tools/render/render-cueskins.js` | 五档皮肤视觉对比渲染 |
| `/root/.codebuddy/artifact/verify_aim.js` | 补 R6a~R6e 五项断言 |
