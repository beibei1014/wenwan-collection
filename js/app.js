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
  const btnAdd = $("#btnAdd");

  let allItems = [];
  let filter = "all";        // all | instock | gifted | played
  let search = "";
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

  /* ---------- 认证页 ---------- */
  function renderAuth() {
    topbarTitle.textContent = "登录 · 文玩手串收藏馆";
    btnBack.style.visibility = "hidden";
    btnSettings.style.visibility = "hidden";
    btnAdd.style.visibility = "hidden";

    let html = "";
    html += '<div style="text-align:center;padding:30px 0 16px">' +
      '<div style="font-size:52px">📿</div>' +
      '<div style="font-size:20px;font-weight:700;color:var(--wood);margin-top:8px">文玩手串收藏馆</div>' +
      '<div style="font-size:13px;color:var(--text-2);margin-top:6px">登录后，你的收藏在任何设备上都在</div></div>';

    html += '<div class="form">';
    html += '<div class="form-group"><div class="form-label">邮箱</div>' +
      '<input class="form-input" id="aEmail" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email"></div>';
    html += '<div class="form-group"><div class="form-label">密码</div>' +
      '<input class="form-input" id="aPass" type="password" placeholder="至少 6 位" autocomplete="current-password"></div>';
    html += '<button class="btn primary" id="btnLogin" style="width:100%">登 录</button>';
    html += '<button class="btn ghost" id="btnSignup" style="width:100%;margin-top:10px">没有账号？注册一个</button>';
    html += '<p id="authMsg" style="text-align:center;font-size:13px;color:var(--red);margin-top:12px;min-height:18px"></p>';
    html += '<p style="text-align:center;font-size:11px;color:#b0a290;line-height:1.8;margin-top:8px">数据存储于 Supabase 云端<br>每个账号的数据互相隔离</p>';
    html += "</div>";

    view.innerHTML = html;

    const emailEl = $("#aEmail"), passEl = $("#aPass"), msgEl = $("#authMsg");
    const showMsg = (m, ok) => { msgEl.textContent = m; msgEl.style.color = ok ? "var(--green)" : "var(--red)"; };
    const doAuth = async (mode) => {
      const email = emailEl.value.trim();
      const pass = passEl.value;
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showMsg("请输入正确的邮箱地址"); return; }
      if (pass.length < 6) { showMsg("密码至少 6 位"); return; }
      try {
        if (mode === "login") {
          await DB.signIn(email, pass);
          showMsg("登录成功", true);
        } else {
          const res = await DB.signUp(email, pass);
          if (res.session) {
            showMsg("注册成功，正在进入…", true);
          } else {
            showMsg("注册成功！请到邮箱点击确认链接后再登录", true);
            return;
          }
        }
        await enterApp();
      } catch (err) {
        showMsg(translateAuthError(err.message));
      }
    };
    $("#btnLogin").onclick = () => doAuth("login");
    $("#btnSignup").onclick = () => doAuth("signup");
    emailEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth("login"); });
    passEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth("login"); });
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
  async function enterApp() {
    const session = await DB.getSession();
    if (!session || !session.user) { location.hash = "#/auth"; return false; }
    user = session.user;
    try {
      await loadItems();
    } catch (e) { /* 表未建好时显示错误 */ }
    router();
    return true;
  }

  /* ---------- 数据加载 ---------- */
  async function loadItems() {
    allItems = await DB.getAll();
  }

  function filtered() {
    let list = allItems;
    if (filter === "instock") list = list.filter((i) => !i.gifted);
    else if (filter === "gifted") list = list.filter((i) => i.gifted);
    else if (filter === "played") list = list.filter((i) => i.played);
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
    topbarTitle.textContent = "文玩手串收藏馆";
    btnBack.style.visibility = "hidden";
    btnSettings.style.visibility = "visible";
    btnAdd.style.visibility = "visible";

    const inStock = allItems.filter((i) => !i.gifted).length;
    const gifted = allItems.filter((i) => i.gifted).length;
    const played = allItems.filter((i) => i.played).length;

    let html = "";
    html += '<div class="home-head"><div class="stat-pills">' +
      '<span class="stat-pill">共 <b>' + allItems.length + '</b></span>' +
      '<span class="stat-pill">在库 <b>' + inStock + '</b></span>' +
      '<span class="stat-pill">已送 <b>' + gifted + '</b></span>' +
      '<span class="stat-pill">盘玩 <b>' + played + '</b></span>' +
      '</div></div>';

    html += '<div class="filters">' +
      chip("all", "全部") + chip("instock", "在库") + chip("gifted", "已送人") + chip("played", "在盘玩") +
      '</div>';

    html += '<div class="search-box"><input id="searchInput" placeholder="搜索名字 / 品种 / 店铺…" value="' + esc(search) + '"></div>';

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
        "<p>" + (allItems.length ? "没有找到匹配的手串" : "还没有收藏任何手串\n点击下方 ＋ 添加第一条吧") + "</p>" +
        "</div>";
    }
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
        '<div class="card-sub"><span>' + esc(it.species || "") + '</span><span class="days">' + esc(days) + "</span></div>" +
        "</div></div>";
    }
    return h + "</div>";
  }

  function bindCardEvents() {
    view.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => location.hash = "#/item/" + c.dataset.id));
  }

  function bindHomeEvents() {
    const si = $("#searchInput");
    if (si) si.addEventListener("input", () => { search = si.value.trim(); updateGrid(); });
    view.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
      filter = c.dataset.f;
      view.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
      updateGrid();
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

  /* ---------- 详情页 ---------- */
  function renderDetail(id) {
    const it = allItems.find((x) => x.id === id);
    if (!it) { location.hash = "#/"; return; }
    topbarTitle.textContent = "手串档案";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    btnAdd.style.visibility = "hidden";

    const hero = it.photos && it.photos[0]
      ? '<img src="' + photoUrl(it.photos[0]) + '" alt="">'
      : '<div class="placeholder">📿</div>';
    const days = DB.formatDays(DB.daysWith(it));
    const tags =
      (it.gifted ? '<span class="tag r">已送人</span>' : '<span class="tag g">在库</span>') +
      (it.played ? '<span class="tag yl">盘玩中</span>' : '<span class="tag">未盘玩</span>') +
      (it.craft ? '<span class="tag">' + esc(it.craft) + "</span>" : "");

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
    html += infoItem("工艺", it.craft || "—");
    html += infoItem("入手价格", it.price != null && it.price !== "" ? "¥" + esc(String(it.price)) : "—");
    html += infoItem("购买店铺", esc(it.shop || "—"), true);
    if (it.gifted && it.giftedAt) html += infoItem("送人时间", fmtDate(it.giftedAt), true);
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

    html += '<div class="detail-actions">';
    html += '<button class="btn ghost" id="btnShare">分享</button>';
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

    $("#btnEdit").onclick = () => location.hash = "#/edit/" + it.id;
    $("#btnDel").onclick = async () => {
      const ok = await confirmModal("删除这条手串？", "删除后不可恢复，请确认。", "删除", true);
      if (ok) { await DB.remove(it.id); await loadItems(); toast("已删除"); location.hash = "#/"; }
    };
    $("#btnShare").onclick = () => shareItem(it);
  }

  function infoItem(k, v, full) {
    return '<div class="info-item' + (full ? " full" : "") + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + "</div></div>";
  }

  async function shareItem(it) {
    try {
      const text = "📿 " + (it.name || "文玩手串") + (it.species ? " · " + it.species : "") +
        "\n陪伴时长：" + DB.formatDays(DB.daysWith(it)) +
        "\n到货时间：" + fmtDate(it.arrivedAt) +
        (it.craft ? "\n工艺：" + it.craft : "") +
        (it.shop ? "\n店铺：" + it.shop : "") +
        (it.price != null && it.price !== "" ? "\n价格：¥" + it.price : "") +
        (it.gifted ? "\n状态：已送人" : "\n状态：在库") +
        (it.played ? "\n状态：盘玩中" : "");
      if (navigator.share) {
        await navigator.share({ title: it.name || "文玩手串", text });
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
    topbarTitle.textContent = isEdit ? "编辑手串" : "添加手串";
    btnBack.style.visibility = "visible";
    btnSettings.style.visibility = "hidden";
    btnAdd.style.visibility = "hidden";

    const d = isEdit && it.arrivedAt ? new Date(it.arrivedAt) : new Date();
    const dateVal = isEdit && it.arrivedAt ? fmtDateInput(it.arrivedAt) : "";

    let html = "";
    html += '<div class="form">';

    html += '<div class="form-group"><div class="form-label">串的名字 <small>给它起个好听的名字</small></div>' +
      '<input class="form-input" id="fName" placeholder="如：星月菩提·老念珠" value="' + esc(it ? it.name : "") + '"></div>';

    html += '<div class="form-row">';
    html += '<div class="form-group"><div class="form-label">品种/材质</div>' +
      '<input class="form-input" id="fSpecies" list="speciesList" placeholder="如：星月菩提" value="' + esc(it ? it.species : "") + '">' +
      '<datalist id="speciesList">' + ["星月菩提","金刚菩提","凤眼菩提","菩提根","小叶紫檀","黄花梨","沉香","绿松石","南红玛瑙","蜜蜡","和田玉","橄榄核","核桃手串","椰壳","紫金鼠","千眼菩提","崖柏","血檀"].map((s) => '<option value="' + s + '">').join("") + "</datalist></div>";
    html += '<div class="form-group"><div class="form-label">工艺</div>' +
      '<div class="seg" id="fCraft">' +
      '<button type="button" data-v="干磨" class="' + (!it || it.craft === "干磨" ? "active" : "") + '">干磨</button>' +
      '<button type="button" data-v="水磨" class="' + (it && it.craft === "水磨" ? "active" : "") + '">水磨</button>' +
      '<button type="button" data-v="" class="' + (it && it.craft && it.craft !== "干磨" && it.craft !== "水磨" ? "active" : "") + '">其他</button>' +
      "</div></div>";
    html += "</div>";

    html += '<div class="form-row">';
    html += '<div class="form-group"><div class="form-label">到货时间</div>' +
      '<input class="form-input" id="fDate" type="date" value="' + dateVal + '"></div>';
    html += '<div class="form-group"><div class="form-label">入手价格 <small>元</small></div>' +
      '<input class="form-input" id="fPrice" type="number" inputmode="decimal" placeholder="如 1280" value="' + esc(it && it.price != null ? it.price : "") + '"></div>';
    html += "</div>";

    html += '<div class="form-group"><div class="form-label">在哪家店买的</div>' +
      '<input class="form-input" id="fShop" placeholder="店铺名 / 平台" value="' + esc(it ? it.shop : "") + '"></div>';

    html += '<div class="form-group"><div class="form-label">状态</div>' +
      '<div class="seg" id="fGifted">' +
      '<button type="button" data-v="0" class="' + (!it || !it.gifted ? "active" : "") + '">在库</button>' +
      '<button type="button" data-v="1" class="' + (it && it.gifted ? "active" : "") + '">已送人</button>' +
      "</div></div>";

    html += '<div class="form-group" id="giftedWrap"' + (it && it.gifted ? "" : ' style="display:none"') + '><div class="form-label">送人时间</div>' +
      '<input class="form-input" id="fGiftedDate" type="date" value="' + (it && it.giftedAt ? fmtDateInput(it.giftedAt) : "") + '"></div>';

    html += '<div class="form-group"><div class="check-row">' +
      '<input type="checkbox" id="fPlayed"' + (it && it.played ? " checked" : "") + ">" +
      '<label for="fPlayed" style="font-size:15px">正在盘玩</label></div></div>';

    html += '<div class="form-group" id="playedNoteWrap"><div class="form-label">盘玩记录 <small>可选</small></div>' +
      '<textarea class="form-textarea" id="fPlayedNote" placeholder="盘了多久、上色情况、手感变化…">' + esc(it ? it.playedNote : "") + "</textarea></div>";

    html += '<div class="form-group"><div class="form-label">备注</div>' +
      '<textarea class="form-textarea" id="fNote" placeholder="来历、故事、心情…">' + esc(it ? it.note : "") + "</textarea></div>";

    html += '<div class="form-group"><div class="form-label">手串照片</div>' +
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
    view.querySelectorAll("#fGifted button").forEach((b) => b.onclick = () => {
      view.querySelectorAll("#fGifted button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $("#giftedWrap").style.display = b.dataset.v === "1" ? "" : "none";
    });
    $("#fPlayed").onchange = () => {
      $("#playedNoteWrap").style.display = $("#fPlayed").checked ? "" : "none";
    };
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

    $("#photoInput").onchange = (e) => {
      [...e.target.files].forEach((f) => photos.push(DB.fileToPhoto(f)));
      e.target.value = "";
      renderUploadGrid("#photoGrid", photos, () => $("#photoInput").click(), false);
    };
    $("#shotInput").onchange = (e) => {
      const files = [...e.target.files];
      files.forEach((f) => shots.push(DB.fileToPhoto(f)));
      e.target.value = "";
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
        const parsed = OCR.parseOrder(text);
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
        item.gifted = view.querySelector("#fGifted button.active").dataset.v === "1";
        const gdv = $("#fGiftedDate").value;
        if (item.gifted) {
          item.giftedAt = gdv ? new Date(gdv + "T12:00:00").getTime() : (item.giftedAt || Date.now());
        } else {
          item.giftedAt = null;
        }
        item.played = $("#fPlayed").checked;
        item.playedNote = $("#fPlayedNote").value.trim();
        item.note = $("#fNote").value.trim();

        if (!item.name) { toast("请给手串起个名字"); return; }

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
    btnAdd.style.visibility = "hidden";

    const inStock = allItems.filter((i) => !i.gifted).length;
    const gifted = allItems.filter((i) => i.gifted).length;
    const played = allItems.filter((i) => i.played).length;

    let html = "";
    html += '<div class="stats-card"><h3>收 藏 统 计</h3><div class="stats-nums">' +
      '<div><div class="n">' + allItems.length + '</div><div class="l">全部手串</div></div>' +
      '<div><div class="n">' + inStock + '</div><div class="l">在库</div></div>' +
      '<div><div class="n">' + gifted + '</div><div class="l">已送人</div></div>' +
      '<div><div class="n">' + played + '</div><div class="l">盘玩中</div></div>' +
      "</div></div>";

    html += '<div class="settings-list">';
    if (user) {
      html += '<div class="setting-item"><div><div class="t">👤 ' + esc(user.email || "") + '</div><div class="d">当前登录账号</div></div></div>';
    }
    html += '<button class="setting-item" id="btnExport"><div><div class="t">📤 导出备份</div><div class="d">下载全部数据为备份文件（含图片链接）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnImport"><div><div class="t">📥 导入备份</div><div class="d">从备份文件恢复数据（会覆盖当前数据）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnClear"><div><div class="t">🗑 清空全部数据</div><div class="d">删除所有手串记录（不可恢复）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnLogout"><div><div class="t">🚪 退出登录</div><div class="d">退出后本机不再保留登录状态</div></div><span class="arrow">›</span></button>';
    html += "</div>";
    html += '<p style="text-align:center;font-size:11px;color:#b0a290;margin-top:22px;line-height:1.8">数据存储于云端（Supabase）<br>登录同一账号即可在任何设备查看</p>';

    view.innerHTML = html;

    $("#btnExport").onclick = async () => {
      const json = await DB.exportBackup();
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "文玩手串备份_" + new Date().toISOString().slice(0, 10) + ".json";
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
      const ok = await confirmModal("清空全部数据？", "所有手串将被永久删除，无法恢复！", "清空", true);
      if (!ok) return;
      const items = await DB.getAll();
      for (const it of items) await DB.remove(it.id);
      await loadItems();
      toast("已清空");
      location.hash = "#/";
    };
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
    if (h === "#/auth") { renderAuth(); return; }
    if (!user) { renderAuth(); return; }
    if (h === "#/" || h === "#") { renderHome(); }
    else if (h.startsWith("#/item/")) { renderDetail(h.slice(7)); }
    else if (h.startsWith("#/edit/")) { renderForm(h.slice(7)); }
    else if (h === "#/new") { renderForm(null); }
    else if (h === "#/settings") { renderSettings(); }
    else { renderHome(); }
    window.scrollTo(0, 0);
  }

  /* ---------- 启动 ---------- */
  btnBack.onclick = () => history.back();
  btnSettings.onclick = () => location.hash = "#/settings";
  btnAdd.onclick = () => location.hash = "#/new";
  window.addEventListener("hashchange", router);

  async function init() {
    try {
      // 检查 Supabase 是否已配置
      const cfg = window.SUPABASE_CONFIG || {};
      if (!cfg.url || cfg.url.indexOf("PASTE_") === 0) {
        view.innerHTML = '<div class="empty"><div class="empty-icon">🔧</div>' +
          "<p>应用尚未配置云端服务<br>请在 js/config.js 中填写 Supabase URL 和 Key</p></div>";
        topbarTitle.textContent = "文玩手串收藏馆";
        return;
      }
      const ok = await enterApp();
      if (ok) {
        if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
          navigator.serviceWorker.register("sw.js").catch(() => {});
        }
      }
    } catch (err) {
      view.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>初始化失败：' + esc(err.message) + "</p></div>";
    }
  }

  init();
})();