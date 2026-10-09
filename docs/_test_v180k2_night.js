/* ============================================================
 * _test_v180k2_night.js · V180 批K-2 · 删老夜话
 * ------------------------------------------------------------
 *   A. 数据层：NIGHT_EVENTS 清空 / NIGHT_ACTS 删除 / 13 个老 id 全不在现役池
 *   B. NIGHT_OLD_IDS = 13 且恰好等于被删的那 13 个
 *   C. nightPurgeOld：一次性幂等 / 清 done+runs / 删 rec.night
 *      ⛔ prune 三禁：rec.marks / rec.cgs / rec.mainIds 一律不碰
 *   D. threadMigrate：老 rec.night 先迁移再 purge；已 __v162 的 rec 也要清
 *   E. after 重挂：f_oldwall 开局即解锁 / f_wake 需先打完 f_oldwall / ⛔ 无事件永久锁死
 *   F. 负向对照（铆定 docs/_tmp/_pre_v180k2_spirits.js = b96fc50 改前 · ⛔ 不用 HEAD）
 *
 * 用法： node docs/_test_v180k2_night.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");
const ROOT = path.join(__dirname, "..");

const NEW9 = ["f_oldwall", "f_wake", "d_nightout", "d_oldcloth", "d_roadside", "r_lost", "r_noreturn", "r_lastbite", "r_spot"];
const OLD13 = ["a1", "a2", "a3", "a4", "f_new", "f_spring", "f_trip", "f_lost",
  "d_birth", "d_clash", "r_thunder", "r_joy", "r_sad"];

function mkWorld() {
  const PERS = ["wild", "calm", "sentimental", "pampered", "scholar", "heroic"];
  const ROOMS = ["roomA", "roomB", "roomC", "roomD", "roomE", "roomF", "roomG", "roomH"];
  const items = [], store = {};
  for (let i = 0; i < 24; i++) {
    const id = "it" + i;
    items.push({
      id: id, name: "串" + i, roomId: ROOMS[Math.floor(i / 3)], playCount: (i * 7) % 40,
      createdAt: Date.now() - (i + 1) * 86400000 * 5, color: "red", species: "金刚菩提", category: "菩提",
    });
    store[id] = {
      stage: 1 + (i % 4), bornAt: Date.now() - (i + 1) * 86400000 * 3, bond: (i * 13) % 140,
      look: { pers: PERS[i % 6] }, persona: { name: "小" + i, title: "守珠人", line: "x", traits: ["安静"] },
      chapters: {}, threads: {},
    };
  }
  const ctx = { dayNo: 400, idleDays: 12, plays: 30 };
  const groups = ROOMS.map((r, gi) => ({ id: r, name: "小屋 " + r, items: items.slice(gi * 3, gi * 3 + 3) }));
  return { items: items, store: store, ctx: ctx, groups: groups };
}

/* 现役引擎（改后） */
function loadCurrent() {
  const h = makeContext();
  loadFile(h.ctx, "js/night-v180.js");
  loadFile(h.ctx, "js/spirits.js");
  return h;
}
/* 铆定基线（改前 b96fc50 的 spirits.js 快照，docs/_tmp 已被 git 排除） */
function loadBaseline() {
  const h = makeContext();
  loadFile(h.ctx, "js/night-v180.js");
  loadFile(h.ctx, "docs/_tmp/_pre_v180k2_spirits.js");
  return h;
}

let S = null, H = null;
{
  H = loadCurrent();
  S = H.sandbox.Spirits;
  ok(!!S, "沙箱拿到 Spirits（现役）");
}

/* ============================================================
 * A. 数据层
 * ============================================================ */
section("A · 数据层：老夜话已删、现役池只剩 9 条");
{
  ok(!!S, "前置：Spirits 就绪");
  ok(S.NIGHT_EVENTS.length === 0, "⛔ NIGHT_EVENTS 已清空（实得 " + S.NIGHT_EVENTS.length + "）");
  ok(Array.isArray(S.NIGHT_EVENT_POOL) || typeof S.nightPoolSync === "function", "合并池 API 仍在");
  const pool = S.nightPoolSync();
  ok(pool.length === 9, "⛔ 现役池 = 9 条（实得 " + pool.length + "）");
  ok(pool.map((e) => e.id).join(",") === NEW9.join(","), "现役池 id 序列 = night-v180 的 9 条（实得 " + pool.map((e) => e.id).join(",") + "）");
  const stillThere = OLD13.filter((id) => !!S.eventOf(id));
  ok(stillThere.length === 0, "⛔ 13 个老 id 一个都不在现役池（残留 " + JSON.stringify(stillThere) + "）");
  ok(typeof S.NIGHT_ACTS === "undefined", "⛔ NIGHT_ACTS 已从导出里消失");
  ok(typeof S.nightEnter === "undefined" && typeof S.nightActs === "undefined" && typeof S.nightChoose === "undefined",
    "⛔ v160 act 运行时（nightEnter/nightActs/nightChoose）已从导出里消失");
  ok(typeof S.NIGHT_GROUP === "string" && S.NIGHT_GROUP.length > 0, "NIGHT_GROUP 保留（v162 thVars 仍在用；实得 " + JSON.stringify(S.NIGHT_GROUP) + "）");
}

/* ============================================================
 * B. NIGHT_OLD_IDS
 * ============================================================ */
section("B · NIGHT_OLD_IDS = 被删的那 13 个");
{
  ok(Array.isArray(S.NIGHT_OLD_IDS), "NIGHT_OLD_IDS 是数组");
  ok(S.NIGHT_OLD_IDS.length === 13, "NIGHT_OLD_IDS = 13（实得 " + S.NIGHT_OLD_IDS.length + "）");
  const miss = OLD13.filter((id) => S.NIGHT_OLD_IDS.indexOf(id) < 0);
  const extra = S.NIGHT_OLD_IDS.filter((id) => OLD13.indexOf(id) < 0);
  ok(miss.length === 0 && extra.length === 0, "⛔ 与「4 幕 + 老 9 条」逐一吻合（缺 " + JSON.stringify(miss) + " 多 " + JSON.stringify(extra) + "）");
  const hitNew = S.NIGHT_OLD_IDS.filter((id) => NEW9.indexOf(id) >= 0);
  ok(hitNew.length === 0, "⛔ 9 条新剧本一个都没被误列进清理清单（误伤 " + JSON.stringify(hitNew) + "）");
  ok(!!S.NIGHT_AFTER_REMAP && S.NIGHT_AFTER_REMAP.a3 === "" && S.NIGHT_AFTER_REMAP.a4 === "f_oldwall",
    "NIGHT_AFTER_REMAP：a3 → 无前置、a4 → f_oldwall（实得 " + JSON.stringify(S.NIGHT_AFTER_REMAP) + "）");
}

/* ============================================================
 * C. nightPurgeOld：一次性幂等 + ⛔ 三禁不碰
 * ============================================================ */
section("C · nightPurgeOld：清旧进度 / 幂等 / ⛔ 不碰 marks·cgs·mainIds");
{
  ok(!!S, "前置：Spirits 就绪");
  const rec = {
    threads: {
      family: {
        done: { a1: { at: 1 }, a3: { at: 2 }, f_new: { at: 3 }, f_oldwall: { at: 4 } },
        runs: { a3: { log: [{ w: "A", text: "老夜话文案" }] }, r_joy: { log: [] }, f_wake: { log: [] } },
      },
      "room:roomA": { done: { r_thunder: { at: 5 }, r_lost: { at: 6 } }, runs: { r_joy: {} } },
      "duo:it0_it1": { done: { d_clash: { at: 7 } }, runs: {} },
    },
    marks: [{ id: "m1" }, { id: "m2" }],
    cgs: { cg1: { url: "x" } },
    mainIds: ["c1", "c2"],
    night: { actId: "a2", log: [{ w: "A", text: "老序章聊天记录" }], msgs: 9, ended: false },
  };
  const marks0 = JSON.stringify(rec.marks), cgs0 = JSON.stringify(rec.cgs), main0 = JSON.stringify(rec.mainIds);

  S.nightPurgeOld(rec);

  ok(Object.keys(rec.threads.family.done).join(",") === "f_oldwall",
    "family.done 只留下新剧本 f_oldwall（实得 " + JSON.stringify(Object.keys(rec.threads.family.done)) + "）");
  ok(Object.keys(rec.threads.family.runs).join(",") === "f_wake",
    "family.runs 只留下新剧本 f_wake（实得 " + JSON.stringify(Object.keys(rec.threads.family.runs)) + "）");
  ok(Object.keys(rec.threads["room:roomA"].done).join(",") === "r_lost",
    "房间群的 done 清掉老 r_thunder、留新 r_lost（实得 " + JSON.stringify(Object.keys(rec.threads["room:roomA"].done)) + "）");
  ok(Object.keys(rec.threads["room:roomA"].runs).length === 0,
    "房间群的 runs 老记录清空（实得 " + JSON.stringify(Object.keys(rec.threads["room:roomA"].runs)) + "）");
  ok(Object.keys(rec.threads["duo:it0_it1"].done).length === 0,
    "双人组的老 d_clash 清空（实得 " + JSON.stringify(Object.keys(rec.threads["duo:it0_it1"].done)) + "）");
  ok(rec.night === undefined, "⛔ rec.night（v160 老进度容器，含旧文案 log）已删");

  ok(JSON.stringify(rec.marks) === marks0, "⛔ prune 三禁：rec.marks 逐字未动");
  ok(JSON.stringify(rec.cgs) === cgs0, "⛔ prune 三禁：rec.cgs 逐字未动");
  ok(JSON.stringify(rec.mainIds) === main0, "⛔ prune 三禁：rec.mainIds 逐字未动");

  ok(rec.__v180k2 === 1, "打标 __v180k2（一次性）");
  /* 幂等：标记已置 ⇒ 再调一次不再扫（新塞进来的老 id 不会被重复清，证明只跑一次） */
  rec.threads.family.done["a1"] = { at: 9 };
  S.nightPurgeOld(rec);
  ok(!!rec.threads.family.done["a1"], "幂等：第二次调用不再重复扫描（a1 原样保留 ⇒ 只清一遍）");
  ok(JSON.stringify(rec.marks) === marks0 && JSON.stringify(rec.cgs) === cgs0, "⛔ 二次调用仍未碰三禁字段");
}

/* ============================================================
 * D. threadMigrate：先迁移老 rec.night，再 purge
 * ============================================================ */
section("D · threadMigrate：老 rec.night 迁完即清 + 已 __v162 的 rec 也要清");
{
  const r2 = {
    night: { actId: "a2", done: { a1: { at: 1 }, a2: { at: 2 } }, log: [{ w: "A", text: "老序章" }], msgs: 7, node: "c1", ended: false },
  };
  S.threadMigrate(r2);
  ok(!!r2.threads && !!r2.threads.family, "老 rec.night 仍会先迁入 threads.family（不丢壳）");
  ok(Object.keys(r2.threads.family.done).length === 0, "⛔ 迁进来的 a1/a2 随即被 purge（实得 " + JSON.stringify(Object.keys(r2.threads.family.done)) + "）");
  ok(Object.keys(r2.threads.family.runs).length === 0, "⛔ 迁进来的 a2 run 随即被 purge");
  ok(r2.night === undefined, "⛔ rec.night 迁完即删");
  ok(r2.__v162 === 1 && r2.__v180k2 === 1, "两个标记都打上（__v162=" + r2.__v162 + " __v180k2=" + r2.__v180k2 + "）");

  const r3 = { __v162: 1, threads: { family: { done: { d_clash: { at: 1 }, f_wake: { at: 2 } }, runs: { f_spring: {} } } } };
  S.threadMigrate(r3);
  ok(Object.keys(r3.threads.family.done).join(",") === "f_wake",
    "⛔ 已迁移过的老 rec 也会被清（done 只剩 f_wake；实得 " + JSON.stringify(Object.keys(r3.threads.family.done)) + "）");
  ok(Object.keys(r3.threads.family.runs).length === 0, "⛔ 已迁移过的老 rec：runs 里的 f_spring 也清掉");
  ok(r3.__v180k2 === 1, "已 __v162 的 rec 也会补打 __v180k2");

  /* 全家群「相亲相爱一家人」的壳必须还在 */
  const w = mkWorld();
  const ths = S.nightThreads(w.items, w.store, w.ctx, w.groups);
  const fam = ths.filter((t) => t.kind === "family")[0];
  ok(!!fam, "⛔ family 群（相亲相爱一家人）的壳仍在（未随老内容一起删）");
  ok(!!fam && fam.name === "相亲相爱一家人", "family 群名仍是「相亲相爱一家人」（实得 " + (fam && fam.name) + "）");
}

/* ============================================================
 * E. after 重挂：不永久锁死
 * ============================================================ */
section("E · after 重挂：f_oldwall 开局解锁 / f_wake 需先打完 f_oldwall / ⛔ 无锁死");
{
  const w = mkWorld();
  const rec = JSON.parse(JSON.stringify(w.store["it0"]));
  const ths = S.nightThreads(w.items, w.store, w.ctx, w.groups);
  const fam = ths.filter((t) => t.kind === "family")[0];
  ok(!!fam, "前置：拿到 family 群");

  const evs = S.threadEvents(fam, w.ctx, rec).events;
  const famIds = evs.map((e) => e.id);
  ok(famIds.length === 2 && famIds.join(",") === "f_oldwall,f_wake",
    "family 群只剩 2 条讲古（实得 " + famIds.join(",") + "）");
  const e1 = evs.filter((e) => e.id === "f_oldwall")[0] || {};
  const e2 = evs.filter((e) => e.id === "f_wake")[0] || {};
  ok(!!e1.unlocked, "✅ f_oldwall 开局即解锁（老锚点 a3 已下线 ⇒ 视为已满足，⛔ 不永久锁死）");
  ok(!e2.unlocked, "f_wake 初始仍锁（a4 已重挂到 f_oldwall 之后）");

  function playToEnd(evId) {
    let res = S.threadEnter(w.items[0], rec, w.ctx, fam, evId);
    let g = 0;
    while (!res.ended && res.choices && res.choices.length && g++ < 120) res = S.threadChoose(w.items[0], rec, w.ctx, fam, 0);
    return res;
  }
  const r1 = playToEnd("f_oldwall");
  ok(r1.ended, "把 f_oldwall 打到结局");
  const evs2 = S.threadEvents(fam, w.ctx, rec).events;
  ok(!!evs2.filter((e) => e.id === "f_wake")[0].unlocked, "✅ 打完 f_oldwall ⇒ f_wake 解锁（重挂链条成立）");
  const r2 = playToEnd("f_wake");
  ok(r2.ended, "把 f_wake 打到结局");
  ok(!!S.threadEvents(fam, w.ctx, rec).done["f_wake"], "✅ family.done.f_wake 写入");

  /* ⛔ 现役池里每一条事件的 after 都必须「可满足」 */
  const pool = S.nightPoolSync();
  const ids = {};
  pool.forEach((e) => { ids[e.id] = 1; });
  const dead = [];
  pool.forEach((e) => {
    if (!e.after) return;
    let aid = String(e.after);
    if (S.NIGHT_AFTER_REMAP && Object.prototype.hasOwnProperty.call(S.NIGHT_AFTER_REMAP, aid)) aid = S.NIGHT_AFTER_REMAP[aid];
    if (aid && !ids[aid]) dead.push(e.id + "→" + aid);
  });
  ok(dead.length === 0, "⛔ 现役 9 条的 after 全部可满足（死链 " + JSON.stringify(dead) + "）");
}

/* ============================================================
 * F. 负向对照（铆定 b96fc50 改前快照 · ⛔ 不用 HEAD）
 * ============================================================ */
section("F · 负向对照（铆定 docs/_tmp/_pre_v180k2_spirits.js = b96fc50 改前）");
{
  const BASE = path.join(__dirname, "_tmp", "_pre_v180k2_spirits.js");
  if (!fs.existsSync(BASE)) {
    ok(false, "F · 缺基线快照 docs/_tmp/_pre_v180k2_spirits.js（负向对照无法执行）");
  } else {
    /* 同一套标记，跑在「改前的引擎」上 —— 必须全部不成立 */
    const markers = (X) => {
      const m = [];
      const add = (n, p) => m.push({ n: n, p: !!p });
      const pool = (typeof X.nightPoolSync === "function") ? X.nightPoolSync() : [];
      add("NIGHT_EVENTS 已清空", X.NIGHT_EVENTS.length === 0);
      add("现役池 = 9", pool.length === 9);
      add("13 个老 id 不在池", OLD13.every((id) => !X.eventOf(id)));
      add("NIGHT_ACTS 已删", typeof X.NIGHT_ACTS === "undefined");
      add("v160 act 运行时已删", typeof X.nightEnter === "undefined" && typeof X.nightActs === "undefined");
      add("NIGHT_OLD_IDS = 13", Array.isArray(X.NIGHT_OLD_IDS) && X.NIGHT_OLD_IDS.length === 13);
      add("NIGHT_AFTER_REMAP.a4 = f_oldwall", !!X.NIGHT_AFTER_REMAP && X.NIGHT_AFTER_REMAP.a4 === "f_oldwall");
      add("nightPurgeOld 存在", typeof X.nightPurgeOld === "function");
      /* purge 真跑一遍（基线没有该函数 ⇒ 判否，不许抛错） */
      const rec = {
        threads: { family: { done: { a1: { at: 1 }, f_oldwall: { at: 2 } }, runs: { a3: {} } } },
        marks: [{ id: "m1" }], cgs: { c1: 1 }, mainIds: ["c1"],
        night: { actId: "a2", log: [{ w: "A", text: "老序章" }] },
      };
      if (typeof X.nightPurgeOld === "function") X.nightPurgeOld(rec);
      add("purge 清掉老 done", Object.keys(rec.threads.family.done).join(",") === "f_oldwall");
      add("purge 删掉 rec.night", rec.night === undefined);
      /* ⛔ 三禁标记必须**挂在 purge 真的跑了**之上：基线没有 nightPurgeOld
         ⇒ 什么都不动当然「没碰三禁」，那是假阳性；故要求函数存在且三禁未动。 */
      add("purge 不碰三禁", typeof X.nightPurgeOld === "function"
        && JSON.stringify(rec.marks) === '[{"id":"m1"}]'
        && JSON.stringify(rec.cgs) === '{"c1":1}'
        && JSON.stringify(rec.mainIds) === '["c1"]');
      return m;
    };

    let BS = null;
    try { BS = loadBaseline().sandbox.Spirits; } catch (e) { BS = null; }
    ok(!!BS, "基线引擎加载成功（js/night-v180.js + b96fc50 的 spirits.js）");
    if (BS) {
      const old = markers(BS);
      const fails = old.filter((x) => !x.p).map((x) => x.n);
      ok(fails.length === old.length,
        "⛔ 铆定版**全部**标记不成立（批K-2 确为新增）：失败 " + fails.length + "/" + old.length
        + (fails.length !== old.length ? " ｜ 竟然通过的：" + JSON.stringify(old.filter((x) => x.p).map((x) => x.n)) : ""));
      const now = markers(S);
      const nowPass = now.filter((x) => x.p).length;
      ok(nowPass === now.length, "正对照：当前工作区 " + nowPass + "/" + now.length + " 标记全成立"
        + (nowPass !== now.length ? " ｜ 未过：" + JSON.stringify(now.filter((x) => !x.p).map((x) => x.n)) : ""));
      console.log("   铆定 b96fc50：标记失败 " + fails.length + "/" + old.length + "（须全部失败）");
      console.log("   当前工作区：标记成立 " + nowPass + "/" + now.length + "（须全部成立）");
    }
  }
}

summary();
process.exit(0);
