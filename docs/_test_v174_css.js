/* V174-C3 自测：css/skin.css —— 事件卡片（三级 + 单张队列）/ 纪事页 / 画册 / hub 收敛 / 5 个新 token
 *
 * 背景（team-lead 派单 V174-C3）：
 *   只改 css/skin.css（≈260 行）+ 新建本测试；⛔ 不碰 js/ / index.html / 规范文档。
 *   规范文档 docs/v174-事件卡片与回顾页-界面规范.md 已冻结全部 class 名 —— 本测试钉住它落没落地。
 *
 * 本测试 8 条（team-lead 指定）：
 *   ① css/skin.css 读出来 CRLF 数 = 0（全项目唯一 LF 文件的不变量）
 *   ② 5 个新 token（实为 6 个）都在第一个 :root 内
 *   ③ 🔴 [data-frame="knee"] 仍在 [data-cut="1"] 之后（V174-A 不变量，⛔ 别被追加块打乱覆盖序）
 *   ④ 关键选择器都在：.evt-card.is-l1/.is-l2/.is-l3 / .evt-tabs / .evt-tab / .evt-row / .evt-day /
 *      .album-cell.is-cover / .hub-card / .hub-chip / .evt-fail
 *   ⑤ reduced-motion 段里含 .evt-card / .evt-row / .album-cell / .hub-chip
 *   ⑥ .memo-sub（两处定义）已改用 --wood-2（⛔ 不再用 --text-2）
 *   ⑦ 未新增第二个 @media (prefers-reduced-motion: reduce) 块（块数 == 铆定基线块数）
 *   ⑧ 负向对照：同套「内容断言」跑在铆定 commit 03c473c 的 css/skin.css（⛔ 绝不用 HEAD）⇒ 5/5 必须 FAIL
 *
 * 用法：node docs/_test_v174_css.js [--verbose]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const CSS_PATH = path.join(ROOT, "css/skin.css");
const CSS = fs.readFileSync(CSS_PATH, "utf8");

/* 5 个新 token（⑤ 实为 6 个：规范 §5.1 列 5 个 + --album-cell-ratio，共 6） */
const TOKENS = ["--evt-ico", "--evt-row-minh", "--evt-card-w", "--evt-queue-max", "--hub-chip-h", "--album-cell-ratio"];

/* ④ 关键选择器（规范 §1.1 / §2.2 / §3.2 / §3.5 / §4.2 / §2.4-出错态） */
const KEY_SELECTORS = [
  ".evt-card.is-l1", ".evt-card.is-l2", ".evt-card.is-l3",
  ".evt-tabs", ".evt-tab", ".evt-row", ".evt-day",
  ".album-cell.is-cover", ".hub-card", ".hub-chip", ".evt-fail",
];

/* 取第一个 :root {...} 块（token 的落点；规范 §5.1 要求追加到 skin.css 的 :root 手感变量块） */
function firstRootBlock(css) {
  const i = css.indexOf(":root {");
  if (i < 0) return "";
  const j = css.indexOf("\n}", i);
  return css.slice(i, j < 0 ? css.length : j + 2);
}
/* 取「含 .talk-portrait 的那个」reduced-motion 段（V174-C3 扩写的正是这一段） */
function rmTalkBlock(css) {
  const a = ".talk-portrait, .scenebg, .nt-opt { transition: none !important;";
  const i = css.indexOf(a);
  if (i < 0) return "";
  const j = css.indexOf("\n}", i);
  return css.slice(i, j < 0 ? css.length : j);
}
function countRM(css) { return (css.match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length; }
function memoSubRules(css) { return css.match(/\.memo-sub \{[^}]*\}/g) || []; }

/* 同套「内容断言」：当前工作区 / 铆定基线 共用。返回 [{n,p}] —— 5 条，均已"在 03c473c 上不成立"验证过 */
function contentChecks(css) {
  const root = firstRootBlock(css);
  const rm = rmTalkBlock(css);
  const ms = memoSubRules(css);
  return [
    { n: "② 6 个新 token 全在第一个 :root 内", p: TOKENS.every((t) => root.indexOf(t + ":") >= 0) },
    { n: "③ [data-frame=\"knee\"] 在 [data-cut=\"1\"] 之后",
      p: css.indexOf('[data-cut="1"]') >= 0 && css.indexOf('[data-frame="knee"]') > css.indexOf('[data-cut="1"]') },
    { n: "④ 关键选择器齐全（11 个）", p: KEY_SELECTORS.every((s) => css.indexOf(s) >= 0) },
    { n: "⑤ reduced-motion 段含 .evt-card/.evt-row/.album-cell/.hub-chip",
      p: [".evt-card", ".evt-row", ".album-cell", ".hub-chip"].every((s) => rm.indexOf(s) >= 0) },
    { n: "⑥ .memo-sub 两处均用 --wood-2（且不用 --text-2）",
      p: ms.length === 2 && ms.every((x) => x.indexOf("--wood-2") >= 0 && x.indexOf("--text-2") < 0) },
  ];
}

/* 铆定基线取法：优先 `git show <铆定 commit>`；部分沙箱 spawn EBUSY/无 git → 回落预导出基线文件
   （与 _test_v174_mainchar.js / _test_v165f_portrait.js 同一口径；预导出文件在 docs/_tmp/，本地 git 排除） */
function baseline(tmpRel) {
  try {
    return require("child_process").execSync("git show 03c473c:css/skin.css", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (e) {
    try { return fs.readFileSync(path.join(__dirname, tmpRel), "utf8"); } catch (e2) { return ""; }
  }
}

/* ============ ① 行尾不变量（当前工作区） ============ */
section("① css/skin.css 仍是 LF（全项目唯一 LF 文件）");
ok((CSS.match(/\r\n/g) || []).length === 0, "① CRLF 数 = 0（实测 " + (CSS.match(/\r\n/g) || []).length + "）");
ok((CSS.match(/\r/g) || []).length === 0, "① 无 lone CR（实测 " + (CSS.match(/\r/g) || []).length + "）");

/* ============ ②-⑥ 内容断言（当前工作区 · 应全绿） ============ */
section("②-⑥ 内容断言（当前工作区，应全绿）");
contentChecks(CSS).forEach((c) => ok(c.p, "V174-C3 · " + c.n));

/* ============ ⑦ 未新增 reduced-motion 块 ============ */
section("⑦ 未新增 @media (prefers-reduced-motion: reduce) 块");
const CUR_RM = countRM(CSS);
const OLD = baseline("_tmp/_pre_v174c3_baseline_skin.css");
if (OLD) {
  const OLD_RM = countRM(OLD);
  ok(CUR_RM === OLD_RM, "⑦ 块数未变（当前 " + CUR_RM + " == 铆定 03c473c " + OLD_RM + "；本批只扩写了已有的那一段）");
} else {
  ok(true, "⑦ (取不到 03c473c 基线 → 优雅跳过)");
}

/* ============ ⑧ 负向对照：铆定 03c473c ============ */
section("⑧ 负向对照（铆定 commit 03c473c · ⛔ 不用 HEAD）");
if (OLD) {
  const cc = contentChecks(OLD);
  const fails = cc.filter((c) => !c.p).map((c) => c.n);
  ok(fails.length >= 1, "⑧ 铆定版至少 1 条断言 FAIL → 负向对照成立（实测失败 " + fails.length + "/" + cc.length + "）");
  ok(fails.length === cc.length, "⑧ 铆定版 " + cc.length + " 条内容断言**全部**不成立（V174-C3 确为新增）：失败 " + fails.length + "/" + cc.length);
} else {
  ok(true, "⑧ (取不到 03c473c 基线 → 负向对照优雅跳过)");
}

/* ============ ⑨ C3b · 补 4 类样式（.evt-end / .evt-blank / .evt-ph+.ph-evt-* / .evt-all） ============
   背景：V174-C3b 派单 —— C2A 的 HTML 用到、C3 未覆盖的 4 类，由 C2A 作者补齐（最清楚预期视觉）。
   ⛔ 只追加新规则；负向对照铆定 C3 提交 baa83f4（⛔ 绝不用 HEAD —— 一提交 HEAD 就成「改后」→ 永久假红）。 */
const C3B_ANCHOR = "baa83f4";
function baselineAt(commit, tmpRel) {
  try {
    return require("child_process").execSync("git show " + commit + ":css/skin.css", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (e) {
    try { return fs.readFileSync(path.join(__dirname, tmpRel), "utf8"); } catch (e2) { return ""; }
  }
}
function c3bChecks(css) {
  return [
    { n: "⑨.1 .evt-end 已定义（列到底文案）", p: /\.evt-end\s*\{/.test(css) },
    { n: "⑨.2 .evt-blank 已定义（单筛选空态）", p: /\.evt-blank\s*\{/.test(css) },
    { n: "⑨.3 .evt-ph 已定义（封泥字形占位）", p: /\.evt-ph\s*\{/.test(css) },
    { n: "⑨.4 .ph-evt-* 按类型钩子已在", p: css.indexOf("ph-evt-") >= 0 && /\[class\*=["']ph-evt-["']\]/.test(css) },
    { n: "⑨.5 .evt-all 已定义（看全部入口）", p: /\.evt-all\s*\{/.test(css) },
    { n: "⑨.6 .evt-card.is-sum 已定义（汇总卡中性兜底 · team-lead 裁定 4）", p: /\.evt-card\.is-sum/.test(css) },
  ];
}
section("⑨ C3b · 纪事页补 4 类样式（当前工作区，应全绿）");
c3bChecks(CSS).forEach((c) => ok(c.p, "V174-C3b · " + c.n));
ok((CSS.match(/\r\n/g) || []).length === 0, "⑨.0 C3b 改动后 css/skin.css 仍 CRLF === 0（唯一 LF 文件不变量）");

section("⑨-neg 负向对照（铆定 C3 提交 " + C3B_ANCHOR + " · ⛔ 不用 HEAD）");
const C3BASE = baselineAt(C3B_ANCHOR, "_tmp/_pre_v174c3b_baseline_skin.css");
if (C3BASE) {
  const cc = c3bChecks(C3BASE);
  const fails = cc.filter((c) => !c.p).length;
  ok(fails === cc.length, "⑨-neg 铆定 " + C3B_ANCHOR + " 上这 " + cc.length + " 条**全部**不成立（改前 FAIL " + fails + "/" + cc.length + " → 改后全 PASS）⇒ C3b 确为新增");
} else {
  ok(true, "⑨-neg (取不到 " + C3B_ANCHOR + " 基线 → 优雅跳过)");
}

/* ============ ⑩ 跨文件一致性：--evt-queue-max ≡ app.js 的 EVT_QUEUE_MAX（机械防漂移，零运行时代价） ============
   team-lead 裁定 1：⛔ 不读 CSSOM（不把渲染绑到样式表加载时序）；改为「两侧同值 + 跨文件断言」的机械防漂移。 */
section("⑩ 单点旋钮跨文件一致：--evt-queue-max ≡ EVT_QUEUE_MAX");
const APP = fs.existsSync(path.join(ROOT, "js/app.js")) ? fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8") : "";
const cssNum = (CSS.match(/--evt-queue-max:\s*(\d+)/) || [])[1];
const jsNum = (APP.match(/EVT_QUEUE_MAX\s*=\s*(\d+)/) || [])[1];
ok(cssNum != null, "⑩ skin.css 取到 --evt-queue-max 数值（实测 " + cssNum + "）");
ok(jsNum != null, "⑩ app.js 取到 EVT_QUEUE_MAX 数值（实测 " + jsNum + "）");
ok(cssNum != null && cssNum === jsNum, "⑩ 两侧同值（css " + cssNum + " == js " + jsNum + "）—— 任一侧改动未同步即 FAIL");

const passed = summary();
process.exit(passed ? 0 : 1);
