/* ============================================================
 * _test_v177_love.js · V177-D「恋爱线门控 + 结局判定接入 harmed」
 * ------------------------------------------------------------
 * ⚠️ 本文件在 **V177-D 落地前一直为红测**（red test）。覆盖：
 *      A · 导出项齐备（7 个入口 + LOVE_CFG 常量）
 *      B · 门控：stage<4 拒 / bondLv<7 拒 / 达标放行 / canConfess 口径
 *          🔴 无天数门槛：ctx.days=1 仍放行 + **源码层**证明 loveGate 体内零天数引用
 *      C · 多线并列（可开后宫）：两只串同时 accepted，互不影响
 *      D · setLovecall 填后不可改（locked）/ 空值拒收（empty）
 *      E · declineConfess 后能回 ready（婉拒不锁死）
 *      F · 结局判定接入 harmed：有效档位 −2 / 🔴 带伤永不致 BE /
 *          大团圆要求全员无伤 / HE 允许带伤 / 不带 harmed 字段时逐例回归
 *
 * 只按 vm 加载真 spirits.js（不碰 DOM，不跑 app.js）。
 * 基准：`b66fafb`（V177-D 落地前）。
 * 用法： node docs/_test_v177_love.js
 * 负向对照（🔴 必做）：
 *   git worktree add /tmp/_base b66fafb
 *   cp docs/_test_v177_love.js <worktree>/docs/ && cd <worktree> && node docs/_test_v177_love.js
 *   ⇒ 必须红（本文件绝大多数断言在基线上都不成立）
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const h = makeContext();
loadFile(h.ctx, "js/spirits.js");
const SP = h.sandbox.Spirits;
if (!SP) { console.error("Spirits 未加载"); process.exit(2); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "spirits.js"), "utf8").replace(/\r\n/g, "\n");

/* 基线（改动前）没有这些入口，直接调用会 throw → 兜底成"明显错误"的返回值，让断言报红而不是崩。 */
function safe(fn, fallback) {
  try { const v = fn(); return (v === undefined || v === null) ? fallback : v; }
  catch (e) { return fallback; }
}

const GATE_OK  = { stage: 4, bond: 200 };   // 阶 4（化形）+ 羁绊 200（lv1=7 相知）⇒ 达标
const GATE_LOW = { stage: 3, bond: 200 };   // 阶不足
const GATE_BND = { stage: 4, bond: 140 };   // 羁绊 lv1=6（同心）不足

section("A · 导出项齐备");
ok(typeof SP.loveGate === "function", "loveGate 已导出");
ok(typeof SP.loveStateOf === "function", "loveStateOf 已导出");
ok(typeof SP.openLoveLine === "function", "openLoveLine 已导出");
ok(typeof SP.setLoveState === "function", "setLoveState 已导出");
ok(typeof SP.acceptConfess === "function", "acceptConfess 已导出");
ok(typeof SP.declineConfess === "function", "declineConfess 已导出");
ok(typeof SP.setLovecall === "function", "setLovecall 已导出");
ok(!!SP.LOVE_CFG && SP.LOVE_CFG.STAGE_MIN === 4 && SP.LOVE_CFG.BOND_LV_MIN === 7,
   "LOVE_CFG = { STAGE_MIN:4, BOND_LV_MIN:7 }");

section("B · 门控（stage / bond / 无天数门槛）");
{
  const low = safe(() => SP.loveGate(GATE_LOW), { ok: true, reason: "" });
  ok(low.ok === false && low.reason === "stage", "stage=3(<4) → ok=false / reason=stage");

  const bnd = safe(() => SP.loveGate(GATE_BND), { ok: true, reason: "" });
  ok(bnd.ok === false && bnd.reason === "bond", "bondLv=6(<7) → ok=false / reason=bond");

  const pass = safe(() => SP.loveGate(GATE_OK), { ok: false, reason: "x" });
  ok(pass.ok === true && pass.reason === "" && pass.stage === 4 && pass.bondLv === 7,
     "stage=4 + bondLv=7 → 放行（ok=true / reason=''）");

  // item 分支：不传 rec.stage 时按 stageOf(item) 现算
  const byItem = safe(() => SP.loveGate({ stage: 1, bond: 200 }, { playCount: 10 }), { ok: false });
  ok(byItem.ok === true && byItem.stage === 4, "item.playCount=10 → stageOf 现算为 4 → 放行");

  const canNone = safe(() => SP.loveGate(Object.assign({}, GATE_OK, { loveState: "none" })), { canConfess: false });
  ok(canNone.canConfess === true, "state=none → canConfess=true");
  const canAcc = safe(() => SP.loveGate(Object.assign({}, GATE_OK, { loveState: "accepted" })), { canConfess: true });
  ok(canAcc.canConfess === false, "state=accepted（已在一起）→ canConfess=false");
  const canDec = safe(() => SP.loveGate(Object.assign({}, GATE_OK, { loveState: "declined" })), { canConfess: false });
  ok(canDec.canConfess === true, "state=declined（婉拒不锁死）→ canConfess=true");

  // 🔴 无天数门槛：days=1（刚认识第一天）也照样放行
  const d1 = safe(() => SP.loveGate(GATE_OK, null, { days: 1, dayNo: 1, plays: 0 }), { ok: false });
  ok(d1.ok === true, "ctx.days=1 / dayNo=1 → 仍放行（🔴 无天数门槛）");

  // 源码层证明：loveGate 函数体内**零**天数引用
  const m = /function loveGate\(rec, item, ctx\) \{[\s\S]*?\n  \}/.exec(SRC);
  const body = m ? m[0] : "";
  ok(!!body, "源码可定位 loveGate 完整函数体");
  ok(!!body && !/dayNo|days\b|bornAt|STAGE_DAYS/.test(body),
     "loveGate 函数体内无任何天数/章数引用（源码级证明无天数门槛）");
}

section("C · 多线并列（可开后宫：各串独立、互不排斥）");
{
  const A = "v177a", B = "v177b";
  ok(safe(() => SP.openLoveLine(A), false) === true, "openLoveLine(A) → true");
  ok(safe(() => SP.openLoveLine(B), false) === true, "openLoveLine(B) → true");
  const sa = safe(() => SP.loveStateOf(A), {}), sb = safe(() => SP.loveStateOf(B), {});
  ok(sa.state === "ready" && sa.loveOn === true, "A：loveOn=true / state=ready");
  ok(sb.state === "ready" && sb.loveOn === true, "B：loveOn=true / state=ready");

  ok(safe(() => SP.setLoveState(A, "confessed"), false) === true, "A → confessed");
  ok(safe(() => SP.setLoveState(B, "confessed"), false) === true, "B → confessed");
  ok(safe(() => SP.acceptConfess(A), false) === true, "acceptConfess(A) → true");
  ok(safe(() => SP.acceptConfess(B), false) === true, "acceptConfess(B) → true（⛔ 无全局互斥）");
  const fa = safe(() => SP.loveStateOf(A), {}), fb = safe(() => SP.loveStateOf(B), {});
  ok(fa.state === "accepted" && fb.state === "accepted", "🔴 两只串同时 accepted，互不影响");

  ok(safe(() => SP.setLoveState(A, "married"), true) === false, "setLoveState 非法枚举 → false");
  ok(safe(() => SP.loveStateOf(A), {}).state === "accepted", "非法写入不改状态（A 仍 accepted）");
}

section("D · setLovecall：填后不可改");
{
  const C = "v177c", C2 = "v177c2";
  const first = safe(() => SP.setLovecall(C, "阿祈"), { ok: false, reason: "" });
  ok(first.ok === true && first.reason === "", "首次 setLovecall(C,'阿祈') → ok=true");
  const again = safe(() => SP.setLovecall(C, "小祈"), { ok: true, reason: "" });
  ok(again.ok === false && again.reason === "locked", "第二次改写 → ok=false / reason=locked");
  ok(safe(() => SP.loveStateOf(C), {}).lovecall === "阿祈", "原值未被覆盖（仍为「阿祈」）");
  const blank = safe(() => SP.setLovecall(C2, "   "), { ok: true, reason: "" });
  ok(blank.ok === false && blank.reason === "empty", "空串/纯空白 → ok=false / reason=empty");
}

section("E · 婉拒不锁死：declined 可回 ready");
{
  const D = "v177d", E = "v177e";
  safe(() => SP.openLoveLine(D), false);
  safe(() => SP.openLoveLine(E), false);
  ok(safe(() => SP.declineConfess(E), true) === false, "state=ready 时 declineConfess → false（只认 confessed）");
  safe(() => SP.setLoveState(D, "confessed"), false);
  ok(safe(() => SP.declineConfess(D), false) === true, "confessed → declineConfess → true");
  ok(safe(() => SP.loveStateOf(D), {}).state === "declined", "D 状态 = declined");
  ok(safe(() => SP.setLoveState(D, "ready"), false) === true, "declined → 可回 ready（🔴 婉拒不锁死）");
  const back = safe(() => SP.loveGate(Object.assign({}, GATE_OK, { loveState: safe(() => SP.loveStateOf(D), {}).state })), { canConfess: false });
  ok(back.canConfess === true, "回到 ready 后 loveGate.canConfess=true（还能再告白一次）");
}

section("F · 结局判定接入 harmed（v165c 口径）");
{
  const GRAND = { FORK_STANCE: "LET", KEY_CHOICES: 3, JOINT_PREP: "FULL" };
  const NOKEY = { FORK_STANCE: "LET", KEY_CHOICES: 0, JOINT_PREP: "FULL" };

  ok(SP.ENDING_CFG && SP.ENDING_CFG.HARM_LV_DROP === 2 && SP.ENDING_CFG.GRAND_NO_HARM === true,
     "ENDING_CFG 新增 HARM_LV_DROP=2 / GRAND_NO_HARM=true");

  // ① 带伤：有效档位 −2（bondLv 7 → 5 < HE_BOND 6）
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "LET", bondLv: 7, harmed: true }]), "大团圆") === "NE",
     "带伤串 bondLv=7 → 有效 5 < HE_BOND=6 → 掉出大团圆（NE）");
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "LET", bondLv: 7 }]), "x") === "大团圆",
     "同一串不带伤 → 仍大团圆（对照组）");

  // ② 🔴 带伤永不致 BE
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "DECIDE", bondLv: 8, harmed: true }]), "BE") !== "BE",
     "🔴 DECIDE + bondLv=8 + harmed → 不得为 BE");
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "DECIDE", bondLv: 5, harmed: true }]), "BE") !== "BE",
     "🔴 DECIDE + bondLv=5（恰在 SHIELD_MIN）+ harmed → 仍不得为 BE");
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "DECIDE", bondLv: 4 }]), "x") === "BE",
     "对照组：bondLv=4(<SHIELD_MIN=5) 无伤 → 仍为 BE（BE 通路未被改坏）");
  // 带伤 + DECIDE：既不是 BE（伤害绝不入散判定），也不是大团圆（GRAND_NO_HARM）→ HE
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "DECIDE", bondLv: 8, harmed: true }]), "x") === "HE",
     "🔴 DECIDE + bondLv=8 + harmed → HE（不是 BE、也不是大团圆）");
  // 源码级：带伤只改「有效档位」，散/BE 判定仍只认 bondLv
  ok(/if \(effLv < HE_BOND\) allHighBond = false;/.test(SRC), "源码：allHighBond 改用 effLv 比较 HE_BOND");
  ok(/GRAND_NO_HARM \|\| !anyHarmed/.test(SRC), "源码：大团圆分支挂 GRAND_NO_HARM 守卫");
  ok(/if \(stance === "DECIDE" && bondLv < SHIELD_MIN\) anyScattered = true;/.test(SRC),
     "源码：散/BE 判定仍只用 bondLv（🔴 伤害绝不入）");

  // ③ 大团圆要求全员无伤
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "LET", bondLv: 8 }, { stance: "LET", bondLv: 8 }]), "x") === "大团圆",
     "全员无伤 + 高亲 → 大团圆");
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "LET", bondLv: 8, harmed: true }, { stance: "LET", bondLv: 8 }]), "大团圆") !== "大团圆",
     "任一 harmed → 不可能是大团圆");

  // ④ HE 允许带伤
  ok(safe(() => SP.evaluateEnding(GRAND, [{ stance: "LET", bondLv: 8 }, { stance: "LET", bondLv: 8, harmed: true }]), "x") === "HE",
     "全员 LET + bondLv=8 + 一只带伤 → 仍判 HE（不是 NE）");

  // ⑤ 向后兼容：不带 harmed 字段时，结果与改动前逐例一致
  const cases = [
    [GRAND, [{ stance: "LET", bondLv: 8 }, { stance: "LET", bondLv: 7 }], "大团圆"],
    [GRAND, [{ stance: "LET", bondLv: 5 }], "NE"],
    [NOKEY, [{ stance: "LET", bondLv: 8 }], "NE"],
    [GRAND, [{ stance: "DECIDE", bondLv: 4 }], "BE"],
    [{ FORK_STANCE: "LET", KEY_CHOICES: 3, JOINT_PREP: "PARTIAL" }, [{ stance: "LET", bondLv: 8 }], "HE"],
  ];
  let regOk = 0;
  for (let i = 0; i < cases.length; i++) {
    const got = safe(() => SP.evaluateEnding(cases[i][0], cases[i][1]), "?");
    if (got === cases[i][2]) regOk++;
    else console.log("    · 回归不一致 #" + i + "：期望 " + cases[i][2] + " 实得 " + got);
  }
  ok(regOk === cases.length, "向后兼容：" + regOk + "/" + cases.length + " 例与改动前逐例一致（不带 harmed 字段）");
  const a = safe(() => SP.evaluateEnding(GRAND, [{ stance: "LET", bondLv: 8 }]), "x");
  const b = safe(() => SP.evaluateEnding(GRAND, [{ stance: "LET", bondLv: 8, harmed: false }]), "y");
  ok(a === b, "显式 harmed=false 与省略该字段结果完全一致");

  // ⑥ resolveEnding 把 rec.harmed 带进判定入参
  try { h.store.removeItem("ww_spirits"); } catch (e) {}
  try { h.store.removeItem("ww_story"); } catch (e) {}
  h.store.setItem("ww_story", JSON.stringify({ FORK_STANCE: "LET", KEY_CHOICES: 3, JOINT_PREP: "FULL" }));
  h.store.setItem("ww_spirits", JSON.stringify({
    v177x: { spirit: true, stage: 4, bond: 280, harmed: true, harmCause: "恶人所伤", flags: { stance: "LET", bondLv: null, scattered: false } },
  }));
  const res = safe(() => SP.resolveEnding(), { spirits: [] });
  const sp0 = (res.spirits && res.spirits[0]) || {};
  ok(sp0.harmed === true, "resolveEnding 入参带 harmed=true（rec.harmed 已接入）");
  ok(res.ending !== "BE", "resolveEnding：带伤串不导向 BE");
}

console.log("------------------------------------------------------------");
const allGreen = summary();
console.log(allGreen ? "⇒ 全绿：V177-D 已落地" : "⇒ 红测（V177-D 落地前为红，属预期）");
process.exit(allGreen ? 0 : 1);
