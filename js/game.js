/* =========================================================
 * game.js — 游戏化系统（地球Online风）
 * 全部数据从收藏记录推导，无需打卡、无需存状态，跨设备一致
 * 经验 / 等级称号 / 每日任务 / 不买挑战 / 收集进度
 * ========================================================= */
(function () {
  "use strict";

  /* ---------- 经验里程碑（达到即得经验，幂等可重复计算） ---------- */
  function computeXp(items) {
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

    // 盘玩
    const plays = [1, 5];
    const playXp = [50, 200];
    plays.forEach((c, i) => {
      if (playedCount >= c) { xp += playXp[i]; milestones.push({ icon: "🤲", name: c + " 条正在盘玩", xp: playXp[i] }); }
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

    return { xp, milestones, stats, noBuyDays, puzzleDone, playedCount, catCount, photoCount, totalDays };
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

  function dailyTasks(items) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 86400000;

    const todayNew = items.filter((i) => {
      const ts = i.createdAt;
      return ts && ts >= todayStart && ts < todayEnd;
    }).length;
    const todayEdited = items.filter((i) => {
      const ts = i.updatedAt;
      return ts && ts >= todayStart && ts < todayEnd;
    }).length;
    const todayFinished = items.filter((i) => {
      const ts = i.finishedAt;
      return ts && ts >= todayStart && ts < todayEnd;
    }).length;
    const todayGifted = items.filter((i) => {
      const ts = i.giftedAt;
      return ts && ts >= todayStart && ts < todayEnd;
    }).length;

    // 全局统计（用于各种达成型任务）
    const withPhotos = items.filter((i) => (i.photos || []).length > 0).length;
    const withPrice = items.filter((i) => i.price != null && i.price !== "").length;
    const withShop = items.filter((i) => i.shop && i.shop.trim()).length;
    const withNote = items.filter((i) => i.note && i.note.trim()).length;
    const playing = items.filter((i) => i.playStatus === "playing").length;
    const puzzleDone = items.filter((i) => i.playStatus === "puzzle_done").length;
    const catCount = new Set(items.map((i) => i.category).filter(Boolean)).size;
    const beadCount = items.filter((i) => /菩提|金刚|凤眼|星月/.test((i.name || "") + (i.species || ""))).length;
    const crystal = items.filter((i) => (i.category || "") === "水晶").length;
    const accessories = items.filter((i) => (i.category || "") === "动漫周边").length;
    const longCompanion = items.some((i) => DB.daysWith(i) >= 30);
    const noBuyToday = todayNew === 0; // 今天没有入手新宝贝

    // 任务池：当日型（每天随机挑 2 个）+ 达成型（每天随机挑 2 个）
    const todayPool = [
      { icon: "📦", title: "今日新收", desc: "收藏一件新宝贝", done: todayNew > 0, target: 1, xp: 15 },
      { icon: "✏️", title: "今日打理", desc: "编辑整理一件宝贝", done: todayEdited > 0, target: 1, xp: 10 },
      { icon: "🧩", title: "今日拼图", desc: "完成一幅拼图", done: todayFinished > 0, target: 1, xp: 30 },
      { icon: "🎁", title: "今日送出", desc: "送出一件宝贝", done: todayGifted > 0, target: 1, xp: 20 },
      { icon: "🧘", title: "今日清心", desc: "今天没有入手新宝贝", done: noBuyToday, target: 1, xp: 10 },
    ];
    const achievePool = [
      { icon: "🤲", title: "盘玩进行时", desc: "有宝贝处于「在盘玩」状态", done: playing > 0, target: 1, xp: 15 },
      { icon: "🧩", title: "拼图小成", desc: "累计完成一幅拼图", done: puzzleDone > 0, target: 1, xp: 20 },
      { icon: "📸", title: "拍照留念", desc: "给宝贝拍过照片", done: withPhotos > 0, target: 1, xp: 10 },
      { icon: "💰", title: "记录价值", desc: "为宝贝记录过价格", done: withPrice > 0, target: 1, xp: 10 },
      { icon: "🏪", title: "店铺记忆", desc: "记录过购买店铺", done: withShop > 0, target: 1, xp: 10 },
      { icon: "📝", title: "备注大师", desc: "给宝贝写过备注", done: withNote > 0, target: 1, xp: 10 },
      { icon: "🗃️", title: "盒子多多", desc: "覆盖 2 个收藏盒子", done: catCount >= 2, target: 1, xp: 15 },
      { icon: "📿", title: "菩提有缘", desc: "收藏 3 件菩提类宝贝", done: beadCount >= 3, target: 1, xp: 20 },
      { icon: "🔮", title: "水晶之约", desc: "收藏一件水晶宝贝", done: crystal > 0, target: 1, xp: 15 },
      { icon: "🎨", title: "周边收藏", desc: "收藏一件动漫周边", done: accessories > 0, target: 1, xp: 15 },
      { icon: "⏰", title: "长久陪伴", desc: "有宝贝陪伴超 30 天", done: longCompanion, target: 1, xp: 20 },
    ];

    // 种子 = 年月日（如 20260903），保证当天固定、次日变化
    const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const pickedToday = seededShuffle(todayPool, seed).slice(0, 2);
    const pickedAchieve = seededShuffle(achievePool, seed + 7919).slice(0, 2);

    const tasks = pickedToday.concat(pickedAchieve);
    // 保持展示顺序稳定：未完成的在前、已完成的在后
    tasks.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    tasks.forEach((t) => { t.progress = t.done ? 1 : 0; });
    return tasks;
  }

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
  // 候选：珠子类（非拼图/非周边/非送人）
  // - ready(待盘玩)/playing(盘玩中)/done(已盘好包浆)：随时可抽（done 不受上次盘玩时间限制）
  // - resting(放置中)：需距上次盘玩 > 1 天（放够回油才重新进池）
  function isDrawable(item, now) {
    if (!item || item.gifted) return false;
    const cat = item.category || "";
    // 拼图/周边/盲盒不参与盘玩抽卡
    if (Categories.isPuzzleCategory(cat) || Categories.isBrandCategory(cat)) return false;
    if (item.playStatus === "unplayed" || item.playStatus === "") return false; // 未盘玩（暂时不想盘的）不抽
    if (item.playStatus === "done") return true; // 已盘好包浆：随时能拿出来盘，始终可抽
    const okStatus = ["ready", "playing", "resting"].includes(item.playStatus);
    if (!okStatus) return false;
    // ready/playing 从没盘过可抽；resting 需距上次盘玩 > 1 天
    if (item.playStatus === "resting") {
      if (!item.lastPlayedAt) return true;
      return Math.floor((now - item.lastPlayedAt) / 86400000) >= 1;
    }
    // ready / playing
    return true;
  }

  function drawRecommendation(items, count) {
    count = count || 3;
    const now = Date.now();
    // 种子 = 年月日（当天固定、次日变化）
    const d = new Date(now);
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const pool = items.filter((i) => isDrawable(i, now));
    const picked = seededShuffle(pool, seed).slice(0, count);
    return {
      items: picked,
      poolSize: pool.length,
      date: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"),
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

  window.Game = { computeXp, getLevel, dailyTasks, noBuyChallenge, boxProgress, daysSinceLastBuy, drawRecommendation, isDrawable };
})();
