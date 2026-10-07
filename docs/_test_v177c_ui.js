/* ============================================================
 * _test_v177c_ui.js · V177c「任务页身份名 + 口头禅物化残留」回归红测
 * ------------------------------------------------------------
 * ⚠️ 本文件在 **V177c 落地前一直为红测**（red test）：它断言
 *      (1) 今日任务页叫「身份名」（楚柿遥）而不是手串名（柿宝）
 *      (2) 列表页 / 图鉴页口头禅带过滤，物化旧句不渲染
 *      (3) 已存 persona.line 一次性清洗（只清 line，其余字段不动）
 *     落地前这些断言全不成立 ⇒ 全红。
 *
 * 基准：`d56db34`（显式 commit，⛔ 绝不用 git show HEAD）。
 * 取样方式：**把源码里的真函数抽进 vm 沙箱跑**，不是只 grep 字符串 ——
 *      所以能验证"粘贴"行为（resolver 真的落地、渲染真的滤掉、清洗真的只动 line）。
 * 用法： node docs/_test_v177c_ui.js                       （默认读 ../js）
 * 负向对照： git worktree add /tmp/_base d56db34
 *           V177C_SRC_DIR=/tmp/_base/js node docs/_test_v177c_ui.js   ⇒ 必须全红
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.V177C_SRC_DIR || path.join(__dirname, "..", "js");
function rd(f) {
  try { return fs.readFileSync(path.join(SRC, f), "utf8").replace(/\r/g, ""); }
  catch (e) { return ""; }
}
const APP = rd("app.js");
const GAME = rd("game.js");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) { PASS++; console.log("  ✓ " + msg); }
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }
// 抽取源码里的函数/常量（抽不到 ⇒ 断言失败，绝不静默放过）
function grab(re, src, label) {
  const m = re.exec(src || "");
  if (!m) { FAIL++; FAILURES.push(label + "：源码里抽不到"); console.log("  ✗ " + label + "：源码里抽不到"); return null; }
  return m[0];
}

console.log("V177c 任务页身份名 + 口头禅物化回归　基准目录：" + SRC);
console.log("------------------------------------------------------------");

/* ================= 公共：抽源 / 沙箱 ================= */
const APPF = {
  identities: grab(/var SPIRIT_IDENTITIES = \[[\s\S]*?\n  \];/, APP, "SPIRIT_IDENTITIES"),
  identityKeysOf: grab(/function identityKeysOf\(idn\) \{[\s\S]*?\n  \}/, APP, "identityKeysOf"),
  spiritIdentityOf: grab(/function spiritIdentityOf\(dispName\) \{[\s\S]*?\n  \}/, APP, "spiritIdentityOf"),
  spiritRecOf: grab(/function spiritRecOf\(id\) \{[^\n]*\}/, APP, "spiritRecOf"),
  nameOf: grab(/function nameOf\(it, store\) \{[\s\S]*?\n  \}/, APP, "nameOf"),
  spiritName: grab(/function spiritName\(it, store\) \{[\s\S]*?\n  \}/, APP, "spiritName"),
  installer: grab(/function installGameNameResolver\(\) \{[\s\S]*?\n  \}/, APP, "installGameNameResolver"),
  isObj: grab(/function isObjectifyingLine\(line\) \{[\s\S]*?\n  \}/, APP, "isObjectifyingLine"),
  words: grab(/const PERSONA_BAD_WORDS = \[[\s\S]*?\n  \];/, APP, "PERSONA_BAD_WORDS"),
  isBad: grab(/function isPersonaLineBad\(line\) \{[\s\S]*?\n  \}/, APP, "isPersonaLineBad"),
  persVer: grab(/const PERS_VER = "[^"]*";/, APP, "PERS_VER"),
  purge: grab(/function purgeObjectifiedPersonaOnce\(\) \{[\s\S]*?\n  \}/, APP, "purgeObjectifiedPersonaOnce"),
};

function fakeStorage() {
  const m = new Map();
  return {
    _m: m,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
  };
}

/* 沙箱：真 game.js + 抽出来的真 app.js 函数共生在一个 context 里 */
function boot(items, store) {
  const ls = fakeStorage();
  const sb = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Promise,
    localStorage: ls,
    Spirits: {
      _d: store || {},
      load() { return this._d; },
      save() { this._saved = (this._saved || 0) + 1; },
      giftNameOf: () => "小礼",
    },
    CustomEvent: function (t, o) { this.type = t; Object.assign(this, o || {}); },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    dispatchEvent() { return true; },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(GAME, sb, { filename: "game.js" });
  const appParts = [APPF.identities, APPF.identityKeysOf, APPF.spiritIdentityOf, APPF.spiritRecOf,
    APPF.nameOf, APPF.spiritName, APPF.installer].filter(Boolean);
  vm.runInContext(appParts.join("\n"), sb, { filename: "app-extract.js" });
  sb.__items = items;
  return sb;
}
// 沙箱里调用注入器（基线没有 ⇒ 返回 false，让断言正常判红而不是崩掉）
function installInto(sb) {
  if (typeof sb.installGameNameResolver !== "function") return false;
  try { return sb.installGameNameResolver(); } catch (e) { return false; }
}
function beadItems() { return [{ id: "it1", name: "柿宝", playStatus: "done", gifted: false }]; }
function beadStore(extra) {
  return Object.assign({
    it1: { persona: { name: "柿宝", title: "守柿人", traits: ["话少"] } },
  }, { it1: Object.assign({ persona: { name: "柿宝", title: "守柿人", traits: ["话少"] } }, (extra && extra.it1) || {}) });
}

/* ================= A · 今日任务页：叫身份名，不叫手串名 ================= */
section("A · 今日任务页取「身份名」（game.js setNameResolver × app.js 真实解析器）");
ok(!!GAME && typeof APPF.installer === "string", "app.js 有 installGameNameResolver（身份名注入器）");
ok(/function setNameResolver\(fn\)/.test(GAME) && /var nm = nameResolver\(it, rec\);/.test(GAME)
  && /setNameResolver, dailyNameOf \}/.test(GAME),
  "game.js 注入点齐备：setNameResolver() + dailyNameOf 内部回落到 nameResolver + 已导出");
{
  // A2：不注入 ⇒ 回落手串名（向后兼容，老 ww_daily 不炸）
  const sb = boot(beadItems(), beadStore());
  const descs = sb.Game.buildDailyTasks(sb.__items).map((t) => t.desc);
  ok(descs.some((d) => d.indexOf("柿宝") >= 0) && descs.every((d) => d.indexOf("楚柿遥") < 0),
    "A2 未注入解析器 ⇒ desc 回落手串名「柿宝」（向后兼容）");
}
{
  // A3：注入真实解析器 ⇒ 5 条全叫身份名「楚柿遥」，且不出现手串名
  const sb = boot(beadItems(), beadStore());
  const installed = installInto(sb);
  ok(installed === true, "A3 注入成功（installGameNameResolver 返回 true）");
  const tasks = sb.Game.buildDailyTasks(sb.__items);
  const descs = tasks.map((t) => t.desc);
  ok(descs.length === 5 && descs.every((d) => d.indexOf("楚柿遥") >= 0) && descs.every((d) => d.indexOf("柿宝") < 0),
    "A3 注入后 5 条任务 desc 全含身份名「楚柿遥」、无「柿宝」（实得：" + (descs[0] || "") + "）");
  ok(tasks.every((t) => t.spiritName === "楚柿遥") && tasks.every((t) => t.spiritId === "it1"),
    "A3 spiritName 同步为身份名、spiritId 仍是 it1（⛔ d.tasks 存档结构不变）");
  ok(/id: t\.id, key: t\.key, actKey: t\.actKey, spiritId: t\.spiritId, giftKey: t\.giftKey, done: t\.done/.test(GAME),
    "A3 ww_daily 落盘字段仍是 id/key/actKey/spiritId/giftKey/done（未被改名污染）");
}
{
  // A4：rec.nameEdited（玩家改过名）⇒ 尊重改名，不套身份名
  const sb = boot(beadItems(), beadStore({ it1: { nameEdited: true } }));
  const ins4 = installInto(sb);
  const descs = sb.Game.buildDailyTasks(sb.__items).map((t) => t.desc);
  ok(ins4 === true && descs.every((d) => d.indexOf("柿宝") >= 0) && descs.every((d) => d.indexOf("楚柿遥") < 0),
    "A4 rec.nameEdited=true ⇒ 尊重玩家改名，仍叫手串名「柿宝」");
}
{
  // A5：解析器抛异常 ⇒ 回落串名，任务页不炸
  const sb = boot(beadItems(), beadStore());
  const hasSet = typeof sb.Game.setNameResolver === "function";
  if (hasSet) sb.Game.setNameResolver(function () { throw new Error("boom"); });
  const descs = (function () {
    try { return sb.Game.buildDailyTasks(sb.__items).map((t) => t.desc); }
    catch (e) { return ["__THROWN__"]; }
  })();
  ok(hasSet && descs[0] !== "__THROWN__" && descs.every((d) => d.indexOf("柿宝") >= 0),
    "A5 解析器抛异常 ⇒ 回落串名，buildDailyTasks 不抛错");
}
{
  // A6：池空 ⇒ fillDailyName 兜底「沁灵」（舌尖 QoS 掉落时的最后兜底）
  const sb = boot([], {});
  const ins6 = installInto(sb);
  const descs = sb.Game.buildDailyTasks([]).map((t) => t.desc);
  ok(ins6 === true && descs.length === 5 && descs.every((d) => d.indexOf("沁灵") >= 0),
    "A6 无沁灵候选 ⇒ fillDailyName 兜底名「沁灵」仍在");
}
{
  // A7：身份数据本身没被改坏 —— 「柿宝」仍能反查到「楚柿遥」
  const sb = boot([], {});
  const idc = sb.spiritIdentityOf && sb.spiritIdentityOf("柿宝");
  ok(idc && idc.name === "楚柿遥",
    "A7 SPIRIT_IDENTITIES 反查：柿宝 ⇒ 楚柿遥（实得：" + (idc ? idc.name : "null") + "）");
  ok(sb.spiritIdentityOf("多多牛") === null, "A7 无身份资料手串（多多牛）反查为 null ⇒ 任务页继续显示手串名（预期行为）");
}

/* ================= B · isPersonaLineBad 正反例 ================= */
section("B · isPersonaLineBad 词表（#4 用户截图原句必拦，人话必放行）");
const BADFN = (function () {
  if (!APPF.isObj || !APPF.words || !APPF.isBad) return null;
  try {
    const sb = { console, String, Array, Object, RegExp, Error };
    vm.createContext(sb);
    vm.runInContext([APPF.isObj, APPF.words, APPF.isBad, "isPersonaLineBad"].join("\n"), sb);
    return sb.isPersonaLineBad || vm.runInContext("isPersonaLineBad", sb);
  } catch (e) { return null; }
})();
ok(!!BADFN && typeof BADFN === "function", "isPersonaLineBad 可独立求值（能被列表页与清洗共用）");
if (BADFN) {
  [["盘我？先让我缓缓…", "截图①"], ["盘我盘我，越盘越亮哦~", "截图②"],
   ["瑕不掩瑜，盘我别急~", "截图③"], ["盘我一天，包浆给你看！", "截图④"]].forEach(([s, tag]) => {
    ok(BADFN(s) === true, "B 正例必拦 · " + tag + "「" + s + "」");
  });
  ["把我当个物件看待", "欠你一份人情账", "把我盘亮了才值钱", "被主人揉了一下午", "被人搓来搓去"].forEach((s) => {
    ok(BADFN(s) === true, "B 派生正例必拦 ·「" + s + "」");
  });
  ok(BADFN("") === true && BADFN(null) === true && BADFN(undefined) === true,
    "B 空值判为坏句（空串/null/undefined 都不渲染）");
  ["今天盘了三十下", "我就在这儿等你回来", "茶凉了，我给你续上", "窗外的雨还没停"].forEach((s) => {
    ok(BADFN(s) === false, "B 反例必放行（人话）·「" + s + "」");
  });
  ok(/isObjectifyingLine\(s\)/.test(APPF.isBad || ""),
    "B 内部复用 isObjectifyingLine（V175 口径不重复维护，只在其上扩词）");
}

/* ================= C · 列表页 / 图鉴页渲染过滤 ================= */
section("C · 列表页 + 图鉴页口头禅渲染");
const LINE_RE = /\(\(p && p\.line && !isPersonaLineBad\(p\.line\)\) \? '<div class="spirit-line">' \+ esc\(p\.line\) \+ "<\/div>" : ""\)/g;
const lineHits = APP ? (APP.match(LINE_RE) || []) : [];
ok(lineHits.length === 2,
  "C1 spirit-line 渲染处恰好 2 处（列表页 + 图鉴页）且都带 isPersonaLineBad 过滤（实得 " + lineHits.length + "）");
ok(APP.indexOf("'<div class=\"spirit-line\">' + esc((p && p.line) || \"\") + \"</div>\"") < 0,
  "C2 旧的无过滤写法（列出空串也渲染）已不存在");
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function render(p) {
  const expr = lineHits[0];
  if (!expr) return "__NOEXPR__";
  return vm.runInNewContext("(" + expr + ")", { p: p, esc: esc, isPersonaLineBad: BADFN });
}
ok(render({ line: "我就在这儿等你回来" }).indexOf('<div class="spirit-line">') >= 0
  && render({ line: "我就在这儿等你回来" }).indexOf("我就在这儿等你回来") >= 0,
  "C3 干净口头禅照常渲染（实得：" + render({ line: "我就在这儿等你回来" }) + "）");
ok(render({ line: "盘我盘我，越盘越亮哦~" }) === "",
  "C4 物化旧句不渲染（实得：" + JSON.stringify(render({ line: "盘我盘我，越盘越亮哦~" })) + "）");
ok(render({ line: "瑕不掩瑜，盘我别急~" }) === "" && render({ line: "盘我一天，包浆给你看！" }) === "",
  "C4b 截图③/④ 同样不渲染");
ok(render({ line: "" }) === "" && render(null) === "",
  "C5 空 line / 无 persona 时不再多渲染一行空 div");

/* ================= D · 已存 persona.line 一次性清洗 ================= */
section("D · purgeObjectifiedPersonaOnce（只清 persona.line，其余字段一律不动）");
ok(APPF.persVer === 'const PERS_VER = "v177c";',
  "D1 版本键 PERS_VER = \"v177c\"（跑过一次就跳过）　实得：" + APPF.persVer);
const purgeFn = (function () {
  if (!APPF.purge || !APPF.persVer || !BADFN) return null;
  try {
    const sb = { console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error };
    vm.createContext(sb);
    return vm.runInContext([APPF.persVer, APPF.purge, "purgeObjectifiedPersonaOnce"].join("\n"), sb);
  } catch (e) { return null; }
})();
ok(!!purgeFn && typeof purgeFn === "function", "D1 purgeObjectifiedPersonaOnce 可独立求值（能从源码抽出真跑）");
function mkFixture() {
  return {
    it1: {
      persona: { name: "柿宝", title: "守柿人", line: "盘我盘我，越盘越亮哦~", traits: ["话少"], gender: "boy" },
      personaZh: { hair: "黑", wear: "长衫" },
      diary: [{ date: "2027-01-17", text: "今天陪主人坐了很久" }],
      marks: ["m1", "m2"],
      flags: { firstMet: 1 },
      bond: 42, heart: 88, stage: 2, nameEdited: false, echoes: [{ id: "e1" }],
    },
    it2: {
      persona: { name: "多多牛", line: "我就在这儿等你回来", traits: ["憨"] },
      diary: [], marks: [], flags: {},
    },
  };
}
if (purgeFn) {
  const store = mkFixture();
  const before = JSON.parse(JSON.stringify(store));
  const ls = fakeStorage();
  const saved = { n: 0 };
  const ctx = {
    localStorage: ls,
    Spirits: { load() { return store; }, save() { saved.n++; } },
    isPersonaLineBad: BADFN, console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error,
  };
  vm.createContext(ctx);
  const run = vm.runInContext([APPF.persVer, APPF.purge, "purgeObjectifiedPersonaOnce"].join("\n"), ctx);
  const n1 = run();
  ok(n1 === 1, "D2 坏的 persona.line 被清空，返回计数 1（实得 " + n1 + "）");
  ok(store.it1.persona.line === "", "D2 persona.line 已清空（实得 " + JSON.stringify(store.it1.persona.line) + "）");
  const others = Object.assign({}, store.it1.persona);
  delete others.line;
  const beforeOthers = Object.assign({}, before.it1.persona);
  delete beforeOthers.line;
  ok(JSON.stringify(others) === JSON.stringify(beforeOthers),
    "D3 persona 其余字段原样（name/title/traits/gender）　实得：" + JSON.stringify(others));
  ok(JSON.stringify(store.it1.personaZh) === JSON.stringify(before.it1.personaZh), "D4 personaZh 未动");
  ok(JSON.stringify(store.it1.diary) === JSON.stringify(before.it1.diary), "D4 diary 未动");
  ok(JSON.stringify(store.it1.marks) === JSON.stringify(before.it1.marks), "D4 marks 未动");
  ok(JSON.stringify(store.it1.flags) === JSON.stringify(before.it1.flags), "D4 flags 未动");
  ok(store.it1.bond === 42 && store.it1.heart === 88 && store.it1.stage === 2 && store.it1.echoes.length === 1,
    "D4 bond / heart / stage / echoes 未动");
  ok(store.it2.persona.line === "我就在这儿等你回来",
    "D5 干净口头禅不动（实得「" + store.it2.persona.line + "」）");
  ok(ls.getItem("ww_persver") === "v177c", "D6 版本键 ww_persver 已写入 v177c");
  saved.n = 0;
  const n2 = run();
  ok(n2 === 0 && saved.n === 0, "D6 二次调用返回 0 且不重复写库（幂等）　实得 n=" + n2 + " save=" + saved.n);
  store.it1.persona.line = "新写的一句人话";
  ok(run() === 0 && store.it1.persona.line === "新写的一句人话",
    "D6 以后新生成的口头禅永不被误清");
}
{
  const hookPull = (APP.match(/purgeObjectifiedPersonaOnce\(\);/g) || []).length;
  const hookToast = /const pn = purgeObjectifiedPersonaOnce\(\);[\s\S]{0,120}旧口头禅/.test(APP);
  ok(hookPull >= 1, "D7 挂点① pullSpirits 尾部（防云端旧数据回灌）　实得 " + hookPull + " 处调用");
  ok(hookToast, "D7 挂点② init() 里 toast 汇总「已清掉 N 句旧口头禅 ✨」");
}

console.log("------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
console.log(FAIL > 0 ? "⇒ 红测（V177c 落地前为红，属预期）" : "⇒ 全绿：V177c 已落地");
process.exit(FAIL > 0 ? 1 : 0);
