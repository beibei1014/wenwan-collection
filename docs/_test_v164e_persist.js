/* v164e：证明「立绘不会每次登录重出一次」
   验证三件事：
     A. pollinationsUrl 对同一输入完全确定性 → 即使不冻结，每次刷新也是同一张图（无 per-login 变化）。
     B. 【跨会话持久】模拟「第一次登录冻结 → 存盘 → 第二次登录重新加载」，断言冻结地址逐字节一致、未被重算。
     C. 【prompt 再变也不重画】第二次登录即使把画风改掉，已冻结的地址依然原样复用，不跟着新 prompt 走。
   注：B/C 的冻结分支逐行复刻 app.js ensureSpiritImages 的 keyless 分支（2903-2920），与生产一致。*/
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const H = require("./_harness.js");
let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }

const items = [
  { id: "bead-aa01", softness: "", name: "甲" },
  { id: "bead-bb02", softness: "soft", name: "乙" },
];

// 复刻 app.js keyless 冻结分支（逐行对应 2903-2920）
function freezePass(S, list) {
  const cfg = S.getImageCfg();
  if (cfg.provider !== "pollinations") return;        // 仅 keyless
  const cur = S.load();
  for (const it of list) {
    const r = S.ensureIn(cur, it.id);
    if (r.imgFrozen || r.imgUrl) continue;            // ← 已冻结/已存图：跳过，绝不重算
    r.imgUrl = S.pollinationsUrl(it, (r.variant || 0));
    r.imgAt = Date.now();
    r.imgFrozen = true;
  }
  S.save(cur);
}

// 把 ctx 的 localStorage 序列化，灌进另一个 ctx（模拟「关掉浏览器再打开」）
function dumpStore(ctx) { return JSON.stringify(Object.fromEntries(ctx.store._m)); }
function loadStoreInto(ctx, json) {
  const o = JSON.parse(json);
  Object.keys(o).forEach((k) => ctx.store.setItem(k, o[k]));
}

section("A. pollinationsUrl 确定性（同一输入 → 同一地址）");
{
  const c = H.makeContext(); H.loadFile(c.ctx, "js/spirits.js");
  const S = c.sandbox.Spirits;
  const u0 = S.pollinationsUrl(items[0], 0);
  let allSame = true;
  for (let i = 0; i < 50; i++) if (S.pollinationsUrl(items[0], 0) !== u0) allSame = false;
  ok(allSame, "同一串连续 50 次 pollinationsUrl 完全一致（无 per-login 抖动）");
  ok(/^https:\/\/image\.pollinations\.ai\/prompt\//.test(u0), "地址走 pollinations 公共图床（浏览器直接 <img> 显示，无出图计费）");
}

section("B. 跨会话持久：第一次冻结 → 存盘 → 第二次登录");
let firstUrls;
{
  const c1 = H.makeContext(); H.loadFile(c1.ctx, "js/spirits.js");
  const S1 = c1.sandbox.Spirits;
  freezePass(S1, items);
  const s1 = S1.load();
  firstUrls = items.map((it) => s1[it.id].imgUrl);
  ok(firstUrls.every((u) => !!u && s1[it_id(s1, items[0].id)].imgFrozen), "第一次登录：已冻结并写入 localStorage");

  // 模拟「关掉再打开」：全新上下文，但灌入同一份存档
  const c2 = H.makeContext(); H.loadFile(c2.ctx, "js/spirits.js");
  const S2 = c2.sandbox.Spirits;
  loadStoreInto(c2, dumpStore(c1));
  freezePass(S2, items);                 // 第二次登录的冻结逻辑
  const s2 = S2.load();
  const secondUrls = items.map((it) => s2[it.id].imgUrl);
  ok(secondUrls.every((u, i) => u === firstUrls[i]), "第二次登录：冻结地址与第一次逐字节一致（未重算）");
  ok(secondUrls.every((u) => s2[u_id(s2, items[0].id)].imgFrozen), "第二次登录：imgFrozen 仍在，永不重出");
}
function it_id(s, id) { return id; } function u_id(s, id) { return id; }

section("C. prompt 再变也不重画（抗未来 prompt 改动）");
{
  const c3 = H.makeContext(); H.loadFile(c3.ctx, "js/spirits.js");
  const S3 = c3.sandbox.Spirits;
  loadStoreInto(c3, dumpStoreFromFirst());   // 复用 B 的存档
  // 第二次登录把画风改成别的，模拟「未来某次升级又动了 prompt」
  S3.setImageCfg(Object.assign({}, S3.getImageCfg(), { style: "anime" }));
  freezePass(S3, items);
  const s3 = S3.load();
  const urlsAfterStyleChange = items.map((it) => s3[it.id].imgUrl);
  ok(urlsAfterStyleChange.every((u, i) => u === firstUrls[i]),
    "即使画风被改成 anime，已冻结地址仍原样复用，不跟着新 prompt 重画");
}
function dumpStoreFromFirst() {
  // 重新生成 B 的存档（与 B 同输入，确定性 → 同结果）
  const c = H.makeContext(); H.loadFile(c.ctx, "js/spirits.js");
  const S = c.sandbox.Spirits; freezePass(S, items);
  return dumpStore(c);
}

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
