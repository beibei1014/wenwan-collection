/* V170 自测：立绘透明底抠图（连通域 flood-fill）+ 剧情页改用透明立绘（仅最新立绘，不混 CG）
 * 用法：
 *   node docs/_test_v170_cutout.js
 * 负向对照（指向改动前 = V169 a6d3b02 的 app.js / skin.css，必须 FAIL）：
 *   APP_SRC_FILE=docs/_tmp/_pre_v170_app.js SKIN_FILE=docs/_tmp/_pre_v170_skin.css node docs/_test_v170_cutout.js
 *
 * 分工（项目纪律）：本套件只负责抠图算法 + 剧情页接线 + CSS + 负向对照；
 *   任何改 render* 的 HTML 拼接都必须另跑 docs/_test_v163c_layout.js（标签栈解析）。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const CSS_FILE = process.env.SKIN_FILE ? path.resolve(process.env.SKIN_FILE) : path.join(ROOT, "css/skin.css");
const appSrc = fs.readFileSync(APP_FILE, "utf8");
const cssSrc = fs.readFileSync(CSS_FILE, "utf8");
console.log("app 源码：" + APP_FILE + "\ncss 源码：" + CSS_FILE);

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 源码抽函数（大括号配对，跳过字符串/注释） ---------- */
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(appSrc);
  if (!m) return null;
  let i = appSrc.indexOf("(", m.index), pd = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === "(") pd++;
    else if (appSrc[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < appSrc.length && appSrc[i] !== "{") i++;
  let depth = 0;
  for (; i < appSrc.length; i++) {
    const ch = appSrc[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < appSrc.length) { if (appSrc[i] === "\\") { i += 2; continue; } if (appSrc[i] === q) break; i++; }
      continue;
    }
    if (ch === "/" && appSrc[i + 1] === "/") { while (i < appSrc.length && appSrc[i] !== "\n") i++; continue; }
    if (ch === "/" && appSrc[i + 1] === "*") { const e = appSrc.indexOf("*/", i); i = e < 0 ? appSrc.length : e + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return appSrc.slice(m.index, i);
}

const maskSrc = extractFn("cutoutAlphaMask");
const cutSrc = extractFn("cutoutTransparent");
const pngShrinkSrc = extractFn("shrinkPngToDataUri");
const pngUploadSrc = extractFn("spiritUploadPng");
const makeCutSrc = extractFn("makeSpiritCut");
const backfillSrc = extractFn("backfillSpiritCut");
const talkSrc = extractFn("renderTalkPage");
const mainSrc = extractFn("renderMainTalkPage");
const chapSrc = extractFn("renderChapTalkPage");

/* ================= A. 纯算法：连通域 vs 全局色键（核心） ================= */
section("A. cutoutAlphaMask —— 连通域正确性（核心）");
ok(!!maskSrc, "抽到 cutoutAlphaMask");
ok(!!maskSrc && /stack\.push/.test(maskSrc) && /seed\(/.test(maskSrc) && /vis\[p\]/.test(maskSrc),
  "用 flood-fill 连通域（种子从四边出发、stack 扩散、vis 记账）—— 非全局色键");

const TOL_M = /const\s+CUTOUT_TOL\s*=\s*(\d+)/.exec(appSrc);
const TOL = TOL_M ? Number(TOL_M[1]) : 34;
function runMask(d, W, H) {
  const sandbox = { Uint8Array, Math, Object, Array, Number, isNaN, CUTOUT_TOL: TOL };
  vm.runInNewContext(maskSrc + "\n;__fn = cutoutAlphaMask;", sandbox, { filename: "app.js#cutoutAlphaMask" });
  return sandbox.__fn(d, W, H);
}
function mk(W, H, color) { const d = new Uint8ClampedArray(W * H * 4); for (let p = 0; p < W * H; p++) { d[p * 4] = color[0]; d[p * 4 + 1] = color[1]; d[p * 4 + 2] = color[2]; d[p * 4 + 3] = 255; } return d; }
function setPx(d, W, x, y, c) { const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
function alphaAt(d, W, x, y) { return d[(y * W + x) * 4 + 3]; }

// T1：纯色底 + 中间方块 + 方块内一个「与底色同色的洞」→ 底被删、**洞被保留**
if (maskSrc) {
  const W = 100, H = 100, BG = [200, 200, 200], FG = [40, 40, 40];
  const d = mk(W, H, BG);
  for (let y = 20; y <= 79; y++) for (let x = 20; x <= 79; x++) setPx(d, W, x, y, FG);       // 前景方块 60×60
  for (let y = 45; y <= 54; y++) for (let x = 45; x <= 54; x++) setPx(d, W, x, y, BG);       // 洞：与底色同色，但不与外部连通
  const holeBefore = d[(49 * W + 49) * 4 + 1];
  const res = runMask(d, W, H);
  ok(res && res.removed > 0 && res.total === W * H, "T1 返回成功 {removed,total}");
  ok(alphaAt(d, W, 0, 0) === 0, "T1 四角底色 → alpha=0（背景被删）");
  ok(alphaAt(d, W, 49, 49) === 255, "T1 ★洞被保留（alpha=255）—— 全局色键会把它误删，连通域不会");
  ok(d[(49 * W + 49) * 4 + 1] === holeBefore, "T1 洞像素 RGB 原样保留（未被改动）");
  ok(alphaAt(d, W, 30, 30) === 255, "T1 前景方块内部 → alpha=255（保留）");
  ok(alphaAt(d, W, 20, 20) === 0, "T1 前景最外圈（贴背景）→ erode 1px 去晕边，alpha=0");

  // T2：噪声/无主背景 → 移除面积 <15% → 失败，返回 null 且不改 d
  const d2 = mk(80, 80, [0, 0, 0]);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) setPx(d2, 80, x, y, [100 + (x % 2) * 140, 100 + (y % 2) * 140, 100]);  // 4 色棋盘，无 4-连通同色块
  const snap2 = d2.slice();
  const res2 = runMask(d2, 80, 80);
  ok(res2 === null, "T2 无主背景 → 判失败（返回 null，不写字段）");
  ok(Buffer.compare(Buffer.from(d2), Buffer.from(snap2)) === 0, "T2 失败时 d 未被改动（回落原图）");

  // T3：>85% 全是背景（前景极小块）→ 判失败
  const d3 = mk(100, 100, [210, 210, 210]);
  for (let y = 45; y <= 54; y++) for (let x = 45; x <= 54; x++) setPx(d3, 100, x, y, [30, 30, 30]);
  const res3 = runMask(d3, 100, 100);
  ok(res3 === null, "T3 背景占比 >85% → 判失败（防把整张图删光）");
}

/* ================= B. DOM 包装 + 存储（PNG 保 alpha） ================= */
section("B. cutoutTransparent / 上传 / 回填");
ok(!!cutSrc && /CUTOUT_LONG_EDGE/.test(cutSrc) && /toDataURL\("image\/png"\)/.test(cutSrc),
  "cutoutTransparent：降采样到长边 CUTOUT_LONG_EDGE + 输出 PNG data URI");
ok(!!cutSrc && /getImageData/.test(cutSrc) && /putImageData/.test(cutSrc), "cutoutTransparent：读写 canvas 像素");
ok(!!cutSrc && /resolve\(""\)/.test(cutSrc), "cutoutTransparent：任何失败都返回 \"\"（不抛错）");
ok(!!pngShrinkSrc && /toDataURL\("image\/png"\)/.test(pngShrinkSrc), "shrinkPngToDataUri 输出 PNG（⛔ 不是 JPEG）");
ok(!!pngUploadSrc && /"spirit-cut\.png"/.test(pngUploadSrc) && /image\/png/.test(pngUploadSrc),
  "spiritUploadPng：命名 *.png + contentType image/png（保留 alpha）");
ok(!!makeCutSrc && /cutoutTransparent/.test(makeCutSrc) && /spiritUploadPng/.test(makeCutSrc),
  "makeSpiritCut：抠图 → spiritUploadPng → 永久 URL");
ok(!!makeCutSrc && !/imageToStoreUrl/.test(makeCutSrc),
  "makeSpiritCut ⛔ 不走 imageToStoreUrl（那条压 JPEG 会丢 alpha）");
ok(!!backfillSrc && /Spirits\.ensureIn/.test(backfillSrc) && /Spirits\.load/.test(backfillSrc) && /Spirits\.save/.test(backfillSrc),
  "backfillSpiritCut：走 Spirits.load/save/ensureIn");
ok(!!backfillSrc && /r2\.imgUrl === rec\.imgUrl && !r2\.imgCut/.test(backfillSrc) && /r2\.imgCut = cut/.test(backfillSrc),
  "backfillSpiritCut：await 后重新 load、只写 imgCut（绝不 save 旧快照覆盖立绘）");
ok(!!backfillSrc && !/generate|\bcgUrl\b|createSpiritImage/.test(backfillSrc), "backfillSpiritCut：⛔ 不重新出图 / 不碰 cgUrl");

/* ================= C. 剧情页接线：仅最新立绘、不混 CG、透明切换 ================= */
section("C. 剧情页 o.portrait（imgCut 优先 / 不混 CG）");
ok(!!mainSrc && /portrait:/.test(mainSrc) && /rec\.imgCut \|\| rec\.imgUrl/.test(mainSrc),
  "renderMainTalkPage.portrait：优先 imgCut，回落 imgUrl");
ok(!!mainSrc && /portraitCut:/.test(mainSrc), "renderMainTalkPage 传 portraitCut（透明切换信号）");
ok(!!chapSrc && /rc0\.imgCut \|\| rc0\.imgUrl/.test(chapSrc) && /portraitCut:/.test(chapSrc),
  "renderChapTalkPage.portrait/portraitCut：imgCut 优先");
ok(!!talkSrc && /o\.portraitCut/.test(talkSrc) && /pEl\.dataset\.cut = cut \? "1" : "0"/.test(talkSrc),
  "present：读 o.portraitCut → pEl.dataset.cut = \"1\"/\"0\"（⛔ 不靠猜）");
// 行为断言：真跑 renderMainTalkPage 里的 portrait 取数器 —— 断言 imgCut 优先、且**永不返回 cgUrl**
function extractArrow(src, key) {
  const m = new RegExp(key + ":\\s*(\\(m\\)\\s*=>\\s*\\{[\\s\\S]*?\\n      \\}),").exec(src);
  return m ? m[1] : null;
}
function runPortrait(arrow, cast, store) {
  const sb = { String, Spirits: { castOf: () => cast, load: () => store } };
  vm.runInNewContext("__fn = (" + arrow + ");", sb, { filename: "portrait" });
  return sb.__fn;
}
if (mainSrc) {
  const arrow = extractArrow(mainSrc, "portrait");
  ok(!!arrow, "抽到 renderMainTalkPage.portrait 箭头函数");
  if (arrow) {
    const store = { c1: { imgUrl: "IMG.jpg", imgCut: "", cgUrl: "ADV_CG.png" } };
    const cast = { x: { id: "c1" } };
    const get = runPortrait(arrow, cast, store);
    const m = { w: "sp", ps: ["x"] };
    ok(get(m) === "IMG.jpg", "portrait：无 imgCut → 回落 imgUrl");
    ok(get(m) !== "ADV_CG.png", "portrait：★ !== rec.cgUrl（⛔ 绝不混入进阶 CG）");
    store.c1.imgCut = "CUT.png";
    ok(get(m) === "CUT.png", "portrait：有 imgCut → 优先透明抠图");
    ok(get({ w: "sp" }) === "", "portrait：无说话人 ps → \"\"（不抛错）");
    ok(get(null) === "", "portrait：m=null → \"\"（不抛错）");
  }
}

/* 静态：imgCut 进 normRecV165 默认值 */
const spiritSrc = fs.readFileSync(path.join(ROOT, "js/spirits.js"), "utf8");
ok(/if \(rec\.imgCut == null\) rec\.imgCut = ""/.test(spiritSrc), "normRecV165：老档默认 imgCut = \"\"（兼容）");

/* ================= D. 行为：沙箱实跑 present（data-cut 切换） ================= */
section("D. 行为：present 的透明立绘切换");
function makeEl(id) {
  const el = { _id: id, _cls: new Set(), dataset: {}, style: {}, hidden: false, textContent: "", _html: "", _kids: [], _fc: null, offsetWidth: 0, _lis: {} };
  el.classList = {
    add: (c) => { el._cls.add(c); }, remove: (c) => { el._cls.delete(c); }, contains: (c) => el._cls.has(c),
    toggle: (c, f) => { if (f === undefined) f = !el._cls.has(c); f ? el._cls.add(c) : el._cls.delete(c); return f; },
  };
  el.addEventListener = (t, f) => { (el._lis[t] = el._lis[t] || []).push(f); };
  el.insertBefore = (n) => { el._kids.push(n); return n; };
  el.appendChild = (n) => { el._kids.push(n); return n; };
  el.setAttribute = (k, v) => { el[k] = v; }; el.getAttribute = (k) => el[k];
  el.querySelector = (sel) => (sel === "img" ? (/<img/.test(el._html) ? makeEl("img") : null) : null);
  el.querySelectorAll = () => [];
  Object.defineProperty(el, "innerHTML", {
    get() { return el._html; },
    set(v) { el._html = String(v); el._fc = / </.test(" " + el._html) ? makeEl("fc") : null; },
  });
  Object.defineProperty(el, "firstChild", { get() { return el._fc; }, set(v) { el._fc = v; } });
  return el;
}
function makeSandbox() {
  const reg = {};
  ["#ntBody", "#ntFoot", "#ntPend", "#talkPortrait", "#talkBox", "#talkName", "#talkText", "#talkCue", "#sceneBgBlur", "#sceneBgLayer"]
    .forEach((s) => { reg[s] = makeEl(s); });
  const view = makeEl("view");
  const doc = { createElement: () => makeEl("created"), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: makeEl("body"), documentElement: makeEl("html") };
  const sb = {
    console, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object, Error, RegExp, Promise, Intl, Map, Set,
    encodeURIComponent, decodeURIComponent,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {},
    location: { hash: "#/maintalk/0" }, document: doc,
    $: (sel) => reg[sel] || null,
    view, topbarTitle: { textContent: "", style: {} }, btnBack: { style: {} }, btnSettings: { style: {} },
    esc: (s) => (s == null ? "" : String(s)), fmtTime: () => "12:00",
    meAvatarHtml: () => '<span class="me-av"></span>', bindSpiritImgFallback: () => {},
    talkDwell: () => 700, TALK_LEAD_MS: 300, sceneBgUrl: () => "",
    window: { scrollTo() {} },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  return { sb, reg, view };
}
function run(o) {
  const { sb, reg, view } = makeSandbox();
  const fn = extractFn("renderTalkPage");
  if (!fn) return null;
  vm.runInContext(fn + "\n;__fn=renderTalkPage;", vm.createContext(sb), { filename: "app.js#renderTalkPage" });
  try { sb.__fn(o); } catch (e) { return { err: e, reg, view, sb }; }
  return { err: null, reg, view, sb };
}
const SP = { w: "sp", name: "甲", text: "喂。", slot: "C", ps: ["x"] };
if (talkSrc) {
  // D1：portraitCut → true ⇒ data-cut="1"
  let r = run({
    title: "T", headAv: "", headName: "H", headSub: "S", av: () => "", nameOf: () => "",
    portrait: () => "https://x/cut.png", portraitCut: () => true,
    enter: () => ({ added: [SP], choices: null, ending: null, ended: false, log: [] }),
    replay: () => ({ added: [SP], choices: null, ending: null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  });
  ok(r && !r.err, "D1 不抛异常" + (r && r.err ? " —— " + r.err.message : ""));
  if (r && !r.err) {
    ok(r.reg["#talkPortrait"].dataset.cut === "1", "D1 透明立绘 → data-cut = \"1\"");
    ok(/<img/.test(r.reg["#talkPortrait"]._html), "D1 立绘 <img> 上屏");
  }
  // D2：portraitCut → false ⇒ data-cut="0"
  r = run({
    title: "T", headAv: "", headName: "H", headSub: "S", av: () => "", nameOf: () => "",
    portrait: () => "https://x/raw.jpg", portraitCut: () => false,
    enter: () => ({ added: [SP], choices: null, ending: null, ended: false, log: [] }),
    replay: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  });
  ok(r && !r.err && r.reg["#talkPortrait"].dataset.cut === "0", "D2 非透明立绘 → data-cut = \"0\"");
  // D3：完全不传 portraitCut（旧调用点）⇒ 回落 "0"，不抛错
  r = run({
    title: "T", headAv: "", headName: "H", headSub: "S", av: () => "", nameOf: () => "",
    portrait: () => "https://x/raw.jpg",
    enter: () => ({ added: [SP], choices: null, ending: null, ended: false, log: [] }),
    replay: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  });
  ok(r && !r.err && r.reg["#talkPortrait"].dataset.cut === "0", "D3 无 portraitCut → 回落 \"0\"（向后兼容，不抛错）");
}

/* ================= E. CSS：透明立绘 contain/站底 ================= */
section("E. css/skin.css 透明立绘样式");
ok(!/\r/.test(cssSrc), "skin.css 是 LF（无 CR）");
ok(/\.talk-portrait\[data-cut="1"\] \{[^}]*bottom: calc\(158px \+ env\(safe-area-inset-bottom\)\)/.test(cssSrc),
  "透明立绘：bottom 预留对话框高度（158 + safe）→ 主体落在对话箱之上");
ok(/\.talk-portrait\[data-cut="1"\] img \{[^}]*object-fit: contain; object-position: center bottom/.test(cssSrc),
  "透明立绘 img：contain + center bottom（站底，⛔ 不再 cover 铺满）");
ok(/\.talk-portrait img \{[^}]*object-fit: cover; object-position: center 12%/.test(cssSrc),
  "无 imgCut 时回落原 cover 行为（不退化）");
ok(/\.talk-box \{[^}]*min-height: 132px/.test(cssSrc), "对话框 min-height 仍为 132（与预留高度口径一致）");

/* ================= F. 收尾 ================= */
console.log("\n===== V170 自测" + (process.env.APP_SRC_FILE || process.env.SKIN_FILE ? "（负向对照）" : "") + " =====");
console.log("PASS = " + PASS + "   FAIL = " + FAIL);
if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
