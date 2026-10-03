/* P0 · 多结局 flag 系统自测（v164n） —— 对应落地：js/spirits.js 多结局 flag 数据模型 + 岁除判定纯函数
 *
 * 验证三件事实，而非「理论上」：
 *   1. 导出项齐备（evaluateEnding / resolveEnding / setStance / 周目级写入入口 / ENDING_CFG）
 *   2. 不变量（设计 §四）：
 *        I1 · BE 仅当 ∃ 串 DECIDE && bondLv < SHIELD_MIN
 *        I2 · 大团圆/HE 需 LET+高亲；纯 DECIDE 全员高亲 → NE（HE_ALLOW_DECIDED=false）
 *        I4 · 系统绝不主动杀（LET/UNSET 低亲只导向 NE，不散）
 *   3. 存储衔接：rec.flags 落盘（不进 rec.marks）/ ww_story 周目级 flag 写入与默认值 /
 *        resolveEnding 缓存 bondLv 并写回 scattered
 *
 * 用法：
 *   node docs/_test_ending_flags.js
 * 退出码 0 = 全部通过；非 0 = 有断言失败。
 */
"use strict";
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const h = makeContext();
loadFile(h.ctx, "js/spirits.js");
const SP = h.sandbox.Spirits;
if (!SP) { console.error("Spirits 未加载"); process.exit(2); }

// 清空周目级 + 逐串存储，保证用例间隔离
function resetStore() {
  try { h.store.removeItem("ww_story"); } catch (e) {}
  try { h.store.removeItem("ww_spirits"); } catch (e) {}
}

section("0. 导出项齐备");
ok(typeof SP.evaluateEnding === "function", "evaluateEnding 导出");
ok(typeof SP.resolveEnding === "function", "resolveEnding 导出");
ok(typeof SP.setStance === "function", "setStance 导出");
ok(typeof SP.endingFlagsOf === "function", "endingFlagsOf 导出");
ok(typeof SP.getEndingStory === "function", "getEndingStory 导出");
ok(typeof SP.setForkStance === "function", "setForkStance 导出");
ok(typeof SP.addKeyChoice === "function", "addKeyChoice 导出");
ok(typeof SP.setKeyChoices === "function", "setKeyChoices 导出");
ok(typeof SP.setJointPrep === "function", "setJointPrep 导出");
ok(SP.ENDING_CFG && SP.ENDING_CFG.SHIELD_MIN === 5 && SP.ENDING_CFG.HE_BOND === 6 &&
   SP.ENDING_CFG.KEY_TOTAL === 3 && SP.ENDING_CFG.HE_ALLOW_DECIDED === false,
   "ENDING_CFG 常量正确（SHIELD_MIN=5 / HE_BOND=6 / KEY_TOTAL=3 / HE_ALLOW_DECIDED=false）");

section("A. 不变量 I1：BE 仅当 DECIDE + 低亲（bondLv < SHIELD_MIN=5）");
{
  const story = { FORK_STANCE: "LET", KEY_CHOICES: 3, JOINT_PREP: "FULL" };
  ok(SP.evaluateEnding(story, [{ stance: "DECIDE", bondLv: 3 }]) === "BE", "DECIDE + bondLv3(<5) → BE");
  ok(SP.evaluateEnding(story, [{ stance: "DECIDE", bondLv: 4 }]) === "BE", "DECIDE + bondLv4(<5) → BE");
  ok(SP.evaluateEnding(story, [{ stance: "DECIDE", bondLv: 5 }]) !== "BE", "DECIDE + bondLv5(=阈值) → 非 BE（>=5 不散）");
  ok(SP.evaluateEnding(story, [{ stance: "DECIDE", bondLv: 8 }, { stance: "DECIDE", bondLv: 3 }]) === "BE",
     "任一只 DECIDE+低亲 → BE");
}

section("B. 不变量：LET + 高亲 → 非 BE（含 FORK=DECIDE 但串全 LET 的情形）");
{
  const story = { FORK_STANCE: "LET", KEY_CHOICES: 3, JOINT_PREP: "FULL" };
  const r = SP.evaluateEnding(story, [{ stance: "LET", bondLv: 8 }, { stance: "LET", bondLv: 6 }]);
  ok(r !== "BE", "LET+高亲 → 非 BE（实测 " + r + "）");
  ok(r === "大团圆", "LET+全员高亲+选择全对+齐心协力 → 大团圆（实测 " + r + "）");
  const r2 = SP.evaluateEnding({ FORK_STANCE: "DECIDE", KEY_CHOICES: 3, JOINT_PREP: "FULL" },
    [{ stance: "LET", bondLv: 8 }]);
  ok(r2 !== "BE", "FORK=DECIDE 但串全 LET → 非 BE（实测 " + r2 + "）");
}

section("C. 不变量 I2：纯 DECIDE 全员高亲 → NE（HE_ALLOW_DECIDED=false）");
{
  const story = { FORK_STANCE: "DECIDE", KEY_CHOICES: 3, JOINT_PREP: "FULL" };
  const r = SP.evaluateEnding(story,
    [{ stance: "DECIDE", bondLv: 8 }, { stance: "DECIDE", bondLv: 7 }, { stance: "DECIDE", bondLv: 6 }]);
  ok(r !== "BE", "纯 DECIDE 但全员高亲 → 非 BE");
  ok(r === "NE", "纯 DECIDE 全员高亲(即便全对) → NE（HE_ALLOW_DECIDED=false，实测 " + r + "）");
  // 开关翻 true 时应当判 HE —— 验证开关确实生效（随后还原，不影响其它用例）
  const cfg = SP.ENDING_CFG, prev = cfg.HE_ALLOW_DECIDED;
  cfg.HE_ALLOW_DECIDED = true;
  ok(SP.evaluateEnding(story, [{ stance: "DECIDE", bondLv: 8 }, { stance: "DECIDE", bondLv: 7 }]) === "HE",
     "HE_ALLOW_DECIDED=true 时纯 DECIDE 高亲 → HE");
  cfg.HE_ALLOW_DECIDED = prev;
}

section("D. 裁定链全覆盖（大团圆 / HE / NE 分支可达，且 UNSET 不散）");
{
  ok(SP.evaluateEnding({ FORK_STANCE: "LET", KEY_CHOICES: 3, JOINT_PREP: "PARTIAL" },
     [{ stance: "LET", bondLv: 8 }]) === "HE", "LET+高亲+全对+准备一般 → HE");
  ok(SP.evaluateEnding({ FORK_STANCE: "LET", KEY_CHOICES: 1, JOINT_PREP: "FULL" },
     [{ stance: "LET", bondLv: 8 }]) === "NE", "LET+高亲+选择有错 → NE");
  ok(SP.evaluateEnding({ FORK_STANCE: "LET", KEY_CHOICES: 3, JOINT_PREP: "FULL" },
     [{ stance: "LET", bondLv: 3 }]) === "NE", "LET+个别低亲(非DECIDE) → NE（活着，差一线）");
  ok(SP.evaluateEnding({ FORK_STANCE: "UNSET", KEY_CHOICES: 3, JOINT_PREP: "FULL" },
     [{ stance: "LET", bondLv: 8 }, { stance: "DECIDE", bondLv: 8 }]) === "大团圆",
     "LET 数 >= DECIDE 数（tally）→ dominantLet → 大团圆");
  ok(SP.evaluateEnding({ FORK_STANCE: "UNSET", KEY_CHOICES: 0, JOINT_PREP: "NONE" },
     [{ stance: "UNSET", bondLv: 1 }]) !== "BE", "UNSET 串 → 非 BE（系统绝不主动杀）");
}

section("E. 存储衔接：逐串 stance 入口 + 周目级 flag 写入与默认值");
{
  resetStore();
  ok(SP.setStance("sp_a", "DECIDE") === true, "setStance('sp_a','DECIDE') 成功");
  ok(SP.setStance("sp_a", "BOGUS") === false, "setStance 非法值被拒（返回 false）");
  const f = SP.endingFlagsOf("sp_a");
  ok(f.stance === "DECIDE", "endingFlagsOf('sp_a').stance === 'DECIDE'（实测 " + f.stance + "）");
  const w0 = SP.getEndingStory();
  ok(w0.FORK_STANCE === "UNSET" && w0.KEY_CHOICES === 0 && w0.JOINT_PREP === "NONE" && w0.KEY_TOTAL === 3,
     "getEndingStory 默认值正确（UNSET/0/NONE/3）");
  SP.setForkStance("LET");
  ok(SP.getEndingStory().FORK_STANCE === "LET", "setForkStance('LET') 落 ww_story");
  SP.addKeyChoice(); SP.addKeyChoice(); SP.addKeyChoice(); SP.addKeyChoice();
  ok(SP.getEndingStory().KEY_CHOICES === 3, "addKeyChoice 单调增且封顶 KEY_TOTAL=3（实测 " + SP.getEndingStory().KEY_CHOICES + "）");
  SP.setJointPrep("PARTIAL"); SP.setJointPrep("FULL");
  ok(SP.getEndingStory().JOINT_PREP === "FULL", "setJointPrep 只升不降 → FULL");
  SP.setJointPrep("NONE");
  ok(SP.getEndingStory().JOINT_PREP === "FULL", "setJointPrep('NONE') 不降级（仍 FULL）");
}

section("F. resolveEnding：缓存 bondLv + 写回 scattered + 返回结局");
{
  resetStore();
  const store = SP.load();
  store["sp_x"] = { bond: 999, flags: { stance: "DECIDE", bondLv: 3, scattered: false } }; // 低亲 DECIDE → 应散
  store["sp_y"] = { bond: 999, flags: { stance: "LET", bondLv: 8, scattered: false } };    // 高亲 LET → 不散
  SP.save(store);
  SP.setForkStance("LET"); SP.setKeyChoices(3); SP.setJointPrep("FULL");
  const r = SP.resolveEnding();
  ok(r.ending === "BE", "resolveEnding → BE（存在 DECIDE+低亲，实测 " + r.ending + "）");
  const after = SP.load();
  ok(after["sp_x"].flags.scattered === true, "sp_x.flags.scattered 被写回 true（派生：DECIDE+不足）");
  ok(after["sp_y"].flags.scattered === false, "sp_y.flags.scattered 保持 false（LET 不散）");
}

const pass = summary();
process.exit(pass ? 0 : 1);
