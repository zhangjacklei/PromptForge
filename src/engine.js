/* =========================================================================
 * PromptForge · 引擎层
 * 职责：模型适配规则 / 提示词组装 / 参数联动 / 体检 Lint / 完整度评分
 *       / 文本分解 / 相似度去重 / 采集解析
 * ========================================================================= */
(function (global) {
  'use strict';

  /* 库来源优先级：localStorage 里导入过的库（pf.lib）> 打包内置库（__LIB__）
   * 「全量备份」导入后会把整库落到 pf.lib，刷新即生效；清空本地数据则回落到内置示例库。 */
  const LIB = (function () {
    try {
      const raw = global.localStorage && global.localStorage.getItem('pf.lib');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && (o.image || o.video)) return o;
      }
    } catch (e) { }
    return global.__LIB__ || { image: [], video: [], params: [], edits: [], lexicon: [], guide: [] };
  })();

  /* ---------------- 模型适配表 ----------------
   * weights  是否支持 (xxx:1.2) 权重语法
   * negative 是否支持独立负面提示词
   * ar       是否支持 --ar 参数
   * lang     推荐语言
   * resKey   走哪张分辨率表
   */
  const MODELS = {
    'z-turbo': {
      id: 'z-turbo', name: 'Z-Image Turbo', kind: 'image', lang: 'zh', badge: '出图最快',
      desc: '8 步直出 · CFG 固定 1.0 · 负面词无效',
      weights: false, negative: false, ar: false, resKey: 'zimage', multiple: 16, maxMP: 4,
      params: { steps: 8, cfg: '1.0', sampler: 'res_multistep', scheduler: 'simple', denoise: '1.0' },
      note: '蒸馏模型，CFG 必须锁 1.0；提示词要中文结构化自然语言，别堆关键词。'
    },
    'z-base': {
      id: 'z-base', name: 'Z-Image Base', kind: 'image', lang: 'zh', badge: '文字最强',
      desc: '30 步 · CFG 4.0 · 支持负面词',
      weights: false, negative: true, ar: false, resKey: 'zimage', multiple: 16, maxMP: 4,
      params: { steps: 30, cfg: '4.0', sampler: 'euler', scheduler: 'simple', denoise: '1.0' },
      note: '未蒸馏版本，海报/信息图/UI/文字排版首选；速度约 Turbo 的 3–4 倍。'
    },
    'z-edit': {
      id: 'z-edit', name: 'Z-Image-Edit', kind: 'image', lang: 'zh', badge: '改图',
      desc: '指令式编辑 · CFG 7.5 · denoise 0.6–0.9',
      weights: false, negative: true, ar: false, resKey: 'zimage', multiple: 16, maxMP: 4,
      params: { steps: 28, cfg: '7.5', sampler: 'euler', scheduler: 'simple', denoise: '0.75' },
      note: '只写「要改成什么」，不要复述要保留的主体；蒙版边缘留 16–32px 羽化。'
    },
    'h3': {
      id: 'h3', name: 'MiniMax H3', kind: 'video', lang: 'zh', badge: '音视频一体',
      desc: '17n+5 帧 · 24fps · 无 CFG',
      weights: false, negative: false, ar: false, resKey: 'h3', multiple: 32, maxMP: 0,
      params: { steps: 4, cfg: '—', sampler: '—', scheduler: '—', denoise: '1.0' },
      note: '提示词结尾必须写「声音：」，否则输出静音；一条镜头只写一种运动。'
    },
    'sdxl': {
      id: 'sdxl', name: 'SDXL / Flux', kind: 'image', lang: 'en', badge: '生态最全',
      desc: '28 步 · CFG 6.0 · 支持权重与负面词',
      weights: true, negative: true, ar: true, resKey: 'sdxl', multiple: 8, maxMP: 0,
      params: { steps: 28, cfg: '6.0', sampler: 'dpmpp_2m', scheduler: 'karras', denoise: '1.0' },
      note: '英文关键词 + 权重语法；ControlNet / IP-Adapter / InstantID 生态只在它的底模上可用。'
    }
  };

  // 画幅 → 分辨率（各自满足倍数约束）
  const RES = {
    zimage: {
      '1:1': '1024×1024', '4:3': '1152×864', '3:4': '864×1152', '16:9': '1280×720',
      '9:16': '720×1280', '2:3': '832×1248', '3:2': '1248×832', '21:9': '1536×656'
    },
    h3: {
      '16:9': '1216×672', '9:16': '672×1216', '1:1': '768×768',
      '4:3': '1024×768', '3:4': '768×1024', '21:9': '1344×576'
    },
    sdxl: {
      '1:1': '1024×1024', '4:3': '1152×896', '3:4': '896×1152', '16:9': '1344×768',
      '9:16': '768×1344', '2:3': '832×1216', '3:2': '1216×832', '21:9': '1536×640'
    }
  };

  const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'];

  /* ---------------- 段落定义 ---------------- */
  const SEGMENTS = [
    { k: 'subject', label: '主体', slot: '主体', hit: '描述「这是什么 + 什么状态」' },
    { k: 'feature', label: '人物特征', slot: '人物特征', hit: '五官 / 肤质 / 发型 / 气质' },
    { k: 'outfit', label: '服饰造型', slot: '服饰造型', hit: '款式 + 颜色 + 材质 + 配饰' },
    { k: 'action', label: '动作行为', para: '动作', hit: '姿态 / 手部 / 表情' },
    { k: 'scene', label: '场景环境', slot: '场景环境', hit: '地面 / 中景 / 远景 / 光线' },
    { k: 'camera', label: '镜头', para: '镜头', hit: '焦段 / 景别 / 机位' },
    { k: 'light', label: '光影', para: '光影', hit: '光源 / 方向 / 软硬' },
    { k: 'style', label: '风格', para: '风格', hit: '画风 / 流派 / 参考' },
    { k: 'quality', label: '画质', para: '画质', hit: '清晰度 / 质感 / 颗粒' },
    { k: 'sound', label: '声音', para: '声音', video: true, hit: '环境音 + 动作音 + 配乐' }
  ];

  // 段落顺序（按模型）
  const ORDER = {
    'z-turbo': ['subject', 'feature', 'outfit', 'action', 'scene', 'camera', 'light', 'style', 'quality'],
    'z-base': ['subject', 'feature', 'outfit', 'action', 'scene', 'camera', 'light', 'style', 'quality'],
    'z-edit': ['outfit', 'scene', 'feature', 'light', 'style'],
    'h3': ['subject', 'feature', 'outfit', 'action', 'scene', 'camera', 'light', 'style', 'sound'],
    'sdxl': ['subject', 'feature', 'outfit', 'action', 'scene', 'camera', 'light', 'style', 'quality']
  };

  // 槽位 → 词库维度
  const SLOT_DIMS = {
    '主体': ['人像身份职业', '年龄气质', '静物品类', '建筑场景', '动物奇幻', '互动道具'],
    '人物特征': ['脸型轮廓', '眼睛眼型', '眼神神态', '眉毛', '鼻唇', '肤色', '肤质肌理', '发型', '发色', '妆容', '气质', '身材体态', '面部标识', '笑容类型'],
    '服饰造型': ['风格流派', '服装品类', '面料材质', '配色', '配饰首饰', '剪裁细节', '动态质感', '鞋履搭配', '领口廓形'],
    '场景环境': ['地点场所', '时间', '天气', '光线', '色调氛围', '镜头构图', '背景元素', '四层结构', '画面质感', '色彩分级', '季节氛围']
  };

  // 修饰段落 ← 词库维度
  const MOD_DIMS = {
    action: ['姿势动作', '手部动作', '笑容类型'],
    camera: ['镜头构图'],
    light: ['光线'],
    style: ['风格流派', '色调氛围'],
    quality: ['画面质感', '色彩分级']
  };

  const SOUND_CHIPS = [
    '环境音', '雨声', '风声', '海浪声', '虫鸣', '鸟叫', '远处车流', '咖啡馆人声',
    '脚步声', '布料摩擦声', '呼吸声', '页面翻动', '钢琴轻音乐', '弦乐渐强', '低频氛围垫', '城市白噪音'
  ];

  /* ---------------- 泛词升级表（实测避坑） ---------------- */
  const UPGRADE = {
    '美女': '东方女性', '好看': '五官舒展协调', '漂亮': '清丽耐看', '帅': '轮廓利落',
    '高清': '8K 高清', '唯美': '柔焦浅景深', '精致': '细节精致', '真实': '原生真实肌理',
    '古风': '宋式美学古风', '好看的人': '气质出众的人物', '氛围感': '环境光包裹的氛围',
    '画质好': '画面清晰锐利', '高级': '低饱和高级灰'
  };

  // 真正需要升级的空泛词（用于评分扣分与体检提示）
  const VAGUE_KEYS = ['美女', '好看', '漂亮', '高清', '唯美', '古风'];

  /* ---------------- 负面词 → 正面表述（P1-4：12 条 → 130+ 条） ----------------
   * 用法：Turbo / H3 不支持负向，必须把「不要 X」改写为「正面达到什么状态」。
   * key 约定为完整负向短语（含 不要 / 避免 / 无 / no / without），避免裸词误伤。
   */
  const NEG_MAP = {
    // —— 画质与成像 ——
    '不要模糊': '画面清晰锐利', '不要低清': '细节清晰完整', '不要噪点': '画面干净细腻',
    '不要压缩痕迹': '画质纯净无损', '不要过曝': '高光层次完整', '避免过曝': '高光层次完整',
    '不要欠曝': '暗部细节可辨', '避免死黑': '暗部层次丰富', '不要曝光不均': '光线过渡均匀',
    '不要灰蒙蒙': '层次通透分离度高', '不要低对比': '明暗对比有力', '不要JPEG伪影': '无压缩伪影的纯净画面',
    '不要马赛克': '色块过渡平滑', '不要像素化': '边缘平滑细腻', '不要水印': '画面干净无杂物',
    '不要文字': '纯画面无文字', '不要logo': '画面纯净无标识', '不要边框': '满版构图无边框',
    '不要签名': '画面完整无署名', '不要日期戳': '原始画面无叠加信息', '不要失焦': '焦点准确落在主体',
    '不要虚焦': '主体锐利清晰', '不要抖动': '画面稳定', '不要拖影': '运动轨迹干净',
    '不要锐化过度': '锐度自然', '不要过度锐化': '锐度自然', '不要磨皮': '保留原生皮肤纹理',
    '不要过度磨皮': '保留原生皮肤纹理', '不要塑料感': '原生真实肌理', '不要蜡像感': '皮肤有真实质感与微血管',
    '不要油腻': '肤质清爽自然', '不要脏': '画面干净整洁', '不要杂乱': '画面元素有序',
    '不要暗角': '四角亮度自然', '不要紫边': '边缘无色散', '不要摩尔纹': '纹理还原准确',
    '不要鬼影': '无重影', '不要光斑': '光斑自然', '不要色偏': '白平衡准确',
    '不要惨白': '肤色健康', '不要黄脸': '肤色通透', '不要灰脸': '肤色有血色',
    '不要油光': '皮肤哑光', '不要硬阴影': '阴影柔和过渡', '不要平光': '立体光比',
    '不要大白墙': '背景有细节', '不要空背景': '背景层次丰富', '不要糊背景': '背景适度虚化且可辨',

    // —— 人体与五官 ——
    '不要畸形': '五官与肢体结构准确', '不要变形': '五官与肢体结构准确', '不要肢体扭曲': '人体比例自然',
    '不要多余手指': '手部五指结构准确', '不要多手指': '手部五指结构准确', '不要少手指': '手部五指结构完整',
    '不要六指': '手部五指结构准确', '不要断肢': '肢体完整连贯', '不要融化的手': '手部结构清晰',
    '不要多余手臂': '手臂数量与姿态正确', '不要比例失调': '头身比例协调', '不要歪脸': '面部对称端正',
    '不要不对称': '左右结构对称', '不要大小眼': '双眼对称', '不要假脸': '皮肤质感真实',
    '不要僵硬': '姿态放松自然', '不要木讷': '神态生动', '不要空洞眼神': '眼神有焦点有情绪',
    '不要死鱼眼': '眼神明亮有光', '不要歪嘴': '唇形自然', '不要龅牙': '牙齿整齐',
    '不要崩牙': '牙齿结构完整', '不要双下巴': '下颌线清晰', '不要粗脖子': '颈部线条修长',
    '不要粗腿': '腿部线条匀称', '不要大脸': '脸型精致小巧', '不要浮肿': '面部紧致',
    '不要油脸': '妆面哑光清爽', '不要脱妆': '妆面完整干净', '不要红眼': '瞳孔自然有反光',
    '不要反关节': '关节方向正确', '不要驼背': '肩背舒展挺拔', '不要蛇精脸': '脸型自然',
    '不要过度瘦脸': '脸型自然', '不要过度美颜': '保留真实皮肤细节', '不要畸变': '透视自然',

    // —— AI 痕迹与审美 ——
    '不要AI感': '真实摄影质感', '不要诡异微笑': '笑容自然', '不要重复人脸': '人物各不相同',
    '不要人群重复': '人群形态各异', '不要背景穿帮': '背景结构合理', '不要多余装饰': '画面元素克制',
    '不要廉价感': '质感考究', '不要土味': '审美现代', '不要山寨感': '品质统一',
    '不要渲染感': '照片级真实', '不要3D渲染感': '实拍质感', '不要CG感': '实拍质感',
    '不要合成感': '光影逻辑统一', '不要过度饱和': '色彩克制自然', '不要滤镜感': '色彩还原真实',
    '不要穿帮': '细节逻辑正确', '不要错位': '结构对齐正确', '不要透视错误': '透视关系正确',
    '不要影子缺失': '接触阴影完整', '不要光源矛盾': '光源方向统一', '不要把猫画成狗': '物种特征准确',

    // —— 视频专属 ——
    '不要闪烁': '画面稳定连续', '不要跳帧': '运动流畅连贯', '不要角色漂移': '人物身份全程一致',
    '不要背景闪烁': '背景稳定', '不要字幕': '画面无字幕', '不要时间戳': '画面无叠加信息',
    '不要黑边': '满画幅', '不要卡顿': '运动顺滑', '不要静音': '有完整环境声',
    '不要音画不同步': '音画严格同步', '不要破音': '音质干净', '不要摇晃镜头': '机位平稳',
    '不要突然变焦': '焦段保持稳定', '不要快速剪辑': '单镜头长拍',

    // —— 英文负向（SDXL / Flux / MJ） ——
    'no blurry': 'sharp focus', 'no lowres': 'high resolution detail', 'no watermark': 'clean frame',
    'no text': 'textless image', 'no bad anatomy': 'correct anatomy', 'no extra fingers': 'five fingers per hand',
    'no deformed': 'well-formed features', 'no mutated': 'natural proportions', 'no disfigured': 'natural proportions',
    'no poorly drawn face': 'well-rendered face', 'no oversaturated': 'natural color grading',
    'no overexposed': 'balanced highlights', 'no underexposed': 'visible shadow detail',
    'no jpeg artifacts': 'clean image data', 'no signature': 'unsigned image', 'no logo': 'unbranded image',
    'no border': 'full-bleed composition', 'no plastic skin': 'realistic skin texture',
    'no doll-like': 'photographic realism', 'no extra limbs': 'correct limb count',
    'without watermark': 'clean frame', 'without text': 'textless image', 'without blur': 'sharp focus'
  };

  // SDXL / Flux 默认负面词（可直接填进负面框）
  const NEG_EN = [
    'lowres', 'blurry', 'jpeg artifacts', 'bad anatomy', 'extra fingers', 'extra limbs',
    'mutated hands', 'poorly drawn face', 'deformed', 'disfigured', 'watermark', 'text',
    'signature', 'logo', 'border', 'oversaturated', 'overexposed', 'underexposed',
    'plastic skin', 'doll-like', 'waxy', 'ai look', 'cross-eye', 'bad teeth',
    'long neck', 'floating limbs', 'disconnected limbs', 'duplicate', 'cropped', 'out of frame'
  ];

  // 反向：正面表述 → 应该防的负向（一对多时取首个）
  const POS2NEG = (() => {
    const m = {};
    Object.keys(NEG_MAP).forEach(k => {
      const v = NEG_MAP[k];
      if (!m[v]) m[v] = k;
    });
    return m;
  })();

  /* ---------------- P0-1 槽位命名归一 ----------------
   * 生视频表残留【主体人物】【场景】【人物】等 30+ 种写法，
   * 解析前先归一，避免自动化拆槽错位。
   */
  const SLOT_ALIAS = {
    '主体': '主体', '产品主体': '主体', '主体人物': '主体', '人物': '主体', '角色': '主体',
    '角色描述': '主体', '主角': '主体', '产品': '主体', '饮品': '主体', '食物': '主体',
    '产品细节': '主体', '产品套装': '主体', '动物': '主体', '新主体与动作': '主体',
    '人物特征': '人物特征', '外形': '人物特征', '长相': '人物特征', '面部': '人物特征',
    '服饰造型': '服饰造型', '服装': '服饰造型', '穿着': '服饰造型', '服装风格': '服饰造型',
    '场景环境': '场景环境', '场景': '场景环境', '背景': '场景环境', '环境': '场景环境',
    '地貌': '场景环境', '场景 A': '场景环境', '场景 B': '场景环境', '表面': '场景环境',
    '材质': '场景环境'
  };

  // 视频专属的非槽位标签（声音/台词/运镜/时长属于段落，不做实体槽位）
  const NON_SLOT_TAGS = ['颜色', '台词', '台词一', '台词二', '声音', '环境音', '环境声音',
    '移动', '动作', '竖屏', '时长', '语言', '音乐风格', '一句台词', '场景环境音'];

  /* ---------------- P3-1 标签三层收敛 ----------------
   * 143 个生图标签 + 105 个视频标签是平的 → 收敛成 题材 / 用途 / 风格 三层。
   * 走关键词规则，命中不了落到「其他」并在数据体检里暴露。
   */
  const TAG_L1 = [
    ['视频叙事', /广告|纪录片|短片|对白|运镜|首尾帧|图生视频|参考生视频|原生音效|短剧|VFX|品牌/],
    ['动物', /动物|萌宠|宠物|海洋生物/],
    ['平面设计', /海报|信息图|UI|文字|排版|封面|绘本|立绘|设定|包装|商务设计|抽象设计|电商|证件照|壁纸|极简/],
    ['静物产品', /产品|静物|器物|美食|饮品|商品/],
    ['场景空间', /风光|风景|城市|建筑|室内|空间|自然|海洋|山|雪|微缩|市井|书房|水乡|壁纸/],
    ['概念幻想', /奇幻|科幻|概念|梦核|蒸汽朋克|废土|哥特|童话|太空|异世界|赛博/],
    ['插画漫画', /插画|动漫|漫画|二次元|水彩|油画|素描|壁画|印象派|绘本|吉卜力|赛璐璐|写意|水墨|黑白艺术|异色瞳/],
    ['人像', /人像|人物|自拍|特写|写真|街拍|抓拍|肖像|cos|cosplay|闺秀|侠女|贵妃|时尚大片|青春|编辑|居家|古风|国风|情绪|甜美|职场|日常|宫廷|高调|俏皮|丝绒|超写实|北欧|旗袍|裙|少女/]
  ];
  const TAG_L2 = [
    ['商业广告', /广告|电商|品牌|商业|营销|包装|产品/],
    ['平面物料', /海报|封面|信息图|UI|排版|文字|壁纸|证件照|立绘|设定|极简/],
    ['纪实记录', /纪实|纪录片|生活|日常|市井|街拍|抓拍|快照|编辑/],
    ['摄影写真', /写真|自拍|特写|人像|肖像|摄影|大片|居家|书房|水乡/],
    ['插画创作', /插画|动漫|漫画|绘本|水彩|油画|素描|壁画|印象派|吉卜力|赛璐璐|黑白艺术|异色瞳/],
    ['概念设定', /概念|设定|奇幻|科幻|梦核|蒸汽朋克|废土|哥特|童话|仙侠|微缩/],
    ['短视频', /短视频|短片|运动|运镜|vlog/]
  ];
  // L1 → 默认 L2（避免二级落空）
  const L1_L2 = {
    '人像': '摄影写真', '静物产品': '商业广告', '场景空间': '摄影写真', '平面设计': '平面物料',
    '动物': '摄影写真', '概念幻想': '概念设定', '插画漫画': '插画创作', '视频叙事': '短视频'
  };
  const TAG_L3 = [
    ['东方美学', /国风|古风|水墨|敦煌|江南|宫廷|仙侠|武侠|旗袍|壁画|非遗|文化|写意|宋式/],
    ['未来亚文化', /赛博|霓虹|科幻|太空|蒸汽朋克|废土|哥特|机甲|异色瞳/],
    ['日系清新', /日系|清透|温柔|甜美|青春|清新|居家|田园|北欧/],
    ['胶片复古', /胶片|复古|水乡|纪实|老照片|印象派/],
    ['电影光效', /电影感|光影|高调|丝绒|冷艳|氛围|情绪|夜景/],
    ['绘画艺术', /水彩|油画|素描|黑白|艺术|抽象|壁画|漫画|国风写意/],
    ['二次元', /二次元|动漫|漫画|赛璐璐|吉卜力|洛丽塔|立绘|战斗/],
    ['超写实', /超写实|写实|半写实|真实/]
  ];

  /* ---------------- 工具 ---------------- */
  const U = {
    uniq: a => Array.from(new Set(a)),
    clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    clean: s => String(s || '').replace(/\s+/g, ' ').trim(),
    // 中文按字、英文按词切分做 bigram
    bigrams(s) {
      const t = String(s || '').toLowerCase().replace(/[，。；、,.!?！？：:\s【】\[\]]/g, '');
      const out = new Set();
      for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
      return out;
    },
    similarity(a, b) {
      const A = U.bigrams(a), B = U.bigrams(b);
      if (!A.size || !B.size) return 0;
      let inter = 0;
      A.forEach(x => { if (B.has(x)) inter++; });
      return inter / (A.size + B.size - inter);
    }
  };

  /* ---------------- 参数联动 ---------------- */
  function h3Frames(sec) {
    // 帧数必须 17n+5，上限 362
    const target = Math.round(sec * 24);
    let best = 124, bd = Infinity;
    for (let n = 0; n <= 21; n++) {
      const f = 17 * n + 5;
      if (f > 362) break;
      const d = Math.abs(f - target);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function resolve(modelId, state) {
    const m = MODELS[modelId];
    const table = RES[m.resKey] || {};
    // 该模型不支持当前画幅时回退到第一个可用值，避免参数空白
    const res = table[state.aspect] || table[Object.keys(table)[0]] || '';
    const out = {
      model: m.name,
      res,
      steps: m.params.steps,
      cfg: m.params.cfg,
      sampler: m.params.sampler,
      scheduler: m.params.scheduler,
      denoise: m.params.denoise,
      aspect: state.aspect
    };
    if (m.kind === 'video') {
      const sec = Number(state.duration) || 5;
      const f = h3Frames(sec);
      out.duration = sec + 's';
      out.frames = f;
      out.realDuration = (f / 24).toFixed(2) + 's';
      out.fps = 24;
    }
    out.multiple = m.multiple;
    return out;
  }

  /* ---------------- 组装 ---------------- */
  function build(state) {
    const m = MODELS[state.model];
    const order = ORDER[state.model] || ORDER['z-turbo'];
    const filled = {};
    SEGMENTS.forEach(s => { filled[s.k] = U.clean(state.seg[s.k]); });

    const mk = (key, useSlot) => {
      const seg = SEGMENTS.find(s => s.k === key);
      const v = filled[key];
      if (seg.slot) return useSlot ? (v ? `【${seg.slot}】${v}` : '') : (v || `【${seg.slot}】`);
      return v ? `${seg.para}：${v}` : '';
    };

    // ---- 视频 / 中文结构化 ----
    if (state.model === 'h3' || state.model === 'z-turbo' || state.model === 'z-base') {
      const head = [];
      ['subject', 'feature', 'outfit', 'action', 'scene'].forEach(k => {
        const v = filled[k];
        if (v) head.push(v);
      });
      let s = head.join('，');
      const tail = [];
      ['camera', 'light', 'style', 'quality', 'sound'].forEach(k => {
        if (order.indexOf(k) < 0) return;
        const seg = SEGMENTS.find(s => s.k === k);
        if (!filled[k]) return;
        // 值本身已经以段落名开头（如「镜头缓慢推进」）时不再加「镜头：」前缀，避免重复
        let v = filled[k];
        if (v.indexOf(seg.para) === 0 && v.length > seg.para.length + 2) {
          v = v.slice(seg.para.length).replace(/^[\s：:]+/, '');
        }
        tail.push(`${seg.para}：${v}`);
      });
      if (tail.length) s = (s ? s.replace(/[。.]$/, '') + '。' : '') + tail.join('。') + '。';
      else if (s && !/[。！？]$/.test(s)) s += '。';
      return { text: s, mode: 'zh' };
    }

    // ---- 编辑指令 ----
    if (state.model === 'z-edit') {
      const parts = [];
      if (filled.outfit) parts.push(`服装整体改为：${filled.outfit}`);
      if (filled.feature) parts.push(`人物呈现：${filled.feature}`);
      if (filled.scene) parts.push(`背景改为：${filled.scene}`);
      if (filled.light) parts.push(`光影改为：${filled.light}`);
      if (filled.style) parts.push(`整体风格转为：${filled.style}`);
      let s = parts.join('；');
      if (s) s += '。';
      return { text: s, mode: 'edit' };
    }

    // ---- SDXL / Flux 英文关键词 ----
    const arr = [];
    order.forEach(k => { if (filled[k]) arr.push(filled[k]); });
    const txt = arr.join(', ').replace(/，/g, ', ').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();
    return { text: txt, mode: 'en' };
  }

  // 模板版（槽位保留占位符，用于沉淀成库条目）
  function buildTemplate(state) {
    const m = MODELS[state.model];
    if (state.model === 'z-edit') return build(state).text;
    const order = ORDER[state.model] || ORDER['z-turbo'];
    const arts = [];
    ['subject', 'feature', 'outfit', 'action', 'scene'].forEach(k => {
      if (order.indexOf(k) < 0) return;
      const seg = SEGMENTS.find(s => s.k === k);
      if (seg.slot) arts.push(`【${seg.slot}】`);
      else if (U.clean(state.seg[k])) arts.push(U.clean(state.seg[k]));
    });
    let s = arts.join('，');
    const tail = [];
    ['camera', 'light', 'style', 'quality', 'sound'].forEach(k => {
      if (order.indexOf(k) < 0) return;
      const seg = SEGMENTS.find(s => s.k === k);
      if (U.clean(state.seg[k])) tail.push(`${seg.para}：${U.clean(state.seg[k])}`);
    });
    if (tail.length) s += '。' + tail.join('。') + '。';
    return s;
  }

  /* ---------------- 体检 ---------------- */
  function lint(state, text, opt) {
    const m = MODELS[state.model];
    const raw = text || build(state).text;
    const isTpl = !!(opt && opt.tpl);
    const out = [];
    const add = (lv, msg, hint, fix) => out.push({ lv, msg, hint, fix });

    if (!U.clean(raw)) { add('info', '还没有填写内容', '从左侧槽位开始，或点「随机灵感」'); return out; }
    if (raw.length < 30) add('warn', '提示词过短（' + raw.length + ' 字）', '至少写清 主体 + 场景 + 光线，否则模型会自由发挥');

    // 通用格式
    if (/[（(][^）)]*:\s*\d*\.?\d+\s*[）)]/.test(raw) && !m.weights)
      add('err', '含权重括号语法 (xxx:1.2)', m.name + ' 不支持权重语法，权重会被当成普通文字', 'stripWeight');
    if (/--(ar|v|stylize|quality|style|chaos|seed)\b/i.test(raw) && !m.ar)
      add('err', '含 --ar 等 Midjourney 参数', '画幅请用分辨率控制，参数写进提示词会被当成文字', 'stripAr');
    // 残留占位符（模板版本来就是占位符，跳过）
    const left = (raw.match(/【[^】]{1,8}】/g) || []);
    if (left.length && !isTpl) add('err', '残留 ' + left.length + ' 个未替换占位符：' + U.uniq(left).join(' '), '这些会被模型当成文字画出来', null);

    // 负面词
    const negHits = (raw.match(/不要|禁止|避免|不能|没有|无文字|无logo|no\s+\w+|without/gi) || []);
    if (negHits.length) {
      if (!m.negative) add('err', '出现 ' + negHits.length + ' 处否定表述：' + U.uniq(negHits).slice(0, 4).join('、'), m.name + ' 负面提示词无效，否定词会被忽略甚至反向强化', 'positive');
      else add('warn', '出现 ' + negHits.length + ' 处否定表述', '建议移到独立负面提示词框，正文只写正面描述', 'positive');
    }

    // 泛词
    const vague = VAGUE_KEYS.filter(w => raw.indexOf(w) >= 0);
    if (vague.length) add('info', '可升级的泛词：' + vague.join('、'), '换成更具体的描述，出图稳定性明显提升', 'upgrade');

    // 长度上限
    if (raw.length > 500 && m.id === 'z-turbo') add('warn', '提示词 ' + raw.length + ' 字，偏长', 'Turbo 8 步对长提示词的注意力分配有限，建议压到 300 字内');

    // 模型专属
    if (m.id === 'z-turbo') {
      if (/文字|字幕|logo|海报|标题|排版|UI/i.test(raw)) add('warn', '含文字/排版类描述', 'Turbo 8 步渲染文字容易糊，建议切 Z-Image Base（30 步 / CFG 4.0）');
      const res = resolve('z-turbo', state).res;
      if (res) {
        const [w, h] = res.split('×').map(Number);
        if (w * h / 1e6 > 4.05) add('err', '分辨率 ' + res + ' 超过 4MP 上限', 'Turbo 原生上限约 4MP（2048²）');
        if (w % 16 || h % 16) add('err', '分辨率不是 16 的倍数', '宽高必须取 16 的倍数，否则会崩边');
      }
      if (state.seg.feature && state.seg.feature.length < 12) add('info', '人物特征描述偏薄', '至少写 脸型 + 眼型 + 肤质 + 发型 四要素，否则五官每次都不同');
    }

    if (m.id === 'h3') {
      if (!U.clean(state.seg.sound) && !/声音[：:]/.test(raw))
        add('err', '没有声音描述', 'H3 提示词结尾不写「声音：」，输出是静音的', 'addSound');
      if (/声音[：:]/.test(raw) && raw.lastIndexOf('声音：') < raw.length - 90)
        add('warn', '声音段不在结尾', '把「声音：」放到最后一句，模型对尾部权重更高');
      const cams = ['推近', '拉远', '摇镜', '横移', '跟拍', '环绕', '升', '降', '变焦', '手持'];
      const hit = cams.filter(c => raw.indexOf(c) >= 0);
      if (hit.length > 1) add('warn', '一条提示词出现 ' + hit.length + ' 种运动：' + hit.join('、'), '一条镜头只写一种运动，多种运动会互相打架');
      if (!/定格|结尾|最终|停在|收束|渐隐/.test(raw)) add('warn', '没有写结束状态', '不写结束状态，结尾画面会飘；补一句「结尾定格在…」');
      const d = Number(state.duration) || 5;
      if (d > 15) add('err', '时长 ' + d + 's 超过 H3 上限', 'H3 单次最长 15s（362 帧）');
      if (d < 4) add('warn', '时长 ' + d + 's 偏短', 'H3 建议 4–15s');
      const res = resolve('h3', state).res;
      if (res) {
        const [w, h] = res.split('×').map(Number);
        if (w % 32 || h % 32) add('err', '分辨率不是 32 的倍数', 'H3 宽高必须取 32 的倍数');
      }
    }

    if (m.id === 'z-edit') {
      if (/保留|不要改变|保持不变|维持原样/.test(raw))
        add('warn', '含「保留 / 不要改变」类句式', '编辑模型会自动保留非编辑区，这类句子反而干扰指令理解，建议删掉');
      if (!/改为|换成|转为|改成/.test(raw))
        add('info', '缺少明确的「改为」指令', '编辑指令要写成「X 改为 Y」的目标状态描述');
      if (state.denoise && Number(state.denoise) > 0.9)
        add('warn', 'denoise ' + state.denoise + ' 偏高', '高于 0.9 会连人脸一起重绘；换脸务必放在换装换景之后单独做');
    }

    if (m.id === 'sdxl') {
      if (/[\u4e00-\u9fa5]/.test(raw)) add('warn', '检测到中文', 'SDXL / Flux 对英文关键词响应更准，建议切英文或中英混排');
      if (!U.clean(state.negative)) add('info', '负面提示词为空', 'SDXL 建议填基础负面：lowres, bad anatomy, extra fingers, watermark');
    }

    // 场景四层
    if (state.seg.scene && !/地面|地板|地砖|水面|沙地|草地|地毯/.test(state.seg.scene))
      add('info', '场景缺「地面」层', '换背景类必写满 地面 + 中景 + 远景 + 光线 四层，只写「户外」必糊');

    // 矛盾
    if (/(白天|正午|阳光明媚)/.test(raw) && /(霓虹|深夜|午夜)/.test(raw))
      add('warn', '时间描述可能矛盾（白天 + 霓虹/深夜）', '确认是黄昏蓝调时刻还是夜景，二者光比差很大');

    if (!out.some(x => x.lv === 'err' || x.lv === 'warn')) add('ok', '没有发现硬伤', '可以出图了，建议固定 seed 做横向对比');
    return out;
  }

  /* ---------------- 完整度评分 ---------------- */
  function score(state, text) {
    const raw = text || build(state).text;
    const slots = ['subject', 'feature', 'outfit', 'scene'];
    const filledSlots = slots.filter(k => U.clean(state.seg[k]));
    const a = filledSlots.length * 10;                       // 0–40
    const b = U.clamp(Math.round(raw.length / 10), 0, 25);    // 0–25 细节量（250 字满分）
    const mods = ['action', 'camera', 'light', 'style', 'quality'];
    const c = Math.round(mods.filter(k => U.clean(state.seg[k])).length / mods.length * 20);
    const vagueHits = VAGUE_KEYS.filter(w => raw.indexOf(w) >= 0).length;
    const d = raw.trim() ? U.clamp(15 - vagueHits * 3, 0, 15) : 0;
    return {
      total: U.clamp(a + b + c + d, 0, 100),
      parts: [
        { label: '槽位覆盖 4/4', v: a, max: 40 },
        { label: '细节密度 ' + raw.length + ' 字', v: b, max: 25 },
        { label: '段落完整 ' + mods.filter(k => U.clean(state.seg[k])).length + '/5', v: c, max: 20 },
        { label: '用词具体度', v: d, max: 15 }
      ]
    };
  }

  /* ---------------- 文本分解（库条目 → 槽位） ---------------- */
  function classifyClause(c) {
    // 先跑英文规则（英文提示词常以逗号分隔，靠关键词判断语义段）
    if (/\d+\s?mm\b|close-?up|wide[- ]angle|full[- ]body|depth of field|\bbokeh\b|low angle|high angle|aerial|top[- ]down|medium shot/i.test(c)) return 'camera';
    if (/\bwearing\b|\bdressed in\b|\boutfit\b/i.test(c)) return 'outfit';
    if (/\blight(ing)?\b|\blit\b|golden hour|\bsunset\b|\bneon\b|\brim\b|backlit|\bsoftbox\b|volumetric|window light/i.test(c)) return 'light';
    if (/\b8k\b|\b4k\b|highly detailed|ultra[- ]detailed|\bhdr\b|sharp focus|film grain|\braw\b/i.test(c)) return 'quality';
    if (/\bcinematic\b|photorealistic|\banime\b|oil painting|3d render|\bstyle\b|illustration/i.test(c)) return 'style';

    // 中文规则
    if (/^(镜头|视角|构图)[：:]/.test(c) || /\d+mm|特写|全景|中景|近景|远景镜头|俯拍|仰拍|平视|鸟瞰|景深/.test(c)) return 'camera';
    if (/^(光影|光线|照明)[：:]/.test(c) || /伦勃朗光|蝴蝶光|侧逆光|侧光|顶光|逆光|顺光|补光|环境光|丁达尔|黄金时刻|柔光|硬光|灯光/.test(c)) return 'light';
    if (/^(风格|画风)[：:]/.test(c)) return 'style';
    if (/^(画质|质感)[：:]/.test(c) || /8k|8K|高细节|锐利|胶片颗粒/.test(c)) return 'quality';
    if (/^(声音|音效)[：:]/.test(c)) return 'sound';
    if (/女性|男人|女人|少女|女孩|男孩|老人|男子|女子|人物|模特|主角/.test(c)) return 'feature';
    if (/脸|眼|发|肤|五官|唇|眉|妆|身材|气质|少女感|雀斑|梨涡/.test(c)) return 'feature';
    if (/穿|服装|裙|西装|汉服|旗袍|和服|外套|衬衫|针织|鞋|配饰|项链|耳环|发簪|面料|丝|缎/.test(c)) return 'outfit';
    if (/站|坐|走|跑|回眸|奔|跳|手|姿态|凝视|倚|躺|蹲|转身/.test(c)) return 'action';
    if (/街|房间|室内|户外|背景|天空|森林|城市|咖啡|窗|雨|夜|海边|山|雪|古镇|天桥/.test(c)) return 'scene';
    return 'subject';
  }

  function decompose(prompt) {
    const seg = { subject: '', feature: '', outfit: '', action: '', scene: '', camera: '', light: '', style: '', quality: '', sound: '' };
    const buckets = {};
    const tagMap = {
      镜头: 'camera', 构图: 'camera', 视角: 'camera',
      光影: 'light', 光线: 'light', 照明: 'light',
      风格: 'style', 画风: 'style', 色调: 'style',
      画质: 'quality', 质感: 'quality', 材质: 'quality',
      声音: 'sound', 音效: 'sound',
      动作: 'action', 姿态: 'action', 场景: 'scene', 环境: 'scene'
    };
    const src = String(prompt || '');
    // 有句号按句读；没有句号（常见于中文口语句式）则按全角逗号拆，否则整段会被塞进单一槽位
    const parts = /[。；;]/.test(src)
      ? src.split(/[。；;]+|,/)
      : (src.length > 30 ? src.split(/[，,、]+/) : [src]);
    parts
      .map(c => c.replace(/^[\s，,、:：\-]+|[\s，,、:：\-]+$/g, ''))
      .filter(c => c.length > 1)
      .forEach(c => {
        let key, val;
        const m = c.match(/^(镜头|构图|视角|光影|光线|照明|风格|画风|色调|画质|质感|材质|声音|音效|动作|姿态|场景|环境)[：:]\s*(.+)$/);
        if (m) { key = tagMap[m[1]]; val = m[2]; }
        else {
          val = c.replace(/^【[^】]{1,8}】\s*[:：]?\s*/, '');
          key = classifyClause(c);
        }
        val = val.replace(/^[\s，,、:：]+/, '').trim();
        if (!val) return;
        (buckets[key] = buckets[key] || []).push(val);
      });
    Object.keys(buckets).forEach(k => { seg[k] = buckets[k].join('，'); });
    return seg;
  }

  /* ---------------- 采集解析 ---------------- */
  function detectSource(raw) {
    if (/--(ar|v|stylize|niji)\b/i.test(raw)) return { key: 'midjourney', label: 'Midjourney' };
    if (/[（(][^）)]*:\s*\d*\.?\d+\s*[）)]/.test(raw)) return { key: 'sd', label: 'Stable Diffusion / SDXL' };
    const en = (raw.match(/[a-zA-Z]{3,}/g) || []).length;
    const zh = (raw.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (en > zh / 3) return { key: 'sdxl', label: '英文提示词（SDXL / Flux / MJ）' };
    return { key: 'zimage', label: '中文结构化（Z-Image 系 / H3）' };
  }

  function stripNoise(raw) {
    const notes = [];
    let t = String(raw || '');
    // Midjourney 的 --no 是负面词，必须先摘掉，否则会污染后面的断句
    const no = t.match(/--no\s+[^-]*/gi);
    if (no) { t = t.replace(/--no\s+[^-]*/gi, ' '); notes.push('移除 --no 负面词 ' + no.length + ' 段'); }
    const w = t.match(/[（(][^）)]*:\s*\d*\.?\d+\s*[）)]/g);
    if (w) { t = t.replace(/[（(][^）)]*:\s*\d*\.?\d+\s*[）)]/g, m => m.replace(/[（(]|:\s*\d*\.?\d+\s*[）)]/g, '')); notes.push('去权重括号 ' + w.length + ' 处'); }
    const a = t.match(/--(ar|v|stylize|quality|style|chaos|seed|niji)\s*[\w:.]+/gi);
    if (a) { t = t.replace(/--(ar|v|stylize|quality|style|chaos|seed|niji)\s*[\w:.]+/gi, ''); notes.push('去 MJ 参数 ' + a.length + ' 处'); }
    if (/\b(8k|4k|uhd|hd)\b/i.test(t)) notes.push('含分辨率修饰词（保留）');
    return { text: U.clean(t.replace(/\s{2,}/g, ' ')), notes };
  }

  function negativeToPositive(raw) {
    let t = String(raw || '');
    let n = 0;
    Object.keys(NEG_MAP).forEach(k => { if (t.indexOf(k) >= 0) { t = t.split(k).join(NEG_MAP[k]); n++; } });
    return { text: t, n };
  }

  /* ------------------------------------------------------------------
   * 生视频条目解析（v3.1）
   * 视频提示词是「主体+动作+镜头+光线+声音」的线性叙事，没有标签段落，
   * 直接套生图的 decompose 会把整段塞进单一槽位。这里单独处理：
   *   1) 先把「声音：/配乐：/环境音：…」整块摘出（含其后同一句的补充）
   *   2) 剩余按句切块，块内再按中英文逗号细切
   *   3) 以【槽位名】开头的子句强制归位
   * ------------------------------------------------------------------ */
  /* 视频专用分类：在通用分类器之上补几条视频常见的说法 */
  function classifyVideoClause(c) {
    // 纯约束句，没有对应槽位（保持比例/锁定机位/无字幕…）
    if (/^(保持|锁定|禁止|不出现|无(字幕|标志|文字|配乐|变速|切镜))/.test(c)) return null;
    if (/阳光|夕照|晨光|月光|天光|暮色|暖光|冷光|霓虹灯|霓虹招牌|霓虹光|灯光|照明|逆光|侧光|顶光|自然光/.test(c)) return 'light';
    if (/微距|推近|拉远|跟拍|环绕|摇镜|滑动|固定镜头|机位|运镜|特写|切至|升降|甩镜|俯冲|平移/.test(c)) return 'camera';
    if (/展开|抖动|伸展|停步|跃过|冲刺|滑步|摆动|扑向|握住|伸向|蓄力|转身回眸/.test(c)) return 'action';
    return classifyClause(c);
  }

  function decomposeVideo(prompt) {
    const seg = { subject: '', feature: '', outfit: '', action: '', scene: '', camera: '', light: '', style: '', quality: '', sound: '' };
    let src = String(prompt || '');

    // 1) 声音块：标签出现后，直到该句结束都算声音描述
    const sounds = [];
    src = src.replace(/(声音|音效|环境音|背景音|配乐)\s*[：:]\s*([^。；;]*)[。；;]?/g, (m, tag, body) => {
      let t = body.trim().replace(/^[，,、]+|[，,、]+$/g, '');
      // 「声音：环境音：。」这类重复标签，剥掉内层标签
      t = t.replace(/^(声音|音效|环境音|背景音|配乐)\s*[：:]\s*/, '').replace(/[：:]\s*$/, '').trim();
      if (t.length > 1) sounds.push(t);
      return '。';
    });
    // 「无配乐 / 无额外配乐」这类收尾也要带走
    src = src.replace(/[，,]\s*无(额外)?配乐/g, () => { sounds.push('无配乐'); return ''; });

    // 2) 细切。先把【】内的逗号保护起来，否则「【动作，如水珠滑落】」会被切碎
    const PROT = '\u0001';
    src = src.replace(/【[^】]*】/g, mm => mm.replace(/[，,、]/g, PROT));
    const parts = [];
    src.split(/[。；;]/).forEach(cls => {
      cls.split(/[，,、]/).forEach(c => {
        const t = c.trim().replace(/^[\s:：\-]+|[\s:：\-]+$/g, '').replace(new RegExp(PROT, 'g'), '，');
        if (t.length > 1) parts.push(t);
      });
    });

    const STD_SLOT = { '主体': 'subject', '人物特征': 'feature', '服饰造型': 'outfit', '场景环境': 'scene' };

    // 一个子句里可能嵌多个槽位标记（模板版条目常见）：【主体】站在【场景环境】窗边
    // → 在第二个标记处再切一次，否则残留的【】会跟着内容进槽
    const splitMarks = c => {
      const marks = [];
      const re = /【([^】]{1,40})】/g;
      let m;
      while ((m = re.exec(c))) marks.push({ name: m[1], start: m.index, end: m.index + m[0].length });
      if (!marks.length) return [{ mark: null, text: c }];
      const out = [];
      if (marks[0].start > 0) out.push({ mark: null, text: c.slice(0, marks[0].start) });
      marks.forEach((x, i) => {
        const next = i + 1 < marks.length ? marks[i + 1].start : c.length;
        out.push({ mark: x.name, text: c.slice(x.end, next) });
      });
      return out;
    };

    const buckets = {};
    // 主体定位：中文视频提示词几乎都写「一只鹦鹉 / 一双手 / 一列列车」，
    // 这个信号比句首位置可靠得多（状语常在前，主体在后）
    const SUBJ_RE = /^[一这那][只列把双位个件座辆张条匹头群排名副碗杯盘朵株棵片块根支枝台架艘间扇枚颗粒滴缕束团堆份套对串叠瓶盒袋包篮筐桶锅顶面幅帧幕道栋层户所处场]/;
    let subjIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      const bare = parts[i].replace(/^【[^】]{1,40}】/, '').trim();
      if (SUBJ_RE.test(bare) && bare.length > 3) { subjIdx = i; break; }
    }
    // 兜底：没有数量词时，第一个非修饰性描述当主体
    let headSeen = subjIdx >= 0;

    parts.forEach((c, pi) => {
      splitMarks(c).forEach(piece => {
        let val = piece.text.replace(/^[\s，,、:：]+|[\s，,、:：]+$/g, '');
        // 标记后面没内容的模板占位符（如【动作，如水珠滑落】）→ 把它当填写提示放进槽里
        if (val.length < 1) {
          if (piece.mark && /[，,]/.test(piece.mark)) {
            const mapped = SLOT_ALIAS[piece.mark] || piece.mark;
            const k = STD_SLOT[mapped] || classifyClause(piece.mark);
            (buckets[k] = buckets[k] || []).push('【' + piece.mark + '】');
          }
          return;
        }

        // 有槽位标记：先按语义分类，判不出再用标记兜底
        // （「【主体】站在…」里的“站在”是动作，不该被塞进主体槽）
        let key = classifyVideoClause(val);
        if (key === null) return;                         // 纯约束句
        if (piece.mark && key === 'subject') {
          const mapped = SLOT_ALIAS[piece.mark] || piece.mark;
          key = STD_SLOT[mapped] || 'subject';
        }

        // 数量词命中的那条 → 强制当主体
        if (pi === subjIdx && !piece.mark) {
          key = 'subject';
        } else if (!headSeen && !piece.mark) {
          headSeen = true;
          if (key === 'scene' || key === 'feature' || key === 'outfit') key = 'subject';
        } else if (key !== 'subject' || piece.mark) {
          headSeen = true;
        }

        // 视频里的硬约束句（无变速、无切镜、保持稳定…）不属于任何画面槽位，丢掉
        if (/^(无变速|无切镜|无文字|无突变|无转场|自然尺度|保持[^，]{0,16}(稳定|比例|一致|不变|固定)|不出现[^，]{0,8})$/.test(val)) return;
        // 氛围/调性词比「主体」更适合后者
        if (key === 'subject' && /氛围|调性|电影感|影调/.test(val)) key = 'style';
        (buckets[key] = buckets[key] || []).push(val);
      });
    });

    Object.keys(buckets).forEach(k => { seg[k] = buckets[k].join('，'); });
    if (sounds.length) {
      const sm = sounds.join('；');
      seg.sound = seg.sound ? sm + '；' + seg.sound : sm;
    }
    return seg;
  }

  function analyzeIngest(raw) {
    const src = detectSource(raw);
    const noised = stripNoise(raw);
    const pos = negativeToPositive(noised.text);
    const seg = decompose(pos.text);
    const slots = ['subject', 'feature', 'outfit', 'scene'].filter(k => seg[k]);
    const len = pos.text.length;
    // 用「有效信息块」口径：实体槽位 + 段落修饰，避免中文整句被归到 feature 后误判为 C
    const mods = ['action', 'camera', 'light', 'style', 'quality'].filter(k => seg[k]).length;
    const rich = slots.length + mods;
    let sc = 'B';
    if (rich >= 5 && len > 55 && pos.n === 0) sc = 'A';
    if (rich <= 2 || len < 30) sc = 'C';

    // 去重
    const pool = LIB.image.concat(LIB.video);
    const dups = pool
      .map(p => ({ id: p.id, name: p.name, sim: U.similarity(pos.text, p.prompt) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
      .filter(x => x.sim > 0.15);

    return { src, notes: noised.notes, posFixed: pos.n, text: pos.text, seg, slots, score: sc, dups, len };
  }

  /* ---------------- 随机灵感 ---------------- */
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function lexWords(dim) {
    const x = LIB.lexicon.find(l => l.dim === dim);
    return x ? x.words : [];
  }
  function randomState(base) {
    const seg = Object.assign({}, base.seg);
    const put = (k, dims, n) => {
      const pool = [];
      dims.forEach(d => pool.push.apply(pool, lexWords(d)));
      if (!pool.length) return;
      const arr = [];
      for (let i = 0; i < n; i++) { const w = pick(pool); if (arr.indexOf(w) < 0) arr.push(w); }
      seg[k] = arr.join('，');
    };
    put('subject', ['人像身份职业'], 1);
    put('feature', ['脸型轮廓', '眼睛眼型', '肤质肌理', '发型'], 4);
    put('outfit', ['服装品类', '面料材质', '配色'], 3);
    put('action', ['姿势动作'], 1);
    put('scene', ['地点场所', '时间', '背景元素'], 3);
    put('camera', ['镜头构图'], 1);
    put('light', ['光线'], 1);
    put('style', ['风格流派'], 1);
    put('quality', ['画面质感'], 1);
    if (MODELS[base.model].kind === 'video') seg.sound = '环境音：' + pick(SOUND_CHIPS) + '，' + pick(SOUND_CHIPS);
    return Object.assign({}, base, { seg });
  }

  /* ---------------- 变体 ---------------- */
  function variants(state, n) {
    n = n || 3;
    const out = [];
    const alts = {
      light: ['伦勃朗光', '窗边侧光', '黄金时刻暖光', '霓虹环境光', '柔光箱正面光', '侧逆光'],
      camera: ['85mm 人像中景', '50mm 半身平视', '24mm 广角低机位', '长焦特写压缩背景', '俯拍全景'],
      style: ['胶片质感', '电影感青橙调', '清透日系', '低饱和高级灰', '复古油画']
    };
    for (let i = 0; i < n; i++) {
      const s = Object.assign({}, state, { seg: Object.assign({}, state.seg) });
      s.seg.light = pick(alts.light);
      s.seg.camera = pick(alts.camera);
      s.seg.style = pick(alts.style);
      out.push({ seg: s.seg, text: build(s).text, key: s.seg.light + ' / ' + s.seg.camera });
    }
    return out;
  }

  /* ---------------- 检索计划 ---------------- */
  function searchPlan(opts) {
    const { model, type, tags } = opts;
    const m = MODELS[model];
    const base = m.kind === 'video'
      ? ['Z-Image 生视频 提示词', 'MiniMax H3 提示词 案例', 'H3 T2VA I2VA 实测']
      : ['Z-Image 提示词', 'Z-Image Turbo 提示词 案例', 'Z-Image 人像 提示词'];
    const g = (tags || []).slice(0, 3);
    const qs = [];
    base.forEach(b => {
      if (g.length) g.forEach(t => qs.push(b + ' ' + t));
      else qs.push(b);
    });
    return {
      queries: U.uniq(qs).slice(0, 9),
      accept: [
        '带完整提示词原文（不是「一句话概括」）',
        '有可验证的热度：收藏 / 点赞 / 使用次数 / 下载量',
        '注明来源链接与日期',
        '结构完整：主体 + 场景 + 光线 至少三层',
        '与库内已有条目相似度 < 0.85（采集器会自动查重）'
      ],
      exclude: [
        '只有效果图、没有提示词的',
        '转述改写过多、看不出原始写法的',
        '明显由 AI 生成的「提示词教程」但没有实拍验证的',
        '含违规或擦边内容的（采集器会拦截）'
      ]
    };
  }

  /* =======================================================================
   * P0-1 · 槽位归一
   * ===================================================================== */
  function normalizeSlots(text) {
    let t = String(text || '');
    const hits = [];
    t = t.replace(/【([^】]{1,16})】/g, (all, name) => {
      const n = name.trim();
      const std = SLOT_ALIAS[n];
      if (std && std !== n) { hits.push(n + '→' + std); return '【' + std + '】'; }
      if (!std && NON_SLOT_TAGS.indexOf(n) >= 0) { hits.push(n + '→（转段落）'); return n + '：'; }
      return all;
    });
    return { text: t, hits: U.uniq(hits) };
  }

  // 从正文提取标准槽位（已归一）
  function slotsOf(prompt) {
    const t = normalizeSlots(prompt).text;
    const found = [];
    (t.match(/【([^】]{1,16})】/g) || []).forEach(x => {
      const n = x.slice(1, -1);
      if (['主体', '人物特征', '服饰造型', '场景环境'].indexOf(n) >= 0 && found.indexOf(n) < 0) found.push(n);
    });
    return found;
  }

  /* =======================================================================
   * P0-2 · 可用模型推断（一条提示词往往不止适配一个模型）
   * ===================================================================== */
  function inferModels(item) {
    const raw = String(item.model || '') + ' ' + String(item.workflow || '') + ' ' + String(item.sampling || '');
    const p = String(item.prompt || '');
    const out = [];
    const push = x => { if (out.indexOf(x) < 0) out.push(x); };

    if (/H3|MiniMax/i.test(raw)) push('h3');
    if (/Base/i.test(raw)) push('z-base');
    if (/Edit|编辑/i.test(raw)) push('z-edit');
    if (/SDXL|Flux|Stable Diffusion/i.test(raw)) push('sdxl');
    if (/Turbo/i.test(raw)) push('z-turbo');

    // 无标注时按提示词特征推断
    if (!out.length) {
      if (/声音[：:]|镜头|运镜/.test(p) && /17n\+5|24fps|H3/.test(raw)) push('h3');
      if (/[\u4e00-\u9fa5]/.test(p)) { push('z-turbo'); }
      if (/文字|排版|海报|信息图|UI/.test(p)) push('z-base');
      if (/^(a |an |the )|,\s*(8k|highly detailed|cinematic)/i.test(p)) push('sdxl');
    }
    if (!out.length) push('z-turbo');
    // 中文结构化 + 无文字类 → Base 也通常能出，标为可选
    if (out.indexOf('z-turbo') >= 0 && /文字|排版|海报|信息图|UI|logo/i.test(p) && out.indexOf('z-base') < 0) push('z-base');
    return out;
  }

  /* =======================================================================
   * P3-1 · 标签三层
   * ===================================================================== */
  function tagPath(tag) {
    const t = String(tag || '');
    const pick = (rules) => {
      for (let i = 0; i < rules.length; i++) if (rules[i][1].test(t)) return rules[i][0];
      return '其他';
    };
    const l1 = pick(TAG_L1);
    let l2 = pick(TAG_L2);
    if (l2 === '其他' && L1_L2[l1]) l2 = L1_L2[l1];
    return { l1, l2, l3: pick(TAG_L3) };
  }

  /* =======================================================================
   * P2-1 · 失败案例库
   * detect 用于装配页实时比对：命中就提示「你可能正在犯 F-xx」
   * ===================================================================== */
  const FAILURE_DB = [
    { id: 'F-01', model: 'z-turbo', name: 'CFG 没有锁 1.0', symptom: '画面色彩爆炸、对比过强、皮肤发红', cause: '蒸馏模型只在 CFG=1.0 蒸馏过，偏离即失稳', fix: 'CFG 固定 1.0，想要更强对比改用提示词描述', detect: null },
    { id: 'F-02', model: 'z-turbo', name: '在正文写负面词', symptom: '写了「不要模糊」反而更糊、多了奇怪元素', cause: 'Turbo 走 ConditioningZeroOut，负向分支被清零', fix: '全部改写为正面状态描述（用负向转换器）', detect: /不要|禁止|避免|negative/i },
    { id: 'F-03', model: 'z-turbo', name: '提示词超长', symptom: '后半段描述被忽略，人物特征丢失', cause: '8 步的注意力预算有限，长尾信息分不到权重', fix: '压到 300 字内，核心特征前置', detect: null },
    { id: 'F-04', model: 'z-turbo', name: '用 Turbo 渲染文字', symptom: '海报文字糊成一团、笔画粘连', cause: '8 步不足以收敛字形结构', fix: '切 Z-Image Base（30 步 / CFG 4.0）', detect: /文字|字幕|标题|排版|logo/i },
    { id: 'F-05', model: 'zimage', name: '分辨率不是 16 的倍数', symptom: '画面边缘崩坏、拉伸、出现色块', cause: 'VAE 下采样固定 8×，latent 需 2 的倍数 → 像素须 16 倍数', fix: '宽高都取 16 的倍数', detect: null },
    { id: 'F-06', model: 'zimage', name: '超过 4MP', symptom: '显存溢出或出图质量骤降', cause: 'Turbo 原生训练分辨率上限约 4MP', fix: '控制在 2048×2048 以内，需要更大走放大链', detect: null },
    { id: 'F-07', model: 'any', name: '只写「美女」', symptom: '同一提示词每次长相完全不同', cause: '泛词没有约束力，模型随机采样五官', fix: '写满 脸型 + 眼型 + 肤质 + 发型 四要素', detect: null },
    { id: 'F-08', model: 'any', name: '换背景只写「户外」', symptom: '背景糊、地面缺失、人物像贴上去的', cause: '模型不知道地面材质与远近层次', fix: '写满 地面 + 中景 + 远景 + 光线 四层', detect: null },
    { id: 'F-09', model: 'h3', name: '没有声音段', symptom: '输出视频完全静音', cause: 'H3 是音视频一体模型，不写声音就不生成音轨', fix: '提示词结尾补「声音：」', detect: null },
    { id: 'F-10', model: 'h3', name: '帧数不是 17n+5', symptom: '报错或尾帧异常、时长对不上', cause: 'H3 的时序压缩比固定，帧数必须满足 17n+5', fix: '5s→124 帧、10s→243 帧、15s→362 帧（上限）', detect: null },
    { id: 'F-11', model: 'h3', name: '一条提示词写多种运镜', symptom: '画面来回抽搐、主体漂移', cause: '单镜头只支持一种主运动', fix: '只保留一种运镜，其余拆成另一条', detect: /推近[\s\S]*拉远|拉远[\s\S]*推近|环绕[\s\S]*跟拍/ },
    { id: 'F-12', model: 'h3', name: '时长超过 15s', symptom: '任务失败或被截断', cause: '单次生成硬上限 15s / 362 帧', fix: '分段生成后拼接，或压到 15s 内', detect: null },
    { id: 'F-13', model: 'h3', name: '分辨率不是 32 的倍数', symptom: '报错或画面出现竖条', cause: 'H3 的 patch 尺寸是 32', fix: '宽高都取 32 的倍数（960×544 / 1152×640 / 1216×672）', detect: null },
    { id: 'F-14', model: 'z-edit', name: '写了「保持人物不变」', symptom: '人物被重绘、脸变了', cause: '编辑模型默认锁非编辑区，复述保留反而干扰指令解析', fix: '只写「要改成什么」，不复述要保留的主体', detect: /保留|不要改变|保持不变|维持原样/ },
    { id: 'F-15', model: 'z-turbo', name: '在 Turbo 上做编辑', symptom: '换了衣服但脸也变了，或完全没改', cause: 'CFG 1.0 没有指令强度旋钮，8 步收敛不出编辑精度', fix: '改用 Z-Image-Edit（28 步 / CFG 7.5）或 SDXL+Inpaint', detect: null },
    { id: 'F-16', model: 'z-edit', name: 'denoise 过高', symptom: '整张图重绘，人脸面目全非', cause: 'denoise >0.9 时几乎等于重新生成', fix: '换装换景 0.75–0.85，修边调色 0.3–0.45', detect: null },
    { id: 'F-17', model: 'any', name: '先换脸后换装', symptom: '换完脸再换装，脸又变了', cause: '换装属于大 denoise 重绘，会连带重绘面部', fix: '顺序固定：换装换景 → 换脸 → 修边调色', detect: null },
    { id: 'F-18', model: 'any', name: 'ReActor 源脸太小', symptom: '换出来的脸糊、五官不清', cause: 'inswapper_128 只在 128×128 工作，靠 GPEN-BFR-512 重建', fix: '源脸正脸、≥512px、无遮挡、光线均匀', detect: null },
    { id: 'F-19', model: 'z-turbo', name: 'Z-Image 套标准 IP-Adapter', symptom: '完全不起作用，或提示维度不匹配', cause: '标准 IP-Adapter 改的是 SDXL 2048 维交叉注意力，Z-Image 是 3840 维', fix: '锁脸改用 SDXL/Flux + InstantID/PuLID，或用 ReActor', detect: null },
    { id: 'F-20', model: 'z-turbo', name: 'ControlNet 用 SDXL 权重', symptom: 'KeyError: model.diffusion_model.input_blocks.0.0.weight', cause: 'Z-Image 的 UNet 结构与 SDXL 不同', fix: '用 Z-Image 专用权重 + Z-Image-ControlNet-Apply 节点', detect: null },
    { id: 'F-21', model: 'any', name: '多路 ControlNet 全开 1.0', symptom: '画面僵硬、结构崩坏、色调发灰', cause: '多路条件互相压制', fix: '单路 0.6–0.8，多路合计不超过 1.2', detect: null },
    { id: 'F-22', model: 'sdxl', name: 'SDXL 写中文', symptom: '语义偏移、出图随缘', cause: 'CLIP 文本编码器以英文语料为主', fix: '改英文关键词，或中英混排时英文在前', detect: /[\u4e00-\u9fa5]/ },
    { id: 'F-23', model: 'sdxl', name: '负面词堆太多', symptom: '画面发灰、细节减少、主体变形', cause: '过度负向把有效特征也一起压掉', fix: '负面控制在 20 项内，只留必要项', detect: null },
    { id: 'F-24', model: 'any', name: '光线方向与背景矛盾', symptom: '人物像贴图、合成感强', cause: '主体受光与背景光源不一致', fix: '先定光源（方向/色温/软硬），主体与背景共用同一套', detect: null },
    { id: 'F-25', model: 'any', name: '时间描述自相矛盾', symptom: '光影紊乱、一半白天一半夜晚', cause: '正午顶光与霓虹夜景光比差极大', fix: '统一时间锚点，黄昏蓝调时刻最适合兼顾两者', detect: /白天[\s\S]*霓虹|正午[\s\S]*霓虹|阳光明媚[\s\S]*深夜/ },
    { id: 'F-26', model: 'any', name: '同时写两种姿势', symptom: '肢体扭曲、多手多脚', cause: '姿态冲突，模型只能折中', fix: '一条提示词只给一个主动作', detect: null },
    { id: 'F-27', model: 'any', name: '手部完全不写', symptom: '多指、融指、断手', cause: '手是高频失败区，不给约束就自由发挥', fix: '写「五指自然交叠」「手扶发梢」等具体手部状态', detect: null },
    { id: 'F-28', model: 'any', name: '风格词堆五个以上', symptom: '风格互相稀释，变成四不像', cause: '不同风格共享同一组视觉特征，会互相抵消', fix: '主风格 1 个 + 修饰 1–2 个', detect: null },
    { id: 'F-29', model: 'z-turbo', name: '残留 SD 权重语法', symptom: '画面出现括号文字或怪符号', cause: 'Turbo 不解析 (xxx:1.6)', fix: '去掉权重括号，靠语序和重复表达强调', detect: /[（(][^）)]*:\s*\d*\.?\d+\s*[）)]/ },
    { id: 'F-30', model: 'any', name: '把 --ar 写进正文', symptom: '画面出现「--ar 3:4」字样', cause: '非 MJ 模型不认识命令行参数', fix: '画幅用分辨率控制', detect: /--(ar|v|stylize)\b/i },
    { id: 'F-31', model: 'any', name: '全身/远景不写脸', symptom: '脸部糊成一团，五官不可辨', cause: '画面里脸占的像素太少', fix: '重要角色改中近景，或用角色 LoRA 固定身份', detect: null },
    { id: 'F-32', model: 'any', name: '远景用 InstantID 锁脸', symptom: '脸是像了，但身体僵硬、构图怪异', cause: 'InstantID 在远距离/全身一致性断崖下降', fix: '远景改角色 LoRA，或用 ReActor 后置换脸', detect: null },
    { id: 'F-33', model: 'z-base', name: 'Base 只用 8 步', symptom: '出图糊、细节不足', cause: 'Base 未蒸馏，需要 30 步收敛', fix: 'steps 30 / CFG 4.0', detect: null },
    { id: 'F-34', model: 'z-turbo', name: 'Turbo 拉到 30 步', symptom: '过曝、纹理过锐、噪点被放大', cause: 'Turbo 在 8 步附近收敛，多走反而劣化', fix: 'steps 保持 6–11', detect: null },
    { id: 'F-35', model: 'any', name: '写明星真名', symptom: '不像、或触发内容过滤', cause: '模型对具体人名没有稳定映射，且有合规风险', fix: '改写成可描述的五官与气质特征', detect: null },
    { id: 'F-36', model: 'h3', name: '写「镜头快速切换」', symptom: '画面闪烁、主体跳变', cause: 'H3 是单镜头生成，不支持剪辑', fix: '拆成多条镜头分别生成再剪', detect: /快速切换|多机位|剪辑/ },
    { id: 'F-37', model: 'any', name: '主体与环境比例失真', symptom: '人比楼高、手比脸大', cause: '缺少尺度参照物', fix: '加一个已知尺寸的参照（门框、栏杆、杯子）', detect: null },
    { id: 'F-38', model: 'any', name: '颜色词互相打架', symptom: '服装颜色斑驳、渐变错乱', cause: '同一部位给了多个颜色', fix: '主色 + 点缀色，最多两个颜色词', detect: null }
  ];

  /* =======================================================================
   * P2-3 · 风格 LoRA 绑定
   * 内置只放通用风格位（触发词与文件名需按你本地实际填），支持自定义扩展
   * ===================================================================== */
  const LORA_DB = [
    { id: 'L-01', name: '写实摄影风', base: 'z-turbo', trigger: '', weight: '0.6–0.8', style: '超写实', note: '文件名按本地实际填，触发词留空表示无需' },
    { id: 'L-02', name: '胶片颗粒风', base: 'z-turbo', trigger: '', weight: '0.5–0.7', style: '胶片复古', note: '与「胶片颗粒」提示词叠加时权重降到 0.4' },
    { id: 'L-03', name: '国风水墨', base: 'z-turbo', trigger: '', weight: '0.7–0.9', style: '东方美学', note: '风格类 LoRA 离开配套权重不成立，别只抄提示词' },
    { id: 'L-04', name: '二次元插画', base: 'sdxl', trigger: '', weight: '0.6–0.8', style: '二次元', note: 'SDXL 生态 LoRA 最全，注意底模版本匹配' },
    { id: 'L-05', name: '角色一致性', base: 'z-turbo', trigger: '', weight: '0.8–1.0', style: '角色', note: '重要角色首选角色 LoRA，比 InstantID 远景更稳' }
  ];

  /* =======================================================================
   * P1-1 · 版本差异
   * ===================================================================== */
  function diffText(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return [{ op: 'eq', text: a }];
    const A = Array.from(a), B = Array.from(b);
    if (!A.length) return [{ op: 'add', text: b }];
    if (!B.length) return [{ op: 'del', text: a }];
    if (A.length * B.length > 250000) return [{ op: 'del', text: a }, { op: 'add', text: b }];
    const n = A.length, m = B.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    const push = (op, ch) => {
      const last = out[out.length - 1];
      if (last && last.op === op) last.text += ch; else out.push({ op, text: ch });
    };
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
      else { push('add', B[j]); j++; }
    }
    while (i < n) { push('del', A[i]); i++; }
    while (j < m) { push('add', B[j]); j++; }
    return out;
  }

  function diffSegs(prev, next) {
    const out = [];
    SEGMENTS.forEach(s => {
      const a = U.clean(prev[s.k]), b = U.clean(next[s.k]);
      if (a === b) return;
      out.push({ k: s.k, label: s.slot ? '【' + s.slot + '】' : s.para, a, b, parts: diffText(a, b) });
    });
    return out;
  }

  /* =======================================================================
   * P1-2 · A/B 矩阵
   * ===================================================================== */
  const AB_DIMS = {
    light: { label: '光线', values: ['伦勃朗光', '窗边侧逆光', '黄金时刻暖光', '柔光箱正面光', '霓虹环境光', '阴天柔光'] },
    camera: { label: '镜头', values: ['85mm 中景平视', '50mm 半身平视', '24mm 广角低机位', '135mm 长焦压缩', '俯拍全景'] },
    style: { label: '风格', values: ['胶片质感', '电影感青橙调', '清透日系', '低饱和高级灰', '复古油画'] },
    scene: { label: '场景', values: ['室内窗边', '城市街头', '自然户外', '纯色棚拍'] }
  };

  function abMatrix(state, picks, cap) {
    cap = cap || 24;
    const groups = Object.keys(picks || {}).filter(k => Array.isArray(picks[k]) && picks[k].length && AB_DIMS[k]);
    if (!groups.length) return [];
    let combos = [{}];
    groups.forEach(k => {
      const next = [];
      combos.forEach(c => picks[k].forEach(v => next.push(Object.assign({}, c, { [k]: v }))));
      combos = next;
    });
    combos = combos.slice(0, cap);
    return combos.map((c, i) => {
      const s = Object.assign({}, state, { seg: Object.assign({}, state.seg, c) });
      return { idx: i + 1, vars: c, label: groups.map(k => c[k]).join(' × '), text: build(s).text, seg: s.seg, params: resolve(state.model, s) };
    });
  }

  /* =======================================================================
   * P1-3 · ComfyUI 工作流 JSON
   * 只对标准 SD 类节点链生成可执行图；H3 是非原生节点，输出参数清单并标注
   * ===================================================================== */
  function seedOf(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h % 9007199254740991);
  }
  function randSeed() { return Math.floor(Math.random() * 9007199254740991); }

  function comfyWorkflow(modelId, state) {
    const m = MODELS[modelId];
    const r = resolve(modelId, state);
    const seed = Number(state.seed) || randSeed();
    const text = build(state).text;

    if (m.id === 'h3') {
      return {
        ok: false,
        file: 'minimax_h3_params.json',
        note: 'MiniMax H3 在 ComfyUI 中不是原生节点，节点名随你安装的 H3 节点包不同。这里输出参数清单，粘进你的 H3 工作流对应节点即可。',
        json: {
          model: 'MiniMax-H3', prompt: text,
          negative_prompt: null,
          width: Number((r.res || '1216×672').split('×')[0]),
          height: Number((r.res || '1216×672').split('×')[1]),
          frames: r.frames, fps: 24, steps: r.steps, cfg: null, seed,
          guider: 'BasicGuider（无负向，CFG 不生效）',
          task: /参考/.test(state.workflow || '') ? 'Ref2VA' : 'T2VA',
          audio_required: true
        }
      };
    }

    const [w, h] = (r.res || '1024×1024').split('×').map(Number);
    const ckpt = m.id === 'z-base' ? 'z-image-base.safetensors'
      : m.id === 'z-edit' ? 'z-image-edit.safetensors'
        : m.id === 'sdxl' ? 'sd_xl_base_1.0.safetensors'
          : 'z-image-turbo.safetensors';
    const negText = U.clean(state.negative) || (m.id === 'sdxl' ? NEG_EN.slice(0, 20).join(', ') : '');

    const g = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text, clip: ['1', 1] } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
      '6': { class_type: 'KSampler', inputs: {
        seed, steps: Number(r.steps), cfg: Number(r.cfg),
        sampler_name: r.sampler === '—' ? 'euler' : r.sampler,
        scheduler: r.scheduler === '—' ? 'simple' : r.scheduler,
        denoise: m.id === 'z-edit' ? Number(state.denoise || 0.75) : 1,
        model: ['1', 0], positive: ['2', 0], latent_image: ['5', 0]
      } },
      '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'pf_' + m.id, images: ['7', 0] } }
    };

    if (m.id === 'z-turbo') {
      // Turbo 负面无效，正确做法是 ConditioningZeroOut
      g['3'] = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['2', 0] } };
      g['6'].inputs.negative = ['3', 0];
    } else if (m.id === 'z-edit') {
      g['10'] = { class_type: 'LoadImage', inputs: { image: state.srcImage || 'input.png', upload: 'image' } };
      g['11'] = { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['1', 2] } };
      g['6'].inputs.latent_image = ['11', 0];
      delete g['5'];
      if (negText) {
        g['4'] = { class_type: 'CLIPTextEncode', inputs: { text: negText, clip: ['1', 1] } };
        g['6'].inputs.negative = ['4', 0];
      } else {
        g['3'] = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['2', 0] } };
        g['6'].inputs.negative = ['3', 0];
      }
    } else {
      g['4'] = { class_type: 'CLIPTextEncode', inputs: { text: negText, clip: ['1', 1] } };
      g['6'].inputs.negative = ['4', 0];
    }

    return {
      ok: true, file: 'comfyui_' + m.id + '.json',
      note: m.id === 'z-edit'
        ? '编辑链默认整图重绘；要只改局部，在 VAEEncode 后接 SetLatentNoiseMask 并载入蒙版。'
        : (m.id === 'z-turbo' ? 'Turbo 用 ConditioningZeroOut 而非负面编码，CFG 必须 1.0。' : '标准 txt2img 链，可直接粘进 ComfyUI 的 Load 面板。'),
      json: g
    };
  }

  /* =======================================================================
   * P3-3 · 缺口分析
   * ===================================================================== */
  function gapAnalysis() {
    const tags = {};
    LIB.image.forEach(p => {
      const k = p.tag || '未分类';
      tags[k] = tags[k] || { n: 0, l1: tagPath(k).l1, l3: tagPath(k).l3 };
      tags[k].n++;
    });
    const l1 = {};
    Object.keys(tags).forEach(k => { const g = tags[k].l1; l1[g] = (l1[g] || 0) + tags[k].n; });
    const thin = Object.keys(tags)
      .map(k => ({ tag: k, n: tags[k].n, l1: tags[k].l1, l3: tags[k].l3 }))
      .filter(x => x.n <= 1)
      .sort((a, b) => a.n - b.n);
    const dims = LIB.lexicon.map(x => ({ slot: x.slot, dim: x.dim, n: x.words.length }))
      .sort((a, b) => a.n - b.n).slice(0, 8);
    const models = {};
    LIB.image.forEach(p => inferModels(p).forEach(m => { models[m] = (models[m] || 0) + 1; }));
    const unMapped = Object.keys(tags).filter(k => tagPath(k).l1 === '其他');

    return {
      total: LIB.image.length,
      l1, thin, dims, models, unMapped,
      suggest: thin.slice(0, 6).map(x => ({
        tag: x.tag,
        query: 'Z-Image 提示词 ' + x.tag + ' 案例 实测',
        reason: '该方向仅 ' + x.n + ' 条，是当前最大缺口'
      }))
    };
  }

  /* =======================================================================
   * P0 · 数据体检
   * ===================================================================== */
  function dataHealth() {
    const items = [];
    const add = (sheet, id, field, issue, lv, fixable) => items.push({ sheet, id, field, issue, lv, fixable: !!fixable });
    const STD = ['主体', '人物特征', '服饰造型', '场景环境'];

    const scan = (list, sheet) => {
      const isVideo = sheet === '生视频';
      list.forEach(p => {
        const prompt = String(p.prompt || '');
        const tags = (prompt.match(/【([^】]{1,16})】/g) || []).map(x => x.slice(1, -1));
        const bad = tags.filter(t => STD.indexOf(t) < 0 && NON_SLOT_TAGS.indexOf(t) < 0);
        if (bad.length) add(sheet, p.id, '槽位名', '非标准槽位：' + U.uniq(bad).join('、'), 'err', true);

        const listed = String(p.slots || '').split('/').map(s => s.trim()).filter(Boolean);
        const found = slotsOf(prompt);
        const miss = found.filter(x => listed.indexOf(x) < 0);
        const extra = listed.filter(x => found.indexOf(x) < 0 && STD.indexOf(x) >= 0);
        if (miss.length || extra.length) {
          add(sheet, p.id, '槽位清单',
            (miss.length ? '正文有但清单缺：' + miss.join('、') : '') +
            (extra.length ? ' 清单有但正文缺：' + extra.join('、') : ''), 'err', true);
        }

        if (/[（(][^）)]*:\s*\d*\.?\d+\s*[）)]/.test(prompt)) add(sheet, p.id, '提示词', '残留 SD 权重括号', 'err', true);
        if (/--(ar|v|stylize|quality)\b/i.test(prompt)) add(sheet, p.id, '提示词', '残留 MJ 参数', 'err', true);
        if (/不要|禁止|避免/.test(prompt)) add(sheet, p.id, '提示词', '含否定词（应转正面）', 'warn', true);

        if (isVideo) {
          if (!String(p.frames || '').trim()) add(sheet, p.id, '帧数', '空缺', 'warn', false);
          else if (!/^\d+$/.test(String(p.frames)) || (Number(p.frames) - 5) % 17 !== 0)
            add(sheet, p.id, '帧数', '不满足 17n+5：' + p.frames, 'err', false);
          if (!String(p.duration || '').trim()) add(sheet, p.id, '时长', '空缺', 'warn', false);
          if (!String(p.res || '').trim()) add(sheet, p.id, '分辨率', '空缺', 'warn', false);
          if (!String(p.audio || '').trim()) add(sheet, p.id, '音频轨', '空缺', 'warn', false);
        } else {
          if (!String(p.res || '').trim()) add(sheet, p.id, '分辨率', '空缺', 'warn', false);
          if (!String(p.steps || '').trim()) add(sheet, p.id, 'Steps', '空缺', 'warn', false);
          if (!String(p.cfg || '').trim()) add(sheet, p.id, 'CFG', '空缺', 'warn', false);
        }
        if (!String(p.score || '').trim()) add(sheet, p.id, '评分', '空缺', 'warn', false);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) add(sheet, p.id, '日期', '格式不是 YYYY-MM-DD：' + p.date, 'info', false);

        const modelRaw = String(p.model || '');
        if (modelRaw && !['Z-Image Turbo', 'Z-Image Base', 'Z-Image-Edit', 'MiniMax H3', 'SDXL'].some(m => modelRaw === m)) {
          add(sheet, p.id, '推荐模型', '写法不统一：' + modelRaw, 'info', true);
        }
      });
    };
    scan(LIB.image, '生图');
    scan(LIB.video, '生视频');

    const summary = { total: items.length, err: 0, warn: 0, info: 0, fixable: 0, bySheet: {} };
    items.forEach(x => {
      summary[x.lv]++;
      if (x.fixable) summary.fixable++;
      const k = x.sheet + '·' + x.field;
      summary.bySheet[k] = (summary.bySheet[k] || 0) + 1;
    });
    return { items, summary };
  }

  /* =======================================================================
   * P2-2 · 从 PNG 元数据反推提示词（真正能自动做的那一半）
   * ===================================================================== */
  function pngText(buf) {
    const dv = new DataView(buf);
    const out = {};
    const dec = new TextDecoder('utf-8');
    let p = 8;
    while (p + 8 <= buf.byteLength) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
      const start = p + 8;
      if (start + len > buf.byteLength) break;
      if (type === 'tEXt') {
        const b = new Uint8Array(buf, start, len);
        let z = -1;
        for (let i = 0; i < b.length; i++) if (b[i] === 0) { z = i; break; }
        if (z > 0) out[dec.decode(b.slice(0, z))] = dec.decode(b.slice(z + 1));
      } else if (type === 'iTXt') {
        const b = new Uint8Array(buf, start, len);
        let z = -1;
        for (let i = 0; i < b.length; i++) if (b[i] === 0) { z = i; break; }
        if (z > 0) {
          const key = dec.decode(b.slice(0, z));
          const comp = b[z + 1];
          if (!comp) {
            let s = z + 3;
            while (s < b.length && b[s] !== 0) s++;
            s++;
            while (s < b.length && b[s] !== 0) s++;
            out[key] = dec.decode(b.slice(s + 1));
          } else out[key] = '__compressed__';
        }
      } else if (type === 'IEND') break;
      p = start + len + 4;
    }
    return out;
  }

  function pngToPrompt(buf) {
    const meta = pngText(buf);
    const res = { source: 'unknown', prompt: '', negative: '', params: {}, meta: Object.keys(meta) };

    // A1111 / WebUI
    if (meta.parameters) {
      const raw = meta.parameters;
      const cut = raw.indexOf('Negative prompt:');
      let pos = raw, neg = '';
      if (cut >= 0) {
        pos = raw.slice(0, cut).trim();
        const rest = raw.slice(cut + 16);
        const ls = rest.lastIndexOf('\nSteps:');
        neg = (ls >= 0 ? rest.slice(0, ls) : rest).trim();
      } else {
        const ls = raw.lastIndexOf('\nSteps:');
        if (ls >= 0) pos = raw.slice(0, ls).trim();
      }
      const line = raw.split('\n').filter(l => /^Steps:/.test(l))[0] || '';
      const kv = {};
      line.replace(/(\w[\w ]*):\s*([^,]+)/g, (a, k, v) => { kv[k.trim()] = v.trim(); });
      res.source = 'A1111 / WebUI';
      res.prompt = pos; res.negative = neg;
      res.params = { steps: kv.Steps, cfg: kv['CFG scale'], seed: kv.Seed, sampler: kv.Sampler, size: kv.Size, model: kv.Model };
      return res;
    }

    // ComfyUI：prompt 是节点图 JSON
    if (meta.prompt) {
      try {
        const g = JSON.parse(meta.prompt);
        const texts = [];
        const ks = {};
        Object.keys(g).forEach(id => {
          const n = g[id] || {};
          const ct = n.class_type || '';
          if (/CLIPTextEncode|TextEncode/i.test(ct) && n.inputs && typeof n.inputs.text === 'string') {
            texts.push({ id, text: n.inputs.text, ct });
          }
          if (/KSampler/i.test(ct) && n.inputs) {
            ['steps', 'cfg', 'seed', 'sampler_name', 'scheduler', 'denoise'].forEach(k => {
              if (n.inputs[k] != null) ks[k] = n.inputs[k];
            });
          }
          if (/CheckpointLoader/i.test(ct) && n.inputs && n.inputs.ckpt_name) ks.model = n.inputs.ckpt_name;
          if (/EmptyLatentImage/i.test(ct) && n.inputs) ks.size = n.inputs.width + '×' + n.inputs.height;
        });
        const uniqTexts = [];
        texts.forEach(t => { if (t.text && uniqTexts.indexOf(t.text) < 0) uniqTexts.push(t.text); });
        res.source = 'ComfyUI';
        res.prompt = uniqTexts[0] || '';
        res.negative = uniqTexts[1] || '';
        res.params = ks;
        res.allTexts = uniqTexts;
        return res;
      } catch (e) { /* 落到 unknown */ }
    }

    if (meta.workflow) { res.source = 'ComfyUI（仅 workflow，无 prompt）'; }
    return res;
  }

  /* =======================================================================
   * 负向 / 正向 双向转换
   * ===================================================================== */
  function negToPos(text) {
    let t = String(text || '');
    let n = 0;
    // 先长 key 后短 key，避免「不要模糊」被「模糊」抢先
    Object.keys(NEG_MAP).sort((a, b) => b.length - a.length).forEach(k => {
      if (t.indexOf(k) >= 0) { t = t.split(k).join(NEG_MAP[k]); n++; }
    });
    // 兜底：剩余的「不要 X」→「X 自然」（X 不超过 8 字）
    t = t.replace(/不要([^，。；,\n]{1,8})/g, (a, x) => '自然协调的' + x);
    return { text: t, n };
  }

  function posToNeg(text) {
    let t = String(text || '');
    let n = 0;
    Object.keys(POS2NEG).sort((a, b) => b.length - a.length).forEach(k => {
      if (t.indexOf(k) >= 0) { t = t.split(k).join(POS2NEG[k]); n++; }
    });
    return { text: t, n };
  }

  /* =======================================================================
   * v3 · 长度预算（借 PromptLayer 的「成本视角」）
   * ===================================================================== */
  const LEN_BUDGET = {
    'z-turbo': { min: 60, max: 300, ideal: 180, note: '8 步蒸馏，注意力预算小；超 300 字后半段基本被忽略' },
    'z-base': { min: 80, max: 600, ideal: 300, note: '30 步能处理长描述；海报/信息图类可到 600 字' },
    'z-edit': { min: 20, max: 200, ideal: 80, note: '编辑指令越短越准，只写「改成什么」，不复述要保留的' },
    'h3': { min: 80, max: 500, ideal: 260, note: '含声音段；超长会让动作描述被稀释' },
    'sdxl': { min: 40, max: 220, ideal: 120, note: '英文关键词，CLIP 75 token 一档，超过会分块编码' }
  };

  // 粗略 token 估算：中文约 1.6 token/字，英文约 1.3 token/词
  function estTokens(text) {
    const t = String(text || '');
    const han = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = (t.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
    return Math.round(han * 1.6 + en * 1.3);
  }

  function lenBudget(modelId, text) {
    const b = LEN_BUDGET[modelId] || LEN_BUDGET['z-turbo'];
    const len = String(text || '').length;
    let lv = 'ok', msg = '长度合适';
    if (!len) { lv = 'empty'; msg = '还没写'; }
    else if (len < b.min) { lv = 'short'; msg = '偏短，信息量不够，模型会自由发挥'; }
    else if (len > b.max) { lv = 'long'; msg = '超上限 ' + (len - b.max) + ' 字，尾部内容会被弱化'; }
    return {
      min: b.min, max: b.max, ideal: b.ideal, note: b.note,
      len, pct: U.clamp(Math.round(len / b.max * 100), 0, 200),
      tokens: estTokens(text), lv, msg
    };
  }

  /* =======================================================================
   * v3 · 模板语法导出（借 Dynamic Prompts / Prompt Builder / PromptHub）
   * 同一份设定，输出四种生态各自能直接吃的模板
   * ===================================================================== */
  const SLOT_KEY = { '主体': 'subject', '人物特征': 'feature', '服饰造型': 'outfit', '场景环境': 'scene' };
  const SLOT_ZH = { '主体': '主体', '人物特征': '人物特征', '服饰造型': '服饰造型', '场景环境': '场景环境' };

  function slotName(k) {
    const seg = SEGMENTS.find(s => s.k === k);
    return seg && seg.slot ? seg.slot : k;
  }

  // 从词库取某槽位的候选词（用于生成 wildcards 文件）
  function wordsOfSlot(slot) {
    const dims = SLOT_DIMS[slot] || [];
    let out = [];
    dims.forEach(d => { const w = lexWords(d); if (w && w.length) out = out.concat(w); });
    return U.uniq(out).filter(w => String(w).length <= 12).slice(0, 24);
  }

  function templateExports(state) {
    const order = ORDER[state.model] || ORDER['z-turbo'];
    const isEdit = state.model === 'z-edit';
    const filled = {};
    SEGMENTS.forEach(s => { filled[s.k] = U.clean(state.seg[s.k]); });
    const out = [];

    /* --- 1. PromptHub 变量版 {{中文变量}} --- */
    if (!isEdit) {
      const arts = ['subject', 'feature', 'outfit', 'action', 'scene']
        .filter(k => order.indexOf(k) >= 0)
        .map(k => {
          const seg = SEGMENTS.find(s => s.k === k);
          return seg.slot ? `{{${seg.slot}}}` : (filled[k] ? filled[k] : '');
        }).filter(Boolean);
      const tail = ['camera', 'light', 'style', 'quality', 'sound']
        .filter(k => order.indexOf(k) >= 0)
        .map(k => {
          const seg = SEGMENTS.find(s => s.k === k);
          return filled[k] ? `${seg.para}：${filled[k]}` : '';
        }).filter(Boolean);
      let s = arts.join('，');
      if (tail.length) s = (s ? s.replace(/[。.]$/, '') + '。' : '') + tail.join('。') + '。';
      const vars = ['subject', 'feature', 'outfit', 'scene']
        .filter(k => order.indexOf(k) >= 0)
        .map(k => `${slotName(k)} = ${filled[k] || '（待填）'}`);
      out.push({ k: 'mustache', n: 'PromptHub / 通用变量', tag: '{{变量}}', text: s, vars, files: [] });
    }

    /* --- 2. Prompt Builder 变量版 {key}（Python str.format） --- */
    if (!isEdit) {
      const arts = ['subject', 'feature', 'outfit', 'action', 'scene']
        .filter(k => order.indexOf(k) >= 0)
        .map(k => {
          const seg = SEGMENTS.find(s => s.k === k);
          return seg.slot ? `{${k}}` : (filled[k] ? filled[k] : '');
        }).filter(Boolean);
      let s = arts.join('，');
      if (filled.camera) s += `。镜头：${filled.camera}`;
      if (filled.light) s += `。光影：${filled.light}`;
      if (filled.style) s += `。风格：${filled.style}`;
      if (filled.quality) s += `。画质：${filled.quality}`;
      if (filled.sound) s += `。声音：${filled.sound}`;
      s = s.replace(/^，/, '');
      out.push({
        k: 'format', n: 'ComfyUI Prompt Builder', tag: '{key}',
        text: s,
        vars: ['subject', 'feature', 'outfit', 'scene'].map(k => `${k} = ${filled[k] || '（待填）'}`),
        files: []
      });
    }

    /* --- 3. Dynamic Prompts：__通配__ + wildcards/*.txt --- */
    if (!isEdit) {
      const refs = [];
      const files = [];
      const cnt = [];
      ['subject', 'feature', 'outfit', 'scene'].forEach(k => {
        if (order.indexOf(k) < 0) return;
        const slot = slotName(k);
        refs.push(`__${slot}__`);
        // 已填值放第一行，其余取词库候选
        const cand = U.uniq([filled[k]].filter(Boolean).concat(wordsOfSlot(slot)));
        files.push({ name: slot + '.txt', body: cand.join('\n') });
        cnt.push(cand.length);
      });
      const head = refs.join('，');
      let s = head;
      if (filled.action) s += `，${filled.action}`;
      if (filled.camera) s += `。镜头：${filled.camera}`;
      if (filled.light) s += `。光影：${filled.light}`;
      if (filled.style) s += `。风格：${filled.style}`;
      if (filled.sound) s += `。声音：${filled.sound}`;
      const combos = cnt.reduce((a, b) => a * b, 1);
      out.push({
        k: 'wild', n: 'Dynamic Prompts 通配', tag: '__文件__',
        text: s,
        vars: ['组合空间 ' + combos.toLocaleString() + ' 组（' + cnt.join(' × ') + '）',
          '把 ' + files.length + ' 个 txt 放进 ComfyUI/wildcards/'],
        files
      });
    }

    /* --- 4. Jinja2：带条件与默认值 --- */
    const j2 = [];
    ['subject', 'feature', 'outfit', 'scene'].forEach(k => {
      if (order.indexOf(k) < 0) return;
      j2.push(`{% if ${k} %}{{ ${k} }}{% endif %}`);
    });
    let jt = j2.join('，');
    if (filled.action) jt += `，${filled.action}`;
    ['camera', 'light', 'style', 'quality', 'sound'].forEach(k => {
      if (order.indexOf(k) < 0 || !filled[k]) return;
      const seg = SEGMENTS.find(s => s.k === k);
      jt += `。${seg.para}：${filled[k]}`;
    });
    out.push({
      k: 'jinja', n: 'Jinja2 条件模板', tag: '{% if %}',
      text: jt,
      vars: ['空变量自动跳过，不会留下空洞',
        '可在 {{ }} 外层套 {% for %} 做批量'],
      files: []
    });

    return out;
  }

  /* =======================================================================
   * v3 · 规范断言套件（借 promptfoo 的 assert 思路，对象换成整个库）
   * 每条断言：跑全库 → 通过/失败计数 → 失败条目可钻取
   * ===================================================================== */
  const STD_SLOTS = ['主体', '人物特征', '服饰造型', '场景环境'];

  const ASSERTS = [
    {
      id: 'A01', n: '有主体槽位', lv: 'err', g: '结构', scope: 'slot',
      hint: '缺主体，模型不知道画什么',
      test: c => /【主体】/.test(c.prompt) || U.clean(c.item.slots || '').indexOf('主体') >= 0
    },
    {
      id: 'A02', n: '有场景槽位', lv: 'err', g: '结构', scope: 'slot',
      hint: '缺场景，背景会被随机填充',
      test: c => /【场景环境】/.test(c.prompt) || U.clean(c.item.slots || '').indexOf('场景环境') >= 0
    },
    {
      id: 'A03', n: '无残留权重括号', lv: 'err', g: '语法',
      hint: '(xxx:1.2) 在 Z-Image 上会被当普通文字',
      test: c => !/[（(][^）)]*:\s*\d*\.?\d+\s*[）)]/.test(c.prompt)
    },
    {
      id: 'A04', n: '无 Midjourney 参数', lv: 'err', g: '语法',
      hint: '--ar / --v 会被当文字画出来',
      test: c => !/--(ar|v|stylize|quality|chaos|seed)\b/i.test(c.prompt)
    },
    {
      id: 'A05', n: '无否定表述', lv: 'warn', g: '语法',
      hint: 'Z-Image / H3 负向无效，须改正面描述',
      test: c => !/不要|禁止|避免|不能|无文字|无logo/i.test(c.prompt)
    },
    {
      id: 'A06', n: '槽位清单与正文一致', lv: 'err', g: '结构', scope: 'slot',
      hint: '清单列了正文里没有的槽位，下游按清单取字段会取空',
      test: c => {
        const listed = String(c.item.slots || '').split('/').map(x => x.trim()).filter(Boolean);
        if (!listed.length) return !/【/.test(c.prompt);
        const found = slotsOf(c.prompt);
        return listed.every(x => found.indexOf(x) >= 0) && found.every(x => listed.indexOf(x) >= 0 || STD_SLOTS.indexOf(x) < 0);
      }
    },
    {
      id: 'A07', n: '槽位名在标准四类内', lv: 'err', g: '结构', scope: 'slot',
      hint: '自造槽位名会让归一表失效',
      test: c => (c.prompt.match(/【([^】]{1,16})】/g) || [])
        .map(x => x.slice(1, -1))
        .every(t => STD_SLOTS.indexOf(t) >= 0 || NON_SLOT_TAGS.indexOf(t) >= 0)
    },
    {
      id: 'A08', n: '长度在模型预算内', lv: 'warn', g: '配比',
      hint: '超长后半段会被弱化，过短会自由发挥',
      test: c => {
        const b = LEN_BUDGET[c.model] || LEN_BUDGET['z-turbo'];
        const L = c.prompt.length;
        return L >= b.min && L <= b.max;
      }
    },
    {
      id: 'A09', n: '无空泛词', lv: 'info', g: '配比',
      hint: '美女 / 好看 / 高清 这类词对出图没有约束力',
      test: c => VAGUE_KEYS.every(w => c.prompt.indexOf(w) < 0)
    },
    {
      id: 'A10', n: '参数三元组完整', lv: 'warn', g: '参数',
      hint: 'steps / cfg / sampler 缺一项就没法复现',
      test: c => {
        const i = c.item;
        if (c.video) return !!U.clean(i.frames || '') && !!U.clean(i.fps || '');
        return !!U.clean(i.steps || '') && !!U.clean(i.cfg || '') && !!U.clean(i.sampler || '');
      }
    },
    {
      id: 'A11', n: '有分辨率', lv: 'err', g: '参数',
      hint: '不同模型的分辨率倍数要求不同（16 / 32），必须写死',
      test: c => !!U.clean(c.item.res || '')
    },
    {
      id: 'A12', n: '有推荐模型', lv: 'warn', g: '参数',
      hint: '不标模型，别人拿去跑会用错参数',
      test: c => !!U.clean(c.item.model || '')
    },
    {
      id: 'A13', n: '有质量评分', lv: 'info', g: '治理',
      hint: '无评分就没法排序，库会越用越乱',
      test: c => ['A', 'B', 'C'].indexOf(U.clean(c.item.score || '')) >= 0
    },
    {
      id: 'A14', n: '有来源与日期', lv: 'info', g: '治理',
      hint: '无法回溯就谈不上沉淀',
      test: c => !!U.clean(c.item.source || '') && /^\d{4}-\d{2}-\d{2}$/.test(String(c.item.date || ''))
    },
    {
      id: 'A15', n: '视频帧数满足 17n+5', lv: 'err', g: '参数', scope: 'video',
      hint: 'H3 帧数只能 17n+5（5s=124 / 10s=243 / 15s=362）',
      test: c => !c.video || ((Number(c.item.frames) - 5) % 17 === 0 && Number(c.item.frames) > 0)
    }
  ];

  function runAsserts(onlyIds) {
    const on = onlyIds && onlyIds.length ? ASSERTS.filter(a => onlyIds.indexOf(a.id) >= 0) : ASSERTS;
    const pools = [
      { list: LIB.image, video: false, sheet: '生图' },
      { list: LIB.video, video: true, sheet: '生视频' }
    ];
    const rows = on.map(a => ({ id: a.id, n: a.n, lv: a.lv, g: a.g, hint: a.hint, scope: a.scope || '', pass: 0, total: 0, skip: 0, fails: [] }));
    const idx = {};
    rows.forEach(r => { idx[r.id] = r; });

    pools.forEach(p => {
      p.list.forEach(item => {
        const prompt = String(item.prompt || '');
        if (!prompt) return;
        const model = U.clean(item.model || '').indexOf('H3') >= 0 ? 'h3'
          : U.clean(item.model || '').indexOf('Base') >= 0 ? 'z-base'
            : U.clean(item.model || '').indexOf('Edit') >= 0 ? 'z-edit'
              : U.clean(item.model || '').indexOf('SDXL') >= 0 ? 'sdxl' : 'z-turbo';
        const ctx = { prompt, item, model, video: p.video, sheet: p.sheet };
        const hasSlot = /【/.test(prompt);
        rows.forEach(r => {
          const a = on.find(x => x.id === r.id);
          if (r.scope === 'slot' && !hasSlot) { r.skip++; return; }
          if (r.scope === 'video' && !p.video) { r.skip++; return; }
          if (r.scope === 'image' && p.video) { r.skip++; return; }
          r.total++;
          let ok = false;
          try { ok = !!a.test(ctx); } catch (e) { ok = false; }
          if (ok) r.pass++;
          else if (r.fails.length < 400) r.fails.push({ id: item.id, sheet: p.sheet, n: item.name || '' });
        });
      });
    });

    rows.forEach(r => { r.rate = r.total ? Math.round(r.pass / r.total * 100) : 0; });
    const totalChecks = rows.reduce((a, r) => a + r.total, 0);
    const totalPass = rows.reduce((a, r) => a + r.pass, 0);
    return {
      rows,
      summary: {
        asserts: rows.length,
        checks: totalChecks,
        pass: totalPass,
        fail: totalChecks - totalPass,
        skipped: rows.reduce((a, r) => a + r.skip, 0),
        rate: totalChecks ? Math.round(totalPass / totalChecks * 100) : 0,
        byGroup: rows.reduce((m, r) => { m[r.g] = m[r.g] || { pass: 0, total: 0 }; m[r.g].pass += r.pass; m[r.g].total += r.total; return m; }, {}),
        worst: rows.slice().sort((a, b) => a.rate - b.rate).filter(r => r.total).slice(0, 3)
      }
    };
  }

  /* =======================================================================
   * v3 · 相似反查（借 Lexica / PromptHero 的反查体验）
   * ===================================================================== */
  function similarIn(text, opt) {
    const q = U.clean(text);
    if (!q) return [];
    const o = opt || {};
    const pool = o.video ? LIB.video : LIB.image;
    // 用包含度而非 Jaccard：问的是「我的内容有多少被这条覆盖了」，
    // Jaccard 会因为库条目更长而系统性偏低（一条 200 字的条目对比 120 字的草稿，
    // 即使核心描述完全一致也只算出 6–8%）。
    const A = U.bigrams(q);
    const score = t => {
      const B = U.bigrams(t);
      if (!A.size || !B.size) return 0;
      let inter = 0;
      A.forEach(x => { if (B.has(x)) inter++; });
      return inter / A.size;
    };
    return pool
      .map(p => ({ p, s: score(p.prompt || '') }))
      .filter(x => x.s > 0.05)
      .sort((a, b) => b.s - a.s)
      .slice(0, o.n || 5)
      .map(x => ({ item: x.p, sim: Math.round(x.s * 100), id: x.p.id, name: x.p.name }));
  }

  /* =======================================================================
   * v3 · 多格式落地（借 Civitai / A1111 的复制习惯）
   * ===================================================================== */
  function toA1111(state, text) {
    const r = resolve(state.model, state);
    const m = MODELS[state.model];
    const neg = U.clean(state.negative) || (m.negative ? '' : '');
    const seed = U.clean(state.seed) || String(randSeed());
    const size = (r.res || '1024×1024').replace('×', 'x');
    const line = ['Steps: ' + r.steps, 'Sampler: ' + (r.sampler === '—' ? 'Euler' : r.sampler),
      'CFG scale: ' + (r.cfg === '—' ? '1.0' : r.cfg), 'Seed: ' + seed, 'Size: ' + size,
      'Model: ' + m.name].join(', ');
    return text + (neg ? '\nNegative prompt: ' + neg : '') + '\n' + line;
  }

  function toCard(state, text, opt) {
    const r = resolve(state.model, state);
    const m = MODELS[state.model];
    const o = opt || {};
    const L = [];
    L.push('### ' + (o.name || '未命名') + '　`' + state.model + '`');
    L.push('');
    L.push('> ' + text.replace(/\n/g, ' '));
    L.push('');
    L.push('| 项 | 值 |');
    L.push('|---|---|');
    L.push('| 模型 | ' + m.name + ' |');
    L.push('| 画幅 / 分辨率 | ' + state.aspect + ' · ' + r.res + ' |');
    L.push('| Steps / CFG | ' + r.steps + ' / ' + r.cfg + ' |');
    L.push('| 采样器 / 调度器 | ' + r.sampler + ' / ' + r.scheduler + ' |');
    if (m.kind === 'video') L.push('| 时长 / 帧数 / 帧率 | ' + r.duration + ' / ' + r.frames + ' / 24fps |');
    if (U.clean(state.negative)) L.push('| 负面 | ' + U.clean(state.negative) + ' |');
    if (U.clean(state.seed)) L.push('| Seed | ' + U.clean(state.seed) + ' |');
    const lb = lenBudget(state.model, text);
    L.push('| 长度 | ' + lb.len + ' 字 · 约 ' + lb.tokens + ' token |');
    return L.join('\n');
  }

  function toCsvRow(state, text) {
    const r = resolve(state.model, state);
    const m = MODELS[state.model];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const cells = [
      q(''), q('未命名'), q(m.kind === 'video' ? '生视频' : '生图'), q(state.tag || ''), q(state.aspect),
      q(state.grading || 'B'), q(new Date().toISOString().slice(0, 10)), q('v1'), q('提示词锻造台 v3'),
      q(text), q(slotsOf(text).join('/')), q(state.aspect + ' · ' + m.name),
      q(''), q(''), q(r.res), q(r.steps), q(r.cfg), q(r.sampler), q(m.name), q('')
    ];
    return cells.join(',');
  }

  global.PF = {
    LIB, MODELS, SEGMENTS, ORDER, RES, ASPECTS, SLOT_DIMS, MOD_DIMS, SOUND_CHIPS, UPGRADE, NEG_MAP, NEG_EN, POS2NEG, VAGUE_KEYS,
    SLOT_ALIAS, NON_SLOT_TAGS, TAG_L1, TAG_L2, TAG_L3, FAILURE_DB, LORA_DB, AB_DIMS,
    U, build, buildTemplate, lint, score, resolve, h3Frames, decompose, analyzeIngest,
    randomState, variants, searchPlan, lexWords, pick,
    normalizeSlots, slotsOf, inferModels, tagPath, decomposeVideo,
    diffText, diffSegs, abMatrix, comfyWorkflow, gapAnalysis, dataHealth, pngToPrompt,
    seedOf, randSeed, negToPos, posToNeg,
    // v3
    LEN_BUDGET, ASSERTS, estTokens, lenBudget, templateExports, runAsserts, similarIn,
    toA1111, toCard, toCsvRow, wordsOfSlot, slotName, SLOT_KEY, SLOT_ZH
  };
})(window);
