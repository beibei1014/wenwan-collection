/* V172-B · 主线选角界面层「真跑」自测
 * ===========================================================================
 * 目的：不止静态挂点（_test_v172_cast.js 已钉），而是把 app.js 里 v172 新增的
 *       **真实源码**抽出来，配真 Spirits（js/spirits.js）+ 最小桩，真调用：
 *         - castEntryHtml()  三态（0 / 部分 / 全点）
 *         - renderMainCastPage()  真渲染 HTML，验证 7 行 / 状态互斥 / 空态条
 *         - openCastSheet()   自绘面板真产出 cast-opt（不抛错）
 *       ⛔ 不断言「理论上」——每条路径真的走一遍。
 *
 * 用法： node docs/_test_v172b_page.js
 * 负向对照（证明抓得住「界面层没落地」）：
 *   git show 24a3fe6:js/app.js > /tmp/app_prev.js && APP_SRC_FILE=/tmp/app_prev.js node docs/_test_v172b_page.js  → 必须 FAIL
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const SRC_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const src = fs.readFileSync(SRC_FILE, "utf8");
const skin = fs.readFileSync(path.join(ROOT, "css/skin.css"), "utf8");
console.log("源码：" + SRC_FILE);

let PASS = 0, FAIL = 0;
const F = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; F.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 抽函数 / 抽 const（大括号配对，跳字符串 / 注释） ---------- */
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error("找不到函数 " + name);
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
function extractConstObj(name) {
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*\\{");
  const m = re.exec(src);
  if (!m) throw new Error("找不到 const " + name);
  const s0 = src.indexOf("{", m.index);
  let i = s0, depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") { const q = ch; i++; while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) break; i++; } continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return "const " + name + " = " + src.slice(s0, i) + ";";
}

/* ---------- 真 Spirits（带完整桩的 context） ---------- */
const hc = H.makeContext();
const SEED = {
  it1: { look: { pers: "dignified" }, persona: { id: "dignified", name: "大檀" }, bond: 50, stage: 2 },
  it2: { look: { pers: "sweet" }, persona: { id: "sweet", name: "小甜" }, bond: 40, stage: 1 },
  it3: { look: { pers: "scholar" }, persona: { id: "scholar", name: "阿青" }, bond: 30, stage: 3 },
};
hc.store.setItem("ww_spirits", JSON.stringify(SEED));
H.loadFile(hc.ctx, "js/spirits.js");
const Spirits = hc.sandbox.Spirits;

/* ---------- 最小 DOM 桩（记录 createElement 出的节点） ---------- */
const created = [];
function makeNode() {
  const n = {
    style: {}, dataset: {}, hidden: false, innerHTML: "", textContent: "", className: "",
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, appendChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [],
    contains: () => false, after() {}, before() {},
  };
  created.push(n);
  return n;
}
const ITEMS = [
  { id: "it1", name: "大檀" },
  { id: "it2", name: "小甜" },
  { id: "it3", name: "阿青" },
];
const sandbox = {
  console: console,
  Spirits: Spirits,
  localStorage: hc.store,
  spiritItems: () => ITEMS,
  spiritItemById: (id) => ITEMS.filter((x) => String(x.id) === String(id))[0] || null,
  nameOf: (it) => (SEED[it.id] && SEED[it.id].persona && SEED[it.id].persona.name) || it.name || "沁灵",
  spiritThumbCgHtml: (it, rec, size) => '<span class="spirit-thumb" data-size="' + size + '">' + it.id + "</span>",
  DB: { daysWith: () => 10 },
  $: () => null,
  topbarTitle: { textContent: "" },
  btnBack: { style: {} },
  btnSettings: { style: {} },
  toast: (m) => { sandbox._toasts.push(String(m)); },
  scrollTo() {},
  // esc 与 app.js:363 同款（extractFn 抽不动含正则字符类的 esc；此处只做等价桩）
  esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  _toasts: [],
  _pushed: 0,
  document: {
    createElement: () => makeNode(),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild() {}, contains: () => false },
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.fetch = () => Promise.reject(new Error("no network"));
let ctx = vm.createContext(sandbox);

/* 抽函数 + 常量的真实源码，拼成一段脚本真跑 */
const FN_LIST = [
  "renderMainCastPage", "castEntryHtml", "castPickHtml", "castRowHtml",
  "castCopy", "castDescOf", "castMain", "castNames", "castManualCount", "castOwners",
  "castPersist", "castRevertSlot", "castRevertAll", "castAssignSlot", "castAutoAssignAll",
  "ensureCastSheet", "closeCastSheet", "openCastSheet",
];
let script;
try {
  script =
    "var _castMask = null, _castSheet = null;\n" +
    "var _spiritsDirty = false;\n" +
    "var pushSpirits = function () { };\n" +
    extractConstObj("CAST_ROW_STATE") + "\n" +
    FN_LIST.map(extractFn).join("\n") + "\n";
  vm.runInContext(script, ctx, { filename: "v172b-extract" });
} catch (e) {
  console.log("✗ 抽函数脚本无法执行：" + e.message);
  process.exit(1);
}
function renderPage() { const v = makeNode(); sandbox.view = v; ctx.renderMainCastPage(); return String(v.innerHTML || ""); }

/* ========================================================================
 * 1 · 入口卡三态（castEntryHtml）
 * ====================================================================== */
section("1 · 入口卡三态（按「手动点了几位」）");
{
  Spirits.castClearAllManual(); Spirits.castOf({ force: true });
  const h = ctx.castEntryHtml();
  ok(h.indexOf("cast-entry") >= 0, "入口卡有 .cast-entry");
  ok(h.indexOf("is-empty") >= 0, "0 位手动态 → .cast-entry.is-empty（醒目）");
  const badge = (Spirits.CHAP_CAST_COPY || {}).ENTRY_BADGE;
  ok(!!badge && h.indexOf(badge) >= 0, "0 位手动态 → 显示角标「" + badge + "」");
  ok(h.indexOf('data-goto="#/maincast"') >= 0, "入口卡 data-goto=#/maincast");
}
{
  Spirits.castSetManual("dignified", "it1"); Spirits.castOf({ force: true });
  const h = ctx.castEntryHtml();
  ok(h.indexOf("已点 1 位") >= 0, "点过 1 位 → 副行「已点 1 位 · 其余按交情」");
  ok(h.indexOf("is-empty") < 0, "点过一部分 → 不再是空态");
}
{
  Spirits.CHAP_CAST_CFG.MAIN.forEach((p, i) => Spirits.castSetManual(p, ITEMS[i % ITEMS.length].id));
  Spirits.castOf({ force: true });
  const h = ctx.castEntryHtml();
  ok(h.indexOf("七位都是你点的") >= 0, "7 位全手动 → 副行「七位都是你点的」");
}

/* ========================================================================
 * 2 · renderMainCastPage 真渲染（0 手动 · 3 只 ⇒ 空态条）
 * ====================================================================== */
section("2 · renderMainCastPage 真渲染（结构 / 空态条 / 状态互斥）");
{
  Spirits.castClearAllManual(); Spirits.castOf({ force: true });
  const h = renderPage();
  ok(h.indexOf("cast-head") >= 0, "含 .cast-head 页顶一句");
  ok(h.indexOf((Spirits.CHAP_CAST_COPY || {}).HEAD) >= 0, "页顶文案取自 CHAP_CAST_COPY.HEAD（非硬编码）");
  ok(h.indexOf("cast-all-note") >= 0 && h.indexOf("cast-count-line") >= 0, "<7 只 ⇒ 空态条 + 中性数据行都在");
  ok(h.indexOf("在册 3 位") >= 0, "中性数据行填了在册数「在册 3 位」（实得片段：" + (h.match(/在册[^<]*/) || [""])[0] + "）");
  const slots = (h.match(/data-slot="/g) || []).length;
  ok(slots === 7, "恰好 7 个行当行（实得 " + slots + "）");
  const rows = h.split('<div class="cast-row ');
  let stateN = 0;
  rows.slice(1).forEach((r) => {
    const cls = r.slice(0, r.indexOf('"'));
    const hit = ["is-picked", "is-auto", "is-fill", "is-empty"].filter((k) => cls.indexOf(k) >= 0).length;
    if (hit === 1) stateN++;
  });
  ok(stateN === 7, "7 行各有且仅有一个状态类（实得 " + stateN + "）");
  ok(h.indexOf("cast-auto-tag") >= 0, "自动 / 顶着行渲染了「家里顶的」徽标");
  ok(h.indexOf("cast-seal") < 0 && h.indexOf("cast-unset") < 0, "0 手动 ⇒ 不渲染朱印 / 小叉");
}
{
  Spirits.castSetManual("dignified", "it1"); Spirits.castOf({ force: true });
  const h = renderPage();
  const pickedRows = h.split('<div class="cast-row ').filter((r) => r.slice(0, r.indexOf('"')).indexOf("is-picked") >= 0);
  ok(pickedRows.length === 1, "手动 1 行 ⇒ 恰 1 个 .is-picked（实得 " + pickedRows.length + "）");
  const pr = pickedRows[0] || "";
  ok(pr.indexOf("cast-seal") >= 0, "手动态渲染朱印 .cast-seal");
  ok(pr.indexOf("cast-unset") >= 0, "手动态渲染小叉 .cast-unset");
  ok(pr.indexOf("cast-auto-tag") < 0, "★ 手动态 ⛔ 不渲染「家里顶的」徽标（互斥）");
  ok(h.indexOf("data-goto") < 0, "选角页本体没有入口卡（那是 #/main 的）");
}

/* ========================================================================
 * 3 · openCastSheet 真产出 cast-opt
 * ====================================================================== */
section("3 · openCastSheet 自绘面板");
{
  ctx.openCastSheet("dignified");
  const sheet = created.filter((n) => n.className === "cast-sheet").pop();
  ok(!!sheet, "创建了 .cast-sheet 面板");
  const inner = sheet ? String(sheet.innerHTML || "") : "";
  ok(inner.indexOf("cast-sheet-title") >= 0, "面板有标题（点谁扮「最老的那只」）");
  ok(inner.indexOf("cast-opt") >= 0, "面板列出 cast-opt 选项");
  ok((inner.match(/class="cast-opt/g) || []).length >= 3, "选项数 ≥ 在册数（3 只）");
  ok(inner.indexOf("cast-opt-name") >= 0, "选项带名字");
  ok(inner.indexOf("is-current") >= 0, "当前这一行选中项挂 .cast-opt.is-current");
}

/* ========================================================================
 * 4 · CSS 互斥保险（静态抽样）
 * ====================================================================== */
section("4 · CSS：朱印 × 徽标互斥兜底");
{
  ok(/\.cast-row\.is-picked \.cast-auto-tag\s*\{\s*display:\s*none/.test(skin), "CSS 有 .cast-row.is-picked .cast-auto-tag { display:none }");
  ok(/\.cast-row\.is-auto \.cast-seal/.test(skin), "CSS 有 .is-auto .cast-seal 隐藏规则");
  ok(/\.cast-head\b/.test(skin) && /\.cast-count-line\b/.test(skin), "CSS 有 .cast-head / .cast-count-line");
}

/* ---------- 汇总 ---------- */
console.log("\n----------------------------------------");
console.log("V172-B 界面层真跑：通过 " + PASS + " 项，失败 " + FAIL + " 项");
if (F.length) { console.log("失败清单："); F.forEach((x) => console.log("  - " + x)); }
process.exit(FAIL ? 1 : 0);
