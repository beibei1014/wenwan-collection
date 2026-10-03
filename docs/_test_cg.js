/* v163 任务B 自测：CG 存储改 IndexedDB
   断言重点：
   · 像素进 IndexedDB（库 ww_cg），**绝不进** 主 store（ww_spirits）
   · 「已收集」只认元数据 hasImg（像素不在本机 → missing，不是 locked）
   · 第四态 missing 的 class / 文案与 locked 可区分
   · pruneForQuota：CG 最后丢、从旧到新丢、保底留最新 3 张缩略图；cgs 元数据永不丢
   · 主线 CG 规格 1024 / q0.85、缩略图 512 / q0.8（v164i 由 512/0.72、384/0.72 抬高）
   · v125 单张 CG：CG_IMG_SIZE 1280 只进云端，localStorage 兜底 CG_IMG_SIZE_LOCAL 768
   用法： node docs/_test_cg.js [--verbose]
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { makeContext, loadFile, ok, section, summary, makeFakeIDB } = require("./_harness.js");
const ROOT = path.join(__dirname, "..");
const VERBOSE = process.argv.includes("--verbose");

const FULL_MARK = "FULLPIXELMARKER";
const THUMB_MARK = "THUMBPIXELMARKER";

function boot(withIDB) {
  const h = makeContext();
  if (withIDB) { h.sandbox.indexedDB = makeFakeIDB(); h.win.indexedDB = h.sandbox.indexedDB; }
  loadFile(h.ctx, "js/spirits.js");
  return h;
}

/* ---------- 从 app.js 里抽出纯函数代码块，用 new Function 跑（配合假 DOM） ---------- */
function extractFn(src, name) {
  const re = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error("找不到函数 " + name);
  let i = src.indexOf("{", m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, j + 1);
}
/* 从 app.js 源码里读一个数值常量（避免测试里再抄一份数字，抄了就对不上真值） */
function constOf(src, name) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*;").exec(src);
  return m ? Number(m[1]) : NaN;
}

(async function main() {
  const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");

  /* ========== 1. 像素 → IndexedDB（不碰主 store） ========== */
  section("1. CG 像素进 IndexedDB（库 ww_cg），主 store 不受污染");
  {
    const h = boot(true);
    const S = h.sandbox.Spirits;
    const full = "data:image/jpeg;base64," + FULL_MARK;
    const thumb = "data:image/jpeg;base64," + THUMB_MARK;
    const wrote = await S.cgPutPixels("SP1", "CG-01", { full: full, thumb: thumb });
    ok(wrote === true, "cgPutPixels 写入成功");
    const back = await S.cgGetPixels("SP1", "CG-01");
    ok(back && back.full.indexOf(FULL_MARK) >= 0, "cgGetPixels 取回大图");
    ok(back && back.thumb.indexOf(THUMB_MARK) >= 0, "cgGetPixels 取回缩略图");
    ok(!!h.sandbox.indexedDB._dbs["ww_cg"], "IndexedDB 库名为 ww_cg");
    ok(!!h.sandbox.indexedDB._dbs["ww_cg"]._data["pixels"].has("SP1|CG-01"), "像素落在 ww_cg/pixels 的 SP1|CG-01 键上（owner 隔离）");
    ok(h.store.getItem("ww_spirits") == null, "像素写入**没有**碰主 store（ww_spirits 仍为空）");
    ok(h.store.getItem("ww_cg_px") == null, "IDB 可用时不走 localStorage 退路");
    const has = await S.cgHasPixels("SP1", "CG-01");
    ok(has === true, "cgHasPixels 为真");
    await S.cgDelPixels("SP1", "CG-01");
    ok(!(await S.cgHasPixels("SP1", "CG-01")), "cgDelPixels 删除成功");
  }

  /* ========== 2. IndexedDB 不可用 → 独立 key 退路（prune 够不着） ========== */
  section("2. IndexedDB 不可用 → 退到独立 key ww_cg_px");
  {
    const h = boot(false);
    const S = h.sandbox.Spirits;
    const full = "data:image/jpeg;base64," + FULL_MARK;
    const wrote = await S.cgPutPixels("SP1", "CG-02", { full: full, thumb: "" });
    ok(wrote === true, "无 IDB 时 cgPutPixels 走退路成功");
    ok(h.store.getItem("ww_cg_px") != null, "退路写了独立 key ww_cg_px");
    ok(h.store.getItem("ww_spirits") == null, "退路也没碰主 store");
    const back = await S.cgGetPixels("SP1", "CG-02");
    ok(back && back.full.indexOf(FULL_MARK) >= 0, "退路可读回");
    // pruneForQuota 只处理传进来的主 store 对象 → 不可能碰到 ww_cg_px
    S.pruneForQuota({ any: { imgHistory: [1, 2, 3], cgUrl: "x" } });
    ok(h.store.getItem("ww_cg_px") != null, "pruneForQuota 之后退路 key 仍在");
  }

  /* ========== 3. 「已收集」判定以元数据为准 ========== */
  section("3. 已收集 = 元数据 hasImg（不看图在不在）");
  {
    const h = boot(true);
    const S = h.sandbox.Spirits;
    const rec = {};
    ok(S.cgCollectedCount(rec) === 0, "初始 0 张");
    ok(S.cgStateOf(rec, "CG-01") === "locked", "没记录 → locked");
    const fresh = S.cgMarkCollected(rec, "CG-01", { title: "开沁之夜", vol: 1, key: "k1" }, "data:image/jpeg;base64," + THUMB_MARK);
    ok(fresh === true, "首次收集 fresh=true");
    ok(S.cgCollectedCount(rec) === 1, "已收集 1 张");
    ok(S.cgStateOf(rec, "CG-01") === "collected", "未查像素 → collected");
    ok(S.cgStateOf(rec, "CG-01", true) === "ready", "本机有像素 → ready");
    ok(S.cgStateOf(rec, "CG-01", false) === "missing", "🔴 像素不在本机 → missing（不是 locked）");
    const at0 = rec.cgs["CG-01"].at;
    const fresh2 = S.cgMarkCollected(rec, "CG-01", { title: "开沁之夜", key: "k2" }, "");
    ok(fresh2 === false, "重复收集 fresh=false");
    ok(rec.cgs["CG-01"].at === at0, "首次收集时间 at 不被覆盖（换设备重画也保留）");
    ok(rec.cgs["CG-01"].key === "k2", "key 可更新（用于失效判定）");
    ok(S.cgMarkFailed(rec, "CG-01", null, "网络炸了") === false, "已收集的不会被降级成失败");
    ok(S.cgStateOf(rec, "CG-01", false) === "missing", "失败标记后仍是 missing（未倒退成剧透态）");
    S.cgMarkFailed(rec, "CG-03", { title: "开窍" }, "出图失败");
    ok(S.cgStateOf(rec, "CG-03") === "failed", "从没画成功过 → failed（可重画）");
    ok(S.cgCollectedCount(rec) === 1, "failed 不计入已收集");
    // 空 cgs 不会被凭空创建（体积纪律）
    const empty = {};
    S.cgCollectedIds(empty); S.cgStateOf(empty, "CG-09"); S.dropOldCgThumbs(empty, 3);
    ok(!("cgs" in empty), "只读访问不会给记录塞空 cgs");
  }

  /* ========== 4. 第四态视觉可区分（class / 文案单一来源） ========== */
  section("4. missing 不能长得像 locked，也不能像已解锁");
  {
    const h = boot(true);
    const S = h.sandbox.Spirits;
    const cls = S.CG_STATE_CLASS, hint = S.CG_STATE_HINT;
    ok(cls.missing !== cls.locked, "missing class ≠ locked class");
    ok(cls.missing !== cls.ready, "missing class ≠ 已解锁 class");
    ok(hint.missing !== hint.locked, "missing 文案 ≠ locked 文案");
    ok(!!hint.missing && !!hint.locked && !!hint.failed, "locked/failed/missing 都有文案");
    const uniq = {};
    ["ready", "locked", "pending", "failed", "missing", "placeholder"].forEach((s) => { uniq[cls[s]] = 1; });
    ok(Object.keys(uniq).length === 6, "6 种状态 class 互不相同");
    ok(S.cgCellClass("missing") === cls.missing && S.cgCellHint("missing") === hint.missing, "cgCellClass/cgCellHint 走同一张表");
  }

  /* ========== 5. pruneForQuota：CG 最后丢、从旧到新、保底留最新 3 张 ========== */
  section("5. pruneForQuota 顺序重排");
  {
    const h = boot(true);
    const S = h.sandbox.Spirits;
    const rec = {
      imgHistory: ["a", "b", "c", "d"],
      diary: new Array(20).fill("d"), letters: new Array(10).fill("l"),
      echoes: new Array(10).fill("e"), replies: { "01": 1, "02": 1, "03": 1, "04": 1, "05": 1, "06": 1, "07": 1, "08": 1, "09": 1, "10": 1, "11": 1, "12": 1 },
      fests: {}, night: { log: new Array(500).fill("x") }, threads: { family: { runs: { a1: { log: new Array(400).fill("y") } } } },
      cgUrl: "data:image/jpeg;base64," + FULL_MARK.repeat(4000), cgKey: "old", cgStage: 3,
      marks: { c2: "forget", c4: "notbright", c5: "mindown", c7: "giveup", c9: "unneed", c11: "stop" },
      lingxiTalk: { log: new Array(120).fill("z") },
    };
    for (let i = 0; i < 12; i++) rec.fests["f" + i] = { date: "2026-01-01" };
    for (let i = 1; i <= 5; i++) {
      rec.cgs = rec.cgs || {};
      rec.cgs["CG-0" + i] = { hasImg: true, at: 1000 + i, thumb: "data:image/jpeg;base64," + THUMB_MARK + i, title: "T" + i };
    }
    rec.cgs["CG-09"] = { hasImg: false, err: "x", thumb: "" };
    S.pruneForQuota({ it0: rec });
    ok(rec.cgUrl === "", "🔴 cgUrl 被丢（最后一步）");
    ok(rec.imgHistory.length === 1, "imgHistory 裁到 1");
    ok(rec.diary.length === 8 && rec.letters.length === 5 && rec.echoes.length === 5, "日记/来信/回响已裁");
    ok(Object.keys(rec.replies).length === 10, "回信只留 10 条");
    ok(Object.keys(rec.fests).length === 8, "节令只留 8 个");
    ok(rec.night.log.length === 150, "夜话记录裁到 150");
    ok(rec.threads.family.runs.a1.log.length === 150, "会话记录裁到 150");
    ok(Object.keys(rec.marks).length === 5, "记痕只留 5 条（新字段能进 prune）");
    ok(rec.lingxiTalk.log.length === 40, "主线对话槽只留 40 条（新字段能进 prune）");
    const cgKeys = Object.keys(rec.cgs).sort();
    ok(cgKeys.length === 6, "🔴 6 条 CG 元数据一条都没丢");
    ok(cgKeys.filter((k) => rec.cgs[k].hasImg).every((k) => rec.cgs[k].title), "已收集条目的元数据（title）保留");
    ok(rec.cgs["CG-01"].hasImg === true && rec.cgs["CG-09"].hasImg === false, "hasImg 保留（已收集判定不倒退回剧透态）");
    const withThumb = cgKeys.filter((k) => rec.cgs[k].thumb);
    ok(withThumb.length === 3, "缩略图保底留最新 3 张（其余丢 thumb）");
    ok(withThumb.sort().join(",") === "CG-03,CG-04,CG-05", "留下的正是最新 3 张（从旧到新丢）：" + withThumb.join(","));
    ok(cgKeys.every((k) => rec.cgs[k].thumb !== undefined), "丢的是 thumb 字段内容，不是整个格子");
  }

  /* ========== 6. 配额超限整链：save() 自动瘦身 + CG 像素不进 ww_spirits ========== */
  section("6. 配额超限整链（save → prune → 存下）");
  {
    const h = boot(true);
    const S = h.sandbox.Spirits;
    await S.cgPutPixels("SP1", "CG-01", { full: "data:image/jpeg;base64," + FULL_MARK, thumb: "data:image/jpeg;base64," + THUMB_MARK });
    const rec = {
      imgHistory: ["A".repeat(60000), "B".repeat(60000), "C".repeat(60000)],
      diary: [], letters: [], echoes: [],
      cgUrl: "data:image/jpeg;base64," + FULL_MARK.repeat(4000),
      cgs: { "CG-01": { hasImg: true, at: 1, thumb: "data:image/jpeg;base64," + THUMB_MARK, title: "开沁之夜" } },
    };
    const o = { it0: rec };
    // 主 store 配额 200KB：未瘦身约 240KB 必爆，瘦身后约 70KB 存得下
    const h2 = makeContext({ quota: 200000 });
    h2.sandbox.indexedDB = h.sandbox.indexedDB; h2.win.indexedDB = h.sandbox.indexedDB;
    loadFile(h2.ctx, "js/spirits.js");
    const S2 = h2.sandbox.Spirits;
    h2.store.setItem("ww_spirits", "x".repeat(1));         // 占位
    let threw = false;
    try { S2.save(o); } catch (e) { threw = true; }
    ok(!threw, "配额超限时 save() 不抛异常（内部瘦身重存）");
    const raw = h2.store.getItem("ww_spirits") || "";
    ok(raw.length > 0, "瘦身后确实写进了 ww_spirits");
    ok(raw.indexOf(FULL_MARK) < 0, "🔴 大图像素**没有**进 ww_spirits");
    ok(raw.indexOf(THUMB_MARK) >= 0, "缩略图（小图）在 ww_spirits 里，相册不读 IDB 也能出格子");
    const parsed = JSON.parse(raw);
    ok(parsed.it0 && parsed.it0.cgs && parsed.it0.cgs["CG-01"].hasImg === true, "胖身后元数据仍在 → 不会倒退成未解锁");
    ok(parsed.it0.cgUrl === "", "cgUrl 最后被丢");
    ok(parsed.it0.imgHistory.length === 1, "可再生数据最先被裁");
    const px = await S2.cgGetPixels("SP1", "CG-01");
    ok(!!px && px.full.indexOf(FULL_MARK) >= 0, "IndexedDB 里的大图仍在（不受 localStorage 配额影响）");
  }

  /* ========== 7. app.js 落库入口（new Function 跑真代码块 + 假 DOM） ========== */
  section("7. app.js 主线 CG 落库入口（commitMainlineCg）");
  {
    const h = boot(true);
    const S = h.sandbox.Spirits;
    const src = ["cgRecStore", "cgAlbumProgress", "cgAlbumSlots", "commitMainlineCg", "markMainlineCgFailed"]
      .map((n) => extractFn(appSrc, n)).join("\n");
    const factory = new Function("Spirits", "shrinkToDataUri", "urlToDataUri", "bumpGenCount", "confirmModal", "toast", "console",
      "CG_MAIN_SIZE", "CG_MAIN_Q", "CG_THUMB_SIZE", "CG_THUMB_Q",
      src + "\n; return { cgRecStore, cgAlbumProgress, cgAlbumSlots, commitMainlineCg, markMainlineCgFailed };");
    let shrinkCalls = [];
    const C_MAIN = constOf(appSrc, "CG_MAIN_SIZE"), C_MAIN_Q = constOf(appSrc, "CG_MAIN_Q");
    const C_THUMB = constOf(appSrc, "CG_THUMB_SIZE"), C_THUMB_Q = constOf(appSrc, "CG_THUMB_Q");
    const mk = factory(
      S,
      (s, max, q) => { shrinkCalls.push([max, q]); return Promise.resolve("data:image/jpeg;base64," + THUMB_MARK + "@" + max + "q" + q); },
      () => Promise.resolve(""),
      () => { },
      () => Promise.resolve(true),
      () => { },
      console,
      C_MAIN, C_MAIN_Q, C_THUMB, C_THUMB_Q
    );
    // 先造一只沁灵，保证 Spirits.load/ensureIn 有东西
    S.save({ it0: { stage: 1, bornAt: 1, persona: { name: "小0" } } });
    const item = { id: "it0", name: "串0" };
    const r = await mk.commitMainlineCg(item, "CG-01",
      { b64: "AAAA" }, { title: "开沁之夜", caption: "「灯还亮着，你把我翻了个面。」", vol: 1, volName: "卷一 · 醒", chapter: 1, key: "k1", shot: "p" });
    ok(r.ok === true && r.fresh === true, "commitMainlineCg 首次收集成功");
    ok(shrinkCalls.some((c) => c[0] === C_MAIN && c[1] === C_MAIN_Q), "大图按 " + C_MAIN + " / q" + C_MAIN_Q + " 压");
    ok(shrinkCalls.some((c) => c[0] === C_THUMB && c[1] === C_THUMB_Q), "缩略图按 " + C_THUMB + " / q" + C_THUMB_Q + " 压");
    const st = S.load();
    ok(st.it0.cgs["CG-01"].hasImg === true, "元数据写进主 store");
    ok(!!st.it0.cgs["CG-01"].caption, "题词存进元数据");
    const px = await S.cgGetPixels("it0", "CG-01");
    ok(!!px && (px.full || px.thumb), "像素写进 IndexedDB");
    const rawS = h.store.getItem("ww_spirits");
    ok(rawS.indexOf(THUMB_MARK) >= 0, "缩略图在 ww_spirits");
    const prog = mk.cgAlbumProgress(st.it0);
    ok(prog.n === 1 && prog.total === S.CG_TOTAL, "进度 1/" + S.CG_TOTAL);
    const slots = await mk.cgAlbumSlots(st.it0);
    ok(slots.collected.length === 1 && slots.collected[0].state === "ready", "cgAlbumSlots 给出 ready 态");
    // 换设备模拟：清掉像素 → 变 missing，但「已收集」不掉
    await S.cgDelPixels("it0", "CG-01");
    const slots2 = await mk.cgAlbumSlots(st.it0);
    ok(slots2.collected[0].state === "missing", "🔴 像素不在本机 → missing");
    ok(mk.cgAlbumProgress(st.it0).n === 1, "missing 时「已收集」仍是 1（进度不倒退）");
    // 失败不降级
    mk.markMainlineCgFailed(item, "CG-01", { title: "x" }, "boom");
    ok(S.load().it0.cgs["CG-01"].hasImg === true, "已收集的不会被 failed 降级");
  }

  /* ========== 8. 规格常量 & localStorage 兜底档 ========== */
  section("8. 规格：主线 1024/q0.85 + 缩略图 512/q0.8；v125 单张 1280 云端 / 768 本地");
  {
    ok(/const CG_MAIN_SIZE = 1024;/.test(appSrc), "CG_MAIN_SIZE = 1024");
    ok(/const CG_MAIN_Q = 0\.85;/.test(appSrc), "CG_MAIN_Q = 0.85");
    ok(/const CG_THUMB_SIZE = 512;/.test(appSrc), "CG_THUMB_SIZE = 512");
    ok(/const CG_THUMB_Q = 0\.8;/.test(appSrc), "CG_THUMB_Q = 0.8");
    ok(/const CG_IMG_SIZE = 1280;/.test(appSrc), "🔴 v125 单张 CG_IMG_SIZE = 1280（v164i 由 768 抬高）");
    ok(/const CG_IMG_SIZE_LOCAL = 768;/.test(appSrc), "CG_IMG_SIZE_LOCAL = 768（落 localStorage 的兜底长边）");
    // v165-R2：原来「突破 CG / 节令 CG / 房间剧情 CG」三条**各自**落库（3 处），
    //   现在三条线共用唯一入口 drawCgFromBrief → 收敛成 1 处（⛔ 且都不再自动触发）。
    const cgHits = appSrc.match(/CG_IMG_SIZE, 0\.9, CG_IMG_SIZE_LOCAL, 0\.86/g) || [];
    ok(cgHits.length === 1,
      "v165-R2 · 三条 CG 线（蜕形化形 / 节令 / 双人事件）共用 drawCgFromBrief 落库，只剩 1 处（实测 " + cgHits.length + " 处）");
    ok(appSrc.indexOf("async function drawCgFromBrief") >= 0, "收敛后的唯一 CG 落库入口 = drawCgFromBrief");
    ok(appSrc.indexOf("CG_IMG_SIZE, 0.86") < 0, "⛔ 没有「大图 data URI 直落 localStorage」的旧写法残留");
  }

  const pass = summary();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
