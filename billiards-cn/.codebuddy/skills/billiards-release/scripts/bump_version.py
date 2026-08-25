#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
billiards-release · 版本号三位一体迭代（机械部分）

把 billiards-cn 的版本号在「menu.html / index.html / APK 内部」三处同步迭代。
APK 内部版本由 build-apk.sh 在构建时自动从 menu.html 同步，本脚本只负责
menu.html 与 index.html 两处，以及插入新的更新日志标题、重命名 3 个 .md 文件。

用法：
    python3 bump_version.py <NEW_VERSION> [NEW_TS] [NEW_DATE]
      NEW_VERSION  如 1.3.23
      NEW_TS       如 2608251430（缺省取 date +%y%m%d%H%M）
      NEW_DATE     如 "2026-08-25 14:30:00"（缺省取当前时间）

注意：
    - 本脚本只改「版本号引用」与「更新日志标题占位」；
      menu.html 新版本的 changelog 正文、index.html 的营销文案、3 个 .md 的内容，
      仍需人工/ Agent 填写（脚本会打印提醒）。
    - 不要对 .md 内容做机械替换，容易把历史版本号错误改写。
"""

import re
import os
import sys
import datetime

REPO = "/workspace/repo/billiards-cn"
MENU = os.path.join(REPO, "dist", "menu.html")
INDEX = os.path.join(REPO, "dist", "index.html")


def main():
    if len(sys.argv) < 2:
        print("用法: bump_version.py <NEW_VERSION> [NEW_TS] [NEW_DATE]")
        sys.exit(1)

    NEW = sys.argv[1]
    now = datetime.datetime.now()
    NEW_TS = sys.argv[2] if len(sys.argv) > 2 else now.strftime("%y%m%d%H%M")
    NEW_DATE = sys.argv[3] if len(sys.argv) > 3 else now.strftime("%Y-%m-%d %H:%M:%S")
    patch = NEW.split(".")[-1]
    NEWCODE = NEW_TS[:6] + patch  # 如 260825 + 22 = 26082522

    # 从 menu.html 探测 OLD
    mtxt = open(MENU, encoding="utf-8").read()
    mm = re.search(r'__BILLIARDS_VERSION__\s*=\s*"([^"]+)"', mtxt)
    if not mm:
        print("ERROR: 在 menu.html 找不到 __BILLIARDS_VERSION__")
        sys.exit(1)
    OLD_RAW = mm.group(1)
    OLD = OLD_RAW.split("-")[0]

    itxt = open(INDEX, encoding="utf-8").read()
    im = re.search(r'versionCode\s+(\d+)', itxt)
    OLDCODE = im.group(1) if im else "?"

    print(f"OLD={OLD} (raw {OLD_RAW}, code {OLDCODE})  ->  NEW={NEW} (ts {NEW_TS}, code {NEWCODE})")
    if OLD == NEW:
        print("WARN: NEW 与当前版本相同，未做替换。若确实要重打包请直接用 release.sh。")
        sys.exit(0)

    # ---- menu.html：版本号 + 插入新版本更新日志块 ----
    mtxt = mtxt.replace(
        '__BILLIARDS_VERSION__ = "%s"' % OLD_RAW,
        '__BILLIARDS_VERSION__ = "%s-%s"' % (NEW, NEW_TS),
    )
    block = (
        '          <div class="setting-group">\n'
        f'            <h3>v{NEW} · {NEW_DATE}</h3>\n'
        '            <p class="about-text dim"><b>在此填写本版标题（如「N 项优化（...）」）：</b></p>\n'
        '            <ul class="changelog-list">\n'
        '              <li><b>本版要点</b>：TODO —— 参考上一版写法逐条列出；英文版需同步在 TX 字典加条目。</li>\n'
        '            </ul>\n'
        '          </div>\n\n'
    )
    # 在第一个 <div class="setting-group"> 之前插入，使新版本置顶
    idx = mtxt.find('          <div class="setting-group">')
    if idx == -1:
        print("ERROR: menu.html 未找到更新日志容器")
        sys.exit(1)
    mtxt = mtxt[:idx] + block + mtxt[idx:]
    open(MENU, "w", encoding="utf-8").write(mtxt)

    # ---- index.html：结构化版本引用 ----
    itxt = itxt.replace("billiards-cn-v%s.apk" % OLD, "billiards-cn-v%s.apk" % NEW)
    itxt = itxt.replace("taiqiu-v%s-release.zip" % OLD, "taiqiu-v%s-release.zip" % NEW)
    itxt = itxt.replace("MIGRATION-v1.3.10-to-v%s.md" % OLD, "MIGRATION-v1.3.10-to-v%s.md" % NEW)
    itxt = itxt.replace("GITHUB-RELEASE-NOTES-v%s.md" % OLD, "GITHUB-RELEASE-NOTES-v%s.md" % NEW)
    itxt = itxt.replace("GITHUB-PUBLISH-GUIDE-v%s.md" % OLD, "GITHUB-PUBLISH-GUIDE-v%s.md" % NEW)
    itxt = itxt.replace('<span class="ver">v%s</span>' % OLD, '<span class="ver">v%s</span>' % NEW)
    itxt = itxt.replace("v%s 发布中心" % OLD, "v%s 发布中心" % NEW)
    itxt = itxt.replace(
        "versionName %s · versionCode %s · git tag v%s" % (OLD, OLDCODE, OLD),
        "versionName %s · versionCode %s · git tag v%s" % (NEW, NEWCODE, NEW),
    )
    # 当前版本营销文案（仅本版，不含历史）：跟随新版本号
    itxt = itxt.replace("v%s 新增" % OLD, "v%s 新增" % NEW)
    itxt = itxt.replace("v%s 新功能" % OLD, "v%s 新功能" % NEW)
    itxt = itxt.replace("v%s 一并生效" % OLD, "v%s 一并生效" % NEW)
    open(INDEX, "w", encoding="utf-8").write(itxt)

    # ---- 重命名实际 .md 文件（内容需人工更新）----
    for name in [
        "MIGRATION-v1.3.10-to-v%s.md" % OLD,
        "GITHUB-RELEASE-NOTES-v%s.md" % OLD,
        "GITHUB-PUBLISH-GUIDE-v%s.md" % OLD,
    ]:
        src = os.path.join(REPO, "dist", name)
        if os.path.exists(src):
            dst = src.replace("v%s.md" % OLD, "v%s.md" % NEW)
            os.rename(src, dst)
            print("已重命名 %s -> %s（内容需人工重新生成）" % (name, os.path.basename(dst)))

    print("\n完成。请人工补完：")
    print("  ① menu.html 新版本 <div class=\"setting-group\"> 内的 changelog 正文；")
    print("  ② index.html 营销文案中本版描述（如「v%s 新功能：...」）；" % NEW)
    print("  ③ 重新生成上述 3 个 .md 的内容；")
    print("  ④ 跑 scripts/release.sh %s 完成构建 / 打包 / 发布。" % NEW)


if __name__ == "__main__":
    main()
