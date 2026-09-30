/* v164h 自测：修「方舟通道立绘每 20 小时自动重出 = 天天烧钱」
   根因链：方舟默认返回 24h 过期外链 → urlToDataUri 被 CORS 拦死转存失败 → spiritImgStale 20h 判过期
          → ensureSpiritImages 自动重出 → 每天 ~N×0.13 元（用户方舟后台实测一天 10 张）。
   修复：① callImageApi 向方舟要 response_format="b64_json"（被拒→按服务商记住→去掉重试）
        ② saveSpiritImage 拿到 b64 → 压缩 → 试传 Supabase Storage 换永久 URL（失败回退 data URI）
        ③ 永久图一律 imgFrozen=true（spiritImgStale 永不判过期）
        ④ 入史 data URI 压成 256 小图防撑爆 localStorage

   用法： node docs/_test_v164h_ark.js
   负向对照（证明测试真的抓得住 bug）：
     git show 86f2c94:js/spirits.js > %TEMP%\spirits_old.js
     SPIRITS_SRC_FILE=<那个文件> node docs/_test_v164h_ark.js   → A 段必须 FAIL
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SPIRITS_FILE = process.env.SPIRITS_SRC_FILE ? path.resolve(process.env.SPIRITS_SRC_FILE) : path.join(ROOT, "js/spirits.js");
const APP_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const SSRC = fs.readFileSync(SPIRITS_FILE, "utf8");
const ASRC = fs.readFileSync(APP_FILE, "utf8");
console.log("spirits: " + SPIRITS_FILE);
console.log("app:     " + APP_FILE);

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) { PASS++; console.log("  ✓ " + msg); }
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

function extractFn(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error("找不到函数 " + name);
  let start = m.index;
  if (src.slice(start - 6, start) === "async ") start -= 6;   //带上 async 前缀，否则抽出的函数含 await 会语法错误
  let i = src.indexOf("(", m.index), pd = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") pd++;
    else if (src[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < src.length && src[i] !== "{") i++;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) break; i++; }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); i = e < 0 ? src.length : e + 2; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

/* ---------- 沙箱：跑 callImageApi ---------- */
const ARK = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const ZHIPU = "https://open.bigmodel.cn/api/paas/v4/images/generations";
function callSandbox() {
  const calls = [];              // 每次请求的 payload
  const responses = [];          // 按次序出栈：{ok, json, status}
  const fixed = { noRef: {}, noWatermark: {}, autoModel: {}, b64: {} };
  const sb = {
    console, JSON, Promise, Error, Object, Uint8Array, Math, Date, String, Number,
    fetch: (url, opts) => {
      calls.push(JSON.parse(opts.body));
      const r = responses.shift() || { ok: true, json: { data: [{ b64_json: "QUJD" }] } };
      return Promise.resolve({
        ok: r.ok !== false,
        status: r.status || 200,
        json: () => Promise.resolve(r.json),
      });
    },
    fixedOf: (k, key) => !!fixed[k][key || "?"],
    markFixed: (k, key) => { fixed[k][key || "?"] = true; },
    DEFAULT_SIZE: "1024x1024",
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(extractFn(SSRC, "callImageApi") + "\n;__f = callImageApi;", sb, { filename: "spirits.js#callImageApi" });
  return { sb, calls, responses, fixed, f: sb.__f };
}

function appSandbox(extra) {
  const sb = Object.assign({
    console, Date, Math, JSON, String, Number, Promise, Error, Object, RegExp,
    Uint8Array, atob: (s) => Buffer.from(s, "base64").toString("binary"),
    File: (typeof File !== "undefined") ? File : function FakeFile(parts) { this.parts = parts; this.size = 2; },
    navigator: { onLine: true },
    DB: { uploadPhoto: () => Promise.resolve({ url: "https://sb.example/obj.jpg", path: "p/1.jpg" }) },
  }, extra || {});
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

async function main() {
  section("A. 方舟 payload 带 response_format=b64_json");
  {
    const t = callSandbox();
    t.responses.push({ ok: true, json: { data: [{ b64_json: "QUJD" }] } });
    const info = { provider: "ark", endpoint: ARK, key: "k", model: "doubao-seedream-5-0-flash-260915", keyless: false };
    const res = await t.f(info, "a cat", "1024x1024", 12345, "");
    ok(t.calls.length === 1, "只发了 1 次请求");
    const p = t.calls[0];
    ok(p.response_format === "b64_json", "payload.response_format === b64_json（实测：" + JSON.stringify(p.response_format) + "）");
    ok(p.seed === 12345, "seed 仍随 payload 传（同角色辨识度）");
    ok(p.model === "doubao-seedream-5-0-flash-260915" && p.prompt === "a cat", "model/prompt 正常");
    ok(res && res.b64 === "QUJD" && res.kind === "b64", "b64 响应透传为 { b64, kind:b64 }");
    ok(t.fixed.b64.ark !== true, "成功路径不标记 b64 修复");
  }

  section("B. 方舟拒绝 response_format → 去掉重试一次且记住");
  {
    const t = callSandbox();
    t.responses.push({ ok: false, status: 400, json: { error: { message: "Invalid parameter: response_format" } } });
    t.responses.push({ ok: true, json: { data: [{ url: "https://x/y.png" }] } });
    const info = { provider: "ark", endpoint: ARK, key: "k", model: "m", keyless: false };
    const res = await t.f(info, "a cat", "1024x1024", 1, "");
    ok(t.calls.length === 2, "共发了 2 次请求（1 次被拒 + 1 次重试）");
    ok(t.calls[0].response_format === "b64_json", "第一次带 response_format");
    ok(!("response_format" in t.calls[1]), "重试时不带 response_format");
    ok(t.fixed.b64.ark === true, "按服务商记住（fixed.b64.ark = true）");
    ok(res && res.url === "https://x/y.png", "回落到 url 模式仍能用");
    t.responses.push({ ok: true, json: { data: [{ url: "https://x/z.png" }] } });
    await t.f(info, "a cat", "1024x1024", 1, "");
    ok(t.calls.length === 3 && !("response_format" in t.calls[2]), "记住后新调用不再带 response_format（不重复撞墙）");
  }

  section("C. 非方舟（智谱）不带 response_format");
  {
    const t = callSandbox();
    t.responses.push({ ok: true, json: { data: [{ url: "https://z/1.png" }] } });
    const info = { provider: "zhipu", endpoint: ZHIPU, key: "k", model: "m", keyless: false };
    await t.f(info, "a cat", "1024x1024", null, "");
    const p = t.calls[0];
    ok(!("response_format" in p), "智谱 payload 不带 response_format");
    ok(p.watermark_enabled === false, "智谱仍带 watermark_enabled=false（既有行为不变）");
  }

  section("D. spiritImgStale：永久图永不判过期");
  {
    const sb = appSandbox();
    vm.runInContext(extractFn(ASRC, "spiritImgStale") + "\n;__s = spiritImgStale;", sb, { filename: "app.js#spiritImgStale" });
    const s = sb.__s;
    ok(s({ imgUrl: "" }) === true, "无图 → 过期（要出图）");
    ok(s({ imgUrl: "data:image/jpeg;base64,xx", imgAt: Date.now() - 40 * 3600 * 1000 }) === false, "data URI 永久有效（40 小时后也不过期）");
    ok(s({ imgUrl: "https://sb.example/a.jpg", imgFrozen: true, imgAt: Date.now() - 40 * 3600 * 1000 }) === false, "imgFrozen 冻结 → 永不过期");
    ok(s({ imgUrl: "https://ark.example/tmp.png", imgAt: Date.now() - 21 * 3600 * 1000 }) === true, "外链 21 小时 → 判过期（旧根因路径仍成立）");
    ok(s({ imgUrl: "https://ark.example/tmp.png", imgAt: Date.now() - 1 * 3600 * 1000 }) === false, "外链 1 小时 → 不过期");
  }

  section("E. spiritUploadPermanent：data URI → 云端永久 URL，失败回退空串");
  {
    let got = null, nCalls = 0;
    const sb1 = appSandbox({ DB: { uploadPhoto: async (file) => { nCalls++; got = file; return { url: "https://sb.example/spirit.jpg", path: "u/1.jpg" }; } } });
    vm.runInContext(extractFn(ASRC, "spiritUploadPermanent") + "\n;__u = spiritUploadPermanent;", sb1, { filename: "app.js#spiritUploadPermanent" });
    const u = sb1.__u;
    const r1 = await u("data:image/jpeg;base64,SGk=");   // "Hi" → 2 字节
    ok(r1 === "https://sb.example/spirit.jpg", "上传成功 → 返回云端 URL");
    ok(nCalls === 1 && got && got.size === 2, "uploadPhoto 收到 File 且字节数正确（2）");

    const sb2 = appSandbox({ DB: { uploadPhoto: async () => { throw new Error("未登录"); } } });
    vm.runInContext(extractFn(ASRC, "spiritUploadPermanent") + "\n;__u2 = spiritUploadPermanent;", sb2, { filename: "app.js#spiritUploadPermanent" });
    ok(await sb2.__u2("data:image/jpeg;base64,SGk=") === "", "上传抛错（未登录）→ 返回空串回退");

    const sb3 = appSandbox({ DB: { uploadPhoto: async () => { nCalls++; return { url: "x" }; } } });
    vm.runInContext(extractFn(ASRC, "spiritUploadPermanent") + "\n;__u3 = spiritUploadPermanent;", sb3, { filename: "app.js#spiritUploadPermanent" });
    ok(await sb3.__u3("https://ark.example/a.png") === "", "https 外链输入 → 不上传，返回空串");

    const sb4 = appSandbox({ navigator: { onLine: false }, DB: { uploadPhoto: async () => { nCalls++; return { url: "x" }; } } });
    vm.runInContext(extractFn(ASRC, "spiritUploadPermanent") + "\n;__u4 = spiritUploadPermanent;", sb4, { filename: "app.js#spiritUploadPermanent" });
    ok(await sb4.__u4("data:image/jpeg;base64,SGk=") === "", "离线 → 不上传，返回空串");
  }

  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error("测试脚本异常：", e && e.message); process.exit(1); });
