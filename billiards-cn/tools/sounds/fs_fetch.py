#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载 Freesound 素材的 HQ preview（128kbps mp3）。

为什么不下载原始 wav：Freesound 下载原始文件必须登录（OAuth），本项目没有
账号凭据，也无意在构建流程里引入登录态。HQ preview 是公开 CDN 直链，
不需要任何凭据，构建可复现。

代价与应对：
  128kbps mp3 有约 13ms 的编码器延迟（瞬态前一段空白），且高频在 16kHz
  附近截止。前者由 build.py 的瞬态检测 + pre_roll 自动对齐掉；后者对
  台球撞击影响有限（能量集中在 1~5kHz），但选素材时要避开靠极高频撑
  "脆"感的那几条。

用法:
    python3 fs_fetch.py 763603 763601          # 按 id 下载（自动查作者）
    python3 fs_fetch.py ChloePieterse/763603   # 指定作者，省一次跳转
"""
import argparse
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs_search import fetch, RE_SOUND_PAGE  # noqa: E402

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# 详情页里的 HQ preview 直链（hq=128kbps mp3，lq=低码率，只要 hq）
RE_HQ = re.compile(r'(https://cdn\.freesound\.org/previews/\d+/\d+_\d+-hq\.mp3)')

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "raw")


def hq_url(author, sid):
    h = fetch("https://freesound.org/people/%s/sounds/%s/" % (author, sid))
    m = RE_HQ.search(h)
    return m.group(1) if m else None


def author_of(sid):
    """只知道 id 时，用 Freesound 的 id 直跳页 /sounds/<id>/ 拿到作者。"""
    h = fetch("https://freesound.org/sounds/%s/" % sid)
    m = RE_SOUND_PAGE.search(h)
    return m.group(1).split("/")[2] if m else None


def download(author, sid, out_dir=RAW_DIR):
    url = hq_url(author, sid)
    if not url:
        return None, "拿不到 HQ preview 直链"
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "fs%s.mp3" % sid)
    if os.path.exists(out) and os.path.getsize(out) > 1024:
        return out, "已存在"
    cmd = ["curl", "-sL", "--max-time", "90", "-A", UA, "-o", out, url]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) < 1024:
        return None, "下载失败 (rc=%d)" % r.returncode
    return out, "OK"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("items", nargs="+", help="音效 id，或 author/id")
    ap.add_argument("--out", default=RAW_DIR)
    a = ap.parse_args()

    print("%-8s %-24s %-10s %s" % ("id", "作者", "结果", "文件"))
    print("-" * 72)
    for it in a.items:
        if "/" in it:
            author, sid = it.split("/", 1)
        else:
            sid, author = it, author_of(it)
            if not author:
                print("%-8s %-24s %s" % (sid, "?", "查不到作者"))
                continue
        path, msg = download(author, sid, a.out)
        size = "%d B" % os.path.getsize(path) if path and os.path.exists(path) else "-"
        print("%-8s %-24s %-10s %s (%s)" % (
            sid, author[:24], msg, os.path.basename(path) if path else "-", size))
        sys.stdout.flush()
    print("\n输出目录: %s" % a.out)


if __name__ == "__main__":
    sys.exit(main())
