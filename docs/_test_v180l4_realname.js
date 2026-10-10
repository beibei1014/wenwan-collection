/* ============================================================
 * _test_v180l4_realname.js · V180 · L4 · 对话显示真名（引擎侧「真名兜底」）
 * ------------------------------------------------------------
 * 用户显式要求：对话里的**名牌**必须显示真名，不许显示「XX的那位 / XX的」这类描述词。
 * 落点：js/app.js `bookSpeakerName(L)`（引擎侧口径），由 `bookMsgOf` 消费：
 *   优先级 ① role（脚本自带正式姓名）＞ ② 身份表反查（手串名/旧名/别名 → 真名）＞ ③ who（描述词兜底）
 *
 * 覆盖：
 *   A · 静态：bookSpeakerName 存在；bookMsgOf 走真名（castName/speaker = nm），who 字段一字不动
 *   B · 运行：三条优先级逐条验证（role 胜 / 身份表胜 / 描述词回落）
 *   C · 全库扫：〈结契篇〉全篇对白名牌**一律真名**（唯一豁免「有人」——正文刻意压名，⛔ 不冒名）
 *   D · 负向对照：APP_SRC_FILE 指向 L4 落地前 ⇒ 必须红
 *
 * 用法： node docs/_test_v180l4_realname.js
 * 负向对照： APP_SRC_FILE=docs/_tmp/_pre_v180l4_app.js node docs/_test_v180l4_realname.js  ⇒ 必须 FAIL
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const appSrc = fs.readFileSync(APP_FILE, "utf8");
console.log("app 源码：" + APP_FILE);

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
/* 源码抽数组字面量 var NAME = [ ... ]; （自 var 起，含结尾分号） */
function sliceVar(name) {
  const i = appSrc.indexOf("var " + name + " = [");
  if (i < 0) return null;
  const j = appSrc.indexOf("\n  ];", i);
  if (j < 0) return null;
  return appSrc.slice(i, j + 5);
}

/* 身份表真源（同 _test_v180_book.js 口径）
   —— 源码里以 { name: "X", style: "Y" 起头 ⇒ 抓出 16 位正式姓名 */
const FORMAL = [];
{
  const reId = /\{ name: "([^"]+)", style: "([^"]+)"/g;
  let mi; while ((mi = reId.exec(appSrc))) FORMAL.push(mi[1]);
}

/* ============================================================
 * A · 静态：落点齐备
 * ============================================================ */
section("A · 静态：bookSpeakerName 落点 + bookMsgOf 走真名");
const speakerFnSrc = extractFn("bookSpeakerName");
const msgFnSrc = extractFn("bookMsgOf");
ok(!!speakerFnSrc, "app.js 定义了 bookSpeakerName（引擎侧真名兜底入口）");
ok(!!msgFnSrc && msgFnSrc.indexOf("bookSpeakerName(") >= 0, "bookMsgOf 调用 bookSpeakerName 解析说话人");
ok(!!msgFnSrc && /castName:\s*nm/.test(msgFnSrc), "名牌字段 castName = nm（真名优先，不再直接挂 who）");
ok(!!msgFnSrc && /speaker:\s*nm/.test(msgFnSrc), "立绘字段 speaker = nm（与名牌指向同一真名）");
ok(!!msgFnSrc && /name:\s*who/.test(msgFnSrc), "⛔ who 字段一字不动（仍原样落 name，护数据断言与抽取器围栏）");
ok(!!speakerFnSrc && /spiritIdentityOf/.test(speakerFnSrc), "bookSpeakerName 含身份表反查分支（手串名/旧名 → 真名）");
ok(!!speakerFnSrc && /if\s*\(\s*role\s*\)\s*return\s+role/.test(speakerFnSrc), "优先级①：role 存在即直接返回真名");
ok(FORMAL.length >= 16, "身份表抽出 ≥16 位正式姓名（实得 " + FORMAL.length + "）");

/* ============================================================
 * B · 运行：三条优先级
 * ============================================================ */
section("B · 运行：真名优先级（role ＞ 身份表 ＞ 描述词）");
let bookFn = null;
if (speakerFnSrc) {
  const idSrc = extractFn("spiritIdentityOf");
  const keysSrc = extractFn("identityKeysOf");
  const tblSrc = sliceVar("SPIRIT_IDENTITIES");
  ok(!!idSrc && !!keysSrc && !!tblSrc, "身份表运行时三件套（spiritIdentityOf / identityKeysOf / SPIRIT_IDENTITIES）可抽");
  if (idSrc && keysSrc && tblSrc) {
    const sb = {};
    vm.runInNewContext(tblSrc + "\n" + keysSrc + "\n" + idSrc + "\n" + speakerFnSrc + "\n;__book = bookSpeakerName;", sb, { filename: "app.js#l4" });
    bookFn = sb.__book;
  }
} else {
  ok(false, "bookSpeakerName 不存在 ⇒ 运行段无法执行（负向对照预期）");
}
if (typeof bookFn === "function") {
  ok(bookFn({ who: "最沉的那位", role: "顾时笙" }) === "顾时笙", "① role 胜：描述词「最沉的那位」+ role「顾时笙」 ⇒ 顾时笙");
  ok(bookFn({ who: "柿宝" }) === "楚柿遥", "② 身份表反查：手串旧名「柿宝」 ⇒ 楚柿遥（alias）");
  ok(bookFn({ who: "黄金算盘" }) === "萧景筹", "② 身份表反查：手串名「黄金算盘」 ⇒ 萧景筹（bead）");
  ok(bookFn({ who: "莫高窟" }) === "陆临崖", "② 身份表反查：手串名「莫高窟」 ⇒ 陆临崖（bead，无需 alias）");
  ok(bookFn({ who: "顾时笙" }) === "顾时笙", "② 真名直命中身份表 ⇒ 原样");
  ok(bookFn({ who: "有人" }) === "有人", "③ 回落：既无 role 又不在身份表 ⇒ 原样「有人」（⛔ 不冒名）");
  ok(bookFn({ who: "最沉的那位", role: "顾时笙" }) === bookFn({ who: "最沉的那位", role: "顾时笙" }), "幂等：同一入参多次解析结果一致");
  ok(bookFn({ who: "", role: "" }) === "", "空说话人 ⇒ 空串（不造名）");
}

/* ============================================================
 * C · 全库扫：〈结契篇〉全篇对白名牌一律真名
 * ============================================================ */
section("C · 全库扫：〈结契篇〉对白名牌 0 描述词残留（豁免：「有人」压名 / 「岑照野」域外非沁灵）");
let BOOK = null;
try { BOOK = require(path.join(ROOT, "js", "book-jieqi.js")); } catch (e) { BOOK = null; }
ok(!!BOOK && Array.isArray(BOOK.chapters) && BOOK.chapters.length > 0, "读到 js/book-jieqi.js 数据（章数 " + (BOOK && BOOK.chapters ? BOOK.chapters.length : 0) + "）");
if (BOOK && typeof bookFn === "function") {
  /* ⛔ 豁免两类（都不是「描述词残留」，也都不冒名）：
     ① 「有人」＝正文刻意压名（第 1 章背后那一句）；
     ② 「岑照野」＝岷阳域记数人（域外凡人，**非沁灵**，不进身份表 ⇒ 立绘回落为无）。 */
  const ALLOW = ["有人", "岑照野"];
  const bad = []; const seen = {};
  let dCount = 0, formalCount = 0, allowCount = 0, anonN = 0, outerN = 0;
  BOOK.chapters.forEach((c, i) => (c.lines || []).forEach((l) => {
    if (l.k !== "d") return;
    dCount++;
    const nm = bookFn(l);                        // 引擎口径解析（真名优先）
    if (!nm) { bad.push("章" + (i + 1) + " 空说话人"); return; }
    seen[nm] = (seen[nm] || 0) + 1;
    if (FORMAL.indexOf(nm) >= 0) { formalCount++; return; }
    if (ALLOW.indexOf(nm) >= 0) { allowCount++; if (nm === "有人") anonN++; else outerN++; return; }
    bad.push("章" + (i + 1) + " 残留描述词「" + nm + "」");
  }));
  ok(dCount > 0, "全篇统计到对白 " + dCount + " 条");
  ok(bad.length === 0, "★ 全篇名牌 0 描述词残留（真名 " + formalCount + " 条 / 豁免 " + allowCount + " 条；残留：" + (bad.join("；") || "无") + "）");
  ok(anonN === 1, "豁免「有人」恰 1 条（第 1 章正文压名，实得 " + anonN + "）");
  ok(outerN === 24, "豁免「岑照野」24 条（第 9/12 章域外记数人，⛔ 非沁灵，实得 " + outerN + "）");
  ok(formalCount + allowCount === dCount, "全部对白名牌 = 真名 + 两类豁免（" + (formalCount + allowCount) + "/" + dCount + "）");
  // 描述词词表负向：任何落地的 who 若带「的那位/的那只/的那一个」且无 role，必须已被拦（上面 bad 已覆盖）
  const dirty = Object.keys(seen).filter((k) => /的(那位|那只|这位|这只|那一个|这一个|一位|一个)$/.test(k));
  ok(dirty.length === 0, "解析后名牌 0 条以「的XX」结尾（残留：" + (dirty.join("、") || "无") + "）");
}

/* ============================================================
 * D · 负向对照锚点
 * ============================================================ */
section("D · 负向对照（APP_SRC_FILE 指向 L4 落地前 ⇒ 必须红）");
if (process.env.APP_SRC_FILE) console.log("  当前指向：" + APP_FILE);

/* ---------- 汇总 ---------- */
console.log("\n----------------------------------------");
if (FAILURES.length) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
process.exit(FAIL === 0 ? 0 : 1);
