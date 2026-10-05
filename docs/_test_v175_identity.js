/* ============================================================
 * _test_v175_identity.js · V175 批次2「沁灵身份卡 / 主线显示姓名 / 立绘别名」
 * ------------------------------------------------------------
 * ⚠️ 本文件在 **V175 批次2 落地前一直为红测**（red test）。覆盖：
 *      (a) 8 条身份数据齐全、且与主理人裁定**逐字一致**
 *      (b) 手串名 / 旧名 / 额外别名能反查到姓名（柿宝→楚柿遥、金算盘→萧景筹）
 *      (c) 身份命中时详情页姓名位显示「姓名」，⛔ 不再显示手串名
 *      (d) 主线名字条大字优先 castName（真名），不再显示行当设定名
 *      (e) MAINCHAR_ART 别名反查（楚柿遥/萧景筹/姜饴酌 → 柿宝/金算盘/咸法酪）
 *
 * 只按源码字符串 + 抽出纯函数跑判定：不 require/运行整个 app.js、不依赖 DOM。
 * 基准：`90bccf2`（批次2 落地前）。
 * 用法： node docs/_test_v175_identity.js
 * 负向对照： V175_APP_SRC=<90bccf2 导出的 app.js> node docs/_test_v175_identity.js ⇒ 必须红
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_PATH = process.env.V175_APP_SRC || path.join(ROOT, "js", "app.js");
const APP = (function () {
  try { return fs.readFileSync(APP_PATH, "utf8").replace(/\r/g, ""); } catch (e) { return ""; }
})();

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

console.log("V175 批次2 身份卡回归　源码：" + APP_PATH);
console.log("------------------------------------------------------------");

/* ---------- 抽出身份表 + 两个纯函数，真跑一遍 ---------- */
let IDENT = null, lookup = null;
try {
  const mArr = /var SPIRIT_IDENTITIES = (\[[\s\S]*?\n  \]);/.exec(APP);
  const mKeys = /function identityKeysOf\(idn\) \{[\s\S]*?\n  \}/.exec(APP);
  const mLook = /function spiritIdentityOf\(dispName\) \{[\s\S]*?\n  \}/.exec(APP);
  if (mArr && mKeys && mLook) {
    const ctx = vm.createContext({});
    vm.runInContext(mArr[0] + "\n" + mKeys[0] + "\n" + mLook[0] + "\n;__I = SPIRIT_IDENTITIES; __L = spiritIdentityOf;", ctx);
    IDENT = ctx.__I;
    lookup = ctx.__L;
  }
} catch (e) { /* 留到断言里报 */ }

/* ---------- (a) 8 条身份数据 · 逐字一致 ---------- */
section("A · 8 条身份数据齐全且与裁定逐字一致");
const EXPECT = [
  ["陆临崖", "瞻丹", "莫高窟",   "立戈壁危崖之下，对千壁丹青，听风沙诵古。",           "崖观丹壁，风诵千年"],
  ["苏栖盏", "春酲", "花间酒",   "栖繁花深处，持盏浅酌，任落英沾衣，醉而不沉。",       "花间持盏，醉揽芳辰"],
  ["沈青舒", "承霖", "芭蕉叶",   "闲坐蕉阴，青叶承霖，静听一庭夜雨。",                 "蕉叶承雨，静守闲庭"],
  ["谢凝渲", "烟弥", "烟雨墨",   "烟雨入砚，落纸凝渲，笔下漫生云雾。",                 "烟雨研墨，渲染云烟"],
  ["楚柿遥", "秋晏", "柿柿如意", "剑过秋林，丹柿落肩，一笑便扫尽风尘。",               "丹柿随身，笑赴山河"],
  ["萧景筹", "秉衡", "黄金算盘", "案上算珠轻响，谋定世间得失。",                       "筹量万象，掌定盈亏"],
  ["姜饴酌", "淳时", "咸法酪",   "盏中咸酪甘醇，嘴硬不肯道半句喜欢。",                 "咸甘一盏，口硬心柔"],
  ["顾时笙", "书砚", "绿叶",     "窗畔新叶初生，执砚翻书，待人皆是一片赤诚。",         "新叶伴砚，秉心温良"],
];
ok(Array.isArray(IDENT), "app.js 能抽出 SPIRIT_IDENTITIES（抽不到 ⇒ 表不存在）");
if (Array.isArray(IDENT)) {
  ok(IDENT.length === 8, "恰好 8 条（实测 " + IDENT.length + "）");
  EXPECT.forEach((row, i) => {
    const g = IDENT[i] || {};
    const tag = row[0];
    ok(g.name === row[0], tag + " · 姓名逐字一致（实得 " + g.name + "）");
    ok(g.style === row[1], tag + " · 字逐字一致（实得 " + g.style + "）");
    ok(g.bead === row[2], tag + " · 手串名逐字一致（实得 " + g.bead + "）");
    ok(g.poem === row[3], tag + " · 人物诗逐字一致（实得 " + g.poem + "）");
    ok(g.eight === row[4], tag + " · 八字逐字一致（实得 " + g.eight + "）");
  });
}

/* ---------- (b) 反查：手串名 / 旧名 / 额外别名 ---------- */
section("B · 手串名 / 旧名 / 额外别名 能反查到姓名");
ok(typeof lookup === "function", "app.js 能抽出 spiritIdentityOf（真跑反查）");
if (typeof lookup === "function") {
  const pairs = [
    ["莫高窟", "陆临崖"], ["花间酒", "苏栖盏"], ["芭蕉叶", "沈青舒"], ["烟雨墨", "谢凝渲"],
    ["柿柿如意", "楚柿遥"], ["黄金算盘", "萧景筹"], ["咸法酪", "姜饴酌"], ["绿叶", "顾时笙"],
    ["柿宝", "楚柿遥"],     ["金算盘", "萧景筹"],
  ];
  pairs.forEach((p) => {
    const r = lookup(p[0]);
    ok(r && r.name === p[1], "「" + p[0] + "」反查 ⇒ " + p[1] + "（实得 " + (r && r.name) + "）");
  });
  const none = lookup("粉黛熊");
  ok(!none, "未命中（粉黛熊）⇒ null，完全回落（实得 " + (none && none.name) + "）");
  ok(!lookup("") && !lookup(null), "空名字 ⇒ null（不报错）");
}

/* ---------- (c) 姓名位不含手串名 ---------- */
section("C · 详情页姓名位：身份命中显示姓名，⛔ 不显示手串名");
ok(/var SPIRIT_IDENTITIES = \[/.test(APP), "身份表已落地 app.js");
ok(/spiritIdentityOf\(/.test(APP), "详情页按当前显示名反查身份");
// ⚠️ 只钉详情页那一处：renderSpiritOffPage（「只当手串」安全页）本就该显串名，不在本批范围
ok(!/sd-name">' \+ esc\(spiritName\(it, store\)\) \+ '<span class="spirit-stage big">' \+ si\.icon/.test(APP),
  "⛔ 详情页姓名位不再直接吃 spiritName(it, store)");
ok(/'<div class="sd-name">' \+ esc\(nameShown\)/.test(APP), "姓名位改用 nameShown");
ok(/nameShown = \(idCard && !rec\.nameEdited\) \? idCard\.name/.test(APP), "未改名 ⇒ 姓名位用身份表姓名");
ok(/: _disp;/.test(APP), "命中不到 / 用户已改名 ⇒ 回落到当前显示名（⛔ 不留空白）");
ok(/idCard \? "字 " \+ esc\(idCard\.style\)/.test(APP), "身份命中 ⇒ 称号位改显「字 XX」");
ok(/idCard\.poem/.test(APP) && /idCard\.eight/.test(APP), "新增人物诗一行 + 八字一行");

/* ---------- (d) 主线名字条大字优先 castName ---------- */
section("D · 主线名字条大字优先真名（castName），不显示行当设定名");
ok(/const cn = \(m\.w === "me" \|\| m\.w === "sys"\) \? "" : String\(m\.castName \|\| ""\);/.test(APP),
  "先算 cn = m.castName（真名）");
ok(/const nm = \(m\.w === "me"\) \? "我" : \(cn \|\| m\.name \|\| ""\);/.test(APP),
  "大字 = 我 / 真名 / 回落行当名（真名优先）");
ok(/if \(cn && cn !== nm && nm\)/.test(APP), "真名已作大字时 ⛔ 不再挂设定小字");

/* ---------- (e) 立绘别名反查 ---------- */
section("E · MAINCHAR_ART 别名反查（改名后不掉图）");
ok(/var MAINCHAR_ART_ALIAS = \{/.test(APP), "存在 MAINCHAR_ART_ALIAS 别名表");
[["楚柿遥", "柿宝"], ["萧景筹", "金算盘"], ["姜饴酌", "咸法酪"]].forEach((p) => {
  ok(new RegExp('"' + p[0] + '"\\s*:\\s*"' + p[1] + '"').test(APP), "别名 " + p[0] + " → " + p[1]);
});
ok(/MAINCHAR_ART_ALIAS\[nm\]/.test(APP), "maincharArtOf 先查本名、再查别名");

console.log("------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
console.log(FAIL > 0
  ? "⇒ 红测（V175 批次2 落地前为红，属预期）"
  : "⇒ 全绿：V175 批次2 已落地");
process.exit(FAIL > 0 ? 1 : 0);
