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
  /** 空间监听者（PannerNode 共享的 listener） */
  private listener3d?: AudioListener

  /** 合成的 AudioBuffer 缓存：id → buffer */
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
    this.prebuildSynthesized()
  }

  /** 预生成并缓存全部合成音效 AudioBuffer */
  private prebuildSynthesized() {
    const sr = this.actx.sampleRate
    const mk = (gen: (n: number, sr: number) => Float32Array) => {
      const n = Math.floor(0.9 * sr)
      const data = gen(n, sr)
      const buf = this.actx.createBuffer(1, n, sr)
      buf.copyToChannel(data, 0)
      return buf
    }
    this.buffers.set("cueSoft", mk((n, sr) => this.genCue(n, sr, 0.5, 0.55)))
    this.buffers.set("cueMid", mk((n, sr) => this.genCue(n, sr, 0.8, 0.8)))
    this.buffers.set("cueHard", mk((n, sr) => this.genCue(n, sr, 1.0, 1.1)))
    this.buffers.set("collision", mk((n, sr) => this.genCollision(n, sr)))
    this.buffers.set("cushion", mk((n, sr) => this.genCushion(n, sr)))
    this.buffers.set("pot", mk((n, sr) => this.genPot(n, sr)))
    this.buffers.set("roll", mk((n, sr) => this.genRoll(n, sr)))
    this.buffers.set("break", mk((n, sr) => this.genBreak(n, sr)))
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
    } catch (e) {
      this.masterGain = undefined
    }
  }

  private composer_safe() {
    if (!this.compressor) return
    this.compressor.ratio.value = 6
    this.compressor.attack.value = 0.003
    this.compressor.release.value = 0.12
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
    src.start()
  }

  /** 取音效 buffer：优先外部 CC0 覆盖，否则合成缓存 */
  private bufferOf(id: string): AudioBuffer | undefined {
    return this.external.get(id) ?? this.buffers.get(id)
  }

  /** 落袋：用合成 pot 音（重击落袋更响），按声源位置 3D 播放 */
  private pot(x: number, y: number, speed: number) {
    const buf = this.bufferOf("pot")
    if (!buf) return
    this.play3D(buf, x, y, Math.min(1, 0.6 + speed * 0.08))
  }

  outcomeToSound(outcome) {
    const pos = outcome.ballA?.pos
    const x = pos ? pos.x : 0
    const y = pos ? pos.y : 0
    if (outcome.type === "Collision") {
      const buf = this.bufferOf("collision")
      if (buf) this.play3D(buf, x, y, Math.min(1, 0.3 + outcome.incidentSpeed / 60))
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
      const buf = this.bufferOf("cushion")
      if (buf) this.play3D(buf, x, y, Math.min(1, 0.3 + outcome.incidentSpeed / 40))
    }
    if (outcome.type === "Hit") {
      // 击球：按力度分 3 档
      const speed = outcome.incidentSpeed
      const id = speed < 25 ? "cueSoft" : speed < 55 ? "cueMid" : "cueHard"
      const buf = this.bufferOf(id)
      if (buf) this.play3D(buf, x, y, Math.min(1, 0.5 + speed / 120))
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
    // 成功：用 cueMid 音色做一段上扬提示（仍 3D，但放原点）
    const buf = this.bufferOf("cueMid")
    if (!buf) return
    this.play3D(buf, 0, 0, 0.5)
  }

  /* ---------------- 程序化合成（生成单声道 Float32Array） ---------------- */

  /** 球杆击球：噪声冲击 + 低频"咚"，3 档力度（soft/mid/hard） */
  private genCue(n: number, sr: number, peak: number, decay: number): Float32Array {
    const out = new Float32Array(n)
    const len = Math.floor(sr * 0.25)
    // 噪声冲击（杆头触球）
    for (let i = 0; i < len; i++) {
      const t = i / sr
      const env = Math.exp(-t / (decay * 0.05))
      out[i] += (Math.random() * 2 - 1) * env * peak
    }
    // 低频"砰"
    const f = 160 * (1 + peak * 0.3)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / decay) * peak * 0.5
    }
    return this.normalize(out)
  }

  private genCollision(n: number, sr: number): Float32Array {
    const out = new Float32Array(n)
    const len = Math.floor(sr * 0.12)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      out[i] += (Math.random() * 2 - 1) * Math.exp(-t / 0.02) * 0.9
    }
    const f = 420
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.03) * 0.4
    }
    return this.normalize(out)
  }

  private genCushion(n: number, sr: number): Float32Array {
    const out = new Float32Array(n)
    const len = Math.floor(sr * 0.16)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      out[i] += (Math.random() * 2 - 1) * Math.exp(-t / 0.03) * 0.8
    }
    const f = 220
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.04) * 0.5
    }
    return this.normalize(out)
  }

  private genPot(n: number, sr: number): Float32Array {
    const out = new Float32Array(n)
    const len = Math.floor(sr * 0.22)
    // 球落袋："咔哒"撞击 + 低频滚入
    for (let i = 0; i < len; i++) {
      const t = i / sr
      out[i] += (Math.random() * 2 - 1) * Math.exp(-t / 0.015) * 1.0
    }
    const f = 300
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.05) * 0.6
    }
    return this.normalize(out)
  }

  /** 球滚动：窄带噪声持续音（短促一段，模拟滚动摩擦） */
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

  /** 开球：重击球堆——多段碰撞叠加 + 更强低频 */
  private genBreak(n: number, sr: number): Float32Array {
    const out = new Float32Array(n)
    const len = Math.floor(sr * 0.35)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      out[i] += (Math.random() * 2 - 1) * Math.exp(-t / 0.03) * 1.0
    }
    const f = 130
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.1) * 0.7
    }
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
