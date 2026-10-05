/* ============================================================
 * _test_v175_daily.js · V175 批次1「今日任务重做」回归红测
 * ------------------------------------------------------------
 * ⚠️ 本文件在 **V175 落地前一直为红测**（red test）：它断言源码里
 *      (a) app.js 有 ≥3 处 Game.markDaily 真实调用点（五类行为）
 *      (b) app.js 有 Game.claimTask 调用（领奖入口）
 *      (c) DAILY_TEMPLATES 每条 desc 含跳转目标或沁灵占位 {name}
 *      (d) game.js 有目标沁灵绑定（spiritPool/dailyTargets/actKeyOf/actDoneOf）
 *
 * 基准：`90bccf2`（V175 落地前）。本测试**只按字符串**判定，
 *       不 require/运行 js、不依赖 DOM、不读 localStorage。
 * 用法： node docs/_test_v175_daily.js                    （默认读 ../js）
 * 负向对照： V175_SRC_DIR=<90bccf2 导出的 js 目录> node docs/_test_v175_daily.js ⇒ 必须红
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = process.env.V175_SRC_DIR || path.join(ROOT, "js");
function rd(f) {
  try { return fs.readFileSync(path.join(SRC, f), "utf8").replace(/\r/g, ""); }
  catch (e) { return ""; }
}
const APP = rd("app.js");
const GAME = rd("game.js");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

console.log("V175 今日任务回归　基准目录：" + SRC);
console.log("------------------------------------------------------------");

/* ---------- A · markDaily 真实调用点 ---------- */
section("A · Game.markDaily 真实调用点（app.js ≥3 处，覆盖五类行为）");
const callCount = (APP.match(/Game\.markDaily\s*\(/g) || []).length;
const argsAll = [];
{
  const re = /Game\.markDaily\(([^;]{0,80}?)\)/g;
  let m;
  while ((m = re.exec(APP))) argsAll.push(m[1]);
}
ok(callCount >= 3, "app.js 里 Game.markDaily( 调用点 ≥3 处（实测 " + callCount + "）");
["play", "reply", "greet", "night"].forEach((a) => {
  ok(argsAll.some((x) => x.indexOf('"' + a) >= 0 || x.indexOf("'" + a) >= 0),
    "存在「" + a + "」行为的 markDaily 挂钩（实得：" + (argsAll.join(" ｜ ") || "无") + "）");
});
ok(argsAll.some((x) => /kind/.test(x)),
  "照料三式（clean / sit / thread）经由 kind 变量挂钩（实得：" + (argsAll.join(" ｜ ") || "无") + "）");

/* ---------- B · claimTask 接线 ---------- */
section("B · Game.claimTask 领奖接线（app.js）");
ok(/Game\.claimTask\s*\(/.test(APP), "app.js 调 Game.claimTask（任务页有领奖入口）");

/* ---------- C · 五条任务 desc 含跳转目标或沁灵占位 ---------- */
section("C · DAILY_TEMPLATES 每条 desc 含跳转目标或沁灵占位");
const tm = /const DAILY_TEMPLATES = \[([\s\S]*?)\n  \];/.exec(GAME);
const block = tm ? tm[1] : "";
["jingshou", "peizuo", "kanwen", "shoudeng", "yingsheng"].forEach((id) => {
  const line = block.split("\n").filter((l) => l.indexOf('id: "' + id + '"') >= 0)[0] || "";
  ok(!!line, "DAILY_TEMPLATES 含 " + id);
  ok(/\{name\}/.test(line) || /#\//.test(line) || /详情页|夜话/.test(line),
    id + " · desc 含跳转目标或沁灵占位（" + (line.trim().slice(0, 70) || "未找到该行") + "）");
});

/* ---------- D · 目标沁灵绑定（game.js） ---------- */
section("D · 目标沁灵绑定（game.js）");
ok(/function spiritPool/.test(GAME), "spiritPool：在册沁灵候选池");
ok(/function dailyTargets/.test(GAME), "dailyTargets：按日期种子给每条任务指定目标沁灵");
ok(/seededShuffle\(/.test(GAME), "沿用 seededShuffle（日期种子，当天固定、跨设备一致）");
ok(/function actKeyOf/.test(GAME), "actKeyOf：acts 键带 spiritId（如 play:<id>）");
ok(/function actDoneOf/.test(GAME), "actDoneOf：按 actKey 判定完成");
ok(/function claimTask/.test(GAME) && /claimTask/.test(GAME), "claimTask 仍在（奖励只走 addGift）");

console.log("------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
console.log(FAIL > 0
  ? "⇒ 红测（V175 落地前为红，属预期）"
  : "⇒ 全绿：V175 今日任务接线已落地");
process.exit(FAIL > 0 ? 1 : 0);
