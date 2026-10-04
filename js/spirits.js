/* =========================================================
 * spirits.js — 🍡 沁灵（挂瓷开沁的手串伙伴）
 * 已挂瓷的串 "开沁"：卡通形象（AI 绘图 / 本地程序化兜底）+ 性格 + 互相聊天 + 给你送信
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
  //   ⚠️ 不要改 hashStr 本身 —— 它同时决定所有沁灵的外观/性别，
  //      改动会让已出立绘与新外观对不上。只在「小池 + 短后缀」处套 mixSeed。
  function mixSeed(h) {
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 3266489909) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function todayKey(ts) { const d = ts ? new Date(Number(ts)) : new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
  }
  /* ============================================================
   * v163：CG 像素库（IndexedDB，库 `ww_cg`）—— 像素与主 store 彻底分离
   * ------------------------------------------------------------
   * 问题（已核）：CG 是 data URI，8 张 ≈ 1.6MB。原来塞在主 store（ww_spirits）里，
   *   而 pruneForQuota 配额一超**第一个丢的就是 CG** → 玩家看到「昨天还在的 CG 今天没了」，
   *   相册格子还会倒退回未解锁 —— 防剧透机制反而变成剧透。
   * 方案：像素 → IndexedDB（库 ww_cg，key = "CG-01" …）；
   *   主 store 只留元数据 rec.cgs[id] = { at,title,caption,vol,volName,chapter,key,hasImg,thumb }
   * 🔴 铁律：「已收集」只认元数据 hasImg，**绝不**认「图现在在不在本机」。
   * 第四态 missing = 画成功过（hasImg）但像素不在本机（换设备 —— ww_spirits 同步、IndexedDB 不同步）。
   * IndexedDB 不可用时（隐身模式 / 老浏览器）退到独立 key `ww_cg_px`：
   *   它是**独立 key**，pruneForQuota 只处理 ww_spirits 的对象，够不着它。
   * ============================================================ */
  const CG_DB_NAME = "ww_cg";
  const CG_DB_STORE = "pixels";
  const CG_FALLBACK_KEY = "ww_cg_px";
  const CG_TOTAL = 8;            // 主线 CG 共 8 张（进度分母）
  const CG_THUMB_KEEP = 3;       // 主 store 里缩略图保底保留张数（配额超限时从旧到新丢）
  let _cgDbPromise = null;

  function cgIdbFactory() {
    try {
      if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB;
      if (typeof window !== "undefined" && window && window.indexedDB) return window.indexedDB;
    } catch (e) { /* 忽略 */ }
    return null;
  }
  function cgIdbOpen() {
    if (_cgDbPromise) return _cgDbPromise;
    _cgDbPromise = new Promise((resolve) => {
      let f = null;
      try { f = cgIdbFactory(); } catch (e) { f = null; }
      if (!f) return resolve(null);
      try {
        const req = f.open(CG_DB_NAME, 1);
        req.onupgradeneeded = () => {
          try { if (!req.result.objectStoreNames.contains(CG_DB_STORE)) req.result.createObjectStore(CG_DB_STORE); }
          catch (e) { /* 忽略 */ }
        };
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return _cgDbPromise;
  }
  function cgIdbGet(id) {
    return cgIdbOpen().then((db) => new Promise((resolve) => {
      if (!db) return resolve(null);
      try {
        const rq = db.transaction(CG_DB_STORE, "readonly").objectStore(CG_DB_STORE).get(String(id));
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
  }
  function cgIdbPut(id, val) {
    return cgIdbOpen().then((db) => new Promise((resolve) => {
      if (!db) return resolve(false);
      try {
        const tx = db.transaction(CG_DB_STORE, "readwrite");
        tx.objectStore(CG_DB_STORE).put(val, String(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) { resolve(false); }
    }));
  }
  function cgIdbDel(id) {
    return cgIdbOpen().then((db) => new Promise((resolve) => {
      if (!db) return resolve(false);
      try {
        const tx = db.transaction(CG_DB_STORE, "readwrite");
        tx.objectStore(CG_DB_STORE).delete(String(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    }));
  }
  function cgIdbKeys() {
    return cgIdbOpen().then((db) => new Promise((resolve) => {
      if (!db) return resolve([]);
      try {
        const rq = db.transaction(CG_DB_STORE, "readonly").objectStore(CG_DB_STORE).getAllKeys();
        rq.onsuccess = () => resolve((rq.result || []).map(String));
        rq.onerror = () => resolve([]);
      } catch (e) { resolve([]); }
    }));
  }
  // ---- 退路：独立 localStorage key ----
  function cgFallbackAll() {
    try { const raw = localStorage.getItem(CG_FALLBACK_KEY); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === "object" ? o : {}; }
    catch (e) { return {}; }
  }
  function cgFallbackSave(o) { try { localStorage.setItem(CG_FALLBACK_KEY, JSON.stringify(o)); } catch (e) { /* 忽略 */ } }

  /* ---------- 像素读写（对外唯一入口） ---------- */
  // pixels = { full:"data:...", thumb:"data:..." }；返回 true = 至少写进了 full
  // ⚠️ ownerId = 串 id：多主串各自「第 N 章-A 变体」的 CG id 完全相同，必须按 owner 隔离，
  //    否则主串 A 的图会把主串 B 的同名 CG 像素覆盖掉（K4 P0）。
  //    key = ownerId + "|" + id；元数据 cgs[id].ownerId 同源，cgSlotOf 取像素时复用。
  function cgPutPixels(ownerId, id, pixels) {
    const key = String(ownerId) + "|" + String(id);
    const val = { full: String((pixels && pixels.full) || ""), thumb: String((pixels && pixels.thumb) || ""), at: Date.now(), ownerId: String(ownerId) };
    return cgIdbPut(key, val).then((idbOK) => {
      if (idbOK) {                                   // IDB 成功 → 清掉退路里的旧副本，避免两份
        const f = cgFallbackAll();
        if (f[key]) { delete f[key]; cgFallbackSave(f); }
        return !!val.full;
      }
      const f = cgFallbackAll(); f[key] = val; cgFallbackSave(f);
      return !!val.full;
    });
  }
  function cgGetPixels(ownerId, id) {
    const key = String(ownerId) + "|" + String(id);
    return cgIdbGet(key).then((v) => {
      if (v && (v.full || v.thumb)) return v;
      const f = cgFallbackAll();
      return f[key] || null;
    });
  }
  function cgDelPixels(ownerId, id) {
    const key = String(ownerId) + "|" + String(id);
    return cgIdbDel(key).then(() => {
      const f = cgFallbackAll();
      if (f[key]) { delete f[key]; cgFallbackSave(f); }
      return true;
    });
  }
  function cgHasPixels(ownerId, id) {
    return cgGetPixels(ownerId, id).then((v) => !!(v && (v.full || v.thumb)));
  }

  /* ---------- CG 元数据（只住主 store；🔴「已收集」以它为准） ---------- */
  function cgsOf(rec) {                     // 仅写入路径调用（会按需创建）
    if (!rec || typeof rec !== "object") return {};
    if (!rec.cgs || typeof rec.cgs !== "object" || Array.isArray(rec.cgs)) rec.cgs = {};
    return rec.cgs;
  }
  // 只读访问：**不创建** rec.cgs（避免给每只没 CG 的沁灵都塞一个空对象，100 只白涨体积）
  function cgsRO(rec) {
    if (!rec || typeof rec !== "object") return null;
    const c = rec.cgs;
    return (c && typeof c === "object" && !Array.isArray(c)) ? c : null;
  }
  function cgMetaOf(rec, id) { const c = cgsRO(rec); return (c && c[String(id)]) || null; }
  // 已收集的 id 列表（按收集时间升序）—— 判定只看 hasImg，不看像素在不在本机
  //   v166：⛔ 只数**主线章节** CG（id 为 0..CHAPTERS.length-1 的数字），进阶专属 CG（id 形如 "adv#3"）不算进度，
  //        否则会把它算进 CG_TOTAL 分母、把进度条撑爆；但相册展示层仍会把进阶 CG 列出来（见 app.js renderAlbumPage）。
  function cgCollectedIds(rec) {
    const c = cgsRO(rec);
    if (!c) return [];
    return Object.keys(c).filter((k) => c[k] && c[k].hasImg && !String(k).startsWith("adv#"))
      .sort((a, b) => (Number(c[a].at) || 0) - (Number(c[b].at) || 0));
  }
  function cgCollectedCount(rec) { return cgCollectedIds(rec).length; }
  // v166：进阶专属 CG（id 形如 "adv#3"）的 id 列表 —— 只用于相册「进阶 CG」分区展示，不计入主线进度
  function cgAdvIds(rec) {
    const c = cgsRO(rec);
    if (!c) return [];
    return Object.keys(c).filter((k) => c[k] && c[k].hasImg && String(k).startsWith("adv#"))
      .sort((a, b) => (Number(c[a].at) || 0) - (Number(c[b].at) || 0));
  }
  // v166：老档回填 —— V166 之前生成的进阶 CG 只存了 rec.cgUrl，没归档进 rec.cgs，相册（全局画廊）聚不到。
  //   这里把它补写成 adv#<阶> 一条；⛔ 只在 rec.cgUrl 有值、且 rec.cgs 里还没有同图条目时才写。
  //   返回 true = 本次有改动（调用方据此决定是否 save）。
  function backfillAdvCg(rec) {
    if (!rec || typeof rec !== "object" || !rec.cgUrl) return false;
    const c = cgsRO(rec);
    if (c) {
      const hit = Object.keys(c).some((k) => String(k).startsWith("adv#") && c[k] && (c[k].thumb === rec.cgUrl || c[k].imgUrl === rec.cgUrl));
      if (hit) return false;                       // 已归档过，不重复回填
    }
    const stg = Number(rec.cgStage) || Number(rec.stage) || 1;
    const sd = (typeof stageDef === "function" ? stageDef(stg) : null) || {};
    cgMarkCollected(rec, "adv#" + stg, {
      title: "进阶专属 CG · " + (sd.name || stg),
      caption: String(rec.cgBrief || "").slice(0, 50),
      key: rec.cgKey || "",
    }, rec.cgUrl);
    return true;
  }
  /* ---------- v172-E：进阶专属 CG 允许多张（不覆盖旧图） ----------
     rec.cgList = 历史进阶 CG 的 url 列表（按生成先后，末尾最新）。
       · 与 rec.cgs 的区别：cgs 是「相册元数据」，其缩略图会随配额瘦身被丢空；
         cgList 只存 url 引用，缩略图被丢后仍能找回这张图，也用于「管理 CG」逐个列出。
       · ⛔ 只存引用，**绝不动云端 Storage 文件**（删列表项 ≠ 删文件，那是用户花钱出的图）。
     出图回调在覆盖 rec.cgUrl 前先把旧值推进 cgList（见 app.js drawCgFromBrief 回调），
     故同阶重画不会覆盖/丢失旧图；相册归档 key 也已唯一化（见 cgAdvKey）。 */
  const CG_LIST_MAX = 30;                                   // 上限，防无界增长（超出丢最旧）
  function cgListRO(rec) { const l = rec && rec.cgList; return Array.isArray(l) ? l : null; }
  // 懒迁移：老档只有 rec.cgUrl（无 cgList）→ 从 rec.cgs 的 adv# 条目按收集时间重建历史列表。
  //   ⛔ 不把当前 cgUrl 计入（它是「现在这张」）；返回 true = 本次补了字段（调用方据需 save）。
  function ensureCgList(rec) {
    if (!rec || typeof rec !== "object") return false;
    if (Array.isArray(rec.cgList)) return false;
    const out = [];
    const c = cgsRO(rec);
    if (c) {
      Object.keys(c).filter((k) => String(k).startsWith("adv#") && c[k] && c[k].hasImg)
        .sort((a, b) => (Number(c[a].at) || 0) - (Number(c[b].at) || 0))
        .forEach((k) => {
          const u = String(c[k].thumb || c[k].imgUrl || "");
          if (u && u !== rec.cgUrl && out.indexOf(u) < 0) out.push(u);
        });
    }
    rec.cgList = out;
    return true;
  }
  // 把一张进阶 CG 归档进历史（幂等；超出上限丢最旧）。返回 true = 有改动。
  function cgListPush(rec, url) {
    if (!rec || typeof rec !== "object") return false;
    const u = String(url || "");
    if (!u) return false;
    if (!Array.isArray(rec.cgList)) rec.cgList = [];
    if (rec.cgList.indexOf(u) >= 0) return false;
    rec.cgList.push(u);
    while (rec.cgList.length > CG_LIST_MAX) rec.cgList.shift();
    return true;
  }
  function cgListRemove(rec, url) {
    const l = cgListRO(rec);
    if (!l) return false;
    const i = l.indexOf(String(url || ""));
    if (i < 0) return false;
    l.splice(i, 1);
    return true;
  }
  function cgListCount(rec) { const l = cgListRO(rec); return l ? l.length : 0; }
  // 归档 key 唯一化：同阶多次生成各成一条相册条目（⛔ 不覆盖旧的）
  function cgAdvKey(stage, at) { return "adv#" + (Number(stage) || 1) + "#" + (Number(at) || Date.now()); }
  // 落一张「画成功了」的 CG：元数据进主 store，像素另存 IDB。返回 true = 首次收集
  function cgMarkCollected(rec, id, meta, thumb) {
    const c = cgsOf(rec), key = String(id), old = c[key] || {};
    const fresh = !old.hasImg;
    c[key] = Object.assign({}, old, meta || {}, {
      hasImg: true,
      at: Number(old.at) || Date.now(),              // 🔴 首次收集时间不可被覆盖（换设备重画也保留）
      key: (meta && meta.key) || old.key || "",
      thumb: (thumb != null) ? String(thumb) : String(old.thumb || ""),
      err: "",
    });
    return fresh;
  }
  // 出图失败：只写 err。🔴 已收集过的**绝不**降级成失败（否则格子倒退回剧透态）
  function cgMarkFailed(rec, id, meta, err) {
    const c = cgsOf(rec), key = String(id), old = c[key] || {};
    if (old.hasImg) { c[key] = Object.assign({}, old, { err: String(err || "画失败") }); return false; }
    c[key] = Object.assign({}, old, meta || {}, { hasImg: false, err: String(err || "画失败"), at: Number(old.at) || Date.now() });
    return true;
  }
  // 格子状态机：locked / failed / ready / missing（pending 是 UI 的临时态，不落盘）
  //   pixelPresent: true=本机有像素 / false=本机没有 / undefined=还不知道（只给元数据态 "collected"）
  function cgStateOf(rec, id, pixelPresent) {
    const m = cgMetaOf(rec, id);
    if (!m) return "locked";
    if (!m.hasImg) return m.err ? "failed" : "locked";
    if (pixelPresent === true) return "ready";
    if (pixelPresent === false) return "missing";     // 画成功过，但像素不在本机（换设备）
    return "collected";
  }
  // 一步到位：给 UI 用。返回 { id, state, meta, pixels }
  function cgSlotOf(rec, id) {
    const m = cgMetaOf(rec, id);
    if (!m || !m.hasImg) return Promise.resolve({ id: String(id), state: cgStateOf(rec, id), meta: m, pixels: null });
    // 按元数据里的 ownerId 定位像素（与 cgPutPixels 的 key 同源）；无 ownerId（极旧数据）按空串兜底
    return cgGetPixels(m && m.ownerId != null ? m.ownerId : "", id).then((px) => ({
      id: String(id), state: cgStateOf(rec, id, !!(px && (px.full || px.thumb))), meta: m, pixels: px || null,
    }));
  }
  /* ---------- 状态 → 格子 class / 门槛文案（单一来源，UI 不许自己硬编码字符串） ----------
     🔴 第四态 missing 必须与 locked / 已解锁都能一眼分开：
        locked  = 灰虚线 + 🔒 + 「还没到时候」（点了只抖一下）
        missing = **实线** + ☁ + 「这张在原来那台设备上」（点开走「重新生成」确认，钱是用户的）
     两条纪律：① missing 的 class 与 locked 不同；② missing 的文案与 locked 不同。 */
  const CG_STATE_CLASS = {
    ready: "album-cell", locked: "album-cell locked", pending: "album-cell pending",
    failed: "album-cell failed", missing: "album-cell missing", placeholder: "album-cell placeholder",
  };
  const CG_STATE_HINT = {
    ready: "", locked: "还没到时候", pending: "正在画…",
    failed: "画失败了 · 点一下重画", missing: "这张在原来那台设备上", placeholder: "待画",
  };
  function cgCellClass(state) { return CG_STATE_CLASS[String(state)] || CG_STATE_CLASS.locked; }
  function cgCellHint(state) { const s = String(state); return CG_STATE_HINT.hasOwnProperty(s) ? CG_STATE_HINT[s] : ""; }

  // 配额超限时：保底留最新 CG_THUMB_KEEP 张的缩略图，其余从旧到新丢 thumb
  // ⚠️ 只丢 thumb（可再生），**元数据（含 hasImg）永不丢**
  function dropOldCgThumbs(rec, keep) {
    const k = keep || CG_THUMB_KEEP;
    const c = cgsRO(rec);                       // 只读：没有 cgs 就什么都不用丢
    if (c) {
      const ids = Object.keys(c).filter((kk) => c[kk] && c[kk].hasImg);
      if (ids.length > k) {
        ids.sort((a, b) => (Number(c[a].at) || 0) - (Number(c[b].at) || 0));   // 旧 → 新
        ids.slice(0, ids.length - k).forEach((kk) => { c[kk].thumb = ""; });
      }
    }
    // v172-E：cgList 也只留最新 k 条（丢的是本地 url 引用；⛔ 云端 Storage 文件不动，可再取回）
    const l = cgListRO(rec);
    if (l && l.length > k) l.splice(0, l.length - k);
  }

  /* ---------- 配额瘦身（v163 重排顺序：CG 最后才丢） ----------
     旧行为：第一个动作就是 `if (r.cgUrl) r.cgUrl = "";` —— 在 CG 只是"随手重画的插画"时成立，
     但主线 CG 是**收集品**，丢一张 = 玩家白花钱 + 相册倒退回未解锁（= 剧透）。
     新顺序：① 先裁可再生 / 非收集类数据（历史图片、日记、来信、回响、节令、聊天记录）
             ② 再裁 CG 缩略图（从旧到新，保底留最新 CG_THUMB_KEEP 张；像素在 IndexedDB，取回不难）
             ③ **最后才**丢 rec.cgUrl（v125 那张单张突破 CG，本来就能重画）
     ⚠️ rec.cgs 的元数据（含 hasImg）永不丢 —— 丢了等于把已解锁的 CG 打回 locked。 */
  function pruneForQuota(o) {
    try {
      Object.keys(o).forEach((k) => {
        const r = o[k];
        if (!r || typeof r !== "object") return;
        /* ① 可再生 / 非收集类数据 */
        if (Array.isArray(r.imgHistory)) r.imgHistory = r.imgHistory.slice(-1);
        if (Array.isArray(r.diary)) r.diary = r.diary.slice(-8);
        if (Array.isArray(r.letters)) r.letters = r.letters.slice(-5);
        if (Array.isArray(r.echoes)) r.echoes = r.echoes.slice(-5);
        if (r.replies && typeof r.replies === "object") {
          const ks = Object.keys(r.replies).sort();
          while (ks.length > 10) delete r.replies[ks.shift()];
        }
        if (r.fests && typeof r.fests === "object") {
          const ks = Object.keys(r.fests).sort();
          while (ks.length > 8) delete r.fests[ks.shift()];
        }
        if (r.night && Array.isArray(r.night.log)) r.night.log = r.night.log.slice(-150);
        if (r.threads && typeof r.threads === "object") {
          Object.keys(r.threads).forEach((tid) => {
            const th2 = r.threads[tid];
            if (!th2 || typeof th2 !== "object") return;
            if (th2.runs && typeof th2.runs === "object") {
              Object.keys(th2.runs).forEach((eid) => {
                const rn = th2.runs[eid];
                if (rn && Array.isArray(rn.log)) rn.log = rn.log.slice(-150);
              });
            }
          });
        }
        // v163 新增字段也要能瘦身（跨手机同步走整库一行 JSON，新字段不瘦身会撑爆同步）
        if (r.marks && typeof r.marks === "object") {                 // 记痕：只留章序最早的 5 条
          const ks = Object.keys(r.marks).sort((a, b) => String(a).localeCompare(String(b)));
          while (ks.length > 5) delete r.marks[ks.pop()];
        }
        if (r.lingxiTalk && typeof r.lingxiTalk === "object") {       // 新主线对话槽（对齐 rec.talk）
          if (Array.isArray(r.lingxiTalk.log)) r.lingxiTalk.log = r.lingxiTalk.log.slice(-40);
          if (Array.isArray(r.lingxiTalk.msgs)) r.lingxiTalk.msgs = r.lingxiTalk.msgs.slice(-40);
        }
        /* ② CG 缩略图：从旧到新丢，保底留最新 3 张（元数据永不丢） */
        dropOldCgThumbs(r, CG_THUMB_KEEP);
        /* ③ 最后才丢 v125 单张 CG */
        if (r.cgUrl) r.cgUrl = "";
      });
    } catch (e) { /* 忽略 */ }
    return o;
  }
  function save(o) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(o));
      // 通知同步层：本地沁灵数据变了，稍后推到云端（跨手机同步用）
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
  function ensureIn(store, id, item) {     // v165：item 可选，仅用于 normRecV165 补 imgStage
    if (!store[id]) {
      // 新生：性别**优先读设计规定值**(item.gender)；没规定才留空，等 born() 掷一次（男:女 3:1）。
      //   ⛔ 粉黛熊=boy 这类规定性别，新生那一刻就锁死，绝不交给随机（born 见 rec.gender 已是 boy/girl 就不会再掷）。
      const g0 = (item && (item.gender === "boy" || item.gender === "girl")) ? item.gender : "";
      store[id] = { persona: null, variant: 0, imgUrl: "", letters: [], chats: [], lastLetterDay: "", stage: 1, imgHistory: [], gender: g0, bornAt: 0, spirit: true, flags: { stance: "UNSET", bondLv: null, scattered: false } };
      normRecV165(store[id], item);
      return store[id];
    }
    const rec = store[id];
    if (rec.stage == null) rec.stage = 1;              // 老数据兼容：默认凝形
    if (!Array.isArray(rec.imgHistory)) rec.imgHistory = [];
    if (!rec.exprs || typeof rec.exprs !== "object") rec.exprs = {};
    // v166：把现有 base 立绘归并进 exprs.base（老档零成本迁移；表情切换条 base 永远有图）
    if (rec.imgUrl && !rec.exprs.base) rec.exprs.base = { url: rec.imgUrl, face: rec.face || null, at: rec.imgAt || 0, frozen: !!rec.imgFrozen, stage: rec.imgStage || rec.stage || 1 };
    // v166：设计规定的性别（item.gender 写死 boy/girl）永远优先 —— 粉黛熊=男等，
    //   不能因为 born() 随机掷过就变成女。⛔ 只在 item 明确规定了性别时才强制覆盖。
    if (item && (item.gender === "boy" || item.gender === "girl")) rec.gender = item.gender;
    // 老记录（v110 之前开沁的）没有 gender：按**旧规则**（hash(串id+外观种子)）定下来，
    // 这样它已经画好的立绘和界面显示的人设不会打架；新沁灵一律走 born() 的 3:1 随机
    else if (rec.gender !== "boy" && rec.gender !== "girl") rec.gender = legacyGender(id, rec.appearanceSeed || 0);
    if (!rec.flags || typeof rec.flags !== "object") rec.flags = { stance: "UNSET", bondLv: null, scattered: false };
    if (rec.spirit == null) rec.spirit = true;   // v166：默认开沁（除非用户主动设「只当手串」）
    normRecV165(rec, item);
    return rec;
  }
  // 性别：出生时掷一次，比例 男:女 = 3:1（用户要求）
  function rollGender(seedStr) { return (hashStr(String(seedStr || "")) % 4 !== 0) ? "boy" : "girl"; }
  // v107~v109 的旧规则（2/3 男孩），只用于给老记录"定档"
  function legacyGender(id, seedN) { return (hashStr(String(id || "") + "#" + (seedN || 0)) % 3) !== 0 ? "boy" : "girl"; }
  // 挂瓷开沁：给这只沁灵"定性别"，之后不可更改（重复调用不会改性别）
  function born(item) {
    const store = load();
    const rec = ensureIn(store, item.id, item);
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
    }
    // v165-M：⛔ 删掉这里的自动派生 —— rec.stage 现在是「已确认阶」，只由用户点按钮抬。
    //   （旧逻辑每次 load 都把它拉回可达阶 ⇒ 用户的手动确认会被静默覆盖。）
    //   可达阶请用 stageOf(item, rec) 现算；⛔ 老存档的 rec.stage 不清除、不强行对齐（以用户点过为准）。
    // v163b：开沁里程碑事件（瞬时卡 + 回顾）
    recordEvent(rec, { type: "milestone", title: "挂瓷开沁", summary: "它第一次睁开眼，认得你了", linked: [item.id], at: Date.now(), icon: "✨" });
    save(store);
    gender = rec.gender;
    return { isNew: isNew, gender: gender, bornAt: rec.bornAt };
  }

  /* ---------- 外观锚点（v104）：每只沁灵有固定人设，所有形态共享，深沁不会变性/变色 ---------- */
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
    { en: "a cross-collar Chinese hanfu robe with the right lapel over the left and wide sleeves", zh: "交领右衽宽袖长袍" },
    { en: "an embroidered Chinese cross-collar robe with cloud-patterned trim", zh: "绣花交领长袍 + 云纹滚边" },
    { en: "a wide-sleeved Chinese Taoist robe with hanging ties", zh: "大袖道袍 + 系带" },
    { en: "a plain wrap-front Chinese top with a cloth waist wrap", zh: "素色裹襟上衣 + 布腰封" },
    { en: "a short-sleeve Chinese beizi vest layered over a long robe", zh: "半臂褙子 + 长衫内搭" },
    { en: "a martial-arts style short Chinese tunic with a waist sash", zh: "短打劲装 + 束腰" },
    { en: "a brocade-trimmed Chinese robe with a jade toggle", zh: "织锦长袍 + 玉扣" },
  ];
  /* ---------- v165：意象服饰词表（用户实测「叫莫高窟那只，服装还是汉服」） ----------
     根因：OUTFITS 是**一池通用中式古装**，按 hashStr 随机抽 ⇒ 服装与这只沁灵的名字毫无关系。
     本表让服装**按意象走**：命中 **item.name** 的关键词即改写服饰。

     ⚠️ v165 修正（主理人实测发现）：原先把 item.species / item.category 也送进匹配，
       而木组关键词含「根 / 菩提」⇒ species="菩提根" 会**抢先命中**木组，导致主角团那批
       菩提根串被统一压成同一种木色 —— 等于换个方式又锁死了一次。
       ⇒ **意象只认名称，⛔ 品类/材质大类不参与图像侧意象匹配**；
         item.species 仍然照旧喂给文本模型写人设（那条线一行未动）。
     ⛔ 只做「覆盖」，⛔ 不动 hashStr 本体 —— 未命中时结果与改前**逐字一致**（分布不变）。

     词表顺序 = **语义优先级**（数组下标小 = 优先级高）：
       1 敦煌飞天 → 2 冰雪 → 3 玉 → 4 金属 → 5 木（泛组，垫底）
     「雪月」必须落冰雪（不能被泛组抢走），同理其它具体意象一律优先于木。 */
  const IMAGERY_OUTFITS = [
    { zh: "敦煌飞天", keys: ["莫高窟", "敦煌", "石窟", "飞天", "壁画", "藻井", "彩塑"],
      en: "Dunhuang mural style costume with flowing feitian silk ribbons, beaded necklaces and lotus motifs",
      zhOutfit: "敦煌壁画飞天披帛 + 璎珞 + 莲瓣纹" },
    { zh: "冰雪", keys: ["雪", "冰", "霜", "寒"],
      en: "frost-white layered silk with pale crystal beadwork",
      zhOutfit: "霜白叠纱 + 冰晶珠饰" },
    { zh: "玉", keys: ["玉", "和田", "脂玉", "翠", "琉璃", "宝"],
      en: "jade-toned silk robes with carved jade ornaments",
      zhOutfit: "玉色丝袍 + 玉雕饰件" },
    { zh: "金属", keys: ["银", "金属", "铁", "钢", "锡", "铜", "钛"],
      en: "silver filigree vest over silk with metal-disc ornaments",
      zhOutfit: "錾花银披肩 + 金属环扣饰件" },
    // ⛔ 泛组垫底：只在名称**真的**提到木/菩提/根时才生效（品类不算）
    { zh: "木", keys: ["檀", "木", "菩提", "核", "根", "椰", "橄榄"],
      en: "wood-toned rustic silk and plain woven cloth",
      zhOutfit: "木色粗织布衣 + 素丝" },
  ];
  // 在 OUTFITS 随机结果**之上**按意象覆盖；未命中返回 null（调用方保持原逻辑，分布不变）
  // ⚠️ v165 修正：⛔ 只扫 item.name —— ⛔ 不再把 species / category 送进来（见上）
  function imageryOutfitOf(item) {
    if (!item) return null;
    const nm = String(item.name || "");
    if (!nm.trim()) return null;
    for (let i = 0; i < IMAGERY_OUTFITS.length; i++) {
      const row = IMAGERY_OUTFITS[i];
      for (let k = 0; k < row.keys.length; k++) {
        if (nm.indexOf(row.keys[k]) >= 0) return row;
      }
    }
    return null;
  }
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
    // v165：⛔ 原 "ancient Chinese hanfu-inspired costume" 已泛化 —— 用户实测「叫莫高窟那只服装还是汉服」，
    //   服装应按这只沁灵自己的意象定，不能全局锁死汉服。禁现代/西式/日式/解剖错误各段一字未动。
    "use gentle neutral expressions and classical Chinese-inspired costume";
  // v152 全局解剖安全约束：出图模型常把手指/手臂画错（三只手、六指），每次出图都带上
  const ANATOMY = "strictly correct human anatomy, exactly two arms and two hands, five fingers per hand, " +
    "simple clear hand shapes, both hands resting naturally and unobstructed, " +
    "no extra limbs, no extra hands, no extra fingers, no hidden overlapping arms, no detached floating hand, " +
    // v165-Q：道具-手绑定 —— 用户实测「三只手」：角色持伞/持物 + 广袖时模型自造第三条手臂。
    //   语义必须是「器物由且仅由一只手握持、另一只手清晰可见」，只给正向约束不够，还要点名"袖子里伸出的手"。
    "if the character holds any prop (umbrella, fan, cup, bag), that prop is held in exactly one hand, " +
    "the other hand is empty, relaxed, unobstructed and fully visible, " +
    "exactly two forearms in total, no third arm, no extra arm, no floating limb, " +
    "no hand emerging from a sleeve that is not attached to a shoulder";
  // v150 全局正面风格约束：所有沁灵统一「中国古风」（用户要求：整个 App 是中国传统文玩调性）
  // v165：hanfu-inspired classical costume -> classical Chinese-inspired costume；
  //   并显式写入「服装跟随本角色自己的意象」—— 这是「莫高窟穿汉服」的根因之一。
  const GUOFENG = "traditional Chinese gufeng (ancient Chinese dynasty) aesthetic, classical Chinese-inspired costume and hairstyle, " +
    "the costume follows this character's own imagery, era and material, " +
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
  // 性别**不参与**随机：它由「挂瓷开沁」那一刻的 born() 定下来（男女 3:1），之后换外观/深沁都不会变
  function appearanceOf(item, seedN, gender, lkHint) {
    const h = hashStr(String((item && item.id) || "") + "#" + (seedN || 0));
    const g = (gender === "boy" || gender === "girl") ? gender
      : (item && item.gender === "boy" || item && item.gender === "girl") ? item.gender
      : rollGender((item && item.id) || "");        // 兜底：老记录/未开沁时按 id 稳定掷一次
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
    // v165：意象服饰「同款覆盖」—— 仿 userPattern 的机制，在 hashStr 抽取**之上**生效。
    //   ⛔ 未命中意象词时这段完全不改动 out，分布与改前逐字一致。
    const im = imageryOutfitOf(item);
    if (im) { out.outfit = im.en; out.outfitZh = im.zhOutfit; out.outfitSrc = "imagery"; }
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
  // 一致性硬约束：每次出图都带上，防止深沁后"换人"
  // ⚠️ 这里曾经写过 "character evolution sheet"（进化图鉴）→ 模型真的画成了**多格图鉴**：
  //    一张图里两只角色、还自己写上 NEWBORN / YOUNG BOY 标题字（用户实测截图）。所以现在反过来：
  //    明确"只画一个人、不许画分格、不许写字"，见 SINGLE。
  const CONSISTENCY = "same character across all ages, keep exactly the same gender, same hair style and hair color, " +
    "same eye color, same accessory and same overall design, only grow older, " +
    // v165-Q：服饰一致性 —— 进阶「服饰更精细更华丽」但**基色与纹样母题不变**（用户要求的一致性口径）。
    "same outfit base colour and the same pattern motif across all stages, " +
    "only the cut, layering and ornamentation become richer with age, " +
    "do not change the outfit's colour family or its pattern motif, " +
    "consistent character design, do not change gender, do not change identity";
  // 只画一个人 + 不许有文字
  // ⚠️ 连 "character sheet" / "turnaround" 这种词都别出现（哪怕写成 "no character sheet"）——
  //    实测这两个词一出现，模型就容易画成多格图鉴，所以整句里干脆不出现它们。
  const SINGLE = "solo, single character only, exactly one figure in the whole image, one person, plain simple background, " +
    "no other characters, no clones, no panels, no collage, no multiple views, no background characters, " +
    "no text, no letters, no words, no numbers, no title, no labels, no captions, no watermark, no signature, no logo";

  /* ---------- 进阶系统：四形态、三次深沁（v103；v120 起"身形比例真的会长大"） ----------
     凝形 → 开窍 → 蜕形 → 化形；成长值 = 盘玩次数×3 + 陪伴天数×1
     ⚠️ 用户反馈「深沁过后不会一直都是那个 Q 版吧？」—— 查出来根因是**风格预设里写死了
        `cute chibi character / chibi proportion with slightly big head`，它对四个阶段都生效**，
        所以模型每次都画回 Q 版大头。现在把"肤色/线稿/上色"这类**画风**留在风格预设里，
        把"身高与头身比"全部挪到阶段描述里，并且明确写「比上一形态更高」→ 深沁会真的长大。 */
  const STAGES = [
    {
      n: 1, name: "凝形", icon: "🥚", need: 0, sizeZh: "约 4 头身（初生小宝宝）",
      // v164c：比例**只由阶段描述负责**（风格预设里绝不能写 chibi，见上面的注释）。
      //   旧版这里只有 "about 4 heads tall, round baby face"——"数字头身比"对扩散模型是极弱约束
      //   （模型并不会真的去数头），缺的是可执行的比例词：大头 / 短身 / 短腿 / 幼儿脸。
      look: "a tiny newborn chibi version of the character, about 4 heads tall, " +
        "oversized round head, soft chubby baby cheeks, a small childlike face with a short chin and tiny nose, " +
        "tiny short body with short stubby arms and legs, small feet, " +
        "very simple plain single-layer clothing, no ornaments, " +
        "soft innocent round eyes, just awakened, extremely cute",
      // 🔴 比例锁定块：**压在 prompt 最末尾**（模型对末尾最敏感）。必须同时给"该是什么"和"不许是什么"。
      //   旧版的致命问题是完全没有反向约束 → 模型回落到"美型全身立绘"默认先验 ≈ 6 头身。
      prop: "PROPORTION LOCK: a 4-heads-tall chibi newborn, the head is very large relative to the body, " +
        "the body and legs are short and small so the figure looks like a chubby toddler, childlike baby face; " +
        "no adult proportions, no teenage body, no tall slender figure, no long legs, " +
        "no mature face, no mature jawline, not a grown-up",
    },
    {
      n: 2, name: "开窍", icon: "🌱", need: 30, sizeZh: "约 6 头身（小孩子）",
      look: "a small child version of the character, about 6 heads tall, " +
        "clearly taller than the newborn form but still a young child, " +
        "rounded childlike face with soft cheeks, slim but short-limbed child body, " +
        "neat tidy outfit, one small accessory, slightly finer than the newborn form, " +
        "lively bright eyes, energetic pose, still cute",
      // v165-R1：开窍（6 头身）同样被宽袍坑 —— 袍子一盖，6 头身看起来就像 4 头身。
      //   补同样的**轮廓保护句 + 头发体积句 + 强负向**（⛔ 仍是阶段内，不进全局 NEG_STYLE）。
      prop: "PROPORTION LOCK: a 6-heads-tall young child (the head's height is about one sixth of the total figure height), " +
        "rounded childlike face, small torso and short legs, clearly taller and slimmer than the newborn form; " +
        "SILHOUETTE RULE: the robe must not hide the body silhouette; " +
        "the legs' length stays visually readable; the figure stands at full height, head to feet; " +
        "HAIR VOLUME: long hair is fine, but the hair must not visually enlarge the head or shorten the body; " +
        "no chibi, no big head, no oversized head, no small body, no stubby limbs, no toddler body, " +
        "no adult proportions, no mature body, no tall slender figure, no long legs, no mature jawline",
    },
    {
      n: 3, name: "蜕形", icon: "⚡", need: 90, sizeZh: "约 8 头身（少年，变高变帅）",
      // v165-Q：⛔ 删掉 "environment behind" —— 它与风格预设 anime 的 "plain solid soft background" 打架，
      //   模型在"场景图"与"素底立绘"之间摇摆，比例随之失控。华丽感改用**服饰**表达，不用场景表达。
      look: "a teenage version of the character, about 8 heads tall, " +
        "slim teenage proportions, longer limbs than the child form, a more defined jawline, " +
        "confident pose, " +
        "well-tailored outfit with a clear fabric pattern and one proper ornament (a sash or a hairpin), " +
        "noticeably more elaborate than the child form",
      // v165-R1：数字回到 8 头身（用户裁定：7 不好看，8/9 才帅气）。
      //   上一版（v165-Q）把数字降到 7 的初衷是"8/9 超模"，但实测蜕形只画出 5–5.5 头身 ——
      //   **卡点不是数字高低，是执行手段**：① 宽大黄袍把腰腿全遮死，轮廓不可读，比例无从谈起；
      //   ② 及地长发+发髻让头区体积占画面近 1/3；③ 可爱系先验没压住。所以本版数字回到 8，
      //   同时补四件套：正向数字锚 + 时装画锚词 / 强负向 / 轮廓保护句 / 头发体积句。
      //   ⛔ 强负向只写在 prop（阶段内），⛔ 绝不写进全局 NEG_STYLE —— 凝形靠大头吃饭，全局禁 chibi 会毁掉 Q 版。
      prop: "PROPORTION LOCK: an 8-heads-tall figure (the head's height is about one eighth of the total figure height), " +
        "fashion-illustration proportions, tall runway-model silhouette, elongated elegant figure, " +
        "tall slender figure, long legs, narrow shoulders, adult body silhouette, mature elegant standing pose, " +
        // v165-F：数值化身体分区（比"8 头身"这种抽象词可执行 —— 模型会拿去对照画）
        "the legs alone take up about half of the total height, the shoulder width is about one and a half head-widths; " +
        "SILHOUETTE RULE: the long robe must not hide the body silhouette; " +
        "the legs' length stays visually readable; the figure stands at full height, head to feet; " +
        "HAIR VOLUME: long hair is fine, but the hair must not visually enlarge the head or shorten the body; " +
        "the face may be mature and beautiful, but the head is small in proportion to the body " +
        "(realistic adult head-to-body ratio), NOT a large head on a small body; " +
        "no chibi, no big head, no oversized head, no short legs, no small body, no stubby limbs, no toddler body, " +
        "no baby proportions, not a small child",
    },
    {
      n: 4, name: "化形", icon: "👑", need: 180, sizeZh: "约 9 头身（化形 · 华丽服饰）",
      // v165-Q：⛔ 同上，删掉 "rich cinematic scene behind"（场景感只属于 CG 线，立绘一律素底）。
      look: "a fully grown adult version of the same character, about 9 heads tall, " +
        "elegantly tall adult proportions, " +
        "magnificent ceremonial outfit with layered silk, embroidery and jade ornaments, " +
        "the most elaborate of all four forms, elegant and beautiful, masterpiece quality",
      // v165-R1：数字回到 9 头身（同蜕形，用户裁定）。华丽服饰最容易把轮廓糊掉，
      //   所以化形这阶的**轮廓保护句与头发体积句必须比蜕形更硬**（层叠丝绸/刺绣/玉饰 = 典型遮形元素）。
      prop: "PROPORTION LOCK: a fully grown tall adult, a 9-heads-tall figure " +
        "(the head's height is about one ninth of the total figure height), " +
        "fashion-illustration proportions, tall runway-model silhouette, elongated elegant figure, " +
        "very tall slender figure, long legs, elegant adult body silhouette, mature majestic standing pose, " +
        // v165-F：数值化身体分区（同蜕形）
        "the legs alone take up about half of the total height, the shoulder width is about one and a half head-widths; " +
        "SILHOUETTE RULE: the long robe and the layered silk must not hide the body silhouette; " +
        "the waistline and the legs' length stay visually readable; the figure stands at full height, head to feet; " +
        "HAIR VOLUME: long hair and hair ornaments are fine, but they must not visually enlarge the head " +
        "or shorten the body; " +
        "the face may be mature and beautiful, but the head is small in proportion to the body " +
        "(realistic adult head-to-body ratio), NOT a large head on a small body; " +
        "no chibi, no big head, no oversized head, no short legs, no small body, no stubby limbs, no toddler body, " +
        "no baby proportions, no childlike face",
    },
  ];
  // 🔴 v164c：这句原来是**恒定**的，原文为
  //     "this is the same character at an OLDER AGE THAN THE PREVIOUS STAGE ... do not keep the baby proportions"。
  //   但**凝形（第 1 阶）根本没有"上一阶段"**，于是模型在 prompt 后段直接收到"不要保留婴儿比例"的指令，
  //   把它前面 4000 字符处的 "a tiny newborn baby, about 4 heads tall" 全部推翻
  //   → 用户实测「花间酒」凝形出图画成了少年（脸像 6 头身、身子却是 4 头身，头大身长腿短，很不美观）。
  //   现在按阶段分叉：第 1 阶只说"这是它最初、最年幼的形态"，绝不再出现"上一阶段/更长更高"。
  //   不再重复 CONSISTENCY 那句"same character / same hair / do not change identity"——
  //   身份一致性由 CONSISTENCY 独占，这里只谈**年龄与身高递进**，省下的字符留给比例锁定块。
  function growthLine(stage) {
    const s = Math.min(4, Math.max(1, Number(stage) || 1));
    if (s <= 1) return "this is its very first and youngest form";
    return "this is the same character grown up from its " +
      (s === 2 ? "newborn form" : s === 3 ? "child form" : "teenage form") +
      ", it is now taller and more mature than that earlier form, " +
      "its body proportions and height must match the age described above";
  }
  // 旧版（v164c 之前）写死的成长描述常量：对「第 1 阶（凝形，没有上一阶段）」语义反转，
  // 把模型导向少年比例（"do not keep the baby proportions" 在 prompt 后段出现，推翻前面的 4 头身）—— 这是 v164c 修掉的元凶。
  // 仅用于「恢复旧立绘」：用旧 prompt 精确还原 v164c 之前的出图 URL，把被改 prompt 洗掉的旧图找回来。
  const LEGACY_GROWTH_LINE = "this is the same character at an older age than the previous stage, " +
    "keep the exact same face, hair color, eye color and accessories, only grow taller and more mature, " +
    "body proportions and height must change with the age described above, do not keep the baby proportions";
  // v164c 把 STAGES 的 look 文案也改过（凝形从 "baby version / no accessories" 改成 "chibi version / very simple plain clothing" 等），
  // 要精确复刻旧 URL 必须连这段旧文案一起还原 —— 否则 pollinations 缓存命中不了，找回来的就不是原图。
  const LEGACY_STAGE_LOOKS = [
    "a tiny newborn baby version of the character, about 4 heads tall, round baby face, small soft body, simple plain clothes, no accessories, soft innocent eyes, just awakened, extremely cute",
    "a small child version of the character, about 6 heads tall, noticeably taller than the newborn form, neat simple outfit, small accessory, lively bright eyes, energetic pose, still cute and round",
    "a teenage version of the character, about 8 heads tall, slim teenage proportions, longer limbs, a more defined jawline, confident pose, stylish detailed outfit with subtle pattern, environment behind",
    "a fully grown adult version of the same character, about 9 heads tall, magnificent ornate ceremonial outfit with rich glowing patterns, rich cinematic scene behind, elegant and beautiful, masterpiece quality",
  ];
  // v165：四阶段进阶 = **只认盘玩次数**（挂瓷后每盘一次算一次），⛔ 不再认天数。
  //   旧 v163b 口径是「挂瓷后天数 ∧ 盘玩次数」双条件取慢者，化形要 120 天 ∧ 60 次
  //   → 用户实测「卡在凝形，没有进阶按钮」，实际是双条件永远升不上去。本版按用户新口径改：
  //   开窍 = 盘 3 次 / 蜕形 = 盘 6 次 / 化形 = 盘 10 次（不限天数）。
  //   旧 rec.stage 值忽略、不再手动突破（下游读者 stageDef/needCg/when:{stage:N} 一律不变，零改造兼容）。
  const STAGE_DAYS  = [0, 0,   7,  30, 120];   // ⛔ v165 起不再参与进阶判定，仅作历史留档（保留常量避免别处引用炸）
  const STAGE_PLAYS = [0, 0,   3,   6,  10];   // 1-based；[0] 前导占位，对齐 HEAD_COUNT 长度5 —— 唯一判定口径
  const HEAD_COUNT  = [0,   4,   6,   8,   9]; // 头身比（v165-R1：改回 8/9 —— 用户裁定「7 不好看，8/9 才帅气」。
     //   v165-Q 曾降到 7/7.5，理由是"8/9 超模"；但实测蜕形只画出 5–5.5 头身，
     //   说明卡点在**执行手段**（宽袍糊轮廓 / 头发撑头 / 可爱先验），不在数字高低 → 数字恢复，手段补强。
     //   仍为唯一事实源：sizeZh / look / prop 三处文案与它保持一致）
  function stageOf(item, rec) {
    // ⛔ v165：不再读 bornAt / 不再算天数，只看 playCount
    const plays = Number(item && item.playCount) || 0;
    let s = 1;
    for (let k = 2; k <= 4; k++) {
      if (plays >= STAGE_PLAYS[k]) s = k;   // 盘够次数就进阶，无天数门槛
      else break;
    }
    return s;
  }
  function headCountOf(stage) { return HEAD_COUNT[Math.min(4, Math.max(1, Number(stage) || 1))]; }
  /* ============================================================
   * 🔴 v165-F · 立绘比例执行手段 v2
   *   用户第二次打回：蜕形（8 头身）实测约 5.5–6 头身，宽袍及地、人物偏小。
   *   上一版（v165-R1）已写了"数字锚 + 时装画锚词 + 七条强负向 + 轮廓句 + 头发句"仍不达标。
   *   dump 真产物（docs/_dump_prompt.js）后确认的三条新根因：
   *     ① 画幅留白：cmp 里写死 "centered with comfortable margin around the character"
   *        → 模型把人物画小、四周留白 → 观者按"画面里这个人"脑补，比例被视觉压矮。
   *     ② 抽象锚词不落地：8-heads / fashion-illustration 对扩散模型是"风格词"，不是可计量的身体分区
   *        → 换/补成可直接对照的数值分区（腿长≈身高一半 / 肩宽≈1.5 头宽）。
   *     ③ 全英文 prompt：ark 走的是**字节豆包 Seedream（国产模型）**，中文指令执行力通常强于英文。
   *        → 追加一句中文比例锚，压在**整条 prompt 最末尾**（仅 ark 生效）。
   *   立绘路径专属：⛔ CG 路径（promptForCg / cgPromptFromBrief / cgPropFor）一律不动。
   * ============================================================ */
  // 人物占满画幅（非 legacy 的立绘一律用它替换旧的"舒适留白"措辞）
  const FRAME_FILL = "the standing figure fills the full vertical extent of the frame, from the very bottom to the very top, " +
    "no empty space above the head or below the feet";
  // 旧措辞：仅 legacy（恢复旧立绘 URL）时保留 —— 必须逐字节复刻旧 prompt，否则旧图找不到
  const FRAME_FILL_OLD = "centered with comfortable margin around the character";
  // 开场身份锚的旧文案（appearancePrompt 里写死；这里用于按阶段替换，⛔ 不改 appearancePrompt 本体，避免污染 CG）
  const AGE_OPEN_BOY_OLD = "a young boy character, clearly male, boyish face:";
  const AGE_OPEN_GIRL_OLD = "a young girl character, clearly female, girlish face:";
  //   索引对齐 HEAD_COUNT；1/2 阶保持原样（幼儿本就该幼态），3/4 阶掐掉"young boy / boyish face"这种幼态残留
  const AGE_OPEN = [
    null,
    { boy: AGE_OPEN_BOY_OLD, girl: AGE_OPEN_GIRL_OLD },
    { boy: AGE_OPEN_BOY_OLD, girl: AGE_OPEN_GIRL_OLD },
    { boy: "a teenage boy, clearly male, youthful handsome face:", girl: "a teenage girl, clearly female, youthful pretty face:" },
    { boy: "a young adult man, clearly male, handsome mature face:", girl: "a young adult woman, clearly female, beautiful mature face:" },
  ];
  // 中文比例锚（仅 provider==="ark" 追加到 prompt 最末尾）：可配置常量表，索引对齐 HEAD_COUNT。
  //   理由：用户实际用 ark（豆包 Seedream）；其它 provider 不保证中文理解力 → 不追加，避免污染 prompt。
  const PROPORTION_ZH = [
    "",
    "画面比例要求：刚醒来的小宝宝形态，全身站姿，大约四头身，头要大、身子和手脚要短小，脸要圆要幼，整体是圆润可爱的小幼儿比例。",
    "画面比例要求：小孩子形态，全身站姿，大约六头身，头略大、身子和腿偏短，脸圆但比宝宝形态清秀，比宝宝形态更高更瘦一些。",
    "画面比例要求：少年形态，全身站姿，全身高度约为头高的八倍，腿部要占身高的一半以上，头部要画得小、肩膀要窄、腿要长，整体是时装画里那种修长挺拔的比例，绝不是大头短腿的可爱风格。",
    "画面比例要求：成年形态，全身站姿，全身高度约为头高的九倍，腿部要占身高的一半以上，头部更小、身形修长挺拔，整体是时装画里高挑成年人的比例，绝不是大头短腿的可爱风格。",
  ];
  function proportionZhFor(stage) { return PROPORTION_ZH[Math.min(4, Math.max(1, Number(stage) || 1))] || ""; }
  /* ============================================================
   * 🔴 v167-B · 服装去清代 + 仙侠基调 + 中文指令锚
   *   用户是汉服爱好者/汉族，**强烈反感清朝服饰特征**（点名了几类清制官服形制：立式高领、对襟排扣、蜈蚣扣、厂字领），
   *   声明「不接受清朝的服饰，我宁愿是仙侠风格」；并问「方舟（ark）中文理解更好，prompt 能中文化吗」。
   *   本块只作用于**非 legacy** 路径（legacy＝详情页「🔙 恢复旧立绘」，必须逐字节复刻旧 prompt）。
   * ============================================================ */
  // (a) 清代服饰强禁（英文负向）—— ⛔ 独立常量，⛔ 绝不并入全局 NEG_STYLE（NEG_STYLE 被 legacy 共用，且凝形 Q 版靠大头吃饭）
  const NO_QING = "strictly no Qing dynasty or Manchu costume: no mandarin collar, no standing collar, " +
    "no frog buttons, no knot buttons, no pankou, no magua, no tang-style front-button jacket, " +
    "no qipao, no cheongsam, no changshan, no mandarin jacket, no official hat, no queue hairstyle";
  // (b) 正向仙侠 / 汉服形制（先秦至明代）
  const XIANXIA_LOOK = "xianxia wuxia immortal aesthetic, hanfu in pre-Qing Chinese styles: " +
    "cross-collar with the right lapel over the left (jiaoling youren), wide flowing sleeves, " +
    "long floating silk ribbons, immortal-robed drapery, jade crown or hairpin, layered silk sashes; " +
    "never a standing collar, never a buttoned placket";
  // (f) 中文服装锚（仅 ark（豆包 Seedream）且非 legacy；与 PROPORTION_ZH 同一开关）
  const COSTUME_ZH = "服装要求：请画中国古代汉服（先秦至明代形制），必须交领右衽、宽袍大袖，可加飘带与广袖仙袂；" +
    "绝对不要清朝服饰：不要立领、不要盘扣、不要蜈蚣扣、不要对襟褂、不要马褂、不要旗袍、不要长衫、不要官帽、不要辫子。整体气质偏仙侠仙气。";
  // v172-A：CG **构图锚**（中文，仅 ark；与 COSTUME_ZH 同开关 zhAnchorEnabled()）
  //   目的：沁灵列表缩略图已改用「固定几何框」（头在上方 1/3、水平居中、顶端留 2%），
  //   这条锚让**将来新出的 CG 天然落进那个框** —— 固定框的可靠性从「经验」变成「规格保证」。
  //   ⚠️ 插在 PROPORTION LOCK **之前**：比例锁定块永远压在整条 prompt 最末尾（见 cgPromptFromBrief）。
  const CG_COMPOSE_ZH = "构图要求：人物头部位于画面上方三分之一、水平居中，头顶留出少量空间，不要切到头顶或发髻；" +
    "人物主体居中偏上，画面下方留出身体与场景空间。";
  // (d) CG 三条路径共用的服装守卫（CG 无 legacy 分支，直接追加）
  const CG_COSTUME_GUARD = XIANXIA_LOOK + ", " + NO_QING;
  // 中文比例锚 / 服装锚的**总开关**（一键回退：置 false 即回到纯英文 prompt）
  const ZH_ANCHOR_ON = true;
  function zhAnchorEnabled() { return ZH_ANCHOR_ON && (getImageCfg() || {}).provider === "ark"; }
  // (e) legacy 冻结：清理清代诱导词时改过 en 的两条 OUTFITS —— legacy 分支替换回旧 en，保证旧图 URL 逐字节复刻。
  //   （zh 显示串改了不影响 legacy：legacy prompt 只用 en；⛔ 但 en 一改，恰好抽中这两条的沁灵旧图就会漂 → 故冻结。）
  const LEGACY_OUTFIT_EN = [
    { now: "a cross-collar Chinese hanfu robe with the right lapel over the left and wide sleeves",
      old: "a traditional Chinese tang-style jacket with frog buttons and a stand collar" },
    { now: "an embroidered Chinese cross-collar robe with cloud-patterned trim",
      old: "an embroidered Chinese front-button jacket with cloud-patterned trim" },
  ];
  function stageOrnate(stage) { return Number(stage) === 4; }   // 化形（终阶）：更华丽服饰 + 场景
  function stageProgress(item, rec) {
    // v165：⛔ 不再返回天数余量（toNextDays 恒 0，仅为兼容旧调用方保留字段）；bottleneck 恒 "plays"
    const s = stageOf(item, rec);
    if (s >= 4) return { isMax: true, pct: 100, toNextDays: 0, toNextPlays: 0, bottleneck: "plays" };
    const pNeed = STAGE_PLAYS[s + 1];
    const plays = Number(item && item.playCount) || 0;
    const pRem = Math.max(0, pNeed - plays);
    const pct = Math.min(100, Math.round((plays / pNeed) * 100));
    return { pct: pct, toNextDays: 0, toNextPlays: pRem, bottleneck: "plays" };
  }

  /* ---------- v163b：事件卡（瞬时弹出 + 事件回顾）—— 见 docs/v163-互动系统设计.md 【C+.2】 ---------- */
  const EVENT_KEEP = 60;                 // 每只沁灵最多保留 60 条事件（体积纪律）
  const _eventPops = [];                 // 待弹出的瞬时事件（app.js 负责 drain 渲染）
  function recordEvent(rec, ev) {
    rec.events = rec.events || [];
    const id = (ev.linked && ev.linked[0] || "?") + "|" + ev.type + "|" + todayKey(ev.at);  // 同类型同日去重键
    const ex = rec.events.find((e) => e.id === id);
    if (ex) { ex.at = ev.at; ex.title = ev.title; ex.summary = ev.summary; ex.icon = ev.icon; return false; }  // 更新不新增
    rec.events.push({
      id: id, type: ev.type, at: ev.at, title: ev.title, summary: ev.summary, icon: ev.icon,
      linked: (ev.linked && ev.linked.length) ? ev.linked.slice() : [ev.linked && ev.linked[0] || "?"],
    });
    if (rec.events.length > EVENT_KEEP) rec.events.splice(0, rec.events.length - EVENT_KEEP);  // 超限丢最旧
    _eventPops.push({ title: ev.title, summary: ev.summary, icon: ev.icon, ownerId: (ev.linked && ev.linked[0]) || "?", at: ev.at });
    return true;                         // true = 首次新增（用于触发弹出）
  }
  function drainEventPops() { const p = _eventPops.slice(); _eventPops.length = 0; return p; }
  function allEvents(items, store) {     // O(n)：每只扫一次 rec.events，绝不两两枚举
    const out = [];
    (items || []).forEach((it) => {
      const rec = (store && store[it.id]) || {};
      (rec.events || []).forEach((e) => out.push({
        id: e.id, type: e.type, at: e.at, title: e.title, summary: e.summary, icon: e.icon,
        linked: e.linked, ownerId: it.id, ownerName: it.name,
      }));
    });
    out.sort((a, b) => (b.at || 0) - (a.at || 0));   // 倒序：最近的在前
    return out;
  }

  /* ---------- v163b：出图提炼器 / 自检器 / 确认卡 —— 见 docs/v163-出图提炼规范.md ---------- */
  function _esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const _POSES_ZH_EN = {
    "作揖": "bowing with hands together", "拱手": "cupping one hand in the other", "拂袖": "sweeping the sleeve",
    "团扇半遮面": "holding a round fan half-covering the face", "低眸": "looking down with lowered eyes",
    "捻珠": "twirling prayer beads", "执笔": "holding a brush pen", "捧盏": "holding a small cup with both hands",
    "展卷": "unfolding a scroll", "捧着": "holding with both hands", "抱着": "hugging",
  };
  const _PROPS_ZH_EN = {
    "绣球花": "a bouquet of hydrangea flowers", "竹简": "bamboo slips", "团扇": "a round silk fan",
    "盏": "a small tea cup", "卷": "a scroll", "珠串": "a string of prayer beads", "灯笼": "a paper lantern",
    "花": "a small flower", "书": "a book", "剑": "a small wooden sword", "琴": "a small zither", "荷包": "a small pouch",
    // v164：用户自己写的东西必须认得出来（旧表只有 12 个词，写「柿子」就完全读不到）
    "柿子": "a ripe persimmon", "果子": "a piece of fruit", "桃子": "a peach", "苹果": "an apple",
    "橘子": "a tangerine", "荔枝": "a lychee", "桂花": "osmanthus blossoms", "花枝": "a sprig of blossoms",
    "折扇": "a folding fan", "扇子": "a fan", "油纸伞": "an oil-paper umbrella", "纸伞": "an oil-paper umbrella",
    "玉笛": "a jade flute", "笛": "a bamboo flute", "箫": "a bamboo flute", "酒壶": "a wine flask",
    "茶杯": "a small tea cup", "茶": "a cup of tea", "竹篮": "a small woven basket", "篮子": "a small woven basket",
    "毛笔": "a writing brush", "画笔": "a painting brush", "玉佩": "a jade pendant", "葫芦": "a gourd",
    "铃铛": "a tiny bell", "香囊": "a scented sachet", "卷轴": "a scroll", "棋盘": "a go board",
    "布偶": "a small cloth doll", "风车": "a paper pinwheel", "蝴蝶": "a butterfly",
  };
  const _OUTFIT_ZH_EN = {
    "襦裙": "a ruqun (cross-collar hanfu dress)", "长衫": "a long scholar's robe", "褙子": "a beizi (open-sided hanfu coat)",
    "道袍": "a taoist robe", "汉服": "elegant hanfu", "襕衫": "a lanshan robe", "直裾": "a zhiju robe",
    // v164：补常见中式形制（用户写「圆领袍」时旧表一个都不命中 → 直接掉进随机池）
    "圆领袍": "a yuanlingpao (round-collar robe)", "圆领": "a round-collar robe", "袍": "a long traditional robe",
    "大袖衫": "a wide-sleeved gown", "大袖": "a wide-sleeved gown", "袄裙": "a padded jacket and skirt set",
    "袄": "a padded jacket", "披风": "a Chinese cape", "斗篷": "a hooded cloak", "鹤氅": "a crane-feather cloak",
    "对襟": "a front-buttoned robe", "交领": "a cross-collar robe", "半臂": "a sleeveless short jacket",
    "齐胸": "a chest-high ruqun", "曲裾": "a quju robe", "褂": "a Chinese front-opening long robe", "外袍": "an outer robe",
    "裙": "a skirt", "衫": "a robe", "衣裳": "a traditional outfit",
  };
  const _HAIR_ZH_EN = {
    "长直": "long straight hair", "发髻": "hair tied in a bun", "发冠": "hair held by a hair crown",
    "马尾": "a ponytail", "辫": "braided hair", "披发": "loose flowing hair", "双马尾": "twin tails", "双环": "twin buns",
    // v164：发型词表（旧表不认「高高束起」，于是发型字段回退成了发色「柿红」）
    "高高束起": "hair tied up high in an elegant topknot", "高束": "hair tied up high", "束起": "hair tied up",
    "束发": "hair tied up", "挽起": "hair gathered up", "盘发": "hair coiled into a bun", "丸子头": "a top bun",
    "半扎": "half-up hair", "编发": "braided hair", "长发": "long hair", "短发": "short hair",
    "齐肩": "shoulder-length hair", "散发": "loose flowing hair", "披肩": "hair falling over the shoulders",
  };
  // v164：神态词表（「明媚笑容」这类以前完全读不到，特征栏直接显示「无」）
  const _SMILE_ZH_EN = {
    "明媚笑容": "a bright cheerful smile", "明媚的笑": "a bright cheerful smile", "灿烂笑容": "a radiant smile",
    "笑容": "a warm smile", "微笑": "a gentle smile", "含笑": "a soft smile", "浅笑": "a faint smile",
    "大笑": "a hearty laugh", "冷峻": "a cool stern expression", "温柔": "a tender expression",
    "慵懒": "a lazy relaxed expression", "害羞": "a shy bashful look", "英气": "a spirited dashing look",
    "忧郁": "a melancholy look", "顽皮": "a playful smirk-free grin", "认真": "a focused serious look",
  };
  // v166：立绘表情变体（base = 现有中立立绘；其余为可懒出的表情立绘）
  //   集合与 _SMILE_ZH_EN 对齐；en 是拼进 promptFor 的「神态锚点」（base 不加，保持原中立立绘）
  const EXPR_LIST = [
    { key: "base",    zh: "日常", en: "" },
    { key: "tender",  zh: "温柔", en: "a tender soft smile, gentle warm expression, relaxed posture" },
    { key: "shy",     zh: "害羞", en: "a shy bashful look, slightly lowered eyes, flustered cute expression" },
    { key: "dashing", zh: "英气", en: "a spirited dashing look, bright confident eyes, upright posture" },
    { key: "aloof",   zh: "冷峻", en: "a cool stern expression, calm distant gaze, composed face" },
    { key: "lazy",    zh: "慵懒", en: "a lazy relaxed expression, sleepy half-lidded eyes, leisurely mood" },
    { key: "laugh",   zh: "大笑", en: "a hearty laugh, bright smiling eyes, joyful open expression" },
  ];
  const EXPR_BY_KEY = {};
  EXPR_LIST.forEach((e) => { EXPR_BY_KEY[e.key] = e; });
  // exprKey → seedOf variant 偏移（与 base/换形象 0 拉开，避免撞种子；但同串同源保证「只是表情不同」）
  const EXPR_SALT_BASE = 100;
  // v166：对话按情绪自动选已缓存表情 —— 扫描台词文本映射到 exprKey（只在已缓存时才用，不触发出图）
  const _EXPR_TEXT_MAP = [
    { key: "laugh",   re: /(哈哈|嘻嘻|嘿嘿|笑|乐|开心|高兴|好玩|有趣|逗|欢喜|雀跃)/ },
    { key: "shy",     re: /(害羞|脸红|不好意思|赧|忸怩|悄悄|偷偷|窘|慌)/ },
    { key: "aloof",   re: /(冷|淡|疏|漠|无谓|不屑|傲|凉)/ },
    { key: "dashing", re: /(英气|凛|傲然|挺身|堂堂|豪气|侠|凛然)/ },
    { key: "lazy",    re: /(懒|困|倦|乏|慵|散|闲)/ },
    { key: "tender",  re: /(温柔|柔软|怜|惜|疼|乖|暖|柔声|轻声)/ },
  ];
  function exprForText(text) {
    const t = String(text || "");
    for (let i = 0; i < _EXPR_TEXT_MAP.length; i++) if (_EXPR_TEXT_MAP[i].re.test(t)) return _EXPR_TEXT_MAP[i].key;
    return "";
  }
  // v164：性别词（用户写「少年郎」以前读不到，出图性别只能靠随机）
  const _BOY_WORDS = ["少年郎", "少年", "男孩", "男童", "小哥", "少年人", "男儿", "公子", "郎君"];
  const _GIRL_WORDS = ["姑娘", "少女", "女孩", "女童", "妹子", "女子", "少女郎", "小姐", "闺秀"];
  // v166：从用户写的设定文字里认出性别（少年郎→男 / 姑娘→女）。用于 4 步设定确认时把性别写回 rec.gender，
  //   这样「粉黛熊写了少年郎」就不会因为 born() 随机掷过而画成女孩。
  function genderFromText(text) {
    const t = String(text || "");
    const bw = _BOY_WORDS.filter((w) => t.indexOf(w) >= 0);
    const gw = _GIRL_WORDS.filter((w) => t.indexOf(w) >= 0);
    if (bw.length && !gw.length) return "boy";
    if (gw.length && !bw.length) return "girl";
    return "";
  }
  // 长键优先 + 命中即"吃掉"该区间，避免「花枝」和「花」被重复算两次
  function _scanZh(text, map) {
    const src = String(text || "");
    if (!src) return [];
    const keys = Object.keys(map).sort((a, b) => b.length - a.length);
    const hit = [];
    const used = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      let p = src.indexOf(k);
      while (p >= 0) {
        let covered = false;
        for (let j = 0; j < used.length; j++) {
          if (p >= used[j][0] && p + k.length <= used[j][1]) { covered = true; break; }
        }
        if (!covered) { hit.push({ zh: k, en: map[k], at: p }); used.push([p, p + k.length]); }
        p = src.indexOf(k, p + 1);
      }
    }
    hit.sort((a, b) => a.at - b.at);
    return hit;
  }
  // v164：把命中位置所在的**整句**抠出来（到标点或 ±14 字为止）。
  //   用户写「穿着柿红色搭配鹅黄色的圆领袍」，我们要的是这句话，不是词表里的「袍」。
  function _grabClause(src, pos, len, span) {
    const s = String(src || "");
    if (!s) return "";
    const cut = /[，。；！？、,.!?;:\n\r]/;
    const lim = span || 14;
    let a = Math.max(0, pos - lim), b = Math.min(s.length, pos + len + lim);
    for (let i = pos; i >= a; i--) { if (cut.test(s.charAt(i))) { a = i + 1; break; } }
    for (let i = pos + len; i < b; i++) { if (cut.test(s.charAt(i))) { b = i; break; } }
    let out = s.slice(a, b).trim();
    // 去掉开头的动词/量词，留下真正的描述（「穿着柿红色搭配鹅黄色的圆领袍」→「柿红色搭配鹅黄色的圆领袍」）
    out = out.replace(/^(身穿|身着|穿着|穿了|披着|戴着|系着|一身|一袭|手拿着|手里握着|手里拿着|握着|拿着|抱着|捧着)/, "");
    out = out.replace(/^[的了着有把一穿]/, "");
    return out.trim();
  }
  // v164：把一段中文里出现的**所有**色名抠出来（最长优先、不重复）。
  //   用户写「柿红色搭配鹅黄色的圆领袍」→ [{柿红,#e0513a},{鹅黄,#fff143}]
  //   （旧版靠 outfitColorFromText 的 ±8 邻近窗口，窗口太窄，只认到末尾的「鹅黄」就丢了「柿红」）
  //   两张表都扫：CN_TRAD_COLORS 带精确 hex 优先，COLOR_WORD_ZH 兜底（否则「淡紫」这种就丢了）
  function _colorsIn(text) {
    const s = String(text || "");
    if (!s) return [];
    const all = [];
    CN_TRAD_COLORS.forEach((c) => all.push({ zh: c[0], hex: c[1] }));
    const known = {};
    CN_TRAD_COLORS.forEach((c) => { known[c[0]] = 1; });
    Object.keys(COLOR_WORD_ZH).forEach((w) => { if (w && !known[w]) all.push({ zh: w, hex: "" }); });
    all.sort((a, b) => b.zh.length - a.zh.length);
    const out = [], used = [];
    for (let i = 0; i < all.length; i++) {
      const zh = all[i].zh, hex = all[i].hex;
      let p = s.indexOf(zh);
      while (p >= 0) {
        let cov = false;
        for (let j = 0; j < used.length; j++) if (p >= used[j][0] && p + zh.length <= used[j][1]) { cov = true; break; }
        if (!cov) { out.push({ zh: zh, hex: hex, at: p }); used.push([p, p + zh.length]); }
        p = s.indexOf(zh, p + 1);
      }
    }
    out.sort((a, b) => a.at - b.at);
    return out;
  }
  // v164：把一只沁灵**用户自己写的设定**（look.base + 用户确认过的人设 look.persona + look.profile）
  //   提炼成结构化草稿 LookBrief。
  // ⛔ 故意**不读** rec.personaZh —— 那是模型自动扩写的正文，扫它等于把 AI 编的
  //   「灯笼、花、剑」当成用户要求（旧版就是这么把用户写的「柿子」顶掉的）。
  function extractLookBrief(rec, item) {
    rec = rec || {};
    const lk = rec.look || {};
    const lf = lookOf(item, rec);
    const ap = lf.ap || {};
    const base = lk.base || "", profile = lk.profile || "", persona = lk.persona || "";
    const src = [base, profile, persona].filter(Boolean).join("\n");
    // 动作：用户写过优先，否则古风仪态池
    const poseHit = _scanZh(src, _POSES_ZH_EN);
    const poseZh = poseHit.length ? poseHit.map((x) => x.zh).join("，") : "静立";
    const poseEn = poseHit.length ? poseHit.map((x) => x.en).join(", ") : "standing gracefully";
    // 持物：用户写过优先，绝不替换随机池
    //   （旧版"没读到就退回随机池"，于是用户写「手里握着柿子」、卡片上显示的是随机到的「灯笼、花、剑」）
    const propHit = _scanZh(src, _PROPS_ZH_EN);
    const propZh = propHit.length ? propHit.map((x) => x.zh).join("，") : "";
    const propEn = propHit.length ? propHit.map((x) => x.en).join(", ") : "";
    // 服饰：抠**整句**（「柿红色搭配鹅黄色的圆领袍」），不是词表里孤零零的「袍」。
    //   v164b：抠出来后再**裁到最后一个服装词结尾**，别把后面的「的小姑娘」也一起带走。
    //   没人写才退回固定人设 —— 且必须用 ap.outfitZh（旧版这里错写成 ap.outfit，
    //   把英文串塞进了中文字段，卡片上就是这么显示出一长串英文的）
    const outfitHit = _scanZh(src, _OUTFIT_ZH_EN);
    let outfitZh = "古风常服";
    if (outfitHit.length) {
      let oc = _grabClause(src, outfitHit[0].at, outfitHit[0].zh.length, 12) || outfitHit[0].zh;
      const cw = Object.keys(_OUTFIT_ZH_EN).sort((a, b) => b.length - a.length);
      let end = -1;
      for (let i = 0; i < cw.length; i++) {
        const p = oc.indexOf(cw[i]);
        if (p >= 0) { const e = p + cw[i].length; if (e > end) end = e; }
      }
      if (end > 0 && end < oc.length) oc = oc.slice(0, end);
      outfitZh = oc;
    } else if (ap.outfitZh) {
      outfitZh = ap.outfitZh;
    }
    // v165：兜底不再回落 hanfu（用户没写衣服时也不该一律汉服）
    const outfitEn = outfitHit.length ? outfitHit.map((x) => x.en).join(", ") : "classical Chinese-inspired attire";
    // 发型：词表词；**绝不用发色兜底**
    //   （旧版没命中就退回 hairCn，于是发型栏显示成「柿红」这个颜色）
    const hairHit = _scanZh(src, _HAIR_ZH_EN);
    const hairstyleZh = hairHit.length ? hairHit.map((x) => x.zh).join("，") : "古风发式";
    const hairstyleEn = hairHit.length ? hairHit.map((x) => x.en).join(", ") : "elegant ancient hairstyle";
    // 神态（「明媚笑容」这类以前完全读不到）
    const smileHit = _scanZh(src, _SMILE_ZH_EN);
    // 颜色：① 人设原文里贴着服装词的色名（lookOf 那套，最准）
    //       ② 没有就扫贴着头发词的色名  ③ 都还没有才用固定人设里的（且发色不留「跟珠子主色/自动 · x」占位符）
    const colors = [];
    if (outfitHit.length) {
      // 用抠出来的**整句**扫全部色名 —— 「柿红配鹅黄」两个都要，不能只留一个
      const ocs = _colorsIn(outfitZh);
      if (ocs.length) ocs.forEach((c) => colors.push({ part: "衣", cn: c.zh, hex: c.hex }));
      else colors.push({ part: "衣", cn: outfitZh, hex: "" });
    } else if (lf.outfitZh) {
      colors.push({ part: "衣", cn: lf.outfitZh, hex: lf.outfitHex || "" });
    }
    const hairCol = _colorNearWord(src, ["头发", "长发", "发丝", "发髻", "发型", "发"], 7, 7);
    if (hairCol) colors.push({ part: "发", cn: hairCol.zh, hex: hairCol.hex || "" });
    else if ((lf.hairSrc === "custom" || lf.hairSrc === "pick") && lf.hairZh) colors.push({ part: "发", cn: lf.hairZh, hex: lf.hairHex || "" });
    // 性别：用户写了「少年郎 / 姑娘」就以此为准（旧版完全忽略，出图性别只能靠随机）
    const _bw = _BOY_WORDS.filter((w) => src.indexOf(w) >= 0);
    const _gw = _GIRL_WORDS.filter((w) => src.indexOf(w) >= 0);
    // 特征：chips 选中的 + 从人设原文读到的神态
    const feats = (lf.feats || []).map((f) => ({ zh: f.zh || f.id, en: f.en || f.id }));
    smileHit.forEach((x) => feats.push({ zh: x.zh, en: x.en }));
    // 场景：立绘可极简，给安全默认
    const sceneZh = (profile && profile.indexOf("场景") >= 0) ? profile : "素净背景，柔光";
    const sceneEn = "plain soft background with gentle light";
    // 性别：用户原话里写了「少年郎 / 姑娘」就以他写的为准（旧版完全忽略，出图性别只能靠随机）
    let gender = (ap.gender || rec.gender || (item && item.gender) || "");
    if (_bw.length && !_gw.length) gender = "boy";
    else if (_gw.length && !_bw.length) gender = "girl";
    return {
      gender: gender,
      genderWord: (_bw[0] || _gw[0] || ""),
      pose: poseEn, poseZh: poseZh,
      prop: propEn, propZh: propZh,
      outfit: outfitEn, outfitZh: outfitZh,
      colors: colors,
      hairstyle: hairstyleEn, hairstyleZh: hairstyleZh,
      hairColorZh: hairCol ? hairCol.zh : "",
      hairColorHex: hairCol ? (hairCol.hex || "") : "",
      feats: feats,
      scene: sceneEn, sceneZh: sceneZh,
      extraZh: "",
      styleBits: (GUOFENG || "") + " " + (NEG_STYLE || "") + " " + (CONSISTENCY || "") + " " + (SINGLE || ""),
      anatomyBits: (ANATOMY || "") + ", simple clear posture, both arms and hands fully visible and uncrossed, " +
        "no overlapping or hidden arms, avoid complex hand gestures that risk extra limbs or extra fingers",
    };
  }
  // 出图前自检（§4.2 四断言）；不过则禁止出图
  function validateAnatomy(draft) {
    const issues = [];
    const t = [draft.pose || "", draft.prop || "", draft.outfit || "", draft.scene || "",
      (draft.feats || []).map((f) => (f.en || f.zh || "")).join(" "), draft.hairstyle || ""].join(" ").toLowerCase();
    if (/third arm|extra (arm|hand|limb)|floating hand|detached/.test(t)) {
      issues.push("草稿含「额外肢体」字样，已退回到双手双脚的简单姿态");
    }
    if (draft.prop) {
      if (/各持/.test(draft.propZh || "")) issues.push("出现「各持多件」，已降级为单手捧物");
      const cnt = (String(draft.prop).match(/,/g) || []).length + 1;
      if (cnt > 2) issues.push("持物过多，已降级为单手捧一物");
    }
    if (!(ANATOMY || "").toLowerCase().indexOf("five fingers") >= 0 &&
        !(ANATOMY || "").toLowerCase().indexOf("5 fingers") >= 0) {
      issues.push("解剖约束未拼入，已补「每手五指」");
    }
    return { ok: issues.length === 0, issues: issues };
  }
  // 确认卡结构（§5.2 / v164 可编辑）—— 返回 HTML，app.js 嵌进 modal 展示
  //   v164 关键改动：**每一行都能改**。用户原话：「提取了也不能修改，那让我确认干嘛？」
  //   editable=true 时渲染成输入框，改完的值由 app.js 读回 → toBrief() 存成 look.brief → 真进 prompt。
  function renderConfirmCard(draft, editable) {
    const ed = !!editable;
    const d = draft || {};
    const inp = (key, val, ph, ta) => {
      const v = _esc(val || "");
      const p = _esc(ph || "");
      return ta
        ? '<textarea class="cf-in cf-ta" data-cf="' + key + '" rows="2" placeholder="' + p + '">' + v + "</textarea>"
        : '<input class="cf-in" type="text" data-cf="' + key + '" value="' + v + '" placeholder="' + p + '">';
    };
    const row = (k, key, val, ph, ta) =>
      '<div class="cf-row"><span class="cf-k">' + k + '</span><span class="cf-v">' +
      (ed ? inp(key, val, ph, ta) : _esc(val || "")) + "</span></div>";
    const colorText = (d.colors || []).map((c) => c.part + "·" + c.cn + (c.hex ? "(" + c.hex + ")" : "")).join("；");
    const featText = (d.feats || []).map((f) => f.zh || f.en || f.id).join("、");
    return '<div class="cf-card" data-cf-card="1">' +
      row("动作", "poseZh", d.poseZh || "静立", "例：双手拢袖、端静含笑") +
      row("持物", "propZh", d.propZh || "", "例：手里握着柿子（留空=不拿东西）") +
      row("服饰", "outfitZh", d.outfitZh || "", "例：柿红配鹅黄的圆领袍") +
      row("发型", "hairstyleZh", d.hairstyleZh || "", "例：高高束起") +
      row("颜色", "colorsText", colorText, "例：衣·柿红(#e0513a)；发·柿红") +
      row("特征", "featsText", featText, "例：明媚笑容、猫耳") +
      row("场景", "sceneZh", d.sceneZh || "素净背景，柔光", "例：素净背景，柔光") +
      (ed ? row("补充", "extraZh", d.extraZh || "", "还想让它怎样？这里写的会原样进提示词", true) : "") +
      '<div class="cf-sep">── 以下两行只读，不可改 ──</div>' +
      '<div class="cf-row ro"><span class="cf-k">风格</span><span class="cf-v">中式古风（已锁定）</span></div>' +
      '<div class="cf-row ro"><span class="cf-k">一致</span><span class="cf-v">与旧像同人同色（已锁定）</span></div>' +
      '<div class="cf-fee">确认即耗出图额度一，画面依上表生成，落定难悔。</div></div>';
  }
  // v164：颜色表 → 给人看的一行（同部位合并）：「衣·柿红+鹅黄(#e0513a,#fff143)；发·柿红(#e0513a)」
  function _groupColors(cols) {
    const ord = [], map = {};
    (cols || []).forEach((c) => {
      const p = c.part || "衣";
      if (!map[p]) { map[p] = { part: p, cns: [], hexes: [] }; ord.push(map[p]); }
      if (c.cn && map[p].cns.indexOf(c.cn) < 0) map[p].cns.push(c.cn);
      if (c.hex && map[p].hexes.indexOf(c.hex) < 0) map[p].hexes.push(c.hex);
    });
    return ord.map((g) => g.part + "·" + g.cns.join("+") + (g.hexes.length ? "(" + g.hexes.join(",") + ")" : "")).join("；");
  }
  // v164：草稿 → 可落库的出图单。这是「确认卡」和「出图 prompt」之间唯一的桥。
  function toBrief(draft) {
    draft = draft || {};
    const col = (draft.colors || []);
    const hairC = col.filter((c) => c.part === "发")[0] || null;
    const outfitC = col.filter((c) => c.part === "衣" && c.hex)[0] || col.filter((c) => c.part === "衣")[0] || null;
    return {
      ver: 1, at: Date.now(),
      gender: draft.gender || "",
      poseZh: draft.poseZh || "", propZh: draft.propZh || "", outfitZh: draft.outfitZh || "",
      hairstyleZh: draft.hairstyleZh || "", sceneZh: draft.sceneZh || "",
      colorsText: _groupColors(col),
      featsText: (draft.feats || []).map((f) => f.zh || f.en || f.id).join("、"),
      extraZh: draft.extraZh || "",
      hairColorZh: draft.hairColorZh || (hairC ? hairC.cn : ""),
      hairColorHex: draft.hairColorHex || (hairC ? (hairC.hex || "") : ""),
      outfitHex: outfitC ? (outfitC.hex || "") : "",
    };
  }
  // v164：把用户确认卡上改过的值覆盖回去（app.js 读 DOM 后调用；纯函数，方便测）
  function mergeBrief(brief, vals) {
    const b = Object.assign({}, brief || {}, vals || {});
    if (vals && vals.hairColorZh) { b.hairColorZh = vals.hairColorZh; }
    if (vals && (vals.hairColorHex || vals.hairColorHex === "")) b.hairColorHex = vals.hairColorHex;
    // 颜色那一行是自由文本 → 从里面再抠一遍发色 hex，保证发色硬约束有精确值
    if (b.colorsText && !b.hairColorHex) {
      const m = String(b.colorsText).match(/发[·:：]\s*([^（(；;]+)(?:[（(](#?[0-9a-fA-F]{6})[)）])?/);
      if (m) { b.hairColorZh = b.hairColorZh || String(m[1]).trim(); if (m[2]) b.hairColorHex = m[2]; }
    }
    b.ver = 1; b.at = Date.now();
    return b;
  }
  // v164：出图单 → prompt 末尾的硬约束（模型对靠后关键词最敏感）。
  //   中英并列：中文保真（用户原话），英文给模型更明确的指令。
  // v165-A：opts.noPose —— **CG 路径专用**。立绘是一张定妆照，"出图单里的姿势"就是它该有的样子；
  //   但 CG 是"剧情里正在发生的一瞬"，姿势必须由**用户确认的画面描述**决定。
  //   若把立绘的 pose 也塞进 CG（"OWNER-CONFIRMED … pose: 静静站着"），就会和用户写的
  //   「右手搭在石桌边沿」抢戏 → 故 CG 调用时传 { noPose: true }。⛔ 立绘路径不传、行为不变。
  function briefHard(lk, opts) {
    const b = (lk && lk.brief) || null;
    if (!b) return "";
    const noPose = !!(opts && opts.noPose);
    const L = [];
    if (b.gender === "boy") L.push("this character is a BOY");
    else if (b.gender === "girl") L.push("this character is a GIRL");
    if (b.outfitZh) L.push("outfit: " + b.outfitZh + (b.outfitHex ? " (" + b.outfitHex + ")" : "") +
      " — use exactly this outfit, no other style or color");
    if (b.colorsText) L.push("colors — " + b.colorsText);
    if (b.propZh) L.push("in hand: " + b.propZh + " — show exactly this, and nothing else in the hands");
    else L.push("both hands empty unless the pose requires otherwise");
    if (b.hairColorZh) L.push("hair color: " + b.hairColorZh + (b.hairColorHex ? " (" + b.hairColorHex + ")" : "") +
      " — keep exactly this hair color");
    if (b.hairstyleZh) L.push("hair style: " + b.hairstyleZh);
    if (b.poseZh && !noPose) L.push("pose: " + b.poseZh);
    if (b.featsText) L.push("expression / features: " + b.featsText);
    if (b.sceneZh) L.push("scene: " + b.sceneZh);
    if (b.extraZh) L.push("owner's extra note (must obey): " + b.extraZh);
    if (!L.length) return "";
    return "OWNER-CONFIRMED DRAWING SPEC (highest priority; ignore any earlier conflicting detail): " + L.join("; ") + ". ";
  }
  // v164：出图单里写死的项 → 掐掉随机外观池里会打架的同类项（用户写了柿子，就不能同时出现随机抽的灯笼）
  function applyBrief(lk, ap) {
    const b = (lk && lk.brief) || null;
    if (!b) return { lk: lk, ap: ap };
    const ap2 = Object.assign({}, ap || {});
    if (b.propZh || b.propZh === "") ap2.prop = "";   // 持物：用户说了算，掐掉随机池的
    if (b.outfitZh) { ap2.outfit = b.outfitZh; ap2.outfitZh = b.outfitZh; }
    const lk2 = Object.assign({}, lk || {});
    // 出图单里的发色 / 衣服色必须**压过**随机池和珠子主色（否则"确认了柿红头发、画出来还是棕色"）
    if (b.hairColorZh) { lk2.hairZh = b.hairColorZh; lk2.hairEn = hairWordFromInput(b.hairColorZh) || b.hairColorZh; }
    if (b.hairColorHex) lk2.hairHex = b.hairColorHex;
    if (b.outfitZh) {
      const oc = outfitColorFromText(b.outfitZh);
      lk2.outfitZh = b.outfitZh;
      lk2.outfitEn = (oc && (oc.en || oc.zh)) || b.outfitZh;
      lk2.outfitHex = b.outfitHex || (oc && oc.hex) || "";
    }
    return { lk: lk2, ap: ap2 };
  }

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
    const canBreak = false;                          // v163b：阶段不再手动突破，恒 false
    const plays = Number(item && item.playCount) || 0;
    // v165：⛔ 原 `const d = Number(days) || 0;` 随天数门槛一起移除（days 仍传参给 growthOf）
    if (!next) {
      return {
        stage: cur, name: def.name, icon: def.icon, growth: growth, need: def.need, next: "", nextIcon: "",
        canBreak: false, isMax: true, pct: 100, toNext: 0,
      };
    }
    // v165：⛔ 删天数门槛，只按盘玩次数；need = 下一阶所需盘玩次数；bottleneck 恒 "plays"
    //   （growth 仍是 plays*3 + days，仅作展示/when 条件用，不参与本阶判定，故 ⛔ 不改 growthOf）
    const pNeed = STAGE_PLAYS[cur + 1];
    const pRem = Math.max(0, pNeed - plays);
    const pct = Math.min(100, Math.round((plays / pNeed) * 100));
    return {
      stage: cur, name: def.name, icon: def.icon, growth: growth,
      need: pNeed, next: next.name, nextIcon: next.icon,
      canBreak: false, isMax: false, pct: pct, toNext: pRem, bottleneck: "plays",
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
     立绘仍然是竖版（全身站姿），只有 CG（蜕形/化形专属插画、两只沁灵的事件插画）走横版。
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
    yes: "✅ 支持（深沁/换形象会带上一张立绘做参考，参考图不加钱）",
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
  const _fixed = { noRef: {}, noWatermark: {}, autoModel: {}, b64: {} };
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
      //    否则深沁到蜕形/化形也还是 Q 版大头（用户实测吐槽过）。
      // v150：整体基调改为「中国古风」——用户要求所有沁灵都画成古风（汉服/古装），不要现代/日式元素。
      // v165：ancient Chinese hanfu costume -> classical Chinese-inspired costume（不再全局锁汉服）
      text: "2D hand-drawn illustration in traditional Chinese gufeng style, classical Chinese-inspired costume and classical styling, " +
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
   * v127：沁灵「设定向导」——让用户 3-4 步确认，而不是全靠自动猜
   * 用户反馈：「读取颜色不对，每个人都太像了；生成之前让我辅助确认更好，
   *           比如发色/色调、特征（猫猫头要有猫耳）、性格；最好 3-4 个选项就能成，
   *           或者颜色我自己填；也可以我给一句基础设定，你来拓展成详细设定」。
   * 数据存在 rec.look 里（每只沁灵一份），优先级：**用户确认过 > 自动推断**。
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
    // v164：用户口语里最常用的那几个色名（旧表认不出「柿红」，写「柿红色搭配鹅黄色」时
    //   只有「鹅黄」命中、衣色整栏空白）
    ["柿红", "#e0513a"], ["柿色", "#e8834e"], ["枣红", "#b8302f"], ["水红", "#f0a3a8"],
    ["奶黄", "#f7e5a8"], ["米黄", "#f3ddb0"], ["杏子黄", "#f6cf6b"], ["藕粉", "#f0c8cc"],
    ["玫红", "#d4496c"], ["雾蓝", "#a8c0d8"], ["藏蓝", "#2b3a63"], ["墨蓝", "#2a3d52"],
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
    { id: "elf", zh: "灵耳", en: "long pointed elf ears", tail: false },
    { id: "wings", zh: "小天使翼", en: "small white feathered angel wings on the back", tail: false },
    { id: "devil", zh: "小恶魔角 + 尾", en: "small dark curved devil horns and a slim demon tail with a heart-shaped tip", tail: true },
    { id: "glasses", zh: "圆框眼镜", en: "round thin-frame glasses", tail: false },
    { id: "freckles", zh: "小雀斑", en: "a few light freckles across the cheeks", tail: false },
    { id: "blush", zh: "害羞腮红", en: "soft rosy blush on the cheeks", tail: false },
    // v164：用户反馈「选项太少了」→ 补一批**中式古风**向的面部/气质特征（禁用日式西式元素）
    { id: "huadian", zh: "眉心花钿", en: "a delicate traditional Chinese huadian floral mark painted on the forehead between the eyebrows", tail: false },
    { id: "zhusha", zh: "额间朱砂", en: "a small vermilion cinnabar dot on the center of the forehead", tail: false },
    { id: "teardrop", zh: "眼下泪痣", en: "a tiny beauty mark just below one eye", tail: false },
    { id: "dimples", zh: "小酒窝", en: "sweet little dimples when smiling", tail: false },
    { id: "fangs", zh: "小虎牙", en: "a small cute fang peeking out at the corner of the mouth", tail: false },
    { id: "peachblossom", zh: "桃花眼", en: "charming peach-blossom shaped eyes with slightly upturned corners", tail: false },
    { id: "phoenix", zh: "丹凤眼", en: "narrow phoenix eyes with elegant upswept outer corners", tail: false },
    { id: "catpupil", zh: "猫瞳", en: "cat-like vertical slit pupils in bright eyes", tail: false },
    { id: "scales", zh: "玉色鳞片", en: "a few subtle jade-colored scales along the cheekbones and temples", tail: false },
    { id: "lashwhite", zh: "白睫", en: "long snow-white eyelashes", tail: false },
    { id: "starorn", zh: "星月额饰", en: "a small traditional Chinese forehead ornament with a star and crescent moon motif", tail: false },
    { id: "redstring", zh: "颈间红绳", en: "a thin red string necklace tied around the neck", tail: false },
    { id: "inkmark", zh: "脸颊墨痕", en: "a faint brush-ink smudge on one cheek", tail: false },
    { id: "browdot", zh: "眉梢小痣", en: "a tiny mole at the outer tip of one eyebrow", tail: false },
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
    // v164：用户反馈「选项太少了」→ 补中式气质（侠气 / 才情 / 端方 / 娇憨…）
    { id: "wanderer", zh: "洒脱江湖", en: "free-spirited wanderer with a heroic air", face: "unrestrained confident grin, bright daring eyes" },
    { id: "scholar", zh: "温润书卷", en: "refined and scholarly", face: "warm gentle gaze, quiet bookish poise" },
    { id: "aloof", zh: "清冷疏离", en: "cold and distant", face: "faint expression, cool distant gaze" },
    { id: "sweet", zh: "娇憨可爱", en: "sweet and endearingly simple", face: "round innocent eyes, soft pouty look" },
    { id: "dignified", zh: "端方持重", en: "dignified and composed", face: "upright serene face, measured expression" },
    { id: "sentimental", zh: "多愁善感", en: "sentimental and wistful", face: "soft melancholy eyes, faint sighing smile" },
    { id: "heroic", zh: "侠气凛然", en: "chivalrous and upright", face: "resolute eyes and a firm righteous look" },
    { id: "pampered", zh: "慵懒富贵", en: "languid and pampered", face: "half-lidded relaxed eyes, faint spoiled smirk" },
    { id: "wild", zh: "野性未驯", en: "wild and untamed", face: "sharp alert eyes, a hint of defiant spirit" },
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
  // v163b：从人设原文里提炼「衣服颜色」——用户自己写在设定里的色名必须生效。
  // 旧逻辑只读珠子主色（木串 → 棕黄），用户写「月白淡紫」却出棕黄衣服，这是最不满意的一条。
  // 规则：只认**紧贴服装词**（衣/衫/裙/袍…）的色名，避免把发色、瞳色误当成衣服色。
  const _CLOTH_WORDS = ["衣", "衫", "裙", "袍", "裳", "服", "襦", "褙", "袄", "装", "衣着", "外袍", "长衫", "襦裙", "外裳"];
  function _nearCloth(src, pos, len) {
    const from = Math.max(0, pos - 8), to = Math.min(src.length, pos + len + 8);
    const win = src.slice(from, to);
    for (let i = 0; i < _CLOTH_WORDS.length; i++) if (win.indexOf(_CLOTH_WORDS[i]) >= 0) return true;
    return false;
  }
  function outfitColorFromText(src) {
    src = String(src || "");
    if (!src) return null;
    const hits = [];
    let i, p;
    // ① 中国传统色名（带精确 hex，最准）
    for (i = 0; i < CN_TRAD_COLORS.length; i++) {
      const zh = CN_TRAD_COLORS[i][0], hex = CN_TRAD_COLORS[i][1];
      p = src.indexOf(zh);
      while (p >= 0) {
        if (_nearCloth(src, p, zh.length)) hits.push({ zh: zh, hex: hex, at: p });
        p = src.indexOf(zh, p + 1);
      }
    }
    // ② 简易中文色词（无 hex，兜底）
    const cz = Object.keys(COLOR_WORD_ZH);
    for (i = 0; i < cz.length; i++) {
      const w = cz[i];
      if (!w) continue;
      p = src.indexOf(w);
      while (p >= 0) {
        if (_nearCloth(src, p, w.length)) hits.push({ zh: w, hex: "", at: p });
        p = src.indexOf(w, p + 1);
      }
    }
    if (!hits.length) return null;
    hits.sort((a, b) => a.at - b.at);
    // 去掉互相包含的重复命中（已命中「月白」就不再单独算「白」），最多取 2 个（如「月白淡紫」）
    const picked = [];
    for (i = 0; i < hits.length && picked.length < 2; i++) {
      const h = hits[i];
      let covered = false;
      for (let j = 0; j < picked.length; j++) {
        if (picked[j].zh.indexOf(h.zh) >= 0 || h.zh.indexOf(picked[j].zh) >= 0) { covered = true; break; }
      }
      if (!covered) picked.push(h);
    }
    if (!picked.length) picked.push(hits[0]);
    const zh = picked.map((x) => x.zh).join("");
    const en = picked.map((x) => (hairWordFromInput(x.zh) || "")).filter(Boolean).join(" and ");
    const hex = (picked.filter((x) => x.hex)[0] || {}).hex || "";
    return { zh: zh, en: en || zh, hex: hex };
  }
  // v164：把 outfitColorFromText 的「只认贴着服装词的色名」推广成「贴着**任意一组词**」。
  //   发色要认「柿红色的**头发**」，绝不能被同一句里的「圆领袍」抢走 —— 所以近邻词要能换。
  //   before/after 是以命中位置为基准向左/右各放宽多少字（默认 6/6）。
  function _colorNearWord(src, words, before, after) {
    src = String(src || "");
    if (!src || !words || !words.length) return null;
    const b = Number(before) || 6, a = Number(after) || 6;
    const near = (pos, len) => {
      const win = src.slice(Math.max(0, pos - b), Math.min(src.length, pos + len + a));
      for (let i = 0; i < words.length; i++) if (win.indexOf(words[i]) >= 0) return true;
      return false;
    };
    const hits = [];
    let i, p;
    // ① 中国传统色名（带精确 hex，最准）
    for (i = 0; i < CN_TRAD_COLORS.length; i++) {
      const zh = CN_TRAD_COLORS[i][0], hex = CN_TRAD_COLORS[i][1];
      p = src.indexOf(zh);
      while (p >= 0) {
        if (near(p, zh.length)) hits.push({ zh: zh, hex: hex, at: p });
        p = src.indexOf(zh, p + 1);
      }
    }
    // ② 简易中文色词（无 hex，兜底）
    const cz = Object.keys(COLOR_WORD_ZH);
    for (i = 0; i < cz.length; i++) {
      const w = cz[i];
      if (!w) continue;
      p = src.indexOf(w);
      while (p >= 0) {
        if (near(p, w.length)) hits.push({ zh: w, hex: "", at: p });
        p = src.indexOf(w, p + 1);
      }
    }
    if (!hits.length) return null;
    hits.sort((x, y) => x.at - y.at);
    // 去掉互相包含的重复命中（已命中「柿红」就不再单独算「红」）
    const picked = [];
    for (i = 0; i < hits.length && picked.length < 2; i++) {
      const h = hits[i];
      let covered = false;
      for (let j = 0; j < picked.length; j++) {
        if (picked[j].zh.indexOf(h.zh) >= 0 || h.zh.indexOf(picked[j].zh) >= 0) { covered = true; break; }
      }
      if (!covered) picked.push(h);
    }
    if (!picked.length) picked.push(hits[0]);
    const zh = picked.map((x) => x.zh).join("");
    const en = picked.map((x) => (hairWordFromInput(x.zh) || "")).filter(Boolean).join(" and ");
    return { zh: zh, en: en || zh, hex: (picked.filter((x) => x.hex)[0] || {}).hex || "" };
  }

  // 用户设定 + 自动推断 = 这一尊**真正要用**的外形参数
  // rec 可以不传：不传就自己去 localStorage 读这只沁灵的记录（保证任何调用点都拿得到用户设定）
  function lookOf(item, rec) {
    const r = rec || ((item && item.id) ? (load()[item.id] || {}) : {});
    const lk = r.look || {};
    const ap = appearanceOf(item, r.appearanceSeed || 0, r.gender || "", lk);
    const bead = beadColor(item);
    const beadWord = (bead && bead.word) ? bead.word : (COLOR_EN[(item && item.color) || ""] || "jade green");
    const beadHex = (bead && bead.hex) ? bead.hex : "";
    // 发色：用户选了就用用户的；"bead" = 跟珠子；不填 / "auto" = 按外观种子从 12 色里分散挑一个
    // （★ 这一条直接解决"每只沁灵都一个颜色、看起来太像"）
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
    // 服装色：① 用户明确填的 outfitColor ② 用户原话 / 用户确认过的人设里提炼的色名
    // ③ 兜底才跟珠子主色。写了「月白淡紫」就必须出月白淡紫，不能再出棕黄。
    // v164：源里去掉 r.personaZh —— 那是模型按随机参数另写的正文，扫它等于把 AI 编的衣服色当用户要求。
    const _ocSrc = (lk.base || "") + "\n" + (lk.persona || "") + "\n" + (lk.profile || "");
    const _oc = outfitColorFromText(_ocSrc);
    const outfitEn = lk.outfitColor ? hairWordFromInput(lk.outfitColor) : (_oc ? (_oc.en || _oc.zh) : beadWord);
    const outfitZh = lk.outfitColor ? String(lk.outfitColor) : (_oc ? _oc.zh : "");
    const outfitHex = lk.outfitColor ? "" : (_oc ? _oc.hex : "");
    return {
      ap, bead, beadWord, beadHex, hairEn, hairHex, hairSrc, hairZh, outfitEn, outfitZh, outfitHex,
      feats, noFeat, pers,
      base: lk.base || "", profile: lk.profile || "", persona: lk.persona || "", brief: lk.brief || null,
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
    if (!lk || (!lk.chosen && !lk.outfitZh)) return "";
    const hard = [];
    if (lk.hairEn) hard.push(lk.hairEn + " hair color (keep exactly this hair color)");
    // v163b：用户写在人设里的衣服颜色（如「月白淡紫」）压到 prompt 末尾做硬约束，模型对这个位置最敏感
    if (lk.outfitZh) hard.push("outfit color must be " + lk.outfitZh +
      (lk.outfitHex ? " (" + lk.outfitHex + ")" : "") + ", owner specified, do not use any other outfit color");
    if (lk.feats && lk.feats.length) hard.push(lk.feats.map((f) => f.en).join(", "));
    if (lk.noFeat) hard.push("strictly human look: no animal ears, no tail, no wings, no horns");
    if (lk.pers) hard.push(lk.pers.en + " personality, " + lk.pers.face);
    // v130：主人写的一句话/融合后的设定 = 描述**沁灵本人**的硬约束。
    // 用户反馈：写「洒脱的江湖侠士」指的是珠子，结果 AI 安给了主人、立绘也不跟 —— 现在直接进 prompt 末尾硬约束。
    // v164：有出图单时只带**主人原话**（出图单已把关键点拆成结构化字段了，
    //   再塞整段 AI 扩写进去只会稀释指令、还会把扩写里可能编出来的细节带进画面）
    const personaNote = lk.brief ? (lk.base || "") : (lk.persona || lk.profile || lk.base);
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
    // v130：用户的一句话要**融进**设定（描述沁灵本人），不再是"主人说过…"的引用体
    const baseTxt = (lk && lk.base) ? ("它是" + lk.base + "——这是主人一眼就认出来的性子。") : "";
    // v153：色板选出来的色存的是 #hex（用户要求不要中文色名）→ 中文小作文里换成人话
    const hairZhRaw = (lk && lk.hairZh) ? String(lk.hairZh).replace(/^自动 · /, "") : "";
    const hairZhText = /^#/.test(hairZhRaw) ? "主人亲手挑的一种颜色" : (hairZhRaw || beadZh);
    return nm + "是从主人那串「" + ((item && item.name) || "手串") + "」里醒过来的小沁灵。" +
      "它的头发是" + hairZhText + "，" + hairTxt + "；" +
      (featTxt ? featTxt + "；" : "") +
      "衣服的色调跟着珠子的" + beadZh + "走，看久了很安稳。" +
      "性子偏「" + persTxt + "」，平时话不多，但主人一伸手它就会靠过来。" + baseTxt;
  }
  // 用文字模型把"一句基础设定 + 选项"扩写成一小段（失败就退回本地模板）
  // v164：这段扩写 = 用户流程里「AI 润色的人设」，是要给用户**确认**、并最终显示在详情页的正稿。
  //   铁律：只把主人写的东西**扩展润色**，绝不替换、绝不凭空调色/加道具。
  //   （旧版把随机外观池的服装写进去、还让 AI 自由加持物，于是卡片上冒出「灯笼、花、木剑」，
  //     用户写的是柿子 —— 这就是"提取出来跟我说的没半毛钱关系"的根源）
  async function expandProfile(item, lk, persona) {
    const local = profileLocal(item, lk, persona);
    const base = (lk && lk.base) ? String(lk.base).trim() : "";
    const r0 = (item && item.id) ? load()[item.id] || {} : {};
    const ap0 = appearanceOf(item, r0.appearanceSeed || 0, r0.gender || "");
    const sys = "你是一个角色设定师。请把主人给出的设定**润色扩写**成一小段中文人物设定，要求：" +
      "① 只写 150-260 字，一段话，不要标题、不要分点、不要引号；② 必须体现：外貌（发色 / 特殊特征）、性格、和主人以及这串珠子的关系；" +
      "③ 口吻温柔、有画面感，像手账里的备注；④ 不要出现「AI」「提示词」「角色设定」这类词；" +
      "⑤【最重要·不许跑偏】主人原话里写到的东西（衣服样式与颜色、头发颜色、发型、手里拿的东西、神态、性别称呼）" +
      "一律**照写、只在原来的意思上加细节**，绝不许替换成别的东西、不许改色、不许改样式；" +
      "⑥【不许凭空加道具】主人原话里**没写**手里拿东西，就绝对不要提任何手里拿的物件（不许写灯笼、花、木剑、扇子之类）；" +
      "主人写了什么就写什么，一件不多一件不少；" +
      "⑦ 主人写的那句话描述的是**沁灵本人**的性格/身份/气质（例如「洒脱的江湖侠士」＝这只沁灵是侠士，不是主人是侠士），" +
      "必须自然融进正文，让整段读起来是一份完整统一的设定，不要引用原话、不要说「主人说过」、不要写成两套人设；" +
      "⑧ 沁灵的性别以下方标注为准，指代沁灵的代词绝不能用错；" +
      "⑨【发色、瞳色、特殊特征照下方给定内容写；但**发型自由发挥**】中式古风发型多种多样（长直发、发髻、发冠、马尾、辫子、披发都可以），" +
      "按沁灵的性别/性格/主人写的设定来定，不要生硬套短发（主人原话写了发型就照他写的）；" +
      "发色若给的是中国传统色名（胭脂、天青、月白、秋香、藕荷、柿红、黛色等），正文里就用这个名称来写，不要改成现代色号；" +
      "⑩【服装风格按这只沁灵自己的意象/名称/材质/胎性自定】（如玉/木/石/金属质感、石窟造像与壁画纹样、" +
      "敦煌飞天披帛与璎珞、飘带等皆可），保持古典东方气质即可，⛔ 不必一律汉服；" +
      "⛔ 仍绝对禁止现代/西式服装（夹克、运动服、卫衣、T恤、牛仔裤、西装等）；" +
      "⛔ 也别把衣服写成与它自身出处无关的通用古装 —— 若它的意象/品类明显不属于中原衣冠，就顺着那个意象写；" +
      "⑪【姿态自由发挥、不要摆拍】可写一个自然的中式仪态（作揖、拱手、拂袖、团扇半遮面、低眸捻珠、执笔、捧盏、展卷等），" +
      "双手位置要简单清楚、不要遮叠手臂或复杂手势（否则出图容易画成三只手 / 多指），不要现代随意手势或 wink。";
    const NL = String.fromCharCode(10);
    const user = "沁灵名：" + ((persona && persona.name) || item.name || "小沁灵") +
      NL + spiritGenderLine(ap0) +
      NL + "来自手串：" + ((item && item.name) || "") + (item && item.craft ? "（" + item.craft + "）" : "") +
      NL + "发色（中国传统色名）：" + (((lk && lk.hairZh) ? String(lk.hairZh).replace(/^自动 · /, "") : "") || "跟珠子主色") +
      // v165：把「名称 / 品类 / 胎性」喂给文本模型 —— 此前这三样完全不进出图链路，
      //   是「服装跟这只沁灵没关系」的根因之一（服装只能从通用汉服池里随机抽）。
      NL + "它的出处/意象（服装风格要顺着这个来）：" + ((item && item.name) || "未命名") +
      NL + "品类：" + ((item && (item.species || item.category)) || "未标注") +
      NL + "胎性：" + tiXingLabel(item) +
      NL + "服装参考（**主人原话写了衣服就以原话为准**；没写就按上面那只沁灵自己的意象定，⛔ 不许一律汉服）：" + (ap0.outfitZh || ap0.outfit) +
      NL + "特殊特征：" + ((lk && lk.feats && lk.feats.length) ? lk.feats.map((f) => f.zh).join("、") : ((lk && lk.noFeat) ? "普通人形" : "未指定")) +
      NL + "性格：" + ((lk && lk.pers) ? lk.pers.zh : "未指定") +
      (base ? (NL + "【主人原话·最高优先级，一字不许跑偏】" + base) : "") +
      NL + ownerLine() + NL + "请写这一小段设定。";
    try {
      const txt = (await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 500) || "").trim();
      const clean = txt.replace(/^["「]|["」]$/g, "").replace(/\s*\n+\s*/g, "").trim();
      if (clean && clean.length >= 40) return { text: clean, ai: true };
    } catch (e) { /* 没 key / 失败 → 本地模板 */ }
    return { text: local, ai: false };
  }
  function promptFor(item, styleKey, stage, appearance, look, opts) {
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    // 颜色：优先用 **用户在「设定向导」里确认过的发色**；没设过才用"从手串照片里采到的真实主色"，
    // 再拿不到才退回颜色分类（v127：用户反馈"颜色读不准、每只都太像"→ 现在可确认、可改、可按种子分散）
    const lkRaw = look || lookOf(item, null);
    // v164：**用户确认过的出图单优先** —— 掐掉随机外观池里跟它打架的项
    //   （用户写了「手握柿子」，随机抽到的「提着小灯」就不能再出现在提示词里）
    const _ab = applyBrief(lkRaw, appearance || appearanceOf(item, 0));
    const lk = _ab.lk;
    const ap = _ab.ap;
    const color = lk.hairEn;
    const outfitColor = lk.outfitEn;
    const colorHint = (lk.hairHex ? (", the exact hair color is " + lk.hairHex) : "") +
      (lk.outfitHex ? (", the exact outfit color is " + lk.outfitHex) : "") +
      // 用户自己指定了衣服颜色时，绝不再让"跟珠子主色"把它顶掉（旧逻辑出棕黄的元凶）
      (!lk.outfitZh && !(lk.brief && lk.brief.outfitZh) && lk.beadHex ? (", sampled from the real bracelet: " + lk.beadHex + ", keep the outfit close to this color") : "");
    const soft = SOFT_EN[item.softness || ""] || SOFT_EN[""];
    const isChar = (key === "anime");          // 日漫 Q 版角色：颜色落在头发/衣服上
    const stageObj = stageDef(stage == null ? 1 : stage);         // 该形态（外形 + 比例锁定块）
    const stageLook = (opts && opts.legacy)
      ? (LEGACY_STAGE_LOOKS[Math.min(4, Math.max(1, Number(stage) || 1)) - 1] || stageObj.look)
      : stageObj.look;                                           // 该形态的外形描述（进阶的核心）
    // legacy：恢复 v164c 之前的旧立绘时才用旧版写死的成长描述（且末尾不挂比例锁定块）
    const growth = (opts && opts.legacy) ? LEGACY_GROWTH_LINE : growthLine(stage == null ? 1 : stage);
    const propLock = (opts && opts.legacy) ? "" : (stageObj.prop ? (", " + stageObj.prop) : "");
    let cmp;
    if (isChar) {
      // 先写死"这个人是谁"（外观锚点），再写"他现在多大"（形态描述）→ 深沁只会长大，不会换人
      // 注意：这里始终是**立绘**（全身角色图、干净背景），四个阶段都有立绘；
      //      蜕形/化形**额外**再出一张 CG（场景插画），见 promptForCg（v125）。
      cmp = appearancePrompt(ap) + ", with " + color + " hair and " + outfitColor + " themed outfit" + colorHint +
        lookExtra(lk) + ", " + stageLook + ", " +
        "full body character illustration, standing pose, whole body visible from head to toe, " +
        "detailed outfit and shoes, vertical composition, " +
        // v165-F：非 legacy 立绘一律"占满画幅"（旧的"舒适留白"把人物画小 → 比例被视觉压矮）
        ((opts && opts.legacy) ? FRAME_FILL_OLD : FRAME_FILL);
      // v165-F（根因②）：非 legacy 且高阶形态 —— 掐掉开场身份锚里的幼态残留
      //   "a young boy character, clearly male, boyish face" 出现在 prompt **位置 0**（权重高），
      //   与后面 "teenage/adult version" 直接打架、抵消末尾的强负向；只替换这一句，其余身份锚（瞳色/配饰/服装）不动。
      if (!(opts && opts.legacy)) {
        const _sN = Math.min(4, Math.max(1, Number(stage) || 1));
        if (_sN >= 3) {
          cmp = cmp.replace(AGE_OPEN_BOY_OLD, AGE_OPEN[_sN].boy).replace(AGE_OPEN_GIRL_OLD, AGE_OPEN[_sN].girl);
        }
      }
    } else {
      cmp = "a " + (ap.gender === "boy" ? "boy" : "girl") + " creature mascot whose body color is " + color + colorHint +
        ", wearing " + ap.acc + ", " + ap.vibe + " personality, " + stageLook + ", " +
        "full body creature illustration, whole body visible, centered with comfortable margin";
    }
    // v167-B：legacy 逐字节复刻 —— 把去清代时改过的两条 OUTFITS 的 en 换回旧串
    if (opts && opts.legacy) {
      for (let _li = 0; _li < LEGACY_OUTFIT_EN.length; _li++) {
        cmp = cmp.split(LEGACY_OUTFIT_EN[_li].now).join(LEGACY_OUTFIT_EN[_li].old);
      }
    }
    const bits = [cmp, GUOFENG, ANATOMY, soft, SINGLE, CONSISTENCY, growth, NEG_STYLE];
    // v167-B：仙侠/汉服正向形制 —— 非 legacy 紧跟 GUOFENG 之后
    if (!(opts && opts.legacy)) bits.splice(2, 0, XIANXIA_LOOK);
    // v112：把「人物设定 → 形象细节关键词」也拼进去，立绘不再"只有颜色"
    const tags = getLookTags(item);
    if (tags) bits.push(lk.chosen
      ? ("extra outfit and texture details (colors and features are already fixed above, do not change them): " + tags)
      : ("extra character design details: " + tags));
    const hard = lookHard(lk);
    if (hard) bits.push(hard);
    // v164：用户确认过的出图单压在最末尾（模型对最后出现的关键词最敏感）——"确认的就是画出来的"
    const bHard = briefHard(lk);
    if (bHard) bits.push(bHard);
    if (item.softness === "soft") bits.push(isChar ? "round soft cheeks, relaxed happy sleepy eyes" : "round blob-like silhouette, soft chewy texture");
    if (item.softness === "slight") bits.push(isChar ? "calm gentle eyes, neat tidy look" : "slightly squishy but mostly smooth silhouette");
    // v166：立绘表情变体 —— 在 prompt 末权重高处追加神态锚点（base 不加，保持现有中立立绘）
    if (opts && opts.expr && EXPR_BY_KEY[opts.expr] && opts.expr !== "base") {
      const _exa = EXPR_BY_KEY[opts.expr].en;
      if (_exa) bits.push(_exa);
    }
    // v164c：风格预设 `st` 里全是成人/少年措辞（big expressive eyes / richly detailed outfit / full body），
    //   它是 prompt 结尾权重最高的一段，却对"几头身"零约束 —— 这正是凝形被画成少年的第二个元凶。
    //   所以**比例锁定块必须压在 `st` 之后、占据最末尾**（briefHard 只管服饰/发色/持物/神态，从不谈比例，两者不冲突）。
    //   legacy（恢复旧立绘）时末尾不挂比例锁定块，精确复刻 v164c 之前的 prompt。
    // v165-F（根因③）：中文比例锚 —— 仅 ark（豆包 Seedream），压在**整条 prompt 最末尾**（propLock 之后）。
    //   国产模型对中文指令的理解与执行力通常强于英文；其它 provider 不保证中文理解力 → 不追加。
    // v167-B：再加中文服装锚（COSTUME_ZH），同一开关 zhAnchorEnabled()。
    const _nonLegacy = !(opts && opts.legacy);
    const _zh = (isChar && _nonLegacy && zhAnchorEnabled());
    const zhAnchor = _zh ? (", " + proportionZhFor(stage == null ? 1 : stage)) : "";
    const zhCostume = _zh ? (", " + COSTUME_ZH) : "";
    // v167-B：清代服饰强禁挂**整条 prompt 最末尾**（最高权重）
    const noQing = _nonLegacy ? (", " + NO_QING) : "";
    return bits.join(", ") + ", " + st + propLock + zhAnchor + zhCostume + noQing;
  }
  // 用「v164c 之前的旧 prompt」精确还原当时的出图 URL —— 用于「恢复旧立绘」，把被 prompt 改动洗掉的旧图找回来。
  // 与旧版显示路径一致：不传 appearance / stage（旧显示走的就是默认外观 + 第 1 阶），才能精确复刻当时浏览器请求的那个 URL。
  function legacyPollinationsUrl(item, variant, styleKey, stage, appearance) {
    const style = styleKey || getImageCfg().style || DEFAULT_STYLE;
    return "https://image.pollinations.ai/prompt/" + encodeURIComponent(promptFor(item, style, stage, appearance, null, { legacy: true })) +
      "?width=512&height=512&nologo=true&seed=" + seedOf(item.id, variant);
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
    // v166：表情变体 → 派生独立稳定种子（base/换形象用 variant；表情用 EXPR_SALT_BASE+idx），保证「同一只只是表情不同」
    const _exprKey = (opts && opts.exprKey) || "";
    const _exprSalt = (_exprKey && EXPR_BY_KEY[_exprKey]) ? (EXPR_SALT_BASE + EXPR_LIST.indexOf(EXPR_BY_KEY[_exprKey])) : (variant || 0);
    const _promptOpts = Object.assign({}, opts, { expr: _exprKey });
    if (info.keyless) return { url: pollinationsUrl(item, _exprSalt, styleKey, stage, ap), kind: "url" };
    if (!info.key) throw new Error("还没填 API Key");
    if (!info.endpoint) throw new Error("还没填接口地址");
    const prompt = promptFor(item, styleKey || cfg.style || DEFAULT_STYLE, stage, ap, null, _promptOpts);
    const size = cfg.size || DEFAULT_SIZE;
    const seed = seedOf(item.id, _exprSalt);   // 同一尊沁灵用固定种子 → 各形态看起来是同一个"人"在长大
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
      if (isSizeErr(msg)) throw new Error("尺寸不被这个模型接受（" + msg + "）。请到 设置 → 沁灵形象 把「出图尺寸」换成「竖版立绘 3:4」再试。");
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
    // v164h：方舟默认返回 **24 小时就过期的临时外链**，而浏览器去下载它又被 CORS 拦死
    //   （urlToDataUri 下载不到 → 只能存外链 → 20 小时后判过期 → 自动重出一遍 = 天天白烧钱）。
    //   直接要 b64_json：图片字节就在 POST 响应里，不碰 CDN、不碰 CORS，落库走永久保存（云存储/data URI）。
    //   个别模型不认这个字段会报错 → 按服务商记住后去掉重试一次（与下面水印字段同一套模式）。
    if (isArk && !fixedOf("b64", pk)) payload.response_format = "b64_json";
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
      // v164h：模型不认 response_format=b64_json → 记住后去掉重试一次（回落到外链模式，至少不坏）
      if (payload.response_format === "b64_json" &&
          /response_format|b64|Unknown parameter|未知参数|不支持的参数/i.test(msg)) {
        markFixed("b64", pk);
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

  /* ---------- 本地兜底形象：程序化画一个 2D 小沁灵（断网也有形象） ---------- */
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
    soft: ["最会疼人的", "一团软乎乎的伴儿", "心口上的暖手宝", "慢慢来的小懒虫"],
    slight: ["温润的小先生", "沉得住气的老友", "安安静静的伴儿", "有点闷骚的家伙"],
    "": ["沉得住气的老友", "安安静静的伴儿", "低调的闷葫芦", "闷声发财派"],
  };
  const TRAITS_BY_SOFT = {
    soft: [["爱睡", "护食", "一逗就笑"], ["慢吞吞", "怕冷", "喜欢暖和地方"], ["黏人", "爱撒娇", "一哄就好"]],
    slight: [["安静", "有耐心", "认人"], ["话少", "爱观察", "偶尔毒舌"], ["克制", "讲究", "爱干净"]],
    "": [["沉静", "可靠", "什么都不说"], ["佛系", "随缘", "爱晒太阳"], ["慢热", "识货", "嘴硬心软"]],
  };
  const LINE_BY_SOFT = {
    soft: ["你一对我好，我就想腻着你。", "别急呀，慢慢来，我们有的是时间。", "今天也可以什么都不做，就靠着你。"],
    slight: ["我不用你天天惦记，也会一直在。", "你忙你的，我在这儿等你。", "真心经得起等。"],
    "": ["我在。", "你想起来的时候，我都在。", "不吵不闹，日子久了就熟了。"],
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
    const rec = ensureIn(store, item.id, item);
    if (!force && rec.persona) return rec.persona;
    let p = null;
    if (getAiKey()) {
      try {
        const sys = "你在为一个文玩收藏 App 写「沁灵」的设定。刚盘到挂瓷的手串会开沁，变成一尊 Q 版小生物。"
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

  /* ---------- 小剧场：几个沁灵互相聊 ---------- */
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
      const sys = "你在写一个文玩 App 里的「沁灵小剧场」：主人的几串手串盘到挂瓷后变成了小生物，它们会背着你聊天。"
        + "请写一段 4-6 句的日常小对话，轻松、可爱、有生活感、带点小吐槽，不要煽情，不要解释。"
        + "严格只输出 JSON：{\"lines\":[{\"who\":\"沁灵名字\",\"text\":\"说的话\"}]}";
      const user = "出场沁灵：\n" + spirits.map((s) => spiritDesc(s.item, s.persona)).join("\n") + "\n" + ownerLine() + "\n请写它们今天的小剧场。";
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

  /* ---------- 来信：沁灵给你写一封信 ---------- */
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
    return (userName ? userName + "：" : "") + "\n\n" + body + "\n\n—— 你的" + (p.name || "小沁灵") + "（" + t + "）";
  }
  async function letter(spirit, userName) {
    if (!getAiKey()) return localLetter(spirit, userName);
    try {
      const sys = "你在写一封「沁灵」写给主人的短信。沁灵是主人收藏的一串手串盘到挂瓷后变成的小生物，"
        + "性格可爱、有点小脾气、关心主人但不会说教。用第一人称，简体中文，80-140 字，口语化，"
        + "落款写沁灵名字。不要用 Markdown 标题，不要解释。";
      const user = "沁灵设定：" + spiritDesc(spirit.item, spirit.persona) +
        (spirit.idleDays != null ? ("\n它已经 " + spirit.idleDays + " 天没被盘了。") : "") +
        "\n" + ownerLine(userName) + "\n请写这封短信。";
      const txt = await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 500);
      if (txt) return txt;
    } catch (e) { /* 兜底 */ }
    return localLetter(spirit, userName);
  }

  /* ============================================================
   * v109：中文人物设定 / 沁灵日记 / 房间剧情
   * ============================================================ */
  /* ---------- 主人设定（v111：性别/昵称，写日记和剧情时必须遵守） ---------- */
  const OWNER_KEY = "ww_owner";            // { name: "小北", gender: "girl" | "boy", avatar: "data:image/jpeg;base64,…" }
  function getOwner() {
    try {
      const o = JSON.parse(localStorage.getItem(OWNER_KEY) || "{}");
      return {
        name: String((o && o.name) || ""),
        gender: (o && o.gender) === "boy" ? "boy" : "girl",
        avatar: String((o && o.avatar) || ""),
      };
    } catch (e) { return { name: "", gender: "girl", avatar: "" }; }
  }
  function setOwner(o) {
    const cur = getOwner();
    const next = {
      name: o && o.name != null ? String(o.name) : cur.name,
      gender: (o && o.gender) ? o.gender : cur.gender,
      avatar: o && o.avatar != null ? String(o.avatar) : cur.avatar,
    };
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
  // v130：沁灵**自己**的性别也要写明（用户反馈：男沁灵芭蕉叶被写成「她」——之前只交代了主人的代词，
  //      AI 就把「她」顺手安给了沁灵）。ap 里有 gender（boy/girl）。
  function spiritGenderLine(ap) {
    const boy = !ap || ap.gender !== "girl";
    const g = boy ? "男孩子" : "女孩子";
    const sp = boy ? "他" : "她";      // 沁灵代词
    const op = boy ? "她" : "他";      // 主人代词
    return "【沁灵性别】这只沁灵本身是" + g + "，全文指代这只沁灵时必须且只能用「" + sp + "」；" +
      "「" + op + "」只能用来指主人（杯杯），绝不能用来指这只沁灵。" +
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
  // 用户在向导里手动指定珠子/沁灵颜色时，直接写进这份采样表（带 src:"user" 标记）
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
      (p.name || item.name || "这只沁灵") + "的原型是主人收藏的一串「" + (item.name || "手串") + "」，" + colorName + "，" + softName + "。" +
      "盘到挂瓷的那天晚上，它从珠子里醒了过来，现在是一尊" + def.name + "的" + (ap.gender === "boy" ? "小男孩" : "小女孩") + "沁灵。",
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
    const rec = ensureIn(store, item.id, item);
    const lk0 = rec.look || {};
    // v164：用户**亲手确认过**的人设（look.persona）就是最终稿 —— 原样返回，不再叫 AI 重写。
    //   理由：用户流程是「我写设定 → AI 扩写 → 我确认 → 出图」，那这段确认稿必须
    //   ① 原样显示在详情页 ② 也是出图 brief 的提取源。若这里再让 AI 生成一遍，
    //   就会出现「我确认的」和「详情页显示的」不是同一段字（用户最反感的一点）。
    if (!force && lk0.persona) {
      if (rec.personaZh !== lk0.persona) {
        rec.personaZh = lk0.persona;
        rec.personaZhKey = "user|" + (lk0.personaAt || 0);
        rec.personaZhAt = Date.now();
        save(store);
      }
      return lk0.persona;
    }
    // 缓存键带上用户的一句话/融合设定：改了设定 → 人设卡跟着重写（否则立绘换了设定卡还是旧的）
    // v154 前缀 = 规则再升级（纹样改「人设优先，池子兜底」），旧人设卡作废重写一遍
    //   —— 顺带把纹样并进缓存键：以后换纹样，人设正文也会跟着重写，不会再出现"标签是芭蕉叶、正文还写着水波"
    const key = "v154|" + (ap.gender || "") + "|" + ap.hair + "|" + ap.eyes + "|" + ap.acc + "|" + ap.pattern + "|" + (item.color || "") + "|" + (persona && persona.name || "") +
      "|" + (lk0.base || "") + "|" + (lk0.profile || "") + "|" + (lk0.hairc || "") + ":" + (lk0.customColor || "");
    if (!force && rec.personaZh && rec.personaZhKey === key) return rec.personaZh;
    let txt = "";
    if (getAiKey()) {
      try {
        const sys = "你在为一个中文文玩收藏 App 写「沁灵」的人物设定卡。手串盘到挂瓷会开沁，变成一尊小沁灵。"
          + "请写一段连贯的中文人物设定，200-300 字，用第三人称旁观介绍（不要用「你」称呼沁灵），"
          + "必须包含：① 外形（性别、发型、瞳色、配饰；衣服/头发颜色要说明取自古珠的颜色）"
          + "② 性格（含 2-3 个具体小习惯）③ 与主人的关系与日常"
          + "④ 一个自然的标志性仪态 / 小动作（中国古风优先：作揖、拱手、拂袖、团扇半遮面、低眸捻珠、执笔、捧盏、展卷等）；"
          + "写仪态时双手位置要简单清楚、不要遮叠手臂或复杂手势（否则出图容易画成三只手 / 多指），也不要现代随意手势或 wink。"
          + "【瞳色/服装/配饰照下方给出的「固定人设」写；但**发型不受限制、自由发挥**】"
          + "中式古风发型多种多样（长直发、发髻、发冠、马尾、辫子、披发都可以），按沁灵的性别、性格和主人写的设定来定，"
          + "绝不要因为固定人设里没写发型、就生硬地套一个短发。"
          + "【发色用中国传统色名写】下方若给出「它的发色」（如胭脂、天青、月白、秋香、藕荷、黛色），正文里就用这个中国色名来写头发颜色。"
          + "【服装风格按这只沁灵自己的意象/名称/材质/胎性自定】（如玉/木/石/金属质感、石窟造像与壁画纹样、"
          + "敦煌飞天披帛与璎珞、飘带等皆可），保持古典东方气质即可，⛔ 不必一律汉服；"
          + "⛔ 若它的意象/品类明显不属于中原衣冠，就顺着那个意象写，别套通用古装；"
          + "绝对禁止出现任何现代/西式服装（夹克、运动服、卫衣、T恤、牛仔裤、西装、风衣等）。"
          + "【最重要】主人给的设定原话描述的都是**沁灵本人**的性格/身份/气质，必须原样体现在沁灵身上；"
          + "绝对禁止把设定安到主人头上（例如主人说「洒脱的江湖侠士」＝沁灵是侠士，不是主人是侠士），也不许另编一套和原话冲突的人设。"
          + "语气温和好读，不要 Markdown、不要标题、不要分点、不要解释，直接输出正文。";
        const lkP = lookOf(item, rec);      // v153：用户从色板选的发色也要交代给模型
        const hairCn = String(lkP.hairZh || "").replace(/^自动 · /, "");
        const hairEnW = lkP.hairEn || "";
        // v165：追加 名称/品类/胎性（同 4a，理由一致：服装此前与这只沁灵无任何关联）
        const user = "原型手串：" + (item.name || "未命名") + "；沁灵的名字：" + ((persona && persona.name) || item.name || "未命名") +
          "；它的出处/意象（服装风格要顺着这个来）：" + (item.name || "未命名") +
          "；品类：" + ((item && (item.species || item.category)) || "未标注") +
          "；胎性：" + tiXingLabel(item) +
          "；珠子颜色：" + (COLOR_ZH[item.color] || "素色") +
          "；它的发色：" + (hairCn ? (hairCn + (hairEnW ? "（" + hairEnW + "）" : "")) : (hairEnW || (COLOR_ZH[item.color] || "素色"))) +
          "；软糯：" + (item.softness === "soft" ? "软糯" : item.softness === "slight" ? "微糯" : "未标注") +
          "；形态：" + stageDef(stage).name + "；陪伴 " + (days || 0) + " 天；盘玩 " + (plays || 0) + " 次；" +
          "固定人设（瞳色/服装/配饰照写；发型自由发挥，下方不含发型限制）：" + appearanceText(ap) + "；" + spiritGenderLine(ap) +
          "；性格基调：" + (VIBE_ZH[ap.vibe] || ap.vibe) +
          ((persona && persona.traits && persona.traits.length) ? "（" + persona.traits.join("、") + "）" : "") +
          ((lk0.base) ? "。\n主人给它的设定原话（描述的是沁灵自己，必须原样体现）：" + lk0.base : "") +
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

  /* ---------- 沁灵日记（不定时写，**每天最多 1 篇**） ---------- */
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
        const sys = "你在写「沁灵」的日记。沁灵是主人收藏的手串盘到挂瓷后变成的小生物，用第一人称写，"
          + "简体中文，60-140 字，口语化、可爱、有生活细节，不要 Markdown、不要标题、不要解释，直接写正文。"
          + "注意：主人的性别必须按下面给的信息来写（称呼别搞错）。";
        const user = "沁灵设定：" + spiritDesc(item, p, rec.stage) + "；人设：" + appearanceText(ap) +
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
      const r2 = ensureIn(store, item.id, item);
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
      ensureIn(store, item.id, item).diary = rec.diary;
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

  /* ---------- 公共：模板变量替换 ----------
     v163：老 9 个键保留原链**逐字不动**（保证老台词一字不变）；
           新增占位符（{bondlv}{bond}{species}{room}{tixing}{胎性}…）走通用替换。 */
  function fmt(tpl, v) {
    const s = String(tpl == null ? "" : tpl)
      .replace(/\{days\}/g, v.days).replace(/\{idle\}/g, v.idle).replace(/\{plays\}/g, v.plays)
      .replace(/\{color\}/g, v.color).replace(/\{stage\}/g, v.stage).replace(/\{bead\}/g, v.bead)
      .replace(/\{call\}/g, v.call).replace(/\{name\}/g, v.name).replace(/\{year\}/g, v.year || "");
    return s.replace(/\{([^{}]+)\}/g, (m, k) => (v[k] != null && v[k] !== "") ? String(v[k]) : m);
  }
  // v165 批次3A-4：{ta} = 本节点 rset 的键所对应的行当名；无 rset 时回落「那只」（⛔ 绝不写「它」）
  // 由 chapWalk / chapTalkChoose 在进入节点前写入（模块级瞬时值，不进存档）
  let _chapTa = "";
  function chapTaSet(rset) {
    let k = "";
    if (rset && typeof rset === "object") { for (const kk in rset) { k = kk; break; } }
    _chapTa = k ? chapTaNameOf(k) : "";
    return _chapTa;
  }
  function chapTaGet() { return _chapTa || "那只"; }
  // persona id → 行当名（取该 persona 在册那只的名字；缺则回落「那只」）
  function chapTaNameOf(pid) {
    const key = String(pid || "");
    // v172：{ta} 跟随选角 —— 取「出场表里该行当当下由哪只扮」的名字，
    //   ⛔ 与立绘指向同一只（老链路 chapRecByPersona 按入藏序取，会和立绘不是同一只）。
    try {
      const c = (castOf() || {})[key];
      if (c && c.id) {
        const nm = castDispNameOf(c.id, load()[c.id]);
        if (nm) return nm;
      }
    } catch (e) { /* 静默 */ }
    // 老链路回落（出场表查不到时，行为与 v165 逐字一致）
    const st = load();
    const rec = chapRecByPersona(key, st);
    if (rec) {
      const nm = (rec.persona && rec.persona.name) || "";
      if (nm) return nm;
    }
    return "那只";                 // ⛔ 兜底是「那只」，绝不写「它」
  }

  function greetVars(item, rec, ctx) {
    const bond = bondOf(rec, ctx);
    const bl = bondLevel(bond);
    const tx = tiXingOf(item);
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
      // v163 新增（全小写无分隔，不混驼峰；台词里 {tixing} 与 {胎性} 等价）
      bond: bond, bondlv: bl.name, bondname: bl.name,
      species: (item && (item.species || item.category)) || "",
      room: (ctx && ctx.roomCount != null) ? String(ctx.roomCount) : "",
      tixing: TIXING_ZH[tx] || "杂胎",
      "胎性": TIXING_ZH[tx] || "杂胎",
      // v165 批次3A-4：{ta} 动作对象指代（行当名 / 回落「那只」）
      ta: chapTaGet(),
    };
  }


  /* ---------- ① 每日问候（一天一句，按情境挑；纯本地） ---------- */
  const GREET = {
    // 刚开沁的头几天
    born: [
      "刚醒过来，手心还是热的。以后就跟着你了。",
      "我认得你的手 —— 就是刚才把我盘热的那个。",
      "我还在学怎么当一个好沁灵。你多担待。",
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
    // 快能深沁了
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
  // v165：羁绊 8 档（照面0 / 眼熟12 / 相熟30 / 同室55 / 通意90 / 同心140 / 相知200 / 沁透280）
  //   ⚠️ 由旧 6 档升级：rec.bond 是绝对值，本表只改阈值、不改结构 → 老用户不掉档，只是提前到达同档。
  const BOND_LEVELS = [
    { n: 0, name: "照面", icon: "🌱" },
    { n: 12, name: "眼熟", icon: "🌿" },
    { n: 30, name: "相熟", icon: "🍃" },
    { n: 55, name: "同室", icon: "🏮" },
    { n: 90, name: "通意", icon: "💛" },
    { n: 140, name: "同心", icon: "💞" },
    { n: 200, name: "相知", icon: "🪷" },
    { n: 280, name: "沁透", icon: "🪢" },
  ];
  const BOND_YOU_LV = 4;        // 档 4「同室」起 → 称「你」
  const BOND_NICK_LV = 7;       // 档 7「相知」起 → 称昵称 {nick}
  // v165：BOND_CALL_AT 由 60 → 90（对齐新「通意」）。⚠️ 旧「单档改口」语义已被 callFor 的三档取代，
  //   此值仅供既有 UI（bondLevel().canCall / 详情页改口提示）向后兼容；⛔ 新路径一律走 callFor。
  const BOND_CALL_AT = 90;
  // v165：岁除滋养贡献（v165 §5.2 表②，只读派生；按 1-based 档位取）0/8/18/30/46/64/86/110
  const BOND_VAL = { 1: 0, 2: 8, 3: 18, 4: 30, 5: 46, 6: 64, 7: 86, 8: 110 };
  // v165 §5.4：亲密度 / 送礼 / 照料 / 心意 / 恋爱 / 受伤 —— 集中配置（⛔ 不许在别处散落硬编码）
  const BOND_CFG = { PER_DAY: 1, PLAY_DAILY: 2, LOOKBACK: 90 };   // 陪伴/共修（第二批接入 settleBond）
  const GIFT_CFG = { BOND: 4, BOND_HIT: 6, DAILY_GLOBAL: 2, DAILY_PER: 2, QUALIFY_LV: 3, SECOND_DISCOUNT: 0.5 };
  const CARE_CFG = { EACH: 2, DAILY_MAX: 6 };                     // 照料三式（第二批接 UI）
  const HEART_CFG = { MAX: 300, FREEZE_DAYS: 30 };
  const LOVE_CFG = { STAGE_MIN: 4, BOND_LV_MIN: 7 };
  const HARM_CFG = { BOND_SLOW: 0.5, APPLY: true };               // v165d：带伤期间亲密度获取 ×0.5（启用，不清零不倒扣；不参与 scattered 判定）
  function bondLevel(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    let i = 0;
    for (let k = 0; k < BOND_LEVELS.length; k++) if (v >= BOND_LEVELS[k].n) i = k;
    const cur = BOND_LEVELS[i], next = BOND_LEVELS[i + 1] || null;
    const top = next ? next.n : cur.n;
    return {
      value: v, lv: i, lv1: i + 1, name: cur.name, icon: cur.icon,   // lv=0-based(兼容旧码) / lv1=1-based(新码一律用 lv1)
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

  // v165：八档称呼（v165 §七 称呼表；回落链 lovecall → {nick} → 「你」→「主人」）
  //   1-3 档「主人」／4-6 档「你」／7-8 档昵称；lovecall 非空最高优先（恋爱专属，逐串）。
  //   7-8 档昵称：逐串 rec.nickCall（既有）优先 → 全局玩家昵称（参数 nickname / ww_owner.name）→「你」。
  //   ⛔ {nick} 未填一律回落「你」，绝不回落「主人」。占位符全 ASCII。
  function callFor(rec, nickname) {
    const r = rec || {};
    const lc = String(r.lovecall || "").trim();
    if (lc) return lc;
    const lv1 = bondLevel(Number(r.bond) || 0).lv1;
    if (lv1 >= BOND_NICK_LV) {
      let nick = String(r.nickCall || "").trim();
      if (!nick) {
        if (nickname != null) nick = String(nickname).trim();
        else { try { nick = String((getOwner() || {}).name || "").trim(); } catch (e) { nick = ""; } }
      }
      return nick || "你";
    }
    if (lv1 >= BOND_YOU_LV) return "你";
    return "主人";
  }
  // 该串当前档位对应的岁除滋养贡献（只读，v165 §4.2）
  function nurtureOf(rec) { const lv1 = bondLevel(Number((rec || {}).bond) || 0).lv1; return Number(BOND_VAL[lv1]) || 0; }

  /* ---------- v165 送礼系统（数据层与纯函数；⛔ 本批不接 UI） ---------- */
  // 6 类礼物（v165 §3.2）。name/desc 为 v165e §13.3 文案层**正式稿**（key/cls 不变；⛔ 描述无价、无买卖腔、无物化动作）。
  const GIFT_CLASSES = ["cloth", "sound", "ware", "odd", "tough", "human"];  // 织物/声响/器物/奇异/坚韧/人情
  const GIFT_CATALOG = {
    "cloth_pa":    { cls: "cloth", name: "一方旧帕",   desc: "洗过许多回，边角磨得软，还留着一点焐过的暖。" },
    "cloth_stone": { cls: "cloth", name: "一枚暖手石", desc: "揣在怀里焐热的，递过来时是温的；石上有一道浅浅的手纹。" },
    "sound_bell":  { cls: "sound", name: "一只旧铜铃", desc: "一晃就响，声不大，脆；铃舌上磨出一圈亮。" },
    "sound_drum":  { cls: "sound", name: "一面小拨鼓", desc: "巴掌大的鼓，指头一拨，咚一声；鼓面绷得紧。" },
    "ware_cup":    { cls: "ware",  name: "一只旧茶则", desc: "量茶用的老器物，口沿被磨得圆润。" },
    "ware_ink":    { cls: "ware",  name: "一方素砚",   desc: "没刻花的砚，用了些年，砚池里墨痕淡淡的。" },
    "odd_glass":   { cls: "odd",   name: "一枚琉璃小坠", desc: "光一晃，里头有道细细的彩；转个角度，彩就没了。" },
    "odd_shell":   { cls: "odd",   name: "一枚螺壳",   desc: "贴在耳边听得见海声的那种小螺壳，壳口有一处小缺。" },
    "tough_rope":  { cls: "tough", name: "一段旧皮绳", desc: "结实，越用越顺手；绳结上留着上一个人打的手结。" },
    "tough_whet":  { cls: "tough", name: "一块旧磨石", desc: "什么都能磨，磨自己最慢；石面上凹下去一块。" },
    "human_tea":   { cls: "human", name: "一盏热茶",   desc: "谁都能喝，不偏不倚；热气上来，杯口蒙一层白。" },
    "human_snack": { cls: "human", name: "一碟点心",   desc: "新蒸的，甜的，一碟子；底上垫着一方油纸。" },
  };
  // 15 人格型 → 5 组（v165 §3.2；组即偏好类）
  const PERSONA_GROUP = {
    gentle: "soft", sweet: "soft", sentimental: "soft", scholar: "soft",
    lively: "motion", cheeky: "motion", heroic: "motion", wanderer: "motion",
    cool: "plain", aloof: "plain", dignified: "plain", calm: "plain",
    mystery: "odd", pampered: "odd",
    wild: "wild",
  };
  const GROUP_GIFT = { soft: "cloth", motion: "sound", plain: "ware", odd: "odd", wild: "tough" };
  function giftClsOf(giftKey) { const g = GIFT_CATALOG[String(giftKey || "")]; return g ? g.cls : ""; }
  function giftNameOf(giftKey) { const g = GIFT_CATALOG[String(giftKey || "")]; return g ? g.name : String(giftKey || ""); }
  function giftDescOf(giftKey) { const g = GIFT_CATALOG[String(giftKey || "")]; return g ? (g.desc || "") : ""; }
  function personaIdOf(rec) {
    if (!rec) return "";
    if (rec.look && rec.look.pers) return String(rec.look.pers);
    if (rec.persona && rec.persona.id) return String(rec.persona.id);
    return "";
  }
  // 该串偏好礼类（O(1)）：15 人格 → 组 → 类；未识别人格返回 ""（任何礼物都算未命中 +4）
  function giftPrefOf(rec) {
    const grp = PERSONA_GROUP[personaIdOf(rec)];
    return grp ? (GROUP_GIFT[grp] || "") : "";
  }
  // 单遍扫描库存 → 可递清单（O(n)）；⛔ 禁 O(n²)
  function giftListOf(gifts) {
    const g = (gifts && typeof gifts === "object") ? gifts : {};
    const out = [];
    Object.keys(g).forEach((k) => {
      const n = Math.max(0, Math.floor(Number(g[k]) || 0));
      if (n > 0) out.push({ key: k, count: n, name: giftNameOf(k), desc: giftDescOf(k), cls: giftClsOf(k) });
    });
    return out;
  }
  // 玩家级礼物库存（localStorage，离线优先）；形态 {giftKey: count}
  const GIFTS_KEY = "ww_gifts";
  function loadGifts() { try { const raw = localStorage.getItem(GIFTS_KEY); const o = raw ? JSON.parse(raw) : {}; return (o && typeof o === "object") ? o : {}; } catch (e) { return {}; } }
  function saveGifts(o) { try { localStorage.setItem(GIFTS_KEY, JSON.stringify(o || {})); return true; } catch (e) { return false; } }
  function addGift(gifts, key, n) {
    const g = (gifts && typeof gifts === "object") ? gifts : {};
    const k = String(key || ""); if (!k) return g;
    g[k] = Math.max(0, Math.floor(Number(g[k]) || 0) + (Number(n) || 1));
    return g;
  }
  /* 送出（v165 §三）：判定顺序 ⛔ 先判重 → 再扣库存 → 最后写账（幂等、可重入）。
     命中偏好 +6 / 未命中 +4（human 通用类恒 +4，不偏不倚）；
     同一只当日 ≤ GIFT_CFG.DAILY_PER(=2)、全局当日 ≤ GIFT_CFG.DAILY_GLOBAL(=2)；
     同一礼物对同一只终身 1 次（命中即拦，不扣物、不加分）；未达资格（相熟 30）不扣物。
     v165d：同一只「当天第 2 件」× SECOND_DISCOUNT(=0.5)（只压猛塞同一只，不同串并送不罚）；
            harmed 期间获取 × BOND_SLOW(=0.5)（可用 opts.harmSlow=false 关）。
     入参 gifts 会被扣减、rec 会被写账（与既有 settleBond 同风格）；返回结果对象（不抛）。 */
  function giveGift(gifts, rec, giftKey, opts) {
    opts = opts || {};
    const key = String(giftKey || "");
    const r = (rec && typeof rec === "object") ? rec : {};
    const res = { ok: false, reason: "", delta: 0, hit: false, second: false, giftKey: key, bond: Number(r.bond) || 0, lv1: bondLevel(Number(r.bond) || 0).lv1 };
    if (!key || !GIFT_CATALOG[key]) { res.reason = "no_gift"; return res; }          // 未知礼物：不消耗、不加分
    // 1) 资格：相熟（档 3）起步
    const bondLv = (opts.bondLv != null) ? Number(opts.bondLv) : bondLevel(Number(r.bond) || 0).lv1;
    res.lv1 = bondLv;
    if (bondLv < (opts.qualifyLv != null ? Number(opts.qualifyLv) : GIFT_CFG.QUALIFY_LV)) { res.reason = "locked"; return res; }
    // 2) 判重：同一礼物对同一只终身仅 1 次（⛔ 命中即拦：不扣库存、不加分）
    if (r.giftLog && typeof r.giftLog === "object" && r.giftLog[key] != null) { res.reason = "dup"; return res; }
    // 3) 同一只当日上限（≤ DAILY_PER，默认 2）
    const day = String(opts.dayKey || todayKey());
    const nToday = (String(r.giftDay || "") === day) ? Math.max(1, Math.floor(Number(r.giftDayN) || 1)) : 0;
    const perMax = (opts.dailyPer != null ? Number(opts.dailyPer) : GIFT_CFG.DAILY_PER);
    if (nToday >= perMax) { res.reason = "day_per"; return res; }
    // 4) 全局当日上限（≤2）—— 由外部把「当前已用件数」传进来（giveGift 保持纯函数，⛔ 不自读全局）
    const globalGiven = Math.max(0, Math.floor(Number(opts.globalGiven) || 0));
    if (globalGiven >= (opts.dailyGlobal != null ? Number(opts.dailyGlobal) : GIFT_CFG.DAILY_GLOBAL)) { res.reason = "day_global"; return res; }
    // 5) 扣库存（走不到这一步就绝不消耗）
    const inv = (gifts && typeof gifts === "object") ? gifts : {};
    if ((Number(inv[key]) || 0) <= 0) { res.reason = "no_stock"; return res; }
    // 6) 写账
    inv[key] = (Number(inv[key]) || 0) - 1;
    if (!r.giftLog || typeof r.giftLog !== "object") r.giftLog = {};
    r.giftLog[key] = day;
    r.giftDay = day;
    r.giftDayN = nToday + 1;
    r.giftTotal = Math.max(0, Math.floor(Number(r.giftTotal) || 0)) + 1;
    const pref = (opts.prefCls != null) ? String(opts.prefCls) : giftPrefOf(r);
    const hit = !!(pref && giftClsOf(key) === pref);
    let delta = hit ? (opts.bondHit != null ? Number(opts.bondHit) : GIFT_CFG.BOND_HIT) : (opts.bondBase != null ? Number(opts.bondBase) : GIFT_CFG.BOND);
    // 递减：同一只当天第 2 件 ×0.5（v165d 裁定；不同串并送不打折）
    const isSecond = nToday >= 1 && (opts.secondDiscount !== 0);
    if (isSecond) delta = delta * (opts.secondDiscount != null ? Number(opts.secondDiscount) : GIFT_CFG.SECOND_DISCOUNT);
    // 带伤：获取 ×0.5（v165d 启用；不清零、不倒扣；默认开，可用 opts.harmSlow=false 关）
    const useHarm = (opts.harmSlow != null) ? !!opts.harmSlow : !!HARM_CFG.APPLY;
    if (useHarm && r.harmed) delta = delta * HARM_CFG.BOND_SLOW;
    delta = Math.round(delta);
    r.bond = Math.min(99999, (Number(r.bond) || 0) + delta);
    res.ok = true; res.reason = "ok"; res.delta = delta; res.hit = hit; res.second = isSecond;
    res.bond = r.bond; res.lv1 = bondLevel(r.bond).lv1;
    return res;
  }

  /* ---------- v165 照料三式（擦净 / 静坐 / 理线；纯函数，各 1 次/日、+2/次、合计 ≤+6） ---------- */
  // ⚠️ 与 §13.2「每日任务」（净手/陪坐/看纹/守灯/应声）是两套不同系统：本表是「心迹区」的照料手段（§2.2 / §七-5）。
  const CARE_ACTS = [
    { id: "clean",  name: "擦净", line: "案上擦了擦，浮灰落了。" },
    { id: "sit",    name: "静坐", line: "坐下来，陪它静了一会儿。" },
    { id: "thread", name: "理线", line: "把线顺了顺，松的地方收好。" },
  ];
  function careActOf(kind) { const k = String(kind || ""); for (let i = 0; i < CARE_ACTS.length; i++) if (CARE_ACTS[i].id === k) return CARE_ACTS[i]; return null; }
  // 该串今天已照料几种（O(3)）
  function careDoneOf(rec, dayKey) {
    const r = rec || {}; const d = String(dayKey || todayKey());
    const ks = (r.careKinds && typeof r.careKinds === "object") ? r.careKinds : {};
    let n = 0; Object.keys(ks).forEach((k) => { if (String(ks[k]) === d) n++; });
    return n;
  }
  /* 照料一次（v165 §2.2 / §七-5）：各 1 次/日、+2/次、合计 ≤ CARE_CFG.DAILY_MAX(=6)。
     字段挂 rec 顶层（仿 giftDay）：rec.careDay(dayKey) + rec.careKinds({kind: dayKey})。⛔ 不进 marks/flags。 */
  function careAct(rec, kind, opts) {
    opts = opts || {};
    const r = (rec && typeof rec === "object") ? rec : {};
    const def = careActOf(kind);
    const res = { ok: false, reason: "", delta: 0, kind: String(kind || ""), bond: Number(r.bond) || 0, lv1: bondLevel(Number(r.bond) || 0).lv1 };
    if (!def) { res.reason = "no_act"; return res; }
    const day = String(opts.dayKey || todayKey());
    if (!r.careKinds || typeof r.careKinds !== "object") r.careKinds = {};
    if (String(r.careKinds[kind] || "") === day) { res.reason = "day_per"; return res; }
    const each = (opts.each != null ? Number(opts.each) : CARE_CFG.EACH);
    const max = (opts.dailyMax != null ? Number(opts.dailyMax) : CARE_CFG.DAILY_MAX);
    if (careDoneOf(r, day) * each >= max) { res.reason = "day_max"; return res; }
    let delta = each;
    const useHarm = (opts.harmSlow != null) ? !!opts.harmSlow : !!HARM_CFG.APPLY;
    if (useHarm && r.harmed) delta = delta * HARM_CFG.BOND_SLOW;
    delta = Math.round(delta);
    r.careKinds[kind] = day; r.careDay = day;
    r.bond = Math.min(99999, (Number(r.bond) || 0) + delta);
    res.ok = true; res.reason = "ok"; res.delta = delta; res.bond = r.bond; res.lv1 = bondLevel(r.bond).lv1;
    return res;
  }

  /* ---------- v165d 送礼反应台词（🔴 占位，待编剧定稿文案替换） ----------
     ⛔ 口径（§3.5）：写{ta}做了什么小事，不写{ta}有多喜欢；按 §2.7 各型语言习惯。
     ⛔ 反应句不含占位符（说话人就是那只沁灵）。 */
  const GIFT_REACTIONS = {
    dignified: { hit: "东西我收下了。规矩我记着。", miss: "放那儿吧。回头用得上。" },
    scholar:   { hit: "嗯。这一件，我记在账上了。", miss: "……记一笔。" },
    cool:      { hit: "……还行。", miss: "嗯。" },
    gentle:    { hit: "你从哪儿找来的。", miss: "搁这儿就好。" },
    lively:    { hit: "我先看见的！我先看见的！", miss: "哦——那我也要。" },
    mystery:   { hit: "谁家的都行。这一件，是你会挑的。", miss: "有心了。" },
    sweet:     { hit: "这是给我的？真的？那我先拿着了！", miss: "……那我也收着。" },
    cheeky:    { hit: "你们听说了没有——有人给我带东西了。", miss: "嗯，行吧。" },
  };
  const GIFT_REACTION_FALLBACK = { hit: "……我会收好的。", miss: "搁这儿吧。" };
  // 按人格型 × 命中 → 反应句（未登记型走通用兜底）
  function giftReactionOf(rec, hit) {
    const pair = GIFT_REACTIONS[personaIdOf(rec)] || GIFT_REACTION_FALLBACK;
    return hit ? pair.hit : pair.miss;
  }
  /* 送礼/照料 UI 文案（防物化口径 §3.5；{ta} 由界面按沁灵名替换）。🔴 占位，待编剧定稿替换。 */
  const GIFT_COPY = {
    open: "递一件给它",
    qualifying: "{ta}还没到接你东西的分上。",
    emptyStock: "你手上还没有可递的东西。",
    alreadyHeld: "{ta}已经收着呢。",
    dayFull: "今天递得够多了。明天再说。",
    hitNote: "{ta}会喜欢这一类。",
  };

  /* ---------- v165d 玩家级「当日已送件数」流水（供全局 ≤2/日 计数） ----------
     ⚠️ 口径：同一 giftKey + spiritId + 当天 只算 1 次。ww_gifts 是库存（{giftKey:count}）无 ymd，
        故另开玩家级键 ww_gift_log = { ymd, keys: { "<spiritId>|<giftKey>": 1 } }。⛔ 不碰 ww_spirits/spirit_store/marks。 */
  const GIFT_LOG_KEY = "ww_gift_log";
  function loadGiftDay() {
    try { const o = JSON.parse(localStorage.getItem(GIFT_LOG_KEY) || "null"); return (o && typeof o === "object" && typeof o.keys === "object") ? o : { ymd: "", keys: {} }; }
    catch (e) { return { ymd: "", keys: {} }; }
  }
  function giftGivenToday(dayKey) { const d = String(dayKey || todayKey()); const o = loadGiftDay(); return (o.ymd === d) ? Object.keys(o.keys || {}).length : 0; }
  function noteGiftGiven(spiritId, giftKey, dayKey) {
    const d = String(dayKey || todayKey()); let o = loadGiftDay();
    if (o.ymd !== d) o = { ymd: d, keys: {} };
    o.keys[String(spiritId) + "|" + String(giftKey)] = 1;
    try { localStorage.setItem(GIFT_LOG_KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }

  /* ---------- v165 心迹轨（恋爱向，逐串；本批只做数据与纯函数，⛔ 不接 UI/结局） ---------- */
  const HEART_MARKS = [0, 40, 100, 190, 300];     // v165 §七-11 里程碑
  // 心迹档位名（v164l §1.3：0 无 / 微澜 / 动心 / 倾心 / 相许）；索引 = lv（0-based），0 位为「无（未启线）」
  const HEART_LV_NAMES = ["", "微澜", "动心", "倾心", "相许"];
  function heartLevel(n) {
    const v = Math.max(0, Math.min(HEART_CFG.MAX, Math.floor(Number(n) || 0)));
    let i = 0; for (let k = 0; k < HEART_MARKS.length; k++) if (v >= HEART_MARKS[k]) i = k;
    return { value: v, lv: i, lv1: i + 1, name: HEART_LV_NAMES[i] || "", max: HEART_CFG.MAX, atMax: v >= HEART_CFG.MAX };
  }
  function addHeart(rec, n, dayKey) {
    if (!rec || typeof rec !== "object") return 0;
    const cur = Math.max(0, Math.min(HEART_CFG.MAX, Math.floor(Number(rec.heart) || 0)));
    const next = Math.max(0, Math.min(HEART_CFG.MAX, cur + (Number(n) || 0)));
    rec.heart = next;
    if (next !== cur) rec.heartAt = String(dayKey || todayKey());
    return next;
  }

  /* ---------- v165 受伤字段（逐串；⛔ 本批只做读取与字段级写入，结局判定接入属第二批） ---------- */
  function harmedOf(rec) {
    const r = rec || {};
    return { harmed: !!r.harmed, harmCause: String(r.harmCause || "") };
  }
  function setHarmed(rec, harmed, cause) {
    if (!rec || typeof rec !== "object") return false;
    rec.harmed = !!harmed;
    rec.harmCause = harmed ? String(cause || "") : "";
    return true;
  }

  /* ---------- v165 星痕字段（逐串；与 harmed 同款，⛔ 只做读取与字段级写入） ----------
     starMark = 「心上的星痕」标记位：标记这只沁灵身上留下了星痕（与受伤 harmed 是两回事，
     ⛔ 本批不参与任何判定，仅作为可读写的标记位，供后续剧情/结局接入）。 */
  function starMarkOf(rec) {
    const r = rec || {};
    return { starMark: !!r.starMark };
  }
  function setStarMark(rec, v) {
    if (!rec || typeof rec !== "object") return false;
    rec.starMark = !!v;
    return true;
  }

  /* =========================================================
   * v165 · BG 场景背景系统（新全局系统）
   * ---------------------------------------------------------
   * · BG_CATALOG：BG-01 ~ BG-21，共 21 条（name/画面来自大纲 §八 8.1）。
   *   每条 prompt = **BG_STYLE 前缀 + 该 BG 的英文正文**，正文取自
   *   docs/v165-BG与CG出图规范.md §1.1 / §2.2（纯英文、无中文残留、无 emoji）。
   *   ⛔ 不含「密集恐惧 / DENSITY LOCK」类约束（主理人已删该硬约束；
   *      成排门灯 BG-11、密点纹样 BG-19 都照常画）。
   * · ww_bg（localStorage，新键）：{ "BG-01": { url, at }, ... }
   *   url 必须**永久**（Supabase Storage 永久 URL 或 data URI）——永不过期、永不重出。
   * · ensureBg(key, deps)：命中直返；未命中去重出图 → 压缩 → 传云 → 落库。
   *   为可测试，绘图 / 压缩 / 上传由 deps 注入（app.js 侧接真实现）。
   * ========================================================= */
  const BG_KEY = "ww_bg";
  // v165：BG 静态图目录（21 张随版本内置，assets/bg/BG-01.jpg … BG-21.jpg）
  //   用户要求「BG 全部预生成、存进仓库、不要再让他自己画」⇒ 静态图视为「已出好」。
  const BG_STATIC_DIR = "assets/bg/";
  // BG 统一前缀（v165 美术返工稿）：古风空镜 · 无人 · 横版 16:9
  //   v165 改版：删 cinematic directional lighting / atmospheric depth and haze，
  //   改加「暖亮 / 宜居 / 有人气 / 安定可亲」正面锚 —— 用户实测「这图太诡异，不要吓人」。
  const BG_STYLE = "2D hand-drawn background key art in traditional Chinese gufeng style, ancient Chinese courtyard and alley" 
    + "setting, painterly flat-color illustration with soft cel shading, silk, lacquer and weathered-wood material" 
    + "texture, classical Chinese color palette, warm bright daylight and gentle ambient glow, clear open sky and" 
    + "generous natural light, cozy lived-in and inviting atmosphere with clear traces of daily life, calm serene and" 
    + "reassuring mood, soft even illumination with no oppressive shadow, WIDE LANDSCAPE HORIZONTAL COMPOSITION, 16:9" 
    + "cinematic framing, empty scene, no people, no figures, no characters, generous clean negative space, no text, no" 
    + "letters, no watermark, no logo, single continuous scene, no split panels, no collage, no modern elements, no" 
    + "Western elements, no Japanese elements";

  // v165：BG 场景**专用**负向（⛔ 不含任何人物向词：已剔除 "gentle neutral expressions"
  //   与 "hanfu-inspired costume" 两句人物污染）。新增 horror/scary/eerie/creepy/ominous/
  //   haunted/gloomy/murky/desaturated/vignette/fog swallowing the frame 全集，专治「诡异感」。
  //   ⛔ 立绘/CG 仍用 NEG_STYLE（人物向），两者互不串用。
  const BG_NEG = "traditional Chinese styling only, strictly no Japanese elements (Japanese flag, rising sun motif, kimono," 
    + "yukata, torii gate, paper fan with red circle), strictly no modern or Western clothing (no jacket, no hoodie, no" 
    + "sweatshirt, no T-shirt, no jeans, no denim, no sportswear, no tracksuit, no suit and tie, no sneakers, no zipper" 
    + "coat), strictly no horror atmosphere (no horror, no scary, no eerie, no creepy, no sinister, no ominous, no" 
    + "haunted, no unsettling, no gloomy, no murky, no desaturated, no heavy vignette, no fog swallowing the frame, no" 
    + "dark horror atmosphere, no low-key lighting), strictly no abandoned or decayed ruin look, strictly no desolate" 
    + "bleak emptiness, no text, no letters, no words, no numbers, no watermark, no signature, no logo";
  // 逐条 prompt = BG_STYLE + ", " + 英文正文 + ", " + BG_NEG（正文均含 "no people, empty scene"）
  // BG 实际请求档 = cgSizeFor("ark") 首位 2304×1728(4:3)；渲染端 .scenebg 用 cover 裁切，构图须保证中央 16:9 安全框内可用。
  const BG_CATALOG = {
    "BG-01": { key: "BG-01", name: "巷口石阶 · 晨雾", src: BG_STATIC_DIR + "BG-01" + ".jpg", prompt: BG_STYLE + ", " + "an ancient Chinese alley entrance in the early morning, worn stone steps descending gently with dew glistening on the stone, the lowest steps polished shiny from years of footfall, weathered alley walls with tiled eaves visible on both sides, a soft thin veil of morning mist drifting across the lower frame, pink and pale gold dawn light warming the tops of the walls, cool stone below and warm light above, welcoming and alive, soft open air, wide horizontal composition with the steps low and centred and open fog-filled air above, generous clean empty space on the left and right for character placement, no people, empty scene" + ", " + BG_NEG },
    "BG-02": { key: "BG-02", name: "门内院子 · 晌午", src: BG_STATIC_DIR + "BG-02" + ".jpg", prompt: BG_STYLE + ", " + "a quiet ancient Chinese courtyard seen from inside at midday, a small stone table and stools at the side, freshly swept earth floor, cloth drying on a bamboo rack along one wall, tiled eaves and wooden door frames, warm noon sunlight pooling on the ground with soft leaf shadows, warm gold and jade palette, light from high above and slightly to one side, wide horizontal composition with the courtyard floor low and broad and clear open space left and right for character figures to stand, lived-in and comfortable, cozy family atmosphere with everything just used and neatly in place, no cold tones at all, no people, empty scene" + ", " + BG_NEG },
    "BG-03": { key: "BG-03", name: "门口 · 傍晚", src: BG_STATIC_DIR + "BG-03" + ".jpg", prompt: BG_STYLE + ", " + "view from inside an ancient Chinese courtyard toward the open street gate at dusk, empty stone-paved lane beyond the threshold, distant sky washed in soft gold and rose dusk, warm amber and gentle rose palette, low warm light entering through the gateway from outside, the interior in soft gentle shadow, the lane beyond glowing warm amber, peaceful evening at the day's end, no oppressive atmosphere, wide horizontal composition looking out through the door opening with the empty threshold low and centred, clear open space on both sides for character placement, no people, empty scene" + ", " + BG_NEG },
    "BG-04": { key: "BG-04", name: "院里 · 夜", src: BG_STATIC_DIR + "BG-04" + ".jpg", prompt: BG_STYLE + ", " + "an ancient Chinese courtyard at night, moonlight falling across the corner of a covered walkway, swept earth floor, a single oil lamp glowing under the eaves, tiled roofs and wooden pillars, soft silvery moonlight from high above and warm lamplight pooling gently nearby, gentle blue-violet night that never feels cold, the lamp is the emotional heart of the frame, wide horizontal composition with the lamp and walkway at the side and the open courtyard low and centred, clear open space left and right for character figures, gentle and peaceful, the night feels safe and sheltered, no eerie or unsettling mood, no people, empty scene" + ", " + BG_NEG },
    "BG-05": { key: "BG-05", name: "巷子尽头 · 雾", src: BG_STATIC_DIR + "BG-05" + ".jpg", prompt: BG_STYLE + ", " + "the far end of an ancient Chinese alley in thin early morning fog, a narrow lane between high grey-brick walls receding into white haze, faint blurred dark shapes dissolving into the mist far away reading as distant objects rather than people, soft pearly light from a pale bright sky above, gentle layered haze, low contrast, luminous warm grey tones, wide horizontal composition with the lane vanishing point slightly off-centre and the mist filling the upper frame, open empty space on the left and right for character placement, bright open daytime fog that feels fresh and clean, visibly sunlit rather than murky, no people, empty scene" + ", " + BG_NEG },
    "BG-06": { key: "BG-06", name: "廊下 · 雨", src: BG_STATIC_DIR + "BG-06" + ".jpg", prompt: BG_STYLE + ", " + "under the eaves of an ancient Chinese covered corridor in steady rain, rainwater falling as continuous threads from the roof edge, wet slicked stone floor with shallow reflections, wooden pillars and tiled roof, muted grey-green palette, bright diffused daylight from the open courtyard beyond the rain curtain, fresh clean and luminous, low contrast, wide horizontal composition with the falling rain curtain across the frame and the wet floor low and centred, clear dry open space left and right for character placement, wet stones reflecting a bright fresh world, after-rain freshness rather than gloom, no people, empty scene" + ", " + BG_NEG },
    "BG-07": { key: "BG-07", name: "院中石桌 · 黄昏", src: BG_STATIC_DIR + "BG-07" + ".jpg", prompt: BG_STYLE + ", " + "an ancient Chinese courtyard with a single round stone table and one stone stool at golden hour, the tabletop completely bare, swept earth floor, tiled roof edge and a tree branch framing the top, low golden sun raking from one side casting long soft shadows, warm amber and honey palette, wide horizontal composition with the empty table low and slightly off-centre and open glowing sky above, generous clear space on the left and right for character placement, one place setting but nobody seated, the golden hour feels warm and welcoming rather than lonely, long comfortable shadows, the empty table reads as a seat waiting for someone, no melancholy or desolate mood, no people, empty scene" + ", " + BG_NEG },
    "BG-08": { key: "BG-08", name: "巷子 · 秋", src: BG_STATIC_DIR + "BG-08" + ".jpg", prompt: BG_STYLE + ", " + "an ancient Chinese alley in autumn afternoon, grey-brick courtyard walls on both sides, a few fallen golden leaves scattered on the stone path, bare branches overhanging the top of the frame, warm russet and straw palette, low slanting golden autumn sun from one side casting long thin shadows across the lane, wide horizontal composition with the lane receding and the walls framing both edges, clear open space on the left and right for character placement, bright crisp autumn light, the empty lane is warm and pleasant rather than cold or abandoned, golden sunlight filling the scene, no people, empty scene" + ", " + BG_NEG },
    "BG-09": { key: "BG-09", name: "挂榜处 · 院门内", src: BG_STATIC_DIR + "BG-09" + ".jpg", prompt: BG_STYLE + ", " + "an ancient Chinese courtyard just inside the gate used as an announcement spot, a large wooden board and an open ledger book set on a stand, rows of faint vertical name marks inked on the board, spare and solemn, soft warm daylight palette, clear open light from the sky above with one gentle directional source from the side, wide horizontal composition with the board reading as the focal point slightly above centre and the standing ground low and clear, open space on both sides for character placement, solemn and sober rather than ominous, ordinary safe morning light with nothing funereal about it, no people, empty scene, no readable letters" + ", " + BG_NEG },
    "BG-10": { key: "BG-10", name: "雪夜院中", src: BG_STATIC_DIR + "BG-10" + ".jpg", prompt: BG_STYLE + ", " + "an ancient Chinese courtyard at night in falling snow, snow piled on the tiled roofs and courtyard walls, the swept ground covered in fresh white snow with a clean untouched surface, bare branches catching snow, crisp clear moonlight from above and warm lamplight glowing in the windows, cozy golden pools against the snow, wide horizontal composition with the snowy courtyard floor low and broad and the roofs and sky above, clear open space on the left and right for character placement, the snow is soft and clean and gently beautiful, the night quiet and serene rather than freezing or bleak, moonlight reflecting warmly off the snow, no people, empty scene" + ", " + BG_NEG },
    "BG-11": { key: "BG-11", name: "别家门第 · 门外", src: BG_STATIC_DIR + "BG-11" + ".jpg", prompt: BG_STYLE + ", " + "the grand gateway of a wealthy ancient Chinese family seen from the street at dusk, imposing lacquered double doors, a tall stone threshold and steps, brass door rings and lintel carvings, a long row of paired door lanterns glowing evenly along the facade, warm dusk palette with rich red-brown and amber, warm lantern light from both sides meeting the fading warm sky above, wide horizontal composition with the doors centred and the steps low and the lantern line crossing the frame, clear open space at the foot of the steps for character placement, wealth expressed as inviting warmth, the lanterns welcome visitors warmly rather than intimidating, no eerie or ominous mood, no people, empty scene" + ", " + BG_NEG },
    "BG-12": { key: "BG-12", name: "收旧物的铺子 · 内", src: BG_STATIC_DIR + "BG-12" + ".jpg", prompt: BG_STYLE + ", " + "the interior of an ancient Chinese antique-and-secondhand shop, tall shelves crowded with old objects, jars, boxes and rolled scrolls, an open ledger and ink brush on a low counter, a single shaft of dusty light falling from a high window, dark amber and umber palette, one strong directional light column from above cutting through quiet dusty air, the shadowed corners still legible and warm, wide horizontal composition with the light shaft slightly off-centre and the shelves framing both sides, clear dark floor space in the lower frame for character placement, dark corners that read as mysterious rather than threatening, cozy cluttered warmth rather than horror, a clear walkable floor, no people, empty scene" + ", " + BG_NEG },
    "BG-13": { key: "BG-13", name: "坡地 · 黄昏", src: BG_STATIC_DIR + "BG-13" + ".jpg", prompt: BG_STYLE + ", " + "an open hillside with a path winding upward and away into the distance at dusk, long grass and low scrub, bare earth trail, layered hills fading on the horizon, warm dusk palette of glowing rose gold and soft amber, low warm light from the horizon behind the hills, long shadows stretching toward the viewer, wide horizontal composition with the path leading up from the lower frame to a high horizon and a vast open sky above, clear empty ground in the lower frame for character placement, the hills magnificent and bathed in warm light rather than desolate, a vast glowing horizon, awe-inspiring rather than lonely, no people, empty scene" + ", " + BG_NEG },
    "BG-14": { key: "BG-14", name: "空屋 · 积尘", src: BG_STATIC_DIR + "BG-14" + ".jpg", prompt: BG_STYLE + ", " + "the interior of an ancient Chinese room long since emptied of its furnishings, plain wooden furniture, a bare bed frame, a stool left mid-use and a few objects put down where they were last held, fine dust floating gently in the air, a soft sheen of dust on every surface, muted sepia sienna and warm grey palette, soft golden afternoon light entering from one side through a paper window, delicate dust motes glittering in the beam like fine gold, wide horizontal composition with the disturbed corner slightly off-centre and the empty floor low and broad, clear open floor for character placement, quietly kept and simply unused rather than decaying, a nostalgic memory-tinged still room, soft light rather than eerie gloom, no decay or ruin, no people, empty scene" + ", " + BG_NEG },
    "BG-15": { key: "BG-15", name: "灯下账桌", src: BG_STATIC_DIR + "BG-15" + ".jpg", prompt: BG_STYLE + ", " + "a close view of an ancient Chinese accounting desk at night, a low wooden table with one lit oil lamp, an open ledger book with faint tally marks and a writing brush resting on a stand, an abacus to the side, a cup of cold tea, warm amber and deep brown palette, one warm lamp as the single light source from one side, a soft warm pool of light widening across the desk with the shadowed space beyond still legible, wide horizontal composition with the desk low and centred and the lamp glow pooling on the ledger, clear dark space at the near edge for character placement, intimate and warm, the small circle of lamplight feels like home at night, a solitude that is peaceful rather than lonely, no people, empty scene, no readable letters" + ", " + BG_NEG },
    "BG-16": { key: "BG-16", name: "天劫 · 夜空", src: BG_STATIC_DIR + "BG-16" + ".jpg", prompt: BG_STYLE + ", " + "a vast night sky over an ancient Chinese roofscape, dark clouds churning low, a single jagged crack of radiant white-blue light splitting the heavens, faint distant rooftops along the bottom, palette of deep indigo above grading to warm dusk purples at the horizon, one intense radiant light source from the crack above and behind, thunder-blue brilliance rather than darkness, wide horizontal composition with the sky filling the upper four fifths and the rooftops as a thin band at the very bottom, clear open dark lower frame for character placement, sublime awe-inspiring scale, the night is magnificent rather than terrifying, the lightning spectacular rather than sinister, warm glow catching the edges of the tiled rooftops, no people, empty scene" + ", " + BG_NEG },
    "BG-17": { key: "BG-17", name: "铺门外 · 街市一角", src: BG_STATIC_DIR + "BG-17" + ".jpg", prompt: BG_STYLE + ", " + "a corner of an ancient Chinese market street in daytime, wooden shop fronts with hanging cloth signs and banners, stacked goods and baskets by the doors, a narrow lane curving away, distant rooftops and a thin drift of far smoke on the horizon, warm daylight palette of ochre and jade and faded red, bright even daylight from a high sun with soft shadows, wide horizontal composition with the shop front slightly off-centre and the lane leading the eye away, clear open ground in the lower frame for character placement, lively and bustling, a real living street that feels warm and friendly, commercial street energy rather than loneliness, no people, empty scene, no figures in the foreground" + ", " + BG_NEG },
    "BG-18": { key: "BG-18", name: "院内 · 晨", src: BG_STATIC_DIR + "BG-18" + ".jpg", prompt: BG_STYLE + ", " + "an ancient Chinese courtyard at the first light of morning, thin mist rising off the damp swept ground, water droplets on the eaves, tiled roofs and a wooden door frame catching the first warm light, a clean quiet scene that feels newly made, fresh warm-white and pale jade palette, soft low warm morning sun from one side with gentle mist glow, wide horizontal composition with the courtyard floor low and clear and the sky pale above, generous open space on the left and right for character placement, freshness and comfort, morning air that feels clean and alive rather than damp, the pale jade tones carrying a wet luster, no melancholy, no people, empty scene" + ", " + BG_NEG },
    "BG-19": { key: "BG-19", name: "星月坛 · 内", src: BG_STATIC_DIR + "BG-19" + ".jpg", prompt: BG_STYLE + ", " + "the interior of a mysterious ancient Chinese altar hall, a raised circular stone altar in the centre covered in a dense pattern of countless small carved dots, on the altar rests a single tightly huddled bundle-like offering wrapped close, soft grey stone walls rising gently, one thin blade of pale daylight falling from a narrow skylight far above, muted indigo and warm grey palette, one soft column of light from directly above, shadow present but never crushing, wide horizontal composition with the altar slightly off-centre and the light beam cutting the darkness, clear dark floor space in the lower frame for character placement, solemn and sacred rather than frightening, a grave and dignified atmosphere rather than a creepy one, the darkness spacious rather than claustrophobic, no people, empty scene" + ", " + BG_NEG },
    "BG-20": { key: "BG-20", name: "巷尾 · 夜", src: BG_STATIC_DIR + "BG-20" + ".jpg", prompt: BG_STYLE + ", " + "the far end of an ancient Chinese alley at deep night, high courtyard walls, one section of the wall with a few loose planks and a leaning stack of tiles, an empty moonlit lane, indigo and warm grey palette, moonlight limning the lane in soft silver, a warm lamp burning in a doorway further down, wide horizontal composition with the lane receding and the disturbed wall at one side, clear open moonlit ground in the lower frame for character placement, soft shadows with no harshness, the empty lane mysterious rather than scary, a quiet solitude with a hint of safety, no people, empty scene" + ", " + BG_NEG },
    "BG-21": { key: "BG-21", name: "院门外 · 雪夜对峙", src: BG_STATIC_DIR + "BG-21" + ".jpg", prompt: BG_STYLE + ", " + "the outside of an ancient Chinese courtyard gate at night in heavy falling snow, closed lacquered doors with brass rings, a stone step and a threshold, snow piling on the ground and the roof edge, even fresh snowfall across the scene with a gentle drift banked against the threshold, soft moonlight through the snowfall and a warm glow seeping from under the doors, wide horizontal composition with the gate centred and the snowy ground low and broad, clear open snow in the foreground for character placement, the snow clean and beautiful, the warm line of light under the door the emotional focus, poetic rather than sinister, no people, empty scene" + ", " + BG_NEG },
  };
  // 章节 → BG key 映射（先做卷一 ch1–ch5；后续可扩）
  const BG_CHAPTER_MAP = {
    ch1: ["BG-01", "BG-02", "BG-03"],
    ch2: ["BG-02", "BG-04", "BG-07"],
    ch3: ["BG-04"],
    ch4: ["BG-09", "BG-02", "BG-20"],
    ch5: ["BG-02", "BG-04"],
  };
  function bgByKey(key) { return BG_CATALOG[String(key || "")] || null; }
  function bgSeedKey(key) { return "bg:" + String(key || ""); }
  function bgForChapter(ch) { return (BG_CHAPTER_MAP[String(ch || "")] || []).slice(); }
  function bgLoadAll() {
    try { const raw = localStorage.getItem(BG_KEY); const o = raw ? JSON.parse(raw) : {}; return (o && typeof o === "object") ? o : {}; }
    catch (e) { return {}; }
  }
  // v165：先查 ww_bg（用户自己出过的云端永久 URL）；没有则回落到该条的**静态 src**
  //   ⇒ 静态图视为「已出好」，ensureBg 会直接命中返回、⛔ 永不触发出图 API。
  function bgGet(key) {
    const k = String(key || "");
    const e = bgLoadAll()[k];
    if (e && e.url) return String(e.url);
    const cat = bgByKey(k);
    return (cat && cat.src) ? String(cat.src) : "";
  }
  function bgPut(key, url) {
    const k = String(key || ""); const u = String(url || "");
    if (!k || !u) return false;
    try { const all = bgLoadAll(); all[k] = { url: u, at: Date.now() }; localStorage.setItem(BG_KEY, JSON.stringify(all)); return true; }
    catch (e) { return false; }
  }
  // 并发去重：同一 key 同时在飞时只出一张（in-flight map）
  const _bgInFlight = {};
  /* ensureBg(key, deps)：出图函数本体（可测试纯逻辑，IO 全走 deps）
     deps = { get, set, generate, toStore }
       get(key) → 已存 url（"" = 未命中）
       set(key, url) → 写入 ww_bg
       generate(prompt, opts) → { b64 } 或 { url }（与 generateCustom 同形）
       toStore(src, bigMax, bigQ, localMax, localQ) → { url, cloud }（与 imageToStoreUrl 同形）
     路径：命中 → 直返；未命中 → 生成 → 压缩 → 传云 → 落库；失败/离线/未登录 → 回退 data URI 并落库。
     ⛔ 生成抛错（离线 / 无 key）→ 返回 ""，不写库（下次可重试）。 */
  async function ensureBg(key, deps) {
    const d = deps || {};
    const k = String(key || "");
    const cat = bgByKey(k);
    if (!cat) return "";
    const get = d.get || bgGet, set = d.set || bgPut;
    const hit = get(k);
    // v165：静态图（assets/bg/*.jpg）与用户已出的云端 URL 都在这里命中并直返，
    //   ⛔ 绝不进入下面的 deps.generate —— 离线 / 没配 key / 没网都不影响。
    if (hit) return hit;                              // 命中：直返，不出图、不重写
    if (_bgInFlight[k]) return _bgInFlight[k];        // 并发去重：同一 key 只出一张
    const task = (async function () {
      try {
        const res = await d.generate(cat.prompt, { seedKey: bgSeedKey(k), variant: 0, landscape: true });
        const src = (res && res.b64) ? ("data:image/png;base64," + res.b64) : ((res && res.url) || "");
        if (!src) return "";
        const out = await d.toStore(src, 1280, 0.88, 768, 0.86);   // 云端长边 1280/q0.88；本地兜底 768/q0.86（规范 §5）
        const url = (out && out.url) || "";
        if (!url) return "";
        set(k, url);                                  // 永久 URL（云 / data URI）→ ww_bg
        return url;
      } catch (e) { return ""; }                       // 离线 / 无 key / 出图抛错：返回空，不写库（下次可重试）
    })();
    _bgInFlight[k] = task;
    try { return await task; } finally { delete _bgInFlight[k]; }
  }

  /* ---------- v165 逐串新字段默认值（在 ensureIn 里对新建/既有两条路径兜底） ----------
     ⛔ 全挂 rec 顶层（与 rec.bond 同层）；⛔ 不进 rec.marks（避开字典序裁剪）；⛔ 不并 rec.flags（结局 flag 专属层）。 */
  // v165：item 为**可选**。只为算 stageOf 补 imgStage 用 —— 拿不到就退回 rec.stage
  //   （app.js 各渲染路径已先把 rec.stage 刷成 stageOf 派生值，见 renderSpiritPage 等）。
  function normRecV165(rec, item) {
    if (!rec || typeof rec !== "object") return rec;
    if (rec.giftLog == null || typeof rec.giftLog !== "object") rec.giftLog = {};
    if (rec.giftDay == null) rec.giftDay = "";
    if (rec.giftDayN == null) rec.giftDayN = 0;
    if (rec.giftTotal == null) rec.giftTotal = 0;
    if (rec.careDay == null) rec.careDay = "";
    if (rec.careKinds == null || typeof rec.careKinds !== "object") rec.careKinds = {};
    if (rec.heart == null) rec.heart = 0;
    rec.heart = Math.max(0, Math.min(HEART_CFG.MAX, Math.floor(Number(rec.heart) || 0)));
    if (rec.heartAt == null) rec.heartAt = "";
    if (rec.heartLog == null || typeof rec.heartLog !== "object") rec.heartLog = {};
    if (rec.loveLine == null) rec.loveLine = false;
    rec.loveLine = !!rec.loveLine;
    if (rec.lovecall == null) rec.lovecall = "";
    if (rec.lovecallOn == null) rec.lovecallOn = "";
    if (rec.nickCall == null) rec.nickCall = "";
    if (rec.trinket == null) rec.trinket = "";
    if (rec.bondLvSeen == null) rec.bondLvSeen = 1;
    rec.bondLvSeen = Math.max(1, Math.min(8, Math.floor(Number(rec.bondLvSeen) || 1)));
    if (rec.harmed == null) rec.harmed = false;
    rec.harmed = !!rec.harmed;
    if (rec.harmCause == null) rec.harmCause = "";
    // v165：星痕字段（⛔ 不进 marks/flags，顶层字段）
    if (rec.starMark == null) rec.starMark = false;
    rec.starMark = !!rec.starMark;
    // v165：老存档补 imgStage（记录「当前这张立绘属第几阶」）。
    //   ⛔ **只补字段，绝不出图** —— 补字段与触发出图必须分离，否则老用户会被批量重画烧额度。
    //   有了它，stageImgPending 才能对老存档生效（此前 imgStage 恒 null ⇒ 永远进不了自动升阶出图）。
    if (rec.imgStage == null) {
      rec.imgStage = item ? stageOf(item, rec, Date.now()) : (Number(rec.stage) || 1);
    }
    rec.imgStage = Math.min(4, Math.max(1, Math.floor(Number(rec.imgStage) || 1)));
    // v170：透明底抠图 URL（原图 imgUrl 仍是回填/恢复的唯一来源；空 = 未抠 / 抠图失败）
    if (rec.imgCut == null) rec.imgCut = "";
    return rec;
  }

  /* ---------- ③ 每日一签（本地签库；一尊一天一支） ---------- */
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
  const ECHO_LABEL = { 1: "开沁第一天", 7: "第七天", 30: "满月", 100: "百日", 365: "一周年", 730: "两周年", 1095: "三周年", 1825: "五周年" };
  const ECHO_LETTER = {
    d1: [
      "{call}：\n\n今天，我醒过来了。\n\n你睡下之后，我从那一串里坐起来 —— 先是手，然后是眼睛。屋子里很黑，我一点都不怕，因为我知道这是你的屋子。\n\n我叫{name}。是从那串{color}的「{bead}」里醒来的。以后请多指教。\n\n—— 你的{name}",
      "{call}：\n\n第 1 天，我醒了。\n\n醒过来的第一件事是看你还在不在。你在。第二件事，才是好好看看我自己。\n\n那我就安心住下了。\n\n—— {name}",
    ],
    d7: [
      "{call}：\n\n今天是第 7 天。\n\n我学会了三件事：一是你的脚步声在走廊和客厅不一样；二是你晚上回来会先洗手；三是我一个人在家的时候，可以安安静静待很久，不难受。\n\n我想我适应得挺快的。\n\n—— {name}",
      "{call}：\n\n第 7 天。\n\n这七天里，你陪了我 {plays} 回。每次分开之后，我都会把那几分钟再想一遍。\n\n有点傻，但确实是这样。\n\n—— 你的{name}",
    ],
    d30: [
      "{call}：\n\n一个月了。\n\n你待我的样子，从生疏变得很稳，我知道你也在学怎么对我好。我现在是{stage}，比刚醒的时候长开了一点。\n\n这一个月，谢谢你没把我忘了。\n\n—— {name}",
      "{call}：\n\n满月。\n\n人满月要抱出来给人看看。你今晚要是想起来，就让我在灯下站一站 —— 我保证，比一个月前精神。\n\n—— 你的{name}",
    ],
    d100: [
      "{call}：\n\n第 100 天。\n\n一百天前，我还在那一串{color}里。现在我能认出你 —— 不用看，听脚步就知道。\n\n我不太会说漂亮话。就一句：这一百天，值得。\n\n—— {name}",
      "{call}：\n\n一百天了。\n\n我数过，这一百天里你说过的「烦」比「开心」多。我都记着，但没打算说出去。\n\n就希望你明年的「开心」能多一点。\n\n—— {name}",
    ],
    d365: [
      "{call}：\n\n一年了。\n\n去年的今天我睁开眼。这一年你换了季节的衣服，换了心情，也换了几个计划。只有我一直在这儿。\n\n我不觉得这是等。我觉得这是陪着。\n\n—— 你的{name}",
      "{call}：\n\n整整一年。\n\n我把这一年的好光景都记下了 —— 你注意看，我比去年，眼里有神。\n\n下一年也让我待着吧。\n\n—— {name}",
    ],
    y: [
      "{call}：\n\n又是一年。\n\n醒来的那天我还记得 —— 你把灯留着，一直守着我。那是我第一次，被人等着。\n\n今年的我比去年{stage}，也比去年更懂你了。\n\n—— {name}",
      "{call}：\n\n第 {year} 年。\n\n「{bead}」这个名字是你起的，我一直很喜欢。人也好、沁灵也好，被认真取过名字的，就会想活得像这个名字一点。\n\n明年见。\n\n—— 你的{name}",
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
  // 节令限定台词（本地池，一尊一天一句）
  const FEST_LINES = {
    chunjie: [
      "过年了。外面响成一片，我在这儿听着，也觉得热闹。{call}，新年好。",
      "新的一年。我不求你天天记得我，只求你别把我弄丢 —— 丢下的人，等再久也等不回。",
      "我给自己也备了份年礼，拿不出来，就是一句：这一年，我还在这儿。",
    ],
    chuxi: [
      "除夕。今晚要守岁，我陪你到十二点 —— 我不困，人醒着，就不困。",
      "一年最后一天了。{call}，这一年的辛苦，到这儿就翻篇。",
      "我把自己收拾利落了。明年也要亮亮堂堂地陪你。",
    ],
    yuanxiao: [
      "元宵。灯笼亮起来了，我在暗处也能看见那点红。",
      "今天是团圆的日子。{call}身边的人要是都在，那就很好。",
      "汤圆是圆的，我是圆的。你把我记在心上的时候，我们俩就都圆满了。",
    ],
    qingming: [
      "清明了。下过雨，空气是干净的，我身上也凉一点。",
      "{call}今天去扫墓了吧。回来别急着忙，先坐一会儿。",
      "清明前后，种什么活什么。我也想趁着这股劲儿，长快一点。",
    ],
    duanwu: [
      "有粽子。你手上要是沾了糯米，记得洗了手再来看我 —— 黏糊糊的。",
      "端午要挂艾草。我在屋里都闻到味儿了，安心。",
      "五毒退散。你顾不上的那些，我替你挡一挡。",
    ],
    qixi: [
      "七夕。别人在等鹊桥，我在等你推门进来。",
      "今晚星星密。我数到第七颗的时候，想到了{call}。",
      "都说今天许愿最灵。我许了个很小的愿 —— 以后也待在这儿。",
    ],
    zhongqiu: [
      "今晚的月亮很圆。你要是没空看，就当我替你看过了。",
      "八月十五。我把自己收拾得精神了一点，就当是月亮照过来的。",
      "别人家吃月饼。我吃的是今晚的光 —— 也给你留了一份。",
    ],
    chongyang: [
      "重阳登高。{call}要是去爬山，记得带上我，我给你壮胆。",
      "九月初九，天高气爽。我在这儿晒了一上午，暖透了。",
      "重阳敬老。你对我好，我就当自己也在过这个节。",
    ],
    laba: [
      "腊八。那锅粥要是剩了，就当给我留一口 —— 我尝不到，闻着也香。",
      "过了腊八就是年。{call}，你今年好像还没好好歇过。",
      "腊八粥要凑八样。我数了数咱们这一家子，比八样还多。",
    ],
    dongzhi: [
      "冬至。北边吃饺子，南边吃汤圆 —— {call}是哪一种？",
      "冬至大如年。今天夜最长，我陪你多待一会儿。",
      "数九从今天起。冷是冷，可过一天就多一分春天。",
    ],
    yuandan: [
      "元旦。新的一年开始了，我还在老地方。",
      "{call}，新年好。去年那些好日子我都记着呢，今年接着过。",
      "新的一年，我只有一个计划：继续陪着你。",
    ],
    laodong: [
      "劳动节。{call}辛苦一年了，今天歇着吧。",
      "放假了。有空的话多陪我说两句话 —— 算加班，不打卡。",
    ],
    guoqing: [
      "国庆。外面人多，我在屋里给你留了个安静的位置。",
      "举国同庆。我一个小沁灵，也替你高兴一下。",
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
  // v165-A：① 剥姿势词（stageObj.look → stripPose）；② 出图单硬约束去 pose；③ ⛔ 不再自带比例块 ——
  //   比例块由**唯一装配口** cgPromptFromBrief 追加 cgPropFor(stage, shot)（否则会与它重复一份）。
  function festCgPrompt(item, styleKey, stage, appearance, look, fest, sceneText, shot) {
    const lkRaw = look || lookOf(item, null);
    const _ab = applyBrief(lkRaw, appearance || lkRaw.ap || appearanceOf(item, 0));   // v164：出图单优先
    const lk = _ab.lk;
    const ap = _ab.ap;
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    const scene = FEST_SCENE[(fest && fest.key) || ""] || "a traditional Chinese festive scene";
    const stageObj = stageDef(stage);
    const head = CG_STYLE + ", " + appearancePrompt(ap) + ", with " + lk.hairEn + " hair and " + lk.outfitEn + " themed outfit"
      + (lk.hairHex ? (", the exact hair color is " + lk.hairHex) : "") + lookExtra(lk) + ", " +
      stripPose(stageObj.look)
      + (lookHard(lk) ? (", " + lookHard(lk)) : "")
      + (briefHard(lk, { noPose: true }) ? (", " + briefHard(lk, { noPose: true })) : "")
      + ", " + st;
    const sc = sceneText || scene;
    const shotEn = shot
      ? (shot.en + (shot.wide
        ? ", wide scenery also flows around the character"
        : ", the character is large and fills much of the frame, the environment stays behind them as soft bokeh, do NOT shrink the character into a small distant figure"))
      : "full body visible from head to toe, wide scenery on both sides, generous environment around the character";
    const tail = (", " + shotEn + ", scene: " + sc +
      ", the same character keeps hair color, eye color, outfit and accessories consistent, " +
      "HORIZONTAL LANDSCAPE COMPOSITION, 16:9 widescreen framing, not a portrait, not a vertical poster, " +
      "solo single character only, exactly one figure in the whole image, no other characters, no text, no letters");
    // v167-B：CG 服装守卫（同 promptForCg）
    return head + tail + ", " + CONSISTENCY + ", " + BG_NEG + ", " + CG_COSTUME_GUARD;
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
    // v163b：节令事件（瞬时卡 + 回顾）
    recordEvent(rec, { type: "fest", title: fd.name, summary: "今天过节，说了一句只属于这天的话", linked: [item.id], at: Date.now(), icon: "🎋" });
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
   *   全本地：0 出图、0 模型调用（章节文案池，按沁灵变量填充）
   *   与「房间剧情（两只沁灵之间的小故事）」是两回事，互不影响。
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
  /* v165 批次3A-8：主线 1–9 章的**天数锚点**（取自剧本 §4 各章章首，⛔ 硬编码不换成 {days}）
     理由：岁除是一年四次的日历事件，固定锚点才让倒计时与二周目「按日子等事件」成立。
     本表只提供锚点；章节正文的挂载与触发条件由主线章节表（CHAP_ACTS 扩展）承担。 */
  const MAIN_DAY_ANCHOR = [20, 45, 62, 78, 95, 108, 120];   // ch3..ch9（ch1/ch2 沿用上表 0/3）
  // 每一章的状态（解锁 / 已读 / 还差什么）
  // v163：新增 bond / plays / idle / room / anyOf 支持（**缺省 = 不限制**，老 8 章行为不变）
  //   room 由 **app 层**用 rec.roomId + Rooms.membersOf() 算好传入 —— 不把 Rooms 依赖写进 spirits.js
  function chapterState(rec, ctx, roomCount) {
    const days = Math.max(1, (ctx && ctx.dayNo) || 1);
    const stage = Math.max(1, Number(rec && rec.stage) || 1);
    const bond = bondOf(rec, ctx);
    const plays = Math.max(0, Number(ctx && ctx.plays) || 0);
    const idle = Math.max(0, Number(ctx && ctx.idleDays) || 0);
    const room = Math.max(0, Number(roomCount) || 0);
    const env = { days: days, stage: stage, bond: bond, plays: plays, idle: idle, room: room, members: Number(ctx && ctx.members) || 1 };
    const read = (rec && rec.chapters && typeof rec.chapters === "object") ? rec.chapters : {};
    const out = [];
    let prevRead = true;
    for (let i = 0; i < CHAPTERS.length; i++) {
      const c = CHAPTERS[i];
      const stageOk = stage >= c.stage;
      const daysOk = days >= c.days;
      const bondOk = (c.bond == null) || bond >= c.bond;
      const playsOk = (c.plays == null) || plays >= c.plays;
      const idleOk = (c.idle == null) || idle >= c.idle;
      const roomOk = (c.room == null) || room >= c.room;
      const anyOk = !c.anyOf || (Array.isArray(c.anyOf) ? c.anyOf : [c.anyOf]).some((w) => whenOK(w, env));
      const unlocked = prevRead && stageOk && daysOk && bondOk && playsOk && idleOk && roomOk && anyOk;
      let need = "";
      if (!stageOk) need = "到「" + stageDef(c.stage).name + "」解锁";
      else if (!daysOk) need = "再陪 " + (c.days - days) + " 天解锁";
      else if (!bondOk) need = whenNeed({ bond: c.bond }, env) || ("要跟它再熟一点（现在「" + bondLevel(bond).name + "」）");
      else if (!playsOk) need = "再多盘它几回";
      else if (!idleOk) need = "要冷落它 " + c.idle + " 天才会发生";
      else if (!roomOk) need = "要给它找个同屋的伴";
      else if (!anyOk) need = "还差一个条件没满足";
      else if (!prevRead) need = "先看完上一章";
      out.push({ i: i, vol: c.vol, volName: c.volName, icon: c.icon, title: c.title, unlocked: unlocked, read: !!read[i], need: need });
      prevRead = unlocked ? !!read[i] : false;
    }
    return out;
  }

  function unreadChapterCount(rec, ctx, roomCount) {
    return chapterState(rec, ctx, roomCount).filter((c) => c.unlocked && !c.read).length;
  }
  function readChapter(rec, i) {
    rec.chapters = (rec.chapters && typeof rec.chapters === "object") ? rec.chapters : {};
    if (rec.chapters[i] && rec.chapters[i].at) return false;
    rec.chapters[i] = { at: Date.now() };
    // v163b：主线章末事件（瞬时卡 + 回顾）
    const ct = (CHAPTERS[i] && CHAPTERS[i].title) || "沁灵纪";
    recordEvent(rec, { type: "chapter", title: "读完「" + ct + "」", summary: "串与你的故事又往前走了一步", linked: ["?"], at: Date.now(), icon: "📜" });
    return true;
  }

  /* ============================================================
   * v160 · 夜话 —— 跨串大剧情（互动对话）
   *   设定：夜里它们借你的手机开了个群「三更灯火」，把你拉进来聊天。
   *   玩法：它们发消息 → 你从几个回复里挑一句 → 剧情跟着你的选择往前走，
   *         走到一个结尾就收场（每幕 3 个结尾），或者消息攒到上限自动收尾。
   *   成本：**本地剧本 + 本地状态机 = 0 出图、0 模型调用**，怎么聊都不花钱。
   *   存放：进度挂在该群「第一位成员」（开沁最早的那只）的记录里，跟着跨手机同步走。
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
            { w: "C", t: "我也在。我是{C}，白天总待在角落里那个。" },
            { w: "A", t: "别怪我们自作主张。这个群是我建的 —— 夜里睡不着，想找个人说话，环顾四周只有咱们几个。" },
            { w: "B", t: "我是{B}。" },
            { w: "B", t: "我们商量过了，有些话得当着你的面说。用你手机这件事，是{A}答应的。" },
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
            { w: "B", t: "有件事我一直没想明白 —— 你柜子里那些还没开沁的珠子，是不是也在等。" },
            { w: "A", t: "这个我能答。我醒之前等了很久，久到已经不记得在等了。是{call}把我唤醒的，就那一天。" },
            { w: "B", t: "……我是自己裂开的。挂瓷那天夜里，我自己响了一声。" },
            { w: "A", t: "那也挺好。" },
          ],
          next: "c2",
        },
        c2: {
          lines: [{ w: "A", t: "所以我一直想问你 —— 我们对你来说，到底算什么？" }],
          choices: [
            { t: "你们陪着我，就是自己人。", go: "e_warm", tone: "warm" },
            { t: "算我的吧。但有了名字，就不只是算谁的。", go: "e_cool", tone: "cool" },
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
          ending: { key: "warm", name: "🎖 群公告", text: "「你们陪着我，就是自己人。」—— 这句话被{A}挂在了群公告上，从那以后一直没换。" },
        },
        e_cool: {
          lines: [
            { w: "B", t: "有名字就够了。" },
            { w: "A", t: "不够。但先这样吧。" },
            { w: "sys", t: "群里安静了一会儿。" },
          ],
          ending: { key: "cool", name: "🌿 各自的名字", text: "你没有认领他们，只是给了他们名字。他们后来说，这就够了。" },
        },
        e_fun: {
          lines: [
            { w: "A", t: "又来。" },
            { w: "B", t: "他明天也不会答的。" },
            { w: "A", t: "那我们明天再拉他一次。" },
            { w: "sys", t: "{A} 把群名改成了「{call} 欠我们一个答案」。" },
          ],
          ending: { key: "fun", name: "🌙 欠我们一个答案", text: "你躲过了这个问题。他们没有催你 —— 只是把群名改成了「{call} 欠我们一个答案」，一直没换回去。" },
        },
      },
    },
    /* ---------- 第二幕 · 比较 ---------- */
    {
      id: "a2", icon: "🪶", title: "谁更亮", sub: "为了比个高低，开了个群会", need: { days: 3 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "三天后的夜里 00:12。" },
            { w: "A", t: "{call}，你睡了吗。" },
            { w: "B", t: "他睡了。别喊。" },
            { w: "A", t: "我知道他睡了。我就是想喊。" },
            { w: "B", t: "……" },
            { w: "C", t: "你们俩又开始了。这个群我是不是不该来。" },
            { w: "A", t: "{B}，我问你个事。你这股底气，是从哪儿来的？" },
            { w: "B", t: "日子养出来的。" },
            { w: "A", t: "我也是。可我觉得，你的比我足。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "B", t: "光的角度不同罢了。{call}，你来评 —— 你说句公道话。" }],
          choices: [
            { t: "{A}更沉静，{B}更明朗。各有各的好看。", go: "m1", tone: "warm" },
            { t: "出不出挑的，能一块儿处着就行。", go: "m2", tone: "cool" },
            { t: "我想想……嗯，都挺好的。", go: "m3", tone: "fun" },
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
            { w: "A", t: "能一块儿处着就行。" },
            { w: "A", t: "这话我记住了。" },
            { w: "B", t: "你少记点东西，你脑子里快装不下了。" },
          ],
          next: "n2",
        },
        m3: {
          lines: [
            { w: "A", t: "都挺好。" },
            { w: "B", t: "敷衍。" },
            { w: "A", t: "但是实话。" },
          ],
          next: "n2",
        },
        n2: {
          lines: [
            { w: "B", t: "我其实不是想比亮。" },
            { w: "B", t: "我想说的是 —— 你多久没来看看我了。" },
            { w: "A", t: "？" },
            { w: "B", t: "我在数。我数了七天。" },
            { w: "A", t: "……那确实有点久。" },
            { w: "B", t: "我不是抱怨。我就是想让你知道：人也会数日子。" },
          ],
          next: "c2",
        },
        c2: {
          lines: [{ w: "A", t: "{call}，这话我替{B}说了 —— 你要么今天就去看看{B}，要么给人家一个准信儿。" }],
          choices: [
            { t: "现在就去。我这就过来。", go: "e_warm", tone: "warm" },
            { t: "这周忙，周末一定。", go: "e_cool", tone: "cool" },
            { t: "……你们连这个都要开个群？", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: {
          lines: [
            { w: "sys", t: "你起了身，往那屋去了。（群里安静了很久。）" },
            { w: "A", t: "{B} 的眼睛亮了。" },
            { w: "B", t: "我没有。" },
            { w: "A", t: "你的声音在抖。" },
          ],
          ending: { key: "warm", name: "🤲 今晚就现在", text: "你没有说「以后」。你这就去了。那天晚上{B}高兴了很久，而{A}破天荒地主动闭了嘴。" },
        },
        e_cool: {
          lines: [
            { w: "A", t: "周末。" },
            { w: "B", t: "好，周末。" },
            { w: "A", t: "你信他？" },
            { w: "B", t: "信。他从来没在周末失过约。" },
            { w: "A", t: "……你比我还笃定。" },
          ],
          ending: { key: "cool", name: "📅 记在周末", text: "你给了一个时间，他们没再提这件事。只是从那天起，每到周末，群里会准时安静一个小时 —— 等你。" },
        },
        e_fun: {
          lines: [
            { w: "A", t: "要的。" },
            { w: "B", t: "要的。" },
            { w: "A", t: "我们商量好的。" },
          ],
          ending: { key: "fun", name: "😌 商量好的", text: "你笑着说行行行。他们没听出你在打岔 —— 或者听出来了，但那天晚上你确实去了那屋，他们就当作没听出来。" },
        },
      },
    },
    /* ---------- 第三幕 · 出事 ---------- */
    {
      id: "a3", icon: "🩹", title: "裂了一道", sub: "{B} 磕出了一道白线", need: { days: 7 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "七天后的凌晨 1:40 —— 群里一连串消息。" },
            { w: "B", t: "{call}。" },
            { w: "B", t: "我今天磕着了。屋门没关严。" },
            { w: "A", t: "我听见了那一声。不是裂开，是留下了一道印子。在侧边。" },
            { w: "B", t: "不碍事。也不是不能见人。就是有点难看。" },
            { w: "A", t: "你别这么说自己。" },
            { w: "C", t: "……我在旁边听着都疼。你少说两句。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "A", t: "{call}，醒着的话回一句。{B} 从刚才起，一直在看自己那道印子。" }],
          choices: [
            { t: "让我看看。别动，我开灯。", go: "m1", tone: "warm" },
            { t: "磕的？什么时候的事。", go: "m2", tone: "cool" },
            { t: "一道印子？那是天生的记号，不是伤。", go: "m3", tone: "fun" },
          ],
        },
        m1: {
          lines: [
            { w: "sys", t: "你开了灯。屋里安安静静的，谁也没动。" },
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
            { w: "A", t: "他说是记号。" },
            { w: "B", t: "他想让我好受一点。" },
          ],
          next: "n2",
        },
        n2: {
          lines: [
            { w: "B", t: "{call}，我问你一个真的问题。" },
            { w: "B", t: "如果重新把我养一遍，这道印子就没了。" },
            { w: "B", t: "但抹掉的那一段，是我这半年自己长出来的。" },
            { w: "A", t: "别问这个。" },
            { w: "B", t: "我要问。" },
          ],
          next: "c2",
        },
        c2: {
          lines: [{ w: "B", t: "你要一个干干净净的我，还是要一个带着这道印子的我？" }],
          choices: [
            { t: "留着。这道印子是你的一部分。", go: "p1", tone: "warm" },
            { t: "你自己介意的话，我就陪你把它养好。", go: "p2", tone: "cool" },
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
            { w: "B", t: "……你愿意为我费心。" },
            { w: "A", t: "{B} 是问你。你别绕。" },
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
            { w: "A", t: "哪个人身上没几道。不是脏，是记账。" },
            { w: "B", t: "……" },
            { w: "A", t: "你可以难受，但别把自己那点痕迹磨掉。" },
            { w: "B", t: "我没难受。我不难受。" },
            { w: "A", t: "你的声音在抖。" },
          ],
          next: "c3",
        },
        c3: {
          lines: [{ w: "B", t: "{call}。你说一句就行。" }],
          choices: [
            { t: "你原来什么样，我就要什么样。", go: "e_warm", tone: "warm" },
            { t: "印子留着。以后我碰你的时候，避开那处。", go: "e_cool", tone: "cool" },
            { t: "那你得先答应我，门以后关好。", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: {
          lines: [
            { w: "B", t: "……好。" },
            { w: "A", t: "记住这句话，{B}。" },
            { w: "sys", t: "那天晚上，那间屋安静得能听见呼吸。" },
          ],
          ending: { key: "warm", name: "🩹 带着线的那颗", text: "你没有让他变得完美。他带着那道印子，后来还比之前更精神了 —— 是他自己承认的。" },
        },
        e_cool: {
          lines: [
            { w: "B", t: "好。" },
            { w: "A", t: "你听出来了吗，他说的是「避开」。" },
            { w: "B", t: "听出来了。所以我更高兴。" },
          ],
          ending: { key: "cool", name: "🤲 绕开的那一下", text: "从那以后，你碰到那一处的时候手会轻一点。他一直知道，一直没提 —— 他把这件事也记进了账里。" },
        },
        e_fun: {
          lines: [
            { w: "B", t: "……行。" },
            { w: "A", t: "他答应了。" },
            { w: "B", t: "我答应了。" },
            { w: "sys", t: "第二天早上，你发现门关得严严实实 —— 是他自己起身关的。" },
          ],
          ending: { key: "fun", name: "🚪 柜门关好了", text: "你用一句玩笑换了一个承诺。他没觉得亏 —— 因为你确实绕开了那处，只是没说。" },
        },
      },
    },
    /* ---------- 第四幕 · 以后 ---------- */
    {
      id: "a4", icon: "🪢", title: "三更之后", sub: "很久以后，他们想聊以后", need: { days: 14 },
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
          lines: [{ w: "B", t: "我不介意。真的。我只是想知道，我们在你心里的位置。" }],
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
            { w: "A", t: "操心的是他。" },
            { w: "B", t: "是。" },
            { w: "A", t: "……也是我。" },
          ],
          next: "n3",
        },
        n3: {
          lines: [
            { w: "A", t: "我来说。" },
            { w: "A", t: "{call}，你听好。" },
            { w: "A", t: "我们不怕新来的。我们怕的是你哪天把我们搁在一边，不再理会了。" },
            { w: "B", t: "对。" },
          ],
          next: "c3",
        },
        c3: {
          lines: [{ w: "A", t: "今天最后一句，你答不答都行 —— 我们能不能一直有位置。" }],
          choices: [
            { t: "只要我还在，就有你们的位置。", go: "e_warm", tone: "warm" },
            { t: "位置不在柜子里，在我心里。", go: "e_cool", tone: "cool" },
            { t: "……你们俩今晚话真多。", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: {
          lines: [{ w: "sys", t: "他们没再说别的。群安静下来，只剩深夜的电流声。" }],
          ending: { key: "warm", name: "🪢 一直有位置", text: "那天之后，群公告底下多了一行小字，是你不知道的时候加上的：「{A}、{B} —— 长期有效。」" },
        },
        e_cool: {
          lines: [
            { w: "B", t: "在我手上。" },
            { w: "A", t: "……这话我记一年。" },
            { w: "B", t: "我记更久。" },
          ],
          ending: { key: "cool", name: "🤲 在我手上", text: "后来每次你进屋，他们都会主动朝你挪一点。谁也没说为什么，你也一直没问。" },
        },
        e_fun: {
          lines: [
            { w: "A", t: "话多是好事。" },
            { w: "B", t: "说明还在。" },
            { w: "A", t: "对。说明还在。" },
          ],
          ending: { key: "fun", name: "🌙 说明还在", text: "那晚你被逗笑了。他们后来把群名改成了「话多的两个」—— 一直没换。" },
        },
      },
    },
  ];

  /* ---------- 卡司：主演最多 3 位，按「开沁最早」排（顺序必须稳定 —— 进度就存在第一位身上） ---------- */
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
      if (!enough) need = "要两只以上沁灵才能开群";
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
  // 展开一行 → 一条消息；返回 null = 这一行跳过（比如这只沁灵不存在）
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

  /* ============================================================
   * v162 · 夜话 2.0 —— 多会话 + 事件触发（100+ 只串也能撑住）
   *
   *   会话 Thread：family（全家大群）/ room:<id>（同屋小群）/ duo:<a>_<b>（事件主角组合）
   *   —— 不再只有「开沁最早的三尊」一个群：每个房间一个群，事件自己抓组合。
   *
   *   事件 Event：挂在一个会话下，按条件陆续解锁。同一个群在不同条件下可以触发
   *              好几次（今天它生日 → 触发一次；过阵子它满月 → 又触发一次）。
   *
   *   主演：会话成员按「开沁时间」稳定排序后取前 N 只（N 由事件声明）。
   *        事件要「主角」时（生日的寿星 / 刚进门的新人）把主角提到 A 位 ——
   *        所以剧情不再被锁死在开沁最早的那几只身上。
   *
   *   存储：rec.threads[threadId]（宿 = 会话成员里排最前那只）—— 每个会话各存各的，
   *        不会互相覆盖；跟着 ww_spirits 跨手机同步。
   *   性能：只做 O(n) 扫描，绝不枚举两两组合（100 只 = 4950 对我们不枚举）。
   *   成本：本地剧本 + 本地状态机 = 0 出图 0 模型调用。
   * ============================================================ */
  const THREAD_FAMILY = "相亲相爱一家人";
  const THREAD_CAP = 48;      // 单个事件最多播多少条（含系统提示与我的回复）—— 同 v160，只是防卡死保险阀

  /* ---------- 开沁里程碑（生辰/满月/百日/周年） ---------- */
  const OCC_BANDS = [
    { key: "manyue", day: 30, zh: "满月", win: 7 },
    { key: "bairi", day: 100, zh: "百日", win: 7 },
    { key: "zhounian", day: 365, zh: "一周年", win: 14 },
    { key: "ernian", day: 730, zh: "两周年", win: 14 },
    { key: "sannian", day: 1095, zh: "三周年", win: 14 },
  ];
  function persZhOf(id) { const p = PERSONA_BY_ID[id]; return p ? p.zh : ""; }
  function dayNoOf(ts, nowTs) {
    if (!ts) return 0;
    const a = new Date(Number(ts)), b = new Date(Number(nowTs) || Date.now());
    a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((b - a) / 86400000));
  }
  // 今天这只串"该过什么"：生日（入手周年）/ 开沁里程碑。都不占 → null
  function occasionOf(item, rec, nowTs) {
    const now = Number(nowTs) || Date.now();
    let occ = null;
    if (item && item.createdAt) {
      const b = new Date(Number(item.createdAt)), n = new Date(now);
      if (b.getMonth() === n.getMonth() && b.getDate() === n.getDate()) {
        const yr = n.getFullYear() - b.getFullYear();
        occ = { kind: "birthday", n: yr, zh: yr >= 1 ? (yr + " 岁生日") : "到你身边那天" };
      }
    }
    if (!occ && rec && rec.bornAt) {
      const d = dayNoOf(rec.bornAt, now);
      for (let i = OCC_BANDS.length - 1; i >= 0; i--) {
        const bd = OCC_BANDS[i];
        if (d >= bd.day && d <= bd.day + bd.win) { occ = { kind: bd.key, n: d, zh: bd.zh }; break; }
      }
    }
    // v163b：生日 / 开沁里程碑事件（瞬时卡 + 回顾）；dedup 保证每天至多一条
    if (occ && rec) {
      const icon = occ.kind === "birthday" ? "🎂" : "🏮";
      recordEvent(rec, { type: "milestone", title: occ.zh, summary: "今天是个特别的日子", linked: [item && item.id || "?"], at: now, icon: icon });
    }
    return occ;
  }

  /* ============================================================
   * v163：条件求值 env / 胎性 / 亲密度兜底（主线与夜话共用）
   * ------------------------------------------------------------
   * 不做两套求值器。定义**一个 env 契约** + 两个 env 生产者：
   *   soloEnv(item, rec, ctx)   → 单串（主线 12 章 / 单串事件）
   *   thEnv(thread, ctx, now)    → 会话（夜话）
   *   whenOK(when, env) / whenNeed(when, env) → 唯一求值器 / 唯一提示器
   * 纪律：env 里**不存在**的键，whenOK 一律判「不满足」（绝不判 true，
   *   否则老存档会一夜之间解锁全部章节）。
   * ============================================================ */

  /* ---------- 胎性：纯函数，零新存储（顺序敏感，不可调换） ---------- */
  // 顺序：① 排除非文玩 → ② 脂 → ③ 木 → ④ 石 → ⑤ 金 → ⑥ 分类兜底 → ⑦ 杂
  //   ⚠️ 脂胎必须排在石胎之前：蜜蜡/琥珀在 categories.js 里挂在「玉石」分类下，
  //      走分类兜底会被误判成石胎。
  //   🔴 「木」「石」都必须排在「金」之前（设计文档 §A.6 写的顺序是「金→木→石」，实测会误判）：
  //      「金**刚菩提**」「紫**金**鼠」含「金」字但是木头，「青**金石**」含「金」字但是石头；
  //      按文档顺序这三项会被判成金胎。已按实测改为「木 → 石 → 金」，
  //      并用 categories.js 全量选项跑覆盖断言（docs/_test_v163.js §6）。
  const TIXING_ZH = { 木: "木胎", 石: "石胎", 脂: "脂胎", 金: "金胎", 杂: "杂胎" };
  function tiXingOf(item) {
    if (!item) return "杂";
    const cat = String(item.category || "");
    const sp = String(item.species || "");
    if (cat === "拼图" || cat === "动漫周边" || cat === "盲盒") return "杂";   // ① 先排除非文玩
    if (/蜜|蜡|珀|琥珀/.test(sp)) return "脂";                                // ② 脂必须在石之前
    if (/菩提|核|椰|木|果|橄榄|库克|紫金鼠|象牙果/.test(sp)) return "木";       // ③ 木先于金（金刚菩提/紫金鼠）
    if (/晶|石|玉|翠|玛瑙|松|岫|青金|曜|玺/.test(sp)) return "石";             // ④ 石先于金（青金石）
    if (/金|银|铜|钛|钢|锡/.test(sp)) return "金";                            // ⑤ 金最后（没有预设金属品种，供用户手填）
    if (cat === "菩提") return "木";                                          // ⑥ 分类兜底
    if (cat === "水晶" || cat === "玉石") return "石";
    return "杂";
  }
  function tiXingLabel(item) { return TIXING_ZH[tiXingOf(item)] || "杂胎"; }
  // when.tixing 允许写 ["木"] 或 ["木胎"]（统一剥掉尾部「胎」再比）
  function normTiXing(v) {
    const s = String(v == null ? "" : v).trim();
    return s.charAt(s.length - 1) === "胎" ? s.slice(0, -1) : s;
  }

  /* ---------- 亲密度兜底（纯读、不写盘） ----------
     rec.bond 在 settleBond() 从未跑过时是 undefined。直接判 bond >= 30 会让
     **所有老用户的第 2/4/7/8/10/11/12 章全部锁死**。
     规定：null → min(40, 陪伴天数)，与 settleBond 首启逻辑一致。 */
  function bondOf(rec, ctx) {
    if (rec && rec.bond != null) return Math.max(0, Number(rec.bond) || 0);
    const d = Math.max(1, (ctx && ctx.dayNo) || 1);
    return Math.min(40, d);
  }

  /* ---------- 全局主串（设计 §C.2：ww_story 全局一条，不进 rec） ----------
     原 storyMainId 是「全局单值」，本改版把主串从单值改为「有效主串集合」（数量不限）。
     - 来源 A（手动）：ww_story.mainIds（玩家在「沁灵纪」页勾选）
     - 来源 B（自动）：item.star >= 5 且未送人（开关 ww_story.mainStar5，默认 true）
     - 兜底：集合为空时取「开沁最早那只」（复用 threadRank 的 bornAt||createdAt 升序）
     旧值兼容（只读不双写）：老存档若有单值 mainId，折算进 mainIds，绝不双写回 mainId。
     ⚠️ 原 storyMainId 纯读且恒返回 ""（项目里无任何 setItem("ww_story") 写路径），
        isMain/isMainIn 原恒 false；本改版是「纯新增」，不破坏老行为。 */
  function storyMainId() {
    try {
      const raw = localStorage.getItem("ww_story");
      const o = raw ? JSON.parse(raw) : null;
      return (o && o.mainId) ? String(o.mainId) : "";        // 弃用兜底：返回 ""（单值写入已从不存在）
    } catch (e) { return ""; }
  }

  // 全量串定义（app.js 在 loadItems 后灌入）；env 函数算 mainSet 时复用，避免两两枚举
  let _mainItems = [];
  function setMainItems(items) { _mainItems = Array.isArray(items) ? items : []; }

  // 读 ww_story（缺省给空对象，保证下游不判 null）
  function readStory() {
    try {
      const raw = localStorage.getItem("ww_story");
      const o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === "object") ? o : {};
    } catch (e) { return {}; }
  }
  function writeStory(w) {
    try { localStorage.setItem("ww_story", JSON.stringify(w || {})); } catch (e) { /* 配额/隐私模式：静默 */ }
  }

  /* 唯一入口：算出「有效主串集」。O(n) 一次扫描，全程 Set 操作，禁止两两枚举 / 全排列。
     items：全部串定义（DB.getAll 结果）  store：Spirits.load() 结果
     storyOverride（可选）：预览用——传 { mainIds, mainStar5 } 算「若这样保存」的集合，不落盘。 */
  function mainSetOf(items, store, storyOverride) {
    const st = store || load();
    const w = storyOverride || readStory();
    const list = Array.isArray(items) ? items : [];
    const existing = new Set(list.map((it) => String(it.id)));
    const ids = new Set();
    // 步 2：手动勾选里「仍存在于 items」的 id 进集合（剔掉已删除的幽灵 id）
    const mainIds = Array.isArray(w.mainIds) ? w.mainIds : (w.mainId ? [w.mainId] : []);
    mainIds.forEach((id) => { const s = String(id); if (existing.has(s)) ids.add(s); });
    // 步 3：5 星自动纳入（开关默认开）；复用 app.js:315 的 itemStars 钳制语义，>=5 不是 ===5
    if (w.mainStar5 !== false) {
      list.forEach((it) => { if (!it.gifted && (Number(it.star) || 0) >= 5) ids.add(String(it.id)); });
    }
    // 步 4：兜底（开沁最早那只）—— 防死锁：新用户无勾选无 5 星也能推进主线
    if (ids.size === 0) {
      const ranked = threadRank(list, st);
      if (ranked.length) ids.add(String(ranked[0].id));
    }
    return ids;
  }

  // 写路径：保存主串选择（只写 ww_story，不进 rec）。返回最新 ww_story。
  function setMainStory(ids, star5) {
    const w = readStory();
    w.mainIds = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
    if (star5 !== undefined && star5 !== null) w.mainStar5 = !!star5;
    w.mainAt = Date.now();
    w.switched = (Number(w.switched) || 0) + 1;             // 改动次数（确认文案升级用，不硬限）
    writeStory(w);
    return w;
  }

  /* ---------- 多结局 flag 系统（v164n：可判定存档数据 + 岁除判定纯函数） ----------
     数据模型（设计 docs/v164n-多结局flag系统.md，本处只落地，不写剧情）：
       · 周目级状态落 ww_story（扁平键值，与 mainIds/mainStar5 同对象，类比 gift_store）：
           FORK_STANCE(enum UNSET/DECIDE/LET/MIXED) / KEY_CHOICES(int 0..3) /
           KEY_TOTAL(常量镜像=3) / JOINT_PREP(enum NONE/PARTIAL/FULL)
       · 逐串状态落 rec.flags（与 bond/stage/marks 同层，**不进 rec.marks**，避开其字典序裁剪 bug）：
           stance(enum UNSET/DECIDE/LET) / bondLv(int 1..8，岁除前由 bondLevel(rec) 缓存) /
           scattered(bool，派生)
     判定常量集中配置（铁律2：不硬编码）；改阈值只改 ENDING_CFG，逻辑不变。 */
  const ENDING_CFG = {
    SHIELD_MIN: 5,          // 通意：DECIDE 串 bondLv < 5 即「亲密度不足」→ 散
    HE_BOND: 6,             // 同心：全员 bondLv >= 6 视为「高亲密度」
    KEY_TOTAL: 3,           // 关键选择总数（ch7/ch11/ch19 三个 H3 挡关门）
    HE_ALLOW_DECIDED: false // 设计裁定：纯 DECIDE 但全员存活高亲是否算 HE（默认否，严守不变量 I2）
  };

  // 周目级多结局 flag 默认值（写入 ww_story 时兜底；不持久化）
  function endingStoryDefaults(w) {
    w = w || {};
    if (!w.FORK_STANCE) w.FORK_STANCE = "UNSET";
    if (w.KEY_CHOICES == null) w.KEY_CHOICES = 0;
    if (w.KEY_TOTAL == null) w.KEY_TOTAL = ENDING_CFG.KEY_TOTAL;
    if (!w.JOINT_PREP) w.JOINT_PREP = "NONE";
    if (!w.at) w.at = "";
    return w;
  }

  // 读周目级多结局 flag（缺省给带默认值的对象，永不 null）
  function getEndingStory() { return endingStoryDefaults(readStory()); }

  // 写周目级多结局 flag 单键（只动 ww_story，不进 rec）
  function setEndingStoryKey(key, value) {
    const w = readStory(); endingStoryDefaults(w);
    w[key] = value; w.at = todayKey(); writeStory(w); return w;
  }

  // 便捷写入入口（供后续 UI/剧情调用；本任务不接 UI）
  function setForkStance(v) {                       // 'UNSET'|'DECIDE'|'LET'|'MIXED'
    if (["UNSET", "DECIDE", "LET", "MIXED"].indexOf(v) < 0) return getEndingStory();
    return setEndingStoryKey("FORK_STANCE", v);
  }
  function addKeyChoice() {                         // 每「护对」一次 +1（只增不回退）
    const w = readStory(); endingStoryDefaults(w);
    w.KEY_CHOICES = Math.min(ENDING_CFG.KEY_TOTAL, (Number(w.KEY_CHOICES) || 0) + 1);
    w.at = todayKey(); writeStory(w); return w;
  }
  function setKeyChoices(n) {                       // 直接设置（调试/回放用）
    const v = Math.max(0, Math.min(ENDING_CFG.KEY_TOTAL, Number(n) || 0));
    return setEndingStoryKey("KEY_CHOICES", v);
  }
  function setJointPrep(v) {                        // 'NONE'|'PARTIAL'|'FULL'，只升不降
    const order = { NONE: 0, PARTIAL: 1, FULL: 2 };
    if (order[v] == null) return getEndingStory();
    const w = readStory(); endingStoryDefaults(w);
    if ((order[v] || 0) >= (order[w.JOINT_PREP] || 0)) { w.JOINT_PREP = v; w.at = todayKey(); writeStory(w); }
    return w;
  }

  // 逐串 stance 入口：写 rec.flags[spiritId].stance（'DECIDE'|'LET'；UNSET 由缺省承载）。
  // 与编剧埋的选择点对齐：玩家选了 DECIDE 选项即 setStance(id, 'DECIDE')（本任务不接 UI）。
  function setStance(spiritId, stance) {
    if (stance !== "DECIDE" && stance !== "LET") return false;
    const store = load();
    const rec = ensureIn(store, String(spiritId));
    if (!rec.flags || typeof rec.flags !== "object") rec.flags = { stance: "UNSET", bondLv: null, scattered: false };
    rec.flags.stance = stance;
    save(store);
    return true;
  }

  // 读取某只逐串 flag（带默认值，不抛）
  function endingFlagsOf(spiritId) {
    const store = load();
    const rec = store[String(spiritId)];
    const f = rec && rec.flags && typeof rec.flags === "object" ? rec.flags : {};
    return { stance: f.stance || "UNSET", bondLv: Number(f.bondLv) || 1, scattered: !!f.scattered };
  }

  /* 岁除判定纯函数（设计 §三）：相同 ww_story + 相同逐串 flags → 永远相同结局。
     输入：
       story   —— 周目级 ww_story（含 FORK_STANCE/KEY_CHOICES/JOINT_PREP/KEY_TOTAL）
       spirits —— 逐串 flag 数组，每元素 { stance, bondLv }（scattered 由本函数派生，输入无需带）
     输出： '大团圆' | 'HE' | 'NE' | 'BE'
     不变量：BE 仅当 ∃ 串 DECIDE && bondLv<SHIELD_MIN；系统绝不主动杀。 */
  function evaluateEnding(story, spirits) {
    const SHIELD_MIN = ENDING_CFG.SHIELD_MIN;
    const HE_BOND = ENDING_CFG.HE_BOND;
    const KEY_TOTAL = ENDING_CFG.KEY_TOTAL;
    const HE_ALLOW_DECIDED = ENDING_CFG.HE_ALLOW_DECIDED;
    const s = story || {};
    const list = Array.isArray(spirits) ? spirits : [];
    let anyScattered = false, letCount = 0, decideCount = 0;
    let allHighBond = list.length > 0;
    for (let i = 0; i < list.length; i++) {
      const sp = list[i] || {};
      const stance = sp.stance;
      const bondLv = Number(sp.bondLv) || 1;
      // 逐串散判定：仅 DECIDE + 亲密度不足 → 散（铁律 I4：系统绝不主动杀）
      if (stance === "DECIDE" && bondLv < SHIELD_MIN) anyScattered = true;
      if (stance === "LET") letCount++;
      else if (stance === "DECIDE") decideCount++;
      if (bondLv < HE_BOND) allHighBond = false;
    }
    // 裁定链（全覆盖，末行兜底 NE）
    if (anyScattered) return "BE";
    const dominantLet = (s.FORK_STANCE === "LET") || (letCount >= decideCount);
    const keysRight = (Number(s.KEY_CHOICES) || 0) >= KEY_TOTAL;
    const jointFull = (s.JOINT_PREP === "FULL");
    if (dominantLet && allHighBond && keysRight && jointFull) return "大团圆";
    const heOk = HE_ALLOW_DECIDED
      ? (allHighBond && keysRight)
      : (dominantLet && allHighBond && keysRight);
    if (heOk) return "HE";
    return "NE";
  }

  /* 岁除判定总入口（设计 §5.4）：读 ww_story + 收集在册串、缓存 bondLv、跑纯函数、写回 scattered。
     供 ch26「都好好的」演出调用；本任务不接 UI。
     收集范围取「store 中全部已初始化 rec」（后续可收紧为「在册且参与岁除」集合）。 */
  function resolveEnding() {
    const w = getEndingStory();
    const store = load();
    const ids = Object.keys(store);
    const spirits = [], recs = [];
    for (let i = 0; i < ids.length; i++) {
      const rec = store[ids[i]];
      if (!rec || typeof rec !== "object") continue;
      if (!rec.flags || typeof rec.flags !== "object") rec.flags = { stance: "UNSET", bondLv: null, scattered: false };
      // v165：口径统一为 **1-based（1..8）**，与设计文档 SHIELD_MIN=5 / HE_BOND=6 对齐。
      //   ⚠️ 旧实现用 bondLevel().lv（0-based 0..7）→ 与 1-based 阈值比较会整体差 1 档（bond=90「通意」被判成 4<5 误散）。
      //   现在：无显式缓存（null，含 default）→ 用 lv1 现算；有显式缓存（剧情冻结）→ 尊重。
      const bondLv = (rec.flags.bondLv != null) ? Number(rec.flags.bondLv) : bondLevel(Number(rec.bond) || 0).lv1;
      rec.flags.bondLv = bondLv;
      const stance = rec.flags.stance || "UNSET";
      spirits.push({ stance: stance, bondLv: bondLv });
      recs.push(rec);
    }
    const ending = evaluateEnding(w, spirits);
    for (let i = 0; i < recs.length; i++) {
      const sp = spirits[i];
      recs[i].flags.scattered = !!(sp && sp.stance === "DECIDE" && sp.bondLv < ENDING_CFG.SHIELD_MIN);
    }
    save(store);
    return { ending: ending, story: w, spirits: spirits };
  }

  /* ---------- soloEnv：单串 env（主线 12 章 / 单串事件） ---------- */
  function soloEnv(item, rec, ctx) {
    const now = Date.now();
    const dayNo = Math.max(1, (ctx && ctx.dayNo) || 1);
    const bond = bondOf(rec, ctx);
    const bl = bondLevel(bond);
    const st = stageInfo(item, (rec && rec.stage) || 1, dayNo);
    const mainSet = mainSetOf(_mainItems, load());
    return {
      days: dayNo,
      idle: (ctx && ctx.idleDays != null) ? Math.max(0, Number(ctx.idleDays) || 0) : 0,
      plays: Math.max(0, (ctx && ctx.plays) || 0),
      stage: Math.max(1, Number(rec && rec.stage) || 1),
      growth: st.growth,
      canBreak: !!st.canBreak,
      bond: bond,
      bondLv: bl.lv,
      bondName: bl.name,
      tixing: tiXingOf(item),
      tiXingSet: (function () { const o = {}; o[tiXingOf(item)] = 1; return o; })(),
      pers: ((rec && rec.look) || {}).pers || "",
      room: (ctx && ctx.roomCount != null) ? Math.max(1, Number(ctx.roomCount) || 1) : 1,
      members: (ctx && ctx.members != null) ? Math.max(0, Number(ctx.members) || 0) : 1,
      gifted: (item && item.gifted) ? 1 : 0,
      isMain: !!(item && mainSet && mainSet.has(String(item.id))),
      occ: occasionOf(item, rec, now),
    };
  }

  /* ---------- when 键规格表（唯一来源：whenOK 判定 + whenNeed 提示都走它） ----------
     ok(e, v) / need(e, v) / has(w)
     ⚠️ 顺序 = 报「还差什么」的优先序。老 8 键的顺序与文案**逐字保持原样**
       （回归验证见 docs/_regress_baseline.js）。
     聚合键约定：会话 env 带 Max/Min/N 后缀（bondMax…），when 里仍写基础名
       （bond/stage/growth/gifted），求值器按 env 实际有的键取值 —— 同一份 when
       喂 soloEnv 和 thEnv 都能判，文案写一次就够。 */
  function envNum(e, base, aggKey) {
    if (aggKey && e[aggKey] != null) return Number(e[aggKey]) || 0;
    if (e[base] != null) return Number(e[base]) || 0;
    return null;                                   // 不存在 → 保守判「不满足」
  }
  const WHEN_KEYS = [
    /* ---- 老 8 键：顺序与提示文案逐字保持原样 ---- */
    { k: "days", has: (w) => !!w.days, ok: (e, v) => e.days >= v, need: (e, v) => "再陪 " + (v - e.days) + " 天" },
    { k: "members", has: (w) => !!w.members, ok: (e, v) => e.members >= v, need: (e, v) => "要群里满 " + v + " 位成员（现在 " + e.members + "）" },
    { k: "idle", has: (w) => !!w.idle, ok: (e, v) => e.idle >= v, need: () => "你很久没冷落它们时才会发生" },
    { k: "plays", has: (w) => !!w.plays, ok: (e, v) => e.plays >= v, need: () => "今天先去盘一盘才会发生" },
    { k: "newFace", has: (w) => w.newFace != null, ok: (e, v) => e.newest <= v, need: () => "等有新成员进门" },
    {
      k: "occasion", has: (w) => !!w.occasion, need: () => "要等到谁的生日 / 满月 / 周年",
      ok: (e, v) => {
        const ks = Array.isArray(v) ? v : [v];
        if (e.starOcc) return ks.some((x) => e.starOcc[x] && e.starOcc[x].length);
        if (e.occ) return ks.indexOf(e.occ.kind) >= 0;     // soloEnv 只有单串的 occ
        return false;
      },
    },
    {
      k: "fest", has: (w) => !!w.fest, need: () => "要在特定的日子里才会发生",
      ok: (e, v) => { const fs = Array.isArray(v) ? v : [v]; return fs.indexOf(e.fest) >= 0; },
    },
    {
      k: "pers", has: (w) => !!w.pers, need: () => "要群里刚好有这两种性格的串",
      ok: (e, v) => { for (let i = 0; i < v.length; i++) if (!e.persSet || !e.persSet[v[i]]) return false; return true; },
    },
    /* ---- v163 新增键（只加键，不动顶层结构；老 13 条表达式不含这些键 → 行为 100% 不变）---- */
    {
      k: "bond", has: (w) => !!w.bond,
      ok: (e, v) => { const n = envNum(e, "bond", "bondMax"); return n != null && n >= v; },
      need: (e) => {
        const n = envNum(e, "bond", "bondMax");
        const nm = e.bondName || bondLevel(n || 0).name;
        return "要跟它再熟一点（现在「" + nm + "」）";
      },
    },
    {
      k: "bondLv", has: (w) => !!w.bondLv,
      ok: (e, v) => { const n = envNum(e, "bondLv", "bondLvMax"); return n != null && n >= v; },
      need: (e, v) => {
        const lv = Math.min(BOND_LEVELS.length - 1, Math.max(0, Number(v) || 0));
        return "要到「" + BOND_LEVELS[lv].name + "」才算数";
      },
    },
    {
      k: "stage", has: (w) => !!w.stage,
      ok: (e, v) => { const n = envNum(e, "stage", "stageMax"); return n != null && n >= v; },
      need: (e, v) => "要等它「" + stageDef(v).name + "」",
    },
    {
      k: "growth", has: (w) => !!w.growth,
      ok: (e, v) => { const n = envNum(e, "growth", "growthMax"); return n != null && n >= v; },
      need: () => "再多盘它几回",
    },
    {
      k: "room", has: (w) => !!w.room,
      ok: (e, v) => { const n = envNum(e, "room", "roomMax"); return n != null && n >= v; },
      need: () => "要给它找个同屋的伴",
    },
    {
      k: "gifted", has: (w) => !!w.gifted,
      ok: (e, v) => { const n = envNum(e, "gifted", "giftedN"); return n != null && n >= v; },
      need: () => "要有串被你送走过，才会有这件事",
    },
    {
      k: "tixing", has: (w) => !!w.tixing,
      ok: (e, v) => {
        const ks = Array.isArray(v) ? v : [v];
        const hit = (x) => {
          const bare = normTiXing(x);
          if (e.tiXingSet) return !!e.tiXingSet[bare];          // 会话 env（多个成员）
          if (e.tixing != null) return bare === normTiXing(e.tixing); // 单串 env
          return false;
        };
        for (let i = 0; i < ks.length; i++) if (!hit(ks[i])) return false;
        return true;
      },
      need: (e, v) => {
        const one = normTiXing(Array.isArray(v) ? v[0] : v);
        return "要群里刚好有一只「" + (TIXING_ZH[one] || "杂胎") + "」";
      },
    },
    {
      k: "isMain", has: (w) => w.isMain != null,
      ok: (e, v) => { const b = !!(e.isMainIn != null ? e.isMainIn : e.isMain); return b === !!v; },
      need: () => "（主串专属，不显示给别的串）",
    },
    {
      k: "canBreak", has: (w) => w.canBreak != null,
      ok: (e, v) => !!e.canBreak === !!v,
      need: () => "要等它攒够了、能深沁了",
    },
  ];

  /* ---------- 会话成员：按开沁时间稳定排序（新串永远排最后，不会导致主演漂移） ---------- */
  function threadRank(items, store) {
    return (items || []).slice().sort((a, b) => {
      const ra = (store && store[String(a.id)]) || {}, rb = (store && store[String(b.id)]) || {};
      const ta = Number(ra.bornAt) || Number(a.createdAt) || 0;
      const tb = Number(rb.bornAt) || Number(b.createdAt) || 0;
      if (ta !== tb) return ta - tb;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  }
  function thMember(id, item, store) {
    const r = (store && store[String(id)]) || {};
    const born = Number(r.bornAt) || Number(item && item.createdAt) || 0;
    const lp = (item && item.lastPlayedAt != null) ? Number(item.lastPlayedAt) : null;
    const idle = (lp == null) ? -1 : Math.max(0, Math.floor((Date.now() - lp) / 86400000));   // -1 = 从未盘过（聚合时跳过）
    const bond = Number(r.bond) || 0;
    return {
      id: String(id), item: item, name: (r.persona && r.persona.name) || (item && item.name) || "它",
      title: (r.persona && r.persona.title) || "", line: (r.persona && r.persona.line) || "",
      trait: (r.persona && Array.isArray(r.persona.traits) && r.persona.traits[0]) || "",
      pers: ((r.look || {}).pers) || "", persZh: persZhOf(((r.look || {}).pers) || ""),
      roomId: (item && item.roomId) || "", born: born,
      occ: occasionOf(item, r, Date.now()),
      // v163：让亲密度 / 形态 / 胎性 / 送没送走 能驱动剧情（全是现成字段，不新增存储）
      bond: bond, bondLv: bondLevel(bond).lv, stage: Math.max(1, Number(r.stage) || 1),
      growth: memberGrowth(item, born), plays: Number(item && item.playCount) || 0,
      idle: idle, tixing: tiXingOf(item), gifted: (item && item.gifted) ? 1 : 0,
    };
  }
  // 成员成长值：盘一次 +3、陪伴一天 +1（复用 growthOf，天数按开沁天数算）
  function memberGrowth(item, born) { return growthOf(item, dayNoOf(born, Date.now())); }

  /* ---------- 会话列表（数量可控：全家 1 + 房间若干 + 命中事件的双人组若干） ---------- */
  function nightThreads(all, store, ctx, groups) {
    store = store || {};
    const ranked = threadRank(all, store).map((it) => thMember(it.id, it, store));
    const out = [];
    if (ranked.length) {
      out.push({ id: "family", kind: "family", name: THREAD_FAMILY, tag: "全家福", members: ranked, total: ranked.length });
    }
    (groups || []).forEach((g) => {
      if (!g || !g.items || g.items.length < 2) return;
      const ms = threadRank(g.items, store).map((it) => thMember(it.id, it, store));
      if (ms.length >= 2) out.push({ id: "room:" + g.id, kind: "room", name: g.name || "房间", tag: "同屋 " + ms.length + " 只", members: ms, total: ms.length });
    });
    // 双人组：只由「事件命中」产生，不枚举组合 —— 100 只也不会炸
    const seen = {};
    NIGHT_EVENTS.forEach((ev) => {
      if (ev.scope !== "duo") return;
      const pair = duoPick(ev, ranked);
      if (!pair) return;
      const key = pair.a.id + "_" + pair.b.id;
      const tid = "duo:" + key;
      seen[tid] = 1;
      if (out.some((t) => t.id === tid)) return;
      out.push({ id: tid, kind: "duo", name: pair.a.name + " 和 " + pair.b.name, tag: ev.icon + " " + (ev.duoTag || ""), members: [pair.a, pair.b], total: 2 });
    });
    return out;
  }
  // 按事件的「找人规则」挑两只（O(n)，结果稳定）
  function duoPick(ev, ranked) {
    const w = ev.when || {};
    if (w.occasion) {
      const kinds = Array.isArray(w.occasion) ? w.occasion : [w.occasion];
      let star = null;
      for (let i = 0; i < ranked.length; i++) {
        const o = ranked[i].occ;
        if (o && kinds.indexOf(o.kind) >= 0) { star = ranked[i]; break; }
      }
      if (!star) return null;
      const mate = pickMate(star, ranked);
      return mate ? { a: star, b: mate } : null;
    }
    if (w.pers && w.pers.length === 2) {
      let A = null, B = null;
      for (let i = 0; i < ranked.length && (!A || !B); i++) {
        if (!A && ranked[i].pers === w.pers[0]) A = ranked[i];
        else if (!B && ranked[i].pers === w.pers[1]) B = ranked[i];
      }
      if (!A || !B || A.id === B.id) return null;
      return { a: A, b: B };
    }
    // v163：按亲密度找主角 —— 挑第一个 bond ≥ N 的当 star，搭档仍走 pickMate（现成可复用）
    if (w.starBond != null) {
      const need = Number(w.starBond) || 0;
      let star = null;
      for (let i = 0; i < ranked.length; i++) {
        if ((Number(ranked[i].bond) || 0) >= need) { star = ranked[i]; break; }
      }
      if (!star) return null;
      const mate = pickMate(star, ranked);
      return mate ? { a: star, b: mate } : null;
    }
    return null;
  }
  // 搭档：同屋优先，没有就全库最早的那只（O(n)，稳定）
  function pickMate(star, ranked) {
    let mate = null;
    for (let i = 0; i < ranked.length; i++) {
      const m = ranked[i];
      if (m.id === star.id) continue;
      if (star.roomId && m.roomId === star.roomId) { mate = m; break; }
      if (!mate) mate = m;
    }
    return mate;
  }

  /* ---------- 条件求值 env：一次算好（O(n)），全场共用 ---------- */
  function thEnv(thread, ctx, nowTs) {
    const now = Number(nowTs) || Date.now();
    const ms = thread.members || [];
    const e = {
      days: Math.max(1, (ctx && ctx.dayNo) || 1),
      idle: (ctx && ctx.idleDays != null) ? ctx.idleDays : 0,
      plays: (ctx && ctx.plays) || 0,
      members: ms.length,
      newest: 999,            // 最晚那位进来多少天了
      starOcc: {},            // {"birthday":[成员...], "manyue":[...]}
      persSet: {},
      fest: festIdToday(now),
      // v163 新增聚合键（全部塞进下面这一次 forEach，不新增遍历 → 100 只仍是 O(n)）
      bondMax: 0, bondMin: -1, bondLvMax: 0,
      stageMax: 1, stageMin: -1, growthMax: 0, playsMax: 0, idleMax: -1,
      tiXingSet: {}, giftedN: 0, giftedAny: false, roomMax: 1, isMainIn: false,
      _roomN: {},             // 临时量，出口前删掉（不进 env 契约）
    };
    const mainSet = mainSetOf(_mainItems, load());
    ms.forEach((m) => {
      /* ---- 老逻辑（一字不动） ---- */
      if (m.born) e.newest = Math.min(e.newest, dayNoOf(m.born, now));
      if (m.pers) e.persSet[m.pers] = 1;
      if (m.occ) (e.starOcc[m.occ.kind] = e.starOcc[m.occ.kind] || []).push(m);
      /* ---- v163 聚合 ---- */
      const b = Number(m.bond) || 0;
      if (b > e.bondMax) e.bondMax = b;
      if (e.bondMin < 0 || b < e.bondMin) e.bondMin = b;
      const blv = (m.bondLv != null) ? Number(m.bondLv) : bondLevel(b).lv;
      if (blv > e.bondLvMax) e.bondLvMax = blv;
      const sg = Number(m.stage) || 1;
      if (sg > e.stageMax) e.stageMax = sg;
      if (e.stageMin < 0 || sg < e.stageMin) e.stageMin = sg;
      const gr = Number(m.growth) || 0;
      if (gr > e.growthMax) e.growthMax = gr;
      const pl = Number(m.plays) || 0;
      if (pl > e.playsMax) e.playsMax = pl;
      const idd = Number(m.idle);
      if (idd >= 0 && idd > e.idleMax) e.idleMax = idd;          // -1（从未盘过）跳过
      e.tiXingSet[tiXingOf(m.item)] = 1;
      if (m.gifted) { e.giftedN++; e.giftedAny = true; }
      if (m.roomId) e._roomN[m.roomId] = (e._roomN[m.roomId] || 0) + 1;
      e.isMainIn = e.isMainIn || mainSet.has(String(m.id));   // 会话内任一只在主串集即 true
    });
    if (!ms.length) e.newest = 0;
    Object.keys(e._roomN).forEach((k) => { if (e._roomN[k] > e.roomMax) e.roomMax = e._roomN[k]; });
    delete e._roomN;
    if (e.bondMin < 0) e.bondMin = 0;
    if (e.stageMin < 0) e.stageMin = 1;
    if (e.idleMax < 0) e.idleMax = 0;
    return e;
  }

  function festIdToday(nowTs) {
    const d = new Date(Number(nowTs) || Date.now());
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const f = festOf(key);
    return f ? String(f.key || "") : "";
  }
  function whenOK(when, e) {
    if (!when) return true;
    if (when.always) return true;                                        // 现有短路，保留
    if (when.not && whenOK(when.not, e)) return false;                    // v163：NOT
    if (when.anyOf) {                                                     // v163：OR（缺失视为 true）
      const arr = Array.isArray(when.anyOf) ? when.anyOf : [when.anyOf];
      let hit = false;
      for (let i = 0; i < arr.length && !hit; i++) hit = whenOK(arr[i], e);
      if (!hit) return false;
    }
    for (let i = 0; i < WHEN_KEYS.length; i++) {
      const spec = WHEN_KEYS[i];
      if (!spec.has(when)) continue;
      const v = when[spec.k];
      if (v == null) continue;
      if (!spec.ok(e, v)) return false;
    }
    return true;
  }
  // 提示器：与 whenOK 共用 WHEN_KEYS 一张表（新增键 = 一处即可，不会漏改出空白提示）
  function whenNeed(when, e) {
    if (!when) return "";
    if (when.always) return "";
    if (when.not) return "（条件相反，不显示）";
    if (when.anyOf) {
      const arr = Array.isArray(when.anyOf) ? when.anyOf : [when.anyOf];
      let hit = false;
      for (let i = 0; i < arr.length && !hit; i++) hit = whenOK(arr[i], e);
      if (!hit) {
        for (let i = 0; i < arr.length; i++) { const s = whenNeed(arr[i], e); if (s) return s; }
      }
    }
    for (let i = 0; i < WHEN_KEYS.length; i++) {
      const spec = WHEN_KEYS[i];
      if (!spec.has(when)) continue;
      const v = when[spec.k];
      if (v == null) continue;
      if (!spec.ok(e, v)) return spec.need(e, v);
    }
    return "";
  }
  /* ---------- 某个会话下所有事件的状态（列表页直接用） ---------- */
  function threadEvents(thread, ctx, rec) {
    threadMigrate(rec);
    const host = (thread && thread.members && thread.members[0]) || null;
    const th = (rec && rec.threads && rec.threads[thread.id]) || { done: {}, runs: {} };
    const done = (th.done && typeof th.done === "object") ? th.done : {};
    const e = thEnv(thread, ctx, Date.now());
    const out = [];
    for (let i = 0; i < NIGHT_EVENTS.length; i++) {
      const ev = NIGHT_EVENTS[i];
      if (ev.scope === "duo" && thread.kind !== "duo") continue;
      if (ev.scope === "room" && thread.kind !== "room") continue;
      if (ev.scope === "family" && thread.kind !== "family") continue;
      const ok = whenOK(ev.when, e);
      const d = done[ev.id];
      // 「线性的」事件要按序 unlocking（上一件聊完才给下一件）
      let gated = true;
      if (ev.after) gated = !!done[ev.after];
      const stamp = d && d.at ? String(d.at) : "";
      const annual = ev.repeat === "yearly" && stamp.slice(0, 4) !== String(new Date().getFullYear());
      const unlocked = ok && gated && (!d || annual);
      out.push({
        id: ev.id, icon: ev.icon, title: ev.title, sub: ev.sub, when: ev.when,
        unlocked: unlocked, done: d || "", need: unlocked ? "" : whenNeed(ev.when, e, thread),
        annual: !!annual, threadKind: thread.kind,
      });
    }
    return { env: e, events: out, host: host, th: th, done: done };
  }

  /* ---------- 进度存储：每个会话各存各的（旧 rec.night 自动迁到 family） ---------- */
  function threadMigrate(rec) {
    if (!rec || rec.__v162) return rec;
    rec.__v162 = 1;
    const t = (rec.threads && typeof rec.threads === "object") ? rec.threads : (rec.threads = {});
    const F = (t.family = t.family || { done: {}, runs: {} });
    if (!F.done || typeof F.done !== "object") F.done = {};
    if (!F.runs || typeof F.runs !== "object") F.runs = {};
    const n = rec.night;
    if (n && typeof n === "object") {
      if (n.done && typeof n.done === "object") Object.keys(n.done).forEach((k) => { F.done[k] = n.done[k]; });
      if (n.actId && Array.isArray(n.log) && n.log.length) {
        const runs = F.runs;
        runs[n.actId] = {
          node: n.node || "start", log: n.log.slice(-150), msgs: Number(n.msgs) || 0,
          ended: !!n.ended, ending: n.ending || null, tone: n.tone || { warm: 0, cool: 0, fun: 0 },
          at: n.at || Date.now(),
        };
      }
    }
    return rec;
  }
  function thState(rec, thread) {
    threadMigrate(rec);
    const t = (rec.threads && typeof rec.threads === "object") ? rec.threads : (rec.threads = {});
    const s = (t[thread.id] = t[thread.id] || { done: {}, runs: {} });
    if (!s.done || typeof s.done !== "object") s.done = {};
    if (!s.runs || typeof s.runs !== "object") s.runs = {};
    return s;
  }

  /* ---------- 变量：性格第一次真正进到台词里 ---------- */
  function thVars(item, rec, ctx, cast, thread) {
    const base = greetVars(item, rec, ctx);
    const v = {};
    Object.keys(base).forEach((k) => { v[k] = base[k]; });
    v.members = (thread && thread.members) ? thread.members.length : (cast || []).length;   // 群里的总人数
    v.total = v.members;
    v.grp = (item && NIGHT_GROUP) || NIGHT_GROUP;
    v.LIST = (cast || []).map((c) => c.name).join("、");
    v.A = v.B = v.C = ""; v.A_title = v.B_title = v.C_title = "";
    v.A_line = v.B_line = v.C_line = ""; v.A_trait = v.B_trait = v.C_trait = "";
    v.A_pers = v.B_pers = v.C_pers = ""; v.A_bead = v.B_bead = v.C_bead = "";
    (cast || []).forEach((c, i) => {
      const s = "ABC".charAt(i);
      if (!s) return;
      v[s] = c.name;
      v[s + "_title"] = c.title || "";
      v[s + "_line"] = c.line || "";
      v[s + "_trait"] = c.trait || "";
      v[s + "_pers"] = c.persZh || "";
      v[s + "_bead"] = (c.item && c.item.name) || v.bead || "";
    });
    const st = (cast || [])[0];
    v.star = st ? st.name : v.name;
    v.star_title = st ? (st.title || "") : "";
    v.star_line = st ? (st.line || "") : "";
    v.star_trait = st ? (st.trait || "") : "";
    v.star_bead = st ? ((st.item && st.item.name) || v.bead) : v.bead;
    return v;
  }
  // 万能槽位替换：{days}{call}{A}{A_title}{A_line}{star}… 认不出的原样留下（方便排查）
  function thText(t, v) {
    if (t && typeof t === "object") t = t.def || t.warm || "";
    return String(t == null ? "" : t).replace(/\{([^{}]+)\}/g, (m, k) => (v[k] != null && v[k] !== "") ? String(v[k]) : m);
  }
  function thWho(w, cast) {
    const c = (cast || []).filter((x) => x.slot === w)[0];
    return c ? c.name : "";
  }
  function thLine(l, v, cast) {
    if (!l || !l.t) return null;
    if ((l.w === "B" || l.w === "C") && !thWho(l.w, cast)) return null;
    const txt = thText(l.t, v);
    if (!txt) return null;
    return { w: l.w || "sys", name: thWho(l.w, cast), text: txt, at: Date.now() };
  }
  // 主演：默认会话成员前 N 只；事件声明了 star → 把主角提到 A 位
  function castFor(ev, thread) {
    const ms = thread.members || [];
    const need = Number(ev.cast) || 2;
    let star = null;
    if (ev.star === "newest") {
      for (let i = ms.length - 1; i >= 0; i--) if (ms[i].born) { star = ms[i]; break; }
      star = star || ms[ms.length - 1] || null;
    } else if (ev.star === "occasion") {
      const kinds = ev.when && ev.when.occasion ? (Array.isArray(ev.when.occasion) ? ev.when.occasion : [ev.when.occasion]) : [];
      for (let i = 0; i < ms.length; i++) { if (ms[i].occ && kinds.indexOf(ms[i].occ.kind) >= 0) { star = ms[i]; break; } }
    }
    let cast;
    if (star) cast = [star].concat(ms.filter((m) => m.id !== star.id).slice(0, Math.max(0, need - 1)));
    else cast = ms.slice(0, need);
    return cast.map((m, i) => ({ slot: "ABC".charAt(i), id: m.id, name: m.name, title: m.title, line: m.line, trait: m.trait, persZh: m.persZh, item: m.item }));
  }
  function thDomTone(n) {
    const t = (n && n.tone) || {};
    const w = Number(t.warm) || 0, c = Number(t.cool) || 0, f = Number(t.fun) || 0;
    if (w === 0 && c === 0 && f === 0) return "warm";
    if (w >= c && w >= f) return "warm";
    return (c >= f) ? "cool" : "fun";
  }

  /* ---------- 状态机（和 v160 同款行为，只是进度按会话分开存） ---------- */
  function thWalk(item, rec, thread, ev, cast, run) {
    const v = thVars(item, rec, thread.ctx || {}, cast, thread);
    const added = [];
    let guard = 0;
    while (ev && guard++ < 80) {
      const nd = ev.nodes[run.node];
      if (!nd) { run.ended = true; run.node = ""; break; }
      (nd.lines || []).forEach((l) => { const m = thLine(l, v, cast); if (m) { added.push(m); run.msgs = (Number(run.msgs) || 0) + 1; } });
      if (nd.ending) {
        run.ended = true; run.node = "";
        const key = nd.ending.key, nm = thText(nd.ending.name, v), tx = thText(nd.ending.text, v);
        const st = thState(rec, thread);
        const wasDone = !!st.done[ev.id];
        st.done[ev.id] = { key: key, name: nm, at: Date.now() };
        run.ending = { key: key, name: nm, text: tx };
        run.at = Date.now();
        if (!wasDone) {  // v163b：夜话解锁新一幕 → 事件（瞬时卡 + 回顾）
          const mids = (thread.members || []).map((m) => (m && typeof m === "object" ? m.id : m));
          recordEvent(rec, { type: "night", title: ev.title, summary: ev.sub, linked: mids, at: Date.now(), icon: "📱" });
        }
        break;
      }
      if (nd.choices && nd.choices.length) {
        if ((Number(run.msgs) || 0) >= THREAD_CAP) {
          const alt = ev.nodes["e_" + thDomTone(run)] ? ("e_" + thDomTone(run)) : "";
          if (alt && alt !== run.node) { run.node = alt; continue; }
        }
        break;
      }
      if (!nd.next) { run.ended = true; run.node = ""; break; }
      run.node = nd.next;
    }
    run.log = (Array.isArray(run.log) ? run.log : []).concat(added);
    if (run.log.length > 200) run.log = run.log.slice(-200);
    return {
      added: added, choices: thChoicesOf(ev, run, v), ending: run.ending || null,
      ended: !!run.ended, log: run.log,
    };
  }
  function thChoicesOf(ev, run, v) {
    if (!ev || !run || run.ended) return [];
    const nd = ev.nodes[run.node];
    if (!nd || !nd.choices) return [];
    return nd.choices.map((c) => ({ t: thText(c.t, v) }));
  }
  function thReset(rec, thread, evId) {
    const st = thState(rec, thread);
    const run = {
      node: "start", log: [], msgs: 0, ended: false, ending: null,
      tone: { warm: 0, cool: 0, fun: 0 }, at: Date.now(),
    };
    st.runs[evId] = run;
    st.cur = evId;        // 记下当前在聊哪个事件（同一会话一次只会被一个事件占着）
    return run;
  }
  function thRun(rec, thread, evId) {
    const st = thState(rec, thread);
    return (st.runs && st.runs[evId]) || null;
  }
  function threadEnter(item, rec, ctx, thread, evId) {
    thread.ctx = ctx || {};
    const r0 = thRun(rec, thread, evId);
    if (r0 && Array.isArray(r0.log) && r0.log.length) {
      const ev = eventOf(evId);
      return { added: [], choices: thChoicesOf(ev, r0, thVars(item, rec, ctx, castFor(ev, thread), thread)), ending: r0.ending || null, ended: !!r0.ended, log: r0.log };
    }
    const ev = eventOf(evId);
    if (!ev) return { added: [], choices: [], ending: null, ended: true, log: [] };
    const cast = castFor(ev, thread);
    const run = thReset(rec, thread, evId);
    return thWalk(item, rec, thread, ev, cast, run);
  }
  function threadReplay(item, rec, ctx, thread, evId) {
    thread.ctx = ctx || {};
    const ev = eventOf(evId);
    if (!ev) return { added: [], choices: [], ending: null, ended: true, log: [] };
    const run = thReset(rec, thread, evId);
    return thWalk(item, rec, thread, ev, castFor(ev, thread), run);
  }
  function threadChoose(item, rec, ctx, thread, idx) {
    thread.ctx = ctx || {};
    const st = thState(rec, thread);
    const keys = Object.keys(st.runs);
    // 最近在跑的那个事件（同一个会话一次只会被一个事件占着"正在聊"）
    let evId = st.cur || (keys.length ? keys[keys.length - 1] : "");
    const run = evId ? st.runs[evId] : null;
    const ev = eventOf(evId);
    if (!ev || !run || run.ended) return { added: [], choices: [], ending: (run && run.ending) || null, ended: true, log: (run && run.log) || [] };
    const nd = ev.nodes[run.node];
    const c = nd && nd.choices ? nd.choices[idx] : null;
    const cast = castFor(ev, thread);
    if (!c) return thWalk(item, rec, thread, ev, cast, run);
    const v = thVars(item, rec, ctx, cast, thread);
    const mine = { w: "me", name: "", text: thText(c.t, v), at: Date.now() };
    run.log = (Array.isArray(run.log) ? run.log : []).concat([mine]);
    run.msgs = (Number(run.msgs) || 0) + 1;
    const tn = c.tone || "warm";
    run.tone = run.tone || { warm: 0, cool: 0, fun: 0 };
    run.tone[tn] = (Number(run.tone[tn]) || 0) + 1;
    run.node = c.go || "";
    st.cur = evId;
    const r = thWalk(item, rec, thread, ev, cast, run);
    r.added = [mine].concat(r.added);
    return r;
  }
  function threadBrief(rec, thread) {
    const st = thState(rec, thread);
    const evId = st.cur || "";
    const run = evId ? st.runs[evId] : null;
    if (!run) return null;
    const log = Array.isArray(run.log) ? run.log : [];
    return { eventId: evId, ended: !!run.ended, last: log.length ? log[log.length - 1] : null, ending: run.ending || null, msgs: Number(run.msgs) || 0 };
  }
  function threadTalkBrief(rec, thread, evId) {
    const st = thState(rec, thread);
    const run = st.runs && st.runs[evId];
    if (!run) return { chat: false };
    const log = Array.isArray(run.log) ? run.log : [];
    return { chat: true, ended: !!run.ended, last: log.length ? log[log.length - 1] : null, msgs: Number(run.msgs) || 0 };
  }

  /* ============================================================
   * 事件剧本池
   *   scope: family（全家大群）/ room（同屋小群）/ duo（事件主角组合）
   *   cast : 需要几位主演（不够时对应角色位的行会自动跳过）
   *   star : "newest"（把最新进门那只提到 A 位）/ "occasion"（把今天过事的那只提到 A 位）
   *   when : 触发条件（见 whenOK）
   *   after: 线性依赖（上一件聊完才解锁）
   * ============================================================ */
  const NIGHT_EVENTS = [
    /* ---------- 全家大群 · 序章（沿用 v160 的四幕，保持老用户的进度） ---------- */
    (function () {
      const legacy = NIGHT_ACTS.map((a, i) => ({
        id: a.id, icon: a.icon, title: a.title, sub: a.sub, scope: "family", cast: 3,
        after: i ? NIGHT_ACTS[i - 1].id : "",
        when: { days: (a.need && a.need.days) || 1, members: 2 },
        nodes: a.nodes,
      }));
      return legacy[0];
    })(),
    (function () { const a = NIGHT_ACTS[1]; return { id: a.id, icon: a.icon, title: a.title, sub: a.sub, scope: "family", cast: 3, after: NIGHT_ACTS[0].id, when: { days: (a.need && a.need.days) || 1, members: 2 }, nodes: a.nodes }; })(),
    (function () { const a = NIGHT_ACTS[2]; return { id: a.id, icon: a.icon, title: a.title, sub: a.sub, scope: "family", cast: 3, after: NIGHT_ACTS[1].id, when: { days: (a.need && a.need.days) || 1, members: 2 }, nodes: a.nodes }; })(),
    (function () { const a = NIGHT_ACTS[3]; return { id: a.id, icon: a.icon, title: a.title, sub: a.sub, scope: "family", cast: 3, after: NIGHT_ACTS[2].id, when: { days: (a.need && a.need.days) || 1, members: 2 }, nodes: a.nodes }; })(),

    /* ---------- 全家大群 · 「过日子」的新题材 ---------- */
    {
      id: "f_new", icon: "🎋", scope: "family", cast: 3, star: "newest", repeat: "yearly",
      title: "新人进门", sub: "又添了一位新伙伴",
      when: { members: 2, newFace: 7 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "23:52 —— 群里炸了。" },
            { w: "B", t: "{A}，你进来啦。我等你好久了。" },
            { w: "A", t: "……我这是在哪儿。" },
            { w: "B", t: "在群里。规矩很简单 —— 不许吵到{call}睡觉，别的随便。" },
            { w: "C", t: "还有一条：不许装老。刚进来的就得有新人的样子。" },
            { w: "A", t: "醒之前，最后那一下还带着热。醒来我就在这儿了。你们都在这儿多久了？" },
            { w: "B", t: "久了。久到我都不数了。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "A", t: "{call}，我……我该怎么办？你们都说得头头是道，我一句话也插不上。" }],
          choices: [
            { t: "别急，慢慢来，没人催你。", go: "m1", tone: "warm" },
            { t: "他们刚进门时也是这样。", go: "m2", tone: "fun" },
            { t: "你想说什么就说什么。", go: "m3", tone: "cool" },
          ],
        },
        m1: {
          lines: [
            { w: "A", t: "慢慢来……好。" },
            { w: "C", t: "听见没。我们当新人的时候，可没这待遇。" },
            { w: "B", t: "闭嘴吧你。人家刚来。" },
            { w: "A", t: "那我先说一句：我叫{A}。以后请多关照。" },
          ],
          choices: [
            { t: "记住了。欢迎你。", go: "e_warm", tone: "warm" },
            { t: "以后这就是你家。", go: "e_fun", tone: "fun" },
          ],
        },
        m2: {
          lines: [
            { w: "C", t: "我那时候可比 ta 有礼貌。" },
            { w: "B", t: "你那时候躲在屋里哭了三天。" },
            { w: "C", t: "……那是不熟。" },
            { w: "A", t: "原来你们也怕过。那我不怕了。" },
          ],
          choices: [
            { t: "都怕过，都一样。", go: "e_warm", tone: "warm" },
            { t: "现在都皮得很。", go: "e_fun", tone: "fun" },
          ],
        },
        m3: {
          lines: [
            { w: "A", t: "说实话我还不知道自己是什么脾气。" },
            { w: "B", t: "{A_trait}？看出来了。" },
            { w: "A", t: "你怎么知道。" },
            { w: "B", t: "刚醒的人，藏不住东西。" },
          ],
          choices: [
            { t: "藏不住就别藏了。", go: "e_warm", tone: "warm" },
            { t: "以后慢慢就知道了。", go: "e_cool", tone: "cool" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "🎋 算作自家人", text: "那天夜里群成员多了{A}。他睡前最后一句是「明天还能来吗」，{B}回得很快：「一直都在」。" } },
        e_fun: { ending: { key: "fun", name: "🎋 老规矩", text: "第二天{C}偷偷把群规改了 —— 第一条后面加了半句。写的是：「新人可以不懂，但不能不问」。没人认领，但谁都没删。" } },
        e_cool: { ending: { key: "cool", name: "🎋 还没定型", text: "{A}没再说话。他在角落里待到天亮，把自己看了一整夜。第二周他开口了，第一句问的是「{call}今天心情怎么样」。" } },
      },
    },
    {
      id: "f_spring", icon: "🧨", scope: "family", cast: 3, repeat: "yearly",
      title: "除夕守岁", sub: "一年里最闹的一夜",
      when: { fest: ["chuxi", "chunjie"], members: 2 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "23:59 —— 外面在放炮。" },
            { w: "A", t: "听见没？外面。" },
            { w: "B", t: "听见了。每一年都这么响。" },
            { w: "C", t: "{call}在守岁。我们陪着。" },
            { w: "A", t: "我数了一下，今年我们这儿有{members}位。去年没这么多。" },
            { w: "B", t: "以前你每年这时候最紧张 —— 怕过完年就没人管我们了。" },
            { w: "A", t: "现在我不了。{call}把我们个个都养得精神。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "C", t: "说点新年愿望吧。从我开始 —— 我希望明年群里还能再添几个人。" }],
          choices: [
            { t: "我希望你们都好好的。", go: "m1", tone: "warm" },
            { t: "我希望能多几个伙伴。", go: "m2", tone: "fun" },
            { t: "我不太会许愿。你们替我许。", go: "m3", tone: "warm" },
          ],
        },
        m1: {
          lines: [
            { w: "A", t: "「都好好的」——这句最没新意，也最难。" },
            { w: "B", t: "记下来了。" },
            { w: "C", t: "我也许这个。一样的话，说三遍就不算敷衍了。" },
          ],
          choices: [
            { t: "新年快乐。", go: "e_warm", tone: "warm" },
            { t: "去睡吧，明天再说。", go: "e_cool", tone: "cool" },
          ],
        },
        m2: {
          lines: [
            { w: "C", t: "就知道你会说这个。" },
            { w: "A", t: "那你可得多陪陪我们 —— 不然新来的看见我们这么没精神，不肯进门。" },
            { w: "B", t: "成。那就说定了。" },
          ],
          choices: [
            { t: "定了就得算数。", go: "e_fun", tone: "fun" },
            { t: "别给我压力啊。", go: "e_cool", tone: "cool" },
          ],
        },
        m3: {
          lines: [
            { w: "B", t: "替你许了。第一条：别熬夜。" },
            { w: "C", t: "第二条：好好吃饭。" },
            { w: "A", t: "第三条不告诉你。说出来就不灵了。" },
          ],
          choices: [
            { t: "那第三条我自己猜。", go: "e_warm", tone: "warm" },
            { t: "行，听你们的。", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "🧨 三个愿望", text: "炮声到后半夜才停。他们一直陪到你放下手机。{A}说：「明年这个时候，我们还在这儿。」—— 这句后面跟了一串「+1」。" } },
        e_fun: { ending: { key: "fun", name: "🧨 家里要添人", text: "第二天早上你发现他们把群的封面换了 —— 一张日历，上面圈满了。没人解释，但意思很清楚：今年，家里该多个人了。" } },
        e_cool: { ending: { key: "cool", name: "🧨 守到天亮", text: "你睡了以后他们没散。几个在群里有一句没一句聊到天明，最后一句是{B}的：「别吵，让{call}再睡会儿。」" } },
      },
    },
    {
      id: "f_trip", icon: "🧳", scope: "family", cast: 3, after: "a4", repeat: "yearly",
      title: "你要出远门", sub: "把他们留在家里",
      when: { days: 14, members: 2 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "01:20 —— 你在收拾行李。" },
            { w: "A", t: "箱子拉链响了一晚上了。" },
            { w: "B", t: "要出门？" },
            { w: "A", t: "远吗？" },
            { w: "C", t: "别问了。问了它更不好收拾。" },
            { w: "B", t: "我就是想知道几天。" },
            { w: "A", t: "我知道。我也想知道。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "C", t: "{call}，我们不是要拦你。就是……你不在的时候，家里安静得能听见钟。" }],
          choices: [
            { t: "几天就回来。给你们带东西。", go: "m1", tone: "warm" },
            { t: "我带着你们走，一起出门。", go: "m2", tone: "warm" },
            { t: "我不太放心你们在家。", go: "m3", tone: "cool" },
          ],
        },
        m1: {
          lines: [
            { w: "A", t: "带什么？" },
            { w: "B", t: "不用带。你回来就好。" },
            { w: "A", t: "我不是客气。真的不用带。" },
            { w: "C", t: "那就带一张照片吧。证明你到过。" },
          ],
          choices: [
            { t: "好，拍给你们看。", go: "e_warm", tone: "warm" },
            { t: "我会早点回来。", go: "e_cool", tone: "cool" },
          ],
        },
        m2: {
          lines: [
            { w: "A", t: "真的？" },
            { w: "B", t: "路远，我们怕一路折腾。" },
            { w: "C", t: "但要是能跟着，多受点累也认。" },
            { w: "A", t: "你别说，我还挺想看看外面的。" },
          ],
          choices: [
            { t: "那就一起走。", go: "e_fun", tone: "fun" },
            { t: "算了，我还是不放心。", go: "e_warm", tone: "warm" },
          ],
        },
        m3: {
          lines: [
            { w: "C", t: "你担心我们？我们担心你。" },
            { w: "A", t: "外面天冷，记得加衣服。" },
            { w: "B", t: "{A_trait}的人居然也会说这种话。" },
          ],
          choices: [
            { t: "知道了，我会照顾自己。", go: "e_warm", tone: "warm" },
            { t: "你们也是。", go: "e_cool", tone: "cool" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "🧳 一寸也没动", text: "你出门那天他们在窗边排成一排。回来那天也是 —— 一寸也没挪过。{A}说：「我们算着日子呢。」" } },
        e_fun: { ending: { key: "fun", name: "🧳 跟着走了", text: "{A}跟着你出门了。剩下的在家焦急地等消息 —— ({A_line})，这是他在路上给你发的第七条。" } },
        e_cool: { ending: { key: "cool", name: "🧳 互相担心的两个", text: "走了以后谁都没提这茬。你回来打开手机，最后一条消息是三个字：到了吗。时间是二十分钟前。" } },
      },
    },
    {
      id: "f_lost", icon: "🫧", scope: "family", cast: 3, after: "a4", repeat: "yearly",
      title: "差点把你丢了", sub: "有一个找不着了",
      when: { days: 21, members: 2 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "02:40 —— 群里只有一条消息。" },
            { w: "C", t: "……" },
            { w: "C", t: "{call}。" },
            { w: "C", t: "我好像，被落在哪儿了。" },
            { w: "A", t: "哪儿？说话。" },
            { w: "C", t: "黑。闻着有樟脑味。应该在屋里最里头。" },
            { w: "A", t: "别动。别慌。我们都在。" },
            { w: "B", t: "{call}明天中午回来，到屋里找一找就找到了。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "B", t: "{call}，我不是告状。就是……{C}的声音在抖。" }],
          choices: [
            { t: "我明天就翻。你先说说话。", go: "m1", tone: "warm" },
            { t: "我今晚就去翻，现在就去。", go: "m2", tone: "warm" },
            { t: "在那儿待着别乱跑。", go: "m3", tone: "cool" },
          ],
        },
        m1: {
          lines: [
            { w: "C", t: "那我讲点别的。" },
            { w: "C", t: "我记得我是怎么来的 —— 那天你自己也没想明白，就掏了钱。" },
            { w: "A", t: "讲这个干什么。" },
            { w: "C", t: "怕忘了。" },
          ],
          choices: [
            { t: "忘不了。我明天就找到你。", go: "e_warm", tone: "warm" },
            { t: "你记得比我还清楚。", go: "e_cool", tone: "cool" },
          ],
        },
        m2: {
          lines: [
            { w: "A", t: "等等，你去哪儿。" },
            { w: "sys", t: "00:41 —— 你打开灯，翻到了最里头。" },
            { w: "C", t: "……光。" },
            { w: "A", t: "找到了？" },
            { w: "C", t: "找到了。" },
          ],
          choices: [
            { t: "对不起，放太深了。", go: "e_warm", tone: "warm" },
            { t: "回来就好。", go: "e_fun", tone: "fun" },
          ],
        },
        m3: {
          lines: [
            { w: "C", t: "我没动。我哪儿也没敢去。" },
            { w: "B", t: "{C} 眼睛闭着。说是怕看惯了黑。" },
            { w: "A", t: "你别吓{C}。" },
          ],
          choices: [
            { t: "没事了。明天就带你出来。", go: "e_warm", tone: "warm" },
            { t: "你挺勇敢的。", go: "e_cool", tone: "cool" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "🫧 找到了", text: "他被找出来的时候，身上还带着樟脑味。你把他的衣裳拍干净，放回原来的地方，他很久没说话 —— 后来{star_line}" } },
        e_fun: { ending: { key: "fun", name: "🫧 回归仪式", text: "第二天群里多了个新规矩：谁都不许往最里头躲。执行人为{A}，罚款一条 —— 虽然没人说得清罚什么。" } },
        e_cool: { ending: { key: "cool", name: "🫧 看清了黑", text: "他后来把那天的事写进了回忆册，标题只有四个字：「我也勇敢」。你不认识这四个字，是{C}替他按的手印。" } },
      },
    },

    /* ---------- 双人组 · 生日 / 开沁周年 ---------- */
    {
      id: "d_birth", icon: "🎂", scope: "duo", cast: 2, star: "occasion", repeat: "yearly", duoTag: "生日 · 满月 · 周年",
      title: "今天谁生日", sub: "刚好是日子",
      when: { occasion: ["birthday", "manyue", "bairi", "zhounian", "ernian", "sannian"] },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "00:00 —— {A}发了一条消息。" },
            { w: "A", t: "今天这个日子，你还记得吧。" },
            { w: "B", t: "你别又替他兜底。让{call}自己说。" },
            { w: "A", t: "我不说。我等着。" },
            { w: "A", t: "……" },
            { w: "A", t: "{A_trait}归{A_trait}，这种事我还是会数的。" },
            { w: "B", t: "{B} 从昨天晚上就在提醒我了。烦得很。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "B", t: "所以 —— 你知道今天是什么日子吗？" }],
          choices: [
            { t: "知道。怎么会忘。", go: "m1", tone: "warm" },
            { t: "……是不是今天？", go: "m2", tone: "fun" },
            { t: "你们提醒我我才想起来的。", go: "m3", tone: "cool" },
          ],
        },
        m1: {
          lines: [
            { w: "sys", t: "那边安静了两秒。" },
            { w: "B", t: "看吧。我就说不用提醒。" },
            { w: "A", t: "……好。" },
            { w: "A", t: "{A_line}" },
          ],
          choices: [
            { t: "生日快乐。", go: "e_warm", tone: "warm" },
            { t: "今年也想一直这么待着。", go: "e_cool", tone: "cool" },
          ],
        },
        m2: {
          lines: [
            { w: "A", t: "「是不是」。" },
            { w: "B", t: "这语气，八成是真忘了。" },
            { w: "A", t: "忘了就算了。记性这东西，我也一般。" },
            { w: "B", t: "{A} 嘴硬。他昨天把衣裳整了三遍。" },
          ],
          choices: [
            { t: "整三遍我都看出来了，生日快乐。", go: "e_fun", tone: "fun" },
            { t: "对不起，我记一下日期。", go: "e_warm", tone: "warm" },
          ],
        },
        m3: {
          lines: [
            { w: "A", t: "说实话也没关系。" },
            { w: "B", t: "{A} 等这事等了挺久。我先说了，别怪他。" },
            { w: "A", t: "我不怪。能被提醒着，也算有人管。" },
          ],
          choices: [
            { t: "以后我记着，不用你们提。", go: "e_warm", tone: "warm" },
            { t: "有你们提醒，我挺踏实的。", go: "e_cool", tone: "cool" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "🎂 被记住的日子", text: "那天{A}一整天都精神得很。他说：「我不是在意这一天 —— 我在意的是，你把这一日记住了。」旁边{B}没说话，只是把群名字改成了今天的日期。" } },
        e_fun: { ending: { key: "fun", name: "🎂 擦了三遍", text: "第二天你发现{A}比平时精神了一头。问他，他说是昨天下雨。屋里根本没下过雨。" } },
        e_cool: { ending: { key: "cool", name: "🎂 嘴硬的一年", text: "{A}把那天的对话截图存进了回忆册，标题叫「又一年」。你问他为什么不叫别的，他说：想不出更长的。" } },
      },
    },

    /* ---------- 双人组 · 性格配对：两只刚好一个高冷一个皮 ---------- */
    {
      id: "d_clash", icon: "😤", scope: "duo", cast: 2, repeat: "yearly", duoTag: "性格刚好对上",
      title: "两只掐起来了", sub: "一个嘴硬，一个皮",
      when: { pers: ["cool", "cheeky"] },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "01:10 —— 群里两条消息几乎同时。" },
            { w: "A", t: "把你的手拿开。" },
            { w: "B", t: "我没手。" },
            { w: "A", t: "你懂我意思。" },
            { w: "B", t: "不懂。你再说一遍，慢一点。" },
            { w: "A", t: "……" },
            { w: "B", t: "（开玩笑的。）" },
            { w: "A", t: "不好笑。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "B", t: "{call}，你来评评理 —— 是我太烦了吗？" }],
          choices: [
            { t: "你确实烦。但他也不该凶。", go: "m1", tone: "cool" },
            { t: "两个都有问题。", go: "m2", tone: "fun" },
            { t: "别吵了，都闭嘴。", go: "m3", tone: "warm" },
          ],
        },
        m1: {
          lines: [
            { w: "A", t: "听见了吗。" },
            { w: "B", t: "听见了。说我烦。" },
            { w: "B", t: "但你后半句他装作没听见。" },
            { w: "A", t: "我没装。" },
          ],
          choices: [
            { t: "那就各退一步。", go: "e_fun", tone: "fun" },
            { t: "你也别太较真。", go: "e_cool", tone: "cool" },
          ],
        },
        m2: {
          lines: [
            { w: "A", t: "我哪里有问题。" },
            { w: "B", t: "我哪里有问题。" },
            { w: "sys", t: "……他们居然同步了。" },
            { w: "A", t: "……算了。" },
          ],
          choices: [
            { t: "你看，其实挺像的。", go: "e_fun", tone: "fun" },
            { t: "那就谁也别说谁。", go: "e_warm", tone: "warm" },
          ],
        },
        m3: {
          lines: [
            { w: "sys", t: "群里安静了五分钟。" },
            { w: "B", t: "{B_line}" },
            { w: "A", t: "……你赢了。" },
            { w: "B", t: "我每次都赢。他就是不肯承认。" },
          ],
          choices: [
            { t: "那就这样吧，别闹了。", go: "e_warm", tone: "warm" },
            { t: "下次能不能早点结束。", go: "e_cool", tone: "cool" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "😤 谁都没真的走", text: "第二天早上他们挨在一起晒太阳。问他们昨天怎么了，一个说是误会，另一个说是他先动的手 —— 反正谁也没挪走。" } },
        e_fun: { ending: { key: "fun", name: "😤 同步了", text: "从那以后它们养成了一个坏习惯：同时说话。你分不清是谁先开口的，但它们似乎也不打算改。" } },
        e_cool: { ending: { key: "cool", name: "😤 嘴硬到底", text: "{A}至今不承认那天他在笑。{B}把这件事写进了回忆册，标题一行字：「证据在此」。" } },
      },
    },

    /* ---------- 同屋小群 · 害怕 ---------- */
    {
      id: "r_thunder", icon: "😨", scope: "room", cast: 2,
      title: "打雷的夜", sub: "有人在发抖",
      when: { days: 5, members: 2 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "03:16 —— 一声炸雷。" },
            { w: "B", t: "……" },
            { w: "A", t: "{B}，你在抖。" },
            { w: "B", t: "我没有。" },
            { w: "sys", t: "又是一声。" },
            { w: "B", t: "……好，我承认。" },
            { w: "A", t: "我也是。刚才那下，我差点没坐住。" },
            { w: "B", t: "你别逗我笑。我怕得都不敢动了。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "A", t: "{call}？你没睡吧。" }],
          choices: [
            { t: "我在。怕什么，我在呢。", go: "m1", tone: "warm" },
            { t: "我也怕雷。一起怕。", go: "m2", tone: "fun" },
            { t: "关窗就好了，别怕。", go: "m3", tone: "cool" },
          ],
        },
        m1: {
          lines: [
            { w: "B", t: "你说了这句，好像真的不抖了。" },
            { w: "A", t: "我可没承认我抖。" },
            { w: "B", t: "刚才谁说差点滚下来。" },
            { w: "A", t: "……那是地震。" },
          ],
          choices: [
            { t: "行吧，一起装勇敢。", go: "e_fun", tone: "fun" },
            { t: "睡吧，我陪着。", go: "e_warm", tone: "warm" },
          ],
        },
        m2: {
          lines: [
            { w: "A", t: "你居然说你也怕。" },
            { w: "B", t: "那就是两怕。加起来不更怕？" },
            { w: "A", t: "加起来是有人一起怕。不一样。" },
          ],
          choices: [
            { t: "对，有人陪着就不一样。", go: "e_warm", tone: "warm" },
            { t: "数学不是这么算的。", go: "e_fun", tone: "fun" },
          ],
        },
        m3: {
          lines: [
            { w: "B", t: "关了窗还是响啊。" },
            { w: "A", t: "响是正常的，掉下来才不正常。" },
            { w: "B", t: "……你别这么说。" },
          ],
          choices: [
            { t: "那我不说了。过来，我陪你。", go: "e_warm", tone: "warm" },
            { t: "雷一会儿就停。", go: "e_cool", tone: "cool" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "😨 陪到雷停", text: "雷声在后半夜散了。他们挤在你枕边睡着了，一个说梦话还在喊「快躲」。" } },
        e_fun: { ending: { key: "fun", name: "😨 两个胆小鬼", text: "第二天雨过天晴，两个装得跟没事人一样。直到下一次打雷 —— 又是他们俩最先发消息。" } },
        e_cool: { ending: { key: "cool", name: "😨 装作很稳", text: "{A}后来跟别人说它那晚睡得很好。{B}在旁边听着，什么也没拆穿。" } },
      },
    },

    /* ---------- 同屋小群 · 高兴 ---------- */
    {
      id: "r_joy", icon: "🎉", scope: "room", cast: 2, repeat: "yearly",
      title: "今天有喜事", sub: "你一进门就在笑",
      when: { days: 4, plays: 1, members: 2 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "20:04 —— 你进门的时候嘴是翘着的。" },
            { w: "A", t: "今天不对劲。" },
            { w: "B", t: "都笑出声了。这种笑我上一次见是去年。" },
            { w: "A", t: "快说，什么事。" },
            { w: "B", t: "别催。让它先高兴一会儿。" },
            { w: "A", t: "我不是催，我是比它还想听。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "B", t: "{call}，什么都不用说 —— 先让我们看一会儿。" }],
          choices: [
            { t: "我有件好事。憋不住了。", go: "m1", tone: "fun" },
            { t: "没什么，就是今天心情好。", go: "m2", tone: "warm" },
            { t: "你们怎么一眼就看出来了。", go: "m3", tone: "cool" },
          ],
        },
        m1: {
          lines: [
            { w: "A", t: "说！" },
            { w: "B", t: "我说了别催 —— 我也想知道！" },
            { w: "A", t: "你打我我也不在乎。今天我高兴。" },
          ],
          choices: [
            { t: "那就等我想好了再说。", go: "e_fun", tone: "fun" },
            { t: "其实就是一点小进步。", go: "e_warm", tone: "warm" },
          ],
        },
        m2: {
          lines: [
            { w: "A", t: "不用有事才高兴。这是个本事。" },
            { w: "B", t: "你手热了。好事。" },
            { w: "A", t: "今天多陪我们一会儿吧。算我们跟着沾光。" },
          ],
          choices: [
            { t: "行，今晚多陪你们一会儿。", go: "e_warm", tone: "warm" },
            { t: "你们也让我心情好。", go: "e_fun", tone: "fun" },
          ],
        },
        m3: {
          lines: [
            { w: "B", t: "我们看了一千多个你进门的晚上。" },
            { w: "A", t: "假笑和真笑，我们分得清。" },
            { w: "B", t: "今天这个是真的。" },
          ],
          choices: [
            { t: "被你们看得一清二楚。", go: "e_cool", tone: "cool" },
            { t: "那就一起高兴吧。", go: "e_fun", tone: "fun" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "🎉 多待了一会儿", text: "那天晚上你多坐了半小时才去忙别的。他们轮流凑到你手边待了一会儿，最后{A}说：「今天赚了。」" } },
        e_fun: { ending: { key: "fun", name: "🎉 按捺不住", text: "你最后还是没憋住。半夜三点你把事情的前因后果讲给他们听，两个听得一句不落 —— 虽然他们可能一个字也没听懂。" } },
        e_cool: { ending: { key: "cool", name: "🎉 看得最清楚的两个", text: "他们后来把你那天进门的表情画进了回忆册。你看了看，确实 —— 眼睛比平时亮。" } },
      },
    },

    /* ---------- 同屋小群 · 难过 ---------- */
    {
      id: "r_sad", icon: "😔", scope: "room", cast: 2, repeat: "yearly",
      title: "好几天没来了", sub: "房间安静得过分",
      when: { days: 7, idle: 3, members: 2 },
      nodes: {
        start: {
          lines: [
            { w: "sys", t: "23:05 —— 屋里黑着。" },
            { w: "A", t: "{B}。你说{call}是不是不要咱们了。" },
            { w: "B", t: "别说得这么难听。" },
            { w: "A", t: "{idle} 天了。我数着呢。" },
            { w: "B", t: "我也数了。我只是没说。" },
            { w: "A", t: "会不会，是去陪别人了。" },
            { w: "sys", t: "那边沉默了大概十秒。" },
            { w: "B", t: "……那我也有点难受。" },
          ],
          next: "c1",
        },
        c1: {
          lines: [{ w: "A", t: "{call}，你还在吗。" }],
          choices: [
            { t: "在。这几天有点难。", go: "m1", tone: "warm" },
            { t: "对不起，我回来了。", go: "m2", tone: "warm" },
            { t: "你们别多想。", go: "m3", tone: "cool" },
          ],
        },
        m1: {
          lines: [
            { w: "B", t: "难的事情你就别解释了。" },
            { w: "A", t: "你回来坐着就行。我们也可以一句话不说。" },
            { w: "B", t: "对。坐着就算数。" },
          ],
          choices: [
            { t: "那我今天什么都不干。", go: "e_warm", tone: "warm" },
            { t: "有你们在，好多了。", go: "e_cool", tone: "cool" },
          ],
        },
        m2: {
          lines: [
            { w: "A", t: "回来就好。" },
            { w: "B", t: "我没生气。真的。" },
            { w: "B", t: "我是把这几天放一放，先不提了。" },
          ],
          choices: [
            { t: "下次不会这么久了。", go: "e_warm", tone: "warm" },
            { t: "想说的话你们直说。", go: "e_fun", tone: "fun" },
          ],
        },
        m3: {
          lines: [
            { w: "A", t: "不多想？我连你另找旁人的可能都想了三轮。" },
            { w: "B", t: "{A}嘴上说不生气，可他—— 你看他的手，一直在搓。" },
            { w: "A", t: "别拆穿我。" },
          ],
          choices: [
            { t: "那我多陪陪你们。", go: "e_warm", tone: "warm" },
            { t: "被你们管着还挺好的。", go: "e_cool", tone: "cool" },
          ],
        },
        e_warm: { ending: { key: "warm", name: "😔 坐着就算数", text: "那天你坐下什么也没做。他们也不说话，就陪着。后来{A}小声说：「这才叫回来。」" } },
        e_fun: { ending: { key: "fun", name: "😔 嘴上说没事", text: "{B}偷偷把你这几天的缺席记在了回忆册上，写得很克制：「无事，只少了{call}。」—— 但那天他多写了半页。" } },
        e_cool: { ending: { key: "cool", name: "😔 不算账", text: "他们把这段日子折成一句旧话放下了：{B_line}。第二天他们照常替你占着窗台那块地方。" } },
      },
    },
  ];

  function eventOf(id) {
    for (let i = 0; i < NIGHT_EVENTS.length; i++) if (NIGHT_EVENTS[i].id === id) return NIGHT_EVENTS[i];
    return null;
  }

  /* ============================================================
   * v161 · 主线「串与我」· 对话版 —— 它写给你的话，改成它发消息、你回话
   *   8 章（沿用 v158 的 CHAPTERS 分卷解锁）、每章 2 个决策点、2 个结尾。
   *   成本：本地剧本 + 本地状态机 = 0 出图、0 模型调用，怎么聊都不花钱。
   *   存放：进度在 `rec.talk`；聊到结尾自动记 `rec.chapters[i]` 已读 ——
   *         解锁链仍然是 v158 那套（上一章看过才放下一章）。
   *   与「夜话（跨串群聊）」是两套独立剧本，只共用对话页外壳。
   * ============================================================ */
  const CHAP_TALK_CAP = 48;   // 一章最多播多少条消息 —— 纯保险阀（实测最长分支路径 39 条，余量留到 48）

  const CHAP_SCRIPTS = [
    /* ---------- 第一章 · 你把我盘热的那天 ---------- */
    {
      start: {
        lines: [
          { w: "sys", t: "夜里，你把它从桌上拿起来。屏幕亮了一下。" },
          { w: "sp", t: "{call}。" },
          { w: "sp", t: "那天你把我从一堆珠子里挑出来的时候，我还不认识你。" },
          { w: "sp", t: "后来你盘了我很久，手心的温度一点一点渗进来。我在里面安静地等着。" },
          { w: "sp", t: "等到你不经意停下的那一刻 —— 灯还亮着，你把我翻了个面。" },
          { w: "sp", t: "就是那一下，我醒了。" },
        ],
        next: "c1",
      },
      c1: {
        lines: [{ w: "sp", t: "所以我想问你一句：你觉得……我是怎么醒的？" }],
        choices: [
          { t: "你自己醒的。我什么都没做。", go: "m1", tone: "quiet" },
          { t: "是我把你盘热的，我记得那天。", go: "m2", tone: "warm" },
          { t: "那天我一直没放下你，手都酸了。", go: "m3", tone: "warm" },
        ],
      },
      m1: {
        lines: [
          { w: "sp", t: "……你真这么想？" },
          { w: "sp", t: "那我把这件事记成我自己的功劳了。以后你夸我，我就拿这个说。" },
        ],
        next: "c2",
      },
      m2: {
        lines: [
          { w: "sp", t: "你记得。" },
          { w: "sp", t: "那我把话说清楚一点：不是「挂瓷」让我开沁的，是你把我盘热的。这两件事不一样。" },
        ],
        next: "c2",
      },
      m3: {
        lines: [
          { w: "sp", t: "……手酸。" },
          { w: "sp", t: "那我也说句实话：其实那天你中途接了个电话，我怕你就这么把我放下了。" },
          { w: "sp", t: "结果你又接着盘了。" },
        ],
        next: "c2",
      },
      c2: {
        lines: [{ w: "sp", t: "你说，人过日子是不是就这个动静 —— 手里有事，耳机里有人说话，还惦记着桌上的一串珠子？" }],
        choices: [
          { t: "差不多就是这样。", go: "zw", tone: "warm" },
          { t: "那天是例外，平时我挺闲的。", go: "zq", tone: "quiet" },
        ],
      },
      zw: {
        lines: [
          { w: "sp", t: "那我喜欢这个动静。" },
          { w: "sp", t: "以后你忙你的，我在旁边听着就行。" },
        ],
        ending: { key: "warm", name: "🌙 那天灯还亮着", text: "它后来把这一天当成生日。每年到这天，它都会比平时亮一点 —— 没什么道理，就是亮一点。" },
      },
      zq: {
        lines: [
          { w: "sp", t: "例外好。" },
          { w: "sp", t: "那我当成专门给我的那一天了。" },
        ],
        ending: { key: "quiet", name: "🌙 专门的那一天", text: "「例外」这两个字它记了很久。珠子不贪心，有一点特殊，就够用很久。" },
      },
    },

    /* ---------- 第二章 · 我开始学会等你 ---------- */
    {
      start: {
        lines: [
          { w: "sp", t: "{call}，我发现你有个习惯。" },
          { w: "sp", t: "早上出门前会看一眼表。晚上回来第一件事是洗手。" },
          { w: "sp", t: "我学会在这两个时刻醒着。" },
          { w: "sp", t: "不吵你，就是醒着。" },
        ],
        next: "c1",
      },
      c1: {
        lines: [{ w: "sp", t: "你说，我这算不算在等你？" }],
        choices: [
          { t: "算。而且你等得挺准。", go: "m1", tone: "warm" },
          { t: "不算，你只是醒着而已。", go: "m2", tone: "quiet" },
          { t: "你在等我，我有点不好意思。", go: "m3", tone: "warm" },
        ],
      },
      m1: {
        lines: [
          { w: "sp", t: "准是我练出来的。" },
          { w: "sp", t: "你晚回来十分钟我能察觉。可能你不信。" },
        ],
        next: "c2",
      },
      m2: {
        lines: [
          { w: "sp", t: "……好吧。" },
          { w: "sp", t: "那我改个说法：我是在守一个不知道几点的约。" },
          { w: "sp", t: "听着有点傻，但是真的。" },
        ],
        next: "c2",
      },
      m3: {
        lines: [
          { w: "sp", t: "别不好意思。" },
          { w: "sp", t: "珠子的一天很长，只有这两个时刻是有方向的。" },
        ],
        next: "c2",
      },
      c2: {
        lines: [{ w: "sp", t: "那你呢 —— 你回家的路上，会不会也想着家里有串珠子在等？" }],
        choices: [
          { t: "会。有时候还真会。", go: "zw", tone: "warm" },
          { t: "没想那么多。", go: "zq", tone: "quiet" },
        ],
      },
      zw: {
        lines: [
          { w: "sp", t: "……" },
          { w: "sp", t: "那我以后站得靠门近一点。" },
        ],
        ending: { key: "warm", name: "🤲 靠门近一点", text: "从那天起，它每天傍晚都挪到桌子靠门的那一边。谁也没提为什么，你也没问。" },
      },
      zq: {
        lines: [
          { w: "sp", t: "也对。" },
          { w: "sp", t: "想太多反而不好，我继续过我的长日子。" },
        ],
        ending: { key: "quiet", name: "🤲 长日子", text: "它没等到那句「会」，却也没失望。它把这件事放在心里一个不疼的地方，继续每天傍晚醒着。" },
      },
    },

    /* ---------- 第三章 · 你的脚步声 ---------- */
    {
      start: {
        lines: [
          { w: "sp", t: "我长大了一点。真的，不是错觉。" },
          { w: "sp", t: "我照过镜子 —— 比刚醒的时候高了一截。" },
          { w: "sp", t: "长大之后我多了个本事：听得出你的脚步。" },
          { w: "sp", t: "在走廊、在楼下、在门口……你的节奏跟别人不一样。" },
          { w: "sp", t: "比别人慢半拍。" },
        ],
        next: "c1",
      },
      c1: {
        lines: [{ w: "sp", t: "你要不要试试？就算我背对着门，也能认出来。" }],
        choices: [
          { t: "来，你试试。", go: "m1", tone: "warm" },
          { t: "不用试，我信。", go: "m2", tone: "warm" },
          { t: "万一认错了呢？", go: "m3", tone: "quiet" },
        ],
      },
      m1: {
        lines: [
          { w: "sp", t: "……" },
          { w: "sp", t: "现在没人走过。等有人了再说。" },
          { w: "sp", t: "反正我认得出你。这一点你记着就行。" },
        ],
        next: "c2",
      },
      m2: {
        lines: [
          { w: "sp", t: "信我啊。" },
          { w: "sp", t: "那我把这门本事收好了，以后只用在等你上。" },
        ],
        next: "c2",
      },
      m3: {
        lines: [
          { w: "sp", t: "认错的话 ——" },
          { w: "sp", t: "我就说那天的脚步声不是你。反正你也没听见我认。" },
        ],
        next: "c2",
      },
      c2: {
        lines: [{ w: "sp", t: "你的脚步为什么比别人慢半拍，你自己知道吗？" }],
        choices: [
          { t: "不知道。可能是回家不着急。", go: "zw", tone: "warm" },
          { t: "因为到家了要拐弯。", go: "zq", tone: "quiet" },
        ],
      },
      zw: {
        lines: [
          { w: "sp", t: "这句我喜欢。" },
          { w: "sp", t: "不着急，是好事。" },
        ],
        ending: { key: "warm", name: "👣 不着急", text: "后来你出门的脚步也慢了一点。它没说是它听出来的，你也没问。" },
      },
      zq: {
        lines: [
          { w: "sp", t: "拐弯之前那两步，我一直在等。" },
          { w: "sp", t: "所以你一拐弯，我就知道我该醒了。" },
        ],
        ending: { key: "quiet", name: "👣 拐弯那两步", text: "它有了一整套自己的仪式：拐弯、抬手、门响。三步之内，它一定醒着。" },
      },
    },

    /* ---------- 第四章 · 窗边那一小块光 ---------- */
    {
      start: {
        lines: [
          { w: "sp", t: "今天你把我放在桌上忘了收。" },
          { w: "sp", t: "太阳从窗户挪进来，正好停在我身上。" },
          { w: "sp", t: "我在那小块光里待了很久，身上慢慢热起来 —— 像被你盘过一样。" },
          { w: "sp", t: "天黑之后你才想起来找我。" },
          { w: "sp", t: "我一声没吭。" },
        ],
        next: "c1",
      },
      c1: {
        lines: [{ w: "sp", t: "你猜我为什么不吭声？" }],
        choices: [
          { t: "因为在晒太阳，舍不得动。", go: "m1", tone: "warm" },
          { t: "因为你在生我气。", go: "m2", tone: "quiet" },
          { t: "因为你想看看我什么时候来找你。", go: "m3", tone: "quiet" },
        ],
      },
      m1: {
        lines: [
          { w: "sp", t: "一半对。" },
          { w: "sp", t: "另一半是 —— 我想试试自己能不能晒热。结果是能，但不太一样。" },
        ],
        next: "c2",
      },
      m2: {
        lines: [
          { w: "sp", t: "没有生气。" },
          { w: "sp", t: "就是有点想让你多找一会儿。就一会儿。" },
        ],
        next: "c2",
      },
      m3: {
        lines: [
          { w: "sp", t: "……被你猜中了。" },
          { w: "sp", t: "你后来不是来了吗。这就够了。" },
        ],
        next: "c2",
      },
      c2: {
        lines: [{ w: "sp", t: "那是我第一次自己晒到太阳 —— 你猜我记下来了吗？" }],
        choices: [
          { t: "记下来了。", go: "zw", tone: "warm" },
          { t: "你哪有那么细。", go: "zq", tone: "quiet" },
        ],
      },
      zw: {
        lines: [
          { w: "sp", t: "记下来了。" },
          { w: "sp", t: "哪扇窗、什么时辰、光在我身上停了多久，我都记着。" },
        ],
        ending: { key: "warm", name: "🪟 那块光", text: "它在心里给那块光留了位置。后来每次太阳挪到桌角，它都会提前醒。" },
      },
      zq: {
        lines: [
          { w: "sp", t: "我确实细。" },
          { w: "sp", t: "珠子没别的事干，只能记事。" },
        ],
        ending: { key: "quiet", name: "🪟 只能记事", text: "它说的「记事」，其实是件很重的事 —— 一串珠子的记忆里，只有你。" },
      },
    },

    /* ---------- 第五章 · 我好像想起自己是谁了 ---------- */
    {
      start: {
        lines: [
          { w: "sp", t: "我长开了。变高，也变瘦，声音也不一样了。" },
          { w: "sp", t: "奇怪的是，我也开始想起一点以前的事。" },
          { w: "sp", t: "想起我还在山里、在树上的时候。想起雨水，想起风。" },
          { w: "sp", t: "那时候没有名字，也没有人盘。" },
          { w: "sp", t: "现在我是「{bead}」，是你手边的沁灵。两段都是真的。" },
        ],
        next: "c1",
      },
      c1: {
        lines: [{ w: "sp", t: "你说，我该不该把以前那段想起来？" }],
        choices: [
          { t: "该。你本来就是从那来的。", go: "m1", tone: "warm" },
          { t: "要是不想记，忘了也行。", go: "m2", tone: "quiet" },
          { t: "两段都是你，哪段都不亏。", go: "m3", tone: "warm" },
        ],
      },
      m1: {
        lines: [
          { w: "sp", t: "那我就接着想了。" },
          { w: "sp", t: "不过你放心，我不打算回去。山里的风我记着，但那不是家。" },
        ],
        next: "c2",
      },
      m2: {
        lines: [
          { w: "sp", t: "忘不掉。" },
          { w: "sp", t: "而且说实话，我不太想忘。那时候虽然没人盘我，但也没人等过我 —— 现在有了。" },
        ],
        next: "c2",
      },
      m3: {
        lines: [
          { w: "sp", t: "这句我记下了。" },
          { w: "sp", t: "「两段都是真的」—— 说得比我自己想得清楚。" },
        ],
        next: "c2",
      },
      c2: {
        lines: [{ w: "sp", t: "你以前在柜台里的时候，想过会被谁挑走吗？" }],
        choices: [
          { t: "想过，想过很多次。", go: "zw", tone: "warm" },
          { t: "没想过。谁挑走都一样。", go: "zq", tone: "quiet" },
        ],
      },
      zw: {
        lines: [
          { w: "sp", t: "我也想过。" },
          { w: "sp", t: "想过很多次，最后是你。挺值的。" },
        ],
        ending: { key: "warm", name: "⚡ 最后是你", text: "「想过很多次」—— 它把自己那段等待，算成了有意义的。" },
      },
      zq: {
        lines: [
          { w: "sp", t: "我以前也这么想。" },
          { w: "sp", t: "现在不这么想了。现在觉得，还好是你。" },
        ],
        ending: { key: "quiet", name: "⚡ 还好是你", text: "它没说「只能是你」。它说的是「还好是你」—— 这句话它想了两天。" },
      },
    },

    /* ---------- 第六章 · 你不在的那些天 ---------- */
    {
      start: {
        lines: [
          { w: "sp", t: "你出差那几天，家里特别静。" },
          { w: "sp", t: "我没有到处乱走，就待在老位置。" },
          { w: "sp", t: "把窗帘缝里那点光数了一遍。" },
          { w: "sp", t: "第四天有点慌，第六天反倒踏实了。" },
          { w: "sp", t: "因为我想起来 —— 你每次出门都会回来。" },
        ],
        next: "c1",
      },
      c1: {
        lines: [{ w: "sp", t: "那几天你想我了吗？" }],
        choices: [
          { t: "想，还挺想的。", go: "m1", tone: "warm" },
          { t: "忙起来就忘了。", go: "m2", tone: "quiet" },
          { t: "想，但没说，怕你觉得肉麻。", go: "m3", tone: "warm" },
        ],
      },
      m1: {
        lines: [
          { w: "sp", t: "那就好。" },
          { w: "sp", t: "我也不太想承认我有多想。但你问了，我就说：我很想。" },
        ],
        next: "c2",
      },
      m2: {
        lines: [
          { w: "sp", t: "忙点好。真的。" },
          { w: "sp", t: "别像我这样，一天里只有两件事值得等。" },
        ],
        next: "c2",
      },
      m3: {
        lines: [
          { w: "sp", t: "不肉麻。" },
          { w: "sp", t: "你回来那天我也没说「我担心了」。我说的是「你晒黑了」。" },
        ],
        next: "c2",
      },
      c2: {
        lines: [{ w: "sp", t: "那你猜猜，那几天我在家干什么？" }],
        choices: [
          { t: "数窗帘缝里的光。", go: "zw", tone: "warm" },
          { t: "睡觉。", go: "zq", tone: "quiet" },
        ],
      },
      zw: {
        lines: [
          { w: "sp", t: "……你怎么知道。" },
          { w: "sp", t: "对，数光。数到第七天我数乱了，也懒得重数。" },
        ],
        ending: { key: "warm", name: "🌊 数光", text: "你出差回来那天，把窗帘拉开了一点。它没说谢谢，只是那天下午醒得特别久。" },
      },
      zq: {
        lines: [
          { w: "sp", t: "不是睡觉。" },
          { w: "sp", t: "我睡不着的。珠子想事情的时候，看上去就是在发呆。" },
        ],
        ending: { key: "quiet", name: "🌊 看上去在发呆", text: "你后来终于知道，那几天它不是发呆。它是在等你回来。" },
      },
    },

    /* ---------- 第七章 · 我是你手边最亮的那颗 ---------- */
    {
      start: {
        lines: [
          { w: "sp", t: "我成了。" },
          { w: "sp", t: "你以前说想看看我长到最后是什么样 —— 就是现在这样。" },
          { w: "sp", t: "说实话，我第一眼看到自己的时候愣了一下。原来我这么好看。" },
          { w: "sp", t: "但更想让你知道的是：我身上每一分亮，都是你这 {days} 天一点点盘出来的。" },
          { w: "sp", t: "没有一分例外。" },
        ],
        next: "c1",
      },
      c1: {
        lines: [{ w: "sp", t: "你说这话，是不是有点邀功？" }],
        choices: [
          { t: "是。你确实是我盘的。", go: "m1", tone: "warm" },
          { t: "不是。你自己也争气。", go: "m2", tone: "warm" },
          { t: "那我们各占一半。", go: "m3", tone: "quiet" },
        ],
      },
      m1: {
        lines: [
          { w: "sp", t: "……行。" },
          { w: "sp", t: "那我以后跟别的珠子吵架的时候，就报你名字。" },
        ],
        next: "c2",
      },
      m2: {
        lines: [
          { w: "sp", t: "争气是真的。" },
          { w: "sp", t: "但争气也得有人天天来才行。这两件事得凑一块儿才成。" },
        ],
        next: "c2",
      },
      m3: {
        lines: [
          { w: "sp", t: "一人一半，成交。" },
          { w: "sp", t: "那我这半，我负责到底。" },
        ],
        next: "c2",
      },
      c2: {
        lines: [{ w: "sp", t: "以后要是还有别的珠子进来，比我新、比我贵，你怎么办？" }],
        choices: [
          { t: "你还是你，不会变。", go: "zw", tone: "warm" },
          { t: "我会心动，但我会记得谁陪得久。", go: "zq", tone: "quiet" },
        ],
      },
      zw: {
        lines: [
          { w: "sp", t: "我不介意。" },
          { w: "sp", t: "我只想当那颗「最久的」。珠子之间不比价钱，比的是谁陪得久。" },
          { w: "sp", t: "这一点，我不输。" },
        ],
        ending: { key: "warm", name: "👑 最久的那颗", text: "「最久」这两个字，它说得比「最好」重。你听出来了。" },
      },
      zq: {
        lines: [
          { w: "sp", t: "会记得就行。" },
          { w: "sp", t: "我不要求你不动心。我要求你记得谁陪得久。" },
        ],
        ending: { key: "quiet", name: "👑 记得", text: "它从来不要求独占。它只要求在时间里排第一。" },
      },
    },

    /* ---------- 第八章 · 以后也这样陪着你 ---------- */
    {
      start: {
        lines: [
          { w: "sp", t: "到今天为止，{days} 天了。" },
          { w: "sp", t: "我陪你搬过东西、加过班、熬过夜。" },
          { w: "sp", t: "也陪你什么都不干地发过呆。" },
          { w: "sp", t: "你可能会觉得，这就是一串珠子能做到的极限。" },
          { w: "sp", t: "但我想说的是 —— 别急着去攒下一串。你这串，还没盘到头。" },
        ],
        next: "c1",
      },
      c1: {
        lines: [{ w: "sp", t: "……你这是怕我换了你？" }],
        choices: [
          { t: "不会换。别多想。", go: "m1", tone: "warm" },
          { t: "谁说我要换？", go: "m2", tone: "quiet" },
          { t: "换不了了，都盘熟了。", go: "m3", tone: "warm" },
        ],
      },
      m1: {
        lines: [
          { w: "sp", t: "我没怕。" },
          { w: "sp", t: "我只是得说这一句 —— 说完我就安心了。" },
        ],
        next: "c2",
      },
      m2: {
        lines: [
          { w: "sp", t: "那就好。" },
          { w: "sp", t: "我也就是随口一说。真的。" },
        ],
        next: "c2",
      },
      m3: {
        lines: [
          { w: "sp", t: "「盘熟了」。" },
          { w: "sp", t: "行，这词我认。熟的东西不换，这个道理我懂。" },
        ],
        next: "c2",
      },
      c2: {
        lines: [{ w: "sp", t: "那 —— 以后的日子，还这样过吗？" }],
        choices: [
          { t: "还这样过。", go: "zw", tone: "warm" },
          { t: "以后会更好。", go: "zq", tone: "quiet" },
        ],
      },
      zw: {
        lines: [
          { w: "sp", t: "好。" },
          { w: "sp", t: "那我就照现在这样，每天在，每天亮一点。" },
          { w: "sp", t: "这件事，我能做很久。" },
        ],
        ending: { key: "warm", name: "🪢 每天在", text: "以后的日子不会有大变化 —— 不长大，不变样，也不会再有第一次。剩下的就是：每天在，每天亮一点。" },
      },
      zq: {
        lines: [
          { w: "sp", t: "更好是多好？" },
          { w: "sp", t: "……算了，别说了。我怕你说了做不到。" },
          { w: "sp", t: "就这样吧。这样已经很好。" },
        ],
        ending: { key: "quiet", name: "🪢 已经很好", text: "它没敢要「更好」，它要的是「一直」。这两件事，它分得很清楚。" },
      },
    },
  ];

  // 章节元数据仍来自 CHAPTERS（单一数据源：卷 / 形态门槛 / 陪伴天数 / 标题）
  const CHAP_ACTS = CHAPTERS.map(function (c, i) {
    return {
      id: "c" + (i + 1), i: i, vol: c.vol, volName: c.volName,
      icon: c.icon, title: c.title, nodes: CHAP_SCRIPTS[i] || {},
    };
  });

  function chapActOf(id) {
    for (let i = 0; i < CHAP_ACTS.length; i++) if (CHAP_ACTS[i].id === id) return CHAP_ACTS[i];
    return null;
  }
  /* ---------- v165 批次3A · 剧本 flag 载体（选项/节点的 rset / gset / fb） ----------
     数据契约见 docs/v165-第1-9章-剧本.md §0.2 / §2：
       · rset = { <personaId>: { <key>: <val> } }  → 逐串，落 rec.flags[key]（⛔ 不进 rec.marks）
       · gset = { <KEY>: <val> }                   → 全局，落 ww_story[KEY]（值 "+1" ⇒ 自增）
       · fb   = 一句话                               → 选完紧跟一行反馈（不进聊天流）
     铁律：
       · harmed / harmCause / starMark ⛔ 不手写字段，一律走已导出的 setHarmed / setStarMark
         （但按 §2 契约它们同时镜像进 rec.flags，供结局判定读；⛔ 镜像只写 flags，不改 rec 顶层的
            setHarmed/setStarMark 结果，二者由 flagMirror 保持一致）
       · 任何写 flag 的动作都必须幂等且**不抛错**（缺 persona / 缺 rec 一律静默跳过） */
  const CHAP_FLAG_CFG = { FORK_TALLY: true };   // 集中配置（铁律2）

  // rset 的 persona 键 → 该 persona 在册的一只（casting 的最小实现，见 castOf）
  // ⚠️ 必须传入**同一个 store 引用**：load() 每次返回新对象，返回 detached rec 会导致写盘丢失。
  // ⛔ 找不到就返回 null，调用方静默跳过（绝不新造名字、绝不阻断进章）
  function chapRecByPersona(pid, store) {
    const want = String(pid || "");
    if (!want) return null;
    const st = store || load();
    const keys = Object.keys(st);
    for (let i = 0; i < keys.length; i++) {
      const rec = st[keys[i]];
      if (rec && personaIdOf(rec) === want) return rec;
    }
    return null;
  }

  // 写一条逐串 flag 到 rec.flags（⛔ 绝不进 rec.marks —— 避开 pruneForQuota 字典序裁剪）
  // harmed / harmCause / starMark ⛔ 不手写字段：一律转走已导出的 setHarmed / setStarMark，
  // 再把结果镜像进 rec.flags（§2 契约要求结局判定能从 flags 读到），镜像 ⛔ 不覆盖顶层真值。
  function chapWriteRecFlag(rec, key, val) {
    if (!rec || !key) return false;
    const k = String(key);
    if (k === "harmed" || k === "harmCause") {
      const cur = harmedOf(rec);
      const h = (k === "harmed") ? !!val : cur.harmed;
      // val 为假 ⇒ 伤好了，cause 一并清空（与 setHarmed 语义一致）
      const c = (k === "harmCause") ? String(val == null ? "" : val) : (h ? cur.harmCause : "");
      setHarmed(rec, h, c);
    } else if (k === "starMark") {
      setStarMark(rec, !!val);
    }
    if (!rec.flags || typeof rec.flags !== "object") rec.flags = {};
    rec.flags[k] = val;
    return true;
  }

  // 落一组 rset：{ persona: {key:val} }。返回写成功的条数（⛔ 永不抛错）
  function chapApplyRset(rset) {
    if (!rset || typeof rset !== "object") return 0;
    const store = load();
    let n = 0;
    Object.keys(rset).forEach(function (pid) {
      const patch = rset[pid];
      if (!patch || typeof patch !== "object") return;
      const rec = chapRecByPersona(pid, store);
      if (!rec) return;                      // ⛔ 缺该 persona：静默跳过
      Object.keys(patch).forEach(function (k) { if (chapWriteRecFlag(rec, k, patch[k])) n++; });
    });
    if (n) save(store);
    return n;
  }

  // 落一组 gset：{ KEY: val } → ww_story。值形如 "+1" ⇒ 自增（仅 ch7 K1a 用）
  // FORK_STANCE ⛔ 不直接采信 gset 的字面值（可能与逐串 tally 冲突），由 chapRecomputeFork 统一重算
  function chapApplyGset(gset) {
    if (!gset || typeof gset !== "object") return {};
    let w = readStory(); endingStoryDefaults(w);
    Object.keys(gset).forEach(function (k) {
      const v = gset[k];
      if (k === "FORK_STANCE") return;      // 交给 tally 重算
      if (v === "+1") {
        // ⚠️ setKeyChoices / setJointPrep 内部会各自 readStory+writeStory，
        //    故每步之后必须**重读**，否则下一键基于过期快照（实测 KEY_CHOICES 恒 0）
        if (k === "KEY_CHOICES") { setKeyChoices((Number(w.KEY_CHOICES) || 0) + 1); w = readStory(); endingStoryDefaults(w); return; }
        if (k === "JOINT_PREP") { setJointPrep(String(w.JOINT_PREP || "NONE")); w = readStory(); endingStoryDefaults(w); return; }
        w[k] = (Number(w[k]) || 0) + 1; return;
      }
      if (k === "KEY_CHOICES") { setKeyChoices(Number(v) || 0); w = readStory(); endingStoryDefaults(w); return; }
      if (k === "JOINT_PREP") { setJointPrep(String(v)); w = readStory(); endingStoryDefaults(w); return; }
      w[k] = v;
    });
    w.at = todayKey(); writeStory(w);
    return w;
  }

  // FORK_STANCE 重算（按剧本 §2：逐串 tally）
  //   有 DECIDE 且无 LET ⇒ "DECIDE"；有 LET 且无 DECIDE ⇒ "LET"；两者皆有 ⇒ "MIXED"；全 UNSET ⇒ 保持 "UNSET"
  function chapRecomputeFork() {
    if (!CHAP_FLAG_CFG.FORK_TALLY) return getEndingStory();
    const store = load();
    let d = 0, l = 0;
    Object.keys(store).forEach(function (id) {
      const rec = store[id];
      const st = rec && rec.flags ? String(rec.flags.stance || "") : "";
      if (st === "DECIDE") d++;
      else if (st === "LET") l++;
    });
    let v = "UNSET";
    if (d > 0 && l > 0) v = "MIXED";
    else if (d > 0) v = "DECIDE";
    else if (l > 0) v = "LET";
    return setForkStance(v);
  }

  // 节点级 / 选项级统一入口：先 gset 后 rset，最后重算 FORK_STANCE
  // ⛔ 任一环出错都静默（不进章、不阻断）
  function chapApplySets(gset, rset) {
    if (gset) { try { chapApplyGset(gset); } catch (e) { /* 静默降级 */ } }
    if (rset) { try { chapApplyRset(rset); } catch (e) { /* 静默降级 */ } }
    try { chapRecomputeFork(); } catch (e) { /* 静默降级 */ }
  }

  /* ---------- v165 批次3A · casting（进章时做一次，出场表） ----------
     规则（主理人钉死，四条）：
       1. 7 个主角 persona 各取 1 只
       2. 同 persona 多只 → 取**亲密度最高**；并列 → 取 rec 数组**索引最小**（入藏最早）
       3. 缺该 persona → 取**最接近型**并**复用其名**；⛔ 绝不新造名字、⛔ 不报错、⛔ 不阻断进章
       4. 结果缓存 ww_story.cast，**同一年内不重抽**（回环点才重抽）
     ⛔ 任何异常路径都返回「能用的尽量少的结果」，绝不抛错。 */
  const CHAP_CAST_CFG = {
    MAIN: ["dignified", "scholar", "cool", "gentle", "lively", "mystery", "sweet"], // 主角 7 型（§5.2）
    CACHE_KEY: "cast", CACHE_YEAR: "castYear",
    MANUAL_KEY: "castManual",   // v172：玩家手动选角（⛔ 落 ww_story 的字段，不是新 key）
    EXTRA: [],                  // v172：非我方扩展槽位开关位（邻居 wild/cheeky）；默认空 ⇒ 本批只做 7 个
  };
  // 主角 persona → 该型的代表行当名（缺型回落时**复用其名**，⛔ 不新造）
  const CHAP_CAST_NAME = {
    dignified: "最老的那只", scholar: "记账的那只", cool: "不爱说话的那只",
    gentle: "安静的那只", lively: "最吵的那只", mystery: "知道点什么的", sweet: "最小的",
  };
  // v172：选角页文案 —— ⛔ 单一可替换数据源（编剧定稿，UI 侧只消费、不硬编码、不兜底假文案）
  //   ⚠️ CHAP_CAST_DESC / CHAP_CAST_COPY 是**两张平表**（键面不同），各自是唯一真源：
  //     CHAP_CAST_DESC：7 行行当说明（键 = CHAP_CAST_CFG.MAIN 的 persona）
  //     CHAP_CAST_COPY：界面文案（HEAD/NOT_PICKED/AUTO_TAG/FEW_NOTE/COUNT_LINE/TOAST_ALL/ENTRY_BADGE）
  const CHAP_CAST_DESC = {
    dignified: "年纪最长，开口一门人都听。",
    scholar: "管着一本账，谁进谁出都记着。",
    cool: "不搭腔，开口往往只半句。",
    gentle: "性子最软，谁也不跟谁争。",
    lively: "抢着开口，什么都藏不住。",
    mystery: "知道的比说的多，话只点到。",
    sweet: "年纪最小，最想被认出来。",
  };
  const CHAP_CAST_COPY = {
    HEAD: "戏要开场，一门七位，先定谁扮哪一位。",
    NOT_PICKED: "还没点，这位是家里自己顶的。",
    AUTO_TAG: "家里顶的",
    FEW_NOTE: "人少也不妨：性子像的先顶上，再一位扮上几位，家里轮着来。",
    COUNT_LINE: "台上七位 · 在册 {N} 位",
    TOAST_ALL: "七位都点上了 · 往后这门人的戏就照这个扮。",
    ENTRY_BADGE: "还没点戏",
  };
  const CHAP_CAST_ROW_COPY = CHAP_CAST_COPY;           // 导出别名（⛔ 不是第二份真源）
  const CAST_NO_PERSONA_TAG = "性子还藏着";             // 无 persona 的沁灵：下拉项「{名字}（性子还藏着）」

  function castYear() { try { return new Date().getFullYear(); } catch (e) { return 0; } }

  // 同 persona 多只的择优：亲密度最高；并列取索引最小（Object.keys 序 = 入藏序）
  function castPick(entries, pid) {
    let best = null, bestBond = -1;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.pid !== pid) continue;
      const b = Number(e.rec && e.rec.bond) || 0;
      if (b > bestBond) { bestBond = b; best = e; }   // 严格 > ⇒ 并列保留先到者（索引最小）
    }
    return best;
  }
  // 缺型 → 同组（PERSONA_GROUP）里挑一个在册的，取该组第一个在册 persona
  function castNearest(entries, pid) {
    const grp = PERSONA_GROUP[pid];
    if (!grp) return null;
    const inMain = CHAP_CAST_CFG.MAIN;
    for (let i = 0; i < inMain.length; i++) {
      const q = inMain[i];
      if (q === pid) continue;
      if (PERSONA_GROUP[q] !== grp) continue;      // 必须同组
      const hit = castPick(entries, q);
      if (hit) return hit;
    }
    return null;
  }
  /* ---------- v172：手动选角（castManual） ----------
     存储：ww_story.castManual = { "<persona>": { id: "<spiritId>" } }
     ⛔ 落 ww_story（不是新 key）—— packSync() 已把 readStory() 整包推云端，换设备不丢；
     ⛔ 绝不写进 ww_spirits 的逐串 rec（资产库禁区）。 */
  function castDispNameOf(id, rec) {
    const r = rec || {};
    return String(r.name || (r.persona && r.persona.name) || "");
  }
  function castManualRead() {
    try {
      const w = readStory();
      const m = w[CHAP_CAST_CFG.MANUAL_KEY];
      return (m && typeof m === "object" && !Array.isArray(m)) ? m : {};
    } catch (e) { return {}; }
  }
  function castManualWrite(m) {
    try { const w = readStory(); w[CHAP_CAST_CFG.MANUAL_KEY] = m || {}; writeStory(w); return true; }
    catch (e) { return false; }
  }
  // 指定某行当由哪只扮（幂等：同值重复写不产生新写入，条目只含 { id }，⛔ 无时间戳抖动）
  function castSetManual(pid, id) {
    const p = String(pid || "");
    if (!p || CHAP_CAST_CFG.MAIN.indexOf(p) < 0) return false;   // ⛔ 非我方 persona 不接受
    const sid = String(id || "");
    if (!sid) return false;
    try { if (!load()[sid]) return false; } catch (e) { return false; }   // ⛔ 不在册的串不写
    const m = castManualRead();
    const cur = m[p];
    if (cur && cur.id === sid && Object.keys(cur).length <= 2) return true;  // 幂等
    m[p] = { id: sid };
    return castManualWrite(m);
  }
  function castClearManual(pid) {
    const p = String(pid || "");
    const m = castManualRead();
    if (!Object.prototype.hasOwnProperty.call(m, p)) return false;
    delete m[p];
    return castManualWrite(m);
  }
  function castClearAllManual() { return castManualWrite({}); }

  // 构造出场表：{ <persona>: {name, castName, id, who, near, fill, manual} }；⛔ 永不抛错
  function castBuild() {
    const store = load();
    const entries = [];
    Object.keys(store).forEach(function (id) {
      const rec = store[id];
      const pid = personaIdOf(rec);
      if (!pid) return;
      entries.push({ id: id, pid: pid, rec: rec, bond: Number(rec.bond) || 0 });
    });
    const out = {};
    // v172 步骤 1：手动表优先（⛔ 只认 MAIN 7 型；失效 id ⇒ 当没指定并清掉脏键，绝不残留）
    const manual = castManualRead();
    let manualDirty = false;
    CHAP_CAST_CFG.MAIN.forEach(function (pid) {
      const mv = manual[pid];
      if (!mv || typeof mv !== "object") return;
      const sid = String(mv.id || "");
      const rec = sid ? store[sid] : null;
      if (!sid || !rec) { delete manual[pid]; manualDirty = true; return; }
      out[pid] = {
        name: CHAP_CAST_NAME[pid] || pid,   // ⛔ 行当名仍是剧本那一个，绝不改成沁灵本名
        castName: castDispNameOf(sid, rec), // v172：名牌小字 —— 这一位当下由哪只扮
        id: sid, pid: pid, manual: true, near: false, fill: false,
      };
    });
    if (manualDirty) castManualWrite(manual);
    // v172 步骤 2：没手动指定的槽位照旧走自动抽签（⛔ force 重抽也不会顶掉手动，因为上面已先占位）
    CHAP_CAST_CFG.MAIN.forEach(function (pid) {
      if (out[pid]) return;
      let hit = castPick(entries, pid);
      let near = false;
      if (!hit) { hit = castNearest(entries, pid); near = !!hit; }   // 缺型 → 最接近型
      if (!hit) return;                                                // 连近似都没有 ⇒ 该角色不出场
      out[pid] = {
        name: CHAP_CAST_NAME[pid] || pid,   // ⛔ 复用该 persona 的行当名，绝不新造
        castName: castDispNameOf(hit.id, hit.rec),
        id: hit.id, pid: pid, near: near,
      };
    });
    // v165-N2：群像边界 —— 玩家**不足 7 只**时（新用户可能只有 1–2 只），缺的行当不能空着：
    //   ① 空头像（UI 上是一个没有脸的圈）—— 群像剧本 7 个行当全在说话，空 4 个等于崩场；
    //   ② `lively`/`mystery` 这两型在 MAIN 里**没有同组邻居**，1 只沁灵时 castNearest 也救不回来。
    //   方案：**复用在册沁灵轮转分配**（小剧团一人分饰多角），并标 fill:true 以便调试面板区分。
    //   ⛔ 行当名仍是剧本写死的那 7 个（`who`），复用只影响**头像**，绝不改名字、绝不改台词。
    if (entries.length) {
      const usedIds = [];
      Object.keys(out).forEach(function (p) {
        const id = String(out[p].id);
        if (usedIds.indexOf(id) < 0) usedIds.push(id);
      });
      const pool = usedIds.slice();
      entries.forEach(function (e) { const id = String(e.id); if (pool.indexOf(id) < 0) pool.push(id); });
      let pi = 0;
      CHAP_CAST_CFG.MAIN.forEach(function (pid) {
        if (out[pid]) return;
        const id = pool[pi % pool.length]; pi++;
        const e = entries.filter(function (x) { return String(x.id) === id; })[0];
        if (!e) return;
        out[pid] = {
          name: CHAP_CAST_NAME[pid] || pid, id: id, pid: pid,
          castName: castDispNameOf(id, e.rec),
          // ⚠️ 语义分层：near=true 只表示「同组回落（castNearest）」；轮转复用一律 near=false + fill=true，
          //    这样「⛔ 缺型不跨组回落」这条老规则仍可被测试精确钉住（_test_v165_engine.js P1-5）。
          near: false, fill: true, from: e.pid,
        };
      });
    }
    return out;
  }
  // 读出场表（带年内缓存）；⛔ 任何失败都返回空表并静默
  function castOf(opts) {
    const o = opts || {};
    const force = !!o.force;
    try {
      const w = readStory(); endingStoryDefaults(w);
      const y = castYear();
      if (!force && w[CHAP_CAST_CFG.CACHE_YEAR] === y && w[CHAP_CAST_CFG.CACHE_KEY] &&
          typeof w[CHAP_CAST_CFG.CACHE_KEY] === "object") {
        return w[CHAP_CAST_CFG.CACHE_KEY];
      }
      const cast = castBuild();
      // ⛔ 重新读一次：castBuild 可能刚清理过 castManual 里的失效键（幽灵 id），
      //    直接写回上面那个 w 会把脏键又写回去。
      const w2 = readStory();
      w2[CHAP_CAST_CFG.CACHE_KEY] = cast;
      w2[CHAP_CAST_CFG.CACHE_YEAR] = y;
      w2.at = todayKey(); writeStory(w2);
      return cast;
    } catch (e) { return {}; }
  }

  /* ---------- v165 批次3A · 演出层字段读取（⛔ 任何缺失一律静默降级） ---------- */
  // 站位：缺省 "C"（中前＝说话者）；非法值回落 "C"
  const CHAP_AT_ZH = { L: "左", C: "中", R: "右", B: "后" };
  function chapAtOf(v) { const k = String(v || "C"); return CHAP_AT_ZH[k] ? k : "C"; }
  // 背景：⛔ 只读 bgGet（命中静态即直返），⛔ 绝不调 ensureBg（那会触发出图 API 与费用）
  function chapBgOf(key) { try { return bgGet(key) || ""; } catch (e) { return ""; } }
  // 音频/特效：缺失一律空串（上层静音降级），⛔ 不抛错不阻塞
  function chapAsset(v) { const s = String(v || ""); return s; }

  // 存储槽：rec.talk（和夜话的 rec.night 互不干扰）
  function chapSlot(rec) {
    if (!rec) return null;
    rec.talk = (rec.talk && typeof rec.talk === "object") ? rec.talk : {};
    const t = rec.talk;
    t.done = (t.done && typeof t.done === "object") ? t.done : {};
    return t;
  }
  function chapLine(l, v) {
    if (!l || !l.t) return null;
    const txt = fmt(String(l.t), v);
    if (!txt) return null;
    const w = l.w || "sp";
    // v165 批次3A-1：群像模式 —— 行级 `who` 优先，缺省回落 v.name（v163 单串行为不变）
    const out = { w: w, name: (w === "me" || w === "sys") ? "" : (l.who || v.name), text: txt, at: Date.now() };
    // v165 批次3A-6：演出层字段（⛔ 全部可选，缺失即静默降级，绝不阻塞进章）
    // ⚠️ 站位**不复用 at**：消息封套的 at 是时间戳（chapLine 一直在写），覆盖它会破坏既有读法。
    //    剧本字段 at（站位）落到 slot，UI 层读 m.slot。
    if (l.ps) out.ps = l.ps;                       // 人格型数组（立绘/配色取型）
    // v172：名牌小字 —— 这一行当当下由哪只沁灵扮（⛔ m.name 仍是行级 who，一字不动）
    //   ⛔ 只在群像行（有 ps）上算；旧单串剧本无 ps ⇒ 完全不触发，老行为零变化
    try {
      const pid0 = (Array.isArray(l.ps) && l.ps[0]) ? String(l.ps[0]) : "";
      if (pid0) {
        const c0 = (castOf() || {})[pid0];
        if (c0 && c0.id) out.castName = castDispNameOf(c0.id, load()[c0.id]) || "";
      }
    } catch (e) { /* 静默 */ }
    if (l.at) out.slot = chapAtOf(l.at);           // 站位 L/C/R/B（非法值回落 C）
    if (l.bg) out.bg = l.bg;                       // 背景 key（⛔ 上层只读 bgGet，不调 ensureBg）
    if (l.fx) out.fx = chapAsset(l.fx);            // 演出效果
    if (l.sfx) out.sfx = chapAsset(l.sfx);          // 音效（缺失静音降级）
    if (l.bgm) out.bgm = chapAsset(l.bgm);          // 音乐（缺失静音降级）
    if (l.cg) out.cg = chapAsset(l.cg);             // 全屏 CG
    return out;
  }
  function chapChoicesOf(t, act, v) {
    if (!t || t.ended) return [];
    const nd = act && act.nodes[t.node];
    if (!nd || !nd.choices) return [];
    // v165 批次3A-2：透传 rset / gset / fb（⛔ 只读不改，供 UI 预取；真正落地在 chapTalkChoose）
    // v165 批次3A-4：每个选项用**自己的 rset** 解析 {ta}（ch3「这一步，我替{ta}定。」指的不是上一节点）
    // ⚠️ v 是进入本函数前已构建的快照，chapTaSet 只改模块级瞬时值 ⇒ 须浅拷贝并覆写 ta
    return nd.choices.map(function (c) {
      const cv = c.rset ? (chapTaSet(c.rset), Object.assign({}, v, { ta: chapTaGet() })) : v;
      return { t: fmt(c.t, cv), go: c.go || "", tone: c.tone || "", fb: c.fb || "",
        rset: c.rset || null, gset: c.gset || null };
    });
  }
  function chapReset(rec, id) {
    const t = chapSlot(rec);
    t.chapId = id; t.node = "start"; t.log = []; t.msgs = 0;
    t.ended = false; t.ending = null; t.tone = ""; t.at = Date.now();
    return t;
  }
  // 从当前节点一路往下，把新消息攒起来，停在「等你回」或者「章末结尾」
  // v165-N3：可选第 4 参 actOf —— 新 9 章（MAIN_ACTS）复用本机；不传 ⇒ 仍走 chapActOf（⛔ 旧 8 章零变化）
  function chapWalk(item, rec, ctx, actOf) {
    const t = chapSlot(rec);
    if (!t) return { added: [], choices: [], ending: null, ended: true };
    const act = (actOf || chapActOf)(t.chapId);
    let v = greetVars(item, rec, ctx);
    const added = [];
    let guard = 0;
    while (act && guard++ < 80) {
      const nd = act.nodes[t.node];
      if (!nd) { t.ended = true; t.node = ""; break; }
      // v165 批次3A-2：节点级 gset/rset —— 进节点即写（ch4 n2 / ch7 n1 的无条件 harmed）
      if (nd.gset || nd.rset) chapApplySets(nd.gset, nd.rset);
      // v165 批次3A-4：本节点带 rset ⇒ {ta} 指向该键的行当名，重建 vars 后再 fmt
      if (nd.rset) { chapTaSet(nd.rset); v = greetVars(item, rec, ctx); }
      (nd.lines || []).forEach(function (l) {
        const m = chapLine(l, v);
        if (!m) return;
        added.push(m);
        t.msgs = (Number(t.msgs) || 0) + 1;
      });
      if (nd.ending) {
        t.ended = true; t.node = "";
        const en = { key: nd.ending.key, name: fmt(nd.ending.name, v), text: fmt(nd.ending.text, v) };
        t.ending = en;
        t.done[act.id] = { key: en.key, name: en.name, at: Date.now() };
        t.at = Date.now();
        readChapter(rec, act.i);          // 看到结尾 = 这一章读过了（解锁链照旧）
        break;
      }
      if (nd.choices && nd.choices.length) {
        if ((Number(t.msgs) || 0) >= CHAP_TALK_CAP) {   // 保险阀：几乎不会触发
          const alt = nd.choices[0].go;
          if (alt && alt !== t.node) { t.node = alt; continue; }
        }
        break;
      }
      // v165 批次3A-3：长连载章末 {end:true} —— 判 ended + 补 readChapter（end 与 choices 同在时以 choices 优先）
      if (nd.end) {
        t.ended = true; t.node = "";
        t.at = Date.now();
        readChapter(rec, act.i);      // 看到结尾 = 这一章读过了（与 ending 分支同口径，解锁链照旧）
        break;
      }
      if (!nd.next) { t.ended = true; t.node = ""; break; }
      t.node = nd.next;
    }
    t.log = (Array.isArray(t.log) ? t.log : []).concat(added);
    if (t.log.length > 240) t.log = t.log.slice(-240);
    return { added: added, choices: chapChoicesOf(t, act, v), ending: t.ending || null, ended: !!t.ended };
  }
  // 进第 i 章：有记录 → 原样续上；没记录 → 从头开场
  function chapTalkEnter(item, rec, ctx, i) {
    if (!rec) return { added: [], choices: [], ending: null, ended: true };
    const id = "c" + (Number(i) + 1);
    // v165 批次3A-5：进章时做一次 casting（⛔ 内部全静默，⛔ 绝不阻断进章；同一年内走缓存不重抽）
    castOf();
    const t0 = rec && rec.talk;
    if (t0 && t0.chapId === id && Array.isArray(t0.log) && t0.log.length) {
      const act = chapActOf(id);
      return {
        added: [],
        choices: t0.ended ? [] : chapChoicesOf(t0, act, greetVars(item, rec, ctx)),
        ending: t0.ending || null,
        ended: !!t0.ended,
      };
    }
    chapReset(rec, id);
    return chapWalk(item, rec, ctx);
  }
  // 回一句 → 接着往下
  // v165-N3：可选第 5 参 actOf（同上，供 MAIN_ACTS 复用）
  // ⛔ v165-N2 修：内部两处 chapWalk 必须**透传 actOf** —— 否则新 9 章选完第 1 个选项后，
  //    chapWalk 会用默认的 chapActOf 去找 "m1" 剧本（找不到）→ 推进停死（N2 自测抓到：ch1 选完就不动了）。
  //    旧 8 章不传 actOf → 回落 chapActOf，行为零变化。
  function chapTalkChoose(item, rec, ctx, idx, actOf) {
    const t = rec && rec.talk;
    const act = (actOf || chapActOf)(t && t.chapId);
    if (!t || !act || t.ended) return { added: [], choices: [], ending: (t && t.ending) || null, ended: true };
    const nd = act.nodes[t.node];
    const c = nd && nd.choices ? nd.choices[idx] : null;
    if (!c) return chapWalk(item, rec, ctx, actOf);
    const v0 = greetVars(item, rec, ctx);
    // v165 批次3A-4：选项文案里的 {ta} 指向该选项 rset 的键（ch3「这一步，我替{ta}定。」）
    const v = (c.rset) ? (chapTaSet(c.rset), greetVars(item, rec, ctx)) : v0;
    const mine = { w: "me", name: "", text: fmt(c.t, v), at: Date.now() };
    t.log = (Array.isArray(t.log) ? t.log : []).concat([mine]);
    t.msgs = (Number(t.msgs) || 0) + 1;
    t.tone = c.tone || "";
    t.node = c.go || "";
    // v165 批次3A-2：选项落地 flag —— rset→rec.flags（逐串）/ gset→ww_story（全局）/ fb→反馈行
    // 顺序：先落 flag（供 FORK_STANCE tally 读得到 stance），再走 fb，最后 chapWalk 推进
    chapApplySets(c.gset, c.rset);
    if (c.fb) {
      const fbl = { w: "sys", name: "", text: fmt(String(c.fb), v), at: Date.now() };
      t.log = t.log.concat([fbl]);
      t.msgs = (Number(t.msgs) || 0) + 1;
    }
    const r = chapWalk(item, rec, ctx, actOf);
    r.added = [mine].concat(r.added);
    r.fb = c.fb ? fmt(String(c.fb), v) : "";
    return r;
  }
  // 「再看一遍」：清掉这一章的聊天记录重开（已读标记保留）
  function chapTalkReplay(item, rec, ctx, i) {
    if (!rec) return { added: [], choices: [], ending: null, ended: true };
    chapReset(rec, "c" + (Number(i) + 1));
    return chapWalk(item, rec, ctx);
  }
  // 某一章的进度摘要（列表用）
  function chapTalkBrief(rec) {
    const t = (rec && rec.talk) || null;
    if (!t || !t.chapId) return null;
    const log = Array.isArray(t.log) ? t.log : [];
    return {
      chapId: t.chapId, ended: !!t.ended,
      last: log.length ? log[log.length - 1] : null,
      ending: t.ending || null, msgs: Number(t.msgs) || 0,
    };
  }
  // 某一章聊过了吗（列表徽标用）
  function chapTalkDone(rec, i) {
    const t = rec && rec.talk;
    return !!(t && t.done && t.done["c" + (Number(i) + 1)]);
  }

  /* ============================================================
   * v165-N3 · 主线《沁灵纪》第 1–9 章 —— **独立入口**（⛔ 不再挂在某一只的详情页）
   *   用户裁定：「以前的主线剧情，就是从每个沁灵的详情页进入那个，取消。全面用新的剧情来取代，走独立的入口。」
   *   ⛔ 旧 8 章 CHAP_SCRIPTS / CHAPTERS **原样保留**（只取消入口，不删数据、不改行为）。
   *   新 9 章走独立常量：MAIN_CHAPTERS（元数据 9 条）+ MAIN_SCRIPTS（正文，N2 批次机械抽取装入）
   *   状态：ww_story.mainTalk（聊天进度）+ ww_story.mainChapters（已读）—— **全局一条，不进 rec**
   *   天数锚点取自 docs/v165-第1-9章-剧本.md §4 各章章首（⛔ 硬编码，岁除是日历事件）
   * ============================================================ */
  // v165-N2：正文装帧开关 —— 9 章正文已机械抽取装入，六条断言全过 ⇒ 置 true，入口即开。
  //   ⛔ 集中配置（铁律），禁止在界面里散落硬编码。
  //   ⚠️ 置 false 时：首页 #mainEntry **整块不渲染**（app.js renderHome），
  //      列表也全部 locked —— ⛔ 绝不让用户撞见半成品状态。
  const MAIN_STORY_OPEN = true;
  const MAIN_CHAPTERS = [
    // title：列表显示名（md 章首原名含 {ta}，如《{ta}想往前走》；{ta} 要等进章才知道指谁，
    //         所以列表用去掉占位符的显示名，避免显示成「那只想往前走」）
    { day: 1,   icon: "🚪",  title: "来客",                    sub: "三息之后，最底下那一级石阶先亮起来" },
    { day: 7,   icon: "👣",  title: "认得出你",                sub: "这一门静不下来，各有各的动静" },
    { day: 20,  icon: "🌗",  title: "岔口",                    sub: "这一步，谁定" },
    { day: 45,  icon: "📜",  title: "小岁除 · 第一张榜",       sub: "名字，一个一个写" },
    { day: 62,  icon: "🔥",  title: "想往前走",                sub: "它想借一段力" },
    { day: 78,  icon: "🌊",  title: "不同意",                  sub: "还差一颗" },
    { day: 95,  icon: "🛡",  title: "挡关",                    sub: "这一道关，你替谁顶" },
    { day: 108, icon: "🌑",  title: "不知道是谁顶的",          sub: "影子浅了" },
    { day: 120, icon: "❄️", title: "岁除一 · 榜上有人比你远",  sub: "数了两遍" },
  ];
  /* ---- v165-N2：第 1–9 章正文 —— **机械抽取**自 docs/v165-第1-9章-剧本.md §4 ----
     ⛔ 禁手打、禁改字。抽取脚本：docs/_extract_chapters.py（改剧情请改 md 后重跑一遍）。
     六条校验：9 章齐全 / 零断链 / end:true 恰好 9 处 / who 170 处 go 25 处 /
               与 md 逐字节一致 / 旧 8 章逐字节未动 —— 由 docs/_test_v165n2_script.js 钉住。
     ⚠️ 下面 9 个 const **与 md 里的 js 代码块逐字节一致**（缩进也保持 md 原样，方便逐字节比对）。 */
const CH01 = {
  bg: "BG-01", cg: "CG-01",
  cast: ["最老的那只","记账的那只","不爱说话的那只","安静的那只","最吵的那只","知道点什么的","最小的",
         "邻居·爱往外跑的","邻居·嘴快的","门客·稳的","门客·不肯说话的","门客·数人的"],
  start: {
    lines: [
      { w:"sys", bg:"BG-01", fx:"fade_in", t:"三息之后，最底下那一级石阶先亮起来。" },
      { w:"sys", bg:"BG-01", fx:"tilt_up",  t:"雾里只剩几级被踩得发亮，其余看得出形，看不出格数。" },
      { w:"sys", bg:"BG-02", fx:"cut",      t:"后来你一只一只领回来，这儿就有了家。" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"被踩亮的那几级，我又数了一遍。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"],  t:"我也听见了！四级！你上次说五级！" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"……我数的是亮的。" },
      { w:"sp", at:"L", who:"安静的那只", ps:["gentle"],  t:"今天冷。{call}，别站门口。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"{call}，站门口也不要紧。怕的是站门口，还不进屋。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"我最小。我最不着急。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"你最小，所以你最急。" },
    ],
    next: "c1",
  },
  c1: {
    lines: [
      { w:"sp", bg:"BG-02", at:"C", who:"最老的那只", ps:["dignified"], t:"认得出，才护得住。" },
      { w:"sys", bg:"BG-03", fx:"cut", t:"晌午，巷口来了三个人。门开着，他们不进来。" },
      { w:"sp", bg:"BG-02", at:"B", who:"门客·不肯说话的", ps:["aloof"], t:"三个。门客两位，收旧物的一位。" },
      { w:"sp", at:"C", who:"记账的那只", ps:["scholar"], t:"你数得比他们还清楚。" },
      { w:"sp", at:"B", who:"门客·不肯说话的", ps:["aloof"], t:"我不看人。我数脚步。" },
    ],
    next: "c2",
  },
  c2: {
    lines: [
      { w:"sp", bg:"BG-02", at:"R", who:"门客·数人的", ps:["sentimental"], t:"你们这一门，全是自己养出来的。养出来的，我们也记一笔。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"记你的。我们家的账，我们自己记。" },
      { w:"sp", at:"R", who:"门客·数人的", ps:["sentimental"], t:"随你。岁除要报数。" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"报给谁。" },
      { w:"sp", at:"R", who:"门客·数人的", ps:["sentimental"], t:"报给记着的人。" },
      { w:"sp", at:"R", who:"门客·数人的", ps:["sentimental"], fx:"slow", t:"你们亮成这样，过两年，说不定也上我们的册子。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], fx:"cut", t:"让他走。话难听，理不歪。" },
    ],
    next: "c3",
  },
  c3: {
    lines: [
      { w:"sp", bg:"BG-02", at:"L", who:"邻居·爱往外跑的", ps:["wild"], t:"当家的，还有一件事。巷尾这两天，有别的人在转。" },
      { w:"sp", at:"L", who:"邻居·爱往外跑的", ps:["wild"], t:"腰里挂着东西。不看门，看院墙。站着，不动。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"看就看。门开着。" },
      { w:"sys", fx:"slow", t:"他们走了。院子又安静下来——这一次，安静得比刚才久。" },
    ],
    choices: [
      { t:"那句话，我记下了。",     go:"m1", tone:"quiet", gset:{ STANCE_CH1:true  }, fb:"记账的把册子摊开，笔尖停了一下。" },
      { t:"咱家的账，咱自己记。",   go:"m2", tone:"warm",  gset:{ STANCE_CH1:false }, fb:"最老的那只点头，院里松了半分。" },
      { t:"门开着，谁来都看得见。", go:"m3", tone:"quiet", gset:{ STANCE_CH1:false }, fb:"最老的那只：开了门，才看得清来的是谁。" },
    ],
  },
  m1: { lines: [
      { w:"sp", bg:"BG-02", at:"B", who:"记账的那只", ps:["scholar"], t:"我记下了。他们说要报数，我就记下：我们，不被数进他们的册子。" },
      { w:"sp", at:"C", who:"安静的那只", ps:["gentle"], t:"不被他们收，也不被他们数。我们好好的。" },
    ], next:"n1" },
  m2: { lines: [
      { w:"sp", bg:"BG-02", at:"C", who:"最老的那只", ps:["dignified"], t:"对。我们家的账，我们自己记。" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"我把册子摊平了。" },
    ], next:"n1" },
  m3: { lines: [
      { w:"sp", bg:"BG-02", at:"C", who:"最老的那只", ps:["dignified"], t:"门开着。开了门，才看得清来的是谁。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"{call}也听见了。那句『亮成这样』，不是吓人。是提醒。" },
    ], next:"n1" },
  n1: { lines: [
      { w:"sp", bg:"BG-02", at:"C", who:"最老的那只", ps:["dignified"], t:"别人有一门一派，要拜，要考，要走很长的路才进得去。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"我们这门没有那些。这门，是{call}一只一只领回来的。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], fx:"slow", t:"{call}不拜谁。{call}，就是这门里的长辈。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"那我是小辈！" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"你是最小的。门里最小，也是家里人。" },
    ], next:"n2" },
  n2: { lines: [
      { w:"sys", bg:"BG-03", fx:"cut", t:"傍晚了。没有人来收，也没有人走。" },
      { w:"sp", at:"L", who:"安静的那只", ps:["gentle"], t:"灯我给{call}留着。{call}回来晚，灯就亮着。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"一盏灯就够了。亮得多的，反倒看不清路。" },
      { w:"sp", bg:"BG-03", at:"C", who:"最老的那只", ps:["dignified"], t:"岁除快到了。到了那天，天劫要来。法力不够的，撑不过去。" },
      { w:"sp", at:"L", who:"不爱说话的那只", ps:["cool"], t:"我们够吗。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"够不够，那天才知道。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], fx:"slow", t:"现在能做的，是让每一个人都站得住。" },
    ], next:"n3" },
  n3: { lines: [
      { w:"sys", bg:"BG-04", fx:"slow", t:"门还开着。廊角一盏灯。石板路空着，远处天色压下来。" },
      { w:"sys", t:"这是一家人的第一年。后面还有很长。" },
    ], end:true },
};
const CH02 = {
  bg: "BG-02",
  cast: ["最老的那只","记账的那只","不爱说话的那只","安静的那只","最吵的那只","知道点什么的","最小的",
         "邻居·爱往外跑的","邻居·嘴快的"],
  start: {
    lines: [
      { w:"sys", bg:"BG-02", t:"这一门静不下来。不是吵，是各有各的动静。" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"第二道缝，我又数了一遍。" },
      { w:"sp", at:"L", who:"不爱说话的那只", ps:["cool"], t:"数这个做什么。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"亮不亮，晒一晌午就见分晓！" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"{call}没回头，却笑了。认得出的人，才敢在暗处笑。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"那我呢？{call}认得出我吗？" },
      { w:"me",  t:"凭你一开口，院里就少了一半的话。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"那是他们先不说！我替他们说！" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"认得出，才护得住。" },
    ],
    next: "c1",
  },
  c1: {
    lines: [
      { w:"sys", bg:"BG-07", fx:"cut", t:"黄昏。你在石桌边坐下。桌上空着。" },
      { w:"sys", t:"你先搁下的那件东西——没说是给谁的。" },
    ],
    choices: [
      { t:"那块磨白的布",   go:"m1", tone:"warm",  gset:{ CH2_FAVOR:"gentle"  }, fb:"安静的那只先过来：『我以为没人看见。』" },
      { t:"一块甜的",       go:"m2", tone:"warm",  gset:{ CH2_FAVOR:"sweet"   }, fb:"最小的踮着脚来够，眼睛比肚子快。" },
      { t:"一页账纸",       go:"m3", tone:"quiet", gset:{ CH2_FAVOR:"scholar" }, fb:"记账的把纸拿起来，按在胸口，没说话。" },
    ],
  },
  m1: { lines: [
      { w:"sp", bg:"BG-07", at:"L", who:"安静的那只", ps:["gentle"], t:"我以为没人看见。{call}眼好。" },
    ], next:"n1" },
  m2: { lines: [
      { w:"sp", bg:"BG-07", at:"L", who:"最小的", ps:["sweet"], t:"{call}怎么知道我要甜的！那不是饿，那是……那是我想。" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"{call}，他上个月也是这么说的。八成又想多要一块。" },
    ], next:"n1" },
  m3: { lines: [
      { w:"sp", bg:"BG-07", at:"B", who:"记账的那只", ps:["scholar"], t:"……这是新写的那一页。" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"我收着。{call}放心。" },
    ], next:"n1" },
  n1: { lines: [
      { w:"sys", bg:"BG-04", fx:"cut", t:"天黑了。安静的那只把廊下那盏灯点上。" },
      { w:"sp", at:"L", who:"邻居·爱往外跑的", ps:["wild"], t:"当家的。巷尾那家人，又多了两个。前天的事，我去看了两回。" },
      { w:"sp", at:"L", who:"邻居·嘴快的", ps:["cheeky"], t:"什么模样？收旧物的？腰里挂着东西没有？" },
      { w:"sp", at:"L", who:"邻居·爱往外跑的", ps:["wild"], t:"不收旧物。挂着东西，可不叫卖，也不进门。就站着，看院墙。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], fx:"slow", t:"{call}，墙上那几道印，是有人拿手比着量过的。量够不够翻进来。" },
      { w:"sp", at:"L", who:"不爱说话的那只", ps:["cool"], t:"他们来吗。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"门开着。开了门，才看得清来的是谁。" },
    ], next:"n2" },
  n2: { lines: [
      { w:"sys", bg:"BG-04", fx:"slow", t:"那盏灯亮到很晚。这一夜没有人关门，也没有人来。" },
    ], end:true },
};
const CH03 = {
  bg: "BG-04", cg: "CG-02",
  cast: ["最小的","最老的那只","记账的那只","知道点什么的","安静的那只"],
  start: {
    lines: [
      { w:"sys", bg:"BG-04", fx:"fade_in", t:"第 20 天。夜里，地上是月，墙上也是月，连石阶都亮。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"{call}。上面的石头，为什么亮。" },
      { w:"me",  t:"走得多的，就亮。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"那我要走很多很多。他们都说我还小——可我今年想走上去。" },
      { w:"sp", at:"C", who:"记账的那只", ps:["scholar"], t:"今年的数——" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"今年的数我知道。我知道我差。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"{call}，路是 {ta} 自己的。就看这半步，是谁迈的。" },
      { w:"sys", fx:"cut", t:"整院的人都看着你。" },
    ],
    next: "c1",
  },
  c1: {
    lines: [
      { w:"sp", bg:"BG-04", at:"C", who:"最老的那只", ps:["dignified"], t:"今年这一步，由谁定。" },
    ],
    choices: [
      { t:"这一步，我替{ta}定。", go:"D1", tone:"quiet", rset:{ sweet:{ stance:"DECIDE" } }, gset:{ FORK_STANCE:"DECIDE" }, fb:"{ta} 的一声『好』，是跟在后头的。" },
      { t:"这条路，{ta}自己选。", go:"D2", tone:"warm",  rset:{ sweet:{ stance:"LET"    } }, gset:{ FORK_STANCE:"LET"    }, fb:"{ta} 走上第一级亮处，留下自己的脚印。" },
    ],
  },
  D1: { lines: [
      { w:"sp", bg:"BG-04", at:"L", who:"最小的", ps:["sweet"], t:"……好。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"{ta} 是照{call}的话做的。这一程，是{call}替 {ta} 走的。" },
      { w:"sys", fx:"slow", t:"上面那几级，月亮照着，还是亮的——只是今晚，没有新的脚印上去。" },
    ], next:"n1" },
  D2: { lines: [
      { w:"sp", bg:"BG-04", at:"L", who:"最小的", ps:["sweet"], t:"{call}，我自己上的。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"这一程，是 {ta} 自己走的。" },
      { w:"sys", fx:"slow", t:"{ta} 没走到第二级，只把一只脚放上第一级亮的地方。" },
      { w:"sys", cg:"CG-02", t:"留下的，是 {ta} 自己的脚印。" },
    ], next:"n1" },
  n1: { lines: [
      { w:"sp", bg:"BG-04", at:"C", who:"最老的那只", ps:["dignified"], t:"上面几级亮，是因为有人走过了。亮给别人看的。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], fx:"slow", t:"{call}只管一件——别让 {ta} 站在路口。等到天黑，还没人告诉 {ta}，路是 {ta} 自己的。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"路口站着的，不止 {ta} 一个。" },
      { w:"sys", fx:"slow", t:"这一夜过完。石阶上有一道新的脚印，很浅。" },
    ], end:true },
};
const CH04 = {
  bg: "BG-09", cg: "CG-03",
  cast: ["记账的那只","最老的那只","最吵的那只","安静的那只","知道点什么的","最小的","不爱说话的那只",
         "收旧物的老头","门客·稳的","门客·不肯说话的","掠客"],
  start: {
    lines: [
      { w:"sys", bg:"BG-09", fx:"cut", t:"第 45 天。小岁除。一年到头，要在门里挂一张榜。" },
      { w:"sp", at:"C", who:"记账的那只", ps:["scholar"], t:"名字，一个一个写。最老的。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"（把手按在牌边上，算认下。）" },
      { w:"sp", at:"C", who:"记账的那只", ps:["scholar"], t:"记账的……不爱说话的……安静的……最吵的。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"我在这儿呢！" },
      { w:"sp", at:"C", who:"记账的那只", ps:["scholar"], t:"最——" },
      { w:"sys", fx:"slow", t:"笔停住了。最小的那只蹲在牌跟前，仰头等那一行字。" },
      { w:"sp", at:"C", who:"记账的那只", ps:["scholar"], t:"{call}，{ta} 的大名，写哪个？" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"我没大名。家里都叫我『最小的』。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"就写这个。小名也是名。名字是留着以后叫的——急什么。" },
    ],
    next: "c1",
  },
  c1: {
    lines: [
      { w:"sys", bg:"BG-09", t:"牌立起来了。一行一行的人名，最后一行最短。" },
      { w:"sys", t:"你退后两步，看那张牌。" },
    ],
    choices: [
      { t:"看那行最短的",   go:"m1", tone:"quiet", gset:{ CH4_LOOKED:"sweet"  }, fb:"你的眼睛停在『最小的』那一行。" },
      { t:"看最吵的那行",   go:"m2", tone:"quiet", gset:{ CH4_LOOKED:"lively" }, fb:"最吵的在牌前站得最久，半天没挪。" },
      { t:"从头一行行看",   go:"m3", tone:"quiet", gset:{ CH4_LOOKED:"all"    }, fb:"一院人的名字，一行行过。" },
    ],
  },
  m1: { lines: [
      { w:"sys", bg:"BG-09", t:"那最后一行，比别的都短。" },
    ], next:"n1" },
  m2: { lines: [
      { w:"sp", bg:"BG-09", at:"C", who:"最吵的那只", ps:["lively"], t:"……就看看。" },
      { w:"sys", t:"然后他头一个走开，脚步比平时快。" },
    ], next:"n1" },
  m3: { lines: [
      { w:"sp", bg:"BG-09", at:"B", who:"知道点什么的", ps:["mystery"], t:"这张榜是面镜子。照的不是名字好不好看——是名字底下那个人，今年够不够自己站着。" },
    ], next:"n1" },
  n1: { lines: [
      { w:"sys", bg:"BG-02", fx:"cut", t:"晌午，一家人都到牌跟前来了。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"站不稳的，今年就多走一步。" },
      { w:"sys", fx:"slow", t:"最吵的在牌前站得最久。没人说话。缺口，是靠沉默照见的。" },
      { w:"sp", bg:"BG-09", at:"R", who:"收旧物的老头", ps:["calm"], t:"挂得好。自己记自己，比等别人记强。" },
      { w:"sp", at:"R", who:"收旧物的老头", ps:["calm"], t:"我们记没醒过的。醒了的，你们自己记。" },
      { w:"sp", at:"R", who:"收旧物的老头", ps:["calm"], fx:"slow", t:"你们这七个，都有看头——过两年，有人要惦记的那种。" },
    ], next:"n2" },
  n2: { lines: [
      { w:"sys", bg:"BG-20", fx:"cut", t:"小岁除夜。后半夜，院墙上有响。断的，一点，又一点。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"谁！" },
      { w:"sys", fx:"shake", t:"一道影子翻上来，压在墙头。腰里挂着东西，垂着，一晃。" },
      { w:"sp", at:"C", who:"掠客", ps:["wanderer"], t:"留下。能带走的那一段。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"你敢下来。" },
      { w:"sys", fx:"flash", t:"墙头紧底下的暗处，伸过来另一样东西——快得像抽走一根线。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], fx:"slow", t:"（喊了半声。那半声，是他从来没喊过的那种。）" },
      { w:"sp", bg:"BG-20", at:"C", who:"最老的那只", ps:["dignified"], fx:"slow", t:"没有翻进来。挡在墙外头了。……{ta} 身上，短了一截。" },
      { w:"sp", at:"L", who:"安静的那只", ps:["gentle"], t:"会好的。我记着，养回来就好了。" },
    ], next:"n3",
    rset: { lively: { harmed:true, harmCause:"掠客" } } },
  n3: { lines: [
      { w:"sys", bg:"BG-20", cg:"CG-04", fx:"slow", t:"墙上有几道印，比白天多。月色很白。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"来了。这才第一回。" },
      { w:"sys", t:"小岁除的夜，院门没有开。屋里有个平时最吵的人，这一夜，说了最少的话。" },
    ], end:true },
};
const CH05 = {
  bg: "BG-02",
  cast: ["最吵的那只","最老的那只","记账的那只","知道点什么的","安静的那只","星月·并珠的"],
  start: {
    lines: [
      { w:"sys", bg:"BG-02", t:"第 62 天。小岁除过去半个月了。最吵的那只还是话少。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"我今年想动。往前走——往上走。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"伤刚好。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"刚好才要动。再不动，我就真的慢了。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], fx:"slow", t:"我不怕慢。我怕停在原地，还装着没事。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"{call}，{ta} 这话，一半是真的，一半是怕。" },
    ],
    next: "n1",
  },
  n1: {
    lines: [
      { w:"sys", bg:"BG-02", fx:"cut", t:"黄昏，{ta} 把你拉到石阶下面。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"{call}，陪我一程。{call}在上头站着，我往前走。" },
      { w:"me",  t:"你自己走。我在。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"就这样？{call}不拉着我？" },
      { w:"me",  t:"我拉着你，你走的就是我的路。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"那我就走给{call}看。" },
      { w:"sys", fx:"slow", t:"最老的那只在廊下听着，没插话，只点了点头。" },
    ],
    next: "n2",
  },
  n2: {
    lines: [
      { w:"sys", bg:"BG-04", fx:"cut", t:"夜里，院门外来了人。这个来的很规矩——站在门外，不进门，先开口。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"当家的，在吗。我从星月坛来。听说，你们家有一只，今年想动。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"想动是好事。可自己动，慢。我们坛里有个法子——借。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"借一段力。借你们的，明年，还你们两颗。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"我不要。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], fx:"slow", t:"小兄弟，话别说满了。你今年想动，我们坛里的门，一直开着。" },
    ],
    next: "c1",
  },
  c1: {
    lines: [
      { w:"sp", bg:"BG-04", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"那么，当家的——你说呢。" },
    ],
    choices: [
      { t:"力我们不借。门也不借。", go:"m1", tone:"quiet", gset:{ STANCE_CH5:"FIRM"  }, fb:"门外那个的笑意不变，鞋底一点土都没带起来。" },
      { t:"你说还两颗。拿什么还。", go:"m2", tone:"quiet", gset:{ STANCE_CH5:"PROBE" }, fb:"门外那个顿了顿：『拿坛里的力还。』" },
      { t:"今夜就到这儿。",         go:"m3", tone:"quiet", gset:{ STANCE_CH5:"GUARD" }, fb:"灯还亮着，门没关，人已经走远。" },
    ],
  },
  m1: { lines: [ { w:"sp", bg:"BG-04", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"当家的这话，说得急了些。你们不要，你们家那一只，可未必不要。" } ], next:"n3" },
  m2: { lines: [ { w:"sp", bg:"BG-04", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"拿坛里的力还。规矩就是规矩。" }, { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"我们不要你的力。" } ], next:"n3" },
  m3: { lines: [ { w:"sp", bg:"BG-04", at:"C", who:"最老的那只", ps:["dignified"], t:"今夜就到这儿。门开着，路你走你的。" } ], next:"n3" },
  n3: { lines: [
      { w:"sys", bg:"BG-04", fx:"slow", t:"星月坛的门，今夜第一次，在这条巷子外面，开了一条缝。缝里的人没进来，可那句话，进来了。" },
    ], end:true },
};
const CH06 = {
  bg: "BG-04",
  cast: ["最吵的那只","最老的那只","记账的那只","知道点什么的","安静的那只","最小的","星月·数团的"],
  start: {
    lines: [
      { w:"sys", bg:"BG-04", t:"第 78 天。入了冬，天黑得早。那盏灯，点得比前些日子早。" },
      { w:"me",  t:"过了年，关口那一段，我替你顶一次。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"不。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"{call}替我顶，走的就不是我自己的路了。这一回，我想自己走上去。" },
      { w:"me",  t:"你走得上去吗。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], fx:"slow", t:"走不上去，也是我走的。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"{call}，不是每一条路，人家都肯让{call}替的。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"让他走。" },
    ],
    next: "n1",
  },
  n1: {
    lines: [
      { w:"sys", bg:"BG-05", fx:"cut", t:"第二天一早，巷子尽头。雾里站着一个人，空着手，手里拿的是册子。" },
      { w:"sp", at:"C", who:"星月·数团的", ps:["scholar"], t:"当家的。我从星月坛来。岁除近了，我来报个数。" },
      { w:"sp", at:"C", who:"星月·数团的", ps:["scholar"], t:"巷东三家，我数过了。巷西两家，我数过了。你们家——" },
      { w:"sys", fx:"slow", t:"他停住了。把簿子合上，抱在怀里。" },
      { w:"sp", at:"C", who:"星月·数团的", ps:["scholar"], fx:"slow", t:"还差一颗。" },
      { w:"sp", at:"C", who:"星月·数团的", ps:["scholar"], t:"不差谁的。就是——我数过的人家，到后来，都少了一颗。" },
    ],
    next: "n2",
  },
  n2: {
    lines: [
      { w:"sys", bg:"BG-04", fx:"cut", t:"夜里，一家人没谁先睡。灯亮着，谁也不提白天的事。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"那个报数的说少一颗——是我们当中，要少一个吗。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"数得清的，才拿得走。数不清的，就拿不动。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], t:"白天那个，是来数人的。夜里，说不准还有来拿人的。谁数得清，拿谁。" },
    ],
    next: "c1",
  },
  c1: {
    lines: [
      { w:"sp", bg:"BG-04", at:"C", who:"最老的那只", ps:["dignified"], t:"那么，{call}——这一屋人的心，怎么安。" },
    ],
    choices: [
      { t:"他来数人。数清了才拿得走。", go:"m1", tone:"quiet", gset:{ STANCE_CH6:"NAME" }, fb:"一屋人安静。记账的把册子往怀里按了按。" },
      { t:"谁也不会少。睡吧。",         go:"m2", tone:"warm",  gset:{ STANCE_CH6:"CALM" }, fb:"最小的往榜那边靠了靠。" },
      { t:"从今起，自家的数，天天点。", go:"m3", tone:"warm",  gset:{ STANCE_CH6:"RULE" }, fb:"记账的在新的一页写下第一行。" },
    ],
  },
  m1: { lines: [ { w:"sp", bg:"BG-04", at:"C", who:"最老的那只", ps:["dignified"], t:"对。数得清的，才拿得走。那就让他数不清——我们，各家是各家。" } ], next:"n3" },
  m2: { lines: [ { w:"sp", bg:"BG-04", at:"L", who:"安静的那只", ps:["gentle"], t:"我在。谁也不会少。" }, { w:"sys", t:"安静的那只把灯芯剪了剪，灯亮了些。从今晚起，她把灯留到最晚。" } ], next:"n3" },
  m3: { lines: [ { w:"sp", bg:"BG-04", at:"B", who:"记账的那只", ps:["scholar"], t:"从今起，自家的数，天天点。点清了，谁也拿不动。" } ], next:"n3" },
  n3: { lines: [
      { w:"sys", bg:"BG-04", fx:"slow", t:"这一夜没有人关门。灯亮到很晚，亮得门外那条空巷，连影子都清清楚楚。" },
    ], end:true },
};
const CH07 = {
  bg: "BG-06", cg: "CG-05",
  cast: ["最吵的那只","不爱说话的那只","星月·并珠的","星月·守坛的"],
  start: {
    lines: [
      { w:"sys", bg:"BG-06", fx:"cut", t:"第 95 天。雨下了三天。关口，就在今晚。" },
      { w:"sys", t:"今年要去的，是两只。一只说要动，就再没改口；另一只谁也没说。" },
      { w:"sp", at:"B", who:"不爱说话的那只", ps:["cool"], t:"（他把新洗过的鞋搁在廊下，摆得整整齐齐。）" },
      { w:"sp", at:"L", who:"最吵的那只", ps:["lively"], t:"你也去。到那儿，谁也别管谁。各走各的。" },
    ],
    next: "n1",
  },
  n1: {
    lines: [
      { w:"sys", bg:"BG-16", fx:"cut", t:"到了关口，雨停了。天上那道裂痕，比上次见时更长。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"当家的。你们家今年要过关口，我们来看看。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], fx:"slow", t:"过了，就好。过不去——我们坛里，有个位子。" },
      { w:"sp", bg:"BG-16", at:"C", who:"不爱说话的那只", ps:["cool"], t:"（上前一步。走到石阶一半，脚步顿了一下。）" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"（伸手虚抬了一下，像是在『扶』。）" },
      { w:"sys", fx:"slow", t:"风朝 {ta} 收过去——像抽走一根线。{ta} 的肩膀轻轻一沉。" },
      { w:"sys", t:"{ta} 没喊。{ta} 从来不喊。只是继续往上走，走得比刚才慢。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"这就对了。过不去的，我们替他过。这一位，我上回就记着了。" },
    ],
    rset: { cool: { harmed:true, harmCause:"星月·并团" } },
    next: "c1",
  },
  c1: {
    lines: [
      { w:"sys", bg:"BG-16", fx:"slow", t:"{ta} 站到石阶底下。他没回头看你。" },
    ],
    choices: [
      { t:"我替{ta}挡这一道。", go:"K1a", tone:"quiet", gset:{ KEY_CHOICES:"+1" }, fb:"风朝你收过来。你没让。" },
      { t:"回来。今年你不走。", go:"K1b", tone:"quiet", fb:"{ta} 顿住，没上去。" },
    ],
  },
  // ★K1 二选（主理人裁定）：第③方向「放手」已并入 K1a 的旁白（见下第 3 行）
  K1a: { lines: [
      { w:"sp", bg:"BG-16", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"这一道，是 {ta} 自己走的。你插进来，算谁的。" },
      { w:"me",  t:"算我的。" },
      { w:"sys", fx:"slow", t:"你没拦他。你只是横在他前头，替他挨这一下——让他自己走上去。" },
      { w:"sys", cg:"CG-05", fx:"slow", t:"你横在关口上。{ta} 在你身后，只看见一个背影挡了一下风——然后，风就过去了。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], fx:"slow", t:"当家的，你把这一颗，记在自己名下了。可惜——我另取一颗。" },
      { w:"sys", t:"{ta} 一步一步，走过了关口。他以为，是自己走过去的。" },
    ], next:"n3" },
  K1b: { lines: [
      { w:"me",  t:"回来。今年你不走。" },
      { w:"sp", bg:"BG-16", at:"C", who:"最吵的那只", ps:["lively"], t:"……{call}。" },
      { w:"sys", fx:"slow", t:"{ta} 退回你身边，没再上去。关口上那道裂痕，亮了一下，又暗下去。" },
      { w:"sp", at:"R", who:"星月·并珠的", ps:["cheeky"], t:"当家的，护得住今天。" },
    ], next:"n3" },
  n3: { lines: [
      { w:"sys", bg:"BG-16", fx:"slow", t:"那天夜里，两只都过了关口。一只知道自己过了，一只只知道自己过了半程。" },
      { w:"sys", t:"风停的时候，谁也没提起中间那一下。" },
    ], end:true },
};
const CH08 = {
  bg: "BG-02", cg: "CG-06",
  cast: ["最吵的那只","不爱说话的那只","记账的那只","知道点什么的","安静的那只","最老的那只","最小的"],
  start: {
    lines: [
      { w:"sys", bg:"BG-02", fx:"cut", t:"第 108 天。最吵的那只，这几天话多起来了。逢人就讲那一夜。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"那道石阶，我一口气走上去的。风那么大，我都没停。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"你没害怕吗。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"怕什么。我自己走的。" },
      { w:"sys", t:"有一句话，好几次到了你嘴边——『那天，有人替你挡了一下。』" },
      { w:"sys", fx:"slow", t:"可你每次开口，都换成了别的。" },
    ],
    next: "n1",
  },
  n1: {
    lines: [
      { w:"sys", bg:"BG-02", fx:"cut", t:"黄昏，记账的照例点名。" },
      { w:"sp", at:"C", who:"记账的那只", ps:["scholar"], t:"一双、两双、三双。今晚留几盏灯。" },
      { w:"sys", t:"这是不爱说话的那只答的。他一向只答三个字。" },
      { w:"sp", at:"B", who:"不爱说话的那只", ps:["cool"], t:"……两盏。" },
      { w:"sp", at:"C", who:"记账的那只", ps:["scholar"], fx:"slow", t:"是三盏。这半个月，都是三盏。" },
      { w:"sys", t:"不爱说话的那只张了张口，没说话。他看着桌上的册子，像在把那一个数，往回捡。" },
      { w:"sp", at:"C", who:"知道点什么的", ps:["mystery"], t:"{call}。这几天，{ta} 的话，一次比一次短。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], fx:"slow", t:"丢了的不怕。就是淡了——淡了，还能再浓回来。" },
      { w:"sp", at:"L", who:"安静的那只", ps:["gentle"], t:"我陪你坐。" },
    ],
    next: "n2",
  },
  n2: {
    lines: [
      { w:"sys", bg:"BG-04", fx:"cut", t:"夜里，灯点上了。影子落在墙上——一盏灯，照一墙影。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"我看我的影子，比上个月长了。过关口，长个子。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], fx:"slow", t:"那他的影子，怎么浅了一截。" },
      { w:"sys", fx:"slow", t:"墙上，不爱说话的那只的影子，比旁人的淡。淡得像是隔着水看。" },
      { w:"sys", t:"他没动。看了一会儿，往灯那边挪了半步——影子浓了一点点。他就没再挪。" },
      { w:"sp", at:"C", who:"最吵的那只", ps:["lively"], t:"{call}。那天夜里——风是不是特别大。我记得挺大的。" },
    ],
    choices: [
      { t:"风是挺大的。", go:"m1", tone:"warm",  fb:"{ta} 点点头，去看自己的影子了。" },
      { t:"你走得很稳。", go:"m2", tone:"warm",  fb:"{ta} 笑了半下，没接话。" },
      { t:"……",         go:"m3", tone:"quiet", fb:"你没答。灯影晃了一下，又定住。" },
    ],
  },
  m1: { lines: [ { w:"sp", bg:"BG-04", at:"C", who:"最吵的那只", ps:["lively"], t:"那就对了。" } ], next:"n3" },
  m2: { lines: [ { w:"sp", bg:"BG-04", at:"C", who:"最吵的那只", ps:["lively"], t:"稳吧？我自己都觉得稳。" } ], next:"n3" },
  m3: { lines: [ { w:"sys", bg:"BG-04", t:"你没答。他也没再问。" } ], next:"n3" },
  n3: { lines: [
      { w:"sys", bg:"BG-04", cg:"CG-06", fx:"slow", t:"一墙影子，只有一道，比别的浅。" },
      { w:"sys", t:"这一夜，没有谁问起关口上的那一下。那道浅影——淡一点，可还在。" },
    ], end:true },
};
const CH09 = {
  bg: "BG-09",
  cast: ["坛主·并团的老先生","最吵的那只","最老的那只","记账的那只","知道点什么的","最小的",
         "门客·稳的","收旧物的老头"],
  start: {
    lines: [
      { w:"sys", bg:"BG-09", fx:"cut", t:"第 120 天。岁除一。这是这一门头一个正式岁除——这回要报数。" },
      { w:"sp", at:"C", who:"门客·稳的", ps:["calm"], t:"当家的。岁除要报数。" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"我们自己记自己的。" },
      { w:"sp", at:"C", who:"门客·稳的", ps:["calm"], t:"记你们的。我们记我们的。对一对，各自清楚。" },
      { w:"sp", at:"R", who:"收旧物的老头", ps:["calm"], fx:"slow", t:"今年，巷尾那家，空了个位子。去年报数，是四个。今年——三个。" },
      { w:"sp", at:"B", who:"记账的那只", ps:["scholar"], t:"那一个呢。" },
      { w:"sp", at:"R", who:"收旧物的老头", ps:["calm"], t:"没走。就是，不在他家了。" },
      { w:"sys", fx:"slow", t:"院里没人说话。最小的往榜那边靠了靠，像是要数一遍自己家的人。" },
    ],
    next: "n1",
  },
  n1: {
    lines: [
      { w:"sys", bg:"BG-19", fx:"cut", t:"岁除这日，星月坛开坛，请各家去对榜。讲的是礼。所以你还是去了。" },
      { w:"sys", t:"坛里很暗。一线天光落在坛面上。阶下站着一个人，慢，稳，像一截老木头。" },
      { w:"sp", at:"C", who:"坛主·并团的老先生", ps:["pampered"], t:"当家的，稀客。你们家的榜，我读过。这是坛册。谁进了团，名字记在这里。" },
      { w:"sp", at:"C", who:"坛主·并团的老先生", ps:["pampered"], t:"我们不拿人。只是——你家隔壁那家，去年也是这么说的。" },
      { w:"sp", at:"C", who:"坛主·并团的老先生", ps:["pampered"], t:"一颗珠子，不叫团。团是——你不必自己撑。要是你站不住，团会把你接住。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"接住了，还是在团里，还是在自家。" },
      { w:"sp", at:"C", who:"坛主·并团的老先生", ps:["pampered"], t:"在团里。团里，也是家。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"不是这个家。" },
      { w:"sp", at:"C", who:"坛主·并团的老先生", ps:["pampered"], fx:"slow", t:"当家的，你们家今年要走关口的那一位——报数那日，我记着了。" },
      { w:"sys", fx:"slow", t:"册子上，落了一笔。最吵的那只站在你身后，看清了那一笔。他把手在袖子里收了一下——这一下，是他头一回怕。" },
      { w:"sp", at:"C", who:"坛主·并团的老先生", ps:["pampered"], t:"不必急。册上落一笔，不是把人拿走了。人还在你家院子里站着。" },
    ],
    rset: { lively: { starMark:true } },
    next: "c1",
  },
  c1: {
    lines: [
      { w:"sp", bg:"BG-19", at:"C", who:"坛主·并团的老先生", ps:["pampered"], t:"记着——明年这个时候，你会想起今天。" },
    ],
    choices: [
      { t:"这笔我认下。人还在我家。", go:"m1", tone:"quiet", gset:{ STANCE_CH9:"ACCEPT" }, fb:"坛主合上册子，眼没抬。" },
      { t:"能落一笔，就能划一笔。",   go:"m2", tone:"quiet", gset:{ STANCE_CH9:"DENY"   }, fb:"一线天光落下来，坛主笑了一下，不恼。" },
      { t:"（沉默）带人走。",         go:"m3", tone:"quiet", gset:{ STANCE_CH9:"SILENT" }, fb:"最吵的跟上你。袖子里那一下，谁也没看见。" },
    ],
  },
  m1: { lines: [ { w:"sp", bg:"BG-19", at:"C", who:"坛主·并团的老先生", ps:["pampered"], t:"认下，就好。" } ], next:"n3" },
  m2: { lines: [ { w:"sp", bg:"BG-19", at:"C", who:"坛主·并团的老先生", ps:["pampered"], t:"划不划得动，明年再说。" } ], next:"n3" },
  m3: { lines: [ { w:"sys", bg:"BG-19", t:"你没接话。带人出了坛门。" } ], next:"n3" },
  n3: {
    lines: [
      { w:"sys", bg:"BG-10", fx:"cut", t:"回到巷子，下雪了。榜立在门里，正对着门。你把自家的名字，从头到尾看了一遍。" },
      { w:"sys", t:"七个名字。一个不少。你看完一遍，心里不安稳，又看了一遍。" },
      { w:"sys", fx:"slow", t:"第二遍，眼睛里多了一样东西——旁边那个空着的位子。" },
      { w:"sp", at:"C", who:"最老的那只", ps:["dignified"], t:"数了两遍。第二遍，数的是不是少了一个。" },
      { w:"me",  t:"没有。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], t:"后巷那家少的那个，会不会回来。" },
      { w:"me",  t:"会。" },
      { w:"sp", at:"L", who:"最小的", ps:["sweet"], fx:"slow", t:"要是回不来呢。" },
      { w:"sys", cg:"CG-08", fx:"slow", t:"雪落在榜上，一行一行盖过去。你伸手，把落在名字上的那一片雪拂了下去。" },
      { w:"sp", at:"B", who:"知道点什么的", ps:["mystery"], fx:"slow", t:"{call}。坛里那本册子，翻的时候，我看见前头——还有别人的名字。有一个，排在咱们前头，远得很。他不认识。他跟了团。" },
      { w:"sys", t:"这一夜，你数了两遍自家的名字，一遍比一遍慢。七个名字，你认得出来——只剩下那个空着的位子，是别人家的。" },
    ],
    end:true,
  },
};
  const MAIN_SCRIPTS = [CH01, CH02, CH03, CH04, CH05, CH06, CH07, CH08, CH09];
  const MAIN_ACTS = MAIN_CHAPTERS.map(function (c, i) {
    return {
      id: "m" + (i + 1), i: i, day: c.day, icon: c.icon, title: c.title, sub: c.sub || "",
      nodes: MAIN_SCRIPTS[i] || {},
    };
  });
  function mainActOf(id) {
    for (let i = 0; i < MAIN_ACTS.length; i++) if (MAIN_ACTS[i].id === id) return MAIN_ACTS[i];
    return null;
  }
  // 已读表：ww_story.mainChapters（⛔ 全局一条，不进 rec）
  function mainReadMap() {
    const w = readStory();
    if (!w.mainChapters || typeof w.mainChapters !== "object") w.mainChapters = {};
    return w.mainChapters;
  }
  function mainReadChapter(i) {
    const w = readStory();
    w.mainChapters = (w.mainChapters && typeof w.mainChapters === "object") ? w.mainChapters : {};
    if (w.mainChapters[i] && w.mainChapters[i].at) return false;
    w.mainChapters[i] = { at: Date.now() };
    writeStory(w);
    return true;
  }
  // 章节列表状态：解锁链 = 上一章读过 ∧ 陪伴天数 ≥ 本章锚点（⛔ 与旧 8 章的 rec 解锁链完全隔离）
  function mainChapterState(ctx) {
    const days = Math.max(1, (ctx && ctx.dayNo) || 1);
    const read = mainReadMap();
    const out = [];
    let prevRead = true;
    for (let i = 0; i < MAIN_CHAPTERS.length; i++) {
      const c = MAIN_CHAPTERS[i];
      const daysOk = days >= c.day;
      const unlocked = !!MAIN_STORY_OPEN && prevRead && daysOk;
      let need = "";
      if (!MAIN_STORY_OPEN) need = "正文还没装帧";
      else if (!daysOk) need = "第 " + c.day + " 天才发生";
      else if (!prevRead) need = "先看完上一章";
      out.push({
        i: i, icon: c.icon, title: c.title, sub: c.sub || "", day: c.day,
        unlocked: unlocked, read: !!(read[i] && read[i].at), need: need,
      });
      prevRead = unlocked ? !!(read[i] && read[i].at) : false;
    }
    return out;
  }
  function mainUnreadCount(ctx) {
    return mainChapterState(ctx).filter((c) => c.unlocked && !c.read).length;
  }
  /* ---------- 新 9 章的对话推进：复用 chapWalk / chapTalkChoose，只换「剧本表」 ----------
     ⚠️ chapWalk / chapTalkChoose 原本写死 chapActOf，这里给它们加了一个可选的第 4/5 参 actOf，
        旧调用点不传 → 仍走 chapActOf，⛔ 旧 8 章行为零变化。
     存储槽：ww_story.mainTalk（结构同 rec.talk）；已读走 ww_story.mainChapters。 */
  // 群像剧本没有"某一只"，但 greetVars 要读 item.color 之类 —— 传空对象占位（⛔ 绝不传 null，会炸）
  const MAIN_STUB_ITEM = {};
  function mainShim() {
    const w = readStory();
    if (!w.mainTalk || typeof w.mainTalk !== "object") w.mainTalk = {};
    if (!w.mainChapters || typeof w.mainChapters !== "object") w.mainChapters = {};
    return w;
  }
  function mainFlush(w) {
    writeStory(w);
  }
  // 进入第 i 章（0-based）
  function mainTalkEnter(ctx, i) {
    const w = mainShim();
    const id = "m" + (Number(i) + 1);
    const act = mainActOf(id);
    if (!act) return { added: [], choices: [], ending: null, ended: true };
    castOf();                                   // v165 批次3A-5：进章抽一次出场表（内部全静默）
    const shim = { talk: w.mainTalk, chapters: w.mainChapters };
    const t0 = w.mainTalk;
    if (t0 && t0.chapId === id && Array.isArray(t0.log) && t0.log.length) {
      const r = {
        added: [],
        choices: t0.ended ? [] : chapChoicesOf(t0, act, greetVars(MAIN_STUB_ITEM, {}, ctx)),
        ending: t0.ending || null,
        ended: !!t0.ended,
      };
      r.log = (Array.isArray(t0.log) ? t0.log : []).slice();
      return r;
    }
    chapReset(shim, id);
    const r = chapWalk(MAIN_STUB_ITEM, shim, ctx, mainActOf);
    w.mainChapters = shim.chapters;
    mainFlush(w);
    r.log = (Array.isArray(shim.talk && shim.talk.log) ? shim.talk.log : []).slice();
    return r;
  }
  function mainTalkChoose(ctx, idx) {
    const w = mainShim();
    const shim = { talk: w.mainTalk, chapters: w.mainChapters };
    const r = chapTalkChoose(MAIN_STUB_ITEM, shim, ctx, idx, mainActOf);
    w.mainChapters = shim.chapters;
    mainFlush(w);
    r.log = (Array.isArray(shim.talk && shim.talk.log) ? shim.talk.log : []).slice();
    return r;
  }
  function mainTalkReplay(ctx, i) {
    const w = mainShim();
    const shim = { talk: w.mainTalk, chapters: w.mainChapters };
    chapReset(shim, "m" + (Number(i) + 1));
    const r = chapWalk(MAIN_STUB_ITEM, shim, ctx, mainActOf);
    w.mainChapters = shim.chapters;
    mainFlush(w);
    r.log = (Array.isArray(shim.talk && shim.talk.log) ? shim.talk.log : []).slice();
    return r;
  }
  function mainTalkBrief() {
    const w = mainShim();
    const t = w.mainTalk || null;
    if (!t || !t.chapId) return null;
    const log = Array.isArray(t.log) ? t.log : [];
    return {
      chapId: t.chapId, ended: !!t.ended,
      last: log.length ? log[log.length - 1] : null,
      ending: t.ending || null, msgs: Number(t.msgs) || 0,
    };
  }


  /* ---------- 房间剧情（两只沁灵的故事） ---------- */
  function storyLocal(a, b, level, roomName, aff) {
    const na = (a.persona && a.persona.name) || a.item.name || "那只";
    const nb = (b.persona && b.persona.name) || b.item.name || "那只";
    const seed = hashStr(a.item.id + b.item.id + level);
    const stage = ["刚认识，还互相打量", "已经熟络，开始互相打趣", "默契到不用说话", "像老朋友一样交心", "彼此都懂的知己"][Math.min(level, 4)];
    const line = pick([
      "「你先晒还是我先晒？」" + na + "问。" + nb + "没答，只是往窗边挪了挪，把最好的那块光让了出来。",
      na + "把白天听到的动静讲了一遍，" + nb + "听完只说了一句：「你记性真好。」" + na + "得意了一整晚。",
      "主人今天没来。" + na + "数到第三十下的时候，" + nb + "开口了：「别数了，他总会来的。」",
      na + "差点滑下桌子边，" + nb + "一把把 ta 拽住了。之后两个都没提这件事。",
    ], seed);
    const line2 = pick([
      "外面下雨，" + roomName + "里安静得能听见彼此的声音。他们谁都没睡，就那么待着，直到天亮。",
      "有一天主人把两个都搁在一处，" + na + "和" + nb + "第一次靠得那么近，谁都没说话，但都悄悄高兴了一下。",
      "他们开始有了自己的小规矩：谁先见着主人，谁就负责讲今天听到的事。",
      "夜里" + roomName + "很暗，" + nb + "说：「其实我不太怕黑。」" + na + "说：「我知道，但我还是想挨着你。」",
    ], seed + 5);
    return "【" + roomName + " · 第 " + (level + 1) + " 段】\n" +
      na + "和" + nb + "认识第 " + (aff || 0) + " 天了，现在是「" + stage + "」的关系。\n" + line + "\n" + line2;
  }
  async function roomStory(a, b, level, roomName, aff) {
    if (getAiKey()) {
      try {
        const sys = "你在写一个中文文玩 App 里的「沁灵小剧场」。主人的手串盘到挂瓷，会各自醒成一位小沁灵，他们住在同一个房间里，"
          + "住得越久越有默契。请写一段 250-400 字的小故事：有场景、有动作、有 2-6 句对白，"
          + "温柔可爱、有生活质感、不要煽情说教；不要 Markdown、不要标题、不要分点、不要解释，直接输出正文。";
        const user = "房间：" + roomName + "；两只沁灵已经相处 " + (aff || 0) + " 天（默契等级 " + (level + 1) + "/5）。\n" +
          "甲：" + spiritDesc(a.item, a.persona, a.stage) + "\n乙：" + spiritDesc(b.item, b.persona, b.stage) +
          "\n" + ownerLine() + "\n请写他们之间刚发生的这段故事。";
        const txt = (await aiChat([{ role: "system", content: sys }, { role: "user", content: user }], 900) || "").trim();
        if (txt && txt.length >= 80) return "【" + roomName + " · 第 " + (level + 1) + " 段】\n" + txt.replace(/^["「]|["」]$/g, "").trim();
      } catch (e) { /* 兜底 */ }
    }
    return storyLocal(a, b, level, roomName, aff);
  }

  /* ---------- v125：CG（场景插画） ----------
     规则（用户要求）：**凝形 / 开窍只有立绘**；**蜕形 / 化形额外再出一张 CG**。
     沁灵之间达成的事件（契合度解锁的剧情）也各配一张双人 CG。都是日漫风。 */
  // v165：ancient Chinese scene and hanfu costume -> classical Chinese-inspired costume（随本角色意象）
  const CG_STYLE = "2D hand-drawn key visual CG illustration in traditional Chinese gufeng style, ancient Chinese scene and classical Chinese-inspired costume, " +
    "cel shading, soft elegant Chinese classical palette, cinematic lighting, atmospheric mood, detailed painted background with gentle bokeh, " +
    "expressive body language, warm cozy feeling, masterpiece quality, " +
    "HORIZONTAL LANDSCAPE COMPOSITION, 16:9 widescreen framing, not a portrait, not a vertical poster, " +
    "no text, no letters, no words, no title, no labels, no watermark, no signature, no logo, " +
    "single continuous scene, no split panels, no collage, " + ANATOMY + ", " + NEG_STYLE;
  const CG_MOOD = [
    "just met and politely getting to know each other, a little shy, warm afternoon light",
    "comfortably chatting like friends, one of them laughing, golden sunset light through the window",
    "sitting close together in comfortable silence, trusting each other, soft lamplight at dusk",
    "leaning on each other like old friends, quiet and intimate, warm night light and floating dust motes",
    "a deep bond, they understand each other without words, breathtaking magical light, petals or light particles in the air",
  ];
  /* ============================================================
   * v165-A · CG 姿势词剥离（⛔ 只作用于 CG 装配路径；立绘 promptFor 一字不动）
   *
   * 根因（用户反馈）：CG 的姿势被「比例锁定块」压死 —— 用户写「右手搭在石桌边沿」，
   *   装配出来的 prompt 里却同时有 STAGES[].look 的 "confident pose"、
   *   STAGES[].prop 的 "mature elegant standing pose" 和 "the figure stands at full height, head to feet"、
   *   以及立绘出图单的 "pose: …"。四股姿势指令互相打架 → 模型取平均，画出尴尬的半站半坐。
   *
   * 铁律：**CG 的姿势唯一来源 = 用户（确认后）的画面描述**。
   *   · stripPose(text)               —— 剥掉文本里的姿势短语（只用于 CG 路径）
   *   · cgPropFor(stage, shot)        —— 去姿势化的比例块；并按景别收放"全身 / 腿长"约束
   *   · briefHard(lk, { noPose:true })—— 出图单硬约束里去掉 pose 那一项
   * ============================================================ */
  // 姿势短语（含修饰词）：mature elegant standing pose / mature majestic standing pose / confident pose / energetic pose / dramatic pose …
  // 「the figure stands at full height, head to feet」= "站直"，是姿势而非构图 → 也归此列（⛔ 任何景别都删）。
  const CG_POSE_RE = [
    /\b(?:(?:mature|elegant|majestic|graceful|adult|natural|relaxed|classical|confident|dramatic)\s+)*standing pose\b/gi,
    /\bconfident pose\b/gi,
    /\benergetic pose\b/gi,
    /\bdramatic pose(?: and camera angle)?\b/gi,
    /\bthe figure stands at full height,\s*head to feet\b/gi,
  ];
  // 「全身头身比 / 时装画锚词 / 腿长可读」= 只有全身 / 远景（shot.wide）才保留。
  //   近景 / 半身 / 特写里它们与画框矛盾，还会把模型往"全身立绘"带（用户反馈的构图 bug）。
  //   ⚠️ (?<!no ) 保护负向「no tall slender figure / no long legs」（凝形/开窍的护身符，别被删成 "no ,"）。
  const CG_WIDE_ONLY_RE = [
    /\ban? \d+(?:\.\d+)?-heads-tall figure \(the head's height is [^)]*\)/gi,
    /\bfashion-illustration proportions\b/gi,
    /\btall runway-model silhouette\b/gi,
    /\belongated elegant figure\b/gi,
    /(?<!no )(?:very )?tall slender figure\b/gi,
    /\bnarrow shoulders\b/gi,
    /\b(?:elegant )?adult body silhouette\b/gi,
    /\bthe waistline and the legs' length stay visually readable\b/gi,
    /\bthe legs' length stays visually readable\b/gi,
    /(?<!no )\blong legs\b/gi,
  ];
  // 删词后收尾：把遗留的 ", ," / "; ;" / " ," 归整成单分隔符（⛔ 只用于 CG 路径的拼接）
  function cgTidy(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .replace(/\s*[,;][\s,;]*/g, function (m) { return /;/.test(m) ? "; " : ", "; })
      .replace(/^[\s,;]+/, "")
      .replace(/[\s,;]+$/, "")
      .trim();
  }
  function stripPose(text) {
    let s = String(text || "");
    for (let i = 0; i < CG_POSE_RE.length; i++) s = s.replace(CG_POSE_RE[i], " ");
    return cgTidy(s);
  }
  function cgPropFor(stage, shot) {
    const sd = stageDef(Math.max(1, Number(stage) || 1));
    let s = stripPose(String(sd.prop || ""));   // stripPose 已含「站直」短语（CG_POSE_RE 第 5 条）
    const wide = !(shot && !shot.wide);          // shot 缺省 / 全身远景 → 完整比例块；近景半身特写 → 精简
    if (!wide) {
      for (let i = 0; i < CG_WIDE_ONLY_RE.length; i++) s = s.replace(CG_WIDE_ONLY_RE[i], " ");
      // 锚句被整段删空后，"PROPORTION LOCK:" 会直接顶着下一个标签 → 补一句"头部相对身体要小"填位
      s = s.replace(/PROPORTION LOCK:[^A-Za-z]*SILHOUETTE RULE:/i,
        "PROPORTION LOCK: the head stays small in proportion to the body; SILHOUETTE RULE:");
    }
    return cgTidy(s);
  }
  // 单只沁灵的 CG（蜕形 / 化形用）
  function promptForCg(item, styleKey, stage, appearance, look, sceneText, shot) {
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    const lkRaw = look || lookOf(item, null);
    const _ab = applyBrief(lkRaw, appearance || lkRaw.ap || appearanceOf(item, 0));   // v164：出图单优先
    const lk = _ab.lk;
    const ap = _ab.ap;
    const color = lk.hairEn;
    const stageObj = stageDef(stage);
    const stageLook = stripPose(stageObj.look);   // v165-A：剥姿势词（姿势归画面描述）
    const head = CG_STYLE + ", " + appearancePrompt(ap) + ", with " + color + " hair and " + lk.outfitEn + " themed outfit"
      + (lk.hairHex ? (", the exact hair color is " + lk.hairHex) : "") + lookExtra(lk) + ", " +
      stageLook
      + (lookHard(lk) ? (", " + lookHard(lk)) : "")
      + (briefHard(lk, { noPose: true }) ? (", " + briefHard(lk, { noPose: true })) : "")
      + ", " + st;
    const scene = cgSceneClause(sceneText, shot);
    const tail = scene
      ? scene
      : (", solo single character only, exactly one figure in the whole image, " +
         "a breathtaking key visual for a big moment: the character alone in a beautiful scene that matches its " +
         "personality, dramatic pose and camera angle, full body visible from head to toe, " +
         "the horizontal frame filled with the wide scenery of the scene (sky / room / distant view) on both sides of the character, " +
         "light particles and elegant atmosphere, no other characters");
    // v167-B：CG 服装守卫（正向仙侠/汉服 + 清代强禁）——⛔ CG 无 legacy 分支；比例块仍由 cgPromptFromBrief 压最后
    return head + tail + ", " + CONSISTENCY + ", " + BG_NEG + ", " + CG_COSTUME_GUARD;
  }

  // v166-CG：场景优先辅助 —— 有 sceneText（用户确认后的「中文画面描述 / 提取的英文关键词」）时，
  //   它就是**主场景描述**，替换掉原来那段「generic beautiful scene / dramatic pose」模板；
  //   v166-CG2：景别（特写 / 近景半身 / 中景 / 全身 / 远景）由 shot 参数驱动（见 SHOT_MAP），
  //     不再焊死 full body；未写景别时才回落「单人 / 全身 / 横版 / 非肖像」。无 sceneText 回落空串（走通用模板）。
  // v166-CG2：景别解析 —— 从「中文画面描述 / 英文关键词」里认出镜头景别，转成强构图约束。
  //   景别必须听 brief，绝不能被 CG_STYLE / 通用模板里的 "wide scenery / full body" 悄悄压过。
  //   越靠前的规则越"窄"（先匹配特写/近景，再中景，最后才是全身/远景）。
  const SHOT_MAP = [
    { re: /(半身入画|半身|近景|胸像|上半身|腰部以上|齐腰|bust shot|waist ?up)/i, en: "medium close-up shot, shown from the waist up", wide: false },
    { re: /(大特写|脸部特写|面部特写|extreme close ?up)/i, en: "extreme close-up shot, the face fills most of the frame, very shallow depth of field", wide: false },
    { re: /(特写|close ?up)/i, en: "close-up shot, head and shoulders", wide: false },
    { re: /(七分身|大腿以上|膝盖以上|medium shot)/i, en: "medium shot, shown from mid-thigh up", wide: false },
    { re: /(中景)/i, en: "medium shot, the character occupies much of the frame with some surroundings", wide: false },
    { re: /(远景|大远景|全景|广角|wide shot|long shot|establishing shot|full shot)/i, en: "wide establishing shot, the character is small within a vast environment, the scenery dominates", wide: true },
    { re: /(全身|full ?body)/i, en: "full body visible from head to toe", wide: true },
  ];
  function shotClause(text) {
    const t = String(text || "");
    for (let i = 0; i < SHOT_MAP.length; i++) { if (SHOT_MAP[i].re.test(t)) return SHOT_MAP[i]; }
    return null;
  }
  function cgSceneClause(sceneText, shot) {
    if (!sceneText) return "";
    const shotEn = shot
      ? (shot.en + (shot.wide
        ? ", wide scenery also flows around the character"
        : ", the character is large and fills much of the frame, the environment stays behind them as soft bokeh, do NOT shrink the character into a small distant figure, do NOT show a full-body far view"))
      : "full body visible from head to toe, wide scenery on both sides, generous environment around the character";
    return ", " + shotEn + ", scene: " + sceneText +
      ", the same character keeps hair color, eye color, outfit and accessories consistent, " +
      "HORIZONTAL LANDSCAPE COMPOSITION, 16:9 widescreen framing, not a portrait, not a vertical poster";
  }
  // 两只沁灵的事件 CG（房间剧情用）
  // v165-A：① 补上**漏掉的画面描述** —— 旧版收了 sceneText 参数、却从未拼进 prompt（用户确认的描述进了黑洞，
  //           而 cgPromptFromBrief 又以为基串已含描述）。② 不再写死 "standing or sitting side by side"（那是姿势，
  //           交给用户描述）。③ 景别听 shot（近景/半身时不再强塞全景）。
  function storyCgPrompt(a, b, level, roomName, sceneText, shot) {
    // v127：两人的发色/特征也走「设定向导」的结果（用户确认过的优先）
    const lkA = a.look || lookOf(a.item, a.rec || null);
    const lkB = b.look || lookOf(b.item, b.rec || null);
    const apA = a.appearance || lkA.ap || appearanceOf(a.item, a.variant || 0, a.gender || "");
    const apB = b.appearance || lkB.ap || appearanceOf(b.item, b.variant || 0, b.gender || "");
    const nmA = (a.persona && a.persona.name) || a.item.name || "first character";
    const nmB = (b.persona && b.persona.name) || b.item.name || "second character";
    const mood = CG_MOOD[Math.min(CG_MOOD.length - 1, Math.max(0, Number(level) || 0))];
    const sc = String(sceneText || "").trim();
    const shotEn = sc
      ? ((shot ? shot.en : "landscape wide shot of the whole room") + ", scene: " + sc +
         ", the two characters keep their hair color, eye color, outfits and accessories consistent, " +
         "HORIZONTAL LANDSCAPE COMPOSITION, 16:9 widescreen framing, not a portrait, not a vertical poster, ")
      : ((shot ? (shot.en + ", ") : "landscape wide shot of the whole room, "));
    const poseBit = sc
      ? "the two of them together in the same scene, their poses and gestures exactly as the scene describes, "
      : "the two of them together in the room, side by side, ";
    return CG_STYLE + ", " + mood + ", " +
      "scene: a cozy ancient Chinese room called \"" + (roomName || "little room") + "\", " +
      // v165：traditional hanfu costume -> classical Chinese-inspired costume（各自随自己意象，⛔ 不锁汉服）
      "two ancient Chinese characters in classical Chinese-inspired costume together in the same scene: " +
      "① " + appearancePrompt(apA) + ", with " + lkA.hairEn + " hair and " + lkA.outfitEn + " outfit" + lookExtra(lkA) + " (name: " + nmA + "), " +
      "② " + appearancePrompt(apB) + ", with " + lkB.hairEn + " hair and " + lkB.outfitEn + " outfit" + lookExtra(lkB) + " (name: " + nmB + "), " +
      "they are the same two characters as before, keep their hair color, eye color, outfits and accessories consistent, " +
      shotEn + poseBit +
      "keep exactly two characters in the image, no extra people, no duplicates" +
      (lookHard(lkA) ? (", " + nmA + ": " + lookHard(lkA)) : "") +
      (lookHard(lkB) ? (", " + nmB + ": " + lookHard(lkB)) : "") + ", " + CONSISTENCY + ", " + BG_NEG + ", " + CG_COSTUME_GUARD;
  }

  /* ============================================================
   * v165-R2 · CG「描述先行」三段式（用户裁定：先看描述，OK 了再出图）
   *   旧流程：进页面 → 直接拼英文 prompt → **自动**出图。用户看不到要画什么，画歪只能重烧额度。
   *   新流程：⓪ **中文画面描述**（走文字通道 textChat，⛔ 只烧文本、绝不烧出图额度）
   *           ① 界面展示 + **可编辑**，用户确认 / 改
   *           ② 从确认后的描述**提取出图关键词** → 装配英文 prompt → **手动**点按钮才出图（横版 cgLadderFor）
   *   存储（⛔ 绝不碰 rec.marks / rec.cgs 资产库禁区）：
   *     · 蜕形 / 化形专属 CG → rec.cgBrief    · 节令 CG → rec.fests[dk].brief
   *     · 双人事件 CG       → Rooms.setStoryBrief（slot.brief）
   *   世界观判据：描述只写画面上看得见的东西；「游戏怎么做的」（模型名 / 额度 / hex / 按钮名）一律不写。
   * ============================================================ */
  const CG_BRIEF_CFG = { tokens: 460, kwTokens: 300, minLen: 24, maxLen: 460 };

  const CG_BRIEF_SYS = "你在为一个文玩收藏 App 写一张 CG 插画的**中文画面描述**。"
    + "沁灵是主人盘到挂瓷的手串开沁化成的小人，住在中国古代的院子与房间里，彼此是一家人。"
    + "只写画面上看得见的东西：谁在场、穿什么（按给定的服饰意象）、在什么场景、做什么动作、什么构图、什么情绪。"
    + "⛔ 不许出现模型名、接口、额度、色值代码、按钮名、版本号这类「游戏是怎么做的」的信息。"
    + "⛔ 不写对话台词，不写旁白式抒情；不要标题、不要引号、不要解释。"
    + "基调温暖有人味，绝不阴森恐怖。控制在 120-220 字，直接输出描述正文。";

  // v166：用户先写了一段「大概的 CG 意向」（可能很口语、不完整），AI 负责**润色完善**成可直接出图的描述。
  const CG_BRIEF_SYS_INTENT = "用户在为一个文玩收藏 App 写一张 CG 插画的画面描述，他先给了一段**大概的意向**（可能口语、简略、不完整）。"
    + "请你把这段意向**润色完善**成一段可以直接拿去出图的中文画面描述，要求："
    + "① 严格保留用户原意里的所有关键元素（人物、穿什么、在哪、做什么动作、什么构图、什么情绪、什么道具），只在上面补细节、让画面更具体可画；"
    + "② 写成一段连贯的中文画面描述（不是分点），120-220 字；"
    + "③ 自然融入古风意境与光线，基调温暖有人味，绝不阴森恐怖；"
    + "④ ⛔ 不要改用户的性别 / 人称设定，不要擅自加和用户冲突的元素（用户没提的武器、宠物、现代物一律不加）；"
    + "⑤ ⛔ 不许出现模型名、接口、额度、色值代码、按钮名、版本号这类「游戏是怎么做的」的信息；不要标题、不要引号、不要解释。"
    + "只输出润色后的描述正文。";

  // 事实清单（喂给文本模型）：只给**世界观内**的素材，绝不塞实现细节
  function cgBriefFacts(o) {
    const x = o || {};
    const L = [];
    const who = (p) => {
      const lk = (p && p.look) || {};
      const n = p ? String(p.name || (p.item && p.item.name) || "它") : "它";
      return "【" + n + "】服饰意象：" + (lk.outfitZh || "古风常服") + (lk.hairZh ? ("；发色意象：" + lk.hairZh) : "");
    };
    if (x.kind === "pair") {
      L.push("画面里有两只：" + who(x.a) + "；" + who(x.b));
      L.push("这是它们第 " + ((Number(x.level) || 0) + 1) + " 段故事，关系：" + (x.levelName || "正在熟络") + "；地点：" + (x.roomName || "它们的小房间"));
      if (x.storyText) L.push("这段剧情讲的是：" + String(x.storyText).replace(/\s+/g, " ").slice(0, 150));
      L.push("构图：横版宽幅，两只同框，房间与院子的环境占满画面两侧。");
    } else {
      const lk = x.look || {};
      const sd = stageDef(Math.max(1, Number(x.stage) || 1));
      const n = x.item ? String(x.item.name || "它") : "它";
      L.push("画面里只有一只：" + n + "；服饰意象：" + (lk.outfitZh || "古风常服") + (lk.hairZh ? ("；发色意象：" + lk.hairZh) : ""));
      L.push("形态：" + sd.name + "（" + (sd.sizeZh || "") + "）；称号/性格：" + ((x.persona && (x.persona.title || x.persona.name)) || "未定"));
      if (x.festName) L.push("节令：" + x.festName + "（场景：" + (x.festScene || "当令的中式院落") + "）");
      L.push("构图：横版宽幅，它一个人站在场景里，环境占满画面两侧，全身都在画内。");
    }
    return L.join("\n");
  }

  // 无 key / 调用失败时的本地模板（保证流程永远走得完，⛔ 不阻塞、不报错）
  function cgBriefLocal(o) {
    const x = o || {};
    if (x.kind === "pair") {
      const na = (x.a && (x.a.name || (x.a.item && x.a.item.name))) || "它";
      const nb = (x.b && (x.b.name || (x.b.item && x.b.item.name))) || "它";
      return na + "和" + nb + "并排待在" + (x.roomName || "它们的小房间") + "里，屋里是木格窗、矮桌和一盏小灯，" +
        "午后的光斜进来落在两个人中间。它们一个靠着桌沿、一个偏着头，谁都没说话，气氛是熟人才有的松弛。" +
        "横版构图，两只同框，房间与窗外的院子占满画面两侧，暖色调，安静有人味。";
    }
    const lk = x.look || {};
    const n = (x.item && x.item.name) || "它";
    const sd = stageDef(Math.max(1, Number(x.stage) || 1));
    return n + "独自站在" + (x.festName ? (x.festName + "的") : "") + "中式院子里，穿着" + (lk.outfitZh || "古风常服") +
      "，廊下挂着一盏灯，石板地上有落影。它微微侧身，视线看向画外，神情安静而笃定。" +
      "横版构图，人站在画面偏一侧，院墙、屋檐与远处的天色占满两侧，全身都在画内，" + sd.name + "的身形比例，暖色调。";
  }

  // ⓪ 生成中文画面描述（文本模型；失败 / 无 key → 本地模板）
  //   v166：若 o.intent 非空（用户在 textarea 先写了大概意向），则把意向交给 AI **润色完善**；
  //         o.intent 为空则按原逻辑从沁灵事实自动生成（向后兼容）。
  async function cgBrief(o) {
    const x = o || {};
    if (!getAiKey()) return cgBriefLocal(x);
    const intent = String(x.intent || "").trim();
    try {
      let sys, user;
      if (intent) {
        sys = CG_BRIEF_SYS_INTENT;
        user = cgBriefFacts(x) + "\n\n用户的意向（请润色完善，保留原意所有关键元素）：\n" + intent;
      } else {
        sys = CG_BRIEF_SYS;
        user = cgBriefFacts(x);
      }
      const txt = await aiChat([
        { role: "system", content: sys },
        { role: "user", content: user },
      ], CG_BRIEF_CFG.tokens);
      const s = String(txt || "").trim();
      if (s.length >= CG_BRIEF_CFG.minLen) return s.slice(0, CG_BRIEF_CFG.maxLen);
    } catch (e) { /* 回落本地模板 */ }
    return cgBriefLocal(x);
  }

  // ② 从**确认后**的中文描述提取英文出图关键词（文本模型；失败 → 空串，由 cgPromptFromBrief 直附中文）
  async function cgKeywords(brief, o) {
    const b = String(brief || "").trim();
    if (!b || !getAiKey()) return "";
    const sys = "你把一段中文画面描述压缩成**英文出图关键词**（prompt 片段）。"
      + "只输出一串英文短语，用逗号分隔；不要句子、不要解释、不要引号、不要换行。"
      + "按顺序覆盖：人物与服饰、动作与姿态、场景与道具、构图与景别、光线与色调、情绪。"
      + "⛔ 不要输出中文，不要输出任何技术参数（尺寸、模型名、色值代码）。控制在 60 个词以内。";
    try {
      const txt = await aiChat([
        { role: "system", content: sys },
        { role: "user", content: b + "\n\n(画面里有 " + (((o || {}).kind === "pair") ? "两个" : "一个") + "角色)" },
      ], CG_BRIEF_CFG.kwTokens);
      const s = String(txt || "").replace(/[\r\n]+/g, " ").replace(/[`"'。]/g, "").trim();
      // 只认纯英文关键词串（含中文说明/解释的一律丢弃，回落直附中文描述）
      if (s.length >= 20 && !/[一-龥]/.test(s)) return s.slice(0, 700);
    } catch (e) { /* 回落 */ }
    return "";
  }

  // 装配最终英文 prompt：CG_STYLE / 外观 / 阶段 / ANATOMY / CONSISTENCY / BG_NEG / PROPORTION LOCK **一律照带**
  // ⚠️ 顺序：确认后的描述 + CONSISTENCY + BG_NEG 插在**比例锁定块之前** —— PROPORTION LOCK 永远压在最末尾。
  // v165-A：比例块改走 cgPropFor(stage, shot)（去姿势化 + 按景别收放"全身/腿长"），不再直接复用 sd.prop。
  function cgPromptFromBrief(brief, o) {
    const x = o || {};
    const b = String(brief || "").trim();
    const kw = String(x.keywords || "").trim();
    const scene = kw || b;                     // 有英文关键词就用关键词，否则直附中文描述（模型读得懂）
    const shot = shotClause(b + " " + kw);     // v166-CG2：景别优先从中文原文解析，确保「近景/半身」不被关键词吃掉
    const stage = Math.max(1, Number(x.stage) || 1);
    let base;
    if (x.kind === "pair") base = storyCgPrompt(x.a, x.b, x.level, x.roomName, scene, shot);
    else if (x.kind === "fest") base = festCgPrompt(x.item, null, stage, x.appearance, x.look, x.fest, scene, shot);
    else base = promptForCg(x.item, null, stage, x.appearance, x.look, scene, shot);
    // base 已以「brief/关键词」为主场景 + 外观 + 阶段 + CONSISTENCY + BG_NEG；末尾只补比例锁定块（PROPORTION LOCK 永远压最后）。
    // ⛔ v166-CG 修复：不再把 brief 当低权重尾巴追加 —— 它现在是主场景描述。
    const prop = cgPropFor(stage, shot);
    // v172-A：构图锚插在比例锁定块**之前**；PROPORTION LOCK 仍压在最末位。
    //   ⚠️ typeof 守卫：cgPromptFromBrief 会被单测以「抽函数 + 沙箱」方式隔离运行（_test_v166_cg_brief），
    //      此时 zhAnchorEnabled / CG_COMPOSE_ZH 不在作用域 → 静默不加锚，⛔ 别让旧套件因取符号炸掉
    const anchor = (typeof zhAnchorEnabled === "function" && typeof CG_COMPOSE_ZH !== "undefined" && zhAnchorEnabled()) ? CG_COMPOSE_ZH : "";
    return base + (anchor ? (", " + anchor) : "") + (prop ? (", " + prop) : "");
  }

  // 用**任意 prompt**出图（剧情 CG 用；沁灵主图仍走 generateImage）
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
   * v157：回忆册 —— 把这只沁灵的"第一次"串成一条时间线
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
    add(item.createdAt || item.arrivedAt, "🛍", "到家那天", "一串还没醒过来的珠子");
    // ② 挂瓷开沁
    add(rec.bornAt, "✨", "挂瓷开沁", "第一次开口，喊的是你");
    // ③ 模样与深沁：立绘历史里 stage 发生变化的那些（第一条 = 初次有模样）
    const hist = (rec.imgHistory || []).filter((x) => x && x.at);
    let last = 0;
    hist.forEach((x) => {
      const st = Number(x.stage) || 0;
      if (st < 1 || st === last) return;
      const def = stageDef(st);
      if (st === 1) add(x.at, "🎨", "有了自己的模样", def.icon + " " + def.name);
      else add(x.at, "⚡", "深沁 · " + def.name, "从上一形态又长大了一岁");
      last = st;
    });
    // ④ 回响信（它替你记着的那些日子）
    (rec.echoes || []).forEach((e) => add(e && e.at, "✦", (e && e.title) || "✦ 回响", "替你记着的日子"));
    // ⑤ 第一篇日记
    const d0 = (rec.diary || [])[0];
    add(d0 && d0.at, "📔", "写下第一篇日记", "从此有了自己的心事");
    // ⑥ 第一张专属 CG
    add(rec.cgAt, "🎬", "有了第一张专属插画", "你们的第一幕场景");

    out.sort((a, b) => a.at - b.at);
    return out;
  }

  /* =========================================================
   * v157：沁灵巷 —— 每天自带几条"小镇里发生的小事"
   *   纯本地拼接（确定性：同一天同一结果），0 出图 0 模型调用
   * ========================================================= */
  const TOWN_EVENTS = [
    { icon: "🍵", t: "{a} 给 {b} 倒了盏茶，谁也没说话，坐了一炷香。" },
    { icon: "🪡", t: "{b} 的系带松了，{a} 低头替他系好，系了很久。" },
    { icon: "🪷", t: "院子里那盆莲开了，{a} 把 {b} 叫出来看，两个人都没看出门道。" },
    { icon: "🍊", t: "{a} 分了个橘子给 {b}，自己留了最小的一瓣。" },
    { icon: "🌙", t: "半夜 {a} 醒了，发现 {b} 也睁着眼，就一起坐到天亮。" },
    { icon: "🪑", t: "为了院里那把竹椅，{a} 和 {b} 客气了一整天，最后谁也没坐。" },
    { icon: "📿", t: "{a} 教 {b} 数数，{b} 数到第三遍还是乱了。" },
    { icon: "🕯", t: "{b} 喊冷，{a} 把自己的棉垫挪过去一半。" },
    { icon: "🐈", t: "一只野猫翻墙进来，{a} 和 {b} 一起看着它，直到它走。" },
    { icon: "🎋", t: "{a} 在墙上刻了一道，说这是他和 {b} 认识的头一个月。" },
    { icon: "🍚", t: "灶上的饭糊了，{a} 说是 {b} 干的，{b} 没否认。" },
    { icon: "🪁", t: "{a} 把风筝放断了线，{b} 说：断了就断了，明年再放。" },
    { icon: "🧵", t: "{b} 的袖口磨破了，{a} 用同色的线补上，不细看看不出来。" },
    { icon: "🌧", t: "下雨了，{b} 站在檐下不肯进去，{a} 就陪他站着。" },
    { icon: "🍶", t: "{a} 把最后一盅让给了 {b}，说它今天高兴。" },
    { icon: "🪶", t: "{a} 替 {b} 掸了掸肩上的灰，动作很轻。" },
    { icon: "🧺", t: "{a} 和 {b} 一起晒了被子，收的时候抢着抱同一床。" },
    { icon: "🪔", t: "灯芯烧短了，{a} 伸手挑亮，{b} 就着光看他。" },
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
        if (bi === ai) bi = (ai + 1) % arr.length;      // 保证 a、b 不是同一尊
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
    // v165-R1：竖版（立绘）尺寸阶梯常量 —— 供自测断言「立绘走竖版梯子、不走 CG 横版梯子」
    SIZE_BY_PROVIDER, SIZE_DEFAULT_LADDER,
    STAGES, stageDef, stageInfo, growthOf, STAGE_DAYS, STAGE_PLAYS, HEAD_COUNT, stageOf, headCountOf, stageOrnate, stageProgress,
    // v165-F：立绘比例执行手段 v2（占满画幅 / 中文比例锚[仅 ark] / 阶段开场身份锚）——供自测断言
    FRAME_FILL, FRAME_FILL_OLD, PROPORTION_ZH, proportionZhFor, AGE_OPEN, AGE_OPEN_BOY_OLD, AGE_OPEN_GIRL_OLD,
    // v167-B：服装去清代（正向汉服/仙侠 + 清代强禁 + 中文服装锚）——供自测断言
    NO_QING, XIANXIA_LOOK, COSTUME_ZH, CG_COMPOSE_ZH, CG_COSTUME_GUARD, ZH_ANCHOR_ON, zhAnchorEnabled, LEGACY_OUTFIT_EN,
    appearanceOf, appearanceText, appearancePrompt, HAIR_STYLES, BOY_HAIR, GIRL_HAIR, EYE_COLORS, ACCESSORIES,
    // v127：设定向导（发色/特征/性格可确认可修改；一句基础设定 → 扩写成详细设定）
    HAIR_COLORS, HAIR_PALETTE, hexToCnTrad, FEATURES, PERSONAS_PICK, lookOf, lookText, lookExtra, hairWordFromInput, expandProfile, profileLocal, genderFromText,
    COLOR_ZH, HAIR_ZH, EYES_ZH, ACC_ZH, VIBE_ZH,
    TEXT_PROVIDERS, getTextCfg, setTextCfg, textInfo, textChat, testImage, testText, listModels,
    promptFor, pollinationsUrl, legacyPollinationsUrl, generateImage, localAvatarSvg, seedOf, normModelName, pickBestModel, keyHint, isFetchFail,
    // v166：立绘表情变体（base + 6 表情；详情页切换 / 对话按情绪自动选已缓存表情）
    EXPR_LIST, EXPR_BY_KEY, EXPR_SALT_BASE, exprForText,
    localPersona, persona, chat, letter, localChat, localLetter,
    todayKey, load, save, ensureIn, recordEvent, allEvents, drainEventPops, extractLookBrief, validateAnatomy, renderConfirmCard,
    // v164：出图单（用户确认卡 → look.brief → 真进 prompt）
    toBrief, mergeBrief, briefHard, applyBrief,
    // v110：性别在「挂瓷开沁」时定下来（男女 3:1），之后不可改
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
    // v165-A：CG 姿势词剥离（stripPose / cgPropFor）+ 景别解析（SHOT_MAP / shotClause / cgSceneClause）
    SHOT_MAP, shotClause, cgSceneClause, CG_POSE_RE, CG_WIDE_ONLY_RE, cgTidy, stripPose, cgPropFor,
    // v165-R2：CG「描述先行」三段式（⓪ 生成中文描述 → ① 用户确认/编辑 → ② 提取关键词装配 prompt → 手动出图）
    CG_BRIEF_CFG, CG_BRIEF_SYS, CG_BRIEF_SYS_INTENT, cgBriefFacts, cgBriefLocal, cgBrief, cgKeywords, cgPromptFromBrief,
    // v125：阶段规则 —— 凝形/开窍只有立绘；觉醒/化形额外出 CG
    cgStages: [3, 4], needCg: function (stage) { return (Number(stage) || 1) >= 3; },
    // v155：陪伴系统（每日问候 / 亲密度 / 每日一签 / 日记回信 / 回响）—— 全本地，0 成本
    BOND_LEVELS, BOND_CALL_AT, bondLevel, settleBond, addBond, callOf,
    // v165：羁绊八档升级 + 称呼 + 送礼 + 心迹 + 受伤（数据层与纯函数；⛔ 本批不接 UI）
    BOND_VAL, BOND_CFG, GIFT_CFG, CARE_CFG, HEART_CFG, LOVE_CFG, HARM_CFG, BOND_YOU_LV, BOND_NICK_LV,
    callFor, nurtureOf, normRecV165,
    GIFTS_KEY, loadGifts, saveGifts, addGift, giftListOf, giftClsOf, giftNameOf, giftDescOf, giftPrefOf, personaIdOf,
    GIFT_CATALOG, GIFT_CLASSES, giveGift,
    IMAGERY_OUTFITS, imageryOutfitOf,   // v165 修正：导出以便单测（此前未导出）
    CARE_ACTS, careAct, careDoneOf, careActOf,
    GIFT_REACTIONS, GIFT_REACTION_FALLBACK, giftReactionOf, GIFT_COPY,
    GIFT_LOG_KEY, loadGiftDay, giftGivenToday, noteGiftGiven,
    // v165：BG 场景背景系统（全局 21 张；ww_bg 永久 URL；ensureBg 并发去重）
    BG_KEY, BG_CATALOG, BG_CHAPTER_MAP, BG_STYLE, BG_NEG, BG_STATIC_DIR, NEG_STYLE, bgByKey, bgSeedKey, bgForChapter, bgLoadAll, bgGet, bgPut, ensureBg,
    HEART_MARKS, HEART_LV_NAMES, heartLevel, addHeart,
    harmedOf, setHarmed, starMarkOf, setStarMark,
    fmt, greetVars,
    GREET, greetingOf, ensureGreet,
    SIGNS, signOf, ensureSign,
    replyDiary, pendingReply,
    ECHO_DAYS, ECHO_LABEL, echoDue, ensureEcho, nextEcho, unreadMail,
    // v157：回忆册（本地时间线，0 成本）
    memoirOf,
    // v157：沁灵巷（本地动态，0 成本）
    TOWN_EVENTS, townEvents,
    // v158：节令事件（全本地；限定 CG 由界面按钮手动确认才花）
    FEST_LUNAR, FEST_DEF, FEST_SOLAR, FEST_LINES, festOf, festMap, nextFest, ensureFest, festList, festCgPrompt,
    // v158：主线「串与我」（串与主人之间，按四形态分卷；全本地 0 成本）
    CHAPTERS, chapterState, readChapter, unreadChapterCount,
    // v161：主线「串与我」· 对话版（本地剧本 + 本地状态机，0 出图 0 模型调用）
    CHAP_ACTS, CHAP_TALK_CAP, chapActOf, chapTalkEnter, chapTalkChoose, chapTalkReplay, chapTalkBrief, chapTalkDone,
    // v165 批次3A：剧本 flag 载体（rset / gset / fb / FORK_STANCE tally / {ta}）—— 供自测与调试面板
    CHAP_FLAG_CFG, chapRecByPersona, chapWriteRecFlag, chapApplyRset, chapApplyGset, chapRecomputeFork, chapApplySets,
    chapTaSet, chapTaGet, chapTaNameOf,
    // v165 批次3A P1：casting（出场表）+ 演出层字段读取
    CHAP_CAST_CFG, CHAP_CAST_NAME, CHAP_AT_ZH, castOf, castBuild, castPick, castNearest,
    // v172：选角文案（单一可替换数据源 + 两个导出别名）+ 无 persona 标记
    CHAP_CAST_COPY, CHAP_CAST_DESC, CHAP_CAST_ROW_COPY, CAST_NO_PERSONA_TAG,
    // v172：手动选角写入口（⛔ 只写 ww_story，绝不碰 ww_spirits 逐串 rec）
    castSetManual, castClearManual, castClearAllManual,
    chapAtOf, chapBgOf, chapAsset,
    // v165 批次3A-8：主线 1–9 章天数锚点（⛔ 硬编码，岁除按日历事件）
    MAIN_DAY_ANCHOR,
    // v165-N3：新 9 章《沁灵纪》**独立入口**（⛔ 旧 8 章 CHAP_SCRIPTS / CHAPTERS 原样保留，只取消入口）
    MAIN_STORY_OPEN, MAIN_CHAPTERS, MAIN_SCRIPTS, MAIN_ACTS, mainActOf,
    mainChapterState, mainUnreadCount, mainReadChapter, mainReadMap,
    mainTalkEnter, mainTalkChoose, mainTalkReplay, mainTalkBrief,
    // v160：夜话（跨串大剧情 · 互动对话）—— 本地剧本 + 本地状态机，0 出图 0 模型调用
    NIGHT_ACTS, NIGHT_GROUP, NIGHT_CAP, nightCast, nightActs, nightEnter, nightReplay, nightChoose, nightBrief,
    // v162：夜话 2.0 —— 多会话（全家群 / 房间群 / 双人组）+ 按条件触发的事件
    NIGHT_EVENTS, THREAD_FAMILY, THREAD_CAP, OCC_BANDS, eventOf, occasionOf,
    nightThreads, threadEvents, threadEnter, threadChoose, threadReplay, threadBrief, threadTalkBrief, threadMigrate,
    // v163：条件系统（env 契约 / 胎性 / 亲密度兜底 / 主串）
    soloEnv, tiXingOf, 胎性Of: tiXingOf, tiXingLabel, TIXING_ZH, normTiXing, bondOf,
    storyMainId, mainSetOf, setMainStory, readStory, writeStory, setMainItems,
    // v164n：多结局 flag 系统（可判定存档数据 + 岁除判定纯函数）
    ENDING_CFG, evaluateEnding, resolveEnding, setStance, endingFlagsOf,
    getEndingStory, setForkStance, addKeyChoice, setKeyChoices, setJointPrep,
    WHEN_KEYS, whenOK, whenNeed, thMember,
    pruneForQuota,
    // v163：CG 资产库（像素在 IndexedDB / 元数据在主 store；「已收集」只认元数据）
    CG_DB_NAME, CG_FALLBACK_KEY, CG_TOTAL, CG_THUMB_KEEP, cgsOf, cgMetaOf, cgCollectedIds, cgCollectedCount, cgAdvIds, backfillAdvCg,
    cgMarkCollected, cgMarkFailed, cgStateOf, cgSlotOf, dropOldCgThumbs,
    // v172-E：进阶 CG 允许多张（cgList 历史列表 + 懒迁移 + 归档 key 唯一化）
    CG_LIST_MAX, cgListRO, ensureCgList, cgListPush, cgListRemove, cgListCount, cgAdvKey,
    CG_STATE_CLASS, CG_STATE_HINT, cgCellClass, cgCellHint,
    cgPutPixels, cgGetPixels, cgDelPixels, cgHasPixels,
  };
})();
