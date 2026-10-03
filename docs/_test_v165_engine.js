/* 批次 3A · 引擎接线自测（v165）
 * 覆盖（对应 docs/v165-第1-9章-剧本.md §0.2 / §2 与主理人施工图 P0）：
 *   P0-1 行级 who 覆盖 v.name（缺省回落，单串行为不变）
 *   P0-2 选项 flag 载体：rset→rec.flags / gset→ww_story / FORK_STANCE tally / fb 反馈行
 *   P0-3 章末 end:true ⇒ 判 ended + 补 readChapter
 *   P0-4 {ta} 取 rset 键的行当名，无 rset 回落「那只」（⛔ 绝不写「它」）
 *   负向对照：基线取 git show e0d6b06:js/spirits.js，本文件必须 FAIL（证明断言真覆盖到本批改动）
 * 用法： node docs/_test_v165_engine.js [--baseline]
 *   --baseline 用 e0d6b06 的 spirits.js 跑（预期 FAIL）
 * 退出码 0 = 全通过；非 0 = 有断言失败。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { makeContext, ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const BASELINE = process.argv.includes("--baseline");

/* 负向对照：基线取 git show e0d6b06:js/spirits.js
 *   预先用 `git show e0d6b06:js/spirits.js > docs/_baseline_spirits.js` 落盘，
 *   本文件直接读盘（⛔ 不在测试里 spawn git，避免沙箱 EBUSY）。基线文件缺失则跳过对照。 */
const BASELINE_FILE = path.join(__dirname, "_baseline_spirits.js");

function loadSpirits(h) {
  if (!BASELINE) { require("./_harness.js").loadFile(h.ctx, "js/spirits.js"); return; }
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error("基线文件缺失：请先执行  git show e0d6b06:js/spirits.js > docs/_baseline_spirits.js");
    process.exit(3);
  }
  require("./_harness.js").loadFile(h.ctx, "docs/_baseline_spirits.js");
}

const h = makeContext();
loadSpirits(h);
const S = h.sandbox.Spirits;
if (!S) { console.error("Spirits 未加载"); process.exit(2); }

const ITEM = { name: "小叶紫檀", color: "紫", species: "木", category: "木" };
const CTX = { dayNo: 20, plays: 30, idleDays: 0, roomCount: 2 };

// 往 ww_spirits 塞一只带 persona 的串
function seed(id, pers, extra) {
  const raw = h.store.getItem("ww_spirits");
  const o = raw ? JSON.parse(raw) : {};
  o[id] = Object.assign({ look: { pers: pers }, persona: { id: pers, name: NAME_OF[pers] || pers },
    bond: 30, stage: 2, playCount: 30, imgUrl: "", letters: [], chats: [] }, extra || {});
  h.store.setItem("ww_spirits", JSON.stringify(o));
  return o[id];
}
const NAME_OF = {
  sweet: "最小的", lively: "最吵的那只", cool: "不爱说话的那只",
  scholar: "记账的那只", mystery: "知道点什么的", dignified: "最老的那只", gentle: "安静的那只",
};
function recOf(id) {
  const o = JSON.parse(h.store.getItem("ww_spirits") || "{}");
  return o[id] || {};
}
function storyOf() { return JSON.parse(h.store.getItem("ww_story") || "{}"); }
/* 负向对照兜底：基线没有本批新增的导出时，返回一个「什么都不做」的桩，
   让断言继续跑完并如实 FAIL（而不是崩在 TypeError 上看不到全貌）。*/
function fn(name) {
  if (typeof S[name] === "function") return S[name];
  return function () { return null; };
}
function resetAll() {
  try { h.store.removeItem("ww_spirits"); } catch (e) {}
  try { h.store.removeItem("ww_story"); } catch (e) {}
}

/* ---------- P0-1 行级 who 的真实覆盖在下方 ch3 剧本路径 ---------- */
section("P0-1 前置：章节入口齐备");
{
  ok(typeof S.chapTalkEnter === "function", "chapTalkEnter 导出");
  ok(typeof S.chapTalkChoose === "function", "chapTalkChoose 导出");
  ok(Array.isArray(S.CHAP_ACTS) && S.CHAP_ACTS.length >= 3, "CHAP_ACTS 可注入（实得 " + (S.CHAP_ACTS || []).length + " 章）");
}

/* ---------- 真实剧本注入：把 CH03 塞进 CHAP_SCRIPTS[2]（ch3） ---------- */
// CHAP_ACTS 由 CHAPTERS×CHAP_SCRIPTS 派生；chs 节点对象可整体替换（测试专用）
function injectChapter(idx, nodes) {
  S.CHAP_ACTS[idx].nodes = nodes;
}

const CH03 = {
  start: {
    lines: [
      { w: "sys", bg: "BG-04", fx: "fade_in", t: "第 20 天。" },
      { w: "sp", at: "L", who: "最小的", ps: ["sweet"], t: "{call}。上面的石头，为什么亮。" },
      { w: "me", t: "走得多的，就亮。" },
      { w: "sp", at: "B", who: "知道点什么的", ps: ["mystery"], t: "{call}，路是 {ta} 自己的。" },
    ],
    next: "c1",
  },
  c1: {
    lines: [{ w: "sp", bg: "BG-04", at: "C", who: "最老的那只", ps: ["dignified"], t: "今年这一步，由谁定。" }],
    choices: [
      { t: "这一步，我替{ta}定。", go: "D1", tone: "quiet",
        rset: { sweet: { stance: "DECIDE" } }, gset: { FORK_STANCE: "DECIDE" }, fb: "{ta} 的一声『好』，是跟在后头的。" },
      { t: "这条路，{ta}自己选。", go: "D2", tone: "warm",
        rset: { sweet: { stance: "LET" } }, gset: { FORK_STANCE: "LET" }, fb: "{ta} 走上第一级亮处。" },    ],
  },
  D1: { lines: [{ w: "sp", at: "L", who: "最小的", ps: ["sweet"], t: "……好。" }], next: "n1" },
  D2: { lines: [{ w: "sp", at: "L", who: "最小的", ps: ["sweet"], t: "{call}，我自己上的。" }], next: "n1" },
  n1: { lines: [{ w: "sys", fx: "slow", t: "这一夜过完。" }], end: true },
};

/* ---------- P0-1 + P0-2 + P0-3 + P0-4 联合：ch3 选 D1 ---------- */
section("P0-1/2/3/4 联合：ch3 走 D1（替它定）");
let rD1 = null;
{
  resetAll();
  const rec = seed("s1", "sweet");
  injectChapter(2, JSON.parse(JSON.stringify(CH03)));
  // 负向对照（基线无 end:true / rset）下会返回退化对象，这里补齐形状让断言继续跑完
  let r0 = S.chapTalkEnter(ITEM, rec, CTX, 2) || {};
  if (!Array.isArray(r0.added)) r0.added = [];
  if (!Array.isArray(r0.choices)) r0.choices = [];
  const C0 = r0.choices[0] || {};
  const names = r0.added.map((m) => m.name);
  ok(names.indexOf("最小的") >= 0, "行级 who 生效：出现「最小的」（实得 " + JSON.stringify(names) + "）");
  ok(names.indexOf("知道点什么的") >= 0, "群像不串脸：出现「知道点什么的」");
  ok(names.indexOf("最老的那只") >= 0, "出现「最老的那只」");
  ok(r0.added.filter((m) => m.w === "sys").every((m) => m.name === ""), "sys 行不挂名字");
  // {ta}：start 节点无 rset ⇒ 回落「那只」，⛔ 不是「它」
  const startTxt = r0.added.map((m) => m.text).join("|");
  ok(startTxt.indexOf("路是 那只 自己的") >= 0, "{ta} 无 rset ⇒ 回落「那只」（实得：" + startTxt + "）");
  ok(startTxt.indexOf("它自己") < 0, "⛔ {ta} 未回落成「它」");
  // 选项文案里 {ta} 指向该选项 rset 的键
  ok(r0.choices.length === 2, "ch3 c1 两个选项");
  ok((C0.t || "").indexOf("这一步，我替最小的定。") >= 0,
     "选项文案 {ta} = rset 键的行当名（实得：" + (C0.t || "") + "）");
  ok(!!C0.rset && !!C0.gset && C0.fb,
     "chapChoicesOf 透传 rset/gset/fb");

  rD1 = S.chapTalkChoose(ITEM, rec, CTX, 0) || { fb: "" };
  // 验收：选 D1 后 rec.flags.stance === "DECIDE"、ww_story.FORK_STANCE === "DECIDE"
  const recAfter = recOf("s1");
  ok(recAfter.flags && recAfter.flags.stance === "DECIDE",
     "★ ch3 D1 ⇒ rec.flags.stance === 'DECIDE'（实得 " + JSON.stringify(recAfter.flags) + "）");
  ok((storyOf().FORK_STANCE) === "DECIDE", "★ ch3 D1 ⇒ ww_story.FORK_STANCE === 'DECIDE'（实得 " + (storyOf().FORK_STANCE) + "）");
  // 注：剧本原文 fb 就是 "{ta} 的一声…"（{ta} 后带一个空格），引擎 ⛔ 不改写文案，故此处保留空格
  ok(rD1.fb && rD1.fb.indexOf("最小的一声") < 0 && rD1.fb.indexOf("{ta}") < 0 && rD1.fb.indexOf("最小的") >= 0,
     "fb 反馈行文案已 fmt 且 {ta} 零残留（实得：" + rD1.fb + "）");
  const allTxt = (rec.talk.log || []).map((m) => m.text).join("|");
  ok(allTxt.indexOf("最小的一声『好』") < 0 && allTxt.indexOf("最小的 的一声『好』") >= 0,
     "fb 作为 sys 反馈行进了聊天流（剧本原文 {ta} 后带空格，⛔ 引擎不改写文案）");
  ok(rD1.ended === true, "★ D1 → n1(end:true) ⇒ ended");
  ok(!!(rec.chapters && rec.chapters[2] && rec.chapters[2].at), "★ end:true 补调 readChapter（章已标记读过）");
  ok(recAfter.marks === undefined || Object.keys(recAfter.marks).indexOf("stance") < 0,
     "⛔ stance 未落 rec.marks（避开字典序裁剪）");
}

section("P0-2 选 D2（让它自己选）⇒ stance/FORK_STANCE 均为 LET");
{
  resetAll();
  const rec = seed("s1", "sweet");
  injectChapter(2, JSON.parse(JSON.stringify(CH03)));
  S.chapTalkEnter(ITEM, rec, CTX, 2);
  S.chapTalkChoose(ITEM, rec, CTX, 1);
  ok((recOf("s1").flags||{}).stance === "LET", "ch3 D2 ⇒ rec.flags.stance === 'LET'");
  ok((storyOf().FORK_STANCE) === "LET", "ch3 D2 ⇒ ww_stork.FORK_STANCE === 'LET'（实得 " + (storyOf().FORK_STANCE) + "）");
}

section("P0-2 FORK_STANCE tally：两串一 DECIDE 一 LET ⇒ MIXED");
{
  resetAll();
  const a = seed("s1", "sweet");
  const b = seed("s2", "lively");
  fn("chapRecomputeFork")();
  ok((storyOf().FORK_STANCE) === "UNSET", "无 stance ⇒ UNSET");
  fn("chapWriteRecFlag")(a, "stance", "DECIDE"); S.save && 0;
  // 直接落盘两份 stance
  const o = JSON.parse(h.store.getItem("ww_spirits"));
  o.s1.flags = { stance: "DECIDE" }; o.s2.flags = { stance: "LET" };
  h.store.setItem("ww_spirits", JSON.stringify(o));
  fn("chapRecomputeFork")();
  ok((storyOf().FORK_STANCE) === "MIXED", "DECIDE + LET ⇒ MIXED（实得 " + (storyOf().FORK_STANCE) + "）");
  o.s2.flags = { stance: "DECIDE" }; h.store.setItem("ww_spirits", JSON.stringify(o));
  fn("chapRecomputeFork")();
  ok((storyOf().FORK_STANCE) === "DECIDE", "全 DECIDE ⇒ DECIDE");
  o.s1.flags = { stance: "LET" }; o.s2.flags = { stance: "LET" }; h.store.setItem("ww_spirits", JSON.stringify(o));
  fn("chapRecomputeFork")();
  ok((storyOf().FORK_STANCE) === "LET", "全 LET ⇒ LET");
  void b;
}

section("P0-2 gset 落 ww_story + '+1' 自增（ch7 K1a）");
{
  resetAll();
  seed("s1", "sweet");
  fn("chapApplyGset")({ STANCE_CH1: true, CH2_FAVOR: "gentle" });
  let w = storyOf();
  ok(w.STANCE_CH1 === true && w.CH2_FAVOR === "gentle", "gset 普通键落 ww_story（实得 " + JSON.stringify(w) + "）");
  fn("chapApplyGset")({ KEY_CHOICES: "+1" });
  fn("chapApplyGset")({ KEY_CHOICES: "+1" });
  w = storyOf();
  ok(w.KEY_CHOICES === 2, "'+1' 自增两次 ⇒ KEY_CHOICES=2（实得 " + w.KEY_CHOICES + "）");
  fn("chapApplyGset")({ KEY_CHOICES: "+1" }); fn("chapApplyGset")({ KEY_CHOICES: "+1" });
  ok((storyOf().KEY_CHOICES) === 3, "KEY_CHOICES 封顶 3（实得 " + (storyOf().KEY_CHOICES) + "）");
}

section("P0-2 rset 逐串 + 缺 persona 静默降级（⛔ 不阻断）");
{
  resetAll();
  const rec = seed("s1", "sweet");
  const n = fn("chapApplyRset")({ sweet: { stance: "LET" }, lively: { stance: "DECIDE" }, nosuch: { stance: "LET" } });
  ok((recOf("s1").flags||{}).stance === "LET", "rset 命中 persona 写入 rec.flags");
  ok(fn("chapRecByPersona")("nosuch") === null, "缺 persona ⇒ 返回 null（不新造）");
  void n; void rec;
}

section("P0-2 节点级 rset/gset：进节点即写（ch4 n2 无条件 harmed）");
{
  resetAll();
  const rec = seed("s1", "lively");
  injectChapter(3, {
    start: { lines: [{ w: "sys", t: "ch4" }], next: "n2" },
    n2: { lines: [{ w: "sys", t: "榜挂了" }], rset: { lively: { harmed: true, harmCause: "掠客" } },
      gset: { CH4_LOOKED: "lively" }, next: "n3" },
    n3: { lines: [{ w: "sys", t: "末" }], end: true },
  });
  S.chapTalkEnter(ITEM, rec, CTX, 3);
  const r = recOf("s1"); const RF = r.flags || {};
  ok((r.harmed) === true && (r.harmCause) === "掠客", "节点级 rset ⇒ rec.harmed/harmCause（走 setHarmed）");
  ok(r.flags && RF.harmed === true && RF.harmCause === "掠客", "节点级 rset 同时镜像进 rec.flags");
  ok((storyOf().CH4_LOOKED) === "lively", "节点级 gset 落 ww_story");
  ok(S.harmedOf(r).harmed === true, "harmedOf 读到 true（与既有读取口径一致）");
}

section("P0-2 starMark 走 setStarMark（ch9 坛册落笔，⛔ ≠ harmed）");
{
  resetAll();
  const rec = seed("s1", "lively");
  fn("chapApplyRset")({ lively: { starMark: true } });
  const r = recOf("s1"); const RF = r.flags || {};
  ok((r.starMark) === true, "starMark 写 rec 顶层（走 setStarMark）");
  ok(RF.starMark === true, "starMark 镜像进 rec.flags");
  ok((r.harmed) === undefined || (r.harmed) === false, "⛔ starMark 未误伤 harmed");
}

section("P0-3 end:true：判 ended + 补 readChapter（长连载章末无 ending）");
{
  resetAll();
  const rec = seed("s1", "sweet");
  injectChapter(4, {
    start: { lines: [{ w: "sys", t: "ch5" }, { w: "sp", who: "最小的", t: "x" }], end: true },
  });
  const r = S.chapTalkEnter(ITEM, rec, CTX, 4);
  ok(r.ended === true, "end:true ⇒ ended");
  ok(r.ending === null, "end:true 不产生 ending（长连载口径）");
  ok(r.choices.length === 0, "end:true 后无选项");
  ok(!!(rec.chapters && rec.chapters[4] && rec.chapters[4].at), "end:true 补调 readChapter");
}

section("P0-3 保险：end 与 choices 同在 ⇒ 以 choices 优先（不提前终止）");
{
  resetAll();
  const rec = seed("s1", "sweet");
  injectChapter(5, {
    start: { lines: [{ w: "sys", t: "n" }], choices: [{ t: "选我", go: "z" }], end: true },
    z: { lines: [{ w: "sys", t: "末" }], end: true },
  });
  const r = S.chapTalkEnter(ITEM, rec, CTX, 5);
  ok(r.ended === false && r.choices.length === 1, "有 choices 时不判 ended（实得 ended=" + r.ended + "）");
}

section("P0-4 {ta}：有 rset ⇒ 行当名；无 rset ⇒ 「那只」");
{
  resetAll();
  const rec = seed("s1", "sweet");
  ok(fn("chapTaNameOf")("sweet") === "最小的", "chapTaNameOf(sweet) = 最小的");
  fn("chapTaSet")({ sweet: { stance: "LET" } });
  ok(fn("chapTaGet")() === "最小的", "chapTaSet 后 chapTaGet = 最小的");
  fn("chapTaSet")(null);
  ok(fn("chapTaGet")() === "那只", "无 rset ⇒ 回落「那只」");
  fn("chapTaSet")({});
  ok(fn("chapTaGet")() === "那只", "空 rset ⇒ 回落「那只」");
  void rec;
}

section("静默降级：缺 persona / 缺 rec / 垃圾输入一律不抛");
{
  resetAll();
  let threw = false;
  try {
    fn("chapApplyRset")(null); fn("chapApplyRset")({}); fn("chapApplyGset")(null);
    fn("chapApplySets")(null, null); fn("chapApplySets")({ BAD: 1 }, { nosuch: { x: 1 } });
    fn("chapTaNameOf")(""); fn("chapTaNameOf")(undefined);
  } catch (e) { threw = true; }
  ok(!threw, "垃圾输入零抛错（⛔ 绝不阻断进章）");
}

section("导出项齐备（P0 供自测与调试面板）");
["chapRecByPersona", "chapWriteRecFlag", "chapApplyRset", "chapApplyGset",
  "chapRecomputeFork", "chapApplySets", "chapTaSet", "chapTaGet", "chapTaNameOf",
].forEach((k) => ok(typeof S[k] === "function", k + " 导出"));
ok(S.CHAP_FLAG_CFG && S.CHAP_FLAG_CFG.FORK_TALLY === true, "CHAP_FLAG_CFG.FORK_TALLY 常量在");

process.exitCode = summary() ? 0 : 1;
