/* ============================================================
 * _test_v180_objwords.js · V180 欠账④ · 物化词表补「柜子/箱子/抽屉/架子」+ 全库扫
 * ------------------------------------------------------------
 * 用户令（批K 回响线）：沁灵是**修仙得道的人**，不许被写成收进柜子/抽屉的物件。
 * 本批给两张物化词表补容器 / 收纳词，并做一次全库扫：
 *   · OBJ_RE（js/spirits.js，AI 台词**落库前**拦截词表）
 *   · PERSONA_BAD_WORDS（js/app.js，口头禅「像不像人话」词表）
 * ⛔ 只用「柜子 / 箱子 / 抽屉 / 架子」，**不收裸「柜」「箱」** —— 全库扫发现
 *    「展示柜 / 收藏展柜 / 邮箱」会被裸字误杀。
 *
 * 覆盖：
 *   A · 命中：把沁灵收进容器 / 收纳的句子必须被拦
 *   B · 误杀护栏：展示柜 / 收藏展柜 / 邮箱 / 养护机制词 一律放行
 *   C · 两张词表均含四词
 *   D · 全库扫（显示面）：AI 兜底模板 + 回响全池不含四词
 *   E · 负向对照：SP_SRC / APP_SRC 指向改动前 ⇒ 必须 FAIL
 *
 * 用法： node docs/_test_v180_objwords.js
 * 负向对照： SP_SRC=docs/_tmp/_pre_v180obj_spirits.js APP_SRC=docs/_tmp/_pre_v180obj_app.js node docs/_test_v180_objwords.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeContext, ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const SP_PATH = process.env.SP_SRC ? path.resolve(process.env.SP_SRC) : path.join(ROOT, "js", "spirits.js");
const APP_PATH = process.env.APP_SRC ? path.resolve(process.env.APP_SRC) : path.join(ROOT, "js", "app.js");
const SP_SRC = fs.readFileSync(SP_PATH, "utf8");
const APP_SRC = fs.readFileSync(APP_PATH, "utf8");
console.log("spirits：" + SP_PATH + "\napp：" + APP_PATH);

const WORDS = ["柜子", "箱子", "抽屉", "架子"];

/* ---------- 装 spirits（拿 OBJ_RE / hasObjectifiedText / 兜底模板） ---------- */
const h = makeContext();
try { vm.runInContext(SP_SRC, h.ctx, { filename: SP_PATH }); } catch (e) { console.log("  ! spirits 加载失败：" + e.message); }
const S = h.sandbox.Spirits || {};
const HO = (typeof S.hasObjectifiedText === "function") ? S.hasObjectifiedText : function () { return false; };

/* ---------- 抽 PERSONA_BAD_WORDS（app.js，与 _test_v163c_layout 同手法） ---------- */
let PBW = [];
{
  const m = /const PERSONA_BAD_WORDS = \[[\s\S]*?\n  \];/.exec(APP_SRC);
  if (m) { try { PBW = new Function(m[0] + "; return PERSONA_BAD_WORDS;")(); } catch (e) { PBW = []; } }
}

/* ================= A · 命中 ================= */
section("A · 容器 / 收纳词必须被拦（OBJ_RE）");
[
  ["把我放回柜子里", "主人走了，把我放回柜子里，就再没拿出来。"],
  ["收进箱子里", "天一冷，他就把我收进箱子里了。"],
  ["搁在架子上", "我被搁在架子上一整月，落了一层灰。"],
  ["锁进抽屉里", "那天他把我锁进抽屉里，我在里面数了很久。"],
].forEach(([label, s]) => ok(HO(s) === true, "命中 ⇒ " + label));

/* ================= B · 误杀护栏 ================= */
section("B · 误杀护栏（裸字不再误伤：展示柜 / 收藏展柜 / 邮箱 / 养护词）");
[
  ["喜欢展示柜（UI 标签）", "先去「喜欢展示柜」看看你收藏的宝贝吧。"],
  ["收藏展柜（UI 标签）", "我的收藏展柜_2026.jpg 已保存。"],
  ["邮箱（注册字段）", "请输入正确的邮箱地址。"],
  ["养护机制·盘这串", "盘这串手串的时候别太用力。"],
  ["养护机制·今天盘了三十下", "今天盘了三十下，手都酸了。"],
  ["含「摸」但不接「我」", "主人在桌上摸了摸那些珠子，我没出声。"],
  ["空串", ""],
  ["undefined", undefined],
  ["null", null],
].forEach(([label, s]) => ok(HO(s) === false, "放行 ⇒ " + label));
// 裸字护栏：OBJ_RE 源码不含裸「柜」「箱」「架」（只有「柜子 / 箱子 / 架子」）
{
  const bare = String((S.OBJ_RE && S.OBJ_RE.source) || "")
    .replace(/柜子/g, "").replace(/箱子/g, "").replace(/架子/g, "");
  ok(bare.indexOf("柜") < 0, "OBJ_RE ⛔ 无裸「柜」（展示柜 / 收藏柜 不误杀）");
  ok(bare.indexOf("箱") < 0, "OBJ_RE ⛔ 无裸「箱」（邮箱 不误杀）");
  ok(bare.indexOf("架") < 0, "OBJ_RE ⛔ 无裸「架」（打架 / 书架 不误杀）");
}

/* ================= C · 两张词表均含四词 ================= */
section("C · OBJ_RE + PERSONA_BAD_WORDS 均含四词");
const objSrc = String((S.OBJ_RE && S.OBJ_RE.source) || "");
WORDS.forEach((w) => ok(objSrc.indexOf(w) >= 0, "OBJ_RE 含「" + w + "」"));
WORDS.forEach((w) => ok(PBW.some((re) => re.test(w)), "PERSONA_BAD_WORDS 含「" + w + "」"));
ok(PBW.length >= 20, "PERSONA_BAD_WORDS 结构完整（" + PBW.length + " 条）");

/* ================= D · 全库扫（显示面） ================= */
section("D · 全库扫：AI 兜底模板 + 回响全池不含四词");
{
  const bad = (s) => WORDS.some((w) => String(s).indexOf(w) >= 0);
  // ① 本地兜底模板
  const ITEM = { id: "it_obj", name: "莫高窟", color: "red", species: "玉" };
  const rec = { bornAt: new Date(2000, (new Date().getMonth() + 6) % 12, 1).getTime(), stage: 1, bond: 0 };
  const ctx = { dayNo: 3, plays: 5, idleDays: 0 };
  try { ok(!bad(S.diaryLocal(ITEM, rec, {}, ctx)), "diaryLocal 兜底模板不含四词"); } catch (e) { ok(false, "diaryLocal 调用异常：" + e.message); }
  try { ok(!bad(S.localLetter({ item: { id: "x" }, persona: { title: "小沁灵", name: "莫高窟" }, idleDays: 3 }, "主人")), "localLetter 兜底模板不含四词"); } catch (e) { ok(false, "localLetter 调用异常：" + e.message); }
  try { ok((S.localChat([{ item: { id: "a" }, persona: { name: "莫高窟" } }, { item: { id: "b" }, persona: { name: "冰红茶" } }]) || []).every((l) => !bad(l.text)), "localChat 兜底模板不含四词"); } catch (e) { ok(false, "localChat 调用异常：" + e.message); }
  // ② 回响全池（8 节点 × 多采样）
  let hits = 0, total = 0;
  [1, 7, 30, 100, 365, 730, 1095, 1825].forEach((d) => {
    for (let k = 0; k < 6; k++) {
      const L = (typeof S.ensureEcho === "function") ? S.ensureEcho(ITEM, { bornAt: rec.bornAt, stage: 1, bond: 0 }, { dayNo: d, plays: 5, idleDays: 0 }) : null;
      if (!L) continue; total++;
      if (bad(L.text)) { hits++; console.log("  ✗ 回响 days=" + d + " 含容器词：" + L.text.slice(0, 30)); }
    }
  });
  ok(hits === 0, "回响 " + total + " 封采样不含四词");
  // ③ 全库源文本扫描（报告）：列出 js/*.js 里四词出现处，确认只在注释 / 词表 / 签文
  const files = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js"));
  const REPORT = [];
  files.forEach((f) => {
    const txt = fs.readFileSync(path.join(ROOT, "js", f), "utf8").split(/\r?\n/);
    txt.forEach((line, i) => {
      WORDS.forEach((w) => { if (line.indexOf(w) >= 0) REPORT.push(f + ":" + (i + 1) + "  " + line.trim().slice(0, 60)); });
    });
  });
  console.log("  · 全库 js/*.js 四词出现 " + REPORT.length + " 处：");
  REPORT.forEach((r) => console.log("      " + r));
}

/* ================= E · 负向对照锚点 ================= */
section("E · 负向对照（SP_SRC/APP_SRC 指向改动前 ⇒ 必须红）");
if (process.env.SP_SRC || process.env.APP_SRC) console.log("  当前指向：" + SP_PATH + " / " + APP_PATH);

const pass = summary();
process.exit(pass ? 0 : 1);
