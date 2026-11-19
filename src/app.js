/* =========================================================================
 * PromptForge · 界面层 v3
 * 七个模块：装配 / 词库 / 库 / 采集 / 实验 / 竞品 / 方案
 * v2 落地：数据体检、可用模型多值、seed 与产出回流、版本 diff、A/B 矩阵、
 *          ComfyUI JSON、负向词库、失败案例库、PNG 反推、LoRA 绑定、
 *          多模型同题、三层标签、采集审核、缺口节奏
 * v3 落地（取长补短，见「竞品」页）：命令面板、配方库、工作区备份、
 *          四种模板语法导出、规范断言套件、相似反查、检索直达、长度预算、多格式落地
 * ========================================================================= */
(function () {
  'use strict';
  const PF = window.PF;
  const { LIB, MODELS, SEGMENTS, ORDER, ASPECTS, SLOT_DIMS, MOD_DIMS, SOUND_CHIPS, U,
    build, buildTemplate, lint, score, resolve, decompose, decomposeVideo, analyzeIngest,
    randomState, variants, searchPlan, lexWords, pick,
    inferModels, tagPath, diffSegs, abMatrix, comfyWorkflow, gapAnalysis, dataHealth,
    pngToPrompt, randSeed, negToPos, posToNeg, FAILURE_DB, LORA_DB, AB_DIMS,
    normalizeSlots, slotsOf, NEG_MAP, NEG_EN,
    lenBudget, templateExports, runAsserts, similarIn, toA1111, toCard, toCsvRow,
    ASSERTS, LEN_BUDGET, wordsOfSlot, slotName } = PF;
  const BENCH = window.PF_BENCH || { RUBRIC: [], SITES: [], REPOS: [], CAPS: [], MATRIX: {}, GAPS: [], BORROW: [] };

  /* ---------------- 持久化 ---------------- */
  const KEY = 'pf.v2';
  let mem = {};
  try { mem = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { mem = {}; }
  mem.versions = mem.versions || {};
  mem.outputs = mem.outputs || {};
  mem.lora = mem.lora || {};
  mem.ab = mem.ab || {};
  mem.queue = mem.queue || [];
  mem.customLora = mem.customLora || [];
  mem.presets = mem.presets || [];
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { } }

  const DEFAULT = {
    model: 'z-turbo', aspect: '3:4', duration: 5, tag: '', grading: 'A',
    denoise: '0.75', negative: '', seed: '', srcImage: '',
    seg: { subject: '', feature: '', outfit: '', action: '', scene: '', camera: '', light: '', style: '', quality: '', sound: '' }
  };
  let state = JSON.parse(JSON.stringify(DEFAULT));
  let manualText = null;
  let tplMode = false;
  let tab = 'compose';
  let loadedId = '';              // 当前装配来源的库条目
  let queue = mem.queue;

  try {
    const saved = JSON.parse(localStorage.getItem('pf.state') || 'null');
    if (saved && saved.seg) state = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), saved);
  } catch (e) { }
  function save() { try { localStorage.setItem('pf.state', JSON.stringify(state)); } catch (e) { } }

  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const curText = () => manualText != null ? manualText : (tplMode ? buildTemplate(state) : build(state).text);
  const vkey = () => (loadedId || 'draft');

  let toastTimer;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1700);
  }
  function copy(text, label) {
    const done = () => toast(label || '已复制');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败'); }
      document.body.removeChild(ta);
    }
  }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function nowTime() {
    const d = new Date();
    return (d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function numOrNaN(v) { return v === '' || v == null ? NaN : Number(v); }

  /* ---------------- 外壳 ---------------- */
  function renderShell() {
    const m = LIB.meta.counts;
    const h = PF.dataHealth();
    $('#stats').innerHTML =
      '<span>生图 <b>' + m.image + '</b></span>' +
      '<span>生视频 <b>' + m.video + '</b></span>' +
      '<span>参数 <b>' + m.params + '</b></span>' +
      '<span>编辑链 <b>' + m.edits + '</b></span>' +
      '<span>词库 <b>' + m.lexicon + '</b></span>' +
      '<span title="数据体检未解决项">体检 <b style="color:' + (h.summary.err ? 'var(--err)' : 'var(--ok)') + '">' + h.summary.total + '</b></span>' +
      '<span class="kbd-hint" id="kbd-hint">⌘K 搜索</span>';
    if (!$('#palette')) {
      const el = document.createElement('div');
      el.id = 'palette'; el.className = 'palette hide';
      el.innerHTML = '<div class="pal-bg"></div><div class="pal"><input type="text" id="pal-q" placeholder="搜条目 / 词 / 失败案例 / 断言 / 功能页…"><div id="pal-list" class="pal-list"></div>' +
        '<div class="pal-foot"><span>↑↓ 选择</span><span>↵ 打开</span><span>esc 关闭</span></div></div>';
      document.body.appendChild(el);
    }
  }

  /* =======================================================================
   * v3 · 命令面板（借 PromptHub / FlowGPT 的快速检索）
   * ===================================================================== */
  let palIdx = 0, palRows = [];

  function palIndex() {
    if (palIndex._cache) return palIndex._cache;
    const rows = [];
    [['compose', '装配'], ['lexicon', '词库'], ['library', '库'], ['ingest', '采集'], ['lab', '实验'], ['bench', '竞品'], ['plan', '方案']]
      .forEach(t => rows.push({ t: '页', n: t[1] + '（切到该页）', s: '导航', go: () => route(t[0]) }));
    LIB.image.forEach(p => rows.push({ t: '图', n: p.id + ' ' + p.name, s: p.tag || '', go: () => { route('compose'); applyFromLibrary(p); toast('已载入 ' + p.id); } }));
    LIB.video.forEach(p => rows.push({ t: '视', n: p.id + ' ' + p.name, s: p.tag || '', go: () => { route('compose'); applyFromLibrary(p); toast('已载入 ' + p.id); } }));
    LIB.edits.forEach(p => rows.push({ t: '编', n: p.id + ' ' + p.name, s: p.route || '', go: () => { route('library'); toast(p.id + ' ' + p.name + '：' + (p.instruction || '').slice(0, 60)); } }));
    LIB.lexicon.forEach(x => {
      (x.words || []).slice(0, 40).forEach(w => rows.push({
        t: '词', n: w, s: x.slot + '·' + x.dim,
        go: () => { route('lexicon'); toast('词库：' + x.slot + ' / ' + x.dim + ' → ' + w); }
      }));
    });
    FAILURE_DB.forEach(f => rows.push({ t: '故', n: f.id + ' ' + f.phen, s: f.model || '', go: () => { failQ = f.name; libTab = 'fail'; route('library'); } }));
    ASSERTS.forEach(a => rows.push({ t: '断', n: a.id + ' ' + a.n, s: a.g, go: () => { libTab = 'assert'; assertOpen = a.id; route('library'); } }));
    palIndex._cache = rows;
    return rows;
  }

  function openPalette() {
    const el = $('#palette'); if (!el) return;
    el.classList.remove('hide');
    const q = $('#pal-q'); q.value = ''; palIdx = 0;
    palRender('');
    setTimeout(() => q.focus(), 20);
  }
  function closePalette() { const el = $('#palette'); if (el) el.classList.add('hide'); }

  function palRender(q) {
    const kw = U.clean(q).toLowerCase();
    const all = palIndex();
    let rows;
    if (!kw) {
      rows = all.filter(r => r.t === '页').concat(all.filter(r => r.t !== '页').slice(0, 8));
    } else {
      rows = all.filter(r => (r.n + ' ' + r.s + ' ' + r.t).toLowerCase().indexOf(kw) >= 0);
      rows.sort((a, b) => (b.n.toLowerCase().indexOf(kw) === 0 ? 1 : 0) - (a.n.toLowerCase().indexOf(kw) === 0 ? 1 : 0));
      rows = rows.slice(0, 40);
    }
    palRows = rows;
    if (palIdx >= rows.length) palIdx = 0;
    const box = $('#pal-list');
    if (!rows.length) { box.innerHTML = '<div class="empty">没有匹配项</div>'; return; }
    box.innerHTML = rows.map((r, i) =>
      '<div class="pal-row' + (i === palIdx ? ' on' : '') + '" data-pal="' + i + '">' +
      '<span class="pal-t">' + r.t + '</span><span class="pal-n">' + U.esc(r.n) + '</span>' +
      '<span class="pal-s">' + U.esc(r.s) + '</span></div>').join('');
    $$('[data-pal]').forEach(d => {
      d.onmouseenter = () => { palIdx = Number(d.dataset.pal); palMark(); };
      d.onclick = () => { const r = palRows[Number(d.dataset.pal)]; if (r) { closePalette(); r.go(); } };
    });
  }
  function palMark() {
    $$('[data-pal]').forEach(d => d.classList.toggle('on', Number(d.dataset.pal) === palIdx));
    const on = $('.pal-row.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  function renderTabs() {
    $$('#tabs button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  }

  function route(next) {
    tab = next; renderTabs();
    const view = $('#view'); view.scrollTop = 0;
    if (tab === 'compose') renderCompose();
    else if (tab === 'lexicon') renderLexicon();
    else if (tab === 'library') renderLibrary();
    else if (tab === 'ingest') renderIngest();
    else if (tab === 'lab') renderLab();
    else if (tab === 'bench') renderBench();
    else renderBlueprint();
  }

  /* =======================================================================
   * 装配
   * ===================================================================== */
  const activeDim = {};

  function renderCompose() {
    const order = ORDER[state.model] || ORDER['z-turbo'];
    const slotSegs = SEGMENTS.filter(s => s.slot && order.indexOf(s.k) >= 0);
    const modSegs = SEGMENTS.filter(s => s.para && order.indexOf(s.k) >= 0);
    const isVideo = MODELS[state.model].kind === 'video';

    $('#view').innerHTML =
      '<div class="compose">' +
      '<section class="compose-left">' +

      '<div class="block"><div class="block-h"><h3>目标模型</h3><span class="tag">换模型 = 换写法 + 换参数</span></div>' +
      '<div class="model-grid">' + Object.keys(MODELS).map(k => {
        const m = MODELS[k];
        return '<div class="model-card' + (k === state.model ? ' on' : '') + '" data-model="' + k + '">' +
          '<span class="badge">' + m.badge + '</span><b>' + m.name + '</b><small>' + m.desc + '</small></div>';
      }).join('') + '</div></div>' +

      '<div class="block"><div class="block-h"><h3>基础设定</h3>' +
      '<div class="right"><button class="btn sm" id="btn-random">随机灵感</button>' +
      '<button class="btn sm" id="btn-clear">清空</button></div></div>' +
      '<div class="row">' +
      '<div><label class="f">用途标签</label><input type="text" id="f-tag" placeholder="人像 / 电商 / 古风…" value="' + U.esc(state.tag) + '"></div>' +
      '<div><label class="f">画幅</label><select id="f-aspect">' +
      ASPECTS.map(a => '<option value="' + a + '"' + (a === state.aspect ? ' selected' : '') + '>' + a + '</option>').join('') +
      '</select></div>' +
      (isVideo ? '<div><label class="f">时长（秒）</label><input type="number" id="f-dur" min="4" max="15" step="1" value="' + state.duration + '"></div>' : '') +
      '<div><label class="f">Seed</label><input type="text" id="f-seed" placeholder="留空=随机" value="' + U.esc(state.seed) + '"></div>' +
      '<div class="load-cell"><label class="f">从库载入 · ' + (isVideo ? '生视频' : '生图') + ' ' + (isVideo ? LIB.video.length : LIB.image.length) + ' 条</label>' +
      '<select id="f-load"><option value="">选择一条…</option>' +
      (isVideo ? LIB.video : LIB.image).map(p => '<option value="' + p.id + '">' + p.id + ' ' + U.esc(p.name) + '</option>').join('') +
      '</select></div>' +
      '</div></div>' +

      '<div class="block"><div class="block-h"><h3>槽位</h3><span class="tag">点词即插入，可自由改写</span></div>' +
      '<div id="slots">' + slotSegs.map(renderSlotCard).join('') + '</div></div>' +

      '<div class="block"><div class="block-h"><h3>段落修饰</h3><span class="tag">顺序按模型自动排列</span></div>' +
      '<div id="mods">' + modSegs.map(renderModRow).join('') + '</div></div>' +

      '<div class="block"><div class="block-h"><h3>风格 LoRA</h3><span class="tag">离开配套权重风格不成立</span></div>' +
      '<div class="row"><div><select id="f-lora"><option value="">不绑定</option>' +
      allLora().map(l => '<option value="' + l.id + '"' + (state.lora === l.id ? ' selected' : '') + '>' + U.esc(l.name) + '（' + l.base + '）</option>').join('') +
      '</select></div><div style="flex:0 0 130px"><button class="btn sm" id="btn-lora-add" style="width:100%">+ 自定义 LoRA</button></div></div>' +
      '<div id="lora-note" class="hintline"></div></div>' +

      '<div class="block' + (MODELS[state.model].negative ? '' : ' hide') + '" id="neg-block">' +
      '<div class="block-h"><h3>负面提示词</h3><span class="tag">' + MODELS[state.model].name + ' 支持独立负向</span>' +
      '<div class="right"><button class="btn sm" id="btn-neg-fill">填基础负面</button></div></div>' +
      '<textarea id="f-neg" style="min-height:56px" placeholder="lowres, bad anatomy, extra fingers, watermark">' + U.esc(state.negative) + '</textarea></div>' +

      '</section>' +

      '<aside class="compose-right">' +
      '<div class="block"><div class="pv-head"><h3>提示词</h3>' +
      '<span class="pill" id="pv-mode">' + (tplMode ? '模板版' : '填充版') + '</span>' +
      '<span class="len" id="pv-len"></span></div>' +
      '<textarea id="pv-text"></textarea>' +
      '<div class="pv-actions">' +
      '<button class="btn primary" id="btn-copy">复制提示词</button>' +
      '<button class="btn" id="btn-tpl">' + (tplMode ? '填充版' : '模板版') + '</button>' +
      '</div>' +
      '<div class="pv-actions inline">' +
      '<button class="btn sm" id="btn-var">变体 ×3</button>' +
      '<button class="btn sm" id="btn-comfy">ComfyUI JSON</button>' +
      '<button class="btn sm" id="btn-ver">存为版本</button>' +
      '<button class="btn sm" id="btn-cmp">同题对照</button>' +
      '<button class="btn sm" id="btn-song">导出到负面框</button>' +
      '</div></div>' +

      '<div class="block"><div class="block-h"><h3>参数</h3><span class="tag">自动联动</span></div><div class="params" id="params"></div>' +
      '<div class="pv-actions inline"><button class="btn sm" id="btn-seed">随机 seed</button>' +
      '<button class="btn sm" id="btn-fixseed">按提示词锁定 seed</button></div></div>' +

      '<div class="block"><div class="block-h"><h3>体检</h3><span class="tag" id="lint-count"></span></div><div id="lint"></div></div>' +

      '<div class="block"><div class="block-h"><h3>完整度</h3></div><div class="score-num" id="score-num"></div>' +
      '<div class="score-bar"><i id="score-bar"></i></div><div class="score-detail" id="score-detail"></div></div>' +

      '<div class="block"><div class="block-h"><h3>长度预算</h3><span class="tag" id="lb-tag">—</span></div>' +
      '<div class="lenbar"><i id="lb-bar"></i></div>' +
      '<div class="len-scale"><span id="lb-l"></span><span id="lb-r"></span></div>' +
      '<div class="hintline" id="lb-note"></div></div>' +

      '<details class="block fold"><summary><h3>导出与模板 <span class="tag">四种生态语法</span></h3></summary>' +
      '<div class="pv-actions inline" style="margin-bottom:8px">' +
      '<button class="btn sm" id="btn-exp-a1111">A1111 参数串</button>' +
      '<button class="btn sm" id="btn-exp-card">Markdown 卡片</button>' +
      '<button class="btn sm" id="btn-exp-csv">CSV 行</button>' +
      '</div>' +
      '<div class="hintline" style="margin:8px 0 6px">模板语法（按你用的生态选一种）</div>' +
      '<div class="seg-tabs" id="tpl-tabs">' +
      templateExports(state).map((e, i) => '<button data-tpl="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>' + U.esc(e.tag) + '</button>').join('') +
      '</div>' +
      '<div id="tpl-body"></div></details>' +

      '<details class="block fold"><summary><h3>相似条目 <span class="tag" id="sim-tag">反查库内近邻</span></h3></summary>' +
      '<div class="pv-actions inline"><button class="btn sm" id="btn-sim">反查 Top5</button></div>' +
      '<div id="sim-list" class="sim-wrap"></div></details>' +

      '<details class="block fold"><summary><h3>配方库 <span class="tag" id="pre-n">0</span></h3></summary>' +
      '<div class="form-row"><input type="text" id="pre-name" placeholder="配方名，如「雨夜东京·冷调」">' +
      '<button class="btn sm" id="btn-pre-save">存为配方</button></div>' +
      '<div id="pre-list" class="pre-wrap"></div></details>' +

      '<details class="block fold"><summary><h3>版本记录 <span class="tag" id="ver-n">0</span></h3></summary>' +
      '<div id="ver-list"></div></details>' +

      '<details class="block fold"><summary><h3>出图记录 <span class="tag" id="out-n">0</span></h3></summary>' +
      '<div class="form-row">' +
      '<input type="text" id="o-seed" placeholder="seed">' +
      '<select id="o-rate"><option value="S">S</option><option value="A" selected>A</option><option value="B">B</option><option value="C">C</option></select>' +
      '<button class="btn sm" id="btn-out">记录</button></div>' +
      '<input type="text" id="o-note" placeholder="备注：哪里好 / 哪里崩" style="margin-top:6px">' +
      '<div id="out-list"></div></details>' +

      '</aside></div>';

    bindCompose();
    refresh();
    renderVersions();
    renderOutputs();
  }

  function allLora() { return LORA_DB.concat(mem.customLora); }

  function renderSlotCard(seg) {
    const dims = SLOT_DIMS[seg.slot] || [];
    if (!activeDim[seg.k]) activeDim[seg.k] = dims[0] || '';
    const active = activeDim[seg.k];
    const words = lexWords(active);
    return '<div class="slot" data-slot-card="' + seg.k + '">' +
      '<div class="slot-h"><span class="name">【' + seg.slot + '】</span>' +
      '<span class="cnt">' + seg.hit + '</span>' +
      '<span class="fill" id="fill-' + seg.k + '">未填</span></div>' +
      '<div class="slot-b"><textarea data-seg="' + seg.k + '" placeholder="' + seg.hit + '…">' + U.esc(state.seg[seg.k]) + '</textarea>' +
      '<div class="dim-tabs">' + dims.map(d =>
        '<button class="dtab' + (d === active ? ' on' : '') + '" data-dim="' + U.esc(d) + '" data-slot="' + seg.k + '">' +
        U.esc(d) + '</button>').join('') + '</div>' +
      '<div class="chips" data-chipbox="' + seg.k + '">' + words.map(w =>
        '<button class="chip" data-insert="' + seg.k + '" data-word="' + U.esc(w) + '">' + U.esc(w) + '</button>').join('') +
      '</div></div></div>';
  }

  function renderModRow(seg) {
    const dims = MOD_DIMS[seg.k] || [];
    let chips = [];
    dims.forEach(d => { chips = chips.concat(lexWords(d).slice(0, 14)); });
    if (seg.k === 'sound') chips = SOUND_CHIPS;
    chips = U.uniq(chips).slice(0, 16);
    return '<div class="mod-row"><label>' + (seg.para || seg.label) + '</label><div class="mod-main">' +
      '<input type="text" data-seg="' + seg.k + '" placeholder="' + seg.hit + '…" value="' + U.esc(state.seg[seg.k]) + '">' +
      (chips.length ? '<div class="mini-chips">' + chips.map(w =>
        '<button class="chip" data-insert="' + seg.k + '" data-word="' + U.esc(w) + '">' + U.esc(w) + '</button>').join('') + '</div>' : '') +
      '</div></div>';
  }

  function bindCompose() {
    $$('.model-card').forEach(c => c.onclick = () => {
      state.model = c.dataset.model;
      if (state.model === 'h3' && Number(state.duration) < 4) state.duration = 5;
      const table = PF.RES[MODELS[state.model].resKey] || {};
      if (!table[state.aspect]) state.aspect = Object.keys(table)[0] || state.aspect;
      manualText = null; save(); renderCompose();
    });
    const on = (sel, ev, fn) => { const el = $(sel); if (el) el[ev] = fn; };
    on('#f-tag', 'oninput', e => { state.tag = e.target.value; save(); });
    on('#f-aspect', 'onchange', e => { state.aspect = e.target.value; save(); refresh(); });
    on('#f-dur', 'oninput', e => { state.duration = U.clamp(Number(e.target.value) || 5, 4, 15); save(); refresh(); });
    on('#f-seed', 'oninput', e => { state.seed = e.target.value.trim(); save(); refresh(); });
    on('#f-neg', 'oninput', e => { state.negative = e.target.value; save(); refresh(); });
    on('#f-lora', 'onchange', e => {
      state.lora = e.target.value; save(); drawLoraNote(); refresh();
    });

    on('#btn-lora-add', 'onclick', () => {
      const name = prompt('LoRA 名称（与你本地文件名一致）');
      if (!name) return;
      const base = prompt('适用底模：z-turbo / z-base / sdxl', 'z-turbo') || 'z-turbo';
      const trig = prompt('触发词（没有就留空）', '') || '';
      const w = prompt('推荐权重区间', '0.7–0.9') || '0.7–0.9';
      const id = 'LC-' + (mem.customLora.length + 1);
      mem.customLora.push({ id, name, base, trigger: trig, weight: w, style: '自定义', note: '用户添加' });
      persist(); state.lora = id; save(); renderCompose(); toast('已添加 ' + name);
    });

    on('#f-load', 'onchange', e => {
      const id = e.target.value; if (!id) return;
      // 下拉只列当前目标模型对应的那一类，目标模型是主控，载入不改它
      const isVid = MODELS[state.model].kind === 'video';
      const p = (isVid ? LIB.video : LIB.image).find(x => x.id === id);
      if (!p) return;
      applyFromLibrary(p);
      e.target.value = '';
      toast('已载入 ' + p.id + (isVid ? '（' + p.aspect + '，' + (p.duration || state.duration) + 's）' : '') + '，可在此基础上改');
    });

    on('#btn-random', 'onclick', () => {
      state = randomState(state); manualText = null; save(); renderCompose(); toast('已生成一组随机组合');
    });
    on('#btn-clear', 'onclick', () => {
      Object.keys(state.seg).forEach(k => state.seg[k] = '');
      state.negative = ''; loadedId = ''; manualText = null; save(); renderCompose(); toast('已清空');
    });

    const pv = $('#pv-text');
    if (pv) pv.oninput = e => {
      manualText = e.target.value;
      $('#pv-mode').textContent = '手动编辑';
      refreshMeta();
    };
    on('#btn-copy', 'onclick', () => copy(curText(), '提示词已复制'));
    on('#btn-tpl', 'onclick', () => { tplMode = !tplMode; manualText = null; renderCompose(); });
    on('#btn-var', 'onclick', showVariants);
    on('#btn-comfy', 'onclick', showComfy);
    on('#btn-ver', 'onclick', () => saveVersion());
    on('#btn-cmp', 'onclick', showCompare);
    on('#btn-song', 'onclick', () => { state.negative = NEG_EN.slice(0, 20).join(', '); save(); renderCompose(); toast('已填入基础负面'); });
    on('#btn-neg-fill', 'onclick', () => { state.negative = NEG_EN.slice(0, 20).join(', '); save(); renderCompose(); });
    on('#btn-seed', 'onclick', () => { state.seed = String(randSeed()); save(); renderCompose(); toast('seed 已更新'); });
    on('#btn-fixseed', 'onclick', () => {
      state.seed = String(PF.seedOf(curText())); save(); renderCompose();
      toast('已按提示词锁定 seed，改词才会变');
    });
    on('#btn-out', 'onclick', recordOutput);

    /* ---- v3：长度预算 / 模板导出 / 相似反查 / 配方库 ---- */
    on('#btn-exp-a1111', 'onclick', () => copy(toA1111(state, curText()), 'A1111 参数串已复制，可直接粘进 WebUI'));
    on('#btn-exp-card', 'onclick', () => copy(toCard(state, curText(), { name: state.tag || '未命名' }), 'Markdown 卡片已复制'));
    on('#btn-exp-csv', 'onclick', () => copy(toCsvRow(state, curText()), 'CSV 行已复制，可粘到表格末行'));
    on('#btn-sim', 'onclick', () => { simOn = true; drawSim(); });
    on('#btn-pre-save', 'onclick', savePreset);
    $$('#tpl-tabs [data-tpl]').forEach(b => b.onclick = () => {
      tplIdx = Number(b.dataset.tpl);
      $$('#tpl-tabs [data-tpl]').forEach(x => x.classList.toggle('on', x === b));
      drawTpl();
    });

    $$('.compose-right details.fold').forEach(d => d.addEventListener('toggle', () => {
      if (!d.open) return;
      drawTpl(); drawSim(); renderPresets(); drawBudget();
    }));

    drawLoraNote();
    drawBudget();
    drawTpl();
    drawSim();
    renderPresets();
  }

  /* ---------------- v3 · 长度预算 ---------------- */
  function drawBudget() {
    const bar = $('#lb-bar'); if (!bar) return;
    const t = curText();
    const b = lenBudget(state.model, t);
    const tag = $('#lb-tag');
    const color = b.lv === 'ok' ? 'var(--ok)' : b.lv === 'long' || b.lv === 'short' ? 'var(--warn)' : 'var(--muted)';
    tag.textContent = b.len + ' 字 · 约 ' + b.tokens + ' token';
    tag.style.color = color;
    bar.style.width = Math.min(100, b.pct) + '%';
    bar.style.background = color;
    bar.classList.toggle('over', b.pct > 100);
    $('#lb-l').textContent = '下限 ' + b.min;
    $('#lb-r').textContent = '上限 ' + b.max;
    $('#lb-note').innerHTML = '<b style="color:' + color + '">' + b.msg + '</b>　' + U.esc(b.note);
  }

  /* ---------------- v3 · 模板语法导出 ---------------- */
  let tplIdx = 0;
  function drawTpl() {
    const box = $('#tpl-body'); if (!box) return;
    const list = templateExports(state);
    const e = list[tplIdx] || list[0];
    if (!e) { box.innerHTML = ''; return; }
    let h = '<div class="tpl-box"><div class="tpl-tag">' + U.esc(e.n) + '　' + U.esc(e.tag) + '</div>' +
      '<textarea readonly class="tpl-text" rows="4">' + U.esc(e.text) + '</textarea>' +
      '<div class="pv-actions inline"><button class="btn sm" data-tpl-copy="1">复制模板</button>' +
      (e.files.length ? '<button class="btn sm" id="btn-tpl-files">下载 ' + e.files.length + ' 个通配文件</button>' : '') +
      '</div>';
    if (e.vars.length) h += '<div class="tpl-vars">' + e.vars.map(v => '<div><span class="mono">' + U.esc(v) + '</span></div>').join('') + '</div>';
    h += '</div>';
    box.innerHTML = h;
    box.querySelector('[data-tpl-copy]').onclick = () => copy(e.text, e.n + ' 模板已复制');
    const fb = $('#btn-tpl-files');
    if (fb) fb.onclick = () => {
      e.files.forEach((f, i) => setTimeout(() => download(f.name, f.body), i * 260));
      toast('已下载 ' + e.files.length + ' 个 txt，放进 ComfyUI/wildcards/');
    };
  }

  /* ---------------- v3 · 相似反查 ---------------- */
  let simOn = false;
  function drawSim() {
    const box = $('#sim-list'); if (!box) return;
    if (!simOn) {
      box.innerHTML = '<div class="empty">点「反查 Top5」，看库里哪几条跟你现在写的最接近。</div>';
      return;
    }
    const list = similarIn(curText(), { n: 5, video: MODELS[state.model].kind === 'video' });
    $('#sim-tag').textContent = list.length ? '最像 ' + list[0].sim + '%' : '无近邻';
    if (!list.length) { box.innerHTML = '<div class="empty">库里没有够相近的条目，说明这是个新组合。</div>'; return; }
    const head = list[0].sim < 30
      ? '<div class="hintline" style="margin-bottom:6px">最高只有 ' + list[0].sim + '%，库里没有真正重合的条目 —— 这正是值得沉淀进库的新组合。</div>'
      : '<div class="hintline" style="margin-bottom:6px">有 ' + list.filter(x => x.sim >= 30).length + ' 条重合度较高，可载入对比着改，避免重复造轮子。</div>';
    box.innerHTML = head + list.map(x =>
      '<div class="sim-row" data-sim="' + x.id + '">' +
      '<span class="sim-p">' + x.sim + '%</span>' +
      '<span class="sim-id mono">' + x.id + '</span>' +
      '<span class="sim-n">' + U.esc(x.name) + '</span>' +
      '<button class="btn sm" data-sim-load="' + x.id + '">载入</button></div>').join('');
    $$('[data-sim-load]').forEach(b => b.onclick = () => {
      const p = LIB.image.concat(LIB.video).find(x => x.id === b.dataset.simLoad);
      if (p) { applyFromLibrary(p); toast('已载入 ' + p.id + '，对比着改'); }
    });
  }

  /* ---------------- v3 · 配方库 ---------------- */
  function savePreset() {
    const name = U.clean($('#pre-name').value);
    if (!name) { toast('先给配方起个名'); return; }
    mem.presets.unshift({ id: 'R' + Date.now().toString(36), name, at: nowTime(), state: JSON.parse(JSON.stringify(state)) });
    mem.presets = mem.presets.slice(0, 60);
    persist(); $('#pre-name').value = ''; renderPresets(); toast('已存为配方「' + name + '」');
  }
  function renderPresets() {
    const box = $('#pre-list'); if (!box) return;
    $('#pre-n').textContent = mem.presets.length;
    if (!mem.presets.length) { box.innerHTML = '<div class="empty">把调好的一组设定存下来，下次一键还原。</div>'; return; }
    box.innerHTML = mem.presets.map(p =>
      '<div class="ver-row"><b>' + U.esc(p.name) + '</b>' +
      '<span class="tag">' + MODELS[p.state.model].name + ' · ' + p.at + '</span>' +
      '<span class="right"><button class="btn sm" data-pre-load="' + p.id + '">载入</button>' +
      '<button class="btn sm" data-pre-del="' + p.id + '">删</button></span></div>').join('');
    $$('[data-pre-load]').forEach(b => b.onclick = () => {
      const p = mem.presets.find(x => x.id === b.dataset.preLoad);
      if (!p) return;
      state = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), JSON.parse(JSON.stringify(p.state)));
      manualText = null; save(); renderCompose(); toast('已载入配方「' + p.name + '」');
    });
    $$('[data-pre-del]').forEach(b => b.onclick = () => {
      mem.presets = mem.presets.filter(x => x.id !== b.dataset.preDel);
      persist(); renderPresets(); toast('已删除');
    });
  }

  function drawLoraNote() {
    const box = $('#lora-note'); if (!box) return;
    const l = allLora().find(x => x.id === state.lora);
    if (!l) { box.innerHTML = '<span class="muted">未绑定 LoRA。风格类提示词建议绑定，否则换机器出不来同样效果。</span>'; return; }
    box.innerHTML = '<b>' + U.esc(l.name) + '</b> · 权重 ' + U.esc(l.weight) +
      (l.trigger ? ' · 触发词 <code>' + U.esc(l.trigger) + '</code>' : ' · 无触发词') +
      '<br><span class="muted">' + U.esc(l.note || '') + '</span>';
  }

  function onChipClick(e) {
    const d = e.target.closest('.dtab');
    if (d) {
      const slotKey = d.dataset.slot, dim = d.dataset.dim;
      activeDim[slotKey] = dim;
      const card = d.closest('.slot');
      card.querySelectorAll('.dtab').forEach(x => x.classList.toggle('on', x.dataset.dim === dim));
      const box = card.querySelector('[data-chipbox]');
      box.innerHTML = lexWords(dim).map(w =>
        '<button class="chip" data-insert="' + slotKey + '" data-word="' + U.esc(w) + '">' + U.esc(w) + '</button>').join('');
      return;
    }
    const b = e.target.closest('.chip[data-insert]');
    if (!b) return;
    const k = b.dataset.insert, w = b.dataset.word;
    const cur = U.clean(state.seg[k]);
    if (cur.indexOf(w) >= 0) { toast('已经有了'); return; }
    state.seg[k] = cur ? cur + '，' + w : w;
    manualText = null;
    const ta = document.querySelector('[data-seg="' + k + '"]');
    if (ta) ta.value = state.seg[k];
    save(); refreshMeta(); syncPreview();
  }

  function applyFromLibrary(p) {
    const isVid = p.type === '视频' || /^V-/.test(p.id || '');
    const body = normalizeSlots(p.prompt).text;
    // 视频没有标签段落，要用专门的线性叙事解析，否则整段会塞进一个槽位
    const seg = isVid ? decomposeVideo(body) : decompose(body);
    Object.keys(state.seg).forEach(k => { state.seg[k] = seg[k] || ''; });

    if (isVid) {
      // 从下拉进入时已经是 H3，不会触发切换；相似反查/命令面板等入口跨类型载入才切
      state.model = 'h3';
      state.duration = Number(p.duration) || state.duration || 5;
      const ar = (String(p.aspect || '').match(/\d+\s*:\s*\d+/) || [])[0];
      if (ar && ASPECTS.indexOf(ar.replace(/\s/g, '')) >= 0) state.aspect = ar.replace(/\s/g, '');
      state.negative = '';                 // H3 无负向
    } else {
      const ms = inferModels(p);
      state.model = ms.indexOf('h3') >= 0 ? 'h3' : ms.indexOf('z-base') >= 0 ? 'z-base' : ms.indexOf('sdxl') >= 0 ? 'sdxl' : 'z-turbo';
      if (p.aspect && ASPECTS.indexOf(p.aspect) >= 0) state.aspect = p.aspect;
    }
    state.tag = p.tag || state.tag;
    loadedId = p.id;
    manualText = null; save(); renderCompose();
  }

  function syncPreview() {
    const pv = $('#pv-text');
    if (pv && document.activeElement !== pv) pv.value = curText();
    const len = $('#pv-len'); if (len) len.textContent = curText().length + ' 字';
    const mode = $('#pv-mode');
    if (mode) mode.textContent = manualText != null ? '手动编辑' : (tplMode ? '模板版' : '填充版');
    drawBudget();
  }

  /* 失败案例关联：把库里踩过的坑直接挂到当前文本上 */
  function relatedFailures(text, modelId) {
    return FAILURE_DB.filter(f => {
      if (!f.detect) return false;
      if (f.model !== 'any' && f.model !== modelId && !(f.model === 'zimage' && /^z-/.test(modelId))) return false;
      f.detect.lastIndex = 0;
      return f.detect.test(text);
    });
  }

  function paintLint(list) {
    $('#lint').innerHTML = list.map(x =>
      '<div class="lint-item"><span class="dot ' + x.lv + '"></span><span class="msg">' + U.esc(x.msg) +
      (x.hint ? '<i>' + U.esc(x.hint) + '</i>' : '') + '</span>' +
      (x.fix ? '<button class="btn sm fix" data-fix="' + x.fix + '">修</button>' : '') + '</div>').join('');
    $$('#lint [data-fix]').forEach(b => b.onclick = () => applyFix(b.dataset.fix));
  }

  function paintScore(s) {
    $('#score-num').innerHTML = s.total + '<small>/ 100</small>';
    $('#score-bar').style.width = s.total + '%';
    $('#score-detail').innerHTML = s.parts.map(p =>
      '<span><span>' + p.label + '</span><span>' + p.v + ' / ' + p.max + '</span></span>').join('');
  }

  function refresh() {
    refreshMeta();
    syncPreview();

    const m = MODELS[state.model];
    const r = resolve(state.model, state);
    const ps = [];
    const cell = (k, v, wide) => '<div class="p' + (wide ? ' wide' : '') + '"><em>' + k + '</em><b>' + U.esc(v) + '</b></div>';
    ps.push(cell('分辨率', r.res || '—'));
    ps.push(cell('画幅', state.aspect));
    ps.push(cell('Steps', r.steps));
    ps.push(cell('CFG', r.cfg));
    ps.push(cell('采样器', r.sampler));
    ps.push(cell('调度器', r.scheduler));
    if (m.kind === 'video') {
      ps.push(cell('duration', r.duration));
      ps.push(cell('帧数 (17n+5)', r.frames));
      ps.push(cell('实际时长', r.realDuration));
      ps.push(cell('fps', r.fps));
      ps.push(cell('工作流', 'T2VA / I2VA / FL2VA'));
    } else if (m.id === 'z-edit') {
      ps.push(cell('denoise', state.denoise));
      ps.push(cell('蒙版羽化', '16–32 px'));
    } else {
      ps.push(cell('denoise', r.denoise));
      ps.push(cell('倍数约束', r.multiple + ' 的倍数'));
    }
    ps.push(cell('seed', state.seed || '随机'));
    $('#params').innerHTML = ps.join('');

    paintLint(buildLintList());
    paintScore(score(state, curText()));
  }

  function buildLintList() {
    const L = lint(state, curText(), { tpl: tplMode && manualText == null });
    const rel = relatedFailures(curText(), state.model);
    if (rel.length) {
      L.push({
        lv: 'info',
        msg: '命中 ' + rel.length + ' 条已知失败模式：' + rel.map(f => f.id).join('、'),
        hint: rel[0].name + ' —— ' + rel[0].fix
      });
    }
    const lora = allLora().find(x => x.id === state.lora);
    if (lora && lora.trigger && curText().indexOf(lora.trigger) < 0) {
      L.push({ lv: 'warn', msg: '绑定 LoRA 但正文没有触发词', hint: '触发词「' + lora.trigger + '」不进提示词，LoRA 不会生效', fix: null });
    }
    return L;
  }

  function refreshMeta() {
    const t = curText();
    const len = $('#pv-len'); if (len) len.textContent = t.length + ' 字';
    ['subject', 'feature', 'outfit', 'scene'].forEach(k => {
      const el = $('#fill-' + k); if (!el) return;
      const v = U.clean(state.seg[k]);
      el.textContent = v ? '已填 ' + v.length + ' 字' : '未填';
      el.classList.toggle('ok', !!v);
    });
    if ($('#lint')) {
      const L = buildLintList();
      const errs = L.filter(x => x.lv === 'err').length;
      const warns = L.filter(x => x.lv === 'warn').length;
      $('#lint-count').textContent = (errs ? errs + ' 必改' : '') + (errs && warns ? ' · ' : '') + (warns ? warns + ' 建议' : '') || '通过';
      paintLint(L);
      paintScore(score(state, t));
    }
    drawBudget();
    const ob = document.querySelector('details[open] #tpl-body');
    if (ob) drawTpl();
  }

  function applyFix(kind) {
    let t = curText();
    if (kind === 'stripWeight') {
      t = t.replace(/[（(]([^）)]*?):\s*\d*\.?\d+\s*[）)]/g, '$1');
    } else if (kind === 'stripAr') {
      t = t.replace(/--(ar|v|stylize|quality|style|chaos|seed|niji)\s*[\w:.]+/gi, '');
    } else if (kind === 'upgrade') {
      Object.keys(PF.UPGRADE).forEach(k => { t = t.split(k).join(PF.UPGRADE[k]); });
    } else if (kind === 'positive') {
      t = negToPos(t).text;
    } else if (kind === 'normSlots') {
      t = normalizeSlots(t).text;
    } else if (kind === 'addSound') {
      t = t.replace(/[。]?$/, '。声音：安静的环境音，' + pick(SOUND_CHIPS) + '隐约可闻。');
    }
    manualText = U.clean(t);
    if (kind === 'addSound') state.seg.sound = '安静的环境音，' + pick(SOUND_CHIPS) + '隐约可闻';
    save(); refresh();
    const pv = $('#pv-text'); if (pv) pv.value = manualText;
    $('#pv-mode').textContent = '手动编辑';
    toast('已修正');
  }

  function showVariants() {
    const vs = variants(state, 3);
    const html = vs.map((v, i) =>
      '<div class="block" style="margin-top:10px"><div class="block-h"><h3>变体 ' + (i + 1) + '</h3>' +
      '<span class="tag">' + U.esc(v.key) + '</span></div>' +
      '<textarea readonly style="min-height:110px;font-size:12.5px">' + U.esc(v.text) + '</textarea>' +
      '<div class="pv-actions inline"><button class="btn primary sm" data-copyv="' + i + '">复制</button>' +
      '<button class="btn sm" data-usev="' + i + '">采用</button></div></div>').join('');
    const wrap = document.createElement('div');
    wrap.className = 'block modal';
    wrap.innerHTML = '<div class="block-h"><h3>三个变体</h3><span class="tag">换光线 / 镜头 / 风格</span>' +
      '<div class="right"><button class="btn sm" id="v-close">关闭</button></div></div>' + html;
    document.body.appendChild(wrap);
    wrap.querySelector('#v-close').onclick = () => wrap.remove();
    wrap.querySelectorAll('[data-copyv]').forEach(b => b.onclick = () => copy(vs[+b.dataset.copyv].text, '变体已复制'));
    wrap.querySelectorAll('[data-usev]').forEach(b => b.onclick = () => {
      state.seg = Object.assign({}, vs[+b.dataset.usev].seg); manualText = null;
      save(); renderCompose(); wrap.remove(); toast('已采用');
    });
  }

  /* ---------------- ComfyUI JSON ---------------- */
  function showComfy() {
    const w = comfyWorkflow(state.model, state);
    const json = JSON.stringify(w.json, null, 2);
    const wrap = document.createElement('div');
    wrap.className = 'block modal wide';
    wrap.innerHTML = '<div class="block-h"><h3>' + U.esc(w.file) + '</h3>' +
      '<span class="tag">' + (w.ok ? '可直接载入 ComfyUI' : '参数清单') + '</span>' +
      '<div class="right"><button class="btn sm primary" id="cm-dl">下载 JSON</button>' +
      '<button class="btn sm" id="cm-copy">复制</button>' +
      '<button class="btn sm" id="cm-close">关闭</button></div></div>' +
      '<p class="hintline">' + U.esc(w.note) + '</p>' +
      '<textarea readonly style="min-height:380px;font-family:var(--mono);font-size:11.5px">' + U.esc(json) + '</textarea>';
    document.body.appendChild(wrap);
    wrap.querySelector('#cm-close').onclick = () => wrap.remove();
    wrap.querySelector('#cm-dl').onclick = () => download(w.file, json, 'application/json');
    wrap.querySelector('#cm-copy').onclick = () => copy(json, 'JSON 已复制');
  }

  /* ---------------- 版本 ---------------- */
  function saveVersion() {
    const k = vkey();
    const arr = mem.versions[k] = mem.versions[k] || [];
    const text = curText();
    const sc = score(state, text);
    arr.push({
      v: arr.length + 1, t: nowTime(), model: state.model, aspect: state.aspect,
      seg: Object.assign({}, state.seg), text, score: sc.total
    });
    if (arr.length > 30) arr.shift();
    persist(); renderVersions(); toast('已存为 v' + arr.length);
  }

  function renderVersions() {
    const box = $('#ver-list'); if (!box) return;
    const arr = mem.versions[vkey()] || [];
    const n = $('#ver-n'); if (n) n.textContent = arr.length + ' 个';
    if (!arr.length) { box.innerHTML = '<div class="hintline">还没有版本。改一版存一次，之后能看具体改了什么、评分涨没涨。</div>'; return; }
    box.innerHTML = arr.slice().reverse().map(x =>
      '<div class="ver-row"><span class="vt">v' + x.v + '</span>' +
      '<span class="vm">' + x.t + ' · ' + MODELS[x.model].name + '</span>' +
      '<span class="vs">' + x.score + '</span>' +
      '<button class="btn sm" data-vdiff="' + x.v + '">' + (x.v === arr[arr.length - 1].v && arr.length > 1 ? '对比上一版' : '对比当前') + '</button>' +
      '<button class="btn sm" data-vuse="' + x.v + '">恢复</button></div>').join('');
    $$('#ver-list [data-vdiff]').forEach(b => b.onclick = () => {
      const v = +b.dataset.vdiff;
      const arr2 = mem.versions[vkey()] || [];
      if (v === arr2.length && v > 1) showVerDiff(v - 1, v);
      else if (v === arr2.length) { toast('只有一版，改动后再存一次才能对比'); return; }
      else showVerDiff(v);
    });
    $$('#ver-list [data-vuse]').forEach(b => b.onclick = () => {
      const x = (mem.versions[vkey()] || []).find(v => v.v === +b.dataset.vuse);
      if (!x) return;
      state.model = x.model; state.aspect = x.aspect; state.seg = Object.assign({}, x.seg);
      manualText = null; save(); renderCompose(); toast('已恢复到 v' + x.v);
    });
  }

  function showVerDiff(v, targetV) {
    const arr = mem.versions[vkey()] || [];
    const x = arr.find(a => a.v === v); if (!x) return;
    const target = targetV ? arr.find(a => a.v === targetV) : null;
    const nextSeg = target ? target.seg : state.seg;
    const ds = diffSegs(x.seg, nextSeg);
    const nowSc = target ? target.score : score(state, curText()).total;
    const targetLabel = target ? 'v' + targetV : '当前';
    const body = ds.length ? ds.map(d =>
      '<div class="diff-block"><div class="diff-h">' + U.esc(d.label) + '</div><div class="diff-body">' +
      d.parts.map(p => p.op === 'eq' ? U.esc(p.text)
        : p.op === 'add' ? '<ins>' + U.esc(p.text) + '</ins>'
          : '<del>' + U.esc(p.text) + '</del>').join('') + '</div></div>').join('')
      : '<div class="hintline">两版内容完全一致</div>';
    const wrap = document.createElement('div');
    wrap.className = 'block modal wide';
    wrap.innerHTML = '<div class="block-h"><h3>v' + v + ' → ' + targetLabel + '</h3>' +
      '<span class="tag">评分 ' + x.score + ' → ' + nowSc + '（' + (nowSc - x.score >= 0 ? '+' : '') + (nowSc - x.score) + '）</span>' +
      '<div class="right"><button class="btn sm" id="df-close">关闭</button></div></div>' +
      '<p class="hintline"><del>红色</del> = v' + v + ' 有、现在删掉的；<ins>绿色</ins> = 现在新加的。</p>' + body;
    document.body.appendChild(wrap);
    wrap.querySelector('#df-close').onclick = () => wrap.remove();
  }

  /* ---------------- 产出记录 ---------------- */
  function recordOutput() {
    const k = vkey();
    const arr = mem.outputs[k] = mem.outputs[k] || [];
    const r = resolve(state.model, state);
    arr.push({
      t: nowTime(), model: state.model, seed: $('#o-seed').value || state.seed || '',
      rate: $('#o-rate').value, note: $('#o-note').value,
      res: r.res, steps: r.steps, cfg: r.cfg, sampler: r.sampler,
      text: curText()
    });
    persist(); renderOutputs();
    $('#o-note').value = '';
    toast('已记录，产出回流建立');
  }

  function renderOutputs() {
    const box = $('#out-list'); if (!box) return;
    const arr = mem.outputs[vkey()] || [];
    const n = $('#out-n'); if (n) n.textContent = arr.length + ' 次';
    if (!arr.length) { box.innerHTML = '<div class="hintline">还没有出图记录。同一条提示词换 seed 多跑几次再打分，才知道它稳不稳。</div>'; return; }
    const avg = arr.reduce((s, x) => s + ({ S: 4, A: 3, B: 2, C: 1 }[x.rate] || 0), 0) / arr.length;
    box.innerHTML = '<div class="hintline">' + arr.length + ' 次 · 平均 ' + avg.toFixed(2) + ' / 4.00</div>' +
      arr.slice().reverse().map((x, i) =>
        '<div class="ver-row"><span class="vt ' + x.rate + '">' + x.rate + '</span>' +
        '<span class="vm">' + x.t + ' · seed ' + (x.seed || '随机') + '</span>' +
        '<span class="vs">' + (x.note ? U.esc(x.note.slice(0, 18)) : '') + '</span></div>').join('');
  }

  /* ---------------- 多模型同题对照 ---------------- */
  function showCompare() {
    const rows = Object.keys(MODELS).map(id => {
      const s = Object.assign({}, state, { model: id });
      const t = build(s).text;
      const r = resolve(id, s);
      const L = lint(s, t);
      const errs = L.filter(x => x.lv === 'err');
      return { id, m: MODELS[id], text: t, r, errs };
    });
    const html = rows.map(x =>
      '<div class="diff-block"><div class="diff-h">' + x.m.name +
      ' <span class="pill">' + x.r.steps + ' 步 · CFG ' + x.r.cfg + ' · ' + (x.r.res || '—') + '</span>' +
      (x.errs.length ? ' <span class="pill err">' + x.errs.length + ' 处必改</span>' : '') + '</div>' +
      '<div class="diff-body mono">' + (x.text ? U.esc(x.text) : '<span class="muted">（当前槽位在该模型下无可用段落）</span>') + '</div>' +
      '<div class="pv-actions inline"><button class="btn sm" data-cmpcopy="' + x.id + '">复制</button></div></div>').join('');
    const wrap = document.createElement('div');
    wrap.className = 'block modal wide';
    wrap.innerHTML = '<div class="block-h"><h3>同一组槽位 · 五个模型</h3>' +
      '<div class="right"><button class="btn sm" id="cp-md">导出 Markdown</button>' +
      '<button class="btn sm" id="cp-close">关闭</button></div></div>' + html;
    document.body.appendChild(wrap);
    wrap.querySelector('#cp-close').onclick = () => wrap.remove();
    wrap.querySelectorAll('[data-cmpcopy]').forEach(b => b.onclick = () => {
      const x = rows.find(r => r.id === b.dataset.cmpcopy); copy(x.text, x.m.name + ' 已复制');
    });
    wrap.querySelector('#cp-md').onclick = () => {
      const md = '# 同题对照\n\n' + rows.map(x =>
        '## ' + x.m.name + '\n\n参数：' + x.r.steps + ' 步 / CFG ' + x.r.cfg + ' / ' + (x.r.res || '—') + ' / ' + x.r.sampler + '\n\n```\n' + x.text + '\n```\n').join('\n');
      download('同题对照_' + today() + '.md', md, 'text/markdown');
    };
  }

  /* =======================================================================
   * 词库（含负向映射）
   * ===================================================================== */
  let lexQ = '', lexSlot = '', lexMode = 'words';
  function renderLexicon() {
    const all = LIB.lexicon;
    const total = all.reduce((n, x) => n + x.words.length, 0);
    $('#view').innerHTML =
      '<div class="toolbar">' +
      '<div class="seg-tabs">' +
      '<button class="st' + (lexMode === 'words' ? ' on' : '') + '" data-lm="words">槽位词库</button>' +
      '<button class="st' + (lexMode === 'neg' ? ' on' : '') + '" data-lm="neg">负向映射 ' + Object.keys(NEG_MAP).length + '</button>' +
      '</div>' +
      '<input type="text" id="lex-q" placeholder="搜词，如「鹅蛋脸」「缎面」「丁达尔」" value="' + U.esc(lexQ) + '">' +
      (lexMode === 'words'
        ? '<select id="lex-slot"><option value="">全部槽位</option>' +
        ['主体', '人物特征', '服饰造型', '场景环境'].map(s => '<option' + (s === lexSlot ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>'
        : '<select id="lex-slot"><option value="">全部类型</option><option>画质</option><option>人体</option><option>AI痕迹</option><option>视频</option><option>英文</option></select>') +
      '<span class="n">' + (lexMode === 'words' ? all.length + ' 个维度 · ' + total + ' 个词' : '双向：负向 ⇄ 正面') + '</span></div>' +
      (lexMode === 'neg' ? negPanelHtml() : '<div class="lex" id="lex-grid"></div>');

    $$('.seg-tabs [data-lm]').forEach(b => b.onclick = () => { lexMode = b.dataset.lm; renderLexicon(); });
    if (lexMode === 'neg') { bindNegPanel(); return; }

    const draw = () => {
      const q = lexQ.trim();
      const slot = $('#lex-slot').value;
      const rows = LIB.lexicon
        .filter(x => !slot || x.slot === slot)
        .map(x => ({ ...x, words: q ? x.words.filter(w => w.indexOf(q) >= 0) : x.words }))
        .filter(x => x.words.length);
      $('#lex-grid').innerHTML = rows.length ? rows.map(x =>
        '<div class="lex-card"><h4><span class="sl">' + x.slot + '</span>' + x.dim +
        '<span class="cw">' + x.words.length + ' 词</span></h4>' +
        '<div class="chips">' + x.words.map(w =>
          '<button class="chip" data-copyword="' + U.esc(w) + '">' + U.esc(w) + '</button>').join('') + '</div></div>').join('')
        : '<div class="empty">没有匹配的词</div>';
      $$('#lex-grid [data-copyword]').forEach(b => b.onclick = () => copy(b.dataset.copyword, '已复制：' + b.dataset.copyword));
    };
    $('#lex-q').oninput = e => { lexQ = e.target.value; draw(); };
    $('#lex-slot').onchange = e => { lexSlot = e.target.value; draw(); };
    draw();
  }

  function negKind(k) {
    if (/^no |^without /.test(k)) return '英文';
    if (/闪烁|跳帧|漂移|字幕|时间戳|黑边|卡顿|静音|音画|破音|摇晃镜头|变焦|剪辑/.test(k)) return '视频';
    if (/畸形|肢体|手指|断肢|鼻|嘴|牙|眼|脸|脖子|腿|浮肿|油脸|驼背|反关节|比例/.test(k)) return '人体';
    if (/AI感|诡异|重复|穿帮|廉价|土味|山寨|渲染|CG|合成|饱和|滤镜|错位|透视|影子|光源/.test(k)) return 'AI痕迹';
    return '画质';
  }

  function negPanelHtml() {
    const keys = Object.keys(NEG_MAP);
    return '<div class="lex" id="neg-grid">' +
      '<div class="lex-card" style="grid-column:1/-1"><h4>批量转换器<span class="cw">把一整段负面词转成正面表述</span></h4>' +
      '<textarea id="neg-in" style="min-height:70px;font-size:12.5px" placeholder="粘贴负面词，如：不要模糊，不要多余手指，避免过曝，不要水印"></textarea>' +
      '<div class="pv-actions inline"><button class="btn primary sm" id="neg-go">负 → 正</button>' +
      '<button class="btn sm" id="neg-back">正 → 负</button>' +
      '<button class="btn sm" id="neg-copy">复制结果</button>' +
      '<span class="hintline" id="neg-stat"></span></div>' +
      '<textarea id="neg-out" style="min-height:60px;font-size:12.5px;margin-top:6px" placeholder="结果"></textarea></div>' +
      keys.map(k => {
        const kind = negKind(k);
        return '<div class="neg-card" data-kind="' + kind + '" data-k="' + U.esc(k) + '">' +
          '<span class="neg-k">' + U.esc(k) + '</span><span class="arrow">→</span><span class="neg-v">' + U.esc(NEG_MAP[k]) + '</span></div>';
      }).join('') + '</div>';
  }

  function bindNegPanel() {
    const g = $('#neg-go'), b = $('#neg-back');
    if (g) g.onclick = () => {
      const r = negToPos($('#neg-in').value);
      $('#neg-out').value = r.text;
      $('#neg-stat').textContent = '转换 ' + r.n + ' 处';
    };
    if (b) b.onclick = () => {
      const r = posToNeg($('#neg-in').value);
      $('#neg-out').value = r.text;
      $('#neg-stat').textContent = '反查 ' + r.n + ' 处';
    };
    const c = $('#neg-copy'); if (c) c.onclick = () => copy($('#neg-out').value, '已复制');
    const draw = () => {
      const q = (lexQ || '').trim();
      const kind = $('#lex-slot').value;
      $$('#neg-grid .neg-card').forEach(el => {
        const okQ = !q || (el.dataset.k + el.textContent).indexOf(q) >= 0;
        const okK = !kind || el.dataset.kind === kind;
        el.classList.toggle('hide', !(okQ && okK));
      });
      $$('#neg-grid .neg-card').forEach(el => el.onclick = () => copy(el.dataset.k + ' → ' + el.querySelector('.neg-v').textContent, '已复制映射'));
    };
    $('#lex-q').oninput = e => { lexQ = e.target.value; draw(); };
    $('#lex-slot').onchange = draw;
    draw();
  }

  /* =======================================================================
   * 库（条目 / 数据体检 / 失败案例 / 产出）
   * ===================================================================== */
  let libState = { q: '', type: 'image', score: '', tag: '', l1: '', l3: '', model: '' };
  let libTab = 'items';

  function renderLibrary() {
    const tabs = [['items', '条目'], ['health', '数据体检'], ['assert', '断言套件'], ['fail', '失败案例'], ['outputs', '产出记录']];
    $('#view').innerHTML =
      '<div class="toolbar">' +
      '<div class="seg-tabs">' + tabs.map(t =>
        '<button class="st' + (libTab === t[0] ? ' on' : '') + '" data-lt="' + t[0] + '">' + t[1] +
        (t[0] === 'health' ? ' <em id="hl-badge"></em>' : '') + '</button>').join('') + '</div>' +
      '<span class="n" id="lb-n"></span></div>' +
      '<div id="lib-body"></div>';
    $$('.seg-tabs [data-lt]').forEach(b => b.onclick = () => { libTab = b.dataset.lt; renderLibrary(); });
    if (libTab === 'items') renderLibItems();
    else if (libTab === 'health') renderHealth();
    else if (libTab === 'assert') renderAssert();
    else if (libTab === 'fail') renderFailures();
    else renderOutputBook();
  }

  /* =======================================================================
   * 库 · 断言套件（v3：借 promptfoo 的回归思路，对象是整库）
   * ===================================================================== */
  let assertSel = null;          // null = 全部启用
  let assertOpen = '';           // 展开的断言 id

  function renderAssert() {
    const ids = assertSel;
    const res = runAsserts(ids);
    const s = res.summary;
    const badge = v => v >= 95 ? 'ok' : v >= 80 ? 'warn' : 'err';
    const groups = {};
    res.rows.forEach(r => { (groups[r.g] = groups[r.g] || []).push(r); });

    $('#lb-n').textContent = s.checks + ' 次检查 · ' + s.rate + '% 通过';
    $('#lib-body').innerHTML =
      '<div class="card"><div class="card-h"><b>规范断言套件</b>' +
      '<span class="tag">' + s.asserts + ' 条断言 × ' + (LIB.image.length + LIB.video.length) + ' 条数据</span>' +
      '<span class="right">' +
      '<button class="btn sm" id="as-all">全选</button>' +
      '<button class="btn sm" id="as-struct">只看结构</button>' +
      '<button class="btn sm" id="as-report">导出报告</button>' +
      '</span></div>' +
      '<p class="muted" style="margin:0 0 12px">像跑回归测试一样跑整个库：每条断言对全部数据判一次，通过率掉下去就说明新写的东西在破坏既有规范。' +
      '<b>缺失（skip）</b>表示该断言不适用于这条数据（如槽位类断言只作用于用了【】的条目）。</p>' +
      '<div class="as-sum">' +
      '<div class="as-big"><b>' + s.rate + '%</b><span>总通过率</span></div>' +
      '<div class="as-big"><b>' + s.pass + '</b><span>通过</span></div>' +
      '<div class="as-big err"><b>' + s.fail + '</b><span>失败</span></div>' +
      '<div class="as-big mut"><b>' + s.skipped + '</b><span>不适用</span></div>' +
      '</div></div>' +

      '<div class="tbl-wrap"><table><tr><th style="width:52px">编号</th><th style="width:190px">断言</th>' +
      '<th style="width:70px">分组</th><th style="width:150px">通过率</th><th style="width:110px">通过/适用</th><th>说明</th></tr>' +
      Object.keys(groups).map(g => groups[g].map(r =>
        '<tr class="as-row" data-as="' + r.id + '">' +
        '<td class="mono">' + r.id + '</td>' +
        '<td><b>' + U.esc(r.n) + '</b>' + (r.scope === 'slot' ? ' <span class="tag" style="margin-left:4px">槽位条目</span>' : r.scope === 'video' ? ' <span class="tag" style="margin-left:4px">仅视频</span>' : '') + '</td>' +
        '<td>' + r.g + '</td>' +
        '<td><div class="as-bar ' + badge(r.rate) + '"><i style="width:' + r.rate + '%"></i></div><span class="mono">' + r.rate + '%</span></td>' +
        '<td class="mono">' + r.pass + ' / ' + r.total + '</td>' +
        '<td class="muted">' + U.esc(r.hint) + '</td></tr>').join('')).join('') +
      '</table></div>' +

      res.rows.filter(r => r.id === assertOpen).map(r =>
        '<div class="card" style="margin-top:12px"><div class="card-h"><b>' + r.id + ' · ' + U.esc(r.n) + ' 失败明细</b>' +
        '<span class="tag">' + r.fails.length + ' 条</span></div>' +
        (r.fails.length ? '<div class="as-fails">' + r.fails.slice(0, 120).map(f =>
          '<span class="as-f" data-as-go="' + f.id + '">' + f.id + ' ' + U.esc(f.n) + '</span>').join('') + '</div>'
          : '<div class="empty">全部通过</div>') + '</div>').join('');

    $('#as-all').onclick = () => { assertSel = null; renderAssert(); };
    $('#as-struct').onclick = () => { assertSel = ['A01', 'A02', 'A06', 'A07']; renderAssert(); };
    $('#as-report').onclick = () => {
      const md = ['# 规范断言报告', '', '生成时间：' + new Date().toLocaleString('zh-CN'), '',
        '总通过率 **' + s.rate + '%**（' + s.pass + '/' + s.checks + '，不适用 ' + s.skipped + '）', '',
        '| 编号 | 断言 | 分组 | 通过率 | 通过/适用 | 说明 |', '|---|---|---|---|---|---|']
        .concat(res.rows.map(r => '| ' + r.id + ' | ' + r.n + ' | ' + r.g + ' | ' + r.rate + '% | ' + r.pass + '/' + r.total + ' | ' + r.hint + ' |'))
        .concat(['', '## 最弱三条', ''])
        .concat(s.worst.map(r => '- **' + r.id + ' ' + r.n + '** ' + r.rate + '%（失败 ' + (r.total - r.pass) + ' 条）'))
        .join('\n');
      download('断言报告-' + today() + '.md', md, 'text/markdown;charset=utf-8');
      toast('报告已下载');
    };
    $$('[data-as]').forEach(tr => tr.onclick = () => {
      assertOpen = assertOpen === tr.dataset.as ? '' : tr.dataset.as; renderAssert();
    });
    $$('[data-as-go]').forEach(el => el.onclick = () => {
      const p = LIB.image.concat(LIB.video).find(x => x.id === el.dataset.asGo);
      if (!p) return;
      tab = 'compose'; renderTabs(); renderCompose(); applyFromLibrary(p); toast('已载入 ' + p.id);
    });
  }

  function renderLibItems() {
    const src = libState.type === 'image' ? LIB.image : libState.type === 'video' ? LIB.video : LIB.edits;
    const tags = U.uniq(src.map(p => p.tag || p.editType || '')).filter(Boolean).sort();
    const l1s = ['人像', '静物产品', '场景空间', '平面设计', '插画漫画', '动物', '概念幻想', '视频叙事'];
    const l3s = ['东方美学', '未来亚文化', '日系清新', '胶片复古', '电影光效', '绘画艺术', '二次元', '超写实'];
    $('#lib-body').innerHTML =
      '<div class="toolbar sub">' +
      '<select id="lb-type"><option value="image">生图 ' + LIB.image.length + '</option>' +
      '<option value="video"' + (libState.type === 'video' ? ' selected' : '') + '>生视频 ' + LIB.video.length + '</option>' +
      '<option value="edits"' + (libState.type === 'edits' ? ' selected' : '') + '>编辑工作流 ' + LIB.edits.length + '</option></select>' +
      '<input type="text" id="lb-q" placeholder="搜名称 / 提示词 / 标签" value="' + U.esc(libState.q) + '">' +
      '<select id="lb-model"><option value="">全部模型</option>' +
      ['z-turbo', 'z-base', 'z-edit', 'h3', 'sdxl'].map(k => '<option value="' + k + '"' + (libState.model === k ? ' selected' : '') + '>' + MODELS[k].name + '</option>').join('') +
      '</select>' +
      '<select id="lb-l1"><option value="">全部题材</option>' + l1s.map(x => '<option' + (libState.l1 === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>' +
      '<select id="lb-l3"><option value="">全部风格</option>' + l3s.map(x => '<option' + (libState.l3 === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>' +
      '<select id="lb-score"><option value="">全部评分</option>' + ['A', 'B', 'C'].map(x => '<option' + (libState.score === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>' +
      '<select id="lb-tag"><option value="">全部标签</option>' + tags.map(t => '<option' + (libState.tag === t ? ' selected' : '') + '>' + U.esc(t) + '</option>').join('') + '</select>' +
      '</div><div class="list" id="lb-list"></div>';

    if (libState.tag) $('#lb-tag').value = libState.tag;

    const draw = () => {
      let rows = libState.type === 'edits' ? LIB.edits : libState.type === 'image' ? LIB.image : LIB.video;
      const q = libState.q.trim().toLowerCase();
      rows = rows.filter(p => {
        if (libState.score && p.score !== libState.score) return false;
        if (libState.tag && (p.tag || p.editType) !== libState.tag) return false;
        if (libState.type !== 'edits') {
          const tp = tagPath(p.tag);
          if (libState.l1 && tp.l1 !== libState.l1) return false;
          if (libState.l3 && tp.l3 !== libState.l3) return false;
          if (libState.model && inferModels(p).indexOf(libState.model) < 0) return false;
        }
        if (!q) return true;
        return ((p.name || '') + (p.prompt || p.instruction || '') + (p.tag || '')).toLowerCase().indexOf(q) >= 0;
      });
      $('#lb-n').textContent = rows.length + ' 条';
      if (!rows.length) { $('#lb-list').innerHTML = '<div class="empty">没有符合条件的条目</div>'; return; }
      $('#lb-list').innerHTML = rows.slice(0, 300).map(p => {
        const text = p.prompt || p.instruction || '';
        const tp = tagPath(p.tag);
        const ms = libState.type === 'edits' ? [] : inferModels(p);
        const outs = (mem.outputs[p.id] || []).length;
        const lora = mem.lora[p.id];
        return '<div class="card"><div class="card-h"><span class="id">' + p.id + '</span>' +
          '<span class="nm">' + U.esc(p.name) + '</span><span class="sc ' + (p.score || 'B') + '">' + (p.score || '') + '</span></div>' +
          '<div class="p">' + U.esc(text) + '</div>' +
          '<div class="card-f">' +
          '<span class="pill">' + U.esc(p.tag || p.editType || '') + '</span>' +
          (tp.l1 !== '其他' ? '<span class="pill dim">' + tp.l1 + (tp.l3 !== '其他' ? ' / ' + tp.l3 : '') + '</span>' : '') +
          (p.aspect ? '<span class="pill">' + U.esc(p.aspect) + '</span>' : '') +
          ms.map(k => '<span class="pill m-' + k + '">' + MODELS[k].name.replace('Z-Image ', '') + '</span>').join('') +
          (outs ? '<span class="pill ok">产出 ' + outs + '</span>' : '') +
          (lora ? '<span class="pill">LoRA</span>' : '') +
          '<button class="btn sm" data-copylib="' + p.id + '">复制</button>' +
          (libState.type === 'edits'
            ? '<button class="btn sm" data-loadedit="' + p.id + '">载入编辑</button>'
            : '<button class="btn sm" data-loadlib="' + p.id + '">载入装配</button>') +
          '</div></div>';
      }).join('');
      $$('#lb-list [data-copylib]').forEach(b => b.onclick = () => {
        const p = rows.find(x => x.id === b.dataset.copylib);
        copy(p.prompt || p.instruction, p.id + ' 已复制');
      });
      $$('#lb-list [data-loadedit]').forEach(b => b.onclick = () => {
        const e = LIB.edits.find(x => x.id === b.dataset.loadedit);
        state.model = 'z-edit'; manualText = e.instruction; loadedId = e.id;
        tab = 'compose'; renderTabs(); renderCompose();
        toast('已载入 ' + e.id + ' 编辑指令，可直接改');
      });
      $$('#lb-list [data-loadlib]').forEach(b => b.onclick = () => {
        const p = LIB.image.find(x => x.id === b.dataset.loadlib) || LIB.video.find(x => x.id === b.dataset.loadlib);
        tab = 'compose'; renderTabs(); applyFromLibrary(p); toast('已载入 ' + p.id);
      });
    };
    $('#lb-type').onchange = e => { libState.type = e.target.value; libState.tag = ''; libState.l1 = ''; libState.l3 = ''; renderLibItems(); };
    $('#lb-q').oninput = e => { libState.q = e.target.value; draw(); };
    $('#lb-model').onchange = e => { libState.model = e.target.value; draw(); };
    $('#lb-l1').onchange = e => { libState.l1 = e.target.value; draw(); };
    $('#lb-l3').onchange = e => { libState.l3 = e.target.value; draw(); };
    $('#lb-score').onchange = e => { libState.score = e.target.value; draw(); };
    $('#lb-tag').onchange = e => { libState.tag = e.target.value; draw(); };
    draw();
  }

  /* ---------------- 数据体检 ---------------- */
  let hlFilter = '';
  function renderHealth() {
    const h = PF.dataHealth();
    const badge = $('#hl-badge');
    if (badge) badge.textContent = h.summary.total;
    const groups = Object.entries(h.summary.bySheet).sort((a, b) => b[1] - a[1]);
    const rows = h.items.filter(x => !hlFilter || x.sheet + '·' + x.field === hlFilter);
    $('#lib-body').innerHTML =
      '<div class="pad">' +
      '<div class="block"><div class="block-h"><h3>体检结论</h3>' +
      '<span class="tag">扫描 ' + (LIB.image.length + LIB.video.length) + ' 条</span>' +
      '<div class="right"><button class="btn sm primary" id="hl-patch">导出修复补丁 CSV</button>' +
      '<button class="btn sm" id="hl-all">看全部</button></div></div>' +
      '<div class="stat-row">' +
      '<div class="stat"><b class="err">' + h.summary.err + '</b><em>必改</em></div>' +
      '<div class="stat"><b class="warn">' + h.summary.warn + '</b><em>建议</em></div>' +
      '<div class="stat"><b class="info">' + h.summary.info + '</b><em>提醒</em></div>' +
      '<div class="stat"><b class="ok">' + h.summary.fixable + '</b><em>可自动修</em></div>' +
      '</div>' +
      '<div class="hintline">体检是只读扫描，不会动你的库。补丁 CSV 只包含可自动修的问题，改完自己合并回表。</div>' +
      '</div>' +
      '<div class="block"><div class="block-h"><h3>问题分布</h3><span class="tag">点击筛选</span></div>' +
      '<div class="chips">' + groups.map(g =>
        '<button class="chip' + (hlFilter === g[0] ? ' on' : '') + '" data-hl="' + U.esc(g[0]) + '">' + U.esc(g[0]) + ' <b>' + g[1] + '</b></button>').join('') +
      '</div></div>' +
      '<div class="block"><div class="block-h"><h3>明细</h3><span class="tag">' + rows.length + ' 项</span></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>表</th><th>编号</th><th>字段</th><th>问题</th><th>级别</th></tr></thead><tbody>' +
      rows.slice(0, 400).map(x =>
        '<tr><td>' + x.sheet + '</td><td class="mono">' + x.id + '</td><td>' + x.field + '</td>' +
        '<td>' + U.esc(x.issue) + '</td><td><span class="lv ' + x.lv + '">' + x.lv + '</span></td></tr>').join('') +
      '</tbody></table></div></div></div>';

    $$('[data-hl]').forEach(b => b.onclick = () => { hlFilter = hlFilter === b.dataset.hl ? '' : b.dataset.hl; renderHealth(); });
    $('#hl-all').onclick = () => { hlFilter = ''; renderHealth(); };
    $('#hl-patch').onclick = () => {
      const csv = healthPatch();
      if (!csv) { toast('没有可自动修的问题'); return; }
      download('数据修复补丁_' + today() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
      toast('补丁已导出');
    };
  }

  function normModelName(s) {
    const t = String(s || '');
    if (/Base/i.test(t)) return 'Z-Image Base';
    if (/Edit/i.test(t)) return 'Z-Image-Edit';
    if (/H3|MiniMax/i.test(t)) return 'MiniMax H3';
    if (/SDXL|Flux/i.test(t)) return 'SDXL';
    if (/Turbo/i.test(t)) return 'Z-Image Turbo';
    return t;
  }

  function healthPatch() {
    const h = PF.dataHealth();
    const out = [];
    const seen = {};
    h.items.filter(x => x.fixable).forEach(x => {
      const list = x.sheet === '生图' ? LIB.image : LIB.video;
      const p = list.find(y => y.id === x.id);
      if (!p) return;
      let field = '', before = '', after = '';
      if (x.field === '提示词') {
        let t = p.prompt;
        if (/权重括号/.test(x.issue)) t = t.replace(/[（(]([^）)]*?):\s*\d*\.?\d+\s*[）)]/g, '$1');
        if (/MJ 参数/.test(x.issue)) t = t.replace(/--(ar|v|stylize|quality|style|chaos|seed|niji)\s*[\w:.]+/gi, '');
        if (/否定词/.test(x.issue)) t = negToPos(t).text;
        field = '最终提示词'; before = p.prompt; after = t;
      } else if (x.field === '槽位名' || x.field === '槽位清单') {
        field = '最终提示词 + 槽位清单';
        const nt = normalizeSlots(p.prompt).text;
        before = p.prompt + ' || ' + p.slots;
        after = nt + ' || ' + slotsOf(nt).join(' / ');
      } else if (x.field === '推荐模型') {
        field = '推荐模型 + 可用模型';
        before = p.model;
        after = normModelName(p.model) + ' || ' + inferModels(p).join(' / ');
      }
      if (!field) return;
      const k = x.id + '|' + field;
      if (seen[k]) return;
      seen[k] = 1;
      out.push([x.sheet, x.id, field, before, after].map(v => {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','));
    });
    if (!out.length) return '';
    return ['表,编号,字段,修改前,修改后'].concat(out).join('\n');
  }

  /* ---------------- 失败案例 ---------------- */
  let failQ = '', failModel = '';
  function renderFailures() {
    const list = FAILURE_DB.filter(f => {
      if (failModel && f.model !== failModel && f.model !== 'any') return false;
      if (!failQ) return true;
      const q = failQ.toLowerCase();
      return (f.id + f.name + f.symptom + f.cause + f.fix).toLowerCase().indexOf(q) >= 0;
    });
    $('#lib-body').innerHTML =
      '<div class="toolbar sub">' +
      '<input type="text" id="fq" placeholder="搜现象 / 归因 / 改法，如「多指」「静音」" value="' + U.esc(failQ) + '">' +
      '<select id="fm"><option value="">全部模型</option>' +
      ['z-turbo', 'z-base', 'z-edit', 'h3', 'sdxl', 'zimage', 'any'].map(k =>
        '<option value="' + k + '"' + (failModel === k ? ' selected' : '') + '>' + (MODELS[k] ? MODELS[k].name : k) + '</option>').join('') +
      '</select><span class="n">' + list.length + ' 条</span></div>' +
      '<div class="list wide">' + list.map(f =>
        '<div class="card"><div class="card-h"><span class="id">' + f.id + '</span>' +
        '<span class="nm">' + U.esc(f.name) + '</span>' +
        '<span class="pill">' + (MODELS[f.model] ? MODELS[f.model].name : f.model) + '</span></div>' +
        '<div class="kv small"><em>现象</em><span>' + U.esc(f.symptom) + '</span>' +
        '<em>归因</em><span>' + U.esc(f.cause) + '</span>' +
        '<em>改法</em><span class="fixtext">' + U.esc(f.fix) + '</span></div></div>').join('') + '</div>';
    $('#fq').oninput = e => { failQ = e.target.value; renderFailures(); };
    $('#fm').onchange = e => { failModel = e.target.value; renderFailures(); };
  }

  /* ---------------- 产出记录总览 ---------------- */
  function renderOutputBook() {
    const keys = Object.keys(mem.outputs).filter(k => (mem.outputs[k] || []).length);
    const rows = [];
    keys.forEach(k => {
      const p = LIB.image.find(x => x.id === k);
      const arr = mem.outputs[k];
      const avg = arr.reduce((s, x) => s + ({ S: 4, A: 3, B: 2, C: 1 }[x.rate] || 0), 0) / arr.length;
      rows.push({ id: k, name: p ? p.name : '草稿', n: arr.length, avg, last: arr[arr.length - 1] });
    });
    rows.sort((a, b) => b.avg - a.avg);
    $('#lb-n').textContent = rows.length + ' 条有产出';
    $('#lib-body').innerHTML = rows.length ?
      '<div class="list wide">' + rows.map(r =>
        '<div class="card"><div class="card-h"><span class="id">' + r.id + '</span>' +
        '<span class="nm">' + U.esc(r.name) + '</span>' +
        '<span class="pill ok">' + r.n + ' 次 · 均值 ' + r.avg.toFixed(2) + '</span></div>' +
        '<div class="p">' + U.esc((r.last.text || '').slice(0, 120)) + '</div>' +
        '<div class="card-f"><span class="pill">' + MODELS[r.last.model].name + '</span>' +
        '<span class="pill">seed ' + U.esc(r.last.seed || '随机') + '</span>' +
        '<span class="pill">' + U.esc(r.last.res || '') + '</span>' +
        (r.last.note ? '<span class="pill">' + U.esc(r.last.note) + '</span>' : '') +
        '</div></div>').join('') + '</div>'
      : '<div class="empty">还没有产出记录。到「装配」页填好提示词，出图后点「记录」，这里就会有数据。</div>';
  }

  /* =======================================================================
   * 采集（含审核流 + PNG 反推 + 缺口）
   * ===================================================================== */
  let ing = null;
  function renderIngest() {
    $('#view').innerHTML =
      '<div class="ingest">' +
      '<section>' +
      '<div class="block"><div class="block-h"><h3>导入</h3>' +
      '<span class="tag">粘贴 / 拖 PNG 自动读元数据</span></div>' +
      '<textarea id="raw" placeholder="把从网页 / 公众号 / 社区抄来的提示词整段贴进来，含 --ar、(xxx:1.2)、负面词都可以，系统会自动清洗并拆进槽位"></textarea>' +
      '<div class="drop" id="drop">把 ComfyUI / WebUI 生成的 PNG 拖到这里，或点击选择 —— 自动提取内嵌提示词与参数</div>' +
      '<input type="file" id="pngfile" accept="image/png" style="display:none">' +
      '<div class="pv-actions inline"><button class="btn primary" id="btn-analyze">分析</button>' +
      '<button class="btn" id="btn-demo">填个示例</button>' +
      '<button class="btn ghost" id="btn-clearq" style="margin-left:auto">清空队列</button></div></div>' +
      '<div class="block" id="ing-out"><div class="howto">' +
      '<div><b>1</b><span>粘贴任意来源的提示词，或拖一张带元数据的 PNG —— MJ 的 <code>--ar</code>、SD 的 <code>(xxx:1.2)</code>、负面词都会自动清洗。</span></div>' +
      '<div><b>2</b><span>点「分析」：识别来源模型、按语义拆进 4 个槽位、与库内全部条目查重、给出建议评分。</span></div>' +
      '<div><b>3</b><span>确认后「加入待入库」，在右侧标「通过 / 退回」。只有通过的才会进导出 CSV。</span></div>' +
      '</div></div>' +
      '</section>' +
      '<aside>' +
      '<div class="block"><div class="block-h"><h3>缺口分析</h3><span class="tag">按缺口排优先级</span></div>' +
      '<div id="gap-out"></div></div>' +
      '<div class="block"><div class="block-h"><h3>检索计划</h3><span class="tag">给下次全网搜索用</span></div>' +
      '<label class="f">目标模型</label><select id="sp-model">' +
      Object.keys(MODELS).map(k => '<option value="' + k + '">' + MODELS[k].name + '</option>').join('') + '</select>' +
      '<label class="f" style="margin-top:9px">想补的方向（逗号分隔）</label>' +
      '<input type="text" id="sp-tags" placeholder="欧美面孔, 东南亚, cosplay">' +
      '<div class="pv-actions"><button class="btn" id="btn-plan">生成检索方案</button></div>' +
      '<div id="plan-out"></div></div>' +
      '<div class="block"><div class="block-h"><h3>待入库队列</h3><span class="tag" id="q-n">0 条</span></div>' +
      '<div id="q-list"><div class="empty" style="padding:20px">空</div></div>' +
      '<div class="pv-actions"><button class="btn primary" id="btn-export" style="flex:1">导出通过项 CSV</button></div></div>' +
      '</aside></div>';

    $('#btn-analyze').onclick = doAnalyze;
    $('#btn-demo').onclick = () => {
      $('#raw').value = 'A beautiful young asian woman standing by the window in a cafe, soft rim light from the left, wearing an oversized beige knit sweater, (film grain:1.3), shallow depth of field, 85mm lens --ar 3:4 --v 6 --no blurry, watermark, extra fingers';
      doAnalyze();
    };
    $('#btn-clearq').onclick = () => { queue = []; mem.queue = queue; persist(); drawQueue(); toast('队列已清空'); };
    $('#btn-plan').onclick = doPlan;
    $('#btn-export').onclick = exportCSV;
    $('#drop').onclick = () => $('#pngfile').click();
    $('#pngfile').onchange = e => { if (e.target.files[0]) readPng(e.target.files[0]); };
    ['dragover', 'dragenter'].forEach(ev => $('#drop').addEventListener(ev, e => { e.preventDefault(); $('#drop').classList.add('on'); }));
    ['dragleave', 'drop'].forEach(ev => $('#drop').addEventListener(ev, e => { e.preventDefault(); $('#drop').classList.remove('on'); }));
    $('#drop').addEventListener('drop', e => {
      const f = e.dataTransfer.files[0]; if (f) readPng(f);
    });
    drawQueue(); drawGap();
  }

  function readPng(file) {
    if (!/\.png$/i.test(file.name)) { toast('目前只解析 PNG 内嵌元数据'); return; }
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const r = pngToPrompt(fr.result);
        if (!r.prompt) { toast('这张图没有内嵌提示词（可能被平台压过）'); return; }
        $('#raw').value = r.prompt + (r.negative ? '\nNegative prompt: ' + r.negative : '');
        const kv = Object.keys(r.params || {}).filter(k => r.params[k]).map(k => k + '=' + r.params[k]).join(' · ');
        $('#drop').innerHTML = '已识别 <b>' + U.esc(r.source) + '</b>' + (kv ? '<br><span class="mono">' + U.esc(kv) + '</span>' : '');
        doAnalyze();
        toast('已提取 ' + r.source + ' 元数据');
      } catch (err) { toast('解析失败：' + err.message); }
    };
    fr.readAsArrayBuffer(file);
  }

  function doAnalyze() {
    const raw = $('#raw').value.trim();
    if (!raw) { toast('先贴点内容'); return; }
    ing = analyzeIngest(raw);
    const segRows = SEGMENTS.filter(s => ing.seg[s.k]);
    $('#ing-out').innerHTML =
      '<div class="block-h"><h3>分析结果</h3><span class="tag">' + U.esc(ing.src.label) + '</span>' +
      '<div class="right"><button class="btn sm primary" id="btn-addq">加入待入库</button></div></div>' +
      '<div class="row" style="margin-bottom:9px"><div><label class="f">用途标签（入库时用）</label>' +
      '<input type="text" id="ing-tag" placeholder="如 日系人像 / 产品静物" value="' + U.esc(state.tag || '') + '"></div></div>' +
      '<div class="kv">' +
      '<em>清洗</em><span>' + (ing.notes.length ? U.esc(ing.notes.join('；')) : '无需清洗') +
      (ing.posFixed ? '；负面转正面 ' + ing.posFixed + ' 处' : '') + '</span>' +
      '<em>建议评分</em><span>' + ing.score + ' · 命中 ' + ing.slots.length + ' 个槽位 · ' + ing.len + ' 字</span>' +
      '<em>拆分结果</em><span>' + ing.slots.map(s => '【' + s + '】').join(' ') + '</span>' +
      '</div>' +
      segRows.map(s => '<div style="margin-top:8px"><label class="f">' + (s.slot ? '【' + s.slot + '】' : s.para) + '</label>' +
        '<textarea data-ingseg="' + s.k + '" style="min-height:44px;font-size:12.5px">' + U.esc(ing.seg[s.k]) + '</textarea></div>').join('') +
      '<div style="margin-top:12px"><label class="f">查重（库内最相似 3 条）</label>' +
      (ing.dups.length ? ing.dups.map(d => '<div class="dup"><span class="sim">' + (d.sim * 100).toFixed(0) + '%</span>' +
        '<b>' + d.id + '</b> ' + U.esc(d.name) + (d.sim > 0.85 ? ' <span class="lv err">超阈值</span>' : '') + '</div>').join('')
        : '<div class="dup">库内没有相似条目，可以放心入库</div>') + '</div>';

    $('#btn-addq').onclick = () => {
      const blocked = ing.dups.some(d => d.sim > 0.85);
      queue.push({
        qid: 'Q' + Date.now().toString(36),
        tag: (($('#ing-tag') && $('#ing-tag').value.trim()) || state.tag || '未分类'), score: ing.score,
        prompt: build({ ...state, seg: ing.seg }).text, seg: ing.seg,
        src: ing.src.label, status: blocked ? 'no' : 'pending',
        note: blocked ? '相似度超 85%，疑似重复' : '',
        dup: ing.dups[0] ? ing.dups[0].id + ' ' + (ing.dups[0].sim * 100).toFixed(0) + '%' : ''
      });
      mem.queue = queue; persist(); drawQueue();
      toast(blocked ? '相似度过高，已标为退回' : '已加入队列，待审');
    };
    $$('[data-ingseg]').forEach(t => t.oninput = e => { ing.seg[e.target.dataset.ingseg] = e.target.value; });
  }

  function drawQueue() {
    const box = $('#q-list'); if (!box) return;
    const pass = queue.filter(q => q.status === 'ok').length;
    $('#q-n').textContent = queue.length + ' 条 · 通过 ' + pass;
    if (!queue.length) { box.innerHTML = '<div class="empty" style="padding:20px">空</div>'; return; }
    box.innerHTML = queue.map((q, i) =>
      '<div class="q-item ' + q.status + '">' +
      '<div class="q-h"><span class="q-st ' + q.status + '">' +
      (q.status === 'ok' ? '通过' : q.status === 'no' ? '退回' : '待审') + '</span>' +
      '<span class="q-sc">' + q.score + '</span><b>' + U.esc(q.tag) + '</b></div>' +
      '<div class="q-p">' + U.esc(q.prompt.slice(0, 60)) + '…</div>' +
      (q.note ? '<div class="q-note">' + U.esc(q.note) + '</div>' : '') +
      '<div class="pv-actions inline">' +
      '<button class="btn sm" data-qok="' + i + '">通过</button>' +
      '<button class="btn sm" data-qno="' + i + '">退回</button>' +
      '<button class="btn sm ghost" data-qdel="' + i + '">删</button></div></div>').join('');
    $$('[data-qok]').forEach(b => b.onclick = () => { queue[+b.dataset.qok].status = 'ok'; mem.queue = queue; persist(); drawQueue(); });
    $$('[data-qno]').forEach(b => b.onclick = () => {
      const q = queue[+b.dataset.qno];
      q.status = 'no';
      const r = prompt('退回原因（可留空）', q.note || '');
      if (r != null) q.note = r;
      mem.queue = queue; persist(); drawQueue();
    });
    $$('[data-qdel]').forEach(b => b.onclick = () => { queue.splice(+b.dataset.qdel, 1); mem.queue = queue; persist(); drawQueue(); });
  }

  function exportCSV() {
    const pass = queue.filter(q => q.status === 'ok');
    if (!pass.length) { toast('没有「通过」的条目，先审核'); return; }
    const next = LIB.image.length + 1;
    const head = ['编号', '名称', '类型', '用途标签', '画幅规格', '质量评分', '日期', '版本', '来源',
      '最终提示词（槽位用【】）', '槽位清单', '生成参数', '锚点参考图', '备注经验',
      'ComfyUI 分辨率', 'Steps（建议）', 'CFG（建议）', '采样器 · 调度器', '推荐模型', '可用模型', 'ComfyUI 工作流与约束'];
    const rows = pass.map((q, i) => {
      const id = 'P-' + String(next + i).padStart(3, '0');
      const r = resolve(state.model, state);
      const slots = slotsOf(q.prompt);
      return [id, (q.tag || '采集') + '·待命名', '图片', q.tag, state.aspect, q.score, today(), 'v1',
        q.src || '全网采集', q.prompt, slots.join(' / '), state.aspect + ' · ' + q.tag,
        '', '采集入库，待补实测备注', r.res, r.steps, r.cfg, r.sampler + ' · ' + r.scheduler,
        MODELS[state.model].name, inferModels({ prompt: q.prompt, model: MODELS[state.model].name }).join('/'),
        '待补节点链'];
    });
    const csv = [head].concat(rows)
      .map(r => r.map(v => {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',')).join('\n');
    download('promptforge_patch_' + today() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('已导出 ' + pass.length + ' 条（退回的不导出）');
  }

  function drawGap() {
    const g = gapAnalysis();
    const l1 = Object.keys(g.l1).sort((a, b) => g.l1[b] - g.l1[a]);
    const max = Math.max.apply(null, l1.map(k => g.l1[k]));
    $('#gap-out').innerHTML =
      '<div class="gap-bars">' + l1.map(k =>
        '<div class="gap-row"><span class="gl">' + k + '</span>' +
        '<span class="gb"><i style="width:' + Math.round(g.l1[k] / max * 100) + '%"></i></span>' +
        '<span class="gn">' + g.l1[k] + '</span></div>').join('') + '</div>' +
      '<div class="hintline" style="margin-top:10px">最薄的方向（仅 1 条）：</div>' +
      '<div class="chips">' + g.thin.slice(0, 10).map(x =>
        '<button class="chip" data-gapq="' + U.esc(x.tag) + '">' + U.esc(x.tag) + '</button>').join('') + '</div>' +
      '<div class="hintline" style="margin-top:8px">词库最薄的维度：' +
      g.dims.slice(0, 4).map(d => d.dim + ' ' + d.n + ' 词').join(' · ') + '</div>' +
      '<div class="hintline" style="margin-top:12px">检索直达（v3：不用再手打关键词）：</div>' +
      '<div class="linkrow" id="gap-links"></div>';
    $$('[data-gapq]').forEach(b => b.onclick = () => {
      $('#sp-tags').value = b.dataset.gapq;
      drawSiteLinks(b.dataset.gapq);
      doPlan();
      toast('已生成该方向的检索式');
    });
    drawSiteLinks((g.thin[0] && g.thin[0].tag) || 'portrait');
  }

  /* v3 · 四站检索直达 */
  function drawSiteLinks(tag) {
    const box = $('#gap-links'); if (!box) return;
    const q = encodeURIComponent(U.clean(tag) || 'portrait');
    const sites = [
      ['PromptHero', 'https://prompthero.com/search?q=' + q],
      ['Lexica', 'https://lexica.art/?q=' + q],
      ['Civitai', 'https://civitai.com/search/images?query=' + q],
      ['PromptBase', 'https://promptbase.com/search?q=' + q]
    ];
    box.innerHTML = '<span class="mono muted" style="margin-right:6px">' + U.esc(tag) + ' →</span>' +
      sites.map(x => '<a class="site-link" href="' + x[1] + '" target="_blank" rel="noopener">' + x[0] + '</a>').join('') +
      '<button class="btn sm" id="btn-copy-q">复制检索词</button>';
    const b = $('#btn-copy-q');
    if (b) b.onclick = () => copy(U.clean(tag), '检索词已复制');
  }

  function doPlan() {
    const model = $('#sp-model').value;
    const tags = $('#sp-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const p = searchPlan({ model, type: '', tags });
    const next = new Date(Date.now() + 7 * 864e5);
    $('#plan-out').innerHTML =
      '<div style="margin-top:12px"><label class="f">检索式</label>' +
      p.queries.map(q => '<div class="dup" style="cursor:pointer" data-copyq="' + U.esc(q) + '">' + U.esc(q) + '</div>').join('') +
      '</div><div style="margin-top:10px"><label class="f">验收标准</label><ul class="tiny">' +
      p.accept.map(x => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
      '<div style="margin-top:10px"><label class="f">直接排除</label><ul class="tiny muted">' +
      p.exclude.map(x => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
      '<div class="cadence">建议节奏：每 7 天跑一轮 · 下次 ' + next.toISOString().slice(0, 10) + '</div>';
    $$('#plan-out [data-copyq]').forEach(b => b.onclick = () => copy(b.dataset.copyq, '检索式已复制'));
  }

  /* =======================================================================
   * 实验（A/B 矩阵 + 多模型）
   * ===================================================================== */
  let abPick = { light: true, camera: true, style: false, scene: false };
  let abResult = null;

  function renderLab() {
    const dims = Object.keys(AB_DIMS);
    $('#view').innerHTML =
      '<div class="pad">' +
      '<div class="block"><div class="block-h"><h3>A/B 批量矩阵</h3>' +
      '<span class="tag">同一主体 × N 种变量，一次排完再打分</span></div>' +
      '<div class="row">' + dims.map(k =>
        '<label class="check"><input type="checkbox" data-abtop="' + k + '"' + (abPick[k] ? ' checked' : '') + '> ' + AB_DIMS[k].label + '</label>').join('') +
      '</div><div id="ab-vals"></div>' +
      '<div class="pv-actions inline" style="margin-top:10px">' +
      '<button class="btn primary" id="ab-gen">生成矩阵</button>' +
      '<button class="btn" id="ab-exp">导出清单 CSV</button>' +
      '<span class="hintline" id="ab-n"></span></div></div>' +
      '<div id="ab-out"><div class="block"><div class="hintline">勾好变量后点「生成矩阵」。系统会按当前槽位内容，把每种组合拼成一条完整提示词，编号排好，你只要照着跑。</div></div></div>' +
      '<div class="block"><div class="block-h"><h3>变量经验表</h3><span class="tag">打分后自动聚合</span></div>' +
      '<div id="ab-exp-table"><div class="hintline">还没有实验数据。生成矩阵、跑图、给每格打分，这里会沉淀出「哪种光线/镜头最稳」。</div></div></div>' +
      '</div>';

    $$('[data-abtop]').forEach(c => c.onchange = () => { abPick[c.dataset.abtop] = c.checked; drawAbVals(); });
    drawAbVals();
    $('#ab-gen').onclick = genAb;
    $('#ab-exp').onclick = exportAb;
    renderAbTable();
  }

  function drawAbVals() {
    const box = $('#ab-vals'); if (!box) return;
    box.innerHTML = Object.keys(AB_DIMS).filter(k => abPick[k]).map(k =>
      '<div class="ab-dim"><label class="f">' + AB_DIMS[k].label + '（勾选要跑的取值）</label><div class="chips">' +
      AB_DIMS[k].values.map((v, i) =>
        '<label class="chip check"><input type="checkbox" data-abval="' + k + '" value="' + U.esc(v) + '"' + (i < 2 ? ' checked' : '') + '> ' + U.esc(v) + '</label>').join('') +
      '</div></div>').join('');
  }

  function genAb() {
    const picks = {};
    Object.keys(AB_DIMS).filter(k => abPick[k]).forEach(k => {
      picks[k] = $$('[data-abval="' + k + '"]').filter(c => c.checked).map(c => c.value);
    });
    const cells = abMatrix(state, picks, 24);
    if (!cells.length) { toast('至少勾一个变量和一个取值'); return; }
    abResult = { created: today(), dims: picks, cells: cells.map(c => ({ label: c.label, vars: c.vars, text: c.text, rate: 0 })) };
    $('#ab-n').textContent = cells.length + ' 组';
    $('#ab-out').innerHTML = '<div class="block"><div class="block-h"><h3>' + cells.length + ' 组待跑</h3>' +
      '<span class="tag">跑完给每格打 1–5 分</span></div>' +
      '<div class="ab-grid">' + abResult.cells.map((c, i) =>
        '<div class="ab-cell"><div class="ab-h">#' + (i + 1) + ' ' + U.esc(c.label) + '</div>' +
        '<div class="ab-p">' + U.esc(c.text.slice(0, 90)) + '…</div>' +
        '<div class="rate" data-rate="' + i + '">' + [1, 2, 3, 4, 5].map(n =>
          '<button data-rv="' + n + '" class="' + (c.rate === n ? 'on' : '') + '">' + n + '</button>').join('') + '</div>' +
        '<button class="btn sm" data-abcopy="' + i + '">复制</button></div>').join('') + '</div></div>';
    $$('[data-abcopy]').forEach(b => b.onclick = () => copy(abResult.cells[+b.dataset.abcopy].text, '已复制'));
    $$('.rate [data-rv]').forEach(b => b.onclick = () => {
      const i = +b.parentNode.dataset.rate;
      abResult.cells[i].rate = +b.dataset.rv;
      b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      renderAbTable();
    });
    renderAbTable(true);
  }

  function exportAb() {
    if (!abResult || !abResult.cells.length) { toast('先生成矩阵'); return; }
    const head = ['序号', '变量组合', '提示词', '评分'];
    const rows = abResult.cells.map((c, i) => [i + 1, c.label, c.text, c.rate || '']);
    const csv = [head].concat(rows).map(r => r.map(v => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    download('ab_matrix_' + today() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
  }

  function renderAbTable(fromGen) {
    const box = $('#ab-exp-table'); if (!box) return;
    if (!abResult || !abResult.cells.some(c => c.rate)) {
      if (!fromGen) return;
      box.innerHTML = '<div class="hintline">给上面任意一格打过分，这里就会出经验表。</div>';
      return;
    }
    const stat = {};
    abResult.cells.filter(c => c.rate).forEach(c => {
      Object.keys(c.vars).forEach(k => {
        const key = k + '|' + c.vars[k];
        stat[key] = stat[key] || { k, v: c.vars[k], sum: 0, n: 0 };
        stat[key].sum += c.rate; stat[key].n++;
      });
    });
    const order = Object.keys(AB_DIMS);
    const arr = Object.values(stat).map(x => ({ ...x, avg: x.sum / x.n }))
      .sort((a, b) => (order.indexOf(a.k) - order.indexOf(b.k)) || (b.avg - a.avg));
    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>变量</th><th>取值</th><th>样本</th><th>平均分</th></tr></thead><tbody>' +
      arr.map(x => '<tr><td>' + AB_DIMS[x.k].label + '</td><td>' + U.esc(x.v) + '</td><td>' + x.n + '</td>' +
        '<td><b class="' + (x.avg >= 4 ? 'ok' : x.avg >= 3 ? 'warn' : 'err') + '">' + x.avg.toFixed(2) + '</b></td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="hintline">样本数少的取值先别下结论，至少 2 次再比较。</div>';
  }

  /* =======================================================================
   * 方案
   * ===================================================================== */
  const BLUEPRINT_HEAD = `
<div class="doc">
  <h2>这套系统怎么运作</h2>
  <p class="lead">一句话：<b>槽位是输入，模型是编译器</b>。同一组「主体 / 人物特征 / 服饰造型 / 场景环境」+ 段落修饰，经过不同模型的适配规则，输出完全不同的提示词和参数。库里的素材既是参照样本，也是采集回流的终点。</p>

  <h2>一、四层结构</h2>
  <table>
    <tr><th style="width:110px">层</th><th>职责</th><th style="width:220px">本系统的落点</th></tr>
    <tr><td><b>数据层</b></td><td>254 条生图、200 条生视频、31 条参数配置、36 条编辑链、42 维度词库</td><td><code>data/library.json</code></td></tr>
    <tr><td><b>规则层</b></td><td>模型适配、参数联动、体检规则、评分权重、失败案例、负向映射</td><td><code>src/engine.js</code></td></tr>
    <tr><td><b>交互层</b></td><td>装配、词库、库、采集、实验、检索计划</td><td><code>src/app.js</code></td></tr>
    <tr><td><b>回流层</b></td><td>采集 → 清洗 → 拆槽 → 查重 → 审核 → 补丁 CSV → 合并进库 → 出图记录</td><td>采集页 + 产出记录</td></tr>
  </table>

  <h2>二、模型适配矩阵</h2>
  <table>
    <tr><th>维度</th><th>Z-Image Turbo</th><th>Z-Image Base</th><th>Z-Image-Edit</th><th>MiniMax H3</th><th>SDXL / Flux</th></tr>
    <tr><td>提示词语言</td><td>中文结构化</td><td>中文结构化</td><td>中文指令句</td><td>中文叙事 + 音效</td><td>英文关键词</td></tr>
    <tr><td>权重语法</td><td>不支持</td><td>不支持</td><td>不支持</td><td>不支持</td><td>支持 <code>(x:1.2)</code></td></tr>
    <tr><td>负面提示词</td><td>无效（ConditioningZeroOut）</td><td>支持</td><td>支持</td><td>无（BasicGuider）</td><td>支持</td></tr>
    <tr><td>步数 / CFG</td><td>8 / 1.0 锁定</td><td>30 / 4.0</td><td>28 / 7.5</td><td>4 或 20 / 无</td><td>28 / 6.0</td></tr>
    <tr><td>分辨率约束</td><td>16 的倍数，≤ 4MP</td><td>16 的倍数，≤ 4MP</td><td>同 Base</td><td>32 的倍数</td><td>8 的倍数</td></tr>
    <tr><td>特有硬约束</td><td>文字类易糊，改 Base</td><td>慢 3–4 倍</td><td>只写目标态，不复述保留</td><td>帧数 17n+5、24fps、必写声音</td><td>锁脸走 InstantID/PuLID</td></tr>
  </table>

  <div class="callout"><b>为什么必须做适配层：</b>库里已经踩过的坑——Turbo 上写负面词等于没写、CFG 一调就色彩爆炸、H3 不写声音直接静音、Edit 里写「保留人物五官」反而干扰指令。这些不是提示词写得好不好的问题，是模型机制决定的。系统把机制固化成规则，人就不用每次都记。</div>
`;

  const BLUEPRINT_TAIL = `
  <h2>六、维护 SOP</h2>
  <ol>
    <li>改数据：云端资料库为准 → 反向同步本地 xlsx → <code>python3 build_data.py</code> → 页面自动用新数据。</li>
    <li>改规则：只动 <code>src/engine.js</code> 的 MODELS / lint / resolve / FAILURE_DB，UI 不用碰。</li>
    <li>加词库：往 xlsx「填写指南」词库区加行 → 重建数据 → 词库页自动多一个维度卡片。</li>
    <li>发布：<code>python3 build.py</code> 生成单文件 <code>dist/提示词锻造台.html</code>，可直接分享、离线打开。</li>
  </ol>
  <p class="hintline">本页所有能力均为纯前端实现，数据存 localStorage；清浏览器数据前请先「导出清单 / 补丁 CSV」留档。</p>
</div>`;

  /* =======================================================================
   * 竞品对照（v3 新增）
   * ===================================================================== */
  let benchTab = 'rank';

  function avg4(o) { return ((o.fn + o.ar + o.ux + o.fd) / 4); }

  function renderBench() {
    const SELF = { n: '提示词锻造台 v3（本系统）', u: '单文件 · 离线 · 无账号', k: '提示词编译器', fn: 5, ar: 4, ux: 4, fd: 5 };
    const all = BENCH.SITES.concat(BENCH.REPOS).map(o => ({ o, a: avg4(o), self: false }))
      .concat([{ o: SELF, a: avg4(SELF), self: true }])
      .sort((x, y) => y.a - x.a);
    const mine = BENCH.MATRIX['本系统 v2'] || [];
    const tabs = [['rank', '总览榜'], ['site', '网页 10'], ['repo', '开源 10'], ['cap', '能力矩阵'], ['gap', '机会点'], ['act', '落地']];

    let h = '<div class="toolbar"><div class="seg-tabs">' +
      tabs.map(t => '<button class="st' + (benchTab === t[0] ? ' on' : '') + '" data-bt="' + t[0] + '">' + t[1] + '</button>').join('') +
      '</div><span class="n">20 个同类产品 · 4 维评分 · 16 项能力</span></div><div id="bench-body"></div>';
    $('#view').innerHTML = h;
    $$('[data-bt]').forEach(b => b.onclick = () => { benchTab = b.dataset.bt; renderBench(); });

    const box = $('#bench-body');
    const scoreCell = v => '<span class="bsc bsc' + v + '">' + v + '</span>';

    if (benchTab === 'rank') {
      box.innerHTML =
        '<div class="card"><div class="card-h"><b>评分口径</b><span class="tag">四项等权，满分 5</span></div>' +
        '<div class="grid2">' + BENCH.RUBRIC.map(r =>
          '<div class="kv"><b>' + r.name + '</b><span class="muted">' + r.desc + '</span></div>').join('') + '</div></div>' +

        '<div class="tbl-wrap" style="margin-top:12px"><table><tr><th style="width:44px">#</th><th style="width:330px">产品</th><th>类型</th>' +
        `<th style="width:56px">功能</th><th style="width:56px">架构</th><th style="width:56px">易用</th><th style="width:56px">字段</th>` +
        '<th style="width:132px">均分</th></tr>' +
        all.map((x, i) =>
          '<tr' + (x.self ? ' class="self-row"' : '') + '><td class="mono">' + (i + 1) + '</td>' +
          '<td><b>' + U.esc(x.o.n) + '</b><br><span class="mono muted">' + U.esc(x.o.u) + '</span></td>' +
          '<td class="muted">' + U.esc(x.o.k) + '</td>' +
          '<td>' + scoreCell(x.o.fn) + '</td><td>' + scoreCell(x.o.ar) + '</td>' +
          '<td>' + scoreCell(x.o.ux) + '</td><td>' + scoreCell(x.o.fd) + '</td>' +
          '<td class="nowrap"><div class="as-bar ok"><i style="width:' + (x.a / 5 * 100) + '%"></i></div><span class="mono">' + x.a.toFixed(2) + '</span></td></tr>'
        ).join('') +
        '</table></div>' +

        '<div class="card" style="margin-top:14px"><div class="card-h"><b>读完这张榜，三句话</b></div><ol class="bench-ol">' +
        '<li><b>易用性不构成壁垒。</b>排在前面的 PromptHero / Lexica / Fooocus 系全是「打开就能看」，但它们的提示词是一条裸文本 —— 好看，不能改。</li>' +
        '<li><b>工程化最强的一批（PromptLayer 4.25 / Langfuse / promptfoo）全是为文本 LLM 造的。</b>它们有版本、有断言、有 CI，但完全不理解 CFG 锁定、17n+5 帧、32 倍数这些图像/视频模型的硬约束。</li>' +
        '<li><b>字段最全的两类人各缺一半。</b>Civitai 有 12 个参数元数据却没有语义槽位；PromptFlow 有 11 个语义字段却没有参数与库。本系统的位置正好在两者之间，且多一层「模型编译」。</li>' +
        '<li><b>本系统排第 ' + (all.findIndex(x => x.self) + 1) + '，丢分全在「同步协作」和「API 自动化」——这两项是刻意不做的。</b>如果把它们算进来，就等于放弃「一个 HTML 双击即用」这个唯一无可替代的优势。</li>' +
        '</ol></div>';
      return;
    }

    if (benchTab === 'site' || benchTab === 'repo') {
      const list = benchTab === 'site' ? BENCH.SITES : BENCH.REPOS;
      const isRepo = benchTab === 'repo';
      box.innerHTML =
        '<div class="toolbar" style="margin-bottom:8px"><span class="n">' +
        (isRepo ? '10 个开源项目，按 GitHub 星数标注' : '10 个网页产品，2026-11 实测') + '</span></div>' +
        list.map((o, i) =>
          '<div class="card bench-card"><div class="card-h"><b>' + (i + 1) + '. ' + U.esc(o.n) + '</b>' +
          (isRepo ? '<span class="tag">★ ' + U.esc(o.star) + '</span>' : '') +
          '<span class="tag">' + U.esc(o.k) + '</span>' +
          '<span class="right mono muted">' + U.esc(o.u) + '</span></div>' +
          '<div class="bench-sc">' +
          '<span>功能 ' + scoreCell(o.fn) + '</span><span>架构 ' + scoreCell(o.ar) + '</span>' +
          '<span>易用 ' + scoreCell(o.ux) + '</span><span>字段 ' + scoreCell(o.fd) + '</span>' +
          '<span class="muted">均分 ' + avg4(o).toFixed(2) + '</span></div>' +
          '<div class="bench-body"><p><b class="lab">做什么</b>' + U.esc(o.f) + '</p>' +
          '<p><b class="lab">架构</b>' + U.esc(o.a) + '</p>' +
          '<p><b class="lab">字段</b><span class="mono">' + U.esc(o.fields) + '</span></p>' +
          '<p class="win"><b class="lab">强项</b>' + U.esc(o.win) + '</p>' +
          '<p class="lose"><b class="lab">短板</b>' + U.esc(o.lose) + '</p></div></div>').join('');
      return;
    }

    if (benchTab === 'cap') {
      const names = Object.keys(BENCH.MATRIX);
      const cell = v => '<td class="cap cap' + v + '" title="' + (v === 2 ? '完备' : v === 1 ? '部分' : '无') + '">' + (v === 2 ? '●' : v === 1 ? '◐' : '·') + '</td>';
      box.innerHTML =
        '<div class="card"><div class="card-h"><b>16 项能力矩阵</b><span class="tag">● 完备　◐ 部分　· 无</span></div>' +
        '<p class="muted" style="margin:0 0 10px">横向看谁强，纵向看哪些能力是「有人做过」的成熟件、哪些是空白。最后一行是本系统。</p></div>' +
        '<div class="tbl-wrap cap-wrap" style="margin-top:10px"><table class="cap-tbl"><tr><th style="width:150px">产品</th>' +
        BENCH.CAPS.map(c => '<th class="cap-h">' + c.n + '</th>').join('') + '<th style="width:50px">得分</th></tr>' +
        names.map(n => {
          const row = BENCH.MATRIX[n];
          const sum = row.reduce((a, b) => a + b, 0);
          return '<tr class="' + (n.indexOf('本系统') >= 0 ? 'self-row' : '') + '"><td><b>' + U.esc(n) + '</b></td>' +
            row.map(cell).join('') + '<td class="mono">' + sum + '/32</td></tr>';
        }).join('') +
        '</table></div>' +
        '<div class="card" style="margin-top:14px"><div class="card-h"><b>纵向结论</b></div><ul class="bench-ul">' +
        BENCH.CAPS.map((c, i) => {
          const vals = names.map(n => BENCH.MATRIX[n][i]);
          const full = vals.filter(v => v === 2).length;
          const none = vals.filter(v => v === 0).length;
          const tone = full === 0 ? '空白' : full <= 2 ? '稀缺' : full <= 5 ? '常见' : '红海';
          return '<li><b>' + c.n + '</b>　完备 ' + full + ' 家 / 完全没有 ' + none + ' 家 → <b class="tone-' +
            (tone === '空白' ? 'gap' : tone === '稀缺' ? 'rare' : 'hot') + '">' + tone + '</b></li>';
        }).join('') + '</ul></div>';
      return;
    }

    if (benchTab === 'gap') {
      box.innerHTML =
        '<div class="card"><div class="card-h"><b>差异化机会点</b><span class="tag">7 条</span></div>' +
        '<p class="muted" style="margin:0">判断标准只有一条：<b>竞品做不了，或者做起来不划算。</b>做不到的才叫机会，做得更好的叫追赶。</p></div>' +
        BENCH.GAPS.map((g, i) =>
          '<div class="card gap-card"><div class="card-h"><b>' + (i + 1) + '. ' + U.esc(g.t) + '</b></div>' +
          '<p>' + U.esc(g.d) + '</p>' +
          '<p class="why"><b>为什么算机会</b>' + U.esc(g.why) + '</p></div>').join('');
      return;
    }

    box.innerHTML =
      '<div class="card"><div class="card-h"><b>取长补短 → 本轮落地</b><span class="tag">' + BENCH.BORROW.length + ' 项</span></div>' +
      '<p class="muted" style="margin:0 0 6px">每一项都指向一个具体竞品的成熟做法，落地后能在这个页面里直接点到。</p></div>' +
      '<div class="tbl-wrap" style="margin-top:10px"><table><tr><th style="width:44px">编号</th><th style="width:200px">学谁</th>' +
      '<th style="width:170px">成熟能力</th><th>在本系统怎么落地</th><th style="width:52px">优先级</th><th style="width:60px">状态</th></tr>' +
      BENCH.BORROW.map(b =>
        '<tr><td class="mono">' + b.id + '</td><td class="muted">' + U.esc(b.from) + '</td>' +
        '<td><b>' + U.esc(b.cap) + '</b></td><td>' + U.esc(b.doing) + '</td>' +
        '<td class="mono" style="white-space:nowrap">' + b.lvl + '</td><td><span class="st-badge on">已上线</span></td></tr>').join('') +
      '</table></div>' +
      '<div class="card" style="margin-top:14px"><div class="card-h"><b>本轮明确「不做」的三件事</b></div><ul class="bench-ul">' +
      '<li><b>不做账号与多人协作。</b>PromptLayer / Langfuse 的核心价值在团队，本系统的用户是单个创作者；加账号就等于把「双击即用」这个最大优势交出去。需要协作时，把 HTML 发过去，或把数据推回云端表格。</li>' +
      '<li><b>不做站内生成。</b>没有 GPU，也不该替用户选云服务。导出 ComfyUI JSON / A1111 参数串，本地跑，结果回填「出图记录」——这条链路已经闭合。</li>' +
      '<li><b>不做社区与市场。</b>PromptBase 的规模靠审核团队和交易抽成，个人项目做不了；本系统的替代方案是「采集 → 审核 → 补丁 CSV → 合并回云端库」，质量下限靠断言套件守。</li>' +
      '</ul></div>';
  }

  function renderBlueprint() {
    const rows = [
      ['P0-1', '槽位命名归一', '已上线', '引擎内置 40 组别名映射；采集拆槽前先归一；数据体检可一键定位全部非标准槽位'],
      ['P0-2', '可用模型多值', '已上线', '按 model 列 + 提示词特征推断每条可用模型；库里可多值筛选；补丁 CSV 输出「推荐模型 + 可用模型」两列'],
      ['P0-3', 'seed 与产出记录', '已上线', '装配页「出图记录」写入 localStorage；库里显示产出次数；产出记录页按均值排序'],
      ['P1-1', '版本树与差异对比', '已上线', '存版本 → 与当前做段级 diff，红删绿增，同时显示评分变化'],
      ['P1-2', 'A/B 批量出图', '已上线', '四类变量任意组合（上限 24 组），逐格打分后聚合出「取值 → 平均分」经验表'],
      ['P1-3', 'ComfyUI JSON 直出', '已上线', 'Turbo/Base/Edit/SDXL 生成标准 API 格式节点图；H3 输出参数清单（非原生节点，不编节点名）'],
      ['P1-4', '负面词库', '已上线', '142 条双向映射，覆盖画质 / 人体 / AI 痕迹 / 视频 / 英文；词库页有批量正负互转器'],
      ['P2-1', '失败案例库', '已上线', '38 条真实失败模式（现象/归因/改法）；可搜可筛；命中当前文本时自动挂到体检里'],
      ['P2-2', '图生文回流', '部分上线', 'PNG 内嵌元数据（ComfyUI prompt / A1111 parameters）自动提取；无元数据的图仍需按引导描述'],
      ['P2-3', '风格 LoRA 绑定', '已上线', '内置 5 个通用风格位 + 自定义录入；绑定后体检会检查触发词是否漏写'],
      ['P2-4', '多模型同题对照', '已上线', '同一组槽位并排输出五个模型的提示词与参数，可导出 Markdown'],
      ['P3-1', '标签三层收敛', '已上线', '143 个生图标签 + 105 个视频标签收敛成 题材/用途/风格 三层，未映射归零'],
      ['P3-2', '采集审核流', '已上线', '队列条目分 待审/通过/退回，只有通过项参与导出；相似度超 85% 自动标退回'],
      ['P3-3', '检索节奏', '已上线', '缺口分析按 L1 分布与薄弱标签排序；检索方案附下次执行日期']
    ];
    $('#view').innerHTML = BLUEPRINT_HEAD +
      '<h2>三、本轮升级落地清单</h2>' +
      '<p>下表是「你还没想到、但建议补的」14 项在 v2 里的实际状态。<b>「已上线」= 打开就能用，「部分上线」= 受浏览器能力限制做了可执行的那一半，并写明限制。</b></p>' +
      '<table><tr><th style="width:56px">编号</th><th style="width:150px">能力</th><th style="width:88px">状态</th><th>怎么用</th></tr>' +
      rows.map(r => '<tr><td class="mono">' + r[0] + '</td><td><b>' + r[1] + '</b></td>' +
        '<td><span class="st-badge ' + (r[2] === '已上线' ? 'on' : 'part') + '">' + r[2] + '</span></td>' +
        '<td>' + r[3] + '</td></tr>').join('') + '</table>' +

      '<h2>四、浏览器做不了的部分，怎么补</h2>' +
      '<table><tr><th style="width:150px">能力</th><th>限制原因</th><th>替代做法</th></tr>' +
      '<tr><td>全网搜索</td><td>同源策略，页面不能自己联网检索</td><td>生成检索式 → 交给能联网的助手或自己搜 → 结果粘进采集页</td></tr>' +
      '<tr><td>看图反推</td><td>无视觉模型，且不能上传你的图</td><td>优先读 PNG 元数据；没有元数据的图，按槽位引导手动描述</td></tr>' +
      '<tr><td>真出图</td><td>没有本地 GPU / ComfyUI 接口</td><td>导出 ComfyUI JSON 或参数，本地跑；结果回填到「出图记录」</td></tr>' +
      '<tr><td>改云端表格</td><td>页面无云端写权限</td><td>导出补丁 CSV，合并回云端资料库后再 <code>build_data.py</code></td></tr>' +
      '</table>' +

      '<h2>五、日常怎么用</h2>' +
      '<ol>' +
      '<li><b>要出图</b>：装配页填槽位 → 看体检 → 复制提示词 / 导出 ComfyUI JSON → 跑完回来记录 seed 与评分。</li>' +
      '<li><b>要迭代</b>：改完先「存为版本」，再改；用「对比当前」看具体改了哪几个字、评分涨没涨。</li>' +
      '<li><b>要做实验</b>：实验页勾光线/镜头/风格，生成矩阵，一次跑 8–24 张，逐格打分，经验表告诉你哪种组合最稳。</li>' +
      '<li><b>要补库</b>：采集页看缺口 → 生成检索式 → 搜到内容粘回来 → 分析 → 审核 → 导出补丁 CSV。</li>' +
      '<li><b>要排错</b>：库页「失败案例」搜现象，或直接看装配页体检末尾挂出来的 F-xx。</li>' +
      '<li><b>要复用</b>：⌘K 搜任何条目/词/案例；调好的一组设定存成「配方」，下次一键还原。</li>' +
      '<li><b>要体检库</b>：库页「断言套件」跑全库回归，通过率掉了说明新写的东西破坏了规范。</li>' +
      '</ol>' +

      '<h2>六、v3 迭代：从竞品学来的 10 件事</h2>' +
      '<p>完整的 20 家竞品评分、能力矩阵与差异化机会点见「竞品」页。这里只列<b>学完之后动了手</b>的部分。</p>' +
      '<table><tr><th style="width:48px">编号</th><th style="width:190px">学谁</th><th style="width:150px">成熟能力</th><th>在本系统怎么用</th></tr>' +
      BENCH.BORROW.map(b =>
        '<tr><td class="mono">' + b.id + '</td><td class="muted">' + U.esc(b.from) + '</td>' +
        '<td><b>' + U.esc(b.cap) + '</b></td><td>' + U.esc(b.doing) + '</td></tr>').join('') +
      '</table>' +

      '<h2>七、工作区备份</h2>' +
      '<p>版本记录、出图记录、采集队列、配方、自定义 LoRA 都存在浏览器本地。<b>换电脑或清缓存前一定导一次</b>，一个 JSON 带走全部。</p>' +
      '<div class="pv-actions inline"><button class="btn primary" id="btn-backup">导出工作区备份</button>' +
      '<button class="btn" id="btn-restore">导入备份</button>' +
      '<button class="btn" id="btn-wipe">清空本地数据</button>' +
      '<input type="file" id="file-restore" accept=".json" style="display:none"></div>' +
      '<div class="hintline" id="backup-note"></div>' +

      BLUEPRINT_TAIL;

    bindBackup();
  }

  /* ---------------- v3 · 工作区备份与恢复 ---------------- */
  function workspace() {
    return {
      kind: 'promptforge-workspace', ver: 3, at: new Date().toISOString(),
      state, versions: mem.versions, outputs: mem.outputs, lora: mem.lora,
      ab: mem.ab, queue: mem.queue, customLora: mem.customLora, presets: mem.presets
    };
  }
  function bindBackup() {
    const n = $('#backup-note');
    const cnt = k => Object.keys(mem[k] || {}).length + (Array.isArray(mem[k]) ? 0 : 0);
    if (n) n.innerHTML = '当前本地：版本 <b>' + Object.keys(mem.versions).reduce((a, k) => a + mem.versions[k].length, 0) +
      '</b> 条 · 出图记录 <b>' + Object.keys(mem.outputs).reduce((a, k) => a + mem.outputs[k].length, 0) +
      '</b> 条 · 配方 <b>' + mem.presets.length + '</b> 个 · 采集队列 <b>' + mem.queue.length + '</b> 条';

    const bd = $('#btn-backup');
    if (bd) bd.onclick = () => {
      const w = workspace();
      download('promptforge-workspace-' + today() + '.json', JSON.stringify(w, null, 1), 'application/json');
      toast('备份已下载，换电脑时导入即可');
    };
    const rs = $('#btn-restore'), fi = $('#file-restore');
    if (rs) rs.onclick = () => fi.click();
    if (fi) fi.onchange = e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const w = JSON.parse(r.result);
          if (w.kind !== 'promptforge-workspace') throw new Error('文件格式不对');
          if (w.state && w.state.seg) state = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), w.state);
          ['versions', 'outputs', 'lora', 'ab', 'queue', 'customLora', 'presets'].forEach(k => {
            if (w[k] != null) mem[k] = w[k];
          });
          save(); persist(); route('compose');
          toast('已恢复 ' + (w.at || '').slice(0, 10) + ' 的备份');
        } catch (err) { toast('恢复失败：' + err.message); }
      };
      r.readAsText(f);
    };
    const wp = $('#btn-wipe');
    if (wp) wp.onclick = () => {
      if (!confirm('清空浏览器里存的全部本地数据（不影响库文件）？建议先导出备份。')) return;
      mem = { versions: {}, outputs: {}, lora: {}, ab: {}, queue: [], customLora: [], presets: [] };
      state = JSON.parse(JSON.stringify(DEFAULT));
      persist(); save(); route('compose'); toast('已清空本地数据');
    };
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    document.addEventListener('click', onChipClick);

    /* 命令面板 */
    document.addEventListener('keydown', e => {
      const pal = $('#palette');
      const open = pal && !pal.classList.contains('hide');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); open ? closePalette() : openPalette(); return;
      }
      if (!open) return;
      if (e.key === 'Escape') { closePalette(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, palRows.length - 1); palMark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); palMark(); }
      else if (e.key === 'Enter') {
        const r = palRows[palIdx]; if (r) { closePalette(); r.go(); }
      }
    });
    document.addEventListener('click', e => {
      if (e.target.closest('.pal-bg')) closePalette();
      if (e.target.closest('#kbd-hint')) openPalette();
    });
    document.addEventListener('input', e => {
      if (e.target.id === 'pal-q') { palIdx = 0; palRender(e.target.value); }
    });
    document.addEventListener('input', function (e) {
      const el = e.target.closest('[data-seg]');
      if (!el) return;
      const k = el.dataset.seg;
      if (!(k in state.seg)) return;
      state.seg[k] = el.value;
      manualText = null;
      save(); refreshMeta(); syncPreview();
    });
    renderShell(); renderTabs(); route('compose');
    document.querySelectorAll('#tabs button[data-tab]').forEach(b => {
      b.onclick = () => route(b.dataset.tab);
    });
  }
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
