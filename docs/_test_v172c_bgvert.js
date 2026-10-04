/* v172-C · BG 竖版代码侧接线自测（数据层 + 出图尺寸旁路 + CSS 渲染）
   覆盖：
     1. 常量：BG_STYLE 竖版 9:16（无横版残留）/ BG_NEG 本体语义不变（未混入去清代串）/ BG_SIZE=1440x2560
     2. ⭐ 核心契约：21/21 条 BG_CATALOG prompt 与 docs/_bg_prompts.json **逐字一致**
     3. ensureBg 真跑：generate 入参 landscape:false + size:1440x2560（竖版 9:16）
     4. generateCustom 真跑（免密钥分支）：显式 size 走旁路；CG 仍横版、立绘仍竖版
     5. 静态源：竖版 ladder 旁路存在；⛔ CG_SIZE_BY_PROVIDER.ark 未被竖版污染
     6. CSS：.scenebg.sharppane 由 contain 改 cover（竖版铺满，不再 letterbox）

   用法： node docs/_test_v172c_bgvert.js
   负向对照（应 FAIL）： SPIRITS_SRC=docs/_tmp/_pre_v172c_spirits.js node docs/_test_v172c_bgvert.js
   纪律：跑在「改动后源码」上必须全绿。 */
"use strict";
const fs = require("fs");
const path = require("path");
const H = require("./_harness.js");
const ROOT = path.join(__dirname, "..");
const SPIRITS_SRC = process.env.SPIRITS_SRC || "js/spirits.js";
let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function newS() { const c = H.makeContext(); H.loadFile(c.ctx, SPIRITS_SRC); return { S: c.sandbox.Spirits, c: c }; }
const J = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "_bg_prompts.json"), "utf8"));

(async function main() {
  /* ============ 1. 常量 ============ */
  section("1. 常量：BG_STYLE 竖版 / BG_NEG 本体不变 / BG_SIZE 9:16");
  {
    const { S } = newS();
    ok(typeof S.BG_STYLE === "string"
      && /empty scene, no people/.test(S.BG_STYLE)
      && /9:16/.test(S.BG_STYLE)
      && /VERTICAL PORTRAIT COMPOSITION/.test(S.BG_STYLE),
      "BG_STYLE 含 empty scene, no people / 9:16 / VERTICAL PORTRAIT COMPOSITION");
    ok(!/16:9/.test(S.BG_STYLE) && !/WIDE LANDSCAPE HORIZONTAL COMPOSITION/.test(S.BG_STYLE),
      "⛔ BG_STYLE 无横版残留（16:9 / WIDE LANDSCAPE HORIZONTAL COMPOSITION）");
    ok(/warm bright|cozy lived-in|calm serene|reassuring/.test(S.BG_STYLE), "BG_STYLE 仍含「暖亮/宜居」正面锚（v165 不回归）");
    ok(S.BG_STYLE === J.style, "BG_STYLE 与 docs/_bg_prompts.json 的 style **逐字一致**");

    ok(typeof S.BG_NEG === "string"
      && /strictly no Japanese elements/.test(S.BG_NEG)
      && /no modern or Western clothing/.test(S.BG_NEG)
      && /horror/.test(S.BG_NEG) && /eerie/.test(S.BG_NEG) && /creepy/.test(S.BG_NEG) && /ominous/.test(S.BG_NEG),
      "BG_NEG 场景专用负向语义不变（禁日式 + 禁现代/西式 + horror/eerie/creepy/ominous）");
    ok(!/gentle neutral expressions/.test(S.BG_NEG) && !/hanfu/.test(S.BG_NEG), "⛔ BG_NEG 仍剔除人物向词");
    ok(S.BG_NEG === J.neg, "BG_NEG 与 json 的 neg **逐字一致**");
    ok(!/Qing|mandarin collar|standing collar/i.test(S.BG_NEG), "⛔ BG_NEG 本体未混入去清代串（去清代由 NO_QING 引用追加，不复制）");

    ok(S.BG_SIZE === "1440x2560", "BG_SIZE = 1440x2560（严格 9:16 竖版）");
    ok(JSON.stringify(S.BG_SIZE_LADDER) === JSON.stringify(["1440x2560", "1728x3072"]), "BG_SIZE_LADDER = [\"1440x2560\",\"1728x3072\"]");
    ok((S.BG_SIZE_LADDER || []).length === 2 && S.BG_SIZE_LADDER.every((s) => { const m = /^(\d+)x(\d+)$/.exec(s); return m && Number(m[1]) * 16 === Number(m[2]) * 9; }),
      "回落档均严格 9:16（宽×16 = 高×9）");
    ok((S.BG_SIZE_LADDER || []).length === 2 && S.BG_SIZE_LADDER.every((s) => { const m = /^(\d+)x(\d+)$/.exec(s); return m && Number(m[1]) * Number(m[2]) >= 3686400; }),
      "两档像素数均 ≥ 3,686,400（方舟门槛之上/取等）");

    ok(!((S.CG_SIZE_BY_PROVIDER || {}).ark || []).some((s) => /1440x2560|1728x3072/.test(s)), "⛔ CG_SIZE_BY_PROVIDER.ark 未被竖版尺寸污染");
    ok((S.CG_SIZE_BY_PROVIDER.ark || [])[0] === "2304x1728", "CG 横版档首位仍为 2304x1728（CG 不回归竖版）");
  }

  /* ============ 2. 21/21 prompt 与 JSON 逐字一致 ============ */
  section("2. ⭐ 21/21 BG prompt 与 docs/_bg_prompts.json 逐字一致");
  {
    const { S } = newS();
    const keys = Object.keys(S.BG_CATALOG || {});
    ok(keys.length === 21, "BG_CATALOG 恰好 21 条（实得 " + keys.length + "）");
    let mismatch = [];
    J.items.forEach((it) => {
      const p = (S.BG_CATALOG[it.key] || {}).prompt || "";
      if (p !== it.prompt) mismatch.push(it.key);
    });
    ok(mismatch.length === 0, "21/21 prompt 与 json 逐字一致（不一致：" + mismatch.join(",") + "）");
    ok(keys.every((k) => S.BG_CATALOG[k].prompt.indexOf(S.BG_STYLE) === 0), "21/21 以 BG_STYLE 开头");
    ok(keys.every((k) => S.BG_CATALOG[k].prompt.slice(-(S.NO_QING || "").length) === S.NO_QING), "21/21 以 NO_QING 收尾（去清代最高权重）");
    ok(keys.every((k) => (S.BG_CATALOG[k].prompt.split(S.BG_NEG || "\u0000").length - 1) === 1), "BG_NEG 每条恰出现 1 次");
    ok(keys.every((k) => (S.BG_CATALOG[k].prompt.split(S.NO_QING || "\u0001").length - 1) === 1), "NO_QING 每条恰出现 1 次");
    ok(keys.every((k) => /no people, empty scene/.test(S.BG_CATALOG[k].prompt)), "21/21 含 no people, empty scene（空镜无人）");
    ok(keys.every((k) => !/[\u4e00-\u9fff]/.test(S.BG_CATALOG[k].prompt)), "prompt 正文无中文残留");
    ok(keys.every((k) => !/cinematic directional lighting|atmospheric depth and haze/.test(S.BG_CATALOG[k].prompt)), "⛔ 无旧版阴森向锚");
    ok(keys.every((k) => S.BG_CATALOG[k].src === "assets/bg/" + k + ".jpg"), "src 指向 assets/bg/BG-XX.jpg（21 张竖版静态图）");
  }

  /* ============ 3. ensureBg 真跑：竖版出图入参 ============ */
  section("3. ensureBg 真跑：generate 入参 landscape:false + size:1440x2560");
  {
    const { S } = newS();
    let genArgs = null;
    const deps = {
      get: () => "",
      set: () => true,
      generate: (p, o) => { genArgs = { p: p, o: o }; return { b64: "QUJD" }; },
      toStore: () => ({ url: "https://cdn/bg/BG-02.jpg", cloud: true }),
    };
    await S.ensureBg("BG-02", deps);
    ok(!!genArgs && genArgs.o.landscape === false, "generate 入参 landscape:false（⛔ 不再走 CG 横版档）");
    ok(!!genArgs && genArgs.o.size === "1440x2560", "generate 入参 size:1440x2560（竖版 9:16）");
    ok(!!genArgs && genArgs.o.seedKey === "bg:BG-02" && genArgs.o.variant === 0, "generate 入参 seedKey=bg:BG-02 / variant:0");
    ok(!!genArgs && genArgs.p === S.BG_CATALOG["BG-02"].prompt, "generate 用 catalog 里的（竖版）prompt");
  }

  /* ============ 4. generateCustom 真跑（免密钥分支）：尺寸旁路 ============ */
  section("4. generateCustom 免密钥分支：显式 size 旁路 + CG/立绘不回归");
  {
    const { S } = newS();
    S.setImageCfg({ provider: "pollinations", style: "anime" });
    const u1 = await S.generateCustom("p", { size: "1440x2560" });
    ok(/\?width=1440&height=2560&/.test(u1.url), "显式 size 1440x2560 → 出图 URL width=1440&height=2560");
    const u2 = await S.generateCustom("p", { size: "1728x3072" });
    ok(/\?width=1728&height=3072&/.test(u2.url), "显式 size 1728x3072 → width=1728&height=3072");
    const u3 = await S.generateCustom("p", { landscape: true });
    ok(/\?width=1024&height=768&/.test(u3.url), "CG（landscape:true）仍 1024x768 横版（不回归）");
    const u4 = await S.generateCustom("p", {});
    ok(/\?width=768&height=1024&/.test(u4.url), "立绘默认仍 768x1024 竖版（不回归）");
  }

  /* ============ 5. 静态源：竖版 ladder 旁路 ============ */
  section("5. 静态源：opts.size 旁路 + 竖版 ladder 存在且不污染 CG 档");
  {
    const src = fs.readFileSync(path.join(ROOT, SPIRITS_SRC), "utf8");
    ok(/wantSize\s*=\s*\(opts && opts\.size\)/.test(src), "generateCustom 读取 opts.size（wantSize 旁路）");
    ok(/BG_SIZE_LADDER\.filter/.test(src), "回落阶梯走 BG_SIZE_LADDER（竖版专用）");
    ok(/landscape:\s*false,\s*size:\s*BG_SIZE/.test(src), "ensureBg 传 landscape:false + size:BG_SIZE");
    const cgBlock = (/const CG_SIZE_BY_PROVIDER = \{[\s\S]*?\};/.exec(src) || [""])[0];
    ok(!/1440x2560|1728x3072/.test(cgBlock), "⛔ CG_SIZE_BY_PROVIDER 块内无竖版尺寸（CG 仍走横版 cgLadderFor）");
  }

  /* ============ 6. CSS：sharppane cover ============ */
  section("6. css/skin.css：.scenebg.sharppane contain → cover");
  {
    const css = fs.readFileSync(path.join(ROOT, "css", "skin.css"), "utf8");
    ok(/\.nt-chat\.immersive \.scenebg\.sharppane \{[^}]*background-size:\s*cover/.test(css), "sharppane background-size: cover（竖版 9:16 铺满）");
    ok(!/\.nt-chat\.immersive \.scenebg\.sharppane \{[^}]*background-size:\s*contain/.test(css), "⛔ sharppane 已无 contain（不再 letterbox）");
    ok(!/\r/.test(css), "skin.css 是 LF（无 CR）");
  }

  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项" + (process.env.SPIRITS_SRC ? "（负向对照：" + SPIRITS_SRC + "）" : ""));
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
})();
