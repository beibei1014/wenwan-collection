/* ============================================================
 * _test_v177_love_lib.js · V177d「恋爱告白文案库」文案库模块自测
 * ------------------------------------------------------------
 * 被测对象： js/love.js（纯新增 · window.Love）
 * 数据源：   docs/v177-恋爱告白文案库.md（212 行 · 165 条）
 *
 * 覆盖：
 *   §1  165 条齐全：逐型逐列非空白（B 每型 3 变体 × 2 轮 / E 每型 2 条 / A·C·D 每型各 1 条）
 *   §2  15 型 id 与 js/spirits.js PERSONAS_PICK（L1979-1995）**完全一致**（源码扫描比对）
 *   §3  同型避让：3 只同型沁灵依次分配 ⇒ 变体互不相同（0/1/2）；第 4 只回落哈希且不崩
 *   §4  稳定性：同一只第二次调用返回同一变体（不闪变）
 *   §5  round 切换：loveTries=0 → round 1；loveTries=1 → round 2，且两轮字面不同
 *   §6  declined 随 round 切换（首次婉拒 / 二次婉拒不同文）
 *   §7  fillAll：{ta}→身份名、{call}→Spirits.callFor；Spirits 未定义 ⇒ 回落「主人」不崩
 *   §8  canReConfess：冷却未到/次数超限/羁绊升档/非 declined 态
 *   §9  未命中人格型回落 gentle，六项全非空
 *   §10 负向扫描（全库 165 条）：您/盘/它/玩意/物件/把玩 = 0；占位符仅 {call}/{ta} 且全 ASCII；{ta} 只在 A 列
 *   §11 后宫口径：排他表述（唯一 / 只对你 / 只有你 / 只叫你一个人）= 0
 *
 * 用法： node docs/_test_v177_love_lib.js
 *
 * 负向对照（🔴 必做 · 基线 72aab30 上 js/love.js **根本不存在**）：
 *   git worktree add /tmp/_base 72aab30
 *   node docs/_test_v177_love_lib.js          （在 /tmp/_base 里跑）
 *   ⇒ 除少数「文件不存在」类断言外，其余必须报红
 *   git worktree remove /tmp/_base
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const LOVE_SRC = path.join(ROOT, "js", "love.js");
const SP_SRC = path.join(ROOT, "js", "spirits.js");

const HAS_LOVE = fs.existsSync(LOVE_SRC);
if (!HAS_LOVE) {
  console.log("\n⚠️  js/love.js 不存在（基线负向对照场景）—— 断言逐条报红而不是中途退出。\n");
}

/* ---------- 两个沙箱：A = spirits + love（完整链路）；B = 只有 love（Spirits 缺席，验证容错） ---------- */
function boot(withSpirits) {
  const c = makeContext();
  if (withSpirits) loadFile(c.ctx, "js/spirits.js");
  if (HAS_LOVE) loadFile(c.ctx, "js/love.js");
  return { ctx: c.ctx, sandbox: c.sandbox, store: c.store, S: c.sandbox.Spirits, L: c.sandbox.Love };
}
const A = boot(true);            // Spirits + Love
const B = boot(false);           // 只有 Love（Spirits 未定义 ⇒ 必须回落「主人」）

/* 文件缺失时用一个「空壳」顶上 —— 让每条断言照常跑到并报红，而不是在第 1 条就炸掉整轮 */
const NULL_L = {
  LOVE_TYPES: [], LOVE_TYPE_ZH: {}, FALLBACK_TYPE: "", NO_PERS: "",
  LOVE_B: {}, LOVE_E: {}, LOVE_A: {}, LOVE_C: {}, LOVE_D: {},
  RECONFESS_CFG: {}, RETRY_COOLDOWN_DAYS: 0,
  scriptFor: function () { return {}; },
  canReConfess: function () { return false; },
  fillAll: function () { return ""; },
  callOf: function () { return ""; },
  persKeyOf: function () { return ""; },
  resolveType: function () { return ""; },
  bondLvOf: function () { return 0; },
  daysSince: function () { return -1; },
  variantFor: function () { return -1; },
  libStats: function () { return {}; },
};
const L = A.L || NULL_L;
const BL = B.L || NULL_L;

/* ---------- 工具 ---------- */
const TYPES = L.LOVE_TYPES || [];
const E_BLANK = (s) => (typeof s !== "string") || String(s).trim() === "";
const ALL = [];                                     // [[where, text], ...] —— 全库 165 条，负向扫描用
if (HAS_LOVE) {
  TYPES.forEach((t) => {
    (L.LOVE_B[t] || []).forEach((round, ri) => (round || []).forEach((s, vi) => ALL.push([t + "/B·r" + (ri + 1) + "v" + vi, s])));
    (L.LOVE_E[t] || []).forEach((s, i) => ALL.push([t + "/E" + (i === 0 ? "首次" : "二次"), s]));
    ALL.push([t + "/A", L.LOVE_A[t]], [t + "/C", L.LOVE_C[t]], [t + "/D", L.LOVE_D[t]]);
  });
}
function dateAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/* 直读表的**安全**访问器 —— 库缺失时不抛异常，让断言照常报红而不是崩掉整轮（负向对照要跑到底） */
const tb = (t, i, j) => { try { return (((L.LOVE_B || {})[t] || [])[i] || [])[j]; } catch (e) { return undefined; } };
const te = (t, i) => { try { return ((L.LOVE_E || {})[t] || [])[i]; } catch (e) { return undefined; } };
/* okLive：断言依赖 js/love.js **真的存在**。
   ⛔ 没有它，负向对照时「空数组 / 恒 false 的兜底」会让一批断言**假绿**（文件根本不存在却算通过）。 */
const okLive = (c, m) => ok(HAS_LOVE && !!c, m);

/* ============================================================
 * §0 · 文件与导出（🔴 基线 72aab30 上 js/love.js 根本不存在 ⇒ 这里第一条就红）
 * ============================================================ */
section("§0 js/love.js 存在且导出 window.Love");
ok(HAS_LOVE && !!A.L, "🔴 js/love.js 存在且导出 window.Love（基线 72aab30 上此文件不存在）");
["scriptFor", "canReConfess", "fillAll", "libStats"].forEach((k) => {
  ok(A.L && typeof A.L[k] === "function", "window.Love." + k + " 是函数");
});
ok(A.L && A.L.RECONFESS_CFG && typeof A.L.RECONFESS_CFG === "object", "window.Love.RECONFESS_CFG 已导出");
ok(A.L && typeof A.L.RETRY_COOLDOWN_DAYS === "number", "window.Love.RETRY_COOLDOWN_DAYS 已导出（number）");

/* ============================================================
 * §1 · 165 条齐全（逐型逐列非空白）
 * ============================================================ */
section("§1 165 条齐全（B 90 / E 30 / A·C·D 45）");
{
  const st = (typeof L.libStats === "function") ? L.libStats() : {};
  ok(st.types === 15 && st.b === 90 && st.e === 30 && st.acd === 45,
    "libStats() === { types:15, b:90, e:30, acd:45 }（实测 " + JSON.stringify(st) + "）");
  ok(TYPES.length === 15, "LOVE_TYPES 共 15 型（实测 " + TYPES.length + "）");

  let badB = [], badE = [], badACD = [], cntB = 0, cntE = 0, cntACD = 0;
  TYPES.forEach((t) => {
    const rounds = L.LOVE_B[t] || [];
    if (rounds.length !== 2) { badB.push(t + " 轮数≠2"); return; }
    rounds.forEach((r, ri) => {
      if ((r || []).length !== 3) { badB.push(t + " r" + (ri + 1) + " 变体数≠3"); return; }
      r.forEach((s, vi) => { cntB++; if (E_BLANK(s)) badB.push(t + " r" + (ri + 1) + "v" + vi + " 空白"); });
    });
    const es = L.LOVE_E[t] || [];
    if (es.length !== 2) badE.push(t + " 条数≠2");
    es.forEach((s, i) => { cntE++; if (E_BLANK(s)) badE.push(t + " E" + i + " 空白"); });
    [["A", L.LOVE_A[t]], ["C", L.LOVE_C[t]], ["D", L.LOVE_D[t]]].forEach(([k, v]) => { cntACD++; if (E_BLANK(v)) badACD.push(t + " " + k + " 空白"); });
  });
  ok(cntB === 90 && badB.length === 0, "B 列 90 条（15 型 × 3 变体 × 2 轮）全部非空白 —— " + badB.join("; "));
  ok(cntE === 30 && badE.length === 0, "E 列 30 条（15 型 × 2）全部非空白 —— " + badE.join("; "));
  ok(cntACD === 45 && badACD.length === 0, "A / C / D 列 45 条（15 型 × 3）全部非空白 —— " + badACD.join("; "));
  ok(ALL.length === 165, "全库条目总数 = 165（实测 " + ALL.length + "）");

  // 同型同变体：首告与再告必须字面不同（doc §七-13）；全 90 条去重后仍应是 90
  let dup = [], bAll = [];
  TYPES.forEach((t) => {
    const r1 = (L.LOVE_B[t] || [])[0] || [], r2 = (L.LOVE_B[t] || [])[1] || [];
    for (let i = 0; i < 3; i++) { if (r1[i] && r1[i] === r2[i]) dup.push(t + " v" + i); }
    r1.concat(r2).forEach((s) => bAll.push(s));
  });
  okLive(dup.length === 0, "🔴 同一型同一变体：首告 ≠ 再告（字面不同）—— 撞车：" + dup.join("; "));
  okLive(new Set(bAll).size === 90, "B 列 90 条两两互不相同（去重后 " + new Set(bAll).size + " 条，无跨型撞车）");

  // 再告必须提到那次被缓下来；首告不许提
  let miss = 0, leak = 0;
  TYPES.forEach((t) => {
    const rs = L.LOVE_B[t] || [];
    (rs[1] || []).forEach((s) => { if (String(s).indexOf("缓一缓") < 0) miss++; });
    (rs[0] || []).forEach((s) => { if (String(s).indexOf("缓一缓") >= 0) leak++; });
  });
  okLive(miss === 0, "再告 45 条每条都提到「缓一缓」（漏 " + miss + " 条）");
  okLive(leak === 0, "首告 45 条零「缓一缓」（泄漏 " + leak + " 条）");
}

/* ============================================================
 * §2 · 15 型 id 与 js/spirits.js PERSONAS_PICK 完全一致（源码扫描）
 * ============================================================ */
section("§2 15 型 id 与 spirits.js PERSONAS_PICK 一致（源码扫描）");
{
  const SRC = fs.readFileSync(SP_SRC, "utf8").replace(/\r\n/g, "\n");
  const i = SRC.indexOf("const PERSONAS_PICK = [");
  ok(i >= 0, "spirits.js 找到 PERSONAS_PICK 定义");
  const j = i >= 0 ? SRC.indexOf("];", i) : -1;
  const PK = (i >= 0 && j > i) ? (SRC.slice(i, j).match(/id:\s*"([a-zA-Z0-9_]+)"/g) || []).map((s) => s.match(/"([^"]+)"/)[1]) : [];
  ok(PK.length === 15, "PERSONAS_PICK 解析出 15 个 id（实测 " + PK.length + "）");
  ok(PK.join(",") === TYPES.join(","),
    "🔴 顺序与集合逐一对齐\n      spirits: " + PK.join(",") + "\n      love   : " + TYPES.join(","));
  const miss = PK.filter((p) => !(p in (L.LOVE_B || {})));
  ok(miss.length === 0, "每一型在 LOVE_B 里都有对应条目 —— 缺失：" + miss.join(","));
  // 中文名片宣一行对得上（防止搬运时串型）
  let zhBad = [];
  PK.forEach((p) => {
    const m = SRC.slice(i, j).match(new RegExp('id:\\s*"' + p + '"\\s*,\\s*zh:\\s*"([^"]+)"'));
    if (m && L.LOVE_TYPE_ZH[p] && m[1] !== L.LOVE_TYPE_ZH[p]) zhBad.push(p + ":" + m[1] + "≠" + L.LOVE_TYPE_ZH[p]);
  });
  ok(zhBad.length === 0, "15 型的中文名与 spirits.js 一致 —— 不一致：" + zhBad.join("; "));
}

/* ============================================================
 * §3 · 同型避让（3 只同型 ⇒ 0/1/2；第 4 只回落哈希且不崩）
 * ============================================================ */
section("§3 同型避让：多只同人格型沁灵拿到不同变体");
{
  const mk = (id, pers) => ({ look: { pers: pers }, loveTries: 0 });
  const fixture = { g1: mk("g1", "gentle"), g2: mk("g2", "gentle"), g3: mk("g3", "gentle"), g4: mk("g4", "gentle") };
  const v1 = L.scriptFor(fixture.g1, null, fixture).variant;
  const v2 = L.scriptFor(fixture.g2, null, fixture).variant;
  const v3 = L.scriptFor(fixture.g3, null, fixture).variant;
  const v4 = L.scriptFor(fixture.g4, null, fixture).variant;
  ok(v1 === 0, "第 1 只 gentle ⇒ 变体 0（实测 " + v1 + "）");
  ok(v2 === 1, "第 2 只 gentle ⇒ 变体 1（实测 " + v2 + "，🔴 不得与第 1 只重样）");
  ok(v3 === 2, "第 3 只 gentle ⇒ 变体 2（实测 " + v3 + "，🔴 不得与前两只重样）");
  ok(new Set([v1, v2, v3]).size === 3, "3 只同型拿到 3 个互不相同的变体");
  ok(v4 === 0 || v4 === 1 || v4 === 2, "第 4 只（三个空位占满）⇒ 回落 hash(spiritId)%3，仍在 0..2 且未崩（实测 " + v4 + "）");

  const c1 = L.scriptFor(fixture.g1, null, fixture).confess;
  const c2 = L.scriptFor(fixture.g2, null, fixture).confess;
  const c3 = L.scriptFor(fixture.g3, null, fixture).confess;
  ok(c1 !== c2 && c2 !== c3 && c1 !== c3 && !!c1 && !!c2 && !!c3,
    "🔴 3 只同型沁灵的告白语字面互不相同且不为空（需求原点：性格重合的沁灵告白内容也要不一样）");

  // 不同型之间互不干扰：cool 的第 1 只仍从 0 起
  const mix = { c1: mk("c1", "cool"), c2: mk("c2", "cool") };
  ok(L.scriptFor(mix.c1, null, mix).variant === 0, "换一个人格型（cool）⇒ 重新从变体 0 起（分桶隔离）");
  ok(L.scriptFor(mix.c2, null, mix).variant === 1, "同型第 2 只（cool）⇒ 变体 1");

  // look.pers 缺失 ⇒ __none__ 分桶，仍参与互斥（不混淆到 gentle）
  const nb = { n1: { loveTries: 0 }, n2: { loveTries: 0 } };
  const nv1 = L.scriptFor(nb.n1, null, nb).variant, nv2 = L.scriptFor(nb.n2, null, nb).variant;
  ok(nv1 === 0 && nv2 === 1, "look.pers 缺失 ⇒ 按 __none__ 分桶，两只仍能互斥（0/1）");
  ok(L.persKeyOf({}) === "__none__" && L.persKeyOf({ look: {} }) === "__none__", "persKeyOf({} / {look:{}}) ⇒ \"__none__\"");
}

/* ============================================================
 * §4 · 稳定性（同一只每次告白是同一句，不闪变）
 * ============================================================ */
section("§4 稳定性：同一只沁灵每次取到同一变体（不闪变）");
{
  const fixture = { s1: { look: { pers: "heroic" }, loveTries: 0 } };
  const a = L.scriptFor(fixture.s1, null, fixture).variant;
  const b = L.scriptFor(fixture.s1, null, fixture).variant;
  const c = L.scriptFor(fixture.s1, null, fixture).variant;
  okLive(a === b && b === c && (a === 0 || a === 1 || a === 2), "同一只连续三次 scriptFor ⇒ 同一变体（" + a + "/" + b + "/" + c + "）");
  okLive(fixture.s1.loveVariant === a && (a === 0 || a === 1 || a === 2), "🔴 变体号已写回 rec.loveVariant（持久化锚点，重进游戏不重抽）");
  const s2 = { look: { pers: "heroic" }, loveVariant: 2, loveTries: 0 };
  ok(L.scriptFor(s2, null, {}).variant === 2, "rec.loveVariant 已定 ⇒ 直接返回该值（不会被 store 里的同型挤掉）");
  const t1 = L.scriptFor(fixture.s1, null, fixture).confess, t2 = L.scriptFor(fixture.s1, null, fixture).confess;
  ok(t1 === t2 && !!t1, "同一只前后两次告白语字面完全一致");
}

/* ============================================================
 * §5 · round 切换（loveTries=0 ⇒ 首告；loveTries=1 ⇒ 再告）
 * ============================================================ */
section("§5 round 切换：首告 / 再告");
{
  const r1 = L.scriptFor({ look: { pers: "gentle" }, loveVariant: 0, loveTries: 0 }, null, {});
  const r2 = L.scriptFor({ look: { pers: "gentle" }, loveVariant: 0, loveTries: 1 }, null, {});
  ok(r1.round === 1, "loveTries=0 ⇒ round 1（首告）");
  ok(r2.round === 2, "loveTries=1 ⇒ round 2（再告）");
  ok(r1.confess !== r2.confess && !!r1.confess && !!r2.confess,
    "🔴 两轮告白语字面不同（再告不是首告的复读）");
  okLive(!!r1.confess && r1.confess === tb("gentle", 0, 0), "round 1 取的是 LOVE_B.gentle[0][v]");
  okLive(!!r2.confess && r2.confess === tb("gentle", 1, 0), "round 2 取的是 LOVE_B.gentle[1][v]");
  ok(String(r2.confess).indexOf("缓一缓") >= 0, "再告明确提到那次被缓下来");
  ok(L.scriptFor({ look: { pers: "gentle" }, loveVariant: 0, loveTries: 2 }, null, {}).round === 2,
    "loveTries>=2 仍按 round 2 处理（文案层不再给第三个版本）");
  ok(L.scriptFor({}, null, {}).round === 1, "rec 空对象 ⇒ round 1，不崩");
}

/* ============================================================
 * §6 · declined 随 round 切换（首次婉拒 / 二次婉拒）
 * ============================================================ */
section("§6 declined 随 round 切换");
{
  const base = { look: { pers: "cool" }, loveVariant: 1 };
  const d1 = L.scriptFor(Object.assign({}, base, { loveTries: 0 }), null, {}).declined;
  const d2 = L.scriptFor(Object.assign({}, base, { loveTries: 1 }), null, {}).declined;
  okLive(!!d1 && d1 === te("cool", 0), "round 1 ⇒ 「首次婉拒」文案");
  okLive(!!d2 && d2 === te("cool", 1), "round 2 ⇒ 「二次婉拒」文案");
  ok(d1 !== d2 && !!d1 && !!d2, "🔴 首次婉拒 ≠ 二次婉拒，且都不为空");
  // 每型的二次婉拒必须收束（不提第三次）+ 体面（不怨不闹）
  let noEnd = [];
  TYPES.forEach((t) => {
    const s = (L.LOVE_E[t] || [])[1] || "";
    if (!/(不再|到此为止|收起|收回|收下|守礼|翻过去|不缠|不闹|不说啦)/.test(s) &&
        !/(别为难|别放在心上|安心|别难过|不必自责|别替我难受|别亏待自己|便还在)/.test(s)) noEnd.push(t);
  });
  okLive(noEnd.length === 0, "二次婉拒 15 条都有收束 / 安慰落点 —— 缺落点：" + noEnd.join(","));
}

/* ============================================================
 * §7 · fillAll（{ta} → 身份名，{call} → Spirits.callFor）
 * ============================================================ */
section("§7 fillAll：占位符替换");
{
  const rec = { lovecall: "阿白", bond: 0 };
  ok(A.S && typeof A.S.callFor === "function", "沙箱 A：Spirits.callFor 可用");
  ok(A.S.callFor(rec) === "阿白", "Spirits.callFor({lovecall:'阿白'}) ⇒ 「阿白」");
  ok(L.fillAll("{call}一来我就安心。", rec, "阿砚") === "阿白一来我就安心。",
    "{call} ⇒ Spirits.callFor 结果（阿白）");
  ok(L.fillAll("{ta}话不多，目光却在你身上停了很久。", rec, "阿砚") === "阿砚话不多，目光却在你身上停了很久。",
    "{ta} ⇒ 身份名（阿砚）");
  ok(L.fillAll("{call}和{ta}都在一处。", rec, "阿砚") === "阿白和阿砚都在一处。",
    "同一句里 {call} 与 {ta} 都被替换，且不互相污染");
  const filled = L.fillAll(tb("sweet", 0, 0), rec, "阿砚");
  okLive(!!filled && filled.indexOf("{") < 0 && filled.indexOf("}") < 0, "填充后零占位符残留");
  // 昵称档：bond=300 + nickCall ⇒ 「阿七」
  const nickRec = { bond: 300, nickCall: "阿七" };
  ok(A.S.callFor(nickRec) === "阿七", "Spirits.callFor（昵称档）⇒ 「阿七」");
  ok(L.fillAll("{call}", nickRec, "阿砚") === "阿七", "{call} 随不同沁灵的改口状态变化");
  // taName 缺省
  ok(L.fillAll("{ta}", rec, null) === "那只", "taName 缺省 ⇒ 「那只」（不返回空串）");

  // Spirits 缺席 ⇒ 回落「主人」，不崩
  ok(BL && typeof B.S === "undefined", "沙箱 B：只有 love.js，Spirits 未定义");
  ok(BL.callOf({}) === "主人", "🔴 Spirits 未加载 ⇒ callOf 回落「主人」，不崩");
  ok(BL.fillAll("{call}你好。", {}, "阿砚") === "主人你好。", "Spirits 缺席时 fillAll 仍可用");
  const bs = BL.scriptFor({ look: { pers: "gentle" }, loveVariant: 0, loveTries: 0 }, null, {});
  ok(!!bs.confess && !!bs.hint && !!bs.declined, "Spirits 缺席时 scriptFor 六项仍非空");
  // 极端入参不崩
  okLive(L.fillAll(null, rec, "阿砚") === "" && L.fillAll(undefined, rec, "阿砚") === "", "fillAll(null/undefined) ⇒ 空串，不崩");
  let threw = false;
  try { L.fillAll("{call}", null, null); } catch (e) { threw = true; }
  okLive(!threw, "fillAll(rec=null) 不抛异常");
}

/* ============================================================
 * §8 · canReConfess（冷却 / 次数 / 契机 / 状态）
 * ============================================================ */
section("§8 canReConfess：二次告白契机");
{
  const ok = okLive;   // 本段一律要求 Love 真实落地（否则恒 false 会假绿）
  const cfg = L.RECONFESS_CFG || {};
  ok(cfg.COOLDOWN_DAYS === 7 && cfg.MAX_TRIES === 2 && cfg.NEED_BOND_UP === true,
    "RECONFESS_CFG === { COOLDOWN_DAYS:7, NEED_BOND_UP:true, MAX_TRIES:2 }");
  ok(L.RETRY_COOLDOWN_DAYS === 7, "RETRY_COOLDOWN_DAYS 别名 === 7");

  const lvNow = A.S.bondLevel(300).lv;                       // bond=300 ⇒ 沁透档
  const mk8 = (o) => Object.assign({
    loveState: "declined", loveTries: 1, loveDeclinedAt: dateAgo(8),
    bond: 300, loveBondLvAt: lvNow - 1,
  }, o || {});

  ok(L.canReConfess(mk8(), null) === true, "✅ 冷却已满 + 次数未超 + 羁绊升档 ⇒ true");
  ok(L.canReConfess(mk8({ loveState: "ready" }), null) === false, "非 declined 态（ready）⇒ false");
  ok(L.canReConfess(mk8({ loveState: "accepted" }), null) === false, "非 declined 态（accepted）⇒ false");
  ok(L.canReConfess(mk8({ loveState: "none" }), null) === false, "非 declined 态（none）⇒ false");
  ok(L.canReConfess(mk8({ loveDeclinedAt: dateAgo(6) }), null) === false, "冷却未到（6 天 < 7 天）⇒ false");
  ok(L.canReConfess(mk8({ loveDeclinedAt: dateAgo(7) }), null) === true, "刚好 7 天 ⇒ true（>= 边界）");
  ok(L.canReConfess(mk8({ loveDeclinedAt: "" }), null) === false, "🔴 无 loveDeclinedAt 字段 ⇒ false（不偷偷放行）");
  ok(L.canReConfess(mk8({ loveDeclinedAt: "2026/13/01" }), null) === false, "非法日期 ⇒ false");
  ok(L.canReConfess(mk8({ loveTries: 2 }), null) === false, "次数已达 MAX_TRIES(2) ⇒ false");
  ok(L.canReConfess(mk8({ loveTries: 3 }), null) === false, "次数超过 MAX_TRIES ⇒ false");
  ok(L.canReConfess(mk8({ loveBondLvAt: lvNow }), null) === false, "羁绊没升档且无善意 ⇒ false");
  ok(L.canReConfess(mk8({ loveBondLvAt: lvNow, loveKindled: true }), null) === true,
    "✅ 羁绊没升档但释放过善意（loveKindled===true）⇒ true —— 善意钩子路径");
  ok(L.canReConfess(mk8({ loveBondLvAt: lvNow, loveKindled: "yes" }), null) === false,
    "loveKindled 非严格 true（字符串）⇒ 不认作善意（口径：=== true）");
  ok(L.canReConfess({}, null) === false, "rec 空对象 ⇒ false，不崩");
  ok(L.canReConfess(null, null) === false, "rec=null ⇒ false，不崩");
  ok(L.daysSince(dateAgo(9)) === 9 && L.daysSince(dateAgo(0)) === 0, "daysSince(N 天前) === N");
  ok(L.daysSince("") === -1 && L.daysSince(null) === -1, "daysSince(空/null) === -1（⇒ 冷却判定 false）");
}

/* ============================================================
 * §9 · 未命中人格型 ⇒ 全部回落 gentle（绝不返回空串）
 * ============================================================ */
section("§9 未命中人格型 ⇒ 回落 gentle");
{
  const KEYS = ["hint", "confess", "callAsk", "accepted", "declined"];
  const cases = [
    ["look.pers 不存在的人格型", { look: { pers: "nope_type" }, loveVariant: 0 }],
    ["完全没有 look", { loveVariant: 0 }],
    ["look = null", { look: null, loveVariant: 0 }],
    ["pers = 空串", { look: { pers: "" }, loveVariant: 0 }],
    ["pers = 777（非法值）", { look: { pers: 777 }, loveVariant: 0 }],
  ];
  let blame = [], emptyCnt = 0;
  cases.forEach(([name, rec]) => {
    let s = null, threw = false;
    try { s = L.scriptFor(rec, null, {}); } catch (e) { threw = true; }
    if (threw || !s) { blame.push(name + " 抛异常/无返回"); return; }
    if (s.type !== "gentle") blame.push(name + " ⇒ type=" + s.type);
    KEYS.forEach((k) => { if (E_BLANK(s[k])) blame.push(name + " 的 " + k + " 为空"); });
    if (KEYS.every((k) => !s[k])) emptyCnt++;
  });
  ok(blame.length === 0, "🔴 5 种未命中情形一律回落 gentle 且六项全非空 —— " + blame.join("; "));
  ok(emptyCnt === 0, "🔴 未命中时零「全空」返回（UI 不得白屏）");

  const unknown = L.scriptFor({ look: { pers: "???", per: 1 }, loveVariant: 2 }, null, {});
  okLive(!!unknown.confess && unknown.confess === tb("gentle", 0, 2), "未命中型按 rec.loveVariant 取 gentle 对应变体的首告");
  ok(unknown.variant === 2, "未命中型仍尊重已定的变体号 2");
  // ⛔ 任何时候都不许出现 undefined / null
  let bad = [], badCount = 0;
  TYPES.forEach((t) => [0, 1].forEach((r) => [0, 1, 2].forEach((v) => {
    badCount++;
    const s = L.scriptFor({ look: { pers: t }, loveVariant: v, loveTries: r }, null, {});
    KEYS.forEach((k) => { if (typeof s[k] !== "string" || !s[k]) bad.push(t + " r" + (r + 1) + "v" + v + "." + k); });
  })));
  okLive(badCount === 90 && bad.length === 0, "全库 15 型 × 2 轮 × 3 变体 = 90 个组合，六项全部为非空字符串 —— 异常：" + bad.slice(0, 5).join("; "));
}

/* ============================================================
 * §10 · 负向扫描（全库 165 条）
 * ============================================================ */
section("§10 负向扫描：全库 165 条");
{
  ok(ALL.length === 165, "扫描样本 = 165 条（实测 " + ALL.length + "）");
  const WORDS = ["您", "盘", "它", "玩意", "物件", "把玩"];
  WORDS.forEach((w) => {
    const hit = ALL.filter(([, s]) => String(s).indexOf(w) >= 0).map(([n]) => n);
    // ALL.length === 165 一并计入 ⇒ 库缺失时（0 条）也报红，不许拿空数组蒙混过关
    ok(ALL.length === 165 && hit.length === 0,
      "⛔ 「" + w + "」出现 0 次（实测命中 " + hit.length + " 条" + (hit.length ? "：" + hit.slice(0, 3).join(",") : "") + "）");
  });
  // 占位符：仅 {call} / {ta} 两种，且全 ASCII
  const others = [];
  ALL.forEach(([n, s]) => {
    const ph = String(s).match(/\{[^{}]*\}/g) || [];
    ph.forEach((p) => { if (p !== "{call}" && p !== "{ta}") others.push(n + ":" + p); });
    ph.forEach((p) => { if (/[^\x00-\x7F]/.test(p.slice(1, -1))) others.push(n + ":非ASCII占位符" + p); });
    // 残留半边花括号（写作时漏写）
    const strip = String(s).replace(/\{(call|ta)\}/g, "");
    if (strip.indexOf("{") >= 0 || strip.indexOf("}") >= 0) others.push(n + ":残留半边花括号");
  });
  ok(ALL.length === 165 && others.length === 0, "占位符仅 {call} / {ta} 两种且全 ASCII，无残留花括号 —— " + others.slice(0, 5).join("; "));
  const nCall = ALL.reduce((n, [, s]) => n + (String(s).match(/\{call\}/g) || []).length, 0);
  const nTa = ALL.reduce((n, [, s]) => n + (String(s).match(/\{ta\}/g) || []).length, 0);
  ok(nCall === 122, "{call} 共 122 处（与 doc §七-7 一致，实测 " + nCall + "）");
  ok(nTa === 15, "{ta} 共 15 处（与 doc §七-7 一致，实测 " + nTa + "）");
  // {ta} 只出现在 A 列
  let taLeak = [];
  ALL.forEach(([n, s]) => { if (String(s).indexOf("{ta}") >= 0 && n.indexOf("/A") < 0) taLeak.push(n); });
  ok(ALL.length === 165 && taLeak.length === 0, "🔴 {ta} 只出现在 A 列 —— 泄漏到：" + taLeak.slice(0, 5).join(","));
  ok(ALL.length === 165 && ALL.filter(([n]) => n.indexOf("/A") >= 0).length === 15 &&
     ALL.filter(([n]) => n.indexOf("/A") >= 0).every(([, s]) => String(s).indexOf("{ta}") >= 0),
    "A 列 15 条每条都含 {ta}");
  // B / D / E 三列第二人称一律 {call}，不许裸「你」（A 旁白 / C 问称谓 是既定例外）
  let bare = [];
  ALL.forEach(([n, s]) => {
    if (/\/A$/.test(n) || /\/C$/.test(n)) return;
    if (String(s).indexOf("你") >= 0) bare.push(n);
  });
  ok(ALL.length === 165 && bare.length === 0, "B / D / E 三列零裸「你」（实测命中 " + bare.length + " 条）—— " + bare.slice(0, 3).join(","));
  // 替代自称 = 0（沁灵自称一律「我」）
  const SELF = ["奴", "妾", "俺", "吾", "咱家", "本座", "人家"];
  let selfHit = [];
  ALL.forEach(([n, s]) => SELF.forEach((w) => { if (String(s).indexOf(w) >= 0) selfHit.push(n + ":" + w); }));
  ok(ALL.length === 165 && selfHit.length === 0, "零替代自称（沁灵自称一律「我」）—— " + selfHit.slice(0, 3).join(","));
}

/* ============================================================
 * §11 · 后宫口径：排他表述 = 0
 * ============================================================ */
section("§11 后宫口径：排他表述扫描");
{
  const EX = ["唯一", "只对你", "只有你", "只叫你一个人", "这辈子只有你", "就你一个"];
  EX.forEach((w) => {
    const hit = ALL.filter(([, s]) => String(s).indexOf(w) >= 0).map(([n]) => n);
    ok(ALL.length === 165 && hit.length === 0,
      "⛔ 「" + w + "」= 0（后宫口径；实测命中 " + hit.length + " 条" + (hit.length ? "：" + hit.slice(0, 3).join(",") : "") + "）");
  });
  // 再告不许提问、不许喊（21b）
  let ask = [];
  TYPES.forEach((t) => ((L.LOVE_B[t] || [])[1] || []).forEach((s, vi) => {
    if (/[？?！!]/.test(String(s))) ask.push(t + " v" + vi);
  }));
  okLive(ask.length === 0, "再告 45 条零问号零感叹号（⇐ 再告不许提问、不许喊）—— " + ask.join(","));
}

console.log("\n------------------------------------------------------------");
const allGreen = summary();
console.log(allGreen ? "⇒ 全绿：js/love.js（165 条文案库）已落地" : "⇒ 红测");
process.exit(allGreen ? 0 : 1);
