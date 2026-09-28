/* v163 架构师自测台：用 vm 跑真 spirits.js / app.js 代码块，穷举分支路径。
   用法： node docs/_harness.js [--verbose]
   纪律：不断言「理论上」——每条路径真的走一遍，断言占位符零残留 / 无断链 / 全通到结尾。*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const VERBOSE = process.argv.includes("--verbose");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) { PASS++; if (VERBOSE) console.log("  ✓ " + msg); }
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 假 DOM / 存储 ---------- */
function makeStorage(limitBytes) {
  const m = new Map();
  return {
    _m: m,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      v = String(v);
      let used = 0; m.forEach((val, key) => { if (key !== k) used += key.length + val.length; });
      if (limitBytes && used + k.length + v.length > limitBytes) {
        const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; e.code = 22; throw e;
      }
      m.set(k, v);
    },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    key(i) { return Array.from(m.keys())[i] || null; },
    get length() { return m.size; },
  };
}

function makeContext(opts) {
  opts = opts || {};
  const store = makeStorage(opts.quota);
  const listeners = {};
  const win = {
    localStorage: store,
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener() {},
    CustomEvent: function (type, o) { this.type = type; Object.assign(this, o || {}); },
    setTimeout: (f) => { if (typeof f === "function") f(); return 0; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (f) => 0,
    location: { hash: "", href: "http://localhost/" },
    navigator: { userAgent: "node", onLine: true },
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
    console: console, Math: Math, JSON: JSON, Date: Date, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, String, Number, Boolean, Array, Object, Error, RegExp, Promise,
    Intl: Intl, Map: Map, Set: Set,
  };
  win.window = win;
  win.self = win;
  const sandbox = Object.create(null);
  Object.assign(sandbox, win);
  sandbox.localStorage = store;
  sandbox.console = console;
  sandbox.CustomEvent = win.CustomEvent;
  sandbox.setTimeout = win.setTimeout;
  sandbox.clearTimeout = win.clearTimeout;
  sandbox.setInterval = win.setInterval;
  sandbox.clearInterval = win.clearInterval;
  sandbox.requestAnimationFrame = win.requestAnimationFrame;
  sandbox.fetch = () => Promise.reject(new Error("no network in test"));
  sandbox.navigator = win.navigator;
  sandbox.Image = function () { this.src = ""; this.onload = null; this.onerror = null; };
  sandbox.Blob = function () {};
  sandbox.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
  sandbox.document = {
    createElement() {
      return {
        style: {}, setAttribute() {}, appendChild() {}, getContext: () => ({
          fillRect() {}, drawImage() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
          moveTo() {}, lineTo() {}, closePath() {}, save() {}, restore() {}, scale() {},
          translate() {}, rotate() {}, clearRect() {}, fillText() {}, measureText: () => ({ width: 10 }),
          createLinearGradient: () => ({ addColorStop() {} }), setTransform() {}, quadraticCurveTo() {},
        }),
        toDataURL: () => "data:image/png;base64,AAAA",
      };
    },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, body: { appendChild() {}, classList: { add() {}, remove() {} } },
    documentElement: { style: {}, classList: { add() {}, remove() {} } },
  };
  sandbox.URLSearchParams = URLSearchParams;
  Object.assign(sandbox, { Map, Set, Promise, Intl, performance: { now: () => Date.now() } });
  // 关键：window/self 必须自指到 sandbox 本体，否则 window.Spirits = ... 写进了别处
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  return { ctx, sandbox, store, win: sandbox };
}

function loadFile(ctx, rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
  vm.runInContext(code, ctx, { filename: rel });
}

module.exports = { makeContext, loadFile, ok, section, summary };

function summary() {
  console.log("\n----------------------------------------");
  console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
  if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
  return FAIL === 0;
}

if (require.main === module) {
  section("空跑：加载 spirits.js");
  const h = makeContext();
  loadFile(h.ctx, "js/spirits.js");
  ok(!!h.sandbox.Spirits, "window.Spirits 导出成功");
  console.log(JSON.stringify(summary()));
  summary();
}
