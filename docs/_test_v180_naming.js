/* ============================================================
 * _test_v180_naming.js · V180-D 开沁命名规格（本地兜底生成器 + 候选）
 * ------------------------------------------------------------
 * 覆盖（按 team-lead 完成判据）：
 *   ① 无 key ⇒ nameSpecCandidates 返回 2–3 条合法候选
 *   ② 候选不含已用名 / 已用字（清单见下 USED）
 *   ③ 姓名 3 字、字 2 字、诗含逗号、八字 4+4
 *   ④ 字库池抽满仍不合时不抛错、退回合法候选（含字库整个缺失的极端态）
 *   ⑤ LLM 优先：{{...}} 注入 / §四 temperature·max_tokens / 解析失败重试≤2 / 异常回落本地
 *
 * 做法：把 spirits.js 的 v180-D8 生成器代码块 + namespec-data.js 抽出，在 vm 沙箱里真跑。
 *       ⛔ 不 require/运行整个 app.js；不依赖 DOM。stub getAiKey()⇒""（模拟无 key）。
 * 用法： node docs/_test_v180_naming.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SP = fs.readFileSync(path.join(ROOT, "js", "spirits.js"), "utf8").replace(/\r/g, "");
const WB = fs.readFileSync(path.join(ROOT, "js", "namespec-data.js"), "utf8").replace(/\r/g, "");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }

console.log("V180-D 开沁命名规格回归");

/* ---------- 抽出生成器代码块，在 vm 里真跑 ---------- */
const m = /var NAMESPEC_PROMPT[\s\S]*?return nameSpecLocal\(item, used\);\n  \}/.exec(SP);
ok(!!m, "spirits.js 能抽出 v180-D8 生成器代码块");

// 已用清单（team-lead 指定）
const USED = {
  names: ["顾时笙", "苏栖盏", "萧景筹", "陆临崖", "楚柿遥", "江冽茗", "温茸之", "沈青舒", "姜饴酌", "谢凝渲", "邵盈牧", "季未晚"],
  styles: ["瞻丹", "春酹", "承霖", "烟弥", "秋晏", "秉衡", "淳时", "书砚", "澄观", "朴安", "敦之", "逢春"],
  surnames: ["陆", "苏", "沈", "谢", "楚", "萧", "姜", "顾", "江", "温", "邵", "秦", "方", "程", "季", "石", "梁", "梅", "姚", "华", "薛", "柏", "霍", "龚", "沙", "宋", "黎", "卓"],
};

function makeCtx(extra) {
  const ctx = vm.createContext(Object.assign({
    window: {},
    console,
    getAiKey: () => "",                            // 默认模拟无 key
    aiChat: async () => { throw new Error("no-key"); },
    textChat: async () => { throw new Error("no-key"); },
  }, extra || {}));
  vm.runInContext(WB, ctx);
  vm.runInContext(m[0], ctx);
  return ctx;
}
const ctx = makeCtx();

/* ---------- 0 · 装载 ---------- */
section("0 · 字库装载与生成器可用");
ok(!!(ctx.window && ctx.window.NAMESPEC_WORDBANK), "namespec-data.js 装载 ⇒ window.NAMESPEC_WORDBANK 就绪");
const W = ctx.window.NAMESPEC_WORDBANK || {};
ok(W.surnames && W.surnames.length === 120, "姓池 120（实测 " + (W.surnames || []).length + "）");
ok(W.stylePools && Object.keys(W.stylePools).length === 3, "表字池 3 路");
ok(typeof ctx.nameSpecLocal === "function", "nameSpecLocal 可用");
ok(typeof ctx.nameSpecCandidates === "function", "nameSpecCandidates 可用");

/* ---------- 校验器 ---------- */
const isLegal = (x) => x && typeof x.name === "string" && x.name.length === 3
  && typeof x.style === "string" && x.style.length === 2
  && typeof x.poem === "string" && x.poem.indexOf("，") >= 0
  && (() => { const e = String(x.eight || "").split("，"); return e.length === 2 && e[0].length === 4 && e[1].length === 4; })();

/* ---------- ① / ② / ③ ---------- */
section("① · 无 key ⇒ 每个手串名返回 2–3 条合法候选");
section("② · 候选不含已用名 / 已用字");
section("③ · 姓名3字 · 字2字 · 诗含逗号 · 八字4+4");
const ITEMS = [{ name: "油果果" }, { name: "冰红茶" }, { name: "多多牛" }, { name: "粉黛熊" }, { name: "黄金算盘" }, { name: "不知名字串" }];

(async () => {
  let countOk = true;
  for (const it of ITEMS) {
    const cands = await ctx.nameSpecCandidates(it, USED);
    if (!Array.isArray(cands) || cands.length < 2 || cands.length > 3) {
      countOk = false; console.log("  ✗ 「" + it.name + "」候选数非 2–3：" + JSON.stringify(cands));
      continue;
    }
    cands.forEach((x) => {
      ok(isLegal(x), "③ 「" + it.name + "」格式合法：" + JSON.stringify(x));
      ok(USED.names.indexOf(x.name) < 0, "② 「" + it.name + "」姓名 ∉ 已用（" + x.name + "）");
      ok(USED.styles.indexOf(x.style) < 0, "② 「" + it.name + "」表字 ∉ 已用（" + x.style + "）");
    });
    // 候选间互不重名
    const ns = cands.map((c) => c.name);
    ok(new Set(ns).size === ns.length, "① 「" + it.name + "」候选互不重名（" + ns.join("、") + "）");
  }
  ok(countOk, "① 全部手串名 ⇒ 2–3 条候选");

  /* ---------- ④ 抽满仍不合 / 字库缺失 ⇒ 不抛错、退回合法候选 ---------- */
  section("④ · 池抽满 / 字库缺失 ⇒ 不抛错、退回合法候选");

  // ④-a：把 stylePools 清空（nsMakeStyle 永远 null）⇒ 走放宽容貌兜底
  {
    const ctx2 = makeCtx();
    const saved = ctx2.window.NAMESPEC_WORDBANK.stylePools;
    ctx2.window.NAMESPEC_WORDBANK.stylePools = {};
    let threw = false, res = null;
    try { res = ctx2.nameSpecLocal({ name: "油果果" }, USED); } catch (e) { threw = true; }
    ok(!threw, "④-a stylePools 空 ⇒ 不抛错");
    ok(Array.isArray(res) && res.length >= 2, "④-a 仍退回 ≥2 条（实得 " + (res && res.length) + "）");
    (res || []).forEach((x) => ok(isLegal(x), "④-a 退回候选格式合法：" + JSON.stringify(x)));
    ctx2.window.NAMESPEC_WORDBANK.stylePools = saved;
  }

  // ④-b：字库整个缺失（window.NAMESPEC_WORDBANK 置为 undefined）⇒ 走内置 TINY 池
  {
    const ctx3 = makeCtx();
    ctx3.window.NAMESPEC_WORDBANK = undefined;
    let threw = false, res = null;
    try { res = ctx3.nameSpecLocal({ name: "冰红茶" }, USED); } catch (e) { threw = true; }
    ok(!threw, "④-b 字库缺失 ⇒ 不抛错（退内置极小池）");
    ok(Array.isArray(res) && res.length >= 2, "④-b 仍退回 ≥2 条（实得 " + (res && res.length) + "）");
    (res || []).forEach((x) => ok(isLegal(x), "④-b 退回候选格式合法：" + JSON.stringify(x)));
  }

  // ④-c：极端输入（空 item / null used）⇒ 不抛错
  {
    let threw = false;
    try { ctx.nameSpecLocal(null, null); ctx.nameSpecLocal({}, null); } catch (e) { threw = true; }
    ok(!threw, "④-c item=null / used=null ⇒ 不抛错");
  }

  /* ---------- ⑤ LLM 优先：注入定稿 prompt / §四 参数 / 重试 / 回落 ---------- */
  section("⑤ · LLM 优先（注入 prompt · §四 参数 · 重试 · 回落）");
  const LLM_REPLY = JSON.stringify([
    { name: "白知安", style: "慎之", poem: "檐下青叶，静守闲庭。", eight: "茸憨抱朴，安之若素", reason: "取冰茶之清冽" },
    { name: "云疏涧", style: "望舒", poem: "月色入庭，笑赴山河。", eight: "酥栗含香，长随相守", reason: "取果之润" },
  ]);
  {
    const captured = [];
    const ctxL = makeCtx({
      getAiKey: () => "fake-key",
      textChat: async (msgs, maxTokens, opts) => { captured.push({ msgs: msgs, maxTokens: maxTokens, opts: opts }); return LLM_REPLY; },
    });
    const cands = await ctxL.nameSpecCandidates({ name: "冰红茶" }, USED);
    ok(Array.isArray(cands) && cands.length === 2, "⑤ LLM 返回 2 条 ⇒ 直接采用（实得 " + (cands && cands.length) + "）");
    ok(cands.every((c) => c.src === "llm"), "⑤ 候选 src = llm");
    ok(cands[0].name === "白知安" && cands[1].name === "云疏涧", "⑤ LLM 候选名被采用");
    ok(cands[0].why === "取冰茶之清冽", "⑤ 读入 reason 字段（→ why）");
    ok(captured.length === 1, "⑤ 一次成功 ⇒ 只调一次（实得 " + captured.length + "）");
    const c0 = captured[0] || {};
    ok(c0.maxTokens === 400, "⑤ §四 max_tokens≈400（实得 " + c0.maxTokens + "）");
    ok(c0.opts && c0.opts.temperature === 0.8, "⑤ §四 temperature≈0.8（实得 " + JSON.stringify(c0.opts) + "）");
    const u = (c0.msgs && c0.msgs[0] && c0.msgs[0].content) || "";
    ok(u.indexOf("冰红茶") >= 0, "⑤ {{bead}} 已注入手串名");
    ok(u.indexOf("温茸之") >= 0, "⑤ {{used_names}} 已注入已用名");
    ok(u.indexOf("朴安") >= 0, "⑤ {{used_styles}} 已注入已用字");
    ok(u.indexOf("{{") < 0, "⑤ 占位符已全部替换（无残留 {{ }}）");
  }
  // ⑤-b：LLM 一直返回垃圾 ⇒ 重试 2 次后回落本地
  {
    let calls = 0;
    const ctxR = makeCtx({ getAiKey: () => "fake-key", textChat: async () => { calls++; return "这不是 JSON"; } });
    const cands = await ctxR.nameSpecCandidates({ name: "白蜜蜡" }, USED);
    ok(calls === 3, "⑤-b 解析失败重试 2 次 ⇒ 共调 3 次（实得 " + calls + "）");
    ok(Array.isArray(cands) && cands.length >= 2, "⑤-b 仍回落本地 ⇒ ≥2 条（实得 " + (cands && cands.length) + "）");
    ok(cands.every((c) => c.src === "local"), "⑤-b 回落候选 src = local");
  }
  // ⑤-c：textChat 抛异常（网络失败）⇒ 回落本地、不抛错
  {
    const ctxE = makeCtx({ getAiKey: () => "fake-key", textChat: async () => { throw new Error("net"); } });
    let threw = false, res = null;
    try { res = await ctxE.nameSpecCandidates({ name: "天珠" }, USED); } catch (e) { threw = true; }
    ok(!threw, "⑤-c 网络异常 ⇒ 不抛错");
    ok(Array.isArray(res) && res.length >= 2, "⑤-c 回落本地 ⇒ ≥2 条");
  }

  /* ---------- 负向对照：无生成器时不该绿 ---------- */
  section("负向对照");
  const bad = vm.createContext({ window: {}, console, getAiKey: () => "" });
  vm.runInContext(WB, bad);
  ok(typeof bad.nameSpecLocal !== "function", "未注入生成器块 ⇒ nameSpecLocal 不存在（证明上面断言非空转）");

  console.log("\n------------------------------------------------------------");
  console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
  console.log(FAIL ? "⇒ 红：" + FAIL + " 条不通过" : "⇒ 全绿：V180-D 命名生成器就绪");
  process.exit(FAIL ? 1 : 0);
})();
