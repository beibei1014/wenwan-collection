/* 临时排查脚本（只读）：把「单只·进阶 CG」的**真实最终 prompt** 原样打出来。
   复刻用户实测场景：从异邦来的少年 / 赭石色长发 / 西域风情浓郁的古风常服 / 双手怀抱在胸前（半身近景）。
   用法： node docs/_dump_cg_prompt.js
   纪律：不改任何 js；只在沙箱里跑真 spirits.js 的装配函数，打印全文。 */
"use strict";
const path = require("path");
const { makeContext, loadFile } = require("./_harness.js");

// 用户实测时用的是 ark（豆包 Seedream）→ 中文锚开关 zhAnchorEnabled() 为 true
const ARK = process.argv.includes("--pollinations") ? false : true;

const h = makeContext();
h.sandbox.localStorage.setItem("ww_imgcfg", JSON.stringify({ provider: ARK ? "ark" : "pollinations", style: "" }));
loadFile(h.ctx, "js/spirits.js");
const SP = h.sandbox.Spirits;

const id = "it_xiyu_少年";
const item = {
  id: id, name: "西域少年", category: "菩提", species: "星月",
  color: "赭石", playCount: 9,        // 9 次盘玩 ⇒ 蜕形（stage 3，8 头身）
  createdAt: Date.now() - 86400000 * 24,
};

// —— 复刻用户的「出图单 / 人物设定」 ——
const recLook = {
  hairc: "custom",
  customColor: "#955539",              // 赭石
  outfitColor: "西域风情浓郁的古风常服",
  persona: "一位从异邦来的少年，风尘仆仆，眼神却干净。",
  base: "一位从异邦来的少年，赭石色长发全部绾成一个发髻，身着西域风情浓郁的古风常服。",
  brief: {
    ver: 1, at: Date.now(), gender: "boy",
    poseZh: "双手怀抱在胸前",
    propZh: "",
    outfitZh: "西域风情浓郁的古风常服",
    hairstyleZh: "长发全部绾成一个发髻",
    sceneZh: "",
    colorsText: "发·赭石(#955539)；衣·西域风情浓郁的古风常服",
    featsText: "",
    extraZh: "",
    hairColorZh: "赭石", hairColorHex: "#955539", outfitHex: "",
  },
};

const s0 = SP.load();
const r = SP.ensureIn(s0, id);
r.stage = 3;
r.gender = "boy";
r.appearanceSeed = 0;
r.look = recLook;
SP.save(s0);

const look = SP.lookOf(item, r);
const ap = SP.appearanceOf(item, r.appearanceSeed, r.gender, r.look);

// 用户确认后的中文画面描述（原样）
const brief = "横版构图，半身近景，从大腿以上裁切，主体占画面高度约百分之七十，居中。" +
  "一位从异邦来的少年，赭石色长发全部绾成一个发髻，身着西域风情浓郁的古风常服，衣袂线条利落。" +
  "他双手怀抱在胸前，微微一偏头，眼神望向前方，神情沉静而疏朗。暖色调，光线柔和，古风意境。";

function dump(title, o) {
  const p = SP.cgPromptFromBrief(brief, o);
  console.log("\n====================================================================================");
  console.log("## " + title);
  console.log("====================================================================================");
  console.log(p);
  console.log("\n--- 长度 " + p.length + " 字符 ---");
  // 逐段标签：把关键约束段单独高亮，方便核对「哪一段在跟用户描述打架」
  const hits = [
    ["ANATOMY(抱胸冲突)", /unobstructed|uncrossed|no hidden overlapping arms|fully visible/i],
    ["GUOFENG/服饰锁", /classical Chinese-inspired costume|gufeng|hanfu|cross-collar|jiaoling youren|xianxia/i],
    ["清代强禁", /no Qing dynasty|no mandarin collar|no frog buttons/i],
    ["配饰池(数珠)", /bead|bracelet|necklace|tassel/i],
    ["姿态/姿势", /pose|hands|arms|chest|breast/i],
    ["景别锁", /close-up|medium shot|mid-thigh|waist up|from the chest/i],
    ["关键词进入", /scene:/i],
  ];
  hits.forEach(function (kv) {
    const m = p.match(kv[1]);
    console.log("  [" + (m ? "命中" : "  --") + "] " + kv[0] + (m ? "  ⇒ " + m.slice(0, 6).join(" | ") : ""));
  });
}

// ① 有英文关键词（真实线上大概率如此：cgKeywords 成功返回纯英文）
const kwSample = "an exotic young man, ochre long hair tied in a bun, foreign western-region ancient costume, " +
  "arms folded in front of his chest, half-body waist-up shot, warm tone, soft light, xianxia gufeng";
dump("① 单只·进阶 CG（keywords 非空 + ark 中文锚）", {
  kind: "stage", item: item, stage: 3, appearance: ap, look: look, keywords: kwSample,
});

// ② 没有关键词（掉回「直附中文描述」的兜底分支）
dump("② 单只·进阶 CG（keywords 为空，直附中文描述）", {
  kind: "stage", item: item, stage: 3, appearance: ap, look: look, keywords: "",
});

// ③ 只有 brief、无任何 look（最裸的装配：验证硬约束来自常量而非用户出图单）
dump("③ 最裸装配（无 look / 无 keywords）", {
  kind: "stage", item: item, stage: 3, appearance: ap, look: null, keywords: "",
});

console.log("\n\n############ 关键常量原文（供对照行号） ############");
console.log("\n[ANATOMY] " + JSON.stringify(SP.ANATOMY || "(未导出)"));
console.log("\n[GUOFENG] " + JSON.stringify(SP.GUOFENG || "(未导出)"));
console.log("\n[CG_COSTUME_GUARD] " + JSON.stringify(SP.CG_COSTUME_GUARD || "(未导出)"));
