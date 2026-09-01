/**
 * 本地游戏设置（纯离线，存储于 localStorage）
 *
 * 原项目的画质等参数依赖 URL 查询串与在线大厅下发，
 * 单机版改为本地持久化设置，并提供设备性能自适应默认值。
 */

export type QualityLevel = 0 | 1 | 2 | 3 | 4 | 5

export interface GameSettings {
  /** 画质档位 0~5，越大越精细 */
  lod: QualityLevel
  /** 音效开关 */
  sound: boolean
  /** 音量 0~1 */
  volume: number
  /** 是否显示瞄准辅助线 */
  aimAssist: boolean
  /** 是否已看过新手引导 */
  seenGuide: boolean
  /** 上次选择的玩法 */
  lastRule: string
  /** 是否与电脑对战 */
  vsBot: boolean
  /** 帧率上限：0 表示不限制 */
  fpsCap: number
  /** 辅助线长度档位：0=关闭，1=短，2=中，3=最长（最长=白球→被击球→袋口，不截断） */
  targetLineLength: number
  /** 进球辅助线总开关：实线（母球→碰撞点）+ 虚线（碰撞点→袋口） */
  aimLine: boolean
  /** 横向瞄准角度滑动条开关（悬浮 2D UI） */
  aimSlider: boolean
  /** 皮肤选择 */
  skin: string
  /** 球杆主题（item 2）：auto=随台面，其余为独立主题贴图 */
  cueTheme: string
  /** 台球桌皮肤（item 5）：仅影响台呢/桌框/装饰纹理与边缘特效，不改球杆与球 */
  tableSkin: string
  /** 环境场景（item 4）：room=室内，其余为新增主题 */
  scene: string
  /** 是否保留三个视角（跟随 / 俯视 / 母球视角），关闭则仅保留前两个 */
  keepAllViews: boolean
  /** 界面语言：zh=中文，en=英文 */
  language: "zh" | "en"
}

const STORAGE_KEY = "billiards_cn_settings_v1"
/** v1.1.10：seenGuide 独立轻量 key，主 key 写入失败时兜底 */
const SEEN_GUIDE_KEY = "billiards_cn_seenGuide_v1"

const DEFAULTS: GameSettings = {
  lod: 3,
  sound: true,
  // v1.2.28：音量默认最大（1.0）。此前默认 0.8，用户希望开局面即最大音量。
  volume: 1,
  aimAssist: true,
  seenGuide: false,
  lastRule: "nineball",
  vsBot: false,
  fpsCap: 0,
  // v1.2.5：默认值改为最长（3）。用户反馈辅助线太短，默认给最长档，
  // 完整显示「白球→被击球→袋口」走向；旧存档用户仍保留各自选择。
  targetLineLength: 3,
  aimLine: true,
  aimSlider: true,
  skin: "classic",
  cueTheme: "auto",
  // v1.3.21：台球桌外观默认经典原木（原「台球桌颜色」首款，已合入统一外观设置）
  tableSkin: "classic",
  // v1.1.6：默认且仅启用「雪山」场景（其余场景 UI 禁用，避免黑屏）
  scene: "snow",
  // v1.1.8：默认保留三个视角（跟随 / 俯视 / 母球视角）
  keepAllViews: true,
  // v1.3.19：界面语言默认中文
  language: "zh",
}

/** 皮肤列表 */
export interface SkinDef {
  id: string
  name: string
  /** 球杆前段色 */
  shaftColor: number
  /** 球杆后段色 */
  buttColor: number
  /** 杆头色 */
  tipColor: number
  /** 台呢色 */
  clothColor: number
  /** 库边色 */
  cushionColor: number
  /** 台呢阴影色 */
  clothshadeColor: number
}

export const SKINS: SkinDef[] = [
  {
    id: "classic",
    name: "经典原木",
    shaftColor: 0xe3c79a,
    buttColor: 0x6a4a1a,
    tipColor: 0x4a7c9a,
    clothColor: 0xdac39e,
    cushionColor: 0xba934e,
    clothshadeColor: 0x896e42,
  },
  {
    id: "emerald",
    name: "翡翠绿",
    shaftColor: 0x4f8f5e,
    buttColor: 0x11401f,
    tipColor: 0x3a5a7a,
    clothColor: 0x2a7a3a,
    cushionColor: 0x1a5a2a,
    clothshadeColor: 0x1a3a1a,
  },
  {
    id: "crimson",
    name: "赤焰红",
    shaftColor: 0xb56a55,
    buttColor: 0x5a1414,
    tipColor: 0x6a0a0a,
    clothColor: 0x8a2a2a,
    cushionColor: 0x6a1a1a,
    clothshadeColor: 0x4a0a0a,
  },
  {
    id: "sapphire",
    name: "蓝宝石",
    shaftColor: 0x5a78b8,
    buttColor: 0x0a1840,
    tipColor: 0x2a4a7a,
    clothColor: 0x1a3a8a,
    cushionColor: 0x0a2a6a,
    clothshadeColor: 0x0a1a4a,
  },
  {
    id: "golden",
    name: "金辉",
    shaftColor: 0xe8c878,
    buttColor: 0x4a2a0a,
    tipColor: 0x6a4a0a,
    clothColor: 0x8a6a2a,
    cushionColor: 0x6a4a1a,
    clothshadeColor: 0x4a2a0a,
  },
]

export function getSkin(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]
}

/**
 * 台球桌皮肤（item 5）。
 *
 * 与 SKINS（同时改台呢+球杆）不同，本系统**只**作用于球台本体：
 * 台呢(cloth)、库边(cushion)、桌框(wood)、装饰线条与边缘发光特效。
 * 不改球杆模型、球模型、击球动画，也不动球桌尺寸/袋口/碰撞体。
 *
 * 全部为程序化 Canvas 贴图（见 tableskinfactory.ts），离线可用、零版权风险。
 *
 * 字段说明：
 * - clothColor / clothColor2：台呢底色（渐变两端）。
 * - clothTexture：台呢纹理类型（决定程序化图案：裂纹/霓虹灯带/云纹/全息/果冻等）。
 * - cushionColor：库边色。
 * - frameColor / frameGlow：桌框底色与发光色（frameGlow=0 表示无发光）。
 * - edgeGlow：桌沿装饰发光边色（0 表示无）；以细发光环呈现，属纯装饰。
 * - kind：贴图生成方式，对应 tableskinfactory.ts 的分支。
 * - swatch：UI 缩略图背景（CSS 渐变）。
 */
export interface TableSkinDef {
  id: string
  name: string
  kind:
    | "classic"
    | "emerald"
    | "crimson"
    | "sapphire"
    | "golden"
    | "obsidian"
    | "lava"
    | "neon"
    | "crimsonGold"
    | "holo"
    | "candy"
    | "emeraldGold"
    | "violet"
  /** 台呢渐变两端色 */
  clothColor: number
  clothColor2: number
  /** 台呢纹理类型（程序化图案） */
  clothTexture:
    | "none"
    | "velvet"
    | "gild"
    | "glass"
    | "lava"
    | "neonstrip"
    | "cloud"
    | "holo"
    | "candy"
  cushionColor: number
  frameColor: number
  /** 桌框发光色（emissive），0 表示不发光 */
  frameGlow: number
  /** 桌沿装饰发光边色（纯装饰细环），0 表示无 */
  edgeGlow: number
  swatch: string
}

export const TABLE_SKINS: TableSkinDef[] = [
  // —— 经典原「台球桌颜色」5 款（仅台呢/库边配色，无特效，合入统一外观设置）——
  {
    id: "classic",
    name: "经典原木",
    kind: "classic",
    // 经典台球桌外观：原木框 + 墨绿台呢（台呢取自 emerald 的经典绿，框保留原木暖棕），
    // 库边用台呢的更深绿作为过渡，使台呢/库边/木框三者成一套协调的「原木绿台」主题。
    clothColor: 0x1f6b34,
    clothColor2: 0x124a22,
    clothTexture: "velvet",
    cushionColor: 0x0e3a1a,
    frameColor: 0x6a4a1a,
    frameGlow: 0,
    edgeGlow: 0,
    swatch: "linear-gradient(135deg,#1f6b34 0%,#6a4a1a 100%)",
  },
  {
    id: "emerald",
    name: "翡翠绿",
    kind: "emerald",
    clothColor: 0x2a7a3a,
    clothColor2: 0x1a3a1a,
    clothTexture: "velvet",
    cushionColor: 0x15501f,
    frameColor: 0x0d3316,
    frameGlow: 0,
    edgeGlow: 0,
    swatch: "linear-gradient(135deg,#2a7a3a 0%,#0d3316 100%)",
  },
  {
    id: "crimson",
    name: "赤焰红",
    kind: "crimson",
    clothColor: 0x8a2a2a,
    clothColor2: 0x4a0a0a,
    clothTexture: "velvet",
    cushionColor: 0x5a1414,
    frameColor: 0x3a0c0c,
    frameGlow: 0,
    edgeGlow: 0,
    swatch: "linear-gradient(135deg,#8a2a2a 0%,#3a0c0c 100%)",
  },
  {
    id: "sapphire",
    name: "蓝宝石",
    kind: "sapphire",
    clothColor: 0x1a3a8a,
    clothColor2: 0x0a1a4a,
    clothTexture: "velvet",
    cushionColor: 0x0a2458,
    frameColor: 0x081028,
    frameGlow: 0,
    edgeGlow: 0,
    swatch: "linear-gradient(135deg,#1a3a8a 0%,#081028 100%)",
  },
  {
    id: "golden",
    name: "金辉",
    kind: "golden",
    // 金辉主题：台呢提亮为更纯的暖金（与深棕木框形成金棕对比），库边取台呢与框之间的过渡金。
    clothColor: 0xb8902f,
    clothColor2: 0x6a4a14,
    clothTexture: "velvet",
    cushionColor: 0x8a6620,
    frameColor: 0x3a2408,
    frameGlow: 0,
    edgeGlow: 0,
    swatch: "linear-gradient(135deg,#b8902f 0%,#3a2408 100%)",
  },
  // —— 新增 6 款台球桌皮肤（含桌框发光/纹理/边缘特效）——
  {
    id: "obsidian",
    name: "黑曜石黑",
    kind: "obsidian",
    clothColor: 0x0a0a0c,
    clothColor2: 0x1a1a20,
    clothTexture: "glass",
    cushionColor: 0x141416,
    frameColor: 0x18181c,
    frameGlow: 0x5a0d12,
    edgeGlow: 0x8a1018,
    swatch: "linear-gradient(135deg,#1a1a20 0%,#8a1018 100%)",
  },
  {
    id: "lava",
    name: "熔岩裂纹",
    kind: "lava",
    clothColor: 0x140303,
    clothColor2: 0x3a0808,
    clothTexture: "lava",
    cushionColor: 0x2a0804,
    frameColor: 0x140402,
    frameGlow: 0xff5a14,
    edgeGlow: 0xff7a1f,
    swatch: "linear-gradient(135deg,#3a0808 0%,#ff7a1f 100%)",
  },
  {
    id: "neon",
    name: "霓虹蓝紫",
    kind: "neon",
    clothColor: 0x0b0a2a,
    clothColor2: 0x241046,
    clothTexture: "neonstrip",
    cushionColor: 0x13082e,
    frameColor: 0x0c0722,
    frameGlow: 0x6a3cff,
    edgeGlow: 0x13e6ff,
    swatch: "linear-gradient(135deg,#241046 0%,#13e6ff 100%)",
  },
  {
    id: "crimsonGold",
    name: "朱红鎏金",
    kind: "crimsonGold",
    clothColor: 0x2a0606,
    clothColor2: 0x5a0a0a,
    clothTexture: "cloud",
    cushionColor: 0x3a1406,
    frameColor: 0x4a2e08,
    frameGlow: 0xd9a23a,
    edgeGlow: 0xf0c860,
    swatch: "linear-gradient(135deg,#5a0a0a 0%,#d9a23a 100%)",
  },
  {
    id: "holo",
    name: "全息银",
    kind: "holo",
    clothColor: 0x8a909a,
    clothColor2: 0xc8d0da,
    clothTexture: "holo",
    cushionColor: 0xb9c2cc,
    frameColor: 0x9aa2ac,
    frameGlow: 0x9fd0ff,
    edgeGlow: 0xd0e8ff,
    swatch: "linear-gradient(135deg,#c8d0da 0%,#9fd0ff 100%)",
  },
  {
    id: "candy",
    name: "粉色糖果",
    kind: "candy",
    clothColor: 0xffc6dd,
    clothColor2: 0xffe6f0,
    clothTexture: "candy",
    cushionColor: 0xffa8cf,
    frameColor: 0xff9ec4,
    frameGlow: 0xff7ab0,
    edgeGlow: 0xffd0e8,
    swatch: "linear-gradient(135deg,#ffe6f0 0%,#ff7ab0 100%)",
  },
  {
    // v1.3.61 新增：翡翠鎏金 —— 墨绿呢面 + 金色菱格网纹 + 鎏金框与金边，
    // 与 crimsonGold（朱红底金云纹）同属「金饰」系，但底色是经典绿台，
    // 喜欢传统绿台又想要华丽感的用户选它。
    id: "emeraldGold",
    name: "翡翠鎏金",
    kind: "emeraldGold",
    clothColor: 0x0e5c30,
    clothColor2: 0x063318,
    clothTexture: "gild",
    cushionColor: 0x0a4423,
    frameColor: 0x6a4a10,
    frameGlow: 0xd9a23a,
    edgeGlow: 0xf0c060,
    swatch: "linear-gradient(135deg,#0e5c30 0%,#d9a23a 100%)",
  },
  {
    // v1.3.61 新增：紫夜流光 —— 深紫呢面 + 洋红/青霓虹灯带 + 紫金框，
    // 与 neon（霓虹蓝紫）同系但更暗、更浓郁，灯光感更强。
    id: "violet",
    name: "紫夜流光",
    kind: "violet",
    clothColor: 0x1c0a3e,
    clothColor2: 0x35146b,
    clothTexture: "neonstrip",
    cushionColor: 0x241046,
    frameColor: 0x1a0c34,
    frameGlow: 0xc44dff,
    edgeGlow: 0xff5ad0,
    swatch: "linear-gradient(135deg,#1c0a3e 0%,#c44dff 100%)",
  },
]

export function getTableSkin(id: string): TableSkinDef {
  return TABLE_SKINS.find((s) => s.id === id) ?? TABLE_SKINS[0]
}

/**
 * 球杆主题（item 2：增加球杆元素）。
 * - auto：球杆颜色跟随所选台面皮肤（修复「球杆颜色不随球桌变化」）。
 * - 其余：程序化贴图主题，见 cuetexturefactory.ts。
 * kind 决定贴图生成方式；accent 用于 UI 色块与（auto 时）强调色。
 */
export interface CueThemeDef {
  id: string
  name: string
  kind:
    | "auto"
    | "dragon"
    | "azure"
    | "minions"
    | "peppa"
    | "qilin"
    | "ultraman"
    | "moyunlongque"      // 墨云龙阙
    | "qingzhutingfeng"   // 青竹听风
    | "fengyuliujin"      // 凤羽鎏金
    | "qianliyanshan"     // 千里砚山
    | "xinghedanmang"     // 星核暗芒
    | "nihongsuguang"     // 霓虹溯光
    | "xukonglilie"       // 虚空裂隙
    | "youciyeying"       // 幽刺夜影
    | "jinhuofengfeng"    // 烬火焚风
    | "yuntianghuanmeng"  // 云糖幻梦
    | "bingjingxuepo"     // 冰晶雪魄
    | "wanxiangquanzhang" // 万象权杖
  /** UI 色块渐变（左=杆身，右=杆尾） */
  swatch: string
  accent: number
  /**
   * 材质光泽（MeshPhongMaterial.shininess）。
   * 值越大越亮/越光滑（玻璃、冰晶、抛光金属）；越小越哑光（石砚、磨砂金属、粗陶）。
   * shaft 作用于杆身段，butt 作用于杆尾段。
   */
  finish?: { shaft: number; butt: number }
}

export const CUE_THEMES: CueThemeDef[] = [
  {
    id: "auto",
    name: "随台面",
    kind: "auto",
    swatch: "linear-gradient(135deg,#d2b48c 0%,#1a1a1a 100%)",
    accent: 0xd2b48c,
  },
  {
    id: "dragon",
    name: "屠龙斩",
    kind: "dragon",
    swatch: "linear-gradient(135deg,#caa23a 0%,#3a0d0d 100%)",
    accent: 0xcaa23a,
  },
  {
    id: "azure",
    name: "青龙",
    kind: "azure",
    swatch: "linear-gradient(135deg,#5fd0e0 0%,#093b54 100%)",
    accent: 0x5fd0e0,
  },
  {
    id: "minions",
    name: "小黄人",
    kind: "minions",
    swatch: "linear-gradient(135deg,#f4d000 0%,#1f6fb2 100%)",
    accent: 0xf4d000,
  },
  {
    id: "peppa",
    name: "小猪佩奇",
    kind: "peppa",
    swatch: "linear-gradient(135deg,#ff9ec4 0%,#ff6fa8 100%)",
    accent: 0xff9ec4,
  },
  {
    id: "qilin",
    name: "火麒麟",
    kind: "qilin",
    swatch: "linear-gradient(135deg,#ffd24a 0%,#d8320a 100%)",
    accent: 0xff7a1f,
  },
  {
    id: "ultraman",
    name: "奥特曼",
    kind: "ultraman",
    swatch: "linear-gradient(135deg,#e8eef2 0%,#c81f1f 100%)",
    accent: 0xe8eef2,
  },
  // ===== 12 款特色球杆皮肤（v1.3.23 新增，v1.3.51 重做分区贴图与材质光泽）=====
  {
    id: "moyunlongque",
    name: "墨云龙阙",
    kind: "moyunlongque",
    swatch: "linear-gradient(135deg,#3a3320 0%,#0c0a07 100%)",
    accent: 0xc9a24a,
    // 乌木哑光 + 暗金浮刻：低调厚重
    finish: { shaft: 22, butt: 18 },
  },
  {
    id: "qingzhutingfeng",
    name: "青竹听风",
    kind: "qingzhutingfeng",
    swatch: "linear-gradient(135deg,#bfe3a0 0%,#3f7d2f 100%)",
    accent: 0x9fd67a,
    // 竹质素雅温润：微弱光泽
    finish: { shaft: 34, butt: 28 },
  },
  {
    id: "fengyuliujin",
    name: "凤羽鎏金",
    kind: "fengyuliujin",
    swatch: "linear-gradient(135deg,#1a1410 0%,#caa24a 100%)",
    accent: 0xe8c878,
    // 黑檀 + 鲍鱼贝虹彩 + 鎏金：明显光泽
    finish: { shaft: 62, butt: 55 },
  },
  {
    id: "qianliyanshan",
    name: "千里砚山",
    kind: "qianliyanshan",
    swatch: "linear-gradient(135deg,#8a99a0 0%,#39474d 100%)",
    accent: 0x6b7d85,
    // 石砚哑光雾面 / 粗陶磨砂：几乎无高光
    finish: { shaft: 12, butt: 10 },
  },
  {
    id: "xinghedanmang",
    name: "星核暗芒",
    kind: "xinghedanmang",
    swatch: "linear-gradient(135deg,#1b2a4a 0%,#05060a 100%)",
    accent: 0x39c6ff,
    // 深空哑光黑 + 金属磨砂
    finish: { shaft: 28, butt: 22 },
  },
  {
    id: "nihongsuguang",
    name: "霓虹溯光",
    kind: "nihongsuguang",
    swatch: "linear-gradient(135deg,#ff7be0 0%,#3a1d6e 100%)",
    accent: 0xff5fd0,
    // 半透玻璃 / 多边形切面镜面反光
    finish: { shaft: 88, butt: 70 },
  },
  {
    id: "xukonglilie",
    name: "虚空裂隙",
    kind: "xukonglilie",
    swatch: "linear-gradient(135deg,#2a1840 0%,#050507 100%)",
    accent: 0x9b5cff,
    // 纯哑光炭黑金属
    finish: { shaft: 18, butt: 15 },
  },
  {
    id: "youciyeying",
    name: "幽刺夜影",
    kind: "youciyeying",
    swatch: "linear-gradient(135deg,#3a3a42 0%,#0d0d10 100%)",
    accent: 0xb8a0d8,
    // 炭黑金属 + 贝母珠光 + 真皮
    finish: { shaft: 42, butt: 34 },
  },
  {
    id: "jinhuofengfeng",
    name: "烬火焚风",
    kind: "jinhuofengfeng",
    swatch: "linear-gradient(135deg,#ff5a2a 0%,#1a0805 100%)",
    accent: 0xff7a1f,
    // 黑红熔岩，厚重粗犷
    finish: { shaft: 32, butt: 26 },
  },
  {
    id: "yuntianghuanmeng",
    name: "云糖幻梦",
    kind: "yuntianghuanmeng",
    swatch: "linear-gradient(135deg,#ffe3ef 0%,#c9b6ff 100%)",
    accent: 0xffb8d8,
    // 半透果冻 / 柔雾硅胶
    finish: { shaft: 72, butt: 62 },
  },
  {
    id: "bingjingxuepo",
    name: "冰晶雪魄",
    kind: "bingjingxuepo",
    swatch: "linear-gradient(135deg,#eaf6ff 0%,#9fc6e0 100%)",
    accent: 0xcfeaff,
    // 透白冰晶：通透冷调，高光最强
    finish: { shaft: 95, butt: 80 },
  },
  {
    id: "wanxiangquanzhang",
    name: "万象权杖",
    kind: "wanxiangquanzhang",
    swatch: "linear-gradient(135deg,#caa24a 0%,#0c0a07 100%)",
    accent: 0xe8c878,
    // 黑金撞色金属：局部哑光、局部抛光
    finish: { shaft: 78, butt: 68 },
  },
]

export function getCueTheme(id: string): CueThemeDef {
  return CUE_THEMES.find((t) => t.id === id) ?? CUE_THEMES[0]
}

/**
 * 环境场景（item 4）。背景是一个「盒子房间」（背景 cube），切换场景即
 * 替换盒子的材质贴图 + 调整环境光色调。全部为程序化生成，无外部贴图资源。
 * - wallA/wallB：墙面渐变两端色（顶/底）。
 * - amb/ambI：环境光颜色与强度，营造不同氛围。
 * - kind：墙面程序化图案类型（见 scenetexturefactory.ts）。
 */
export interface EnvSceneDef {
  id: string
  name: string
  wallA: number
  wallB: number
  amb: number
  ambI: number
  kind:
    | "room"
    | "beach"
    | "forest"
    | "snow"
    | "office"
    | "cybercafe"
    | "football"
    | "basketball"
  swatch: string
  /**
   * 实景照片背景（Request D）：命中该项时，游戏背景直接用该照片做全屏
   * 实景，而非程序化纯色贴图。其余场景留空，仍用程序化贴图。
   */
  photo?: string
}

export const ENV_SCENES: EnvSceneDef[] = [
  { id: "room", name: "室内", wallA: 0x3a3f4b, wallB: 0x2a2e38, amb: 0xbfcad6, ambI: 0.55, kind: "room", swatch: "linear-gradient(135deg,#3a3f4b,#2a2e38)" },
  { id: "beach", name: "沙滩", wallA: 0xf4d9a0, wallB: 0xe0a85e, amb: 0xfff0d0, ambI: 0.72, kind: "beach", swatch: "linear-gradient(135deg,#f4d9a0,#e0a85e)" },
  { id: "forest", name: "原始森林", wallA: 0x2f5d34, wallB: 0x183218, amb: 0xcfeccf, ambI: 0.55, kind: "forest", swatch: "linear-gradient(135deg,#2f5d34,#183218)" },
  { id: "snow", name: "雪山", wallA: 0xdbe7f0, wallB: 0xa6bace, amb: 0xeaf2ff, ambI: 0.82, kind: "snow", swatch: "linear-gradient(135deg,#dbe7f0,#a6bace)", photo: "assets/scenes/snow.jpg" },
  { id: "football", name: "足球场", wallA: 0x2f7d32, wallB: 0x183d1a, amb: 0xdff5e0, ambI: 0.7, kind: "football", swatch: "linear-gradient(135deg,#2f7d32,#183d1a)", photo: "assets/scenes/football.jpg" },
  { id: "basketball", name: "篮球场", wallA: 0xcaa05a, wallB: 0x9a6a2a, amb: 0xfff0d8, ambI: 0.72, kind: "basketball", swatch: "linear-gradient(135deg,#caa05a,#9a6a2a)", photo: "assets/scenes/basketball.jpg" },
  { id: "office", name: "办公室", wallA: 0xc9d2dc, wallB: 0x92a0b0, amb: 0xeef2f7, ambI: 0.62, kind: "office", swatch: "linear-gradient(135deg,#c9d2dc,#92a0b0)" },
  { id: "cybercafe", name: "网吧", wallA: 0x281a4a, wallB: 0x0a0618, amb: 0x6a3cff, ambI: 0.52, kind: "cybercafe", swatch: "linear-gradient(135deg,#281a4a,#0a0618)" },
]

export function getEnvScene(id: string): EnvSceneDef {
  return ENV_SCENES.find((s) => s.id === id) ?? ENV_SCENES[0]
}

/**
 * 根据设备能力推荐画质档位。
 * 依据：设备内存、CPU 核心数、屏幕像素比与 GPU 名称。
 */
export function detectRecommendedLod(): QualityLevel {
  try {
    const nav = navigator as Navigator & {
      deviceMemory?: number
      hardwareConcurrency?: number
    }
    const mem = nav.deviceMemory ?? 4
    const cores = nav.hardwareConcurrency ?? 4
    const dpr = globalThis.devicePixelRatio ?? 1

    let score = 0
    if (mem >= 8) score += 3
    else if (mem >= 6) score += 2
    else if (mem >= 4) score += 1

    if (cores >= 8) score += 3
    else if (cores >= 6) score += 2
    else if (cores >= 4) score += 1

    if (dpr >= 3) score += 1
    else if (dpr >= 2) score += 1

    // 检查 GPU 型号，低端 GPU 降档
    const gpu = detectGpu().toLowerCase()
    const lowEnd = ["mali-4", "mali-t", "adreno 3", "adreno 4", "powervr sgx"]
    if (lowEnd.some((g) => gpu.includes(g))) {
      score -= 3
    }

    if (score >= 6) return 4
    if (score >= 4) return 3
    if (score >= 2) return 2
    return 1
  } catch {
    return 2
  }
}

function detectGpu(): string {
  // 关键修复：不再创建 WebGL 上下文读取 GPU 型号。
  // 裸 canvas.getContext("webgl") 在部分机型 GPU 驱动上会直接令渲染进程崩溃，
  // 表现为启动即闪退。画质自动分级退化为仅依据内存/核数/DPR，用户可手动调低画质。
  // 游戏真正的 WebGL 由 three.js 创建，那里有 onRenderProcessGone 兜底。
  return ""
}

export class Settings {
  private static cache: GameSettings | null = null

  static get(): GameSettings {
    if (Settings.cache) return Settings.cache
    let loaded: Partial<GameSettings> = {}
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
      if (raw) loaded = JSON.parse(raw)
    } catch {
      loaded = {}
    }
    const isFirstRun = !loaded || Object.keys(loaded).length === 0
    const merged: GameSettings = { ...DEFAULTS, ...loaded }
    if (isFirstRun) {
      // 首次启动按设备性能给出推荐画质
      merged.lod = detectRecommendedLod()
    }
    merged.lod = clampLod(merged.lod)
    // v1.2.11 #F10：横向瞄准滑动条不再可关闭，强制恒 true。
    // 旧存档可能存了 false，这里纠正；UI 开关已从 help.html 删除。
    merged.aimSlider = true
    Settings.cache = merged
    return merged
  }

  static set<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
    const s = Settings.get()
    s[key] = value
    Settings.save()
  }

  static update(patch: Partial<GameSettings>) {
    const s = Settings.get()
    Object.assign(s, patch)
    Settings.save()
  }

  static save() {
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify(Settings.get())
      )
    } catch (e) {
      // v1.1.10：不再静默吞错。鸿蒙 WebView 在低内存/折叠恢复时可能抛
      // QuotaExceededError，静默会导致 seenGuide 等状态只活在内存 cache，
      // 冷启动后丢失。这里打印警告 + 尝试写独立轻量 key 兜底。
      console.warn("[Settings] localStorage 写入失败，尝试兜底", e)
      Settings.fallbackWriteSeenGuide()
    }
  }

  /**
   * v1.1.10：标记新手引导已完成，三通道写入。
   *
   * 1. 内存 cache（Settings.cache.seenGuide = true）
   * 2. 主 localStorage key（billiards_cn_settings_v1）
   * 3. 独立轻量 key（billiards_cn_seenGuide_v1）—— 主 key 因配额/序列化失败时兜底
   * 4. globalThis.__billiardsSeenGuide —— 进程内兜底（折叠恢复不重启进程时有效）
   *
   * 任意一个通道成功即可，finish() 调用此方法。
   */
  static markSeenGuide() {
    const s = Settings.get()
    s.seenGuide = true
    ;(globalThis as any).__billiardsSeenGuide = true
    // 尝试主 key
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify(Settings.get())
      )
    } catch (e) {
      console.warn("[Settings] markSeenGuide 主 key 写入失败", e)
    }
    // 独立轻量 key（写入失败概率远低于主 key）
    try {
      globalThis.localStorage?.setItem(SEEN_GUIDE_KEY, "1")
    } catch (e) {
      console.warn("[Settings] markSeenGuide 兜底 key 写入失败", e)
    }
  }

  /**
   * v1.2.11 #F6：复位 seenGuide（与 markSeenGuide 对称，四通道复位）。
   *
   * 用于设置页「重新打开新手引导」——原 replayTutorial() 只改 localStorage
   * 两个 key 与 globalThis，未更新 Settings.cache.seenGuide，导致
   * hasSeenGuide() 仍读 cache 返回 true → 引导永不显示。
   * 现在四通道同步复位，下次进对局 hasSeenGuide()=false → 显示 1 次，
   * finish()→markSeenGuide 置回 true → 之后再不自动弹。
   */
  static resetSeenGuide() {
    const s = Settings.get();
    s.seenGuide = false;
    (globalThis as any).__billiardsSeenGuide = false;
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify(Settings.get())
      );
    } catch (e) {
      console.warn("[Settings] resetSeenGuide 主 key 写入失败", e);
    }
    try {
      globalThis.localStorage?.removeItem(SEEN_GUIDE_KEY);
    } catch (e) {
      /* 忽略 */
    }
  }

  /**
   * v1.1.10：读取 seenGuide，多通道兜底。
   * 主 key 的 seenGuide || 独立 key || globalThis 内存标记
   */
  static hasSeenGuide(): boolean {
    if ((globalThis as any).__billiardsSeenGuide === true) return true
    const s = Settings.get()
    if (s.seenGuide) return true
    try {
      if (globalThis.localStorage?.getItem(SEEN_GUIDE_KEY) === "1") {
        // 回填 cache，后续读取一致
        s.seenGuide = true
        return true
      }
    } catch {
      /* localStorage 不可用时忽略 */
    }
    return false
  }

  /** save() 失败时的兜底：至少把 seenGuide 写到独立 key */
  private static fallbackWriteSeenGuide() {
    try {
      if (Settings.get().seenGuide) {
        globalThis.localStorage?.setItem(SEEN_GUIDE_KEY, "1")
      }
    } catch {
      /* 彻底不可用时无能为力 */
    }
  }

  static reset() {
    Settings.cache = { ...DEFAULTS, lod: detectRecommendedLod() }
    Settings.save()
  }

  /** 设置在别处（帮助浮层/主菜单）被修改后，丢弃缓存重新读取 */
  static reload(): GameSettings {
    Settings.cache = null
    return Settings.get()
  }

  /** 供渲染层读取的画质档位 */
  static lod(): number {
    return Settings.get().lod
  }
}

function clampLod(v: number): QualityLevel {
  const n = Math.round(Number.isFinite(v) ? v : 3)
  return Math.min(5, Math.max(0, n)) as QualityLevel
}

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  0: "极速（像素风，最省电）",
  1: "流畅（低配手机推荐）",
  2: "标准",
  3: "高清（推荐）",
  4: "超清（开启抗锯齿）",
  5: "极致（高端手机）",
}
