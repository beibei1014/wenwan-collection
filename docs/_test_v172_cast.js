/* V172-B · 主线选角（castManual）自测 —— TDD 红测
 * ===========================================================================
 * 覆盖主理人（江开局）派单【阶段一】的 7 项：
 *   1. 手动指定生效：castManual = { dignified:{id:"X"} } ⇒ castOf().dignified.id === "X" 且带 manual:true
 *   2. 失效 id 清理：castManual[pid].id 不在 load() ⇒ 当没指定，回落自动抽签 + 清掉脏键
 *   3. force:true 不得冲掉手动槽位（_test_v165_engine.js:362 在钉 force 语义，别踩）
 *   4. 🔴 {ta} 跟随 cast：同名 persona 多只 + 手动指定「非入藏序第一只」⇒ {ta} 展开成手动那只
 *      （现状 chapTaNameOf 走 chapRecByPersona，按入藏序取第一只 —— 本条是本次核心回归点）
 *   5. m.castName：who 计数不变（CH0N 块内 who: 仍 170 处）+ m.castName 取自 cast 里那只的显示名
 *   6. ⛔ castManual 绝不写进 ww_spirits 逐串 rec；非我方 10 个不出现在 castOf() 结果里
 *   7. 幂等：连续两次 castSetManual 同值 ⇒ 无重复写入 / 无时间戳抖动
 *
 * 契约（本文件即规格，实现请照此）：
 *   存储：ww_story.castManual = { "<persona>": { id: "<spiritId>", name?: "<显示名>" } }
 *         ⛔ 新字段不是新 key（新 key 换设备会丢；packSync() 已把 readStory() 整包推云端）
 *   castOf()[pid] 手动槽位：{ name: <行当名，仍是 CHAP_CAST_NAME>, castName: <沁灵显示名>,
 *                            id, pid, manual: true }
 *   chapLine 产出消息：m.name 仍是行级 who（⛔ 不动）；新增 m.castName
 *   chapTaNameOf(pid) ⇒ castOf()[pid].castName（与立绘指向同一只）
 *
 * 用法：
 *   node docs/_test_v172_cast.js                       # 跑当前源码（改动前应红）
 *   SPIRITS_SRC=docs/_spirits_prev.js node docs/_test_v172_cast.js    # 负向对照
 *   APP_SRC_FILE=docs/_app_prev.js   node docs/_test_v172_cast.js     # 阶段二负向对照
 * 退出码 0 = 全通过；非 0 = 有断言失败。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const H = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const SPIRITS_SRC = process.env.SPIRITS_SRC || "js/spirits.js";
const APP_SRC_FILE = process.env.APP_SRC_FILE || "js/app.js";
const SKIN_FILE = process.env.SKIN_FILE || "css/skin.css";
const STYLE_FILE = process.env.STYLE_FILE || "css/style.css";

const spSrc = fs.readFileSync(path.join(ROOT, SPIRITS_SRC), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, APP_SRC_FILE), "utf8");
function readCss(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch (e) { return ""; }
}
const cssAll = readCss(SKIN_FILE) + "\n" + readCss(STYLE_FILE);

/* 计数分两摊：阶段一（引擎/数据层）/ 阶段二（界面层挂点），便于分别验收 */
let PA = 0, FA = 0, PB = 0, FB = 0;
const FAILS = [];
function ok(cond, msg, phase) {
  const p = phase || "A";
  if (cond) { if (p === "A") PA++; else PB++; }
  else {
    if (p === "A") FA++; else FB++;
    FAILS.push("[" + p + "] " + msg);
    console.log("  ✗ " + msg);
  }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 沙箱 ---------- */
function newS() {
  const c = H.makeContext();
  H.loadFile(c.ctx, SPIRITS_SRC);
  return { S: c.sandbox.Spirits, c: c, store: c.store };
}
/* 负向对照兜底：改动前没有这些导出时返回「什么都不做」的桩，
   让断言继续跑完并如实 FAIL（而不是崩在 TypeError 上看不到全貌）。 */
function fn(S, name) {
  return typeof S[name] === "function" ? S[name] : function () { return null; };
}
/* castOf 兜底：很老的基线（e0d6b06）还没有 casting，直接调会 TypeError；
   这里返回空表让断言继续跑完并如实 FAIL（负向对照要的是全貌，不是崩栈）。 */
function castOf(S, opts) {
  if (typeof S.castOf !== "function") return {};
  try { return S.castOf(opts || {}) || {}; } catch (e) { return {}; }
}
function storyOf(c) { try { return JSON.parse(c.store.getItem("ww_story") || "{}"); } catch (e) { return {}; } }
function spiritsOf(c) { try { return JSON.parse(c.store.getItem("ww_spirits") || "{}"); } catch (e) { return {}; } }
function storeKeys(c) { return Array.from(c.store._m.keys()); }

/* 直接写 ww_story.castManual（不经写入口）—— 测「读契约」本身，
   与阶段「写入口」分开，避免写入口缺失时把读侧断言一起废掉。 */
function putManual(c, obj) {
  const w = storyOf(c);
  w.castManual = obj;
  c.store.setItem("ww_story", JSON.stringify(w));
}
/* 往 ww_spirits 塞一只带 persona 的串 */
function seed(c, id, pers, dispName, bond) {
  const o = spiritsOf(c);
  o[id] = {
    look: { pers: pers },
    persona: { id: pers, name: dispName || pers },
    bond: bond == null ? 30 : bond,
    stage: 2, imgUrl: "", imgCut: "", letters: [], chats: [],
  };
  c.store.setItem("ww_spirits", JSON.stringify(o));
  return o[id];
}
function resetAll(c) {
  try { c.store.removeItem("ww_spirits"); } catch (e) {}
  try { c.store.removeItem("ww_story"); } catch (e) {}
}

const MAIN7 = ["dignified", "scholar", "cool", "gentle", "lively", "mystery", "sweet"];
const NPC_PERSONA = ["wild", "cheeky", "aloof", "sentimental", "calm", "wanderer", "heroic", "pampered"];
const CHAP_CAST_NAME = {
  dignified: "最老的那只", scholar: "记账的那只", cool: "不爱说话的那只",
  gentle: "安静的那只", lively: "最吵的那只", mystery: "知道点什么的", sweet: "最小的",
};

/* ========================================================================
 * A · 契约与常量
 * ====================================================================== */
section("A · 存储契约与常量（⛔ 非我方不进 / 留开关位）");
{
  const { S, c } = newS();
  ok(!!S.CHAP_CAST_CFG, "CHAP_CAST_CFG 在");
  ok(S.CHAP_CAST_CFG && S.CHAP_CAST_CFG.MANUAL_KEY === "castManual",
    "CHAP_CAST_CFG.MANUAL_KEY === 'castManual'（⛔ 新字段不是新 key，实得 " +
    (S.CHAP_CAST_CFG && S.CHAP_CAST_CFG.MANUAL_KEY) + "）");
  ok(S.CHAP_CAST_CFG && JSON.stringify(S.CHAP_CAST_CFG.MAIN) === JSON.stringify(MAIN7),
    "CHAP_CAST_CFG.MAIN 仍是那 7 型且顺序不变（⛔ 非我方 10 个不进，实得 " +
    JSON.stringify(S.CHAP_CAST_CFG && S.CHAP_CAST_CFG.MAIN) + "）");
  // 裁定②：邻居两位（wild / cheeky）默认不放进下拉，但留一个开关位（常量即可，不接 UI）
  ok(S.CHAP_CAST_CFG && Array.isArray(S.CHAP_CAST_CFG.EXTRA) && S.CHAP_CAST_CFG.EXTRA.length === 0,
    "CHAP_CAST_CFG.EXTRA 存在且默认为空数组（非我方扩展开关位，⛔ 默认不接，实得 " +
    JSON.stringify(S.CHAP_CAST_CFG && S.CHAP_CAST_CFG.EXTRA) + "）");
  // 裁定③：无 persona 的候选加一枚标记（编剧定稿「性子还藏着」5 字；⛔「人设」是项目术语，玩家看不见）
  ok(typeof S.CAST_NO_PERSONA_TAG === "string" && S.CAST_NO_PERSONA_TAG === "性子还藏着",
    "CAST_NO_PERSONA_TAG === '性子还藏着'（编剧定稿，实得 " + JSON.stringify(S.CAST_NO_PERSONA_TAG) + "）");

  ["castSetManual", "castClearManual", "castClearAllManual"].forEach((k) => {
    ok(typeof S[k] === "function", k + " 导出（选角写入口）");
  });

  // 存储落点：写 ww_story，⛔ 不得另开 localStorage key（换设备会丢）
  ok(spSrc.indexOf("castManual") >= 0, "源码出现 castManual 字段（落 ww_story）");
  ok(!/["']ww_cast["']/.test(spSrc), "⛔ 源码未另开 ww_cast 新 key（换设备会丢，必须走 ww_story）");
  const { c: c2 } = newS();
  seed(c2, "x1", "sweet", "小甜", 30);
  fn(c2.sandbox.Spirits, "castSetManual")("sweet", "x1");
  ok(storeKeys(c2).indexOf("ww_cast") < 0, "⛔ 未产生 ww_cast 键（实得 " + JSON.stringify(storeKeys(c2)) + "）");
}

/* ========================================================================
 * B · 手动指定生效（派单 1）
 * ====================================================================== */
section("B · 手动指定生效：castManual = { dignified:{id:'X'} } ⇒ castOf().dignified.id === 'X'");
{
  const { S, c } = newS();
  resetAll(c);
  seed(c, "a1", "dignified", "大檀", 99);   // 自动抽签会选它（同型亲密度最高）
  seed(c, "b1", "sweet", "小甜", 10);       // persona 不同 ⇒ 自动绝不会把 b1 派给 dignified
  putManual(c, { dignified: { id: "b1" } });
  const cast = castOf(S, { force: true });
  ok(!!cast.dignified && cast.dignified.id === "b1",
    "★ 手动指定生效：dignified.id === 'b1'（实得 " + (cast.dignified && cast.dignified.id) + "）");
  ok(cast.dignified && cast.dignified.manual === true,
    "手动槽位带 manual:true（实得 " + (cast.dignified && cast.dignified.manual) + "）");
  ok(cast.dignified && cast.dignified.name === CHAP_CAST_NAME.dignified,
    "⛔ 手动槽位的 name 仍是行当名「最老的那只」（⛔ 不改成沁灵本名，实得 " +
    (cast.dignified && cast.dignified.name) + "）");
  ok(cast.dignified && cast.dignified.castName === "小甜",
    "手动槽位带 castName = 该沁灵显示名（实得 " + (cast.dignified && cast.dignified.castName) + "）");
  // 未手动指定的槽位照旧走自动抽签
  ok(!!cast.sweet && cast.sweet.id === "b1" && cast.sweet.manual !== true,
    "未指定的 sweet 仍走自动抽签且不带 manual（实得 " + (cast.sweet && cast.sweet.id) + "）");
  // UI 保存后的真实读法：castOf({force:true}) 必须带上手动（不 force 时若缓存已存在，行为由实现保证）
  const cast2 = castOf(S, { force: true });
  ok(cast2.dignified && cast2.dignified.id === "b1" && cast2.dignified.manual === true,
    "二次 castOf({force:true}) 仍是手动那只（实得 " + (cast2.dignified && cast2.dignified.id) + "）");
}
{
  // 无缓存的首次读取（不是 force）也必须带上手动 —— castBuild 级覆盖的判据
  const { S, c } = newS();
  resetAll(c);
  seed(c, "a1", "dignified", "大檀", 99);
  seed(c, "b1", "sweet", "小甜", 10);
  putManual(c, { dignified: { id: "b1" } });
  const cast = castOf(S);
  ok(cast.dignified && cast.dignified.id === "b1" && cast.dignified.manual === true,
    "首次 castOf()（无缓存、不 force）也带上手动（实得 " + (cast.dignified && cast.dignified.id) + "）");
}

/* ========================================================================
 * C · 失效 id 清理（派单 2）
 * ====================================================================== */
section("C · 失效 id 清理：指向已不在 load() 的串 ⇒ 当没指定 + 清掉脏键");
{
  const { S, c } = newS();
  resetAll(c);
  seed(c, "a1", "dignified", "大檀", 99);
  seed(c, "b1", "sweet", "小甜", 10);
  putManual(c, { dignified: { id: "ghost" } });      // 幽灵 id：不在 ww_spirits
  const cast = castOf(S, { force: true });
  ok(!!cast.dignified && cast.dignified.id === "a1",
    "★ 失效 id ⇒ 回落自动抽签（应取 a1，实得 " + (cast.dignified && cast.dignified.id) + "）");
  ok(cast.dignified && cast.dignified.manual !== true,
    "失效槽位不带 manual（实得 " + (cast.dignified && cast.dignified.manual) + "）");
  const w = storyOf(c);
  ok(!w.castManual || w.castManual.dignified === undefined,
    "★ 脏键已清理：ww_story.castManual.dignified 不存在（实得 " + JSON.stringify(w.castManual) + "）");
}

/* ========================================================================
 * D · force:true 不得冲掉手动槽位（派单 3）
 * ====================================================================== */
section("D · force:true 不得冲掉手动槽位（_test_v165_engine.js:362 在钉 force 语义）");
{
  const { S, c } = newS();
  resetAll(c);
  seed(c, "s1", "sweet", "大姑娘", 99);   // 亲密度最高 ⇒ 自动会选 s1
  seed(c, "s2", "sweet", "二姑娘", 10);   // 手动指定 s2（自动绝不会选它）
  putManual(c, { sweet: { id: "s2" } });
  const c1 = castOf(S, { force: true });
  ok(c1.sweet && c1.sweet.id === "s2" && c1.sweet.manual === true, "force 后仍是手动那只 s2");
  // 再塞一只更高亲密度的同型串，force 重抽也不得顶掉手动
  seed(c, "s3", "sweet", "三姑娘", 999);
  const c2 = castOf(S, { force: true });
  ok(c2.sweet && c2.sweet.id === "s2" && c2.sweet.manual === true,
    "★ 新来一只亲密度更高的同型串 + force ⇒ 仍不被顶掉（实得 " + (c2.sweet && c2.sweet.id) + "）");
  ok(c2.sweet && c2.sweet.castName === "二姑娘",
    "手动槽位 castName 仍指向 s2（实得 " + (c2.sweet && c2.sweet.castName) + "）");
}

/* ========================================================================
 * E · 🔴 {ta} 跟随 cast（派单 4 · 本次核心回归点）
 * ====================================================================== */
section("E · 🔴 {ta} 跟随 cast（同名 persona 多只 + 手动指定非入藏序第一只）");
{
  const { S, c } = newS();
  resetAll(c);
  seed(c, "s1", "sweet", "大姑娘", 99);   // 入藏序第一 + 亲密度最高 ⇒ chapRecByPersona 与 castPick 都会先命中它
  seed(c, "s2", "sweet", "二姑娘", 10);   // 手动指定这只（⛔ 非入藏序第一只）
  putManual(c, { sweet: { id: "s2" } });

  const cast = castOf(S, { force: true });
  ok(cast.sweet && cast.sweet.id === "s2", "前置：castOf().sweet 是手动那只 s2（实得 " +
    (cast.sweet && cast.sweet.id) + "）");

  // 直连：chapTaNameOf 必须给出手动那只的名字（现状会给「大姑娘」⇒ 红）
  let ta = null, threw = false;
  try { ta = S.chapTaNameOf("sweet"); } catch (e) { threw = true; }
  ok(!threw, "chapTaNameOf 不抛错");
  ok(ta === "二姑娘",
    "★ chapTaNameOf('sweet') === '二姑娘'（跟随手动选角，⛔ 不是入藏序第一只「大姑娘」，实得 " + ta + "）");

  // 剧本路径：真跑一章，{ta} 展开出来必须是手动那只
  const NODES = {
    start: {
      rset: { sweet: { stance: "DECIDE" } },
      lines: [{ w: "sp", at: "L", who: "最小的", ps: ["sweet"], t: "{call}，路是 {ta} 自己的。" }],
      next: "c1",
    },
    c1: { choices: [{ t: "这一步，我替{ta}定。", go: "D1", rset: { sweet: { stance: "DECIDE" } } }] },
    D1: { lines: [{ w: "sp", at: "L", who: "最小的", ps: ["sweet"], t: "……好。" }], end: true },
  };
  // v180-L1：老主线 mainTalkEnter / MAIN_ACTS 已删 ⇒ 直接驱动共享引擎 chapWalk（自带一幕表）
  const ACT = { id: "m1", i: 0, nodes: JSON.parse(JSON.stringify(NODES)) };
  const actOf = (id) => (id === "m1" ? ACT : null);
  let r = null, e2 = null;
  const rec = { look: { pers: "sweet" }, persona: { id: "sweet", name: "大姑娘" }, bond: 99, stage: 2,
    talk: { chapId: "m1", node: "start", log: [], msgs: 0, ended: false, ending: null, tone: "", at: Date.now() } };
  if (typeof S.chapWalk === "function") {
    try { r = S.chapWalk({ name: "小叶紫檀" }, rec, { dayNo: 20 }, actOf); } catch (e) { e2 = e; }
  } else { e2 = new Error("chapWalk 缺失（负向对照）"); }
  ok(!e2, "chapWalk 驱动一幕不抛错" + (e2 ? " —— " + e2.message : ""));
  const txt = ((r && r.added) || []).map((m) => m.text).join("|");
  ok(txt.indexOf("路是 二姑娘 自己的。") >= 0,
    "★ 剧本 {ta} 展开 = 手动那只「二姑娘」（实得：" + txt + "）");
  ok(txt.indexOf("大姑娘") < 0,
    "⛔ 剧本 {ta} 未回落到入藏序第一只「大姑娘」（实得：" + txt + "）");
  ok(txt.indexOf("它自己") < 0, "⛔ {ta} 绝不写「它」");
  // 选项文案里的 {ta} 同样跟随
  const ch0 = ((r && r.choices) || [])[0] || {};
  ok((ch0.t || "").indexOf("我替二姑娘定。") >= 0,
    "选项文案 {ta} 同样跟随手动选角（实得：" + (ch0.t || "") + "）");
}

/* ========================================================================
 * F · m.castName + who 计数不变（派单 5）
 * ====================================================================== */
section("F · m.castName：who 计数不变 + castName 取自 cast 里那只");
{
  // v180-L1：老主线 CH0N 剧本块已整体删除 ⇒ 原「who 计数 170」静态契约随之退役
  const blocks = spSrc.match(/^const CH0[1-9] = \{[\s\S]*?^\};/gm) || [];
  ok(blocks.length === 0, "老主线 CH0N 剧本块已删除（实测 " + blocks.length + "）");

  const { S, c } = newS();
  resetAll(c);
  seed(c, "s1", "sweet", "大姑娘", 99);
  seed(c, "s2", "sweet", "二姑娘", 10);
  putManual(c, { sweet: { id: "s2" } });
  const NODES = {
    start: {
      lines: [{ w: "sp", at: "L", who: "最小的", ps: ["sweet"], t: "{call}，我最小。" }],
      next: "c1",
    },
    c1: { choices: [{ t: "好。", go: "D1" }] },
    D1: { lines: [{ w: "sys", t: "这一夜过完。" }], end: true },
  };
  // v180-L1：改用共享引擎 chapWalk（自带一幕表）
  const ACT = { id: "m1", i: 0, nodes: JSON.parse(JSON.stringify(NODES)) };
  const actOf = (id) => (id === "m1" ? ACT : null);
  let r = null, e = null;
  const rec = { look: { pers: "sweet" }, persona: { id: "sweet", name: "大姑娘" }, bond: 99, stage: 2,
    talk: { chapId: "m1", node: "start", log: [], msgs: 0, ended: false, ending: null, tone: "", at: Date.now() } };
  if (typeof S.chapWalk === "function") {
    try { r = S.chapWalk({ name: "小叶紫檀" }, rec, { dayNo: 20 }, actOf); } catch (x) { e = x; }
  } else { e = new Error("chapWalk 缺失（负向对照）"); }
  ok(!e, "chapWalk 驱动一幕不抛错" + (e ? " —— " + e.message : ""));
  const m0 = ((r && r.added) || [])[0] || {};
  ok(m0.name === "最小的",
    "⛔ m.name 仍是行级 who「最小的」（实得 " + JSON.stringify(m0.name) + "）");
  ok(m0.castName === "二姑娘",
    "★ m.castName = 手动那隻的显示名「二姑娘」（实得 " + JSON.stringify(m0.castName) + "）");
  ok(JSON.stringify(m0.ps) === JSON.stringify(["sweet"]),
    "⛔ m.ps 未被改写（渲染层靠它取立绘，实得 " + JSON.stringify(m0.ps) + "）");
  // sys / me 行不该挂 castName
  const sysM = ((r && r.added) || []).filter((x) => x.w === "sys")[0];
  ok(!sysM || sysM.castName === undefined || sysM.castName === "", "sys 行不挂 castName");
}

/* ========================================================================
 * G · ⛔ 不进 ww_spirits / 非我方不出现（派单 6）
 * ====================================================================== */
section("G · ⛔ castManual 绝不写进逐串 rec；非我方 10 个不出现在 castOf() 结果里");
{
  const { S, c } = newS();
  resetAll(c);
  seed(c, "a1", "dignified", "大檀", 50);
  seed(c, "b1", "sweet", "小甜", 40);
  const before = Object.keys(spiritsOf(c)).map((k) => Object.keys(spiritsOf(c)[k]).sort().join(","));
  fn(S, "castSetManual")("dignified", "b1");
  castOf(S, { force: true });
  const after = spiritsOf(c);
  ok(JSON.stringify(after).indexOf("castManual") < 0,
    "⛔ ww_spirits 里不含 castManual 字样（资产库禁区）");
  const afterKeys = Object.keys(after).map((k) => Object.keys(after[k]).sort().join(","));
  ok(before.every((b, i) => afterKeys[i] === b),
    "⛔ 逐串 rec 的字段集合未变（实得 " + JSON.stringify(afterKeys) + "）");
  ok(!after.b1.cast && !after.b1.castManual && !after.b1.row,
    "⛔ 被选中的那只 rec 上也没多出 cast / castManual / row 字段");

  // 非我方 persona 不得出现在 castOf() 结果里
  const cast = castOf(S, { force: true });
  const keys = Object.keys(cast);
  ok(keys.every((k) => MAIN7.indexOf(k) >= 0),
    "★ castOf() 的键 ⊆ 我方 7 型（实得 " + JSON.stringify(keys) + "）");
  ok(NPC_PERSONA.every((p) => keys.indexOf(p) < 0),
    "⛔ 非我方 persona（wild/cheeky/aloof/sentimental/calm/wanderer/heroic/pampered）一个都不出现");

  // 防御：castManual 里塞非我方 persona，也不得把槽位塞进 castOf()
  putManual(c, { wild: { id: "a1" }, cheeky: { id: "b1" } });
  const cast2 = castOf(S, { force: true });
  const keys2 = Object.keys(cast2);
  ok(keys2.indexOf("wild") < 0 && keys2.indexOf("cheeky") < 0,
    "⛔ 手动指定非我方 persona 也不生效（裁定②：本批只做 7 个，实得 " + JSON.stringify(keys2) + "）");
}

/* ========================================================================
 * H · 幂等 + 清除 + 静默降级（派单 7）
 * ====================================================================== */
section("H · 写入口：幂等 / 清理 / 静默降级");
{
  const { S, c } = newS();
  resetAll(c);
  seed(c, "a1", "dignified", "大檀", 50);
  seed(c, "b1", "sweet", "小甜", 40);

  fn(S, "castSetManual")("dignified", "b1");
  const snap1 = JSON.stringify((storyOf(c).castManual || {}));
  fn(S, "castSetManual")("dignified", "b1");
  const snap2 = JSON.stringify((storyOf(c).castManual || {}));
  ok(snap1 === snap2 && snap1 !== "{}",
    "★ 幂等：连续两次 castSetManual 同值 ⇒ 落盘完全一致（\n     1st=" + snap1 + "\n     2nd=" + snap2 + "）");

  const ent = (storyOf(c).castManual || {}).dignified || {};
  const ek = Object.keys(ent);
  ok(ek.length <= 2 && ek.every((k) => k === "id" || k === "name"),
    "条目只有 { id, name } 两个键（⛔ 无 at / ts / updatedAt 时间戳抖动，实得 " + JSON.stringify(ek) + "）");
  ok(ent.id === "b1", "条目 id 正确（实得 " + JSON.stringify(ent) + "）");

  // 清除单行
  fn(S, "castClearManual")("dignified");
  ok((storyOf(c).castManual || {}).dignified === undefined,
    "castClearManual(pid) ⇒ 该槽位清除（实得 " + JSON.stringify(storyOf(c).castManual) + "）");
  const castBack = castOf(S, { force: true });
  ok(castBack.dignified && castBack.dignified.id === "a1" && castBack.dignified.manual !== true,
    "清除后回落自动抽签（实得 " + (castBack.dignified && castBack.dignified.id) + "）");

  // 全清
  fn(S, "castSetManual")("dignified", "b1");
  fn(S, "castSetManual")("sweet", "a1");
  fn(S, "castClearAllManual")();
  const cm = storyOf(c).castManual;
  ok(!cm || Object.keys(cm).length === 0,
    "castClearAllManual() ⇒ castManual 清空（实得 " + JSON.stringify(cm) + "）");
}
{
  // 静默降级：castManual 是垃圾输入 / 空库存，一律不抛错
  const { S, c } = newS();
  resetAll(c);
  seed(c, "a1", "sweet", "小甜", 30);
  [null, "乱写", 123, [], { sweet: null }, { sweet: { id: 123 } }, { sweet: { id: "" } }].forEach((g, i) => {
    putManual(c, g);
    let threw = false, r = null;
    try { r = castOf(S, { force: true }); } catch (e) { threw = true; }
    ok(!threw && r && typeof r === "object",
      "垃圾 castManual #" + (i + 1) + "（" + JSON.stringify(g) + "）⇒ 不抛错且返回对象");
  });
  resetAll(c);
  putManual(c, { sweet: { id: "ghost" } });
  let threw2 = false;
  try { castOf(S, { force: true }); } catch (e) { threw2 = true; }
  ok(!threw2, "空库存 + 手动幽灵 id ⇒ 不抛错（⛔ 不阻断进章）");
}

/* ========================================================================
 * I · 文案与常量契约（v172 定稿）
 *   ⛔ 全部走常量：UI 侧不许硬编码这几句，也不许做默认值兜底（缺 key 就不渲染那句说明）
 * ====================================================================== */
const CAST_DESC = {
  dignified: "年纪最长，开口一门人都听。",      // 最老的那只
  scholar: "管着一本账，谁进谁出都记着。",      // 记账的那只
  cool: "不搭腔，开口往往只半句。",            // 不爱说话的那只
  gentle: "性子最软，谁也不跟谁争。",          // 安静的那只
  lively: "抢着开口，什么都藏不住。",          // 最吵的那只
  mystery: "知道的比说的多，话只点到。",        // 知道点什么的
  sweet: "年纪最小，最想被认出来。",           // 最小的
};
const CAST_COPY = {
  HEAD: "戏要开场，一门七位，先定谁扮哪一位。",
  NOT_PICKED: "还没点，这位是家里自己顶的。",
  AUTO_TAG: "家里顶的",
  FEW_NOTE: "人少也不妨：性子像的先顶上，再一位扮上几位，家里轮着来。",
  COUNT_LINE: "台上七位 · 在册 {N} 位",
  TOAST_ALL: "七位都点上了 · 往后这门人的戏就照这个扮。",
  ENTRY_BADGE: "还没点戏",
};

section("I1 · CHAP_CAST_DESC（编剧定稿 · ⛔ 一字不改 · 键 = MAIN 的 persona）");
{
  const { S } = newS();
  ok(!!S.CHAP_CAST_DESC && typeof S.CHAP_CAST_DESC === "object", "CHAP_CAST_DESC 导出");
  const d = S.CHAP_CAST_DESC || {};
  ok(JSON.stringify(Object.keys(d)) === JSON.stringify(MAIN7),
    "键恰好是 MAIN 的 7 个 persona 且顺序一致（实得 " + JSON.stringify(Object.keys(d)) + "）");
  MAIN7.forEach(function (p) {
    ok(d[p] === CAST_DESC[p],
      "★ " + p + " 说明逐字一致（应「" + CAST_DESC[p] + "」实得 " + JSON.stringify(d[p]) + "）");
  });
  ok(MAIN7.every((p) => String(d[p] || "").length <= 18),
    "7 句均 ≤18 字（实得 " + MAIN7.map((p) => String(d[p] || "").length).join("/") + "）");
  ok(MAIN7.every((p) => !String(d[p] || "").startsWith("这位在戏里")),
    "⛔ 删掉了「这位在戏里 —— 」前缀（美术裁定：后台味引导词）");
  ok(!spSrc.includes("这位在戏里"), "⛔ 源码里没有「这位在戏里」字样");
  // v180-L1：老主线选角页已下线 ⇒ app.js 不再引用选角常量（引擎常量仍在 spirits.js）
  ok(appSrc.indexOf("CHAP_CAST_DESC") < 0, "app.js 不再引用 CHAP_CAST_DESC（选角界面已随 L1 下线）", "B");
    ok(MAIN7.every((p) => appSrc.indexOf(CAST_DESC[p]) < 0),
    "⛔ app.js 未硬编码这 7 句原文（UI 只消费常量）", "B");
  ok(!/CHAP_CAST_DESC\s*\[[^\]]+\]\s*\|\|/.test(appSrc),
    "⛔ 取值无 `|| 默认值` 兜底（缺 key 就不渲染那句说明，绝不填占位假文案）", "B");
}

section("I2 · 界面文案常量 CHAP_CAST_COPY（⛔ 同样不许硬编码进 HTML 串）");
{
  const { S } = newS();
  ok(!!S.CHAP_CAST_COPY && typeof S.CHAP_CAST_COPY === "object", "CHAP_CAST_COPY 导出");
  const c = S.CHAP_CAST_COPY || {};
  Object.keys(CAST_COPY).forEach(function (k) {
    ok(c[k] === CAST_COPY[k],
      "★ " + k + " 逐字一致（应「" + CAST_COPY[k] + "」实得 " + JSON.stringify(c[k]) + "）");
  });
  // 中性数据行：平级并列，⛔ 禁「只有 / 还差 / 至少需要」
  ok(String(c.COUNT_LINE || "").indexOf("·") >= 0, "COUNT_LINE 用「·」平级并列");
  ok(!/只有|还差|至少需要|不够/.test(String(c.COUNT_LINE || "")),
    "⛔ COUNT_LINE 不含「只有 / 还差 / 至少需要 / 不够」（实得 " + JSON.stringify(c.COUNT_LINE) + "）");
  ok(String(c.COUNT_LINE || "").indexOf("{N}") >= 0, "COUNT_LINE 保留 {N} 占位符（在册数由代码填）");
  // 不足 7 只：整句渲染、三个分句顺序对应代码真实顺序（castNearest → 一人扮多位 → fill 轮转）
  const fn0 = String(c.FEW_NOTE || "");
  ok(fn0.indexOf("性子像的先顶上") >= 0 && fn0.indexOf("再一位扮上几位") >= 0 && fn0.indexOf("家里轮着来") >= 0,
    "FEW_NOTE 三个分句齐全（实得 " + JSON.stringify(fn0) + "）");
  ok(fn0.indexOf("性子像的先顶上") < fn0.indexOf("再一位扮上几位") &&
     fn0.indexOf("再一位扮上几位") < fn0.indexOf("家里轮着来"),
    "★ FEW_NOTE 分句序 = 代码顺序：castNearest → 一人扮多位 → fill 轮转（⛔ 不许调换）");
  ok(String(c.TOAST_ALL || "").indexOf("还差") < 0, "⛔ 一键分派 Toast 不含「还差 N 位」");
  ok(String(c.ENTRY_BADGE || "") === "还没点戏", "⛔ 入口卡角标统一「还没点戏」（实得 " + JSON.stringify(c.ENTRY_BADGE) + "）");
  ok(String(c.NOT_PICKED || "") === String(c.NOT_PICKED || "").trim() && !/自动|顶着/.test(String(c.NOT_PICKED || "")),
    "未点/顶着态通用一句（.is-auto 与 .is-fill 共用，不区分措辞）");
  Object.keys(CAST_COPY).forEach(function (k) {
    ok(appSrc.indexOf(CAST_COPY[k]) < 0, "⛔ app.js 未硬编码文案 " + k + "（应取 CHAP_CAST_COPY）", "B");
  });
  ok(appSrc.indexOf("CHAP_CAST_COPY") < 0, "app.js 不再引用 CHAP_CAST_COPY（选角界面已随 L1 下线）", "B");
  ok(appSrc.indexOf("CAST_NO_PERSONA_TAG") < 0, "app.js 不再引用 CAST_NO_PERSONA_TAG", "B");
    ok(appSrc.indexOf("性子还藏着") < 0, "⛔ app.js 未硬编码「性子还藏着」", "B");
}

section("I3 · 状态钩子语义（⛔ 别让朱印和徽标同框）");
{
  const { S, c: cc } = newS();
  resetAll(cc);
  seed(cc, "a1", "dignified", "大檀", 50);   // 只有 1 只 ⇒ 其余 6 型靠 near / fill 顶着
  seed(cc, "b1", "sweet", "小甜", 40);
  putManual(cc, { sweet: { id: "b1" } });
  const cast = castOf(S, { force: true });
  ok(cast.sweet && cast.sweet.manual === true, "手动槽位 manual:true");
  ok(cast.sweet && cast.sweet.fill !== true && cast.sweet.near !== true,
    "★ 手动槽位不得同时带 fill / near（⛔ 朱印与徽标不同框，实得 fill=" +
    (cast.sweet && cast.sweet.fill) + " near=" + (cast.sweet && cast.sweet.near) + "）");
  const nearSlot = MAIN7.filter((p) => cast[p] && cast[p].near === true)[0];
  ok(!!nearSlot, "存在 near=true 的同组回落槽位（实得 " + nearSlot + "）");
  ok(nearSlot && cast[nearSlot].fill !== true, "near 槽位不带 fill（两者互斥）");
  const fillSlot = MAIN7.filter((p) => cast[p] && cast[p].fill === true)[0];
  ok(!!fillSlot, "存在 fill=true 的轮转复用槽位（实得 " + fillSlot + "）");
  ok(fillSlot && cast[fillSlot].near === false, "⛔ fill 槽位 near=false（语义分层，_test_v165_engine.js:333 在钉）");
  ok(fillSlot && cast[fillSlot].manual !== true, "fill 槽位不是手动（未点过人 ⇒ 归「家里顶的」）");
}

/* ========================================================================
 * 阶段二 · v180-L1：老主线选角界面（#/maincast）整条下线
 * ====================================================================== */
section("阶段二 · v180-L1：app.js 里选角界面已删干净（引擎侧 castOf 保留）");
{
  ok(appSrc.indexOf('h === "#/maincast"') < 0, "B1 路由 #/maincast 已删除", "B");
  ok(!/function renderMainCastPage/.test(appSrc), "B2 renderMainCastPage 已删除", "B");
  ok(!/function castEntryHtml/.test(appSrc) && !/function openCastSheet/.test(appSrc),
    "B3 选角入口卡 / 自绘面板函数已删除", "B");
  ok(appSrc.indexOf("cast-sheet") < 0 && appSrc.indexOf("cast-opt") < 0 && appSrc.indexOf("cast-pick") < 0,
    "B4 选角 DOM 类名已无残留", "B");
  ok(/castName/.test(appSrc), "B5 名牌层仍渲染 m.castName（共享 renderTalkPage 保留）", "B");
  ok(/spiritThumbCgHtml/.test(appSrc), "B6 spiritThumbCgHtml 仍在（沁灵卡片在用）", "B");
  ok(/setMainStory/.test(appSrc), "B7 ⛔ #/mainstory 的 setMainStory 未被动过（mainIds 归它管）", "B");
  // CSS 类名保留（无害历史样式），只锁「app.js 不再挂这些钩子」
  const castCss = (cssAll.match(/[^\n}]*cast[^\n]*/g) || []).join("\n");
  ok(/cast-auto-tag[\s\S]{0,240}?display:\s*none/.test(cssAll) ||
     /display:\s*none[\s\S]{0,160}?cast-auto-tag/.test(cssAll),
    "B8 ⛔ 互斥保险：.cast-auto-tag 有 display:none 兜底（CSS 仍留）", "B");
  ok(castCss.indexOf(".cast-head") >= 0, "B9 CSS 仍含 .cast-head（历史样式保留，⛔ 不动 CSS）", "B");
}

/* ---------- 汇总 ---------- */
console.log("\n----------------------------------------");
console.log("阶段一（引擎/数据层）：通过 " + PA + " 项，失败 " + FA + " 项");
console.log("阶段二（界面层挂点）：通过 " + PB + " 项，失败 " + FB + " 项");
console.log("合计：通过 " + (PA + PB) + " 项，失败 " + (FA + FB) + " 项" +
  (process.env.SPIRITS_SRC || process.env.APP_SRC_FILE ? "（负向对照）" : ""));
if (FAILS.length) {
  console.log("失败清单：");
  FAILS.forEach((f) => console.log("  - " + f));
}
process.exit(FA + FB ? 1 : 0);
