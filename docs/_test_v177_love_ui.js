/* ============================================================
 * _test_v177_love_ui.js · V177d 恋爱线 UI（详情页「🌸 心迹」卡片内）
 * ------------------------------------------------------------
 * 🔴 V177d 形态变更（用户裁定）：告白**不再是详情页卡片里的一句提示** ——
 *    演出整体搬进**夜话私聊**（#/night/dm_<沁灵id>，微信气泡一句句说）。
 *    心迹区只留「入口」：未开线 ⇒ 「挑明」；已开线 ⇒ 关系状态一行 + 「去夜话」。
 *    本轮断言随之演进（⛔ 不是"改前基线"，是与形态一起走的活断言）。
 *
 * 覆盖：
 *      A · 未达标（stage<4 / 羁绊档<7）⇒ 恋爱入口整块不渲染（⛔ 无灰按钮、无"还差多少"）
 *      B · 未开线 ⇒ 「挑明」（data-love="open"）；⛔ 不演出告白 / 不出现应下·缓一缓·输入框
 *      C · confessed ⇒ ⛔ 无告白文案、无「应下」/「缓一缓」、无输入框；只给状态行 + 去夜话入口
 *      D · accepted 未填 ⇒ ⛔ 输入框搬到夜话私聊，心迹区不再有 input
 *      E · accepted 已填 ⇒ 状态行「如今{ta}唤你「X」。」+ 去夜话回看入口
 *      F · declined ⇒ 状态行 + 去夜话入口（⛔ 不再给「挑明」：主动权只在第一次）
 *      G · 去物化负向扫描：恋爱 UI 文案 您=0 / 盘=0 / 它=0 / 玩意·一串=0
 *      H · 身份名：只出身份名，⛔ 不出手串名
 *      I · lovecall 生效后沁灵对玩家的称呼走 lovecall（回落链逐档验）
 *      J · ready 态 ⇒ 同样只给入口（⛔ 不重复给「挑明」）
 *      K · 去夜话入口指向私聊路由 #/night/dm_<id>（新形态锚点）
 *
 * 只按「抽 app.js 真实源码 + vm 跑」的方式，不 require 整个 app.js、不依赖 DOM。
 * 基准：`72aab30`（V177d 落地前 —— 告白还在心迹卡片里）。
 * 用法： node docs/_test_v177_love_ui.js
 * 负向对照（🔴 必做）：
 *   git worktree add /tmp/_base 72aab30
 *   cp docs/_test_v177_love_ui.js /tmp/_base/docs/ && cd /tmp/_base && node docs/_test_v177_love_ui.js
 *   ⇒ 必须红（基线心迹区还在演出告白 + 应下/缓一缓 + 称谓输入框，C/D/E/F 全红，K 全红）
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_PATH = process.env.V177_UI_APP_SRC || path.join(ROOT, "js", "app.js");
const APP = fs.readFileSync(APP_PATH, "utf8").replace(/\r\n/g, "\n");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }

console.log("V177d 恋爱线 UI 自测（心迹区 = 入口，演出在夜话私聊）　源码：" + APP_PATH);
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

/* ---------- 标签栈解析 ---------- */
const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);
function parse(html) {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  const stack = [], problems = [];
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/", tag = m[2].toLowerCase(), selfClose = m[4] === "/";
    if (closing) {
      if (!stack.length) { problems.push("多余闭合 </" + tag + ">"); continue; }
      const top = stack[stack.length - 1];
      if (top.tag !== tag) { problems.push("错配 <" + top.tag + "> vs </" + tag + ">"); continue; }
      stack.pop();
    } else if (!VOID.has(tag) && !selfClose) { stack.push({ tag: tag }); }
  }
  return { problems: problems, stack: stack };
}

/* ---------- 沙箱 ---------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LEVELS = [0, 12, 30, 55, 90, 140, 200, 280];
const LNAMES = ["照面", "眼熟", "相熟", "同室", "通意", "同心", "相知", "沁透"];
function stubBondLevel(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (v >= LEVELS[k]) i = k;
  return { value: v, lv: i, lv1: i + 1, name: LNAMES[i], pct: 50 };
}
const BEAD = "莫高窟", IDNAME = "陆临崖";      // 手串名 ≠ 身份名（身份名夹具）

function makeSandbox() {
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, parseInt: parseInt, parseFloat: parseFloat,
    isNaN: isNaN, isFinite: isFinite, String: String, Number: Number, Boolean: Boolean,
    Array: Array, Object: Object, Error: Error, RegExp: RegExp, Promise: Promise, Intl: Intl,
    Map: Map, Set: Set, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    esc: esc,
    location: { hash: "" },
    spiritName: (it) => (it && it.name) || "那只",
    spiritIdentityOf: (disp) => (String(disp || "") === BEAD ? { name: IDNAME, style: "瞻丹", bead: BEAD } : null),
    // ⛔ 全程不定义 window.Love —— 断言必须证明「Love 缺席也不崩、走兜底文案」
    CUR: { state: "none", loveOn: false, lovecall: "" },
    Spirits: {
      heartLevel: (n) => ({ value: n, lv: 1, lv1: 2, name: "微澜", atMax: false }),
      bondLevel: stubBondLevel,
      todayKey: () => "2026-10-03",
      GIFT_CFG: { DAILY_GLOBAL: 2, QUALIFY_LV: 3 },
      CARE_ACTS: [{ id: "clean", name: "擦净" }, { id: "sit", name: "静坐" }, { id: "thread", name: "理线" }],
      careDoneOf: () => 0,
      giftGivenToday: () => 0,
      GIFT_COPY: {
        open: "递一件给{ta}", qualifying: "{ta}还没到接你东西的分上。", emptyStock: "你手上还没有可递的东西。",
        alreadyHeld: "{ta}已经收着呢。", dayFull: "今天递得够多了。明天再说。", hitNote: "{ta}会喜欢这一类。",
      },
      LOVE_CFG: { STAGE_MIN: 4, BOND_LV_MIN: 7 },
      LOVE_STATES: ["none", "ready", "confessed", "accepted", "declined"],
      // 与 spirits.js loveGate 同口径：stage≥4 && 羁绊档≥7，⛔ 无天数门槛
      loveGate: (rec, item) => {
        const r = rec || {};
        const stage = Math.max(1, Number(r.stage || 1));
        const lv1 = stubBondLevel(Number(r.bond) || 0).lv1;
        const st = String(r.loveState || "none");
        const res = { ok: false, reason: "", stage: stage, bondLv: lv1, heartLv: 1,
                      state: st, canConfess: false, lovecall: String(r.lovecall || "").trim() };
        if (stage < 4) { res.reason = "stage"; return res; }
        if (lv1 < 7) { res.reason = "bond"; return res; }
        res.ok = true;
        res.canConfess = (st === "none" || st === "ready" || st === "declined");
        return res;
      },
      loveStateOf: () => sb.CUR,
    },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  return sb;
}

/* v177d：恋爱块依赖的源码件（常量 + 文案兜底 + 纯函数）—— 一并抽进沙箱 */
const SRC_LIB = [
  tryExtractConst("LOVE_DM_CFG"),
  tryExtractConst("LOVE_FALLBACK_1"),
  tryExtractConst("LOVE_FALLBACK_2"),
  tryExtractConst("LOVE_KEYS"),
  tryExtractFn("loveScript"),
  tryExtractFn("loveCanReConfess"),
  tryExtractFn("loveFill"),
  tryExtractFn("loveRoundOf"),
  tryExtractFn("loveDmTid"),
  tryExtractFn("loveDmUrl"),
  tryExtractFn("loveWhoOf"),
].filter(Boolean).join("\n");

const FN_LOVE = tryExtractFn("loveCardHtml");
const FN_HEART = tryExtractFn("heartCardHtml");
const FN_FILL = tryExtractFn("fillTa") || "function fillTa(t, n) { return String(t == null ? '' : t); }";
const FN_PCT = tryExtractFn("xtHeartPct");
const CONST_MARKS = tryExtractConst("XT_HEART_MARKS");

function renderLove(fixture, cur) {
  if (!FN_LOVE || !SRC_LIB) return "";
  const sb = makeSandbox();
  sb.CUR = cur;
  const ctx = vm.createContext(sb);
  try {
    vm.runInContext(SRC_LIB + "\n" + FN_FILL + "\n" + FN_LOVE + "\n;__fn = loveCardHtml;", ctx, { filename: "app.js#loveCardHtml" });
    return String(sb.__fn({ id: "it1", name: BEAD }, fixture, IDNAME) || "");
  } catch (e) { console.log("    （renderLove 抛错： " + e.message + "）"); return ""; }
}
function renderCard(fixture, cur) {
  if (!FN_HEART || !FN_LOVE) return "";
  const sb = makeSandbox();
  sb.CUR = cur;
  const ctx = vm.createContext(sb);
  try {
    vm.runInContext(SRC_LIB + "\n" + CONST_MARKS + "\n" + FN_FILL + "\n" + FN_PCT + "\n" + FN_LOVE + "\n" + FN_HEART +
      "\n;__fn = heartCardHtml;", ctx, { filename: "app.js#heartCardHtml" });
    return String(sb.__fn({ id: "it1", name: BEAD }, fixture, {}) || "");
  } catch (e) { console.log("    （renderCard 抛错： " + e.message + "）"); return ""; }
}

const OKAY = { stage: 4, bond: 200, loveState: "none" };          // 阶 4 + 羁绊档 7 ⇒ 达标
const LOW_STAGE = { stage: 3, bond: 200, loveState: "none" };     // 阶不足
const LOW_BOND = { stage: 4, bond: 140, loveState: "none" };      // 羁绊档 6 不足

/* ================= A · 未达标 ⇒ 整块不渲染 ================= */
section("A · 未达标（stage<4 / 羁绊档<7）⇒ 恋爱入口整块不渲染");
{
  const a = renderLove(LOW_STAGE, { state: "none", loveOn: false, lovecall: "" });
  const b = renderLove(LOW_BOND, { state: "none", loveOn: false, lovecall: "" });
  ok(a === "", "阶不足（stage=3）⇒ 恋爱块为空（实测 " + a.length + " 字节）");
  ok(b === "", "羁绊档不足（bond=140 → 档 6）⇒ 恋爱块为空（实测 " + b.length + " 字节）");
  ok(a.indexOf("挑明") < 0 && b.indexOf("挑明") < 0, "⛔ 未达标时不出现「挑明」入口");
  ok(a.indexOf("还差") < 0 && b.indexOf("还差") < 0, "⛔ 未达标时不出现「还差多少」这类鸡肋提示");
}

/* ================= B · 未开线 ⇒ 只给「挑明」 ================= */
section("B · 达标未开线 ⇒ 只给「挑明」（⛔ 演出不在详情页）");
let B1 = "";
{
  B1 = renderLove(OKAY, { state: "none", loveOn: false, lovecall: "" });
  ok(B1.indexOf("挑明") >= 0, "出现「挑明」按钮");
  ok(/data-love="open"/.test(B1), "按钮携带 data-love=\"open\"（供事件委托）");
  ok(/data-id="it1"/.test(B1), "按钮携带 data-id=\"it1\"（逐串定位）");
  ok(B1.indexOf("{ta}") < 0, "无残留 {ta} 占位符");
  ok(B1.indexOf("应下") < 0 && B1.indexOf("缓一缓") < 0, "⛔ 未开线时不出现「应下 / 缓一缓」");
  ok(!/<input/i.test(B1), "⛔ 未开线时不出现称谓输入框");
}

/* ================= C · confessed ⇒ 只给状态行 + 去夜话入口 ================= */
section("C · confessed ⇒ ⛔ 不演出告白，只给状态行 + 去夜话入口");
let C1 = "";
{
  C1 = renderLove(OKAY, { state: "confessed", loveOn: true, lovecall: "" });
  ok(C1.indexOf("我这一片心迹") < 0, "⛔ 心迹区不再直接演出告白语（演出在夜话私聊）");
  ok(!/data-love="accept"/.test(C1) && C1.indexOf("应下") < 0, "⛔ 不再渲染「应下」按钮");
  ok(!/data-love="decline"/.test(C1) && C1.indexOf("缓一缓") < 0, "⛔ 不再渲染「缓一缓」按钮（缓一缓在夜话里）");
  ok(!/<input/i.test(C1) && C1.indexOf("xtLovecallInput") < 0, "⛔ confessed 阶段不出现称谓输入框");
  ok(/data-love="go"/.test(C1) && C1.indexOf("去夜话") >= 0, "给出去夜话入口（data-love=\"go\" + 「去夜话」）");
  ok(C1.indexOf(IDNAME + "有话要说") >= 0, "状态行点名身份名：\"" + IDNAME + "有话要说\"（{ta} 已解析）");
  const r1 = parse(C1);
  ok(r1.problems.length === 0 && r1.stack.length === 0, "confessed 块标签栈平衡");
}

/* ================= D · accepted 未填 ⇒ 输入框已搬到夜话 ================= */
section("D · accepted 且未填称谓 ⇒ ⛔ 心迹区无输入框，只有去夜话入口");
let D1 = "";
{
  D1 = renderLove(OKAY, { state: "accepted", loveOn: true, lovecall: "" });
  ok(!/<input/i.test(D1), "⛔ 心迹区不再渲染 <input>（称谓在夜话私聊里填）");
  ok(D1.indexOf("xtLovecallInput") < 0, "⛔ 心迹区不再出现 xtLovecallInput");
  ok(/data-love="go"/.test(D1) && D1.indexOf("去夜话") >= 0, "给出去夜话入口");
  ok(D1.indexOf(IDNAME + "在等你一个称呼") >= 0, "状态行：「" + IDNAME + "在等你一个称呼。」");
}

/* ================= E · accepted 已填 ⇒ 状态行 + 回看入口 ================= */
section("E · accepted 且已填称谓 ⇒ 状态行「如今{ta}唤你「X」。」+ 去夜话回看");
let E1 = "";
{
  E1 = renderLove(OKAY, { state: "accepted", loveOn: true, lovecall: "阿砚" });
  ok(!/<input/i.test(E1), "⛔ 已填过 ⇒ 整块不再出现 <input>");
  ok(E1.indexOf("xtLovecallInput") < 0, "⛔ 已填过 ⇒ 输入框 id 不出现");
  ok(E1.indexOf("如今" + IDNAME + "唤你「阿砚」。") >= 0, "展示既有称谓：如今" + IDNAME + "唤你「阿砚」。");
  ok(E1.indexOf("确定") < 0, "⛔ 已填过 ⇒ 不再出现「确定」按钮");
  ok(/data-love="go"/.test(E1), "已填过仍给去夜话回看入口（那句话还能再看）");
}

/* ================= F · declined ⇒ 状态行 + 回看入口（⛔ 不再给挑明） ================= */
section("F · declined ⇒ 状态行 + 去夜话入口（⛔ 不再给「挑明」）");
let F1 = "";
{
  F1 = renderLove(OKAY, { state: "declined", loveOn: true, lovecall: "" });
  ok(F1.indexOf("缓一缓也行，往后再说。") >= 0, "文案「缓一缓也行，往后再说。」在");
  ok(!/data-love="open"/.test(F1) && F1.indexOf("挑明") < 0,
    "⛔ V177d 新裁定：心迹区不再给「挑明」（玩家主动权只在第一次；二次告白由沁灵在夜话里找上门）");
  ok(/data-love="go"/.test(F1), "给出去夜话回看入口");
  ok(!/<input/i.test(F1), "declined 阶段不出现称谓输入");
}

/* ================= G · 去物化 / 敬称 负向扫描 ================= */
section("G · 去物化 + 敬称 负向扫描（恋爱 UI 新渲染文案）");
{
  const all = [B1, C1, D1, E1, F1].join("\n");
  ok(all.length > 100, "五个 state 分支合计渲染出非空 HTML（" + all.length + " 字节）");
  ok(all.indexOf("您") < 0, "⛔ 敬称「您」= 0（实测 " + (all.split("您").length - 1) + "）");
  ok(all.indexOf("盘") < 0, "⛔ 物化「盘」= 0（实测 " + (all.split("盘").length - 1) + "）");
  ok(all.indexOf("它") < 0, "⛔ 物化「它」= 0（实测 " + (all.split("它").length - 1) + "）");
  ok(all.indexOf("玩意") < 0 && all.indexOf("一串") < 0, "⛔ 「玩意 / 一串」= 0");
  // 源码层同扫（防渲染分支没覆盖到的文案漏网）
  const srcBlk = FN_LOVE || "";
  ok(srcBlk.length > 0, "app.js 能抽出 loveCardHtml（抽不到 ⇒ 未落地）");
  ok(srcBlk.indexOf("您") < 0 && srcBlk.indexOf("盘") < 0 && srcBlk.indexOf("它") < 0,
    "⛔ loveCardHtml 源码内 您/盘/它 全为 0");
  // 兜底文案（Love 缺席时顶上）同样受纪律约束
  const fb = (tryExtractConst("LOVE_FALLBACK_1") + tryExtractConst("LOVE_FALLBACK_2")) || "";
  ok(fb.length > 50, "能抽到文案兜底常量（LOVE_FALLBACK_1 / 2）");
  ok(fb.indexOf("您") < 0 && fb.indexOf("盘") < 0 && fb.indexOf("它") < 0 && fb.indexOf("玩意") < 0,
    "⛔ 兜底文案内 您/盘/它/玩意 全为 0");
}

/* ================= H · 身份名（⛔ 不出手串名） ================= */
section("H · 身份名：只出身份名，⛔ 不出手串名");
{
  const card = renderCard(OKAY, { state: "confessed", loveOn: true, lovecall: "" });
  ok(card.length > 200, "整张心迹卡渲染成功（" + card.length + " 字节）");
  ok(card.indexOf(IDNAME) >= 0, "心迹卡里出现身份名「" + IDNAME + "」");
  ok(card.indexOf(BEAD) < 0, "⛔ 心迹卡里不出现手串名「" + BEAD + "」");
  // ⚠️ 整卡里 per-spirit 计数/送礼按钮的 {ta} 是**故意留字面量**交详情页末尾 fillTa 统一替换的（既有约定），
  //    所以只钉「恋爱块」：恋爱文案一律本地 fillTa，块内必须零残留。
  const lovePart = card.slice(Math.max(0, card.indexOf('class="xt-love"')));
  ok(lovePart.length > 50 && lovePart.indexOf("{ta}") < 0, "恋爱块内无残留 {ta}（本地 fillTa 已解析）");
  const r = parse(card);
  ok(r.problems.length === 0 && r.stack.length === 0, "整张心迹卡标签栈平衡");
}

/* ================= I · lovecall 回落链（真 spirits.js） ================= */
section("I · 沁灵对玩家的称呼回落链（真 spirits.js · callFor）");
{
  let SP = null;
  try {
    const harness = require("./_harness.js");
    const H = harness.makeContext();
    harness.loadFile(H.ctx, "js/spirits.js");
    SP = H.sandbox.Spirits;
  } catch (e) { /* 留到断言里报 */ }
  ok(!!SP && typeof SP.callFor === "function", "spirits.js 能加载并取到 callFor");
  if (SP && typeof SP.callFor === "function") {
    const r1 = { bond: 200, lovecall: "阿砚", nickCall: "" };          // 档 7 + 已填专属称谓
    ok(SP.callFor(r1) === "阿砚", "lovecall 非空 ⇒ 最高优先，称「阿砚」（实测 " + SP.callFor(r1) + "）");
    const r2 = { bond: 12, lovecall: "阿砚", nickCall: "" };           // 低档 + 已填 ⇒ 仍走 lovecall
    ok(SP.callFor(r2) === "阿砚", "低档（档 2）已填 ⇒ 仍称「阿砚」（⛔ 不回落主人）");
    const r3 = { bond: 200, lovecall: "", nickCall: "阿砚" };          // 未填 ⇒ 走 nickCall
    ok(SP.callFor(r3) === "阿砚", "未填 lovecall + 档 7 ⇒ 走 nickCall「阿砚」（实测 " + SP.callFor(r3) + "）");
    const r4 = { bond: 200, lovecall: "", nickCall: "" };
    ok(SP.callFor(r4) !== "阿砚", "未填 lovecall ⇒ ⛔ 绝不冒用专属称谓（实测 " + SP.callFor(r4) + "）");
    const r5 = { bond: 55, lovecall: "", nickCall: "阿砚" };           // 档 4「同室」⇒ 你
    ok(SP.callFor(r5) === "你", "档 4 未填 ⇒ 称「你」（⛔ 不是昵称、不是主人）");
  }
}

/* ================= J · ready 态（开线后未告白的过渡态） ================= */
section("J · ready 态 ⇒ 同样只给去夜话入口");
{
  const j = renderLove(OKAY, { state: "ready", loveOn: true, lovecall: "" });
  ok(/data-love="go"/.test(j) && j.indexOf("去夜话") >= 0, "ready ⇒ 去夜话入口在（沁灵在那边先开口）");
  ok(j.indexOf("挑明") < 0, "ready ⇒ ⛔ 不再重复渲染「挑明」");
  ok(j.indexOf("应下") < 0 && !/<input/i.test(j), "ready ⇒ ⛔ 心迹区不出现「应下」与称谓输入框");
}

/* ================= K · 去夜话入口指向夜话私聊路由 ================= */
section("K · 去夜话入口 ⇒ 夜话私聊路由 #/night/dm_<沁灵id>");
{
  const sb = makeSandbox();
  const ctx = vm.createContext(sb);
  try {
    vm.runInContext(SRC_LIB + "\n;__tid = loveDmTid; __url = loveDmUrl;", ctx, { filename: "app.js#loveDm" });
  } catch (e) { /* 留到断言里报 */ }
  ok(typeof sb.__tid === "function", "能抽到 loveDmTid（抽不到 ⇒ 私聊路由未落地）");
  ok(typeof sb.__tid === "function" && sb.__tid("it1") === "dm_it1", "loveDmTid(\"it1\") === \"dm_it1\"（实测 " + (sb.__tid ? sb.__tid("it1") : "-") + "）");
  ok(typeof sb.__url === "function" && sb.__url("it1") === "#/night/dm_it1", "loveDmUrl(\"it1\") === \"#/night/dm_it1\"（实测 " + (sb.__url ? sb.__url("it1") : "-") + "）");
  ok(APP.indexOf("#/night/") >= 0 && /indexOf\(LOVE_DM_CFG\.TID\)/.test(APP), "路由解析里接住了 dm_ 前缀（源码级：LOVE_DM_CFG.TID 判定在）");
}

console.log("\n----------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
console.log(FAIL > 0 ? "⇒ 有红：V177d 心迹区改造未落地" : "⇒ 全绿：V177d 心迹区 = 入口，演出已搬进夜话私聊");
process.exit(FAIL > 0 ? 1 : 0);
