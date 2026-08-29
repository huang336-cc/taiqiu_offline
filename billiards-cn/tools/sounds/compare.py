#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
真实录音 vs 程序化合成音：客观对比（v1.3.55）

用可量化的频谱/包络指标说明「为什么真实录音听起来更真实」，
而不是靠主观形容词。

对比维度
--------
1. 共振峰数量：真实物体受击会激发多个振动模态，频谱上表现为多个
   共振峰；合成音用二阶谐振器建模，每个谐振器只贡献 1 个峰。
2. 包络衰减的线性度：合成音用单指数 exp(-t/tau)，在 dB 域是一条直线；
   真实衰减是多个模态按各自时间常数叠加，在 dB 域是折线。
   用「dB 域分段线性拟合残差」量化，残差越大越接近真实。
3. 频谱平坦度（geometric mean / arithmetic mean）：白噪声→1，
   纯音→0。真实撞击介于两者之间且带精细结构。
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import SR, decode, envelope

SFX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dist", "sfx")


# ---------- 复现 src/view/sound.ts 的合成算法（供对照） ----------

def resonate(src, sr, freq, q):
    """sound.ts 的 resonate()：单极点带通共振。"""
    out = np.empty_like(src)
    w0 = 2 * np.pi * freq / sr
    r = np.exp(-w0 / (2 * q))
    cosw, sinw = np.cos(w0), np.sin(w0)
    x1 = x2 = y1 = y2 = 0.0
    a1, a2 = -2 * r * cosw, r * r
    b0 = (1 - r) * np.sqrt(max(0.0, 1 - 1.0 / (4 * q * q)))
    for i in range(src.shape[0]):
        x0 = src[i]
        y0 = b0 * (x0 - x2) - a1 * y1 - a2 * y2
        out[i] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return out


def noise_burst(n, sr, tau, rng):
    t = np.arange(n) / sr
    return (rng.uniform(-1, 1, n) * np.exp(-t / tau)).astype(np.float64)


def gen_collision(n, sr, k, rng):
    """sound.ts 的 genCollision()。"""
    out = np.zeros(n)
    body = resonate(noise_burst(n, sr, 0.010 + (1 - k) * 0.006, rng), sr, 2000 + k * 1400, 9)
    out += body * 0.85
    tick = resonate(noise_burst(n, sr, 0.005 + (1 - k) * 0.003, rng), sr, 4000 + k * 1200, 12)
    out += tick * (0.25 + k * 0.35)
    tau = 0.022 + (1 - k) * 0.013
    out *= np.exp(-np.arange(n) / sr / tau)
    return out / np.abs(out).max()


def gen_pot(n, sr, k, rng):
    """sound.ts 的 genPot()。"""
    out = np.zeros(n)
    clack = resonate(noise_burst(n, sr, 0.016 + (1 - k) * 0.008, rng), sr, 1400 + k * 800, 8)
    out += clack * (0.55 + k * 0.25)
    thud = resonate(noise_burst(n, sr, 0.10 + (1 - k) * 0.06, rng), sr, 120, 3)
    out += thud * 0.6
    out *= np.exp(-np.arange(n) / sr / (0.07 + (1 - k) * 0.04))
    return out / np.abs(out).max()


# ---------- 指标 ----------

def spec_peak_count(x, sr, min_prom_db=5, lo_hz=80, hi_hz=9000, nbins=240):
    """
    幅度谱包络上的显著共振峰数量。

    关键点：必须在**对数频率轴**上数峰。物理共振模态的带宽是恒定 Q
    （Δf/f 恒定），在对数轴上宽度恒定、在线性轴上低频极窄高频极宽。
    直接在 FFT 线性 bin 上数峰会把高频段一大片噪声毛刺全算成峰
    （踩过：所有样本都撞到 40 的上限，指标完全失去区分度）。
    """
    nfft = 1 << int(np.ceil(np.log2(max(x.shape[0], 8192))))
    w = np.hanning(x.shape[0]) if x.shape[0] <= nfft else np.hanning(nfft)
    seg = (x[: w.shape[0]] * w).astype(np.float64)
    F = np.abs(np.fft.rfft(seg, nfft))
    fr = np.fft.rfftfreq(nfft, 1.0 / sr)

    # 线性 -> 对数频率轴重采样（每点约 1/34 倍频程）
    edges = np.geomspace(lo_hz, hi_hz, nbins + 1)
    db = np.empty(nbins)
    for i in range(nbins):
        m = (fr >= edges[i]) & (fr < edges[i + 1])
        db[i] = 20 * np.log10(F[m].max() + 1e-12) if m.any() else -120.0

    # 1/12 倍频程平滑（约 4 点），抹掉随机噪声的细结构、保留模态峰
    ker = np.array([0.15, 0.2, 0.3, 0.2, 0.15])
    sm = np.convolve(db, ker / ker.sum(), mode="same")

    top = sm.max()
    peaks = 0
    for i in range(1, nbins - 1):
        if not (sm[i] >= sm[i - 1] and sm[i] > sm[i + 1]):
            continue
        if sm[i] < top - 30:
            continue
        lo = max(0, i - 18)
        hi = min(nbins, i + 18)
        trough = min(sm[lo:i].min(), sm[i:hi].min())
        if sm[i] - trough >= min_prom_db:
            peaks += 1
    return peaks


def decay_nonlinearity(x, sr):
    """
    dB 域分段线性拟合残差（RMS，单位 dB）。

    合成音 = 单指数 → dB 域直线 → 残差≈0
    真实音 = 多模态叠加 → dB 域折线 → 残差大
    """
    env = envelope(x, sr, attack=0.0008, release=0.008)
    pk = int(np.argmax(env))
    tail = env[pk:]
    usable = np.where(tail > env.max() * 10 ** (-45 / 20.0))[0]
    if usable.size < 200:
        return 0.0
    seg = tail[: usable[-1] + 1]
    db = 20 * np.log10(seg + 1e-12)
    t = np.arange(seg.shape[0]) / sr
    # 分 3 段线性拟合
    n = seg.shape[0]
    resid = []
    for a, b in ((0, n // 3), (n // 3, 2 * n // 3), (2 * n // 3, n)):
        if b - a < 20:
            continue
        tt, dd = t[a:b], db[a:b]
        c = np.polyfit(tt - tt[0], dd, 1)
        resid.append(dd - np.polyval(c, tt - tt[0]))
    if not resid:
        return 0.0
    r = np.concatenate(resid)
    return float(np.sqrt((r ** 2).mean()))


def flatness(x, sr, nfft=4096):
    """频谱平坦度：几何均值 / 算术均值，0~1。"""
    w = np.hanning(min(x.shape[0], nfft))
    seg = x[: w.shape[0]] * w
    N = 1 << int(np.ceil(np.log2(max(w.shape[0], 2048))))
    P = np.abs(np.fft.rfft(seg, N)) ** 2 + 1e-20
    fr = np.fft.rfftfreq(N, 1.0 / sr)
    P = P[fr < 12000]
    return float(np.exp(np.log(P).mean()) / P.mean())


def row(tag, x, sr=SR):
    return (tag, spec_peak_count(x, sr), decay_nonlinearity(x, sr), flatness(x, sr))


def main():
    rng = np.random.default_rng(7)
    n = int(0.9 * SR)
    rows = []

    for f, k in (("collision_hard", 0.9), ("collision_soft", 0.2)):
        p = os.path.join(SFX, f + ".ogg")
        if os.path.exists(p):
            rows.append(row("真实 " + f, decode(p)))
    for k, tag in ((0.9, "合成 collision 重"), (0.2, "合成 collision 轻")):
        rows.append(row(tag, gen_collision(n, SR, k, rng)))

    for f in ("pot_heavy_5", "pot_light"):
        p = os.path.join(SFX, f + ".ogg")
        if os.path.exists(p):
            rows.append(row("真实 " + f, decode(p)))
    for k, tag in ((0.9, "合成 pot 重"), (0.2, "合成 pot 轻")):
        rows.append(row(tag, gen_pot(n, SR, k, rng)))

    print("| 样本 | 共振峰数 | 衰减非线性(dB) | 频谱平坦度 |")
    print("|---|---:|---:|---:|")
    for tag, pk, nl, fl in rows:
        print("| %s | %d | %.2f | %.4f |" % (tag, pk, nl, fl))

    real = [r for r in rows if r[0].startswith("真实")]
    syn = [r for r in rows if r[0].startswith("合成")]
    if real and syn:
        print()
        print("均值：真实 共振峰 %.1f / 非线性 %.2f ；合成 共振峰 %.1f / 非线性 %.2f"
              % (np.mean([r[1] for r in real]), np.mean([r[2] for r in real]),
                 np.mean([r[1] for r in syn]), np.mean([r[2] for r in syn])))


if __name__ == "__main__":
    main()
