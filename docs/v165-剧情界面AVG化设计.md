# v165 · 剧情界面 AVG 化设计

> 作者：UI 美术设计师 · 颜配色
> 对象：架构师（照此改 `renderTalkPage` 的 HTML 拼接 + 追加 CSS；行为改动已逐条标出）
> 性质：**纯设计规范**，⛔ 不改任何 `js/` 或 `css/`、⛔ 不 commit
> 参考：用户提供的同类 AVG 剧情界面（整屏立绘 + 底部半透明对话框 + 名牌 + 顶栏返回/菜单）
> 现状代码：`renderTalkPage`（`js/app.js:6049`）· `renderMainTalkPage`（`js/app.js:6260`）· `renderChapTalkPage`（`js/app.js:6289`）· `chapLine`（`js/spirits.js:7074`）· `castBuild`/`castOf`（`js/spirits.js:6989/7039`）· 对话页样式（`css/skin.css:1057-1108`）
> 锚点复核：以上行号已按**批次 3A（#25）落地后**的当前代码逐条核对（`spirits.js` 因 3A 接线整体下移约 +57 行；`app.js`/`skin.css` 行为锚点未变）。⛔ 行号只作**定位线索**，落地时请以函数名/选择器为准（本仓 `spirits.js` 仍在变动）。

---

## 0. 目标观感 & 三条硬约束

**目标**：像在看动画分镜 —— **整屏大立绘**（半身到全身，不是小头像）＋ 立绘后有场景、略带景深 ＋ **底部一条半透明圆角对话框**（横贯、左右留边）＋ **说话人名牌在对话框右上方** ＋ 左上返回 / 右上菜单 ＋ 字大、留白少、暗调沉浸。

**三条硬约束（决定设计能否落地，必须接受）**

| # | 约束（已核代码） | 对设计的影响 |
|---|---|---|
| 1 | **每个角色只有 1 张立绘**（`rec.imgUrl`，竖版 1728×2304＝3:4），**无表情差分、无姿势差分** | ⛔ 不能做「说话时立绘变化」「同一角色换姿势」；群像不能靠多图拼排 |
| 2 | **BG 是 16:9 横版**（`assets/bg/BG-xx.jpg` 或云端永久 URL，经 `bgGet`） | 进竖屏**必被裁**，须给专门方案（§6） |
| 3 | **纯前端 PWA、无构建**，只能改 **HTML 字符串拼接 + CSS** | 方案不得引入框架/依赖；行为改动必须能塞进 `renderTalkPage` 现有函数 |

**现状 ≠ 目标（要先说清差异）**：现在是**聊天气泡流**（`.nt-row` / `.nt-bub`，可滚动，带头像 30px，逐条堆叠）；目标是一条一条推进的**分镜式单句**。所以不是"美化对话框"，是**换一种呈现层**——但**底层消息引擎（`step`/`paint`/`append`/`pick`）可以原样保留**，只换「往哪画」。见 §8。

---

## 1. 数据现状（逐条读码结论，供架构师核对）

### 1.1 一行消息是什么（`chapLine`，`spirits.js:7074`）

| 字段 | 含义 | 谁有 |
|---|---|---|
| `m.w` | 行类型：`"sp"`（角色）/ `"sys"`（旁白）/ `"me"`（玩家） | 全部 |
| `m.text` | 已 `fmt()` 过占位符的台词 | 全部 |
| `m.name` | 说话人标签 —— `sp` 行 = 剧本行级 `who`（如「最老的那只」「门客·数人的」）；`sys`/`me` 恒为 `""` | 全部 |
| `m.slot` | 站位 `L/C/R/B`（`chapAtOf`，非法回落 `C`） | 仅 `sp` 且剧本写了 `at` |
| `m.ps` | 人格型数组（如 `["scholar"]`），**立绘取型就靠它** | 仅 `sp` |
| `m.bg` | 该行覆盖背景 key（可选） | 可选 |
| `m.fx` | 演出效果（`"slow"`/`"cut"`） | 可选 |
| `m.cg` / `m.sfx` / `m.bgm` | 全屏 CG / 音效 / 音乐（本轮不做） | 可选 |

### 1.2 说话人 → 立绘，**现有链路已经通了**（关键结论）

`mainCastThumb(m)`（`app.js:6203`）已经在做「行 → 头像」：
```
m.ps[0]  →  Spirits.castOf()[pid]  →  c.id  →  spiritItemById(c.id)  →  rec = Spirits.load()[c.id]
```
**立绘 URL 就在 `rec.imgUrl`**（见 `spiritImgHtml`，`app.js:2548`：`let url = rec && rec.imgUrl`）。
⇒ 架构师**拿得到当前说话人的整张立绘**，只多一步：把 `rec.imgUrl` 而不是 30px 缩略图给到新图层。**这就是本设计成立的前提**（见 §8.4 新增 `o.portrait`）。

> ⚠️ `casting` 的 `near`（同组回落）/ `fill`（小剧团一人分饰多角，轮转复用）只影响**头像与立绘取型**，⛔ **不改行当名与台词**（`spirits.js:7013`，实现见 `castBuild` `spirits.js:6989`）。UI 不需要区分它们，照常用结果即可。

### 1.3 旁白 / 玩家

- `sys`：无 `ps` → **无立绘**；`m.name === ""` → **无名牌**。
- `me`：无 `ps` → **无立绘**（玩家没有立绘）；名字空 → 名牌写「我」或不显。

---

## 2. 布局规格（竖屏 9:16 基准）

坐标系：`100vh` × `100vw`。沉浸模式下 `.nt-chat` 脱离 `.view` 约束，改 `position:fixed; inset:0`（见 §8.2）。

| 区域 | 位置（相对视口） | 尺寸 | 说明 |
|---|---|---|---|
| **顶栏**（返回/标题/菜单） | 顶端通栏 | 高 ≈ `env(safe-area-inset-top)+56` | 复用既有 `#topbar`（`#btnBack` 左 / `#topbarTitle` 中 / `#btnSettings` 右）。沉浸态改透明浮层（§3） |
| **立绘层** | `inset:0`，铺满整屏，**底部被对话框压住** | 满屏 | `object-fit:cover`，`object-position:center 12%`。**裁切见下** |
| **对话框** | 底部贴边，左右各留 **16px** | `left:16 right:16 bottom:18+safe`；**`min-height:132`**；圆角 `--r-lg(20)` | 半透明暗底 + 背景模糊（§3） |
| **名牌** | **对话框右上方**，骑在框上沿 | `top:-15px; right:20px`；高 ≈ 26（`padding:3px 14px`） | 药丸形；和参考图一致 |
| **继续指示** | 对话框右下角 | 8×8 小三角，`right:16 bottom:10` | 呼吸闪烁 |
| **选项区** | 覆盖在对话框之上（同底边） | `left/right:16`，项间距 8 | 复用 `.nt-opt`，改暗底（§8） |
| **正文排版** | 框内 | 字号 **17.5px** / 行高 **1.78** | 单行 ≤ 22 字、最多 3 行（超出由文案拆句） |

**立绘从哪里开始被裁（重要，写清楚）**：
立绘 3:4（0.75），竖屏 9:16（0.5625）。`cover` 时按**高度铺满**，显示宽度 = `0.75 × 屏高`，而屏宽只有 `0.5625 × 屏高` ⇒ **左右各被裁掉约 12–13%**（合计约 25%），**纵向完整**、头顶微留白。
- ✅ 主体居中的人物不受影响；⛔ 大袖/宽肩立绘两侧可能擦边（可接受，不做补偿）。
- **脚部不裁**（横向裁而非纵向裁）；若想把脚也裁掉做「半身」，把 `object-position` 往下推并配 `transform: scale(1.06)`（可选）。
- ⛔ **禁用 `contain`**：竖屏里会上下留黑条，破坏沉浸。

---

## 3. 层级与遮罩

**前后关系（自下而上）**

| 层 | z-index | 元素 | 说明 |
|---|---|---|---|
| 场景（模糊垫底） | 0 | `.scenebg.blurpane` | 同 BG 放大模糊，铺满，压暗 |
| 场景（清晰） | 1 | `.scenebg.sharppane` | 同 BG `contain` 居中，保留完整 16:9 构图 |
| **立绘** | 2 | `.talk-portrait` | 整屏，主体仅一张 |
| 底部渐暗遮罩 | 3 | `.nt-chat.immersive::after` | 从透明→`rgba(12,9,6,.78)`，**压住立绘下缘、托起对话框** |
| **对话框** | 4 | `.talk-box` | 半透明 + `backdrop-filter: blur(8px)` |
| 名牌 / 继续指示 | 5 | `.talk-name` / `.talk-cue` | 骑在对话框上 |
| 选项 / 结局卡 | 6 | `.nt-foot` | 覆盖在对话框之上 |
| **顶栏** | 50 | `#topbar`（全局，>in-page） | 立于最上，沉浸态透明 |

**对话框要不要压住立绘下部？→ 要。** 两件事一起做：
1. 对话框自身 `background: rgba(24,18,14,.72)` + `backdrop-filter: blur(8px)`（半透明+模糊，立绘透出来但被压暗，字清晰）；
2. 底部再来一道**纵向渐变暗角**（`::after`），保证**任何 BG/立绘**下文字对比都够（暗底白字 ≥ 7:1）。

---

## 4. 说话人规则（`sys` vs `sp` vs `me`）

**现状靠什么区分**（`msgHtml`，`app.js:6073`）：`m.w` 三分支 —— `"sys"`→居中药丸 `.nt-sys`；`"me"`→右对齐气泡；其余（`"sp"`）→左气泡 + `.nt-name`。**新呈现沿用同一判据**：

| 行类型 | 立绘 | 名牌 | 对话框正文 |
|---|---|---|---|
| **`sp`（角色）** | ✅ 显示该说话人立绘（按 `m.slot` 定位） | ✅ `.talk-name` = `m.name`（`who`），右上 | 白字正常排版 |
| **`sys`（旁白）** | ❌ **不显示立绘** | ❌ **无名牌**（关键：旁白不给名字牌） | 居中、色稍淡（`#efe6d6`）、不加引号 |
| **`me`（玩家）** | ❌ 不显示立绘（玩家无图） | 可选：名牌写「我」，或干脆不显 | 正常排版 |

- 名牌用 `m.name`；为空时**整体 `hidden`**（`sys`/`me` 自然落到无牌）。
- 旁白与角色**连续穿插**时，立绘做**淡出/淡入**（§7），不做位移（避免抖动）。

---

## 5. 多人场面（`slot` = L/C/R/B）—— 本项目最难的一点

### 5.1 决策：**只显示「当前说话人」的立绘，其余一律隐去（spotlight 聚光灯）**

**理由（按约束排序）**：
1. **每个角色只有 1 张立绘** ⇒ 无法用"多张不同立绘拼一排"表现群像，硬排只会出现**几张同姿势同画风的图并排**，反而认不出谁是谁、显得廉价。
2. 群像戏（最多 7 行当同场）里，**说话人是谁**才是玩家要读的信息；AVG 惯例也是「谁说话谁上场」。
3. 同一时间只挂一张立绘，**性能/内存最省**（立绘图很大），也避免遮挡对话框与选项。
4. 与「一张图 + 无差分」这条硬约束**唯一自洽**的方案。

### 5.2 `slot` 只决定**当前说话人的水平站位**（让同一张图"站"在不同侧，制造对话感）

| `m.slot` | 位置 | 实现 |
|---|---|---|
| `L`（左） | 立绘左靠（`translateX(-12%)`） | 感觉像「左边那位在说」 |
| `C`（中，缺省） | 居中 | 单人独白 / 主说话人 |
| `R`（右） | 立绘右靠（`translateX(+12%)`） | 「右边那位在说」 |
| `B`（后） | 居中 + `scale(.9)` + 降透明 + 微压暗 | 表示"在后排"（如门客、旁观者） |

### 5.3 切换纪律（防"立绘闪烁"）

- **同一人连续说**：立绘**不动、不重播**任何动画（只换文字）。
- **换人**：旧立绘 `opacity→0`、新立绘 `opacity→1`，**220ms 交叉淡入**；不做左右横移（7 人快速对话会晃）。
- 若一行 `m.ps` 缺失（旁白/玩家）：立绘整体淡出到无（BG 露脸）。

> ⚠️ 取舍代价（要写进给用户的说明）：**同场其他人不会出现在画面上**。这是"一张立绘 + 无差分"下的必然取舍；若将来做了**立绘差分（表情/姿势）**，可升级为"2–3 人并排 + 说话人高亮"，本轮不做。

---

## 6. 与 BG 的比例冲突（横版 16:9 → 竖屏 9:16）

**方案（选一个，推荐 A）**

### ✅ 方案 A（推荐）：**双层 BG —— 模糊垫满 + 清晰包含（blur-fill）**
- **底层 `.blurpane`**：同一张 BG，`cover` + `blur(22px)` + `brightness(.72)` + `scale(1.14)` → 铺满上下，柔和不抢戏（补掉 16:9 进竖屏的上下空档）。
- **上层 `.sharppane`**：同一张 BG，`contain` + 居中偏上 → **完整 16:9 构图可见**，不裁两侧。
- 好处：**不丢构图、不裁主体、不用出图**；纯 CSS，无依赖；观感是"背景虚化 + 画面居中"，接近参考图。
- 代价：上下是"同图虚化"不是"延伸"，但因为是虚化层，肉眼几乎不觉。

### 备选
- **B 裁切（cover 单层）**：竖屏下**左右各裁约 44%**（16:9→9:16 是剧烈裁切），会切掉巷子两侧院墙/院落左右——**不推荐**（我们的 BG 刻意留了两侧）。
- **C 上下留黑（contain + 黑边）**：最安全但最"不像动画"，沉浸感差。
- **D 渐变过渡**：`.scenebg.noimg` 已有暖色渐变兜底（`skin.css:1062`），用于**未出图**时，保留。

**未出图 / 加载失败**：沿用 `.scenebg.noimg` 暖色渐变（`linear-gradient(160deg,#efe3cd,#e7d8bd,#d8c6a4)`），⛔ 不阻塞、不出图。

---

## 7. 动效（克制优先）

| 动效 | 时长 | 缓动 | 触发 |
|---|---|---|---|
| 立绘入场（换人） | 220ms 交叉淡入 | `var(--ease-out)` | 说话人变更 |
| 立绘轻微上浮（首次登场） | 260ms，`translateY(10px)→0` | `var(--ease-out)` | 该章首次显示立绘 |
| 对话框文字切换 | 无动画（直接换字） | — | 推进一句 |
| 继续指示 | 1.1s 循环（上下 3px + 透明呼吸） | `ease-in-out` | 等待点击 |
| 选项浮现 | 160ms，阶梯 60ms | `var(--ease-out)` | 进入选择 |
| 点击反馈 | 120ms `scale(.98)` | `--ease-spring`（复用 `skin.css:15`） | 点舞台推进 |
| BG 换场 | 320ms 交叉淡入 | `var(--ease-out)` | `m.bg` 变化 |

**⛔ 克制纪律**：全篇只有「淡入淡出 + 一个小三角呼吸」；不做视差、不做转场特效、不做立绘摇摆（与"一张图无差分"配合，摇出问题）。

**「减少动态效果」降级**（项目目前**没有** `prefers-reduced-motion` 规则，需新增）：
```css
@media (prefers-reduced-motion: reduce) {
  .talk-portrait, .scenebg, .nt-opt { transition: none !important; animation: none !important; }
  .talk-cue { animation: none; opacity: .8; }
}
```

---

## 8. 给架构师的落地清单（逐条，具体到选择器/现有位置）

### 8.1 `renderTalkPage` 的 HTML 改动（`app.js:6059-6066`）

**现在**：
```js
view.innerHTML = '<div class="nt-chat">' +
  '<div class="scenebg' + (_bgUrl ? "" : " noimg") + '" id="sceneBgLayer"></div>' +
  '<div class="nt-chat-head">…</div>' +
  '<div class="nt-body" id="ntBody"></div>' +
  '<div class="nt-foot" id="ntFoot"></div></div>';
```
**改成**（保留 `ntBody`/`ntFoot` 作引擎输出位，新增立绘层 + 对话框；`.nt-body` 改为隐藏）：
```js
view.innerHTML = '<div class="nt-chat immersive">' +
  '<div class="scenebg blurpane' + (_bgUrl ? "" : " noimg") + '" id="sceneBgBlur"></div>' +
  '<div class="scenebg sharppane' + (_bgUrl ? "" : " noimg") + '" id="sceneBgLayer"></div>' +
  '<div class="talk-portrait" id="talkPortrait"></div>' +
  '<div class="nt-chat-head">…</div>' +          // 保留，但沉浸态 CSS 隐藏
  '<div class="nt-body" id="ntBody"></div>' +     // 引擎照旧追加；沉浸态 CSS 隐藏
  '<div class="talk-box" id="talkBox">' +
    '<div class="talk-name" id="talkName" hidden></div>' +
    '<div class="talk-text" id="talkText"></div>' +
    '<i class="talk-cue" id="talkCue" hidden></i>' +
  '</div>' +
  '<div class="nt-foot" id="ntFoot"></div></div>';
```
- `_bgUrl` 仍走原有 `_sbl.style.backgroundImage` 那套；**两张 pane 都要设**（`#sceneBgBlur` 与 `#sceneBgLayer`），或给两张同一个 `backgroundImage`（对外只有 `bgUrlOf` 一个来源）。

### 8.2 CSS 覆盖（**注意文件落点**）

⚠️ **实测更正**：对话页样式**不在 `css/style.css`**，而在 **`css/skin.css`（1056–1108 行 `.nt-chat`…）**。请把新规则放**同一层**（避免两份来源）；`skin.css` 是 **LF**，`style.css` 是 **CRLF**，**别混行尾**（混了会整文件 diff 爆炸）。以下为可直接粘贴的覆盖块：

```css
/* ===== v165 剧情页 AVG 化（沉浸模式） · 追加到 skin.css 对话页段之后 ===== */
body.talk-open { overflow: hidden; }
body.talk-open .tabbar { display: none; }          /* 沉浸时不显示底部导航 */
body.talk-open .view { padding: 0; max-width: none; }

/* 整屏容器：脱离 .view，铺满视口 */
.nt-chat.immersive { position: fixed; inset: 0; z-index: 40;
  display: block; border-radius: 0; overflow: hidden; background: #14100c; }
.nt-chat.immersive .nt-chat-head,
.nt-chat.immersive .nt-body { display: none; }     /* 旧聊天气泡流整体退场 */

/* 双层 BG */
.nt-chat.immersive .scenebg { position: absolute; inset: 0; z-index: 0; border-radius: 0; opacity: 1; pointer-events: none; }
.nt-chat.immersive .scenebg.blurpane  { background-size: cover;  background-position: center;
  filter: blur(22px) saturate(.95) brightness(.72); transform: scale(1.14); }
.nt-chat.immersive .scenebg.sharppane { background-size: contain; background-position: center 42%; z-index: 1; }
/* 底部渐暗遮罩：压立绘下缘、托对话框 */
.nt-chat.immersive::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 46%;
  z-index: 3; pointer-events: none;
  background: linear-gradient(180deg, rgba(12,9,6,0) 0%, rgba(12,9,6,.42) 58%, rgba(12,9,6,.78) 100%); }

/* 立绘层：整屏，铺满（左右各裁约 12–13%） */
.talk-portrait { position: absolute; inset: 0; z-index: 2; pointer-events: none;
  transition: opacity .22s var(--ease-out), transform .26s var(--ease-out); }
.talk-portrait img { width: 100%; height: 100%; object-fit: cover; object-position: center 12%;
  filter: drop-shadow(0 10px 28px rgba(0,0,0,.5)); }
.talk-portrait[data-slot="L"] { transform: translateX(-12%); }
.talk-portrait[data-slot="R"] { transform: translateX(12%); }
.talk-portrait[data-slot="B"] { transform: scale(.9); opacity: .78; filter: brightness(.82); }
.talk-portrait.hide { opacity: 0; }               /* 旁白/玩家：立绘淡出 */
.talk-portrait.enter { transform: translateY(10px); opacity: 0; }

/* 对话框 */
.talk-box { position: absolute; left: 16px; right: 16px;
  bottom: calc(18px + env(safe-area-inset-bottom)); z-index: 4;
  min-height: 132px; padding: 16px 18px 22px; border-radius: var(--r-lg);
  background: rgba(24,18,14,.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255,238,214,.16); box-shadow: 0 10px 30px rgba(0,0,0,.45);
  color: #fdf6ea; font-size: 17.5px; line-height: 1.78; }
.talk-box.narration { text-align: center; color: #efe6d6; opacity: .94; }
.talk-name { position: absolute; top: -15px; right: 20px; z-index: 5;
  padding: 3px 14px; border-radius: 99px; font-size: 13px; letter-spacing: 1px; color: #fff8ec;
  background: linear-gradient(180deg, #8a6136, #6b4a2c); box-shadow: 0 2px 8px rgba(0,0,0,.3); }
.talk-cue { position: absolute; right: 16px; bottom: 10px; width: 0; height: 0;
  border-left: 6px solid transparent; border-right: 6px solid transparent;
  border-top: 8px solid rgba(255,238,214,.75); animation: talkCue 1.1s ease-in-out infinite; }
@keyframes talkCue { 0%,100%{ transform: translateY(0); opacity:.5 } 50%{ transform: translateY(3px); opacity:1 } }

/* 选项 / 结局：压到最上，暗底 */
.nt-chat.immersive .nt-foot { position: absolute; left: 16px; right: 16px;
  bottom: calc(20px + env(safe-area-inset-bottom)); z-index: 6; margin: 0; }
.nt-chat.immersive .nt-opt { width: 100%; background: rgba(24,18,14,.82); color: #fdf6ea;
  border-color: rgba(255,238,214,.2); }

/* 顶栏沉浸态：透明浮层 */
body.talk-open .topbar { background: linear-gradient(180deg, rgba(12,9,6,.55), rgba(12,9,6,0));
  border-bottom-color: transparent; backdrop-filter: none; }
body.talk-open .topbar-title { color: #fdf6ea; text-shadow: 0 1px 3px rgba(0,0,0,.5); }
body.talk-open .topbar .icon-btn { color: #fdf6ea; background: rgba(0,0,0,.25); }
```

### 8.3 行为改动（**最小集，仅 "往哪画"**）

引擎（`step`/`paint`/`append`/`pick`/`showFoot`）**全部保留**，只在每显示一条时**同步更新对话框**：

1. 在 `renderTalkPage` 里新增一个「呈现函数」，并在**三处**调用它：
   - `append(m)`（`app.js:6099`）末尾；
   - `step()` 里 `me` / `sys` 的即时分支（`app.js:6148-6149`）；
   - `step()` 里三点气泡结束后 `append(m)` 的那处（`app.js:6158`，其实已包含在 `append` 里，**只需改 `append` 一处**——⚠️ 请架构师确认：`me`/`sys` 分支也走 `append`，那统一改 `append` 即可，⛔ 别重复调）。
2. `present(m)` 逻辑（伪码）：
   ```
   const nameEl = $("#talkName"), txtEl = $("#talkText"), cueEl = $("#talkCue"),
         boxEl = $("#talkBox"), pEl = $("#talkPortrait");
   if (m.w === "sys") { pEl.classList.add("hide"); pEl.innerHTML = "";
                        boxEl.classList.add("narration"); nameEl.hidden = true; }
   else { boxEl.classList.remove("narration");
          nameEl.textContent = (m.w === "me") ? "我" : (m.name || "");
          nameEl.hidden = !nameEl.textContent;
          const url = o.portrait ? o.portrait(m) : "";
          const side = m.slot || "C";
          if (url) { if (pEl.dataset.side !== side || pEl.dataset.url !== url) {
                       pEl.dataset.side = side; pEl.dataset.url = url;
                       pEl.classList.remove("hide"); pEl.innerHTML = '<img src="'+esc(url)+'" alt="">'; } }
          else { pEl.classList.add("hide"); pEl.innerHTML = ""; } }
   txtEl.textContent = String(m.text || "");
   cueEl.hidden = false; }
   ```
3. **推进（点击继续）**：`body.addEventListener("click", …)`（`app.js:6174`）已经是"整屏点击推进"——**保留**；只需在沉浸态确保点击**不落在选项按钮**上时也推进（现在就这样）。可加：点对话框区域也给反馈（`scale(.98)` 由 CSS `:active` 承担）。
4. **body class**：`renderTalkPage` 开头 `document.body.classList.add("talk-open")`；在**中央路由分发处**（每次换页渲染前）`document.body.classList.remove("talk-open")`——⛔ 不要逐个页面去删。

### 8.4 两个调用点各要补的 option（`app.js:6267` / `app.js:6308`）

新增 `portrait: (m) => url`（**这就是 §1.2 说的那一步**）：

- **`renderMainTalkPage`（群像，`app.js:6267`）**：
  ```js
  portrait: (m) => {
    try {
      const pid = (m && m.ps && m.ps[0]) ? String(m.ps[0]) : "";   // sys/me → 无
      if (!pid) return "";
      const c = (Spirits.castOf() || {})[pid]; if (!c || !c.id) return "";
      return (Spirits.load()[c.id] || {}).imgUrl || "";
    } catch (e) { return ""; }
  },
  ```
- **`renderChapTalkPage`（旧单串，`app.js:6308`）**：
  ```js
  portrait: (m) => (m && m.w === "sp") ? (rc0.imgUrl || "") : "",
  ```
- 夜话页（`renderTalkPage` 的其它调用点）**可不传** → 回落 `""` → 无立绘（BG + 对话框），⛔ 不报错。

### 8.5 顺带（可选，非必须）

- `.nt-chat-head`（剧情页顶部封面条，`app.js:6060`）在沉浸态已隐藏；如需保留"章节·第 N 章"信息，可把它降级为顶栏标题（`topbarTitle` 已经在显示 `o.title`，无需额外做）。

---

## 9. 风险与取舍（明确"做得到 / 代价太大"）

| 项 | 结论 |
|---|---|
| 整屏立绘 + 底部对话框 + 名牌 | ✅ **做得到**（纯 HTML/CSS + 一处 `append` 呈现函数） |
| 立绘按 `slot` 左右/后排站位 | ✅ 做得到（`data-slot` + transform） |
| **多人同框并排** | ⚠️ **代价太大**：只有 1 张立绘、无差分 ⇒ 并排=几张同姿势图，认不出人、且遮挡对话框。**本轮不做**（§5） |
| **说话时立绘变化（表情/口型/姿势）** | ⛔ **做不到**：无差分。要做得先让美术出差分（成本高，另立项） |
| 全屏 CG（`m.cg`） | ⚠️ 引擎字段已有（`chapLine` 收 `cg`），但**本轮不做**；将来可做"插入一张整屏 CG 盖过立绘层"（z-index 更高的一层，一次淡入） |
| 横版 BG 进竖屏 | ✅ 方案 A（模糊垫满 + 清晰 contain），**不裁主体、不出新图** |
| 性能 | ✅ 同时只挂 1 张立绘图 + 1 张 BG（两张同源 BG 会各自解码一次；若担心内存，`.blurpane` 可用同一 URL，浏览器会复用缓存） |
| 长台词 | ⚠️ 对话框最多 3 行；超出**由文案拆句**，⛔ 不做滚动条（破坏沉浸） |

**需要架构师额外提供的数据**（§1.2 / §8.4）：
- ⚠️ **必须新增 `o.portrait(m)`**：`renderTalkPage` 现在只把说话人做成 30px 头像（`o.av`），**拿不到"当前说话人的整张立绘 URL"**。按 §8.4 在两个调用点各补一个 `portrait` 即可（实现同 `mainCastThumb`，但返回 `rec.imgUrl` 而非缩略图）。
- `m.slot` / `m.name` / `m.ps` / `m.w` **已全有**，无需新增。
- 若某只沁灵**还没出立绘**（`rec.imgUrl` 为空）：`portrait` 返回 `""` → 该行只显示 BG + 对话框（可接受，⛔ 不阻塞）。

---

## 10. 自检

| 检查项 | 结果 |
|---|---|
| 布局给百分比/尺寸、标了立绘裁切 | ✅ §2（竖屏横裁 ~12–13%/侧） |
| 层级与遮罩（对话框是否压立绘） | ✅ §3（半透明+模糊+底部渐暗，暗底白字 ≥7:1） |
| `sys`/`sp`/`me` 区分 + 旁白无名牌 | ✅ §4（沿用 `m.w` 判据） |
| 多人场面（slot）取舍与理由 | ✅ §5（spotlight 单立绘 + `slot` 定位；并排=代价太大不做） |
| 横版 BG 进竖屏方案 | ✅ §6（方案 A blur-fill，附备选） |
| 动效 + 减动态降级 | ✅ §7（新增 `prefers-reduced-motion`） |
| 落地清单具体到选择器/行号 | ✅ §8（HTML 段 / CSS 选择器 / 行为定点 / 调用点 option） |
| 风险与取舍 | ✅ §9（明确做不到 vs 代价太大） |
| 需要架构师补的数据 | ✅ §8.4（`o.portrait`） |
| 行号锚点复核（批次 3A #25 落地后） | ✅ 全部重核：`app.js`/`skin.css` 锚点未变；`spirits.js` 已按新行号更新（`chapLine` 7074 / `castOf` 7039 / `castBuild` 6989） |
| 改动 `js/` `css/` | **0 行** ✅ |

*—— 颜配色 · v165*
