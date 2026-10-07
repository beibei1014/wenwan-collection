/* ============================================================
 * _test_v177_dm.js · V177d 夜话「私聊」会话（沁灵单独找你说话）
 * ------------------------------------------------------------
 * 🔴 用户裁定：告白不要详情页卡片里的一句提示 —— 要的是**夜话版块里那只沁灵
 *    单独给你发消息**，用微信气泡一句句说。本文件锚定这个新形态：
 *
 *      A · 私聊路由 / 外壳挂点（源码级，防接线掉了没人发现）
 *      B · 🔴 typeof Love === "undefined" 时容错不崩（js/love.js 尚未落地，两套并行开发）
 *      C · 气泡序列 4 个阶段各自渲染（⛔ 一句句来，不糊一大段）
 *      D · 称谓输入框门禁（一次定终身：填过 ⇒ 不再给输入框）
 *      E · 私聊列表 + 未读 + 二次告白（沁灵自己找上门，⛔ 玩家不点按钮）
 *      F · Love 一旦落地 ⇒ 自动接管文案（兜底让位，不用改 app.js）
 *
 * 只按「抽 app.js 真实源码 + vm 跑」的方式，不 require 整个 app.js、不依赖 DOM。
 * 基准：`72aab30`（V177d 落地前 —— 夜话里根本没有私聊这种会话）。
 * 用法： node docs/_test_v177_dm.js
 * 负向对照（🔴 必做）：
 *   git worktree add /tmp/_base 72aab30
 *   cp docs/_test_v177_dm.js /tmp/_base/docs/ && cd /tmp/_base && node docs/_test_v177_dm.js
 *   ⇒ 必须红（基线无 LOVE_DM_CFG / loveDm* / renderLoveDmPage，A~F 全红）
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_PATH = process.env.V177_DM_APP_SRC || path.join(ROOT, "js", "app.js");
const APP = fs.readFileSync(APP_PATH, "utf8").replace(/\r\n/g, "\n");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

console.log("V177d 夜话·私聊（DM）自测　源码：" + APP_PATH);
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

const BEAD = "莫高窟", IDNAME = "陆临崖";      // 手串名 ≠ 身份名（身份名夹具）
const LOVE_STATES = ["none", "ready", "confessed", "accepted", "declined"];

/* v177d 私聊所需的全部源码件 —— 一并抽进沙箱（⛔ 抽不到 = 未落地 ⇒ 直接红） */
const LIB = [
  tryExtractConst("LOVE_DM_CFG"),
  tryExtractConst("LOVE_FALLBACK_1"),
  tryExtractConst("LOVE_FALLBACK_2"),
  tryExtractConst("LOVE_KEYS"),
  tryExtractFn("loveScript"),
  tryExtractFn("loveCanReConfess"),
  tryExtractFn("loveCanRetry"),
  tryExtractFn("loveDaysSinceDeclined"),
  tryExtractFn("loveMarkRound"),
  tryExtractFn("loveSettleBook"),
  tryExtractFn("loveFill"),
  tryExtractFn("loveRoundOf"),
  tryExtractFn("loveDmTid"),
  tryExtractFn("loveDmUrl"),
  tryExtractFn("loveDmToken"),
  tryExtractFn("loveDmMsgs"),
  tryExtractFn("loveDmNeedInput"),
  tryExtractFn("loveWhoOf"),
  tryExtractFn("loveDmList"),
].filter(Boolean).join("\n");

/* ---------- 沙箱（🔴 默认**不定义** Love：证明文案库缺席也不崩） ---------- */
function makeSb(store, items, love) {
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, String: String, Number: Number,
    Boolean: Boolean, Array: Array, Object: Object, Error: Error, RegExp: RegExp,
    parseInt: parseInt, isFinite: isFinite, isNaN: isNaN,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    spiritItems: () => items,
    spiritName: (it) => (it && it.name) || "那只",
    spiritIdentityOf: (d) => (String(d || "") === BEAD ? { name: IDNAME, style: "瞻丹", bead: BEAD } : null),
    location: { hash: "" },
    Spirits: {
      LOVE_STATES: LOVE_STATES,
      LOVE_CFG: { STAGE_MIN: 4, BOND_LV_MIN: 7 },
      load: () => store,
      // 回落链：lovecall → nickCall → 你（与 spirits.js callFor 同口径）
      callFor: (rec) => String((rec && rec.lovecall) || "").trim() ||
        String((rec && rec.nickCall) || "").trim() || "你",
      loveGate: (rec) => {
        const r = rec || {};
        const stage = Math.max(1, Number(r.stage || 1));
        const b = Math.max(0, Math.floor(Number(r.bond) || 0));
        let i = 0; [0, 12, 30, 55, 90, 140, 200, 280].forEach((n, k) => { if (b >= n) i = k; });
        const st = String(r.loveState || "none");
        const res = { ok: false, reason: "", stage: stage, bondLv: i + 1, heartLv: 1,
                      state: st, canConfess: false, lovecall: String(r.lovecall || "").trim() };
        if (stage < 4) { res.reason = "stage"; return res; }
        if (i + 1 < 7) { res.reason = "bond"; return res; }
        res.ok = true;
        res.canConfess = (st === "none" || st === "ready" || st === "declined");
        return res;
      },
      loveStateOf: (id) => {
        const r = store[id] || {};
        const st = String(r.loveState || "none");
        return { state: LOVE_STATES.indexOf(st) >= 0 ? st : "none",
                 loveOn: !!r.loveOn, lovecall: String(r.lovecall || ""), at: String(r.loveAt || "") };
      },
    },
  };
  if (love) sb.Love = love;                  // 只有 F 段会传 —— 模拟 js/love.js 已落地
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  return sb;
}

// 源码一件都抽不到时的空 api（⛔ 基线负向对照要「干净报红」，不许抛栈崩掉）
const EMPTY_API = {
  script: () => ({}), msgs: () => [], need: () => false, tid: () => "", url: () => "",
  list: () => [], token: () => "", who: () => "", cfg: {},
};
// 在沙箱里跑 LIB，返回 { sb, api }
function boot(store, items, love) {
  const sb = makeSb(store, items, love);
  const ctx = vm.createContext(sb);
  try {
    vm.runInContext(LIB +
      "\n;__api = { script: loveScript, msgs: loveDmMsgs, need: loveDmNeedInput, tid: loveDmTid," +
      " url: loveDmUrl, list: loveDmList, token: loveDmToken, who: loveWhoOf, cfg: LOVE_DM_CFG };",
      ctx, { filename: "app.js#loveDm" });
  } catch (e) { /* 抽不到源码（基线）⇒ 交给断言报红，⛔ 不抛栈 */ }
  return { sb: sb, api: sb.__api || EMPTY_API };
}

const IT = { id: "it1", name: BEAD };
const IT2 = { id: "it2", name: "另一串" };
const IT3 = { id: "it3", name: "又一串" };
const OKAY = { stage: 4, bond: 200 };

/* ================= A · 私聊路由 / 外壳挂点（源码级） ================= */
section("A · 私聊路由 / 外壳挂点（源码级）");
{
  ok(LIB.indexOf("LOVE_DM_CFG") >= 0, "能抽到 LOVE_DM_CFG 常量（抽不到 ⇒ 私聊未落地）");
  const b = boot({}, [IT], null);
  ok(typeof b.api.tid === "function" && b.api.tid("it1") === "dm_it1",
    "loveDmTid(\"it1\") === \"dm_it1\"（实测 " + (b.api.tid ? b.api.tid("it1") : "-") + "）");
  ok(typeof b.api.url === "function" && b.api.url("it1") === "#/night/dm_it1",
    "loveDmUrl(\"it1\") === \"#/night/dm_it1\"（实测 " + (b.api.url ? b.api.url("it1") : "-") + "）");
  ok(b.api.cfg && Number(b.api.cfg.CALL_MAX) === 12, "称谓字数上限 CALL_MAX === 12（与数据层同口径）");
  ok(tryExtractFn("renderLoveDmPage").length > 200, "app.js 能抽出 renderLoveDmPage（⛔ 抽不到 = 私聊页没写）");
  ok(/String\(seg\[0\] \|\| ""\)\.indexOf\(LOVE_DM_CFG\.TID\) === 0/.test(APP) &&
     /renderLoveDmPage\(/.test(APP),
    "路由 #/night/ 分支里接住了 dm_ 前缀并转 renderLoveDmPage（源码级）");
  ok(/typeof o\.onFoot === "function"/.test(APP), "renderTalkPage 有 onFoot 扩展挂点（称谓输入框靠它挂）");
  ok(/loveDmList\(\)/.test(APP) && /LOVE_DM_CFG\.SEC/.test(APP), "夜话列表渲染「私聊」分组（源码级）");
}

/* ================= B · 🔴 Love 缺席 ⇒ 容错不崩 ================= */
section("B · 🔴 typeof Love === \"undefined\" ⇒ 走兜底文案，绝不白屏");
let SC1 = null;
{
  const b = boot({}, [IT], null);                 // ⛔ 沙箱里没有 Love
  let threw = false, sc = null;
  try { sc = b.api.script({ stage: 4, bond: 200 }, IT, 1); } catch (e) { threw = true; }
  SC1 = sc;
  ok(!threw && !!sc && typeof sc.confess === "string",
    "Love 缺席时 loveScript() 不抛错、且真返回了 confess（🔴 白屏防线）");
  ok(!!sc && ["hint", "confess", "callAsk", "accepted", "declined"].every((k) => String(sc[k] || "").trim().length > 0),
    "兜底五列（hint / confess / callAsk / accepted / declined）全部非空");
  ok(!!sc && Number(sc.round) === 1, "Love 缺席 ⇒ round 回落 1（实测 " + (sc && sc.round) + "）");
  // Love 抛错也必须有兜底
  const b2 = boot({}, [IT], { scriptFor: () => { throw new Error("love.js 炸了"); }, canReConfess: () => { throw new Error("x"); } });
  let sc2 = null, threw2 = false;
  try { sc2 = b2.api.script({ stage: 4, bond: 200 }, IT, 1); } catch (e) { threw2 = true; }
  ok(!threw2 && !!sc2 && String(sc2.confess || "").length > 0, "Love.scriptFor 抛错 ⇒ 仍回落兜底（⛔ 绝不向上抛）");
  const fbAll = String(Object.values(SC1 || {}).join(""));
  ok(fbAll.indexOf("您") < 0, "⛔ 兜底文案敬称「您」= 0");
  ok(fbAll.indexOf("盘") < 0 && fbAll.indexOf("它") < 0, "⛔ 兜底文案物化「盘 / 它」= 0");
  ok(fbAll.indexOf("玩意") < 0 && fbAll.indexOf("一串") < 0, "⛔ 兜底文案「玩意 / 一串」= 0");
  ok(String(SC1.confess).indexOf("我") >= 0, "沁灵自称一律「我」（兜底 confess 实测：" + SC1.confess + "）");
  const fb1 = tryExtractConst("LOVE_FALLBACK_1"), fb2 = tryExtractConst("LOVE_FALLBACK_2");
  ok(fb1.length > 50 && fb2.length > 50, "两套兜底都在（首轮 / 第二轮）");
  ok(fb1 !== fb2 && /confess/.test(fb2), "第二轮兜底与首轮不同（⛔ 二次告白不能复读同一句）");
}

/* ================= C · 气泡序列 4 阶段 ================= */
section("C · 气泡序列：①告白 → ②应下 → ③问称谓 → ④填称谓 → ⑤接住");
const WHO = IDNAME;
function msgsOf(state, lovecall, round) {
  const b = boot({}, [IT], null);
  return b.api.msgs({ state: state, loveOn: true, lovecall: lovecall || "" },
    b.api.script({ stage: 4, bond: 200 }, IT, round || 1), WHO);
}
let M1 = [], M2 = [], M3 = [], M4 = [];
{
  M1 = msgsOf("confessed", "", 1);
  ok(M1.length === 1, "阶段①（confessed）⇒ 只有 1 条：沁灵的告白（实测 " + M1.length + " 条）");
  ok(M1.length >= 1 && M1[0].w === "A" && String(M1[0].text || "").length > 0, "第 1 条是沁灵（w=\"A\"）说的、非空");
  ok(M1.length >= 1 && M1[0].name === WHO, "气泡上的名字是身份名「" + WHO + "」");

  M2 = msgsOf("accepted", "", 1);
  ok(M2.length === 3, "阶段②③（accepted 未填称谓）⇒ 3 条：告白 + 我应下 + 问称谓（实测 " + M2.length + "）");
  ok(M2.length === 3 && M2[1].w === "me" && M2[1].text === "应下", "第 2 条是「我」回的「应下」");
  ok(M2.length === 3 && M2[2].w === "A" && String(M2[2].text || "").length > 0, "第 3 条是沁灵的称谓引导");

  M3 = msgsOf("accepted", "阿砚", 1);
  ok(M3.length === 5, "阶段④⑤（已填称谓）⇒ 5 条：… + 我填称谓 + 沁灵接住（实测 " + M3.length + "）");
  ok(M3.length === 5 && M3[3].w === "me" && M3[3].text === "阿砚", "第 4 条是「我」填下的称谓「阿砚」");
  ok(M3.length === 5 && M3[4].w === "A" && String(M3[4].text || "").length > 0, "第 5 条是沁灵接住的那句");

  M4 = msgsOf("declined", "", 1);
  ok(M4.length === 3, "缓一缓分支 ⇒ 3 条：告白 + 我缓一缓 + 沁灵收住（实测 " + M4.length + "）");
  ok(M4.length === 3 && M4[1].w === "me" && M4[1].text === "缓一缓", "第 2 条是「我」回的「缓一缓」");
  ok(M4.length === 3 && String(M4[2].text || "") !== String(M3[4].text || ""), "缓一缓的收尾句 ≠ 应下的接住句（两条分支各自有话）");

  const allM = [].concat(M1, M2, M3, M4);
  ok(allM.every((m) => String(m.text || "").indexOf("\n") < 0 && String(m.text || "").length <= 60),
    "⛔ 每条气泡都是单句（无换行、≤60 字）—— 一句句来，不糊一大段");
  const txt = allM.map((m) => m.text).join("");
  ok(txt.indexOf("您") < 0 && txt.indexOf("盘") < 0 && txt.indexOf("它") < 0,
    "⛔ 私聊气泡文案 您/盘/它 全为 0");
  ok(msgsOf("none", "", 1).length === 0, "还没挑明（state=none）⇒ 私聊一条都没有（⛔ 沁灵不会凭空找上门）");
}

/* ================= D · 称谓输入框门禁（一次定终身） ================= */
section("D · 称谓输入框门禁：填过 ⇒ 不再给输入框");
{
  const b = boot({}, [IT], null);
  ok(b.api.need({ state: "accepted", lovecall: "" }) === true, "accepted + 未填 ⇒ 给输入框");
  ok(b.api.need({ state: "accepted", lovecall: "阿砚" }) === false, "⛔ accepted + 已填（locked）⇒ 不再给输入框");
  ok(b.api.need({ state: "confessed", lovecall: "" }) === false, "confessed ⇒ 不给输入框（还没到那一步）");
  ok(b.api.need({ state: "declined", lovecall: "" }) === false, "declined ⇒ 不给输入框");
  ok(b.api.need({ state: "none", lovecall: "" }) === false, "none ⇒ 不给输入框");
}

/* ================= E · 私聊列表 / 未读 / 二次告白 ================= */
section("E · 私聊列表 · 未读 · 二次告白（沁灵自己找上门）");
{
  // it1 = 已挑明（confessed，未读）；it2 = 从未挑明（none）
  const store1 = { it1: Object.assign({}, OKAY, { loveState: "confessed", loveOn: true }), it2: Object.assign({}, OKAY, { loveState: "none" }) };
  const L1 = boot(store1, [IT, IT2], null).api.list();
  ok(L1.length === 1, "⛔ 没挑明的（it2 / state=none）不进私聊列表（实测 " + L1.length + " 条）");
  ok(L1.length === 1 && L1[0].sid === "it1", "已挑明的那只进列表");
  ok(L1.length === 1 && L1[0].unread === true, "挑明后 ⇒ 未读（沁灵在那边等你）");
  ok(L1.length === 1 && L1[0].tid === "dm_it1", "列表 tid 带 dm_ 前缀（⛔ 与群聊 tid 天然不撞）");
  ok(L1.length === 1 && L1[0].name === IDNAME, "列表里是身份名「" + IDNAME + "」");
  ok(L1.length === 1 && String(L1[0].name).indexOf(BEAD) < 0 && String(L1[0].sub).indexOf(BEAD) < 0,
    "⛔ 列表里不出现手串名「" + BEAD + "」");

  // 已读标记写回 ⇒ 不再未读
  const store2 = { it1: Object.assign({}, OKAY, { loveState: "confessed", loveOn: true, loveDmSeen: "confessed:1:" }) };
  const L2 = boot(store2, [IT], null).api.list();
  ok(L2.length === 1 && L2[0].unread === false, "读过之后 ⇒ 不再未读（红点会灭）");

  // ⛔ Love 缺席 + declined ⇒ 不许杜撰第二轮
  const store3 = { it1: Object.assign({}, OKAY, { loveState: "declined", loveOn: true, loveDmSeen: "declined:1:" }) };
  const L3 = boot(store3, [IT], null).api.list();
  ok(L3.length === 1 && L3[0].unread === false, "⛔ Love 未落地 + declined ⇒ 不未读（没有文案库就不许第二轮）");

  // Love 落地且 canReConfess=true ⇒ 沁灵自己找上门（未读 + 置顶）
  const LOVE2 = {
    scriptFor: () => ({ confess: "第二轮：那日的话我收着。", callAsk: "再唤你一次？", accepted: "嗯。", declined: "好。", hint: "…", round: 2 }),
    canReConfess: () => true,
    RECONFESS_CFG: { COOLDOWN_DAYS: 7, NEED_BOND_UP: true, MAX_TRIES: 2 },
  };
  const store4 = {
    it1: Object.assign({}, OKAY, { loveState: "declined", loveOn: true, loveDmSeen: "declined:1:" }),  // 已读过的旧私聊
    it3: Object.assign({}, OKAY, { loveState: "declined", loveOn: true, loveDmSeen: "declined:1:" }),  // 二次告白
  };
  const L4 = boot(store4, [IT, IT3], LOVE2).api.list();
  ok(L4.length === 2, "两只都进列表（实测 " + L4.length + "）");
  ok(L4.filter((d) => d.unread).length === 2, "canReConfess=true ⇒ 两只都未读（沁灵自己找上门）");
  // 置顶验证：把 it1 标记成「已读新的」，只剩 it3 未读 ⇒ it3 排第一
  const store5 = {
    it1: Object.assign({}, OKAY, { loveState: "declined", loveOn: true, loveDmSeen: "declined:2:", loveDmRound: 2 }),  // 第二次也读过了
    it3: Object.assign({}, OKAY, { loveState: "declined", loveOn: true, loveDmSeen: "declined:1:" }),                  // 第二次还没看
  };
  const L5 = boot(store5, [IT, IT3], LOVE2).api.list();
  ok(L5.length === 2 && L5[0].sid === "it3", "未读的那条置顶（实测首条 " + (L5[0] && L5[0].sid) + "）");
  ok(L5.length === 2 && L5[0].unread === true && L5[1].unread === false, "置顶的是未读那条，已读的排在后面");
}

/* ================= F · Love 落地 ⇒ 自动接管文案 ================= */
section("F · js/love.js 落地后自动接管（⛔ 不用改 app.js）");
{
  const LOVE3 = {
    scriptFor: () => ({ hint: "A列", confess: "B列告白", callAsk: "C列称谓", accepted: "D列应下", declined: "E列缓一缓", round: 2, variant: 1 }),
    canReConfess: () => false,
  };
  const b = boot({}, [IT], LOVE3);
  const sc = b.api.script({ stage: 4, bond: 200 }, IT, 1);
  ok(String(sc.confess) === "B列告白", "Love.scriptFor 的 confess 覆盖兜底（实测 " + sc.confess + "）");
  ok(String(sc.callAsk) === "C列称谓" && String(sc.declined) === "E列缓一缓", "C / E 列同样被接管");
  ok(Number(sc.round) === 2, "Love 给的 round=2 被采纳（实测 " + sc.round + "）");
  const m = b.api.msgs({ state: "confessed", loveOn: true, lovecall: "" }, sc, WHO);
  ok(m.length === 1 && m[0].text === "B列告白", "气泡直接说 Love 的文案（实测 " + (m[0] && m[0].text) + "）");
  ok(boot({}, [IT], LOVE3).api.token({ state: "confessed", lovecall: "" }, 2) === "confessed:2:",
    "未读写号带轮次（confessed:2:）—— 第二轮换号 ⇒ 重新点亮红点");
}

/* ================= G · 🔴 真跑一遍：renderLoveDmPage 端到端（假 DOM + 真状态机） ================= */
section("G · 🔴 真跑一遍：私聊页端到端（真 renderLoveDmPage + 真 renderTalkPage）");
{
  const FN_RDM = tryExtractFn("renderLoveDmPage");
  const FN_TALK = tryExtractFn("renderTalkPage");

  /* 最小假 DOM：够 renderTalkPage 跑完（⛔ 不引入 jsdom，保持零依赖） */
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

  /* 一只沁灵的私聊会话：真 store（acceptConfess / setLovecall 真的写盘） */
  function dmSession(sid, init) {
    const store = {};
    store[sid] = Object.assign({ stage: 4, bond: 200, loveOn: true }, init || {});
    const dom = makeDom();
    const toasts = [];
    const sb = {
      console: console, Math: Math, JSON: JSON, Date: Date, String: String, Number: Number,
      Boolean: Boolean, Array: Array, Object: Object, Error: Error, RegExp: RegExp,
      parseInt: parseInt, isFinite: isFinite, isNaN: isNaN, Promise: Promise,
      encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
      esc: esc,
      $: (sel) => dom.el(sel),
      view: dom.el("#view"),
      topbarTitle: dom.el("#topbarTitle"),
      btnBack: dom.el("#btnBack"),
      btnSettings: dom.el("#btnSettings"),
      scrollTo: () => {},
      document: {
        body: { classList: { add() {}, remove() {}, toggle() {} }, scrollHeight: 0 },
        createElement: () => dom.createEl(),
        getElementById: () => null,
      },
      location: { hash: "#/night/dm_" + sid },
      setTimeout: (f) => { if (typeof f === "function") f(); return 0; },   // 同步跑完，不等定时器
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
      Spirits: {
        load: () => store,
        save: () => {},
        ensureIn: (s, id) => { if (!s[id]) s[id] = {}; return s[id]; },
        loveGate: (rec) => ({ ok: Number(rec.stage || 1) >= 4 && Number(rec.bond || 0) >= 140, reason: "",
                              state: String(rec.loveState || "none"), canConfess: true,
                              lovecall: String(rec.lovecall || "") }),
        loveStateOf: (id) => {
          const r = store[id] || {};
          const st = String(r.loveState || "none");
          return { state: LOVE_STATES.indexOf(st) >= 0 ? st : "none", loveOn: !!r.loveOn,
                   lovecall: String(r.lovecall || ""), at: "" };
        },
        setLoveState: (id, st) => { store[id].loveState = st; return true; },
        acceptConfess: (id) => {
          const st = String(store[id].loveState || "");
          if (st !== "confessed" && st !== "accepted") return false;
          store[id].loveState = "accepted"; return true;
        },
        declineConfess: (id) => {
          const st = String(store[id].loveState || "");
          if (st !== "confessed" && st !== "declined") return false;
          store[id].loveState = "declined"; return true;
        },
        setLovecall: (id, t) => {
          const v = String(t || "").trim();
          if (String(store[id].lovecall || "").trim()) return { ok: false, reason: "locked" };
          if (!v) return { ok: false, reason: "empty" };
          store[id].lovecall = v; return { ok: true, reason: "" };
        },
        callFor: (rec) => String((rec && rec.lovecall) || "").trim() || "你",
        todayKey: () => "2026-10-03",
      },
    };
    sb.window = sb; sb.self = sb; sb.globalThis = sb;
    const ctx = vm.createContext(sb);
    vm.runInContext(LIB + "\n" + FN_RDM + "\n" + FN_TALK +
      "\n;__rdm = renderLoveDmPage;", ctx, { filename: "app.js#renderLoveDmPage" });
    return { sb: sb, dom: dom, cache: dom.cache, toasts: toasts, store: store, run: () => sb.__rdm(sid) };
  }

  const CF = "我这一片心迹，今天说给你听";      // 兜底告白句的前半（Love 缺席 ⇒ 走兜底）
  // —— 首次进入：告白 + 两个选项
  const S1 = dmSession("it1", { loveState: "confessed" });
  let threw = "";
  try { S1.run(); } catch (e) { threw = e.message; }
  ok(!threw, "renderLoveDmPage(\"it1\") 跑通不抛错（⛔ 报错就是白屏；实测：" + (threw || "OK") + "）");
  ok(S1.sb.location.hash === "#/night/dm_it1", "⛔ 没有被重定向走（hash 仍是私聊路由）");
  ok((S1.cache["#view"]._html || "").indexOf("nt-chat") >= 0, "渲染出聊天外壳 .nt-chat");
  const b1 = (S1.cache["#ntBody"]._kids || []).join("");
  ok(b1.indexOf("nt-bub") >= 0 && b1.indexOf(CF) >= 0, "告白那句真的进了气泡流（.nt-bub + 告白文案）");
  const f1 = S1.cache["#ntFoot"]._html || "";
  ok(f1.indexOf("应下") >= 0 && f1.indexOf("缓一缓") >= 0, "底部给出「应下 / 缓一缓」两个选项");
  ok(f1.indexOf("ntLovecallInput") < 0, "⛔ 还没应下 ⇒ 不出现称谓输入框");

  // —— 点「应下」⇒ 沁灵接话 + 问称谓 + 给输入框
  const opts1 = S1.cache["#ntFoot"].querySelectorAll(".nt-opt");
  let threw2 = "";
  try { opts1[0].onclick(); } catch (e) { threw2 = e.message; }
  ok(!threw2, "点「应下」不抛错（实测：" + (threw2 || "OK") + "）");
  const b2 = (S1.cache["#ntBody"]._kids || []).join("");
  ok(b2.indexOf("应下") >= 0 && b2.indexOf("我该怎么唤你") >= 0, "应下后多出两条气泡：我应下 + 沁灵问称谓");
  ok(S1.store.it1.loveState === "accepted", "数据层真的落到 accepted（真写盘，不是演戏）");
  const f2 = S1.cache["#ntFoot"]._html || "";
  ok(f2.indexOf("ntLovecallInput") >= 0 && /maxlength="12"/.test(f2), "应下后底部给称谓输入框（maxlength=12）");

  // —— 填称谓 ⇒ 沁灵接住 + 结局卡
  S1.cache["#ntLovecallInput"].value = "阿砚";
  let threw3 = "";
  try { S1.cache["#ntLovecallOk"].onclick(); } catch (e) { threw3 = e.message; }
  ok(!threw3, "提交称谓不抛错（实测：" + (threw3 || "OK") + "）");
  ok(S1.store.it1.lovecall === "阿砚", "称谓真的写进去了（store.it1.lovecall = " + S1.store.it1.lovecall + "）");
  const f3 = S1.cache["#ntFoot"]._html || "";
  ok(f3.indexOf("如今" + IDNAME + "唤你「阿砚」") >= 0, "结局卡常态显示：如今" + IDNAME + "唤你「阿砚」");
  ok(f3.indexOf("ntLovecallInput") < 0, "⛔ 填过之后输入框消失（一次定终身）");
  const b3 = (S1.cache["#ntBody"]._kids || []).join("");

  // —— 缓一缓分支（换一只重跑）
  const S2 = dmSession("it2", { loveState: "confessed" });
  let threw4 = "";
  try { S2.run(); S2.cache["#ntFoot"].querySelectorAll(".nt-opt")[1].onclick(); } catch (e) { threw4 = e.message; }
  ok(!threw4, "缓一缓分支跑通不抛错（实测：" + (threw4 || "OK") + "）");
  ok(S2.store.it2.loveState === "declined", "数据层真的落到 declined");
  const f4 = S2.cache["#ntFoot"]._html || "";
  ok(f4.indexOf("缓一缓") >= 0, "缓一缓分支给出结局卡");
  ok(f4.indexOf("ntLovecallInput") < 0, "⛔ 缓一缓 ⇒ 不给称谓输入框");

  // —— 全程文案纪律
  const allRun = [b1, b2, b3, f1, f2, f3, f4].join("") + S1.toasts.join("") + S2.toasts.join("");
  ok(allRun.indexOf("您") < 0 && allRun.indexOf("盘") < 0 && allRun.indexOf("它") < 0,
    "⛔ 端到端跑出来的文案 您/盘/它 全为 0");
  ok(allRun.indexOf(BEAD) < 0, "⛔ 端到端跑出来的界面里不出现手串名「" + BEAD + "」");
  ok(allRun.indexOf(IDNAME) >= 0, "端到端界面里出现身份名「" + IDNAME + "」");
}

console.log("\n----------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
console.log(FAIL > 0 ? "⇒ 有红：V177d 夜话私聊未落地" : "⇒ 全绿：V177d 夜话私聊已落地");
process.exit(FAIL > 0 ? 1 : 0);
