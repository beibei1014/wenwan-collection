/* v164c 自测：四个阶段的「出图人物比例」是否真的分档、互不打架、且压得住

   背景（用户原话）：
     「刚刚生成的花间酒，特征都对了，但是比例不是 4 头身的幼年形态吧，感觉像少年形态了
       （又比 6 头身的比例差一些）。你核对一下每个阶段的出图人物比例风格，
       有些角色脸像 6 头身，比例又是 4 头身，显得头大身子长腿短，很不美观」

   实查出来的真根因（旧版 commit 9665c8e，四条全部由本测试钉住）：
     ① GROWTH_LINE 是**恒定**加在所有阶段的，原文写
        "this is the same character at an OLDER AGE THAN THE PREVIOUS STAGE ... do not keep the baby proportions"。
        凝形（第 1 阶）根本没有"上一阶段"，模型于是在 prompt 后段收到「不要保留婴儿比例」的指令，
        把前面 4000 字符处的 "a tiny newborn baby, about 4 heads tall" 全部推翻 → 画成少年。← 这是本次元凶
     ② 风格预设 st（"big expressive eyes with white highlights" / "richly detailed outfit" / "full body"）
        拼在 prompt **最末尾**，是权重最高的一段，却对"几头身"零约束 → 模型回落到"美型全身立绘"默认先验 ≈ 6 头身。
     ③ 全 prompt 没有任何比例层面的**反向**约束（no adult proportions 之类），而"数字头身比"对扩散模型是极弱约束。
     ④ 阶段 1 的 "no accessories" 与 appearancePrompt 必写的 "wearing X and Y" 直接打架 → 模型随机二选一。

   要证明的：
     1. 四阶各自带自己那档头身数字 + 自己的比例锁定块，且锁定块压在 prompt **最末尾**
     2. 凝形**绝不**出现"上一阶段 / 更长更高 / 不要婴儿比例"这类措辞
     3. 凝形必须有可执行的幼儿比例词（chibi / oversized head / childlike face / no adult proportions…）
     4. 2/3/4 阶各有递进句 + 各自的反向约束
     5. 三个出图入口（立绘 promptFor / 单只 CG promptForCg / 节令 CG festCgPrompt）都带上
     6. 旧版（commit 9665c8e）在本测试上**必须失败** —— 否则这测试是摆设

   用法：node docs/_test_v164c_ratio.js
         SPIRITS_SRC_FILE=<旧版 spirits.js 临时文件> node docs/_test_v164c_ratio.js   （负向对照，必须 FAIL）
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const h = makeContext();
const SRC_OVERRIDE = process.env.SPIRITS_SRC_FILE || "";
if (SRC_OVERRIDE) {
  const code = fs.readFileSync(SRC_OVERRIDE, "utf8");
  h.ctx.window = h.ctx;
  vm.runInContext(code, h.ctx, { filename: SRC_OVERRIDE });
} else {
  loadFile(h.ctx, "js/spirits.js");
}
const SP = h.sandbox.Spirits;
if (!SP) { console.error("Spirits 未加载"); process.exit(2); }

/* 花间酒：凝形（第 1 阶）实测那只（24 天 / 9 盘 → 未过第 2 阶门槛 30 天 & 5 盘） */
const item = {
  id: "it_huajianjiu", name: "花间酒", category: "菩提", species: "星月",
  color: "浅花", playCount: 9, softness: "slight",
  createdAt: Date.now() - 86400000 * 24,
};
const P = (s) => SP.promptFor(item, "anime", s);
/* 头身比的两种写法都要认：「4-heads-tall」（锁定块里）和「about 4 heads tall」（阶段描述里） */
const hcRe = (n) => new RegExp(String(n) + "[ -]heads[ -]tall");
const propOf = (s) => (SP.stageDef(s) && SP.stageDef(s).prop) || "";

/* ============ A. 每阶都带自己那档头身 + 锚点，且只出现一次 ============ */
section("A. 四阶各自带自己那档头身比 + 比例锁定块（立绘）");
[1, 2, 3, 4].forEach((s) => {
  const p = P(s), hc = SP.headCountOf(s);
  ok(p.indexOf("about " + hc + " heads tall") >= 0, "阶段" + s + " 含 'about " + hc + " heads tall'");
  ok(hcRe(hc).test(p), "阶段" + s + " 锁定块复述了头身比 " + hc);
  ok(p.indexOf("PROPORTION LOCK") >= 0, "阶段" + s + " 含比例锁定块");
  ok(p.split("PROPORTION LOCK").length - 1 === 1, "阶段" + s + " 锁定块只出现一次（不重复占位）");
});

/* ============ B. 凝形绝不能说"比上一阶段更年长/别保留婴儿比例" ★本次真钉子★ ============ */
section("B. 凝形（第 1 阶）不得出现「上一阶段」类措辞");
const p1 = P(1);
ok(p1.indexOf("older age than the previous stage") < 0, "凝形不得出现 'older age than the previous stage'");
ok(p1.indexOf("do not keep the baby proportions") < 0, "凝形不得出现 'do not keep the baby proportions'");
ok(p1.indexOf("grow taller and more mature") < 0, "凝形不得出现 'grow taller and more mature'");
ok(p1.indexOf("grown up from") < 0, "凝形不得出现 'grown up from'");
ok(p1.indexOf("now taller and more mature") < 0, "凝形不得出现 'now taller and more mature'");
ok(p1.indexOf("first and youngest form") >= 0, "凝形应改写为 'its very first and youngest form'");

/* ============ C. 凝形要有可执行的幼儿比例词（不是只有一句数字） ============ */
section("C. 凝形的幼儿比例词（数字头身比对模型是弱约束，必须有可执行的词）");
["chibi", "oversized round head", "chubby", "childlike face", "short stubby",
  "no adult proportions", "no teenage body", "no long legs", "toddler"].forEach((w) => {
  ok(p1.indexOf(w) >= 0, "凝形 prompt 应含「" + w + "」");
});

/* ============ D. 2/3/4 阶各有递进句 + 各自的反向约束 ============ */
section("D. 开窍 / 蜕形 / 化形 的递进句与反向约束");
const D = {
  2: { from: "grown up from its newborn form", must: ["no adult proportions", "childlike face"] },
  3: { from: "grown up from its child form", must: ["no chibi", "no baby proportions"] },
  4: { from: "grown up from its teenage form", must: ["no chibi", "no childlike face"] },
};
[2, 3, 4].forEach((s) => {
  const p = P(s);
  ok(p.indexOf(D[s].from) >= 0, "阶段" + s + " 应写 '" + D[s].from + "'");
  D[s].must.forEach((w) => ok(p.indexOf(w) >= 0, "阶段" + s + " 应含反向约束「" + w + "」"));
});

/* ============ E. 锚点必须压在 prompt 最末尾（在用户出图单之后） ============ */
section("E. 比例锁定块的位置：必须最末尾（风格预设 st 之后、出图单之后）");
const brief = SP.toBrief({
  gender: "boy", poseZh: "静静站着", outfitZh: "月白长衫", propZh: "柿子",
  colors: [{ part: "衣", cn: "月白", hex: "#eef3f6" }, { part: "发", cn: "柿红", hex: "#e0513a" }],
});
const LOOK = {
  base: "", persona: "", profile: "", brief: brief,
  hairEn: "persimmon red", outfitEn: "pale moon-white robe", hairHex: "#e0513a", outfitHex: "#eef3f6",
};
const pb = SP.promptFor(item, "anime", 1, null, LOOK);
const iAnchor = pb.lastIndexOf("PROPORTION LOCK");
const iSpec = pb.lastIndexOf("OWNER-CONFIRMED DRAWING SPEC");
const iStyle = pb.lastIndexOf("2D hand-drawn illustration in traditional Chinese gufeng style");
ok(iSpec >= 0, "带出图单时 prompt 里有 'OWNER-CONFIRMED DRAWING SPEC'（前提成立）");
ok(iStyle >= 0, "prompt 里有风格预设段（前提成立）");
ok(iAnchor > iStyle, "比例锁定块必须压在风格预设 st **之后**（st 是纯成人/少年措辞的结尾大段）");
ok(iAnchor > iSpec, "比例锁定块必须压在用户出图单之后（两者谈的东西不重叠：出图单只管服饰/发色/持物/神态，从不谈比例）");
ok(pb.length - iAnchor < 400, "比例锁定块位于结尾 400 字符内（实测 " + (pb.length - iAnchor) + "）");
ok(pb.indexOf("OWNER-CONFIRMED DRAWING SPEC") >= 0 && pb.indexOf("柿子") >= 0, "出图单内容仍在 prompt 里（v164 的保证没被破坏）");

/* ============ F. 凝形不再与 appearancePrompt 的配饰指令打架 ============ */
section("F. 凝形去掉 'no accessories'（它与随机池的配饰是硬冲突）");
ok(p1.indexOf("no accessories") < 0, "凝形 prompt 不得再有 'no accessories'");
const apTxt = SP.appearancePrompt(SP.appearanceOf(item, 0));
ok(/wearing /.test(apTxt), "前提：appearancePrompt 仍必写 'wearing …'（所以旧的 no accessories 必然矛盾）");
// v165-Q：服饰递进后凝形表述升级为「very simple plain single-layer clothing, no ornaments」，
//   语义不变（仍不用 "no accessories" 硬禁，避免与随机配饰冲突），只是更明确"单层素衣、无饰件"。
ok(SP.stageDef(1).look.indexOf("very simple plain single-layer clothing") >= 0, "凝形改用「very simple plain single-layer clothing」表达朴素，不再硬禁配饰");

/* ============ G. 三个出图入口都要带 ============ */
section("G. 立绘 / 单只 CG / 节令 CG 三个入口都带比例锁定");
const pcg = SP.promptForCg(item, "anime", 1);
ok(pcg.indexOf("PROPORTION LOCK") >= 0, "单只 CG 带比例锁定块");
ok(hcRe(4).test(pcg), "单只 CG 也复述 4 头身");
ok(pcg.length - pcg.lastIndexOf("PROPORTION LOCK") < 400, "单只 CG 的比例锁定也在末尾");
const pcg3 = SP.promptForCg(item, "anime", 3);
// v165-Q：头身比由 HEAD_COUNT 单点决定（蜕形 8->7、化形 9->7.5），⛔ 不再写死 8
ok(hcRe(SP.headCountOf(3)).test(pcg3) && /no chibi/.test(pcg3),
   "单只 CG 在第 3 阶走 HEAD_COUNT(3)=" + SP.headCountOf(3) + " 头身 + 反对 chibi");
const pfest = SP.festCgPrompt(item, "anime", 1, null, null, { key: "duanwu" });
ok(pfest.indexOf("PROPORTION LOCK") >= 0, "节令 CG 带比例锁定块");
ok(hcRe(4).test(pfest), "节令 CG 也复述 4 头身");

/* ============ H. 四阶互不相同，且与界面显示的数字一致 ============ */
section("H. 四阶锚点互不相同 + 与 HEAD_COUNT / sizeZh（界面文案）一致");
const anchors = [1, 2, 3, 4].map(propOf);
ok(new Set(anchors).size === 4, "四阶比例锁定块互不相同（不是复制粘贴同一个）");
[1, 2, 3, 4].forEach((s) => {
  const hc = SP.headCountOf(s), pr = propOf(s), sz = SP.stageDef(s).sizeZh || "";
  ok(hcRe(hc).test(pr), "阶段" + s + " 锁定块里的头身比 == HEAD_COUNT(" + s + ") = " + hc);
  ok(sz.indexOf(String(hc)) >= 0, "阶段" + s + " 界面文案 sizeZh 与 HEAD_COUNT 一致（「" + sz + "」）");
  ok(pr.length > 60, "阶段" + s + " 锁定块够长、不是占位（" + pr.length + " 字符）");
});
ok(anchors[0].indexOf("chibi") >= 0 && anchors[3].indexOf("no chibi") >= 0,
  "凝形要 chibi、化形要 no chibi —— 首尾两端方向必须相反");

/* ============ I. 负向对照闸门 ============ */
section("I. 负向对照闸门（旧版 commit 9665c8e 应当在这里失败）");
const HAS_PROP = [1, 2, 3, 4].every((s) => typeof SP.stageDef(s).prop === "string" && SP.stageDef(s).prop);
ok(HAS_PROP, "STAGES 四阶都带 prop 字段（旧版没有 → 负向对照在此失败，且 A/C/G/H 段会成片失败）");

const passed = summary();
process.exit(passed ? 0 : 1);
