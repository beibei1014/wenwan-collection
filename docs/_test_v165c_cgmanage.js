/* v165-C 自测：图片管理补齐（CG 能不能删？能删的补齐 + 漏网两类）
 *
 * 背景（team-lead Task C）：
 *   用户问「CG 图能不能删」。查证结论：
 *     · v166 已上线「立绘管理」openSpiritImgManager + 「CG 管理」openSpiritCgManager
 *       （共用 openDelManager 弹层，每张图一个 🗑 删除按钮，详情页入口 #sdManageImg / #sdManageCg）。
 *     · 但有两类 CG 漏网、**根本没有任何删除入口**：
 *         ① 节令限定插画（rec.fests[date].cgUrl）—— 详情页节令区只显示大图，无删除
 *         ② 双人事件 CG（房间 slot.img，即 bond.stories[].img）—— 全站无入口
 *   本测试钉住「这两类已被纳入删除管理」，并守住原有三类（进阶专属 / 进阶相册 / 主线相册）没被搞坏。
 *
 * 作者不可信原则：源码按大括号配对**自己抽**，沙箱里跑抽出来的真函数（不信源码注释）。
 * 用法：node docs/_test_v165c_cgmanage.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = path.join(ROOT, "js/app.js");
const app = fs.readFileSync(APP_FILE, "utf8");
console.log("源码：" + APP_FILE + "  （" + app.length + " 字节）");

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); } }
function section(t) { console.log("\n=== " + t + " ==="); }
function info(s) { console.log("  · " + s); }

/* ---------- 1. 按大括号配对抽函数（自己抽，不信注释） ---------- */
function extractFn(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
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

const FN = {
  openDelManager: extractFn(app, "openDelManager"),
  openSpiritImgManager: extractFn(app, "openSpiritImgManager"),
  openSpiritCgManager: extractFn(app, "openSpiritCgManager"),
  openRoomCgManager: extractFn(app, "openRoomCgManager"),
};
info("抽到：" + Object.keys(FN).map((k) => k + (FN[k] ? "(" + FN[k].length + "B)" : "=无")).join(" "));

/* ---------- 2. 沙箱：真函数 + 假依赖（openDelManager 被换成捕获器） ---------- */
function makeSandbox() {
  const sb = {
    console, Math, JSON, String, Number, Boolean, Array, Object, Error, RegExp, Promise, Date,
    __saved: 0, __dm: null, __toast: null, __reloadDetail: 0, __reloadRoom: 0,
    __store: null, __stories: [], __setStoryImg: null,
    Spirits: {
      load() { return sb.__store; },
      ensureIn(store, id) {
        if (!store[id]) store[id] = {};
        const r = store[id];
        if (!r.cgs) r.cgs = {};
        if (!r.fests) r.fests = {};
        return r;
      },
      save() { sb.__saved++; },
    },
    Rooms: {
      storiesOfRoom(roomId) { return sb.__stories; },
      setStoryImage(a, b, level, url) { sb.__setStoryImg = { a: a, b: b, level: level, url: url }; },
    },
    spiritItemById(id) { return sb.__names[id] ? { id: id, name: sb.__names[id] } : null; },
    nameOf(it) { return it.name; },
    __names: {},
    toast(m) { sb.__toast = m; },
    openDelManager(title, items, onDelete, onDone) { sb.__dm = { title: title, items: items, onDelete: onDelete, onDone: onDone }; },
    renderSpiritDetailPage(id) { sb.__reloadDetail++; },
    renderRoomPage(id) { sb.__reloadRoom++; },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  return sb;
}
function loadFns(sb, names, extra) {
  const code = names.map((n) => FN[n]).filter(Boolean).join("\n") + (extra || "");
  vm.runInContext(code, vm.createContext(sb), { filename: "app.js#extracted" });
  return sb;
}

/* ============================================================ */
/* A. 现状查证：v166 已有删除管理（源码静态检查）                */
/* ============================================================ */
section("A. 现状查证：v166 已上线立绘/CG 删除管理（源码静态检查）");
ok(!!FN.openDelManager, "A1 · openDelManager 共用删除弹层仍在");
ok(!!FN.openSpiritImgManager, "A2 · openSpiritImgManager（立绘管理）仍在");
ok(!!FN.openSpiritCgManager, "A3 · openSpiritCgManager（CG 管理）仍在");
ok(/\$\("#sdManageImg"\)/.test(app) && /\$\("#sdManageCg"\)/.test(app),
  "A4 · 详情页两个入口按钮 #sdManageImg / #sdManageCg 已绑定");
ok(/点 🗑 删除这张/.test(FN.openDelManager || ""), "A5 · 弹层里每张图有独立 🗑 删除按钮");

/* ============================================================ */
/* B. 节令 CG 纳入 CG 管理（本次补齐 ①）                        */
/* ============================================================ */
section("B. 节令限定插画（rec.fests[date].cgUrl）纳入 CG 管理");
{
  const sb = makeSandbox();
  sb.__store = {
    sp1: {
      cgUrl: "", cgKey: "", cgStage: 0,
      cgs: { "adv#k": { hasImg: true, thumb: "http://x/adv.png", title: "进阶" } },
      fests: {
        "2026-01-01": { date: "2026-01-01", emoji: "🏮", name: "岁除", cgUrl: "http://x/fest.png", cgAt: 123, text: "t" },
        "2026-05-05": { date: "2026-05-05", emoji: "🐉", name: "端午", cgUrl: "", text: "t2" },
      },
    },
  };
  loadFns(sb, ["openSpiritCgManager"]);
  sb.openSpiritCgManager("sp1");
  const items = sb.__dm.items;
  info("列表：" + items.map((x) => x.kind + ":" + (x.label || "")).join(" | "));
  ok(items.some((x) => x.kind === "fest" && x.url === "http://x/fest.png"),
    "B1 · 有图的节令插画（岁除）进了列表，且带 url");
  ok(!items.some((x) => x.url === "http://x/fest.png" && x.kind !== "fest"), "B2 · 节令插画只列一次，不重复");
  ok(!items.some((x) => x.kind === "fest" && x.url === ""), "B3 · 没图的节令（端午）不进列表（避免空图）");

  // 真删节令 → cgUrl 清空、cgAt 归零
  const festItem = items.filter((x) => x.kind === "fest")[0];
  sb.__dm.onDelete(festItem);
  ok(sb.__store.sp1.fests["2026-01-01"].cgUrl === "", "B4 · 删节令 CG 后 rec.fests[date].cgUrl 清空为空串");
  ok(sb.__store.sp1.fests["2026-01-01"].cgAt === 0, "B5 · 删节令 CG 后 cgAt 归零");
  ok(sb.__store.sp1.fests["2026-01-01"].text === "t", "B6 · 删图不动节令正文 text（只删图，不删记录）");
  ok(sb.__saved >= 1, "B7 · 删节令后已 Spirits.save（落库）");
  sb.__dm.onDone();
  ok(sb.__reloadDetail >= 1, "B8 · 删后触发 onDone → 刷新详情页（缩略图即时消失）");

  // 负向对照：没有 fest 分支的旧实现，列表里根本没有节令项 → 证明本断言能抓到遗漏
  const OLD = `
    function openSpiritCgManager(id) {
      const store = Spirits.load();
      const rec = Spirits.ensureIn(store, id);
      const items = [];
      if (rec.cgUrl) items.push({ kind: "adv", url: rec.cgUrl, label: "进阶专属 CG" });
      const cgs = rec.cgs || {};
      Object.keys(cgs).forEach((k) => {
        const m = cgs[k];
        if (m && m.hasImg && (m.thumb || m.imgUrl)) items.push({ kind: "cg", key: k, url: m.thumb || m.imgUrl, label: (m.title || k) });
      });
      if (!items.length) { toast("还没有可管理的 CG"); return; }
      openDelManager("CG", items, (it2) => { if (it2.kind === "adv") { rec.cgUrl = ""; } else { delete rec.cgs[it2.key]; } Spirits.save(store); }, () => renderSpiritDetailPage(id));
    }`;
  const sb2 = makeSandbox();
  sb2.__store = JSON.parse(JSON.stringify(sb.__store));
  loadFns(sb2, [], "\n" + OLD);
  sb2.openSpiritCgManager("sp1");
  ok(!sb2.__dm.items.some((x) => x.kind === "fest"),
    "B9 · 负向对照：旧实现列表里**没有**节令项 → 证明 B1 确实抓得到『节令 CG 漏网』");
}

/* ============================================================ */
/* C. 原有三类 CG 未被搞坏                                       */
/* ============================================================ */
section("C. 原有三类（进阶专属 / 进阶相册 / 主线相册）不受影响");
{
  const sb = makeSandbox();
  sb.__store = {
    sp1: {
      cgUrl: "http://x/cur.png", cgKey: "k1", cgStage: 3,
      cgs: {
        "main#c1": { hasImg: true, thumb: "http://x/m1.png", title: "第一章" },
        "adv#c2": { hasImg: true, imgUrl: "http://x/a2.png", title: "进阶二" },
      },
      fests: {},
    },
  };
  loadFns(sb, ["openSpiritCgManager"]);
  sb.openSpiritCgManager("sp1");
  const items = sb.__dm.items;
  ok(items.some((x) => x.kind === "adv" && x.url === "http://x/cur.png"), "C1 · 进阶专属 CG（rec.cgUrl）在列");
  ok(items.some((x) => x.kind === "cg" && x.key === "main#c1"), "C2 · 主线相册 CG 在列");
  ok(items.some((x) => x.kind === "cg" && x.key === "adv#c2"), "C3 · 进阶相册 CG 在列");
  // 删进阶专属
  sb.__dm.onDelete(items.filter((x) => x.kind === "adv")[0]);
  ok(sb.__store.sp1.cgUrl === "" && sb.__store.sp1.cgKey === "" && sb.__store.sp1.cgStage === 0, "C4 · 删进阶专属 → cgUrl/cgKey/cgStage 全清零");
  // 删相册条目
  sb.__dm.onDelete(items.filter((x) => x.kind === "cg" && x.key === "main#c1")[0]);
  ok(!sb.__store.sp1.cgs["main#c1"], "C5 · 删相册条目 → rec.cgs[key] 被 delete");
  ok(sb.__store.sp1.cgs["adv#c2"], "C6 · 删一条不动另一条（rec.cgs 其余保留）");
}

/* ============================================================ */
/* D. 双人事件 CG 纳入房间管理（本次补齐 ②）                     */
/* ============================================================ */
section("D. 双人事件 CG（房间 slot.img）纳入房间页管理");
{
  const sb = makeSandbox();
  sb.__names = { A: "花间酒", B: "青竹" };
  sb.__store = { A: {}, B: {} };
  sb.__stories = [
    { key: "A|B", pair: ["A", "B"], story: { level: 0, img: "http://x/dual0.png", text: "t0" } },
    { key: "A|B", pair: ["A", "B"], story: { level: 1, img: "", text: "t1" } },
    { key: "A|B", pair: ["A", "B"], story: { level: 2, img: "http://x/dual2.png", text: "t2" } },
  ];
  ok(!!FN.openRoomCgManager, "D1 · openRoomCgManager 存在（新增房间级双人 CG 管理）");
  loadFns(sb, ["openRoomCgManager"]);
  sb.openRoomCgManager("rm1");
  const items = sb.__dm.items;
  info("列表：" + items.map((x) => x.kind + ":" + x.label).join(" | "));
  ok(items.length === 2, "D2 · 只列有图的两段（level 0 / 2），没图的 level 1 不列");
  ok(items.every((x) => x.kind === "story" && x.url), "D3 · 每项都是 story 且带 url");
  ok(/第 1 段/.test(items[0].label) && /第 3 段/.test(items[1].label), "D4 · 段号 = level+1（第 1 段 / 第 3 段）");
  ok(items[0].label.indexOf("花间酒 × 青竹") >= 0, "D5 · 标签带两只沁灵的名字");
  // 删第一段
  const it0 = items[0];
  sb.__dm.onDelete(it0);
  ok(sb.__setStoryImg && sb.__setStoryImg.a === "A" && sb.__setStoryImg.b === "B" &&
    sb.__setStoryImg.level === 0 && sb.__setStoryImg.url === "",
    "D6 · 删除调 Rooms.setStoryImage(a,b,level,空串)（key 拆成 pair + level）");
  sb.__dm.onDone();
  ok(sb.__reloadRoom >= 1, "D7 · 删后触发 onDone → 刷新房间页");

  // 空房间：给 toast、不开弹层
  const sb3 = makeSandbox();
  sb3.__store = { A: {}, B: {} };
  sb3.__stories = [{ key: "A|B", pair: ["A", "B"], story: { level: 0, img: "", text: "t" } }];
  loadFns(sb3, ["openRoomCgManager"]);
  sb3.openRoomCgManager("rm1");
  ok(sb3.__dm === null && !!sb3.__toast, "D8 · 房间没有双人 CG 时只 toast、不弹空层");
}

/* ============================================================ */
/* E. 房间页入口按钮（#rmManageCg）                              */
/* ============================================================ */
section("E. 房间页入口按钮 #rmManageCg");
{
  ok(/id="rmManageCg"/.test(app), "E1 · 房间页有 #rmManageCg 按钮");
  ok(/id="rmManageCg"[\s\S]{0,120}?stories\.some\(\(s\) => s\.story && s\.story\.img\)/.test(app) ||
    /stories\.some\(\(s\) => s\.story && s\.story\.img\)[\s\S]{0,160}?id="rmManageCg"/.test(app),
    "E2 · 按钮仅在有双人 CG（任一 story.img 非空）时显示");
  ok(/\$\("#rmManageCg"\)[\s\S]{0,60}?openRoomCgManager\(roomId\)/.test(app),
    "E3 · 按钮已绑定到 openRoomCgManager(roomId)");
}

/* ============================================================ */
/* F. 边界纪律：删除只动图，不碰资产禁区                         */
/* ============================================================ */
section("F. 边界纪律：删除只清图字段，不触碰资产禁区");
{
  const cgFn = FN.openSpiritCgManager || "";
  const rmFn = FN.openRoomCgManager || "";
  ok(cgFn.indexOf("rec.marks") < 0, "F1 · CG 管理不碰 rec.marks");
  ok(cgFn.indexOf("ww_spirits") < 0 && rmFn.indexOf("ww_spirits") < 0, "F2 · 两个管理器都不直接写 ww_spirits 键");
  ok(cgFn.indexOf("spirit_store") < 0 && cgFn.indexOf("hashStr") < 0, "F3 · 不碰 spirit_store / hashStr");
  // 删节令只改 cgUrl/cgAt
  ok(/cgUrl\s*=\s*""\s*;\s*rec\.fests\[it2\.key\]\.cgAt\s*=\s*0/.test(cgFn) ||
    /cgUrl\s*=\s*"".*cgAt\s*=\s*0/.test(cgFn),
    "F4 · 节令删除只清 cgUrl 并把 cgAt 归零（正文 text 原样保留）");
  // 房间删除只调 setStoryImage 置空
  ok(/Rooms\.setStoryImage\([^)]*,\s*""\s*\)/.test(rmFn), "F5 · 房间里只把 story.img 置空（不动 bond / 正文）");
}

/* ============================================================ */
/* G. 版本号：index.html 的 app.js ?v= 已 bump                   */
/* ============================================================ */
section("G. 版本号");
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const m = /js\/app\.js\?v=(\d+)/.exec(html);
  const m2 = /js\/spirits\.js\?v=(\d+)/.exec(html);
  info("app.js ?v=" + (m ? m[1] : "无") + " / spirits.js ?v=" + (m2 ? m2[1] : "无"));
  ok(m && Number(m[1]) >= 20261223, "G1 · index.html 的 js/app.js ?v= 已 bump 到 ≥20261223（本次有改 app.js）");
}

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
