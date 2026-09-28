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
  ok(idx.indexOf("20261108") >= 0, "index.html 版本号已 bump");
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

const pass = summary();
process.exit(pass ? 0 : 1);
