/* V168 自测：防物化文案落地 + 删 d_clash 日文残留行
 * 运行：
 *   node docs/_test_v168_dematerialize.js           正常套件
 *   SPIRITS_SRC_FILE=docs/_tmp/_pre_v168_spirits.js APP_SRC_FILE=docs/_tmp/_pre_v168_app.js \
 *     node docs/_test_v168_dematerialize.js         负向对照（应 exit 1）
 * 覆盖：
 *   A 全库 0 命中（188 条原串全部消失）
 *   B 新串到位（每条 expect>0 的改后串出现次数 == expect）
 *   C 占位符一致性（old / new 的 {占位符} 多重集相同）
 *   D 行尾纪律（loneLF=0；行数等值断言已随后续批次放宽）
 *   E 关键池元素数不变（对照 _tmp 基线）
 *   F 日文残留行已删
 */
const fs = require("fs");
const path = require("path");
const { RAW, FILES, nl, ROOT } = require("./_v168_apply.js");

// v178：口头禅功能整体移除 —— LINE_BY_SOFT 本地模板池已删，其 5 条去物化「改后串」不再存在于源码。
//   这两行（d1-113..117）的「旧串已消失」仍由 A 段照常校验；B 段的「新串到位」对它们不再适用，跳过。
const V178_GONE_LINES = new Set([
  "你一对我好，我就想腻着你。", "我不用你天天惦记，也会一直在。", "你忙你的，我在这儿等你。",
  "真心经得起等。", "不吵不闹，日子久了就熟了。",
]);

const SRC = {
  O: path.join(ROOT, process.env.SPIRITS_SRC_FILE || FILES.O),
  A: path.join(ROOT, process.env.APP_SRC_FILE || FILES.A),
};
const neg = !!(process.env.SPIRITS_SRC_FILE || process.env.APP_SRC_FILE);
const CUR = { O: fs.readFileSync(SRC.O, "utf8"), A: fs.readFileSync(SRC.A, "utf8") };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("   FAIL: " + m); } };
const section = (t) => console.log("\n# " + t);

// A. 全库 0 命中
section("A. 全库 0 命中：188 条『原文字符串』均不再出现");
const aBad = [];
RAW.forEach((r) => {
  const c = CUR[r[1]].split(nl(r[3])).length - 1;
  if (c !== 0) aBad.push(r[0] + " x" + c);
});
ok(aBad.length === 0, "旧串残留 " + aBad.length + " 条：" + aBad.slice(0, 12).join(", ") + (aBad.length > 12 ? " …" : ""));
console.log("   旧串残留数 = " + aBad.length + " / 188");

// B. 新串到位
section("B. 新串到位：改后串出现次数 >= expect（含被更长新串包含的情形）");
const bBad = [], bInfo = [];
RAW.forEach((r) => {
  if (r[2] === 0) return;
  if (V178_GONE_LINES.has(nl(r[4]))) return;   // v178：池已删，改后串随功能一并移除，B 段不再适用
  const c = CUR[r[1]].split(nl(r[4])).length - 1;
  if (c < r[2]) bBad.push(r[0] + " 期望>=" + r[2] + " 实得" + c);
  else if (c > r[2]) bInfo.push(r[0] + " x" + c);
});
ok(bBad.length === 0, "新串缺失：" + bBad.join(", "));
console.log("   缺失数 = " + bBad.length + "；被更长新串包含而多计：" + (bInfo.join(", ") || "无"));

// C. 占位符保留（old 的占位符必须全部出现在 new；new 可新增 {A}/{B}/{C}）
section("C. 占位符保留：old 的 {占位符} ⊆ new 的 {占位符}");
const gx = (s) => (s.match(/\{[A-Za-z_][A-Za-z0-9_]*\}/g) || []);
const cBad = [], cAdd = [];
RAW.forEach((r) => {
  const a = gx(nl(r[3])), b = gx(nl(r[4]));
  const bSet = new Set(b);
  const lost = a.filter((x) => !bSet.has(x));
  if (lost.length) cBad.push(r[0] + " 丢失" + lost.join(","));
  const aSet = new Set(a);
  b.filter((x) => !aSet.has(x)).forEach((x) => cAdd.push(r[0] + ":" + x));
});
ok(cBad.length === 0, "占位符丢失：" + cBad.join(", "));
console.log("   丢失数 = " + cBad.length + "；新增（{A}/{B}/{C} 等）：" + (cAdd.join(", ") || "无"));

// D. 结构不变
section("D. 行尾纪律：loneLF=0（行数等值断言已随 V169/V170 批次放宽，见下）");
const cntLines = (abs) => fs.readFileSync(abs, "latin1").split("\n").length;
const PRE = path.join(ROOT, "docs/_tmp/_pre_v168_spirits.js");
const PREA = path.join(ROOT, "docs/_tmp/_pre_v168_app.js");
if (!neg && fs.existsSync(PRE) && fs.existsSync(PREA)) {
  const dSp = cntLines(SRC.O) - cntLines(PRE);
  const dApp = cntLines(SRC.A) - cntLines(PREA);
  // 注：内容校验已由 A/B/C/E/F 段覆盖；此处**不再**对 spirits.js / app.js 作「行数等于 V168 基线」的等值断言
  //     —— 后续批次（V169 改 app.js、V170 给 spirits.js 加 imgCut 默认值等）会继续合法改行数，等值断言会误红。
  //     只保留 CRLF/loneLF 校验（行尾纪律才是这里真正要守的东西）。
  console.log("   spirits Δ行=" + dSp + "  app Δ行=" + dApp + "（后续批次会继续改，不作等值断言）");
  [SRC.O, SRC.A].forEach((abs) => {
    const s = fs.readFileSync(abs, "latin1");
    const lone = (s.match(/\n/g) || []).length - (s.match(/\r\n/g) || []).length;
    ok(lone === 0, path.basename(abs) + " loneLF=" + lone + "（应 0）");
  });
} else {
  ok(true, "负向对照 / 无基线：跳过行数对比");
}

// E. 关键池元素数不变
section("E. 关键池元素数不变（对照 _tmp 基线）");
function countBetween(src, startSub, endSub, elemRe) {
  const lines = src.split(/\r?\n/);
  const i = lines.findIndex((l) => l.indexOf(startSub) >= 0);
  if (i < 0) return -1;
  let n = 0;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === endSub) break;
    if (elemRe.test(lines[j])) n++;
  }
  return n;
}
const POOLS = [
  ["FEST_LINES", "const FEST_LINES = {", "};", /^\s+\w+: \[\s*$/],
  ["TOWN_EVENTS", "const TOWN_EVENTS = [", "];", /^\s*\{ icon: "/],
  ["NIGHT_EVENTS", "const NIGHT_EVENTS = [", "];", /id: "f_|id: "d_|id: "r_/],
];
if (!neg && fs.existsSync(PRE)) {
  const preSrc = fs.readFileSync(PRE, "utf8");
  POOLS.forEach(([name, a, b, c]) => {
    const p = countBetween(preSrc, a, b, c);
    const q = countBetween(CUR.O, a, b, c);
    ok(p === q && p >= 0, name + " 元素数 " + p + "→" + q + "（应相等）");
    console.log("   " + name + ": " + p + " → " + q);
  });
  // 本地模板池（TITLE/TRAITS 各 3 组；v178：LINE_BY_SOFT 随口头禅功能一并删除）
  ["TITLE_BY_SOFT", "TRAITS_BY_SOFT"].forEach((name) => {
    const re = new RegExp("^\\s*const " + name + " = \\{", "m");
    ok(re.test(preSrc) && re.test(CUR.O), name + " 声明存在");
  });
} else {
  ok(true, "负向对照 / 无基线：跳过池元素对比");
}

// F. 日文残留行
section("F. d_clash 日文残留行已删");
const jp = "(ないです。开玩笑的。)";
ok(CUR.O.split(jp).length - 1 === 0, "仍残留日文行");
ok(CUR.O.indexOf('{ w: "B", t: "（开玩笑的。）" }') >= 0, "中文那一行应保留");
console.log("   日文残留 = " + (CUR.O.split(jp).length - 1) + "（应 0）；中文行保留 = " + (CUR.O.indexOf('（开玩笑的。）') >= 0));

console.log("\n===== V168 自测" + (neg ? "（负向对照）" : "") + " =====");
console.log("PASS = " + pass + "   FAIL = " + fail);
process.exit(fail ? 1 : 0);
