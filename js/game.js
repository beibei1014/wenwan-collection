/* =========================================================
 * game.js — 游戏化系统（地球Online风）
 * 全部数据从收藏记录推导，无需打卡、无需存状态，跨设备一致
 * 经验 / 等级称号 / 每日任务 / 不买挑战 / 收集进度
 * ========================================================= */
(function () {
  "use strict";

  /* ---------- 盘玩打卡（连续天数 / 历史最长） ---------- */
  function dayKeyFromTs(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function todayKey() { return dayKeyFromTs(Date.now()); }
  function dayKeyToTs(key) { const p = String(key).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime(); }
  // 规整打卡日期数组：去重 + 升序（只保留 YYYY-MM-DD）
  function normDays(days) {
    const set = new Set((days || []).filter((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)));
    return Array.from(set).sort();
  }
  // 历史最长连续打卡（只增不减 → 用于 XP，避免断签降级）
  function bestStreak(days) {
    const arr = normDays(days);
    if (!arr.length) return 0;
    let best = 1, cur = 1;
    for (let i = 1; i < arr.length; i++) {
      const diff = Math.round((dayKeyToTs(arr[i]) - dayKeyToTs(arr[i - 1])) / 86400000);
      if (diff === 1) cur++;
      else if (diff > 1) cur = 1;
      if (cur > best) best = cur;
    }
    return best;
  }
  // 当前连续打卡（今天没打则从昨天往前算；断了返回 0）
  function currentStreak(days) {
    const set = new Set(normDays(days));
    if (!set.size) return 0;
    const DAY = 86400000;
    const todayTs = dayKeyToTs(todayKey());
    let ts;
    if (set.has(todayKey())) ts = todayTs;
    else if (set.has(dayKeyFromTs(todayTs - DAY))) ts = todayTs - DAY;
    else return 0;
    let n = 0;
    while (set.has(dayKeyFromTs(ts))) { n++; ts -= DAY; }
    return n;
  }

  /* ---------- 经验里程碑（达到即得经验，幂等可重复计算） ---------- */
  function computeXp(items, playDays) {
    const stats = Stats.computeStats(items);
    const playedCount = items.filter((i) => i.playStatus === "playing").length;
    const puzzleDone = items.filter((i) => i.playStatus === "puzzle_done").length;
    const photoCount = items.reduce((s, i) => s + (i.photos || []).length, 0);
    const totalDays = items.reduce((s, i) => s + DB.daysWith(i), 0);
    const catCount = new Set(items.map((i) => i.category).filter(Boolean)).size;

    let xp = 0;
    const milestones = [];

    // 收藏数量
    const counts = [1, 10, 20, 50, 100];
    const countXp = [50, 100, 200, 500, 1000];
    counts.forEach((c, i) => {
      if (stats.total >= c) { xp += countXp[i]; milestones.push({ icon: "📦", name: "收藏 " + c + " 件", xp: countXp[i] }); }
    });

    // 拼图完成
    const puzzles = [5, 20, 50, 100, 300, 1000];
    const puzzleXp = [100, 300, 600, 1500, 4000, 10000];
    puzzles.forEach((c, i) => {
      if (puzzleDone >= c) { xp += puzzleXp[i]; milestones.push({ icon: "🧩", name: "完成 " + c + " 幅拼图", xp: puzzleXp[i] }); }
    });

    // 菩提类收藏（菩提之道经验）
    const beadCount = items.filter((i) => /菩提|金刚|凤眼|星月/.test((i.name || "") + (i.species || ""))).length;
    const beads = [5, 15, 30, 50, 100, 300, 1000];
    const beadXp = [100, 250, 400, 600, 1200, 3000, 8000];
    beads.forEach((c, i) => {
      if (beadCount >= c) { xp += beadXp[i]; milestones.push({ icon: "📿", name: "菩提收藏 " + c + " 件", xp: beadXp[i] }); }
    });

    // 送出
    const gifts = [1, 5];
    const giftXp = [100, 300];
    gifts.forEach((c, i) => {
      if (stats.gifted >= c) { xp += giftXp[i]; milestones.push({ icon: "🎁", name: "送出 " + c + " 件宝贝", xp: giftXp[i] }); }
    });

    // 花费
    const spends = [1000, 5000, 10000];
    const spendXp = [100, 500, 1000];
    spends.forEach((c, i) => {
      if (stats.totalSpent >= c) { xp += spendXp[i]; milestones.push({ icon: "💸", name: "累计消费 ¥" + c, xp: spendXp[i] }); }
    });

    // 收藏盒子
    const cats = [3, 6];
    const catXp = [100, 300];
    cats.forEach((c, i) => {
      if (catCount >= c) { xp += catXp[i]; milestones.push({ icon: "🗃️", name: "覆盖 " + c + " 个收藏盒子", xp: catXp[i] }); }
    });

    // 盘玩（正在盘玩的条数）
    const plays = [1, 5];
    const playXp = [50, 200];
    plays.forEach((c, i) => {
      if (playedCount >= c) { xp += playXp[i]; milestones.push({ icon: "🤲", name: c + " 条正在盘玩", xp: playXp[i] }); }
    });

    // 累计盘玩次数（只增不减 → 盘串也能升级，不靠买买买）
    const totalPlays = items.reduce((s, i) => s + (Number(i.playCount) || 0), 0);
    const playCnts = [10, 50, 100, 300, 1000];
    const playCntXp = [60, 200, 500, 1500, 4000];
    playCnts.forEach((c, i) => {
      if (totalPlays >= c) { xp += playCntXp[i]; milestones.push({ icon: "🤲", name: "累计盘玩 " + c + " 次", xp: playCntXp[i] }); }
    });

    // 连续打卡（用「历史最长」算 XP → 只增不减，断签不会掉级）
    const bStreak = bestStreak(playDays);
    const streakCnts = [3, 7, 14, 30, 100];
    const streakXp = [80, 200, 450, 1200, 4000];
    streakCnts.forEach((c, i) => {
      if (bStreak >= c) { xp += streakXp[i]; milestones.push({ icon: "🔥", name: "连续打卡 " + c + " 天", xp: streakXp[i] }); }
    });

    // 陪伴总天数
    const days = [365, 1000];
    const dayXp = [200, 500];
    days.forEach((c, i) => {
      if (totalDays >= c) { xp += dayXp[i]; milestones.push({ icon: "⏳", name: "累计陪伴 " + c + " 天", xp: dayXp[i] }); }
    });

    // 照片
    const photos = [10, 50];
    const photoXp = [100, 300];
    photos.forEach((c, i) => {
      if (photoCount >= c) { xp += photoXp[i]; milestones.push({ icon: "📸", name: "拍了 " + c + " 张照片", xp: photoXp[i] }); }
    });

    // 不买挑战（隐藏任务，自动累计）
    const noBuyDays = daysSinceLastBuy(items);
    const noBuys = [7, 30, 50, 100, 365, 1000];
    const noBuyXp = [50, 200, 400, 800, 2000, 5000];
    noBuys.forEach((c, i) => {
      if (noBuyDays >= c) { xp += noBuyXp[i]; milestones.push({ icon: "🧘", name: "不买挑战 " + c + " 天", xp: noBuyXp[i] }); }
    });

    return { xp, milestones, stats, noBuyDays, puzzleDone, playedCount, catCount, photoCount, totalDays, totalPlays, bestStreak: bStreak, currentStreak: currentStreak(playDays) };
  }

  /* ---------- 不买挑战：距离上次购买天数 ---------- */
  function daysSinceLastBuy(items) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let latest = 0;
    items.forEach((i) => {
      const ts = i.arrivedAt || i.createdAt;
      if (ts && ts > latest) latest = ts;
    });
    if (!latest) return 0;
    const last = new Date(latest);
    last.setHours(0, 0, 0, 0);
    return Math.floor((now - last) / 86400000);
  }

  /* ---------- 等级与称号 ---------- */
  const LEVELS = [
    { min: 0, name: "收藏萌新", icon: "🌱" },
    { min: 150, name: "手作爱好者", icon: "🎨" },
    { min: 400, name: "文玩学徒", icon: "📿" },
    { min: 800, name: "盒子收藏家", icon: "🗃️" },
    { min: 1400, name: "盘玩高手", icon: "🤲" },
    { min: 2200, name: "资深藏家", icon: "🏺" },
    { min: 3200, name: "收藏大师", icon: "🎖️" },
    { min: 4500, name: "百宝箱守护者", icon: "🛡️" },
    { min: 6000, name: "异世界收藏王", icon: "👑" },
  ];

  function getLevel(xp) {
    let lv = 1, name = LEVELS[0].name, icon = LEVELS[0].icon;
    LEVELS.forEach((L, i) => {
      if (xp >= L.min) { lv = i + 1; name = L.name; icon = L.icon; }
    });
    // 当前等级区间与下一等级区间（用于进度条）
    const cur = LEVELS[lv - 1];
    const next = lv < LEVELS.length ? LEVELS[lv] : null;
    const curMin = cur.min;
    const nextMin = next ? next.min : curMin + 2000;
    const progress = Math.min(100, Math.round(((xp - curMin) / (nextMin - curMin)) * 100));
    return { level: lv, name, icon, xp, curMin, nextMin, progress };
  }

  /* ---------- 每日任务（地球Online风，自动检测 + 每日随机） ---------- */
  // 用日期作随机种子：同一天内所有人看到相同任务，第二天自动换一批
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(arr, seed) {
    const a = arr.slice();
    const rand = mulberry32(seed);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* ---------- 每日任务 · 台账（v165 每日任务改造；玩家级，本地优先） ----------
     🔴 只动库存：领奖发礼物（addGift），⛔ 绝不调 addBond/giveGift —— 亲密度唯一入口是玩家「递一件」。
     台账挂 localStorage `ww_daily`：{day, acts, claimed, tasks, days}（每日任务改造设计 §5.1）。 */
  const DAILY_KEY = "ww_daily";
  const DAILY_CFG = {
    COUNT: 5,            // 每日固定 5 条（用户要求，⛔ 不多不少）
    REWARD_KIND: "gift", // 奖励形态：礼物
    REWARD_N: 1,         // 每任务 1 件
    KEEP_XP: true,       // 保留少量 XP（否则既有等级/成就断粮）
    XP_PER: 10,          // 每任务 XP（team-lead 拍板 10）
    BACKFILL: false,     // ⛔ 不补做
    DAILY_MAX_GIFT: 5,   // 每日礼物上限（=任务数；与送礼「全局 ≤2/日」分开计）
  };
  // 5 条固定菩提根任务（大纲 §13.2 正式案 / 本设计 §3.2）。
  //   v175：每条都绑定 **一个真实存在的玩家行为** + **当天指定的一只沁灵**：
  //     act  = 达成信号（app.js 在行为真实发生处调 Game.markDaily(act + ":" + 沁灵id)）
  //     key  = 旧达成信号（只为向后兼容：老 ww_daily 里的裸键仍算达成，⛔ 别删）
  //     go   = 跳转落点（spirit → #/spirit/<id>；night → #/night）
  //     global = 非单只行为（夜话）：不按沁灵 id 绑定
  //     desc 里的 {name} 由 buildDailyTasks 换成「当天那只」的名字。均属菩提根，池内 0 处他类别词。
  const DAILY_TEMPLATES = [
    { id: "jingshou",  key: "greet", act: "clean", icon: "🫧", title: "净手", desc: "去看看 {name}，顺手拾掇一下（详情页 · 照料「探看」）",                 cls: "ware",  gifts: ["ware_cup", "ware_ink"], go: "spirit" },
    { id: "peizuo",    key: "play",  act: "play",  icon: "🍵", title: "陪坐", desc: "今天陪 {name} 坐一回（详情页 · 盘玩）",                              cls: "human", gifts: ["human_tea", "human_snack"], go: "spirit" },
    { id: "kanwen",    key: "greet", act: "greet", icon: "🔎", title: "看纹", desc: "看看那只那道纹，今天走到哪儿了。今天去看 {name}（进详情页打个招呼）", cls: "odd",   gifts: ["odd_glass", "odd_shell"], go: "spirit" },
    { id: "shoudeng",  key: "night", act: "night", icon: "🏮", title: "守灯", desc: "把这盏灯守到有人回来 —— 今晚去夜话，看看 {name} 那边有没有动静",      cls: "cloth", gifts: ["cloth_pa", "cloth_stone"], go: "night", global: true },
    { id: "yingsheng", key: "reply", act: "reply", icon: "🔔", title: "应声", desc: "{name} 写了一句话 —— 回一声（详情页 · 日记回一句）",                  cls: "sound", gifts: ["sound_bell", "sound_drum"], go: "spirit" },
  ];
  function dailyDefaults() { return { day: "", acts: {}, claimed: {}, tasks: [], days: 0 }; }
  function normDailyObj(d) {
    if (!d || typeof d !== "object") return dailyDefaults();
    return {
      day: String(d.day || ""),
      acts: (d.acts && typeof d.acts === "object") ? d.acts : {},
      claimed: (d.claimed && typeof d.claimed === "object") ? d.claimed : {},
      tasks: Array.isArray(d.tasks) ? d.tasks : [],
      days: Math.max(0, Math.floor(Number(d.days) || 0)),
    };
  }
  function loadDaily() { try { const raw = localStorage.getItem(DAILY_KEY); return normDailyObj(raw ? JSON.parse(raw) : {}); } catch (e) { return dailyDefaults(); } }
  function saveDaily(o) { try { localStorage.setItem(DAILY_KEY, JSON.stringify(normDailyObj(o || {}))); return true; } catch (e) { return false; } }
  // 跨日：清空 acts/claimed/tasks（保留 days 累计）；⛔ 不补做
  function ensureDaily(d) {
    const tk = todayKey();
    if (d.day !== tk) { d.day = tk; d.acts = {}; d.claimed = {}; d.tasks = []; }
    return d;
  }
  // 记一次行动（当日每键只记 1 次）
  function markDaily(actionKey) {
    const k = String(actionKey || "");
    if (!k) return false;
    const d = ensureDaily(loadDaily());
    if (d.acts[k]) { saveDaily(d); return false; }
    d.acts[k] = 1;
    saveDaily(d);
    try { window.dispatchEvent(new CustomEvent("ww:daily-changed")); } catch (e) { /* 忽略 */ }
    return true;
  }
  // 日期种子：YYYYMMDD（当天固定、跨设备一致，沿用既有 mulberry32）
  function dailySeedNum(dayKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
    if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    const n = new Date();
    return n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate();
  }
  function strHash(str) { let h = 0; const x = String(str || ""); for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) | 0; return h >>> 0; }

  /* ---------- v175：目标沁灵 + 行为键（绑定真实动作 / 老数据向后兼容） ---------- */
  // 在册沁灵候选池（与 app.js 沁灵列表同口径：未送出 + 已挂瓷 + 未设「只当手串」）
  function spiritPool(items) {
    let store = {};
    try { if (typeof Spirits !== "undefined" && Spirits && Spirits.load) store = Spirits.load() || {}; } catch (e) { store = {}; }
    const arr = (Array.isArray(items) && items.length) ? items : Object.keys(store).map((id) => ({ id: id }));
    const out = [], seen = {};
    arr.forEach((it) => {
      if (!it || !it.id || seen[it.id]) return;
      if (it.gifted) return;
      if (it.playStatus && it.playStatus !== "done") return;
      const rec = store[it.id] || {};
      if (rec.spirit === false) return;                 // v166：设了「只当手串」的不进沁灵列表
      seen[it.id] = 1;
      out.push({ id: it.id, name: rec.name || (rec.persona && rec.persona.name) || it.name || "沁灵" });
    });
    return out;
  }
  // 当天每条任务的目标沁灵（日期种子 ⇒ 当天固定、跨设备一致）
  function dailyTargets(items, dayKey) {
    const pool = spiritPool(items);
    const seed = (dailySeedNum(dayKey) ^ strHash("v175-daily")) >>> 0;
    return DAILY_TEMPLATES.map((tpl) => {
      if (!pool.length) return { id: "", name: "沁灵" };
      return seededShuffle(pool, (seed ^ strHash(tpl.id)) >>> 0)[0];
    });
  }
  function fillDailyName(tpl, name) { return String(tpl == null ? "" : tpl).replace(/\{name\}/g, String(name || "沁灵")); }
  // 行为键：带 spiritId（如 "play:<id>"）；非单只行为或没有目标沁灵时退回裸键
  function actKeyOf(tpl, spiritId) {
    const act = String((tpl && (tpl.act || tpl.key)) || "");
    if (tpl && tpl.global) return act;
    const sid = String(spiritId || "");
    return sid ? act + ":" + sid : act;
  }
  // 完成判定：先认带 id 的键，再认老裸键（老 ww_daily 数据不炸、也不误判为已做）
  function actDoneOf(d, tpl, spiritId) {
    const acts = (d && d.acts) || {};
    const act = String((tpl && (tpl.act || tpl.key)) || "");
    const legacy = String((tpl && tpl.key) || "");
    if (act && acts[act]) return true;                  // 裸键（老数据 / 未带 id 的记账）
    if (legacy && acts[legacy]) return true;            // 老 key 裸键（向后兼容）
    const pre = act + ":";
    if (tpl && tpl.global) return Object.keys(acts).some((x) => x.indexOf(pre) === 0);
    const sid = String(spiritId || "");
    if (sid) return !!acts[pre + sid];
    return Object.keys(acts).some((x) => x.indexOf(pre) === 0);
  }
  // 某任务当日发哪件礼物（2 候选取 1，日期种子决定 → 当天固定、跨设备一致）
  function rewardGiftOf(tpl, dayKey) {
    const arr = (tpl && tpl.gifts && tpl.gifts.length) ? tpl.gifts : [];
    if (!arr.length) return "";
    if (arr.length === 1) return arr[0];
    const seed = (dailySeedNum(dayKey) ^ strHash(tpl && tpl.id)) >>> 0;
    return seededShuffle(arr, seed)[0];
  }
  function giftNameSafe(key) {
    try { return (typeof Spirits !== "undefined" && Spirits && Spirits.giftNameOf) ? Spirits.giftNameOf(key) : String(key || ""); }
    catch (e) { return String(key || ""); }
  }
  // 当日 5 条任务（含 done；种子固定）—— 返回形状向后兼容 app.js（icon/title/desc/done/xp）
  function buildDailyTasks(items) {
    const day = todayKey();
    const d = ensureDaily(loadDaily());
    const targets = dailyTargets(items, day);
    const tasks = DAILY_TEMPLATES.map((tpl, i) => {
      const gk = rewardGiftOf(tpl, day);
      const tg = targets[i] || { id: "", name: "沁灵" };
      const done = actDoneOf(d, tpl, tg.id);
      const isNight = String(tpl.go || "") === "night";
      return {
        id: tpl.id, key: tpl.key, act: tpl.act || tpl.key, actKey: actKeyOf(tpl, tg.id),
        want: tpl.want || tpl.key, icon: tpl.icon,
        title: tpl.title, desc: fillDailyName(tpl.desc, tg.name), target: 1,
        spiritId: tg.id, spiritName: tg.name,
        go: isNight ? "#/night" : (tg.id ? "#/spirit/" + encodeURIComponent(tg.id) : ""),
        done: done, progress: done ? 1 : 0,
        xp: DAILY_CFG.KEEP_XP ? DAILY_CFG.XP_PER : 0,
        giftKey: gk, giftName: giftNameSafe(gk), claimed: !!d.claimed[tpl.id],
      };
    });
    d.tasks = tasks.map((t) => ({ id: t.id, key: t.key, actKey: t.actKey, spiritId: t.spiritId, giftKey: t.giftKey, done: t.done }));
    saveDaily(d);
    tasks.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    return tasks;
  }
  // 任务领奖：只发礼物到 ww_gifts（🔴 ⛔ 不碰亲密度：不调 addBond / giveGift）
  function claimTask(task) {
    const t = task || {};
    const id = String(t.id || "");
    const tpl = DAILY_TEMPLATES.filter((x) => x.id === id)[0] || null;
    if (!id || !tpl) return { ok: false, reason: "no_task" };
    const day = todayKey();
    const d = ensureDaily(loadDaily());
    const actKey = String(t.actKey || actKeyOf(tpl, t.spiritId));
    if (!actDoneOf(d, tpl, t.spiritId)) { saveDaily(d); return { ok: false, reason: "undone" }; }   // 未完成不可领
    if (d.claimed[id]) { saveDaily(d); return { ok: false, reason: "claimed" }; } // ⛔ 不可重复领
    const giftKey = String(t.giftKey || rewardGiftOf(tpl, day));
    const firstClaimToday = Object.keys(d.claimed).length === 0;
    if (typeof Spirits !== "undefined" && Spirits && Spirits.loadGifts && Spirits.addGift && Spirits.saveGifts) {
      const gifts = Spirits.loadGifts();
      Spirits.addGift(gifts, giftKey, DAILY_CFG.REWARD_N);
      Spirits.saveGifts(gifts);
    }
    d.claimed[id] = day;
    if (firstClaimToday) d.days = Math.max(0, Math.floor(Number(d.days) || 0)) + 1; // 当日首次领奖记 1 天（⛔ 无惩罚）
    saveDaily(d);
    try { window.dispatchEvent(new CustomEvent("ww:daily-changed")); } catch (e) { /* 忽略 */ }
    return { ok: true, reason: "ok", actKey: actKey, giftKey: giftKey, giftName: giftNameSafe(giftKey), rewardN: DAILY_CFG.REWARD_N };
  }

  // 每日任务（对外入口，兼容旧签名；任务已固定为 5 条菩提根日常）
  function dailyTasks(items) { return buildDailyTasks(items); }

  /* ---------- 隐藏任务：不买挑战 ---------- */
  function noBuyChallenge(items) {
    const days = daysSinceLastBuy(items);
    const thresholds = [7, 30, 100];
    const reached = thresholds.filter((t) => days >= t);
    const next = thresholds.find((t) => days < t);
    return {
      days,
      reached,
      next,
      nextProgress: next ? Math.round((days / next) * 100) : 100,
      text: days === 0 ? "今天刚买过，挑战重新开始" : "已经 " + days + " 天没买新宝贝了",
    };
  }

  /* ---------- 抽卡系统：今日心选 3 串（按日期种子随机，当天固定、次日变化） ---------- */
  // 候选：只抽「菩提」分类（只有菩提需要盘包浆）
  // 放置阈值：已挂瓷（done）的串保养为主 → 超过 5 天没盘才再提醒；其余（待盘玩/盘玩中）> 2 天
  // 「佩戴中(wearing)」不参与：天天戴着的串不用提醒盘它（下面 okStatus 白名单里没有 wearing）
  const DRAW_CATS = ["菩提"];
  const IDLE_LIMIT_DONE = 5;    // 已挂瓷：超过 5 天没盘才提醒/可抽
  const IDLE_LIMIT_NORMAL = 2;  // 待盘玩/盘玩中：放置 > 2 天
  function idleLimitOf(item) {
    return (item && item.playStatus === "done") ? IDLE_LIMIT_DONE : IDLE_LIMIT_NORMAL;
  }
  function isDrawable(item, now) {
    if (!item || item.gifted) return false;
    const cat = item.category || "";
    // 只有菩提参与盘玩抽卡；拼图/周边/水晶/玉石等不参与
    if (!DRAW_CATS.includes(cat)) return false;
    if (item.playStatus === "unplayed" || item.playStatus === "") return false; // 未盘玩（暂时不想盘的）不抽
    // 待盘玩 / 盘玩中 / 已挂瓷 都可参与
    const okStatus = ["ready", "playing", "done"].includes(item.playStatus);
    if (!okStatus) return false;
    if (!item.lastPlayedAt) return true; // 从未盘过 → 可抽
    return Math.floor((now - item.lastPlayedAt) / 86400000) > idleLimitOf(item);
  }

  function drawRecommendation(items, count, salt) {
    count = count || 3;
    const now = Date.now();
    // 默认种子 = 年月日（当天固定、跨设备一致）；点"重抽"时传 salt 让结果变化
    const d = new Date(now);
    let seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    if (salt != null) seed = (seed ^ Math.floor(salt)); // 重抽：异或一个随机盐，保证与默认不同且可重复
    const pool = items.filter((i) => isDrawable(i, now));
    const picked = seededShuffle(pool, seed).slice(0, count);
    return {
      items: picked,
      poolSize: pool.length,
      date: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"),
    };
  }

  /* ---------- 盘玩计划：轻量提醒哪些串该盘了（温和建议，非打卡） ---------- */
  // 重点展示：待盘玩(ready) 一直提醒；盘玩中/已挂瓷 放置超过阈值（2 天 / 挂瓷 5 天）才提醒
  // 「佩戴中(wearing)」不参与：佩戴中的串天天在身上，不需要盘玩提醒
  // 按闲置时间排序（从未盘过最优先，然后闲置越久越靠前）；返回完整候选池，数量由调用方按档位取
  function playPlan(items) {
    const now = Date.now();
    const day = 86400000;
    const pool = items
      .filter((i) => i && !i.gifted && (i.category || "") === "菩提" &&
        (i.playStatus === "ready" || i.playStatus === "playing" || i.playStatus === "done"))
      .map((i) => {
        const last = i.lastPlayedAt;
        const idleDays = last ? Math.floor((now - last) / day) : null; // null = 从未盘过
        const arrived = Math.floor((now - (i.arrivedAt || i.createdAt || now)) / day);
        return { item: i, idleDays, arrived };
      })
      // 待盘玩一直提醒；已挂瓷始终保留（v163b：首页要能直接点「今日盘过」快捷入口）；其余按阈值
      .filter((x) => x.item.playStatus === "ready" || x.item.playStatus === "done" || x.idleDays == null || x.idleDays > idleLimitOf(x.item))
      .sort((a, b) => {
        const aDone = a.item.playStatus === "done" ? 1 : 0, bDone = b.item.playStatus === "done" ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;                  // 挂瓷排最后，不挤掉真正该盘的
        if (a.idleDays == null && b.idleDays != null) return -1;   // 从未盘过优先
        if (a.idleDays != null && b.idleDays == null) return 1;
        if (a.idleDays == null && b.idleDays == null) return b.arrived - a.arrived;
        return b.idleDays - a.idleDays;                             // 闲置越久越靠前
      });

    return {
      items: pool.map((x) => {
        const idle = x.idleDays;
        const isDone = x.item.playStatus === "done";   // 已挂瓷：回来是"保养提醒"
        let text;
        if (idle == null) text = "还没开始盘";
        else if (idle <= 0) text = "今天盘过啦";
        else if (isDone) text = "挂瓷 " + idle + " 天没盘";
        else if (idle <= 3) text = "刚盘 " + idle + " 天";
        else text = "已 " + idle + " 天没盘";
        return {
          item: x.item,
          idleDays: idle,
          text,
          urgent: idle == null || idle >= 7,   // 该引起注意
        };
      }),
      total: pool.length,
    };
  }

  /* ---------- 收集进度（每个盒子） ---------- */
  function boxProgress(items) {
    const cats = Categories ? Categories.getCategoryConfig("") : null;
    // 用分类配置里的选项作为目标
    const result = [];
    const catNames = (function () {
      // 从 DEFAULT_CATEGORIES 读（通过 app 的 getCategories 不可达，这里内置一份）
      return ["菩提", "水晶", "玉石", "拼图", "动漫周边", "盲盒", "其他"];
    })();
    catNames.forEach((c) => {
      const cfg = window.Categories.getCategoryConfig(c);
      const target = cfg.options.length || 1;
      const owned = items.filter((i) => (i.category || "") === c).length;
      result.push({
        cat: c,
        owned,
        target,
        progress: Math.min(100, Math.round((owned / target) * 100)),
      });
    });
    return result;
  }

  window.Game = { computeXp, getLevel, dailyTasks, noBuyChallenge, boxProgress, daysSinceLastBuy, drawRecommendation, isDrawable, playPlan, bestStreak, currentStreak, todayKey, normDays,
    // v165 每日任务改造（菩提根 5 条 + ww_daily 台账；领奖只发礼物）
    DAILY_CFG, DAILY_TEMPLATES, loadDaily, saveDaily, markDaily, claimTask, rewardGiftOf, buildDailyTasks,
    // v175：目标沁灵绑定 + 行为键（app.js 用 spiritPool/dailyTargets/actKeyOf 可自测）
    spiritPool, dailyTargets, actKeyOf, actDoneOf, fillDailyName };
})();
