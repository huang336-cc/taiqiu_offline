#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台球音效库构建脚本（v1.3.55）

从 dist/sounds/ 的 Freesound 原始录音中，切出「单事件干净片段」，
做等响度归一后编码为精简 ogg，输出到 dist/sfx/。

为什么需要这一步
----------------
原始素材是「未剪辑的现场录音」，直接播会有明显问题：

  pot_mid.ogg        前 0.87s 死寂，进袋后将近 1 秒才出声
  pot_heavy.ogg      7.0s，其实压了 5 次独立落袋，中间夹长静音
  ballcollision.ogg  2.5s，前 0.74s 静音，主瞬态只有 ~0.1s
  cushion.ogg        0.73s，前 0.38s 静音
  pot.ogg            6.8s，连续多次操作的现场长录音

这正是 v1.3.20 把它们换成程序化合成音的原因。本脚本把「真实录音」
和「干净切片」两者兼得：不做任何音色合成，只裁剪与归一。

用法
----
    python3 tools/sounds/build.py            # 构建到 dist/sfx/
    python3 tools/sounds/build.py --check    # 只体检不写文件

输出清单见 SPEC，变体按「力度档」分组，运行时由 sound.ts 挑选。
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import (
    DETECT, SR, a_weighted_rms, decode, detect_events, encode, envelope,
    post_process, slice_event, stats,
)

HERE = os.path.dirname(os.path.abspath(__file__))


def find_root():
    """
    定位项目根目录（含 src/view/sound.ts 的那一层）。

    不能简单用 HERE/../..：本脚本在发布流程中会被复制到源码树的
    tools/sounds/ 下，而在开发时可能位于独立的工作目录，两者相对位置不同。
    依次尝试：环境变量 → 逐级向上探测 → 报错。
    """
    env = os.environ.get("BILLIARDS_ROOT")
    if env:
        return os.path.abspath(env)
    d = HERE
    for _ in range(5):
        d = os.path.dirname(d)
        if os.path.exists(os.path.join(d, "src", "view", "sound.ts")):
            return d
    raise SystemExit(
        "找不到项目根目录（未发现 src/view/sound.ts）。\n"
        "请设置环境变量 BILLIARDS_ROOT 指向 billiards-cn 目录，例如：\n"
        "  BILLIARDS_ROOT=/path/to/billiards-cn python3 tools/sounds/build.py"
    )


ROOT = find_root()
SRC_DIR = os.path.join(ROOT, "dist", "sounds")
# v1.3.56 起新增：从 Freesound 补采的素材（HQ preview, 128kbps mp3）放在
# tools/sounds/raw/，随源码树一起发布；可用 fs_fetch.py 重新拉取复现。
RAW_DIR = os.path.join(HERE, "raw")
OUT_DIR = os.path.join(ROOT, "dist", "sfx")


def src_path(src):
    """
    解析素材路径：带目录分隔符或音频后缀的按 tools/sounds/ 下的相对路径找，
    其余按 dist/sounds/<name>.ogg 找。
    """
    if "/" in src or src.lower().endswith((".mp3", ".wav", ".flac", ".aif")):
        p = os.path.join(HERE, src)
        if os.path.exists(p):
            return p
        raise SystemExit(
            "缺少补采素材: %s\n"
            "可用 python3 tools/sounds/fs_fetch.py <author>/<id> 重新拉取" % p)
    return os.path.join(SRC_DIR, src + ".ogg")


# 检测参数来自 lib.DETECT（与 eval_candidates.py 同源，保证事件序号一致）

# 等响度目标（A 加权 RMS）。
#
# 为什么用 A 加权：台球音效频谱差异极大（清脆碰撞质心 ~4.5kHz、库边闷响
# ~560Hz），人耳在 2~5kHz 最灵敏、500Hz 以下迟钝约 10dB，普通 RMS 会把
# 清脆音抬得刺耳而闷响被压住。
#
# 为什么各类别目标不同而不是全部拉平：游戏音效本就需要层次 ——
# 落袋是核心正反馈要突出，库边最频繁要压低，否则满台跑球时很吵。
# 数值取自 peak 归一后实测 rmsA 的分布（0.042~0.101），再按需分层。
RMSA_TARGET = {
    "pot": 0.075,        # 落袋：核心反馈，最突出
    "cue": 0.085,        # 击球：需要清晰
    "collision": 0.070,  # 碰撞：最常见，适中
    "cushion": 0.062,    # 库边：最频繁，压低
}

# 补偿增益限幅。
# 下限 0.75：个别素材（cue_tight）天然偏响，压太狠会变闷。
# 上限 1.30：极短瞬态的 crest factor 很高（pot_heavy_1 的峰均比达 19），
#   若按 rmsA 硬拉需要 1.79x，会让峰值冲破 1.0 削顶失真。
#   而人耳对 <50ms 的瞬态感知响度本就更接近峰值而非 RMS，硬拉反而不真实。
# v1.3.56 放宽：补采素材的动态范围比原素材大得多，[0.75,1.30] 会把
# cue_s1（需 2.0x）和 pot_sink_6（需 0.68x）双双卡在边界上，实测 rmsA
# 散布到 0.042~0.110（±3dB，明显可闻地不齐）。
# 下限放宽到 0.50：整体增益缩放是线性的，压低不会"变闷"（那是等响度曲线的
#   听感错觉，不是失真），原注释的顾虑不成立。取 0.50 是因为 pot_sink_6
#   要到目标需 0.51x、success 需 0.51x，0.60 会把它们卡在 +1.4dB / +5.8dB。
# 上限放宽到 1.60：再高也无用 —— 峰值保护会把增益吃回去（见下）。
GAIN_MIN, GAIN_MAX = 0.50, 1.60

# 等响度目标之外的独立条目：success 是 UI 提示音，独立播放，不与碰撞音
# 竞争掩蔽，所以目标就是 v1.3.55 的实测值 0.171 ——
# 不能写 0.070：它在 v1.3.55 里其实是卡在增益下限才停在 0.171，目标值本身
# 从未真正生效。v1.3.56 放宽下限后若不改这里，它会掉到 0.114（轻 3.5dB），
# 等于凭空改了玩家已习惯的胜利音音量。
RMSA_TARGET["success"] = 0.171

# 规格表：(输出名, 类别, 源文件, 起始, 结束, 最大时长, 模式)
#   mode="peak"  在 [起,止] 窗口内找能量最大的瞬态，以它的峰为锚切片
#   mode="range" 直接截取 [起,止] 整段（用于 success 这类「设计好的琶音」，
#                按瞬态切会把三个音符切成三截）
#   mode="event" 「起始」填的是事件序号（不是秒），取 detect_events 的第 N 个
#                瞬态。补采素材动辄几十个事件（fs763601 有 53 个），
#                手写时间窗既不现实也易错位，按序号引用最稳。
#   max_len 是关键：碰撞是 30~130ms 的短瞬态，落袋是 200~300ms 的完整过程，
#   一刀切会把两种都切坏（踩过：collision_a 曾把相邻两次撞击切进同一片段）。
SPEC = [
    # —— 球球碰撞：同一次录音里的三次撞击，天然呈现「闷 / 中 / 脆」三档
    ("collision_soft", "collision", "ballcollision", 0.89, 1.01, 0.20, "peak"),
    ("collision_mid", "collision", "ballcollision", 1.14, 1.24, 0.13, "peak"),
    ("collision_hard", "collision", "ballcollision", 0.74, 0.86, 0.13, "peak"),
    # —— 库边：素材只有一次撞击，用「紧/松」两种裁剪做出两个变体
    ("cushion_tight", "cushion", "cushion", 0.37, 0.50, 0.15, "peak"),
    ("cushion_full", "cushion", "cushion", 0.37, 0.50, 0.24, "peak"),
    # —— 击球：同理，紧版偏"啪"、松版带余响
    ("cue_tight", "cue", "cue", 0.33, 0.46, 0.18, "peak"),
    ("cue_full", "cue", "cue", 0.33, 0.46, 0.26, "peak"),
    # —— 落袋：轻/中/重三档，重档有 5 个真实变体（来自 pot_heavy 的 5 次落袋）
    ("pot_light", "pot", "pot_light", 0.28, 0.56, 0.45, "peak"),
    ("pot_mid", "pot", "pot_mid", 0.87, 1.20, 0.45, "peak"),
    ("pot_heavy_1", "pot", "pot_heavy", 0.14, 0.60, 0.45, "peak"),
    ("pot_heavy_2", "pot", "pot_heavy", 1.65, 2.02, 0.45, "peak"),
    ("pot_heavy_3", "pot", "pot_heavy", 3.16, 3.52, 0.45, "peak"),
    ("pot_heavy_4", "pot", "pot_heavy", 4.65, 4.97, 0.45, "peak"),
    ("pot_heavy_5", "pot", "pot_heavy", 6.05, 6.45, 0.45, "peak"),
    # —— 胜利提示：三音上行琶音（1068→1250→1432Hz），整段保留
    ("success", "success", "success", 0.01, 0.99, 1.00, "range"),
    # —— 以下为 v1.3.56 补采素材（Freesound，见 开源声明.md）
    # 击球：换掉 fs763603。它的峰均比高达 22.2，峰值顶到 0.93 时 rmsA 只能到
    #   0.042，比 cue 目标 0.085 低 7.7dB —— 这是素材固有属性，再怎么拉增益
    #   都会被峰值保护原样拉回来，只能削波，所以弃用。
    #   fs830221 的 #4 峰均比仅 9.7（rmsA 可达 0.096），与现有素材同体系。
    ("cue_s1", "cue", "raw/fs830221.mp3", 1, None, 0.26, "event"),
    ("cue_s2", "cue", "raw/fs830221.mp3", 4, None, 0.26, "event"),
    # 碰撞：补一条 2425Hz 的干净"咔"（衰减比 0.0012，全批最干净）
    ("collision_clack", "collision", "raw/fs539854.mp3", 0, None, 0.20, "event"),
    # 落袋：fs763601 共 105 个事件。现有 pot_* 质心全在 1622Hz 以上，
    #   缺"闷"的落袋；这里按质心对数均匀取 8 条，把覆盖拉到 629~3518Hz。
    ("pot_sink_1", "pot", "raw/fs763601.mp3", 56, None, 0.45, "event"),
    ("pot_sink_2", "pot", "raw/fs763601.mp3", 72, None, 0.45, "event"),
    ("pot_sink_3", "pot", "raw/fs763601.mp3", 59, None, 0.45, "event"),
    ("pot_sink_4", "pot", "raw/fs763601.mp3", 69, None, 0.45, "event"),
    ("pot_sink_5", "pot", "raw/fs763601.mp3", 57, None, 0.45, "event"),
    ("pot_sink_6", "pot", "raw/fs763601.mp3", 37, None, 0.45, "event"),
    ("pot_sink_7", "pot", "raw/fs763601.mp3", 38, None, 0.45, "event"),
    ("pot_sink_8", "pot", "raw/fs763601.mp3", 4, None, 0.45, "event"),
]


def loudness_align(x, target):
    """
    按 A 加权 RMS 对齐到 target，增益限幅 [GAIN_MIN, GAIN_MAX]，峰值限 0.98。

    顺序很重要：先算「理想增益 → 限幅」，再整体应用，最后才做峰值保护。
    若先归一化再限幅，会二次改变已达成的响度目标。
    """
    r = a_weighted_rms(x)
    if r <= 0:
        return x
    g = min(GAIN_MAX, max(GAIN_MIN, target / r))
    x = x * g
    # 峰值留 7% 余量：vorbis 是有损编码，解码后会有过冲。
    # 实测按 0.98 封顶的片段解码后可达 1.023（削顶），故降到 0.93。
    peak = float(abs(x).max())
    if peak > 0.93:
        x = x * (0.93 / peak)
    return x.astype("float32"), g


def build(write=True):
    os.makedirs(OUT_DIR, exist_ok=True)
    cache = {}
    report = []
    total = 0

    for name, cat, src, w0, w1, max_len, mode in SPEC:
        path = src_path(src)
        if not os.path.exists(path):
            raise SystemExit("缺少源素材: " + path)
        if src not in cache:
            a = decode(path)
            ev = detect_events(a, **DETECT)
            cache[src] = (a, ev)
        a, ev = cache[src]

        if mode == "range":
            s = w0
            x = a[int(w0 * SR): int(w1 * SR)].copy()
        elif mode == "event":
            idx = int(w0)
            if idx < 0 or idx >= len(ev):
                raise SystemExit(
                    "%s: %s 只有 %d 个事件，取不到第 %d 个"
                    % (name, src, len(ev), idx))
            s, e, pk = ev[idx]
            x = slice_event(a, int(s * SR), int(e * SR), max_len=max_len)
        else:
            cand = [e for e in ev if w0 <= e[0] <= w1]
            if not cand:
                raise SystemExit("%s: 窗口 %.2f~%.2f 内未检测到瞬态" % (name, w0, w1))
            s, e, pk = max(cand, key=lambda t: t[2])
            x = slice_event(a, int(s * SR), int(e * SR), max_len=max_len)
        x = post_process(x)
        x, gain = loudness_align(x, RMSA_TARGET[cat])

        st = stats(x)
        env = envelope(x)
        atk = float(env.argmax()) / SR
        st["attack"] = atk
        st["peak_t"] = s
        st["src"] = src
        st["cat"] = cat
        st["gain"] = gain

        size = 0
        if write:
            out = os.path.join(OUT_DIR, name + ".ogg")
            size = encode(x, out)
            total += size
        report.append((name, st, size))

        warn = []
        # 起振阈值按类别区分：碰撞/击球/库边应当"立刻响"；落袋天然要先滚一段
        # 才掉进袋口，pot_sink_8 的 0.044s 是球滚向袋口的过程，保留更真实。
        # range 模式（success 琶音）不是瞬态切片，起振慢是音色本身，不报警。
        atk_max = 0.060 if cat == "pot" else 0.030
        if atk > atk_max and mode != "range":
            warn.append("起振延迟 %.3fs" % atk)
        if st["dur"] > max_len + 1e-6:
            warn.append("超长")
        if st["peak"] > 0.995:
            warn.append("削顶")
        # 源名可能很长（raw/fs763601.mp3），只显示去掉目录与后缀的短名
        srcs = os.path.basename(src)
        for suf in (".ogg", ".mp3", ".wav", ".flac", ".aif"):
            if srcs.lower().endswith(suf):
                srcs = srcs[: -len(suf)]
        print(
            "  %-15s %-13s 峰%.3fs | %.3fs t30=%.3fs 起振%.3fs "
            "质心%4.0fHz rmsA=%.4f x%.2f %6dB   %s"
            % (name, srcs, s, st["dur"], st["t30"], atk, st["centroid"],
               st["rmsA"], gain, size, ("!! " + ",".join(warn)) if warn else "")
        )

    print("  ---- 合计 %d 个变体, %d 字节 (%.1f KB)" % (len(report), total, total / 1024.0))

    if write:
        manifest = {
            "version": 1,
            "sampleRate": SR,
            "variants": {
                n: {
                    "cat": st["cat"],
                    "src": st["src"],
                    "file": "sfx/%s.ogg" % n,
                    "duration": round(st["dur"], 4),
                    "t30": round(st["t30"], 4),
                    "centroid": round(st["centroid"], 1),
                    "rmsA": round(st["rmsA"], 4),
                    "gain": round(st["gain"], 3),
                }
                for n, st, _ in report
            },
        }
        with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print("  已写出 sfx/manifest.json")
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只体检，不写文件")
    args = ap.parse_args()
    print("源素材: %s" % SRC_DIR)
    print("输出  : %s%s" % (OUT_DIR, "（仅体检）" if args.check else ""))
    build(write=not args.check)


if __name__ == "__main__":
    main()
