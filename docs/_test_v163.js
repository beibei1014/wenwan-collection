/* v163 回归自测（任务 A~E 共用）
   1) 夜话 13 个事件：穷举全部分支路径 → 全通到结尾 / 无断链 / 占位符零残留
   2) 主线 v161 8 章：同上
   3) 新增字段：bond / stage / anyOf / not / 胎性Of / whenNeed 同步
   4) 命名：全 APP 无「精灵」残留（灵耳除外）
   用法： node docs/_test_v163.js [--verbose]
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");
const ROOT = path.join(__dirname, "..");
const VERBOSE = process.argv.includes("--verbose");

const PH = /\{[^{}]+\}/g;   // 未展开占位符

function mkItems(n) {
  const items = [], store = {};
  const persList = ["gentle", "lively", "cool", "calm", "mystery", "cheeky"];
  for (let i = 0; i < n; i++) {
    const id = "it" + i;
    items.push({
      id: id, name: "串" + i, roomId: i < 6 ? "roomA" : (i < 9 ? "roomB" : ""),
      playCount: (i * 7) % 40, createdAt: Date.now() - (i + 1) * 86400000 * 5,
      color: "red", species: "金刚菩提", category: "菩提",
    });
    store[id] = {
      stage: 1 + (i % 4), bornAt: Date.now() - (i + 1) * 86400000 * 3,
      bond: (i * 23) % 300, gender: i % 3 === 0 ? "girl" : "boy",
      look: { pers: persList[i % 6] },
      persona: { name: "小" + i, title: "守珠人", line: "我在柜子里等你", traits: ["安静", "爱干净"] },
      chapters: {}, threads: {},
    };
  }
  return { items, store };
}

const h = makeContext();
loadFile(h.ctx, "js/spirits.js");
const S = h.sandbox.Spirits;
const ctx = { dayNo: 400, idleDays: 12, plays: 30 };

/* ---------------- 1. 夜话事件：穷举分支 ---------------- */
section("1. 夜话事件（NIGHT_EVENTS）穷举分支路径");
{
  const { items, store } = mkItems(12);
  const groups = [{ id: "roomA", name: "小屋 A", items: items.slice(0, 6) }, { id: "roomB", name: "小屋 B", items: items.slice(6, 9) }];
  const threads = S.nightThreads(items, store, ctx, groups);
  ok(threads.length > 0, "nightThreads 生成了 " + threads.length + " 个会话");

  const evIds = S.NIGHT_EVENTS.map((e) => e.id);
  let totalPaths = 0, totalRuns = 0;
  evIds.forEach((evId) => {
    const ev = S.eventOf(evId);
    const scope = ev.scope || "family";
    const th = threads.filter((t) => t.kind === scope)[0] || threads[0];
    // BFS 穷举所有 choice 组合
    const queue = [[]];
    const seenEndings = {};
    let guard = 0;
    while (queue.length && guard++ < 400) {
      const picks = queue.shift();
      const rec = JSON.parse(JSON.stringify(store));  // 每个路径独立状态
      const run0 = S.threadReplay(items[0], rec[items[0].id], ctx, th, evId);
      let res = run0;
      for (let k = 0; k < picks.length; k++) {
        res = S.threadChoose(items[0], rec[items[0].id], ctx, th, picks[k]);
      }
      // 遇到选择点：派生所有分支
      if (!res.ended && res.choices && res.choices.length) {
        if (picks.length > 40) { ok(false, evId + " 分支深度超过 40，疑似环"); break; }
        for (let c = 0; c < res.choices.length; c++) queue.push(picks.concat([c]));
        continue;
      }
      totalPaths++;
      const all = (res.log || []).map((m) => m.text || "").join("\n");
      const resid = all.match(PH);
      ok(!resid, evId + " 路径[" + picks.join(",") + "] 占位符零残留" + (resid ? " → 残留 " + JSON.stringify(resid.slice(0, 4)) : ""));
      ok(!!res.ended, evId + " 路径[" + picks.join(",") + "] 走到结尾（无断链）");
      ok(!!(res.ending && res.ending.key), evId + " 路径[" + picks.join(",") + "] 有结局 key");
      if (res.ending) seenEndings[res.ending.key] = (seenEndings[res.ending.key] || 0) + 1;
      totalRuns++;
    }
    if (VERBOSE) console.log("   " + evId + " 路径 " + totalPaths + " 结局 " + JSON.stringify(seenEndings));
  });
  console.log("   夜话：共跑 " + totalPaths + " 条完整路径");
}

/* ---------------- 2. 主线 v161 8 章 ---------------- */
section("2. 主线 v161（CHAP_ACTS）穷举分支路径");
{
  const { items, store } = mkItems(3);
  const item = items[0], rec = store[item.id];
  let paths = 0;
  S.CHAPTERS.forEach((c, ci) => {
    const queue = [[]];
    let guard = 0;
    while (queue.length && guard++ < 400) {
      const picks = queue.shift();
      const rc = JSON.parse(JSON.stringify(rec));
      let res = S.chapTalkEnter(item, rc, ctx, ci);
      for (let k = 0; k < picks.length; k++) res = S.chapTalkChoose(item, rc, ctx, k);
      if (!res.ended && res.choices && res.choices.length) {
        for (let c = 0; c < res.choices.length; c++) queue.push(picks.concat([c]));
        continue;
      }
      paths++;
      const all = (res.log || []).map((m) => m.text || "").join("\n");
      const resid = all.match(PH);
      ok(!resid, "第" + (ci + 1) + "章 路径[" + picks.join(",") + "] 占位符零残留" + (resid ? " → " + JSON.stringify(resid.slice(0, 3)) : ""));
      ok(!!res.ended, "第" + (ci + 1) + "章 路径[" + picks.join(",") + "] 走到结尾");
    }
  });
  console.log("   主线：共跑 " + paths + " 条完整路径");
}

/* ---------------- 3. 章节状态（老 8 章行为不变） ---------------- */
section("3. chapterState 向后兼容");
{
  const { items, store } = mkItems(1);
  const rec = store["it0"];
  const st = S.chapterState(rec, { dayNo: 5 });
  ok(st.length === 8, "老 8 章仍是 8 条");
  ok(st[0].unlocked === true, "第 1 章 days=5 已解锁");
  const st2 = S.chapterState(rec, { dayNo: 5 });
  ok(st2.every((x) => typeof x.need === "string"), "need 全是字符串");
  // 老 rec.chapters 结构未被新键污染
  S.readChapter(rec, 0);
  ok(!!rec.chapters[0], "readChapter 仍写 rec.chapters");
}

/* ---------------- 4. 命名全量替换验证 ---------------- */
section("4. 命名：全 APP 无「精灵」统称残留");
{
  const files = ["js/app.js", "js/spirits.js", "js/rooms.js", "js/poster.js", "js/db.js",
    "js/tips.js", "js/stats.js", "js/game.js", "js/image.js", "js/color.js", "js/ocr.js", "js/categories.js",
    "js/config.js", "css/skin.css", "css/style.css", "index.html", "sw.js", "manifest.json", "gallery.html"];
  const BANNED = ["精灵", "成精", "精灵小镇", "灵犀", "点犀", "幼生期", "成长期", "觉醒期", "完成体"];
  let bad = [];
  files.forEach((f) => {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) return;
    const t = fs.readFileSync(p, "utf8");
    BANNED.forEach((b) => {
      const c = t.split(b).length - 1;
      if (c) bad.push(f + " 残留「" + b + "」×" + c);
    });
  });
  ok(bad.length === 0, "无残留统称" + (bad.length ? " → " + bad.join("; ") : ""));
  // 灵耳必须存在
  const sp = fs.readFileSync(path.join(ROOT, "js/spirits.js"), "utf8");
  ok(sp.indexOf('zh: "灵耳"') >= 0, "外貌特征已改「灵耳」");
  ok(sp.indexOf('zh: "沁灵耳"') < 0, "未出现「沁灵耳」");
  // 红线不许动
  ok(sp.indexOf('"ww_spirits"') >= 0, "ww_spirits 未动");
  const db = fs.readFileSync(path.join(ROOT, "js/db.js"), "utf8");
  ok(db.indexOf('"spirit_store"') >= 0, "spirit_store 未动");
  ok(sp.indexOf("window.Spirits = {") >= 0, "window.Spirits 未动");
  const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok(idx.indexOf("js/spirits.js?v=") >= 0, "js/spirits.js 文件名未动");
  ok(/\?v=202612\d\d/.test(idx) && idx.indexOf("20260928h") < 0, "index.html 版本号已 bump（无旧版本号残留）");
}

/* ---------------- 5. 行尾检查 ---------------- */
section("5. 行尾：CRLF 文件无 \\r\\r\\n");
{
  const files = ["js/app.js", "js/spirits.js", "js/rooms.js", "js/db.js", "js/poster.js",
    "css/skin.css", "css/style.css", "index.html"];
  let bad = [];
  files.forEach((f) => {
    const b = fs.readFileSync(path.join(ROOT, f));
    if (b.indexOf(Buffer.from("\r\r\n")) >= 0) bad.push(f);
  });
  ok(bad.length === 0, "无 \\r\\r\\n" + (bad.length ? " → " + bad.join(",") : ""));
}

/* ---------------- 6. 胎性 tiXingOf（纯函数，覆盖 categories.js 全量选项） ---------------- */
section("6. 胎性 tiXingOf（categories.js 全量选项覆盖）");
{
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  loadFile(h.ctx, "js/categories.js");
  const S = h.sandbox.Spirits, C = h.sandbox.Categories;
  const spec = { "菩提": ["木", "杂"], "水晶": ["石"], "玉石": ["石", "脂"], "拼图": ["杂"], "动漫周边": ["杂"], "盲盒": ["杂"] };
  let bad = [];
  Object.keys(spec).forEach((cat) => {
    const opts = (C.getCategoryConfig(cat) || {}).options || [];
    opts.forEach((sp) => {
      const got = S.tiXingOf({ category: cat, species: sp });
      if (spec[cat].indexOf(got) < 0) bad.push(cat + "/" + sp + " → " + got);
    });
  });
  ok(bad.length === 0, "分类×品种全覆盖判定正确" + (bad.length ? " → " + bad.slice(0, 8).join("; ") : ""));
  ok(S.tiXingOf({ category: "玉石", species: "蜜蜡" }) === "脂", "🔴 蜜蜡（挂玉石分类下）判成脂胎，不是石胎");
  ok(S.tiXingOf({ category: "玉石", species: "琥珀" }) === "脂", "🔴 琥珀判成脂胎");
  ok(S.tiXingOf({ category: "盲盒", species: "LABUBU" }) === "杂", "LABUBU 判成杂胎（先排除非文玩）");
  ok(S.tiXingOf({ category: "菩提", species: "" }) === "木", "品种空 → 分类兜底（菩提→木）");
  ok(S.tiXingOf({ category: "水晶", species: "月光石" }) === "石", "月光石 → 石胎");
  ok(S.tiXingOf({}) === "杂", "全空 → 杂胎");
  ok(S.tiXingOf(null) === "杂", "null → 杂胎（无副作用）");
  const before = JSON.stringify({ category: "菩提", species: "金刚菩提" });
  const it = { category: "菩提", species: "金刚菩提" };
  S.tiXingOf(it);
  ok(JSON.stringify(it) === before, "tiXingOf 纯函数：不写任何字段（零新存储）");
  ok(S.tiXingLabel({ category: "玉石", species: "蜜蜡" }) === "脂胎", "tiXingLabel 给「X胎」形式");
  ok(S["胎性Of"] === S.tiXingOf, "中文别名 胎性Of 与 tiXingOf 同一函数");
  ok(S.normTiXing("木胎") === "木" && S.normTiXing("木") === "木", "when.tixing 允许「木」/「木胎」两种写法");
}

/* ---------------- 7. thMember / thEnv 字段与聚合 ---------------- */
section("7. thMember / thEnv 字段扩展（O(n)，不新增遍历）");
{
  const { items, store } = mkItems(12);
  const groups = [{ id: "roomA", name: "小屋 A", items: items.slice(0, 6) }];
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  const S = h.sandbox.Spirits;
  items.forEach((it) => { it.lastPlayedAt = Date.now() - (Number(it.playCount) || 0) * 86400000; });
  const threads = S.nightThreads(items, store, ctx, groups);
  const fam = threads.filter((t) => t.kind === "family")[0];
  const m0 = fam.members[0];
  ["bond", "bondLv", "stage", "growth", "plays", "idle", "tixing", "gifted"].forEach((k) => {
    ok(m0[k] !== undefined, "thMember 有字段 " + k);
  });
  ok(typeof m0.bond === "number" && m0.bondLv >= 0 && m0.stage >= 1, "thMember 字段类型正确");
  const never = { id: "nx", name: "没盘过", createdAt: Date.now(), playCount: 0 };
  const st2 = S.nightThreads([never], {}, ctx, [])[0];
  ok(st2.members[0].idle === -1, "从未盘过 → idle = -1（聚合时跳过）");
  const ev = S.threadEvents(fam, ctx, {}) .env;
  ["bondMax", "bondMin", "bondLvMax", "stageMax", "stageMin", "growthMax", "playsMax", "idleMax", "tiXingSet", "giftedN", "giftedAny", "roomMax", "isMainIn"].forEach((k) => {
    ok(ev[k] !== undefined, "thEnv 有聚合键 " + k);
  });
  const expBondMax = Math.max.apply(null, fam.members.map((m) => m.bond));
  ok(ev.bondMax === expBondMax, "bondMax 正确（" + ev.bondMax + "）");
  ok(ev.stageMax === Math.max.apply(null, fam.members.map((m) => m.stage)), "stageMax 正确");
  ok(ev.growthMax === Math.max.apply(null, fam.members.map((m) => m.growth)), "growthMax 正确");
  ok(ev.playsMax === Math.max.apply(null, fam.members.map((m) => m.plays)), "playsMax 正确");
  ok(ev.idleMax === Math.max.apply(null, fam.members.map((m) => m.idle)), "idleMax 正确");
  ok(ev.giftedN === fam.members.filter((m) => m.gifted).length, "giftedN 正确");
  ok(Object.keys(ev.tiXingSet).length >= 1, "tiXingSet 有胎性键");
  ok(ev._roomN === undefined, "内部临时量 _roomN 已从 env 契约里删掉");
  ok(ev.roomMax >= 1, "roomMax ≥ 1");
  // 老 8 键一字未动
  ok(ev.days === ctx.dayNo && ev.idle === ctx.idleDays && ev.plays === ctx.plays && ev.members === fam.members.length, "老 8 键取值与原来一致");
  // 100 只规模：thEnv 一次 forEach 完成，耗时可控
  const big = mkItems(100);
  big.items.forEach((it) => { it.lastPlayedAt = Date.now(); });
  const t0 = Date.now();
  const bigThreads = S.nightThreads(big.items, big.store, ctx, [{ id: "roomA", items: big.items.slice(0, 60) }]);
  bigThreads.forEach((th) => S.threadEvents(th, ctx, big.store["it0"]));
  const dt = Date.now() - t0;
  ok(dt < 1500, "100 只串全量算 env + 事件： " + dt + "ms（O(n)，无两两枚举）");
}

/* ---------------- 8. whenOK 新键 + anyOf / not ---------------- */
section("8. whenOK 新键（bond/stage/growth/room/gifted/tixing/isMain/canBreak）+ anyOf / not");
{
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  const S = h.sandbox.Spirits;
  const item = { id: "it0", name: "串0", category: "菩提", species: "金刚菩提", playCount: 30, roomId: "rA", createdAt: Date.now() - 86400000 * 60 };
  const rec = { stage: 3, bond: 130, look: { pers: "calm" } };
  const env = S.soloEnv(item, rec, { dayNo: 60, idleDays: 3, plays: 30, roomCount: 2, members: 5 });
  ok(env.bond === 130 && env.bondLv === 4, "soloEnv bond/bondLv 正确（130 → 第 5 档）");
  ok(env.bondName === "同心", "soloEnv bondName = 同心（新档位名）");
  ok(env.stage === 3 && env.growth === 30 * 3 + 60, "soloEnv growth = plays*3 + days");
  ok(env.tixing === "木" && env.room === 2 && env.members === 5 && env.gifted === 0, "soloEnv 胎性/room/members/gifted");
  ok(env.isMain === false, "无主串 → isMain=false");
  // 键判定
  ok(S.whenOK({ bond: 120 }, env) === true, "bond 120 ≤ 130 通过");
  ok(S.whenOK({ bond: 240 }, env) === false, "bond 240 > 130 不通过");
  ok(S.whenOK({ bondLv: 4 }, env) === true && S.whenOK({ bondLv: 5 }, env) === false, "bondLv 判定");
  ok(S.whenOK({ stage: 3 }, env) === true && S.whenOK({ stage: 4 }, env) === false, "stage 判定");
  ok(S.whenOK({ growth: 150 }, env) === true && S.whenOK({ growth: 200 }, env) === false, "growth 判定");
  ok(S.whenOK({ room: 2 }, env) === true && S.whenOK({ room: 3 }, env) === false, "room 判定");
  ok(S.whenOK({ gifted: 1 }, env) === false, "gifted 未送走 → 不通过");
  ok(S.whenOK({ gifted: 1 }, S.soloEnv({ gifted: true, category: "菩提" }, rec, { dayNo: 60 })) === true, "送走过 → via");
  ok(S.whenOK({ tixing: ["木"] }, env) === true && S.whenOK({ tixing: ["木胎"] }, env) === true, "tixing 两种写法都对");
  ok(S.whenOK({ tixing: ["石"] }, env) === false, "tixing 不中 → false");
  ok(S.whenOK({ tixing: ["木", "石"] }, env) === false, "tixing 数组 = AND 全命中");
  ok(S.whenOK({ isMain: false }, env) === true && S.whenOK({ isMain: true }, env) === false, "isMain 判定");
  ok(S.whenOK({ canBreak: false }, S.soloEnv({ id: "n", category: "菩提", playCount: 0 }, { stage: 1, bond: 0 }, { dayNo: 1 })) === true, "canBreak=false 命中（攒不够）");
  ok(S.whenOK({ canBreak: true }, S.soloEnv({ id: "n", category: "菩提", playCount: 0 }, { stage: 1, bond: 0 }, { dayNo: 1 })) === false, "canBreak=true 此时不命中");
  // anyOf / not
  ok(S.whenOK({ anyOf: [{ bond: 999 }, { stage: 3 }] }, env) === true, "anyOf：任一满足即通过");
  ok(S.whenOK({ anyOf: [{ bond: 999 }, { stage: 9 }] }, env) === false, "anyOf：全不满足 → 不通过");
  ok(S.whenOK({ not: { gifted: 1 } }, env) === true, "not：取反");
  ok(S.whenOK({ not: { bond: 100 } }, env) === false, "not：命中则拒绝");
  ok(S.whenOK({ stage: 3, anyOf: [{ idle: 7 }, { days: 40 }, { bond: 90, room: 2 }] }, env) === true, "嵌套 anyOf 复合条件");
  ok(S.whenOK({ always: true, bond: 999 }, env) === true, "always 仍短路 true");
  ok(S.whenOK(null, env) === true, "when 为空 → true");
  // 缺键保守：env 里没有的键 → 不满足
  ok(S.whenOK({ bond: 1 }, {}) === false, "🔴 env 缺键 → 判不满足（绝不误解锁）");
  ok(S.whenOK({ tixing: ["木"] }, {}) === false, "env 缺 tiXingSet → 不满足");
  // 聚合键约定：同一份 when 喂 soloEnv 与 thEnv 都能判
  const { items, store } = mkItems(12);
  const h2 = makeContext(); loadFile(h2.ctx, "js/spirits.js");
  const S2 = h2.sandbox.Spirits;
  const th = S2.nightThreads(items, store, ctx, [])[0];
  const tEnv = S2.threadEvents(th, ctx, {}).env;
  const w = { bond: 30, stage: 2 };
  ok(typeof S2.whenOK(w, tEnv) === "boolean" && typeof S2.whenOK(w, env) === "boolean", "同一份 when 喂两个 env 都能判（bondMax/stageMax 聚合）");
  const idx = items.findIndex((x, i) => store["it" + i].bond >= 30);
  ok(tEnv.bondMax >= 30, "thEnv 用 bondMax 兜住 bond 键（bondMax=" + tEnv.bondMax + "）");
}

/* ---------------- 9. whenNeed 同步（漏改 = 空白提示） ---------------- */
section("9. whenNeed 每个新键都有非空提示（一表驱动，不会漏改）");
{
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  const S = h.sandbox.Spirits;
  const empty = {};
  const cases = [
    ["bond", { bond: 240 }], ["bondLv", { bondLv: 5 }], ["stage", { stage: 4 }], ["growth", { growth: 9999 }],
    ["room", { room: 3 }], ["gifted", { gifted: 1 }], ["tixing", { tixing: ["木"] }],
    ["isMain", { isMain: true }], ["canBreak", { canBreak: true }],
  ];
  cases.forEach(([k, w]) => {
    const s = S.whenNeed(w, empty);
    ok(!!s && s.length > 1, "whenNeed 对「" + k + "」给出提示：" + (s || "(空!)"));
  });
  ok(S.whenNeed({ anyOf: [{ bond: 240 }, { stage: 9 }] }, empty).length > 1, "anyOf 未满足 → 取第一条未满足子条件的提示");
  ok(S.whenNeed({ not: { gifted: 1 } }, empty).length > 1, "not 有提示");
  ok(S.whenNeed(null, empty) === "", "when 为空 → 空提示");
  ok(S.whenNeed({ always: true }, empty) === "", "always → 空提示");
  ok(S.whenNeed({ bond: 1 }, { bond: 50 }) === "", "已满足 → 空提示");
  // WHEN_KEYS 是唯一来源：whenOK 与 whenNeed 用同一张表
  ok(Array.isArray(S.WHEN_KEYS) && S.WHEN_KEYS.length === 17, "WHEN_KEYS 表共 17 个键（8 老 + 9 新）");
  S.WHEN_KEYS.forEach((sp) => ok(typeof sp.ok === "function" && typeof sp.need === "function" && typeof sp.has === "function", "WHEN_KEYS[" + sp.k + "] 三件套齐全"));
}

/* ---------------- 10. bondOf 老存档兜底 ---------------- */
section("10. bondOf 老存档兜底（rec.bond == null）");
{
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  const S = h.sandbox.Spirits;
  ok(S.bondOf({}, { dayNo: 10 }) === 10, "无 bond → min(40, days)=10");
  ok(S.bondOf({}, { dayNo: 999 }) === 40, "封顶 40");
  ok(S.bondOf({ bond: 0 }, { dayNo: 999 }) === 0, "bond=0 是合法值（不兜底）");
  ok(S.bondOf({ bond: 250 }, { dayNo: 1 }) === 250, "已有 bond 直接用");
  ok(S.bondOf(null, null) === 1, "全空 → min(40,1)=1（不炸）");
  // 老存档不会因为 bond 键被锁死
  const env = S.soloEnv({ id: "x", category: "菩提" }, {}, { dayNo: 100 });
  ok(S.whenOK({ bond: 40 }, env) === true, "老存档 dayNo=100 → bond 兜底 40，第 2/4 章不被锁死");
  ok(S.whenOK({ bond: 150 }, env) === false, "但高门槛章仍需真实亲密度");
}

/* ---------------- 11. duoPick 新增 starBond ---------------- */
section("11. duoPick 新增 starBond（按亲密度挑主角）");
{
  const { items, store } = mkItems(12);
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  const S = h.sandbox.Spirits;
  S.NIGHT_EVENTS.push({ id: "t_star", icon: "🌟", title: "t", scope: "duo", cast: 2, when: { starBond: 100, members: 2 }, nodes: { start: { lines: [{ w: "A", t: "hi" }], next: "e" }, e: { ending: { key: "k", name: "n", text: "t" } } } });
  const threads = S.nightThreads(items, store, ctx, []);
  const duo = threads.filter((t) => t.kind === "duo");
  ok(duo.length >= 1, "starBond 事件生成了双人组会话");
  const pair = duo[0].members;
  ok((Number(pair[0].bond) || 0) >= 100, "🔴 star 是第一个 bond ≥ 100 的（bond=" + pair[0].bond + "）");
  ok(pair[0].id !== pair[1].id, "star 与 mate 不是同一串");
  S.NIGHT_EVENTS.pop();
  // 老规则不受影响
  const t2 = S.nightThreads(items, store, ctx, []);
  ok(Array.isArray(t2), "无 starBond 时行为不变");
}

/* ---------------- 12. greetVars / fmt 新占位符 + 中文占位符 ---------------- */
section("12. greetVars / fmt 新占位符（含中文 {胎性}）");
{
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  const S = h.sandbox.Spirits;
  const item = { id: "it0", name: "金刚", category: "菩提", species: "金刚菩提", roomId: "rA" };
  const rec = { stage: 3, bond: 130, persona: { name: "阿金" } };
  const v = S.greetVars(item, rec, { dayNo: 20, plays: 5, roomCount: 3 });
  ["bondlv", "bond", "species", "tixing", "room", "胎性"].forEach((k) => ok(v[k] !== undefined, "greetVars 有 " + k));
  ok(v.bondlv === "同心" && v["胎性"] === "木胎" && v.tixing === "木胎" && v.species === "金刚菩提" && v.room === "3",
    "greetVars 新字段取值正确（bonLv=同心 / 胎性=木胎 / room=3）");
  ok(S.greetVars(item, rec, { dayNo: 20 }).room === "", "ctx 没给 roomCount 时 room 为空串（fmt 会抹掉占位符，不留残渣）");
  // 走真 fmt 路径：greetingOf / townEvents 都过 fmt
  const g = S.greetingOf(item, rec, { dayNo: 20, plays: 5, roomCount: 3 });
  ok(!!g && !PH.test(String(g.text)), "每日问候（fmt 路径）无占位符残留：" + (g && g.text));
  const items3 = [item, { id: "it1", name: "椰壳", category: "菩提", species: "椰壳", roomId: "rA" }, { id: "it2", name: "蜜蜡", category: "玉石", species: "蜜蜡" }];
  const store3 = { it0: rec, it1: { stage: 2, bond: 40 }, it2: { stage: 2, bond: 40 } };
  const t = S.townEvents(items3, store3);
  const resid = t.map((x) => String(x.text)).join("\n").match(PH);
  ok(t.length > 0 && !resid, "沁灵巷动态（fmt 路径）无占位符残留" + (resid ? " → " + JSON.stringify(resid) : ""));
  ok(v["胎性"] === S.tiXingLabel(item), "greetVars 的 {胎性} 与 tiXingLabel 同源");
}

/* ---------------- 13. chapterState 新门槛（缺省 = 不限制） ---------------- */
section("13. chapterState 支持 bond / plays / idle / room / anyOf");
{
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  const S = h.sandbox.Spirits;
  const read8 = {}; for (let i = 0; i < 8; i++) read8[i] = { at: 1 };
  const rec = { stage: 4, bond: 200, chapters: read8 };
  const cctx = { dayNo: 100, plays: 80, idleDays: 10, members: 5 };
  const st = S.chapterState(rec, cctx, 3);
  ok(st.length === 8, "老 8 章仍返回 8 条");
  ok(st[0].unlocked === true, "第 1 章可解锁（stage4/days100）");
  ok(st[7].unlocked === true, "老 8 章全解锁（已读链完整）");
  // 临时插一章带新门槛的章节，验证判定与提示
  S.CHAPTERS.push({ vol: 5, volName: "卷五 · 测试", stage: 4, days: 0, icon: "🧪", title: "测试章", bond: 300 });
  const st2 = S.chapterState(rec, cctx, 3);
  const last = st2[st2.length - 1];
  ok(last.unlocked === false, "bond 不够 → 不解锁");
  ok(/再熟一点|同心|沁透/.test(last.need), "bond 提示文案非空且合理：" + last.need);
  S.CHAPTERS[S.CHAPTERS.length - 1].bond = 100;
  const st3 = S.chapterState(rec, cctx, 3);
  ok(st3[st3.length - 1].unlocked === true, "bond 够 → 解锁");
  // room 门槛（由 app 层传入 roomCount）
  S.CHAPTERS[S.CHAPTERS.length - 1] = { vol: 5, volName: "卷五 · 测试", stage: 4, days: 0, icon: "🧪", title: "测试章", room: 3 };
  ok(S.chapterState(rec, cctx, 3)[8].unlocked === true, "room 3 ≥ 3 → 解锁");
  ok(S.chapterState(rec, cctx, 1)[8].unlocked === false, "独串（room 1）→ 不解锁（由 app 层算 roomCount）");
  ok(/同屋/.test(S.chapterState(rec, cctx, 1)[8].need), "room 提示文案：" + S.chapterState(rec, cctx, 1)[8].need);
  // anyOf 解死锁（注意 dayNo 必须仍够前 8 章的 days 门槛，否则串行锁先挡住）
  S.CHAPTERS[S.CHAPTERS.length - 1] = { vol: 5, volName: "卷五 · 测试", stage: 4, days: 0, icon: "🧪", title: "测试章", anyOf: [{ idle: 7 }, { days: 400 }] };
  const cNo = S.chapterState(rec, { dayNo: 100, idleDays: 0, plays: 0, members: 5 }, 1)[8];
  ok(cNo.unlocked === false && !!cNo.need, "anyOf 都不满足 → 不解锁，且给出提示：" + cNo.need);
  ok(S.chapterState(rec, { dayNo: 100, idleDays: 9, plays: 0, members: 5 }, 1)[8].unlocked === true, "anyOf 命中 idle → 解锁（日活玩家也能走到，解死锁）");
  ok(S.chapterState(rec, { dayNo: 400, idleDays: 0, plays: 0, members: 5 }, 1)[8].unlocked === true, "anyOf 命中 days → 解锁（兜底路径）");
  ok(typeof S.unreadChapterCount(rec, cctx, 3) === "number", "unreadChapterCount 支持 roomCount 透传");
}

const pass = summary();
process.exit(pass ? 0 : 1);
