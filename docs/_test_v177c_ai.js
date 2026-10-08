/* ============================================================
 * _test_v177c_ai.js · V177c「AI 台词落库前物化拦截」自测
 * ------------------------------------------------------------
 * 背景（用户实测抓到，原话「你还说改完了」）：
 *   AI 日记里写出「盘我盘我，不然我要滚走啦！」「她摸摸我的圆耳坠」——
 *   sys prompt 里已有世界观禁令，但①没点名「自称句式」②返回后无拦截 ⇒ 直接落库。
 *   V177c 补三层：①prompt 点名禁句 → ②返回命中词表 ⇒ 换说法重试一次 → ③仍命中 ⇒ 丢弃走本地兜底。
 *
 * 覆盖：
 *   §1 hasObjectifiedText 词表正反例（真函数在 vm 里跑，不是抄一遍正则）
 *   §2 5 处 AI 生成 prompt 含新禁令句 + 3 处【重申】句（源码扫描）
 *   §3 diaryWrite 拦截链（mock aiChat：脏→净 / 脏→脏→兜底 / 干净只调一次 / 空兜底）
 *   §4 letter · chat 同款拦截链与各自兜底（localLetter / localChat）
 *   §5 导出块含 hasObjectifiedText / OBJ_RE + 本地兜底模板本身必须干净
 *
 * 用法：node docs/_test_v177c_ai.js
 *
 * 负向对照（🔴 铆定显式 commit d56db34，⛔ 绝不用 git show HEAD）：
 *   git worktree add /tmp/_base d56db34
 *   cp /tmp/_base/js/spirits.js docs/_v177c_base_spirits.js
 *   SPIRITS_SRC=docs/_v177c_base_spirits.js node docs/_test_v177c_ai.js   → 必须 FAIL
 *   rm docs/_v177c_base_spirits.js && git worktree remove /tmp/_base
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const H = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const SPIRITS_SRC = process.env.SPIRITS_SRC || "js/spirits.js";
const SRC = fs.readFileSync(path.join(ROOT, SPIRITS_SRC), "utf8").replace(/\r/g, "");

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) { PASS++; console.log("  ✓ " + m); } else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
// 基线对照时 hasObjectifiedText / 【重申】句根本不存在 —— 捕获成 FAIL，不允许抛异常中断整轮
function safe(fn) { try { return fn(); } catch (e) { return { __err: String((e && e.message) || e) }; } }
function isErr(v) { return !!v && typeof v === "object" && "__err" in v; }

/* ---------- 沙箱：把 fetch 换成可控的假 AI（ aiChat → textChat → fetch ） ---------- */
function newFakeAI(replies) {
  const c = H.makeContext();
  c.store.setItem("ww_dskey", "test-key");      // ⇒ getAiKey() 为真，才走 AI 分支
  const calls = [];
  c.sandbox.fetch = function (url, opt) {
    const b = JSON.parse(opt.body);
    const sys = ((b.messages || []).find((m) => m.role === "system") || {}).content || "";
    const reply = replies[Math.min(calls.length, replies.length - 1)];
    calls.push({ sys: sys, maxTokens: b.max_tokens });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: reply } }] }),
    });
  };
  H.loadFile(c.ctx, SPIRITS_SRC);
  return { S: c.sandbox.Spirits, calls: calls };
}

/* ---------- 取某个函数签名之后的源码窗口（断言 prompt 真写了禁令） ---------- */
function region(sig, span) {
  const i = SRC.indexOf(sig);
  if (i < 0) return "";
  const j = SRC.indexOf("\n  function ", i + 1), k = SRC.indexOf("\n  async function ", i + 1);
  const ends = [i + (span || 3000), j, k].filter((n) => n > i);
  return SRC.slice(i, Math.min.apply(null, ends));
}

const BAN_A = "这类把自身当物件的话";
const BAN_B = "不许出现「越盘越」「包浆」";
const RESTATE = "⛔【重申】";

const OBJ_1 = "盘我盘我，越盘越亮哦~今天主人把我摸了又摸，还说包浆越来越好看。";
const OBJ_2 = "她摸摸我的圆耳坠，说我越盘越亮，主人最喜欢捏我了。";
const CLEAN = "今天屋子里很安静，我把窗台上那点阳光挪到身边，坐着看了半天云，觉得日子慢下来也不错。";

const ITEM = { id: "s1", name: "一串", color: "white", softness: "soft", beadShape: "圆珠" };
const PERSONA = { name: "小星", title: "窗边的小星", traits: ["安静"], line: "嗯。" };
const newRec = () => ({ persona: Object.assign({}, PERSONA), stage: 2, diary: [] });
const newSpirit = () => ({ id: "s1", item: ITEM, persona: Object.assign({}, PERSONA), idleDays: 2 });
const SPIRITS2 = () => ([
  { item: { id: "a", name: "串甲", color: "white", softness: "soft" }, persona: { name: "小星", title: "星星", traits: ["静"], line: "嗯。" } },
  { item: { id: "b", name: "串乙", color: "green", softness: "slight" }, persona: { name: "阿七", title: "七七", traits: ["皮"], line: "嘿嘿。" } },
]);
const jlines = (arr) => JSON.stringify({ lines: arr });
/* 统一取值：基线（改动前）没有 hasObjectifiedText ⇒ 返回哨兵 "__MISSING__"
   ⇒ 断言「=== false」自然变红，且 ⛔ 不会因为 is not a function 把整轮跑崩（负向对照要能跑完） */
function ho(S, s) {
  return (S && typeof S.hasObjectifiedText === "function") ? S.hasObjectifiedText(s) : "__MISSING__";
}

/* ================= §1 词表正反例（真函数） ================= */
(async () => {
  section("§1 hasObjectifiedText · 词表正例（必须命中）");
  const base = newFakeAI([CLEAN]);
  const real = base.S.hasObjectifiedText;
  ok(typeof real === "function", "hasObjectifiedText 已导出且是函数（否则 §1 全组无意义）");
  // 基线对照时不存在 ⇒ 用「永远不拦截」的替身继续跑，让后续断言自然变红（⛔ 不许提前 return 收场）
  const F1 = (typeof real === "function") ? real : function () { return false; };

  const POS = [
    ["用户截图原句·口头禅A", "盘我盘我，越盘越亮哦~"],
    ["用户截图原句·口头禅B", "盘我一天，包浆给你看！"],
    ["用户截图原句·日记", "盘我盘我，不然我要滚走啦！"],
    ["她摸摸我的圆耳坠", "她摸摸我的圆耳坠"],
    ["主人最喜欢捏我了", "这天主人来坐了一会儿，说说笑笑，主要是主人最喜欢捏我了。"],
    ["把我晾在一边", "把我晾在一边，自己去玩别的，我不高兴。"],
    ["装睡（物件处境）", "主人一来我就装睡。"],
    ["把玩视角", "被人把玩的一天结束了。"],
  ];
  POS.forEach(([label, s]) => ok(F1(s) === true, "命中 ⇒ " + label));

  section("§1b 词表反例（养护机制用语严禁误杀）");
  [
    ["养护机制·盘这串", "盘这串手串的时候别太用力。"],
    ["养护机制·今天盘了三十下", "今天盘了三十下，手都酸了。"],
    ["养护机制·盘玩", "这串慢慢盘玩，颜色会润。"],
    ["养护机制·挂瓷/上手秋itas none ⇒ 无把玩词", "这串终于挂瓷了，主人自己也很高兴。"],
    ["日常台词·无任何把玩词", CLEAN],
    ["含「摸」但不接「我」", "主人在桌上摸了摸那些珠子，我没出声。"],
    ["空串", ""],
    ["undefined", undefined],
    ["null", null],
  ].forEach(([label, s]) => ok(F1(s) === false, "不命中 ⇒ " + label));

  /* ================= §2 prompt 补强 ================= */
  section("§2 四处 AI 生成 prompt 含新禁令句（源码扫描；v178：persona 已不再产口头禅，移出该表）");
  const SITES = [
    ["diaryWrite（日记）", "async function diaryWrite(item, rec, ap, ctx)"],
    ["chat（夜话群戏）", "async function chat(spirits)"],
    ["letter（来信）", "async function letter(spirit, userName)"],
    ["personaZh（人物设定卡）", "async function personaZh(item, ap, persona, stage, days, plays, force)"],
  ];
  SITES.forEach(([label, sig]) => {
    const r = region(sig);
    ok(!!r && r.indexOf(BAN_A) >= 0 && r.indexOf(BAN_B) >= 0,
      label + "：sys 含「……这类把自身当物件的话」+「不许出现「越盘越」「包浆」」");
  });

  section("§2b 落库拦截的三条【重申】句（各入口重试一次）");
  [["diaryWrite", "async function diaryWrite(item, rec, ap, ctx)"],
    ["chat", "async function chat(spirits)"],
    ["letter", "async function letter(spirit, userName)"]].forEach(([label, sig]) => {
    const r = region(sig);
    ok(r.indexOf(RESTATE) >= 0 && r.indexOf(BAN_B) >= 0, label + "：含重试用的「⛔【重申】……不许出现「越盘越」「包浆」」");
  });

  section("§2c 既有去物化约束未被替换（不许改坏）");
  ok(region("async function diaryWrite(item, rec, ap, ctx)").indexOf("严禁物件视角") >= 0, "diaryWrite 保留「⛔ 严禁物件视角」");
  ok(region("async function persona(item, force)").indexOf("严禁物件视角") >= 0, "persona 保留「⛔ 严禁物件视角」（v178：口头禅已移除，世界观禁令仍保留）");

  /* ================= §3 diaryWrite 拦截链 ================= */
  section("§3 diaryWrite 拦截链（ower lines mock AI）");
  {
    const t = newFakeAI([OBJ_1, CLEAN]);
    const rec = newRec();
    await t.S.ensureDiary(ITEM, rec, {}, { dayNo: 3 });
    const txt = (rec.diary[rec.diary.length - 1] || {}).text || "";
    ok(t.calls.length === 2, "脏→净：共 2 次 AI 调用（首次 + 重试一次，⛔ 不多调）");
    ok(txt.indexOf(CLEAN) >= 0, "脏→净：最终采纳第二次的干净句");
    ok(ho(t.S, txt) === false, "脏→净：落库文本不含物化词");
    ok(t.calls[1] && t.calls[1].sys.indexOf(BAN_B) >= 0, "脏→净：重试那次的系统提示带上了重申禁令");
  }
  {
    const t = newFakeAI([OBJ_1, OBJ_2]);
    const rec = newRec();
    await t.S.ensureDiary(ITEM, rec, {}, { dayNo: 3 });
    const txt = (rec.diary[rec.diary.length - 1] || {}).text || "";
    ok(t.calls.length === 2, "脏→脏：也只重试一次（共 2 次调用，成本控制）");
    ok(txt.indexOf("盘我") < 0 && ho(t.S, txt) === false, "脏→脏：AI 原文被丢弃，未落库");
    ok(/^第 3 天 · /.test(txt) && txt.indexOf("\n") > 0, "脏→脏：走 diaryLocal 兜底（「第 N 天 · 阶段名」+ 正文）");
  }
  {
    const t = newFakeAI([CLEAN]);
    const rec = newRec();
    await t.S.ensureDiary(ITEM, rec, {}, { dayNo: 3 });
    ok(t.calls.length === 1, "干净：只调用 1 次（🔴 不许无谓重试，省 token）");
    ok(((rec.diary[rec.diary.length - 1] || {}).text || "").indexOf(CLEAN) >= 0, "干净：原样落库");
  }
  {
    const t = newFakeAI([""]);
    const rec = newRec();
    await t.S.ensureDiary(ITEM, rec, {}, { dayNo: 3 });
    const txt = (rec.diary[rec.diary.length - 1] || {}).text || "";
    ok(t.calls.length === 1 && /^第 3 天 · /.test(txt), "空返回：走 diaryLocal 兜底（既有分支未被改坏）");
  }

  /* ================= §4 letter / chat 拦截链 ================= */
  section("§4 letter 拦截链（兜底 = localLetter）");
  {
    const t = newFakeAI([OBJ_1, CLEAN]);
    const r = await t.S.letter(newSpirit(), "主人");
    ok(t.calls.length === 2 && String(r).indexOf(CLEAN) >= 0, "脏→净：采纳第二次干净来信");
  }
  {
    const t = newFakeAI([OBJ_1, OBJ_2]);
    const r = await t.S.letter(newSpirit(), "主人");
    ok(t.calls.length === 2 && ho(t.S, r) === false, "脏→脏：AI 来信被丢弃");
    ok(String(r).indexOf("—— 你的") >= 0, "脏→脏：走 localLetter 本地来信模板兜底");
  }

  section("§4b chat 拦截链（兜底 = localChat）");
  {
    const t = newFakeAI([jlines([{ who: "小星", text: "盘我盘我，越盘越亮哦~" }]),
      jlines([{ who: "小星", text: "今天谁也不许偷懒。" }, { who: "阿七", text: "我昨天就看见你发呆了。" }])]);
    const r = await t.S.chat(SPIRITS2());
    ok(t.calls.length === 2 && Array.isArray(r) && r.length === 2 && r[0].text === "今天谁也不许偷懒。",
      "脏→净：采纳第二次干净小剧场");
  }
  {
    const t = newFakeAI([jlines([{ who: "小星", text: "盘我盘我，不然我要滚走啦！" }]),
      jlines([{ who: "阿七", text: "来摸摸我，包浆给你看。" }])]);
    const r = await t.S.chat(SPIRITS2());
    ok(t.calls.length === 2 && Array.isArray(r) && r.length >= 4, "脏→脏：走 localChat 兜底（返回 ≥4 行模板对话）");
    ok(Array.isArray(r) && r.length >= 4 && r.every((l) => ho(t.S, l.text) === false),
      "脏→脏：兜底模板句本身不含物化词");
  }

  /* ================= §5 导出 + 兜底模板干净 ================= */
  section("§5 导出块 + 本地兜底模板");
  {
    const t = newFakeAI([CLEAN]);
    ok(typeof t.S.hasObjectifiedText === "function", "导出 hasObjectifiedText（函数）");
    // ⚠️ vm 沙箱跨 realm ⇒ 不能用 instanceof RegExp（会假红），按内部槽判定
    ok(Object.prototype.toString.call(t.S.OBJ_RE) === "[object RegExp]" && /盘我/.test(new RegExp(t.S.OBJ_RE.source)),
      "导出 OBJ_RE（RegExp，供 app.js 侧复用同一判据；含「盘我」词）");
    ok(!/\bhasObjectifiedText\b/.test("") && SRC.indexOf("OBJ_RE, hasObjectifiedText,") >= 0,
      "源码导出块含「OBJ_RE, hasObjectifiedText,」");
    const local = t.S.diaryLocal(ITEM, newRec(), {}, { dayNo: 1 });
    // §5 是「回归护栏」性质：本地模板在改动前后都该干净 ⇒ 判定缺失时退回 §1 的替身，不许假红
    const clean = (S, s) => (typeof S.hasObjectifiedText === "function") ? S.hasObjectifiedText(s) : F1(s);
    ok(clean(t.S, local) === false, "diaryLocal 本地模板本身不含物化词");
    ok(clean(t.S, t.S.localLetter(newSpirit(), "主人")) === false, "localLetter 本地模板本身不含物化词");
    ok(t.S.localChat(SPIRITS2()).every((l) => clean(t.S, l.text) === false), "localChat 本地模板本身不含物化词");
    ok(!isErr(safe(() => (t.S.hasObjectifiedText(null), true))), "hasObjectifiedText(null/undefined) 不抛异常");
  }

  finish();
})();

function finish() {
  console.log("\n----------------------------------------");
  const total = PASS + FAIL;
  console.log("断言总数 " + total + " ｜ 通过 " + PASS + " ｜ 失败 " + FAIL);
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  console.log(FAIL ? "⇒ V177c 拦截未落地（或正在跑基线 —— 基线必须红）" : "⇒ 全绿：V177c 拦截链已落地");
  process.exit(FAIL ? 1 : 0);
}
