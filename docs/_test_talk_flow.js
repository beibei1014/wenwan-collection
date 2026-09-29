/* 夜话 / 主线对话页（renderTalkPage）对话流回归测试。
   作者不可信原则：本脚本自己抽源码 + 假 DOM + 手动计时器，从零构造输入跑一遍 ——
   不依赖浏览器、不依赖 renderTalkPage 的调用方（app.js 其余部分）。
   覆盖：
     · talkDwell 按字长停留公式（clamp(700 + len×55, 700, 4000)）
     · 去逐字打字机后：一条消息只重建 1 次节点、无半截前缀（闪烁回归）
     · me / sys 不给三点气泡；连续消息之间 >0 间隔（不连成一坨）
     · 点一下跳过：全部铺开、showFoot、无重复追加
     · 【v163e 回归】在「正在输入」三点气泡窗口内点跳过 —— 不吞（也不重）在途那条
   用法：
     node docs/_test_talk_flow.js                                  # 跑仓库内 js/app.js
     APP_SRC_FILE=<path to before> node docs/_test_talk_flow.js     # 负向对照（改动前源码必须失败）
   负向对照示例（v163d 逐字打字机 / v163e 吞消息）：
     git show cf7b3dc:js/app.js > "<tmp>/app_v163d.js"
     APP_SRC_FILE="<tmp>/app_v163d.js" node docs/_test_talk_flow.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");
const SRC_FILE = process.env.APP_SRC_FILE
  ? path.resolve(process.env.APP_SRC_FILE)
  : path.join(REPO, "js/app.js");
const src = fs.readFileSync(SRC_FILE, "utf8");
console.log("源码：" + SRC_FILE + "  （" + src.length + " 字节）");

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function info(s) { console.log("  · " + s); }

/* ---------------- 1. 抽源码（大括号配对，跳过字符串/注释） ---------------- */
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
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

const fnSrc = extractFn("renderTalkPage");
const dwellSrc = extractFn("talkDwell");
const consts = {};
{
  const re = /const\s+(TALK_[A-Z0-9_]+)\s*=\s*([0-9]+)\s*;/g; let m;
  while ((m = re.exec(src))) consts[m[1]] = Number(m[2]);
}
if (!fnSrc) { console.log("致命：抽不到 renderTalkPage"); process.exit(2); }
console.log("抽到 renderTalkPage：" + fnSrc.length + " 字节");
console.log("抽到 talkDwell：" + (dwellSrc ? "有（" + dwellSrc.length + " 字节）" : "无"));
console.log("抽到常量：" + JSON.stringify(consts));

/* ---------------- 2. 独立实现一份 clamp 公式（用于对齐源码） ---------------- */
function refDwell(text, MIN, PER, MAX) {
  const len = String(text || "").length;
  return Math.max(MIN, Math.min(MAX, MIN + len * PER));
}

/* ---------------- 3. 假 DOM ---------------- */
const WRITES = [];              // 全量 innerHTML/textContent 写日志 {el, html}
function makeElement(role) {
  const el = {
    _role: role || "el", _html: "", _fc: null, children: [], _listeners: {},
    style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(n) { this.children.push(n); if (this._onInsert) this._onInsert(n); return n; },
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {}, focus() {}, scrollIntoView() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._html; },
    set(v) {
      this._html = String(v);
      WRITES.push({ el: this._role, html: this._html });
      const fc = firstTagEl(this._html);
      this._fc = fc;
    },
  });
  Object.defineProperty(el, "firstChild", { get() { return this._fc; }, set(v) { this._fc = v; } });
  Object.defineProperty(el, "textContent", {
    get() { return this._html; },
    set(v) { this._html = String(v); WRITES.push({ el: this._role, html: this._html }); },
  });
  return el;
}
function firstTagEl(html) {
  const m = /^\s*<div([^>]*)>/.exec(html);
  if (!m) return null;
  const cm = /class\s*=\s*"([^"]*)"/.exec(m[1]);
  const el = makeElement("child");
  el._html = html;
  if (cm) cm[1].split(/\s+/).forEach((c) => { if (c) el.classList.add(c); });
  return el;
}

/* ---------------- 4. 假计时器（手动队列 + 虚拟时钟） ---------------- */
let NOW = 0, TID = 0, QUEUE = [], TLOG = [];
function fakeSetTimeout(fn, delay) {
  const d = Number(delay) || 0;
  const e = { id: ++TID, fn, delay: d, at: NOW + d, cleared: false, ran: false };
  QUEUE.push(e); TLOG.push(e); return e.id;
}
function fakeClearTimeout(id) { const e = QUEUE.find((x) => x.id === id) || TLOG.find((x) => x.id === id); if (e) e.cleared = true; }
function pending() { return QUEUE.filter((e) => !e.ran && !e.cleared); }
function runNext() {
  const p = pending().sort((a, b) => (a.at - b.at) || (a.id - b.id));
  if (!p.length) return false;
  const e = p[0]; NOW = e.at; e.ran = true; e.fn(); return true;
}
function flush() { let g = 0; while (runNext()) { if (++g > 5000) throw new Error("计时器死循环"); } }

/* ---------------- 5. 跑一个场景 ---------------- */
function play(added, opts) {
  opts = opts || {};
  WRITES.length = 0; NOW = 0; TID = 0; QUEUE = []; TLOG = [];
  const appended = [];
  const view = makeElement("view");
  const body = makeElement("body");
  const foot = makeElement("foot");
  const pend = makeElement("pend");
  body._onInsert = (n) => { appended.push({ t: NOW, html: n._html }); };
  const known = { "#ntBody": body, "#ntFoot": foot, "#ntPend": pend };

  const doc = {
    createElement: (tag) => makeElement("created:" + tag),
    getElementById: (id) => known[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {},
    body: { scrollHeight: 1000, appendChild() {}, classList: { add() {}, remove() {} } },
    documentElement: { style: {}, classList: { add() {}, remove() {} } },
  };
  const sandbox = {
    console, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object, Error, RegExp, Promise, Intl, Map, Set,
    encodeURIComponent, decodeURIComponent,
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    location: { hash: "" }, document: doc,
    $: (sel) => known[sel] || null,
    view, topbarTitle: { textContent: "", style: {} }, btnBack: { style: {} }, btnSettings: { style: {} },
    esc: (s) => (s == null ? "" : String(s)),
    meAvatarHtml: () => '<span class="me-av"></span>',
    bindSpiritImgFallback: () => {},
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;

  const constDecl = Object.keys(consts).map((k) => "const " + k + " = " + consts[k] + ";").join("\n");
  const code = constDecl + "\n" + (dwellSrc || "") + "\n" + fnSrc + "\n;__fn = renderTalkPage;";
  vm.runInContext(code, vm.createContext(sandbox), { filename: "app.js#extracted" });

  const o = {
    title: "T", headAv: "", headName: "头部", headSub: "S",
    av: () => '<span class="ntav"></span>',
    nameOf: (w) => "昵称:" + w,
    enter: () => ({ added: added.slice(), choices: opts.choices || null, ending: opts.ending || null, ended: false, log: [] }),
    replay: () => ({ added: added.slice(), choices: opts.choices || null, ending: opts.ending || null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  };
  sandbox.__fn(o);
  const h = {
    appended, body, foot, pend, view,
    clock: () => NOW,
    runNext, flush, pending, pendingCount: () => pending().length,
    clickBody: () => { (body._listeners.click || []).forEach((f) => f()); },
    clickCount: () => (body._listeners.click || []).length,
  };
  Object.defineProperty(h, "writes", { get() { return WRITES.slice(); } });
  Object.defineProperty(h, "delays", { get() { return TLOG.map((e) => e.delay); } });
  return h;
}

/* ---------------- 6. 文本工具 ---------------- */
const textNodes = (html) => { const out = []; const re = />([^<]*)</g; let m; while ((m = re.exec(html))) { const t = m[1].trim(); if (t) out.push(t); } return out; };
const rendersOf = (h, T) => h.writes.filter((w) => textNodes(w.html).some((x) => x.length && T.indexOf(x) === 0)).length;
const fullOf = (h, T) => h.writes.filter((w) => textNodes(w.html).some((x) => x === T)).length;
const partialsOf = (h, T) => { const out = []; h.writes.forEach((w) => textNodes(w.html).forEach((x) => { if (x.length && x.length < T.length && T.indexOf(x) === 0) out.push(x); })); return out; };
const typingWrites = (h) => h.writes.filter((w) => /nt-typing/.test(w.html)).length;
const appendCount = (h, T) => h.appended.filter((a) => a.html.indexOf(T) >= 0).length;

// 生成第 k 条、长 n 的唯一文本（首字不同 → 互不为前缀）
const mk = (k, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(0x4e00 + k * 60 + i); return s; };

/* ================= 断言 0：公式一致性 ================= */
section("断言0：talkDwell 与独立 clamp 公式一致");
if (!dwellSrc) {
  info("改动前源码无 talkDwell —— 跳过（负向对照预期）");
} else {
  const need = ["TALK_MIN_MS", "TALK_PER_CHAR_MS", "TALK_MAX_MS", "TALK_LEAD_MS"];
  const miss = need.filter((k) => consts[k] == null);
  ok(miss.length === 0, "常量齐全（" + need.join("/") + "）" + (miss.length ? "，缺 " + miss.join(",") : ""));
  ok(consts.TALK_MIN_MS === 700 && consts.TALK_PER_CHAR_MS === 55 && consts.TALK_MAX_MS === 4000,
    "常量值 = 700/55/4000，实测 " + consts.TALK_MIN_MS + "/" + consts.TALK_PER_CHAR_MS + "/" + consts.TALK_MAX_MS);
  ok(consts.TALK_LEAD_MS === 300, "TALK_LEAD_MS = 300，实测 " + consts.TALK_LEAD_MS);
  // 用源码里的真 talkDwell 对比独立 clamp（把常量一起注入 Function 作用域）
  const dwellCtx = Object.keys(consts).map((k) => "const " + k + " = " + consts[k] + ";").join("\n") + "\n" + dwellSrc;
  let bad = [];
  const d = new Function("text", dwellCtx + "\nreturn talkDwell(text);");
  for (let n = 0; n <= 130; n++) {
    const t = mk(1, n);
    const got = d(t);
    const exp = refDwell(t, consts.TALK_MIN_MS, consts.TALK_PER_CHAR_MS, consts.TALK_MAX_MS);
    if (got !== exp) bad.push("len=" + n + " got=" + got + " exp=" + exp);
  }
  ok(bad.length === 0, "0..130 字逐长度一致" + (bad.length ? " —— 不符：" + bad.slice(0, 5).join("; ") : ""));
  ok(d(undefined) === 700, "talkDwell(undefined) = 700，实测 " + d(undefined));
  ok(d("") === 700, "talkDwell(\"\") = 700，实测 " + d(""));
  ok(!Number.isNaN(d(null)) && !Number.isNaN(d(undefined)), "talkDwell 不返回 NaN");
}

/* ================= 场景 A：单条角色消息（核心） ================= */
section("断言1/2/3/6：单条角色消息的节点重建 / 半截文本 / 打字机 / 三点气泡");
{
  const T = mk(1, 12);                 // 12 字角色消息
  const h = play([{ w: "阿福", name: "阿福", text: T }]);
  // 播放前先看定时器：应先排一次 TALK_LEAD_MS
  ok(h.pendingCount() === 1 && h.delays[0] === 300, "角色消息先排 1 个 TALK_LEAD_MS(300) 定时器，实测 " + JSON.stringify(h.delays));
  h.flush();
  const renders = rendersOf(h, T);
  const partials = partialsOf(h, T);
  const fulls = fullOf(h, T);
  info("消息字数 " + T.length + "；节点重建次数=" + renders + "；完整文本写入次数=" + fulls + "；半截写入=" + partials.length);
  ok(renders === 1, "【断言1】同一消息 DOM 重建次数 = 1（实测 " + renders + "）");
  ok(partials.length === 0, "【断言2】无任何半截前缀文本被写入（实测 " + partials.length + " 处：" + partials.slice(0, 6).join(",") + "）");
  ok(fulls === 1, "【断言3】完整文本只在 1 次写入里出现（实测 " + fulls + "）");
  ok(typingWrites(h) >= 1, "【断言6】角色消息出现 nt-typing 三点气泡（实测 " + typingWrites(h) + " 次）");
  info("定时器序列 delay = " + JSON.stringify(h.delays));

  // 超长角色消息（>80 字，改动前有“每拍多吐 1 字”的特殊分支）
  const TL = mk(9, 120);
  const hl = play([{ w: "阿福", name: "阿福", text: TL }]);
  hl.flush();
  info("超长角色消息 (" + TL.length + " 字)：节点重建=" + rendersOf(hl, TL) + "，半截=" + partialsOf(hl, TL).length + "，完整写入=" + fullOf(hl, TL));
  ok(rendersOf(hl, TL) === 1 && partialsOf(hl, TL).length === 0, "120 字角色消息也只重建 1 次、无半截（实测 " + rendersOf(hl, TL) + "/" + partialsOf(hl, TL).length + "）");
}

/* ================= 场景 B：me / sys 不给三点气泡 ================= */
section("断言6：me / sys 不给三点气泡");
{
  const Tm = mk(2, 10), Ts = mk(3, 8);
  const hm = play([{ w: "me", text: Tm }]);
  hm.flush();
  ok(typingWrites(hm) === 0, "me 消息无 nt-typing（实测 " + typingWrites(hm) + "）");
  ok(rendersOf(hm, Tm) === 1 && partialsOf(hm, Tm).length === 0, "me 消息仍是一次性出现（重建 " + rendersOf(hm, Tm) + "，半截 " + partialsOf(hm, Tm).length + "）");
  info("me 定时器序列 delay = " + JSON.stringify(hm.delays));

  const hs = play([{ w: "sys", text: Ts }]);
  hs.flush();
  ok(typingWrites(hs) === 0, "sys 消息无 nt-typing（实测 " + typingWrites(hs) + "）");
  ok(rendersOf(hs, Ts) === 1 && partialsOf(hs, Ts).length === 0, "sys 消息一次性出现（重建 " + rendersOf(hs, Ts) + "，半截 " + partialsOf(hs, Ts).length + "）");
  info("sys 定时器序列 delay = " + JSON.stringify(hs.delays));
}

/* ================= 场景 C：按字长停留 ================= */
section("断言4：按字长停留 clamp(700+len*55,700,4000) 实测（角色消息）");
{
  const lens = [1, 2, 5, 10, 20, 30, 40, 60, 80, 100, 120];
  const table = [];
  let guard = null;
  for (let i = 0; i < lens.length; i++) {
    const n = lens[i]; const T = mk(10 + i, n);
    const h = play([{ w: "阿福", name: "阿福", text: T }]);
    h.flush();
    const dwell = h.delays.length >= 2 ? h.delays[1] : h.delays[0];
    const exp = refDwell(T, consts.TALK_MIN_MS || 700, consts.TALK_PER_CHAR_MS || 55, consts.TALK_MAX_MS || 4000);
    table.push({ n, dwell, exp });
    if (dwell !== exp) guard = "len=" + n + " 实测 " + dwell + " ≠ 公式 " + exp;
  }
  table.forEach((r) => info("字数 " + String(r.n).padStart(3) + " → 停留 " + String(r.dwell).padStart(4) + " ms   （公式 " + r.exp + "）"));
  ok(!guard, "角色消息停留全部等于公式" + (guard ? " —— " + guard : ""));
  let mono = true; for (let i = 1; i < table.length; i++) if (table[i].dwell < table[i - 1].dwell) mono = false;
  ok(mono, "停留随字数单调不减");
  ok(table[table.length - 1].dwell === (consts.TALK_MAX_MS || 4000), "120 字被封顶在 " + (consts.TALK_MAX_MS || 4000) + "ms，实测 " + table[table.length - 1].dwell);
  ok(table[0].dwell === 755, "1 字 = 700+55 = 755ms（下限 700 仅空串触及），实测 " + table[0].dwell);
  const h0 = play([{ w: "阿福", name: "阿福", text: "" }]); h0.flush();
  ok(h0.delays[h0.delays.length - 1] === (consts.TALK_MIN_MS || 700), "空文本 = 下限 " + (consts.TALK_MIN_MS || 700) + "ms，实测 " + h0.delays[h0.delays.length - 1]);

  // me / sys 也用同一 dwell
  const T7 = mk(40, 7);
  const hm7 = play([{ w: "me", text: T7 }]); hm7.flush();
  const hs7 = play([{ w: "sys", text: T7 }]); hs7.flush();
  const exp7 = refDwell(T7, consts.TALK_MIN_MS || 700, consts.TALK_PER_CHAR_MS || 55, consts.TALK_MAX_MS || 4000);
  info("me/sys 7 字 → " + hm7.delays[0] + " / " + hs7.delays[0] + " ms（公式 " + exp7 + "）");
  ok(hm7.delays[0] === exp7 && hs7.delays[0] === exp7, "me/sys 停留同为按字长公式");
}

/* ================= 场景 D：一条一条，不连成一坨 ================= */
section("断言5：连续两条角色消息之间存在 >0 间隔");
{
  const T1 = mk(50, 6), T2 = mk(51, 6);
  const h = play([{ w: "阿福", name: "阿福", text: T1 }, { w: "阿福", name: "阿福", text: T2 }]);
  h.flush();
  const ap = h.appended.map((a) => a.t);
  info("两次 append 的虚拟时刻：" + JSON.stringify(ap) + "；间隔 " + (ap[1] - ap[0]) + " ms");
  ok(ap.length === 2 && ap[1] - ap[0] > 0, "两条角色消息之间有 >0 间隔（" + (ap[1] - ap[0]) + " ms）");
  const expGap = refDwell(T1, 700, 55, 4000) + (consts.TALK_LEAD_MS || 300);
  ok(ap[1] - ap[0] === expGap, "间隔 = dwell(前一条) + TALK_LEAD_MS = " + expGap + "ms，实测 " + (ap[1] - ap[0]));
  // me → me 之间也不能同步连发
  const T3 = mk(52, 6), T4 = mk(53, 6);
  const h2 = play([{ w: "me", text: T3 }, { w: "me", text: T4 }]);
  h2.flush();
  const ap2 = h2.appended.map((a) => a.t);
  ok(ap2.length === 2 && ap2[1] - ap2[0] > 0, "两条 me 消息之间有 >0 间隔（" + (ap2[1] - ap2[0]) + " ms）");
}

/* ================= 场景 E：点一下跳过 ================= */
section("断言7：播放中途点一下 —— 全部铺开 / showFoot / 无重复追加");
{
  const T1 = mk(60, 20), T2 = mk(61, 30), T3 = mk(62, 6), T4 = mk(63, 40);
  const added = [
    { w: "me", text: T1 },
    { w: "me", text: T2 },
    { w: "me", text: T3 },
    { w: "me", text: T4 },
  ];
  // 7a：在 me 的 dwell 等待中点（此时无打字气泡挂着）
  const h = play(added, { ending: { name: "收尾", text: "结束语" } });
  h.runNext();                       // 播完 T1 -> 等 T2
  ok(h.pendingCount() === 1, "7a 点击前排了 1 个等待定时器");
  h.clickBody();
  const afterClick = h.pendingCount();
  ok(afterClick === 0, "7a 点击后无残留定时器（实测 pending=" + afterClick + "）");
  h.flush();
  const eachOnce = added.every((m, i) => appendCount(h, m.text) === 1);
  ok(eachOnce, "7a 每条消息恰好 append 1 次（实测 " + added.map((m) => appendCount(h, m.text)).join(",") + "）");
  ok(h.appended.length === added.length, "7a append 总数 = 消息数（" + h.appended.length + "/" + added.length + "）");
  ok(/nt-end/.test(h.foot.innerHTML), "7a showFoot 被调用（foot 出现 nt-end 收尾卡）");
  ok(partialsOf(h, T1).length === 0 && partialsOf(h, T4).length === 0, "7a 跳过后无半截文本");
  info("7a 时间线 append t = " + JSON.stringify(h.appended.map((a) => a.t)));

  // 7b：在角色消息「三点气泡」挂着的 300ms 窗口中点
  const R1 = mk(70, 8), R2 = mk(71, 30), R3 = mk(72, 6);
  const added2 = [{ w: "阿福", name: "阿福", text: R1 }, { w: "me", text: R2 }, { w: "me", text: R3 }];
  const h2 = play(added2, { ending: { name: "收尾", text: "结束语" } });
  // play() 里 step() 已同步跑过一拍：R1 的三点气泡应已挂在 pend 上、且 R1 尚未 append，等 300ms 后才 append
  ok(h2.pendingCount() === 1 && /nt-typing/.test(h2.pend.innerHTML), "7b 当前正在显示 R1 的三点气泡（pend 内容含 nt-typing：" + /nt-typing/.test(h2.pend.innerHTML) + "）");
  ok(appendCount(h2, R1) === 0, "7b 此刻 R1 尚未 append（节点数 " + appendCount(h2, R1) + "）");
  h2.clickBody();
  h2.flush();
  const cnt = added2.map((m) => appendCount(h2, m.text));
  info("7b 每条 append 次数 = " + JSON.stringify(cnt) + "（R1/R2/R3）");
  ok(/nt-end/.test(h2.foot.innerHTML), "7b showFoot 被调用");
  ok(cnt[0] === 1, "7b 正在打字的角色消息 R1 也必须铺开（实测 append " + cnt[0] + " 次）");
  ok(cnt[1] === 1 && cnt[2] === 1, "7b 剩余消息各 1 次（实测 " + cnt[1] + "/" + cnt[2] + "）");
  ok(h2.appended.length === added2.length, "7b append 总数 = 消息数（" + h2.appended.length + "/" + added2.length + "）");
}

/* ================= 场景 F：边界 ================= */
section("断言8：边界输入不抛异常");
{
  const tryPlay = (label, added, opts) => {
    try { const h = play(added, opts); h.flush(); return { h, err: null }; }
    catch (e) { return { h: null, err: e }; }
  };
  let r;
  r = tryPlay("仅 1 条 me", [{ w: "me", text: mk(80, 5) }]);
  ok(!r.err, "仅 1 条 me 不抛异常" + (r.err ? " —— " + r.err.message : "") + "（append " + (r.h ? r.h.appended.length : "-") + "）");
  r = tryPlay("仅 1 条 sys", [{ w: "sys", text: mk(81, 5) }]);
  ok(!r.err, "仅 1 条 sys 不抛异常" + (r.err ? " —— " + r.err.message : "") + "（append " + (r.h ? r.h.appended.length : "-") + "）");
  r = tryPlay("仅 1 条角色", [{ w: "阿福", name: "阿福", text: mk(82, 5) }]);
  ok(!r.err, "仅 1 条角色不抛异常" + (r.err ? " —— " + r.err.message : "") + "（append " + (r.h ? r.h.appended.length : "-") + "）");
  r = tryPlay("空数组", []);
  ok(!r.err, "空消息数组不抛异常" + (r.err ? " —— " + r.err.message : ""));
  r = tryPlay("text=undefined(me)", [{ w: "me" }]);
  ok(!r.err, "me 的 text=undefined 不抛异常" + (r.err ? " —— " + r.err.message : ""));
  r = tryPlay("text=undefined(角色)", [{ w: "阿福", name: "阿福" }]);
  ok(!r.err, "角色 text=undefined 不抛异常" + (r.err ? " —— " + r.err.message : ""));
  r = tryPlay("text=''(sys)", [{ w: "sys", text: "" }]);
  ok(!r.err, "sys text='' 不抛异常" + (r.err ? " —— " + r.err.message : ""));
  r = tryPlay("null/空文本混合", [{ w: "me", text: null }, { w: "阿福", name: "阿福", text: "" }, { w: "sys", text: undefined }]);
  ok(!r.err, "null / '' / undefined 混合不抛异常" + (r.err ? " —— " + r.err.message : "") + "（append " + (r.h ? r.h.appended.length : "-") + "）");
}

/* ========== 断言9（v163e 回归）：点跳过不吞「正在输入」的那条 ==========
   缺陷机制：某条角色消息刚挂上三点气泡、TALK_LEAD_MS 定时器还没触发时点一下屏幕 ——
     · step() 在「展示之前」就 qi++（下标前移），该条只在 setTimeout 回调里才 append
     · 点击处理 clearTimeout 把这个回调干掉，紧接着的 while 从已前移的 qi 起铺
     · → 这条既没被回调显示、也没被 while 补上 = 被吞掉（实测 append 序列 [0,1,1]）
   修法：用 inflight 显式记账「已取出但未显示」的那条，点击时先补它、再铺剩下的。
*/
section("断言9：3 条角色消息，在第一条三点气泡窗口内点跳过 —— 不吞不重");
{
  const R1 = mk(90, 12), R2 = mk(91, 9), R3 = mk(92, 15);
  const added = [
    { w: "阿福", name: "阿福", text: R1 },
    { w: "阿福", name: "阿福", text: R2 },
    { w: "阿福", name: "阿福", text: R3 },
  ];
  const h = play(added, { ending: { name: "收尾", text: "结束语" } });
  // play() 已同步跑过一拍：第一条的三点气泡应挂起、qi 已前移、inflight = 第一条，且此刻尚未 append
  ok(h.pendingCount() === 1 && /nt-typing/.test(h.pend.innerHTML),
    "第一条的三点气泡正在显示（pend 含 nt-typing：" + /nt-typing/.test(h.pend.innerHTML) + "）");
  ok(appendCount(h, R1) === 0, "此刻第一条尚未 append（实测 " + appendCount(h, R1) + "）");
  h.clickBody();                              // 在 300ms 窗口内点跳过
  const afterClick = h.pendingCount();
  ok(afterClick === 0, "点击后无残留定时器（实测 pending=" + afterClick + "）");
  h.flush();
  const cnt = added.map((m) => appendCount(h, m.text));
  info("每条 append 次数 = " + JSON.stringify(cnt) + "（期望 [1,1,1]）");
  ok(cnt.every((c) => c === 1), "每条角色消息恰好 append 一次（既不能漏、也不能重），实测 " + JSON.stringify(cnt));
  ok(h.appended.length === added.length, "append 次数 == 消息总数（" + h.appended.length + "/" + added.length + "）");
  ok(/nt-end/.test(h.foot.innerHTML), "showFoot 被调用（foot 出现 nt-end 收尾卡）");
  ok(partialsOf(h, R1).length === 0 && partialsOf(h, R2).length === 0 && partialsOf(h, R3).length === 0,
    "无半截前缀文本残留");
  // 顺序：必须 R1 → R2 → R3（先补 inflight 再铺 qi 的顺序反了会错序）
  const order = h.appended.map((a) => (a.html.indexOf(R1) >= 0 ? 1 : a.html.indexOf(R2) >= 0 ? 2 : a.html.indexOf(R3) >= 0 ? 3 : 0));
  ok(order.length === 3 && order[0] === 1 && order[1] === 2 && order[2] === 3,
    "铺开顺序 = R1,R2,R3（实测 " + JSON.stringify(order) + "）");
}

/* ---------------- 汇总 ---------------- */
console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
