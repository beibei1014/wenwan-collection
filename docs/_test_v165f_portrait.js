/* v165-F 自测：立绘比例执行手段 v2（用户第二次打回：蜕形实测约 5.5–6 头身）
 *
 * 背景（team-lead 派单 + 用户原话）：
 *   「立绘的头身比还有些问题……黄金算盘这也不是八头身啊」
 *   上一版（v165-R1）已写「数字锚 + 时装画锚词 + 七条强负向 + 轮廓句 + 头发句」，仍不达标。
 *
 * dump 真产物（docs/_dump_prompt.js）后确认的**真根因 + 修法**：
 *   ① 画幅留白：cmp 写死 "centered with comfortable margin around the character"
 *      → 模型把人物画小、四周留白，观者按"画面里这个人"脑补，比例被视觉压矮。
 *      修：非 legacy 立绘改 "the standing figure fills the full vertical extent of the frame…"（FRAME_FILL）。
 *   ② 抽象锚词不落地 + 正向幼态残留抵消末尾负向：8-heads / fashion-illustration 只是"风格词"；
 *      而开场 "a young boy character, clearly male, boyish face" 在**位置 0**（权重高）与
 *      "teenage/adult version" 打架。修：补**数值化身体分区**（腿长≈身高一半 / 肩宽≈1.5 头宽）；
 *      3/4 阶把开场身份锚换成 "a teenage boy" / "a young adult man"。
 *   ③ 全英文 prompt：ark 是**字节豆包 Seedream（国产模型）**，中文指令执行力更强。
 *      修：**仅 ark** 在整条 prompt 最末尾追加中文比例锚（PROPORTION_ZH，可配置常量）。
 *
 * 本测试钉住：
 *   A. 根因存在（负向对照）：改动前的 HEAD 版**必然失败**（它还带旧留白、无 FRAME_FILL、无中文锚、开场带 boyish）
 *   B. 占满画幅：非 legacy 四阶都含 FRAME_FILL、不含旧留白
 *   C. 数值化身体分区：蜕形/化形 prop 含腿长半身 / 肩宽 1.5 头宽
 *   D. 中文比例锚：仅 ark 追加（v167-B 起其后还接 COSTUME_ZH + NO_QING，整条以 NO_QING 收尾）；非 ark 一律没有
 *   E. 开场身份锚：3/4 阶无 "young boy / boyish face"；1/2 阶保持原样
 *   F. ⛔ legacy 逐字节复刻：legacy 立绘 prompt 与改动前**完全一致**（旧图 URL 还能找回来）
 *   G. ⛔ CG 路径一字未动：cgPropFor / cgPromptFromBrief 不含 FRAME_FILL / 中文锚
 *
 * 用法：node docs/_test_v165f_portrait.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const h = makeContext();
loadFile(h.ctx, "js/spirits.js");
const SP = h.sandbox.Spirits;
if (!SP) { console.error("Spirits 未加载"); process.exit(2); }

/* 改动前的基线 spirits.js（**固定铆定 commit 13959d0 = V165-E**，即做立绘比例手段 v2 之前的那一版），
   用于负向对照 A 段。⛔ 不用 HEAD：本测试写作期内 HEAD 恰好是"改前"，
   可一旦修复被提交，HEAD 就变成"改后"，A 段的自指负向对照从此**永久假红**
   （v173 收尾实测：HEAD 版已含 FRAME_FILL×4 / NO_QING×27 → A1~A4 必假红）。
   取法：优先 `git show <铆定 commit>`；失败（部分沙箱 EBUSY）→ 回落预导出基线文件；
   都没有 → 优雅跳过负向对照（与 _test_v164c_ratio.js 的可选负向对照同一口径），不误报失败。 */
let OLD_SP = null, OLD_SRC = "";
try { OLD_SRC = require("child_process").execSync("git show 13959d0:js/spirits.js", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 27 }); }
catch (e) {
  try { OLD_SRC = fs.readFileSync(path.join(__dirname, "_tmp/_pre_v165f_spirits.js"), "utf8"); } catch (e2) { OLD_SRC = ""; }
}
if (OLD_SRC) {
  const hOld = makeContext();
  hOld.ctx.window = hOld.ctx;
  vm.runInContext(OLD_SRC, hOld.ctx, { filename: "spirits.js#HEAD" });
  OLD_SP = hOld.sandbox.Spirits;
} else {
  console.log("  (取不到 HEAD 版基线：负向对照 A/F 将优雅跳过)");
}

const item = {
  id: "it_jinsuanpan", name: "金算盘", category: "菩提", species: "星月",
  gender: "boy", color: "浅花", playCount: 20, softness: "slight", createdAt: Date.now() - 86400000 * 40,
};
const LK = { base: "", persona: "", profile: "", brief: null, hairEn: "chestnut brown", outfitEn: "jade green" };
const P = (s, look) => SP.promptFor(item, "anime", s, null, look === undefined ? LK : look);
const propOf = (s) => SP.stageDef(s).prop || "";
const ZH_RE = /画面比例要求/;
const FRAME_FILL_SIG = "fills the full vertical extent of the frame";
const OLD_MARGIN_SIG = "centered with comfortable margin around the character";

/* ============ A. 根因存在（负向对照） ============ */
section("A. 根因存在（改动前的 HEAD 版应当触发本测试的判据）");
if (OLD_SP) {
  SP.setImageCfg({ provider: "pollinations", style: "anime" });
  OLD_SP.setImageCfg({ provider: "pollinations", style: "anime" });
  const oldP3 = OLD_SP.promptFor(item, "anime", 3, null, LK);
  ok(oldP3.indexOf(OLD_MARGIN_SIG) >= 0, "A1 · 改前立绘含旧留白措辞（人偏小的根因）");
  ok(oldP3.indexOf(FRAME_FILL_SIG) < 0, "A2 · 改前立绘没有「占满画幅」→ 证明 B 能抓到本次修复");
  ok(/boyish face/.test(oldP3), "A3 · 改前 8 头身蜕形仍带「a young boy character, boyish face」（幼态残留）");
  OLD_SP.setImageCfg({ provider: "ark", style: "anime" });
  ok(!ZH_RE.test(OLD_SP.promptFor(item, "anime", 3, null, LK)), "A4 · 改前 ark 版没有中文比例锚 → 证明 D 能抓到这个新增");
} else {
  ok(true, "A · (无 HEAD 基线 → 负向对照优雅跳过；正常用 git show HEAD 会跑)");
}

/* ============ B. 占满画幅 ============ */
section("B. 非 legacy 立绘一律「占满画幅」");
SP.setImageCfg({ provider: "pollinations", style: "anime" });
[1, 2, 3, 4].forEach((s) => {
  const p = P(s);
  ok(p.indexOf(FRAME_FILL_SIG) >= 0, "B" + s + " · 阶段" + s + " 含「人物占满画幅」（fills the full vertical extent）");
  ok(p.indexOf(OLD_MARGIN_SIG) < 0, "B" + s + " · 阶段" + s + " 不再含旧留白措辞");
  ok(p.indexOf("no empty space above the head or below the feet") >= 0, "B" + s + " · 阶段" + s + " 明确「头顶脚下无空白」");
});

/* ============ C. 数值化身体分区 ============ */
section("C. 蜕形 / 化形 prop 补「数值化身体分区」");
[3, 4].forEach((s) => {
  const pr = propOf(s);
  ok(pr.indexOf("the legs alone take up about half of the total height") >= 0,
    "C" + s + " · 阶段" + s + " 含「腿长≈身高一半」（显高的物理本质）");
  ok(pr.indexOf("the shoulder width is about one and a half head-widths") >= 0,
    "C" + s + " · 阶段" + s + " 含「肩宽≈1.5 头宽」");
});
const pr1 = propOf(1), pr2 = propOf(2);
ok(pr1.indexOf("half of the total height") < 0, "C5 · 凝形（Q 版）⛔ 不加「腿长半身」（会毁掉大头幼儿比例）");

/* ============ D. 中文比例锚（仅 ark） ============ */
section("D. 中文比例锚：仅 ark、且恰在整条 prompt 最末尾");
{
  // ark：四阶都应以中文锚收尾
  SP.setImageCfg({ provider: "ark", style: "anime" });
  [1, 2, 3, 4].forEach((s) => {
    const p = P(s), zh = SP.proportionZhFor(s);
    ok(ZH_RE.test(p), "D-ark" + s + " · 阶段" + s + " 含中文比例锚");
    // v167-B：中文比例锚之后还接 COSTUME_ZH + NO_QING（服装两段）→ 不再要求「恰为最后一个字符」，
    //   改为「整条 prompt 以 NO_QING 收尾、比例锚在英文比例块之后、服装锚接在比例锚之后」。
    ok(p.endsWith(SP.NO_QING), "D-ark" + s + " · 阶段" + s + " 整条 prompt 以 NO_QING 收尾（服装强禁最高权重）");
    ok(p.indexOf(zh) > p.lastIndexOf("PROPORTION LOCK"), "D-ark" + s + " · 阶段" + s + " 中文比例锚在英文比例块**之后**");
    ok(p.indexOf(zh) >= 0 && p.indexOf(SP.COSTUME_ZH) > p.indexOf(zh), "D-ark" + s + " · 阶段" + s + " 中文服装锚接在比例锚之后");
    ok(zh.indexOf(String(SP.headCountOf(s))) >= 0 || /四头身|六头身|八倍|九倍/.test(zh), "D-ark" + s + " · 中文锚与本阶头身数一致");
  });
  ok(/绝不是大头短腿/.test(SP.proportionZhFor(3)) && /绝不是大头短腿/.test(SP.proportionZhFor(4)),
    "D5 · 3/4 阶中文锚含「绝不是大头短腿的可爱风格」");
  ok(!/绝不是大头短腿/.test(SP.proportionZhFor(1)), "D6 · 凝形中文锚⛔ 不反对大头（Q 版就该大头）");

  // 非 ark：一律不追加
  ["pollinations", "zhipu", "siliconflow", ""].forEach((prov) => {
    SP.setImageCfg(prov ? { provider: prov, style: "anime" } : { style: "anime" });
    const p = P(3);
    ok(!ZH_RE.test(p), "D-non-ark[" + (prov || "默认") + "] · 非 ark provider 不追加中文锚（不污染）");
  });

  // 默认（无 cfg）→ pollinations → 无中文
  SP.setImageCfg({ provider: "pollinations", style: "anime" });
}

/* ============ E. 开场身份锚按阶段替换 ============ */
section("E. 开场身份锚：3/4 阶掐掉幼态残留，1/2 阶保持原样");
{
  SP.setImageCfg({ provider: "pollinations", style: "anime" });
  const p1 = P(1), p2 = P(2), p3 = P(3), p4 = P(4);
  ok(/a young boy character, clearly male, boyish face:/.test(p1), "E1 · 凝形开场保持原样（幼儿本就该幼态）");
  ok(/a young boy character, clearly male, boyish face:/.test(p2), "E2 · 开窍开场保持原样");
  ok(!/boyish face/.test(p3) && !/a young boy character/.test(p3), "E3 · 蜕形开场不再有 'young boy / boyish face'");
  ok(/^a teenage boy, clearly male, youthful handsome face:/.test(p3), "E4 · 蜕形开场换成 'a teenage boy … youthful handsome face'");
  ok(!/boyish face/.test(p4) && /^a young adult man, clearly male, handsome mature face:/.test(p4),
    "E5 · 化形开场换成 'a young adult man … handsome mature face'");
  ok(/clearly male/.test(p3) && /clearly male/.test(p4), "E6 · 性别锚（clearly male）保留，只掐年龄措辞");
  // 性别为女时同理
  const itemG = Object.assign({}, item, { id: "it_g", gender: "girl" });
  const pg3 = SP.promptFor(itemG, "anime", 3, null, LK);
  ok(/a teenage girl, clearly female, youthful pretty face:/.test(pg3) || !/girlish face/.test(pg3),
    "E7 · 女角 3 阶开场同样掐掉 'girlish face'");
}

/* ============ F. ⛔ legacy 逐字节复刻（旧图 URL 还原不受影响） ============ */
section("F. legacy 立绘 prompt 与改动前逐字节一致（旧图 URL 还能找回来）");
{
  const cases = [
    [1, undefined], [2, undefined], [3, undefined], [4, undefined],
    [3, { hairEn: "persimmon red", outfitEn: "pale moon-white robe", beadHex: "#e0513a", hairHex: "#e0513a" }],
  ];
  if (!OLD_SP) ok(true, "F · (无 HEAD 基线 → 逐字节对照优雅跳过)");
  else {
    ["pollinations", "ark"].forEach((prov) => {
      [SP, OLD_SP].forEach((m) => m.setImageCfg({ provider: prov, style: "anime" }));
      cases.forEach(([s, lk], i) => {
        const a = SP.promptFor(item, "anime", s, null, lk, { legacy: true });
        const b = OLD_SP.promptFor(item, "anime", s, null, lk, { legacy: true });
        ok(a === b, "F[" + prov + "#" + i + "] · legacy 阶段" + s + " prompt 与改前逐字节一致");
      });
      // 旧图 URL 入口也一致
      const ua = SP.legacyPollinationsUrl(item, 0, "anime", 3, null);
      const ub = OLD_SP.legacyPollinationsUrl(item, 0, "anime", 3, null);
      ok(ua === ub, "F-url[" + prov + "] · legacyPollinationsUrl 与改前一致（旧图缓存命中）");
    });
  }
  // legacy 不含新东西
  const pl = SP.promptFor(item, "anime", 3, null, LK, { legacy: true });
  ok(pl.indexOf(FRAME_FILL_SIG) < 0 && !ZH_RE.test(pl) && pl.indexOf("PROPORTION LOCK") < 0,
    "F · legacy 不含 FRAME_FILL / 中文锚 / 比例块（精确复刻旧 prompt）");
}

/* ============ G. ⛔ CG 路径一字未动 ============ */
section("G. CG 路径（cgPropFor / cgPromptFromBrief）不受 v165-F 影响");
{
  SP.setImageCfg({ provider: "ark", style: "anime" });
  const brief = "它全身站在庭院正中，右手搭在石桌边沿，暖光融融。";
  [1, 2, 3, 4].forEach((s) => {
    const cg = SP.cgPromptFromBrief(brief, { kind: "stage", item: item, stage: s });
    ok(cg.indexOf(FRAME_FILL_SIG) < 0, "G-cg" + s + " · 单只 CG 不含立绘的「占满画幅」（CG 景别由画面描述驱动）");
    ok(!ZH_RE.test(cg), "G-cg" + s + " · 单只 CG 不含立绘的中文比例锚");
    ok(cg.indexOf("PROPORTION LOCK") >= 0, "G-cg" + s + " · 单只 CG 仍带比例块（v165-A 保证未破）");
  });
  const pf = SP.cgPromptFromBrief(brief, { kind: "fest", item: item, stage: 3, fest: { key: "duanwu" } });
  ok(!ZH_RE.test(pf) && pf.indexOf(FRAME_FILL_SIG) < 0, "G-fest · 节令 CG 也不受立绘改动影响");
  // cgPropFor 本身不含中文
  [3, 4].forEach((s) => {
    const cp = SP.cgPropFor(s, { wide: true });
    ok(!ZH_RE.test(cp), "G-prop" + s + " · cgPropFor(wide) 不含中文");
  });
  SP.setImageCfg({ provider: "pollinations", style: "anime" });
}

/* ============ H. 既有事实源不变 ============ */
section("H. 头身事实源与全局负向不变");
ok(JSON.stringify(SP.HEAD_COUNT) === JSON.stringify([0, 4, 6, 8, 9]), "H1 · HEAD_COUNT 仍 = [0,4,6,8,9]");
ok(SP.NEG_STYLE.indexOf("no chibi") < 0 && SP.NEG_STYLE.indexOf("no big head") < 0,
  "H2 · 全局 NEG_STYLE 仍无 no chibi / no big head（凝形靠大头吃饭）");
ok(SP.SIZE_BY_PROVIDER.ark[0] === "1728x2304", "H3 · 立绘仍竖版 1728x2304");
[1, 2, 3, 4].forEach((s) => {
  ok((SP.stageDef(s).sizeZh || "").indexOf(String(SP.headCountOf(s))) >= 0, "H4-" + s + " · sizeZh 与 HEAD_COUNT 一致");
});

const passed = summary();
process.exit(passed ? 0 : 1);
