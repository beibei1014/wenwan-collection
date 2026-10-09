/* v166-CG 回归自测：修复「CG 只是把立绘丢进通用场景、与画面描述无关」的 bug。
 *
 * 覆盖：
 *   A. 带 brief（用户确认的中文画面描述）→ 主场景描述由 brief 驱动，
 *      且**不再**出现通用「beautiful scene that matches its personality, dramatic pose」模板；
 *      仍保留「横版 / 非肖像」CG 格式约束。
 *   B. 带英文关键词（cgKeywords 提取）→ 用关键词作主场景，同样无通用模板。
 *   C. 无 brief（旧路径 / 兜底）→ 回落通用模板（行为不变），证明没有把旧链路搞坏。
 *   D. 负向对照：把**修复前**的旧实现内嵌进来跑同一条断言，预期它仍然含通用模板
 *      （即旧 bug 存在），从而证明断言 A2 确实能抓到回归。
 *   E. 静态检查：三条 CG 出图调用点不再把立绘当 i2i 参考图（ref: r1.imgUrl / ref: ((_rA...）。
 *   F. v166-CG2 **景别驱动**：brief 里的「特写 / 近景半身 / 中景 / 全身 / 远景」必须真正改变
 *      画面景别（替换掉 CG_STYLE / 通用模板里焊死的 "full body / wide scenery"），
 *      且景别从**中文原文**解析（不被英文关键词吞掉）。含旧实现负向对照。
 *
 * 作者不可信原则：源码按大括号配对**自己抽**，沙箱里跑抽出来的真函数。
 * 用法：
 *   APP_SRC_FILE=work/spirits.js APP_APP_FILE=work/app.js node work/_test_v166_cg_brief.js
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

/* ---------- 1. 抽函数 / 常量 ---------- */
function extractFn(name, S) {
  const src0 = S || src;
  const re = new RegExp("(async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src0);
  if (!m) return null;
  let i = src0.indexOf("(", m.index), pd = 0;
  for (; i < src0.length; i++) {
    if (src0[i] === "(") pd++;
    else if (src0[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < src0.length && src0[i] !== "{") i++;
  let depth = 0;
  for (; i < src0.length; i++) {
    const ch = src0[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < src0.length) { if (src0[i] === "\\") { i += 2; continue; } if (src0[i] === q) break; i++; }
      continue;
    }
    if (ch === "/" && src0[i + 1] === "/") { while (i < src0.length && src0[i] !== "\n") i++; continue; }
    if (ch === "/" && src0[i + 1] === "*") { const e = src0.indexOf("*/", i); i = e < 0 ? src0.length : e + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src0.slice(m.index, i);
}
function extractConst(name, S) {
  const src0 = S || src;
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*\\[");
  const m = re.exec(src0);
  if (!m) return null;
  let i = src0.indexOf("[", m.index), d = 0;
  for (; i < src0.length; i++) {
    if (src0[i] === "[") d++;
    else if (src0[i] === "]") { d--; if (d === 0) { i++; break; } }
  }
  return src0.slice(m.index, i) + ";";
}
// v180-CG：抽「正则常量」（const X = /.../i;）—— CG 三修复的探测正则。
function extractRe(name, S) {
  const src0 = S || src;
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*(\\/[^\\n]*\\/[a-z]*);").exec(src0);
  return m ? ("const " + name + " = " + m[1] + ";") : null;
}

const GENERIC_FILLER = "beautiful scene that matches its personality, dramatic pose and camera angle";
const FULLBODY = "full body visible from head to toe";
const WIDE_BOTH = "wide scenery on both sides";

const FN = {
  CG_POSE_RE: extractConst("CG_POSE_RE"),
  CG_WIDE_ONLY_RE: extractConst("CG_WIDE_ONLY_RE"),
  cgTidy: extractFn("cgTidy"),
  stripPose: extractFn("stripPose"),
  cgPropFor: extractFn("cgPropFor"),
  SHOT_MAP: extractConst("SHOT_MAP"),
  shotClause: extractFn("shotClause"),
  cgSceneClause: extractFn("cgSceneClause"),
  promptForCg: extractFn("promptForCg"),
  cgPromptFromBrief: extractFn("cgPromptFromBrief"),
  // v180-CG 三修复（姿态-解剖中和 / 配饰中和 / 服装守卫·异域支线）
  CG_ARMS_FRONT_RE: extractRe("CG_ARMS_FRONT_RE"),
  CG_EXOTIC_RE: extractRe("CG_EXOTIC_RE"),
  CG_ACC_RE: extractRe("CG_ACC_RE"),
  cgAnatomyFor: extractFn("cgAnatomyFor"),
  cgExoticize: extractFn("cgExoticize"),
  appearancePromptForCg: extractFn("appearancePromptForCg"),
};
info("抽到：" + Object.keys(FN).map((k) => k + (FN[k] ? "(" + FN[k].length + "B)" : "=无")).join(" "));

/* ---------- 2. 沙箱 ---------- */
function makeSandbox() {
  const sandbox = {
    console, Math, JSON, String, Number, Boolean, Array, Object, Error, RegExp, Promise, Date,
    // v180-CG：CG_STYLE stub 里带上真实头句 + 三条 anatomy 子句 + 「no modern or Western clothing」整段，
    //   好验证「抱胸中和 / 异域支线」确实删对了（真实 CG_STYLE 见 spirits.js:8686）。
    CG_STYLE: "CG_STYLE_HEAD ancient Chinese scene and classical Chinese-inspired costume, single continuous scene, " +
      "both hands resting naturally and unobstructed, no hidden overlapping arms, " +
      "the other hand is empty, relaxed, unobstructed and fully visible, exactly two arms and two hands, five fingers per hand, " +
      "strictly no modern or Western clothing (no jacket, no hoodie, no zipper coat)",
    CONSISTENCY: "CONSISTENCY", BG_NEG: "BG_NEG", DEFAULT_STYLE: "x",
    // v167-B：promptForCg 末尾追加的服装守卫（抽取沙箱需提供同名 stub，否则 ReferenceError）
    CG_COSTUME_GUARD: "XIANXIA_STUB, NO_QING_STUB",
    // v180-CG：异域支线替换目标（cgExoticize 把 CG_COSTUME_GUARD 换成它）
    NO_QING: "NO_QING_STUB",
    CG_GUARD_EXOTIC: "EXOTIC_GUARD_STUB",
    styleOf: () => ({ text: "ST" }),
    getImageCfg: () => ({ style: "x" }),
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
    " promptForCg: (typeof promptForCg === 'function' ? promptForCg : null)," +
    " cgSceneClause: (typeof cgSceneClause === 'function' ? cgSceneClause : null)," +
    " shotClause: (typeof shotClause === 'function' ? shotClause : null)," +
    " cgAnatomyFor: (typeof cgAnatomyFor === 'function' ? cgAnatomyFor : null)," +
    " cgExoticize: (typeof cgExoticize === 'function' ? cgExoticize : null)," +
    " appearancePromptForCg: (typeof appearancePromptForCg === 'function' ? appearancePromptForCg : null) };";
  vm.runInContext(code, vm.createContext(sandbox), { filename: "spirits.js#extracted" });
  return sandbox.__api;
}
const FULL_SET = ["CG_POSE_RE", "CG_WIDE_ONLY_RE", "cgTidy", "stripPose", "cgPropFor",
  "SHOT_MAP", "shotClause", "cgSceneClause", "promptForCg", "cgPromptFromBrief",
  // v180-CG：三修复（抱胸中和 / 配饰中和 / 异域支线）
  "CG_ARMS_FRONT_RE", "CG_EXOTIC_RE", "CG_ACC_RE", "cgAnatomyFor", "cgExoticize", "appearancePromptForCg"];

/* 修复前（buggy）旧实现，内嵌做负向对照 */
const OLD_SRC = `
  function promptForCg(item, styleKey, stage, appearance, look) {
    const key = styleKey || getImageCfg().style || DEFAULT_STYLE;
    const st = styleOf(item, key).text;
    const lkRaw = look || lookOf(item, null);
    const _ab = applyBrief(lkRaw, appearance || lkRaw.ap || appearanceOf(item, 0));
    const lk = _ab.lk;
    const ap = _ab.ap;
    const color = lk.hairEn;
    const stageObj = stageDef(stage);
    const stageLook = stageObj.look;
    return CG_STYLE + ", " + appearancePrompt(ap) + ", with " + color + " hair and " + lk.outfitEn + " themed outfit"
      + (lk.hairHex ? (", the exact hair color is " + lk.hairHex) : "") + lookExtra(lk) + ", " +
      stageLook + ", solo single character only, exactly one figure in the whole image, " +
      "a breathtaking key visual for a big moment: the character alone in a beautiful scene that matches its " +
      "personality, dramatic pose and camera angle, full body visible from head to toe, " +
      "the horizontal frame filled with the wide scenery of the scene (sky / room / distant view) on both sides of the character, " +
      "light particles and elegant atmosphere, no other characters" + (lookHard(lk) ? (", " + lookHard(lk)) : "") +
      (briefHard(lk) ? (", " + briefHard(lk)) : "") + ", " + st + (stageObj.prop ? (", " + stageObj.prop) : "");
  }
  function cgPromptFromBrief(brief, o) {
    const x = o || {};
    const b = String(brief || "").trim();
    const kw = String(x.keywords || "").trim();
    const scene = kw || b;
    const stage = Math.max(1, Number(x.stage) || 1);
    const sd = stageDef(stage);
    const prop = sd.prop ? (", " + sd.prop) : "";
    let base;
    if (x.kind === "pair") base = storyCgPrompt(x.a, x.b, x.level, x.roomName);
    else if (x.kind === "fest") base = festCgPrompt(x.item, null, stage, x.appearance, x.look, x.fest);
    else base = promptForCg(x.item, null, stage, x.appearance, x.look);
    let head = base;
    if (prop && head.length > prop.length && head.slice(-prop.length) === prop) {
      head = head.slice(0, head.length - prop.length);
    }
    const mid = (scene ? (", " + scene) : "") + ", " + CONSISTENCY + ", " + BG_NEG;
    return head + mid + prop;
  }
`;

/* ================= 主流程 ================= */
function main() {
  /* ---- 断言 A：带中文 brief 的 stage CG ---- */
  section("断言A：带中文画面描述的 stage CG（brief 驱动主场景）");
  if (!FN.cgPromptFromBrief) { ok(false, "抽不到 cgPromptFromBrief"); }
  else {
    const sb = makeSandbox();
    const api = load(sb, FULL_SET);
    const brief = "它独自站在落雪后的中式院子里，廊下挂着一盏红灯笼，石板地上落了薄雪，它微微仰头看檐角的冰棱，神情安静而欢喜。";
    const p = api.cgPromptFromBrief(brief, { kind: "stage", item: { id: "x", name: "雪" }, stage: 3 });
    info("prompt 片段：" + p.slice(0, 160) + " …");
    ok(p.indexOf(brief) >= 0, "A1 · prompt 包含用户确认的中文画面描述（brief 没被丢）");
    ok(p.indexOf(GENERIC_FILLER) < 0, "A2 · ⛔ 不含通用「beautiful scene…dramatic pose」模板（这是 bug 的根）");
    ok(p.indexOf("HORIZONTAL LANDSCAPE COMPOSITION") >= 0, "A3 · 保留横版构图约束");
    ok(p.indexOf("not a portrait") >= 0, "A4 · 保留「非肖像」约束（避免画成竖版立绘）");
    ok(p.indexOf(FULLBODY) >= 0, "A5 · 未指定景别时回落全身约束（向后兼容）");
  }

  /* ---- 断言 B：带英文关键词 ---- */
  section("断言B：带英文出图关键词（cgKeywords 提取结果）");
  {
    const sb = makeSandbox();
    const api = load(sb, FULL_SET);
    const kw = "ancient Chinese snowy courtyard, red lantern under the eaves, character looking up at ice on the roof, peaceful joyful expression, soft falling snow";
    const p = api.cgPromptFromBrief("（中文会被关键词覆盖）", { kind: "stage", item: { id: "x" }, stage: 4, keywords: kw });
    ok(p.indexOf(kw) >= 0, "B1 · prompt 使用提取的英文关键词作主场景");
    ok(p.indexOf(GENERIC_FILLER) < 0, "B2 · ⛔ 不含通用模板");
  }

  /* ---- 断言 C：无 brief（旧路径兜底） ---- */
  section("断言C：无 brief 时回落通用模板（旧行为保留）");
  {
    const sb = makeSandbox();
    const api = load(sb, FULL_SET);
    const p = api.cgPromptFromBrief("", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(p.indexOf(GENERIC_FILLER) >= 0, "C1 · 无 brief 时**仍**含通用模板（旧链路未被破坏）");
    ok(p.indexOf("solo single character only") >= 0, "C2 · 无 brief 时仍是单人立绘式描述");
  }

  /* ---- 断言 D：负向对照（修复前旧实现必须仍能触发本断言） ---- */
  section("断言D：负向对照（修复前的旧实现应当仍然含通用模板）");
  {
    const sb = makeSandbox();
    const code = OLD_SRC + "\n;__api = { cgPromptFromBrief: cgPromptFromBrief };";
    vm.runInContext(code, vm.createContext(sb), { filename: "spirits.js#old" });
    const brief = "它独自站在落雪后的中式院子里，廊下挂着一盏红灯笼，石板地上落了薄雪，它微微仰头看檐角的冰棱。";
    const p = sb.__api.cgPromptFromBrief(brief, { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(p.indexOf(brief) >= 0, "D1 · 旧实现也会把 brief 拼进去（所以『含 brief』不是修复判据）");
    ok(p.indexOf(GENERIC_FILLER) >= 0,
      "D2 · 旧实现带 brief 时**仍含**通用模板 → 证明断言 A2 确实能抓到这个 bug");
  }

  /* ---- 断言 E：app.js 静态检查 ---- */
  section("断言E：CG 出图调用点不再传立绘作 ref");
  {
    const app = fs.readFileSync(APP_FILE, "utf8");
    ok(app.indexOf("ref: r1.imgUrl") < 0, "E1 · 蜕形/化形 & 节令 CG 不再 ref: r1.imgUrl（立绘不再作图生图参考）");
    ok(app.indexOf("ref: ((_rA") < 0, "E2 · 双人事件 CG 不再 ref: ((_rA && _rA.imgUrl)…");
    ok(/async function drawCgFromBrief/.test(app), "E3 · 唯一 CG 落库入口 drawCgFromBrief 仍在");
    ok(/ref:\s*"",?/.test(app), "E4 · 调用点已置 ref: \"\"（纯文本驱动 CG）");
  }

  /* ---- 断言 F：v166-CG2 景别驱动 ---- */
  section("断言F：brief 里的景别必须真正改变构图（近景 / 半身 / 特写 / 全身 / 远景）");
  if (!FN.SHOT_MAP || !FN.shotClause) { ok(false, "抽不到 SHOT_MAP / shotClause"); }
  else {
    const sb = makeSandbox();
    const api = load(sb, FULL_SET);
    const mk = (brief, kw) => api.cgPromptFromBrief(brief, { kind: "stage", item: { id: "x" }, stage: 3, keywords: kw || "" });

    // F1：半身入画 + 近景 → medium close-up，且不再出现 full body / 两侧大景
    const p1 = mk("发丝半束半散，它侧身站立，两手自然交叠在身前，微微偏头看向檐外，半身入画，近景，暖光融融。");
    ok(/medium close-up/.test(p1), "F1a · 「半身入画/近景」→ medium close-up 景别");
    ok(p1.indexOf(FULLBODY) < 0, "F1b · 「半身入画/近景」时**不再**出现 full body（这是用户反馈的 bug）");
    ok(p1.indexOf(WIDE_BOTH) < 0, "F1c · 「半身入画/近景」时**不再**出现「两侧大景」硬约束");

    // F2：特写
    const p2 = mk("脸部特写，它眨了眨眼，睫毛上沾着细雪的微光。");
    ok(/close-up/.test(p2), "F2 · 「特写」→ close-up 景别");

    // F3：显式全身
    const p3 = mk("它全身站在庭院正中，衣摆在风里微微扬起，远景里是整座廊院。");
    ok(p3.indexOf(FULLBODY) >= 0 || /wide establishing/.test(p3), "F3 · 「全身/远景」→ 保留全身或广角远景");

    // F4：无景别描述 → 默认全身（向后兼容，与 A5 呼应）
    const p4 = mk("它坐在窗边，手里捧着一盏热茶，窗外是安静的院子。");
    ok(p4.indexOf(FULLBODY) >= 0, "F4 · 未写景别 → 默认 full body（不误伤旧行为）");

    // F5：负向对照——旧实现面对「半身/近景」仍输 full body，证明 F1 能抓 bug
    const sbOld = makeSandbox();
    vm.runInContext(OLD_SRC + "\n;__api = { cgPromptFromBrief: cgPromptFromBrief };",
      vm.createContext(sbOld), { filename: "spirits.js#old-shot" });
    const pOld = sbOld.__api.cgPromptFromBrief("它半身入画，近景，站在廊下。", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(pOld.indexOf(FULLBODY) >= 0,
      "F5 · 旧实现面对「半身/近景」**仍输出 full body** → 证明 F1b 确实抓到了用户反馈的构图 bug");

    // F6：景别从**中文原文**解析——英文关键词不含景别时也不丢
    const p6 = mk("它半身入画，近景，眉头微蹙，似有话说。", "ancient Chinese veranda, warm afternoon light, soft mood");
    ok(/medium close-up/.test(p6) && p6.indexOf(FULLBODY) < 0,
      "F6 · 英文关键词不含景别时，「半身/近景」仍从中文原文生效（不被关键词吞掉）");
  }

  /* ---- 断言 G：v180-CG 三修复（抱胸中和 / 配饰中和 / 异域支线） ---- */
  section("断言G：v180-CG 三修复 —— 抱胸不被 anatomy 反杀 / 默认不带随机配饰 / 西域不被汉服锁盖掉");
  {
    const sb = makeSandbox();
    const api = load(sb, FULL_SET);
    info("抽到：" + ["cgAnatomyFor", "cgExoticize", "appearancePromptForCg"]
      .map((k) => k + (api[k] ? "✓" : "✗")).join("  "));

    // G1 抱胸：三条打架的子句必须消失，而 "exactly two arms and two hands" 必须保留
    const pArm = api.cgPromptFromBrief("它双手怀抱在胸前，半身入画，近景，暖光。", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(pArm.indexOf("both hands resting naturally and unobstructed") < 0, "G1a · 抱胸时删掉 'both hands resting naturally and unobstructed'");
    ok(pArm.indexOf("no hidden overlapping arms") < 0, "G1b · 抱胸时删掉 'no hidden overlapping arms'");
    ok(pArm.indexOf("the other hand is empty, relaxed, unobstructed and fully visible") < 0, "G1c · 抱胸时删掉 'the other hand is empty … fully visible'");
    ok(pArm.indexOf("exactly two arms and two hands") >= 0, "G1d · 仍保留 'exactly two arms and two hands'（_test_v165r2 依赖）");

    // G2 非抱胸：三条子句原样保留（不误伤）
    const pCalm = api.cgPromptFromBrief("它安静地站在院子里，微微侧身。", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(pCalm.indexOf("both hands resting naturally and unobstructed") >= 0, "G2 · 非抱胸姿势时 anatomy 子句原样保留（不误删）");

    // G3 西域：守卫换成异域支线，头句改写，「no modern or Western clothing」整段去掉
    const pExo = api.cgPromptFromBrief("一位从西域来的少年，身着西域古风常服，抱臂而立。", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(pExo.indexOf("EXOTIC_GUARD_STUB") >= 0, "G3a · 西域 → 尾部守卫换成异域支线（CG_GUARD_EXOTIC）");
    ok(pExo.indexOf("XIANXIA_STUB") < 0, "G3b · 西域 → 默认汉服守卫（XIANXIA_STUB）已移除");
    ok(pExo.indexOf("an ancient foreign-region scene and a frontier/exotic costume") >= 0, "G3c · 西域 → CG_STYLE 头句改写为异域场景 / 服饰");
    ok(pExo.indexOf("no modern or Western clothing") < 0, "G3d · 西域 → 去掉 'strictly no modern or Western clothing' 整段（免得把西域读成 Western）");

    // G4 非西域：守卫不换
    const pHan = api.cgPromptFromBrief("它站在中式庭院里，暖光。", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(pHan.indexOf("XIANXIA_STUB") >= 0 && pHan.indexOf("EXOTIC_GUARD_STUB") < 0, "G4 · 非西域 → 保持默认汉服守卫（不误触发异域支线）");

    // G5 配饰：默认不带（keepAcc=false）/ 点名才带（keepAcc=true）；装配路径同时验证
    const apT = { gender: "boy", eyes: "golden", acc: "a wooden pendant", acc2: "a short beaded necklace", outfit: "robe", pattern: "x", material: "silk", prop: "", vibe: "calm" };
    if (typeof api.appearancePromptForCg === "function") {
      ok(api.appearancePromptForCg(apT, false).indexOf("beaded necklace") < 0, "G5a · CG 默认不带随机配饰（数珠消失）");
      ok(api.appearancePromptForCg(apT, true).indexOf("beaded necklace") >= 0, "G5b · 出图单点名配饰时才带（keepAcc=true）");
    } else {
      ok(false, "G5a/b · 抽不到 appearancePromptForCg（改动前基线应缺此函数）");
    }
    const oAcc = { kind: "stage", item: { id: "x" }, stage: 3, appearance: apT };
    ok(api.cgPromptFromBrief("它安静地站在院子里。", oAcc).indexOf("beaded necklace") < 0, "G5c · 装配路径：默认 prompt 不含随机配饰句（数珠不入）");
    ok(api.cgPromptFromBrief("它脖子上挂着一条项链，站在院子里。", oAcc).indexOf("beaded necklace") >= 0, "G5d · 装配路径：出图单点名「项链」时才带配饰");
  }

  /* ---- 断言 H：v180-CG 负向对照（改动前的旧 spirits.js 必须三病俱在） ---- */
  section("断言H：负向对照 —— 改动前旧实现（docs/_tmp/_pre_v18x_spirits.js）三病俱在 → 证明 G 能真红");
  {
    const PRE_FILE = process.env.CG_PRE_FILE ? path.resolve(process.env.CG_PRE_FILE) : path.join(ROOT, "docs/_tmp/_pre_v18x_spirits.js");
    let preSrc = "";
    try { preSrc = fs.readFileSync(PRE_FILE, "utf8"); } catch (e) { preSrc = ""; }
    if (!preSrc) { info("取不到改动前基线（" + PRE_FILE + "）→ 负向对照优雅跳过"); ok(true, "H · (无基线 → 跳过)"); }
    else {
      info("基线：" + PRE_FILE + "  （" + preSrc.length + " 字节）");
      const preCode = FULL_SET.map((n) => {
        if (n === "CG_POSE_RE" || n === "CG_WIDE_ONLY_RE" || n === "SHOT_MAP") return extractConst(n, preSrc);
        if (n === "CG_ARMS_FRONT_RE" || n === "CG_EXOTIC_RE" || n === "CG_ACC_RE") return extractRe(n, preSrc);
        return extractFn(n, preSrc);
      }).filter(Boolean).join("\n");
      const sb2 = makeSandbox();
      vm.runInContext(preCode + "\n;__api = { cgPromptFromBrief: (typeof cgPromptFromBrief === 'function' ? cgPromptFromBrief : null) };",
        vm.createContext(sb2), { filename: "spirits.js#pre-v18x" });
      const api2 = sb2.__api;
      const q = (brief) => api2.cgPromptFromBrief(brief, { kind: "stage", item: { id: "x" }, stage: 3 });
      const oldArm = q("它双手怀抱在胸前，半身入画，近景。");
      ok(oldArm.indexOf("both hands resting naturally and unobstructed") >= 0, "H1 · 旧实现抱胸时**仍**留 'both hands resting naturally and unobstructed' → G1a 能真红");
      ok(oldArm.indexOf("no hidden overlapping arms") >= 0, "H2 · 旧实现抱胸时**仍**留 'no hidden overlapping arms' → G1b 能真红");
      const oldExo = q("一位从西域来的少年，身着西域古风常服。");
      ok(oldExo.indexOf("XIANXIA_STUB") >= 0 && oldExo.indexOf("EXOTIC_GUARD_STUB") < 0, "H3 · 旧实现西域时**仍**是汉服守卫 → G3a/G3b 能真红");
      ok(oldExo.indexOf("an ancient foreign-region scene and a frontier/exotic costume") < 0, "H4 · 旧实现西域时头句**未**改写 → G3c 能真红");
      ok(oldExo.indexOf("no modern or Western clothing") >= 0, "H5 · 旧实现西域时**仍**带 'no modern or Western clothing' → G3d 能真红");
    }
  }

  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.log("测试自身抛异常：" + (e && e.stack || e)); process.exit(2); });
