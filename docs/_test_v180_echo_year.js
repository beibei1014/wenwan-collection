/* ============================================================
 * _test_v180_echo_year.js · V180 欠账③ · 回响「天数型周年」归 y 池 + v.year 赋值
 * ------------------------------------------------------------
 * 症状（文成章盘点）：d365/d730/d1095/d1825 归 y 池后，若不给 v.year 赋值，
 *   信里会打出「第  年 / 第 {year} 年」—— 与标题「N 周年」打架。
 * 本测试真跑 Spirits.ensureEcho：
 *   A · 四个周年节点（365/730/1095/1825）⇒ 走 y 池、正文「第 N 年」、标题「N 周年」
 *   B · 非周年池（1/7/30/100）⇒ mkey 正确、无 {year}
 *   C · 全池穷举采样：渲染后无任何未替换占位符 {xxx}
 *
 * 用法： node docs/_test_v180_echo_year.js
 * 负向对照： SP_SRC=docs/_tmp/_pre_v180echo_spirits.js node docs/_test_v180_echo_year.js  ⇒ 必须 FAIL
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeContext, ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const SP_PATH = process.env.SP_SRC ? path.resolve(process.env.SP_SRC) : path.join(ROOT, "js", "spirits.js");
const SP_SRC = fs.readFileSync(SP_PATH, "utf8");
console.log("spirits 源码：" + SP_PATH);

const h = makeContext();
try { vm.runInContext(SP_SRC, h.ctx, { filename: SP_PATH }); } catch (e) { console.log("  ! spirits 加载失败：" + e.message); }
const S = h.sandbox.Spirits || {};

const ITEM = { id: "it_echo", name: "莫高窟", color: "red", species: "玉" };
function mkCtx(days) { return { dayNo: days, plays: 5, idleDays: 0, roomCount: 0 }; }
/* bornAt：取「今天 +6 个月」的月/日 ⇒ 月份必异于今天 ⇒ 不触发日历型 y（只测天数型） */
function bornAtAway() {
  const n = new Date();
  return new Date(2000, (n.getMonth() + 6) % 12, ((n.getDate() % 28) + 1)).getTime();
}
function freshRec() { return { bornAt: bornAtAway(), stage: 1, bond: 0, chapters: {} }; }

ok(typeof S.ensureEcho === "function", "Spirits.ensureEcho 已导出");

/* ================= A · 天数型周年归 y 池 ================= */
section("A · d365/d730/d1095/d1825 ⇒ y 池 + 正文「第 N 年」+ 标题「N 周年」");
[[365, 1], [730, 2], [1095, 3], [1825, 5]].forEach(([d, yr]) => {
  const L = S.ensureEcho(ITEM, freshRec(), mkCtx(d));
  ok(!!L, "days=" + d + " 生成回响");
  if (!L) return;
  ok(L.mkey === "d" + d, "days=" + d + " mkey = d" + d + "（实得 " + L.mkey + "）");
  ok(L.text.indexOf("第 " + yr + " 年") >= 0, "days=" + d + " 正文含「第 " + yr + " 年」");
  ok(L.title.indexOf(yr + " 周年") >= 0, "days=" + d + " 标题含「" + yr + " 周年」（实得 " + L.title + "）");
  ok(L.text.indexOf("{year}") < 0, "days=" + d + " 正文无 {year} 字面残留");
});

/* ================= B · 非周年池不含 {year} ================= */
section("B · 非周年池（1/7/30/100）mkey 正确、无 {year}");
[1, 7, 30, 100].forEach((d) => {
  const L = S.ensureEcho(ITEM, freshRec(), mkCtx(d));
  ok(!!L, "days=" + d + " 生成回响");
  if (!L) return;
  ok(L.mkey === "d" + d, "days=" + d + " mkey = d" + d + "（实得 " + L.mkey + "）");
  ok(L.text.indexOf("{year}") < 0, "days=" + d + " 正文无 {year}");
});

/* ================= C · 全池穷举：无未替换占位符 ================= */
section("C · 八节点 × 多次采样：渲染后无未替换占位符 {xxx}");
{
  const BAD = /\{[a-z]+\}/g;
  let total = 0, bad = 0;
  [1, 7, 30, 100, 365, 730, 1095, 1825].forEach((d) => {
    for (let k = 0; k < 8; k++) {
      const L = S.ensureEcho(ITEM, freshRec(), mkCtx(d));
      if (!L) continue;
      total++;
      const m = L.text.match(BAD);
      if (m) { bad++; console.log("  ✗ days=" + d + " 残留占位符 " + m.join(",") + " ⇒ " + L.text.slice(0, 40)); }
    }
  });
  ok(bad === 0, "穷举采样 " + total + " 封，0 残留占位符（坏 " + bad + "）");
}

/* ================= D · y 池：正文「N 年」且标题「N 周年」同行 ================= */
section("D · y 池年数与标题一致");
{
  const L = S.ensureEcho(ITEM, freshRec(), mkCtx(730));
  ok(!!L && /\d+ 周年/.test(L.title) && /第 \d+ 年/.test(L.text), "730 天：标题「N 周年」+ 正文「第 N 年」一致");
}

const pass = summary();
process.exit(pass ? 0 : 1);
