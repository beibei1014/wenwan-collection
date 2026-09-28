/* =========================================================
 * spirits.js — 🍡 精灵（挂瓷成精的手串伙伴）
 * 已挂瓷的串 "成精"：卡通形象（AI 绘图 / 本地程序化兜底）+ 性格 + 互相聊天 + 给你送信
 * · 绘图默认走免密钥通道（Pollinations，浏览器直连出图）；也可切到国内 API（OpenAI 兼容）
 * · 文字（性格/聊天/信件）用 DeepSeek（复用「设置 → AI 助手密钥」的 key）；没 key 用本地模板
 * · 所有数据先存 localStorage（不新增数据库字段也能跨天保留；以后想跨手机同步再加列）
 * ========================================================= */
(function () {
  "use strict";

  const STORE_KEY = "ww_spirits";      // { [itemId]: { persona, variant, imgUrl, letters, chats, lastLetterDay } }
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
    { en: "a scholar's crossed-collar robe with a wide sash", zh: "交领长衫 + 宽腰带" },
    { en: "a chunky knit vest over a collared shirt", zh: "粗针织毛背心 + 衬衫" },
    { en: "a hooded windbreaker with layered shorts", zh: "连帽风衣 + 层次短裤" },
    { en: "a short-sleeved kimono-style yukata with a thin obi", zh: "和风浴衣 + 细腰带" },
    { en: "a loose linen tunic with rolled sleeves and a rope belt", zh: "亚麻罩衫 + 绳结腰带" },
    { en: "an embroidered front-button jacket with cloud-patterned trim", zh: "绣花对襟褂 + 云纹滚边" },
    { en: "a camel cape over a high-neck base layer", zh: "驼色小斗篷 + 高领内搭" },
    { en: "a multi-pocket utility vest with a rolled scarf", zh: "多口袋马甲 + 围巾" },
    { en: "a plain wrap-front top with a cloth sash", zh: "素色裹襟上衣 + 布腰封" },
    { en: "a sporty track jacket with side-striped trousers", zh: "运动夹克 + 侧条纹裤" },
  ];
  const PATTERNS = [
    { en: "cloud motif", zh: "云纹" }, { en: "tiny star specks", zh: "星点" },
    { en: "rippling wave lines", zh: "水波" }, { en: "small plaid check", zh: "细格" },
    { en: "polka dots", zh: "圆点" }, { en: "trailing vine leaves", zh: "缠枝" },
  ];
  const MATERIALS = ["matte linen", "soft brushed cotton", "sheeny silk", "cozy wool knit", "washed denim", "papery hemp"];
  const MATERIALS_ZH = { "matte linen": "哑光亚麻", "soft brushed cotton": "磨毛棉", "sheeny silk": "丝光", "cozy wool knit": "绒线针织", "washed denim": "水洗牛仔", "papery hemp": "麻质" };
  const PROPS = [
    "holding a small tea cup", "carrying a tiny wooden tray", "holding a folding paper fan",
    "holding a small paper lantern", "carrying a little woven basket", "holding a sprig of blossoms",
    "holding a slim wooden scroll", "holding a small cloth pouch",
  ];
  const PROPS_ZH = {
    "holding a small tea cup": "捧着茶杯", "carrying a tiny wooden tray": "端着木托盘", "holding a folding paper fan": "拿着折扇",
    "holding a small paper lantern": "提着小灯", "carrying a little woven basket": "挎着小竹篮", "holding a sprig of blossoms": "拿着一枝花",
    "holding a slim wooden scroll": "握着卷轴", "holding a small cloth pouch": "拎着布囊",
  };
  // 性格 → 表情/姿态（把"性格"画进立绘里，而不是只换颜色）
  const POSES = [
    "standing calmly with hands folded in front, gentle closed-lip smile",
    "mid-gesture with one hand raised as if explaining something, bright open smile",
    "head slightly tilted with hands behind the back, gaze a little off to the side, soft shy smile",
    "one hand throwing a small peace sign, mischievous grin, weight shifted onto one leg",
    "both hands cupped in front, warm soft expression, relaxed shoulders",
    "arms lightly crossed with the chin slightly raised, confident half-smile",
  ];
  const POSES_ZH = ["双手交叠站得端正", "抬手比划着说话", "背手歪头、眼神偏一点", "比个小剪刀手、坏笑",
    "双手捧在身前、神情温柔", "抱臂微抬下巴、自信"];
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
  function appearanceOf(item, seedN, gender) {
    const h = hashStr(String((item && item.id) || "") + "#" + (seedN || 0));
    const g = (gender === "boy" || gender === "girl") ? gender
      : (item && item.gender === "boy" || item && item.gender === "girl") ? item.gender
      : rollGender((item && item.id) || "");        // 兜底：老记录/未成精时按 id 稳定掷一次
    const hairs = g === "boy" ? BOY_HAIR : GIRL_HAIR;
    const vi = (h >> 12) % VIBES.length;
    return {
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
      pose: POSES[vi],
      vibe: VIBES[vi],
      vibeIdx: vi,
    };
  }
  function appearanceText(ap) {
    const g = ap.vibeIdx != null ? ap.vibeIdx : Math.max(0, VIBES.indexOf(ap.vibe));
    return (ap.gender === "boy" ? "👦 男孩" : "👧 女孩") + " · " + (HAIR_ZH[ap.hair] || ap.hair) + " · " +
      (EYES_ZH[ap.eyes] || ap.eyes) + "眼睛 · " + (ACC_ZH[ap.acc] || ap.acc) +
      " · " + (ap.outfitZh || ap.outfit) + " · " + (ap.patternZh || ap.pattern) + "纹" +
      " · " + (MATERIALS_ZH[ap.material] || ap.material) + " · " + (POSES_ZH[g] || "");
  }
  // 形象细节条（详情页给人看的一行短描述）
  function appearanceDetail(ap) {
    return (ACC2_ZH[ap.acc2] || ap.acc2) + " · " + (PROPS_ZH[ap.prop] || ap.prop) + " · " +
      (MATERIALS_ZH[ap.material] || ap.material) + " · " + (VIBE_ZH[ap.vibe] || ap.vibe);
  }
  function appearancePrompt(ap) {
    const isBoy = ap.gender === "boy";
    // 男性/女性特征要写死，并且**明确排除异性发型**（只写 "boy" 模型偶尔照样给长发）
    // v112：除了性别/发型/瞳色，还把 服装、纹样、布料、配饰、姿态、道具 全部写进去 —— 形象不再"只有颜色"
    return (isBoy
      ? "a young boy character, clearly male, boyish face, short masculine hair style: "
      : "a young girl character, clearly female, girlish face, feminine hair style: ") +
      ap.hair + " hair, " + ap.eyes + " eyes, wearing " + ap.acc + " and " + ap.acc2 + ", " +
      "outfit: " + ap.outfit + ", trimmed with " + ap.pattern + ", " + ap.material + " fabric texture, " +
      "pose: " + ap.pose + (ap.prop ? ", " + ap.prop : "") + ", " + ap.vibe + " personality" +
      (isBoy ? ", no long hair, no twin tails, no ponytail, no feminine hair style"
             : ", no boyish buzz cut, no masculine short hair");
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
      label: "日漫风 · 角色",
      // ⚠️ 这里**不能**写 chibi / big head：那是"身形比例"，必须交给阶段描述（STAGES.look），
      //    否则突破到觉醒期/完成体也还是 Q 版大头（用户实测吐槽过）。
      text: "Japanese anime illustration, 2D anime character art, big expressive anime eyes with white highlights, " +
        "cel shading, flat anime coloring, clean line art, soft pastel color palette, soft blush, " +
        "richly detailed outfit design with visible fabric folds and seams, small ornamental accessories, " +
        "expressive pose with personality, full body, centered composition, plain solid pastel background, " +
        "hand-drawn 2D anime art, no 3D render, no realistic photo, no gradient mesh",
    },
    animepet: {
      label: "日漫风 · 小生物",
      text: "Japanese anime style cute mascot creature, original pokemon-like creature design, cel shading, flat anime coloring, " +
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
    { id: "cheeky", zh: "古灵精怪", en: "playful and mischievous", face: "cheeky grin with a raised eyebrow" },
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
    const ap = appearanceOf(item, r.appearanceSeed || 0, r.gender || "");
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
      hairEn = w || beadWord;
      hairHex = /^#/.test(String(lk.customColor || "").trim()) ? String(lk.customColor).trim() : "";
      hairSrc = "custom"; hairZh = lk.customColor || "自定色";
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
    const feats = ids.map((x) => FEATURE_BY_ID[x]).filter((f) => f && f.id !== "none").slice(0, 3);
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
    const baseTxt = (lk && lk.base) ? ("主人说过：「" + lk.base + "」——它一直记着这句话。") : "";
    return nm + "是从主人那串「" + ((item && item.name) || "手串") + "」里醒过来的小精灵。" +
      "它的头发是" + ((lk && lk.hairZh) ? String(lk.hairZh).replace(/^自动 · /, "") : beadZh) + "，" + hairTxt + "；" +
      (featTxt ? featTxt + "；" : "") +
      "衣服的色调跟着珠子的" + beadZh + "走，看久了很安稳。" +
      "性子偏「" + persTxt + "」，平时话不多，但主人一伸手它就会靠过来。" + baseTxt;
  }
  // 用文字模型把"一句基础设定 + 选项"扩写成一小段（失败就退回本地模板）
  async function expandProfile(item, lk, persona) {
    const local = profileLocal(item, lk, persona);
    const base = (lk && lk.base) ? String(lk.base).trim() : "";
    const sys = "你是一个角色设定师。请根据用户给的选项，为主人的手串精灵写一小段中文人物设定，要求：" +
      "① 只写 90-150 字，一段话，不要标题、不要分点、不要引号；② 必须体现：外貌（发色 / 特殊特征）、性格、和主人以及这串珠子的关系；" +
      "③ 口吻温柔、有画面感，像手账里的备注；④ 不要出现「AI」「提示词」「角色设定」这类词。";
    const NL = String.fromCharCode(10);
    const user = "精灵名：" + ((persona && persona.name) || item.name || "小精灵") +
      NL + "来自手串：" + ((item && item.name) || "") + (item && item.craft ? "（" + item.craft + "）" : "") +
      NL + "发色：" + ((lk && lk.hairZh) || "跟珠子主色") +
      NL + "特殊特征：" + ((lk && lk.feats && lk.feats.length) ? lk.feats.map((f) => f.zh).join("、") : ((lk && lk.noFeat) ? "普通人形" : "未指定")) +
      NL + "性格：" + ((lk && lk.pers) ? lk.pers.zh : "未指定") +
      (base ? (NL + "主人给的一句话设定：" + base) : "") +
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
    const bits = [cmp, soft, SINGLE, CONSISTENCY, GROWTH_LINE];
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
    return [ap.outfit, ap.material + " fabric", ap.pattern + " trim", ap.acc, ap.acc2,
      ap.pose, ap.prop, ap.vibe + " expression"].filter(Boolean).join(", ");
  }
  // 有 AI 时：让它读完中文人物设定，输出英文绘图关键词（形象就"照着人设画"）
  async function buildLookTags(item, ap, personaZh, persona) {
    const key = lookKeyOf(ap) + "|" + (personaZh ? hashStr(personaZh).toString(36) : "");
    const all = loadLooks();
    if (all[item.id] && all[item.id].key === key && all[item.id].tags) return all[item.id].tags;
    let tags = "";
    if (getAiKey() && personaZh) {
      try {
        const sys = "你是动画角色设定师。读给定的中文人物设定，输出一行**英文**绘图关键词（逗号分隔，12-20 个），"
          + "依次覆盖：服装款式与剪裁、布料质感、配色与纹样点缀、发型细节、配饰细节、表情、姿势、1 个小道具。"
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
    return !r.tags || r.key.split("|").length !== lookKeyOf(ap).split("|").length;
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
      "衣服和头发的颜色都取自原来的珠子，" + (colorName.indexOf("多") === 0 ? "五颜六色，像一串会走路的多宝" : "就是那一种" + colorName + "，看久了很安稳") + "。",
      "性格" + vibe + "，说话" + (p.line ? "爱用「" + p.line + "」这种腔调" : "慢悠悠的") + "，" + extra + "。" +
      "它不太会催人，主人忙的时候就自己找个角落待着，" + (plays > 12 ? "被盘得多了，已经很有底气" : "被摸得还不多，偶尔会小声提醒一下") + "。",
      "到今天为止，它陪着主人 " + (days || 0) + " 天了，被正经盘过 " + (plays || 0) + " 次。" +
      "它最喜欢的位置是主人的手心，其次是靠近窗户的那一小块桌子——那里下午会有光。",
    ].join("");
  }
  async function personaZh(item, ap, persona, stage, days, plays, force) {
    const store = load();
    const rec = ensureIn(store, item.id);
    const key = (ap.gender || "") + "|" + ap.hair + "|" + ap.eyes + "|" + ap.acc + "|" + (item.color || "") + "|" + (persona && persona.name || "");
    if (!force && rec.personaZh && rec.personaZhKey === key) return rec.personaZh;
    let txt = "";
    if (getAiKey()) {
      try {
        const sys = "你在为一个中文文玩收藏 App 写「挂瓷精灵」的人物设定卡。手串盘到挂瓷会成精，变成一只 Q 版小精灵。"
          + "请写一段连贯的中文人物设定，200-300 字，用第三人称旁观介绍（不要用「你」称呼精灵），"
          + "必须包含：① 外形（性别、发型、瞳色、配饰、衣服/头发颜色要说明取自古珠的颜色）"
          + "② 性格（含 2-3 个具体小习惯）③ 与主人的关系与日常。"
          + "语气温和好读，不要 Markdown、不要标题、不要分点、不要解释，直接输出正文。";
        const user = "原型手串：" + (item.name || "未命名") + "；精灵的名字：" + ((persona && persona.name) || item.name || "未命名") +
          "；颜色：" + (COLOR_ZH[item.color] || "素色") +
          "；软糯：" + (item.softness === "soft" ? "软糯" : item.softness === "slight" ? "微糯" : "未标注") +
          "；形态：" + stageDef(stage).name + "；陪伴 " + (days || 0) + " 天；盘玩 " + (plays || 0) + " 次；" +
          "固定人设：" + appearanceText(ap) + "；性格基调：" + (VIBE_ZH[ap.vibe] || ap.vibe) +
          ((persona && persona.traits && persona.traits.length) ? "（" + persona.traits.join("、") + "）" : "") +
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
          "；今天是陪主人的第 " + ((ctx && ctx.dayNo) || 1) + " 天。\n" + ownerLine() + "\n请写今天的日记。";
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
      save(store);
      added = 1;
    }
    return added;
  }

  // v113：不再提供"立刻写一篇"（用户要求日记只靠每天随机写才有惊喜）

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
  const CG_STYLE = "Japanese anime key visual CG illustration, 2D anime movie still, cel shading, " +
    "soft pastel palette, cinematic lighting, atmospheric mood, detailed painted background with gentle bokeh, " +
    "expressive body language, warm cozy feeling, masterpiece quality, " +
    "WIDE LANDSCAPE HORIZONTAL COMPOSITION, 16:9 cinematic framing like an anime film screenshot, " +
    "wide scenery on both sides, generous environment around the character, not a portrait, not a vertical poster, " +
    "no text, no letters, no words, no title, no labels, no watermark, no signature, no logo, " +
    "single continuous scene, no split panels, no collage";
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
      "scene: a cozy little room called \"" + (roomName || "little room") + "\" at home, " +
      "two anime characters together in the same scene: " +
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

  window.Spirits = {
    PROVIDERS, STYLE_PRESETS, DEFAULT_STYLE, SIZE_PRESETS, SIZE_PRESETS_BY_PROVIDER, sizePresetsFor, DEFAULT_SIZE, getImageCfg, setImageCfg, providerInfo, sizeLadderFor, MODEL_PICKS, refSupportOf, refSupportText, keyUiHint,
    STAGES, stageDef, stageInfo, growthOf,
    appearanceOf, appearanceText, appearancePrompt, HAIR_STYLES, BOY_HAIR, GIRL_HAIR, EYE_COLORS, ACCESSORIES,
    // v127：设定向导（发色/特征/性格可确认可修改；一句基础设定 → 扩写成详细设定）
    HAIR_COLORS, FEATURES, PERSONAS_PICK, lookOf, lookText, lookExtra, hairWordFromInput, expandProfile, profileLocal,
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
  };
})();
