/* V174-C 批1 · 事件分级 / 分页 / 未读 / 画册三册聚合（数据层）自测
 * ===========================================================================
 * 覆盖主理人派单 6 项：
 *   ① EVENT_LEVEL 覆盖全部已知 type，未知 type 回落 l1
 *   ② recordEvent 不传新字段 ⇒ 向后兼容（level=l1 / go=null / iconKey=""）
 *   ③ 传 level:"l3" ⇒ 落库 l3
 *   ④ allEvents(items, store)（不传 opts）与 opts {offset:0, limit:∞} 一致
 *   ⑤ 分页 limit 30 / offset 0·30·60 ⇒ 拼接不重不漏、条数 === total
 *   ⑥ type 过滤：fest 只出 fest；story 出 milestone+chapter
 *   ⑦ unreadEventCount 边界：seenAt=0 ⇒ 总数；seenAt=now ⇒ 0
 *   ⑧ festCgsOf(rec) 取 rec.fests[*].cgUrl，空的不计入
 *   + 附加：markEventsSeen / albumAll3 三册计数 / 老档无 level 时的现算回落 / chip 表完整性
 *
 * 用法：
 *   node docs/_test_v174_events_data.js
 *   SPIRITS_SRC=<abs path to 03c473c 的 spirits.js> node docs/_test_v174_events_data.js   # 负向对照（必须 FAIL）
 *   生成基线： git show 03c473c:js/spirits.js > "$TMP/spirits_03c473c.js"
 * 退出码 0 = 全通过；非 0 = 有断言失败。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const SRC = process.env.SPIRITS_SRC || "js/spirits.js";
const SRC_PATH = path.isAbsolute(SRC) ? SRC : path.join(ROOT, SRC);

let PASS = 0, FAIL = 0;
const FAILS = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILS.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }
function newS() {
  const c = H.makeContext();
  vm.runInContext(fs.readFileSync(SRC_PATH, "utf8"), c.ctx, { filename: SRC });
  return { S: c.sandbox.Spirits, c: c };
}
// 负向对照兜底：老基线没有这些导出时不崩，让断言如实 FAIL
function fn(S, name) {
  return typeof S[name] === "function" ? S[name] : function () { return undefined; };
}
function withDefault(obj, key, val) { return (obj && obj[key] !== undefined) ? obj[key] : val; }
// 负向对照下这些函数返回 undefined ⇒ 用安全取值避免崩栈（要的是完整失败清单，不是堆栈）
function arrOf(v) { return Array.isArray(v) ? v : []; }
function objOf(v) { return (v && typeof v === "object") ? v : {}; }

const ITEMS = [{ id: "i1", name: "老檀" }, { id: "i2", name: "阿青" }];
function mkStore() {
  return {
    i1: { events: [] },
    i2: { events: [] },
  };
}
// 造 70 条事件：type 循环 5 种，at 递增（⛔ 绕过 recordEvent，测 allEvents 的纯读路径）
function seedRows(n) {
  const types = ["fest", "chapter", "bond", "night", "gift"];
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: "e" + i, type: types[i % types.length], at: 1000 + i, title: "T" + i, summary: "S" + i, icon: "", linked: ["i1"] });
  }
  // 补一条 milestone，让 story chip 覆盖 milestone+chapter 两类
  arr.push({ id: "ms1", type: "milestone", at: 5000, title: "挂瓷开沁", summary: "", icon: "", linked: ["i1"] });
  return arr;
}

/* ===================== ① EVENT_LEVEL ===================== */
section("① EVENT_LEVEL：覆盖全部已知 type + 未知回落 l1");
{
  const { S } = newS();
  ok(!!S.EVENT_LEVEL && typeof S.EVENT_LEVEL === "object", "EVENT_LEVEL 导出");
  const known = { milestone: "l3", fest: "l3", chapter: "l2", night: "l2", bond: "l2", gift: "l1", quest: "l1", diary: "l1" };
  Object.keys(known).forEach((k) => {
    ok(withDefault(S.EVENT_LEVEL, k, null) === known[k], "EVENT_LEVEL." + k + " === " + known[k] + "（实得 " + withDefault(S.EVENT_LEVEL, k, null) + "）");
  });
  ok(fn(S, "eventLevelOf")("milestone") === "l3", "eventLevelOf(milestone) === l3");
  ok(fn(S, "eventLevelOf")("gift") === "l1", "eventLevelOf(gift) === l1");
  ok(fn(S, "eventLevelOf")("zzz_unknown") === "l1", "★ 未知 type 回落 l1（实得 " + fn(S, "eventLevelOf")("zzz_unknown") + "）");
  ok(fn(S, "eventLevelOf")("") === "l1", "空 type 回落 l1");
  ok(fn(S, "eventLevelOf")(null) === "l1", "null type 回落 l1");
  // chip 分组表（UI 不硬编码）
  ok(S.EVENT_CHIP && JSON.stringify(S.EVENT_CHIP.story) === JSON.stringify(["milestone", "chapter"]),
    "EVENT_CHIP.story === [milestone, chapter]（实得 " + JSON.stringify(S.EVENT_CHIP && S.EVENT_CHIP.story) + "）");
  ok(S.EVENT_CHIP && JSON.stringify(S.EVENT_CHIP.fest) === JSON.stringify(["fest"]), "EVENT_CHIP.fest === [fest]");
  ok(S.EVENT_CHIP && JSON.stringify(S.EVENT_CHIP.bond) === JSON.stringify(["bond"]), "EVENT_CHIP.bond === [bond]");
  ok(S.EVENT_CHIP && JSON.stringify(S.EVENT_CHIP.night) === JSON.stringify(["night"]), "EVENT_CHIP.night === [night]");
  ok(S.EVENT_CHIP && S.EVENT_CHIP.all === null, "EVENT_CHIP.all === null（全部 = 不过滤）");
  ok(JSON.stringify(S.EVENT_CHIP_ORDER) === JSON.stringify(["all", "story", "bond", "fest", "night"]),
    "EVENT_CHIP_ORDER = 5 个 chip 且顺序固定（实得 " + JSON.stringify(S.EVENT_CHIP_ORDER) + "）");
  ok(fn(S, "eventChipOf")("chapter") === "story", "eventChipOf(chapter) === story");
  ok(fn(S, "eventChipOf")("milestone") === "story", "eventChipOf(milestone) === story");
  ok(fn(S, "eventChipOf")("gift") === "", "⛔ gift/quest/diary 未归类 ⇒ 只在「全部」里出现（实得 " + JSON.stringify(fn(S, "eventChipOf")("gift")) + "）");
  ok(S.EVENT_LEVEL_FALLBACK === "l1", "EVENT_LEVEL_FALLBACK === l1");
}

/* ===================== ②③ recordEvent 字段 ===================== */
section("② recordEvent 不传新字段 ⇒ 向后兼容（l1 / null / \"\"）");
{
  const { S } = newS();
  const rec = { events: [] };
  const r = fn(S, "recordEvent")(rec, { type: "gift", title: "递了一件东西", summary: "它收下了", icon: "🎁", linked: ["i1"], at: 1000 });
  ok(r === true, "recordEvent 首次新增返回 true（实得 " + r + "）");
  const e = (rec.events || [])[0] || {};
  ok(e.level === "l1", "★ 不传 level ⇒ 按 type 查表回落 l1（实得 " + JSON.stringify(e.level) + "）");
  ok(e.go === null, "★ 不传 go ⇒ null（实得 " + JSON.stringify(e.go) + "）");
  ok(e.iconKey === "", "★ 不传 iconKey ⇒ ''（实得 " + JSON.stringify(e.iconKey) + "）");
  ok(e.type === "gift" && e.title === "递了一件东西" && e.icon === "🎁", "⛔ 已有字段名/含义未变");
  ok(Array.isArray(e.linked) && e.linked[0] === "i1", "linked 仍在");
  // 未登记 type 也回落 l1
  const rec2 = { events: [] };
  fn(S, "recordEvent")(rec2, { type: "raid", title: "X", summary: "", icon: "", linked: ["i1"], at: 2000 });
  ok((rec2.events[0] || {}).level === "l1", "未登记 type(raid) ⇒ l1（实得 " + JSON.stringify((rec2.events[0] || {}).level) + "）");
  // milestone ⇒ l3
  const rec3 = { events: [] };
  fn(S, "recordEvent")(rec3, { type: "milestone", title: "Y", summary: "", icon: "", linked: ["i1"], at: 3000 });
  ok((rec3.events[0] || {}).level === "l3", "milestone ⇒ l3（实得 " + JSON.stringify((rec3.events[0] || {}).level) + "）");
}
{
  const { S } = newS();
  const rec = { events: [] };
  fn(S, "recordEvent")(rec, { type: "gift", level: "l3", go: "spirit:i1", iconKey: "gift", title: "X", summary: "", icon: "", linked: ["i1"], at: 1000 });
  const e = (rec.events || [])[0] || {};
  ok(e.level === "l3", "★ 传 level:'l3' ⇒ 落库 l3（实得 " + JSON.stringify(e.level) + "）");
  ok(e.go === "spirit:i1", "传 go ⇒ 落库原值（实得 " + JSON.stringify(e.go) + "）");
  ok(e.iconKey === "gift", "传 iconKey ⇒ 落库原值（实得 " + JSON.stringify(e.iconKey) + "）");
  // 去重分支也要刷这三个字段
  fn(S, "recordEvent")(rec, { type: "gift", level: "l2", go: "x", iconKey: "k2", title: "X2", summary: "s2", icon: "", linked: ["i1"], at: 1000 });
  ok(rec.events.length === 1, "同类型同日去重：仍只 1 条（实得 " + rec.events.length + "）");
  ok(rec.events[0].level === "l2" && rec.events[0].go === "x" && rec.events[0].iconKey === "k2", "去重分支同步刷新 level/go/iconKey");
}

/* ===================== ④ 默认路径没被改坏 ===================== */
section("④ allEvents(items, store)（不传 opts）与 opts {offset:0, limit:1e9} 一致");
{
  const { S } = newS();
  const store = mkStore();
  store.i1.events = seedRows(70);
  const a = fn(S, "allEvents")(ITEMS, store);
  const b = fn(S, "allEvents")(ITEMS, store, { offset: 0, limit: 1e9 });
  ok(Array.isArray(a) && a.length === 71, "默认调用返回数组且条数 = 71（实得 " + (a && a.length) + "）");
  ok(JSON.stringify(a) === JSON.stringify(b), "★ 不传 opts 与 {offset:0, limit:1e9} 结果逐字节一致");
  let desc = true;
  for (let i = 1; i < a.length; i++) if ((a[i - 1].at || 0) < (a[i].at || 0)) desc = false;
  ok(desc, "仍是时间倒序（最近的在前）");
  ok(a[0].id === "ms1", "第一条是 at 最大的那条（实得 " + a[0].id + "）");
  ok(a.every((x) => x.ownerId === "i1" && x.ownerName === "老檀"), "ownerId / ownerName 仍在");
  ok(a.every((x) => x.level === "l1" || x.level === "l2" || x.level === "l3"), "老档无 level 字段 ⇒ 现算回落（⛔ 不是 undefined）");
  ok(a.find((x) => x.type === "fest").level === "l3", "老档 fest ⇒ 现算 l3");
  ok(a.find((x) => x.type === "chapter").level === "l2", "老档 chapter ⇒ 现算 l2");
  ok(a.every((x) => x.go === null && x.iconKey === ""), "老档 go=null / iconKey=''");
  ok(a.total === 71, "附带 total === 71（实得 " + a.total + "）");
  ok(a.hasMore === false, "附带 hasMore === false");
}

/* ===================== ⑤ 分页不重不漏 ===================== */
section("⑤ 分页：limit 30 · offset 0/30/60 ⇒ 不重不漏、条数与 total 一致");
{
  const { S } = newS();
  const store = mkStore();
  store.i1.events = seedRows(70);
  const total = fn(S, "allEvents")(ITEMS, store).total;
  const p1 = fn(S, "allEvents")(ITEMS, store, { limit: 30, offset: 0 });
  const p2 = fn(S, "allEvents")(ITEMS, store, { limit: 30, offset: 30 });
  const p3 = fn(S, "allEvents")(ITEMS, store, { limit: 30, offset: 60 });
  ok(p1.length === 30, "第 1 页 30 条（实得 " + p1.length + "）");
  ok(p2.length === 30, "第 2 页 30 条（实得 " + p2.length + "）");
  ok(p3.length === 11, "第 3 页 11 条（实得 " + p3.length + "）");
  ok(p1.total === 71 && p2.total === 71 && p3.total === 71, "三页 total 一致 = 71");
  ok(p1.hasMore === true && p2.hasMore === true && p3.hasMore === false, "hasMore：true / true / false");
  const all = p1.concat(p2, p3);
  const ids = all.map((x) => x.id);
  const uniq = ids.filter((v, i) => ids.indexOf(v) === i);
  ok(uniq.length === ids.length, "★ 拼接不重（去重后仍 " + ids.length + " 条，实得唯一 " + uniq.length + "）");
  ok(all.length === total, "★ 拼接条数 === total（" + all.length + " vs " + total + "）");
  ok(JSON.stringify(ids) === JSON.stringify(fn(S, "allEvents")(ITEMS, store).map((x) => x.id)), "★ 分页拼接顺序 === 全量顺序（不漏不错位）");
  const pEmpty = fn(S, "allEvents")(ITEMS, store, { limit: 30, offset: 999 });
  ok(pEmpty.length === 0 && pEmpty.hasMore === false, "越界 offset ⇒ 空页 + hasMore=false");
}

/* ===================== ⑥ type 过滤 ===================== */
section("⑥ type 过滤：fest 只出 fest；story 出 milestone+chapter");
{
  const { S } = newS();
  const store = mkStore();
  store.i1.events = seedRows(70);
  const fest = fn(S, "allEvents")(ITEMS, store, { type: "fest" });
  ok(fest.length > 0, "fest 非空（实得 " + fest.length + "）");
  ok(fest.every((x) => x.type === "fest"), "★ type:'fest' 只出 fest");
  ok(fest.total === fest.length, "fest.total === fest 条数");
  const story = fn(S, "allEvents")(ITEMS, store, { type: "story" });
  ok(story.length > 0, "story 非空（实得 " + story.length + "）");
  ok(story.every((x) => x.type === "milestone" || x.type === "chapter"), "★ type:'story' 只出 milestone+chapter");
  ok(story.some((x) => x.type === "milestone") && story.some((x) => x.type === "chapter"), "story 同时覆盖 milestone 与 chapter");
  const all = fn(S, "allEvents")(ITEMS, store, { type: "all" });
  ok(all.total === 71, "type:'all' === 不过滤（71）");
  const bond = fn(S, "allEvents")(ITEMS, store, { type: "bond" });
  ok(bond.every((x) => x.type === "bond") && bond.length > 0, "type:'bond' 只出 bond");
  const night = fn(S, "allEvents")(ITEMS, store, { type: "night" });
  ok(night.every((x) => x.type === "night") && night.length > 0, "type:'night' 只出 night");
  // 原始 type 精确匹配也支持（UI 传 chip，调试面板可传原始 type）
  const raw = fn(S, "allEvents")(ITEMS, store, { type: "gift" });
  ok(raw.every((x) => x.type === "gift") && raw.length > 0, "原始 type（gift）精确匹配");
  // 过滤 + 分页组合：总数按筛选算
  const f2 = fn(S, "allEvents")(ITEMS, store, { type: "fest", limit: 5, offset: 0 });
  ok(f2.length === 5 && f2.total === fest.length && f2.hasMore === true, "筛选 + 分页：total 用筛选后的总数（实得 " + f2.total + " vs " + fest.length + "）");
}

/* ===================== ⑦ 未读 ===================== */
section("⑦ unreadEventCount 边界 + markEventsSeen");
{
  const { S, c } = newS();
  const store = mkStore();
  store.i1.events = seedRows(70);
  store.i2.events = [{ id: "x1", type: "diary", at: 9000, title: "T", summary: "", icon: "", linked: ["i2"] }];
  const total = 72;
  ok(fn(S, "unreadEventCount")(ITEMS, store, 0) === total, "★ seenAt=0 ⇒ 等于总数（实得 " + fn(S, "unreadEventCount")(ITEMS, store, 0) + "，应 " + total + "）");
  ok(fn(S, "unreadEventCount")(ITEMS, store, Date.now() + 1e9) === 0, "★ seenAt=now(未来) ⇒ 0");
  ok(fn(S, "unreadEventCount")(ITEMS, store, 1000) === 71, "seenAt=1000 ⇒ 只剩 at>1000 的 71 条（实得 " + fn(S, "unreadEventCount")(ITEMS, store, 1000) + "）");
  ok(fn(S, "unreadEventCount")([], {}, 0) === 0, "空 items ⇒ 0");
  ok(fn(S, "unreadEventCount")(ITEMS, {}, 0) === 0, "空 store ⇒ 0");
  // 缺省走向 ww_ev_seen
  ok(S.EV_SEEN_KEY === "ww_ev_seen", "EV_SEEN_KEY === ww_ev_seen（⛔ 不是新造名字，实得 " + JSON.stringify(S.EV_SEEN_KEY) + "）");
  ok(fn(S, "evSeenAt")() === 0, "初始 evSeenAt() === 0");
  const t = 1000;
  fn(S, "markEventsSeen")(t);
  ok(c.store.getItem("ww_ev_seen") === String(t), "markEventsSeen(ts) ⇒ 落 ww_ev_seen 整数（实得 " + JSON.stringify(c.store.getItem("ww_ev_seen")) + "）");
  ok(fn(S, "evSeenAt")() === t, "回读 evSeenAt() === " + t);
  ok(fn(S, "unreadEventCount")(ITEMS, store) === 71, "★ 缺省 seenAt 走 ww_ev_seen ⇒ === 71（实得 " + fn(S, "unreadEventCount")(ITEMS, store) + "）");
  ok(!/^\d+\./.test(String(c.store.getItem("ww_ev_seen"))), "存的是整数不是浮点");
  // ⛔ 只读：不该动 rec.events
  ok(store.i1.events.length === 71 && store.i2.events.length === 1, "⛔ unreadEventCount 不修改 rec.events");
}

/* ===================== ⑧ 画册三册 ===================== */
section("⑧ festCgsOf / albumMain / albumAdv / albumAll3");
{
  const { S } = newS();
  const rec = {
    cgs: {
      "0": { hasImg: true, at: 100, thumb: "m0.jpg", title: "第一章" },
      "1": { hasImg: true, at: 200, thumb: "m1.jpg", title: "第二章" },
      "adv#2": { hasImg: true, at: 300, thumb: "a2.jpg", title: "进阶·蜕形" },
      "adv#3": { hasImg: false, at: 400, thumb: "a3.jpg" },
    },
    fests: {
      "2026-01-01": { at: 500, key: "yuandan", name: "元旦", date: "2026-01-01", text: "过了一年", cgUrl: "f1.jpg" },
      "2026-06-20": { at: 600, key: "xiazhi", name: "夏至", date: "2026-06-20", text: "日长", cgUrl: "" },
    },
    cgUrl: "a2.jpg",
  };
  const fm = arrOf(fn(S, "festCgsOf")(rec));
  ok(fm.length === 1, "★ festCgsOf 只计 cgUrl 非空的那条（实得 " + fm.length + "）");
  ok((fm[0] || {}).url === "f1.jpg", "节令行 url === cgUrl（实得 " + JSON.stringify((fm[0] || {}).url) + "）");
  ok((fm[0] || {}).title === "元旦", "节令行 title === 节令名");
  ok((fm[0] || {}).key === "2026-01-01", "节令行 key === date");
  ok(typeof (fm[0] || {}).at === "number", "节令行 at 是数字");

  const am = arrOf(fn(S, "albumMain")(rec));
  ok(am.length === 2, "albumMain 2 张（实得 " + am.length + "）");
  ok(am.every((r) => !String(r.key).startsWith("adv#")), "⛔ albumMain 不含 adv# 前缀");
  const aa = arrOf(fn(S, "albumAdv")(rec));
  ok(aa.length === 1 && (aa[0] || {}).key === "adv#2", "albumAdv 只计 hasImg 的 adv#（实得 " + JSON.stringify(aa.map((r) => r.key)) + "）");

  const store = { i1: rec, i2: { events: [] } };
  const all3 = objOf(fn(S, "albumAll3")(ITEMS, store));
  const A3 = { main: arrOf(all3.main), adv: arrOf(all3.adv), fest: arrOf(all3.fest) };
  const C3 = objOf(all3.counts);
  ok(!!all3.counts, "albumAll3 返回 {main, adv, fest, counts}");
  ok(A3.main.length === 2 && A3.adv.length === 1 && A3.fest.length === 1, "三册各自条数 2/1/1（实得 " +
    A3.main.length + "/" + A3.adv.length + "/" + A3.fest.length + "）");
  ok(C3.main === 2 && C3.adv === 1 && C3.fest === 1 && C3.all === 4,
    "counts = {main:2, adv:1, fest:1, all:4}（实得 " + JSON.stringify(all3.counts) + "）");
  ok(A3.main.every((r) => r.ownerId === "i1" && r.ownerName === "老檀"), "行上带 ownerId / ownerName（用 item.name）");
  const coverRow = A3.adv.filter((r) => r.isCover);
  ok(coverRow.length === 1 && coverRow[0].url === "a2.jpg", "★ isCover 命中 rec.cgUrl 那一张（实得 " + JSON.stringify(coverRow.map((r) => r.url)) + "）");
  ok(A3.main.every((r) => r.isCover === false), "其余册不误标 isCover");
  ok(!all3.duo, "⛔ 本文件不出「双人册」（双人册由 app.js 侧用 Rooms 合并）");
  ok(JSON.stringify(Object.keys(all3).sort()) === JSON.stringify(["adv", "counts", "fest", "main"]),
    "albumAll3 只有 main / adv / fest / counts 四个键（实得 " + JSON.stringify(Object.keys(all3).sort()) + "）");
}

/* ===================== 附加：三条既有事件调用点仍然跑得通 ===================== */
section("附加 · 既有事件调用点兼容（fest / chapter / night 传法不变）");
{
  const { S } = newS();
  const rec = { events: [] };
  fn(S, "recordEvent")(rec, { type: "fest", title: "元旦", summary: "今天过节，说了一句只属于这天的话", linked: ["i1"], at: 1000, icon: "🎋" });
  fn(S, "recordEvent")(rec, { type: "chapter", title: "读完「来客」", summary: "串与你的故事又往前走了一步", linked: ["?"], at: 2000, icon: "📜" });
  fn(S, "recordEvent")(rec, { type: "night", title: "夜话", summary: "聊出个结果", linked: ["i1", "i2"], at: 3000, icon: "📱" });
  ok(rec.events.length === 3, "三条都落库（实得 " + rec.events.length + "）");
  ok(rec.events[0].level === "l3" && rec.events[1].level === "l2" && rec.events[2].level === "l2",
    "★ 级别按表：fest=l3 / chapter=l2 / night=l2（实得 " + rec.events.map((e) => e.level).join(",") + "）");
  ok(rec.events[2].linked.length === 2, "night 的 linked 多元素仍保留");
}

/* ---------- 汇总 ---------- */
console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项" + (process.env.SPIRITS_SRC ? "（负向对照）" : ""));
if (FAILS.length) { console.log("失败清单："); FAILS.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
