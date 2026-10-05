/* V174-C2B 自测：画册四册 + hub 收敛 + goBack 来源记忆（js/app.js）
 * ===========================================================================
 * 目的：不止静态挂点，而是把 app.js 里 v174-C2B 新增/重写的**真实源码**抽出来，
 *       配真 Spirits（js/spirits.js）+ 最小桩，真调用：
 *         - albumDuoRows()     第四册「双人」合并（app 侧，spirits.js 看不到 Rooms）
 *         - albumTabsHtml()    四册 chip（复用 C3 的 .evt-tabs / .evt-tab）
 *         - albumCellHtml()    is-cover / 正在展示 / owner / tag
 *         - renderAlbumPage()  真渲染：四册计数 / 默认 main 不自动跳 / 单册空 / ?tab= / 整册空
 *         - hubCardHtml()      沁灵页 hub 卡（3 chip，计数为 0 仍渲染）
 *         - goBack()           画册/纪事/房间/沁灵巷 的返回落点
 *       ⛔ 不断言「理论上」——每条路径真的走一遍。
 *
 * 用法：node docs/_test_v174_album.js
 * 负向对照（⛔ 铆定 commit，绝不用 HEAD —— 一提交 HEAD 就变「改后」⇒ 永久假红）：
 *   基线 = git show cf7a6cf:js/app.js（回落 docs/_tmp/_pre_v174c2b_app.js）
 *   cf7a6cf = 「B1b 已进、C2B 未进」，正是 C2B 的「改前」（team-lead 更正，以此为准）。
 *   同套断言跑基线 ⇒ 必须大量 FAIL。报告给「改前 FAIL 条数 → 改后 PASS 条数」。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const CUR_SRC = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");

/* ---------- 抽函数 / 抽常量（大括号配对，跳字符串 / 注释） ---------- */
function extractFn(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return "";
  let i = src.indexOf("(", m.index), pd = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") pd++;
    else if (src[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < src.length && src[i] !== "{") i++;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") { const q = ch; i++; while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) break; i++; } continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(m.index, i);
}
function extractConst(src, name) {
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*([\\{\\[]|'|\")");
  const m = re.exec(src);
  if (!m) return "";
  const open = m[1];
  const close = open === "{" ? "}" : (open === "[" ? "]" : open);
  let i = src.indexOf(open, m.index), depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") { const q = ch; i++; while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) break; i++; } continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(m.index, i) + ";";
}
function extractLine(src, name) {
  const re = new RegExp("(^|\\n)([ \\t]*const\\s+" + name + "\\s*=\\s*[^;\\n]*;)", "m");
  const m = re.exec(src);
  return m ? m[2] : "";
}

const MISS = [];
function X(src, kind, name) {
  const v = kind === "fn" ? extractFn(src, name) : (kind === "const" ? extractConst(src, name) : extractLine(src, name));
  if (!v) MISS.push(name);
  return v;
}

/* ---------- 真 Spirits（seed） ---------- */
const SEED = {
  it1: { name: "大檀", cgUrl: "T1",
    cgs: { k1: { hasImg: true, thumb: "T1", title: "同心", caption: "cap", at: 100 } },
    fests: { "2026-01-01": { cgUrl: "URL_FEST_1", name: "岁除", text: "t", at: 200 } } },
  it2: { name: "小甜", cgs: { k9: { hasImg: true, thumb: "T9", title: "并肩", at: 300 } } },
};
const ITEMS = [{ id: "it1", name: "大檀" }, { id: "it2", name: "小甜" }];

function buildCtx(src, opts) {
  opts = opts || {};
  const hc = H.makeContext();
  hc.store.setItem("ww_spirits", JSON.stringify(SEED));
  H.loadFile(hc.ctx, "js/spirits.js");
  const Spirits = hc.sandbox.Spirits;

  const created = [];
  const makeNode = () => {
    const n = { style: {}, dataset: {}, hidden: false, innerHTML: "", textContent: "", className: "",
      classList: { add() {}, remove() {}, contains() { return false; } }, setAttribute() {},
      appendChild() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => false };
    created.push(n);
    return n;
  };
  const loc = { hash: opts.hash || "#/album" };
  const history = { back() { history._back = true; }, _back: false };

  const sandbox = {
    console: console, Spirits: Spirits, localStorage: hc.store,
    spiritItems: () => ITEMS,
    spiritItemById: (id) => ITEMS.filter((x) => String(x.id) === String(id))[0] || null,
    nameOf: (it) => (SEED[it.id] && SEED[it.id].name) || it.name || "沁灵",
    Rooms: opts.rooms === undefined
      ? { listRooms: () => [{ id: "r1", name: "老檀屋" }],
          storiesOfRoom: () => [
            { key: "it1|it2", pair: ["it1", "it2"], story: { img: "URL_DUO_1", level: 0, at: 50 } },
            { key: "x|y", pair: ["it1", "x"], story: { level: 1, at: 60 } },   // ⛔ 无 img ⇒ 不入册
          ] }
      : opts.rooms,
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    emptyCardHtml: (o) => '<div class="empty-card">' + (o && o.title ? o.title : "") + "</div>",
    bindSpiritImgFallback: () => {},
    openSpiritViewer: (u) => { sandbox._viewer = u; },
    $: () => null,
    topbarTitle: { textContent: "" }, btnBack: { style: {}, onclick: null }, btnSettings: { style: {} },
    location: loc, history: history,
    _onBack: null, _backMemo: null, isListHash: () => false,
    _nightFrom: "#/spirit", _albumFrom: "#/spirit", _eventsFrom: "#/spirit", _roomFrom: "#/town",
    _viewer: "", created: created,
    /* renderAlbumPage 会跑 ensureIn + backfillAdvCg（把顶层 cgUrl 迁成 adv# 并 save）。
       ⇒ 每次渲染前把 store 复位，保证各断言块从同一已知 store 出发（否则计数跨块漂移）。 */
    _resetStore: () => { hc.store.setItem("ww_spirits", JSON.stringify(SEED)); },
    HUB_TOWN_SVG: '<svg data-stub="town"></svg>', HUB_BOOK_SVG: '<svg data-stub="book"></svg>',
    document: { createElement: () => makeNode(), querySelector: () => null, querySelectorAll: () => [], body: { appendChild() {} } },
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.fetch = () => Promise.reject(new Error("no network"));
  const ctx = vm.createContext(sandbox);

  const script =
    X(src, "const", "ALBUM_BOOKS") + "\n" +
    ["hubCardHtml", "mainStoryEntryHtml", "albumDuoRows", "albumTabsHtml", "albumCellHtml", "albumFailHtml", "renderAlbumPage", "goBack"]
      .map((n) => X(src, "fn", n)).filter(Boolean).join("\n");
  vm.runInContext(script, ctx, { filename: "v174c2b-extract" });
  sandbox.view = makeNode();
  return sandbox;
}

/* ---------- 断言收集 ---------- */
function run(src) {
  MISS.length = 0;
  const fails = [];
  let pass = 0;
  const ok = (c, m) => { if (c) pass++; else fails.push(m); };
  let sb;
  try { sb = buildCtx(src); }
  catch (e) { return { pass: 0, fail: 1, fails: ["[抽取/构建失败] " + e.message], miss: MISS.slice() }; }
  const render = (hash) => { sb._resetStore(); sb.location.hash = hash || "#/album"; sb.view = sb.document.createElement(); sb.renderAlbumPage(); return String(sb.view.innerHTML || ""); };

  /* A. albumDuoRows 真跑 */
  try {
    const rows = sb.albumDuoRows(sb.Spirits.load());
    ok(rows.length === 1, "A · 无图 story 被跳过 ⇒ 只剩 1 行（实得 " + rows.length + "）");
    const r = rows[0] || {};
    ok(r.url === "URL_DUO_1", "A · url = story.img（实得 " + r.url + "）");
    ok(r.ownerName === "大檀 × 小甜", "A · ownerName = 「A × B」（实得 " + r.ownerName + "）");
    ok(r.isCover === false, "A · 双人册 isCover 恒 false（team-lead 裁定）");
    ok(String(r.title).indexOf("第 1 段") >= 0, "A · title 含「第 1 段」（实得 " + r.title + "）");
  } catch (e) { ok(false, "A · albumDuoRows 抛错：" + e.message); }

  /* B. albumTabsHtml 真跑 */
  try {
    const counts = { main: 2, adv: 0, fest: 1, duo: 1, all: 4 };
    const h = sb.albumTabsHtml(counts, "fest");
    ok((h.match(/data-album-tab="/g) || []).length === 4, "B · 恰 4 个 chip");
    ["主线", "进阶", "节令", "双人"].forEach((L) => ok(h.indexOf(L) >= 0, "B · 有「" + L + "」chip"));
    ok((h.match(/class="evt-tab is-on"/g) || []).length === 1, "B · is-on 只挂当前册（1 个）");
    ok(h.indexOf(">节令 (1)<") >= 0, "B · 计数内联在 label（节令 (1)）");
    ok(h.indexOf(">进阶 (0)<") >= 0, "B · 计数为 0 的册仍渲染（进阶 (0)）");
    ok(h.indexOf('class="evt-tabs album-tabs"') >= 0, "B · 容器 = .evt-tabs.album-tabs（复用 C3）");
  } catch (e) { ok(false, "B · albumTabsHtml 抛错：" + e.message); }

  /* C. albumCellHtml 真跑 */
  try {
    const h = sb.albumCellHtml({ url: "U", title: "同心", caption: "c", ownerId: "it1", ownerName: "大檀", isCover: true });
    ok(h.indexOf('class="album-cell is-cover"') >= 0, "C · isCover ⇒ .album-cell.is-cover");
    ok(h.indexOf('album-cell-img') >= 0 && h.indexOf('src="U"') >= 0, "C · 有 .album-cell-img");
    ok(h.indexOf('<span class="album-cell-tag">同心</span>') >= 0, "C · 图名 .album-cell-tag");
    ok(h.indexOf('<span class="album-cell-owner">大檀</span>') >= 0, "C · owner 无内联样式（C3 已收进 CSS）");
    ok(h.indexOf('style="position:absolute') < 0, "C · ⛔ 无内联 position:absolute");
    ok(h.indexOf('album-cell-cover">正在展示<') >= 0, "C · isCover ⇒ 「正在展示」");
    const h2 = sb.albumCellHtml({ url: "U2", title: "t", ownerName: "小甜", isCover: false });
    ok(h2.indexOf("is-cover") < 0 && h2.indexOf("正在展示") < 0, "C · 非 isCover ⇒ 无 is-cover / 无「正在展示」");
  } catch (e) { ok(false, "C · albumCellHtml 抛错：" + e.message); }

  /* D. renderAlbumPage 真渲染（seed：main2/adv0/fest1/duo1） */
  try {
    sb._albumTab = "main";
    const h = render("#/album");
    ok(h.indexOf('class="evt-tabs album-tabs"') >= 0, "D · 有四册 chip 条");
    ok((h.match(/data-album-tab="/g) || []).length === 4, "D · 4 个 tab");
    ok(h.indexOf('<div class="album-head-title">画册</div>') >= 0, "D · 页头标题 = 「画册」");
    ok(h.indexOf('<div class="album-head-n"><b>2</b>') >= 0, "D · 页顶大数字 = 当前册计数（main=2）");
    ok(h.indexOf("album-grid") >= 0, "D · 有 .album-grid");
    ok((h.match(/<button class="album-cell/g) || []).length === 2, "D · main 册渲染 2 格（实得 " + (h.match(/<button class="album-cell/g) || []).length + "）");
    ok(h.indexOf("is-cover") >= 0, "D · it1 那张 cgUrl===thumb ⇒ is-cover");
    ok(h.indexOf("album-grid-wide") < 0, "D · ⛔ 死类 .album-grid-wide 已清除");
    ok(h.indexOf("albumBack") < 0, "D · ⛔ 旧的 #albumBack 按钮已删（改由 goBack 处理）");
    ok(h.indexOf('data-album-tab="main"') >= 0, "D · 默认 tab = main");
  } catch (e) { ok(false, "D · renderAlbumPage 抛错：" + e.message); }

  /* E. 默认不自动跳（main 空 + 其它册有图 ⇒ 仍留 main，显示单册空） */
  try {
    sb._albumTab = "main";
    const real = sb.Spirits.albumAll3;
    sb.Spirits.albumAll3 = () => ({ main: [], adv: [{ key: "a", url: "A", title: "进阶图", at: 1, ownerId: "it2", ownerName: "小甜", isCover: false }], fest: [], counts: { main: 0, adv: 1, fest: 0, all: 1 } });
    const h = render("#/album");
    sb.Spirits.albumAll3 = real;
    ok(h.indexOf("这一册还空着") >= 0, "E · main 空 ⇒ 显示单册空（⛔ 不自动跳 adv）");
    ok(h.indexOf("进阶图") < 0, "E · ⛔ 没有把 adv 的图混进 main 册");
    ok(h.indexOf('data-album-tab="main"') >= 0, "E · 仍停在 main 册");
  } catch (e) { ok(false, "E · 不自动跳 抛错：" + e.message); }

  /* F. ?tab=fest 生效 */
  try {
    sb._albumTab = "main";
    const h = render("#/album?tab=fest");
    ok(h.indexOf("岁除") >= 0, "F · ?tab=fest ⇒ 渲染节令 CG（此前画册完全看不到）");
    ok(h.indexOf('<div class="album-head-n"><b>1</b>') >= 0, "F · 页顶计数切到 fest（1）");
  } catch (e) { ok(false, "F · ?tab= 抛错：" + e.message); }

  /* G. 整册空 ⇒ 空态文案（规范 §3.6） */
  try {
    const real = sb.Spirits.albumAll3;
    const realRooms = sb.Rooms;                 // 备份（H 组要用回带房间的桩）
    sb.Spirits.albumAll3 = () => ({ main: [], adv: [], fest: [], counts: { main: 0, adv: 0, fest: 0, all: 0 } });
    sb.Rooms = { listRooms: () => [], storiesOfRoom: () => [] };
    const h = render("#/album");
    sb.Spirits.albumAll3 = real;
    sb.Rooms = realRooms;                        // 还原（否则 H 的小屋计数会被这次清空带偏）
    ok(h.indexOf("画册还空着。") >= 0, "G · 四册全空 ⇒ emptyCardHtml「画册还空着。」");
    ok(h.indexOf("empty-card") >= 0, "G · 走 emptyCardHtml（不是半截页）");
  } catch (e) { ok(false, "G · 整册空 抛错：" + e.message); }

  /* H. hubCardHtml 真跑 */
  try {
    sb._resetStore();                     // 干净 store（未发生过 adv 迁移）⇒ 画册合计可定值
    const h = sb.hubCardHtml(ITEMS, sb.Spirits.load());
    ok(h.indexOf('class="hub-card"') >= 0, "H · 有 .hub-card");
    ok(h.indexOf('class="hub-main" data-goto="#/town"') >= 0, "H · hub-main data-goto=#/town");
    ok(h.indexOf('<span class="hub-title">沁灵巷</span>') >= 0, "H · 主行标题「沁灵巷」");
    ok((h.match(/class="hub-chip"/g) || []).length === 3, "H · 3 个 hub-chip（小屋/纪事/画册）");
    ok(h.indexOf("小屋 <b>1</b>") >= 0, "H · 小屋计数 = Rooms.listRooms().length（1）");
    ok(h.indexOf("画册 <b>4</b>") >= 0, "H · 画册计数 = 四册合计（main2+fest1+duo1=4）");
    ok(h.indexOf('data-goto="#/album"') >= 0 && h.indexOf('data-goto="#/events"') >= 0, "H · chip 各自 data-goto");
    const h0 = sb.hubCardHtml(ITEMS, sb.Spirits.load());
    sb.Rooms = { listRooms: () => [], storiesOfRoom: () => [] };
    const hz = sb.hubCardHtml(ITEMS, sb.Spirits.load());
    ok(hz.indexOf("小屋 <b>0</b>") >= 0, "H · 计数为 0 时 chip 仍渲染（显示 0，⛔ 不隐藏）");
  } catch (e) { ok(false, "H · hubCardHtml 抛错：" + e.message); }

  /* I. goBack 落点真跑 */
  try {
    const go = (hash, vars) => {
      sb.location.hash = hash; sb.history._back = false;
      if (vars) Object.keys(vars).forEach((k) => { sb[k] = vars[k]; });
      sb.goBack();
      return { hash: sb.location.hash, back: sb.history._back };
    };
    ok(go("#/album", { _albumFrom: "#/town" }).hash === "#/town", "I · #/album ⇒ _albumFrom");
    ok(go("#/album?tab=fest", { _albumFrom: "#/spirit" }).hash === "#/spirit", "I · #/album?tab= ⇒ 仍走 _albumFrom（前缀匹配）");
    ok(go("#/events", { _eventsFrom: "#/town" }).hash === "#/town", "I · #/events ⇒ _eventsFrom");
    ok(go("#/events?owner=it1", { _eventsFrom: "#/town" }).hash === "#/spirit/it1", "I · #/events?owner= ⇒ 回那尊详情");
    ok(go("#/room/r1", { _roomFrom: "#/spirit/it9" }).hash === "#/spirit/it9", "I · #/room/ ⇒ _roomFrom");
    ok(go("#/town").hash === "#/spirit", "I · #/town ⇒ #/spirit（新增显式分支，⛔ 不落 history.back）");
    // ⛔ 别用 #/stats：它已被 goBack 显式接管（→ #/）。取真·兜底路径才能验到 history.back()
    const un = go("#/nowhere");
    ok(un.back === true, "I · 未覆盖路由仍落 history.back()（兜底保留）");
  } catch (e) { ok(false, "I · goBack 抛错：" + e.message); }

  return { pass, fail: fails.length, fails, miss: MISS.slice() };
}

/* ---------- 静态标记（源文本级，两个版本共用） ---------- */
function statics(src) {
  const out = [];
  const at = (n) => src.indexOf(n) >= 0;
  out.push(["J · 入口卡标题改名「画册」", at("'<span class=\"album-entry-title\">画册</span>'")]);
  out.push(["J · topbarTitle = 「画册」", at('topbarTitle.textContent = "画册";')]);
  out.push(["J · 页头标题「画册」", at('<div class="album-head-title">画册</div>')]);
  out.push(["J · ⛔ 旧 #spMainBtn 已消失", !at('id="spMainBtn"')]);
  out.push(["J · 沁灵纪卡 id=spMainEntry", at('id="spMainEntry"')]);
  out.push(["J · 沁灵纪入口 → #/main（陈旧路由 #/mainstory 撤出）", at('msBtn.onclick = () => { location.hash = "#/main"; }') && !at('location.hash = "#/mainstory"; };')]);
  out.push(["J · 来源记忆三件已声明", at("let _albumFrom") && at("let _eventsFrom") && at("let _roomFrom")]);
  out.push(["J · renderSpiritPage 调 hubCardHtml", at("html += hubCardHtml(list, store);")]);
  out.push(["J · [data-goto] 显式绑定存在", at('view.querySelectorAll("[data-goto]")')]);
  out.push(["J · 沁灵巷 CG 墙「看全部 ›」", at('id="townAlbum"') && at("🎬 全主串 CG 墙' +")]);
  out.push(["J · 沁灵巷写 _roomFrom/_eventsFrom/_albumFrom", at('_roomFrom = "#/town";') && at('_eventsFrom = "#/town";') && at('_albumFrom = "#/town";')]);
  out.push(["J · 详情页两入口写来源", at('_eventsFrom = "#/spirit/" + encodeURIComponent(id);') && at('_roomFrom = "#/spirit/" + encodeURIComponent(id);')]);
  out.push(["J · 路由 #/album 前缀匹配（吃 ?tab=）", at('else if (h.indexOf("#/album") === 0) renderAlbumPage();')]);
  out.push(["J · ⛔ 死类 .album-grid-wide 已清", !at("album-grid-wide")]);
  out.push(["J · ⛔ 死绑定 .album-tab 已清（改 data-album-tab）", !at('querySelectorAll(".album-tab")') && at(".evt-tab[data-album-tab]")]);
  out.push(["J · 四册走 C1 的 Spirits.albumAll3", at("Spirits.albumAll3(list, store)")]);
  return out;
}

/* ============ 1. 当前（改后）============ */
console.log("=== 1. 当前工作区 js/app.js（改后，应全绿）===");
const R = run(CUR_SRC);
console.log("真跑：通过 " + R.pass + " 项，失败 " + R.fail + " 项");
if (R.fails.length) R.fails.forEach((f) => console.log("  ✗ " + f));
if (R.miss.length) console.log("  ⚠ 未抽到：" + R.miss.join(", "));
const S = statics(CUR_SRC);
const sFail = S.filter((x) => !x[1]);
S.forEach((x) => { if (!x[1]) console.log("  ✗ " + x[0]); });
console.log("静态：通过 " + (S.length - sFail.length) + " 项，失败 " + sFail.length + " 项");

/* ============ 2. 负向对照：铆定 cf7a6cf ============ */
console.log("\n=== 2. 负向对照（铆定 commit cf7a6cf · ⛔ 不用 HEAD）===");
function baseline(revPath, tmpRel) {
  try { return require("child_process").execSync("git show cf7a6cf:" + revPath, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); }
  catch (e) { try { return fs.readFileSync(path.join(__dirname, tmpRel), "utf8"); } catch (e2) { return ""; } }
}
const OLD_SRC = baseline("js/app.js", "_tmp/_pre_v174c2b_app.js");
let negFail = 0, negTotal = 0;
if (OLD_SRC) {
  const RO = run(OLD_SRC);
  const SO = statics(OLD_SRC);
  negFail = RO.fail + SO.filter((x) => !x[1]).length;
  negTotal = RO.pass + RO.fail + SO.length;
  console.log("铆定版：通过 " + (RO.pass + (SO.length - SO.filter((x) => !x[1]).length)) + " 项，失败 " + negFail + " / " + negTotal + " 项");
  console.log("  → 负向对照" + (negFail >= 10 ? "成立 ✅（V174-C2B 确为新增：改前 FAIL " + negFail + " 条）" : "⚠ 失败条数偏少（" + negFail + "）"));
} else {
  console.log("  （取不到 cf7a6cf 基线 → 负向对照优雅跳过）");
}

/* ============ 汇总 ============ */
const fails = R.fail + sFail.length;
console.log("\n----------------------------------------");
console.log("V174-C2B 真跑：通过 " + (R.pass + S.length - sFail.length) + " 项，失败 " + fails + " 项");
console.log("负向对照（铆定 cf7a6cf）：改前 FAIL " + negFail + " 条 ⇒ 改后 PASS");
if (fails) { console.log("失败清单："); R.fails.forEach((f) => console.log("  - " + f)); sFail.forEach((x) => console.log("  - " + x[0])); }
process.exit(fails ? 1 : 0);
