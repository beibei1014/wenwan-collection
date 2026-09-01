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
    const puzzles = [1, 5, 10];
    const puzzleXp = [100, 300, 600];
    puzzles.forEach((c, i) => {
      if (puzzleDone >= c) { xp += puzzleXp[i]; milestones.push({ icon: "🧩", name: "完成 " + c + " 幅拼图", xp: puzzleXp[i] }); }
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
    const noBuys = [7, 30, 100];
    const noBuyXp = [100, 500, 2000];
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

  /* ---------- 每日任务（地球Online风，自动检测） ---------- */
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

    return [
      { icon: "📦", title: "今日新收", desc: "收藏一件新宝贝", done: todayNew > 0, progress: Math.min(todayNew, 1), target: 1, xp: 15 },
      { icon: "✏️", title: "今日打理", desc: "编辑整理一件宝贝", done: todayEdited > 0, progress: Math.min(todayEdited, 1), target: 1, xp: 10 },
      { icon: "🧩", title: "今日拼图", desc: "完成一幅拼图", done: todayFinished > 0, progress: Math.min(todayFinished, 1), target: 1, xp: 30 },
    ];
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

  window.Game = { computeXp, getLevel, dailyTasks, noBuyChallenge, boxProgress, daysSinceLastBuy };
})();
