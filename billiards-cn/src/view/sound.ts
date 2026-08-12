import { AudioListener, Audio, AudioLoader, MathUtils } from "three"
import { Settings } from "../utils/settings"

export class Sound {
  listener: AudioListener
  audioLoader: AudioLoader

  ballcollision
  cue
  cushion
  pot
  potLight
  potMid
  potHeavy
  success

  // v1.2.5：-1 表示「本杆尚未记录最大时间戳」，确保每杆第一帧（时间戳=0）也能出声。
  lastOutcomeTime = -1
  lastOutcomeIndex = 0
  lastOutcomesRef: any[] | null = null
  /**
   * v1.2.9 #F1：本杆已播放过进袋音效的球 id 集合。
   * 进袋音效按「球」去重——同一颗球在一杆内只播一次，避免高速（力度 100%）
   * 入袋时因物理步进 / 回放重算而重复触发 pot 音效。每杆（outcome 引用变化）重置。
   */
  private pottedSoundBalls = new Set<number>()
  /**
   * v1.2.17：进袋音效的「同球最短间隔」兜底（毫秒）。
   * 即便回放重算 / 重新模拟导致 outcome 数组被整体重建、pottedSoundBalls 被清空，
   * 同一颗球在 120ms 内的重复进袋音仍会被拦截，彻底杜绝大力进袋时「响很多次」。
   */
  private pottedSoundAt = new Map<number, number>()
  loadAssets

  /** 主增益节点：突破 three.js 单次 Audio 1.0 音量上限，整体提升听感 */
  masterGain?: GainNode
  /** 限幅压缩，避免 masterGain 过大时破音 */
  private compressor?: DynamicsCompressorNode
  /** 预生成的白噪声 buffer，用于合成进袋「咔哒」声 */
  private noiseBuffer?: AudioBuffer

  constructor(loadAssets) {
    this.loadAssets = loadAssets
    if (!loadAssets) {
      return
    }
    this.listener = new AudioListener()
    this.audioLoader = new AudioLoader()

    this.ballcollision = new Audio(this.listener)
    this.load("sounds/ballcollision.ogg", this.ballcollision)

    this.cue = new Audio(this.listener)
    this.load("sounds/cue.ogg", this.cue)

    this.cushion = new Audio(this.listener)
    this.load("sounds/cushion.ogg", this.cushion)

    // 兼容旧 pot.ogg；新增三档力度版本（轻/中/重）
    this.pot = new Audio(this.listener)
    this.load("sounds/pot.ogg", this.pot)
    this.potLight = new Audio(this.listener)
    this.load("sounds/pot_light.ogg", this.potLight)
    this.potMid = new Audio(this.listener)
    this.load("sounds/pot_mid.ogg", this.potMid)
    this.potHeavy = new Audio(this.listener)
    this.load("sounds/pot_heavy.ogg", this.potHeavy)

    this.success = new Audio(this.listener)
    this.load("sounds/success.ogg", this.success)

    this.setupMasterGain()
  }

  /**
   * 插入主增益链：listener 输入 → masterGain(提升) → 压缩限幅 → 输出。
   *
   * 原实现 audio.setVolume(min(1, volume*vol*BOOST))，受限 three 单次 Audio
   * 增益上限 ≈1.0，即使 BOOST=1.8 也常被钳到 1.0，手机扬声器仍偏轻。
   * 现在把整体音量提升放到 masterGain（2.2x），并用压缩器防止削顶破音，
   * 进袋等音效明显更响、更清脆。
   */
  private setupMasterGain() {
    try {
      const ctx = this.listener.context as unknown as AudioContext
      const listenerInput = this.listener.getInput() as unknown as GainNode
      this.masterGain = ctx.createGain()
      this.masterGain.gain.value = 2.2
      this.compressor = ctx.createDynamicsCompressor()
      this.compressor.threshold.value = -8
      this.compressor.knee.value = 12
      this.compressor.ratio.value = 6
      this.compressor.attack.value = 0.003
      this.compressor.release.value = 0.12
      // 解除 listener 输入到 destination 的默认直连，改走主增益链
      try {
        listenerInput.disconnect()
      } catch (e) {
        /* 未连接时忽略 */
      }
      listenerInput.connect(this.masterGain)
      this.masterGain.connect(this.compressor)
      this.compressor.connect(ctx.destination)
      this.noiseBuffer = this.makeNoiseBuffer(ctx)
    } catch (e) {
      // 个别环境不支持时退回默认链路
      this.masterGain = undefined
    }
  }

  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.3)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1
    }
    return buf
  }

  addCameraToListener(camera) {
    camera.add(this.listener)
  }

  load(path, audio) {
    this.audioLoader.load(
      path,
      (buffer) => {
        audio.setBuffer(buffer)
        audio.setLoop(false)
      },
      (_) => {},
      (_) => {}
    )
  }

  play(audio: Audio, volume, detune = 0) {
    if (this.loadAssets) {
      // 设置面板中的音效开关与音量（提升交给 masterGain）
      const settings = Settings.get()
      if (!settings.sound || settings.volume <= 0) {
        return
      }
      const context = this.listener.context
      if (context?.state === "suspended") {
        if (navigator?.userActivation?.hasBeenActive) {
          context.resume()
        }
        // v1.2.11 #F1：resume 后不早退，仍尝试播放本事件。
        // 原先 suspended 时直接 return 会丢弃本次声音——电脑回合无新手势时
        // 尤为明显（AudioContext 在用户首次手势后已 running，但部分 WebView
        // 会在后台/切换时重新 suspend），导致击球/进袋音效丢失。
      }
      const v = Math.min(1, volume * settings.volume)
      audio.setVolume(v)
      if (audio.isPlaying) {
        audio.stop()
      }
      audio.play(MathUtils.randFloat(0, 0.01))
      audio.setDetune(detune)
    }
  }

  /**
   * 根据入袋瞬间的球速分档选择中袋音效与音量。
   *
   * incidentSpeed 单位 m/s。经验范围：
   *   轻推 1~2；正常 2~4；重击 4 以上。
   * 这里把档位拉宽一点，避免边界值来回跳档。
   */
  private pickPotBySpeed(incidentSpeed: number) {
    if (incidentSpeed < 2.0) {
      return { audio: this.potLight, vol: 0.65, detune: 600 }
    }
    if (incidentSpeed < 4.0) {
      return { audio: this.potMid, vol: 0.85, detune: 0 }
    }
    return { audio: this.potHeavy, vol: 1.0, detune: -600 }
  }

  /**
   * 程序合成「真实」进袋音效（item 5）。
   *
   * 用白噪声爆发经带通滤波 + 快速指数衰减包络，模拟木质/象牙球撞袋口的
   * 「咔哒」碰撞声；再叠一段低频三角波「咚」增加木质厚度。
   * 按入袋球速分轻/中/重三档（共振频率与衰减不同）。完全离线，无外部文件。
   */
  playPotSynth(incidentSpeed: number) {
    if (!this.loadAssets || !this.listener || !this.noiseBuffer) return
    const settings = Settings.get()
    if (!settings.sound || settings.volume <= 0) return
    const ctx = this.listener.context as unknown as AudioContext
    if (ctx.state === "suspended") {
      if (navigator?.userActivation?.hasBeenActive) {
        ctx.resume()
      } else {
        return
      }
    }
    const now = ctx.currentTime

    // 分档：轻 / 中 / 重
    let freq: number
    let decay: number
    let peak: number
    if (incidentSpeed < 2.0) {
      freq = 1100
      decay = 0.1
      peak = 0.85
    } else if (incidentSpeed < 4.0) {
      freq = 2000
      decay = 0.14
      peak = 1.0
    } else {
      freq = 3200
      decay = 0.18
      peak = 1.0
    }
    const peakGain = Math.max(0.0002, peak * settings.volume)

    // 噪声「咔哒」
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = freq
    bp.Q.value = 2.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peakGain, now + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay)

    // 低频「咚」增加木质厚度
    const osc = ctx.createOscillator()
    osc.type = "triangle"
    osc.frequency.setValueAtTime(freq * 0.5, now)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.3, now + decay)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, now)
    og.gain.exponentialRampToValueAtTime(peakGain * 0.5, now + 0.004)
    og.gain.exponentialRampToValueAtTime(0.0001, now + decay * 0.85)

    const dest = this.listener.getInput()
    src.connect(bp)
    bp.connect(g)
    g.connect(dest as unknown as AudioNode)
    osc.connect(og)
    og.connect(dest as unknown as AudioNode)

    src.start(now)
    src.stop(now + decay + 0.02)
    osc.start(now)
    osc.stop(now + decay + 0.02)
  }

  outcomeToSound(outcome) {
    if (outcome.type === "Collision") {
      this.play(
        this.ballcollision,
        outcome.incidentSpeed / 50,
        outcome.incidentSpeed * 5
      )
    }
    if (outcome.type === "Pot") {
      // v1.2.9 #F1：同一颗球在一杆内只播一次进袋音效（去重）。
      // 高速入袋（力度 100%）时，物理步进 / 回放重算可能让同一颗球产生多次
      // Pot 事件，这里按球 id 拦截重复播放，保留「每颗球一次」的自然听感。
      const ballId = outcome.ballA?.id
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now())
      if (ballId !== undefined) {
        // 双保险：本杆去重集合 + 短时间窗兜底，杜绝大力进袋时进袋音重复响。
        const last = this.pottedSoundAt.get(ballId) ?? -1e9
        if (this.pottedSoundBalls.has(ballId) || now - last < 120) {
          return
        }
        this.pottedSoundBalls.add(ballId)
        this.pottedSoundAt.set(ballId, now)
      }
      // 进袋改用真实录音素材（item 3：替换原先偏弱的合成音）。
      // 仍按入袋球速分轻/中/重三档，并加随机变调，避免重复感。
      const pick = this.pickPotBySpeed(outcome.incidentSpeed)
      this.play(pick.audio, pick.vol, pick.detune + MathUtils.randFloat(-120, 120))
    }
    if (outcome.type === "Cushion") {
      this.play(this.cushion, outcome.incidentSpeed / 40)
    }
    if (outcome.type === "Hit") {
      this.play(this.cue, outcome.incidentSpeed / 18)
    }
    if (outcome.type === "Proximity") {
      // tbd
    }
  }

  processOutcomes(outcomes) {
    // 仅在「数组引用变化」（新对局）或「长度回缩」（异常）时从头扫描。
    if (
      outcomes !== this.lastOutcomesRef ||
      this.lastOutcomeIndex > outcomes.length
    ) {
      this.lastOutcomeIndex = 0
      this.lastOutcomesRef = outcomes
      // 新的一杆：把时间戳上限复位为 -1（无上限），否则会沿用上一杆的最大值。
      this.lastOutcomeTime = -1
      // v1.2.9 #F1：新的一杆，重置进袋音效去重集合。
      this.pottedSoundBalls.clear()
      this.pottedSoundAt.clear()
    }
    for (let i = this.lastOutcomeIndex; i < outcomes.length; i++) {
      const outcome = outcomes[i]
      // v1.2.5：每杆开始时 table.hit() 会把模拟时钟 this.time 归零，
      // 因此本杆 outcome 的时间戳会小于上一杆记录的最大时间戳。
      // 检测到「时间戳回退」即视为新的一杆，重置上限，
      // 否则本杆（尤其电脑回合首帧的进袋）的声音会被整体跳过。
      if (outcome.timestamp < this.lastOutcomeTime) {
        this.lastOutcomeTime = -1
      }
      if (outcome.timestamp > this.lastOutcomeTime) {
        this.lastOutcomeTime = outcome.timestamp
        this.lastOutcomeIndex = i + 1
        this.outcomeToSound(outcome)
        // v1.2.11 #F1：去掉 break，同帧多事件（碰撞+库边+进袋）一并播放。
        // 原先每帧只播 1 个 outcome → 同帧多碰撞/进袋的音效被推迟到后续帧，
        // 表现为「延迟」；电脑回合因物理步进快、多事件密集，延迟尤其明显。
        // 去重仍由 pottedSoundBalls 保证同球不重复进袋音。
      }
    }
  }

  playSuccess(pitch) {
    this.play(this.success, 0.1, pitch * 100 - 2200)
  }
}
