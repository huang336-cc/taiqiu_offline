#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Freesound 素材检索（只读，不需要 API key）。

Freesound 的 API 需要 OAuth key，但搜索页是服务端渲染的，可以直接抓。
拿到的只是元数据（id / 标题 / 作者 / 授权），供人工确认后再决定是否下载。

用法:
    python3 fs_search.py "pool ball"                 # 全授权搜索
    python3 fs_search.py "billiard" --cc0            # 只看 CC0
    python3 fs_search.py --similar 42364             # 相似音效
"""
import argparse
import html
import re
import subprocess
import sys

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# aria-label="Sound xxx.wav by author" —— 标题与作者都从这里取，最稳
#
# 页面里 aria-label 出现在 data-sound-id 「之前」，顺序别写反了。
#
# 注意中间的 ((?:(?!aria-label).)*?) 而不是 .*? ：
# 页面上有多个结果块，每个块都各有一对。用普通 .*? 会让上一个 aria-label
# 去配对下一个块的 data-sound-id，导致 id 与标题整体错位一格（42365 会被标成
# 下一条结果的名字）。这里禁止跨越下一个 aria-label，保证同块内配对。
RE_SOUND = re.compile(
    r'aria-label="Sound ([^"]*)"((?:(?!aria-label).)*?)data-sound-id="(\d+)"',
    re.S)
# 授权标记：页面上 licence 图标的 title / alt
RE_LIC = re.compile(r'/data/licenses/[^"]*?\.png"[^>]*?(?:title|alt)="([^"]*)"')


def fetch(url):
    cmd = ["curl", "-s", "--max-time", "40", "-A", UA, url]
    r = subprocess.run(cmd, stdout=subprocess.PIPE)
    return r.stdout.decode("utf-8", "replace")


def parse(h):
    out = []
    for m in RE_SOUND.finditer(h):
        sid, label = m.group(3), html.unescape(m.group(1))
        # label 形如 "pool-ball-bounce-off-rail.wav by mccarthy@bedmas.com"
        if " by " in label:
            title, _, author = label.rpartition(" by ")
        else:
            title, author = label, "?"
        out.append((sid, title.strip(), author.strip()))
    # 去重保序
    seen, uniq = set(), []
    for row in out:
        if row[0] not in seen:
            seen.add(row[0])
            uniq.append(row)
    return uniq


def search(q, cc0=False, page=1):
    url = "https://freesound.org/search/?q=%s" % q.replace(" ", "+")
    if cc0:
        url += "&f=license%%3A%%22Creative+Commons+0%%22"
    if page > 1:
        url += "&page=%d" % page
    return parse(fetch(url))


def similar(sid):
    url = "https://freesound.org/people/x/sounds/%s/similar/?ajax=1" % sid
    return parse(fetch(url))


# 详情页里的授权链接。NC（非商业）必须排除，本项目不允许引入。
#
# 两种形态都要认：
#   CC-BY 系 -> creativecommons.org/licenses/by/3.0/
#   CC0      -> creativecommons.org/publicdomain/zero/1.0/
# 只认 /licenses/ 会把 CC0 全部漏判成"未知"。
RE_LIC_URL = re.compile(
    r'href="https?://creativecommons\.org/(?:licenses/([a-z\-]+)/|publicdomain/zero/)'
    r'([0-9]+\.[0-9]+)/?"')
RE_SOUND_PAGE = re.compile(r'href="(/people/[^/]+/sounds/(\d+)/)"')

# 短名 -> 是否可商用
LIC_OK = {
    "by": ("CC-BY", True),
    "by-sa": ("CC-BY-SA", True),
    "zero": ("CC0", True),
    "publicdomain": ("Public Domain", True),
    "by-nc": ("CC-BY-NC", False),
    "by-nc-sa": ("CC-BY-NC-SA", False),
    "by-nc-nd": ("CC-BY-NC-ND", False),
    "by-nd": ("CC-BY-ND", True),   # 可商用，但禁止演绎 —— 切片算演绎，实际也不用
    "sampling+": ("Sampling+", True),
}


def license_of(author, sid):
    """返回 (短名, 版本, 是否可商用, 详情页 URL)。查不到返回 (None,...)。"""
    url = "https://freesound.org/people/%s/sounds/%s/" % (author, sid)
    h = fetch(url)
    m = RE_LIC_URL.search(h)
    if not m:
        # 抓不到授权链接时，先看是不是页面根本不存在（id/作者配错会走到这里）
        if re.search(r"<title>Freesound - Page not found", h):
            return ("PAGE-NOT-FOUND", "", False, url)
        return (None, None, False, url)
    short, ver = m.group(1), m.group(2)
    if short is None:          # publicdomain/zero 分支
        short = "zero"
    name, ok = LIC_OK.get(short, (short, False))
    return (name, ver, ok, url)


def check_licenses(items):
    """
    items: [(sid, title, author), ...] -> 打印「标题+作者+授权」合并表。

    合并成一张表是有原因的：分两张表输出时，我横向对照抄错过行，
    把 Jellytots_Julie 的库边音当成了 ChloePieterse 的击球音，
    结果拿着错的 (作者,id) 去下载直接吃到 404。id/标题/作者必须同行。
    """
    print("%-8s %-38s %-20s %-12s %-6s %s" % (
        "id", "标题", "作者", "授权", "版本", "可商用"))
    print("-" * 100)

    # 逐条抓详情页是纯 IO，串行跑 50 条要几分钟，并行 8 路压到几十秒
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(license_of, author, sid)
                for sid, title, author in items]
        res = [f.result() for f in futs]

    for (sid, title, author), (name, ver, ok, url) in zip(items, res):
        print("%-8s %-38s %-20s %-12s %-6s %s" % (
            sid, title[:38], author[:20], name or "?", ver,
            "OK" if ok else "NO"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="?")
    ap.add_argument("--cc0", action="store_true")
    ap.add_argument("--similar")
    ap.add_argument("--pages", type=int, default=1)
    ap.add_argument("--lic", action="store_true",
                    help="对搜索结果逐条查询授权（慢，逐条抓详情页）")
    a = ap.parse_args()

    rows = []
    if a.similar:
        rows = similar(a.similar)
        print("== similar to %s ==" % a.similar)
    elif a.query:
        for p in range(1, a.pages + 1):
            rows += search(a.query, a.cc0, p)
        print('== search "%s"%s ==' % (a.query, " [CC0]" if a.cc0 else ""))
    else:
        ap.error("需要 query 或 --similar")

    if not rows:
        print("(无结果)")
        return
    print("%-8s %-46s %s" % ("id", "标题", "作者"))
    print("-" * 90)
    for sid, title, author in rows:
        print("%-8s %-46s %s" % (sid, title[:46], author[:34]))
    print("\n共 %d 条" % len(rows))

    if a.lic:
        print()
        check_licenses(rows)


if __name__ == "__main__":
    sys.exit(main())
