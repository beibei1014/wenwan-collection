/* ============================================================
 * _test_v180_book.js · V180 批G · 《沁灵纪》〈结契篇〉「篇 ＞ 章 ＞ 段」
 * ------------------------------------------------------------
 * ⚠️ 本文件在 **V180-G 落地前一直为红测**（red test）。覆盖：
 *      (0) 篇 / 章 / 段 数据齐全：1 篇 4 章（⛔ 本批只做第 1–4 章），每章段数 > 0
 *      (1) 旁白与对白分工正确：对白带 who、玩家行走 me、旁白不带 who；〔画面〕已转成场景段
 *      (2) 正文区禁词 = 0（您 / 它 / 手串名 / 物化词 / 裸 ASCII 双引号）
 *      (3) 第 3–4 章出现「主人」（称呼已烤死在正文，⛔ 不做运行时替换）
 *      (4) BG 只用已有 key（⛔ 绝不 ensureBg / 不出图）；CG 候选只登记
 *      (5) 立绘口径：核心 10 位走 MAINCHAR_ART；⛔ 未新增立绘键、未加错别名
 *      (6) 引擎与界面接线：book* 已导出、路由 / 返回 / #/main 入口卡到位
 *      (7) 进度落 ww_story.book（⛔ 不进逐串 rec）；老 9 章数据未动
 *
 * 只按源码字符串 + 数据文件跑判定：不 require/运行整个 app.js、不依赖 DOM。
 * 用法： node docs/_test_v180_book.js
 * 负向对照： V180_BOOK_SRC=<落地前的数据文件> node docs/_test_v180_book.js ⇒ 必须红
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => { try { return fs.readFileSync(p, "utf8").replace(/\r/g, ""); } catch (e) { return ""; } };
const APP = read(path.join(ROOT, "js", "app.js"));
const SP = read(path.join(ROOT, "js", "spirits.js"));
const HTML = read(path.join(ROOT, "index.html"));
const BOOK_PATH = process.env.V180_BOOK_SRC || path.join(ROOT, "js", "book-jieqi.js");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }
/* 注释剥离：⛔ 断言只扫「真代码」，注释里写「绝不 ensureBg」这类纪律说明不该被判成违规。
   同时保留字符串字面量（避免 http:// 之类被误当注释）。 */
function stripComments(src) {
  /* 片段可能从注释「中间」切进来（正则锚点落在注释体内）⇒ 先丢掉这段无头的注释尾巴 */
  const firstOpen = src.indexOf("/*"), firstClose = src.indexOf("*/");
  if (firstClose >= 0 && (firstOpen < 0 || firstClose < firstOpen)) src = src.slice(firstClose + 2);
  let out = "", i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] || ""); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        if (src[i] === "\n") { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

console.log("V180-G 〈结契篇〉「篇 ＞ 章 ＞ 段」　数据：" + BOOK_PATH);
console.log("------------------------------------------------------------");

let BOOK = null;
try { BOOK = require(BOOK_PATH); } catch (e) { ok(false, "js/book-jieqi.js 能 require（加载失败：" + e.message + "）"); }
if (!BOOK && !Object.prototype.hasOwnProperty.call(global, "BOOK_JIEQI")) {
  try {
    const g = { window: {} };
    new Function("window", read(BOOK_PATH))(g.window);
    BOOK = g.window.BOOK_JIEQI;
  } catch (e) { /* 留到断言里报 */ }
}

/* ---------- (0) 篇 / 章 / 段 齐全 ---------- */
section("0 · 篇 / 章 / 段 数据齐全（1 篇 4 章）");
ok(!!BOOK && typeof BOOK === "object", "js/book-jieqi.js 挂出 window.BOOK_JIEQI");
ok(BOOK && typeof BOOK.id === "string" && BOOK.id.length > 0, "篇有 id（实得 " + (BOOK && BOOK.id) + "）");
ok(BOOK && typeof BOOK.name === "string" && BOOK.name.length > 0, "篇有篇名（实得 " + (BOOK && BOOK.name) + "）");
ok(BOOK && Array.isArray(BOOK.chapters), "篇有 chapters 数组");
const CHS = (BOOK && Array.isArray(BOOK.chapters)) ? BOOK.chapters : [];
ok(CHS.length === 4, "本批 = 4 章（实得 " + CHS.length + "）");
CHS.forEach((c, i) => {
  const tag = "章" + (i + 1);
  ok(!!c && typeof c.id === "string" && c.id, tag + " 有 id");
  ok(!!c && !!c.title, tag + " 有章名（实得 " + (c && c.title) + "）");
  ok(!!c && !!c.sub, tag + " 有节名（实得 " + (c && c.sub) + "）");
  ok(!!c && Array.isArray(c.lines) && c.lines.length > 0, tag + " 段数 > 0（实得 " + ((c && c.lines) || []).length + "）");
  ok(!!c && Array.isArray(c.bg) && c.bg.length > 0, tag + " 声明了 BG key");
});

/* ---------- (1) 旁白与对白分工 ---------- */
section("1 · 旁白 / 对白 / 玩家行 分工正确");
const KINDS = {};
CHS.forEach((c) => (c.lines || []).forEach((l) => { KINDS[l.k] = (KINDS[l.k] || 0) + 1; }));
ok((KINDS.n || 0) > 0, "有旁白段（n × " + (KINDS.n || 0) + "）");
ok((KINDS.sc || 0) > 0, "有场景段（sc × " + (KINDS.sc || 0) + "）＝ 〔画面提示〕已转成场景描述");
ok((KINDS.d || 0) > 0, "有对白段（d × " + (KINDS.d || 0) + "）");
ok((KINDS.me || 0) > 0, "有玩家行（me × " + (KINDS.me || 0) + "）");
ok(typeof KINDS.s !== "undefined", "有节标题段（s × " + KINDS.s + "）");
let badWho = 0, badMe = 0, badText = 0;
CHS.forEach((c) => (c.lines || []).forEach((l) => {
  if (l.k === "d" && !String(l.who || "").trim()) badWho++;
  if (l.k === "me" && (l.who !== undefined)) badMe++;              // 玩家行不该带 who
  if (l.k === "n" && l.who !== undefined) badWho++;
  if (!String(l.t || "").trim()) badText++;
}));
ok(badWho === 0, "对白段都带非空 who（缺 " + badWho + " 条）");
ok(badMe === 0, "玩家行（me）不带 who（异常 " + badMe + " 条）");
ok(badText === 0, "⛔ 没有空文本段（空 " + badText + " 条）");
// 对白行的 role（立绘解析用）若给出，必须非空
let badRole = 0;
CHS.forEach((c) => (c.lines || []).forEach((l) => { if (l.k === "d" && l.role !== undefined && !String(l.role).trim()) badRole++; }));
ok(badRole === 0, "role 给了就必须非空（异常 " + badRole + " 条）");

/* ---------- (2) 正文区禁词 = 0 ---------- */
section("2 · 正文区禁词 = 0（您 / 它 / 手串名 / 物化词 / 裸 ASCII 双引号）");
const TEXT = CHS.map((c) => (c.lines || []).map((l) => String(l.t || "")).join("\n")).join("\n");
const BAN_HONOR = ["您"];
const BAN_IT = ["它"];
const BAN_OBJECT = ["装睡", "盘", "玩意", "摆件", "玩物", "物件"];   // ⛔ 东西/东西 属正常用词，不在禁列
const BEAD_NAMES = ["莫高窟", "花间酒", "芭蕉叶", "烟雨墨", "柿柿如意", "黄金算盘", "咸法酪", "绿叶",
  "柿宝", "金算盘", "冰红茶", "粉黛熊", "多多牛", "春不晚", "油果果", "花猫猫", "阿豹果", "焦糖儿"];
const hits = (w) => TEXT.split(w).length - 1;
BAN_HONOR.forEach((w) => ok(hits(w) === 0, "⛔ 正文无敬称「" + w + "」（实得 " + hits(w) + "）"));
BAN_IT.forEach((w) => ok(hits(w) === 0, "⛔ 正文无物化代词「" + w + "」（实得 " + hits(w) + "）"));
BAN_OBJECT.forEach((w) => ok(hits(w) === 0, "⛔ 正文无物化词「" + w + "」（实得 " + hits(w) + "）"));
BEAD_NAMES.forEach((w) => ok(hits(w) === 0, "⛔ 正文未出现手串名「" + w + "」（实得 " + hits(w) + "）"));
ok(hits('"') === 0, "⛔ 正文无裸 ASCII 双引号（实得 " + hits('"') + "）");
ok(!/〔/.test(TEXT) && !/〕/.test(TEXT), "⛔ 正文无〔〕原文（画面提示已转成场景段）");
// 抓手建议：登记在 notes，⛔ 不进正文
let notesAll = [];
CHS.forEach((c) => { notesAll = notesAll.concat((c.notes || []).map((n) => String(n.type))); });
ok(notesAll.length > 0, "游戏性抓手已登记进 notes（共 " + notesAll.length + " 条）");
ok(!/\[CG候选\]|\[情绪点\]|\[分支点\]/.test(TEXT), "⛔ [CG候选]/[情绪点]/[分支点] 未进正文");

/* ---------- (3) 称呼：第 3–4 章出现「主人」 ---------- */
section("3 · 称呼（正文烤死 · 第 3–4 章出现「主人」）");
const chText = (i) => (CHS[i] && (CHS[i].lines || []).map((l) => String(l.t || "")).join("\n")) || "";
ok(chText(2).indexOf("主人") >= 0, "第 3 章出现「主人」（结契之后一律称主人）");
ok(chText(3).indexOf("主人") >= 0, "第 4 章出现「主人」");
ok(TEXT.indexOf("主人") > 0, "全篇出现「主人」（共 " + (TEXT.split("主人").length - 1) + " 处）");

/* ---------- (4) BG / CG：只读不出图 ---------- */
section("4 · BG 只读已有 key；CG 只登记不出图");
// 收集 BG_CATALOG 里真实存在的 key
const catalogKeys = {};
const reCat = /"(BG-\d+)":\s*\{\s*key:\s*"(BG-\d+)"/g;
let m;
while ((m = reCat.exec(SP))) catalogKeys[m[1]] = true;
const catN = Object.keys(catalogKeys).length;
ok(catN > 0, "能从 spirits.js 抽到 BG_CATALOG（" + catN + " 张）");
CHS.forEach((c, i) => {
  (c.bg || []).forEach((k) => ok(!!catalogKeys[k], "章" + (i + 1) + " 的 BG key「" + k + "」在 BG_CATALOG 里存在"));
});
// ⛔ 篇层代码里绝不出现 ensureBg / 出图调用
const bookBlock = /v180-G：《沁灵纪》「篇」层[\s\S]*?function renderBookReadPage[\s\S]*?\n  \}/.exec(APP);
const bookSrc = bookBlock ? bookBlock[0] : "";
ok(bookSrc.length > 200, "能定位 app.js 的 v180-G 篇层代码块（实长 " + bookSrc.length + "）");
const bookCode = stripComments(bookSrc);          // ⛔ 只扫真代码；注释里的「绝不 ensureBg」是纪律说明，不算调用
ok(bookCode.length > 100, "剥离注释后仍有真代码（实长 " + bookCode.length + "）");
ok(!/ensureBg/.test(bookCode), "⛔ 篇层代码不调 ensureBg（只走 Spirits.bgGet）");
ok(!/generateImage|generateCustom|testImage/.test(bookCode), "⛔ 篇层代码不含任何出图调用");
ok(/bg:\s*Spirits\.bookBgKeys\(BOOK_ID, i\)/.test(APP), "BG 走 Spirits.bookBgKeys（由 sceneBgUrl → Spirits.bgGet 取值）");
ok(/function bookBgUrl[\s\S]*?bgGet\(keys\[i\]\)/.test(SP) && !/ensureBg/.test(/function bookBgUrl[\s\S]*?\n  \}/.exec(SP) ? /function bookBgUrl[\s\S]*?\n  \}/.exec(SP)[0] : ""),
  "⛔ Spirits.bookBgUrl 只读 bgGet，不调 ensureBg");
const CG = (BOOK && Array.isArray(BOOK.cgCandidates)) ? BOOK.cgCandidates : [];
ok(CG.length > 0, "CG 候选已登记（" + CG.length + " 条，⛔ 本批不出图）");

/* ---------- (5) 立绘口径 ---------- */
section("5 · 立绘口径（核心 10 位走 MAINCHAR_ART · ⛔ 未新增键 / 未加错别名）");
const mArt = /var MAINCHAR_ART = \{([\s\S]*?)\n  \};/.exec(APP);
const mAlias = /var MAINCHAR_ART_ALIAS = \{([\s\S]*?)\n  \};/.exec(APP);
ok(!!mArt, "能抽出 MAINCHAR_ART");
const artKeys = mArt ? (mArt[1].match(/"[^"]+"\s*:/g) || []).map((s) => s.replace(/[":\s]/g, "")) : [];
ok(artKeys.length === 9, "⛔ MAINCHAR_ART 仍是 9 个键（本批未新增；实得 " + artKeys.length + "）");
const aliasKeys = mAlias ? (mAlias[1].match(/"[^"]+"\s*:/g) || []).map((s) => s.replace(/[":\s]/g, "")) : [];
ok(aliasKeys.length === 4, "⛔ MAINCHAR_ART_ALIAS 仍是 4 条（未加错别名；实得 " + aliasKeys.length + "）");
ok(/function bookArtOf\(speaker, who\)/.test(APP), "存在 bookArtOf（① MAINCHAR_ART → ② rec.imgCut||rec.imgUrl）");
ok(/r\.imgCut \|\| r\.imgUrl \|\| ""/.test(APP), "无专属立绘键者回落 rec.imgCut || rec.imgUrl（⛔ 不空白）");
ok(/maincharArtOf\(\{ name: nm \}\)/.test(APP), "核心 10 位走 maincharArtOf（MAINCHAR_ART / 别名反查）");
/* 数据侧：每条对白的 role 必须是**身份表里的正式姓名**（立绘反查的单一真源），
   ⛔ 描述性称谓（温声的 / 添柴的那位）只作显示名 who，不参与立绘解析 */
const IDENT = {};
const reId = /\{ name: "([^"]+)", style: "([^"]+)"/g;
let mi;
while ((mi = reId.exec(APP))) IDENT[mi[1]] = mi[2];
ok(Object.keys(IDENT).length >= 16, "抽出身份表 ≥16 行（实得 " + Object.keys(IDENT).length + "）");
const ROLES = {};
CHS.forEach((c) => (c.lines || []).forEach((l) => { if (l.k === "d") ROLES[String(l.role || l.who || "")] = (ROLES[String(l.role || l.who || "")] || 0) + 1; }));
const roleKeys = Object.keys(ROLES);
ok(roleKeys.length > 0, "数据里解析出说话角色（" + roleKeys.length + " 位）");
roleKeys.forEach((r) => ok(!!IDENT[r], "⛔ 对白 role「" + r + "」在身份表里有正式姓名（立绘可反查）"));

/* ---------- (6) 引擎与界面接线 ---------- */
section("6 · 引擎 / 路由 / 入口接线");
["booksAll", "bookOf", "bookProg", "bookLines", "bookChapterState", "bookMark", "bookReset",
  "bookUnreadCount", "bookCgCandidates", "bookBgKeys", "bookBgUrl"].forEach((fn) => {
  ok(new RegExp("function " + fn + "\\(").test(SP), "spirits.js 定义 " + fn + "()");
});
const mExp = /booksAll, bookOf, bookProg/.exec(SP);
ok(!!mExp, "spirits.js 已导出 book* 一组");
["renderBookPage", "renderBookReadPage", "bookEntryHtml", "bookMsgOf", "bookArtOf"].forEach((fn) => {
  ok(new RegExp("function " + fn + "\\(").test(APP), "app.js 定义 " + fn + "()");
});
ok(/h \+= bookEntryHtml\(\);/.test(APP), "#/main 页（renderMainPage）挂了〈结契篇〉入口卡");
ok(/else if \(h === "#\/book"\) renderBookPage\(\);/.test(APP), "路由 #/book → renderBookPage");
ok(/#\/bookread\//.test(APP) && /renderBookReadPage\(Number\(h\.slice\(11\)\)/.test(APP), "路由 #/bookread/<章> → renderBookReadPage");
ok(/if \(h\.indexOf\("#\/bookread\/"\) === 0\) \{ location\.hash = "#\/book"; return; \}/.test(APP), "返回：章内阅读 → 篇目");
ok(/if \(h === "#\/book"\) \{ location\.hash = "#\/main"; return; \}/.test(APP), "返回：篇目 → 主线列表");
ok(/js\/book-jieqi\.js\?v=/.test(HTML), "index.html 挂了 js/book-jieqi.js");
ok(HTML.indexOf("js/book-jieqi.js") < HTML.indexOf("js/spirits.js"), "book-jieqi.js 排在 spirits.js 之前（先挂数据再挂引擎）");
ok(/manual: true/.test(bookSrc) && /immersive: true/.test(bookSrc), "阅读页 = 沉浸 AVG + 手动推进（点一下下一段）");
ok(/onLine: \(m\) => \{[\s\S]{0,160}bookMark\(BOOK_ID, i/.test(bookSrc), "逐段进度回写（onLine → bookMark）");

/* ---------- (7) 进度落 ww_story · 不进 rec · 老 9 章未动 ---------- */
section("7 · 进度落 ww_story.book（⛔ 不进逐串 rec）· 老 9 章并存未动");
ok(/w\.book\[bookId\] = p;/.test(SP) && /writeStory\(w\);/.test(SP), "bookMark 只写 ww_story.book（readStory/writeStory）");
const mMark = /function bookMark\(bookId, chIdx, seg\) \{[\s\S]*?\n  \}/.exec(SP);
const markSrc = mMark ? mMark[0] : "";
ok(markSrc.length > 0, "能抽出 bookMark 全函数");
ok(!/ensureIn|rec\.|load\(\)/.test(markSrc), "⛔ bookMark 不碰逐串 rec（无 ensureIn / rec. / load()）");
ok(/const MAIN_CHAPTERS = \[/.test(SP), "⛔ 老 9 章 MAIN_CHAPTERS 仍在（并存，未删）");
ok(/const MAIN_SCRIPTS = \[CH01/.test(SP), "⛔ 老 9 章 MAIN_SCRIPTS 仍在");
ok(/const MAIN_ACTS = MAIN_CHAPTERS\.map/.test(SP), "⛔ 老 9 章 MAIN_ACTS 仍在");
ok(!/#\/maintalk\/"\)\s*=== 0\) renderMainTalkPage/.test(APP) === false || /#\/maintalk\//.test(APP), "⛔ 老 9 章 #/maintalk 路由仍在");
ok(/h \+= castEntryHtml\(\);/.test(APP), "⛔ 老点戏入口仍在（未被篇入口取代）");

/* ---------- (8) 引擎真跑：vm 沙箱里加载 js/book-jieqi.js + js/spirits.js 实调 book* ---------- */
section("8 · 引擎真跑（vm 沙箱实调 Spirits.book*）");
{
  const H = require("./_harness.js");
  let hc = null, Spirits = null;
  try {
    hc = H.makeContext();
    H.loadFile(hc.ctx, "js/book-jieqi.js");    // 先挂数据（window.BOOK_JIEQI）
    H.loadFile(hc.ctx, "js/spirits.js");       // 再挂引擎
    Spirits = hc.sandbox.Spirits;
  } catch (e) { ok(false, "沙箱加载 book-jieqi.js + spirits.js（" + e.message + "）"); }
  ok(!!Spirits, "沙箱里拿到 Spirits");
  if (Spirits) {
    ["booksAll", "bookOf", "bookProg", "bookLines", "bookChapterState", "bookMark", "bookReset",
      "bookUnreadCount", "bookCgCandidates", "bookBgKeys", "bookBgUrl"].forEach((fn) => {
      ok(typeof Spirits[fn] === "function", "Spirits." + fn + "() 真跑可用");
    });
    const all = Spirits.booksAll();
    ok(all.length === 1, "booksAll() = 1 篇（实得 " + all.length + "）");
    ok(all[0] && all[0].id === "jieqi", "篇 id = jieqi（实得 " + (all[0] && all[0].id) + "）");
    ok(all[0] && String(all[0].name).indexOf("结契") >= 0, "篇名含「结契」（实得 " + (all[0] && all[0].name) + "）");

    const b = Spirits.bookOf("jieqi");
    ok(!!b && b.chapters.length === 4, "bookOf('jieqi') = 4 章（实得 " + ((b && b.chapters) || []).length + "）");
    ok(Spirits.bookOf("nope") === null, "bookOf(未知 id) = null");

    const L0 = Spirits.bookLines("jieqi", 0);
    ok(L0.length > 0, "bookLines(0) 拿到段（" + L0.length + " 段）");
    ok(L0.length === ((b && b.chapters[0].lines) || []).length, "bookLines 与数据文件段数一致");

    /* 链式解锁：初始只有章 1 解锁 */
    Spirits.bookReset("jieqi", 0); Spirits.bookReset("jieqi", 1);
    Spirits.bookReset("jieqi", 2); Spirits.bookReset("jieqi", 3);
    let st = Spirits.bookChapterState("jieqi");
    ok(st.length === 4, "bookChapterState = 4 章状态");
    ok(st[0].unlocked === true && st[1].unlocked === false, "⛔ 链式解锁：章 1 开、章 2 锁（实得 " + st[0].unlocked + "/" + st[1].unlocked + "）");
    ok(st[3].unlocked === false, "章 4 仍锁（先看前章）");
    ok(Spirits.bookUnreadCount("jieqi") === 1, "初始未读 = 1（实得 " + Spirits.bookUnreadCount("jieqi") + "）");

    /* 读到一半：done=false，进度记段号 */
    Spirits.bookMark("jieqi", 0, 5);
    st = Spirits.bookChapterState("jieqi");
    ok(st[0].seg === 5, "读到第 5 段 → seg=5（实得 " + st[0].seg + "）");
    ok(st[0].done === false, "读一半 → done=false");
    ok(st[0].read === true, "读一半 → read=true（回看有痕）");

    /* 读完整章：done=true ⇒ 解锁下一章 */
    const total0 = st[0].total;
    Spirits.bookMark("jieqi", 0, total0 + 99);   // 越界也应被夹到 total
    st = Spirits.bookChapterState("jieqi");
    ok(st[0].done === true, "读完章 1 → done=true");
    ok(st[0].seg === total0, "⛔ 段号夹在总数内（实得 " + st[0].seg + "/" + total0 + "）");
    ok(st[1].unlocked === true, "读完章 1 → 章 2 解锁（链式）");
    // 未读 = 「已解锁且未读完」的章数：章 1 读完 + 章 2 刚解锁 ⇒ 仍是 1（章 3/4 还锁着，不算未读）
    ok(Spirits.bookUnreadCount("jieqi") === 1, "读完章 1 后未读 = 1（章 2 解锁；实得 " + Spirits.bookUnreadCount("jieqi") + "）");
    Spirits.bookMark("jieqi", 1, Spirits.bookChapterState("jieqi")[1].total);
    st = Spirits.bookChapterState("jieqi");
    ok(st[2].unlocked === true && st[3].unlocked === false, "读完章 2 → 章 3 解锁、章 4 仍锁");
    ok(Spirits.bookUnreadCount("jieqi") === 1, "链式推进下未读恒为 1（实得 " + Spirits.bookUnreadCount("jieqi") + "）");
    Spirits.bookReset("jieqi", 1);   // 复位章 2，回到「只读完章 1」的状态

    /* 进度落盘：只读 ww_story，⛔ 不进 ww_spirits */
    const rawStory = hc.store.getItem("ww_story") || "";
    ok(rawStory.indexOf('"book"') >= 0, "⛔ 进度已落 ww_story（含 book 字段）");
    let storyObj = null;
    try { storyObj = JSON.parse(rawStory); } catch (e) { /* 断言里报 */ }
    ok(!!storyObj && storyObj.book && storyObj.book.jieqi, "ww_story.book.jieqi 存在");
    ok(storyObj && storyObj.book && storyObj.book.jieqi.chapters[0].done === true, "落盘 chapters[0].done=true");
    ok(!hc.store.getItem("ww_spirits"), "⛔ 篇层进度未写进 ww_spirits（实得 " + String(hc.store.getItem("ww_spirits")) + "）");

    /* CG / BG：登记与只读 */
    const cg = Spirits.bookCgCandidates("jieqi");
    ok(cg.length === 4, "bookCgCandidates = 4 条（⛔ 只登记，不出图；实得 " + cg.length + "）");
    const keys = Spirits.bookBgKeys("jieqi", 0);
    ok(keys.length > 0 && keys.every((k) => !!catalogKeys[k]), "bookBgKeys 全在 BG_CATALOG（" + keys.join(",") + "）");
    const u = Spirits.bookBgUrl("jieqi", 0);
    ok(typeof u === "string", "bookBgUrl 返回字符串（实得 " + JSON.stringify(u).slice(0, 40) + "）");
    ok(u === "" || /^(https?:|data:|assets\/|\.\/|\/)/.test(u), "⛔ bookBgUrl 不出图：无图时返回空串（实得 " + JSON.stringify(u).slice(0, 24) + "）");

    /* 复位 */
    Spirits.bookReset("jieqi", 0);
    st = Spirits.bookChapterState("jieqi");
    ok(st[0].seg === 0 && st[0].done === false, "bookReset → seg=0 / done=false");
  }
}

/* ---------- (9) 界面真跑：入口卡 + 篇目页 真渲染出 HTML（玩家真能看见） ---------- */
section("9 · 界面真跑（入口卡 / 篇目页 真出 HTML）");
{
  const H = require("./_harness.js");
  const vm2 = require("vm");
  /* 抽函数（大括号配对，跳字符串/注释 —— 与 _test_v172b_page.js 同口径） */
  function extractFn(name) {
    const re = new RegExp("function\\s+" + name + "\\s*\\(");
    const m = re.exec(APP);
    if (!m) throw new Error("找不到函数 " + name);
    let i = APP.indexOf("(", m.index), pd = 0;
    for (; i < APP.length; i++) {
      if (APP[i] === "(") pd++;
      else if (APP[i] === ")") { pd--; if (pd === 0) { i++; break; } }
    }
    while (i < APP.length && APP[i] !== "{") i++;
    let depth = 0;
    for (; i < APP.length; i++) {
      const ch = APP[i];
      if (ch === "'" || ch === '"' || ch === "`") { const q = ch; i++; while (i < APP.length) { if (APP[i] === "\\") { i += 2; continue; } if (APP[i] === q) break; i++; } continue; }
      if (ch === "/" && APP[i + 1] === "/") { while (i < APP.length && APP[i] !== "\n") i++; continue; }
      if (ch === "/" && APP[i + 1] === "*") { const e = APP.indexOf("*/", i); i = e < 0 ? APP.length : e + 1; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    return APP.slice(m.index, i);
  }
  let hc2 = null, sb = null, ctx2 = null, boot = true;
  try {
    hc2 = H.makeContext();
    H.loadFile(hc2.ctx, "js/book-jieqi.js");
    H.loadFile(hc2.ctx, "js/spirits.js");
  } catch (e) { boot = false; ok(false, "界面真跑：沙箱加载失败（" + e.message + "）"); }
  if (boot) {
    const viewNode = { innerHTML: "", style: {}, querySelectorAll: () => [] };
    sb = {
      console: console, Math: Math, JSON: JSON, Date: Date, String: String, Number: Number, Object: Object, Array: Array,
      Spirits: hc2.sandbox.Spirits,
      BOOK_ID: (/const BOOK_ID = "([^"]+)"/.exec(APP) || [, "jieqi"])[1],
      esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      view: viewNode,
      topbarTitle: { textContent: "" },
      btnBack: { style: {} }, btnSettings: { style: {} },
      location: { hash: "" },
      document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), querySelector: () => null, querySelectorAll: () => [] },
      scrollTo() {},
    };
    sb.window = sb; sb.self = sb;
    ctx2 = vm2.createContext(sb);
    try {
      vm2.runInContext(extractFn("bookEntryHtml") + "\n" + extractFn("renderBookPage") + "\n", ctx2, { filename: "v180g-ui" });
    } catch (e) { ok(false, "界面真跑：抽函数脚本执行失败（" + e.message + "）"); boot = false; }
    if (boot) {
      /* ① #/main 入口卡 */
      const h1 = String(ctx2.bookEntryHtml() || "");
      ok(h1.indexOf('data-goto="#/book"') >= 0, "入口卡 data-goto=#/book（玩家点它进篇）");
      ok(h1.indexOf("结契") >= 0, "入口卡显示篇名（含「结契」）");
      ok(h1.indexOf("已看完 0/4") >= 0, "入口卡副行「已看完 0/4」（实得片段：" + (h1.match(/已看完[^<]*/) || [""])[0] + "）");
      ok(h1.indexOf("章新") >= 0, "入口卡有「N 章新」角标");

      /* ② #/book 篇目页 */
      ctx2.renderBookPage();
      const h2 = String(viewNode.innerHTML || "");
      ok(h2.length > 200, "篇目页真的渲染出 HTML（" + h2.length + " 字符）");
      ok(h2.indexOf("chap-list") >= 0, "篇目页有 .chap-list");
      CHS.forEach((c, i) => ok(h2.indexOf(c.title) >= 0, "章" + (i + 1) + "「" + c.title + "」出现在篇目页"));
      ok((h2.match(/chap-item locked/g) || []).length === 3, "⛔ 篇目页：章 1 开、章 2–4 锁（实得锁 " + (h2.match(/chap-item locked/g) || []).length + " 个）");
      ok(h2.indexOf('data-ch="0"') >= 0, "章 1 是 data-ch=0（点它进 #/bookread/0）");
      ok(h2.indexOf("CG 候选") >= 0, "篇目页列出 CG 候选（⛔ 只登记不出图）");
      ok(h2.indexOf("〔") < 0 && h2.indexOf("〕") < 0, "⛔ 篇目页不出现〔〕原文");
      ok(h2.indexOf('src="http') < 0 && !/\.(png|jpg|webp)"/.test(h2), "⛔ 篇目页不含任何出图链接（本批不出图）");
      ok(sb.topbarTitle.textContent.indexOf("📖") >= 0, "顶栏标题已设为篇名（实得 " + sb.topbarTitle.textContent + "）");
    }
  }
}

console.log("------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((m2) => console.log("  - " + m2)); }
console.log(FAIL > 0 ? "⇒ 红测：V180-G 未落地" : "⇒ 全绿：V180-G 〈结契篇〉已可在游戏里读到");
process.exit(FAIL > 0 ? 1 : 0);
