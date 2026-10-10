/* ============================================================
 * _test_v180_nameoutlet.js · V180 · 名字出口全量收敛（v180-NAME-OUTLET）
 * ------------------------------------------------------------
 * 用户原话：「打包的名字只有我自己改的名字是对的，你给我改的名字都没改到，
 *            怎么还有以前的老名字，你能不能全部检查了替换好？」
 * 现象：导出 zip 里的文件名仍是旧 AI 名（茶茶），而详情页已显示正式名（江冽茗）。
 * 根因：各「名字出口」各写一遍回落链（rec.name → persona.name → item.name），
 *       **绕过了身份表** ⇒ 身份表给的正式姓名进不去 文件名 / img alt / 取名去重。
 * 修法：
 *   ① 新增 spiritDisplayName(item, rec, store) —— 显示位统一走 nameOf 四级口径；
 *   ② exportAllSpiritImages 的命名改走 spiritItemById + nameOf（取不到 item 才回落老链路）；
 *   ③ namingUsedNow（取名去重）把身份表解析后的正式名并进「已用」集合（只并集，不删项）；
 *   ④ bookArtOf 立绘反查（名字 ⇒ 立绘）补一次 nameOf 兜底，别把人漏成无立绘。
 *   ⛔ 不动 ww_spirits / spirit_store / hashStr；⛔ 不做数据迁移（存量「茶茶」不迁移）。
 *   ⛔ 不动 spirits.js 立绘外观缓存 key —— 动了全部立绘失效重出图，直接烧额度。
 *   ⛔ 不动出图 prompt 上下文 / 老夜话默认台词 —— 它们不是显示出口（只读判定）。
 *
 * 覆盖：
 *   A · 静态：导出命名走身份表；旧裸回落链退居兜底
 *   B · 静态：spiritDisplayName 接线（签名 / alt / 透传 / 位置参数）
 *   C · 静态：取名去重并集 + 立绘反查兜底 + ⛔ 禁改点
 *   D · 运行期：nameOf 四级口径（手串名 / 旧别名 / 玩家改名优先 / 规格命名 / 未知回落）
 *   E · 运行期：spiritDisplayName（单条视图恒等 / 永不空 / 无 nameOf 时回落）
 *   F · 端到端：真跑导出 ⇒ zip 内文件名是正式名（江冽茗），⛔ 不含旧名（茶茶）
 *       ※ F 独立于 E 运行，保证负向对照能真正打到「导出命名」上
 *   G · 负向对照：铆定 45bcebb（⛔ 绝不写 HEAD）⇒ 必须红
 *
 * 用法： node docs/_test_v180_nameoutlet.js
 * 负向： APP_SRC_FILE=docs/_tmp/_pre_v180name_app.js node docs/_test_v180_nameoutlet.js ⇒ 必须 FAIL
 * 快照怎么来的（任何人可重建，⛔ 不依赖本地 HEAD）：
 *        git show 45bcebb:js/app.js > docs/_tmp/_pre_v180name_app.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const SPIRITS_FILE = process.env.SPIRITS_SRC_FILE ? path.resolve(process.env.SPIRITS_SRC_FILE) : path.join(ROOT, "js/spirits.js");
const appSrc = fs.readFileSync(APP_FILE, "utf8");
const spiritsSrc = fs.readFileSync(SPIRITS_FILE, "utf8");
console.log("app 源码    ：" + APP_FILE);
console.log("spirits 源码：" + SPIRITS_FILE);

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function done() {
  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}

/* ---------- 源码抽函数（大括号配对，跳过字符串 / 注释 / 正则字面量） ---------- */
const REGEX_PREV = "(,=:[!&|?{};+-*%~^<>";
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(appSrc);
  if (!m) return null;
  const start = /async\s+$/.test(appSrc.slice(Math.max(0, m.index - 6), m.index)) ? m.index - 6 : m.index;
  let i = appSrc.indexOf("(", m.index), pd = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === "(") pd++;
    else if (appSrc[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < appSrc.length && appSrc[i] !== "{") i++;
  let depth = 0, last = "";
  for (; i < appSrc.length; i++) {
    const ch = appSrc[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < appSrc.length) { if (appSrc[i] === "\\") { i += 2; continue; } if (appSrc[i] === q) break; i++; }
      last = "x"; continue;
    }
    if (ch === "/") {
      if (appSrc[i + 1] === "/") { while (i < appSrc.length && appSrc[i] !== "\n") i++; continue; }
      if (appSrc[i + 1] === "*") { const e = appSrc.indexOf("*/", i); i = e < 0 ? appSrc.length : e + 1; continue; }
      // ⚠️ 正则里可能带引号（/[\\/:*?"<>|]/g），不整段跳过就会把后面代码当字符串吞掉
      if (last === "" || REGEX_PREV.indexOf(last) >= 0) {
        i++;
        let inCls = false;
        while (i < appSrc.length) {
          const c = appSrc[i];
          if (c === "\\") { i += 2; continue; }
          if (c === "[") { inCls = true; i++; continue; }
          if (c === "]") { inCls = false; i++; continue; }
          if (c === "/" && !inCls) break;
          i++;
        }
        last = "x"; continue;
      }
      last = ch; continue;
    }
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") last = ch;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return appSrc.slice(start, i);
}
function extractConstLine(name) {
  const m = new RegExp("const\\s+" + name + "\\s*=[^;]*;").exec(appSrc);
  return m ? m[0] : null;
}
function sliceArrayVar(name) {
  const i = appSrc.indexOf("var " + name + " = [");
  if (i < 0) return null;
  const j = appSrc.indexOf("\n  ];", i);
  return j < 0 ? null : appSrc.slice(i, j + 5);
}

/* ============================================================
 * A · 静态：导出命名走身份表
 * ============================================================ */
section("A · 静态：导出 zip 文件名走身份表");
const fnExport = extractFn("exportAllSpiritImages") || "";
ok(fnExport.length > 500, "exportAllSpiritImages 仍在（⛔ 不许改名 / 删）");
ok(/spiritItemById\(id\)/.test(fnExport), "导出命名先按 id 取 item（spiritItemById(id)）");
ok(/nameOf\(itm,\s*store\)/.test(fnExport), "取到 item ⇒ 走 nameOf(itm, store) 四级口径");
ok(/typeof\s+spiritItemById\s*===\s*"function"/.test(fnExport), "取不到（抽函数单测 / 串已不在收藏里）时守卫回落");
ok(/exportSafeName\(itm\s*\?/.test(fnExport), "exportSafeName 仍包在最外层（文件名净化未变）");
// ⛔ 旧裸回落链不再是唯一路径（保留为兜底，但必须有 nameOf 分支在它前面）
const iName = fnExport.indexOf("nameOf(itm");
const iBare = fnExport.indexOf("r.name || (r.persona && r.persona.name)");
ok(iName > 0 && iBare > iName, "⛔ 裸回落链退居兜底（在 nameOf 分支之后）");
// ⛔ 命名规则与收集范围不许缩水
ok(appSrc.indexOf('const EXPORT_STAGE_ZH = ["凝形", "开窍", "蜕形", "化形"]') > 0, "⛔ EXPORT_STAGE_ZH 命名规则未改");
ok(fnExport.indexOf('tag("立绘")') > 0 && fnExport.indexOf('tag("进阶CG")') > 0, "⛔ 立绘 / 进阶CG 两类仍在收集");
ok(fnExport.indexOf('tag("旧立绘"') > 0 && fnExport.indexOf('tag("相册_"') > 0 && fnExport.indexOf('tag("历史CG"') > 0,
  "⛔ 旧立绘 / 相册 / 历史CG 收集范围未缩水");
ok(/nm \+ "_节令CG_"/.test(fnExport), "⛔ 节令 CG 收集未缩水");

/* ============================================================
 * B · 静态：spiritDisplayName 接线
 * ============================================================ */
section("B · 静态：spiritDisplayName 接线（显示位统一出口）");
const fnDisp = extractFn("spiritDisplayName") || "";
ok(fnDisp.length > 80, "spiritDisplayName 已落地");
ok(/nameOf\(item,/.test(fnDisp), "内部调 nameOf（四级口径唯一真源）");
ok(/Spirits\.load\(\)/.test(fnDisp), "拿不到 rec / store 时兜底 load 一次");
ok(/\{ \[item\.id\]: rec \}/.test(fnDisp), "优先用调用方手里的 rec 组单条 store（⛔ 不逐个 load 解析 JSON）");
ok(/return \(rec && rec\.persona && rec\.persona\.name\)/.test(fnDisp), "⛔ 取不到 ⇒ 回落原链路（绝不返回空串）");
// 签名：store 必须挂在最后
ok(/function spiritImgHtml\(item, rec, size, cls, extraStyle, face, store\)/.test(appSrc),
  "spiritImgHtml 第 7 位是 store（⛔ 不许插到中间，会串位）");
ok(/function spiritThumbHtml\(item, rec, size, store\)/.test(appSrc), "spiritThumbHtml 第 4 位是 store");
ok(/function spiritThumbCgHtml\(item, rec, size, store\)/.test(appSrc), "spiritThumbCgHtml 第 4 位是 store");
// alt 走 spiritDisplayName
const fnImg = extractFn("spiritImgHtml") || "";
const fnThumb = extractFn("spiritThumbCgHtml") || "";
ok(/alt="' \+ esc\(spiritDisplayName\(item, rec, store\)\) \+ '"/.test(fnImg), "立绘 <img alt> 走 spiritDisplayName");
ok(!/alt="' \+ esc\(\(rec && rec\.persona && rec\.persona\.name\)/.test(fnImg), "⛔ 立绘 alt 的旧裸 persona.name 写法已消除");
ok(/const alt = spiritDisplayName\(item, rec, store\);/.test(fnThumb), "CG 缩略图 alt 走 spiritDisplayName");
// 透传
ok(/spiritImgHtml\(item, rec, size, "spirit-img", extra, !ok, store\)/.test(appSrc), "spiritThumbHtml 把 store 透传给 spiritImgHtml");
ok(/return spiritThumbHtml\(item, rec, size, store\);/.test(appSrc), "spiritThumbCgHtml 无 CG 时把 store 透传下去");
ok(/spiritThumbCgHtml\(it, rec, 96, store\)/.test(appSrc), "沁灵页卡片缩略图传了 store");
// 🔴 位置参数：详情页那行曾被写成第 5 位（extraStyle）⇒ 样式属性变 ;[object Object]
ok(/spiritImgHtml\(it, rec, 240, "spirit-img big", null, false, store\)/.test(appSrc),
  "详情页立绘：store 落在第 7 位");
ok(appSrc.indexOf('spiritImgHtml(it, rec, 240, "spirit-img big", store)') < 0,
  "⛔ store 误落到 extraStyle 的写法已消除（否则 style 会被写成 ;[object Object]）");

/* ============================================================
 * C · 静态：其余名字出口 + 禁改点
 * ============================================================ */
section("C · 静态：取名去重并集 / 立绘反查兜底 / ⛔ 禁改点");
const fnUsed = extractFn("namingUsedNow") || "";
ok(fnUsed.length > 100, "namingUsedNow 仍在");
ok(/out\.names\.push\(String\(nm2\)\)/.test(fnUsed), "取名去重把身份表正式名并进「已用」集合");
ok(/nameOf\(itm, s\)/.test(fnUsed), "并集用的是 nameOf（与显示位同源）");
ok(fnUsed.indexOf("out.names.push(String(nm))") > 0, "⛔ 只做并集 —— 既有项一个没删");
const fnLookup = extractFn("bookArtOf") || "";
ok(fnLookup.indexOf("nameOf(it, store)") > 0, "立绘反查（名字 ⇒ 立绘）补了 nameOf 兜底（按规格取名的人不漏成无立绘）");
// ⛔ 禁改点：动了就烧额度 / 改世界设定
ok(spiritsSrc.indexOf('"v154|" + (ap.gender || "") + "|" + ap.hair + "|" + ap.eyes + "|" + ap.acc') > 0,
  "⛔ spirits.js 立绘外观缓存 key 未动（动了全部立绘失效重出图）");
const dispCount = appSrc.split("spiritDisplayName").length - 1;
ok(dispCount >= 3, "spiritDisplayName = 1 处定义 + 至少 2 处调用（实测 " + dispCount + " 处，⛔ 不是死代码）");
// ⛔ 改名入口仍是关闭的死分支（本就该关，别顺手"修好"）
ok(/var NAMING_SPEC = \{ renameEnabled: false \};/.test(appSrc), "⛔ 改名入口 NAMING_SPEC.renameEnabled 仍为 false");

/* ============================================================
 * D~F · 运行期真跑
 * ============================================================ */
const NEED_CORE = ["identityKeysOf", "spiritIdentityOf", "nameOf"];
const MISSING_CORE = NEED_CORE.filter((n) => !extractFn(n));
const hasTable = !!sliceArrayVar("SPIRIT_IDENTITIES");
const hasDisp = !!extractFn("spiritDisplayName");
const coreDone = MISSING_CORE.length === 0 && hasTable;

(async () => {
/* ---------- D · nameOf 四级口径 ---------- */
section("D · 运行期：nameOf 四级口径");
if (!coreDone) {
  ok(false, "名字核心缺失：" + (MISSING_CORE.join(",") || "SPIRIT_IDENTITIES") + " ⇒ D~F 段无法真跑");
} else {
  const coreSrc = [
    sliceArrayVar("SPIRIT_IDENTITIES"),
    extractFn("identityKeysOf"), extractFn("spiritIdentityOf"), extractFn("nameOf"),
  ].join("\n");
  function mkCore(store) {
    const c = vm.createContext({ console: console, JSON: JSON, Math: Math, String: String, Number: Number,
      Array: Array, Object: Object, Error: Error, Spirits: { load: () => store } });
    vm.runInContext(coreSrc + "\nthis.__nameOf = nameOf;", c);
    return c;
  }
  let store = { a: {} };
  let c = mkCore(store);
  ok(c.__nameOf({ id: "a", name: "冰红茶" }, store) === "江冽茗", "D1 手串名「冰红茶」⇒ 江冽茗");
  ok(c.__nameOf({ id: "a", name: "黄金算盘" }, store) === "萧景筹", "D1 手串名「黄金算盘」⇒ 萧景筹");
  ok(c.__nameOf({ id: "a", name: "柿柿如意" }, store) === "楚柿遥", "D1 手串名「柿柿如意」⇒ 楚柿遥");

  store = { a: { persona: { name: "茶茶" } } };
  c = mkCore(store);
  ok(c.__nameOf({ id: "a", name: "冰红茶" }, store) === "江冽茗", "D2 旧 AI 名「茶茶」经手串名反查 ⇒ 江冽茗");
  ok(c.__nameOf({ id: "a", name: "冰红茶" }, store) !== "茶茶", "D2 ⛔ 旧 AI 名不再泄漏");

  store = { a: { name: "多多牛", nameEdited: true } };
  c = mkCore(store);
  ok(c.__nameOf({ id: "a", name: "多多牛" }, store) === "多多牛", "D3 rec.nameEdited ⇒ 尊重玩家自定名（⛔ 不被身份表覆盖）");

  store = { a: { persona: { name: "无名氏" }, naming: { name: "沐云阶" } } };
  c = mkCore(store);
  ok(c.__nameOf({ id: "a", name: "某串" }, store) === "沐云阶", "D4 rec.naming.name ⇒ 规格命名");

  store = { a: {} };
  c = mkCore(store);
  ok(c.__nameOf({ id: "a", name: "紫砂壶" }, store) === "紫砂壶", "D5 未登记手串 ⇒ 回落自身名");
  ok(c.__nameOf({ id: "a" }, store) === "沁灵", "D5 全空 ⇒ 兜底「沁灵」");
  ok(c.__nameOf({ id: "zzz", name: "冰红茶" }, {}) === "江冽茗", "D5 串不在 store 里时仍能按串名反查（不炸）");
}

/* ---------- E · spiritDisplayName 不变量 ---------- */
section("E · 运行期：spiritDisplayName 不变量");
if (!coreDone || !hasDisp) {
  ok(false, "spiritDisplayName 缺失（或核心缺失）⇒ E 段无法真跑");
} else {
  const dispSrc = [
    sliceArrayVar("SPIRIT_IDENTITIES"),
    extractFn("identityKeysOf"), extractFn("spiritIdentityOf"), extractFn("nameOf"), fnDisp,
  ].join("\n");
  const store = { a: { persona: { name: "茶茶" } }, b: { name: "多多牛", nameEdited: true } };
  const c = vm.createContext({ console: console, JSON: JSON, Math: Math, String: String, Number: Number,
    Array: Array, Object: Object, Error: Error, Spirits: { load: () => store } });
  vm.runInContext(dispSrc + "\nthis.__nameOf = nameOf; this.__disp = spiritDisplayName;", c);
  // E1 单条视图恒等：传 rec（不带 store）与传全量 store 结果必须一致
  ok(c.__disp({ id: "a", name: "冰红茶" }, store.a, store) === c.__nameOf({ id: "a", name: "冰红茶" }, store),
    "E1 单条视图 ≡ 全量 store（传 rec 不改变结果）");
  ok(c.__disp({ id: "a", name: "冰红茶" }, store.a) === "江冽茗", "E1 只给 rec（不传 store）也能解析出正式名");
  ok(c.__disp({ id: "b", name: "多多牛" }, store.b) === "多多牛", "E1 改名串尊重玩家名");
  // E2 只给 store、不给 rec
  ok(c.__disp({ id: "a", name: "冰红茶" }, null, store) === "江冽茗", "E2 只给 store 也能解析");
  // E3 永不为空
  [[{}, {}], [{ id: "x" }, null], [null, null]].forEach((pair, i) => {
    let got = "";
    try { got = c.__disp(pair[0], pair[1]); } catch (e) { got = "<throw:" + e.message + ">"; }
    ok(typeof got === "string" && got.length > 0, "E3 入参 " + i + " ⇒ 非空字符串（实得 " + JSON.stringify(got) + "）");
  });
  // E4 无 nameOf 在作用域（抽函数单测环境）⇒ 静默回落原链路
  const bare = vm.createContext({ console: console, Spirits: { load: () => ({}) } });
  vm.runInContext(fnDisp + "\nthis.__disp = spiritDisplayName;", bare);
  ok(bare.__disp({ id: "a", name: "手串X" }, { persona: { name: "旧名" } }) === "旧名",
    "E4 nameOf 不在作用域 ⇒ 回落 rec.persona.name（不抛）");
  ok(bare.__disp({ id: "a", name: "手串X" }, {}) === "手串X", "E4 rec 无 persona ⇒ 回落 item.name");
}

/* ---------- F · 端到端：真跑导出 ⇒ zip 内文件名 ---------- */
section("F · 端到端：导出 zip 内文件名是正式名");
if (!coreDone || !extractFn("exportAllSpiritImages") || !extractFn("spiritItemById")) {
  ok(false, "导出链路缺失 ⇒ F 段无法真跑");
} else {
  function zipNames(buf) {
    const u = new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.length);
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const eocd = u.length - 22;
    const entries = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let i = 0; i < entries; i++) {
      const nlen = dv.getUint16(p + 28, true);
      const extra = dv.getUint16(p + 30, true);
      const cmt = dv.getUint16(p + 32, true);
      out.push(Buffer.from(u.subarray(p + 46, p + 46 + nlen)).toString("utf8"));
      p += 46 + nlen + extra + cmt;
    }
    return out;
  }
  async function runExport(storeObj, itemsArr) {
    const clicks = [], toasts = [];
    let captured = null;
    const progEl = { id: "zipProgress", style: {}, parentNode: { removeChild() {} }, textContent: "" };
    const sandbox = {
      console: console, Math: Math, JSON: JSON, Date: Date, String: String, Number: Number,
      Array: Array, Object: Object, Error: Error, Promise: Promise, Set: Set, Map: Map,
      Uint8Array: Uint8Array, Uint32Array: Uint32Array, DataView: DataView, setTimeout: setTimeout,
      Spirits: { load: () => storeObj, save() {}, cgListRO: () => [] },
      toast: (m) => toasts.push(m),
      confirmModal: async () => true,
      fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(64).buffer }),
      Blob: function (parts) { this.parts = parts; this.type = "application/zip"; },
      URL: { createObjectURL: (b) => { captured = b; return "blob:fake"; }, revokeObjectURL() {} },
      document: {
        getElementById: (id) => (id === "zipProgress" ? progEl : null),
        createElement: () => ({ style: {}, href: "", download: "", click() { clicks.push(this.download); }, remove() {} }),
        body: { appendChild() {} },
      },
    };
    const ctx = vm.createContext(sandbox);
    const prelude = [
      "let _crcTab = null; let _zipExporting = false;",
      "let allItems = " + JSON.stringify(itemsArr) + ";",
      extractConstLine("ZIP_FETCH_CONCURRENCY"),
      extractConstLine("ZIP_SIZE_WARN_BYTES"),
      extractConstLine("ZIP_METHOD_STORE"),
      extractConstLine("ZIP_FLAG_UTF8"),
      'const EXPORT_STAGE_ZH = ["凝形", "开窍", "蜕形", "化形"];',
      sliceArrayVar("SPIRIT_IDENTITIES"),
      extractFn("identityKeysOf"), extractFn("spiritIdentityOf"),
      extractFn("nameOf"), fnDisp, extractFn("spiritItemById"),
      extractFn("utf8Bytes"), extractFn("crc32Table"), extractFn("crc32"),
      extractFn("zipDateStr"), extractFn("zipSizeTxt"), extractFn("zipStore"),
      extractFn("mapLimit"), extractFn("zipProgressBox"),
      extractFn("exportSafeName"), extractFn("base2"), fnExport,
    ].filter(Boolean).join("\n");
    vm.runInContext(prelude, ctx);
    await ctx.exportAllSpiritImages();
    return { clicks, toasts, zip: captured && captured.parts && captured.parts[0] };
  }

  // 贴近真实档：自动命名的串 **没有 rec.name**，只有 AI 生成的 rec.persona.name（茶茶）
  const fakeStore = {
    aa: { id: "aa", stage: 4, spirit: true, persona: { name: "茶茶" },
      imgUrl: "https://x.test/aa.png", cgUrl: "https://x.test/aa-cg.png" },
    bb: { id: "bb", name: "多多牛", stage: 2, spirit: true, persona: { name: "旧牛" }, nameEdited: true,
      imgUrl: "https://x.test/bb.png", cgUrl: "https://x.test/bb-cg.png" },
    cc: { id: "cc", stage: 1, spirit: false, imgUrl: "https://x.test/cc.png" },
  };
  const fakeItems = [
    { id: "aa", name: "冰红茶", category: "手串" },
    { id: "bb", name: "多多牛", category: "手串" },
  ];
  const r = await runExport(fakeStore, fakeItems);
  const names = r.zip ? zipNames(r.zip) : [];
  ok(r.clicks.length === 1, "只触发 1 次保存（实测 " + r.clicks.length + " 次）");
  ok(!!r.zip, "拿到了 zip 字节");
  ok(names.length === 4, "共 4 个条目（2 尊 × 立绘+CG；spirit:false 的 cc 不导出）实测 " + names.length);
  ok(names.some((n) => n.indexOf("江冽茗") >= 0), "✅ 文件名带正式名「江冽茗」：" + JSON.stringify(names));
  ok(!names.some((n) => n.indexOf("茶茶") >= 0), "⛔ 文件名不再出现旧 AI 名「茶茶」");
  ok(names.some((n) => n === "江冽茗·化形_立绘.png"), "立绘条目 = 江冽茗·化形_立绘.png");
  ok(names.some((n) => n === "江冽茗·化形_进阶CG.png"), "CG 条目 = 江冽茗·化形_进阶CG.png");
  ok(names.some((n) => n === "多多牛·开窍_立绘.png"), "玩家改过名的串用玩家名（多多牛）");
  ok(!names.some((n) => n.indexOf("邵盈牧") >= 0), "⛔ 玩家改过名的串不被身份表覆盖");
  ok(!names.some((n) => n.indexOf("旧牛") >= 0), "⛔ 存档里的旧 persona 名不泄漏");
  ok(/^沁灵立绘_\d{4}-\d{2}-\d{2}\.zip$/.test(r.clicks[0] || ""), "下载名仍是 沁灵立绘_YYYY-MM-DD.zip");
}
  done();
})();
