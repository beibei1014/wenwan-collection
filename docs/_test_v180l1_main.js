/* ============================================================
 * _test_v180l1_main.js · V180 批L-1 · 老主线《沁灵纪》1–9 章整条下线
 * ------------------------------------------------------------
 *   用户裁定：「我要你删的是以前老版本的主线」——即界面上那套旧主线
 *   （MAIN_CHAPTERS / MAIN_SCRIPTS CH01..CH09 + #/main · #/maintalk · #/maincast）。
 *   ⛔ 新〈结契篇〉（js/book-jieqi.js + #/book、#/bookread）一个字不动 —— 它是新版主线。
 *
 *   A. 引擎侧（spirits.js）：老主线常量 / 运行时不复存在，且不再导出
 *   B. 红线保留：CHAPTERS 元数据 + chap* 共享引擎 + mainSetOf/setMainStory（#/mainstory）+ book*
 *   C. 界面侧（app.js）：三条老路由 / render* / 入口卡全删；〈结契篇〉入口改挂首页
 *   D. 共享立绘 MAINCHAR_ART 保留（⛔ 别跟着老主线一起删 —— 〈结契篇〉仍在用）
 *   E. mainPurgeOld：一次性幂等清理（真跑）＋ ⛔ 不碰 ww_story.book / 三关 / FORK_STANCE
 *   F. 负向对照：铆定 9747745（批 L 改前 commit）的 app.js / spirits.js（⛔ 不用 git show HEAD）
 *
 * 用法：
 *   node docs/_test_v180l1_main.js                 # 跑当前源码（应全绿）
 *   node docs/_test_v180l1_main.js --neg           # 负向对照（应红 —— 证明断言真覆盖本批删除）
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const H = require("./_harness.js");
const { makeContext, loadFile, ok, section, summary } = H;
const ROOT = path.join(__dirname, "..");

const NEG = process.argv.includes("--neg") || process.argv.includes("--baseline");
const APP_LIVE = path.join(ROOT, "js", "app.js");
const SP_LIVE = path.join(ROOT, "js", "spirits.js");
const APP_PRE = path.join(__dirname, "_tmp", "_pre_v180l1_app.js");
const SP_PRE = path.join(__dirname, "_tmp", "_pre_v180l1_spirits.js");

if (NEG && (!fs.existsSync(APP_PRE) || !fs.existsSync(SP_PRE))) {
  console.error("负向对照快照缺失：请先执行");
  console.error("  git show 9747745:js/app.js     > docs/_tmp/_pre_v180l1_app.js");
  console.error("  git show 9747745:js/spirits.js > docs/_tmp/_pre_v180l1_spirits.js");
  process.exit(3);
}
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const appSrc = read(NEG ? APP_PRE : APP_LIVE);
const spSrc = read(NEG ? SP_PRE : SP_LIVE);

const S = (function () {
  const c = makeContext();
  loadFile(c.ctx, NEG ? "docs/_tmp/_pre_v180l1_spirits.js" : "js/spirits.js");
  return c.sandbox.Spirits;
})();

console.log("源码：" + (NEG ? "负向对照（9747745）" : "当前工作区"));

/* ================= A. 引擎侧：老主线已删 ================= */
section("A · 引擎侧：老主线常量 / 运行时已删除且不再导出");
[
  ["const MAIN_DAY_ANCHOR =", "MAIN_DAY_ANCHOR 常量"],
  ["const MAIN_STORY_OPEN =", "MAIN_STORY_OPEN 装帧开关"],
  ["const MAIN_CHAPTERS = [", "MAIN_CHAPTERS 元数据"],
  ["const MAIN_SCRIPTS = [CH01", "MAIN_SCRIPTS 正文表"],
  ["const MAIN_ACTS = MAIN_CHAPTERS.map", "MAIN_ACTS 派生表"],
  ["const MAIN_STUB_ITEM =", "MAIN_STUB_ITEM 桩物件"],
  ["function mainActOf(", "mainActOf()"],
  ["function mainChapterState(", "mainChapterState()"],
  ["function mainUnreadCount(", "mainUnreadCount()"],
  ["function mainReadChapter(", "mainReadChapter()"],
  ["function mainReadMap(", "mainReadMap()"],
  ["function mainTalkEnter(", "mainTalkEnter()"],
  ["function mainTalkChoose(", "mainTalkChoose()"],
  ["function mainTalkReplay(", "mainTalkReplay()"],
  ["function mainTalkBrief(", "mainTalkBrief()"],
].forEach(([needle, label]) => ok(spSrc.indexOf(needle) < 0, "spirits.js 已删除 " + label));

[
  "MAIN_DAY_ANCHOR", "MAIN_STORY_OPEN", "MAIN_CHAPTERS", "MAIN_SCRIPTS", "MAIN_ACTS", "MAIN_STUB_ITEM",
  "mainActOf", "mainChapterState", "mainUnreadCount", "mainReadChapter", "mainReadMap",
  "mainTalkEnter", "mainTalkChoose", "mainTalkReplay", "mainTalkBrief",
].forEach((k) => ok(typeof S[k] === "undefined", "Spirits." + k + " 不再导出"));

/* ================= B. 红线保留 ================= */
section("B · 红线保留：CHAPTERS + chap* 共享引擎 + mainSetOf/setMainStory + book*");
ok(Array.isArray(S.CHAPTERS) && S.CHAPTERS.length === 8, "CHAPTERS 元数据仍 8 章（readChapter 复用，实得 " + (S.CHAPTERS || []).length + "）");
["chapterState", "readChapter", "unreadChapterCount",
  "chapWalk", "chapTalkEnter", "chapTalkChoose", "chapTalkReplay", "chapTalkBrief", "chapTalkDone",
  "chapApplyRset", "chapApplyGset", "chapApplySets", "chapRecomputeFork",
  "chapTaSet", "chapTaGet", "chapTaNameOf", "chapAtOf", "chapBgOf",
].forEach((f) => ok(typeof S[f] === "function", "共享引擎 / 元数据仍导出：" + f));
["storyMainId", "mainSetOf", "setMainStory", "readStory", "writeStory", "setMainItems"]
  .forEach((f) => ok(typeof S[f] === "function", "#/mainstory 主串选择仍在：" + f));
["booksAll", "bookOf", "bookChapterState", "bookLines", "bookMark", "bookReset", "bookBgKeys", "bookUnreadCount"]
  .forEach((f) => ok(typeof S[f] === "function", "〈结契篇〉book* 仍在：" + f));

/* ================= C. 界面侧：老主线 UI 已下线 ================= */
section("C · 界面侧：三条老路由 / render* / 入口卡全删；〈结契篇〉改挂首页");
["function renderMainPage(", "function renderMainTalkPage(", "function renderMainCastPage(",
  "function mainStoryCtx(", "function mainCastThumb(", "function castEntryHtml(", "function openCastSheet(",
].forEach((n) => ok(appSrc.indexOf(n) < 0, "app.js 已删除 " + n.slice(9, -1)));
ok(appSrc.indexOf('h === "#/main") renderMainPage()') < 0, "路由 #/main → renderMainPage 已删");
ok(appSrc.indexOf('h === "#/maincast"') < 0, "路由 #/maincast 已删");
ok(appSrc.indexOf('h.indexOf("#/maintalk/") === 0') < 0, "路由 #/maintalk/<i> 已删");
ok(appSrc.indexOf('id="mainEntry"') < 0, "首页旧 #mainEntry 卡片已删");
ok(appSrc.indexOf('id="spMainBtn"') < 0, "旧 #spMainBtn 入口已删");
ok(appSrc.indexOf('location.hash = "#/main"') < 0, "全库无任何跳 #/main 的入口");
ok(/if \(typeof bookEntryHtml === "function"\) html \+= bookEntryHtml\(\);/.test(appSrc),
  "★ 〈结契篇〉入口卡改挂**首页**（renderHome）");
ok(appSrc.indexOf('msBtn.onclick = () => { location.hash = "#/book"; }') >= 0,
  "沁灵页主线卡指向 #/book");
ok(/if \(!bk\) \{ location.hash = "#\/"; return; \}/.test(appSrc), "结契篇数据缺失回落首页（⛔ 不白屏）");
ok(appSrc.indexOf('h === "#/mainstory"') >= 0, "⛔ #/mainstory 未动（主串集合制选择保留）");
ok(/Spirits\.mainPurgeOld/.test(appSrc), "app 启动时调用 Spirits.mainPurgeOld()（一次性清理）");

/* ================= D. 共享立绘 MAINCHAR_ART 保留 ================= */
section("D · 共享立绘 MAINCHAR_ART 保留（⛔ 没跟着老主线一起删）");
const artBlock = /var MAINCHAR_ART = \{([\s\S]*?)\};/.exec(appSrc);
const artKeys = artBlock ? (artBlock[1].match(/"[^"]+":\s*\{ f:/g) || []).length : 0;
ok(!!artBlock, "app.js 仍有 var MAINCHAR_ART = {");
ok(artKeys === 9, "MAINCHAR_ART 恰 9 键（实得 " + artKeys + "）");
const aliasBlock = /var MAINCHAR_ART_ALIAS = \{([\s\S]*?)\};/.exec(appSrc);
const aliasKeys = aliasBlock ? (aliasBlock[1].match(/"[^"]+":/g) || []).length : 0;
ok(aliasKeys === 4, "MAINCHAR_ART_ALIAS 4 别名（实得 " + aliasKeys + "）");
ok(appSrc.indexOf("function maincharArtOf(") >= 0, "maincharArtOf() 保留");
ok(/portrait: \(m\) => artOf\(m\)\.src/.test(appSrc), "〈结契篇〉renderBookReadPage 仍走 artOf（消费 MAINCHAR_ART）");

/* ================= E. mainPurgeOld：一次性幂等清理 ================= */
section("E · mainPurgeOld：一次性幂等清理（真跑）＋ ⛔ 不碰 book / 三关 / FORK_STANCE");
ok(typeof S.mainPurgeOld === "function", "Spirits.mainPurgeOld 导出");
ok(JSON.stringify(S.MAIN_OLD_STORY_KEYS) ===
   JSON.stringify(["STANCE_CH1", "CH2_FAVOR", "CH4_LOOKED", "STANCE_CH5", "STANCE_CH6", "STANCE_CH9"]),
  "MAIN_OLD_STORY_KEYS = 6 个老主线专属 ww_story 键（实得 " + JSON.stringify(S.MAIN_OLD_STORY_KEYS) + "）");
ok(JSON.stringify(S.MAIN_OLD_REC_KEYS) === JSON.stringify(["starMark"]),
  "MAIN_OLD_REC_KEYS = ['starMark']（实得 " + JSON.stringify(S.MAIN_OLD_REC_KEYS) + "）");
{
  const c = makeContext();
  loadFile(c.ctx, NEG ? "docs/_tmp/_pre_v180l1_spirits.js" : "js/spirits.js");
  const Sp = c.sandbox.Spirits;
  if (typeof Sp.mainPurgeOld !== "function") {
    ok(false, "负向对照：改前 spirits.js 没有 mainPurgeOld()");
  } else {
    c.store.setItem("ww_story", JSON.stringify({
      STANCE_CH1: true, CH2_FAVOR: "gentle", CH4_LOOKED: "lively",
      STANCE_CH5: "x", STANCE_CH6: "y", STANCE_CH9: "ACCEPT",
      FORK_STANCE: "MIXED", KEY_CHOICES: 2,
      book: { jieqi: { 0: { seg: 3 } } }, castManual: { sweet: { id: "s1" } },
    }));
    c.store.setItem("ww_spirits", JSON.stringify({
      s1: { starMark: true, flags: { stance: "DECIDE" }, marks: { a: 1 }, cgs: { x: 1 }, mainIds: ["m1"], bond: 30 },
    }));
    const dirty = Sp.mainPurgeOld();
    ok(dirty === true, "首次调用返回 true（确有脏数据）");
    const w = JSON.parse(c.store.getItem("ww_story") || "{}");
    ["STANCE_CH1", "CH2_FAVOR", "CH4_LOOKED", "STANCE_CH5", "STANCE_CH6", "STANCE_CH9"].forEach((k) =>
      ok(!Object.prototype.hasOwnProperty.call(w, k), "ww_story." + k + " 已清"));
    ok(w.FORK_STANCE === "MIXED", "⛔ FORK_STANCE 未被清（结局逻辑仍用）");
    ok(w.KEY_CHOICES === 2, "⛔ KEY_CHOICES 未被清");
    ok(!!(w.book && w.book.jieqi), "⛔ ww_story.book 未被清（〈结契篇〉进度）");
    ok(!!w.castManual, "⛔ castManual 未被清（选角数据）");
    const st = JSON.parse(c.store.getItem("ww_spirits") || "{}");
    ok(st.s1 && st.s1.starMark === undefined, "rec.starMark 已清");
    ok(st.s1 && st.s1.flags && st.s1.flags.stance === "DECIDE", "⛔ rec.flags.stance 未被清");
    ok(st.s1 && st.s1.marks && st.s1.marks.a === 1, "⛔ 三关 rec.marks 未被裁");
    ok(st.s1 && st.s1.cgs && st.s1.cgs.x === 1, "⛔ 三关 rec.cgs 未被裁");
    ok(st.s1 && Array.isArray(st.s1.mainIds) && st.s1.mainIds[0] === "m1", "⛔ 三关 rec.mainIds 未被裁");
    ok(st.s1 && st.s1.bond === 30, "⛔ 其它 rec 字段原样保留");
    ok(Sp.mainPurgeOld() === false, "第二次调用返回 false（幂等，无副作用）");
  }
}

/* ================= F. 负向对照说明 ================= */
section("F · 负向对照");
if (NEG) {
  ok(false, "负向对照已启动：以上「已下线 / 不再导出」断言必须大面积 FAIL（跑 --neg 时红 = 覆盖到位）");
} else {
  ok(fs.existsSync(APP_PRE) && fs.existsSync(SP_PRE), "负向对照快照就位（docs/_tmp/_pre_v180l1_*.js）");
}

const passed = summary();
console.log("模式：" + (NEG ? "负向对照（期望红）" : "当前工作区（期望全绿）"));
if (NEG) process.exit(passed ? 0 : 1);
process.exit(passed ? 0 : 1);
