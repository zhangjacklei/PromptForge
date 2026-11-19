#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 src/ + data/library.js 打包成单文件 Resources/web/index.html（零外链，供 App 内置）。

用法: python3 tools/build_web.py
"""
import datetime
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
OUT_DIR = os.path.join(ROOT, 'Sources', 'PromptForge', 'Resources', 'web')
OUT = os.path.join(OUT_DIR, 'index.html')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def main():
    html = read(os.path.join(SRC, 'index.html'))
    css = read(os.path.join(SRC, 'styles.css'))
    lib = read(os.path.join(ROOT, 'data', 'library.js'))
    bench = read(os.path.join(SRC, 'bench.js'))
    eng = read(os.path.join(SRC, 'engine.js'))
    app = read(os.path.join(SRC, 'app.js'))

    html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>')
    html = html.replace('<script src="../data/library.js"></script>', '<script>\n' + lib + '\n</script>')
    html = html.replace('<script src="bench.js"></script>', '<script>\n' + bench + '\n</script>')
    html = html.replace('<script src="engine.js"></script>', '<script>\n' + eng + '\n</script>')
    html = html.replace('<script src="app.js"></script>', '<script>\n' + app + '\n</script>')

    img_n = len(re.findall(r'"id":"P-', lib))
    vid_n = len(re.findall(r'"id":"V-', lib))
    today = datetime.date.today().isoformat()
    html = html.replace('<meta name="viewport"',
                        '<meta name="pf-build" content="demo %s · %d 图 / %d 视频">\n<meta name="viewport"'
                        % (today, img_n, vid_n))

    left = re.findall(r'(?:src|href)="(?!data:|#)[^"]+\.(?:js|css)"', html)
    if left:
        print('⚠️ 仍有外链:', left)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('已生成 %s  %.0f KB  (示例 %d 图 / %d 视频)'
          % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024, img_n, vid_n))
    return 0


if __name__ == '__main__':
    sys.exit(main())
