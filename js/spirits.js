/* =========================================================
 * spirits.js — 🍡 挂瓷精灵
 * 已挂瓷的串 "成精"：卡通形象（AI 绘图 / 本地程序化兜底）+ 性格 + 互相聊天 + 给你送信
 * · 绘图默认走免密钥通道（Pollinations，浏览器直连出图）；也可切到国内 API（OpenAI 兼容）
 * · 文字（性格/聊天/信件）用 DeepSeek（复用「设置 → AI 助手密钥」的 key）；没 key 用本地模板
 * · 所有数据先存 localStorage（不新增数据库字段也能跨天保留；以后想跨手机同步再加列）
 * ========================================================= */
(function () {
  "use strict";

  const STORE_KEY = "ww_spirits";      // { [itemId]: { persona, variant, imgUrl, letters, chats, lastLetterDay } }
  const CFG_KEY = "ww_imgcfg";         // 绘图通道配置
  // 出图尺寸：Seedream 5.0 要求「至少 3,686,400 像素」（1024x1024 才 1,048,576 → 会被拒），
  // 所以默认用 2K 档（2048² ≈ 4.19M 像素，稳过）；竖版立绘可选 3:4。
  const DEFAULT_SIZE = "2K";
  const SIZE_PRESETS = [
    { v: "2K", label: "2K（推荐）" },
    { v: "1728x2304", label: "竖版立绘 3:4" },
    { v: "2048x2048", label: "方形 2048" },
    { v: "4K", label: "4K（最清晰也最贵）" },
  ];
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
  function save(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* 空间不足忽略 */ } }
  function ensureIn(store, id) {
    if (!store[id]) store[id] = { persona: null, variant: 0, imgUrl: "", letters: [], chats: [], lastLetterDay: "", stage: 1, imgHistory: [] };
    if (store[id].stage == null) store[id].stage = 1;              // 老数据兼容：默认幼生期
    if (!Array.isArray(store[id].imgHistory)) store[id].imgHistory = [];
    return store[id];
  }

  /* ---------- 外观锚点（v104）：每只精灵有固定人设，所有形态共享，突破不会变性/变色 ---------- */
  const HAIR_STYLES = ["short spiky", "long straight", "twin tails", "shoulder-length bob", "high ponytail", "messy soft curls"];
  const EYE_COLORS = ["amber", "sky blue", "violet", "deep brown", "emerald", "golden"];
  const ACCESSORIES = ["a small shell hairpin", "a silk scarf", "a single round earring", "a forehead bead band",
    "a bead bracelet on the wrist", "a hair ribbon", "a tiny bell charm", "a wooden pendant"];
  const VIBES = ["calm and reliable", "cheerful and talkative", "quiet and thoughtful", "playful and mischievous",
    "gentle and caring", "cool and a little proud"];
  // 由「串 id + 外观种子」决定；外观种子只在用户点「换外观设定」时变
  function appearanceOf(item, seedN) {
    const h = hashStr(String((item && item.id) || "") + "#" + (seedN || 0));
    return {
      gender: (h % 2 === 0) ? "boy" : "girl",
      hair: HAIR_STYLES[(h >> 3) % HAIR_STYLES.length],
      eyes: EYE_COLORS[(h >> 6) % EYE_COLORS.length],
      acc: ACCESSORIES[(h >> 9) % ACCESSORIES.length],
      vibe: VIBES[(h >> 12) % VIBES.length],
    };
  }
  function appearanceText(ap) {
    return (ap.gender === "boy" ? "👦 男孩" : "👧 女孩") + " · " + ap.hair + " · " + ap.eyes + " eyes · " + ap.acc;
  }
  function appearancePrompt(ap) {
    return "a " + (ap.gender === "boy" ? "boy" : "girl") + " character with " + ap.hair + " hair, " +
      ap.eyes + " eyes, wearing " + ap.acc + ", " + ap.vibe + " personality";
  }
  // 一致性硬约束：每次出图都带上，防止突破后"换人"
  const CONSISTENCY = "same character across all ages, keep exactly the same gender, same hair style and hair color, " +
    "same eye color, same accessory and same overall design, only grow older, character evolution sheet, " +
    "consistent character design, do not change gender, do not change identity";

  /* ---------- 进阶系统：四形态、三次突破（v103） ----------
     幼生期 → 成长期 → 觉醒期 → 完成体；成长值 = 盘玩次数×3 + 陪伴天数×1
     每个阶段有**各自的外形描述**，越往后越"帅/酷/美"，但颜色与性格一路贯穿 */
  const STAGES = [
    {
      n: 1, name: "幼生期", icon: "🥚", need: 0,
      look: "a tiny newborn baby version of the character, very small chubby body, big head and tiny limbs, " +
        "simple minimal details, sleepy innocent eyes, just awakened, extremely cute and soft",
    },
    {
      n: 2, name: "成长期", icon: "🌱", need: 30,
      look: "a small child version of the character, slightly taller and more defined, lively bright eyes, " +
        "simple but neat outfit, energetic pose, still cute and round",
    },
    {
      n: 3, name: "觉醒期", icon: "⚡", need: 90,
      look: "a cool teenage version of the character, confident dynamic pose, stylish detailed outfit, " +
        "glowing aura and light particles, sharp determined eyes, cinematic lighting",
    },
    {
      n: 4, name: "完成体", icon: "👑", need: 180,
      look: "a stunning fully-realized adult anime character, magnificent ornate outfit with elegant details, " +
        "powerful graceful aura, beautiful and cool, masterpiece quality, epic composition, breathtaking",
    },
  ];
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
    siliconflow: { label: "硅基流动 SiliconFlow（注册送额度，推荐）", endpoint: "https://api.siliconflow.cn/v1/images/generations", model: "Kwai-Kolors/Kolors" },
    ark: { label: "火山方舟（豆包 Seedream，有免费额度）", endpoint: "https://ark.cn-beijing.volces.com/api/v3/images/generations", model: "doubao-seedream-5-0-flash-260915" },
    zhipu: { label: "智谱 CogView（约 ¥0.06/张，最便宜之一）", endpoint: "https://open.bigmodel.cn/api/paas/v4/images/generations", model: "cogview-4" },
    modelscope: { label: "魔搭 ModelScope（送免费额度）", endpoint: "https://api-inference.modelscope.cn/v1/images/generations", model: "Qwen/Qwen-Image" },
    bailian: { label: "阿里百炼 通义万相（浏览器直连受限，不推荐）", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/images/generations", model: "wan2.6-t2i" },
    custom: { label: "自定义（OpenAI 兼容）", endpoint: "", model: "" },
  };
  function getImageCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && o.provider) return o;
    } catch (e) { /* 忽略 */ }
    return { provider: "pollinations", key: "", model: "", endpoint: "", style: DEFAULT_STYLE, size: DEFAULT_SIZE };
  }
  function setImageCfg(cfg) { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* 忽略 */ } }
  function providerInfo(cfg) {
    const p = PROVIDERS[cfg.provider] || PROVIDERS.pollinations;
    return {
      label: p.label,
      endpoint: cfg.endpoint || p.endpoint || "",
      model: cfg.model || p.model || "",
      keyless: !!p.keyless,
      key: cfg.key || "",
    };
  }

  /* ---------- 风格预设（默认 = 日漫风，用户明确要求） ---------- */
  // anime   = 日漫风 Q 版角色（像用户参考图那种 2D 日漫手绘、赛璐璐上色）
  // animepet= 日漫风小生物（宝可梦那种原创生物）
  // flat    = 扁平贴纸风   ink = 国风水墨
  const STYLE_PRESETS = {
    anime: {
      label: "日漫风 · Q版角色",
      text: "Japanese anime illustration, 2D anime style, cute chibi character, big sparkling anime eyes with white highlights, " +
        "cel shading, flat anime coloring, clean bold line art, soft pastel color palette, small gentle smile, soft blush, " +
        "chibi proportion with slightly big head, full body, centered composition, plain solid pastel background, " +
        "hand-drawn 2D anime art, kawaii, no 3D render, no realistic face, no photo, no gradient mesh",
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
  const SOFT_EN = {
    soft: "extremely soft and squishy mochi-like round body, relaxed happy sleepy eyes",
    slight: "slightly soft smooth polished surface, calm gentle expression",
    "": "smooth polished surface, friendly gentle expression",
  };
  function promptFor(item, styleKey, stage, appearance) {
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    const color = COLOR_EN[item.color] || "jade green";
    const soft = SOFT_EN[item.softness || ""] || SOFT_EN[""];
    const isChar = (key === "anime");          // 日漫 Q 版角色：颜色落在头发/衣服上
    const lk = stageDef(stage == null ? 1 : stage).look;   // 该形态的外形描述（进阶的核心）
    const ap = appearance || appearanceOf(item, 0);         // 固定人设（性别/发型/瞳色/配饰）
    let cmp;
    if (isChar) {
      // 先写死"这个人是谁"（外观锚点），再写"他现在多大"（形态描述）→ 突破只会长大，不会换人
      cmp = appearancePrompt(ap) + ", with " + color + " hair and " + color + " themed outfit, " +
        lk + ", " +
        "full body character illustration, standing pose, whole body visible from head to toe, " +
        "detailed outfit and shoes, character design sheet style, vertical composition, " +
        "centered with comfortable margin around the character";
    } else {
      cmp = "a " + (ap.gender === "boy" ? "boy" : "girl") + " creature mascot whose body color is " + color +
        ", wearing " + ap.acc + ", " + ap.vibe + " personality, " + lk + ", " +
        "full body creature illustration, whole body visible, centered with comfortable margin, character design sheet style";
    }
    const bits = [cmp, soft, CONSISTENCY];
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
    const ap = appearanceOf(item, (opts && opts.appearanceSeed) || 0);
    if (info.keyless) return { url: pollinationsUrl(item, variant, styleKey, stage, ap), kind: "url" };
    if (!info.key) throw new Error("还没填 API Key");
    if (!info.endpoint) throw new Error("还没填接口地址");
    const prompt = promptFor(item, styleKey || cfg.style || DEFAULT_STYLE, stage, ap);
    const size = cfg.size || DEFAULT_SIZE;
    const seed = seedOf(item.id, 0);   // 同一只精灵用固定种子 → 各形态看起来是同一个"人"在长大
    // 图生图参考：拿上一形态的图当参考，是"同一个角色"最可靠的做法（方舟 Seedream 支持 image 字段）
    const useRef = _noRef ? "" : ((opts && opts.ref) || "");
    try {
      return await callImageApi(info, prompt, size, seed, useRef);
    } catch (e) {
      const msg = (e && e.message) || "";
      // ① 尺寸被服务端拒 → 换默认档再试一次。
      //    ⚠️ 这条必须排在「参考图」判断**前面**：尺寸报错里也带 "image" 字样，
      //    否则会被当成"不支持参考图"，去掉参考图后拿同样的坏尺寸再试一遍 → 还是失败（实测踩过）
      if (isSizeErr(msg) && size !== DEFAULT_SIZE) {
        const next = Object.assign({}, cfg, { size: DEFAULT_SIZE });
        setImageCfg(next);
        const r = await callImageApi(providerInfo(next), prompt, DEFAULT_SIZE, seed, useRef);
        r.autoFixed = "尺寸已改为 " + DEFAULT_SIZE;
        return r;
      }
      // ② 参考图不被支持（部分模型/尺寸限制）→ 去掉 image 再试一次，并记住以后不再传（文本锚点仍在，不会换人）
      if (useRef && !_noRef && !isSizeErr(msg) && /image|InvalidParameter|not support|参数/i.test(msg)) {
        _noRef = true;
        return await callImageApi(info, prompt, size, seed, "");
      }
      // ③ 模型名不对（常见：把控制台显示名 Doubao-Seedream-5.0-lite 填进来了）→ 拉账号模型列表自动纠正一次
      if (!/NotFound|does not exist|not exist|InvalidEndpointOrModel/i.test(msg) || _autoFixed) throw e;
      let fixed = "";
      try {
        const ids = await listModels("image", { provider: cfg.provider, key: info.key, endpoint: info.endpoint });
        fixed = pickBestModel(info.model, ids);
      } catch (e2) { /* 拉不到就算了 */ }
      if (!fixed || normModelName(fixed) === normModelName(info.model)) throw e;
      _autoFixed = true;
      const next = Object.assign({}, cfg, { model: fixed });
      setImageCfg(next);
      const r = await callImageApi(providerInfo(next), prompt, size, seed, useRef);
      r.autoFixed = fixed;   // 交给界面提示"已自动改用 xxx"
      return r;
    }
  }
  let _noRef = false;
  function isSizeErr(msg) {
    return /size.*(not valid|invalid)|at least\s*\d+\s*pixels|尺寸/i.test(String(msg || ""));
  }
  let _autoFixed = false;
  async function callImageApi(info, prompt, size, seed, ref) {
    const payload = { model: info.model, prompt: prompt, n: 1, size: size || DEFAULT_SIZE };
    // 火山方舟（Seedream）支持 seed：固定种子能让"长大"的各形态保持同一个角色的辨识度
    if (/ark\.cn-beijing\.volces\.com/.test(info.endpoint) && seed != null) payload.seed = seed;
    // 图生图参考（保持同一个角色）；只在方舟端点加，避免其它服务商报未知字段
    if (ref && /ark\.cn-beijing\.volces\.com/.test(info.endpoint)) payload.image = ref;
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
      const user = "出场精灵：\n" + spirits.map((s) => spiritDesc(s.item, s.persona)).join("\n") + "\n请写它们今天的小剧场。";
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
        "\n主人昵称：" + (userName || "主人") + "\n请写这封短信。";
      const txt = await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 500);
      if (txt) return txt;
    } catch (e) { /* 兜底 */ }
    return localLetter(spirit, userName);
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
    return filtered.length ? filtered : ids.slice(0, 40);
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
    PROVIDERS, STYLE_PRESETS, DEFAULT_STYLE, SIZE_PRESETS, DEFAULT_SIZE, getImageCfg, setImageCfg, providerInfo,
    STAGES, stageDef, stageInfo, growthOf,
    appearanceOf, appearanceText, appearancePrompt, HAIR_STYLES, EYE_COLORS, ACCESSORIES,
    TEXT_PROVIDERS, getTextCfg, setTextCfg, textInfo, textChat, testImage, testText, listModels,
    promptFor, pollinationsUrl, generateImage, localAvatarSvg, seedOf, normModelName, pickBestModel, keyHint, isFetchFail,
    localPersona, persona, chat, letter, localChat, localLetter,
    todayKey, load, save, ensureIn,
  };
})();
