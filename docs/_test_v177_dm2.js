/* ============================================================
 * _test_v177_dm2.js · V177e 恋爱线「通电」自测（记账字段 / round 切换 / 二次告白）
 * ------------------------------------------------------------
 * 🔴 本轮要解决的问题：js/love.js 已入库（165 条），但**没人给它记账** ——
 *    Love.scriptFor() 靠 rec.loveTries 判 round、Love.canReConfess() 靠
 *    loveDeclinedAt / loveBondLvAt / loveTries 判契机，而全仓没人写这四个字段
 *    ⇒ round 2 永远触发不了，45 条「再告」文案跑不到。本文件锚定这条链路真通了。
 *
 * 覆盖：
 *      A · 真跑一遍完整告白（真 renderLoveDmPage + 真 renderTalkPage）⇒ 记账落盘
 *      B · 应下 ⇒ ⛔ loveTries 不许被顶上去（否则回看会变成「再告」那句）
 *      C · round 切换：loveTries=0 ⇒ 首告；loveTries=1 ⇒ 再告（真 Love.scriptFor，字面不同）
 *      D · 冷却未到 ⇒ UI 无「挑明」；冷却已过 ⇒ UI 有「挑明」（真 loveCardHtml）
 *      E · {call} 两条链路一致（Love.fillAll 版 vs 兜底版，同串同结果）
 *      F · 渲染结果无残留 {ta} / {call}
 *      G · 🔴 typeof Love === "undefined" ⇒ 全流程不崩（mock 掉 Love 再跑一遍）
 *      H · 进夜话列表的提示 toast：文案 + 同一天只弹一次
 *      I · 「挑明」（retry）⇒ 走 round 2，不是首告
 *      J · Love 的变体号写回 **ww_spirits 里活着的那一个对象**（⛔ 不是副本）
 *
 * 只按「抽 app.js 真实源码 + vm 跑」的方式，不 require 整个 app.js、不依赖 DOM。
 * 基准：`72aab30`（V177d 落地前 —— 夜话里根本没有私聊）。
 * 用法： node docs/_test_v177_dm2.js
 * 负向对照（🔴 必做）：
 *   git worktree add /tmp/_base 72aab30
 *   cp docs/_test_v177_dm2.js /tmp/_base/docs/ && cd /tmp/_base && node docs/_test_v177_dm2.js
 *   ⇒ 必须红（基线无 loveSettleBook / loveMarkRound / loveCanRetry / loveDmTipOnce，A~J 全红）
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_PATH = process.env.V177_DM2_APP_SRC || path.join(ROOT, "js", "app.js");
const LOVE_PATH = process.env.V177_DM2_LOVE_SRC || path.join(ROOT, "js", "love.js");
const APP = fs.readFileSync(APP_PATH, "utf8").replace(/\r\n/g, "\n");
let LOVE_SRC = "";
try { LOVE_SRC = fs.readFileSync(LOVE_PATH, "utf8").replace(/\r\n/g, "\n"); } catch (e) { LOVE_SRC = ""; }

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

console.log("V177e 恋爱线·通电自测　app：" + APP_PATH);
console.log("------------------------------------------------------------");

/* ---------- 从源码抽函数 / 常量（跳过字符串与注释里的括号） ---------- */
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(APP);
  if (!m) throw new Error("找不到函数 " + name);
  let i = APP.indexOf("(", m.index), pd = 0;
  for (; i < APP.length; i++) { if (APP[i] === "(") pd++; else if (APP[i] === ")") { pd--; if (pd === 0) { i++; break; } } }
  while (i < APP.length && APP[i] !== "{") i++;
  let depth = 0;
  for (; i < APP.length; i++) {
    const ch = APP[i];
    if (ch === "'" || ch === '"' || ch === "`") { const q = ch; i++; while (i < APP.length) { if (APP[i] === "\\") { i += 2; continue; } if (APP[i] === q) break; i++; } continue; }
    if (ch === "/" && APP[i + 1] === "/") { while (i < APP.length && APP[i] !== "\n") i++; continue; }
    if (ch === "/" && APP[i + 1] === "*") { const e = APP.indexOf("*/", i); i = e < 0 ? APP.length : e + 1; continue; }
    if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return APP.slice(m.index, i);
}
function extractConstLine(name) {
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*[^;]+;");
  const m = re.exec(APP);
  if (!m) throw new Error("找不到常量 " + name);
  return m[0];
}
function tryExtractFn(name) { try { return extractFn(name); } catch (e) { return ""; } }
function tryExtractConst(name) { try { return extractConstLine(name); } catch (e) { return ""; } }

/* ---------- 沙箱里的全部源码件（⛔ 抽不到 = 未落地 ⇒ 直接红） ---------- */
const LIB = [
  tryExtractConst("LOVE_DM_CFG"),
  tryExtractConst("LOVE_FALLBACK_1"),
  tryExtractConst("LOVE_FALLBACK_2"),
  tryExtractConst("LOVE_KEYS"),
  tryExtractFn("loveScript"),
  tryExtractFn("loveCanReConfess"),
  tryExtractFn("loveCanRetry"),
  tryExtractFn("loveDaysSinceDeclined"),
  tryExtractFn("loveFill"),
  tryExtractFn("loveRoundOf"),
  tryExtractFn("loveDmTid"),
  tryExtractFn("loveDmUrl"),
  tryExtractFn("loveDmToken"),
  tryExtractFn("loveDmMsgs"),
  tryExtractFn("loveDmNeedInput"),
  tryExtractFn("loveWhoOf"),
  tryExtractFn("loveMarkRound"),
  tryExtractFn("loveSettleBook"),
  tryExtractFn("loveTodayKey"),
  tryExtractFn("loveDmTipShown"),
  tryExtractFn("loveDmTipMark"),
  tryExtractFn("loveDmTipOnce"),
  tryExtractFn("loveDmList"),
  tryExtractFn("loveCardHtml"),
  tryExtractFn("loveAct"),
].filter(Boolean).join("\n");

const BEAD = "莫高窟", IDNAME = "陆临崖";      // 手串名 ≠ 身份名
const LOVE_STATES = ["none", "ready", "confessed", "accepted", "declined"];
const LEVELS = [0, 12, 30, 55, 90, 140, 200, 280];
function stubBondLevel(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (v >= LEVELS[k]) i = k;
  return { value: v, lv: i, lv1: i + 1, name: "档" + (i + 1), pct: 50 };
}
function dateAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const TODAY = (function () {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
})();

/* ---------- 最小假 DOM（够 renderTalkPage 跑完；⛔ 不引入 jsdom） ---------- */
function makeDom() {
  const cache = {};
  function el(sel) {
    if (cache[sel]) return cache[sel];
    const e = {
      sel: sel, _html: "", _kids: [], style: {}, dataset: {}, value: "",
      hidden: false, disabled: false, offsetWidth: 0,
      classList: { add() {}, remove() {}, toggle() {} },
      querySelector: (s) => el(sel + " " + s),
      querySelectorAll: (s) => (s === ".nt-opt"
        ? [Object.assign(el(sel + "#opt0"), { dataset: { i: "0" } }),
           Object.assign(el(sel + "#opt1"), { dataset: { i: "1" } })]
        : []),
      addEventListener() {}, appendChild() {}, remove() {}, focus() {},
      setAttribute() {}, removeProperty() {}, setProperty() {},
      insertBefore(node) { e._kids.push(String((node && node._html) || "")); },
    };
    Object.defineProperty(e, "innerHTML", {
      get() { return e._html; },
      set(v) { e._html = String(v); e._kids = []; },
    });
    cache[sel] = e;
    return e;
  }
  function createEl() {
    const d = { _html: "", firstChild: null, classList: { add() {} }, style: {}, dataset: {} };
    Object.defineProperty(d, "innerHTML", {
      get() { return d._html; },
      set(v) { d._html = String(v); d.firstChild = d._html ? { _html: d._html, classList: { add() {} } } : null; },
    });
    return d;
  }
  return { el: el, createEl: createEl, cache: cache };
}

/* ---------- 一只沁灵的完整会话：真 load/save 语义（load 每次返回新对象）+ 真 love.js ---------- */
function session(sid, init, opt) {
  opt = opt || {};
  let DISK = {};
  DISK[sid] = Object.assign({ stage: 4, bond: 200, look: { pers: "gentle" } }, init || {});
  let saveN = 0;
  const dom = makeDom();
  ["#ntBody", "#ntFoot", "#ntLovecallInput", "#ntLovecallOk"].forEach((s) => dom.el(s));   // 预建：基线跑不通时也要能干净报红（⛔ 不许抛栈）
  const toasts = [];
  const LS = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
  };
  const Spirits = {
    LOVE_STATES: LOVE_STATES,
    load: () => { try { return JSON.parse(JSON.stringify(DISK)); } catch (e) { return {}; } },
    save: (s) => { DISK = JSON.parse(JSON.stringify(s || {})); saveN++; return true; },
    ensureIn: (s, id) => { if (!s[id] || typeof s[id] !== "object") s[id] = {}; return s[id]; },
    todayKey: () => TODAY,
    bondLevel: stubBondLevel,
    // 与 spirits.js callFor 同口径：lovecall → 档7 昵称/你 → 档4 你 → 主人
    callFor: (rec) => {
      const r = rec || {};
      const lc = String(r.lovecall || "").trim();
      if (lc) return lc;
      const lv1 = stubBondLevel(Number(r.bond) || 0).lv1;
      if (lv1 >= 7) return String(r.nickCall || "").trim() || "你";
      if (lv1 >= 4) return "你";
      return "主人";
    },
    loveGate: (rec) => {
      const r = rec || {};
      const lv1 = stubBondLevel(Number(r.bond) || 0).lv1;
      const res = { ok: false, reason: "", stage: Math.max(1, Number(r.stage || 1)), bondLv: lv1,
                    state: String(r.loveState || "none"), canConfess: false, lovecall: String(r.lovecall || "") };
      if (res.stage < 4) { res.reason = "stage"; return res; }
      if (lv1 < 7) { res.reason = "bond"; return res; }
      res.ok = true;
      res.canConfess = (res.state === "none" || res.state === "ready" || res.state === "declined");
      return res;
    },
    loveStateOf: (id) => {
      const r = DISK[id] || {};
      const st = String(r.loveState || "none");
      return { state: LOVE_STATES.indexOf(st) >= 0 ? st : "none", loveOn: !!r.loveOn,
               lovecall: String(r.lovecall || ""), at: String(r.loveAt || "") };
    },
    openLoveLine: (id) => {
      const s = Spirits.load(); const r = Spirits.ensureIn(s, id);
      r.loveOn = true;
      if (String(r.loveState || "none") === "none") r.loveState = "ready";
      if (!r.loveAt) r.loveAt = TODAY;
      Spirits.save(s); return true;
    },
    setLoveState: (id, st) => {
      if (LOVE_STATES.indexOf(st) < 0) return false;
      const s = Spirits.load(); const r = Spirits.ensureIn(s, id);
      r.loveState = st; r.loveAt = TODAY; Spirits.save(s); return true;
    },
    acceptConfess: (id) => {
      const st = String((DISK[id] || {}).loveState || "");
      if (st !== "confessed" && st !== "accepted") return false;
      return Spirits.setLoveState(id, "accepted");
    },
    declineConfess: (id) => {
      const st = String((DISK[id] || {}).loveState || "");
      if (st !== "confessed" && st !== "declined") return false;
      return Spirits.setLoveState(id, "declined");
    },
    setLovecall: (id, t) => {
      const v = String(t || "").trim();
      const s = Spirits.load(); const r = Spirits.ensureIn(s, id);
      if (String(r.lovecall || "").trim()) { Spirits.save(s); return { ok: false, reason: "locked" }; }
      if (!v) { Spirits.save(s); return { ok: false, reason: "empty" }; }
      r.lovecall = v; Spirits.save(s); return { ok: true, reason: "" };
    },
  };
  const sb = {
    console: console, Math: Math, JSON: JSON, Date: Date, String: String, Number: Number,
    Boolean: Boolean, Array: Array, Object: Object, Error: Error, RegExp: RegExp, Promise: Promise,
    parseInt: parseInt, isFinite: isFinite, isNaN: isNaN,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    esc: esc,
    $: (sel) => dom.el(sel),
    view: dom.el("#view"),
    topbarTitle: dom.el("#topbarTitle"),
    btnBack: dom.el("#btnBack"),
    btnSettings: dom.el("#btnSettings"),
    scrollTo: () => {},
    document: { body: { classList: { add() {}, remove() {}, toggle() {} }, scrollHeight: 0 },
                createElement: () => dom.createEl(), getElementById: () => null },
    location: { hash: "#/night/dm_" + sid },
    localStorage: LS,
    setTimeout: (f) => { if (typeof f === "function") f(); return 0; },
    clearTimeout: () => {},
    spiritItems: () => [{ id: sid, name: BEAD }],
    spiritName: (it) => (it && it.name) || "那只",
    spiritIdentityOf: (d) => (String(d || "") === BEAD ? { name: IDNAME, style: "瞻丹", bead: BEAD } : null),
    spiritThumbHtml: () => '<i class="av"></i>',
    meAvatarHtml: () => "我",
    fmtTime: () => "22:30",
    talkDwell: () => 0,
    TALK_LEAD_MS: 0,
    bindSpiritImgFallback: () => {},
    updateNightDot: () => {},
    toast: (m) => toasts.push(String(m)),
    fillTa: (t, n) => String(t == null ? "" : t).replace(/\{ta\}/g, n || "那只"),
    Spirits: Spirits,
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  let loveLoaded = false;
  if (!opt.noLove) {                                   // 🔴 真 js/love.js 跑进沙箱（不是替身）
    try { vm.runInContext(LOVE_SRC, ctx, { filename: "js/love.js" }); loveLoaded = !!sb.Love; } catch (e) { loveLoaded = false; }
  }
  const FN = [LIB, tryExtractFn("renderLoveDmPage"), tryExtractFn("renderTalkPage")].join("\n");
  try {
    vm.runInContext(FN +
      "\n;__api = { rdm: renderLoveDmPage, script: loveScript, list: loveDmList, card: loveCardHtml," +
      " act: loveAct, fill: loveFill, tip: loveDmTipOnce, canRetry: loveCanRetry, roundOf: loveRoundOf," +
      " settle: loveSettleBook, mark: loveMarkRound, url: loveDmUrl, msgs: loveDmMsgs };",
      ctx, { filename: "app.js#loveDm2" });
  } catch (e) { /* 抽不到源码（基线）⇒ 交给断言报红，⛔ 不抛栈 */ }
  // 源码一件都抽不到时的空 api（⛔ 基线负向对照要「干净报红」，不许抛栈崩掉）
  const EMPTY_API = {
    rdm: () => null, script: () => ({}), list: () => [], card: () => "", act: () => {},
    fill: () => "", tip: () => {}, canRetry: () => false, roundOf: () => 1,
    settle: () => null, mark: () => null, url: () => "", msgs: () => [],
  };
  const api = sb.__api || EMPTY_API;
  return {
    sb: sb, dom: dom, cache: dom.cache, toasts: toasts, ls: LS, loveLoaded: loveLoaded,
    api: api, hasApi: !!sb.__api,
    disk: () => DISK, rec: () => DISK[sid] || {}, saveN: () => saveN, sid: sid,
    run: () => (api ? api.rdm(sid) : null),
    card: () => (api ? String(api.card({ id: sid, name: BEAD }, DISK[sid] || {}, IDNAME, Spirits.load()) || "") : ""),
  };
}

/* ================= A · 真跑一遍完整告白 ⇒ 记账落盘 ================= */
section("A · 真跑一遍完整告白（真 renderLoveDmPage）⇒ 记账真的落盘");
{
  ok(LOVE_SRC.length > 1000, "能读到 js/love.js（" + LOVE_SRC.length + " 字节；读不到 ⇒ 文案库没入库）");
  const S = session("it1", { loveState: "ready", loveOn: true });
  ok(!!S.hasApi, "沙箱起得来（app.js 源码件抽全了）");
  ok(S.loveLoaded, "🔴 真 js/love.js 已载入沙箱（window.Love 在）");
  let threw = "";
  try { S.run(); } catch (e) { threw = e.message; }
  ok(!threw, "renderLoveDmPage 跑通不抛错（实测：" + (threw || "OK") + "）");
  const b1 = (S.cache["#ntBody"]._kids || []).join("");
  ok(b1.indexOf("nt-bub") >= 0, "告白气泡渲染出来了");
  ok(/这些日子/.test(b1), "🔴 首告文案来自真 love.js（gentle 首告开头「这些日子」；命中=" + /这些日子/.test(b1) + "）");
  ok((S.cache["#ntFoot"]._html || "").indexOf("缓一缓") >= 0, "底部给出「缓一缓」选项");

  const opts = S.cache["#ntFoot"].querySelectorAll(".nt-opt");
  let threw2 = "";
  try { opts[1].onclick(); } catch (e) { threw2 = e.message; }
  ok(!threw2, "点「缓一缓」不抛错（实测：" + (threw2 || "OK") + "）");
  ok(String(S.rec().loveState) === "declined", "数据层真的落到 declined");
  ok(Number(S.rec().loveTries) === 1, "🔴 走完一次完整告白 ⇒ rec.loveTries === 1（实测 " + S.rec().loveTries + "）");
  ok(S.saveN() >= 2, "🔴 真的落盘了（Spirits.save 调用 " + S.saveN() + " 次，不是只在内存里改）");
  ok(String(S.rec().loveDeclinedAt) === TODAY, "🔴 loveDeclinedAt = 今天（实测 " + S.rec().loveDeclinedAt + " vs " + TODAY + "）");
  ok(Number(S.rec().loveBondLvAt) === 6, "🔴 loveBondLvAt = 当时羁绊档 **0-based** 6（bond=200 ⇒ 档7 ⇒ lv=6；实测 " + S.rec().loveBondLvAt + "）");
  ok(Number(S.rec().loveDmRound) === 1, "loveDmRound 镜像 = 1（这一轮演的是首告；实测 " + S.rec().loveDmRound + "）");
}

/* ================= B · 应下 ⇒ ⛔ loveTries 不许被顶上去 ================= */
section("B · 应下 ⇒ ⛔ loveTries 保持 0（否则回看会变成「再告」那句）");
{
  const S = session("it2", { loveState: "ready", loveOn: true });
  S.run();
  const opts = S.cache["#ntFoot"].querySelectorAll(".nt-opt");
  let threw = "";
  try { opts[0].onclick(); } catch (e) { threw = e.message; }
  ok(!threw, "点「应下」不抛错（实测：" + (threw || "OK") + "）");
  ok(String(S.rec().loveState) === "accepted", "数据层真的落到 accepted");
  ok(!(Number(S.rec().loveTries) >= 1), "🔴 应下 ⇒ loveTries 保持 0（实测 " + S.rec().loveTries + "）");
  ok(String(S.rec().loveDeclinedAt || "") === "", "🔴 应下 ⇒ 不写 loveDeclinedAt（没被婉拒就谈不上有冷却）");

  const S2 = session("it2b", { loveState: "accepted", loveOn: true, lovecall: "阿砚", loveTries: 0, loveDmRound: 1 });
  S2.run();
  const b2 = (S2.cache["#ntBody"]._kids || []).join("");
  ok(b2.indexOf("那日说缓一缓") < 0, "🔴 回看里不出现「那日说缓一缓」（那是再告的词；命中=" + (b2.indexOf("那日说缓一缓") >= 0) + "）");
  ok(/这些日子/.test(b2), "回看仍是首告那句（gentle 首告开头「这些日子」）");
}

/* ================= C · round 切换（真 Love.scriptFor） ================= */
section("C · round 切换：loveTries=0 ⇒ 首告；loveTries=1 ⇒ 再告");
{
  const S = session("it3", { loveState: "none" });
  const api = S.api || {};
  const r1 = api.script ? api.script({ look: { pers: "gentle" }, loveVariant: 0, loveTries: 0 }, { id: "x" }, 1, {}) : {};
  const r2 = api.script ? api.script({ look: { pers: "gentle" }, loveVariant: 0, loveTries: 1 }, { id: "x" }, 2, {}) : {};
  ok(Number(r1.round) === 1, "loveTries=0 ⇒ round 1（实测 " + r1.round + "）");
  ok(Number(r2.round) === 2, "🔴 loveTries=1 ⇒ round 2（实测 " + r2.round + "）");
  ok(String(r1.confess || "") !== String(r2.confess || ""), "🔴 两轮 confess 字面不同（⛔ 二告不复读）");
  ok(/这些日子/.test(String(r1.confess || "")), "首告 = 「这些日子…」（实测「" + String(r1.confess || "").slice(0, 16) + "…」）");
  ok(/缓一缓/.test(String(r2.confess || "")), "再告 = 提那次被缓下来的那句（实测「" + String(r2.confess || "").slice(0, 16) + "…」）");
  ok(String(r1.declined || "") !== String(r2.declined || ""), "E 列同样分叉：首次婉拒 ≠ 二次婉拒");
}

/* ================= D · 冷却未到 ⇒ 无「挑明」；冷却已过 ⇒ 有「挑明」 ================= */
section("D · 冷却未到 ⇒ ⛔ 无「挑明」；冷却已过 ⇒ ✅ 有（真 loveCardHtml）");
{
  const c1 = session("it4a", { loveState: "declined", loveOn: true, loveTries: 1, loveDeclinedAt: dateAgo(3), loveBondLvAt: 6, bond: 280 }).card();
  ok(c1.indexOf("ERR") < 0 && c1.length > 30, "loveCardHtml 渲染成功（" + c1.length + " 字节）");
  ok(c1.indexOf("挑明") < 0, "🔴 冷却未到（3 天 < 7 天）⇒ ⛔ 无「挑明」按钮（含挑明=" + (c1.indexOf("挑明") >= 0) + "）");
  ok(!/data-love="retry"/.test(c1), "🔴 冷却未到 ⇒ ⛔ 无 data-love=\"retry\"");
  ok(c1.indexOf("缓一缓也行，往后再说。") >= 0, "冷却未到 ⇒ 只给状态行「缓一缓也行，往后再说。」");
  ok(/data-love="go"/.test(c1), "冷却未到 ⇒ 去夜话入口在（⛔ 玩家还有路走）");

  const c2 = session("it4b", { loveState: "declined", loveOn: true, loveTries: 1, loveDeclinedAt: dateAgo(10), loveBondLvAt: 6, bond: 280 }).card();
  ok(/data-love="retry"/.test(c2), "🔴 冷却已过（10 天）+ 羁绊升档 ⇒ ✅ 有「挑明」按钮（data-love=\"retry\"）");
  ok(c2.indexOf("挑明") >= 0, "按钮文案是「挑明」");
  ok(c2.indexOf("缓一缓也行，往后再说。") >= 0, "状态行照旧");
  ok(/data-love="go"/.test(c2), "挑明 + 去夜话两条路都在");

  const c3 = session("it4c", { loveState: "declined", loveOn: true, loveTries: 2, loveDeclinedAt: dateAgo(30), loveBondLvAt: 6, bond: 280 }).card();
  ok(c3.indexOf("挑明") < 0, "⛔ loveTries=2（到顶）⇒ 不再给「挑明」（最多两次告白）");

  const S4 = session("it4d", { loveState: "declined", loveTries: 1, loveDeclinedAt: dateAgo(3), loveBondLvAt: 6, bond: 280 });
  ok(S4.api.canRetry(S4.rec(), { id: "it4d" }) === false, "canReConfess（3 天）=== false ⇒ UI 无按钮");
  const S5 = session("it4e", { loveState: "declined", loveTries: 1, loveDeclinedAt: dateAgo(10), loveBondLvAt: 6, bond: 280 });
  ok(S5.api.canRetry(S5.rec(), { id: "it4e" }) === true, "canReConfess（10 天 + 升档）=== true ⇒ UI 有按钮");
}

/* ================= E · {call} 两条链路一致 ================= */
section("E · 🔴 {call} 两条链路一致（Love.fillAll 版 == 兜底版）");
{
  const RAW = "那日的话我收着，今日还是想说与{call}听：往后的日子，我想和你一处过。";
  const A = session("it5", { loveState: "none" });                 // 链路①：真 Love 在
  const B = session("it5b", { loveState: "none" }, { noLove: true }); // 链路②：Love 缺席
  ok(A.loveLoaded && !B.loveLoaded, "两个沙箱：① Love 在（" + A.loveLoaded + "）② Love 缺席（" + !B.loveLoaded + "）");
  const withLove = A.api.fill(RAW, IDNAME, { lovecall: "阿砚", bond: 200 });
  const noLove = B.api.fill(RAW, IDNAME, { lovecall: "阿砚", bond: 200 });
  ok(withLove === noLove, "🔴 两条链路同串同结果（Love 版「" + withLove + "」/ 兜底版「" + noLove + "」）");
  ok(withLove.indexOf("阿砚") >= 0 && withLove.indexOf("{call}") < 0, "{call} 真的被换成 lovecall「阿砚」");

  const lowA = A.api.fill("{call}慢些走。", IDNAME, { bond: 12 });
  const lowB = B.api.fill("{call}慢些走。", IDNAME, { bond: 12 });
  ok(lowA === lowB && lowA === "主人慢些走。", "🔴 低档两条链路都回落「主人」（实测「" + lowA + "」/「" + lowB + "」）");
  const midA = A.api.fill("{call}且坐。", IDNAME, { bond: 90 });
  const midB = B.api.fill("{call}且坐。", IDNAME, { bond: 90 });
  ok(midA === midB && midA === "你且坐。", "🔴 档 5 两条链路都叫「你」（实测「" + midA + "」/「" + midB + "」）");
}

/* ================= F · 渲染结果无残留 {ta} / {call} ================= */
section("F · 渲染结果无残留 {ta} / {call}");
{
  const S = session("it6", { loveState: "declined", loveOn: true, loveTries: 1, loveDeclinedAt: dateAgo(10), loveBondLvAt: 6, bond: 280 });
  const html = S.card();
  ok(html.indexOf("{ta}") < 0, "⛔ 心迹区渲染无残留 {ta}");
  ok(html.indexOf("{call}") < 0, "⛔ 心迹区渲染无残留 {call}");
  ok(html.indexOf(BEAD) < 0, "⛔ 不出现手串名「" + BEAD + "」");
  ok(html.indexOf("您") < 0 && html.indexOf("盘") < 0 && html.indexOf("它") < 0, "⛔ 心迹区文案 您/盘/它 全为 0");
  // 未开线那一条有 {ta}（Love 的 A 列 hint）⇒ 身份名必须真的被填进去
  const h0 = session("it6b", { loveState: "none", loveOn: false }).card();
  ok(h0.indexOf("{ta}") < 0 && h0.indexOf("{call}") < 0, "⛔ 未开线那条（Love A 列 hint 带 {ta}）也无残留");
  const h1 = session("it6c", { loveState: "confessed", loveOn: true, loveDmRound: 1 }).card();
  ok(h1.indexOf(IDNAME) >= 0, "出现身份名「" + IDNAME + "」（confessed 状态行）");
  ok(h1.indexOf(BEAD) < 0, "⛔ confessed 卡里不出现手串名「" + BEAD + "」");

  const S2 = session("it7", { loveState: "confessed", loveOn: true, loveDmRound: 1 });
  S2.run();
  const b = (S2.cache["#ntBody"]._kids || []).join("") + (S2.cache["#ntFoot"]._html || "");
  ok(b.indexOf("{ta}") < 0 && b.indexOf("{call}") < 0, "⛔ 私聊气泡流无残留 {ta} / {call}");
  ok(b.indexOf("您") < 0 && b.indexOf("盘") < 0 && b.indexOf("它") < 0, "⛔ 私聊文案 您/盘/它 全为 0");
}

/* ================= G · 🔴 Love 缺席 ⇒ 全流程不崩 ================= */
section("G · 🔴 typeof Love === \"undefined\" ⇒ 全流程不崩（走兜底）");
{
  const S = session("it8", { loveState: "ready", loveOn: true }, { noLove: true });
  ok(!S.loveLoaded, "沙箱里真的没有 Love");
  let threw = "";
  try { S.run(); } catch (e) { threw = e.message; }
  ok(!threw, "无 Love 时 renderLoveDmPage 跑通（实测：" + (threw || "OK") + "）");
  const b = (S.cache["#ntBody"]._kids || []).join("");
  ok(b.indexOf("nt-bub") >= 0 && b.indexOf("我这一片心迹") >= 0, "走兜底首告文案（LOVE_FALLBACK_1）");
  let threw2 = "";
  try { S.cache["#ntFoot"].querySelectorAll(".nt-opt")[1].onclick(); } catch (e) { threw2 = e.message; }
  ok(!threw2, "无 Love 时点「缓一缓」不抛错（实测：" + (threw2 || "OK") + "）");
  ok(String(S.rec().loveState) === "declined", "无 Love 时状态机照常落到 declined");
  ok(Number(S.rec().loveTries) === 1, "无 Love 时记账照常：loveTries = 1（实测 " + S.rec().loveTries + "）");
  ok(String(S.rec().loveDeclinedAt) === TODAY, "无 Love 时 loveDeclinedAt 照常写入（实测 " + S.rec().loveDeclinedAt + "）");

  const S2 = session("it9a", { loveState: "declined", loveOn: true, loveTries: 1, loveDeclinedAt: dateAgo(3) }, { noLove: true });
  ok(S2.card().indexOf("挑明") < 0, "无 Love + 冷却未到 ⇒ ⛔ 无「挑明」");
  const S3 = session("it9b", { loveState: "declined", loveOn: true, loveTries: 1, loveDeclinedAt: dateAgo(10) }, { noLove: true });
  ok(/data-love="retry"/.test(S3.card()), "无 Love + 冷却已过 ⇒ ✅ 走本地冷却兜底（LOVE_DM_CFG.RETRY_COOLDOWN_DAYS）给「挑明」");
  let threw3 = "";
  try { S3.api.list(); S3.api.tip([{ unread: true, name: IDNAME }]); } catch (e) { threw3 = e.message; }
  ok(!threw3, "无 Love 时列表 / 提示也不崩（实测：" + (threw3 || "OK") + "）");
}

/* ================= H · 进夜话列表的提示 toast ================= */
section("H · 进夜话列表的提示 toast：文案 + 同一天只弹一次");
{
  const S = session("itA", { loveState: "none" });
  S.api.tip([{ unread: true, name: IDNAME }]);
  ok(S.toasts.length === 1, "有未读 ⇒ 弹一次（实测 " + S.toasts.length + " 次）");
  const t1 = String(S.toasts[0] || "");
  ok(t1 === IDNAME + "有话要跟你说。", "🔴 单人提示文案：「" + t1 + "」");
  ok(t1.indexOf("您") < 0 && t1.indexOf("盘") < 0 && t1.indexOf("它") < 0, "⛔ 提示文案 您/盘/它 全为 0");
  ok(t1.indexOf(BEAD) < 0 && t1.indexOf(IDNAME) >= 0, "⛔ 用身份名，不出手串名");
  S.api.tip([{ unread: true, name: IDNAME }]);
  ok(S.toasts.length === 1, "🔴 同一天第二次 ⇒ 不再弹（日期键去重；实测仍为 " + S.toasts.length + " 次）");
  S.api.tip([]);
  ok(S.toasts.length === 1, "没有未读 ⇒ 不弹");
  // 多位 ⇒ 换模板
  const S2 = session("itB", { loveState: "none" });
  S2.api.tip([{ unread: true, name: IDNAME }, { unread: true, name: "另一位" }, { unread: false, name: "X" }]);
  ok(S2.toasts.length === 1 && String(S2.toasts[0]).indexOf("还有 1 位") >= 0,
    "🔴 多位提示文案带人数：「" + String(S2.toasts[0] || "") + "」");
}

/* ================= I · 「挑明」（retry）⇒ 走 round 2 ================= */
section("I · 点「挑明」（retry）⇒ 走 round 2，⛔ 不是首告");
{
  const S = session("itC", { loveState: "declined", loveOn: true, loveTries: 1, loveDeclinedAt: dateAgo(10), loveBondLvAt: 6, bond: 280 });
  let threw = "";
  try { S.api.act({ id: "itC", name: BEAD }, "retry", null); } catch (e) { threw = e.message; }
  ok(!threw, "loveAct(\"retry\") 不抛错（实测：" + (threw || "OK") + "）");
  ok(Number(S.rec().loveDmRound) === 2, "🔴 loveDmRound 被推到 2（这一轮演再告；实测 " + S.rec().loveDmRound + "）");
  ok(String(S.rec().loveState) === "confessed", "🔴 loveState 推到 confessed（沁灵要重新开口）");
  ok(String(S.sb.location.hash) === "#/night/dm_itC", "🔴 跳进夜话私聊（实测 " + S.sb.location.hash + "）");
  // 这一下打开的私聊必须是「再告」那句
  const S2 = session("itD", { loveState: "confessed", loveOn: true, loveDmRound: 2, loveTries: 1, loveDeclinedAt: dateAgo(10), loveBondLvAt: 6, bond: 280 });
  S2.run();
  const b = (S2.cache["#ntBody"]._kids || []).join("");
  ok(/缓一缓/.test(b), "🔴 私聊里沁灵说的是**再告**那句（提那次被缓下来；命中=" + /缓一缓/.test(b) + "）");
  ok(b.indexOf("这些日子，") < 0, "⛔ 首告那句（「这些日子，…一来我就安心」）不再出现");
  // 冷却没到 ⇒ retry 被门禁挡住，不许推进
  const S3 = session("itE", { loveState: "declined", loveOn: true, loveTries: 1, loveDeclinedAt: dateAgo(3), loveBondLvAt: 6, bond: 280 });
  S3.api.act({ id: "itE", name: BEAD }, "retry", null);
  ok(String(S3.rec().loveState) === "declined", "⛔ 冷却未到 ⇒ retry 被门禁挡住，状态不动");
  ok(Number(S3.rec().loveDmRound || 0) !== 2, "⛔ 冷却未到 ⇒ loveDmRound 不会被推到 2");
}

/* ================= J · 变体号写回「活着的那一个对象」 ================= */
section("J · Love 的变体号写回 ww_spirits 里**活着**的那一个对象（⛔ 不是副本）");
{
  const S = session("itF", { loveState: "none", look: { pers: "heroic" } });
  const store = S.sb.Spirits.load();
  const live = store.itF;
  const out = S.api.script(live, { id: "itF" }, 1, store);
  const v = Number(live.loveVariant);
  ok(v === 0 || v === 1 || v === 2, "🔴 变体号真的写回 rec.loveVariant（实测 " + v + "）");
  ok(Number(out.variant) === v, "返回值与写回值一致（" + out.variant + " == " + v + "）");
  ok(store.itF === live, "🔴 传进 Love.scriptFor 的 rec 就是 store 里那一个对象（⛔ 不是副本）");
  // 落盘后重开 ⇒ 变体号不变（不闪变）
  const S2 = session("itG", { loveState: "none", look: { pers: "heroic" }, loveVariant: 2 });
  const out2 = S2.api.script(S2.sb.Spirits.load().itG, { id: "itG" }, 1, S2.sb.Spirits.load());
  ok(Number(out2.variant) === 2, "🔴 变体号已定 ⇒ 重开游戏仍是 2（不闪变；实测 " + out2.variant + "）");
}

console.log("\n----------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
console.log(FAIL > 0 ? "⇒ 有红：V177e 恋爱线未通电" : "⇒ 全绿：V177e 恋爱线已通电（记账 / round 切换 / 二次告白）");
process.exit(FAIL > 0 ? 1 : 0);
