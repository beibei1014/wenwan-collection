/* v165c · 3B 批次 A 修复自测（C4 进阶口径 / C5 服装解禁 / C6 starMark+阶段立绘 / C1 BG 文案）
 *
 * 覆盖（对应主理人派单的 6 条）：
 *   1. stageOf 只认 plays：同一 plays 值下不同 bornAt/天数 ⇒ 阶段相同（本次核心回归）
 *      + 边界 plays=0/2/3/5/6/9/10 → 1/1/2/2/3/3/4
 *   2. STAGE_PLAYS === [0,0,3,6,10]；STAGE_DAYS 仍在（不删）
 *   3. starMarkOf/setStarMark 往返；normRecV165 给旧存档补 starMark=false；不进 marks/flags
 *   4. 服装解禁：NEG_STYLE / GUOFENG / CG_STYLE / STYLE_PRESETS.anime / 双人CG
 *      不再出现 hanfu 硬锁，但仍保留「禁现代/西式/禁日式」；lookFromText 兜底不再是 hanfu
 *   5. 意象词表：item.name="莫高窟" ⇒ 命中 Dunhuang；未命中 ⇒ 回落 OUTFITS 原逻辑
 *   6. BG：21 条 prompt 仍以 BG_STYLE 开头、仍含 no people, empty scene、无 hanfu/人物向词
 *   7. C3 建房入口：renderTownPage 有 #townNewRoom 且绑到 showRoomEditModal(null)（静态源检查）
 *
 * 用法：
 *   node docs/_test_v165c_fix.js                                  # 跑仓库内 js/spirits.js
 *   SPIRITS_SRC=docs/_spirits_prev.js node docs/_test_v165c_fix.js # 负向对照（改动前源码，必须 FAIL）
 *   SPIRITS_SRC=js/app.js  node docs/_test_v165c_fix.js            # 查 app.js（C3/C6 静态检查）
 */
"use strict";
const H = require("./_harness.js");
const fs = require("fs"), path = require("path");
const SPIRITS_SRC = process.env.SPIRITS_SRC || "js/spirits.js";
const APP_SRC = process.env.APP_SRC || "js/app.js";

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function newS() { const c = H.makeContext(); H.loadFile(c.ctx, SPIRITS_SRC); return { S: c.sandbox.Spirits, c: c }; }
const ROOT = path.join(__dirname, "..");
const readApp = () => fs.readFileSync(path.join(ROOT, APP_SRC), "utf8");

(async function main() {
  /* ============ 1 + 2. C4 进阶口径：只认 plays ============ */
  section("1. C4 · stageOf 只认盘玩次数（核心回归：天数无关）");
  {
    const { S } = newS();
    const DAY = 86400000, now = Date.now();
    // 1a 边界表
    const want = [[0, 1], [2, 1], [3, 2], [5, 2], [6, 3], [9, 3], [10, 4]];
    want.forEach(([p, s]) => {
      ok(S.stageOf({ id: "x" + p, playCount: p }, {}) === s,
        "plays=" + p + " → 阶段 " + s + "（实际 " + S.stageOf({ id: "x" + p, playCount: p }, {}) + "）");
    });
    // 1b 核心回归：同一 plays、不同 bornAt ⇒ 阶段恒相同
    [0, 40, 400, 3650].forEach((d) => {
      const it = { id: "fixed", playCount: 10 };
      const rec = { bornAt: now - d * DAY };
      ok(S.stageOf(it, rec) === 4, "plays=10 & bornAt=" + d + " 天前 → 仍是 4 阶（天数不影响）");
    });
    // 1c 低 plays + 超长天数也不能进阶（旧口径会因天数单独涨）
    [400, 3650].forEach((d) => {
      const it = { id: "low", playCount: 1 };
      const rec = { bornAt: now - d * DAY };
      ok(S.stageOf(it, rec) === 1, "plays=1 & bornAt=" + d + " 天前 → 仍 1 阶（旧双条件会误升）");
    });
    // 1d 不跳阶
    ok(S.stageOf({ id: "j", playCount: 99 }, {}) === 4, "plays=99 → 4 阶（封顶，不越界）");
  }
  section("2. C4 · 常量：STAGE_PLAYS=[0,0,3,6,10]，STAGE_DAYS 保留");
  {
    const { S } = newS();
    ok(JSON.stringify(S.STAGE_PLAYS) === JSON.stringify([0, 0, 3, 6, 10]),
      "STAGE_PLAYS === [0,0,3,6,10]（实际 " + JSON.stringify(S.STAGE_PLAYS) + "）");
    ok(Array.isArray(S.STAGE_DAYS) && S.STAGE_DAYS.length === 5 && S.STAGE_DAYS[4] === 120,
      "STAGE_DAYS 仍在且长度 5（历史留档，未删）");
    ok(Array.isArray(S.HEAD_COUNT) && S.HEAD_COUNT.length === 5, "HEAD_COUNT 长度 5（1-based 前导占位约定未动）");
    // stageProgress / stageInfo 也必须是 plays-only
    const sp = S.stageProgress({ id: "p", playCount: 7 }, {});
    ok(sp.bottleneck === "plays" && sp.toNextPlays === 3 && sp.toNextDays === 0,
      "stageProgress：bottleneck=plays / toNextPlays=3 / toNextDays=0");
    const si = S.stageInfo({ id: "p", playCount: 2 }, 1, 9999);
    ok(si.need === 3 && si.toNext === 1 && si.bottleneck === "plays",
      "stageInfo：need=3（盘玩次数）/ toNext=1 / bottleneck=plays（⛔ 不受 days=9999 影响）");
  }

  /* ============ 3. C6 starMark ============ */
  section("3. C6 · starMarkOf / setStarMark / normRecV165");
  {
    const { S } = newS();
    ok(typeof S.starMarkOf === "function" && typeof S.setStarMark === "function", "starMarkOf/setStarMark 已导出");
    const rec = {};
    // ⛔ 负向对照友好：旧源码没有这两个函数时判 FAIL 而不是抛 TypeError 中断整份测试
    const hasSm = typeof S.starMarkOf === "function" && typeof S.setStarMark === "function";
    ok(!hasSm || S.starMarkOf(rec).starMark === false, "缺字段时 starMarkOf → false");
    if (hasSm) S.setStarMark(rec, true);
    ok(!hasSm || (rec.starMark === true && S.starMarkOf(rec).starMark === true), "setStarMark(true) 往返");
    if (hasSm) S.setStarMark(rec, false);
    ok(!hasSm || rec.starMark === false, "setStarMark(false) 往返");
    ok(!hasSm || S.setStarMark(null, true) === false, "setStarMark(null) 安全返回 false");
    const legacy = {};
    S.normRecV165(legacy);
    ok(legacy.starMark === false, "normRecV165 给旧存档补 starMark=false");
    ok(legacy.marks === undefined && legacy.flags === undefined, "⛔ starMark 是顶层字段，不进 marks/flags");
    ok(typeof S.harmedOf === "function", "harmedOf 仍在（⛔ 未重复造 harmed/harmCause）");
  }

  /* ============ 4 + 5. C5 服装解禁 ============ */
  section("4. C5 · 服装解禁：五处硬锁泛化（但仍禁现代/西式/日式）");
  {
    const { S } = newS();
    ok(typeof S.NEG_STYLE === "string" && !/hanfu/i.test(S.NEG_STYLE), "NEG_STYLE 无 hanfu 硬锁");
    ok(/no modern or Western clothing/.test(S.NEG_STYLE) && /strictly no Japanese elements/.test(S.NEG_STYLE),
      "NEG_STYLE 仍保留「禁现代/西式」与「禁日式」");
    // ⛔ GUOFENG 未对导出开放（只被 promptFor 内部拼装用）→ 走源码静态检查
    const src = fs.readFileSync(path.join(ROOT, SPIRITS_SRC), "utf8");
    const guofeng = (src.match(/const GUOFENG = "([\s\S]*?)";/) || [])[1] || "";
    ok(!!guofeng, "GUOFENG 定义存在（源码静态检查：未导出）");
    ok(!/hanfu/i.test(guofeng), "GUOFENG 无 hanfu 硬锁");
    ok(/costume follows this character's own imagery/i.test(guofeng), "GUOFENG 含「服装跟随本角色意象」");
    const cg = S.CG_STYLE || "";
    ok(typeof cg === "string" && !/hanfu/i.test(cg), "CG_STYLE 无 hanfu 硬锁");
    ok(/no modern or Western clothing/.test(cg) || /NEG_STYLE/.test(cg), "CG_STYLE 仍带负向约束");
    // STYLE_PRESETS.anime 在 spirits.js 内但未导出 —— 走源码静态检查
    const animeBlock = (src.match(/anime:\s*\{[\s\S]*?text:\s*([\s\S]*?)full body/s) || [])[1] || "";
    ok(!/hanfu/i.test(animeBlock), "STYLE_PRESETS.anime.text 无 hanfu 硬锁");
    const duoLine = (src.match(/two ancient Chinese characters in [^\n]*/) || [""])[0];
    ok(duoLine && !/hanfu/i.test(duoLine), "双人剧情 CG 无 hanfu 硬锁");
    // lookFromText 兜底
    ok(!/traditional hanfu attire/.test(src), "lookFromText 兜底不再是 \"traditional hanfu attire\"");
    ok(/classical Chinese-inspired attire/.test(src), "兜底改为 classical Chinese-inspired attire");
    // 文本模型两条
    ok(!/衣服一律写中式传统样式/.test(src), "personaFromBrief ⑩ 不再要求「衣服一律写中式传统样式」");
    ok(!/服装一律写中式传统样式/.test(src), "personaZh 不再要求「服装一律写中式传统样式」");
    ok(/不必一律汉服/.test(src), "文本模型两条均含「⛔ 不必一律汉服」新口径");
    ok(/绝对禁止出现任何现代\/西式服装|仍绝对禁止现代\/西式服装/.test(src), "⛔ 仍绝对禁止现代/西式服装");
    // 身份信息喂进 user 消息
    ok(/它的出处\/意象（服装风格要顺着这个来）/.test(src), "user 消息已追加「出处/意象」");
    ok(/胎性：/.test(src), "user 消息已追加「胎性」");
  }
  section("5. C5 · 意象词表：莫高窟 ⇒ Dunhuang；未命中回落且分布不变");
  {
    const { S } = newS();
    const ap1 = S.appearanceOf({ id: "a1", name: "莫高窟", playCount: 1 }, 0, "boy");
    ok(/Dunhuang mural style costume/.test(ap1.outfit), "item.name=莫高窟 ⇒ Dunhuang mural style costume（实际 " + ap1.outfit.slice(0, 40) + "）");
    ok(ap1.outfitSrc === "imagery", "命中时打 outfitSrc=imagery 标记");
    ok(/feitian silk ribbons/.test(ap1.outfit) && /beaded necklaces/.test(ap1.outfit) && /lotus motifs/.test(ap1.outfit),
      "莫高窟服饰含 feitian 披帛 / 珠饰 / 莲瓣纹");
    const ap2 = S.appearanceOf({ id: "a2", name: "敦煌飞天壁画", playCount: 1 }, 0, "girl");
    ok(/Dunhuang mural style costume/.test(ap2.outfit), "name=敦煌飞天壁画 ⇒ 同样命中");
    // 五组词表各自可命中
    const cases = [["和田玉佩", /jade-toned silk/], ["小银鱼", /silver filigree/], ["金刚菩提", /wood-toned/], ["雪月", /frost-white/]];
    cases.forEach(([nm, re]) => {
      const ap = S.appearanceOf({ id: "k" + nm, name: nm, playCount: 1 }, 0, "boy");
      ok(re.test(ap.outfit), "词表命中 " + nm + " ⇒ " + re);
    });
    // 未命中 ⇒ 走原 OUTFITS 池（outfitSrc 未设）
    const ap3 = S.appearanceOf({ id: "a3", name: "星月坛", playCount: 1 }, 0, "boy");
    ok(!ap3.outfitSrc, "name=星月坛 未命中 ⇒ 无 imagery 标记（走原 OUTFITS 池）");
    ok(/Chinese|robe|jin|beizi|tunic|cloak|sash|vest|top/.test(ap3.outfit), "未命中时仍是 OUTFITS 池里的中式兜底款");
    // 未命中 ⇒ 必须落在 OUTFITS 池内（真断言：从源码抽出池子逐条比对）
    const src5 = fs.readFileSync(path.join(ROOT, SPIRITS_SRC), "utf8");
    const pool = new Set();
    const poolBlk = (src5.match(/const OUTFITS = \[([\s\S]*?)\n\s*\];/) || [])[1] || "";
    (poolBlk.match(/en:\s*"([^"]+)"/g) || []).forEach((s) => pool.add(s.replace(/^en:\s*"/, "").replace(/"$/, "")));
    ok(pool.size >= 10, "OUTFITS 池可从源码抽出（" + pool.size + " 条，按令保留作兜底）");
    let allInPool = true;
    for (let i = 0; i < 12; i++) {
      const ap = S.appearanceOf({ id: "np" + i, name: "星月坛" + i, playCount: 1 }, 0, "boy");
      if (!pool.has(ap.outfit)) { allInPool = false; }
    }
    ok(allInPool, "未命中意象词表者：12/12 只的 outfit 均落在 OUTFITS 池内（分布不变）");
    ok(typeof S.appearanceOf === "function", "appearanceOf 可用");
  }
  section("5b. C5 修正 · 意象只认 item.name（⛔ species 不参与图像侧匹配）+ 语义优先级 + 导出");
  {
    const { S } = newS();
    const hasIm = typeof S.imageryOutfitOf === "function";   // 负向对照友好：旧源码没这函数时判 FAIL 而非崩
    ok(hasIm, "imageryOutfitOf 已导出（此前未导出，无法单测）");
    ok(Array.isArray(S.IMAGERY_OUTFITS) && S.IMAGERY_OUTFITS.length >= 5, "IMAGERY_OUTFITS 已导出");
    const imOf = (o) => (hasIm ? S.imageryOutfitOf(o) : null);
    // ① 主理人点名的三个 case（都带 species=菩提根）
    ok(/frost-white/.test(S.appearanceOf({ id: "c1", name: "雪月", species: "菩提根", playCount: 1 }, 0, "boy").outfit),
      "雪月 + 菩提根 ⇒ frost-white（⛔ 不得 wood-toned）");
    ok(!/wood-toned/.test(S.appearanceOf({ id: "c2", name: "雪月", species: "菩提根", playCount: 1 }, 0, "boy").outfit),
      "⛔ 雪月 未被木组抢走");
    const star = S.appearanceOf({ id: "c3", name: "星月坛", species: "菩提根", playCount: 1 }, 0, "boy");
    ok(!star.outfitSrc, "星月坛 + 菩提根 ⇒ 不命中（⛔ 品类不参与匹配），落回 OUTFITS 池");
    ok(imOf({ name: "星月坛", species: "菩提根" }) === null, "imageryOutfitOf('星月坛'+菩提根) === null");
    ok(/Dunhuang mural style costume/.test(S.appearanceOf({ id: "c4", name: "莫高窟", species: "菩提根", playCount: 1 }, 0, "boy").outfit),
      "莫高窟 + 菩提根 ⇒ Dunhuang（名称优先于品类）");
    // ② 语义优先级：具体意象组必须排在泛组（木）之前
    const order = (S.IMAGERY_OUTFITS || []).map((r) => r.zh);
    const iGeneric = order.indexOf("木");
    ok(iGeneric === order.length - 1, "木（泛组）排在词表最后（实际位置 " + iGeneric + "/" + (order.length - 1) + "）");
    ["敦煌飞天", "冰雪", "玉", "金属"].forEach((z) => {
      ok(order.indexOf(z) >= 0 && order.indexOf(z) < iGeneric, "具体意象组「" + z + "」优先级高于泛组「木」");
    });
    // ③ ⛔ species / category 单独出现时一律不命中（只有 name 能触发）
    ok(imOf({ name: "", species: "菩提根" }) === null, "⛔ name 为空、species=菩提根 ⇒ 不命中");
    ok(imOf({ species: "小叶紫檀" }) === null, "⛔ 只有 species 没有 name ⇒ 不命中");
    ok(imOf({ name: "星月坛", category: "菩提" }) === null, "⛔ category 不参与匹配");
    // ④ 7 个普通菩提根串名：⛔ 不得被统一压成同一材质
    const seven = ["星月坛", "花间酒", "砚池", "青梧", "云隐", "拾光", "缠枝"];
    const src7 = fs.readFileSync(path.join(ROOT, SPIRITS_SRC), "utf8");
    const allKeys = [];
    const tblBlk = (src7.match(/const IMAGERY_OUTFITS = \[([\s\S]*?)\n\s*\];/) || [])[1] || "";
    (tblBlk.match(/keys:\s*\[([^\]]*)\]/g) || []).forEach((g) =>
      (g.match(/"([^"]+)"/g) || []).forEach((w) => allKeys.push(w.replace(/"/g, ""))));
    const clean = seven.filter((n) => !allKeys.some((k) => n.indexOf(k) >= 0));
    ok(clean.length === seven.length, "这 7 个名字自证不含任何意象关键词（实际干净 " + clean.length + "/7）");
    const got = seven.map((n, i) => S.appearanceOf({ id: "s7_" + i, name: n, species: "菩提根", category: "菩提", playCount: 2 }, 0, "boy").outfit);
    ok(new Set(got).size > 1, "7 只菩提根串 outfit 未被统一压成同一材质（实得 " + new Set(got).size + " 种）");
    ok(got.every((o) => !/Dunhuang|jade-toned|silver filigree|frost-white|wood-toned/.test(o)),
      "7 只普通串均未误挂意象服饰（⛔ 不会被品类带偏）");
  }
  section("5c. 任务2 · normRecV165 给老存档补 imgStage（只补字段，绝不出图）");
  {
    const { S } = newS();
    ok(S.normRecV165.length >= 1, "normRecV165 存在");
    [[0, 1], [2, 1], [3, 2], [6, 3], [10, 4]].forEach(([plays, want]) => {
      const legacy = { imgUrl: "data:image/png;base64,OLD", imgAt: 1, flags: {} };   // 老存档：无 imgStage
      S.normRecV165(legacy, { id: "old" + plays, playCount: plays });
      ok(legacy.imgStage === want, "老存档 plays=" + plays + " ⇒ imgStage=" + want + "（实际 " + legacy.imgStage + "）");
    });
    const r2 = { stage: 3, imgUrl: "x" };
    S.normRecV165(r2);
    ok(r2.imgStage === 3, "无 item 时退回 rec.stage（=3）");
    // ⛔ 只补字段：imgUrl / imgAt 不得被改动，也不得触发任何出图副作用
    const legacy3 = { imgUrl: "data:image/png;base64,KEEP", imgAt: 12345 };

    S.normRecV165(legacy3, { id: "s", playCount: 10 });
    ok(legacy3.imgUrl === "data:image/png;base64,KEEP" && legacy3.imgAt === 12345,
      "⛔ 补 imgStage 不改动 imgUrl/imgAt（⛔ 未触发出图）");
    const added = Object.keys(legacy3).filter((k) => !(k in { imgUrl: 1, imgAt: 1 }));
    ok(added.length > 0 && added.every((k) => typeof legacy3[k] !== "function"),
      "新增字段全是纯数据、无函数副作用（新增 " + added.length + " 个：" + added.join(",") + "）");
    ok(added.indexOf("imgStage") >= 0, "其中确实包含 imgStage");
    const srcN = fs.readFileSync(path.join(ROOT, SPIRITS_SRC), "utf8");
    const normBlk = (srcN.match(/function normRecV165\([\s\S]*?\n  \}/) || [""])[0];
    ok(!/generateImage|pollinationsUrl|ensureBg|save\(/.test(normBlk), "⛔ normRecV165 函数体内无任何出图/落库调用");
    // 幂等：已有 imgStage 不被覆盖
    const r3 = { imgStage: 2, stage: 4 };
    S.normRecV165(r3, { id: "x", playCount: 10 });
    ok(r3.imgStage === 2, "已有 imgStage=2 时不被覆盖（幂等）");
  }

  /* ============ 6. C1 BG 文案 ============ */
  section("6. C1 · BG：21 条仍以 BG_STYLE 开头 / 含 no people, empty scene / 无人物向词");
  {
    const { S } = newS();
    const keys = Object.keys(S.BG_CATALOG || {});
    ok(keys.length === 21, "BG_CATALOG 21 条（实际 " + keys.length + "）");
    ok(typeof S.BG_STYLE === "string" && S.BG_STYLE.length > 0, "BG_STYLE 存在");
    ok(keys.every((k) => S.BG_CATALOG[k].prompt.indexOf(S.BG_STYLE) === 0), "21/21 以 BG_STYLE 开头");
    ok(keys.every((k) => /no people, empty scene/.test(S.BG_CATALOG[k].prompt)), "21/21 含 no people, empty scene");
    ok(typeof S.BG_NEG === "string" && S.BG_NEG.length > 0, "BG_NEG 存在（场景专用）");
    ok(keys.every((k) => S.BG_CATALOG[k].prompt.slice(-(S.BG_NEG || "").length) === S.BG_NEG), "21/21 以 BG_NEG 收尾");
    ok(keys.every((k) => !/hanfu/i.test(S.BG_CATALOG[k].prompt)), "21/21 无 hanfu 人物向污染");
    ok(!/gentle neutral expressions/.test(S.BG_NEG), "⛔ BG_NEG 已剔除 gentle neutral expressions");
    ok(/horror/.test(S.BG_NEG) && /eerie/.test(S.BG_NEG) && /creepy/.test(S.BG_NEG) && /ominous/.test(S.BG_NEG),
      "BG_NEG 含 horror/eerie/creepy/ominous 全集（去诡异感）");
    ok(typeof S.NEG_STYLE === "string", "⛔ NEG_STYLE 仍在（立绘/CG 专用，本次未动）");
  }

  /* ============ 7. C3 + C6 静态源检查（app.js） ============ */
  section("7. C3/C6 · app.js 接线（静态源检查）");
  {
    const app = readApp();
    ok(/id="townNewRoom"/.test(app), "C3：renderTownPage 有 #townNewRoom 建房入口");
    ok(/\$\("#townNewRoom"\);\s*if \(tr\)\s*tr\.onclick = \(\) => showRoomEditModal\(null\);/.test(app),
      "C3：#townNewRoom 绑到 showRoomEditModal(null)");
    ok(!/还没有屋子。回沁灵页建一间/.test(app), "C3：空态文案不再指向「回沁灵页」");
    ok(/还没有屋子。点上面/.test(app), "C3：空态文案改为就地引导");
    ok(/id="sdAdvance"/.test(app), "C6：详情页有 #sdAdvance 按钮");
    ok(/进阶 · 重画本阶立绘/.test(app) && /重画本阶立绘/.test(app), "C6：#sdAdvance 文案随阶动态（进阶/化形两态）");
    ok(/rec\.imgStage = stage \|\| rec\.stage \|\| 1;/.test(app), "C6：saveSpiritImage 写入 rec.imgStage");
    ok(/function stageImgPending/.test(app), "C6：stageImgPending 判定函数存在");
    ok(/imgStage != null/.test(app) && /< Spirits\.stageOf\(item, rec, Date\.now\(\)\)/.test(app),
      "C6：阶段补画判定 = imgStage < stageOf（且 imgStage 为 null 时不触发）");
    ok(/id="sdStageImgFix"/.test(app) && /本阶立绘还没画出来/.test(app), "C6：本阶立绘欠图时有可点补画入口");
    // ⛔ 本次改动不得引入任何与「阶段补画」相关的定时器
    //   （app.js 里本来就有两个与本改动无关的 setInterval：离线重试 2470 / 沁灵同步 9083 —— 不断言它们）
    ok(!/setInterval\s*\([^)]*imgStage/.test(app), "⛔ 无 imgStage 相关 setInterval");
    ok(!/setTimeout\s*\([^)]*imgStage/.test(app), "⛔ 无 imgStage 相关 setTimeout");
    ok(!/imgStage[^;\n]*setTimeout|setTimeout[^;\n]*imgStage/.test(app), "⛔ imgStage 与定时器无任何耦合");
    ok(!/再陪\s*' \+ si\.toNext \+ " 天"/.test(app), "C4：⛔ 界面不再出现「再陪 N 天」");
  }

  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
})();
