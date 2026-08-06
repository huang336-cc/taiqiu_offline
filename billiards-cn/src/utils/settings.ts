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
  /** 是否震动反馈 */
  vibrate: boolean
  /** 是否已看过新手引导 */
  seenGuide: boolean
  /** 上次选择的玩法 */
  lastRule: string
  /** 是否与电脑对战 */
  vsBot: boolean
  /** 帧率上限：0 表示不限制 */
  fpsCap: number
  /** 被击打球瞄准线长度（0=关闭，1~5=短到长） */
  targetLineLength: number
  /** 进球辅助线总开关：实线（母球→碰撞点）+ 虚线（碰撞点→袋口） */
  aimLine: boolean
  /** 横向瞄准角度滑动条开关（悬浮 2D UI） */
  aimSlider: boolean
  /** 皮肤选择 */
  skin: string
  /** 球杆主题（item 2）：auto=随台面，其余为独立主题贴图 */
  cueTheme: string
  /** 环境场景（item 4）：room=室内，其余为新增主题 */
  scene: string
  /** 是否保留三个视角（跟随 / 俯视 / 母球视角），关闭则仅保留前两个 */
  keepAllViews: boolean
}

const STORAGE_KEY = "billiards_cn_settings_v1"
/** v1.1.10：seenGuide 独立轻量 key，主 key 写入失败时兜底 */
const SEEN_GUIDE_KEY = "billiards_cn_seenGuide_v1"

const DEFAULTS: GameSettings = {
  lod: 3,
  sound: true,
  volume: 0.8,
  aimAssist: true,
  vibrate: true,
  seenGuide: false,
  lastRule: "nineball",
  vsBot: false,
  fpsCap: 0,
  targetLineLength: 3,
  aimLine: true,
  aimSlider: true,
  skin: "classic",
  cueTheme: "auto",
  // v1.1.6：默认且仅启用「雪山」场景（其余场景 UI 禁用，避免黑屏）
  scene: "snow",
  // v1.1.8：默认保留三个视角（跟随 / 俯视 / 母球视角）
  keepAllViews: true,
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
 * 球杆主题（item 2：增加球杆元素）。
 * - auto：球杆颜色跟随所选台面皮肤（修复「球杆颜色不随球桌变化」）。
 * - 其余：程序化贴图主题，见 cuetexturefactory.ts。
 * kind 决定贴图生成方式；accent 用于 UI 色块与（auto 时）强调色。
 */
export interface CueThemeDef {
  id: string
  name: string
  kind: "auto" | "dragon" | "azure" | "minions" | "peppa" | "qilin"
  /** UI 色块渐变（左=杆身，右=杆尾） */
  swatch: string
  accent: number
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
  try {
    const canvas = document.createElement("canvas")
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null
    if (!gl) return ""
    const dbg = gl.getExtension("WEBGL_debug_renderer_info")
    if (!dbg) return ""
    return String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? "")
  } catch {
    return ""
  }
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
