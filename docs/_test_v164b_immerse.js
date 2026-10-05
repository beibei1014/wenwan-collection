/* v164b 自测：把「解释性文字 / 幕后信息」从世界观内的阅读界面清掉（用户要求：减弱沉浸感）
   用户原话：「这些文字，还有一些解释性的文字都去掉，因为会减弱沉浸感」
   截图圈出的是「沁灵详情页 · 人物设定」卡下面那 4 行：
     🔒 男孩 · 金色眼睛 · 丝巾 · 中式对襟褂 + 盘扣立领 · 云纹织锦      ← appearanceText
     🧵 干花瓣小香囊 · 端着木托盘 · 织锦 · 有点酷、有点傲娇            ← appearanceDetail
     🎂 出生于 2 天前 —— 性别在挂瓷开沁那一刻随机定下（男 3 : 女 1）…   ← 机制说明
     🎨 立绘主色取自原串照片：#886848（warm honey amber）              ← 暴露 hex 与技术来源

   判定标准：这段话读起来像**游戏里本来就该有的话**，还是像**产品说明书 / 开发者备注**？
     去掉 → 解释机制、暴露技术细节（hex / 模型 / 本机累计）、讲系统怎么设计
     保留 → 界面按钮、选项标签、空状态引导、报错、设置项说明、**世界内数值**（羁绊/契合度/成长/天数/出图张数）

   用法： node docs/_test_v164b_immerse.js
   负向对照（必须 FAIL，否则测试是摆设）：
     git show b1e086d:js/app.js > "$TMP/app_old.js"
     APP_SRC_FILE="$TMP/app_old.js" node docs/_test_v164b_immerse.js
*/
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const src = fs.readFileSync(SRC_FILE, "utf8");
console.log("源码：" + SRC_FILE);

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

// 按大括号配对抽函数（跳过字符串/注释里的括号）
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error("找不到函数 " + name);
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
// 标签栈（抓「</div> 写早一个」→ display:flex row 被拆散 → CJK 塌成 1 字宽竖排）
function tagCheck(html) {
  const stack = [];
  const re = /<(\/?)(div|span|textarea|button|label|p|b|small|i|em|strong)\b[^>]*?(\/?)>/gi;
  let m, err = "";
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (m[3] === "/") continue;
    if (!closing) stack.push(name);
    else {
      const t = stack.pop();
      if (t !== name) { err = "闭合错配：</" + name + "> 对上 <" + t + ">"; break; }
    }
  }
  return { ok: !err && stack.length === 0, err: err || (stack.length ? "未闭合：" + stack.join(",") : "") };
}
// 抽一段源码里所有字符串字面量拼起来（HTML 模板都在字符串里）
function stringsOf(region) {
  const out = [];
  const re = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(region))) out.push(m[1] != null ? m[1] : m[2]);
  return out.join("");
}

const detailFn = extractFn("renderSpiritDetailPage");

section("A. 圈出来的那 4 行必须消失（幕后信息不许出现在详情页）");
{
  const banned = [
    ["Spirits.appearanceText(ap)", "🔒 那行英文式的形象汇总（appearanceText）"],
    ["Spirits.appearanceDetail(ap)", "🧵 配饰/道具/布料/气质汇总（appearanceDetail）"],
    ["挂瓷开沁那一刻", "🎂 性别为什么是随机定的（机制说明）"],
    ["男 3 : 女 1", "🎂 男女比例规则（数值机制）"],
    ["立绘主色取自原串照片", "🎨 颜色从哪张照片采的（技术来源）"],
    ["立绘主色按颜色分类生成", "🎨 颜色分类兜底说明"],
    ["#886848", "🎨 写死的 hex 色值示例"],
  ];
  banned.forEach(([s, why]) => ok(detailFn.indexOf(s) < 0, "详情页已无：" + why + "（`" + s + "`）"));
  ok(/esc\(bead\.hex\)/.test(detailFn) === false, "详情页不再直接吐 hex 色值");
}

section("B. 成长卡里的机制说明也要去掉");
{
  ok(detailFn.indexOf("本机累计") < 0, "去掉「本机累计 M 张」（App 级统计，不是这只沁灵的事）");
  ok(detailFn.indexOf("换形象/换设定各消耗 1 次出图额度；性别不会变") < 0,
    "去掉括号里的额度机制说明（出图确认卡上已经写了「确认即耗出图额度一」，重复且破坏沉浸）");
  ok(detailFn.indexOf("形象系统升级了") < 0, "去掉「形象系统升级了…」这种版本迁移说明");
  // v174-B3：去物化后「它」→ {ta}（单只语境，renderSpiritDetailPage 末尾统一 fillTa 解析）
  ok(detailFn.indexOf("已为{ta}画过") >= 0, "保留「已为{ta}画过 N 张」—— 这是世界内数值，玩家看得懂");
}

section("C. 「换外观设定」的提示不再吐技术串");
{
  ok(src.indexOf("Spirits.appearanceText(nap)") < 0, "toast 不再拼 appearanceText（👦 男孩 · 金色眼睛 · …）");
}

section("D. 世界内数值 / 功能文案不许被误删（防止一刀切删过头）");
{
  const keep = [
    ["羁绊", "羁绊值是世界内成长数据"],
    ["契合度", "同住契合度是世界内数据"],
    ["今日一签", "签文卡"],
    ["原型手串", "原型手串卡"],
    ["查看手串详情", "功能按钮"],
    ["重画立绘", "功能按钮"],
    ["进房间看看", "功能按钮"],
  ];
  keep.forEach(([s, why]) => ok(detailFn.indexOf(s) >= 0, "保留：" + why + "（`" + s + "`）"));
}

section("E. 结构：改完文案后「人物设定」卡仍然闭合（CJK 塌竖排的老坑）");
{
  // 切片必须落在**字符串字面量的起点**，否则开头被截断 → 多出一个无主的 </div>，成了假阳性
  const litStart = (s, idx) => { for (let i = idx; i >= 0; i--) if (s[i] === "'") return i; return 0; };
  const a0 = detailFn.indexOf("📝 人物设定");
  const b0 = detailFn.indexOf("📿 原型手串");
  ok(a0 > 0 && b0 > a0, "抽到「人物设定」卡的模板区间");
  const card = (a0 > 0 && b0 > a0) ? detailFn.slice(litStart(detailFn, a0), litStart(detailFn, b0)) : "";
  const t = tagCheck(stringsOf(card));
  ok(t.ok, "「人物设定」卡标签栈平衡" + (t.ok ? "" : "：" + t.err));
  ok(stringsOf(card).indexOf('class="look-sum"') >= 0, "「人物设定」卡里还留着那张小归纳条（色点 + 色名 + 标签）");
  ok(stringsOf(card).indexOf('class="sd-look"') < 0, "「人物设定」卡里的技术汇总行（.sd-look）已清空");
}

/* ---------- 其余世界观内界面 ---------- */
const FN = {};
["renderSpiritPage", "renderTownPage", "renderNightPage", "renderThreadPage", "renderRoomPage", "renderSpiritDetailPage"].forEach((n) => {
  try { FN[n] = extractFn(n); } catch (e) { FN[n] = ""; }
});
// 「房间剧情」那段在 renderRoomPage 里用 IIFE 拼的
const iifeStart = FN.renderRoomPage.indexOf("spirit-foot");
function hasIn(fnName, s) { return (FN[fnName] || "").indexOf(s) >= 0; }

section("F. 沁灵首页 / 沁灵巷：空态的机制括号、无成本术语");
{
  ok(FN.renderSpiritPage && FN.renderSpiritPage.indexOf("顺便去给它们标一下软糯程度") < 0,
    "沁灵首页空态去掉「（顺便去给它们标一下软糯程度，形象会跟着变）」");
  // v174-B1b：去物化 —— 原「它就会开沁」去掉拟物主语，改「就会开沁」
  ok(FN.renderSpiritPage && FN.renderSpiritPage.indexOf("把一串盘到「已挂瓷」，就会开沁") >= 0,
    "空态主文案保留");
  ok(!hasIn("renderTownPage", "不花额度"), "沁灵巷「今天的小镇」去掉「· 不花额度」");
  ok(!hasIn("renderTownPage", "+1 契合度"), "沁灵巷去掉「每天 +1 契合度；…当天 +2」这种规则说明");
  ok(!hasIn("renderTownPage", "住满 2 只才会攒契合度"), "沁灵巷去掉「住满 2 只才会攒契合度」");
  ok(hasIn("renderTownPage", "每天换一批"), "保留「每天换一批」（说内容会变，不是机制）");
}

section("G. 夜话：去掉「本地 / 不花额度」这类成本术语");
{
  ok(!hasIn("renderNightPage", "不花额度"), "夜话首页去掉「全程本地，聊多久都不花额度」");
  ok(!hasIn("renderNightPage", "可能发生"), "夜话群条目去掉「· 可能发生 N 件事」");
  ok(!hasIn("renderThreadPage", "都会自己进这个群"), "家庭群去掉「以后每一串开沁，都会自己进这个群」");
  ok(hasIn("renderNightPage", "每个事件都有 <b>3 个结尾</b>"), "保留「每个事件都有 3 个结尾」（吸引语，不是机制）");
  ok(hasIn("renderNightPage", "位成员"), "保留「N 位成员」");
}

section("H. 房间 / 亲密关系 / 房间剧情：去掉解锁门槛与成本术语");
{
  ok(!hasIn("renderRoomPage", "再一起住"), "去掉「再一起住 N 天会有新剧情」");
  ok(!hasIn("renderRoomPage", "解锁第一段剧情"), "去掉「契合度到 7 就会解锁第一段剧情」");
  ok(!hasIn("renderRoomPage", "每天同住 +1"), "去掉「每天同住 +1 契合度…」");
  ok(src.indexOf("剧情由 ") < 0 && src.indexOf("现编）") < 0, "房间剧情去掉「（剧情由 AI / 本地模板 现编）」");
  ok(hasIn("renderRoomPage", "再多住些日子，会有新故事"), "换成沉浸版：「再多住些日子，会有新故事」");
  ok(hasIn("renderRoomPage", "已经是最懂彼此的那一档了"), "保留「已经是最懂彼此的那一档了」");
}

section("I. 保留：设置 / 统计等**功能界面**里的说明不算破坏沉浸");
{
  ok(src.indexOf("本机累计出图") >= 0, "设置页的「本机累计出图 N 张」保留（那是功能页，用户要在那儿看统计）");
  ok(src.length > 100000, "app.js 体量正常（$" + Math.round(src.length / 1024) + "KB）");
}

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAILURES.length) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
