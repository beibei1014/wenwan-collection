/* ============================================================
 * _test_v180k4_trait.js · V180 批K-4 · 删除「改不了的性格标签」
 * ------------------------------------------------------------
 *   用户原话：「性格标签改不了就删」
 *   ⇒ 沁灵**详情页** sd-top 里那一行 persona.traits 性格标签（「安静」「爱干净」…）
 *     是只读的、点了没反应 ⇒ 整段不再渲染。
 *   ⇒ 同一行里的**信息标签**（颜色 / 糯度 / 闲置天数）保留。
 *   ⇒ 卡片页（沁灵页 / 全部沁灵页）的性格标签保留（列表仍要看，_test_v163c_layout 钉着）
 *     ⇒ .spirit-tags / .spirit-trait 样式不是死代码，保留。
 *
 *   A. 详情页：性格标签 0 渲染 / 信息标签仍在 / HTML 标签栈闭合（防删出断标签）
 *   B. ⛔ 卡片页性格标签保留（回归护栏）
 *   C. 详情页其余 persona 字段未被误删
 *   D. 负向对照（铆定 df71bd5 改前 · ⛔ 不用 HEAD）
 *
 * 用法： node docs/_test_v180k4_trait.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const CUR = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* 按大括号配对抽函数（跳过字符串 / 注释里的括号） */
function extractFn(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return "";
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
/* 标签栈：防「删一半把 </div> 删多了」→ flex row 被拆散 */
function tagCheck(html) {
  const stack = [];
  const re = /<(\/?)(div|span|textarea|button|label|p|b|small|i|em|strong)\b[^>]*?(\/?)>/gi;
  let m, err = "";
  while ((m = re.exec(html))) {
    if (m[3] === "/") continue;
    const name = m[2].toLowerCase();
    if (!m[1]) stack.push(name);
    else { const t = stack.pop(); if (t !== name) { err = "闭合错配：</" + name + "> 对上 <" + t + ">"; break; } }
  }
  return { ok: !err && stack.length === 0, err: err || (stack.length ? "未闭合：" + stack.join(",") : "") };
}
/* 抽一段源码里所有字符串字面量（HTML 模板都在里面）拼起来 */
function stringsOf(region) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(region))) out.push(m[1] || m[2] || m[3] || "");
  return out.join("\n");
}

/* ============================================================
 * A. 详情页
 * ============================================================ */
section("A · 详情页：性格标签 0 渲染 / 信息标签仍在 / 标签栈闭合");
const detail = extractFn(CUR, "renderSpiritDetailPage");
{
  ok(detail.length > 0, "抽到 renderSpiritDetailPage（实长 " + detail.length + "）");
  ok(!/\bp\.traits\b/.test(detail), "⛔ 详情页不再引用 p.traits（性格标签已删）");
  ok(!/persona\s*\|\|[\s\S]{0,40}traits/.test(detail), "⛔ 详情页无「persona.traits 回落再渲染」的等价写法");
  const traitChip = /<span class="spirit-trait">/.test(detail);
  ok(!traitChip, "⛔ 详情页不再产出 `<span class=\"spirit-trait\">` 性格标签片");
  ok(/spirit-trait idle/.test(detail), "✅ 信息标签（颜色 / 糯度 / 闲置天数）保留");
  ok(/spirit-tags/.test(detail), "✅ .spirit-tags 容器保留（只是不再塞性格标签）");
  const tc = tagCheck(stringsOf(detail));
  ok(tc.ok, "⛔ 详情页 HTML 标签栈闭合（防删出断标签）：" + (tc.err || "无错"));
  ok(/sd-top/.test(detail) && /<\/div><\/div>"/.test(detail), "✅ sd-top 收尾未破坏");
}

/* ============================================================
 * B. ⛔ 卡片页性格标签保留（回归护栏）
 * ============================================================ */
section("B · ⛔ 卡片页（沁灵页 / 全部沁灵页）性格标签保留");
{
  ["renderSpiritPage", "renderAllSpiritsPage"].forEach((fn) => {
    const body = extractFn(CUR, fn);
    ok(body.length > 0, "抽到 " + fn);
    ok(/\bp\s*&&\s*p\.traits\b/.test(body) || /\bp\.traits\b/.test(body), fn + " 仍渲染 p.traits（列表要看性格标签）");
    ok(/<span class="spirit-trait">/.test(body), fn + " 仍产出 `<span class=\"spirit-trait\">`");
    const tc = tagCheck(stringsOf(body));
    ok(tc.ok, fn + " 标签栈闭合：" + (tc.err || "无错"));
  });
  /* 样式引用仍在用 ⇒ 不是死代码，不许删 */
  const CSS1 = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8");
  const CSS2 = fs.readFileSync(path.join(ROOT, "css", "skin.css"), "utf8");
  ok(/\.spirit-tags\s*\{/.test(CSS1), ".spirit-tags 样式保留（卡片页仍在用 ⇒ 非死代码）");
  ok(/\.spirit-trait\b/.test(CSS1) && /\.spirit-trait\b/.test(CSS2), ".spirit-trait 样式保留（卡片页仍在用 ⇒ 非死代码）");
}

/* ============================================================
 * C. 详情页其余 persona 字段未被误删
 * ============================================================ */
section("C · 详情页其余 persona 字段未被误删");
{
  ok(/p\.title/.test(detail), "persona.title（字/称号位）仍在渲染");
  ok(/idCard\.poem|idCard\.eight|sd-title/.test(detail), "身份卡（字 / 诗 / 八字）仍在渲染");
  ok(/colorName/.test(detail) && /softName/.test(detail), "颜色 / 糯度仍在渲染（信息标签里）");
  ok(/sd-persona|personaZh/.test(detail), "「人物设定」卡仍在渲染");
}

/* ============================================================
 * D. 负向对照（铆定 df71bd5 改前 · ⛔ 不用 HEAD）
 * ============================================================ */
section("D · 负向对照（铆定 df71bd5 改前 · ⛔ 不用 HEAD）");
{
  /* ⚠️ 只有「删除类」标记才是批K-4 的新增信号 —— 「信息标签仍在 / 标签栈闭合」是
     **不变式**（改前也成立），放进负向对照会假阳性通过、把对照稀释成 2/4，故只留删除项。 */
  const markers = (src) => {
    const d = extractFn(src, "renderSpiritDetailPage");
    return [
      { n: "详情页不再引用 p.traits", p: d.length > 0 && !/\bp\.traits\b/.test(d) },
      { n: "详情页无 spirit-trait 性格片", p: d.length > 0 && !/<span class="spirit-trait">/.test(d) },
    ];
  };
  /* ⚠️ 沙箱偶发 `spawnSync cmd.exe EBUSY` ⇒ 重试 3 次，再退到 docs/_tmp 快照（git 已排除） */
  let BASE = "";
  for (let attempt = 0; attempt < 3 && !BASE; attempt++) {
    try { BASE = cp.execSync("git show df71bd5:js/app.js", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); }
    catch (e) { if (attempt === 2) console.log("   （git show 三次均失败：" + e.message + "，退到 _tmp 快照）"); }
  }
  if (!BASE) { try { BASE = fs.readFileSync(path.join(__dirname, "_tmp", "_pre_v180k4_app.js"), "utf8"); } catch (e2) { BASE = ""; } }
  if (!BASE) ok(false, "取不到 df71bd5 基线（负向对照无法执行）");
  else {
    const old = markers(BASE);
    const fails = old.filter((x) => !x.p).map((x) => x.n);
    ok(fails.length === old.length, "⛔ 铆定版**全部**标记不成立：失败 " + fails.length + "/" + old.length
      + (fails.length !== old.length ? " ｜ 竟然通过的：" + JSON.stringify(old.filter((x) => x.p).map((x) => x.n)) : ""));
    const now = markers(CUR);
    const nowPass = now.filter((x) => x.p).length;
    ok(nowPass === now.length, "正对照：当前工作区 " + nowPass + "/" + now.length + " 标记全成立"
      + (nowPass !== now.length ? " ｜ 未过：" + JSON.stringify(now.filter((x) => !x.p).map((x) => x.n)) : ""));
    /* 不变式（改前后都该成立，只作护栏，不进负向对照） */
    const bd = extractFn(BASE, "renderSpiritDetailPage");
    ok(/spirit-trait idle/.test(bd) && tagCheck(stringsOf(bd)).ok, "不变式：铆定版信息标签与标签栈本就完好（⇒ 这轮只删了性格标签）");
    console.log("   铆定 df71bd5：标记失败 " + fails.length + "/" + old.length + "（须全部失败）");
    console.log("   当前工作区：标记成立 " + nowPass + "/" + now.length + "（须全部成立）");
  }
}

console.log("\n------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((m) => console.log("  - " + m)); }
console.log(FAIL > 0 ? "⇒ 红测：V180-K4 未落地" : "⇒ 全绿：详情页只读性格标签已删除");
process.exit(FAIL > 0 ? 1 : 0);
