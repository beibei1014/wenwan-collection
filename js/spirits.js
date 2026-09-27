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
    if (!store[id]) store[id] = { persona: null, variant: 0, imgUrl: "", letters: [], chats: [], lastLetterDay: "" };
    return store[id];
  }

  /* ---------- 绘图通道（默认免密钥；可切国内 API） ---------- */
  const PROVIDERS = {
    pollinations: { label: "免密钥 · Pollinations", keyless: true },
    siliconflow: { label: "硅基流动 SiliconFlow", endpoint: "https://api.siliconflow.cn/v1/images/generations", model: "Kwai-Kolors/Kolors" },
    ark: { label: "火山方舟（豆包 Seedream）", endpoint: "https://ark.cn-beijing.volces.com/api/v3/images/generations", model: "doubao-seedream-3-0-t2i-250415" },
    zhipu: { label: "智谱 CogView", endpoint: "https://open.bigmodel.cn/api/paas/v4/images/generations", model: "cogview-3-flash" },
    custom: { label: "自定义（OpenAI 兼容）", endpoint: "", model: "" },
  };
  function getImageCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && o.provider) return o;
    } catch (e) { /* 忽略 */ }
    return { provider: "pollinations", key: "", model: "", endpoint: "" };
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

  /* ---------- 形象 prompt（用户要求：2D 日漫手绘 / 宝可梦那种，不要 3D） ---------- */
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
  const STYLE = "2D anime illustration, cel-shaded flat colors, clean bold outlines, hand-drawn 2D style, " +
    "original cute creature mascot in the style of a pokemon, simple solid oval eyes with one small white highlight, " +
    "tiny smile, small cute ears, full body, character fills the frame, centered composition, plain white background, " +
    "no 3D render, no realistic face, no human, no photo";
  function promptFor(item) {
    const color = COLOR_EN[item.color] || "jade green";
    const soft = SOFT_EN[item.softness || ""] || SOFT_EN[""];
    const bits = ["a cute little creature mascot whose body color is " + color, soft];
    if (item.softness === "soft") bits.push("soft chewy texture, round blob-like silhouette");
    if (item.softness === "slight") bits.push("slightly squishy but mostly smooth silhouette");
    return bits.join(", ") + ", " + STYLE;
  }
  function seedOf(id, variant) { return (hashStr(id) % 900000) + 1000 + (variant || 0) * 7919; }
  // 免密钥通道：直接把 URL 交给 <img>（浏览器自己下载，天然带缓存）；其余通道要 POST 生成
  function pollinationsUrl(item, variant) {
    return "https://image.pollinations.ai/prompt/" + encodeURIComponent(promptFor(item)) +
      "?width=512&height=512&nologo=true&seed=" + seedOf(item.id, variant);
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

  /* ---------- DeepSeek 调用（复用 app 的 key） ---------- */
  function getAiKey() { try { const k = localStorage.getItem("ww_dskey"); return k && k.trim() ? k.trim() : ""; } catch (e) { return ""; } }
  async function aiChat(messages, maxTokens) {
    const key = getAiKey();
    if (!key) throw new Error("no-key");
    const resp = await fetch(AI_BASE + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model: AI_MODEL, messages: messages, max_tokens: maxTokens || 700, stream: false,
        thinking: { type: "disabled" },   // 只要结论，不要思考过程
      }),
    });
    if (!resp.ok) {
      let m = "请求失败";
      try { const j = await resp.json(); m = (j.error && j.error.message) || m; } catch (e) { /* 忽略 */ }
      throw new Error("DeepSeek " + resp.status + "：" + m);
    }
    const data = await resp.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return "";
    return ((msg.content && msg.content.trim()) || msg.reasoning_content || "").trim();
  }
  function spiritDesc(item, persona) {
    const colorName = { white: "奶白", green: "绿", yellowbrown: "黄棕", blackgray: "黑灰", duo: "多彩", lightflower: "浅花", deepflower: "深花" }[item.color] || "素色";
    const softName = item.softness === "soft" ? "软糯" : (item.softness === "slight" ? "微糯" : "普通");
    return "【" + (persona && persona.name ? persona.name : item.name) + "】颜色：" + colorName +
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
  window.Spirits = {
    PROVIDERS, getImageCfg, setImageCfg, providerInfo,
    promptFor, pollinationsUrl, localAvatarSvg, seedOf,
    localPersona, persona, chat, letter, localChat, localLetter,
    todayKey, load, save, ensureIn,
  };
})();
