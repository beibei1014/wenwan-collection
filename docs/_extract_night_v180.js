/* ============================================================
 * docs/_extract_night_v180.js —— v180 批I · 夜话外部池**机械抽取器**
 * ------------------------------------------------------------
 * 输入：docs/v180-夜话试点-剧本.md（编剧唯一产出）
 * 输出：js/night-v180.js（**机械生成物**，CRLF）
 *
 * ⭐ 抽取规则（team-lead 裁定 · 围栏规则，⛔ 不用行号锚点）：
 *    扫全文 ```js 围栏块 → 保留 trim 后**以 `{` 开头**且**含 `nodes:`**的块。
 *    · §一 的模板是无语言标签的普通围栏 ⇒ 不入候选
 *    · §九 的外壳 `var NIGHT_V180 = {…}` 以 `var` 开头 ⇒ 不入候选
 *    · §五 的「5116 原句/定稿/备选」都是单行 `{ w:"B", … }` ⇒ 无 `nodes:` ⇒ 不入候选
 *    实测：13 个 ```js 围栏 → 恰好 **9** 个事件字面量。
 *    ⛔ 命中数 ≠ 9 ⇒ 报错退出（口径锁死，防编剧改稿悄悄多/少一条）。
 *
 * 用法： node docs/_extract_night_v180.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const MD = path.join(ROOT, "docs", "v180-夜话试点-剧本.md");
const OUT = path.join(ROOT, "js", "night-v180.js");
const VER = process.env.NIGHT_V180_VER || "v180-i2";
const UPD = process.env.NIGHT_V180_UPD || "2026-10-09";
const WANT = 9;

const raw = (() => {
  try { return fs.readFileSync(MD, "utf8").replace(/\r/g, ""); }
  catch (e) {
    console.error("⛔ 读不到源稿：" + MD);
    console.error("   （源 md 与仓库既有约定一致、未纳入 git 跟踪；请把编剧的稿子放到该路径后重跑。）");
    process.exit(1);
  }
})();
const lines = raw.split("\n");

/* ---------- 围栏扫描 ---------- */
const blocks = [];
let cur = null;
lines.forEach((L, i) => {
  const t = L.trim();
  if (/^```js$/.test(t)) { cur = { ln: i + 1, body: [] }; return; }
  if (cur && /^```$/.test(t)) { blocks.push(cur); cur = null; return; }
  if (cur) cur.body.push(L);
});

const evBlocks = blocks
  .map((b) => ({ ln: b.ln, body: b.body }))
  .filter((b) => {
    const t = b.body.join("\n").trim();
    return t.startsWith("{") && /nodes\s*:/.test(t);
  });

console.log("围栏块 " + blocks.length + " 个（均 ```js）-> 命中事件字面量 " + evBlocks.length + " 个（期望 " + WANT + "）");
if (evBlocks.length !== WANT) {
  console.error("⛔ 命中数 " + evBlocks.length + " ≠ " + WANT + " —— 编剧改稿后抽取规则失配，请人工复核 md 的 ```js 围栏。已中止，未写出文件。");
  process.exit(2);
}

/* ---------- 逐个求值 + 结构校验 ---------- */
const seen = {}, slots = {};
let bad = 0;
evBlocks.forEach((b) => {
  const txt = b.body.join("\n").trim();
  let o = null;
  try { o = vm.runInNewContext("(" + txt + ")", {}); }
  catch (e) { console.error("⛔ L" + b.ln + " 求值失败：" + e.message); bad++; return; }
  b.obj = o;

  if (!o.id) { console.error("⛔ L" + b.ln + " 缺 id"); bad++; return; }
  if (seen[o.id]) { console.error("⛔ id 重复：" + o.id); bad++; return; }
  seen[o.id] = 1;
  if (["family", "room", "duo"].indexOf(o.scope) < 0) { console.error("⛔ " + o.id + " scope 非法：" + o.scope); bad++; }
  if (o.roomSlot != null) {
    if (o.scope !== "room") { console.error("⛔ " + o.id + " 非 room 却带 roomSlot"); bad++; }
    else if (slots[o.roomSlot]) { console.error("⛔ roomSlot " + o.roomSlot + " 重复（" + slots[o.roomSlot] + " / " + o.id + "）"); bad++; }
    else slots[o.roomSlot] = o.id;
  }
  if (o.scope === "duo" && !(o.when && Array.isArray(o.when.pers) && o.when.pers.length === 2)) {
    console.error("⛔ duo 事件 " + o.id + " 的 when.pers 必须恰好 2 个（否则 duoPick 不生成双人群）");
    bad++;
  }
  const nn = o.nodes || {};
  if (!nn.start) { console.error("⛔ " + o.id + " 缺 start 节点"); bad++; }
  const endings = Object.keys(nn).filter((k) => nn[k] && nn[k].ending);
  if (endings.length !== 3) { console.error("⛔ " + o.id + " 结局数 " + endings.length + " ≠ 3"); bad++; }
});
if (bad) { console.error("⛔ 结构校验失败 " + bad + " 处 —— 已中止，未写出文件。"); process.exit(3); }
const slotKeys = Object.keys(slots).sort();
console.log("结构校验通过 ｜ 9 条 id 唯一 ｜ roomSlot 占用 = " + JSON.stringify(slotKeys));

/* ---------- 生成 js/night-v180.js ---------- */
function indentBody(body, pad) {
  const rows = body.slice();
  while (rows.length && !rows[0].trim()) rows.shift();
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  return rows.map((l) => (l.trim() ? pad + l.replace(/\s+$/, "") : "")).join("\n");
}
const evText = evBlocks.map((b) => indentBody(b.body, "      ")).join(",\n");

const HEADER = [
  "/* ============================================================",
  " * js/night-v180.js —— v180 批I · 夜话**外部事件池**（数据篇）",
  " * ------------------------------------------------------------",
  " * ⚠️ **机械生成物**：由 docs/_extract_night_v180.js 从",
  " *    docs/v180-夜话试点-剧本.md 抽取而来 —— ⛔ 不许手改本文件；",
  " *    改剧本请改 md 后重跑抽取器（围栏规则：```js 围栏 + 以 `{` 开头 + 含 `nodes:`）。",
  " *",
  " * 引擎（js/spirits.js 的 NIGHT_EVENT_POOL / nightPoolSync）在运行时把本文件",
  " * 的 events 并入夜话事件池；⛔ 新剧本一律写这里，不写进 spirits.js（剧本与代码解耦）。",
  " *",
  " * 结构：window.NIGHT_V180 = { version, updated, events: [ ... ] }",
  " *   每个 event 与 js/spirits.js 的 NIGHT_EVENTS 条目**同构**：",
  " *     id / icon / title / sub / scope(family|room|duo) / cast(2|3)",
  " *     star / after / repeat / duoTag / roomSlot",
  " *     when —— 16 键条件（唯一真源 js/spirits.js 的 WHEN_KEYS）",
  " *     nodes —— { <节点名>: { lines:[{w,t}], choices:[{t,go,tone}], ending:{key,name,text}, next } }",
  " *   w 取值：sys（系统提示）| A|B|C（主演槽位，由 castFor 按 cast 数分配）| me（玩家）",
  " *   t 里可用变量（见 js/spirits.js thVars）：",
  " *     {A}{B}{C} {A_title}{A_line}{A_trait}{A_pers}{A_bead} {star}{star_bead}",
  " *     {members}{total} {call} {days}{plays}{bond}{bondlv}{tixing} {grp}",
  " *",
  " * 房 间专属（roomSlot: 0|1|2|3）：**仅 scope:\"room\" 生效**。",
  " *   引擎按 roomSlotOf(thread.id) 把每个房间群分到一槽，只放行 roomSlot 相符的事件",
  " *   ⇒ 4 条专属事件各占一槽时，不同房间群聊到的是**不同内容**。",
  " *   ⛔ 不带 roomSlot 的 room 事件（老 r_thunder / r_joy / r_sad）仍全屋共享。",
  " *",
  " * 跨池说明：本池事件可 `after` 指向 a1–a4（family 讲古承接序章进度）：",
  " *   **a1–a4 本身就是 NIGHT_EVENTS 的条目**（spirits.js 里把 v160 的 NIGHT_ACTS",
  " *   包成 family 事件的那 4 条 legacy；NIGHT_ACTS 只是 v160 的孪生体）",
  " *   ⇒ `after` 是**同池依赖、同一张 done 表**，非跨池。",
  " *",
  " * 纪律（与全书同口径）：",
  " *   ⛔ 不写死对玩家的称呼 —— 一律 {call}（结契前「你」/ 结契后「主人」/ 升档用名字）",
  " *   ⛔ 不写死同伴姓名 —— 一律 {A}/{B}/{C}",
  " *   ⛔ 物化语域清零 —— 珠子 / 柜子 / 把玩 / 盘玩 / 包浆 / 越盘越值钱 / 摆件 / 收纳 / 它",
  " *   ⛔ 不碰 ww_spirits / spirit_store 键名、不碰 hashStr",
  " *   ⛔ O(n) 单遍：事件池只做常数级并集，禁止两两枚举",
  " * ============================================================ */",
].join("\n");

const out = [
  HEADER,
  "(function (global) {",
  '  "use strict";',
  "",
  "  var NIGHT_V180 = {",
  '    version: "' + VER + '",',
  '    updated: "' + UPD + '",',
  "    events: [",
  evText,
  "    ],",
  "  };",
  "",
  '  if (typeof module !== "undefined" && module.exports) module.exports = NIGHT_V180;',
  "  global.NIGHT_V180 = NIGHT_V180;",
  '})(typeof window !== "undefined" ? window : globalThis);',
  "",
].join("\n");

fs.writeFileSync(OUT, out.replace(/\n/g, "\r\n"), "utf8");

/* ---------- 报告 ---------- */
console.log("\n抽取完成 → js/night-v180.js（" + VER + "）");
const order = evBlocks.map((b) => b.obj);
order.forEach((o) => {
  const nn = Object.keys(o.nodes);
  const ends = nn.filter((k) => o.nodes[k] && o.nodes[k].ending).map((k) => o.nodes[k].ending.key);
  console.log("  " + o.id + " ｜ " + o.scope + " ｜ cast " + o.cast +
    " ｜ roomSlot " + (o.roomSlot === undefined ? "-" : o.roomSlot) +
    " ｜ after " + (o.after || "-") + " ｜ when " + JSON.stringify(o.when || {}) +
    " ｜ 节点 " + nn.length + " ｜ 结局 " + JSON.stringify(ends));
});
const byScope = {};
order.forEach((o) => { byScope[o.scope] = (byScope[o.scope] || 0) + 1; });
console.log("  合计 " + order.length + " 条 ｜ " + JSON.stringify(byScope) + " ｜ roomSlot 占 " + JSON.stringify(slotKeys));
