/* v165 每日任务改造 · 自测
   覆盖（对应 docs/v165-每日任务改造设计.md §七-11）：
     T1 每日恰好 5 条、全为菩提根（池内 0 他类别词）、礼物 key/类合法
     T2 领奖「只加礼物、不加亲密度」（⛔ 不调 addBond/giveGift）
     T3 跨日重置（清 acts/claimed/tasks，保留 days；⛔ 不补做）
     T4 gift_store 的 daily 合并不丢（取较新 day / 同 day acts max、claimed or；老数据无 daily 不报错）
     T5 不可重复领（claimed 去重）+ 未完成不可领
   纪律：本文件在「改动前源码」上必须 FAIL（负向对照），改动后全绿。 */
"use strict";
const H = require("./_harness.js");
let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }

// 新上下文：先 spirits.js（提供 GIFT_CATALOG / loadGifts / addGift），再 game.js
function newGame() {
  const c = H.makeContext();
  H.loadFile(c.ctx, "js/spirits.js");
  H.loadFile(c.ctx, "js/game.js");
  return { c: c, S: c.sandbox.Spirits, G: c.sandbox.Game };
}
const OTHER_WORDS = /水晶|玉石|金刚|凤眼|星月|拼图|周边|盲盒|金属|钻石|玛瑙|翡翠|宝石|黄金|蜜蜡|南红/;

/* ============ T1 每日 5 条 · 全为菩提根 ============ */
section("T1 每日恰好 5 条 · 全为菩提根（池内 0 他类别词）");
{
  const { S, G } = newGame();
  const tasks = G.dailyTasks([]);
  ok(Array.isArray(tasks) && tasks.length === 5, "每日恰好 5 条（⛔ 不多不少）");
  const titles = tasks.map((t) => t.title).sort().join("/");
  ok(titles === ["净手", "陪坐", "看纹", "守灯", "应声"].sort().join("/"), "5 条 = 净手/陪坐/看纹/守灯/应声（实得 " + titles + "）");
  const blob = tasks.map((t) => (t.title + " " + t.desc)).join(" ");
  const hit = OTHER_WORDS.exec(blob);
  ok(!hit, "池内 0 处非菩提根类别词" + (hit ? "（命中：" + hit[0] + "）" : ""));
  // 每条礼物 key/类合法
  let giftOk = true, giftNameOk = true, toughSeen = false;
  tasks.forEach((t) => {
    if (!S.GIFT_CATALOG[t.giftKey]) giftOk = false;
    if (!t.giftName || t.giftName !== S.giftNameOf(t.giftKey)) giftNameOk = false;
    if (S.giftClsOf(t.giftKey) === "tough") toughSeen = true;
  });
  ok(giftOk, "每条 giftKey 均在 GIFT_CATALOG 内");
  ok(giftNameOk, "每条 giftName = 正式物名");
  ok(!toughSeen, "⛔ 坚韧类不出现在每日任务");
  ok(tasks.every((t) => t.done === false), "初始全部未完成");
  ok(tasks.every((t) => typeof t.xp === "number"), "保留 xp 字段（向后兼容 app.js）");
  ok(tasks.every((t) => t.icon && t.title && t.desc), "icon/title/desc 齐备（app.js 兼容）");
}

/* ============ T2 领奖只加礼物、不加亲密度 ============ */
section("T2 领奖只加礼物（⛔ 不调 addBond / giveGift）");
{
  const { S, G } = newGame();
  let addBondCalls = 0, giveGiftCalls = 0, addGiftCalls = 0;
  const _addBond = S.addBond, _giveGift = S.giveGift, _addGift = S.addGift;
  S.addBond = function () { addBondCalls++; return _addBond.apply(this, arguments); };
  S.giveGift = function () { giveGiftCalls++; return _giveGift.apply(this, arguments); };
  S.addGift = function () { addGiftCalls++; return _addGift.apply(this, arguments); };
  // 备一只 rec（确认领奖不改它的 bond）
  const store = S.load(); const rec = S.ensureIn(store, "sp1"); rec.bond = 30; S.save(store);

  G.markDaily("greet");                 // 净手 达成
  const tasks = G.dailyTasks([]);
  const t = tasks.filter((x) => x.id === "jingshou")[0];
  ok(t.done === true, "markDaily('greet') 后「净手」done");
  const before = S.loadGifts()[t.giftKey] || 0;
  const r = G.claimTask(t);
  const after = S.loadGifts()[t.giftKey] || 0;
  ok(r.ok && r.giftKey === t.giftKey, "领奖成功，返回当日礼物 key");
  ok(after === before + 1, "ww_gifts 该礼物 +1（" + before + "→" + after + "）");
  ok(addGiftCalls >= 1, "走的是 Spirits.addGift（入库存）");
  ok(addBondCalls === 0 && giveGiftCalls === 0, "🔴 领奖 0 次 addBond / giveGift（不碰亲密度）");
  ok((S.load()["sp1"] || {}).bond === 30, "rec.bond 未被改动（仍 30）");
}

/* ============ T3 跨日重置 ============ */
section("T3 跨日重置（清 acts/claimed/tasks，保留 days；⛔ 不补做）");
{
  const { G } = newGame();
  G.saveDaily({ day: "2000-01-01", acts: { greet: 1, night: 1 }, claimed: { jingshou: "2000-01-01" }, tasks: [{ id: "x" }], days: 7 });
  const tasks = G.dailyTasks([]);
  const d = G.loadDaily();
  ok(d.day === G.todayKey(), "跨日 → day 归位为今天");
  ok(Object.keys(d.acts).length === 0, "跨日 → acts 清空");
  ok(Object.keys(d.claimed).length === 0, "跨日 → claimed 清空");
  ok(Array.isArray(d.tasks) && d.tasks.length === 5, "跨日 → tasks 重建为 5 条");
  ok(d.days === 7, "跨日保留 days 累计（⛔ 不清）");
  ok(tasks.every((t) => !t.done), "跨日 → 全部未完成（⛔ 不补做）");
}

/* ============ T5 不可重复领 + 未完成不可领 ============ */
section("T5 不可重复领 · 未完成不可领");
{
  const { S, G } = newGame();
  G.markDaily("night");                 // 守灯 达成
  const td = G.dailyTasks([]);
  const sd = td.filter((t) => t.id === "shoudeng")[0];
  const before = S.loadGifts()[sd.giftKey] || 0;
  const r1 = G.claimTask(sd);
  const r2 = G.claimTask(sd);
  const after = S.loadGifts()[sd.giftKey] || 0;
  ok(r1.ok, "首次领奖成功");
  ok(!r2.ok && r2.reason === "claimed", "重复领奖 → claimed");
  ok(after === before + 1, "重复领只入账 1 件（" + before + "→" + after + "）");
  const undone = td.filter((t) => !t.done)[0];
  const r3 = G.claimTask(undone);
  ok(!r3.ok && r3.reason === "undone", "未完成不可领 → undone");
}

/* ============ 附加：日期种子候选固定 + greet 双任务 ============ */
section("附加：当日礼物候选固定 · greet 顶替 look 的说明");
{
  const { G } = newGame();
  const a = G.dailyTasks([]), b = G.dailyTasks([]);
  const map = (arr) => { const o = {}; arr.forEach((t) => { o[t.id] = t.giftKey; }); return o; };
  const ma = map(a), mb = map(b);
  ok(Object.keys(ma).every((k) => ma[k] === mb[k]), "同一天两次调用：每条礼物候选一致（当天固定）");
  // greet 同时顶替「净手」与「看纹」的信号 → 二者一起完成（已知取舍，§七-10）
  G.markDaily("greet");
  const td = G.dailyTasks([]);
  ok(td.filter((t) => t.id === "jingshou")[0].done === true && td.filter((t) => t.id === "kanwen")[0].done === true,
    "markDaily('greet') 同时点亮「净手」与「看纹」（look 暂以 greet 顶替）");
  ok(td.filter((t) => t.id === "yingsheng")[0].done === false, "未记的动作键不完成（应声 仍未完成）");
}

/* ============ T4 db.js：daily 合并 ============ */
section("T4 db.js mergeGiftStores 的 daily 合并（不丢 / 老数据不报错）");
{
  const c = H.makeContext();
  H.loadFile(c.ctx, "js/config.js");
  H.loadFile(c.ctx, "js/db.js");
  const DB = c.sandbox.DB;
  ok(typeof DB.mergeGiftStores === "function", "mergeGiftStores 存在");
  const A = { v: 1, gifts: { cloth_pa: 1 }, daily: { day: "2026-10-01", acts: { greet: 1 }, claimed: { jingshou: "2026-10-01" } }, at: 100 };
  const B = { v: 1, gifts: { cloth_pa: 4 }, daily: { day: "2026-10-02", acts: { night: 1 }, claimed: { shoudeng: "2026-10-02" } }, at: 200 };
  const m = DB.mergeGiftStores(A, B);
  ok(m.gifts.cloth_pa === 4, "gifts 仍按 giftKey 取 max");
  ok(m.daily.day === "2026-10-02" && m.daily.acts.night === 1 && !m.daily.acts.greet, "daily 取较新 day 的整份");
  const A2 = { daily: { day: "2026-10-05", acts: { greet: 1 }, claimed: {} } };
  const B2 = { daily: { day: "2026-10-05", acts: { night: 1 }, claimed: { shoudeng: "2026-10-05" } } };
  const m2 = DB.mergeGiftStores(A2, B2);
  ok(m2.daily.acts.greet === 1 && m2.daily.acts.night === 1, "同 day：acts 逐键取 max（并集）");
  ok(m2.daily.claimed.shoudeng === "2026-10-05", "同 day：claimed 逐键取 or");
  let threw = false, m3 = null;
  try { m3 = DB.mergeGiftStores({ gifts: { x: 1 } }, { gifts: { x: 2 } }); } catch (e) { threw = true; }
  ok(!threw && m3 && m3.gifts.x === 2, "老数据无 daily → 不报错");
  ok(m3 && m3.daily && m3.daily.day === "" && Object.keys(m3.daily.acts).length === 0, "老数据无 daily → 给规范默认 {day:'',acts:{},claimed:{}}");
  ok(A.daily.acts.greet === 1 && A2.daily.acts.greet === 1, "合并不改入参");
}

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
