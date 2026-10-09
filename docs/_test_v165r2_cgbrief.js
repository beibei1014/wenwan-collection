/* v165-R2 自测：CG「描述先行」三段式
 *
 * 用户裁定原话：「CG 再出之前你先出一段关于这个 CG 的描述，依然是让我确认和修改，
 *   确定 OK 了再从描述里面进行提取出图的关键词，再手动出图。」
 *
 * 本测试钉住四件事：
 *   ⓪ 描述生成：cgBrief（文本模型；无 key / 失败 → cgBriefLocal 本地模板，**永不抛错**）
 *   ① 描述可编辑、确认后写盘：rec.cgBrief / rec.fests[dk].brief / Rooms.setStoryBrief
 *   ② 提取关键词 → 装配 prompt：cgKeywords（无 key → ""）+ cgPromptFromBrief
 *      —— CG_STYLE / ANATOMY / CONSISTENCY / BG_NEG / PROPORTION LOCK **一律照带**，
 *         且 PROPORTION LOCK 永远压在最末尾（不被描述与负向块挤走）
 *   ③ ⛔ CG 绝不自动出图：ensureSpiritCg 欠图 continue；tickRooms 不再自动画双人 CG；
 *      app.js 里 CG 的出图点只剩 drawCgFromBrief（+ 主线 retryMissingCg，P2 冻结不动）
 *
 * 用法：node docs/_test_v165r2_cgbrief.js
 */
"use strict";
const H = require("./_harness.js");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const { ok, section, summary, makeContext, loadFile } = H;

const item = {
  id: "it_huajianjiu", name: "花间酒", category: "菩提", species: "星月",
  color: "浅花", playCount: 9, softness: "slight",
  createdAt: Date.now() - 86400000 * 24,
};
const itemB = {
  id: "it_qingzhu", name: "青竹", category: "菩提", species: "星月",
  color: "绿", playCount: 12, softness: "soft",
  createdAt: Date.now() - 86400000 * 40,
};
const look = { outfitZh: "柿红配鹅黄的圆领袍", hairZh: "鸦青", outfitEn: "persimmon round-collar robe", hairEn: "raven-black" };
const lookB = { outfitZh: "竹青直裰", hairZh: "墨绿", outfitEn: "bamboo-green zhiduo", hairEn: "dark green" };

const { S } = (function () {
  const c = makeContext();
  loadFile(c.ctx, "js/spirits.js");
  return { S: c.sandbox.Spirits };
})();
const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const roomsSrc = fs.readFileSync(path.join(ROOT, "js/rooms.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// 世界观判据：描述里不许出现「游戏怎么做的」这类技术信息
const TECH = /模型|API|额度|出图|#|hex|按钮|v1\d|prompt/i;

(async function main() {
  /* ============ A. ⓪ 描述生成 ============ */
  section("A. ⓪ 生成中文画面描述（无 key → 本地模板，永不抛错）");
  const b1 = await S.cgBrief({ kind: "stage", item: item, stage: 3, look: look, persona: { title: "记账的那只" } });
  ok(typeof b1 === "string" && b1.length >= 30, "单只 CG 描述非空（" + (b1 || "").length + " 字）");
  ok(!TECH.test(b1), "描述里没有技术词（模型/API/额度/出图/hex/按钮）");
  const b2 = await S.cgBrief({ kind: "pair", a: { name: "花间酒", look: look }, b: { name: "青竹", look: lookB }, level: 1, roomName: "南窗小间", storyText: "它们把最好的那块光让给了对方。" });
  ok(b2.indexOf("花间酒") >= 0 && b2.indexOf("青竹") >= 0, "双人 CG 描述里两只都在场");
  const b3 = await S.cgBrief({ kind: "fest", item: item, stage: 4, look: look, festName: "端午", festScene: "院子里的菖蒲与艾草" });
  ok(b3.indexOf("端午") >= 0, "节令 CG 描述带上节令");
  ok(S.cgBriefLocal({ kind: "stage", item: item, stage: 1 }).length >= 30, "cgBriefLocal 兜底模板可用");

  section("B. 描述的事实清单只给世界观内素材");
  const facts = S.cgBriefFacts({ kind: "stage", item: item, stage: 3, look: look, persona: { title: "记账的那只" } });
  ok(facts.indexOf("柿红配鹅黄的圆领袍") >= 0, "事实清单带上服饰意象");
  ok(facts.indexOf("蜕形") >= 0, "事实清单带上形态（蜕形）");
  ok(!TECH.test(facts), "事实清单里没有技术词");
  ok(S.CG_BRIEF_SYS.indexOf("不许出现模型名") >= 0, "系统提示词明令禁止技术信息");

  /* ============ C. ② 关键词提取 ============ */
  section("C. ② 从确认后的描述提取出图关键词（无 key → 空串，不抛错）");
  const kw0 = await S.cgKeywords("一只小猫坐在院子里晒太阳。", { kind: "stage" });
  ok(kw0 === "", "无文本 key 时 cgKeywords 返回空串（回落直附中文描述）");

  /* ============ D. prompt 装配：固定块一律照带 + PROPORTION LOCK 在最末 ============ */
  section("D. 装配英文 prompt：CG_STYLE / ANATOMY / CONSISTENCY / BG_NEG / PROPORTION LOCK 一律照带");
  // v165-A：比例块改走 cgPropFor(stage, shot)（去姿势化 + 景别驱动），不再是 stageDef().prop 原样。
  const propOf = (st, text) => S.cgPropFor(st, S.shotClause(text || ""));
  const p1 = S.cgPromptFromBrief(b1, { kind: "stage", item: item, stage: 3, look: look });
  ok(p1.indexOf("PROPORTION LOCK") >= 0, "单只 CG 带 PROPORTION LOCK");
  ok(p1.indexOf("same character across all ages") >= 0, "单只 CG 带 CONSISTENCY");
  ok(p1.indexOf("no horror") >= 0 && p1.indexOf("no Japanese elements") >= 0, "单只 CG 带 BG_NEG（禁恐怖 + 禁日式）");
  ok(p1.indexOf("exactly two arms and two hands") >= 0, "单只 CG 带 ANATOMY");
  ok(p1.indexOf("key visual CG illustration") >= 0 || p1.indexOf("CG illustration") >= 0, "单只 CG 带 CG_STYLE");
  ok(p1.indexOf(b1.slice(0, 12)) >= 0, "确认后的**中文描述**进了 prompt（无关键词时直附）");
  const prop3 = propOf(3, b1);
  ok(p1.trim().endsWith(prop3.trim()), "PROPORTION LOCK 压在最末尾（去姿势化的比例块）");
  ok(p1.split("PROPORTION LOCK").length - 1 === 1, "比例块只出现一次（不重复拼装）");
  ok(!/standing pose|confident pose/i.test(p1), "v165-A：装配出的 prompt 不含竞争姿势短语");

  // v180-CG：抱胸姿势 → 三条打架的 anatomy 子句应被删，且 "exactly two arms and two hands" 必须保留（真模块端到端）
  const pArm = S.cgPromptFromBrief("它双手怀抱在胸前，半身入画，近景，暖光融融。", { kind: "stage", item: item, stage: 3, look: look });
  ok(pArm.indexOf("both hands resting naturally and unobstructed") < 0, "v180 · 抱胸时删掉 'both hands resting naturally and unobstructed'");
  ok(pArm.indexOf("no hidden overlapping arms") < 0, "v180 · 抱胸时删掉 'no hidden overlapping arms'");
  ok(pArm.indexOf("the other hand is empty, relaxed, unobstructed and fully visible") < 0, "v180 · 抱胸时删掉 'the other hand is empty … fully visible'");
  ok(pArm.indexOf("exactly two arms and two hands") >= 0, "v180 · 仍保留 'exactly two arms and two hands'（不可删）");
  const pCalm = S.cgPromptFromBrief("它安静地站在院子里，微微侧身。", { kind: "stage", item: item, stage: 3, look: look });
  ok(pCalm.indexOf("both hands resting naturally and unobstructed") >= 0, "v180 · 非抱胸姿势时 anatomy 子句原样保留（不误删）");
  // v180-CG：西域 → 异域支线（默认汉服守卫被换掉，去清代强禁仍在）
  const pExo = S.cgPromptFromBrief("一位从西域来的少年，身着西域古风常服，抱臂而立。", { kind: "stage", item: item, stage: 3, look: look });
  ok(pExo.indexOf("jiaoling youren") < 0, "v180 · 西域 → 不再强制「交领右衽(jiaoling youren)」");
  ok(pExo.indexOf("an ancient foreign-region (western-region / nomadic frontier) inspired costume") >= 0, "v180 · 西域 → 换上异域守卫");
  ok(pExo.indexOf(S.NO_QING) >= 0, "v180 · 西域 → 去清代强禁（NO_QING）仍在");
  ok(pExo.indexOf("strictly no modern or Western clothing") < 0, "v180 · 西域 → 去掉 'no modern or Western clothing'（免得西域被读成 Western）");

  const KW1 = "a red-robed boy, standing by the well, warm dusk light";
  const p1k = S.cgPromptFromBrief(b1, { kind: "stage", item: item, stage: 3, look: look, keywords: KW1 });
  ok(p1k.indexOf(KW1) >= 0, "有英文关键词时优先用关键词");
  ok(p1k.trim().endsWith(propOf(3, b1 + " " + KW1).trim()), "带关键词时 PROPORTION LOCK 仍在最末尾");

  const p2 = S.cgPromptFromBrief(b2, {
    kind: "pair", a: { name: "花间酒", look: look, item: item }, b: { name: "青竹", look: lookB, item: itemB },
    level: 1, roomName: "南窗小间", stage: 3,
  });
  ok(p2.indexOf("花间酒") >= 0 && p2.indexOf("青竹") >= 0, "双人 CG 两只都在 prompt 里");
  ok(p2.indexOf("PROPORTION LOCK") >= 0 && p2.trim().endsWith(propOf(3, b2).trim()), "双人 CG 也带 PROPORTION LOCK 且在末尾");
  ok(p2.indexOf("same character across all ages") >= 0, "双人 CG 也带 CONSISTENCY");

  const p3 = S.cgPromptFromBrief(b3, { kind: "fest", item: item, stage: 4, look: look, fest: { key: "duanwu", name: "端午" } });
  ok(p3.indexOf("PROPORTION LOCK") >= 0 && p3.trim().endsWith(propOf(4, b3).trim()), "节令 CG 带 PROPORTION LOCK 且在末尾（化形 9 头身）");
  ok(p3.indexOf("no horror") >= 0, "节令 CG 带 BG_NEG");

  /* ============ E. ⛔ CG 绝不自动出图 ============ */
  section("E. ⛔ CG 绝不自动出图（app.js 静态闸门）");
  ok(appSrc.indexOf("if (!rec.cgUrl) continue;") >= 0, "ensureSpiritCg：欠图 continue（与 M 批次 stageImgPending 同口径）");
  ok(appSrc.indexOf("Spirits.promptForCg(it, null, stage, ap)") < 0, "ensureSpiritCg 里那条自动出图已删除");
  ok(appSrc.indexOf("storyCgPrompt(spiritSp(a)") < 0, "tickRooms 里那条自动双人 CG 已删除");
  ok(appSrc.indexOf("这段事件也配一张双人 CG") < 0, "tickRooms 的自动 CG 注释也一并清掉");
  const gc = appSrc.split("generateCustom(").length - 1;
  ok(gc === 3, "app.js 里 generateCustom 只剩 3 处（drawCgFromBrief / retryMissingCg 主线·冻结 / ensureBg 注入），实际 " + gc);
  ok(appSrc.indexOf("async function drawCgFromBrief") >= 0, "唯一 CG 出图入口 drawCgFromBrief 存在");
  ok(appSrc.indexOf("landscape: true") >= 0, "CG 仍走横版（landscape: true → cgLadderFor）");

  /* ============ F. ① 描述可见、可编辑、确认后才写盘 ============ */
  section("F. ① 描述可见可编辑 + 确认后写盘");
  ok(appSrc.indexOf('id="sdCgBrief"') >= 0 && appSrc.indexOf("<textarea") >= 0, "详情页 CG 卡片有可编辑 textarea #sdCgBrief");
  ok(appSrc.indexOf('id="sdCgBriefGen"') >= 0, "有「🔤 生成画面描述」按钮");
  ok(appSrc.indexOf('id="sdCgDraw"') >= 0, "有「🎬 按这段描述出图」按钮");
  ok(appSrc.indexOf('id="sdCgRedo"') >= 0, "已有 CG 也能「✏️ 改描述重画」");
  ok(appSrc.indexOf("r0.cgBrief = brief;") >= 0, "单只 CG：确认后的描述写进 rec.cgBrief");
  ok(appSrc.indexOf("r1.cgBrief = br;") >= 0, "单只 CG：生成的描述也先存 rec.cgBrief");
  ok(appSrc.indexOf("openFestCgBriefModal") >= 0, "节令 CG 走描述先行弹层");
  ok(appSrc.indexOf("r.fests[dk].brief = brief") >= 0 || appSrc.indexOf("rb.fests[dk].brief = brief") >= 0, "节令 CG：描述写进 rec.fests[dk].brief");
  ok(appSrc.indexOf('id="stCgBrief"') >= 0 && appSrc.indexOf('id="stCgDraw"') >= 0, "双人事件 CG 在剧情弹层里也能描述先行");
  ok(appSrc.indexOf("Rooms.setStoryBrief(") >= 0, "双人事件 CG 的描述写回 Rooms");

  /* ============ G. rooms.js ============ */
  section("G. rooms.js · setStoryBrief");
  ok(roomsSrc.indexOf("function setStoryBrief(a, b, level, text)") >= 0, "rooms.js 新增 setStoryBrief");
  ok(/setStoryImage,\s*setStoryBrief,/.test(roomsSrc), "setStoryBrief 已导出");

  /* ============ H. index.html 版本号 ============ */
  section("H. index.html ?v= 已 bump（>= 20261219，R2 基线）");
  ["css/style.css", "js/spirits.js", "js/app.js", "js/rooms.js"].forEach((f) => {
    const m = htmlSrc.match(new RegExp(f.replace(/[.\/]/g, "\\$&") + "\\?v=(\\d+)"));
    ok(!!m && Number(m[1]) >= 20261219, "index.html 的 " + f + " ?v= 已 bump（" + (m && m[1]) + "）");
  });

  const passed = summary();
  process.exit(passed ? 0 : 1);
})();
