/* P0 · 化形（stage 4）可达性自测 —— 对应修复：STAGE 数组前导占位对齐（长度 5）
 *
 * 修复语义（本测试钉死的设计，与 docs/v164m 的 OR 设计无关）：
 *   - 原 bug：STAGE_DAYS/STAGE_PLAYS 长度只有 4（索引 0..3），但 stageOf 循环
 *     `for (k=2;k<=4;k++)` 访问 STAGE_DAYS[4]/STAGE_PLAYS[4] 得 undefined，
 *     `days >= undefined` 恒 false → 化形（第 4 阶）永久不可达。
 *   - 修复：两数组各补一个前导占位 0，对齐同文件 HEAD_COUNT 的长度 5 约定：
 *       STAGE_DAYS  = [0, 0,   7,  30, 120];   // 开窍7天 / 蜕形30天 / 化形120天
 *       STAGE_PLAYS = [0, 0,   5,  20,  60];    // 开窍5次 / 蜕形20次 / 化形60次
 *   - 进度判定保持原 AND 语义：天数 ∧ 次数 双达标才晋阶（不引入新机制）。
 *
 * 用法：
 *   node docs/_test_stage4_reachable.js
 * 退出码 0 = 全部通过；非 0 = 有断言失败。
 */
"use strict";
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const h = makeContext();
loadFile(h.ctx, "js/spirits.js");
const SP = h.sandbox.Spirits;
if (!SP) { console.error("Spirits 未加载"); process.exit(2); }

/* 造一只「挂瓷 N 天 + 盘 M 次」的串。
   bornAt 用「今天 00:00 − N 天」：dayNoOf() 会把两端抹到 00:00 再取整，避免边界偏移。 */
const midnight = (d) => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime() - d * 86400000; };
const mk = (days, plays) => ({
  id: "it_x", name: "测试串", category: "菩提", species: "星月",
  playCount: plays,
  createdAt: midnight(days),
});
const stageOf = (days, plays) => SP.stageOf(mk(days, plays), { bornAt: midnight(days) }, Date.now());

/* ============ A. 数组结构：长度 5 + 前导占位，索引 4 不再 undefined ============ */
section("A. 门槛数组结构（前导占位对齐 HEAD_COUNT，长度 5）");
{
  const D = SP.STAGE_DAYS, P = SP.STAGE_PLAYS;
  ok(Array.isArray(D) && D.length === 5, "STAGE_DAYS 长度 = 5（实测 " + (D && D.length) + "）：" + JSON.stringify(D));
  ok(Array.isArray(P) && P.length === 5, "STAGE_PLAYS 长度 = 5（实测 " + (P && P.length) + "）：" + JSON.stringify(P));
  const HC = SP.HEAD_COUNT;
  ok(HC && HC.length === 5, "HEAD_COUNT 长度 = 5（同文件约定，实测 " + (HC && HC.length) + "）");
  ok(D && D[4] != null && P && P[4] != null, "🔴 index 4（化形）不再是 undefined —— 这是本 bug 的根因");
  ok(D && D[0] === 0 && P && P[0] === 0, "index 0 是占位 0");
  ok(D && D[1] === 0 && P && P[1] === 0, "index 1（凝形）是起点 0");
  ok(D && D[2] === 7 && P && P[2] === 5, "开窍门槛 = 7 天 / 5 次（实测 " + D[2] + " / " + P[2] + "）");
  ok(D && D[3] === 30 && P && P[3] === 20, "蜕形门槛 = 30 天 / 20 次（实测 " + D[3] + " / " + P[3] + "）");
  ok(D && D[4] === 120 && P && P[4] === 60, "化形门槛 = 120 天 / 60 次（实测 " + D[4] + " / " + P[4] + "）");
  ok(D[2] < D[3] && D[3] < D[4], "天数门槛递增 7 → 30 → 120");
  ok(P[2] < P[3] && P[3] < P[4], "次数门槛递增 5 → 20 → 60");
}

/* ============ B. 化形可达（本修复的核心验收） ============ */
section("B. 化形（stage 4）可达 —— 本修复存在的唯一理由");
{
  // AND 语义：天数与次数双达标才晋阶；修复前 k=4 越界取 undefined → 恒为 3
  ok(stageOf(120, 60) === 4, "🔴 120 天 + 60 次 → 化形（实测 " + stageOf(120, 60) + "）");
  ok(stageOf(121, 61) === 4, "121 天 + 61 次 → 化形（实测 " + stageOf(121, 61) + "）");
  ok(stageOf(200, 60) === 4, "200 天 + 60 次 → 化形（天数远超、次数刚够，实测 " + stageOf(200, 60) + "）");
  ok(stageOf(120, 200) === 4, "120 天 + 200 次 → 化形（天数刚够、次数远超，实测 " + stageOf(120, 200) + "）");
  ok(stageOf(1000, 1000) === 4, "极端：1000 天 + 1000 次 → 化形（实测 " + stageOf(1000, 1000) + "）");
}

/* ============ C. AND 边界：双条件缺一即卡在上阶（不误判化形） ============ */
section("C. AND 边界：天数/次数任一差一点就卡在蜕形");
{
  ok(stageOf(119, 60) === 3, "天数差 1（119<120）→ 仍蜕形（实测 " + stageOf(119, 60) + "）");
  ok(stageOf(120, 59) === 3, "次数差 1（59<60）→ 仍蜕形（实测 " + stageOf(120, 59) + "）");
  ok(stageOf(119, 59) === 3, "天数+次数都差 1 → 蜕形（实测 " + stageOf(119, 59) + "）");
}

/* ============ D. 阶梯完整（修复不应破坏低阶判定） ============ */
section("D. 低阶判定回归（修复只动数组，进度逻辑不变）");
{
  ok(stageOf(0, 0) === 1, "0 天 0 次 → 凝形（实测 " + stageOf(0, 0) + "）");
  ok(stageOf(7, 5) === 2, "7 天 + 5 次 → 开窍（实测 " + stageOf(7, 5) + "）");
  ok(stageOf(30, 20) === 3, "30 天 + 20 次 → 蜕形（实测 " + stageOf(30, 20) + "）");
  ok(stageOf(6, 5) === 1, "6 天（<7）+ 5 次 → 凝形（天数未达，实测 " + stageOf(6, 5) + "）");
  ok(stageOf(7, 4) === 1, "7 天 + 4 次（<5）→ 凝形（次数未达，实测 " + stageOf(7, 4) + "）");
  ok(stageOf(29, 20) === 2, "29 天（<30）+ 20 次 → 开窍（天数未达蜕形，实测 " + stageOf(29, 20) + "）");
}

const pass = summary();
process.exit(pass ? 0 : 1);
