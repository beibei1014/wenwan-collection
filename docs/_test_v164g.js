/* v164g 自测：详情页上/下一只导航（spiritNavHtml）
   验证：
     1) 按钮 id 存在（sdPrev / sdNext）
     2) 中间项：两个按钮都可用，计数 = 第 N / M 只
     3) 第一项：sdPrev 禁用且显示「到头了」，sdNext 可用
     4) 最后一项：sdNext 禁用且显示「到头了」，sdPrev 可用
     5) 仅一项：两个都禁用
     6) 名字经 esc 转义（防 XSS / 标签注入）

   用法： node docs/_test_v164g.js
   说明：app.js 的 esc 内含正则 /[&<>"']/g（引号在字符类里），朴素的函数抽取会把正则误当字符串，
        故本测试只在沙箱里提供 esc / spiritName，只抽取真正要测的 spiritNavHtml。
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");

let PASS = 0, FAIL = 0;
const FAILURES = [];
function ok(cond, msg) {
  if (cond) { PASS++; console.log("  ✓ " + msg); }
  else { FAIL++; FAILURES.push(msg); console.log("  ✗ " + msg); }
}

// 只抽取 spiritNavHtml（朴素 brace 配对即可，因为它不含正则/引号陷阱）
function extractFn(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error("找不到函数 " + name);
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
  return src.slice(m.index, i);
}

// 沙箱里提供 esc（与 app.js 行为一致的转义）和 spiritName
const sandbox = {
  console,
  esc: (s) => (s == null ? "" : String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")),
  spiritName: (it) => it.name,
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(extractFn(SRC, "spiritNavHtml") + "\n;__nav = spiritNavHtml;", sandbox, { filename: "app.js#extracted" });
const nav = sandbox.__nav;

const A = { id: "a", name: "阿甲" };
const B = { id: "b", name: "贝乙" };
const C = { id: "c", name: "<script>丙" }; // 含特殊字符，验证 esc

console.log("\n=== spiritNavHtml 单元自测 ===");

// 1) 中间项
let h = nav(1, A, B, 3, {});
ok(h.indexOf('id="sdPrev"') >= 0, "中间项：存在 #sdPrev");
ok(h.indexOf('id="sdNext"') >= 0, "中间项：存在 #sdNext");
ok(h.indexOf("disabled") === -1, "中间项：两个按钮都可用（无 disabled）");
ok(h.indexOf("第 2 / 3 只") >= 0, "中间项：计数 = 第 2 / 3 只（实测：" + (h.match(/第 [^<]*只/)||[""])[0] + "）");
ok(h.indexOf("← 阿甲") >= 0, "中间项：上一只显示名字 阿甲");
ok(h.indexOf("贝乙 →") >= 0, "中间项：下一只显示名字 贝乙");

// 2) 第一项（prev 为 null）
h = nav(0, null, B, 3, {});
ok(h.indexOf('disabled>← 到头了') >= 0, "第一项：sdPrev 禁用并显示「到头了」");
ok(h.indexOf('">贝乙 →') >= 0, "第一项：sdNext 可用并显示 贝乙");
ok(h.indexOf("第 1 / 3 只") >= 0, "第一项：计数 = 第 1 / 3 只");

// 3) 最后一项（next 为 null）
h = nav(2, A, null, 3, {});
ok(h.indexOf('">← 阿甲') >= 0, "最后一项：sdPrev 可用并显示 阿甲");
ok(h.indexOf('disabled>到头了 →') >= 0, "最后一项：sdNext 禁用并显示「到头了」");
ok(h.indexOf("第 3 / 3 只") >= 0, "最后一项：计数 = 第 3 / 3 只");

// 4) 仅一项
h = nav(0, null, null, 1, {});
ok(h.indexOf('disabled>← 到头了') >= 0, "仅一项：sdPrev 禁用并显示「到头了」");
ok(h.indexOf('disabled>到头了 →') >= 0, "仅一项：sdNext 禁用并显示「到头了」");
ok(h.indexOf("第 1 / 1 只") >= 0, "仅一项：计数 = 第 1 / 1 只");

// 5) esc 转义（名字含 < > " '）
h = nav(1, C, B, 3, {});
ok(h.indexOf("← &lt;script&gt;丙") >= 0, "esc：上一只名字被转义（&lt;script&gt;丙）");
ok(h.indexOf("<script>丙") === -1, "esc：原始 <script> 未直接注入 HTML（防 XSS）");

console.log("\n----------------------------------------");
console.log("通过断言 " + PASS + " 项，失败 " + FAIL + " 项");
if (FAIL) { console.log("失败清单："); FAILURES.forEach((f) => console.log("  - " + f)); }
process.exit(FAIL ? 1 : 0);
