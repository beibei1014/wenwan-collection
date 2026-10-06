/* v177b：沁灵称呼系统 callFor 接入台词链路 —— 自测
 *
 * 背景：callFor(rec) 定义在 v165 就已落地，但**零调用点** —— 沁灵说话一律硬编码「主人」，
 *   恋爱线玩家填了专属称谓（lovecall）后照样被叫「主人」。本批把称呼接进：
 *     chat（群戏/小剧场）· letter（来信）· diaryWrite（日记）· roomStory（房间剧情）· ownerLine（主人描述块）
 *
 * 覆盖：
 *   §1 callFor 档位回落（1-3「主人」/ 4-6「你」/ 7-8 昵称）
 *   §2 lovecall 最高优先级（低档位也压过档位逻辑）
 *   §3 每处 sys prompt 里存在称呼约束句（文件扫描）+ 去物化约束仍在（未被替换）
 *   §4 群戏逐串差异（3 只互不相同）
 *   §5 ownerLine 称呼透传 + 性别代词逻辑未改坏
 *   §6 向后兼容（rec 缺字段回落「主人」，不崩）
 *
 * 纪律：本文件在「改动前源码」上必须 FAIL（负向对照）。做法（🔴 铆定显式 commit，不用 git show HEAD）：
 *     git worktree add /tmp/_base d71b0e9
 *     cp /tmp/_base/js/spirits.js docs/_v177_base_spirits.js
 *     SPIRITS_SRC=docs/_v177_base_spirits.js node docs/_test_v177_call.js   → 必须 FAIL
 *     rm docs/_v177_base_spirits.js && git worktree remove /tmp/_base
 */
"use strict";
const fs = require("fs"), path = require("path");
const H = require("./_harness.js");
const SPIRITS_SRC = process.env.SPIRITS_SRC || "js/spirits.js";
const ROOT = path.join(__dirname, "..");
let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
// 基线对照时 callBlockFor / callRule 根本不存在 —— 捕获成 FAIL，不允许抛异常中断整轮
function safe(fn) { try { return fn(); } catch (e) { return { __err: String((e && e.message) || e) }; } }
function isErr(v) { return !!v && typeof v === "object" && "__err" in v; }

function newSpirits() {
  const c = H.makeContext(); H.loadFile(c.ctx, SPIRITS_SRC);
  return { S: c.sandbox.Spirits, c: c };
}
const SRC = fs.readFileSync(path.join(ROOT, SPIRITS_SRC), "utf8");
// 取某个函数签名之后的一段源码窗口（用于断言 sys prompt 里真的写了称呼约束）
function region(sig, span) {
  const i = SRC.indexOf(sig);
  return i < 0 ? "" : SRC.slice(i, i + (span || 2600));
}
const MARK = "⛔【称呼·最高优先级】";

/* ============ §1 callFor 档位回落 ============ */
section("§1 callFor 档位回落（1-3「主人」/ 4-6「你」/ 7-8 昵称）");
{
  const { S } = newSpirits();
  ok(S.callFor({ bond: 0 }) === "主人", "档1 bond=0 → 「主人」");
  ok(S.callFor({ bond: 30 }) === "主人", "档3 bond=30 → 「主人」");
  ok(S.callFor({ bond: 54 }) === "主人", "档3 上界 bond=54 → 「主人」（不许提前改口）");
  ok(S.callFor({ bond: 55 }) === "你", "档4 bond=55 → 「你」（BOND_YOU_LV=4 起改口）");
  ok(S.callFor({ bond: 140 }) === "你", "档6 bond=140 → 仍是「你」");
  ok(S.callFor({ bond: 199 }) === "你", "档6 上界 bond=199 → 仍是「你」");
  ok(S.callFor({ bond: 200, nickCall: "阿七" }) === "阿七", "档7 bond=200+nickCall → 「阿七」");
  ok(S.callFor({ bond: 55, nickCall: "阿七" }) === "你", "🔴 档4 即便填了 nickCall 也不给昵称（不许跳档）");
  {
    // 档7 无 nickCall 且未设玩家昵称 → ⛔ 回落「你」，绝不回落「主人」
    const c = H.makeContext(); H.loadFile(c.ctx, SPIRITS_SRC);
    const r = c.sandbox.Spirits.callFor({ bond: 280 });
    ok(r === "你", "档8 无 nickCall / 无玩家昵称 → 回落「你」（⛔ 绝不回落「主人」）");
  }
}

/* ============ §2 lovecall 最高优先级 ============ */
section("§2 lovecall 最高优先级（恋爱专属，压过档位与 nickCall）");
{
  const { S } = newSpirits();
  ok(S.callFor({ bond: 0, lovecall: "阿砚" }) === "阿砚",
    "🔴 bond=0 低档位 + lovecall=阿砚 → 「阿砚」（档位逻辑不许覆盖 lovecall）");
  ok(S.callFor({ bond: 200, nickCall: "阿七", lovecall: "阿砚" }) === "阿砚",
    "🔴 lovecall 压过 nickCall（档7 昵称仍在，但 lovecall 优先）");
  ok(S.callFor({ bond: 55, lovecall: "阿砚" }) === "阿砚", "档4「你」档 + lovecall → 仍是「阿砚」");
  ok(S.callFor({ bond: 0, lovecall: "   " }) === "主人", "lovecall 全空白 → 视为未填，回落「主人」");
  // 称呼约束句：昵称/lovecall 必须声明「只有这位沁灵会用」
  const t1 = safe(() => S.callRuleTail("阿砚"));
  ok(!isErr(t1) && t1.indexOf("其余角色一律不得使用") >= 0,
    "callRuleTail(昵称) 含「其余角色一律不得使用」（防群戏全员跟着叫）");
  const t2 = safe(() => S.callRuleTail("你"));
  ok(!isErr(t2) && t2.indexOf("不许写成「主人」") >= 0 && t2.indexOf("敬称") >= 0,
    "callRuleTail(你) 含「不许写成「主人」」+「敬称」说明");
  const r1 = safe(() => S.callRule({ bond: 0, lovecall: "阿砚" }));
  ok(!isErr(r1) && r1.indexOf(MARK) === 0 && r1.indexOf("「阿砚」") >= 0,
    "callRule(lovecall) 以「⛔【称呼·最高优先级】」开头且给出具体称呼词");
}

/* ============ §3 sys prompt 接入（文件扫描） ============ */
section("§3 每处生成台词的 sys prompt 里存在称呼约束句（文件扫描）");
{
  const sites = [
    ["chat（群戏/小剧场）", "async function chat(spirits)"],
    ["letter（来信）", "async function letter(spirit, userName)"],
    ["diaryWrite（日记）", "async function diaryWrite(item, rec, ap, ctx)"],
    ["roomStory（房间剧情）", "async function roomStory(a, b, level, roomName, aff)"],
  ];
  sites.forEach((s) => {
    const r = region(s[1]);
    ok(s[1] && r.indexOf(MARK) >= 0, s[0] + " 的 sys prompt 含称呼约束句「" + MARK + "」");
  });
  // 去物化纪律仍在（新增约束必须并排放，不许替换掉旧的）
  ok(region("async function chat(spirits)").indexOf("指代沁灵禁用「它」") >= 0,
    "chat：去物化约束「⛔ 指代沁灵禁用「它」」仍在（未被替换）");
  ok(region("async function letter(spirit, userName)").indexOf("严禁物件视角") >= 0,
    "letter：去物化约束「⛔ 严禁物件视角」仍在（未被替换）");
  ok(region("async function diaryWrite(item, rec, ap, ctx)").indexOf("严禁物件视角") >= 0,
    "diaryWrite：去物化约束「⛔ 严禁物件视角」仍在（未被替换）");
  ok(region("async function roomStory(a, b, level, roomName, aff)").indexOf("指代沁灵禁用「它」") >= 0,
    "roomStory：去物化约束「⛔ 指代沁灵禁用「它」」仍在（未被替换）");
  // callFor 真的被调用（此前零调用点）
  const nCall = (SRC.match(/callFor\(/g) || []).length;
  ok(nCall >= 5, "源码里 callFor( 调用点 >= 5 处（当前 " + nCall + "；基线仅 1 处定义）");
}

/* ============ §4 群戏逐串差异 ============ */
section("§4 群戏逐串差异（3 只沁灵 3 个互不相同的称呼）");
{
  const { S } = newSpirits();
  if (typeof S.callBlockFor !== "function") {
    ok(false, "callBlockFor 未导出（基线无此函数 → 群戏无法逐串指定称呼）");
  } else {
    const g = [
      { item: { id: "i1", name: "甲" }, persona: { name: "甲" }, rec: { bond: 0 } },
      { item: { id: "i2", name: "乙" }, persona: { name: "乙" }, rec: { bond: 100 } },
      { item: { id: "i3", name: "丙" }, persona: { name: "丙" }, rec: { bond: 0, lovecall: "阿砚" } },
    ];
    const blk = S.callBlockFor(g);
    ok(blk.indexOf("· 甲 称玩家为「主人」") >= 0, "群戏：甲 → 「主人」（未改口）");
    ok(blk.indexOf("· 乙 称玩家为「你」") >= 0, "群戏：乙 → 「你」（已改口）");
    ok(blk.indexOf("· 丙 称玩家为「阿砚」") >= 0, "群戏：丙 → 「阿砚」（恋爱专属 lovecall）");
    const names = (blk.match(/称玩家为「([^」]+)」/g) || []).map((s) => s.replace(/^称玩家为「|」$/g, ""));
    ok(names.length === 3, "群戏：共列出 3 条称呼指定（当前 " + names.length + "）");
    ok(new Set(names).size === 3, "🔴 群戏：3 个称呼互不相同（不许整段只给一个称呼）→ " + JSON.stringify(names));
    ok(blk.indexOf("不许把几只沁灵统一成同一个称呼") >= 0, "群戏：块内自带「不许统一成同一个称呼」约束");
  }
  // 群戏 user 里真的挂了 callBlockFor
  ok(region("async function chat(spirits)").indexOf("callBlockFor(spirits)") >= 0,
    "chat 的 user 里挂了 callBlockFor(spirits)");
  ok(region("async function roomStory(a, b, level, roomName, aff)").indexOf("callBlockFor([a, b])") >= 0,
    "roomStory 的 user 里挂了 callBlockFor([a, b])");
}

/* ============ §5 ownerLine 称呼透传 + 性别代词未改坏 ============ */
section("§5 owner 描述块：称呼透传，且性别代词逻辑未改坏");
{
  const { S } = newSpirits();
  S.setOwner({ name: "小北", gender: "girl" });
  const a = S.ownerLine();
  ok(a.indexOf("【主人】") >= 0 && a.indexOf("昵称：小北；") >= 0,
    "ownerLine() 无称呼参数 → 与旧行为一致（【主人】+ 昵称：小北；）");
  const b = S.ownerLine(null, "阿砚");
  ok(b.indexOf("【阿砚】") >= 0, "ownerLine(null,'阿砚') → 头部变【阿砚】（不再恒为「主人」）");
  ok(b.indexOf("【主人】") < 0, "ownerLine(null,'阿砚') → 不再出现「【主人】」");
  ok(b.indexOf("阿砚") >= 0, "ownerLine(null,'阿砚') → 称呼词透传进描述块");
  const c = S.ownerLine(null, "你");
  ok(c.indexOf("【你】") >= 0 && c.indexOf("【主人】") < 0, "ownerLine(null,'你') → 头部【你】，不是【主人】");
  // 🔴 性别代词职责不许改坏
  ok(b.indexOf("性别：女") >= 0 && b.indexOf("请用「她」") >= 0 && b.indexOf("不要写成「他」") >= 0,
    "🔴 ownerLine 性别代词逻辑未改坏（女 → 请用「她」/ 不要写成「他」）");
  S.setOwner({ name: "小北", gender: "boy" });
  const d = S.ownerLine(null, "阿砚");
  ok(d.indexOf("性别：男") >= 0 && d.indexOf("请用「他」") >= 0 && d.indexOf("不要写成「她」") >= 0,
    "🔴 ownerLine 性别代词逻辑未改坏（男 → 请用「他」/ 不要写成「她」）");
}

/* ============ §6 向后兼容 ============ */
section("§6 向后兼容：rec 缺字段回落「主人」，不崩");
{
  const { S } = newSpirits();
  ok(S.callFor(null) === "主人", "callFor(null) → 「主人」，不崩");
  ok(S.callFor(undefined) === "主人", "callFor(undefined) → 「主人」，不崩");
  ok(S.callFor({}) === "主人", "callFor({}) → 「主人」，不崩");
  ok(S.callFor({ bond: null }) === "主人", "callFor({bond:null}) → 「主人」，不崩");
  ok(S.callFor({ bond: NaN }) === "主人", "callFor({bond:NaN}) → 「主人」，不崩");
  ok(S.callFor({ bond: "abc" }) === "主人", "callFor({bond:'abc'}) → 「主人」，不崩");
  ok(S.callFor({ lovecall: null, nickCall: null }) === "主人", "callFor(全 null 字段) → 「主人」，不崩");
  if (typeof S.recOfSpirit !== "function") ok(false, "recOfSpirit 未导出");
  else {
    ok(S.callFor(S.recOfSpirit(undefined)) === "主人", "recOfSpirit(undefined) → {} → 「主人」，不崩");
    ok(S.callFor(S.recOfSpirit({ item: { id: "no-such-id" }, persona: { name: "丁" } })) === "主人",
      "recOfSpirit 查不到 store 记录 → {} → 「主人」，不崩");
  }
  if (typeof S.callBlockFor !== "function") ok(false, "callBlockFor 未导出");
  else ok(S.callBlockFor([]) === "" && S.callBlockFor(null) === "", "callBlockFor([]/null) → 空串，不崩");
}

/* ============ §7 写死短句模板 ============ */
section("§7 写死短句模板：锁死原文不动，运行时按说话者换词");
{
  const lc = region("function localChat(spirits)", 2200);
  ok(lc.indexOf('["主人昨天先来的是我这边。"') >= 0,
    "localChat：写死模板原文保留（_test_v174b 表B 逐字锁死，不许改）");
  ok(lc.indexOf("callFor(recOfSpirit(s))") >= 0 && lc.indexOf("fill(spirits[1]") >= 0 && lc.indexOf("fill(spirits[2]") >= 0,
    "🔴 localChat：运行时按**说话的那一只**换称呼（逐串 fill，不统一成一个）");
  ok(lc.indexOf("(cw === \"主人\") ? String(t)") >= 0,
    "localChat：称呼仍是「主人」时输出与旧版逐字一致（零回归）");
  const dl = region("function diaryLocal(item, rec, ap, ctx)", 2400);
  ok(dl.indexOf("{call}") >= 0 && dl.indexOf("const cw = callFor(rec)") >= 0,
    "diaryLocal：第一人称日记模板改用 {call} 占位符 + callFor(rec) 填充");
  ok((dl.match(/\{call\}/g) || []).length >= 6,
    "diaryLocal：{call} 占位符 >= 6 处（日记里提到玩家的写死「主人」已全部动态化）");
}

console.log("\n────────────────────────────");
console.log("PASS " + PASS + " / FAIL " + FAIL);
if (FAIL) { console.log("\n失败断言："); FAILURES.forEach((m) => console.log("  · " + m)); }
process.exit(FAIL ? 1 : 0);
