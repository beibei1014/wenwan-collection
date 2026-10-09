/* ============================================================
 * _test_v180_d13_nameof.js · V180-D13「显示名统一收敛到身份表」
 * ------------------------------------------------------------
 * 背景：v180-D 批把身份名只接到了「详情页」（spiritCardOf）。列表 / 巷 / 夜话 /
 *       选角 / 房间 / 日记 / toast 仍吃 nameOf→手串名 ⇒ 用户截图：「我的沁灵」
 *       列表里还写着 多多牛 / 春不晚 / 油果果。
 * 本批把身份解析**下沉进 nameOf**（spiritName = nameOf）⇒ 一处改、全站显正式姓名。
 *
 * 本测试：把 SPIRIT_IDENTITIES + identityKeysOf + spiritIdentityOf + nameOf
 *         一起抽出来真跑（不 require 整个 app.js、不依赖 DOM）。
 * 基准：`eda74a1`（本批落地前的 HEAD）。
 * 用法： node docs/_test_v180_d13_nameof.js
 * 负向对照： V180D13_APP_SRC=<eda74a1 导出的 app.js> node docs/_test_v180_d13_nameof.js ⇒ 必须红
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_PATH = process.env.V180D13_APP_SRC || path.join(ROOT, "js", "app.js");
const APP = (function () {
  try { return fs.readFileSync(APP_PATH, "utf8").replace(/\r/g, ""); } catch (e) { return ""; }
})();

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

console.log("V180-D13 显示名收敛回归　源码：" + APP_PATH);
console.log("------------------------------------------------------------");

/* ---------- 抽源（抽不到 ⇒ 断言判红，绝不静默） ---------- */
function grab(re, src, label) {
  const m = re.exec(src || "");
  if (!m) { console.log("  ! 抽不到：" + label); return ""; }
  return m[0];
}
const SRC_IDENT = grab(/var SPIRIT_IDENTITIES = \[[\s\S]*?\n  \];/, APP, "SPIRIT_IDENTITIES");
const SRC_KEYS = grab(/function identityKeysOf\(idn\) \{[\s\S]*?\n  \}/, APP, "identityKeysOf");
const SRC_LOOK = grab(/function spiritIdentityOf\(dispName\) \{[\s\S]*?\n  \}/, APP, "spiritIdentityOf");
const SRC_NAMEOF = grab(/function nameOf\(it, store\) \{[\s\S]*?\n  \}/, APP, "nameOf");
const SRC_SPIRITNAME = grab(/function spiritName\(it, store\) \{[\s\S]*?\n  \}/, APP, "spiritName");

/* ---------- 沙箱：四段源码共生一个 context ---------- */
function boot(store) {
  const sb = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
    Spirits: { load() { return store || {}; } },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  if (SRC_IDENT && SRC_KEYS && SRC_LOOK && SRC_NAMEOF && SRC_SPIRITNAME) {
    vm.runInContext([SRC_IDENT, SRC_KEYS, SRC_LOOK, SRC_NAMEOF, SRC_SPIRITNAME,
      ";__nameOf = nameOf; __spiritName = spiritName;"].join("\n"), sb);
  }
  return sb;
}

/* ================= A · 源码：身份解析已下沉进 nameOf ================= */
section("A · nameOf 源码层已接身份表（本源层不变量）");
ok(/spiritIdentityOf\(disp\)/.test(SRC_NAMEOF), "A1 nameOf 内部调用 spiritIdentityOf(disp)（身份表反查）");
ok(/rec\.nameEdited/.test(SRC_NAMEOF), "A2 nameOf 有 rec.nameEdited 守卫（尊重玩家改名）");
ok(/rec\.naming/.test(SRC_NAMEOF), "A3 nameOf 有 rec.naming 分支（新开沁规格命名）");
ok(/function spiritName\(it, store\) \{ return nameOf\(it, store\); \}/.test(SRC_SPIRITNAME),
  "A4 spiritName 仍转发 nameOf（列表 / 巷 / 夜话 / 选角共用这一处）");

/* ================= B · 运行期：手串名 ⇒ 正式姓名 ================= */
section("B · 运行期反查：手串名 / 别名 ⇒ 正式姓名");
{
  const sb = boot({});
  ok(typeof sb.__nameOf === "function", "B0 nameOf 可独立求值");
  const cases = [
    ["多多牛", "邵盈牧"], ["春不晚", "季未晚"], ["油果果", "俞酥棠"],
    ["花猫猫", "戚衔蝉"], ["阿豹果", "乔纹栗"], ["焦糖儿", "闵琥珀"],
    ["柿柿如意", "楚柿遥"], ["黄金算盘", "萧景筹"], ["冰红茶", "江冽茗"],
    ["柿宝", "楚柿遥"], ["金算盘", "萧景筹"],   // 旧名 / 别名
  ];
  cases.forEach(([bead, name]) => {
    const got = sb.__nameOf({ id: "s1", name: bead }, { s1: { name: bead } });
    ok(got === name, "B · 「" + bead + "」⇒ " + name + "（实得 " + got + "）");
  });
}

/* ================= C · 尊重玩家改名 / 回落链 ================= */
section("C · 改名优先 + 未知手串回落 + rec.naming");
{
  const sb = boot({});
  // C1：玩家改过名 ⇒ 不套身份名
  const c1 = sb.__nameOf({ id: "s1", name: "多多牛" }, { s1: { name: "多多牛", nameEdited: true } });
  ok(c1 === "多多牛", "C1 rec.nameEdited=true ⇒ 保留玩家自定名「多多牛」（实得 " + c1 + "）");
  // C2：未登记手串 ⇒ 原样回落
  const c2 = sb.__nameOf({ id: "s1", name: "紫砂壶" }, { s1: {} });
  ok(c2 === "紫砂壶", "C2 未登记手串「紫砂壶」⇒ 回落自身名（实得 " + c2 + "）");
  // C3：rec.naming（新开沁规格命名）⇒ 该命名
  const c3 = sb.__nameOf({ id: "s1", name: "紫砂壶" }, { s1: { naming: { name: "沐云阶" } } });
  ok(c3 === "沐云阶", "C3 rec.naming.name 优先于未登记手串名（实得 " + c3 + "）");
  // C4：persona.name 回落
  const c4 = sb.__nameOf({ id: "s1", name: "茉莉" }, { s1: { persona: { name: "小茉莉" } } });
  ok(c4 === "小茉莉", "C4 无身份 ⇒ 回落 persona.name（实得 " + c4 + "）");
  // C5：全空 ⇒ 「沁灵」兜底
  const c5 = sb.__nameOf({ id: "s1" }, { s1: {} });
  ok(c5 === "沁灵", "C5 全空 ⇒ 兜底「沁灵」（实得 " + c5 + "）");
}

/* ================= D · 列表 / 巷 / 夜话 名字位都吃 spiritName ================= */
section("D · 各面名字位收敛在 spiritName/nameOf（源码锚点）");
ok(/<div class="spirit-name">' \+ esc\(spiritName\(it, store\)\)/.test(APP),
  "D1 「我的沁灵」列表卡姓名位走 spiritName ⇒ 显身份名");
ok(/'<div class="spirit-name">' \+ esc\(spiritName\(it, store\)\)/.test(APP) &&
  (APP.match(/class="spirit-name">' \+ esc\(spiritName\(/g) || []).length >= 2,
  "D2 列表页 + 图鉴页两处姓名位都走 spiritName（实得 " +
  (APP.match(/class="spirit-name">' \+ esc\(spiritName\(/g) || []).length + " 处)");

/* ================= E · 「只当手串」安全页保持显串名（不套身份名） ================= */
section("E · renderSpiritOffPage（只当手串）仍显串名");
ok(!/sd-name">' \+ esc\(spiritName\(it, store\)\) \+ '<span class="spirit-stage big">📿 手串<\/span>/.test(APP),
  "E1 ⛔ 安全页姓名位不再吃 spiritName（否则会显身份名，与「这页本就是串」矛盾）");
ok(/'<div class="sd-name">' \+ esc\(rec\.name \|\| \(rec\.persona && rec\.persona\.name\) \|\| it\.name \|\| "沁灵"\) \+ '<span class="spirit-stage big">📿 手串<\/span>/.test(APP),
  "E2 安全页直取串名表达式（rec.name → persona.name → it.name → 沁灵）");

console.log("------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
console.log(FAIL > 0
  ? "⇒ 红测（V180-D13 落地前为红，属预期）"
  : "⇒ 全绿：V180-D13 已落地");
process.exit(FAIL > 0 ? 1 : 0);
