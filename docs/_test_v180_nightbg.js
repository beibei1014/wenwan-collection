/* v180 · 夜话静态背景「照夜鉴」自测（BG-22 + 视口锚定 + 深浅变体）
   规范源：docs/v180-夜话背景-UI设计.md §2.3 / §3.2 / §3.3 / §4.2 / §4.5 / §4.6
   用户原话（本需求唯一验收口径）：夜里弹对话时背景**不能一行一行弹出来**。

   覆盖：
     1. BG-22 数据面 —— 目录条目 / 夜话专用前缀与负向 / 图源＝Supabase 公开 bucket 永久 URL（⛔ 不随包）
        / 待出清单已空（22/22 就位）/ ensureBg 被图源短路（⛔ 不出图）
     2. skin.css 静态面 —— position:fixed 视口锚定（⛔ 绝不再是挂在 .nt-chat 上的 absolute inset:0）
        + .noimg 压制米色渐变 + L3 静态遮罩 + ⛔ 背景层零动画（无 transition/animation/@keyframes/will-change/filter）
        + 宽屏净图柱 + body.night-mode 顶/底栏变体 + ⛔ .view 入场动画（transform 包含块陷阱）已摘
     3. app.js 接线 —— renderNightTalkPage / renderLoveDmPage 传 bg:["BG-22"]；!IMM 输出 scenebg--night；
        主线沉浸 blurpane / sharppane ⛔ 不带变体类；night-mode 与 talk-open 同生同灭；
        🔴 全文件只有「进页那一次」写背景 —— msgHtml / present / 打字机一律不碰背景节点
     4. 与对话条数无关 —— 背景层尺寸不由 .nt-chat 高度决定（无内容驱动高度 / 无视差 / 无中途换图）

   用法： node docs/_test_v180_nightbg.js
   负向对照（铆定改前 commit，⛔ 不写 HEAD）：
     git show 90c8a30:js/spirits.js > docs/_tmp/neg_spirits.js
     git show 90c8a30:js/app.js     > docs/_tmp/neg_app.js
     git show 90c8a30:css/skin.css  > docs/_tmp/neg_skin.css
     SPIRITS_SRC=docs/_tmp/neg_spirits.js APP_SRC=docs/_tmp/neg_app.js SKIN_SRC=docs/_tmp/neg_skin.css node docs/_test_v180_nightbg.js
     ⇒ 本文件 3/2/4 段必须**真红**（数据面无 BG-22 / CSS 无变体规则 / app 无接线）。
   纪律：跑在「改动后源码」上必须全绿。 */
"use strict";
const fs = require("fs");
const path = require("path");
const H = require("./_harness.js");

const ROOT = path.join(__dirname, "..");
// _harness.loadFile 以「项目根」为基准解析相对路径（与 _test_v165_bg.js 同口径）
const SPIRITS_SRC = process.env.SPIRITS_SRC || "js/spirits.js";
const APP_SRC = process.env.APP_SRC || "js/app.js";
const SKIN_SRC = process.env.SKIN_SRC || "css/skin.css";
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const APP_ABS = abs(APP_SRC), SKIN_ABS = abs(SKIN_SRC);

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(c, m) { if (c) PASS++; else { FAIL++; FAILURES.push(m); console.log("  ✗ " + m); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function newS() { const c = H.makeContext(); H.loadFile(c.ctx, SPIRITS_SRC); return { S: c.sandbox.Spirits, c: c }; }
function readFileSafe(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; } }
/* ⚠️ 判「背景层零动画」前必须先去注释 —— 该规则块里那句「⛔ 此处禁止：transition / animation / will-change」
   本身含这些词，不去注释会把「禁令说明」误判成「违禁声明」。 */
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ""); }

/* 取一条 CSS 规则的声明块（用「选择器 + 空格 + {」精确定位，避开注释里的同名词） */
function ruleBody(css, sel) {
  const i = css.indexOf(sel + " {");
  if (i < 0) return null;
  const a = css.indexOf("{", i);
  const b = css.indexOf("}", a);
  if (b < 0) return null;
  return css.slice(a + 1, b);
}

(async function main() {
  /* ============ 1. BG-22 数据面 ============ */
  section("1. BG-22「照夜鉴 · 夜话」数据面（目录 / 夜话专用前缀与负向 / 图源＝Supabase 永久 URL）");
  {
    const { S } = newS();
    const cat = S.BG_CATALOG || {};
    const n22 = cat["BG-22"];
    ok(!!n22, "BG_CATALOG 里有 BG-22");
    ok(n22 && n22.key === "BG-22" && /照夜鉴/.test(n22.name || ""), "BG-22 key 自洽、命名＝照夜鉴 · 夜话");
    ok(Object.keys(cat).length === 22, "目录共 22 条 = 21 张白天系 + BG-22（实得 " + Object.keys(cat).length + "）");

    // 夜话专用常量（⛔ BG_STYLE / BG_NEG 本体一字不改）
    ok(typeof S.BG_NIGHT_STYLE === "string" && S.BG_NIGHT_STYLE.length > 200, "BG_NIGHT_STYLE 存在");
    ok(typeof S.BG_NIGHT_BODY === "string" && S.BG_NIGHT_BODY.length > 500, "BG_NIGHT_BODY 存在");
    ok(typeof S.NIGHT_NEG === "string" && S.NIGHT_NEG.length > 400, "NIGHT_NEG 存在");
    ok(S.BG_STYLE.indexOf("ancient Chinese courtyard and alley setting") > 0, "⛔ BG_STYLE 本体未动（21 张仍共用）");
    ok(/no dark horror atmosphere, no low-key lighting/.test(S.BG_NEG), "⛔ BG_NEG 本体未动（含夜话冲突句，故另开 NIGHT_NEG）");
    const NEG = String(S.NIGHT_NEG || ""), BGN = String(S.BG_NEG || "");
    ok(NEG.indexOf(BGN) < 0 && BGN.indexOf(NEG) < 0, "NIGHT_NEG 与 BG_NEG 互不包含（各管一路）");

    // 拼装：前缀 / 正文 / 负向 / NO_QING 四段
    const p = (n22 && n22.prompt) || "";
    ok(p.indexOf(S.BG_NIGHT_STYLE) === 0, "BG-22 prompt 以 BG_NIGHT_STYLE 开头（⛔ 不是 BG_STYLE）");
    ok(p.indexOf(S.BG_NIGHT_BODY) > 0, "BG-22 prompt 含 BG_NIGHT_BODY 正文");
    ok(p.indexOf(S.NIGHT_NEG) > 0 && p.indexOf(S.BG_NEG) < 0, "BG-22 含 NIGHT_NEG 且 ⛔ 不含 BG_NEG");
    ok(p.slice(-(S.NO_QING || "").length) === S.NO_QING, "BG-22 以 NO_QING 收尾（与 21 张同口径）");
    ok(/no people, empty scene/.test(p), "BG-22 空镜无人（BG 铁律）");
    ok(!/[\u4e00-\u9fff]/.test(p), "BG-22 prompt 正文无中文残留");
    ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(p), "BG-22 prompt 正文无 emoji");
    ok(/9:16/.test(S.BG_NIGHT_STYLE) && /VERTICAL PORTRAIT COMPOSITION/.test(S.BG_NIGHT_STYLE), "夜话前缀锁竖版 9:16");

    // 夜话三加码（相对 BG_NEG 的差异，规范 §3.3）
    ok(/no beads, no bracelet, no prayer beads/.test(S.NIGHT_NEG), "NIGHT_NEG 反物化：逐词禁手串/珠子");
    ok(/no shelf, no display cabinet/.test(S.NIGHT_NEG), "NIGHT_NEG 反物化：禁陈列柜/货架");
    ok(/no phone, no smartphone, no screen, no monitor, no tablet, no chat interface, no speech bubbles/.test(S.NIGHT_NEG),
      "NIGHT_NEG 反现代通讯：禁手机/屏幕/聊天界面/消息气泡");
    ok(/no Japanese mirror motifs/.test(S.NIGHT_NEG) && /no sakura mirror/.test(S.NIGHT_NEG) && /no torii/.test(S.NIGHT_NEG),
      "NIGHT_NEG 反日式镜纹（铜镜中日同形 ⇒ 双边锚定）");
    // v180-C2 改稿：光照口径必须放行「镜下自体柔光」，否则模型拒绝把琉璃画成发光体
    ok(/the warm lamp and the softly self-glowing disc are the light sources/.test(S.NIGHT_NEG),
      "NIGHT_NEG 光照口径＝暖灯 + 镜下自体柔光（v180-C2）");
    ok(S.NIGHT_NEG.indexOf("no glowing glass") < 0, "NIGHT_NEG 已摘掉 no glowing glass（⛔ 否则画不出半透明琉璃）");
    ok(/no cold blue-dominant palette/.test(S.NIGHT_NEG) && /warm color temperature throughout/.test(S.NIGHT_NEG),
      "NIGHT_NEG 反冷调锚（旧稿 R−B=−19 偏蓝＝「诡异」根因）");

    // v180-C2 改稿：正文的三处实体变更（法器悬空 / 案几茶盏 / 窗外竹林无建筑）
    ok(/floating and hovering weightless in mid-air/.test(S.BG_NIGHT_BODY) && /no cord, no chain, no hook, no stand/.test(S.BG_NIGHT_BODY),
      "正文：法器**悬空**、⛔ 无绳无链无托");
    ok(/a translucent coloured-glaze glass disc/.test(S.BG_NIGHT_BODY) && /clearly semi-transparent/.test(S.BG_NIGHT_BODY),
      "正文：半透明琉璃材质（⛔ 不是实心铜鉴）");
    ok(/a small clay teapot and two small tea bowls/.test(S.BG_NIGHT_BODY) && !/ledger book/.test(S.BG_NIGHT_BODY) && !/woven cloth/.test(S.BG_NIGHT_BODY),
      "正文：案几＝一套茶盏（⛔ 无道册 / 无布巾）");
    ok(/dense green bamboo grove/.test(S.BG_NIGHT_BODY) && /strictly no buildings/.test(S.BG_NIGHT_BODY) && /no rooftops/.test(S.BG_NIGHT_BODY),
      "正文：窗外只有竹林、⛔ 禁建筑/屋脊/街市");
    ok(/calm luminous field with very low contrast/.test(S.BG_NIGHT_BODY) && /no concentric circles/.test(S.BG_NIGHT_BODY),
      "正文：镜心锁 low contrast + 禁同心环纹（聊天安全区，规范 §2.2）");

    // v180：图的来源 = 自家 Supabase Storage 公开 bucket 的**永久公网 URL**
    //   （主理人 2026-10-10 裁定「不随包」⇒ ⛔ 不落 assets/bg/BG-22.jpg）
    const NIGHT_SRC = "https://qyrqaqayynjfovfuddec.supabase.co/storage/v1/object/public/bracelet-images/bg/BG-22-liuli-bamboo.jpg";
    ok(!!n22 && n22.src === NIGHT_SRC, "BG-22 src = Supabase 公开 bucket 永久 URL（出图已就位）");
    ok(!!n22 && /^https:\/\//.test(n22.src) && String(n22.src).indexOf("assets/") < 0,
      "⛔ BG-22 src 不是 assets/bg 随包静态路径（守住主理人「不随包」裁定）");
    ok(!fs.existsSync(path.join(ROOT, "assets", "bg", "BG-22.jpg")), "assets/bg/ 下确实没有 BG-22.jpg（未随包）");
    ok(S.bgGet("BG-22") === NIGHT_SRC, "bgGet(BG-22) 回落到公网 URL ⇒ 渲染端直接显示（⛔ 不阻塞）");
    ok(S.bgSeedKey("BG-22") === "bg:BG-22" && !!S.bgByKey("BG-22"), "seedKey / bgByKey 对 BG-22 可用");
    // 一键出全套用 !bgUrlOf(k) 过滤待出清单 ⇒ 已有 src 的 BG-22 不该再进清单
    const todo = Object.keys(cat).filter((k) => !S.bgGet(k));
    ok(todo.indexOf("BG-22") < 0, "BG-22 已不在「一键出全套」待出清单里（图源已就位）");
    ok(todo.length === 0, "22 张全部就位，待出清单为空（设置页显示「已随版本内置」）");

    // 命中图源 ⇒ ensureBg 直返：⛔ 绝不触发 deps.generate（离线 / 无 key / 无网都安全，与 21 张同口径）
    let genArgs = null;
    const deps = {
      get: (k) => S.bgGet(k), set: () => { },
      generate: (pr, o) => { genArgs = { p: pr, o: o }; return { b64: "QUJD" }; },
      toStore: () => ({ url: "https://cdn/bg/BG-22.jpg", cloud: true }),
    };
    const u = await S.ensureBg("BG-22", deps);
    ok(u === NIGHT_SRC && !genArgs, "ensureBg(BG-22) 命中图源直返（⛔ 不出图、不写库、不消耗额度）");
    ok(S.BG_SIZE === "1440x2560" && Array.isArray(S.BG_SIZE_LADDER) && S.BG_SIZE_LADDER[0] === "1440x2560",
      "出图档仍锁竖版 9:16 1440x2560（将来若重出照这个档）");
  }

  /* ============ 2. skin.css 静态面 ============ */
  section("2. skin.css：视口锚定 + 零动画 + L3 遮罩 + 深浅变体");
  {
    const css = stripComments(readFileSafe(SKIN_ABS));
    ok(css.length > 0, "skin.css 可读");

    const base = ruleBody(css, ".nt-chat > .scenebg.scenebg--night");
    ok(!!base, "存在 .nt-chat > .scenebg.scenebg--night 规则（夜话背景变体）");
    ok(!!base && /position:\s*fixed/.test(base), "🔴 背景层 position:fixed（＝病根那一行：absolute → fixed）");
    ok(!!base && /inset:\s*0/.test(base), "背景层 inset:0（锚的是视口，不是 .nt-chat）");
    ok(!!base && /z-index:\s*0/.test(base), "背景层 z-index:0（⛔ 不抢 topbar z50 / tabbar z60）");
    ok(!!base && /background-color:\s*#141019/i.test(base), "图未出时纯色兜底 #141019");
    ok(!!base && /background-size:\s*cover/.test(base) && /background-position:\s*center/.test(base), "cover + center（只按视口算一次）");

    // ⛔ 背景层零动画（红线 3 / 4）
    ok(!!base && !/\banimation\b/.test(base), "⛔ 背景层无 animation");
    ok(!!base && !/\btransition\b/.test(base), "⛔ 背景层无 transition");
    ok(!!base && !/will-change/.test(base), "⛔ 背景层无 will-change");
    ok(!!base && !/(^|[^-])filter:/.test(base.replace(/backdrop-filter:/g, "")), "⛔ 背景层无 filter（会连带 ::after 一起生效）");
    ok(!!base && !/\bopacity:\s*0/.test(base), "⛔ 背景层无 opacity:0（禁淡入）");

    // .noimg 压制（那条米色渐变正是「被拉出来」的观感来源）
    const noimg = ruleBody(css, ".nt-chat > .scenebg.scenebg--night.noimg");
    ok(!!noimg && /background-image:\s*none/.test(noimg), ".scenebg--night.noimg 压制米色渐变（background-image:none）");
    ok(/\.scenebg\.noimg\s*\{/.test(css), "⛔ 底层 .scenebg.noimg 本体未被删除（主线仍可能用）");

    // L3 静态遮罩（数值即规范 §2.5）
    const after = ruleBody(css, ".nt-chat > .scenebg.scenebg--night::after");
    ok(!!after, "存在 ::after L3 静态遮罩");
    ok(!!after && /radial-gradient\(ellipse 78% 52% at 50% 38%/.test(after), "L3 遮罩含规范给定的径向渐变（椭圆 78% 52% @ 50% 38%）");
    ok(!!after && /linear-gradient\(180deg, rgba\(14,11,9,\.72\)/.test(after), "L3 遮罩含顶部暗带（0→14%）");
    ok(!!after && /linear-gradient\(0deg,\s+rgba\(14,11,9,\.78\)/.test(after), "L3 遮罩含底部暗带（0→12%）");
    ok(!!after && !/\banimation\b/.test(after) && !/\btransition\b/.test(after), "⛔ L3 遮罩恒定无动画（含 ::after）");

    // 内容层抬升 + 系统条暗底
    ok(/\.nt-chat > \.nt-body,\s*\.nt-chat > \.nt-foot,\s*\.nt-chat > \.nt-chat-head\s*\{[^}]*z-index:\s*1/.test(css),
      "内容层（head/body/foot）抬到背景之上（z-index:1，保险层）");
    ok(/\.nt-chat > \.scenebg--night ~ \.nt-body \.nt-sys\s*\{[^}]*rgba\(24,18,14,\.55\)[^}]*#F0E6D4/.test(css),
      ".nt-sys 在暗背景上补暗底 + 亮字（对比度 ≥7:1）");

    // 宽屏净图柱（⛔ 不许再出现「模糊垫满」伪层 —— 它会画在净图柱之上反把清晰的糊掉）
    ok(/@media \(min-width: 700px\) \{\s*\.nt-chat > \.scenebg\.scenebg--night \{ background-size: 640px auto/.test(css),
      "≥700px 走「居中 640px 净图柱」");
    ok(!/\.nt-chat > \.scenebg\.scenebg--night::before/.test(css), "⛔ 未引入 ::before 模糊垫满（会盖掉净图柱）");

    // §4.6 深色变体（⛔ 默认 .topbar / .tabbar 原样不动）
    ok(/body\.night-mode \.topbar\s*\{[^}]*rgba\(14,11,9,\.86\)/.test(css), "body.night-mode .topbar 转暗");
    ok(/body\.night-mode \.topbar-title\s*\{[^}]*#F0E6D4/.test(css), "body.night-mode 顶栏标题转亮字");
    ok(/body\.night-mode \.tabbar\s*\{[^}]*rgba\(16,12,10,\.94\)/.test(css), "body.night-mode .tabbar 转暗（⛔ 仍显示，不 display:none）");
    ok(/body\.night-mode \.tab-item\s*\{[^}]*#C9B89C/.test(css) && /body\.night-mode \.tab-item\.active\s*\{[^}]*#F2B35E/.test(css),
      "body.night-mode 底栏未选中/选中两态转暖色");
    ok(!/body\.night-mode \.tabbar\s*\{[^}]*display:\s*none/.test(css), "⛔ night-mode 不藏底栏（与 talk-open 不同 —— 夜话要保留底栏）");

    // 🔴 transform 包含块陷阱：夜话页必须摘掉 #view 的入场动画（否则 fixed 背景首帧内缩、结束时跳一下）
    ok(/body\.night-mode \.view\.page-in\s*\{\s*animation:\s*none/.test(css),
      "🔴 night-mode 下摘掉 #view 的 pageIn 动画（pageIn 带 transform，会把 fixed 背景困在 .view 里）");
    ok(/\.view\.page-in\s*\{[^}]*animation:\s*pageIn/.test(css), "⛔ 默认 .view.page-in 页面入场动画未被改（只对夜话摘）");

    // reduced-motion：背景本无动画 ⇒ 降级对它是空操作（红线 8）
    const rm = css.indexOf("@media (prefers-reduced-motion: reduce)");
    ok(rm > 0, "存在 reduced-motion 降级段");
    ok(!/prefers-reduced-motion[\s\S]{0,400}scenebg--night[^}]*animation:\s*[a-z]/.test(css),
      "⛔ reduced-motion 里不给夜话背景「补」动画（本就不该有）");
  }

  /* ============ 3. app.js 接线 ============ */
  section("3. app.js：bg 传参 / 变体类 / night-mode 开关 / ⛔ 只有一次写背景");
  {
    const app = readFileSafe(APP_ABS);
    ok(app.length > 0, "app.js 可读");

    // 3.1 两处夜话页都传 bg:["BG-22"]
    ok(/renderNightTalkPage/.test(app), "renderNightTalkPage 仍在");
    const iNight = app.indexOf("function renderNightTalkPage");
    const nightBlock = iNight >= 0 ? app.slice(iNight, iNight + 3000) : "";
    ok(/bg:\s*\["BG-22"\]/.test(nightBlock), "renderNightTalkPage 传 bg:[\"BG-22\"]");
    const iDm = app.indexOf("function renderLoveDmPage");
    const dmBlock = iDm >= 0 ? app.slice(iDm, iDm + 6000) : "";
    ok(/bg:\s*\["BG-22"\]/.test(dmBlock), "renderLoveDmPage（私聊）同样传 bg:[\"BG-22\"]（与群聊共用同一张）");
    ok(!/bg:\s*\["BG-\d+"[^\]]*\]/.test(app.replace(/\[\s*"BG-22"\s*\]/g, "[]")), "⛔ 夜话之外没有第二处传 BG key（防中途换图）");

    // 3.2 !IMM 输出变体类；主线沉浸两层 ⛔ 不带
    ok(/class="scenebg scenebg--night/.test(app), "非沉浸（夜话）分支输出 class=\"scenebg scenebg--night\"");
    ok(/class="scenebg blurpane/.test(app) && !/class="scenebg blurpane scenebg--night/.test(app), "⛔ 主线沉浸 blurpane 不带夜话变体类");
    ok(/class="scenebg sharppane/.test(app) && !/class="scenebg sharppane scenebg--night/.test(app), "⛔ 主线沉浸 sharppane 不带夜话变体类");

    // 3.3 night-mode 开关：与 talk-open 同生同灭
    ok(/classList\.toggle\("night-mode",\s*!IMM\)/.test(app), "renderTalkPage 里 classList.toggle(\"night-mode\", !IMM)");
    ok(/classList\.add\("talk-open"\)/.test(app), "talk-open 仍由 renderTalkPage 加（IMm 分支）");
    ok(/classList\.remove\("talk-open"\);[\s\S]{0,200}classList\.remove\("night-mode"\);/.test(app),
      "router() 中央分发处紧邻移除 talk-open / night-mode（⛔ 不漏删）");
    ok(!/classList\.add\("night-mode"\)/.test(app), "⛔ 没有别处无条件加 night-mode（只走 toggle）");

    // 3.4 🔴 红线 2：全文件只有「进页那一次」写背景 —— 逐条 / 打字机 / present 一律不碰
    ok((app.match(/id="sceneBgLayer"/g) || []).length === 2 && (app.match(/id="sceneBgBlur"/g) || []).length === 1,
      "背景层节点只在 renderTalkPage 的 innerHTML 里输出（沉浸分支 Blur+Layer / 夜话分支 Layer，⛔ 无第二处建层）");
    ok((app.match(/\$\("#sceneBg/g) || []).length === 0,
      "⛔ 全文件没有额外的 $(\"#sceneBg…\") 直查（写入只走 renderTalkPage 里那一处 forEach）");
    ok(!/setInterval[\s\S]{0,200}sceneBgLayer/.test(app), "⛔ 无定时器触碰背景层");
    ok(!/requestAnimationFrame[\s\S]{0,200}sceneBgLayer/.test(app), "⛔ 无 rAF 触碰背景层");
    // present（逐条呈现层）里不得出现背景节点
    const iP = app.indexOf("const present = (m) =>");
    const presentBlock = iP >= 0 ? app.slice(iP, iP + 2600) : "";
    ok(presentBlock.length > 0 && !/sceneBg|scenebg/.test(presentBlock), "⛔ present() 逐条呈现层不触碰背景节点（打字机不得联动背景）");
    // msgHtml（气泡拼接）里不得出现背景节点
    const iM = app.indexOf("const msgHtml");
    const msgBlock = iM >= 0 ? app.slice(iM, iM + 2600) : "";
    ok(msgBlock.length > 0 && !/sceneBg|scenebg/.test(msgBlock), "⛔ msgHtml() 气泡拼接不触碰背景节点");
    // 背景只在 renderTalkPage 的初始化赋值点写一次（style.backgroundImage）
    const bgWrites = (app.match(/style\.backgroundImage/g) || []).length;
    ok(bgWrites === 1, "🔴 全文件仅一处 style.backgroundImage 赋值（＝进页那一次；实得 " + bgWrites + "）");
  }

  /* ============ 4. 与对话条数无关（禁内容驱动高度 / 视差 / 中途换图） ============ */
  section("4. ⛔ 背景尺寸与消息条数彻底解耦");
  {
    const css = readFileSafe(SKIN_ABS);
    const base = ruleBody(css, ".nt-chat > .scenebg.scenebg--night");
    ok(!!base && /position:\s*fixed/.test(base) && !/position:\s*absolute/.test(base),
      "背景层是 fixed（⛔ 不是挂在 .nt-chat 上的 absolute inset:0 —— 那才会随内容长）");
    ok(!/background-attachment/.test(base || ""), "⛔ 未用 background-attachment:scroll 式随内容铺开");
    ok(!/scroll|parallax|translateY\(var/.test(base || ""), "⛔ 背景层无滚动/视差表达式");
    const app = readFileSafe(APP_ABS);
    ok(!/addEventListener\(\s*"scroll"[\s\S]{0,200}sceneBg/.test(app), "⛔ 无滚动监听改背景");
    ok(!/\.custom\(|window\.onresize[\s\S]{0,200}sceneBg/.test(app), "⛔ 无 resize 监听改背景");
  }

  console.log("\n────────────────────────────────────────");
  console.log((FAIL === 0 ? "✅ ALL PASS" : "❌ FAILED") + "   PASS=" + PASS + "  FAIL=" + FAIL);
  if (FAIL) { console.log("失败项："); FAILURES.forEach((m) => console.log("  - " + m)); }
  process.exit(FAIL ? 1 : 0);
})();
