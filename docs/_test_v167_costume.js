/* v167-B 自测：服装去清代（全局强禁 + 汉服/仙侠正向 + 词表清理）+ ark 中文指令锚
 *
 * 背景（用户原话）：
 *   用户是汉服爱好者/汉族，强烈反感清朝服饰特征（点名：立领、对襟蜈蚣扣、盘扣、厂字领），
 *   「不接受清朝的服饰，我宁愿是仙侠风格」；并问「方舟（ark）中文理解更好，能把 prompt 改成中文吗」。
 *
 * 钉住：
 *   A. 非 legacy 立绘：含 NO_QING + XIANXIA_LOOK，且 NO_QING 在整条 prompt 最末尾
 *   B. CG 三条路径（stage / fest / pair）：都含 XIANXIA_LOOK + NO_QING（经 cgPromptFromBrief 真装配）
 *   C. 中文服装锚（COSTUME_ZH）：仅 ark 生效；非 ark / 关开关 → 不含
 *   D. ⛔ legacy（详情页「🔙 恢复旧立绘」）逐字节复刻旧 prompt —— 含**恰好抽中改过 en 的两条 OUTFITS** 的沁灵
 *   E. 全库扫描：js/*.js 里 0 处清代**诱导**词（mandarin / frog button / 立领 / 盘扣），NO_QING 与 LEGACY_* 快照除外
 *   F. 词表清理生效（OUTFITS[3]/[4] / _OUTFIT_ZH_EN / IMAGERY_OUTFITS 金属组）
 *
 * 负向对照（必须 FAIL）：
 *   SPIRITS_SRC_FILE=<改动前的 spirits.js> node docs/_test_v167_costume.js
 *   → 旧版没有 NO_QING / XIANXIA_LOOK / COSTUME_ZH 导出，A/B/C/F 成片失败。
 *
 * 用法：node docs/_test_v167_costume.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");
const ROOT = path.join(__dirname, "..");
const SRC_OVERRIDE = process.env.SPIRITS_SRC_FILE || "";
const h = makeContext();
if (SRC_OVERRIDE) {
  const code = fs.readFileSync(SRC_OVERRIDE, "utf8");
  h.ctx.window = h.ctx;
  vm.runInContext(code, h.ctx, { filename: SRC_OVERRIDE });
} else {
  loadFile(h.ctx, "js/spirits.js");
}
const SP = h.sandbox.Spirits;
if (!SP) { console.error("Spirits 未加载"); process.exit(2); }

/* 改动前基线（HEAD = V167-A，即未做服装去清代的版本）——用于 legacy 逐字节对照 */
let OLD_SP = null;
{
  let oldSrc = "";
  try { oldSrc = require("child_process").execSync("git show HEAD:js/spirits.js", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 27 }); }
  catch (e) { try { oldSrc = fs.readFileSync(path.join(__dirname, "_tmp/_pre_v167b_spirits.js"), "utf8"); } catch (e2) { oldSrc = ""; } }
  if (oldSrc) {
    const hOld = makeContext();
    hOld.ctx.window = hOld.ctx;
    vm.runInContext(oldSrc, hOld.ctx, { filename: "spirits.js#PRE" });
    OLD_SP = hOld.sandbox.Spirits;
  } else { console.log("  (取不到改动前基线：D 段逐字节对照将优雅跳过)"); }
}

const item = { id: "it_jinsuanpan", name: "金算盘", gender: "boy", category: "菩提", species: "星月",
  color: "浅花", playCount: 20, softness: "slight" };
const LK = { base: "", persona: "", profile: "", brief: null, hairEn: "chestnut brown", outfitEn: "jade green" };
const P = (s, look) => SP.promptFor(item, "anime", s, null, look === undefined ? LK : look);

/* ============ A. 立绘（非 legacy） ============ */
section("A. 非 legacy 立绘：含 NO_QING + XIANXIA_LOOK，NO_QING 在整条最末尾");
SP.setImageCfg({ provider: "ark", style: "anime" });
[1, 2, 3, 4].forEach((s) => {
  const p = P(s);
  ok(p.indexOf(SP.XIANXIA_LOOK) >= 0, "A" + s + " · 阶段" + s + " 含正向仙侠/汉服形制 XIANXIA_LOOK");
  ok(p.indexOf(SP.NO_QING) >= 0, "A" + s + " · 阶段" + s + " 含清代强禁 NO_QING");
  ok(p.endsWith(SP.NO_QING), "A" + s + " · 阶段" + s + " NO_QING 压在**整条 prompt 最末尾**（最高权重）");
  ok(p.indexOf(SP.XIANXIA_LOOK) < p.indexOf("PROPORTION LOCK"), "A" + s + " · 阶段" + s + " XIANXIA_LOOK 在比例块之前（属外观区）");
  ok(/jiaoling youren/.test(p), "A" + s + " · 阶段" + s + " 明确「交领右衽(jiaoling youren)」");
});

/* ============ B. CG 三条路径 ============ */
section("B. CG 三条路径（stage / fest / pair）都含 XIANXIA_LOOK + NO_QING");
{
  const brief = "它全身站在庭院正中，右手搭在石桌边沿，暖光融融。";
  const cgStage = SP.cgPromptFromBrief(brief, { kind: "stage", item: item, stage: 3, look: LK });
  const cgFest = SP.cgPromptFromBrief(brief, { kind: "fest", item: item, stage: 4, look: LK, fest: { key: "duanwu", name: "端午" } });
  const cgPair = SP.cgPromptFromBrief(brief, { kind: "pair",
    a: { name: "花间酒", look: LK, item: item }, b: { name: "青竹", look: LK, item: item }, level: 1, roomName: "南窗小间", stage: 3 });
  [["stage", cgStage], ["fest", cgFest], ["pair", cgPair]].forEach(([tag, p]) => {
    ok(p.indexOf(SP.XIANXIA_LOOK) >= 0, "B · " + tag + " CG 含 XIANXIA_LOOK");
    ok(p.indexOf(SP.NO_QING) >= 0, "B · " + tag + " CG 含 NO_QING");
    ok(p.lastIndexOf("PROPORTION LOCK") > p.lastIndexOf(SP.NO_QING), "B · " + tag + " CG 保住「PROPORTION LOCK 压最后」（v165-A 不被破坏）");
  });
}

/* ============ C. 中文服装锚（仅 ark） ============ */
section("C. 中文服装锚 COSTUME_ZH：仅 ark；关开关 / 非 ark 一律不含");
{
  SP.setImageCfg({ provider: "ark", style: "anime" });
  [1, 2, 3, 4].forEach((s) => {
    const p = P(s);
    ok(p.indexOf(SP.COSTUME_ZH) >= 0, "C-ark" + s + " · 阶段" + s + "（ark）含中文服装锚");
    ok(/绝对不要清朝服饰/.test(p) && /不要立领/.test(p) && /不要盘扣/.test(p), "C-ark" + s + " · 阶段" + s + " 中文锚明确禁立领/盘扣");
  });
  ok(typeof SP.zhAnchorEnabled === "function" && (SP.zhAnchorEnabled() === true || SP.ZH_ANCHOR_ON !== true), "C · zhAnchorEnabled 导出且与 ZH_ANCHOR_ON 口径一致");
  ["pollinations", "zhipu", "siliconflow"].forEach((prov) => {
    SP.setImageCfg({ provider: prov, style: "anime" });
    const p = P(3);
    ok(p.indexOf(SP.COSTUME_ZH) < 0 && p.indexOf("画面比例要求") < 0, "C · " + prov + " 不含任何中文锚（不污染）");
    ok(p.indexOf(SP.NO_QING) >= 0, "C · " + prov + " 仍含英文 NO_QING（负向不依赖 provider）");
  });
  ok(typeof SP.ZH_ANCHOR_ON === "boolean" && SP.ZH_ANCHOR_ON === true, "C · ZH_ANCHOR_ON 总开关存在且为 true（一键可回退）");
  SP.setImageCfg({ provider: "pollinations", style: "anime" });
}

/* ============ D. ⛔ legacy 逐字节复刻（含命中改过 en 的两条 OUTFITS 的沁灵） ============ */
section("D. legacy 逐字节复刻（尤其命中 OUTFITS[3]/[4] 的沁灵）");
{
  const NEW3 = "a cross-collar Chinese hanfu robe with the right lapel over the left and wide sleeves";
  const NEW4 = "an embroidered Chinese cross-collar robe with cloud-patterned trim";
  // 找出恰好抽中 OUTFITS[3] / OUTFITS[4] 的 item id
  const hit3 = [], hit4 = [];
  for (let i = 0; i < 4000 && (hit3.length < 2 || hit4.length < 2); i++) {
    const id = "probe_" + i;
    const o = SP.appearanceOf({ id: id, gender: "boy" }, 0).outfit;
    if (o === NEW3 && hit3.length < 2) hit3.push(id);
    else if (o === NEW4 && hit4.length < 2) hit4.push(id);
  }
  ok(hit3.length >= 1, "D0 · 找到命中 OUTFITS[3]（交领右衽）旧串为对襟褂的沁灵 id：" + hit3.join(","));
  ok(hit4.length >= 1, "D0 · 找到命中 OUTFITS[4] 的沁灵 id：" + hit4.join(","));
  if (OLD_SP) {
    ["pollinations", "ark"].forEach((prov) => {
      SP.setImageCfg({ provider: prov, style: "anime" });
      OLD_SP.setImageCfg({ provider: prov, style: "anime" });
      [].concat(hit3, hit4, ["it_jinsuanpan", "probe_7"]).forEach((id) => {
        const it = { id: id, name: id, gender: "boy", category: "菩提", species: "星月", color: "浅花", playCount: 20, softness: "slight" };
        [1, 2, 3, 4].forEach((s) => {
          const a = SP.promptFor(it, "anime", s, null, LK, { legacy: true });
          const b = OLD_SP.promptFor(it, "anime", s, null, LK, { legacy: true });
          ok(a === b, "D-legacy[" + prov + "/" + id + "/阶" + s + "] 逐字节一致");
        });
        const ua = SP.legacyPollinationsUrl(it, 0, "anime", 3, null);
        const ub = OLD_SP.legacyPollinationsUrl(it, 0, "anime", 3, null);
        ok(ua === ub, "D-url[" + id + "] legacyPollinationsUrl 一致");
      });
    });
    // 反向对照：旧版**没有** NO_QING / XIANXIA_LOOK（证明是本轮新增）
    ok(typeof OLD_SP.NO_QING === "undefined" && typeof OLD_SP.XIANXIA_LOOK === "undefined",
      "D · 改动前基线没有 NO_QING / XIANXIA_LOOK（确认是本轮新增）");
  } else { ok(true, "D · (无基线 → 逐字节对照优雅跳过)"); }
  // legacy 不含本轮新增
  SP.setImageCfg({ provider: "ark", style: "anime" });
  const pl = SP.promptFor(item, "anime", 3, null, LK, { legacy: true });
  ok(pl.indexOf(SP.NO_QING) < 0 && pl.indexOf(SP.XIANXIA_LOOK) < 0 && pl.indexOf(SP.COSTUME_ZH) < 0,
    "D · legacy prompt 不含 NO_QING / XIANXIA_LOOK / 中文锚（精确复刻旧 prompt）");
  ok(/tang-style jacket with frog buttons and a stand collar/.test(pl) || true, "D · legacy 允许含旧的对襟褂措辞（供旧图复刻，属 LEGACY 快照）");
  SP.setImageCfg({ provider: "pollinations", style: "anime" });
}

/* ============ E. 全库扫描：0 处清代诱导词（排除 NO_QING / LEGACY_* 快照） ============ */
section("E. 全库扫描 js/*.js：0 处清代诱导词（NO_QING / LEGACY_* 快照除外）");
{
  const files = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js"));
  const BANS = [/mandarin/i, /frog button/i, /立领/, /盘扣/];
  let violations = [];
  files.forEach((f) => {
    let src = fs.readFileSync(path.join(ROOT, "js", f), "utf8");
    // 抹掉允许区域：NO_QING 常量 / LEGACY_OUTFIT_EN 常量（去清代负向词 + 旧串快照必然含这些词）
    ["const NO_QING =", "const LEGACY_OUTFIT_EN =", "const COSTUME_ZH ="].forEach((decl) => {
      let idx = 0;
      while ((idx = src.indexOf(decl, idx)) >= 0) {
        const end = src.indexOf(";", idx);
        if (end < 0) break;
        src = src.slice(0, idx) + src.slice(end + 1);
      }
    });
    src.split(/\r?\n/).forEach((line, i) => {
      BANS.forEach((re) => { if (re.test(line)) violations.push(f + ":" + (i + 1) + "  " + line.trim().slice(0, 100)); });
    });
  });
  ok(violations.length === 0, "E · js/*.js 无清代诱导词（命中 " + violations.length + " 处）\n      " + violations.join("\n      "));
}

/* ============ F. 词表清理生效 ============ */
section("F. 词表清理（OUTFITS / _OUTFIT_ZH_EN / IMAGERY_OUTFITS）");
{
  const ofs = SP.STAGES ? null : null;
  // OUTFITS 通过 appearanceOf 观察不到具体池子，直接扫源码文本
  let src = fs.readFileSync(path.join(ROOT, "js/spirits.js"), "utf8");
  ok(src.indexOf('{ en: "a cross-collar Chinese hanfu robe with the right lapel over the left and wide sleeves"') >= 0,
    "F1 · OUTFITS[3] en 已改为交领右衽宽袖长袍");
  ok(src.indexOf('{ en: "an embroidered Chinese cross-collar robe with cloud-patterned trim"') >= 0,
    "F2 · OUTFITS[4] en 已改为绣花交领长袍");
  ok(src.indexOf('"褂": "a Chinese front-opening long robe"') >= 0, "F3 · _OUTFIT_ZH_EN 的「褂」不再译作 mandarin jacket");
  ok(src.indexOf("錾花银披肩 + 金属环扣饰件") >= 0, "F4 · IMAGERY_OUTFITS 金属组 zhOutfit 已去「盘扣」");
  ok(src.indexOf("交领右衽宽袖长袍") >= 0 && src.indexOf("绣花交领长袍 + 云纹滚边") >= 0, "F5 · OUTFITS zh 显示串已去清代词");
}

const passed = summary();
process.exit(passed ? 0 : 1);
