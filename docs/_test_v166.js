/* v166 回归自测：本轮立绘 + CG 的 6 项需求里，可在 node 沙箱里用抽真函数验证的逻辑。
 *
 * 覆盖：
 *   G. 性别修复：ensureIn 必须把「设计规定的性别」(item.gender) 强制写进 rec.gender，
 *      不能因为 born() 随机掷过就变（粉黛熊=boy 重画立绘/人设不再变 girl）。
 *      + 负向对照：修复前的 ensureIn 不读 item.gender → 证明断言能抓 bug。
 *   H. genderFromText：从用户设定文字认出「少年郎→boy / 姑娘→girl」。
 *   I. 进阶 CG 进相册：cgAdvIds 返回 adv#* 列表；cgCollectedIds 计数**排除** adv#（进度不被撑爆）。
 *   J. CG 描述「先写意向 → AI 润色」：有 intent 走润色分支(CG_BRIEF_SYS_INTENT)，
 *      无 intent 走自动生成，无 key 回落本地模板。
 *
 * 作者不可信原则：源码按大括号配对自己抽，沙箱里跑抽出来的真函数。
 * 用法：APP_SRC_FILE=work/spirits.js APP_APP_FILE=work/app.js node work/_test_v166.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/spirits.js");
const APP_FILE = process.env.APP_APP_FILE ? path.resolve(process.env.APP_APP_FILE) : path.join(ROOT, "js/app.js");
const src = fs.readFileSync(SRC_FILE, "utf8");
console.log("源码：" + SRC_FILE + "  （" + src.length + " 字节）");

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function info(s) { console.log("  · " + s); }

function extractFn(name) {
  const re = new RegExp("(async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf("(", m.index), pd = 0;
  for (; i < src.length; i++) { if (src[i] === "(") pd++; else if (src[i] === ")") { pd--; if (pd === 0) { i++; break; } } }
  while (i < src.length && src[i] !== "{") i++;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") { const q = ch; i++; while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) break; i++; } continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(m.index, i);
}
function extractConstArr(name) {
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*\\[");
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf("[", m.index), d = 0;
  for (; i < src.length; i++) { if (src[i] === "[") d++; else if (src[i] === "]") { d--; if (d === 0) { i++; break; } } }
  return src.slice(m.index, i) + ";";
}

const FN = {
  ensureIn: extractFn("ensureIn"),
  genderFromText: extractFn("genderFromText"),
  cgAdvIds: extractFn("cgAdvIds"),
  cgCollectedIds: extractFn("cgCollectedIds"),
  cgMarkCollected: extractFn("cgMarkCollected"),
  backfillAdvCg: extractFn("backfillAdvCg"),
  cgBrief: extractFn("cgBrief"),
  cgBriefLocal: extractFn("cgBriefLocal"),
  cgBriefFacts: extractFn("cgBriefFacts"),
  _BOY_WORDS: extractConstArr("_BOY_WORDS"),
  _GIRL_WORDS: extractConstArr("_GIRL_WORDS"),
};
info("抽到：" + Object.keys(FN).map((k) => k + (FN[k] ? "(" + FN[k].length + "B)" : "=无")).join(" "));

/* ---------- 沙箱 ---------- */
function makeSandbox() {
  const sandbox = {
    console, Math, JSON, String, Number, Boolean, Array, Object, Error, RegExp, Promise, Date,
    // 外部依赖桩
    normRecV165: () => {},
    legacyGender: (id, seed) => (String(id || "").length % 2 ? "boy" : "girl"),
    hashStr: (s) => { let h = 0; const t = String(s || ""); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; },
    appearanceOf: () => ({}),
    cgsRO: (rec) => (rec && rec.cgs) || null,
    cgsOf: (rec) => (rec && rec.cgs) || null,
    stageDef: (n) => ({ name: "阶段" + n, sizeZh: "", prop: "PROP" }),
    getAiKey: () => "k",
    // aiChat：用 system 内容区分走的是「润色」还是「自动生成」分支
    aiChat: async (msgs) => {
      const sys = (msgs && msgs[0] && msgs[0].content) || "";
      if (sys === "INTENT_SYS") return "【润色】" + ((msgs[1] && msgs[1].content) || "");
      if (sys === "AUTO_SYS") return "【自动】" + ((msgs[1] && msgs[1].content) || "");
      return "【未知分支】";
    },
    Spirits: { save() {} },
    CG_BRIEF_SYS: "AUTO_SYS",
    CG_BRIEF_SYS_INTENT: "INTENT_SYS",
    CG_BRIEF_CFG: { tokens: 1, kwTokens: 1, minLen: 1, maxLen: 9999 },
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  return sandbox;
}
function loadApi(sandbox) {
  const code = [
    FN.ensureIn, FN.genderFromText, FN.cgAdvIds, FN.cgCollectedIds,
    FN.cgBrief, FN.cgBriefLocal, FN.cgBriefFacts, FN._BOY_WORDS, FN._GIRL_WORDS,
  ].filter(Boolean).join("\n") +
    "\n;__api = { ensureIn, genderFromText, cgAdvIds, cgCollectedIds, cgBrief, cgBriefLocal, cgBriefFacts };";
  vm.runInContext(code, vm.createContext(sandbox), { filename: "spirits.js#extracted" });
  return sandbox.__api;
}

/* 修复前（buggy）旧 ensureIn：根本不读 item.gender，性别只能靠 legacyGender 随机 */
const OLD_ENSURE_IN = `
  function ensureIn(store, id, item) {
    if (!store[id]) {
      store[id] = { persona: null, variant: 0, imgUrl: "", letters: [], chats: [], lastLetterDay: "", stage: 1, imgHistory: [], gender: "", bornAt: 0, spirit: true, flags: {} };
      normRecV165(store[id], item);
      return store[id];
    }
    const rec = store[id];
    if (rec.gender !== "boy" && rec.gender !== "girl") rec.gender = legacyGender(id, rec.appearanceSeed || 0);
    if (rec.spirit == null) rec.spirit = true;
    normRecV165(rec, item);
    return rec;
  }
`;

function main() {
  /* ---- 断言 G：性别强制 ---- */
  section("断言G：设计规定的性别(item.gender) 必须强制进 rec.gender（粉黛熊=boy 不变 girl）");
  if (!FN.ensureIn) ok(false, "抽不到 ensureIn");
  else {
    // G1：新开的沁灵，item 规定 boy → rec.gender 必须是 boy
    {
      const sb = makeSandbox();
      const api = loadApi(sb);
      const store = {};
      const rec = api.ensureIn(store, "fendai", { id: "fendai", gender: "boy" });
      ok(rec.gender === "boy", "G1 · 粉黛熊(item.gender=boy) 新开沁灵 → rec.gender == boy");
    }
    // G2（负向对照）：修复前的 ensureIn 不读 item.gender → 应为空（证明 G1 确实是修复点）
    {
      const sb = makeSandbox();
      vm.runInContext(OLD_ENSURE_IN + "\n;__api = { ensureIn };", vm.createContext(sb), { filename: "spirits.js#old" });
      const store = {};
      const rec = sb.__api.ensureIn(store, "fendai", { id: "fendai", gender: "boy" });
      ok(rec.gender !== "boy", "G2 · 旧实现忽略 item.gender（粉黛熊没被锁成 boy）→ 证明 G1 抓得到 bug，性别跑偏根因在此");
    }
    // G3：新 rec 默认 spirit=true；老 rec 没设 spirit → 补 true
    {
      const sb = makeSandbox();
      const api = loadApi(sb);
      const recNew = api.ensureIn({}, "x1", { id: "x1", gender: "girl" });
      ok(recNew.spirit === true, "G3a · 新 rec 默认 spirit=true（开沁）");
      const store2 = { x2: { stage: 1, imgHistory: [] } };
      const recOld = api.ensureIn(store2, "x2", { id: "x2" });
      ok(recOld.spirit === true, "G3b · 老 rec 缺 spirit 字段 → 补 true（不误判成手串）");
    }
    // G4：用户已设 spirit=false → 绝不被覆盖成 true
    {
      const sb = makeSandbox();
      const api = loadApi(sb);
      const store = { x3: { stage: 1, imgHistory: [], spirit: false } };
      const rec = api.ensureIn(store, "x3", { id: "x3" });
      ok(rec.spirit === false, "G4 · 已设只当手串(spirit=false) 的串，ensureIn 不强行覆盖回 true");
    }
  }

  /* ---- 断言 H：genderFromText ---- */
  section("断言H：从设定文字认性别");
  if (!FN.genderFromText) ok(false, "抽不到 genderFromText");
  else {
    const sb = makeSandbox();
    const api = loadApi(sb);
    ok(api.genderFromText("它是个少年郎，总爱蹭人") === "boy", "H1 · 「少年郎」→ boy");
    ok(api.genderFromText("姑娘家，性子软，爱躲人") === "girl", "H2 · 「姑娘」→ girl");
    ok(api.genderFromText("它爱蹲窗台上看雨") === "", "H3 · 无性别词 → 空（交给 born 随机，不误判）");
    ok(api.genderFromText("少年郎带着姑娘去赶集") === "", "H4 · 男女词同现 → 空（不强行定）");
  }

  /* ---- 断言 I：进阶 CG 进相册 ---- */
  section("断言I：进阶专属 CG(adv#*) 进相册展示，但不计入主线进度");
  if (!FN.cgAdvIds || !FN.cgCollectedIds) ok(false, "抽不到 cgAdvIds / cgCollectedIds");
  else {
    const sb = makeSandbox();
    const api = loadApi(sb);
    const rec = {
      cgs: {
        "0": { hasImg: true, title: "主线一" },
        "1": { hasImg: false },
        "adv#3": { hasImg: true, title: "蜕形" },
        "adv#4": { hasImg: true, title: "化形" },
      },
    };
    const adv = api.cgAdvIds(rec);
    ok(adv.length === 2 && adv.indexOf("adv#3") >= 0 && adv.indexOf("adv#4") >= 0,
      "I1 · cgAdvIds 只返回进阶 CG（adv#3 / adv#4），不含主线 0/1");
    const ids = api.cgCollectedIds(rec);
    ok(ids.length === 1 && ids[0] === "0",
      "I2 · cgCollectedIds 只数主线章节 CG（排除 adv#），进阶 CG 不撑爆 CG_TOTAL 进度");
  }

  /* ---- 断言 K：老进阶 CG 回填进相册 ---- */
  section("断言K：V166 之前生成的进阶 CG（只存 rec.cgUrl）必须回填进 rec.cgs 供相册聚合");
  if (!FN.backfillAdvCg || !FN.cgMarkCollected) ok(false, "抽不到 backfillAdvCg / cgMarkCollected");
  else {
    const sb = makeSandbox();
    sb.cgsOf = (rec) => { if (!rec || typeof rec !== "object") return {}; if (!rec.cgs || typeof rec.cgs !== "object" || Array.isArray(rec.cgs)) rec.cgs = {}; return rec.cgs; };
    sb.cgsRO = (rec) => { const c = rec && rec.cgs; return (c && typeof c === "object" && !Array.isArray(c)) ? c : null; };
    const code = [FN.cgMarkCollected, FN.backfillAdvCg, FN.cgAdvIds, FN.cgCollectedIds].filter(Boolean).join("\n") +
      "\n;__api = { backfillAdvCg, cgAdvIds, cgCollectedIds, cgMarkCollected };";
    vm.runInContext(code, vm.createContext(sb), { filename: "spirits.js#backfill" });
    const api = sb.__api;
    // K1~K4：老档只有 cgUrl（化形时写的）、没有 cgs → 回填后相册能聚到
    const recOld = { cgUrl: "https://cdn/x.png", cgStage: 4, stage: 4, cgBrief: "它站在雪里", cgKey: "k" };
    ok(api.backfillAdvCg(recOld) === true, "K1 · 老档(cgUrl 有值 / cgs 无) → backfillAdvCg 返回 true（有改动，触发 save）");
    const adv = api.cgAdvIds(recOld);
    ok(adv.length === 1 && adv[0] === "adv#4", "K2 · 回填后 cgAdvIds 得到 adv#4（相册「进阶」tab 能显示它）");
    ok(recOld.cgs["adv#4"].thumb === "https://cdn/x.png", "K3 · 回填条目 thumb = rec.cgUrl（相册缩略图有图）");
    ok(api.cgCollectedIds(recOld).length === 0, "K4 · 回填的进阶 CG 不计入主线进度（cgCollectedIds 仍为空）");
    // K5：幂等 —— 已归档过再调不重复写
    ok(api.backfillAdvCg(recOld) === false, "K5 · 幂等：已归档过再调 → 返回 false（不重复写、不无谓 save）");
    // K6：负向对照 —— 修复前（不回填）老档 cgAdvIds 为空，相册看不到
    const recOld2 = { cgUrl: "https://cdn/y.png", cgStage: 3, stage: 3 };
    ok(api.cgAdvIds(recOld2).length === 0, "K6 · 负向对照：不回填时老档 cgAdvIds 为空 → 正是「明明有 CG 相册却空」的根因");
  }

  /* ---- 断言 J：CG 描述润色分支 ---- */
  section("断言J：CG 描述「先写意向 → AI 润色」分支");
  if (!FN.cgBrief) ok(false, "抽不到 cgBrief");
  else {
    const sb = makeSandbox();
    const api = loadApi(sb);
    const o = { kind: "stage", item: { id: "x", name: "雪" }, stage: 3, look: { outfitZh: "雪色常服" } };
    // J1：有 intent → 走润色分支（system=INTENT_SYS），返回含【润色】
    (async () => {
      const r1 = await api.cgBrief(Object.assign({}, o, { intent: "它站在廊下等雪停，想递我一杯热茶" }));
      ok(String(r1).indexOf("【润色】") >= 0, "J1 · 有 intent → 走 AI 润色分支（CG_BRIEF_SYS_INTENT）");
      // J2：无 intent → 走自动生成分支（system=AUTO_SYS）
      const r2 = await api.cgBrief(Object.assign({}, o));
      ok(String(r2).indexOf("【自动】") >= 0, "J2 · 无 intent → 走自动生成分支（向后兼容旧链路）");
      // J3：无 key → 回落本地模板（含「独自站在」）
      const sb2 = makeSandbox(); sb2.getAiKey = () => "";
      const api2 = (function () { const code = [FN.cgBrief, FN.cgBriefLocal, FN.cgBriefFacts, FN._BOY_WORDS, FN._GIRL_WORDS].filter(Boolean).join("\n") + "\n;__api={cgBrief};"; vm.runInContext(code, vm.createContext(sb2), { filename: "s2" }); return sb2.__api; })();
      const r3 = await api2.cgBrief(Object.assign({}, o, { intent: "随便写点意向" }));
      ok(String(r3).indexOf("独自站在") >= 0, "J3 · 无 key + 有 intent → 仍回落本地模板（流程不阻塞）");
      finish();
    })();
    return; // 异步分支自己调 finish
  }
  finish();
}

function finish() {
  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}
(async () => { try { await main(); } catch (e) { console.log("测试自身抛异常：" + (e && e.stack || e)); process.exit(2); } })();
