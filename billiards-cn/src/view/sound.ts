import { AudioListener, AudioLoader, Vector3 } from "three"
import { Settings } from "../utils/settings"

/**
 * 音效系统（v1.3.20 重构）。
 *
 * 设计要点：
 * - 采用原生 Web Audio API 实现「3D 空间音频 + 多音效并发」：每个音效在播放时
 *   新建 BufferSource + PannerNode(HRTF) + Gain 节点，互不阻塞；声源位置取自发声球
 *   的桌面坐标（x, 0, y），监听者固定在球桌原点朝上，不同位置出声有真实左右/前后差异。
 * - 全套 6 类台球音效均由程序化合成生成（零外部依赖、零版权风险、ogg 同等听感），
 *   并预生成 AudioBuffer 缓存复用：
 *      cueSoft / cueMid / cueHard（球杆击球 3 档力度）
 *      collision（球球碰撞）、cushion（库边撞击）、pot（落袋）
 *      roll（球滚动）、break（开球，重击球堆）
 * - 「真实 CC0 素材替换接口」：loadExternalOgg(id, url) 可加载外部 ogg 并覆盖对应音效；
 *   后续拿到 Freesound/OpenGameArt 的 CC0 文件后，调用此方法即可一键替换合成音，
 *   无需改动播放逻辑。
 * - 不改动任何 UI 布局与杆法物理逻辑；保留原公共接口（processOutcomes /
 *   playSuccess / lastOutcomeTime / addCameraToListener）以兼容调用方。
 */

export class Sound {
  listener: AudioListener
  audioLoader: AudioLoader

  // 旧字段保留（兼容 container / controllerbase 直接赋值）
  lastOutcomeTime = -1
  lastOutcomeIndex = 0
  lastOutcomesRef: any[] | null = null
  private pottedSoundBalls = new Set<number>()
  private pottedSoundAt = new Map<number, number>()
  private lastAnyPotAt = -1e9

  /** 底层原生 AudioContext（复用 three AudioListener 的 context） */
  private actx: AudioContext
  /** 主增益链：masterGain(提升) → compressor(限幅) → destination */
  private masterGain?: GainNode
  private compressor?: DynamicsCompressorNode
  /** 室内混响（反馈延迟 + 低通，模拟球房空间感），dry/wet 混合到 destination */
  private reverbInput?: GainNode
  private reverbWet?: GainNode
  /** 空间监听者（PannerNode 共享的 listener） */
  private listener3d?: AudioListener

  /**
   * 力度量化档数（用于「按需合成 + 缓存」）。
   * 既保证「力度→音色/响度」连续过渡，又避免每帧都重新合成造成 CPU 抖动。
   * 档位之间增量足够小，人耳听不出跳变。
   */
  private static readonly INTENSITY_STEPS = 14

  /** 合成缓存：key(id#step) → buffer。按需合成，按力度档命中。 */
  private buffers: Map<string, AudioBuffer> = new Map()
  /** 外部 CC0 ogg 覆盖：id → buffer（优先于合成） */
  private external: Map<string, AudioBuffer> = new Map()

  loadAssets: boolean

  constructor(loadAssets) {
    this.loadAssets = loadAssets
    if (!loadAssets) {
      return
    }
    this.listener = new AudioListener()
    this.audioLoader = new AudioLoader()
    this.actx = this.listener.context as unknown as AudioContext
    this.listener3d = this.actx.listener as unknown as AudioListener
    this.setupMasterGain()
  }

  /**
   * 把「速度」归一化到 [0,1] 的力度系数，再映射到 [0, INTENSITY_STEPS-1] 量化档。
   * 不同事件用不同参考速度（击球更猛、球碰更脆），让各音效的力度区间贴合实际。
   */
  private intensityStep(speed: number, refSpeed: number): number {
    const k = Math.max(0, Math.min(1, speed / refSpeed))
    return Math.max(0, Math.min(Sound.INTENSITY_STEPS - 1, Math.round(k * (Sound.INTENSITY_STEPS - 1))))
  }

  /** 力度系数（连续 0..1），供合成函数塑形音色/响度 */
  private intensityK(step: number): number {
    return step / (Sound.INTENSITY_STEPS - 1)
  }

  /** 取/建一个按力度合成的音效 buffer（带轻量缓存） */
  private synth(
    id: string,
    step: number,
    gen: (n: number, sr: number, k: number) => Float32Array
  ): AudioBuffer | undefined {
    const key = id + "#" + step
    const hit = this.buffers.get(key)
    if (hit) return hit
    const sr = this.actx.sampleRate
    const n = Math.floor(0.9 * sr)
    const data = gen(n, sr, this.intensityK(step))
    const buf = this.actx.createBuffer(1, n, sr)
    buf.copyToChannel(data, 0)
    this.buffers.set(key, buf)
    return buf
  }

  /** 真实 CC0 素材覆盖接口：加载外部 ogg 并替换对应音效（id 见 prebuildSynthesized）。 */
  loadExternalOgg(id: string, url: string) {
    if (!this.loadAssets) return
    this.audioLoader.load(
      url,
      (buf: any) => {
        const ab = this.decodeToWebAudio(buf)
        if (ab) this.external.set(id, ab)
      },
      () => {},
      () => {}
    )
  }

  /** three 的 AudioBuffer → 原生 AudioBuffer（若已是原生则直用） */
  private decodeToWebAudio(buf: any): AudioBuffer | null {
    if (buf instanceof AudioBuffer) return buf
    try {
      // three 的 AudioBuffer 实为原生 AudioBuffer（AudioLoader 直接返回）
      return buf as AudioBuffer
    } catch {
      return null
    }
  }

  private setupMasterGain() {
    try {
      const ctx = this.actx
      this.masterGain = ctx.createGain()
      this.masterGain.gain.value = 1.0
      this.compressor = ctx.createDynamicsCompressor()
      this.compressor.threshold.value = -8
      this.compressor.knee.value = 12
      this.composer_safe()
      this.masterGain.connect(this.compressor)
      this.compressor.connect(ctx.destination)

      // 室内混响：短延迟反馈 + 低通，模拟球房的木头/台呢空间反射，
      // 让合成音不再「干瘪贴脸」，听感更接近真实台球桌。
      this.reverbInput = ctx.createGain()
      this.reverbInput.gain.value = 1.0
      this.reverbWet = ctx.createGain()
      this.reverbWet.gain.value = 0.22
      const delay = ctx.createDelay(1.0)
      delay.delayTime.value = 0.045 // ~45ms 早期反射
      const fb = ctx.createGain()
      fb.gain.value = 0.32 // 反馈量（空间大小感）
      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 2600 // 反射高频衰减，避免金属感
      this.reverbInput.connect(delay)
      delay.connect(lp)
      lp.connect(fb)
      fb.connect(delay) // 反馈回路
      lp.connect(this.reverbWet)
      this.reverbWet.connect(ctx.destination)
    } catch (e) {
      this.masterGain = undefined
      this.reverbInput = undefined
    }
  }

  private composer_safe() {
    if (!this.compressor) return
    this.compressor.ratio.value = 6
    this.compressor.attack.value = 0.003
    this.compressor.release.value = 0.12
  }

  /** 把一段已生成的 buffer 同时送入干声（主增益）与湿声（混响）链 */
  private sendToReverb(node: AudioNode) {
    if (this.reverbInput) node.connect(this.reverbInput)
  }

  addCameraToListener(camera) {
    camera.add(this.listener)
  }

  /**
   * 把监听者位置/朝向同步到相机（3D 空间音频随视角变化）。
   * 在容器每帧 update 调用；未提供相机时监听者留在原点朝上。
   */
  updateListener(camera) {
    if (!this.listener3d || !camera) return
    try {
      const v = new Vector3()
      camera.getWorldPosition(v)
      const L = this.listener3d as any
      if (L.positionX) {
        L.positionX.value = v.x
        L.positionY.value = v.y
        L.positionZ.value = v.z
      } else if (L.setPosition) {
        L.setPosition(v.x, v.y, v.z)
      }
      const dir = new Vector3()
      if (camera.getWorldDirection) camera.getWorldDirection(dir)
      if (L.forwardX) {
        L.forwardX.value = dir.x
        L.forwardY.value = dir.y
        L.forwardZ.value = dir.z
      } else if (L.setOrientation) {
        L.setOrientation(dir.x, dir.y, dir.z, 0, 1, 0)
      }
    } catch (e) {
      /* 监听者同步失败时忽略，不影响发声 */
    }
  }

  /**
   * 3D 空间播放：新建 BufferSource + PannerNode(HRTF) + Gain，连接到主增益链。
   * 每次播放都新建节点 → 天然支持多音效并发；声源位置取自发声球桌面坐标 (x, 0, y)。
   */
  private play3D(buffer: AudioBuffer, x: number, y: number, volume: number) {
    if (!this.loadAssets || !this.masterGain || !buffer) return
    const ctx = this.actx
    if (ctx.state === "suspended") {
      if (navigator?.userActivation?.hasBeenActive) ctx.resume()
      else return
    }
    const settings = Settings.get()
    if (!settings.sound || settings.volume <= 0) return
    const v = Math.max(0, Math.min(1, volume * settings.volume))
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const panner = ctx.createPanner()
    panner.panningModel = "HRTF"
    panner.distanceModel = "inverse"
    panner.refDistance = 1
    panner.maxDistance = 30
    panner.rolloffFactor = 1
    const L = this.listener3d as any
    if ((L as any).positionX) {
      panner.positionX.value = x
      panner.positionY.value = 0
      panner.positionZ.value = y
    } else {
      ;(panner as any).setPosition(x, 0, y)
    }
    const g = ctx.createGain()
    g.gain.value = v
    src.connect(panner)
    panner.connect(g)
    g.connect(this.masterGain)
    // 同时送入混响链（湿声），增强空间真实感
    if (this.reverbInput) g.connect(this.reverbInput)
    src.start()
  }

  /** 取音效 buffer：优先外部 CC0 覆盖，否则合成缓存 */
  private bufferOf(id: string): AudioBuffer | undefined {
    return this.external.get(id) ?? this.buffers.get(id)
  }

  /** 落袋：用按力度合成 pot 音（重击落袋更响更脆），按声源位置 3D 播放 */
  private pot(x: number, y: number, speed: number) {
    // 落袋速度通常较慢（约 0.2~3），旧 refSpeed=55 使力度映射永远落在最软档。
    // 改为 2.6，让轻重落袋在音色/响度上分明可辨。
    const step = this.intensityStep(speed, 2.6)
    const buf = this.synth("pot", step, (n, sr, k) => this.genPot(n, sr, k))
    if (!buf) return
    // 响度随力度连续：轻碰 0.5 → 重撞 1.0
    this.play3D(buf, x, y, 0.5 + this.intensityK(step) * 0.5)
  }

  outcomeToSound(outcome) {
    const pos = outcome.ballA?.pos
    const x = pos ? pos.x : 0
    const y = pos ? pos.y : 0
    if (outcome.type === "Collision") {
      // 球速实际量级约 0~5.4（maxPower=160R≈5.24）；旧 refSpeed=60 使力度映射
      // 永远落在最软档，碰撞声听不出力度差异且偏软。改为 5，让轻碰≈低档、大力对撞≈高档。
      const step = this.intensityStep(outcome.incidentSpeed, 5)
      const buf = this.synth("collision", step, (n, sr, k) => this.genCollision(n, sr, k))
      if (buf) this.play3D(buf, x, y, 0.35 + this.intensityK(step) * 0.65)
    }
    if (outcome.type === "Pot") {
      const ballId = outcome.ballA?.id
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now()
      if (now - this.lastAnyPotAt < 250) return
      if (ballId !== undefined) {
        const last = this.pottedSoundAt.get(ballId) ?? -1e9
        if (this.pottedSoundBalls.has(ballId) || now - last < 250) return
        this.pottedSoundBalls.add(ballId)
        this.pottedSoundAt.set(ballId, now)
      }
      this.lastAnyPotAt = now
      this.pot(x, y, outcome.incidentSpeed)
    }
    if (outcome.type === "Cushion") {
      // 碰库声音此前是构建时固定的单一缓冲，音色不随力度变化、音量也被
      // incidentSpeed/40 早早饱和，导致「碰库声音没按碰撞力度调整」。
      // 现改为按力度合成：轻碰沉闷柔软、重撞明亮短促；refSpeed=6 覆盖玩法区间。
      const step = this.intensityStep(outcome.incidentSpeed, 6)
      const buf = this.synth("cushion", step, (n, sr, kk) => this.genCushion(n, sr, kk))
      if (buf) this.play3D(buf, x, y, 0.3 + this.intensityK(step) * 0.7)
    }
    if (outcome.type === "Hit") {
      // 击球：按力度连续合成（取消三档硬分档），音色+响度随速度平滑变化。
      // 球速实际量级约 0~5.4，旧 refSpeed=70 使力度映射永远落在最软档；改为 5.2。
      const step = this.intensityStep(outcome.incidentSpeed, 5.2)
      const k = this.intensityK(step)
      const buf = this.synth("cue", step, (n, sr, kk) => this.genCue(n, sr, kk))
      if (buf) this.play3D(buf, x, y, 0.45 + k * 0.55)
    }
    if (outcome.type === "Break") {
      // 开球：最大力度重击球堆，音色取最高档
      const step = Sound.INTENSITY_STEPS - 1
      const buf = this.synth("break", step, (n, sr, kk) => this.genBreak(n, sr, kk))
      if (buf) this.play3D(buf, x, y, 1.0)
    }
  }

  processOutcomes(outcomes) {
    if (outcomes !== this.lastOutcomesRef || this.lastOutcomeIndex > outcomes.length) {
      this.lastOutcomeIndex = 0
      this.lastOutcomesRef = outcomes
      this.lastOutcomeTime = -1
      this.pottedSoundBalls.clear()
      this.pottedSoundAt.clear()
    }
    for (let i = this.lastOutcomeIndex; i < outcomes.length; i++) {
      const outcome = outcomes[i]
      if (outcome.timestamp < this.lastOutcomeTime) {
        this.lastOutcomeTime = -1
      }
      if (outcome.timestamp > this.lastOutcomeTime) {
        this.lastOutcomeTime = outcome.timestamp
        this.lastOutcomeIndex = i + 1
        this.outcomeToSound(outcome)
      }
    }
  }

  playSuccess(pitch = 0) {
    // 成功：用中等力度击球音色做一段提示（仍 3D，但放原点）
    const buf = this.synth("cue", Math.floor(Sound.INTENSITY_STEPS / 2), (n, sr, k) => this.genCue(n, sr, k))
    if (!buf) return
    this.play3D(buf, 0, 0, 0.5)
  }

  /* ---------------- 程序化合成（生成单声道 Float32Array） ----------------
   * 设计目标：用「噪声瞬态 + 带通共振体 + 多谐波 + 空间混响」重建真实台球声，
   * 而非单纯正弦波。关键经验：
   *  - 真实台球/皮头/木腔的"发声"是宽频瞬态（噪声），再由物体固有频率（共振）染色，
   *    衰减极快（几十毫秒）。所以每段都用 exp 衰减包络 + 带通滤波塑造音色。
   *  - 球-球碰撞 ≈ 酚醛树脂球的清脆"咔"（高频 2-4kHz 共振，~25ms 衰减）；
   *  - 球杆击球 = 皮头脆响(高频噪声瞬态) + 球体低频"咚"(150-250Hz) + 木腔余响；
   *  - 库边 = 橡胶"噗"（中低频 200-500Hz，带通略窄、衰减略长）；
   *  - 落袋 = 撞袋口(中频噪声) + 低频"咚"滚落(80-160Hz，长衰减)；
   *  所有音经 masterGain 后还会过一遍室内混响（见 setupMasterGain）。
   */

  /** 单极点带通共振：把白噪声塑成某固有频率的"撞击体"音色 */
  private resonate(
    src: Float32Array,
    sr: number,
    freq: number,
    q: number
  ): Float32Array {
    const out = new Float32Array(src.length)
    const w0 = (2 * Math.PI * freq) / sr
    const r = Math.exp(-w0 / (2 * q)) // 衰减值
    const cosw = Math.cos(w0)
    const sinw = Math.sin(w0)
    // 二阶谐振器状态
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    const a0 = 1
    const a1 = -2 * r * cosw
    const a2 = r * r
    // 归一化增益（让不同 freq/q 输出量级接近）
    const b0 = (1 - r) * Math.sqrt(1 - 1 / (4 * q * q))
    for (let i = 0; i < src.length; i++) {
      const x0 = src[i]
      const y0 = b0 * (x0 - x2) - a1 * y1 - a2 * y2
      out[i] = y0
      x2 = x1; x1 = x0
      y2 = y1; y1 = y0
    }
    return out
  }

  /** 生成一段指数衰减的噪声瞬态（台球声的主体） */
  private noiseBurst(n: number, sr: number, tau: number): Float32Array {
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] = (Math.random() * 2 - 1) * Math.exp(-t / tau)
    }
    return out
  }

  /**
   * 球杆击球：皮头脆响(高频噪声瞬态) + 球体低频"咚"(木腔共鸣) + 轻微中频木响。
   * 力度系数 k∈[0,1] 连续塑形：
   *  - 越重(k↑)：皮头脆响频率更高更亮、整体衰减更短（更"硬"更"啪"）、瞬态占比更大；
   *  - 越轻(k↓)：频率下移更闷、衰减更长（更"软"）。
   */
  private genCue(n: number, sr: number, k: number): Float32Array {
    const out = new Float32Array(n)
    // 皮头脆响频率：轻 2.6k → 重 3.8k（更亮）
    const tipFreq = 2600 + k * 1200
    // 整体衰减时长：轻 0.9s（软、拖尾长）→ 重 0.32s（硬、短促）
    const decay = 0.32 + (1 - k) * 0.58
    const tip = this.resonate(
      this.noiseBurst(n, sr, decay * 0.05),
      sr,
      tipFreq,
      6
    )
    for (let i = 0; i < n; i++) out[i] += tip[i] * (0.7 + k * 0.4)
    // 球体低频"咚"：轻 200Hz（闷）→ 重 150Hz（低沉），衰减略长
    const fLow = 200 - k * 50
    const low = this.resonate(
      this.noiseBurst(n, sr, decay * 0.5),
      sr,
      Math.max(90, fLow),
      4
    )
    for (let i = 0; i < n; i++) out[i] += low[i] * (0.45 + (1 - k) * 0.2)
    // 中频木响 ~520Hz，给一点"实体感"（重击略增强）
    const mid = this.resonate(
      this.noiseBurst(n, sr, decay * 0.18),
      sr,
      520,
      5
    )
    for (let i = 0; i < n; i++) out[i] += mid[i] * 0.3
    // 力度包络总衰减
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] *= Math.exp(-t / decay)
    }
    return this.normalize(out)
  }

  /**
   * 球-球碰撞：酚醛树脂球的清脆"咔"。力度 k 连续塑形：
   *  - 重撞(k↑)：主体频率上移更亮(2.6k→3.4k)、高频"叮"更突出、衰减更短（更硬脆）；
   *  - 轻碰(k↓)：频率下移更闷(2.6k→2.0k)、衰减略长。
   */
  private genCollision(n: number, sr: number, k: number): Float32Array {
    const out = new Float32Array(n)
    const bodyFreq = 2000 + k * 1400
    const body = this.resonate(
      this.noiseBurst(n, sr, 0.010 + (1 - k) * 0.006),
      sr,
      bodyFreq,
      9
    )
    for (let i = 0; i < n; i++) out[i] += body[i] * 0.85
    // 高频"叮"：重撞更亮更突出
    const tick = this.resonate(
      this.noiseBurst(n, sr, 0.005 + (1 - k) * 0.003),
      sr,
      4000 + k * 1200,
      12
    )
    for (let i = 0; i < n; i++) out[i] += tick[i] * (0.25 + k * 0.35)
    // 整体衰减：轻 35ms → 重 22ms
    const tau = 0.022 + (1 - k) * 0.013
    for (let i = 0; i < n; i++) out[i] *= Math.exp(-i / sr / tau)
    return this.normalize(out)
  }

  /**
   * 库边：橡胶"噗/嗒"（中低频共振 + 橡胶摩擦高频）。
   * 力度系数 k∈[0,1] 连续塑形（此前是构建时固定的单一缓冲，音色不随力度变化）：
   *  - 轻碰(k↓)：主体频率更低、衰减更长 → 沉闷柔软的"噗"；
   *  - 重撞(k↑)：主体频率上移更亮、摩擦高频更突出、衰减更短 → 清脆短促的"嗒"。
   */
  private genCushion(n: number, sr: number, k: number): Float32Array {
    const out = new Float32Array(n)
    const bodyFreq = 280 + k * 360
    const body = this.resonate(
      this.noiseBurst(n, sr, 0.03),
      sr,
      bodyFreq,
      5
    )
    for (let i = 0; i < n; i++) out[i] += body[i] * (0.8 - k * 0.1)
    // 摩擦高频：重撞更突出（明亮感）
    const fricFreq = 900 + k * 1000
    const fric = this.resonate(
      this.noiseBurst(n, sr, 0.018),
      sr,
      fricFreq,
      8
    )
    for (let i = 0; i < n; i++) out[i] += fric[i] * (0.15 + k * 0.35)
    // 整体衰减：轻 75ms（拖尾长） → 重 30ms（短促）
    const tau = 0.075 - k * 0.045
    for (let i = 0; i < n; i++) out[i] *= Math.exp(-i / sr / tau)
    return this.normalize(out)
  }

  /**
   * 落袋：撞袋口(中频噪声) + 低频"咚"滚落(长衰减)。
   * k 连续塑形：重撞袋口更亮更响、滚落更短促；轻碰更闷更长。
   */
  private genPot(n: number, sr: number, k: number): Float32Array {
    const out = new Float32Array(n)
    // 撞袋口的"咔"（轻 1.4k → 重 2.2k）
    const clack = this.resonate(
      this.noiseBurst(n, sr, 0.016 + (1 - k) * 0.008),
      sr,
      1400 + k * 800,
      8
    )
    for (let i = 0; i < n; i++) out[i] += clack[i] * (0.55 + k * 0.25)
    // 落入袋腔的低频"咚"（~120Hz，长衰减模拟在袋里滚落）
    const thud = this.resonate(
      this.noiseBurst(n, sr, 0.10 + (1 - k) * 0.06),
      sr,
      120,
      3
    )
    for (let i = 0; i < n; i++) out[i] += thud[i] * 0.6
    for (let i = 0; i < n; i++) out[i] *= Math.exp(-i / sr / (0.07 + (1 - k) * 0.04))
    return this.normalize(out)
  }

  /** 球滚动：窄带噪声持续音（短促一段，模拟滚动摩擦，闷而柔） */
  private genRoll(n: number, sr: number): Float32Array {
    const out = new Float32Array(n)
    const len = Math.floor(sr * 0.5)
    let last = 0
    for (let i = 0; i < len; i++) {
      const t = i / sr
      const env = Math.exp(-t / 0.18)
      const w = Math.random() * 2 - 1
      last = last * 0.6 + w * 0.4 // 低通，模拟滚动的闷响
      out[i] += last * env * 0.7
    }
    return this.normalize(out)
  }

  /**
   * 开球：重击球堆——多段清脆碰撞丛集 + 更强低频"轰"。
   * 开球本就是最大力度事件，k 默认取高值；仍保留 k 形参以便与统一接口一致。
   */
  private genBreak(n: number, sr: number, k: number): Float32Array {
    const out = new Float32Array(n)
    // 多球连续碰撞：几簇不同高频的"咔"叠加（用确定性抖动模拟球堆炸开）
    const freqs = [2400, 3000, 1900, 3500]
    for (let j = 0; j < freqs.length; j++) {
      const off = Math.floor(sr * 0.006 * j) // 每簇错开几毫秒
      const burst = this.noiseBurst(n - off, sr, 0.014)
      const body = this.resonate(burst, sr, freqs[j], 9)
      for (let i = 0; i < body.length; i++) out[i + off] += body[i] * 0.5
    }
    // 低频"轰"（重力度 → 略低更沉）
    const boom = this.resonate(
      this.noiseBurst(n, sr, 0.09),
      sr,
      145 - k * 20,
      3
    )
    for (let i = 0; i < n; i++) out[i] += boom[i] * 0.7
    for (let i = 0; i < n; i++) out[i] *= Math.exp(-i / sr / 0.12)
    return this.normalize(out)
  }

  private normalize(a: Float32Array): Float32Array {
    let peak = 0
    for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]))
    if (peak > 0) {
      const g = 0.95 / peak
      for (let i = 0; i < a.length; i++) a[i] *= g
    }
    return a
  }
}
