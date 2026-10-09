/* ============================================================
 * _test_v180l2_aifab.js · V180 批L-2 · AI 喵助手**只出现在首页**
 * ------------------------------------------------------------
 *   用户裁定：助手组件只留首页，其余页面（沁灵详情 / 沁灵巷 / 夜话 /
 *   主线 / 书 / 设置 …）全部移除，⛔ 别留隐藏占位。
 *
 *   旧实现是「沁灵 / 夜话沉浸区隐藏」（body.route-spirit / route-night），
 *   等于**其余所有页面都挂着浮窗**。现改为：
 *     · CSS：#aiFab / #aiPanel **默认 display:none**，只有 body.route-home 才放出来
 *     · JS ：只有真正 renderHome() 的路由才挂 route-home；离开首页顺手收起面板
 *
 *   A. CSS：默认隐藏 / 首页才显示 / 面板尊重 [hidden]
 *   B. JS ：route() 只认首页 / 离开即收面板 / ⛔ 旧的两个沉浸类已无残留（不留死代码）
 *   C. 挂载点唯一（全库只有 index.html 那一处 FAB + 面板）
 *   D. 负向对照（铆定 9dc42be 改前 · ⛔ 不用 HEAD）
 *
 * 用法： node docs/_test_v180l2_aifab.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const CUR_APP = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const CUR_CSS = fs.readFileSync(path.join(ROOT, "css", "skin.css"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }
function readBase(rel, tmp) {
  for (let i = 0; i < 3; i++) {
    try { return cp.execSync("git show 9dc42be:" + rel, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); }
    catch (e) { /* 沙箱偶发 spawnSync EBUSY，重试 */ }
  }
  try { return fs.readFileSync(path.join(__dirname, "_tmp", tmp), "utf8"); } catch (e) { return ""; }
}

const BASE_APP = readBase("js/app.js", "_pre_v180l2_app.js");
const BASE_CSS = readBase("css/skin.css", "_pre_v180l2_skin.css");

/* ============================================================
 * A. CSS
 * ============================================================ */
section("A · CSS：默认隐藏 / 仅首页显示 / 面板尊重 [hidden]");
{
  const block = (function (css) {
    const i = css.indexOf("#aiFab");
    if (i < 0) return "";
    return css.slice(Math.max(0, i - 400), i + 400);
  })(CUR_CSS);
  ok(block.length > 0, "skin.css 里找得到 #aiFab 规则块");
  ok(/#aiFab,\s*\r?\n\s*#aiPanel\s*\{\s*display:\s*none\s*!important;\s*\}/.test(CUR_CSS),
    "⛔ 默认：#aiFab 与 #aiPanel 一起 display:none !important（不再「其他页面都挂着」）");
  ok(/body\.route-home\s+#aiFab\s*\{\s*display:\s*flex\s*!important;\s*\}/.test(CUR_CSS),
    "✅ 只有 body.route-home 才把 #aiFab 放出来");
  ok(/body\.route-home\s+#aiPanel:not\(\[hidden\]\)\s*\{\s*display:\s*flex\s*!important;\s*\}/.test(CUR_CSS),
    "✅ 面板用 :not([hidden]) —— ⛔ 不让 !important 压掉 .ai-panel[hidden] 的隐藏态");
  ok(!/route-spirit/.test(CUR_CSS) && !/route-night/.test(CUR_CSS),
    "⛔ 旧的 route-spirit / route-night 隐藏规则已删除（不再有死选择器）");
  ok(/\.ai-panel\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/.test(fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8")),
    "✅ style.css 的 .ai-panel[hidden] 兜底仍在（与新规则对齐）");
}

/* ============================================================
 * B. JS
 * ============================================================ */
section("B · JS：route() 只认首页 / 离开即收面板 / ⛔ 旧沉浸类无残留");
{
  ok(/classList\.toggle\("route-home"/.test(CUR_APP), "route() 里 toggle(\"route-home\")");
  ok(/_homeRoute/.test(CUR_APP), "用 _homeRoute 标记「这一跳是否真渲染了首页」");
  ok(/else if \(h === "#\/" \|\| h === "#"\) \{ renderHome\(\); _homeRoute = true; \}/.test(CUR_APP),
    "✅ `#/` 与 `#` 算首页");
  ok(/else \{ renderHome\(\); _homeRoute = true; \}/.test(CUR_APP),
    "✅ 兜底分支（未匹配任何路由 → renderHome）也算首页");
  ok(!/route-spirit/.test(CUR_APP) && !/route-night/.test(CUR_APP),
    "⛔ app.js 里已无 route-spirit / route-night（旧沉浸类连 JS 带 CSS 一起清干净）");
  /* 离开首页要收起面板：不许留一个开着但看不见的面板 */
  const seg = (function (s) {
    const i = s.indexOf('classList.toggle("route-home"');
    return i < 0 ? "" : s.slice(i - 200, i + 400);
  })(CUR_APP);
  ok(/if \(!_homeRoute\)/.test(seg), "离开首页会走清空分支");
  ok(/getElementById\("aiPanel"\)/.test(seg) && /_ap\.hidden = true/.test(seg),
    "⛔ 离开首页把已打开的 #aiPanel 收起来（不留隐藏占位）");
}

/* ============================================================
 * C. 挂载点唯一
 * ============================================================ */
section("C · 挂载点唯一（全库只有 index.html 那一处）");
{
  const htmlFab = (HTML.match(/id="aiFab"/g) || []).length;
  const htmlPanel = (HTML.match(/id="aiPanel"/g) || []).length;
  ok(htmlFab === 1, "index.html 里 #aiFab 恰好 1 个（实得 " + htmlFab + "）");
  ok(htmlPanel === 1, "index.html 里 #aiPanel 恰好 1 个（实得 " + htmlPanel + "）");
  const jsFab = (CUR_APP.match(/id="aiFab"/g) || []).length;
  ok(jsFab === 0, "⛔ app.js 不再动态生成第二个 FAB（实得 " + jsFab + "）");
  const fabBind = (CUR_APP.match(/aiFab/g) || []).length;
  ok(fabBind <= 2, "app.js 里 aiFab 只出现在 bindAI 的绑定处（实得 " + fabBind + " 处）");
  /* 其余页面不许自己塞一个「问助手」入口 */
  ok(!/ai-fab/.test(CUR_APP), "⛔ app.js 里没有第二处 .ai-fab 浮窗模板");
}

/* ============================================================
 * D. 负向对照（铆定 9dc42be 改前 · ⛔ 不用 HEAD）
 * ============================================================ */
section("D · 负向对照（铆定 9dc42be 改前 · ⛔ 不用 HEAD）");
{
  /* ⚠️ 只放「批L-2 新增」的标记 —— 不变式（如「FAB 只有一个」）改前也成立，
     放进负向对照会把对照稀释成假绿。 */
  const markers = (app, css) => ([
    { n: "CSS：#aiFab/#aiPanel 默认隐藏", p: /#aiFab,\s*\r?\n\s*#aiPanel\s*\{\s*display:\s*none\s*!important;\s*\}/.test(css) },
    { n: "CSS：仅 route-home 显示 FAB", p: /body\.route-home\s+#aiFab\s*\{\s*display:\s*flex\s*!important;\s*\}/.test(css) },
    { n: "CSS：旧沉浸类已删", p: !/route-spirit/.test(css) && !/route-night/.test(css) },
    { n: "JS：toggle route-home", p: /classList\.toggle\("route-home"/.test(app) },
    { n: "JS：离开首页收面板", p: /if \(!_homeRoute\)/.test(app) && /_ap\.hidden = true/.test(app) },
    { n: "JS：旧沉浸类已删", p: !/route-spirit/.test(app) && !/route-night/.test(app) },
  ]);
  if (!BASE_APP || !BASE_CSS) ok(false, "取不到 9dc42be 基线（负向对照无法执行）");
  else {
    const old = markers(BASE_APP, BASE_CSS);
    const fails = old.filter((x) => !x.p).map((x) => x.n);
    ok(fails.length === old.length, "⛔ 铆定版**全部**标记不成立：失败 " + fails.length + "/" + old.length
      + (fails.length !== old.length ? " ｜ 竟然通过的：" + JSON.stringify(old.filter((x) => x.p).map((x) => x.n)) : ""));
    const now = markers(CUR_APP, CUR_CSS);
    const nowPass = now.filter((x) => x.p).length;
    ok(nowPass === now.length, "正对照：当前工作区 " + nowPass + "/" + now.length + " 标记全成立"
      + (nowPass !== now.length ? " ｜ 未过：" + JSON.stringify(now.filter((x) => !x.p).map((x) => x.n)) : ""));
    console.log("   铆定 9dc42be：标记失败 " + fails.length + "/" + old.length + "（须全部失败）");
    console.log("   当前工作区：标记成立 " + nowPass + "/" + now.length + "（须全部成立）");
    /* 反向前提：改前确实「只隐藏沁灵/夜话」⇒ 证明这次是**反转默认**而不是本来就没有 */
    ok(/body\.route-spirit\s+#aiFab/.test(BASE_CSS) && /body\.route-night\s+#aiFab/.test(BASE_CSS),
      "负向前提：改前 CSS 确为「只隐藏沁灵/夜话」两条（本次把默认从「显示」翻成「隐藏」）");
  }
}

console.log("\n------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((m) => console.log("  - " + m)); }
console.log(FAIL > 0 ? "⇒ 红测：V180-L2 未落地" : "⇒ 全绿：AI 喵助手已只在首页出现");
process.exit(FAIL > 0 ? 1 : 0);
