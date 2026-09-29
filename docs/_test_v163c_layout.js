/* v163c 布局结构自测：把 renderSpiritPage / renderAllSpiritsPage 的**真实源码**抽出来跑一遍，
   再对生成出来的 HTML 做标签栈解析，验证：
     1) 标签开闭完全平衡（不许多余 </div>、不许错配）
     2) .spirit-card 的直接子元素恰好 2 个（缩略图 + 元信息块）—— 元信息块一旦被提前闭合，
        title/line/prog/tags 会变成 flex row 的兄弟项，CJK 文本塌成 1 字宽竖排（线上崩过一次）
     3) title/line/prog/tags/stage 都在 .spirit-meta 内部；stars 在 .spirit-name 内部

   用法： node docs/_test_v163c_layout.js
   负向对照（证明这个测试真的抓得住 bug）：
     git show 706d94f:js/app.js > /tmp/app_buggy.js
     APP_SRC_FILE=/tmp/app_buggy.js node docs/_test_v163c_layout.js   → 必须 FAIL
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const src = fs.readFileSync(SRC_FILE, "utf8");
console.log("源码：" + SRC_FILE);

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 1. 从源码里按大括号配对抽出函数（跳过字符串/注释里的括号） ---------- */
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error("找不到函数 " + name);
  // 跳过形参括号
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

/* ---------- 2. 测试数据 ---------- */
const LIST = [
  { id: "it1", name: "花猫猫", lastPlayedAt: Date.now() - 3 * 86400000 },
  { id: "it2", name: "粉黛熊", lastPlayedAt: null },
  { id: "it3", name: "油果果", lastPlayedAt: Date.now() - 9 * 86400000 },
];
const STORE = {
  it1: { persona: { title: "慢热掌柜", line: "盘我，太快喵~", traits: ["软糯", "慢热"] }, stage: 2 },
  it2: { persona: null, stage: 1 },
  it3: { persona: { title: "见人就想包浆", line: "包浆给你看！", traits: ["油亮"] }, stage: 4, cgUrl: "data:x" },
};

/* ---------- 3. 最小沙箱 ---------- */
function makeSandbox() {
  const view = { _html: "", style: {}, addEventListener() {}, appendChild() {} };
  Object.defineProperty(view, "innerHTML", {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  view.querySelector = () => null;
  view.querySelectorAll = () => [];

  const noop = () => {};
  const sandbox = {
    console, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite, String, Number,
    Boolean, Array, Object, Error, RegExp, Promise, Intl, Map, Set,
    encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout, queueMicrotask,
    location: { hash: "#/spirit" },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    view,
    topbarTitle: { textContent: "", style: {} },
    btnBack: { style: {} },
    btnSettings: { style: {} },
    $: () => null,
    esc: (s) => (s == null ? "" : String(s)),
    spiritItems: () => LIST.slice(),
    spiritName: (it) => it.name,
    spiritThumbHtml: () => '<span class="spirit-thumb"></span>',
    spiritNeedsSetup: (rec) => rec && rec.stage === 1,
    setupHintHtml: () => ({ html: "", first: null }),
    pageStatsHtml: () => '<div class="page-stats"></div>',
    paperCardHtml: (h) => '<div class="paper">' + h + "</div>",
    emptyCardHtml: () => '<div class="empty"></div>',
    albumEntryHtml: () => '<button class="album-entry" id="albumEntry"></button>',
    bindSetupHint: noop, bindSpiritImgFallback: noop, bindRedrawAll: noop,
    ensureSpiritData: noop, ensureSpiritLook: () => Promise.resolve(), ensureSpiritImages: () => Promise.resolve(),
    ensureSpiritCg: () => Promise.resolve(), ensureSpiritFaces: noop, ensureSpiritExtras: noop,
    updateStoryDot: noop, maybeOpenSpiritSetup: noop, tickRooms: noop,
    showSpiritSetupModal: noop, toast: noop, confirmModal: () => Promise.resolve(false),
    DB: { daysWith: () => 10 },
    Rooms: { getRoom: () => null },
    Spirits: {
      load: () => JSON.parse(JSON.stringify(STORE)),
      stageOf: (it, r) => (r && r.stage) || 1,
      stageInfo: (it, st) => ({
        icon: "🌿", name: "凝形", stage: Math.max(1, Math.min(4, Number(st) || 1)),
        isMax: Number(st) >= 4, pct: 40, toNext: 14, bottleneck: "days",
        growth: 40, need: 100, next: "开窍", canBreak: false,
      }),
      headCountOf: () => 6,
      todayKey: () => "2026-09-29",
      unreadMail: () => 0,
      cgCollectedIds: () => [], cgMetaOf: () => null, CG_TOTAL: 8,
      STAGES: [
        { icon: "🌱", name: "凝形" }, { icon: "🌿", name: "开窍" },
        { icon: "🌙", name: "蜕形" }, { icon: "👑", name: "化形" },
      ],
    },
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  return { sandbox, view };
}

/* ---------- 4. 标签栈解析 ---------- */
const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);
function parse(html) {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  const stack = [];
  const problems = [];
  const opens = [];      // {cls, ancestors:[cls...]}
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] || "", selfClose = m[4] === "/";
    if (closing) {
      if (!stack.length) { problems.push("多余的闭合标签 </" + tag + ">"); continue; }
      const top = stack[stack.length - 1];
      if (top.tag !== tag) {
        const idx = stack.map((x) => x.tag).lastIndexOf(tag);
        if (idx < 0) { problems.push("孤立的闭合标签 </" + tag + ">（栈顶是 <" + top.tag + ">）"); continue; }
        problems.push("标签错配：在 <" + top.tag + " class=\"" + top.cls + "\"> 处收到 </" + tag + ">");
        stack.length = idx; continue;
      }
      stack.pop();
    } else if (!VOID.has(tag) && !selfClose) {
      const cm = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
      const cls = cm ? (cm[1] || cm[2] || "") : "";
      opens.push({ cls, ancestors: stack.map((x) => x.cls) });
      stack.push({ tag, cls });
    }
  }
  return { problems, stack, opens };
}
const classesOf = (s) => String(s || "").split(/\s+/).filter(Boolean);
function isInside(opens, targetCls, ancestorCls) {
  const hits = opens.filter((o) => classesOf(o.cls).indexOf(targetCls) >= 0);
  if (!hits.length) return { n: 0, okAll: false };
  return { n: hits.length, okAll: hits.every((h) => h.ancestors.some((a) => classesOf(a).indexOf(ancestorCls) >= 0)) };
}

/* ---------- 5. 跑 ---------- */
function runRenderer(name) {
  const { sandbox, view } = makeSandbox();
  const other = name === "renderSpiritPage" ? "renderAllSpiritsPage" : "renderSpiritPage";
  const ctx = vm.createContext(sandbox);
  const code = extractFn(name) + "\n" + extractFn(other) + "\n;__fn = " + name + ";";
  vm.runInContext(code, ctx, { filename: "app.js#extracted" });
  sandbox.__fn();
  return view.innerHTML;
}

function checkPage(name, label) {
  section(label + "（" + name + "）");
  const html = runRenderer(name);
  ok(html.length > 200, "渲染出非空 HTML（" + html.length + " 字节）");

  const { problems, stack, opens } = parse(html);
  ok(problems.length === 0, "无标签错配 / 无孤立或多条闭合标签" + (problems.length ? " —— " + problems.join("；") : ""));
  ok(stack.length === 0, "标签栈最终清空（无未闭合标签）" + (stack.length ? " —— 残留 " + stack.map((s) => s.tag + "." + s.cls).join(", ") : ""));

  const cards = opens.filter((o) => classesOf(o.cls).indexOf("spirit-card") >= 0).length;
  ok(cards === LIST.length, ".spirit-card 数量 = 数据条数（" + cards + " / " + LIST.length + "）");

  // 直接挂在 .spirit-card 下面的子元素 —— 正常只该有 2 个：缩略图 + 元信息块
  const directKids = opens.filter((o) => o.ancestors.length && classesOf(o.ancestors[o.ancestors.length - 1]).indexOf("spirit-card") >= 0).length;
  ok(directKids === LIST.length * 2,
    ".spirit-card 的直接子元素恰好 2 个/张（缩略图 + 元信息块）：实测 " + directKids + "，期望 " + LIST.length * 2 +
    (directKids > LIST.length * 2 ? " ← 元信息块被提前闭合，文本会塌成 1 字竖排" : ""));

  const metas = opens.filter((o) => classesOf(o.cls).indexOf("spirit-meta") >= 0).length;
  ok(metas === LIST.length, ".spirit-meta 数量 = 数据条数（" + metas + " / " + LIST.length + "）");

  ["spirit-title", "spirit-line", "spirit-prog", "spirit-tags", "spirit-stage"].forEach((c) => {
    const r = isInside(opens, c, "spirit-meta");
    ok(r.n > 0 && r.okAll, "." + c + " 全部位于 .spirit-meta 内部（命中 " + r.n + " 个）");
  });
  const st = isInside(opens, "sp-stars", "spirit-name");
  if (name === "renderSpiritPage") ok(st.n > 0 && st.okAll, ".sp-stars 全部位于 .spirit-name 内部（命中 " + st.n + " 个）");
  else ok(st.n === 0 || st.okAll, ".sp-stars 若存在则位于 .spirit-name 内部（命中 " + st.n + " 个）");
}

checkPage("renderSpiritPage", "#/spirit 沁灵页");
checkPage("renderAllSpiritsPage", "#/spirits 全部沁灵页");

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
