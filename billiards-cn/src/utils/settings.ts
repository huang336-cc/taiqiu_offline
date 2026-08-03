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
}

const STORAGE_KEY = "billiards_cn_settings_v1"

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
    } catch {
      /* 存储不可用时静默忽略 */
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
