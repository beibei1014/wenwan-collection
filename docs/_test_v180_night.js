/* ============================================================
 * _test_v180_night.js · V180 批I · 夜话**外部事件池** + 「房间专属」分派 + 9 条剧本
 * ------------------------------------------------------------
 *      (1) 数据文件 js/night-v180.js：机械生成物、结构齐全、9 条、CRLF、version
 *      (2) index.html 接线：night-v180.js 排在 spirits.js 之前；spirits.js 版本号已 bump
 *      (3) 引擎骨架（源码）：NIGHT_EVENT_POOL / nightPoolSync / extNightEvents / roomSlotOf
 *          + nightThreads/threadEvents/eventOf 三处读点改读池 + 房间槽闸门 + 已导出
 *      (4) 运行时池：池 = NIGHT_EVENTS(13) + 外部(9)；前段同引用；🔴 push/pop 活数组
 *      (5) 「房间专属」真跑：每屋恰好命中 1 条同槽事件；无 roomSlot 者全屋一致
 *      (6) 9 条剧本内容核验：id 无碰撞 / scope / cast / roomSlot 占满 / duo pers===2 /
 *          每条 3 结局 / 禁词 0 / 真名 0 / 「主人」0 / 变量白名单 / cast:2 不用 w:"C"
 *      (7) 真跑 BFS：9 条 × 全分支 → 3 结局均可达、占位符零残留、无断链
 *      (8) after 冒烟：线程页打 a3 ⇒ f_oldwall 解锁；打 a4 ⇒ f_wake 解锁
 *      (9) ⛔ 老资产未动：NIGHT_EVENTS 本体段 / hashStr / ww_spirits 键名（vs f9cd5e5）
 *          ＋ 5116 物化句已改、旧句 0 残留
 *     (10) 负向对照：同套标记跑在**铆定 f9cd5e5** ⇒ 必须全红（⛔ 不用 HEAD）
 *
 * 用法： node docs/_test_v180_night.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => { try { return fs.readFileSync(p, "utf8").replace(/\r/g, ""); } catch (e) { return ""; } };
const SP = read(path.join(ROOT, "js", "spirits.js"));
const DATA = read(path.join(ROOT, "js", "night-v180.js"));
const HTML = read(path.join(ROOT, "index.html"));

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }
function fnSpan(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return "";
  let i = src.indexOf("{", m.index), d = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") { d--; if (!d) { i++; break; } }
  }
  return src.slice(m.index, i);
}
function span(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) return "";
  const j = src.indexOf(b, i + a.length);
  if (j < 0) return "";
  return src.slice(i, j + b.length);
}

/* 期望的 9 条（顺序与 md 一致） */
const NEW_IDS = ["f_oldwall", "f_wake", "d_nightout", "d_oldcloth", "d_roadside", "r_lost", "r_noreturn", "r_lastbite", "r_spot"];
const CORE10 = ["顾时笙", "苏栖盏", "萧景筹", "陆临崖", "楚柿遥", "江冽茗", "温茸之", "沈青舒", "姜饴酌", "谢凝渲"];
const OBJ_WORDS = ["珠子", "柜子", "把玩", "盘玩", "包浆", "越盘越值钱", "摆件", "物件", "收纳", "搁在一边", "装睡", "主人", "您", "它"];
const PH = /\{[^{}]+\}/g;
const ALLOWED_PH = new Set(["A", "B", "C", "A_pers", "B_pers", "C_pers", "A_title", "B_title", "C_title",
  "A_line", "B_line", "C_line", "A_trait", "B_trait", "C_trait", "A_bead", "B_bead", "C_bead",
  "star", "star_title", "star_line", "star_trait", "star_bead", "members", "total", "call",
  "days", "plays", "bond", "bondlv", "tixing", "grp", "LIST"]);

console.log("V180-I2 夜话外部池 + 房间专属 + 9 条剧本　引擎：" + path.join(ROOT, "js", "spirits.js"));

/* ============================================================
 * (1) 数据文件
 * ============================================================ */
section("1 · 数据文件 js/night-v180.js（机械生成物 / 9 条 / CRLF）");
let V = null;
{
  ok(DATA.length > 0, "js/night-v180.js 存在且非空（实长 " + DATA.length + "）");
  const raw = (() => { try { return fs.readFileSync(path.join(ROOT, "js", "night-v180.js"), "latin1"); } catch (e) { return ""; } })();
  const crlf = (raw.match(/\r\n/g) || []).length, lf = (raw.match(/\n/g) || []).length;
  ok(crlf > 0, "行尾 CRLF（实得 " + crlf + " 个 \\r\\n）");
  ok(lf - crlf === 0, "⛔ 无裸 LF（实得 " + (lf - crlf) + "）");
  ok(/机械生成物/.test(DATA) && /_extract_night_v180\.js/.test(DATA), "声明为机械生成物（注明抽取器，⛔ 不许手改）");
  ok(/围栏规则/.test(DATA), "注释写明了抽取规则（围栏规则）");
  /* 抽取器自身：围栏成对断言（防编剧说明文里的字面三反引号造出「孤儿围栏」吞掉后文） */
  const EXTRACT = read(path.join(ROOT, "docs", "_extract_night_v180.js"));
  ok(/fenceLines\.length % 2 !== 0/.test(EXTRACT), "抽取器有「围栏必须成对」断言（奇数即报错退出）");
  ok(/命中数 .* ≠ .* 抽取规则失配|命中数 \" \+ evBlocks\.length/.test(EXTRACT) || /evBlocks\.length !== WANT/.test(EXTRACT), "抽取器命中数 ≠ 9 即报错退出");

  const H = require("./_harness.js");
  const hc = H.makeContext();
  H.loadFile(hc.ctx, "js/night-v180.js");
  V = hc.sandbox.NIGHT_V180;
  ok(!!V, "沙箱里拿到 window.NIGHT_V180");
  if (V) {
    ok(/^v180-i/.test(String(V.version)), "version = v180-i*（实得 " + V.version + "）");
    ok(typeof V.updated === "string" && V.updated.length > 0, "updated 有值（实得 " + V.updated + "）");
    ok(Array.isArray(V.events), "events 是数组");
    ok(V.events.length === 9, "⛔ 恰好 9 条剧本（实得 " + V.events.length + "）");
  }
}

/* ============================================================
 * (2) index.html 接线
 * ============================================================ */
section("2 · index.html 接线（顺序 + 版本号）");
{
  ok(/js\/night-v180\.js\?v=\d+/.test(HTML), "index.html 挂了 js/night-v180.js（带 ?v=）");
  const iData = HTML.indexOf("js/night-v180.js"), iSp = HTML.indexOf("js/spirits.js");
  ok(iData >= 0 && iSp >= 0 && iData < iSp, "⛔ night-v180.js 排在 spirits.js **之前**（先挂数据，引擎加载时并池）");
  ok(/js\/spirits\.js\?v=20270130/.test(HTML), "spirits.js 版本号 20270130（实得 " + (HTML.match(/js\/spirits\.js\?v=\d+/) || [""])[0] + "）");
  ok(HTML.indexOf("js/book-jieqi.js") < iSp, "⛔ 批G 的 book-jieqi.js 顺序未破坏（仍在 spirits.js 前）");
}

/* ============================================================
 * (3) 引擎骨架：源码断言
 * ============================================================ */
section("3 · 引擎骨架（池 / 槽 / 三处读点 / 导出 / ⛔ 不碰 hashStr）");
{
  ok(/const NIGHT_EVENT_POOL = \[\];/.test(SP), "定义 NIGHT_EVENT_POOL（只读合并池）");
  ok(/\bfunction nightPoolSync\(/.test(SP), "定义 nightPoolSync()");
  ok(/\bfunction extNightEvents\(/.test(SP), "定义 extNightEvents()（读 window.NIGHT_V180.events）");
  ok(/\bfunction roomSlotOf\(/.test(SP), "定义 roomSlotOf(tid)");
  const thSpan = fnSpan(SP, "nightThreads");
  ok(thSpan.length > 0 && /nightPoolSync\(\)/.test(thSpan), "nightThreads() 读合并池");
  const teSpan = fnSpan(SP, "threadEvents");
  ok(teSpan.length > 0 && /const pool = nightPoolSync\(\);/.test(teSpan), "threadEvents() 读合并池");
  ok(/for \(let i = 0; i < pool\.length; i\+\+\)/.test(teSpan), "threadEvents() 循环走 pool.length");
  ok(!/NIGHT_EVENTS\.length/.test(teSpan), "⛔ threadEvents() 不再直读 NIGHT_EVENTS.length");
  const evSpan = fnSpan(SP, "eventOf");
  ok(evSpan.length > 0 && /nightPoolSync\(\)/.test(evSpan), "eventOf() 读合并池（= 对话页读点，app.js 走 Spirits.eventOf）");
  ok(/thread\.kind === "room" && ev\.roomSlot != null && ev\.roomSlot !== roomSlotOf\(thread\.id\)/.test(teSpan),
    "threadEvents() 有「房间专属」闸门（room.kind && roomSlot != null && 不同槽 ⇒ continue）");
  ok(/NIGHT_EVENT_POOL,\s*nightPoolSync,\s*roomSlotOf,/.test(SP), "已导出 NIGHT_EVENT_POOL / nightPoolSync / roomSlotOf");
  ok(/NIGHT_EVENTS,\s*THREAD_FAMILY,\s*THREAD_CAP,\s*OCC_BANDS,\s*eventOf,\s*occasionOf,/.test(SP), "⛔ NIGHT_EVENTS / eventOf 等老导出仍在（未改名）");
  const rsSpan = fnSpan(SP, "roomSlotOf");
  ok(rsSpan.length > 0 && !/hashStr/.test(rsSpan), "⛔ roomSlotOf() 内不引用 hashStr（外观/性别圣域不受影响）");
  ok(/>>> 0/.test(rsSpan) && /% 4/.test(rsSpan), "roomSlotOf 用无符号散列 >>> 0 且取模 4（[0,3] 确定性）");
  ok(/const NIGHT_EVENTS = \[/.test(SP), "⛔ NIGHT_EVENTS 本体定义仍在");
  ok(!/for \(let i = 0; i < NIGHT_EVENTS\.length; i\+\+\)/.test(SP), "池化后源码里已无「直读 NIGHT_EVENTS.length 的循环」");
  /* v180-I2：after 来源注释（team-lead ② 要求写进代码） */
  ok(/a1–a4 本身就是 NIGHT_EVENTS 的条目/.test(SP) && /⛔ 不是跨池/.test(SP), "代码注释写明了 a1–a4 属同池、after 非跨池（team-lead ② ）");
}

/* ============================================================
 * (4) 运行时池 = NIGHT_EVENTS + 外部；push/pop 活数组
 * ============================================================ */
section("4 · 运行时池（13 + 9）· 前段同引用 · 🔴 push/pop 活数组");
let S = null, hc = null, ths = null, fam = null, roomThs = [], ctx = null, items = [], store = {};
{
  const H = require("./_harness.js");
  try {
    hc = H.makeContext();
    H.loadFile(hc.ctx, "js/night-v180.js");
    H.loadFile(hc.ctx, "js/spirits.js");
    S = hc.sandbox.Spirits;
  } catch (e) { ok(false, "沙箱加载 night-v180.js + spirits.js（" + e.message + "）"); }
  ok(!!S, "沙箱里拿到 Spirits");
  if (S) {
    ok(S.NIGHT_EVENTS.length === 13, "NIGHT_EVENTS 本体仍是 13 条（实得 " + S.NIGHT_EVENTS.length + "）");
    const pool = S.nightPoolSync();
    ok(pool.length === 22, "池 = 13 + 9 = 22（实得 " + pool.length + "）");
    let headSame = true;
    for (let i = 0; i < S.NIGHT_EVENTS.length; i++) if (pool[i] !== S.NIGHT_EVENTS[i]) { headSame = false; break; }
    ok(headSame, "⛔ 池前 13 个与 NIGHT_EVENTS **同引用**（老行为逐字不变）");
    const ext = hc.sandbox.NIGHT_V180.events;
    let tailSame = true;
    for (let i = 0; i < ext.length; i++) if (pool[S.NIGHT_EVENTS.length + i] !== ext[i]) { tailSame = false; break; }
    ok(tailSame, "池后 9 个 === window.NIGHT_V180.events 元素（外部剧本原样并入）");
    ok(pool.length === S.NIGHT_EVENT_POOL.length, "载入即预热（nightPoolSync 与 NIGHT_EVENT_POOL 同步）");

    /* 造世界：24 只，性格覆盖 3 条 duo 所需 6 种 */
    const PERS = ["wild", "calm", "sentimental", "pampered", "scholar", "heroic"];
    const ROOMS = ["roomA", "roomB", "roomC", "roomD", "roomE", "roomF", "roomG", "roomH"];
    for (let i = 0; i < 24; i++) {
      const id = "it" + i;
      items.push({ id: id, name: "串" + i, roomId: ROOMS[Math.floor(i / 3)], playCount: (i * 7) % 40, createdAt: Date.now() - (i + 1) * 86400000 * 5, color: "red", species: "金刚菩提", category: "菩提" });
      store[id] = {
        stage: 1 + (i % 4), bornAt: Date.now() - (i + 1) * 86400000 * 3, bond: (i * 13) % 140,
        look: { pers: PERS[i % 6] }, persona: { name: "小" + i, title: "守珠人", line: "x", traits: ["安静"] },
        chapters: {}, threads: {},
      };
    }
    ctx = { dayNo: 400, idleDays: 12, plays: 30 };
    const groups = ROOMS.map((r, gi) => ({ id: r, name: "小屋 " + r, items: items.slice(gi * 3, gi * 3 + 3) }));
    ths = S.nightThreads(items, store, ctx, groups);
    fam = ths.filter((t) => t.kind === "family")[0];
    roomThs = ths.filter((t) => t.kind === "room");
    ok(!!fam && roomThs.length === 8, "拿到全家群落 + 8 个房间群落（实得 room " + roomThs.length + "）");

    /* 🔴 老测试 push/pop 兼容 */
    const before = S.threadEvents(fam, ctx, store["it0"]).events.map((e) => e.id).join(",");
    const tmp = { id: "x_fam_tmp", icon: "🌙", title: "临时", scope: "family", when: {}, nodes: { start: { lines: [{ w: "A", t: "hi" }] }, e: { ending: { key: "k", name: "n", text: "t" } } } };
    S.NIGHT_EVENTS.push(tmp);
    ok(S.threadEvents(fam, ctx, store["it0"]).events.some((e) => e.id === "x_fam_tmp"), "🔴 push 进 NIGHT_EVENTS 的临时事件被池**实时**看见（活数组）");
    ok(S.nightPoolSync().length === 23, "push 后池长度跟随（13+1+9=23，实得 " + S.nightPoolSync().length + "）");
    S.NIGHT_EVENTS.pop();
    ok(!S.threadEvents(fam, ctx, store["it0"]).events.some((e) => e.id === "x_fam_tmp"), "pop 后池同步回退（不残留）");
    ok(S.threadEvents(fam, ctx, store["it0"]).events.map((e) => e.id).join(",") === before, "push/pop 一轮后事件列表逐字回到原样");
  }
}

/* ============================================================
 * (5) 「房间专属」真跑
 * ============================================================ */
section("5 · 「房间专属」真跑：每屋恰好 1 条同槽事件 · 无槽全屋一致");
{
  if (!S) { ok(false, "沙箱未就绪，跳过（前置失败）"); }
  else {
    const ext = hc.sandbox.NIGHT_V180.events;
    const SLOTEV = ext.filter((e) => e.scope === "room" && e.roomSlot != null);
    const SHAREDEV = ext.filter((e) => e.scope === "room" && e.roomSlot == null);
    ok(SLOTEV.length === 4, "外部 room 专属事件 = 4 条（实得 " + SLOTEV.length + "）");
    ok(SHAREDEV.length === 0, "外部 room 共享事件 = 0 条（本批 4 条全部带槽；老 3 条在 NIGHT_EVENTS 里）");
    const slotOf = {};
    SLOTEV.forEach((e) => { slotOf[e.id] = e.roomSlot; });
    const bySlot = {};
    SLOTEV.forEach((e) => { bySlot[e.roomSlot] = e.id; });
    ok(Object.keys(bySlot).length === 4, "4 条各占不同槽（实得 " + JSON.stringify(Object.keys(bySlot).sort()) + "）");

    let hit1 = 0, bad = 0;
    roomThs.forEach((t) => {
      const vis = S.threadEvents(t, ctx, store["it0"]).events.filter((e) => slotOf[e.id] != null).map((e) => e.id);
      const slot = S.roomSlotOf(t.id);
      const want = bySlot[slot];
      const good = vis.length === 1 && vis[0] === want;
      if (good) hit1++; else bad++;
      ok(good, "房间 " + t.id + "（槽 " + slot + "）恰好命中 1 条 = " + want + "（实得 " + JSON.stringify(vis) + "）");
    });
    ok(hit1 === 8 && bad === 0, "⛔ 8 间屋每间恰好 1 条同槽专属事件（实得 " + hit1 + "/8）");

    /* 无 roomSlot 的房事件（老 r_thunder/r_joy/r_sad）⇒ 全屋一致（要么全看得到、要么全看不到） */
    const sharedIds = S.NIGHT_EVENTS.filter((e) => e.scope === "room" && e.roomSlot == null).map((e) => e.id);
    ok(sharedIds.length === 3, "老库 3 条 room 事件无 roomSlot（实得 " + sharedIds.length + "）");
    sharedIds.forEach((sid) => {
      const arr = roomThs.map((t) => S.threadEvents(t, ctx, store["it0"]).events.some((e) => e.id === sid));
      ok(arr.every((x) => x === arr[0]), "⛔ 无槽房事件「" + sid + "」8 间屋一致（" + (arr[0] ? "都看得到" : "都看不到") + "）");
    });

    /* 家族群落不含任何 room 事件 */
    const famIds = S.threadEvents(fam, ctx, store["it0"]).events.map((e) => e.id);
    ok(SLOTEV.every((e) => famIds.indexOf(e.id) < 0), "⛔ 全家群落不含 room 专属事件");
  }
}

/* ============================================================
 * (6) 9 条剧本内容核验
 * ============================================================ */
section("6 · 9 条剧本内容核验（id / scope / cast / roomSlot / duo pers / 结局 / 禁词 / 真名 / 变量）");
{
  if (!V) { ok(false, "数据未就绪，跳过（前置失败）"); }
  else {
    const evs = V.events;
    ok(evs.map((e) => e.id).join(",") === NEW_IDS.join(","), "9 条 id 与预期一致且有序（实得 " + evs.map((e) => e.id).join(",") + "）");

    /* id 与老库全体无碰撞 */
    const oldIds = (S ? S.NIGHT_EVENTS.map((e) => e.id) : []).concat(S ? S.NIGHT_ACTS.map((a) => a.id) : []);
    const collide = NEW_IDS.filter((x) => oldIds.indexOf(x) >= 0);
    ok(collide.length === 0, "⛔ 9 个新 id 与老库全体（13 事件 + 4 幕）零碰撞（碰撞 " + JSON.stringify(collide) + "）");

    const byScope = { family: [], room: [], duo: [] };
    evs.forEach((e) => { (byScope[e.scope] = byScope[e.scope] || []).push(e.id); });
    ok(byScope.family.length === 2 && byScope.duo.length === 3 && byScope.room.length === 4,
      "scope 分布 2 family / 3 duo / 4 room（实得 " + JSON.stringify(Object.keys(byScope).map((k) => k + ":" + byScope[k].length)) + "）");

    const slots = evs.filter((e) => e.roomSlot != null).map((e) => e.roomSlot).sort();
    ok(JSON.stringify(slots) === "[0,1,2,3]", "roomSlot 占满 0/1/2/3 且不重复（实得 " + JSON.stringify(slots) + "）");
    ok(evs.filter((e) => e.scope !== "room" && e.roomSlot != null).length === 0, "⛔ roomSlot 只出现在 scope:\"room\" 上");

    evs.forEach((e) => {
      const nn = Object.keys(e.nodes || {});
      const ends = nn.filter((k) => e.nodes[k] && e.nodes[k].ending).map((k) => e.nodes[k].ending.key).sort();
      ok(nn.length === 8, e.id + " 8 个节点（实得 " + nn.length + "）");
      ok(ends.length === 3 && JSON.stringify(ends) === '["cool","fun","warm"]', e.id + " 3 个结局 warm/cool/fun（实得 " + JSON.stringify(ends) + "）");
      if (e.scope === "duo") {
        ok(e.cast === 2, e.id + " duo cast = 2（实得 " + e.cast + "）");
        ok(e.when && Array.isArray(e.when.pers) && e.when.pers.length === 2, "⛔ " + e.id + " when.pers 恰好 2 个（否则 duoPick 不生成双人群；实得 " + JSON.stringify(((e.when || {}).pers) || null) + "）");
      }
      /* cast:2 的事件不许用 w:"C" */
      if (e.cast === 2) {
        const ws = new Set();
        Object.keys(e.nodes).forEach((k) => (e.nodes[k].lines || []).forEach((l) => ws.add(String(l.w))));
        ok(!ws.has("C"), "⛔ cast:2 事件 " + e.id + " 未用 w:\"C\"（实得 " + JSON.stringify(Array.from(ws)) + "）");
      }
    });

    /* after：两条讲古承接序章 a3/a4（同池） */
    const fOld = evs.filter((e) => e.id === "f_oldwall")[0];
    const fWake = evs.filter((e) => e.id === "f_wake")[0];
    ok(fOld && fOld.after === "a3", "f_oldwall.after = \"a3\"（实得 " + (fOld && fOld.after) + "）");
    ok(fWake && fWake.after === "a4", "f_wake.after = \"a4\"（实得 " + (fWake && fWake.after) + "）");
    const poolIds = S ? S.nightPoolSync().map((e) => e.id) : [];
    ok(poolIds.indexOf("a3") >= 0 && poolIds.indexOf("a4") >= 0, "⛔ after 目标 a3/a4 在**同一个池**里（a1–a4 即 NIGHT_EVENTS 的 legacy 条目）");

    /* 禁词 / 真名 / 主人 / 变量白名单 —— 扫全部文案（t / ending / title / sub / choices） */
    let bannedHit = [];
    let phSet = new Set();
    let realNameHit = [];
    evs.forEach((e) => {
      const texts = [];
      const push = (s) => { if (s != null) texts.push(String(s)); };
      push(e.title); push(e.sub);
      Object.keys(e.nodes).forEach((k) => {
        const nd = e.nodes[k];
        (nd.lines || []).forEach((l) => push(l.t));
        (nd.choices || []).forEach((c) => push(c.t));
        if (nd.ending) { push(nd.ending.name); push(nd.ending.text); }
      });
      const all = texts.join("\n");
      (all.match(PH) || []).forEach((p) => phSet.add(p.slice(1, -1)));
      OBJ_WORDS.forEach((w) => { if (all.indexOf(w) >= 0) bannedHit.push(e.id + ":" + w); });
      CORE10.forEach((n) => { if (all.indexOf(n) >= 0) realNameHit.push(e.id + ":" + n); });
    });
    ok(bannedHit.length === 0, "⛔ 9 条内物化词/「装睡」/「主人」/「您」/「它」= 0（实得 " + JSON.stringify(bannedHit) + "）");
    ok(realNameHit.length === 0, "⛔ 9 条内核心十位真名 = 0（实得 " + JSON.stringify(realNameHit) + "）");
    const badPh = Array.from(phSet).filter((p) => !ALLOWED_PH.has(p));
    ok(badPh.length === 0, "⛔ 占位符全在白名单内（越界 " + JSON.stringify(badPh) + "；实得 " + JSON.stringify(Array.from(phSet).sort()) + "）");
  }
}

/* ============================================================
 * (7) 真跑 BFS：9 条 × 全分支 → 3 结局可达 / 占位符零残留 / 无断链
 * ============================================================ */
section("7 · 真跑 BFS（9 条全分支）");
{
  if (!S || !fam) { ok(false, "沙箱未就绪，跳过（前置失败）"); }
  else {
    const duoThs = ths.filter((t) => t.kind === "duo");
    let totalPaths = 0;
    NEW_IDS.forEach((evId) => {
      const ev = S.eventOf(evId);
      const th = ev.scope === "room" ? (roomThs[0] || fam) : (ev.scope === "duo" ? (duoThs[0] || fam) : fam);
      const ends = {};
      const queue = [[]];
      let guard = 0, paths = 0;
      while (queue.length && guard++ < 500) {
        const picks = queue.shift();
        const rec = JSON.parse(JSON.stringify(store["it0"]));
        let res = S.threadReplay(items[0], rec, ctx, th, evId);
        for (let k = 0; k < picks.length; k++) res = S.threadChoose(items[0], rec, ctx, th, picks[k]);
        if (!res.ended && res.choices && res.choices.length) {
          if (picks.length > 40) { ok(false, evId + " 分支深度 > 40（疑似环）"); break; }
          for (let c = 0; c < res.choices.length; c++) queue.push(picks.concat([c]));
          continue;
        }
        paths++;
        const all = (res.log || []).map((m) => m.text || "").join("\n");
        const resid = all.match(PH);
        ok(!resid, evId + " 路径[" + picks.join(",") + "] 占位符零残留" + (resid ? " → " + JSON.stringify(resid.slice(0, 3)) : ""));
        ok(!!res.ended, evId + " 路径[" + picks.join(",") + "] 走到结尾（无断链）");
        if (res.ending) ends[res.ending.key] = 1;
      }
      totalPaths += paths;
      ok(Object.keys(ends).length === 3, evId + " 3 个结局均可达（实得 " + JSON.stringify(Object.keys(ends).sort()) + "）");
    });
    console.log("   9 条事件共跑 " + totalPaths + " 条完整路径（含分支）");
    ok(totalPaths >= 9, "共跑路径数 ≥ 9（实得 " + totalPaths + "）");
  }
}

/* ============================================================
 * (8) after 冒烟：a3 ⇒ f_oldwall / a4 ⇒ f_wake（team-lead ② 选 A）
 * ============================================================ */
section("8 · after 冒烟：线程页打 a3/a4 ⇒ 两条讲古解锁（同池同 done 表）");
{
  if (!S || !fam) { ok(false, "沙箱未就绪，跳过（前置失败）"); }
  else {
    const rec = JSON.parse(JSON.stringify(store["it0"]));
    const myItems = items;
    let te = S.threadEvents(fam, ctx, rec);
    ok(!!te.done["a3"] === false, "初始 family.done.a3 未完成");
    ok(te.events.filter((e) => e.id === "f_oldwall")[0].unlocked === "" || !te.events.filter((e) => e.id === "f_oldwall")[0].unlocked, "f_oldwall 初始锁（after 未满足）");
    function playToEnd(evId) {
      let res = S.threadEnter(myItems[0], rec, ctx, fam, evId);
      let g = 0;
      while (!res.ended && res.choices && res.choices.length && g++ < 120) res = S.threadChoose(myItems[0], rec, ctx, fam, 0);
      return res;
    }
    const r3 = playToEnd("a3");
    ok(r3.ended, "线程页把 a3 打到结局");
    te = S.threadEvents(fam, ctx, rec);
    ok(!!te.done["a3"], "✅ family.done.a3 = true（写进会话级 done 表）");
    ok(!!te.events.filter((e) => e.id === "f_oldwall")[0].unlocked, "✅ 挂 after:\"a3\" 的 f_oldwall 解锁（同池同表，无需引擎兜底）");
    const r4 = playToEnd("a4");
    ok(r4.ended, "线程页把 a4 打到结局");
    te = S.threadEvents(fam, ctx, rec);
    ok(!!te.events.filter((e) => e.id === "f_wake")[0].unlocked, "✅ 挂 after:\"a4\" 的 f_wake 解锁");
  }
}

/* ============================================================
 * (9) ⛔ 老资产未动（vs f9cd5e5）＋ 5116 已改
 * ============================================================ */
section("9 · ⛔ 老资产未动 ＋ 5116 物化句已改");
let BASE_SP = "";
{
  const cp = require("child_process");
  try { BASE_SP = cp.execSync("git show f9cd5e5:js/spirits.js", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).replace(/\r/g, ""); }
  catch (e) { try { BASE_SP = fs.readFileSync(path.join(__dirname, "_tmp", "_pre_v180i_baseline_spirits.js"), "utf8").replace(/\r/g, ""); } catch (e2) { BASE_SP = ""; } }

  /* 5116：定稿必须在新代码里，旧句必须 0 残留（引擎 + 数据） */
  ok(SP.indexOf("这世上，还有多少同我们一样的人，还没醒，是不是也在等一个人。") >= 0, "✅ 5116 定稿句已在 js/spirits.js");
  ok(SP.indexOf("你柜子里那些还没开沁的珠子，是不是也在等") < 0, "⛔ 5116 旧句（柜子里…珠子）0 残留");
  ok(DATA.indexOf("你柜子里那些还没开沁的珠子，是不是也在等") < 0, "⛔ 数据文件中旧句 0 残留");

  if (!BASE_SP) ok(true, "9 · (取不到 f9cd5e5 基线 → 老资产比对优雅跳过)");
  else {
    const curNE = span(SP, "const NIGHT_EVENTS = [", "\n  ];");
    const baseNE = span(BASE_SP, "const NIGHT_EVENTS = [", "\n  ];");
    ok(curNE.length > 0 && curNE === baseNE, "⛔ NIGHT_EVENTS **本体段**与 f9cd5e5 逐字一致（5116 在 NIGHT_ACTS 区，未动 NIGHT_EVENTS 字面）");
    ok(fnSpan(SP, "hashStr").length > 0 && fnSpan(SP, "hashStr") === fnSpan(BASE_SP, "hashStr"), "⛔ hashStr 逐字一致");
    ["\"ww_spirits\"", "\"spirit_store\""].forEach((lit) => {
      ok((SP.split(lit).length - 1) === (BASE_SP.split(lit).length - 1), "⛔ 键名 " + lit + " 出现次数不变");
    });
    /* NIGHT_ACTS 结构未动：仅 5116 那一行文案变（旧→新），其余逐字一致 */
    const ca = span(SP, "const NIGHT_ACTS = [", "\n  ];").split("\n");
    const ba = span(BASE_SP, "const NIGHT_ACTS = [", "\n  ];").split("\n");
    ok(ca.length > 0 && ca.length === ba.length, "NIGHT_ACTS 段行数与基线一致（只改文案，未增删行；实得 " + ca.length + "/" + ba.length + "）");
    const diffIdx = [];
    for (let i = 0; i < ba.length; i++) if (ca[i] !== ba[i]) diffIdx.push(i);
    ok(diffIdx.length === 1, "NIGHT_ACTS 与 f9cd5e5 **仅 1 行**不同（实得 " + diffIdx.length + "）");
    if (diffIdx.length === 1) {
      const ii = diffIdx[0];
      ok(/你柜子里那些还没开沁的珠子/.test(ba[ii]) && /这世上，还有多少同我们一样的人/.test(ca[ii]),
        "该差异行正是 5116 物化句（旧「珠子…柜子里」→ 新「同我们一样的人」，其余 NIGHT_ACTS 逐字未动）");
    }
  }
}

/* ============================================================
 * (10) 负向对照（铆定 f9cd5e5）
 * ============================================================ */
section("10 · 负向对照（铆定 f9cd5e5 · ⛔ 不用 HEAD）");
{
  const markers = function (sp, data, html) {
    const m = [];
    const add = (n, p) => m.push({ n: n, p: p });
    const thS = fnSpan(sp, "threadEvents"), evS = fnSpan(sp, "eventOf"), rsS = fnSpan(sp, "roomSlotOf");
    add("池 NIGHT_EVENT_POOL", /const NIGHT_EVENT_POOL = \[\];/.test(sp));
    add("nightPoolSync", /\bfunction nightPoolSync\(/.test(sp));
    add("extNightEvents", /\bfunction extNightEvents\(/.test(sp));
    add("roomSlotOf", /\bfunction roomSlotOf\(/.test(sp));
    add("nightThreads 读池", /nightPoolSync\(\)/.test(fnSpan(sp, "nightThreads")));
    add("threadEvents 读池", /const pool = nightPoolSync\(\);/.test(thS));
    add("eventOf 读池", /nightPoolSync\(\)/.test(evS));
    add("房间槽闸门", /thread\.kind === "room" && ev\.roomSlot != null && ev\.roomSlot !== roomSlotOf\(thread\.id\)/.test(thS));
    add("roomSlotOf 不碰 hashStr", />>> 0/.test(rsS) && !/hashStr/.test(rsS));
    add("导出池/槽", /NIGHT_EVENT_POOL,\s*nightPoolSync,\s*roomSlotOf,/.test(sp));
    add("after 来源注释", /a1–a4 本身就是 NIGHT_EVENTS 的条目/.test(sp));
    add("5116 定稿句", sp.indexOf("这世上，还有多少同我们一样的人，还没醒") >= 0);
    add("index 挂数据文件", /js\/night-v180\.js\?v=\d+/.test(html) && html.indexOf("js/night-v180.js") < html.indexOf("js/spirits.js"));
    add("数据文件 9 条", /NIGHT_V180\s*=/.test(data) && (data.match(/id:\s*"n?_?[a-z0-9_]+"/g) || []).length >= 9 && /nodes:\s*\{/.test(data));
    return m;
  };
  const cp = require("child_process");
  const gitShow = (rel, tmpRel) => {
    try { return cp.execSync("git show f9cd5e5:" + rel, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).replace(/\r/g, ""); }
    catch (e) { try { return fs.readFileSync(path.join(__dirname, tmpRel), "utf8").replace(/\r/g, ""); } catch (e2) { return null; } }
  };
  const baseSP = gitShow("js/spirits.js", "_tmp/_pre_v180i_baseline_spirits.js");
  const baseHTML = gitShow("index.html", "_tmp/_pre_v180i_baseline_index.html");
  const baseDATA = gitShow("js/night-v180.js", "_tmp/_pre_v180i_baseline_night.js") || "";
  if (!baseSP || !baseHTML) {
    ok(true, "10 · (取不到 f9cd5e5 基线 → 负向对照优雅跳过)");
  } else {
    const old = markers(baseSP, baseDATA, baseHTML);
    const fails = old.filter((x) => !x.p).map((x) => x.n);
    ok(fails.length >= 1, "10 · 铆定版至少 1 条不成立 → 负向对照成立（实测失败 " + fails.length + "/" + old.length + "）");
    ok(fails.length === old.length, "10 · 铆定版 **全部**标记不成立（批I 确为新增）：失败 " + fails.length + "/" + old.length);
    const now = markers(SP, DATA, HTML);
    const nowPass = now.filter((x) => x.p).length;
    ok(nowPass === now.length, "10 · 正对照：当前 HEAD 三源 " + nowPass + "/" + now.length + " 标记全成立");
    console.log("   铆定 f9cd5e5：标记失败 " + fails.length + "/" + old.length + "（须全部失败）");
    console.log("   当前 HEAD：标记成立 " + nowPass + "/" + now.length + "（须全部成立）");
  }
}

console.log("\n------------------------------------------------------------");
console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((m) => console.log("  - " + m)); }
console.log(FAIL > 0 ? "⇒ 红测：V180-I2 未落地" : "⇒ 全绿：V180-I2 夜话外部池 + 房间专属 + 9 条剧本已就位");
process.exit(FAIL > 0 ? 1 : 0);
