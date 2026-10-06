/* v174-C2A 自测：事件卡单张队列（纯状态机）+ 纪事页 HTML 结构 + 源码级纪律
   为什么这么测：app.js 是 DOM 密集文件，队列算法已抽成纯函数（evtEnqueue / evtPump），
   所以能脱离 DOM 真跑一遍；HTML 构建函数（evtCardHtml / evtDaysHtml / …）做标签栈平衡。

   用法： node docs/_test_v174_events_ui.js
   负向对照（证明这套断言真抓得住「没实现」）：
     git show 03c473c:js/app.js > /tmp/app_03c473c.js          # ⛔ 绝不 git show HEAD
     APP_SRC=/tmp/app_03c473c.js node docs/_test_v174_events_ui.js   → 必须 FAIL
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC_FILE = process.env.APP_SRC ? path.resolve(process.env.APP_SRC) : path.join(ROOT, "js/app.js");
const src = fs.readFileSync(SRC_FILE, "utf8");
const SRC_LF = src.replace(/\r\n/g, "\n");     // js/app.js 是纯 CRLF；标记切分/正则一律在 LF 视图上做
console.log("源码：" + SRC_FILE);

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
// 断言包装：内部抛错也算失败（⛔ 不让负向对照把测试整个炸掉）
function T(msg, fn) { let v; try { v = fn(); } catch (e) { ok(false, msg + "（抛错：" + (e && e.message) + "）"); return; } ok(!!v, msg); }

/* ---------- 从源码切出两个标记区（负向对照时为空串） ---------- */
function between(s, a, b) { const i = s.indexOf(a), j = s.indexOf(b); return (i < 0 || j < 0 || j <= i) ? "" : s.slice(i + a.length, j); }
const CORE = between(SRC_LF, "// >>> v174 evtqueue pure-core begin", "// <<< v174 evtqueue pure-core end");
const VIEW = between(SRC_LF, "// >>> v174 evtview begin", "// <<< v174 evtview end");

/* ---------- 沙箱 ---------- */
function makeCtx() {
  const mem = new Map();
  const sandbox = {
    console, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object, Error, RegExp, Promise, Intl, Map, Set,
    encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout, queueMicrotask,
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    // app.js 里在标记区之外、被 HTML 构建函数用到的两个依赖：
    esc: (s) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))),
    emptyCardHtml: (o) => '<div class="empty empty-card">' + ((o && o.title) || "") + "</div>",
    Spirits: {
      todayKey: (ts) => { const d = ts ? new Date(Number(ts)) : new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); },
      EVENT_CHIP_ORDER: ["all", "story", "bond", "fest", "night"],
    },
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  return sandbox;
}
function loadCore() {
  const sb = makeCtx();
  const ctx = vm.createContext(sb);
  const G = (n, t) => " " + n + ": (typeof " + n + "==='" + t + "')?" + n + ":null,";
  const code = "var EVENT_TOAST_MS = 6000;\n" + CORE + "\n" + VIEW + "\n" +
    ";globalThis.__V = {" +
    G("EVT_QUEUE_MAX", "number") + G("EVT_L1_MERGE", "number") + G("EVT_PAGE", "number") +
    G("EVT_SUM_TITLE", "string") +
    " EVT_DWELL: (typeof EVT_DWELL!=='undefined')?EVT_DWELL:null," +
    " EVT_LEVELS: (typeof EVT_LEVELS!=='undefined')?EVT_LEVELS:null," +
    G("evtEnqueue", "function") + G("evtPump", "function") + G("evtAdvance", "function") + G("evtLevelOf", "function") +
    G("evtSummaryCard", "function") + G("evtCardHtml", "function") + G("evtRowHtml", "function") +
    G("evtDaysHtml", "function") + G("evtGroupByDay", "function") + G("evtHeadHtml", "function") +
    G("evtTabsHtml", "function") + G("evtMoreHtml", "function") + G("evtDayLabel", "function") +
    G("evtTimeLabel", "function") + G("evtIconInner", "function") + G("evtGlyphOf", "function") +
    "};";
  try { vm.runInContext(code, ctx, { filename: "app.js#v174core" }); }
  catch (e) { console.log("（核心区求值失败：" + e.message + "）"); }
  return sb.__V || {};
}
const V = loadCore();

/* ---------- 标签栈解析（同 _test_v163c_layout.js） ---------- */
const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);
function parse(html) {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  const stack = [], problems = [], opens = [];
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] || "", selfClose = m[4] === "/";
    if (closing) {
      if (!stack.length) { problems.push("多余的闭合 </" + tag + ">"); continue; }
      const top = stack[stack.length - 1];
      if (top.tag !== tag) {
        const idx = stack.map((x) => x.tag).lastIndexOf(tag);
        if (idx < 0) { problems.push("孤立的闭合标签 </" + tag + ">（栈顶是 <" + top.tag + ">）"); continue; }
        problems.push("标签错配：在 <" + top.tag + "> 处收到 </" + tag + ">");
        stack.length = idx;
      } else stack.pop();
    } else if (!VOID.has(tag) && !selfClose) {
      const cm = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
      opens.push({ cls: cm ? (cm[1] || cm[2] || "") : "", tag });
      stack.push({ tag, cls: "" });
    }
  }
  return { problems, stack, opens };
}
function balanced(html) { const r = parse(html); return r.problems.length === 0 && r.stack.length === 0; }
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

/* ---------- 测试数据 ---------- */
function mk(level, at, title) {
  const type = level === "l1" ? "gift" : (level === "l2" ? "chapter" : "fest");
  return { id: type + at, type: type, at: at, level: level, title: title || (type + at),
    ownerId: "it1", ownerName: "老檀", summary: "一句话" };
}

/* ============================ ① 级别映射 ============================ */
section("① 级别映射（UI 只读 p.level，⛔ 不按 type 猜）");
T("evtLevelOf 认 l1/l2/l3", () => V.evtLevelOf && ["l1", "l2", "l3"].every((l) => V.evtLevelOf({ level: l }) === l));
T("未知 / 缺 level ⇒ 回落 l1", () => V.evtLevelOf && V.evtLevelOf({ level: "x" }) === "l1" && V.evtLevelOf({}) === "l1");
T("EVT_DWELL = {l1:2600, l2:6000, l3:0}（l3=0 不自动收）", () => V.EVT_DWELL && V.EVT_DWELL.l1 === 2600 && V.EVT_DWELL.l2 === 6000 && V.EVT_DWELL.l3 === 0);
T("EVT_QUEUE_MAX = 3（同时在场恒为 1，队列上限 3）", () => V.EVT_QUEUE_MAX === 3);
T("EVT_LEVELS 三级别类名齐", () => V.EVT_LEVELS && V.EVT_LEVELS.l1 === "is-l1" && V.EVT_LEVELS.l2 === "is-l2" && V.EVT_LEVELS.l3 === "is-l3");

/* ============================ ② l1 合并阈值（验收路径#1） ============================ */
section("② ≥3 条同级 l1 合并成 1 张汇总卡（验收路径#1）");
T("≤2 条 l1 不合并", () => { const st = V.evtEnqueue && V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l1", 2)]); return st && st.queue.length === 2 && !st.queue.some((x) => x.sum); });
T("≥3 条同级 l1 合并成 1 张（count=3）", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l1", 2), mk("l1", 3)]); return st && st.queue.length === 1 && st.queue[0].sum === true && st.queue[0].count === 3; });
T("汇总卡文案：标题「今天又添了几件小事」+「还有 3 件 · 回头在纪事墙上看。」+ ⛔无按钮", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l1", 2), mk("l1", 3)]); const c = st.queue[0]; if (!(c && c.title === V.EVT_SUM_TITLE && /还有 3 件/.test(c.summary) && c.go === null)) return false; const h = V.evtCardHtml(c); return h && !/evt-go/.test(h); });
T("l1 合并只并同级 l1（l2 不被并进去）", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l1", 2), mk("l1", 3), mk("l2", 4)]); const sums = st.queue.filter((x) => x.sum); return sums.length === 1 && sums[0].count === 3 && st.queue.length === 2; });

/* ============================ ③ l3 插队队首（验收路径#2） ============================ */
section("③ l3 插队队首（验收路径#2）");
T("l3 排在 l1/l2 之前", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l2", 2), mk("l3", 3)]); return st && st.queue.length === 3 && st.queue[0].level === "l3"; });
T("多个 l3 都在非 l3 之前，且同级按 at 升序", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l3", 9), mk("l3", 4)]); return st && st.queue.map((x) => x.level).join(",") === "l3,l3,l1" && st.queue[0].at === 4 && st.queue[1].at === 9; });
T("evtPump：先播 l3（插队生效）", () => { let st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l3", 5)]); st = V.evtPump(st); return st && st.cur && st.cur.level === "l3"; });

/* ============================ ④ 队列上限 + 溢出合并（验收路径#3） ============================ */
section("④ 队列上限 3 + 溢出并入汇总卡（⛔ 事件不丢）");
T("跨批次累计超上限 ⇒ 截到 3，溢出并入汇总卡，且总量守恒", () => {
  let st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l1", 2)]);
  st = V.evtEnqueue(st, [mk("l1", 3), mk("l1", 4)]);
  if (!st) return false;
  const total = st.queue.reduce((n, x) => n + (x.sum ? x.count : 1), 0);
  return st.queue.length === 3 && total === 4 && st.queue[st.queue.length - 1].sum === true;
});
T("溢出合并后依然是 3 张（不无限堆）", () => { let st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l2", 1), mk("l2", 2), mk("l2", 3)]); st = V.evtEnqueue(st, [mk("l2", 4), mk("l2", 5)]); return st && st.queue.length === 3; });

/* ============================ ⑤ 播放中不打断 ============================ */
section("⑤ 播放中入队不打断当前那张");
T("已播（cur 非空）时再入队：cur 不变、新卡进队尾", () => {
  const a = mk("l1", 1), b = mk("l2", 2);
  let st = V.evtEnqueue({ cur: null, queue: [] }, [a]);
  st = V.evtPump(st);                        // 开始播第 1 张
  const curId = st.cur.id;
  st = V.evtEnqueue(st, [b]);                // 播放中来新卡
  return st.cur.id === curId && st.queue.length === 1 && st.queue[0].id === b.id;
});
T("evtPump 在 cur 非空时不推进（同一张不被打断）", () => { let st = V.evtPump(V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l1", 2)])); const c = st.cur; st = V.evtPump(st); return st.cur === c; });
T("evtAdvance：正在播 ⇒ card=null（⛔ 切页重复 flush 不会把当前卡重挂一遍）", () => { const A = mk("l1", 1), B = mk("l2", 2); const cur = { cur: A, queue: [B] }; const r = V.evtAdvance && V.evtAdvance(cur); return r && r.card === null && r.state.cur === A && r.state.queue.length === 1; });
T("evtAdvance：空档 ⇒ 返回下一张卡", () => { const A = mk("l1", 1); const r = V.evtAdvance && V.evtAdvance({ cur: null, queue: [A] }); return r && r.card && r.card.at === 1 && r.state.cur.at === 1 && r.state.queue.length === 0; });
T("evtAdvance：空队列 ⇒ card=null、不出现", () => { const r = V.evtAdvance && V.evtAdvance({ cur: null, queue: [] }); return r && r.card === null && r.state.cur === null; });

/* ============================ ⑥ 同级 at 升序 ============================ */
section("⑥ 同级按 at 升序（先发生的先播）");
T("两条 l1：at 小的在前、不合并", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 5), mk("l1", 2)]); return st && st.queue.length === 2 && st.queue.map((x) => x.at).join(",") === "2,5"; });
T("乱序入队后仍按 at 升序（跨批次亦然）", () => { let st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 5)]); st = V.evtEnqueue(st, [mk("l1", 1)]); return st && st.queue.map((x) => x.at).join(",") === "1,5"; });

/* ============================ ⑦ 脏数据静默丢弃 ============================ */
section("⑦ 脏数据静默丢弃、⛔ 不抛错");
T("缺 title / null / {} 被丢，合法的保留", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [null, {}, { level: "l1", at: 1 }, mk("l1", 2)]); return st && st.queue.length === 1 && st.queue[0].at === 2; });
T("title 为空串也丢", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [{ level: "l2", at: 1, title: "" }]); return st && st.queue.length === 0; });
T("入参为 null/undefined 不抛错", () => { const st = V.evtEnqueue(null, null); return st && st.queue.length === 0 && st.cur === null; });

/* ============================ ⑧ 空队列什么都不出现 ============================ */
section("⑧ 队列空 ⇒ 什么都不出现（⛔ 无「暂无事件」卡）");
T("evtPump(空) ⇒ cur 仍 null、queue 空", () => { const st = V.evtPump({ cur: null, queue: [] }); return st && st.cur === null && st.queue.length === 0; });
T("evtPump(null) 不抛错", () => { const st = V.evtPump(null); return st && st.cur === null; });

/* ============================ ⑨ HTML 结构 + 标签平衡 + 无 emoji ============================ */
section("⑨ 事件卡 / 纪事页 HTML 结构 + 标签平衡 + ⛔ 无 emoji");
// ⚠️ 固定到当天 12:00：原写法用 Date.now()，一旦跑在零点后一小时内，
//    NOW-3600000 会跨到前一天 ⇒「同日进同一 .evt-day」误判为两天（跨零点 flaky）。
const _nowD = new Date(); _nowD.setHours(12, 0, 0, 0);
const NOW = _nowD.getTime();
T("事件卡 HTML 标签平衡（l1/l2/l3）", () => ["l1", "l2", "l3"].every((lv) => { const h = V.evtCardHtml && V.evtCardHtml(mk(lv, NOW)); return h && balanced(h); }));
T("l3 卡带 is-l3 类 + 「记下了」按钮", () => { const h = V.evtCardHtml(mk("l3", NOW)); return h && /evt-card is-l3/.test(h) && /记下了/.test(h); });
T("l1 卡 ⛔ 无按钮", () => { const h = V.evtCardHtml(mk("l1", NOW)); return h && !/evt-go/.test(h); });
T("l2 卡有「去看看 ›」按钮", () => { const h = V.evtCardHtml(mk("l2", NOW)); return h && /evt-go/.test(h) && /去看看/.test(h); });
T("纪事页头部+筛选+列表+翻页 标签平衡", () => { const rows = [mk("l1", NOW), mk("l2", NOW - 3600000)]; const h = V.evtHeadHtml(2, "") + V.evtTabsHtml("all") + V.evtDaysHtml(rows, 0) + V.evtMoreHtml(2, 2); return h && balanced(h); });
T("五类 chip 全渲染（全部/主线/亲缘/年节/夜话）", () => { const h = V.evtTabsHtml("all"); return h && ["全部", "主线", "亲缘", "年节", "夜话"].every((x) => h.indexOf(x) >= 0); });
T("按日分组：同日进同一 .evt-day", () => { const h = V.evtDaysHtml([mk("l1", NOW), mk("l2", NOW - 3600000)], 0); return (h.match(/class="evt-day"/g) || []).length === 1; });
T("按日分组：跨日分成两个 .evt-day", () => { const h = V.evtDaysHtml([mk("l1", NOW), mk("l1", NOW - 2 * 86400000)], 0); return (h.match(/class="evt-day"/g) || []).length === 2; });
T("事件卡 = 扁平六层直挂（⛔ 无 .evt-body / .evt-foot 包裹，CSS grid 定位）", () => { const h = V.evtCardHtml(mk("l2", NOW)); return h && /class="evt-ico"/.test(h) && /class="evt-title"/.test(h) && /class="evt-time"/.test(h) && /class="evt-go"/.test(h) && h.indexOf("evt-body") < 0 && h.indexOf("evt-foot") < 0; });
T("未读行带 is-new、已读行不带（「新」微标交给 CSS ::after，⛔ DOM 不重复）", () => { const now = Date.now(); const a = V.evtRowHtml(mk("l1", now), now - 1000); const b = V.evtRowHtml(mk("l1", now), now + 1000); return /evt-row is-new/.test(a) && !/evt-row is-new/.test(b) && a.indexOf("evt-new") < 0; });
T("分页：还有数据 ⇒ 「再往上翻」；到底 ⇒ 「到这儿就是最早的一笔了。」", () => { const more = V.evtMoreHtml(60, 30), end = V.evtMoreHtml(30, 30); return more && /再往上翻/.test(more) && end && /到这儿就是最早的一笔了。/.test(end) && !/evt-more/.test(end); });
T("未知 type ⇒ 占位字形 span（⛔ 非 emoji）", () => { const h = V.evtIconInner && V.evtIconInner({ type: "xyz", iconKey: "" }); return h && /evt-ph/.test(h); });
T("iconKey 命中 ⇒ 内联 SVG（stroke=currentColor / width 1.7）", () => { const h = V.evtIconInner({ type: "chapter", iconKey: "night" }); return h && /<svg/.test(h) && /currentColor/.test(h) && /stroke-width="1\.7"/.test(h); });
T("⛔ 新写 UI 无 emoji（事件卡 / 纪事页 / 汇总卡）", () => { const st = V.evtEnqueue({ cur: null, queue: [] }, [mk("l1", 1), mk("l1", 2), mk("l1", 3)]); const all = V.evtCardHtml(mk("l1", NOW)) + V.evtCardHtml(mk("l3", NOW)) + V.evtCardHtml(st.queue[0]) + V.evtRowHtml(mk("l2", NOW), 0) + V.evtTabsHtml("all") + V.evtHeadHtml(3, ""); return all && !EMOJI_RE.test(all); });

/* ============================ ⑩ 源码级纪律 ============================ */
section("⑩ 源码级：单一真源 + 直挂 body + ⛔ 无叠卡");
T("app.js 消费 Spirits.EVENT_CHIP_ORDER（⛔ 不硬编码分组）", () => src.indexOf("Spirits.EVENT_CHIP_ORDER") >= 0);
T("HTML 构建区无 type===\"fest\" 式硬编码判定（级别只读 p.level）", () => VIEW.length > 0 && !/===\s*["'](fest|chapter|night|milestone)["']/.test(VIEW));
T("事件卡弹层直挂 <body>（document.body.appendChild）", () => /document\.body\.appendChild/.test(src));
T("flushEventPops 不再一次性 append 全部（无 pops.forEach 叠卡）", () => { const a = "function flushEventPops", i = SRC_LF.indexOf(a), j = SRC_LF.indexOf("\n  }\n", i); const f = (i >= 0 && j > i) ? SRC_LF.slice(i + a.length, j) : ""; return f.length > 0 && f.indexOf("forEach") < 0; });
T("单一真源：app.js 不自己按 type 查级别表（无 EVENT_LEVEL 映射表副本）", () => src.indexOf("const EVENT_LEVEL = {") < 0);

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
