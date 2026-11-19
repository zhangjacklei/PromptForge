/* =========================================================================
 * PromptForge · 竞品基准层 v3
 * 20 个同类产品（10 网页 + 10 开源）× 4 个分析维度 + 16 项能力矩阵
 * 评分口径见 RUBRIC，均为 2026-11 实测公开信息
 * ========================================================================= */
(function (global) {
  'use strict';

  const RUBRIC = [
    { k: 'fn', name: '功能广度', desc: '1=单一功能 3=覆盖生成到管理 5=全链路闭环' },
    { k: 'ar', name: '系统架构', desc: '1=单脚本 3=前后端分离 5=多服务+评测/追踪/CI' },
    { k: 'ux', name: '易用性', desc: '1=需读文档配环境 3=能上手 5=打开即用无需配置' },
    { k: 'fd', name: '字段类型与丰富度', desc: '1=一个大文本框 3=若干文本字段 5=文本+枚举+数值+布尔+嵌套结构' }
  ];

  /* ---------------- 10 个网页产品 ---------------- */
  const SITES = [
    {
      n: 'PromptHero', u: 'prompthero.com', k: '图片提示词画廊',
      fn: 4, ar: 3, ux: 5, fd: 4,
      f: '百万级 AI 图配原始提示词；按模型（MJ / SD / FLUX / Nano Banana）筛选；可在站内直接生成',
      a: 'Next.js + 图片 CDN + 搜索索引；生成走第三方模型 API，无自研推理',
      fields: 'prompt 全文 · 模型 · 画幅 · 生成参数（部分）· 作者 · 点赞',
      win: '图与词强绑定，反查最快；模型版本维度切得细',
      lose: '免费版只有浏览；提示词是一条裸文本，没有槽位结构，改一个变量要通读重写'
    },
    {
      n: 'Lexica', u: 'lexica.art', k: 'SD 图搜索引擎',
      fn: 3, ar: 3, ux: 5, fd: 4,
      f: '按关键词或上传参考图检索 SD 生成图，每条带完整提示词与 guidance / 尺寸 / seed',
      a: '向量 + 关键词混合检索，自建图库索引；生成端自研小模型',
      fields: 'prompt · negative · guidance · 尺寸 · seed · 模型版本 · 收藏夹',
      win: '检索粒度细，能按画幅与模型过滤；反查是它的看家本领',
      lose: '只服务 SD 生态，无 Z-Image / H3 这类新模型的写法适配；库里噪点多，无质量审计'
    },
    {
      n: 'Civitai', u: 'civitai.com', k: '模型库 + 作品社区',
      fn: 5, ar: 4, ux: 3, fd: 5,
      f: '20 万+ 模型/LoRA 托管，每张作品附完整提示词、负面词、采样器、步数、CFG、seed、VAE',
      a: '模型分发 + 图库 + 社区；对象存储 + 权限体系 + 站内货币',
      fields: 'prompt · negative · steps · CFG · sampler · scheduler · seed · size · model hash · LoRA 栈 · clip skip · VAE',
      win: '参数元数据最全，LoRA 栈可复现；是「照着跑一遍」的最佳来源',
      lose: '信息过载，找一条能用要翻很久；只管单条质量，不告诉你为什么崩'
    },
    {
      n: 'OpenArt', u: 'openart.ai', k: '提示词库 + 生成平台',
      fn: 4, ar: 4, ux: 4, fd: 3,
      f: '千万级提示词按题材分类（奇幻/赛博/建筑/时尚），站内可生成、可套模板、可训模型',
      a: 'SaaS 多租户；生成队列 + 模型仓库 + 模板市场',
      fields: 'prompt · 模型 · 风格标签 · 画幅 · 收藏集',
      win: '题材分类做得好，起手没思路时最省事；模板（Prompt Book）可复用',
      lose: '字段浅，没有结构化槽位与参数纪律；中文语境弱'
    },
    {
      n: 'PromptBase', u: 'promptbase.com', k: '提示词交易市场',
      fn: 3, ar: 3, ux: 3, fd: 3,
      f: '33 万+ 提示词按模型售卖，人工审核上架，卖家可自建店铺',
      a: '电商架构（商品/订单/结算）+ 审核后台',
      fields: 'prompt · 适用模型 · 示例图 · 价格 · 卖家 · 评价',
      win: '人工审核让单条质量有下限；按模型归档清晰',
      lose: '买断制不可迭代；没有版本、没有评测、没有跨模型改写'
    },
    {
      n: 'PromptLayer', u: 'promptlayer.com', k: '提示词 CMS',
      fn: 5, ar: 5, ux: 4, fd: 5,
      f: '可视化编辑+版本+发布标签（prod/staging）+回归评测+AI 评分+成本与延迟观测',
      a: 'Registry + Eval Harness + Observability 三件套；SDK / REST / CI-CD 全通',
      fields: '模板变量 · 版本 · commit message · 发布标签 · 数据集 · 断言 · 评分器 · token 成本 · 延迟',
      win: '工程化最完整：改一条提示词能跑回归、能灰度、能回滚',
      lose: '面向文本 LLM，不理解图像/视频模型的硬约束（CFG 锁定、帧数公式）；无图像维度'
    },
    {
      n: 'PromptHub', u: 'prompthub.us', k: 'Git 式提示词协作',
      fn: 4, ar: 4, ux: 4, fd: 3,
      f: 'SHA 版本、diff 对比、审批流、团队权限、API 取用',
      a: 'SaaS，团队空间 + 权限 + API 网关',
      fields: '模板变量 · 版本 SHA · diff · 审批状态 · 角色权限',
      win: '把提示词当代码管：每次改动有指纹、有评审',
      lose: '无生成侧能力；2026 年已进入维护状态'
    },
    {
      n: 'FlowGPT', u: 'flowgpt.com', k: '社区提示词市场',
      fn: 3, ar: 3, ux: 4, fd: 2,
      f: '千万用户社区，提示词免费分享 + 悬赏 + 创作榜',
      a: 'UGC 社区架构 + 积分体系',
      fields: 'prompt · 模型 · 标签 · 点赞 · 评论',
      win: '中文内容多，社区活跃，找灵感快',
      lose: '字段最浅，质量方差极大（实测约六成需大改）'
    },
    {
      n: 'AIPRM', u: 'aiprm.com', k: '浏览器注入式模板库',
      fn: 3, ar: 3, ux: 5, fd: 2,
      f: '6 万+ 模板，装插件后直接注入 ChatGPT 输入框，一键套用',
      a: 'Chrome 扩展 + 模板市场',
      fields: '模板 · 变量占位 · 分类 · 作者',
      win: '零切换成本，套用路径最短',
      lose: '平台绑定（只在 ChatGPT 页面生效），无版本无评测'
    },
    {
      n: 'PromptPerfect', u: 'promptperfect.jina.ai', k: '提示词自动优化',
      fn: 2, ar: 3, ux: 5, fd: 2,
      f: '一条指令把粗糙提示词按目标模型自动改写成规范版本，支持跨模型对比',
      a: '模型服务编排层，背后调用多家 LLM',
      fields: '原提示词 · 优化后 · 目标模型 · 改写理由',
      win: '「模型适配」这个思路和本系统同源，是最接近的竞品',
      lose: '只改措辞，不锁参数、不管分辨率与帧数、不沉淀库'
    }
  ];

  /* ---------------- 10 个开源项目 ---------------- */
  const REPOS = [
    {
      n: 'promptfoo', u: 'github.com/promptfoo/promptfoo', star: '24.1k', k: '评测与回归框架',
      fn: 5, ar: 5, ux: 3, fd: 5,
      f: 'YAML 声明测试用例与断言，一条命令跨模型跑回归，本地 Web UI 并排对比',
      a: 'Node/TS，CLI + Web Viewer + CI 集成；已被 OpenAI 收编仍保持 MIT',
      fields: 'prompts 列表 · providers · tests · assert（contains / llm-rubric / javascript）· 变量表 · 评分器',
      win: '「提示词即代码」的标杆：断言、回归、CI 三件套齐全',
      lose: '面向文本任务，不懂图像提示词的结构与模型硬约束'
    },
    {
      n: 'Langfuse', u: 'github.com/langfuse/langfuse', star: '32.9k', k: '提示词管理 + 可观测',
      fn: 5, ar: 5, ux: 3, fd: 4,
      f: '提示词版本、发布标签、prompt-as-code、追踪、成本统计、数据集评测',
      a: 'Next.js + Postgres + ClickHouse + Redis，可自托管（MIT）',
      fields: '版本 · 标签 · 变量 · trace · span · token 成本 · 数据集 · 评分',
      win: '管理 + 观测 + 评测一个不落，自托管友好',
      lose: '部署重（四套中间件），与图像工作流无交集'
    },
    {
      n: 'DSPy', u: 'github.com/stanfordnlp/dspy', star: '37.0k', k: '声明式提示词编译',
      fn: 4, ar: 5, ux: 2, fd: 4,
      f: '用 Signature 声明输入输出，模块（CoT / ReAct）组合，编译器自动优化提示词与示例',
      a: 'Python 库；签名-模块-优化器三层抽象',
      fields: 'signature · input/output 字段与描述 · 模块 · 示例集 · 指标函数',
      win: '「提示词可以被编译和优化」这一思想的源头，本系统「槽位是输入、模型是编译器」直接受它启发',
      lose: '纯代码，无界面；优化需标注集，个人创作者门槛过高'
    },
    {
      n: 'prompts.chat', u: 'github.com/f/awesome-chatgpt-prompts', star: '167k', k: '社区提示词库',
      fn: 4, ar: 3, ux: 5, fd: 2,
      f: '5000+ 精选提示词、17 语言、浏览/搜索/收藏/版本/自托管/MCP 接入',
      a: '从 CSV 演进为全栈应用；Postgres + 多语言内容',
      fields: 'prompt · 角色 · 分类 · 语言 · 版本',
      win: '星数第一，证明「可搜索可复用的提示词资产」是真需求',
      lose: '字段极浅，一条提示词就是一个字符串'
    },
    {
      n: 'InvokeAI', u: 'github.com/invoke-ai/InvokeAI', star: '26k', k: '画布式生成工作台',
      fn: 5, ar: 4, ux: 4, fd: 4,
      f: '统一画布做文生图/图生图/局部重绘/扩图；节点式工作流；素材库记录每张图全部参数',
      a: 'Python 后端 + React 前端 + 本地推理引擎（Apache-2.0）',
      fields: 'prompt · negative · 模型 · LoRA · steps · CFG · scheduler · seed · 尺寸 · 图层 · 蒙版',
      win: '素材库把「图-参数-提示词」三者绑成可检索资产，这一点比多数管理平台都强',
      lose: '安装重；提示词仍是一条自由文本，没有槽位与复用模板'
    },
    {
      n: 'ComfyUI Dynamic Prompts', u: 'github.com/adieyal/comfyui-dynamicprompts', star: '2.4k', k: '模板语法引擎',
      fn: 3, ar: 3, ux: 3, fd: 4,
      f: '{红|绿|蓝} 随机/组合/循环、__通配文件__、Jinja2 模板、Magic Prompt 自动扩写',
      a: 'ComfyUI 自定义节点包，Python；模板解析器独立于推理',
      fields: '变体语法 · 通配符路径 · 权重 · 变量 · 组合索引 · seed 绑定',
      win: '批量变体的工业级语法，一次模板跑全部组合',
      lose: '只有语法没有内容，词从哪来、写得对不对，它不管'
    },
    {
      n: 'ComfyUI PromptFlow', u: 'github.com/maartenharms/comfyui-promptflow', star: '1.1k', k: '11 字段结构化提示词',
      fn: 4, ar: 2, ux: 5, fd: 5,
      f: '简版 3 字段 / 扩展 11 字段（主体/角色/表情/服装/姿势/场景/风格/镜头/光线/画质/自定义），内置 22 预设，粘贴旧提示词自动归类，变体预览',
      a: '单节点包，Python + JS 前端扩展；状态存工作流 JSON',
      fields: '11 个语义字段 · 通配符 · 字段模式（固定/随机/递增）· 预设 · LoRA 触发词',
      win: '字段设计最贴近本系统的四段式，且 Auto-Sort 归类 200+ 关键词的做法很实用',
      lose: '字段固定不可扩展；无库、无评分、无模型差异化'
    },
    {
      n: 'ComfyUI Prompt Builder', u: 'github.com/AIMovieStudio/comfyui-promptbuilder', star: '420', k: '变量积木拼装',
      fn: 2, ar: 2, ux: 4, fd: 3,
      f: '把提示词拆成命名变量节点，用 {subject} 模板拼装，输入槽自动增减；可输出 JSON',
      a: '纯 Python + 少量 JS，零依赖',
      fields: '变量名 · 变量文本 · 模板串 · JSON 输出',
      win: '「积木可换」的思路干净，替换风格块不用重写全文',
      lose: '变量要手动连节点，做十条就烦；无内容库支撑'
    },
    {
      n: 'PromptHub（开源版）', u: 'github.com/wzk2025/PromptHub', star: '3.6k', k: '本地优先提示词工作台',
      fn: 4, ar: 4, ux: 5, fd: 3,
      f: '文件夹/标签、历史版本与回滚、{{变量}} 模板、多模型并行测试、全量备份、WebDAV 同步、7 语言、多视图',
      a: 'Electron/Tauri 桌面端，数据全本地，可选 WebDAV',
      fields: '模板变量 · 版本 · 标签 · 收藏 · 多模型结果 · 备份包',
      win: '本地优先 + 备份同步的分寸感最好，不逼你上云',
      lose: '通用 LLM 提示词，无图像模型语义'
    },
    {
      n: 'Open Prompts', u: 'github.com/open-prompts/open-prompts', star: '107', k: '团队提示词中台',
      fn: 3, ar: 4, ux: 3, fd: 3,
      f: '集中库、版本迭代、标签、分享/私有、JWT 认证、API Key、Python SDK、Docker/K8s 部署',
      a: 'React 18 + Redux 前端，Go 后端（gRPC + REST），PostgreSQL + Redis',
      fields: '提示词 · 版本 · 标签 · 可见性 · API Key',
      win: '前后端分离 + SDK，适合当团队内部中台',
      lose: '无评测、无生成、字段浅；K8s 部署对个人过重'
    }
  ];

  /* ---------------- 16 项能力矩阵：0 无 / 1 部分 / 2 完备 ---------------- */
  const CAPS = [
    { k: 'lib', n: '分类检索库' },
    { k: 'slot', n: '结构化槽位' },
    { k: 'tpl', n: '变量模板语法' },
    { k: 'adapt', n: '模型适配与硬约束' },
    { k: 'meta', n: '参数元数据' },
    { k: 'ver', n: '版本与 diff' },
    { k: 'eval', n: '评测断言回归' },
    { k: 'ab', n: 'A/B 实验矩阵' },
    { k: 'rev', n: '图像反推' },
    { k: 'cfy', n: 'ComfyUI 直出' },
    { k: 'audit', n: '库级质量审计' },
    { k: 'fail', n: '失败案例知识' },
    { k: 'sync', n: '同步与协作' },
    { k: 'offline', n: '零部署离线' },
    { k: 'api', n: '命令行 / API' },
    { k: 'zh', n: '中文原生' }
  ];

  const MATRIX = {
    'PromptHero':              [2,0,0,0,2,0,0,0,1,0,0,0,1,0,1,1],
    'Lexica':                  [2,0,0,0,2,0,0,0,2,0,0,0,1,0,1,1],
    'Civitai':                 [2,1,0,1,2,1,0,0,0,1,0,0,2,0,2,1],
    'OpenArt':                 [2,0,0,1,1,0,0,0,1,0,0,0,1,0,0,1],
    'PromptBase':              [1,0,0,1,1,0,0,0,0,0,1,0,0,0,0,0],
    'PromptLayer':             [1,0,2,1,2,2,2,2,0,0,0,0,2,0,2,0],
    'PromptHub':               [1,0,2,1,0,2,0,0,0,0,0,0,2,0,1,1],
    'FlowGPT':                 [2,0,1,1,0,0,0,0,0,0,0,0,2,0,0,2],
    'AIPRM':                   [2,0,1,1,0,0,0,0,0,0,0,0,1,0,0,1],
    'PromptPerfect':           [0,1,1,1,0,0,1,1,0,0,0,0,1,0,1,2],
    'promptfoo':               [1,1,2,1,2,2,2,2,0,0,0,0,0,1,2,0],
    'Langfuse':                [1,0,2,1,2,2,2,1,0,0,0,0,2,1,2,0],
    'DSPy':                    [0,1,2,1,0,0,2,1,0,0,0,0,0,1,2,0],
    'prompts.chat':            [2,0,1,0,0,2,0,0,0,0,0,0,2,1,2,2],
    'InvokeAI':                [2,1,0,1,2,1,0,0,2,2,0,0,1,2,1,1],
    'Dynamic Prompts':         [0,1,2,0,0,0,0,1,0,2,0,0,0,2,0,0],
    'PromptFlow(ComfyUI)':     [1,2,2,1,0,1,0,1,0,2,0,0,0,2,0,1],
    'Prompt Builder(ComfyUI)': [0,2,2,0,0,0,0,0,0,2,0,0,0,2,0,0],
    'PromptHub(开源)':         [2,0,2,1,1,2,1,1,0,0,0,0,2,2,1,1],
    'Open Prompts':            [2,0,1,0,0,2,0,0,0,0,0,0,2,1,2,2],
    // 本系统 v3（本轮升级后：补齐变量模板语法 + 评测断言回归）
    '本系统 v3':               [2,2,2,2,2,2,2,2,1,2,2,2,1,2,1,2]
  };

  /* ---------------- 差异化机会点 ---------------- */
  const GAPS = [
    {
      t: '模型编译器：一条意图 → 五种写法',
      d: '没有任何一个竞品把「同一个意图」同时编译成 Z-Image Turbo（中文结构化、负面无效）/ Base（可负向）/ Edit（指令式）/ H3（音视频、17n+5 帧）/ SDXL（英文关键词+权重）五种能直接跑的产物。PromptPerfect 最接近，但它只改措辞，不锁参数、不管分辨率与帧数。',
      why: '这是本系统唯一无法被复制的护城河：规则来自真实踩坑（CFG 必须 1.0、帧数 17n+5、32 倍数），不在任何公开文档里。'
    },
    {
      t: '库级审计：被所有竞品忽略的一层',
      d: '竞品只判断「这一条提示词好不好」，没人回答「我这 454 条里有多少不符合自己定的规范」。本系统的数据体检能在 3 秒内扫出 101 项偏差并给出可自动修的补丁。',
      why: '库越大，一致性比单条质量更值钱。这是从「收藏夹」升级为「资产」的分水岭。'
    },
    {
      t: '失败案例 → 体检联动',
      d: 'Civitai 有海量参数却不知道为什么崩；promptfoo 有断言但没有现象学。本系统把 38 条真实失败模式（现象/归因/改法/可检测特征）挂进体检，命中就直接在当前文本下方报出。',
      why: '排错知识比生成知识稀缺，且天然随使用增长。'
    },
    {
      t: '中文原生 + 云端表格双载体',
      d: '英文站不认 Z-Image / MiniMax H3；中文站（FlowGPT 等）标签颗粒度粗、字段极浅。本系统用中文自然语言写提示词，同时把同一份数据落在云端表格里，可被任何人打开、筛选、批注。',
      why: 'AI 创作者的真实工作流是「表格 + 聊天窗」，不是「又一个 SaaS 后台」。'
    },
    {
      t: '零部署单文件',
      d: '所有管理平台（PromptLayer / Langfuse / Open Prompts）都要账号或 Docker/K8s；PromptHub 要装桌面端。本系统是一个 910KB 的 HTML，双击即用、可离线、可邮件发人。',
      why: '对个人创作者，安装成本就是最大的流失点。'
    },
    {
      t: '编辑类工序独立成知识',
      d: '竞品把换脸、换景当滤镜按钮。本系统把 36 条编辑工序拆成四条路线（指令式编辑 / 锁结构 / 换脸 / 锁身份），并写明固定顺序：先换装换景 → 再换脸 → 最后修边，因为脸最敏感。',
      why: '顺序错了，再好的模型也救不回来。这类知识没有产品在做。'
    },
    {
      t: '参数纪律而非参数面板',
      d: 'Civitai 把 12 个参数全摊开让你填；本系统按模型给出不可动的硬约束（Turbo 的 CFG 只能是 1.0、H3 无 CFG、帧数只能 17n+5），填错直接拦。',
      why: '新手抄参数抄错一个就白跑，纪律比自由更有价值。'
    }
  ];

  /* ---------------- 取长补短：竞品能力 → 本轮落地 ---------------- */
  const BORROW = [
    { id: 'B1', from: 'PromptHub / FlowGPT', cap: '全局检索与快捷跳转', doing: '命令面板 ⌘K，一次搜到库条目、词库词、失败案例、功能页', lvl: 'P0' },
    { id: 'B2', from: 'PromptFlow（22 预设）/ OpenArt Prompt Book', cap: '命名配方可复用', doing: '配方库：整组设定存名、载入、导入导出 JSON', lvl: 'P0' },
    { id: 'B3', from: 'PromptHub（备份包 / WebDAV）', cap: '数据不丢', doing: '工作区全量备份与恢复（版本/出图/采集/配方/LoRA 一体）', lvl: 'P0' },
    { id: 'B4', from: 'Dynamic Prompts / Prompt Builder', cap: '模板语法导出', doing: '一键导出 4 种模板：{{变量}} / {a|b|c} 通配 / __文件__ / Jinja2', lvl: 'P0' },
    { id: 'B5', from: 'promptfoo（assert + CI）', cap: '断言与回归', doing: '15 条规范断言跑全库，出通过率表 + 失败钻取 + Markdown 报告', lvl: 'P0' },
    { id: 'B6', from: 'Lexica / PromptHero 反查', cap: '相似即得', doing: '当前提示词 → 库内 Top5 相似（bigram 相似度），可载入或并排比', lvl: 'P1' },
    { id: 'B7', from: 'PromptHero / Civitai 搜索', cap: '检索可直达', doing: '按缺口标签生成四站可点击搜索链接，省掉手打关键词', lvl: 'P1' },
    { id: 'B8', from: 'PromptLayer（token 成本）', cap: '长度预算', doing: '各模型推荐字数区间 + 超限预警，随输入实时算', lvl: 'P1' },
    { id: 'B9', from: 'Civitai / A1111', cap: '多格式落地', doing: '导出 A1111 参数串、Civitai 卡片、Markdown、CSV 四种格式', lvl: 'P1' },
    { id: 'B10', from: '全部 20 个', cap: '看清自己在哪', doing: '本页：20 竞品 × 4 维度评分 + 16 能力矩阵 + 差异化 7 条', lvl: 'P0' }
  ];

  global.PF_BENCH = { RUBRIC, SITES, REPOS, CAPS, MATRIX, GAPS, BORROW };
})(window);
