/* =========================================================
 * stats.js — 统计与成就
 * 月历热力图 / 花费统计 / 最贵性价比 / 成就系统
 * ========================================================= */
(function () {
  "use strict";

  /* ---------- 月历热力图（GitHub 风格） ---------- */
  function renderCalendar(items, container) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // 统计本月每天入库数（按 arrivedAt 或 createdAt）
    const dayCount = {};
    items.forEach((it) => {
      const ts = it.arrivedAt || it.createdAt;
      if (!ts) return;
      const d = new Date(ts);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = d.getDate();
        dayCount[key] = (dayCount[key] || 0) + 1;
      }
    });

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay(); // 0=周日
    const max = Math.max(1, ...Object.values(dayCount));

    let html = '<div class="cal-head">' + year + " 年 " + (month + 1) + " 月 · 入库热力图</div>";
    html += '<div class="cal-grid">';
    // 周标签
    ["日", "一", "二", "三", "四", "五", "六"].forEach((w) => html += '<div class="cal-week">' + w + "</div>");
    // 空白格
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';
    // 日期格
    for (let d = 1; d <= daysInMonth; d++) {
      const n = dayCount[d] || 0;
      const level = n === 0 ? 0 : Math.min(4, 1 + Math.floor((n - 1) / Math.ceil(max / 3)));
      const tip = d + " 日入库 " + n + " 件";
      html += '<div class="cal-cell l' + level + '" title="' + tip + '">' +
        (n > 0 ? '<span class="cal-num">' + n + "</span>" : '<span class="cal-date">' + d + "</span>") +
        "</div>";
    }
    html += "</div>";
    html += '<div class="cal-legend"><span>少</span>' +
      [0,1,2,3,4].map((l) => '<span class="cal-cell l' + l + '" style="width:14px;height:14px;display:inline-block;border-radius:4px"></span>').join("") +
      "<span>多</span></div>";

    container.innerHTML = html;
  }

  /* ---------- 统计计算 ---------- */
  function computeStats(items) {
    const owned = items.filter((i) => !i.gifted);
    const totalSpent = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const activeSpent = owned.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const prices = items.map((i) => Number(i.price)).filter((p) => p > 0);
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const mostExpensive = maxPrice ? items.find((i) => Number(i.price) === maxPrice) : null;
    const cheapest = minPrice ? items.find((i) => Number(i.price) === minPrice) : null;

    // 性价比：按"陪伴天数/价格"计算（陪伴久+便宜 = 高性价比）
    const valueItems = items
      .map((i) => {
        const p = Number(i.price) || 0;
        const days = DB.daysWith(i);
        return { item: i, score: p > 0 ? days / p : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return {
      total: items.length,
      owned: owned.length,
      gifted: items.filter((i) => i.gifted).length,
      totalSpent,
      activeSpent,
      avgPrice: prices.length ? totalSpent / items.length : 0,
      maxPrice,
      mostExpensive,
      cheapest,
      bestValue: valueItems[0] ? valueItems[0].item : null,
      totalDays: items.reduce((s, i) => s + DB.daysWith(i), 0),
    };
  }

  /* ---------- 成就系统（分组递进 + 自动进阶称号） ---------- */
  // tier 成就：数值增长时自动进阶称号（如 囤囤新鼠→囤囤鼠→囤囤大仙→囤货龙王）
  // 固定成就：达到条件即解锁

  // 数值提取函数
  function nPuzzleDone(items) { return items.filter((i) => i.playStatus === "puzzle_done").length; }
  function nPuzzlePending(items) { return items.filter((i) => i.playStatus === "puzzle_pending").length; }
  function nSpecies(items, re) { return items.filter((i) => re.test((i.name || "") + (i.species || ""))).length; }
  function nPhotos(items) { return items.reduce((s, i) => s + (i.photos || []).length, 0); }
  function nCats(items) { return new Set(items.map((i) => i.category).filter(Boolean)).size; }
  function nGift(items, s) { return s.gifted; }
  function nTotal(items, s) { return s.total; }
  function nSpent(items, s) { return s.totalSpent; }

  const ACHIEVEMENT_GROUPS = [
    {
      id: "collect", title: "📦 收藏之道", icon: "📦", desc: "收藏之路的成长",
      items: [
        { id: "first", icon: "🌟", name: "入坑の瞬间", desc: "收藏第一件宝贝", check: (s) => s.total >= 1 },
        { id: "ten", icon: "🎒", name: "十方俱灭", desc: "收藏达到 10 件", check: (s) => s.total >= 10 },
        { id: "twenty", icon: "🗃️", name: "百宝箱之主", desc: "收藏达到 20 件", check: (s) => s.total >= 20 },
        { id: "fifty", icon: "🏰", name: "收藏界の王", desc: "收藏达到 50 件", check: (s) => s.total >= 50 },
        { id: "hundred", icon: "🌌", name: "万象归藏", desc: "收藏达到 100 件", check: (s) => s.total >= 100 },
        { id: "tier_total", icon: "♾️", name: "收藏の神", desc: "收藏数量持续攀升", tier: { getValue: nTotal, levels: [
          { min: 200, icon: "♾️", name: "收藏の神", desc: "收藏达到 200 件" },
          { min: 500, icon: "🔮", name: "万象之主", desc: "收藏达到 500 件" },
          { min: 1000, icon: "🌍", name: "收藏宇宙之主", desc: "收藏达到 1000 件" },
        ] } },
      ],
    },
    {
      id: "bead", title: "📿 菩提之道", icon: "📿", desc: "菩提类收藏的修行",
      items: [
        { id: "bead5", icon: "🌱", name: "菩提新芽", desc: "收藏 5 件菩提类宝贝", check: (s, items) => nSpecies(items, /菩提|金刚|凤眼|星月/) >= 5 },
        { id: "bead15", icon: "🌿", name: "菩提小成", desc: "收藏 15 件菩提类宝贝", check: (s, items) => nSpecies(items, /菩提|金刚|凤眼|星月/) >= 15 },
        { id: "bead50", icon: "🌳", name: "菩提老树", desc: "收藏 50 件菩提类宝贝", check: (s, items) => nSpecies(items, /菩提|金刚|凤眼|星月/) >= 50 },
        { id: "bead100", icon: "🧘", name: "菩提老祖", desc: "收藏 100 件菩提类宝贝", check: (s, items) => nSpecies(items, /菩提|金刚|凤眼|星月/) >= 100 },
        { id: "tier_bead", icon: "👴", name: "菩提祖师", desc: "菩提修为继续精进", tier: { getValue: (items, s) => nSpecies(items, /菩提|金刚|凤眼|星月/), levels: [
          { min: 300, icon: "👴", name: "菩提祖师", desc: "收藏 300 件菩提类宝贝" },
          { min: 500, icon: "🦖", name: "菩提始祖", desc: "收藏 500 件菩提类宝贝，开山立派" },
          { min: 1000, icon: "🌱🌱", name: "菩提之神", desc: "收藏 1000 件菩提类宝贝，人间菩提" },
        ] } },
      ],
    },
    {
      id: "puzzle", title: "🧩 拼图之道", icon: "🧩", desc: "拼图狂魔的进阶",
      items: [
        { id: "puzzle1", icon: "🧩", name: "拼图学徒", desc: "完成第 1 幅拼图", check: (s, items) => nPuzzleDone(items) >= 1 },
        { id: "puzzle5", icon: "🎯", name: "拼图达人", desc: "完成 5 幅拼图", check: (s, items) => nPuzzleDone(items) >= 5 },
        { id: "puzzle15", icon: "🎪", name: "拼图大师", desc: "完成 15 幅拼图", check: (s, items) => nPuzzleDone(items) >= 15 },
        { id: "puzzle50", icon: "🎡", name: "拼图高手", desc: "完成 50 幅拼图", check: (s, items) => nPuzzleDone(items) >= 50 },
        { id: "puzzle100", icon: "🧠", name: "拼图宗师", desc: "完成 100 幅拼图", check: (s, items) => nPuzzleDone(items) >= 100 },
        { id: "tier_puzzle", icon: "👑", name: "拼图の支配者", desc: "拼图之路无止境", tier: { getValue: nPuzzleDone, levels: [
          { min: 300, icon: "👑", name: "拼图の支配者", desc: "完成 300 幅拼图" },
          { min: 500, icon: "🧠✨", name: "拼图神王", desc: "完成 500 幅拼图，拼图宇宙之王" },
          { min: 1000, icon: "🌟", name: "拼图创世神", desc: "完成 1000 幅拼图，你就是拼图" },
        ] } },
      ],
    },
    {
      id: "spend", title: "💸 氪金之道", icon: "💸", desc: "钱包的悲欢离合",
      items: [
        { id: "spend1k", icon: "🪙", name: "氪金战士", desc: "累计消费超 1000 元", check: (s) => s.totalSpent >= 1000 },
        { id: "spend5k", icon: "💳", name: "钞能力觉醒", desc: "累计消费超 5000 元", check: (s) => s.totalSpent >= 5000 },
        { id: "spend10k", icon: "👑", name: "氪金の极意", desc: "累计消费超 10000 元", check: (s) => s.totalSpent >= 10000 },
        { id: "tier_spend", icon: "🏦", name: "金主爸爸", desc: "钱包的深度测试", tier: { getValue: nSpent, levels: [
          { min: 30000, icon: "🏦", name: "金主爸爸", desc: "累计消费超 30000 元" },
          { min: 100000, icon: "🏛️", name: "财神爷转世", desc: "累计消费超 100000 元" },
          { min: 500000, icon: "💰", name: "行走的银行", desc: "累计消费超 500000 元" },
        ] } },
        { id: "luxury", icon: "🏆", name: "传世の神器", desc: "拥有一件超 3000 元的宝贝", check: (s) => s.maxPrice >= 3000 },
      ],
    },
    {
      id: "share", title: "🎁 赠予之道", icon: "🎁", desc: "独乐乐不如众乐乐",
      items: [
        { id: "gift1", icon: "🎁", name: "慷慨之人", desc: "送出第 1 件宝贝", check: (s) => s.gifted >= 1 },
        { id: "gift5", icon: "🤝", name: "散财童子", desc: "送出 5 件宝贝", check: (s) => s.gifted >= 5 },
        { id: "tier_gift", icon: "🕊️", name: "送财菩萨", desc: "赠予的旅程", tier: { getValue: nGift, levels: [
          { min: 10, icon: "🕊️", name: "送财菩萨", desc: "送出 10 件宝贝" },
          { min: 50, icon: "🌠", name: "散财大仙", desc: "送出 50 件宝贝" },
          { min: 100, icon: "🌟", name: "无量功德", desc: "送出 100 件宝贝" },
        ] } },
      ],
    },
    {
      id: "nobuy", title: "🧘 不买之道", icon: "🧘", desc: "克制也是一种修行",
      items: [
        { id: "nobuy7", icon: "🧘", name: "心静如水", desc: "7 天不买挑战达成", check: (s, items) => Game.daysSinceLastBuy(items) >= 7 },
        { id: "nobuy30", icon: "🧎", name: "苦行僧", desc: "30 天不买挑战达成", check: (s, items) => Game.daysSinceLastBuy(items) >= 30 },
        { id: "nobuy100", icon: "🍃", name: "四大皆空", desc: "100 天不买挑战达成", check: (s, items) => Game.daysSinceLastBuy(items) >= 100 },
        { id: "tier_nobuy", icon: "🕉️", name: "佛系人生", desc: "克制的极致", tier: { getValue: (items, s) => Game.daysSinceLastBuy(items), levels: [
          { min: 365, icon: "🕉️", name: "佛系人生", desc: "365 天不买挑战" },
          { min: 1000, icon: "🌕", name: "心如止水", desc: "1000 天不买挑战" },
        ] } },
      ],
    },
    {
      id: "misc", title: "✨ 奇遇之道", icon: "✨", desc: "收藏路上的彩蛋",
      items: [
        { id: "cheap", icon: "🕵️", name: "捡漏王", desc: "拥有 200 元以下的宝贝", check: (s) => s.cheapest && Number(s.cheapest.price) <= 200 },
        { id: "value", icon: "🧮", name: "性价比之王", desc: "拥有超高性价比宝贝", check: (s) => !!s.bestValue },
        { id: "year", icon: "⏳", name: "岁月の见证", desc: "某件宝贝陪伴超 365 天", check: (s, items) => items.some((i) => DB.daysWith(i) >= 365) },
        { id: "tier_cat", icon: "🧰", name: "博爱收藏家", desc: "收藏盒子越多越好", tier: { getValue: nCats, levels: [
          { min: 3, icon: "🧰", name: "博爱收藏家", desc: "收藏覆盖 3 个收藏盒子" },
          { min: 6, icon: "🌌", name: "全领域制霸", desc: "收藏覆盖 6 个收藏盒子" },
          { min: 10, icon: "🪐", name: "多元宇宙之主", desc: "收藏覆盖 10 个收藏盒子" },
        ] } },
        { id: "tier_photo", icon: "📸", name: "记录の狂人", desc: "照片数量进阶", tier: { getValue: nPhotos, levels: [
          { min: 30, icon: "📸", name: "记录の狂人", desc: "累计拍摄 30 张照片" },
          { min: 100, icon: "🎞️", name: "影像大师", desc: "累计拍摄 100 张照片" },
          { min: 500, icon: "🏆", name: "光影收藏家", desc: "累计拍摄 500 张照片" },
        ] } },
        { id: "tier_hoard", icon: "📦", name: "囤货大佬", desc: "待拼拼图越多越快乐", tier: { getValue: nPuzzlePending, levels: [
          { min: 5, icon: "🐭", name: "囤囤新鼠", desc: "同时拥有 5 幅待拼拼图" },
          { min: 10, icon: "🐹", name: "囤囤鼠", desc: "同时拥有 10 幅待拼拼图" },
          { id2: "tier_hoard15", min: 15, icon: "🐿️", name: "囤囤大仙", desc: "同时拥有 15 幅待拼拼图" },
          { min: 30, icon: "🐲", name: "囤货龙王", desc: "同时拥有 30 幅待拼拼图" },
          { min: 50, icon: "🐉", name: "囤货之神", desc: "同时拥有 50 幅待拼拼图" },
        ] } },
      ],
    },
  ];

  // tier 成就计算：返回 { current: 当前称号, next: 下一级, progress: 进度 }
  function resolveTier(tierCfg, stats, items) {
    const value = tierCfg.getValue(items, stats);
    let current = null, next = null;
    for (const lv of tierCfg.levels) {
      if (value >= lv.min) current = lv;
      else { next = lv; break; }
    }
    let progress = 100;
    if (current && next) {
      progress = Math.min(100, Math.round(((value - current.min) / (next.min - current.min)) * 100));
    }
    return { value, current, next, progress, unlocked: !!current };
  }

  // 展开所有成就
  function getAchievements(items) {
    const stats = computeStats(items);
    return ACHIEVEMENT_GROUPS.map((g) => {
      const resolved = g.items.map((a) => {
        if (a.tier) {
          return { ...a, tierResolved: resolveTier(a.tier, stats, items), unlocked: !!resolveTier(a.tier, stats, items).current };
        }
        return { ...a, unlocked: a.check(stats, items) };
      });
      return { ...g, unlockedCount: resolved.filter((a) => a.unlocked).length, items: resolved };
    });
  }

  /* ---------- 有趣小统计 ---------- */
  function funFacts(items, stats) {
    const facts = [];
    // 最贵
    if (stats.mostExpensive) {
      facts.push({ icon: "🔥", text: "最贵的宝贝「" + (stats.mostExpensive.name || "未命名") + "」花了 ¥" + stats.mostExpensive.price });
    }
    // 最便宜
    if (stats.cheapest && stats.cheapest !== stats.mostExpensive) {
      facts.push({ icon: "🕵️", text: "最省的宝贝「" + (stats.cheapest.name || "未命名") + "」只要 ¥" + stats.cheapest.price });
    }
    // 性价比
    if (stats.bestValue) {
      const b = stats.bestValue;
      const days = DB.daysWith(b);
      facts.push({ icon: "🧮", text: "性价比之王「" + (b.name || "未命名") + "」¥" + (Number(b.price) || 0) + " 陪了你 " + days + " 天" });
    }
    // 陪伴最久
    const oldest = items.slice().sort((a, b) => DB.daysWith(b) - DB.daysWith(a))[0];
    if (oldest) {
      facts.push({ icon: "⏳", text: "陪伴最久的是「" + (oldest.name || "未命名") + "」共 " + DB.formatDays(DB.daysWith(oldest)) });
    }
    // 平均单价
    if (stats.total > 0) {
      facts.push({ icon: "💡", text: "平均每件花了 ¥" + Math.round(stats.totalSpent / stats.total) });
    }
    // 每日陪伴
    if (stats.totalDays > 0) {
      facts.push({ icon: "🤲", text: "它们累计陪你度过了 " + DB.formatDays(stats.totalDays) + " 的时光" });
    }
    return facts;
  }

  window.Stats = { renderCalendar, computeStats, getAchievements, funFacts, ACHIEVEMENT_GROUPS, resolveTier };
})();
