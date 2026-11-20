#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从私有全量库中裁出「5 条试用模版」，生成开源仓库用的 data/library.json + data/library.js。

私有全量库（含 300+ 条提示词）不随仓库分发；本脚本只做单向裁剪，
在维护者本机运行，产物才是提交进 git 的文件。

用法：
    python3 tools/make_demo_library.py --source /path/to/library.json
    python3 tools/make_demo_library.py --source /path/to/library.json --ids P-258,P-261,V-014

不传 --source 时读环境变量 PROMPTFORGE_PRIVATE_LIBRARY。
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, 'data', 'library.json')
OUT_JS = os.path.join(ROOT, 'data', 'library.js')

# 默认 5 条：3 图 2 视频，全部为产品 / 排版 / 广告类题材，不含人像私房内容
DEFAULT_IDS = ['P-258', 'P-261', 'P-265', 'V-014', 'V-083']

# 附带保留的辅助数据（属于方法论而非提示词资产）：参数表 / 编辑工作流 / 词库
KEEP_PARAMS = 6
KEEP_EDITS = 3
KEEP_LEXICON_SLOTS = ('主体', '人物特征', '服饰造型', '场景环境', '光影', '风格')


def load_source(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=os.environ.get('PROMPTFORGE_PRIVATE_LIBRARY'))
    ap.add_argument('--ids', default=','.join(DEFAULT_IDS))
    ap.add_argument('--out-json', default=OUT_JSON)
    ap.add_argument('--out-js', default=OUT_JS)
    args = ap.parse_args()

    if not args.source or not os.path.exists(args.source):
        print('缺少私有库路径：用 --source 指定，或设置 PROMPTFORGE_PRIVATE_LIBRARY', file=sys.stderr)
        return 2

    lib = load_source(args.source)
    wanted = [x.strip() for x in args.ids.split(',') if x.strip()]

    pool = {p['id']: p for p in lib.get('image', []) + lib.get('video', [])}
    missing = [i for i in wanted if i not in pool]
    if missing:
        print('私有库中找不到：', ', '.join(missing), file=sys.stderr)
        return 3

    picked = [pool[i] for i in wanted]
    images = [p for p in picked if p.get('type') != '视频']
    videos = [p for p in picked if p.get('type') == '视频']

    lexicon = lib.get('lexicon', [])
    # 词库是通用方法论词汇（10 个段落 / 100+ 维度），不属于提示词资产，整份保留；
    # 只裁提示词条与参数表，避免私有内容进仓库。
    keep_lex = list(lexicon)

    demo = {
        'meta': {
            'title': 'PromptForge 试用模版库',
            'builtAt': '',
            'source': '开源试用模版（%d 条，私有全量库不随仓库分发）' % len(picked),
            'counts': {
                'image': len(images),
                'video': len(videos),
                'params': min(KEEP_PARAMS, len(lib.get('params', []))),
                'edits': min(KEEP_EDITS, len(lib.get('edits', []))),
                'lexicon': len(keep_lex),
                'guide': len(lib.get('guide', [])),
            },
        },
        'image': images,
        'video': videos,
        'params': lib.get('params', [])[:KEEP_PARAMS],
        'edits': lib.get('edits', [])[:KEEP_EDITS],
        'lexicon': keep_lex,
        'guide': lib.get('guide', []),
    }

    os.makedirs(os.path.dirname(args.out_json), exist_ok=True)
    with open(args.out_json, 'w', encoding='utf-8') as f:
        json.dump(demo, f, ensure_ascii=False, indent=1)
    with open(args.out_js, 'w', encoding='utf-8') as f:
        f.write('window.__LIB__=' + json.dumps(demo, ensure_ascii=False, separators=(',', ':')) + ';\n')

    print('示例库已生成：%d 图 / %d 视频 / 参数 %d / 编辑 %d / 词库 %d / 指南 %d'
          % (len(images), len(videos), demo['meta']['counts']['params'],
             demo['meta']['counts']['edits'], len(keep_lex), len(demo['guide'])))
    print('  条目：', ', '.join('%s %s' % (p['id'], p['name']) for p in picked))
    return 0


if __name__ == '__main__':
    sys.exit(main())
