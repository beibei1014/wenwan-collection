/* v165-N3 自测：《沁灵纪》主线**独立入口**改造
 *
 * 用户裁定原话：「以前的主线剧情，就是从每个沁灵的详情页进入那个，取消。全面用新的剧情来取代，走独立的入口。」
 *
 * 本测试钉住三件事：
 *   ① 旧 8 章的**入口**已取消（沁灵详情页里那条「📖 主线 · 串与我」+ #/talk 跳转）
 *   ② 旧 8 章的**数据**原样保留（CHAP_SCRIPTS / CHAPTERS / chapterState / chapTalk* 一个没删）
 *   ③ 新 9 章走**独立入口**（首页 #mainEntry → #/main → #/maintalk/<i>），
 *      元数据 MAIN_CHAPTERS 9 条、天数锚点取自剧本 §4、状态全在 ww_story（⛔ 不进 rec）
 *
 * 用法：node docs/_test_v165n3_mainentry.js
 */
"use strict";
const H = require("./_harness.js");
const fs = require("fs"), path = require("path");
const { ok, section, summary, makeContext, loadFile } = H;
const ROOT = path.join(__dirname, "..");

const { S } = (function () {
  const c = makeContext();
  loadFile(c.ctx, "js/spirits.js");
  return { S: c.sandbox.Spirits };
})();
const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const spSrc = fs.readFileSync(path.join(ROOT, "js/spirits.js"), "utf8");

(async function main() {
  /* ============ ① 旧入口已取消 ============ */
  section("① 沁灵详情页里进入旧 8 章的入口 —— 已取消");
  ok(appSrc.indexOf("📖 主线 · 串与我") < 0, "详情页不再渲染「📖 主线 · 串与我」卡片");
  ok(appSrc.indexOf('location.hash = "#/talk/"') < 0, "详情页不再有 #/talk 跳转（.chap-item[data-chap] 绑定已删）");
  ok(appSrc.indexOf(".chap-item[data-chap]") < 0, "旧章节列表的点击绑定已删");
  ok(appSrc.indexOf("const chapList = Spirits.chapterState") < 0, "详情页不再为旧 8 章算 chapterState 列表");
  // 路由也一并收口：旧 #/talk/ 直接回沁灵页（不是崩，也不是继续跑旧章）
  ok(/h\.indexOf\("#\/talk\/"\) === 0\)[\s\S]{0,200}location\.hash = "#\/spirit\//.test(appSrc),
    "#/talk/ 路由已改为直接回沁灵页");

  /* ============ ② 旧数据原样保留 ============ */
  section("② 旧 8 章数据与引擎 —— 一个没删");
  ok(spSrc.indexOf("const CHAP_SCRIPTS = [") >= 0, "CHAP_SCRIPTS 仍在（旧 8 章正文）");
  ok(spSrc.indexOf("const CHAPTERS = [") >= 0, "CHAPTERS 仍在（旧 8 章元数据）");
  ["chapterState", "readChapter", "unreadChapterCount", "chapActOf",
    "chapTalkEnter", "chapTalkChoose", "chapTalkReplay", "chapTalkBrief", "chapTalkDone"]
    .forEach((f) => ok(typeof S[f] === "function", "旧方法仍导出：" + f));
  ok(Array.isArray(S.CHAP_ACTS) && S.CHAP_ACTS.length === 8, "CHAP_ACTS 仍是 8 条（实测 " + (S.CHAP_ACTS || []).length + "）");
  ok(S.CHAPTERS.length === 8, "CHAPTERS 仍是 8 条（⛔ 没被 8→9 加长）");
  ok(appSrc.indexOf("function renderChapTalkPage") >= 0, "renderChapTalkPage 函数保留（只是没有入口了）");
  // 旧 8 章行为零变化：chapWalk 仍走 chapActOf（新增的 actOf 是可选第 4 参）
  ok(spSrc.indexOf("const act = (actOf || chapActOf)(t.chapId)") >= 0, "chapWalk 不传 actOf 时仍走 chapActOf");
  ok(spSrc.indexOf("const act = (actOf || chapActOf)(t && t.chapId)") >= 0, "chapTalkChoose 同上");
  {
    const item = { id: "it_x", name: "旧章串", category: "菩提", species: "星月", color: "浅花", playCount: 9, softness: "slight" };
    const rec = {};
    const r = S.chapTalkEnter(item, rec, { dayNo: 30 }, 0);
    ok(r && Array.isArray(r.added) && r.added.length > 0, "旧 8 章仍能正常进章（run 一遍证明没被改坏）");
  }

  /* ============ ③ 新 9 章独立入口 ============ */
  section("③ 新 9 章独立入口（首页 → #/main → #/maintalk/<i>）");
  ok(Array.isArray(S.MAIN_CHAPTERS) && S.MAIN_CHAPTERS.length === 9, "MAIN_CHAPTERS = 9 条（实测 " + (S.MAIN_CHAPTERS || []).length + "）");
  const days = (S.MAIN_CHAPTERS || []).map((c) => c.day);
  ok(JSON.stringify(days) === JSON.stringify([1, 7, 20, 45, 62, 78, 95, 108, 120]),
    "天数锚点取自剧本 §4 章首（实测 " + JSON.stringify(days) + "）");
  ok(JSON.stringify(S.MAIN_DAY_ANCHOR) === JSON.stringify([20, 45, 62, 78, 95, 108, 120]),
    "MAIN_DAY_ANCHOR（ch3–ch9）未被改动");
  ok((S.MAIN_CHAPTERS || []).every((c) => c.title && c.icon), "9 章都有标题与图标");
  ok(Array.isArray(S.MAIN_ACTS) && S.MAIN_ACTS.length === 9, "MAIN_ACTS = 9 条");
  ok((S.MAIN_ACTS || []).every((a, i) => a.id === "m" + (i + 1)), "MAIN_ACTS 的 id 是 m1..m9（与旧 c1..c8 不冲突）");
  ok(typeof S.MAIN_STORY_OPEN === "boolean", "MAIN_STORY_OPEN 是集中配置常量（铁律：不散落硬编码）");
  ok(spSrc.indexOf("const MAIN_STORY_OPEN = false;") >= 0, "正文装帧开关当前为 false（N2 装完 9 章正文后翻 true）");
  typeof S.mainActOf === "function" ? ok(true, "mainActOf 已导出") : ok(false, "mainActOf 未导出");
  ["mainChapterState", "mainUnreadCount", "mainReadChapter", "mainTalkEnter", "mainTalkChoose", "mainTalkReplay", "mainTalkBrief"]
    .forEach((f) => ok(typeof S[f] === "function", "新方法已导出：" + f));

  section("③-b 列表状态：⛔ 与旧 8 章完全隔离，状态不进 rec");
  {
    const st = S.mainChapterState({ dayNo: 999 });
    ok(st.length === 9, "mainChapterState 返回 9 条");
    ok(st.every((c) => !c.unlocked), "正文未装帧时全部 locked（不会出现能点进去却是空页）");
    ok(st.every((c) => String(c.need).indexOf("装帧") >= 0), "locked 原因写明「正文还没装帧」");
    ok(S.mainUnreadCount({ dayNo: 999 }) === 0, "未装帧时未读数为 0");
  }
  {
    // 状态全在 ww_story：mainReadChapter 只写 ww_story，绝不写 rec
    const before = S.readStory();
    ok(!before.mainChapters, "初始：ww_story 里没有 mainChapters");
    S.mainReadChapter(0);
    const after = S.readStory();
    ok(!!(after.mainChapters && after.mainChapters[0] && after.mainChapters[0].at), "mainReadChapter 写进 ww_story.mainChapters");
    ok(S.mainChapterState({ dayNo: 999 })[0].read === true, "已读状态能被列表读到");
  }
  section("③-c 正文为空时绝不崩（N2 装帧前的防御）");
  {
    let threw = false, r = null;
    try { r = S.mainTalkEnter({ dayNo: 999 }, 0); } catch (e) { threw = true; }
    ok(!threw, "mainTalkEnter 在正文为空时不抛错");
    ok(r && r.ended === true && Array.isArray(r.added) && r.added.length === 0, "空正文 ⇒ 直接 ended，不产出空消息");
    let threw2 = false;
    try { S.mainTalkChoose({ dayNo: 999 }, 0); S.mainTalkReplay({ dayNo: 999 }, 0); S.mainTalkBrief(); } catch (e) { threw2 = true; }
    ok(!threw2, "mainTalkChoose / Replay / Brief 同样不抛错");
  }

  section("③-d 入口位置：首页大卡片，⛔ 不在某一只的详情页");
  ok(appSrc.indexOf('id="mainEntry"') >= 0, "首页有 #mainEntry 入口卡片");
  ok(appSrc.indexOf('location.hash = "#/main"') >= 0, "入口跳 #/main");
  ok(appSrc.indexOf('h === "#/main") renderMainPage()') >= 0, "路由 #/main → renderMainPage");
  ok(appSrc.indexOf("#/maintalk/") >= 0 && appSrc.indexOf("function renderMainTalkPage") >= 0, "路由 #/maintalk/<i> → renderMainTalkPage");
  ok(appSrc.indexOf('data-main="') >= 0, "章节列表项用 data-main 承载章号");
  {
    const iEntry = appSrc.indexOf('id="mainEntry"');
    const iHome = appSrc.indexOf("function renderHome");
    const iDetail = appSrc.indexOf("function renderSpiritDetailPage");
    ok(iEntry > iHome, "入口卡片在 renderHome 里（不在详情页 —— 详情页函数在它之前）");
    ok(iDetail < iHome, "前提：renderSpiritDetailPage 在 renderHome 之前（位置断言有效）");
  }
  ok(appSrc.indexOf("main-entry") >= 0 && fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8").indexOf(".main-entry {") >= 0,
    "入口卡片有配套样式（不是藏在二级菜单里的小链接）");
  ok(appSrc.indexOf("o.av(m.slot || m.w, m)") >= 0, "对话页头像支持群像站位 m.slot（旧剧本无 slot ⇒ 回落 m.w，零变化）");

  const passed = summary();
  process.exit(passed ? 0 : 1);
})();
