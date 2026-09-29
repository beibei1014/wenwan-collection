/* v163b 自测：衣服颜色必须读「人设原文」
   背景（用户原话）：「我写了月白淡紫的衣服颜色，你还给我出了棕黄的衣服」
   旧逻辑 lookOf 只读 lk.outfitColor（几乎没人填），兜底珠子主色 → 木串全出棕黄。
   新逻辑：扫 rec.look.base / profile / personaZh 里**紧贴服装词**的色名，优先级压过珠子色。
   用法：node docs/_test_v163b_color.js
*/
"use strict";
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const h = makeContext();
loadFile(h.ctx, "js/spirits.js");
const S = h.sandbox.Spirits;

function mkItem(id) {
  return { id: id || "it0", name: "小测试", category: "菩提", species: "星月", color: "棕黄", playCount: 0 };
}

section("A. 人设写了衣服颜色 → 必须被读出来（不再出棕黄）");
{
  const it = mkItem();
  const rec = { look: { base: "一个穿月白淡紫长衫的小姑娘" }, gender: "girl", appearanceSeed: 1 };
  const lk = S.lookOf(it, rec);
  ok(!!lk.outfitZh, "提炼出衣服色名 outfitZh=" + lk.outfitZh);
  ok(/月白|淡紫|紫|白/.test(lk.outfitZh || ""), "色名确实来自人设原文：" + lk.outfitZh);
  ok(!!lk.outfitEn && lk.outfitEn !== "brown" && lk.outfitEn !== "dark brown",
    "英文色词不再是珠子棕黄：outfitEn=" + lk.outfitEn);
}

section("B. 人设没写颜色 → 回落珠子主色（不瞎编）");
{
  const it = mkItem();
  const rec = { look: { base: "一个安静的小姑娘" }, gender: "girl", appearanceSeed: 1 };
  const lk = S.lookOf(it, rec);
  ok(!lk.outfitZh, "没写颜色时不提炼，outfitZh 为空");
  ok(!!lk.outfitEn, "仍回落珠子主色，outfitEn=" + lk.outfitEn);
}

section("C. 衣服色不能污染发色（两条线分开）");
{
  const it = mkItem();
  const rec = {
    look: { base: "穿月白淡紫长衫", hairc: "custom", customColor: "#3b2b1c" },
    gender: "girl", appearanceSeed: 1,
  };
  const lk = S.lookOf(it, rec);
  ok(!!lk.outfitZh && /月白|紫|白/.test(lk.outfitZh), "衣服色仍来自人设：" + lk.outfitZh);
  ok(lk.hairSrc === "custom", "发色仍走用户自定义，hairSrc=" + lk.hairSrc);
}

section("D. 发色词不被误当成衣服色（只认贴着服装词的）");
{
  const it = mkItem();
  // 只写了发色，没提衣服 → 衣服色应保持为空（回落珠子色）
  const rec = { look: { base: "一头乌黑长发的小姑娘" }, gender: "girl", appearanceSeed: 1 };
  const lk = S.lookOf(it, rec);
  ok(!lk.outfitZh, "只写发色时不误判为衣服色，outfitZh 为空");
}

section("E. extractLookBrief 与 lookOf 同源（确认卡和出图不打架）");
{
  const it = mkItem();
  const rec = { look: { base: "穿月白淡紫长衫的小姑娘" }, gender: "girl", appearanceSeed: 1 };
  const br = S.extractLookBrief(rec, it);
  const cloths = (br.colors || []).filter((c) => c.part === "衣");
  ok(cloths.length > 0, "确认卡里有「衣」这一项");
  const lk = S.lookOf(it, rec);
  // v164：卡片按色名**逐个**列出（用户可以单独改），lookOf.outfitZh 是拼起来的串 —— 语义必须一致
  const joined = cloths.map((c) => c.cn).join("");
  ok(joined.indexOf("月白") >= 0 && /紫/.test(joined),
    "确认卡衣服色与 lookOf 同源：" + joined + " / " + lk.outfitZh);
  ok(joined.indexOf("月白") >= 0 && (lk.outfitZh || "").indexOf("月白") >= 0,
    "两边都认到「月白」，不会一边棕黄一边月白");
  ok(!!br.outfitZh && br.outfitZh.indexOf("长衫") >= 0 && br.outfitZh.indexOf("姑娘") < 0,
    "服饰字段裁到服装词结尾（没带上「的小姑娘」）：" + br.outfitZh);
}

summary();
