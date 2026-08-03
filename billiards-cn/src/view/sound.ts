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

  lastOutcomeTime = 0
  lastOutcomeIndex = 0
  lastOutcomesRef: any[] | null = null
  loadAssets

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

  /**
   * 全局音量提升系数。
   *
   * 玩家反馈：滑条已经拉到最大，击球声/中袋声依然不够响。
   * 之前 audio.setVolume(volume * settings.volume)，当 settings.volume=1.0、
   * 内部 volume 也只有 0.2~0.4 时，最终只有 0.2~0.4，对手机扬声器明显偏轻。
   * 提升 BOOST 后，即使滑条 50% 也能达到之前的最大声量，100% 时
   * 大约多 2 倍体感音量。WebAudio 端 1.0 即满幅，>1 会削峰，
   * 所以再叠加 compressor 抑制失真。
   */
  static readonly BOOST = 1.8

  play(audio: Audio, volume, detune = 0) {
    if (this.loadAssets) {
      // 设置面板中的音效开关与音量
      const settings = Settings.get()
      if (!settings.sound || settings.volume <= 0) {
        return
      }
      const context = this.listener.context
      if (context?.state === "suspended") {
        if (navigator?.userActivation?.hasBeenActive) {
          context.resume()
        }
        return
      }
      const v = Math.min(1, volume * settings.volume * Sound.BOOST)
      audio.setVolume(v)
      if (audio.isPlaying) {
        audio.stop()
      }
      audio.play(MathUtils.randFloat(0, 0.01))
      audio.setDetune(detune)
    }
  }

  /** 手机震动反馈（设置里可关闭；桌面浏览器无此 API 时自动忽略） */
  private vibrate(pattern: number | number[]) {
    try {
      if (!Settings.get().vibrate) return
      navigator?.vibrate?.(pattern)
    } catch {
      /* 不支持震动的设备直接忽略 */
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

  outcomeToSound(outcome) {
    if (outcome.type === "Pot") {
      this.vibrate(30)
    }
    if (outcome.type === "Hit") {
      this.vibrate(12)
    }
    if (outcome.type === "Collision") {
      this.play(
        this.ballcollision,
        outcome.incidentSpeed / 50,
        outcome.incidentSpeed * 5
      )
    }
    if (outcome.type === "Pot") {
      // 用力度档位选择音效 + 音量
      const pick = this.pickPotBySpeed(outcome.incidentSpeed)
      this.play(pick.audio, pick.vol, pick.detune)
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
    // Optimize processOutcomes to avoid scanning from index 0 every frame.
    // We cache the last checked outcomes array reference and track the next outcome index.
    if (
      this.lastOutcomeTime === -1 ||
      outcomes !== this.lastOutcomesRef ||
      this.lastOutcomeIndex > outcomes.length
    ) {
      this.lastOutcomeIndex = 0
      this.lastOutcomesRef = outcomes
    }
    for (let i = this.lastOutcomeIndex; i < outcomes.length; i++) {
      const outcome = outcomes[i]
      if (outcome.timestamp > this.lastOutcomeTime) {
        this.lastOutcomeTime = outcome.timestamp
        this.lastOutcomeIndex = i + 1
        this.outcomeToSound(outcome)
        break
      }
    }
  }

  playNotify() {
    this.play(this.pot, 1)
  }

  playSuccess(pitch) {
    this.play(this.success, 0.1, pitch * 100 - 2200)
  }
}
