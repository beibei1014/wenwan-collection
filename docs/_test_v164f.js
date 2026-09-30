// -*- coding: utf-8 -*-
// v164f 单元验证：契合度首日计入 + 夜话时间戳与打开时间同步
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok  - " + name); }
  else { fail++; console.log("  FAIL- " + name); }
}
function section(t) { console.log("\n== " + t + " =="); }

// ---------- 1) rooms.tick 首日计入 ----------
section("rooms.tick 首日计入 / 同住一天 +1");
const ROOT = path.join(__dirname, "..");
const roomsSrc = fs.readFileSync(path.join(ROOT, "js/rooms.js"), "utf8");

function freshCtx() {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const ctx = {
    window: {}, localStorage, console,
    Date, Math, JSON, String, Number, Array, Object, Boolean, parseInt, parseFloat, isNaN,
  };
  vm.createContext(ctx);
  vm.runInContext(roomsSrc, ctx, { filename: "rooms.js" });
  return { ctx, ls: store };
}

{
  const { ctx } = freshCtx();
  const R = ctx.window.Rooms;
  const now = Date.now();
  const items = [
    { id: "a", roomId: "r1", lastPlayedAt: now },
    { id: "b", roomId: "r1", lastPlayedAt: now },
  ];
  // 两只都“今天盘过” → bothPlayed=true → 当天 +2（既有规则）；关键验证：首日不再被跳过（之前是 0）
  const r1 = R.tick(items);
  const aff1 = R.affinityOf("a", "b");
  ok("新关系首日即计入（之前被跳过，永远是 0）", aff1 === 2);
  ok("tick 返回 changed=true", r1.changed === true);

  // 同日再 tick 不应重复计
  R.tick(items);
  const aff2 = R.affinityOf("a", "b");
  ok("同日不重复计（仍为 2）", aff2 === 2);

  // 模拟“第二天”再 tick：直接把 bond.lastDay 往前挪一天后调用
  const bonds = JSON.parse(ctx.localStorage.getItem("ww_bonds") || "{}");
  const key = Object.keys(bonds)[0];
  // 把 lastDay 设为昨天，让 daysBetween 算出 1
  const y = new Date(Date.now() - 86400000);
  bonds[key].lastDay = y.getFullYear() + "-" + String(y.getMonth() + 1).padStart(2, "0") + "-" + String(y.getDate()).padStart(2, "0");
  ctx.localStorage.setItem("ww_bonds", JSON.stringify(bonds));
  R.tick(items);
  const aff3 = R.affinityOf("a", "b");
  ok("第二天再 +2（变为 4）", aff3 === 4);
}

section("rooms.tick 不同房不计契合度");
{
  const { ctx } = freshCtx();
  const R = ctx.window.Rooms;
  const items = [
    { id: "x", lastPlayedAt: Date.now() },
    { id: "y", lastPlayedAt: Date.now() },
  ];
  R.tick(items);
  ok("无 roomId → 契合度保持 0", R.affinityOf("x", "y") === 0);
}

// ---------- 2) 夜话时间戳与打开时间同步 ----------
section("夜话时间戳 → 渲染时换成打开时间");
{
  function fmtTime(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  const RE = /^\d{1,2}:\d{2}\s*——\s*/;
  function sync(s) { return s.replace(RE, fmtTime(Date.now()) + " —— "); }

  const now = fmtTime(Date.now());
  const a = sync("03:16 —— 一声炸雷。");
  ok("写死时间被替换为当前 HH:MM", a.startsWith(now + " —— "));
  ok("正文保留（一声炸雷）", a.indexOf("一声炸雷") >= 0);

  const b = sync("23:52 —— 群里炸了。");
  ok("23:52 也被替换", b.startsWith(now + " —— ") && b.indexOf("群里炸了") >= 0);

  const c = sync("它在发抖，不说话。");  // 没有时间戳前缀
  ok("无时间戳文本原样保留", c === "它在发抖，不说话。");

  // app.js 确实包含该替换逻辑
  const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  ok("app.js 含时间戳替换正则", appSrc.indexOf("/^\\d{1,2}:\\d{2}\\s*——\\s*/") >= 0);
}

console.log("\n==== v164f 结果: " + pass + " 通过 / " + fail + " 失败 ====");
process.exit(fail ? 1 : 0);
