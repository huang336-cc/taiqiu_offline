#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
评估 raw/ 下的候选素材，逐个事件给出客观指标，供人工挑选。

听不到声音，所以全靠数字筛。核心判据是 **信噪比 S/N**：

    弱素材（峰值只有 0.1~0.2）在做响度对齐时会被整体拉高 15~20dB，
    录进去的底噪会跟着一起被放大，听起来就是"沙沙的"。所以挑素材
    不能只看瞬态本身，必须看它脚下踩着多厚的底噪。

S/N 算法：事件窗口的 RMS 除以「该素材最安静一段」的 RMS，取 dB。
经验阈值：< 26dB 的底噪拉高后可闻，直接弃用。

用法:
    python3 eval_candidates.py                 # 评估 raw/ 下全部
    python3 eval_candidates.py fs763603        # 只评估某个
"""
import glob
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib import (DETECT, decode, detect_events, slice_event, post_process,  # noqa: E402
                  stats, SR)

RAW_DIR = os.path.join(HERE, "raw")
SN_MIN_DB = 26.0          # 低于此值判定底噪会可闻
NOISE_WIN = 0.20          # 取底噪时滑动窗口长度（秒）
TAIL_MAX = 0.02           # 尾部 10% 的 RMS / 峰值，超过说明拖尾不干净


def noise_floor(a, sr=SR):
    """
    素材里最安静一段的 RMS，当作底噪水平。找不到静音段时返回 None。

    为什么可能返回 None：素材太短、或事件密到几乎没有间隙时，滑动窗口
    取到的"最安静 0.2 秒"其实仍然装着撞击声本身，算出来的 S/N 会离谱地低
    （实测 0.24s 的单击被算成 4.4dB）。这种情况宁可不判，也不要误杀。
    """
    w = int(NOISE_WIN * sr)
    if a.size < w * 3:          # 至少 3 个窗口长，才谈得上有"间隙"
        return None
    c = np.cumsum(np.concatenate([[0.0], a.astype(np.float64) ** 2]))
    sums = c[w:] - c[:-w]
    nz = float(np.sqrt(max(sums.min() / w, 1e-20)))
    med = float(np.sqrt(max(np.median(sums) / w, 1e-20)))
    # 最安静窗口只比中位数低一点点 => 根本没有静音段，判定不可信
    if med / max(nz, 1e-20) < 4.0:
        return None
    return nz


def tail_ratio(x, sr=SR):
    """
    事件末尾 10% 的 RMS 相对事件峰值。

    没有静音段可用时的替代判据：一次干净的撞击应该衰减到接近零。
    若尾部还很高，要么录进了持续底噪，要么是一大段房间混响 —— 切片后
    都会很难听。经验阈值 0.02（-34dB）。
    """
    if x.size < 8:
        return 1.0
    k = max(int(x.size * 0.10), 1)
    tail = x[-k:]
    pk = float(np.max(np.abs(x)))
    if pk <= 1e-9:
        return 1.0
    return float(np.sqrt((tail ** 2).mean())) / pk


def evaluate(path, cat_max_len=0.45):
    a = decode(path)
    nz = noise_floor(a)
    ev = detect_events(a, **DETECT)
    rows = []
    for i, (s, e, v) in enumerate(ev):
        x = slice_event(a, int(s * SR), int(e * SR), max_len=cat_max_len)
        if x.size < int(0.010 * SR):
            continue
        x = post_process(x, SR)
        st = stats(x, SR)
        sn = (20.0 * np.log10(max(st["rms"], 1e-12) / max(nz, 1e-12))
              if nz else None)
        rows.append({
            "idx": i, "start": s, "dur": st["dur"], "peak": st["peak"],
            "centroid": st["centroid"], "t30": st["t30"], "sn": sn,
            "tail": tail_ratio(x),
        })
    return rows, nz


def main():
    args = sys.argv[1:]
    files = []
    for p in sorted(glob.glob(os.path.join(RAW_DIR, "*.mp3"))):
        if not args or any(k in os.path.basename(p) for k in args):
            files.append(p)

    print("阈值: S/N < %.0fdB 视为底噪可闻（拉高后会沙沙响）\n" % SN_MIN_DB)
    for p in files:
        name = os.path.basename(p)
        rows, nz = evaluate(p)
        a = decode(p)
        nzs = "底噪 RMS=%.5f" % nz if nz else "底噪 n/a(无静音段,改用衰减比)"
        print("=== %s  (%.2fs, %s, 事件 %d) ===" % (
            name, a.size / SR, nzs, len(rows)))
        print("  %-4s %-8s %-7s %-7s %-9s %-7s %-8s %-8s %s" % (
            "#", "起点s", "时长", "峰值", "质心Hz", "T30", "S/N dB", "衰减比", "判定"))
        for r in rows:
            bad = []
            if r["sn"] is None:
                sns = "n/a"
                if r["tail"] > TAIL_MAX:
                    bad.append("尾音重")
            else:
                sns = "%.1f" % r["sn"]
                if r["sn"] < SN_MIN_DB:
                    bad.append("底噪")
            if r["dur"] > 0.50:
                bad.append("过长")
            if r["t30"] > 0.40:
                bad.append("余响长")
            flag = ",".join(bad) if bad else "OK"
            print("  %-4d %-8.2f %-7.3f %-7.3f %-9.0f %-7.3f %-8s %-8.4f %s" % (
                r["idx"], r["start"], r["dur"], r["peak"],
                r["centroid"], r["t30"], sns, r["tail"], flag))

        def usable(r):
            if r["dur"] > 0.50 or r["t30"] > 0.40:
                return False
            if r["sn"] is None:
                return r["tail"] <= TAIL_MAX
            return r["sn"] >= SN_MIN_DB
        ok = sum(1 for r in rows if usable(r))
        print("  -> 可用事件 %d / %d\n" % (ok, len(rows)))


if __name__ == "__main__":
    main()
