#!/usr/bin/env python3
"""
量化「瞄准视角的画面被什么占据」。

对已渲染的截图逐行统计：
  · 台呢绿占比（g 明显大于 r、b）
  · 平均亮度
并换算「屏幕某一行 → 相机前方某距离处的世界高度」，回答：
  用户在这个机位下，究竟能看到多高的东西。
"""
import sys
from PIL import Image

R = 0.028575


def is_cloth(r, g, b):
    return g > r + 12 and g > b + 12


def lum(r, g, b):
    return round(0.2126 * r + 0.7152 * g + 0.0722 * b)


def analyse(path, cam_z=None, dist=None, fov=45.0):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()

    print(f"\n{'=' * 76}")
    print(f"{path}   画布 {W}x{H}")
    print("=" * 76)

    BANDS = 20
    cloth_all = 0
    tot_all = 0
    print("  屏幕位置    台呢占比   平均亮度   可视化")
    rows = []
    for b in range(BANDS):
        y0, y1 = b * H // BANDS, (b + 1) * H // BANDS
        cn = n = lsum = 0
        for y in range(y0, y1, 2):
            for x in range(0, W, 3):
                r, g, bl = px[x, y]
                if is_cloth(r, g, bl):
                    cn += 1
                lsum += lum(r, g, bl)
                n += 1
        cloth_all += cn
        tot_all += n
        pct = cn * 100.0 / n
        ml = lsum // n
        mid = (y0 + y1) // 2
        rows.append((mid * 100 // H, pct, ml))
        print(
            f"  {mid * 100 // H:3d}% (y={mid:3d})  {pct:5.1f}%   L={ml:3d}   {'█' * int(pct / 4)}"
        )
    print("-" * 76)
    print(f"全屏台呢占比：{cloth_all * 100.0 / tot_all:.1f}%")

    if cam_z is not None:
        import math

        d = dist if dist is not None else R * 24
        print(f"\n相机高 z={cam_z:.3f}m，注视前方 {d:.3f}m 处（FOV {fov}°）：")
        print(" 屏幕行 → 仰角 → 该距离处可见的世界高度")
        for frac in [0.0, 0.10, 0.20, 0.30, 0.40, 0.5, 0.75, 1.0]:
            ndc = 1 - 2 * frac
            ang = math.atan(ndc * math.tan(math.radians(fov / 2)))
            h = cam_z + math.tan(ang) * d
            print(
                f"   {frac * 100:3.0f}%  →  {math.degrees(ang):6.2f}°  →  {h:6.2f} m"
            )


if __name__ == "__main__":
    for p in sys.argv[1:]:
        analyse(p, cam_z=R * 9)
