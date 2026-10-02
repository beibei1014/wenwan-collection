/* v164i 画质回归自测：立绘/CG 清晰度 + 头像取景裁切。
 *
 * 覆盖三块（对应 v164h 引入的回归）：
 *   A. 不变式「大图只进 Supabase，localStorage 只放小图」
 *      - 云端成功 → 用 1024/q0.92 出大图并上传，rec.imgUrl 存云端 URL
 *      - 上传失败 → 回退 512/q0.86 小图 data URI，⛔ 绝不能把 1024 的 data URI 写进 localStorage
 *      - 无云端时 imgHistory 只留 3 条；有云端留 8 条
 *   B. CG 尺寸抬高：CG_IMG_SIZE 1280 / CG_MAIN_SIZE 1024 / CG_THUMB_SIZE 512
 *   C. 头像取景：放大倍数钳制（≥3× 判失败走 CSS 兜底）+ FACE_VER=3 强制重算
 *
 * 作者不可信原则：源码按大括号配对**自己抽**，沙箱里跑抽出来的真函数。
 * 用法：
 *   node docs/_test_v164i_quality.js                                 # 跑仓库内 js/app.js
 *   APP_SRC_FILE=<path> node docs/_test_v164i_quality.js             # 负向对照（v164h 源码必须失败）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const src = fs.readFileSync(SRC_FILE, "utf8");
console.log("源码：" + SRC_FILE + "  （" + src.length + " 字节）");

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function info(s) { console.log("  · " + s); }

/* ---------- 1. 抽函数（带 async 前缀；跳过字符串/注释里的括号） ---------- */
function extractFn(name) {
  const re = new RegExp("(async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return null;
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
    if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(m.index, i);
}
function numConst(name) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*;").exec(src);
  return m ? Number(m[1]) : null;
}
const FN = {
  imageToStoreUrl: extractFn("imageToStoreUrl"),
  saveSpiritImage: extractFn("saveSpiritImage"),
  spiritThumbHtml: extractFn("spiritThumbHtml"),
};
info("抽到：" + Object.keys(FN).map((k) => k + (FN[k] ? "(" + FN[k].length + "B)" : "=无")).join(" "));

/* ---------- 2. 沙箱 ---------- */
const DATA_PREFIX = "data:image/jpeg;base64,";
function makeSandbox(opt) {
  opt = opt || {};
  const calls = { shrink: [], url2data: [], upload: [], face: 0, bump: 0 };
  let seq = 0;
  const marker = (max, q) => DATA_PREFIX + max + "_" + String(q) + "_" + (++seq);
  const sandbox = {
    console, Math, JSON, String, Number, Boolean, Array, Object, Error, RegExp, Promise, Date,
    SPIRIT_IMG_SIZE_LARGE: numConst("SPIRIT_IMG_SIZE_LARGE"),
    SPIRIT_IMG_SIZE: numConst("SPIRIT_IMG_SIZE"),
    CG_IMG_SIZE: numConst("CG_IMG_SIZE"),
    CG_IMG_SIZE_LOCAL: numConst("CG_IMG_SIZE_LOCAL"),
    // 压缩桩：把「长边_质量_序号」编码进 data URI，测试就能反查是哪一档出的
    shrinkToDataUri: (s, max, q) => { calls.shrink.push({ src: String(s).slice(0, 40), max: max, q: q }); return Promise.resolve(opt.shrinkFails ? "" : marker(max, q)); },
    urlToDataUri: (u, max, q) => { calls.url2data.push({ url: u, max: max, q: q }); return Promise.resolve(opt.url2dataFails ? "" : marker(max, q)); },
    // 上传桩：opt.cloudOk 决定成不成功；记录上传的是哪一档
    spiritUploadPermanent: (dataUri) => {
      calls.upload.push(String(dataUri));
      if (!opt.cloudOk) return Promise.resolve("");
      return Promise.resolve("https://cdn.example.com/permanent-" + calls.upload.length + ".jpg");
    },
    analyzeFaceBox: () => { calls.face++; return Promise.resolve({ l: 0, t: 0, w: 0, ar: 0, v: 99 }); },
    bumpGenCount: () => { calls.bump++; },
    spiritImgHtml: (item, rec, size, cls, extra, fixed) =>
      '<img class="' + cls + '" data-size="' + size + '" data-extra="' + (extra || "") + '" data-fixed="' + (fixed ? 1 : 0) + '">',
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  return { sandbox, calls, marker };
}
function load(sandbox, names) {
  const code = names.map((n) => FN[n]).filter(Boolean).join("\n") +
    "\n;__api = { imageToStoreUrl: (typeof imageToStoreUrl === 'function' ? imageToStoreUrl : null)," +
    " saveSpiritImage: (typeof saveSpiritImage === 'function' ? saveSpiritImage : null)," +
    " spiritThumbHtml: (typeof spiritThumbHtml === 'function' ? spiritThumbHtml : null) };";
  vm.runInContext(code, vm.createContext(sandbox), { filename: "app.js#extracted" });
  return sandbox.__api;
}

/* ================= 主流程 ================= */
async function main() {
  /* ---- 断言 1：常量 ---- */
  section("断言1：画质常量（v164i 抬高后的目标值）");
  const C = {
    LARGE: numConst("SPIRIT_IMG_SIZE_LARGE"), SMALL: numConst("SPIRIT_IMG_SIZE"),
    CG: numConst("CG_IMG_SIZE"), CGL: numConst("CG_IMG_SIZE_LOCAL"),
    MAIN: numConst("CG_MAIN_SIZE"), MAINQ: numConst("CG_MAIN_Q"),
    THUMB: numConst("CG_THUMB_SIZE"), THUMBQ: numConst("CG_THUMB_Q"),
    FACE: numConst("FACE_VER"),
  };
  info("实测：" + JSON.stringify(C));
  ok(C.LARGE === 1024, "SPIRIT_IMG_SIZE_LARGE = 1024（实测 " + C.LARGE + "）");
  ok(C.SMALL === 512, "SPIRIT_IMG_SIZE = 512 仍是 localStorage 兜底（实测 " + C.SMALL + "）");
  ok(C.CG === 1280, "CG_IMG_SIZE = 1280（实测 " + C.CG + "）");
  ok(C.CGL === 768, "CG_IMG_SIZE_LOCAL = 768（落 localStorage 的兜底长边，实测 " + C.CGL + "）");
  ok(C.MAIN === 1024, "CG_MAIN_SIZE = 1024（实测 " + C.MAIN + "）");
  ok(C.MAINQ === 0.85, "CG_MAIN_Q = 0.85（实测 " + C.MAINQ + "）");
  ok(C.THUMB === 512, "CG_THUMB_SIZE = 512（实测 " + C.THUMB + "）");
  ok(C.THUMBQ === 0.8, "CG_THUMB_Q = 0.8（实测 " + C.THUMBQ + "）");
  ok(C.FACE === 3, "FACE_VER = 3（2→3 触发历史取景框零成本重算，实测 " + C.FACE + "）");

  /* ---- 断言 2：A 区不变式 ---- */
  section("断言2：大图只进 Supabase，localStorage 只放小图（saveSpiritImage）");
  if (!FN.saveSpiritImage || !FN.imageToStoreUrl) {
    ok(false, "源码里抽不到 imageToStoreUrl / saveSpiritImage —— 不变式未实现（v164h 负向对照预期）");
    info("跳过 A 区其余断言");
  } else {
    const recOf = () => ({ imgHistory: [], stage: 2 });

    // 2a 云端成功
    {
      const { sandbox, calls } = makeSandbox({ cloudOk: true });
      const api = load(sandbox, ["imageToStoreUrl", "saveSpiritImage"]);
      const rec = recOf();
      const url = await api.saveSpiritImage({ id: "it1" }, rec, { b64: "QUJD" }, 3);
      const spec = calls.shrink.map((c) => c.max + "/" + c.q);
      info("2a 压缩调用：" + JSON.stringify(spec));
      ok(calls.shrink.length === 1 && calls.shrink[0].max === 1024 && calls.shrink[0].q === 0.92,
        "2a 云端成功：只压一次大图 1024/q0.92（实测 " + JSON.stringify(spec) + "）");
      ok(calls.upload.length === 1 && calls.upload[0].indexOf(DATA_PREFIX + "1024_0.92_") === 0,
        "2a 上传的是**大图**那份 1024（实测 " + calls.upload[0].slice(0, 42) + "…）");
      ok(/^https:\/\//.test(url) && rec.imgUrl === url, "2a rec.imgUrl = 云端永久 URL（实测 " + String(rec.imgUrl).slice(0, 46) + "…）");
      ok(rec.imgFrozen === true, "2a 云端图标记 imgFrozen（永不判过期）");
      ok(String(rec.imgUrl).indexOf("base64") < 0, "2a ⛔ 云端成功时 localStorage 里不能出现 data URI");
    }

    // 2b 上传失败 → 回退小图
    {
      const { sandbox, calls } = makeSandbox({ cloudOk: false });
      const api = load(sandbox, ["imageToStoreUrl", "saveSpiritImage"]);
      const rec = recOf();
      await api.saveSpiritImage({ id: "it1" }, rec, { b64: "QUJD" }, 3);
      const spec = calls.shrink.map((c) => c.max + "/" + c.q);
      info("2b 压缩调用：" + JSON.stringify(spec));
      ok(calls.shrink[0] && calls.shrink[0].max === 1024 && calls.shrink[0].q === 0.92,
        "2b 上传失败：先压大图 1024/q0.92 去试云端（实测 " + spec[0] + "）");
      ok(calls.shrink[1] && calls.shrink[1].max === 512 && calls.shrink[1].q === 0.86,
        "2b 云端没成 → 回退 512/q0.86 小图（实测 " + spec[1] + "）");
      ok(/^data:/.test(rec.imgUrl) && rec.imgUrl.indexOf("512_0.86_") > 0,
        "2b rec.imgUrl = 512 小图 data URI（实测 " + String(rec.imgUrl).slice(0, 42) + "…）");
      ok(String(rec.imgUrl).indexOf("1024_0.92_") < 0, "2b ⛔ 绝不能把 1024 的 data URI 写进 localStorage");
      ok(rec.imgFrozen === true, "2b data URI 也是永久图，标记 imgFrozen");
    }

    // 2c 入史条数：无云端 3 条 / 有云端 8 条
    {
      const { sandbox, calls: c1 } = makeSandbox({ cloudOk: false });
      const api = load(sandbox, ["imageToStoreUrl", "saveSpiritImage"]);
      const rec = recOf();
      for (let i = 0; i < 6; i++) await api.saveSpiritImage({ id: "it1" }, rec, { b64: "QUJD" + i }, 3);
      ok(rec.imgHistory.length === 3, "2c 无云端：入史只留最近 3 条（实测 " + rec.imgHistory.length + "）");
      ok(c1.face === 6, "2c 每次落图仍会重算取景框（实测 " + c1.face + " 次）");
      const { sandbox: s2 } = makeSandbox({ cloudOk: true });
      const api2 = load(s2, ["imageToStoreUrl", "saveSpiritImage"]);
      const rec2 = recOf();
      for (let i = 0; i < 10; i++) await api2.saveSpiritImage({ id: "it1" }, rec2, { b64: "QUJD" + i }, 3);
      ok(rec2.imgHistory.length === 8, "2c 有云端：入史仍留 8 条（实测 " + rec2.imgHistory.length + "）");
    }

    // 2d imageToStoreUrl：外链无 CORS → 保持原样（v164h 之前的既有行为）
    {
      const { sandbox, calls } = makeSandbox({ cloudOk: true, url2dataFails: true });
      const api = load(sandbox, ["imageToStoreUrl"]);
      const r = await api.imageToStoreUrl("https://ark.example.com/a.png", 1024, 0.92, 512, 0.86);
      ok(r.url === "https://ark.example.com/a.png" && r.cloud === false,
        "2d 外链读不到像素（无 CORS）→ 原样保留、不上传（实测 " + r.url + "）");
      ok(calls.upload.length === 0, "2d 没有像素就不上传（实测 upload " + calls.upload.length + " 次）");
    }
  }

  /* ---- 断言 3：C 区头像取景 ---- */
  section("断言3：spiritThumbHtml 放大倍数钳制");
  if (!FN.spiritThumbHtml) {
    ok(false, "抽不到 spiritThumbHtml");
  } else {
    const { sandbox } = makeSandbox({});
    const api = load(sandbox, ["spiritThumbHtml"]);
    const num = (html, re) => { const m = re.exec(html); return m ? Number(m[1]) : null; };
    const extra = (html) => (/data-extra="([^"]*)"/.exec(html) || [])[1];

    // 3a 正常框：按 f.l / f.t 精确裁切
    {
      const h = api.spiritThumbHtml({ id: "x" }, { face: { l: 0.1, t: 0.05, w: 0.5, ar: 0.75, v: 3 } }, 96);
      const wr = num(h, /data-extra="[^"]*width:(\d+)px/);
      info("3a extra=" + extra(h));
      ok(wr === 192, "3a 正常框按 size/f.w 精确放大（96/0.5=192，实测 " + wr + "）");
      ok(h.indexOf("left:-19px") > 0, "3a 按 f.l 算左边距（0.1×192=19）");
      ok(h.indexOf("top:-13px") > 0, "3a 按 f.t/f.ar 算上边距（0.05×192/0.75≈13）");
      ok(h.indexOf('data-fixed="0"') > 0, "3a 走精确裁切（fixed=0）");
    }
    // 3b 下限钳制：f.w 很大 → raw < 1.2×size → 抬到 1.2×size
    {
      const h = api.spiritThumbHtml({ id: "x" }, { face: { l: 0.1, t: 0.1, w: 0.9, ar: 0.75, v: 3 } }, 96);
      const wr = num(h, /data-extra="[^"]*width:(\d+)px/);
      ok(wr === 115, "3b 下限钳到 1.2×size=115（实测 " + wr + "）");
    }
    // 3c 上限：raw ≥ 3×size → 判取景失败，走 CSS 兜底
    {
      const h = api.spiritThumbHtml({ id: "x" }, { face: { l: 0.1, t: 0.05, w: 1 / 3, ar: 0.75, v: 3 } }, 96);
      info("3c extra=" + JSON.stringify(extra(h)));
      ok(h.indexOf('data-extra=""') > 0, "3c raw=3×size 恰好达上限 → 不裁切");
      ok(h.indexOf('data-fixed="1"') > 0, "3c 走 CSS .face 兜底（fixed=1）");
    }
    // 3d 取景框极小（放大 20×）
    {
      const h = api.spiritThumbHtml({ id: "x" }, { face: { l: 0.1, t: 0.05, w: 0.05, ar: 0.75, v: 3 } }, 96);
      ok(h.indexOf('data-extra=""') > 0 && h.indexOf('data-fixed="1"') > 0, "3d 取景框极小（放大 20×）→ 弃用硬裁，回 CSS 兜底");
    }
    // 3e 边界内最大：raw 略小于 3×size 仍允许裁切
    {
      const h = api.spiritThumbHtml({ id: "x" }, { face: { l: 0.2, t: 0.1, w: 0.35, ar: 0.75, v: 3 } }, 96);
      const wr = num(h, /data-extra="[^"]*width:(\d+)px/);
      info("3e wr=" + wr + "（96/0.35≈274，3×96=288）");
      ok(wr === 274 && wr < 288, "3e 边界内（2.85×）仍精确裁切且 <3×（实测 " + wr + "）");
    }
    // 3f 无取景数据
    {
      const h = api.spiritThumbHtml({ id: "x" }, {}, 96);
      ok(h.indexOf('data-fixed="1"') > 0, "3f 没有 face 数据 → CSS 兜底");
    }
  }

  /* ---- 断言 4：源码静态检查 ---- */
  section("断言4：三处 CG 落库都走不变式（静态检查）");
  {
    // 调用点跨两行写成，所以按「imageToStoreUrl( ... CG_IMG_SIZE_LOCAL」整段匹配
    const hits = src.match(/imageToStoreUrl\([\s\S]{0,240}?CG_IMG_SIZE_LOCAL/g) || [];
    info("走 imageToStoreUrl 的 CG 落库点：" + hits.length + " 处");
    ok(hits.length === 3, "突破 CG / 节令 CG / 房间剧情 CG 三处都走 imageToStoreUrl（实测 " + hits.length + " 处）");
    ok(/CG_IMG_SIZE, 0\.9, CG_IMG_SIZE_LOCAL, 0\.86/.test(src), "CG 落库参数 = 1280/q0.9 云端 + ≤768/q0.86 本地");
    ok(src.indexOf("CG_IMG_SIZE, 0.86") < 0, "⛔ 旧的 CG_IMG_SIZE, 0.86 直落 localStorage 已清干净");
    ok(src.indexOf(", 256, 0.72") < 0, "⛔ 旧的入史 256/0.72 已清干净");
    ok(/512, 0\.8/.test(src), "入史压缩放宽到 512/q0.8");
    ok(/hist\.slice\(\/\^https\?:\/i\.test\(url\) \? -8 : -3\)/.test(src), "入史条数：无云端 3 条 / 有云端 8 条");
  }

  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.log("测试自身抛异常：" + (e && e.stack || e)); process.exit(2); });
