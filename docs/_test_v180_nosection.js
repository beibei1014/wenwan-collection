/* ============================================================
 * _test_v180_nosection.js · V180 · 三处下线 / 改名覆盖
 * ------------------------------------------------------------
 * ① 回响信里的旧名字没跟着改（bug）
 *    现象：详情页「✦ 回响」落款「—— 你的茶茶」，而这尊正式名是「江冽茗」。
 *    根因：回响信是**生成那一刻定稿的死文本**（spirits.js ensureEcho 把 fmt(模板) 写进 rec.echoes），
 *         那批信生成于 v180-K 回响改写 / v180-K1 名字修复之前 ⇒ 存的是旧模板 + 旧 AI 名。
 *    修法：**显示期替换**（legacyNameMapOf / fixLegacyNames / echoLetterView），
 *         ⛔ 不做数据迁移、⛔ 不改存档、⛔ 不碰 ww_spirits / spirit_store / hashStr。
 * ② 首页「🎴 今日心选」抽卡栏目下线
 * ③ 沁灵详情页「今日一签」（cp-sign 块）下线（signOf / ensureSign / SIGN 签库保留）
 *
 * 覆盖：
 *   A · 真跑：回响旧名替换（你的茶茶 → 你的江冽茗；多处全替换）
 *   B · 真跑：不误伤（别尊 alias 不动 / 手串名 bead 不动 / 无身份表不换 / 玩家改名尊重）
 *   C · 真跑：⛔ 不改存档（渲染后 rec.echoes 原文逐字不动）
 *   D · 静态：回响渲染位已改走 echoLetterView，不再直吐 e.text
 *   E · 静态：首页无今日心选（挂载点 / 函数 / 存储 / 绑定全清；game.js 算法保留）
 *   F · 静态：详情页无 cp-sign，陪伴卡其余块（问候/羁绊/回响倒计时）仍在；spirits.js 签库保留
 *   G · index.html 缓存戳已 bump
 *   H · 负向对照：铆定 413ef2a（⛔ 绝不写 HEAD）⇒ 必须红
 *
 * 用法： node docs/_test_v180_nosection.js
 * 负向： APP_SRC_FILE=docs/_tmp/_pre_v180nosec_app.js INDEX_SRC_FILE=docs/_tmp/_pre_v180nosec_index.html \
 *        node docs/_test_v180_nosection.js   ⇒ 必须 FAIL
 * 快照怎么来的（任何人可重建，⛔ 不依赖本地 HEAD）：
 *        git show 413ef2a:js/app.js  > docs/_tmp/_pre_v180nosec_app.js
 *        git show 413ef2a:index.html > docs/_tmp/_pre_v180nosec_index.html
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const INDEX_FILE = process.env.INDEX_SRC_FILE ? path.resolve(process.env.INDEX_SRC_FILE) : path.join(ROOT, "index.html");
const SPIRITS_FILE = process.env.SPIRITS_SRC_FILE ? path.resolve(process.env.SPIRITS_SRC_FILE) : path.join(ROOT, "js/spirits.js");
const appSrc = fs.readFileSync(APP_FILE, "utf8");
const indexSrc = fs.readFileSync(INDEX_FILE, "utf8");
const spiritsSrc = fs.readFileSync(SPIRITS_FILE, "utf8");
console.log("app 源码    ：" + APP_FILE);
console.log("index 源码  ：" + INDEX_FILE);
console.log("spirits 源码：" + SPIRITS_FILE);

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function done() {
  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}

/* ---------- 源码抽函数（大括号配对，跳过字符串 / 注释 / 正则字面量） ---------- */
const REGEX_PREV = "(,=:[!&|?{};+-*%~^<>";   // 这些字符后的 / 一定是正则起点，不是除号
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(appSrc);
  if (!m) return null;
  const start = /async\s+$/.test(appSrc.slice(Math.max(0, m.index - 6), m.index)) ? m.index - 6 : m.index;
  let i = appSrc.indexOf("(", m.index), pd = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === "(") pd++;
    else if (appSrc[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < appSrc.length && appSrc[i] !== "{") i++;
  let depth = 0, last = "";
  for (; i < appSrc.length; i++) {
    const ch = appSrc[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < appSrc.length) { if (appSrc[i] === "\\") { i += 2; continue; } if (appSrc[i] === q) break; i++; }
      last = "x"; continue;
    }
    if (ch === "/") {
      if (appSrc[i + 1] === "/") { while (i < appSrc.length && appSrc[i] !== "\n") i++; continue; }
      if (appSrc[i + 1] === "*") { const e = appSrc.indexOf("*/", i); i = e < 0 ? appSrc.length : e + 1; continue; }
      // ⚠️ 正则里可能带引号（/[\\/:*?"<>|]/g），不整段跳过就会把后面代码当字符串吞掉
      if (last === "" || REGEX_PREV.indexOf(last) >= 0) {
        i++;
        let inCls = false;
        while (i < appSrc.length) {
          const c = appSrc[i];
          if (c === "\\") { i += 2; continue; }
          if (c === "[") { inCls = true; i++; continue; }
          if (c === "]") { inCls = false; i++; continue; }
          if (c === "/" && !inCls) break;
          i++;
        }
        last = "x"; continue;
      }
      last = ch; continue;
    }
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") last = ch;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return appSrc.slice(start, i);
}
/* 抽 var NAME = [ ... ]; 数组字面量 */
function sliceArrayVar(name) {
  const i = appSrc.indexOf("var " + name + " = [");
  if (i < 0) return null;
  const j = appSrc.indexOf("\n  ];", i);
  return j < 0 ? null : appSrc.slice(i, j + 5);
}
/* 剥注释：⛔「某段代码必须消失」这类断言要判的是**代码**，不是批注里提没提这个词。
   否则后来人加一句解释性注释就会把测试打成红的（假阴性反向：注释掩护了残留代码）。
   `https://` 这类串里的 // 用「前一个字符不是冒号」挡掉。 */
function stripComments(s) {
  return String(s || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n\r]*/g, "$1");
}
const appCode = stripComments(appSrc);

/* ============================================================
 * A~C · 真跑：回响旧名替换
 * ============================================================ */
const NEED = ["identityKeysOf", "spiritIdentityOf", "nameOf", "legacyNameMapOf", "fixLegacyNames", "echoLetterView"];
const MISSING = NEED.filter((n) => !extractFn(n));
section("A · 回响旧名替换（显示期，⛔ 不改存档）");
if (MISSING.length || !sliceArrayVar("SPIRIT_IDENTITIES")) {
  console.log("  ✗ 显示期改名三件套缺失：" + (MISSING.join(",") || "SPIRIT_IDENTITIES") +
    "（若当前指向改前源码 = 负向对照，此为预期红）");
  FAIL++;
} else {
  /* ---- 假 store：两只有身份表的沁灵 + 一只纯路人 ---- */
  const store = {
    s1: { id: "s1", persona: { name: "茶茶" }, nameEdited: false },                 // 江冽茗（冰红茶）
    s2: { id: "s2", persona: { name: "柿宝" }, nameEdited: false },                 // 楚柿遥（柿柿如意）
    s3: { id: "s3", persona: { name: "小红" }, nameEdited: false },                 // 无身份表
    s4: { id: "s4", persona: { name: "茶茶" }, name: "小明", nameEdited: true },     // 玩家自己改过名
  };
  const items = {
    s1: { id: "s1", name: "冰红茶" }, s2: { id: "s2", name: "柿柿如意" },
    s3: { id: "s3", name: "小红串" }, s4: { id: "s4", name: "冰红茶" },
  };
  const sandboxSrc = [
    sliceArrayVar("SPIRIT_IDENTITIES"),
    extractFn("identityKeysOf"), extractFn("spiritIdentityOf"), extractFn("nameOf"),
    extractFn("legacyNameMapOf"), extractFn("fixLegacyNames"), extractFn("echoLetterView"),
  ].join("\n");
  const ctx = vm.createContext({
    console: console, Math: Math, String: String, Number: Number, Array: Array, Object: Object,
    Spirits: { load: () => store },
  });
  vm.runInContext(sandboxSrc + "\nthis.__mapOf = legacyNameMapOf; this.__fix = fixLegacyNames;" +
    "\nthis.__view = echoLetterView; this.__nameOf = nameOf;", ctx);
  const mapOf = ctx.__mapOf, fix = ctx.__fix, view = ctx.__view, nameOfF = ctx.__nameOf;

  ok(nameOfF(items.s1, store) === "江冽茗", "nameOf 基准：冰红茶/茶茶 → 江冽茗（实测 " + nameOfF(items.s1, store) + "）");
  const m1 = mapOf(items.s1, store.s1);
  ok(m1.cur === "江冽茗", "替换目标 = 当前显示名「江冽茗」（实测 " + m1.cur + "）");
  ok(m1.keys.indexOf("茶茶") >= 0 && m1.keys.indexOf("红茶") >= 0, "替换表含身份表 alias：茶茶 / 红茶");
  ok(m1.keys.indexOf("冰红茶") >= 0, "替换表含手串原名 bead：冰红茶（与 identityKeysOf 同口径：它是本尊的可命中键）");
  ok(m1.keys.indexOf(m1.cur) < 0, "⛔ 当前显示名本身不入表（否则把「江冽茗」再替一遍，白绕）");
  {
    let desc = true;
    for (let i = 1; i < m1.keys.length; i++) if (m1.keys[i].length > m1.keys[i - 1].length) desc = false;
    ok(desc, "键按长度倒序（长键先替：冰红茶 先让位，短键 红茶 才不会咬出残字）");
    ok(m1.keys[0] === "冰红茶", "最长键排在最前（实测 " + m1.keys[0] + "）");
  }

  const raw1 = "今天也在。\n陪你走过的路我都记着。\n—— 你的茶茶";
  ok(fix(raw1, m1) === "今天也在。\n陪你走过的路我都记着。\n—— 你的江冽茗",
    "落款「—— 你的茶茶」⇒「—— 你的江冽茗」（实测：" + JSON.stringify(fix(raw1, m1).split("\n").pop()) + "）");
  const raw2 = "茶茶在这儿，你的茶茶一直都在，也是茶茶先动的心。";
  ok(fix(raw2, m1) === "江冽茗在这儿，你的江冽茗一直都在，也是江冽茗先动的心。",
    "同一段里多处旧名**全替换**（不是只换第一处）：" + fix(raw2, m1));
  ok(fix("", m1) === "", "空串不炸");
  ok(fix(null, m1) === "", "null 不炸");
  ok(fix("今天没啥", m1) === "今天没啥", "无旧名 ⇒ 原串逐字返回");

  section("B · 不误伤：只替换本尊自己的旧名");
  const m2 = mapOf(items.s2, store.s2);
  ok(m2.cur === "楚柿遥", "另一只：柿宝/柿柿如意 → 楚柿遥");
  ok(m2.keys.join("|") === "柿柿如意|柿宝", "楚柿遥的替换表只有它自己的键（bead+alias：" + m2.keys.join("|") + "）");
  ok(m2.keys.indexOf("茶茶") < 0 && m2.keys.indexOf("冰川茶") < 0, "替换表里不含别尊的任何一个键");
  ok(fix("你的茶茶", m2) === "你的茶茶", "⛔ 楚柿遥的信里出现「茶茶」⇒ 原样保留（不套别尊的替代表）");
  ok(fix("你的柿宝", m1) === "你的柿宝", "⛔ 江冽茗的信里出现「柿宝」⇒ 原样保留（反向同样成立）");
  ok(fix("冰红茶很好喝", m1) === "江冽茗很好喝",
    "手串原名**整体**让位（冰红茶 → 江冽茗），不是残字「冰江冽茗」：" + fix("冰红茶很好喝", m1));
  const m3 = mapOf(items.s3, store.s3);
  ok(m3.cur === "小红" && m3.keys.length === 0, "身份表里没有的 ⇒ 替换表为空 ⇒ 一字不动");
  ok(fix("你的茶茶", m3) === "你的茶茶", "无身份表的沁灵不参与改名");
  const m4 = mapOf(items.s4, store.s4);
  ok(m4.cur === "小明", "玩家改过名 ⇒ 尊重其改名（cur = 小明）");
  ok(fix("你的小明今天也在", m4) === "你的小明今天也在", "已改名的沁灵其信文本部不做身份名回填");
  ok(fix("闲话一句：红茶不错", m1) === "闲话一句：江冽茗不错",
    "alias 第二项「红茶」同样命中（说明整条 alias 都在生效，不是写死单值）");

  section("C · ⛔ 不改存档：渲染视图不得回写原始信件");
  const letter = { title: "✦ 回响 · 1 周年", at: 1760000000000, from: "茶茶", text: raw1 };
  const v1 = view(letter, m1);
  ok(v1.text === "今天也在。\n陪你走过的路我都记着。\n—— 你的江冽茗", "视图 text 已改名");
  ok(v1.from === "江冽茗", "视图 from 也跟着改名（" + v1.from + "）");
  ok(letter.text === raw1 && letter.from === "茶茶", "⛔ 原始 letter 对象逐字未变（显示期替换，不落盘）");
  ok(v1.title === "✦ 回响 · 1 周年" && v1.at === 1760000000000, "标题 / 时间戳原样透传（⛔ 数值位不动）");
  ok(view({}, m1).text === "", "空信不炸");
}

/* ============================================================
 * D · 静态：回响渲染位接线
 * ============================================================ */
section("D · 回响渲染位已改走 echoLetterView");
const detailFn = extractFn("renderSpiritDetailPage") || "";
const detailFnC = stripComments(detailFn);   // 剥注释版：用于「某段必须消失」的判断
ok(detailFn.length > 1000, "抽到 renderSpiritDetailPage（" + detailFn.length + " 字符）");
  const detailedFnC = stripComments(detailFn);
  ok(/legacyNameMapOf\(it,\s*rec\)/.test(detailedFnC), "详情页先算出本尊替换表 echoNm（每只算一次，非逐封信算）");
ok(detailFn.indexOf("echoLetterView(e, echoNm)") >= 0, "逐封信走 echoLetterView");
ok(detailFnC.indexOf("esc(e.text") < 0, "⛔ 不再直吐 e.text（旧的直显通路已断）");
ok(detailFn.indexOf("e.from") < 0, "⛔ 不再直吐 e.from");
ok(detailFn.indexOf("esc(v.text") >= 0, "正文渲染位改成 v.text");
ok(detailFn.indexOf("fmtDay(v.at)") >= 0, "时间仍取原始 at（⛔ 不顺着改错字段）");
// fixt 只覆盖显示位，不碰数值位
ok(detailFn.indexOf("mailSeenAt") >= 0, "未读判定仍用原始 e.at / mailSeenAt（⛔ 不误改红点逻辑）");

/* ============================================================
 * E · 静态：首页无今日心选
 * ============================================================ */
section("E · 首页「🎴 今日心选」已下线");
const homeFn = extractFn("renderHome") || "";
ok(homeFn.length > 1000, "抽到 renderHome（" + homeFn.length + " 字符）");
const homeFnC = stripComments(homeFn);
ok(appCode.indexOf("function renderDrawSection") < 0, "⛔ 面板渲染函数本体已删");
ok(appCode.indexOf("renderDrawSection(") < 0, "⛔ 无任何调用点");
ok(appCode.indexOf("drawHtml") < 0, "⛔ 挂载变量已删");
ok(appCode.indexOf("function drawStorageKey") < 0 && appCode.indexOf("function getDrawResult") < 0 &&
   appCode.indexOf("function setDrawResult") < 0, "⛔ 三个 localStorage 读写函数已删（不再写按日存档键）");
ok(appSrc.indexOf('id="btnDraw"') < 0 && appSrc.indexOf('id="btnRedraw"') < 0, "⛔ 抽取 / 重抽按钮 HTML 字面量已删");
ok(appCode.indexOf("drawRecommendation") < 0, "⛔ 首页不再调 Game 的推荐抽卡算法（断干净）");
ok(homeFnC.indexOf("今日心选") < 0 && homeFnC.indexOf("🎴") < 0, "renderHome 代码里不再出现该栏目");
ok(appCode.indexOf("今日心选") < 0, "全 app.js 代码里不再出现该栏目标题（UI 串 / 提示文案也一并收干净）");
// ⛔ 不该删的不能删
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
ok(gameSrc.indexOf("function drawRecommendation") >= 0, "js/game.js 的 drawRecommendation 算法**保留**（纯函数，别处可复用）");
ok(appSrc.indexOf("renderPlayPlanSection") >= 0, "⛔ 盘玩计划栏目保留（别误删相邻栏目）");

/* ============================================================
 * F · 静态：详情页无今日一签，陪伴卡其余块仍在
 * ============================================================ */
section("F · 详情页「今日一签」下线，陪伴卡其余块保留");
ok(detailFnC.indexOf("cp-sign") < 0, "⛔ 详情页不再有签文卡那个 class 块");
ok(detailFnC.indexOf("rec.sign") < 0, "⛔ 详情页不再读当日签的数据字段");
ok(detailFn.indexOf("🌱") >= 0 || detailFn.indexOf("成长") >= 0, "⛔ 「🌱 成长卡」保留未动");
// 陪伴卡（🎐 今天）三块必须还在
ok(detailFn.indexOf("cp-card") >= 0, "陪伴卡 cp-card 本体保留");
ok(detailFn.indexOf("cp-greet") >= 0 && detailFn.indexOf("rec.greet.text") >= 0, "今日问候（cp-greet + greet.text）保留");
ok(detailFn.indexOf("cp-bond") >= 0 && detailFn.indexOf("bond.pct") >= 0, "羁绊条（cp-bond + 进度）保留");
ok(detailFn.indexOf("cp-echo") >= 0 && detailFn.indexOf("nxEcho.label") >= 0, "回响倒计时（cp-echo）保留");
ok(detailFn.indexOf("sdCallYes") >= 0, "「改口叫名字」交互（sdCallYes/No）保留");
ok(detailFn.indexOf("sd-echo") >= 0, "✦ 回响信件列表保留");
// ⛔ 签库本体必须还在（「今日宜赠」那条线还要用）
ok(spiritsSrc.indexOf("function ensureSign") >= 0, "⛔ spirits.js ensureSign 保留未删");
ok(spiritsSrc.indexOf("function signOf") >= 0, "⛔ spirits.js signOf 保留未删");
ok(spiritsSrc.indexOf("SIGN_GIFT") >= 0, "⛔ 今日宜赠 SIGN_GIFT 保留未删");

/* ============================================================
 * G · 缓存戳
 * ============================================================ */
section("G · index.html 缓存戳");
const stamp = /js\/app\.js\?v=([0-9]+)/.exec(indexSrc);
const prePath = path.join(ROOT, "docs/_tmp/_pre_v180nosec_index.html");
const preStamp = fs.existsSync(prePath) ? /js\/app\.js\?v=([0-9]+)/.exec(fs.readFileSync(prePath, "utf8")) : null;
ok(!!stamp, "index.html 里找得到 js/app.js?v=");
ok(!!preStamp, "铆定快照存在：docs/_tmp/_pre_v180nosec_index.html（改前 = 413ef2a）");
ok(stamp && preStamp && stamp[1] !== preStamp[1],
  "缓存戳已 bump：" + (preStamp ? preStamp[1] : "?") + " → " + (stamp ? stamp[1] : "?"));
// 本轮没动 spirits.js ⇒ 它的戳不该被顺手改
const spStamp = /js\/spirits\.js\?v=([0-9]+)/.exec(indexSrc);
const spPre = fs.existsSync(prePath) ? /js\/spirits\.js\?v=([0-9]+)/.exec(fs.readFileSync(prePath, "utf8")) : null;
ok(spStamp && spPre && spStamp[1] === spPre[1],
  "⛔ 未动 spirits.js ⇒ 其缓存戳不动（" + (spPre ? spPre[1] : "?") + "）");

/* ---------- 负向对照闸门 ---------- */
if (MISSING.length) {
  section("H · 负向对照");
  console.log("  ⓘ 当前源码缺少显示期改名三件套 ⇒ 以上静态断言已足以判定「改前 = 红」。");
}

done();
