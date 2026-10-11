/* v180-AGE · 化形年龄档自测（主人写年龄 ⇒ 头身比跟年龄走）
   口径（2026-10-12 用户裁定）：
   · 设定向导/出图单里写了**数字年龄** ⇒ 化形按年龄档出头身比与脸锚（十七八岁→7头身清秀少年脸；二十来岁→8头身）
   · 不写数字年龄 ⇒ 维持旧行为（9 头身成年，handsome mature face）
   · legacy（恢复旧立绘）路径不受年龄档影响（逐字节复刻旧 prompt）
   · 蜕形档联动 = 化形档数字 −0.5
   负向对照铆定：docs/_tmp/_pre_ageband_spirits.js（改动前快照）⇒ 新断言在快照上必须全红。
   用法： node docs/_test_v180_ageband.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");
const ROOT = path.join(__dirname, "..");

const SNAP = path.join(__dirname, "_tmp/_pre_ageband_spirits.js");

function loadSpirits(srcFile) {
  const h = makeContext();
  loadFile(h.ctx, "js/night-v180.js");
  if (srcFile) {
    const code = fs.readFileSync(srcFile, "utf8");
    vm.runInContext(code, h.ctx, { filename: path.basename(srcFile) });
  } else {
    loadFile(h.ctx, "js/spirits.js");
  }
  return h;
}

function mkItem(store, base) {
  store["it1"] = {
    stage: 4, gender: "boy", bornAt: Date.now(), playCount: 30,
    id: "it1", name: "测试串", color: "red", species: "金刚菩提", category: "菩提",
    look: { base: base || "", profile: "", persona: "" },
    persona: { name: "小测", title: "守珠人", line: "陪你", traits: ["安静"] },
  };
  return JSON.parse(JSON.stringify(store)) && JSON.parse(JSON.stringify({
    id: "it1", name: "测试串", color: "red", species: "金刚菩提", category: "菩提", playCount: 30,
  }));
}

let FAIL = 0;
function chk(c, m) { if (!c) FAIL++; console.log("  " + (c ? "✅" : "❌") + " " + m); }

/* ============ A · 解析器 ============ */
section("A · finalAgeBandOf 数字年龄解析");
{
  const h = loadSpirits(null);
  const S = h.sandbox.Spirits;
  const f = S.finalAgeBandOf;
  chk(f && f("一个十七八岁的少年") && f("一个十七八岁的少年").ratio === 7 && f("一个十七八岁的少年").zh === "十七八岁",
    "「十七八岁的少年」→ 7 头身 · 十七八岁档");
  chk(f("二十来岁的青年") && f("二十来岁的青年").ratio === 8, "「二十来岁」→ 8 头身");
  chk(f("他约十四五岁") && f("他约十四五岁").ratio === 6.5, "「十四五岁」→ 6.5 头身");
  chk(f("二十八岁的男子") && f("二十八岁的男子").ratio === 8,
    "「二十八岁」→ 8 头身（⛔ 不被「十八」误命中成 7）");
  chk(f("三十而立的中年人") && f("三十而立的中年人").ratio === 9, "「三十而立/中年」→ 9 头身");
  chk(f("性格温和的少年感") === null, "泛称「少年感」不触发（只认数字年龄）");
  chk(f("") === null && f(null) === null, "空文本 → null");
}

/* ============ B · 覆盖三件套（对 STAGES 本体做精确子串替换） ============ */
section("B · bandStageLook / bandPropLock / bandZhAnchor");
{
  const h = loadSpirits(null);
  const S = h.sandbox.Spirits;
  const hua = S.STAGES[3], tui = S.STAGES[2];
  const b17 = S.finalAgeBandOf("十七八岁的少年");
  const look4 = S.bandStageLook(4, hua.look, b17);
  chk(look4.indexOf("about 7 heads tall") >= 0, "化形形态描述 → about 7 heads tall");
  chk(look4.indexOf("seventeen or eighteen") >= 0, "化形形态描述带十七八岁脸锚");
  chk(look4.indexOf(S.HUAL_LEAD) < 0, "⛔ fully grown adult 引导句已被替换");
  const prop4 = S.bandPropLock(4, hua.prop, b17);
  chk(prop4.indexOf("7-heads-tall") >= 0 && prop4.indexOf("9-heads-tall") < 0, "化形比例锁 → 7-heads-tall，无 9 残留");
  chk(prop4.indexOf("AGE LOCK") >= 0 && prop4.indexOf("十七八岁") >= 0, "AGE LOCK 年龄句在场");
  chk(prop4.indexOf("mature majestic") < 0 && prop4.indexOf("mature and beautiful") < 0, "⛔ mature majestic / mature and beautiful 已被替换");
  const zh4 = S.bandZhAnchor(4, S.proportionZhFor(4), b17);
  chk(zh4.indexOf("约为头高的7倍") >= 0 && zh4.indexOf("十七八岁") >= 0, "中文锚 → 7 倍 + 十七八岁");
  chk(zh4.indexOf("绝不是中年成年人的脸") >= 0, "中文锚含「绝不是中年成年人的脸」");
  const look3 = S.bandStageLook(3, tui.look, b17);
  chk(look3.indexOf("about 6.5 heads tall") >= 0 && look3.indexOf("younger than the final form") >= 0,
    "蜕形联动 → 6.5 头身 + 比最终形态年幼");
  const prop3 = S.bandPropLock(3, tui.prop, b17);
  chk(prop3.indexOf("6.5-heads-tall") >= 0 && prop3.indexOf("8-heads-tall") < 0, "蜕形比例锁 → 6.5-heads-tall");
  const zh3 = S.bandZhAnchor(3, S.proportionZhFor(3), b17);
  chk(zh3.indexOf("约为头高的6.5倍") >= 0, "蜕形中文锚 → 6.5 倍");
}

/* ============ C · 端到端 promptFor（真跑，ark 中文锚开） ============ */
section("C · 端到端 promptFor（化形/蜕形 + 无年龄回落 + legacy 隔离）");
function e2e(srcFile, expectNew) {
  const h = loadSpirits(srcFile || null);
  const S = h.sandbox.Spirits;
  S.setImageCfg({ provider: "ark" });
  const store = {};
  const item = (() => {
    store["it1"] = {
      stage: 4, gender: "boy", bornAt: Date.now(), playCount: 30,
      look: { base: "一个十七八岁的少年，身姿挺拔", profile: "", persona: "" },
      persona: { name: "小测", title: "守珠人", line: "陪你", traits: ["安静"] },
    };
    h.sandbox.localStorage.setItem("ww_spirits", JSON.stringify(store));
    return { id: "it1", name: "测试串", color: "red", species: "金刚菩提", category: "菩提", playCount: 30 };
  })();

  const p4 = S.promptFor(item, "anime", 4);
  chk((p4.indexOf("about 7 heads tall") >= 0) === expectNew,
    (expectNew ? "✅" : "（对照·应红）") + " 化形 prompt 含 about 7 heads tall");
  chk((p4.indexOf("a tall youth of about seventeen or eighteen") >= 0) === expectNew,
    (expectNew ? "✅" : "（对照·应红）") + " 化形开场脸锚 = 十七八岁少年");
  chk((p4.indexOf("AGE LOCK") >= 0) === expectNew, (expectNew ? "✅" : "（对照·应红）") + " 化形 prompt 含 AGE LOCK");
  chk((p4.indexOf("约为头高的7倍") >= 0) === expectNew, (expectNew ? "✅" : "（对照·应红）") + " 化形中文锚 = 7 倍");
  chk((p4.indexOf("9-heads-tall") < 0) === expectNew, (expectNew ? "✅" : "（对照·应红）") + " 化形 prompt 无 9-heads-tall 残留");
  chk((p4.indexOf("handsome mature face") < 0) === expectNew, (expectNew ? "✅" : "（对照·应红）") + " ⛔ handsome mature face 已被换掉");
  chk((p4.indexOf("mature and beautiful") < 0) === expectNew, (expectNew ? "✅" : "（对照·应红）") + " ⛔ the face may be mature and beautiful 已被换掉");

  const p3 = S.promptFor(item, "anime", 3);
  chk((p3.indexOf("about 6.5 heads tall") >= 0 && p3.indexOf("约为头高的6.5倍") >= 0) === expectNew,
    (expectNew ? "✅" : "（对照·应红）") + " 蜕形联动 6.5 头身（英文 + 中文锚）");

  // 无年龄 → 旧行为（9 头身成年）必须保留
  store["it1"].look = { base: "性格温和，喜欢安静", profile: "", persona: "" };
  h.sandbox.localStorage.setItem("ww_spirits", JSON.stringify(store));
  const p4plain = S.promptFor(item, "anime", 4);
  chk(p4plain.indexOf("9-heads-tall") >= 0 && p4plain.indexOf("handsome mature face") >= 0 && p4plain.indexOf("AGE LOCK") < 0,
    "无数字年龄 → 维持旧行为（9 头身成年，无 AGE LOCK）");

  // legacy → 不受年龄档影响
  store["it1"].look = { base: "一个十七八岁的少年", profile: "", persona: "" };
  h.sandbox.localStorage.setItem("ww_spirits", JSON.stringify(store));
  const p4leg = S.promptFor(item, "anime", 4, null, null, { legacy: true });
  chk(p4leg.indexOf("magnificent ornate ceremonial outfit") >= 0 && p4leg.indexOf("AGE LOCK") < 0,
    "legacy 恢复旧立绘 → 旧 prompt 逐字节口径，无 AGE LOCK");
}
e2e(null, true);

/* ============ D · 负向对照（铆定改动前快照：上面 C 组必须全红） ============ */
section("D · 负向对照（快照 " + path.basename(SNAP) + "：C 组断言必须全红）");
if (fs.existsSync(SNAP)) {
  e2e(SNAP, false);
} else {
  // 快照在 gitignore 的 docs/_tmp/ 下，换机器会缺 —— 跳过即可（本批已完成过一次权威负向对照：2026-10-12 快照上 C 组全红）。
  console.log("  ⚠️ 快照缺失，负向对照跳过（权威对照已于 2026-10-12 执行：改动前快照上 C 组 8 项全红）");
}

/* ============ E · 静态断言 ============ */
section("E · 源码静态（AGE_BANDS 在场 + 导出 + STAGES 本体零改动）");
{
  const src = fs.readFileSync(path.join(ROOT, "js/spirits.js"), "utf8");
  const pre = fs.readFileSync(SNAP, "utf8");
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  chk(strip(src).indexOf("AGE_BANDS") >= 0, "代码（非注释）含 AGE_BANDS");
  chk(src.indexOf("AGE_BANDS, finalAgeBandOf") >= 0, "window.Spirits 已导出年龄档 API");
  chk(pre.indexOf("AGE_BANDS") < 0, "快照源码无 AGE_BANDS（对照真实）");
  // STAGES 本体零改动：四条 look/prop 原文逐字节仍在
  chk(src.indexOf("a fully grown adult version of the same character, about 9 heads tall, elegantly tall adult proportions, ") >= 0,
    "⛔ STAGES 化形 look 本体一字未改（HUAL_LEAD 是它的精确子串）");
  chk(src.indexOf("mature majestic standing pose") >= 0, "⛔ STAGES 化形 prop 本体 mature majestic 仍在（运行时才替换）");
  chk(src.indexOf("a teenage version of the character, about 8 heads tall") >= 0, "⛔ STAGES 蜕形 look 本体未改");
}

console.log("------------------------------------------------------------");
summary();
process.exit(FAIL ? 1 : 0);
