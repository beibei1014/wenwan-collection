/* ============================================================
 * _test_v175_identity.js · V175 批次2「沁灵身份卡 / 主线显示姓名 / 立绘别名」
 * ------------------------------------------------------------
 * ⚠️ 本文件在 **V175 批次2 落地前一直为红测**（red test）。覆盖：
 *      (a) 身份数据齐全、且与主理人裁定**逐字一致**
 *          ⛔ v180-A 起核心团由 8 → 10 条：追加「江冽茗/澄观/冰红茶」「温茸之/朴安/粉黛熊」；
 *          ⛔ v180-E 再加在册同伴 6 条（多多牛/春不晚/油果果/花猫猫/阿豹果/焦糖儿）⇒ 共 16 条。
 *             均**表末追加** ⇒ 前若干条索引不变（本测试按索引 i=0..7 断言原 8 条，
 *             另用 EXPECT_V180 覆盖 i=8..15 共 8 条）。
 *      (b) 手串名 / 旧名 / 额外别名能反查到姓名（柿宝→楚柿遥、金算盘→萧景筹、
 *          冰红茶→江冽茗、粉黛熊→温茸之、多多牛→邵盈牧、春不晚→季未晚、油果果→俞酥棠、
 *          花猫猫→戚衔蝉、阿豹果→乔纹栗、焦糖儿→闵琥珀）
 *      (c) 身份命中时详情页姓名位显示「姓名」，⛔ 不再显示手串名
 *      (d) 主线名字条大字优先 castName（真名），不再显示行当设定名
 *      (e) MAINCHAR_ART 别名反查（楚柿遥/萧景筹/姜饴酌/温茸之 → 柿宝/金算盘/咸法酪/粉黛熊）
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

/* ---------- (a) 身份数据 · 逐字一致（v180：核心团 8 → 10 条） ---------- */
section("A · 身份数据齐全且与裁定逐字一致（v180：8 → 10 条）");
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
// v180 追加 8 条（⛔ 表末追加 i=8..15：v180-A 的核心团 2 只 + v180-E 的在册同伴 6 只，
//   前 8 条 i=0..7 索引不受影响）
const EXPECT_V180 = [
  ["江冽茗", "澄观", "冰红茶", "冰瓯浮丹，微甘入喉，懒问人间谁负谁。",                 "冰瓯澄观，懒看浮生"],
  ["温茸之", "朴安", "粉黛熊", "一团茸软，憨坐檐前，谁唤他一声便笑；谁的好，他记半生。", "茸憨抱朴，安之若素"],
  // v180-E · 在册同伴第二批 6 只（用户 2026-10-08 23:12→23:14 全部确认，逐字）
  ["邵盈牧", "敦之", "多多牛", "牧过一坡青草，牵回满车谷穗，问他累不累，只憨憨一笑。", "盈牧敦行，力憨福满"],
  ["季未晚", "逢春", "春不晚", "春来不晚，人归不迟，花信如期，灯下相候。",             "春迟不晚，花信如期"],
  ["俞酥棠", "怀糯", "油果果", "棠梨酥透，揣在兜里，谁心里发苦就先分谁一口。",         "酥棠怀糯，甜净长伴"],
  ["戚衔蝉", "卧花", "花猫猫", "衔蝉卧花一晌，谁的东西丢了，他一蹿就叼回。",           "衔蝉眠花，慵而能捷"],
  ["乔纹栗", "掠云", "阿豹果", "一身锦纹掠过云头，摘来的野果，回头塞给最累的。",       "纹豹掠云，野而护人"],
  ["闵琥珀", "守灯", "焦糖儿", "一身三花琥珀色的眼，夜里蹲在你门口，等你平安回来。",   "琥珀三花，暖守长夜"],
];
ok(Array.isArray(IDENT), "app.js 能抽出 SPIRIT_IDENTITIES（抽不到 ⇒ 表不存在）");
if (Array.isArray(IDENT)) {
  // ⛔ 断言强度不降：原「恰好 8 条」为了让路给 v180 扩员，放宽为下界 >=8；
  //    随即补 >=10（v180-A 核心团）与 >=16（v180-E 在册同伴 6 只）+ EXPECT_V180 对新增 8 条
  //    做 5 字段逐字断言 ⇒ 覆盖只增不减。
  ok(IDENT.length >= 8, "至少 8 条（v180 起核心团 10 + 在册同伴 6；实测 " + IDENT.length + "）");
  ok(IDENT.length >= 10, "v180-A · 核心团 10 条已到齐（实测 " + IDENT.length + "）");
  ok(IDENT.length >= 16, "v180-E · 在册同伴 +6 已入表，共 16 条（实测 " + IDENT.length + "）");
  const check = (rows, base) => rows.forEach((row, i) => {
    const g = IDENT[base + i] || {};
    const tag = row[0];
    ok(g.name === row[0], tag + " · 姓名逐字一致（实得 " + g.name + "）");
    ok(g.style === row[1], tag + " · 字逐字一致（实得 " + g.style + "）");
    ok(g.bead === row[2], tag + " · 手串名逐字一致（实得 " + g.bead + "）");
    ok(g.poem === row[3], tag + " · 人物诗逐字一致（实得 " + g.poem + "）");
    ok(g.eight === row[4], tag + " · 八字逐字一致（实得 " + g.eight + "）");
  });
  check(EXPECT, 0);       // i=0..7 原 8 条
  check(EXPECT_V180, 8);  // i=8..15 v180 新增 8 条
}

/* ---------- (b) 反查：手串名 / 旧名 / 额外别名 ---------- */
section("B · 手串名 / 旧名 / 额外别名 能反查到姓名");
ok(typeof lookup === "function", "app.js 能抽出 spiritIdentityOf（真跑反查）");
if (typeof lookup === "function") {
  const pairs = [
    ["莫高窟", "陆临崖"], ["花间酒", "苏栖盏"], ["芭蕉叶", "沈青舒"], ["烟雨墨", "谢凝渲"],
    ["柿柿如意", "楚柿遥"], ["黄金算盘", "萧景筹"], ["咸法酪", "姜饴酌"], ["绿叶", "顾时笙"],
    ["柿宝", "楚柿遥"],     ["金算盘", "萧景筹"],
    // v180：核心团扩员 —— 冰红茶 / 粉黛熊 已入身份表，须能反查到正式姓名
    ["冰红茶", "江冽茗"],   ["粉黛熊", "温茸之"],
    // v180-E：在册同伴第二批 6 只（手串名 ⇒ 姓名）
    ["多多牛", "邵盈牧"],   ["春不晚", "季未晚"],   ["油果果", "俞酥棠"],
    ["花猫猫", "戚衔蝉"],   ["阿豹果", "乔纹栗"],   ["焦糖儿", "闵琥珀"],
  ];
  pairs.forEach((p) => {
    const r = lookup(p[0]);
    ok(r && r.name === p[1], "「" + p[0] + "」反查 ⇒ " + p[1] + "（实得 " + (r && r.name) + "）");
  });
  // v180：粉黛熊 已被身份表命中（⇒ 温茸之），多多牛 亦已在 v180-E 入表（⇒ 邵盈牧）。
  //       原「未命中探针」改用真·未登记名「紫砂壶」，守「未命中 ⇒ null」这条语义（⛔ 非删断言、是换样本）。
  const hit = lookup("粉黛熊");
  ok(hit && hit.name === "温茸之", "粉黛熊 ⇒ 温茸之（v180 起入表；实得 " + (hit && hit.name) + "）");
  const hit2 = lookup("多多牛");
  ok(hit2 && hit2.name === "邵盈牧", "多多牛 ⇒ 邵盈牧（v180-E 起入表；实得 " + (hit2 && hit2.name) + "）");
  const none = lookup("紫砂壶");
  ok(!none, "未命中（紫砂壶）⇒ null，完全回落（实得 " + (none && none.name) + "）");
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
[["楚柿遥", "柿宝"], ["萧景筹", "金算盘"], ["姜饴酌", "咸法酪"], ["温茸之", "粉黛熊"]].forEach((p) => {
  ok(new RegExp('"' + p[0] + '"\\s*:\\s*"' + p[1] + '"').test(APP), "别名 " + p[0] + " → " + p[1]);
});
ok(/MAINCHAR_ART_ALIAS\[nm\]/.test(APP), "maincharArtOf 先查本名、再查别名");

console.log("------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
console.log(FAIL > 0
  ? "⇒ 红测（V175 批次2 落地前为红，属预期）"
  : "⇒ 全绿：V175 批次2 已落地");
process.exit(FAIL > 0 ? 1 : 0);
