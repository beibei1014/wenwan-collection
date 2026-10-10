/* ============================================================
 * _test_v180zip_export.js · V180 · zip：立绘导出改成「单个 zip 打包下载」
 *                                    + #/spirits（全部沁灵页）常驻入口
 * ------------------------------------------------------------
 * 用户原话：「点了导出它是一页一页的下载…怎么不是之前那样打包下载？」
 *   ⇒ 旧实现逐张 createObjectURL + a.click()，100+ 次保存弹窗把浏览器点卡死。
 * 另：#/spirits 页在 UI 上没有任何常驻导航入口（只有「有日记时」才渲染的 #diaryHint）。
 *
 * 落点（js/app.js）：
 *   ① 自写最小 ZIP 打包器：utf8Bytes / crc32Table / crc32 / zipStore（STORE method 0，⛔ 零依赖、⛔ 不引 CDN）
 *   ② mapLimit：受限并发（ZIP_FETCH_CONCURRENCY，4~6），单张失败只记 null
 *   ③ zipProgressBox：可见进度「已打包 12/96」
 *   ④ exportAllSpiritImages：收集 → 打包 → 一次下载 沁灵立绘_YYYY-MM-DD.zip
 *   ⑤ #/spirit 标题栏常驻按钮 #spAllSpirits → #/spirits（⛔ 非条件渲染）
 *
 * 覆盖：
 *   A · 静态：新函数/常量齐备；旧逐张下载写法已消失；命名与收集范围未缩水
 *   B · ZIP 字节结构：EOCD / 本地头 / 中央目录 / method=0 / UTF-8 名 / CRC 全对
 *   C · CRC32 + UTF-8：对齐标准向量
 *   D · mapLimit：并发上限、顺序保持、失败跳过不中断
 *   E · 端到端：抽真函数跑一遍（假 fetch + 假 DOM）⇒ 只触发 1 次下载，文件名合规
 *   F · 端到端容错：部分失败 ⇒ 仍出单个 zip，末尾汇总失败数
 *   G · 入口按钮：存在、常驻（非条件渲染）、绑定正确
 *   H · index.html 缓存戳已 bump
 *   I · 负向对照：铆定 5a294a2（zip 落地前 commit，⛔ 绝不写 HEAD）⇒ 必须红
 *
 * 用法： node docs/_test_v180zip_export.js
 * 负向： APP_SRC_FILE=docs/_tmp/_pre_v180zip_app.js INDEX_SRC_FILE=docs/_tmp/_pre_v180zip_index.html \
 *        node docs/_test_v180zip_export.js   ⇒ 必须 FAIL
 * 快照怎么来的（任何人都能重建，⛔ 不依赖本地 HEAD）：
 *        git show 5a294a2:js/app.js   > docs/_tmp/_pre_v180zip_app.js
 *        git show 5a294a2:index.html  > docs/_tmp/_pre_v180zip_index.html
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const INDEX_FILE = process.env.INDEX_SRC_FILE ? path.resolve(process.env.INDEX_SRC_FILE) : path.join(ROOT, "index.html");
const appSrc = fs.readFileSync(APP_FILE, "utf8");
const indexSrc = fs.readFileSync(INDEX_FILE, "utf8");
console.log("app 源码：" + APP_FILE);
console.log("index 源码：" + INDEX_FILE);

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function done() {
  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}

/* ---------- 源码抽函数（大括号配对，跳过字符串/注释/正则字面量） ---------- */
const REGEX_PREV = "(,=:[!&|?{};+-*%~^<>";   // 这些字符后面出现的 / 一定是正则起点（不是除号）
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(appSrc);
  if (!m) return null;
  // ⚠️ 起点要带上 async（否则抽出来的是非 async 版本，内部 await 会语法错）
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
      // ⚠️ 正则字面量必须整段跳过：正则里可能带引号（如 /[\\/:*?"<>|]/g），
      //    不识别的话扫描器会把后面的代码当成字符串吞掉，抽出来的函数多出几百行。
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
  // ⚠️ 行尾常有 // 注释，所以按「到第一个分号」截，不能要求 ; 后就是行尾
  const m = new RegExp("const\\s+" + name + "\\s*=[^;]*;").exec(appSrc);
  return m ? m[0] : null;
}

/* ============================================================
 * A · 静态
 * ============================================================ */
section("A · 静态：zip 打包器落地 / 旧逐张下载写法下线");
const NEED_FN = ["utf8Bytes", "crc32Table", "crc32", "zipDateStr", "zipSizeTxt", "zipStore", "mapLimit", "zipProgressBox"];
const MISSING = NEED_FN.filter((n) => !extractFn(n));
ok(MISSING.length === 0, "zip 打包器 8 个函数全部落地" + (MISSING.length ? "（缺：" + MISSING.join(",") + "）" : ""));
ok(appSrc.indexOf("async function exportAllSpiritImages()") > 0, "exportAllSpiritImages 仍在（⛔ 不许改名/删）");
const fnExport = extractFn("exportAllSpiritImages") || "";
ok(/const ZIP_FETCH_CONCURRENCY\s*=\s*[4-6]\s*;/.test(appSrc), "ZIP_FETCH_CONCURRENCY 在 4~6 之间（防卡死）");
ok(/ZIP_SIZE_WARN_BYTES\s*=\s*200\s*\*\s*1024\s*\*\s*1024/.test(appSrc), "ZIP_SIZE_WARN_BYTES = 200MB");
ok(/ZIP_METHOD_STORE\s*=\s*0\s*;/.test(appSrc), "ZIP_METHOD_STORE = 0（STORE，不压缩）");
ok(/ZIP_FLAG_UTF8\s*=\s*0x0800\s*;/.test(appSrc), "ZIP_FLAG_UTF8 = 0x0800（文件名 UTF-8）");
ok(appSrc.indexOf('"沁灵立绘_" + zipDateStr() + ".zip"') > 0, "文件名模板：沁灵立绘_YYYY-MM-DD.zip");
ok(/a\.download\s*=\s*zipName/.test(fnExport), "下载名用 zipName（单文件）");
ok(fnExport.indexOf("a.download = it.file") < 0, "⛔ 旧的逐张 download（it.file）已删除");
ok(/mapLimit\(list,\s*ZIP_FETCH_CONCURRENCY/.test(fnExport), "走受限并发 mapLimit，不再是串行 for 循环");
ok(fnExport.indexOf("for (let i = 0; i < list.length; i++)") < 0, "⛔ 旧串行下载循环已删除");
ok(/box\.textContent\s*=\s*"已打包 "/.test(fnExport), "有可见进度「已打包 N/M」");
ok(/_zipExporting/.test(fnExport) && /let _zipExporting\s*=\s*false/.test(appSrc), "有防连点 _zipExporting");
ok(/ZIP_SIZE_WARN_BYTES\)\s*\{/.test(fnExport) && /toast\("已超过 "/.test(fnExport), "超 200MB 会提示");
const wAt = fnExport.indexOf("stat.warned = true");
ok(wAt > 0 && fnExport.slice(wAt, wAt + 220).indexOf("return") < 0, "超阈值提示后仍继续（warn 分支内无 return）");
ok(/good\s*=\s*parts\.filter/.test(fnExport), "失败项被过滤掉，不影响整体");
ok(/zipStore\(good\)/.test(fnExport), "最终调 zipStore 合成单包");
ok(fnExport.split("URL.createObjectURL").length - 1 === 1, "全程只有 1 次 createObjectURL（单个 zip）");
ok(fnExport.split("a.click()").length - 1 === 1, "全程只有 1 次 a.click()（单个 zip）");
ok(/new Blob\(\[zipBytes\], \{ type: "application\/zip" \}\)/.test(fnExport), "Blob MIME = application/zip");
// ⛔ 命名规则与收集范围必须原样保留
ok(appSrc.indexOf('const EXPORT_STAGE_ZH = ["凝形", "开窍", "蜕形", "化形"]') > 0, "⛔ 命名规则 EXPORT_STAGE_ZH 未改");
ok(!!extractFn("exportSafeName") && !!extractFn("base2"), "⛔ exportSafeName / base2（重名补序）仍在");
ok(appSrc.indexOf('tag("立绘")') > 0 && appSrc.indexOf('tag("表情基")') > 0 && appSrc.indexOf('tag("旧立绘"') > 0 &&
   appSrc.indexOf('tag("进阶CG")') > 0 && appSrc.indexOf("_节令CG_") > 0 && appSrc.indexOf("_事件CG_") > 0,
   "⛔ 收集范围（立绘/表情基/旧立绘/进阶CG/历史CG/相册/节令CG/房间事件CG）未缩水");
// ⛔ 不许引第三方依赖
ok(appSrc.indexOf("JSZip") < 0 && appSrc.indexOf("jszip") < 0, "⛔ 未引 JSZip（零依赖）");
ok(!/https?:\/\/cdn/.test(fnExport) && !/<script[^>]+src=/.test(fnExport), "⛔ 未注入 CDN script");

/* ============================================================
 * G · #/spirit 标题栏常驻入口（静态）
 * ============================================================ */
section("G · #/spirit 标题栏常驻入口 #spAllSpirits");
const btnHits = appSrc.split('id="spAllSpirits"').length - 1;
ok(btnHits === 1, "按钮 id 出现 1 次（" + btnHits + "）");
const btnPos = appSrc.indexOf('id="spAllSpirits"');
const stmtStart = btnPos > 0 ? appSrc.lastIndexOf("html +=", btnPos) : -1;
ok(stmtStart > 0 && btnPos - stmtStart < 700, "按钮与 section-title 同一条 html += 语句");
const seg = stmtStart > 0 ? appSrc.slice(stmtStart, btnPos) : "";
ok(seg.indexOf("if (") < 0 && seg.indexOf("? ") < 0, "⛔ 按钮不在条件渲染里（语句内无 if / 三元）");
ok(seg.indexOf('class="section-title"') > 0, "挂在「🍡 我的沁灵（N）」标题栏上");
ok(/const allBtn = \$\("#spAllSpirits"\)/.test(appSrc), "有 #spAllSpirits 绑定");
ok(/allBtn\.onclick = \(\) => location\.hash = "#\/spirits"/.test(appSrc), "点击 → #/spirits");
ok(/全部沁灵 →/.test(appSrc), "按钮可见文案「全部沁灵 →」");
ok(appSrc.indexOf('const dh = $("#diaryHint")') > 0, "旧的 #diaryHint 保留（⛔ 不删既有功能）");
ok(appSrc.indexOf('id="spExportAll"') > 0, "#/spirits 页的导出按钮仍在（入口 → 导出 两步都通）");

/* ============================================================
 * H · index.html 缓存戳（静态）
 * ============================================================ */
section("H · index.html 缓存戳");
const stamp = /js\/app\.js\?v=([0-9]+)/.exec(indexSrc);
const prePath = path.join(ROOT, "docs/_tmp/_pre_v180zip_index.html");
const preStamp = fs.existsSync(prePath) ? /js\/app\.js\?v=([0-9]+)/.exec(fs.readFileSync(prePath, "utf8")) : null;
ok(!!stamp, "index.html 里找得到 js/app.js?v=");
ok(!!preStamp, "铆定快照存在：docs/_tmp/_pre_v180zip_index.html（改前 = 5a294a2）");
ok(stamp && preStamp && stamp[1] !== preStamp[1],
  "缓存戳已 bump：" + (preStamp ? preStamp[1] : "?") + " → " + (stamp ? stamp[1] : "?"));

/* ⛔ 负向对照闸门：改前源码里根本没有 zip 器，动态段（B~F）无法执行 —— 到此为止即可判定为红 */
if (MISSING.length) {
  section("I · 负向对照");
  console.log("  ⓘ 当前源码缺少 zip 打包器（" + MISSING.length + " 个），动态段 B~F 跳过；" +
    "以上静态断言已足以判定「改前 = 红」。");
  done();
}

/* ============================================================
 * B · ZIP 字节结构
 * ============================================================ */
section("B · ZIP 字节结构：EOCD / 本地头 / 中央目录");
const sandboxSrc = [
  "let _crcTab = null;",
  extractConstLine("ZIP_METHOD_STORE"),
  extractConstLine("ZIP_FLAG_UTF8"),
  extractFn("utf8Bytes"),
  extractFn("crc32Table"),
  extractFn("crc32"),
  extractFn("zipDateStr"),
  extractFn("zipSizeTxt"),
  extractFn("zipStore"),
  extractFn("mapLimit"),
].filter(Boolean).join("\n");
const ctx = vm.createContext({ console: console, Uint8Array: Uint8Array, Uint32Array: Uint32Array,
  DataView: DataView, Math: Math, String: String, Number: Number, Array: Array, Promise: Promise, Date: Date });
vm.runInContext(sandboxSrc +
  "\nthis.__zipStore = zipStore; this.__crc32 = crc32; this.__utf8 = utf8Bytes; this.__mapLimit = mapLimit;", ctx);
const zipStore = ctx.__zipStore, crc32 = ctx.__crc32, utf8Bytes = ctx.__utf8, mapLimit = ctx.__mapLimit;

function bytesOf(s) { return Buffer.from(String(s), "utf8"); }
const F1 = { name: "a.png", bytes: new Uint8Array(bytesOf("hello")) };
const F2 = { name: "星月菩提·蜕形_进阶CG.png", bytes: new Uint8Array(bytesOf("PNG-FAKE-BYTES-中文")) };
const F3 = { name: "empty.png", bytes: new Uint8Array(0) };
const zb = zipStore([F1, F2, F3]);
ok(ArrayBuffer.isView(zb), "zipStore 返回 TypedArray（Uint8Array）");

function readZip(buf) {
  const u = new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.length);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const eocd = u.length - 22;
  const res = {
    eocdSig: dv.getUint32(eocd, true), entries: dv.getUint16(eocd + 10, true),
    cdSize: dv.getUint32(eocd + 12, true), cdOff: dv.getUint32(eocd + 16, true),
    commentLen: dv.getUint16(eocd + 20, true), files: [],
  };
  let p = res.cdOff;
  for (let i = 0; i < res.entries; i++) {
    const nlen = dv.getUint16(p + 28, true);
    const lho = dv.getUint32(p + 42, true);
    const lNlen = dv.getUint16(lho + 26, true);
    const lUsize = dv.getUint32(lho + 22, true);
    res.files.push({
      cSig: dv.getUint32(p, true), flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true),
      crc: dv.getUint32(p + 16, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true),
      name: Buffer.from(u.subarray(p + 46, p + 46 + nlen)).toString("utf8"),
      lSig: dv.getUint32(lho, true), lMethod: dv.getUint16(lho + 8, true), lCrc: dv.getUint32(lho + 14, true),
      lCsize: dv.getUint32(lho + 18, true), lUsize: lUsize,
      lName: Buffer.from(u.subarray(lho + 30, lho + 30 + lNlen)).toString("utf8"),
      data: u.subarray(lho + 30 + lNlen, lho + 30 + lNlen + lUsize), lho: lho,
    });
    p += 46 + nlen;
  }
  return res;
}
const z = readZip(zb);
ok(z.eocdSig === 0x06054b50, "EOCD 签名 0x06054b50");
ok(z.commentLen === 0, "EOCD 注释长度 0");
ok(z.entries === 3 && z.files.length === 3, "EOCD 条目数 = 3");
ok(z.cdOff + z.cdSize + 22 === zb.length, "中央目录偏移 + 长度 + EOCD = 总长（结构自洽）");
const expectLen = (30 + 5 + 5) + (30 + Buffer.byteLength(F2.name) + F2.bytes.length) + (30 + 9 + 0)
  + (46 + 5) + (46 + Buffer.byteLength(F2.name)) + (46 + 9) + 22;
ok(zb.length === expectLen, "总长 = 本地头+数据 + 中央目录 + EOCD 理论值（" + expectLen + "）");
z.files.forEach((f, i) => {
  ok(f.cSig === 0x02014b50, "中央目录签名 OK #" + i);
  ok(f.lSig === 0x04034b50, "本地头签名 OK #" + i);
  ok(f.method === 0 && f.lMethod === 0, "压缩方法 = 0（STORE）#" + i);
  ok((f.flags & 0x0800) !== 0, "UTF-8 位已置（中文名不乱码）#" + i);
  ok(f.crc === f.lCrc, "中央目录与本地头 CRC 一致 #" + i);
  ok(f.csize === f.usize && f.lCsize === f.lUsize, "STORE：压缩后大小 = 原始大小 #" + i);
  ok(f.name === f.lName, "两处文件名一致 #" + i);
});
ok(z.files[0].name === "a.png", "ASCII 文件名解出正确");
ok(z.files[1].name === "星月菩提·蜕形_进阶CG.png", "中文文件名解出正确（UTF-8 往返无损）");
ok(Buffer.from(z.files[0].data).toString("utf8") === "hello", "#0 数据字节原样存回");
ok(Buffer.from(z.files[1].data).toString("utf8") === "PNG-FAKE-BYTES-中文", "#1 数据字节原样存回");
ok(z.files[2].usize === 0 && z.files[2].crc === 0, "空文件条目合法（0 字节 / CRC 0）");
ok(z.files[0].crc === crc32(new Uint8Array(bytesOf("hello"))), "#0 CRC 自洽");
const z0 = readZip(zipStore([]));
ok(z0.eocdSig === 0x06054b50 && z0.entries === 0 && z0.cdOff === 0, "空列表 ⇒ 合法空 zip（不炸）");
const fnZip = extractFn("zipStore") || "";
ok(fnZip.indexOf("for (") < 0, "zipStore 内无裸 for 循环（forEach 单遍 O(n)）");

/* ============================================================
 * C · CRC32 / UTF-8 标准向量
 * ============================================================ */
section("C · CRC32 + UTF-8 标准向量");
ok(crc32(new Uint8Array(0)) === 0, "crc32('') = 0x00000000");
ok(crc32(new Uint8Array(bytesOf("a"))) === 0xE8B7BE43, "crc32('a') = 0xE8B7BE43");
ok(crc32(new Uint8Array(bytesOf("123456789"))) === 0xCBF43926, "crc32('123456789') = 0xCBF43926（标准检查值）");
ok(crc32(new Uint8Array(bytesOf("The quick brown fox jumps over the lazy dog"))) === 0x414FA339, "crc32(fox…) = 0x414FA339");
ok(Array.from(utf8Bytes("沁")).length === 3, "utf8Bytes('沁') = 3 字节");
ok(Array.from(utf8Bytes("🍡")).length === 4, "utf8Bytes('🍡') = 4 字节（代理对正确）");
ok(Buffer.from(utf8Bytes("沁灵🍡·蜕形")).toString("utf8") === "沁灵🍡·蜕形", "utf8Bytes 往返无损（含 emoji）");

/* ============================================================
 * D~H · 异步部分
 * ============================================================ */
(async function () {
  section("D · mapLimit：受限并发 + 失败不中断");
  const src24 = [];
  for (let i = 0; i < 24; i++) src24.push(i);
  let cur = 0, peak = 0;
  const out = await mapLimit(src24, 5, async (v) => {
    cur++; if (cur > peak) peak = cur;
    await new Promise((r) => setTimeout(r, 2));
    cur--;
    return v * 10;
  });
  ok(peak <= 5, "并发峰值 ≤ 5（实测 " + peak + "）");
  ok(peak >= 2, "确实并发了（峰值 " + peak + "，⛔ 没退化成串行）");
  ok(out.length === 24 && out[0] === 0 && out[23] === 230, "输出按原顺序回填，长度不变");

  const bad = new Set([3, 9, 17]);
  let ranAll = 0;
  const out2 = await mapLimit(src24, 5, async (v) => {
    ranAll++;
    await new Promise((r) => setTimeout(r, 1));
    if (bad.has(v)) throw new Error("boom " + v);
    return v;
  });
  ok(ranAll === 24, "失败项之后其余仍全部执行（⛔ 不中断整体）");
  ok(out2.filter((x) => x === null).length === 3, "失败项记为 null（3 个）");
  ok(out2.filter((x) => x !== null).length === 21, "成功项 21 个保留");
  ok((await mapLimit([], 5, async () => 1)).length === 0, "空列表不炸");
  ok((await mapLimit([1, 2, 3], 99, async (v) => v)).join(",") === "1,2,3", "limit 越界被夹后仍跑完");

  /* ---------- E / F · 端到端 ---------- */
  section("E · 端到端：一次导出只弹 1 次下载，文件名合规");
  async function runExport(failSet, itemCount) {
    const clicks = [], toasts = [], appended = [], prog = [];
    let removed = 0, cur2 = 0, peak2 = 0;
    const fakeStore = {};
    for (let i = 0; i < itemCount; i++) {
      fakeStore["id" + i] = {
        id: "id" + i, name: "沁灵" + i, stage: 3, spirit: true,
        imgUrl: "https://x.test/img" + i + ".png",
        cgUrl: "https://x.test/cg" + i + ".png",
      };
    }
    let _pt = "";
    const progEl = { id: "zipProgress", style: {}, parentNode: { removeChild() { removed++; } } };
    Object.defineProperty(progEl, "textContent", { get() { return _pt; }, set(v) { _pt = v; prog.push(v); } });
    const sandbox = {
      console: console, Math: Math, JSON: JSON, Date: Date, String: String, Number: Number,
      Array: Array, Object: Object, Error: Error, Promise: Promise, Set: Set, Map: Map,
      Uint8Array: Uint8Array, Uint32Array: Uint32Array, DataView: DataView, setTimeout: setTimeout,
      Spirits: { load: () => fakeStore, save() {}, cgListRO: () => [] },
      toast: (m) => toasts.push(m),
      confirmModal: async () => true,
      fetch: async (url) => {
        cur2++; if (cur2 > peak2) peak2 = cur2;
        await new Promise((r) => setTimeout(r, 2));
        cur2--;
        const n = Number(String(url).replace(/[^0-9]/g, ""));
        if (failSet && failSet.has(n)) throw new Error("fake network fail " + url);
        const u = new Uint8Array(1024);
        for (let k = 0; k < u.length; k++) u[k] = (n + k) & 0xff;
        return { ok: true, status: 200, arrayBuffer: async () => u.buffer };
      },
      Blob: function (parts) { this.parts = parts; this.type = "application/zip"; },
      URL: { createObjectURL: () => "blob:fake", revokeObjectURL() {} },
      document: {
        getElementById: (id) => (id === "zipProgress" ? progEl : null),
        createElement: () => ({
          style: {}, href: "", download: "",
          click() { clicks.push(this.download); },
          remove() {},
        }),
        body: { appendChild(el) { appended.push(el); } },
      },
    };
    const c = vm.createContext(sandbox);
    const prelude = [
      "let _crcTab = null; let _zipExporting = false;",
      extractConstLine("ZIP_FETCH_CONCURRENCY"),
      extractConstLine("ZIP_SIZE_WARN_BYTES"),
      extractConstLine("ZIP_METHOD_STORE"),
      extractConstLine("ZIP_FLAG_UTF8"),
      'const EXPORT_STAGE_ZH = ["凝形", "开窍", "蜕形", "化形"];',
      extractFn("utf8Bytes"), extractFn("crc32Table"), extractFn("crc32"),
      extractFn("zipDateStr"), extractFn("zipSizeTxt"), extractFn("zipStore"),
      extractFn("mapLimit"), extractFn("zipProgressBox"),
      extractFn("exportSafeName"), extractFn("base2"), extractFn("exportAllSpiritImages"),
    ].filter(Boolean).join("\n");
    vm.runInContext(prelude, c);
    await c.exportAllSpiritImages();
    return { clicks, toasts, appended, prog, peak: peak2, removed, progEl };
  }

  const r1 = await runExport(null, 12);
  ok(r1.clicks.length === 1, "只触发 1 次保存（实测 " + r1.clicks.length + " 次，⛔ 不是 24 次）");
  ok(/^沁灵立绘_\d{4}-\d{2}-\d{2}\.zip$/.test(r1.clicks[0] || ""), "下载名 = 沁灵立绘_YYYY-MM-DD.zip（实测 " + r1.clicks[0] + "）");
  ok(r1.peak <= 5, "端到端并发峰值 ≤ 5（实测 " + r1.peak + "）");
  ok(r1.appended.filter((e) => e && typeof e.download === "string").length === 1, "只 append 了 1 个下载 <a>");
  ok(r1.prog.some((t) => /已打包 24\/24/.test(t)), "进度走到 24/24（12 尊 × 立绘+CG）");
  ok(r1.prog.some((t) => t.indexOf("正在合成 zip") >= 0), "有「正在合成 zip…」阶段提示");
  ok(r1.toasts.some((t) => t.indexOf("导出完成") === 0), "末尾有「导出完成」汇总 toast");
  ok(r1.removed >= 1, "结束后进度盒被移除（不残留浮层）");

  section("F · 端到端容错：单张失败只跳过 + 末尾汇总");
  const r2 = await runExport(new Set([3, 9]), 12);   // img3/cg3/img9/cg9 ⇒ 4 张失败
  ok(r2.clicks.length === 1, "有失败项时仍然只弹 1 次下载（⛔ 不中断）");
  ok(r2.toasts.some((t) => /失败 4 张/.test(t)), "末尾汇总失败数（4 张）");
  ok(r2.toasts.some((t) => /20\/24/.test(t)), "成功 20/24 写进汇总");

  done();
})();
