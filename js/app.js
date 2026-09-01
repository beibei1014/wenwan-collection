/* =========================================================
 * app.js — 主应用：认证 + hash 路由 + 页面渲染
 * 视图：#/ 首页收藏柜 | #/item/:id 详情 | #/new 新建
 *        #/edit/:id 编辑 | #/settings 设置 | #/auth 登录
 * ========================================================= */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const view = $("#view");
  const topbarTitle = $("#topbarTitle");
  const btnBack = $("#btnBack");
  const btnSettings = $("#btnSettings");

  let allItems = [];
  let filter = "all";        // all | instock | gifted | played
  let categoryFilter = "";   // 收藏盒子筛选
  let search = "";
  let viewMode = localStorage.getItem("ww_viewmode") || "card"; // card | list
  let sortMode = "newest"; // newest(入库降序) | oldest(入库升序)
  let user = null;           // 当前登录用户

  /* ---------- 工具 ---------- */
  const _urlCache = new Map();
  function photoUrl(photo) {
    if (!photo) return null;
    if (photo.url) return photo.url;                  // 云端图片
    if (photo.data && photo._url) return photo._url;  // 本地 Blob
    if (photo.data) { photo._url = URL.createObjectURL(photo.data); return photo._url; }
    return null;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function fmtDateInput(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function toast(msg) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function confirmModal(title, desc, okText, danger) {
    return new Promise((resolve) => {
      const mask = $("#modalMask");
      const modal = $("#modal");
      modal.innerHTML =
        "<h3>" + esc(title) + "</h3>" +
        (desc ? "<p style='text-align:center;color:#8a7a68;font-size:14px;margin-bottom:14px;line-height:1.7'>" + esc(desc) + "</p>" : "") +
        "<div style='display:flex;gap:10px'>" +
        "<button class='btn ghost' id='mCancel'>取消</button>" +
        "<button class='btn " + (danger ? "danger" : "primary") + "' id='mOk'>" + esc(okText) + "</button></div>";
      mask.hidden = false;
      modal.hidden = false;
      const done = (v) => { mask.hidden = true; modal.hidden = true; resolve(v); };
      $("#mCancel").onclick = () => done(false);
      $("#mOk").onclick = () => done(true);
      mask.onclick = () => done(false);
    });
  }

  /* ---------- 养护小知识弹层 ---------- */
  function showTipsModal(item) {
    const tips = Tips.getTips(item.species, item.craft);
    const mask = $("#modalMask");
    const modal = $("#modal");

    let html = "<h3>📖 养护小知识</h3>";
    if (tips.matched) {
      html += "<p style='text-align:center;font-size:13px;color:var(--gold);margin-bottom:12px'>针对「" + esc(tips.matchedKey) + "」的专属科普</p>";
    } else {
      html += "<p style='text-align:center;font-size:13px;color:var(--text-2);margin-bottom:12px'>通用文玩科普（填了品种会有专属内容哦）</p>";
    }

    const sections = [
      { key: "care", icon: "🧴", title: "日常保养" },
      { key: "taboo", icon: "🚫", title: "佩戴禁忌" },
      { key: "play", icon: "🤲", title: "盘玩技巧" },
      { key: "trivia", icon: "💡", title: "冷知识" },
    ];
    sections.forEach((s, i) => {
      const list = tips[s.key] || [];
      html += '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden">' +
        '<button type="button" data-sec="' + s.key + '" style="width:100%;padding:12px 14px;display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:var(--wood);background:none;border:none;text-align:left">' +
        '<span>' + s.icon + "</span><span>" + s.title + "</span><span style='margin-left:auto;color:var(--text-2);font-size:12px'>" + list.length + " 条</span>" +
        '<span style="margin-left:4px;color:var(--gold);transition:transform .2s" data-arrow="' + s.key + '">▾</span></button>' +
        '<div data-body="' + s.key + '" style="display:none;padding:0 14px 14px">' +
        list.map((t) => '<div style="font-size:14px;color:var(--text);line-height:1.7;padding:6px 0;border-top:1px dashed var(--line)">' + esc(t) + "</div>").join("") +
        "</div></div>";
    });

    html += '<button class="btn primary" id="mCloseTips" style="width:100%">知道了</button>';

    modal.innerHTML = html;
    mask.hidden = false;
    modal.hidden = false;

    modal.querySelectorAll("[data-sec]").forEach((b) => b.onclick = () => {
      const key = b.dataset.sec;
      const body = modal.querySelector('[data-body="' + key + '"]');
      const arrow = modal.querySelector('[data-arrow="' + key + '"]');
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      arrow.style.transform = open ? "" : "rotate(180deg)";
    });
    $("#mCloseTips").onclick = () => { mask.hidden = true; modal.hidden = true; };
    mask.onclick = () => { mask.hidden = true; modal.hidden = true; };
  }

  /* ---------- 分类页 ---------- */
  function renderCatPage() {
    topbarTitle.textContent = "我的收藏盒子";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    // 统计每个分类的数量
    const cats = getCategories();
    const countBy = {};
    allItems.forEach((i) => {
      const c = i.category || "未分类";
      countBy[c] = (countBy[c] || 0) + 1;
    });
    const uncat = allItems.filter((i) => !i.category).length;

    // 盒子图标与配色
    function boxMeta(c) {
      const map = {
        "菩提": { icon: "📿", grad: "linear-gradient(135deg,#8d6e4a,#a98b63)" },
        "水晶": { icon: "💎", grad: "linear-gradient(135deg,#7ba7d9,#a8c8ec)" },
        "玉石": { icon: "🪨", grad: "linear-gradient(135deg,#5d9b7a,#86b89c)" },
        "拼图": { icon: "🧩", grad: "linear-gradient(135deg,#d98ba6,#e8b0c4)" },
        "动漫周边": { icon: "🏅", grad: "linear-gradient(135deg,#c9a227,#e0c25e)" },
        "盲盒": { icon: "🎁", grad: "linear-gradient(135deg,#b06bd9,#cf97ec)" },
        "其他": { icon: "🗂", grad: "linear-gradient(135deg,#8a7a68,#a89880)" }
      };
      return map[c] || { icon: "🗂", grad: "linear-gradient(135deg,#8a7a68,#a89880)" };
    }

    let html = "";
    html += '<div class="section-title">我的收藏盒子</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';

    // 全部
    const allMeta = boxMeta("其他");
    html += '<button class="cat-card" data-cat="" style="border:none;border-radius:16px;background:' + allMeta.grad + ';padding:18px 16px;text-align:left;color:#fff;box-shadow:var(--shadow)">' +
      '<div style="font-size:26px">' + allMeta.icon + "</div>" +
      '<div style="font-size:16px;font-weight:700;margin-top:8px;color:#fff">全部宝贝</div>' +
      '<div style="font-size:12px;opacity:.85;margin-top:3px">' + allItems.length + " 件收藏</div></button>";

    // 每个分类
    cats.forEach((c) => {
      const n = countBy[c] || 0;
      const meta = boxMeta(c);
      html += '<button class="cat-card" data-cat="' + esc(c) + '" style="border:none;border-radius:16px;background:' + meta.grad + ';padding:18px 16px;text-align:left;color:#fff;box-shadow:var(--shadow)">' +
        '<div style="font-size:26px">' + meta.icon + "</div>" +
        '<div style="font-size:16px;font-weight:700;margin-top:8px;color:#fff">' + esc(c) + "</div>" +
        '<div style="font-size:12px;opacity:.85;margin-top:3px">' + n + " 件收藏</div></button>";
    });

    // 未分类
    if (uncat) {
      html += '<button class="cat-card" data-cat="__uncat" style="border:1px dashed var(--line);border-radius:16px;background:var(--card);padding:18px 16px;text-align:left">' +
        '<div style="font-size:26px">❓</div>' +
        '<div style="font-size:16px;font-weight:700;margin-top:8px;color:var(--text-2)">未分类</div>' +
        '<div style="font-size:12px;color:var(--text-2);margin-top:3px">' + uncat + " 件收藏</div></button>";
    }
    html += "</div>";

    html += '<p style="text-align:center;font-size:11px;color:#b0a290;margin-top:18px">收藏盒子可在 设置 → 盒子管理 中增删</p>';

    view.innerHTML = html;

    view.querySelectorAll(".cat-card").forEach((c) => c.addEventListener("click", () => {
      const cat = c.dataset.cat;
      if (cat === "") { categoryFilter = ""; location.hash = "#/"; return; }
      const target = cat === "__uncat" ? "__uncat" : cat;
      location.hash = "#/box/" + encodeURIComponent(target);
    }));
  }

  /* ---------- 任务页（地球Online风） ---------- */
  function renderQuestPage() {
    topbarTitle.textContent = "今日任务";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    const game = Game.computeXp(allItems);
    const level = Game.getLevel(game.xp);
    const tasks = Game.dailyTasks(allItems);
    const noBuy = Game.noBuyChallenge(allItems);
    const doneCount = tasks.filter((t) => t.done).length;

    let html = "";

    // 等级卡
    html += '<div class="stats-card"><h3>' + level.icon + " " + level.name + " · Lv." + level.level + "</h3>" +
      '<div class="xp-bar"><div class="xp-fill" style="width:' + level.progress + '%"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;opacity:.8;margin-top:6px">' +
      "<span>" + level.xp + " XP</span><span>距下一称号还需 " + (level.nextMin - level.xp) + " XP</span></div></div>";

    // 每日任务
    html += '<div class="section-title">📋 今日任务 <small style="color:var(--text-2);font-weight:400">' + doneCount + "/" + tasks.length + " 完成</small></div>";
    html += '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px 14px">';
    tasks.forEach((t) => {
      html += '<div class="quest-item' + (t.done ? " done" : "") + '">' +
        '<span class="quest-icon">' + t.icon + "</span>" +
        '<div class="quest-body"><div class="quest-title">' + esc(t.title) + "</div>" +
        '<div class="quest-desc">' + esc(t.desc) + "</div></div>" +
        (t.done ? '<span class="quest-flag">✓ +' + t.xp + "XP</span>" : '<span class="quest-xp">+' + t.xp + "XP</span>") +
        "</div>";
    });
    html += "</div>";

    // 隐藏任务：不买挑战
    html += '<div class="section-title">🤫 隐藏任务</div>';
    html += '<div class="no-buy-card">' +
      '<div class="no-buy-head">' +
      '<span style="font-size:26px">🧘</span>' +
      '<div><div class="no-buy-title">「' + noBuy.days + ' 天不买挑战」</div>' +
      '<div class="no-buy-desc">' + esc(noBuy.text) + "</div></div></div>" +
      '<div class="xp-bar" style="background:rgba(255,255,255,.3)"><div class="xp-fill" style="width:' + noBuy.nextProgress + '%;background:#fff"></div></div>' +
      '<div style="font-size:11px;opacity:.85;margin-top:6px">' +
      (noBuy.next ? "距下一个里程碑 " + noBuy.next + " 天" : "已达成全部里程碑！") +
      (noBuy.reached.length ? " · 已达成：" + noBuy.reached.map((d) => d + "天").join(" / ") : "") +
      "</div></div>";

    // 里程碑经验明细
    html += '<div class="section-title">🗺️ 经验里程碑</div>';
    html += '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px 14px">';
    if (game.milestones.length) {
      game.milestones.forEach((m) => {
        html += '<div class="quest-item done"><span class="quest-icon">' + m.icon + '</span>' +
          '<div class="quest-body"><div class="quest-title">' + esc(m.name) + "</div></div>" +
          '<span class="quest-flag">+' + m.xp + "XP</span></div>";
      });
    } else {
      html += '<div style="padding:12px 0;font-size:13px;color:var(--text-2);text-align:center">还没有里程碑，去收藏第一件宝贝吧！</div>';
    }
    html += "</div>";

    view.innerHTML = html;
  }

  /* ---------- 统计页 ---------- */
  function renderStatsPage() {
    topbarTitle.textContent = "成就殿堂";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    const stats = Stats.computeStats(allItems);
    const facts = Stats.funFacts(allItems, stats);
    const achievements = Stats.getAchievements(allItems);

    let html = "";

    // 顶部总览卡
    html += '<div class="stats-card"><h3>藏 品 总 览</h3><div class="stats-nums">' +
      '<div><div class="n">' + stats.total + '</div><div class="l">全部宝贝</div></div>' +
      '<div><div class="n">' + stats.owned + '</div><div class="l">在库</div></div>' +
      '<div><div class="n">' + stats.gifted + '</div><div class="l">已送人</div></div>' +
      '<div><div class="n">¥' + (stats.totalSpent || 0) + '</div><div class="l">累计花费</div></div>' +
      "</div></div>";

    // 月历
    html += '<div class="section-title">📅 入库月历</div>';
    html += '<div class="cal-card" id="calBox"></div>';

    // 有趣小统计
    html += '<div class="section-title">✨ 有趣发现</div>';
    html += '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px 14px">';
    facts.forEach((f) => {
      html += '<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px dashed var(--line);font-size:14px">' +
        '<span>' + f.icon + "</span><span style='line-height:1.6'>" + esc(f.text) + "</span></div>";
    });
    if (!facts.length) html += '<div style="padding:12px 0;font-size:13px;color:var(--text-2);text-align:center">还没有数据，先去收藏几件宝贝吧</div>';
    html += "</div>";

    // 成就（分组递进展示 + tier 进阶）
    const totalAch = achievements.reduce((s, g) => s + g.items.length, 0);
    const totalUnlocked = achievements.reduce((s, g) => s + g.unlockedCount, 0);

    // 称号栏（等级称号 + 自选徽章）
    const lvGame = Game.getLevel(Game.computeXp(allItems).xp);
    const badgeIds = getBadgeIds();
    const badgeAch = [];
    achievements.forEach((g) => g.items.forEach((a) => { if (a.unlocked && badgeIds.includes(a.id)) badgeAch.push(a); }));
    html += '<div class="title-bar">' +
      '<div class="title-main">' + lvGame.icon + ' ' + esc(lvGame.name) + ' <small>Lv.' + lvGame.level + '</small></div>' +
      '<div class="title-badges">' +
      (badgeAch.length ? badgeAch.map((b) => '<span class="title-badge" title="' + esc(b.desc) + '">' + b.icon + " " + esc(tierName(b)) + "</span>").join("") : '<span class="title-badge-empty">点击成就设为徽章</span>') +
      '<button class="ach-share-btn" id="btnAchShare">📤 分享成就</button>' +
      "</div></div>";

    html += '<div class="section-title">🏆 成就殿堂 <small style="color:var(--text-2);font-weight:400">' + totalUnlocked + "/" + totalAch + " 已解锁</small></div>";

    achievements.forEach((g, gi) => {
      html += '<div class="ach-group">' +
        '<button type="button" class="ach-group-head" data-g="' + gi + '">' +
        '<span style="font-size:18px">' + g.icon + "</span>" +
        '<span style="font-size:15px;font-weight:700;color:var(--wood)">' + esc(g.title) + "</span>" +
        '<span class="ach-group-desc">' + esc(g.desc) + "</span>" +
        '<span class="ach-group-count">' + g.unlockedCount + "/" + g.items.length + "</span>" +
        '<span class="ach-group-arrow" data-garrow="' + gi + '" style="color:var(--gold);transition:transform .2s">▾</span>' +
        "</button>" +
        '<div class="ach-group-body" data-gbody="' + gi + '"' + (gi === 0 ? "" : ' style="display:none"') + ">" +
        '<div class="ach-grid">';
      g.items.forEach((a) => {
        // tier 成就：显示当前称号 + 下一级
        if (a.tierResolved) {
          const tr = a.tierResolved;
          const cur = tr.current;
          const nxt = tr.next;
          const isBadged = badgeIds.includes(a.id);
          html += '<div class="ach-card' + (a.unlocked ? " unlocked" : "") + '" data-achid="' + a.id + '">' +
            '<div class="ach-icon">' + (cur ? cur.icon : "🔒") + "</div>" +
            '<div class="ach-name">' + esc(cur ? cur.name : (a.name || "未解锁")) + "</div>" +
            '<div class="ach-desc">' + esc(cur ? cur.desc : (a.levels && a.levels[0] ? a.levels[0].desc : a.desc)) + "</div>" +
            (nxt ? '<div class="ach-progress"><div class="xp-track"><div class="xp-fill" style="width:' + tr.progress + '%"></div></div>' +
              '<div class="ach-next">下一阶：' + esc(nxt.name) + "（" + nxt.min + "）</div></div>" : '<div class="ach-max">已达最高阶 ✨</div>') +
            (a.unlocked ? '<button class="ach-badge-btn' + (isBadged ? " active" : "") + '" data-achid="' + a.id + '">' + (isBadged ? "✓ 已设为徽章" : "设为徽章") + "</button>" : '<div class="ach-lock">🔒</div>') +
            "</div>";
        } else {
          const isBadged = badgeIds.includes(a.id);
          html += '<div class="ach-card' + (a.unlocked ? " unlocked" : "") + '" data-achid="' + a.id + '">' +
            '<div class="ach-icon">' + a.icon + "</div>" +
            '<div class="ach-name">' + esc(a.name) + "</div>" +
            '<div class="ach-desc">' + esc(a.desc) + "</div>" +
            (a.unlocked ? '<button class="ach-badge-btn' + (isBadged ? " active" : "") + '" data-achid="' + a.id + '">' + (isBadged ? "✓ 已设为徽章" : "设为徽章") + "</button>" : '<div class="ach-lock">🔒</div>') +
            "</div>";
        }
      });
      html += "</div></div>";
    });

    view.innerHTML = html;

    // 月历：默认当月，可翻历史（2025.1 起或最早数据月）
    let calY = new Date().getFullYear();
    let calM = new Date().getMonth();
    function renderCal(y, m) {
      calY = y; calM = m;
      Stats.renderCalendar(allItems, $("#calBox"), {
        year: y, month: m,
        onChange: (ny, nm) => renderCal(ny, nm),
      });
    }
    renderCal(calY, calM);

    // 成就分组折叠
    view.querySelectorAll(".ach-group-head").forEach((h) => h.onclick = () => {
      const gi = +h.dataset.g;
      const body = view.querySelector('[data-gbody="' + gi + '"]');
      const arrow = view.querySelector('[data-garrow="' + gi + '"]');
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "";
      if (arrow) arrow.style.transform = open ? "" : "rotate(180deg)";
    });
    // 分享成就海报
    const ashare = $("#btnAchShare");
    if (ashare) ashare.onclick = async () => {
      ashare.textContent = "生成中…";
      ashare.disabled = true;
      try {
        const canvas = await Poster.achievementPoster({
          items: allItems,
          username: user && user.displayName ? user.displayName : "",
          badgeIds: getBadgeIds(),
        });
        await Poster.shareCanvas(canvas, "我的收藏成就.jpg");
        toast("成就海报已分享/保存");
      } catch (err) {
        toast("生成失败：" + err.message);
      } finally {
        ashare.textContent = "📤 分享成就";
        ashare.disabled = false;
      }
    };
    // 徽章点击（设为/取消展示）
    view.querySelectorAll(".ach-badge-btn").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const id = b.dataset.achid;
      let ids = getBadgeIds();
      if (ids.includes(id)) { ids = ids.filter((x) => x !== id); }
      else { if (ids.length >= 6) { toast("最多展示 6 个徽章"); return; } ids.push(id); }
      saveBadgeIds(ids);
      renderStatsPage();
    });
  }

  /* ---------- 收藏盒子二级页（专注展示该分类） ---------- */
  function renderBoxPage(cat) {
    const isUncat = cat === "__uncat";
    const displayName = isUncat ? "未分类" : cat;
    topbarTitle.textContent = displayName + "盒子";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    let list = allItems;
    if (isUncat) list = list.filter((i) => !i.category);
    else list = list.filter((i) => (i.category || "") === cat);

    // 收集进度（仅非未分类盒子显示）
    let progressHtml = "";
    if (!isUncat) {
      const cfg = Categories.getCategoryConfig(cat);
      const target = cfg.options.length || 1;
      const pct = Math.min(100, Math.round((list.length / target) * 100));
      progressHtml = '<div class="box-progress">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">' +
        '<span style="color:var(--text-2)">收集进度：' + list.length + ' / ' + target + ' 种' + (cfg.field === "brand" ? "品牌" : "品种") + '</span>' +
        '<span style="color:var(--gold);font-weight:600">' + pct + '%</span></div>' +
        '<div class="xp-track"><div class="xp-fill" style="width:' + pct + '%;background:linear-gradient(90deg,#b8860b,#d4a96a)"></div></div>' +
        '<div style="font-size:10px;color:var(--text-2);margin-top:4px">继续收集，解锁更多' + esc(cfg.label || "品种") + '！</div>' +
        "</div>";
    }

    let html = progressHtml;
    html += '<div class="home-head" style="margin-bottom:12px">' +
      '<div class="stat-pills">' +
      '<span class="stat-pill">共 <b>' + list.length + '</b></span>' +
      '<span class="stat-pill">在库 <b>' + list.filter((i) => !i.gifted).length + '</b></span>' +
      '<span class="stat-pill">已送 <b>' + list.filter((i) => i.gifted).length + '</b></span>' +
      "</div></div>";

    if (!list.length) {
      html += '<div class="empty"><div class="empty-icon">📦</div><p>这个盒子里还没有宝贝\n点击下方 ＋ 添加一件吧</p></div>';
      view.innerHTML = html;
      return;
    }

    html += '<div class="grid">';
    for (const it of list) {
      const p = it.photos && it.photos[0];
      const img = p ? '<img src="' + photoUrl(p) + '" loading="lazy" alt="">' : '<div class="placeholder">📿</div>';
      const badge = it.gifted ? '<span class="badge gifted">已送人</span>' : '<span class="badge instock">在库</span>';
      const st = it.playStatus;
      const statusBadge = st === "playing" ? '<span class="badge played">盘玩中</span>' :
        st === "puzzle_pending" ? '<span class="badge" style="background:#d98ba6">待拼</span>' :
        st === "puzzle_done" ? '<span class="badge" style="background:#2e7d32">已拼</span>' : "";
      const days = DB.formatDays(DB.daysWith(it));
      html += '<div class="card" data-id="' + it.id + '">' +
        '<div class="card-thumb">' + img + badge + statusBadge + "</div>" +
        '<div class="card-body">' +
        '<div class="card-name">' + esc(it.name || "未命名") + "</div>" +
        '<div class="card-sub"><span>' + esc(it.species || it.beadSize ? (it.beadSize ? it.beadSize + "mm" : it.species || "") : "") + '</span><span class="days">' + esc(days) + "</span></div>" +
        "</div></div>";
    }
    html += "</div>";

    view.innerHTML = html;
    view.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => location.hash = "#/item/" + c.dataset.id));
  }

  /* ---------- 多选分享模式 ---------- */
  function enterShareMode() {
    const selected = new Set();
    const list = filtered();

    function render() {
      topbarTitle.textContent = "多选分享";
      btnBack.style.visibility = "visible";
      btnSettings.style.visibility = "hidden";

      let html = "";
      html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:10px">已选 ' + selected.size + ' 条，点击卡片勾选（最多 12 条）</div>';
      html += '<div class="grid">';
      list.forEach((it) => {
        const p = it.photos && it.photos[0];
        const img = p ? '<img src="' + photoUrl(p) + '" alt="">' : '<div class="placeholder">📿</div>';
        const checked = selected.has(it.id) ? ' style="outline:3px solid var(--gold)"' : "";
        html += '<div class="card" data-id="' + it.id + '"' + checked + '>' +
          '<div class="card-thumb">' + img +
          '<span class="badge ' + (selected.has(it.id) ? "instock" : "gifted") + '" style="right:8px;left:auto">' + (selected.has(it.id) ? "✓ 已选" : "选择") + "</span>" +
          "</div>" +
          '<div class="card-body"><div class="card-name">' + esc(it.name || "未命名") + "</div>" +
          '<div class="card-sub"><span>' + esc(it.beadSize ? it.beadSize + "mm" : it.species || "") + "</span></div>" +
          "</div></div>";
      });
      html += "</div>";

      if (!list.length) {
        html = '<div class="empty"><div class="empty-icon">📤</div><p>没有可分享的宝贝</p></div>';
      }

      html += '<div class="detail-actions" style="margin-top:16px">';
      html += '<button class="btn ghost" id="sCancel" style="flex:1">取消</button>';
      html += '<button class="btn primary" id="sShare" style="flex:2"' + (selected.size ? "" : " disabled") + '>生成图鉴海报 (' + selected.size + ')</button>';
      html += "</div>";

      view.innerHTML = html;

      view.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => {
        const id = c.dataset.id;
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        render();
      }));
      $("#sCancel").onclick = () => location.hash = "#/";
      $("#sShare").onclick = async () => {
        const items = allItems.filter((i) => selected.has(i.id));
        if (!items.length) { toast("请先选择宝贝"); return; }
        const btn = $("#sShare");
        btn.textContent = "生成中…";
        btn.disabled = true;
        try {
          const canvas = await Poster.galleryPoster(items, { username: user && user.displayName ? user.displayName : "" });
          await Poster.shareCanvas(canvas, "文玩收藏图鉴.jpg");
          toast("图鉴海报已分享/保存");
          location.hash = "#/";
        } catch (err) {
          toast("生成失败：" + err.message);
          btn.textContent = "生成图鉴海报 (" + selected.size + ")";
          btn.disabled = false;
        }
      };
    }
    render();
  }

  /* ---------- 批量录入模式 ---------- */
  function enterBatchMode(items, title) {
    const drafts = items.map((it) => JSON.parse(JSON.stringify(it)));
    const batchTitle = title || "批量录入 " + drafts.length + " 件宝贝";
    let current = null; // 当前编辑中的草稿

    function renderList() {
      topbarTitle.textContent = batchTitle;
      btnBack.style.visibility = "visible";
      btnSettings.style.visibility = "hidden";

      let html = "";
      html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:10px">共 ' + drafts.length + ' 条，点击卡片可编辑详情；照片随各条保存</div>';
      html += '<div class="grid">';
      drafts.forEach((it, i) => {
        const p = it.photos && it.photos[0];
        const img = p ? '<img src="' + photoUrl(p) + '" alt="">' : '<div class="placeholder">📿</div>';
        html += '<div class="card" data-i="' + i + '">' +
          '<div class="card-thumb">' + img + "</div>" +
          '<div class="card-body">' +
          '<div class="card-name">' + esc(it.name || "未命名·第" + (i + 1) + "条") + "</div>" +
          '<div class="card-sub"><span>' + esc(it.shop || "") + '</span><span class="days">' + (it.price != null ? "¥" + it.price : "") + "</span></div>" +
          "</div></div>";
      });
      html += "</div>";

      html += '<div class="detail-actions" style="margin-top:16px">';
      html += '<button class="btn ghost" id="bAddRow" style="flex:1">＋ 添加一行</button>';
      html += '<button class="btn primary" id="bSaveAll" style="flex:2">保存全部 ' + drafts.length + ' 条</button>';
      html += "</div>";

      view.innerHTML = html;

      view.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => {
        current = drafts[+c.dataset.i];
        renderDraftEditor(+c.dataset.i);
      }));
      $("#bAddRow").onclick = () => {
        drafts.push({ name: "", species: "", craft: "", arrivedAt: null, price: null, shop: "", gifted: false, giftedAt: null, played: false, playedNote: "", note: "", photos: [], screenshots: [] });
        renderList();
      };
      $("#bSaveAll").onclick = () => saveAllDrafts();
    }

    function renderDraftEditor(idx) {
      const it = drafts[idx];
      topbarTitle.textContent = "编辑第 " + (idx + 1) + " 条";
      btnBack.style.visibility = "visible";
      btnSettings.style.visibility = "hidden";

      let html = "";
      html += '<div class="form">';
      html += '<div class="form-group"><div class="form-label">串的名字</div>' +
        '<input class="form-input" id="dName" value="' + esc(it.name || "") + '" placeholder="如：星月菩提·老念珠"></div>';
      html += '<div class="form-row">';
      html += '<div class="form-group"><div class="form-label">分类</div>' +
        '<select class="form-select" id="dCategory">' + categoryOptions(it.category || "") + '</select></div>';
      html += '<div class="form-group"><div class="form-label">品种/材质</div>' +
        '<input class="form-input" id="dSpecies" list="dSpeciesList" value="' + esc(it.species || "") + '" placeholder="可自由填写">' +
        '<datalist id="dSpeciesList"></datalist></div>';
      html += "</div>";
      html += '<div class="form-group" id="dCraftWrap"><div class="form-label">工艺 <small>珠子类</small></div>' +
        '<div class="seg" id="dCraft">' +
        '<button type="button" data-v="干磨" class="' + (it.craft === "干磨" || !it.craft ? "active" : "") + '">干磨</button>' +
        '<button type="button" data-v="水磨" class="' + (it.craft === "水磨" ? "active" : "") + '">水磨</button>' +
        '<button type="button" data-v="" class="' + (it.craft && it.craft !== "干磨" && it.craft !== "水磨" ? "active" : "") + '">其他</button>' +
        "</div></div>";
      html += '<div class="form-row">';
      html += '<div class="form-group"><div class="form-label">到货时间</div>' +
        '<input class="form-input" id="dDate" type="date" value="' + (it.arrivedAt ? fmtDateInput(it.arrivedAt) : "") + '"></div>';
      html += '<div class="form-group"><div class="form-label">价格 <small>元</small></div>' +
        '<input class="form-input" id="dPrice" type="number" inputmode="decimal" value="' + (it.price != null ? it.price : "") + '"></div>';
      html += "</div>";
      html += '<div class="form-row">';
      html += '<div class="form-group" id="dSizeWrap"><div class="form-label" id="dSizeLabel">珠子大小 <small>mm</small></div>' +
        '<select class="form-select" id="dSize"></select></div>';
      html += '<div class="form-group" id="dFinishedWrap" style="display:none"><div class="form-label">拼图完成时间</div>' +
        '<input class="form-input" id="dFinished" type="date"></div>';
      html += "</div>";
      html += '<div class="form-group"><div class="form-label">状态</div>' +
        '<div class="seg" id="dStatus">' +
        statusButton("idle", "待盘玩", it.playStatus || "", !it) +
        statusButton("playing", "在盘玩", it.playStatus || "") +
        statusButton("puzzle_pending", "待拼", it.playStatus || "") +
        statusButton("puzzle_done", "已拼", it.playStatus || "") +
        statusButton("gifted", "已送人", it.playStatus || "") +
        "</div></div>";
      html += '<div class="form-group"><div class="form-label">店铺</div>' +
        '<input class="form-input" id="dShop" value="' + esc(it.shop || "") + '"></div>';
      html += '<div class="form-group"><div class="form-label">备注</div>' +
        '<textarea class="form-textarea" id="dNote" placeholder="可选">' + esc(it.note || "") + "</textarea></div>";

      html += '<div class="form-group"><div class="form-label">照片 <small>最多 9 张</small></div>' +
        '<div class="upload-grid" id="dPhotoGrid"></div>' +
        '<input type="file" id="dPhotoInput" accept="image/*" multiple hidden></div>';

      html += '<div class="detail-actions">';
      html += '<button class="btn ghost" id="dDel" style="flex:1">删除这条</button>';
      html += '<button class="btn primary" id="dBack" style="flex:1">返回列表</button>';
      html += "</div></div>";

      view.innerHTML = html;

      view.querySelectorAll("#dCraft button").forEach((b) => b.onclick = () => {
        view.querySelectorAll("#dCraft button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      });

      // 批量分类联动（简化：更新标签与拼图完成时间显隐）
      const dCat = $("#dCategory");
      const dStatusEl = document.querySelector("#dStatus");
      if (dStatusEl) {
        dStatusEl.querySelectorAll("button").forEach((b) => b.onclick = () => {
          dStatusEl.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
        });
      }
      const batchIt = it; // 当前草稿
      function refreshBatchCat() {
        if (!dCat) return;
        const cat = dCat.value;
        const cfg = Categories.getCategoryConfig(cat);
        const lbl = document.querySelector("#dSpecies");
        if (lbl) lbl.setAttribute("placeholder", "可自由填写" + (cfg.options.length ? "（如：" + cfg.options.slice(0, 3).join("/") + "…）" : ""));
        const dl = document.querySelector("#dSpeciesList");
        if (dl) dl.innerHTML = cfg.options.map((s) => '<option value="' + esc(s) + '">').join("");
        const isPuzzle = Categories.isPuzzleCategory(cat);
        const isBead = !Categories.isBrandCategory(cat) && !isPuzzle;
        const cw = document.querySelector("#dCraftWrap");
        if (cw) cw.style.display = isBead ? "" : "none";
        const fw = document.querySelector("#dFinishedWrap");
        if (fw) {
          fw.style.display = isPuzzle ? "" : "none";
          if (!isPuzzle) { const fi = document.querySelector("#dFinished"); if (fi) fi.value = ""; }
        }
        // 状态按钮按分类显隐
        const dStatus = document.querySelector("#dStatus");
        if (dStatus) {
          dStatus.querySelectorAll("button").forEach((b) => {
            const v = b.dataset.v;
            let show = true;
            if (v === "puzzle_pending" || v === "puzzle_done") show = isPuzzle;
            if (v === "idle" || v === "playing") show = !isPuzzle && isBead;
            b.style.display = show ? "" : "none";
          });
          const activeBtn = dStatus.querySelector("button.active");
          if (activeBtn && activeBtn.style.display === "none") {
            const firstVisible = dStatus.querySelector("button:not([style*='display: none'])");
            if (firstVisible) {
              dStatus.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
              firstVisible.classList.add("active");
            }
          }
        }
        // 尺寸字段
        const sizeField = Categories.getSizeField(cat);
        const dSizeWrap = document.querySelector("#dSizeWrap");
        if (dSizeWrap) {
          dSizeWrap.style.display = sizeField === "none" ? "none" : "";
          const dSizeLbl = document.querySelector("#dSizeLabel");
          if (dSizeLbl) {
            dSizeLbl.innerHTML = (sizeField === "pieces" ? "拼图片数" : "珠子大小") + " <small>" + (sizeField === "pieces" ? "片" : "mm") + "</small>";
          }
          const dSize = document.querySelector("#dSize");
          if (dSize) {
            const initVal = sizeField === "pieces" ? (batchIt && batchIt.pieceCount) : (batchIt && batchIt.beadSize);
            const curVal = dSize.value || initVal;
            dSize.innerHTML = sizeField === "pieces" ? pieceOptions(curVal || null) : beadSizeOptions(curVal || null);
          }
        }
      }
      if (dCat) { dCat.addEventListener("change", refreshBatchCat); refreshBatchCat(); }

      function renderPhotoGrid() {
        const grid = $("#dPhotoGrid");
        let h = "";
        (it.photos || []).forEach((p, i) => {
          h += '<div class="upload-cell has">' + (photoUrl(p) ? '<img src="' + photoUrl(p) + '" alt="">' : "") +
            '<button type="button" class="upload-del" data-i="' + i + '">✕</button></div>';
        });
        if ((it.photos || []).length < 9) {
          h += '<label class="upload-cell upload-add" style="cursor:pointer"><span class="plus">＋</span><span>照片</span></label>';
        }
        grid.innerHTML = h;
        grid.querySelectorAll(".upload-del").forEach((b) => b.onclick = () => {
          it.photos.splice(+b.dataset.i, 1);
          renderPhotoGrid();
        });
        const add = grid.querySelector("label.upload-add");
        if (add) add.onclick = (e) => { e.preventDefault(); $("#dPhotoInput").click(); };
      }
      $("#dPhotoInput").onchange = async (e) => {
        const files = [...e.target.files];
        e.target.value = "";
        for (const f of files) {
          try {
            const cf = await ImageUtil.compressFile(f, { maxSizeKB: 500, maxDim: 1920 });
            it.photos.push(DB.fileToPhoto(cf));
          } catch (err) {
            it.photos.push(DB.fileToPhoto(f));
          }
        }
        renderPhotoGrid();
      };
      renderPhotoGrid();

      $("#dBack").onclick = () => {
        it.name = $("#dName").value.trim();
        it.species = $("#dSpecies").value.trim();
        it.craft = view.querySelector("#dCraft button.active").dataset.v;
        const dv = $("#dDate").value;
        it.arrivedAt = dv ? new Date(dv + "T12:00:00").getTime() : null;
        const pv = parseFloat($("#dPrice").value);
        it.price = isNaN(pv) ? null : pv;
        it.shop = $("#dShop").value.trim();
        it.category = $("#dCategory").value.trim();
        const dStatusBtn = document.querySelector("#dStatus button.active");
        if (dStatusBtn) {
          const sv2 = dStatusBtn.dataset.v;
          it.playStatus = sv2 === "gifted" ? "" : sv2;
          it.gifted = sv2 === "gifted";
          if (!it.gifted) it.giftedAt = null;
          it.played = sv2 === "playing";
        }
        const dSizeField = Categories.getSizeField(it.category);
        const dsv = $("#dSize").value;
        if (dSizeField === "pieces") {
          it.pieceCount = dsv ? parseFloat(dsv) : null;
          it.beadSize = null;
        } else if (dSizeField === "bead") {
          it.beadSize = dsv ? parseFloat(dsv) : null;
          it.pieceCount = null;
        } else {
          it.beadSize = null;
          it.pieceCount = null;
        }
        it.accessoryType = it.category === "动漫周边" ? it.species : "";
        const dfw = $("#dFinished").value;
        it.finishedAt = dfw ? new Date(dfw + "T12:00:00").getTime() : null;
        it.note = $("#dNote").value.trim();
        renderList();
      };
      $("#dDel").onclick = () => {
        drafts.splice(idx, 1);
        if (!drafts.length) { location.hash = "#/"; return; }
        renderList();
      };
    }

    async function saveAllDrafts() {
      const valid = drafts.filter((it) => it.name && it.name.trim());
      if (!valid.length) { toast("请至少给一件宝贝填上名字"); return; }
      const btn = $("#bSaveAll");
      btn.textContent = "正在保存…";
      btn.disabled = true;
      try {
        let n = 0;
        for (const it of valid) {
          // 上传照片（先读原图，避免提前清空导致丢失）
          const originals = (it.photos || []).slice();
          it.photos = [];
          for (const p of originals) {
            if (p.url) { it.photos.push(p); continue; }
            if (p.data) it.photos.push(await DB.uploadPhoto(p.data, "photos"));
          }
          await DB.put(it);
          n++;
        }
        await loadItems();
        toast("批量保存成功：" + n + " 条 🎉");
        location.hash = "#/";
      } catch (err) {
        toast("保存失败：" + translateAuthError(err.message));
        btn.textContent = "保存全部 " + valid.length + " 条";
        btn.disabled = false;
      }
    }

    renderList();
  }

  /* ---------- 设置用户名页（首次登录引导 + 随时可改） ---------- */
  function renderProfile() {
    topbarTitle.textContent = "我的用户名";
    btnBack.style.visibility = "hidden";
    btnSettings.style.visibility = "hidden";

    let html = "";
    html += '<div style="text-align:center;padding:26px 0 14px">' +
      '<div style="font-size:46px">👤</div>' +
      '<div style="font-size:17px;font-weight:700;color:var(--wood);margin-top:8px">给收藏馆起个称呼</div>' +
      '<div style="font-size:12px;color:var(--text-2);margin-top:5px">其他信息（收藏数据）仍按账号隔离，用户名只用于显示</div></div>';

    html += '<div class="form">';
    html += '<div class="form-group"><div class="form-label">用户名 <small>1-20 字，可随时修改</small></div>' +
      '<input class="form-input" id="pName" placeholder="如：盘串老张" maxlength="20" value="' + esc(user ? user.displayName : "") + '"></div>';
    html += '<button class="btn primary" id="btnSaveProfile" style="width:100%">保 存</button>';
    html += '<button class="btn ghost" id="btnSkipProfile" style="width:100%;margin-top:10px">跳过，稍后再说</button>';
    html += "</div>";

    view.innerHTML = html;

    $("#btnSaveProfile").onclick = async () => {
      const name = $("#pName").value.trim();
      if (!name) { toast("请填写用户名"); return; }
      try {
        user.displayName = await DB.setDisplayName(user.id, name);
        toast("用户名已保存：你好，" + user.displayName + " 👋");
        location.hash = "#/";
      } catch (err) {
        toast("保存失败：" + err.message);
      }
    };
    $("#btnSkipProfile").onclick = () => location.hash = "#/";
  }

  /* ---------- 认证页 ---------- */
  function renderAuth() {
    topbarTitle.textContent = "登录 · 我的收藏馆";
    btnBack.style.visibility = "hidden";
    btnSettings.style.visibility = "hidden";

    let html = "";
    html += '<div style="text-align:center;padding:30px 0 16px">' +
      '<div style="font-size:52px">📿</div>' +
      '<div style="font-size:20px;font-weight:700;color:var(--wood);margin-top:8px">我的收藏馆</div>' +
      '<div style="font-size:13px;color:var(--text-2);margin-top:6px">登录后，你的收藏在任何设备上都在</div></div>';

    html += '<div class="form">';
    html += '<div class="form-group"><div class="form-label">邮箱</div>' +
      '<input class="form-input" id="aEmail" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email"></div>';
    html += '<div class="form-group"><div class="form-label">密码</div>' +
      '<input class="form-input" id="aPass" type="password" placeholder="至少 6 位" autocomplete="current-password"></div>';
    html += '<button class="btn primary" id="btnLogin" style="width:100%">登 录</button>';
    html += '<p id="authMsg" style="text-align:center;font-size:13px;color:var(--red);margin-top:12px;min-height:18px"></p>';
    html += '<p style="text-align:center;font-size:11px;color:#b0a290;line-height:1.8;margin-top:8px">邀请制 · 账号由管理员开通<br>没有账号？请联系管理员获取</p>';
    html += "</div>";

    view.innerHTML = html;

    const emailEl = $("#aEmail"), passEl = $("#aPass"), msgEl = $("#authMsg");
    const showMsg = (m, ok) => { msgEl.textContent = m; msgEl.style.color = ok ? "var(--green)" : "var(--red)"; };
    const doAuth = async () => {
      const email = emailEl.value.trim();
      const pass = passEl.value;
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showMsg("请输入正确的邮箱地址"); return; }
      if (pass.length < 6) { showMsg("密码至少 6 位"); return; }
      try {
        const res = await DB.signIn(email, pass);
        showMsg("登录成功", true);
        await enterApp(res.session);
      } catch (err) {
        showMsg(translateAuthError(err.message));
      }
    };
    $("#btnLogin").onclick = doAuth;
    emailEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(); });
    passEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(); });
  }

  function translateAuthError(msg) {
    const m = msg || "";
    if (m.includes("Invalid login credentials")) return "邮箱或密码不正确";
    if (m.includes("User already registered")) return "该邮箱已注册，请直接登录";
    if (m.includes("Email not confirmed")) return "邮箱尚未验证，请查收确认邮件";
    if (m.includes("Password should be")) return "密码长度不符合要求";
    if (m.includes("rate limit") || m.includes("Too many")) return "操作太频繁，请稍后再试";
    if (m.includes("fetch") || m.includes("Network") || m.includes("Failed to fetch")) return "网络错误，请检查网络后重试";
    return m;
  }

  /* ---------- 进入应用（登录后） ---------- */
  async function enterApp(passedSession) {
    const session = passedSession || await DB.getSession();
    if (!session || !session.user) { location.hash = "#/auth"; return false; }
    user = session.user;
    try {
      const prof = await DB.getProfile(user.id);
      user.displayName = prof.display_name || "";
      await loadItems();
    } catch (e) { /* 表未建好时显示错误 */ }
    // 首次登录：无显示名则引导设置
    if (user && !user.displayName && location.hash !== "#/profile") {
      location.hash = "#/profile";
    }
    router();
    checkLevelUp();
    return true;
  }

  /* ---------- 数据加载 ---------- */
  async function loadItems() {
    allItems = await DB.getAll();
    sortItems();
  }

  // 按入库时间排序：newest=降序（最新在前），oldest=升序（最早在前）
  function sortItems() {
    const key = (i) => i.arrivedAt || i.createdAt || 0;
    allItems.sort((a, b) => sortMode === "oldest" ? key(a) - key(b) : key(b) - key(a));
  }

  function filtered() {
    let list = allItems;
    if (filter === "instock") list = list.filter((i) => !i.gifted);
    else if (filter === "gifted") list = list.filter((i) => i.gifted);
    else if (filter === "playing") list = list.filter((i) => i.playStatus === "playing");
    else if (filter === "puzzle_pending") list = list.filter((i) => i.playStatus === "puzzle_pending");
    else if (filter === "puzzle_done") list = list.filter((i) => i.playStatus === "puzzle_done");
    if (categoryFilter === "__uncat") {
      list = list.filter((i) => !i.category);
    } else if (categoryFilter) {
      list = list.filter((i) => (i.category || "") === categoryFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) =>
        (i.name || "").toLowerCase().includes(q) ||
        (i.species || "").toLowerCase().includes(q) ||
        (i.shop || "").toLowerCase().includes(q) ||
        (i.note || "").toLowerCase().includes(q)
      );
    }
    return list;
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    topbarTitle.textContent = (user && user.displayName ? user.displayName : "我的") + "收藏馆";
    btnBack.style.visibility = "hidden";
    btnSettings.style.visibility = "visible";

    const inStock = allItems.filter((i) => !i.gifted).length;
    const gifted = allItems.filter((i) => i.gifted).length;
    const playing = allItems.filter((i) => i.playStatus === "playing").length;
    const pending = allItems.filter((i) => i.playStatus === "puzzle_pending").length;
    const done = allItems.filter((i) => i.playStatus === "puzzle_done").length;

    // 等级经验条（游戏化）
    const gameInfo = Game.computeXp(allItems);
    const lvInfo = Game.getLevel(gameInfo.xp);

    // 今日任务完成情况
    const tasks = Game.dailyTasks(allItems);
    const taskDone = tasks.filter((t) => t.done).length;

    let html = "";
    html += '<div class="level-row">' +
      '<button class="level-bar" id="levelBar" style="flex:1;margin-bottom:0">' +
      '<span class="level-icon">' + lvInfo.icon + "</span>" +
      '<span class="level-info"><span class="level-name">' + esc(lvInfo.name) + ' · Lv.' + lvInfo.level + '</span>' +
      '<span class="xp-track"><span class="xp-fill" style="width:' + lvInfo.progress + '%"></span></span></span>' +
      '<span class="level-xp">' + lvInfo.xp + ' XP</span>' +
      "</button>" +
      '<button class="quest-hint" id="btnQuestHint" title="查看今日任务">' +
      '<span class="quest-hint-icon">🎯</span>' +
      '<span class="quest-hint-text">今日任务<br><b>' + taskDone + '/' + tasks.length + '</b></span>' +
      "</button></div>";

    // 折叠筛选区：按钮 + 可展开面板
    html += '<button class="filter-toggle" id="filterToggle">' +
      '<span>📊 筛选与统计</span><span class="filter-badge">' + allItems.length + ' 件</span><span class="filter-arrow" id="filterArrow">▾</span>' +
      "</button>";

    html += '<div id="filterPanel" style="display:none">';
    html += '<div class="home-head"><div class="stat-pills">' +
      '<span class="stat-pill">共 <b>' + allItems.length + '</b></span>' +
      '<span class="stat-pill">在库 <b>' + inStock + '</b></span>' +
      '<span class="stat-pill">盘玩 <b>' + playing + '</b></span>' +
      '<span class="stat-pill">待拼 <b>' + pending + '</b></span>' +
      '<span class="stat-pill">已拼 <b>' + done + '</b></span>' +
      '<span class="stat-pill">已送 <b>' + gifted + '</b></span>' +
      '</div></div>';

    html += '<div class="filters">' +
      chip("all", "全部") + chip("instock", "在库") + chip("playing", "在盘玩") + chip("puzzle_pending", "待拼") + chip("puzzle_done", "已拼") + chip("gifted", "已送人") +
      '</div>';

    // 分类筛选行
    const cats = getCategories();
    html += '<div class="filters">' +
      '<button class="chip' + (!categoryFilter ? " active" : "") + '" data-cat="">全部分类</button>' +
      cats.map((c) => '<button class="chip' + (categoryFilter === c ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>").join("") +
      "</div>";

    // 排序
    html += '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--text-2)">' +
      '<span>排序</span>' +
      '<div class="seg" id="sortSeg" style="flex:1">' +
      '<button type="button" data-sort="newest" class="' + (sortMode === "newest" ? "active" : "") + '">🕐 入库最新</button>' +
      '<button type="button" data-sort="oldest" class="' + (sortMode === "oldest" ? "active" : "") + '">📜 入库最早</button>' +
      "</div></div>";
    html += "</div>";

    html += '<div class="search-box"><input id="searchInput" placeholder="搜索名字 / 品种 / 店铺…" value="' + esc(search) + '"></div>';

    html += '<div style="display:flex;gap:8px;margin-bottom:12px">' +
      '<button class="batch-entry" id="btnBatch" style="flex:1">🗂 批量录入</button>' +
      '<button class="batch-entry" id="btnShareMode" style="flex:1;background:linear-gradient(135deg,#b8860b,#a06b2c)">📤 多选</button>' +
      '<button class="batch-entry" id="btnViewToggle" style="flex:none;width:52px;background:var(--card);color:var(--wood);border:1px solid var(--line)" title="切换视图">' + (viewMode === "card" ? "📋" : "🗂") + "</button>" +
      "</div>";

    html += '<div id="gridHolder"></div>';

    view.innerHTML = html;
    bindHomeEvents();
    updateGrid();
  }

  function gridHtml() {
    const list = filtered();
    let h = "";
    if (!list.length) {
      return '<div class="empty">' +
        '<div class="empty-icon">' + (allItems.length ? "🔍" : "📿") + "</div>" +
        "<p>" + (allItems.length ? "没有找到匹配的宝贝" : "还没有收藏任何宝贝\n点击下方 ＋ 添加第一条吧") + "</p>" +
        "</div>";
    }
    if (viewMode === "list") {
      // ===== 列表视图：缩略图 + 更多信息 =====
      h += '<div class="list-view">';
      for (const it of list) {
        const p = it.photos && it.photos[0];
        const img = p ? '<img src="' + photoUrl(p) + '" loading="lazy" alt="">' :
          '<div class="placeholder" style="font-size:20px">📿</div>';
        const statusTxt = it.gifted ? "已送人" :
          it.playStatus === "playing" ? "在盘玩" :
          it.playStatus === "puzzle_pending" ? "待拼" :
          it.playStatus === "puzzle_done" ? "已拼" : "待盘玩";
        const statusCls = it.gifted ? "r" : (it.playStatus === "puzzle_done" || it.playStatus === "playing" ? "g" : "yl");
        const price = it.price != null && it.price !== "" ? "¥" + it.price : "";
        h += '<div class="list-item" data-id="' + it.id + '">' +
          '<div class="list-thumb">' + img + "</div>" +
          '<div class="list-info">' +
          '<div class="list-name">' + esc(it.name || "未命名") + "</div>" +
          '<div class="list-sub">' + esc(cardSubText(it)) + (it.category ? " · " + esc(it.category) : "") + "</div>" +
          '<div class="list-meta">' +
          (it.shop ? '<span class="list-shop">🏪 ' + esc(it.shop) + "</span>" : "") +
          (price ? '<span class="list-price">' + price + "</span>" : "") +
          '<span class="list-days">⏳ ' + esc(DB.formatDays(DB.daysWith(it))) + "</span>" +
          "</div>" +
          "</div>" +
          '<span class="list-status ' + statusCls + '">' + statusTxt + "</span>" +
          "</div>";
      }
      return h + "</div>";
    }
    // ===== 卡片视图（默认） =====
    h += '<div class="grid">';
    for (const it of list) {
      const p = it.photos && it.photos[0];
      const img = p ? '<img src="' + photoUrl(p) + '" loading="lazy" alt="">' :
        '<div class="placeholder">📿</div>';
      const badge = it.gifted ? '<span class="badge gifted">已送人</span>' : '<span class="badge instock">在库</span>';
      const playedBadge = it.played ? '<span class="badge played">盘玩中</span>' : "";
      const days = DB.formatDays(DB.daysWith(it));
      h += '<div class="card" data-id="' + it.id + '">' +
        '<div class="card-thumb">' + img + badge + playedBadge + "</div>" +
        '<div class="card-body">' +
        '<div class="card-name">' + esc(it.name || "未命名") + "</div>" +
        '<div class="card-sub"><span>' + esc(cardSubText(it)) + '</span><span class="days">' + esc(days) + "</span></div>" +
        "</div></div>";
    }
    return h + "</div>";
  }

  function bindCardEvents() {
    view.querySelectorAll(".card, .list-item").forEach((c) => c.addEventListener("click", () => location.hash = "#/item/" + c.dataset.id));
  }

  function bindHomeEvents() {
    // 等级条 → 任务页
    const lb = $("#levelBar");
    if (lb) lb.onclick = () => location.hash = "#/quest";
    const qh = $("#btnQuestHint");
    if (qh) qh.onclick = () => location.hash = "#/quest";
    // 折叠筛选面板
    const ft = $("#filterToggle");
    if (ft) ft.onclick = () => {
      const panel = $("#filterPanel");
      const arrow = $("#filterArrow");
      const open = panel.style.display !== "none";
      panel.style.display = open ? "none" : "";
      if (arrow) arrow.style.transform = open ? "" : "rotate(180deg)";
    };
    // 视图切换
    const vt = $("#btnViewToggle");
    if (vt) vt.onclick = () => {
      viewMode = viewMode === "card" ? "list" : "card";
      localStorage.setItem("ww_viewmode", viewMode);
      vt.textContent = viewMode === "card" ? "📋" : "🗂";
      updateGrid();
    };
    const bb = $("#btnBatch");
    if (bb) bb.onclick = () => {
      enterBatchMode([], "批量录入（空列表，点击＋添加一行）");
    };
    const sm = $("#btnShareMode");
    if (sm) sm.onclick = () => enterShareMode();
    const si = $("#searchInput");
    if (si) si.addEventListener("input", () => { search = si.value.trim(); updateGrid(); });
    view.querySelectorAll(".chip[data-f]").forEach((c) => c.addEventListener("click", () => {
      filter = c.dataset.f;
      view.querySelectorAll(".chip[data-f]").forEach((x) => x.classList.toggle("active", x === c));
      updateGrid();
    }));
    // 分类 chips（用 data-cat 区分）
    view.querySelectorAll(".chip[data-cat]").forEach((c) => c.addEventListener("click", () => {
      categoryFilter = c.dataset.cat || "";
      view.querySelectorAll(".chip[data-cat]").forEach((x) => x.classList.toggle("active", x === c));
      updateGrid();
    }));
    // 排序
    view.querySelectorAll("#sortSeg button").forEach((b) => b.onclick = () => {
      sortMode = b.dataset.sort;
      view.querySelectorAll("#sortSeg button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      sortItems();
      updateGrid();
    });
  }

  function updateGrid() {
    const holder = document.getElementById("gridHolder");
    if (holder) holder.innerHTML = gridHtml();
    bindCardEvents();
  }

  function chip(key, label) {
    return '<button class="chip' + (filter === key ? " active" : "") + '" data-f="' + key + '">' + label + "</button>";
  }

  /* ---------- 分类管理（localStorage 持久化用户自定义分类） ---------- */
  const DEFAULT_CATEGORIES = ["菩提", "水晶", "玉石", "拼图", "动漫周边", "盲盒", "其他"];
  function getCategories() {
    try {
      const raw = localStorage.getItem("ww_categories");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (e) {}
    return DEFAULT_CATEGORIES.slice();
  }
  function saveCategories(arr) {
    const cleaned = arr.map((c) => c.trim()).filter(Boolean);
    const uniq = [...new Set(cleaned)];
    try { localStorage.setItem("ww_categories", JSON.stringify(uniq)); } catch (e) {}
    return uniq;
  }
  function categoryOptions(selected) {
    const cats = getCategories();
    let h = '<option value="">未分类</option>';
    cats.forEach((c) => {
      h += '<option value="' + esc(c) + '"' + (selected === c ? " selected" : "") + ">" + esc(c) + "</option>";
    });
    return h;
  }

  /* ---------- 珠径（卡数）选择 ---------- */
  function beadSizeOptions(selected) {
    let h = "";
    const def = selected != null ? selected : 14;
    for (let i = 6; i <= 22; i++) {
      h += '<option value="' + i + '"' + (def === i ? " selected" : "") + ">" + i + " mm</option>";
    }
    return h;
  }

  /* 卡片副标题文字 */
  function cardSubText(it) {
    const f = Categories.getSizeField(it.category || "");
    if (f === "pieces" && it.pieceCount) return it.pieceCount + "片";
    if (f === "bead" && it.beadSize) return it.beadSize + "mm";
    return it.species || it.accessoryType || "";
  }

  /* ---------- 主题系统 ---------- */
  const THEMES = [
    { id: "light", name: "浅色", icon: "☀️" },
    { id: "dark", name: "深色", icon: "🌙" },
    { id: "system", name: "跟随系统", icon: "📱" },
    { id: "dopamine-pink", name: "多巴胺·粉", icon: "🍬" },
    { id: "dopamine-yellow", name: "多巴胺·黄", icon: "🍋" },
    { id: "dopamine-green", name: "多巴胺·绿", icon: "🌿" },
    { id: "morandi", name: "莫兰迪·原木", icon: "🪵" },
    { id: "morandi-blue", name: "莫兰迪·蓝", icon: "🫐" },
    { id: "morandi-purple", name: "莫兰迪·紫", icon: "🍇" },
    { id: "morandi-green", name: "莫兰迪·绿", icon: "🍃" },
  ];
  // 主题色点（用于紧凑选择器）
  function themeDotColor(id) {
    const map = {
      "light": "#f5f0e8", "dark": "#1e1a16", "system": "#8a7a68",
      "dopamine-pink": "#e0447c", "dopamine-yellow": "#ffa500", "dopamine-green": "#1e9e5a",
      "morandi": "#b5a48a", "morandi-blue": "#7d95ad", "morandi-purple": "#8d7aa8", "morandi-green": "#7d9d87",
    };
    return map[id] || "#b8860b";
  }
  function getTheme() {
    try { return localStorage.getItem("ww_theme") || "light"; } catch (e) { return "light"; }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("ww_theme", theme); } catch (e) {}
  }
  function initTheme() {
    applyTheme(getTheme());
  }

  /* ---------- 徽章（称号）系统 ---------- */
  function getBadgeIds() {
    try {
      const raw = localStorage.getItem("ww_badges");
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveBadgeIds(arr) {
    try { localStorage.setItem("ww_badges", JSON.stringify(arr.slice(0, 6))); } catch (e) {}
  }
  // tier 成就的名称（当前称号）
  function tierName(a) {
    return a && a.tierResolved && a.tierResolved.current ? a.tierResolved.current.name : (a ? a.name : "");
  }

  /* 拼图片数选项 */
  function pieceOptions(selected) {
    const opts = [500, 1000, 1500, 2000];
    const def = selected != null ? Number(selected) : 1000;
    let h = "";
    opts.forEach((p) => {
      h += '<option value="' + p + '"' + (def === p ? " selected" : "") + ">" + p + " 片</option>";
    });
    if (selected != null && !opts.includes(def)) {
      h += '<option value="' + def + '" selected>' + def + " 片（自定义）</option>";
    }
    return h;
  }

  /* 状态按钮 */
  function statusButton(v, label, current, isNew) {
    const active = isNew ? (v === "idle") : (current === v);
    return '<button type="button" data-v="' + v + '" class="' + (active ? "active" : "") + '">' + label + "</button>";
  }

  /* ---------- 详情页 ---------- */
  function renderDetail(id) {
    const it = allItems.find((x) => x.id === id);
    if (!it) { location.hash = "#/"; return; }
    topbarTitle.textContent = "宝贝档案";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    const hero = it.photos && it.photos[0]
      ? '<img src="' + photoUrl(it.photos[0]) + '" alt="">'
      : '<div class="placeholder">📿</div>';
    const days = DB.formatDays(DB.daysWith(it));
    const tags =
      (it.gifted ? '<span class="tag r">已送人</span>' : '<span class="tag g">在库</span>') +
      (it.played ? '<span class="tag yl">盘玩中</span>' : '<span class="tag">未盘玩</span>') +
      (it.craft ? '<span class="tag">' + esc(it.craft) + "</span>" : "") +
      (it.category ? '<span class="tag">' + esc(it.category) + "</span>" : "");

    let html = "";
    html += '<div class="detail-hero" data-view="0">' + hero + "</div>";

    html += '<div class="detail-body">';
    html += '<div class="detail-name">' + esc(it.name || "未命名") + "</div>";
    if (it.species) html += '<div style="color:#8a7a68;font-size:14px;margin-top:3px">' + esc(it.species) + "</div>";
    html += '<div class="detail-tags">' + tags + "</div>";

    html += '<div class="section-title">基本信息</div>';
    html += '<div class="detail-grid">';
    html += infoItem("到货时间", fmtDate(it.arrivedAt));
    html += infoItem("陪伴时长", days);
    const dSizeField = Categories.getSizeField(it.category || "");
    if (dSizeField === "pieces") html += infoItem("拼图片数", it.pieceCount ? it.pieceCount + " 片" : "—");
    else if (dSizeField === "bead") html += infoItem("珠子大小", it.beadSize ? it.beadSize + " mm" : "—");
    else if (it.accessoryType) html += infoItem("周边类型", esc(it.accessoryType));
    html += infoItem("工艺", it.craft || "—");
    html += infoItem("入手价格", it.price != null && it.price !== "" ? "¥" + esc(String(it.price)) : "—");
    html += infoItem("购买店铺", esc(it.shop || "—"), true);
    if (it.gifted && it.giftedAt) html += infoItem("送人时间", fmtDate(it.giftedAt), true);
    if (it.finishedAt) html += infoItem("拼图完成", fmtDate(it.finishedAt), true);
    html += "</div>";

    if (it.playedNote) {
      html += '<div class="section-title">盘玩记录</div>';
      html += '<div class="detail-grid"><div class="info-item full"><div class="v note">' + esc(it.playedNote) + "</div></div></div>";
    }
    if (it.note) {
      html += '<div class="section-title">备注</div>';
      html += '<div class="detail-grid"><div class="info-item full"><div class="v note">' + esc(it.note) + "</div></div></div>";
    }

    const allPics = (it.photos || []).concat(it.screenshots || []);
    if (allPics.length) {
      html += '<div class="section-title">图片与订单截图</div>';
      html += '<div class="photo-strip">';
      allPics.forEach((p, idx) => {
        html += '<img src="' + photoUrl(p) + '" data-view="' + idx + '" alt="">';
      });
      html += "</div>";
    }

    html += '<button class="btn ghost" id="btnTips" style="width:100%;margin-top:14px">📖 养护小知识</button>';
    html += '<div class="detail-actions">';
    html += '<button class="btn ghost" id="btnShare">分享海报</button>';
    html += '<button class="btn primary" id="btnEdit">编辑</button>';
    html += '<button class="btn danger" id="btnDel">删除</button>';
    html += "</div></div>";

    view.innerHTML = html;

    const openViewer = (idx) => {
      if (!allPics.length) return;
      const viewer = $("#viewer");
      viewer.classList.add("show");
      const show = (i) => {
        $("#viewerImg").src = photoUrl(allPics[i]);
        $("#viewerNav").innerHTML = allPics.map((_, k) =>
          '<button data-i="' + k + '"' + (k === i ? ' style="background:var(--gold)"' : "") + ">" + (k + 1) + "</button>").join("");
        viewer._i = i;
      };
      show(idx);
      $("#viewerNav").querySelectorAll("button").forEach((b) => b.onclick = () => show(+b.dataset.i));
    };
    view.querySelectorAll("[data-view]").forEach((el) => el.addEventListener("click", () => openViewer(+el.dataset.view)));
    $("#viewerClose").onclick = () => { $("#viewer").classList.remove("show"); };

    $("#btnTips").onclick = () => showTipsModal(it);
    $("#btnEdit").onclick = () => location.hash = "#/edit/" + it.id;
    $("#btnDel").onclick = async () => {
      const ok = await confirmModal("删除这件宝贝？", "删除后不可恢复，请确认。", "删除", true);
      if (ok) { await DB.remove(it.id); await loadItems(); toast("已删除"); location.hash = "#/"; }
    };
    $("#btnShare").onclick = async () => {
      const btn = $("#btnShare");
      btn.textContent = "生成中…";
      btn.disabled = true;
      try {
        const canvas = await Poster.singlePoster(it, { username: user && user.displayName ? user.displayName : "" });
        const result = await Poster.shareCanvas(canvas, "我的收藏馆_" + (it.name || "分享") + ".jpg");
        toast(result === "shared" ? "已分享" : "海报已保存到相册/下载");
      } catch (err) {
        toast("海报生成失败：" + err.message);
      } finally {
        btn.textContent = "分享";
        btn.disabled = false;
      }
    };
  }

  function infoItem(k, v, full) {
    return '<div class="info-item' + (full ? " full" : "") + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + "</div></div>";
  }

  async function shareItem(it) {
    try {
      const text = "📿 " + (it.name || "我的宝贝") + (it.species ? " · " + it.species : "") +
        "\n陪伴时长：" + DB.formatDays(DB.daysWith(it)) +
        "\n到货时间：" + fmtDate(it.arrivedAt) +
        (it.craft ? "\n工艺：" + it.craft : "") +
        (it.shop ? "\n店铺：" + it.shop : "") +
        (it.price != null && it.price !== "" ? "\n价格：¥" + it.price : "") +
        (it.gifted ? "\n状态：已送人" : "\n状态：在库") +
        (it.played ? "\n状态：盘玩中" : "");
      if (navigator.share) {
        await navigator.share({ title: it.name || "我的宝贝", text });
      } else {
        await navigator.clipboard.writeText(text);
        toast("文案已复制到剪贴板");
      }
    } catch (e) { /* 用户取消 */ }
  }

  /* ---------- 表单页 ---------- */
  function renderForm(id) {
    const it = id ? allItems.find((x) => x.id === id) : null;
    const isEdit = !!it;
    topbarTitle.textContent = isEdit ? "编辑宝贝" : "添加宝贝";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    const d = isEdit && it.arrivedAt ? new Date(it.arrivedAt) : new Date();
    const dateVal = isEdit && it.arrivedAt ? fmtDateInput(it.arrivedAt) : "";

    let html = "";
    html += '<div class="form">';

    html += '<div class="form-group"><div class="form-label">串的名字 <small>给它起个好听的名字</small></div>' +
      '<input class="form-input" id="fName" placeholder="如：星月菩提·老念珠" value="' + esc(it ? it.name : "") + '"></div>';

    // 分类 + 品种/材质（分类联动）
    const editCat = it ? (it.category || "") : "";
    const catCfg = Categories.getCategoryConfig(editCat);
    const speciesLabel = catCfg.label || "品种/材质";
    const isPuzzle = Categories.isPuzzleCategory(editCat);

    html += '<div class="form-row">';
    html += '<div class="form-group"><div class="form-label">分类</div>' +
      '<select class="form-select" id="fCategory">' + categoryOptions(editCat) + '</select></div>';
    html += '<div class="form-group"><div class="form-label" id="fSpeciesLabel">' + speciesLabel + '</div>' +
      '<input class="form-input" id="fSpecies" list="speciesList" placeholder="可自由填写" value="' + esc(it ? it.species : "") + '">' +
      '<datalist id="speciesList"></datalist></div>';
    html += "</div>";

    html += '<div class="form-group" id="fCraftWrap"><div class="form-label">工艺 <small>珠子类</small></div>' +
      '<div class="seg" id="fCraft">' +
      '<button type="button" data-v="干磨" class="' + (!it || it.craft === "干磨" ? "active" : "") + '">干磨</button>' +
      '<button type="button" data-v="水磨" class="' + (it && it.craft === "水磨" ? "active" : "") + '">水磨</button>' +
      '<button type="button" data-v="" class="' + (it && it.craft && it.craft !== "干磨" && it.craft !== "水磨" ? "active" : "") + '">其他</button>' +
      "</div></div>";

    // 拼图完成时间（仅拼图分类显示）
    html += '<div class="form-group" id="fFinishedWrap"' + (isPuzzle ? "" : ' style="display:none"') + '><div class="form-label">拼图完成时间</div>' +
      '<input class="form-input" id="fFinished" type="date" value="' + (it && it.finishedAt ? fmtDateInput(it.finishedAt) : "") + '"></div>';

    html += '<div class="form-row">';
    html += '<div class="form-group"><div class="form-label">到货时间</div>' +
      '<input class="form-input" id="fDate" type="date" value="' + dateVal + '"></div>';
    html += '<div class="form-group"><div class="form-label">入手价格 <small>元</small></div>' +
      '<input class="form-input" id="fPrice" type="number" inputmode="decimal" placeholder="如 1280" value="' + esc(it && it.price != null ? it.price : "") + '"></div>';
    html += "</div>";

    // 尺寸字段（按分类联动：珠子大小 / 拼图片数 / 无）
    const curSizeField = Categories.getSizeField(editCat);
    html += '<div class="form-group" id="fSizeWrap"' + (curSizeField === "none" ? ' style="display:none"' : "") + '>' +
      '<div class="form-label" id="fSizeLabel">' + (curSizeField === "pieces" ? "拼图片数" : "珠子大小（卡数）") + " <small>" + (curSizeField === "pieces" ? "片" : "mm") + '</small></div>' +
      '<select class="form-select" id="fSize">' + (curSizeField === "pieces" ? pieceOptions(it && it.pieceCount) : beadSizeOptions(it && it.beadSize)) + '</select></div>';

    html += '<div class="form-group"><div class="form-label">在哪家店买的</div>' +
      '<input class="form-input" id="fShop" placeholder="店铺名 / 平台" value="' + esc(it ? it.shop : "") + '"></div>';

    // 状态（按分类联动：拼图→待拼/已拼，珠子→待盘玩/在盘玩）
    const curStatus = it ? (it.playStatus || "") : "";
    const giftStatus = it && it.gifted ? "gifted" : "";

    html += '<div class="form-group"><div class="form-label">状态</div>' +
      '<div class="seg" id="fStatus">' +
      statusButton("idle", "待盘玩", curStatus, !it) +
      statusButton("playing", "在盘玩", curStatus) +
      statusButton("puzzle_pending", "待拼", curStatus) +
      statusButton("puzzle_done", "已拼", curStatus) +
      statusButton("gifted", "已送人", curStatus || giftStatus) +
      "</div></div>";

    html += '<div class="form-group" id="giftedWrap"' + ((curStatus === "gifted" || giftStatus === "gifted") ? "" : ' style="display:none"') + '><div class="form-label">送人时间</div>' +
      '<input class="form-input" id="fGiftedDate" type="date" value="' + (it && it.giftedAt ? fmtDateInput(it.giftedAt) : "") + '"></div>';

    html += '<div class="form-group" id="playedNoteWrap"><div class="form-label">盘玩记录 <small>可选</small></div>' +
      '<textarea class="form-textarea" id="fPlayedNote" placeholder="盘了多久、上色情况、手感变化…">' + esc(it ? it.playedNote : "") + "</textarea></div>";

    html += '<div class="form-group"><div class="form-label">备注</div>' +
      '<textarea class="form-textarea" id="fNote" placeholder="来历、故事、心情…">' + esc(it ? it.note : "") + "</textarea></div>";

    html += '<div class="form-group"><div class="form-label">宝贝照片</div>' +
      '<div class="upload-grid" id="photoGrid"></div>' +
      '<input type="file" id="photoInput" accept="image/*" multiple hidden></div>';

    html += '<div class="form-group"><div class="form-label">订单截图 <small>可选，上传后可自动识别</small></div>' +
      '<div class="upload-grid" id="shotGrid"></div>' +
      '<div class="ocr-loading" id="shotOcrLoading"><div class="spinner"></div><span>正在识别订单截图…</span></div>' +
      '<div class="ocr-hint" id="ocrHint"></div>' +
      '<input type="file" id="shotInput" accept="image/*" multiple hidden></div>';

    html += '<button class="btn primary" id="btnSave" style="width:100%;margin-top:6px">保存</button>';
    html += "</div>";

    view.innerHTML = html;

    view.querySelectorAll("#fCraft button").forEach((b) => b.onclick = () => {
      view.querySelectorAll("#fCraft button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    });

    // 分类联动：更新品种选项/标签/工艺显隐/拼图完成时间
    const fCat = $("#fCategory");
    function refreshSpeciesByCategory() {
      const cat = fCat.value;
      const cfg = Categories.getCategoryConfig(cat);
      const labelEl = $("#fSpeciesLabel");
      if (labelEl) labelEl.textContent = cfg.label || "品种/材质";
      const spEl = $("#fSpecies");
      if (spEl) {
        spEl.setAttribute("placeholder", "可自由填写" + (cfg.options.length ? "（如：" + cfg.options.slice(0, 3).join("/") + "…）" : ""));
        const dl = $("#speciesList");
        if (dl) dl.innerHTML = cfg.options.map((s) => '<option value="' + esc(s) + '">').join("");
      }
      const isPuzzle = Categories.isPuzzleCategory(cat);
      const isBead = !Categories.isBrandCategory(cat) && !isPuzzle;
      const cw = $("#fCraftWrap");
      if (cw) cw.style.display = isBead ? "" : "none";
      // 尺寸字段：bead→珠子大小 / pieces→拼图片数 / none→隐藏
      const sizeField = Categories.getSizeField(cat);
      const sizeWrap = $("#fSizeWrap");
      if (sizeWrap) {
        sizeWrap.style.display = sizeField === "none" ? "none" : "";
        const sizeLbl = $("#fSizeLabel");
        if (sizeLbl) {
          sizeLbl.innerHTML = (sizeField === "pieces" ? "拼图片数" : "珠子大小（卡数）") + " <small>" + (sizeField === "pieces" ? "片" : "mm") + "</small>";
        }
        const sizeSel = $("#fSize");
        if (sizeSel) {
          const curVal = sizeSel.value;
          const defVal = sizeField === "pieces" ? 1000 : 14;
          sizeSel.innerHTML = sizeField === "pieces" ? pieceOptions(curVal || null) : beadSizeOptions(curVal || null);
          if (!curVal) sizeSel.value = defVal;
        }
      }
      const fw = $("#fFinishedWrap");
      if (fw) {
        fw.style.display = isPuzzle ? "" : "none";
        if (!isPuzzle) { const fi = $("#fFinished"); if (fi) fi.value = ""; }
      }
      // 状态按钮按分类显隐
      const st = $("#fStatus");
      if (st) {
        st.querySelectorAll("button").forEach((b) => {
          const v = b.dataset.v;
          let show = true;
          if (v === "puzzle_pending" || v === "puzzle_done") show = isPuzzle;
          if (v === "idle" || v === "playing") show = !isPuzzle && isBead;
          b.style.display = show ? "" : "none";
        });
        // 如果当前选中项被隐藏，自动切到第一个可见项
        const activeBtn = st.querySelector("button.active");
        if (activeBtn && activeBtn.style.display === "none") {
          const firstVisible = st.querySelector("button:not([style*='display: none'])");
          if (firstVisible) {
            st.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
            firstVisible.classList.add("active");
          }
        }
      }
    }
    if (fCat) {
      fCat.addEventListener("change", refreshSpeciesByCategory);
      refreshSpeciesByCategory();
    }

    // 状态按钮交互：显示/隐藏送人时间
    const fStatus = $("#fStatus");
    if (fStatus) {
      fStatus.querySelectorAll("button").forEach((b) => b.onclick = () => {
        fStatus.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        const gw = $("#giftedWrap");
        if (gw) gw.style.display = b.dataset.v === "gifted" ? "" : "none";
      });
    }


    if (!(it && it.played)) $("#playedNoteWrap").style.display = "none";

    const photos = (it ? (it.photos || []) : []).map((p) => ({ ...p }));
    const shots = (it ? (it.screenshots || []) : []).map((p) => ({ ...p }));

    function renderUploadGrid(gridId, list, onPick, isShot) {
      const grid = $(gridId);
      let html = "";
      list.forEach((p, i) => {
        const src = photoUrl(p);
        html += '<div class="upload-cell has">' + (src ? '<img src="' + src + '" alt="">' : '<div class="placeholder">📷</div>') +
          '<button type="button" class="upload-del" data-i="' + i + '">✕</button></div>';
      });
      if (list.length < 9) {
        html += '<label class="upload-cell upload-add" style="cursor:pointer"><span class="plus">＋</span><span>' + (isShot ? "截图" : "照片") + "</span></label>";
      }
      grid.innerHTML = html;
      grid.querySelectorAll(".upload-del").forEach((b) => b.onclick = () => {
        list.splice(+b.dataset.i, 1);
        renderUploadGrid(gridId, list, onPick, isShot);
      });
      const add = grid.querySelector("label.upload-add");
      if (add) add.onclick = (e) => { e.preventDefault(); onPick(); };
    }

    $("#photoInput").onchange = async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      for (const f of files) {
        try {
          const cf = await ImageUtil.compressFile(f, { maxSizeKB: 500, maxDim: 1920 });
          photos.push(DB.fileToPhoto(cf));
        } catch (err) {
          photos.push(DB.fileToPhoto(f));
        }
      }
      renderUploadGrid("#photoGrid", photos, () => $("#photoInput").click(), false);
    };
    $("#shotInput").onchange = async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      for (const f of files) {
        try {
          const cf = await ImageUtil.compressFile(f, { maxSizeKB: 500, maxDim: 2000 });
          shots.push(DB.fileToPhoto(cf));
        } catch (err) {
          shots.push(DB.fileToPhoto(f));
        }
      }
      renderUploadGrid("#shotGrid", shots, () => $("#shotInput").click(), true);
      if (files.length) runOcrOnShot(files[0]);
    };
    renderUploadGrid("#photoGrid", photos, () => $("#photoInput").click(), false);
    renderUploadGrid("#shotGrid", shots, () => $("#shotInput").click(), true);

    async function runOcrOnShot(file) {
      const hint = $("#ocrHint");
      const loading = $("#shotOcrLoading");
      hint.classList.remove("show");
      loading.classList.add("show");
      try {
        const text = await OCR.recognize(file, (p) => {
          loading.querySelector("span").textContent = "正在识别订单截图… " + Math.round(p * 100) + "%";
        });
        const orders = OCR.parseOrders(text);

        // 多订单 → 批量创建
        if (orders.length > 1) {
          const items = orders.map((o) => ({
            name: o.name || "",
            species: "",
            craft: "",
            arrivedAt: o.date ? new Date(o.date + "T12:00:00").getTime() : null,
            price: o.price,
            shop: o.shop || "",
            gifted: false, giftedAt: null,
            played: false, playedNote: "",
            note: "",
            photos: [], screenshots: [{ ...DB.fileToPhoto(file) }],
          }));
          enterBatchMode(items, "从截图识别到 " + orders.length + " 个订单，请核对后批量保存");
          return;
        }

        // 单订单 → 填入当前表单
        const parsed = orders[0] || { shop: "", price: null, date: "", name: "" };
        const filled = [];
        if (parsed.shop && !$("#fShop").value) { $("#fShop").value = parsed.shop; filled.push("店铺：" + parsed.shop); }
        if (parsed.price != null && !$("#fPrice").value) { $("#fPrice").value = parsed.price; filled.push("价格：¥" + parsed.price); }
        if (parsed.date && !$("#fDate").value) { $("#fDate").value = parsed.date; filled.push("时间：" + parsed.date); }
        if (parsed.name && !$("#fName").value) { $("#fName").value = parsed.name; filled.push("名称：" + parsed.name); }
        if (filled.length) {
          hint.textContent = "✅ 自动识别成功：" + filled.join("；") + "（请核对后保存）";
        } else {
          hint.textContent = "⚠️ 未能从截图中识别出有效信息，请手动填写。";
        }
        hint.classList.add("show");
      } catch (err) {
        hint.textContent = "❌ 识别失败：" + err.message;
        hint.classList.add("show");
      } finally {
        loading.classList.remove("show");
        loading.querySelector("span").textContent = "正在识别订单截图…";
      }
    }

    $("#btnSave").onclick = async () => {
      const saveBtn = $("#btnSave");
      saveBtn.textContent = "正在保存…";
      saveBtn.disabled = true;
      try {
        const item = it ? { ...it } : { photos: [], screenshots: [], createdAt: Date.now() };
        item.name = $("#fName").value.trim();
        item.species = $("#fSpecies").value.trim();
        item.craft = view.querySelector("#fCraft button.active").dataset.v;
        const dv = $("#fDate").value;
        item.arrivedAt = dv ? new Date(dv + "T12:00:00").getTime() : null;
        const pv = parseFloat($("#fPrice").value);
        item.price = isNaN(pv) ? null : pv;
        item.shop = $("#fShop").value.trim();
        const sizeField = Categories.getSizeField(item.category);
        const sv = $("#fSize").value;
        if (sizeField === "pieces") {
          item.pieceCount = sv ? parseFloat(sv) : null;
          item.beadSize = null;
        } else if (sizeField === "bead") {
          item.beadSize = sv ? parseFloat(sv) : null;
          item.pieceCount = null;
        } else {
          item.beadSize = null;
          item.pieceCount = null;
        }
        item.accessoryType = item.category === "动漫周边" ? item.species : "";
        item.category = $("#fCategory").value.trim();
        const statusVal = view.querySelector("#fStatus button.active").dataset.v;
        item.playStatus = statusVal === "gifted" ? "" : statusVal;
        item.gifted = statusVal === "gifted";
        const gdv = $("#fGiftedDate").value;
        if (item.gifted) {
          item.giftedAt = gdv ? new Date(gdv + "T12:00:00").getTime() : (item.giftedAt || Date.now());
        } else {
          item.giftedAt = null;
        }
        item.played = statusVal === "playing";
        item.playedNote = $("#fPlayedNote").value.trim();
        item.note = $("#fNote").value.trim();

        if (!item.name) { toast("请给宝贝起个名字"); return; }

        // 上传新照片到云端
        item.photos = [];
        for (const p of photos) {
          if (p.url) { item.photos.push(p); continue; }
          if (p.data) { item.photos.push(await DB.uploadPhoto(p.data, "photos")); }
        }
        item.screenshots = [];
        for (const p of shots) {
          if (p.url) { item.screenshots.push(p); continue; }
          if (p.data) { item.screenshots.push(await DB.uploadPhoto(p.data, "screenshots")); }
        }

        await DB.put(item);
        await loadItems();
        toast(isEdit ? "已保存修改" : "已收入收藏馆 🎉");
        location.hash = "#/item/" + item.id;
      } catch (err) {
        toast("保存失败：" + translateAuthError(err.message));
      } finally {
        saveBtn.textContent = "保存";
        saveBtn.disabled = false;
      }
    };
  }

  /* ---------- 设置页 ---------- */
  function renderSettings() {
    topbarTitle.textContent = "设置";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    const inStock = allItems.filter((i) => !i.gifted).length;
    const gifted = allItems.filter((i) => i.gifted).length;
    const played = allItems.filter((i) => i.played).length;

    // 称号/徽章数据
    const lvGame = Game.getLevel(Game.computeXp(allItems).xp);
    const allAch = Stats.getAchievements(allItems);
    const badgeIds = getBadgeIds();
    const badgeAch = [];
    const unlockedList = [];
    allAch.forEach((g) => g.items.forEach((a) => { if (a.unlocked) unlockedList.push(a); }));
    badgeIds.forEach((id) => {
      const found = unlockedList.find((a) => a.id === id);
      if (found) badgeAch.push(found);
    });

    let html = "";
    // ===== 1. 用户昵称（可编辑） =====
    html += '<div class="profile-card">' +
      '<div class="profile-avatar">' + lvGame.icon + "</div>" +
      '<div class="profile-info">' +
      '<div class="profile-name">' + esc(user && user.displayName ? user.displayName : "未设置昵称") + "</div>" +
      '<div class="profile-mail">' + esc(user ? user.email : "") + "</div>" +
      '<button class="btn ghost" id="btnProfile" style="margin-top:6px;padding:6px 12px;font-size:12px;flex:none">✏️ 修改昵称</button>' +
      "</div></div>";

    // ===== 2. 自选称号（展示 + 删除） =====
    html += '<div class="section-title">🎖️ 我的称号</div>';
    html += '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px">';
    html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:8px">展示中的称号（点击 ✕ 移除）</div>';
    html += '<div id="myBadges" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px"></div>';
    html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:6px">🏆 称号库（已解锁的，点击选择/取消）</div>';
    html += '<div id="badgeLibrary" style="display:flex;flex-wrap:wrap;gap:8px;max-height:220px;overflow-y:auto"></div>';
    html += "</div>";

    // ===== 3. 外观主题 =====
    html += '<div class="section-title">🎨 外观主题 <small style="color:var(--text-2);font-weight:400;font-size:11px">← 左右滑动查看 →</small></div>';
    html += '<div class="theme-strip" id="themeList">';
    THEMES.forEach((t) => {
      const active = getTheme() === t.id;
      html += '<button type="button" class="theme-opt' + (active ? " active" : "") + '" data-theme="' + t.id + '" title="' + t.name + '">' +
        '<span class="theme-dot" style="background:' + themeDotColor(t.id) + '"></span>' +
        '<span class="theme-icon">' + t.icon + "</span>" +
        '<span class="theme-name">' + t.name + "</span></button>";
    });
    html += "</div>";

    // ===== 4. 收藏盒子管理 =====
    html += '<div class="section-title">收藏盒子管理</div>';
    html += '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px">';
    html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:8px">自定义收藏盒子（菩提 / 水晶 / 玉石 / 拼图 / 动漫周边…）</div>';
    html += '<div id="catList" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px"></div>';
    html += '<div style="display:flex;gap:8px">' +
      '<input class="form-input" id="catInput" placeholder="新增盒子，如：盲盒" style="flex:1;padding:9px 10px;font-size:14px">' +
      '<button class="btn primary" id="catAdd" style="flex:none;padding:9px 16px;font-size:14px">添加</button></div>';

    // 内置分类库（可一键恢复已删的内置分类）
    html += '<div style="font-size:12px;color:var(--text-2);margin:10px 0 6px">🧰 内置收藏盒子（删除了可以点回来）</div>';
    html += '<div id="builtinCatList" style="display:flex;flex-wrap:wrap;gap:8px"></div>';
    html += "</div>";

    // ===== 4. 数据与账户 =====
    html += '<div class="section-title">数据与账户</div>';
    html += '<div class="settings-list">';
    html += '<button class="setting-item" id="btnExport"><div><div class="t">📤 导出备份</div><div class="d">下载全部数据为备份文件（含图片链接）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnImport"><div><div class="t">📥 导入备份</div><div class="d">从备份文件恢复数据（会覆盖当前数据）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnClear"><div><div class="t">🗑 清空全部数据</div><div class="d">删除所有收藏记录（不可恢复）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnLogout"><div><div class="t">🚪 退出登录</div><div class="d">退出后本机不再保留登录状态</div></div><span class="arrow">›</span></button>';
    html += "</div>";


    html += '<p style="text-align:center;font-size:11px;color:#b0a290;margin-top:22px;line-height:1.8">数据存储于云端（Supabase）<br>登录同一账号即可在任何设备查看</p>';

    view.innerHTML = html;

    const bp = $("#btnProfile");
    if (bp) bp.onclick = () => location.hash = "#/profile";

    // ===== 称号展示与称号库 =====
    function badgeName(a) {
      return a && a.tierResolved && a.tierResolved.current ? a.tierResolved.current.name : (a ? a.name : "");
    }
    function badgeIcon(a) {
      return a && a.tierResolved && a.tierResolved.current ? a.tierResolved.current.icon : (a ? a.icon : "");
    }
    function renderMyBadges() {
      const box = $("#myBadges");
      if (!box) return;
      const ids = getBadgeIds();
      const shown = [];
      ids.forEach((id) => {
        const f = unlockedList.find((a) => a.id === id);
        if (f) shown.push(f);
      });
      box.innerHTML = shown.length
        ? shown.map((a) =>
            '<span class="my-badge"><span>' + badgeIcon(a) + " " + esc(badgeName(a)) + '</span>' +
            '<button type="button" data-rm="' + a.id + '" class="my-badge-del">✕</button></span>'
          ).join("")
        : '<span style="font-size:12px;color:var(--text-2);font-style:italic">还没有展示称号，从下面称号库选择吧</span>';
      box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => {
        const ids2 = getBadgeIds().filter((x) => x !== b.dataset.rm);
        saveBadgeIds(ids2);
        renderMyBadges();
        renderBadgeLibrary();
        toast("已移除称号");
      });
    }
    function renderBadgeLibrary() {
      const box = $("#badgeLibrary");
      if (!box) return;
      const ids = getBadgeIds();
      box.innerHTML = unlockedList.length
        ? unlockedList.map((a) => {
            const on = ids.includes(a.id);
            return '<button type="button" class="lib-badge' + (on ? " on" : "") + '" data-tg="' + a.id + '">' +
              badgeIcon(a) + " " + esc(badgeName(a)) + "</button>";
          }).join("")
        : '<span style="font-size:12px;color:var(--text-2)">还没有解锁成就，去收藏吧！</span>';
      box.querySelectorAll("[data-tg]").forEach((b) => b.onclick = () => {
        const id = b.dataset.tg;
        let ids2 = getBadgeIds();
        if (ids2.includes(id)) { ids2 = ids2.filter((x) => x !== id); }
        else { if (ids2.length >= 6) { toast("最多展示 6 个称号"); return; } ids2.push(id); }
        saveBadgeIds(ids2);
        renderMyBadges();
        renderBadgeLibrary();
      });
    }
    renderMyBadges();
    renderBadgeLibrary();

    // 主题选择
    document.querySelectorAll("#themeList .theme-opt").forEach((b) => b.onclick = () => {
      applyTheme(b.dataset.theme);
      document.querySelectorAll("#themeList .theme-opt").forEach((x) => x.classList.toggle("active", x === b));
      toast("已切换主题");
    });
    // 电脑鼠标滚轮 → 横向滚动
    const themeStrip = document.querySelector("#themeList");
    if (themeStrip) {
      themeStrip.addEventListener("wheel", (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          themeStrip.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    $("#btnExport").onclick = async () => {
      const json = await DB.exportBackup();
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "我的收藏馆备份_" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      toast("备份已导出");
    };
    $("#btnImport").onclick = () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const ok = await confirmModal("导入备份？", "导入会覆盖当前全部数据，建议先导出当前备份。", "导入");
        if (!ok) return;
        try {
          const text = await f.text();
          const n = await DB.importBackup(text);
          await loadItems();
          toast("导入成功，共 " + n + " 条");
          renderSettings();
        } catch (err) {
          toast("导入失败：" + err.message);
        }
      };
      inp.click();
    };
    $("#btnClear").onclick = async () => {
      const ok = await confirmModal("清空全部数据？", "所有收藏将被永久删除，无法恢复！", "清空", true);
      if (!ok) return;
      const items = await DB.getAll();
      for (const it of items) await DB.remove(it.id);
      await loadItems();
      toast("已清空");
      location.hash = "#/";
    };
    // 分类管理渲染
    function renderCatList() {
      const box = $("#catList");
      if (!box) return;
      const cats = getCategories();
      box.innerHTML = cats.map((c, i) =>
        '<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:4px 8px 4px 12px;font-size:13px">' + esc(c) +
        '<button type="button" data-i="' + i + '" style="width:18px;height:18px;border-radius:50%;background:#fbe9e7;color:var(--red);font-size:11px;display:flex;align-items:center;justify-content:center">✕</button></span>'
      ).join("");
      box.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => {
        const cats2 = getCategories();
        cats2.splice(+b.dataset.i, 1);
        saveCategories(cats2);
        renderCatList();
        renderSettings();
      });
    }
    renderCatList();

    // 内置分类库：显示所有内置分类，未添加的显示"添加"按钮
    function renderBuiltinCats() {
      const box = $("#builtinCatList");
      if (!box) return;
      const cur = getCategories();
      const builtin = ["菩提", "水晶", "玉石", "拼图", "动漫周边", "盲盒"];
      box.innerHTML = builtin.map((c) => {
        const added = cur.includes(c);
        return '<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:4px 8px 4px 12px;font-size:13px">' + esc(c) +
          (added ? '<span style="color:var(--green);font-size:11px">✓</span>' :
            '<button type="button" data-add="' + esc(c) + '" style="background:var(--wood);color:#f5f0e8;border-radius:12px;padding:2px 8px;font-size:11px">＋ 添加</button>') +
          "</span>";
      }).join("");
      box.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
        const c = b.dataset.add;
        const cats = getCategories();
        if (!cats.includes(c)) { saveCategories(cats.concat([c])); }
        renderBuiltinCats();
        renderCatList();
        renderSettings();
        toast("已添加内置盒子：" + c);
      });
    }
    renderBuiltinCats();
    $("#catAdd").onclick = () => {
      const v = $("#catInput").value.trim();
      if (!v) { toast("请输入盒子名"); return; }
      const cats = getCategories();
      if (cats.includes(v)) { toast("盒子已存在"); return; }
      saveCategories(cats.concat([v]));
      $("#catInput").value = "";
      renderCatList();
      toast("已添加盒子：" + v);
    };
    $("#catInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#catAdd").click(); });
    $("#btnLogout").onclick = async () => {
      const ok = await confirmModal("退出登录？", "退出后本机需要重新登录才能查看。", "退出");
      if (!ok) return;
      await DB.signOut();
      location.hash = "#/auth";
      renderAuth();
    };
  }

  /* ---------- 路由 ---------- */
  function router() {
    const h = location.hash || "#/";
    if (h === "#/auth") {
      if (user) { location.hash = "#/"; return; }  // 已登录访问登录页 → 回首页
      renderAuth(); return;
    }
    if (!user) { renderAuth(); return; }
    if (h === "#/profile") { renderProfile(); return; }
    if (h === "#/cat") { renderCatPage(); return; }
    if (h === "#/stats") { renderStatsPage(); return; }
    if (h === "#/quest") { renderQuestPage(); return; }
    if (h.startsWith("#/box/")) {
      const box = decodeURIComponent(h.slice(6));
      renderBoxPage(box);
      return;
    }
    if (h === "#/" || h === "#") { renderHome(); }
    else if (h.startsWith("#/item/")) { renderDetail(h.slice(7)); }
    else if (h.startsWith("#/edit/")) { renderForm(h.slice(7)); }
    else if (h === "#/new") { renderForm(null); }
    else if (h === "#/settings") { renderSettings(); }
    else { renderHome(); }
    updateTabbar();
    window.scrollTo(0, 0);
  }

  /* ---------- 升级弹窗 ---------- */
  function checkLevelUp() {
    try {
      const game = Game.computeXp(allItems);
      const lv = Game.getLevel(game.xp);
      const prev = parseInt(localStorage.getItem("ww_level") || "0", 10);
      if (prev > 0 && lv.level > prev) {
        // 升级！弹出特效
        showLevelUpModal(lv);
      }
      localStorage.setItem("ww_level", String(lv.level));
    } catch (e) { /* 忽略 */ }
  }

  function showLevelUpModal(lv) {
    const mask = $("#modalMask");
    const modal = $("#modal");
    modal.innerHTML =
      '<div class="levelup">' +
      '<div class="levelup-burst">✨</div>' +
      '<div class="levelup-icon">' + lv.icon + "</div>" +
      '<div class="levelup-title">升 级 了！</div>' +
      '<div class="levelup-sub">Lv.' + lv.level + " · " + esc(lv.name) + "</div>" +
      '<div class="levelup-desc">你的收藏馆升到了新高度</div>' +
      '<button class="btn primary" id="mOkLv" style="width:100%;margin-top:14px">好耶！</button>' +
      "</div>";
    mask.hidden = false;
    modal.hidden = false;
    $("#mOkLv").onclick = () => { mask.hidden = true; modal.hidden = true; };
    mask.onclick = () => { mask.hidden = true; modal.hidden = true; };
  }

  /* ---------- 启动 ---------- */
  function goBack() {
    const h = location.hash;
    if (h.startsWith("#/item/")) { location.hash = "#/"; return; }         // 详情 → 首页
    if (h.startsWith("#/edit/")) {
      const id = h.slice(7);
      location.hash = id ? "#/item/" + id : "#/";                            // 编辑 → 详情/首页
      return;
    }
    if (h === "#/settings" || h === "#/profile" || h === "#/new" || h === "#/cat" || h === "#/stats" || h === "#/quest") { location.hash = "#/"; return; }
    if (h.startsWith("#/box/")) { location.hash = "#/cat"; return; }
    if (h === "#/") { return; }
    history.back();
  }
  btnBack.onclick = goBack;
  btnSettings.onclick = () => location.hash = "#/settings";
  window.addEventListener("hashchange", router);

  /* 底部导航 */
  const tabbar = $("#tabbar");
  function updateTabbar() {
    if (!tabbar) return;
    const h = location.hash;
    let active = "home";
    if (h === "#/settings") active = "settings";
    else if (h === "#/cat") active = "cat";
    else if (h === "#/stats") active = "stats";
    tabbar.querySelectorAll(".tab-item").forEach((t) => {
      const tab = t.dataset.tab;
      if (tab === "add") return;
      t.classList.toggle("active", tab === active);
    });
  }
  tabbar.querySelectorAll(".tab-item").forEach((t) => {
    t.addEventListener("click", () => {
      const tab = t.dataset.tab;
      if (tab === "home") location.hash = "#/";
      else if (tab === "cat") location.hash = "#/cat";
      else if (tab === "stats") location.hash = "#/stats";
      else if (tab === "settings") location.hash = "#/settings";
      else if (tab === "add") location.hash = "#/new";
    });
  });

  async function init() {
    try {
      initTheme();
      // 检查 Supabase 是否已配置
      const cfg = window.SUPABASE_CONFIG || {};
      if (!cfg.url || cfg.url.indexOf("PASTE_") === 0) {
        view.innerHTML = '<div class="empty"><div class="empty-icon">🔧</div>' +
          "<p>应用尚未配置云端服务<br>请在 js/config.js 中填写 Supabase URL 和 Key</p></div>";
        topbarTitle.textContent = "我的收藏馆";
        return;
      }
      const ok = await enterApp();
      if (ok) {
        if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
          navigator.serviceWorker.register("sw.js").then((reg) => {
            // 检测到新 SW 等待激活时，立即跳过等待并刷新页面
            reg.addEventListener("updatefound", () => {
              const newWorker = reg.installing;
              if (!newWorker) return;
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  newWorker.postMessage({ type: "SKIP_WAITING" });
                  setTimeout(() => location.reload(), 300);
                }
              });
            });
          }).catch(() => {});
        }
      }
    } catch (err) {
      view.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>初始化失败：' + esc(err.message) + "</p></div>";
    }
  }

  init();
})();