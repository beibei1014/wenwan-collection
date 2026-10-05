/* V175 批次 1 自测：js/spirits.js 日记 / 回响「去物化」+ 沁灵性别注入
 * ===========================================================================
 * 目的：不止扫源码关键字，而是把 spirits.js 里**真实的文案数据**抽出来跑：
 *         - diaryLocal 的兜底池（8 条）：真 eval 出字符串数组后逐条断言
 *         - ECHO_LETTER（6 组 × 2 候选）：真 eval 出对象后逐条断言
 *         - diaryWrite 的 AI 路径：断言 spiritGenderLine(ap) 已注入 user 消息
 *       ⛔ 不断言「理论上」—— 每条都取真数据 / 真源码。
 *
 * 用法：node docs/_test_v175_diary.js
 *
 * 负向对照（⛔ 铆定 commit，绝不用 HEAD —— 一提交 HEAD 就变「改后」⇒ 永久假红）：
 *   基线 = git show 90bccf2:js/spirits.js
 *   先跑基线：新增断言（A 组）必须大量 FAIL，回归护栏（B 组）应当 PASS。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CUR = fs.readFileSync(path.join(ROOT, "js/spirits.js"), "utf8");

/* ---------- 抽函数 / 抽常量（大括号配对，跳字符串 / 注释） ---------- */
function skipJunk(src, i) {
  const ch = src[i];
  if (ch === "'" || ch === '"' || ch === "`") {
    const q = ch; i++;
    while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) return i + 1; i++; }
    return i;
  }
  if (ch === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); return e < 0 ? src.length : e; }
  if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); return e < 0 ? src.length : e + 2; }
  return i + 1;
}
function extractFn(src, name) {
  const m = new RegExp("function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return "";
  let i = src.indexOf("(", m.index), pd = 0;
  for (; i < src.length; i++) { if (src[i] === "(") pd++; else if (src[i] === ")") { pd--; if (pd === 0) { i++; break; } } }
  while (i < src.length && src[i] !== "{") i++;
  let depth = 0, j = i;
  for (; j < src.length;) {
    if ("'\"`".indexOf(src[j]) >= 0 || (src[j] === "/" && (src[j + 1] === "/" || src[j + 1] === "*"))) { j = skipJunk(src, j); continue; }
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) { j++; break; } }
    j++;
  }
  return src.slice(m.index, j);
}
function extractConst(src, name) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*([\\{\\[])").exec(src);
  if (!m) return "";
  const open = m[1], close = open === "{" ? "}" : "]";
  let i = src.indexOf(open, m.index), depth = 0, j = i;
  for (; j < src.length;) {
    if ("'\"`".indexOf(src[j]) >= 0 || (src[j] === "/" && (src[j + 1] === "/" || src[j + 1] === "*"))) { j = skipJunk(src, j); continue; }
    if (src[j] === open) depth++;
    else if (src[j] === close) { depth--; if (depth === 0) { j++; break; } }
    j++;
  }
  return src.slice(m.index, j) + ";";
}

// 字符串拼接型 const（如 CG_BRIEF_SYS）—— extractConst 只认 { / [ 字面量，认不了
function extractConstStr(src, name) {
  const lines = src.split("\n");
  const re = new RegExp("const\\s+" + name + "\\s*=");
  let s = -1;
  for (let i = 0; i < lines.length; i++) { if (re.test(lines[i])) { s = i; break; } }
  if (s < 0) return "";
  const out = [];
  for (let i = s; i < lines.length; i++) {
    out.push(lines[i]);
    if (/;\s*$/.test(lines[i])) break;          // 到「行尾 ;」即声明结束（串内无 ASCII 分号）
  }
  return out.join("\n");
}

/* ---------- 把「真数据」取出来 ---------- */
// diaryLocal 的池：eval 出来才是真字符串（含 colorName 拼接结果）
function realPool(src) {
  const fn = extractFn(src, "diaryLocal");
  if (!fn) return null;
  const m = /const pool = \[([\s\S]*?)\n {4}\];/.exec(fn);
  if (!m) return null;
  try { return new Function("colorName", "return [" + m[1] + "];").call(null, "素色"); }
  catch (e) { return null; }
}
function realEcho(src) {
  const c = extractConst(src, "ECHO_LETTER");
  if (!c) return null;
  // ⚠️ 只取对象字面量本身（不能 return 一条 const 声明，会 SyntaxError）
  const lit = c.replace(/^const\s+ECHO_LETTER\s*=\s*/, "").replace(/;\s*$/, "");
  try { return new Function("return " + lit + ";")(); }
  catch (e) { return null; }
}
const OBJ_WORDS = ["盘我", "捏我", "摸我", "晾在窗台", "挂在窗台", "挂瓷给我看", "挂瓷给她看", "挂瓷给他看",
  "把我盘", "被盘", "被捏", "被摸", "装睡", "假装在睡觉", "被把玩", "把玩我", "盘到", "被晾"];
function hasObj(s) { return OBJ_WORDS.filter((w) => String(s).indexOf(w) >= 0); }

/* ---------- 断言 ---------- */
// A 组 = 新增断言（基线必须红）；B 组 = 回归护栏（改后应仍绿，改前也应绿）
function run(src) {
  const A = [], B = [];
  const pool = realPool(src);
  const echo = realEcho(src);
  const dw = extractFn(src, "diaryWrite");
  const dl = extractFn(src, "diaryLocal");

  /* ===== A 组：本次要解决的缺陷 ===== */
  A.push(["A1 · diaryWrite 的 user 消息已注入 spiritGenderLine(ap)",
    !!dw && dw.indexOf("spiritGenderLine(ap)") >= 0]);
  A.push(["A2 · diaryWrite 的 sys 已去掉「手串盘到挂瓷后变成的小生物」",
    !!dw && dw.indexOf("手串盘到挂瓷后变成的小生物") < 0]);
  A.push(["A3 · diaryWrite 的 sys 写明世界观（有灵性/修行者/家人/陪伴）",
    !!dw && /有灵性|修行|家人|陪伴/.test(dw)]);
  A.push(["A4 · diaryWrite 的 sys 明令禁止物件视角写法",
    !!dw && /禁止|不许|不要写|不写/.test(dw) && /被盘|被捏|被摸|装睡|把玩/.test(dw)]);
  A.push(["A5 · diaryLocal 池内不写死性别代词「他/她」",
    !!pool && pool.every((s) => !/[他她]/.test(s))]);
  A.push(["A6 · diaryLocal 池内无物件视角词",
    !!pool && pool.every((s) => hasObj(s).length === 0)]);
  A.push(["A7 · ECHO_LETTER 内无物件视角词",
    !!echo && Object.keys(echo).every((k) => echo[k].every((s) => hasObj(s).length === 0))]);
  A.push(["A8 · ECHO_LETTER 已改掉「抱出来给人看看 / 让我在灯下站一站」",
    !!echo && !JSON.stringify(echo).includes("抱出来给人看看") && !JSON.stringify(echo).includes("让我在灯下站一站")]);
  A.push(["A9 · ECHO_LETTER 不再把沁灵写成「还在那一串里」（物件位）",
    !!echo && !JSON.stringify(echo).includes("还在那一串")]);

  /* ===== B 组：回归护栏（结构不许改坏） ===== */
  B.push(["B1 · diaryLocal 池仍是 8 条", !!pool && pool.length === 8]);
  B.push(["B2 · diaryLocal 池保留 colorName 变量", !!dl && dl.indexOf("colorName") >= 0 && !!pool && pool.some((s) => s.indexOf("素色") >= 0)]);
  B.push(["B3 · 保留 seed / pick 结构", !!dl && dl.indexOf("pick(pool, seed)") >= 0]);
  B.push(["B4 · 保留 head「第 N 天 · 阶段名」", !!dl && dl.indexOf('"第 " + ((ctx && ctx.dayNo) || 1) + " 天 · "') >= 0]);
  B.push(["B5 · 保留 idle>=3 覆盖分支", !!dl && /idle != null && idle >= 3/.test(dl)]);
  B.push(["B6 · 保留 playedToday 覆盖分支", !!dl && /ctx && ctx\.playedToday/.test(dl)]);
  B.push(["B7 · 保留 rep 回复引用（4 条）", !!dl && (dl.match(/rep/g) || []).length >= 4]);
  B.push(["B8 · diaryLocal 池内无「它」", !!pool && pool.every((s) => s.indexOf("它") < 0)]);
  B.push(["B9 · ECHO_LETTER 内无「它」", !!echo && Object.keys(echo).every((k) => echo[k].every((s) => s.indexOf("它") < 0))]);
  B.push(["B10 · ECHO_LETTER 仍是 6 组 × 2 候选",
    !!echo && Object.keys(echo).length === 6 && Object.keys(echo).every((k) => Array.isArray(echo[k]) && echo[k].length === 2)]);
  B.push(["B11 · ECHO_LETTER 占位符全为 ASCII 且 7 个都在",
    !!echo && ["{call}", "{name}", "{color}", "{bead}", "{stage}", "{plays}", "{year}"]
      .every((p) => JSON.stringify(echo).includes(p))]);
  B.push(["B12 · diaryWrite 保留 60-140 字约束", !!dw && dw.indexOf("60-140") >= 0]);
  B.push(["B13 · diaryWrite 保留 ownerLine() 注入", !!dw && dw.indexOf("ownerLine()") >= 0]);
  B.push(["B14 · diaryWrite 保留「这位沁灵平时叫主人」措辞", !!dw && dw.indexOf("；这位沁灵平时叫主人") >= 0]);
  B.push(["B15 · 兜底池保留「隔壁那只…ta 比我早开沁」（既有测试钉死的子串）",
    !!pool && pool.some((s) => s.indexOf("刚才跟隔壁那只聊了两句，ta 比我早开沁。") >= 0)]);
  B.push(["B16 · ⛔ 未动 hashStr / ww_spirits / spirit_store",
    src.indexOf("function hashStr") >= 0 && src.indexOf("ww_spirits") >= 0]);

  /* ===== C 组：续批 6 处 AI 文案入口（世界观口径 + 去物化 + 性别纪律）=====
     ⚠️ 按「区域」断言（不是全文件扫）—— STYLE_PRESETS 里的「日漫风 · 小生物」
        是用户可选**美术风格**，不是世界观表述，⛔ 不该被这条断言误伤。 */
  const C = [];
  const REG = {
    "1 persona": extractFn(src, "persona"),
    "2 chat（群戏）": extractFn(src, "chat"),
    "3 letter": extractFn(src, "letter"),
    "4 personaZh": extractFn(src, "personaZh"),
    "5 roomStory（群戏）": extractFn(src, "roomStory"),
    "6 CG_BRIEF_SYS": extractConstStr(src, "CG_BRIEF_SYS"),
  };
  Object.keys(REG).forEach((k) => {
    const r = REG[k] || "";
    C.push(["C · " + k + "：⛔ 无旧世界观「盘到挂瓷」", !!r && r.indexOf("盘到挂瓷") < 0]);
    C.push(["C · " + k + "：⛔ 无旧表述「小生物」", !!r && r.indexOf("小生物") < 0]);
    C.push(["C · " + k + "：⛔ 无旧表述「化成的小人」", !!r && r.indexOf("化成的小人") < 0]);
    C.push(["C · " + k + "：写明新世界观（有灵性/修行 + 一家人 + 陪伴）",
      !!r && /有灵性|修行/.test(r) && /一家人/.test(r) && /陪伴/.test(r)]);
    C.push(["C · " + k + "：有禁物件视角硬约束",
      !!r && /严禁物件视角/.test(r) && /被盘|被捏|被摸|装睡|把玩/.test(r)]);
    C.push(["C · " + k + "：禁「它」指沁灵", !!r && /禁用「它」|禁「它」/.test(r)]);
  });
  // 性别纪律：单只能拿 ap 的必须注入；群戏/拿不到的至少「不许混用他/她」
  C.push(["C · personaZh 已注入 spiritGenderLine(ap)",
    (REG["4 personaZh"] || "").indexOf("spiritGenderLine(ap)") >= 0]);
  C.push(["C · chat（群戏）有「不许混用他/她」", (REG["2 chat（群戏）"] || "").indexOf("不许混用他/她") >= 0]);
  C.push(["C · roomStory（群戏）有「不许混用他/她」", (REG["5 roomStory（群戏）"] || "").indexOf("不许混用他/她") >= 0]);
  C.push(["C · letter 有「不许混用他/她」", (REG["3 letter"] || "").indexOf("不许混用他/她") >= 0]);
  C.push(["C · diaryWrite 已注入 spiritGenderLine(ap)", !!dw && dw.indexOf("spiritGenderLine(ap)") >= 0]);

  return {
    A, B, C,
    aFail: A.filter((x) => !x[1]).length,
    bFail: B.filter((x) => !x[1]).length,
    cFail: C.filter((x) => !x[1]).length,
  };
}

/* ---------- 基线（铆定 commit 90bccf2） ---------- */
function baselineSrc() {
  const tmpDir = path.join(__dirname, "_tmp");
  const tmp = path.join(tmpDir, "_pre_v175_spirits.js");
  // 本沙箱 execSync 偶发 EBUSY ⇒ 先落盘再读（失败也能回落）
  try {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    require("child_process").execSync('git show 90bccf2:js/spirits.js > "' + tmp + '"',
      { cwd: ROOT, stdio: "ignore", shell: true });
  } catch (e) { /* 回落 */ }
  try { const s = fs.readFileSync(tmp, "utf8"); if (s && s.length > 1000) return s; } catch (e2) { /* 回落 */ }
  try {
    return require("child_process").execSync("git show 90bccf2:js/spirits.js",
      { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (e3) { return ""; }
}

const cur = run(CUR);
console.log("=== 1. 当前工作区 js/spirits.js（改后，A 组应全绿）===");
console.log("A 组（本次缺陷，共 " + cur.A.length + "）：失败 " + cur.aFail);
cur.A.forEach((x) => { if (!x[1]) console.log("  ✗ " + x[0]); });
console.log("B 组（回归护栏，共 " + cur.B.length + "）：失败 " + cur.bFail);
cur.B.forEach((x) => { if (!x[1]) console.log("  ✗ " + x[0]); });
console.log("C 组（续批 6 处 AI 文案入口，共 " + cur.C.length + "）：失败 " + cur.cFail);
cur.C.forEach((x) => { if (!x[1]) console.log("  ✗ " + x[0]); });

console.log("\n=== 2. 负向对照（铆定 commit 90bccf2 · ⛔ 不用 HEAD）===");
const OLD = baselineSrc();
if (OLD) {
  const o = run(OLD);
  console.log("基线 A 组：失败 " + o.aFail + " / " + o.A.length +
    (o.aFail >= 6 ? "  ⇒ 负向对照成立 ✅" : "  ⚠ 基线失败条数偏少（" + o.aFail + "）"));
  console.log("基线 B 组：失败 " + o.bFail + " / " + o.B.length + "（应接近 0 —— 护栏测的是结构，改前也该成立）");
  o.B.forEach((x) => { if (!x[1]) console.log("    · 基线也 FAIL：" + x[0]); });
  console.log("基线 C 组：失败 " + o.cFail + " / " + o.C.length +
    (o.cFail >= 20 ? "  ⇒ 负向对照成立 ✅（续批 6 处确为新增改动）" : "  ⚠ 基线失败条数偏少（" + o.cFail + "）"));
} else {
  console.log("  （取不到 90bccf2 基线 → 负向对照优雅跳过）");
}

const fails = cur.aFail + cur.bFail + cur.cFail;
console.log("\n----------------------------------------");
console.log("V175 批次1：通过 " + (cur.A.length + cur.B.length + cur.C.length - fails) + " 项，失败 " + fails + " 项");
if (fails) {
  console.log("失败清单：");
  cur.A.concat(cur.B).concat(cur.C).forEach((x) => { if (!x[1]) console.log("  - " + x[0]); });
}
process.exit(fails ? 1 : 0);
