/* v165-A 自测：CG 姿势词根因修复（用户描述里的动作词 = 画面里唯一的姿势来源）
 *
 * 用户反馈的根因：
 *   CG 的姿势被「比例锁定块」压死 —— 用户写「右手搭在石桌边沿」，
 *   装配出的 prompt 里却同时有 STAGES[].look 的 "confident pose"、
 *   STAGES[].prop 的 "mature elegant standing pose" 和 "the figure stands at full height, head to feet"、
 *   以及立绘出图单的 "pose: …" → 几股姿势指令互相打架，模型取平均，画出尴尬的半站半坐。
 *
 * 本测试钉住的四件事：
 *   A. 根因确实存在（负向对照）：raw stageDef 里那些姿势词还在 → 证明剥离片段有活干
 *   B. ⛔ 立绘路径一字未动（promptFor 仍带 confident pose / standing pose）
 *   C. stripPose：姿势短语（含"站直"）全被剥掉，且不留 ", ," 残渣
 *   D. cgPropFor 景别驱动：wide 保留 头身比数字 / 时装画锚词 / 腿长；非 wide 只留 head-small + HAIR + 负向
 *   E. cgPromptFromBrief 装配：三条 CG 线（单只/节令/双人）里
 *      · 用户动作词在位
 *      · 无任何竞争姿势短语
 *      · PROPORTION LOCK 恰好一次、且压在 prompt 最末尾
 *      · 非 wide 时不出 "full body visible from head to toe" / 腿长
 *   F. 出图单 pose 在 CG 路径被去掉、立绘路径保留
 *   G. 双人 CG 补回被吞掉的画面描述（storyCgPrompt 旧版收了 sceneText 却从未拼进 prompt）
 *
 * 用法：node docs/_test_v165a_cgpose.js
 */
"use strict";
const H = require("./_harness.js");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const { ok, section, summary, makeContext, loadFile } = H;

const c = makeContext();
loadFile(c.ctx, "js/spirits.js");
const SP = c.sandbox.Spirits;
if (!SP) { console.error("Spirits 未加载"); process.exit(2); }

const item = { id: "it_huajianjiu", name: "花间酒", category: "菩提", species: "星月", color: "浅花", playCount: 9 };
const itemB = { id: "it_qingzhu", name: "青竹", category: "菩提", species: "星月", color: "绿", playCount: 12 };
const look = { outfitZh: "柿红配鹅黄的圆领袍", hairZh: "鸦青", outfitEn: "persimmon round-collar robe", hairEn: "raven-black" };
const lookB = { outfitZh: "竹青直裰", hairZh: "墨绿", outfitEn: "bamboo-green zhiduo", hairEn: "dark green" };

const htmlSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// 竞争姿势短语（"站直" 也含在内）
const COMPETE = /standing pose|confident pose|energetic pose|dramatic pose|stands at full height/i;
const FULLBODY = "full body visible from head to toe";
const ACTION = "右手搭在石桌边沿";

/* ============ A. 根因存在（负向对照） ============ */
section("A. 根因确实存在（raw 阶段文案里的姿势词还在 → 剥离片段有活干）");
ok(SP.stageDef(3).look.indexOf("confident pose") >= 0, "raw 蜕形 look 里确有 'confident pose'（本测试的前提）");
ok(SP.stageDef(2).look.indexOf("energetic pose") >= 0, "raw 开窍 look 里确有 'energetic pose'");
ok(SP.stageDef(3).prop.indexOf("mature elegant standing pose") >= 0, "raw 蜕形 prop 里确有 'mature elegant standing pose'");
ok(SP.stageDef(4).prop.indexOf("mature majestic standing pose") >= 0, "raw 化形 prop 里确有 'mature majestic standing pose'");
ok(SP.stageDef(3).prop.indexOf("the figure stands at full height") >= 0, "raw 蜕形 prop 里确有 'the figure stands at full height'");

/* ============ B. 立绘路径未动 ============ */
section("B. ⛔ 立绘 promptFor 一字不动（姿势词照旧）");
const lv3 = SP.promptFor(item, "anime", 3);
ok(lv3.indexOf("confident pose") >= 0, "立绘 蜕形 仍带 'confident pose'");
ok(lv3.indexOf("mature elegant standing pose") >= 0, "立绘 蜕形 仍带 'mature elegant standing pose'（比例块原样）");

/* ============ C. stripPose 单元 ============ */
section("C. stripPose：姿势短语（含「站直」）全剥掉，不留残渣");
const cases = [
  "a more defined jawline, confident pose, well-tailored outfit",
  "lively bright eyes, energetic pose, still cute",
  "adult body silhouette, mature elegant standing pose; SILHOUETTE RULE: x",
  "SILHOUETTE RULE: x; the legs' length stays visually readable; the figure stands at full height, head to feet; HAIR VOLUME: y",
  "a breathtaking key visual, dramatic pose and camera angle, full body visible",
];
cases.forEach((t, i) => {
  const s = SP.stripPose(t);
  ok(!COMPETE.test(s), "C" + (i + 1) + " · 剥净后无竞争姿势短语：「" + s.slice(0, 60) + "」");
  ok(!/,\s*,/.test(s) && !/;\s*;/.test(s) && !/\s,/.test(s), "C" + (i + 1) + " · 无 ', ,' / '; ;' / ' ,' 残渣");
});
ok(SP.stripPose("a teenage version, about 8 heads tall, slim proportions, confident pose, outfit").indexOf("teenage version") >= 0,
  "C6 · 只剥姿势，正文（年龄/比例描述）不受损");

/* ============ D. cgPropFor 景别驱动 ============ */
section("D. cgPropFor：wide 保留全身比例；近景/半身只留 head-small + 负向");
[3, 4].forEach((st) => {
  const w = SP.cgPropFor(st, { wide: true });
  const n = SP.cgPropFor(st, { wide: false });
  const hc = SP.headCountOf(st);
  ok(!COMPETE.test(w) && !COMPETE.test(n), "阶段" + st + " · wide / 非 wide 都不含姿势词");
  ok(new RegExp(hc + "-heads-tall figure").test(w), "阶段" + st + " · wide 保留 " + hc + " 头身数字锚");
  ok(w.indexOf("fashion-illustration proportions") >= 0 && w.indexOf("runway-model silhouette") >= 0,
    "阶段" + st + " · wide 保留时装画锚词");
  ok(/legs'\s*length\s*stays?\s*visually readable/.test(w), "阶段" + st + " · wide 保留「腿长可读」");
  ok(!new RegExp(hc + "-heads-tall figure").test(n), "阶段" + st + " · 非 wide 去掉 " + hc + " 头身数字锚（只留 head-small）");
  ok(n.indexOf("fashion-illustration proportions") < 0 && n.indexOf("runway-model silhouette") < 0,
    "阶段" + st + " · 非 wide 去掉时装画锚词");
  ok(!/legs'\s*length/.test(n), "阶段" + st + " · 非 wide 去掉「腿长可读」");
  ok(n.indexOf("the figure stands at full height") < 0, "阶段" + st + " · 非 wide 去掉「站直」");
  ok(/head is small in proportion to the body/i.test(n), "阶段" + st + " · 非 wide 保留「头部相对身体要小」");
  ok(/must not visually enlarge the head/.test(n) && /must not hide the body silhouette/.test(n),
    "阶段" + st + " · 非 wide 保留 HAIR VOLUME + 轮廓保护句");
  ok(/no chibi/.test(n) && /no big head/.test(n), "阶段" + st + " · 非 wide 保留强负向");
});
ok(SP.cgPropFor(1, { wide: false }).indexOf("4-heads-tall chibi newborn") >= 0,
  "凝形（Q 版）非 wide 仍保留 chibi 比例锚（⛔ 别把大头也删了）");
ok(SP.cgPropFor(1, { wide: false }).indexOf("no long legs") >= 0,
  "凝形的负向 'no long legs' 未被误删（(?<!no ) 保护生效）");
ok(SP.cgPropFor(2, { wide: false }).indexOf("no tall slender figure") >= 0,
  "开窍的负向 'no tall slender figure' 未被误删");

/* ============ E. 装配：用户动作词是唯一姿势来源 ============ */
section("E. cgPromptFromBrief：三条线都「动作词唯一、无竞争姿势、PROPORTION LOCK 压最末」");
function scanAssembled(tag, p, opts) {
  ok(p.indexOf(ACTION) >= 0 || (opts && opts.text), tag + " · 用户确认的描述/动作词进了 prompt");
  ok(!COMPETE.test(p), tag + " · ⛔ 无任何竞争的姿势短语（confident/standing/energetic/dramatic/站直）");
  const cnt = p.split("PROPORTION LOCK").length - 1;
  ok(cnt === 1, tag + " · PROPORTION LOCK 恰好出现一次（实际 " + cnt + "，防重复拼装）");
  ok(p.trim().lastIndexOf("PROPORTION LOCK") > p.length * 0.85, tag + " · PROPORTION LOCK 压在末尾区");
  return p;
}
const bWide = "它坐在廊下的石桌旁，" + ACTION + "，视线落在院里的落雪上，" + ACTION + " 的手边放着一盏热茶。";
const pWide = scanAssembled("E1 单只·无景别", SP.cgPromptFromBrief(bWide, { kind: "stage", item, stage: 3, look }));
ok(pWide.indexOf(FULLBODY) >= 0, "E1 · 未指定景别 → 回落全身（向后兼容）");
ok(/8-heads-tall figure/.test(pWide), "E1 · wide 保留 8 头身数字锚");

const bNear = "半身入画，近景，它侧身坐着，" + ACTION + "，微微偏头看向檐外。";
const pNear = scanAssembled("E2 单只·近景半身", SP.cgPromptFromBrief(bNear, { kind: "stage", item, stage: 3, look }));
ok(/medium close-up/.test(pNear), "E2 · 「半身/近景」→ medium close-up");
ok(pNear.indexOf(FULLBODY) < 0, "E2 · ⛔ 近景不再出现 'full body visible from head to toe'");
ok(!/legs'\s*length/.test(pNear), "E2 · ⛔ 近景不再出现「腿长可读」");
ok(!/8-heads-tall figure/.test(pNear), "E2 · 近景不再出现全身头身比数字锚");

const pFest = scanAssembled("E3 节令", SP.cgPromptFromBrief("它蹲在门槛边，" + ACTION + "，院子里挂着菖蒲与艾草。",
  { kind: "fest", item, stage: 4, look, fest: { key: "duanwu", name: "端午" } }));
ok(/9-heads-tall figure/.test(pFest), "E3 · 化形节令 CG 保留 9 头身数字锚");

const pPair = scanAssembled("E4 双人", SP.cgPromptFromBrief("两个人一坐一站，一个" + ACTION + "，一个靠着窗框。",
  { kind: "pair", a: { name: "花间酒", look, item }, b: { name: "青竹", look: lookB, item: itemB }, level: 1, roomName: "南窗小间", stage: 3 }));
ok(pPair.indexOf("花间酒") >= 0 && pPair.indexOf("青竹") >= 0, "E4 · 双人 CG 两只都在场");

/* ============ F. 出图单 pose：CG 去掉、立绘保留 ============ */
section("F. 出图单里的 pose：CG 路径剥掉（姿势归画面描述），立绘路径保留");
const bf = SP.toBrief({ gender: "boy", poseZh: "静静站着", outfitZh: "月白长衫", propZh: "柿子", colors: [] });
const lkF = { hairEn: "black", outfitEn: "robe", brief: bf };
const cgF = SP.promptForCg(item, "anime", 3, null, lkF);
const lvF = SP.promptFor(item, "anime", 3, null, lkF);
ok(cgF.indexOf("pose: 静静站着") < 0, "CG 不再带出图单的 'pose: 静静站着'");
ok(lvF.indexOf("pose: 静静站着") >= 0, "立绘仍带出图单的 'pose: 静静站着'（⛔ 未误伤）");
ok(cgF.indexOf("OWNER-CONFIRMED DRAWING SPEC") >= 0, "CG 仍带出图单硬约束（只是少了 pose 那项）");
ok(cgF.indexOf("柿子") >= 0, "CG 出图单里的持物仍在（柿子）");

/* ============ G. 双人 CG 补回被吞掉的画面描述 ============ */
section("G. storyCgPrompt 旧版把 sceneText 吞了 → 现已补回");
const briefPair = "两个人并肩坐在窗边的矮桌前，一盏小灯照着，一只在给另一只递茶。";
const rawPair = SP.storyCgPrompt({ name: "花间酒", look, item }, { name: "青竹", look: lookB, item: itemB }, 1, "南窗小间", briefPair, null);
ok(rawPair.indexOf(briefPair) >= 0, "storyCgPrompt 现在把确认后的画面描述拼进了 prompt");
ok(rawPair.indexOf("standing or sitting side by side") < 0, "不再写死 'standing or sitting side by side'（姿势交给描述）");
ok(rawPair.indexOf("their poses and gestures exactly as the scene describes") >= 0, "改为显式声明「姿势听描述」");

/* ============ H. index.html ?v= 已 bump ============ */
section("H. index.html 资源版本号已 bump（spirits.js 改了）");
const mv = htmlSrc.match(/js\/spirits\.js\?v=(\d+)/);
ok(!!mv && Number(mv[1]) >= 20261221, "js/spirits.js ?v= 已 bump 到 " + (mv && mv[1]) + "（>=20261221）");

const passed = summary();
process.exit(passed ? 0 : 1);
