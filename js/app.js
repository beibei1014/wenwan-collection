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
  let playDays = [];   // 盘玩打卡日期数组（YYYY-MM-DD），用于连续打卡
  let filter = "all";        // 兼容旧：单值；现用多选 selectFilters
  let categoryFilter = "";   // 收藏盒子筛选
  const selectFilters = new Set(); // 多选状态筛选（空=全部）
  const selectColors = new Set();  // 多选颜色筛选（空=不限）
  const selectShapes = new Set();  // 多选珠型筛选（空=不限）
  let hideGifted = localStorage.getItem("ww_hide_gifted") !== "0"; // 默认开=隐藏已送人
  let filterOpen = localStorage.getItem("ww_filter_open") === "1"; // 筛选面板展开态（点筛选不自动收起）
  let search = "";
  let viewMode = localStorage.getItem("ww_viewmode") || "card"; // card | list
  let sortMode = localStorage.getItem("ww_sortmode") || "arrived"; // arrived(入库) | created(放置时间) | price(价格) | playcount(盘玩次数) | star(星级) | color(颜色)
  let sortDir = localStorage.getItem("ww_sortdir") || "desc"; // asc | desc（箭头指向）
  // v93 文玩专注模式（默认开）：只保留 菩提/水晶/玉石，隐藏拼图/周边/盲盒等分类与「分类」页
  // 只影响界面显示，数据一条都不删；设置里可一键关掉
  let focusMode = localStorage.getItem("ww_focus") !== "0";
  let user = null;           // 当前登录用户
  let _onBack = null;        // 当前页面的自定义返回钩子（如批量编辑页设回首页，离开时清空）
  let _lastHash = null;      // 上一次的路由（用于判断「从哪个页面进的详情」）
  let _backMemo = null;      // 进详情前记下的来源页 { hash, y }：返回时回到原位（不再跳顶部）
  let _navList = [];         // 进详情时记下的「当前页面宝贝顺序」：详情页可切换上一个/下一个
  let _detailSwipedAt = 0;   // 详情页刚左右滑动的时间戳（避免滑动后顺手打开大图）

  // v129：弹层"落定"兜底 —— 弹层的入场动画（slideUp）如果因为省电/后台标签/无头浏览器没推进，
  // 就会卡在 opacity:0，用户看到的只是变暗的背景（以为"点了没反应"）。
  // 这里监听弹层的显示/隐藏：显示后 400ms 打上 .modal-settled，CSS 里 animation:none 强制落回最终状态。
  function bindModalSettle() {
    try {
      ["#modal", "#modalMask"].forEach((sel) => {
        const el = $(sel);
        if (!el || typeof MutationObserver !== "function") return;
        const obs = new MutationObserver(() => {
          try {
            clearTimeout(el.__settleT);
            if (el.hidden) { el.classList.remove("modal-settled"); return; }
            el.classList.remove("modal-settled");
            el.__settleT = setTimeout(() => { try { el.classList.add("modal-settled"); } catch (e2) { /* 忽略 */ } }, 400);
          } catch (e2) { /* 忽略 */ }
        });
        obs.observe(el, { attributes: true, attributeFilter: ["hidden", "style"] });
      });
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 状态定义 ---------- */
  // 珠子类 5 态：未盘玩(unplayed) / 待盘玩(ready) / 盘玩中(playing) / 已挂瓷(done) / 佩戴中(wearing)
  // 放置时长（盘玩→现在）由 lastPlayedAt 推算，不再单独占用"放置中"状态
  // 「佩戴中」= 天天戴着的串：只管戴不用盘 → 不参与盘玩计划、今日心选、盘玩状态筛选与盘玩统计
  const BEAD_STATUS = [
    { v: "unplayed", label: "未盘玩" },
    { v: "ready", label: "待盘玩" },
    { v: "playing", label: "盘玩中" },
    { v: "done", label: "已挂瓷" },
    { v: "wearing", label: "佩戴中" },
  ];
  const BEAD_STATUS_LABEL = Object.fromEntries(BEAD_STATUS.map((s) => [s.v, s.label]));
  // 参与「盘玩」流程的状态（佩戴中不在其中 → 不进盘玩计划 / 不参与抽卡 / 不计入盘玩统计）
  const PLAY_FLOW_STATUS = ["ready", "playing", "done"];
  // 珠子类状态的可抽卡状态集合（排除 unplayed 与 wearing）
  const DRAWABLE_STATUS = PLAY_FLOW_STATUS;
  const isPuzzleCat = (cat) => Categories.isPuzzleCategory(cat);
  // 盘玩(包浆)状态机只用于「菩提」分类：未盘玩/待盘玩/盘玩中/已挂瓷
  const PLAYABLE_CATS = ["菩提"];
  const isBeadCat = (cat) => PLAYABLE_CATS.includes(cat);
  // 无盘玩状态分类（水晶/玉石/周边/盲盒/其他等）：只显示"在库/已送人"
  const isNoPlayCat = (cat) => !Categories.isPuzzleCategory(cat) && !isBeadCat(cat);

  function beadStatusLabel(v) { return BEAD_STATUS_LABEL[v] || "未盘玩"; }

  /* ---------- v126 UI 组件（第 3-4 期）：骨架屏 / 空状态插画 / 页头统计 ---------- */
  // 手账涂鸦插画（内联 SVG，无外部图片，跨设备一致）
  const EMPTY_ILLS = {
    bead: '<circle cx="60" cy="52" r="21" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<circle cx="60" cy="52" r="13" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/>' +
      '<circle cx="60" cy="52" r="5" fill="currentColor" opacity=".85"/>' +
      '<path d="M60 73v13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M54 86q6 8 12 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M24 34q10-8 20 0M76 34q10-8 20 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/>',
    spirit: '<path d="M46 62a14 14 0 1 1 28 0z" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<circle cx="60" cy="38" r="15" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<circle cx="54" cy="37" r="2.1" fill="currentColor"/><circle cx="66" cy="37" r="2.1" fill="currentColor"/>' +
      '<path d="M55 45q5 4 10 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M40 30q5-9 12-11M80 30q-5-9-12-11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".55"/>',
    star: '<path d="M60 26l7.6 16.4 18 2.2-13.2 12.6 3.3 17.8L60 66.6 46.3 75l3.3-17.8L36.4 44.6l18-2.2z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M22 30q9-6 16 1M98 30q-9-6-16 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/>',
    box: '<rect x="30" y="42" width="60" height="38" rx="6" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<path d="M30 56h60M60 42v38" stroke="currentColor" stroke-width="1.6" opacity=".5"/>' +
      '<path d="M46 42q14-12 28 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
      '<circle cx="60" cy="56" r="3.2" fill="currentColor"/>',
    room: '<path d="M28 56l32-24 32 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M36 54v26h48V54" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<rect x="52" y="62" width="16" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M22 84h76" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".45"/>',
  };
  function emptyIllHtml(kind) {
    return '<svg class="empty-ill" viewBox="0 0 120 96" aria-hidden="true" style="color:var(--wood-2);opacity:.75">' +
      (EMPTY_ILLS[kind] || EMPTY_ILLS.bead) + "</svg>";
  }
  // 统一空状态：插画 + 标题 + 说明 +（可选）一句小提示 / 按钮
  function emptyCardHtml(opts) {
    const o = opts || {};
    const icon = o.icon ? '<div class="empty-icon">' + o.icon + "</div>" : "";
    return '<div class="empty empty-card">' + emptyIllHtml(o.ill || "bead") + icon +
      (o.title ? "<p style=\"font-weight:700;color:var(--wood)\">" + o.title + "</p>" : "") +
      (o.sub ? "<p>" + o.sub + "</p>" : "") +
      (o.hint ? '<div class="empty-hint">' + o.hint + "</div>" : "") +
      "</div>";
  }
  // 首屏骨架屏（等 Supabase 数据回来之前别给用户看空白）
  function bootSkeletonHtml() {
    let h = '<div class="section-title">📿 我的收藏馆</div><div class="grid">';
    for (let i = 0; i < 3; i++) {
      h += '<div class="card sk-home-card"><div class="sk sk-thumb"></div><div class="sk-body">' +
        '<div class="sk sk-title"></div><div class="sk sk-line w90"></div><div class="sk sk-line w45"></div>' +
        "</div></div>";
    }
    h += "</div>";
    return h;
  }
  // 页头统计条（图鉴/成就/任务共用，排版统一）
  function pageStatsHtml(list) {
    const arr = (list || []).filter(Boolean);
    if (!arr.length) return "";
    return '<div class="page-stats">' + arr.map((s) =>
      '<div class="page-stat"><div class="ps-n">' + s.n + '</div><div class="ps-l">' + s.l + "</div></div>").join("") + "</div>";
  }
  // 统一纸感卡片 / 列表（第 4 期：替换各页里手写的 inline 样式）
  function paperCardHtml(inner, cls) {
    return '<div class="paper-card' + (cls ? " " + cls : "") + '">' + inner + "</div>";
  }
  function paperListHtml(rows, cls) {
    return '<div class="paper-list' + (cls ? " " + cls : "") + '">' + (rows || []).join("") + "</div>";
  }
  function paperRowHtml(icon, body) {
    return '<div class="paper-row"><span class="pr-icon">' + icon + '</span><span class="pr-body">' + body + "</span></div>";
  }

  // 珠子状态默认值：新宝贝默认"未盘玩"，抽卡时才转"待盘玩"。
  // 兼容旧数据（playStatus 为 "" / "idle" / "resting"）
  function normBeadStatus(v, cat) {
    if (!isBeadCat(cat)) return v; // 拼图/周边不动
    if (v === "idle") return "ready";     // 旧"待盘玩" → 新"待盘玩(ready)"
    if (v === "resting") return "playing"; // 旧"放置中" → 新"盘玩中"
    if (v === "playing") return "playing"; // 旧"在盘玩" → 新"盘玩中"
    if (["unplayed", "ready", "playing", "done", "wearing"].includes(v)) return v;
    return v; // 其他（""等）保持
  }
  // 珠子状态展示文案：盘玩中显示"已放置 X 天"（基于上次盘玩时间）
  function beadStatusText(it) {
    const st = it.playStatus || "unplayed";
    if (st === "wearing") return "佩戴中";
    if (st === "playing") return "盘玩中" + (it.lastPlayedAt ? " · 已放置" + Math.floor((Date.now() - it.lastPlayedAt) / 86400000) + "天" : "");
    if (st === "done") return "已挂瓷";
    if (st === "ready") return "待盘玩";
    return "未盘玩";
  }
  // 珠子状态颜色 class（每种状态一种颜色）
  const BEAD_CLS = { unplayed: "sp-unplayed", ready: "sp-ready", playing: "sp-playing", done: "sp-done", wearing: "sp-wearing" };
  function beadStatusCls(it) {
    const st = it.playStatus || "unplayed";
    return BEAD_CLS[st] || BEAD_CLS.unplayed;
  }

  // 生成可点击的状态徽章 HTML（卡片 thumb 右上角 / 列表右侧），已送人不显示
  function statusBadgeHtml(it) {
    if (it.gifted) return "";
    const isPuzzle = Categories.isPuzzleCategory(it.category || "");
    const isBead = isBeadCat(it.category || "");
    const cls = 'badge status-toggle';
    const idAttr = ' data-id="' + it.id + '" title="点击切换状态"';
    if (isPuzzle) {
      const st = it.playStatus === "puzzle_done" ? "done" : "pending";
      const label = it.playStatus === "puzzle_done" ? "已拼" : "待拼";
      return '<button type="button" class="' + cls + (st === "done" ? ' done' : ' pending') + '"' + idAttr + ' style="background:' + (st === "done" ? "#2e7d32" : "#d98ba6") + '">' + label + "</button>";
    }
    // 菩提（盘玩 4 态）：显示盘玩状态徽章（简短标签，不含天数）
    if (isBead) {
      const lbl = beadStatusLabel(it.playStatus || "unplayed");
      return '<button type="button" class="' + cls + ' bead" data-bead="' + (it.playStatus || "unplayed") + '"' + idAttr + '>' + esc(lbl) + "</button>";
    }
    // 水晶/玉石/周边/盲盒等：无盘玩状态，不显示徽章（仅"在库/已送人"上游 badge 处理）
    return "";
  }

  // 主色标签（卡片/列表复用）：未分色用醒目提示
  function colorTagHtml(it) {
    const nc = window.Color ? window.Color.normColor(it.color) : it.color;
    if (!nc) {
      return '<span class="color-tag no-color" title="还未分色，点进去设主色">🎨 未分色</span>';
    }
    const label = window.Color ? window.Color.colorLabel(nc) : "分色";
    const hex = window.Color ? window.Color.colorHex(nc) : "#9e9e9e";
    const grad = (nc === "duo" || nc === "lightflower" || nc === "deepflower")
      ? 'background:linear-gradient(135deg,#e53935,#fbc02d,#4caf50,#1976d2)'
      : ("background:" + hex);
    const border = nc === "white" ? "border:1px solid #ddd" : "";
    return '<span class="color-tag" title="主色：' + esc(label) + '"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:0;margin-right:4px;' + grad + ';' + border + '"></span>' + esc(label) + "</span>";
  }

  /* ---------- 珠型（bead shape）----------
   * 手工选择（不自动识别）；卡片/列表展示标签，筛选面板可多选。
   * 新增/调整珠型只需改这份数组（v 存库，label 展示）。
   * 数组顺序 = 各处 chips 的展示顺序：最常买的四种放最前，两两相邻。
   */
  const SHAPE_LIST = [
    // —— 买得最多的四种：圆珠 / 苹果圆 / 正桶 / 老型桶（放最前）——
    { v: "round", label: "圆珠" },
    { v: "apple", label: "苹果圆" },
    { v: "barrel", label: "正桶" },
    { v: "oldtype", label: "老型桶" },
    // —— 其他珠型 ——
    { v: "abacus", label: "算盘珠" },
    { v: "saucer", label: "飞碟珠" },
    { v: "lantern", label: "灯笼珠" },
    { v: "melon", label: "瓜珠" },
    { v: "drum", label: "鼓珠" },
    { v: "carved", label: "雕刻" },
    { v: "freeform", label: "随形" },
    { v: "gourd", label: "葫芦" },
    { v: "peacebuckle", label: "平安扣" },
    { v: "plaque", label: "无事牌" },
    { v: "other", label: "其他" },
  ];
  // 珠型值 → 中文名（未知值原样返回，兼容手工写入的旧值）
  function shapeLabel(v) {
    if (!v) return "";
    const s = SHAPE_LIST.find((x) => x.v === v);
    return s ? s.label : v;
  }
  // 珠型标签（卡片/列表复用）；未设置珠型不显示
  function shapeTagHtml(it) {
    if (!it.beadShape) return "";
    const label = shapeLabel(it.beadShape);
    return '<span class="color-tag shape-tag" title="珠型：' + esc(label) + '">📿 ' + esc(label) + "</span>";
  }

  /* ---------- 软糯程度（v91；v92 起可在列表里直接点着改） ---------- */
  // 手感的"糯"感：软糯 / 微糯 / 未标
  const SOFTNESS_LIST = [
    { v: "soft", label: "软糯" },
    { v: "slight", label: "微糯" },
  ];
  function softnessLabel(v) {
    if (!v) return "";
    const s = SOFTNESS_LIST.find((x) => x.v === v);
    return s ? s.label : v;   // 未知值原样返回（兼容手工写入）
  }
  // 软糯程度开关（卡片/列表里直接点，不用进详情）；未标注时显示淡淡的「🍡 未标」
  function softnessTagHtml(it) {
    const v = it.softness || "";
    const label = v ? softnessLabel(v) : "未标";
    return '<button type="button" class="soft-toggle ' + (v ? "soft-" + v : "soft-none") + '"' +
      ' data-soft-id="' + esc(it.id) + '" title="点一下改软糯程度：未标 → 软糯 → 微糯">🍡 ' + esc(label) + "</button>";
  }
  // 点一下循环切换并存到云端
  const SOFT_CYCLE = ["", "soft", "slight"];
  async function cycleSoftness(id, btn) {
    const it = allItems.find((x) => x.id === id);
    if (!it) return;
    const prev = it.softness || "";
    const next = SOFT_CYCLE[(SOFT_CYCLE.indexOf(prev) + 1) % SOFT_CYCLE.length];
    const paint = (val) => {
      if (!btn) return;
      btn.classList.remove("soft-none", "soft-soft", "soft-slight");
      btn.classList.add(val ? "soft-" + val : "soft-none");
      btn.textContent = "🍡 " + (val ? softnessLabel(val) : "未标");
    };
    it.softness = next;
    paint(next);   // 先就地更新按钮（不整页重渲染，滚动位置不动）
    try {
      await DB.put(it);
      toast(next ? "软糯程度：" + softnessLabel(next) : "已清除软糯程度");
    } catch (e) {
      it.softness = prev;   // 保存失败回滚
      paint(prev);
      toast("保存失败：" + (e && e.message ? e.message : "网络问题"));
    }
  }
  // 用「捕获阶段」代理点击：抢在卡片自己的"点进详情"之前处理，改完不跳转
  function bindSoftToggles() {
    view.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".soft-toggle") : null;
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      cycleSoftness(btn.dataset.softId, btn);
    }, true);
  }

  // 珠子状态徽章颜色（CSS 类）
  function beadBadgeCls(it) {
    const st = it.playStatus || "unplayed";
    if (st === "playing") return "playing";
    if (st === "done") return "done";
    if (st === "resting") return "resting";
    if (st === "ready") return "ready";
    return "unplayed";
  }

  /* ---------- 星级（0-5 星；5 星自动进喜欢/收藏展柜） ---------- */
  function itemStars(it) { return Math.max(0, Math.min(5, Number(it.star) || 0)); }
  // 可点击的 5 星控件（点第 N 颗设 N 星；点当前最高星则可清为 0）
  function starHtml(it, cls) {
    const s = itemStars(it);
    let h = '<span class="star-widget' + (cls ? " " + cls : "") + '" data-id="' + it.id + '" title="评分 ' + s + ' 星">';
    for (let i = 1; i <= 5; i++) {
      const on = i <= s;
      h += '<button type="button" class="star-btn' + (on ? " on" : "") + '" data-id="' + it.id + '" data-star="' + i + '">' + (on ? "★" : "☆") + "</button>";
    }
    return h + "</span>";
  }

  // 绑定 5 星控件点击：设/清星级
  function bindStars() {
    view.querySelectorAll(".star-btn").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const item = allItems.find((x) => x.id === b.dataset.id);
      if (!item) return;
      const val = Number(b.dataset.star);
      const prev = itemStars(item);
      // 点当前最高星 → 清为 0；否则设为该星数
      const next = (val === prev) ? 0 : val;
      item.star = next;
      try {
        const saved = await DB.put(item);
        if (saved && itemStars(saved) !== next) {
          // 云端缺 star 列（未执行 alter SQL）：评分无法真正存云端，回滚并明确提示
          item.star = prev; // 回滚：评分以云端为准，不假装保存
          toast("⚠️ 评分未保存：数据库缺 star 列，请先在 Supabase 执行 alter 建列（详见开发文档）。执行后评分即可跨设备同步");
          return;
        }
        toast(next >= 5 ? "⭐ 5 星，已进入喜欢展柜" : (next > 0 ? "已设为 " + next + " 星，已同步云端" : "已取消星级（已同步）"));
        if (document.getElementById("gridHolder")) updateGrid();
        else if (location.hash === "#/fav") renderFavPage();
        else router();
      } catch (err) { item.star = prev; toast("操作失败：" + err.message); }
    }));
  }

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
  // 名字太长在窄格子里会挤成一团：统一按「字数上限」截断（中文按 1 个字算，超出用 …）
  // 只影响显示，原名字保存在数据里不变；title 属性仍给完整名字（长按/悬停可见）
  const NAME_MAX = { plan: 5, card: 9, list: 14 };
  function clipName(s, max) {
    const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    if (!t) return "未命名";
    const chars = Array.from(t);            // 按码点切，避免把 emoji 切坏
    return chars.length > max ? chars.slice(0, max).join("") + "…" : t;
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
      modal.style.display = ""; // 清除历史弹窗残留的 inline display，避免"遮罩显示但弹窗不可见"
      const done = (v) => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; resolve(v); };
      $("#mCancel").onclick = () => done(false);
      $("#mOk").onclick = () => done(true);
      mask.onclick = () => done(false);
    });
  }

  /* ---------- 养护小知识弹层 ---------- */
  function showTipsModal(item) {
    const mask = $("#modalMask");
    const modal = $("#modal");
    const cat = item.category || "";

    // 拼图/动漫周边等非珠子类：显示品牌/IP 介绍，而不是文玩护理
    const isPuzzle = Categories.isPuzzleCategory(cat);
    const isBrandCat = Categories.isBrandCategory(cat);
    if (isPuzzle || isBrandCat) {
      const cfg = Categories.getCategoryConfig(cat);
      const brandName = item.species || (item.beadSize ? item.beadSize + "片" : "");
      const fieldLabel = cfg.label || "品牌";
      const options = cfg.options || [];

      let html = "<h3>" + (isPuzzle ? "🧩 " : "🏅 ") + "品牌 / IP 档案</h3>";
      html += "<p style='text-align:center;font-size:13px;color:var(--gold);margin-bottom:12px'>「" + esc(cat) + "」收藏指南</p>";

      if (brandName) {
        html += paperCardHtml('<div style="font-size:13px;color:var(--text-2);margin-bottom:4px">当前' + fieldLabel + '</div>' +
          '<div style="font-size:17px;font-weight:700;color:var(--wood)">' + esc(brandName) + "</div>") + '<div style="height:12px"></div>';
      }

      // 品牌库介绍
      if (options.length) {
        html += paperCardHtml('<div style="font-size:13px;font-weight:600;color:var(--wood);margin-bottom:8px">常见' + fieldLabel + '一览</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
          options.map((o) => '<span class="chip" style="font-size:12px">' + esc(o) + "</span>").join("") +
          "</div>");
      }

      // 拼图额外提示
      if (isPuzzle) {
        html += paperCardHtml('<div style="font-size:13px;font-weight:600;color:var(--wood);margin-bottom:6px">💡 拼图小贴士</div>' +
          '<div style="font-size:13px;color:var(--text);line-height:1.7">' +
          "拼图作品完成后建议装裱（相框+防UV玻璃）防止氧化褪色。<br>" +
          "未完成的拼图用拼图垫或卷筒收纳，防止散片丢失。<br>" +
          "品牌盒子上都有片数标注，收藏时可以记录拼完时间。");
        if (brandName) {
          const known = options.find((o) => o === brandName);
          if (known) {
            html += "<br><br>「" + esc(brandName) + "」是拼图圈常见品牌，咬合和印刷质量有保障，可以放心入手。";
          } else {
            html += "<br><br>「" + esc(brandName) + "」不在常见品牌库里，是宝藏品牌！记得分享给串友。";
          }
        }
        html += "</div></div>";
      }

      html += '<button class="btn primary" id="mCloseTips" style="width:100%;margin-top:14px">知道了</button>';
      modal.innerHTML = html;
      mask.hidden = false;
      modal.hidden = false;
      modal.style.display = "";
      $("#mCloseTips").onclick = () => { mask.hidden = true; modal.hidden = true; };
      mask.onclick = () => { mask.hidden = true; modal.hidden = true; };
      return;
    }

    // 珠子类：文玩养护知识
    const tips = Tips.getTips(item.species, item.craft);

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
    // 按工艺的差异化内容（干磨/水磨/干抛）——有工艺时插入一节
    if (tips.craft) {
      sections.unshift({ key: "craft", icon: "⚙️", title: "「" + (tips.craftName || "工艺") + "」专属" });
    }
    sections.forEach((s, i) => {
      let list;
      if (s.key === "craft") {
        // 工艺专属：intro + care + play 合并展示
        const c = tips.craft;
        list = [c.intro].concat(c.care, c.play);
      } else {
        list = tips[s.key] || [];
      }
      html += '<div class="paper-card flush">' +
        '<button type="button" class="acc-head" data-sec="' + s.key + '">' +
        '<span>' + s.icon + "</span><span>" + s.title + "</span><span style='margin-left:auto;color:var(--text-2);font-size:12px'>" + list.length + " 条</span>" +
        '<span style="margin-left:4px;color:var(--gold);transition:transform .2s" data-arrow="' + s.key + '">▾</span></button>' +
        '<div class="acc-body" data-body="' + s.key + '" style="display:none">' +
        list.map((t) => '<div style="font-size:14px;color:var(--text);line-height:1.7;padding:6px 0;border-top:1px dashed var(--line)">' + esc(t) + "</div>").join("") +
        "</div></div>";
    });

    // 名词解释（每次随机 4 条，不同）
    if (tips.terms && tips.terms.length) {
      html += '<div class="paper-card flush">' +
        '<button type="button" class="acc-head" data-sec="terms">' +
        '<span>📚</span><span>名词解释</span><span style="margin-left:auto;color:var(--text-2);font-size:12px">' + tips.terms.length + " 条 · 随机</span>" +
        '<span style="margin-left:4px;color:var(--gold);transition:transform .2s" data-arrow="terms">▾</span></button>' +
        '<div class="acc-body" data-body="terms" style="display:none">' +
        tips.terms.map((t) => '<div style="font-size:14px;color:var(--text);line-height:1.7;padding:6px 0;border-top:1px dashed var(--line)"><b style="color:var(--wood)">' + esc(t.name) + "</b>：" + esc(t.desc) + "</div>").join("") +
        "</div></div>";
    }

    html += '<button class="btn primary" id="mCloseTips" style="width:100%">知道了</button>';

    modal.innerHTML = html;
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";

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

    const game = Game.computeXp(allItems, playDays);
    const level = Game.getLevel(game.xp);
    const tasks = Game.dailyTasks(allItems);
    const noBuy = Game.noBuyChallenge(allItems);
    const doneCount = tasks.filter((t) => t.done).length;

    let html = "";

    // v126 第 4 期：页头统计条（和「图鉴」「成就殿堂」同一套排版）
    html += pageStatsHtml([
      { n: level.icon + " Lv." + level.level, l: level.name },
      { n: game.xp, l: "当前 XP" },
      { n: doneCount + "/" + tasks.length, l: "今日任务" },
      { n: noBuy.days + " 天", l: "不买挑战" },
    ]);

    // 等级卡
    html += '<div class="stats-card"><h3>' + level.icon + " " + level.name + " · Lv." + level.level + "</h3>" +
      '<div class="xp-bar"><div class="xp-fill" style="width:' + level.progress + '%"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;opacity:.8;margin-top:6px">' +
      "<span>" + level.xp + " XP</span><span>距下一称号还需 " + (level.nextMin - level.xp) + " XP</span></div></div>";

    // 每日任务
    html += '<div class="section-title">📋 今日任务 <small style="color:var(--text-2);font-weight:400">' + doneCount + "/" + tasks.length + " 完成</small></div>";
    html += paperCardHtml(paperListHtml(tasks.map((t) =>
      '<div class="quest-item' + (t.done ? " done" : "") + '">' +
      '<span class="quest-icon">' + t.icon + "</span>" +
      '<div class="quest-body"><div class="quest-title">' + esc(t.title) + "</div>" +
      '<div class="quest-desc">' + esc(t.desc) + "</div></div>" +
      (t.done ? '<span class="quest-flag">✓ +' + t.xp + "XP</span>" : '<span class="quest-xp">+' + t.xp + "XP</span>") +
      "</div>")), "tight");

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
    if (game.milestones.length) {
      html += paperCardHtml(paperListHtml(game.milestones.map((m) =>
        '<div class="quest-item done"><span class="quest-icon">' + m.icon + '</span>' +
        '<div class="quest-body"><div class="quest-title">' + esc(m.name) + "</div></div>" +
        '<span class="quest-flag">+' + m.xp + "XP</span></div>")), "tight");
    } else {
      html += paperCardHtml('<div class="room-none" style="padding:8px 0">还没有里程碑，去收藏第一件宝贝吧！</div>', "tight");
    }

    view.innerHTML = html;
  }

  /* ---------- 统计页 ---------- */
  function renderStatsPage() {
    topbarTitle.textContent = "成就殿堂";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    // 文玩专注模式下：统计只看文玩类（隐藏的分类数据仍在云端；等级/经验仍按全量算，避免掉级）
    const statItems = focusVisible(allItems);
    const stats = Stats.computeStats(statItems);
    const facts = Stats.funFacts(statItems, stats);
    const achievements = Stats.getAchievements(statItems, playDays);

    let html = "";

    // v126 第 4 期：页头统计条（与「今日任务」「图鉴」同一套排版）
    const achTotalTop = achievements.reduce((s, g) => s + g.items.length, 0);
    const achUnlockedTop = achievements.reduce((s, g) => s + g.unlockedCount, 0);
    const lvTop = Game.getLevel(Game.computeXp(allItems, playDays).xp);
    html += pageStatsHtml([
      { n: lvTop.icon + " Lv." + lvTop.level, l: lvTop.name },
      { n: achUnlockedTop + "/" + achTotalTop, l: "成就解锁" },
      { n: (Game.currentStreak ? Game.currentStreak(playDays) : 0) + " 天", l: "连续盘串" },
      { n: stats.gifted, l: "已送人" },
    ]);

    // 顶部总览卡（累计花费带隐私小眼睛）
    const hideSpend = getHideSpend();
    html += '<div class="stats-card"><h3>藏 品 总 览</h3><div class="stats-nums">' +
      '<div><div class="n">' + stats.total + '</div><div class="l">全部宝贝</div></div>' +
      '<div><div class="n">' + stats.owned + '</div><div class="l">在库</div></div>' +
      '<div><div class="n">' + stats.gifted + '</div><div class="l">已送人</div></div>' +
      '<div><div class="n">' + (hideSpend ? "¥•••" : "¥" + (window.Stats ? window.Stats.fmtMoney(stats.totalSpent) : stats.totalSpent)) + '</div>' +
      '<div class="l">累计花费 <button class="eye-btn" id="btnEye">' + (hideSpend ? "👁️" : "🙈") + "</button></div></div>" +
      "</div></div>";

    // 收藏分布（颜色 / 分类 / 状态 / 价格区间）
    const dist = Stats.distributions(statItems);
    const distBar = (d, fallbackColor) => {
      if (!d.count) return "";
      const pct = Math.max(8, d.pct); // 最小宽度让标签可读
      const color = d.color || fallbackColor || "#b8860b";
      return '<div class="dist-row">' +
        '<span class="dist-label">' + esc(d.label) + '</span>' +
        '<span class="dist-track"><span class="dist-fill" style="width:' + pct + '%;background:' + color + '"></span></span>' +
        '<span class="dist-num">' + d.count + " · " + d.pct + "%</span></div>";
    };
    const distSection = (title, data, fallbackColor) => {
      if (!data || !data.length) return "";
      return '<div class="dist-block"><div class="dist-head">' + esc(title) + "</div>" +
        data.map((d) => distBar(d, fallbackColor)).join("") + "</div>";
    };
    html += '<button type="button" class="section-collapse" id="collDist" data-open="0"><span class="section-title" style="margin:0">📊 收藏分布</span><span class="collapse-arrow" id="collDistArrow">▸</span></button>';
    html += '<div id="distBody" style="display:none">' +
      '<div class="stats-card" style="padding:14px">' +
      distSection("🎨 主色", dist.colors, "#b8860b") +
      distSection("🗂️ 收藏盒子", dist.cats, "#8d6e63") +
      distSection("🔄 状态", dist.statuses, "#4caf50") +
      "</div>" +
      "</div>";

    // 月历
    html += '<div class="section-title">📅 入库月历</div>';
    html += '<div class="cal-card" id="calBox"></div>';

    // 有趣小统计（每次进入随机挑 5 条，动态更新）
    html += '<div class="section-title">✨ 有趣发现 <small style="color:var(--text-2);font-weight:400">随机 5 条 · 每次不同</small></div>';
    // 洗牌取 5 条（每次进入随机）
    const factShuffled = facts.slice().sort(() => Math.random() - 0.5).slice(0, 5);
    html += factShuffled.length
      ? paperCardHtml(paperListHtml(factShuffled.map((f) => paperRowHtml(f.icon, esc(f.text)))), "tight")
      : paperCardHtml('<div class="room-none" style="padding:8px 0">还没有数据，先去收藏几件宝贝吧</div>', "tight");

    // 成就（分组递进展示 + tier 进阶）
    const totalAch = achievements.reduce((s, g) => s + g.items.length, 0);
    const totalUnlocked = achievements.reduce((s, g) => s + g.unlockedCount, 0);

    // 称号栏（等级称号 + 自选徽章）
    const lvGame = Game.getLevel(Game.computeXp(allItems, playDays).xp);
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
      Stats.renderCalendar(statItems, $("#calBox"), {
        year: y, month: m,
        onChange: (ny, nm) => renderCal(ny, nm),
      });
    }
    renderCal(calY, calM);

    // 累计花费小眼睛
    const eyeBtn = $("#btnEye");
    if (eyeBtn) eyeBtn.onclick = () => {
      const next = !getHideSpend();
      setHideSpend(next);
      renderStatsPage();
    };

    // 收藏分布折叠/展开（默认折叠）
    const collDist = $("#collDist");
    if (collDist) collDist.onclick = () => {
      const body = $("#distBody");
      const arrow = $("#collDistArrow");
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "";
      collDist.dataset.open = open ? "0" : "1";
      if (arrow) arrow.style.transform = open ? "" : "rotate(90deg)";
    };

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
          items: statItems,   // 文玩专注模式下只算文玩类
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

  /* ---------- 收藏盒子二级页（专注展示该分类，保留筛选+排序+搜索） ---------- */
  function renderBoxPage(cat) {
    const isUncat = cat === "__uncat";
    // 文玩专注模式：非文玩分类的盒子页隐藏（数据还在，关掉开关就能进）
    if (focusMode && !isUncat && !isWenwanCat(cat)) {
      topbarTitle.textContent = "暂时隐藏";
      btnBack.style.visibility = "visible";
      btnSettings.style.visibility = "hidden";
      view.innerHTML = emptyCardHtml({
        ill: "star", icon: "🎯",
        title: "「" + esc(cat) + "」在当前是隐藏的",
        sub: "你开启了「文玩专注模式」（只显示菩提 / 水晶 / 玉石）<br>数据一条都没删，去设置里关掉就回来了",
      }) + '<button class="btn ghost" id="goFocusSet" style="width:100%;margin-top:12px">去设置里关闭</button>';
      const gb = $("#goFocusSet");
      if (gb) gb.onclick = () => location.hash = "#/settings";
      return;
    }
    const displayName = isUncat ? "未分类" : cat;
    topbarTitle.textContent = displayName + "盒子";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    const raw = allItems;
    let base = raw;
    if (isUncat) base = base.filter((i) => !i.category);
    else base = base.filter((i) => (i.category || "") === cat);

    // 收集进度（仅非未分类盒子显示）
    let progressHtml = "";
    if (!isUncat) {
      const cfg = Categories.getCategoryConfig(cat);
      const target = cfg.options.length || 1;
      const pct = Math.min(100, Math.round((base.length / target) * 100));
      progressHtml = '<div class="box-progress">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">' +
        '<span style="color:var(--text-2)">收集进度：' + base.length + ' / ' + target + ' 种' + (cfg.field === "brand" ? "品牌" : "品种") + '</span>' +
        '<span style="color:var(--gold);font-weight:600">' + pct + '%</span></div>' +
        '<div class="xp-track"><div class="xp-fill" style="width:' + pct + '%;background:linear-gradient(90deg,#b8860b,#d4a96a)"></div></div>' +
        '<div style="font-size:10px;color:var(--text-2);margin-top:4px">继续收集，解锁更多' + esc(cfg.label || "品种") + '！</div>' +
        "</div>";
    }

    let html = progressHtml;
    // 折叠筛选区：按钮 + 可展开面板（复用同一套选择状态与排序，仅作用于本盒子）
    html += '<button class="filter-toggle" id="filterToggle">' +
      '<span>📊 筛选与统计</span><span class="filter-badge">' + base.length + ' 件</span><span class="filter-arrow" id="filterArrow" style="transform:' + (filterOpen ? "rotate(180deg)" : "") + '">▾</span>' +
      "</button>";
    html += '<div id="filterPanel" style="display:' + (filterOpen ? "" : "none") + '">';
    // 隐藏已送人开关
    html += '<div class="paper-card switch-row">' +
      '<div><div style="font-size:13px;font-weight:600;color:var(--text)">🙈 隐藏已送人</div>' +
      '<div style="font-size:11px;color:var(--text-2);margin-top:2px">关闭后显示所有宝贝，含已出库</div></div>' +
      '<label class="switch"><input type="checkbox" id="hideGifted"' + (hideGifted ? " checked" : "") + '><span class="switch-slider"></span></label></div>';

    // 状态筛选（按本分类对应显示：拼图→待拼/已拼，菩提→盘玩4态，其他→只 在库/已送人）
    const st = { instock: base.filter((i) => !i.gifted).length, gifted: base.filter((i) => i.gifted).length };
    const bBase = base.filter((i) => isBeadCat((i.category || "")));
    const pBase = base.filter((i) => isPuzzleCat((i.category || "")));
    const stChip = (k, label, n) => '<button type="button" class="chip' + (selectFilters.has(k) ? " active" : "") + '" data-mf="' + k + '">' + label + '<span class="chip-num">' + n + '</span></button>';
    let statusChips = '<div class="filters"><span class="chip total-chip">共 <b>' + base.length + '</b></span>' + stChip("instock", "在库", st.instock);
    if (isBeadCat(cat) || isUncat) {
      statusChips += stChip("unplayed", "未盘玩", bBase.filter((i) => i.playStatus === "unplayed" || !i.playStatus).length) +
        stChip("ready", "待盘玩", bBase.filter((i) => i.playStatus === "ready").length) +
        stChip("playing", "盘玩中", bBase.filter((i) => i.playStatus === "playing").length) +
        stChip("done", "已挂瓷", bBase.filter((i) => i.playStatus === "done").length) +
        stChip("wearing", "佩戴中", bBase.filter((i) => i.playStatus === "wearing").length);
    }
    if (isPuzzleCat(cat) || isUncat) {
      statusChips += stChip("puzzle_pending", "待拼", pBase.filter((i) => i.playStatus === "puzzle_pending").length) +
        stChip("puzzle_done", "已拼", pBase.filter((i) => i.playStatus === "puzzle_done").length);
    }
    statusChips += stChip("gifted", "已送人", st.gifted) +
      (selectFilters.size ? '<button type="button" class="chip clear-chip" id="clearSt">✕ 清除状态</button>' : "") +
      '</div>';
    html += statusChips;

    // 颜色多选 chips（带计数）
    const colorCount = {};
    base.forEach((i) => { const c = window.Color ? window.Color.normColor(i.color) : i.color; if (c) colorCount[c] = (colorCount[c] || 0) + 1; });
    html += '<div class="filters">' +
      (window.Color ? window.Color.COLOR_LIST.map((c) => '<button type="button" class="chip' + (selectColors.has(c.v) ? " active" : "") + '" data-mcolor="' + c.v + '">' + c.label + '<span class="chip-num">' + (colorCount[c.v] || 0) + '</span></button>').join("") : "") +
      (selectColors.size ? '<button type="button" class="chip clear-chip" id="clearColor">✕ 清除颜色</button>' : "") +
      '</div>';

    // 珠型多选 chips（带计数）
    const shapeCount = {};
    base.forEach((i) => { if (i.beadShape) shapeCount[i.beadShape] = (shapeCount[i.beadShape] || 0) + 1; });
    html += '<div class="filters">' +
      '<span class="chip total-chip">珠型</span>' +
      SHAPE_LIST.map((s) => '<button type="button" class="chip' + (selectShapes.has(s.v) ? " active" : "") + '" data-mshape="' + s.v + '">' + s.label + '<span class="chip-num">' + (shapeCount[s.v] || 0) + '</span></button>').join("") +
      (selectShapes.size ? '<button type="button" class="chip clear-chip" id="clearShape">✕ 清除珠型</button>' : "") +
      '</div>';

    // 排序
    const arrow = (m) => (sortMode === m ? (sortDir === "asc" ? " ▲" : " ▼") : "");
    html += '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--text-2)">' +
      '<span>排序</span>' +
      '<div class="seg" id="sortSeg" style="flex:1;flex-wrap:wrap">' +
      '<button type="button" data-sort="arrived" class="' + (sortMode === "arrived" ? "active" : "") + '">🕐 入库' + arrow("arrived") + "</button>" +
      '<button type="button" data-sort="created" class="' + (sortMode === "created" ? "active" : "") + '">⏱ 放置' + arrow("created") + "</button>" +
      '<button type="button" data-sort="price" class="' + (sortMode === "price" ? "active" : "") + '">💰 价格' + arrow("price") + "</button>" +
      '<button type="button" data-sort="playcount" class="' + (sortMode === "playcount" ? "active" : "") + '">🤲 盘玩次数' + arrow("playcount") + "</button>" +
      '<button type="button" data-sort="star" class="' + (sortMode === "star" ? "active" : "") + '">⭐ 星级' + arrow("star") + "</button>" +
      '<button type="button" data-sort="color" class="' + (sortMode === "color" ? "active" : "") + '">🎨 颜色' + arrow("color") + "</button>" +
      "</div></div>";
    html += "</div>"; // 关闭 filterPanel

    // 搜索
    html += '<div class="search-box"><input id="searchInput" placeholder="搜索名字/品种/工艺/状态/颜色，或输入价格范围如 100-300、>500…" value="' + esc(search) + '"></div>';

    // 应用筛选 + 排序
    let list = filtered(base);
    sortItems(list);
    list = list.slice(); // 避免影响原数组

    if (!list.length) {
      html += emptyCardHtml({ ill: "box", icon: "📦", title: "这个盒子里还没有匹配的宝贝", sub: "换个筛选条件或清掉搜索词试试" });
      view.innerHTML = html;
      bindBoxEvents(cat, base);
      return;
    }

    html += '<div class="grid">';
    for (const it of list) {
      const p = it.photos && it.photos[0];
      const img = p ? '<img src="' + photoUrl(p) + '" loading="lazy" alt="">' : '<div class="placeholder">📿</div>';
      const badge = it.gifted ? '<span class="badge gifted">已送人</span>' : '<span class="badge instock">在库</span>';
      const statusBadge = statusBadgeHtml(it);
      const stars = starHtml(it);
      const days = DB.formatDays(DB.daysWith(it));
      html += '<div class="card" data-id="' + it.id + '">' +
        '<div class="card-thumb">' + img + badge + statusBadge + stars + "</div>" +
        '<div class="card-body">' +
        '<div class="card-name">' + esc(clipName(it.name, NAME_MAX.card)) + "</div>" +
        '<div class="card-sub">' + shapeTagHtml(it) + softnessTagHtml(it) + '<span>' + esc(it.species || it.beadSize ? (it.beadSize ? it.beadSize + "mm" : it.species || "") : "") + '</span><span class="days">' + esc(days) + "</span></div>" +
        "</div></div>";
    }
    html += "</div>";

    view.innerHTML = html;
    view.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => location.hash = "#/item/" + c.dataset.id));
    bindStatusToggles();
    bindStars();
    bindBoxEvents(cat, base);
  }

  /* 盒子页：绑定折叠筛选按钮 + 状态/颜色 chips + 排序 + 搜索（复用于首页同款逻辑） */
  function bindBoxEvents(cat, base) {
    const ft = $("#filterToggle");
    if (ft) ft.onclick = () => {
      filterOpen = !filterOpen;
      try { localStorage.setItem("ww_filter_open", filterOpen ? "1" : "0"); } catch (e) {}
      const panel = $("#filterPanel");
      const arrow = $("#filterArrow");
      if (panel) panel.style.display = filterOpen ? "" : "none";
      if (arrow) arrow.style.transform = filterOpen ? "rotate(180deg)" : "";
    };
    view.querySelectorAll(".chip[data-mf]").forEach((c) => c.addEventListener("click", () => {
      const k = c.dataset.mf;
      if (selectFilters.has(k)) selectFilters.delete(k); else selectFilters.add(k);
      renderBoxPage(cat);
    }));
    view.querySelectorAll(".chip[data-mcolor]").forEach((c) => c.addEventListener("click", () => {
      const k = c.dataset.mcolor;
      if (selectColors.has(k)) selectColors.delete(k); else selectColors.add(k);
      renderBoxPage(cat);
    }));
    view.querySelectorAll(".chip[data-mshape]").forEach((c) => c.addEventListener("click", () => {
      const k = c.dataset.mshape;
      if (selectShapes.has(k)) selectShapes.delete(k); else selectShapes.add(k);
      renderBoxPage(cat);
    }));
    const cs = $("#clearSt"); if (cs) cs.onclick = () => { selectFilters.clear(); renderBoxPage(cat); };
    const cc = $("#clearColor"); if (cc) cc.onclick = () => { selectColors.clear(); renderBoxPage(cat); };
    const csh = $("#clearShape"); if (csh) csh.onclick = () => { selectShapes.clear(); renderBoxPage(cat); };
    view.querySelectorAll("#sortSeg button").forEach((b) => b.onclick = () => {
      const chosen = b.dataset.sort;
      if (sortMode === chosen) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortMode = chosen; sortDir = chosen === "color" ? "asc" : "desc"; }
      localStorage.setItem("ww_sortmode", sortMode);
      localStorage.setItem("ww_sortdir", sortDir);
      renderBoxPage(cat);
    });
    const si = $("#searchInput");
    if (si) si.addEventListener("input", () => { search = si.value.trim(); renderBoxPage(cat); });
    const hg = $("#hideGifted");
    if (hg) hg.onchange = () => { hideGifted = hg.checked; localStorage.setItem("ww_hide_gifted", hideGifted ? "1" : "0"); renderBoxPage(cat); };
  }

  /* ---------- 喜欢展示柜页（沉浸式一屏一宝贝 + 左右滑动切换） ---------- */
  let favIdx = 0; // 当前展示的第几个喜欢宝贝
  function renderFavPage() {
    topbarTitle.textContent = "我的喜欢";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";

    const favs = allItems.filter((i) => (Number(i.star) || 0) >= 5); // 5 星自动进喜欢展柜
    if (favIdx >= favs.length) favIdx = 0;
    if (favIdx < 0) favIdx = 0;

    let html = "";
    if (!favs.length) {
      html += '<div class="section-title">⭐ 我特别喜欢的宝贝</div>';
      html += emptyCardHtml({
        ill: "star", icon: "⭐", title: "还没有 5 星的宝贝",
        sub: "在卡片或详情页给宝贝打 ⭐⭐⭐⭐⭐ 收藏到这里",
      });
      view.innerHTML = html;
      return;
    }

    const it = favs[favIdx];
    const p = it.photos && it.photos[0];
    const img = p ? '<img src="' + photoUrl(p) + '" alt="">' : '<div class="placeholder">📿</div>';

    // 底部信息
    const stTxt = it.gifted ? "已送人" :
      isPuzzleCat(it.category || "") ? (it.playStatus === "puzzle_done" ? "已拼" : "待拼") :
      isBeadCat(it.category || "") ? beadStatusText(it) : "";
    const stCls = it.gifted ? "r" :
      isPuzzleCat(it.category || "") ? (it.playStatus === "puzzle_done" ? "g" : "yl") :
      isBeadCat(it.category || "") ? beadStatusCls(it) : "";

    // 圆点指示器
    let dots = "";
    for (let i = 0; i < favs.length; i++) {
      dots += '<span class="fav-dot' + (i === favIdx ? " active" : "") + '" data-i="' + i + '"></span>';
    }

    html += '<div class="fav-stage">';
    html += '<div class="fav-frame">' + img +
      '<div class="fav-shine"></div>' +
      '</div>';
    html += '<div class="fav-nav">' +
      '<button type="button" class="fav-arrow" id="favPrev">◀</button>' +
      '<div class="fav-dots">' + dots + "</div>" +
      '<button type="button" class="fav-arrow" id="favNext">▶</button>' +
      "</div>";
    html += '<div class="fav-meta">' +
      '<div class="fav-name">' + esc(it.name || "未命名") + "</div>" +
      '<div class="fav-sub">' + esc(cardSubText(it)) + (it.category ? " · " + esc(it.category) : "") + "</div>" +
      (stTxt ? '<div class="fav-status"><span class="tag ' + stCls + '">' + esc(stTxt) + "</span></div>" : "") +
      '<div class="fav-stars">' + starHtml(it, "fav-stars") + ' <small style="color:var(--text-2)">' + itemStars(it) + ' 星 · 点星可调整</small></div>' +
      '<div class="fav-count">第 ' + (favIdx + 1) + " / " + favs.length + " 件</div>" +
      "</div>";
    // 操作按钮行
    html += '<div class="fav-actions">' +
      '<button class="btn ghost" id="favShare" style="flex:1">🏛 海报</button>' +
      '<button class="btn ghost" id="favShareLink" style="flex:1">🔗 动态展厅</button>' +
      '<button class="btn primary" id="favView" style="flex:1">详情</button>' +
      "</div>";
    html += "</div>";

    view.innerHTML = html;

    // 事件绑定
    const show = (i) => { favIdx = (i + favs.length) % favs.length; renderFavPage(); };
    const prev = $("#favPrev"), next = $("#favNext");
    if (prev) prev.onclick = () => show(favIdx - 1);
    if (next) next.onclick = () => show(favIdx + 1);
    view.querySelectorAll(".fav-dot").forEach((d) => d.onclick = () => show(+d.dataset.i));
    // 星星评分（改星/降星）
    bindStars();
    // 查看详情
    const fv = $("#favView");
    if (fv) fv.onclick = () => location.hash = "#/item/" + it.id;
    // 分享展柜（高级海报）
    const fsBtn = $("#favShare");
    if (fsBtn) fsBtn.onclick = async () => {
      const btn = fsBtn;
      btn.disabled = true; btn.textContent = "生成中…";
      try {
        const canvas = await Poster.favPoster(favs, { username: user && user.displayName ? user.displayName : "" });
        const result = await Poster.shareCanvas(canvas, "我的收藏展柜_" + new Date().getFullYear() + ".jpg");
        toast(result === "shared" ? "已分享" : "展柜海报已保存到相册/下载");
      } catch (err) { toast("展柜生成失败：" + err.message); }
      finally { btn.disabled = false; btn.textContent = "🏛 海报"; }
    };
    // 分享动态展厅链接（公开可访问，任何人可看）
    const fsLink = $("#favShareLink");
    if (fsLink) fsLink.onclick = async () => {
      const btn = fsLink;
      btn.disabled = true; btn.textContent = "生成中…";
      try {
        // 打包喜欢宝贝数据（仅暴露公开信息：名称/图片URL/分类/品种/尺寸）
        const data = favs.map((it) => {
          const p = it.photos && it.photos[0];
          const size = Categories.getSizeField(it.category || "");
          return {
            name: it.name || "未命名",
            url: p ? (p.url || (p.data ? URL.createObjectURL(p.data) : "")) : "",
            category: it.category || "",
            species: it.species || "",
            size: size === "bead" ? (it.beadSize ? it.beadSize + "mm" : "") : size === "pieces" ? (it.pieceCount ? it.pieceCount + "片" : "") : "",
          };
        }).filter((d) => d.url);
        if (!data.length) { toast("这些宝贝没有照片，无法生成展厅"); return; }
        const encoded = encodeURIComponent(JSON.stringify(data));
        // 用当前脚本所在目录拼 gallery.html（兼容 GitHub Pages 子路径）
        const here = location.href.split("#")[0];
        const base = here.slice(0, here.lastIndexOf("/")) + "/gallery.html";
        const link = base + "?data=" + encoded;
        // 复制到剪贴板并尝试系统分享
        let shown = false;
        if (navigator.share) {
          try { await navigator.share({ title: "我的收藏展厅", text: "看看我的藏品：", url: link }); shown = true; } catch (e) {}
        }
        if (!shown) {
          try { await navigator.clipboard.writeText(link); toast("展厅链接已复制，发给朋友吧！"); }
          catch (e) { toast("链接：" + link); }
        }
      } catch (err) { toast("生成链接失败：" + err.message); }
      finally { btn.disabled = false; btn.textContent = "🔗 动态展厅"; }
    };
    // 左右滑动（触摸）
    bindFavSwipe();
  }

  /* 左右滑动切换喜欢页 */
  function bindFavSwipe() {
    const stage = view.querySelector(".fav-stage");
    if (!stage) return;
    let sx = 0;
    stage.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) { if (dx < 0) { favIdx++; } else { favIdx--; } renderFavPage(); }
    }, { passive: true });
  }


  /* 状态快捷切换绑定（卡片 + 列表）：
   * 拼图：待拼↔已拼 直接切换；珠子：点击弹出状态选择器；均已送人除外 */
  function bindStatusToggles() {
    view.querySelectorAll(".status-toggle").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const item = allItems.find((x) => x.id === b.dataset.id);
      if (!item || item.gifted) return;
      if (Categories.isPuzzleCategory(item.category || "")) {
        // 拼图 2 态直接切换
        const cur = item.playStatus || "";
        const next = cur === "puzzle_done" ? "puzzle_pending" : "puzzle_done";
        const prev = cur;
        item.playStatus = next;
        const label = next === "puzzle_done" ? "已拼" : "待拼";
        try {
          const saved = await DB.put(item);
          if (!saved || saved.playStatus !== next) { item.playStatus = prev; toast("⚠️ 状态未保存：数据库缺少 play_status 字段"); }
          else { toast("已切换为「" + label + "」"); refreshAfterToggle(); }
        } catch (err) { item.playStatus = prev; toast("切换失败：" + err.message); }
      } else {
        // 珠子类：弹出状态选择器
        showBeadStatusPicker(item);
      }
    }));
  }

  function refreshAfterToggle() {
    if (document.getElementById("gridHolder")) updateGrid();
    else if (location.hash.startsWith("#/box/")) renderBoxPage(decodeURIComponent(location.hash.slice(6)));
    else router();
  }

  /* 珠子状态选择器：底部弹层，含"今日盘过"快捷按钮 */
  function showBeadStatusPicker(item) {
    const mask = $("#modalMask");
    const modal = $("#modal");
    const cur = item.playStatus || "unplayed";
    let html = '<h3 style="text-align:center">' + esc(item.name || "未命名") + "</h3>";
    html += '<p style="text-align:center;color:var(--text-2);font-size:13px;margin-bottom:12px">' + esc(beadStatusText(item)) + "</p>";
    html += '<div style="display:flex;flex-direction:column;gap:8px">';
    BEAD_STATUS.forEach((s) => {
      const active = cur === s.v ? 'style="background:var(--wood);color:#f5f0e8"' : "";
      html += '<button type="button" class="btn ghost" data-st="' + s.v + '" style="flex:1;text-align:center;' + (cur === s.v ? 'background:var(--wood);color:#f5f0e8;border-color:var(--wood)' : '') + '">' +
        (cur === s.v ? "✓ " : "") + s.label + "</button>";
    });
    html += "</div>";
    // 今日盘过（记录今天盘了 → 状态为盘玩中，放置时长从今天算起）
    html += '<button type="button" id="btnPlayedToday" class="btn primary" style="width:100%;margin-top:12px">✅ 今日盘过（记录今天盘了它）</button>';
    html += '<button type="button" id="mCancel" class="btn ghost" style="width:100%;margin-top:8px">关闭</button>';

    modal.innerHTML = html;
    modal.hidden = false; modal.style.display = "";
    mask.hidden = false;

    const done = () => { modal.hidden = true; modal.style.display = ""; mask.hidden = true; };
    $("#mCancel").onclick = done;

    modal.querySelectorAll("[data-st]").forEach((btn) => btn.onclick = async () => {
      const st = btn.dataset.st;
      const prev = item.playStatus;
      item.playStatus = st;
      try {
        const saved = await DB.put(item);
        if (!saved || saved.playStatus !== st) { item.playStatus = prev; toast("⚠️ 状态未保存：缺少 play_status 字段"); }
        else {
          done();
          // 🎉 挂瓷开沁：就在这一刻掷性别（男女 3:1），之后不可更改
          if (st === "done" && prev !== "done") {
            const b = Spirits.born(item);
            if (b.isNew) {
              toast("🎉 它开沁了！是只" + (b.gender === "boy" ? "👦 男孩子" : "👧 女孩子") + "沁灵（性别出生即定，不能改哦）");
            } else {
              toast("已切换为「" + beadStatusLabel(st) + "」");
            }
          } else {
            toast("已切换为「" + beadStatusLabel(st) + "」");
          }
          refreshAfterToggle();
        }
      } catch (err) { item.playStatus = prev; toast("切换失败：" + err.message); }
    });

    $("#btnPlayedToday").onclick = async () => {
      try {
        await markPlayedToday(item);
        done();
        toast(item.playStatus === "done" ? "✅ 已记录保养盘玩，保持已挂瓷" : "✅ 已记录今天盘过，开始放置");
        refreshAfterToggle();
      } catch (err) {
        toast("记录失败：" + err.message);
      }
    };
  }

  /* 手动设置上次盘玩时间（用于精确计算放置时长） */
  function promptSetLastPlayed(item, onDone) {
    const mask = $("#modalMask");
    const modal = $("#modal");
    const cur = item.lastPlayedAt ? new Date(item.lastPlayedAt) : new Date();
    const curVal = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0") + "-" + String(cur.getDate()).padStart(2, "0");
    // 昨天日期作为快捷选项
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yDay = y.getFullYear() + "-" + String(y.getMonth() + 1).padStart(2, "0") + "-" + String(y.getDate()).padStart(2, "0");
    const y2 = new Date(); y2.setDate(y2.getDate() - 2);
    const yDay2 = y2.getFullYear() + "-" + String(y2.getMonth() + 1).padStart(2, "0") + "-" + String(y2.getDate()).padStart(2, "0");

    let html = '<h3 style="text-align:center">设置上次盘玩时间</h3>';
    html += '<p style="text-align:center;color:var(--text-2);font-size:12px;margin-bottom:12px">放置时长 = 今天 − 上次盘玩时间，够 1 天才能再被抽到</p>';
    html += '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<button type="button" class="btn ghost" data-d="' + yDay + '" style="flex:1">昨天</button>' +
      '<button type="button" class="btn ghost" data-d="' + yDay2 + '" style="flex:1">前天</button>' +
      '<button type="button" class="btn ghost" data-d="__clear" style="flex:1">清除</button>' +
      '</div>';
    html += '<input class="form-input" id="lpDate" type="date" value="' + curVal + '">';
    html += '<button type="button" id="lpSave" class="btn primary" style="width:100%;margin-top:10px">保存</button>';
    html += '<button type="button" id="mCancel" class="btn ghost" style="width:100%;margin-top:8px">取消</button>';

    modal.innerHTML = html;
    modal.hidden = false; modal.style.display = "";
    mask.hidden = false;

    const done = () => { modal.hidden = true; modal.style.display = ""; mask.hidden = true; };
    $("#mCancel").onclick = done;

    modal.querySelectorAll("[data-d]").forEach((btn) => btn.onclick = () => {
      const dv = btn.dataset.d;
      if (dv === "__clear") { $("#lpDate").value = ""; }
      else { $("#lpDate").value = dv; }
    });

    $("#lpSave").onclick = async () => {
      const dv = $("#lpDate").value;
      const prevT = item.lastPlayedAt;
      const prevC = item.playCount;
      const prevF = item.firstPlayedAt;
      item.lastPlayedAt = dv ? new Date(dv + "T12:00:00").getTime() : null;
      // 已挂瓷：保持状态，仅更新盘玩时间；否则未盘玩的串设了时间自动转盘玩中
      if (dv) {
        if (item.playStatus !== "done") {
          if (item.playStatus === "unplayed" || !item.playStatus) item.playStatus = "playing";
        }
      }
      // 设置了一次盘玩时间 → 记为一次盘玩次数，并补记首次盘玩时间
      if (dv) {
        item.playCount = (item.playCount || 0) + 1;
        if (!item.firstPlayedAt || item.lastPlayedAt < item.firstPlayedAt) item.firstPlayedAt = item.lastPlayedAt;
      }
      try {
        const saved = await DB.put(item);
        if (!saved || (saved.lastPlayedAt === null && dv)) { item.lastPlayedAt = prevT; item.playCount = prevC; item.firstPlayedAt = prevF; toast("⚠️ 未保存：缺少 last_played_at 字段"); }
        else { done(); toast(dv ? "✅ 已设置上次盘玩时间" : "已清除盘玩时间"); onDone && onDone(); }
      } catch (err) { item.lastPlayedAt = prevT; item.playCount = prevC; item.firstPlayedAt = prevF; toast("保存失败：" + err.message); }
    };
  }

  /* 手动设置「首次盘玩时间」（用于看从开始盘到盘好用了多久） */
  function promptSetFirstPlayed(item, onDone) {
    const mask = $("#modalMask");
    const modal = $("#modal");
    const cur = item.firstPlayedAt ? new Date(item.firstPlayedAt) : new Date();
    const curVal = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0") + "-" + String(cur.getDate()).padStart(2, "0");

    let html = '<h3 style="text-align:center">设置首次盘玩时间</h3>';
    html += '<p style="text-align:center;color:var(--text-2);font-size:12px;margin-bottom:12px">这是你第一次开始盘它的时间，用来算「从开始盘到盘好」用了多久</p>';
    html += '<input class="form-input" id="fpDate" type="date" value="' + curVal + '">';
    html += '<button type="button" id="fpSave" class="btn primary" style="width:100%;margin-top:10px">保存</button>';
    html += '<button type="button" id="fpClear" class="btn ghost" style="width:100%;margin-top:8px">清除首次盘玩时间</button>';
    html += '<button type="button" id="mCancel" class="btn ghost" style="width:100%;margin-top:8px">取消</button>';

    modal.innerHTML = html;
    modal.hidden = false; modal.style.display = "";
    mask.hidden = false;

    const done = () => { modal.hidden = true; modal.style.display = ""; mask.hidden = true; };
    $("#mCancel").onclick = done;

    async function save(v) {
      const prev = item.firstPlayedAt;
      item.firstPlayedAt = v;
      try {
        const saved = await DB.put(item);
        if (!saved || (v && !saved.firstPlayedAt)) {
          item.firstPlayedAt = prev;
          toast("⚠️ 未保存：数据库缺 first_played_at 字段（请执行 alter SQL）");
          return;
        }
        done();
        toast(v ? "✅ 已设置首次盘玩时间" : "已清除首次盘玩时间");
        onDone && onDone();
      } catch (err) { item.firstPlayedAt = prev; toast("保存失败：" + err.message); }
    }
    $("#fpSave").onclick = () => {
      const dv = $("#fpDate").value;
      if (!dv) { toast("请选择日期"); return; }
      save(new Date(dv + "T12:00:00").getTime());
    };
    $("#fpClear").onclick = () => save(null);
  }

  /* 设置主色弹窗 */
  function promptSetColor(item, onDone) {
    const mask = $("#modalMask");
    const modal = $("#modal");
    const cur = item.color || "other";
    let html = '<h3 style="text-align:center">主色</h3>';
    html += '<p style="text-align:center;color:var(--text-2);font-size:12px;margin-bottom:12px">选择这件宝贝的主色</p>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    (window.Color ? window.Color.COLOR_LIST : []).forEach((c) => {
      const active = cur === c.v ? ' style="outline:3px solid var(--gold)"' : "";
      const dotStyle = c.hex === "mix" ? 'background:linear-gradient(135deg,#e53935,#fbc02d,#4caf50,#1976d2)' : ("background:" + c.hex);
      const dotBorder = c.v === "white" ? "border:1px solid #ddd" : "";
      html += '<button type="button" data-color="' + c.v + '" class="btn ghost" style="flex-direction:column;gap:6px;padding:10px;' + (cur === c.v ? "border-color:var(--gold)" : "") + '"' + active + '>' +
        '<span style="display:block;width:26px;height:26px;border-radius:50%;margin:0 auto;' + dotStyle + ';' + dotBorder + '"></span>' +
        '<span style="font-size:12px">' + c.label + "</span></button>";
    });
    html += "</div>";
    html += '<button type="button" id="mCancel" class="btn ghost" style="width:100%;margin-top:12px">关闭</button>';

    modal.innerHTML = html;
    modal.hidden = false; modal.style.display = "";
    mask.hidden = false;

    const done = () => { modal.hidden = true; modal.style.display = ""; mask.hidden = true; };
    $("#mCancel").onclick = done;

    modal.querySelectorAll("[data-color]").forEach((btn) => btn.onclick = async () => {
      const v = btn.dataset.color;
      const prev = item.color;
      item.color = v;
      try {
        const saved = await DB.put(item);
        if (!saved || (saved.color || "other") !== v) { item.color = prev; toast("⚠️ 未保存：缺少 color 字段"); }
        else { done(); toast("已设置主色：" + (window.Color ? window.Color.colorLabel(v) : v)); onDone && onDone(); }
      } catch (err) { item.color = prev; toast("保存失败：" + err.message); }
    });
  }

  /* 珠型选择弹窗（详情页"设置/修改珠型"） */
  function promptSetShape(item, onDone) {
    const mask = $("#modalMask");
    const modal = $("#modal");
    const cur = item.beadShape || "";
    let html = '<h3 style="text-align:center">珠型</h3>';
    html += '<p style="text-align:center;color:var(--text-2);font-size:12px;margin-bottom:12px">选择这件宝贝的珠型</p>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
    SHAPE_LIST.forEach((s) => {
      const on = cur === s.v;
      html += '<button type="button" data-shape="' + s.v + '" class="btn ghost" style="padding:10px 4px;' + (on ? "border-color:var(--gold);outline:2px solid var(--gold)" : "") + '">' + esc(s.label) + "</button>";
    });
    html += "</div>";
    html += '<button type="button" id="mClearShape" class="btn ghost" style="width:100%;margin-top:10px">清除珠型</button>';
    html += '<button type="button" id="mCancel" class="btn ghost" style="width:100%;margin-top:8px">关闭</button>';

    modal.innerHTML = html;
    modal.hidden = false; modal.style.display = "";
    mask.hidden = false;

    const done = () => { modal.hidden = true; modal.style.display = ""; mask.hidden = true; };
    $("#mCancel").onclick = done;

    async function saveShape(v) {
      const prev = item.beadShape;
      item.beadShape = v;
      try {
        const saved = await DB.put(item);
        if (!saved || (saved.beadShape || "") !== v) { item.beadShape = prev; toast("⚠️ 未保存：缺少 bead_shape 字段"); }
        else { done(); toast(v ? "已设置珠型：" + shapeLabel(v) : "已清除珠型"); onDone && onDone(); }
      } catch (err) { item.beadShape = prev; toast("保存失败：" + err.message); }
    }
    $("#mClearShape").onclick = () => saveShape("");
    modal.querySelectorAll("[data-shape]").forEach((btn) => btn.onclick = () => saveShape(btn.dataset.shape));
  }

  /* 修改密码弹窗 */
  function showChangePasswordModal() {
    const mask = $("#modalMask");
    const modal = $("#modal");
    let html = '<h3 style="text-align:center">🔑 修改密码</h3>';
    html += '<p style="text-align:center;color:var(--text-2);font-size:12px;margin-bottom:12px">设置一个至少 6 位的新密码</p>';
    html += '<div style="display:flex;flex-direction:column;gap:10px">';
    html += '<input class="form-input" id="pwdNew" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password">';
    html += '<input class="form-input" id="pwdConfirm" type="password" placeholder="再次输入新密码" autocomplete="new-password">';
    html += "</div>";
    html += '<div id="pwdMsg" style="text-align:center;font-size:12px;color:var(--red);margin-top:8px;min-height:16px"></div>';
    html += '<button type="button" id="pwdSave" class="btn primary" style="width:100%;margin-top:12px">确认修改</button>';
    html += '<button type="button" id="mCancel" class="btn ghost" style="width:100%;margin-top:8px">取消</button>';

    modal.innerHTML = html;
    modal.hidden = false; modal.style.display = "";
    mask.hidden = false;

    const done = () => { modal.hidden = true; modal.style.display = ""; mask.hidden = true; };
    const msg = $("#pwdMsg");
    $("#mCancel").onclick = done;

    $("#pwdSave").onclick = async () => {
      const np = $("#pwdNew").value;
      const cp = $("#pwdConfirm").value;
      if (!np || np.length < 6) { msg.textContent = "密码至少 6 位"; return; }
      if (np !== cp) { msg.textContent = "两次输入的密码不一致"; return; }
      const btn = $("#pwdSave");
      btn.disabled = true; btn.textContent = "修改中…";
      msg.textContent = "";
      try {
        await DB.updatePassword(np);
        done();
        toast("✅ 密码已修改，下次登录用新密码");
      } catch (err) {
        msg.textContent = "修改失败：" + (String(err && err.message).includes("validate") ? "密码不符合要求" : err.message);
      } finally {
        btn.disabled = false; btn.textContent = "确认修改";
        $("#pwdNew").value = ""; $("#pwdConfirm").value = "";
      }
    };
  }

  /* ---------- 今日心选抽卡 ---------- */
  function drawStorageKey() {
    const d = new Date();
    return "ww_draw_" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function getDrawResult() {
    try { return JSON.parse(localStorage.getItem(drawStorageKey())) || null; } catch (e) { return null; }
  }
  function setDrawResult(result) {
    try { localStorage.setItem(drawStorageKey(), JSON.stringify(result)); } catch (e) {}
  }

  // 渲染抽卡栏目 HTML（未抽：显示抽取按钮；已抽：显示 3 串）
  function renderDrawSection() {
    const res = getDrawResult();
    if (!res) {
      return '<div class="draw-card">' +
        '<div class="draw-head"><span class="draw-title">🎴 今日心选</span><span class="draw-sub">从待盘玩/盘玩中/已挂瓷里抽 3 串</span></div>' +
        '<button type="button" class="btn primary" id="btnDraw" style="width:100%">✨ 抽取今日心选串串</button>' +
        '<div class="draw-empty">点一下，今天盘这三串</div>' +
        "</div>";
    }
    const items = (res.items || []);
    const cards = items.map((it) => {
      const p = it.photos && it.photos[0];
      const img = p ? '<img src="' + photoUrl(p) + '" alt="">' : '<div class="placeholder" style="font-size:26px">📿</div>';
      const st = it.playStatus || "unplayed";
      const stTxt = it.category && isPuzzleCat(it.category) ? (it.playStatus === "puzzle_done" ? "已拼" : "待拼") : beadStatusText(it);
      return '<div class="draw-item" data-id="' + it.id + '">' +
        '<div class="draw-thumb">' + img + '<span class="draw-status">' + esc(stTxt) + "</span></div>" +
        '<div class="draw-name">' + esc(it.name || "未命名") + "</div>" +
        '<div class="draw-sub">' + esc(cardSubText(it)) + "</div>" +
        "</div>";
    }).join("");
    return '<div class="draw-card">' +
      '<div class="draw-head"><span class="draw-title">🎴 今日心选</span><span class="draw-sub">' + res.date + ' · 点击可重新抽</span>' +
      '<button type="button" class="draw-redraw" id="btnRedraw">🔄 重抽</button></div>' +
      '<div class="draw-grid">' + cards + "</div>" +
      "</div>";
  }

  /* 标记「今日已盘」：记录今天盘过（lastPlayedAt=现在、状态=盘玩中、盘玩次数+1）
     同时把今天加入打卡日期（连续打卡）；与详情页「✅ 今日盘过」同一套逻辑 */
  async function markPlayedToday(item) {
    const prevT = item.lastPlayedAt, prevSt = item.playStatus, prevC = item.playCount, prevF = item.firstPlayedAt;
    item.lastPlayedAt = Date.now();
    // 已挂瓷：盘玩时间照常更新，但状态保持「已挂瓷」，不可退回「盘玩中」
    if (item.playStatus !== "done") item.playStatus = "playing";
    item.playCount = (item.playCount || 0) + 1;
    if (!item.firstPlayedAt) item.firstPlayedAt = item.lastPlayedAt; // 记录「第一次盘玩时间」
    try {
      const saved = await DB.put(item);
      if (!saved || (saved.lastPlayedAt == null && saved.playStatus !== "playing")) {
        item.lastPlayedAt = prevT; item.playStatus = prevSt; item.playCount = prevC; item.firstPlayedAt = prevF;
        throw new Error("未保存：数据库缺 last_played_at 字段（请执行 alter SQL）");
      }
      // 记录今天的打卡（用于连续打卡；失败不阻断主流程）
      await recordPlayDay();
      return true;
    } catch (err) {
      item.lastPlayedAt = prevT; item.playStatus = prevSt; item.playCount = prevC; item.firstPlayedAt = prevF;
      throw err;
    }
  }

  // 把「今天」记入打卡日期并保存（幂等：今天已存在则不重复）
  async function recordPlayDay() {
    const tk = Game.todayKey();
    if (playDays.includes(tk)) return true;      // 今天已记过
    const prev = playDays.slice();
    playDays = Game.normDays(playDays.concat([tk]));
    try {
      const ok = await DB.setPlayDays(user.id, playDays);
      if (!ok) { /* 缺 play_days 列：本机保留、提示一次 */ 
        if (!recordPlayDay._warned) { recordPlayDay._warned = true; toast("🔥 连续打卡已在本机记录；云端未保存（profiles 缺 play_days 列，请执行 alter SQL）"); }
      }
      return ok;
    } catch (e) {
      playDays = prev;                            // 保存失败则回滚
      return false;
    }
  }

  /* ---------- 盘玩计划（轻量提醒，非打卡；紧凑网格 3-4/行，最多 2 行） ---------- */
  function renderPlayPlanSection() {
    const plan = Game.playPlan(allItems); // 全部候选池
    // 展示数量：小于 3 个 → 有几个展示几个；≥3 按档位 3/6/9（最多 9）
    const t = plan.total;
    const tier = t === 0 || t === 1 || t === 2 ? t : t >= 9 ? 9 : t >= 6 ? 6 : 3;
    const shown = plan.items.slice(0, tier);
    const urgentCount = shown.filter((x) => x.urgent).length;
    const moreCount = plan.total - shown.length;

    let bodyHtml;
    if (!shown.length) {
      // 没有需要盘的串：显示好玩文案（随机挑一条）
      const chill = [
        "没有需要盘的串，雨露均沾的无情铁手太棒了 🙌",
        "所有串都盘得妥妥的，你简直是不知疲倦的无情铁手 ✋",
        "最近没有串在等你，去喝杯茶享受一下吧 🍵",
        "盘玩计划空空如也，你的手是真的稳 👏",
      ];
      bodyHtml = '<div class="plan-empty">' + (chill[Math.floor(Math.random() * chill.length)]) + "</div>";
    } else {
      const cells = shown.map((x) => {
        const it = x.item;
        const p = it.photos && it.photos[0];
        const img = p ? '<img src="' + photoUrl(p) + '" loading="lazy" alt="">' : '<div class="placeholder">📿</div>';
        return '<div class="plan-cell" data-id="' + it.id + '" title="' + esc(it.name || "未命名") + '（点这里看详情）">' +
          '<div class="plan-photo">' + img +
          '<button type="button" class="plan-done-btn" data-id="' + it.id + '" title="今天盘过它了？点一下打卡">✓</button>' +
          "</div>" +
          '<div class="plan-name" title="' + esc(it.name || "未命名") + '">' + esc(clipName(it.name, NAME_MAX.plan)) + "</div>" +
          '<div class="plan-days' + (x.urgent ? " urgent" : "") + '">' + esc(x.text) + "</div>" +
          "</div>";
      }).join("");
      bodyHtml = '<div class="plan-grid">' + cells + "</div>";
    }

    // 连续打卡（当前 / 历史最长）
    const streakNow = Game.currentStreak(playDays);
    const streakBest = Game.bestStreak(playDays);
    const streakTxt = streakNow >= 1
      ? '<span class="plan-streak" title="当前连续打卡 ' + streakNow + ' 天；历史最长 ' + streakBest + ' 天">🔥 连续 ' + streakNow + ' 天</span>'
      : (streakBest >= 2 ? '<span class="plan-streak dim" title="历史最长 ' + streakBest + ' 天，今天还没打卡">🔥 最长 ' + streakBest + ' 天</span>' : "");

    return '<div class="plan-card">' +
      '<div class="draw-head"><span class="draw-title">🧭 盘玩计划</span>' + streakTxt +
      '<span class="draw-sub">' + (urgentCount ? urgentCount + " 串该盘啦" : (shown.length ? "顺手盘一串" : "全部盘得很好")) +
      (moreCount > 0 ? " · 还有 " + moreCount + " 串" : "") +
      (shown.length ? " · 点 ✓ 记今日已盘" : "") + "</span></div>" +
      bodyHtml +
      "</div>";
  }

  /* ---------- 多选分享模式 ---------- */
  /* ---------- 多选操作模式（分享 + 批量编辑） ---------- */
  function enterShareMode() {
    const selected = new Set();
    const list = filtered();
    const MAX_SELECT = 20;
    // 整个多选/批量编辑流程：顶栏返回都回首页
    _onBack = () => { renderHome(); location.hash = "#/"; window.scrollTo(0, 0); };

    function render() {
      topbarTitle.textContent = "多选操作";
      btnBack.style.visibility = "visible";
      btnSettings.style.visibility = "hidden";

      let html = "";
      html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:10px">已选 ' + selected.size + ' 个，点击勾选（最多 ' + MAX_SELECT + ' 个）</div>';
      html += '<div class="list-view">';
      list.forEach((it) => {
        const p = it.photos && it.photos[0];
        const img = p ? '<img src="' + photoUrl(p) + '" alt="">' : '<div class="placeholder" style="font-size:20px">📿</div>';
        const checked = selected.has(it.id);
        // 主色标签
        const colorTag = colorTagHtml(it);
        // 珠型标签
        const shapeTag = shapeTagHtml(it);
        // 软糯程度标签
        const softTag = softnessTagHtml(it);
        // 盘玩状态标签（珠子/拼图）
        const isPuzzleIt = isPuzzleCat(it.category || "");
        const isBeadIt = isBeadCat(it.category || "");
        const statusTxt = it.gifted ? "已送人" :
          (isPuzzleIt ? (it.playStatus === "puzzle_done" ? "已拼" : "待拼") :
            isBeadIt ? beadStatusText(it) : "");
        const statusCls = it.gifted ? "r" :
          (isPuzzleIt ? (it.playStatus === "puzzle_done" ? "g" : "yl") :
            isBeadIt ? beadStatusCls(it) : "");
        const statusTag = statusTxt
          ? '<span class="list-status ' + statusCls + '">' + esc(statusTxt) + "</span>"
          : "";
        html += '<div class="list-item multi-item' + (checked ? " checked" : "") + '" data-id="' + it.id + '">' +
          '<div class="list-thumb">' + img + "</div>" +
          '<div class="list-info">' +
          '<div class="list-name">' + esc(clipName(it.name, NAME_MAX.list)) + "</div>" +
          '<div class="list-sub">' + esc(cardSubText(it)) + (it.category ? " · " + esc(it.category) : "") + "</div>" +
          '<div class="list-meta">' + colorTag + shapeTag + statusTag + "</div>" +
          "</div>" +
          '<span class="multi-check">' + (checked ? "✓" : "") + "</span>" +
          "</div>";
      });
      html += "</div>";

      if (!list.length) {
        html = '<div class="empty"><div class="empty-icon">📤</div><p>没有可操作的宝贝</p></div>';
      }

      // 操作按钮：批量编辑 + 分享
      html += '<div class="detail-actions" style="margin-top:16px">';
      html += '<button class="btn ghost" id="sCancel" style="flex:1">取消</button>';
      html += '<button class="btn primary" id="sBatch" style="flex:2"' + (selected.size ? "" : " disabled") + '>⚙ 批量编辑 (' + selected.size + ')</button>';
      html += "</div>";
      html += '<button class="btn ghost" id="sShare" style="width:100%;margin-top:10px"' + (selected.size ? "" : " disabled") + '>📤 生成图鉴海报 (' + selected.size + ')</button>';

      view.innerHTML = html;

      view.querySelectorAll(".list-item.multi-item").forEach((c) => c.addEventListener("click", () => {
        const id = c.dataset.id;
        if (selected.has(id)) selected.delete(id);
        else {
          if (selected.size >= MAX_SELECT) { toast("最多选择 " + MAX_SELECT + " 个"); return; }
          selected.add(id);
        }
        render();
      }));
      $("#sCancel").onclick = () => {
        renderHome();
        location.hash = "#/";
        window.scrollTo(0, 0);
      };
      $("#sShare").onclick = async () => {
        const items = allItems.filter((i) => selected.has(i.id));
        if (!items.length) { toast("请先选择宝贝"); return; }
        const btn = $("#sShare");
        btn.textContent = "生成中…";
        btn.disabled = true;
        try {
          const canvas = await Poster.galleryPoster(items, { username: user && user.displayName ? user.displayName : "" });
          await Poster.shareCanvas(canvas, "我的收藏图鉴.jpg");
          toast("图鉴海报已分享/保存");
          renderHome();
          location.hash = "#/";
          window.scrollTo(0, 0);
          return;
        } catch (err) {
          // 用户取消系统分享不算失败：也返回首页
          if (String(err && err.message).includes("share") || String(err && err.message).includes("abort")) {
            toast("已取消分享");
            renderHome();
            location.hash = "#/";
            window.scrollTo(0, 0);
            return;
          }
          toast("生成失败：" + err.message);
          btn.textContent = "📤 生成图鉴海报";
          btn.disabled = false;
        }
      };
      $("#sBatch").onclick = () => {
        const items = allItems.filter((i) => selected.has(i.id));
        if (!items.length) { toast("请先选择宝贝"); return; }
        renderBatchEdit(items);
      };
    }

    /* ---------- 批量编辑面板 ---------- */
    function renderBatchEdit(items) {
      topbarTitle.textContent = "批量编辑 " + items.length + " 个宝贝";
      btnBack.style.visibility = "visible";
      btnSettings.style.visibility = "hidden";
      // 顶栏返回：回首页（批量编辑页无独立 hash，避免跳向旧历史/批量导入）
      _onBack = () => { renderHome(); location.hash = "#/"; window.scrollTo(0, 0); };

      let html = "";
      html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:12px">对选中的 ' + items.length + ' 个宝贝执行以下操作：</div>';

      // 批量转移分类
      html += '<div class="batch-op">' +
        '<div class="batch-op-title">📦 转移收藏盒子</div>' +
        '<div style="display:flex;gap:8px">' +
        '<select class="form-select" id="bCat" style="flex:1">' + categoryOptions("") + "</select>" +
        '<button class="btn primary" id="bApplyCat" style="flex:none;padding:9px 14px;font-size:13px">应用</button></div></div>';

      // 批量设置状态
      html += '<div class="batch-op">' +
        '<div class="batch-op-title">🚦 设置状态</div>' +
        '<div style="display:flex;gap:8px">' +
        '<select class="form-select" id="bStatus" style="flex:1">' +
        '<option value="">不修改</option>' +
        '<option value="unplayed">未盘玩</option>' +
        '<option value="ready">待盘玩</option>' +
        '<option value="playing">盘玩中</option>' +
        '<option value="done">已挂瓷</option>' +
        '<option value="wearing">佩戴中</option>' +
        '<option value="puzzle_pending">待拼</option>' +
        '<option value="puzzle_done">已拼</option>' +
        '<option value="gifted">已送人</option>' +
        "</select>" +
        '<button class="btn primary" id="bApplyStatus" style="flex:none;padding:9px 14px;font-size:13px">应用</button></div></div>';

      // 批量设置上次盘玩时间（日期选择器）
      html += '<div class="batch-op">' +
        '<div class="batch-op-title">⏱️ 批量设置上次盘玩时间（日历选择）</div>' +
        '<div style="display:flex;gap:8px">' +
        '<input class="form-input" id="bLastPlayed" type="date" style="flex:1">' +
        '<button class="btn primary" id="bApplyLastPlayed" style="flex:none;padding:9px 14px;font-size:13px">应用</button>' +
        "</div>" +
        '<div style="font-size:11px;color:var(--text-2);margin-top:6px">不填日期直接点应用 = 清除上次盘玩时间；填了日期则设为该日（并自动转盘玩中）</div></div>';

      // 批量设置珠子大小/拼图片数（按分类自动判断）
      html += '<div class="batch-op">' +
        '<div class="batch-op-title">📏 设置大小（珠子mm / 拼图片数）</div>' +
        '<div style="display:flex;gap:8px">' +
        '<input class="form-input" id="bSize" type="number" placeholder="如 14 或 1000" style="flex:1">' +
        '<button class="btn primary" id="bApplySize" style="flex:none;padding:9px 14px;font-size:13px">应用</button></div></div>';

      // 批量设置品种/品牌
      html += '<div class="batch-op">' +
        '<div class="batch-op-title">🏷️ 设置品种 / 品牌</div>' +
        '<div style="display:flex;gap:8px">' +
        '<input class="form-input" id="bSpecies" placeholder="如：库克 / HEYE" style="flex:1">' +
        '<button class="btn primary" id="bApplySpecies" style="flex:none;padding:9px 14px;font-size:13px">应用</button></div></div>';

      // 批量设置主色
      {
        let colorChips = '<button type="button" class="color-chip' + (!"" ? " active" : "") + '" data-bcolor="">未选</button>';
        (window.Color ? window.Color.COLOR_LIST : []).forEach((c) => {
          const dotStyle = c.v === "duo" || c.v === "lightflower" || c.v === "deepflower" ? 'background:linear-gradient(135deg,#e53935,#fbc02d,#4caf50,#1976d2)' : ("background:" + c.hex);
          const dotBorder = c.v === "white" ? "border:1px solid #ddd" : "";
          colorChips += '<button type="button" class="color-chip" data-bcolor="' + c.v + '" style="display:inline-flex;align-items:center;gap:5px">' +
            '<span style="display:block;width:16px;height:16px;border-radius:50%;' + dotStyle + ';' + dotBorder + '"></span>' + c.label + "</button>";
        });
        html += '<div class="batch-op">' +
          '<div class="batch-op-title">🎨 批量设置主色</div>' +
          '<div class="filters" id="bColorChips" style="margin-bottom:8px">' + colorChips + "</div>" +
          '<button class="btn primary" id="bApplyColor" style="width:100%">应用到所选宝贝</button></div>';
      }

      // 批量设置珠型（选「未选」= 清空所选宝贝的珠型）
      {
        let shapeChips = '<button type="button" class="color-chip" data-bshape="">未选</button>';
        SHAPE_LIST.forEach((s) => {
          shapeChips += '<button type="button" class="color-chip" data-bshape="' + s.v + '">' + esc(s.label) + "</button>";
        });
        html += '<div class="batch-op">' +
          '<div class="batch-op-title">📿 批量设置珠型</div>' +
          '<div class="filters" id="bShapeChips" style="margin-bottom:8px">' + shapeChips + "</div>" +
          '<button class="btn primary" id="bApplyShape" style="width:100%">应用到所选宝贝</button></div>';
      }

      // 批量删除
      html += '<div class="batch-op" style="border-color:#f8bbd0">' +
        '<div class="batch-op-title" style="color:var(--red)">🗑️ 批量删除（' + items.length + ' 个）</div>' +
        '<button class="btn danger" id="bDelete" style="width:100%">确认删除所选宝贝</button></div>';

      html += '<div style="display:flex;gap:10px;margin-top:10px">' +
        '<button class="btn ghost" id="bCancelBatch" style="flex:1">取消</button>' +
        '<button class="btn primary" id="bDone" style="flex:1">完成</button></div>';

      view.innerHTML = html;

      // 转移分类
      $("#bApplyCat").onclick = async () => {
        const cat = $("#bCat").value;
        if (!cat) { toast("请选择目标盒子"); return; }
        await applyToItems(items, async (it) => { it.category = cat; });
      };
      // 设置状态
      $("#bApplyStatus").onclick = async () => {
        const st = $("#bStatus").value;
        if (!st) { toast("请选择目标状态"); return; }
        await applyToItems(items, async (it) => {
          it.playStatus = st === "gifted" ? "" : normBeadStatus(st, it.category);
          it.gifted = st === "gifted";
          if (!it.gifted) it.giftedAt = null;
          it.played = it.playStatus === "playing";
        });
      };
      // 批量设置上次盘玩时间（日历选择：填日期=设为该日；不填=清除）
      $("#bApplyLastPlayed").onclick = async () => {
        const dv = $("#bLastPlayed").value;
        if (!dv) {
          await applyToItems(items, async (it) => { it.lastPlayedAt = null; });
        } else {
          const t = new Date(dv + "T12:00:00").getTime();
          await applyToItems(items, async (it) => { it.lastPlayedAt = t; if (it.playStatus !== "done" && (!it.playStatus || it.playStatus === "unplayed")) it.playStatus = "playing"; });
        }
      };
      // 设置大小
      $("#bApplySize").onclick = async () => {
        const v = parseFloat($("#bSize").value);
        if (isNaN(v)) { toast("请输入数字"); return; }
        await applyToItems(items, async (it) => {
          const f = Categories.getSizeField(it.category || "");
          if (f === "pieces") { it.pieceCount = v; it.beadSize = null; }
          else if (f === "bead") { it.beadSize = v; it.pieceCount = null; }
        });
      };
      // 设置品种/品牌
      $("#bApplySpecies").onclick = async () => {
        const v = $("#bSpecies").value.trim();
        if (!v) { toast("请输入品种/品牌"); return; }
        await applyToItems(items, async (it) => {
          it.species = v;
          if (it.category === "动漫周边") it.accessoryType = v;
        });
      };
      // 批量设置主色：chips 选择 + 应用到所选
      let bColorChoice = "";
      const bColorChips = $("#bColorChips");
      if (bColorChips) {
        bColorChips.querySelectorAll(".color-chip").forEach((b) => b.onclick = () => {
          bColorChips.querySelectorAll(".color-chip").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          bColorChoice = b.dataset.bcolor || "";
        });
      }
      $("#bApplyColor").onclick = async () => {
        if (!bColorChoice) { toast("请先选择颜色"); return; }
        await applyToItems(items, async (it) => { it.color = bColorChoice; });
      };
      // 批量设置珠型：chips 选择 + 应用到所选（「未选」= 清空珠型）
      let bShapeChoice = "";
      let bShapePicked = false;
      const bShapeChips = $("#bShapeChips");
      if (bShapeChips) {
        bShapeChips.querySelectorAll(".color-chip").forEach((b) => b.onclick = () => {
          bShapeChips.querySelectorAll(".color-chip").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          bShapeChoice = b.dataset.bshape || "";
          bShapePicked = true;
        });
      }
      $("#bApplyShape").onclick = async () => {
        if (!bShapePicked) { toast("请先选择珠型（选「未选」可清空）"); return; }
        await applyToItems(items, async (it) => { it.beadShape = bShapeChoice; });
      };
      // 批量删除
      $("#bDelete").onclick = async () => {
        const ok = await confirmModal("删除 " + items.length + " 个宝贝？", "删除后不可恢复！", "确认删除", true);
        if (!ok) return;
        for (const it of items) await DB.remove(it.id);
        await loadItems();
        toast("已删除 " + items.length + " 个宝贝");
        location.hash = "#/";
      };
      $("#bDone").onclick = () => {
        _onBack = null;                        // 清空自定义返回
        btnBack.onclick = goBack;              // 恢复全局返回
        renderHome();
        location.hash = "#/";
        window.scrollTo(0, 0);
      };
      $("#bCancelBatch").onclick = () => {
        _onBack = null;
        btnBack.onclick = goBack;
        renderHome();
        location.hash = "#/";
        window.scrollTo(0, 0);
      };

      // 通用应用函数：逐条更新并保存
      async function applyToItems(items, mutator) {
        const btn = view.querySelector("button.active");
        let n = 0;
        try {
          for (const it of items) {
            mutator(it);
            await DB.put(it);
            n++;
          }
          await loadItems();
          toast("已更新 " + n + " 个宝贝 ✅");
          render();
        } catch (err) {
          toast("操作失败：" + translateAuthError(err.message));
        }
      }
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
          '<div class="card-name">' + esc(it.name ? clipName(it.name, NAME_MAX.card) : "未命名·第" + (i + 1) + "条") + "</div>" +
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
        '<select class="form-select" id="dCategory">' + categoryOptions(it.category || (it && it.id ? "" : "菩提")) + '</select></div>';
      html += '<div class="form-group"><div class="form-label">品种/材质</div>' +
        '<input class="form-input" id="dSpecies" value="' + esc(it.species || "") + '" placeholder="可自由填写或点下方选择">' +
        '<div class="species-chips" id="dSpeciesChips"></div></div>';
      html += "</div>";
      html += '<div class="form-group" id="dCraftWrap"><div class="form-label">工艺 <small>珠子类</small></div>' +
        '<div class="seg" id="dCraft">' +
        '<button type="button" data-v="干磨" class="' + (it.craft === "干磨" || !it.craft ? "active" : "") + '">干磨</button>' +
        '<button type="button" data-v="水磨" class="' + (it.craft === "水磨" ? "active" : "") + '">水磨</button>' +
        '<button type="button" data-v="干抛" class="' + (it.craft === "干抛" ? "active" : "") + '">干抛</button>' +
        '<button type="button" data-v="" class="' + (it.craft && it.craft !== "干磨" && it.craft !== "水磨" && it.craft !== "干抛" ? "active" : "") + '">其他</button>' +
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
        BEAD_STATUS.map((s) => statusButton(s.v, s.label, it ? normBeadStatus((it.playStatus || ""), it.category || "菩提") : "unplayed", !it)).join("") +
        statusButton("puzzle_pending", "待拼", it.playStatus || "") +
        statusButton("puzzle_done", "已拼", it.playStatus || "") +
        statusButton("gifted", "已送人", it.playStatus || "") +
        "</div></div>";
      html += '<div class="form-group"><div class="form-label">店铺</div>' +
        '<input class="form-input" id="dShop" value="' + esc(it.shop || "") + '">' +
        shopMemoryHtml(it.shop || "") + "</div>";
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
      // 店铺记忆交互
      view.querySelectorAll(".shop-chip-use").forEach((b) => b.onclick = () => {
        $("#dShop").value = b.dataset.shop;
      });
      view.querySelectorAll(".shop-chip-del").forEach((b) => b.onclick = () => {
        removeShopMemory(b.dataset.shop);
        const shopVal = $("#dShop").value;
        const wrap = b.closest(".shop-memory");
        if (wrap) wrap.outerHTML = shopMemoryHtml(shopVal);
        toast("已删除店铺记忆");
      });
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
        const chips = document.querySelector("#dSpeciesChips");
        if (chips) {
          chips.innerHTML = cfg.options.map((s) =>
            '<button type="button" class="species-chip" data-s="' + esc(s) + '">' + esc(s) + "</button>"
          ).join("");
          chips.querySelectorAll(".species-chip").forEach((b) => b.onclick = () => {
            const inp = document.querySelector("#dSpecies");
            if (inp) inp.value = b.dataset.s;
          });
        }
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
            if (BEAD_STATUS.some((s) => s.v === v)) show = isBeadCat(cat); // 菩提专用（盘玩5态）
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
          h += '<label class="upload-cell upload-add" style="cursor:pointer"><span class="upload-add-inner"><span class="plus">＋</span><span>照片</span></span></label>';
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
            const cf = await ImageUtil.compressFile(f, { maxSizeKB: 200, maxDim: 1920 });
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
        rememberShop(it.shop);
        it.category = $("#dCategory").value.trim();
        const dStatusBtn = document.querySelector("#dStatus button.active");
        if (dStatusBtn) {
          const sv2 = dStatusBtn.dataset.v;
          it.playStatus = sv2 === "gifted" ? "" : normBeadStatus(sv2, it.category);
          it.gifted = sv2 === "gifted";
          if (!it.gifted) it.giftedAt = null;
          it.played = it.playStatus === "playing";
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
        renderHome();
        location.hash = "#/";
        window.scrollTo(0, 0);
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
    const btnLogin = $("#btnLogin");
    const showMsg = (m, ok) => { msgEl.textContent = m; msgEl.style.color = ok ? "var(--green)" : "var(--red)"; };
    // 手机流量不稳：手动重试之外，网络错误自动再试 2 轮（每轮内部还有 3 次 fetch 重试）
    const doAuth = async (auto) => {
      const email = emailEl.value.trim();
      const pass = passEl.value;
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showMsg("请输入正确的邮箱地址"); return; }
      if (pass.length < 6) { showMsg("密码至少 6 位"); return; }
      const maxRound = 3;
      for (let round = 1; round <= maxRound; round++) {
        try {
          if (round > 1 || auto) showMsg("网络不稳定，正在重试（第 " + round + "/" + maxRound + " 次）…", true);
          btnLogin.textContent = round > 1 ? "重试中…" : "登录中…";
          btnLogin.disabled = true;
          const res = await DB.signIn(email, pass);
          btnLogin.textContent = "登 录";
          btnLogin.disabled = false;
          showMsg("登录成功", true);
          await enterApp(res.session);
          return;
        } catch (err) {
          btnLogin.textContent = "登 录";
          btnLogin.disabled = false;
          const text = translateAuthError(err.message);
          const isNet = text.indexOf("网络") === 0 || !navigator.onLine;
          if (isNet && round < maxRound) { await new Promise((r) => setTimeout(r, 800 * round)); continue; }
          showMsg(text + (isNet ? "（已自动重试 " + round + " 次，可点登录再试）" : ""));
          return;
        }
      }
    };
    btnLogin.onclick = () => doAuth(false);
    emailEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(false); });
    passEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(false); });
  }

  function translateAuthError(msg) {
    const m = msg || "";
    if (m.includes("Invalid login credentials")) return "邮箱或密码不正确";
    if (m.includes("User already registered")) return "该邮箱已注册，请直接登录";
    if (m.includes("Email not confirmed")) return "邮箱尚未验证，请查收确认邮件";
    if (m.includes("Password should be")) return "密码长度不符合要求";
    if (m.includes("rate limit") || m.includes("Too many")) return "操作太频繁，请稍后再试";
    if (m.includes("fetch") || m.includes("Network") || m.includes("Failed to fetch") || m.includes("aborted") || m.includes("timeout")) {
      return navigator.onLine === false ? "手机当前没有网络，请检查信号后重试" : "网络不稳定，没能连上服务器";
    }
    return m;
  }

  /* ---------- 离线缓存：网络不稳时也能打开、能看 ---------- */
  let offlineMode = false;        // 当前是不是在用本地缓存（云端读不到）
  function cacheKey() { return "ww_cache_" + ((user && user.id) || "guest"); }
  // 存到本地：只留照片 URL（Blob 存不进 localStorage），去掉 data 避免恢复时 createObjectURL 报错
  function writeItemsCache() {
    try {
      const slim = allItems.map((it) => {
        const o = Object.assign({}, it);
        o.photos = (it.photos || []).filter((p) => p && p.url).map((p) => ({ url: p.url, path: p.path }));
        o.screenshots = (it.screenshots || []).filter((p) => p && p.url).map((p) => ({ url: p.url, path: p.path }));
        delete o._url;
        return o;
      });
      localStorage.setItem(cacheKey(), JSON.stringify({
        at: Date.now(),
        name: (user && user.displayName) || "",
        playDays: playDays,
        items: slim,
      }));
    } catch (e) { /* 空间不足等，忽略 */ }
  }
  function readItemsCache() {
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.items)) return null;
      return obj;
    } catch (e) { return null; }
  }

  /* ---------- 网络状态条（顶部细条：正在重试 / 离线看缓存 + 重试按钮） ---------- */
  let netBarEl = null;
  function netBar() {
    if (netBarEl && document.body.contains(netBarEl)) return netBarEl;
    netBarEl = document.createElement("div");
    netBarEl.className = "net-bar";
    netBarEl.hidden = true;
    netBarEl.innerHTML = '<span class="net-bar-txt"></span><button type="button" class="net-bar-btn" id="netBarBtn">重试</button>';
    document.body.appendChild(netBarEl);
    netBarEl.querySelector("#netBarBtn").onclick = () => {
      if (netBarEl.dataset.mode === "offline") syncNow();
      else toast("网络恢复后会自动同步");
    };
    return netBarEl;
  }
  // 手动/自动重新同步（离线模式用）
  async function syncNow() {
    offlineMode = false;
    toast("正在重新连接…");
    try {
      await loadItems();
      writeItemsCache();
      toast("已同步最新数据 ✅");
      renderHome();
    } catch (e) {
      offlineMode = true;
      toast("还是连不上，继续看本地缓存");
    }
    refreshNetBar();
  }
  // 离线时每 20 秒自动试一次；网络恢复事件 / 切回前台也立刻试
  let _offlineRetryTimer = null;
  function startOfflineRetry() {
    if (_offlineRetryTimer) return;
    _offlineRetryTimer = setInterval(() => {
      if (!offlineMode) { clearInterval(_offlineRetryTimer); _offlineRetryTimer = null; return; }
      syncNow();
    }, 20000);
  }
  function bindOnlineRecovery() {
    window.addEventListener("online", () => { if (offlineMode) syncNow(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && offlineMode) syncNow(); });
  }
  function refreshNetBar(state) {
    const el = netBar();
    const net = state || (window.DB && DB.getNet ? DB.getNet() : { ok: true });
    if (offlineMode) {
      const c = readItemsCache();
      const when = c && c.at ? new Date(c.at) : null;
      el.dataset.mode = "offline";
      el.querySelector(".net-bar-txt").textContent = "📴 云端连不上，正在看本地缓存" +
        (when ? "（" + (when.getMonth() + 1) + "/" + when.getDate() + " " + String(when.getHours()).padStart(2, "0") + ":" + String(when.getMinutes()).padStart(2, "0") + "）" : "") +
        " · 每 20 秒自动重试";
      el.classList.add("offline");
      el.hidden = false;
      startOfflineRetry();
    } else if (net && !net.ok) {
      el.dataset.mode = "retry";
      el.querySelector(".net-bar-txt").textContent = "📶 网络不稳定，正在自动重试…";
      el.classList.remove("offline");
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }
  // 网络恢复 → 若之前在离线模式，自动重新同步
  function onNetRecovered(state) {
    refreshNetBar(state);
    if (state && state.ok && offlineMode) {
      offlineMode = false;
      loadItems().then(() => { writeItemsCache(); if (location.hash === "#/" || location.hash === "") renderHome(); refreshNetBar(); })
        .catch(() => { offlineMode = true; refreshNetBar(); });
    }
  }
  /* ---------- 回到顶部按钮（滚一段后出现） ---------- */
  let toTopEl = null;
  function initToTop() {
    if (toTopEl && document.body.contains(toTopEl)) return;
    toTopEl = document.createElement("button");
    toTopEl.type = "button";
    toTopEl.className = "to-top";
    toTopEl.title = "回到顶部";
    toTopEl.setAttribute("aria-label", "回到顶部");
    toTopEl.textContent = "↑";
    toTopEl.onclick = () => {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
      // 兜底：个别浏览器/WebView 不支持平滑滚动，或动画被打断时会停在半路
      setTimeout(() => { if ((window.scrollY || 0) > 40) window.scrollTo(0, 0); }, 600);
    };
    document.body.appendChild(toTopEl);
    const sync = () => { toTopEl.classList.toggle("show", (window.scrollY || 0) > 420); };
    window.addEventListener("scroll", sync, { passive: true });
    sync();
  }

  /* ---------- 🍡 沁灵（v94，v114 起标题就叫「沁灵」） ---------- */
  // 只有「已挂瓷 + 在库 + 文玩类」的串会开沁
  function spiritItems() {
    const st = Spirits.load();
    return focusVisible(allItems).filter((i) => {
      if (i.gifted) return false;
      if (i.playStatus !== "done") return false;
      const rec = st[i.id];            // v166：用户设「只当手串」的串不进沁灵列表 / 相册
      if (rec && rec.spirit === false) return false;
      return true;
    });
  }
  // 沁灵形象：优先 AI 绘图（带缓存），失败/断网自动换成本地程序化小沁灵
  // extraStyle：缩略图的取景参数（见 analyzeFaceBox / spiritThumbHtml）
  // face：还没算出取景时用 CSS 固定比例先顶着（本地兜底脸贴图本身是方形，不能裁，所以只在有 AI 图时才加）
  function spiritImgHtml(item, rec, size, cls, extraStyle, face) {
    const cfg = Spirits.getImageCfg();
    let url = rec && rec.imgUrl;
    if (!url) {
      url = (cfg.provider === "pollinations") ? Spirits.pollinationsUrl(item, (rec && rec.variant) || 0) : "";
    }
    const fallback = Spirits.localAvatarSvg(item);
    const src = url || fallback;
    const klass = (cls || "spirit-img") + (face && url ? " face" : "");
    return '<img class="' + klass + '" src="' + esc(src) + '" data-fallback="' + esc(fallback) + '"' +
      ' data-item="' + esc(item.id) + '" data-size="' + size + '" alt="' + esc((rec && rec.persona && rec.persona.name) || item.name || "沁灵") + '"' +
      ' loading="lazy" style="width:' + size + "px;height:" + size + 'px' + (extraStyle ? ";" + extraStyle : "") + '">';
  }

  /* ---------- 头像取景 v2（v113）：从立绘里稳稳找出"脸" ----------
     v112 的老算法取"人物外接框最上面 40%"，实测会裁到头发/空白（新形象有大头发、有道具、背景有渐变）。
     新算法：
       ① 背景色 = **四周所有边缘像素**的众数（量化到 4bit/通道）→ 抗渐变、抗四角有杂物
       ② 逐行统计前景宽度，做 3 行平滑 → 得到"上窄下宽"的轮廓
       ③ 从上往下找**第一个宽度局部极大**= 头（含头发）的最宽处
       ④ 再往后找**第一个宽度局部极小**= 脖子（有脖子就切在脖子，没有就用头高兜底）
       ⑤ 正方形取景 = 头框长边 ×1.12，横向对准头部的像素重心
     结果 {l,t,w,ar,v:2}；换算法只要把 v 提上去，老数据会自动重算。 */
  const FACE_VER = 3;   // v164i：2→3。升版本号 = 全部历史存档的取景框自动重算（只重算框、不重新出图，零成本）
  function analyzeFaceBox(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const ar = (img.width || 1) / (img.height || 1);
          const W = 160, H = Math.max(1, Math.round(W / ar));
          const cv = document.createElement("canvas");
          cv.width = W; cv.height = H;
          const ctx = cv.getContext("2d");
          ctx.drawImage(img, 0, 0, W, H);
          const d = ctx.getImageData(0, 0, W, H).data;
          // ① 背景色：四周边缘像素的众数（4bit 量化）
          const hist = {};
          const addEdge = (x, y) => {
            const i = (y * W + x) * 4;
            const k = (d[i] >> 4) + "," + (d[i + 1] >> 4) + "," + (d[i + 2] >> 4);
            if (!hist[k]) hist[k] = { n: 0, r: 0, g: 0, b: 0 };
            hist[k].n++; hist[k].r += d[i]; hist[k].g += d[i + 1]; hist[k].b += d[i + 2];
          };
          for (let x = 0; x < W; x++) { addEdge(x, 0); addEdge(x, H - 1); }
          for (let y = 0; y < H; y++) { addEdge(0, y); addEdge(W - 1, y); }
          let best = null;
          Object.keys(hist).forEach((k) => { if (!best || hist[k].n > best.n) best = hist[k]; });
          if (!best) { resolve(null); return; }
          const br = best.r / best.n, bg = best.g / best.n, bb = best.b / best.n;
          const isFg = (i) => Math.max(Math.abs(d[i] - br), Math.abs(d[i + 1] - bg), Math.abs(d[i + 2] - bb)) > 34;
          // ② 逐行前景宽度 + 左右边界
          const rowCnt = new Array(H).fill(0), rowSum = new Array(H).fill(0);
          let top = -1, bot = -1, total = 0;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const i = (y * W + x) * 4;
              if (!isFg(i)) continue;
              if (top < 0) top = y;
              bot = y; total++;
              rowCnt[y]++; rowSum[y] += x;
            }
          }
          if (top < 0 || bot - top < 8 || total < W * H * 0.015) { resolve(null); return; }
          // 平滑（去掉细道具/发丝的毛刺）
          const sm = new Array(H).fill(0);
          for (let y = 0; y < H; y++) {
            let s = 0, n = 0;
            for (let k = -2; k <= 2; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += rowCnt[yy]; n++; } }
            sm[y] = n ? s / n : 0;
          }
          const chH = bot - top + 1;
          // ③ 头部：从人物顶部往下找第一个"明显变宽后开始收窄"的局部极大
          const scanFrom = top, scanTo = Math.min(bot, top + Math.round(chH * 0.75));
          let headMaxY = top, headMaxW = 0;
          for (let y = scanFrom; y <= scanTo; y++) {
            if (sm[y] >= headMaxW) { headMaxW = sm[y]; headMaxY = y; }
            // 已经宽过一段又明显收窄 → 头结束
            if (headMaxW > 6 && sm[y] < headMaxW * 0.72 && y > headMaxY + 2) break;
          }
          // ④ 脖子：头部最宽处之后第一个明显收窄的行（窄于头宽的 65%）
          let neckY = -1;
          for (let y = headMaxY + 1; y <= scanTo; y++) {
            if (sm[y] < headMaxW * 0.65) { neckY = y; break; }
          }
          let headTop = top, headBot = (neckY > top + 4) ? neckY : (top + Math.round(chH * 0.34));
          // 头高太扁就退回"内容高度的 1/3"
          if (headBot - headTop < Math.round(chH * 0.12)) headBot = top + Math.round(chH * 0.33);
          // ⑤ 横向中心：头框内像素重心
          let cxs = 0, cns = 0;
          for (let y = headTop; y <= headBot; y++) { cxs += rowSum[y]; cns += rowCnt[y]; }
          const cx = cns ? cxs / cns : W / 2;
          let side = Math.max(headBot - headTop, headMaxW) * 1.12;
          side = Math.max(side, W * 0.2);          // 别放太大（糊）
          side = Math.min(side, W, H);
          let left = cx - side / 2;
          left = Math.max(0, Math.min(left, W - side));
          let tp = headTop - side * 0.06;
          tp = Math.max(0, Math.min(tp, H - side));
          resolve({ l: left / W, t: tp / H, w: side / W, ar: ar, v: FACE_VER });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  // 卡片缩略图：正方形小框，里面按取景参数放大 + 偏移，正好框住脑袋
  // v164i：放大倍数**钳制**。取景框算偏（或图本身就小）时 size/f.w 会飙到很大 → 头被放得只剩局部。
  //   倍数 ≥3× 直接判定取景失败，走 CSS .face 的 scale(2) 顶对齐兜底；1.2×~3× 之间才允许精确裁切。
  function spiritThumbHtml(item, rec, size) {
    const f = rec && rec.face;
    let ok = !!(f && f.w > 0 && f.ar > 0);
    let wr = 0;
    if (ok) {
      const raw = size / f.w;
      if (!(raw > 0) || raw >= size * 3) ok = false;                 // 原始倍数 ≥3× → 取景不可信，弃用
      else wr = Math.max(Math.round(raw), Math.round(size * 1.2)); // 下限 1.2×，上限由上面的判定保证
    }
    let extra = "";
    if (ok) {
      extra = "position:absolute;left:" + (-Math.round(f.l * wr)) + "px;top:" + (-Math.round((f.t * wr) / f.ar)) +
        "px;width:" + wr + "px;height:auto";
    }
    return '<span class="spirit-thumb" style="width:' + size + "px;height:" + size + 'px">' +
      spiritImgHtml(item, rec, size, "spirit-img", extra, !ok) + "</span>";
  }
  // 老图（取景算法升级前算的）没有取景数据或版本旧 → 进沁灵页时补算一次并存起来，不用重新出图
  let _faceBusy = false;
  async function ensureSpiritFaces(list) {
    if (_faceBusy) return;
    _faceBusy = true;
    try {
      let changed = false;
      for (const it of list) {
        const rec = Spirits.ensureIn(Spirits.load(), it.id);
        if (!rec.imgUrl) continue;
        if (rec.face && rec.face.v === FACE_VER) continue;
        const f = await analyzeFaceBox(rec.imgUrl);
        // ⚠️ 上面 await 过（算取景要解码图片），期间出图/CG/日记可能已经写过存档 →
        //    必须**重新 load** 只写 face 字段，绝不能 save 那份旧快照（会覆盖掉刚生成的 CG/立绘，白烧额度）
        const st2 = Spirits.load();
        Spirits.ensureIn(st2, it.id).face = f || { l: 0, t: 0, w: 0, ar: 0, v: FACE_VER };   // 算不出来也记一笔（w=0 用固定比例），免得每次重算
        Spirits.save(st2);
        changed = true;
      }
      if (changed) rerenderSpiritView();
    } catch (e) { /* 静默 */ }
    _faceBusy = false;
  }
  // 图片挂了 → 自动切本地形象（只切一次，避免死循环；本地形象是方形脸贴图，顺带去掉裁头像）
  function bindSpiritImgFallback(root) {
    (root || view).querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener("error", () => {
        if (img.dataset.fellback) return;
        img.dataset.fellback = "1";
        const s = Number(img.dataset.size) || 96;
        img.className = "spirit-img" + (/big/.test(img.className) ? " big" : "");
        img.style.cssText = "width:" + s + "px;height:" + s + "px";
        img.src = img.dataset.fallback;
      });
    });
  }

  /* ---------- v97：走 API 通道真正出图（POST 拿图） ---------- */
  // v164i 不变式：**大图只进 Supabase，localStorage 只放小图。**
  //   根因：这段压缩原本是死代码（只存在于 res.url 分支，而方舟 CDN 无 CORS 头 → 静默失败 → 用户看的是 1728px 原图）；
  //   v164h 让 ark 改回 b64 后压缩真的生效 → 存进库的是 512 小图 → 清晰度掉一档。
  //   现在：登录用户永远看到 1024 清晰图；未登录 / 离线 / 传云失败才落 512 小图（保护 localStorage 配额）。
  const SPIRIT_IMG_SIZE_LARGE = 1024;   // 大图长边 —— 只传云端，登录用户看到的清晰度
  const SPIRIT_IMG_SIZE = 512;          // localStorage 兜底小图长边（云端传不上去时用）
  // v125：单张突破 CG（rec.cgUrl）是横版插画，存大一点才看得清细节。
  // v163：**主线 8 张 CG 不走这里** —— 它们用 CG_MAIN_SIZE 存进 IndexedDB，见下方 commitMainlineCg。
  const CG_IMG_SIZE = 1280;             // v164i：768→1280（云端那份）
  const CG_IMG_SIZE_LOCAL = 768;        // v164i：落 localStorage 的兜底长边（云端传不上去时；保护配额）
  // 把出图结果压成小图存本地（火山方舟返回的 URL 只有 24 小时有效，所以 b64 一律压成 data URI 长期保存）
  function shrinkToDataUri(src, max, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", quality || 0.85));
        } catch (e) { resolve(""); }
      };
      img.onerror = () => resolve("");
      img.src = src;
    });
  }
  // v116：有些服务商（智谱/硅基流动/魔搭等）只返回一个**会过期的图片链接**，
  // 存下来 20 小时后会被判为"过期" → 又把所有沁灵重出一遍（白烧额度）。
  // 所以拿到 http 链接后先尝试下载并按同样规格压成本地 data URI；下载不到（对方没给跨域头）就保持原样。
  async function urlToDataUri(url, max, quality) {
    if (!url || !/^https?:/i.test(url)) return "";
    try {
      const resp = await fetch(url, { mode: "cors" });
      if (!resp.ok) return "";
      const blob = await resp.blob();
      if (!/^image\//i.test(blob.type || "")) return "";
      const dataUri = await new Promise((resolve) => {
        try {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ""));
          fr.onerror = () => resolve("");
          fr.readAsDataURL(blob);
        } catch (e) { resolve(""); }
      });
      if (!dataUri) return "";
      return (await shrinkToDataUri(dataUri, max, quality)) || dataUri;
    } catch (e) { return ""; }
  }
  /* ============================================================
   * v163：主线 CG 的落库入口（存储层，不含出图触发与 UI）
   * ------------------------------------------------------------
   * 分工：
   *   · 像素（data URI）→ Spirits.cgPutPixels() → IndexedDB（库 ww_cg）
   *   · 元数据（title/caption/vol/chapter/hasImg/thumb）→ rec.cgs[id] → 主 store
   * 🔴 「已收集」只认元数据 hasImg；像素不在本机 = missing（第四态），不是 locked。
   * 规格：主线 CG 大图长边 1024 / q0.85；缩略图长边 512 / q0.8（v164i 由 512/0.72、384/0.72 抬高；像素进 IndexedDB，不占 localStorage）。
   * ⚠️ 只作用于**主线 8 张**，v125 的单张突破 CG（CG_IMG_SIZE 那条路）走另一套规格。
   * ============================================================ */
  const CG_MAIN_SIZE = 1024;     // 主线 CG 大图长边（8 张 ≈ 1.6–2.8MB）
  const CG_MAIN_Q = 0.85;
  const CG_THUMB_SIZE = 512;     // 相册缩略图长边（宫格只加载它，禁止把 1024 塞进 116px 格子）
  const CG_THUMB_Q = 0.8;

  // 取这只沁灵的最新记录 + flush 闭包（避免「改了旧对象又被 load 覆盖」的经典坑）
  function cgRecStore(item) {
    const s = Spirits.load();
    const r = Spirits.ensureIn(s, item.id);
    return { store: s, rec: r, flush: function () { Spirits.save(s); } };
  }
  // 「已收集」进度：n / 8（分母走 Spirits.CG_TOTAL，不硬编码）
  function cgAlbumProgress(rec) {
    try { return { n: Spirits.cgCollectedCount(rec), total: Spirits.CG_TOTAL }; }
    catch (e) { return { n: 0, total: 8 }; }
  }
  // 相册格子的状态（一次读 IDB）。返回 { progress, collected:[{id,state,meta,pixels}] }
  //   state: ready / missing / failed / locked / collected(未查像素)
  async function cgAlbumSlots(rec) {
    try {
      const ids = Spirits.cgCollectedIds(rec);
      const slots = [];
      for (let i = 0; i < ids.length; i++) slots.push(await Spirits.cgSlotOf(rec, ids[i]));
      return { progress: cgAlbumProgress(rec), collected: slots };
    } catch (e) { return { progress: { n: 0, total: 8 }, collected: [] }; }
  }
  // 把一张「刚画好的主线 CG」落库。res = { b64 } 或 { url }（与 Spirits.generateCustom 一致）
  // meta = { title, caption, vol, volName, chapter, key, shot }（key = 缓存 key，变更才重画）
  // 返回 { ok, id, fresh, missing }：ok = 元数据已记（像素写失败也只是 missing，不丢「已收集」）
  async function commitMainlineCg(item, cgId, res, meta) {
    const id = String(cgId);
    const st = cgRecStore(item);
    let full = "";
    try {
      const src = (res && res.b64) ? ("data:image/png;base64," + res.b64) : ((res && res.url) || "");
      if (!src) { Spirits.cgMarkFailed(st.rec, id, meta, "出图返回为空"); st.flush(); return { ok: false, id: id, reason: "empty" }; }
      if (/^data:/i.test(src)) full = (await shrinkToDataUri(src, CG_MAIN_SIZE, CG_MAIN_Q)) || src;
      else full = (await urlToDataUri(src, CG_MAIN_SIZE, CG_MAIN_Q)) || "";
    } catch (e) { full = ""; }
    let thumb = "";
    if (full) { try { thumb = (await shrinkToDataUri(full, CG_THUMB_SIZE, CG_THUMB_Q)) || ""; } catch (e) { thumb = ""; } }
    // ① 像素 → IndexedDB（按 owner 隔离，避免多主串同名 CG 互相覆盖；K4）
    let wrote = false;
    try { wrote = await Spirits.cgPutPixels(item.id, id, { full: full, thumb: thumb }); } catch (e) { wrote = false; }
    // ② 元数据 → 主 store（🔴 元数据在 = 已收集；不依赖像素在不在）
    //    meta.ownerId 记下这只串，cgSlotOf 取像素时按它定位（与 ① 的 key 同源）
    const fresh = Spirits.cgMarkCollected(st.rec, id, Object.assign({}, meta, { ownerId: String(item.id) }), thumb);
    try { bumpGenCount(st.rec); } catch (e) { /* 忽略 */ }
    st.flush();
    return { ok: true, id: id, fresh: fresh, missing: !wrote };
  }
  // 出图失败：只写 err（🔴 已收集过的绝不降级）
  function markMainlineCgFailed(item, cgId, meta, err) {
    try {
      const st = cgRecStore(item);
      const r = Spirits.cgMarkFailed(st.rec, cgId, meta, err);
      st.flush();
      return r;
    } catch (e) { return false; }
  }
  // 换设备后像素不在本机（missing）→ 重画入口。钱是用户的，必须走 confirmModal
  async function retryMissingCg(item, cgId, meta) {
    const yes = await confirmModal(
      "这张要重新画吗？",
      "这张 CG 在原来那台设备上，这台手机里没有它的图。重画一次约 ¥0.13，画好还是存进相册。",
      "重新生成", true);
    if (!yes) return { ok: false, cancelled: true };
    const prompt = String((meta && meta.shot) || "").trim();
    if (!prompt) { toast("这张 CG 缺画面描述，暂时画不了"); return { ok: false, reason: "no_prompt" }; }
    try {
      const res = await Spirits.generateCustom(prompt, { seedKey: "mainline#" + cgId, variant: 0, landscape: true });
      const r = await commitMainlineCg(item, cgId, res, meta);
      toast(r.missing ? "画好了，先记着「已收集」" : "画好了，存进相册了");
      return r;
    } catch (e) {
      markMainlineCgFailed(item, cgId, meta, (e && e.message) || "出图失败");
      toast("出图失败：" + ((e && e.message) || "出图失败"));
      return { ok: false, reason: "error" };
    }
  }
  // 出图计数（帮用户盯住免费额度）：单只沁灵 rec.genCount + 本机累计
  function bumpGenCount(rec) {
    try {
      rec.genCount = (Number(rec.genCount) || 0) + 1;
      const t = Number(localStorage.getItem("ww_gen_total") || "0") + 1;
      localStorage.setItem("ww_gen_total", String(t));
    } catch (e) { /* 忽略 */ }
  }
  function genTotal() { try { return Number(localStorage.getItem("ww_gen_total") || "0"); } catch (e) { return 0; } }
  // 把一次出图结果落地到沁灵记录（含进化史 + 计数），所有路径共用，保证"卡片/弹层/深沁"看到的是同一张
  // v164h：把压好的 data URI 传到自家 Supabase Storage（bucket bracelet-images），换一个**永不过期**的公网 URL。
  //   成功 → 立绘/CG 存云端地址（localStorage 不膨胀、跨设备同步负载小、换手机也稳）；
  //   失败（未登录/离线/权限）→ 返回 ""，调用方回退用 data URI（同样永久，只是占本地配额）。
  async function spiritUploadPermanent(dataUri) {
    try {
      if (!dataUri || !/^data:image\//i.test(dataUri)) return "";
      if (typeof navigator !== "undefined" && navigator.onLine === false) return "";
      if (!window.DB || typeof DB.uploadPhoto !== "function") return "";
      const head = dataUri.indexOf(",");
      if (head < 0) return "";
      const bin = atob(dataUri.slice(head + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], "spirit.jpg", { type: "image/jpeg" });
      const up = await DB.uploadPhoto(file);   // 不传前缀 → 与用户照片同一套路径/权限模式
      return (up && up.url) || "";
    } catch (e) { return ""; }
  }
  /* v164i：图像落库不变式（**唯一入口**，别在别处再写一遍「压缩 + 上传」的组合）
   *   一张刚生成的图（b64 data URI 或外链）→ 先按 bigMax/bigQ 压出「大图」
   *   → 传自家云存储换一个**永久 URL**（不占 localStorage、跨设备稳、清晰度保底 1024）
   *   → 传不上去（未登录 / 离线 / 无权限）才落一份 ≤ localMax 的**小图** data URI 兜底。
   *   ⛔ 绝不把大图 data URI 写进 localStorage：几张就能把 5MB 配额撑爆。
   *   返回 { url, cloud }：cloud=true 表示已上云（永久、不占本地）。 */
  async function imageToStoreUrl(src, bigMax, bigQ, localMax, localQ) {
    if (!src) return { url: "", cloud: false };
    const isData = /^data:/i.test(src);
    let big = "";
    try { big = isData ? ((await shrinkToDataUri(src, bigMax, bigQ)) || src) : ((await urlToDataUri(src, bigMax, bigQ)) || ""); }
    catch (e) { big = ""; }
    // 外链读不到像素（对方没给跨域头）→ 保持原样，这是 v164h 之前的既有行为
    if (!big) return { url: isData ? "" : src, cloud: false };
    const cloud = await spiritUploadPermanent(big);
    if (cloud) return { url: cloud, cloud: true };
    try { return { url: (await shrinkToDataUri(big, localMax, localQ)) || "", cloud: false }; }
    catch (e) { return { url: "", cloud: false }; }
  }
  const BG_UNIT = 0.03;   // v165：单张 BG ≈ ¥0.03（与项目全局口径一致；全套 21 张 ≈ ¥0.63）
  /* ============================================================
   * v165 · BG 场景背景系统（app 侧接线 / 批量入口）
   * ------------------------------------------------------------
   * 数据层在 Spirits：BG_CATALOG / bgGet / bgPut / ensureBg（见 spirits.js）。
   * 这里只做两件事：
   *   ① ensureBg(key) —— 把真出图管线（generateCustom + imageToStoreUrl）注入给 Spirits.ensureBg；
   *   ② generateAllBg() —— 一键批量（逐张进度、失败可续，已出好的跳过、不重复计费）。
   * 🔴 永久 URL 保证：imageToStoreUrl 先传云 → 永久云 URL；未登录/离线/失败 → 回退 data URI（也永久）。
   * ⛔ 并发去重 / 命中直返 都在 Spirits.ensureBg 里，app 侧不重复实现。
   * ============================================================ */
  function bgUrlOf(key) { try { return Spirits.bgGet(key) || ""; } catch (e) { return ""; } }
  function ensureBg(key) {
    return Spirits.ensureBg(key, {
      get: (k) => { try { return Spirits.bgGet(k) || ""; } catch (e) { return ""; } },
      set: (k, u) => { try { return Spirits.bgPut(k, u); } catch (e) { return false; } },
      generate: (prompt, opts) => Spirits.generateCustom(prompt, opts),
      toStore: (src, bigMax, bigQ, localMax, localQ) => imageToStoreUrl(src, bigMax, bigQ, localMax, localQ),
    });
  }
  // 剧情页背景选图：优先选「已经出好图」的那张，都没有 → 返回 ""（走纯色/渐变兜底，⛔ 绝不出图、绝不阻塞）
  function sceneBgUrl(keys) {
    if (!Array.isArray(keys) || !keys.length) return "";
    for (let i = 0; i < keys.length; i++) { const u = bgUrlOf(keys[i]); if (u) return u; }
    return "";
  }
  let _bgBatchBusy = false;
  // 一键出全套：只画「还没出好」的（失败可续）；host.progress(done,total,name) / 返回 {done,fail}
  async function generateAllBg(host) {
    if (_bgBatchBusy) return { done: 0, fail: 0 };
    const h = host || {};
    const all = Object.keys(Spirits.BG_CATALOG || {});
    const todo = all.filter((k) => !bgUrlOf(k));
    if (!todo.length) return { done: 0, fail: 0 };
    _bgBatchBusy = true;
    let done = 0, fail = 0;
    try {
      if (h.progress) h.progress(0, todo.length, "");
      for (const k of todo) {
        if (h.progress) h.progress(done, todo.length, (Spirits.BG_CATALOG[k] || {}).name || k);
        try { const u = await ensureBg(k); if (u) done++; else fail++; }
        catch (e) { fail++; }
      }
      if (h.progress) h.progress(done, todo.length, "");
    } finally { _bgBatchBusy = false; }
    return { done, fail };
  }
  // 批量出图的进度弹层（逐张进度 + 完成后可关闭 / 失败可续）
  function showBgBatchModal() {
    const mask = $("#modalMask"), modal = $("#modal");
    if (!mask || !modal) return { setProg() {}, finish() {} };
    modal.innerHTML = "<h3>🎴 一键出全套 BG</h3>" +
      '<div id="bgProg" style="font-size:13px;color:var(--text-2);text-align:center;margin:12px 0;line-height:1.9">准备中…</div>' +
      '<div class="room-track big"><i id="bgProgBar" style="width:0%"></i></div>' +
      '<button class="btn primary" id="bgProgOk" style="width:100%;margin-top:16px" disabled>出图中…</button>';
    mask.hidden = false; modal.hidden = false; modal.style.display = "";
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    mask.onclick = null;
    return {
      setProg: (d, t, nm) => {
        const el = $("#bgProg"), bar = $("#bgProgBar");
        if (el) el.innerHTML = "已完成 <b>" + d + " / " + t + "</b> 张" + (nm ? "<br>正在画：" + esc(nm) : "");
        if (bar) bar.style.width = Math.round((t ? d / t : 0) * 100) + "%";
      },
      finish: (d, f) => {
        const el = $("#bgProg"), bar = $("#bgProgBar"), ok = $("#bgProgOk");
        if (el) el.innerHTML = "🎴 全套 BG 完成：成功 <b>" + d + "</b> 张" +
          (f ? "，失败 " + f + " 张（点关闭后可再点一次续画）" : "") + "。";
        if (bar) bar.style.width = "100%";
        if (ok) { ok.disabled = false; ok.textContent = "关闭"; ok.onclick = () => { close(); try { renderSettings(); } catch (e) { /* 忽略 */ } }; }
      },
    };
  }
  async function saveSpiritImage(item, rec, res, stage) {
    // v164i：大图（1024/q0.92）只往云端传；传不上去才落 512/q0.86 小图 data URI 兜底
    const out = res.b64
      ? await imageToStoreUrl("data:image/png;base64," + res.b64, SPIRIT_IMG_SIZE_LARGE, 0.92, SPIRIT_IMG_SIZE, 0.86)
      : ((res.url || "") ? await imageToStoreUrl(res.url, SPIRIT_IMG_SIZE_LARGE, 0.92, SPIRIT_IMG_SIZE, 0.86)
        : { url: "", cloud: false });
    let url = out.url;
    let permanent = out.cloud;   // v164h：最终 URL 是否永久有效（云存储 URL / data URI）
    if (!url) return "";
    // v164h：永久图一律冻结 —— spiritImgStale 永不判过期，修掉「方舟外链 20 小时过期 → 自动重出 = 天天烧钱」。
    //   手动「重画立绘/换形象」走 saveSpiritImage 会覆盖 imgUrl（仍是永久图），不受影响。
    if (permanent || /^data:/i.test(url)) rec.imgFrozen = true;
    const hist = Array.isArray(rec.imgHistory) ? rec.imgHistory : [];
    const last = hist[hist.length - 1];
    // v164h：入史条目若是 data URI，先压成小图（历史格子本来就只有指甲盖大），
    //   防止整图 data URI 撑爆 localStorage；云 URL / 普通外链体积小，原样入史。
    // v164i：256/0.72 放宽到 512/0.8；且**无云端**时历史条目本身就是 data URI，
    //   8 条大会撑爆 localStorage → 只留最近 3 条（有云端 URL 时仍留 8 条）。
    let histUrl = url;
    if (/^data:/i.test(url)) histUrl = (await shrinkToDataUri(url, 512, 0.8)) || url;
    if (!(last && last.url === histUrl)) hist.push({ stage: stage || rec.stage || 1, url: histUrl, at: Date.now() });
    rec.imgHistory = hist.slice(/^https?:/i.test(url) ? -8 : -3);
    rec.imgUrl = url;
    rec.imgAt = Date.now();
    // v165：记下「这张立绘是第几阶的」—— 程序据此判断阶段上涨后要不要出新本阶立绘
    //   （此前无此字段，阶段涨了立绘也永远冻结复用，看着像「进阶了但没变」）。
    rec.imgStage = stage || rec.stage || 1;
    rec._stageImgErr = ""; rec._stageImgErrAt = 0;
    rec.imgErr = "";
    rec._imgErr = "";   // ⚠️ 必须清掉：出图成功却留着旧错误 → 列表页会一直弹那条早就过期的红字（v105 笔误成 imgErr，v108 修）
    rec.face = await analyzeFaceBox(url);   // 顺手算出"头像取景"，缩略图就不用等下一轮
    rec.lookStale = false;                  // 这张图已经用了最新的形象设定
    bumpGenCount(rec);
    return url;
  }
  // 判断是否需要重新出图：**data URI 是永久的，永不重出**；只有 http(s) 链接（方舟 24h 过期）才要续期
  function spiritImgStale(rec, item) {
    // v165-M：⛔ 删掉「阶段涨了 ⇒ 自动重出」这条。用户裁定：**进阶与出进阶立绘都必须手动**，
    //   系统绝不因为阶数涨了就自动出图（原逻辑会在进页面/定时器里偷偷烧额度）。
    //   现在只有「外链过期」与「还没图」两种情形会走自动续期；本阶立绘欠着 ⇒ 只显示可点按钮。
    const u = rec && rec.imgUrl;
    if (!u) return true;
    if (rec.imgFrozen) return false;                       // 已冻结的免密钥立绘：prompt 再变也不重出，永久有效
    if (/^data:/.test(u)) return false;                    // 本地存好的图 → 永久有效
    return (Date.now() - (rec.imgAt || 0)) > 20 * 3600 * 1000;   // 外链 → 20 小时后续期
  }
  // v165：本阶立绘是否还欠着一张（详情页提示 + 按钮文案用；⛔ 纯读，不触发出图）
  function stageImgPending(rec, item) {
    // v165-M：与**已确认阶**比较（不再跟可达阶比）—— 用户没点「进阶」之前，本阶立绘不算欠着。
    if (!item || !rec || rec.imgStage == null) return false;
    const confirmed = Math.max(1, Number(rec.stage) || 1);
    return rec.imgStage < confirmed;
  }
  // v165-M：**唯一**允许写 rec.stage 的地方 —— 用户点「✨ 可以进阶了 · 点此进阶」
  //   ⛔ 除此以外任何路径都不许写 rec.stage（可达阶一律用 Spirits.stageOf 现算，不落库）。
  function confirmStage(item) {
    if (!item) return false;
    const s = Spirits.load();
    const r = Spirits.ensureIn(s, item.id);
    const reach = Spirits.stageOf(item, r, Date.now());     // 可达阶（只认盘玩次数）
    const confirmed = Math.max(1, Number(r.stage) || 1);    // 已确认阶
    if (reach <= confirmed) { toast("还没到下一阶 —— 再盘一些日子。"); return false; }
    r.stage = reach;
    Spirits.save(s);
    toast("✨ 进阶到「" + Spirits.stageDef(reach).name + "」了！本阶立绘还没画 —— 点「🖼 画本阶立绘」再画。");
    return true;
  }
  // 逐个补形象：API 通道需要 POST 出图 → 缓存到本地沁灵记录里
  let _imgBusy = false;
  let _lastImgErrShown = "";
  // 按沁灵 id 记录「正在出图」，防止手动重画与自动补图、或多次点击同时打同一尊（反复出图 = 反复烧钱）
  const _genInFlight = {};
  // v127：这只沁灵在等用户先确认设定（发色/特征/性格）→ 先别出图，免得画完又得重画
  function spiritNeedsSetup(rec) {
    const r = rec || {};
    if (r.look) return false;
    if (r.lookAsked === 1) return false;
    return r.setupPending === true || (!r.imgUrl && !r.imgAt);
  }
  // 进沁灵页/图鉴页时，若第一尊还没定设定就自动弹一次向导（每只每次开会话只弹一次）
  const _setupShown = {};
  function maybeOpenSpiritSetup(list) {
    try {
      if (!$("#modal").hidden) return;
      const s = Spirits.load();
      const pend = (list || []).filter((it) => spiritNeedsSetup(s[it.id] || {}));
      if (!pend.length) return;
      const it = pend[0];
      if (_setupShown[it.id]) return;
      _setupShown[it.id] = 1;
      setTimeout(() => { try { showSpiritSetupModal(it); } catch (e) { /* 忽略 */ } }, 350);
    } catch (e) { /* 静默 */ }
  }

  async function ensureSpiritImages(list) {
    if (_imgBusy) return;
    const cfg = Spirits.getImageCfg();
    if (cfg.provider === "pollinations") {
      // 免密钥通道：不联网、不预生成，但把「当前应显示的 URL」冻结进 rec.imgUrl。
      // 这样以后 prompt 文字再变（如 v164c 加比例锁定），已显示的立绘也不会偷偷跟着换图。
      // 用户点「恢复旧立绘」会写入旧 URL 并标 imgFrozen；这里遇到已冻结/已存图的直接跳过，绝不覆盖。
      let changed = false;
      const cur = Spirits.load();
      for (const it of (list || [])) {
        const r = Spirits.ensureIn(cur, it.id);
        // v165：阶段涨了就重算 URL（免密钥通道按 prompt 取图，换阶=换 prompt=换图，⛔ 不花任何钱）
        const curStage = Math.min(4, Math.max(1, Number(r.stage) || 1));   // v165-M：已确认阶
        const stageUp = stageImgPending(r, it);
        if (!stageUp && (r.imgFrozen || r.imgUrl)) continue;
        r.imgUrl = Spirits.pollinationsUrl(it, (r.variant || 0), null, curStage,
          Spirits.appearanceOf(it, r.appearanceSeed || 0, r.gender || ""));
        r.imgAt = Date.now();
        r.imgFrozen = true;
        r.imgStage = curStage;
        changed = true;
      }
      if (changed) Spirits.save(cur);
      return;
    }
    _imgBusy = true;
    try {
      let changed = false;
      for (const it of list) {
        if (_genInFlight[it.id]) continue;            // 这只正在别处出图（手动重画/其它页面），别重复打
        const st = Spirits.load();
        const rec = Spirits.ensureIn(st, it.id);
        if (spiritNeedsSetup(rec)) continue;         // v127：等用户先确认设定（发色/特征/性格）
        // v165：本阶立绘是否还欠着一张（阶段涨了 & 旧图不是本阶的）
        // v165-M：⛔ 本阶立绘欠着时**绝不自动出图** —— 只等用户点「🖼 画本阶立绘」
        if (stageImgPending(rec, it)) continue;
        if (!spiritImgStale(rec, it)) continue;   // 已经是本地存好的图 → 不再烧额度
        // 刚失败过就别反复重试（配置错的时候会在每次进页面时白烧额度）
        if (rec._imgErr && Date.now() - (rec._imgErrAt || 0) < 10 * 60 * 1000) continue;
        _genInFlight[it.id] = true;
        try {
          // v165：阶段补画把旧图当参考图传过去 → 保证是同一个人，不会换脸/变性
          const refImg = stageUp ? (rec.imgUrl || "") : "";
          const r = await Spirits.generateImage(it, rec.variant || 0, null, derivedStage,
            { appearanceSeed: rec.appearanceSeed || 0, gender: rec.gender || "", ref: refImg });
          // ⚠️ 出图要好几秒，期间 CG/取景/日记可能已经写过存档 →
          //    必须**重新 load** 再写（否则会把并发任务的结果覆盖掉，CG 会被白白重画一次）
          const st2 = Spirits.load();
          const rec2 = Spirits.ensureIn(st2, it.id);
          await saveSpiritImage(it, rec2, r, derivedStage);
          Spirits.save(st2);
          changed = true;
          if (r.autoFixed) toast("已自动修正：" + r.autoFixed);
        } catch (e) {
          const msg = (e && e.message) || "出图失败";
          const st2 = Spirits.load();
          const rec2 = Spirits.ensureIn(st2, it.id);
          rec2._imgErr = msg;
          rec2._imgErrAt = Date.now();     // 保留旧图（不清 imgUrl），只记下错误与时间
          if (stageUp) { rec2._stageImgErr = msg; rec2._stageImgErrAt = Date.now(); }   // v165：本阶补画失败（详情页会给「点此补画」）
          changed = true;
          Spirits.save(st2);
        } finally {
          delete _genInFlight[it.id];
        }
      }
      if (changed && location.hash === "#/spirit") renderSpiritPage();
      // 同一条错误只提示一次，避免"早就修好了还一直弹红字"
      const st2 = Spirits.load();
      const errs = Object.keys(st2).map((k) => st2[k]._imgErr).filter(Boolean);
      const emsg = errs[0] || "";
      if (emsg && location.hash === "#/spirit" && _lastImgErrShown !== emsg) {
        _lastImgErrShown = emsg;
        toast("出图失败：" + emsg);
      }
    } catch (e) { /* 静默 */ }
    _imgBusy = false;
  }

  // v127：还没定设定（发色/特征/性格）的沁灵提示条（沁灵页 + 图鉴页共用）
  function setupHintHtml(list, store) {
    const pend = (list || []).filter((it) => spiritNeedsSetup((store || {})[it.id] || {}));
    if (!pend.length) return { html: "", first: null };
    return {
      html: '<div class="diary-hint" id="spSetupHint">✨ 有 <b>' + pend.length + '</b> 只还没定设定（发色 / 特征 / 性格）· <b>点这里开始定</b></div>',
      first: pend[0],
    };
  }
  function bindSetupHint(first) {
    const el = $("#spSetupHint");
    if (el && first) el.onclick = () => showSpiritSetupModal(first);
  }

  function renderSpiritPage() {
    topbarTitle.textContent = "沁灵";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const list = spiritItems();
    const store = Spirits.load();

    if (!list.length) {
      view.innerHTML = emptyCardHtml({
        ill: "spirit", icon: "🍡", title: "还没有沁灵醒过来",
        sub: "把一串盘到「已挂瓷」，它就会开沁",
        hint: "盘玩 → 已挂瓷 → 自动开沁",
      }) + '<button class="btn primary" id="spiritGoHome" style="width:100%;margin-top:12px">去盘串</button>';
      const g = $("#spiritGoHome");
      if (g) g.onclick = () => location.hash = "#/";
      return;
    }

    // v165-M：⛔ 这里不再自动写 r.stage —— rec.stage 语义改为「已确认阶」，
    //   唯一写点是用户点「✨ 可以进阶了 · 点此进阶」（见 confirmStage）。可达阶一律用 Spirits.stageOf 现算。

    let html = "";
    // 统计条（沿用 #/spirits）
    const stageCount = [0, 0, 0, 0]; let cgCount = 0;
    list.forEach((it) => { const r = store[it.id] || {}; const st = Math.min(4, Math.max(1, Number(r.stage) || 1)); stageCount[st - 1] += 1; if (r.cgUrl) cgCount += 1; });
    html += pageStatsHtml([
      { n: list.length, l: "沁灵总数" },
      { n: stageCount[3] + stageCount[2], l: "少年 / 成年↑" },
      { n: cgCount, l: "已有 CG" },
      { n: list.reduce((s, it) => s + Spirits.unreadMail(store[it.id] || {}), 0), l: "未读回响" },
    ]);
    // v163b：CG 相册入口卡（§A3 / §D5）
    html += albumEntryHtml(list, store);

    // 日记提示（正文不在这里显示：沁灵是"随机写的"，有写就提示一下，进去看才有惊喜）
    const diaryToday = list.filter((it) => {
      const rec = store[it.id] || {};
      const d = (rec.diary || []).filter((e) => e && e.date === Spirits.todayKey());
      return d.length && (rec.diarySeenAt || 0) < d[d.length - 1].at;
    }).length;
    if (diaryToday) {
      html += '<div class="diary-hint" id="diaryHint">📔 今天有 <b>' + diaryToday + '</b> 只沁灵写了日记 · 点它的头像进去看</div>';
    }
    // v155：有新回响（纪念日信）—— 一年就那么几次，值得提醒一下
    // v163d：点名「是谁写的」—— 用户反馈只知道「今天有回响」却不知道是谁留的。
    //   单遍 O(n) 同扫（owners + 总数一起收，禁 list.filter + list.reduce 两遍）
    const echoOwners = [];
    let echoN = 0;
    list.forEach((it) => {
      const n = Spirits.unreadMail(store[it.id] || {});
      if (n > 0) { echoOwners.push({ id: it.id, name: spiritName(it, store), n: n }); echoN += n; }
    });
    if (echoN) {
      let echoWho;
      if (echoOwners.length === 1) {
        echoWho = "<b>" + esc(echoOwners[0].name) + "</b> 给你留了";
      } else {
        // 名单 ≥4 尊一律折叠成「前 3 +M」（项目硬约束：列表 / badge 只画前 N）
        const head = echoOwners.slice(0, 3).map((o) => esc(o.name)).join("、");
        echoWho = "<b>" + head + "</b>" + (echoOwners.length > 3 ? " 等 " + echoOwners.length + " 尊" : "") + " 给你留了";
      }
      html += '<div class="diary-hint echo" id="echoHint">✦ ' + echoWho + " <b>" + echoN + "</b> 封回响信 · 点它进去看</div>";
    }

    html += '<div class="section-title">🍡 我的沁灵（' + list.length + '）' +
      '<small style="color:var(--text-2);font-weight:400;font-size:11px"> 点它进详情页</small></div>';
    // v163b：先进「所有沁灵」网格（复用 #/spirits 卡片结构）
    html += '<div class="spirit-grid">';
    list.forEach((it) => {
      const rec = store[it.id] || {};
      const p = rec.persona || null;
      const idle = it.lastPlayedAt ? Math.floor((Date.now() - it.lastPlayedAt) / 86400000) : null;
      const si = Spirits.stageInfo(it, rec.stage, DB.daysWith(it));
      const wroteToday = (rec.diary || []).some((e) => e && e.date === Spirits.todayKey()) && (rec.diarySeenAt || 0) < ((rec.diary || []).slice(-1)[0] || {}).at;
      const needSetup = spiritNeedsSetup(rec);
      const stars = "★".repeat(si.stage) + "☆".repeat(4 - si.stage);
      html += '<div class="spirit-card" data-spirit="' + esc(it.id) + '">' +
        spiritThumbHtml(it, rec, 96) +
        '<div class="spirit-meta">' +
        '<div class="spirit-name">' + esc(spiritName(it, store)) +
        '<span class="sp-stars">' + stars + "</span></div>" +
        '<span class="spirit-stage">' + si.icon + " " + esc(si.name) + " · " + Spirits.headCountOf(si.stage) + "头身</span>" +
        (needSetup ? '<span class="look-setup-tag" data-setup="' + esc(it.id) + '">✨ 定设定</span>' : "") +
        (wroteToday ? '<span class="spirit-break-tag" style="background:#e8f0ff;color:#3b5b9a">📔 写日记了</span>' : "") +
        '<div class="spirit-title">' + esc((p && p.title) || "正在酝酿性格…") + "</div>" +
        '<div class="spirit-line">' + esc((p && p.line) || "") + "</div>" +
        (si.isMax ? '<div class="spirit-prog max">已是化形 · 巅峰形态 👑</div>'
          : '<div class="spirit-prog"><span class="spirit-prog-track"><span class="spirit-prog-fill" style="width:' + si.pct + '%"></span></span>' +
            '<span class="spirit-prog-txt">距下一阶：再盘 ' + si.toNext + " 次</span></div>") +
        '<div class="spirit-tags">' + ((p && p.traits) || []).map((t) => '<span class="spirit-trait">' + esc(t) + "</span>").join("") +
        (idle != null ? '<span class="spirit-trait idle">' + idle + " 天没盘</span>" : "") + "</div>" +
        "</div></div>";
    });
    html += "</div>";
    html += '<div class="sp-2col">' +
      '<button class="btn primary" id="spTownBtn">🏘 沁灵巷（房间·纪事·CG）</button>' +
      '<button class="btn ghost" id="spEventsBtn">📜 事件回顾</button></div>';
    html += '<button class="btn ghost" id="spMainBtn" style="width:100%;margin-top:10px">📜 沁灵纪（主线主串设置）</button>';
    view.innerHTML = html;
    bindSetupHint(setupHintHtml(list, store).first);
    bindSpiritImgFallback(view);
    view.querySelectorAll("[data-spirit]").forEach((c) => c.addEventListener("click", () => {
      const id = c.dataset.spirit; if (id) location.hash = "#/spirit/" + encodeURIComponent(id);
    }));
    view.querySelectorAll("[data-setup]").forEach((el) => el.onclick = (e) => {
      e.stopPropagation(); const it = list.filter((x) => x.id === el.dataset.setup)[0]; if (it) showSpiritSetupModal(it);
    });
    const ae = $("#albumEntry"); if (ae) ae.onclick = () => location.hash = "#/album";
    const twBtn = $("#spTownBtn");      // v157：沁灵巷
    if (twBtn) twBtn.onclick = () => location.hash = "#/town";
    const evBtn = $("#spEventsBtn");     // v163b：事件回顾
    if (evBtn) evBtn.onclick = () => location.hash = "#/events";
    const msBtn = $("#spMainBtn");       // v163：沁灵纪（主串集合制）
    if (msBtn) msBtn.onclick = () => { location.hash = "#/mainstory"; };
    const dh = $("#diaryHint");
    if (dh) dh.onclick = () => location.hash = "#/spirits";
    const eh = $("#echoHint");
    // v163d：只有一尊写了回响信 → 直接进它详情页（详情页有「✦ 回响」卡片，一步到位）；多尊 → 回列表
    if (eh) eh.onclick = () => {
      location.hash = (echoOwners.length === 1)
        ? "#/spirit/" + encodeURIComponent(echoOwners[0].id)
        : "#/spirits";
    };
    // 异步补性格 + 人设/形象细节（要在出图之前）→ 出图 + 老图头像取景 + 日记 + 房间契合度/剧情
    ensureSpiritData(list);
    ensureSpiritLook(list).then(() => ensureSpiritImages(list)).then(() => ensureSpiritCg(list));   // v125：立绘好了再画 CG（拿立绘当参考、更像同一个人）
    ensureSpiritFaces(list);
    ensureSpiritExtras(list);
    updateStoryDot();
    maybeOpenSpiritSetup(list);      // v127：还没定设定的，先弹一次向导（生成前让用户确认）
  }

  /* ============================================================
   * v163b：CG 相册入口卡（§A3）/ 相册页（#/album）/ 事件回顾页（#/events）
   *         事件瞬时卡 drain / 出图确认闸门
   * ============================================================ */
  const EVENT_TOAST_MS = 6000;     // v163b：事件瞬时卡停留时长（§D3）
  const TALK_LEAD_MS      = 300;   // v163d：消息弹出前的「正在输入」三点气泡停留
  const TALK_MIN_MS       = 700;   // v163d：每条气泡最短停留（读完再出下一条，别连成一片）
  const TALK_PER_CHAR_MS  = 55;    // v163d：每个字追加的停留
  const TALK_MAX_MS       = 4000;  // v163d：单条最长停留（防超长旁白把节奏卡住）
  // v163d：气泡停留时长 = clamp(最短 + 字长 × 每字, 最短, 最长)
  //   （v163d 删掉了 v163b 的逐字打字机：逐字每 45ms 重建整个 .nt-row 节点，
  //    节点被销毁重建 → .nt-row 的 320ms 入场动画永远播不完 = 闪烁）
  function talkDwell(text) {
    const len = String(text || "").length;
    return Math.max(TALK_MIN_MS, Math.min(TALK_MAX_MS, TALK_MIN_MS + len * TALK_PER_CHAR_MS));
  }

  // 全沁灵「已收集」合计（分母 = CG_TOTAL × 居民数，不硬编码 8）
  function albumEntryHtml(list, store) {
    let total = 0, recentAt = 0, recentThumb = "";
    list.forEach((it) => {
      const rec = store[it.id] || {};
      const ids = Spirits.cgCollectedIds(rec);
      total += ids.length;
      ids.forEach((id) => {
        const m = Spirits.cgMetaOf(rec, id);
        if (m && (m.at || 0) > recentAt) { recentAt = m.at || 0; recentThumb = m.thumb || ""; }
      });
    });
    const denom = Spirits.CG_TOTAL * Math.max(1, list.length);
    const cover = recentThumb
      ? '<img class="album-entry-img" src="' + esc(recentThumb) + '" alt="最近一张 CG">'
      : '<span class="album-entry-img album-entry-ph">🖼</span>';
    return '<button class="album-entry" id="albumEntry" data-album="open">' +
      '<span class="album-entry-cover">' + cover + '<span class="album-entry-stack"></span></span>' +
      '<span class="album-entry-meta">' +
        '<span class="album-entry-title">CG 相册</span>' +
        '<span class="album-entry-sub">已收集 <b>' + total + '</b>/' + denom +
        (list.length > 1 ? ' · 共 ' + list.length + ' 尊' : '') + '</span>' +
      '</span>' +
      '<span class="album-entry-go">›</span></button>';
  }

  // 相册页：按沁灵分册，每只各算 N/8（不跨串求和）；格子按卷分组，未解锁防剧透
  let _albumTab = "main";   // v166：CG 相册全局画廊当前 tab（main=主线 / adv=进阶）
  function renderAlbumPage() {
    topbarTitle.textContent = "CG 相册";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const store = Spirits.load();
    const list = spiritItems();
    // v166：全局画廊 —— 跨所有沁灵聚合 CG，顶部「主线 / 进阶」两个 tab 切换（不再按人头分组）
    const mainCgs = [], advCgs = [];
    let _migrated = false;
    list.forEach((it) => {
      const rec = Spirits.ensureIn(store, it.id, it);
      // v166：把 V166 之前生成的进阶 CG（只存了 rec.cgUrl、没归档进 rec.cgs）补写进相册集合，
      //   否则相册（全局画廊）永远聚不到那只串的 CG —— 用户「明明有 CG 却啥都不显示」的根因。
      if (Spirits.backfillAdvCg(rec)) _migrated = true;
      const name = spiritName(it, store);
      Spirits.cgCollectedIds(rec).forEach((k) => {
        const m = Spirits.cgMetaOf(rec, k);
        if (m && m.hasImg) mainCgs.push({ ownerId: it.id, ownerName: name, id: k, meta: m });
      });
      Spirits.cgAdvIds(rec).forEach((k) => {
        const m = Spirits.cgMetaOf(rec, k);
        if (m && m.hasImg) advCgs.push({ ownerId: it.id, ownerName: name, id: k, meta: m });
      });
    });
    if (_migrated) { try { Spirits.save(store); } catch (e) { /* 忽略：回填失败不影响本次展示 */ } }
    const byAt = (a, b) => (Number(a.meta.at) || 0) - (Number(b.meta.at) || 0);
    mainCgs.sort(byAt); advCgs.sort(byAt);
    // v166：默认选「主线」；但若主线为空、进阶有图，自动跳到「进阶」tab（避免用户以为没图）
    if (!_albumTab || (_albumTab === "main" && !mainCgs.length && advCgs.length)) _albumTab = (!mainCgs.length && advCgs.length) ? "adv" : "main";
    const cur = _albumTab === "adv" ? advCgs : mainCgs;

    if (!mainCgs.length && !advCgs.length) {
      view.innerHTML = emptyCardHtml({ ill: "spirit", icon: "🖼", title: "还没有 CG", sub: "沁灵走到关键处、或蜕形 / 化形时，会留下 CG" });
      bindSpiritImgFallback(view);
      return;
    }
    let h = '<div class="album-head"><div class="album-head-n"><b>' + mainCgs.length + '</b><span> 张主线</span></div>' +
      '<div class="album-head-meta"><div class="album-head-title">CG 相册</div>' +
      '<div class="album-head-sub">每张沁灵最多 ' + Spirits.CG_TOTAL + ' 张主线 CG · 另有进阶专属 CG</div></div></div>';
    // tab 切换
    h += '<div style="display:flex;gap:8px;margin:12px 0">' +
      '<button data-tab="main" style="flex:1;padding:10px 8px;border-radius:10px;border:1px solid var(--line,#e3d9c4);background:' + (_albumTab === "main" ? "var(--gold,#c9a24b)" : "transparent") + ';color:' + (_albumTab === "main" ? "#fff" : "var(--text,#3b3128)") + ';font-weight:600;font-size:14px">📜 主线 (' + mainCgs.length + ')</button>' +
      '<button data-tab="adv" style="flex:1;padding:10px 8px;border-radius:10px;border:1px solid var(--line,#e3d9c4);background:' + (_albumTab === "adv" ? "var(--gold,#c9a24b)" : "transparent") + ';color:' + (_albumTab === "adv" ? "#fff" : "var(--text,#3b3128)") + ';font-weight:600;font-size:14px">✨ 进阶 (' + advCgs.length + ')</button>' +
      '</div>';
    if (!cur.length) {
      h += '<div class="album-empty" style="padding:28px 12px;text-align:center;color:var(--text-2,#8a7f6d)">' +
        (_albumTab === "adv" ? "还没有进阶专属 CG（蜕形 / 化形时生成）" : "主线 CG 还没收集，先去走剧情吧") + '</div>';
    } else {
      h += '<div class="album-grid album-grid-wide">';
      cur.forEach((c) => {
        const m = c.meta;
        h += '<button class="album-cell" data-cg="' + esc(m.thumb || "") + '" title="' + esc((m && m.caption) || "") + '" style="position:relative">' +
          (m.thumb ? '<img class="album-cell-img" src="' + esc(m.thumb) + '" alt="">' : '<span class="album-cell-need">已收集</span>') +
          '<span class="album-cell-tag">' + esc(m.title || c.id) + '</span>' +
          '<span class="album-cell-owner" style="position:absolute;left:6px;bottom:6px;right:6px;font-size:10px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6);text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + esc(c.ownerName) + '</span></button>';
      });
      h += '</div>';
    }
    h += '<button class="btn ghost" id="albumBack" style="width:100%;margin-top:14px">← 回到沁灵页</button>';
    view.innerHTML = h;
    bindSpiritImgFallback(view);
    view.querySelectorAll(".album-tab").forEach((el) => el.onclick = () => { _albumTab = el.dataset.tab; renderAlbumPage(); });
    const bk = $("#albumBack"); if (bk) bk.onclick = () => location.hash = "#/spirit";
    view.querySelectorAll(".album-cell[data-cg]").forEach((el) => el.onclick = () => openSpiritViewer(el.dataset.cg || ""));
  }

  // 事件回顾页：O(n) 只读聚合；支持 ?owner= 过滤（详情页「它的纪事」入口）
  function renderEventsPage() {
    topbarTitle.textContent = "事件回顾";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const list = spiritItems();
    const store = Spirits.load();
    const qs = (location.hash.split("?")[1] || "");
    const owner = decodeURIComponent((qs.match(/owner=([^&]+)/) || [])[1] || "");
    let evs = Spirits.allEvents(list, store);
    if (owner) evs = evs.filter((e) => e.ownerId === owner);
    let h = '<div class="section-title">📜 事件回顾' +
      (owner ? '<button type="button" class="link-btn" id="evAll" style="float:right;font-size:11px">看全部</button>' : '') + '</div>';
    if (!evs.length) {
      h += emptyCardHtml({ ill: "spirit", icon: "📜", title: "还没发生过事件", sub: "盘串、过节、夜话……都会留下痕迹" });
    } else {
      h += '<div class="memo-line">';
      evs.forEach((e) => {
        h += '<div class="memo-row"><div class="memo-dot">' + (e.icon || "•") + '</div>' +
          '<div class="memo-body"><div class="memo-title">' + esc(e.title || "") + '</div>' +
          (e.summary ? '<div class="memo-text">' + esc(e.summary) + '</div>' : '') +
          '<div class="memo-sub">' + esc(Spirits.todayKey(Number(e.at))) +
          (e.ownerName ? ' · 来自〈' + esc(e.ownerName) + '〉' : '') + '</div></div></div>';
      });
      h += '</div>';
    }
    h += '<button class="btn ghost" id="evBack" style="width:100%;margin-top:14px">← 回到沁灵页</button>';
    view.innerHTML = h;
    bindSpiritImgFallback(view);
    const bk = $("#evBack"); if (bk) bk.onclick = () => location.hash = "#/spirit";
    const al = $("#evAll"); if (al) al.onclick = () => location.hash = "#/events";
  }

  // v163b：事件瞬时卡（.evt-pop）的 drain + 渲染（非阻塞，约 6s 后淡出，点任意处提前关闭）
  function flushEventPops() {
    try {
      const pops = Spirits.drainEventPops();
      pops.forEach((p) => {
        const el = document.createElement("div");
        el.className = "evt-pop";
        el.innerHTML = '<div class="evt-pop-ico">' + (p.icon || "✦") + '</div>' +
          '<div class="evt-pop-body"><div class="evt-pop-title">' + esc(p.title || "") + '</div>' +
          (p.summary ? '<div class="evt-pop-sum">' + esc(p.summary) + '</div>' : '') + '</div>';
        document.body.appendChild(el);
        const close = () => { if (el.classList.contains("leaving")) return; el.classList.add("leaving"); setTimeout(() => { try { el.remove(); } catch (e) {} }, 260); };
        setTimeout(close, EVENT_TOAST_MS);
        el.onclick = close;
      });
    } catch (e) { /* 忽略 */ }
  }

  /* ============================================================
   * v164：可编辑面板基础设施
   * 用户原话：「提取了也不能修改，那让我确认干嘛？」「不 OK 要有给我修改的地方」
   * → 所有"确认"类弹层一律做成**能改**的，改完的值真的落库、真的进 prompt。
   * ============================================================ */
  // 打开一个面板，返回 Promise<{ok, alt, tag, values}>；values 由 onRead(modal) 读出
  //   onBind(modal, finish) 可选：给调用方挂自己的按钮（如「重新润色」），用 finish(false,false,"tag") 回传
  function openEditPanel(html, onRead, onBind) {
    const mask = $("#modalMask"), modal = $("#modal");
    modal.innerHTML = html;
    mask.hidden = false; modal.hidden = false; modal.style.display = "";
    return new Promise((resolve) => {
      let closed = false;
      const finish = (ok, alt, tag) => {
        if (closed) return; closed = true;
        const values = (ok && onRead) ? onRead(modal) : null;
        mask.hidden = true; modal.hidden = true; modal.style.display = ""; mask.onclick = null;
        resolve({ ok: !!ok, alt: !!alt, tag: tag || "", values: values });
      };
      modal._pOk = () => finish(true, false, "ok");
      modal._pNo = () => finish(false, false, "no");
      modal._pAlt = () => finish(false, true, "alt");
      const b1 = modal.querySelector("[data-p-ok]"), b2 = modal.querySelector("[data-p-no]"), b3 = modal.querySelector("[data-p-alt]");
      if (b1) b1.onclick = () => finish(true, false, "ok");
      if (b2) b2.onclick = () => finish(false, false, "no");
      if (b3) b3.onclick = () => finish(false, true, "alt");
      mask.onclick = () => finish(false, false, "no");
      if (onBind) onBind(modal, finish);
    });
  }
  // 读回出图单里用户改过的值（只读 DOM，不碰业务）
  function readBriefCard(scope) {
    const out = {};
    const nodes = (scope || document).querySelectorAll("[data-cf]");
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      out[n.getAttribute("data-cf")] = (n.value || "").trim();
    }
    return out;
  }
  // 出图单面板（设定流程第 3 步 / 首次出图前的闸门共用）
  //   返回 {ok, brief}；ok=true 时 brief 已落库到 rec.look.brief
  async function briefPanel(item, draft, title) {
    try {
      const v = Spirits.validateAnatomy(draft);
      const html = '<div class="look-confirm">' +
        '<div class="look-confirm-head">' + esc(title || "🎨 出图设定（可以直接改）") + "</div>" +
        '<div class="look-confirm-sub">这就是照着画的那张单子。<b>哪行不对就直接点进去改</b>，改完点「保存并出图」。</div>' +
        Spirits.renderConfirmCard(draft, true) +
        (v.ok ? "" : '<div class="look-confirm-warn">⚠️ ' + esc(v.issues.join("；")) + "</div>") +
        '<div class="look-confirm-actions">' +
        '<button class="btn ghost" data-p-no>再想想</button>' +
        '<button class="btn primary" data-p-ok>保存并出图</button></div></div>';
      const res = await openEditPanel(html, (m) => readBriefCard(m));
      if (!res.ok) return { ok: false };
      const brief = Spirits.mergeBrief(Spirits.toBrief(draft), res.values || {});
      const s2 = Spirits.load();
      const r2 = Spirits.ensureIn(s2, item.id);
      r2.look = Object.assign({}, r2.look || {}, { brief: brief });
      Spirits.save(s2);
      return { ok: true, brief: brief };
    } catch (e) {
      return { ok: true, brief: null };   // 异常不阻塞（降级放行，生成本体仍走既有逻辑）
    }
  }
  // v163b/v164：出图确认闸门。已经确认过出图单（look.brief）→ 直接放行；
  //   没确认过（老记录 / 刚装的）→ 弹一次可编辑的出图单，确认后落库，之后再出图不再重复打扰。
  async function gateLookConfirm(item) {
    try {
      const rec = Spirits.ensureIn(Spirits.load(), item.id);
      if (rec.look && rec.look.brief) return true;            // 已确认过 → 直接用
      const draft = Spirits.extractLookBrief(rec, item);
      const got = await briefPanel(item, draft, "🎨 确认出图设定（可以直接改）");
      return !!got.ok;
    } catch (e) { return true; }
  }

  /* ---------- 全部沁灵（#/spirits，v113 从沁灵页拆出来） ---------- */
  function renderAllSpiritsPage() {
    topbarTitle.textContent = "全部沁灵";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const list = spiritItems();
    const store = Spirits.load();
    if (!list.length) {
      view.innerHTML = emptyCardHtml({
        ill: "spirit", icon: "🍡", title: "还没有沁灵醒过来",
        sub: "把一串盘到「已挂瓷」，它就会开沁", hint: "盘玩 → 已挂瓷 → 自动开沁",
      });
      return;
    }
    const tk = Spirits.todayKey();
    // v165-M：⛔ 这里不再自动写 r.stage —— rec.stage 语义改为「已确认阶」，
    //   唯一写点是用户点「✨ 可以进阶了 · 点此进阶」（见 confirmStage）。可达阶一律用 Spirits.stageOf 现算。
    // v126 第 4 期：图鉴页头统计（与「今日任务」「成就殿堂」同一套排版）——按形态统计收集进度
    const stageCount = [0, 0, 0, 0];
    let cgCount = 0, diaryCount = 0;
    list.forEach((it) => {
      const r = store[it.id] || {};
      const st = Math.min(4, Math.max(1, Number(r.stage) || 1));
      stageCount[st - 1] += 1;
      if (r.cgUrl) cgCount += 1;
      diaryCount += (r.diary || []).length;
    });
    let html = pageStatsHtml([
      { n: list.length, l: "沁灵总数" },
      { n: stageCount[3] + stageCount[2], l: "觉醒 / 化形" },
      { n: cgCount, l: "已有 CG" },
      { n: diaryCount, l: "日记总篇数" },
    ]);
    html += '<div class="section-title">🍡 我的沁灵（' + list.length + '）' +
      '<small style="color:var(--text-2);font-weight:400;font-size:11px"> 点它进详情页</small>' +
      '<button type="button" class="link-btn" id="spRedrawAll" style="float:right;font-size:11px">🖌 全部重画</button>' +
      '<button type="button" class="link-btn" id="spRecoverOld" style="float:right;font-size:11px;margin-right:8px">🔙 恢复旧立绘</button></div>';
    // 形态收集进度（图鉴感）：四个形态各多少只
    html += paperCardHtml('<div class="bkc-row" style="display:flex;gap:6px;text-align:center">' +
      Spirits.STAGES.map((sd, i) =>
        '<div style="flex:1"><div style="font-size:17px">' + sd.icon + '</div>' +
        '<div style="font-size:14px;font-weight:800;color:var(--wood)">' + stageCount[i] + "</div>" +
        '<div style="font-size:10px;color:var(--text-2)">' + esc(sd.name) + "</div></div>").join("") +
      "</div>", "tight");
    html += '<div class="spirit-grid">';
    list.forEach((it) => {
      const rec = store[it.id] || {};
      const p = rec.persona || null;
      const idle = it.lastPlayedAt ? Math.floor((Date.now() - it.lastPlayedAt) / 86400000) : null;
      const si = Spirits.stageInfo(it, rec.stage, DB.daysWith(it));
      const room = rec.roomId ? Rooms.getRoom(rec.roomId) : null;
      const wroteToday = (rec.diary || []).some((e) => e && e.date === tk) && (rec.diarySeenAt || 0) < ((rec.diary || []).slice(-1)[0] || {}).at;
      const needSetup = spiritNeedsSetup(rec);
      html += '<div class="spirit-card' + (si.canBreak ? " can-break" : "") + '" data-spirit="' + esc(it.id) + '">' +
        spiritThumbHtml(it, rec, 96) +
        '<div class="spirit-meta">' +
        '<div class="spirit-name">' + esc(spiritName(it, store)) +
        '<span class="spirit-stage">' + si.icon + " " + esc(si.name) + "</span>" +
        (needSetup ? '<span class="look-setup-tag" data-setup="' + esc(it.id) + '">✨ 定设定</span>' : "") +
        (si.canBreak ? '<span class="spirit-break-tag">✨ 可深沁</span>' : "") +
        (wroteToday ? '<span class="spirit-break-tag" style="background:#e8f0ff;color:#3b5b9a">📔 写日记了</span>' : "") + "</div>" +
        '<div class="spirit-title">' + esc((p && p.title) || "正在酝酿性格…") +
        (room ? ' · <span style="color:var(--text-2)">' + esc((room.emoji || "🏠") + room.name) + "</span>" : "") + "</div>" +
        '<div class="spirit-line">' + esc((p && p.line) || "") + "</div>" +
        (si.isMax ? '<div class="spirit-prog max">已是化形 · 巅峰形态 👑</div>'
          : '<div class="spirit-prog"><span class="spirit-prog-track"><span class="spirit-prog-fill" style="width:' + si.pct + '%"></span></span>' +
            '<span class="spirit-prog-txt">再盘 ' + si.toNext + " 次 → " + esc(si.next) + "</span></div>") +
        '<div class="spirit-tags">' + ((p && p.traits) || []).map((t) => '<span class="spirit-trait">' + esc(t) + "</span>").join("") +
        (idle != null ? '<span class="spirit-trait idle">' + idle + " 天没盘</span>" : "") + "</div>" +
        "</div></div>";
    });
    html += "</div>";
    html += '<button class="btn ghost" id="spBackRooms" style="width:100%;margin-top:14px">← 回到小房间</button>';
    const sh2 = setupHintHtml(list, store);
    if (sh2.html) html += sh2.html;
    view.innerHTML = html;
    bindSetupHint(sh2.first);
    bindSpiritImgFallback(view);
    view.querySelectorAll(".spirit-card").forEach((c) => c.addEventListener("click", () => {
      const id = c.dataset.spirit;
      if (id) location.hash = "#/spirit/" + encodeURIComponent(id);
    }));
    // v127：卡片上的「✨ 定设定」→ 直接开这一尊的向导（不跳详情页）
    view.querySelectorAll("[data-setup]").forEach((el) => el.onclick = (e) => {
      e.stopPropagation();
      const it = list.filter((x) => x.id === el.dataset.setup)[0];
      if (it) showSpiritSetupModal(it);
    });
    const back = $("#spBackRooms");
    if (back) back.onclick = () => location.hash = "#/spirit";
    bindRedrawAll(list, renderAllSpiritsPage);
    ensureSpiritData(list);
    ensureSpiritLook(list).then(() => ensureSpiritImages(list)).then(() => ensureSpiritCg(list));
    ensureSpiritFaces(list);
    ensureSpiritExtras(list);
    tickRooms();          // 进这一页也推进契合度/补写剧情（v114：之前只有沁灵页会推）
    maybeOpenSpiritSetup(list);      // v127
  }

  // 🔙 恢复旧立绘（v164c 回归用）：用旧版 prompt 精确还原 v164c 之前的出图 URL，冻结进 rec.imgUrl。
  // 仅当 pollinations 还缓存着旧 URL（或按旧 prompt + 固定 seed 重新生成出相近图）时，旧立绘才会回来。
  async function recoverOldPortraits(list, rerender) {
    const st = Spirits.load();
    let n = 0;
    for (const it of (list || [])) {
      const r = Spirits.ensureIn(st, it.id);
      r.imgUrl = Spirits.legacyPollinationsUrl(it, (r.variant || 0));
      r.imgAt = Date.now();
      r.imgFrozen = true;
      r._imgErr = ""; r._imgErrAt = 0;
      n++;
    }
    Spirits.save(st);
    toast("已按 v164c 之前的旧设定重铺 " + n + " 只立绘，正在加载（缓存命中即原图）…");
    if (rerender) rerender();
  }

  // 🖌 全部重画（沁灵页与全部沁灵页共用）
  function bindRedrawAll(list, rerender) {
    const redrawAll = $("#spRedrawAll");
    if (redrawAll) {
      redrawAll.onclick = async () => {
        const st0 = Spirits.load();
        const n = list.filter((it) => st0[it.id] && st0[it.id].imgUrl).length;
        if (!n) { toast("还没有立绘可重画"); return; }
        const yes = await confirmModal("要重画全部 " + n + " 只沁灵吗？",
          "已有的立绘（含进化史里的旧图）都会作废、按最新形象设定重画，消耗 " + n + " 次出图额度（每只 1 张）。想只重画某一尊，进它的详情页点「🔁 换形象」。",
          "重画 " + n + " 张", true);
        if (!yes) return;
        const st = Spirits.load();
        list.forEach((it) => {
          const r = Spirits.ensureIn(st, it.id);
          r.imgUrl = ""; r.imgAt = 0; r.face = null; r._imgErr = ""; r._imgErrAt = 0; r.imgHistory = []; r.lookStale = false; r.imgFrozen = 0;
        });
        Spirits.save(st);
        toast("开始重画 " + n + " 只沁灵…");
        rerender();
      };
    }
    const recover = $("#spRecoverOld");
    if (recover) {
      recover.onclick = async () => {
        const yes = await confirmModal("恢复到 v164c 之前的旧立绘？",
          "用旧版出图设定（v164c 加比例锁定之前）重铺全部 " + list.length + " 只立绘。只影响显示，不花额度；若 pollinations 还缓存着旧图就是原图，否则会按旧 prompt 重新生成一张相近的。",
          "恢复旧立绘", true);
        if (yes) await recoverOldPortraits(list, rerender);
      };
    }
  }

  /* ============================================================
   * v109：小房间 / 契合度 / 剧情 / 沁灵独立详情页 / 日记
   * ============================================================ */
  function spiritItemById(id) { return allItems.find((x) => x.id === id) || null; }
  function spiritRecOf(id) { return Spirits.load()[id] || {}; }
  function setSpiritRoom(id, roomId) {
    const s = Spirits.load();
    const r = Spirits.ensureIn(s, id);
    r.roomId = roomId || "";
    Spirits.save(s);
  }
  // 带 roomId 的沁灵列表（房间模块需要）
  function roomItems() {
    const s = Spirits.load();
    return spiritItems().map((it) => Object.assign({}, it, { roomId: (s[it.id] && s[it.id].roomId) || "" }));
  }
  // v163：主线 room 门槛（房间同住 ≥2）在 app 层算好传给引擎，别把 Rooms 依赖写进 spirits.js。
  //   没进房间 = 1（一个人住也算 1，room≥2 永远为假）；进了房间 = 实际同住只数。
  function roomCountOf(rec) {
    const rid = rec && rec.roomId;
    if (!rid) return 1;
    return Math.max(1, Rooms.membersOf(rid, roomItems()).length);
  }
  function nameOf(it, store) {
    const rec = (store || Spirits.load())[it.id] || {};
    return rec.name || (rec.persona && rec.persona.name) || it.name || "沁灵";   // v113：用户改过的名字优先
  }
  function spiritName(it, store) { return nameOf(it, store); }
  function spiritSp(it) {
    const rec = spiritRecOf(it.id);
    return {
      item: it,
      // 名字用用户改过的（剧情/日记里也会用新名字）
      persona: Object.assign({}, rec.persona || Spirits.localPersona(it), { name: spiritName(it, Spirits.load()) }),
      stage: rec.stage || 1,
      variant: rec.variant || 0,
      idleDays: it.lastPlayedAt ? Math.floor((Date.now() - it.lastPlayedAt) / 86400000) : null,
    };
  }
  function diaryCtx(it, rec) {
    const now = Date.now();
    const tk = Spirits.todayKey();
    const playedToday = !!(it.lastPlayedAt && (now - it.lastPlayedAt) < 20 * 3600 * 1000 &&
      Spirits.todayKey(new Date(it.lastPlayedAt)) === tk);
    return {
      idleDays: it.lastPlayedAt ? Math.floor((now - it.lastPlayedAt) / 86400000) : null,
      dayNo: Math.max(1, DB.daysWith(it)),
      plays: it.playCount || 0,
      playedToday: playedToday,
      canBreak: Spirits.stageInfo(it, rec && rec.stage, DB.daysWith(it)).canBreak,   // v155：问候/签文用
    };
  }
  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  // v155：日期（回响信落款用）
  function fmtDay(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function unreadStoryCount() { return Rooms.unreadStories(roomItems()).length; }
  // 今天写了日记、并且还没去看过的沁灵数
  function newDiaryCount() {
    const tk = Spirits.todayKey();
    const s = Spirits.load();
    return spiritItems().filter((it) => {
      const rec = s[it.id] || {};
      const list = (rec.diary || []).filter((e) => e && e.date === tk);
      if (!list.length) return false;
      return (rec.diarySeenAt || 0) < (list[list.length - 1].at || 0);
    }).length;
  }
  // 沁灵 tab 上的小红点（有新剧情或新日记时）
  function updateStoryDot() {
    const tab = document.getElementById("tabSpirit");
    if (!tab) return;
    let dot = tab.querySelector(".tab-dot");
    const n = unreadStoryCount() + newDiaryCount();
    if (n) { if (!dot) { dot = document.createElement("span"); dot.className = "tab-dot"; tab.appendChild(dot); } }
    else if (dot) dot.remove();
  }
  // 夜话 tab 上的小红点（有能聊、还没聊完的一幕时）
  function updateNightDot() {
    const tab = document.getElementById("tabNight");
    if (!tab) return;
    let dot = tab.querySelector(".tab-dot");
    let n = 0;
    try {
      const S = nightNow();
      S.threads.forEach((t) => { n += threadOpenCount(threadNow(t.id)); });
    } catch (e) { n = 0; }
    if (n) { if (!dot) { dot = document.createElement("span"); dot.className = "tab-dot"; tab.appendChild(dot); } }
    else if (dot) dot.remove();
  }

  /* ---------- 房间区（沁灵列表页顶部） ----------
     v165：v163b 导航收敛后本函数已无调用点（房间列表不再嵌在沁灵页顶部）；
       建房入口已移到「沁灵巷」页（renderTownPage 的 #townNewRoom → showRoomEditModal(null)）。
       ⛔ 保留本函数与 bindRoomSection 作备用，⛔ 不要在此恢复调用（会推翻 v163b 的导航收敛）。 */
  function renderRoomsSection(list, store) {
    const rooms = Rooms.listRooms();
    const items = roomItems();
    const unreadByRoom = {};
    Rooms.unreadStories(items).forEach((u) => { if (u.roomId) unreadByRoom[u.roomId] = (unreadByRoom[u.roomId] || 0) + 1; });
    let h = '<div class="section-title" style="margin-top:14px">🏠 沁灵的小房间（' + rooms.length + "）" +
      '<button type="button" class="link-btn" id="spNewRoom" style="float:right;font-size:11px">＋ 新建房间</button></div>';
    if (!rooms.length) {
      h += '<div class="room-empty">还没有房间。建一间小屋把沁灵放进去，住在一起的沁灵会慢慢攒「契合度」，' +
        "攒够了就会发生属于它们的故事 ✨</div>";
    } else {
      h += '<div class="room-grid">';
      rooms.forEach((r) => {
        const mem = Rooms.membersOf(r.id, items);
        const aff = Rooms.roomAffinity(r.id, items);
        const un = unreadByRoom[r.id] || 0;
        h += '<div class="room-card" data-room="' + esc(r.id) + '">' +
          '<div class="room-head"><span class="room-emoji">' + esc(r.emoji || "🏠") + "</span>" +
          '<span class="room-name">' + esc(r.name) + "</span>" +
          (un ? '<span class="room-dot">📖 ' + un + "</span>" : "") + "</div>" +
          '<div class="room-members">' +
          (mem.length ? mem.slice(0, 5).map((it) => spiritThumbHtml(it, store[it.id] || {}, 42)).join("")
            : '<span class="room-none">还没有沁灵入住</span>') +
          (mem.length > 5 ? '<span class="room-more">+' + (mem.length - 5) + "</span>" : "") + "</div>" +
          '<div class="room-foot">' + (mem.length < 2 ? "住满 2 只，它们才会慢慢熟起来"
            : (aff.best ? "💞 最合拍：" + esc(nameOf(aff.best.a, store)) + " × " + esc(nameOf(aff.best.b, store)) + " · " + aff.best.aff : "")) + "</div>" +
          "</div>";
      });
      h += "</div>";
    }
    const homeless = list.filter((it) => !(store[it.id] || {}).roomId).length;
    if (homeless) h += '<div class="room-hint">🛏 还没入住的沁灵：' + homeless + " 只 —— 进房间点「＋ 请沁灵入住」安排入住</div>";
    return h;
  }
  // v165：同上 —— v163b 起无调用点，仅保留备用（见 renderRoomsSection 上方注释）。
  function bindRoomSection() {
    const nb = $("#spNewRoom");
    if (nb) nb.onclick = (e) => { e.stopPropagation(); showRoomEditModal(null); };
  }

  /* ---------- 契合度推进 + 剧情生成 ---------- */
  let _roomBusy = false;
  let _brokenSrcs = new Set();   // v164f：详情页收集到的「加载失败」图片 src，供🧹清理使用
  let _sdKeyHandler = null;   // v164g：详情页左右切换的键盘监听（重渲染时先移除旧的，避免叠加）

  // v164f：把详情页里加载失败的图（进化史 / CG / 节令插画 / 主立绘）标记出来，换成「图已失效」占位，并记录 src 供清理
  function bindBrokenImgCleanup(root) {
    (root || view).querySelectorAll("img").forEach((img) => {
      img.addEventListener("error", () => {
        if (img.dataset.broken) return;
        img.dataset.broken = "1";
        const src = img.getAttribute("src") || img.src || "";
        if (src) _brokenSrcs.add(src);
        if (img.dataset.fallback) return;   // 带兜底的主图由 bindSpiritImgFallback 处理
        const ph = document.createElement("div");
        ph.className = "img-broken-ph";
        ph.textContent = "🚫 图已失效";
        ph.style.cssText = "width:100%;min-height:64px;display:flex;align-items:center;justify-content:center;color:var(--text-2);font-size:12px;background:var(--line);border-radius:8px;margin:4px 0";
        img.replaceWith(ph);
      });
    });
  }
  // v164f：清空当前沁灵所有「加载失败」的图（进化史 + 主立绘），清完重渲染
  function cleanupBrokenImages(it) {
    if (!it) return;
    const st = Spirits.load();
    const r = Spirits.ensureIn(st, it.id);
    let n = 0;
    if (Array.isArray(r.imgHistory)) {
      const before = r.imgHistory.length;
      r.imgHistory = r.imgHistory.filter((x) => x && x.url && !_brokenSrcs.has(x.url));
      n += before - r.imgHistory.length;
    }
    if (r.imgUrl && _brokenSrcs.has(r.imgUrl)) { r.imgUrl = ""; r.imgFrozen = 0; r.imgAt = 0; n++; }
    if (!n) { toast("没有发现失效图（能正常显示的都留着）"); return; }
    Spirits.save(st);
    _brokenSrcs.clear();
    toast("已清理 " + n + " 张失效图");
    renderSpiritDetailPage(it.id);
  }
  async function tickRooms() {
    if (_roomBusy) return;
    _roomBusy = true;
    try {
      const items = roomItems();
      const res = Rooms.tick(items);
      const pend = Rooms.pendingStories(items).slice(0, 3);      // 一次最多补 3 段，别把额度打光
      for (const q of pend) {
        const a = items.find((x) => x.id === q.a), b = items.find((x) => x.id === q.b);
        if (!a || !b) continue;
        const room = Rooms.getRoom(q.roomId) || { name: "它们的小房间" };
        const txt = await Spirits.roomStory(spiritSp(a), spiritSp(b), q.level, room.name, Rooms.affinityOf(q.a, q.b));
        Rooms.writeStory(q.a, q.b, q.level, "", txt);
        // v165-R2：⛔ **双人事件 CG 不再自动出图**（这一段整块删掉了）。
        //   现在是「描述先行」：用户在剧情弹层里 ⓪ 生成描述 → ① 改到满意 → ② 点「按这段描述出图」才画。
      }
      updateStoryDot();
      if (res.changed || pend.length) rerenderSpiritView();
    } catch (e) { /* 静默 */ }
    _roomBusy = false;
  }

  /* ---------- 补齐：真实主色 / 中文人设 / 形象细节关键词（要在出图之前跑） ---------- */
  let _lookBusy = false;
  async function ensureSpiritLook(list) {
    if (_lookBusy) return;
    _lookBusy = true;
    try {
      let changed = false;
      for (const it of list) {
        const rec0 = Spirits.ensureIn(Spirits.load(), it.id);
        const ap = Spirits.appearanceOf(it, rec0.appearanceSeed || 0, rec0.gender || "");
        if (!Spirits.beadColor(it) && it.photos && it.photos.length) {
          if (await Spirits.detectBeadColor(it)) changed = true;
        }
        const beforeZh = rec0.personaZh;
        // 名字优先用用户改过的（人设里提到名字时也跟着变）
        const pOverride = Object.assign({}, rec0.persona || Spirits.localPersona(it), { name: spiritName(it, Spirits.load()) });
        await Spirits.personaZh(it, ap, pOverride, rec0.stage || 1, DB.daysWith(it), it.playCount || 0);
        const rec1 = Spirits.load()[it.id] || {};
        if (rec1.personaZh !== beforeZh) changed = true;
        // 人物设定 → 英文形象细节（出图时会把它们拼进 prompt）
        const tagsBefore = Spirits.getLookTags(it);
        const tags = await Spirits.buildLookTags(it, ap, rec1.personaZh, rec1.persona);
        if (tags !== tagsBefore) {
          changed = true;
          // 已经有立绘、但形象细节是新的 → 标记一下，详情页会提示"按新设定重画"
          if (rec1.imgUrl) {
            const s2 = Spirits.load();
            Spirits.ensureIn(s2, it.id).lookStale = true;
            Spirits.save(s2);
          }
        }
      }
      if (changed) rerenderSpiritView();
    } catch (e) { /* 静默 */ }
    _lookBusy = false;
  }

  /* ---------- 补齐：沁灵日记 ---------- */
  let _extraBusy = false;
  async function ensureSpiritExtras(list) {
    if (_extraBusy) return;
    _extraBusy = true;
    try {
      let changed = false;
      for (const it of list) {
        const rec0 = Spirits.ensureIn(Spirits.load(), it.id);
        const ap = Spirits.appearanceOf(it, rec0.appearanceSeed || 0, rec0.gender || "");
        const st = Spirits.load();
        const r2 = Spirits.ensureIn(st, it.id);
        const ctx = diaryCtx(it, r2);
        const added = await Spirits.ensureDiary(it, r2, ap, ctx);
        if (added) changed = true;
        // v155：陪伴系统本地结算（问候 / 亲密度 / 每日一签 / 回响）—— 0 出图、0 模型调用
        // ⚠️ 必须在 ensureDiary 之后**重新 load**：ensureDiary 内部自己 load+save，
        //    如果拿旧对象再 save 会把刚写好的日记冲掉
        const st2 = Spirits.load();
        const r3 = Spirits.ensureIn(st2, it.id);
        let dirty = false;
        if (Spirits.settleBond(it, r3, ctx)) dirty = true;
        if (Spirits.ensureGreet(it, r3, ctx)) dirty = true;
        if (Spirits.ensureSign(it, r3)) dirty = true;
        if (Spirits.ensureEcho(it, r3, ctx)) { dirty = true; changed = true; }   // 有新回响 → 要重渲染
        // v158：节令事件（全本地；只有当天有节令才写，写一次就够）
        if (Spirits.ensureFest(it, r3, ctx)) { dirty = true; changed = true; }
        if (dirty) Spirits.save(st2);
      }
      if (changed) rerenderSpiritView();
    } catch (e) { /* 静默 */ }
    _extraBusy = false;
  }

  /* ---------- v163 · 沁灵纪（主线入口页）：主串集合制选择 ----------
     主串数量不限：手动勾选任意串 + 「5 星自动纳入」开关。CG 仅对主串集内的串生成。
     设计 §C.2：ww_story 全局一条（mainIds / mainStar5 / mainAt / switched / wuhe），不进 rec。 */
  function renderMainStoryPage() {
    topbarTitle.textContent = "📜 沁灵纪";
    _onBack = () => { location.hash = "#/spirit"; };   // 返回到「沁灵」页（入口处）
    const store = Spirits.load();
    const story = Spirits.readStory();
    const star5Auto = story.mainStar5 !== false;
    const manualIds = new Set((Array.isArray(story.mainIds) ? story.mainIds : (story.mainId ? [story.mainId] : [])).map(String));
    const CG_PER = 8, UNIT = 0.13;                      // 单只主串 8 张 CG；单张约 ¥0.13（成本提示用）
    const CG_TOTAL = Spirits.CG_TOTAL || 8;
    const switched = Number(story.switched) || 0;

    const items = allItems.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh"));
    let html = '<div class="ms-head">' +
      '<p class="ms-desc">主线（沁灵纪）不限主串数量。手动勾选任意串，或开启「5 星自动纳入」让评分满 5 星的串自动成为主串。只有主串才会推进「串与我」12 章主线与夜话专属剧情。</p>' +
      '<label class="ms-toggle"><input type="checkbox" id="msStar5"' + (star5Auto ? " checked" : "") + '> 5 星自动纳入（评分 ≥5 且未送人的串自动成为主串）</label>' +
      '<div class="ms-actions">' +
        '<button class="btn ghost" id="msAll">全选</button>' +
        '<button class="btn ghost" id="msNone">全不选</button>' +
        '<button class="btn primary" id="msSave">保存</button>' +
      '</div></div>';
    html += '<div class="ms-list">';
    if (!items.length) {
      html += '<div class="ms-empty">还没有串。先去收藏柜添加你的文玩吧。</div>';
    }
    items.forEach((it) => {
      const auto = star5Auto && !it.gifted && (Number(it.star) || 0) >= 5;
      const checked = auto || manualIds.has(String(it.id));
      const star = Number(it.star) || 0;
      html += '<label class="ms-row' + (it.gifted ? " ms-gifted" : "") + '">' +
        '<input type="checkbox" class="ms-chk" data-id="' + esc(it.id) + '"' + (checked ? " checked" : "") + (auto ? " disabled" : "") + '>' +
        '<span class="ms-name">' + esc(it.name || "未命名") + '</span>' +
        '<span class="ms-meta">' + (star ? ("★" + star + " ") : "") + (it.gifted ? "已送人" : "") +
          (auto ? ' <em class="ms-auto">⭐自动</em>' : "") + '</span>' +
        '</label>';
    });
    html += '</div>';
    view.innerHTML = html;

    const star5El = $("#msStar5");
    if (star5El) star5El.onchange = () => renderMainStoryPage();   // 切自动开关 → 重渲染（自动项出现/消失）
    const allBtn = $("#msAll"), noneBtn = $("#msNone"), saveBtn = $("#msSave");
    if (allBtn) allBtn.onclick = () => { view.querySelectorAll(".ms-chk:not([disabled])").forEach((c) => { c.checked = true; }); };
    if (noneBtn) noneBtn.onclick = () => { view.querySelectorAll(".ms-chk:not([disabled])").forEach((c) => { c.checked = false; }); };
    if (saveBtn) saveBtn.onclick = async () => {
      const sel = [];
      view.querySelectorAll(".ms-chk").forEach((c) => { if (c.checked) sel.push(c.dataset.id); });
      const star5 = !!(star5El && star5El.checked);
      // 预览「若这样保存」的有效主串集；只对新进入、且 CG 未齐的主串计费（已齐的直接复用）
      const oldSet = Spirits.mainSetOf(allItems, store);
      const newSet = Spirits.mainSetOf(allItems, store, { mainIds: sel, mainStar5: star5 });
      let newWork = 0;
      newSet.forEach((id) => {
        if (oldSet.has(id)) return;                              // 本来就是主串 → 不新增
        const rec = store[id] || {};
        const done = Spirits.cgCollectedCount(rec) >= CG_TOTAL;  // CG 已齐 → 复用，不重复计费
        if (!done) newWork++;
      });
      const totalEnabled = newSet.size;
      let desc;
      if (newWork === 0) {
        desc = "这次没有需要新画的主线 CG（" + totalEnabled + " 只主串的 CG 都已就绪，或只是调整了勾选）。确定保存吗？";
      } else {
        const cgN = newWork * CG_PER;
        const cost = (cgN * UNIT).toFixed(2);
        desc = "这次要启用 " + newWork + " 只主串，共 " + cgN + " 张 CG，约 ¥" + cost + "。";
        if (totalEnabled > newWork) desc += "（另有 " + (totalEnabled - newWork) + " 只 CG 已就绪，直接复用，不重复计费）";
        if (switched >= 1) desc += " 你已改动过 " + switched + " 次主串，每次新增主串都要多出 8 张 CG，花钱前想清楚哦。";
      }
      const ok2 = await confirmModal("保存主串设置", desc, "保存", false);
      if (!ok2) return;
      Spirits.setMainStory(sel, star5);                           // 写 ww_story（不进 rec）
      _spiritsDirty = true; pushSpirits();                        // 顺带把 ww_story 一起同步到云端
      toast("已保存主串设置 🪢");
      renderMainStoryPage();
    };
  }

  /* ---------- 沁灵相关页面的"原地刷新"统一入口（v114） ----------
     原来四处各写各的分支：`#/spirits`（全部沁灵）会被当成房间页刷掉，
     甚至被 tickRooms 里 "房间找不到 → location.hash = #/spirit" 弹回房间页。
     现在统一走这里，四个页面各刷各的。 */
  function rerenderSpiritView() {
    try {
      const h = location.hash;
      if (h === "#/spirits") { renderAllSpiritsPage(); return; }
      if (h === "#/spirit") { renderSpiritPage(); return; }
      if (h.indexOf("#/spirit/") === 0) {
        const y = window.scrollY;
        renderSpiritDetailPage(decodeURIComponent(h.slice(9)));
        window.scrollTo(0, y);
        return;
      }
      if (h.indexOf("#/room/") === 0) renderRoomPage(decodeURIComponent(h.slice(7)));
    } catch (e) { /* 静默 */ }
    try { flushEventPops(); } catch (e2) { /* 忽略 */ }   // v163b：局部重渲染后也把事件卡弹出
  }

  /* ---------- v125：CG（蜕形 / 化形额外一张场景插画） ----------
     规则：凝形 / 开窍**只有立绘**；蜕形 / 化形**立绘 + CG 都有**。
     CG 跟着"阶段 + 外观设定 + 换形象次数"缓存，变了才重画（每张 ≈ 一次出图额度）。 */
  let _cgBusy = false;
  // CG 的缓存 key：阶段 / 人设种子 / 性别 / 换形象次数 / 服务商 —— 任一变了才重画
  function cgKeyOf(rec) {
    return (Number(rec.stage) || 1) + "|" + (rec.appearanceSeed || 0) + "|" + (rec.gender || "") +
      "|" + (rec.variant || 0) + "|" + (Spirits.getImageCfg().provider || "");
  }
  // 单只沁灵：形象变了（换外观/换形象）或刚深沁 → 撤掉不匹配的旧 CG，并把新的补上
  function refreshCgAfter(item) {
    try {
      const s = Spirits.load();
      const r = Spirits.ensureIn(s, item.id);
      const stage = Number(r.stage) || 1;
      if (!Spirits.needCg(stage)) {
        if (r.cgUrl || r.cgKey) { r.cgUrl = ""; r.cgKey = ""; r.cgStage = 0; Spirits.save(s); }
        return;
      }
      if (r.cgUrl && r.cgKey === cgKeyOf(r)) return;               // 已经是最新的
      if (r.cgUrl || r.cgKey) {                                     // 旧 CG 跟新形象对不上了 → 先撤掉
        r.cgUrl = ""; r.cgKey = ""; r.cgStage = 0; Spirits.save(s);
      }
      ensureSpiritCg([item]);
    } catch (e) { /* 静默 */ }
  }
  // v165-R2：⛔ **CG 绝不自动出图**。这里只剩两件事：
  //   ① 阶段不到（凝形/开窍）→ 撤掉 CG；② 形象变了 → 撤掉对不上的旧 CG。
  //   欠图一律 `continue`（与 M 批次 `stageImgPending` 同口径）—— 新图只能由用户在 CG 卡片里
  //   「确认描述 → 点『按这段描述出图』」手动触发。
  async function ensureSpiritCg(list) {
    if (_cgBusy) return;
    _cgBusy = true;
    try {
      let changed = false;
      for (const it of list) {
        const st0 = Spirits.load();
        const rec = Spirits.ensureIn(st0, it.id);
        if (rec.spirit === false) continue;          // v166：只当手串的串不出 CG
        const stage = Number(rec.stage) || 1;
        if (!Spirits.needCg(stage)) {
          // 早期阶段：清掉 CG（只保留立绘）
          if (rec.cgUrl || rec.cgKey) { rec.cgUrl = ""; rec.cgKey = ""; rec.cgStage = 0; Spirits.save(st0); changed = true; }
          continue;
        }
        // 形象变了（换外观 / 换形象 / 换服务商）→ 旧 CG 对不上了，撤掉
        if ((rec.cgUrl || rec.cgKey) && rec.cgKey !== cgKeyOf(rec)) {
          rec.cgUrl = ""; rec.cgKey = ""; rec.cgStage = 0; Spirits.save(st0); changed = true;
        }
        if (!rec.cgUrl) continue;        // ⛔ 欠图：只记着，绝不自动补（出图必须用户点确认）
      }
      if (changed) rerenderSpiritView();
    } catch (e) { /* 静默 */ }
    _cgBusy = false;
  }

  /* ---------- v165-R2：CG「描述先行」—— 生成描述 / 按描述出图（两条 CG 线共用） ----------
     ⛔ 唯一出图入口：只有用户点了「🎬 按这段描述出图」才会真的烧额度。 */
  const _cgRedo = {};      // 已有 CG 但用户要「改描述重画」→ 临时切回描述编辑态
  async function genCgBrief(o) {
    try { return await Spirits.cgBrief(o); } catch (e) { return Spirits.cgBriefLocal(o); }
  }
  // 从**确认后**的中文描述 → 装配英文 prompt → 手动出图（横版）；返回图片 url
  async function drawCgFromBrief(brief, o) {
    const kw = await Spirits.cgKeywords(brief, o).catch(() => "");
    const prompt = Spirits.cgPromptFromBrief(brief, Object.assign({}, o, { keywords: kw }));
    const res = await Spirits.generateCustom(prompt, {
      seedKey: (o && o.seedKey) || ("cg|" + String(brief).slice(0, 24)),
      variant: (o && o.variant) || 0,
      ref: (o && o.ref) || "",
      landscape: true,                       // ⛔ CG 一律横版（cgLadderFor）
    });
    const url = (await imageToStoreUrl(res.b64 ? "data:image/png;base64," + res.b64 : res.url,
      CG_IMG_SIZE, 0.9, CG_IMG_SIZE_LOCAL, 0.86)).url;
    return { url: url, prompt: prompt };
  }
  // 节令 CG：描述先行弹层（⓪ 生成描述 → ① 编辑确认 → ② 手动出图）
  function openFestCgBriefModal(item, dk, fx0) {
    const mask = $("#modalMask"), modal = $("#modal");
    const id = String(item.id);
    modal.innerHTML = "<h3>🎋「" + esc(fx0.name) + "」限定插画</h3>" +
      '<div style="font-size:12px;color:var(--text-2);text-align:center;margin-bottom:10px">' +
      "先看要画什么 —— 描述可以改，改满意了再出图（消耗 1 次出图额度，每只沁灵每个节令只画一次）</div>" +
      '<textarea class="cg-brief-ta" id="festCgBrief" rows="5" placeholder="点「🔤 生成画面描述」，或者自己写：它站在哪儿、穿什么、在做什么">' +
      esc((fx0 && fx0.brief) || "") + "</textarea>" +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button class="btn ghost" id="festCgGen" style="flex:1">🔤 生成画面描述</button>' +
      '<button class="btn primary" id="festCgDraw" style="flex:1">🎬 按这段描述出图</button>' +
      "</div>" +
      '<button class="btn ghost" id="festCgClose" style="width:100%;margin-top:8px">先不画</button>';
    mask.hidden = false; modal.hidden = false; modal.style.display = "";
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    const cl = $("#festCgClose"); if (cl) cl.onclick = close;
    mask.onclick = close;
    const ta = $("#festCgBrief");
    const g = $("#festCgGen");
    if (g) g.onclick = async () => {
      g.disabled = true; g.textContent = "正在写描述…";
      try {
        const rr = Spirits.load()[id] || {};
        const br = await genCgBrief({
          kind: "fest", item: item, stage: Number(rr.stage) || 1,
          look: Spirits.lookOf(item, rr), persona: rr.persona || null,
          festName: fx0.name, festScene: "",
        });
        if (ta) ta.value = br;
        const s = Spirits.load(); const r = Spirits.ensureIn(s, id);
        r.fests = r.fests || {}; if (r.fests[dk]) r.fests[dk].brief = br;
        Spirits.save(s);
      } catch (e) { toast("描述生成失败：" + ((e && e.message) || "请稍后再试")); }
      g.disabled = false; g.textContent = "🔤 生成画面描述";
    };
    const d = $("#festCgDraw");
    if (d) d.onclick = async () => {
      const brief = String((ta && ta.value) || "").trim();
      if (!brief) { toast("先写一段描述，或者点「🔤 生成画面描述」"); return; }
      d.disabled = true; d.textContent = "正在画…（约 15-20 秒）";
      try {
        const s0 = Spirits.load(); const rb = Spirits.ensureIn(s0, id);
        rb.fests = rb.fests || {}; if (rb.fests[dk]) rb.fests[dk].brief = brief;   // ① 存确认后的描述
        Spirits.save(s0);
        const r1 = Spirits.load()[id] || {};
        const out = await drawCgFromBrief(brief, {                                  // ② 手动出图
          kind: "fest", item: item, stage: Number(r1.stage) || 1,
          appearance: Spirits.appearanceOf(item, r1.appearanceSeed || 0, r1.gender || ""),
          look: Spirits.lookOf(item, r1), fest: (r1.fests && r1.fests[dk]) || null,
          seedKey: "festcg|" + id + "|" + dk, variant: 0, ref: "",
        });
        const s2 = Spirits.load(); const r2 = Spirits.ensureIn(s2, id);
        r2.fests = r2.fests || {};
        if (r2.fests[dk]) { r2.fests[dk].cgUrl = out.url || ""; r2.fests[dk].cgAt = Date.now(); }
        r2.genCount = (Number(r2.genCount) || 0) + 1;
        Spirits.save(s2);
        try { localStorage.setItem("ww_gen_total", String(Number(localStorage.getItem("ww_gen_total") || "0") + 1)); } catch (e2) { /* 忽略 */ }
        close();
        toast("🎋「" + fx0.name + "」限定插画画好了");
        renderSpiritDetailPage(id);
      } catch (e) {
        d.disabled = false; d.textContent = "🎬 重试（消耗 1 次出图额度）";
        toast("出图失败：" + ((e && e.message) || "请稍后再试"));
      }
    };
  }

  /* ---------- 沁灵形象 / 进阶动作（v111：详情页直接调，不再依赖弹层） ----------
     host = { refresh(), refreshTop(), busy(on, text) } —— 由页面提供，用于原地刷新与按钮状态 */
  async function spiritReRoll(item, host) {
    const h = host || {};
    if (!(await gateLookConfirm(item))) return;     // v163b：出图前先确认设定
    if (_imgBusy || _genInFlight[item.id]) { toast("正在出图，稍等一下～"); return; }
    _imgBusy = true; _genInFlight[item.id] = true;
    try {
      const s = Spirits.load();
      const r = Spirits.ensureIn(s, item.id);
      r.appearanceSeed = (r.appearanceSeed || 0) + 1;
      r.imgUrl = "";
      r.imgAt = 0;
      r.face = null;
      r._imgErr = ""; r._imgErrAt = 0;
      Spirits.save(s);
      const nap = Spirits.appearanceOf(item, r.appearanceSeed, r.gender || "");
      toast("新样子定了，这就为它重画…");
      if (h.busy) h.busy(true, "正在重画…");
      if (h.refresh) h.refresh();
      const res = await Spirits.generateImage(item, r.variant || 0, null, r.stage || 1, { appearanceSeed: r.appearanceSeed, gender: r.gender || "" });
      const s2 = Spirits.load();
      const r2 = Spirits.ensureIn(s2, item.id);
      await saveSpiritImage(item, r2, res, r2.stage || 1);
      Spirits.save(s2);
      if (res.autoFixed) toast("已自动修正：" + res.autoFixed);
      toast("人设换好了 🎲");
    } catch (e) {
      toast("重画出错：" + ((e && e.message) || ""));
    } finally {
      if (h.busy) h.busy(false);
      if (h.refreshTop) h.refreshTop(); else if (h.refresh) h.refresh();
      refreshCgAfter(item);      // v125：换了人设 → 蜕形/化形的 CG 也跟着换
      _imgBusy = false; delete _genInFlight[item.id];
    }
  }

  async function spiritNewLook(item, host) {
    const h = host || {};
    if (!(await gateLookConfirm(item))) return;     // v163b：出图前先确认设定
    if (_imgBusy || _genInFlight[item.id]) { toast("正在出图，稍等一下～"); return; }
    _imgBusy = true; _genInFlight[item.id] = true;
    try {
      const cfg2 = Spirits.getImageCfg();
      const s = Spirits.load();
      const r = Spirits.ensureIn(s, item.id);
      const prevImg = r.imgUrl || "";
      r.variant = (r.variant || 0) + 1;
      r._imgErr = ""; r._imgErrAt = 0;
      Spirits.save(s);
      if (cfg2.provider === "pollinations") {
        // 免密钥通道：换 seed 重出（URL 直接交给 <img>，不占用 POST 通道）
        if (h.busy) h.busy(true, "换个形象中…");
        const s2 = Spirits.load();
        const r2 = Spirits.ensureIn(s2, item.id);
        await saveSpiritImage(item, r2, { url: Spirits.pollinationsUrl(item, r.variant, null, r.stage || 1, Spirits.appearanceOf(item, r.appearanceSeed || 0, r.gender || "")) }, r2.stage || 1);
        Spirits.save(s2);
        toast("换个形象中…（几秒钟出图）");
        if (h.busy) h.busy(false);
        if (h.refreshTop) h.refreshTop(); else if (h.refresh) h.refresh();
        refreshCgAfter(item);      // v125：立绘换了 → CG 也跟着换
        return;
      }
      toast("正在重画同一个角色…（消耗 1 次出图）");
      if (h.busy) h.busy(true, "正在重画…");
      const res = await Spirits.generateImage(item, r.variant, null, r.stage || 1, { appearanceSeed: r.appearanceSeed || 0, gender: r.gender || "", ref: prevImg });
      const s2 = Spirits.load();
      const r2 = Spirits.ensureIn(s2, item.id);
      await saveSpiritImage(item, r2, res, r2.stage || 1);
      Spirits.save(s2);
      if (res.autoFixed) toast("已自动修正：" + res.autoFixed);
      toast("形象换好了 🍡");
    } catch (e) {
      toast("出图失败：" + ((e && e.message) || "未知错误"));
    } finally {
      if (h.busy) h.busy(false);
      if (h.refreshTop) h.refreshTop(); else if (h.refresh) h.refresh();
      refreshCgAfter(item);      // v125：立绘换了 → CG 也跟着换
      _imgBusy = false; delete _genInFlight[item.id];
    }
  }

  async function spiritBreak(item, host) {
    // v163b：阶段已改为「挂瓷后天数 ∧ 盘玩次数」双条件派生，不再手动突破
    //   → 本动作只做"重画立绘"（绝不写 rec.stage），保留用户随时换一张的权利
    const h = host || {};
    if (!(await gateLookConfirm(item))) return;
    const s0 = Spirits.load();
    const r0 = Spirits.ensureIn(s0, item.id);
    // v165-M：按**已确认阶**画（用户没点「进阶」之前，本阶 = 已确认阶；⛔ 不再用可达阶）
    const st = Math.min(4, Math.max(1, Number(r0.stage) || 1));
    if (_imgBusy || _genInFlight[item.id]) { toast("正在出图，稍等一下～"); return; }
    _imgBusy = true; _genInFlight[item.id] = true;
    if (h.busy) h.busy(true, "重画中…");
    try {
      // 重画：把旧图当参考图传过去 → 保证是同一个人，不会变性/换人
      const res = await Spirits.generateImage(item, r0.variant || 0, null, st, { appearanceSeed: r0.appearanceSeed || 0, gender: r0.gender || "", ref: r0.imgUrl || "" });
      const s1 = Spirits.load();
      const r1 = Spirits.ensureIn(s1, item.id);
      const url = await saveSpiritImage(item, r1, res, st);
      Spirits.save(s1);
      if (res.autoFixed) toast("已自动修正：" + res.autoFixed);
      if (h.busy) h.busy(false);
      if (h.refresh) h.refresh();
      refreshCgAfter(item);      // v125：立绘换了 → CG 也跟着换
      _imgBusy = false; delete _genInFlight[item.id];
      toast("立绘重画好了 🍡");
    } catch (e) {
      if (h.busy) h.busy(false);
      toast("重画失败：" + ((e && e.message) || "出图失败"));
      _imgBusy = false; delete _genInFlight[item.id];
    }
  }

  /* ---------- v126：日记打字机（只对最新一篇、每只沁灵每次开会话只打一次） ---------- */
  const _typedDiary = {};
  function typewriteSpiritDiary(id) {
    try {
      const el = document.getElementById("sdDiaryNew");
      if (!el) return;
      const full = el.dataset.full || el.textContent || "";
      if (!full) return;
      const key = String(id) + "|" + (el.dataset.at || "");
      if (_typedDiary[key]) return;                 // 同一篇只打一次（重渲染不再重打）
      _typedDiary[key] = 1;
      // 尊重"减少动态效果"偏好：直接显示全文
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      let i = 0, timer = null, guard = null, stopped = false;
      const finish = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer); clearTimeout(guard);
        el.textContent = full;
        el.classList.remove("typing");
      };
      const tick = () => {
        if (stopped) return;
        i += 1;
        el.textContent = full.slice(0, i);
        if (i >= full.length) { finish(); return; }
        // 标点处稍作停顿，读起来更像"在写"
        timer = setTimeout(tick, /[。！？，、；：,.!?]/.test(full.charAt(i - 1)) ? 120 : 26);
      };
      el.classList.add("typing");
      el.textContent = "";
      timer = setTimeout(tick, 160);
      // ★ 兜底：不管动画时钟有没有推进（省电模式/无头浏览器），2.6 秒后一定显示全文
      guard = setTimeout(finish, Math.max(2600, full.length * 26 + 500));
      el.onclick = finish;
    } catch (e) { /* 静默：任何异常都不该让日记消失 */ }
  }

  /* ---------- 详情页上/下一只导航（v164g） ---------- */
  function spiritNavHtml(idx, prevIt, nextIt, total, store) {
  const prevLabel = prevIt ? esc(spiritName(prevIt, store)) : "到头了";
  const nextLabel = nextIt ? esc(spiritName(nextIt, store)) : "到头了";
  return '<div class="sd-nav" style="display:flex;align-items:center;gap:8px;margin:10px 0 14px">' +
    '<button type="button" class="sd-nav-btn" id="sdPrev" style="flex:1;min-width:0;padding:8px 10px;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;font-size:13px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"' + (prevIt ? "" : " disabled") + ">← " + prevLabel + "</button>" +
    '<span style="font-size:12px;color:var(--text-2);white-space:nowrap;padding:0 4px">第 ' + (idx + 1) + ' / ' + total + ' 只</span>' +
    '<button type="button" class="sd-nav-btn" id="sdNext" style="flex:1;min-width:0;padding:8px 10px;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;font-size:13px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"' + (nextIt ? "" : " disabled") + ">" + nextLabel + " →</button>" +
    "</div>";
}

  /* ---------- 沁灵独立详情页 ---------- */
  /* =========================================================
   * v165 · 心迹区（详情页）：心迹条 + 羁绊条 + 照料三式 + 「递一件给它」
   *   口径：⛔ 面向玩家的正文不出现数值/字段名/「好感度」；数值只作辅助小字。
   *   送礼与照料提升的是「羁绊」(rec.bond)；心迹条展示「心意轨」(rec.heart，恋爱向，本批只读展示)。
   *   ⛔ 防物化红线（设计 §3.5）：按钮「递一件给它」；⛔ 不写占有/控制/物件化动作。
   * ========================================================= */
  function fillTa(tpl, name) { return String(tpl == null ? "" : tpl).replace(/\{ta\}/g, name || "它"); }
  // 心迹条在「当前档 → 下一档」区间内的百分比（末档 100%）
  const XT_HEART_MARKS = [0, 40, 100, 190, 300];
  function xtHeartPct(v) {
    const val = Math.max(0, Math.min(300, Math.floor(Number(v) || 0)));
    let lo = XT_HEART_MARKS[0], hi = XT_HEART_MARKS[XT_HEART_MARKS.length - 1];
    for (let i = 0; i < XT_HEART_MARKS.length; i++) { if (val >= XT_HEART_MARKS[i]) { lo = XT_HEART_MARKS[i]; hi = XT_HEART_MARKS[i + 1] != null ? XT_HEART_MARKS[i + 1] : XT_HEART_MARKS[i]; } }
    if (hi <= lo) return 100;
    return Math.max(4, Math.min(100, Math.round(((val - lo) / (hi - lo)) * 100)));
  }
  const XT_CLS_ZH = { cloth: "织物", sound: "声响", ware: "器物", odd: "奇异", tough: "坚韧", human: "人情" };
  // 心迹区整块 HTML（纯拼接，供 renderSpiritDetailPage 调用；亦便于布局自测）
  function heartCardHtml(it, rec, store) {
    const name = spiritName(it, store);
    const hlv = Spirits.heartLevel(Number(rec.heart) || 0);
    const bl = Spirits.bondLevel(Number(rec.bond) || 0);
    const today = Spirits.todayKey();
    const cfg = Spirits.GIFT_CFG || {};
    const acts = Spirits.CARE_ACTS || [];
    const careDone = Spirits.careDoneOf(rec, today);
    const givenN = (String(rec.giftDay || "") === today) ? Math.max(1, Math.floor(Number(rec.giftDayN) || 1)) : 0;
    const globalGiven = Spirits.giftGivenToday(today);
    const globalMax = cfg.DAILY_GLOBAL || 2;
    const qualify = bl.lv1 >= (cfg.QUALIFY_LV || 3);

    let h = '<div class="sd-card xt-card" id="sdHeart">';
    h += '<div class="sd-card-title">🌸 心迹</div>';
    // 心迹条（恋爱向；⛔ 不出现数值）
    h += '<div class="xt-row"><span class="xt-label">心迹</span>' +
      '<span class="xt-track"><i style="width:' + (hlv.atMax ? 100 : xtHeartPct(hlv.value)) + '%"></i></span>' +
      '<span class="xt-lv">' + esc(hlv.name || "") + '</span></div>';
    // 羁绊条（照料 / 递一件 提升的是它；⛔ 不出现数值）
    h += '<div class="xt-row"><span class="xt-label">羁绊</span>' +
      '<span class="xt-track bond"><i id="xtBondFill" style="width:' + bl.pct + '%"></i></span>' +
      '<span class="xt-lv">' + esc(bl.name) + '</span></div>';
    h += '<div class="xt-hint">心迹慢，看的是它对你那点另外的意思；羁绊靠日子，是你们处出来的熟。两条各走各的。</div>';
    // 照料三式
    h += '<div class="xt-sec">照料三式<span class="xt-sec-sub">今日 ' + careDone + '/' + acts.length + '</span></div>';
    h += '<div class="xt-care">' + acts.map((a) => {
      const done = String(((rec.careKinds || {})[a.id]) || "") === today;
      return '<button type="button" class="xt-care-btn' + (done ? " done" : "") + '" data-care="' + esc(a.id) + '"' + (done ? " disabled" : "") + '>' +
        '<span class="xt-care-name">' + esc(a.name) + '</span>' +
        '<span class="xt-care-tag">' + (done ? "今天做过了" : "＋2") + '</span></button>';
    }).join("") + '</div>';
    if (careDone >= acts.length) h += '<div class="xt-sub">今天照料得够了，明天再来。</div>';
    // 递一件给它
    h += '<button type="button" class="btn primary xt-gift-btn" id="xtGiftOpen"' + (qualify ? "" : " disabled") + '>' +
      '<span class="xt-gift-ico">🎁</span>' + esc(Spirits.GIFT_COPY.open) + '</button>';
    h += '<div class="xt-sub">今日已递 ' + globalGiven + '/' + globalMax +
      (givenN >= 1 ? '（今天已经给过它 ' + givenN + ' 件）' : "") + '</div>';
    if (!qualify) h += '<div class="xt-hint">' + esc(fillTa(Spirits.GIFT_COPY.qualifying, name)) + '</div>';
    h += '</div>';
    return h;
  }
  // 一个只读的反馈弹层（送出 / 照料）：反应句 + 辅助小字，单按钮关闭
  function showActModal(title, quote, subHtml) {
    const mask = $("#modalMask"), modal = $("#modal");
    modal.innerHTML = "<h3>" + esc(title) + "</h3>" +
      (quote ? '<div class="xt-quote">「' + esc(quote) + '」</div>' : "") +
      (subHtml ? '<div class="xt-quote-sub">' + subHtml + "</div>" : "") +
      "<div style='display:flex;margin-top:14px'><button class='btn primary' id='mOk' style='flex:1'>搁下了</button></div>";
    mask.hidden = false; modal.hidden = false; modal.style.display = "";
    return new Promise((resolve) => {
      const done = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; resolve(true); };
      $("#mOk").onclick = done; mask.onclick = done;
    });
  }
  // 照料一次
  async function spiritCareDo(it, kind, host) {
    const store = Spirits.load();
    const rec = Spirits.ensureIn(store, it.id);
    const r = Spirits.careAct(rec, kind);
    if (!r.ok) {
      if (r.reason === "day_per") toast("这一式今天已经做过了。");
      else if (r.reason === "day_max") toast("今天照料得够了，明天再来。");
      else toast("这个先做不了。");
      return;
    }
    Spirits.save(store);
    const def = Spirits.careActOf(kind) || {};
    const acts = Spirits.CARE_ACTS || [];
    await showActModal("照料", def.line || "", "羁绊 <b>+" + r.delta + "</b> · 今天照料了 " + Spirits.careDoneOf(rec) + "/" + acts.length);
    host.refresh();
  }
  // 选礼抽屉 → 二次确认 → 送出 → 反应台词
  function openGiftDrawer(it, host) {
    const store = Spirits.load();
    const rec = Spirits.ensureIn(store, it.id);
    const name = spiritName(it, store);
    const today = Spirits.todayKey();
    const cfg = Spirits.GIFT_CFG || {};
    const globalMax = cfg.DAILY_GLOBAL || 2;
    const mask = $("#modalMask"), modal = $("#modal");
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    const paint = () => {
      const list = Spirits.giftListOf(Spirits.loadGifts());
      const globalGiven = Spirits.giftGivenToday(today);
      const prefCls = Spirits.giftPrefOf(rec);
      let body;
      if (!list.length) {
        body = '<div class="room-none">' + esc(Spirits.GIFT_COPY.emptyStock) + "</div>";
      } else {
        body = '<div class="gd-grid">' + list.map((g) => {
          const held = !!(rec.giftLog && rec.giftLog[g.key] != null);
          const hit = !!(prefCls && g.cls === prefCls);
          const disabled = held || globalGiven >= globalMax;
          const cls = esc(XT_CLS_ZH[g.cls] || "") + (hit ? " · 偏好" : "");
          const note = held ? esc(fillTa(Spirits.GIFT_COPY.alreadyHeld, name)) : (hit ? esc(fillTa(Spirits.GIFT_COPY.hitNote, name)) : "");
          return '<button type="button" class="gd-item' + (held ? " held" : "") + (hit ? " hit" : "") + '" data-gift="' + esc(g.key) + '"' + (disabled ? " disabled" : "") + '>' +
            '<span class="gd-name">' + esc(g.name) + '</span>' +
            '<span class="gd-cls">' + cls + "</span>" +
            (note ? '<span class="gd-note">' + note + "</span>" : "") +
            '<span class="gd-cnt">×' + g.count + "</span></button>";
        }).join("") + "</div>";
      }
      const foot = '<div class="gd-foot">今日已递 ' + globalGiven + "/" + globalMax +
        (globalGiven >= globalMax ? " · " + esc(Spirits.GIFT_COPY.dayFull) : "") + "</div>";
      modal.innerHTML = "<h3>" + esc(name) + " · 手边的东西</h3>" + body + foot +
        "<div style='display:flex;margin-top:12px'><button class='btn ghost' id='mCancel' style='flex:1'>先不递</button></div>";
      mask.hidden = false; modal.hidden = false; modal.style.display = "";
      $("#mCancel").onclick = close;
      mask.onclick = close;
      modal.querySelectorAll(".gd-item").forEach((b) => {
        if (b.disabled) return;
        b.onclick = () => { const k = b.dataset.gift; close(); doGive(k); };
      });
    };
    const doGive = async (giftKey) => {
      const hstore = Spirits.load();
      const hrec = Spirits.ensureIn(hstore, it.id);
      const g = Spirits.GIFT_CATALOG[giftKey] || {};
      const ok = await confirmModal("递一件给它？", "把「" + (g.name || "这件东西") + "」递过去。递出去就收不回来了。", "递过去");
      if (!ok) { paint(); return; }
      const globalGiven = Spirits.giftGivenToday(today);
      const gifts = Spirits.loadGifts();
      const res = Spirits.giveGift(gifts, hrec, giftKey, { dayKey: today, globalGiven: globalGiven });
      if (!res.ok) {
        if (res.reason === "day_global") toast(Spirits.GIFT_COPY.dayFull);
        else if (res.reason === "day_per") toast("今天给它的够多了。");
        else if (res.reason === "dup") toast(fillTa(Spirits.GIFT_COPY.alreadyHeld, name));
        else if (res.reason === "locked") toast(fillTa(Spirits.GIFT_COPY.qualifying, name));
        else if (res.reason === "no_stock") toast(Spirits.GIFT_COPY.emptyStock);
        else toast("这件事没成。");
        return;
      }
      Spirits.saveGifts(gifts);
      Spirits.noteGiftGiven(it.id, giftKey, today);
      Spirits.save(hstore);
      const react = Spirits.giftReactionOf(hrec, res.hit);
      const sub = "羁绊 <b>+" + res.delta + "</b>" + (res.second ? "（同一只第二件，折半了）" : "") +
        " · 今日已递 " + Spirits.giftGivenToday(today) + "/" + globalMax;
      await showActModal("递过去了", react, sub);
      host.refresh();
    };
    paint();
  }

  // v166：轻量删除管理（立绘 / CG）—— 用户可手动删掉生成错的图。就地弹层，删除不可恢复但可重新生成。
  function openDelManager(title, items, onDelete, onDone) {
    const old = document.getElementById("wwDelMgr"); if (old) old.remove();
    const mask = document.createElement("div");
    mask.id = "wwDelMgr";
    mask.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--card,#fff);max-width:520px;width:100%;max-height:84vh;overflow:auto;border-radius:14px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.3)";
    let cur = items.slice();
    const paint = () => {
      if (!cur.length) { box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-2)">没有可删除的图片了</div>'; return; }
      box.innerHTML = '<div style="font-weight:700;font-size:16px;margin-bottom:4px">' + title + "</div>" +
        '<div style="color:var(--text-2);font-size:12px;margin-bottom:10px">点 🗑 删除这张（删除不可恢复，但可重新生成）</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        cur.map((it, i) => '<div style="border:1px solid var(--line,#eee);border-radius:10px;overflow:hidden">' +
          '<img src="' + it.url + '" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block" onerror="this.style.opacity=.2">' +
          '<div style="padding:6px 8px;font-size:12px;color:var(--text-2)">' + esc(it.label) + "</div>" +
          '<button data-i="' + i + '" style="width:100%;border:0;background:#e5484d;color:#fff;padding:7px;font-size:13px;cursor:pointer">🗑 删除</button>' +
          "</div>").join("") + "</div>";
      box.querySelectorAll("button[data-i]").forEach((b) => b.onclick = () => {
        const idx = +b.dataset.i; const it = cur[idx];
        onDelete(it); cur = cur.filter((_, k) => k !== idx);
        if (onDone) onDone();   // 背后详情页即时刷新（缩略图消失）
        paint();                // 弹层内的列表也即时刷新
      });
    };
    paint();
    const bar = document.createElement("div");
    bar.style.cssText = "margin-top:14px;display:flex;gap:10px";
    const done = document.createElement("button");
    done.textContent = "完成";
    done.style.cssText = "flex:1;padding:10px;border:0;border-radius:10px;background:var(--gold,#caa06a);color:#fff;font-size:14px;cursor:pointer";
    done.onclick = () => { mask.remove(); };
    bar.appendChild(done);
    box.appendChild(bar);
    mask.appendChild(box);
    mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
    document.body.appendChild(mask);
  }
  // v166：管理「立绘」—— 当前立绘 + 进化史旧图，逐个删
  function openSpiritImgManager(id) {
    const store = Spirits.load();
    const rec = Spirits.ensureIn(store, id);
    const items = [];
    if (rec.exprs && rec.exprs.base && rec.exprs.base.url) items.push({ kind: "base", url: rec.exprs.base.url, label: "当前立绘" });
    (rec.imgHistory || []).forEach((h, i) => { if (h && h.url) items.push({ kind: "hist", url: h.url, label: "进化史 #" + (i + 1) }); });
    if (!items.length) { toast("还没有可管理的立绘"); return; }
    openDelManager("🗑 管理立绘", items, (it2) => {
      if (it2.kind === "base") { rec.exprs.base = { url: "", face: null, at: 0, frozen: false, stage: rec.stage || 1 }; }
      else { rec.imgHistory = (rec.imgHistory || []).filter((h) => !(h && h.url === it2.url)); }
      Spirits.save(store);
    }, () => renderSpiritDetailPage(id));
  }
  // v166：管理「CG」—— 进阶专属 CG + 主线 / 进阶相册里的全部 CG，逐个删
  // v165-C：再补两类漏网的 —— 节令限定插画（rec.fests[date].cgUrl）。
  //   （双人事件 CG 在房间页，见 openRoomCgManager。）
  function openSpiritCgManager(id) {
    const store = Spirits.load();
    const rec = Spirits.ensureIn(store, id);
    const items = [];
    if (rec.cgUrl) items.push({ kind: "adv", url: rec.cgUrl, label: "进阶专属 CG" });
    const cgs = rec.cgs || {};
    Object.keys(cgs).forEach((k) => {
      const m = cgs[k];
      if (m && m.hasImg && (m.thumb || m.imgUrl)) {
        // v166：回填后 adv# 条目与 rec.cgUrl 是同一张图 → 去重，避免列两遍
        if (String(k).startsWith("adv#") && rec.cgUrl && (m.thumb === rec.cgUrl || m.imgUrl === rec.cgUrl)) return;
        items.push({ kind: "cg", key: k, url: m.thumb || m.imgUrl, label: (k.indexOf("adv#") === 0 ? "进阶 CG" : "主线 CG") + " " + (m.title || k) });
      }
    });
    // v165-C：节令限定插画
    const fests = rec.fests || {};
    Object.keys(fests).forEach((dk) => {
      const fx = fests[dk];
      if (fx && fx.cgUrl) items.push({ kind: "fest", key: dk, url: fx.cgUrl,
        label: "节令 CG · " + (fx.emoji || "") + (fx.name || dk) + " " + (fx.date || "") });
    });
    if (!items.length) { toast("还没有可管理的 CG"); return; }
    openDelManager("🗑 管理 CG", items, (it2) => {
      if (it2.kind === "adv") { rec.cgUrl = ""; rec.cgKey = ""; rec.cgStage = 0; }
      else if (it2.kind === "fest") { if (rec.fests && rec.fests[it2.key]) { rec.fests[it2.key].cgUrl = ""; rec.fests[it2.key].cgAt = 0; } }
      else { delete rec.cgs[it2.key]; }
      Spirits.save(store);
    }, () => renderSpiritDetailPage(id));
  }
  // v165-C：管理「双人事件 CG」—— 房间内每段剧情的插画逐个删（同款删除弹层）
  function openRoomCgManager(roomId) {
    const store = Spirits.load();
    const items = [];
    Rooms.storiesOfRoom(roomId).forEach((s) => {
      if (!(s.story && s.story.img)) return;
      const nm = (s.pair || []).map((pid2) => { const it = spiritItemById(pid2); return it ? nameOf(it, store) : pid2; }).join(" × ");
      items.push({ kind: "story", key: s.key, level: s.story.level, url: s.story.img,
        label: "双人 CG · 第 " + ((s.story.level || 0) + 1) + " 段" + (nm ? " · " + nm : "") });
    });
    if (!items.length) { toast("这个房间还没有可管理的双人 CG"); return; }
    openDelManager("🗑 管理双人 CG", items, (it2) => {
      const p = String(it2.key).split("|");
      Rooms.setStoryImage(p[0], p[1], it2.level, "");
    }, () => renderRoomPage(roomId));
  }
  // v166：被设为「只当手串」的沁灵，详情页显示安全页（可重新开沁）
  function renderSpiritOffPage(id) {
    const it = spiritItemById(id);
    if (!it) { location.hash = "#/"; return; }
    if (_sdKeyHandler) { document.removeEventListener("keydown", _sdKeyHandler); _sdKeyHandler = null; }
    topbarTitle.textContent = "沁灵详情";
    btnBack.style.visibility = "visible"; btnSettings.style.visibility = "hidden";
    const store = Spirits.load();
    const rec = Spirits.ensureIn(store, id);
    let h = '<div class="sd-top" style="text-align:center;padding:24px">' +
      '<div class="sd-name">' + esc(spiritName(it, store)) + '<span class="spirit-stage big">📿 手串</span></div>' +
      '<div class="sd-card" style="margin-top:16px;text-align:left"><div class="sd-line">这只串已设为「只当手串」——不会生成立绘和 CG，也不进沁灵巷 / 沁灵列表。</div>' +
      '<button class="btn primary" id="sdEnableSpirit" style="width:100%;margin-top:10px">✨ 让它进化成沁灵</button></div></div>';
    view.innerHTML = h;
    const en = $("#sdEnableSpirit");
    if (en) en.onclick = () => { rec.spirit = true; Spirits.save(store); renderSpiritDetailPage(id); };
  }

  function renderSpiritDetailPage(id) {
    const it = spiritItemById(id);
    if (!it) { location.hash = "#/spirit"; return; }
    topbarTitle.textContent = "沁灵详情";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const store = Spirits.load();
    const rec = Spirits.ensureIn(store, id);
    if (rec.spirit === false) { renderSpiritOffPage(id); return; }   // v166：只当手串 → 安全页
    _brokenSrcs = new Set();   // v164f：每次进详情页重置「失效图」收集（供🧹清理）
    // v165-M：⛔ 进详情页也不再自动抬 rec.stage（可进阶只展示按钮，等用户点）
    // v155：进详情页先本地结算陪伴数据（今日问候 / 亲密度 / 今日一签 / 回响信），一次 save
    //   —— 全本地，0 出图、0 模型调用
    const cpCtx = diaryCtx(it, rec);
    let cpDirty = false;
    if (Spirits.settleBond(it, rec, cpCtx)) cpDirty = true;
    if (Spirits.ensureGreet(it, rec, cpCtx)) cpDirty = true;
    if (Spirits.ensureSign(it, rec)) cpDirty = true;
    if (Spirits.ensureEcho(it, rec, cpCtx)) cpDirty = true;
    if (Spirits.ensureFest(it, rec, cpCtx)) cpDirty = true;      // v158：节令（只有当天过节才写）
    if (cpDirty) Spirits.save(store);
    const p = rec.persona || Spirits.localPersona(it);
    const lkNow = Spirits.lookOf(it, rec);   // v140：提前取到，合并到「人物设定」单卡
    const si = Spirits.stageInfo(it, rec.stage, DB.daysWith(it));
    const idle = it.lastPlayedAt ? Math.floor((Date.now() - it.lastPlayedAt) / 86400000) : null;
    const colorName = Spirits.COLOR_ZH[it.color] || "素色";
    const softName = it.softness === "soft" ? "软糯" : (it.softness === "slight" ? "微糯" : "未标注");
    const photo = it.photos && it.photos[0];
    const room = rec.roomId ? Rooms.getRoom(rec.roomId) : null;
    const items = roomItems();
    const mates = room ? Rooms.membersOf(room.id, items).filter((x) => x.id !== id) : [];
    const diary = (rec.diary || []).slice().reverse();
    const hist = (rec.imgHistory || []).filter((x) => x && x.url);
    // v166：立绘 / CG 是否「有可管理的图」（供「🗑 管理」按钮显隐）
    const _hasImg = !!rec.imgUrl || hist.length > 0;
    const _hasCg = !!rec.cgUrl || !!(rec.cgs && Object.keys(rec.cgs).some((k) => rec.cgs[k] && rec.cgs[k].hasImg));

    // v126：还没出图时给一个立绘骨架屏（比空白/兜底小沁灵更像"正在画"）
    // v166：生成了进阶 CG 的沁灵，**优先在详情页展示 CG**（而不是立绘）；点图看大图。没有 CG 才回落立绘。
    const _cgShown = rec.cgUrl || "";
    const artInner = _cgShown
      ? '<img class="spirit-img big cg-as-art" id="sdArtCg" src="' + esc(_cgShown) + '" alt="CG">'
      : (rec.imgUrl
        ? spiritImgHtml(it, rec, 240, "spirit-img big")
        : '<div class="sk sk-art"></div><div class="sd-gen-hint" style="margin-top:8px">正在画它的立绘…（约 15-20 秒）</div>');
    // v164g：详情页上下切换（不用返回列表就能挨着看沁灵）
    const _allItems = spiritItems();
    const _curIdx = _allItems.findIndex((x) => String(x.id) === String(id));
    const _prevIt = _curIdx > 0 ? _allItems[_curIdx - 1] : null;
    const _nextIt = (_curIdx >= 0 && _curIdx < _allItems.length - 1) ? _allItems[_curIdx + 1] : null;
    // 键盘左右键切换；在输入框里不触发；离开详情页（hash 不以 #/spirit/ 开头）则该监听不生效
    if (_sdKeyHandler) { document.removeEventListener("keydown", _sdKeyHandler); _sdKeyHandler = null; }
    _sdKeyHandler = (e) => {
      if (!location.hash || location.hash.indexOf("#/spirit/") !== 0) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft" && _prevIt) location.hash = "#/spirit/" + encodeURIComponent(_prevIt.id);
      else if (e.key === "ArrowRight" && _nextIt) location.hash = "#/spirit/" + encodeURIComponent(_nextIt.id);
    };
    document.addEventListener("keydown", _sdKeyHandler);
    let h = spiritNavHtml(_curIdx, _prevIt, _nextIt, _allItems.length, store) + '<div class="sd-top"><div class="sd-art" id="sdArt">' + artInner + "</div>" +
      (_hasImg ? '<button type="button" class="link-btn" id="sdManageImg" style="margin-top:6px">🗑 管理立绘</button>' : "") +
      '<div class="sd-name">' + esc(spiritName(it, store)) + '<span class="spirit-stage big">' + si.icon + " " + esc(si.name) + "</span></div>" +
      '<div class="sd-title">' + esc(p.title || "") + "</div>" +
      '<div class="sd-title" style="margin-top:4px">' +
      (rec.nameEdited
        ? '<span style="color:var(--text-2)">✏️ 名字改过了</span>'
        : '<button type="button" class="link-btn" id="sdRename">✏️ 给它改个名字（只能改一次）</button>') +
      "</div>" +
      '<div class="sd-line">“' + esc(p.line || "") + '”</div>' +
      '<div class="spirit-tags" style="justify-content:center">' + ((p.traits) || []).map((t) => '<span class="spirit-trait">' + esc(t) + "</span>").join("") +
      '<span class="spirit-trait idle">' + esc(colorName) + " · " + esc(softName) + (idle != null ? " · " + idle + " 天没盘" : "") + "</span></div></div>";

    // v155：今天 · 陪伴卡（今日问候 + 羁绊 + 今日一签 + 下一封回响倒计时）
    const bond = Spirits.bondLevel(rec.bond);
    const nxEcho = Spirits.nextEcho(it, rec, Math.max(1, DB.daysWith(it)));
    h += '<div class="sd-card cp-card">' +
      '<div class="sd-card-title">🎐 今天<span class="cp-date">' + esc((rec.greet && rec.greet.date) || Spirits.todayKey()) + "</span></div>" +
      (rec.greet
        ? '<div class="cp-greet"><span class="cp-mood">' + esc(rec.greet.mood) + "</span>" +
          '<div class="cp-bubble">' + esc(rec.greet.text) + "</div></div>"
        : "") +
      '<div class="cp-bond">' +
        '<div class="cp-bond-head"><span>羁绊</span><b>' + bond.value + "</b><i>" + bond.icon + " " + esc(bond.name) + "</i></div>" +
        '<div class="cp-track"><i style="width:' + bond.pct + '%"></i></div>' +
        '<div class="cp-sub">' + (bond.isMax ? "已经是最熟的那一档了" : "再攒 " + bond.toNext + " 点到「" + esc(bond.next) + "」") +
          " · 它陪了你 " + DB.daysWith(it) + " 天</div>" +
        (rec.nickCall
          ? '<div class="cp-sub">💛 它现在叫你「' + esc(rec.nickCall) + '」<button type="button" class="link-btn" id="sdCallReset" style="font-size:11px">改回叫「主人」</button></div>'
          : (bond.canCall && !rec.nickCallAsked
            ? '<div class="cp-call">💛 你们已经熟了 —— 它想改口，不再喊「主人」了' +
              '<button type="button" class="btn primary cp-call-btn" id="sdCallYes">好，叫我名字</button>' +
              '<button type="button" class="btn ghost cp-call-btn" id="sdCallNo">还是叫主人</button></div>'
            : "")) +
      "</div>" +
      (rec.sign
        ? '<div class="cp-sign"><div class="cp-sign-head"><span class="cp-sign-lv">' + esc(rec.sign.lv) + "</span><span>" + esc(rec.sign.date) + " · 今日一签</span></div>" +
          '<div class="cp-sign-line"><b class="yi">宜</b>' + esc(rec.sign.yi) + '<b class="ji">忌</b>' + esc(rec.sign.ji) + "</div>" +
          '<div class="cp-sign-s">' + esc(rec.sign.text) + "</div></div>"
        : "") +
      (nxEcho
        ? '<div class="cp-echo">✦ 下一封回响：' + esc(nxEcho.label) + "（还有 " + nxEcho.days + " 天）</div>"
        : '<div class="cp-echo">✦ 回响都写完了 —— 每一枚纪念日它都留了信给你</div>') +
      "</div>";

    // v165：🌸 心迹区（心迹条 + 羁绊条 + 照料三式 + 「递一件给它」）
    h += heartCardHtml(it, rec, store);

    // v158：🎋 节令 —— 传统节日当天它有一句专属的话；限定插画手动确认才画（点了才花额度）
    const fests = Spirits.festList(rec);
    const todayFest = Spirits.festOf(Spirits.todayKey());
    const nxFest = Spirits.nextFest();
    const festToday = (rec && rec.fests && rec.fests[Spirits.todayKey()]) || null;
    h += '<div class="sd-card"><div class="sd-card-title">🎋 节令' +
      (todayFest ? '<span class="cp-date">今天 · ' + esc(todayFest.name) + "</span>" : "") + "</div>";
    if (festToday) {
      h += '<div class="ft-item now">' +
        '<div class="ft-head"><span>' + esc(festToday.emoji + " " + festToday.name) + "</span><span>" + esc(festToday.date) + "</span></div>" +
        '<div class="ft-text">' + esc(festToday.text) + "</div>" +
        (festToday.cgUrl
          ? '<img class="cg-thumb ft-cgimg" data-cg="' + esc(festToday.cgUrl) + '" src="' + esc(festToday.cgUrl) + '" alt="节令插画">'
          : '<button class="btn ghost" id="sdFestCg" data-date="' + esc(festToday.date) + '" style="width:100%;margin-top:8px;font-size:12px">🎬 画一张「' + esc(festToday.name) + '」限定插画（消耗 1 次出图额度）</button>') +
        "</div>";
    } else {
      h += '<div class="room-none">今天不过节。' +
        (nxFest ? "下一个是 " + esc(nxFest.emoji + " " + nxFest.name) + "（还有 " + nxFest.days + " 天）—— 到那天，它会说一句只属于这天的话。" : "") +
        "</div>";
    }
    const festOld = fests.filter((fx) => fx.date !== Spirits.todayKey());
    if (festOld.length) {
      h += '<div class="ft-old">' + festOld.map((fx) =>
        '<details class="ft-item"><summary><span>' + esc(fx.emoji + " " + fx.name) + "</span><span>" + esc(fx.date) + "</span></summary>" +
        '<div class="ft-text">' + esc(fx.text) + "</div>" +
        (fx.cgUrl ? '<img class="cg-thumb ft-cgimg" data-cg="' + esc(fx.cgUrl) + '" src="' + esc(fx.cgUrl) + '" alt="">' : "") +
        "</details>").join("") + "</div>";
    }
    h += "</div>";

    h += '<div class="sd-card"><div class="sd-card-title">📝 人物设定' +
      '<button type="button" class="link-btn" id="sdSetup" style="float:right;font-size:11px">' +
      (lkNow.chosen ? "改设定" : "✨ 4 步定设定") + "</button></div>" +
      '<div class="sd-persona" id="sdPersonaText">' + (rec.personaZh ? esc(rec.personaZh) : ((rec.look && rec.look.persona) ? esc(rec.look.persona) : '<span style="color:var(--text-2)">正在为它写设定…（第一次会调用一次文字模型，稍等几秒）</span>')) + "</div>" +
      '<div class="look-sum" style="margin-top:8px">' +
        '<span class="look-sw big" style="background:' + esc(lkNow.hairHex || "#ddd") + '"></span>' +
        "<span>" + esc(lkNow.hairZh || "跟珠子主色") + "</span>" +
        (lkNow.pers ? '<span class="look-tag">' + esc(lkNow.pers.zh) + "</span>" : "") +
        lkNow.feats.map((f) => '<span class="look-tag">' + esc(f.zh) + "</span>").join("") +
        (lkNow.noFeat ? '<span class="look-tag">普通人形</span>' : "") +
      "</div></div>";

    h += '<div class="sd-card"><div class="sd-card-title">📿 原型手串</div><div class="sd-bead">' +
      (photo ? '<img src="' + esc(photoUrl(photo)) + '" alt="">' : '<div class="placeholder">📿</div>') +
      '<div class="sd-bead-meta"><div class="sd-bead-name">' + esc(it.name || "未命名") + "</div>" +
      '<div class="sd-bead-sub">' + esc(colorName) + (it.species ? " · " + esc(it.species) : "") + " · " + esc(softName) + "</div>" +
      '<div class="sd-bead-sub">陪伴 ' + DB.daysWith(it) + " 天 · 盘玩 " + (it.playCount || 0) + " 次</div>" +
      '<button class="btn ghost" id="sdGoBead" style="margin-top:8px;font-size:12px">查看手串详情</button></div></div></div>';

    // v165-M：可达阶（stageOf，只认盘玩次数）> 已确认阶（rec.stage）⇒ 给「✨ 可以进阶了」按钮，
    //   ⛔ 不再自动进阶、也不再写"自动已进阶"；未达标才显示原来的进度条。
    const reachStage = Spirits.stageOf(it, rec, Date.now());
    const confirmedStage = Math.max(1, Number(rec.stage) || 1);
    const canAdvance = reachStage > confirmedStage;
    h += '<div class="sd-card"><div class="sd-card-title">🌱 成长</div>' +
      (canAdvance
        ? '<div class="spirit-prog ok">✨ 可以进阶了（已盘到「' + esc(Spirits.stageDef(reachStage).name) + '」的份上了）</div>' +
          '<button class="btn primary" id="sdConfirmStage">✨ 可以进阶了 · 点此进阶</button>'
        : (si.isMax ? '<div class="spirit-prog max">已是化形 · 巅峰形态 👑</div>'
          : '<div class="spirit-prog"><span class="spirit-prog-track"><span class="spirit-prog-fill" style="width:' + si.pct + '%"></span></span>' +
            '<span class="spirit-prog-txt">再盘 ' + si.toNext + " 次可到下一阶：" + esc(si.next) + "</span></div>")) +
      // v120：把"会长大"写在界面上（用户问过"不会一直都是 Q 版吧"）
      '<div class="sd-growth-line">📏 现在：' + esc(Spirits.stageDef(si.stage).sizeZh || "") +
      (si.isMax ? " · 已经是最成熟的形态了" : " → 深沁后：" + esc(Spirits.stageDef(si.stage + 1).sizeZh || "")) + "</div>" +
      // v111：深沁/换形象/换外观设定直接放在详情页 —— 生成完就在上面看到新立绘（不用再钻弹层）
      // v112：形象细节升级后（照人物设定画的），这里会提示"按新设定重画"
      '<div class="sd-actions2">' +
      // v165：用户要「到了下一阶要出新的立绘」—— 给一个显式入口：按当前阶重画本阶立绘
      //   （⛔ 阶段本身不手动推进，rec.stage 仍由 stageOf 派生，这里只是重画本阶）
      // v165-M：⛔ 按钮不再叫「进阶」（进阶已独立成 #sdConfirmStage）—— 这里只画本阶立绘
      '<button class="btn ghost" id="sdAdvance">🖼 画本阶立绘</button>' +
      '<button class="btn ghost" id="sdBreak">🔁 重画立绘</button>' +
      (rec.lookStale
        ? '<button class="btn primary" id="sdNewLook">✨ 按新设定重画</button>'
        : '<button class="btn ghost" id="sdNewLook">🔁 换形象</button>') +
      '<button class="btn ghost" id="sdReRoll">🎲 换外观设定</button>' +
      '<button class="btn ghost" id="sdEvents">📜 它的纪事</button>' +
      '<button class="btn ghost" id="sdRecoverOld">🔙 恢复旧立绘</button>' +
      '<button class="btn ghost" id="sdCleanup">🧹 清理失效图</button>' +
      "</div>" +
      (rec.lookStale ? '<div class="sd-stale">🆕 它还想再细致些 —— 点「✨ 按新设定重画」，照「人物设定」重新画一遍。</div>' : "") +
      // v165：本阶立绘欠着时的可点补画入口（⛔ 出图失败不抛错，改成这一行）
      (stageImgPending(rec, it) ? '<div class="sd-stale" id="sdStageImgTip">🖼 本阶立绘还没画出来 · <button type="button" class="link-btn" id="sdStageImgFix">点此画本阶立绘</button></div>' : "") +
      '<div class="sd-gen">已为它画过 ' + (Number(rec.genCount) || 1) + " 张</div>" +
      (hist.length > 1 ? '<div class="spirit-hist">' + hist.map((x) => {
        const d = Spirits.stageDef(x.stage);
        return '<div class="spirit-hist-item' + (x.stage === si.stage ? " now" : "") + '" title="' + esc(d.name) + '">' +
          '<img src="' + esc(x.url) + '" alt=""><span>' + d.icon + esc(d.name) + "</span></div>";
      }).join("") + "</div>" : "") +
      "</div>";

    h += '<div class="sd-card"><div class="sd-card-title">🏠 住的房间</div>';
    if (room) {
      h += '<div class="sd-room-line"><span class="room-emoji">' + esc(room.emoji || "🏠") + "</span> " + esc(room.name) +
        '<button class="link-btn" id="sdRoomGo" style="float:right">进房间看看</button></div>';
      if (mates.length) {
        h += '<div class="sd-mates">' + mates.map((m) => {
          const aff = Rooms.affinityOf(id, m.id), li = Rooms.levelInfo(aff);
          return '<div class="sd-mate" data-mate="' + esc(m.id) + '">' + spiritThumbHtml(m, store[m.id] || {}, 40) +
            '<div class="sd-mate-meta"><div class="sd-mate-name">' + esc(nameOf(m, store)) + "</div>" +
            '<div class="sd-mate-aff">契合度 ' + aff + " · " + esc(li.levelName) +
            (li.next == null ? "（已经是最懂彼此的那一档）" : "（再攒 " + li.need + " 就有新剧情）") + "</div>" +
            '<div class="room-track"><i style="width:' + li.pct + '%"></i></div></div></div>';
        }).join("") + "</div>";
      } else {
        h += '<div class="room-none" style="margin-top:8px">目前自己住一间。再放一尊进去，它们就会开始攒契合度～</div>';
      }
    } else {
      h += '<div class="room-none">还没入住。给它安排一间小屋，同住的沁灵会慢慢攒契合度 ✨</div>';
    }
    h += '<button class="btn ghost" id="sdRoomPick" style="width:100%;margin-top:10px;font-size:13px">' +
      (room ? "🏠 换房间 / 搬出去" : "🏠 安排入住") + "</button></div>";

    h += '<div class="sd-card"><div class="sd-card-title">📔 日记本（' + diary.length + "）</div>";
    if (!diary.length) {
      h += '<div class="room-none">还没写过日记。它们一天最多写 1 篇（不定时），明天再来看看～</div>';
    } else {
      // v156：改成"翻页式日记本"——一次只摊开一篇，用 上一篇 / 下一篇 翻（内容由下面的 paintDiary 填）
      h += '<div class="sd-diary-nav">' +
        '<button type="button" class="dnb" id="sdDiaryPrev">‹ 上一篇</button>' +
        '<span class="sd-diary-pos">第 <b id="sdDiaryNo">' + diary.length + "</b> / " + diary.length + " 篇</span>" +
        '<button type="button" class="dnb" id="sdDiaryNext">下一篇 ›</button>' +
        "</div>" +
        '<div class="sd-diary-paper" id="sdDiaryBook"></div>' +
        // v155：回信输入（默认收起，点「↩️ 回它一句」才展开）
        '<div class="sd-rep-box" id="sdRepBox" hidden><textarea id="sdRepInput" maxlength="120" placeholder="写一句回它 —— 它下一篇日记会回应你"></textarea>' +
        '<button class="btn primary" id="sdRepSend">回它</button></div>';
    }
    h += "</div>";

    // v155：✦ 回响 —— 纪念日信件（本地生成，只在这一天出现）
    const echoes = (Array.isArray(rec.echoes) ? rec.echoes : []).slice().reverse();
    h += '<div class="sd-card"><div class="sd-card-title">✦ 回响（' + echoes.length + "）" +
      '<small style="font-weight:400;color:var(--text-2);font-size:11px"> 它替你记着的日子</small></div>';
    if (!echoes.length) {
      h += '<div class="room-none">还没有回响。它会在陪你的第 7 / 30 / 100 天，还有每年挂瓷那天，主动写一封信给你 —— 那些日子不用你记，它记着。</div>';
    } else {
      h += '<div class="sd-echo">' + echoes.map((e) =>
        '<div class="sd-echo-item' + (Number(rec.mailSeenAt) < (e.at || 0) ? " new" : "") + '">' +
        '<div class="sd-echo-head"><span>' + esc(e.title || "✦ 回响") + "</span><span>" + esc(fmtDay(e.at)) + "</span></div>" +
        '<div class="sd-echo-text">' + esc(e.text || "").replace(/\n/g, "<br>") + "</div></div>").join("") + "</div>";
    }
    h += "</div>";

    /* v165-N3：⛔ 详情页里进入**旧 8 章主线**的入口已按用户裁定取消
       （原话：「以前的主线剧情，就是从每个沁灵的详情页进入那个，取消。全面用新的剧情来取代，走独立的入口。」）
       ⛔ 只删入口：`CHAP_SCRIPTS` / `CHAPTERS` / `chapterState` / `rec.chapters` / `rec.talk`
         数据与方法**全部原样保留**（CG 相册仍按索引消费 chapterState），一行没动。
       新 9 章《沁灵纪》走**独立入口**：首页「📖 沁灵纪 · 主线」→ #/main。 */

    // v157：🎞 回忆册 —— 它陪你的时间线（本地推导，0 出图；可一键合成竖版长图）
    const memos = Spirits.memoirOf(it, rec);
    h += '<div class="sd-card"><div class="sd-card-title">🎞 回忆册（' + memos.length + "）" +
      '<small style="font-weight:400;color:var(--text-2);font-size:11px"> 它替你记着的那些"第一次"</small></div>';
    if (!memos.length) {
      h += '<div class="room-none">还没有可记的事。等它陪你久一点，这里会慢慢长出一条时间线。</div>';
    } else {
      h += '<div class="memo-line">' + memos.slice().reverse().map((m) =>
        '<div class="memo-row"><span class="memo-dot">' + esc(m.icon) + "</span>" +
        '<div class="memo-body"><div class="memo-head"><b>' + esc(m.title) + "</b><span>" + esc(fmtDay(m.at)) + "</span></div>" +
        (m.sub ? '<div class="memo-sub">' + esc(m.sub) + "</div>" : "") + "</div></div>").join("") + "</div>" +
        '<button class="btn ghost" id="sdMemoCard" style="width:100%;margin-top:10px;font-size:13px">🎞 做一张回忆卡（存图 / 分享）</button>';
    }
    h += "</div>";

    // v125：CG 插画（蜕形 / 化形才有）· v165-R2：**描述先行**（⛔ 绝不自动出图）
    h += '<div class="sd-card"><div class="sd-card-title">🎬 CG 插画' +
      (Spirits.needCg(si.stage) ? "" : '<small style="font-weight:400;color:var(--text-2)"> · 蜕形 / 化形才有</small>') +
      (_hasCg ? ' <button type="button" class="link-btn" id="sdManageCg" style="float:right">🗑 管理</button>' : "") + "</div>";
    if (rec.cgUrl && !_cgRedo[id]) {
      h += '<img class="cg-thumb" id="sdCg" src="' + esc(rec.cgUrl) + '" alt="CG">' +
        '<button type="button" class="link-btn" id="sdCgRedo" style="margin-top:8px;display:block">✏️ 改描述重画</button>';
    } else if (Spirits.needCg(si.stage)) {
      h += '<div class="cg-brief">' +
        '<div class="cg-brief-tip">先看要画什么 —— 这段描述可以直接改，改满意了再出图（出图消耗 1 次额度）</div>' +
        '<textarea class="cg-brief-ta" id="sdCgBrief" rows="5" placeholder="点「🔤 生成画面描述」，或者干脆自己写：它站在哪儿、穿什么、在做什么、什么光、什么情绪">' +
        esc(rec.cgBrief || "") + "</textarea>" +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn ghost" id="sdCgBriefGen" style="flex:1">🔤 生成画面描述</button>' +
        '<button class="btn primary" id="sdCgDraw" style="flex:1">🎬 按这段描述出图</button>' +
        "</div>" +
        (rec._cgErr ? '<div class="sd-gen-hint">上次出图失败：' + esc(rec._cgErr) + "</div>" : "") +
        "</div>";
    } else {
      h += '<div class="room-none">它现在还是' + esc(si.name) + '，只有立绘；深沁到「蜕形」就会解锁一张专属 CG 🎬</div>';
    }
    h += "</div>";

    // v162：夜话入口
    const NS2 = nightNow();
    if (NS2.threads.length) {
      let nOpen = 0;
      NS2.threads.forEach((t) => { nOpen += threadOpenCount(threadNow(t.id)); });
      h += '<button class="nt-launch" id="sdNight">📱 夜话 · ' + NS2.threads.length + " 个会话" +
        '<small>' + (nOpen ? "有 " + nOpen + " 件事可以聊" : "今晚没动静 · 可以回看以前聊过的") + '</small></button>';
    }
    h += '<div class="sd-actions">' +
      '<button class="btn ghost" id="sdChat">💬 它们聊天</button>' +
      '<button class="btn ghost" id="sdSpiritList">🍡 所有沁灵</button></div>';

    view.innerHTML = h;
    bindSpiritImgFallback(view);
    bindBrokenImgCleanup(view);
    // 原地刷新（保持滚动位置）/ 回到顶部（让用户第一时间看到新立绘）
    const refresh = () => { const y = window.scrollY; renderSpiritDetailPage(id); window.scrollTo(0, y); };
    const refreshTop = () => { renderSpiritDetailPage(id); window.scrollTo(0, 0); };
    const host = {
      refresh: refresh,
      refreshTop: refreshTop,
      busy: (on, text) => {
        ["#sdAdvance", "#sdBreak", "#sdNewLook", "#sdReRoll"].forEach((sel) => {
          const b = $(sel);
          if (!b) return;
          if (on) { b.disabled = true; if (sel === "#sdNewLook") { b.dataset.old = b.textContent; b.textContent = text || "处理中…"; } }
          else { b.disabled = false; if (b.dataset.old) { b.textContent = b.dataset.old; delete b.dataset.old; } }
        });
      },
    };
    // v165：#sdAdvance 与 #sdBreak 同体（spiritBreak 内部已按 stageOf 现算阶重画）
    const adv = $("#sdAdvance"); if (adv) adv.onclick = () => spiritBreak(it, host);
    // v165-M：进阶 = 用户手动确认，⛔ 绝不自动出图（出图走「🖼 画本阶立绘」）
    const cs = $("#sdConfirmStage"); if (cs) cs.onclick = () => { if (confirmStage(it)) renderSpiritDetailPage(id); };
    const sif = $("#sdStageImgFix"); if (sif) sif.onclick = () => spiritBreak(it, host);
    const bk = $("#sdBreak"); if (bk) bk.onclick = () => spiritBreak(it, host);
    const nl = $("#sdNewLook"); if (nl) nl.onclick = () => spiritNewLook(it, host);
    const rr = $("#sdReRoll"); if (rr) rr.onclick = () => spiritReRoll(it, host);
    const ev = $("#sdEvents"); if (ev) ev.onclick = () => { location.hash = "#/events?owner=" + encodeURIComponent(id); };
    const ro = $("#sdRecoverOld"); if (ro) ro.onclick = async () => {
      const yes = await confirmModal("恢复到 v164c 之前的旧立绘？", "用旧版出图设定重铺这只沁灵的立绘（仅当它还在缓存里才回得来）。当前立绘不会被删，只是换成旧版。", "恢复旧立绘", true);
      if (!yes) return;
      await recoverOldPortraits([it], renderSpiritDetailPage);
    };
    const cl = $("#sdCleanup"); if (cl) cl.onclick = () => cleanupBrokenImages(it);
    const pv = $("#sdPrev"); if (pv && _prevIt) pv.onclick = () => { location.hash = "#/spirit/" + encodeURIComponent(_prevIt.id); };
    const nx = $("#sdNext"); if (nx && _nextIt) nx.onclick = () => { location.hash = "#/spirit/" + encodeURIComponent(_nextIt.id); };
    const su = $("#sdSetup"); if (su) su.onclick = () => showSpiritSetupModal(it);   // v127：设定向导
    // v166：立绘 / CG 删除管理
    const mi = $("#sdManageImg"); if (mi) mi.onclick = () => openSpiritImgManager(id);
    const mc = $("#sdManageCg"); if (mc) mc.onclick = () => openSpiritCgManager(id);
    // v165：心迹区 —— 照料三式 + 「递一件给它」
    view.querySelectorAll(".xt-care-btn").forEach((b) => { if (!b.disabled) b.onclick = () => spiritCareDo(it, b.dataset.care, host); });
    const xtg = $("#xtGiftOpen"); if (xtg && !xtg.disabled) xtg.onclick = () => openGiftDrawer(it, host);
    // v156：翻页式日记本 —— 一次摊开一篇，上一篇 / 下一篇（或左右滑动）翻
    const dBook = $("#sdDiaryBook");
    if (dBook && diary.length) {
      const dPrev = $("#sdDiaryPrev"), dNext = $("#sdDiaryNext"), dNo = $("#sdDiaryNo");
      // ⚠️ diary 是「最新在前」的倒序数组 → di=0 就是最新那篇
      let di = 0;
      // 单篇的 HTML（isNew = 是不是最新那篇：只有它能回信 + 打字机亮相）
      const diaryPageHtml = (d, isNew) => {
        const raw = String(d.text || "").replace(/^第[^\n]*\n/, "");
        // v155：这篇有没有被回过（回了它就等下一篇日记里回应）
        const rep = (d.date && rec.replies && rec.replies[d.date]) ? rec.replies[d.date] : null;
        return '<div class="sd-page-item">' +
          '<div class="sd-diary-date">' + esc(d.date || "") + "<span>" + fmtTime(d.at) + "</span></div>" +
          (isNew
            ? '<div class="sd-diary-text" id="sdDiaryNew" data-full="' + esc(raw) + '" data-at="' + (d.at || 0) + '" title="点一下立刻显示全文">' + esc(raw) + "</div>"
            : '<div class="sd-diary-text">' + esc(raw).replace(/\n/g, "<br>") + "</div>") +
          (rep ? '<div class="sd-diary-rep">你回了它：「' + esc(rep.text) + "」" +
            (Number(rec.replyAcked) >= rep.at ? "" : '<span class="rep-wait">· 等它下一篇日记回应</span>') + "</div>" : "") +
          (isNew ? '<button type="button" class="link-btn sd-rep-btn" id="sdRepBtn" data-date="' + esc(d.date || "") + '">↩️ 回它一句</button>' : "") +
          "</div>";
      };
      const paintDiary = () => {
        const isNew = di === 0;
        const rbx = $("#sdRepBox");
        if (rbx) rbx.hidden = true;                  // 翻页后收起回信框（它只跟着当前这篇）
        dBook.innerHTML = diaryPageHtml(diary[di], isNew);
        if (dNo) dNo.textContent = String(diary.length - di);   // 按时间顺序编号：最新那篇 = 第 N 篇
        if (dPrev) dPrev.disabled = di >= diary.length - 1;     // 已经是第一篇了
        if (dNext) dNext.disabled = isNew;                      // 已经是最新一篇了
        const rb = $("#sdRepBtn");
        if (rb && rbx) rb.onclick = () => {
          rbx.hidden = false;
          rbx.dataset.date = rb.dataset.date || Spirits.todayKey();
          const ta = $("#sdRepInput");
          if (ta) ta.focus();
        };
        if (isNew) typewriteSpiritDiary(id);         // v126：最新一篇逐字亮相（带兜底，不会空白）
      };
      // 上一篇 = 更早的一篇（数组往后走）；下一篇 = 更晚的一篇（往最新走）
      const goEarlier = () => { if (di < diary.length - 1) { di += 1; paintDiary(); } };
      const goLater = () => { if (di > 0) { di -= 1; paintDiary(); } };
      if (dPrev) dPrev.onclick = goEarlier;
      if (dNext) dNext.onclick = goLater;
      // 手机上左右滑动也能翻（左滑 = 往更新的翻，右滑 = 往更早的翻）
      let dSx = 0, dSy = 0, dSw = false;
      dBook.addEventListener("touchstart", (e) => {
        const t = e.touches && e.touches[0];
        if (!t) return;
        dSx = t.clientX; dSy = t.clientY; dSw = true;
      }, { passive: true });
      dBook.addEventListener("touchend", (e) => {
        if (!dSw) return;
        dSw = false;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - dSx, dy = t.clientY - dSy;
        if (Math.abs(dx) > 46 && Math.abs(dy) < 34) { if (dx < 0) goLater(); else goEarlier(); }
      }, { passive: true });
      paintDiary();
    }
    const art = $("#sdArt");
    if (art) art.onclick = () => openSpiritViewer(rec.imgUrl || Spirits.localAvatarSvg(it));
    // v166：详情页若有进阶 CG，大图区展示的是 CG（sdArtCg），点它看 CG 大图而非立绘
    const artCg = $("#sdArtCg");
    if (artCg) artCg.onclick = () => openSpiritViewer(rec.cgUrl || "");
    const cgEl = $("#sdCg");
    if (cgEl) cgEl.onclick = () => openSpiritViewer(rec.cgUrl || "");
    const cgRedo = $("#sdCgRedo");
    if (cgRedo) cgRedo.onclick = () => { _cgRedo[id] = true; renderSpiritDetailPage(id); };
    // v165-R2：CG 描述先行 —— ⓪ 生成描述 / ① 编辑确认 / ② 按描述出图（⛔ 全程手动，绝不自动出图）
    const cgBriefTa = $("#sdCgBrief");
    const cgBriefGen = $("#sdCgBriefGen");
    if (cgBriefGen) cgBriefGen.onclick = async () => {
      cgBriefGen.disabled = true; cgBriefGen.textContent = "正在写描述…";
      try {
        const r0 = Spirits.load()[id] || {};
        const br = await genCgBrief({
          kind: "stage", item: it, stage: Number(r0.stage) || 1,
          look: Spirits.lookOf(it, r0), persona: r0.persona || null,
          // v166：用户先在 textarea 写大概意向 → AI 润色完善；textarea 为空则按原逻辑自动生成
          intent: (cgBriefTa && cgBriefTa.value || "").trim(),
        });
        if (cgBriefTa) cgBriefTa.value = br;
        const s0 = Spirits.load(); const r1 = Spirits.ensureIn(s0, id);
        r1.cgBrief = br; Spirits.save(s0);
        toast("描述写好了 —— 可以改，改满意再出图");
      } catch (e) { toast("描述生成失败：" + ((e && e.message) || "请稍后再试")); }
      cgBriefGen.disabled = false; cgBriefGen.textContent = "🔤 生成画面描述";
    };
    const cgDraw = $("#sdCgDraw");
    if (cgDraw) cgDraw.onclick = async () => {
      const brief = String((cgBriefTa && cgBriefTa.value) || "").trim();
      if (!brief) { toast("先写一段描述，或者点「🔤 生成画面描述」"); return; }
      const s0 = Spirits.load(); const r0 = Spirits.ensureIn(s0, id);
      r0.cgBrief = brief; r0._cgErr = ""; Spirits.save(s0);          // ① 先存**确认后**的描述
      cgDraw.disabled = true; cgDraw.textContent = "正在画…（约 15-20 秒）";
      try {
        const r1 = Spirits.load()[id] || {};
        const stage = Number(r1.stage) || 1;
        const out = await drawCgFromBrief(brief, {                     // ② 提取关键词 → 装配 prompt → 手动出图
          kind: "stage", item: it, stage: stage,
          appearance: Spirits.appearanceOf(it, r1.appearanceSeed || 0, r1.gender || ""),
          look: Spirits.lookOf(it, r1),
          seedKey: "cg|" + id + "|" + stage, variant: r1.variant || 0, ref: "",
        });
        const s2 = Spirits.load(); const r2 = Spirits.ensureIn(s2, id);
        r2.cgUrl = out.url || ""; r2.cgAt = Date.now(); r2.cgStage = stage; r2.cgKey = cgKeyOf(r2);
        // v166：进阶专属 CG 同时归档进 rec.cgs（相册「进阶 CG」分区），id 用 adv#<阶>；cgCollectedIds 已排除该前缀、不撑进度
        Spirits.cgMarkCollected(r2, "adv#" + stage, {
          title: "进阶专属 CG · " + Spirits.stageDef(stage).name,
          caption: (brief || "").slice(0, 50),
          key: cgKeyOf(r2),
        }, out.url || "");
        bumpGenCount(r2);                       // CG 也是要花钱的一张，计入额度
        Spirits.save(s2);
        delete _cgRedo[id];
        toast("🎬 CG 画好了");
        renderSpiritDetailPage(id);
      } catch (e) {
        const s3 = Spirits.load(); const r3 = Spirits.ensureIn(s3, id);
        r3._cgErr = (e && e.message) || "CG 出图失败"; Spirits.save(s3);
        cgDraw.disabled = false; cgDraw.textContent = "🎬 重试（消耗 1 次出图额度）";
        toast("出图失败：" + ((e && e.message) || "请稍后再试"));
      }
    };
    // v158：节令限定插画 · v165-R2：同样走「描述先行」（⛔ 不再只确认额度就出图）
    const festCgBtn = $("#sdFestCg");
    if (festCgBtn) festCgBtn.onclick = async () => {
      if (festCgBtn.disabled) return;
      const dk = festCgBtn.dataset.date || Spirits.todayKey();
      const r0 = Spirits.load()[id] || {};
      const fx0 = (r0.fests && r0.fests[dk]) || null;
      if (!fx0) return;
      if (fx0.cgUrl) { openSpiritViewer(fx0.cgUrl); return; }
      openFestCgBriefModal(it, dk, fx0);
    };
    // v165-N3：旧 8 章的章节列表点击跳转已随入口一并取消（数据保留）。
    //   新 9 章用 data-main 承载章号，见 renderMainPage。
    // v158：节令插画点开看大图
    view.querySelectorAll(".ft-cgimg").forEach((el) => {
      el.onclick = () => openSpiritViewer(el.dataset.cg || el.src || "");
    });
    // v157：回忆卡（本地 canvas 合成，0 出图 0 模型调用）
    const memoBtn = $("#sdMemoCard");
    if (memoBtn) memoBtn.onclick = async () => {
      if (memoBtn.disabled) return;
      const old = memoBtn.textContent;
      memoBtn.disabled = true;
      memoBtn.textContent = "正在拼回忆卡…";
      try {
        const bl = Spirits.bondLevel(rec.bond || 0);
        const cv = await Poster.memoirPoster({
          name: spiritName(it, store),
          stage: si.icon + " " + si.name,
          imgUrl: rec.imgUrl || "",
          days: DB.daysWith(it),
          bond: bl.icon + " " + bl.name,
          milestones: Spirits.memoirOf(it, rec),
          owner: Spirits.getOwner().name || "",
          line: "从一串珠子，到有脾气的它。",
        });
        const r = await Poster.shareCanvas(cv, "回忆册-" + spiritName(it, store) + ".jpg");
        toast(r === "shared" ? "🎞 回忆卡已分享" : "🎞 回忆卡已保存");
      } catch (e) {
        toast("生成失败：" + ((e && e.message) || "请重试"));
      }
      memoBtn.disabled = false;
      memoBtn.textContent = old;
    };
    const gb = $("#sdGoBead"); if (gb) gb.onclick = () => location.hash = "#/item/" + it.id;
    const ch = $("#sdChat"); if (ch) ch.onclick = () => showSpiritChatModal(it);
    const sl = $("#sdSpiritList"); if (sl) sl.onclick = () => location.hash = "#/spirit";
    const sdn = $("#sdNight"); if (sdn) sdn.onclick = () => { _nightFrom = "#/spirit/" + encodeURIComponent(id); location.hash = "#/night"; };
    const rg = $("#sdRoomGo"); if (rg) rg.onclick = (e) => { e.stopPropagation(); location.hash = "#/room/" + encodeURIComponent(room.id); };
    const rp = $("#sdRoomPick"); if (rp) rp.onclick = () => showSpiritRoomPicker(it);
    view.querySelectorAll("[data-mate]").forEach((el) => el.onclick = () => { location.hash = "#/spirit/" + encodeURIComponent(el.dataset.mate); });
    // ✏️ 改名（只能改一次）
    const rn = $("#sdRename");
    if (rn) rn.onclick = () => showRenameModal(it);
    // 进详情页 = 这只看过了 → 清掉它的日记"未读"
    if ((rec.diary || []).length) {
      const lastAt = (rec.diary.slice(-1)[0] || {}).at || 0;
      if ((rec.diarySeenAt || 0) < lastAt) {
        const s3 = Spirits.load();
        Spirits.ensureIn(s3, it.id).diarySeenAt = lastAt;
        Spirits.save(s3);
        updateStoryDot();
      }
    }
    // v155：进详情页 = 回响看过了（清掉红点）
    if ((rec.echoes || []).length) {
      const lastEcho = (rec.echoes.slice(-1)[0] || {}).at || 0;
      if ((rec.mailSeenAt || 0) < lastEcho) {
        const s4 = Spirits.load();
        Spirits.ensureIn(s4, it.id).mailSeenAt = lastEcho;
        Spirits.save(s4);
      }
    }
    // v155：日记回信（你回它一句 → 它下一篇日记里回应）
    //   v156：回信按钮现在跟着「当前摊开的那一篇」，绑定在 paintDiary 里了
    const repBox = $("#sdRepBox");
    const repSend = $("#sdRepSend");
    if (repSend) repSend.onclick = () => {
      const ta = $("#sdRepInput");
      const t = ta ? String(ta.value || "").trim() : "";
      if (!t) { toast("写一句再回它"); return; }
      const s5 = Spirits.load();
      const r5 = Spirits.ensureIn(s5, it.id);
      Spirits.replyDiary(it, r5, (repBox && repBox.dataset.date) || Spirits.todayKey(), t);
      Spirits.save(s5);
      toast("💌 回它了，它下一篇日记会回应你");
      refresh();
    };
    // v155：改口（羁绊到「通意」后它会想叫你的名字）
    const callYes = $("#sdCallYes");
    if (callYes) callYes.onclick = () => {
      const s6 = Spirits.load();
      const r6 = Spirits.ensureIn(s6, it.id);
      const o6 = Spirits.getOwner();
      r6.nickCall = (o6 && o6.name) ? o6.name : "你";
      r6.nickCallAsked = 1;
      Spirits.save(s6);
      toast("💛 它开始叫你「" + r6.nickCall + "」了");
      refresh();
    };
    const callNo = $("#sdCallNo");
    if (callNo) callNo.onclick = () => {
      const s7 = Spirits.load();
      const r7 = Spirits.ensureIn(s7, it.id);
      r7.nickCall = ""; r7.nickCallAsked = 1;
      Spirits.save(s7);
      toast("它还是叫你「主人」");
      refresh();
    };
    const callReset = $("#sdCallReset");
    if (callReset) callReset.onclick = () => {
      const s8 = Spirits.load();
      const r8 = Spirits.ensureIn(s8, it.id);
      r8.nickCall = ""; r8.nickCallAsked = 1;
      Spirits.save(s8);
      toast("改回叫「主人」了");
      refresh();
    };
    // v150：打开详情即按需重写「人物设定」——旧档（写错发型 / 现代服装 / 没融合设定）一次性作废重写
    (async () => {
      try {
        const before = (Spirits.load()[id] || {}).personaZh;
        const pOverride = Object.assign({}, rec.persona || Spirits.localPersona(it), { name: spiritName(it, Spirits.load()) });
        await Spirits.personaZh(it, ap, pOverride, rec.stage || 1, DB.daysWith(it), it.playCount || 0);
        const after = (Spirits.load()[id] || {}).personaZh;
        if (after && after !== before) {
          // 同步刷新「形象细节关键词」，让立绘/ CG 照新设定画
          try { await Spirits.buildLookTags(it, ap, after, rec.persona || Spirits.localPersona(it)); } catch (e) {}
          const el = document.getElementById("sdPersonaText");
          if (el) el.textContent = after;
        }
      } catch (e) { /* 无 key / 生成失败不影响查看 */ }
    })();
    ensureSpiritExtras([it]);
    tickRooms();          // v164f：进详情页也推进契合度/补写剧情（之前只在全部沁灵/房间页推，导致详情页看着契合度不涨）
  }

  /* ---------- 改名（每个沁灵只能改一次） ---------- */
  function showRenameModal(item) {
    const mask = $("#modalMask"), modal = $("#modal");
    const cur = spiritName(item, Spirits.load());
    modal.innerHTML = "<h3>✏️ 给它改个名字</h3>" +
      '<p style="font-size:12px;color:var(--text-2);line-height:1.7;margin-bottom:12px;text-align:center">' +
      "名字只能改一次，想好了再点保存哦～<br>（改完之后它写日记、写剧情、聊天都会用新名字）</p>" +
      '<div class="form-group"><div class="form-label">新名字 <small>2-6 个字最好看</small></div>' +
      '<input class="form-input" id="rnName" maxlength="6" placeholder="' + esc(cur) + '" value="' + esc(cur) + '"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn ghost" id="rnCancel" style="flex:1">取消</button>' +
      '<button class="btn primary" id="rnSave" style="flex:2">就这个（不能改第二次）</button></div>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    $("#rnCancel").onclick = close;
    mask.onclick = close;
    $("#rnSave").onclick = () => {
      const nm = ($("#rnName").value || "").trim().slice(0, 6);
      if (!nm) { toast("名字不能为空"); return; }
      const s = Spirits.load();
      const r = Spirits.ensureIn(s, item.id);
      r.name = nm;
      r.nameEdited = true;
      r.personaZhKey = "";        // 让人物设定按新名字重写一次（里面会提到名字）
      Spirits.save(s);
      close();
      toast("名字改成「" + nm + "」了 ✏️（不能再改）");
      const h = location.hash;
      if (h.indexOf("#/spirit/") === 0) renderSpiritDetailPage(decodeURIComponent(h.slice(9)));
      else renderAllSpiritsPage();
    };
  }

  /* ============================================================
   * v127：沁灵「设定向导」——生成前先让用户 4 步确认（用户要求）
   *   ① 发色/色调：显示识别到的珠子主色，可一键改（预设 12 色 / 自己填色名或 #hex）
   *   ② 特殊特征：猫耳+猫尾 / 兔耳 / 小龙角…（最多 3，可明确"普通人形"）
   *   ③ 性格：6 选 1
   *   ④ 一句话基础设定（可选）→ AI 扩写成一段详细设定，显示在详情页
   * 保存后写进 rec.look，立绘 / CG / 剧情 prompt 全部按它走。
   * ============================================================ */
  function lookChipHtml(group, id, label, active, data) {
    return '<button type="button" class="look-chip' + (active ? " on" : "") + '" data-g="' + group + '" data-v="' + esc(id) + '"' +
      (data ? ' data-extra="' + esc(data) + '"' : "") + ">" + label + "</button>";
  }
  function showSpiritSetupModal(item, opts) {
    const o = opts || {};
    const mask = $("#modalMask"), modal = $("#modal");
    const s = Spirits.load();
    const rec = Spirits.ensureIn(s, item.id);
    const cur = rec.look || {};
    const lk = Spirits.lookOf(item, rec);
    const bead = Spirits.beadColor(item);
    const beadHex = (bead && bead.hex) || "";
    const beadZh = (bead && (bead.zh || bead.word)) || (Spirits.COLOR_ZH[item.color] || "未识别");
    const state = {
      hairc: cur.hairc || "auto",
      customColor: cur.customColor || "",
      feats: (cur.feats || []).slice(0),
      // v130：「自己填」的特征存成 "custom:描述"，重新打开时回填
      customFeat: ((cur.feats || []).filter((x) => String(x).indexOf("custom:") === 0)[0] || "").slice(7),
      pers: cur.pers || "",
      base: cur.base || "",
      ai: cur.ai !== false,
      persona: cur.persona || "",       // v164：用户确认过的完整人设（第 2 步的正文）
      alsoBead: false,
    };
    // v153：发色 = 两种模式（跟珠子 / 自动）+ 一大片颜色格子（只给色块，不给中文色名）
    const hairModes = Spirits.HAIR_COLORS.filter((h) => h.id === "bead" || h.id === "auto").map((h) =>
      lookChipHtml("hairc", h.id, esc(h.zh), state.hairc === h.id)).join("");
    const curHex = (state.hairc === "custom") ? String(state.customColor || "").toLowerCase() : "";
    const paletteSwatches = (Spirits.HAIR_PALETTE || []).map((c) => {
      const nm = Spirits.hexToCnTrad(c) || c;     // v153：色块名用中国传统色
      return '<button type="button" class="hair-sw' + (c.toLowerCase() === curHex ? " on" : "") +
        '" data-c="' + c + '" title="' + esc(nm) + '" style="background:' + c + '"></button>';
    }).join("");
    const hairNowText = state.hairc === "custom"
      ? ("已选色：" + (Spirits.hexToCnTrad(state.customColor) || state.customColor || ""))
      : (state.hairc === "bead" ? "跟随珠子主色（推荐）" : "自动换个色");
    const featChips = Spirits.FEATURES.map((f) =>
      lookChipHtml("feat", f.id, esc(f.zh), state.feats.indexOf(f.id) >= 0)).join("") +
      lookChipHtml("feat", "__custom", "✏️ 自己填", !!state.customFeat);
    const persChips = Spirits.PERSONAS_PICK.map((p) =>
      lookChipHtml("pers", p.id, esc(p.zh), state.pers === p.id)).join("");

    const step1Html = () => '<div class="setup-wrap">' +
      // v129：先把"这是给谁做设定"写在最上面（用户反馈：不知道在给哪一尊做设定）
      (function () {
        const nm = spiritName(item, Spirits.load());
        const si = Spirits.stageInfo(item, rec.stage, DB.daysWith(item));
        const hasLook = !!(rec.look && (rec.look.hairc || (rec.look.feats || []).length || rec.look.pers || rec.look.base));
        return '<div class="setup-who">' +
          '<span class="sw-who-thumb">' + spiritThumbHtml(item, rec, 46) + "</span>" +
          '<span class="sw-who-meta">' +
          '<span class="sw-who-name">' + esc(nm) + "</span>" +
          '<span class="sw-who-sub">来自「' + esc(item.name || "手串") + "」 · " + si.icon + " " + esc(si.name) + "</span>" +
          '<span class="sw-who-tip">' + (hasLook ? "已有设定，改完保存会按新设定重画" : "还没定过设定 —— 出图前先定一下") + "</span>" +
          "</span></div>";
      })() +
      '<div class="setup-head">✨ 第 1 步 / 共 3 步 · 改设定<small>不确定就用默认的，随时能改</small></div>' +
      // ① 发色
      '<div class="setup-sec"><div class="setup-t"><b>1</b> 发色 / 色调</div>' +
      '<div class="setup-desc">我识别到的珠子主色是 ' +
      '<span class="look-sw big" style="background:' + (beadHex || "#ddd") + '"></span> <b>' + esc(beadZh) + '</b>' +
      (beadHex ? ' <code>' + esc(beadHex) + '</code>' : "") + ' —— 读得不对就直接在这儿改。' +
      '<button type="button" class="link-btn" id="lkRedetect" style="margin-left:6px">🧪 重新识别</button></div>' +
      '<div class="setup-chips" id="lkHair">' + hairModes + "</div>" +
      '<div class="hair-palette" id="lkPalette">' + paletteSwatches + "</div>" +
      '<div class="look-hint" id="lkHairNow">' + esc(hairNowText) + "</div>" +
      (beadHex ? '<label class="setup-check"><input type="checkbox" id="lkAlsoBead"> 顺便把珠子主色也改成我选的色（会同步到收藏列表）</label>' : "") +
      "</div>" +
      // ② 特征
      '<div class="setup-sec"><div class="setup-t"><b>2</b> 有没有特殊特征？<small>最多 3 个，自己填的也算</small></div>' +
      '<div class="setup-desc">比如想要「猫猫头」，就选「猫耳 + 猫尾」—— 我会明确写进提示词，不会漏画。预设里没有的就用「✏️ 自己填」。</div>' +
      '<div class="setup-chips" id="lkFeat">' + featChips + "</div>" +
      '<div id="lkFeatCustomWrap" style="display:' + (state.customFeat ? "" : "none") + '">' +
      '<input class="form-input" id="lkFeatCustom" maxlength="30" placeholder="用一句话写它的特征，例：戴一顶小草帽、背一把小木剑" value="' + esc(state.customFeat) + '"></div>' +
      "</div>" +
      // ③ 性格
      '<div class="setup-sec"><div class="setup-t"><b>3</b> 性格</div>' +
      '<div class="setup-desc">会影响它的表情、姿态和日记口吻。</div>' +
      '<div class="setup-chips" id="lkPers">' + persChips + "</div></div>" +
      // ④ 一句话（v164：改成多行、**不限字数** —— 用户说"这里是我主要补充的地方"）
      '<div class="setup-sec"><div class="setup-t"><b>4</b> 你想要的设定<small>随便写，多少都行</small></div>' +
      '<div class="setup-desc">想让它什么样就写在这儿，<b>写得越具体画得越准</b>。<br>' +
      '例：「柿红色的头发高高束起，穿着柿红色搭配鹅黄色的圆领袍，有着明媚笑容的少年郎，手里握着爱吃的柿子」。<br>' +
      '你写到的<b>发色、发型、衣服样式与颜色、手里拿的东西、神态、性别</b>我都会一条条提出来，' +
      '下一步给你确认、可以改；写到的<b>纹样</b>也会照你说的画（例：「衣服也有芭蕉叶的纹样」）。不写就按原来的随机来。</div>' +
      '<textarea class="form-input setup-ta" id="lkBase" rows="5" placeholder="（可留空）例：柿红色的头发高高束起，穿着柿红色搭配鹅黄色的圆领袍，有着明媚笑容的少年郎，手里握着爱吃的柿子">' + esc(state.base) + "</textarea>" +
      "</div>" +
      '<div class="setup-actions">' +
      '<button class="btn ghost" id="lkSkip">先跳过（按自动的来）</button>' +
      '<button class="btn primary" id="lkNext">下一步：润色人设 →</button>' +
      "</div>" +
      '<div class="setup-note">① 改设定 → ② 我按你写的润色出完整人设（你可改）→ ③ 确认出图要求 → 出图。<br>最后一步确认会重画它的立绘（消耗 1 次出图额度），蜕形/化形的 CG 也一起重画。</div>' +
      "</div>";
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      mask.hidden = true; modal.hidden = true; modal.style.display = "";
    };

    let renderStep1 = null;

    // ── 第 1 步的交互绑定（重渲染时要重新绑，所以包成函数） ──
    const bindStep1 = () => {
    // v153：色板选中态 + 当前发色提示（点色块 = 选自定义色，复用 customColor 链路）
    const syncHairSel = () => {
      const wrap = document.getElementById("lkPalette");
      const cur = (state.hairc === "custom") ? String(state.customColor || "").toLowerCase() : "";
      if (wrap) wrap.querySelectorAll(".hair-sw").forEach((b) =>
        b.classList.toggle("on", !!cur && String(b.dataset.c).toLowerCase() === cur));
      const hint = document.getElementById("lkHairNow");
      if (hint) hint.textContent = state.hairc === "custom"
        ? ("已选色：" + (Spirits.hexToCnTrad(state.customColor) || state.customColor || ""))
        : (state.hairc === "bead" ? "跟随珠子主色（推荐）" : "自动换个色");
    };
    const palWrap = document.getElementById("lkPalette");
    if (palWrap) palWrap.onclick = (e) => {
      const b = (e.target && e.target.closest) ? e.target.closest(".hair-sw") : null;
      if (!b) return;
      state.hairc = "custom";
      state.customColor = b.dataset.c || "";
      modal.querySelectorAll('.look-chip[data-g="hairc"]').forEach((x) => x.classList.remove("on"));
      syncHairSel();
    };
    syncHairSel();
    // v130：自定义特征的 chip 亮灭 + 输入框显隐，统一在这里同步
    const syncFeatUi = () => {
      const inp = document.getElementById("lkFeatCustom");
      const w = document.getElementById("lkFeatCustomWrap");
      if (w) w.style.display = (state.customFeat || (inp && inp.value.trim())) ? "" : "none";
      modal.querySelectorAll('.look-chip[data-g="feat"]').forEach((x) => x.classList.toggle("on",
        state.feats.indexOf(x.dataset.v) >= 0 || (x.dataset.v === "__custom" && !!state.customFeat)));
    };
    const featInput = document.getElementById("lkFeatCustom");
    if (featInput) featInput.oninput = () => { state.customFeat = featInput.value.trim(); syncFeatUi(); };
    modal.querySelectorAll(".look-chip").forEach((b) => {
      b.onclick = () => {
        const g = b.dataset.g, v = b.dataset.v;
        if (g === "hairc") {
          state.hairc = v;
          modal.querySelectorAll('.look-chip[data-g="hairc"]').forEach((x) => x.classList.toggle("on", x.dataset.v === v));
          syncHairSel();
        } else if (g === "feat") {
          if (v === "__custom") {
            // v130：「自己填」→ 已有内容再点一次=取消；没有就展开输入框
            if (state.customFeat) {
              state.customFeat = "";
              if (featInput) featInput.value = "";
            } else if (featInput) {
              featInput.focus();
              if (featInput.value.trim()) state.customFeat = featInput.value.trim();
            }
            syncFeatUi();
            return;
          }
          if (v === "none") {
            state.feats = state.feats.indexOf("none") >= 0 ? [] : ["none"];
          } else {
            const i = state.feats.indexOf(v);
            if (i >= 0) state.feats.splice(i, 1);
            else {
              state.feats = state.feats.filter((x) => x !== "none");
              if (state.feats.filter((x) => String(x).indexOf("custom:") !== 0).length >= 3) { toast("最多选 3 个特征"); return; }
              state.feats.push(v);
            }
          }
          modal.querySelectorAll('.look-chip[data-g="feat"]').forEach((x) => x.classList.toggle("on", state.feats.indexOf(x.dataset.v) >= 0));
        } else if (g === "pers") {
          state.pers = (state.pers === v) ? "" : v;
          modal.querySelectorAll('.look-chip[data-g="pers"]').forEach((x) => x.classList.toggle("on", x.dataset.v === state.pers));
        }
      };
    });
    const rd = $("#lkRedetect");
    if (rd) rd.onclick = async () => {
      rd.textContent = "识别中…";
      const got = await Spirits.detectBeadColor(item);
      rd.textContent = "🧪 重新识别";
      if (got && got.hex) {
        toast("重新识别到 " + (got.zh || got.word) + "（" + got.hex + "）");
        showSpiritSetupModal(item, o);       // 重开一次，显示新色
      } else {
        toast("这张照片识别不出来，直接选一个色吧");
      }
    };
    // 第 1 步的两个按钮（在 bindStep1 里绑 → 每次重渲染都会重绑，不会累积监听）
    const nx = $("#lkNext");
    if (nx) nx.onclick = () => startFlow();
    const skBtn = $("#lkSkip");
    if (skBtn) skBtn.onclick = () => doSkip();
    };   // ← bindStep1 结束
    renderStep1 = () => {
      modal.innerHTML = step1Html();
      mask.hidden = false; modal.hidden = false; modal.style.display = "";
      bindStep1();
      mask.onclick = () => close();     // 第 1 步点遮罩 = 关掉（不落库、不出图）
    };

    /* ============================================================
     * v164：三段式流程（用户指定的流程，原话）：
     *   ① 我改设定 → ② 你根据设定完善润色人设，让我看是否 OK
     *   → ③ 我看了 OK，你再根据人设提取出图的关键要求和描述 → 出图；
     *   不 OK 要有给我修改的地方。
     * ============================================================ */
    // 收第 1 步的输入并落库（**只存设定**，不出图、不清旧图）
    const collectStep1 = () => {
      const baseEl = $("#lkBase");
      state.base = (baseEl && baseEl.value || "").trim();
      const alsoEl = $("#lkAlsoBead");
      state.alsoBead = !!(alsoEl && alsoEl.checked);
      const featInput2 = document.getElementById("lkFeatCustom");
      state.customFeat = (featInput2 && featInput2.value || "").trim();
      let featsFinal = state.feats.filter((x) => String(x).indexOf("custom:") !== 0);
      if (state.customFeat) {
        if (featsFinal.filter((x) => x !== "none").length >= 3) { toast("特征最多 3 个，自己填的也算"); return false; }
        featsFinal.push("custom:" + state.customFeat);
      }
      const s2 = Spirits.load();
      const r2 = Spirits.ensureIn(s2, item.id);
      r2.look = Object.assign({}, r2.look || {}, {
        ver: 1, hairc: state.hairc, customColor: state.customColor, feats: featsFinal,
        pers: state.pers, base: state.base, ai: state.ai, at: Date.now(),
      });
      Spirits.save(s2);
      if (state.alsoBead) {
        const hex = state.hairc === "custom"
          ? (/^#?[0-9a-f]{6}$/i.test(state.customColor) ? state.customColor : "")
          : ((Spirits.HAIR_COLORS.filter((h) => h.id === state.hairc)[0] || {}).sw || "");
        if (hex) Spirits.setBeadColor(item, hex);
      }
      return true;
    };
    // 第 2 步：按当前设定润色人设（有 Key 走 AI，没 Key 走本地模板）
    const polishPersona = async () => {
      const store = Spirits.load();
      const recN = Spirits.ensureIn(store, item.id);
      const lkNow = Spirits.lookOf(item, recN);
      const personaObj = recN.persona || Spirits.localPersona(item);
      const nm = spiritName(item, Spirits.load());
      const res = await Spirits.expandProfile(item, lkNow, Object.assign({}, personaObj, { name: nm }));
      return (res && res.text) || "";
    };
    const busy = (txt) => {
      modal.innerHTML = '<div class="look-confirm"><div class="look-confirm-head">⏳ ' + esc(txt) + "</div>" +
        '<div class="look-confirm-sub">通常只要几秒钟，别关掉就好…</div></div>';
      mask.hidden = false; modal.hidden = false; modal.style.display = "";
    };
    // 第 2 步面板：人设可编辑 + 可重润 + 可退回改设定
    const runStep2 = async () => {
      let repolish = false;
      for (let i = 0; i < 12; i++) {
        if (!state.persona || repolish) {
          busy(repolish ? "正在按新设定重写人设…" : "正在把你写的设定润色成人设…");
          try { state.persona = (await polishPersona()) || state.persona; } catch (e) { /* 保留原文本 */ }
          repolish = false;
          if (!state.persona) { toast("人设没生成出来，可以直接在这儿手写一段"); }
        }
        const html = '<div class="look-confirm">' +
          '<div class="look-confirm-head">📝 第 2 步 / 共 3 步 · 这是它的完整人设</div>' +
          '<div class="look-confirm-sub">我按你第 1 步写的东西润色成了下面这段。<b>哪里不对就直接点进去改</b> —— ' +
          '改好的这段会显示在它的详情页，也是下一步出图要求的依据。<br>' +
          '第 1 步改过设定、觉得这版不对，点「🪄 重新润色」。</div>' +
          '<textarea class="form-input setup-ta" id="lkPersona" rows="9" placeholder="（可以留空，我再按设定写一版）">' +
          esc(state.persona) + "</textarea>" +
          '<div class="look-confirm-actions three">' +
          '<button class="btn ghost" data-p-alt>← 返回改设定</button>' +
          '<button class="btn ghost" id="lkRepolish">🪄 重新润色</button>' +
          '<button class="btn primary" data-p-ok>就用它 →</button>' +
          "</div></div>";
        const res = await openEditPanel(
          html,
          (m) => ({ persona: ((m.querySelector("#lkPersona") || {}).value || "").trim() }),
          (m, finish) => { const rp = m.querySelector("#lkRepolish"); if (rp) rp.onclick = () => finish(false, false, "repolish"); }
        );
        if (res.ok) { state.persona = (res.values && res.values.persona) || state.persona; return "next"; }
        if (res.alt) return "back";
        if (res.tag === "repolish") { repolish = true; continue; }
        return "cancel";
      }
      return "cancel";
    };
    // 第 3 步：先落库人设 → 按人设提取出图要求 → 可编辑的出图单
    const runStep3 = async () => {
      try {
        const s3 = Spirits.load();
        const r3 = Spirits.ensureIn(s3, item.id);
        r3.look = Object.assign({}, r3.look || {}, { persona: state.persona, personaAt: Date.now() });
        Spirits.save(s3);
        const draft = Spirits.extractLookBrief(r3, item);
        const got = await briefPanel(item, draft, "🎨 第 3 步 / 共 3 步 · 出图设定");
        return got.ok ? "next" : "back";
      } catch (e) { return "back"; }
    };
    const finalize = async () => {
      const s4 = Spirits.load();
      const r4 = Spirits.ensureIn(s4, item.id);
      r4.lookAsked = 1;
      delete r4.setupPending;
      // 确认后重画：清掉旧立绘 / 旧 CG（CG 的 key 里有外观种子与服务商，显式清掉最稳）
      r4.imgUrl = ""; r4.imgAt = 0; r4.face = null; r4._imgErr = ""; r4._imgErrAt = 0; r4.imgFrozen = 0;
      r4.cgUrl = ""; r4.cgKey = ""; r4.cgStage = 0;
      // v166：设定确认后写回性别 —— 设计规定的 item.gender 优先；否则从用户写的设定文字认（少年郎→男 / 姑娘→女），
      //   这样「粉黛熊写了少年郎」就不会因为 born() 随机掷过而画成女孩。
      {
        const _g = (item && (item.gender === "boy" || item.gender === "girl"))
          ? item.gender
          : Spirits.genderFromText([(r4.look && (r4.look.base || r4.look.profile || r4.look.persona)), r4.personaZh, (r4.persona && r4.persona.name)].join(" "));
        if (_g) r4.gender = _g;
      }
      Spirits.save(s4);
      close();
      toast(spiritName(item, Spirits.load()) + "：人设和出图单都定好了，这就照单画 🎨");
      rerenderSpiritView();
      ensureSpiritLook([item]).then(() => ensureSpiritImages([item])).then(() => refreshCgAfter(item));
      if (o.onDone) o.onDone();
    };
    const startFlow = async () => {
      if (!collectStep1()) return;
      let step = 2;
      for (let guard = 0; guard < 24; guard++) {
        if (step === 2) {
          const r = await runStep2();
          if (r === "cancel") { close(); return; }
          if (r === "back") { renderStep1(); return; }
          step = 3;
        }
        if (step === 3) {
          const r = await runStep3();
          if (r === "next") { await finalize(); return; }
          step = 2;                          // 出图单不满意 → 退回改人设
        }
      }
    };
    // 先跳过（按自动的来）
    const doSkip = async () => {
      try {
        const s5 = Spirits.load();
        const r5 = Spirits.ensureIn(s5, item.id);
        if (!r5.look) r5.look = { ver: 1, hairc: "auto", feats: [], pers: "", base: "", ai: true, profile: "", at: Date.now() };
        r5.lookAsked = 1;
        delete r5.setupPending;
        r5.imgUrl = ""; r5.imgAt = 0; r5.face = null; r5._imgErr = ""; r5._imgErrAt = 0; r5.imgFrozen = 0;
        Spirits.save(s5);
        close();
        toast(spiritName(item, Spirits.load()) + "：先按自动的来，之后随时能改 ✨");
        rerenderSpiritView();
        ensureSpiritLook([item]).then(() => ensureSpiritImages([item])).then(() => refreshCgAfter(item));
        if (o.onDone) o.onDone();
      } catch (e) { toast("保存失败：" + ((e && e.message) || "")); close(); }
    };
    renderStep1();
  }

  /* ---------- 房间页 ---------- */
  /* ---------- v157：沁灵巷（本地动态 + 全镇概览；0 出图 0 模型调用） ---------- */
  function renderTownPage() {
    topbarTitle.textContent = "沁灵巷";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const list = spiritItems();
    const store = Spirits.load();
    const items = roomItems();
    const rooms = Rooms.listRooms();

    if (list.length < 2) {
      view.innerHTML = emptyCardHtml({
        ill: "spirit", icon: "🏘", title: "小镇还只有一位居民",
        sub: "再来一尊沁灵，小镇才会热闹起来<br>（住进同一间屋子的会慢慢熟络）",
        hint: "挂瓷开沁 → 把两只放进同一间屋子",
      }) + '<button class="btn primary" id="townBack" style="width:100%;margin-top:12px">回到沁灵页</button>';
      const b0 = $("#townBack");
      if (b0) b0.onclick = () => location.hash = "#/spirit";
      return;
    }

    const cast = list.map((it) => ({ id: it.id, name: nameOf(it, store), roomId: (store[it.id] || {}).roomId || "" }));
    const evs = Spirits.townEvents(cast, { n: 4 });

    // 全镇统计
    let pairs = 0, sum = 0, best = null;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const aff = Rooms.affinityOf(items[i].id, items[j].id);
      pairs++; sum += aff;
      if (!best || aff > best.aff) best = { aff: aff, a: items[i], b: items[j] };
    }
    const avg = pairs ? Math.round(sum / pairs) : 0;
    const homeless = list.filter((it) => !(store[it.id] || {}).roomId);

    let h = '<div class="town-head">' +
      '<div class="town-stat"><b>' + list.length + "</b><span>位居民</span></div>" +
      '<div class="town-stat"><b>' + rooms.length + "</b><span>间屋子</span></div>" +
      '<div class="town-stat"><b>' + avg + "</b><span>平均契合</span></div>" +
      "</div>";
    if (best && best.aff > 0) {
      h += '<div class="town-best">💞 全镇最合拍：<b>' + esc(nameOf(best.a, store)) + " × " + esc(nameOf(best.b, store)) +
        "</b> · 契合度 " + best.aff + "</div>";
    }

    h += '<div class="sd-card"><div class="sd-card-title">📰 今天的小镇' +
      '<small style="font-weight:400;color:var(--text-2);font-size:11px"> 每天换一批</small></div>';
    if (!evs.length) {
      h += '<div class="room-none">今天小镇很安静。</div>';
    } else {
      h += '<div class="town-feed">' + evs.map((e) => {
        const ia = items.find((x) => x.id === e.a), ib = items.find((x) => x.id === e.b);
        return '<div class="town-ev"><div class="town-ev-face">' +
          (ia ? spiritThumbHtml(ia, store[ia.id] || {}, 30) : "") +
          (ib ? spiritThumbHtml(ib, store[ib.id] || {}, 30) : "") +
          "</div>" +
          '<div class="town-ev-body"><div class="town-ev-text"><span class="town-ev-ico">' + esc(e.icon) + "</span>" + esc(e.text) + "</div>" +
          '<div class="town-ev-sub">' + (e.sameRoom ? "同一间屋子 · 住在一起" : "在院子里碰上") + "</div></div></div>";
      }).join("") + "</div>" +
        '<div class="room-hint">住在一起，它们慢慢就熟了 —— 熟了会有自己的故事。</div>';
    }
    h += "</div>";

    // 屋子
    // v165：用户实测「沁灵巷没有创建房间的入口了」—— 建房入口在本页就地提供（v163b 导航收敛后
    //   renderSpiritPage 已不再渲染房间区，故这里补一个；⛔ 不恢复旧房间列表，导航收敛的意图保持不变）。
    h += '<div class="sd-card"><div class="sd-card-title">🏠 小镇的屋子（' + rooms.length + "）" +
      '<button type="button" class="link-btn" id="townNewRoom" style="float:right;font-size:11px">＋ 新建房间</button></div>';
    if (!rooms.length) {
      h += '<div class="room-none">还没有屋子。点上面「＋ 新建房间」建一间，把沁灵放进去，它们就会开始熟络。</div>';
    } else {
      h += '<div class="room-grid">';
      rooms.forEach((r) => {
        const mem = Rooms.membersOf(r.id, items);
        const aff = Rooms.roomAffinity(r.id, items);
        h += '<div class="room-card" data-room="' + esc(r.id) + '">' +
          '<div class="room-head"><span class="room-emoji">' + esc(r.emoji || "🏠") + "</span>" +
          '<span class="room-name">' + esc(r.name) + "</span></div>" +
          '<div class="room-members">' +
          (mem.length ? mem.slice(0, 5).map((it) => spiritThumbHtml(it, store[it.id] || {}, 42)).join("")
            : '<span class="room-none">空着</span>') + "</div>" +
          '<div class="room-foot">' + (mem.length < 2 ? "住满 2 只，它们才会慢慢熟起来" : "💞 平均契合 " + aff.avg) + "</div></div>";
      });
      h += "</div>";
    }
    if (homeless.length) {
      h += '<div class="room-hint">🛏 还在屋檐下的：' + homeless.map((it) => esc(nameOf(it, store))).join("、") + " —— 点进屋子安排入住</div>";
    }
    h += "</div>";

    // v163b：房间剧情纵览（只读聚合，标来源屋，点进对应房间）
    if (typeof Rooms !== "undefined" && Rooms.storiesOfRoom) {
      const allStories = [];
      rooms.forEach((rm) => {
        const ss = Rooms.storiesOfRoom(rm.id) || [];
        ss.forEach((s) => allStories.push({ room: rm, s: s }));
      });
      if (allStories.length) {
        h += '<div class="sd-card"><div class="sd-card-title">📖 房间剧情纵览（' + allStories.length + '）</div>';
        h += allStories.slice(0, 12).map((o) => {
          const s = o.s, a = items.find((x) => x.id === s.pair[0]), b = items.find((x) => x.id === s.pair[1]);
          const nm = (a ? nameOf(a, store) : "?") + " × " + (b ? nameOf(b, store) : "?");
          return '<div class="story-row" data-room="' + esc(o.room.id) + '">' +
            '<div class="story-title">📖 ' + esc(nm) + '</div>' +
            '<div class="story-sub">' + esc(o.room.name) + ' · 第 ' + (s.story.level + 1) + ' 段</div></div>';
        }).join("");
        h += "</div>";
      }
    }

    // v163b：纪事墙（事件回顾 · O(n) 只读聚合）
    const allEvs = Spirits.allEvents(list, store);
    h += '<div class="sd-card"><div class="sd-card-title">📜 纪事墙（' + allEvs.length + '）' +
      '<button type="button" class="link-btn" id="townEvents" style="float:right;font-size:11px">看全部 ›</button></div>';
    if (!allEvs.length) h += '<div class="room-none">还没有什么大事发生 —— 盘串、过节、夜话都会留下痕迹。</div>';
    else h += '<div class="memo-line">' + allEvs.slice(0, 10).map((e) => {
      return '<div class="memo-row"><div class="memo-dot">' + (e.icon || "•") + '</div>' +
        '<div class="memo-body"><div class="memo-title">' + esc(e.title || "") + '</div>' +
        (e.summary ? '<div class="memo-text">' + esc(e.summary) + '</div>' : '') +
        '<div class="memo-sub">' + esc(Spirits.todayKey(Number(e.at))) +
        (e.ownerName ? ' · 来自〈' + esc(e.ownerName) + '〉' : '') + '</div></div></div>';
    }).join("") + '</div>';
    h += "</div>";

    // v163b：全主串 CG 墙（每只一行「已收 X / 8」+ 缩略图宫格）
    const albumSpirits = list.filter((it) => {
      const r = store[it.id] || {};
      return (r.cgs && typeof r.cgs === "object") ? Object.keys(r.cgs).some((k) => r.cgs[k] && r.cgs[k].hasImg) : false;
    });
    if (albumSpirits.length) {
      h += '<div class="sd-card"><div class="sd-card-title">🎬 全主串 CG 墙</div>';
      albumSpirits.forEach((it) => {
        const r = store[it.id] || {};
        const ids = Spirits.cgCollectedIds(r);
        h += '<div class="cg-wall-row"><div class="cg-wall-name">' + esc(nameOf(it, store)) + ' <small>' + ids.length + '/8</small></div><div class="cg-wall-grid">';
        ids.slice(0, 8).forEach((id) => {
          const m = Spirits.cgMetaOf(r, id);
          if (m && m.thumb) h += '<img class="cg-wall-thumb" data-cg="' + esc(m.thumb) + '" src="' + esc(m.thumb) + '" alt="">';
        });
        h += '</div></div>';
      });
      h += "</div>";
    }

    h += '<button class="btn ghost" id="townBack" style="width:100%;margin-top:10px">← 回到沁灵页</button>';
    view.innerHTML = h;
    bindSpiritImgFallback(view);
    const b1 = $("#townBack");
    if (b1) b1.onclick = () => location.hash = "#/spirit";
    view.querySelectorAll("[data-room]").forEach((c) => c.addEventListener("click", () => {
      location.hash = "#/room/" + encodeURIComponent(c.dataset.room);
    }));
    // v165：建房入口（复用房间设置弹窗，isNew 分支建完自动跳进新房间 #/room/<id>）
    const tr = $("#townNewRoom"); if (tr) tr.onclick = () => showRoomEditModal(null);
    const te = $("#townEvents"); if (te) te.onclick = () => location.hash = "#/events";
    view.querySelectorAll(".cg-wall-thumb[data-cg]").forEach((el) => el.onclick = () => openSpiritViewer(el.dataset.cg || ""));
  }

  /* ---------- v160：夜话（跨串大剧情 · 互动对话） ----------
     全本地剧本 + 本地状态机：0 出图、0 模型调用，怎么聊都不花额度。
     进度存在「第一位成员」（开沁最早的那只）的记录里 —— 跟着跨手机同步走。
     与「房间剧情（同屋两只小故事）」「主线·串与我（单串 8 章）」互不影响。 */
  let _nightFrom = "#/spirit";
  /* ---------- v162：夜话 2.0 —— 多会话（全家 / 房间 / 双人组）+ 事件触发 ---------- */
  function nightGroups() {
    try {
      const rooms = Rooms.listRooms();
      const its = roomItems();
      return rooms.map((r) => ({ id: r.id, name: r.name, items: Rooms.membersOf(r.id, its) }));
    } catch (e) { return []; }
  }
  let _nightMigrated = false;
  function nightNow() {
    const list = spiritItems();
    const store = Spirits.load();
    if (!_nightMigrated) {                       // 一次性迁移：老用户的 rec.night 搬进 rec.threads.family
      _nightMigrated = true;
      let dirty = false;
      Object.keys(store).forEach((k) => {
        const r = store[k];
        if (!r || typeof r !== "object" || r.__v162) return;
        Spirits.threadMigrate(r);
        dirty = true;
      });
      if (dirty) Spirits.save(store);
    }
    const threads = Spirits.nightThreads(list, store, { dayNo: 1, idleDays: 0, plays: 0 }, nightGroups());
    return { list: list, store: store, threads: threads };
  }
  function threadNow(tid) {
    const S = nightNow();
    const th = S.threads.filter((t) => t.id === tid)[0];
    if (!th) return null;
    const host = th.members[0];
    const rec = S.store[host.id] || {};
    const ctx = diaryCtx(host.item, rec);
    return { S: S, th: th, host: host, hostId: host.id, rec: rec, ctx: ctx, ev: Spirits.threadEvents(th, ctx, rec) };
  }
  function threadOpenCount(T) {
    if (!T) return 0;
    return T.ev.events.filter((e) => e.unlocked && !e.done).length;
  }
  // 头像组：最多画 max 个，剩下的用 +N —— 100 只串也不会撑爆
  function thAvatars(members, store, size, max) {
    const ms = (members || []).slice(0, max || 5);
    const rest = (members || []).length - ms.length;
    let h = ms.map((m) => spiritThumbHtml(m.item, store[m.id] || {}, size)).join("");
    if (rest > 0) h += '<div class="nt-av-more" style="width:' + size + "px;height:" + size + "px;font-size:" +
      Math.max(9, Math.round(size / 3)) + "px\">+" + rest + "</div>";
    return h;
  }
  function thLastText(T) {
    if (!T) return "";
    const evs = T.ev.events.filter((e) => e.unlocked && !e.done);
    if (evs.length) return "有新动静 · " + evs[0].icon + " " + evs[0].title;
    const br = Spirits.threadBrief(T.rec, T.th);
    if (br && !br.ended && br.last) return (br.last.w === "me" ? "我：" : (br.last.name ? br.last.name + "：" : "")) + String(br.last.text || "");
    if (br && br.ended && br.ending) return "刚聊完 · " + String(br.ending.name || "");
    return "";
  }

  function renderNightPage() {
    topbarTitle.textContent = "夜话";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const S = nightNow();
    if (!S.threads.length) {
      view.innerHTML = emptyCardHtml({
        ill: "spirit", icon: "📱", title: "还没有开沁的串",
        sub: "串挂瓷之后会「开沁」。夜里它们会借你的手机开群聊天 —— 你回一句，剧情就跟着你走。",
        hint: "先去把一串盘到挂瓷",
      });
      return;
    }
    let h = '<div class="room-hint" style="margin-bottom:10px">夜里它们借你的手机开了几个群。' +
      "你回一句，剧情就跟着你走 —— 每个事件都有 <b>3 个结尾</b>。</div>";
    const groups = [
      { title: "全家福", tip: "所有开沁的串都在这儿", arr: S.threads.filter((t) => t.kind === "family") },
      { title: "同屋小群", tip: "住在一个房间里的", arr: S.threads.filter((t) => t.kind === "room") },
      { title: "两个人的事", tip: "谁生日、谁跟谁性格对上了才出现", arr: S.threads.filter((t) => t.kind === "duo") },
    ];
    let openAll = 0;
    groups.forEach((g) => {
      if (!g.arr.length) return;
      h += '<div class="nt-sec"><span>' + esc(g.title) + "</span><small>" + esc(g.tip) + "</small></div>";
      h += '<div class="nt-list">';
      g.arr.forEach((t) => {
        const T = threadNow(t.id);
        const open = threadOpenCount(T);
        const evs = T ? T.ev.events : [];
        const doneN = evs.filter((e) => e.done).length;
        openAll += open;
        let sub = thLastText(T);
        if (!sub) sub = t.members.length + " 位成员";
        h += '<div class="nt-item' + (open ? " hot" : "") + '" data-tid="' + esc(t.id) + '">' +
          '<div class="nt-th-av">' + thAvatars(t.members, S.store, 30, 4) + "</div>" +
          '<div class="nt-item-body"><div class="nt-item-title">' + esc(t.name) +
          (open ? '<span class="nt-badge new">' + open + " 件新的</span>"
            : (doneN ? '<span class="nt-badge done">' + doneN + "/" + evs.length + "</span>" : "")) +
          "</div>" +
          '<div class="nt-item-sub">' + esc(sub) + "</div></div>" +
          '<span class="chap-arrow">›</span></div>';
      });
      h += "</div>";
    });
    if (openAll) h += '<div class="diary-hint">📱 有 <b>' + openAll + "</b> 件事可以聊了 · 点进去就开始</div>";
    else h += '<div class="diary-hint" style="color:var(--text-2)">🌙 今晚没动静。别急 —— 谁生日了、进门了、天晴了，它们会来找你。</div>';
    view.innerHTML = h;
    bindSpiritImgFallback(view);
    view.querySelectorAll("[data-tid]").forEach((el) => {
      el.onclick = () => {
        _nightFrom = "#/night";
        location.hash = "#/night/" + encodeURIComponent(el.dataset.tid);
      };
    });
  }

  /* ---------- 某个会话：成员 + 事件列表 ---------- */
  function renderThreadPage(tid) {
    const T = threadNow(tid);
    if (!T) { location.hash = "#/night"; return; }
    topbarTitle.textContent = T.th.name;
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const t = T.th;
    const evs = T.ev.events;
    const doneN = evs.filter((e) => e.done).length;
    let h = '<div class="nt-group">' +
      '<div class="nt-group-av">' + thAvatars(t.members, T.S.store, 40, 6) + "</div>" +
      '<div class="nt-group-meta"><div class="nt-group-name">' + esc(t.name) + "</div>" +
      '<div class="nt-group-sub">' + esc(t.members.map((m) => m.name).join("、")) + " · " + t.members.length + " 位成员</div></div>" +
      '<div class="nt-group-stat"><b>' + doneN + "</b>/" + evs.length + "<span>件事</span></div></div>";
    if (t.kind === "duo" && t.tag) h += '<div class="room-hint" style="margin-top:8px">' + esc(String(t.tag).trim()) + " · 这两个凑一块儿才有的事</div>";
    const open = threadOpenCount(T);
    if (open) h += '<div class="diary-hint">📱 有 <b>' + open + "</b> 件事可以聊了</div>";

    h += '<div class="nt-list" style="margin-top:10px">';
    evs.forEach((e) => {
      const tb = Spirits.threadTalkBrief(T.rec, t, e.id);
      if (!e.unlocked) {
        h += '<div class="nt-item locked"><span class="nt-item-ico">🔒</span>' +
          '<div class="nt-item-body"><div class="nt-item-title">' + esc(e.title) + "</div>" +
          '<div class="nt-item-sub">' + esc(e.need || "还没到时候") + "</div></div></div>";
        return;
      }
      const badge = e.done
        ? '<span class="nt-badge done">' + esc(e.done.name || "已聊完") + "</span>"
        : (tb.chat && !tb.ended && tb.last ? '<span class="nt-badge on">聊到一半</span>' : '<span class="nt-badge new">新</span>');
      const sub = (!e.done && tb.chat && !tb.ended && tb.last)
        ? ((tb.last.w === "me" ? "我：" : (tb.last.name ? tb.last.name + "：" : "")) + String(tb.last.text || ""))
        : esc(e.sub);
      h += '<div class="nt-item' + (e.done ? " done" : "") + '" data-ev="' + esc(e.id) + '">' +
        '<span class="nt-item-ico">' + esc(e.icon) + "</span>" +
        '<div class="nt-item-body"><div class="nt-item-title">' + esc(e.title) + badge + "</div>" +
        '<div class="nt-item-sub">' + sub + "</div></div>" +
        '<span class="chap-arrow">›</span></div>';
    });
    h += "</div>";
    h += '<button class="btn ghost" id="ntBackList" style="width:100%;margin-top:10px">← 全部会话</button>';
    view.innerHTML = h;
    bindSpiritImgFallback(view);
    view.querySelectorAll("[data-ev]").forEach((el) => {
      el.onclick = () => {
        _nightFrom = "#/night";
        location.hash = "#/night/" + encodeURIComponent(tid) + "/" + encodeURIComponent(el.dataset.ev);
      };
    });
    const bl = $("#ntBackList");
    if (bl) bl.onclick = () => { location.hash = "#/night"; };
  }

  /* ---------- 会话里的某个事件 → 对话页 ---------- */
  function renderNightTalkPage(tid, evid) {
    const T = threadNow(tid);
    if (!T) { location.hash = "#/night"; return; }
    const info = T.ev.events.filter((e) => e.id === evid)[0];
    if (!info || !info.unlocked) { location.hash = "#/night/" + encodeURIComponent(tid); return; }
    const slotOf = (w) => T.th.members.filter((m, i) => "ABC".charAt(i) === w)[0];
    const get = (fn) => {                        // 统一的「读 → 推进 → 存」小包装
      const s = Spirits.load();
      const rc = Spirits.ensureIn(s, T.hostId);
      const rr = fn(rc);
      Spirits.save(s);
      const st = (rc.threads && rc.threads[tid]) || null;
      const run = st && st.runs ? st.runs[evid] : null;
      return Object.assign(rr, { log: (run && run.log) || [] });
    };
    const evObj = Spirits.eventOf(evid);
    const cast = evObj ? castPreview(evObj, T.th) : T.th.members;
    return renderTalkPage({
      title: T.th.name,
      headAv: cast.map((c) => spiritThumbHtml(c.item, T.S.store[c.id] || {}, 30)).join(""),
      headName: T.th.name,
      headSub: info.icon + " " + info.title,
      listLabel: "全部会话", listHash: "#/night",
      av: (w) => {
        const m = cast.filter((c, i) => "ABC".charAt(i) === w)[0] || slotOf(w);
        return m ? spiritThumbHtml(m.item, T.S.store[m.id] || {}, 30) : "";
      },
      nameOf: (w) => { const m = cast.filter((c, i) => "ABC".charAt(i) === w)[0]; return m ? m.name : ""; },
      endTag: "这件事聊完了",
      endingExtra: () => {
        const open = threadOpenCount(threadNow(tid));
        return open
          ? '<div class="nt-end-final">📱 这个会话里还有 <b>' + open + "</b> 件事等着 —— 点「全部会话」接着聊。</div>"
          : '<div class="nt-end-final">🌙 这个会话暂时没什么事了。等谁生日了、进门了，它们还会来找你。</div>';
      },
      backLabel: "回会话", backHash: "#/night/" + encodeURIComponent(tid),
      enter: () => get((rc) => Spirits.threadEnter(T.host.item, rc, T.ctx, T.th, evid)),
      choose: (i) => get((rc) => Spirits.threadChoose(T.host.item, rc, T.ctx, T.th, i)),
      replay: () => get((rc) => Spirits.threadReplay(T.host.item, rc, T.ctx, T.th, evid)),
    });
  }
  // 头像预览用的主演（和 spirits 里 castFor 的规则保持一致）
  function castPreview(ev, th) {
    const ms = th.members || [];
    const need = Number(ev.cast) || 2;
    let star = null;
    if (ev.star === "occasion") { for (let i = 0; i < ms.length; i++) if (ms[i].occ) { star = ms[i]; break; } }
    else if (ev.star === "newest") { star = ms[ms.length - 1] || null; }
    if (star) return [star].concat(ms.filter((m) => m.id !== star.id).slice(0, Math.max(0, need - 1)));
    return ms.slice(0, need);
  }

  /* ---------- v161：通用对话页外壳（夜话 / 主线 共用） ----------
     o = {
       title,                       // 顶栏标题
       headAv, headName, headSub,   // 聊天页顶部的头像组 / 名字 / 副标题
       listLabel, listHash,         // 右上角「全部…」按钮（可省）
       av(w) → 头像 HTML, nameOf(w) → 说话人名字,
       enter() / choose(i) / replay()  → 都要返回 {added, choices, ending, ended, log}
       endTag, endingExtra(e), backLabel, backHash
     } */
  function renderTalkPage(o) {
    topbarTitle.textContent = o.title;
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    let r = o.enter();
    // v165：剧情页背景图层 —— 取章节映射里「已出图」的那张；没有就纯色/渐变兜底（⛔ 不阻塞、不出图）
    //   ⚠️ 用 typeof 守卫：renderTalkPage 会被单测以「抽函数 + 沙箱」方式隔离运行，此时 sceneBgUrl 不在作用域
    let _bgUrl = "";
    try { if (typeof sceneBgUrl === "function") _bgUrl = sceneBgUrl(o.bg); } catch (e) { _bgUrl = ""; }
    view.innerHTML = '<div class="nt-chat">' +
      '<div class="scenebg' + (_bgUrl ? "" : " noimg") + '" id="sceneBgLayer"></div>' +
      '<div class="nt-chat-head">' +
      '<div class="nt-head-av">' + o.headAv + "</div>" +
      '<div class="nt-head-meta"><b>' + esc(o.headName) + "</b><span>" + esc(o.headSub) + "</span></div>" +
      (o.listHash ? '<button class="link-btn" id="ntListBtn">' + esc(o.listLabel || "返回") + "</button>" : "") +
      "</div>" +
      '<div class="nt-body" id="ntBody"></div>' +
      '<div class="nt-foot" id="ntFoot"></div></div>';
    // 背景图 URL 走 JS 设值，避免把 base64/带参数的长 URL 拼进 HTML 属性里出错
    const _sbl = $("#sceneBgLayer");
    if (_sbl && _bgUrl) _sbl.style.backgroundImage = "url(" + JSON.stringify(_bgUrl) + ")";
    bindSpiritImgFallback(view);

    const body = $("#ntBody"), foot = $("#ntFoot");
    const msgHtml = (m) => {
      if (m.w === "sys") {
        let s = String(m.text || "");
        // v164f：夜话里写死的「HH:MM ——」时间戳，渲染时换成「点开这幕的真实时间」，跟用户打开剧情的时间同步
        s = s.replace(/^\d{1,2}:\d{2}\s*——\s*/, fmtTime(Date.now()) + " —— ");
        return '<div class="nt-sys">' + esc(s) + "</div>";
      }
      if (m.w === "me") return '<div class="nt-row me"><div class="nt-av nt-av-me">' + meAvatarHtml() + "</div>" +
        '<div class="nt-bub me">' + esc(m.text) + "</div></div>";
      // v165-N3：群像剧本的站位在 m.slot（L/C/R/B），旧剧本没有 ⇒ 回落 m.w，⛔ 老行为零变化
      return '<div class="nt-row"><div class="nt-av">' + o.av(m.slot || m.w, m) + "</div>" +
        '<div class="nt-col"><div class="nt-name">' + esc(m.name || o.nameOf(m.w) || "") + "</div>" +
        '<div class="nt-bub">' + esc(m.text) + "</div></div></div>";
    };
    // 把「已经说完的历史」直接铺开，最后留下的那几条走打字动画
    const paint = (rr) => {
      const hist = Array.isArray(rr.log) ? rr.log : [];
      body.innerHTML = hist.slice(0, Math.max(0, hist.length - rr.added.length)).map(msgHtml).join("") + '<div id="ntPend"></div>';
    };
    paint(r);
    let pend = $("#ntPend");
    const scrollEnd = () => { try { window.scrollTo(0, document.body.scrollHeight); } catch (e) { /* 忽略 */ } };

    // v163e：inflight = 已从 added 取出、但尚未显示的那条（三点气泡期间在途）。
    //   它的下标就是 qi-1；不显式记账的话，点跳过时它既不在 DOM 上、qi 又已前移 = 被吞掉
    let qi = 0, timer = 0, waiting = false, inflight = null;
    const append = (m) => {
      const d = document.createElement("div");
      d.innerHTML = msgHtml(m);
      const node = d.firstChild;
      if (node) { node.classList.add("nt-in"); body.insertBefore(node, pend); }
    };
    const endingHtml = (e) => '<div class="nt-end">' +
      '<div class="nt-end-tag">' + esc(o.endTag || "本段结束") + "</div>" +
      '<div class="nt-end-name">' + esc(e.name) + "</div>" +
      '<div class="nt-end-text">' + esc(e.text) + "</div>" +
      (o.endingExtra ? o.endingExtra(e) : "") +
      '<div class="nt-end-btns"><button class="btn ghost" id="ntAgain">再看一遍</button>' +
      '<button class="btn primary" id="ntBack">' + esc(o.backLabel || "返回") + "</button></div></div>";
    const replay = () => {
      if (waiting && !r.ended) return;      // 正在播就别打断
      waiting = false;
      clearTimeout(timer);
      inflight = null;                      // v163e：防御性清脏状态
      foot.innerHTML = "";
      r = o.replay();
      qi = 0;
      paint(r);
      pend = $("#ntPend");
      step();
    };
    const bindEnd = () => {
      const ag = $("#ntAgain");
      if (ag) ag.onclick = () => { if (ag.disabled) return; ag.disabled = true; replay(); };
      const bk = $("#ntBack");
      if (bk) bk.onclick = () => { location.hash = o.backHash; };
    };
    const showFoot = () => {
      if (waiting) return;
      waiting = true;
      pend.innerHTML = "";
      if (r.ending) { foot.innerHTML = endingHtml(r.ending); bindEnd(); }
      else if (r.choices && r.choices.length) {
        foot.innerHTML = '<div class="nt-ask">你的回复</div>' + r.choices.map((c, i) =>
          '<button class="nt-opt" data-i="' + i + '">' + esc(c.t) + "</button>").join("");
        foot.querySelectorAll(".nt-opt").forEach((b) => { b.onclick = () => pick(Number(b.dataset.i)); });
      } else { foot.innerHTML = ""; }
      scrollEnd();
    };
    const step = () => {
      if (qi >= r.added.length) { showFoot(); return; }
      const m = r.added[qi++];
      const dwell = talkDwell(m.text);     // v163d：按字长停留，别让所有气泡瞬间连成一片
      // v163d：整条一次性出现，不再逐字 —— 逐字每 45ms 重建整个 .nt-row，
      //   节点被销毁重建导致 .nt-row 的 320ms 入场动画永远播不完 = 闪烁
      if (m.w === "me") { append(m); scrollEnd(); timer = setTimeout(step, dwell); return; }    // 我自己那条立刻出现
      if (m.w === "sys") { append(m); scrollEnd(); timer = setTimeout(step, dwell); return; }   // 旁白不是"人在打字"，不给三点气泡
      pend.innerHTML = '<div class="nt-row"><div class="nt-av"></div>' +
        '<div class="nt-bub nt-typing"><i></i><i></i><i></i></div></div>';
      inflight = m;                        // v163e：记下在途消息（点跳过时要补回来）
      scrollEnd();
      // v163d：先显示"正在输入"三点气泡 TALK_LEAD_MS，再把整条弹出来，停 dwell 后出下一条
      timer = setTimeout(() => {
        inflight = null;                   // v163e：先清 —— 这条马上要显示了，别让随后的点击再补一次
        pend.innerHTML = "";
        append(m);
        scrollEnd();
        timer = setTimeout(step, dwell);
      }, TALK_LEAD_MS);
    };
    const pick = (i) => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(timer);
      inflight = null;                      // v163e：防御性清脏状态
      foot.innerHTML = "";
      r = o.choose(i);
      qi = 0;
      step();
    };
    // 点一下就能跳过打字（不想等的时候）
    body.addEventListener("click", () => {
      if (waiting) return;
      clearTimeout(timer);
      // v163e：先补回「正在输入」的那条（下标 = qi-1），再铺剩下的 —— 顺序反了会错序
      if (inflight) { pend.innerHTML = ""; append(inflight); inflight = null; }
      while (qi < r.added.length) append(r.added[qi++]);
      showFoot();
    });
    const lb = $("#ntListBtn");
    if (lb) lb.onclick = () => { location.hash = o.listHash; };
    step();
  }

  /* ---------- v165-N3：《沁灵纪》第 1–9 章 · **独立入口**（⛔ 不挂在某一只的详情页） ----------
     用户裁定：「以前的主线剧情，就是从每个沁灵的详情页进入那个，取消。全面用新的剧情来取代，走独立的入口。」
     · 入口放在**首页**（宝贝列表上方的大卡片，一眼能找到），路由 #/main
     · 章节对话页 #/maintalk/<i>；状态全在 ww_story（全局一条），⛔ 不进任何一只的 rec
     · 旧 8 章 CHAP_SCRIPTS / CHAPTERS 数据原样保留，只是入口取消了 */
  function mainStoryCtx() {
    // 全局天数：新主线是「一门人的故事」，不是某一只的 —— 取你陪得最久那只的天数
    let maxDay = 1;
    try {
      (allItems || []).forEach(function (x) {
        const d = Math.max(1, DB.daysWith(x) || 1);
        if (d > maxDay) maxDay = d;
      });
    } catch (e) { /* 静默 */ }
    return { dayNo: maxDay };
  }
  function mainCastThumb(m) {
    try {
      const pid = (m && m.ps && m.ps[0]) ? String(m.ps[0]) : "";
      if (!pid) return "";
      const cast = Spirits.castOf() || {};
      const c = cast[pid];
      if (!c || !c.id) return "";
      const it = spiritItemById(c.id);
      if (!it) return "";
      return spiritThumbHtml(it, Spirits.load()[c.id] || {}, 30);
    } catch (e) { return ""; }
  }
  function renderMainPage() {
    topbarTitle.textContent = "沁灵纪 · 主线";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    const ctx = mainStoryCtx();
    const list = Spirits.mainChapterState(ctx);
    const read = list.filter((c) => c.read).length;
    const unread = Spirits.mainUnreadCount(ctx);
    const brief = Spirits.mainTalkBrief();
    let h = '<div class="main-head">' +
      '<div class="main-head-icon">📖</div>' +
      '<div class="main-head-meta"><div class="main-head-title">沁灵纪 · 主线</div>' +
      '<div class="main-head-sub">九章 · 已看 ' + read + "/" + list.length +
      (Spirits.MAIN_STORY_OPEN ? "" : " · 正文装帧中") + "</div></div></div>" +
      '<div class="chap-prog"><i style="width:' + Math.round((read / Math.max(1, list.length)) * 100) + '%"></i></div>';
    h += '<div class="chap-list">';
    list.forEach((ch) => {
      if (!ch.unlocked) {
        h += '<div class="chap-item locked"><span class="chap-ico">🔒</span>' +
          '<div class="chap-body"><div class="chap-title">' + esc(ch.title) + "</div>" +
          '<div class="chap-need">' + esc(ch.need || "还没到时候") + "</div></div></div>";
        return;
      }
      const cur = !!(brief && !brief.ended && brief.chapId === ("m" + (ch.i + 1)));
      const lastLine = cur && brief.last ? brief.last : null;
      const sub = lastLine
        ? ((lastLine.w === "me" ? "我：" : "") + String(lastLine.text || ""))
        : (ch.read ? "点开可以再看一遍" : (ch.sub || ("第 " + ch.day + " 天 · 该发生了")));
      const badge = cur ? '<span class="nt-badge on">看到一半</span>'
        : (ch.read ? '<span class="chap-done">已看完</span>' : '<span class="chap-new">新</span>');
      h += '<div class="chap-item talk' + (ch.read ? "" : " unread") + '" data-main="' + ch.i + '">' +
        '<span class="chap-ico">' + esc(ch.icon) + "</span>" +
        '<div class="chap-body"><div class="chap-title">' + esc(ch.title) + badge + "</div>" +
        '<div class="chap-sub">' + esc(sub) + "</div></div>" +
        '<span class="chap-arrow">›</span></div>';
    });
    h += "</div>";
    if (unread) h += '<div class="chap-hint">📖 有 ' + unread + " 章新的 —— 你说的每一句都会记下来，影响后面的结局</div>";
    else if (!Spirits.MAIN_STORY_OPEN) h += '<div class="chap-hint">九章正文正在装帧 —— 入口先放在这儿，装好就能从第一章读起。</div>';
    view.innerHTML = h;
    view.querySelectorAll(".chap-item[data-main]").forEach((el) => {
      el.onclick = () => { location.hash = "#/maintalk/" + Number(el.dataset.main); };
    });
    window.scrollTo(0, 0);
  }
  function renderMainTalkPage(chIdx) {
    const i = Math.max(0, Number(chIdx) || 0);
    const ctx = mainStoryCtx();
    const list = Spirits.mainChapterState(ctx);
    const ch = list[i];
    if (!ch || !ch.unlocked) { location.hash = "#/main"; return; }
    const back = "#/main";
    return renderTalkPage({
      title: ch.title,
      headAv: '<span class="main-av">📖</span>',
      headName: "沁灵纪 · 第 " + (i + 1) + " 章",
      headSub: ch.icon + " 第 " + ch.day + " 天 · " + (ch.sub || ""),
      listLabel: "回到主线", listHash: back,
      bg: Spirits.bgForChapter("ch" + (i + 1)),   // 章节 → BG key（⛔ 未出图 = 渐变兜底，不出图）
      av: (w, m) => mainCastThumb(m) || '<span class="main-av">📿</span>',
      nameOf: () => "",                            // 群像剧本：说话人名字由行级 who 给（chapLine 已写进 m.name）
      endTag: "第 " + (i + 1) + " 章 · 完",
      endingExtra: () => (i === list.length - 1)
        ? '<div class="nt-end-final">🪢 九章走完了一遍。剩下的日子，就是每天在，每天亮一点。</div>' : "",
      backLabel: "回到主线", backHash: back,
      enter: () => Spirits.mainTalkEnter(ctx, i),
      choose: (k) => Spirits.mainTalkChoose(ctx, k),
      replay: () => Spirits.mainTalkReplay(ctx, i),
    });
  }

  /* ---------- v161：主线「串与我」· 对话页（单串，一章一聊） ----------
     v165-N3：⛔ **入口已按用户裁定取消**（不再挂在沁灵详情页）。
     函数与它依赖的 CHAP_SCRIPTS / CHAPTERS / chapTalk* 全部原样保留 —— 用户没让删数据。 */
  function renderChapTalkPage(spiritId, chIdx) {
    const i = Math.max(0, Number(chIdx) || 0);
    const it = spiritItems().filter((x) => String(x.id) === String(spiritId))[0];
    if (!it) { location.hash = "#/spirit"; return; }
    const act = Spirits.CHAP_ACTS[i];
    if (!act) { location.hash = "#/spirit/" + encodeURIComponent(it.id); return; }
    const st0 = Spirits.load();
    const rc0 = Spirits.ensureIn(st0, it.id);
    const ch = Spirits.chapterState(rc0, diaryCtx(it, rc0), roomCountOf(rc0))[i];
    if (!ch || !ch.unlocked) { location.hash = "#/spirit/" + encodeURIComponent(it.id); return; }
    const nm = nameOf(it, st0);
    const back = "#/spirit/" + encodeURIComponent(it.id);
    const get = (fn) => {
      const s = Spirits.load();
      const rc = Spirits.ensureIn(s, it.id);
      const rr = fn(rc);
      Spirits.save(s);
      return Object.assign(rr, { log: (rc.talk || {}).log || [] });
    };
    return renderTalkPage({
      title: act.title,
      headAv: spiritThumbHtml(it, rc0, 30),
      headName: nm,
      headSub: act.icon + " " + act.volName + " · 第 " + (i + 1) + " 章",
      listLabel: "回到它", listHash: back,
      bg: Spirits.bgForChapter("ch" + (i + 1)),   // v165：章节 → BG key 映射（卷一 ch1–ch5；未覆盖 = 渐变兜底）
      av: () => spiritThumbHtml(it, rc0, 30),
      nameOf: () => nm,
      endTag: "第 " + (i + 1) + " 章 · 完",
      endingExtra: () => (i === Spirits.CHAP_ACTS.length - 1)
        ? '<div class="nt-end-final">🪢 主线到这里就走完了一遍。以后没有新章了 —— 剩下的日子，就是每天在，每天亮一点。</div>' : "",
      backLabel: "回到它", backHash: back,
      enter: () => get((rc) => Spirits.chapTalkEnter(it, rc, diaryCtx(it, rc), i)),
      choose: (k) => get((rc) => Spirits.chapTalkChoose(it, rc, diaryCtx(it, rc), k)),
      replay: () => get((rc) => Spirits.chapTalkReplay(it, rc, diaryCtx(it, rc), i)),
    });
  }
  function renderRoomPage(roomId) {
    const room = Rooms.getRoom(roomId);
    if (!room) { location.hash = "#/spirit"; return; }
    topbarTitle.textContent = room.name;
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    tickRooms();          // 进房间页也推进一次契合度/补写剧情（v114）
    const store = Spirits.load();
    const items = roomItems();
    const mem = Rooms.membersOf(roomId, items);
    const stories = Rooms.storiesOfRoom(roomId);

    let h = '<div class="room-page-head"><span class="room-emoji big">' + esc(room.emoji || "🏠") + "</span>" +
      '<div class="room-page-meta"><div class="room-page-name">' + esc(room.name) + "</div>" +
      '<div class="room-page-sub">' + mem.length + " 只沁灵住在里面 · 共 " + stories.length + " 段剧情</div></div>" +
      '<button class="link-btn" id="rmEdit">✏️ 设置</button></div>';

    h += '<div class="sd-card"><div class="sd-card-title">🛏 住在这里的沁灵（' + mem.length + "）" +
      '<button class="link-btn" id="rmAdd" style="float:right">＋ 请沁灵入住</button></div>';
    if (!mem.length) h += '<div class="room-none">房间还空着，点右上角「＋ 请沁灵入住」安排入住。</div>';
    else h += '<div class="room-mem-grid">' + mem.map((it) => {
      const rec = store[it.id] || {};
      const si = Spirits.stageInfo(it, rec.stage, DB.daysWith(it));
      return '<div class="room-mem" data-sp="' + esc(it.id) + '">' + spiritThumbHtml(it, rec, 56) +
        '<div class="room-mem-name">' + esc(nameOf(it, store)) + "</div>" +
        '<div class="room-mem-sub">' + si.icon + esc(si.name) + "</div></div>";
    }).join("") + "</div>";
    h += "</div>";

    if (mem.length >= 2) {
      h += '<div class="sd-card"><div class="sd-card-title">💞 契合度</div>';
      for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) {
        const a = mem[i], b = mem[j];
        const aff = Rooms.affinityOf(a.id, b.id), li = Rooms.levelInfo(aff);
        h += '<div class="aff-row"><div class="aff-head"><span>' + esc(nameOf(a, store)) + " × " + esc(nameOf(b, store)) +
          '</span><span class="aff-num">' + aff + " · " + esc(li.levelName) + "</span></div>" +
          '<div class="room-track big"><i style="width:' + li.pct + '%"></i></div>' +
          '<div class="aff-sub">' + (li.next == null ? "已经是最懂彼此的那一档了 👑" : "再多住些日子，会有新故事") + "</div></div>";
      }
      h += "</div>";
    } else {
      h += '<div class="sd-card"><div class="room-none">至少要有 2 只沁灵，才会开始攒契合度。</div></div>';
    }

    h += '<div class="sd-card"><div class="sd-card-title">📖 剧情（' + stories.length + "）" +
      (stories.some((s) => s.story && s.story.img) ? '<button class="link-btn" id="rmManageCg" style="float:right">🗑 管理双人 CG</button>' : "") + "</div>";
    if (!stories.length) h += '<div class="room-none">它们还没熟到会讲故事的程度。</div>';
    else h += stories.map((s) => {
      const a = items.find((x) => x.id === s.pair[0]), b = items.find((x) => x.id === s.pair[1]);
      const nm = (a ? nameOf(a, store) : "") + " × " + (b ? nameOf(b, store) : "");
      const unread = s.story.text && !s.story.read;
      return '<div class="story-row' + (unread ? " unread" : "") + '" data-story="' + esc(s.key) + '" data-level="' + s.story.level + '">' +
        '<div class="story-title">' + (unread ? "🔴 " : "📖 ") + esc(nm) + "</div>" +
        '<div class="story-sub">第 ' + (s.story.level + 1) + " 段" + (s.story.text ? " · 点开看故事" : " · 正在酝酿…") + "</div></div>";
    }).join("");
    if (stories.some((s) => s.story.text && !s.story.read)) h += '<div class="room-hint">🔴 有新剧情，点开才算看过哦</div>';
    h += "</div>";

    h += '<button class="btn ghost" id="rmBack" style="width:100%;margin-top:10px">← 回到沁灵列表</button>';
    view.innerHTML = h;
    bindSpiritImgFallback(view);
    const eb = $("#rmEdit"); if (eb) eb.onclick = () => showRoomEditModal(room);
    const ab = $("#rmAdd"); if (ab) ab.onclick = () => showSpiritPicker(room.id);
    const bk = $("#rmBack"); if (bk) bk.onclick = () => location.hash = "#/spirit";
    const rmc = $("#rmManageCg"); if (rmc) rmc.onclick = () => openRoomCgManager(roomId);
    view.querySelectorAll("[data-sp]").forEach((el) => el.onclick = () => { location.hash = "#/spirit/" + encodeURIComponent(el.dataset.sp); });
    view.querySelectorAll("[data-story]").forEach((el) => el.onclick = () => {
      showStoryModal(el.dataset.story, +el.dataset.level);
    });
  }

  /* ---------- 剧情阅读 ---------- */
  function showStoryModal(pairKey, level) {
    const parts = String(pairKey).split("|");
    const bd = Rooms.bondOf(parts[0], parts[1]);
    if (!bd) return;
    const st = (bd.stories || []).filter((s) => s.level === level)[0];
    if (!st || !st.text) { toast("这段剧情还在酝酿…"); return; }
    const store = Spirits.load();
    const a = spiritItemById(parts[0]), b = spiritItemById(parts[1]);
    const room = Rooms.getRoom(st.roomId) || { name: "它们的小房间", emoji: "🏠" };
    const mask = $("#modalMask"), modal = $("#modal");
    modal.innerHTML = "<h3>" + esc(room.emoji || "🏠") + " " + esc(room.name) + "</h3>" +
      '<div style="font-size:12px;color:var(--text-2);text-align:center;margin-bottom:10px">' +
      esc((a ? nameOf(a, store) : "?") + " × " + (b ? nameOf(b, store) : "?")) + " · 第 " + (level + 1) + " 段</div>" +
      (st.img ? '<img class="story-cg" src="' + esc(st.img) + '" alt="事件 CG">' : "") +
      '<div class="story-text">' + esc(st.text).replace(/\n/g, "<br>") + "</div>" +
      // v165-R2：双人事件 CG 也走「描述先行」（⛔ 绝不自动出图）
      (!st.img ? ('<div class="cg-brief" style="text-align:left">' +
        '<div class="cg-brief-tip">想给这段配一张 CG？先看看要画什么，描述可以改，改满意了再出图（消耗 1 次额度）</div>' +
        '<textarea class="cg-brief-ta" id="stCgBrief" rows="4" placeholder="点「🔤 生成画面描述」，或者自己写">' +
        esc(st.brief || "") + "</textarea>" +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn ghost" id="stCgGen" style="flex:1">🔤 生成画面描述</button>' +
        '<button class="btn primary" id="stCgDraw" style="flex:1">🎬 按这段描述出图</button>' +
        "</div></div>") : "") +
      '<button class="btn primary" id="storyOk" style="width:100%;margin-top:14px">看完了</button>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    const done = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    const spA = a ? spiritSp(a) : null, spB = b ? spiritSp(b) : null;
    const stTa = $("#stCgBrief");
    const stGen = $("#stCgGen");
    if (stGen) stGen.onclick = async () => {
      stGen.disabled = true; stGen.textContent = "正在写描述…";
      try {
        const br = await genCgBrief({
          kind: "pair", a: spA, b: spB, level: level, roomName: room.name, storyText: st.text,
        });
        if (stTa) stTa.value = br;
        Rooms.setStoryBrief(parts[0], parts[1], level, br);
      } catch (e) { toast("描述生成失败：" + ((e && e.message) || "请稍后再试")); }
      stGen.disabled = false; stGen.textContent = "🔤 生成画面描述";
    };
    const stDraw = $("#stCgDraw");
    if (stDraw) stDraw.onclick = async () => {
      const brief = String((stTa && stTa.value) || "").trim();
      if (!brief) { toast("先写一段描述，或者点「🔤 生成画面描述」"); return; }
      Rooms.setStoryBrief(parts[0], parts[1], level, brief);      // ① 存确认后的描述
      stDraw.disabled = true; stDraw.textContent = "正在画…（约 15-20 秒）";
      try {
        const sS = Spirits.load();
        const _rA = sS && sS[parts[0]], _rB = sS && sS[parts[1]];
        const out = await drawCgFromBrief(brief, {                // ② 手动出图（横版 + ref）
          kind: "pair", a: spA, b: spB, level: level, roomName: room.name,
          stage: Math.max(Number((_rA && _rA.stage) || 1), Number((_rB && _rB.stage) || 1)),
          seedKey: Rooms.pairKey(parts[0], parts[1]) + "#cg" + level, variant: 0,
          ref: "",
        });
        if (out.url) {
          Rooms.setStoryImage(parts[0], parts[1], level, out.url);
          try { localStorage.setItem("ww_gen_total", String(Number(localStorage.getItem("ww_gen_total") || "0") + 1)); } catch (e2) { /* 忽略 */ }
          toast("🎬 事件 CG 画好了");
          showStoryModal(pairKey, level);
        }
      } catch (e) {
        stDraw.disabled = false; stDraw.textContent = "🎬 重试（消耗 1 次出图额度）";
        toast("出图失败：" + ((e && e.message) || "请稍后再试"));
      }
    };
    $("#storyOk").onclick = () => {
      Rooms.markRead(parts[0], parts[1], level);
      done();
      updateStoryDot();
      const h = location.hash;
      if (h.indexOf("#/room/") === 0) renderRoomPage(decodeURIComponent(h.slice(7)));
      else if (h === "#/spirit") renderSpiritPage();
    };
    mask.onclick = done;
  }

  /* ---------- 房间设置（新建 / 改名 / 成员 / 删除） ---------- */
  function showRoomEditModal(room) {
    const mask = $("#modalMask"), modal = $("#modal");
    const isNew = !room;
    const items = roomItems();
    const mem = room ? Rooms.membersOf(room.id, items) : [];
    modal.innerHTML = "<h3>" + (isNew ? "🏠 新建小房间" : "🏠 房间设置") + "</h3>" +
      '<div class="form-group"><div class="form-label">房间名</div>' +
      '<input class="form-input" id="rmName" maxlength="8" placeholder="如：窗边小桌" value="' + esc(room ? room.name : "") + '"></div>' +
      '<div class="form-group"><div class="form-label">房间图标</div><div class="prov-row" id="rmEmojiRow">' +
      Rooms.ROOM_EMOJIS.map((e) => '<button type="button" class="prov-chip' + ((room ? room.emoji : "🏠") === e ? " active" : "") +
        '" data-emoji="' + e + '">' + e + "</button>").join("") + "</div></div>" +
      (isNew ? "" : '<div class="form-group"><div class="form-label">住在这里（' + mem.length + '）<small>点名字可以搬出去</small></div>' +
        '<div class="prov-row">' + (mem.length ? mem.map((it) => '<button type="button" class="prov-chip" data-out="' + esc(it.id) + '">' +
          esc(nameOf(it, Spirits.load())) + " ✕</button>").join("") : '<span style="font-size:12px;color:var(--text-2)">还没有沁灵入住</span>') + "</div></div>") +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn ghost" id="rmCancel" style="flex:1">取消</button>' +
      (isNew ? "" : '<button class="btn danger" id="rmDel" style="flex:1">删除房间</button>') +
      '<button class="btn primary" id="rmSave" style="flex:1">保存</button></div>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    let emoji = room ? room.emoji : "🏠";
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    modal.querySelectorAll("[data-emoji]").forEach((b) => b.onclick = () => {
      emoji = b.dataset.emoji;
      modal.querySelectorAll("[data-emoji]").forEach((x) => x.classList.toggle("active", x === b));
    });
    modal.querySelectorAll("[data-out]").forEach((b) => b.onclick = () => {
      setSpiritRoom(b.dataset.out, "");
      close();
      toast("已搬出去");
      renderRoomPage(room.id);
    });
    $("#rmCancel").onclick = close;
    mask.onclick = close;
    if (!isNew) $("#rmDel").onclick = async () => {
      const yes = await confirmModal("删除「" + room.name + "」？", "房间里的沁灵会变成「未入住」，沁灵本身和立绘都不受影响。", "删除", true);
      if (!yes) { showRoomEditModal(room); return; }
      const ids = Rooms.membersOf(room.id, roomItems()).map((x) => x.id);
      ids.forEach((id) => setSpiritRoom(id, ""));
      Rooms.removeRoom(room.id);
      toast("房间已删除");
      location.hash = "#/spirit";
    };
    $("#rmSave").onclick = () => {
      const name = ($("#rmName").value || "").trim();
      if (isNew) {
        const r = Rooms.createRoom(name, emoji);
        toast("房间建好了：" + r.emoji + r.name);
        close();
        location.hash = "#/room/" + encodeURIComponent(r.id);
      } else {
        Rooms.updateRoom(room.id, { name: name || room.name, emoji: emoji });
        toast("已保存");
        close();
        renderRoomPage(room.id);
      }
    };
  }

  /* ---------- 选沁灵放进房间 ---------- */
  function showSpiritPicker(roomId) {
    const mask = $("#modalMask"), modal = $("#modal");
    const items = roomItems();
    const store = Spirits.load();
    const inRoom = items.filter((x) => x.roomId === roomId);
    const others = items.filter((x) => x.roomId !== roomId);
    modal.innerHTML = "<h3>＋ 请沁灵入住</h3>" +
      '<p style="font-size:12px;color:var(--text-2);text-align:center;margin-bottom:10px">点一下放进这间房（一尊沁灵同时只住一间）</p>' +
      '<div class="pick-list">' + (others.length ? others.map((it) => {
        const rec = store[it.id] || {};
        const si = Spirits.stageInfo(it, rec.stage, DB.daysWith(it));
        const where = it.roomId ? (Rooms.getRoom(it.roomId) || {}).name : "未入住";
        return '<div class="pick-row" data-pick="' + esc(it.id) + '">' + spiritThumbHtml(it, rec, 44) +
          '<div class="pick-meta"><div class="pick-name">' + esc(nameOf(it, store)) + " " + si.icon + "</div>" +
          '<div class="pick-sub">现在在：' + esc(where || "未入住") + "</div></div>" +
          '<span class="pick-go">放入 ›</span></div>';
      }).join("") : '<div class="room-none">所有沁灵都在这间房里了</div>') + "</div>" +
      '<button class="btn ghost" id="pickCancel" style="width:100%;margin-top:12px">关闭</button>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    modal.querySelectorAll("[data-pick]").forEach((el) => el.onclick = () => {
      setSpiritRoom(el.dataset.pick, roomId);
      close();
      toast("已经住进来啦 🏠");
      renderRoomPage(roomId);
      updateStoryDot();
    });
    $("#pickCancel").onclick = close;
    mask.onclick = close;
  }
  // 从沁灵详情页选房间
  function showSpiritRoomPicker(it) {
    const mask = $("#modalMask"), modal = $("#modal");
    const rooms = Rooms.listRooms();
    const cur = (spiritRecOf(it.id) || {}).roomId || "";
    modal.innerHTML = "<h3>🏠 安排房间</h3>" +
      '<p style="font-size:12px;color:var(--text-2);text-align:center;margin-bottom:10px">和同屋的沁灵会慢慢攒契合度</p>' +
      '<div class="pick-list">' +
      rooms.map((r) => {
        const n = Rooms.membersOf(r.id, roomItems()).length;
        return '<div class="pick-row" data-room-pick="' + esc(r.id) + '">' +
          '<span class="room-emoji">' + esc(r.emoji || "🏠") + "</span>" +
          '<div class="pick-meta"><div class="pick-name">' + esc(r.name) + "</div>" +
          '<div class="pick-sub">' + n + " 只沁灵" + (cur === r.id ? " · 现在住这里" : "") + "</div></div>" +
          '<span class="pick-go">' + (cur === r.id ? "已在此 ›" : "入住 ›") + "</span></div>";
      }).join("") +
      '<div class="pick-row" data-room-pick=""><span class="room-emoji">🚪</span>' +
      '<div class="pick-meta"><div class="pick-name">搬出去（不入住）</div><div class="pick-sub">仍是你的沁灵，只是不攒契合度</div></div>' +
      '<span class="pick-go">›</span></div>' +
      '<div class="pick-row" data-new-room="1"><span class="room-emoji">＋</span>' +
      '<div class="pick-meta"><div class="pick-name">新建一间房</div><div class="pick-sub">给它们一个新地方</div></div><span class="pick-go">›</span></div>' +
      "</div>" +
      '<button class="btn ghost" id="srCancel" style="width:100%;margin-top:12px">关闭</button>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    modal.querySelectorAll("[data-room-pick]").forEach((el) => el.onclick = () => {
      setSpiritRoom(it.id, el.dataset.roomPick);
      close();
      toast(el.dataset.roomPick ? "已经住进房间啦 🏠" : "已搬出去");
      renderSpiritDetailPage(it.id);
    });
    const nr = modal.querySelector("[data-new-room]");
    if (nr) nr.onclick = () => { close(); showRoomEditModal(null); };
    $("#srCancel").onclick = close;
    mask.onclick = close;
  }

  /* ---------- 立绘大图 ---------- */
  function openSpiritViewer(src) {
    const viewer = $("#viewer");
    if (!viewer || !src) return;
    viewer.hidden = false;
    viewer.classList.add("show");
    $("#viewerImg").src = src;
    $("#viewerNav").innerHTML = "";
    $("#viewerClose").onclick = () => { viewer.classList.remove("show"); viewer.hidden = true; };
    viewer.onclick = (e) => { if (e.target === viewer) { viewer.classList.remove("show"); viewer.hidden = true; } };
  }

  /* ---------- 出图报错的"人话翻译"（v123）：把各家最常见的几种失败原因直接说清楚 ---------- */
  function imageErrHint(msg, provider) {
    const m = String(msg || "");
    if (Spirits.isFetchFail(m)) {
      return "这个错几乎都是 <b>API Key 不对</b>：方舟在 key 无效时不返回跨域头，浏览器只能报 Failed to fetch。<br>" +
        "① 确认填的是 <b>ark- 开头</b>的密钥本体（不是 api-key-… 那个<b>名称</b>）；<br>" +
        "② 确认<b>复制完整</b>：控制台显示成 <code>ark-xxxxxxxx-…</code> 是截断显示，手选会少一截 → 点「📋 复制」；<br>" +
        "③ 确认这把 key 属于<b>当前这个账号</b>（换了账号就要换 key）。";
    }
    if (/ModelNotOpen|not activated|未开通|未激活|access denied|AccessDenied|forbidden|403/i.test(m)) {
      return "模型没开通 / 被暂停了：去火山控制台 <b>开通管理</b> 确认这个模型是「已开通」；<br>" +
        "如果你开过「<b>安心体验</b>」（用量超过免费额度时自动暂停、避免扣费），充值后要点它旁边的「<b>前往关闭</b>」才能继续用。";
    }
    if (/quota|exceed|insufficient|balance|arrears|额度|余额|欠费|限流|rate/i.test(m)) {
      return "额度/余额不足或被限流：去控制台看「账户余额」（flash 约 ¥0.12-0.13/张，充 ¥10 ≈ 80 张）。<br>" +
        "另外「安心体验」开着时，超出免费额度会<b>自动暂停</b> → 需要点「前往关闭」。";
    }
    if (/401|Unauthorized|invalid[_ ]?(api)?[_ ]?key|authentication/i.test(m)) {
      return "key 无效：确认是 <b>ark- 开头</b>那一串、且整串复制完整（含末尾那一小段）。";
    }
    if (/NotFound|does not exist|InvalidEndpointOrModel/i.test(m)) {
      return "模型名不对：控制台显示名（如 Doubao-Seedream-5.0-flash 260915）不能直接用，要填 API 模型 ID（<b>doubao-seedream-5-0-flash-260915</b>）或接入点 <b>ep-…</b>。";
    }
    if (/size|尺寸|resolution/i.test(m)) {
      return "尺寸不合法：App 会自动换一档重试；仍失败就手动换一个尺寸（方舟用 1728x2304 / 2048x2048）。";
    }
    if (/watermark|水印/i.test(m)) {
      return "水印参数被拒：App 会自动去掉该参数重试，正常不影响出图。";
    }
    return "把这段红字发我，我帮你看。";
  }

  /* ---------- 主人头像：选一张本地图，压成 128px 方图存进档案（群聊里用） ---------- */
  function pickOwnerAvatar(cb) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          const S = 128;
          const cv = document.createElement("canvas");
          cv.width = S; cv.height = S;
          const g = cv.getContext("2d");
          const side = Math.min(im.width, im.height);
          g.drawImage(im, (im.width - side) / 2, (im.height - side) / 2, side, side, 0, 0, S, S);
          try { cb(cv.toDataURL("image/jpeg", 0.82)); } catch (e) { toast("这张图读不出来，换一张试试"); }
        };
        im.onerror = () => toast("这张图读不出来，换一张试试");
        im.src = String(fr.result);
      };
      fr.onerror = () => toast("这张图读不出来，换一张试试");
      fr.readAsDataURL(f);
    };
    inp.click();
  }
  // 「我」的头像：没设就显示一个「我」字
  function meAvatarHtml() {
    const a = Spirits.getOwner().avatar;
    return a ? '<img src="' + esc(a) + '" alt="我" style="width:100%;height:100%;object-fit:cover;display:block">' : "我";
  }

  function showOwnerModal() {
    const mask = $("#modalMask"), modal = $("#modal");
    const ow = Spirits.getOwner();
    let avatar = ow.avatar;
    modal.innerHTML = "<h3>👤 主人设定</h3>" +
      '<p style="font-size:12px;color:var(--text-2);line-height:1.7;margin-bottom:12px;text-align:center">' +
      "沁灵写日记、写剧情、聊天时都会照这里来称呼你，别让它们把你写成另一个性别 😆</p>" +
      '<div class="form-group"><div class="form-label">昵称 <small>它们会这么叫你</small></div>' +
      '<input class="form-input" id="ownName" maxlength="12" placeholder="如：小北" value="' + esc(ow.name || "") + '"></div>' +
      '<div class="form-group"><div class="form-label">我是</div><div class="prov-row" id="ownGenderRow">' +
      '<button type="button" class="prov-chip' + (ow.gender !== "boy" ? " active" : "") + '" data-g="girl">👩 女生（用「她」）</button>' +
      '<button type="button" class="prov-chip' + (ow.gender === "boy" ? " active" : "") + '" data-g="boy">👨 男生（用「他」）</button>' +
      "</div></div>" +
      '<div class="form-group"><div class="form-label">我的头像 <small>它们在群里看到的你</small></div>' +
      '<div style="display:flex;align-items:center;gap:11px">' +
      '<div id="ownAvPrev" class="nt-av nt-av-me" style="width:46px;height:46px;flex:none;font-size:13px">' + meAvatarHtml() + "</div>" +
      '<div style="flex:1;display:flex;gap:6px">' +
      '<button type="button" class="btn ghost" id="ownAvPick" style="flex:1">选一张</button>' +
      '<button type="button" class="btn ghost" id="ownAvClear" style="flex:1">移除</button>' +
      "</div></div></div>" +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn ghost" id="ownCancel" style="flex:1">取消</button>' +
      '<button class="btn primary" id="ownSave" style="flex:2">保存</button></div>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    let gender = ow.gender;
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    modal.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => {
      gender = b.dataset.g;
      modal.querySelectorAll("[data-g]").forEach((x) => x.classList.toggle("active", x === b));
    });
    $("#ownCancel").onclick = close;
    mask.onclick = close;
    const paintAvatar = () => {
      const p = $("#ownAvPrev");
      if (p) p.innerHTML = avatar ? '<img src="' + esc(avatar) + '" alt="我" style="width:100%;height:100%;object-fit:cover;display:block">' : "我";
    };
    if ($("#ownAvPick")) $("#ownAvPick").onclick = () => pickOwnerAvatar((d) => { avatar = d; paintAvatar(); });
    if ($("#ownAvClear")) $("#ownAvClear").onclick = () => { avatar = ""; paintAvatar(); };
    $("#ownSave").onclick = () => {
      Spirits.setOwner({ name: ($("#ownName").value || "").trim(), gender: gender, avatar: avatar });
      close();
      toast("已保存：以后它们会用「" + (gender === "boy" ? "他" : "她") + "」称呼你");
      renderSettings();
    };
  }

  /* ---------- 沁灵聊天（独立弹层，详情页用） ---------- */
  function showSpiritChatModal(item) {
    const mask = $("#modalMask"), modal = $("#modal");
    modal.innerHTML = "<h3>💬 它们聊天</h3><div id=" + '"spChatOut"' + '><div class="spirit-loading">沁灵们正在凑到一起…</div></div>' +
      '<button class="btn ghost" id="chatClose" style="width:100%;margin-top:12px">关闭</button>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    const close = () => { mask.hidden = true; modal.hidden = true; modal.style.display = ""; };
    $("#chatClose").onclick = close;
    mask.onclick = close;
    (async () => {
      const out = $("#spChatOut");
      if (!out) return;
      const all = spiritItems();
      const others = all.filter((x) => x.id !== item.id).sort(() => Math.random() - 0.5).slice(0, 2);
      const group = [item].concat(others).map((it) => {
        const rec = Spirits.load()[it.id] || {};
        // 名字优先用用户改过的（聊天气泡与 AI 提示词都用新名字）
        const persona = Object.assign({}, rec.persona || Spirits.localPersona(it), { name: spiritName(it, Spirits.load()) });
        return { item: it, persona: persona, avatar: rec.imgUrl || Spirits.localAvatarSvg(it) };
      });
      const lines = await Spirits.chat(group);
      const avatarOf = (who) => {
        const w = String(who || "").trim();
        if (!w) return null;
        // 1) 精确相等（说话人 == 名字）
        let hit = group.find((g) => (g.persona.name || "") === w);
        // 2) 名字是这句话的开头（如 "团子说：…" → 团子），优先匹配更长的名字，避免 "团" 抢走 "团子"
        if (!hit) {
          const cands = group.filter((g) => g.persona.name && w.indexOf(g.persona.name) === 0);
          cands.sort((a, b) => b.persona.name.length - a.persona.name.length);
          hit = cands[0];
        }
        // 3) 名字出现在句中（兜底）
        if (!hit) hit = group.find((g) => g.persona.name && w.indexOf(g.persona.name) >= 0);
        if (!hit) hit = group.find((g) => (g.item.name || "") === w);
        return hit ? { url: hit.avatar, name: hit.persona.name || hit.item.name } : null;
      };
      const o2 = $("#spChatOut");
      if (!o2) return;
      o2.innerHTML = '<div class="spirit-chat">' + lines.map((l, i) => {
        const a = avatarOf(l.who);
        return '<div class="spirit-row' + (i % 2 ? " alt" : "") + '">' +
          '<img class="spirit-avatar" src="' + esc(a ? a.url : Spirits.localAvatarSvg(item)) + '" alt="">' +
          '<div class="spirit-bubble"><span class="spirit-who">' + esc(l.who) + "</span>" + esc(l.text) + "</div></div>";
      }).join("") + "</div>";
    })();
  }

  // 补齐性格（一次把缺的都补上，再统一刷新）
  let _spiritBusy = false;
  async function ensureSpiritData(list) {
    if (_spiritBusy) return;
    _spiritBusy = true;
    try {
      // 1) 补齐所有缺性格的沁灵（无 key 时是本地模板，很快）
      let changed = false;
      for (const it of list) {
        const s = Spirits.load();
        // 老沁灵补记「出生」（性别由 born/ensureIn 定档，不会在这里被改）
        if (!s[it.id] || !s[it.id].bornAt) Spirits.born(it);
        if (!s[it.id] || !s[it.id].persona) {
          await Spirits.persona(it);
          changed = true;
        }
        // v127：刚开沁（还没有立绘、也还没定过设定）→ 先等用户在「设定向导」里确认再出图
        const st1 = Spirits.load();
        const r0 = Spirits.ensureIn(st1, it.id);
        if (!r0.imgUrl && !r0.look && r0.lookAsked !== 1 && !r0.setupPending) {
          r0.setupPending = true;
          Spirits.save(st1);
        }
      }
      // 注意：这里的重渲染期间 _spiritBusy 仍为 true，避免自己递归进来
      if (changed && location.hash === "#/spirit") renderSpiritPage();

      // 2) v155：**取消"每天自动来信"**（用户要求：日记已经取代了每日来信）
      //    每天要有的内容是：沁灵详情页的「今日问候 + 今日一签」，以及纪念日才发的「回响」信。
      //    回响在 ensureSpiritExtras 里本地结算，不花任何额度。
    } catch (e) { /* 静默：本地模板兜底已在 Spirits 内部处理 */ }
    _spiritBusy = false;
  }

  // 沁灵详情弹层

  // 绘图通道配置弹层（默认免密钥；填国内 API key 就切过去）
  function showImageCfgModal() {
    const mask = $("#modalMask");
    const modal = $("#modal");
    const cfg = Spirits.getImageCfg();
    const opts = Object.keys(Spirits.PROVIDERS).map((k) =>
      '<button type="button" class="prov-chip' + (cfg.provider === k ? " active" : "") + '" data-prov="' + k + '">' +
      esc(Spirits.PROVIDERS[k].label) + "</button>").join("");
    modal.innerHTML = "<h3>🎨 沁灵形象 · 绘图通道</h3>" +
      '<p style="font-size:12px;color:var(--text-2);line-height:1.7;margin-bottom:12px">' +
      "默认用<b>免密钥</b>通道（Pollinations，国内可直连，出图偶尔不稳）。<br>" +
      "想更稳更漂亮，可填国内 API key（智谱 / 硅基流动 / 火山方舟），<b>key 只存本机、不入开源仓库</b>。</p>" +
      '<div class="cfg-tip">💰 <b>怎么选最省</b>：按量付费即可，都比包月/包天划算。<br>' +
      "· <b>智谱</b>：GLM-Image 约 <b>¥0.1/张</b>（新旗舰）· CogView-4 约 <b>¥0.06/张</b> · <b>CogView-3-Flash 免费</b><br>" +
      "· <b>火山方舟</b>：Seedream 5.0 flash 约 <b>¥0.13/张</b> · lite ¥0.22<br>" +
      "· <b>魔搭 / 硅基流动</b>：有免费额度，适合先试<br>" +
      "🖼 <b>图生图（深沁/换形象时带参考图）</b>：<b>方舟支持</b>；<b>智谱不支持</b>（官方 API 没有参考图字段）→ 自动退回「文字锚点」保证同一个角色，不会变性换人。<br>" +
      "⚠️ 智谱的「拉取模型」只会列出语言模型（glm-*），<b>图像模型要手填或用上面的常用模型按钮</b>。<br>" +
      "⚠️ <b>水印</b>：方舟 flash 默认带「AI generated」，已自动传 <code>watermark:false</code> 关掉；智谱默认也带水印，已自动传 <code>watermark_enabled:false</code>（去 个人中心→安全管理→去水印管理 签个免责声明才生效）。<br>" +
      "⚠️ 别买「私有实例 / 专属部署」那种<b>按天计价</b>的（图像模型约 100 元/算力单元/天，一个月就是几千块）。</div>" +
      '<div class="prov-row" id="provRow">' + opts + "</div>" +
      '<div class="cfg-hint" id="refHint" style="margin-top:6px"></div>' +
      '<div class="form-group" style="margin-top:14px"><div class="form-label">形象风格 <small>换完记得点保存，再看沁灵页</small></div>' +
      '<div class="prov-row" id="styleRow">' +
      Object.keys(Spirits.STYLE_PRESETS).map((k) =>
        '<button type="button" class="prov-chip' + ((cfg.style || Spirits.DEFAULT_STYLE) === k ? " active" : "") + '" data-style="' + k + '">' +
        esc(Spirits.STYLE_PRESETS[k].label) + "</button>").join("") +
      "</div></div>" +
      '<div class="form-group" style="margin-top:12px"><div class="form-label">API Key <small>走免密钥通道时留空</small></div>' +
      '<input class="form-input" id="imgKey" placeholder="ark-... / sk-... / xxxx.yyyy" value="' + esc(cfg.key || "") + '">' +
      '<div class="cfg-hint" id="keyUiHint"></div></div>' +
      '<div class="form-group"><div class="form-label">模型名 <small>留空用该服务商默认；下面有一键填入，也能拉你账号里的模型</small></div>' +
      '<input class="form-input" id="imgModel" placeholder="如 doubao-seedream-5-0-flash-260915" value="' + esc(cfg.model || "") + '">' +
      '<div class="prov-row" id="imgModelQuick" style="margin-top:6px">' +
      (Spirits.MODEL_PICKS[cfg.provider || "pollinations"] || []).map((m) =>
        '<button type="button" class="prov-chip" data-model="' + esc(m.id) + '" title="' + esc(m.note) + '">' + esc(m.id) + "</button>").join("") +
      "</div>" +
      '<div class="cfg-hint" id="modelNote">' + esc(((Spirits.MODEL_PICKS[cfg.provider || "pollinations"] || [])[0] || {}).note || "") + "</div>" +
      '<div id="imgModelPick" style="margin-top:6px"></div>' +
      '<button type="button" class="btn ghost" id="imgListModels" style="width:100%;margin-top:6px;font-size:12px">📋 拉取我账号里的可用模型</button></div>' +
      '<div class="form-group"><div class="form-label">接口地址 <small>用服务商默认时留空</small></div>' +
      '<input class="form-input" id="imgEndpoint" placeholder="https://.../v1/images/generations" value="' + esc(cfg.endpoint || "") + '"></div>' +
      '<div class="form-group"><div class="form-label">出图尺寸 <small>跟着服务商走（各家能用的档不一样）；被拒会自动换一档</small></div>' +
      '<div class="prov-row" id="sizeRow"></div>' +
      '<div class="cfg-hint" id="sizeHint"></div></div>' +
      '<div style="display:flex;gap:8px;margin-top:6px">' +
      '<button class="btn ghost" id="imgCfgTest" style="flex:1">🔍 测试连接</button>' +
      '<button class="btn ghost" id="imgCfgCancel" style="flex:1">取消</button>' +
      '<button class="btn primary" id="imgCfgSave" style="flex:2">保存</button></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;align-items:center">' +
      '<button class="btn ghost" id="imgSyncBtn" style="flex:1">☁ 同步沁灵到云端</button>' +
      '<span id="imgSyncStatus" style="font-size:12px;color:var(--text-2)"></span></div>' +
      '<div id="imgCfgMsg" style="font-size:12px;line-height:1.7;margin-top:10px;color:var(--text-2);word-break:break-all"></div>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    const done = () => { mask.hidden = true; modal.hidden = true; };
    let chosen = cfg.provider || "pollinations";
    let chosenStyle = cfg.style || Spirits.DEFAULT_STYLE;
    let chosenSize = cfg.size || Spirits.DEFAULT_SIZE;
    // 「常用模型」一键填入（首次打开也要绑上事件，不能只在换服务商时才绑）
    function bindModelQuick(provider) {
      const quick = $("#imgModelQuick"), note = $("#modelNote");
      const picks = Spirits.MODEL_PICKS[provider] || [];
      if (quick) {
        quick.innerHTML = picks.map((m) =>
          '<button type="button" class="prov-chip" data-model="' + esc(m.id) + '" title="' + esc(m.note) + '">' + esc(m.id) + "</button>").join("");
        quick.querySelectorAll("[data-model]").forEach((b) => b.onclick = () => {
          $("#imgModel").value = b.dataset.model;
          quick.querySelectorAll("[data-model]").forEach((x) => x.classList.toggle("active", x === b));
          if (note) {
            const hit = picks.filter((m) => m.id === b.dataset.model)[0];
            note.textContent = hit ? hit.note : "";
          }
        });
      }
      if (note) note.textContent = picks.length ? picks[0].note : "";
    }
    bindModelQuick(chosen);
    // 尺寸 chip 也按服务商渲染（各家能用的档不一样），并在换服务商时同步
    function bindSizeRow(provider) {
      const row = $("#sizeRow"), hint = $("#sizeHint");
      const list = Spirits.sizePresetsFor(provider);
      const cur = chosenSize;
      const hit = list.filter((s) => s.v === cur)[0];
      if (!hit) chosenSize = list[0].v;          // 当前尺寸这家不支持 → 自动选这家的第一档（推荐的）
      if (row) {
        row.innerHTML = list.map((sz) =>
          '<button type="button" class="prov-chip' + (chosenSize === sz.v ? " active" : "") + '" data-size="' + sz.v + '">' +
          esc(sz.label) + "</button>").join("");
        row.querySelectorAll("[data-size]").forEach((b) => b.onclick = () => {
          chosenSize = b.dataset.size;
          row.querySelectorAll("[data-size]").forEach((x) => x.classList.toggle("active", x === b));
        });
      }
      if (hint) {
        hint.textContent = "这家能用的档：" + list.map((s) => s.v).join(" / ") + "（被拒会自动换一档并记住）";
      }
    }
    bindSizeRow(chosen);
    // 图生图支持情况（跟着服务商显示，省得用户以为"没接上"）
    function bindRefHint(provider) {
      const el = $("#refHint");
      if (el) el.innerHTML = "🖼 <b>图生图（深沁/换形象时带参考图）</b>：" + esc(Spirits.refSupportText(provider));
      const kh = $("#keyUiHint");
      if (kh) kh.innerHTML = "🔑 " + Spirits.keyUiHint(provider);
    }
    bindRefHint(chosen);
    modal.querySelectorAll("#provRow .prov-chip, #styleRow .prov-chip").forEach((b) => b.onclick = () => {
      if (b.dataset.style) {
        chosenStyle = b.dataset.style;
        modal.querySelectorAll("#styleRow .prov-chip").forEach((x) => x.classList.toggle("active", x === b));
        return;
      }
      chosen = b.dataset.prov;
      modal.querySelectorAll("#provRow .prov-chip").forEach((x) => x.classList.toggle("active", x === b));
      // 换服务商时自动带上该家的默认模型名 / 接口地址（省得用户去查）
      const pv = Spirits.PROVIDERS[chosen] || {};
      if (pv.model) $("#imgModel").value = pv.model;
      $("#imgEndpoint").value = "";
      // 尺寸 chip 也跟着这家能用的档重建（避免选了个一定被拒的档）
      bindSizeRow(chosen);
      bindRefHint(chosen);
      // 常用的模型名一键填入（跟着服务商换）
      bindModelQuick(chosen);
    });
    $("#imgCfgCancel").onclick = done;
    mask.onclick = done;
    // 跨手机同步：把本地沁灵推到云端，并拉回云端最新（换手机/换浏览器即可拿回全部沁灵）
    const syncBtn = $("#imgSyncBtn"), syncStatus = $("#imgSyncStatus");
    if (syncBtn) syncBtn.onclick = async () => {
      syncStatus.textContent = "同步中…";
      try {
        await DB.putSpiritStore(packSync());
        await pullSpirits();
        syncStatus.textContent = "✅ 已同步到云端";
      } catch (e) { syncStatus.textContent = "⚠️ 失败：" + ((e && e.message) || "未配置 Supabase 云端"); }
    };
    // 拉取账号里的可用模型（方舟/兼容服务都支持），点一下直接填进模型名
    $("#imgListModels").onclick = async () => {
      const btn = $("#imgListModels"), box = $("#imgModelPick");
      btn.disabled = true; btn.textContent = "拉取中…";
      box.innerHTML = "";
      try {
        const ids = await Spirits.listModels("image", { provider: chosen, key: $("#imgKey").value.trim(), endpoint: $("#imgEndpoint").value.trim() });
        if (!ids.length) { box.innerHTML = '<span style="font-size:12px;color:var(--text-2)">没拉到模型（可能是这个服务商没有 /models 接口）</span>'; }
        else {
          box.innerHTML = '<div style="font-size:11px;color:var(--text-2);margin-bottom:4px">点一下填入（' + ids.length + ' 个）：</div>' +
            '<div class="prov-row">' + ids.map((id) =>
              '<button type="button" class="prov-chip" data-pick="' + esc(id) + '">' + esc(id) + "</button>").join("") + "</div>";
          box.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
            $("#imgModel").value = b.dataset.pick;
            box.querySelectorAll("[data-pick]").forEach((x) => x.classList.toggle("active", x === b));
          });
        }
      } catch (e) {
        // ★ 服务商的 /models 只列语言模型（智谱就是这样，只给 glm-*）：
        //   不是"拉取失败"，而是这家根本不在这里列图像模型 → 直接告诉用户该填什么
        if (e && e.textOnly) {
          const picks = Spirits.MODEL_PICKS[chosen] || [];
          box.innerHTML =
            '<div style="font-size:11.5px;line-height:1.8;color:#6b5320;background:#fff8e8;border:1px dashed #e6d3a8;border-radius:10px;padding:8px 10px">' +
            "ℹ️ 这家的 /models 接口<b>只列出语言模型</b>（你看到的 glm-* 都是聊天模型，不能出图）。" +
            "<br>图像模型要<b>手填</b>：" + picks.map((m) => "<b>" + esc(m.id) + "</b>").join(" / ") +
            "<br>（上面的「常用模型」按钮点一下就能填进去，不用手打）</div>";
          box.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
            $("#imgModel").value = b.dataset.pick;
            box.querySelectorAll("[data-pick]").forEach((x) => x.classList.toggle("active", x === b));
          });
        } else {
          box.innerHTML = '<span style="font-size:12px;color:var(--red)">拉取失败：' + esc((e && e.message) || "") + "</span>";
        }
      } finally {
        btn.disabled = false; btn.textContent = "📋 拉取我账号里的可用模型";
      }
    };
    // 测试连接：直接按当前填的内容试一次出图，把服务端原因原样显示（方舟未开通会明确报 ModelNotOpen）
    $("#imgCfgTest").onclick = async () => {
      const btn = $("#imgCfgTest");
      const msgEl = $("#imgCfgMsg");
      const keep = Spirits.getImageCfg();
      // 临时用弹层里正在填的配置去测（不改动已保存的配置）
      Spirits.setImageCfg({ provider: chosen, key: $("#imgKey").value.trim(), model: $("#imgModel").value.trim(), endpoint: $("#imgEndpoint").value.trim(), style: chosenStyle, size: chosenSize });
      btn.disabled = true; btn.textContent = "测试中…";
      msgEl.textContent = "正在请 " + Spirits.PROVIDERS[chosen].label + " 画一张测试图…（几秒到十几秒）";
      try {
        const r = await Spirits.testImage();
        msgEl.innerHTML = (r.ok ? "✅ " : "❌ ") + esc(r.msg);
      } catch (e) {
        const em = (e && e.message) || "测试失败";
        msgEl.innerHTML = "❌ " + esc(em).replace(/\*\*/g, "") +
          '<br><span style="color:var(--text-2)">👉 ' + imageErrHint(em, chosen) + "</span>";
      } finally {
        btn.disabled = false; btn.textContent = "🔍 测试连接";
        Spirits.setImageCfg(keep);   // 还原成已保存的配置
      }
    };
    $("#imgCfgSave").onclick = async () => {
      const next = {
        provider: chosen,
        key: $("#imgKey").value.trim(),
        model: $("#imgModel").value.trim(),
        endpoint: $("#imgEndpoint").value.trim(),
        style: chosenStyle,
        size: chosenSize,
      };
      if (chosen !== "pollinations") {
        if (!next.key) { toast("这条路需要填 API Key；只想免费用就选「免密钥」"); return; }
        const kh = Spirits.keyHint(next.key, chosen);
        if (kh) { $("#imgCfgMsg").innerHTML = "⚠️ " + esc(kh); toast("API Key 看起来不对，先看弹层里的提示"); return; }
      }
      // 换通道 / 换风格 / 换尺寸 → 已出的图要重画，先问一句（别静默烧额度）
      const keep = Spirits.getImageCfg();
      const willRedraw = (keep.provider !== next.provider || keep.style !== next.style || keep.size !== next.size);
      const n = willRedraw ? spiritItems().filter((it) => {
        const r = Spirits.load()[it.id];
        return r && r.imgUrl;
      }).length : 0;
      if (n > 0) {
        const yes = await confirmModal("要重画 " + n + " 只沁灵吗？", "改了通道 / 画风 / 尺寸后，已有立绘需要重新生成，会消耗 " + n + " 次出图额度（每只 1 张）。", "重画 " + n + " 张", true);
        if (!yes) { showImageCfgModal(); return; }   // 取消：把配置弹层还回来，别让用户白点一次
        done();
        Spirits.setImageCfg(next);
        const st = Spirits.load();
        Object.keys(st).forEach((k) => { st[k].imgUrl = ""; st[k].imgAt = 0; st[k]._imgErr = ""; st[k]._imgErrAt = 0; st[k].imgFrozen = 0; });
        Spirits.save(st);
        toast("已切换：" + Spirits.PROVIDERS[chosen].label + " · " + Spirits.STYLE_PRESETS[chosenStyle].label + "（正在重画 " + n + " 张）");
        renderSettings();
        return;
      }
      Spirits.setImageCfg(next);
      done();
      toast("已切换：" + Spirits.PROVIDERS[chosen].label + " · " + Spirits.STYLE_PRESETS[chosenStyle].label);
      renderSettings();
    };
  }

  // 文字通道配置弹层（AI 助手 + 沁灵性格/来历；可切火山方舟白嫖免费额度）
  function showTextCfgModal() {
    const mask = $("#modalMask");
    const modal = $("#modal");
    const cfg = Spirits.getTextCfg();
    const opts = Object.keys(Spirits.TEXT_PROVIDERS).map((k) =>
      '<button type="button" class="prov-chip' + (cfg.provider === k ? " active" : "") + '" data-tprov="' + k + '">' +
      esc(Spirits.TEXT_PROVIDERS[k].label) + "</button>").join("");
    modal.innerHTML = "<h3>🤖 AI 文字模型</h3>" +
      '<p style="font-size:12px;color:var(--text-2);line-height:1.7;margin-bottom:12px">' +
      "这里管的是<b>文字</b>：收藏喵助手的回答、沁灵的性格 / 小剧场 / 每日来信。<br>" +
      "火山方舟里 <b>deepseek-v4-1-flash / glm-5-3-flash / doubao-seed-2-1-lite</b> 等都送免费额度（50 万 tokens），够用很久。<br>" +
      "⚠️ 需要先在方舟控制台<b>点「开通」</b>，否则会报 ModelNotOpen。</p>" +
      '<div class="prov-row" id="tprovRow">' + opts + "</div>" +
      '<div class="form-group" style="margin-top:12px"><div class="form-label">API Key <small>只存本机</small></div>' +
      '<input class="form-input" id="tKey" placeholder="sk-… 或 ark-…" value="' + esc(cfg.key || "") + '"></div>' +
      '<div class="form-group"><div class="form-label">模型名 <small>方舟填控制台里的模型 ID，或你的接入点 ep-…</small></div>' +
      '<input class="form-input" id="tModel" placeholder="如 deepseek-v4-1-flash-260910" value="' + esc(cfg.model || "") + '">' +
      '<div id="tModelPick" style="margin-top:6px"></div>' +
      '<button type="button" class="btn ghost" id="tListModels" style="width:100%;margin-top:6px;font-size:12px">📋 拉取我账号里的可用模型</button></div>' +
      '<div class="form-group"><div class="form-label">接口地址 <small>用默认时留空</small></div>' +
      '<input class="form-input" id="tEndpoint" placeholder="https://…/chat/completions" value="' + esc(cfg.endpoint || "") + '"></div>' +
      '<div style="display:flex;gap:8px;margin-top:6px">' +
      '<button class="btn ghost" id="tCfgTest" style="flex:1">🔍 测试连接</button>' +
      '<button class="btn ghost" id="tCfgCancel" style="flex:1">取消</button>' +
      '<button class="btn primary" id="tCfgSave" style="flex:2">保存</button></div>' +
      '<div id="tCfgMsg" style="font-size:12px;line-height:1.7;margin-top:10px;color:var(--text-2);word-break:break-all"></div>';
    mask.hidden = false;
    modal.hidden = false;
    modal.style.display = "";
    const done = () => { mask.hidden = true; modal.hidden = true; };
    let chosen = cfg.provider || "deepseek";
    modal.querySelectorAll(".prov-chip").forEach((b) => b.onclick = () => {
      chosen = b.dataset.tprov;
      modal.querySelectorAll("#tprovRow .prov-chip").forEach((x) => x.classList.toggle("active", x === b));
      const p = Spirits.TEXT_PROVIDERS[chosen] || {};
      if (p.model) $("#tModel").value = p.model;
      $("#tEndpoint").value = "";
    });
    $("#tCfgCancel").onclick = done;
    mask.onclick = done;
    // 拉取账号里的可用文本模型
    $("#tListModels").onclick = async () => {
      const btn = $("#tListModels"), box = $("#tModelPick");
      btn.disabled = true; btn.textContent = "拉取中…";
      box.innerHTML = "";
      // 文字通道与绘图通道可能不是同一家，这里按文字通道推导
      const probe = { provider: chosen, key: $("#tKey").value.trim(), endpoint: $("#tEndpoint").value.trim() || (Spirits.TEXT_PROVIDERS[chosen] || {}).endpoint || "" };
      try {
        const ids = await Spirits.listModels("text", { provider: chosen, key: probe.key, endpoint: probe.endpoint });
        if (!ids.length) { box.innerHTML = '<span style="font-size:12px;color:var(--text-2)">没拉到模型</span>'; }
        else {
          box.innerHTML = '<div style="font-size:11px;color:var(--text-2);margin-bottom:4px">点一下填入（' + ids.length + ' 个）：</div>' +
            '<div class="prov-row">' + ids.map((id) =>
              '<button type="button" class="prov-chip" data-tpick="' + esc(id) + '">' + esc(id) + "</button>").join("") + "</div>";
          box.querySelectorAll("[data-tpick]").forEach((b) => b.onclick = () => {
            $("#tModel").value = b.dataset.tpick;
            box.querySelectorAll("[data-tpick]").forEach((x) => x.classList.toggle("active", x === b));
          });
        }
      } catch (e) {
        box.innerHTML = '<span style="font-size:12px;color:var(--red)">拉取失败：' + esc((e && e.message) || "") + "</span>";
      } finally {
        btn.disabled = false; btn.textContent = "📋 拉取我账号里的可用模型";
      }
    };
    $("#tCfgTest").onclick = async () => {
      const btn = $("#tCfgTest"), msgEl = $("#tCfgMsg");
      const keep = Spirits.getTextCfg();
      Spirits.setTextCfg({ provider: chosen, key: $("#tKey").value.trim(), model: $("#tModel").value.trim(), endpoint: $("#tEndpoint").value.trim() });
      btn.disabled = true; btn.textContent = "测试中…";
      msgEl.textContent = "正在让文字模型说句话…";
      try {
        const r = await Spirits.testText();
        msgEl.innerHTML = (r.ok ? "✅ " : "❌ ") + esc(r.msg);
      } catch (e) {
        msgEl.innerHTML = "❌ " + esc((e && e.message) || "测试失败") +
          '<br><span style="color:var(--text-2)">ModelNotOpen = 该模型还没在控制台点「开通」；NotFound = 模型名写错。</span>';
      } finally {
        btn.disabled = false; btn.textContent = "🔍 测试连接";
        Spirits.setTextCfg(keep);
      }
    };
    $("#tCfgSave").onclick = () => {
      const next = { provider: chosen, key: $("#tKey").value.trim(), model: $("#tModel").value.trim(), endpoint: $("#tEndpoint").value.trim() };
      Spirits.setTextCfg(next);
      // 兼容旧的「AI 助手密钥」：DeepSeek 官方通道继续用 ww_dskey
      if (chosen === "deepseek") { try { localStorage.setItem("ww_dskey", next.key); } catch (e) { /* 忽略 */ } }
      done();
      toast("已切换文字模型：" + (Spirits.TEXT_PROVIDERS[chosen] || {}).label);
      renderSettings();
    };
  }

  /* ---------- 进入应用（登录后） ---------- */  async function enterApp(passedSession) {
    const session = passedSession || await DB.getSession();
    if (!session || !session.user) { location.hash = "#/auth"; return false; }
    user = session.user;
    const cached = readItemsCache();
    // 显示名：优先云端，连不上就用缓存里的名字
    try {
      const prof = await DB.getProfile(user.id);
      user.displayName = prof.display_name || "";
    } catch (e) {
      user.displayName = user.displayName || (cached && cached.name) || "";
    }
    try {
      await loadItems();
      writeItemsCache();
      offlineMode = false;
    } catch (e) {
      // 云端读不到（网络不稳）：进离线模式 —— 有缓存就用缓存顶上，没有也标记离线
      // （不标记的话会被当成"首次登录"，把人强制跳到设置用户名的页面）
      offlineMode = true;
      if (cached && cached.items.length) {
        allItems = cached.items;
        playDays = Game.normDays(cached.playDays || []);
      }
      Spirits.setMainItems(allItems);   // 离线也要把全量串灌给引擎（算主串集用）
    }
    // 加载盘玩打卡日期（连续打卡用；缺列时静默为空）
    if (!offlineMode) {
      try { playDays = Game.normDays(await DB.getPlayDays(user.id)); writeItemsCache(); } catch (e) { /* 保留缓存值 */ }
    }
    // 历史数据回填：给已盘过的老串补「首次盘玩时间」（联网时才做，没网等下次）
    if (!offlineMode) { try { await backfillFirstPlayed(); } catch (e) {} }
    // 首次登录：无显示名则引导设置（离线时不要强制跳转）
    if (user && !user.displayName && !offlineMode && location.hash !== "#/profile") {
      location.hash = "#/profile";
    }
    router();
    refreshNetBar();
    checkLevelUp();
    pullSpirits().catch(() => {});   // 跨手机同步：登录后先把云端沁灵拉回本地
    return true;
  }

  /* ---------- 数据加载 ---------- */
  async function loadItems() {
    allItems = await DB.getAll();
    // 归一化珠子类旧状态（旧"idle"→"ready"，旧"playing"保留，旧""→"unplayed"），并补默认历史
    allItems.forEach((it) => {
      if (isBeadCat(it.category || "")) {
        if (it.playStatus === "idle") it.playStatus = "ready";
        else if (it.playStatus === "" || it.playStatus == null) it.playStatus = "unplayed";
      }
    });
    sortItems();
    backfillColors(); // 后台静默补颜色（不阻塞）
    Spirits.setMainItems(allItems);   // 全量串灌给引擎（mainSetOf 算有效主串集用）
  }

  // 为无颜色但有照片的宝贝后台补识别主色（逐个识别保存，完成后刷新）
  let _backfilling = false;
  async function backfillColors() {
    if (_backfilling || !window.Color) return;
    _backfilling = true;
    try {
      const need = allItems.filter((i) => !i.color && i.photos && i.photos[0]);
      if (!need.length) return;
      let changed = 0;
      for (const it of need) {
        const src = it.photos[0].url || (it.photos[0].data ? URL.createObjectURL(it.photos[0].data) : "");
        if (!src) continue;
        try {
          const c = await window.Color.detectColor(src);
          if (c && !it.color) { it.color = c; await DB.put(it); changed++; }
        } catch (e) {}
      }
      if (changed && document.getElementById("gridHolder")) updateGrid();
    } catch (e) {
    } finally {
      _backfilling = false;
    }
  }

  /* 计算某件宝贝合理的「首次盘玩时间」估计值：
     - 锚点 = 入库时间（没有则创建时间）——「拿到手就开始盘」是最合理的估计
     - 硬约束：不能晚于最后一次盘玩时间（没有入库/盘玩记录则返回 null 不回填） */
  function estimateFirstPlayed(it) {
    const anchor = it.arrivedAt || it.createdAt || null;
    const lp = it.lastPlayedAt || null;
    let v = anchor != null ? anchor : lp;
    if (v == null) return null;
    if (lp != null && v > lp) v = lp;   // 首次不能晚于最后一次盘玩
    return v;
  }

  /* 历史数据回填 / 纠正：
     1) 「有盘玩记录但没有首次盘玩时间」→ 按上面的估计值补上
     2) 已被回填成**违反约束**的值（晚于 lastPlayedAt、或早于 arrivedAt）→ 纠正过来
     注意：用户手动设置且不违反约束的值不会被改动 */
  let _backfillFirst = false;
  async function backfillFirstPlayed() {
    if (_backfillFirst) return;
    const need = allItems.filter((i) => {
      const hasPlay = (Number(i.playCount) || 0) > 0 || i.lastPlayedAt;
      if (!hasPlay) return false;
      if (!i.firstPlayedAt) return true;                                  // 缺 → 补
      if (i.lastPlayedAt && i.firstPlayedAt > i.lastPlayedAt) return true; // 晚于最后盘玩 → 纠正
      if (i.arrivedAt && i.firstPlayedAt < i.arrivedAt) return true;       // 早于入库 → 纠正
      return false;
    });
    if (!need.length) return;
    _backfillFirst = true;
    try {
      let changed = 0;
      for (const it of need) {
        const v = estimateFirstPlayed(it);
        if (v == null || v === it.firstPlayedAt) continue;
        const prev = it.firstPlayedAt;
        it.firstPlayedAt = v;
        try { await DB.put(it); changed++; } catch (e) { it.firstPlayedAt = prev; }
      }
      if (changed && document.getElementById("gridHolder")) updateGrid();
    } catch (e) {
    } finally {
      _backfillFirst = false;
    }
  }

  // 排序：arrived=入库时间(desc) | created=放置时间(desc=放置最长在前) | price=价格 | playcount=盘玩次数 | star=星级 | color=颜色
  // 传入 items 可对指定集合（如某收藏盒子）排序，缺省对全量 allItems
  //
  // v90 新增「分组压底」；v92 改成按状态整段分组（用户要求别把盘玩中和已挂瓷混在一起）
  //   · 顺序：① 盘玩中 → ② 待盘玩 → ③ 已挂瓷 → ④ 未盘玩 → ⑤ 佩戴中（最下）
  //   · 每一段内部仍按所选排序方式排；切换升/降序不改变这几段的位置
  //   · 拼图类按同理映射：待拼→待盘玩档、已拼→已挂瓷档
  //   · 水晶/玉石/周边等「没有盘玩状态」的分类与「盘玩中」同档（正常在库，不参与这套状态分组）
  function pinRank(it) {
    const st = it.playStatus || "";
    if (st === "playing") return 0;
    if (st === "ready" || st === "puzzle_pending") return 1;
    if (st === "done" || st === "puzzle_done") return 2;
    if (st === "unplayed") return 3;
    if (st === "wearing") return 4;
    // 菩提类但状态为空：等同未盘玩（loadItems 会归一化，这里兜底）
    if (!st && isBeadCat(it.category || "")) return 3;
    return 0;
  }
  function sortItems(items) {
    const arr = items || allItems;
    const key = (i) => i.arrivedAt || i.createdAt || 0;
    const restKey = (i) => (i.lastPlayedAt ? Date.now() - i.lastPlayedAt : null); // 放置时长：距上次盘玩（ms）
    const dir = sortDir === "asc" ? 1 : -1; // asc: 小→大；desc: 大→小
    const priceNum = (i) => {
      if (i.price == null || i.price === "" || !isFinite(Number(i.price)) || Number(i.price) <= 0) return null;
      return Number(i.price);
    };
    const colorOrder = (window.Color ? window.Color.COLOR_LIST : []).map((c) => c.v);
    const colorIdx = (it) => {
      const c = window.Color ? window.Color.normColor(it.color) : it.color;
      const i = colorOrder.indexOf(c);
      return i === -1 ? colorOrder.length : i;
    };
    let cmp;
    switch (sortMode) {
      case "created": {
        // 放置时间：距上次盘玩的时长(=now - lastPlayedAt)；desc=放置最长在前；无盘玩记录恒排最后
        cmp = (a, b) => {
          const ra = restKey(a), rb = restKey(b);
          if (ra == null && rb == null) return 0;
          if (ra == null) return 1; // 未盘玩/无记录排最后
          if (rb == null) return -1;
          return (ra - rb) * dir;
        };
        break;
      }
      case "price": {
        // 未记价的宝贝永远排最后（无论升降序），不污染排序
        cmp = (a, b) => {
          const pa = priceNum(a), pb = priceNum(b);
          if (pa == null && pb == null) return 0;
          if (pa == null) return 1;
          if (pb == null) return -1;
          return (pa - pb) * dir;
        };
        break;
      }
      case "playcount": cmp = (a, b) => ((Number(a.playCount) || 0) - (Number(b.playCount) || 0)) * dir; break;
      case "star": cmp = (a, b) => ((Number(a.star) || 0) - (Number(b.star) || 0)) * dir; break; // desc=高星在前；asc=低星在前
      case "color": cmp = (a, b) => (colorIdx(a) - colorIdx(b)) * dir; break; // 按颜色浅→深排；desc=浅→深（白在前）
      default: cmp = (a, b) => (key(a) - key(b)) * dir; // arrived
    }
    // 先按「状态分组」排（盘中 0 → 待盘 1 → 挂瓷 2 → 未盘 3 → 佩戴 4），组内再用所选排序比较
    arr.sort((a, b) => {
      const r = pinRank(a) - pinRank(b);
      if (r !== 0) return r;
      return cmp(a, b);
    });
  }

  function filtered(base) {
    // 文玩专注模式下：只保留 菩提/水晶/玉石（隐藏的分类数据仍在云端，只是不显示）
    const src = focusVisible(base || allItems);
    let list = src;
    // 隐藏已送人开关：默认隐藏，除非用户手动筛了"已送人/gifted"
    if (hideGifted && !selectFilters.has("gifted")) {
      list = list.filter((i) => !i.gifted);
    }
    // 多选状态筛选（selectFilters 空 = 全部）
    if (selectFilters.size) {
      list = list.filter((i) => {
        for (const f of selectFilters) {
          if (f === "instock" && !i.gifted) return true;
          if (f === "gifted" && i.gifted) return true;
          if (f === "unplayed" && isBeadCat(i.category || "") && (i.playStatus === "unplayed" || !i.playStatus)) return true;
          if (f === "ready" && isBeadCat(i.category || "") && i.playStatus === "ready") return true;
          if (f === "playing" && isBeadCat(i.category || "") && i.playStatus === "playing") return true;
          if (f === "done" && isBeadCat(i.category || "") && i.playStatus === "done") return true;
          if (f === "wearing" && isBeadCat(i.category || "") && i.playStatus === "wearing") return true;
          if (f === "puzzle_pending" && i.playStatus === "puzzle_pending") return true;
          if (f === "puzzle_done" && i.playStatus === "puzzle_done") return true;
        }
        return false;
      });
    }
    // 多选颜色筛选（selectColors 空 = 不限）
    if (selectColors.size) {
      list = list.filter((i) => {
        const ic = window.Color ? window.Color.normColor(i.color) : i.color;
        return selectColors.has(ic || "");
      });
    }
    // 多选珠型筛选（selectShapes 空 = 不限）
    if (selectShapes.size) {
      list = list.filter((i) => selectShapes.has(i.beadShape || ""));
    }
    // 兼容旧的单值 filter（仅对全量生效，避免影响盒子页等局部列表）
    if (!base && !selectFilters.size && !selectColors.size && !selectShapes.size) {
      if (filter === "instock") list = src.filter((i) => !i.gifted);
      else if (filter === "gifted") list = src.filter((i) => i.gifted);
      else if (filter === "unplayed") list = src.filter((i) => isBeadCat(i.category || "") && (i.playStatus === "unplayed" || !i.playStatus));
      else if (filter === "ready") list = src.filter((i) => isBeadCat(i.category || "") && i.playStatus === "ready");
      else if (filter === "playing") list = src.filter((i) => isBeadCat(i.category || "") && i.playStatus === "playing");
      else if (filter === "done") list = src.filter((i) => isBeadCat(i.category || "") && i.playStatus === "done");
      else if (filter === "puzzle_pending") list = src.filter((i) => i.playStatus === "puzzle_pending");
      else if (filter === "puzzle_done") list = src.filter((i) => i.playStatus === "puzzle_done");
      else if (filter.indexOf("color:") === 0) {
        const c = filter.slice(6);
        list = src.filter((i) => {
          const ic = window.Color ? window.Color.normColor(i.color) : i.color;
          return (ic || "") === c;
        });
      }
    }
    if (!base) {
      if (categoryFilter === "__uncat") {
        list = list.filter((i) => !i.category);
      } else if (categoryFilter) {
        list = list.filter((i) => (i.category || "") === categoryFilter);
      }
    }
    if (search) {
      const q = search.toLowerCase();
      // 状态文字映射（支持搜"盘玩""待拼""已拼""送人"等）
      const statusText = (i) => i.gifted ? "已送人" :
        isBeadCat(i.category || "") ? (i.playStatus === "ready" ? "待盘玩" : beadStatusText(i)) :
        (isPuzzleCat(i.category || "") ? (i.playStatus === "puzzle_pending" ? "待拼" : "已拼") :
         "");
      // 颜色搜索：匹配颜色名（如"绿""黄棕"）或颜色值（如"green"）
      const colorText = (i) => {
        const nc = window.Color ? window.Color.normColor(i.color) : i.color;
        if (!nc) return "";
        const label = window.Color ? window.Color.colorLabel(nc) : "";
        return (label + " " + nc).toLowerCase();
      };
      // 价格区间查询解析：支持 "100-300" / ">500" / "<100" / ">=200"
      const parsePriceTest = (str) => {
        let m;
        if ((m = str.match(/^([<>])=?\s*(\d+)$/))) { const n = +m[2]; const op = m[1] + (m[0].indexOf("=") >= 0 ? "=" : ""); return (p) => op === ">=" ? p >= n : op === "<=" ? p <= n : op === ">" ? p > n : p < n; }
        if ((m = str.match(/^(\d+)\s*[-~]\s*(\d+)/))) { const lo = +m[1], hi = +m[2]; return (p) => p >= lo && p <= hi; }
        return null;
      };
      // 单个关键词是否命中（多关键词按空格分隔、全部命中 = AND）
      const matchTerm = (i, term) => {
        const pt = parsePriceTest(term);
        const p = Number(i.price);
        const hasP = i.price != null && i.price !== "" && isFinite(p);
        if (pt) return hasP && pt(p);
        return (i.name || "").toLowerCase().includes(term) ||
          (i.species || "").toLowerCase().includes(term) ||
          (i.shop || "").toLowerCase().includes(term) ||
          (i.note || "").toLowerCase().includes(term) ||
          (i.category || "").toLowerCase().includes(term) ||
          (i.craft || "").toLowerCase().includes(term) ||
          shapeLabel(i.beadShape).toLowerCase().includes(term) ||
          softnessLabel(i.softness).toLowerCase().includes(term) ||   // 搜「软糯」「微糯」也能找到
          (i.accessoryType || "").toLowerCase().includes(term) ||
          statusText(i).toLowerCase().includes(term) ||
          colorText(i).includes(term) ||
          (i.price != null && String(i.price).includes(term)) ||
          (i.beadSize ? String(i.beadSize).includes(term) : false) ||
          (i.pieceCount ? String(i.pieceCount).includes(term) : false);
      };
      // 支持多关键词：搜索"菩提 绿"= 同时含"菩提"且含"绿"
      const terms = q.split(/\s+/).filter(Boolean);
      if (terms.length) list = list.filter((i) => terms.every((t) => matchTerm(i, t)));
    }
    return list;
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    topbarTitle.textContent = (user && user.displayName ? user.displayName : "我的") + "收藏馆";
    btnBack.style.visibility = "hidden";
    btnSettings.style.visibility = "visible";

    // v163b：首页也推进契合度（纯本地只涨数值；AI 剧情/出图仍只在沁灵巷·房间页触发，避免每次进首页就烧额度）
    try {
      if (window.Rooms && Rooms.tick) Rooms.tick((allItems || []).filter(function (i) { return i && i.roomId; }));
    } catch (e) { /* 静默 */ }

    // 等级经验条（游戏化）
    const gameInfo = Game.computeXp(allItems, playDays);
    const lvInfo = Game.getLevel(gameInfo.xp);

    // 今日任务完成情况
    const tasks = Game.dailyTasks(allItems);
    const taskDone = tasks.filter((t) => t.done).length;

    // 统计基准集合：开启"隐藏已送人"时排除已送人，关闭时算全部
    const base = hideGifted ? allItems.filter((i) => !i.gifted) : allItems;

    let html = "";
    let drawHtml = "";
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

    // 连续打卡条（收藏等级下方）
    const sNow = Game.currentStreak(playDays);
    const sBest = Game.bestStreak(playDays);
    if (sNow >= 1) {
      html += '<button class="streak-bar on" id="streakBar" title="去盘玩计划打卡">' +
        '<span class="streak-fire">🔥</span>' +
        '<span class="streak-txt">已连续盘串 <b>' + sNow + '</b> 天</span>' +
        '<span class="streak-best">' + (sBest > sNow ? "最长 " + sBest + " 天" : "保持住！") + "</span>" +
        "</button>";
    } else if (sBest >= 2) {
      html += '<button class="streak-bar" id="streakBar" title="去盘玩计划打卡">' +
        '<span class="streak-fire dim">🔥</span>' +
        '<span class="streak-txt">最长连续 <b>' + sBest + '</b> 天 · 今天盘一串继续</span>' +
        "</button>";
    } else {
      html += '<button class="streak-bar" id="streakBar" title="去盘玩计划打卡">' +
        '<span class="streak-fire dim">🔥</span>' +
        '<span class="streak-txt">今天盘一串，开启连续打卡</span>' +
        "</button>";
    }

    // 折叠筛选区：按钮 + 可展开面板（先构建，最后在宝贝列表上方渲染，紧挨宝贝）
    let filterHtml = '';
    filterHtml += '<button class="filter-toggle" id="filterToggle">' +
      '<span>📊 筛选与统计</span><span class="filter-badge">' + base.length + ' 件</span><span class="filter-arrow" id="filterArrow" style="transform:' + (filterOpen ? "rotate(180deg)" : "") + '">▾</span>' +
      "</button>";

    filterHtml += '<div id="filterPanel" style="display:' + (filterOpen ? "" : "none") + '">';
    // 隐藏已送人开关
    filterHtml += '<div class="paper-card switch-row">' +
      '<div><div style="font-size:13px;font-weight:600;color:var(--text)">🙈 隐藏已送人</div>' +
      '<div style="font-size:11px;color:var(--text-2);margin-top:2px">关闭后显示所有宝贝，含已出库</div></div>' +
      '<label class="switch"><input type="checkbox" id="hideGifted"' + (hideGifted ? " checked" : "") + '><span class="switch-slider"></span></label></div>';

    // 各筛选项的实时数量（在 chip 上直接显示数字；随"隐藏已送人"开关变化）
    const nBy = {
      instock: base.filter((i) => !i.gifted).length,
      unplayed: base.filter((i) => isBeadCat(i.category || "") && (i.playStatus === "unplayed" || !i.playStatus)).length,
      ready: base.filter((i) => isBeadCat(i.category || "") && i.playStatus === "ready").length,
      playing: base.filter((i) => isBeadCat(i.category || "") && i.playStatus === "playing").length,
      done: base.filter((i) => isBeadCat(i.category || "") && i.playStatus === "done").length,
      wearing: base.filter((i) => isBeadCat(i.category || "") && i.playStatus === "wearing").length,
      puzzle_pending: base.filter((i) => i.playStatus === "puzzle_pending").length,
      puzzle_done: base.filter((i) => i.playStatus === "puzzle_done").length,
      gifted: base.filter((i) => i.gifted).length,
    };
    // 颜色数量（归一化后统计；随"隐藏已送人"开关变化）
    const colorCount = {};
    base.forEach((i) => {
      const c = window.Color ? window.Color.normColor(i.color) : i.color;
      if (c) colorCount[c] = (colorCount[c] || 0) + 1;
    });
    // 珠型数量（随"隐藏已送人"开关变化）
    const shapeCount = {};
    base.forEach((i) => { if (i.beadShape) shapeCount[i.beadShape] = (shapeCount[i.beadShape] || 0) + 1; });
    // 用户分类是否包含"拼图"：无拼图则不出现拼图相关状态（待拼/已拼）
    const cats = getCategories();
    const hasPuzzleCat = cats.includes("拼图") || allItems.some((i) => isPuzzleCat(i.category || ""));
    // 菩提分类是否存在：存在才显示盘玩状态（未盘玩/待盘玩/盘玩中/已挂瓷）
    const hasBeadCat = cats.includes("菩提") || allItems.some((i) => isBeadCat(i.category || ""));

    // 状态多选 chips（每项带计数；未盘玩/待盘玩/盘玩中/已挂瓷 只在菩提分类存在时显示）
    const stChip = (k, label) => '<button type="button" class="chip' + (selectFilters.has(k) ? " active" : "") + '" data-mf="' + k + '">' + label + '<span class="chip-num">' + (nBy[k] || 0) + '</span></button>';
    filterHtml += '<div class="filters">' +
      '<span class="chip total-chip">共 <b>' + base.length + '</b></span>' +
      stChip("instock", "在库") +
      (hasBeadCat ? stChip("unplayed", "未盘玩") + stChip("ready", "待盘玩") + stChip("playing", "盘玩中") + stChip("done", "已挂瓷") + stChip("wearing", "佩戴中") : "") +
      (hasPuzzleCat ? stChip("puzzle_pending", "待拼") + stChip("puzzle_done", "已拼") : "") +
      stChip("gifted", "已送人") +
      (selectFilters.size ? '<button type="button" class="chip clear-chip" id="clearSt">✕ 清除状态</button>' : "") +
      '</div>';

    // 颜色多选 chips（每项带计数）
    filterHtml += '<div class="filters">' +
      (window.Color ? window.Color.COLOR_LIST.map((c) => '<button type="button" class="chip' + (selectColors.has(c.v) ? " active" : "") + '" data-mcolor="' + c.v + '">' + c.label + '<span class="chip-num">' + (colorCount[c.v] || 0) + '</span></button>').join("") : "") +
      (selectColors.size ? '<button type="button" class="chip clear-chip" id="clearColor">✕ 清除颜色</button>' : "") +
      '</div>';

    // 珠型多选 chips（每项带计数）
    filterHtml += '<div class="filters">' +
      '<span class="chip total-chip">珠型</span>' +
      SHAPE_LIST.map((s) => '<button type="button" class="chip' + (selectShapes.has(s.v) ? " active" : "") + '" data-mshape="' + s.v + '">' + s.label + '<span class="chip-num">' + (shapeCount[s.v] || 0) + '</span></button>').join("") +
      (selectShapes.size ? '<button type="button" class="chip clear-chip" id="clearShape">✕ 清除珠型</button>' : "") +
      '</div>';

    // 分类筛选行（文玩专注模式下只出现 菩提/水晶/玉石）
    filterHtml += '<div class="filters">' +
      '<button class="chip' + (!categoryFilter ? " active" : "") + '" data-cat="">全部分类</button>' +
      (focusMode ? wenwanCategories() : cats).map((c) => '<button class="chip' + (categoryFilter === c ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>").join("") +
      "</div>";

    // 排序（5 个按钮，点一下切换升/降序，箭头指示当前方向）
    const arrow = (m) => (sortMode === m ? (sortDir === "asc" ? " ▲" : " ▼") : "");
    filterHtml += '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--text-2)">' +
      '<span>排序</span>' +
      '<div class="seg" id="sortSeg" style="flex:1;flex-wrap:wrap">' +
      '<button type="button" data-sort="arrived" class="' + (sortMode === "arrived" ? "active" : "") + '">🕐 入库' + arrow("arrived") + "</button>" +
      '<button type="button" data-sort="created" class="' + (sortMode === "created" ? "active" : "") + '">⏱ 放置' + arrow("created") + "</button>" +
      '<button type="button" data-sort="price" class="' + (sortMode === "price" ? "active" : "") + '">💰 价格' + arrow("price") + "</button>" +
      '<button type="button" data-sort="playcount" class="' + (sortMode === "playcount" ? "active" : "") + '">🤲 盘玩次数' + arrow("playcount") + "</button>" +
      '<button type="button" data-sort="star" class="' + (sortMode === "star" ? "active" : "") + '">⭐ 星级' + arrow("star") + "</button>" +
      '<button type="button" data-sort="color" class="' + (sortMode === "color" ? "active" : "") + '">🎨 颜色' + arrow("color") + "</button>" +
      "</div></div>";
    filterHtml += "</div>"; // 关闭 filterPanel

    filterHtml += '<div class="search-box"><input id="searchInput" placeholder="搜索名字/品种/工艺/状态/颜色，或输入价格范围如 100-300、>500…" value="' + esc(search) + '"></div>';

    // ===== 今日心选抽卡栏目（主动点击抽取，当天固定） =====
    drawHtml = renderDrawSection();
    if (drawHtml) html += drawHtml;

    // ===== 盘玩计划栏目（轻量提醒，非打卡） =====
    const planHtml = renderPlayPlanSection();
    if (planHtml) html += planHtml;

    // ===== v165-N3：《沁灵纪 · 主线》独立入口（用户裁定：取消详情页里的旧 8 章入口，改用这个） =====
    // ⚠️ 受 MAIN_STORY_OPEN 控制：正文没装帧时**整块不渲染** ——
    //    绝不让用户撞见「一个大卡片，点进去九章全写『正文还没装帧』」的半成品状态。
    if (Spirits.MAIN_STORY_OPEN) {
      const _mCtx = mainStoryCtx();
      const _mList = Spirits.mainChapterState(_mCtx);
      const _mRead = _mList.filter((c) => c.read).length;
      const _mUnread = Spirits.mainUnreadCount(_mCtx);
      const _mNext = _mList.filter((c) => !c.read)[0] || null;
      html += '<button class="main-entry" id="mainEntry">' +
        '<span class="main-entry-ico">📖</span>' +
        '<span class="main-entry-body">' +
        '<span class="main-entry-title">沁灵纪 · 主线' +
        (_mUnread ? '<span class="main-entry-dot">' + _mUnread + "</span>" : "") + "</span>" +
        '<span class="main-entry-sub">' +
        (Spirits.MAIN_STORY_OPEN
          ? (_mNext ? ("下一章 · " + esc(_mNext.title) + "（第 " + _mNext.day + " 天）") : "九章都看完了")
          : "九章正文装帧中 · 入口先放这儿") +
        " · 已看 " + _mRead + "/" + _mList.length +
        "</span></span>" +
        '<span class="main-entry-arrow">›</span></button>';
    }

    html += '<div style="display:flex;gap:8px;margin-bottom:12px">' +
      '<button class="batch-entry" id="btnBatch" style="flex:1">🗂 批量录入</button>' +
      '<button class="batch-entry" id="btnShareMode" style="flex:1;background:linear-gradient(135deg,#b8860b,#a06b2c)">📤 多选</button>' +
      '<button class="batch-entry" id="btnViewToggle" style="flex:none;width:52px;background:var(--card);color:var(--wood);border:1px solid var(--line)" title="切换视图">' + (viewMode === "card" ? "📋" : "🗂") + "</button>" +
      "</div>";

    // 筛选与统计 + 搜索：放在宝贝列表上方，紧挨宝贝列表
    html += filterHtml;

    html += '<div id="gridHolder"></div>';

    view.innerHTML = html;
    bindHomeEvents();
    updateGrid();
  }

  function gridHtml() {
    const list = filtered();
    let h = "";
    if (!list.length) {
      // 离线且本地也没缓存：别显示「还没有收藏任何宝贝」（会吓人一跳，以为数据没了）
      if (offlineMode && !allItems.length) {
        return emptyCardHtml({
          ill: "box", icon: "📴", title: "连不上云端，本地也还没有缓存",
          sub: "请换个网络（或等信号好点）后点上方「重试」<br>你的数据都在云端，不会丢",
        });
      }
      // 文玩专注模式下全被隐藏了：说清楚（数据没丢）
      if (focusMode && hiddenByFocusCount() && !focusVisible(allItems).length) {
        return emptyCardHtml({
          ill: "star", icon: "🎯", title: "文玩专注模式下这里没有宝贝",
          sub: "已隐藏 " + hiddenByFocusCount() + " 件非文玩收藏（数据保留）<br>去设置里关掉就能看到全部",
        });
      }
      return emptyCardHtml({
        ill: allItems.length ? "box" : "bead",
        icon: allItems.length ? "🔍" : "📿",
        title: allItems.length ? "没有找到匹配的宝贝" : "还没有收藏任何宝贝",
        sub: allItems.length ? "换个筛选条件，或清掉搜索词试试" : "点击下方 ＋ 添加第一条吧",
        hint: allItems.length ? "" : "第一条可以先拍张照，价格和店铺都能后补",
      });
    }
    if (viewMode === "list") {
      // ===== 列表视图：缩略图 + 更多信息 =====
      h += '<div class="list-view">';
      for (const it of list) {
        const p = it.photos && it.photos[0];
        const img = p ? '<img src="' + photoUrl(p) + '" loading="lazy" alt="">' :
          '<div class="placeholder" style="font-size:20px">📿</div>';
        const isPuzzleIt = isPuzzleCat(it.category || "");
        const isBeadIt = isBeadCat(it.category || "");
        const statusTxt = it.gifted ? "已送人" :
          (isPuzzleIt ? (it.playStatus === "puzzle_done" ? "已拼" : "待拼") :
            isBeadIt ? beadStatusText(it) : "");
        const statusCls = it.gifted ? "r" :
          (isPuzzleIt ? (it.playStatus === "puzzle_done" ? "g" : "yl") :
            isBeadIt ? beadStatusCls(it) : "");
        const price = it.price != null && it.price !== "" ? "¥" + it.price : "";
        const playCount = Number(it.playCount) || 0;
        const stars = starHtml(it, "list-stars");
        h += '<div class="swipe-row" data-id="' + it.id + '">' +
          '<div class="swipe-actions">' +
          '<button type="button" class="swipe-btn cancel" data-swipe-cancel="1">取消</button>' +
          '<button type="button" class="swipe-btn del" data-swipe-del="' + it.id + '">删除</button>' +
          "</div>" +
          '<div class="list-item" data-id="' + it.id + '">' +
          '<div class="list-thumb">' + img + "</div>" +
          '<div class="list-info">' +
          '<div class="list-name">' + esc(clipName(it.name, NAME_MAX.list)) + "</div>" +
          '<div class="list-sub">' + esc(cardSubText(it)) + (it.category ? " · " + esc(it.category) : "") + "</div>" +
          '<div class="list-meta">' +
          (it.shop ? '<span class="list-shop">🏪 ' + esc(it.shop) + "</span>" : "") +
          (price ? '<span class="list-price">' + price + "</span>" : "") +
          '<span class="list-days">🤲 盘 ' + playCount + " 次</span>" +
          "</div>" +
          "</div>" +
          '<div class="list-right">' +
          colorTagHtml(it) +
          shapeTagHtml(it) +
          softnessTagHtml(it) +
          (it.gifted
            ? '<span class="list-status ' + statusCls + '">' + statusTxt + "</span>"
            : (isPuzzleIt || isBeadIt
              ? '<button type="button" class="list-status ' + statusCls + ' status-toggle" data-id="' + it.id + '" title="点击切换状态">' + statusTxt + "</button>"
              : "")) +
          stars +
          "</div>" +
          "</div></div>";
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
      const statusBadge = statusBadgeHtml(it);
      const stars = starHtml(it, "card-stars");
      const days = DB.formatDays(DB.daysWith(it));
      h += '<div class="card" data-id="' + it.id + '">' +
        '<div class="card-thumb">' + img + badge + statusBadge + stars + "</div>" +
        '<div class="card-body">' +
        '<div class="card-name">' + esc(clipName(it.name, NAME_MAX.card)) + "</div>" +
        '<div class="card-sub">' + colorTagHtml(it) + shapeTagHtml(it) + softnessTagHtml(it) + '<span class="days">' + esc(days) + "</span></div>" +
        "</div></div>";
    }
    return h + "</div>";
  }

  /* 删除宝贝：统一确认弹窗 + 删除 + 刷新（详情页/左滑/长按共用） */
  async function deleteItem(id) {
    const item = allItems.find((x) => x.id === id);
    if (!item) return false;
    const ok = await confirmModal("删除这件宝贝？", "删除「" + (item.name || "未命名") + "」后不可恢复，请确认。", "删除", true);
    if (!ok) return false;
    try {
      await DB.remove(id);
      await loadItems();
      toast("已删除「" + (item.name || "未命名") + "」");
      if (document.getElementById("gridHolder")) updateGrid();
      else router();
      return true;
    } catch (err) {
      toast("删除失败：" + err.message);
      return false;
    }
  }

  /* 列表视图：左滑露出「取消 / 删除」；卡片视图：长按弹出删除确认 */
  function bindSwipeDelete() {
    const OPEN = 152; // 两个按钮总宽
    let openRow = null;
    const closeRow = (row) => {
      if (!row) return;
      const c = row.querySelector(".list-item");
      if (c) { c.style.transition = "transform .2s"; c.style.transform = ""; }
      row.dataset.open = "";
      if (openRow === row) openRow = null;
    };
    view.querySelectorAll(".swipe-row").forEach((row) => {
      const content = row.querySelector(".list-item");
      if (!content) return;
      let sx = 0, sy = 0, dx = 0, dragging = false, decided = false, swiped = false;
      content.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) return;
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        dx = row.dataset.open === "1" ? -OPEN : 0;
        dragging = true; decided = false; swiped = false;
        content.style.transition = "none";
      }, { passive: true });
      content.addEventListener("touchmove", (e) => {
        if (!dragging) return;
        const t = e.touches[0];
        const mx = t.clientX - sx, my = t.clientY - sy;
        if (!decided) {
          if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
          decided = true;
          // 竖向位移占优 → 判定为滚动，放弃滑动删除
          if (Math.abs(mx) <= Math.abs(my)) { dragging = false; content.style.transition = ""; return; }
        }
        const base = row.dataset.open === "1" ? -OPEN : 0;
        dx = Math.max(-OPEN, Math.min(0, base + mx));
        e.preventDefault();          // 阻止页面横向/纵向滚动
        content.style.transform = "translateX(" + dx + "px)";
        swiped = true;
      }, { passive: false });
      const finish = () => {
        if (!dragging) return;
        dragging = false;
        content.style.transition = "transform .2s";
        if (dx < -OPEN / 2) {
          content.style.transform = "translateX(-" + OPEN + "px)";
          row.dataset.open = "1";
          if (openRow && openRow !== row) closeRow(openRow);
          openRow = row;
        } else {
          content.style.transform = "";
          row.dataset.open = "";
          if (openRow === row) openRow = null;
        }
        content.dataset.swiped = swiped ? "1" : "";
      };
      content.addEventListener("touchend", finish);
      content.addEventListener("touchcancel", finish);
    });
    // 删除 / 取消 按钮
    view.querySelectorAll("[data-swipe-del]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = b.closest(".swipe-row");
      await deleteItem(b.dataset.swipeDel);
      closeRow(row);
    }));
    view.querySelectorAll("[data-swipe-cancel]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      closeRow(b.closest(".swipe-row"));
    }));
    // 卡片视图长按 → 删除确认（桌面鼠标按住亦可）
    view.querySelectorAll(".card").forEach((c) => {
      let timer = null, moved = false;
      const start = () => {
        moved = false;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; if (!moved) deleteItem(c.dataset.id); }, 550);
      };
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      c.addEventListener("touchstart", start, { passive: true });
      c.addEventListener("touchmove", () => { moved = true; cancel(); }, { passive: true });
      c.addEventListener("touchend", cancel);
      c.addEventListener("touchcancel", cancel);
      c.addEventListener("mousedown", start);
      c.addEventListener("mouseup", cancel);
      c.addEventListener("mouseleave", cancel);
    });
  }

  function bindCardEvents() {
    view.querySelectorAll(".card, .list-item").forEach((c) => c.addEventListener("click", (e) => {
      // 左滑过 / 当前处于滑开状态 → 不跳详情（先收起）
      const row = c.closest ? c.closest(".swipe-row") : null;
      if (row && row.dataset.open === "1") {
        e.preventDefault(); e.stopPropagation();
        const cc = row.querySelector(".list-item");
        if (cc) { cc.style.transition = "transform .2s"; cc.style.transform = ""; }
        row.dataset.open = "";
        return;
      }
      if (c.dataset.swiped === "1") { c.dataset.swiped = ""; return; }
      location.hash = "#/item/" + c.dataset.id;
    }));
    bindStatusToggles();
    bindStars();
    bindSwipeDelete();
  }

  /* 喜欢/取消喜欢（卡片 + 列表，点击 ❤️/🤍） */
  function bindHomeEvents() {
    // 等级条 → 任务页
    const lb = $("#levelBar");
    if (lb) lb.onclick = () => location.hash = "#/quest";
    const qh = $("#btnQuestHint");
    if (qh) qh.onclick = () => location.hash = "#/quest";
    // 连续打卡条 → 滚动到盘玩计划
    const sb = $("#streakBar");
    if (sb) sb.onclick = () => {
      const plan = document.querySelector(".plan-card");
      if (plan) plan.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    // v165-N3：《沁灵纪 · 主线》独立入口 → #/main
    const me = $("#mainEntry");
    if (me) me.onclick = () => { location.hash = "#/main"; };
    // 折叠筛选面板（展开态持久化，点击筛选 chip 不收起）
    const ft = $("#filterToggle");
    if (ft) ft.onclick = () => {
      filterOpen = !filterOpen;
      try { localStorage.setItem("ww_filter_open", filterOpen ? "1" : "0"); } catch (e) {}
      const panel = $("#filterPanel");
      const arrow = $("#filterArrow");
      if (panel) panel.style.display = filterOpen ? "" : "none";
      if (arrow) arrow.style.transform = filterOpen ? "rotate(180deg)" : "";
    };
    // 隐藏已送人开关
    const hg = $("#hideGifted");
    if (hg) hg.onchange = () => {
      hideGifted = hg.checked;
      localStorage.setItem("ww_hide_gifted", hideGifted ? "1" : "0");
      renderHome();
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
    // 多选状态 chips（data-mf）
    view.querySelectorAll(".chip[data-mf]").forEach((c) => c.addEventListener("click", () => {
      const k = c.dataset.mf;
      if (selectFilters.has(k)) selectFilters.delete(k);
      else selectFilters.add(k);
      renderHome();
    }));
    // 多选颜色 chips（data-mcolor）
    view.querySelectorAll(".chip[data-mcolor]").forEach((c) => c.addEventListener("click", () => {
      const k = c.dataset.mcolor;
      if (selectColors.has(k)) selectColors.delete(k);
      else selectColors.add(k);
      renderHome();
    }));
    // 多选珠型 chips（data-mshape）
    view.querySelectorAll(".chip[data-mshape]").forEach((c) => c.addEventListener("click", () => {
      const k = c.dataset.mshape;
      if (selectShapes.has(k)) selectShapes.delete(k);
      else selectShapes.add(k);
      renderHome();
    }));
    // 清除状态/颜色/珠型筛选
    const cs = $("#clearSt"); if (cs) cs.onclick = () => { selectFilters.clear(); renderHome(); };
    const cc = $("#clearColor"); if (cc) cc.onclick = () => { selectColors.clear(); renderHome(); };
    const csh = $("#clearShape"); if (csh) csh.onclick = () => { selectShapes.clear(); renderHome(); };
    // 分类 chips（用 data-cat 区分）
    view.querySelectorAll(".chip[data-cat]").forEach((c) => c.addEventListener("click", () => {
      categoryFilter = c.dataset.cat || "";
      view.querySelectorAll(".chip[data-cat]").forEach((x) => x.classList.toggle("active", x === c));
      updateGrid();
    }));
    // 排序：点当前维度切换升/降序，点其他维度切换维度
    view.querySelectorAll("#sortSeg button").forEach((b) => b.onclick = () => {
      const chosen = b.dataset.sort;
      if (sortMode === chosen) {
        // 切方向：asc ↔ desc
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortMode = chosen;
        // 颜色默认浅→深(asc)；价格/盘玩次数默认多→少(desc)；时间默认新→旧(desc)
        sortDir = chosen === "color" ? "asc" : "desc";
      }
      localStorage.setItem("ww_sortmode", sortMode);
      localStorage.setItem("ww_sortdir", sortDir);
      sortItems();
      renderHome(); // 重新渲染整个首页，让排序按钮箭头更新
    });
    // 今日心选抽卡
    const bd = $("#btnDraw");
    if (bd) bd.onclick = () => {
      const res = Game.drawRecommendation(allItems, 3);
      if (!res.items.length) { toast("暂无可抽的串：先把珠子设为待盘玩/盘玩中吧"); return; }
      setDrawResult(res);
      renderHome();
      toast("已抽取今日心选 " + res.items.length + " 串");
    };
    const br = $("#btnRedraw");
    if (br) br.onclick = () => {
      const salt = Math.floor(Math.random() * 1000000); // 每次重抽不同盐
      const res = Game.drawRecommendation(allItems, 3, salt);
      res.salt = salt;
      if (!res.items.length) { toast("暂无可抽的串"); return; }
      setDrawResult(res);
      renderHome();
      toast("已重新抽取");
    };
    // 抽卡结果点击卡片 → 详情（无 data-id 的"更多待盘"卡片跳过，避免跳到 undefined）
    view.querySelectorAll(".draw-item").forEach((d) => d.addEventListener("click", (e) => {
      if (d.dataset.more) return; // 交给下面的"更多"专门处理
      if (!d.dataset.id) return;
      e.stopPropagation();
      location.hash = "#/item/" + d.dataset.id;
    }));
    // 盘玩计划：点卡片 → 详情
    view.querySelectorAll(".plan-cell[data-id]").forEach((c) => c.addEventListener("click", (e) => {
      e.stopPropagation();
      location.hash = "#/item/" + c.dataset.id;
    }));
    // 盘玩计划：点 ✓ → 今日已盘（带完成动画）
    view.querySelectorAll(".plan-done-btn").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const item = allItems.find((x) => x.id === b.dataset.id);
      if (!item) return;
      if (b.disabled) return;
      b.disabled = true;
      const cell = b.closest(".plan-cell");
      try {
        await markPlayedToday(item);
        // 播放「完成」动画
        b.classList.add("done");
        if (cell) {
          cell.classList.add("celebrate");
          const days = cell.querySelector(".plan-days");
          if (days) { days.textContent = "今天盘过 ✓"; days.classList.remove("urgent"); days.classList.add("done-today"); }
        }
        toast("✅ 已完成！今天盘过「" + (item.name || "未命名") + "」");
        // 让动画播完再刷新（刷新后它就从计划里消失了）
        setTimeout(() => {
          const onHome = (location.hash === "#/" || location.hash === "" || location.hash === "#");
          if (onHome && document.getElementById("gridHolder")) renderHome();
        }, 900);
      } catch (err) {
        b.disabled = false;
        toast("记录失败：" + err.message);
      }
    }));
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
  // v93 文玩专注模式：只保留「文玩/珠串」类分类，其余分类（拼图/动漫周边/盲盒等）只在界面隐藏
  // —— 数据一律不删（云端照旧），关掉开关全部回来
  const WENWAN_CATS = ["菩提", "水晶", "玉石"];
  const isWenwanCat = (cat) => WENWAN_CATS.includes(cat || "");
  function wenwanCategories() {
    const have = getCategories().filter(isWenwanCat);
    // 至少保证有菩提（默认分类里一定有）；用户自定义过分类也不影响
    return have.length ? have : ["菩提"];
  }
  // 当前该显示哪些宝贝（专注模式开启时过滤掉非文玩分类）
  function focusVisible(list) {
    const arr = list || allItems;
    return focusMode ? arr.filter((i) => isWenwanCat(i.category || "")) : arr.slice();
  }
  function hiddenByFocusCount() {
    if (!focusMode) return 0;
    return allItems.filter((i) => !isWenwanCat(i.category || "")).length;
  }
  function saveCategories(arr) {
    const cleaned = arr.map((c) => c.trim()).filter(Boolean);
    const uniq = [...new Set(cleaned)];
    try { localStorage.setItem("ww_categories", JSON.stringify(uniq)); } catch (e) {}
    return uniq;
  }
  function categoryOptions(selected) {
    const cats = focusMode ? wenwanCategories() : getCategories();
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

  /* ---------- 累计花费隐私 ---------- */
  function getHideSpend() {
    return localStorage.getItem("ww_hide_spend") === "1";
  }
  function setHideSpend(hide) {
    localStorage.setItem("ww_hide_spend", hide ? "1" : "0");
  }

  /* ---------- 店铺输入记忆 ---------- */
  function getShopMemory() {
    try {
      const raw = localStorage.getItem("ww_shops");
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function rememberShop(shop) {
    if (!shop || !shop.trim()) return;
    let list = getShopMemory();
    list = list.filter((s) => s !== shop);
    list.unshift(shop);
    try { localStorage.setItem("ww_shops", JSON.stringify(list.slice(0, 20))); } catch (e) {}
  }
  function removeShopMemory(shop) {
    let list = getShopMemory().filter((s) => s !== shop);
    try { localStorage.setItem("ww_shops", JSON.stringify(list)); } catch (e) {}
  }
  // 生成历史店铺 chips
  function shopMemoryHtml(currentVal) {
    const list = getShopMemory();
    if (!list.length) return "";
    let h = '<div class="shop-memory">';
    list.forEach((s) => {
      const active = s === currentVal ? " active" : "";
      h += '<span class="shop-chip' + active + '">' +
        '<button type="button" class="shop-chip-use" data-shop="' + esc(s) + '">' + esc(s) + "</button>" +
        '<button type="button" class="shop-chip-del" data-shop="' + esc(s) + '">✕</button>' +
        "</span>";
    });
    h += "</div>";
    return h;
  }

  /* ---------- 主题系统 ---------- */
  /* ---------- 主题（v113 起固定为「文玩手账」皮肤，设置里的主题选项已撤销） ----------
     原来有 10 套主题（浅色/深色/跟随系统/多巴胺×3/莫兰迪×4）。UI 升级成统一手账风后，
     只保留这一套：把 data-theme 固定成 light（老用户存在本地的旧主题也会被覆盖掉），
     style.css 里的其它主题变量留着不影响（css/skin.css 只覆盖浅色这一套配色）。 */
  const THEME_ID = "light";
  function getTheme() { return THEME_ID; }
  function applyTheme() { document.documentElement.setAttribute("data-theme", THEME_ID); }
  function initTheme() {
    applyTheme();
    try { localStorage.removeItem("ww_theme"); } catch (e) { /* 忽略 */ }
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
    // isNew（新建）：默认选中第一个珠子态(unplayed)或拼图待拼；否则按 current 匹配
    const active = isNew ? false : (current === v);
    return '<button type="button" data-v="' + v + '" class="' + (active ? "active" : "") + '">' + label + "</button>";
  }

  /* ---------- 详情页 ---------- */
  /* ---------- 详情页：上一个 / 下一个宝贝 ---------- */
  // 哪些页面算「列表页」（从这些页面进详情，返回时要回到原位）
  function isListHash(h) {
    return h === "#/" || h === "#" || h === "#/fav" || (h || "").startsWith("#/box/");
  }
  // 收集当前页面上「正在显示」的宝贝顺序（就是用户眼前看到的排列，含筛选/排序结果）
  function currentNavIds() {
    const h = location.hash || "#/";
    // 喜欢展柜是轮播（没有 data-id），按同样规则取 5 星宝贝
    if (h === "#/fav") return allItems.filter((i) => (Number(i.star) || 0) >= 5).map((i) => i.id);
    const ids = [];
    const push = (el) => {
      const id = el.dataset.id;
      if (id && ids.indexOf(id) < 0) ids.push(id);
    };
    // 优先取收藏列表主体（卡片/列表视图），跳过今日心选与盘玩计划
    view.querySelectorAll(".grid [data-id], .list-view [data-id], .list-item[data-id]").forEach(push);
    if (ids.length) return ids;
    view.querySelectorAll("[data-id]").forEach(push);
    return ids;
  }
  // 当前详情在浏览序列中的位置
  function detailNavInfo(id) {
    let list = _navList && _navList.length ? _navList.slice() : [];
    // 兜底：直接开链接进详情（没有来源页）时，用首页当前筛选排序后的列表
    if (list.indexOf(id) < 0) list = filtered().map((x) => x.id);
    const i = list.indexOf(id);
    return {
      index: i < 0 ? 0 : i,
      total: list.length,
      prevId: i > 0 ? list[i - 1] : null,
      nextId: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
    };
  }
  // 左右滑动主图切换上一个/下一个
  function bindDetailSwipe(navInfo) {
    const hero = view.querySelector(".detail-hero");
    if (!hero || navInfo.total < 2) return;
    let sx = 0, sy = 0, tracking = false;
    hero.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      tracking = true;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    hero.addEventListener("touchend", (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      // 只认「明显的横向滑动」，竖向滑动/轻点不处理
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      _detailSwipedAt = Date.now();
      const target = dx < 0 ? navInfo.nextId : navInfo.prevId;   // 左滑=下一个，右滑=上一个
      if (target) location.hash = "#/item/" + target;
      else toast(dx < 0 ? "已经是最后一个啦" : "已经是第一个啦");
    }, { passive: true });
  }

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
      (isBeadCat(it.category || "")
        ? '<span class="tag ' + beadStatusCls(it) + '">' + esc(beadStatusText(it)) + "</span>"
        : (isPuzzleCat(it.category || "") ? (it.playStatus === "puzzle_done" ? '<span class="tag g">已拼</span>' : '<span class="tag yl">待拼</span>') : "")) +
      (it.craft ? '<span class="tag">' + esc(it.craft) + "</span>" : "") +
      (it.beadShape ? '<span class="tag">📿 ' + esc(shapeLabel(it.beadShape)) + "</span>" : "") +
      (it.softness ? '<span class="tag soft-' + esc(it.softness) + '">🍡 ' + esc(softnessLabel(it.softness)) + "</span>" : "") +
      (it.category ? '<span class="tag">' + esc(it.category) + "</span>" : "");

    let html = "";
    // 上一个 / 下一个（不用返回列表再进来；sticky 固定在顶栏下方，翻多久都在）
    const navInfo = detailNavInfo(id);
    if (navInfo.total > 1) {
      html += '<div class="detail-nav">' +
        '<button type="button" class="detail-nav-btn" id="navPrev"' + (navInfo.prevId ? "" : " disabled") + '>‹ 上一个</button>' +
        '<span class="detail-nav-pos">' + (navInfo.index + 1) + " / " + navInfo.total + "</span>" +
        '<button type="button" class="detail-nav-btn" id="navNext"' + (navInfo.nextId ? "" : " disabled") + '>下一个 ›</button>' +
        "</div>";
    }
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
    // 珠型：显示 + 可点击修改
    html += infoItem("珠型", (it.beadShape ? esc(shapeLabel(it.beadShape)) : "—") + ' <button type="button" class="link-btn" id="editShape">' + (it.beadShape ? "修改" : "设置") + "</button>", true);
    html += infoItem("入手价格", it.price != null && it.price !== "" ? "¥" + esc(String(it.price)) : "—");
    html += infoItem("购买店铺", esc(it.shop || "—"), true);
    // 盘玩时长（上次盘玩 → 现在）：所有菩提类都显示，可手动设置上次盘玩时间
    if (isBeadCat(it.category || "")) {
      if (it.playStatus === "wearing") {
        // 佩戴中：天天戴着的串只管戴不用盘 → 不显示盘玩时长/盘玩周期，只显示佩戴说明 + 历史盘玩次数
        html += infoItem("佩戴状态", "🖐 正在佩戴 · 不参与盘玩计划与今日心选（挂着戴就是一直在盘它）", true);
        html += infoItem("累计盘玩次数", (Number(it.playCount) || 0) + " 次", true);
      } else {
      if (it.lastPlayedAt) {
        const restDays = Math.floor((Date.now() - it.lastPlayedAt) / 86400000);
        const lpDate = new Date(it.lastPlayedAt);
        html += infoItem("盘玩时长", "已放置 " + restDays + " 天（上次盘玩 " + (lpDate.getMonth() + 1) + "/" + lpDate.getDate() + "）<button type=\"button\" class=\"link-btn\" id=\"editLastPlayed\">修改</button>", true);
      } else {
        html += infoItem("盘玩时长", "未记录 <button type=\"button\" class=\"link-btn\" id=\"editLastPlayed\">设置上次盘玩</button>", true);
      }
      html += infoItem("盘玩次数", (Number(it.playCount) || 0) + " 次", true);
      // 首次盘玩时间（可手动设置）+ 盘玩周期（从开始盘到盘好大概多久）
      if (it.firstPlayedAt) {
        const fp = new Date(it.firstPlayedAt);
        const spanDays = Math.floor((Date.now() - it.firstPlayedAt) / 86400000);
        html += infoItem("首次盘玩", (fp.getMonth() + 1) + "月" + fp.getDate() + "日" + (spanDays > 0 ? "（从开始盘至今 " + DB.formatDays(spanDays) + "）" : "（就是今天）") + '<button type="button" class="link-btn" id="editFirstPlayed">修改</button>', true);
        if (it.playStatus === "done" && it.lastPlayedAt && it.lastPlayedAt >= it.firstPlayedAt) {
          const cycle = Math.max(1, Math.round((it.lastPlayedAt - it.firstPlayedAt) / 86400000));
          html += infoItem("盘玩周期", "从开始盘到盘好约 " + DB.formatDays(cycle) + " 🌾", true);
        }
      } else {
        html += infoItem("首次盘玩", '未记录 <button type="button" class="link-btn" id="editFirstPlayed">设置</button>', true);
      }
      }
    }
    // 颜色：显示主色 + 可点击修改（旧值归一化）
    {
      const nc = window.Color ? window.Color.normColor(it.color) : it.color;
      const cLabel = window.Color ? window.Color.colorLabel(nc) : "其他";
      const cHex = window.Color ? window.Color.colorHex(nc) : "#9e9e9e";
      const dotStyle = nc === "duo" || nc === "lightflower" || nc === "deepflower" ? 'background:linear-gradient(135deg,#e53935,#fbc02d,#4caf50,#1976d2)' : ("background:" + cHex);
      const dotBorder = nc === "white" ? "border:1px solid #ddd" : "";
      html += infoItem("主色", '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:-2px;margin-right:5px;' + dotStyle + ';' + dotBorder + '"></span>' + esc(cLabel) + ' <button type="button" class="link-btn" id="editColor">修改</button>', true);
    }
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
    // v166：沁灵进化开关 —— 仅挂瓷的珠子串可开沁（出立绘+CG）；不喜欢的串可设「只当手串」
    if (isBeadCat(it.category || "") && it.playStatus === "done") {
      const _sr = Spirits.load()[it.id];
      const _isSpirit = !(_sr && _sr.spirit === false);
      html += '<div class="sd-card" style="margin-top:14px"><div class="sd-card-title">✨ 沁灵进化</div>' +
        '<div class="sd-line">这只串可以开沁化成沁灵（出立绘 + CG）。不太喜欢它，就关掉，只当手串收藏。</div>' +
        '<button class="btn ' + (_isSpirit ? "ghost" : "primary") + '" id="btnSpiritToggle" style="width:100%;margin-top:8px">' +
        (_isSpirit ? "📿 已开沁 · 点此改为只当手串" : "✨ 当前只当手串 · 点此重新开沁") + '</button></div>';
    }
    html += '<div class="detail-actions">';
    html += '<div class="detail-actions">' +
      '<div class="detail-stars"><span class="detail-stars-label">⭐ 评分</span>' + starHtml(it, "detail-stars") + '<span class="detail-stars-hint">' + itemStars(it) + ' 星' + (itemStars(it) >= 5 ? " · 已进喜欢展柜" : "") + '</span></div>' +
      '<button class="btn ghost" id="btnShare" style="flex:1">分享</button>' +
      '<button class="btn primary" id="btnEdit">编辑</button>' +
      '<button class="btn danger" id="btnDel">删除</button>' +
      "</div></div>";

    view.innerHTML = html;

    // 上一个 / 下一个按钮 + 主图左右滑动切换
    const navPrevBtn = $("#navPrev"), navNextBtn = $("#navNext");
    if (navPrevBtn) navPrevBtn.onclick = () => { if (navInfo.prevId) location.hash = "#/item/" + navInfo.prevId; };
    if (navNextBtn) navNextBtn.onclick = () => { if (navInfo.nextId) location.hash = "#/item/" + navInfo.nextId; };
    bindDetailSwipe(navInfo);

    const openViewer = (idx) => {
      if (!allPics.length) return;
      const viewer = $("#viewer");
      viewer.classList.add("show");
      const show = (i) => {
        $("#viewerImg").src = photoUrl(allPics[i]);
        $("#viewerNav").innerHTML = allPics.map((_, k) =>
          '<button data-i="' + k + '"' + (k === i ? ' style="background:var(--gold)"' : "") + ">" + (k + 1) + "</button>").join("");
        $("#viewerNav").querySelectorAll("button").forEach((b) => b.onclick = () => show(+b.dataset.i));
        viewer._i = i;
      };
      show(idx);
    };
    view.querySelectorAll("[data-view]").forEach((el) => el.addEventListener("click", () => {
      // 刚左右滑动切了串，不要顺手把大图打开
      if (Date.now() - _detailSwipedAt < 400) return;
      openViewer(+el.dataset.view);
    }));
    $("#viewerClose").onclick = () => { $("#viewer").classList.remove("show"); };

    $("#btnTips").onclick = () => showTipsModal(it);
    $("#btnEdit").onclick = () => location.hash = "#/edit/" + it.id;
    bindStars(); // 详情页 5 星评分
    // 修改上次盘玩时间（手动纠偏，用于精确计算放置时长）
    const elp = $("#editLastPlayed");
    if (elp) elp.onclick = (e) => {
      e.stopPropagation();
      promptSetLastPlayed(it, () => renderDetail(id));
    };
    // 修改首次盘玩时间（用于算「从开始盘到盘好」多久）
    const efp = $("#editFirstPlayed");
    if (efp) efp.onclick = (e) => {
      e.stopPropagation();
      promptSetFirstPlayed(it, () => renderDetail(id));
    };
    // 修改主色
    const ec = $("#editColor");
    if (ec) ec.onclick = (e) => {
      e.stopPropagation();
      promptSetColor(it, () => renderDetail(id));
    };
    // 修改珠型
    const esh = $("#editShape");
    if (esh) esh.onclick = (e) => {
      e.stopPropagation();
      promptSetShape(it, () => renderDetail(id));
    };
    $("#btnDel").onclick = async () => {
      const ok = await deleteItem(it.id);
      if (ok) location.hash = "#/";
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
    // v166：沁灵进化开关 —— 翻转 spirit 标记
    const bst = $("#btnSpiritToggle");
    if (bst) bst.onclick = () => {
      const store = Spirits.load();
      const r = Spirits.ensureIn(store, it.id);
      const _nowSpirit = !(r.spirit === false);   // 当前是否「已开沁」（true / undefined 都算开沁）
      r.spirit = !_nowSpirit;                       // 翻转：开沁 <-> 只当手串
      Spirits.save(store);
      toast(r.spirit === false ? "已设为只当手串" : "已重新开沁");
      renderDetail(id);
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
        (isBeadCat(it.category || "") && it.playStatus ? "\n盘玩：" + beadStatusText(it) : "") +
        (isPuzzleCat(it.category || "") && it.playStatus ? "\n状态：" + (it.playStatus === "puzzle_done" ? "已拼" : "待拼") : "");
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
      '<select class="form-select" id="fCategory">' + categoryOptions(editCat || (it ? "" : "菩提")) + '</select></div>';
    html += '<div class="form-group"><div class="form-label" id="fSpeciesLabel">' + speciesLabel + '</div>' +
      '<input class="form-input" id="fSpecies" placeholder="可自由填写或点下方选择" value="' + esc(it ? it.species : "") + '">' +
      '<div class="species-chips" id="speciesChips"></div></div>';
    html += "</div>";

    html += '<div class="form-group" id="fCraftWrap"><div class="form-label">工艺 <small>珠子类</small></div>' +
      '<div class="seg" id="fCraft">' +
      '<button type="button" data-v="干磨" class="' + (!it || it.craft === "干磨" ? "active" : "") + '">干磨</button>' +
      '<button type="button" data-v="水磨" class="' + (it && it.craft === "水磨" ? "active" : "") + '">水磨</button>' +
      '<button type="button" data-v="干抛" class="' + (it && it.craft === "干抛" ? "active" : "") + '">干抛</button>' +
      '<button type="button" data-v="" class="' + (it && it.craft && it.craft !== "干磨" && it.craft !== "水磨" && it.craft !== "干抛" ? "active" : "") + '">其他</button>' +
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
      '<input class="form-input" id="fShop" placeholder="店铺名 / 平台" value="' + esc(it ? it.shop : "") + '">' +
      shopMemoryHtml(it ? it.shop : "") + "</div>";

    // 状态（按分类联动：菩提→盘玩5态，拼图→待拼/已拼，其他分类→无盘玩状态仅已送人）
    const curStatus = it ? (it.playStatus || "") : "";
    const giftStatus = it && it.gifted ? "gifted" : "";
    const isBeadForm = isBeadCat(editCat || "") || isNoPlayCat(editCat || ""); // 菩提或有盘玩态、其他分类无盘玩态但需保留"已送人"
    const isPuzzleForm = isPuzzleCat(editCat || "");
    // 新建时默认：菩提→未盘玩，拼图→待拼，其他→无（仅选已送人前的默认）
    const initSt = it ? normBeadStatus(curStatus, editCat) : (isBeadCat(editCat) ? "unplayed" : isPuzzleForm ? "puzzle_pending" : "");

    let statusBtns = "";
    if (isBeadCat(editCat || "")) {
      // 菩提：盘玩 5 态
      statusBtns = BEAD_STATUS.map((s) => statusButton(s.v, s.label, it ? normBeadStatus(curStatus, editCat) : "unplayed", !it)).join("");
    } else if (isPuzzleForm) {
      // 拼图：待拼/已拼
      statusBtns = statusButton("puzzle_pending", "待拼", it ? curStatus : "puzzle_pending", !it) + statusButton("puzzle_done", "已拼", it ? curStatus : "", !it);
    }
    // 其他分类：不显示盘玩/拼图状态（仅显示下方的"已送人"）
    statusBtns += statusButton("gifted", "已送人", curStatus || giftStatus);

    html += '<div class="form-group"><div class="form-label">状态</div>' +
      '<div class="seg" id="fStatus">' + statusBtns + "</div></div>";

    // 主色选择（手动）
    {
      const curColor = it ? (window.Color ? window.Color.normColor(it.color) : it.color) : "";
      let colorChips = '<button type="button" class="color-chip' + (!curColor ? " active" : "") + '" data-color="">未选</button>';
      (window.Color ? window.Color.COLOR_LIST : []).forEach((c) => {
        const dotStyle = c.v === "duo" || c.v === "lightflower" || c.v === "deepflower" ? 'background:linear-gradient(135deg,#e53935,#fbc02d,#4caf50,#1976d2)' : ("background:" + c.hex);
        const dotBorder = c.v === "white" ? "border:1px solid #ddd" : "";
        colorChips += '<button type="button" class="color-chip' + (curColor === c.v ? " active" : "") + '" data-color="' + c.v + '" style="display:inline-flex;align-items:center;gap:5px">' +
          '<span style="display:block;width:16px;height:16px;border-radius:50%;' + dotStyle + ';' + dotBorder + '"></span>' + c.label + "</button>";
      });
      html += '<div class="form-group"><div class="form-label">主色 <small>自动识别，可手动改</small></div>' +
        '<div class="filters" id="fColorChips">' + colorChips + "</div></div>";
    }

    // 珠型选择（手工，可清除）
    {
      const curShape = it ? (it.beadShape || "") : "";
      let shapeChips = '<button type="button" class="color-chip' + (!curShape ? " active" : "") + '" data-shape="">未选</button>';
      SHAPE_LIST.forEach((s) => {
        shapeChips += '<button type="button" class="color-chip' + (curShape === s.v ? " active" : "") + '" data-shape="' + s.v + '">' + esc(s.label) + "</button>";
      });
      html += '<div class="form-group"><div class="form-label">珠型 <small>手工选择</small></div>' +
        '<div class="filters" id="fShapeChips">' + shapeChips + "</div></div>";
    }

    // 软糯程度（手工，可清除）
    {
      const curSoft = it ? (it.softness || "") : "";
      let softChips = '<button type="button" class="color-chip' + (!curSoft ? " active" : "") + '" data-soft="">未标注</button>';
      SOFTNESS_LIST.forEach((s) => {
        softChips += '<button type="button" class="color-chip' + (curSoft === s.v ? " active" : "") + '" data-soft="' + s.v + '">🍡 ' + esc(s.label) + "</button>";
      });
      html += '<div class="form-group"><div class="form-label">软糯程度 <small>手感，可留空</small></div>' +
        '<div class="filters" id="fSoftChips">' + softChips + "</div></div>";
    }

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
    let _catInited = false; // 是否已初始化（区分首次渲染 vs 分类切换）
    function refreshSpeciesByCategory() {
      const cat = fCat.value;
      const cfg = Categories.getCategoryConfig(cat);
      const labelEl = $("#fSpeciesLabel");
      if (labelEl) labelEl.textContent = cfg.label || "品种/材质";
      const spEl = $("#fSpecies");
      if (spEl) {
        spEl.setAttribute("placeholder", "可自由填写或点下方选择");
        const chips = $("#speciesChips");
        if (chips) {
          chips.innerHTML = cfg.options.map((s) =>
            '<button type="button" class="species-chip" data-s="' + esc(s) + '">' + esc(s) + "</button>"
          ).join("");
          chips.querySelectorAll(".species-chip").forEach((b) => b.onclick = () => {
            spEl.value = b.dataset.s;
          });
        }
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
          // 首次用 it 原始值；分类切换后用已选值
          const initVal = sizeField === "pieces" ? (it && it.pieceCount) : (it && it.beadSize);
          const curVal = _catInited ? sizeSel.value : initVal;
          sizeSel.innerHTML = sizeField === "pieces" ? pieceOptions(curVal || null) : beadSizeOptions(curVal || null);
          if (!curVal) sizeSel.value = sizeField === "pieces" ? 1000 : 14;
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
          if (BEAD_STATUS.some((s) => s.v === v)) show = isBeadCat(cat); // 菩提专用
          b.style.display = show ? "" : "none";
        });
        // 首次用 it 的 playStatus；分类切换后保留已选状态
        const savedStatus = !_catInited
          ? ((it && (it.playStatus || (it.gifted ? "gifted" : ""))) || (isBeadCat(cat) ? "unplayed" : isPuzzle ? "puzzle_pending" : ""))
          : (st.querySelector("button.active") ? st.querySelector("button.active").dataset.v : (isBeadCat(cat) ? "unplayed" : isPuzzle ? "puzzle_pending" : ""));
        const statusBtn = st.querySelector('button[data-v="' + savedStatus + '"]');
        const targetBtn = statusBtn && statusBtn.style.display !== "none"
          ? statusBtn
          : st.querySelector("button:not([style*='display: none'])");
        if (targetBtn) {
          st.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
          targetBtn.classList.add("active");
        }
      }
    }
    if (fCat) {
      fCat.addEventListener("change", refreshSpeciesByCategory);
      refreshSpeciesByCategory();   // 首次调用（_catInited=false → 用 it 原始值）
    }
    _catInited = true;               // 之后再调用用已选值

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
    // 主色 chips 点击切换
    const fColorChips = $("#fColorChips");
    if (fColorChips) {
      fColorChips.querySelectorAll(".color-chip").forEach((b) => b.onclick = () => {
        fColorChips.querySelectorAll(".color-chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      });
    }
    // 珠型 chips 点击切换
    const fShapeChips = $("#fShapeChips");
    if (fShapeChips) {
      fShapeChips.querySelectorAll(".color-chip").forEach((b) => b.onclick = () => {
        fShapeChips.querySelectorAll(".color-chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      });
    }
    // 软糯程度 chips 点击切换
    const fSoftChips = $("#fSoftChips");
    if (fSoftChips) {
      fSoftChips.querySelectorAll(".color-chip").forEach((b) => b.onclick = () => {
        fSoftChips.querySelectorAll(".color-chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      });
    }


    // 盘玩记录：珠子类（盘玩中/已挂瓷）才显示输入框
    const showPlayedNote = it && !it.gifted && isBeadCat(it.category || "") &&
      (it.playStatus === "playing" || it.playStatus === "done" || it.playedNote);
    if (!showPlayedNote) { const pw = $("#playedNoteWrap"); if (pw) pw.style.display = "none"; }

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
        html += '<label class="upload-cell upload-add" style="cursor:pointer"><span class="upload-add-inner"><span class="plus">＋</span><span>' + (isShot ? "截图" : "照片") + "</span></span></label>";
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
          const cf = await ImageUtil.compressFile(f, { maxSizeKB: 200, maxDim: 1920 });
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
          const cf = await ImageUtil.compressFile(f, { maxSizeKB: 200, maxDim: 2000 });
          shots.push(DB.fileToPhoto(cf));
        } catch (err) {
          shots.push(DB.fileToPhoto(f));
        }
      }
      renderUploadGrid("#shotGrid", shots, () => $("#shotInput").click(), true);
      // 订单截图仅保存，不自动识别（识别准确率有限）
    };
    renderUploadGrid("#photoGrid", photos, () => $("#photoInput").click(), false);
    renderUploadGrid("#shotGrid", shots, () => $("#shotInput").click(), true);

    // 店铺记忆交互
    view.querySelectorAll(".shop-chip-use").forEach((b) => b.onclick = () => {
      $("#fShop").value = b.dataset.shop;
    });
    view.querySelectorAll(".shop-chip-del").forEach((b) => b.onclick = () => {
      removeShopMemory(b.dataset.shop);
      const shopVal = $("#fShop").value;
      const wrap = b.closest(".shop-memory");
      if (wrap) wrap.outerHTML = shopMemoryHtml(shopVal);
      toast("已删除店铺记忆");
    });

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
        rememberShop(item.shop);
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
        item.playStatus = statusVal === "gifted" ? "" : normBeadStatus(statusVal, item.category);
        item.gifted = statusVal === "gifted";
        const gdv = $("#fGiftedDate").value;
        if (item.gifted) {
          item.giftedAt = gdv ? new Date(gdv + "T12:00:00").getTime() : (item.giftedAt || Date.now());
        } else {
          item.giftedAt = null;
        }
        item.played = item.playStatus === "playing";
        item.playedNote = $("#fPlayedNote").value.trim();
        item.note = $("#fNote").value.trim();

        if (!item.name) { toast("请给宝贝起个名字"); return; }

        // 上传新照片到云端，并清理被移除的旧图
        const oldPhotos = it && it.photos ? it.photos.slice() : [];
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
        // 删除编辑时被移除的旧云端图片（避免残留占空间）
        if (isEdit) {
          const kept = new Set(item.photos.map((p) => p.url));
          const delTasks = [];
          oldPhotos.forEach((op) => {
            if (op.path && !kept.has(op.url)) delTasks.push(DB.deletePhoto(op.path));
          });
          const keptShots = new Set(item.screenshots.map((p) => p.url));
          (it.screenshots || []).forEach((op) => {
            if (op.path && !keptShots.has(op.url)) delTasks.push(DB.deletePhoto(op.path));
          });
          await Promise.all(delTasks);
        }

        // 优先用手动选的主色（表单 color-chip）
        const colorChip = view.querySelector("#fColorChips .color-chip.active");
        if (colorChip) item.color = colorChip.dataset.color || "";

        // 珠型（表单 shape-chip；选"未选"则为空）
        const shapeChip = view.querySelector("#fShapeChips .color-chip.active");
        item.beadShape = shapeChip ? (shapeChip.dataset.shape || "") : "";

        // 软糯程度（表单 soft-chip；选"未标注"则为空）
        const softChip = view.querySelector("#fSoftChips .color-chip.active");
        item.softness = softChip ? (softChip.dataset.soft || "") : "";

        // 自动识别主色：未手动选色且照片存在时，识别第一张主照片的颜色
        if (!item.color && item.photos.length && window.Color) {
          const first = item.photos[0];
          const src = first.url || (first.data ? URL.createObjectURL(first.data) : "");
          if (src) {
            try { const c = await window.Color.detectColor(src); if (c) item.color = c; } catch (e) {}
          }
        }

        const saved = await DB.put(item);
        // 云端保存成功；随后重新拉列表若因网络失败，不能报「保存失败」（否则用户会重复保存）
        try {
          await loadItems();
          writeItemsCache();
        } catch (e) {
          if (saved && saved.id) {
            const i = allItems.findIndex((x) => x.id === saved.id);
            if (i >= 0) allItems[i] = saved; else allItems.unshift(saved);
            sortItems();
          }
          toast("已保存到云端（列表暂时没刷新，网络恢复后会同步）");
          renderHome();
          location.hash = "#/";
          return;
        }
        toast(isEdit ? "已保存修改" : "已收入收藏馆 🎉");
        renderHome();
        location.hash = "#/";
        window.scrollTo(0, 0);
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

    const statItemsSet = focusVisible(allItems);
    const inStock = statItemsSet.filter((i) => !i.gifted).length;
    const gifted = statItemsSet.filter((i) => i.gifted).length;
    const played = statItemsSet.filter((i) => isBeadCat(i.category || "") && i.playStatus !== "" && i.playStatus !== "unplayed").length;

    // 称号/徽章数据（等级/经验仍按全量算，避免专注模式下掉级）
    const lvGame = Game.getLevel(Game.computeXp(allItems, playDays).xp);
    const allAch = Stats.getAchievements(statItemsSet, playDays);
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
    html += '<div class="section-title">🎯 文玩专注模式</div>';
    html += paperCardHtml('<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
      '<div style="min-width:0"><div style="font-size:13px;font-weight:600">只显示文玩类（菩提 / 水晶 / 玉石）</div>' +
      '<div style="font-size:11px;color:var(--text-2);margin-top:3px">开启后隐藏「分类」页和其它收藏类型（拼图/周边/盲盒等）。' +
      '<b>数据一条都不会删</b>，关掉开关立刻全部回来。</div></div>' +
      '<label class="switch"><input type="checkbox" id="focusSwitch"' + (focusMode ? " checked" : "") + '><span class="switch-slider"></span></label>' +
      "</div>" +
      (focusMode && hiddenByFocusCount()
        ? '<div style="font-size:11px;color:var(--gold);margin-top:8px">当前已隐藏 ' + hiddenByFocusCount() + " 件非文玩宝贝</div>"
        : ""));

    // ===== 2.5 沁灵 · 绘图通道 / 文字通道 =====
    {
      const cfg = Spirits.getImageCfg();
      const info = Spirits.providerInfo(cfg);
      const tin = Spirits.textInfo();
      const spiritCount = spiritItems().length;
      html += '<div class="section-title">🍡 沁灵</div>';
      html += '<button class="setting-item" id="btnImgCfg"><div>' +
        '<div class="t">🎨 沁灵形象 · 绘图通道</div>' +
        '<div class="d">当前：' + esc(info.label) + ' · ' + esc((Spirits.STYLE_PRESETS[cfg.style] || Spirits.STYLE_PRESETS[Spirits.DEFAULT_STYLE]).label) +
        " · " + spiritCount + " 只沁灵 · 本机累计出图 " + genTotal() + " 张</div>" +
        '</div><span style="color:var(--text-2)">›</span></button>';
      html += '<button class="setting-item" id="btnTextCfg"><div>' +
        '<div class="t">🤖 AI 文字模型（助手 + 人设/日记/剧情）</div>' +
        '<div class="d">当前：' + esc(tin.label) + (tin.model ? " · " + esc(tin.model) : "") + (tin.key ? " · 已填 key" : " · 未填 key（沁灵走本地模板）") +
        '</div></div><span style="color:var(--text-2)">›</span></button>';
      const ow = Spirits.getOwner();
      html += '<button class="setting-item" id="btnOwner"><div>' +
        '<div class="t">👤 主人设定（昵称 / 性别 / 头像）</div>' +
        '<div class="d">当前：' + esc(ow.name || "未填昵称") + " · " + (ow.gender === "boy" ? "男生（用「他」）" : "女生（用「她」）") +
        " · " + (ow.avatar ? "已设头像" : "未设头像（群里显示「我」）") +
        ' · 日记与剧情会照这个写</div></div><span style="color:var(--text-2)">›</span></button>';
      // v165：一键出全套 BG（21 张场景背景；已出好的不复用不出图，失败可续）
      const bgAll = Object.keys(Spirits.BG_CATALOG || {});
      // v165：静态图（assets/bg/*.jpg）视为「已出好」⇒ 只有**无 src 且没出过**的才要画
      const bgStatic = bgAll.filter((k) => !!(Spirits.bgByKey(k) || {}).src).length;
      const bgDone = bgAll.filter((k) => !!bgUrlOf(k)).length;
      const bgTodo = bgAll.length - bgDone;
      html += '<button class="setting-item" id="btnBgAll"><div>' +
        (bgTodo
          ? '<div class="t">🎴 一键出全套 BG（还差 ' + bgTodo + ' 张，约 ¥' + (bgTodo * BG_UNIT).toFixed(2) + '）</div>' +
            '<div class="d">为剧情场景生成永久背景图（云端保存、永不过期）。已出好的不会重出，中途失败可再点一次接着画。' +
            '当前进度：' + bgDone + ' / ' + bgAll.length + '（其中 ' + bgStatic + ' 张已随版本内置）</div>'
          : '<div class="t">🎴 BG 场景背景（' + bgAll.length + ' 张已随版本内置）</div>' +
            '<div class="d">' + bgAll.length + ' 张已随版本内置，无需出图，也不会消耗额度。</div>') +
        '</div><span style="color:var(--text-2)">›</span></button>';
    }

    html += '<div class="section-title">🎖️ 我的称号</div>';
    html += '<div class="paper-card">';
    html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:8px">展示中的称号（点击 ✕ 移除）</div>';
    html += '<div id="myBadges" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px"></div>';
    html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:6px">🏆 称号库（已解锁的，点击选择/取消）</div>';
    html += '<div id="badgeLibrary" style="display:flex;flex-wrap:wrap;gap:8px;max-height:220px;overflow-y:auto"></div>';
    html += "</div>";

    // ===== 3. 外观主题（v113 起取消：UI 统一成「文玩手账」皮肤，不再提供主题切换） =====

    // ===== 4. 收藏盒子管理 =====
    html += '<div class="section-title">收藏盒子管理</div>';
    html += paperCardHtml('<div style="font-size:12px;color:var(--text-2);margin-bottom:8px">自定义收藏盒子（菩提 / 水晶 / 玉石 / 拼图 / 动漫周边…）</div>' +
      '<div id="catList" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px"></div>' +
      '<div style="display:flex;gap:8px">' +
      '<input class="form-input" id="catInput" placeholder="新增盒子，如：盲盒" style="flex:1;padding:9px 10px;font-size:14px">' +
      '<button class="btn primary" id="catAdd" style="flex:none;padding:9px 16px;font-size:14px">添加</button></div>');

    // 内置分类库（可一键恢复已删的内置分类）
    html += '<div style="font-size:12px;color:var(--text-2);margin:10px 0 6px">🧰 内置收藏盒子（删除了可以点回来）</div>';
    html += '<div id="builtinCatList" style="display:flex;flex-wrap:wrap;gap:8px"></div>';
    html += "</div>";

    // ===== 4. 数据与账户 =====
    html += '<div class="section-title">数据与账户</div>';
    html += '<div class="settings-list">';
    html += '<button class="setting-item" id="btnChangePwd"><div><div class="t">🔑 修改密码</div><div class="d">更新当前账号的登录密码</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnExport"><div><div class="t">📤 导出备份</div><div class="d">下载全部数据为备份文件（含图片链接）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnImport"><div><div class="t">📥 导入备份</div><div class="d">从备份文件恢复数据（会覆盖当前数据）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnClear"><div><div class="t">🗑 清空全部数据</div><div class="d">删除所有收藏记录（不可恢复）</div></div><span class="arrow">›</span></button>';
    // v98：这一项已合并到上方「🤖 AI 文字模型」（可在那里选 DeepSeek 官方 / 火山方舟 / 自定义）
    // html += '<button class="setting-item" id="btnAiKey">…</button>';   // 保留代码，入口不再展示
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

    // 沁灵 · 绘图通道配置
    const imgBtn = $("#btnImgCfg");
    if (imgBtn) imgBtn.onclick = () => showImageCfgModal();
    const txtBtn = $("#btnTextCfg");
    if (txtBtn) txtBtn.onclick = () => showTextCfgModal();
    const ownBtn = $("#btnOwner");
    if (ownBtn) ownBtn.onclick = () => showOwnerModal();
    // v165：一键出全套 BG（成本确认 → 进度弹层 → 失败可续）
    const bgBtn = $("#btnBgAll");
    if (bgBtn) bgBtn.onclick = async () => {
      const all = Object.keys(Spirits.BG_CATALOG || {});
      const have = all.filter((k) => bgUrlOf(k)).length;
      const todo = all.length - have;
      // v165：静态图已覆盖全套 ⇒ 直接告知「已随版本内置」，⛔ 不再弹确认框、不触发出图
      if (!todo) {
        const builtin = all.filter((k) => !!(Spirits.bgByKey(k) || {}).src).length;
        toast(builtin === all.length
          ? all.length + " 张 BG 已随版本内置，无需出图 ✅"
          : "全套 " + all.length + " 张 BG 都出好了 ✅");
        return;
      }
      const cost = (todo * BG_UNIT).toFixed(2);
      const yn = await confirmModal("一键出全套 BG",
        "将生成 " + todo + " 张背景图（全套 " + all.length + " 张，已有 " + have + " 张直接复用，不重复计费），约 ¥" + cost +
        "。中途失败可以再点一次接着画，已出好的不会重出。开始吗？", "开始出图", false);
      if (!yn) return;
      const ui = showBgBatchModal();
      const res = await generateAllBg({ progress: (d, t, nm) => ui.setProg(d, t, nm) });
      ui.finish(res.done, res.fail);
      toast("BG 出图完成：成功 " + res.done + " 张" + (res.fail ? "，失败 " + res.fail + " 张" : ""));
    };

    // 主题选择（v113 已取消：皮肤固定为「文玩手账」）

    $("#btnChangePwd").onclick = () => showChangePasswordModal();
    // 文玩专注模式开关
    const fs1 = $("#focusSwitch");
    if (fs1) fs1.onchange = () => {
      focusMode = fs1.checked;
      localStorage.setItem("ww_focus", focusMode ? "1" : "0");
      applyFocusChrome();
      toast(focusMode ? "已开启文玩专注模式（隐藏非文玩分类）" : "已关闭，全部收藏类型回来了");
      renderSettings();
    };
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
    $("#btnAiKey").onclick = async () => {
      const cur = getAiKey();
      const mask = $("#modalMask");
      const modal = $("#modal");
      modal.innerHTML =
        '<h3 style="text-align:center">🤖 AI 助手密钥</h3>' +
        '<p style="text-align:center;color:var(--text-2);font-size:12px;margin-bottom:12px">填你自己的 DeepSeek API key（以 sk- 开头）。key 只存在本机浏览器（localStorage），不写入代码、不入开源仓库，不会上传。到 platform.deepseek.com 可申请。</p>' +
        '<input class="form-input" id="aiKeyInput" placeholder="sk-..." value="' + esc(cur) + '">' +
        '<button class="btn primary" id="aiKeySave" style="width:100%;margin-top:12px">保存</button>' +
        '<button class="btn ghost" id="mCancel" style="width:100%;margin-top:8px">取消</button>';
      modal.hidden = false; modal.style.display = "";
      mask.hidden = false;
      const done = () => { modal.hidden = true; modal.style.display = ""; mask.hidden = true; };
      $("#mCancel").onclick = done;
      const save = () => {
        const v = ($("#aiKeyInput").value || "").trim();
        try { localStorage.setItem("ww_dskey", v); } catch (e) {}
        toast(v ? "已保存你的 DeepSeek key（只存在本机）" : "已清除 key，AI 助手需先填 key");
        done(); renderSettings();
      };
      $("#aiKeySave").onclick = save;
    };
    $("#btnLogout").onclick = async () => {
      const ok = await confirmModal("退出登录？", "退出后本机需要重新登录才能查看。", "退出");
      if (!ok) return;
      await DB.signOut();
      location.hash = "#/auth";
      renderAuth();    };
  }

  /* ---------- 路由 ---------- */
  function router() {
    const h = location.hash || "#/";
    if (h === "#/auth") {
      if (user) { location.hash = "#/"; return; }  // 已登录访问登录页 → 回首页
      renderAuth(); return;
    }
    if (!user) { renderAuth(); return; }

    // 从列表页点进详情：先记住「来源页 + 滚动位置 + 眼前这页的宝贝顺序」
    // 返回时才能回到原来那一屏（不再跳回顶部），详情页也能上一个/下一个翻
    if (h.startsWith("#/item/") && _lastHash && _lastHash !== h && isListHash(_lastHash)) {
      _backMemo = { hash: _lastHash, y: window.scrollY || 0 };
      _navList = currentNavIds();
    }

    if (h === "#/profile") renderProfile();
    else if (h === "#/cat") {
      // 文玩专注模式：分类页暂时隐藏 —— 地址也归位到首页（避免停在 #/cat 显示首页内容）
      if (focusMode) { location.hash = "#/"; return; }
      renderCatPage();
    }
    else if (h === "#/stats") renderStatsPage();
    else if (h === "#/quest") renderQuestPage();
    else if (h === "#/spirit") renderSpiritPage();   // 🍡 沁灵（占原「分类」的导航位）
    else if (h === "#/mainstory") renderMainStoryPage();                                       // v163：沁灵纪（主串集合制选择）
    else if (h === "#/spirits") renderAllSpiritsPage();                                            // 全部沁灵
    else if (h.startsWith("#/spirit/")) renderSpiritDetailPage(decodeURIComponent(h.slice(9)));   // 每只沁灵的独立页面
    else if (h.startsWith("#/room/")) renderRoomPage(decodeURIComponent(h.slice(7)));             // 小房间
    else if (h === "#/town") renderTownPage();                                                    // v157：沁灵巷
    else if (h === "#/album") renderAlbumPage();                                                  // v163b：CG 相册
    else if (h.indexOf("#/events") === 0) renderEventsPage();                                     // v163b：事件回顾（支持 ?owner=）
    else if (h === "#/night") renderNightPage();                                                 // v162：夜话（会话列表）
else if (h.indexOf("#/night/") === 0) {                                                        // v162：#/night/<会话> 或 #/night/<会话>/<事件>
      const seg = decodeURIComponent(h.slice(8)).split("/");
      if (seg.length >= 2 && seg[1]) renderNightTalkPage(seg[0], seg[1]);
      else renderThreadPage(seg[0]);
    }
    
    else if (h === "#/main") renderMainPage();                                                   // v165-N3：沁灵纪 · 主线（独立入口 · 9 章）
    else if (h.indexOf("#/maintalk/") === 0) renderMainTalkPage(Number(h.slice(11)) || 0);        // v165-N3：新 9 章对话页
    else if (h.indexOf("#/talk/") === 0) {                                                        // v161：旧 8 章（⛔ 入口已取消，直接回沁灵页）
      location.hash = "#/spirit/" + h.slice(7).split("/")[0];
    }
    else if (h === "#/fav") renderFavPage();
    else if (h.startsWith("#/box/")) renderBoxPage(decodeURIComponent(h.slice(6)));
    else if (h === "#/" || h === "#") renderHome();
    else if (h.startsWith("#/item/")) renderDetail(h.slice(7));
    else if (h.startsWith("#/edit/")) renderForm(h.slice(7));
    else if (h === "#/new") renderForm(null);
    else if (h === "#/settings") renderSettings();
    else renderHome();

    updateTabbar();

    // v163b：按路由给 body 加类，用于隐藏 AI 助手浮窗（沁灵 / 夜话沉浸区）
    {
      const _bh = location.hash;
      document.body.classList.toggle("route-spirit", _bh === "#/spirit" || _bh.indexOf("#/spirit/") === 0);
      document.body.classList.toggle("route-night", _bh === "#/night" || _bh.indexOf("#/night/") === 0);
    }

    // v113：每次切页给 #view 加一个入场转场（重排一次动画，避免只播第一次）
    // 0.9 秒后再给一个 anim-settled 兜底：万一动画没跑起来（省电模式/无头浏览器等），
    // 靠 CSS 强制落回最终状态，避免元素卡在 opacity:0 看着"整页发白"
    try {
      view.classList.remove("page-in");
      view.classList.remove("anim-settled");
      void view.offsetWidth;
      view.classList.add("page-in");
      clearTimeout(window.__animSettleT);
      window.__animSettleT = setTimeout(() => { try { view.classList.add("anim-settled"); } catch (e) { /* 忽略 */ } }, 900);
    } catch (e) { /* 忽略 */ }

    // 回到来源列表页：恢复原来的滚动位置（只恢复一次）
    // 说明：列表是同步渲染的（缩略图用 padding 撑成固定方格，不会因图片加载而变高），
    // 所以先同步恢复一次；再用 rAF 和时间兜底各补一次，防个别浏览器把位置清回顶部。
    const memo = _backMemo && _backMemo.hash === h ? _backMemo : null;
    if (memo) {
      _backMemo = null;
      const doRestore = () => { if (memo.y > 0) window.scrollTo(0, memo.y); };
      window.scrollTo(0, 0);
      doRestore();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(doRestore);
      [120, 420].forEach((ms) => setTimeout(() => { if (window.scrollY === 0) doRestore(); }, ms));
    } else {
      window.scrollTo(0, 0);
    }
    _lastHash = h;
    flushEventPops();     // v163b：把累计的事件瞬时卡弹出（非阻塞）
  }

  /* ---------- 升级弹窗 ---------- */
  function checkLevelUp() {
    try {
      const game = Game.computeXp(allItems, playDays);
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
    modal.style.display = "";
    $("#mOkLv").onclick = () => { mask.hidden = true; modal.hidden = true; };
    mask.onclick = () => { mask.hidden = true; modal.hidden = true; };
  }

  /* ---------- 启动 ---------- */
  function goBack() {
    // 当前页面设置了自定义返回钩子（如批量编辑页），优先用它
    if (_onBack) { const b = _onBack; _onBack = null; btnBack.onclick = goBack; b(); return; }
    const h = location.hash;
    // 详情 → 回到点进来的那个列表页（盒子/喜欢/首页），位置由 router 恢复
    if (h.startsWith("#/item/")) {
      location.hash = (_backMemo && isListHash(_backMemo.hash)) ? _backMemo.hash : "#/";
      return;
    }
    if (h.startsWith("#/edit/")) {
      const id = h.slice(7);
      location.hash = id ? "#/item/" + id : "#/";                            // 编辑 → 详情/首页
      return;
    }
    if (h.indexOf("#/night/") === 0) {                            // v162：对话页 → 会话页；会话页 → 列表
      const seg = decodeURIComponent(h.slice(8)).split("/");
      location.hash = (seg.length >= 2 && seg[1]) ? ("#/night/" + encodeURIComponent(seg[0])) : "#/night";
      return;
    }
    if (h === "#/night") { location.hash = _nightFrom || "#/spirit"; return; } // 夜话列表 → 进来的那一页
    if (h.indexOf("#/talk/") === 0) {                                          // v165-N3：旧 8 章入口已取消 → 回到这一串
      location.hash = "#/spirit/" + h.slice(7).split("/")[0];
      return;
    }
    if (h.indexOf("#/maintalk/") === 0) { location.hash = "#/main"; return; }   // v165-N3：章节对话 → 主线列表
    if (h === "#/main") { location.hash = "#/"; return; }                       // v165-N3：主线列表 → 首页
    if (h === "#/spirits") { location.hash = "#/spirit"; return; }        // 全部沁灵 → 回到小房间
    if (h === "#/settings" || h === "#/profile" || h === "#/new" || h === "#/cat" || h === "#/stats" || h === "#/quest" || h === "#/spirit") { location.hash = "#/"; return; }
    if (h.startsWith("#/box/")) { location.hash = "#/cat"; return; }
    if (h === "#/") { return; }
    history.back();
  }
  btnBack.onclick = goBack;
  btnSettings.onclick = () => location.hash = "#/settings";
  window.addEventListener("hashchange", router);
  // 沁灵数据存满本地存储时（立绘/CG 占空间），给用户一个提示，而不是静默丢图后无限重出烧额度
  window.addEventListener("ww:storage-full", () => {
    try { toast("沁灵数据存满了本地空间，已自动清理部分历史；大图建议尽早同步到云端"); } catch (e) { /* 忽略 */ }
  });

  /* ---------- 沁灵跨手机同步（localStorage 为主，云端为辅；换手机登录同一账号即可拉回） ---------- */
  let _spiritsDirty = false;          // 本地有没有改动还没推到云端
  let _spiritSyncTimer = null;
  window.addEventListener("ww:spirits-changed", () => { _spiritsDirty = true; scheduleSpiritPush(); });
  function scheduleSpiritPush() {
    if (_spiritSyncTimer) return;
    _spiritSyncTimer = setTimeout(() => { _spiritSyncTimer = null; pushSpirits(); }, 4000);
  }
  // 跨手机同步：把「沁灵 store（ww_spirits）」+「主线设定（ww_story）」一起打包上传；
  // 拉回时 unpack 写回两条独立 key（互不破坏）。旧云端只存 spirits 的，pull 时自动兼容。
  function packSync() {
    return { spirits: Spirits.load(), story: Spirits.readStory() };
  }
  async function pushSpirits() {
    if (!_spiritsDirty) return;                          // 没改动就不必写云端
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    try { await DB.putSpiritStore(packSync()); _spiritsDirty = false; } catch (e) { /* 未配置/离线：静默 */ }
  }
  async function pullSpirits() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    try {
      const remote = await DB.getSpiritStore();
      if (remote && remote.data && Object.keys(remote.data).length) {
        if (remote.data.spirits && typeof remote.data.spirits === "object") {
          Spirits.save(remote.data.spirits);             // 新格式：{ spirits, story }
          if (remote.data.story && typeof remote.data.story === "object") Spirits.writeStory(remote.data.story);
        } else {
          Spirits.save(remote.data);                     // 旧格式：data 本身就是 spirits store（换手机拿回全部沁灵）
        }
        if (location.hash === "#/spirit" || location.hash === "#/spirits" || location.hash.indexOf("#/spirit/") === 0) rerenderSpiritView();
      }
    } catch (e) { /* 未配置/离线：静默 */ }
  }
  // 离开页面 / 切后台时把改动推上去；每 2 分钟兜底推一次（仅在有改动时）
  window.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") pushSpirits(); });
  window.addEventListener("beforeunload", () => { try { pushSpirits(); } catch (e) {} });
  setInterval(() => { pushSpirits(); }, 120000);

  /* 底部导航 */
  const tabbar = $("#tabbar");
  // 文玩专注模式：把「分类」这个 tab 隐藏（只是隐藏，DOM 还在，关掉开关就回来）
  function applyFocusChrome() {
    const catTab = tabbar ? tabbar.querySelector('.tab-item[data-tab="cat"]') : null;
    if (catTab) catTab.style.display = focusMode ? "none" : "";
    if (focusMode && location.hash === "#/cat") location.hash = "#/";
  }
  function updateTabbar() {
    if (!tabbar) return;
    const h = location.hash;
    let active = "home";
    if (h === "#/settings") active = "settings";
    else if (h === "#/cat") active = "cat";
    else if (h === "#/night" || h.indexOf("#/night/") === 0) active = "night";
    else if (h === "#/spirit" || h === "#/spirits" || h === "#/town" ||
      h.indexOf("#/spirit/") === 0 || h.indexOf("#/room/") === 0 || h.indexOf("#/talk/") === 0) active = "spirit";
    else if (h === "#/stats") active = "stats";
    else if (h === "#/quest") active = "quest";
    else if (h === "#/fav") active = "fav";
    tabbar.querySelectorAll(".tab-item").forEach((t) => {
      const tab = t.dataset.tab;
      if (tab === "add") return;
      t.classList.toggle("active", tab === active);
    });
    updateStoryDot();
    updateNightDot();
  }
  tabbar.querySelectorAll(".tab-item").forEach((t) => {
    t.addEventListener("click", () => {
      const tab = t.dataset.tab;
      if (tab === "home") location.hash = "#/";
      else if (tab === "cat") location.hash = "#/cat";
      else if (tab === "stats") location.hash = "#/stats";
      else if (tab === "settings") location.hash = "#/settings";
      else if (tab === "quest") location.hash = "#/quest";
      else if (tab === "spirit") location.hash = "#/spirit";
      else if (tab === "night") { _nightFrom = "#/"; location.hash = "#/night"; }   // 夜话是一级 tab，返回键回首页
      else if (tab === "fav") location.hash = "#/fav";
      else if (tab === "add") location.hash = "#/new";
    });
  });

  /* ---------- 一次性迁移：形象（+设定）全部推倒重来 ----------
     v124：用户要求「把之前生成的清理了，全部重新生成一次，日记也是」（那时还清了日记）。
     v127：加了「设定向导」后，用户要求「**删除所有沁灵的图片**，我全部重新根据升级的来重新做设定，
           更新后我进系统一个一个来出图」→ 这次：
             · 清掉 立绘 / 进化史 / 取景 / CG（**不动日记**：用户这次只说图片）
             · 清掉旧的 look 设定 + lookAsked，并标 setupPending → **进系统后一尊一尊弹向导**
             · 不自动出图！定完一尊才画一尊（`spiritNeedsSetup` 会让出图跳过它们）
     用 ww_imgver 记录版本，只在版本变化时执行一次。 */
  const ART_VER = "v127c";
  function migrateSpiritArtOnce() {
    try {
      if (localStorage.getItem("ww_imgver") === ART_VER) return false;
      const s = Spirits.load();
      let touched = 0;
      Object.keys(s).forEach((k) => {
        const r = s[k];
        if (!r || typeof r !== "object") return;
        if (r.imgUrl || (r.imgHistory || []).length || r.face || r.cgUrl || r.look) touched++;
        r.imgUrl = "";
        r.imgFrozen = 0;
        r.imgAt = 0;
        r.face = null;
        r.imgHistory = [];        // 进化史里的旧图也一起清掉
        r.imgErr = "";
        r._imgErr = "";
        r._imgErrAt = 0;
        r.lookStale = false;
        // CG 也清掉（蜕形/化形的专属插画，按新设定重画）
        r.cgUrl = "";
        r.cgKey = "";
        r.cgStage = 0;
        r.cgAt = 0;
        r._cgErr = "";
        r._cgErrAt = 0;
        // 设定清空 → 重新走「设定向导」（发色 / 特征 / 性格 / 一句话）
        r.look = null;
        delete r.lookAsked;
        r.setupPending = true;
      });
      Spirits.save(s);
      try { localStorage.setItem("ww_imgver", ART_VER); } catch (e2) { /* 忽略 */ }
      updateStoryDot();
      return touched > 0;
    } catch (e) { return false; }
  }

  async function init() {
    try {
      initTheme();
      // 滚动位置由我们自己管（进详情/返回列表时保持原位），关掉浏览器自动恢复，避免互相打架
      try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) { /* 忽略 */ }
      // 提前绑定 AI 小助手（不依赖登录态），确保猫猫图标任何时候都能点击
      bindAI();
      bindModalSettle();   // v129：弹层动画落定兜底（避免"弹层卡在透明"）
      applyFocusChrome();   // 文玩专注模式：隐藏「分类」tab
      initToTop();        // 回到顶部按钮（滚动后出现）
      bindSoftToggles();  // 卡片/列表里直接改软糯程度
      // 网络状态监听：不稳/断开时顶部显示提示条，恢复后自动重新同步
      if (DB.onNetChange) { try { DB.onNetChange(onNetRecovered); } catch (e) { /* 忽略 */ } }
      bindOnlineRecovery();
      // 检查 Supabase 是否已配置
      const cfg = window.SUPABASE_CONFIG || {};
      if (!cfg.url || cfg.url.indexOf("PASTE_") === 0) {
        view.innerHTML = '<div class="empty"><div class="empty-icon">🔧</div>' +
          "<p>应用尚未配置云端服务<br>请在 js/config.js 中填写 Supabase URL 和 Key</p></div>";
        topbarTitle.textContent = "我的收藏馆";
        return;
      }
      // v126：等云端数据回来之前先给一屏骨架屏（别让用户看空白页）
      try { view.innerHTML = bootSkeletonHtml(); } catch (e) { /* 忽略 */ }
      const ok = await enterApp();
      if (ok) {
        // 一次性迁移（v127c）：清掉所有沁灵的立绘 / 进化史 / 取景 / CG 与旧设定
        // 用户要求「删除所有沁灵的图片，我全部重新根据升级的来重新做设定，进系统一个一个来出图」
        // → 这里**不出图**，只把设定清空标记 setupPending；进沁灵页会一尊一尊弹「设定向导」，定完才画
        if (migrateSpiritArtOnce()) {
          const list = spiritItems();
          toast(list.length
            ? ("已清空 " + list.length + " 只沁灵的形象，进「沁灵」页一尊一尊定设定吧 ✨（定完才会出图）")
            : "形象已重置");
        }
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

  /* ---------- AI 小助手（DeepSeek，纯前端直连，数据经你确认后发送） ---------- */
  // 不内置任何 API key（避免开源泄露）；key 由用户在设置页填写，存本机 localStorage
  const AI_BASE = "https://api.deepseek.com"; // OpenAI 兼容；模型名 deepseek-v4-flash
  const AI_MODEL = "deepseek-v4-flash";
  function getAiKey() {
    try { const k = localStorage.getItem("ww_dskey"); return (k && k.trim()) ? k.trim() : ""; } catch (e) { return ""; }
  }
  function hasAiKey() { return !!getAiKey(); }

  // 构造收藏摘要（给 AI 的上下文，只含文本，不含图片）
  function buildCollSummary() {
    const items = allItems || [];
    const now = new Date();
    const dayMs = 86400000;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const pad2 = (n) => String(n).padStart(2, "0");
    const todayCn = now.getFullYear() + "年" + (now.getMonth() + 1) + "月" + now.getDate() + "日";
    const todayIso = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());

    const lines = [];
    // 【关键】必须告诉 AI 今天的日期，否则它无法判断「今天/最近」
    lines.push("【当前日期】今天是 " + todayCn + "（" + todayIso + "，星期" + "日一二三四五六"[now.getDay()] + "）。判断「今天」「昨天」「最近」等一律以这个日期为基准，不要臆测其他日期。");
    lines.push("【收藏总览】共 " + items.length + " 件宝贝。");

    const todayPlayed = []; // 今天盘过的串
    const itemLines = [];
    items.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach((i) => {
      const parts = [];
      if (i.name) parts.push(i.name);
      if (i.species) parts.push(i.species);
      if (i.category) parts.push(i.category);
      if (i.craft) parts.push(i.craft);
      if (i.beadShape) parts.push("珠型:" + shapeLabel(i.beadShape));
      if (i.price != null && i.price !== "") parts.push("¥" + i.price);
      if (i.arrivedAt) { const d = new Date(i.arrivedAt); parts.push("入库" + d.getFullYear() + "年" + (d.getMonth() + 1) + "月"); }
      if (i.playStatus) {
        const ps = i.playStatus;
        if (ps === "playing") parts.push("盘玩中");
        else if (ps === "done") parts.push("已挂瓷");
        else if (ps === "ready") parts.push("待盘玩");
        else if (ps === "puzzle_done") parts.push("已拼");
      }
      // 上次盘玩：换算成相对今天的天数，明确标注「今天盘过」
      if (i.lastPlayedAt) {
        const lp = new Date(i.lastPlayedAt);
        const lpStart = new Date(lp.getFullYear(), lp.getMonth(), lp.getDate()).getTime();
        const diff = Math.round((todayStart - lpStart) / dayMs);
        if (diff <= 0) { parts.push("【今天盘过】"); todayPlayed.push(i); }
        else if (diff === 1) parts.push("昨天盘过");
        else parts.push(diff + "天前盘过");
      }
      if (i.playCount) parts.push("累计盘玩" + i.playCount + "次");
      if (i.star) parts.push(i.star + "星");
      if (i.note) parts.push("备注:" + String(i.note).slice(0, 30));
      itemLines.push("- " + parts.join(" | "));
    });

    // 今日盘玩汇总（直接给结论，AI 不会再算错）
    if (todayPlayed.length) {
      lines.push("【今日已盘】今天一共盘了 " + todayPlayed.length + " 串：" + todayPlayed.map((i) => i.name || "未命名").join("、") + "。");
    } else {
      lines.push("【今日已盘】根据记录，今天还没有盘过任何串（没有任何宝贝的 lastPlayedAt 是今天）。");
    }
    lines.push("");
    lines.push("【宝贝明细】");
    lines.push(itemLines.join("\n"));
    return lines.join("\n");
  }

  // 把收藏摘要 + 用户问题发给 DeepSeek，返回回答
  // 多轮对话：保留最近几轮上下文，便于追问（如「那第 2 串呢？」）
  let aiHistory = []; // [{role:"user"|"assistant", content:string}]
  const AI_HISTORY_MAX = 6; // 最多保留 6 条（3 轮问答）
  async function askAI(userMessage) {
    // v98：文字统一走「文字通道」（默认 DeepSeek 官方；可在设置里切火山方舟白嫖免费额度）
    const tin = (window.Spirits && Spirits.textInfo) ? Spirits.textInfo() : { key: getAiKey(), endpoint: AI_BASE + "/chat/completions", model: AI_MODEL, label: "DeepSeek" };
    if (!tin.key) throw new Error("还未配置 AI API key，请到「设置 → AI 文字模型」填写你自己的 key");
    const summary = buildCollSummary();
    const sysMsg = "你是我的收藏馆AI小助手，懂文玩/手串/拼图/收藏。请用简体中文、简短友好地回答。\n"
      + "规则：1) 回答涉及时间的问题时，必须以【当前日期】为基准，不要臆测日期；2) 判断「今天有没有盘串」「今天盘了几串」时，直接依据【今日已盘】和明细里标注的【今天盘过】统计，不要凭空说没有；3) 数据里没有的不要编造；4) 记住前面的对话，用户可能用「它/这个/第2串」指代上文。\n"
      + "以下是收藏数据：\n" + summary;
    const messages = [
      { role: "system", content: sysMsg },
      ...aiHistory,
      { role: "user", content: userMessage },
    ];
    let answer;
    if (window.Spirits && Spirits.textChat && Spirits.getTextCfg && Spirits.getTextCfg().provider !== "deepseek") {
      answer = await Spirits.textChat(messages, 1000);   // 走方舟/自定义通道
    } else {
      const body = {
        model: tin.model || AI_MODEL,
        messages: messages,
        max_tokens: 1000,
        stream: false,
        // 关闭思考模式：只返回结论(content)，不再输出 reasoning_content
        thinking: { type: "disabled" },
      };
      const resp = await fetch(tin.endpoint || (AI_BASE + "/chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tin.key },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        let msg = "请求失败";
        try { const j = await resp.json(); msg = j.error && j.error.message ? j.error.message : msg; } catch (e) {}
        throw new Error((tin.label || "AI") + " " + resp.status + "：" + msg);
      }
      const data = await resp.json();
      const msg = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message : null;
      answer = msg ? ((msg.content && msg.content.trim()) ? msg.content.trim() : (msg.reasoning_content || "")) : "";
    }
    if (!answer) return "";
    // 记入历史（限制长度，避免越积越多）
    if (answer) {
      aiHistory.push({ role: "user", content: userMessage });
      aiHistory.push({ role: "assistant", content: answer });
      if (aiHistory.length > AI_HISTORY_MAX) aiHistory = aiHistory.slice(-AI_HISTORY_MAX);
    }
    return answer;
  }

  // 清空 AI 对话（DOM + 历史）
  function clearAIChat() {
    aiHistory = [];
    const chat = $("#aiChat");
    if (chat) chat.innerHTML = '<div class="ai-greeting">🧹 对话已清空。有什么想问的尽管说～</div>';
  }

  // AI 面板 UI
  function pushChatMsg(role, text) {
    const chat = $("#aiChat");
    if (!chat) return;
    if (!chat.children.length) chat.innerHTML = '<div class="ai-greeting">👋 我是你的收藏馆小助手。试试下面的快捷问题，或直接输入你的问题（例如「总结我 9 月的盘串记录」）。</div>';
    const div = document.createElement("div");
    div.className = "ai-msg " + role;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }
  function setAiLoading(show) {
    const s = $("#aiSend");
    if (s) { s.disabled = show; s.textContent = show ? "…" : "发送"; }
    if (show && !$("#aiInput")) return;
  }
  async function sendAI() {
    const input = $("#aiInput");
    const msg = input ? input.value.trim() : "";
    if (!msg) return;
    if (input) input.value = "";
    pushChatMsg("user", msg);
    pushChatMsg("ai", "正在思考…");
    setAiLoading(true);
    try {
      const ans = await askAI(msg);
      const chat = $("#aiChat");
      if (chat) chat.lastElementChild.textContent = ans || "（没有返回内容）";
    } catch (err) {
      const chat = $("#aiChat");
      if (chat) chat.lastElementChild.textContent = "⚠️ 出错了：" + err.message;
    } finally {
      setAiLoading(false);
    }
  }

  // AI 面板 open/close + 事件
  function bindAI() {
    const fab = $("#aiFab");
    const panel = $("#aiPanel");
    const open = () => {
      if (panel) panel.hidden = false;
      // 首次打开：若无 key，先提示去设置页填（不自动发请求）
      if (!$("#aiChat").children.length) {
        pushChatMsg("ai", hasAiKey()
          ? "👋 我是你的收藏馆小助手。试试下面的快捷问题，或直接输入你的问题（例如「总结我 9 月的盘串记录」）。"
          : "⚠️ 还没配置 DeepSeek API key。请点右下角进入「设置 → AI 助手密钥」，填你自己的 sk-... key（只存本机，不入开源）。填好后回来就能问我了。");
      }
    };
    const close = () => { if (panel) panel.hidden = true; };
    if (fab) fab.onclick = open;
    const ac = $("#aiClose"); if (ac) ac.onclick = close;
    const clr = $("#aiClear"); if (clr) clr.onclick = (e) => { e.stopPropagation(); clearAIChat(); };
    // 点击面板外关闭
    document.addEventListener("click", (e) => {
      if (panel && !panel.hidden && !panel.contains(e.target) && e.target !== fab && !fab.contains(e.target)) close();
    });
    const send = $("#aiSend"); if (send) send.onclick = sendAI;
    const inp = $("#aiInput");
    if (inp) {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAI(); }
      });
      // 输入框自适应高度
      inp.addEventListener("input", () => { inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 120) + "px"; });
    }
    // 快捷问题
    const qs = $("#aiQuick");
    if (qs) {
      // 用事件委托，避免重复绑定
      if (!qs._bound) {
        qs.addEventListener("click", (e) => {
          const b = e.target.closest(".ai-q");
          if (b) { const inp2 = $("#aiInput"); if (inp2) inp2.value = b.dataset.q; sendAI(); }
        });
        qs._bound = true;
      }
    }
  }

  init();
})();
