/* =========================================================
 * stats.js — 统计与成就
 * 月历热力图 / 花费统计 / 最贵性价比 / 成就系统
 * ========================================================= */
(function () {
  "use strict";

  /* ---------- 月历热力图（GitHub 风格，按月可翻） ---------- */
  // 记录最早数据月份（用于限制往前翻）
  function getEarliestMonth(items) {
    let earliest = Infinity;
    items.forEach((i) => {
      const ts = i.arrivedAt || i.createdAt;
      if (ts && ts < earliest) earliest = ts;
    });
    if (!isFinite(earliest)) { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; }
    const d = new Date(earliest);
    return { y: d.getFullYear(), m: d.getMonth() };
  }

  function renderCalendar(items, container, opts) {
    opts = opts || {};
    const now = new Date();
    // 当前显示的年月（默认当月；opts.year/month 可指定）
    const viewYear = opts.year != null ? opts.year : now.getFullYear();
    const viewMonth = opts.month != null ? opts.month : now.getMonth();
    const earliest = getEarliestMonth(items);
    const curKey = viewYear * 12 + viewMonth;
    const earliestKey = earliest.y * 12 + earliest.m;
    const nowKey = now.getFullYear() * 12 + now.getMonth();
    const canPrev = curKey > earliestKey;          // 可往前翻
    const canNext = curKey < nowKey;               // 可往后翻（不超当月）

    // 统计该月每天入库数
    const dayCount = {};
    items.forEach((it) => {
      const ts = it.arrivedAt || it.createdAt;
      if (!ts) return;
      const d = new Date(ts);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const key = d.getDate();
        dayCount[key] = (dayCount[key] || 0) + 1;
      }
    });

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const max = Math.max(1, ...Object.values(dayCount));

    let html = '<div class="cal-head-row">' +
      '<button class="cal-nav" data-move="-1"' + (canPrev ? "" : " disabled") + '>◀</button>' +
      '<div class="cal-head">' + viewYear + " 年 " + (viewMonth + 1) + " 月</div>" +
      '<button class="cal-nav" data-move="1"' + (canNext ? "" : " disabled") + '>▶</button>' +
      "</div>";

    html += '<div class="cal-week-row">';
    ["日", "一", "二", "三", "四", "五", "六"].forEach((w) => html += '<div class="cal-week">' + w + "</div>");
    html += "</div>";

    html += '<div class="cal-grid">';
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';
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

    // 翻月事件
    container.querySelectorAll(".cal-nav").forEach((b) => b.onclick = () => {
      if (b.disabled) return;
      const move = +b.dataset.move;
      const nk = curKey + move;
      const ny = Math.floor(nk / 12);
      const nm = nk % 12;
      // 调用回调更新
      if (opts.onChange) opts.onChange(ny, nm);
    });
  }

  /* ---------- 统计计算 ---------- */
  // 有效价格：>0 且 < 99999（99999 等视为占位/异常数据，不计入金额统计）
  function validPrice(i) {
    const p = Number(i.price);
    return isFinite(p) && p > 0 && p < 99999 ? p : 0;
  }
  function computeStats(items) {
    const owned = items.filter((i) => !i.gifted);
    const totalSpent = items.reduce((s, i) => s + validPrice(i), 0);
    const activeSpent = owned.reduce((s, i) => s + validPrice(i), 0);
    const prices = items.map(validPrice).filter((p) => p > 0);
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const mostExpensive = maxPrice ? items.find((i) => validPrice(i) === maxPrice) : null;
    const cheapest = minPrice ? items.find((i) => validPrice(i) === minPrice) : null;

    // 性价比：按"陪伴天数/价格"计算（陪伴久+便宜 = 高性价比）
    const valueItems = items
      .map((i) => {
        const p = validPrice(i);
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
      avgPrice: prices.length ? totalSpent / prices.length : 0,
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
        { id: "bead30", icon: "🌳", name: "菩提老树", desc: "收藏 30 件菩提类宝贝", check: (s, items) => nSpecies(items, /菩提|金刚|凤眼|星月/) >= 30 },
        { id: "bead50", icon: "🧘", name: "菩提老祖", desc: "收藏 50 件菩提类宝贝", check: (s, items) => nSpecies(items, /菩提|金刚|凤眼|星月/) >= 50 },
        { id: "tier_bead", icon: "👴", name: "菩提祖师", desc: "菩提修为继续精进", tier: { getValue: (items, s) => nSpecies(items, /菩提|金刚|凤眼|星月/), levels: [
          { min: 100, icon: "👴", name: "菩提祖师", desc: "收藏 100 件菩提类宝贝，道法自然" },
          { min: 300, icon: "🦖", name: "菩提始祖", desc: "收藏 300 件菩提类宝贝，开山立派" },
          { min: 1000, icon: "🌱🌱", name: "菩提之神", desc: "收藏 1000 件菩提类宝贝，人间菩提" },
        ] } },
      ],
    },
    {
      id: "puzzle", title: "🧩 拼图之道", icon: "🧩", desc: "拼图狂魔的进阶",
      items: [
        { id: "puzzle5", icon: "🧩", name: "拼图学徒", desc: "完成第 5 幅拼图", check: (s, items) => nPuzzleDone(items) >= 5 },
        { id: "puzzle20", icon: "🎯", name: "拼图达人", desc: "完成 20 幅拼图", check: (s, items) => nPuzzleDone(items) >= 20 },
        { id: "puzzle50", icon: "🎪", name: "拼图大师", desc: "完成 50 幅拼图", check: (s, items) => nPuzzleDone(items) >= 50 },
        { id: "tier_puzzle", icon: "👑", name: "拼图の支配者", desc: "拼图之路无止境", tier: { getValue: nPuzzleDone, levels: [
          { min: 100, icon: "👑", name: "拼图の支配者", desc: "完成 100 幅拼图，拼图界至尊" },
          { min: 300, icon: "🧠✨", name: "拼图神王", desc: "完成 300 幅拼图，拼图宇宙之王" },
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
        { id: "tier_nobuy", icon: "🍃", name: "四大皆空", desc: "克制的进阶", tier: { getValue: (items, s) => Game.daysSinceLastBuy(items), levels: [
          { min: 50, icon: "🍃", name: "四大皆空", desc: "50 天不买挑战" },
          { min: 100, icon: "🕉️", name: "佛系人生", desc: "100 天不买挑战" },
          { min: 365, icon: "🌕", name: "心如止水", desc: "365 天不买挑战" },
          { min: 1000, icon: "🌟", name: "无欲无求", desc: "1000 天不买挑战" },
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

  /* ---------- 收藏分布（颜色 / 分类 / 状态 / 价格区间） ---------- */
  function distributions(items) {
    const total = items.length || 1;

    // —— 颜色分布 ——
    const colorCount = {};
    items.forEach((i) => {
      const c = window.Color ? window.Color.normColor(i.color) : i.color;
      const key = c || "__none";
      colorCount[key] = (colorCount[key] || 0) + 1;
    });
    const colorDist = Object.entries(colorCount).map(([key, count]) => {
      const pct = Math.round((count / total) * 100);
      if (key === "__none") return { label: "未分色", count, pct, hex: "#9e9e9e", empty: true };
      const hex = window.Color ? window.Color.colorHex(key) : "#9e9e9e";
      const label = window.Color ? window.Color.colorLabel(key) : key;
      return { label, count, pct, hex };
    }).sort((a, b) => b.count - a.count);

    // —— 分类（收藏盒子）分布 ——
    const catCount = {};
    items.forEach((i) => {
      const key = i.category || "__none";
      catCount[key] = (catCount[key] || 0) + 1;
    });
    const catDist = Object.entries(catCount).map(([key, count]) => ({
      label: key === "__none" ? "未分类" : key,
      count,
      pct: Math.round((count / total) * 100),
    })).sort((a, b) => b.count - a.count);

    // —— 状态分布（盘玩 4 态 + 拼图 2 态 + 在库/已送人） ——
    const st = { unplayed: 0, ready: 0, playing: 0, done: 0, puzzle_pending: 0, puzzle_done: 0, gifted: 0, plain: 0 };
    items.forEach((i) => {
      if (i.gifted) { st.gifted++; return; }
      const cat = i.category || "";
      const isPuzzle = window.Categories && window.Categories.isPuzzleCategory(cat);
      if (isPuzzle) {
        if (i.playStatus === "puzzle_done") st.puzzle_done++; else st.puzzle_pending++;
        return;
      }
      // 无盘玩状态分类（水晶/玉石/周边/盲盒/其他等）
      const noPlay = !isBeadLike(cat);
      if (noPlay) { st.plain++; return; }
      const s = i.playStatus || "unplayed";
      if (st[s] != null) st[s]++; else st.unplayed++;
    });
    const statusLabels = [
      { key: "playing", label: "盘玩中", color: "#2e7d32" },
      { key: "ready", label: "待盘玩", color: "#ef6c00" },
      { key: "done", label: "已盘好", color: "#6a1b9a" },
      { key: "unplayed", label: "未盘玩", color: "#78909c" },
      { key: "puzzle_pending", label: "待拼", color: "#d98ba6" },
      { key: "puzzle_done", label: "已拼", color: "#2e7d32" },
      { key: "plain", label: "常规在库", color: "#8d6e63" },
      { key: "gifted", label: "已送人", color: "#b0bec5" },
    ];
    const statusDist = statusLabels
      .filter((s) => st[s.key] > 0)
      .map((s) => ({ label: s.label, count: st[s.key], pct: Math.round((st[s.key] / total) * 100), color: s.color }));

    // —— 价格分布：已按用户要求移除（用户收藏多为 100 以下，价格分布无区分度） ——

    return { colors: colorDist, cats: catDist, statuses: statusDist, total: items.length };
  }

  // 菩提类（有盘玩状态）判定：目前仅"菩提"分类
  function isBeadLike(cat) {
    return ["菩提"].includes(cat);
  }

  // 金额显示：保留 1 位小数（整数则不带小数）
  function fmtMoney(n) {
    const v = Number(n);
    if (!isFinite(v)) return "0";
    const r = Math.round(v * 10) / 10;
    if (r <= 0) return "0";
    // 整数不带小数；否则保留 1 位
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  /* ---------- 有趣小统计 ---------- */
  function funFacts(items, stats) {
    const facts = [];
    // 最贵
    if (stats.mostExpensive) {
      facts.push({ icon: "🔥", text: "最贵的宝贝「" + (stats.mostExpensive.name || "未命名") + "」花了 ¥" + fmtMoney(stats.mostExpensive.price) });
    }
    // 最便宜
    if (stats.cheapest && stats.cheapest !== stats.mostExpensive) {
      facts.push({ icon: "🕵️", text: "最省的宝贝「" + (stats.cheapest.name || "未命名") + "」只要 ¥" + fmtMoney(stats.cheapest.price) });
    }
    // 性价比
    if (stats.bestValue) {
      const b = stats.bestValue;
      const days = DB.daysWith(b);
      facts.push({ icon: "🧮", text: "性价比之王「" + (b.name || "未命名") + "」¥" + fmtMoney(b.price) + " 陪了你 " + days + " 天" });
    }
    // 陪伴最久
    const oldest = items.slice().sort((a, b) => DB.daysWith(b) - DB.daysWith(a))[0];
    if (oldest) {
      facts.push({ icon: "⏳", text: "陪伴最久的是「" + (oldest.name || "未命名") + "」共 " + DB.formatDays(DB.daysWith(oldest)) });
    }
    // 平均单价
    if (stats.total > 0 && stats.totalSpent > 0) {
      facts.push({ icon: "💡", text: "平均每件花了 ¥" + fmtMoney(stats.avgPrice) });
    }
    // 最常收藏的品种/品牌
    const speciesCount = {};
    items.forEach((i) => {
      const key = i.species || i.accessoryType || i.category || "未分类";
      speciesCount[key] = (speciesCount[key] || 0) + 1;
    });
    const topSpecies = Object.entries(speciesCount).sort((a, b) => b[1] - a[1])[0];
    if (topSpecies && topSpecies[0] !== "未分类") {
      facts.push({ icon: "🏆", text: "最宠爱的品种是「" + topSpecies[0] + "」，收了 " + topSpecies[1] + " 件" });
    }
    // 在库率
    if (stats.total > 0) {
      const inStockRate = Math.round((stats.owned / stats.total) * 100);
      facts.push({ icon: "🏠", text: "在库率 " + inStockRate + "%（" + stats.owned + "/" + stats.total + " 件还在身边）" });
    }
    // 已送出的宝贝
    if (stats.gifted > 0) {
      facts.push({ icon: "🎁", text: "送出了 " + stats.gifted + " 件宝贝，把快乐分享给了别人" });
    }
    // 最受宠爱（5 星最多/星级最高的宝贝）
    const loved = items
      .filter((i) => (Number(i.star) || 0) >= 5)
      .sort((a, b) => (Number(b.star) - Number(a.star)));
    if (loved.length) {
      const l = loved[0];
      facts.push({ icon: "💖", text: "最受宠爱的是「" + (l.name || "未命名") + "」⭐⭐⭐⭐⭐，打满了 5 星" });
    } else if (items.length) {
      const anyStar = items.filter((i) => (Number(i.star) || 0) > 0);
      if (anyStar.length) {
        const top = anyStar.sort((a, b) => (Number(b.star) - Number(a.star)))[0];
        facts.push({ icon: "💖", text: "目前评分最高的是「" + (top.name || "未命名") + "」" + (Number(top.star) || 0) + " 星，打到 5 星会进展柜哦" });
      }
    }
    // 盘玩最多（菩提：playCount 最高）
    const played = items.filter((i) => (Number(i.playCount) || 0) > 0).sort((a, b) => (Number(b.playCount) || 0) - (Number(a.playCount) || 0));
    if (played.length) {
      const p = played[0];
      facts.push({ icon: "🤲", text: "盘得最多的是「" + (p.name || "未命名") + "」已盘 " + (Number(p.playCount) || 0) + " 次，真·盘串狂魔" });
    }
    // 摆烂最多（菩提：待盘/未盘但陪伴很久）
    const idle = items.filter((i) => i.category === "菩提" && !i.gifted && (i.playStatus === "ready" || !i.playStatus))
      .sort((a, b) => DB.daysWith(b) - DB.daysWith(a))[0];
    if (idle && DB.daysWith(idle) >= 30) {
      facts.push({ icon: "😪", text: "「" + (idle.name || "未命名") + "」陪了你 " + DB.formatDays(DB.daysWith(idle)) + " 却还没盘，是时候上手了" });
    }
    // 花费占比（最贵的占累计比例）
    if (stats.totalSpent > 0 && stats.mostExpensive) {
      const pct = Math.round((Number(stats.mostExpensive.price) / stats.totalSpent) * 100);
      if (pct >= 30) {
        facts.push({ icon: "👑", text: "「" + (stats.mostExpensive.name || "未命名") + "」就占了总花费的 " + pct + "%，是真爱" });
      }
    }
    // 壕无人性：单月入库最多
    const monthCol = {};
    items.forEach((i) => {
      const ts = i.arrivedAt || i.createdAt;
      if (!ts) return;
      const d = new Date(ts);
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      monthCol[key] = (monthCol[key] || 0) + 1;
    });
    const topMonth = Object.entries(monthCol).sort((a, b) => b[1] - a[1])[0];
    if (topMonth && topMonth[1] >= 3) {
      const [ym, n] = topMonth;
      const [py, pm] = ym.split("-");
      facts.push({ icon: "💸", text: "你在 " + py + " 年 " + (+pm) + " 月一口入了 " + n + " 件宝贝，壕无人性" });
    }
    // 手都冒烟了：单月盘玩最多（按 lastPlayedAt 月份）
    const monthPlay = {};
    items.forEach((i) => {
      const ts = i.lastPlayedAt;
      if (!ts) return;
      const d = new Date(ts);
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      monthPlay[key] = (monthPlay[key] || 0) + 1;
    });
    const topPlay = Object.entries(monthPlay).sort((a, b) => b[1] - a[1])[0];
    if (topPlay && topPlay[1] >= 2) {
      const [ym, n] = topPlay;
      const [py, pm] = ym.split("-");
      facts.push({ icon: "🔥", text: "你在 " + py + " 年 " + (+pm) + " 月盘了 " + n + " 条串，手都冒烟了" });
    }
    // 天道酬勤：某件已盘好的菩提，从入库到现在陪伴了多少天（盘完它花了多少天）
    const doneItems = items.filter((i) => (i.category === "菩提" && i.playStatus === "done") || i.playStatus === "puzzle_done");
    if (doneItems.length) {
      const d = doneItems.sort((a, b) => DB.daysWith(b) - DB.daysWith(a))[0];
      const days = DB.daysWith(d);
      if (days >= 1) {
        facts.push({ icon: "🌾", text: "你把「" + (d.name || "未命名") + "」盘完花了 " + DB.formatDays(days) + "，天道酬勤" });
      }
    }
    // 五杀进货：分类收藏最多（某个盒子收得最多）
    const catCount = {};
    items.forEach((i) => {
      const c = i.category || "未分类";
      catCount[c] = (catCount[c] || 0) + 1;
    });
    const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
    if (topCat && topCat[1] >= 3 && topCat[0] !== "未分类") {
      facts.push({ icon: "🗃️", text: "「" + topCat[0] + "」盒子已经塞了 " + topCat[1] + " 件，快满了" });
    }
    // 连续进货天（最近一次入库到现在多少天没买）
    const noBuy = window.Game && window.Game.daysSinceLastBuy ? window.Game.daysSinceLastBuy(items) : 0;
    if (noBuy >= 7) {
      facts.push({ icon: "🧘", text: "已经 " + noBuy + " 天没买新宝贝了，手收得真稳" });
    }
    return facts;
  }

  window.Stats = { renderCalendar, computeStats, getAchievements, funFacts, distributions, fmtMoney, ACHIEVEMENT_GROUPS, resolveTier };
})();
