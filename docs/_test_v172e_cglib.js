/* V172-E / V172-F · 进阶 CG 允许多张（不覆盖旧图 · ⛔ 系统永不自动裁剪）自测
 * ===========================================================================
 * 钉住的契约：
 *   1. rec.cgList：历史进阶 CG 的 url 列表；cgListPush 幂等 + 去重 + ⛔ 无上限（系统永不自动丢）
 *   2. ensureCgList 懒迁移：老档从 rec.cgs 的 adv# 条目按 at 重建（不含当前 cgUrl / 主线）
 *   3. cgListRemove / cgListCount：逐个删 / 计数；空记录安全
 *   4. cgAdvKey 归档 key 唯一化：同阶多次生成各成一条相册条目（⛔ 不覆盖旧图）；
 *      cgAdvIds 认 adv#*（相册能显示多张）；cgCollectedIds 排除 adv#（⛔ 不撑进度）
 *   5. dropOldCgThumbs：清表不误创字段；⛔ 不碰 cgList（v172-F：配额瘦身只丢 cgs 的 thumb）
 *   6. app.js 接线（静态）：出图前先 push 旧 cgUrl；归档 key 走 cgAdvKey；管理页列历史；⛔ 不删云端文件
 *   7. openSpiritCgManager 真跑：cgList 历史项列出、删一项只动本地引用、不动当前 cgUrl
 *
 * 用法： node docs/_test_v172e_cglib.js
 * 负向对照（证明抓得住「还没做多张」）：
 *   git show 9adf2e0:js/spirits.js > /tmp/sp_prev.js && SPIRITS_SRC=/tmp/sp_prev.js node docs/_test_v172e_cglib.js → 必须 FAIL
 * 负向对照（V172-F：证明抓得住「系统悄悄裁剪」）：
 *   git show 4befc2f:js/spirits.js > /tmp/sp_v172e.js && SPIRITS_SRC=/tmp/sp_v172e.js node docs/_test_v172e_cglib.js → 必须 FAIL
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const SPIRITS_SRC = process.env.SPIRITS_SRC || "js/spirits.js";
const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
console.log("源码：" + SPIRITS_SRC + " + js/app.js");

let PASS = 0, FAIL = 0;
const F = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; F.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function newS() { const c = H.makeContext(); H.loadFile(c.ctx, SPIRITS_SRC); return c.sandbox.Spirits; }
/* 负向兜底：改动前没有这些导出时返回空操作桩，让断言继续跑完并如实 FAIL（而不是崩栈） */
function fn(S, name) { return typeof S[name] === "function" ? S[name] : function () { return null; }; }

function extractFn(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf("(", m.index), pd = 0;
  for (; i < src.length; i++) { if (src[i] === "(") pd++; else if (src[i] === ")") { pd--; if (pd === 0) { i++; break; } } }
  while (i < src.length && src[i] !== "{") i++;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") { const q = ch; i++; while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) break; i++; } continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(m.index, i);
}

/* ========================================================================
 * 1 · cgListPush：幂等 + 去重 + ⛔ 无上限（系统永不自动丢）
 * ====================================================================== */
section("1 · cgListPush：幂等 / 去重 / ⛔ 无上限（永不自动丢）");
{
  const S = newS();
  ok(typeof S.cgListPush === "function", "cgListPush 导出");
  ok(S.CG_LIST_MAX === undefined, "⛔ CG_LIST_MAX 已不存在（「上限」概念已废）");
  const push = fn(S, "cgListPush");
  const rec = {};
  ok(push(rec, "A") === true && JSON.stringify(rec.cgList) === JSON.stringify(["A"]), "push 首次 → cgList=[A]");
  ok(push(rec, "A") === false && rec.cgList.length === 1, "push 同值幂等（不重复）");
  ok(push(rec, "") === false, "空 url 不写");
  // v172-F：推 40 张必须原样保留 40 张（旧实现在 30 张处会开始 shift 掉最旧）
  const r2 = { cgList: [] };
  for (let i = 0; i < 40; i++) push(r2, "u" + i);
  ok(r2.cgList.length === 40, "推 40 张 → 长度仍是 40（⛔ 不裁剪，实得 " + r2.cgList.length + "）");
  ok(r2.cgList[0] === "u0", "最旧一张 u0 仍在（系统没偷偷删）");
  ok(r2.cgList[39] === "u39", "最新一张 u39 在");
}

/* ========================================================================
 * 2 · ensureCgList 懒迁移
 * ====================================================================== */
section("2 · ensureCgList 懒迁移（从 cgs.adv# 重建，不含当前 cgUrl / 主线）");
{
  const S = newS();
  ok(typeof S.ensureCgList === "function", "ensureCgList 导出");
  const mig = fn(S, "ensureCgList");
  const rec = { cgUrl: "cur", cgs: {
    "adv#1": { hasImg: true, thumb: "A", at: 1 },
    "adv#2": { hasImg: true, thumb: "B", at: 2 },
    "0": { hasImg: true, thumb: "M", at: 3 },      // 主线 CG：不进 cgList
  } };
  ok(mig(rec) === true, "首次迁移返回 true");
  ok(JSON.stringify(rec.cgList) === JSON.stringify(["A", "B"]),
    "cgList=[A,B]（按 at 升序，不含 cur / 主线 M，实得 " + JSON.stringify(rec.cgList) + "）");
  ok(mig(rec) === false, "已迁移过的再调 → false（幂等）");
  const e = {};
  mig(e);
  ok(!("cgs" in e), "ensureCgList 不给记录塞空 cgs（体积纪律）");
}

/* ========================================================================
 * 3 · cgListRemove / cgListCount / cgListRO
 * ====================================================================== */
section("3 · cgListRemove / cgListCount / cgListRO");
{
  const S = newS();
  const rec = { cgList: ["A", "B"] };
  ok(fn(S, "cgListCount")(rec) === 2, "count=2");
  ok(fn(S, "cgListRemove")(rec, "A") === true && JSON.stringify(rec.cgList) === JSON.stringify(["B"]), "删 A → 剩 [B]");
  ok(fn(S, "cgListRemove")(rec, "Z") === false, "删不存在 → false");
  ok(fn(S, "cgListCount")({}) === 0 && fn(S, "cgListRO")({}) === null, "空记录安全");
}

/* ========================================================================
 * 4 · cgAdvKey 唯一化 + 相册识别 + 不计进度
 * ====================================================================== */
section("4 · cgAdvKey 归档 key 唯一化（⛔ 不覆盖旧图）");
{
  const S = newS();
  ok(typeof S.cgAdvKey === "function", "cgAdvKey 导出");
  const key = fn(S, "cgAdvKey");
  const a = key(3, 111), b = key(3, 222);
  ok(a !== b, "同阶不同时间 → 不同 key：" + a + " / " + b);
  ok(String(a).indexOf("adv#3#") === 0, "key 形如 adv#<阶>#<时间>");
  const rec = { cgs: {} };
  if (typeof S.cgMarkCollected === "function") {
    S.cgMarkCollected(rec, a, { title: "t" }, "u1");
    S.cgMarkCollected(rec, b, { title: "t" }, "u2");
    ok(Object.keys(rec.cgs).length === 2, "两次归档 → rec.cgs 两条（⛔ 不覆盖）");
  } else { ok(false, "cgMarkCollected 缺失（基线异常）"); }
  ok(fn(S, "cgAdvIds")(rec).length === 2, "cgAdvIds 认这两个 adv# key（相册能显示多张）");
  ok((typeof S.cgCollectedIds === "function" ? S.cgCollectedIds(rec) : [1]).length === 0, "cgCollectedIds 排除 adv#（⛔ 不撑进度）");
}

/* ========================================================================
 * 5 · dropOldCgThumbs：不误创字段 + ⛔ cgList 豁免（v172-F：不再裁剪）
 * ====================================================================== */
section("5 · dropOldCgThumbs：清表不误创字段；⛔ cgList 豁免（不裁剪）");
{
  const S = newS();
  const empty = {};
  fn(S, "dropOldCgThumbs")(empty, 3);
  ok(!("cgs" in empty) && !("cgList" in empty), "空记录 → 不凭空创 cgs / cgList");
  const rec = { cgList: ["a", "b", "c", "d", "e"], cgs: {} };
  fn(S, "dropOldCgThumbs")(rec, 3);
  ok(rec.cgList.length === 5 && rec.cgList[0] === "a" && rec.cgList[4] === "e",
    "⛔ cgList 不参与配额瘦身（5 张原样保留，实得 " + JSON.stringify(rec.cgList) + "）");
  ok(rec.cgList.every((u) => typeof u === "string"), "cgList 元素仍是 url 字符串（语义不变）");
  // 唯一允许长度下降的入口 = 玩家点删
  const before = rec.cgList.length;
  fn(S, "cgListRemove")(rec, "c");
  ok(rec.cgList.length === before - 1, "只有玩家点删（cgListRemove）才让长度下降");
}

/* ========================================================================
 * 6 · app.js 接线（静态）
 * ====================================================================== */
section("6 · app.js 接线：出图前推 cgList + 归档 key 唯一化 + 管理页列历史");
{
  ok(/Spirits\.cgListPush\(r2, r2\.cgUrl\)/.test(app), "出图回调：覆盖前先 push 旧 cgUrl");
  ok(/Spirits\.cgAdvKey\(stage, _cgAt\)/.test(app), "出图回调：归档 key 走 cgAdvKey（唯一化）");
  ok(!/cgMarkCollected\(r2, "adv#" \+ stage/.test(app), "⛔ 旧的 'adv#'+stage（会覆盖）已不存在");
  ok(/kind: "cgl"/.test(app) && /cgListRemove\(rec, it2\.url\)/.test(app), "openSpiritCgManager 列出 cgList 历史并可单独删");
  const br = /else if \(it2\.kind === "cgl"\)([^\n]*)/.exec(app);
  ok(!!br && !/Storage|\.remove\(|cgDelete|deleteCgPixels/.test(br[1]),
    "⛔ 删 cgl 分支只删本地引用，不触碰云端 Storage / 像素库");
}

/* ========================================================================
 * 7 · openSpiritCgManager 真跑
 * ====================================================================== */
section("7 · openSpiritCgManager 真跑：cgList 历史项列出 + 删除只动本地");
{
  const fnsrc = extractFn(app, "openSpiritCgManager");
  ok(!!fnsrc, "openSpiritCgManager 可抽取");
  const sb = {
    console, Math, JSON, String, Number, Boolean, Array, Object, Error, RegExp, Promise, Date,
    __dm: null, __saved: 0, __store: null,
    Spirits: {
      load() { return sb.__store; },
      ensureIn(store, id) { if (!store[id]) store[id] = {}; const r = store[id]; if (!r.cgs) r.cgs = {}; if (!r.fests) r.fests = {}; return r; },
      save() { sb.__saved++; },
      ensureCgList(rec) { return false; },
      cgListRO(rec) { return Array.isArray(rec.cgList) ? rec.cgList : null; },
      cgListRemove(rec, u) { const l = Array.isArray(rec.cgList) ? rec.cgList : null; if (!l) return false; const i = l.indexOf(u); if (i < 0) return false; l.splice(i, 1); return true; },
      __remoteDeleted: false,
    },
    spiritItemById() { return null; },
    nameOf(it) { return it.name; },
    toast() {},
    openDelManager(t, items, od, odone) { sb.__dm = { title: t, items: items, onDelete: od, onDone: odone }; },
    renderSpiritDetailPage() {},
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.__store = { sp1: { cgUrl: "cur", cgKey: "k", cgStage: 3, cgList: ["old1", "old2"], cgs: {}, fests: {} } };
  try { vm.runInContext(fnsrc, vm.createContext(sb), { filename: "app.js#cgm" }); }
  catch (e) { ok(false, "openSpiritCgManager 装载失败：" + e.message); }
  if (typeof sb.openSpiritCgManager === "function") {
    sb.openSpiritCgManager("sp1");
    const items = sb.__dm.items;
    ok(items.some((x) => x.kind === "adv" && x.url === "cur"), "当前 CG 在列（adv = cur）");
    ok(items.filter((x) => x.kind === "cgl").length === 2, "cgList 两条历史都在列（cgl）");
    const old1 = items.filter((x) => x.kind === "cgl" && x.url === "old1")[0];
    ok(!!old1, "old1 在列");
    sb.__dm.onDelete(old1);
    ok(JSON.stringify(sb.__store.sp1.cgList) === JSON.stringify(["old2"]), "删 old1 → cgList 只剩 old2");
    ok(sb.__store.sp1.cgUrl === "cur", "⛔ 删历史项不影响当前 cgUrl");
    ok(sb.Spirits.__remoteDeleted === false, "⛔ 未调用任何云端删除（只删本地引用）");
  }
}

/* ---------- 汇总 ---------- */
console.log("\n----------------------------------------");
console.log("V172-E 进阶 CG 多张：通过 " + PASS + " 项，失败 " + FAIL + " 项");
if (F.length) { console.log("失败清单："); F.forEach((x) => console.log("  - " + x)); }
process.exit(FAIL ? 1 : 0);
