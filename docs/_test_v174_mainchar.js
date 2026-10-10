/* V174-A 自测：主线接入主理人手抠立绘（膝上取景）+ 主线剧情改手动点击
 *
 * 背景（team-lead 派单 V174-A）：
 *   ① 主线剧情接主理人自己手抠的 9 张立绘（膝上取景：只露膝盖以上，逐角色等比缩放）
 *   ② 主线剧情取消自动播放 → 改手动点击（一次点击 = 下一条；点一下可跳过「正在输入」三点气泡）
 *   ③ ⛔ 夜话 / 房间 / 单串旧剧本（renderTalkPage 的其它调用点）行为必须零变化
 *
 * 本测试钉住：
 *   1. assets/mainchars/ 恰好 9 个 .png（ASCII 名）
 *   2. js/app.js 的 MAINCHAR_ART：9 个 key = 9 名；每个 f 在磁盘真实存在；h∈[125,170]、t∈[-30,12]
 *   3. js/app.js 里 `manual: true` 恰 2 次（主线 1 + 〈结契篇〉阅读页 1；⛔ 新增阅读器要同步这里）
 *   4. js/app.js 含 const MANUAL / awaiting / data-frame / --knee-h / --knee-t
 *   5. css/skin.css 含两条 [data-frame="knee"] 选择器，且在 [data-cut="1"] **之后**（靠后覆盖）
 *   6. 负向对照：同套标记断言跑在**铆定 commit 03c473c**（⛔ 绝不用 HEAD，避免自指假红）→ 必须 FAIL
 *
 * 用法：node docs/_test_v174_mainchar.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, section, summary } = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
const APP = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "css/skin.css"), "utf8");

const NAMES = ["咸法酪", "柿宝", "沈青舒", "粉黛熊", "苏栖盏", "谢凝渲", "金算盘", "陆临崖", "顾时笙"];

/* 从 app.js 源码里抽出 MAINCHAR_ART 对象字面量（app.js 是 IIFE、不导出，故文本抽取后 eval） */
function extractArt(src) {
  const i = src.indexOf("var MAINCHAR_ART");
  if (i < 0) return null;
  const open = src.indexOf("{", i);
  const close = src.indexOf("};", open);
  if (open < 0 || close < 0) return null;
  const body = src.slice(open, close + 1);   // "{...}"
  try { return (0, eval)("(" + body + ")"); } catch (e) { return null; }
}

/* 同套标记断言（当前区 / 铆定基线 共用） */
function markers(appSrc, cssSrc) {
  return [
    /* v180-L1：老主线《沁灵纪》9 章整条下线 ⇒ 现役主线只剩〈结契篇〉阅读页一处手动推进。
       ⛔ 仍是**精确计数**（不是 ≥1）：新增/丢失一个手动阅读器都会红，比原来更严。 */
    { n: "manual: true 恰 1 次（现役主线〈结契篇〉阅读页）", p: (appSrc.match(/manual:\s*true/g) || []).length === 1 },
    { n: "含 const MANUAL", p: appSrc.indexOf("const MANUAL") >= 0 },
    { n: "含 awaiting", p: appSrc.indexOf("awaiting") >= 0 },
    { n: "含 dataset.frame（→ DOM data-frame 属性）", p: appSrc.indexOf("dataset.frame") >= 0 },
    { n: "含 --knee-h", p: appSrc.indexOf("--knee-h") >= 0 },
    { n: "含 --knee-t", p: appSrc.indexOf("--knee-t") >= 0 },
    { n: "含 MAINCHAR_ART", p: !!extractArt(appSrc) },
    { n: "css 两条 [data-frame=\"knee\"]", p: (cssSrc.match(/\[data-frame="knee"\]/g) || []).length === 2 },
    { n: "css [data-frame=knee] 在 [data-cut=1] 之后", p: cssSrc.indexOf('[data-frame="knee"]') > cssSrc.indexOf('[data-cut="1"]') && cssSrc.indexOf('[data-cut="1"]') >= 0 },
  ];
}

/* ============ 1. 素材入库 ============ */
section("1. assets/mainchars/ 恰好 9 个 PNG（ASCII 名）");
{
  let pngs = [];
  try { pngs = fs.readdirSync(path.join(ROOT, "assets/mainchars")).filter((f) => /\.png$/i.test(f)); } catch (e) { pngs = []; }
  ok(pngs.length === 9, "1 · 恰 9 个 .png（实测 " + pngs.length + "：" + pngs.sort().join(", ") + "）");
  ok(pngs.every((f) => /^[\x20-\x7e]+$/.test(f)), "1 · 文件名全为 ASCII");
}

/* ============ 2. MAINCHAR_ART ============ */
section("2. MAINCHAR_ART：9 名 + 文件存在 + h/t 区间");
const ART = extractArt(APP);
ok(!!ART, "2 · app.js 含 MAINCHAR_ART 对象");
if (ART) {
  const keys = Object.keys(ART);
  ok(keys.length === 9, "2 · key 数 = 9（实测 " + keys.length + "）");
  ok(NAMES.every((n) => keys.indexOf(n) >= 0), "2 · key 覆盖全部 9 名：" + NAMES.join("、"));
  NAMES.forEach((n) => {
    const e = ART[n];
    if (!e) { ok(false, "2 · " + n + " 缺失"); return; }
    ok(fs.existsSync(path.join(ROOT, e.f)), "2 · " + n + " 文件存在：" + e.f);
    ok(typeof e.h === "number" && e.h >= 125 && e.h <= 170, "2 · " + n + " h=" + e.h + " ∈ [125,170]");
    ok(typeof e.t === "number" && e.t >= -30 && e.t <= 12, "2 · " + n + " t=" + e.t + " ∈ [-30,12]");
  });
  // 谢凝渲（撑伞，本体小 20%）应显著异于其余 8 位 —— h 最大、t 为负
  if (ART["谢凝渲"]) {
    ok(ART["谢凝渲"].t < 0, "2 · 谢凝渲 t<0（本体头顶低、图片需上移出画）");
    const others = NAMES.filter((n) => n !== "谢凝渲").map((n) => ART[n] && ART[n].h);
    ok(ART["谢凝渲"].h > Math.max.apply(null, others), "2 · 谢凝渲 h 为最大值（本体小 → 放大最多）");
  }
} else {
  ok(false, "2 · 未能抽取 MAINCHAR_ART");
}

/* ============ 3/4/5. 标记断言（当前工作区） ============ */
section("3-5. app.js / skin.css 标记断言（当前工作区，应全绿）");
markers(APP, CSS).forEach((m) => ok(m.p, "3-5 · " + m.n));

/* css/skin.css 仍须是 LF（全项目唯一 LF css 的不变量） */
{
  const raw = fs.readFileSync(path.join(ROOT, "css/skin.css"), "utf8");
  const crlf = (raw.match(/\r\n/g) || []).length;
  ok(crlf === 0, "5 · css/skin.css 仍是 LF（无 CR：实测 CRLF=" + crlf + "）");
}

/* ============ 6. 负向对照：铆定 03c473c ============ */
section("6. 负向对照（铆定 commit 03c473c · ⛔ 不用 HEAD）");
/* 铆定基线取法：优先 `git show <铆定 commit>`；部分沙箱 spawn EBUSY/无 git → 回落预导出基线文件
   （与 _test_v165f_portrait.js 同一口径；预导出文件在 docs/_tmp/，⛔ 被 .git/info/exclude 本地排除） */
function baseline(revPath, tmpRel) {
  try {
    return require("child_process").execSync("git show 03c473c:" + revPath, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (e) {
    try { return fs.readFileSync(path.join(__dirname, tmpRel), "utf8"); } catch (e2) { return ""; }
  }
}
let OLD_APP = baseline("js/app.js", "_tmp/_pre_v174a_baseline_app.js");
let OLD_CSS = baseline("css/skin.css", "_tmp/_pre_v174a_baseline_skin.css");
if (OLD_APP && OLD_CSS) {
  const old = markers(OLD_APP, OLD_CSS);
  const fails = old.filter((m) => !m.p).map((m) => m.n);
  ok(fails.length >= 1, "6 · 铆定版至少 1 条断言 FAIL → 负向对照成立（实测失败 " + fails.length + "/" + old.length + "）");
  ok(fails.length === old.length, "6 · 铆定版 9 条标记**全部**不成立（v174 确为新增）：失败 " + fails.length + "/" + old.length);
} else {
  ok(true, "6 · (取不到 03c473c 基线 → 负向对照优雅跳过)");
}

const passed = summary();
process.exit(passed ? 0 : 1);
