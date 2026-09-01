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

  /* ---------- 成就系统（中二感） ---------- */
  const ACHIEVEMENTS = [
    { id: "first", icon: "🌟", name: "入坑の瞬间", desc: "收藏第一件宝贝", check: (s) => s.total >= 1 },
    { id: "ten", icon: "🎒", name: "十方俱灭", desc: "收藏达到 10 件", check: (s) => s.total >= 10 },
    { id: "twenty", icon: "🗃️", name: "百宝箱之主", desc: "收藏达到 20 件", check: (s) => s.total >= 20 },
    { id: "fifty", icon: "🏰", name: "收藏界の王", desc: "收藏达到 50 件", check: (s) => s.total >= 50 },
    { id: "spend1k", icon: "💸", name: "氪金战士", desc: "累计消费超 1000 元", check: (s) => s.totalSpent >= 1000 },
    { id: "spend5k", icon: "👑", name: "钞能力觉醒", desc: "累计消费超 5000 元", check: (s) => s.totalSpent >= 5000 },
    { id: "spend10k", icon: "💎", name: "氪金の极意", desc: "累计消费超 10000 元", check: (s) => s.totalSpent >= 10000 },
    { id: "expensive", icon: "🔥", name: "镇馆之宝", desc: "拥有一件超 1000 元的宝贝", check: (s) => s.maxPrice >= 1000 },
    { id: "luxury", icon: "🏆", name: "传世の神器", desc: "拥有一件超 3000 元的宝贝", check: (s) => s.maxPrice >= 3000 },
    { id: "cheap", icon: "🕵️", name: "捡漏王", desc: "拥有 200 元以下的宝贝", check: (s) => s.minPrice > 0 && s.minPrice <= 200 },
    { id: "value", icon: "🧮", name: "性价比之王", desc: "拥有超高性价比宝贝", check: (s) => !!s.bestValue },
    { id: "puzzle1", icon: "🧩", name: "拼图学徒", desc: "完成第 1 幅拼图", check: (s, items) => items.filter((i) => i.playStatus === "puzzle_done").length >= 1 },
    { id: "puzzle5", icon: "🎯", name: "拼图达人", desc: "完成 5 幅拼图", check: (s, items) => items.filter((i) => i.playStatus === "puzzle_done").length >= 5 },
    { id: "puzzle10", icon: "🧠", name: "拼图の支配者", desc: "完成 10 幅拼图", check: (s, items) => items.filter((i) => i.playStatus === "puzzle_done").length >= 10 },
    { id: "puzzlePending", icon: "📦", name: "囤货大佬", desc: "同时拥有 5 幅待拼拼图", check: (s, items) => items.filter((i) => i.playStatus === "puzzle_pending").length >= 5 },
    { id: "gift1", icon: "🎁", name: "慷慨之人", desc: "送出第 1 件宝贝", check: (s) => s.gifted >= 1 },
    { id: "gift5", icon: "🤝", name: "散财童子", desc: "送出 5 件宝贝", check: (s) => s.gifted >= 5 },
    { id: "year", icon: "⏳", name: "岁月の见证", desc: "某件宝贝陪伴超 365 天", check: (s, items) => items.some((i) => DB.daysWith(i) >= 365) },
    { id: "cat3", icon: "🧰", name: "博爱收藏家", desc: "收藏覆盖 3 个收藏盒子", check: (s, items) => new Set(items.map((i) => i.category).filter(Boolean)).size >= 3 },
    { id: "cat6", icon: "🌌", name: "全领域制霸", desc: "收藏覆盖 6 个收藏盒子", check: (s, items) => new Set(items.map((i) => i.category).filter(Boolean)).size >= 6 },
    { id: "photo", icon: "📸", name: "记录の狂人", desc: "某件宝贝有 3 张以上照片", check: (s, items) => items.some((i) => (i.photos || []).length >= 3) },
  ];

  function getAchievements(items) {
    const stats = computeStats(items);
    return ACHIEVEMENTS.map((a) => ({
      ...a,
      unlocked: a.check(stats, items),
    }));
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

  window.Stats = { renderCalendar, computeStats, getAchievements, funFacts };
})();
