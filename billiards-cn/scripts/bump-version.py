#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动迭代「对外发布语义版本号」v1.3.N。

每次代码变更 / 发布前运行本脚本，无需人工追踪版本号：
  - 自动扫描 dist/index.html、dist/menu.html，找出当前最大 v1.3.N
  - 版本号 +1，得到新版本
  - dist/index.html：全局替换所有 v1.3.N（含 href 里的 apk/zip 文件名）
  - dist/menu.html：保留旧章节不动，仅在顶部「变更履历」插入新版本骨架章节
  - src/utils/version.ts：刷新时间戳版本（YYMMDD.HH）

用法：
  python3 scripts/bump-version.py ["本次变更摘要(可选，中文)"]
  摘要会写进新版本章节标题下方。不传则留占位提示。

注意：脚本只管「版本号 +1 与同步」，新章节的详细条目需后续手动补充或下次传入。
"""
import os
import re
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "dist", "index.html")
MENU = os.path.join(ROOT, "dist", "menu.html")
VERSION_TS = os.path.join(ROOT, "src", "utils", "version.ts")

VER_RE = re.compile(r"v1\.3\.(\d+)")


def current_max_version():
    """扫描两文件，返回当前最大 v1.3.N 的 N（int）。

    两个文件要用不同策略，都不能简单对全文扫：

    index.html 是下载页，v1.3.N 只出现在版本标题与 apk/zip 文件名里，可以全文扫，
    但要先剥离 HTML 注释——源码里常有形如
        <!-- 球杆 3D 预览浮层（v1.3.52：…） -->
    的注释，写的正是「正在开发、即将发布的版本号」，算进去就会凭空多跳一档。

    menu.html 则必须只认权威位置：版本标题「<h3>v1.3.N · ...」与
    __BILLIARDS_VERSION__。因为变更履历的正文里会引用其它版本号（例如本版本
    条目里写的「导致脚本认为 v1.3.52 已是旧版本、直接跳到 v1.3.53」），
    全文扫会把正文里提到的未来版本号误判成当前版本。
    """
    max_n = 0

    if os.path.exists(INDEX):
        with open(INDEX, "r", encoding="utf-8") as f:
            txt = re.sub(r"<!--.*?-->", "", f.read(), flags=re.S)
        for m in VER_RE.finditer(txt):
            max_n = max(max_n, int(m.group(1)))

    if os.path.exists(MENU):
        with open(MENU, "r", encoding="utf-8") as f:
            txt = f.read()
        # 变更履历的版本标题：<h3>v1.3.52 · 2026-08-29 16:29:51</h3>
        for m in re.finditer(r"<h3>v1\.3\.(\d+)\s*[·・]", txt):
            max_n = max(max_n, int(m.group(1)))
        # 运行时版本号：window.__BILLIARDS_VERSION__ = "1.3.52-26082916"
        for m in re.finditer(r'__BILLIARDS_VERSION__\s*=\s*"1\.3\.(\d+)', txt):
            max_n = max(max_n, int(m.group(1)))

    return max_n


def bump_index(old, new):
    """index.html 全局替换：所有 v1.3.N -> v1.3.new（含文件名）。"""
    with open(INDEX, "r", encoding="utf-8") as f:
        txt = f.read()
    # 替换所有 v1.3.<old> 为 v1.3.<new>。用精确模式避免误改 v1.3.39x
    pat = re.compile(r"v1\.3\.%d\b" % old)
    count = len(pat.findall(txt))
    txt = pat.sub("v1.3.%d" % new, txt)
    with open(INDEX, "w", encoding="utf-8") as f:
        f.write(txt)
    return count


def bump_menu(old, new, summary):
    """menu.html：保留旧章节，顶部插入新版本骨架章节；同步 __BILLIARDS_VERSION__。"""
    with open(MENU, "r", encoding="utf-8") as f:
        txt = f.read()

    # 同步 window.__BILLIARDS_VERSION__，只改主版本号、保留时间戳后缀
    ver_pat = re.compile(r'(__BILLIARDS_VERSION__\s*=\s*")1\.3\.%d(-[^"]+)(")' % old)
    txt = ver_pat.sub(r'\g<1>1.3.%d\g<2>\g<3>' % new, txt)

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sum_text = summary or "（本次变更说明待补充）"

    # 把 summary 拆成多个子项，生成与历史版本一致的详细条目格式。
    # 优先提取 "（A · B · C）" 中的子项；没有括号时按 "；" 拆分；只有一段时作为单一条目。
    items = []
    bracket = re.search(r'[（(]([^()]+)[）)]', sum_text)
    if bracket:
        inner = bracket.group(1)
        parts = [p.strip() for p in re.split(r'[·•,，;；]', inner) if p.strip()]
        for p in parts:
            items.append(f'              <li><b>{p}</b>：详细说明待补充。</li>')
    else:
        parts = [p.strip() for p in re.split(r'[;；]', sum_text) if p.strip()]
        if len(parts) > 1:
            for p in parts:
                items.append(f'              <li><b>{p}</b>：详细说明待补充。</li>')
        else:
            items.append(f'              <li><b>本次变更</b>：{sum_text}，详细说明待补充。</li>')

    items_html = "\n".join(items)

    # 新章节 HTML 骨架（与现有 setting-group / 多 li 详细格式一致）
    new_block = (
        '\n\n          <div class="setting-group">\n'
        f'            <h3>v1.3.{new} · {now}</h3>\n'
        f'            <p class="about-text dim"><b>{sum_text}</b></p>\n'
        '            <ul class="about-text dim">\n'
        f'{items_html}\n'
        '              <li>约束：仅改展示层，不改动任何物理逻辑、挥杆动画、碰撞参数；已重签 APK 并重新发布。</li>\n'
        '            </ul>\n'
        '          </div>\n'
    )

    # 插入点：必须在「变更履历屏」#screen-changelog 内、第一个 <div class="setting-group">
    # （即当前置顶条目 v1.3.39）之前；绝不能再插到「游戏设置」屏顶部。
    sc_idx = txt.find('id="screen-changelog"')
    if sc_idx == -1:
        print("  [warn] menu.html 未找到 #screen-changelog，跳过 menu 变更履历更新")
        return 0
    marker = '<div class="setting-group">'
    grp_idx = txt.find(marker, sc_idx)
    if grp_idx == -1:
        print("  [warn] #screen-changelog 内未找到插入锚点，跳过 menu 变更履历更新")
        return 0
    raw_prefix = txt[:grp_idx]
    # 只剥离换行/空行，保留下一章节原有的缩进空白（否则每次迭代都会把
    # 紧随其后的 <div class="setting-group"> 缩进吃掉一格，格式逐版劣化）
    indent = raw_prefix[len(raw_prefix.rstrip()):]
    prefix = raw_prefix.rstrip()
    txt = prefix + new_block + indent + txt[grp_idx:]
    with open(MENU, "w", encoding="utf-8") as f:
        f.write(txt)
    return 1


def bump_version_ts():
    """刷新 src/utils/version.ts 的时间戳版本。"""
    d = datetime.now()
    v = "%02d%02d%02d.%02d" % (d.year % 100, d.month, d.day, d.hour)
    if os.path.exists(VERSION_TS):
        with open(VERSION_TS, "r", encoding="utf-8") as f:
            txt = f.read()
        txt = re.sub(r"export const VERSION = '[^']*';",
                     "export const VERSION = '%s';" % v, txt)
        with open(VERSION_TS, "w", encoding="utf-8") as f:
            f.write(txt)
    else:
        with open(VERSION_TS, "w", encoding="utf-8") as f:
            f.write("export const VERSION = '%s';\n" % v)
    return v


def main():
    summary = sys.argv[1] if len(sys.argv) > 1 else ""
    old = current_max_version()
    if old == 0:
        print("[error] 未在任何文件中找到 v1.3.N 版本号，终止。")
        sys.exit(1)
    new = old + 1

    print(f"当前版本: v1.3.{old}  ->  新版本: v1.3.{new}")

    c1 = bump_index(old, new)
    print(f"  index.html 替换 {c1} 处 v1.3.{old}")

    c2 = bump_menu(old, new, summary)
    print(f"  menu.html 插入新章节: {'是' if c2 else '否'}")

    vts = bump_version_ts()
    print(f"  version.ts 刷新为: {vts}")

    print(f"\n完成。新版本 v1.3.{new} 已同步到 index.html / menu.html / version.ts")
    print(f"后续请记得：补充 menu.html 新章节的详细条目，然后构建 APK + 发布。")


if __name__ == "__main__":
    main()
