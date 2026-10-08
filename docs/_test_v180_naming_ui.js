/* ============================================================
 * _test_v180_naming_ui.js · V180-D 第二段（提交②）· app 层落库 / 解析器 / 接入锚点
 * ------------------------------------------------------------
 * 姊妹篇：docs/_test_v180_naming.js（引擎侧生成器：nameSpecLocal / nameSpecCandidates / prompt 注入）。
 * 本文件只覆盖 app.js 侧的 D-9~D-13：
 *      (0) 接入锚点逐一到场：openNamingSpecModal / applyNamingChoice / spiritCardOf / #sdNameSpec
 *          入口 / 主路径 openNamingSpecModal(item) / 补档路径 namingPending / 详情页 idCard 取 spiritCardOf
 *      (1) spiritCardOf(dispName, rec) 真跑：① 身份表优先 ② rec.naming 回落 ③ 无 ⇒ null
 *      (2) applyNamingChoice(item, rec, cand) 真跑：写 rec.naming 四件套 + rec.name + namedBySpec
 *          + namingPending=false；⛔ 不写 nameEdited（不复用改名语义）
 *      (3) normRecV165 真跑：补 naming/namedBySpec/namingPending 三个默认字段；已有值不覆盖；
 *          ⛔ 只补字段、绝不触发生成/出图（遵 V179 惯例）
 *      (4) 反物化护栏：新弹窗块文案不含「它 / 盘 / 装睡」禁用词
 *
 * 只按源码字符串 + 抽出纯函数跑判定：不 require/运行整个 app.js、不依赖 DOM。
 * 用法： node docs/_test_v180_naming_ui.js
 * 负向对照： V180_APP_SRC=<提交②前的 app.js> node docs/_test_v180_naming_ui.js ⇒ 必须红
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_PATH = process.env.V180_APP_SRC || path.join(ROOT, "js", "app.js");
const SP_PATH = process.env.V180_SP_SRC || path.join(ROOT, "js", "spirits.js");
const read = (p) => { try { return fs.readFileSync(p, "utf8").replace(/\r/g, ""); } catch (e) { return ""; } };
const APP = read(APP_PATH);
const SP = read(SP_PATH);

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) PASS++;
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

console.log("V180-D 第二段 app 层回归　源码：" + APP_PATH);
console.log("------------------------------------------------------------");

/* ---------- (0) 接入锚点 ---------- */
section("0 · 接入锚点（D-9~D-13 逐一到场）");
ok(/function openNamingSpecModal\(item, rec\) \{/.test(APP), "app.js 定义 openNamingSpecModal(item, rec)");
ok(/function applyNamingChoice\(item, rec, cand\) \{/.test(APP), "app.js 定义 applyNamingChoice(item, rec, cand)");
ok(/function spiritCardOf\(dispName, rec\) \{/.test(APP), "app.js 定义 spiritCardOf(dispName, rec)");
ok(/Spirits\.nameSpecCandidates\(item, namingUsedNow\(\)\)/.test(APP), "弹窗经 Spirits.nameSpecCandidates 取候选");
ok(/const idCard = spiritCardOf\(_disp, rec\);/.test(APP), "详情页 idCard 取值改走 spiritCardOf（D-12）");
// 主路径：开沁 toast 之后
ok(/toast\("🎉 开沁了！是只"[\s\S]{0,900}?openNamingSpecModal\(item\);/.test(APP), "主路径 born isNew 分支调 openNamingSpecModal(item)（D-10）");
ok(/if \(!\(_nr\.naming && _nr\.naming\.name\)\) \{ _nr\.namingPending = true; Spirits\.save\(_ns\); \}/.test(APP),
  "主路径置 namingPending（「稍后再说」后仍留详情页入口）");
// 补档路径：只置标记，不弹窗
ok(/if \(!\(rr\.naming && rr\.naming\.name\)\) \{ rr\.namingPending = true; Spirits\.save\(s\); \}/.test(APP),
  "补档路径置 namingPending（⛔ 不弹窗，D-11）");
ok(/id="sdNameSpec">✏️ 按命名规格取个名<\/button>/.test(APP), "详情页「按命名规格取个名」入口按钮存在");
ok(/if \(nsp\) nsp\.onclick = \(\) => openNamingSpecModal\(it\);/.test(APP), "该入口 onclick 绑到 openNamingSpecModal");
ok(/rec\.namingPending && !\(rec\.naming && rec\.naming\.name\)/.test(APP), "入口仅对「待命名且未命名」显示");

/* ---------- (0b) 反物化护栏：新弹窗块禁用词 ---------- */
section("0b · 反物化护栏（新弹窗块不含 它 / 盘 / 装睡）");
let BLK = "";
try {
  const mBlk = /\* v180-D9\/D10\/D13：开沁命名规格弹窗[\s\S]*?\* v127：沁灵「设定向导」/.exec(APP);
  BLK = mBlk ? mBlk[0] : "";
} catch (e) { BLK = ""; }
ok(BLK.length > 200, "能定位 v180-D9/D10/D13 弹窗源码块（实长 " + BLK.length + "）");
ok(!/它/.test(BLK), "⛔ 弹窗块不含「它」（反物化）");
ok(!/盘/.test(BLK), "⛔ 弹窗块不含「盘」");
ok(!/装睡/.test(BLK), "⛔ 弹窗块不含「装睡」");

/* ---------- 抽出函数并真跑 ---------- */
function extract(re, src) {
  const m = re.exec(src);
  return m ? m[0] : "";
}
const SRC_CARD = extract(/function spiritCardOf\(dispName, rec\) \{[\s\S]*?\n  \}/, APP);
const SRC_APPLY = extract(/function applyNamingChoice\(item, rec, cand\) \{[\s\S]*?\n  \}/, APP);
const SRC_NORM = extract(/function normRecV165\(rec, item\) \{[\s\S]*?\n  \}/, SP);
const SRC_USED = extract(/function namingUsedNow\(\) \{[\s\S]*?\n  \}/, APP);
const SRC_OPEN = extract(/function openNamingSpecModal\(item, rec\) \{[\s\S]*?\n  \}/, APP);

/* ---------- (1) spiritCardOf 真跑 ---------- */
section("1 · spiritCardOf 真跑（① 身份表优先 ② rec.naming 回落 ③ 无 ⇒ null）");
ok(SRC_CARD.length > 0, "能抽出 spiritCardOf 源码（抽不到 ⇒ 函数不存在）");
if (SRC_CARD.length) {
  const IDENT = { "柿宝": { name: "楚柿遥", style: "秋晏", poem: "剑过秋林，丹柿落肩，一笑便扫尽风尘。", eight: "丹柿随身，笑赴山河", bead: "柿柿如意" } };
  const ctx = vm.createContext({ spiritIdentityOf: (n) => (IDENT[n] || null) });
  vm.runInContext(SRC_CARD + "\n;__F = spiritCardOf;", ctx);
  const card = ctx.__F;

  // ① 身份表命中优先（即便 rec.naming 也有值，也走身份表）
  const a = card("柿宝", { naming: { name: "别个名", style: "XX", poem: "p，x。", eight: "aaa，bbbb" } });
  ok(a && a.name === "楚柿遥" && a.style === "秋晏", "① 身份表命中 ⇒ 优先返回身份表（实得 " + (a && a.name) + "）");
  ok(a && a.bead === "柿柿如意", "① 身份表命中 ⇒ 带 bead（供反查/立绘）");

  // ② 身份未命中 + 有 rec.naming ⇒ 逐串命名
  const b = card("新手串", { naming: { name: "江冽茗", style: "澄观", poem: "冰瓯浮丹，微甘入喉。", eight: "冰瓯澄观，懒看浮生" } });
  ok(b && b.name === "江冽茗" && b.style === "澄观" && b.poem.indexOf("，") >= 0 && b.eight.indexOf("，") >= 0,
    "② 未命中身份 + 有 rec.naming ⇒ 返回逐串四件套");
  ok(b && b.bead === "", "② 逐串命名无手串名 ⇒ bead 为空串（不为 undefined）");

  // ③ 两者皆无 ⇒ null（回落不显示字/诗/八字）
  ok(card("新手串", {}) === null, "③ 无身份、无 naming ⇒ null");
  ok(card("新手串", { naming: null }) === null, "③ naming 为 null ⇒ null");
  ok(card("新手串", { naming: { name: "" } }) === null, "③ naming 无 name ⇒ null");
  ok(card("新手串", undefined) === null, "③ rec 为 undefined ⇒ null（不报错）");
}

/* ---------- (2) applyNamingChoice 真跑 ---------- */
section("2 · applyNamingChoice 真跑（写 naming 四件套 + name + 标记）");
ok(SRC_APPLY.length > 0, "能抽出 applyNamingChoice 源码");
if (SRC_APPLY.length) {
  const store = { A: { name: "旧名", nameEdited: true, namingPending: true } };
  const saves = [];
  const ctx = vm.createContext({
    Spirits: {
      load: () => store,
      ensureIn: (s, id) => { if (!s[id]) s[id] = {}; return s[id]; },
      save: (s) => { saves.push(s); },
    },
  });
  vm.runInContext(SRC_APPLY + "\n;__F = applyNamingChoice;", ctx);
  const apply = ctx.__F;
  const cand = { name: "江冽茗", style: "澄观", poem: "冰瓯浮丹，微甘入喉。", eight: "冰瓯澄观，懒看浮生", src: "llm" };
  apply({ id: "A" }, null, cand);
  const r = store.A;
  ok(r.naming && r.naming.name === "江冽茗" && r.naming.style === "澄观" && r.naming.poem === cand.poem && r.naming.eight === cand.eight,
    "rec.naming 四件套逐字落库");
  ok(r.naming && r.naming.src === "llm", "rec.naming.src 保留候选来源（llm）");
  ok(r.naming && typeof r.naming.at === "number" && r.naming.at > 0, "rec.naming.at 盖时间戳");
  ok(r.name === "江冽茗", "rec.name 同步为姓名（复用现有显示链）");
  ok(r.namedBySpec === true, "rec.namedBySpec = true（命名来源标记）");
  ok(r.namingPending === false, "rec.namingPending = false（待命名消解）");
  ok(r.nameEdited === true, "⛔ 不覆写 nameEdited（不复用改名语义，保持原值）");
  ok(saves.length === 1, "只落库一次（Spirits.save 调 1 次）");

  // src 缺省 ⇒ manual
  const store2 = { B: {} };
  const ctx2 = vm.createContext({ Spirits: { load: () => store2, ensureIn: (s, id) => (s[id] = s[id] || {}), save: () => {} } });
  vm.runInContext(SRC_APPLY + "\n;__F = applyNamingChoice;", ctx2);
  ctx2.__F({ id: "B" }, null, { name: "白知安", style: "慎之", poem: "x，y。", eight: "aaaa，bbbb" });
  ok(store2.B.naming && store2.B.naming.src === "manual", "cand.src 缺省 ⇒ 落库 src=\"manual\"");
}

/* ---------- (3) normRecV165 真跑 ---------- */
section("3 · normRecV165 真跑（补 3 默认字段 · 只补不生成）");
ok(SRC_NORM.length > 0, "能抽出 normRecV165 源码");
if (SRC_NORM.length) {
  const ctx = vm.createContext({ HEART_CFG: { MAX: 100 }, LOVE_STATES: ["none"], stageOf: () => 1 });
  vm.runInContext(SRC_NORM + "\n;__F = normRecV165;", ctx);
  const norm = ctx.__F;

  // 老档（无 v180 字段）⇒ 补默认
  const old = { heart: 5 };
  const o = norm(old, null);
  ok(o.naming === null, "老档补 rec.naming = null");
  ok(o.namedBySpec === false, "老档补 rec.namedBySpec = false");
  ok(o.namingPending === false, "老档补 rec.namingPending = false");

  // 已有值 ⇒ 不被覆盖
  const named = { naming: { name: "江冽茗", style: "澄观", poem: "p，q。", eight: "aaaa，bbbb", src: "llm", at: 123 }, namedBySpec: true, namingPending: true };
  const n2 = norm(named, null);
  ok(n2.naming && n2.naming.name === "江冽茗", "已有 rec.naming ⇒ 不覆盖");
  ok(n2.namedBySpec === true, "已有 namedBySpec=true ⇒ 保持 true");
  ok(n2.namingPending === true, "已有 namingPending=true ⇒ 保持 true");

  // ⛔ 只补字段：函数体内不得出现任何「生成 / 出图」调用（遵 V179 惯例）
  ok(!/nameSpec|persona\(|generateImage|buildLookTags|ensureDiary/.test(SRC_NORM),
    "⛔ normRecV165 只补字段：不含 nameSpec*/persona()/generateImage/出图类调用");
  // 未知字段也补（naming === undefined ⇒ null，非 undefined 泄漏）
  const bare = norm({}, null);
  ok(bare.naming === null && bare.naming !== undefined, "naming 归一为 null（不残留 undefined）");
}

/* ---------- (3b) namingUsedNow 覆盖身份表 16 条（v180-F2 单一真源） ---------- */
section("3b · namingUsedNow 并入身份表 16 条（name/style/姓，去重并集）");
const SRC_IDENT = extract(/var SPIRIT_IDENTITIES = \[[\s\S]*?\n  \];/, APP);
ok(SRC_IDENT.length > 0 && SRC_USED.length > 0, "能抽出 SPIRIT_IDENTITIES + namingUsedNow");
if (SRC_IDENT.length && SRC_USED.length) {
  const store3b = { A: { naming: { name: "自定义名", style: "自定义字" } }, B: { name: "手填名" } };
  const ctx3b = vm.createContext({ Spirits: { load: () => store3b } });
  vm.runInContext(SRC_IDENT + "\n" + SRC_USED + "\n;__U = namingUsedNow(); __I = SPIRIT_IDENTITIES;", ctx3b);
  const U = ctx3b.__U, I = ctx3b.__I;
  ok(Array.isArray(I) && I.length >= 16, "身份表 ≥16 条（实测 " + (I && I.length) + "）");
  ok(U && Array.isArray(U.names) && Array.isArray(U.styles) && Array.isArray(U.surnames), "namingUsedNow 返回 {names,styles,surnames}");

  const missN = (I || []).filter((r) => U.names.indexOf(r.name) < 0).map((r) => r.name);
  ok(missN.length === 0, "names 覆盖身份表全部姓名（缺：" + missN.join(",") + "）");
  const missS = (I || []).filter((r) => U.styles.indexOf(r.style) < 0).map((r) => r.style);
  ok(missS.length === 0, "styles 覆盖身份表全部表字（缺：" + missS.join(",") + "）");
  const missSur = (I || []).filter((r) => U.surnames.indexOf(String(r.name).charAt(0)) < 0).map((r) => r.name.charAt(0));
  ok(missSur.length === 0, "surnames 覆盖身份表姓名首字（缺：" + missSur.join(",") + "）");
  // v180-E 新增 6 条的表字 / 4 个新姓，逐一钉死
  ["敦之", "逢春", "怀糯", "卧花", "掠云", "守灯"].forEach((st) => ok(U.styles.indexOf(st) >= 0, "覆盖新增表字 " + st));
  ["俞", "戚", "乔", "闵"].forEach((s) => ok(U.surnames.indexOf(s) >= 0, "覆盖新增姓 " + s));
  // 存档内自定义名/字仍并入（并集不丢档内项）
  ok(U.names.indexOf("自定义名") >= 0 && U.names.indexOf("手填名") >= 0 && U.styles.indexOf("自定义字") >= 0,
    "存档内的自定义名/字仍并入（并集不丢档内项）");
  // 去重
  ok(new Set(U.names).size === U.names.length && new Set(U.styles).size === U.styles.length && new Set(U.surnames).size === U.surnames.length,
    "names/styles/surnames 均已去重");
}

/* ---------- (4) openNamingSpecModal 端到端（轻量 DOM 桩） ---------- */
section("4 · openNamingSpecModal 端到端（加载 → 候选 → 选 → 落库 → 关窗）");
ok(SRC_OPEN.length > 0 && /openShell\(\);\s*startGen\(\);/.test(SRC_OPEN), "能抽出 openNamingSpecModal 全函数（含 openShell/startGen）");

function makeEnv(candsFn) {
  const els = {};
  const mkEl = (sel) => {
    if (!els[sel]) {
      els[sel] = { hidden: true, style: {}, innerHTML: "", value: "", onclick: null, checked: true,
        querySelector: () => ({ value: "0" }) };
    }
    return els[sel];
  };
  const store = { A: {} };
  const saved = [];
  const ctx = vm.createContext({
    $: (sel) => mkEl(sel),
    esc: (s) => String(s == null ? "" : s),
    fillTa: (t) => String(t == null ? "" : t),
    toast: () => {},
    location: { hash: "" },
    renderSpiritDetailPage: () => {},
    renderAllSpiritsPage: () => {},
    Spirits: {
      load: () => store,
      ensureIn: (s, id) => (s[id] = s[id] || {}),
      save: (s) => saved.push(JSON.parse(JSON.stringify(s))),
      nameSpecCandidates: candsFn,
    },
  });
  vm.runInContext(SRC_USED + "\n" + SRC_APPLY + "\n" + SRC_OPEN + "\n;__open = openNamingSpecModal;", ctx);
  return { els, mkEl, store, saved, open: ctx.__open };
}

if (SRC_OPEN.length && SRC_APPLY.length && SRC_USED.length) {
  (async () => {
  const CANDS = [
    { name: "江冽茗", style: "澄观", poem: "冰瓯浮丹，微甘入喉。", eight: "冰瓯澄观，懒看浮生", why: "取茶之清冽", src: "local" },
    { name: "温茸之", style: "朴安", poem: "一团茸软，憨坐檐前。", eight: "茸憨抱朴，安之若素", why: "取茸之软", src: "local" },
  ];
  const env = makeEnv(async () => CANDS.slice());
  env.open({ id: "A", name: "冰红茶" });
  ok(env.els["#modalMask"].hidden === false && env.els["#modal"].hidden === false, "开窗：mask/modal 显形");
  ok(/正在按命名规格取名/.test(env.els["#modal"].innerHTML), "先渲染加载态（正在按命名规格取名）");
  ok(typeof env.els["#nsLater"].onclick === "function", "加载态即有「稍后再说」出口");

  await new Promise((r) => setTimeout(r, 10));  // 放行 await nameSpecCandidates

  ok(/nsConfirm/.test(env.els["#modal"].innerHTML) && /江冽茗/.test(env.els["#modal"].innerHTML), "异步后渲染候选卡（含候选姓名）");
  ok(/换一批/.test(env.els["#modal"].innerHTML), "候选卡底部有「换一批」");
  ok(typeof env.els["#nsConfirm"].onclick === "function", "「就用这个」已绑 onclick");
  env.els["#nsConfirm"].onclick();
  ok(env.store.A.naming && env.store.A.naming.name === "江冽茗", "点「就用这个」⇒ 首候选（江冽茗）落库");
  ok(env.store.A.name === "江冽茗" && env.store.A.namedBySpec === true && env.store.A.namingPending === false,
    "落库同写 name + namedBySpec + 清 pending");
  ok(env.saved.length === 1, "端到端只落库一次");
  ok(env.els["#modalMask"].hidden === true && env.els["#modal"].hidden === true, "选完自动关窗");

  // 空候选 ⇒ 不抛错、不白屏；confirm 置 disabled，仍可「自己填 / 稍后」
  const env2 = makeEnv(async () => []);
  let threw = false;
  try { env2.open({ id: "A", name: "冷门串" }); await new Promise((r) => setTimeout(r, 10)); } catch (e) { threw = true; }
  ok(!threw, "候选为空 ⇒ 不抛错");
  ok(/nsManual/.test(env2.els["#modal"].innerHTML), "候选为空 ⇒ 仍有「自己填」入口");
  ok(/disabled/.test(env2.els["#modal"].innerHTML), "候选为空 ⇒ 「就用这个」置 disabled");
  ok(!env2.store.A.naming, "候选为空且未选 ⇒ 不落库（保持待命名）");

  // 生成抛异常 ⇒ 静默回落到空候选，不抛错
  const env3 = makeEnv(async () => { throw new Error("boom"); });
  let threw3 = false;
  try { env3.open({ id: "A", name: "异常串" }); await new Promise((r) => setTimeout(r, 10)); } catch (e) { threw3 = true; }
  ok(!threw3, "生成抛异常 ⇒ 被 try/catch 吞掉，不向上冒泡");
  ok(/nsManual/.test(env3.els["#modal"].innerHTML), "异常回落 ⇒ 仍渲染「自己填」兜底");

  finish();
  })();
} else {
  finish();
}

function finish() {
  console.log("------------------------------------------------------------");
  console.log("断言总数 " + (PASS + FAIL) + " ｜ 红 " + FAIL + " ｜ 绿 " + PASS);
  if (FAILURES.length) { console.log("失败项："); FAILURES.forEach((m) => console.log("  - " + m)); }
  console.log(FAIL > 0 ? "⇒ 红测：V180-D 第二段 app 层未落地" : "⇒ 全绿：V180-D 第二段 app 层已落地");
  process.exit(FAIL > 0 ? 1 : 0);
}
