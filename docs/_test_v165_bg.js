/* v165 · BG 场景背景系统自测（数据层 + ensureBg 运行时核心）
   覆盖：
     1. BG_CATALOG 恰好 21 条且 key 连续 BG-01..BG-21（字段完整 / 名取自大纲 §八 / ⛔ 无密度类约束）
     2. seedKey 稳定（bg:BG-01）
     3. ensureBg 三条路径：命中直返 / 未命中成功（出图→压→云→写库）/ 失败回退（落 data URI 仍写库）
        + 生成抛错（离线/无 key）→ 返回空、不写库 + 并发去重（同 key 只出一张）
        + ww_bg 默认存储形态 {url, at} + 二次命中不再出图 + ⛔ 不碰 ww_spirits
     4. ch1–5 映射：出现的每个 BG key 都存在于 catalog，且与主理人给定清单逐条一致

   用法： node docs/_test_v165_bg.js
   纪律：跑在「改动后源码」上必须全绿。 */
"use strict";
const H = require("./_harness.js");
let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function newS() { const c = H.makeContext(); H.loadFile(c.ctx, "js/spirits.js"); return { S: c.sandbox.Spirits, c: c }; }

(async function main() {
  /* ============ 1. BG_CATALOG ============ */
  section("1. BG_CATALOG：21 条 + key 连续 BG-01..BG-21 + 字段完整");
  {
    const { S } = newS();
    const keys = Object.keys(S.BG_CATALOG || {});
    ok(keys.length === 21, "恰好 21 条（实得 " + keys.length + "）");
    let seq = true;
    for (let i = 0; i < 21; i++) { const k = "BG-" + String(i + 1).padStart(2, "0"); if (keys[i] !== k) seq = false; }
    ok(seq, "key 连续 BG-01..BG-21 且顺序正确");
    ok(keys.every((k) => { const e = S.BG_CATALOG[k]; return e && e.key === k && e.name && e.prompt; }), "每条皆含 key/name/prompt 且 key 自洽");
    ok(S.BG_CATALOG["BG-01"].name.indexOf("巷口石阶") >= 0, "BG-01 名含「巷口石阶」（取自大纲 §八）");
    ok(S.BG_CATALOG["BG-09"].name.indexOf("挂榜") >= 0, "BG-09 名含「挂榜」");
    ok(S.BG_CATALOG["BG-19"].name.indexOf("星月坛") >= 0, "BG-19 名含「星月坛」");
    ok(S.BG_CATALOG["BG-21"].name.indexOf("雪夜") >= 0, "BG-21 名含「雪夜」");
    ok(!/DENSITY|密集恐惧/i.test(JSON.stringify(S.BG_CATALOG)), "⛔ 不含 DENSITY / 密集恐惧 类约束");
    ok(/空镜无人/.test(S.BG_PROMPT_TAIL) && /16:9/.test(S.BG_PROMPT_TAIL) && /立绘/.test(S.BG_PROMPT_TAIL),
      "prompt 装配后缀含 空镜无人 / 横版 16:9 / 留立绘位");
    ok(S.BG_KEY === "ww_bg", "存储键 = ww_bg（新键，⛔ 与 ww_spirits 无关）");
  }

  /* ============ 2. seedKey ============ */
  section("2. seedKey 稳定");
  {
    const { S } = newS();
    ok(S.bgSeedKey("BG-01") === "bg:BG-01", "bgSeedKey('BG-01') = bg:BG-01");
    ok(S.bgSeedKey("BG-21") === "bg:BG-21", "bgSeedKey('BG-21') = bg:BG-21");
    ok(S.bgSeedKey("BG-01") === S.bgSeedKey("BG-01"), "seedKey 可重复、稳定");
  }

  /* ============ 3. ensureBg 三条路径 ============ */
  section("3. ensureBg：命中 / 未命中成功 / 失败回退");
  {
    // 3A 命中：直返，不出图、不写库
    {
      const { S } = newS();
      let gen = 0, wrote = 0;
      const deps = {
        get: () => "https://cdn/bg/BG-01.jpg",
        set: () => { wrote++; return true; },
        generate: () => { gen++; return { b64: "AA" }; },
        toStore: () => ({ url: "x", cloud: true }),
      };
      const u = await S.ensureBg("BG-01", deps);
      ok(u === "https://cdn/bg/BG-01.jpg" && gen === 0 && wrote === 0, "命中：直返已存 URL，不出图、不写库");
    }
    // 3B 未命中成功：出图 → 压 → 云 → 写库 → 返回云 URL
    {
      const { S } = newS();
      const wrote = {}; let genArgs = null, toArgs = null;
      const deps = {
        get: () => "",
        set: (k, v) => { wrote[k] = v; return true; },
        generate: (p, o) => { genArgs = { p: p, o: o }; return { b64: "QUJD" }; },
        toStore: (src, bigMax, bigQ, localMax, localQ) => { toArgs = { src: src, bigMax: bigMax, bigQ: bigQ, localMax: localMax, localQ: localQ }; return { url: "https://cdn/bg/BG-02.jpg", cloud: true }; },
      };
      const u = await S.ensureBg("BG-02", deps);
      ok(u === "https://cdn/bg/BG-02.jpg" && wrote["BG-02"] === u, "未命中成功：出图→压→云→写 ww_bg→返回云 URL");
      ok(!!genArgs && genArgs.o.seedKey === "bg:BG-02" && genArgs.o.variant === 0 && genArgs.o.landscape === true,
        "generate 入参 seedKey=bg:BG-02 / variant:0 / landscape:true");
      ok(!!genArgs && genArgs.p === S.BG_CATALOG["BG-02"].prompt, "generate 用 catalog 里的 prompt");
      ok(!!toArgs && toArgs.bigMax === 1600 && toArgs.bigQ === 0.85, "压缩规格：大图长边 1600 / q0.85");
      ok(!!toArgs && toArgs.localMax === 1280 && toArgs.localQ === 0.8, "回落规格：本地 1280 / q0.8");
    }
    // 3C 失败回退：未上云 → 落 data URI 仍写库（永久）
    {
      const { S } = newS();
      const wrote = {};
      const deps = {
        get: () => "", set: (k, v) => { wrote[k] = v; return true; },
        generate: () => ({ b64: "QUJD" }),
        toStore: () => ({ url: "data:image/jpeg;base64,ZZZ", cloud: false }),
      };
      const u = await S.ensureBg("BG-03", deps);
      ok(/^data:image\//.test(u) && wrote["BG-03"] === u, "失败回退：未上云（离线/未登录）→ 落 data URI 且仍写 ww_bg（永久）");
    }
    // 3D 生成抛错（离线/无 key）→ 返回空、不写库
    {
      const { S } = newS();
      let wrote = false;
      const deps = {
        get: () => "", set: () => { wrote = true; },
        generate: () => { throw new Error("offline / no key"); },
        toStore: () => ({ url: "x", cloud: true }),
      };
      let threw = false, u = "";
      try { u = await S.ensureBg("BG-04", deps); } catch (e) { threw = true; }
      ok(!threw && u === "", "生成抛错：不向上抛，返回空（不崩）");
      ok(wrote === false, "生成抛错：不写 ww_bg（下次可重试）");
    }
    // 3E 并发去重：同 key 同时在飞只出一张
    {
      const { S } = newS();
      let gen = 0;
      const deps = {
        get: () => "", set: () => { return true; },
        generate: () => { gen++; return { b64: "Q" }; },
        toStore: () => Promise.resolve({ url: "https://cdn/bg/BG-06.jpg", cloud: true }),
      };
      const p1 = S.ensureBg("BG-06", deps);
      const p2 = S.ensureBg("BG-06", deps);
      const r = await Promise.all([p1, p2]);
      ok(gen === 1 && r[0] === "https://cdn/bg/BG-06.jpg" && r[1] === r[0], "并发去重：同 key 同时在飞只出一张（generate 仅 1 次）");
    }
    // 3F 默认存储（ww_bg 形态 {url, at}）+ 二次命中不再出图 + ⛔ 不碰 ww_spirits
    {
      const { S, c } = newS();
      const deps = { generate: () => ({ b64: "QUJD" }), toStore: () => ({ url: "https://cdn/bg/BG-05.jpg", cloud: true }) };
      const u1 = await S.ensureBg("BG-05", deps);
      const raw = JSON.parse(c.store.getItem("ww_bg") || "{}");
      ok(!!raw["BG-05"] && raw["BG-05"].url === "https://cdn/bg/BG-05.jpg" && typeof raw["BG-05"].at === "number",
        "默认写入 ww_bg 形态 { url, at }");
      ok(S.bgGet("BG-05") === "https://cdn/bg/BG-05.jpg", "bgGet 命中 ww_bg");
      let g2 = 0;
      const u2 = await S.ensureBg("BG-05", { get: (k) => S.bgGet(k), set: () => {}, generate: () => { g2++; return { b64: "x" }; }, toStore: () => ({ url: "y", cloud: true }) });
      ok(u2 === u1 && g2 === 0, "第二次 ensureBg：命中 ww_bg，不再出图");
      ok(c.store.getItem("ww_spirits") === null, "⛔ 只写 ww_bg，绝不碰 ww_spirits");
      ok(typeof S.bgSeedKey("BG-05") === "string" && S.bgLoadAll()["BG-05"].url === u1, "bgLoadAll 可读出 ww_bg");
    }
  }

  /* ============ 4. 章节 → BG 映射 ============ */
  section("4. ch1–5 映射：出现的每个 BG key 都在 catalog");
  {
    const { S } = newS();
    const map = S.BG_CHAPTER_MAP || {};
    const chs = ["ch1", "ch2", "ch3", "ch4", "ch5"];
    ok(chs.every((c) => Array.isArray(map[c]) && map[c].length > 0), "ch1–ch5 映射均存在且非空");
    let allExist = true; const miss = [];
    chs.forEach((c) => (map[c] || []).forEach((k) => { if (!S.BG_CATALOG[k]) { allExist = false; miss.push(c + ":" + k); } }));
    ok(allExist, "映射里出现的每个 BG key 都存在于 catalog" + (miss.length ? "（缺：" + miss.join(",") + "）" : ""));
    const expect = {
      ch1: ["BG-01", "BG-02", "BG-03"],
      ch2: ["BG-02", "BG-04", "BG-07"],
      ch3: ["BG-04"],
      ch4: ["BG-09", "BG-02", "BG-20"],
      ch5: ["BG-02", "BG-04"],
    };
    let same = true; const diff = [];
    chs.forEach((c) => { if (JSON.stringify(map[c]) !== JSON.stringify(expect[c])) { same = false; diff.push(c); } });
    ok(same, "映射与主理人给定清单逐条一致" + (diff.length ? "（不一致：" + diff.join(",") + "）" : ""));
    ok(typeof S.bgForChapter === "function" && S.bgForChapter("ch1").length === 3 && S.bgForChapter("ch9").length === 0,
      "bgForChapter 可用：ch1 = 3 张 / 未覆盖章节返回空");
  }

  /* ============ 5. 界面接线（静态源检查） ============ */
  section("5. app.js / skin.css 接线：剧情页背景层 + 一键出全套入口");
  {
    const fs = require("fs"), path2 = require("path");
    const appSrc = fs.readFileSync(path2.join(__dirname, "..", "js", "app.js"), "utf8");
    const cssSrc = fs.readFileSync(path2.join(__dirname, "..", "css", "skin.css"), "utf8");
    ok(/class="scenebg/.test(appSrc) && /id="sceneBgLayer"/.test(appSrc), "renderTalkPage 内插入 .scenebg 背景层（id=sceneBgLayer）");
    ok(/sceneBgUrl\(o\.bg\)/.test(appSrc), "renderTalkPage 按 o.bg 选图（未出图 → noimg 兜底）");
    ok(/bg:\s*Spirits\.bgForChapter\("ch"\s*\+\s*\(i\s*\+\s*1\)\)/.test(appSrc), "renderChapTalkPage 传入章节 → BG 映射");
    ok(/id="btnBgAll"/.test(appSrc) && /一键出全套 BG/.test(appSrc), "设置页有「一键出全套 BG」入口");
    ok(/function\s+generateAllBg/.test(appSrc) && /function\s+ensureBg/.test(appSrc), "app.js 定义 ensureBg / generateAllBg（批量 + 失败可续）");
    ok(/toStore:/.test(appSrc) && /imageToStoreUrl/.test(appSrc), "ensureBg 复用 imageToStoreUrl（上云 → 永久 URL / data URI 兜底）");
    ok(/\.scenebg\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/.test(cssSrc) && /\.scenebg\.noimg/.test(cssSrc),
      "skin.css 定义 .scenebg（absolute inset:0）+ .noimg 渐变兜底");
    ok(/\.nt-chat-head,\s*\.nt-body,\s*\.nt-foot\s*\{[^}]*z-index:\s*1/.test(cssSrc), "内容层 z-index:1（在背景层之上）");
  }

  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
})();
