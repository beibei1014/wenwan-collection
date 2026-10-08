/* ============================================================
 * _extract_book_jieqi.js —— v180 批G · 《沁灵纪》〈结契篇〉正文机械抽取器
 * ------------------------------------------------------------
 * 作用：docs/v180-结契篇-正文-第1-4章.md  →  js/book-jieqi.js（window.BOOK_JIEQI）
 *      剧情若修订 ⇒ 改 md 后重跑本脚本即可（⛔ 不许手改生成物）。
 *
 * 规则（v180 批G 口径）：
 *   · `## N · 章名`      → 章（本批只取第 1–4 章）
 *   · `### N · 地点·时辰` → 节
 *   · `〔画面：X〕`       → { k:"sc" } 场景行（画面提示 ⇒ 转场景描述，⛔ 绝不显示〔〕原文）
 *   · `[CG候选]/[情绪点]/[分支点]` → 进 notes（游戏性抓手，⛔ 不进正文）
 *   · 句首「…」           → { k:"d" } 对白（配说话人）
 *   · 句中「…」           → 留在旁白里（转述语，⛔ 不单独立成对话行）
 *   · 其余                → { k:"n" } 旁白
 *
 * 说话人：优先查 SPEAKER（按引文前缀匹配，稳定不随增删漂移）；
 *          ⚠️ 该表由人工逐条核过 —— 机械抽取无法可靠判定「他 / 那人」指谁。
 * 用法： node docs/_extract_book_jieqi.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MD = path.join(ROOT, "docs", "v180-结契篇-正文-第1-4章.md");
const OUT = path.join(ROOT, "js", "book-jieqi.js");

/* ---------- 本批章范围：只做第 1–4 章（⛔ 第 5–8 章等主理人放行） ---------- */
const WANT = ["一", "二", "三", "四"];

/* ---------- 章 → BG key（⛔ 只给 BG_CATALOG 里已有的 key；渲染端只读 Spirits.bgGet，绝不出图） ----------
   BG-13 坡地·黄昏 ｜ BG-04 院里·夜 ｜ BG-15 灯下账桌 ｜ BG-06 廊下·雨 */
const BG_BY_CHAPTER = {
  "一": ["BG-13", "BG-04"],   // 断垣 · 残照（坡地黄昏 → 火起入夜）
  "二": ["BG-04", "BG-13"],   // 垣下 · 入夜
  "三": ["BG-04", "BG-15"],   // 垣下空地 · 夜半
  "四": ["BG-04", "BG-15"],   // 火边 · 后半夜
};

/* ---------- 称谓 → 身份表姓名（**仅用于立绘解析**，⛔ 不改正文一个字） ----------
   依据：正文 §D「出场角色清单（第 1–8 章）」的角色—位对应。
   ⚠️ 文成章正在把描述性称位改成正式姓名 ⇒ 届时本表可整表删掉，改由 who 直取身份表。 */
const ROLE_MAP = {
  "坐着的那位": "顾时笙", "最沉的那位": "顾时笙",
  "添柴的那位": "苏栖盏",
  "摊着册子的那位": "萧景筹",
  "站着的那位": "陆临崖",
  "抢着来的那位": "楚柿遥", "年轻些的": "楚柿遥",
  "半躺着的那位": "江冽茗",
  "最憨的那一个": "温茸之",
  "温声的": "沈青舒",
  "火最小的那位": "姜饴酌",
  "最慢的那一位": "谢凝渲",
  "季未晚": "季未晚", "邵盈牧": "邵盈牧", "闵琥珀": "闵琥珀",
  "俞酥棠": "俞酥棠", "戚衔蝉": "戚衔蝉", "乔纹栗": "乔纹栗",
};

const ME = "你";   // 玩家称谓 → 出 { k:"me" } 行（⛔ 不做运行时替换：正文怎么称就怎么显）

/* ---------- 说话人表（人工逐条核过；按引文前缀匹配） ----------
   ⚠️ 唯一允许人工指定的地方。改这里 ⇒ 重跑脚本，⛔ 别手改 js/book-jieqi.js。 */
const SPEAKER = [
  ["别指望谁教你。", "邵盈牧"],
  ["自己看。", "邵盈牧"],
  ["都少说一句。", "温声的"],
  ["火就一处，话就一句。", "温声的"],
  ["坡上那位什么时候回来？", "年轻些的"],

  ["一个人走，能走三个月。", ME],
  ["一伙人走，能走三年。", ME],
  ["你想的是三年。", "最沉的那位"],
  ["我想的是三年之后。", "最沉的那位"],
  ["三年之后，是三年之后的事。", ME],
  ["先把今年走过去。", ME],
  ["散修结伙，", "摊着册子的那位"],
  ["是件麻烦事。", "摊着册子的那位"],
  ["我知道。", ME],
  ["你知道什么。", "摊着册子的那位"],
  ["你知道名在册上才算数？", "摊着册子的那位"],
  ["不知道。", ME],
  ["那你凭什么起这一伙。", "摊着册子的那位"],
  ["凭你肯记。", ME],
  ["名在，道在。", "摊着册子的那位"],
  ["册在，伙在。这话我说过。", "摊着册子的那位"],
  ["那你记一笔。", ME],
  ["从今天记。", ME],
  ["你要我入伙，", "半躺着的那位"],
  ["还是借我看局。", "半躺着的那位"],
  ["都要。", ME],
  ["我心里有数。", "半躺着的那位"],
  ["你也有数。那还说什么。", "半躺着的那位"],
  ["灯我留着。", "添柴的那位"],
  ["别的我说不上。", "添柴的那位"],
  ["够了。", ME],
  ["你说的是个说法。", "温声的"],
  ["说法容易，", "温声的"],
  ["你来。", ME],
  ["凭什么听你的。", "火最小的那位"],
  ["不凭什么。", ME],
  ["那你来做什么。", "火最小的那位"],
  ["起一伙人。", ME],
  ["你也算一个。", ME],
  ["我族破的时候，", "火最小的那位"],
  ["也有人这么跟我说", "火最小的那位"],
  ["我没要你信。", ME],
  ["那你凭什么让我留下。", "火最小的那位"],
  ["你要走，也随时走。", ME],
  ["……柴我自己找。", "火最小的那位"],

  ["不拜师，不入派。", ME],
  ["谁也不必向谁磕头。", ME],
  ["只是各自伸一次手。", ME],
  ["主人，我伸了啊！", "最憨的那一个"],
  ["他比我晚！", "最憨的那一个"],
  ["我先说好——往后有事，我头一个上。", "抢着来的那位"],
  ["上之前，", "半躺着的那位"],
  ["先想一想上了怎么办。", "半躺着的那位"],
  ["想什么想！打就是了！", "抢着来的那位"],
  ["打之前想想，打之后也想想。", "半躺着的那位"],
  ["我……在后头。", "站着的那位"],
  ["我这儿留着灯。", "添柴的那位"],
  ["散到哪儿，都有一处亮的。", "添柴的那位"],
  ["契要记。", "摊着册子的那位"],
  ["今日几位，各是什么道", "摊着册子的那位"],
  ["那你记。", ME],
  ["我这人不扛事。", "温声的"],
  ["谁跟谁的话说拧了，", "温声的"],
  ["下雨的时候……我守着。", "最慢的那一位"],
  ["别指望我听主人的。", "火最小的那位"],
  ["没指望。", ME],
  ["记下了。", ME],
  ["记住今天这一下。", "坐着的那位"],
  ["往后散不散，看各人。", "坐着的那位"],

  ["你的道，是什么。", "坐着的那位"],
  ["我……", "季未晚"],
  ["不急。", "温声的"],
  ["慢慢说，这儿没人催你。", "温声的"],
  ["答不出，也不是什么要紧事。", "温声的"],
  ["谁头一天就知道自己的道是什么", "温声的"],
  ["可我……", "季未晚"],
  ["你先坐着。", "温声的"],
  ["坐着想。想不出来", "温声的"],
  ["想不出就先不想。", "温声的"],
  ["主人昨夜说了：", "温声的"],
  ["喝。", "添柴的那位"],
  ["凉了就腥。", "添柴的那位"],
  ["趁热。", "添柴的那位"],
  ["慢点。", "添柴的那位"],
  ["没人跟你抢。", "添柴的那位"],
];

/* ---------------- 文本处理 ---------------- */
const TERM = /[。！？!?…]\s*$/;          // 句末（判定「」是否为句首）
// 判定：句首「」⇒ 对白；否则（引导语贴着引号，如「一个说」「慢慢地说了一句」「起先他不懂」）⇒ 转述语，留在旁白
function isDialoguePrev(prev) {
  const p = String(prev || "").trim();
  if (!p) return true;                       // 段首
  if (TERM.test(p)) return true;             // 上句已收尾
  return /[，、]\s*$/.test(p);               // 「…。」X说，／他先开口，⇒ 同一句话的延续
}
function speakerOf(quote) {
  let hit = null, hitLen = -1;
  for (let i = 0; i < SPEAKER.length; i++) {
    const p = SPEAKER[i][0];
    if (String(quote).indexOf(p) === 0 && p.length > hitLen) { hit = SPEAKER[i][1]; hitLen = p.length; }  // 最长前缀优先
  }
  return hit;
}

function run() {
  const raw = fs.readFileSync(MD, "utf8").replace(/\r/g, "");
  const lines = raw.split("\n");

  const chapters = [];
  let cur = null, para = [];

  const flushPara = () => {
    if (!cur) { para = []; return; }
    const text = para.join("").trim();
    para = [];
    if (!text) return;
    // 逐字扫描：区分「句首对白」与「句中转述语」
    let buf = "", i = 0, atParaStart = true;
    const pushNar = () => {
      const t = buf.trim();
      buf = "";
      if (t) cur.lines.push({ k: "n", t: t });
    };
    while (i < text.length) {
      const c = text[i];
      if (c === "「") {
        const b = text.indexOf("」", i + 1);
        if (b < 0) { buf += c; i++; continue; }
        const q = text.slice(i + 1, b);
        const prev = buf.trim();
        if (isDialoguePrev(prev)) {
          pushNar();
          const who = speakerOf(q);
          cur.lines.push(who === ME ? { k: "me", t: q } : { k: "d", who: who || "", t: q });
        } else {
          buf += "「" + q + "」";                          // 转述语：连同书名号留在旁白里
        }
        i = b + 1;
        atParaStart = false;
        continue;
      }
      buf += c; i++;
    }
    pushNar();
    void atParaStart;
  };

  for (const rawL of lines) {
    const L = rawL.trim();
    const mch = /^##\s*([一二三四五六七八九十]+)\s*·\s*(.+?)\s*$/.exec(L);
    if (mch) {
      if (WANT.indexOf(mch[1]) >= 0) {
        cur = { no: mch[1], title: mch[2], lines: [], notes: [] };
        chapters.push(cur);
      } else cur = null;
      para = [];
      continue;
    }
    if (!cur) continue;
    const msec = /^###\s*(.+?)\s*$/.exec(L);
    if (msec) { flushPara(); cur.lines.push({ k: "s", t: msec[1] }); continue; }
    if (/^〔/.test(L)) {
      flushPara();
      const inner = String(L).replace(/^〔/, "").replace(/〕\s*$/, "").replace(/^画面[：:]\s*/, "");
      cur.lines.push({ k: "sc", t: inner });
      continue;
    }
    if (/^\[/.test(L)) {
      flushPara();
      const m = /^\[(.+?)\]\s*(.*)$/.exec(L);
      if (m) cur.notes.push({ type: m[1], text: m[2] || "" });
      continue;
    }
    if (!L) { flushPara(); continue; }
    para.push(L);
  }
  flushPara();

  // 清理：① 只剩一个言语标签的残段（「你说，」「他说。」——说话人已由对白行承载，⛔ 别再当旁白重复一遍）
  //       ② 同一章内连续完全重复的行
  const TAG_ONLY = /^(你|他|她|那人|那一位|那一个|有人)?(又|也|终于|先)?(说|问|答|开口)[着了过]?[，。、]?$/;
  chapters.forEach((c) => {
    const out = [];
    c.lines.forEach((l) => {
      if (l.k === "n" && TAG_ONLY.test(String(l.t || "").trim())) return;
      const p = out[out.length - 1];
      if (p && p.k === l.k && p.t === l.t && p.who === l.who) return;
      out.push(l);
    });
    c.lines = out;
  });

  emit(chapters);
  report(chapters);
}

function emit(chapters) {
  const CG = [];
  chapters.forEach((c, i) => {
    (c.notes || []).forEach((n) => { if (String(n.type).indexOf("CG") >= 0) CG.push({ ch: i + 1, at: c.title, note: n.text }); });
  });
  const body = chapters.map((c, i) => {
    const bg = JSON.stringify(BG_BY_CHAPTER[c.no] || ["BG-04"]);
    const rows = c.lines.map(jsonLine).join(",\n      ");
    const notes = (c.notes || []).length ? ",\n      notes: " + JSON.stringify(c.notes) : "";
    return '      {\n' +
      '        id: "jq' + (i + 1) + '", no: ' + (i + 1) + ', noZh: "' + js(c.no) + '", title: "' + js(c.title) + '",\n' +
      '        sub: "' + js((c.lines.find((l) => l.k === "s") || {}).t || "") + '",\n' +
      '        bg: ' + bg + ',\n' +
      '        lines: [\n      ' + rows + "\n        ]" + notes + "\n      }";
  }).join(",\n");

  const out = [
    "/* ============================================================",
    " * js/book-jieqi.js —— v180 批G · 《沁灵纪》第一篇〈结契篇〉第 1–4 章（**数据篇**）",
    " * ------------------------------------------------------------",
    " * ⚠️ **机械生成物**：由 docs/_extract_book_jieqi.js 从",
    " *    docs/v180-结契篇-正文-第1-4章.md 抽取而来 —— ⛔ 不许手改本文件；改剧情请改 md 后重跑抽取器。",
    " *",
    ' * 层级：**篇 ＞ 章 ＞ 段**；段 kind：',
    " *     n  = 旁白 ｜ sc = 场景（由〔画面提示〕转来，⛔ 绝不显示〔〕原文）｜ s = 节标题",
    " *     d  = 对白（who = 说话人） ｜ me = 玩家行（正文写「你」的地方）",
    " *   · ⛔ 句中的转述语「…」保留在旁白里（带书名号），不单独立成对话行。",
    " *   · ⛔ [CG候选]/[情绪点]/[分支点] 一律进 notes，**不进正文**。",
    " *   · role：仅用于**立绘解析**的临时映射（身份表姓名）；⛔ 不改正文。",
    " *   · bg：只用 BG_CATALOG 里已有的 key；渲染端只读 Spirits.bgGet ⇒ ⛔ 绝不触发出图 API。",
    " *   · cgCandidates：**只登记不出图**（本批禁止调用任何出图接口）。",
    " * 铁律：⛔ 不碰 ww_spirits key / hashStr / chapLine；⛔ 进度不写进逐串 rec（落 ww_story.book）。",
    " * ============================================================ */",
    "(function (global) {",
    '  "use strict";',
    "",
    "  var BOOK_JIEQI = {",
    '    id: "jieqi",',
    '    name: "结契篇",',
    '    sub: "《沁灵纪》· 第一篇 · 第 1–4 章",',
    '    icon: "🕯",',
    "    // ⛔ CG 候选**只登记、不出图**（本批禁止调用任何出图接口；出图 / 计价待后续批次）",
    "    cgCandidates: " + JSON.stringify(CG) + ",",
    "    chapters: [",
    body,
    "    ]",
    "  };",
    "",
    '  if (typeof module !== "undefined" && module.exports) module.exports = BOOK_JIEQI;',
    "  global.BOOK_JIEQI = BOOK_JIEQI;",
    "})(typeof window !== \"undefined\" ? window : globalThis);",
    "",
  ].join("\n");

  fs.writeFileSync(OUT, out.replace(/\n/g, "\r\n"), "utf8");
}

function jsonLine(l) {
  const t = JSON.stringify(String(l.t || ""));
  if (l.k === "me") return '        { k: "me", t: ' + t + " }";
  if (l.k === "d") {
    const who = String(l.who || "");
    const role = ROLE_MAP[who] || "";
    return '        { k: "d", who: ' + JSON.stringify(who) + (role ? ", role: " + JSON.stringify(role) : "") + ", t: " + t + " }";
  }
  return '        { k: "' + l.k + '", t: ' + t + " }";
}
function js(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, " "); }

function report(chapters) {
  console.log("抽取完成 → js/book-jieqi.js");
  let total = 0;
  chapters.forEach((c) => {
    const n = (k) => c.lines.filter((l) => l.k === k).length;
    total += c.lines.length;
    console.log("  章" + c.no + " " + c.title + "（" + (c.lines.find((l) => l.k === "s") || {}).t + "）" +
      "：段 " + c.lines.length + " ＝ 旁白" + n("n") + " 场景" + n("sc") + " 对白" + n("d") + " 玩家" + n("me"));
    const un = c.lines.filter((l) => l.k === "d" && !l.who).length;
    if (un) console.log("    ⚠️ 无说话人对白 " + un + " 条");
  });
  console.log("  合计段数 " + total + " ｜ 章数 " + chapters.length);
  const stat = {};
  chapters.forEach((c) => c.lines.forEach((l) => { if (l.k === "d" && l.who) stat[l.who] = (stat[l.who] || 0) + 1; }));
  console.log("\n--- 说话人（✓ = 能解析到身份表立绘）---");
  Object.keys(stat).sort().forEach((k) => console.log("   " + (ROLE_MAP[k] ? "✓ " : "· ") + k + (ROLE_MAP[k] ? " → " + ROLE_MAP[k] : " → (无)") + "  ×" + stat[k]));
  const noRole = Object.keys(stat).filter((k) => !ROLE_MAP[k]);
  if (noRole.length) console.log("  ⚠️ 未映射：" + noRole.join("、"));
}

run();
