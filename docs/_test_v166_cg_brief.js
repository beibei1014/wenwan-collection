/* v166-CG 回归自测：修复「CG 只是把立绘丢进通用场景、与画面描述无关」的 bug。
 *
 * 覆盖：
 *   A. 带 brief（用户确认的中文画面描述）→ 主场景描述由 brief 驱动，
 *      且**不再**出现通用「beautiful scene that matches its personality, dramatic pose」模板；
 *      仍保留「横版 / 非肖像 / 全身」CG 格式约束。
 *   B. 带英文关键词（cgKeywords 提取）→ 用关键词作主场景，同样无通用模板。
 *   C. 无 brief（旧路径 / 兜底）→ 回落通用模板（行为不变），证明没有把旧链路搞坏。
 *   D. 负向对照：把**修复前**的旧实现内嵌进来跑同一条断言，预期它仍然含通用模板
 *      （即旧 bug 存在），从而证明本断言确实能抓到回归。
 *   E. 静态检查：三条 CG 出图调用点不再把立绘当 i2i 参考图（ref: r1.imgUrl / ref: ((_rA...）。
 *
 * 作者不可信原则：源码按大括号配对**自己抽**，沙箱里跑抽出来的真函数。
 * 用法：
 *   APP_SRC_FILE=work/spirits.js node work/_test_v166_cg_brief.js
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

/* ---------- 1. 抽函数（带 async 前缀；跳过字符串/注释里的括号） ---------- */
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
// 抽常量字符串（多行也行）：const NAME = "...";  —— 这里只需要字面占位，故直接给固定值
const GENERIC_FILLER = "beautiful scene that matches its personality, dramatic pose and camera angle";

const FN = {
  cgSceneClause: extractFn("cgSceneClause"),
  promptForCg: extractFn("promptForCg"),
  cgPromptFromBrief: extractFn("cgPromptFromBrief"),
};
info("抽到：" + Object.keys(FN).map((k) => k + (FN[k] ? "(" + FN[k].length + "B)" : "=无")).join(" "));

/* ---------- 2. 沙箱（外观相关函数全打桩，只验证 prompt 结构） ---------- */
function makeSandbox() {
  const sandbox = {
    console, Math, JSON, String, Number, Boolean, Array, Object, Error, RegExp, Promise, Date,
    CG_STYLE: "CG_STYLE", CONSISTENCY: "CONSISTENCY", BG_NEG: "BG_NEG", DEFAULT_STYLE: "x",
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
    " cgSceneClause: (typeof cgSceneClause === 'function' ? cgSceneClause : null) };";
  vm.runInContext(code, vm.createContext(sandbox), { filename: "spirits.js#extracted" });
  return sandbox.__api;
}

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
    const api = load(sb, ["cgSceneClause", "promptForCg", "cgPromptFromBrief"]);
    const brief = "它独自站在落雪后的中式院子里，廊下挂着一盏红灯笼，石板地上落了薄雪，它微微仰头看檐角的冰棱，神情安静而欢喜。";
    const p = api.cgPromptFromBrief(brief, { kind: "stage", item: { id: "x", name: "雪" }, stage: 3 });
    info("prompt 片段：" + p.slice(0, 160) + " …");
    ok(p.indexOf(brief) >= 0, "A1 · prompt 包含用户确认的中文画面描述（brief 没被丢）");
    ok(p.indexOf(GENERIC_FILLER) < 0, "A2 · ⛔ 不含通用「beautiful scene…dramatic pose」模板（这是 bug 的根）");
    ok(p.indexOf("WIDE LANDSCAPE HORIZONTAL COMPOSITION") >= 0, "A3 · 保留横版构图约束");
    ok(p.indexOf("not a portrait") >= 0, "A4 · 保留「非肖像」约束（避免画成竖版立绘）");
    ok(p.indexOf("full body visible from head to toe") >= 0, "A5 · 保留全身约束");
  }

  /* ---- 断言 B：带英文关键词 ---- */
  section("断言B：带英文出图关键词（cgKeywords 提取结果）");
  {
    const sb = makeSandbox();
    const api = load(sb, ["cgSceneClause", "promptForCg", "cgPromptFromBrief"]);
    const kw = "ancient Chinese snowy courtyard, red lantern under the eaves, character looking up at ice on the roof, peaceful joyful expression, soft falling snow";
    const p = api.cgPromptFromBrief("（中文会被关键词覆盖）", { kind: "stage", item: { id: "x" }, stage: 4, keywords: kw });
    ok(p.indexOf(kw) >= 0, "B1 · prompt 使用提取的英文关键词作主场景");
    ok(p.indexOf(GENERIC_FILLER) < 0, "B2 · ⛔ 不含通用模板");
  }

  /* ---- 断言 C：无 brief（旧路径兜底，行为不变） ---- */
  section("断言C：无 brief 时回落通用模板（旧行为保留）");
  {
    const sb = makeSandbox();
    const api = load(sb, ["cgSceneClause", "promptForCg", "cgPromptFromBrief"]);
    const p = api.cgPromptFromBrief("", { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(p.indexOf(GENERIC_FILLER) >= 0, "C1 · 无 brief 时**仍**含通用模板（旧链路未被破坏）");
    ok(p.indexOf("solo single character only") >= 0, "C2 · 无 brief 时仍是单人立绘式描述");
  }

  /* ---- 断言 D：负向对照（修复前旧实现必须仍能触发本断言） ---- */
  section("断言D：负向对照（修复前的旧实现应当仍然含通用模板）");
  {
    const sb = makeSandbox();
    const code = OLD_SRC +
      "\n;__api = { cgPromptFromBrief: cgPromptFromBrief };";
    vm.runInContext(code, vm.createContext(sb), { filename: "spirits.js#old" });
    const brief = "它独自站在落雪后的中式院子里，廊下挂着一盏红灯笼，石板地上落了薄雪，它微微仰头看檐角的冰棱。";
    const p = sb.__api.cgPromptFromBrief(brief, { kind: "stage", item: { id: "x" }, stage: 3 });
    ok(p.indexOf(brief) >= 0, "D1 · 旧实现也会把 brief 拼进去（所以『含 brief』不是修复判据）");
    ok(p.indexOf(GENERIC_FILLER) >= 0,
      "D2 · 旧实现带 brief 时**仍含**通用模板 → 证明断言 A2 确实能抓到这个 bug（若旧实现此处意外为空，说明测试写错）");
  }

  /* ---- 断言 E：app.js 静态检查（CG 不再把立绘当 i2i 参考图） ---- */
  section("断言E：CG 出图调用点不再传立绘作 ref");
  {
    const app = fs.readFileSync(APP_FILE, "utf8");
    ok(app.indexOf("ref: r1.imgUrl") < 0, "E1 · 蜕形/化形 & 节令 CG 不再 ref: r1.imgUrl（立绘不再作图生图参考）");
    ok(app.indexOf("ref: ((_rA") < 0, "E2 · 双人事件 CG 不再 ref: ((_rA && _rA.imgUrl)…");
    ok(/async function drawCgFromBrief/.test(app), "E3 · 唯一 CG 落库入口 drawCgFromBrief 仍在");
    ok(/ref:\s*"",?/.test(app), "E4 · 调用点已置 ref: \"\"（纯文本驱动 CG）");
  }

  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.log("测试自身抛异常：" + (e && e.stack || e)); process.exit(2); });
