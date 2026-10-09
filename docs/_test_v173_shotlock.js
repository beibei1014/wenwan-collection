/* v173 景别锁（framing lock）回归自测：根治「写特写却出半身 / 全景」的 bug。
 *
 * 用户写「肩部以上特写」，模型却画出全身 / 全景花园？根因是 CG_STYLE / 通用模板里焊死的
 * "full body / wide scenery / HORIZONTAL LANDSCAPE" 把窄景别悄悄压成了宽幅。
 * 本测试钉住四件事：
 *   G. 窄景别（特写 / 半身 / 中景）必须真正锁死：prompt 含景别锁（en 裁切 + zh 负面），
 *      且**不再**含宽幅 token（HORIZONTAL LANDSCAPE COMPOSITION / full body visible from head to toe /
 *      正向 wide scenery 指令）；比例锁之后、景别锁压最末（最权威）。
 *   H. full / wide 档行为不变（向后兼容）：写「全身 / 远景」仍给 full body / wide scenery。
 *   I. 无景别基线 brief 回落默认横版宽幅（HORIZONTAL 仍在，不报错）—— 改动是「窄景别中和」而非「全局禁宽」。
 *   J. 负向对照：改动前的旧实现面对窄景别 brief 仍输出 HORIZONTAL LANDSCAPE COMPOSITION，
 *      证明本断言 G 确实能抓到这个 bug（旧码有、新码无）。
 *
 * 作者不可信原则：源码按大括号配对**自己抽**，沙箱里跑抽出来的真函数。
 * 用法：node docs/_test_v173_shotlock.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/spirits.js");
const src = fs.readFileSync(SRC_FILE, "utf8");
console.log("源码：" + SRC_FILE + "  （" + src.length + " 字节）");

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function info(s) { console.log("  · " + s); }

/* ---------- 1. 抽函数 / 常量（兼容数组 / 对象 / 字符串 const） ---------- */
function extractFn(name) {
  const re = new RegExp("(async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf("(", m.index), pd = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") pd++;
    else if (src[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < src.length && src[i] !== "{") i++;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) break; i++; }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(m.index, i);
}
// 抽 `const NAME = <任意表达式>;`（数组 / 对象 / 字符串拼接均可）。
// ⚠️ 只按 [] {} 配对深度（不数圆括号），否则 CG_POSE_RE 里的正则 /(...)/ 会把深度算崩，越界扫进下一个函数。
function extractConstExpr(name) {
  const re = new RegExp("const\\s+" + name + "\\s*=");
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf("=", m.index) + 1, depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { depth--; if (depth === 0) { i++; break; } }
    else if (ch === ";" && depth === 0) break;
  }
  return src.slice(m.index, i) + ";";
}

const FN = {
  CG_STYLE: extractConstExpr("CG_STYLE"),
  SHOT_LOCK: extractConstExpr("SHOT_LOCK"),
  SHOT_MAP: extractConstExpr("SHOT_MAP"),
  CG_POSE_RE: extractConstExpr("CG_POSE_RE"),
  CG_WIDE_ONLY_RE: extractConstExpr("CG_WIDE_ONLY_RE"),
  cgTidy: extractFn("cgTidy"),
  stripPose: extractFn("stripPose"),
  cgPropFor: extractFn("cgPropFor"),
  shotClause: extractFn("shotClause"),
  cgSceneClause: extractFn("cgSceneClause"),
  promptForCg: extractFn("promptForCg"),
  cgStyleForShot: extractFn("cgStyleForShot"),
  cgPromptFromBrief: extractFn("cgPromptFromBrief"),
};
info("抽到：" + Object.keys(FN).map((k) => k + (FN[k] ? "(" + FN[k].length + "B)" : "=无")).join(" "));

/* ---------- 2. 沙箱（提供依赖桩；zhAnchorEnabled 始终 true 以验证中文景别锁） ---------- */
function makeSandbox() {
  const sandbox = {
    console, Math, JSON, String, Number, Boolean, Array, Object, Error, RegExp, Promise, Date,
    // 常量桩：CG_STYLE 里引用了 ANATOMY / NEG_STYLE，须先给串桩再让真 CG_STYLE 求值
    ANATOMY: "ANATOMY", NEG_STYLE: "NEG_STYLE",
    CONSISTENCY: "CONSISTENCY", BG_NEG: "BG_NEG", CG_COSTUME_GUARD: "CG_COSTUME_GUARD", DEFAULT_STYLE: "x",
    CG_COMPOSE_ZH: "CG_COMPOSE_ZH",
    // v180-CG：CG 三修复的符号桩 —— 本题只验证景别锁，给「从不匹配 / 透传」的桩，保持断言不变。
    CG_ARMS_FRONT_RE: /(?!)/, CG_EXOTIC_RE: /(?!)/, CG_ACC_RE: /(?!)/,
    cgAnatomyFor: (s) => s, cgExoticize: (s) => s, appearancePromptForCg: () => "AP",
    // 窄景别中文景别锁走 ark 才追加 → 这里直接给 true，专门验证 zh 锁确实落进 prompt
    zhAnchorEnabled: () => true,
    styleOf: () => ({ text: "ST" }),
    getImageCfg: () => ({ style: "x", provider: "ark" }),
    appearanceOf: () => ({}),
    lookOf: () => ({ hairEn: "brown", outfitEn: "robe", ap: {}, hairHex: null }),
    applyBrief: (lk, ap) => ({ lk, ap }),
    appearancePrompt: () => "AP",
    lookExtra: () => "",
    lookHard: () => null,
    briefHard: () => null,
    stageDef: (n) => ({ look: "STAGELOOK", prop: "PROPORTION LOCK: stub" }),
    storyCgPrompt: () => "STUB_PAIR",
    festCgPrompt: () => "STUB_FEST",
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  return sandbox;
}
function load(sandbox, names) {
  const code = names.map((n) => FN[n]).filter(Boolean).join("\n") +
    "\n;__api = { cgPromptFromBrief: (typeof cgPromptFromBrief === 'function' ? cgPromptFromBrief : null)," +
    " shotClause: (typeof shotClause === 'function' ? shotClause : null) };";
  vm.runInContext(code, vm.createContext(sandbox), { filename: "spirits.js#extracted" });
  return sandbox.__api;
}
const FULL_SET = ["CG_STYLE", "SHOT_LOCK", "SHOT_MAP", "CG_POSE_RE", "CG_WIDE_ONLY_RE",
  "cgTidy", "stripPose", "cgPropFor", "shotClause", "cgSceneClause", "promptForCg", "cgStyleForShot", "cgPromptFromBrief"];

/* 修复前（buggy）旧实现，内嵌做负向对照：窄景别仍会把 HORIZONTAL LANDSCAPE COMPOSITION 焊死进去 */
const OLD_SHOT_MAP = `
  const SHOT_MAP = [
    { re: /(半身入画|半身|近景|胸像|上半身|腰部以上|齐腰|bust shot|waist ?up)/i, en: "medium close-up shot, shown from the waist up", wide: false },
    { re: /(大特写|脸部特写|面部特写|extreme close ?up)/i, en: "extreme close-up shot, the face fills most of the frame, very shallow depth of field", wide: false },
    { re: /(特写|close ?up)/i, en: "close-up shot, head and shoulders", wide: false },
    { re: /(七分身|大腿以上|膝盖以上|medium shot)/i, en: "medium shot, shown from mid-thigh up", wide: false },
    { re: /(中景)/i, en: "medium shot, the character occupies much of the frame with some surroundings", wide: false },
    { re: /(远景|大远景|全景|广角|wide shot|long shot|establishing shot|full shot)/i, en: "wide establishing shot, the character is small within a vast environment, the scenery dominates", wide: true },
    { re: /(全身|full ?body)/i, en: "full body visible from head to toe", wide: true },
  ];`;
const OLD_FN = `
  function cgSceneClause(sceneText, shot) {
    if (!sceneText) return "";
    const shotEn = shot
      ? (shot.en + (shot.wide
        ? ", wide scenery also flows around the character"
        : ", the character is large and fills much of the frame, the environment stays behind them as soft bokeh, do NOT shrink the character into a small distant figure, do NOT show a full-body far view"))
      : "full body visible from head to toe, wide scenery on both sides, generous environment around the character";
    return ", " + shotEn + ", scene: " + sceneText +
      ", the same character keeps hair color, eye color, outfit and accessories consistent, " +
      "HORIZONTAL LANDSCAPE COMPOSITION, 16:9 widescreen framing, not a portrait, not a vertical poster";
  }
  function promptForCg(item, styleKey, stage, appearance, look, sceneText, shot) {
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    const lkRaw = look || lookOf(item, null);
    const _ab = applyBrief(lkRaw, appearance || lkRaw.ap || appearanceOf(item, 0));
    const lk = _ab.lk; const ap = _ab.ap; const color = lk.hairEn;
    const stageObj = stageDef(stage);
    const stageLook = stripPose(stageObj.look);
    const head = CG_STYLE + ", " + appearancePrompt(ap) + ", with " + color + " hair and " + lk.outfitEn + " themed outfit"
      + (lk.hairHex ? (", the exact hair color is " + lk.hairHex) : "") + lookExtra(lk) + ", " +
      stageLook + (lookHard(lk) ? (", " + lookHard(lk)) : "") + (briefHard(lk, { noPose: true }) ? (", " + briefHard(lk, { noPose: true })) : "") + ", " + st;
    const scene = cgSceneClause(sceneText, shot);
    const tail = scene ? scene : (", solo single character only, exactly one figure in the whole image, " +
      "a breathtaking key visual for a big moment: the character alone in a beautiful scene that matches its " +
      "personality, dramatic pose and camera angle, full body visible from head to toe, " +
      "the horizontal frame filled with the wide scenery of the scene (sky / room / distant view) on both sides of the character, " +
      "light particles and elegant atmosphere, no other characters");
    return head + tail + ", " + CONSISTENCY + ", " + BG_NEG + ", " + CG_COSTUME_GUARD;
  }
  function cgPromptFromBrief(brief, o) {
    const x = o || {};
    const b = String(brief || "").trim();
    const kw = String(x.keywords || "").trim();
    const scene = kw || b;
    const shot = shotClause(b + " " + kw);
    const stage = Math.max(1, Number(x.stage) || 1);
    let base;
    if (x.kind === "pair") base = storyCgPrompt(x.a, x.b, x.level, x.roomName, scene, shot);
    else if (x.kind === "fest") base = festCgPrompt(x.item, null, stage, x.appearance, x.look, x.fest, scene, shot);
    else base = promptForCg(x.item, null, stage, x.appearance, x.look, scene, shot);
    const prop = cgPropFor(stage, shot);
    const anchor = (typeof zhAnchorEnabled === "function" && typeof CG_COMPOSE_ZH !== "undefined" && zhAnchorEnabled()) ? CG_COMPOSE_ZH : "";
    return base + (anchor ? (", " + anchor) : "") + (prop ? (", " + prop) : "");
  }`;

const HORIZONTAL = "HORIZONTAL LANDSCAPE COMPOSITION";
const FULLBODY = "full body visible from head to toe";
const WIDE_SCENERY_POS = /wide scenery (?:also flows|on both sides|of the scene)/; // 正向宽幅指令（bug 信号）

/* ================= 主流程 ================= */
function main() {
  /* ---- 断言 G：窄景别（肩部以上特写）必须锁死 ---- */
  section("断言G：窄景别「肩部以上特写」→ 景别锁压最末，宽幅 token 消失");
  if (!FN.cgPromptFromBrief) { ok(false, "抽不到 cgPromptFromBrief"); }
  else {
    const sb = makeSandbox();
    const api = load(sb, FULL_SET);
    // 用户那条「肩部以上特写」：含裁切锚点 + 占比 + 负面，命中 cu 档
    const brief = "肩部以上特写，从锁骨上方裁切，头部占画面高度约 60-70%，背景高度虚化，绝对不出现胸部以下、腰部、腿部、全身、远景。";
    const p = api.cgPromptFromBrief(brief, { kind: "stage", item: { id: "x", name: "雪" }, stage: 3 });
    info("prompt 片段：" + p.slice(0, 120) + " …");
    ok(/close-up shot, head and shoulders/.test(p), "G1 · 含英文景别锁「close-up shot, head and shoulders」");
    ok(p.indexOf("景别锁定：肩部以上特写") >= 0, "G2 · 含中文景别锁「景别锁定：肩部以上特写」（ark 生效）");
    ok(p.indexOf(FULLBODY) < 0, "G3 · ⛔ 不再含 full body visible from head to toe");
    ok(p.indexOf(HORIZONTAL) < 0, "G4 · ⛔ 不再含 HORIZONTAL LANDSCAPE COMPOSITION（宽幅已被中和）");
    ok(!WIDE_SCENERY_POS.test(p), "G5 · ⛔ 不再含正向 wide scenery 指令（横版宽幅被景别锁盖过）");
    // 景别锁的「负面」修正句应落在 prompt 里（en 与 zh 都是 no wide scenery / no full body）
    ok(/no wide scenery/.test(p) && /no full body/.test(p), "G6 · 景别锁自带「no wide scenery / no full body」修正句");
    // 景别锁必须压在 PROPORTION LOCK（比例锁）之后 → 最权威
    const iProp = p.lastIndexOf("PROPORTION LOCK");
    const iLock = p.indexOf("景别锁定：肩部以上特写");
    ok(iProp >= 0 && iLock > iProp, "G7 · 景别锁位于比例锁之后（景别锁最末、最权威）");
  }

  /* ---- 断言 H：full / wide 档行为不变（向后兼容） ---- */
  section("断言H：全身 / 远景档仍给 full body / wide scenery（只锁窄景别）");
  {
    const sb = makeSandbox();
    const api = load(sb, FULL_SET);
    const pFull = api.cgPromptFromBrief("它全身站在庭院正中，衣摆在风里微微扬起，静静看着落雪。", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(pFull.indexOf(FULLBODY) >= 0, "H1 · 写「全身」仍给 full body visible from head to toe（默认宽幅保留）");
    ok(pFull.indexOf(HORIZONTAL) >= 0, "H2 · 写「全身」仍保留 HORIZONTAL 横版（未被误锁成窄）");
    const pWide = api.cgPromptFromBrief("远景大全景，它站在宏大的雪原里，显得很小。", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(/wide establishing shot/.test(pWide), "H3 · 写「远景」→ wide establishing shot（宽幅保留）");
  }

  /* ---- 断言 I：无景别基线 brief 回落默认横版宽幅（不报错） ---- */
  section("断言I：无景别基线 brief → 回落默认横版宽幅（HORIZONTAL 仍在）");
  {
    const sb = makeSandbox();
    const api = load(sb, FULL_SET);
    let threw = false, p = "";
    try { p = api.cgPromptFromBrief("它在院子里站着发呆", { kind: "stage", item: { id: "x" }, stage: 3 }); }
    catch (e) { threw = true; }
    ok(!threw, "I1 · 无景别 brief 不抛错");
    ok(p.indexOf(HORIZONTAL) >= 0, "I2 · 无景别时仍保留 HORIZONTAL 横版（改动是窄景别中和，非全局禁宽）");
  }

  /* ---- 断言 J：负向对照（修复前的旧实现） ---- */
  section("断言J：负向对照（修复前旧码面对窄景别仍输出 HORIZONTAL，证明 G 能抓 bug）");
  {
    const sbOld = makeSandbox();
    // 真 CG_STYLE / cgPropFor / shotClause + 旧 cgSceneClause / promptForCg / cgPromptFromBrief / SHOT_MAP
    const code = [FN.CG_STYLE, FN.CG_POSE_RE, FN.CG_WIDE_ONLY_RE, FN.cgTidy, FN.stripPose, FN.cgPropFor, FN.shotClause]
      .filter(Boolean).join("\n") + "\n" + OLD_SHOT_MAP + "\n" + OLD_FN +
      "\n;__api = { cgPromptFromBrief: (typeof cgPromptFromBrief === 'function' ? cgPromptFromBrief : null) };";
    vm.runInContext(code, vm.createContext(sbOld), { filename: "spirits.js#old" });
    const pOld = sbOld.__api.cgPromptFromBrief(
      "肩部以上特写，从锁骨上方裁切，头部占画面高度约 60-70%，背景高度虚化。",
      { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(pOld.indexOf(HORIZONTAL) >= 0,
      "J1 · 旧实现面对「特写」**仍输出 HORIZONTAL LANDSCAPE COMPOSITION** → 证明 G4 确实抓到这个 bug");
    // 无景别基线在旧码里也含 HORIZONTAL（宽幅 token 本就焊死）→ 证明覆盖必要
    const pOldBase = sbOld.__api.cgPromptFromBrief("它在院子里站着发呆", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(pOldBase.indexOf(HORIZONTAL) >= 0,
      "J2 · 旧实现无景别基线也含 HORIZONTAL（宽幅 token 本就存在，故本改动确有必要）");
  }

  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.log("测试自身抛异常：" + (e && e.stack || e)); process.exit(2); });
