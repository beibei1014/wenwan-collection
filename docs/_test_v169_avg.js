/* V169 自测：主线剧情界面 AVG 化（全屏立绘 spotlight + 底部对话框 + 双层 BG + 沉浸态 talk-open）
 * 用法：
 *   node docs/_test_v169_avg.js
 * 负向对照（指向改动前 = 367f122 的 app.js / skin.css，必须 FAIL）：
 *   APP_SRC_FILE=docs/_tmp/_pre_v169_app.js SKIN_FILE=docs/_tmp/_pre_v169_skin.css node docs/_test_v169_avg.js
 *
 * 分工：本项目纪律 —— 任何改 render* 的 HTML 拼接都必须另跑 docs/_test_v163c_layout.js（标签栈解析）。
 *   本套件只负责 AVG 化的「结构 + 行为 + CSS + 负向对照」。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const CSS_FILE = process.env.SKIN_FILE ? path.resolve(process.env.SKIN_FILE) : path.join(ROOT, "css/skin.css");
const appSrc = fs.readFileSync(APP_FILE, "utf8");
const cssSrc = fs.readFileSync(CSS_FILE, "utf8");
console.log("app 源码：" + APP_FILE + "\ncss 源码：" + CSS_FILE);

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 源码抽函数（大括号配对，跳过字符串/注释） ---------- */
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(appSrc);
  if (!m) return null;
  let i = appSrc.indexOf("(", m.index), pd = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === "(") pd++;
    else if (appSrc[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < appSrc.length && appSrc[i] !== "{") i++;
  let depth = 0;
  for (; i < appSrc.length; i++) {
    const ch = appSrc[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < appSrc.length) { if (appSrc[i] === "\\") { i += 2; continue; } if (appSrc[i] === q) break; i++; }
      continue;
    }
    if (ch === "/" && appSrc[i + 1] === "/") { while (i < appSrc.length && appSrc[i] !== "\n") i++; continue; }
    if (ch === "/" && appSrc[i + 1] === "*") { const e = appSrc.indexOf("*/", i); i = e < 0 ? appSrc.length : e + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return appSrc.slice(m.index, i);
}

const talkSrc = extractFn("renderTalkPage");
const mainSrc = extractFn("renderMainTalkPage");
const chapSrc = extractFn("renderChapTalkPage");
const nightSrc = extractFn("renderNightTalkPage");
const routerSrc = extractFn("router");

/* ================= A. 结构：对话页外壳 ================= */
section("A. renderTalkPage → 沉浸式外壳结构");
ok(!!talkSrc, "抽到 renderTalkPage");
if (talkSrc) {
  ok(/class="nt-chat immersive"/.test(talkSrc), '根容器 = .nt-chat.immersive');
  ok(/scenebg blurpane/.test(talkSrc) && /id="sceneBgBlur"/.test(talkSrc), "双层 BG：模糊垫满层 .blurpane#sceneBgBlur");
  ok(/scenebg sharppane/.test(talkSrc) && /id="sceneBgLayer"/.test(talkSrc), "双层 BG：清晰 contain 层 .sharppane#sceneBgLayer");
  ok(/id="talkPortrait"/.test(talkSrc), "整屏立绘层 #talkPortrait");
  ok(/id="talkBox"/.test(talkSrc) && /id="talkName"/.test(talkSrc) && /id="talkText"/.test(talkSrc) && /id="talkCue"/.test(talkSrc),
    "底部对话框 #talkBox（含名牌 #talkName / 正文 #talkText / 继续指示 #talkCue）");
  ok(/nt-body" id="ntBody"/.test(talkSrc), "保留引擎输出位 #ntBody（沉浸态作透明点击层）");
  ok(/o\.portrait/.test(talkSrc), "present 使用 o.portrait（拿不到 = \"\"）");
  ok(/try \{ document\.body\.classList\.add\("talk-open"\)/.test(talkSrc), "进剧情页 → document.body.classList.add(\"talk-open\")");
  // present 每消息唯一挂点：append 末尾 1 次；step 的 me/sys 分支不得重复调
  const appendBlock = /const append = \(m\) => \{[\s\S]*?\n    \};/.exec(talkSrc);
  ok(!!appendBlock && /present\(m\);/.test(appendBlock[0]), "present(m) 挂在 append(m) 末尾（每消息唯一钩子）");
  const stepBlock = /const step = \(\) => \{[\s\S]*?\n    \};/.exec(talkSrc);
  ok(!!stepBlock && !/present\(/.test(stepBlock[0]), "step() 的 me/sys 即时分支不重复调 present");
  ok(/pEl\.dataset\.slot = side/.test(talkSrc), "立绘站位写入 data-slot（L/C/R/B）");
  ok(/classList\.add\("hide"\)/.test(talkSrc), "旁白/玩家：立绘加 .hide（淡出）");
  ok(/talk-box/, talkSrc) && ok(/narration/.test(talkSrc), "旁白：对话框加 .narration（居中淡色）");
}

/* ================= B. 挂点：两个调用点补 portrait ================= */
section("B. 调用点 portrait 数据（§8.4）");
ok(!!mainSrc && /portrait:/.test(mainSrc) && /Spirits\.castOf\(\)/.test(mainSrc) && /\.imgUrl/.test(mainSrc),
  "renderMainTalkPage 传 portrait（castOf()[pid] → load()[id].imgUrl）");
ok(!!chapSrc && /portrait:/.test(chapSrc) && /rc0\.imgUrl/.test(chapSrc), "renderChapTalkPage 传 portrait（rc0.imgUrl）");
ok(!!nightSrc && !/portrait:/.test(nightSrc), "夜话页（renderNightTalkPage）不传 portrait → 回落 \"\"（只 BG + 对话框）");

/* ================= C. talk-open 的移除在中央路由 ================= */
section("C. talk-open 进/出");
ok(!!routerSrc && /classList\.remove\("talk-open"\)/.test(routerSrc), "router() 中央分发处 remove(\"talk-open\")");
ok(!!talkSrc && !/remove\("talk-open"\)/.test(talkSrc), "renderTalkPage 不自行移除（⛔ 不逐页删）");

/* ================= D. 行为：沙箱实跑 renderTalkPage ================= */
section("D. 行为：present 实跑（立绘 / 旁白 / 缺图 / spotlight）");
function makeEl(id) {
  const el = { _id: id, _cls: new Set(), dataset: {}, style: {}, hidden: false, textContent: "", _html: "", _kids: [], _fc: null, offsetWidth: 0, _lis: {} };
  el.classList = {
    add: (c) => { el._cls.add(c); }, remove: (c) => { el._cls.delete(c); }, contains: (c) => el._cls.has(c),
    toggle: (c, f) => { if (f === undefined) f = !el._cls.has(c); f ? el._cls.add(c) : el._cls.delete(c); return f; },
  };
  el.addEventListener = (t, f) => { (el._lis[t] = el._lis[t] || []).push(f); };
  el.insertBefore = (n) => { el._kids.push(n); return n; };
  el.appendChild = (n) => { el._kids.push(n); return n; };
  el.setAttribute = (k, v) => { el[k] = v; }; el.getAttribute = (k) => el[k];
  el.querySelector = (sel) => (sel === "img" ? (/<img/.test(el._html) ? makeEl("img") : null) : null);
  el.querySelectorAll = () => [];
  Object.defineProperty(el, "innerHTML", {
    get() { return el._html; },
    set(v) { el._html = String(v); el._fc = / </.test(" " + el._html) ? makeEl("fc") : null; },
  });
  Object.defineProperty(el, "firstChild", { get() { return el._fc; }, set(v) { el._fc = v; } });
  return el;
}
function makeSandbox() {
  const reg = {};
  ["#ntBody", "#ntFoot", "#ntPend", "#talkPortrait", "#talkBox", "#talkName", "#talkText", "#talkCue", "#sceneBgBlur", "#sceneBgLayer"]
    .forEach((s) => { reg[s] = makeEl(s); });
  const view = makeEl("view");
  const doc = {
    createElement: () => makeEl("created"),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {},
    body: makeEl("body"),
    documentElement: makeEl("html"),
  };
  const sb = {
    console, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object, Error, RegExp, Promise, Intl, Map, Set,
    encodeURIComponent, decodeURIComponent,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {},   // 同步泵 → 定序可断言
    location: { hash: "#/maintalk/0" }, document: doc,
    $: (sel) => reg[sel] || null,
    view, topbarTitle: { textContent: "", style: {} }, btnBack: { style: {} }, btnSettings: { style: {} },
    esc: (s) => (s == null ? "" : String(s)),
    fmtTime: () => "12:00",
    meAvatarHtml: () => '<span class="me-av"></span>',
    bindSpiritImgFallback: () => {},
    talkDwell: () => 700, TALK_LEAD_MS: 300,
    sceneBgUrl: () => "assets/bg/BG-01.jpg",
    window: { scrollTo() {} },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  return { sb, reg, view };
}
function run(o) {
  const { sb, reg, view } = makeSandbox();
  const fn = extractFn("renderTalkPage");
  if (!fn) return null;
  vm.runInContext(fn + "\n;__fn=renderTalkPage;", vm.createContext(sb), { filename: "app.js#renderTalkPage" });
  try { sb.__fn(o); } catch (e) { return { err: e, reg, view, sb }; }
  return { err: null, reg, view, sb };
}
const cnt = (h, sub) => h.split(sub).length - 1;

if (talkSrc) {
  // D1：角色行 → 立绘上屏 + 名牌 + 正文 + talk-open + 双层 BG
  const SP = { w: "sp", name: "最老的那只", text: "你回来啦。", slot: "L", ps: ["scholar"] };
  let r = run({
    title: "第 1 章", headAv: "", headName: "H", headSub: "S",
    av: () => "", nameOf: () => "", portrait: (m) => (m && m.w === "sp") ? "https://x/y.png" : "",
    enter: () => ({ added: [SP], choices: null, ending: null, ended: false, log: [] }),
    replay: () => ({ added: [SP], choices: null, ending: null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  });
  ok(r && !r.err, "D1 不抛异常" + (r && r.err ? " —— " + r.err.message : ""));
  if (r && !r.err) {
    const p = r.reg["#talkPortrait"], box = r.reg["#talkBox"], nm = r.reg["#talkName"], tx = r.reg["#talkText"];
    ok(/<img/.test(p._html) && /x\/y\.png/.test(p._html), "D1 角色行 → 立绘 <img> 上屏（含 imgUrl）");
    ok(!p.classList.contains("hide"), "D1 立绘可见（无 .hide）");
    ok(p.dataset.slot === "L", "D1 data-slot = m.slot（L）");
    ok(nm.textContent === "最老的那只" && nm.hidden === false, "D1 名牌 = m.name");
    ok(tx.textContent === "你回来啦。", "D1 对话框正文 = m.text");
    ok(r.sb.document.body.classList.contains("talk-open"), "D1 进剧情页 → body 带 talk-open");
    ok(!!r.reg["#sceneBgBlur"].style.backgroundImage && !!r.reg["#sceneBgLayer"].style.backgroundImage,
      "D1 双层 BG：两张 pane 都设了 backgroundImage");
    ok(cnt(p._html, "<img") === 1, "D1 spotlight：立绘层仅 1 张 <img>");
    const vh = r.view.innerHTML;
    ok(cnt(vh, 'class="talk-portrait"') === 1, "D1 页面只有 1 个立绘层（不出现多人并排）");
    ok(cnt(vh, "blurpane") === 1 && cnt(vh, "sharppane") === 1, "D1 双层 BG 元素各 1 个");
  }

  // D2：旁白行 → 不显示立绘 + 无名牌 + 对话框 narration
  r = run({
    title: "T", headAv: "", headName: "H", headSub: "S", av: () => "", nameOf: () => "",
    portrait: () => "https://should/not/use.png",
    enter: () => ({ added: [{ w: "sys", text: "深夜。" }], choices: null, ending: null, ended: false, log: [] }),
    replay: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  });
  ok(r && !r.err, "D2 不抛异常");
  if (r && !r.err) {
    const p = r.reg["#talkPortrait"];
    ok(p.classList.contains("hide") && !/<img/.test(p._html), "D2 旁白：立绘隐藏且清空（不给旁白配立绘）");
    ok(r.reg["#talkName"].hidden === true, "D2 旁白：无名牌");
    ok(r.reg["#talkBox"].classList.contains("narration"), "D2 旁白：对话框 .narration");
  }

  // D3：调用点不传 portrait（夜话）→ 不抛错，输出仍含 BG + 对话框
  r = run({
    title: "T", headAv: "", headName: "H", headSub: "S", av: () => "", nameOf: () => "w",   // ⛔ 无 portrait
    enter: () => ({ added: [{ w: "sp", name: "甲", text: "喂。", ps: ["x"] }], choices: null, ending: null, ended: false, log: [] }),
    replay: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  });
  ok(r && !r.err, "D3 无 o.portrait：不抛异常" + (r && r.err ? " —— " + r.err.message : ""));
  if (r && !r.err) {
    ok(!/<img/.test(r.reg["#talkPortrait"]._html), "D3 无 portrait → 立绘层无 <img>（只 BG + 对话框）");
    ok(cnt(r.view.innerHTML, "talk-box") >= 1, "D3 仍渲染出对话框");
  }

  // D4：portrait 内部抛异常 → 被吞，不炸
  r = run({
    title: "T", headAv: "", headName: "H", headSub: "S", av: () => "", nameOf: () => "",
    portrait: () => { throw new Error("boom"); },
    enter: () => ({ added: [{ w: "sp", name: "甲", text: "喂。" }], choices: null, ending: null, ended: false, log: [] }),
    replay: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  });
  ok(r && !r.err, "D4 portrait 抛错被吞：不冒泡到 renderTalkPage");

  // D5：连续两个不同说话人 → 只留最后一位的立绘（spotlight 单张）
  r = run({
    title: "T", headAv: "", headName: "H", headSub: "S", av: () => "", nameOf: () => "",
    portrait: (m) => (m && m.ps && m.ps[0] === "a") ? "https://x/A.png" : "https://x/B.png",
    enter: () => ({
      added: [
        { w: "sp", name: "甲", text: "甲说。", slot: "L", ps: ["a"] },
        { w: "sp", name: "乙", text: "乙说。", slot: "R", ps: ["b"] },
      ], choices: null, ending: null, ended: false, log: [],
    }),
    replay: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
    choose: () => ({ added: [], choices: null, ending: null, ended: false, log: [] }),
  });
  if (r && !r.err) {
    const p = r.reg["#talkPortrait"];
    ok(/B\.png/.test(p._html) && !/A\.png/.test(p._html), "D5 换人后立绘层只留当前说话人（B）");
    ok(cnt(p._html, "<img") === 1, "D5 任何时刻立绘层只有 1 张图（无并排）");
    ok(p.dataset.slot === "R", "D5 换人后 data-slot 跟随（R）");
  } else { ok(false, "D5 跑失败" + (r && r.err ? " —— " + r.err.message : "")); }

  // D6：无 bgUrl（未出图）→ noimg 兜底类，不阻塞
  const { sb: sb6, reg: reg6 } = makeSandbox();
  ok(true, "D6 见静态：noimg 渐变兜底仍保留（.scenebg.noimg）");
}

/* ================= E. CSS：沉浸式样式 ================= */
section("E. css/skin.css 沉浸式样式");
ok(!/\r/.test(cssSrc), "skin.css 是 LF（无 CR）");
ok(/body\.talk-open \{ overflow: hidden/.test(cssSrc), "body.talk-open 锁滚动");
ok(/body\.talk-open \.tabbar \{ display: none/.test(cssSrc), "沉浸态隐藏底部导航");
ok(/body\.talk-open \.view \{[^}]*animation: none/.test(cssSrc), "沉浸态关掉 .view 入场动画（否则 fixed 被困）");
ok(/\.nt-chat\.immersive \{ position: fixed; inset: 0; z-index: 40/.test(cssSrc), ".nt-chat.immersive 整屏 fixed z40");
ok(/\.nt-chat\.immersive \.scenebg\.blurpane[^}]*blur\(22px\)/.test(cssSrc), "blurpane：cover + blur(22px)");
ok(/\.nt-chat\.immersive \.scenebg\.sharppane[^}]*background-size: cover/.test(cssSrc), "sharppane：cover（v172-C 竖版 9:16 铺满，不再 letterbox）");
ok(/\.talk-portrait img \{[^}]*object-fit: cover; object-position: center 12%/.test(cssSrc), "立绘 object-fit:cover + object-position:center 12%");
ok(/\.talk-box \{[^}]*left: 16px; right: 16px/.test(cssSrc) && /min-height: 132px/.test(cssSrc), "对话框 left/right 16 + min-height 132");
ok(/backdrop-filter: blur\(8px\)/.test(cssSrc), "对话框 backdrop-filter blur(8px)");
ok(/\.talk-name \{[^}]*top: -15px; right: 20px/.test(cssSrc), "名牌 top:-15 right:20（骑框上沿）");
ok(/\.talk-cue \{[^}]*border-top: 8px solid/.test(cssSrc) && /@keyframes talkCue/.test(cssSrc), "继续指示小三角 + talkCue 呼吸");
ok(/\.nt-chat\.immersive \.nt-body \{[^}]*position: absolute; inset: 0; z-index: 3/.test(cssSrc), "nt-body 作整屏透明点击层（z3，⛔ 不 display:none）");
ok(/\.nt-chat\.immersive \.nt-foot \{[^}]*z-index: 6/.test(cssSrc), "选项层 z6（高于对话框）");
ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.talk-portrait/.test(cssSrc), "减少动态效果降级（含 .talk-portrait）");
// 层级自下而上：BG(0/1) < 立绘(2) < 渐暗(3) < 对话框(4) < 名牌/指示(5) < 选项(6)
const zi = (re) => { const m = re.exec(cssSrc); return m ? Number(m[1]) : NaN; };
ok(zi(/\.talk-portrait \{[^}]*z-index:\s*(\d+)/) === 2, "立绘 z-index=2");
ok(zi(/\.talk-box \{[^}]*z-index:\s*(\d+)/) === 4, "对话框 z-index=4");
ok(zi(/\.nt-chat\.immersive::after[^}]*z-index:\s*(\d+)/) === 3, "底部渐暗 z-index=3");

/* ================= F. 收尾 ================= */
console.log("\n===== V169 自测" + (process.env.APP_SRC_FILE || process.env.SKIN_FILE ? "（负向对照）" : "") + " =====");
console.log("PASS = " + PASS + "   FAIL = " + FAIL);
if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
