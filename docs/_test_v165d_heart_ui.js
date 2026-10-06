/* v165d · 心迹区 UI 自测：把 app.js 里 heartCardHtml 的**真实源码**抽出来跑一遍，
   对生成 HTML 做标签栈解析 + 防物化红线扫描。
   必测（本批新增 render* HTML 拼接，配合 docs/_test_v163c_layout.js）：
     1) 标签开闭完全平衡（不许多余 </div>、不许错配、末尾清空）
     2) 心迹/羁绊 两条 track、三式照料、递一件按钮 都在
     3) ⛔ 照护区正文不出现「好感度」「送礼」主体句 / 物件化动作词
     4) ⛔ 未达资格（bond<30）→ 按钮禁用 + 出「还没到接你东西的分上」且点名
   用法： node docs/_test_v165d_heart_ui.js */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---- 从源码抽函数 / 常量（跳过字符串/注释里的括号，与 _test_v163c_layout.js 同法） ---- */
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error("找不到函数 " + name);
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
function extractConstLine(name) {
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*[^;]+;");
  const m = re.exec(src);
  if (!m) throw new Error("找不到常量 " + name);
  return m[0];
}

/* ---- 标签栈解析 ---- */
const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);
function parse(html) {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  const stack = []; const problems = [];
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/", tag = m[2].toLowerCase(), selfClose = m[4] === "/";
    if (closing) {
      if (!stack.length) { problems.push("多余的闭合标签 </" + tag + ">"); continue; }
      const top = stack[stack.length - 1];
      if (top.tag !== tag) { problems.push("标签错配：在 <" + top.tag + "> 处收到 </" + tag + ">"); continue; }
      stack.pop();
    } else if (!VOID.has(tag) && !selfClose) { stack.push({ tag }); }
  }
  return { problems, stack };
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function makeSandbox() {
  return {
    console, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite, String, Number, Boolean, Array, Object, Error, RegExp, Promise, Intl, Map, Set,
    encodeURIComponent, decodeURIComponent,
    esc,
    spiritName: (it) => (it && it.name) || "它",
    // v176a：heartCardHtml 现在会反查身份卡（对齐详情页显示名），沙箱里给个回落 null 即可
    spiritIdentityOf: () => null,
    Spirits: {
      heartLevel: (n) => ({ value: n, lv: 1, lv1: 2, name: "微澜", atMax: false }),
      bondLevel: (n) => { const v = Math.max(0, Math.floor(Number(n) || 0)); const lv1 = v >= 280 ? 8 : v >= 200 ? 7 : v >= 140 ? 6 : v >= 90 ? 5 : v >= 55 ? 4 : v >= 30 ? 3 : v >= 12 ? 2 : 1; const nm = ["", "照面", "眼熟", "相熟", "同室", "通意", "同心", "相知", "沁透"][lv1]; return { value: v, lv: lv1 - 1, lv1: lv1, name: nm, pct: 50 }; },
      todayKey: () => "2026-10-03",
      GIFT_CFG: { DAILY_GLOBAL: 2, QUALIFY_LV: 3 },
      CARE_ACTS: [{ id: "clean", name: "擦净" }, { id: "sit", name: "静坐" }, { id: "thread", name: "理线" }],
      careDoneOf: (rec, day) => { day = day || "2026-10-03"; const ks = (rec && rec.careKinds) || {}; return Object.keys(ks).filter((k) => ks[k] === day).length; },
      giftGivenToday: () => 0,
      GIFT_COPY: {
        open: "递一件给它", qualifying: "{ta}还没到接你东西的分上。", emptyStock: "你手上还没有可递的东西。",
        alreadyHeld: "{ta}已经收着呢。", dayFull: "今天递得够多了。明天再说。", hitNote: "{ta}会喜欢这一类。",
      },
    },
  };
}
function render(stubRec) {
  const sb = makeSandbox(); sb.window = sb; sb.self = sb; sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(extractConstLine("XT_HEART_MARKS") + "\n" + extractFn("fillTa") + "\n" + extractFn("xtHeartPct") + "\n" + extractFn("heartCardHtml") + "\n;__fn = heartCardHtml;", ctx, { filename: "app.js#heartCardHtml" });
  return sb.__fn({ id: "it1", name: "花猫猫" }, stubRec, {});
}
const FORBID = /好感度|送礼|手心|攥|摩挲|上手|投喂|占有|攻略/;

section("A. 达标（bond=55 → 同室）心迹区 HTML");
{
  const html = render({ bond: 55, heart: 40, giftDay: "", giftLog: {}, careKinds: {}, giftDayN: 0 });
  ok(html.length > 200, "渲染出非空 HTML（" + html.length + " 字节）");
  const { problems, stack } = parse(html);
  ok(problems.length === 0, "无标签错配/孤立闭合" + (problems.length ? " —— " + problems.join("；") : ""));
  ok(stack.length === 0, "标签栈最终清空" + (stack.length ? " —— 残留 " + stack.map((s) => s.tag).join(",") : ""));
  ok(html.indexOf("xt-track") >= 0 && html.indexOf("xt-track bond") >= 0, "心迹条 + 羁绊条 各一");
  ok(html.indexOf("xt-care") >= 0 && ["擦净", "静坐", "理线"].every((n) => html.indexOf(n) >= 0), "照料三式按钮齐全");
  ok(html.indexOf("递一件给它") >= 0 && html.indexOf('id="xtGiftOpen"') >= 0, "「递一件给它」入口存在");
  ok(html.indexOf("今日 0/3") >= 0, "照料今日计数 = 0/3");
  ok(html.indexOf("微澜") >= 0 && html.indexOf("同室") >= 0, "心迹/羁绊档位名各一（无原始数值）");
  ok(!FORBID.test(html), "⛔ 正文无「好感度/送礼/物件化动作」（实测无）");
  ok(html.indexOf("好感度") < 0 && html.indexOf("送礼") < 0, "⛔ 无「好感度」「送礼」");
}

section("B. 未达资格（bond=12）→ 按钮禁用 + 点名提示");
{
  const html = render({ bond: 12, heart: 0, giftDay: "", giftLog: {}, careKinds: {}, giftDayN: 0 });
  const { problems, stack } = parse(html);
  ok(problems.length === 0 && stack.length === 0, "标签仍平衡");
  ok(/id="xtGiftOpen"[^>]*disabled/.test(html), "未达资格 → 递一件按钮禁用");
  ok(html.indexOf("花猫猫还没到接你东西的分上。") >= 0, "⛔ 出「{ta}还没到接你东西的分上」且点名（{ta}→花猫猫）");
  ok(html.indexOf("{ta}") < 0, "占位符已替换（无残留 {ta}）");
}

section("C. 三式做完（今日 3/3）+ 今日已给过它 1 件");
{
  const html = render({ bond: 90, heart: 100, giftDay: "2026-10-03", giftLog: {}, careKinds: { clean: "2026-10-03", sit: "2026-10-03", thread: "2026-10-03" }, giftDayN: 1 });
  const { problems, stack } = parse(html);
  ok(problems.length === 0 && stack.length === 0, "标签平衡");
  ok(html.indexOf("今日 3/3") >= 0 && html.indexOf("今天照料得够了，明天再来。") >= 0, "三式做完 → 3/3 + 够了提示");
  // v174-B3：去物化 —— 单只语境「它」→ {ta}，由 heartCardHtml → 详情页末尾 fillTa 统一解析
  ok(html.indexOf("今天已经给过{ta} 1 件") >= 0, "per-spirit 计数显示「今天已经给过{ta} 1 件」");
  ok(html.indexOf('class="xt-care-btn done"') >= 0, "已做过的照料键标记 done（置灰）");
}

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
