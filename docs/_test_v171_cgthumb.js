/* V171 自测：沁灵列表缩略图改用进阶 CG + CG 专用头部取景（不切头）
 * 用法：
 *   node docs/_test_v171_cgthumb.js
 * 负向对照（指向改动前 = V170 3a337c6 的 app.js / skin.css，必须 FAIL）：
 *   APP_SRC_FILE=docs/_tmp/_pre_v171_app.js SKIN_FILE=docs/_tmp/_pre_v171_skin.css node docs/_test_v171_cgthumb.js
 *
 * 分工（项目纪律）：本套件只负责 CG 取景几何 + 缩略图取源 + 字段隔离 + CSS + 负向对照；
 *   任何改 render* 的 HTML 拼接都必须另跑 docs/_test_v163c_layout.js（标签栈解析）。
 *
 * ⚠️ 无真 CG 样本 → 取景做成「可自证」：用几何断言证明「框顶 ≤ 人物最上方前景行 − 6%H」「框内完整包含检测到的头框」。
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
console.log("app 源码：" + APP_FILE + "\ncss 源码：" + CSS_FILE);

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }

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

const cgCoreSrc = extractFn("cgFaceBoxFromRGBA");
const cgAnalyzeSrc = extractFn("analyzeCgFaceBox");
const cgThumbSrc = extractFn("spiritThumbCgHtml");
const thumbSrc = extractFn("spiritThumbHtml");
const imgSrc = extractFn("spiritImgHtml");
const cgFaceEnsSrc = extractFn("ensureSpiritCgFaces");

const CGV = Number((/const\s+CG_FACE_VER\s*=\s*(\d+)/.exec(appSrc) || [])[1] || 1);
const FACEV = Number((/const\s+FACE_VER\s*=\s*(\d+)/.exec(appSrc) || [])[1] || 3);

/* ================= A. CG 取景几何（核心 · 可自证） ================= */
section("A. cgFaceBoxFromRGBA —— CG 头部取景几何");
ok(!!cgCoreSrc, "抽到 cgFaceBoxFromRGBA（CG 专用取景器，⛔ 非 analyzeFaceBox）");
ok(!!cgAnalyzeSrc && /cgFaceBoxFromRGBA/.test(cgAnalyzeSrc), "analyzeCgFaceBox 走 cgFaceBoxFromRGBA");
ok(!!cgCoreSrc && !/analyzeFaceBox/.test(cgCoreSrc) && !/\bFACE_VER\b/.test(cgCoreSrc),
  "CG 取景器 ⛔ 不复用 analyzeFaceBox / FACE_VER（用独立的 CG_FACE_VER）");

// 合成一张「横版场景 CG」：纯色背景 + 中间一个竖向人物块（几何完全已知）
const W = 300, Hh = 120, BG = [20, 30, 60], FG = [240, 220, 200];
const PT = 30, PB = 110, PL = 130, PR = 170;      // 人物 bbox（top/bot/left/right）
function build() {
  const d = new Uint8ClampedArray(W * Hh * 4);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, c = (y >= PT && y <= PB && x >= PL && x <= PR) ? FG : BG;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return d;
}
function runCg(d, w, h) {
  const sb = { Uint8Array, Int32Array, Math, Object, Array, Number, CG_FACE_VER: CGV, CG_BOX_K: 1.15, CG_MARGIN_K: 0.12 };
  vm.runInNewContext(cgCoreSrc + "\n;__fn = cgFaceBoxFromRGBA;", sb, { filename: "app.js#cgFaceBoxFromRGBA" });
  return sb.__fn(d, w, h);
}
if (cgCoreSrc) {
  const res = runCg(build(), W, Hh);
  ok(res && res.w > 0 && res.ar > 0 && res.v === CGV, "A 返回有效取景框 {l,t,w,ar,v}");
  if (res) {
    const boxL = res.l * W, boxT = res.t * Hh, boxW = res.w * W, boxR = boxL + boxW, boxB = boxT + boxW;
    // 人物头部（最上方 1/4）—— 与算法同规格重算，作为「检测到的头框」
    const personH = PB - PT + 1, headH = Math.max(4, Math.round(personH * 0.25));
    const hTop = PT, hBot = Math.min(PB, PT + headH - 1), hLeft = PL, hRight = PR;
    const headLong = Math.max(hRight - hLeft + 1, hBot - hTop + 1);
    ok(boxT <= PT - 0.06 * Hh + 0.5, "A ★框顶 ≤ 人物最上方前景行 − 6%H（" + boxT.toFixed(1) + " ≤ " + (PT - 0.06 * Hh).toFixed(1) + "）");
    ok(boxT <= hTop && boxB >= hBot && boxL <= hLeft && boxR >= hRight, "A ★框内完整包含检测到的头框");
    ok(boxW >= headLong * 1.15 - 0.5, "A 取景框长边 ≥ 头框长边 ×1.15（" + boxW.toFixed(1) + " ≥ " + (headLong * 1.15).toFixed(1) + "）");
    ok(boxL >= -0.5 && boxR <= W + 0.5 && boxT >= -0.5 && boxB <= Hh + 0.5, "A 取景框不越出图片边界");
    ok(Math.abs(res.ar - W / Hh) < 1e-6, "A ar = 图宽高比");
  }
  // 全平色（无人）→ 失败
  const flat = new Uint8ClampedArray(W * Hh * 4).fill(200);
  for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
  ok(runCg(flat, W, Hh) === null, "A 无人物（全平色）→ 判失败（返回 null）");
  // 参数非法 → null
  ok(runCg(null, W, Hh) === null && runCg(build(), 0, 0) === null, "A 非法入参 → null（不抛错）");
}

/* ================= B. spiritThumbCgHtml —— 取源与兜底 ================= */
section("B. spiritThumbCgHtml（cgUrl 优先 / 无则回落立绘 / 兜底 cg18）");
ok(!!cgThumbSrc && /rec\.cgUrl/.test(cgThumbSrc) && /return spiritThumbHtml\(item, rec, size\)/.test(cgThumbSrc),
  "spiritThumbCgHtml：无 cgUrl → 完全回落 spiritThumbHtml（行为零变化）");
ok(!!cgThumbSrc && /cg18/.test(cgThumbSrc), "spiritThumbCgHtml：取景失败 → .cg18 兜底类");

function runThumb(rec) {
  const src = [thumbSrc, imgSrc, cgThumbSrc].join("\n") + "\n;__fn = spiritThumbCgHtml;";
  const sb = {
    esc: (s) => (s == null ? "" : String(s)), Math, Object, Array, Number, String,
    CG_FACE_VER: CGV, FACE_VER: FACEV,
    Spirits: { getImageCfg: () => ({ provider: "ark" }), localAvatarSvg: () => "data:image/svg+xml,<svg/>", pollinationsUrl: () => "" },
  };
  vm.runInNewContext(src, sb, { filename: "app.js#spiritThumbCgHtml" });
  return sb.__fn({ id: "i1", name: "甲" }, rec, 96);
}
if (cgThumbSrc && thumbSrc && imgSrc) {
  // 无 CG → 回落立绘（含 imgUrl）
  let h = runThumb({ imgUrl: "PORTRAIT.jpg", persona: { name: "甲" } });
  ok(/PORTRAIT\.jpg/.test(h) && !/cg18/.test(h), "B 无 cgUrl → 用 imgUrl（原立绘），无 cg18");
  // 有 CG + 有效 faceCg → 用 CG + 绝对定位裁切
  h = runThumb({ imgUrl: "PORTRAIT.jpg", cgUrl: "CG_01.jpg", faceCg: { l: 0.4, t: 0.05, w: 0.45, ar: 2.5, v: CGV }, persona: {} });
  ok(/CG_01\.jpg/.test(h) && !/PORTRAIT\.jpg/.test(h), "B 有 cgUrl → 缩略图源用 CG（⛔ 不再用立绘）");
  ok(/position:absolute/.test(h) && !/cg18/.test(h), "B 有效 faceCg → 绝对定位裁切（无 cg18）");
  // 有 CG 但无 faceCg → cg18 兜底
  h = runThumb({ imgUrl: "P.jpg", cgUrl: "CG_02.jpg", persona: {} });
  ok(/CG_02\.jpg/.test(h) && /cg18/.test(h), "B 有 CG 无 faceCg → .cg18 兜底（cover + center 18%）");
  // 有 CG 但 faceCg 版本旧 → cg18
  h = runThumb({ cgUrl: "CG_03.jpg", faceCg: { l: 0.4, t: 0, w: 0.3, ar: 2.5, v: CGV - 1 }, persona: {} });
  ok(/CG_03\.jpg/.test(h) && /cg18/.test(h), "B faceCg 版本旧 → .cg18 兜底");
  // faceCg w=0（回填失败记的一笔）→ cg18
  h = runThumb({ cgUrl: "CG_04.jpg", faceCg: { l: 0, t: 0, w: 0, ar: 0, v: CGV }, persona: {} });
  ok(/cg18/.test(h), "B faceCg w=0 → .cg18 兜底");
}

/* ================= C. 字段隔离 + 调用点 ================= */
section("C. 字段隔离（⛔ 不污染 rec.face / FACE_VER）与调用点");
ok(!!cgFaceEnsSrc && /rec\.faceCg/.test(cgFaceEnsSrc) && /CG_FACE_VER/.test(cgFaceEnsSrc),
  "ensureSpiritCgFaces：读写 rec.faceCg（独立字段）");
ok(!!cgFaceEnsSrc && !/\.face\s*=/.test(cgFaceEnsSrc), "ensureSpiritCgFaces ⛔ 不写 rec.face（不污染立绘头像框）");
ok(!!cgFaceEnsSrc && /r2\.cgUrl === rec\.cgUrl/.test(cgFaceEnsSrc), "ensureSpiritCgFaces：await 后校验 cgUrl 未变才写（防覆盖新 CG）");
ok(/const\s+CG_FACE_VER\s*=/.test(appSrc), "CG_FACE_VER 独立版本号存在");
// 两个沁灵列表调用点都用 CG 缩略图
const nCgThumb = (appSrc.match(/spiritThumbCgHtml\(it, rec, 96\)/g) || []).length;
ok(nCgThumb === 2, "两个沁灵列表调用点均改用 spiritThumbCgHtml（实际 " + nCgThumb + " 处）");
ok(!/spiritThumbHtml\(it, rec, 96\)/.test(appSrc), "沁灵列表不再直接调 spiritThumbHtml(96)");
// 两个渲染路径都挂了 ensureSpiritCgFaces
const nHook = (appSrc.match(/ensureSpiritCgFaces\(list\)/g) || []).length;
ok(nHook >= 3, "ensureSpiritCgFaces 已定义 + 两个渲染路径挂钩（合计 " + nHook + " 处）");

/* ================= D. CSS ================= */
section("D. css/skin.css 兜底样式");
ok(!/\r/.test(cssSrc), "skin.css 是 LF（无 CR）");
ok(/\.spirit-img\.cg18 \{[^}]*object-fit: cover; object-position: center 18%/.test(cssSrc),
  ".spirit-img.cg18 = cover + center 18%（不切头兜底）");

/* ================= E. 收尾 ================= */
console.log("\n===== V171 自测" + (process.env.APP_SRC_FILE || process.env.SKIN_FILE ? "（负向对照）" : "") + " =====");
console.log("PASS = " + PASS + "   FAIL = " + FAIL);
if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
