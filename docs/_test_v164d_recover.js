/* v164d：恢复旧立绘 自测
   目标：验证「恢复旧立绘」用的 legacy prompt 能精确复刻 v164c 之前（9665c8e）的出图 URL。
   关键断言：
     A. 当前 prompt 含 v164c 新措辞（"first and youngest form" / PROPORTION LOCK），且不含旧 GROWTH_LINE。
     B. legacy prompt 含旧 GROWTH_LINE（"at an older age than the previous stage" / "do not keep the baby proportions"），不含 v164c 新措辞。
     C. 【精确还原】legacy prompt 字符串与 旧版(9665c8e) promptFor 逐字节相等 → legacyPollinationsUrl 与旧版 pollinationsUrl 逐字节相等。
     D. legacyPollinationsUrl 确实走 pollinations.ai 域名 + 同 seed。
   负向对照：把 legacy 关掉（普通 promptFor）再与旧版比，必须不相等（否则这条测试形同虚设）。*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const H = require("./_harness.js");
let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) { PASS++; } else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }

const item = { id: "test-bead-7f3a", softness: "", name: "测试珠", material: "黄花梨", theme: "山水" };

// 当前 spirits.js
const cur = H.makeContext();
H.loadFile(cur.ctx, "js/spirits.js");
const S = cur.sandbox.Spirits;
const curPrompt = S.promptFor(item, undefined, 1, undefined, undefined);
const curUrl = S.pollinationsUrl(item, 0);
const legPrompt = S.promptFor(item, undefined, 1, undefined, undefined, { legacy: true });
const legUrl = S.legacyPollinationsUrl(item, 0);

section("A. 当前 prompt 含 v164c 新措辞");
ok(/first and youngest form/.test(curPrompt), "当前 prompt 含 stage1 新成长句 'first and youngest form'");
ok(/PROPORTION LOCK/.test(curPrompt), "当前 prompt 含 PROPORTION LOCK 比例锁定块");
ok(!/at an older age than the previous stage/.test(curPrompt), "当前 prompt 不再含旧 GROWTH_LINE");

section("B. legacy prompt 复刻旧措辞、去掉 v164c 新措辞");
ok(/at an older age than the previous stage/.test(legPrompt), "legacy prompt 含旧 GROWTH_LINE");
ok(/do not keep the baby proportions/.test(legPrompt), "legacy prompt 含 'do not keep the baby proportions'");
ok(!/first and youngest form/.test(legPrompt), "legacy prompt 不含 v164c 新成长句");
ok(!/PROPORTION LOCK/.test(legPrompt), "legacy prompt 不含 PROPORTION LOCK");

section("C. 精确还原：legacy 必须 == 旧版(9665c8e) promptFor");
// 读旧版 spirits.js（commit 9665c8e）到独立上下文
const oldPath = process.env.OLD_SPIRITS_FILE || "C:/Users/18596/AppData/Local/Temp/old_spirits.js";
if (!fs.existsSync(oldPath)) {
  ok(false, "旧版 spirits.js 不存在于 " + oldPath + "（先 git show 9665c8e:js/spirits.js 导出）");
} else {
  const oldCtx = H.makeContext();
  const code = fs.readFileSync(oldPath, "utf8");
  vm.runInContext(code, oldCtx.ctx, { filename: "old_spirits.js" });
  const OS = oldCtx.sandbox.Spirits;
  const oldPrompt = OS.promptFor(item, undefined, 1, undefined, undefined);
  const oldUrl = OS.pollinationsUrl(item, 0);
  ok(legPrompt === oldPrompt, "legacy prompt 与旧版(9665c8e) promptFor 逐字节相等");
  ok(legUrl === oldUrl, "legacyPollinationsUrl 与旧版 pollinationsUrl 逐字节相等（同 seed、同 prompt → 同一张旧图）");
  // 负向对照：关掉 legacy 的普通 prompt 必须 != 旧版（证明 legacy 开关真在起作用）
  ok(curPrompt !== oldPrompt, "负向对照：当前 prompt != 旧版 prompt（legacy 开关确实改变了产物）");
  // 长度 sanity：URL 在合理范围（< 8KB）
  ok(legUrl.length < 8192, "legacy URL 长度合理 (" + legUrl.length + " chars)");
}

section("D. legacyPollinationsUrl 形态正确");
ok(/^https:\/\/image\.pollinations\.ai\/prompt\//.test(legUrl), "legacy URL 走 pollinations.ai 域名");
ok(/seed=/.test(legUrl), "legacy URL 带 seed（固定 → 还原到当时那张）");

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
