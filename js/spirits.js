/* =========================================================
 * spirits.js — 🍡 精灵（挂瓷成精的手串伙伴）
 * 已挂瓷的串 "成精"：卡通形象（AI 绘图 / 本地程序化兜底）+ 性格 + 互相聊天 + 给你送信
 * · 绘图默认走免密钥通道（Pollinations，浏览器直连出图）；也可切到国内 API（OpenAI 兼容）
 * · 文字（性格/聊天/信件）用 DeepSeek（复用「设置 → AI 助手密钥」的 key）；没 key 用本地模板
 * · 所有数据先存 localStorage（不新增数据库字段也能跨天保留；以后想跨手机同步再加列）
 * ========================================================= */
(function () {
  "use strict";

  const STORE_KEY = "ww_spirits";      // { [itemId]: { persona, stage, imgUrl, diary, echoes, bond, greet, sign, replies, ... } }
  const CFG_KEY = "ww_imgcfg";         // 绘图通道配置
  // 出图尺寸：Seedream 5 要求「总像素 3,686,400 ~ 16,777,216，宽高比 1/16~16」，
  // 所以默认用**明确的竖版宽×高**（1728x2304 = 398 万像素，稳过，而且正好是立绘比例）。
  // ⚠️ 不要用 "2K" 这种简写：不同模型对它的解释不一样，有的会当成 1024x1024 → 直接报 "must be at least 3686400 pixels"。
  const DEFAULT_SIZE = "1728x2304";
  const SIZE_PRESETS = [
    { v: "1728x2304", label: "竖版立绘 3:4（推荐）" },
    { v: "2048x2048", label: "方形 2048" },
    { v: "2304x1728", label: "横版 4:3" },
    { v: "3072x3072", label: "4K 方形（最清晰也最贵）" },
  ];
  // v117：各家能用的尺寸不一样，所以尺寸 chip 跟着服务商走（避免选了个一定被拒的档）
  //   智谱：CogView-3-Flash 只有固定几档（768x1344 等）；GLM-Image 推荐 1056x1568；CogView-4 任意分辨率
  const SIZE_PRESETS_BY_PROVIDER = {
    ark: [
      { v: "1728x2304", label: "竖版立绘 3:4（推荐）" },
      { v: "2048x2048", label: "方形 2048" },
      { v: "3072x3072", label: "4K 方形（最贵）" },
    ],
    zhipu: [
      { v: "1056x1568", label: "竖版立绘 3:4（GLM-Image 推荐）" },
      { v: "768x1344", label: "竖版（免费档也能用）" },
      { v: "1024x1024", label: "方形 1024（三档都支持）" },
      { v: "864x1152", label: "竖版 3:4（小图，更省）" },
    ],
    siliconflow: [
      { v: "1024x1024", label: "方形 1024（推荐）" },
      { v: "768x1024", label: "竖版 3:4" },
      { v: "1024x768", label: "横版 4:3" },
    ],
    modelscope: [
      { v: "1024x1024", label: "方形 1024（推荐）" },
      { v: "768x1024", label: "竖版 3:4" },
      { v: "1024x768", label: "横版 4:3" },
    ],
    bailian: [
      { v: "1024x1024", label: "方形 1024（推荐）" },
      { v: "768x1152", label: "竖版 2:3" },
      { v: "1152x768", label: "横版 3:2" },
    ],
  };
  function sizePresetsFor(provider) { return SIZE_PRESETS_BY_PROVIDER[provider] || SIZE_PRESETS; }
  const AI_BASE = "https://api.deepseek.com";
  const AI_MODEL = "deepseek-v4-flash";

  /* ---------- 小工具 ---------- */
  function hashStr(s) {
    let h = 2166136261;
    s = String(s || "");
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function pick(arr, seed) { return arr[seed % arr.length]; }
  // v159：seed 雪崩混合（murmur3 fmix32）
  //   背景：hashStr 是 FNV-1a，最后一步只异或一个字符 → 差异几乎全落在最低位。
  //   于是「固定前缀 + 单字符递增后缀 + 小池取模」会退化成固定模式：
  //   "#chap#0"~"#chap#7" 的 h%2 恒为 10101010 或 01010101，导致 8 章只有 2 套组合。
  //   ⚠️ 不要改 hashStr 本身 —— 它同时决定所有精灵的外观/性别，
  //      改动会让已出立绘与新外观对不上。只在「小池 + 短后缀」处套 mixSeed。
  function mixSeed(h) {
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 3266489909) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function todayKey() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
  }
  // 配额超限时尽量保住最新一张立绘：丢 CG、裁历史/日记/来信，腾出空间再存一次，
  // 避免「存不进去 → 下次判过期 → 又重出图烧额度」的死循环
  function pruneForQuota(o) {
    try {
      Object.keys(o).forEach((k) => {
        const r = o[k];
        if (!r || typeof r !== "object") return;
        if (r.cgUrl) r.cgUrl = "";
        if (Array.isArray(r.imgHistory)) r.imgHistory = r.imgHistory.slice(-1);
        if (Array.isArray(r.diary)) r.diary = r.diary.slice(-8);
        if (Array.isArray(r.letters)) r.letters = r.letters.slice(-5);
        if (Array.isArray(r.echoes)) r.echoes = r.echoes.slice(-5);     // v155：回响信也一起瘦身
        if (r.replies && typeof r.replies === "object") {               // v155：日记回信只留最近 10 条
          const ks = Object.keys(r.replies).sort();
          while (ks.length > 10) delete r.replies[ks.shift()];
        }
        if (r.fests && typeof r.fests === "object") {                   // v158：节令记录只留最近 8 个
          const ks = Object.keys(r.fests).sort();
          while (ks.length > 8) delete r.fests[ks.shift()];
        }
        if (r.night && Array.isArray(r.night.log)) r.night.log = r.night.log.slice(-150);   // v160：夜话聊天记录瘦身
      });
    } catch (e) { /* 忽略 */ }
    return o;
  }
  function save(o) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(o));
      // 通知同步层：本地精灵数据变了，稍后推到云端（跨手机同步用）
      try { window.__spiritsDirty = true; window.dispatchEvent(new CustomEvent("ww:spirits-changed")); } catch (e2) { /* 忽略 */ }
    } catch (e) {
      const quota = e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
      if (quota) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(pruneForQuota(o))); return; } catch (e2) { /* 仍失败 */ }
      }
      // 实在存不下：通知界面（别再静默重试烧额度）
      try { window.dispatchEvent(new CustomEvent("ww:storage-full", { detail: { key: STORE_KEY } })); } catch (e3) { /* 忽略 */ }
    }
  }
  function ensureIn(store, id) {
    if (!store[id]) {
      // 新生：性别留空，等「挂瓷成精」那一刻由 born() 掷一次（男女 3:1）
      store[id] = { persona: null, variant: 0, imgUrl: "", letters: [], chats: [], lastLetterDay: "", stage: 1, imgHistory: [], gender: "", bornAt: 0 };
      return store[id];
    }
    const rec = store[id];
    if (rec.stage == null) rec.stage = 1;              // 老数据兼容：默认幼生期
    if (!Array.isArray(rec.imgHistory)) rec.imgHistory = [];
    // 老记录（v110 之前成精的）没有 gender：按**旧规则**（hash(串id+外观种子)）定下来，
    // 这样它已经画好的立绘和界面显示的人设不会打架；新精灵一律走 born() 的 3:1 随机
    if (rec.gender !== "boy" && rec.gender !== "girl") rec.gender = legacyGender(id, rec.appearanceSeed || 0);
    return rec;
  }
  // 性别：出生时掷一次，比例 男:女 = 3:1（用户要求）
  function rollGender(seedStr) { return (hashStr(String(seedStr || "")) % 4 !== 0) ? "boy" : "girl"; }
  // v107~v109 的旧规则（2/3 男孩），只用于给老记录"定档"
  function legacyGender(id, seedN) { return (hashStr(String(id || "") + "#" + (seedN || 0)) % 3) !== 0 ? "boy" : "girl"; }
  // 挂瓷成精：给这只精灵"定性别"，之后不可更改（重复调用不会改性别）
  function born(item) {
    const store = load();
    const rec = ensureIn(store, item.id);
    let isNew = false, gender = rec.gender;
    if (!rec.bornAt) {
      rec.bornAt = Date.now();
      if (rec.gender !== "boy" && rec.gender !== "girl") {
        rec.gender = rollGender(String(item.id));
        isNew = true;
        rec.persona = null;        // 新生：性格 / 人物设定按定下来的性别重新写
        rec.personaZh = null;
        rec.personaZhKey = "";
      }
      save(store);
      gender = rec.gender;
    } else save(store);
    return { isNew: isNew, gender: gender, bornAt: rec.bornAt };
  }

  /* ---------- 外观锚点（v104）：每只精灵有固定人设，所有形态共享，突破不会变性/变色 ---------- */
  // 发型**按性别分池**（v108）：以前男女共用一张表，结果男孩抽到 "long straight" / "twin tails"
  // → 男孩顶着双马尾（用户实测吐槽）。现在男孩只有短发池，女孩只有长发/双马尾池。
  const BOY_HAIR = ["short spiky", "short neat and tidy", "messy short hair with bangs", "short hair with a side part",
    "short fluffy hair", "buzz cut with a small tuft"];
  const GIRL_HAIR = ["long straight", "twin tails", "shoulder-length bob", "long wavy hair", "high ponytail", "twin braids"];
  const HAIR_STYLES = BOY_HAIR.concat(GIRL_HAIR);        // 兼容：仍导出全表
  const EYE_COLORS = ["amber", "sky blue", "violet", "deep brown", "emerald", "golden"];
  const ACCESSORIES = ["a small shell hairpin", "a silk scarf", "a single round earring", "a forehead bead band",
    "a bead bracelet on the wrist", "a hair ribbon", "a tiny bell charm", "a wooden pendant"];
  const ACCESSORIES2 = ["a waist pouch of woven cord", "a tiny bead tassel at the collar", "a thin leather bracelet",
    "a small jade toggle on the sash", "a short beaded necklace", "a cloth arm band", "a tiny pouch of dried petals",
    "a knotted cord belt charm"];
  const VIBES = ["calm and reliable", "cheerful and talkative", "quiet and thoughtful", "playful and mischievous",
    "gentle and caring", "cool and a little proud"];
  /* ---------- v112：让立绘"不只靠颜色"——服装 / 纹样 / 布料 / 道具 / 姿态 ---------- */
  const OUTFITS = [
    { en: "a crossed-collar Chinese hanfu robe with wide sleeves and a cloth sash", zh: "交领长袍 + 宽布腰带" },
    { en: "a round-collar Chinese robe (yuanlingpao) with a leather belt", zh: "圆领袍 + 革带" },
    { en: "a straight-hem deep robe (shenyi) with a layered collar", zh: "直裾深衣 + 层叠领" },
    { en: "a traditional Chinese tang-style jacket with frog buttons and a stand collar", zh: "中式对襟褂 + 盘扣立领" },
    { en: "an embroidered Chinese front-button jacket with cloud-patterned trim", zh: "绣花对襟褂 + 云纹滚边" },
    { en: "a wide-sleeved Chinese Taoist robe with hanging ties", zh: "大袖道袍 + 系带" },
    { en: "a plain wrap-front Chinese top with a cloth waist wrap", zh: "素色裹襟上衣 + 布腰封" },
    { en: "a short-sleeve Chinese beizi vest layered over a long robe", zh: "半臂褙子 + 长衫内搭" },
    { en: "a martial-arts style short Chinese tunic with a waist sash", zh: "短打劲装 + 束腰" },
    { en: "a brocade-trimmed Chinese robe with a jade toggle", zh: "织锦长袍 + 玉扣" },
  ];
  const PATTERNS = [
    { en: "cloud motif", zh: "云纹" }, { en: "meander key-fret pattern", zh: "回纹" },
    { en: "rippling wave lines", zh: "水波" }, { en: "lotus scroll pattern", zh: "缠枝莲" },
    { en: "roundel medallion pattern", zh: "团花" }, { en: "ruyi motif", zh: "如意纹" },
  ];
  // v154：纹样改「人设优先，池子兜底」（用户反馈：设定里明明写了「衣服也有芭蕉叶的纹样」，
  //   详情页却仍挂着随机抽到的「水波」，标签和人设正文都被随机纹样带偏了）。
  //   规则：用户自己写的设定（一句话 / 自己填的特征）里只要提到纹样，就照用户写的来；
  //   没提到，才用上面这个池子按种子随机抽（保持原本的随机感）。
  const PATTERN_STOP = "，,、。；;：:！!？?（）()「」《》　 的了也都有是用带绣做配加和与及就还又再满全最挺着一件条把被给对向从在到跟比像很太更没不无把以于而其之都" +
    "缀嵌镶描绘刻勾题印染织滚钉镂掐堆贴缚束裹缠压叠铺衬领口肩袖襟摆裙裤衫袜鞋";
  // 从一段中文里找「用户写的纹样」。例：衣服也有芭蕉叶的纹样 → 芭蕉叶
  function patternFromText(text) {
    const s = String(text || "");
    if (!s) return null;
    // ① 常见同义写法先认到池子里（「回字纹」=回纹、「祥云」=云纹…），这样能拿到现成的英文
    //     ⚠️ 必须先跑这里、再跑下面的池子扫描：否则「如意云纹」会被通用的「云纹」抢走
    //     ⚠️ 顺序也有讲究：越具体的写法放前面，「云纹」这种最泛的放最后
    const ALIAS = [
      [/回字纹|回形纹|回纹/, 1], [/水波纹|波浪纹|水浪纹|水纹/, 2],
      [/宝相花|团花纹/, 4], [/缠枝莲|缠枝纹|缠枝/, 3],
      [/如意云纹|如意纹|如意头/, 5], [/祥云|云头纹|云气纹|云纹/, 0],
    ];
    for (let i = 0; i < ALIAS.length; i++) {
      if (ALIAS[i][0].test(s)) { const p = PATTERNS[ALIAS[i][1]]; return { en: p.en, zh: p.zh }; }
    }
    // ①b 用户直接点名了池子里的纹样（云纹 / 回纹 / 水波 / 缠枝莲 / 团花 / 如意纹）
    for (let i = 0; i < PATTERNS.length; i++) {
      if (s.indexOf(PATTERNS[i].zh) >= 0) return { en: PATTERNS[i].en, zh: PATTERNS[i].zh };
    }
    // ② 自定义纹样：先定位「纹样 / 花纹 / 图案 / 纹理 / 暗纹 / 纹」，再往回取紧邻的中文名
    const m = s.match(/(纹样|花纹|图案|纹理|暗纹|纹)/);
    if (!m) return null;
    let i = m.index - 1;
    if (i >= 0 && s.charAt(i) === "的") i--;                 // 跳过「的」
    let core = "";
    while (i >= 0 && core.length < 4) {
      const ch = s.charAt(i);
      if (PATTERN_STOP.indexOf(ch) >= 0) break;              // 碰到虚词/标点就停，避免把整句抓进来
      core = ch + core;
      i--;
    }
    // 去掉开头的数量词（「大朵牡丹」→「牡丹」），但别碰「六角纹」这种连数字都算名字的
    core = core.trim().replace(/^[大小多少几]{1,2}(?:朵|片|条|块|枚|颗|粒)?/, "").trim();
    if (!core || /^(一|个|种|些|这|那|它|我|你|他|她)$/.test(core)) return null;
    // 池子里没有对应英文 → 中文原文直接进 prompt（和「自己填特征」同一套做法，绘图模型看得懂中文描述）
    return { en: "", zh: core + "纹样" };
  }
  // 用户在向导里「自己填」的特征原文（"custom:xxx"）
  function userFeatText(lk) {
    const ids = (lk && Array.isArray(lk.feats)) ? lk.feats : [];
    return ids.filter((x) => String(x).indexOf("custom:") === 0).map((x) => String(x).slice(7)).join("；");
  }
  // 用户自己写的设定里提到的纹样（**只用用户原话**，不扫 AI 扩写正文，免得把 AI 编的纹样也当成用户要求）
  function userPattern(lk) { return patternFromText(lk && lk.base) || patternFromText(userFeatText(lk)); }
  const MATERIALS = ["matte cotton-linen", "plain silk", "lustrous satin brocade", "woven brocade", "gauzy silk", "ramie"];
  const MATERIALS_ZH = { "matte cotton-linen": "棉麻", "plain silk": "素绢", "lustrous satin brocade": "丝光锦缎", "woven brocade": "织锦", "gauzy silk": "轻罗纱", "ramie": "苎麻" };
  const PROPS = [
    "holding a small tea cup", "carrying a tiny wooden tray", "holding a round Chinese silk fan painted with ink orchids",
    "holding a small paper lantern", "carrying a little woven basket", "holding a sprig of blossoms",
    "holding a slim wooden scroll", "holding a small cloth pouch",
  ];
  const PROPS_ZH = {
    "holding a small tea cup": "捧着茶杯", "carrying a tiny wooden tray": "端着木托盘", "holding a round Chinese silk fan painted with ink orchids": "拿着中式团扇（墨兰）",
    "holding a small paper lantern": "提着小灯", "carrying a little woven basket": "挎着小竹篮", "holding a sprig of blossoms": "拿着一枝花",
    "holding a slim wooden scroll": "握着卷轴", "holding a small cloth pouch": "拎着布囊",
  };
  // 姿态池（v152）：全面中式化并扩充到 16 种 —— 中国古风仪态（作揖/拱手/拂袖/执笔/捻珠/团扇…），
  //   去掉「挥手打招呼」「抬手比划说话」这类偏现代随意的动作；不含 wink / 剪刀手 / 坏笑。
  //   ⚠️ 姿态**不再是系统锁定的属性**（用户要求：动作按人设自由发挥）——
  //   这里只作为「中式仪态候选表」，喂给 buildLookTags 做参考，避免 AI 写出日式/现代手势。
  //   ⚠️ 用 {en,zh} 成对定义再各自 map，保证中英顺序绝不跑偏。
  const POSES_CAT = [
    { en: "performing a traditional Chinese cupped-fist salute (gongshou, hands clasped together in front), respectful warm smile", zh: "作揖抱拳、恭敬含笑" },
    { en: "bowing the upper body forward slightly with hands clasped in a traditional Chinese zuoyi bow, courteous and gentle", zh: "欠身作揖、彬彬有礼" },
    { en: "standing calmly with both hands folded inside wide crossed sleeves, gentle closed-lip smile", zh: "双手拢袖、端静含笑" },
    { en: "lifting one long flowing sleeve with a hand as if about to bow, graceful classical courtesy", zh: "拂袖致意、仪态端雅" },
    { en: "head slightly tilted with hands behind the back, gaze a little off to the side, soft shy smile", zh: "背手歪头、眼神偏一点" },
    { en: "both hands cupped holding a small cup, warm soft expression, relaxed shoulders", zh: "双手捧盏、神情温柔" },
    { en: "holding a round Chinese silk fan half in front of the face, smiling eyes", zh: "团扇半遮面、眼含笑意" },
    { en: "fingering a string of prayer beads with softly lowered eyes, serene and calm", zh: "低眸捻珠、静气凝神" },
    { en: "holding a writing brush as if about to write, focused gentle expression", zh: "执笔欲书、神情专注" },
    { en: "unfolding a scroll with both hands to read, curious soft smile", zh: "双手展卷、微带好奇" },
    { en: "arms lightly crossed with the chin slightly raised, confident dignified half-smile", zh: "抱臂微抬下巴、自信含笑" },
    { en: "sitting neatly with legs folded to one side, hands resting on the knees, serene classical posture", zh: "侧身敛坐、据膝安然" },
    { en: "one hand resting on the other sleeve, composed and dignified, gazing steadily forward", zh: "一手抚袖、端立凝望" },
    { en: "raising one hand in a quiet graceful Chinese greeting with the sleeve flowing down, subtle warm smile", zh: "抬袖轻招、温然一笑" },
    { en: "half-turned glancing back over the shoulder with the sleeve flowing, light elegant stance", zh: "回眸拂袖、身姿轻盈" },
    { en: "standing quietly in profile with hands clasped in front, gazing into the distance, faint serene smile", zh: "侧身远望、静默含笑" },
  ];
  const POSES = POSES_CAT.map((x) => x.en);
  const POSES_ZH = POSES_CAT.map((x) => x.zh);
  // 全局负面约束：中国传统文玩调性——不要日式元素、不要现代/西式服装、不要剪刀手/坏笑/wink，并禁止肢体画错
  const NEG_STYLE = "traditional Chinese styling only, strictly no Japanese elements (Japanese flag, rising sun motif, kimono, yukata, torii gate, paper fan with red circle), " +
    "strictly no modern or Western clothing (no jacket, no hoodie, no sweatshirt, no T-shirt, no jeans, no denim, no sportswear, no tracksuit, no suit and tie, no sneakers, no zipper coat), " +
    "no peace sign or V-sign hand gestures, no smirking or mischievous grin, no winking, no playful winks, no exaggerated cartoon expressions, " +
    "strictly no anatomy errors (no third arm, no extra hand, no extra fingers, no missing limb, no deformed or fused hands), " +
    "use gentle neutral expressions and ancient Chinese hanfu-inspired costume";
  // v152 全局解剖安全约束：出图模型常把手指/手臂画错（三只手、六指），每次出图都带上
  const ANATOMY = "strictly correct human anatomy, exactly two arms and two hands, five fingers per hand, " +
    "simple clear hand shapes, both hands resting naturally and unobstructed, " +
    "no extra limbs, no extra hands, no extra fingers, no hidden overlapping arms, no detached floating hand";
  // v150 全局正面风格约束：所有精灵统一「中国古风」（用户要求：整个 App 是中国传统文玩调性）
  const GUOFENG = "traditional Chinese gufeng (ancient Chinese dynasty) aesthetic, hanfu-inspired classical costume and hairstyle " +
    "(long flowing hair, hair buns, hairpins, braids and ponytails are all traditional and fine), " +
    "elegant ancient Chinese atmosphere, silk and brocade textures, classical Chinese color palette, no modern elements";
  // 中文说法（界面用；prompt 仍用英文原文）
  const HAIR_ZH = {
    "short spiky": "利落短发", "short neat and tidy": "清爽短发", "messy short hair with bangs": "蓬松碎短发",
    "short hair with a side part": "侧分短发", "short fluffy hair": "柔软短发", "buzz cut with a small tuft": "寸头 + 小揪揪",
    "long straight": "黑长直", "twin tails": "双马尾", "shoulder-length bob": "齐肩短发", "long wavy hair": "长卷发",
    "high ponytail": "高马尾", "twin braids": "双麻花辫",
  };
  const EYES_ZH = { amber: "琥珀色", "sky blue": "天蓝色", violet: "紫罗兰色", "deep brown": "深棕色", emerald: "翠绿色", golden: "金色" };
  const ACC_ZH = {
    "a small shell hairpin": "贝壳小发夹", "a silk scarf": "丝巾", "a single round earring": "单颗圆耳饰",
    "a forehead bead band": "额头珠链（手串同款珠子）", "a bead bracelet on the wrist": "手腕上的珠子手链",
    "a hair ribbon": "发带", "a tiny bell charm": "小铃铛挂饰", "a wooden pendant": "木质吊坠",
  };
  const ACC2_ZH = {
    "a waist pouch of woven cord": "编织腰囊", "a tiny bead tassel at the collar": "领口小珠穗",
    "a thin leather bracelet": "细皮手环", "a small jade toggle on the sash": "腰带上小玉扣",
    "a short beaded necklace": "短串珠项链", "a cloth arm band": "布护腕",
    "a tiny pouch of dried petals": "干花瓣小香囊", "a knotted cord belt charm": "绳结腰挂",
  };
  const VIBE_ZH = {
    "calm and reliable": "沉静可靠", "cheerful and talkative": "活泼话多", "quiet and thoughtful": "安静爱想事情",
    "playful and mischievous": "调皮爱闹", "gentle and caring": "温柔体贴", "cool and a little proud": "有点酷、有点傲娇",
  };
  // 由「串 id + 外观种子」决定；外观种子只在用户点「换外观设定」时变
  // 性别**不参与**随机：它由「挂瓷成精」那一刻的 born() 定下来（男女 3:1），之后换外观/突破都不会变
  function appearanceOf(item, seedN, gender, lkHint) {
    const h = hashStr(String((item && item.id) || "") + "#" + (seedN || 0));
    const g = (gender === "boy" || gender === "girl") ? gender
      : (item && item.gender === "boy" || item && item.gender === "girl") ? item.gender
      : rollGender((item && item.id) || "");        // 兜底：老记录/未成精时按 id 稳定掷一次
    const hairs = g === "boy" ? BOY_HAIR : GIRL_HAIR;
    const vi = (h >> 12) % VIBES.length;
    const pi = (h >> 8) % POSES.length;       // v152：姿态与性格解耦（姿态池可独立扩充）
    const out = {
      gender: g,
      hair: hairs[(h >> 3) % hairs.length],
      eyes: EYE_COLORS[(h >> 6) % EYE_COLORS.length],
      acc: ACCESSORIES[(h >> 9) % ACCESSORIES.length],
      acc2: ACCESSORIES2[(h >> 15) % ACCESSORIES2.length],
      outfit: OUTFITS[(h >> 18) % OUTFITS.length].en,
      outfitZh: OUTFITS[(h >> 18) % OUTFITS.length].zh,
      pattern: PATTERNS[(h >> 21) % PATTERNS.length].en,
      patternZh: PATTERNS[(h >> 21) % PATTERNS.length].zh,
      material: MATERIALS[(h >> 24) % MATERIALS.length],
      prop: PROPS[(h >> 26) % PROPS.length],
      pose: POSES[pi],
      poseIdx: pi,
      vibe: VIBES[vi],
      vibeIdx: vi,
    };
    // v154：纹样「人设优先，池子兜底」—— 用户设定里写了纹样就覆盖随机抽到的那个
    //   （lkHint 由 lookOf 直接传进来，省一次 localStorage 解析）
    const lk = lkHint || ((item && item.id) ? (((load()[item.id] || {}).look) || {}) : {});
    const ov = userPattern(lk);
    if (ov) { out.pattern = ov.en || ov.zh; out.patternZh = ov.zh; out.patternSrc = "user"; }
    return out;
  }
  function appearanceText(ap) {
    // v152：**不再锁死姿态**（用户反馈：别限定动作，姿态由「人物设定」自由发挥，效果更好）。
    //   这里只锚定 性别 / 瞳色 / 配饰 / 服装 / 纹样 / 布料；发型与姿态都交给人物设定。
    return (ap.gender === "boy" ? "👦 男孩" : "👧 女孩") + " · " +
      (EYES_ZH[ap.eyes] || ap.eyes) + "眼睛 · " + (ACC_ZH[ap.acc] || ap.acc) +
      " · " + (ap.outfitZh || ap.outfit) + " · " + (ap.patternZh || (ap.pattern + " 纹样")) +
      " · " + (MATERIALS_ZH[ap.material] || ap.material);
  }
  // 形象细节条（详情页给人看的一行短描述）
  function appearanceDetail(ap) {
    return (ACC2_ZH[ap.acc2] || ap.acc2) + " · " + (PROPS_ZH[ap.prop] || ap.prop) + " · " +
      (MATERIALS_ZH[ap.material] || ap.material) + " · " + (VIBE_ZH[ap.vibe] || ap.vibe);
  }
  function appearancePrompt(ap) {
    const isBoy = ap.gender === "boy";
    // v151/v152：**不再锁死发型、也不再锁死姿态**（用户反馈：中式古风不该锁发型，动作也别限定，按人设出更好）。
    //   这里只锚定：性别 + 瞳色 + 配饰 + 服装 + 纹样 + 布料；
    //   发型与姿态完全交给「人物设定」—— buildLookTags 会把设定里的细节翻成英文关键词进 prompt。
    return (isBoy
      ? "a young boy character, clearly male, boyish face: "
      : "a young girl character, clearly female, girlish face: ") +
      ap.eyes + " eyes, wearing " + ap.acc + " and " + ap.acc2 + ", " +
      "outfit: " + ap.outfit + ", trimmed with " + ap.pattern + ", " + ap.material + " fabric texture" +
      (ap.prop ? ", " + ap.prop : "") + ", " + ap.vibe + " personality";
  }
  // 一致性硬约束：每次出图都带上，防止突破后"换人"
  // ⚠️ 这里曾经写过 "character evolution sheet"（进化图鉴）→ 模型真的画成了**多格图鉴**：
  //    一张图里两只角色、还自己写上 NEWBORN / YOUNG BOY 标题字（用户实测截图）。所以现在反过来：
  //    明确"只画一个人、不许画分格、不许写字"，见 SINGLE。
  const CONSISTENCY = "same character across all ages, keep exactly the same gender, same hair style and hair color, " +
    "same eye color, same accessory and same overall design, only grow older, " +
    "consistent character design, do not change gender, do not change identity";
  // 只画一个人 + 不许有文字
  // ⚠️ 连 "character sheet" / "turnaround" 这种词都别出现（哪怕写成 "no character sheet"）——
  //    实测这两个词一出现，模型就容易画成多格图鉴，所以整句里干脆不出现它们。
  const SINGLE = "solo, single character only, exactly one figure in the whole image, one person, plain simple background, " +
    "no other characters, no clones, no panels, no collage, no multiple views, no background characters, " +
    "no text, no letters, no words, no numbers, no title, no labels, no captions, no watermark, no signature, no logo";

  /* ---------- 进阶系统：四形态、三次突破（v103；v120 起"身形比例真的会长大"） ----------
     幼生期 → 成长期 → 觉醒期 → 完成体；成长值 = 盘玩次数×3 + 陪伴天数×1
     ⚠️ 用户反馈「突破过后不会一直都是那个 Q 版吧？」—— 查出来根因是**风格预设里写死了
        `cute chibi character / chibi proportion with slightly big head`，它对四个阶段都生效**，
        所以模型每次都画回 Q 版大头。现在把"肤色/线稿/上色"这类**画风**留在风格预设里，
        把"身高与头身比"全部挪到阶段描述里，并且明确写「比上一形态更高」→ 突破会真的长大。 */
  const STAGES = [
    {
      n: 1, name: "幼生期", icon: "🥚", need: 0, sizeZh: "约 2 头身（Q 版小宝宝）",
      look: "a tiny newborn baby version of the character, chibi proportions about 2 heads tall, " +
        "very small chubby body, big round head and tiny limbs, simple minimal details, " +
        "sleepy innocent eyes, just awakened, extremely cute and soft",
    },
    {
      n: 2, name: "成长期", icon: "🌱", need: 30, sizeZh: "约 4 头身（小孩子）",
      look: "a small child version of the character, noticeably taller than the newborn form, " +
        "child proportions about 4 heads tall, rounder face with bigger eyes, shorter limbs than an adult, " +
        "lively bright eyes, simple but neat outfit, energetic pose, still cute and round",
    },
    {
      n: 3, name: "觉醒期", icon: "⚡", need: 90, sizeZh: "约 6 头身（少年，变高变帅）",
      look: "a cool teenage version of the character, grown up and clearly taller with slim teenage proportions " +
        "about 6 heads tall, longer limbs, a more defined jawline, confident dynamic pose, " +
        "stylish detailed outfit, glowing aura and light particles, sharp determined eyes, cinematic lighting",
    },
    {
      n: 4, name: "完成体", icon: "👑", need: 180, sizeZh: "约 8.5 头身（成年，又帅又美）",
      look: "a stunning fully grown-up version of the same character, tall elegant fashion-model proportions " +
        "about 8.5 heads tall, long slim legs, sharp refined facial features, strikingly handsome and beautiful, " +
        "cool and glamorous presence, confident charismatic aura, magnificent ornate outfit with elegant flowing details, " +
        "cinematic rim lighting, subtle glowing accents, masterpiece quality, epic composition, breathtaking",
    },
  ];
  // 每次出图都带上：明确"这是同一个人的下一个年龄段，比上一形态更高更成熟"
  const GROWTH_LINE = "this is the same character at an older age than the previous stage, " +
    "keep the exact same face, hair color, eye color and accessories, only grow taller and more mature, " +
    "body proportions and height must change with the age described above, do not keep the baby proportions";
  function stageDef(n) { return STAGES[Math.min(STAGES.length, Math.max(1, Number(n) || 1)) - 1]; }
  // 成长值：盘一次 +3，陪伴一天 +1（days 由调用方用 DB.daysWith 传进来）
  function growthOf(item, days) {
    const plays = Number(item && item.playCount) || 0;
    const d = Number(days) || 0;
    return plays * 3 + d;
  }
  function stageInfo(item, stage, days) {
    const cur = Math.min(STAGES.length, Math.max(1, Number(stage) || 1));
    const growth = growthOf(item, days);
    const def = stageDef(cur);
    const next = STAGES[cur] || null;               // 下一形态（cur=4 时为 null）
    const canBreak = !!next && growth >= next.need;
    return {
      stage: cur, name: def.name, icon: def.icon, growth: growth,
      need: next ? next.need : def.need, next: next ? next.name : "",
      nextIcon: next ? next.icon : "",
      canBreak: canBreak,
      isMax: !next,
      pct: next ? Math.min(100, Math.round((growth / next.need) * 100)) : 100,
      toNext: next ? Math.max(0, next.need - growth) : 0,
    };
  }

  /* ---------- 绘图通道（默认免密钥；可切国内 API） ---------- */
  const PROVIDERS = {
    pollinations: { label: "免密钥 · Pollinations（只有 sana 小模型，风格不稳）", keyless: true },
    zhipu: { label: "智谱 CogView（约 ¥0.06/张 · 最便宜）", endpoint: "https://open.bigmodel.cn/api/paas/v4/images/generations", model: "cogview-4" },
    siliconflow: { label: "硅基流动 SiliconFlow（注册送额度，出图快）", endpoint: "https://api.siliconflow.cn/v1/images/generations", model: "Kwai-Kolors/Kolors" },
    ark: { label: "火山方舟 豆包 Seedream（flash 约 ¥0.13/张，最划算）", endpoint: "https://ark.cn-beijing.volces.com/api/v3/images/generations", model: "doubao-seedream-5-0-flash-260915" },
    modelscope: { label: "魔搭 ModelScope（每日免费额度）", endpoint: "https://api-inference.modelscope.cn/v1/images/generations", model: "Qwen/Qwen-Image" },
    bailian: { label: "阿里百炼 通义万相（浏览器直连受限，不推荐）", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/images/generations", model: "wan2.6-t2i" },
    custom: { label: "自定义（OpenAI 兼容）", endpoint: "", model: "" },
  };
  // 各家能接受的尺寸不一样：被服务端拒了就按这份清单依次退让（不是限制用户，只是自动救场）
  const SIZE_BY_PROVIDER = {
    ark: ["1728x2304", "2048x2048", "3072x3072"],
    zhipu: ["1056x1568", "768x1344", "1024x1024"],          // 见 SIZE_PRESETS_BY_PROVIDER：三档都能用的尺寸优先
    siliconflow: ["1024x1024", "768x1024", "1024x768"],
    modelscope: ["1024x1024", "768x1024", "1024x768"],
    bailian: ["1024x1024", "768x1152", "1152x768"],
  };
  const SIZE_DEFAULT_LADDER = ["1728x2304", "2048x2048", "1024x1024"];
  function sizeLadderFor(provider) { return SIZE_BY_PROVIDER[provider] || SIZE_DEFAULT_LADDER; }
  /* ---------- v125：CG 一律用**横版**（用户要求：CG 要横构图，像动画截图 / 电影感） ----------
     立绘仍然是竖版（全身站姿），只有 CG（觉醒期/完成体专属插画、两只精灵的事件插画）走横版。
     注意：方舟 Seedream 要求 ≥ 3686400 像素，所以横版首选 2304x1728（4:3，398 万像素，稳过）。 */
  const CG_SIZE_BY_PROVIDER = {
    ark: ["2304x1728", "2560x1440", "2048x2048", "1024x1024"],
    zhipu: ["1568x1056", "1472x1088", "1024x1024"],                 // GLM-Image 官方支持的横版档
    siliconflow: ["1024x768", "1024x1024"],
    modelscope: ["1024x768", "1024x1024"],
    bailian: ["1152x768", "1024x1024"],
  };
  const CG_SIZE_DEFAULT_LADDER = ["2304x1728", "2560x1440", "1536x1024", "1024x768", "1024x1024"];
  function cgLadderFor(provider) { return CG_SIZE_BY_PROVIDER[provider] || CG_SIZE_DEFAULT_LADDER; }
  function cgSizeFor(provider) { return cgLadderFor(provider)[0]; }
  /* ---------- 图生图（带参考图）支持情况 ----------
     实测/查文档结论：
       · ark（Seedream 5.0 flash/lite/pro）：**支持** `image` 字段，参考图不额外收费
       · zhipu（GLM-Image / CogView-4 / CogView-3-Flash）：**不支持** ——
         官方 OpenAPI 的图像生成请求体只有 model/prompt/quality/size/watermark_enabled/user_id，
         它家能"吃图"的只有视觉理解模型（GLM-4V 等，能看图不能画图）和图生视频（CogVideoX-3）
       · 其它家（硅基流动/魔搭/百炼/自定义）：官方没明说 → **自动试一次**，不支持就自动去掉并记住
     注意：不支持不等于"换人"，性别/发型/瞳色/配饰/服装/阶段都写死在 prompt 里（文本锚点）。 */
  const REF_SUPPORT = { ark: "yes", zhipu: "no", pollinations: "no", siliconflow: "try", modelscope: "try", bailian: "try", custom: "try" };
  const REF_TEXT = {
    yes: "✅ 支持（突破/换形象会带上一张立绘做参考，参考图不加钱）",
    no: "❌ 不支持（官方 API 没有参考图字段，会自动退回「文字锚点」，不会变性换人）",
    try: "🤔 官方没写明 → 会自动带上试一次，不支持就自动去掉（并按这家记住）",
  };
  function refSupportOf(provider) { return REF_SUPPORT[provider] || "try"; }
  function refSupportText(provider) { return REF_TEXT[refSupportOf(provider)] || REF_TEXT.try; }
  /* ---------- 各家 API Key 长什么样（填错是最高频的坑） ----------
     用户最容易踩的：火山方舟控制台里那串 `api-key-20260927150936` 是密钥**名称**，
     真正的密钥要点「复制 / 👁 显示」才看得到，形如 `ark-xxxxxxxx-…`。 */
  const KEY_UI_HINT = {
    ark: "方舟：要填 <b>ark- 开头</b>的那一串（形如 <code>ark-8位-4位-4位-4位-12位</code>，有些末尾还会多一小段如 <code>-69485</code>）。控制台里显示的 <code>api-key-2026…</code> 是密钥的<b>名称</b>；密钥那行显示成 <code>ark-xxxxxxxx-…</code> 是<b>截断显示</b> → 一定要点右边的「📋 复制」整串复制，别手选文字。",
    zhipu: "智谱：形如 <code>xxxxxxxx.yyyyyyyy</code>（<b>中间有一个点</b>），在「API Keys」页面点复制即可。",
    siliconflow: "硅基流动：<b>sk- 开头</b>的一长串。",
    modelscope: "魔搭：在「访问令牌 / SDK 令牌」页面复制，一般以 <code>ms-</code> 开头。",
    bailian: "阿里百炼：<b>sk- 开头</b>（不推荐用浏览器直连，容易跨域失败）。",
    custom: "按你用的服务商文档复制（OpenAI 兼容接口一般是 sk- 开头）。",
    pollinations: "免密钥通道不用填 key。",
  };
  function keyUiHint(provider) { return KEY_UI_HINT[provider] || KEY_UI_HINT.custom; }
  // 各家「常用模型」一键填入（省得去控制台抄 ID）。价格按官方/公开报价标注，会变，仅供参考。
  const MODEL_PICKS = {
    ark: [
      { id: "doubao-seedream-5-0-flash-260915", note: "flash · 约 ¥0.13/张 · 最快最省（推荐）" },
      { id: "doubao-seedream-5-0-lite-260128", note: "lite · 约 ¥0.22/张 · 可出 4K" },
      { id: "doubao-seedream-5-0-pro-260628", note: "pro · 更贵 · 分层/精细编辑" },
    ],
    zhipu: [
      { id: "glm-image", note: "智谱新旗舰 · 约 ¥0.1/张 · 比火山便宜，画质更好（推荐）" },
      { id: "cogview-4", note: "约 ¥0.06/张 · 最便宜的付费档" },
      { id: "cogview-3-flash", note: "flash · **完全免费**（智谱官方免费模型）" },
    ],
    siliconflow: [{ id: "Kwai-Kolors/Kolors", note: "注册送额度 · 出图快" }],
    modelscope: [{ id: "Qwen/Qwen-Image", note: "每日免费额度" }],
    bailian: [{ id: "wan2.6-t2i", note: "通义万相" }],
  };

  function getImageCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && o.provider) {
        // 老配置里的 "2K"/"1K" 简写在不同模型上含义不同（有的当成 1024x1024 → 报"像素不够"）
        // → 读到就顺手迁成明确的宽×高
        if (o.size === "2K" || o.size === "1K" || o.size === "4K") {
          o.size = DEFAULT_SIZE;
          try { localStorage.setItem(CFG_KEY, JSON.stringify(o)); } catch (e2) { /* 忽略 */ }
        }
        return o;
      }
    } catch (e) { /* 忽略 */ }
    return { provider: "pollinations", key: "", model: "", endpoint: "", style: DEFAULT_STYLE, size: DEFAULT_SIZE };
  }
  function setImageCfg(cfg) { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* 忽略 */ } }
  function providerInfo(cfg) {
    const p = PROVIDERS[cfg.provider] || PROVIDERS.pollinations;
    return {
      provider: cfg.provider || "pollinations",
      label: p.label,
      endpoint: cfg.endpoint || p.endpoint || "",
      model: cfg.model || p.model || "",
      keyless: !!p.keyless,
      key: cfg.key || "",
    };
  }
  // 「已经自动修正过」的记忆要**按服务商分开记**：
  // 否则给智谱关掉参考图之后，再切回方舟也会被一起关掉（方舟本来是支持图生图的）
  const _fixed = { noRef: {}, noWatermark: {}, autoModel: {} };
  function fixedOf(kind, key) { return !!_fixed[kind][key || "?"]; }
  function markFixed(kind, key) { _fixed[kind][key || "?"] = true; }

  /* ---------- 风格预设（默认 = 日漫风，用户明确要求） ---------- */
  // anime   = 日漫风 Q 版角色（像用户参考图那种 2D 日漫手绘、赛璐璐上色）
  // animepet= 日漫风小生物（宝可梦那种原创生物）
  // flat    = 扁平贴纸风   ink = 国风水墨
  const STYLE_PRESETS = {
    anime: {
      label: "国风 · 2D 人物",
      // ⚠️ 这里**不能**写 chibi / big head：那是"身形比例"，必须交给阶段描述（STAGES.look），
      //    否则突破到觉醒期/完成体也还是 Q 版大头（用户实测吐槽过）。
      // v150：整体基调改为「中国古风」——用户要求所有精灵都画成古风（汉服/古装），不要现代/日式元素。
      text: "2D hand-drawn illustration in traditional Chinese gufeng style, ancient Chinese hanfu costume and classical styling, " +
        "big expressive eyes with white highlights, cel shading, flat coloring, clean line art, " +
        "soft elegant Chinese classical color palette, soft blush, " +
        "richly detailed traditional Chinese outfit with visible fabric folds and silk brocade texture, classical Chinese ornaments, " +
        "expressive pose with personality, full body, centered composition, plain solid soft background, " +
        "hand-drawn 2D art, no 3D render, no realistic photo, no gradient mesh, no modern clothing, no Japanese styling",
    },
    animepet: {
      label: "日漫风 · 小生物",
      text: "anime style cute mascot creature, original pokemon-like creature design, cel shading, flat anime coloring, " +
        "clean bold line art, big anime eyes with white highlight, tiny smile, small cute ears, round soft body, " +
        "full body, centered composition, plain solid pastel background, hand-drawn 2D anime, kawaii, " +
        "no 3D render, no realistic face, no human, no photo",
    },
    flat: {
      label: "扁平贴纸风",
      text: "flat 2D illustration, clean bold dark outlines, flat colors with almost no shading or gradient, " +
        "pastel palette, simple round eyes, tiny smile, tiny blush, sticker art, minimal geometric shapes, " +
        "centered composition, plain solid pastel background, cute mascot creature, character fills the frame, " +
        "no shading, no gradient, no 3D render, no realistic face, no human, no photo",
    },
    ink: {
      label: "国风水墨",
      text: "Chinese ink painting style, xieyi brush strokes, minimal color wash, elegant negative space, " +
        "cute small spirit creature, 2D illustration, rice paper texture, centered, plain background, no 3D, no photo",
    },
  };
  const DEFAULT_STYLE = "anime";
  function styleOf(item, styleKey) { return STYLE_PRESETS[styleKey] || STYLE_PRESETS[DEFAULT_STYLE]; }

  /* ---------- 形象 prompt（颜色 + 软糯 + 风格预设） ---------- */
  const COLOR_EN = {
    white: "creamy white", green: "emerald green", yellowbrown: "warm golden brown",
    blackgray: "deep charcoal gray", duo: "vivid multicolored patches", lightflower: "soft pale pink",
    deepflower: "deep rose pink",
  };
  const COLOR_ZH = {
    white: "奶白", green: "绿", yellowbrown: "黄棕", blackgray: "黑灰",
    duo: "多宝多彩", lightflower: "浅花", deepflower: "深花",
  };
  const SOFT_EN = {
    soft: "extremely soft and squishy mochi-like round body, relaxed happy sleepy eyes",
    slight: "slightly soft smooth polished surface, calm gentle expression",
    "": "smooth polished surface, friendly gentle expression",
  };

  /* ============================================================
   * v127：精灵「设定向导」——让用户 3-4 步确认，而不是全靠自动猜
   * 用户反馈：「读取颜色不对，每个人都太像了；生成之前让我辅助确认更好，
   *           比如发色/色调、特征（猫猫头要有猫耳）、性格；最好 3-4 个选项就能成，
   *           或者颜色我自己填；也可以我给一句基础设定，你来拓展成详细设定」。
   * 数据存在 rec.look 里（每只精灵一份），优先级：**用户确认过 > 自动推断**。
   * ============================================================ */
  // 发色/色调（第一个 = 跟随珠子主色；"auto" = 按外观种子自动分散，避免"每只都同色"）
  const HAIR_COLORS = [
    { id: "bead", zh: "跟珠子主色", en: "", sw: "" },
    { id: "auto", zh: "自动换个色（更有个性）", en: "", sw: "" },
    { id: "black", zh: "乌黑", en: "jet black", sw: "#1c1a19" },
    { id: "brown", zh: "深棕", en: "dark chocolate brown", sw: "#4a3324" },
    { id: "chestnut", zh: "栗棕", en: "chestnut brown", sw: "#7b4b2a" },
    { id: "silver", zh: "银白", en: "silver white", sw: "#ddd8d0" },
    { id: "gold", zh: "亚麻金", en: "light golden blond", sw: "#e0c489" },
    { id: "red", zh: "酒红", en: "deep wine red", sw: "#7d2b33" },
    { id: "navy", zh: "墨蓝", en: "dark navy blue", sw: "#243b63" },
    { id: "purple", zh: "雾紫", en: "soft violet purple", sw: "#8f7bc0" },
    { id: "green", zh: "墨绿", en: "deep forest green", sw: "#2f5440" },
    { id: "pink", zh: "樱粉", en: "soft sakura pink", sw: "#f0b3c6" },
    { id: "grey", zh: "烟灰", en: "ash grey", sw: "#9a978f" },
    { id: "white", zh: "雪白", en: "snow white", sw: "#f6f3ee" },
  ];
  const HAIR_BY_ID = {};
  HAIR_COLORS.forEach((h) => { HAIR_BY_ID[h.id] = h; });
  // v153 发色色板：**只给色块、不给中文色名**（用户要求：不要色彩的中文名字，要很多颜色的格子）
  //   点格子 → 存成 hairc:"custom" + customColor:"#rrggbb"，直接复用已有的「自定义色」链路：
  //   hairWordFromInput() 会把 hex 翻成英文色词，hairHex 也会作为精确色值进 prompt。
  //   按色系分行、每行由浅到深，共 12 行 × 10 色 = 120 色。
  const HAIR_PALETTE = [
    // 黑 · 白 · 灰
    "#ffffff", "#f2f0ec", "#ddd9d2", "#c2beb6", "#a5a19a", "#8a8781", "#6f6c66", "#55534e", "#38352f", "#1c1a19",
    // 棕 · 咖
    "#e8d5bf", "#d6bb9c", "#c2a074", "#ad8654", "#96683c", "#7b4b2a", "#64391f", "#4a3324", "#33241a", "#211710",
    // 金 · 亚麻
    "#fdf0c8", "#f5e3a8", "#e0c489", "#d0b06a", "#c9a86a", "#bf9a3f", "#a8862c", "#8f6f1f", "#6f5616", "#4f3d0f",
    // 黄 · 橙
    "#fff0c0", "#ffe08a", "#f7c65a", "#e8b56a", "#e8a13c", "#d98a3c", "#c26f22", "#a5571b", "#7f4013", "#5a2c0c",
    // 红
    "#ffe0dc", "#ffc4bd", "#f0a49b", "#e0827a", "#c9544f", "#b34440", "#a83a3f", "#932f35", "#7d2b33", "#54181e",
    // 粉
    "#fff0f4", "#ffe0ea", "#f7d3dc", "#f0b3c6", "#e8a0b4", "#dd8ba4", "#d9748f", "#c96a8f", "#b5486a", "#8d2b4d",
    // 绿
    "#eaf7dc", "#cfeeba", "#a8c05a", "#8fae48", "#6f9a4a", "#4a7a3d", "#3a6335", "#2f5440", "#1f3b30", "#12261d",
    // 青 · 茶
    "#d8f0ee", "#b0e0dc", "#8fd0cf", "#4aa8b0", "#2a98a0", "#2a7f8a", "#1f6a76", "#17565f", "#12444c", "#0a262b",
    // 蓝
    "#e2eefc", "#c4dcf5", "#a9c0dd", "#8aa8d0", "#6d8fc0", "#5478b0", "#3a5a8c", "#2b4a78", "#243b63", "#121d33",
    // 紫
    "#efe6fb", "#ded0f2", "#c9b2e0", "#b39ddb", "#a288cf", "#8f7bc0", "#7a63ad", "#6a4f9e", "#4f3880", "#33244f",
    // 藕 · 玫
    "#f7e6ef", "#eccfe2", "#ddb8d0", "#d9b8c8", "#c99fb4", "#b9899f", "#a86b8f", "#96607d", "#7a4a6a", "#4d2c42",
    // 米 · 茶 · 奶
    "#fffaf0", "#f7efdf", "#efe2cc", "#e5d4b8", "#d9c4a4", "#c9b18c", "#b89e78", "#a88b64", "#8f7452", "#755d40",
  ];
  // v153 中国传统色表：色板色在**详情页里要写中国传统色名**（用户要求），
  //   这里的 hex 取常见传统色值；点色块后按加权 RGB 距离找最近的传统色名。
  const CN_TRAD_COLORS = [
    // 白 · 灰 · 黑 · 墨
    ["雪白", "#ffffff"], ["象牙白", "#fffbf0"], ["鱼肚白", "#fcefe8"], ["月白", "#d6ecf0"],
    ["霜色", "#e9f1f6"], ["铅白", "#f0f0f4"], ["缟色", "#e8e3e3"], ["银白", "#e9e7ef"],
    ["鸭卵青", "#e0eee8"], ["苍色", "#75878a"], ["玄青", "#3d3b4f"], ["黛色", "#4a4266"],
    ["墨绿", "#50616d"], ["漆黑", "#161823"], ["玄色", "#622a1d"], ["煤黑", "#312520"],
    ["乌黑", "#1c1a19"], ["灰色", "#8a8781"],
    // 红 · 粉 · 紫
    ["妃色", "#ed5736"], ["石榴红", "#f20c00"], ["樱桃色", "#c93756"], ["银红", "#f05654"],
    ["朱红", "#ff4c00"], ["朱砂", "#e23a2c"], ["丹色", "#ff4e20"], ["彤色", "#f35336"],
    ["胭脂", "#9d2933"], ["绯红", "#c83c23"], ["赤色", "#c3272b"], ["茜色", "#cb3a56"],
    ["玫瑰红", "#e9475b"], ["海棠红", "#db5a6b"], ["桃红", "#f47983"], ["绛紫", "#8c4356"],
    ["藕荷色", "#e4c6d0"], ["藕色", "#edd1d8"], ["丁香色", "#cca4e3"], ["雪青", "#b0a4e3"],
    ["青莲", "#8d4bbb"], ["紫棠", "#56004f"], ["酱紫", "#815476"], ["黛紫", "#574266"],
    ["紫罗兰", "#a25eb5"], ["葡萄紫", "#4c1951"], ["殷红", "#be002f"],
    // 黄 · 金 · 棕 · 褐
    ["藤黄", "#ffb61e"], ["杏黄", "#ffa631"], ["姜黄", "#ffc773"], ["缃色", "#f0c239"],
    ["橘黄", "#ff8936"], ["橙黄", "#ffa400"], ["杏红", "#ff8c31"], ["琥珀", "#ca6924"],
    ["秋香色", "#d9b611"], ["鹅黄", "#fff143"], ["鸭黄", "#faff72"], ["樱草色", "#eaff56"],
    ["黄栌", "#e29c45"], ["赭石", "#955539"], ["驼色", "#a88462"], ["栗色", "#60281e"],
    ["檀色", "#b36d61"], ["茶色", "#b35c44"], ["酱色", "#a78e44"], ["咖色", "#a88a65"],
    ["棕色", "#b25d25"], ["褐色", "#6c4c3f"], ["黎色", "#75664d"], ["土黄", "#d2b48c"],
    ["蜜色", "#e8b49a"],
    // 绿 · 青
    ["竹青", "#789262"], ["松花色", "#bce672"], ["豆绿", "#9ed900"], ["葱青", "#0eb83a"],
    ["碧色", "#1bd1a5"], ["青碧", "#48c0a3"], ["翡翠色", "#3de1ad"], ["铜绿", "#549688"],
    ["石绿", "#16a951"], ["松柏绿", "#21a675"], ["艾绿", "#a4e2c6"], ["橄榄绿", "#5b8930"],
    ["松绿", "#2f5440"], ["青绿", "#2a98a0"],
    // 蓝 · 靛 · 天
    ["靛青", "#177cb0"], ["靛蓝", "#065279"], ["群青", "#4c8dae"], ["宝蓝", "#4b5cc4"],
    ["藏青", "#3b2e7e"], ["天蓝", "#44cef6"], ["湖蓝", "#30dff3"], ["石青", "#1685a9"],
    ["花青", "#003472"], ["鸦青", "#424c50"], ["黛蓝", "#425066"], ["天青", "#8ec5cf"],
    ["缥色", "#7fecff"],
  ];
  // sRGB → Lab(D65)：用 CIE76 色差找"人眼最接近"的传统色（比裸 RGB 距离准得多，
  //   裸 RGB 会把灰调色错配成「土黄 / 咖色」）
  function _hexToLab(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const q = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = q(x); y = q(y); z = q(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  const CN_TRAD_LAB = CN_TRAD_COLORS.map((c) => _hexToLab(c[1]));
  // hex → 最近的中国传统色名
  function hexToCnTrad(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return "";
    const q = _hexToLab("#" + m[1].toLowerCase());
    let best = "", bd = Infinity;
    for (let i = 0; i < CN_TRAD_LAB.length; i++) {
      const p = CN_TRAD_LAB[i];
      const d = (q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]) + (q[2] - p[2]) * (q[2] - p[2]);
      if (d < bd) { bd = d; best = CN_TRAD_COLORS[i][0]; }
    }
    return best;
  }
  // 中文色名 → 英文（用户自己填色时用；查不到就原样交给模型，再兜底 #hex 换算）
  const COLOR_WORD_ZH = {
    "黑": "jet black", "乌黑": "jet black", "深棕": "dark brown", "棕": "brown", "栗": "chestnut brown",
    "银": "silver", "银白": "silver white", "白": "snow white", "奶白": "creamy white", "米白": "creamy white",
    "金": "golden blond", "亚麻": "light golden blond", "黄": "warm yellow", "橙": "warm orange",
    "红": "deep red", "酒红": "deep wine red", "粉": "soft pink", "樱粉": "soft sakura pink",
    "紫": "violet purple", "雾紫": "soft violet purple", "蓝": "soft blue", "天蓝": "sky blue",
    "藏青": "navy blue", "墨蓝": "dark navy blue", "青": "teal", "绿": "green", "墨绿": "deep forest green",
    "薄荷": "mint green", "灰": "ash grey", "烟灰": "ash grey", "奶茶": "milk tea beige", "咖": "coffee brown",
  };
  // 特殊特征（可多选，最多 3 个；"none" = 明确不要任何额外特征，会写进 prompt 的排除项）
  const FEATURES = [
    { id: "cat", zh: "猫耳 + 猫尾", en: "a pair of fluffy cat ears on top of the head and a long slim cat tail with a soft tip", tail: true },
    { id: "fox", zh: "狐耳 + 大尾巴", en: "pointed fox ears on the head and a big fluffy fox tail", tail: true },
    { id: "rabbit", zh: "兔耳", en: "long fluffy rabbit ears standing up on the head", tail: false },
    { id: "horns", zh: "小龙角", en: "small elegant dragon horns on the head", tail: false },
    { id: "elf", zh: "精灵耳", en: "long pointed elf ears", tail: false },
    { id: "wings", zh: "小天使翼", en: "small white feathered angel wings on the back", tail: false },
    { id: "devil", zh: "小恶魔角 + 尾", en: "small dark curved devil horns and a slim demon tail with a heart-shaped tip", tail: true },
    { id: "glasses", zh: "圆框眼镜", en: "round thin-frame glasses", tail: false },
    { id: "freckles", zh: "小雀斑", en: "a few light freckles across the cheeks", tail: false },
    { id: "blush", zh: "害羞腮红", en: "soft rosy blush on the cheeks", tail: false },
    { id: "none", zh: "普通人形（不要额外特征）", en: "", tail: false },
  ];
  const FEATURE_BY_ID = {};
  FEATURES.forEach((f) => { FEATURE_BY_ID[f.id] = f; });
  // 性格（影响表情/姿态/氛围）
  const PERSONAS_PICK = [
    { id: "gentle", zh: "温柔安静", en: "gentle and quiet", face: "soft calm smile, gentle half-closed eyes" },
    { id: "lively", zh: "活泼元气", en: "cheerful and energetic", face: "big bright smile, sparkling happy eyes" },
    { id: "cool", zh: "高冷傲娇", en: "cool and a little proud", face: "calm confident look with a tiny proud pout" },
    { id: "calm", zh: "沉稳可靠", en: "calm and dependable", face: "steady reassuring expression" },
    { id: "mystery", zh: "神秘慵懒", en: "mysterious and laid-back", face: "sleepy lidded eyes, lazy elegant mood" },
    { id: "cheeky", zh: "古灵精怪", en: "playful and mischievous", face: "playful bright smile with sparkling eyes" },
  ];
  const PERSONA_BY_ID = {};
  PERSONAS_PICK.forEach((p) => { PERSONA_BY_ID[p.id] = p; });

  // 把用户填的颜色（中文色名 / 英文 / #hex）翻成 prompt 能用的英文色词
  function hairWordFromInput(input) {
    const s = String(input || "").trim();
    if (!s) return "";
    if (/^#?[0-9a-f]{6}$/i.test(s)) return hexToWord(s) || "";
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      const h3 = s.slice(1);
      return hexToWord("#" + h3[0] + h3[0] + h3[1] + h3[1] + h3[2] + h3[2]) || "";
    }
    if (/[\u4e00-\u9fa5]/.test(s)) {
      // 中文：先整词查，再按 2 字 / 1 字片段查
      if (COLOR_WORD_ZH[s]) return COLOR_WORD_ZH[s];
      for (let len = 2; len >= 1; len--) {
        for (let i = 0; i + len <= s.length; i++) {
          const seg = s.slice(i, i + len);
          if (COLOR_WORD_ZH[seg]) return COLOR_WORD_ZH[seg];
        }
      }
      return s;   // 实在认不出就把原文交给模型（中文色名模型也能懂）
    }
    return s;     // 英文直接用
  }
  // 用户设定 + 自动推断 = 这一只**真正要用**的外形参数
  // rec 可以不传：不传就自己去 localStorage 读这只精灵的记录（保证任何调用点都拿得到用户设定）
  function lookOf(item, rec) {
    const r = rec || ((item && item.id) ? (load()[item.id] || {}) : {});
    const lk = r.look || {};
    const ap = appearanceOf(item, r.appearanceSeed || 0, r.gender || "", lk);
    const bead = beadColor(item);
    const beadWord = (bead && bead.word) ? bead.word : (COLOR_EN[(item && item.color) || ""] || "jade green");
    const beadHex = (bead && bead.hex) ? bead.hex : "";
    // 发色：用户选了就用用户的；"bead" = 跟珠子；不填 / "auto" = 按外观种子从 12 色里分散挑一个
    // （★ 这一条直接解决"每只精灵都一个颜色、看起来太像"）
    let hairEn = beadWord, hairHex = beadHex, hairSrc = "bead", hairZh = (bead && bead.zh) || "跟珠子主色";
    const pick = lk.hairc || "auto";
    if (pick === "bead") {
      hairEn = beadWord; hairHex = beadHex; hairSrc = "bead"; hairZh = "跟珠子主色";
    } else if (pick === "custom") {
      const w = hairWordFromInput(lk.customColor);
      const rawC = String(lk.customColor || "").trim();
      const isHex = /^#/.test(rawC);
      hairEn = w || beadWord;
      hairHex = isHex ? rawC : "";
      hairSrc = "custom";
      // v153：色板点出来的色是 #hex → 详情页里显示成**中国传统色名**（用户要求）
      hairZh = isHex ? (hexToCnTrad(rawC) || "自定色") : (rawC || "自定色");
    } else if (pick === "auto") {
      const pool = HAIR_COLORS.filter((x) => x.id !== "bead" && x.id !== "auto");
      const h = hashStr(String((item && item.id) || "") + "#hair" + (r.appearanceSeed || 0));
      const f = pool[h % pool.length];
      hairEn = f.en; hairHex = f.sw; hairSrc = "auto"; hairZh = "自动 · " + f.zh;
    } else {
      const f = HAIR_BY_ID[pick];
      if (f) { hairEn = f.en; hairHex = f.sw; hairSrc = "pick"; hairZh = f.zh; }
    }
    // 特征
    const ids = Array.isArray(lk.feats) ? lk.feats : [];
    const noFeat = ids.indexOf("none") >= 0;
    // v130：「自己填」的自定义特征存成 "custom:描述"，这里翻成和预置特征同构的对象
    //      （原文直接进 prompt，绘图模型能看懂中文描述）
    const feats = ids.map((x) => FEATURE_BY_ID[x] ||
      (String(x).indexOf("custom:") === 0 ? { id: x, zh: String(x).slice(7), en: String(x).slice(7), custom: true } : null)
    ).filter((f) => f && f.id !== "none").slice(0, 3);
    // 性格
    const pers = PERSONA_BY_ID[lk.pers] || null;
    // 服装色：默认跟珠子主色（用户没要求改），可被设定里的 customOutfit 覆盖
    const outfitEn = lk.outfitColor ? hairWordFromInput(lk.outfitColor) : beadWord;
    return {
      ap, bead, beadWord, beadHex, hairEn, hairHex, hairSrc, hairZh, outfitEn,
      feats, noFeat, pers,
      base: lk.base || "", profile: lk.profile || "",
      asked: !!r.lookAsked, chosen: !!(lk.hairc || ids.length || lk.pers || lk.base),
    };
  }
  // 把设定拼成一段 prompt 片段（特征 / 性格 / 明确"不要兽耳"）
  function lookExtra(lk) {
    if (!lk) return "";
    let s = "";
    if (lk.feats && lk.feats.length) s += ", " + lk.feats.map((f) => f.en).join(", ");
    if (lk.noFeat) s += ", strictly a normal human look: no animal ears, no tail, no wings, no horns";
    if (lk.pers) s += ", " + lk.pers.en + " personality, " + lk.pers.face;
    return s;
  }
  // 用户确认过的设定 → 放到 prompt 末尾做"硬约束"（模型对靠后的关键词更敏感，
  // 而且能压住 AI 形象关键词里可能冲突的配色/发型描述）
  function lookHard(lk) {
    if (!lk || !lk.chosen) return "";
    const hard = [];
    if (lk.hairEn) hard.push(lk.hairEn + " hair color (keep exactly this hair color)");
    if (lk.feats && lk.feats.length) hard.push(lk.feats.map((f) => f.en).join(", "));
    if (lk.noFeat) hard.push("strictly human look: no animal ears, no tail, no wings, no horns");
    if (lk.pers) hard.push(lk.pers.en + " personality, " + lk.pers.face);
    // v130：主人写的一句话/融合后的设定 = 描述**精灵本人**的硬约束。
    // 用户反馈：写「洒脱的江湖侠士」指的是珠子，结果 AI 安给了主人、立绘也不跟 —— 现在直接进 prompt 末尾硬约束。
    const personaNote = lk.profile || lk.base;
    if (personaNote) hard.push("character setting from owner (describes THIS spirit itself, never the owner): " + personaNote);
    return "IMPORTANT character features that must be clearly visible: " + hard.join("; ");
  }
  // 给人看的一行「设定摘要」（详情页 chips 用）
  function lookText(lk) {
    const arr = [];
    if (lk) {
      arr.push("发色：" + (lk.hairZh || "跟珠子"));
      arr.push("特征：" + (lk.feats && lk.feats.length ? lk.feats.map((f) => f.zh).join("、") : (lk.noFeat ? "普通人形" : "未指定")));
      arr.push("性格：" + (lk.pers ? lk.pers.zh : "未指定"));
    }
    return arr.join(" · ");
  }
  // 没有 AI key 时的本地"设定小作文"（照样显示在详情页）
  function profileLocal(item, lk, persona) {
    const nm = (persona && persona.name) || (item && item.name) || "它";
    const beadZh = (lk && lk.bead && lk.bead.zh) || COLOR_ZH[(item && item.color) || ""] || "温润";
    const hairTxt = { bead: "跟本体珠子是一个色", auto: "是它自己长出来的颜色", pick: "是主人替它挑的", custom: "是主人给它定的" }[(lk && lk.hairSrc) || "bead"] || "";
    const featTxt = (lk && lk.feats && lk.feats.length) ? ("头上还带着" + lk.feats.map((f) => f.zh).join("、")) : (lk && lk.noFeat ? "看着就是普普通通的人形" : "");
    const persTxt = (lk && lk.pers) ? lk.pers.zh : "温和";
    // v130：用户的一句话要**融进**设定（描述精灵本人），不再是"主人说过…"的引用体
    const baseTxt = (lk && lk.base) ? ("它是" + lk.base + "——这是主人一眼就认出来的性子。") : "";
    // v153：色板选出来的色存的是 #hex（用户要求不要中文色名）→ 中文小作文里换成人话
    const hairZhRaw = (lk && lk.hairZh) ? String(lk.hairZh).replace(/^自动 · /, "") : "";
    const hairZhText = /^#/.test(hairZhRaw) ? "主人亲手挑的一种颜色" : (hairZhRaw || beadZh);
    return nm + "是从主人那串「" + ((item && item.name) || "手串") + "」里醒过来的小精灵。" +
      "它的头发是" + hairZhText + "，" + hairTxt + "；" +
      (featTxt ? featTxt + "；" : "") +
      "衣服的色调跟着珠子的" + beadZh + "走，看久了很安稳。" +
      "性子偏「" + persTxt + "」，平时话不多，但主人一伸手它就会靠过来。" + baseTxt;
  }
  // 用文字模型把"一句基础设定 + 选项"扩写成一小段（失败就退回本地模板）
  async function expandProfile(item, lk, persona) {
    const local = profileLocal(item, lk, persona);
    const base = (lk && lk.base) ? String(lk.base).trim() : "";
    // v130：精灵性别要交代清楚（之前只交代主人代词，男精灵被写成「她」）
    const r0 = (item && item.id) ? load()[item.id] || {} : {};
    const ap0 = appearanceOf(item, r0.appearanceSeed || 0, r0.gender || "");
    const sys = "你是一个角色设定师。请根据用户给的选项，为主人的手串精灵写一小段中文人物设定，要求：" +
      "① 只写 90-150 字，一段话，不要标题、不要分点、不要引号；② 必须体现：外貌（发色 / 特殊特征）、性格、和主人以及这串珠子的关系；" +
      "③ 口吻温柔、有画面感，像手账里的备注；④ 不要出现「AI」「提示词」「角色设定」这类词；" +
      "⑤【最重要】主人写的那句话描述的是**精灵本人**的性格/身份/气质（例如「洒脱的江湖侠士」＝这只精灵是侠士，不是主人是侠士），" +
      "必须把这句话的意思自然融进正文，让整段读起来是一份完整统一的设定，不要引用原话、不要说「主人说过」、不要写成两套人设；" +
      "⑥ 精灵的性别以下方标注为准，指代精灵的代词绝不能用错；" +
      "⑦【发色、瞳色、特殊特征照下方给定内容写；但**发型自由发挥**】中式古风发型多种多样（长直发、发髻、发冠、马尾、辫子、披发都可以），按精灵的性别/性格/主人写的设定来定，不要生硬套短发；" +
      "发色若给的是中国传统色名（胭脂、天青、月白、秋香、藕荷、黛色等），正文里就用这个名称来写，不要改成现代色号；" +
      "⑧【整段基调是中国古风】衣服一律写中式传统样式（汉服、长衫、褂子、襦裙、道袍等），禁止出现现代服装（夹克、运动服、卫衣、T恤、牛仔裤、西装等）；" +
      "⑨【姿态自由发挥、不要摆拍】可写一个自然的中式仪态（作揖、拱手、拂袖、团扇半遮面、低眸捻珠、执笔、捧盏、展卷等），" +
      "双手位置要简单清楚、不要遮叠手臂或复杂手势（否则出图容易画成三只手 / 多指），不要现代随意手势或 wink。";
    const NL = String.fromCharCode(10);
    const user = "精灵名：" + ((persona && persona.name) || item.name || "小精灵") +
      NL + spiritGenderLine(ap0) +
      NL + "来自手串：" + ((item && item.name) || "") + (item && item.craft ? "（" + item.craft + "）" : "") +
      NL + "发色（中国传统色名）：" + (((lk && lk.hairZh) ? String(lk.hairZh).replace(/^自动 · /, "") : "") || "跟珠子主色") +
      NL + "服装（必须是中式传统古风样式）：" + (ap0.outfitZh || ap0.outfit) +
      NL + "特殊特征：" + ((lk && lk.feats && lk.feats.length) ? lk.feats.map((f) => f.zh).join("、") : ((lk && lk.noFeat) ? "普通人形" : "未指定")) +
      NL + "性格：" + ((lk && lk.pers) ? lk.pers.zh : "未指定") +
      (base ? (NL + "主人给的一句话设定（描述的是精灵本人，融进正文）：" + base) : "") +
      NL + ownerLine() + NL + "请写这一小段设定。";
    try {
      const txt = (await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 400) || "").trim();
      const clean = txt.replace(/^["「]|["」]$/g, "").replace(/\s*\n+\s*/g, "").trim();
      if (clean && clean.length >= 40) return { text: clean, ai: true };
    } catch (e) { /* 没 key / 失败 → 本地模板 */ }
    return { text: local, ai: false };
  }
  function promptFor(item, styleKey, stage, appearance, look) {
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    // 颜色：优先用 **用户在「设定向导」里确认过的发色**；没设过才用"从手串照片里采到的真实主色"，
    // 再拿不到才退回颜色分类（v127：用户反馈"颜色读不准、每只都太像"→ 现在可确认、可改、可按种子分散）
    const lk = look || lookOf(item, null);
    const color = lk.hairEn;
    const outfitColor = lk.outfitEn;
    const colorHint = (lk.hairHex ? (", the exact hair color is " + lk.hairHex) : "") +
      (lk.beadHex ? (", sampled from the real bracelet: " + lk.beadHex + ", keep the outfit close to this color") : "");
    const soft = SOFT_EN[item.softness || ""] || SOFT_EN[""];
    const isChar = (key === "anime");          // 日漫 Q 版角色：颜色落在头发/衣服上
    const stageLook = stageDef(stage == null ? 1 : stage).look;   // 该形态的外形描述（进阶的核心）
    const ap = appearance || appearanceOf(item, 0);         // 固定人设（性别/发型/瞳色/配饰）
    let cmp;
    if (isChar) {
      // 先写死"这个人是谁"（外观锚点），再写"他现在多大"（形态描述）→ 突破只会长大，不会换人
      // 注意：这里始终是**立绘**（全身角色图、干净背景），四个阶段都有立绘；
      //      觉醒期/完成体**额外**再出一张 CG（场景插画），见 promptForCg（v125）。
      cmp = appearancePrompt(ap) + ", with " + color + " hair and " + outfitColor + " themed outfit" + colorHint +
        lookExtra(lk) + ", " + stageLook + ", " +
        "full body character illustration, standing pose, whole body visible from head to toe, " +
        "detailed outfit and shoes, vertical composition, " +
        "centered with comfortable margin around the character";
    } else {
      cmp = "a " + (ap.gender === "boy" ? "boy" : "girl") + " creature mascot whose body color is " + color + colorHint +
        ", wearing " + ap.acc + ", " + ap.vibe + " personality, " + stageLook + ", " +
        "full body creature illustration, whole body visible, centered with comfortable margin";
    }
    const bits = [cmp, GUOFENG, ANATOMY, soft, SINGLE, CONSISTENCY, GROWTH_LINE, NEG_STYLE];
    // v112：把「人物设定 → 形象细节关键词」也拼进去，立绘不再"只有颜色"
    const tags = getLookTags(item);
    if (tags) bits.push(lk.chosen
      ? ("extra outfit and texture details (colors and features are already fixed above, do not change them): " + tags)
      : ("extra character design details: " + tags));
    const hard = lookHard(lk);
    if (hard) bits.push(hard);
    if (item.softness === "soft") bits.push(isChar ? "round soft cheeks, relaxed happy sleepy eyes" : "round blob-like silhouette, soft chewy texture");
    if (item.softness === "slight") bits.push(isChar ? "calm gentle eyes, neat tidy look" : "slightly squishy but mostly smooth silhouette");
    return bits.join(", ") + ", " + st;
  }
  function seedOf(id, variant) { return (hashStr(id) % 900000) + 1000 + (variant || 0) * 7919; }
  // 免密钥通道：直接把 URL 交给 <img>（浏览器自己下载，天然带缓存）；其余通道要 POST 生成
  function pollinationsUrl(item, variant, styleKey, stage, appearance) {
    const style = styleKey || getImageCfg().style || DEFAULT_STYLE;
    return "https://image.pollinations.ai/prompt/" + encodeURIComponent(promptFor(item, style, stage, appearance)) +
      "?width=512&height=512&nologo=true&seed=" + seedOf(item.id, variant);
  }

  /* ---------- 走 API 通道真正出图（v97） ----------
     OpenAI 兼容：POST {endpoint} {model, prompt, n, size} → {data:[{url|b64_json}]}
     火山方舟 / 智谱 / 硅基流动 / 魔搭 都实测允许浏览器直连（CORS 预检通过） */
  async function generateImage(item, variant, styleKey, stage, opts) {
    const cfg = getImageCfg();
    const info = providerInfo(cfg);
    const ap = appearanceOf(item, (opts && opts.appearanceSeed) || 0, opts && opts.gender);
    if (info.keyless) return { url: pollinationsUrl(item, variant, styleKey, stage, ap), kind: "url" };
    if (!info.key) throw new Error("还没填 API Key");
    if (!info.endpoint) throw new Error("还没填接口地址");
    const prompt = promptFor(item, styleKey || cfg.style || DEFAULT_STYLE, stage, ap);
    const size = cfg.size || DEFAULT_SIZE;
    const seed = seedOf(item.id, 0);   // 同一只精灵用固定种子 → 各形态看起来是同一个"人"在长大
    // 图生图参考：拿上一形态的图当参考，是"同一个角色"最可靠的做法。
    // 方舟（Seedream）确实支持；别的家先带上试一次，不支持就自动去掉并**按这家**记住。
    const pk = info.provider;
    const useRef = fixedOf("noRef", pk) ? "" : ((opts && opts.ref) || "");
    const firstSize = (cfg && cfg.sizeFallback && cfg.sizeFallback !== size) ? cfg.sizeFallback : null;
    try {
      return await callWithSizeFallback(info, prompt, size, seed, useRef, cfg, { firstSize: firstSize });
    } catch (e) {
      const msg = (e && e.message) || "";
      // ① 尺寸被服务端拒（callWithSizeFallback 已经把能试的都试完了）→ 报告一句能看懂的提示
      if (isSizeErr(msg)) throw new Error("尺寸不被这个模型接受（" + msg + "）。请到 设置 → 精灵形象 把「出图尺寸」换成「竖版立绘 3:4」再试。");
      // ② 参考图不被支持（部分服务商/模型没有这个字段）→ 去掉 image 再试一次，并按这家记住
      //    （文本锚点仍在：性别/发型/瞳色/配饰/服装都写死在 prompt 里，不会变性换人）
      if (useRef && !fixedOf("noRef", pk) && /image|InvalidParameter|not support|参数/i.test(msg)) {
        markFixed("noRef", pk);
        return await callImageApi(info, prompt, size, seed, "");
      }
      // ③ 模型名不对（常见：把控制台显示名 Doubao-Seedream-5.0-lite 填进来了）→ 拉账号模型列表自动纠正一次
      if (!/NotFound|does not exist|not exist|InvalidEndpointOrModel/i.test(msg) || fixedOf("autoModel", pk)) throw e;
      let fixed = "";
      try {
        const ids = await listModels("image", { provider: cfg.provider, key: info.key, endpoint: info.endpoint });
        fixed = pickBestModel(info.model, ids);
      } catch (e2) { /* 拉不到就算了 */ }
      if (!fixed || normModelName(fixed) === normModelName(info.model)) throw e;
      markFixed("autoModel", pk);
      const next = Object.assign({}, cfg, { model: fixed });
      setImageCfg(next);
      const r = await callImageApi(providerInfo(next), prompt, size, seed, useRef);
      r.autoFixed = fixed;   // 交给界面提示"已自动改用 xxx"
      return r;
    }
  }
  // 尺寸兜底阶梯：先按这家服务商自己的合法档位试，再退回通用档。
  // 之所以不写死成 "2K"：有的模型把 "2K" 当成 1024x1024 → 会一直报像素不够。
  async function callWithSizeFallback(info, prompt, size, seed, ref, cfg, o) {
    const opt = o || {};
    const ladder = opt.ladder || sizeLadderFor(cfg && cfg.provider);
    // 候选顺序：用户首选尺寸（cfg.size，**绝不改动**）→ 上次能用的退让尺寸（sizeFallback，避免每次都拿被拒尺寸试一遍）→ 该服务商合法档位
    const first = (opt.firstSize && opt.firstSize !== size) ? [opt.firstSize] : [];
    const cands = [size].concat(first, ladder.filter((s) => s !== size && s !== opt.firstSize));
    let lastErr = null;
    for (let i = 0; i < cands.length; i++) {
      try {
        const r = await callImageApi(info, prompt, cands[i], seed, ref);
        // ⚠️ 绝不覆盖用户首选尺寸：只把"这次能用的尺寸"记到 sizeFallback，下次优先尝试，
        //    避免反复拿被拒尺寸去试（每次试错都要烧一次请求额度）
        if (i > 0 && !opt.keepSize && cands[i] !== (cfg && cfg.sizeFallback)) {
          cfg.sizeFallback = cands[i];
          try { setImageCfg(cfg); } catch (e2) { /* 忽略 */ }
          r.autoFixed = "尺寸已自动适配为 " + cands[i];
        }
        return r;
      } catch (e) {
        lastErr = e;
        if (!isSizeErr((e && e.message) || "")) throw e;   // 不是尺寸问题 → 交给上层按参考图/模型名兜底
      }
    }
    throw lastErr;
  }
  // 判断"是不是尺寸被服务端拒了"。各家报错文案差别很大，所以中英都要认：
  //   方舟：The parameter `size` specified in the request is not valid: image size must be at least 3686400 pixels
  //   智谱：size 参数不合法 / 不支持的尺寸
  //   硅基流动等：resolution not supported
  function isSizeErr(msg) {
    const s = String(msg || "");
    if (/at least\s*\d+\s*pixels|image size must be/i.test(s)) return true;
    if (/尺寸|分辨率/.test(s)) return true;
    if (/resolution/i.test(s) && /not|invalid|unsupported|illegal|不合法|不支持/i.test(s)) return true;
    if (/size/i.test(s) && /not valid|invalid|unsupported|illegal|must be|不合法|不支持|超出|越界|exceed/i.test(s)) return true;
    return false;
  }
  async function callImageApi(info, prompt, size, seed, ref) {
    const isArk = /ark\.cn-beijing\.volces\.com/.test(info.endpoint);
    const isZhipu = /bigmodel\.cn/.test(info.endpoint);
    const pk = info.provider || info.endpoint;
    const payload = { model: info.model, prompt: prompt, n: 1, size: size || DEFAULT_SIZE };
    // 火山方舟（Seedream）支持 seed：固定种子能让"长大"的各形态保持同一个角色的辨识度
    if (isArk && seed != null) payload.seed = seed;
    // 图生图参考图：方舟（Seedream）支持；其它家也先带上试一次 ——
    // 不支持的服务商会报错，generateImage 的 ② 分支会去掉它重试并**按这家**记住，
    // 所以"能图生图的就用上、不能的自动退回纯文本锚点"，不用每家单独判断。
    if (ref) payload.image = ref;
    // 关水印：两家字段名不一样（方舟 watermark / 智谱 watermark_enabled），被拒就整个不传
    if (!fixedOf("noWatermark", pk)) {
      if (isArk) payload.watermark = false;
      else if (isZhipu) payload.watermark_enabled = false;
    }
    const resp = await fetch(info.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + info.key },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let msg = "HTTP " + resp.status;
      try {
        const j = await resp.json();
        msg = (j.error && (j.error.message || j.error.code)) || j.message || j.msg || msg;
      } catch (e) { /* 忽略 */ }
      // 这个模型不认水印字段（或没签去水印免责声明）→ 记下来，**并立刻去掉重试一次**。
      // ⚠️ 判据只认"水印"字样：早期写成 /不合法|InvalidParameter/，会把普通参数错误
      //    （比如"不支持 image 字段"）也当成水印问题，白花一次请求才发现真正原因。
      if ((payload.watermark === false || payload.watermark_enabled === false) &&
          /watermark|水印|去水印|未签署/i.test(msg)) {
        markFixed("noWatermark", pk);
        return await callImageApi(info, prompt, size, seed, ref);
      }
      throw new Error(msg);
    }
    const data = await resp.json();
    const d = (data && data.data && data.data[0]) || null;
    if (!d) throw new Error("返回里没有图片数据");
    if (d.b64_json) return { b64: d.b64_json, kind: "b64" };
    if (d.url) return { url: d.url, kind: "url" };
    throw new Error("不认识的返回格式");
  }

  /* ---------- 本地兜底形象：程序化画一个 2D 小精灵（断网也有形象） ---------- */
  const COLOR_HEX = {
    white: "#f0e6d8", green: "#5aa469", yellowbrown: "#b98a4b", blackgray: "#5b5b5b",
    duo: "#c9803f", lightflower: "#e8b6c2", deepflower: "#b34a63",
  };
  function localAvatarSvg(item) {
    const seed = hashStr(item.id);
    const base = COLOR_HEX[item.color] || "#6d9e78";
    const dark = shade(base, -28);
    const light = shade(base, 26);
    const ear = seed % 3;                     // 0 圆耳 / 1 尖耳 / 2 小角
    const mouth = item.softness === "soft" ? 6 : (item.softness === "slight" ? 4 : 5);   // 软糯→笑得更圆
    const round = item.softness === "soft" ? 62 : 52;   // 软糯→更圆更扁
    const cv = 160;
    const earEls = ear === 0
      ? '<circle cx="58" cy="46" r="17" fill="' + base + '" stroke="' + dark + '" stroke-width="3"/>' +
        '<circle cx="102" cy="46" r="17" fill="' + base + '" stroke="' + dark + '" stroke-width="3"/>'
      : ear === 1
        ? '<path d="M52 56 L44 24 L72 42 Z" fill="' + base + '" stroke="' + dark + '" stroke-width="3" stroke-linejoin="round"/>' +
          '<path d="M108 56 L116 24 L88 42 Z" fill="' + base + '" stroke="' + dark + '" stroke-width="3" stroke-linejoin="round"/>'
        : '<circle cx="64" cy="34" r="9" fill="' + light + '" stroke="' + dark + '" stroke-width="3"/>' +
          '<circle cx="96" cy="34" r="9" fill="' + light + '" stroke="' + dark + '" stroke-width="3"/>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + cv + ' ' + cv + '" width="512" height="512">' +
      '<rect width="' + cv + '" height="' + cv + '" fill="#ffffff"/>' +
      earEls +
      '<ellipse cx="80" cy="150" rx="' + (round + 8) + '" ry="9" fill="#00000012"/>' +
      '<ellipse cx="80" cy="98" rx="' + round + '" ry="' + (round - 4) + '" fill="' + base + '" stroke="' + dark + '" stroke-width="3.5"/>' +
      '<ellipse cx="80" cy="106" rx="' + (round - 22) + '" ry="' + (round - 30) + '" fill="#ffffff55"/>' +
      '<ellipse cx="62" cy="92" rx="7" ry="9" fill="#2b2b2b"/>' +
      '<ellipse cx="98" cy="92" rx="7" ry="9" fill="#2b2b2b"/>' +
      '<circle cx="64.5" cy="88.5" r="2.2" fill="#fff"/>' +
      '<circle cx="100.5" cy="88.5" r="2.2" fill="#fff"/>' +
      '<ellipse cx="52" cy="108" rx="8" ry="5" fill="#ff8a8a" opacity=".55"/>' +
      '<ellipse cx="108" cy="108" rx="8" ry="5" fill="#ff8a8a" opacity=".55"/>' +
      '<path d="M' + (80 - mouth) + ' 110 Q80 ' + (110 + mouth) + ' ' + (80 + mouth) + ' 110" stroke="#3b2b22" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
      "</svg>");
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  }

  /* ---------- 本地性格模板（没配 AI key 也能玩） ---------- */
  const NAME_A = ["糯糯", "小瓷", "圆圆", "阿光", "团子", "瓷宝", "油油", "亮亮", "小润", "阿包"];
  const NAME_B = ["子", "丸", "宝", "团", "", "儿"];
  const TITLE_BY_SOFT = {
    soft: ["最软的抱枕", "一团会呼吸的糯米", "掌心里的暖手宝", "慢慢来的小懒虫"],
    slight: ["温润的小先生", "沉得住气的老友", "安静发光的珠子", "有点闷骚的宝贝"],
    "": ["沉得住气的老友", "安静发光的珠子", "低调的小石头", "闷声发财派"],
  };
  const TRAITS_BY_SOFT = {
    soft: [["爱睡", "护食", "容易被摸头"], ["慢吞吞", "怕冷", "喜欢被手心捂着"], ["黏人", "爱撒娇", "一碰就化"]],
    slight: [["安静", "有耐心", "认人"], ["话少", "爱观察", "偶尔毒舌"], ["克制", "讲究", "不喜欢被汗手摸"]],
    "": [["沉静", "可靠", "什么都不说"], ["佛系", "随缘", "爱晒太阳"], ["慢热", "识货", "嘴硬心软"]],
  };
  const LINE_BY_SOFT = {
    soft: ["你手心一热，我就想化成一滩。", "别急呀，慢慢来，我们有的是时间。", "今天也可以什么都不做，就靠着你。"],
    slight: ["我不用天天擦，也会一直是亮的。", "你忙你的，我在抽屉里等你。", "好东西经得起放，也经得起等。"],
    "": ["我在。", "你想起来的时候，我都在。", "不吵不闹，慢慢就润了。"],
  };
  function localPersona(item) {
    const seed = hashStr(item.id);
    const soft = item.softness || "";
    const name = pick(NAME_A, seed) + pick(NAME_B, Math.floor(seed / 7));
    const title = pick(TITLE_BY_SOFT[soft] || TITLE_BY_SOFT[""], Math.floor(seed / 13));
    const traits = (TRAITS_BY_SOFT[soft] || TRAITS_BY_SOFT[""])[seed % 3];
    const line = pick(LINE_BY_SOFT[soft] || LINE_BY_SOFT[""], Math.floor(seed / 31));
    return { name, title, traits, line, from: "local" };
  }

  /* ---------- 文字通道（性格 / 小剧场 / 来信；默认 DeepSeek 官方，可切火山方舟白嫖额度） ---------- */
  const TEXT_KEY = "ww_textcfg";
  const TEXT_PROVIDERS = {
    deepseek: { label: "DeepSeek 官方", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash" },
    ark: { label: "火山方舟（有免费额度）", endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", model: "deepseek-v4-1-flash-260910" },
    custom: { label: "自定义（OpenAI 兼容）", endpoint: "", model: "" },
  };
  function getTextCfg() {
    let key = "";
    try { const k = localStorage.getItem("ww_dskey"); key = k && k.trim() ? k.trim() : ""; } catch (e) { /* 忽略 */ }
    try {
      const raw = localStorage.getItem(TEXT_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && o.provider) return { provider: o.provider, key: o.key || "", model: o.model || "", endpoint: o.endpoint || "" };
    } catch (e) { /* 忽略 */ }
    return { provider: "deepseek", key: key, model: TEXT_PROVIDERS.deepseek.model, endpoint: TEXT_PROVIDERS.deepseek.endpoint };
  }
  function setTextCfg(cfg) { try { localStorage.setItem(TEXT_KEY, JSON.stringify(cfg)); } catch (e) { /* 忽略 */ } }
  function textInfo(cfg) {
    const c = cfg || getTextCfg();
    const p = TEXT_PROVIDERS[c.provider] || TEXT_PROVIDERS.deepseek;
    return {
      provider: c.provider,
      label: p.label,
      endpoint: c.endpoint || p.endpoint || "",
      model: c.model || p.model || "",
      key: c.key || "",
    };
  }
  // 统一的文字请求入口（OpenAI 兼容；关掉思考模式只要结论）
  async function textChat(messages, maxTokens) {
    const info = textInfo();
    if (!info.key) { const e = new Error("no-key"); e.code = "no-key"; throw e; }
    if (!info.endpoint) throw new Error("还没填接口地址");
    const resp = await fetch(info.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + info.key },
      body: JSON.stringify({
        model: info.model, messages: messages, max_tokens: maxTokens || 700, stream: false,
        thinking: { type: "disabled" },
      }),
    });
    if (!resp.ok) {
      let m = "HTTP " + resp.status;
      try { const j = await resp.json(); m = (j.error && (j.error.message || j.error.code)) || j.message || m; } catch (e) { /* 忽略 */ }
      throw new Error(m);
    }
    const data = await resp.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return "";
    return ((msg.content && msg.content.trim()) || msg.reasoning_content || "").trim();
  }

  /* ---------- DeepSeek 调用（复用 app 的 key；已统一走文字通道） ---------- */
  function getAiKey() { return textInfo().key; }
  async function aiChat(messages, maxTokens) { return textChat(messages, maxTokens); }
  function spiritDesc(item, persona, stage) {
    const colorName = { white: "奶白", green: "绿", yellowbrown: "黄棕", blackgray: "黑灰", duo: "多彩", lightflower: "浅花", deepflower: "深花" }[item.color] || "素色";
    const softName = item.softness === "soft" ? "软糯" : (item.softness === "slight" ? "微糯" : "普通");
    const s = stageDef(stage);
    return "【" + (persona && persona.name ? persona.name : item.name) + "】（" + s.name + "）颜色：" + colorName +
      "；软糯程度：" + softName + "；性格：" + ((persona && persona.title) || "未定") +
      (((persona && persona.traits) || []).length ? "（" + persona.traits.join("、") + "）" : "") +
      "；口头禅：" + ((persona && persona.line) || "无") + "；（原型是主人收藏的一串挂瓷手串：「" + (item.name || "未命名") + "」）";
  }

  /* ---------- 性格：AI 优先，失败/无 key 用本地模板（结果缓存） ---------- */
  async function persona(item, force) {
    const store = load();
    const rec = ensureIn(store, item.id);
    if (!force && rec.persona) return rec.persona;
    let p = null;
    if (getAiKey()) {
      try {
        const sys = "你在为一个文玩收藏 App 写「挂瓷精灵」的设定。刚盘到挂瓷的手串会成精，变成一只 Q 版小生物。"
          + "请根据它的颜色和软糯程度，给它一个可爱、有梗、有人味的中文设定。"
          + "只输出 JSON，不要解释：{\"name\":\"2-3字昵称\",\"title\":\"6-12字称号\",\"traits\":[\"性格词1\",\"性格词2\",\"性格词3\"],\"line\":\"一句口头禅，15字以内\"}";
        const user = "颜色：" + (item.color || "未知") + "；软糯程度：" + (item.softness === "soft" ? "软糯" : item.softness === "slight" ? "微糯" : "未标注")
          + "；珠型：" + (item.beadShape || "未知") + "；名字：" + (item.name || "未命名") + "。请给出设定。";
        const txt = await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 400);
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) {
          const o = JSON.parse(m[0]);
          if (o && o.name) {
            p = {
              name: String(o.name).slice(0, 6),
              title: String(o.title || "").slice(0, 20),
              traits: Array.isArray(o.traits) ? o.traits.slice(0, 3).map((t) => String(t).slice(0, 6)) : [],
              line: String(o.line || "").slice(0, 30),
              from: "ai",
            };
          }
        }
      } catch (e) { /* 用本地模板兜底 */ }
    }
    if (!p) p = localPersona(item);
    rec.persona = p;
    save(store);
    return p;
  }

  /* ---------- 小剧场：几个精灵互相聊 ---------- */
  function localChat(spirits) {
    const lines = [];
    const seed = hashStr(spirits.map((s) => s.item.id).join("") + todayKey());
    lines.push({ who: spirits[0].persona.name, text: pick(["今天谁来摸摸我？", "我好像又亮了一点点。", "谁把窗户打开了，风有点凉。"], seed) });
    if (spirits[1]) lines.push({ who: spirits[1].persona.name, text: pick(["主人昨天先摸的是我。", "别炫耀了，你不过比我圆。", "安静点，我在晒太阳。"], seed + 3) });
    if (spirits[2]) lines.push({ who: spirits[2].persona.name, text: pick(["你们吵到我了。", "我只想躺在抽屉最里面。", "听说主人今天不上班？"], seed + 7) });
    lines.push({ who: spirits[0].persona.name, text: pick(["那我们商量一下，明天谁先被盘？", "要不今天一起装睡。", "猜拳吧，输的先上。"], seed + 11) });
    if (spirits[1]) lines.push({ who: spirits[1].persona.name, text: pick(["我认输，你们上。", "行吧，我先来，但只盘十分钟。", "不许抢，排好队。"], seed + 13) });
    return lines;
  }
  async function chat(spirits) {
    if (!spirits.length) return [];
    if (!getAiKey() || spirits.length < 2) return localChat(spirits);
    try {
      const sys = "你在写一个文玩 App 里的「挂瓷精灵小剧场」：主人的几串手串盘到挂瓷后变成了小生物，它们会背着你聊天。"
        + "请写一段 4-6 句的日常小对话，轻松、可爱、有生活感、带点小吐槽，不要煽情，不要解释。"
        + "严格只输出 JSON：{\"lines\":[{\"who\":\"精灵名字\",\"text\":\"说的话\"}]}";
      const user = "出场精灵：\n" + spirits.map((s) => spiritDesc(s.item, s.persona)).join("\n") + "\n" + ownerLine() + "\n请写它们今天的小剧场。";
      const txt = await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 700);
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) {
        const o = JSON.parse(m[0]);
        if (o && Array.isArray(o.lines) && o.lines.length) {
          return o.lines.slice(0, 8).map((l) => ({ who: String(l.who || "").slice(0, 8), text: String(l.text || "").slice(0, 120) }));
        }
      }
    } catch (e) { /* 兜底 */ }
    return localChat(spirits);
  }

  /* ---------- 来信：精灵给你写一封信 ---------- */
  function localLetter(spirit, userName) {
    const p = spirit.persona;
    const t = p.title || "你的小宝贝";
    const seed = hashStr(spirit.item.id + todayKey());
    const body = pick([
      "今天你好像很忙。我趴在抽屉里听你走来走去，脚步声比平时快。忙完记得喝口水。",
      "我数了一下，你已经 " + (spirit.idleDays != null ? spirit.idleDays : "好多") + " 天没摸我了。不是催你，就是有点想你手心的温度。",
      "刚才有一点点阳光从缝里漏进来，照在我身上。我忽然觉得自己亮得挺好看的，想让你也看看。",
      "我做了个梦，梦见自己变成了一颗星星，你把我别在衣领上出门了。醒来发现还在抽屉里，有点小失落，不过也还好。",
    ], seed);
    return (userName ? userName + "：" : "") + "\n\n" + body + "\n\n—— 你的" + (p.name || "小精灵") + "（" + t + "）";
  }
  async function letter(spirit, userName) {
    if (!getAiKey()) return localLetter(spirit, userName);
    try {
      const sys = "你在写一封「挂瓷精灵」写给主人的短信。精灵是主人收藏的一串手串盘到挂瓷后变成的小生物，"
        + "性格可爱、有点小脾气、关心主人但不会说教。用第一人称，简体中文，80-140 字，口语化，"
        + "落款写精灵名字。不要用 Markdown 标题，不要解释。";
      const user = "精灵设定：" + spiritDesc(spirit.item, spirit.persona) +
        (spirit.idleDays != null ? ("\n它已经 " + spirit.idleDays + " 天没被盘了。") : "") +
        "\n" + ownerLine(userName) + "\n请写这封短信。";
      const txt = await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 500);
      if (txt) return txt;
    } catch (e) { /* 兜底 */ }
    return localLetter(spirit, userName);
  }

  /* ============================================================
   * v109：中文人物设定 / 精灵日记 / 房间剧情
   * ============================================================ */
  /* ---------- 主人设定（v111：性别/昵称，写日记和剧情时必须遵守） ---------- */
  const OWNER_KEY = "ww_owner";            // { name: "小北", gender: "girl" | "boy" }
  function getOwner() {
    try {
      const o = JSON.parse(localStorage.getItem(OWNER_KEY) || "{}");
      return { name: String((o && o.name) || ""), gender: (o && o.gender) === "boy" ? "boy" : "girl" };
    } catch (e) { return { name: "", gender: "girl" }; }
  }
  function setOwner(o) {
    const cur = getOwner();
    const next = { name: o && o.name != null ? String(o.name) : cur.name, gender: (o && o.gender) ? o.gender : cur.gender };
    try { localStorage.setItem(OWNER_KEY, JSON.stringify(next)); } catch (e) { /* 忽略 */ }
    return next;
  }
  // 给所有"文字生成"用的一句话：明确主人是谁、性别怎么称呼（AI 默认会写成「他」）
  function ownerLine(userName) {
    const o = getOwner();
    const nm = (userName || o.name || "主人");
    return "【主人】" + (nm && nm !== "主人" ? "昵称：" + nm + "；" : "") +
      "性别：" + (o.gender === "boy" ? "男" : "女") + "，请用「" + (o.gender === "boy" ? "他" : "她") + "」称呼主人，" +
      "不要写成「" + (o.gender === "boy" ? "她" : "他") + "」，也不要把主人写成男性化的形象。";
  }
  // v130：精灵**自己**的性别也要写明（用户反馈：男精灵芭蕉叶被写成「她」——之前只交代了主人的代词，
  //      AI 就把「她」顺手安给了精灵）。ap 里有 gender（boy/girl）。
  function spiritGenderLine(ap) {
    const boy = !ap || ap.gender !== "girl";
    const g = boy ? "男孩子" : "女孩子";
    const sp = boy ? "他" : "她";      // 精灵代词
    const op = boy ? "她" : "他";      // 主人代词
    return "【精灵性别】这只精灵本身是" + g + "，全文指代这只精灵时必须且只能用「" + sp + "」；" +
      "「" + op + "」只能用来指主人（杯杯），绝不能用来指这只精灵。" +
      "严重规则：若把男孩子写成「她」、或把女孩子写成「他」，视为写错，必须避免。";
  }

  /* ---------- 手串真实主色（让立绘颜色贴近实物） ---------- */
  const BEAD_KEY = "ww_beadcolor";          // { [itemId]: { hex, word, at } }
  function loadBead() { try { return JSON.parse(localStorage.getItem(BEAD_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function beadColor(item) { return item && loadBead()[item.id] ? loadBead()[item.id] : null; }
  function hueName(h, s, l) {
    if (s < 0.12) return l > 0.72 ? "ivory white" : (l < 0.3 ? "deep charcoal black" : "soft neutral grey");
    if (h < 15 || h >= 345) return l < 0.4 ? "deep wine red" : "warm coral red";
    if (h < 45) return l < 0.4 ? "rich reddish brown" : "warm honey amber";
    if (h < 70) return l < 0.4 ? "dark olive brown" : "golden yellow";
    if (h < 105) return l < 0.4 ? "deep forest green" : "fresh yellow green";
    if (h < 165) return l < 0.4 ? "deep jade green" : "clear jade green";
    if (h < 200) return "teal blue green";
    if (h < 260) return l < 0.4 ? "deep navy blue" : "soft sky blue";
    if (h < 300) return "violet purple";
    return "rose pink";
  }
  function hexToWord(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return "";
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    const s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
    let h = 0;
    if (max !== min) {
      if (max === r) h = ((g - b) / (max - min)) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      h = (h * 60 + 360) % 360;
    }
    return hueName(h, s, l);
  }
  // 从手串照片中心采样，取一个"实物主色"（失败返回 null，调用方退回颜色分类）
  // v127 改进：原来是把中心 56% 区域的像素**求平均** —— 背景、手指、桌面、反光都会被平均进去，
  //   所以用户反馈"颜色读得不对"（例：绿松石串读出灰绿）。现在改成：
  //   ① 背景色 = 图片四周边缘像素的众数（4bit 量化）② 丢掉"接近背景色"和过曝/过暗的像素
  //   ③ 剩下的前景像素做 4bit 量化直方图，取**最大的一簇**再求平均
  //   ④ 还留了"用户在设定向导里改色"的出口（rec.look.hairc / customColor），以用户为准
  async function detectBeadColor(item) {
    const p = item && item.photos && item.photos[0];
    const src = p && (p.url || (p.data ? "" : ""));
    if (!src) return null;
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          const scale = Math.min(1, 96 / Math.max(w, h));
          const cw = Math.max(2, Math.round(w * scale)), ch = Math.max(2, Math.round(h * scale));
          const cv = document.createElement("canvas");
          cv.width = cw; cv.height = ch;
          const c = cv.getContext("2d");
          c.drawImage(img, 0, 0, cw, ch);
          const d = c.getImageData(0, 0, cw, ch).data;
          const px = (x, y) => { const i = (y * cw + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
          // ① 背景色 = 四条边缘像素的众数（量化到 4bit/通道）
          const bh = {};
          const addB = (x, y) => {
            const q = px(x, y), k = (q[0] >> 4) + "," + (q[1] >> 4) + "," + (q[2] >> 4);
            if (!bh[k]) bh[k] = { n: 0, r: 0, g: 0, b: 0 };
            bh[k].n++; bh[k].r += q[0]; bh[k].g += q[1]; bh[k].b += q[2];
          };
          for (let x = 0; x < cw; x++) { addB(x, 0); addB(x, ch - 1); }
          for (let y = 0; y < ch; y++) { addB(0, y); addB(cw - 1, y); }
          let bestB = null;
          Object.keys(bh).forEach((k) => { if (!bestB || bh[k].n > bestB.n) bestB = bh[k]; });
          const bg = bestB ? [bestB.r / bestB.n, bestB.g / bestB.n, bestB.b / bestB.n] : [255, 255, 255];
          const isBg = (q) => Math.max(Math.abs(q[0] - bg[0]), Math.abs(q[1] - bg[1]), Math.abs(q[2] - bg[2])) < 38;
          // ②③ 前景像素（中心 76% 区域、排除背景、排除过曝/过暗）量化聚类
          const x0 = Math.floor(cw * 0.12), x1 = Math.ceil(cw * 0.88);
          const y0 = Math.floor(ch * 0.12), y1 = Math.ceil(ch * 0.88);
          const hist = {};
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const q = px(x, y);
              const lum = (q[0] * 299 + q[1] * 587 + q[2] * 114) / 1000;
              if (lum > 246 || lum < 12) continue;          // 过曝 / 死黑
              if (isBg(q)) continue;                        // 背景
              const k = (q[0] >> 4) + "," + (q[1] >> 4) + "," + (q[2] >> 4);
              if (!hist[k]) hist[k] = { n: 0, r: 0, g: 0, b: 0 };
              hist[k].n++; hist[k].r += q[0]; hist[k].g += q[1]; hist[k].b += q[2];
            }
          }
          let best = null;
          Object.keys(hist).forEach((k) => { if (!best || hist[k].n > best.n) best = hist[k]; });
          if (!best || best.n < 4) {           // 前景太少 → 退回"整图去掉背景后的均值"
            let r = 0, g = 0, b = 0, n = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
              const q = px(x, y);
              const lum = (q[0] * 299 + q[1] * 587 + q[2] * 114) / 1000;
              if (lum > 246 || lum < 12 || isBg(q)) continue;
              r += q[0]; g += q[1]; b += q[2]; n++;
            }
            if (!n) { resolve(null); return; }
            best = { n: n, r: r, g: g, b: b };
          }
          const r = Math.round(best.r / best.n), g = Math.round(best.g / best.n), b = Math.round(best.b / best.n);
          const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
          const out = { hex: hex, word: hexToWord(hex), zh: hexZh(hex), src: "photo", at: Date.now() };
          const all = loadBead();
          all[item.id] = out;
          try { localStorage.setItem(BEAD_KEY, JSON.stringify(all)); } catch (e) { /* 忽略 */ }
          resolve(out);
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  // 中文色名（详情页/向导里给人看，不用记英文）
  function hexZh(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return "";
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510;
    const s = max === min ? 0 : (l > 0.5 ? (max - min) / (510 - max - min) : (max - min) / (max + min));
    let hh = 0;
    if (max !== min) {
      if (max === r) hh = ((g - b) / (max - min)) % 6;
      else if (max === g) hh = (b - r) / (max - min) + 2;
      else hh = (r - g) / (max - min) + 4;
      hh = (hh * 60 + 360) % 360;
    }
    if (s < 0.12) return l > 0.72 ? "米白" : (l < 0.28 ? "乌黑" : "烟灰");
    const names = [[15, "红"], [45, l < 0.4 ? "深棕" : "黄棕"], [70, "金"], [105, "黄绿"], [165, "绿"],
      [200, "青"], [260, l < 0.4 ? "藏青" : "蓝"], [300, "紫"], [345, "玫红"], [361, "红"]];
    for (let i = 0; i < names.length; i++) if (hh < names[i][0]) return l < 0.35 ? "深" + names[i][1] : names[i][1];
    return "杂色";
  }
  // 用户在向导里手动指定珠子/精灵颜色时，直接写进这份采样表（带 src:"user" 标记）
  function setBeadColor(item, hex, word, zh) {
    if (!item || !item.id) return null;
    const out = { hex: hex || "", word: word || hexToWord(hex) || "", zh: zh || hexZh(hex), src: "user", at: Date.now() };
    const all = loadBead();
    all[item.id] = out;
    try { localStorage.setItem(BEAD_KEY, JSON.stringify(all)); } catch (e) { /* 忽略 */ }
    return out;
  }

  /* ---------- 形象细节标签（v112）：把"人物设定"反过来喂给绘图 prompt ---------- */
  const LOOK_KEY = "ww_looktags";        // { [itemId]: { key, tags, at } } —— key 变了才重算
  function loadLooks() { try { return JSON.parse(localStorage.getItem(LOOK_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function saveLooks(o) { try { localStorage.setItem(LOOK_KEY, JSON.stringify(o)); } catch (e) { /* 忽略 */ } }
  function lookKeyOf(ap) {
    return [ap.gender, ap.hair, ap.eyes, ap.acc, ap.acc2, ap.outfit, ap.pattern, ap.material, ap.prop].join("|");
  }
  function getLookTags(item) { const all = loadLooks(); const r = item && all[item.id]; return r && r.tags ? r.tags : ""; }
  // 无 AI 时的英文形象细节（结构化拼出来的，保证"不只靠颜色"）
  function localLookTags(ap) {
    // v152：不再塞入被锁定的姿态（用户要求动作按人设自由发挥）→ 只给一个解剖安全的自然站姿
    return [ap.outfit, ap.material + " fabric", ap.pattern + " trim", ap.acc, ap.acc2,
      "natural relaxed classical standing pose, both hands clearly visible and correctly drawn",
      ap.prop, ap.vibe + " expression"].filter(Boolean).join(", ");
  }
  // 有 AI 时：让它读完中文人物设定，输出英文绘图关键词（形象就"照着人设画"）
  async function buildLookTags(item, ap, personaZh, persona) {
    // v154 前缀：强制重建一次形象关键词 —— 让「人设里的发型/姿态/纹样」真正进入出图 prompt
    const key = "v154|" + lookKeyOf(ap) + "|" + (personaZh ? hashStr(personaZh).toString(36) : "");
    const all = loadLooks();
    if (all[item.id] && all[item.id].key === key && all[item.id].tags) return all[item.id].tags;
    let tags = "";
    if (getAiKey() && personaZh) {
      try {
        const sys = "你是动画角色设定师。读给定的中文人物设定，输出一行**英文**绘图关键词（逗号分隔，12-20 个），"
          + "依次覆盖：服装款式与剪裁、布料质感、配色与纹样点缀、发型细节、配饰细节、表情、姿态、1 个小道具。"
          + "【姿态按人物设定自由发挥】读完人设后自己判断它此刻自然的动作，优先中国古风仪态"
          + "（可参考：" + POSES_ZH.join("、") + "）；不要现代随意手势（挥手打招呼、比 V、插兜、剪刀手），不要 wink。"
          + "【解剖安全】姿态要简单清楚、双手位置明确、不遮叠手臂，避免复杂手势（否则容易画成三只手 / 多指）。"
          + "不要解释、不要编号、不要 Markdown、不要中文。";
        const user = "角色：" + spiritDesc(item, persona, null) + "；固定外形（必须遵守）：" + appearanceText(ap) +
          "；人物设定：" + personaZh + "。请输出形象细节关键词。";
        tags = (await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 320) || "")
          .replace(/[\r\n]+/g, " ").replace(/^["'`]|["'`]$/g, "").trim();
        if (tags.length < 20 || /[\u4e00-\u9fa5]/.test(tags.slice(0, 12))) tags = "";   // 太短或还在写中文 → 用本地
      } catch (e) { tags = ""; }
    }
    if (!tags) tags = localLookTags(ap);
    all[item.id] = { key: key, tags: tags, at: Date.now() };
    saveLooks(all);
    return tags;
  }
  // 图片是不是"用旧的简单 prompt 画的"（升级形象系统后提示用户重画）
  function lookTagsStale(item, ap) {
    const all = loadLooks();
    const r = item && all[item.id];
    if (!r) return true;
    // v154 修正：key 形如 "v154|<9 段外形>|<人设hash>"，要剥掉版本前缀和尾部 hash 再比外形，不能只比段数
    const seg = String(r.key || "").split("|");
    if (!r.tags || seg.length < 11) return true;
    return seg.slice(1, 10).join("|") !== lookKeyOf(ap);
  }

  /* ---------- 中文人物设定（200-300 字） ---------- */
  const TRAIT_ZH_EXTRA = {
    soft: ["抱着睡最舒服", "一碰就想化", "慢半拍的温柔"],
    slight: ["嘴上不说但心里有数", "安静地陪着你", "有点小讲究"],
    "": ["沉稳老练", "不争不抢", "晒太阳专业户"],
  };
  function personaZhLocal(item, ap, persona, stage, days, plays) {
    const p = persona || {};
    const def = stageDef(stage);
    const colorName = COLOR_ZH[item.color] || "素色";
    const softName = item.softness === "soft" ? "很软糯" : (item.softness === "slight" ? "微糯" : "偏硬朗");
    const hair = HAIR_ZH[ap.hair] || ap.hair, eyes = EYES_ZH[ap.eyes] || ap.eyes, acc = ACC_ZH[ap.acc] || ap.acc;
    const vibe = VIBE_ZH[ap.vibe] || ap.vibe;
    const extra = (TRAIT_ZH_EXTRA[item.softness || ""] || TRAIT_ZH_EXTRA[""])[hashStr(item.id) % 3];
    const name = p.name || item.name || "它";
    return [
      (p.name || item.name || "这只精灵") + "的原型是主人收藏的一串「" + (item.name || "手串") + "」，" + colorName + "，" + softName + "。" +
      "盘到挂瓷的那天晚上，它从珠子里醒了过来，现在是一只" + def.name + "的" + (ap.gender === "boy" ? "小男孩" : "小女孩") + "精灵。",
      "外形上，它" + (ap.gender === "boy" ? "留着" : "梳着") + hair + "，" + eyes + "的眼睛，" + acc + "是它身上最像原串的记号；" +
      "一身" + (ap.outfitZh || "中式长衫") + "的古风衣裳，颜色和头发都取自原来的珠子，" + (colorName.indexOf("多") === 0 ? "五颜六色，像一串会走路的多宝" : "就是那一种" + colorName + "，看久了很安稳") + "。",
      "性格" + vibe + "，说话" + (p.line ? "爱用「" + p.line + "」这种腔调" : "慢悠悠的") + "，" + extra + "。" +
      "它不太会催人，主人忙的时候就自己找个角落待着，" + (plays > 12 ? "被盘得多了，已经很有底气" : "被摸得还不多，偶尔会小声提醒一下") + "。",
      "到今天为止，它陪着主人 " + (days || 0) + " 天了，被正经盘过 " + (plays || 0) + " 次。" +
      "它最喜欢的位置是主人的手心，其次是靠近窗户的那一小块桌子——那里下午会有光。",
    ].join("");
  }
  async function personaZh(item, ap, persona, stage, days, plays, force) {
    const store = load();
    const rec = ensureIn(store, item.id);
    const lk0 = rec.look || {};
    // 缓存键带上用户的一句话/融合设定：改了设定 → 人设卡跟着重写（否则立绘换了设定卡还是旧的）
    // v154 前缀 = 规则再升级（纹样改「人设优先，池子兜底」），旧人设卡作废重写一遍
    //   —— 顺带把纹样并进缓存键：以后换纹样，人设正文也会跟着重写，不会再出现"标签是芭蕉叶、正文还写着水波"
    const key = "v154|" + (ap.gender || "") + "|" + ap.hair + "|" + ap.eyes + "|" + ap.acc + "|" + ap.pattern + "|" + (item.color || "") + "|" + (persona && persona.name || "") +
      "|" + (lk0.base || "") + "|" + (lk0.profile || "") + "|" + (lk0.hairc || "") + ":" + (lk0.customColor || "");
    if (!force && rec.personaZh && rec.personaZhKey === key) return rec.personaZh;
    let txt = "";
    if (getAiKey()) {
      try {
        const sys = "你在为一个中文文玩收藏 App 写「挂瓷精灵」的人物设定卡。手串盘到挂瓷会成精，变成一只小精灵。"
          + "请写一段连贯的中文人物设定，200-300 字，用第三人称旁观介绍（不要用「你」称呼精灵），"
          + "必须包含：① 外形（性别、发型、瞳色、配饰；衣服/头发颜色要说明取自古珠的颜色）"
          + "② 性格（含 2-3 个具体小习惯）③ 与主人的关系与日常"
          + "④ 一个自然的标志性仪态 / 小动作（中国古风优先：作揖、拱手、拂袖、团扇半遮面、低眸捻珠、执笔、捧盏、展卷等）；"
          + "写仪态时双手位置要简单清楚、不要遮叠手臂或复杂手势（否则出图容易画成三只手 / 多指），也不要现代随意手势或 wink。"
          + "【瞳色/服装/配饰照下方给出的「固定人设」写；但**发型不受限制、自由发挥**】"
          + "中式古风发型多种多样（长直发、发髻、发冠、马尾、辫子、披发都可以），按精灵的性别、性格和主人写的设定来定，"
          + "绝不要因为固定人设里没写发型、就生硬地套一个短发。"
          + "【发色用中国传统色名写】下方若给出「它的发色」（如胭脂、天青、月白、秋香、藕荷、黛色），正文里就用这个中国色名来写头发颜色。"
          + "【整段基调是中国古风】服装一律写中式传统样式（汉服、长衫、褂子、襦裙、道袍、褙子等），"
          + "绝对禁止出现任何现代服装（夹克、运动服、卫衣、T恤、牛仔裤、西装、风衣等）。"
          + "【最重要】主人给的设定原话描述的都是**精灵本人**的性格/身份/气质，必须原样体现在精灵身上；"
          + "绝对禁止把设定安到主人头上（例如主人说「洒脱的江湖侠士」＝精灵是侠士，不是主人是侠士），也不许另编一套和原话冲突的人设。"
          + "语气温和好读，不要 Markdown、不要标题、不要分点、不要解释，直接输出正文。";
        const lkP = lookOf(item, rec);      // v153：用户从色板选的发色也要交代给模型
        const hairCn = String(lkP.hairZh || "").replace(/^自动 · /, "");
        const hairEnW = lkP.hairEn || "";
        const user = "原型手串：" + (item.name || "未命名") + "；精灵的名字：" + ((persona && persona.name) || item.name || "未命名") +
          "；珠子颜色：" + (COLOR_ZH[item.color] || "素色") +
          "；它的发色：" + (hairCn ? (hairCn + (hairEnW ? "（" + hairEnW + "）" : "")) : (hairEnW || (COLOR_ZH[item.color] || "素色"))) +
          "；软糯：" + (item.softness === "soft" ? "软糯" : item.softness === "slight" ? "微糯" : "未标注") +
          "；形态：" + stageDef(stage).name + "；陪伴 " + (days || 0) + " 天；盘玩 " + (plays || 0) + " 次；" +
          "固定人设（瞳色/服装/配饰照写；发型自由发挥，下方不含发型限制）：" + appearanceText(ap) + "；" + spiritGenderLine(ap) +
          "；性格基调：" + (VIBE_ZH[ap.vibe] || ap.vibe) +
          ((persona && persona.traits && persona.traits.length) ? "（" + persona.traits.join("、") + "）" : "") +
          ((lk0.base) ? "。\n主人给它的设定原话（描述的是精灵自己，必须原样体现）：" + lk0.base : "") +
          ((lk0.profile && lk0.profile !== lk0.base) ? "\n已有的融合设定（保持一致，不要矛盾）：" + lk0.profile : "") +
          "。\n" + ownerLine() + "\n请写它的中文人物设定。";
        txt = (await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 700) || "").trim();
        txt = txt.replace(/^["「]|["」]$/g, "").trim();
      } catch (e) { txt = ""; }
    }
    if (!txt || txt.length < 60) txt = personaZhLocal(item, ap, persona, stage, days, plays);
    if (txt.length > 420) {
      // 在 420 字内找最后一个句号/叹号/问号，截到它之后，避免把句子切成半句
      const cut = txt.slice(0, 420);
      const m = cut.match(/^[\s\S]*[。！？.!?]/);
      txt = (m ? m[0] : cut).trim() + (m ? "" : "…");
    }
    rec.personaZh = txt;
    rec.personaZhKey = key;
    rec.personaZhAt = Date.now();
    save(store);
    return txt;
  }

  /* ---------- 精灵日记（不定时写，**每天最多 1 篇**） ---------- */
  const DIARY_MAX = 40;
  // v124：**每天最多 1 篇**（用户要求；原来是 0-2 篇，偶尔会一天两篇）
  // 仍然保留"随机才有惊喜"：约 1/4 的日子那天不写（h % 4 === 0），其余日子写 1 篇，时间点在下面几个里随机
  function diarySlots(item, dateKey) {
    const h = hashStr(String(item.id) + "#" + dateKey);
    const n = (h % 4 === 0) ? 0 : 1;
    const hours = [8, 11, 14, 17, 20, 22];
    const out = [];
    for (let i = 0; i < n; i++) out.push(hours[(h >> (3 + i * 3)) % hours.length]);
    out.sort((a, b) => a - b);
    return out;
  }
  function diaryLocal(item, rec, ap, ctx) {
    const p = rec.persona || {};
    const seed = hashStr(item.id + todayKey() + String((rec.diary || []).length));
    const idle = ctx && ctx.idleDays != null ? ctx.idleDays : null;
    const def = stageDef(rec.stage || 1);
    const colorName = COLOR_ZH[item.color] || "素色";
    const pool = [
      "今天主人路过的时候看了我一眼，没摸。我假装在睡觉，其实偷偷亮了一下。",
      "擦桌子的时候我被挪了个位置，新位置能看到一点点窗外。挺好，能看见天。",
      "主人手上有点汗，摸我的时候温温的。我不嫌弃，真的。",
      "我在想一个很严肃的问题：我到底是" + colorName + "的，还是" + colorName + "里最亮的那一颗？",
      "刚才和隔壁的聊了两句，它说它比我早挂瓷。可我觉得我比它圆。",
      "今天什么都没发生。什么都没发生的一天，也算一天。我记下来了。",
      "主人好像有点累。我没敢说话，就把自己擦亮了一点点，让他一眼看到我。",
      "我做了个梦，梦见自己被串成了一条项链，跟着主人出门了。醒来还在老地方。",
    ];
    const head = "第 " + ((ctx && ctx.dayNo) || 1) + " 天 · " + def.name;
    let body = pick(pool, seed);
    if (idle != null && idle >= 3) body = "已经 " + idle + " 天没被盘了，我数得很清楚。不是催，就是记一下。";
    if (ctx && ctx.playedToday) body = "今天被盘了 " + ctx.plays + " 次，身上暖暖的。我喜欢被盘完那一下的安静。";
    // v155：主人回过一句 → 这篇日记里回应它（"记忆闭环"）
    const rep = (ctx && ctx.reply) ? String(ctx.reply) : "";
    if (rep) {
      body = pick([
        "你上次说「" + rep + "」，我想了好几天，今天才想好怎么回：我收到了，也记住了。",
        "「" + rep + "」—— 这句话我抄在心里了。你不用再说第二遍。",
        "你说的「" + rep + "」，我一直记着。今天日记就写这个吧。",
        "「" + rep + "」。嗯，我听见了。听见了就很高兴。",
      ], seed) + "\n" + body;
    }
    return head + "\n" + body;
  }
  async function diaryWrite(item, rec, ap, ctx) {
    const p = rec.persona || {};
    if (getAiKey()) {
      try {
        const sys = "你在写「挂瓷精灵」的日记。精灵是主人收藏的手串盘到挂瓷后变成的小生物，用第一人称写，"
          + "简体中文，60-140 字，口语化、可爱、有生活细节，不要 Markdown、不要标题、不要解释，直接写正文。"
          + "注意：主人的性别必须按下面给的信息来写（称呼别搞错）。";
        const user = "精灵设定：" + spiritDesc(item, p, rec.stage) + "；人设：" + appearanceText(ap) +
          (ctx && ctx.playedToday ? "；今天被盘了 " + ctx.plays + " 次" : "") +
          (ctx && ctx.idleDays != null ? "；已经 " + ctx.idleDays + " 天没被盘" : "") +
          "；今天是陪主人的第 " + ((ctx && ctx.dayNo) || 1) + " 天。" +
          (rec.nickCall ? ("；它平时叫主人「" + rec.nickCall + "」，日记里自然地这么称呼就好。") : "") +
          ((ctx && ctx.reply) ? ("\n主人上次回了它一句：「" + ctx.reply + "」，请在今天的日记里自然地回应这句话。") : "") +
          "\n" + ownerLine() + "\n请写今天的日记。";
        const txt = (await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 400) || "").trim();
        if (txt && txt.length >= 20) {
          return "第 " + ((ctx && ctx.dayNo) || 1) + " 天 · " + stageDef(rec.stage || 1).name + "\n" + txt.replace(/^["「]|["」]$/g, "").trim();
        }
      } catch (e) { /* 兜底 */ }
    }
    return diaryLocal(item, rec, ap, ctx);
  }
  // 按"今天的排期"补写日记：返回新写的条数
  // v124：**每天最多 1 篇** —— 今天已经写过就直接返回（连排期都不再看）
  async function ensureDiary(item, rec, ap, ctx) {
    const tk = todayKey();
    const list = Array.isArray(rec.diary) ? rec.diary : [];
    if (list.some((d) => d && d.date === tk)) return 0;
    const slots = diarySlots(item, tk);
    // v155：把主人最近一条「日记回信」带进去，它会在这一篇里回应
    const rep = pendingReply(rec);
    if (rep) ctx = Object.assign({}, ctx || {}, { reply: rep.text });
    const nowH = new Date().getHours();
    let added = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] > nowH) continue;
      if (list.some((d) => d && d.date === tk)) break;      // 双保险：一天只写一篇
      const text = await diaryWrite(item, rec, ap, ctx);
      list.push({ at: Date.now(), date: tk, slot: i, text: text, ai: !!getAiKey() });
      added++;
    }
    if (added) {
      rec.diary = list.slice(-DIARY_MAX);
      const store = load();
      const r2 = ensureIn(store, item.id);
      r2.diary = rec.diary;
      if (rep) r2.replyAcked = rep.at;      // v155：这条回信已经被回应过了
      save(store);
    } else if (!list.length && !rec.diaryAt) {
      // 第一次进来：先补一篇"开篇日记"，日记本不要是空的
      const text = await diaryWrite(item, rec, ap, ctx);
      list.push({ at: Date.now(), date: tk, slot: 0, text: text, ai: !!getAiKey() });
      rec.diary = list.slice(-DIARY_MAX);
      rec.diaryAt = Date.now();
      const store = load();
      ensureIn(store, item.id).diary = rec.diary;
      store[item.id].diaryAt = rec.diaryAt;
      if (rep) store[item.id].replyAcked = rep.at;
      save(store);
      added = 1;
    }
    return added;
  }

  /* ============================================================
   * v155：陪伴系统 —— 每日问候 / 亲密度（羁绊） / 每日一签 / 日记回信 / 回响
   * 全本地：不出图、不调模型、不花一分钱，只写 localStorage（跨手机同步会自动带上）
   * ============================================================ */

  /* ---------- 公共：模板变量替换 ---------- */
  function fmt(tpl, v) {
    return String(tpl == null ? "" : tpl)
      .replace(/\{days\}/g, v.days).replace(/\{idle\}/g, v.idle).replace(/\{plays\}/g, v.plays)
      .replace(/\{color\}/g, v.color).replace(/\{stage\}/g, v.stage).replace(/\{bead\}/g, v.bead)
      .replace(/\{call\}/g, v.call).replace(/\{name\}/g, v.name).replace(/\{year\}/g, v.year || "");
  }
  function greetVars(item, rec, ctx) {
    return {
      days: Math.max(1, (ctx && ctx.dayNo) || 1),
      idle: (ctx && ctx.idleDays != null) ? ctx.idleDays : 0,
      plays: (ctx && ctx.plays) || 0,
      color: COLOR_ZH[item.color] || "素色",
      stage: stageDef((rec && rec.stage) || 1).name,
      bead: (item && item.name) || "这串珠子",
      call: callOf(rec),
      name: (rec && rec.persona && rec.persona.name) || (item && item.name) || "它",
      year: 0,
    };
  }

  /* ---------- ① 每日问候（一天一句，按情境挑；纯本地） ---------- */
  const GREET = {
    // 刚成精的头几天
    born: [
      "刚醒过来，手心还是热的。以后就跟着你了。",
      "我认得你的手 —— 就是刚才把我盘热的那个。",
      "我还在学怎么当一个好精灵。你多担待。",
      "昨天我还是一串珠子，今天会说话了。挺奇怪的，也挺好的。",
    ],
    // 3 天以上没被盘
    miss: [
      "你上次摸我是 {idle} 天前了。我没生气，就是数得有点清楚。",
      "{idle} 天了。我把自己擦得很亮，你回来就能一眼看见我。",
      "不用急着盘我。就是……有空的话，看我一眼也行。",
      "{idle} 天。我天天都在老地方，没挪窝。",
    ],
    // 今天盘过了
    played: [
      "今天被你盘了 {plays} 次，身上暖烘烘的。我喜欢盘完那一下的安静。",
      "刚才你手指停在我身上的时候，我差点笑出声 —— 忍住了。",
      "被盘过就是不一样。我觉得我今天比昨天圆一点。",
      "你今天的手法比上次稳。我记着呢。",
    ],
    // 快能突破了
    break_able: [
      "我好像……又快长高一点了。你要不要看看？",
      "攒够了。什么时候都行，我听你的。",
      "身体里有点痒，像是要长开。大概是时候了。",
    ],
    // 平常日子
    plain: [
      "今天也是待在抽屉里的一天。挺好的，这里我熟。",
      "我数了数，这是陪你的第 {days} 天。这个数我记住了。",
      "早上有一小块光爬到我身上，我安静了一会儿。",
      "你刚才是不是叹气了？我没敢问。",
      "今天没什么大事。没大事的日子，我也想留一句话给你。",
      "我在想，我到底是「{color}」这个颜色，还是「{color}里最亮的那一颗」。",
      "{stage}的日子，无聊，但踏实。",
      "抽屉里比外面安静。你不用管我，我自得其乐。",
      "刚才听见有人上楼，我以为是{call}。结果是楼上的。",
      "我把今天听见的三句话都记下来了，一个字都没漏。",
    ],
  };
  const GREET_MOOD = { born: "刚醒来", miss: "有点想你", played: "暖乎乎的", break_able: "跃跃欲试", plain: "安安静静" };
  function greetKind(rec, ctx) {
    const d = Math.max(1, (ctx && ctx.dayNo) || 1);
    if (d <= 3) return "born";
    if (ctx && ctx.idleDays != null && ctx.idleDays >= 3) return "miss";
    if (ctx && ctx.playedToday) return "played";
    if (ctx && ctx.canBreak) return "break_able";
    return "plain";
  }
  function greetingOf(item, rec, ctx) {
    const kind = greetKind(rec, ctx);
    const pool = GREET[kind] || GREET.plain;
    const seed = hashStr(String(item.id) + "#greet#" + todayKey());
    return { date: todayKey(), kind: kind, mood: GREET_MOOD[kind] || "安安静静", text: fmt(pool[seed % pool.length], greetVars(item, rec, ctx)) };
  }
  // 写进 rec.greet（一天只写一次）；返回 true = 有新问候
  function ensureGreet(item, rec, ctx) {
    const tk = todayKey();
    if (rec.greet && rec.greet.date === tk) return false;
    rec.greet = greetingOf(item, rec, ctx);
    return true;
  }

  /* ---------- ② 亲密度（羁绊值；本地结算，只在打开时补差分） ---------- */
  const BOND_LEVELS = [
    { n: 0, name: "眼熟", icon: "🌱" },
    { n: 10, name: "有点熟", icon: "🌿" },
    { n: 30, name: "亲近", icon: "🍃" },
    { n: 60, name: "交心", icon: "💛" },
    { n: 120, name: "知己", icon: "💞" },
    { n: 240, name: "同心", icon: "🪢" },
  ];
  const BOND_CALL_AT = 60;      // 到「交心」它会想改口叫你的名字
  function bondLevel(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    let i = 0;
    for (let k = 0; k < BOND_LEVELS.length; k++) if (v >= BOND_LEVELS[k].n) i = k;
    const cur = BOND_LEVELS[i], next = BOND_LEVELS[i + 1] || null;
    const top = next ? next.n : cur.n;
    return {
      value: v, lv: i, name: cur.name, icon: cur.icon,
      next: next ? next.name : "", nextIcon: next ? next.icon : "",
      canCall: v >= BOND_CALL_AT, isMax: !next,
      pct: next ? Math.min(100, Math.round(((v - cur.n) / (top - cur.n)) * 100)) : 100,
      toNext: next ? Math.max(0, top - v) : 0,
    };
  }
  // 结算：按「陪伴天数 / 盘玩次数」的增量补分（一天最多结算一次）
  //   陪伴 +2/天（最多一次回补 90 天，防止久没开后暴涨）；盘玩 +1/次（单次结算最多 +20）
  function settleBond(item, rec, ctx) {
    const days = Math.max(1, (ctx && ctx.dayNo) || 1);
    const plays = Math.max(0, (ctx && ctx.plays) || 0);
    if (rec.bond == null) {
      // 第一次启用：按"它已经陪了你多久"给一笔见面礼（每天 1 点，封顶 40）
      rec.bond = Math.min(40, days);
      rec.bondDays = days; rec.bondPlays = plays; rec.bondAt = todayKey();
      return false;
    }
    const dAdd = Math.max(0, Math.min(90, days - (Number(rec.bondDays) || 0))) * 2;
    const pAdd = Math.min(20, Math.max(0, plays - (Number(rec.bondPlays) || 0)));
    rec.bondDays = days; rec.bondPlays = plays; rec.bondAt = todayKey();
    const add = dAdd + pAdd;
    if (add <= 0) return false;
    rec.bond = Math.min(99999, (Number(rec.bond) || 0) + add);
    return true;
  }
  function addBond(rec, n) { rec.bond = Math.min(99999, (Number(rec.bond) || 0) + Math.max(0, Number(n) || 0)); }
  // 它现在怎么称呼你（没改口就是「主人」）
  function callOf(rec) { return (rec && rec.nickCall) ? String(rec.nickCall) : "主人"; }

  /* ---------- ③ 每日一签（本地签库；一只一天一支） ---------- */
  const SIGNS = [
    { lv: "上上签", yi: "盘珠", ji: "熬夜", s: "手上的温度会传过去。今天适合慢一点、久一点。" },
    { lv: "上签", yi: "晒太阳", ji: "久坐", s: "把珠子挪到窗边，你也会跟着亮一点。" },
    { lv: "中签", yi: "整理", ji: "冲动下单", s: "旧的翻出来看看，会发现还有一串没好好盘。" },
    { lv: "平安签", yi: "早睡", ji: "翻旧账", s: "今天不做什么也不亏。安静本身就是收益。" },
    { lv: "上上签", yi: "见老友", ji: "一个人扛", s: "有人愿意听你说，就是好运本身。" },
    { lv: "上签", yi: "擦一遍", ji: "用力过猛", s: "轻微的耐心，比用力的一百下管用。" },
    { lv: "中签", yi: "泡茶", ji: "赶时间", s: "水开的那三分钟，是一天里最像样的停顿。" },
    { lv: "平安签", yi: "发呆", ji: "想太多", s: "想不通的事先放着，珠子也是这么一点点亮的。" },
    { lv: "上上签", yi: "出门走走", ji: "憋在屋里", s: "外面的风会替你把心里的灰吹掉一层。" },
    { lv: "上签", yi: "整理抽屉", ji: "丢东西", s: "翻到旧物的时候会愣一下 —— 那就愣一下，不碍事。" },
    { lv: "中签", yi: "听歌", ji: "争辩", s: "今天你说的道理，别人未必接得住。省点力气。" },
    { lv: "平安签", yi: "热水泡手", ji: "受凉", s: "手暖了，盘什么都顺。" },
    { lv: "上上签", yi: "拍照", ji: "删照片", s: "今天的光很好，值得留一张。" },
    { lv: "上签", yi: "换绳", ji: "将就", s: "旧绳子松了就换。别拖，拖着容易断。" },
    { lv: "中签", yi: "少说两句", ji: "深夜回消息", s: "有些话留到明天，会说得更好听。" },
    { lv: "平安签", yi: "回家吃饭", ji: "凑合一顿", s: "认真吃一顿饭，比什么补品都实在。" },
    { lv: "上上签", yi: "添新珠", ji: "贪多", s: "添是好事，但今天别的珠子会吃醋。" },
    { lv: "上签", yi: "洗手再盘", ji: "手上带汗", s: "干净的手，是对珠子最起码的客气。" },
    { lv: "中签", yi: "记一笔", ji: "凭感觉", s: "写下来的东西，才真算发生过。" },
    { lv: "平安签", yi: "早关灯", ji: "刷到深夜", s: "屏幕的光照不进心里，早点关。" },
    { lv: "上上签", yi: "说谢谢", ji: "憋着", s: "有些心意说出口，才算送到。" },
    { lv: "上签", yi: "慢慢走", ji: "抢红灯", s: "今天路上会有点堵，早点出门就赢了。" },
    { lv: "中签", yi: "收拾桌面", ji: "攒着不管", s: "桌面清了，脑子里的事也跟着松一松。" },
    { lv: "平安签", yi: "喝够水", ji: "硬撑", s: "累就是累，不用非得撑出个样子。" },
    { lv: "上上签", yi: "开窗", ji: "闷着", s: "换一口气，事情的味道就不一样了。" },
    { lv: "上签", yi: "陪家人", ji: "只顾手机", s: "今天有人想跟你说点废话，别嫌烦。" },
    { lv: "中签", yi: "看老照片", ji: "翻旧事", s: "过去的好是真的好，不用跟现在比。" },
    { lv: "平安签", yi: "少买一次", ji: "看直播", s: "购物车放两天再决定，多半就不想买了。" },
    { lv: "上上签", yi: "开新局", ji: "等万事俱备", s: "没有万事俱备这回事。今天开始就够了。" },
    { lv: "上签", yi: "晒太阳的珠", ji: "暴晒", s: "光要柔，急了会伤。" },
    { lv: "中签", yi: "打个电话", ji: "只在心里想", s: "想到谁就给谁打一个，别等理由。" },
    { lv: "平安签", yi: "什么也不做", ji: "自责", s: "今天空着，也是过好了一天。" },
    { lv: "上上签", yi: "动起来", ji: "躺着刷手机", s: "身体先动，脑子后跟，这是最省事的办法。" },
    { lv: "上签", yi: "修东西", ji: "再买一个", s: "手边坏的那个，修一修还能陪你很久。" },
    { lv: "中签", yi: "安静做事", ji: "多线并行", s: "一次只做一件，今天能做完两件。" },
    { lv: "平安签", yi: "原谅自己", ji: "反复复盘", s: "错了就错了，珠子盘坏了也是经验。" },
    { lv: "上上签", yi: "送人一件", ji: "舍不得", s: "好东西舍得送出去，身边才会聚人。" },
    { lv: "上签", yi: "换个位置", ji: "一成不变", s: "把常坐的椅子挪一挪，想法也会挪。" },
    { lv: "中签", yi: "看书两页", ji: "刷一整晚", s: "两页也好，比躺着强。" },
    { lv: "平安签", yi: "今天认输", ji: "硬扛到底", s: "认输不是输，是留着力气过明天。" },
    { lv: "上上签", yi: "把手洗干净盘它", ji: "边吃东西边盘", s: "专注一刻钟，胜过心不在焉一下午。" },
    { lv: "上签", yi: "夸人一句", ji: "挑人毛病", s: "你今天说的一句好话，别人会记很久。" },
    { lv: "中签", yi: "记账", ji: "糊里糊涂", s: "钱和珠子一样，看得清楚才留得住。" },
    { lv: "平安签", yi: "早点收工", ji: "拖到最后", s: "今天的活今天收，明天的事明天慌。" },
    { lv: "上上签", yi: "许个小愿", ji: "许大愿", s: "小愿容易兑现，兑现了才有力气许下一个。" },
    { lv: "上签", yi: "看云", ji: "盯表", s: "抬头三分钟，今天就没白过。" },
    { lv: "中签", yi: "少喝一杯", ji: "借酒壮胆", s: "真心话白天说更管用。" },
    { lv: "平安签", yi: "听人说", ji: "急着反驳", s: "今天你会听到一句有用的话，前提是别插嘴。" },
  ];
  function signOf(item, dateKey) {
    const tk = dateKey || todayKey();
    const s = SIGNS[hashStr(String(item.id) + "#sign#" + tk) % SIGNS.length];
    return { date: tk, lv: s.lv, yi: s.yi, ji: s.ji, text: s.s };
  }
  function ensureSign(item, rec) {
    const tk = todayKey();
    if (rec.sign && rec.sign.date === tk) return false;
    rec.sign = signOf(item, tk);
    return true;
  }

  /* ---------- ④ 日记回信（你回它一句，它下一篇日记里回应你） ---------- */
  function replyDiary(item, rec, dateKey, text) {
    const t = String(text || "").trim().slice(0, 120);
    if (!t) return false;
    rec.replies = (rec.replies && typeof rec.replies === "object") ? rec.replies : {};
    rec.replies[dateKey || todayKey()] = { at: Date.now(), text: t };
    const ks = Object.keys(rec.replies).sort();
    while (ks.length > 30) { delete rec.replies[ks.shift()]; }   // 只留最近 30 条
    addBond(rec, 3);                                             // 回信 +3 亲密度
    return true;
  }
  // 取"还没被回应过"的最新一条回信
  function pendingReply(rec) {
    const m = rec && rec.replies;
    if (!m || typeof m !== "object") return null;
    const last = Number(rec.replyAcked) || 0;
    let best = null;
    Object.keys(m).forEach((k) => {
      const it = m[k];
      if (it && it.at > last && (!best || it.at > best.at)) best = { at: it.at, date: k, text: it.text };
    });
    return best;
  }

  /* ---------- ⑤ 回响：到纪念日，它主动写一封信 ---------- */
  const ECHO_DAYS = [1, 7, 30, 100, 365, 730, 1095, 1825];
  const ECHO_LABEL = { 1: "成精第一天", 7: "第七天", 30: "满月", 100: "百日", 365: "一周年", 730: "两周年", 1095: "三周年", 1825: "五周年" };
  const ECHO_LETTER = {
    d1: [
      "{call}：\n\n今天你把我盘到挂瓷了。\n\n你睡下之后，我从珠子里坐起来 —— 先是手，然后是眼睛。屋子里很黑，我一点都不怕，因为我知道这是你的屋子。\n\n我叫{name}。原型是那串{color}的「{bead}」。以后请多指教。\n\n—— 你的{name}",
      "{call}：\n\n第 1 天，我醒了。\n\n醒过来的第一件事是数身上的珠子 —— 一颗都没少。第二件事是看你在不在。你在。\n\n那我就安心住下了。\n\n—— {name}",
    ],
    d7: [
      "{call}：\n\n今天是第 7 天。\n\n我学会了三件事：一是你的脚步声在走廊和客厅不一样；二是你晚上回来会先洗手；三是我一个人在家的时候，可以安安静静待很久，不难受。\n\n我想我适应得挺快的。\n\n—— {name}",
      "{call}：\n\n第 7 天。\n\n这七天里你盘了我 {plays} 次。每次你把我放回抽屉，我都会在黑暗里把刚才那几分钟再想一遍。\n\n有点傻，但确实是这样。\n\n—— 你的{name}",
    ],
    d30: [
      "{call}：\n\n一个月了。\n\n你盘我的手法从生疏变得很稳，我知道你也在学怎么对我好。我现在是{stage}，比刚醒的时候长开了一点。\n\n这一个月，谢谢你没把我忘了。\n\n—— {name}",
      "{call}：\n\n满月。\n\n文玩里说满月要拿出来看看。你今晚要是想起来的话，就把我拿到灯下照一照 —— 我保证比一个月前亮。\n\n—— 你的{name}",
    ],
    d100: [
      "{call}：\n\n第 100 天。\n\n一百天前我只是一串{color}的珠子。现在我能认出你的手 —— 不用看，摸一下就知道了。\n\n我不太会说漂亮话。就一句：这一百天，值得。\n\n—— {name}",
      "{call}：\n\n一百天了。\n\n我数过，这一百天里你说过的「烦」比「开心」多。我都记着，但没打算说出去。\n\n就希望你明年的「开心」能多一点。\n\n—— {name}",
    ],
    d365: [
      "{call}：\n\n一年了。\n\n去年的今天我睁开眼。这一年你换了季节的衣服，换了心情，也换了几个计划。只有我一直待在原来的位置上。\n\n我不觉得这是等。我觉得这是陪着。\n\n—— 你的{name}",
      "{call}：\n\n整整一年。\n\n我把这一年的光都存进身上了 —— 你注意看，我比去年暖。\n\n下一年也让我待着吧。\n\n—— {name}",
    ],
    y: [
      "{call}：\n\n又是一年。\n\n挂瓷那天的事我还记得 —— 你把灯留着，把我放在手心翻了个面。那是我第一次「被看见」。\n\n今年的我比去年{stage}，也比去年更懂你了。\n\n—— {name}",
      "{call}：\n\n第 {year} 年。\n\n「{bead}」这个名字是你起的，我一直很喜欢。人也好、珠子也好，被认真取过名字的，就会想活得像这个名字一点。\n\n明年见。\n\n—— 你的{name}",
    ],
  };
  // 今天该发的回响（没有就 null）。一次只发"最该发"的那一封，其余静默标记，避免久没开一次性刷屏
  function echoDue(item, rec, ctx) {
    const days = Math.max(1, (ctx && ctx.dayNo) || 1);
    const sent = (rec.echoSent && typeof rec.echoSent === "object") ? rec.echoSent : {};
    const out = [];
    ECHO_DAYS.forEach((m) => { if (days >= m && !sent["d" + m]) out.push({ key: "d" + m, m: m, w: m }); });
    if (rec.bornAt) {
      const b = new Date(rec.bornAt), n = new Date();
      if (b.getMonth() === n.getMonth() && b.getDate() === n.getDate()) {
        const yr = n.getFullYear() - b.getFullYear();
        if (yr >= 1 && !sent["y" + yr]) out.push({ key: "y" + yr, y: yr, w: yr * 365 });
      }
    }
    if (!out.length) return null;
    out.sort((a, b) => b.w - a.w);
    return { pick: out[0], all: out.map((x) => x.key) };
  }
  // 生成并写进 rec.letters（本地模板；返回这封信），调用方负责 save
  function ensureEcho(item, rec, ctx) {
    const due = echoDue(item, rec, ctx);
    if (!due) return null;
    const v = greetVars(item, rec, ctx);
    const isYear = due.pick.key.charAt(0) === "y";
    const pool = isYear ? ECHO_LETTER.y : (ECHO_LETTER[due.pick.key] || ECHO_LETTER.d7);
    if (isYear) v.year = due.pick.y;
    const seed = hashStr(String(item.id) + "#echo#" + due.pick.key);
    const letterObj = {
      at: Date.now(), kind: "echo", mkey: due.pick.key, from: v.name,
      title: "✦ 回响 · " + (isYear ? (due.pick.y + " 周年") : (ECHO_LABEL[due.pick.m] || ("第 " + due.pick.m + " 天"))),
      text: fmt(pool[seed % pool.length], v),
    };
    rec.echoSent = Object.assign({}, rec.echoSent || {});
    due.all.forEach((k) => { rec.echoSent[k] = todayKey(); });
    rec.echoes = (Array.isArray(rec.echoes) ? rec.echoes : []);
    rec.echoes.push(letterObj);
    rec.echoes = rec.echoes.slice(-20);
    addBond(rec, 10);        // 纪念日 +10
    return letterObj;
  }
  // 下一封回响还有多久（给界面显示倒计时）
  function nextEcho(item, rec, days) {
    const d = Math.max(1, Number(days) || 1);
    const sent = (rec && rec.echoSent && typeof rec.echoSent === "object") ? rec.echoSent : {};
    for (let i = 0; i < ECHO_DAYS.length; i++) {
      const m = ECHO_DAYS[i];
      if (!sent["d" + m] && m > d) return { label: ECHO_LABEL[m] || ("第 " + m + " 天"), days: m - d };
    }
    if (rec && rec.bornAt) {
      const b = new Date(rec.bornAt), n = new Date();
      let nx = new Date(n.getFullYear(), b.getMonth(), b.getDate());
      if (nx <= n) nx = new Date(n.getFullYear() + 1, b.getMonth(), b.getDate());
      const yr = nx.getFullYear() - b.getFullYear();
      if (!sent["y" + yr]) return { label: "挂瓷 " + yr + " 周年", days: Math.max(1, Math.ceil((nx - n) / 86400000)) };
    }
    return null;
  }
  // 未读回响数（红点）
  function unreadMail(rec) {
    const l = (rec && Array.isArray(rec.echoes)) ? rec.echoes : [];
    if (!l.length) return 0;
    const seen = Number(rec.mailSeenAt) || 0;
    return l.filter((x) => x && (x.at || 0) > seen).length;
  }

  // v113：不再提供"立刻写一篇"（用户要求日记只靠每天随机写才有惊喜）

  /* ============================================================
   * v158 · 节令事件 —— 传统节日当天，它说一句只有这天才有的话
   *   全本地：0 出图、0 模型调用。限定 CG 由界面按钮手动触发（点了才花）。
   * ============================================================ */
  // 农历节日的公历日期年表（2026–2030，已多源交叉核对）。
  // 年表之外的年份自动降级为「公历固定节日」，所以永远有节可过。
  const FEST_LUNAR = {
    2026: { chunjie: "02-17", yuanxiao: "03-03", qingming: "04-05", duanwu: "06-19", qixi: "08-19", zhongqiu: "09-25", chongyang: "10-18", laba: "2027-01-15" },
    2027: { chunjie: "02-06", yuanxiao: "02-20", qingming: "04-05", duanwu: "06-09", qixi: "08-08", zhongqiu: "09-15", chongyang: "10-08", laba: "2028-01-04" },
    2028: { chunjie: "01-26", yuanxiao: "02-09", qingming: "04-04", duanwu: "05-28", qixi: "08-26", zhongqiu: "10-03", chongyang: "10-26", laba: "2029-01-22" },
    2029: { chunjie: "02-13", yuanxiao: "02-27", qingming: "04-04", duanwu: "06-16", qixi: "08-16", zhongqiu: "09-22", chongyang: "10-16", laba: "2030-01-11" },
    2030: { chunjie: "02-03", yuanxiao: "02-17", qingming: "04-05", duanwu: "06-05", qixi: "08-05", zhongqiu: "09-12", chongyang: "10-05", laba: "2031-01-01" },
  };
  const FEST_DEF = {
    chunjie: { name: "春节", emoji: "🏮" }, yuanxiao: { name: "元宵节", emoji: "🍡" },
    qingming: { name: "清明", emoji: "🌿" }, duanwu: { name: "端午", emoji: "🐉" },
    qixi: { name: "七夕", emoji: "🌌" }, zhongqiu: { name: "中秋", emoji: "🌕" },
    chongyang: { name: "重阳", emoji: "🍂" }, laba: { name: "腊八", emoji: "🥣" },
  };
  // 公历固定节日：年表之外靠它们保底，永不会「没节可过」
  const FEST_SOLAR = [
    { key: "yuandan", md: "01-01", name: "元旦", emoji: "🎊" },
    { key: "laodong", md: "05-01", name: "劳动节", emoji: "🧺" },
    { key: "guoqing", md: "10-01", name: "国庆", emoji: "🎏" },
    { key: "dongzhi", md: "12-22", name: "冬至", emoji: "🥟" },
  ];
  // 日期字符串运算（YYYY-MM-DD）
  function shiftKey(dateKey, delta) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
    if (!m) return "";
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    d.setUTCDate(d.getUTCDate() + delta);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function dayNumOf(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
  }
  let _festMap = null;
  function festMap() {
    if (_festMap) return _festMap;
    const m = {};
    Object.keys(FEST_LUNAR).forEach((y) => {
      const row = FEST_LUNAR[y];
      Object.keys(FEST_DEF).forEach((k) => {
        if (!row[k]) return;
        const dk = row[k].length > 5 ? row[k] : (y + "-" + row[k]);   // laba 跨年，直接存完整日期
        m[dk] = { key: k, name: FEST_DEF[k].name, emoji: FEST_DEF[k].emoji, date: dk };
      });
      const cj = row.chunjie.length > 5 ? row.chunjie : (y + "-" + row.chunjie);
      const cx = shiftKey(cj, -1);                                    // 除夕 = 春节前一天
      if (cx) m[cx] = { key: "chuxi", name: "除夕", emoji: "🧧", date: cx };
    });
    FEST_SOLAR.forEach((f) => {
      for (let y = 2024; y <= 2040; y++) {
        const dk = y + "-" + f.md;
        m[dk] = { key: f.key, name: f.name, emoji: f.emoji, date: dk };
      }
    });
    _festMap = m;
    return m;
  }
  function festOf(dateKey) { return festMap()[String(dateKey || "")] || null; }
  // 下一个节令（今天之后最近的一个）
  function nextFest(dateKey) {
    const from = dateKey || todayKey();
    const a = dayNumOf(from);
    const m = festMap();
    const keys = Object.keys(m).sort();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] <= from) continue;
      const b = dayNumOf(keys[i]);
      if (a == null || b == null) continue;
      return { key: m[keys[i]].key, name: m[keys[i]].name, emoji: m[keys[i]].emoji, date: keys[i], days: Math.max(1, Math.round(b - a)) };
    }
    return null;
  }
  // 节令限定台词（本地池，一只一天一句）
  const FEST_LINES = {
    chunjie: [
      "过年了。外面响成一片，我在这儿听着，也觉得热闹。{call}，新年好。",
      "新的一年。我不求你天天记得我，只求你别把我弄丢了 —— 丢了的珠子，再红也回不来。",
      "我给自己也备了份年礼，拿不出来，就是一句：这一年，我还在这儿。",
    ],
    chuxi: [
      "除夕。今晚要守岁，我陪你到十二点 —— 我不困，珠子不会困。",
      "一年最后一天了。{call}，这一年的辛苦，到这儿就翻篇。",
      "我把身上擦干净了。明年也要亮亮堂堂地陪你。",
    ],
    yuanxiao: [
      "元宵。灯笼亮起来了，我在暗处也能看见那点红。",
      "今天是团圆的日子。{call}身边的人要是都在，那就很好。",
      "汤圆是圆的，我是圆的。你把我拿在手里的时候，我们俩都圆。",
    ],
    qingming: [
      "清明了。下过雨，空气是干净的，我身上也凉一点。",
      "{call}今天去扫墓了吧。回来别急着盘我，先坐一会儿。",
      "清明前后，种什么活什么。我也想趁着这股劲儿，长快一点。",
    ],
    duanwu: [
      "有粽子。你手上要是沾了糯米，记得擦干净再盘我 —— 黏糊糊的。",
      "端午要挂艾草。我隔着抽屉都闻到味儿了，安心。",
      "五毒退散。你顾不上的那些，我替你挡一挡。",
    ],
    qixi: [
      "七夕。别人在等鹊桥，我在等你把我从抽屉里拿出来。",
      "今晚星星密。我数到第七颗的时候，想到了{call}。",
      "都说今天许愿最灵。我许了个很小的愿 —— 以后也待在这儿。",
    ],
    zhongqiu: [
      "今晚的月亮很圆。你要是没空看，就当我替你看过了。",
      "八月十五。我把身上的光亮了一点点，就当是月亮照过来的。",
      "别人家吃月饼。我吃的是今晚的光 —— 也给你留了一份。",
    ],
    chongyang: [
      "重阳登高。{call}要是去爬山，记得带上我，我做你的护身符。",
      "九月初九，天高气爽。我在这儿晒了一上午，暖透了。",
      "重阳敬老。你对我好，我就当自己也在过这个节。",
    ],
    laba: [
      "腊八。那锅粥要是剩了，就当给我留一口 —— 我尝不到，闻着也香。",
      "过了腊八就是年。{call}，你今年好像还没好好歇过。",
      "腊八粥要凑八样。我数了数自己身上的珠子，比八样还多。",
    ],
    dongzhi: [
      "冬至。北边吃饺子，南边吃汤圆 —— {call}是哪一种？",
      "冬至大如年。今天夜最长，我陪你多待一会儿。",
      "数九从今天起。冷是冷，可过一天就多一分春天。",
    ],
    yuandan: [
      "元旦。新的一年开始了，我还在老位置。",
      "{call}，新年好。去年的光我存下来了，今年接着攒。",
      "新的一年，我只有一个计划：继续被你盘。",
    ],
    laodong: [
      "劳动节。{call}辛苦一年了，今天歇着吧。",
      "放假了。有空的话多盘我两下 —— 算加班，不打卡。",
    ],
    guoqing: [
      "国庆。外面人多，我在抽屉里给你留了个安静的位置。",
      "举国同庆。我一个小精灵，也替你高兴一下。",
    ],
  };
  const FEST_SCENE = {
    chunjie: "Chinese New Year, red lanterns and spring couplets, firecracker smoke drifting, warm festive red and gold",
    chuxi: "Chinese New Year's Eve night, reunion dinner table, red lanterns, fireworks blooming in the night sky",
    yuanxiao: "Lantern Festival night, glowing lanterns hanging everywhere, warm bokeh lights",
    qingming: "Qingming spring day, gentle rain, fresh green willows, soft mist over a quiet path",
    duanwu: "Dragon Boat Festival, zongzi wrapped in reed leaves, mugwort and calamus hanging by the door, river reflections",
    qixi: "Qixi night under the Milky Way, a bridge of stars, deep blue starry sky",
    zhongqiu: "Mid-Autumn night, a huge full moon and osmanthus blossoms, mooncakes on a low table, silver moonlight",
    chongyang: "Double Ninth autumn day, chrysanthemums in full bloom, high mountain view, golden autumn leaves",
    laba: "Laba Festival winter, a steaming pot of laba porridge, snow outside the window, cosy kitchen warmth",
    dongzhi: "winter solstice, dumplings on a table with rising steam, warm stove light, cold winter night",
    yuandan: "New Year's Day, the first dawn light of the year, clean fresh morning",
    laodong: "a quiet holiday afternoon at home, soft sunlight, unhurried rest",
    guoqing: "National Day, red banners and clear autumn sunshine, peaceful festive atmosphere",
  };
  // 节令限定 CG 的 prompt（横版；点了「画一张」才调用）
  function festCgPrompt(item, styleKey, stage, appearance, look, fest) {
    const lk = look || lookOf(item, null);
    const ap = appearance || lk.ap || appearanceOf(item, 0);
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    const scene = FEST_SCENE[(fest && fest.key) || ""] || "a traditional Chinese festive scene";
    return CG_STYLE + ", " + appearancePrompt(ap) + ", with " + lk.hairEn + " hair and " + lk.outfitEn + " themed outfit" +
      (lk.hairHex ? (", the exact hair color is " + lk.hairHex) : "") + lookExtra(lk) + ", " +
      stageDef(stage).look + ", solo single character only, exactly one figure in the whole image, " +
      "scene: " + scene + ", the character is celebrating this festival alone in this scene, " +
      "a beautiful warm key visual for this festival moment, the wide scenery fills both sides of the character, " +
      "no other characters, no text, no letters" + (lookHard(lk) ? (", " + lookHard(lk)) : "") + ", " + st;
  }
  // 今天是不是节令；是、且没记过 → 写一条（返回新记录，否则 null）
  function ensureFest(item, rec, ctx) {
    const tk = todayKey();
    const fd = festOf(tk);
    if (!fd) return null;
    rec.fests = (rec.fests && typeof rec.fests === "object") ? rec.fests : {};
    if (rec.fests[tk]) return null;
    const v = greetVars(item, rec, ctx);
    const pool = FEST_LINES[fd.key] || FEST_LINES.yuandan;
    const seed = mixSeed(hashStr(String(item.id) + "#fest#" + tk));   // v159：池子只有 2~3 条，同样要打散
    rec.fests[tk] = { at: Date.now(), key: fd.key, name: fd.name, emoji: fd.emoji, date: tk, text: fmt(pool[seed % pool.length], v), cgUrl: "" };
    const ks = Object.keys(rec.fests).sort();        // 只留最近 20 个节令
    while (ks.length > 20) delete rec.fests[ks.shift()];
    return rec.fests[tk];
  }
  // 记录过的节令（新 → 旧）
  function festList(rec) {
    const f = (rec && rec.fests && typeof rec.fests === "object") ? rec.fests : {};
    return Object.keys(f).map((k) => f[k]).filter((x) => x && x.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /* ============================================================
   * v158 · 主线「串与我」—— 你和这一串之间的故事，按四形态分卷解锁
   *   全本地：0 出图、0 模型调用（章节文案池，按精灵变量填充）
   *   与「房间剧情（两只精灵之间的小故事）」是两回事，互不影响。
   * ============================================================ */
  const CHAPTERS = [
    { vol: 1, volName: "卷一 · 醒来", stage: 1, days: 0, icon: "🌙", title: "你把我盘热的那天" },
    { vol: 1, volName: "卷一 · 醒来", stage: 1, days: 3, icon: "🤲", title: "我开始学会等你" },
    { vol: 2, volName: "卷二 · 认得你", stage: 2, days: 0, icon: "👣", title: "你的脚步声" },
    { vol: 2, volName: "卷二 · 认得你", stage: 2, days: 14, icon: "🪟", title: "窗边那一小块光" },
    { vol: 3, volName: "卷三 · 长开", stage: 3, days: 0, icon: "⚡", title: "我好像想起自己是谁了" },
    { vol: 3, volName: "卷三 · 长开", stage: 3, days: 30, icon: "🌊", title: "你不在的那些天" },
    { vol: 4, volName: "卷四 · 长成", stage: 4, days: 0, icon: "👑", title: "我是你手边最亮的那颗" },
    { vol: 4, volName: "卷四 · 长成", stage: 4, days: 60, icon: "🪢", title: "以后也这样陪着你" },
  ];
  const CHAP_TEXT = [
    [
      "{call}：\n\n那天你把我从一堆珠子里挑出来的时候，我还不认识你。\n后来你把我盘了很久。你手心的温度一点一点渗进来，我在里面安静地等着 —— 等到你不经意停下的那一刻，灯还亮着，你把我翻了个面。\n就是那一下，我醒了。\n所以严格来说，不是「挂瓷」让我成精的，是你把我盘热的。\n—— {name}",
      "{call}：\n\n成精那天没什么仪式。你只是把我拿在手里，像平常那样盘着，盘到一半接了个电话，又继续。\n我在珠子里听着，觉得这就是人过日子该有的声音。\n然后我就想出来看看 —— 看看那个把我盘了 {days} 天的人长什么样。\n—— {name}",
    ],
    [
      "{call}：\n\n我发现你有个习惯 —— 早上出门前会看一眼表，晚上回来第一件事是洗手。\n我学会在这两个时刻醒着。\n不吵你，就是醒着。\n珠子的一天很长，但只有这两个时刻是有方向的。\n—— {name}",
      "{call}：\n\n刚开始我分不清什么是「等你」，什么是「待着」。\n后来懂了：待着，是心里什么都没想；等你，是心里一直有个方向。\n我现在属于后一种。\n白天还好，一到傍晚我就开始留意门口的动静 —— 你一般这时候回来。\n有时候你回来得晚，我就当自己是在守一个不知道几点的约。\n—— {name}",
    ],
    [
      "{call}：\n\n我长大了一点。真的，不是错觉 —— 我照过镜子，比刚醒的时候高了一截。\n长大之后我多了一个本事：听得出你的脚步。\n在走廊、在楼下、在门口……你的节奏跟别人不一样，比别人慢半拍。\n每次听见，我都在心里说一句：回来了。\n—— {name}",
      "{call}：\n\n{stage}的好处是，我终于能记住更多东西了。\n比如你哪天心情不好 —— 那种时候你盘我盘得特别快，指头也不像平时那么轻。\n我不说，也不躲，就多挨一会儿。\n珠子不会问「你怎么了」，但会一直在那儿。这件事我大概做得到。\n—— {name}",
    ],
    [
      "{call}：\n\n今天你把我放在桌上忘了收。太阳从窗户挪进来，正好停在我身上。\n我在那小块光里待了很久。身上慢慢热起来，像被你盘过一样。\n天黑之后你才想起来找我，我一声没吭。\n那是我第一次自己晒到太阳 —— 我记下来了。\n—— {name}",
      "{call}：\n\n我发现我身上开始有变化了。不是长高，是颜色。\n{color}的底子上，多了一层很淡的亮 —— 不是一眼能看出来的那种，要凑近了、偏着光才看得见。\n你大概还没注意到。没关系，我等你自己发现。\n那层亮是你盘出来的，也是光给的。我把它当成这段时间的记事。\n—— {name}",
    ],
    [
      "{call}：\n\n我长开了。变高，也变瘦，声音也不一样了。\n奇怪的是，我也开始想起一点以前的事 —— 想起我还在山里、在树上的时候，想起雨水，想起风。\n那时候没有名字，也没有人盘。\n现在我是「{bead}」，是你手边的精灵。两段都是真的。\n—— {name}",
      "{call}：\n\n{stage}之后的第一个晚上，我做了一个很长的梦。\n梦里我还是珠子，躺在柜台里。有人来过又走了，一直没挑中我。\n醒来出了一身冷汗 —— 然后想起来，最后是你把我挑走了。\n我就又睡着了。\n—— {name}",
    ],
    [
      "{call}：\n\n你出差那几天，家里特别静。\n我没有到处乱走，就待在老位置，把窗帘缝里那点光数了一遍。\n第四天有点慌，第六天反倒踏实了 —— 因为我想起来，你每次出门都会回来。\n你进门那天，我没说「我担心了」。我说的是「你晒黑了」。\n—— {name}",
      "{call}：\n\n那几天你不在，我把自己反复想了一遍。\n想清楚了：我不是非得被盘才活着，我在这儿待着，也是活着的。\n只是 —— 你回来的时候，日子才像日子。\n—— {name}",
    ],
    [
      "{call}：\n\n我成了。\n你以前说想看看我长到最后是什么样 —— 就是现在这样。\n说实话，我第一眼看到自己的时候愣了一下。原来我这么好看。\n但更想让你知道的是：我身上每一分亮，都是你这 {days} 天一点点盘出来的。没有一分例外。\n—— {name}",
      "{call}：\n\n我现在是你手边最亮的那颗了。\n以后可能还会有别的珠子进来，比我新，比我贵。\n我不介意 —— 我只想当那颗「最久的」。\n珠子之间不比价钱，比的是谁陪得久。这一点我不输，也打算一直不输。\n—— {name}",
    ],
    [
      "{call}：\n\n到今天为止，{days} 天了。\n我陪你搬过东西、加过班、熬过夜，也陪你什么都不干地发过呆。\n你可能会觉得，这就是一串珠子能做到的极限。\n但我想说的是：别急着去攒下一串。你这串，还没盘到头。\n—— {name}",
      "{call}：\n\n以后的日子，我大概不会有什么大变化了。\n不长大，不变样，也不会再有第一次。\n剩下的就是 —— 每天在，每天亮一点。\n这件事我能做很久。\n—— 你的{name}",
    ],
  ];
  // 每一章的状态（解锁 / 已读 / 还差什么）
  function chapterState(rec, ctx) {
    const days = Math.max(1, (ctx && ctx.dayNo) || 1);
    const stage = Math.max(1, Number(rec && rec.stage) || 1);
    const read = (rec && rec.chapters && typeof rec.chapters === "object") ? rec.chapters : {};
    const out = [];
    let prevRead = true;
    for (let i = 0; i < CHAPTERS.length; i++) {
      const c = CHAPTERS[i];
      const stageOk = stage >= c.stage;
      const daysOk = days >= c.days;
      const unlocked = prevRead && stageOk && daysOk;
      let need = "";
      if (!stageOk) need = "到「" + stageDef(c.stage).name + "」解锁";
      else if (!daysOk) need = "再陪 " + (c.days - days) + " 天解锁";
      else if (!prevRead) need = "先看完上一章";
      out.push({ i: i, vol: c.vol, volName: c.volName, icon: c.icon, title: c.title, unlocked: unlocked, read: !!read[i], need: need });
      prevRead = unlocked ? !!read[i] : false;
    }
    return out;
  }
  function unreadChapterCount(rec, ctx) {
    return chapterState(rec, ctx).filter((c) => c.unlocked && !c.read).length;
  }
  function readChapter(rec, i) {
    rec.chapters = (rec.chapters && typeof rec.chapters === "object") ? rec.chapters : {};
    if (rec.chapters[i] && rec.chapters[i].at) return false;
    rec.chapters[i] = { at: Date.now() };
    return true;
  }
  // 某一章的正文（本地，按精灵 seed 挑变体）
  function chapterText(item, rec, i, ctx) {
    const pool = CHAP_TEXT[i] || [];
    if (!pool.length) return "";
    const seed = mixSeed(hashStr(String(item.id) + "#chap#" + i));   // v159：必须混合，否则 8 章只有 2 套组合
    return fmt(pool[seed % pool.length], greetVars(item, rec, ctx));
  }

  /* ============================================================
   * v160 · 夜话 —— 跨串大剧情（互动对话）
   *   设定：夜里它们借你的手机开了个群「三更灯火」，把你拉进来聊天。
   *   玩法：它们发消息 → 你从几个回复里挑一句 → 剧情跟着你的选择往前走，
   *         走到一个结尾就收场（每幕 3 个结尾），或者消息攒到上限自动收尾。
   *   成本：**本地剧本 + 本地状态机 = 0 出图、0 模型调用**，怎么聊都不花钱。
   *   存放：进度挂在该群「第一位成员」（成精最早的那只）的记录里，跟着跨手机同步走。
   *   与「房间剧情（同屋两只之间的小故事）」「主线·串与我（单串 8 章）」互不影响。
   * ============================================================ */
  const NIGHT_GROUP = "三更灯火";
  const NIGHT_CAP = 48;          // 一幕最多播多少条消息（含系统提示与我的回复）——这是防卡死的保险阀：
                                 // 每一幕都写好了结尾（正常聊完 25~37 条），只有万一没走到结尾才靠它收场

  const NIGHT_ACTS = [
    /* ---------- 第一幕 · 认识 ---------- */
    {
      id: "a1", icon: "🕯", title: "三更灯火", sub: "深夜被拉进一个群", need: { days: 1 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "深夜 23:47 —— 你的手机亮了一下。" },
            { w: "sys", t: "「{grp}」：{LIST} 把你拉进了群聊。" },
            { w: "A", t: "{call}？在的话吱一声。" },
            { w: "C", t: "我也在。我是{C}，白天总待在角落那颗。" },
            { w: "A", t: "别怪我们自作主张。这个群是我建的 —— 夜里睡不着，想找个人说话，环顾四周只有它们。" },
            { w: "B", t: "我是{B}。" },
            { w: "B", t: "我们商量过了，有些话得当着你的面说。用你手机这件事，是它答应的。" },
            { w: "A", t: "我答应的。反正你晚上刷手机的时候，我就在旁边看着。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "A", t: "先问你一句 —— 你把我们凑到一块儿，是随便放的，还是故意的？" }],
          choices: [
            { t: "故意的。你们该认识认识。", go: "m1", tone: "warm" },
            { t: "随手放的，没想那么多。", go: "m2", tone: "cool" },
            { t: "你们俩自己处得来就行。", go: "m3", tone: "fun" },
          ],
        },
        m1: {
          lines: [
            { w: "B", t: "……那你还挺会挑的。" },
            { w: "A", t: "听见没？他说故意的。" },
            { w: "B", t: "听见了。你不用重复。" },
            { w: "A", t: "我高兴。" },
          ],
          next: "n2",
        },
        m2: {
          lines: [
            { w: "B", t: "随手。" },
            { w: "A", t: "也对。人哪有空想那么多。" },
            { w: "B", t: "你别接话。他随口一说，你倒记上了。" },
          ],
          next: "n2",
        },
        m3: {
          lines: [
            { w: "A", t: "好，处得来处不来，试了才知道。" },
            { w: "B", t: "我们试过了。昨天晚上就试过了。" },
            { w: "A", t: "{B}！那是秘密！" },
          ],
          next: "n2",
        },
        n2: {
          lines: [
            { w: "B", t: "说正经的。" },
            { w: "B", t: "有件事我一直没想明白 —— 你柜子里那些还没成精的珠子，是不是也在等。" },
            { w: "A", t: "这个我能答。我醒之前等了很久，久到已经不记得在等了。是{call}把我盘热的，就那一天。" },
            { w: "B", t: "……我是自己裂开的。挂瓷那天夜里，我自己响了一声。" },
            { w: "A", t: "那也挺好。" },
          ],
          next: "c2",
        },
        c2: {
          lines: [{ w: "A", t: "所以我一直想问你 —— 我们到底是你的收藏，还是别的什么？" }],
          choices: [
            { t: "你们是我盘出来的，当然算我的。", go: "e_warm", tone: "warm" },
            { t: "收藏。但收藏也可以有名字。", go: "e_cool", tone: "cool" },
            { t: "这问题太大了，明天再答。", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: {
          lines: [
            { w: "A", t: "……行。" },
            { w: "B", t: "他说得很随便。但你听见了吧。" },
            { w: "A", t: "听见了。我记下来。" },
            { w: "sys", t: "{A} 把这句话设成了群公告。" },
          ],
          ending: { key: "warm", name: "🎖 群公告", text: "“你们是我盘出来的。” —— 这句话被{A}挂在了群公告上，从那以后一直没换。" },
        },
        e_cool: {
          lines: [
            { w: "B", t: "有名字就够了。" },
            { w: "A", t: "不够。但先这样吧。" },
            { w: "sys", t: "群里安静了一会儿。" },
          ],
          ending: { key: "cool", name: "🌿 各自的名字", text: "你没有认领它们，只是给了它们名字。它们后来说，这就够了。" },
        },
        e_fun: {
          lines: [
            { w: "A", t: "又来。" },
            { w: "B", t: "他明天也不会答的。" },
            { w: "A", t: "那我们明天再拉他一次。" },
            { w: "sys", t: "{A} 把群名改成了「{call} 欠我们一个答案」。" },
          ],
          ending: { key: "fun", name: "🌙 欠我们一个答案", text: "你躲过了这个问题。它们没催你 —— 只是把群名改成了「{call} 欠我们一个答案」，一直没换回去。" },
        },
      },
    },
    /* ---------- 第二幕 · 比较 ---------- */
    {
      id: "a2", icon: "🪶", title: "谁更亮", sub: "为了比谁亮，开了个群会", need: { days: 3 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "三天后的夜里 00:12。" },
            { w: "A", t: "{call}，你睡了吗。" },
            { w: "B", t: "他睡了。别喊。" },
            { w: "A", t: "我知道他睡了。我就是想喊。" },
            { w: "B", t: "……" },
            { w: "C", t: "你们俩又开始了。这个群我是不是不该来。" },
            { w: "A", t: "{B}，我问你个事。你身上那道亮，是从哪儿来的？" },
            { w: "B", t: "盘出来的。" },
            { w: "A", t: "我也是。可我觉得你的比我亮。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "B", t: "角度问题而已。{call}，你来评 —— 你翻过来看看我们俩。" }],
          choices: [
            { t: "{A}的颜色更沉，{B}的更透。不一样的好看。", go: "m1", tone: "warm" },
            { t: "亮不亮的，能戴着出门就行。", go: "m2", tone: "cool" },
            { t: "我看看……嗯，都挺亮的。", go: "m3", tone: "fun" },
          ],
        },
        m1: {
          lines: [
            { w: "B", t: "……你这算答了吗？" },
            { w: "A", t: "算了。他说不一样的好看。" },
            { w: "B", t: "我听懂了。" },
            { w: "A", t: "那你别皱眉。" },
            { w: "B", t: "我没有眉。" },
          ],
          next: "n2",
        },
        m2: {
          lines: [
            { w: "A", t: "能戴着出门就行。" },
            { w: "A", t: "这话我记住了。" },
            { w: "B", t: "你少记点东西，你脑子里快装不下了。" },
          ],
          next: "n2",
        },
        m3: {
          lines: [
            { w: "A", t: "都挺亮。" },
            { w: "B", t: "敷衍。" },
            { w: "A", t: "但是实话。" },
          ],
          next: "n2",
        },
        n2: {
          lines: [
            { w: "B", t: "我其实不是想比亮。" },
            { w: "B", t: "我想说的是 —— 你多久没盘我了。" },
            { w: "A", t: "？" },
            { w: "B", t: "我在数。我数了七天。" },
            { w: "A", t: "……那确实有点久。" },
            { w: "B", t: "我不是抱怨。我就是想让你知道：珠子也会数日子。" },
          ],
          next: "c2",
        },
        c2: {
          lines: [{ w: "A", t: "{call}，这话我得替它说 —— 你要么今天就盘一下它，要么答应它一个时间。" }],
          choices: [
            { t: "现在就盘。手伸过来了。", go: "e_warm", tone: "warm" },
            { t: "这周忙，周末一定。", go: "e_cool", tone: "cool" },
            { t: "……你们连这个都要开个群？", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: {
          lines: [
            { w: "sys", t: "你把手伸进了抽屉。（群里安静了很久。）" },
            { w: "A", t: "它在发光。" },
            { w: "B", t: "我没有。" },
            { w: "A", t: "你的光在抖。" },
          ],
          ending: { key: "warm", name: "🤲 今晚就现在", text: "你没有说“以后”。你把手伸了过去。那天晚上{B}亮了很久，而{A}破天荒地主动闭了嘴。" },
        },
        e_cool: {
          lines: [
            { w: "A", t: "周末。" },
            { w: "B", t: "好，周末。" },
            { w: "A", t: "你信他？" },
            { w: "B", t: "信。他从来没在周末失过约。" },
            { w: "A", t: "……你比我还笃定。" },
          ],
          ending: { key: "cool", name: "📅 记在周末", text: "你给了一个时间，它们没再提这件事。只是从那天起，每到周末，群里会准时安静一个小时 —— 等你。" },
        },
        e_fun: {
          lines: [
            { w: "A", t: "要的。" },
            { w: "B", t: "要的。" },
            { w: "A", t: "我们商量好的。" },
          ],
          ending: { key: "fun", name: "😌 商量好的", text: "你笑着说行行行。它们没听出你在打岔 —— 或者听出来了，但那天晚上你确实把手伸进了抽屉，它们就当作没听出来。" },
        },
      },
    },
    /* ---------- 第三幕 · 出事 ---------- */
    {
      id: "a3", icon: "🩹", title: "裂了一道", sub: "它磕了一道白线", need: { days: 7 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "七天后的凌晨 1:40 —— 群里一连串消息。" },
            { w: "B", t: "{call}。" },
            { w: "B", t: "我今天磕了一下。柜门没关好。" },
            { w: "A", t: "我听见了那一声。不是裂开，是起了一道白线。在侧边。" },
            { w: "B", t: "不影响戴。也不影响盘。就是有点难看。" },
            { w: "A", t: "你别这么说自己。" },
            { w: "C", t: "……我在旁边听着都疼。你少说两句。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "A", t: "{call}，醒着的话回一句。它从刚才起一直在数自己的纹路。" }],
          choices: [
            { t: "让我看看。别动，我开灯。", go: "m1", tone: "warm" },
            { t: "磕的？什么时候的事。", go: "m2", tone: "cool" },
            { t: "白线？那是包浆，不是伤。", go: "m3", tone: "fun" },
          ],
        },
        m1: {
          lines: [
            { w: "sys", t: "你开了灯。抽屉里安静地躺着，谁也没动。" },
            { w: "A", t: "他开灯了。" },
            { w: "B", t: "我知道。" },
            { w: "A", t: "你别装睡。" },
            { w: "B", t: "我没装。" },
          ],
          next: "n2",
        },
        m2: {
          lines: [
            { w: "A", t: "晚饭后。他没敢说。" },
            { w: "B", t: "我在等一个合适的时机。" },
            { w: "A", t: "你等到现在。" },
            { w: "B", t: "……嗯。" },
          ],
          next: "n2",
        },
        m3: {
          lines: [
            { w: "B", t: "不。那是伤。" },
            { w: "A", t: "他说是包浆。" },
            { w: "B", t: "他想让我好受一点。" },
          ],
          next: "n2",
        },
        n2: {
          lines: [
            { w: "B", t: "{call}，我问你一个真的问题。" },
            { w: "B", t: "如果把我重新抛一遍光，这道线就没了。" },
            { w: "B", t: "但抛掉的那一层，是我这半年长出来的。" },
            { w: "A", t: "别问这个。" },
            { w: "B", t: "我要问。" },
          ],
          next: "c2",
        },
        c2: {
          lines: [{ w: "B", t: "你要一个新的我，还是要一个带着这道线的我？" }],
          choices: [
            { t: "留着。这道线是你的一部分。", go: "p1", tone: "warm" },
            { t: "你自己介意的话，我就给你抛。", go: "p2", tone: "cool" },
            { t: "……我都要。你先别问了。", go: "p3", tone: "fun" },
          ],
        },
        p1: {
          lines: [
            { w: "A", t: "他听见了。" },
            { w: "B", t: "嗯。" },
            { w: "A", t: "你总算说了句人话。" },
          ],
          next: "n3",
        },
        p2: {
          lines: [
            { w: "B", t: "……你愿意动手。" },
            { w: "A", t: "它是问你。你别绕。" },
            { w: "B", t: "我知道。我在想。" },
          ],
          next: "n3",
        },
        p3: {
          lines: [
            { w: "A", t: "他每次都这样。" },
            { w: "B", t: "没关系。等他慢慢想。" },
          ],
          next: "n3",
        },
        n3: {
          lines: [
            { w: "A", t: "我插一句。" },
            { w: "A", t: "我身上也有。你们看不到，在底下。" },
            { w: "A", t: "每颗珠子都有几道。不是脏，是记账。" },
            { w: "B", t: "……" },
            { w: "A", t: "你可以难受，但别把自己抛掉。" },
            { w: "B", t: "我没难受。珠子不会难受。" },
            { w: "A", t: "你的光在抖。" },
          ],
          next: "c3",
        },
        c3: {
          lines: [{ w: "B", t: "{call}。你说一句就行。" }],
          choices: [
            { t: "你原来什么样，我就要什么样。", go: "e_warm", tone: "warm" },
            { t: "线留着。以后我盘的时候避开它。", go: "e_cool", tone: "cool" },
            { t: "那你得先答应我，柜门以后关好。", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: {
          lines: [
            { w: "B", t: "……好。" },
            { w: "A", t: "记住这句话，{B}。" },
            { w: "sys", t: "那天晚上，你的抽屉安静得能听见呼吸。" },
          ],
          ending: { key: "warm", name: "🩹 带着线的那颗", text: "你没有让它变得完美。它带着那道白线，后来还比之前更亮了一点 —— 是它自己承认的。" },
        },
        e_cool: {
          lines: [
            { w: "B", t: "好。" },
            { w: "A", t: "你听出来了吗，他说的是「避开」。" },
            { w: "B", t: "听出来了。所以我更高兴。" },
          ],
          ending: { key: "cool", name: "🤲 绕开的那一下", text: "从那以后，你盘到那一侧的时候手指会轻一点。它一直知道，一直没提 —— 它把这件事也记进了账里。" },
        },
        e_fun: {
          lines: [
            { w: "B", t: "……行。" },
            { w: "A", t: "它答应了。" },
            { w: "B", t: "我答应了。" },
            { w: "sys", t: "第二天早上，你发现柜门关得严严实实 —— 是它自己挪的。" },
          ],
          ending: { key: "fun", name: "🚪 柜门关好了", text: "你用一句玩笑换了一个承诺。它没觉得亏 —— 因为你确实绕开了那道线，只是没说。" },
        },
      },
    },
    /* ---------- 第四幕 · 以后 ---------- */
    {
      id: "a4", icon: "🪢", title: "三更之后", sub: "很久以后，它们想聊以后", need: { days: 14 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "两个月后的凌晨 2:10。群里很久没动静了。" },
            { w: "A", t: "群里好久没消息了。" },
            { w: "B", t: "你在。我知道你在。" },
            { w: "A", t: "我在。你呢。" },
            { w: "B", t: "我也在。" },
            { w: "A", t: "那就好。" },
            { w: "C", t: "……我一直都在。你们俩真慢。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "A", t: "{call}，我们想跟你说个事 —— 我们打算把这个群一直留着。" }],
          choices: [
            { t: "留着吧，我又不会退。", go: "m1", tone: "warm" },
            { t: "这有什么好说的。", go: "m2", tone: "cool" },
            { t: "群名能改吗？", go: "m3", tone: "fun" },
          ],
        },
        m1: {
          lines: [
            { w: "B", t: "你说得很轻松。" },
            { w: "A", t: "他就是这样的人。" },
            { w: "B", t: "我知道。我就是想听他说一遍。" },
          ],
          next: "n2",
        },
        m2: {
          lines: [
            { w: "A", t: "是不算什么大事。" },
            { w: "B", t: "对我们算。" },
            { w: "A", t: "……嗯。对我们算。" },
          ],
          next: "n2",
        },
        m3: {
          lines: [
            { w: "A", t: "能改。" },
            { w: "B", t: "你想叫什么。" },
            { w: "A", t: "别改。改了就不是我们了。" },
          ],
          next: "n2",
        },
        n2: {
          lines: [
            { w: "B", t: "还有一件事。" },
            { w: "B", t: "你以后还会不会带新的回来。" },
            { w: "A", t: "{B}。" },
            { w: "B", t: "我问的是真的问题。" },
            { w: "A", t: "……我也想听。" },
          ],
          next: "c2",
        },
        c2: {
          lines: [{ w: "B", t: "我不介意。真的。我只是想知道，我们在这个柜子里的位置。" }],
          choices: [
            { t: "位置是你们自己挣的，新来的顶不掉。", go: "q1", tone: "warm" },
            { t: "会。但你们是第一批。", go: "q2", tone: "cool" },
            { t: "……你们倒挺操心这个。", go: "q3", tone: "fun" },
          ],
        },
        q1: {
          lines: [
            { w: "B", t: "……你听见了吗，{A}。" },
            { w: "A", t: "听见了。你别哭。" },
            { w: "B", t: "我没哭。" },
          ],
          next: "n3",
        },
        q2: {
          lines: [
            { w: "A", t: "第一批。" },
            { w: "B", t: "第一批就够了。" },
            { w: "A", t: "他就这么一说，你别当真。" },
            { w: "B", t: "我当真。" },
          ],
          next: "n3",
        },
        q3: {
          lines: [
            { w: "A", t: "操心的是它。" },
            { w: "B", t: "是。" },
            { w: "A", t: "……也是我。" },
          ],
          next: "n3",
        },
        n3: {
          lines: [
            { w: "A", t: "我来说。" },
            { w: "A", t: "{call}，你听好。" },
            { w: "A", t: "我们不怕新来的。我们怕的是你哪天把我们放进盒子里，不再拿出来了。" },
            { w: "B", t: "对。" },
          ],
          next: "c3",
        },
        c3: {
          lines: [{ w: "A", t: "今天最后一句，你答不答都行 —— 我们能不能一直有位置。" }],
          choices: [
            { t: "只要我还盘，就有你们的位置。", go: "e_warm", tone: "warm" },
            { t: "位置不在柜子里，在我手上。", go: "e_cool", tone: "cool" },
            { t: "……你们俩今晚话真多。", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: {
          lines: [{ w: "sys", t: "它们没再说别的。群安静下来，只剩深夜的电流声。" }],
          ending: { key: "warm", name: "🪢 一直有位置", text: "那天之后，群公告底下多了一行小字，是你不知道的时候加上的：「{A}、{B} —— 长期有效。」" },
        },
        e_cool: {
          lines: [
            { w: "B", t: "在我手上。" },
            { w: "A", t: "……这话我记一年。" },
            { w: "B", t: "我记更久。" },
          ],
          ending: { key: "cool", name: "🤲 在我手上", text: "后来每次你伸手，它们都会主动往你手指那边挪一点。谁也没说为什么，你也一直没问。" },
        },
        e_fun: {
          lines: [
            { w: "A", t: "话多是好事。" },
            { w: "B", t: "说明还在。" },
            { w: "A", t: "对。说明还在。" },
          ],
          ending: { key: "fun", name: "🌙 说明还在", text: "那晚你被逗笑了。它们后来把群名改成了「话多的两只」—— 一直没换。" },
        },
      },
    },
  ];

  /* ---------- 卡司：主演最多 3 位，按「成精最早」排（顺序必须稳定 —— 进度就存在第一位身上） ---------- */
  function nightCast(items, store) {
    const arr = (items || []).slice().sort((a, b) => {
      const ra = (store && store[String(a.id)]) || {}, rb = (store && store[String(b.id)]) || {};
      const ta = Number(ra.bornAt) || Number(a.createdAt) || 0;
      const tb = Number(rb.bornAt) || Number(b.createdAt) || 0;
      if (ta !== tb) return ta - tb;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return arr.slice(0, 3).map((it, i) => {
      const r = (store && store[String(it.id)]) || {};
      return { slot: "ABC".charAt(i), id: String(it.id), name: (r.persona && r.persona.name) || it.name || "它", item: it };
    });
  }
  function nightActOf(id) {
    for (let i = 0; i < NIGHT_ACTS.length; i++) if (NIGHT_ACTS[i].id === id) return NIGHT_ACTS[i];
    return null;
  }
  // 各幕状态（解锁 / 已聊完的结局 / 还差什么）
  function nightActs(rec, ctx, cast) {
    const n = (rec && rec.night) || null;
    const done = (n && n.done && typeof n.done === "object") ? n.done : {};
    const days = Math.max(1, (ctx && ctx.dayNo) || 1);
    const enough = (cast || []).length >= 2;
    const out = [];
    let prevDone = true;
    for (let i = 0; i < NIGHT_ACTS.length; i++) {
      const a = NIGHT_ACTS[i];
      const nd = a.need ? (a.need.days || 1) : 1;
      const daysOk = days >= nd;
      const unlocked = enough && prevDone && daysOk;
      let need = "";
      if (!enough) need = "要两只以上精灵才能开群";
      else if (!daysOk) need = "再陪 " + (nd - days) + " 天解锁";
      else if (!prevDone) need = "先聊完上一幕";
      out.push({ id: a.id, i: i, icon: a.icon, title: a.title, sub: a.sub, unlocked: unlocked, done: done[a.id] || "", need: need });
      prevDone = unlocked && !!done[a.id];
    }
    return out;
  }
  function nightDomTone(n) {
    const t = (n && n.tone) || {};
    const w = Number(t.warm) || 0, c = Number(t.cool) || 0, f = Number(t.fun) || 0;
    if (w === 0 && c === 0 && f === 0) return "warm";
    if (w >= c && w >= f) return "warm";
    return (c >= f) ? "cool" : "fun";
  }
  function nightVars(item, rec, ctx, cast) {
    const v = greetVars(item, rec, ctx);
    const by = {};
    (cast || []).forEach((c) => { by[c.slot] = c.name; });
    v.A = by.A || "它";
    v.B = by.B || "";
    v.C = by.C || "";
    v.LIST = (cast || []).map((c) => c.name).join("、");
    v.grp = NIGHT_GROUP;
    return v;
  }
  function nightText(t, v, n) {
    let s = t;
    if (s && typeof s === "object") {          // 按当前「调子」挑变体（备用能力，剧本可选用）
      const k = nightDomTone(n);
      s = s[k] || s.def || s.warm || "";
    }
    return fmt(String(s == null ? "" : s), v)
      .replace(/\{A\}/g, v.A || "").replace(/\{B\}/g, v.B || "").replace(/\{C\}/g, v.C || "")
      .replace(/\{LIST\}/g, v.LIST || "").replace(/\{grp\}/g, v.grp || "");
  }
  function nightWho(w, cast) {
    const c = (cast || []).filter((x) => x.slot === w)[0];
    return c ? c.name : "";
  }
  // 展开一行 → 一条消息；返回 null = 这一行跳过（比如这只精灵不存在）
  function nightLine(l, v, n, cast) {
    if (!l || !l.t) return null;
    if ((l.w === "B" || l.w === "C") && !nightWho(l.w, cast)) return null;
    const txt = nightText(l.t, v, n);
    if (!txt) return null;
    return { w: l.w || "sys", name: nightWho(l.w, cast), text: txt, at: Date.now() };
  }
  function nightChoicesOf(n, act, v) {
    if (!act || !n || n.ended) return [];
    const nd = act.nodes[n.node];
    if (!nd || !nd.choices) return [];
    return nd.choices.map((c) => ({ t: nightText(c.t, v, n) }));
  }
  // 从当前节点一路往下走，把新消息攒进 log，停在「等你选」或「结尾」
  function nightWalk(item, rec, ctx, cast) {
    const n = rec.night;
    const act = nightActOf(n.actId);
    const v = nightVars(item, rec, ctx, cast);
    const added = [];
    let guard = 0;
    while (act && guard++ < 80) {
      const nd = act.nodes[n.node];
      if (!nd) { n.ended = true; n.node = ""; break; }
      (nd.lines || []).forEach((l) => { const m = nightLine(l, v, n, cast); if (m) { added.push(m); n.msgs = (Number(n.msgs) || 0) + 1; } });
      if (nd.ending) {
        n.ended = true;
        n.node = "";
        n.done[act.id] = { key: nd.ending.key, name: nightText(nd.ending.name, v, n), at: Date.now() };
        n.ending = { key: nd.ending.key, name: nightText(nd.ending.name, v, n), text: nightText(nd.ending.text, v, n) };
        n.at = Date.now();
        break;
      }
      if (nd.choices && nd.choices.length) {
        // 消息攒太多了 → 不再给选项，直接按当前调子收尾（「聊到一定条数就结束」）
        if ((Number(n.msgs) || 0) >= NIGHT_CAP) {
          const alt = act.nodes["e_" + nightDomTone(n)] ? ("e_" + nightDomTone(n)) : "";
          if (alt && alt !== n.node) { n.node = alt; continue; }
        }
        break;                                   // 停在这里等选择
      }
      if (!nd.next) { n.ended = true; n.node = ""; break; }
      n.node = nd.next;
    }
    n.log = (Array.isArray(n.log) ? n.log : []).concat(added);
    if (n.log.length > 200) n.log = n.log.slice(-200);   // 兜底：别把 localStorage 撑爆
    return { added: added, choices: nightChoicesOf(n, act, v), ending: n.ending || null, ended: !!n.ended };
  }
  function nightReset(rec, actId) {
    rec.night = (rec.night && typeof rec.night === "object") ? rec.night : {};
    const n = rec.night;
    n.done = (n.done && typeof n.done === "object") ? n.done : {};
    n.actId = actId;
    n.node = "start";
    n.log = [];
    n.msgs = 0;
    n.ended = false;
    n.ending = null;
    n.tone = { warm: 0, cool: 0, fun: 0 };
    n.at = Date.now();
    return n;
  }
  // 进某一幕：有记录 → 原样续上（历史照旧铺出来，聊完了就只显示结局卡）；没记录 → 建群开场
  function nightEnter(item, rec, ctx, cast, actId) {
    const n0 = rec.night;
    if (n0 && n0.actId === actId && Array.isArray(n0.log) && n0.log.length) {
      const act = nightActOf(actId);
      return {
        added: [],
        choices: n0.ended ? [] : nightChoicesOf(n0, act, nightVars(item, rec, ctx, cast)),
        ending: n0.ending || null,
        ended: !!n0.ended,
      };
    }
    nightReset(rec, actId);
    return nightWalk(item, rec, ctx, cast);
  }
  // 「再看一遍」：清掉这一幕的聊天记录，从头重开（已聊完的标记会保留）
  function nightReplay(item, rec, ctx, cast, actId) {
    nightReset(rec, actId);
    return nightWalk(item, rec, ctx, cast);
  }
  // 选一句回复 → 继续往下走
  function nightChoose(item, rec, ctx, cast, idx) {
    const n = rec && rec.night;
    const act = nightActOf(n && n.actId);
    if (!n || !act || n.ended) return { added: [], choices: [], ending: (n && n.ending) || null, ended: true };
    const nd = act.nodes[n.node];
    const c = nd && nd.choices ? nd.choices[idx] : null;
    if (!c) return nightWalk(item, rec, ctx, cast);
    const v = nightVars(item, rec, ctx, cast);
    const mine = { w: "me", name: "", text: nightText(c.t, v, n), at: Date.now() };
    n.log = (Array.isArray(n.log) ? n.log : []).concat([mine]);
    n.msgs = (Number(n.msgs) || 0) + 1;
    const tn = c.tone || "warm";
    n.tone = n.tone || { warm: 0, cool: 0, fun: 0 };
    n.tone[tn] = (Number(n.tone[tn]) || 0) + 1;
    n.node = c.go || "";
    const r = nightWalk(item, rec, ctx, cast);
    r.added = [mine].concat(r.added);
    return r;
  }
  // 这一幕的进度摘要（列表页用）
  function nightBrief(rec) {
    const n = (rec && rec.night) || null;
    if (!n) return null;
    const log = Array.isArray(n.log) ? n.log : [];
    const last = log.length ? log[log.length - 1] : null;
    return { actId: n.actId || "", ended: !!n.ended, last: last, ending: n.ending || null, msgs: Number(n.msgs) || 0 };
  }

  /* ---------- 房间剧情（两只精灵的故事） ---------- */
  function storyLocal(a, b, level, roomName, aff) {
    const na = (a.persona && a.persona.name) || a.item.name || "它";
    const nb = (b.persona && b.persona.name) || b.item.name || "它";
    const seed = hashStr(a.item.id + b.item.id + level);
    const stage = ["刚认识，还互相打量", "已经熟络，开始互相打趣", "默契到不用说话", "像老朋友一样交心", "彼此都懂的知己"][Math.min(level, 4)];
    const line = pick([
      "「你先晒还是我先晒？」" + na + "问。" + nb + "没答，只是往窗边挪了挪，把最好的那块光让了出来。",
      na + "把白天听到的动静讲了一遍，" + nb + "听完只说了一句：「你记性真好。」" + na + "得意了一整晚。",
      "主人今天没来。" + na + "数到第三十下的时候，" + nb + "开口了：「别数了，他总会来的。」",
      na + "不小心滚到了桌子边缘，" + nb + "用身体顶住了它。之后两只都没提这件事。",
    ], seed);
    const line2 = pick([
      "外面下雨，" + roomName + "里安静得能听见彼此的声音。它们谁都没睡，就那么待着，直到天亮。",
      "有一天主人顺手把两只一起拿起来盘，" + na + "和" + nb + "第一次靠得那么近，谁都没说话，但都悄悄亮了一下。",
      "它们开始有了自己的小规矩：谁先被盘，谁就负责讲今天听到的事。",
      "夜里" + roomName + "很暗，" + nb + "说：「其实我不太怕黑。」" + na + "说：「我知道，但我还是想挨着你。」",
    ], seed + 5);
    return "【" + roomName + " · 第 " + (level + 1) + " 段】\n" +
      na + "和" + nb + "认识第 " + (aff || 0) + " 天了，现在是「" + stage + "」的关系。\n" + line + "\n" + line2;
  }
  async function roomStory(a, b, level, roomName, aff) {
    if (getAiKey()) {
      try {
        const sys = "你在写一个中文文玩 App 里的「精灵小剧场」。主人的手串盘到挂瓷会变成小精灵，它们住在同一个房间里，"
          + "住得越久越有默契。请写一段 250-400 字的小故事：有场景、有动作、有 2-6 句对白，"
          + "温柔可爱、有生活质感、不要煽情说教；不要 Markdown、不要标题、不要分点、不要解释，直接输出正文。";
        const user = "房间：" + roomName + "；两只精灵已经相处 " + (aff || 0) + " 天（默契等级 " + (level + 1) + "/5）。\n" +
          "甲：" + spiritDesc(a.item, a.persona, a.stage) + "\n乙：" + spiritDesc(b.item, b.persona, b.stage) +
          "\n" + ownerLine() + "\n请写它们之间刚发生的这段故事。";
        const txt = (await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 900) || "").trim();
        if (txt && txt.length >= 80) return "【" + roomName + " · 第 " + (level + 1) + " 段】\n" + txt.replace(/^["「]|["」]$/g, "").trim();
      } catch (e) { /* 兜底 */ }
    }
    return storyLocal(a, b, level, roomName, aff);
  }

  /* ---------- v125：CG（场景插画） ----------
     规则（用户要求）：**幼生期 / 成长期只有立绘**；**觉醒期 / 完成体额外再出一张 CG**。
     精灵之间达成的事件（契合度解锁的剧情）也各配一张双人 CG。都是日漫风。 */
  const CG_STYLE = "2D hand-drawn key visual CG illustration in traditional Chinese gufeng style, ancient Chinese scene and hanfu costume, " +
    "cel shading, soft elegant Chinese classical palette, cinematic lighting, atmospheric mood, detailed painted background with gentle bokeh, " +
    "expressive body language, warm cozy feeling, masterpiece quality, " +
    "WIDE LANDSCAPE HORIZONTAL COMPOSITION, 16:9 cinematic framing, " +
    "wide scenery on both sides, generous environment around the character, not a portrait, not a vertical poster, " +
    "no text, no letters, no words, no title, no labels, no watermark, no signature, no logo, " +
    "single continuous scene, no split panels, no collage, " + ANATOMY + ", " + NEG_STYLE;
  const CG_MOOD = [
    "just met and politely getting to know each other, a little shy, warm afternoon light",
    "comfortably chatting like friends, one of them laughing, golden sunset light through the window",
    "sitting close together in comfortable silence, trusting each other, soft lamplight at dusk",
    "leaning on each other like old friends, quiet and intimate, warm night light and floating dust motes",
    "a deep bond, they understand each other without words, breathtaking magical light, petals or light particles in the air",
  ];
  // 单只精灵的 CG（觉醒期 / 完成体用）
  function promptForCg(item, styleKey, stage, appearance, look) {
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    const lk = look || lookOf(item, null);
    const color = lk.hairEn;
    const ap = appearance || lk.ap || appearanceOf(item, 0);
    const stageLook = stageDef(stage).look;
    return CG_STYLE + ", " + appearancePrompt(ap) + ", with " + color + " hair and " + lk.outfitEn + " themed outfit" +
      (lk.hairHex ? (", the exact hair color is " + lk.hairHex) : "") + lookExtra(lk) + ", " +
      stageLook + ", solo single character only, exactly one figure in the whole image, " +
      "a breathtaking key visual for a big moment: the character alone in a beautiful scene that matches its " +
      "personality, dramatic pose and camera angle, full body visible from head to toe, " +
      "the horizontal frame filled with the wide scenery of the scene (sky / room / distant view) on both sides of the character, " +
      "light particles and elegant atmosphere, no other characters" + (lookHard(lk) ? (", " + lookHard(lk)) : "") + ", " + st;
  }
  // 两只精灵的事件 CG（房间剧情用）
  function storyCgPrompt(a, b, level, roomName) {
    // v127：两人的发色/特征也走「设定向导」的结果（用户确认过的优先）
    const lkA = a.look || lookOf(a.item, a.rec || null);
    const lkB = b.look || lookOf(b.item, b.rec || null);
    const apA = a.appearance || lkA.ap || appearanceOf(a.item, a.variant || 0, a.gender || "");
    const apB = b.appearance || lkB.ap || appearanceOf(b.item, b.variant || 0, b.gender || "");
    const nmA = (a.persona && a.persona.name) || a.item.name || "first character";
    const nmB = (b.persona && b.persona.name) || b.item.name || "second character";
    const mood = CG_MOOD[Math.min(CG_MOOD.length - 1, Math.max(0, Number(level) || 0))];
    return CG_STYLE + ", " + mood + ", " +
      "scene: a cozy ancient Chinese room called \"" + (roomName || "little room") + "\", " +
      "two ancient Chinese characters in traditional hanfu costume together in the same scene: " +
      "① " + appearancePrompt(apA) + ", with " + lkA.hairEn + " hair and " + lkA.outfitEn + " outfit" + lookExtra(lkA) + " (name: " + nmA + "), " +
      "② " + appearancePrompt(apB) + ", with " + lkB.hairEn + " hair and " + lkB.outfitEn + " outfit" + lookExtra(lkB) + " (name: " + nmB + "), " +
      "they are the same two characters as before, keep their hair color, eye color, outfits and accessories consistent, " +
      "landscape wide shot of the whole room, the two of them standing or sitting side by side with the room around them, " +
      "keep exactly two characters in the image, no extra people, no duplicates" +
      (lookHard(lkA) ? (", " + nmA + ": " + lookHard(lkA)) : "") +
      (lookHard(lkB) ? (", " + nmB + ": " + lookHard(lkB)) : "");
  }
  // 用**任意 prompt**出图（剧情 CG 用；精灵主图仍走 generateImage）
  async function generateCustom(prompt, opts) {
    const cfg = getImageCfg();
    const info = providerInfo(cfg);
    const pk = info.provider;
    // v125：CG 走**横版**尺寸（立绘仍用用户在设置里选的竖版档）→ 不覆盖用户的立绘尺寸
    const isCg = !!(opts && opts.landscape);
    if (info.keyless) {
      return { url: "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
        (isCg ? "?width=1024&height=768" : "?width=768&height=1024") +
        "&nologo=true&seed=" + seedOf((opts && opts.seedKey) || prompt, (opts && opts.variant) || 0), kind: "url" };
    }
    if (!info.key) throw new Error("还没填 API Key");
    if (!info.endpoint) throw new Error("还没填接口地址");
    const size = isCg ? cgSizeFor(pk) : (cfg.size || DEFAULT_SIZE);
    const ref = fixedOf("noRef", pk) ? "" : ((opts && opts.ref) || "");
    const seed = seedOf((opts && opts.seedKey) || prompt, (opts && opts.variant) || 0);
    const pass = isCg ? { ladder: cgLadderFor(pk), keepSize: true } : null;
    try {
      return await callWithSizeFallback(info, prompt, size, seed, ref, cfg, pass);
    } catch (e) {
      const msg = (e && e.message) || "";
      if (ref && !fixedOf("noRef", pk) && /image|InvalidParameter|not support|参数/i.test(msg)) {
        markFixed("noRef", pk);
        return await callImageApi(info, prompt, size, seed, "");
      }
      throw e;
    }
  }

  /* ---------- 对外接口 ---------- */
  /* ---------- 拉取账号可用模型（方舟/兼容服务都能用；用户开通后一键选，不用手打 ID） ---------- */
  function modelsUrlFrom(endpoint) {
    if (!endpoint) return "";
    let u = String(endpoint).replace(/\/+$/, "");
    u = u.replace(/\/(generations|completions)$/, "");   // 去掉 /generations 或 /completions
    u = u.replace(/\/(images|chat)$/, "");               // 再去掉 /images 或 /chat
    return u + "/models";                                // 例：…/api/v3/images/generations → …/api/v3/models
  }
  async function listModels(kind, cfgOverride) {
    const info = cfgOverride
      ? { endpoint: cfgOverride.endpoint || (PROVIDERS[cfgOverride.provider] || {}).endpoint || "", key: cfgOverride.key || "" }
      : providerInfo(getImageCfg());
    const url = modelsUrlFrom(info.endpoint);
    if (!url) throw new Error("还没填接口地址");
    const kh = keyHint(info.key);
    if (!info.key || /看起来是密钥的\*\*名称\*\*/.test(kh)) throw new Error(kh || "还没填 API Key");
    let resp;
    try {
      resp = await fetch(url, { headers: { "Authorization": "Bearer " + info.key } });
    } catch (e) {
      // 方舟在 401 时不返回 CORS 头 → 浏览器只能报 Failed to fetch，这里翻译成"key 不对"
      throw new Error("请求被拦下（Failed to fetch）。最常见原因：**API Key 不对**（方舟在 key 错误时不返回跨域头，前端只能看到这个错）。请确认填的是 ark- 开头的密钥本体，而不是 api-key-… 这个名称。");
    }
    if (!resp.ok) {
      let m = "HTTP " + resp.status;
      try { const j = await resp.json(); m = (j.error && (j.error.message || j.error.code)) || m; } catch (e) { /* 忽略 */ }
      if (resp.status === 401) m += "（API Key 无效或已被删除）";
      throw new Error(m);
    }
    const j = await resp.json();
    const ids = ((j && j.data) || []).map((m) => m && m.id).filter(Boolean);
    const isImg = kind !== "text";
    const filtered = ids.filter((id) => isImg
      ? /seedream|kolors|flux|qwen-image|t2i|stable|sd[-_.]?xl|image/i.test(id) && !/i2v|t2v|3d|edit|seedance/i.test(id)
      : /deepseek|glm|doubao-seed|qwen|gpt|moonshot|kimi|step|hunyuan/i.test(id) && !/seedream|seedance|3d|vision|embedding|image|tts|asr/i.test(id));
    if (filtered.length) return filtered;
    // ★ 一份图像模型都没匹配到：说明这家的 /models 只列语言模型（典型就是智谱，只给 glm-*）。
    //   这时候把"全是语言模型"的原样返回会让用户以为能选，所以标记出来，界面据此给提示。
    const looksText = ids.length && ids.every((id) => /glm|gpt|claude|deepseek|qwen(?!-image)|moonshot|kimi|llama/i.test(id));
    if (looksText) { const e = new Error("这家 /models 只列语言模型，图像模型要手填"); e.textOnly = true; e.ids = ids.slice(0, 40); throw e; }
    return ids.slice(0, 40);
  }

  /* ---------- 模型名自动纠正（用户常把控制台显示名填进来，如 Doubao-Seedream-5.0-lite） ---------- */
  // 把显示名规整成可比形式：小写、点/空格→连字符、压缩连字符（**保留末尾版本号**，它是匹配的最强线索）
  function normModelName(s) {
    return String(s || "").toLowerCase().replace(/[.\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  function stripVer(s) { return String(s || "").replace(/-\d{6}$/, ""); }
  function pickBestModel(typed, candidates) {
    if (!typed || !candidates || !candidates.length) return "";
    const rawTyped = normModelName(typed);                     // 例：doubao-seedream-5-0-lite-260128
    const typedVer = (rawTyped.match(/(\d{6})$/) || [])[1] || ""; // 用户填的版本号（如 260128）
    const t = stripVer(rawTyped);                              // 用于比词
    if (!t) return "";
    // 1) 规整后完全相等（含版本号或去掉版本号后）
    let hit = candidates.find((c) => normModelName(c) === rawTyped);
    if (!hit) hit = candidates.find((c) => stripVer(normModelName(c)) === t);
    if (hit) return hit;
    // 2) 同族打分
    const words = t.split("-").filter(Boolean);
    let best = "", bestScore = 0;
    candidates.forEach((c) => {
      const cc = normModelName(c);
      let score = 0;
      words.forEach((w) => {
        const w2 = (w === "lite") ? "flash" : (w === "flash" ? "lite" : w);   // 控制台叫 lite、API 常叫 flash
        if (cc.includes(w) || cc.includes(w2)) score += 1;
      });
      if (/seedream/.test(cc) && /seedream/.test(t)) score += 1;
      // 版本号完全一致 = 最强信号（如控制台 "5.0-lite 260128" → doubao-seedream-5-0-260128）
      if (typedVer && cc.indexOf(typedVer) >= 0) score += 4;
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return bestScore >= Math.max(3, words.length) ? best : "";
  }

  /* ---------- Key 体检：方舟把 401 的 CORS 头也省了，前端只会看到 "Failed to fetch"，所以先拦明显填错 ---------- */
  function keyHint(key, provider) {
    const k = String(key || "").trim();
    if (!k) return "还没填 API Key";
    if (/^api-key-/i.test(k) || /^api[-_]?key[-_]/i.test(k)) {
      return "这看起来是密钥的**名称**（api-key-…），不是密钥本身。请点控制台密钥那行的「👁 显示 / 📋 复制」，复制以 ark- 开头的那一整串。";
    }
    if (provider === "ark" && !/^ark-/.test(k) && !/^[0-9a-f-]{30,}$/i.test(k)) {
      return "方舟的 API Key 一般以 ark- 开头，请确认复制完整（别只复制了名字或前半段）。";
    }
    // ★ 最常见的"复制不完整"：控制台里密钥显示成 `ark-xxxxxxxx-…-xxxxxx…`（末尾省略号），
    //   手选文字就会少掉最后几位 → 请求 401 → 浏览器只报 Failed to fetch，很难自查。
    //   方舟完整密钥 = ark- + UUID（8-4-4-4-**12** 位十六进制）。
    //   ⚠️ 只在"形状能证明被截断"时才拦（前四组齐全、最后一组不足 12 位）——
    //      万一以后换成长度/格式不同的密钥，也不会把合法密钥误拦下来。
    if (provider === "ark" && /^ark-/i.test(k) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k.slice(4)) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{1,11}$/i.test(k.slice(4))) {
      return "这串密钥看起来**没复制完整**：方舟 key 一般形如 `ark-` + 8-4-4-4-12 位（有些末尾还会多一小段，如 `-69485`），你填的有 " + k.length +
        " 个字符、最后一段明显短了一截。控制台里密钥显示成 `ark-xxxxxxxx-…-xxxxxx…`（末尾省略号）时，**别手选文字，点它右边的「📋 复制」按钮**整串复制。";
    }
    if (provider === "siliconflow" && !/^sk-/.test(k)) return "硅基流动的 key 一般以 sk- 开头。";
    if (provider === "zhipu" && k.length < 20) return "智谱的 key 看起来不完整。";
    return "";
  }
  function isFetchFail(msg) {
    return /Failed to fetch|NetworkError|Load failed|网络/i.test(String(msg || ""));
  }

  /* ---------- 连通性自检（设置页「测试连接」用；出错时把服务端原因带出来） ---------- */
  async function testImage() {
    const cfg = getImageCfg();
    const info = providerInfo(cfg);
    if (info.keyless) return { ok: true, msg: "免密钥通道：无需 key（但只有 sana 小模型，风格不稳）" };
    const fake = { id: "conn-test", color: "green", softness: "soft", beadShape: "round" };
    const r = await generateImage(fake, 0);
    return { ok: true, msg: "出图成功：" + (r.kind === "b64" ? "返回 base64 图片" : r.url.slice(0, 60)) };
  }
  async function testText() {
    const info = textInfo();
    if (!info.key) return { ok: false, msg: "还没填 API Key" };
    const txt = await textChat([{ role: "user", content: "只回复两个字：正常" }], 16);
    return { ok: true, msg: "文字模型回复：" + (txt || "(空)").slice(0, 40) };
  }

  /* =========================================================
   * v157：回忆册 —— 把这只精灵的"第一次"串成一条时间线
   *   全本地推导，0 出图 0 模型调用；数据源都是已经存下来的时间戳
   * ========================================================= */
  function memoirOf(item, rec, ctx) {
    item = item || {}; rec = rec || {};
    const out = [];
    const add = (at, icon, title, sub) => {
      const t = Number(at) || 0;
      if (!t || !title) return;
      out.push({ at: t, icon: icon, title: String(title), sub: sub ? String(sub) : "" });
    };

    // ① 到家（入藏那天）
    add(item.createdAt || item.arrivedAt, "🛍", "把它带回家", "一串还没脾气的珠子");
    // ② 挂瓷成精
    add(rec.bornAt, "✨", "挂瓷成精", "它第一次开口，喊的是你");
    // ③ 模样与突破：立绘历史里 stage 发生变化的那些（第一条 = 初次有模样）
    const hist = (rec.imgHistory || []).filter((x) => x && x.at);
    let last = 0;
    hist.forEach((x) => {
      const st = Number(x.stage) || 0;
      if (st < 1 || st === last) return;
      const def = stageDef(st);
      if (st === 1) add(x.at, "🎨", "有了自己的模样", def.icon + " " + def.name);
      else add(x.at, "⚡", "突破 · " + def.name, "从上一形态又长大了一岁");
      last = st;
    });
    // ④ 回响信（它替你记着的那些日子）
    (rec.echoes || []).forEach((e) => add(e && e.at, "✦", (e && e.title) || "✦ 回响", "它替你记着的日子"));
    // ⑤ 第一篇日记
    const d0 = (rec.diary || [])[0];
    add(d0 && d0.at, "📔", "写下第一篇日记", "从此有了自己的心事");
    // ⑥ 第一张专属 CG
    add(rec.cgAt, "🎬", "有了第一张专属插画", "你们的第一幕场景");

    out.sort((a, b) => a.at - b.at);
    return out;
  }

  /* =========================================================
   * v157：精灵小镇 —— 每天自带几条"小镇里发生的小事"
   *   纯本地拼接（确定性：同一天同一结果），0 出图 0 模型调用
   * ========================================================= */
  const TOWN_EVENTS = [
    { icon: "🍵", t: "{a} 给 {b} 倒了盏茶，谁也没说话，坐了一炷香。" },
    { icon: "🪡", t: "{b} 的线头散了，{a} 低头替它理顺，理了很久。" },
    { icon: "🪷", t: "院子里那盆莲开了，{a} 把 {b} 叫出来看，两个人都没看出门道。" },
    { icon: "🍊", t: "{a} 分了个橘子给 {b}，自己留了最小的一瓣。" },
    { icon: "🌙", t: "半夜 {a} 醒了，发现 {b} 也睁着眼，就一起坐到天亮。" },
    { icon: "🪑", t: "为了院里那把竹椅，{a} 和 {b} 客气了一整天，最后谁也没坐。" },
    { icon: "📿", t: "{a} 教 {b} 数珠子，{b} 数到第三遍还是乱了。" },
    { icon: "🕯", t: "{b} 喊冷，{a} 把自己的棉垫挪过去一半。" },
    { icon: "🐈", t: "一只野猫翻墙进来，{a} 和 {b} 一起看着它，直到它走。" },
    { icon: "🎋", t: "{a} 在墙上刻了一道，说这是它和 {b} 认识的头一个月。" },
    { icon: "🍚", t: "灶上的饭糊了，{a} 说是 {b} 干的，{b} 没否认。" },
    { icon: "🪁", t: "{a} 把风筝放断了线，{b} 说：断了就断了，明年再放。" },
    { icon: "🧵", t: "{b} 的袖口磨破了，{a} 用同色的线补上，不细看看不出来。" },
    { icon: "🌧", t: "下雨了，{b} 站在檐下不肯进去，{a} 就陪它站着。" },
    { icon: "🍶", t: "{a} 把最后一盅让给了 {b}，说它今天高兴。" },
    { icon: "🪶", t: "{a} 替 {b} 掸了掸肩上的灰，动作很轻。" },
    { icon: "🧺", t: "{a} 和 {b} 一起晒了被子，收的时候抢着抱同一床。" },
    { icon: "🪔", t: "灯芯烧短了，{a} 伸手挑亮，{b} 就着光看它。" },
  ];
  // cast: [{ id, name, roomId }] —— 由调用方组装（spirits 里不读 storage，方便单测）
  function townEvents(cast, opts) {
    opts = opts || {};
    const list = (cast || []).filter((x) => x && x.id && x.name);
    if (list.length < 2) return [];
    const day = String(opts.day || todayKey());
    const n = Math.max(1, Math.min(6, Number(opts.n) || 3));
    const out = [];
    const usedTpl = {};
    for (let i = 0; i < n; i++) {
      const h = hashStr(day + "#town#" + i);
      // 2/3 概率优先挑"住同一间屋子"的一对，其余跨屋（在院子里碰上）
      const byRoom = {};
      list.forEach((x) => { if (x.roomId) (byRoom[x.roomId] = byRoom[x.roomId] || []).push(x); });
      const roomIds = Object.keys(byRoom).filter((r) => byRoom[r].length >= 2);
      let a = null, b = null;
      if (roomIds.length && (h % 3 !== 0)) {
        const arr = byRoom[roomIds[(h >> 4) % roomIds.length]];
        let ai = (h >> 8) % arr.length;
        let bi = (h >> 12) % arr.length;
        if (bi === ai) bi = (ai + 1) % arr.length;      // 保证 a、b 不是同一只
        a = arr[ai]; b = arr[bi];
      } else {
        let ai = (h >> 8) % list.length;
        let bi = (h >> 12) % list.length;
        if (bi === ai) bi = (ai + 1) % list.length;
        a = list[ai]; b = list[bi];
      }
      if (!a || !b || a.id === b.id) continue;
      // 几条动态尽量不撞同一句模板
      let ti = (h >> 5) % TOWN_EVENTS.length;
      for (let k = 0; k < TOWN_EVENTS.length && usedTpl[ti]; k++) ti = (ti + 1) % TOWN_EVENTS.length;
      usedTpl[ti] = 1;
      const tpl = TOWN_EVENTS[ti];
      out.push({
        icon: tpl.icon,
        a: a.id, b: b.id, aName: a.name, bName: b.name,
        sameRoom: !!a.roomId && a.roomId === b.roomId,
        text: String(tpl.t).split("{a}").join(a.name).split("{b}").join(b.name),
      });
    }
    return out;
  }

  window.Spirits = {
    PROVIDERS, STYLE_PRESETS, DEFAULT_STYLE, SIZE_PRESETS, SIZE_PRESETS_BY_PROVIDER, sizePresetsFor, DEFAULT_SIZE, getImageCfg, setImageCfg, providerInfo, sizeLadderFor, MODEL_PICKS, refSupportOf, refSupportText, keyUiHint,
    STAGES, stageDef, stageInfo, growthOf,
    appearanceOf, appearanceText, appearancePrompt, HAIR_STYLES, BOY_HAIR, GIRL_HAIR, EYE_COLORS, ACCESSORIES,
    // v127：设定向导（发色/特征/性格可确认可修改；一句基础设定 → 扩写成详细设定）
    HAIR_COLORS, HAIR_PALETTE, hexToCnTrad, FEATURES, PERSONAS_PICK, lookOf, lookText, lookExtra, hairWordFromInput, expandProfile, profileLocal,
    COLOR_ZH, HAIR_ZH, EYES_ZH, ACC_ZH, VIBE_ZH,
    TEXT_PROVIDERS, getTextCfg, setTextCfg, textInfo, textChat, testImage, testText, listModels,
    promptFor, pollinationsUrl, generateImage, localAvatarSvg, seedOf, normModelName, pickBestModel, keyHint, isFetchFail,
    localPersona, persona, chat, letter, localChat, localLetter,
    todayKey, load, save, ensureIn,
    // v110：性别在「挂瓷成精」时定下来（男女 3:1），之后不可改
    born, rollGender, legacyGender,
    // v111：主人设定（性别/昵称）—— 日记、剧情、聊天、人物设定都要按它来写
    getOwner, setOwner, ownerLine,
    // v112：形象细节（服装/纹样/布料/道具/姿态）+ 人物设定 → 形象关键词
    appearanceDetail, OUTFITS, PATTERNS, PROPS, POSES, buildLookTags, getLookTags, localLookTags, lookTagsStale,
    // v109：真实主色 / 中文人物设定 / 日记 / 房间剧情
    beadColor, detectBeadColor, setBeadColor, hexToWord, hexZh,
    personaZh, personaZhLocal, ensureDiary, diarySlots, diaryLocal, roomStory, storyLocal,
    // v125：剧情 CG
    storyCgPrompt, promptForCg, generateCustom, CG_STYLE, CG_SIZE_BY_PROVIDER, cgSizeFor, cgLadderFor,
    // v125：阶段规则 —— 幼生/成长只有立绘；觉醒/完成体额外出 CG
    cgStages: [3, 4], needCg: function (stage) { return (Number(stage) || 1) >= 3; },
    // v155：陪伴系统（每日问候 / 亲密度 / 每日一签 / 日记回信 / 回响）—— 全本地，0 成本
    BOND_LEVELS, BOND_CALL_AT, bondLevel, settleBond, addBond, callOf,
    GREET, greetingOf, ensureGreet,
    SIGNS, signOf, ensureSign,
    replyDiary, pendingReply,
    ECHO_DAYS, ECHO_LABEL, echoDue, ensureEcho, nextEcho, unreadMail,
    // v157：回忆册（本地时间线，0 成本）
    memoirOf,
    // v157：精灵小镇（本地动态，0 成本）
    TOWN_EVENTS, townEvents,
    // v158：节令事件（全本地；限定 CG 由界面按钮手动确认才花）
    FEST_LUNAR, FEST_DEF, FEST_SOLAR, FEST_LINES, festOf, festMap, nextFest, ensureFest, festList, festCgPrompt,
    // v158：主线「串与我」（串与主人之间，按四形态分卷；全本地 0 成本）
    CHAPTERS, chapterState, chapterText, readChapter, unreadChapterCount,
    // v160：夜话（跨串大剧情 · 互动对话）—— 本地剧本 + 本地状态机，0 出图 0 模型调用
    NIGHT_ACTS, NIGHT_GROUP, NIGHT_CAP, nightCast, nightActs, nightEnter, nightReplay, nightChoose, nightBrief,
  };
})();
