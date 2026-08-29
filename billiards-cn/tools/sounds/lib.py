#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台球音效素材加工库（v1.3.55）

背景
----
dist/sounds/*.ogg 是 v1.0.9 引入的 Freesound 真实录音（CC0 / CC-BY），
但它们是「未剪辑的原始素材」，直接播放有明显问题：

  - pot_mid.ogg     前 0.87s 是死寂，进袋后要等将近 1 秒才出声
  - pot_heavy.ogg   7.0s 长，里面其实压了 5 次独立落袋，中间夹着长静音
  - ballcollision.ogg  2.5s，前 0.74s 静音，主瞬态只有 ~0.1s
  - cushion.ogg     0.73s，前 0.38s 静音
  - pot.ogg         6.8s，是「连续多次操作」的现场长录音

这就是 v1.3.20 把它们换成程序化合成音的原因之一（另一原因是担心版权，
但素材授权已在「开源声明.md」中署名，可合法使用）。

本模块把这些原始录音切成「单事件干净片段」，并导出为体积很小的 ogg，
供游戏运行时按力度/随机挑选播放 —— 即「真实录音 + 多变体」的音效库。

设计要点
--------
- 事件检测用「峰值保持包络」而非瞬时采样：台球声是宽带瞬态，波形每秒
  过零数千次，直接判 abs(x) 会被过零点立刻截断（踩过这个坑）。
- 每个片段自带 pre-roll（峰前留一点）与尾部淡出，避免切在波形中间爆音。
- 只做「裁剪 + 归一化 + 淡入淡出」，不做任何音色合成，保证 100% 真实录音。
"""

import os
import subprocess
import sys

import numpy as np

SR = 44100

# 全项目统一的瞬态检测参数。
#
# 必须放在 lib 里由 build.py / eval_candidates.py 共用：两边各自写一份时，
# 检测出的事件数与序号会不一致（eval 曾用默认 min_gap=0.25，build 用 0.10），
# 于是 eval 里挑中的「第 9 个事件」在 build 里其实是别的瞬态，会静悄悄切错
# 素材。事件序号是跨脚本的契约，参数必须同源。
DETECT = dict(floor_db=-42, min_gap=0.10, min_prom_db=5, tail_db=-30)


def decode(path, sr=SR):
    """ogg/wav -> float32 单声道 numpy。走 ffmpeg，避免引入音频解码依赖。"""
    cmd = [
        "ffmpeg", "-v", "error", "-i", path,
        "-ac", "1", "-ar", str(sr), "-f", "f32le", "-",
    ]
    raw = subprocess.run(cmd, check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def envelope(a, sr=SR, attack=0.0008, release=0.015):
    """峰值保持包络：攻击极快、释放较慢，适合瞬态检测。"""
    rel = np.exp(-1.0 / (sr * release))
    out = np.empty(a.shape, dtype=np.float32)
    peak = 0.0
    for i in range(a.shape[0]):
        v = a[i]
        if v < 0:
            v = -v
        peak = v if v > peak else v + (peak - v) * rel
        out[i] = peak
    return out


def _local_peaks(env, sr, min_gap, min_prom_db):
    """
    局部峰检测（不依赖 scipy）。

    采用「分治取最大值」：在宽度为 min_gap 的窗口内取包络最大处作为一个峰，
    跳过该窗口后继续。比「逐个比较左右邻居」稳得多 —— 能正确处理
    pot_heavy 那种「撞击 + 长余响 + 再撞击」的结构：余响里的毛刺
    因为落在该峰的 min_gap 窗口内而不会被误判成新峰。

    min_prom_db 再过滤一次显著性：峰必须比两侧谷高出该 dB 数，
    否则视为余响抖动丢弃。
    """
    n = env.shape[0]
    gap = max(1, int(min_gap * sr))
    peaks = []
    i = 0
    while i < n:
        j = min(n, i + gap)
        k = i + int(np.argmax(env[i:j]))
        peaks.append(k)
        i = k + gap
    if not peaks:
        return []

    kept = []
    ratio = 10 ** (-min_prom_db / 20.0)
    for idx, p in enumerate(peaks):
        v = float(env[p])
        left = peaks[idx - 1] if idx > 0 else 0
        right = peaks[idx + 1] if idx + 1 < len(peaks) else n - 1
        lo = float(env[left:p].min()) if p > left else v
        ro = float(env[p:right].min()) if right > p else v
        trough = max(min(lo, ro), 1e-9)
        if v >= trough / ratio:
            kept.append(p)
    return kept


def detect_events(a, sr=SR, floor_db=-42, min_gap=0.25, min_prom_db=9, tail_db=-34):
    """
    在一段录音里检测独立的瞬态事件，返回 [(peak_sec, end_sec, peak_val), ...]。

    floor_db    低于全局峰值多少 dB 视为背景（用来切掉静音与房间底噪）
    min_gap     两个事件的最小间隔（同一次撞击的余响不会被切成多个）
    min_prom_db 峰相对两侧谷的最小显著度（滤掉余响毛刺）
    tail_db     事件尾部：从峰值衰减到多少 dB 处结束
    """
    env = envelope(a, sr)
    if env.size == 0:
        return []
    gmax = float(env.max())
    if gmax <= 0:
        return []

    floor = gmax * (10 ** (floor_db / 20.0))
    active = env > floor
    if not active.any():
        return []

    # 先按底噪切出「有声音的区间」，再在区间内找峰
    spans = []
    i, n = 0, active.shape[0]
    while i < n:
        if active[i]:
            j = i
            while j < n and active[j]:
                j += 1
            if (j - i) >= int(0.010 * sr):
                spans.append((i, j))
            i = j
        else:
            i += 1

    thr = 10 ** (tail_db / 20.0)
    events = []
    for s, e in spans:
        seg = env[s:e]
        peaks = _local_peaks(seg, sr, min_gap, min_prom_db)
        if not peaks:
            continue
        for pi, p in enumerate(peaks):
            v = float(seg[p])
            nxt = peaks[pi + 1] if pi + 1 < len(peaks) else seg.shape[0]
            k = p
            while k < min(seg.shape[0], nxt) and seg[k] > max(v * thr, floor):
                k += 1
            events.append((s + p, s + k, v))

    if events:
        top = max(ev[2] for ev in events)
        events = [ev for ev in events if ev[2] > top * (10 ** (-22 / 20.0))]

    events.sort(key=lambda x: x[0])
    return [(p / sr, e / sr, v) for p, e, v in events]


def slice_event(a, peak_i, end_i, sr=SR, pre_roll=0.004, tail=0.10, max_len=1.2):
    """取 [峰前 pre_roll, 峰后 tail 或自然衰减末端] 的片段。"""
    st = max(0, int(peak_i - pre_roll * sr))
    en = min(a.shape[0], int(end_i + tail * sr))
    if (en - st) / sr > max_len:
        en = st + int(max_len * sr)
    return a[st:en].copy()


def post_process(x, sr=SR, target=0.92, fade_in=0.0015, fade_out=0.012):
    """去直流 + 归一化 + 首尾淡入淡出（防止切点爆音）。"""
    if x.size == 0:
        return x
    x = x - float(np.mean(x))
    peak = float(np.max(np.abs(x)))
    if peak > 0:
        x = x * (target / peak)
    fi = max(1, int(fade_in * sr))
    fo = max(1, int(fade_out * sr))
    if x.size > fi * 2:
        x[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)
    if x.size > fo * 2:
        x[-fo:] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)
    return x.astype(np.float32)


def encode(x, out_path, sr=SR, quality=3):
    """float32 -> ogg(vorbis)。quality 3 对短瞬态足够，体积约为 wav 的 1/12。"""
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-",
        "-c:a", "libvorbis", "-q:a", str(quality),
        "-ar", str(sr), out_path,
    ]
    subprocess.run(cmd, input=x.astype(np.float32).tobytes(), check=True)
    return os.path.getsize(out_path)


def a_weighted_rms(x, sr=SR):
    """
    A 加权 RMS（近似人耳等响曲线，单位仍为线性幅度）。

    为什么必须用它而不是普通 RMS：台球音效的频谱差异极大 ——
    清脆碰撞质心 ~4.5kHz、库边闷响质心 ~560Hz。人耳在 2~5kHz 最灵敏，
    在 500Hz 以下迟钝约 10dB。若按普通 RMS 拉平，清脆音会被抬得
    过于刺耳，闷响反而被压住。A 加权把这 10dB 的生理差异算进去。

    实现：频域乘 A 权重后 irfft 回时域再算 RMS —— 比手推 Parseval 的
    rfft 归一化系数稳妥（rfft 的非直流/非 Nyquist 项要补 ×2，易错）。
    """
    n = x.shape[0]
    if n == 0:
        return 0.0
    X = np.fft.rfft(x.astype(np.float64))
    f = np.fft.rfftfreq(n, 1.0 / sr)
    f2 = f * f
    ra = (12194.0 ** 2 * f2 ** 2) / (
        (f2 + 20.6 ** 2)
        * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2))
        * (f2 + 12194.0 ** 2)
    )
    w = 10.0 ** ((20.0 * np.log10(np.maximum(ra, 1e-12)) + 2.00) / 20.0)
    xw = np.fft.irfft(X * w, n)
    return float(np.sqrt((xw ** 2).mean()))


def stats(x, sr=SR):
    """片段客观指标，用于回归与筛选。"""
    if x.size == 0:
        return {}
    env = envelope(x, sr)
    # T30：从峰值衰减到 -30dB 的时间（真实撞击都很短）
    pk = float(env.max())
    idx = np.where(env > pk * 0.0316)[0]
    t30 = (idx[-1] - int(np.argmax(env))) / sr if idx.size else 0.0
    # 频谱质心（明亮度）
    w = np.hanning(min(x.size, 4096))
    seg = x[: w.size] * w
    F = np.abs(np.fft.rfft(seg))
    fr = np.fft.rfftfreq(w.size, 1.0 / sr)
    cen = float((F * fr).sum() / max(F.sum(), 1e-9))
    return {
        "dur": x.size / sr,
        "peak": float(np.max(np.abs(x))),
        "rms": float(np.sqrt((x ** 2).mean())),
        "rmsA": a_weighted_rms(x, sr),
        "t30": t30,
        "centroid": cen,
    }
