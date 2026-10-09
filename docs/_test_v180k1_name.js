/* ============================================================
 * _test_v180k1_name.js · V180-K1「沁灵显示名统一走身份表」
 * ------------------------------------------------------------
 * 症状（用户截图）：夜话 duo 群标题显示旧名 / 手串名（「阿深 和 小叶」）；
 *   冰红茶那只显示成「茶茶」。
 * 根因：引擎侧 thMember（夜话群标题 + 成员名）与 greetVars（问候 / 日记 / 回响的 {name}，
 *   含「—— 你的{name}」署名）直取 `r.persona.name || item.name`，
 *   **够不着 app.js 的身份表**；而 nameOf 又只对「当前显示名」反查一次，
 *   旧 AI 名命中不了 ⇒ 连手串名（冰红茶，表里有）也没拿去试。
 *
 * 本测试钉住四件事：
 *   A · 引擎侧：新增 setDisplayNameResolver / dispNameOf；未注入时**逐字回落**旧串名
 *   B · 引擎侧：thMember / greetVars 两处的 name 已改为走 dispNameOf（源码断言 + 真跑）
 *   C · app 侧：nameOf 补「persona 名 / 手串名」两次反查；旧名 + 手串名在表 → 命中正式姓名
 *   D · 负向对照：铆定 08445ed（本批落地前）基线 ⇒ 上述断言必须红
 *
 * 用法： node docs/_test_v180k1_name.js
 *        K1_APP_SRC=<基线 app.js> K1_SP_SRC=<基线 spirits.js> node docs/_test_v180k1_name.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const APP_PATH = process.env.K1_APP_SRC || path.join(ROOT, "js", "app.js");
const SP_PATH = process.env.K1_SP_SRC || path.join(ROOT, "js", "spirits.js");
const APP = (function () { try { return fs.readFileSync(APP_PATH, "utf8").replace(/\r/g, ""); } catch (e) { return ""; } })();
const SP_SRC = (function () { try { return fs.readFileSync(SP_PATH, "utf8"); } catch (e) { return ""; } })();

console.log("V180-K1 显示名回归　app=" + APP_PATH + "　spirits=" + SP_PATH);
console.log("------------------------------------------------------------");

/* ---------- 抽 app.js 的名字解析四件套（与 _test_v180_d13_nameof 同手法） ---------- */
function grab(re, src, label) {
  const m = re.exec(src || "");
  if (!m) { console.log("  ! 抽不到：" + label); return ""; }
  return m[0];
}
const SRC_IDENT = grab(/var SPIRIT_IDENTITIES = \[[\s\S]*?\n  \];/, APP, "SPIRIT_IDENTITIES");
const SRC_KEYS = grab(/function identityKeysOf\(idn\) \{[\s\S]*?\n  \}/, APP, "identityKeysOf");
const SRC_LOOK = grab(/function spiritIdentityOf\(dispName\) \{[\s\S]*?\n  \}/, APP, "spiritIdentityOf");
const SRC_NAMEOF = grab(/function nameOf\(it, store\) \{[\s\S]*?\n  \}/, APP, "nameOf");

function bootNameOf() {
  const sb = { console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
    Spirits: { load() { return {}; } } };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  if (SRC_IDENT && SRC_KEYS && SRC_LOOK && SRC_NAMEOF) {
    vm.runInContext([SRC_IDENT, SRC_KEYS, SRC_LOOK, SRC_NAMEOF, ";__nameOf = nameOf;"].join("\n"), sb);
  }
  return sb;
}

/* ---------- 引擎侧：真模块 ---------- */
const SP = (function () {
  const h = makeContext();
  try { vm.runInContext(SP_SRC, h.ctx, { filename: SP_PATH }); } catch (e) { console.log("  ! spirits 加载失败：" + e.message); }
  return h.sandbox.Spirits || {};
})();

/* ================= A · 引擎侧解析器 ================= */
section("A · 引擎侧：setDisplayNameResolver / dispNameOf");
ok(typeof SP.setDisplayNameResolver === "function", "A1 · Spirits.setDisplayNameResolver 已导出");
ok(typeof SP.dispNameOf === "function", "A2 · Spirits.dispNameOf 已导出");
{
  const it = { id: "it_tea", name: "冰红茶" };
  const rec = { persona: { name: "茶茶" } };
  // ⛔ 未注入 ⇒ 必须与改动前逐字一致（回落 persona.name）
  ok(SP.dispNameOf(it, rec) === "茶茶", "A3 · 未注入解析器时**逐字回落**旧串名（" + SP.dispNameOf(it, rec) + "）");
  ok(SP.dispNameOf({ id: "z", name: "手串" }, {}) === "手串", "A4 · 无 persona 时回落 item.name");
}
{
  // 注入后：解析器说的算
  const it = { id: "it_tea", name: "冰红茶" };
  SP.setDisplayNameResolver(function (i, r, fb) { return "江冽茗"; });
  ok(SP.dispNameOf(it, { persona: { name: "茶茶" } }) === "江冽茗", "A5 · 注入解析器后走解析结果（江冽茗）");
  SP.setDisplayNameResolver(function () { throw new Error("boom"); });
  ok(SP.dispNameOf(it, { persona: { name: "茶茶" } }) === "茶茶", "A6 · 解析器抛异常 ⇒ 静默回落串名（不冒泡）");
  SP.setDisplayNameResolver(null);
  ok(SP.dispNameOf(it, { persona: { name: "茶茶" } }) === "茶茶", "A7 · 解析器置空 ⇒ 回落串名");
}

/* ================= B · thMember / greetVars 已改走 dispNameOf ================= */
section("B · 夜话成员名 / 回响署名已接 dispNameOf");
ok(/name: dispNameOf\(item, r\)/.test(SP_SRC), "B1 · thMember 的 name 走 dispNameOf（夜话群标题 + 成员名）");
ok(/name: dispNameOf\(item, rec\)/.test(SP_SRC), "B2 · greetVars 的 name 走 dispNameOf（问候 / 日记 / 回响 {name}）");
ok(SP_SRC.indexOf('name: (r.persona && r.persona.name) || (item && item.name) || "那只"') < 0,
  "B3 · ⛔ 不再有裸取 persona.name 的成员名分支");
ok(SP_SRC.indexOf('name: (rec && rec.persona && rec.persona.name) || (item && item.name) || "那只"') < 0,
  "B4 · ⛔ 不再有裸取 persona.name 的 greetVars 分支");

/* ================= C · app 侧 nameOf 补反查 ================= */
section("C · app 侧：旧名 + 手串名在表 ⇒ 命中正式姓名");
{
  const sb = bootNameOf();
  ok(typeof sb.__nameOf === "function", "C0 · nameOf 可独立求值");
  if (typeof sb.__nameOf === "function") {
    const N = sb.__nameOf;
    // C1：旧 AI 名直接进了别名表（茶茶 → 江冽茗）
    ok(N({ id: "a", name: "冰红茶" }, { a: { persona: { name: "茶茶" } } }) === "江冽茗",
      "C1 · persona 名是旧 AI 名「茶茶」⇒ 江冽茗（实得 " + N({ id: "a", name: "冰红茶" }, { a: { persona: { name: "茶茶" } } }) + "）");
    // C2：旧 AI 名不在别名表，但**手串名**在 ⇒ 仍命中（阿深 / 小叶 这类）
    ok(N({ id: "b", name: "芭蕉叶" }, { b: { persona: { name: "小叶" } } }) === "沈青舒",
      "C2 · 旧名「小叶」不在表、手串名「芭蕉叶」在 ⇒ 沈青舒（实得 " + N({ id: "b", name: "芭蕉叶" }, { b: { persona: { name: "小叶" } } }) + "）");
    ok(N({ id: "c", name: "绿叶" }, { c: { persona: { name: "阿深" } } }) === "顾时笙",
      "C3 · 旧名「阿深」+ 手串名「绿叶」⇒ 顾时笙（实得 " + N({ id: "c", name: "绿叶" }, { c: { persona: { name: "阿深" } } }) + "）");
    // C4：⛔ 玩家改过名 ⇒ 尊重，不套身份名
    ok(N({ id: "d", name: "冰红茶" }, { d: { name: "茶茶", nameEdited: true } }) === "茶茶",
      "C4 · ⛔ rec.nameEdited=true ⇒ 尊重玩家改名（不套身份名）");
    // C5：手串名直接命中（老行为不回归）
    ok(N({ id: "e", name: "多多牛" }, { e: {} }) === "邵盈牧", "C5 · 手串名直查仍命中（邵盈牧）");
  }
}

/* ================= D · 负向对照（铆定 08445ed 基线） ================= */
section("D · 负向对照：改动前基线（08445ed）应当三病俱在 ⇒ 证明 A/B/C 能真红");
{
  const PRE_APP = process.env.K1_PRE_APP || path.join(ROOT, "docs/_tmp/_pre_v180k1_app.js");
  const PRE_SP = process.env.K1_PRE_SP || path.join(ROOT, "docs/_tmp/_pre_v180k1_spirits.js");
  let preApp = "", preSp = "";
  try { preApp = fs.readFileSync(PRE_APP, "utf8").replace(/\r/g, ""); } catch (e) { preApp = ""; }
  try { preSp = fs.readFileSync(PRE_SP, "utf8"); } catch (e) { preSp = ""; }
  if (!preApp || !preSp) {
    console.log("  ! 取不到改动前基线（" + PRE_APP + " / " + PRE_SP + "）→ 负向对照优雅跳过");
    ok(true, "D · (无基线 → 跳过)");
  } else {
    console.log("  · 基线：app(" + preApp.length + "B) spirits(" + preSp.length + "B)");
    const OLD_IDENT = grab(/var SPIRIT_IDENTITIES = \[[\s\S]*?\n  \];/, preApp, "SPIRIT_IDENTITIES#pre");
    const OLD_KEYS = grab(/function identityKeysOf\(idn\) \{[\s\S]*?\n  \}/, preApp, "identityKeysOf#pre");
    const OLD_LOOK = grab(/function spiritIdentityOf\(dispName\) \{[\s\S]*?\n  \}/, preApp, "spiritIdentityOf#pre");
    const OLD_NAMEOF = grab(/function nameOf\(it, store\) \{[\s\S]*?\n  \}/, preApp, "nameOf#pre");
    const sb = { console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
      Spirits: { load() { return {}; } } };
    sb.window = sb; sb.self = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext([OLD_IDENT, OLD_KEYS, OLD_LOOK, OLD_NAMEOF, ";__nameOf = nameOf;"].join("\n"), sb);
    ok(sb.__nameOf({ id: "a", name: "冰红茶" }, { a: { persona: { name: "茶茶" } } }) === "茶茶",
      "D1 · 旧实现「茶茶」**仍**是茶茶（没进别名表 / 没补查）→ 证明 C1 能真红");
    ok(sb.__nameOf({ id: "b", name: "芭蕉叶" }, { b: { persona: { name: "小叶" } } }) === "小叶",
      "D2 · 旧实现「小叶」**仍**是旧名（没拿手串名反查）→ 证明 C2 能真红");
    const OLD_SP = (function () {
      const h = makeContext();
      try { vm.runInContext(preSp, h.ctx, { filename: PRE_SP }); } catch (e) { /* 忽略 */ }
      return h.sandbox.Spirits || {};
    })();
    ok(typeof OLD_SP.dispNameOf !== "function", "D3 · 旧实现**没有** dispNameOf → 证明 A1/A2 能真红");
    ok(/name: \(r\.persona && r\.persona\.name\) \|\| \(item && item\.name\) \|\| "那只"/.test(preSp),
      "D4 · 旧实现 thMember 仍裸取 persona.name → 证明 B1/B3 能真红");
  }
}

const pass = summary();
process.exit(pass ? 0 : 1);
