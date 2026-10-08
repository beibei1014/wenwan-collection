/* v165-N2 自测：主线《沁灵纪》第 1–9 章正文**机械抽取** + 群像边界
 *
 * 一、六条断言（主理人裁定，逐条钉死）
 *   1. 9 章齐全
 *   2. 零断链（从 start 起 BFS：所有 next / go 目标存在，且**全部可达**）
 *   3. end:true 恰好 9 处
 *   4. who 170 处 / go 25 处
 *   5. 与 docs/v165-第1-9章-剧本.md §4 的 js 代码块**逐字节一致**
 *   6. v178：旧 8 章 CHAP_SCRIPTS / CHAP_ACTS **已删除**（悬空引用清零）；新 9 章 MAIN_SCRIPTS 完好
 *
 * 二、ch1 真跑一遍（不是"理论上能跑"）：进章 → 有台词 → 有选项 → 选第一条 → 继续推进
 *
 * 三、群像边界（优先级等同六条断言）：1 / 2 / 3 / 7 只沁灵四种情况下跑 ch1 开头，
 *     确认：不崩、不出现空头像（7 个行当全部解析得到出演者）、不出现空白行当名
 *
 * 用法：node docs/_test_v165n2_script.js
 */
"use strict";
const H = require("./_harness.js");
const fs = require("fs"), path = require("path");
const { ok, section, summary, makeContext, loadFile } = H;
const ROOT = path.join(__dirname, "..");

const { S, h } = (function () {
  const c = makeContext();
  loadFile(c.ctx, "js/spirits.js");
  return { S: c.sandbox.Spirits, h: c };
})();
const spSrc = fs.readFileSync(path.join(ROOT, "js/spirits.js"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");

// 7 主行当（CHAP_CAST_CFG.MAIN）
const ALL7_FULL = ["dignified", "scholar", "cool", "gentle", "lively", "mystery", "sweet"];

/* ---------- 从 md 现抽一份（机械，不手打） ---------- */
function mdBlocks() {
  const src = fs.readFileSync(path.join(ROOT, "docs", "v165-第1-9章-剧本.md"), "utf8").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const i4 = lines.findIndex((l) => l.startsWith("## §4"));
  const i5 = lines.findIndex((l) => l.startsWith("## §5"));
  const out = [];
  let cur = null;
  for (const l of lines.slice(i4, i5)) {
    if (l.startsWith("```js")) { cur = []; continue; }
    if (l.startsWith("```") && cur !== null) { out.push(cur.join("\n")); cur = null; continue; }
    if (cur !== null) cur.push(l);
  }
  return out.filter((b) => /^const CH0[1-9] = \{/m.test(b));
}

(async function main() {
  /* ============ 断言 1：9 章齐全 ============ */
  section("断言1 · 9 章齐全");
  ok(Array.isArray(S.MAIN_SCRIPTS) && S.MAIN_SCRIPTS.length === 9, "MAIN_SCRIPTS = 9 章（实测 " + (S.MAIN_SCRIPTS || []).length + "）");
  ok(S.MAIN_ACTS.length === 9, "MAIN_ACTS = 9 条");
  ok(S.MAIN_SCRIPTS.every((ch) => ch && ch.start && Array.isArray(ch.start.lines) && ch.start.lines.length),
    "9 章都有 start 节点且开头有台词");
  ok(S.MAIN_ACTS.every((a) => a.nodes && a.nodes.start), "MAIN_ACTS 的 nodes 都挂上了正文");

  /* ============ 断言 2：零断链 ============ */
  section("断言2 · 零断链（BFS：目标存在 ∧ 全部可达）");
  {
    let broken = 0, unreach = 0, total = 0;
    S.MAIN_SCRIPTS.forEach((ch, ci) => {
      const keys = Object.keys(ch).filter((k) => k !== "bg" && k !== "cg" && k !== "cast");
      total += keys.length;
      const seen = new Set(), q = ["start"];
      while (q.length) {
        const n = q.shift();
        if (seen.has(n)) continue;
        seen.add(n);
        const nd = ch[n];
        if (!nd) { broken++; console.log("  断链 ch" + (ci + 1) + " → " + n); continue; }
        (nd.choices || []).forEach((c) => { if (!keys.includes(c.go)) { broken++; console.log("  断链 ch" + (ci + 1) + " go → " + c.go); } q.push(c.go); });
        if (nd.next) { if (!keys.includes(nd.next)) { broken++; console.log("  断链 ch" + (ci + 1) + " next → " + nd.next); } q.push(nd.next); }
      }
      const bad = keys.filter((k) => !seen.has(k));
      if (bad.length) { unreach += bad.length; console.log("  不可达 ch" + (ci + 1) + ": " + bad.join(",")); }
    });
    ok(broken === 0, "零断链（broken=" + broken + "）");
    ok(unreach === 0, "零不可达节点（unreachable=" + unreach + " / 共 " + total + " 节点）");
    ok(total === 66, "节点总数 66（实测 " + total + "）");
  }

  /* ============ 断言 3：end:true 恰好 9 处 ============ */
  section("断言3 · end:true 恰好 9 处");
  {
    const m = spSrc.match(/^const CH0[1-9] = \{[\s\S]*?^\};/gm) || [];
    const n = m.reduce((a, b) => a + (b.match(/end:true/g) || []).length, 0);
    ok(m.length === 9, "源码里能切出 9 个 CH0N 块（实测 " + m.length + "）");
    ok(n === 9, "end:true 恰好 9 处（实测 " + n + "）");
    ok(m.every((b) => (b.match(/end:true/g) || []).length === 1), "每章恰好 1 处 end:true");
  }

  /* ============ 断言 4：who 170 / go 25 ============ */
  section("断言4 · who 170 处 / go 25 处");
  {
    const m = spSrc.match(/^const CH0[1-9] = \{[\s\S]*?^\};/gm) || [];
    const body = m.join("\n");
    const who = (body.match(/who:/g) || []).length;
    const go = (body.match(/go:/g) || []).length;
    ok(who === 170, "who 恰好 170 处（实测 " + who + "）");
    ok(go === 25, "go 恰好 25 处（实测 " + go + "）");
  }

  /* ============ 断言 5：与 md 逐字节一致 ============ */
  section("断言5 · 与 md §4 的 js 块逐字节一致");
  {
    const md = mdBlocks();
    ok(md.length === 9, "md 里抽出 9 个块（实测 " + md.length + "）");
    const srcBlocks = (spSrc.replace(/\r\n/g, "\n").match(/^const CH0[1-9] = \{[\s\S]*?^\};/gm) || []);
    ok(srcBlocks.length === 9, "源码里切出 9 个块");
    let diff = 0;
    for (let i = 0; i < 9; i++) {
      if (srcBlocks[i] !== md[i]) { diff++; console.log("  第 " + (i + 1) + " 章不一致：" + srcBlocks[i].length + " vs " + md[i].length); }
    }
    ok(diff === 0, "9 章正文与 md 逐字节一致（不一致 " + diff + " 章）");
  }

  /* ============ 断言 6（v178）：旧 8 章正文已删，新 9 章独立存放 ============ */
  section("断言6（v178）· 旧 8 章 CHAP_SCRIPTS / CHAP_ACTS 已移除");
  {
    ok(spSrc.indexOf("const CHAP_SCRIPTS = [") < 0, "CHAP_SCRIPTS 已从源码删除（旧 8 章正文）");
    ok(spSrc.indexOf("const CHAP_ACTS =") < 0, "CHAP_ACTS 已从源码删除（派生表）");
    ok(typeof S.CHAP_ACTS === "undefined", "Spirits.CHAP_ACTS 不再导出");
    ok(typeof S.chapActOf === "undefined", "Spirits.chapActOf 不再导出（悬空引用已清零）");
    // CHAPTERS 元数据保留：readChapter 仍复用它取章末事件标题（v178 判定：仍被活代码引用 → 保留）
    ok(S.CHAPTERS.length === 8, "CHAPTERS 元数据仍 8 条（readChapter 复用，未删）");
    ok((spSrc.match(/const MAIN_SCRIPTS = \[/g) || []).length === 1, "MAIN_SCRIPTS 只有一份（新 9 章独立存放）");
    ok(S.MAIN_SCRIPTS.length === 9 && S.MAIN_ACTS.length === 9, "新 9 章正文与剧本表完好（未受影响）");
  }

  /* ============ ch1 真跑一遍 ============ */
  section("ch1 真跑一遍（进章 → 台词 → 选项 → 选择 → 推进）");
  {
    // 7 只齐全，7 个行当各一只
    seedStore(["dignified", "scholar", "cool", "gentle", "lively", "mystery", "sweet"]);
    S.writeStory({});                      // 清掉上一轮的缓存（cast / mainTalk）
    const ctx = { dayNo: 999 };
    const st = S.mainChapterState(ctx);
    ok(st[0].unlocked === true, "MAIN_STORY_OPEN=true ⇒ 第 1 章解锁（need=" + st[0].need + "）");
    let r = S.mainTalkEnter(ctx, 0);
    ok(r && Array.isArray(r.added) && r.added.length > 0, "进章吐出台词（" + (r && r.added.length) + " 行）");
    ok(r.added.every((m) => m && m.text && !/\{(ta|call)\}/.test(m.text)), "台词里没有 {ta}/{call} 残留占位符");
    ok(r.added.every((m) => m.name !== undefined), "每行都有 name 字段（旁白/玩家为空串，角色为行当名）");
    const speakers = Array.from(new Set(r.added.filter((m) => m.name).map((m) => m.name)));
    ok(speakers.length >= 5, "ch1 开头出场了多个行当（" + speakers.join("、") + "）");
    // 一路选到底，跑到章末
    let guard = 0, choices = r.choices || [];
    while (choices.length && guard++ < 40) {
      r = S.mainTalkChoose(ctx, 0);
      choices = r.choices || [];
      if (r.ended) break;
    }
    ok(guard < 40, "ch1 能在 40 步内跑到章末（实际 " + guard + " 步）");
    ok(r.ended === true, "ch1 走到 ended");
    const read = S.mainReadMap();
    ok(!!(read[0] && read[0].at), "ch1 读完 → ww_story.mainChapters[0] 已记已读");
    ok(S.mainChapterState(ctx)[1].unlocked === true, "ch1 读完 ⇒ 第 2 章解锁（顺序锁生效）");
    ok(S.mainChapterState(ctx)[2].unlocked === false, "第 3 章仍未解锁（要先读完第 2 章）");
    // ★N2 自测抓到的真 bug：chapTalkChoose 内部 chapWalk 必须透传 actOf
    ok(/if \(!c\) return chapWalk\(item, rec, ctx, actOf\);/.test(spSrc) &&
       /const r = chapWalk\(item, rec, ctx, actOf\);/.test(spSrc),
      "★ chapTalkChoose 内部 chapWalk 透传 actOf（否则新 9 章选完第 1 个选项就推进停死）");
  }

  /* ============ 9 章都能跑到章末（分支全走 index 0） ============ */
  section("9 章都能跑到章末（每章都选第 1 个选项，直到 end）");
  {
    for (let ci = 0; ci < 9; ci++) {
      seedStore(ALL7_FULL);
      S.writeStory({});
      const ctx = { dayNo: 9999 };
      // 顺序锁：把前 ci 章标记已读以解锁第 ci+1 章
      const w = JSON.parse(h.store.getItem("ww_story") || "{}");
      w.mainChapters = {};
      for (let k = 0; k < ci; k++) w.mainChapters[k] = { at: Date.now() - 1000 };
      h.store.setItem("ww_story", JSON.stringify(w));
      let r = null, threw = null;
      try {
        r = S.mainTalkEnter(ctx, ci);
        let g = 0;
        while (r && !r.ended && g++ < 60) {
          if (!r.choices || !r.choices.length) break;
          r = S.mainTalkChoose(ctx, 0);
        }
        if (r && !r.ended && r.choices && r.choices.length) { r = null; }   // 没跑完
      } catch (e) { threw = e; }
      ok(!threw && r && r.ended === true, "第 " + (ci + 1) + " 章能跑到 ended" + (threw ? "（抛错：" + threw.message + "）" : ""));
    }
  }

  /* ============ 群像边界：1 / 2 / 3 / 7 只 ============ */
  section("群像边界 · 1 / 2 / 3 / 7 只沁灵分别跑 ch1 开头");
  const ALL7 = ALL7_FULL;
  const MAIN7 = S.CHAP_CAST_CFG.MAIN;
  // NPC 行当（门客 / 邻居 / 坛主…）：它们**不是玩家的沁灵**，没有对应头像 —— UI 用 📿 兜底。
  //   本测试只要求「7 个主行当」不空头像；NPC 落空是设计内行为（见 app.js mainCastThumb 的 📿 回落）。
  [[1], [2], [3], [7]].forEach(([n]) => {
    const pids = ALL7.slice(0, n);
    seedStore(pids);
    S.writeStory({});
    let threw = null, r = null, cast = null;
    try {
      cast = S.castOf({ force: true });
      r = S.mainTalkEnter({ dayNo: 999 }, 0);
    } catch (e) { threw = e; }
    ok(!threw, n + " 只 · 进章不抛错" + (threw ? "（" + threw.message + "）" : ""));
    ok(r && Array.isArray(r.added) && r.added.length > 0, n + " 只 · 有台词产出（" + (r ? r.added.length : 0) + " 行）");
    // ① 7 个**主**行当全部有人演（⛔ 不出现空头像）
    const missing = MAIN7.filter((p) => !(cast && cast[p] && cast[p].id));
    ok(missing.length === 0, n + " 只 · 7 个主行当全部解析到出演者（缺：" + (missing.join(",") || "无") + "）");
    // ② 7 个主行当名非空
    const badName = MAIN7.filter((p) => !(cast && cast[p] && String(cast[p].name || "").trim()));
    ok(badName.length === 0, n + " 只 · 7 个主行当名非空（空：" + (badName.join(",") || "无") + "）");
    // ③ 每一条**角色行**都有非空说话人（剧本写死的行当名；NPC 也算）
    const hasBlank = (r ? r.added : []).some((m) => m.w === "sp" && !String(m.name || "").trim());
    ok(!hasBlank, n + " 只 · 角色行没有空白说话人");
    // ④ {ta} / {call} 不残留
    ok(!(r ? r.added : []).some((m) => /\{(ta|call)\}/.test(m.text)), n + " 只 · 台词里没有 {ta}/{call} 残留");
    // ⑤ 主行当的 ps 头像一定能反查到在册沁灵（⛔ 不出现空头像）
    const ids = Object.keys(JSON.parse(h.store.getItem("ww_spirits") || "{}"));
    const badPs = [];
    (r ? r.added : []).forEach((m) => {
      const p = m.ps && m.ps[0];
      if (!p || MAIN7.indexOf(p) < 0) return;         // 只查主行当
      const c = cast && cast[p];
      if (!c || ids.indexOf(String(c.id)) < 0) badPs.push(p);
    });
    ok(badPs.length === 0, n + " 只 · 每个主行当的 ps 都能反查到在册沁灵的头像（落空：" + (badPs.join(",") || "无") + "）");
    const filled = MAIN7.filter((p) => cast && cast[p] && cast[p].fill === true).length;
    console.log("    · " + n + " 只 ⇒ 7 行当中轮转复用补齐 " + filled + " 个" + (filled ? "（小剧团一人分饰多角）" : "（本来就够）"));
  });
  // NPC 行当的兜底必须存在（app.js 里 📿 占位）
  ok(/mainCastThumb\(m\) \|\| '<span class="main-av">/.test(appSrc),
    "NPC 行当（门客/邻居/坛主）无头像时，UI 有 📿 占位兜底（⛔ 不出现空头像圈）");

  /* ============ 0 只：也不能崩（用行当名 + 📿 兜底照常播） ============ */
  section("群像边界 · 0 只沁灵（新用户刚注册，一只都还没有）");
  {
    seedStore([]);
    S.writeStory({});
    let threw = null, r = null;
    try { r = S.mainTalkEnter({ dayNo: 999 }, 0); } catch (e) { threw = e; }
    ok(!threw, "0 只 · 进章不抛错" + (threw ? "（" + threw.message + "）" : ""));
    ok(r && Array.isArray(r.added) && r.added.length > 0, "0 只 · 仍照常播（台词用剧本写死的行当名，靠 📿 兜底）");
    const cast0 = S.castOf({ force: true });
    ok(Object.keys(cast0 || {}).length === 0, "0 只 · 出场表为空（没有可选的人）");
    ok(!(r ? r.added : []).some((m) => m.w === "sp" && !String(m.name || "").trim()), "0 只 · 角色行仍有非空行当名（不空白）");
    ok(S.mainChapterState({ dayNo: 999 })[0].unlocked === true, "0 只 · 第 1 章仍解锁（天数恒 1 ≥ 锚点 1）");
  }

  /* ============ MAIN_STORY_OPEN 的半成品闸门 ============ */
  section("MAIN_STORY_OPEN · 关掉时首页入口必须整块隐藏");
  ok(spSrc.indexOf("const MAIN_STORY_OPEN = true;") >= 0, "当前为 true（9 章已装帧）");
  ok(/if \(Spirits\.MAIN_STORY_OPEN\) \{[\s\S]{0,900}?id="mainEntry"/.test(appSrc),
    "首页 #mainEntry 整块包在 if (Spirits.MAIN_STORY_OPEN) 里 —— 关掉时不会露出半成品卡片");
  // 所有「装帧中」文案必须都在 MAIN_STORY_OPEN 条件下（打开时一条都不渲染）
  {
    let bad = 0;
    const re = /装帧中/g; let m;
    while ((m = re.exec(appSrc))) {
      const before = appSrc.slice(Math.max(0, m.index - 260), m.index);
      if (before.indexOf("MAIN_STORY_OPEN") < 0) { bad++; console.log("  裸「装帧中」@ " + m.index); }
    }
    ok(bad === 0, "每处「装帧中」文案都挂在 MAIN_STORY_OPEN 条件上（打开时不会渲染出半成品）");
  }

  const passed = summary();
  process.exit(passed ? 0 : 1);
})();

function seedStore(pids) {
  const store = {};
  const NAMES = { dignified: "最老的那只", scholar: "记账的那只", cool: "不爱说话的那只", gentle: "安静的那只", lively: "最吵的那只", mystery: "知道点什么的", sweet: "最小的" };
  pids.forEach((p, i) => {
    const id = "s" + i;
    store[id] = { look: { pers: p }, persona: { id: p, name: NAMES[p] || p }, bond: 10 + i, stage: 1, imgUrl: "" };
  });
  h.store.setItem("ww_spirits", JSON.stringify(store));
}
