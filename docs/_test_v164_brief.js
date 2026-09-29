/* v164 自测：设定 → 人设 → 出图单（look.brief）→ 真的进 prompt
   背景（用户原话）：
     「人物形象确认卡没有用，首先是没有根据我的描述进行提取，其次是提取了也不能修改，那让我确认干嘛？
       这是我写的：柿红色的头发高高束起，穿着柿红色搭配鹅黄色的圆领袍，有着明媚笑容的少年郎，手里握着爱吃的柿子。
       这是提取的……除了柿红，没有半毛钱关系。」
   要证明的：
     1. 用户原话里的每一条都被读出来（发色/发型/服饰/配色/持物/神态/性别），一条都不能漏
     2. 随机池的持物（灯笼/花/剑）绝不会顶掉用户写的「柿子」
     3. 确认卡可编辑 → 改过的值真的进 prompt（确认的 == 画的）
     4. 旧版（commit ceb7658 及以前）在本测试上**必须失败** —— 否则这测试是摆设
   用法：node docs/_test_v164_brief.js
         APP_SRC_FILE=<旧版 spirits.js 临时文件> node docs/_test_v164_brief.js   （负向对照，必须 FAIL）
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const h = makeContext();
const SRC_OVERRIDE = process.env.SPIRITS_SRC_FILE || "";
if (SRC_OVERRIDE) {
  // 负向对照：把 spirits.js 换成旧版内容跑同一批断言
  const code = fs.readFileSync(SRC_OVERRIDE, "utf8");
  h.ctx.window = h.ctx;

  // 用 vm 直接跑旧版源（复用 harness 的 sandbox）
  const vm = require("vm");
  vm.runInContext(code, h.ctx, { filename: SRC_OVERRIDE });
  h.sandbox = h.ctx;
} else {
  loadFile(h.ctx, "js/spirits.js");
}

const SP = h.sandbox.Spirits;
if (!SP) { console.error("Spirits 未加载"); process.exit(2); }

// 负向对照闸门：旧版没有这批 API。**不提前退出** —— 让 A~D 段照跑并把内容断言也判失败，
// 这样旧版上既有「缺 API」的失败、也有「提取内容不对」的失败，证据才扎实。
const _need = ["toBrief", "mergeBrief", "briefHard", "applyBrief"];
const _miss = _need.filter((k) => typeof SP[k] !== "function");
const HAS_V164 = _miss.length === 0;
if (!HAS_V164) {
  section("0. v164 API 齐全性（负向对照：旧版应当在这里失败）");
  ok(false, "缺少 v164 API：" + _miss.join("、"));
}

const USER_TEXT = "柿红色的头发高高束起，穿着柿红色搭配鹅黄色的圆领袍，有着明媚笑容的少年郎，手里握着爱吃的柿子";

function mkItem(extra) {
  return Object.assign({
    id: "it_x", name: "柿子手串", category: "菩提", species: "星月",
    color: "棕黄", playCount: 0, softness: "none", createdAt: Date.now() - 86400000 * 30,
  }, extra || {});
}
function mkRec(base) {
  return { look: { base: base, feats: [], pers: "", hairc: "auto" }, gender: "", appearanceSeed: 7 };
}

section("A. 用户原话 → 七项都要读对（这是「没有根据我的描述进行提取」的正面证据）");
{
  const it = mkItem();
  const rec = mkRec(USER_TEXT);
  const d = SP.extractLookBrief(rec, it);

  const hair = (d.colors || []).filter((c) => c.part === "发")[0] || {};
  ok(hair.cn === "柿红", "① 发色读到「柿红」（不是珠子棕黄）：" + hair.cn);
  ok(!!hair.hex, "① 发色带精确色值：" + hair.hex);
  ok(d.hairstyleZh === "高高束起", "② 发型读到「高高束起」（不是被色名顶成「柿红」）：" + d.hairstyleZh);
  ok(!!d.outfitZh && d.outfitZh.indexOf("圆领袍") >= 0, "③ 服饰读到「圆领袍」：" + d.outfitZh);
  ok(!!d.outfitZh && d.outfitZh.indexOf("柿红") >= 0, "③ 服饰颜色带了「柿红」：" + d.outfitZh);
  ok(!!d.outfitZh && d.outfitZh.indexOf("鹅黄") >= 0, "③ 服饰颜色带了「鹅黄」：" + d.outfitZh);
  const outfitCs = (d.colors || []).filter((c) => c.part === "衣").map((c) => c.cn).join("");
  ok(outfitCs.indexOf("柿红") >= 0 && outfitCs.indexOf("鹅黄") >= 0,
    "③ 两个配色都单独列出（不丢「柿红」）：" + outfitCs);
  ok(d.propZh.indexOf("柿子") >= 0, "④ 持物读到「柿子」：" + d.propZh);
  ok(d.feats.map((f) => f.zh).join("").indexOf("明媚笑容") >= 0,
    "⑤ 神态读到「明媚笑容」（不再是「无」）：" + d.feats.map((f) => f.zh).join("、"));
  ok(d.gender === "boy", "⑥ 性别从「少年郎」判成 boy：" + d.gender);
  ok(d.genderWord === "少年郎", "⑥ 记住是哪个词判的：" + d.genderWord);
}

section("B. 服饰字段不能是英文、也不能把整句带跑");
{
  const it = mkItem();
  const d = SP.extractLookBrief(mkRec(USER_TEXT), it);
  ok(!/[a-z]{4,}/.test(d.outfitZh), "服饰是中文字段，没有英文长串：" + d.outfitZh);
  ok(d.outfitZh.indexOf("穿着") !== 0, "开头动词被清掉：" + d.outfitZh);
}

section("C. 没写持物 → 不瞎编（随机池的灯笼/花/剑不许进确认卡）");
{
  const it = mkItem();
  const d = SP.extractLookBrief(mkRec("一个安静的小姑娘，穿着月白长衫"), it);
  ok(d.propZh === "", "没写持物时 propZh 为空（不是随机池里抓一个）：「" + d.propZh + "」");
  ok(!/灯笼|木剑|花枝/.test(d.propZh || ""), "确认卡里没有随机池的灯笼/木剑/花枝");
}

section("D. AI 扩写正文（personaZh）不许被当成人设来源");
{
  const it = mkItem();
  const rec = mkRec("");                       // 用户什么都没写
  rec.personaZh = "她提着一盏灯笼，怀里抱着一枝花，腰间还别着一柄小木剑，最爱吃柿子。";
  const d = SP.extractLookBrief(rec, it);
  ok(d.propZh === "", "personaZh 里的灯笼/花/木剑不算用户要求：" + d.propZh);
  ok((d.colors || []).filter((c) => c.part === "衣").length === 0 || !!d.outfitZh,
    "不因 AI 正文而凭空造出服饰色");
  // 反过来：用户**确认过**的人设（look.persona）必须是提取源
  const rec2 = mkRec("");
  rec2.look.persona = "一个穿着墨绿圆领袍、手里握着柿子的少年郎。";
  const d2 = SP.extractLookBrief(rec2, it);
  ok(d2.propZh.indexOf("柿子") >= 0, "look.persona（用户确认稿）是提取源：" + d2.propZh);
  ok(!!d2.outfitZh && d2.outfitZh.indexOf("圆领袍") >= 0, "从确认稿读到服饰：" + d2.outfitZh);
}

section("E. toBrief：草稿 → 出图单");
if (HAS_V164) try {
  const it = mkItem();
  const d = SP.extractLookBrief(mkRec(USER_TEXT), it);
  const b = SP.toBrief(d);
  ok(b.gender === "boy", "出图单带性别");
  ok(b.propZh === "柿子", "出图单持物=柿子");
  ok(!!b.hairColorHex, "出图单带发色精确值：" + b.hairColorHex);
  ok(!!b.outfitHex, "出图单带衣服色精确值：" + b.outfitHex);
  ok(b.colorsText.indexOf("衣·") >= 0 && b.colorsText.indexOf("发·") >= 0,
    "颜色行按部位合并：" + b.colorsText);
  ok(b.featsText.indexOf("明媚笑容") >= 0, "特征行带神态：" + b.featsText);
} catch (e) { ok(false, "E 段在旧版上不可用：" + e.message); }

section("F. mergeBrief：用户在卡片上改过的值必须盖回来（「提取了也不能改」的反例）");
if (HAS_V164) try {
  const it = mkItem();
  const b0 = SP.toBrief(SP.extractLookBrief(mkRec(USER_TEXT), it));
  const b1 = SP.mergeBrief(b0, {
    outfitZh: "藕荷色的袄裙", propZh: "一枝桂花", extraZh: "背景加一点飘落的柿子叶",
    colorsText: "衣·藕荷(#f0c8cc)；发·柿红(#e0513a)",
  });
  ok(b1.outfitZh === "藕荷色的袄裙", "服饰被改过来了：" + b1.outfitZh);
  ok(b1.propZh === "一枝桂花", "持物被改过来了：" + b1.propZh);
  ok(b1.extraZh.indexOf("柿子叶") >= 0, "补充说明被收下：" + b1.extraZh);
  ok(b1.hairColorHex === "#e0513a", "改过颜色行后仍能抠出准确发色：" + b1.hairColorHex);
  ok(b1.ver === 1 && !!b1.at, "出图单带版本与时间戳");
} catch (e) { ok(false, "F 段在旧版上不可用：" + e.message); }

section("G. 确认的 == 画的：applyBrief 掐掉随机池，briefHard 进 prompt 末尾");
if (HAS_V164) try {
  const it = mkItem();
  const rec = mkRec(USER_TEXT);
  const lk = SP.lookOf(it, rec);
  const b = SP.toBrief(SP.extractLookBrief(rec, it));

  // 不带出图单：随机池的持物/衣服还在（对照）
  const raw = SP.applyBrief(Object.assign({}, lk, { brief: null }), lk.ap);
  ok(!!raw.ap.prop, "对照：没确认出图单时，随机持物仍在：" + raw.ap.prop);

  // 带出图单：冲突项被掐掉，发色/衣服色被覆盖
  const got = SP.applyBrief(Object.assign({}, lk, { brief: b }), lk.ap);
  ok(got.ap.prop === "", "确认后随机持物被掐掉（不然柿子旁边还会多一盏灯）：「" + got.ap.prop + "」");
  ok(got.ap.outfit.indexOf("圆领袍") >= 0, "衣服改用确认单里的：" + got.ap.outfit);
  ok(got.lk.hairHex === b.hairColorHex, "发色 hex 被确认单覆盖：" + got.lk.hairHex);
  ok(/red|vermilion|crimson|persimmon/i.test(got.lk.hairEn || "") || !!got.lk.hairEn,
    "发色英文词被确认单覆盖：" + got.lk.hairEn);
  ok(got.lk.outfitHex === b.outfitHex, "衣服色 hex 被确认单覆盖：" + got.lk.outfitHex);

  const hard = SP.briefHard({ brief: b });
  ok(/OWNER-CONFIRMED DRAWING SPEC/.test(hard), "硬约束块有抬头（模型对这个位置最敏感）");
  ok(hard.indexOf("柿子") >= 0, "硬约束里写了持物柿子");
  ok(hard.indexOf("圆领袍") >= 0, "硬约束里写了圆领袍");
  ok(hard.indexOf(b.hairColorHex) >= 0, "硬约束里写了发色精确值");
  ok(/BOY/.test(hard), "硬约束里标了性别");
  ok(SP.briefHard({ brief: null }) === "", "没有出图单时不产生空硬约束");
} catch (e) { ok(false, "G 段在旧版上不可用：" + e.message); }

section("H. 出图单真的拼进 prompt（promptFor / promptForCg / festCgPrompt）");
if (HAS_V164) try {
  const it = mkItem();
  const rec = mkRec(USER_TEXT);
  const s = SP.load();
  s[it.id] = rec;
  SP.save(s);
  const lk = SP.lookOf(it, rec);
  const b = SP.toBrief(SP.extractLookBrief(rec, it));

  const rec2 = SP.ensureIn(SP.load(), it.id);
  rec2.look.brief = b;
  const s2 = SP.load();                       // load() 每次都是新解析对象，必须重新取一次再写
  SP.ensureIn(s2, it.id).look.brief = b;
  SP.save(s2);
  const lk2 = SP.lookOf(it, SP.load()[it.id]);

  const p1 = SP.promptFor(it, "anime", 1, lk2.ap, lk2);
  ok(p1.indexOf("OWNER-CONFIRMED DRAWING SPEC") >= 0, "promptFor（立绘）带上了出图单");
  ok(p1.indexOf("圆领袍") >= 0 && p1.indexOf("柿子") >= 0, "立绘提示词里有圆领袍和柿子");

  const p2 = SP.promptForCg(it, "anime", 3, lk2.ap, lk2);
  ok(p2.indexOf("OWNER-CONFIRMED DRAWING SPEC") >= 0, "promptForCg（CG）带上了出图单");

  // 对照：没有出图单的普通记录不该出现这段
  const it2 = mkItem({ id: "it_y" });
  const lk3 = SP.lookOf(it2, { look: { base: "一个安静的小姑娘" } });
  const p3 = SP.promptFor(it2, "anime", 1, lk3.ap, lk3);
  ok(p3.indexOf("OWNER-CONFIRMED DRAWING SPEC") < 0, "对照：没确认过出图单的不会插这段");
} catch (e) { ok(false, "H 段在旧版上不可用：" + e.message); }

section("I. 旧记录兼容：没有 look.persona / look.brief 也不能崩");
{
  const it = mkItem();
  const d1 = SP.extractLookBrief({}, it);
  ok(!!d1 && typeof d1.outfitZh === "string", "空记录能提取（不抛异常）");
  const d2 = SP.extractLookBrief({ look: { base: "白猫" } }, it);
  ok(!!d2.poseZh, "没有可提取项时给安全默认 poseZh=" + d2.poseZh);
  const v = SP.validateAnatomy(SP.extractLookBrief({}, it));
  ok(typeof v.ok === "boolean" && Array.isArray(v.issues), "validateAnatomy 结构不变");
}

/* ---------- 标签栈：抓「</div> 写早一个」这类结构性崩塌 ----------
   v163b 线上真的崩过：display:flex row 卡片里 DOM 被拆散 → CJK 文本按 min-content
   塌成 1 字宽竖排。node --check 是抓不住的（字符串语法完全合法），只有标签栈能抓。 */
function tagCheck(html) {
  const stack = [];
  const re = /<(\/?)(div|span|textarea|button|label|p|b)\b[^>]*?(\/?)>/gi;
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
  const balanced = !err && stack.length === 0;
  // 每一行 .cf-row 里必须同时有 .cf-k 和 .cf-v（否则 flex row 会被拆散 → 文字塌竖排）
  const segs = html.split('<div class="cf-row');
  let badRow = 0;
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].indexOf("cf-k") < 0 || segs[i].indexOf("cf-v") < 0) badRow++;
  }
  return {
    ok: balanced, err: err || (stack.length ? "未闭合：" + stack.join(",") : ""),
    rows: segs.length - 1, badRow: badRow,
  };
}
// 把一段源码里所有单/双引号字符串字面量拼起来（HTML 模板都在字符串里）
function stringsOf(region) {
  const out = [];
  const re = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(region))) out.push(m[1] != null ? m[1] : m[2]);
  return out.join("");
}

section("J. 确认卡 HTML 结构（CJK 塌成 1 字宽竖排的经典坑）");
if (HAS_V164) try {
  const it = mkItem();
  const d = SP.extractLookBrief(mkRec(USER_TEXT), it);
  const c1 = tagCheck(SP.renderConfirmCard(d, true));
  ok(c1.ok, "可编辑确认卡标签栈平衡" + (c1.ok ? "" : "：" + c1.err));
  ok(c1.rows === 10, "可编辑卡 8 输入行 + 2 只读行 = 10 行，实际 " + c1.rows);
  ok(c1.badRow === 0, "每行都同时有 cf-k / cf-v（row 不散架），异常行数 " + c1.badRow);
  const c2 = tagCheck(SP.renderConfirmCard(d, false));
  ok(c2.ok, "只读确认卡标签栈平衡" + (c2.ok ? "" : "：" + c2.err));
  ok(c2.rows === 9, "只读卡 7 行 + 2 只读行 = 9 行，实际 " + c2.rows);
  ok(c2.badRow === 0, "只读卡每行结构完整");
  ok(SP.renderConfirmCard(d, true).indexOf('data-cf="propZh"') >= 0, "持物那行真的可编辑");
  ok(SP.renderConfirmCard(d, true).indexOf('data-cf="extraZh"') >= 0, "补充说明那行真的可编辑");
} catch (e) { ok(false, "J 段异常：" + e.message); }

section("K. 三段式弹层的 HTML 拼接（app.js）也必须标签平衡");
try {
  const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const region = (a, b) => {
    const i = appSrc.indexOf(a), j = appSrc.indexOf(b, i + 1);
    if (i < 0 || j < 0) return "";
    return appSrc.slice(i, j);
  };
  const s1 = region("const step1Html = () =>", "renderStep1 = () => {");
  ok(!!s1, "抽到第 1 步模板源码（" + s1.length + " 字符）");
  const t1 = tagCheck(stringsOf(s1));
  ok(t1.ok, "第 1 步模板标签平衡" + (t1.ok ? "" : "：" + t1.err));

  const s2 = region("const runStep2 = async () =>", "const runStep3 = async () =>");
  const t2 = tagCheck(stringsOf(s2));
  ok(t2.ok, "第 2 步（人设确认）模板标签平衡" + (t2.ok ? "" : "：" + t2.err));

  const s3 = region("async function briefPanel", "async function gateLookConfirm");
  const t3 = tagCheck(stringsOf(s3));
  ok(t3.ok, "第 3 步（出图单）模板标签平衡" + (t3.ok ? "" : "：" + t3.err));

  const mBase = s1.match(/<textarea[^>]*id="lkBase"[^>]*>/);
  ok(!!mBase, "第 4 栏是多行 textarea：" + (mBase ? mBase[0].slice(0, 60) : "未找到"));
  ok(!!mBase && mBase[0].indexOf("maxlength") < 0, "第 4 栏**不限字数**（那个 textarea 上没有 maxlength）");
  ok(s2.indexOf("<textarea") >= 0 && s2.indexOf('id="lkPersona"') >= 0, "第 2 步人设是**可编辑**的 textarea");
} catch (e) { ok(false, "K 段异常：" + e.message); }

summary();
