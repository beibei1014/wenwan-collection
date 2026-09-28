/* v163 回归对照：基线 605cd80 的 spirits.js vs 当前 spirits.js
   断言：13 个夜话事件的触发逻辑「行为不变」（when 表达式 / 解锁结果 / need 文案 /
         分支路径数与结局集合 全等），且老 8 章主线行为不变。
   用法： node docs/_regress_baseline.js

   【基线的来源】基线 = 提交 605cd80 的 js/spirits.js（293876 字节，已验证逐字节一致）。
   原先是手工拷进 docs/_tmp/ 的，但 docs/_tmp/ 被 .git/info/exclude 排除 →
   换台机器 / 新 clone 时基线不在，回归对照根本跑不起来（安全网只在作者机器上存在）。
   现在改为跟踪一份到 docs/_baseline/v162_spirits.js（不受 .git/info/exclude 影响），
   任何机器 / CI 上 clone 下来就能直接跑。git 只作为兜底（沙箱内 spawn 可能被拦）。
   若要更新基线： git show <新基线commit>:js/spirits.js > docs/_baseline/<名>.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { makeContext, loadFile, ok, section, summary } = require("./_harness.js");

const BASE_COMMIT = "605cd80";
const BASE_FIXTURE = "docs/_baseline/v162_spirits.js";   // 已跟踪，首选
const BASE_TMP = "docs/_tmp/_baseline_spirits.js";      // 兜底产物（该目录被忽略）

function ensureBaseline() {
  if (fs.existsSync(BASE_FIXTURE)) return BASE_FIXTURE;
  // 兜底：从 git 历史现取。注意沙箱内 spawn git 可能返回 EBUSY，
  // 那种情况下请用上面注释里的命令手工生成，或直接用 node 在仓库外运行。
  fs.mkdirSync(path.dirname(BASE_TMP), { recursive: true });
  const src = execFileSync("git", ["show", BASE_COMMIT + ":js/spirits.js"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (!src || src.length < 1000) throw new Error("取基线失败：git show " + BASE_COMMIT + ":js/spirits.js 返回空。");
  fs.writeFileSync(BASE_TMP, src);
  return BASE_TMP;
}

function boot(rel) {
  const h = makeContext();
  loadFile(h.ctx, rel);
  return h.sandbox.Spirits;
}
const BASE = boot(ensureBaseline());
const NOW = boot("js/spirits.js");

const persList = ["gentle", "lively", "cool", "calm", "mystery", "cheeky"];
function mkItems(n) {
  const items = [], store = {};
  for (let i = 0; i < n; i++) {
    const id = "it" + i;
    items.push({ id: id, name: "串" + i, roomId: i < 6 ? "roomA" : (i < 9 ? "roomB" : ""), playCount: (i * 7) % 40, createdAt: Date.now() - (i + 1) * 86400000 * 5, color: "red", species: "金刚菩提", category: "菩提" });
    store[id] = { stage: 1 + (i % 4), bornAt: Date.now() - (i + 1) * 86400000 * 3, bond: (i * 23) % 300, gender: i % 3 === 0 ? "girl" : "boy", look: { pers: persList[i % 6] }, persona: { name: "小" + i, title: "守珠人", line: "我在柜子里等你", traits: ["安静"] }, chapters: {} };
  }
  return { items, store };
}
const ctx = { dayNo: 400, idleDays: 12, plays: 30 };

function eventAnalysis(S, items, store) {
  const groups = [{ id: "roomA", name: "小屋A", items: items.slice(0, 6) }, { id: "roomB", name: "小屋B", items: items.slice(6, 9) }];
  const threads = S.nightThreads(items, store, ctx, groups);
  const thOf = {};
  threads.forEach((t) => { thOf[t.kind] = thOf[t.kind] || t; });
  const out = {};
  S.NIGHT_EVENTS.forEach((ev) => {
    const th = thOf[ev.scope || "family"] || threads[0];
    const rc = JSON.parse(JSON.stringify(store));
    const state = S.threadEvents(th, ctx, rc[items[0].id]);
    const evState = state.events.filter((x) => x.id === ev.id)[0] || null;
    // 穷举路径
    let paths = 0; const endings = {}; const needs = [];
    const queue = [[]];
    let guard = 0;
    while (queue.length && guard++ < 400) {
      const picks = queue.shift();
      const rec = JSON.parse(JSON.stringify(store));
      let res = S.threadReplay(items[0], rec[items[0].id], ctx, th, ev.id);
      for (let k = 0; k < picks.length; k++) res = S.threadChoose(items[0], rec[items[0].id], ctx, th, picks[k]);
      if (!res.ended && res.choices && res.choices.length) {
        for (let c = 0; c < res.choices.length; c++) queue.push(picks.concat([c]));
        continue;
      }
      paths++; endings[res.ending ? res.ending.key : "(none)"] = 1;
      needs.push((res.log || []).length);
    }
    out[ev.id] = {
      when: JSON.stringify(ev.when),
      unlocked: !!evState && evState.unlocked,
      need: evState ? evState.need : null,
      paths: paths, endings: Object.keys(endings).sort().join("|"),
      msgs: needs.reduce((a, b) => a + b, 0),
    };
  });
  return out;
}

section("A. NIGHT_EVENTS 行为对照（基线 vs 现在）");
{
  const A = mkItems(12), B = mkItems(12);
  const ra = eventAnalysis(BASE, A.items, A.store);
  const rb = eventAnalysis(NOW, B.items, B.store);
  const ids = Object.keys(rb);
  ok(ids.length === Object.keys(ra).length, "事件条数一致（" + ids.length + "）");
  let diff = [];
  ids.forEach((id) => {
    const a = ra[id] || {}, b = rb[id];
    ["when", "unlocked", "need", "paths", "endings", "msgs"].forEach((k) => {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diff.push(id + "." + k + ": " + JSON.stringify(a[k]) + " → " + JSON.stringify(b[k]));
    });
  });
  ok(diff.length === 0, "13 个夜话事件触发逻辑行为不变" + (diff.length ? " → " + diff.join(" | ") : ""));
}

section("B. 主线 v161 8 章行为对照");
{
  const A = mkItems(3), B = mkItems(3);
  function chap(S, items, store) {
    const item = items[0], rec = store[item.id], out = {};
    S.CHAPTERS.forEach((c, ci) => {
      const queue = [[]]; let paths = 0; const end = {};
      let guard = 0;
      while (queue.length && guard++ < 200) {
        const picks = queue.shift();
        const rc = JSON.parse(JSON.stringify(rec));
        let res = S.chapTalkEnter(item, rc, ctx, ci);
        for (let k = 0; k < picks.length; k++) res = S.chapTalkChoose(item, rc, ctx, k);
        if (!res.ended && res.choices && res.choices.length) { for (let c = 0; c < res.choices.length; c++) queue.push(picks.concat([c])); continue; }
        paths++; end[res.ending ? res.ending.key : "(none)"] = 1;
      }
      out["ch" + ci] = paths + ":" + Object.keys(end).sort().join("|");
    });
    const st = S.chapterState(rec, ctx).map((x) => (x.unlocked ? 1 : 0) + "/" + (x.need || "")).join(",");
    return { chap: out, state: st, chaptersLen: S.CHAPTERS.length };
  }
  const a = chap(BASE, A.items, A.store), b = chap(NOW, B.items, B.store);
  // 形态名已改名（幼生期→凝形…），把名字归一成「阶 N」再比结构
  function norm(o) {
    return JSON.stringify(o).replace(/幼生期|凝形/g, "阶1").replace(/成长期|开窍/g, "阶2")
      .replace(/觉醒期|蜕形/g, "阶3").replace(/完成体|化形/g, "阶4")
      .replace(/突破/g, "深沁");
  }
  ok(norm(a) === norm(b), "主线 8 章分支行为不变（形态名改名已归一）" + (norm(a) === norm(b) ? "" : " → " + norm(a) + " vs " + norm(b)));
}

section("C. 占位符替换器对照（老占位符行为不变）");
{
  const { items, store } = mkItems(1);
  const item = items[0], rec = store[item.id];
  const a = BASE.greetingOf(item, rec, ctx), b = NOW.greetingOf(item, rec, ctx);
  ok(JSON.stringify(a) === JSON.stringify(b), "每日问候（fmt 路径）行为不变");
  const ta = BASE.townEvents(items, store), tb = NOW.townEvents(items, store);
  ok(ta.length === tb.length && ta.every((x, i) => x.text === tb[i].text), "沁灵巷动态行为不变");
}

const pass = summary();
process.exit(pass ? 0 : 1);
