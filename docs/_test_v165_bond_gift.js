/* v165：亲密度（羁绊八档）+ 称呼 + 送礼 + 心迹 + 受伤 —— 数据层与纯函数自测
   覆盖（对应 docs/v165-亲密度与送礼系统设计.md §七-20）：
     T4 八档映射边界（0/11/12/29/30/54/55/89/90/139/140/199/200/279/280）
     称呼四档回落链（lovecall 优先 / {nick} 未填回落「你」 / 高阶不回落「主人」）
     T1 送礼判重 · T2 同一只当日上限 · 全局当日上限 · 资格锁 · 无库存 · 幂等
     新字段默认值 · 心迹轨 · harmed 读取
     T5 旧档（6 档时期数据）读入不报错且行为确定
     T6 marks 不受影响（本系统字段零进 marks；pruneForQuota 不裁礼物/心意字段）
     db.js：mergeGiftStores（按 giftKey 取 max）+ gift_store 读写函数存在
   纪律：本文件在「改动前源码」上必须 FAIL（负向对照），改动后全绿 —— 见交付报告。 */
"use strict";
const fs = require("fs"), path = require("path");
const H = require("./_harness.js");
let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }

function newSpirits() {
  const c = H.makeContext(); H.loadFile(c.ctx, "js/spirits.js");
  return { S: c.sandbox.Spirits, c: c };
}

/* ============ 1. 八档映射边界 ============ */
section("1. 八档映射边界（照面0/眼熟12/相熟30/同室55/通意90/同心140/相知200/沁透280）");
{
  const { S } = newSpirits();
  ok(Array.isArray(S.BOND_LEVELS) && S.BOND_LEVELS.length === 8, "BOND_LEVELS 为 8 档");
  const bounds = [
    [0, "照面", 1], [11, "照面", 1], [12, "眼熟", 2], [29, "眼熟", 2],
    [30, "相熟", 3], [54, "相熟", 3], [55, "同室", 4], [89, "同室", 4],
    [90, "通意", 5], [139, "通意", 5], [140, "同心", 6], [199, "同心", 6],
    [200, "相知", 7], [279, "相知", 7], [280, "沁透", 8],
  ];
  bounds.forEach(([n, name, lv1]) => {
    const b = S.bondLevel(n);
    ok(b.name === name && b.lv1 === lv1, "bond=" + n + " → 档" + lv1 + "「" + name + "」（实得 " + b.lv1 + "「" + b.name + "」）");
  });
  // 阈值单调递增（升级回归断言）
  let mono = true;
  for (let i = 1; i < S.BOND_LEVELS.length; i++) if (!(S.BOND_LEVELS[i].n > S.BOND_LEVELS[i - 1].n)) mono = false;
  ok(mono, "BOND_LEVELS 阈值严格单调递增");
  // 每档都有 name/icon
  ok(S.BOND_LEVELS.every((l) => l.name && l.icon), "8 档皆有 name/icon");
  // 岁除滋养贡献（v165 §5.2 表②）
  const val = [0, 8, 18, 30, 46, 64, 86, 110];
  let valOk = true;
  for (let i = 0; i < 8; i++) if (S.nurtureOf({ bond: S.BOND_LEVELS[i].n }) !== val[i]) valOk = false;
  ok(valOk, "nurtureOf 逐档 = 0/8/18/30/46/64/86/110");
}

/* ============ 2. 称呼四档回落链 ============ */
section("2. 称呼四档回落链（lovecall 优先 / nick 未填回落「你」/ 高阶不回落「主人」）");
{
  const { S, c } = newSpirits();
  c.store.setItem("ww_owner", JSON.stringify({ name: "小北", gender: "girl" }));
  ok(S.callFor({ bond: 0 }) === "主人", "档1 照面 → 主人");
  ok(S.callFor({ bond: 30 }) === "主人", "档3 相熟 → 主人");
  ok(S.callFor({ bond: 55 }) === "你", "档4 同室 → 你");
  ok(S.callFor({ bond: 140 }) === "你", "档6 同心 → 你");
  // 档7/8：逐串 nickCall 优先
  ok(S.callFor({ bond: 200, nickCall: "阿照" }) === "阿照", "档7 + rec.nickCall → 阿照");
  // 档7/8：逐串无 nickCall → 全局玩家昵称
  ok(S.callFor({ bond: 200 }, "小北") === "小北", "档7 + 参数昵称 → 小北");
  ok(S.callFor({ bond: 280 }) === "小北", "档8 + ww_owner.name → 小北");
  // lovecall 最高优先（哪怕低档位）
  ok(S.callFor({ bond: 0, lovecall: "当家的" }) === "当家的", "lovecall 覆盖一切（含低档）");
  ok(S.callFor({ bond: 200, nickCall: "阿照", lovecall: "哥哥" }) === "哥哥", "lovecall 优先于 nickCall");

  // 未填昵称的回落：新上下文，ww_owner 为空
  const { S: S2 } = newSpirits();
  ok(S2.callFor({ bond: 200 }) === "你", "档7 无 nickCall / 无玩家昵称 → 你");
  ok(S2.callFor({ bond: 280 }) === "你", "档8 无昵称 → 你");
  ok(S2.callFor({ bond: 280 }) !== "主人", "⛔ 高阶绝不回落「主人」");
}

/* ============ 3. giveGift ============ */
section("3. giveGift（+4/+6 · 判重 · 日限 · 资格 · 库存 · 幂等）");
{
  const { S } = newSpirits();
  // 资格：bond=30 → 档3 达标；gentle → soft → cloth（命中）
  const gifts = { cloth_pa: 3, sound_bell: 2, ware_cup: 2, human_tea: 5 };
  const r = { bond: 30, look: { pers: "gentle" } };
  const g1 = S.giveGift(gifts, r, "cloth_pa", { dayKey: "2026-10-03" });
  ok(g1.ok && g1.delta === 6 && g1.hit === true, "命中偏好 → +6");
  ok(gifts.cloth_pa === 2, "命中后库存 -1（3→2）");
  ok(r.giftLog.cloth_pa === "2026-10-03" && r.giftDay === "2026-10-03" && r.giftTotal === 1, "写账 giftLog/giftDay/giftTotal");
  ok(r.bond === 36, "bond 30 → 36");

  // T1 判重：同一礼物对同一只终身 1 次（换日也不行）→ 不扣物、不加分
  const b0 = r.bond, inv0 = gifts.cloth_pa;
  const g2 = S.giveGift(gifts, r, "cloth_pa", { dayKey: "2026-10-09" });
  ok(!g2.ok && g2.reason === "dup" && r.bond === b0 && gifts.cloth_pa === inv0, "判重：dup 且不扣物不加分");

  // T2 同一只当日上限（≤1）
  const g3 = S.giveGift(gifts, r, "sound_bell", { dayKey: "2026-10-03" });
  ok(!g3.ok && g3.reason === "day_per", "同一只当日第 2 件 → day_per");

  // 次日可送：换一件（sound vs cloth 未命中）→ +4
  const g4 = S.giveGift(gifts, r, "sound_bell", { dayKey: "2026-10-04" });
  ok(g4.ok && g4.delta === 4 && g4.hit === false, "未命中 → +4");

  // 全局当日上限（≤2）
  const r2 = { bond: 200, look: { pers: "cool" } };   // cool → plain → ware（命中）
  const g5 = S.giveGift(gifts, r2, "ware_cup", { dayKey: "2026-10-06", globalGiven: 2 });
  ok(!g5.ok && g5.reason === "day_global" && gifts.ware_cup === 2, "全局当日已满 → day_global 且不扣物");

  // 无库存
  const g6 = S.giveGift({}, r2, "ware_cup", { dayKey: "2026-10-06", globalGiven: 0 });
  ok(!g6.ok && g6.reason === "no_stock", "无库存 → no_stock");

  // 资格锁：bond < 30
  const r3 = { bond: 12, look: { pers: "gentle" } };
  const g7 = S.giveGift({ cloth_pa: 1 }, r3, "cloth_pa", { dayKey: "2026-10-06", globalGiven: 0 });
  ok(!g7.ok && g7.reason === "locked" && r3.bond === 12, "未达资格（档3）→ locked 且不加分不扣物");

  // human 通用类：任何人格都 +4，不算命中（不偏不倚）
  const r4 = { bond: 90, look: { pers: "wild" } };    // wild → wild → tough
  const g8 = S.giveGift({ human_tea: 1 }, r4, "human_tea", { dayKey: "2026-10-07" });
  ok(g8.ok && g8.delta === 4 && g8.hit === false, "human 通用类 → 恒 +4（不命中）");

  // 未知礼物：不消耗不加分
  const g9 = S.giveGift({ ghost: 1 }, { bond: 90 }, "ghost", { dayKey: "2026-10-07" });
  ok(!g9.ok && g9.reason === "no_gift", "未知礼物 → no_gift");

  // 幂等 / 可重入：连续同参两次，第二次 no-op
  const gifts9 = { odd_glass: 2 }, r9 = { bond: 55, look: { pers: "mystery" } };   // mystery → odd → odd（命中）
  const a1 = S.giveGift(gifts9, r9, "odd_glass", { dayKey: "2026-10-08" });
  const a2 = S.giveGift(gifts9, r9, "odd_glass", { dayKey: "2026-10-08" });
  ok(a1.ok && a1.delta === 6 && !a2.ok && gifts9.odd_glass === 1 && r9.giftTotal === 1, "幂等：第二次不重复扣物/加分");

  // 库存耗尽（正好 1 件）
  const giftsB = { tough_rope: 1 }, rB = { bond: 55, look: { pers: "wild" } };
  const c1 = S.giveGift(giftsB, rB, "tough_rope", { dayKey: "2026-10-10" });
  const c2 = S.giveGift(giftsB, rB, "tough_whet", { dayKey: "2026-10-11" });
  ok(c1.ok && c1.delta === 6 && giftsB.tough_rope === 0, "命中 +6，库存归零");
  ok(!c2.ok && c2.reason === "no_stock", "耗尽后再送同类 → no_stock");
}

/* ============ 4. 新字段默认值 / 心迹 / harmed ============ */
section("4. 新字段默认值 · 心迹轨 · harmed 读取");
{
  const { S } = newSpirits();
  const store = S.load();
  const rec = S.ensureIn(store, "x1");
  const need = ["giftLog", "giftDay", "giftTotal", "heart", "heartAt", "heartLog",
    "loveLine", "lovecall", "lovecallOn", "nickCall", "trinket", "bondLvSeen", "harmed", "harmCause"];
  need.forEach((k) => ok(rec[k] !== undefined, "默认字段存在：" + k));
  ok(rec.giftLog && typeof rec.giftLog === "object" && Object.keys(rec.giftLog).length === 0, "giftLog 默认 {}");
  ok(rec.heartLog && typeof rec.heartLog === "object", "heartLog 默认 {}");
  ok(rec.heart === 0 && rec.loveLine === false && rec.harmed === false && rec.bondLvSeen === 1, "标量默认 heart=0/loveLine=false/harmed=false/bondLvSeen=1");
  ok(rec.giftDay === "" && rec.lovecall === "" && rec.harmCause === "", "字符串默认空串");

  // 心迹轨
  ok(S.heartLevel(0).lv1 === 1 && S.heartLevel(40).lv1 === 2 && S.heartLevel(300).atMax === true, "heartLevel 里程碑 0/40/…/300");
  ok(S.addHeart(rec, 500) === 300 && rec.heart === 300, "addHeart 封顶 300");
  ok(S.addHeart(rec, -999) >= 0, "addHeart 不越下界（负向夹取）");

  // harmed 读取 / 字段级写入
  ok(S.harmedOf({ harmed: true, harmCause: "掠客" }).harmed === true && S.harmedOf({ harmed: true, harmCause: "掠客" }).harmCause === "掠客", "harmedOf 读取");
  ok(S.harmedOf({}).harmed === false && S.harmedOf({}).harmCause === "", "harmedOf 缺省 false");
  const hr = {}; S.setHarmed(hr, true, "星月·并团");
  ok(hr.harmed === true && hr.harmCause === "星月·并团", "setHarmed 写入");
  S.setHarmed(hr, false);
  ok(hr.harmed === false && hr.harmCause === "", "setHarmed 清除同时清因");
}

/* ============ 5. 旧档（6 档时期）兼容 ============ */
section("5. 旧档 6 档数据读入：不报错 + 行为确定");
{
  const { S, c } = newSpirits();
  // 模拟旧档：无任何 v165 新字段；bond=60（旧「通意」，新属「同室」）
  const old = { s1: { stage: 3, bond: 60, gender: "boy", look: { pers: "cool" } } };
  c.store.setItem("ww_spirits", JSON.stringify(old));
  const store = S.load();
  const rec = S.ensureIn(store, "s1");
  ok(rec.bond === 60, "旧档 bond 绝对值不变（60）");
  ok(rec.giftLog && typeof rec.giftLog === "object" && rec.heart === 0 && rec.harmed === false, "旧档被补出 v165 默认字段");
  ok(S.bondLevel(60).lv1 === 4 && S.bondLevel(60).name === "同室", "旧档 bond=60 现属档4「同室」（跳档，但确定）");
  ok(S.callFor(rec) === "你", "旧档 bond=60 称呼 = 你（非旧「主人」）");
  let threw = false;
  try { S.callFor(rec); S.giftPrefOf(rec); S.nurtureOf(rec); S.giveGift({}, rec, "cloth_pa", {}); S.heartLevel(rec.heart); S.harmedOf(rec); }
  catch (e) { threw = true; }
  ok(!threw, "旧档下全部新函数不抛异常");
}

/* ============ 6. marks 不受影响 ============ */
section("6. marks 不受影响（本系统字段零进 marks；prune 不裁礼物/心意）");
{
  const { S } = newSpirits();
  const r = { bond: 30, look: { pers: "gentle" }, marks: { c1_a: "2026-01-01" } };
  S.giveGift({ cloth_pa: 1 }, r, "cloth_pa", { dayKey: "2026-10-03" });
  ok(Object.keys(r.marks).length === 1 && r.marks.c1_a === "2026-01-01", "giveGift 零进 rec.marks");
  const o = { s1: { giftLog: { a: "2026-01-01" }, giftTotal: 2, heart: 10, heartLog: { m: "2026-01-01" },
    marks: { c1: "1", c2: "2", c3: "3", c4: "4", c5: "5", c6: "6" } } };
  S.pruneForQuota(o);
  ok(Object.keys(o.s1.giftLog).length === 1 && o.s1.giftTotal === 2 && o.s1.heart === 10 && Object.keys(o.s1.heartLog).length === 1,
    "pruneForQuota 不裁礼物/心意字段");
  ok(Object.keys(o.s1.marks).length <= 5, "pruneForQuota 仍按旧规则裁 marks（≤5）");
}

/* ============ 7. db.js：gift_store 形态 ============ */
section("7. db.js：mergeGiftStores（按 giftKey 取 max）+ gift_store 读写函数存在");
{
  const c = H.makeContext();
  H.loadFile(c.ctx, "js/config.js");
  H.loadFile(c.ctx, "js/db.js");
  const DB = c.sandbox.DB;
  ok(DB && typeof DB.getGiftStore === "function" && typeof DB.putGiftStore === "function", "DB.getGiftStore / putGiftStore 存在");
  ok(typeof DB.mergeGiftStores === "function", "DB.mergeGiftStores 存在");
  if (typeof DB.mergeGiftStores === "function") {
    const A = { v: 1, gifts: { cloth_pa: 1, human_tea: 3 }, gifted: { fest_x: "2026-01-01" }, at: 100 };
    const B = { v: 1, gifts: { cloth_pa: 4, odd_shell: 2 }, gifted: { fest_x: "2026-02-01", town_y: "2026-02-02" }, at: 200 };
    const m = DB.mergeGiftStores(A, B);
    ok(m.gifts.cloth_pa === 4 && m.gifts.human_tea === 3 && m.gifts.odd_shell === 2, "合并：gifts 按 giftKey 取 max（不丢数）");
    ok(m.gifted.fest_x === "2026-02-01" && m.gifted.town_y === "2026-02-02", "合并：gifted 取较新日期");
    ok(m.at === 200, "合并：at 取较大时间戳");
    ok(A.gifts.cloth_pa === 1, "合并：不改入参");
  }
}

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
