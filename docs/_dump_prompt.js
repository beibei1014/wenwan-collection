/* 临时排查脚本：把四个阶段的立绘 prompt 原样打出来，看「头身比」到底有没有进去、在哪一段 */
"use strict";
const path = require("path");
const { makeContext, loadFile } = require("./_harness.js");

const h = makeContext();
loadFile(h.ctx, "js/spirits.js");
const SP = h.sandbox.Spirits;

const item = {
  id: "it_huajianjiu", name: "花间酒", category: "菩提", species: "星月",
  color: "浅花", playCount: 9, softness: "slight",
  createdAt: Date.now() - 86400000 * 24,
};

for (let s = 1; s <= 4; s++) {
  const p = SP.promptFor(item, "anime", s);
  console.log("\n================ 阶段 " + s + " ================");
  console.log(p);
  console.log("--- 长度 " + p.length + " 字符 ---");
  const segs = p.split(", ");
  segs.forEach((x, i) => { if (/head|tall|chibi|proportion|body/i.test(x)) console.log("  [seg " + i + "] " + x); });
}
