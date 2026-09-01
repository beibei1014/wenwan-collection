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
  let categoryFilter = "";   // 分类筛选
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
    topbarTitle.textContent = "我的分类";
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

    let html = "";
    html += '<div class="section-title">全部分类</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';

    // 全部
    html += '<button class="cat-card" data-cat="" style="border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px;text-align:left">' +
      '<div style="font-size:15px;font-weight:700;color:var(--wood)">📦 全部</div>' +
      '<div style="font-size:12px;color:var(--text-2);margin-top:4px">' + allItems.length + " 件藏品</div></button>";

    // 每个分类
    cats.forEach((c) => {
      const n = countBy[c] || 0;
      const icon = c === "菩提" ? "📿" : c === "水晶" ? "💎" : c === "玉石" ? "🪨" : c === "拼图" ? "🧩" : c === "吧唧" ? "🏅" : c === "盲盒" ? "🎁" : "🗂";
      html += '<button class="cat-card" data-cat="' + esc(c) + '" style="border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px;text-align:left">' +
        '<div style="font-size:15px;font-weight:700;color:var(--wood)">' + icon + " " + esc(c) + "</div>" +
        '<div style="font-size:12px;color:var(--text-2);margin-top:4px">' + n + " 件藏品</div></button>";
    });

    // 未分类
    if (uncat) {
      html += '<button class="cat-card" data-cat="__uncat" style="border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px;text-align:left">' +
        '<div style="font-size:15px;font-weight:700;color:var(--text-2)">❓ 未分类</div>' +
        '<div style="font-size:12px;color:var(--text-2);margin-top:4px">' + uncat + " 件藏品</div></button>";
    }
    html += "</div>";

    html += '<p style="text-align:center;font-size:11px;color:#b0a290;margin-top:18px">分类可在 设置 → 分类管理 中增删</p>';

    view.innerHTML = html;

    view.querySelectorAll(".cat-card").forEach((c) => c.addEventListener("click", () => {
      const cat = c.dataset.cat;
      categoryFilter = cat === "__uncat" ? "__uncat" : cat;
      location.hash = "#/";
    }));
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
        html = '<div class="empty"><div class="empty-icon">📤</div><p>没有可分享的手串</p></div>';
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
        if (!items.length) { toast("请先选择手串"); return; }
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
    const batchTitle = title || "批量录入 " + drafts.length + " 条手串";
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
      html += '<div class="form-group"><div class="form-label">珠子大小 <small>mm，珠子类填</small></div>' +
        '<select class="form-select" id="dBeadSize">' + beadSizeOptions(it.beadSize) + '</select></div>';
      html += '<div class="form-group" id="dFinishedWrap" style="display:none"><div class="form-label">拼图完成时间</div>' +
        '<input class="form-input" id="dFinished" type="date"></div>';
      html += "</div>";
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
      $("#dPhotoInput").onchange = (e) => {
        [...e.target.files].forEach((f) => it.photos.push(DB.fileToPhoto(f)));
        e.target.value = "";
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
        const dbsv = $("#dBeadSize").value;
        it.beadSize = dbsv ? parseFloat(dbsv) : null;
        it.category = $("#dCategory").value.trim();
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
      if (!valid.length) { toast("请至少给一条手串填上名字"); return; }
      const btn = $("#bSaveAll");
      btn.textContent = "正在保存…";
      btn.disabled = true;
      try {
        let n = 0;
        for (const it of valid) {
          // 上传照片
          it.photos = [];
          for (const p of drafts[valid.indexOf(it)].photos) {
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
      '<div style="font-size:12px;color:var(--text-2);margin-top:5px">其他信息（手串数据）仍按账号隔离，用户名只用于显示</div></div>';

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
    topbarTitle.textContent = (user && user.displayName ? user.displayName : "文玩手串") + "收藏馆";
    btnBack.style.visibility = "hidden";
    btnSettings.style.visibility = "visible";

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

    // 分类筛选行
    const cats = getCategories();
    html += '<div class="filters">' +
      '<button class="chip' + (!categoryFilter ? " active" : "") + '" data-cat="">全部</button>' +
      cats.map((c) => '<button class="chip' + (categoryFilter === c ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>").join("") +
      "</div>";

    html += '<div class="search-box"><input id="searchInput" placeholder="搜索名字 / 品种 / 店铺…" value="' + esc(search) + '"></div>';

    html += '<div style="display:flex;gap:8px;margin-bottom:12px">' +
      '<button class="batch-entry" id="btnBatch" style="flex:1">🗂 批量录入</button>' +
      '<button class="batch-entry" id="btnShareMode" style="flex:1;background:linear-gradient(135deg,#b8860b,#a06b2c)">📤 多选分享</button>' +
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
  const DEFAULT_CATEGORIES = ["菩提", "水晶", "玉石", "拼图", "吧唧", "盲盒", "其他"];
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

  /* ---------- 详情页 ---------- */
  function renderDetail(id) {
    const it = allItems.find((x) => x.id === id);
    if (!it) { location.hash = "#/"; return; }
    topbarTitle.textContent = "手串档案";
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
      const ok = await confirmModal("删除这条手串？", "删除后不可恢复，请确认。", "删除", true);
      if (ok) { await DB.remove(it.id); await loadItems(); toast("已删除"); location.hash = "#/"; }
    };
    $("#btnShare").onclick = async () => {
      const btn = $("#btnShare");
      btn.textContent = "生成中…";
      btn.disabled = true;
      try {
        const canvas = await Poster.singlePoster(it, { username: user && user.displayName ? user.displayName : "" });
        const result = await Poster.shareCanvas(canvas, "文玩手串_" + (it.name || "分享") + ".jpg");
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

    html += '<div class="form-group"><div class="form-label">珠子大小（卡数） <small>mm，珠子类填</small></div>' +
      '<select class="form-select" id="fBeadSize">' + beadSizeOptions(it && it.beadSize) + '</select></div>';

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
      const fw = $("#fFinishedWrap");
      if (fw) {
        fw.style.display = isPuzzle ? "" : "none";
        if (!isPuzzle) { const fi = $("#fFinished"); if (fi) fi.value = ""; }
      }
    }
    if (fCat) {
      fCat.addEventListener("change", refreshSpeciesByCategory);
      refreshSpeciesByCategory();
    }

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
        const bsv = $("#fBeadSize").value;
        item.beadSize = bsv ? parseFloat(bsv) : null;
        item.category = $("#fCategory").value.trim();
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
      html += '<button class="setting-item" id="btnProfile"><div><div class="t">👤 ' + esc(user.displayName || user.email || "") + '</div><div class="d">修改用户名 · ' + esc(user.email || "") + '</div></div><span class="arrow">›</span></button>';
    }
    html += '<button class="setting-item" id="btnExport"><div><div class="t">📤 导出备份</div><div class="d">下载全部数据为备份文件（含图片链接）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnImport"><div><div class="t">📥 导入备份</div><div class="d">从备份文件恢复数据（会覆盖当前数据）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnClear"><div><div class="t">🗑 清空全部数据</div><div class="d">删除所有手串记录（不可恢复）</div></div><span class="arrow">›</span></button>';
    html += '<button class="setting-item" id="btnLogout"><div><div class="t">🚪 退出登录</div><div class="d">退出后本机不再保留登录状态</div></div><span class="arrow">›</span></button>';
    html += "</div>";

    // 分类管理
    html += '<div class="section-title">分类管理</div>';
    html += '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px">';
    html += '<div style="font-size:12px;color:var(--text-2);margin-bottom:8px">自定义分类（菩提 / 水晶 / 玉石 / 盲盒 / 吧唧…）</div>';
    html += '<div id="catList" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px"></div>';
    html += '<div style="display:flex;gap:8px">' +
      '<input class="form-input" id="catInput" placeholder="新增分类，如：盲盒" style="flex:1;padding:9px 10px;font-size:14px">' +
      '<button class="btn primary" id="catAdd" style="flex:none;padding:9px 16px;font-size:14px">添加</button></div>';
    html += "</div>";
    html += '<p style="text-align:center;font-size:11px;color:#b0a290;margin-top:22px;line-height:1.8">数据存储于云端（Supabase）<br>登录同一账号即可在任何设备查看</p>';

    view.innerHTML = html;

    const bp = $("#btnProfile");
    if (bp) bp.onclick = () => location.hash = "#/profile";
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
    $("#catAdd").onclick = () => {
      const v = $("#catInput").value.trim();
      if (!v) { toast("请输入分类名"); return; }
      const cats = getCategories();
      if (cats.includes(v)) { toast("分类已存在"); return; }
      saveCategories(cats.concat([v]));
      $("#catInput").value = "";
      renderCatList();
      toast("已添加分类：" + v);
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
    if (h === "#/" || h === "#") { renderHome(); }
    else if (h.startsWith("#/item/")) { renderDetail(h.slice(7)); }
    else if (h.startsWith("#/edit/")) { renderForm(h.slice(7)); }
    else if (h === "#/new") { renderForm(null); }
    else if (h === "#/settings") { renderSettings(); }
    else { renderHome(); }
    updateTabbar();
    window.scrollTo(0, 0);
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
    if (h === "#/settings" || h === "#/profile" || h === "#/new" || h === "#/cat") { location.hash = "#/"; return; }
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
      else if (tab === "settings") location.hash = "#/settings";
      else if (tab === "add") location.hash = "#/new";
    });
  });

  async function init() {
    try {
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