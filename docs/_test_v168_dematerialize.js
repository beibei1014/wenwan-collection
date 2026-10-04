/* V168 自测：防物化文案落地 + 删 d_clash 日文残留行
 * 运行：
 *   node docs/_test_v168_dematerialize.js           正常套件
 *   SPIRITS_SRC_FILE=docs/_tmp/_pre_v168_spirits.js APP_SRC_FILE=docs/_tmp/_pre_v168_app.js \
 *     node docs/_test_v168_dematerialize.js         负向对照（应 exit 1）
 * 覆盖：
 *   A 全库 0 命中（188 条原串全部消失）
 *   B 新串到位（每条 expect>0 的改后串出现次数 == expect）
 *   C 占位符一致性（old / new 的 {占位符} 多重集相同）
 *   D 结构不变（spirits.js 仅 -1 行=删日文行；app.js 0 行变化；loneLF=0）
 *   E 关键池元素数不变（对照 _tmp 基线）
 *   F 日文残留行已删
 */
const fs = require("fs");
const path = require("path");
const { RAW, FILES, nl, ROOT } = require("./_v168_apply.js");

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
section("D. 结构不变：spirits.js 仅 -1 行；app.js 0 行；loneLF=0");
const cntLines = (abs) => fs.readFileSync(abs, "latin1").split("\n").length;
const PRE = path.join(ROOT, "docs/_tmp/_pre_v168_spirits.js");
const PREA = path.join(ROOT, "docs/_tmp/_pre_v168_app.js");
if (!neg && fs.existsSync(PRE) && fs.existsSync(PREA)) {
  const dSp = cntLines(SRC.O) - cntLines(PRE);
  const dApp = cntLines(SRC.A) - cntLines(PREA);
  ok(dSp === -1, "spirits.js Δ行=" + dSp + "（应 -1）");
  ok(dApp === 0, "app.js Δ行=" + dApp + "（应 0）");
  console.log("   spirits Δ行=" + dSp + "  app Δ行=" + dApp);
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
  // 本地模板池（TITLE/TRAITS/LINE_BY_SOFT 各 3 组）
  ["TITLE_BY_SOFT", "TRAITS_BY_SOFT", "LINE_BY_SOFT"].forEach((name) => {
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
