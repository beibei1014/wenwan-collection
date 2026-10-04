/* V172-A 自测：CG 取景 = 固定几何框（V171 自适应决策已在真 CG 上验穿，已删除）
 * 用法：
 *   node docs/_test_v172a_cgbox.js
 * 负向对照（指向改动前 = V171 f43717d 的 app.js / skin.css，必须 FAIL）：
 *   APP_SRC_FILE=docs/_tmp/_pre_v172a_app.js SKIN_FILE=docs/_tmp/_pre_v172a_skin.css node docs/_test_v172a_cgbox.js
 *
 * ⚠️ 为什么换成「不变量」断言：V171 用的是「合成图断言」（合成一张有人物的图、断言框住头），
 *    但它拦不住真图 —— team-lead 用 15 张真 CG（1280×960）实测：10 张判失败、4 张框错
 *    （有一张框落在人物腰际的手上）、仅 1 张对。固定框只依赖 cw/ch、不看像素，
 *    所以可以断言**任何像素输入都返回同一个框** —— 这个断言比合成图强得多。
 *
 * 分工（项目纪律）：本套件只负责 CG 取景几何 + 缩略图取源 + 字段隔离 + CSS + prompt 锚 + 负向对照；
 *   任何改 render* 的 HTML 拼接都必须另跑 docs/_test_v163c_layout.js（标签栈解析）。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = process.env.APP_SRC_FILE ? path.resolve(process.env.APP_SRC_FILE) : path.join(ROOT, "js/app.js");
const CSS_FILE = process.env.SKIN_FILE ? path.resolve(process.env.SKIN_FILE) : path.join(ROOT, "css/skin.css");
const appSrc = fs.readFileSync(APP_FILE, "utf8");
const cssSrc = fs.readFileSync(CSS_FILE, "utf8");
const spSrc = fs.readFileSync(path.join(ROOT, "js/spirits.js"), "utf8");
console.log("app 源码：" + APP_FILE + "\ncss 源码：" + CSS_FILE);

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

/* ---------- 源码抽函数（大括号配对，跳过字符串/注释） ---------- */
function extractFn(name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(appSrc);
  if (!m) return null;
  let i = appSrc.indexOf("(", m.index), pd = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === "(") pd++;
    else if (appSrc[i] === ")") { pd--; if (pd === 0) { i++; break; } }
  }
  while (i < appSrc.length && appSrc[i] !== "{") i++;
  let depth = 0;
  for (; i < appSrc.length; i++) {
    const ch = appSrc[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < appSrc.length) { if (appSrc[i] === "\\") { i += 2; continue; } if (appSrc[i] === q) break; i++; }
      continue;
    }
    if (ch === "/" && appSrc[i + 1] === "/") { while (i < appSrc.length && appSrc[i] !== "\n") i++; continue; }
    if (ch === "/" && appSrc[i + 1] === "*") { const e = appSrc.indexOf("*/", i); i = e < 0 ? appSrc.length : e + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return appSrc.slice(m.index, i);
}

const coreSrc = extractFn("cgFaceBoxFromRGBA");
const analyzeSrc = extractFn("analyzeCgFaceBox");
const cgThumbSrc = extractFn("spiritThumbCgHtml");
const thumbSrc = extractFn("spiritThumbHtml");
const imgSrc = extractFn("spiritImgHtml");
const ensSrc = extractFn("ensureSpiritCgFaces");

const num = (re) => { const m = re.exec(appSrc); return m ? Number(m[1]) : NaN; };
const CGV = num(/const\s+CG_FACE_VER\s*=\s*(\d+)/);
const SIDE_K = num(/const\s+CG_BOX_SIDE_K\s*=\s*([\d.]+)/);
const TOP_K = num(/const\s+CG_BOX_TOP_K\s*=\s*([\d.]+)/);

/* ================= A. 版本号 & 常量 ================= */
section("A. 版本号 / 常量");
ok(CGV === 2, "A 🔴 CG_FACE_VER = 2（必须升：让 V171 写进 localStorage 的错框全部重算，实际 " + CGV + "）");
ok(near(SIDE_K, 0.48), "A CG_BOX_SIDE_K = 0.48（取景框边长 = 0.48 × 图高）");
ok(near(TOP_K, 0.02), "A CG_BOX_TOP_K = 0.02（框顶距顶端 2% 图高）");
ok(!!coreSrc && !/CG_BOX_K\b|CG_MARGIN_K|bestArea|isFg|Int32Array/.test(coreSrc),
  "A 自适应决策已删除（无连通域标注 / 无前景判定 / 无旧常量）");

/* ================= B. 不变量：像素无关（核心） ================= */
section("B. 不变量断言（不看像素 ⇒ 任何输入同一框）");
function makePx(w, h, kind) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (kind === "black") { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; }
    else if (kind === "noise") { d[i] = (p * 37) % 256; d[i + 1] = (p * 91) % 256; d[i + 2] = (p * 13) % 256; }
    else { d[i] = 250; d[i + 1] = 250; d[i + 2] = 250; }
    d[i + 3] = 255;
  }
  return d;
}
function runBox(d, W, H) {
  const sb = { Math, Number, Object, CG_FACE_VER: CGV, CG_BOX_SIDE_K: SIDE_K, CG_BOX_TOP_K: TOP_K };
  vm.runInNewContext(coreSrc + "\n;__fn = cgFaceBoxFromRGBA;", sb, { filename: "app.js#cgFaceBoxFromRGBA" });
  return sb.__fn(d, W, H);
}
if (coreSrc) {
  const CW = 1280, CH = 960;
  const a = runBox(makePx(CW, CH, "black"), CW, CH);
  const b = runBox(makePx(CW, CH, "noise"), CW, CH);
  const c = runBox(makePx(CW, CH, "white"), CW, CH);
  ok(JSON.stringify(a) === JSON.stringify(b), "B ★全黑像素 === 随机噪声像素（完全不看像素）");
  ok(JSON.stringify(a) === JSON.stringify(c), "B ★全黑像素 === 全白像素");
  ok(runBox(null, CW, CH) !== null && JSON.stringify(runBox(null, CW, CH)) === JSON.stringify(a),
    "B ★d=null（analyzeCgFaceBox 的真实调用形式）也返回同一框");

  // 1280×960 的精确值：x 410~870（32%~68%）、y 19~480
  const side = 0.48 * CH;                     // 460.8
  ok(a && near(a.l, 0.32), "B l = 0.32（x0 = cw/2 − side/2 = 409.6，实测 " + (a && a.l) + "）");
  ok(a && near(a.t, 0.02), "B t = 0.02（y0 = 19.2，实测 " + (a && a.t) + "）");
  ok(a && near(a.w, 0.36), "B w = side/cw = 460.8/1280 = 0.36（**宽度占比**，实测 " + (a && a.w) + "）");
  ok(a && near(a.ar, 4 / 3), "B ar = cw/ch = 4/3");
  ok(a && a.v === 2, "B v = CG_FACE_VER = 2");
  ok(a && near(a.w * a.ar, 0.48),
    "B ★高度占比 = w×ar = 0.48 —— team-lead 那句 `w:0.48` 实为**高度占比**（side/ch），" +
    "若把 0.48 填进 w，框会变成 x32%~80%（410~1024、宽 614px），就不是目视通过的那个框了");

  // team-lead 要求的几何不变量
  ok(side / CH <= 1, "B 不变量：side/ch ≤ 1（0.48）");
  ok(side >= 0.4 * CH, "B 不变量：side ≥ 0.4×ch");
  ok(a && a.l >= 0 && a.l + a.w <= 1 && a.t >= 0 && a.t + a.w * a.ar <= 1, "B 不变量：框不越出图片边界");
  ok(a && near(a.l + a.w / 2, 0.5), "B 不变量：框水平居中（l + w/2 = 0.5）");

  // 另一尺寸（2304×1728，同 4:3）→ 同一组占比
  const d2 = runBox(makePx(2304, 1728, "noise"), 2304, 1728);
  ok(d2 && near(d2.l, 0.32) && near(d2.t, 0.02) && near(d2.w, 0.36) && near(d2.ar, 4 / 3),
    "B 换尺寸 2304×1728 → 同一组占比（只依赖宽高比，不依赖绝对尺寸）");
  // 非法入参
  ok(runBox(makePx(4, 4, "black"), 0, 100) === null, "B W=0 → null（不抛错）");
  ok(runBox(makePx(4, 4, "black"), 100, 0) === null, "B H=0 → null（不抛错）");
}

/* ================= C. analyzeCgFaceBox 不再读像素 ================= */
section("C. analyzeCgFaceBox：只读宽高，不用 canvas");
ok(!!analyzeSrc && /naturalWidth/.test(analyzeSrc) && /naturalHeight/.test(analyzeSrc),
  "C 读 img.naturalWidth / naturalHeight");
ok(!!analyzeSrc && !/getImageData|createElement\("canvas"\)|drawImage/.test(analyzeSrc),
  "C ⛔ 不再 canvas / getImageData（消掉 CORS 污染风险，也更快）");
ok(!!analyzeSrc && !/crossOrigin/.test(analyzeSrc), "C 不再设 crossOrigin（不读像素就不需要跨域）");
ok(!!analyzeSrc && /resolve\(null\)/.test(analyzeSrc), "C 加载失败 → null（不抛错）");

/* ================= D. spiritThumbCgHtml / 字段隔离（⛔ 别碰的部分必须原样） ================= */
section("D. 缩略图取源与字段隔离（V171 已验证的行为不得回退）");
ok(!!cgThumbSrc && /!rec \|\| !rec\.cgUrl/.test(cgThumbSrc) && /return spiritThumbHtml\(item, rec, size\)/.test(cgThumbSrc),
  "D rec.cgUrl 触发条件不变：无 cgUrl → 完全回落 spiritThumbHtml（立绘）");
ok(!!cgThumbSrc && /cg18/.test(cgThumbSrc), "D .cg18 兜底仍在");
ok(!!ensSrc && /rec\.faceCg/.test(ensSrc) && /CG_FACE_VER/.test(ensSrc), "D ensureSpiritCgFaces 读写 rec.faceCg");
ok(!!ensSrc && !/\.face\s*=/.test(ensSrc), "D ⛔ ensureSpiritCgFaces 不写 rec.face（不污染立绘头像框）");
ok(/\bFACE_VER\b/.test(appSrc) && /const\s+FACE_VER\s*=\s*3/.test(appSrc), "D ⛔ FACE_VER（立绘）未被改动（仍 3）");
function runThumb(rec) {
  const src = [thumbSrc, imgSrc, cgThumbSrc].join("\n") + "\n;__fn = spiritThumbCgHtml;";
  const sb = {
    esc: (s) => (s == null ? "" : String(s)), Math, Object, Array, Number, String,
    CG_FACE_VER: CGV, FACE_VER: 3,
    Spirits: { getImageCfg: () => ({ provider: "ark" }), localAvatarSvg: () => "data:image/svg+xml,<svg/>", pollinationsUrl: () => "" },
  };
  vm.runInNewContext(src, sb, { filename: "app.js#spiritThumbCgHtml" });
  return sb.__fn({ id: "i1", name: "甲" }, rec, 96);
}
if (cgThumbSrc && thumbSrc && imgSrc) {
  let h = runThumb({ imgUrl: "PORTRAIT.jpg", persona: { name: "甲" } });
  ok(/PORTRAIT\.jpg/.test(h) && !/cg18/.test(h), "D 无 cgUrl → 用 imgUrl（原立绘）");
  h = runThumb({ imgUrl: "P.jpg", cgUrl: "CG_01.jpg", faceCg: { l: 0.32, t: 0.02, w: 0.36, ar: 4 / 3, v: CGV }, persona: {} });
  ok(/CG_01\.jpg/.test(h) && !/P\.jpg/.test(h), "D 有 cgUrl → 缩略图源用 CG（⛔ 不再用立绘）");
  ok(/position:absolute/.test(h) && !/cg18/.test(h), "D 有效 faceCg（v=2）→ 绝对定位裁切");
  h = runThumb({ cgUrl: "CG_02.jpg", persona: {} });
  ok(/CG_02\.jpg/.test(h) && /cg18/.test(h), "D 无 faceCg → .cg18 兜底（cover + center 18%）");
  h = runThumb({ cgUrl: "CG_03.jpg", faceCg: { l: 0.32, t: 0.02, w: 0.36, ar: 4 / 3, v: 1 }, persona: {} });
  ok(/cg18/.test(h), "D faceCg 版本旧（v=1，V171 写进去的错框）→ .cg18 兜底 + 触发重算");
}
const nCgThumb = (appSrc.match(/spiritThumbCgHtml\(it, rec, 96\)/g) || []).length;
ok(nCgThumb === 2, "D 两个沁灵列表调用点仍用 spiritThumbCgHtml（实际 " + nCgThumb + " 处）");

/* ================= E. CSS 兜底 ================= */
section("E. css/skin.css");
ok(!/\r/.test(cssSrc), "skin.css 是 LF（无 CR）");
ok(/\.spirit-img\.cg18 \{[^}]*object-fit: cover; object-position: center 18%/.test(cssSrc),
  ".spirit-img.cg18 = cover + center 18%（不切头兜底）");

/* ================= F. 出图端构图锚（让固定框成为规格保证） ================= */
section("F. spirits.js CG 构图锚");
ok(/const\s+CG_COMPOSE_ZH\s*=/.test(spSrc), "F 定义 CG_COMPOSE_ZH");
ok(/上方三分之一/.test(spSrc) && /水平居中/.test(spSrc), "F 锚句含「头部位于画面上方三分之一、水平居中」");
ok(/const anchor = [^\n]*zhAnchorEnabled[^\n]*CG_COMPOSE_ZH/.test(spSrc), "F 仅 ark 生效（同 zhAnchorEnabled 开关，与 V167 中文锚同套路）");
const retLine = (/return base \+ .*;/.exec(spSrc) || [""])[0];
ok(/anchor/.test(retLine) && /prop/.test(retLine) && retLine.indexOf("anchor") < retLine.indexOf("prop"),
  "F 构图锚插在 PROPORTION LOCK **之前**（比例锁定块仍压最末位）");

/* ================= G. 收尾 ================= */
console.log("\n===== V172-A 自测" + (process.env.APP_SRC_FILE || process.env.SKIN_FILE ? "（负向对照）" : "") + " =====");
console.log("PASS = " + PASS + "   FAIL = " + FAIL);
if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
