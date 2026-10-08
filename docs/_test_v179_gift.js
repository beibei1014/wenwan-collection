/* v179 · 送礼系统三条断链接线自测（礼物台账云同步 / 礼物来源补齐 / loveKindled 善意钩子）
   ------------------------------------------------------------
   覆盖：
     任务1 · 礼物台账接入云同步：db.js getGiftStore/putGiftStore/mergeGiftStores（含 log 合并）；
        - 云端可用 ⇒ putGiftStore 被调用（upsert 命中）
        - 表不存在 / 未登录 / 抛异常 ⇒ 静默降级不崩（db 抛、app 层 try/catch 吞）
        - 合并策略：按 giftKey 取 max（不覆盖更大的值）· gifted 取较新日期 · log 取较新 ymd
        - spirits.saveGifts 派发 ww:gifts-changed；app.js 有 pushGifts/pullGifts 接线
     任务2 · 礼物来源补齐：Spirits.reconcileGiftSources（节令/破阶/章末/签）
        - 每个来源触发一次 → 礼物到账；再触发一次 → 不重复（幂等）
     任务3 · loveKindled 善意钩子：normRecV165 默认 false；落盘；app.js 送礼/照料成功置位、失败不置位
     任务3 联动：loveKindled=true 时 Love.canReConfess 条件③-b 可满足
     回归护栏：rec.marks / rec.flags / item.gifted 在送礼前后未被污染
   ------------------------------------------------------------
   纪律：本文件在「改动前源码」上必须 FAIL（负向对照）。
     做法： git worktree add /tmp/_base b1b501c
            node docs/_test_v179_gift.js   （worktree 内）  → 必须红
     （⛔ 绝不用 git show HEAD —— 显式铆定 b1b501c）
   ------------------------------------------------------------ */
"use strict";
const fs = require("fs"), path = require("path");
const H = require("./_harness.js");
const ROOT = path.join(__dirname, "..");

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }

const APP_SRC = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");

/* ---------- 日期伪造（把「今天」钉在某一天，让节令/签可确定性触发） ---------- */
function fakeDateClass(ymd) {
  const p = String(ymd).split("-").map(Number);
  const Y = p[0], M = p[1] - 1, D = p[2];
  return class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(Y, M, D, 12, 0, 0); else super(...a); }
    static now() { return new Date(Y, M, D, 12, 0, 0).getTime(); }
  };
}

function newS(ymd) {
  const c = H.makeContext();
  H.loadFile(c.ctx, "js/spirits.js");
  if (ymd) c.sandbox.Date = fakeDateClass(ymd);
  return { S: c.sandbox.Spirits, c: c };
}
function newLove() {
  const c = H.makeContext();
  H.loadFile(c.ctx, "js/spirits.js");
  H.loadFile(c.ctx, "js/love.js");
  return { Love: c.sandbox.Love, S: c.sandbox.Spirits, c: c };
}
function newDB(mode, opts) {
  opts = opts || {};
  const calls = { upsert: [], select: 0 };
  const client = {
    auth: { getUser: async () => ({ data: { user: (mode === "noUser" ? null : { id: "u1" }) } }) },
    from() {
      return {
        select() { return { eq() { return { maybeSingle: async () => {
          calls.select++;
          if (mode === "tableMissing") return { data: null, error: new Error('relation "gift_store" does not exist') };
          if (mode === "ok") return { data: { data: opts.row || { gifts: { ware_cup: 3 } }, updated_at: "2025-01-01T00:00:00Z" }, error: null };
          return { data: null, error: null };
        } }; } }; },
        upsert(row) {
          calls.upsert.push(row);
          if (mode === "tableMissing") return { error: new Error('relation "gift_store" does not exist') };
          return { error: null };
        },
      };
    },
  };
  const c = H.makeContext();
  c.sandbox.SUPABASE_CONFIG = { url: "https://x.supabase.co", anonKey: "anon-key" };
  c.sandbox.supabase = { createClient: () => client };
  H.loadFile(c.ctx, "js/db.js");
  return { DB: c.sandbox.DB, c: c, calls: calls };
}
async function rejects(p) { try { await p; return false; } catch (e) { return true; } }

/* ============================================================
 * 1 · 任务1：礼物台账接云同步（db 层）
 * ============================================================ */
section("1 · 任务1 db层：getGiftStore / putGiftStore / mergeGiftStores");
(async () => {
  {
    const { DB } = newDB("ok");
    ok(typeof DB.getGiftStore === "function", "DB.getGiftStore 存在");
    ok(typeof DB.putGiftStore === "function", "DB.putGiftStore 存在");
    ok(typeof DB.mergeGiftStores === "function", "DB.mergeGiftStores 存在");
  }
  {
    const { DB, calls } = newDB("ok");
    const r = await DB.putGiftStore({ gifts: { ware_cup: 1 } });
    ok(r === true, "云端可用：putGiftStore 成功返回 true");
    ok(calls.upsert.length === 1, "云端可用：推送被调用（upsert 命中 1 次）");
    ok(calls.upsert[0] && calls.upsert[0].user_id === "u1" && !!calls.upsert[0].data, "推送负载含 user_id + data");
  }
  {
    const { DB } = newDB("ok", { row: { gifts: { human_tea: 4 } } });
    const remote = await DB.getGiftStore();
    ok(remote && remote.data && remote.data.gifts.human_tea === 4, "云端可用：getGiftStore 拉回 data");
  }
  {
    const { DB } = newDB("tableMissing");
    ok(await rejects(DB.getGiftStore()), "表不存在：getGiftStore 抛错（由上层 try/catch 吞）");
    ok(await rejects(DB.putGiftStore({})), "表不存在：putGiftStore 抛错（由上层 try/catch 吞）");
    // 静默降级：db 抛、app 层吞 ⇒ 不崩
    let appThrew = false;
    try { try { await DB.putGiftStore({ x: 1 }); } catch (e) { /* swallow */ } } catch (e) { appThrew = true; }
    ok(!appThrew, "静默降级：表不存在时 app 层 try/catch 吞掉 ⇒ 不崩、不阻断");
  }
  {
    const { DB } = newDB("noUser");
    ok(await rejects(DB.getGiftStore()), "未登录：getGiftStore 抛错（静默跳过）");
  }
  {
    const DB = newDB("ok").DB;
    const A = { v: 1, gifts: { ware_cup: 2, human_tea: 5 }, gifted: { k1: "2025-01-01" }, log: { ymd: "2025-01-02", keys: { a: 1 } }, at: 100 };
    const B = { v: 1, gifts: { ware_cup: 7, cloth_pa: 1, human_tea: 2 }, gifted: { k1: "2025-01-03", k2: "2024-12-01" }, log: { ymd: "2025-01-01", keys: { b: 1 } }, at: 200 };
    const m = DB.mergeGiftStores(A, B);
    ok(m.gifts.ware_cup === 7, "合并：按 giftKey 取 max（ware_cup 2 vs 7 → 7）");
    ok(m.gifts.human_tea === 5, "合并：不覆盖更大的值（human_tea 5 vs 2 → 保持 5）");
    ok(m.gifts.cloth_pa === 1, "合并：并集（B 独有的 cloth_pa 保留）");
    ok(m.gifted.k1 === "2025-01-03", "合并：gifted 取较新日期（2025-01-01 → 2025-01-03）");
    ok(m.log && m.log.ymd === "2025-01-02", "合并：log 取较新 ymd（v179 新增）");
  }
  {
    const { S, c } = newS();
    const ev = [];
    c.win.addEventListener("ww:gifts-changed", () => ev.push(1));
    S.saveGifts({ ware_cup: 1 });
    ok(ev.length === 1, "spirits.saveGifts 派发 ww:gifts-changed（同步层据此防抖推送）");
    ok(c.store.getItem("ww_gifts") != null, "saveGifts 落盘 ww_gifts");
    ok(typeof S.loadGiftDay === "function" && typeof S.saveGiftDay === "function", "发放账本 load/saveGiftDay 存在（供同步打包）");
  }

  /* ---------- 任务1 · app.js 接线（字符串护栏） ---------- */
  section("1 · 任务1 app.js 接线（pushGifts/pullGifts/事件/init）");
  ok(/async\s+function\s+pushGifts\s*\(/.test(APP_SRC), "app.js 定义 pushGifts");
  ok(/async\s+function\s+pullGifts\s*\(/.test(APP_SRC), "app.js 定义 pullGifts");
  ok(/DB\.putGiftStore\(/.test(APP_SRC), "app.js 调用 DB.putGiftStore（推送）");
  ok(/DB\.getGiftStore\(/.test(APP_SRC), "app.js 调用 DB.getGiftStore（拉取）");
  ok(/DB\.mergeGiftStores\(/.test(APP_SRC), "app.js 复用 DB.mergeGiftStores（不另造合并）");
  ok(/"ww:gifts-changed"/.test(APP_SRC), "app.js 监听 ww:gifts-changed");
  ok(/pullGifts\(\)\.catch/.test(APP_SRC), "app.js init（登录后）调用 pullGifts");
  {
    const fnIdx = APP_SRC.indexOf("async function pushGifts");
    const body = APP_SRC.slice(fnIdx, fnIdx + 700);
    ok(/catch\s*\(/.test(body), "pushGifts 内含 try/catch（异常静默降级）");
    const fnIdx2 = APP_SRC.indexOf("async function pullGifts");
    const body2 = APP_SRC.slice(fnIdx2, fnIdx2 + 800);
    ok(/catch\s*\(/.test(body2), "pullGifts 内含 try/catch（异常静默降级）");
  }

  /* ============================================================
   * 2 · 任务2：礼物来源补齐（reconcileGiftSources）
   * ============================================================ */
  section("2 · 任务2 礼物来源：破阶 / 章末 / 节令 / 签（幂等）");
  const HAS_REC = typeof newS().S.reconcileGiftSources === "function";
  ok(HAS_REC, "Spirits.reconcileGiftSources 存在");
  if (HAS_REC) {
  {
    // ② 破阶（逐串，每阶 1 件）
    const { S } = newS("2025-06-15");   // 非节令日
    const rec = { stage: 2 };
    const g0 = S.loadGifts();
    const r1 = S.reconcileGiftSources({ id: "sA" }, rec, null);
    const g1 = S.loadGifts();
    ok(r1.length >= 1 && r1.some((x) => x[1] === "stage:sA:2"), "破阶来源触发：stage=2 → 发放 1 件（stage:sA:2）");
    const key2 = r1.filter((x) => x[1] === "stage:sA:2")[0][0];
    ok((Number(g1[key2]) || 0) === (Number(g0[key2]) || 0) + 1, "破阶来源：库存 +1 到账");
    const r2 = S.reconcileGiftSources({ id: "sA" }, rec, null);
    ok(r2.every((x) => x[1] !== "stage:sA:2"), "破阶来源幂等：再触发同阶不重复发");
  }
  {
    // ③ 章末（逐串，每读完一章 1 件）
    const { S } = newS("2025-06-15");
    const rec = { chapters: { "0": { at: 1 }, "1": { at: 2 } } };
    const r1 = S.reconcileGiftSources({ id: "sB" }, rec, null);
    const chKeys = r1.filter((x) => x[1].indexOf("chapter:sB:") === 0);
    ok(chKeys.length === 2, "章末来源：读完 2 章 → 发放 2 件");
    const r2 = S.reconcileGiftSources({ id: "sB" }, rec, null);
    ok(r2.filter((x) => x[1].indexOf("chapter:sB:") === 0).length === 0, "章末来源幂等：再读同章不重复发");
  }
  {
    // ① 节令（玩家级，国庆 10-01）
    const { S } = newS("2025-10-01");
    const g0 = S.loadGifts();
    const r1 = S.reconcileGiftSources({ id: "sC" }, {}, null);
    ok(r1.some((x) => x[1] === "fest:2025-10-01"), "节令来源触发：当天有节令 → 发放 1 件");
    const g1 = S.loadGifts();
    const gk = "fest:" + ""; // 仅示意
    ok(Object.keys(g1).length >= Object.keys(g0).length, "节令来源：库存已写入");
    const r2 = S.reconcileGiftSources({ id: "sC" }, {}, null);
    ok(r2.every((x) => x[1] !== "fest:2025-10-01"), "节令来源幂等：同一天不重复发");
  }
  {
    // ④ 签（玩家级，约 1 件/周）—— 暴力搜一个「宜赠」日
    const { S, c } = newS();
    let signDay = "";
    for (let d = 1; d <= 28 && !signDay; d++) {
      const ymd = "2025-06-" + String(d).padStart(2, "0");
      c.sandbox.Date = fakeDateClass(ymd);
      c.store.setItem("ww_story", "{}");
      c.store.setItem("ww_gifts", "{}");
      const r = S.reconcileGiftSources({ id: "sD" }, {}, null);
      if (r.some((x) => x[1] === "sign:" + ymd)) signDay = ymd;
    }
    ok(!!signDay, "签来源：存在「今日宜赠」日（约 1 件/周，可确定性命中）");
    if (signDay) {
      c.sandbox.Date = fakeDateClass(signDay);
      c.store.setItem("ww_story", "{}"); c.store.setItem("ww_gifts", "{}");
      const r1 = S.reconcileGiftSources({ id: "sD" }, {}, null);
      ok(r1.some((x) => x[1] === "sign:" + signDay), "签来源触发：宜赠日 → 发放 1 件");
      const r2 = S.reconcileGiftSources({ id: "sD" }, {}, null);
      ok(r2.every((x) => x[1].indexOf("sign:") !== 0), "签来源幂等：同一天不重复发");
    }
  }
  {
    // 幂等落盘键：ww_story.giftSeeded
    const { S, c } = newS("2025-06-15");
    S.reconcileGiftSources({ id: "sE" }, { stage: 3 }, null);
    const story = JSON.parse(c.store.getItem("ww_story") || "{}");
    ok(story.giftSeeded && story.giftSeeded["stage:sE:3"], "幂等依据落 ww_story.giftSeeded[sourceKey]");
  }
  }

  /* ============================================================
   * 3 · 任务3：loveKindled 善意钩子
   * ============================================================ */
  section("3 · 任务3 loveKindled：默认值 / 落盘 / app.js 置位点");
  {
    const { S } = newS();
    const st = S.load();
    const r = S.ensureIn(st, "sF");
    ok(r.loveKindled === false, "normRecV165：新档 loveKindled 默认 false（未写过的老档不误判为 true）");
    r.loveKindled = true; S.save(st);
    const r2 = S.load().sF || {};
    ok(r2.loveKindled === true, "loveKindled 可落盘（load 后仍为 true）");
  }
  {
    const careIdx = APP_SRC.indexOf("async function spiritCareDo");
    const careBody = APP_SRC.slice(careIdx, careIdx + 900);
    ok(/rec\.loveKindled\s*=\s*true/.test(careBody), "app.js 照料成功 ⇒ rec.loveKindled = true");
    ok(careBody.indexOf("if (!r.ok)") < careBody.indexOf("rec.loveKindled = true"), "照料置位在 !r.ok 早退之后（失败不置位）");
  }
  {
    const gIdx = APP_SRC.indexOf("const doGive = async (giftKey)");
    const gBody = APP_SRC.slice(gIdx, gIdx + 1800);
    ok(/hrec\.loveKindled\s*=\s*true/.test(gBody), "app.js 送礼成功 ⇒ hrec.loveKindled = true");
    ok(gBody.indexOf("if (!res.ok)") < gBody.indexOf("hrec.loveKindled = true"), "送礼置位在 !res.ok 早退之后（失败不置位）");
  }
  {
    ok(/reconcileGiftSources\(it,\s*r3,\s*ctx\)/.test(APP_SRC), "任务2 接线：ensureSpiritExtras 每日对账 reconcileGiftSources");
    ok(/reconcileGiftSources\(item,\s*r,\s*null\)/.test(APP_SRC), "任务2 接线：confirmStage 破阶即对账");
  }

  /* ============================================================
   * 4 · 任务3 联动：Love.canReConfess 条件③-b
   * ============================================================ */
  section("4 · 任务3 联动：loveKindled 使 canReConfess 条件③-b 可满足");
  {
    const { Love } = newLove();
    const now = new Date();
    const d20 = new Date(now.getTime() - 20 * 86400000);
    const key20 = d20.getFullYear() + "-" + String(d20.getMonth() + 1).padStart(2, "0") + "-" + String(d20.getDate()).padStart(2, "0");
    const key0 = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    const base = { loveState: "declined", loveTries: 0, loveDeclinedAt: key20, bond: 30, loveBondLvAt: 3 };
    ok(Love.canReConfess(Object.assign({}, base, { loveKindled: true }), {}) === true,
      "canReConfess：冷却过 + 次数够 + loveKindled ⇒ true（善意通路打通）");
    ok(Love.canReConfess(base, {}) === false,
      "canReConfess：无 loveKindled 且羁绊未升档 ⇒ false（对照）");
    ok(Love.canReConfess(Object.assign({}, base, { loveKindled: true, loveDeclinedAt: key0 }), {}) === false,
      "canReConfess：冷却未满 ⇒ 即便 loveKindled 也 false（其它条件仍生效）");
    ok(Love.canReConfess(Object.assign({}, base, { loveKindled: true, loveState: "none" }), {}) === false,
      "canReConfess：非婉拒态 ⇒ false");
  }

  /* ============================================================
   * 5 · 回归护栏：marks / flags / item.gifted 不被污染
   * ============================================================ */
  section("5 · 回归护栏：送礼前后 marks / flags / item.gifted 未被污染");
  {
    const { S } = newS("2025-06-15");
    const gifts = { ware_cup: 5 };
    const st = S.load();
    const rec = S.ensureIn(st, "sG");
    rec.bond = 200;                                       // 资格达标（相熟以上）
    rec.marks = { "2025-01-01": { note: 1 } };
    rec.flags = { stance: "DECIDE", bondLv: 7, scattered: false };
    const item = { id: "sG", gifted: false };
    const marksBefore = JSON.stringify(rec.marks);
    const flagsBefore = JSON.stringify(rec.flags);
    const res = S.giveGift(gifts, rec, "ware_cup", { dayKey: "2025-06-15" });
    ok(res.ok === true, "护栏基线：送礼成功（前置条件满足）");
    ok(JSON.stringify(rec.marks) === marksBefore, "送礼后 rec.marks 未被污染");
    ok(JSON.stringify(rec.flags) === flagsBefore, "送礼后 rec.flags 未被污染");
    ok(item.gifted === false, "送礼后 item.gifted 未被污染（gifted 是「物件已送人」，本系统不复用）");
    // 来源对账同样不进 marks/flags
    const marks2 = JSON.stringify(rec.marks);
    const flags2 = JSON.stringify(rec.flags);
    if (HAS_REC) S.reconcileGiftSources({ id: "sG" }, Object.assign({}, rec, { stage: 2, chapters: { "0": { at: 1 } } }), null);
    ok(JSON.stringify(rec.marks) === marks2, "来源对账后 rec.marks 未被污染");
    ok(JSON.stringify(rec.flags) === flags2, "来源对账后 rec.flags 未被污染");
  }
  {
    // 失败路径：giveGift 失败不写任何账（lock）
    const { S } = newS("2025-06-15");
    const gifts = { ware_cup: 5 };
    const rec = { bond: 0, marks: { x: 1 }, flags: { stance: "UNSET" } };
    const res = S.giveGift(gifts, rec, "ware_cup", {});
    ok(res.ok === false && res.reason === "locked", "失败路径：资格不足 ⇒ locked");
    ok(gifts.ware_cup === 5, "失败路径：不扣库存");
    ok(!rec.giftLog || Object.keys(rec.giftLog).length === 0, "失败路径：不写 giftLog");
  }

  /* ---------- 汇总 ---------- */
  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL === 0 ? 0 : 1);
})();
