/* ============================================================
 * _test_v174b_antiobject.js · V174-B「防物化文案 189 条」回归红测
 * ------------------------------------------------------------
 * ⚠️ 本文件在 **V174-B 落地前 一直为红测**（red test）：它断言
 *    源码里「新文案存在」且「旧文案已灭」，而旧文案尚未替换 ⇒ 全红。
 *    落地（批1/批2）完成后应转全绿；若仍红 ⇒ 有漏改。
 *
 * 基准：`03c473c`（行号会漂，本测试**只按字符串**判定，不 require/运行 js、不依赖 DOM）。
 * 负向对照：`V174B_SRC_DIR=<03c473c 导出目录> node docs/_test_v174b_antiobject.js`
 *          ⇒ 必须**全红**（证明断言真的在测东西）。⛔ 基线铆定 03c473c，绝不用 git show HEAD。
 *
 * 覆盖：12 类高危锚点（折叠进「新在 & 旧灭 & 锚点未丢」单条断言）＋ 表A/表B ＋ CARE.line
 *      ＋ GIFT 系列 ＋ app.js 6 组「同串多处」＋ poster/game。
 * 用法：node docs/_test_v174b_antiobject.js          （默认读 ../js）
 *      V174B_SRC_DIR=/path/to/baseline/js node …   （负向对照）
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = process.env.V174B_SRC_DIR || path.join(__dirname, "..", "js");
function rd(f) {
  try { return fs.readFileSync(path.join(SRC, f), "utf8").replace(/\r/g, ""); }
  catch (e) { return ""; }
}
const F = {
  "spirits.js": rd("spirits.js"),
  "app.js": rd("app.js"),
  "poster.js": rd("poster.js"),
  "game.js": rd("game.js"),
};

/* [文件, 标签, 旧串, 新串, 锚点(可选，必须仍在)] */
const CASES = [
  // ---------- js/spirits.js ----------
  ["spirits.js", "GREET.born（＋停用词正则锚点）", `"我认得你的手 —— 就是刚才把我盘热的那个。",`, `"我认得你的手。是这只手，把我从那串里唤出来的。",`, "/^(一|个|种|些|这|那|它|我|你|他|她)$/"],
  ["spirits.js", "GREET.played3", `今天被你盘了 {plays} 次`, `今天你在那边动了 {plays} 回串`],
  ["spirits.js", "GREET.x5（量词颗）", `里最亮的那一颗」。`, `里最不显眼的那个」。`],
  ["spirits.js", "GREET_MOOD.played（键名不动）", `played: "暖乎乎的"`, `played: "被陪过"`, "const GREET_MOOD = {"],
  ["spirits.js", "CARE.clean（id 不动）", `{ id: "clean",  name: "擦净", line: "案上擦了擦，浮灰落了。" },`, `{ id: "clean",  name: "探看", line: "过来看了看，顺手拾掇拾掇。" },`, `id: "clean"`],
  ["spirits.js", "CARE.sit（id 不动）", `name: "静坐", line: "坐下来，陪它静了一会儿。"`, `name: "静坐", line: "坐下来，静静陪了一会儿。"`, `id: "sit"`],
  ["spirits.js", "CARE.thread（id 不动）", `{ id: "thread", name: "理线", line: "把线顺了顺，松的地方收好。" },`, `{ id: "thread", name: "叙话", line: "陪着说了几句话，说的都是小事。" },`, `id: "thread"`],
  ["spirits.js", "GIFT.dignified", `hit: "东西我收下了。规矩我记着。"`, `hit: "收了。搁我手边。"`],
  ["spirits.js", "GIFT.scholar.miss", `miss: "……记一笔。"`, `miss: "对不上账。……也记一笔。"`],
  ["spirits.js", "GIFT.cool.hit（测试:303 锁死）", `hit: "……还行。"`, `hit: "……收了。"`],
  ["spirits.js", "GIFT.gentle.hit", `hit: "你从哪儿找来的。"`, `hit: "我给你收在最里头了。"`],
  ["spirits.js", "GIFT.lively.hit", `hit: "我先看见的！我先看见的！"`, `hit: "我先看见的！给我的！"`],
  ["spirits.js", "GIFT.mystery.hit", `hit: "谁家的都行。这一件，是你会挑的。"`, `hit: "……你会挑。这一件，正好。"`],
  ["spirits.js", "GIFT.sweet.hit", `hit: "这是给我的？真的？那我先拿着了！"`, `hit: "这是给我的？那我不客气啦！"`],
  ["spirits.js", "GIFT.cheeky.hit", `hit: "你们听说了没有——有人给我带东西了。"`, `hit: "你们听说了没有——有人给我捎东西来啦。"`],
  ["spirits.js", "GIFT.fallback.hit", `{ hit: "……我会收好的。", miss: "搁这儿吧。" }`, `{ hit: "……收下了。", miss: "搁这儿吧。" }`],
  ["spirits.js", "GIFT_COPY.open（测试:308 锁死）", `open: "递一件给它",`, `open: "送给{ta}",`],
  ["spirits.js", "GIFT_COPY.qualifying", `qualifying: "{ta}还没到接你东西的分上。",`, `qualifying: "{ta}还没跟你熟到这份上。",`],
  ["spirits.js", "GIFT_COPY.hitNote", `hitNote: "{ta}会喜欢这一类。",`, `hitNote: "这一件，正合{ta}。",`],
  ["spirits.js", "milestone.summary", `summary: "它第一次睁开眼，认得你了"`, `summary: "第一次睁开眼，认得你了。"`],
  ["spirits.js", "表A.persona.sys（一尊→一位）", `变成一尊 Q 版小生物。`, `醒过来一位有脾气的小沁灵。`],
  ["spirits.js", "表A.chat.sys（它们→他们）", `变成了小生物，它们会背着你聊天。`, `各自醒成了一位小沁灵，他们会在你背后聊天。`],
  ["spirits.js", "表A.chat.user", '\\n请写它们今天的小剧场。', '\\n请写这几只今天的小剧场。'],
  ["spirits.js", "表A.letter.user", '("\\n它已经 " + spirit.idleDays + " 天没被盘了。")', '("\\n距上次与主人相处，已经过了 " + spirit.idleDays + " 天。")'],
  ["spirits.js", "表A.personaZh.sys.hair", `下方若给出「它的发色」`, `下方若给出「这位沁灵的发色」`],
  ["spirits.js", "表A.personaZh.user.origin", `"；它的出处/意象（服装风格要顺着这个来）："`, `"；这位沁灵的出处/意象（服装风格要顺着这个来）："`],
  ["spirits.js", "表A.diaryWrite.nick", `；它平时叫主人「" + rec.nickCall`, `；这位沁灵平时叫主人「" + rec.nickCall`],
  ["spirits.js", "表B.personaZhLocal.wake", `盘到挂瓷的那天晚上，它从珠子里醒了过来，现在是一尊`, `挂瓷的那天晚上，ta 从那一串里醒了过来，现在是一位`],
  ["spirits.js", "表B.personaZhLocal.place", `它最喜欢的位置是主人的手心`, `ta 最爱待的地方，是主人手边`],
  ["spirits.js", "表B.diaryLocal.neighbor", `刚才和隔壁的聊了两句，它说它比我早挂瓷。`, `刚才跟隔壁那只聊了两句，ta 比我早开沁。`],
  ["spirits.js", "表B.localLetter.title", `const t = p.title || "你的小宝贝";`, `const t = p.title || "你的小沁灵";`],
  ["spirits.js", "表B.localChat.1", `["主人昨天先摸的是我。", "别炫耀了，你不过比我圆。", "安静点，我在晒太阳。"]`, `["主人昨天先来的是我这边。", "别炫耀了，你不过是比我早醒两天。", "安静点，我在晒太阳。"]`],
  ["spirits.js", "表B.profileLocal.pers", `但主人一伸手它就会靠过来。`, `但主人一开口，ta 就会凑过来。`],
  ["spirits.js", "兜底.profileLocal（||它→||那只）", `const nm = (persona && persona.name) || (item && item.name) || "它";`, `const nm = (persona && persona.name) || (item && item.name) || "那只";`],
  ["spirits.js", "兜底.cgBriefFacts.who（2 处）", `const n = p ? String(p.name || (p.item && p.item.name) || "它") : "它";`, `const n = p ? String(p.name || (p.item && p.item.name) || "那只") : "那只";`],
  ["spirits.js", "兜底.cgBriefLocal.n", `const n = (x.item && x.item.name) || "它";`, `const n = (x.item && x.item.name) || "那只";`],
  ["spirits.js", "剧情提示.need.bond(spiritNeed)", `("要跟它再熟一点（现在「" + bondLevel(bond).name + "」）")`, `("要跟{ta}再熟一点（现在「" + bondLevel(bond).name + "」）")`],
  ["spirits.js", "剧情提示.need.plural", `你很久没冷落它们时才会发生`, `你很久没冷落他们时才会发生`],
  ["spirits.js", "choices.4399（go/tone 不动）", `{ t: "你自己介意的话，我就陪你把它养好。", go: "p2", tone: "cool" },`, `{ t: "你自己介意的话，这道印子我陪你一起养。", go: "p2", tone: "cool" },`, `go: "p2", tone: "cool"`],
  ["spirits.js", "f_trip.6089", `{ w: "C", t: "别问了。问了它更不好收拾。" },`, `{ w: "C", t: "别问了。越问越不好收拾。" },`],
  ["spirits.js", "出图单.1366", `还想让它怎样？这里写的会原样进提示词`, `还想让 ta 怎样？这里写的会原样进提示词`],
  ["spirits.js", "章节.day62（数组不动）", `sub: "它想借一段力"`, `sub: "想借一段力"`, "{ day: 62,"],
  ["spirits.js", "d_clash.e_fun（ending.key 不动）", `text: "从那以后它们养成了一个坏习惯：同时说话。你分不清是谁先开口的，但它们似乎也不打算改。"`, `text: "从那以后他们养成了一个坏习惯：同时说话。你分不清是谁先开口的，但他们似乎也不打算改。"`, `key: "fun"`],
  ["spirits.js", "r_thunder.e_cool（ending.key 不动）", `text: "{A}后来跟别人说它那晚睡得很好。{B}在旁边听着，什么也没拆穿。"`, `text: "{A}后来跟别人说他那晚睡得很好。{B}在旁边听着，什么也没拆穿。"`, `key: "cool"`],
  ["spirits.js", "r_joy 台词", `别催。让它先高兴一会儿。`, `别催。让他先高兴一会儿。`],
  ["spirits.js", "TOWN_EVENTS.8938", `{a} 把最后一盅让给了 {b}，说它今天高兴。`, `{a} 把最后一盅让给了 {b}，说他今天高兴。`],
  ["spirits.js", "cgBriefFacts.compo", `构图：横版宽幅，它一个人站在场景里`, `构图：横版宽幅，那只一个人站在场景里`],

  // ---------- js/app.js ----------
  ["app.js", "开沁 toast", `toast("🎉 它开沁了！是只"`, `toast("🎉 开沁了！是只"`],
  ["app.js", "已挂瓷（同串 ×2）", `"把一串盘到「已挂瓷」，它就会开沁"`, `"把一串盘到「已挂瓷」，就会开沁"`],
  ["app.js", "点它进详情页（同串 ×2 · 列表复数语境 ⇒ 他们，不用 {ta}）", `点它进详情页`, `点他们进详情页`],
  ["app.js", "住满 2 只（同串 ×2）", `"住满 2 只，它们才会慢慢熟起来"`, `"住满 2 只，他们才会慢慢熟起来"`],
  ["app.js", "它们的小房间（app ×2）", `{ name: "它们的小房间"`, `{ name: "他们的小房间"`],
  ["app.js", "💬 它们聊天（同串 ×2）", `💬 它们聊天`, `💬 他们聊天`],
  ["app.js", "它站在哪儿（同串 ×2）", `它站在哪儿、穿什么、在做什么`, `那只站在哪儿、穿什么、在做什么`],
  ["app.js", "fillTa（{ta} 正则不动）", 'replace(/\\{ta\\}/g, name || "它"); }', 'replace(/\\{ta\\}/g, name || "那只"); }', '/\\{ta\\}/g'],
  ["app.js", "sdRename（id 不动）", `id="sdRename">✏️ 给它改个名字（只能改一次）</button>`, `id="sdRename">✏️ 给{ta}改个名字（只能改一次）</button>`, `id="sdRename"`],
  ["app.js", "sdEvents（id 不动）", `id="sdEvents">📜 它的纪事</button>`, `id="sdEvents">📜 {ta}的纪事</button>`, `id="sdEvents"`],
  ["app.js", "sdRepSend（id 不动）", `id="sdRepSend">回它</button>`, `id="sdRepSend">回{ta}</button>`, `id="sdRepSend"`],
  ["app.js", "sdChat（id 不动）", `id="sdChat">💬 它们聊天</button>`, `id="sdChat">💬 他们聊天</button>`, `id="sdChat"`],
  ["app.js", "sdRepBtn（id 不动）", `>↩️ 回它一句</button>`, `>↩️ 回{ta}一句</button>`, `id="sdRepBtn"`],
  ["app.js", "data-p-ok（不动）", `data-p-ok>就用它 →</button>`, `data-p-ok>就用{ta} →</button>`, `data-p-ok`],
  ["app.js", "送礼确认弹窗", `"递一件给它？"`, `"送给{ta}？"`],
  ["app.js", "房间回响脚注", `"攒够了就会发生属于它们的故事 ✨</div>";`, `"攒够了就会发生属于这几只的故事 ✨</div>";`],
  ["app.js", "回忆卡 line", `line: "从一串珠子，到有脾气的它。",`, `line: "从一串珠子，到会跟你闹脾气的人。",`],
  ["app.js", "详情·陪了N天", `" · 它陪了你 " + DB.daysWith(it)`, `" · {ta}陪了你 " + DB.daysWith(it)`],
  ["app.js", "详情·纪念日留信", `每一枚纪念日它都留了信给你`, `每一枚纪念日{ta}都留了信给你`],
  ["app.js", "设置·保存称呼", `已保存：以后它们会用「`, `已保存：以后他们会用「`],
  ["app.js", "群聊弹窗标题", `"<h3>💬 它们聊天</h3>`, `"<h3>💬 他们聊天</h3>`],
  ["app.js", "房间说明", `住在一起，它们慢慢就熟了 —— 熟了会有自己的故事。`, `住在一起，他们慢慢就熟了 —— 熟了会有自己的故事。`],

  // ---------- v174-B4 补漏（去物化：复数语境） ----------
  ["app.js", "画册页头副标题（复数）", `它们留下的样子`, `他们留下的样子`],
  ["spirits.js", "房间故事 prompt（复数）", `这是它们第 `, `这是他们第 `],

  // ---------- js/poster.js ----------
  ["poster.js", "回忆册长图·名字（×2）", `escText(o.name || "它")`, `escText(o.name || "那只")`],

  // ---------- js/game.js ----------
  ["game.js", "看纹 desc（DAILY_TEMPLATES 字段不动）", `看看它身上那道纹，今天走到哪儿了。`, `看看那只那道纹，今天走到哪儿了。`, `id: "kanwen"`],

  // ---------- V175 续：名字统一 + 去物化口头禅 + 全站复查 ----------
  ["app.js", "送礼流程名字解析（对齐详情页身份名）", `const name = spiritName(it, store);\n    const today = Spirits.todayKey();`, `const _idc0 = spiritIdentityOf(_disp0);\n    const name = (_idc0 && !rec.nameEdited) ? _idc0.name : _disp0;`],
  ["app.js", "心迹区名字解析（对齐详情页身份名）", `function heartCardHtml(it, rec, store) {\n    const name = spiritName(it, store);`, `const _idc = spiritIdentityOf(_disp);\n    const name = (_idc && !rec.nameEdited) ? _idc.name : _disp;`],
  ["app.js", "心迹提示去「它对你」", `看的是它对你那点另外的意思`, `看的是{ta}对你那点另外的意思`],
  ["app.js", "物化口头禅过滤函数（新增）", `__NONEXIST_V175_HELPER__`, `function isObjectifyingLine(line) {`],
  ["app.js", "详情页口头禅行加过滤", `'<div class="sd-line">“' + esc(p.line || "") + '”</div>'`, `(p.line && !isObjectifyingLine(p.line) ? '<div class="sd-line">“' + esc(p.line) + '”</div>'`],
  ["app.js", "今日盘过按钮去物化", `记录今天盘了它）`, `记录今天盘了这串）`],
  ["app.js", "首次盘玩时间去物化", `开始盘它的时间`, `开始盘这串的时间`],
  ["app.js", "计划打卡按钮去物化", `今天盘过它了？点一下打卡`, `今天盘过这串了？点一下打卡`],
  ["app.js", "佩戴状态说明去物化", `一直在盘它）`, `一直戴着，不占盘玩计划）`],
  ["spirits.js", "人设口头禅禁物化指令（新增）", `__NONEXIST_V175_SPG__`, `口头禅（line）严禁把玩视角`],
  ["spirits.js", "签文去物化", `把手洗干净盘它`, `把手洗干净，慢慢盘这串`],
];

let total = 0, red = 0, green = 0;
const empty = Object.keys(F).filter((k) => !F[k]);
console.log("V174-B 防物化回归红测　基准目录：" + SRC);
if (empty.length) console.log("⚠️ 读不到源码：" + empty.join(", "));
console.log("------------------------------------------------------------");

for (const c of CASES) {
  const [f, label, oldS, newS, anchor] = c;
  const src = F[f] || "";
  const hasNew = src.includes(newS);
  const oldGone = !src.includes(oldS);
  const anchorOk = !anchor || src.includes(anchor);
  const pass = hasNew && oldGone && anchorOk;
  total++;
  if (pass) { green++; console.log("  ✓ " + f + " · " + label); }
  else {
    red++;
    const why = [];
    if (!hasNew) why.push("新文案缺失");
    if (!oldGone) why.push("旧文案仍在");
    if (!anchorOk) why.push("锚点丢失");
    console.log("  ✗ " + f + " · " + label + "　⇒ " + why.join(" / "));
  }
}

console.log("------------------------------------------------------------");
console.log("断言总数 " + total + " ｜ 红 " + red + " ｜ 绿 " + green);
console.log(red > 0
  ? "⇒ 红测（V174-B 落地前为红，属预期）"
  : "⇒ 全绿：V174-B 文案已全部落地");
process.exit(red > 0 ? 1 : 0);
