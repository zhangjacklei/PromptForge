#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成应用图标（纯几何绘制，不含任何第三方素材）。

产物：
  Resources/AppIcon.icns                                  —— macOS 打包用
  Resources/Assets.xcassets/AppIcon.appiconset/*.png      —— Xcode（iOS / macOS）用

用法: python3 tools/make_icon.py
"""
import json
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONSET = os.path.join(ROOT, 'build', 'AppIcon.iconset')
ICNS = os.path.join(ROOT, 'Resources', 'AppIcon.icns')
ASSETS = os.path.join(ROOT, 'Resources', 'Assets.xcassets', 'AppIcon.appiconset')

BG_TOP = (32, 32, 38)
BG_BOTTOM = (14, 14, 17)
ACCENT = (232, 176, 75)
ACCENT_DIM = (150, 110, 44)

ICNS_SIZES = [
    ('icon_16x16.png', 16), ('icon_16x16@2x.png', 32),
    ('icon_32x32.png', 32), ('icon_32x32@2x.png', 64),
    ('icon_128x128.png', 128), ('icon_128x128@2x.png', 256),
    ('icon_256x256.png', 256), ('icon_256x256@2x.png', 512),
    ('icon_512x512.png', 512), ('icon_512x512@2x.png', 1024),
]


def render(size):
    """黑底 + 双菱形（锻造台的炉口意象），无文字、无外链素材。"""
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))

    # 圆角矩形底：macOS 图标惯例留 ~8% 边距，iOS 会自动裁圆角，这里统一画满即可
    pad = int(s * 0.06)
    radius = int(s * 0.22)
    bg = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    bgd = ImageDraw.Draw(bg)
    bgd.rounded_rectangle([pad, pad, s - pad, s - pad], radius=radius, fill=BG_TOP + (255,))

    # 竖向渐变
    grad = Image.new('L', (1, s), 0)
    for y in range(s):
        grad.putpixel((0, y), int(90 * (1 - y / s)))
    shade = Image.new('RGBA', (s, s), BG_BOTTOM + (255,))
    mask = grad.resize((s, s))
    bg = Image.composite(shade, bg, mask.point(lambda v: v // 2))

    d = ImageDraw.Draw(bg)
    cx, cy = s / 2, s / 2
    outer = s * 0.30
    inner = s * 0.155

    def diamond(r, fill):
        d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=fill)

    diamond(outer, ACCENT_DIM + (255,))
    diamond(outer * 0.86, ACCENT + (255,))
    diamond(inner, BG_TOP + (255,))
    diamond(inner * 0.42, ACCENT + (255,))

    return bg.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(ICONSET, exist_ok=True)
    for name, size in ICNS_SIZES:
        render(size).save(os.path.join(ICONSET, name))

    if shutil.which('iconutil'):
        subprocess.run(['iconutil', '-c', 'icns', ICONSET, '-o', ICNS], check=True)
        print('已生成', os.path.relpath(ICNS, ROOT))
    else:
        print('未找到 iconutil，跳过 .icns', file=sys.stderr)

    os.makedirs(ASSETS, exist_ok=True)
    images = []
    # macOS：经典 10 档
    for base in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            px = base * scale
            fname = 'icon_%dx%d%s.png' % (base, base, '@2x' if scale == 2 else '')
            render(px).save(os.path.join(ASSETS, fname))
            images.append({
                'filename': fname,
                'idiom': 'mac',
                'scale': '%dx' % scale,
                'size': '%dx%d' % (base, base),
            })
    # iOS：单尺寸 1024（Xcode 14+ 支持单尺寸 App Icon）
    render(1024).save(os.path.join(ASSETS, 'icon_ios_1024.png'))
    images.append({
        'filename': 'icon_ios_1024.png',
        'idiom': 'universal',
        'platform': 'ios',
        'scale': '1x',
        'size': '1024x1024',
    })
    with open(os.path.join(ASSETS, 'Contents.json'), 'w', encoding='utf-8') as f:
        json.dump({'images': images, 'info': {'author': 'xcode', 'version': 1}}, f, indent=2)
    print('已生成', os.path.relpath(ASSETS, ROOT), len(images), '项')


if __name__ == '__main__':
    main()
