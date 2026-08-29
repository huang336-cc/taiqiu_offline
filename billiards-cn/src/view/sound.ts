import { AudioListener, AudioLoader, Vector3 } from "three"
import { Settings } from "../utils/settings"

/**
 * 音效系统（v1.3.56）。
 *
 * 音源：dist/sfx/ 下的 **Freesound 真实录音**，不再使用程序化合成。
 *
 * 为什么换回来
 * ------------
 * v1.0.9 曾用真实录音，但那些素材是「未剪辑的现场原始录音」，直接播有明显
 * 缺陷（pot_mid.ogg 前 0.87s 死寂、pot_heavy.ogg 7 秒长音里压了 5 次落袋），
 * 于是 v1.3.20 改成了程序化合成。合成音虽然干净，但只有 2 个二阶谐振器，
 * 频谱上至多 2 个共振峰、衰减是单指数——实测 dB 域衰减非线性仅 1.21dB，
 * 而真实录音达到 3.14dB（多模态叠加的自然折线），听感就是「电子味」。
 *
 * v1.3.55 的做法：不是简单换回原始 ogg，而是先由 tools/sounds/build.py
 * 把原始录音切成「单事件干净片段」并做 A 加权等响度对齐，再由本文件播放。
 * 既保留真实录音的全部频谱细节，又没有前导静音和拖尾。
 *
 * 保留 v1.3.20 的架构成果
 * ----------------------
 * - 3D 空间音频：每次播放新建 BufferSource + PannerNode(HRTF)，声源位置取自发声球
 * - 室内混响（反馈延迟 + 低通）、masterGain + compressor 限幅
 * - 力度连续映射（音量随速度平滑变化，不再是固定单一缓冲）
 * - 落袋去抖动（同一球 250ms 内不重复发声）
 *
 * v1.3.20 保留至今
 * --------------
 * - 多变体轮转：同类事件有多条真实录音，依次轮换，消除「机关枪效应」
 * - 力度分档：按实测频谱质心把变体分成轻/中/重档（见 LIB 注释）
 * - 播放抖动：每条录音播放时随机微调速率与增益，模拟真实世界的不可重复性
 *
 * v1.3.56 新增
 * ------------
 * - 变体从 15 条扩充到 26 条，其中落袋从 7 条到 15 条
 * - 补采的落袋素材质心低至 629Hz，补上了原先只有 1622Hz 以上、「没有闷响
 *   落袋」的空白；15 条落袋按质心均分三档，每档 5 条轮转
 * - 变体稀少的类别（cushion 仅 2 条且同源于同一次撞击）单独加大播放抖动
 * - 挑素材时新增峰均比判据：峰均比过高的素材，其响度上限由峰值锁死，
 *   拉增益只会削波然后被峰值保护原样拉回，这类素材直接弃用（见 build.py）
 */

/** 音效库中的一个真实录音变体 */
interface Variant {
  /** 相对 index.html 的路径 */
  file: string
  /** 力度档：0 轻 / 1 中 / 2 重。同档内多个变体轮转播放 */
  tier: number
}

/**
 * 真实录音音效库（由 tools/sounds/build.py 生成到 dist/sfx/）。
 *
 * tier 不是拍脑袋定的，而是按素材实测的**频谱质心**划分。质心高 = 高频丰富
 * = 听感"脆"，对应球速快、撞击猛的那一次；质心低 = 闷，对应轻轻滚进去。
 * 每行注释里的 Hz 就是该变体的实测质心，改素材后应重新跑 build.py 核对。
 *
 *   collision  闷 1142Hz→轻 / 2425、2542Hz→中 / 脆 4464Hz→重
 *   pot        15 条按质心 629→4390Hz 均分成三档，每档 5 条轮转
 *  cue/cushion 只有一次击球/撞击的素材，靠多条补采 + 加大抖动弥补
 *
 * v1.3.56 补采：v1.3.55 的 pot 变体质心全在 1622Hz 以上，缺"闷"的落袋
 * （球慢慢滚进袋、没有猛烈撞击的那种）。fs763601 一条录音切出 105 个事件，
 * 按质心对数均匀取 8 条，把落袋音色覆盖拉到 629~3518Hz。
 */
const LIB: { [cat: string]: Variant[] } = {
  collision: [
    { file: "sfx/collision_soft.ogg", tier: 0 }, // 1142Hz
    { file: "sfx/collision_clack.ogg", tier: 1 }, // 2425Hz
    { file: "sfx/collision_mid.ogg", tier: 1 }, // 2542Hz
    { file: "sfx/collision_hard.ogg", tier: 2 }, // 4464Hz
  ],
  cushion: [
    { file: "sfx/cushion_tight.ogg", tier: 1 }, // 563Hz
    { file: "sfx/cushion_full.ogg", tier: 1 }, // 563Hz（同源，更长的裁剪）
  ],
  cue: [
    { file: "sfx/cue_tight.ogg", tier: 1 }, // 2114Hz
    { file: "sfx/cue_full.ogg", tier: 1 }, // 2114Hz（同源，更长的裁剪）
    { file: "sfx/cue_s1.ogg", tier: 1 }, // 2639Hz
    { file: "sfx/cue_s2.ogg", tier: 1 }, // 3486Hz
  ],
  pot: [
    // 轻档（闷 629~1562Hz）：球慢慢滚进袋，几乎没有撞击，高频很少
    { file: "sfx/pot_sink_1.ogg", tier: 0 }, //  629Hz
    { file: "sfx/pot_sink_2.ogg", tier: 0 }, //  868Hz
    { file: "sfx/pot_sink_3.ogg", tier: 0 }, // 1022Hz
    { file: "sfx/pot_sink_4.ogg", tier: 0 }, // 1312Hz
    { file: "sfx/pot_sink_5.ogg", tier: 0 }, // 1562Hz
    // 中档（1622~2838Hz）
    { file: "sfx/pot_light.ogg", tier: 1 }, // 1622Hz
    { file: "sfx/pot_sink_6.ogg", tier: 1 }, // 2001Hz
    { file: "sfx/pot_mid.ogg", tier: 1 }, // 2370Hz
    { file: "sfx/pot_sink_7.ogg", tier: 1 }, // 2643Hz
    { file: "sfx/pot_heavy_4.ogg", tier: 1 }, // 2838Hz
    // 重档（脆 3518~4390Hz）：球高速撞上袋口，撞击泛音丰富
    { file: "sfx/pot_sink_8.ogg", tier: 2 }, // 3518Hz
    { file: "sfx/pot_heavy_3.ogg", tier: 2 }, // 3558Hz
    { file: "sfx/pot_heavy_2.ogg", tier: 2 }, // 3760Hz
    { file: "sfx/pot_heavy_5.ogg", tier: 2 }, // 4157Hz
    { file: "sfx/pot_heavy_1.ogg", tier: 2 }, // 4390Hz
  ],
  success: [{ file: "sfx/success.ogg", tier: 1 }],
}

/**
 * 各事件的参考速度：把 incidentSpeed 归一化到 [0,1]，用于**音量**的连续映射。
 * 沿用 v1.3.20 的实测标定：球速实际量级约 0~5.4（maxPower=160R≈5.24）。
 * 落袋时球已减速，区间更小，故参考值另取。
 */
const REF_SPEED: { [cat: string]: number } = {
  Hit: 5.2,
  Collision: 5,
  Cushion: 6,
  Pot: 3.2,
}

/**
 * 变体分档阈值（m/s，绝对值）。音量用上面的归一化值连续变化，
 * 但**选哪条录音**必须用绝对阈值。
 *
 * 为什么不能复用归一化值：落袋速度实测约 0.2~4，若按 refSpeed 归一化后
 * 再切三档，2.0 以上的落袋就全落进「重档」，轻/中两档几乎永不使用
 * （实测 speed=2 就选中了 pot_heavy）。阈值取自 v1.0.9 标注的经验区间：
 * 轻推 1~2、正常 2~4、重击 4 以上。碰撞按球速区间 0~5.4 三等分。
 */
const TIER_SPEED: { [cat: string]: [number, number] } = {
  Collision: [1.8, 3.6],
  Pot: [2.0, 4.0],
}

/** 播放抖动的默认幅度：速率 ±3.5%、增益 ±8% */
const RATE_JITTER = 0.035
const GAIN_JITTER = 0.08

/**
 * 变体稀少的类别用更大的速率抖动。
 *
 * 为什么：轮转只能消除"同一条连播"的重复感，消不掉"这几条本来就长得像"的
 * 重复感。cushion 只有 2 条，而且两条同源于同一次撞击、只是裁剪长短不同，
 * 光靠轮转听起来还是同一个音。音高上的微小差异比"换一条长度略不同的录音"
 * 更容易被察觉，所以给它们 ±7.5% 而不是 ±3.5%。
 *
 * ±7.5% 约合 1.25 个半音，仍在同一音级内，不会听成"跑调"。
 */
const RATE_JITTER_SPARSE = 0.075

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

  /** 已加载的变体：file → AudioBuffer（边加载边可用，不等全部就绪） */
  private buffers = new Map<string, AudioBuffer>()
  /** 变体轮转游标：类别 → 上次使用的变体索引 */
  private cursor = new Map<string, number>()

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
    this.loadAll()
  }

  /**
   * 预加载全部变体。
   *
   * 不做「全部就绪才可用」的闸门：每个文件加载完即可播放。开球往往发生在
   * 资源加载完成之前，若等待全集就绪，开局那一杆会静音。
   */
  private loadAll() {
    const seen: string[] = []
    Object.keys(LIB).forEach((cat) => {
      LIB[cat].forEach((v) => {
        if (seen.indexOf(v.file) < 0) seen.push(v.file)
      })
    })
    seen.forEach((file) => {
      this.audioLoader.load(
        file,
        (buf: any) => {
          if (buf) this.buffers.set(file, buf as AudioBuffer)
        },
        () => {},
        () => {}
      )
    })
  }

  /**
   * 挑一个变体：优先在目标力度档内轮转，档内尚未加载则退回整类。
   *
   * 用轮转而非纯随机：纯随机在变体少时（如 cushion 只有 2 个）经常连续抽到
   * 同一个，听上去就是「机关枪效应」；轮转保证相邻两次一定不同。
   */
  private pick(cat: string, tier: number): AudioBuffer | undefined {
    const list = LIB[cat]
    if (!list) return undefined
    const inTier: number[] = []
    for (let i = 0; i < list.length; i++) {
      if (list[i].tier === tier) inTier.push(i)
    }
    const pool = inTier.length
      ? inTier
      : list.map((_, i) => i)
    // 游标按 (类别, 力度档) 分别记录，不能只按类别。
    // 踩过的坑：只用 cat 作 key 时，轻档选中「绝对索引 0」之后再切到重档，
    // 0 不在重档 pool 里 → indexOf 返回 -1 → 起点被算成 0 → 每次都从头开始。
    // 实测混合力度下永远只用得到前两个重档变体，其余三个成了死素材。
    const key = cat + "#" + tier
    const last = this.cursor.get(key)
    const start = last === undefined ? 0 : pool.indexOf(last) + 1
    for (let j = 0; j < pool.length; j++) {
      const idx = pool[(start + j) % pool.length]
      const buf = this.buffers.get(list[idx].file)
      if (buf) {
        this.cursor.set(key, idx)
        return buf
      }
    }
    return undefined
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

      // 室内混响：短延迟反馈 + 低通，模拟球房的木头/台呢空间反射。
      // 真实录音本身已带现场反射，这里的 wet 比合成音时期调低（0.22→0.16），
      // 避免两次空间感叠加而显得「空旷」。
      this.reverbInput = ctx.createGain()
      this.reverbInput.gain.value = 1.0
      this.reverbWet = ctx.createGain()
      this.reverbWet.gain.value = 0.16
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
   * 3D 空间播放：新建 BufferSource + PannerNode(HRTF) + Gain，接到主增益链。
   * 每次播放都新建节点 → 天然支持多音效并发；声源位置取自发声球桌面坐标 (x, 0, y)。
   *
   * jitter=true 时随机微调速率与增益。真实世界里同一事件不可能两次完全一样，
   * 这点微小差异是「录音感」的关键；但成功提示音需要稳定可辨，故关闭。
   *
   * rateJitter 可覆盖默认抖动幅度，供变体稀少的类别加大抖动（见该常量注释）。
   */
  private play3D(
    buffer: AudioBuffer,
    x: number,
    y: number,
    volume: number,
    rate = 1,
    jitter = true,
    rateJitter = RATE_JITTER
  ) {
    if (!this.loadAssets || !this.masterGain || !buffer) return
    const ctx = this.actx
    if (ctx.state === "suspended") {
      if (navigator?.userActivation?.hasBeenActive) ctx.resume()
      else return
    }
    const settings = Settings.get()
    if (!settings.sound || settings.volume <= 0) return
    let v = Math.max(0, Math.min(1, volume * settings.volume))
    let r = rate
    if (jitter) {
      r *= 1 + (Math.random() * 2 - 1) * rateJitter
      v *= 1 + (Math.random() * 2 - 1) * GAIN_JITTER
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = Math.max(0.25, Math.min(4, r))
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
    g.gain.value = Math.max(0, v)
    src.connect(panner)
    panner.connect(g)
    g.connect(this.masterGain)
    // 同时送入混响链（湿声），增强空间真实感
    if (this.reverbInput) g.connect(this.reverbInput)
    src.start()
  }

  /** 把速度归一化到 [0,1] 的力度系数 */
  private k(speed: number, cat: string): number {
    const ref = REF_SPEED[cat] ?? 5
    return Math.max(0, Math.min(1, (speed ?? 0) / ref))
  }

  /** 速度 → 变体力度档（0 轻 / 1 中 / 2 重），用绝对阈值（见 TIER_SPEED） */
  private tierOf(cat: string, speed: number): number {
    const t = TIER_SPEED[cat]
    if (!t) return 1
    return speed < t[0] ? 0 : speed < t[1] ? 1 : 2
  }

  outcomeToSound(outcome) {
    const pos = outcome.ballA?.pos
    const x = pos ? pos.x : 0
    const y = pos ? pos.y : 0
    const speed = outcome.incidentSpeed ?? 0

    if (outcome.type === "Collision") {
      const kk = this.k(speed, "Collision")
      const buf = this.pick("collision", this.tierOf("Collision", speed))
      if (buf) this.play3D(buf, x, y, 0.35 + kk * 0.65)
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
      const kk = this.k(speed, "Pot")
      const buf = this.pick("pot", this.tierOf("Pot", speed))
      if (buf) this.play3D(buf, x, y, 0.5 + kk * 0.5)
    }
    if (outcome.type === "Cushion") {
      const kk = this.k(speed, "Cushion")
      const buf = this.pick("cushion", 1)
      // cushion 只有 2 条且同源于同一次撞击，用加大抖动弥补变体不足
      if (buf) this.play3D(buf, x, y, 0.3 + kk * 0.7, 1, true, RATE_JITTER_SPARSE)
    }
    if (outcome.type === "Hit") {
      const kk = this.k(speed, "Hit")
      const buf = this.pick("cue", 1)
      // cue 的 tight/full 同源，实际只有 3 种音色，同样加大抖动
      if (buf) this.play3D(buf, x, y, 0.45 + kk * 0.55, 1, true, RATE_JITTER_SPARSE)
    }
    // 注：v1.3.20 曾在此处理 "Break"，但 OutcomeType 枚举中并无该类型
    // （只有 Pot/Cushion/Collision/Hit/Proximity），那段代码从未执行过，已移除。
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

  /**
   * 成功提示音：三音上行琶音（1068→1250→1432Hz）。
   * pitch 由调用方传入（连击数相关），用轻微变调表现「连得越多越上扬」。
   */
  playSuccess(pitch = 0) {
    const buf = this.buffers.get("sfx/success.ogg")
    if (!buf) return
    this.play3D(buf, 0, 0, 0.32, 1 + pitch * 0.06, false)
  }
}
