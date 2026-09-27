# 📋 项目开发档案（给未来开发者的交接文档）

> 本文件记录项目的完整背景、功能清单、技术决策与历史迭代，供任何新的开发者/AI 快速接手。
> **换电脑 / 换 API / 换助手时：先 `git clone https://github.com/beibei1014/wenwan-collection.git`，然后读本文件 + README.md + `git log`。**

---

## 一、项目是什么

**「我的收藏馆」**——一个手机优先的 **PWA 网页应用**，用于记录和展示用户的文玩手串 / 拼图 / 动漫周边收藏（图鉴式收藏柜）。

- 线上地址：https://beibei1014.github.io/wenwan-collection/
- GitHub 仓库：https://github.com/beibei1014/wenwan-collection （默认分支 main）
- 纯前端，无构建步骤，直接 HTML/CSS/vanilla JS，GitHub Pages 托管

## 二、核心架构

| 层 | 技术 |
|----|------|
| 前端 | 原生 HTML/CSS/JS（单页应用，hash 路由），PWA（sw.js + manifest.json） |
| 后端 | **Supabase**：Postgres + Auth（邮箱密码）+ Storage（图片）+ RLS 行级隔离 |
| 托管 | GitHub Pages |
| 图片压缩 | 浏览器 Canvas 压缩到 ≤200KB（js/image.js） |

**多账号隔离**：每个用户通过 Supabase Auth 登录，`bracelets` 表 RLS 按 `user_id` 隔离。**邀请制**：无公开注册页，账号由管理员在 Supabase Auth 面板手动创建。

## 三、关键文件

```
index.html          # 入口：底部导航 + 大图查看器 DOM + 模块加载
sw.js               # Service Worker（网络优先）；每次发版必须 bump CACHE = "wenwan-vXX"
manifest.json       # PWA 清单
gallery.html        # 动态展厅（公开可访问的分享网页，读 URL ?data= 参数，无需登录）
js/config.js        # SUPABASE_CONFIG（url + anonKey，publishable key，客户端安全）
js/color.js         # 手串主色识别（中心区域主色→7类）+ COLOR_LIST（按浅→深排序顺序）
js/db.js            # 数据层：CRUD + 图片上传/删除 + 精确降级 + 天数计算
js/app.js           # 全部 UI 与逻辑（约 5600 行，IIFE；珠型表 SHAPE_LIST 也在其中）
js/spirits.js       # 挂瓷精灵：外观锚点/四形态进化/prompt 构造 + 出图通道（7 家服务商）与文字模型通道
js/rooms.js         # 精灵的小房间：房间 CRUD / 契合度 / 剧情门槛与存档（v109）
js/categories.js    # 分类 → 品种/品牌联动；拼图分类才有 pieceCount/finishedAt
js/stats.js         # 统计：月历热力图、成就分组、有趣发现
js/game.js          # 游戏化：XP/等级/每日任务（按日期种子随机）/不买挑战/抽卡
js/poster.js        # Canvas 生成分享海报（单条 + 图鉴 + 成就 + 喜欢展柜）
js/tips.js          # 文玩养护小知识
js/ocr.js           # 订单截图识别（已默认关闭，仅存截图）
css/style.css       # 主题变量：浅色/深色/跟随系统/多巴胺/莫兰迪(蓝紫绿)
supabase-*.sql      # 建表脚本（见第四节）
DEVELOPMENT.md      # 本档案（交接文档，务必保持更新）
```

## 四、Supabase 数据库

- 项目：`qyrqaqayynjfovfuddec`（Supabase 控制台，账号属于用户本人）
- 配置入口：js/config.js；建表脚本：`supabase-schema.sql`

**`bracelets` 表字段**（注意：历史迭代多次 alter，脚本分散在多个 supabase-*.sql）：
`id, user_id, name, species, craft, arrived_at, price, shop, gifted, gifted_at, played, played_note, note, photos(jsonb), screenshots(jsonb), created_at, updated_at, bead_size, category, finished_at, piece_count, accessory_type, play_status, last_played_at, first_played_at, play_count, star, fav, color, bead_shape, softness`

**⚠️ 唯一待执行的一条（v91 软糯程度用；不执行也能用，但换手机不同步）**：
- `softness`：`alter table public.bracelets add column if not exists softness text not null default '';`

**数据库字段（✅ 用户已于 v88 前全部执行完毕，脚本留档备查，不需要再提醒用户执行）**：
- `play_status`：`alter table public.bracelets add column if not exists play_status text not null default '';`
- `last_played_at`：`alter table public.bracelets add column if not exists last_played_at timestamptz;`
- `play_count`：`alter table public.bracelets add column if not exists play_count int not null default 0;`
- `star`：`alter table public.bracelets add column if not exists star int not null default 0;`
- `fav`：`alter table public.bracelets add column if not exists fav boolean not null default false;`
- `color`：`alter table public.bracelets add column if not exists color text not null default '';`
- `bead_shape`：`alter table public.bracelets add column if not exists bead_shape text not null default '';`
- `first_played_at`：`alter table public.bracelets add column if not exists first_played_at timestamptz;`（v78，详情页「首次盘玩/盘玩周期」用）

**`profiles` 表（连续打卡用）**：
- `play_days`：`alter table public.profiles add column if not exists play_days jsonb not null default '[]'::jsonb;`（✅ 已执行）
  - 存打卡日期数组（`["2026-09-12", ...]`），用于「连续打卡」；缺此列时打卡仍在本机生效但云端不同步（会提示一次）

**字段含义**：
- `play_status`：菩提类 `unplayed`(未盘玩) / `ready`(待盘玩) / `playing`(盘玩中) / `done`(**已挂瓷**，v88 前叫"已盘好") / **`wearing`(佩戴中，v89 新增)**；拼图类 `puzzle_pending` / `puzzle_done`；`` '' `` 归一为 unplayed
- `last_played_at`：上次盘玩时间（timestamptz），盘玩时长/抽卡进池判断靠它
- `play_count`：盘玩次数（int，默认 0），「今日盘过」和手动设置上次盘玩时间时 +1，排序用（v54）
- `star`：星级（int，0-5，默认 0），5 星自动进喜欢/收藏展示柜；toFront 兼容旧 fav（旧 fav=true → 5 星，旧 fav=false → 0 星）；fav 字段保留并写为 `star>=5`（v55）
- `fav`：特别喜欢标记（boolean），喜欢展示柜用
- `color`：主色类别（text，v47 改为 7 类：white 白/原生态 / green 绿 / yellowbrown 黄棕 / blackgray 黑灰 / duo 多宝敦煌 / lightflower 浅花 / deepflower 深花），颜色排序筛选用；`normColor()` 兼容旧值（yellow/brown→yellowbrown、black→blackgray、red→deepflower、mixed/purple/blue→duo 等）
- `bead_shape`：珠型（text，默认 `''`，v70 新增），存英文枚举：`round/barrel/apple/abacus/saucer/lantern/melon/drum/oldtype/carved/freeform/gourd/peacebuckle/plaque/other`；中文名由 `SHAPE_LIST` 映射（`shapeLabel()`）；**手工选择，不做自动识别**；`shapeLabel()` 对未知值原样返回（兼容手工写入）
- `category`：菩提/水晶/玉石/拼图/动漫周边/盲盒/其他（用户可自定义增删，存 localStorage `ww_categories`）
- `photos`/`screenshots`：jsonb 数组，每项 `{url, name, ...}`（Blob 只在本地上传前存在）
- `profiles` 表：`id, display_name, updated_at`（昵称）

**Storage**：bucket `bracelet-images`，按用户隔离（RLS），公开读取（public read policy）。

## 五、功能清单（截至 v109）

1. **收藏录入/编辑**：名称、分类联动品种/品牌、工艺（干磨/水磨）、到货时间、陪伴时长（自然日自动算）、价格（隐藏小眼睛）、店铺（记忆常用）、状态（**菩提 4 态** + 拼图 2 态 + 已送人；水晶/玉石等只显示在库/已送人）、**主色（自动识别+可手动选）**、拼图完成时间、拼图片数（500/1000/1500/2000）、动漫周边类型、照片+订单截图（各≤9张、批量上传自动压缩≤200KB）、备注、盘玩记录
2. **底部导航（6+1）**：首页 | 分类 | 喜欢 | ＋（居中新建）| 任务 | 成就 | 设置；`#/quest`(任务) 和 `#/fav`(喜欢) 也从底部直达
3. **喜欢/收藏展示柜（fav 字段）**：卡片/列表右下角 **❤️/🤍** 一键标记喜欢（存数据库 `fav` 字段，跨设备同步）；底部"喜欢"tab 进入展示柜页（renderFavPage），展示所有喜欢的宝贝；详情页也有"喜欢"按钮
4. **喜欢页沉浸式大图**：一屏一个宝贝（左右滑动 + ◀▶ 按钮 + 圆点切换 + 第 X/N 件计数），深色展柜背板 + 射光灯效；含"查看详情"按钮
5. **喜爱展柜分享（两种）**——
   - **🏛 海报**：`Poster.favPoster()` 生成**浅色质感展厅**海报（一行 2 个大图、无边框沉浸式、图片 contain 完整显示不裁剪不拉伸、铜牌名称+品种），存 JPG 到相册/微信
   - **🔗 动态展厅**：生成公开可访问的动态网页链接 `gallery.html?data=<编码数据>`，任何人（无需登录）打开即见深色展柜 + 射灯扫光 + 旋转光晕动画，左右滑动切换；数据只含公开信息（名称/图片URL/分类/品种/尺寸），图片 URL 公开可访问
6. **菩提盘玩状态机（v37 简化为 4 态，仅「菩提」分类）**：`unplayed`(未盘玩) / `ready`(待盘玩) / `playing`(盘玩中) / `done`(已盘好)。每个菩提记录 `lastPlayedAt`；**盘玩中显示"已放置 X 天"**（今天−上次盘玩）；点状态徽章弹状态选择器，含"✅ 今日盘过"（记录今天盘了→转盘玩中）；详情页"盘玩时长"字段可**手动设置上次盘玩时间**（日历）
   - 兼容：旧 `resting`(放置中) → `playing`；旧 `idle` → `ready`；旧 `"" / null` → `unplayed`（在 `loadItems()` 和 `normBeadStatus()` 处理）
7. **今日心选抽卡（仅抽菩提）**：首页"🎴 今日心选"栏目，用户**主动点击抽取**，候选池 = 待盘玩/盘玩中/已盘好 且**放置时间 > 2 天**（距上次盘玩超过 2 天，或从未盘过）——v74 统一口径；按**当天日期种子**随机抽 3 串，当天固定、次日变化；点"🔄 重抽"用随机盐换一批；结果存 localStorage（`ww_draw_YYYY-M-D`）；拼图/周边/水晶/玉石不参与
8. **手串主色识别（js/color.js，v47）**：分析照片**中心区域**主色映射到 **7 类**（绿/多宝敦煌/黑灰/黄棕/白原生态/浅花/深花），`COLOR_LIST` 顺序即浅→深排序顺序。保存时自动识别；登录后后台给旧宝贝补色（backfillColors）；详情/编辑/批量编辑可手动改色；**排序改 3 按钮（入库/创建/颜色，点击切换升/降序带箭头）**；筛选 chips 加颜色；`normColor()` 兼容旧颜色值
9. **大图查看器**：点图放大，底部数字按钮切换多图（每次切换重新绑定事件）
10. **分类盒子页**：按分类展示 + 收集进度（品种/品牌收集率）
11. **批量录入**：一次填多行；**多选操作**：勾选卡片（≤20）批量编辑（转分类/状态/上次盘玩时间/大小/品种/主色/删除）+ 生成图鉴海报
12. **分享海报**：单条海报 + 图鉴长图 + 成就海报（Canvas 生成，系统分享/保存）
13. **统计页**：GitHub 风月历热力图（按月翻看）、花费统计、成就徽章（囤囤鼠系列 tier：囤囤新鼠→囤囤鼠→囤囤大仙→囤货龙王等，点击设置展示称号，最多 6 个）
14. **游戏化**：XP/等级称号（收藏萌新→异世界收藏王）、**每日任务 4 个**（当日型池 5 选 2 + 达成型池 11 选 2，按日期种子随机，当天一致次日变化）、不买挑战（隐藏自动累计）、升级弹窗
15. **有趣发现**（统计页底部）：最贵/最省/性价比之王/陪伴最久/平均单价/最宠爱的品种/在库率/送出的宝贝 + 成就类趣味内容（壕无人性/手都冒烟了/天道酬勤等），每次进入随机挑 5 条
16. **Tips 知识库**：按材质/分类显示养护、禁忌、盘玩、冷知识
17. **修改密码**（设置页 → 数据与账户 → 修改密码）：弹窗输入新密码+确认，调 Supabase `updatePassword`（`auth.updateUser({password})`）
18. **多账号 + 云同步** + **PWA 离线可用** + **数据导出/导入 JSON**
19. **颜色分类细化 7 类 + 浅→深排序（v47）**：白/原生态 > 绿 > 黄棕 > 黑灰 > 多宝敦煌 > 浅花 > 深花；`normColor()` 兼容旧颜色值（yellow/brown→yellowbrown、black→blackgray、red→deepflower、mixed/purple/blue→duo 等）；排序改 3 按钮（入库/创建/颜色），点击切换升/降序带箭头
20. **主色标签展示（v48-49）**：首页卡片/列表展示主色标签（未分色用紅色醒目提示「🎨 未分色」）；多选编辑列表复用 `colorTagHtml/beadStatus` 显示主色+盘玩状态标签；多选改列表形式勾选（复选框）
21. **筛选改多选 + 隐藏已送人开关（v50-51）**：状态+颜色 chips 可同时勾选（含「✕ 清除」按钮）；首页折叠筛选面板加「🙈 隐藏已送人」开关（默认隐藏，关闭显示全部；手动筛「已送人」时始终显示）；修复排序箭头不显示（点击后重新渲染首页）
22. **收藏分布统计（v52，统计页）**：stats.js 新增 `distributions()`，按「主色/收藏盒子/状态/价格区间」四个维度统计数量与占比，用横向条形图展示（带隐私、复用 `stats-card` 风格）
23. **搜索/排序增强（v52）**：搜索框支持**颜色名/颜色值**（如"绿""yellowbrown"）与**价格区间**（`100-300`、`>500`、`<=200`、`100~300`）；**v74 起支持多关键词**（空格分隔、全部命中 = AND）；排序按钮从 3 个扩到 5 个（入库/创建/**价格**/**陪伴时长**/颜色），价格排序时**未记价的宝贝永远排最后**（不污染升降序）
24. **盘玩计划（v52，首页栏目）**：game.js 新增 `playPlan()`，温和提醒哪些「菩提」串该盘了——只针对 待盘玩/盘玩中 的串，按「距上次盘玩天数」排序，**从未盘过的最优先**，闲置 ≥7 天标红「该盘啦」；轻量非打卡，无进度条/无强行打卡，点卡片进详情，点「＋更多待盘」筛选出所有待盘/盘玩中
25. **筛选面板改版（v53）**：去掉首页折叠面板顶部的**纯数据统计行**（共/在库/盘玩/待盘/待拼/已好/已送），把数量**直接内嵌到筛选 chip 上**（状态与颜色 chips 都显示实时数量）；状态行首加「共 N」总计数标识（非交互）；**拼图相关状态（待拼/已拼）仅当分类含「拼图」时才出现**，盘玩状态（未盘玩/待盘玩/盘玩中/已盘好）仅当分类含「菩提」时才出现；**筛选面板展开态持久化**（localStorage `ww_filter_open`），点击筛选 chip 不再自动收起，方便多选
26. **筛选统计联动「隐藏已送人」（v54）**：打开「🙈 隐藏已送人」时，所有筛选统计（共/在库/各状态/颜色计数）与筛选按钮上的数字**都排除已送人**；关闭时算全部
27. **盘玩计划改紧凑网格（v54）**：首页「🧭 盘玩计划」从大卡片改为**紧凑网格**（一行 3-4 个，最多 2 行），每格只显示**照片 + 几天没盘**，不再显示名称/品种；点格进详情，点「＋更多」筛出全部待盘/盘玩中
28. **盘玩次数统计与排序（v54）**：新增 `play_count` 字段（今日盘过/手动设上次盘玩时 +1）；排序按钮「⏳ 陪伴时长」改为「🤲 盘玩次数」，降序=盘得多在前，方便看哪些盘得多、哪些该多盘；详情页「盘玩时长」下方显示「盘玩次数」
29. **盘玩计划/列表细节（v55）**：盘玩计划改为紧凑网格后，去掉「＋更多待盘」格子（点小格直接进详情）；宝贝列表视图右下角把「⏳ 陪伴天数」改成「🤲 盘 N 次」
30. **收藏盒子页接入筛选+排序+搜索（v55）**：点进某分类盒子的宝贝展示页**保留整套筛选/排序/搜索**，且筛选内容与分类对应（拼图盒只显示待拼/已拼，菩提盒显示盘玩 4 态，其他盒只显示在库/已送人）；复用全局筛选状态（状态/颜色/隐藏送人/排序/搜索）
31. **手串分级系统 0-5 星（v55）**：把原来的「❤️/🤍 喜欢」改为 **0-5 星**（卡片/列表右上角点星直接设级；详情页完整 5 星选择器；展柜页也可改星）。**5 星的宝贝自动进入「喜欢/收藏展示柜」**（底部收藏 tab 与展柜海报只收录 5 星）；旧 fav=true 的数据自动迁移为 5 星、fav=false 为 0 星。`filtered()`/`sortItems()` 改为可传入基准列表（供盒子页复用）
32. **统计页优化（v56）**：「📊 收藏分布」改为**可折叠区**（默认折叠，点标题展开）；金额统计**统一保留 1 位小数**（`fmtMoney`，整数不带小数）；金额统计**过滤 ≥99999 的占位/异常价格**（`validPrice`，不污染累计/平均/最贵/成就）；「✨ 有趣发现」**每次进入随机挑 5 条**（洗牌取 5），并新增多条内容（最受宠爱 5 星宝贝、盘得最多、摆烂待盘、累计陪伴、花费占比等）
33. **有趣发现焕新（v57）**：**移除价格分布**（用户收藏多为 100 以下，价格分布无区分度）；**移除「累计陪伴总天数」**（时间不宜累积累加，缺科学意义）；有趣发现改为**成就式趣味文案**，新增「你在 X 年 X 月一口入了 N 件宝贝，壕无人性」「你在 X 年 X 月盘了 N 条串，手都冒烟了」「你把「XX」盘完花了 X 天，天道酬勤」「XX 盒子塞了 N 件快满了」「已 N 天没买新宝贝了」等，仍每次随机挑 5 条
34. **盘玩计划精选（v58）**：候选池改为**重点展示「待盘玩」+「放置时间>2 天」**的串（排除放置≤2 天且非待盘玩的）；展示数量按**档位 0/1/3/6/9 向下取**（满足 N 个则展示不超过 N 的最大档位，最多 9；满足 4 个→展示 3）；标题下方提示「还有 X 串」
35. **盘玩计划数量规则微调（v59）**：满足数量 **<3 时有几个展示几个**（1→1，2→2），≥3 按档位 3/6/9（最多 9）；候选为 0 时**仍显示盘玩计划卡片**，换成好玩文案（「没有需要盘的串，雨露均沾的无情铁手太棒了」等随机一条）
36. **星级健壮性（v59）**：评分交互可升可降可清零
37. **评分强制云端同步（v60）**：评分必须真实存入 Supabase（`star` 列），换设备同账号评分仍在；当云端缺 `star` 列（未执行 alter SQL）时**回滚**评分并明确提示「需执行 `alter table public.bracelets add column if not exists star int not null default 0;`」，不假装保存——确保评分以云端为准
38. **工艺增加「干抛」+ 养护知识增强（v61）**：珠子工艺新增「干抛」选项（录入/批量编辑/详情均支持）；养护小知识按**工艺**（干磨/水磨/干抛）返回差异化保养与盘玩节奏内容（有工艺时多一节「XX专属」）；新增**文玩名词解释**板块（挂瓷/包浆/汗沁/开片/玉化/阴皮/皮质/反碱/打底/醒串/油性等），每次打开随机抽 4 条，内容每次不同
39. **AI 小助手（v62）**：右下角浮动按钮「🤖」打开对话面板，接入 **DeepSeek**（`deepseek-v4-flash`，OpenAI 兼容，纯前端直连）；能读取收藏摘要（名称/品种/分类/价格/月份/状态/盘玩次数/星级等文本），可问「总结 9 月盘串记录」等；**不内置任何 API key**（防止开源泄露）——key 由用户在「设置 → AI 助手密钥」填写，只存本机 localStorage，不入开源仓库；未填 key 时提示去配置。DeepSeek 支持浏览器 CORS（已实测，随请求 Origin 回填）
40. **星级排序（v63）**：排序新增「⭐ 星级」按钮，默认降序（高星在前），可切换升/降序；首页与收藏盒子页的排序栏均可用
41. **AI 助手关闭修复（v64）**：修复 AI 对话框无法关闭/隐藏的问题——`.ai-panel` 的 `display:flex` 覆盖了 `hidden` 属性的 `display:none`，已加 `.ai-panel[hidden]{display:none !important}`，点 ✕ 或面板外即可关闭
42. **AI 助手图标换成真实猫猫（v65）**：AI 小助手浮动按钮与面板标题改用 `cat.png`（英短蓝白猫，用户提供的真实图片），圆形裁切展示，取代此前手绘 SVG
43. **AI 助手可点击 + 加文字（v66）**：修复点击猫猫图标无反应——将 `bindAI()` 提前到 `init()` 最前无条件执行（不再依赖登录态），确保任何状态下都能点开面板；浮动按钮改为白色圆角卡片，下方加一行「AI喵助手」文字，让人一眼知道用途
44. **AI 助手"一问三不知"修复（v67）**：DeepSeek V4 为思考模式，回复正文在 `message.content`，但 `max_tokens` 较小时预算被 `reasoning_content` 吃光导致正文为空（显示"没有返回内容"）。已把 `max_tokens` 800→2000 并增加**正文回退**（`content` 为空时用 `reasoning_content`），实测 V4 正常返回
45. **AI 助手只给结论（v68）**：用户反馈返回的是思考过程而非结论。已按 DeepSeek 官方在请求体加 **`thinking:{type:"disabled"}`** 关闭思考模式——实测 `reasoning_content` 长度=0、`content` 直接返回结论，模型保持 `deepseek-v4-flash`
46. **『创建时间』排序改为『放置时间』（v69）**：首页与收藏盒子页排序栏的「🆕 创建」按钮改为「⏱ 放置」；`sortItems` 中 `created` 档排序键从 `createdAt` 改为**距上次盘玩时长**（`now - lastPlayedAt`，与详情"已放置 X 天"同口径）；**默认降序 = 放置最长在前**，可点击切换升/降序；**无盘玩记录（`lastPlayedAt` 为空）的宝贝恒排最后**；内部键值仍为 `created`，**无需迁移旧 localStorage**；缓存 v69
47. **珠型（bead shape）选择 / 展示 / 筛选（v70）**：新增 `bead_shape` 字段（text），在 `js/app.js` 内以 `SHAPE_LIST` 定义 **15 种珠型**，**数组顺序 = 各处 chips 的展示顺序**：最常买的四种放最前且两两相邻 —— 圆珠 round / 苹果圆 apple / 正桶 barrel / 老型桶 oldtype，其后为 算盘珠 abacus / 飞碟珠 saucer / 灯笼珠 lantern / 瓜珠 melon / 鼓珠 drum / 雕刻 carved / 随形 freeform / 葫芦 gourd / 平安扣 peacebuckle / 无事牌 plaque / 其他 other；**手工选择、不做自动识别**。
    - **详情页**：标签行显示「📿 珠型」；基本信息新增「珠型」项，点「设置/修改」弹出 `promptSetShape()` 选择弹窗（含「清除珠型」）；保存失败会明确提示缺列
    - **编辑 / 新建表单**：新增 `#fShapeChips` chips（与主色 chips 同款式，含「未选」）
    - **列表 / 卡片页**：新增蓝色珠型标签（`📿 xxx`，CSS 类 `.color-tag.shape-tag`），与主色标签并排（`.card-sub` 已加 `flex-wrap` 防挤压）
    - **筛选面板**（首页 + 收藏盒子页）：新增可多选珠型 chips，带实时计数与「✕ 清除珠型」（`selectShapes` Set）；搜索框也匹配珠型名
    - **需执行 `bead_shape` 的 alter SQL**（见第四节），否则保存会提示「⚠️ 未保存：缺少 bead_shape 字段」；缓存 v70
48. **批量编辑支持珠型（v71）**：多选（≤20 个）→「⚙ 批量编辑」面板新增「📿 批量设置珠型」区块（`#bShapeChips` chips + 「应用到所选宝贝」按钮，`data-bshape`）；选「未选」再应用 = **批量清空**所选宝贝的珠型（用 `bShapePicked` 标记区分"没选"与"选了未选"，避免误清空）；多选列表里每个宝贝也新增珠型标签，方便勾选时辨认。缓存 v71
49. **珠型词条改名与排序（v72）**：应需求把「桶珠」→**正桶**、「老型珠」→**老型桶**；并把买得最多的四种（圆珠 / 苹果圆 / 正桶 / 老型桶）**排到最前且两两相邻**。`v` 值（`barrel` / `oldtype`）保持不变、**旧数据无需迁移**，只改 `SHAPE_LIST` 的 label 与顺序（筛选 / 表单 / 批量编辑 / 弹窗 chips 的顺序全部随之变化）；缓存 v72
50. **AI 助手读时间错误修复（v73）**：用户反馈"今天盘了 10 串，AI 却说今天没盘"。根因：传给 AI 的摘要**从未告知今天日期**，AI 无法判断「今天」，且 `lastPlayedAt` 只写成"9/6"无参照。修复：摘要首行加**【当前日期】**；每条记录把上次盘玩换算成「**今天盘过**/昨天/N天前」；新增**【今日已盘】汇总**（直接列出今天盘过的串数与名称）；摘要同时纳入 **珠型**（`shapeLabel`）；system prompt 明确要求以【当前日期】为基准、依据【今日已盘】回答。真实 API 实测：AI 正确回答"你今天盘了 10 串"。**注：本版基于云端 v72 重做**（此前本地误基于旧 v68 提交，已对齐云端）；缓存 v73
51. **AI 助手多轮对话 + 清空（v74）**：`aiHistory` 保留最近 6 条（3 轮问答）随请求一起发送，可追问（如「那第 2 串呢？」不再失忆）；面板标题栏新增「🧹 清空对话」按钮（`clearAIChat()` 同时清 DOM 与历史）；快捷问题扩充到 5 个（新增「⏱ 哪些该盘」「💰 本月花费」）
52. **搜索支持多关键词（v74）**：搜索框按**空格分隔多关键词，全部命中才算匹配（AND）**，如「菩提 绿」「正桶 菩提」；同时支持把**价格区间当作其中一个词**（如「菩提 100-300」）；单关键词行为不变
53. **抽卡范围改为「放置 > 2 天」（v74）**：`Game.isDrawable()` 统一口径——菩提分类、非送人、状态为 待盘玩/盘玩中/已盘好，且**距上次盘玩 > 2 天**（从未盘过可抽）；不再有「已盘好随时可抽」的特例，避免短期内重复抽到同一串
54. **盘玩计划一键「今日已盘」（v74）**：每格照片右下角新增**绿色 ✓ 按钮**，点一下即记录今天盘过（与详情页「✅ 今日盘过」同一套逻辑，抽成 `markPlayedToday()` 复用：`lastPlayedAt=now`、状态→盘玩中、`play_count+1`）；带**完成动画**（格子弹一下 `planPop` + 绿色光环扩散 `planRing`、按钮放大变亮、文案变「今天盘过 ✓」），动画播完（900ms）自动重渲染，该串随即从计划中消失；点格子其他区域仍进详情。缓存 v74
55. **盘玩计划加串名 + ✓ 按钮灰色待办态（v75）**：照片下方新增**串名**（`.plan-name`，加粗深色、单行省略），解决"有些串太像看不出哪个是哪个"；✓ 打卡按钮改为**未打卡=灰色**（`rgba(110,110,110,.72)`）、**打卡后=绿色渐变**并放大，更符合"待办→完成"的直觉。缓存 v75
56. **盘玩也能升级 + 连续打卡（v76）**：
    - **经验不再只靠买**：`computeXp(items, playDays)` 新增两处只增不减的来源——**累计盘玩次数**（`playCount` 总和，里程碑 10/50/100/300/1000 次 → 60/200/500/1500/4000 XP）与**连续打卡**（里程碑 3/7/14/30/100 天 → 80/200/450/1200/4000 XP）
    - **连续打卡数据**：新增 `profiles.play_days`（jsonb 日期数组）；`markPlayedToday()` 打卡时把「今天」记入（幂等，重复点不重复记）；详情页「✅ 今日盘过」也复用同一逻辑
    - **断签不降级（关键设计）**：XP 用**历史最长连续天数** `bestStreak()`（只增不减），界面显示**当前连续** `currentStreak()`（激励用），所以断签只会让火苗消失、**不会掉经验/掉级**
    - **展示**：盘玩计划标题右侧显示「🔥 连续 N 天」（今天未打但仍在延续历史时显示灰色「最长 N 天」）
    - **需执行 `play_days` 的 alter SQL**（见第四节），否则打卡本机生效但云端不同步；缓存 v76
57. **连续打卡上首页 + 盘玩成就（v77）**：
    - **首页等级条下方新增「连续打卡条」**（`.streak-bar`）：已连续时显示橙色渐变「🔥 已连续盘串 N 天」（右侧显示最长天数或「保持住！」）；断签但历史 ≥2 天时显示灰色「最长连续 N 天 · 今天盘一串继续」；从未连续时显示「今天盘一串，开启连续打卡」。点击该条会平滑滚动到盘玩计划卡片
    - **新增成就组「🤲 盘玩之道」**（stats.js）：累计盘玩 10/50 次、连续打卡 3/7/30 天、以及两个 tier 称号——「盘玩大师→无情铁手→手都冒烟了」（累计次数）与「半月不辍→百日铁手→全年无休」（连续天数）；`getAchievements(items, playDays)` 与 `resolveTier(..., playDays)` 新增 playDays 参数供 check/getValue 使用。缓存 v77
58. **修复删除弹窗 + 左右滑删除 + 首次盘玩时间（v78）**：
    - **🐞 修复详情页「删除」点了没反应（变灰但没按钮）**：根因是代码里**两套弹窗机制混用**——`showBeadStatusPicker / promptSetLastPlayed / promptSetColor / promptSetShape / AI密钥` 用 `modal.style.display` 开关，而 `confirmModal / showTipsModal / 升级弹窗` 用 `modal.hidden`。**内联 `display:none` 残留后优先级高于 `hidden` 属性**，导致遮罩（变灰）出现但弹窗内容不可见。修法：全部统一到 `hidden` 机制，并在每次开关时清空内联 `style.display`（`modal.style.display = ""`）
    - **列表左滑删除**：列表视图每项包一层 `.swipe-row`，左滑露出「取消 / 删除」两个按钮（`.swipe-btn`）；只在**水平位移占优**时才拦截（`|dx|>|dy|`）避免与竖向滚动冲突；滑开后再点内容先收起不跳详情
    - **卡片长按删除**：卡片视图（网格无左滑空间）改为**长按 550ms** 弹出删除确认，桌面鼠标按住同样有效
    - **统一 `deleteItem(id)`**：详情页删除 / 左滑删除 / 长按删除共用同一确认+删除+刷新流程
    - **详情页新增「首次盘玩」与「盘玩周期」**：新增 `first_played_at` 字段（首次标记盘玩时写入），详情页显示「首次盘玩 X月X日（从开始盘至今 N 天）」；已盘好时额外显示「盘玩周期：从开始盘到盘好约 N 天 🌾」
    - **需执行 `first_played_at` 的 alter SQL**（见第四节）；缓存 v78
59. **历史首次盘玩时间自动回填（v79；⚠️ 规则已在 v81 修正，见第 61 条）**：对**今天之前就已经在盘**的老串（有 `playCount>0` 或 `lastPlayedAt`，但 `firstPlayedAt` 为空），登录后自动回填 `firstPlayedAt`；系统里完全没有盘玩记录时不回填。**v79 原规则用「全局最早盘玩记录」且未校验约束，已由 v81 改为锚定入库时间 + 强制约束**
60. **手动设置首次盘玩时间（v80）**：详情页「首次盘玩」一行新增**修改/设置**入口（`#editFirstPlayed` → `promptSetFirstPlayed()`）；弹窗为日期选择器，含「保存」「清除首次盘玩时间」「取消」；**未记录时该行也显示**（「未记录 [设置]」，不再只有有值才显示）；保存失败（缺 `first_played_at` 列）会明确提示需执行 alter SQL。缓存 v80
61. **修正首次盘玩回填 + 统一盘玩计划缩略图（v81）**：
    - **🐞 修正 v79 的回填错误**：v79 用「全局最早盘玩记录」回填，**没校验约束**，导致「猫爪」被填成 9/12（晚于其上次盘玩 9/11）、「9/14 入库的串」被填成 9/12（早于入库）。改为 `estimateFirstPlayed()`：**锚定该串自己的入库时间**（无入库时间退化为创建时间→最后盘玩时间），并强制满足两条硬约束——**不晚于 `lastPlayedAt`、不早于 `arrivedAt`**
    - **自动纠正历史错误值**：`backfillFirstPlayed()` 现在不只补空值，还会**纠正违反约束的既有值**（`firstPlayedAt > lastPlayedAt` 或 `< arrivedAt`）——所以「猫爪」「9/14 串」这类错误值下次登录会被自动改正；而**用户手动设置且不违反约束的值不会被改动**
    - **盘玩计划缩略图统一尺寸**：`.plan-photo img` 由 `object-fit:contain` 改为 **`cover`**——之前不同宽高比的照片在方格里长度不一导致"有大有小"，现在统一填满方格、网格整齐
    - 缓存 v81
62. **缩略图方格改用 padding-top 方案（v82）**：v81 只把 `object-fit` 改成 `cover`，但**根因是 `aspect-ratio` 在部分手机浏览器/内置 WebView 不生效**——容器高度会跟随图片自然高度，不同比例的图仍"有大有小"。改为 **`width:100%; padding-top:100%; height:0`** 的经典正方形方案（padding 百分比相对宽度计算），图片/占位符改 `position:absolute` 填满：`.plan-photo`（cover）与 `.draw-thumb`（保留 contain 不裁剪）同时加固，**不依赖 `aspect-ratio`，所有浏览器都严格等大**。缓存 v82
63. **正方形方案推广到全部缩略图（v83）**：把 v82 的 padding-top 方案继续覆盖 **首页卡片网格 `.card-thumb`** 与 **编辑页照片上传格 `.upload-cell`**（图片 `position:absolute` 填满、`object-fit:cover`，占位符同样绝对定位居中）。现在**全站所有图片方格**（卡片/上传格/盘玩计划/今日心选）都不依赖 `aspect-ratio`，任何比例的照片、任何浏览器渲染出来都严格等大。缓存 v83
64. **名字按字数截断（v84）**：新增 `clipName(s, max)` + `NAME_MAX = { plan: 5, card: 9, list: 14 }`——**盘玩计划格 5 字、首页卡片 9 字、列表 14 字**，超出显示 `…`；`Array.from` 按码点切分（emoji/组合符号不会被切坏）、连续空白折叠为 1 个空格、空名字回落「未命名」。**只影响显示，数据库里的原名字不动**；盘玩计划格的 `title` 仍带完整名字。作用范围：`gridHtml` 卡片、盘玩计划格、两处列表行、多选编辑卡片（详情页大标题保留完整名字）。实测（375px 手机宽、真实 CSS）：4 张不同比例图 `.plan-photo` 全为 119×119、格子全为 119×151、名字行全为 1 行 13px 无溢出。缓存 v84
65. **详情页可切换上一个/下一个（v85）**：详情页顶部新增 **`.detail-nav`** 条（`‹ 上一个` / `第 x / y 个` / `下一个 ›`），**`position:sticky` 吸在顶栏下方**（`top:calc(env(safe-area-inset-top) + 63px)`），翻到详情页多深都能点；首尾自动置灰禁用。翻页顺序 = **点进来那一页眼前看到的顺序**（`currentNavIds()` 在进详情前抓当前 DOM 里的 `[data-id]`，卡片/列表视图优先，跳过今日心选与盘玩计划；喜欢展柜按 5 星规则取）。另支持 **主图左右滑动切换**（左滑=下一个，右滑=上一个，横向位移 >60px 才触发，避免误触；滑动后 400ms 内不打开大图查看器）。直接开链接进详情（无来源页）时兜底用当前筛选排序列表。缓存 v85
66. **返回列表页回到原来那一屏（v85）**：以前从详情返回一律跳回**页面顶部**，翻几十条后很痛苦。现在 `router()` 在「列表页 → 详情」这一步先记下 `_backMemo = { hash, y }`（来源页 + `window.scrollY`）和浏览顺序，返回时渲染完列表后用 `requestAnimationFrame` 还原滚动位置；同时 **`goBack()` 从详情返回「点进来的那个页面」**（首页 / 分类盒子页 / 喜欢展柜，不再是永远回首页）。配套 `history.scrollRestoration = "manual"`（避免浏览器自作主张和我们的还原打架）。**回归验证**：搭了「假 Supabase + 真 app.js」的端到端无头测试（临时 harness，测完即删），**29 项断言全绿**——40 条数据滚到 1200 → 进详情（21/40）→ 下一个（22/40）→ 上一个（21/40）→ 返回后 `scrollY` 仍为 1200、导航条消失；盒子页进详情返回回到 `#/box/菩提` 且 `scrollY` 恢复 900；首尾禁用；导航条吸顶 `top=63`。缓存 v85
67. **🚨 修复 v83 引入的「新增/编辑表单被照片块盖住」回归（v86）**：用户报「新增宝贝界面没有写名字的地方了，开头就是传图片，单个录入和批量录入都有问题」。**根因**：v83 为了做正方形把 `.upload-add`（「＋ 照片」）写成了 `position:absolute; top:0; left:0; width:100%; height:100%`，**但这个元素自己就是格子**（`<label class="upload-cell upload-add">`）——它于是脱离格子、以**初始包含块**（整页）为参照铺满宽高，加上 `.upload-cell` 的白底，直接把表单顶部的「串的名字」等字段整块盖掉（两个上传区 = 两块覆盖层）。**修法**：`.upload-add` 回到普通流（继续用 `.upload-cell` 的 `padding-top` 撑正方形），新增 **`.upload-add-inner`** 绝对定位在格子内居中显示「＋/照片」；`renderUploadGrid()` 与批量草稿 `renderPhotoGrid()` 两处 label 同步加内层 span；顺手补上漏掉的 `.upload-cell .placeholder` 绝对定位（无图时占位符原本会被 `overflow:hidden` 裁掉）。**通用教训**：给「padding 撑高」的格子元素加绝对定位前，先确认这个元素是**容器**还是**容器本身**；已复查其余同类（`.card-thumb`/`.draw-thumb`/`.plan-photo` 的子元素 `.badge`/`.card-stars`/`.draw-status`/`.plan-done-btn`/`.upload-del` 全是绝对定位 ✓）。**验证升级到 31 项端到端断言全绿**，并新增两类通用探针：① 关键字段「中心点 `elementFromPoint` 命中自身」= 没被遮挡（覆盖 `#fName/#fCategory/#fSpecies/#fPrice/#fDate/#fShop/#fNote/#btnSave` 与批量页 `#dName/#dCategory/#dSpecies/#dShop`）；② 「页面里不存在既铺满视口 >85% 又是 absolute/fixed 的游离元素」。真实渲染实测：名字字段 `top=100`、照片区 `top=1149`（顺序正确），「＋照片」格子 154×155（=1/3 栏宽的正方形）。缓存 v86
68. **📶 弱网韧性：白天流量下「网络错误、登录不上」的根治（v87）**：用户报「白天不开 WiFi 时网络很不稳定，收藏馆一直显示网络错误、登录不上」。**根因不是网站坏了，而是代码在弱网下太脆**：① 浏览器默认 fetch 没有超时，运营商丢包时请求会挂很久（看着像卡死）；② 任何一次握手失败都没有重试，直接报错；③ 云端读不到时 `allItems=[]`，界面显示「还没有收藏任何宝贝」——**看起来像数据丢了**；④ 没有任何本地缓存，没网就完全进不去。**修法（4 层）**：
    - **韧性 fetch（`js/db.js` 新增 `resilientFetch`，用 `createClient(..., { global: { fetch } })` 注入）**：统一加超时中止（登录 18s / 普通 15s / 传图 60s）+ 指数退避自动重试（登录与普通请求 3 次、Storage 传文件 2 次，退避 0.5s→1.5s→3s 带抖动）+ 5xx/429 也重试；**业务错误（400/401）绝不重试**，避免把密码错误误判成网络问题。同时把网络状态广播给界面（`DB.onNetChange / DB.getNet`）。
    - **本地缓存（`localStorage["ww_cache_<uid>"]`）**：每次成功拉取后缓存宝贝列表 + 打卡日期 + 显示名（照片只留 URL，剥掉 Blob `data`，否则恢复时会 `createObjectURL` 报错）。云端读不到就**用缓存顶住**，绝不再出现「空收藏馆」吓人。
    - **网络提示条（`.net-bar`）**：黄色「📶 网络不稳定，正在自动重试…」/ 灰色「📴 云端连不上，正在看本地缓存（时间）· 每 20 秒自动重试 [重试]」，固定在底部导航上方、避开右下角 AI 猫猫（`right:100px`），不遮顶栏。**自动恢复**：`online` 事件、切回前台（`visibilitychange`）、以及每 20 秒自动重试一次，网一好就自动同步（`syncNow()`）。
    - **登录页**：网络类错误自动再试 3 轮并显示「网络不稳定，正在重试（第 x/3 次）…」，不再一句「网络错误」；区分「手机当前没有网络」和「网络不稳定」。
    - 另外：保存成功后若"重新拉列表"恰好失败，**不能再报「保存失败」**（会导致用户重复保存出两条），改为用 `DB.put` 返回的数据就地更新内存并提示「已保存到云端（列表暂时没刷新）」；离线且无缓存时首页显示专用文案「连不上云端，本地也还没有缓存…你的数据都在云端，不会丢」，且**不再把人强制跳到设置用户名页**（这个跳转原本会因为读不到 profile 而误触发）。
    - **验证**：① `resilientFetch` 11 项单元测试（失败 2 次后成功 / 三次全败 / 503 重试 / 400 不重试 / 挂住被超时中止 / Storage 只重 2 次 / 状态广播去重）全绿；② 「真 app.js + 假 Supabase + 可控故障 window.fetch」的弱网端到端：**正常网络 4/4、抖动网络 4/4（前 2 次失败后自动成功）、断网+有缓存 9/9（含"不点按钮 20 秒自动重试"）、断网+无缓存 3/3**；③ 顺带回归「详情翻页 + 返回恢复滚动位置」通过。**顺带修的隐患**：返回列表恢复滚动位置原来只靠 `requestAnimationFrame`，个别浏览器/慢设备会把位置清回顶部——改成「同步立即恢复 + rAF + 120ms/420ms 兜底各一次（仅在仍为 0 时补）」。
    - **关于「要不要换国内免费存储」**：结论是**先别迁**（v87 已针对弱网兜底，先用几天流量验证）。真要迁再评估：腾讯云开发 CloudBase（国内节点，免费环境 3,000 资源点/月 ≈ ¥3、1 个环境、**每 6 个月需手动续期**，有 Web SDK/数据库/存储/认证，但认证以微信/手机号/自定义登录为主，邮箱密码要另做）；Bmob（老牌国内后端云，REST 接口）；LeanCloud 国内版**需要已备案域名**（github.io 无法备案）→ 不适用，国际版仍是海外节点。迁移成本可控的原因：**全站数据访问都走 `window.DB` 接口**，换后端只需重写 `js/db.js`（约 450 行）+ 认证 + 图片存储 + 一次性导数据，4600+ 行的界面代码不用动。缓存 v87
69. **状态「已盘好」改名「已挂瓷」+ 挂瓷串 5 天保养提醒（v88）**：用户要求「把状态里的已盘完改成已挂瓷」——注意**界面上的旧文案其实是「已盘好」**（用户口头叫"已盘完"），所以把全部 `已盘好` 统一替换为 **`已挂瓷`**（`app.js` 11 处：`BEAD_STATUS` 标签、`beadStatusText`、筛选 chip、今日心选副标题、批量草稿下拉、分享文案等；`stats.js` 2 处：收藏分布标签 + 天道酬勤文案）。`play_status` 的**数据库值不变**（仍是 `done`），只改显示，历史数据无需迁移。
    - **新增「挂瓷串超过 5 天没盘才提醒」**：`game.js` 抽出 `idleLimitOf(item)` —— **已挂瓷(done) = 5 天**、其他(待盘玩/盘玩中) 仍是 **2 天**；`playPlan()`（盘玩计划）与 `isDrawable()`（今日心选抽卡）**同步改用同一口径**，避免两处提醒不一致。已挂瓷串在计划里的天数文案改成 **「挂瓷 N 天没盘」**（原来是"已 N 天没盘"），一眼能看出这是保养提醒而不是没盘完。
    - 规则边界：**待盘玩(ready) 永远提醒**（不看天数）；**未盘玩(unplayed) 永不提醒**（用户暂时不想盘）；正好 5 天/2 天**还不提醒**（要"超过"）；从未盘过的非 unplayed 串仍可直接提醒。
    - **验证**：① 用**真实 `game.js`**（vm 加载）跑 16 项单测全绿：挂瓷 4 天不提醒 / 6 天提醒 / 正好 5 天不提醒 / 盘玩中 3 天提醒 / 2 天不提醒 / 待盘玩一直提醒 / 未盘玩与已送人都不提醒 / 抽卡口径一致 / 排序仍按闲置天数；② 真 app.js 端到端 20 项全绿：全站再无「已盘好/已盘完」，筛选 chips 有「已挂瓷」，计划里挂瓷 6 天进、挂瓷 4 天不进，文案是「挂瓷 6 天没盘」，详情页标签、编辑页状态、统计页分布都是「已挂瓷」。缓存 v88
70. **🖐 新增「佩戴中」状态标签 + 佩戴中的串不参与盘玩（v89）**：用户要求「增加一个佩戴的标签，标注佩戴的串不参与盘玩的相关标签和分类筛选」。
    - **实现方式（重要）**：把「佩戴中」做成 **`play_status` 的第 5 个值 `wearing`**，而不是新开一个布尔字段 —— 这样**复用现有列、不需要用户再执行任何 SQL**，而且天然做到"互斥"：一个串要么在盘玩流程里，要么在佩戴中。`BEAD_STATUS` 加 `{ v: "wearing", label: "佩戴中" }`（详情页状态选择器、编辑页状态按钮、卡片徽章、批量草稿下拉**全部自动跟着出现**，因为都从这一个数组渲染）。
    - **不参与盘玩的具体范围**（都是用 `PLAY_FLOW_STATUS = ["ready","playing","done"]` 白名单天然实现）：
      1. **不进盘玩计划**（`Game.playPlan` 的状态白名单没有 wearing）
      2. **不进今日心选抽卡**（`Game.isDrawable` 同上，副标题仍是"从待盘玩/盘玩中/已挂瓷里抽"）
      3. **不计入盘玩 4 态筛选 chip**（未盘玩/待盘玩/盘玩中/已挂瓷 的计数与匹配都不含它），而是**单独一个「佩戴中」chip**，既不被盘玩筛选命中、又能单独筛出来看
      4. **不算「盘玩进行时」任务**（`dailyTasks` 里的 `playing > 0` 判断）
      5. **详情页不显示"盘玩时长/已放置 N 天/盘玩周期"**（佩戴中的串天天在身上，显示"已放置 30 天"会误导），改为一行说明 **「🖐 正在佩戴 · 不参与盘玩计划与今日心选（挂着戴就是一直在盘它）」** + 保留历史「累计盘玩次数」
      6. 统计页「收藏分布」里 **单独一项「佩戴中」**（青色 #00838f），不混进盘玩态
    - **配色**：佩戴中用**青色** —— 徽章 `[data-bead="wearing"] { background:#00838f }`、标签 `.tag.sp-wearing`（#e0f7fa/#00838f），和「在库/已挂瓷」的绿、「盘玩中」的橙、「待盘玩」的金区分开。
    - **验证**：① 真实 `game.js` 单测 **12/12**：佩戴中放置 30 天/从未盘过都不进计划、不与"待盘玩"混排、抽卡结果里绝无佩戴中、只有佩戴中时「盘玩进行时」不算完成、挂瓷 6 天+盘玩中 3 天+待盘玩仍正常进计划（回归）；② 真 app.js 端到端 **17/17**：卡片徽章「佩戴中」×2 且颜色是 `rgb(0,131,143)`、筛选面板有「佩戴中2」而盘玩 4 态计数为 0/1/1/1（不含佩戴的）、筛「盘玩中」结果里没有佩戴串、筛「佩戴中」只剩那 2 条、盘玩计划不含佩戴串、详情页有佩戴说明且不再出现"已放置"、编辑页状态按钮含「佩戴中」、统计页含「佩戴中」。缓存 v89
71. **📋 排序新增「分组压底」：佩戴中的串压到列表最下端，未盘玩的排在它上面（v90）**：用户要求「把佩戴中的串移到列表的最下端，未盘玩的串后面，修改一下排序逻辑」。
    - **实现**：`sortItems()` 重构成「两级排序」——原来每个 `sortMode` 分支各自调 `arr.sort(...)`，现在先算出该模式的比较函数 `cmp`，最后统一 `arr.sort((a,b) => pinRank(a)-pinRank(b) || cmp(a,b))`。
      ```js
      function pinRank(it) {            // 0 = 正常，1 = 未盘玩，2 = 佩戴中
        if (it.playStatus === "wearing") return 2;
        if (it.playStatus === "unplayed") return 1;
        if (!it.playStatus && isBeadCat(it.category || "")) return 1;   // 兜底：菩提且状态为空＝未盘玩
        return 0;
      }
      ```
      → 列表顺序固定为 **① 正常串（按所选排序）② 未盘玩 ③ 佩戴中（最下）**；**组内仍按所选排序方式排**（价格/星级/盘玩次数/颜色/入库/放置都照旧），**切换升/降序也不会改变这三段的位置**（和既有的"未记价在价格排序时永远排最后"是同一套思路，见 224 行用户偏好）。
    - **覆盖范围**：首页（卡片/列表视图）与**分类盒子页**共用 `sortItems`，所以两处自动一致；**详情页的「上一个/下一个」翻页顺序**取的是列表 DOM 顺序，因此也跟着一致（端到端已验证 1/7 位置正确）。
    - ⚠️ **副作用（已告知用户）**：新增菩提串的默认状态是「未盘玩」，所以**刚加的串现在会出现在列表底部那一组的最前面**（未盘玩组的首位），而不是原来"入库时间最新 → 排最前"。若要改回，只需让 `pinRank` 不对 `unplayed` 返回 1（只把佩戴中压底），或把新串默认状态改成"待盘玩"。
    - **验证**：真 app.js 端到端 **14/14** 全绿：默认排序得到 `普通×3 > 未盘玩×2 > 佩戴中×2`；切「价格」后三段位置不变且各段内部按价格 desc（500>300>100 / 700>600）；再切升序后三段位置仍不变、段内方向反转；切回入库排序顺序恢复；详情页翻页位置 1/7 与列表一致；分类盒子页同样把佩戴中压在最后。缓存 v90
72. **🍡 新增「软糯程度」标签：软糯 / 微糯（v91）**：用户要求「增加一个在列表和详情页展示的标签，就是软糯程度，软糯，微糯」。**注意：这是手感的"糯"（包浆后的软糯感），和状态机的"挂瓷"是两回事，所以是一个独立字段**，不混进 `play_status`。
    - **数据**：新字段 `softness`（text，值 `soft`=软糯 / `slight`=微糯 / `''`=未标注）；`db.js` 的 `toDB/toFront` 加映射 + 加入 `OPTIONAL_FIELDS`（没建列时自动降级不崩）。
    - **展示位（4 处）**：① 首页卡片 `.card-sub`（在珠型标签后面）；② 列表视图 `.list-right`（珠型标签后）；③ **详情页标签行** `.detail-tags`；④ 多选/批量卡片。统一由 `softnessTagHtml(it)` 渲染成 **`🍡 软糯` / `🍡 微糯`**，没标注就不显示任何东西。
    - **颜色**：软糯=**玫红**（#fce4ec/#c2185b）、微糯=**淡紫**（#f3e5f5/#7b1fa2），和状态标签（灰/金/橙/绿/青）、在库绿、已送人红都区分得开。
    - **录入**：编辑页新增「软糯程度」chips（`未标注 / 🍡 软糯 / 🍡 微糯`，照珠型 chips 那套写），保存时从 `#fSoftChips .color-chip.active` 读 `data-soft`。
    - **顺带**：搜索框支持搜「软糯」「微糯」（`matchTerm` 里加了 `softnessLabel(i.softness)`）。
    - **验证**：真 app.js 端到端 **18/18** 全绿：卡片/列表/详情页都出标签且配色正确（实测 `rgb(194,24,91)` / `rgb(123,31,162)`）、未标注的不显示、编辑页 chips 三选项且默认选中「未标注」、**保存时提交的 payload 确实是 `{"softness":"soft"}`**、搜索「软糯」「微糯」各命中对应串。缓存 v91
73. **🏷 品种（类型）选项调整：去掉「星月菩提」、新增「库克」（v91）**：用户要求「类型的地方去掉星月菩提，增加库克」。改 `js/categories.js` 里菩提类的 `options`（顺序：菩提根 → **库克** → 金刚菩提 → …）。**字段仍是自由文本**，所以：① 已存在的「星月菩提」老数据完全不受影响（照常显示、照常能搜到）；② 想再手动输入"星月菩提"也仍然可以；③ 只是**快捷 chips 里不再提供**（用户可自定义）。
    - 顺手做的两件事：**批量录入的品种输入框 placeholder** 从「如：星月菩提 / HEYE」改成「如：库克 / HEYE」；**`js/tips.js` 补了一份「库克」的养护知识**（care/taboo/play/trivia 各 3 条：油性足上色快容易盘花、忌上油忌泡水忌暴晒、棉手套打底+盘放结合+孔道两侧都要盘到），否则选了库克在「📖 养护小知识」里只会命中兜底内容。
    - **验证**：端到端断言「品种里不再有星月菩提 ✓ 有库克 ✓ 点库克会填进品种输入框 ✓」、点「养护小知识」标题显示**「针对「库克」的专属科普」**且正文含库克内容（不是兜底）✓。
74. **🎛 v92 四项调整：列表里点着改软糯 / 卡片一行 3 个 / 回到顶部按钮 / 排序按状态分段**
    - **① 软糯程度改成列表里的"开关"（不用进详情）**：`softnessTagHtml()` 从静态 `<span>` 改成 **`<button class="soft-toggle" data-soft-id="...">`**，**未标注时也显示一个淡淡的「🍡 未标」**（虚线边框、低对比），点一下循环切换 **未标 → 软糯 → 微糯 → 未标**，立刻 `DB.put` 存云端并 toast 提示（保存失败回滚）。
      - 关键实现：在 `#view` 上用 **捕获阶段**代理点击（`addEventListener("click", h, true)` + `stopPropagation`），**抢在卡片自己的"点进详情"监听之前**处理，所以点它不会跳详情；并且**只就地改按钮的 class/文案，不整页重渲染**（滚动位置不丢）。
      - 卡片视图 `.card-sub` 和列表视图 `.list-right` 都有；编辑页的 chips 保留（两处都能改）。
    - **② 卡片网格改成一行 3 个**：`.grid` 从 `repeat(2,1fr)` 改为 **`repeat(3,1fr)`**（宽屏 ≥560px 改 4 个），间距 12px→8px；配套把 `.card-body` 内边距、`.card-name` 字号（14→13px）、`.card-sub` 间距调小，让 116~150px 宽的窄卡片也能塞下「主色+珠型+软糯+天数」多个标签（会自动换行）。缩略图更小 → **一屏能看更多**。
    - **③ 「回到顶部」按钮**：`initToTop()` 动态创建 `.to-top`（右下角圆形 ↑），**滚动超过 420px 才出现**（`window.scrollY` + `scroll` 监听切换 `.show`），点击平滑滚回顶部，并**带 600ms 兜底**（不支持平滑滚动/动画被打断时直接 `scrollTo(0,0)`）。位置 `right:14px; bottom:152px` —— 正好在右下角 AI 猫猫按钮上方，不遮挡。
    - **④ 排序改成「按状态分段」**：`pinRank()` 从 v90 的三档改成**五档**：**① 盘玩中 → ② 待盘玩 → ③ 已挂瓷 → ④ 未盘玩 → ⑤ 佩戴中（最下）**，解决"已挂瓷和盘玩中混在一起"；**每段内部仍按所选排序方式**（放置天数/价格/入库/星级/颜色…），切换升降序不改变分段位置。拼图按同理映射（待拼→②、已拼→③）；水晶/玉石/周边等无盘玩状态的分类与①同档。
      - ⚠️ 用户没提到的「待盘玩」我放在②（盘玩中之后、已挂瓷之前）——如果他想挪，改 `pinRank` 一行即可。
    - **验证**：真 app.js 端到端 **28/28** 全绿：放置天数排序下顺序严格等于 `盘中(9天)→盘中(2天)→待盘(5天)→待盘(1天)→挂瓷(8天)→挂瓷(3天)→未盘(7天)→未盘(4天)→佩戴(10天)→佩戴(6天)`；切价格/入库排序分段位置不变；第一行恰好 3 张卡片且卡宽=(网格宽-16)/3、缩略图仍正方形；每张卡片和每个列表行都有软糯开关（10/10），点击循环三态且**不跳详情**、payload 为 `{"softness":"soft"}`；回到顶部按钮未滚动时隐藏、滚动后出现、不遮 AI 猫猫、点击回到 y=0 后自动隐藏、只滚 200px 不出现（阈值 420）。缓存 v92
75. **🎯 文玩专注模式：产品垂直化（v93）**：用户要求「做成养成系统后，关闭除了文玩之类的全部收藏类型，去掉分类这个界面（暂时隐藏，不要删），做成垂直的文玩产品」。
    - **只保留「文玩/珠串」三分类**：`const WENWAN_CATS = ["菩提","水晶","玉石"]`（写在 `app.js` 顶部附近，想加减一行即可）；`isWenwanCat()` / `focusVisible(list)` / `hiddenByFocusCount()` / `wenwanCategories()` 四个小工具支撑全局。
    - **隐藏了哪些东西（都只是隐藏，DOM/数据都还在）**：
      1. **底部导航的「分类」tab**：`applyFocusChrome()` 把 `.tab-item[data-tab="cat"]` 设 `display:none`（关掉开关立刻回来）
      2. **路由 `#/cat`**：`router()` 里直接 `location.hash = "#/"` 归位（地址也干净，不停在 #/cat）
      3. **非文玩分类的盒子页**（`#/box/拼图` 等）：`renderBoxPage()` 开头拦住，显示「暂时隐藏 · 数据一条都没删 · 去设置里关掉就回来」+ 一键跳设置
      4. **列表/筛选**：`filtered()` 的源数据改成 `focusVisible(...)` → 拼图/动漫周边/盲盒等**在列表里完全不出现**；筛选面板的分类 chips 只列 `wenwanCategories()`
      5. **新增/编辑页的分类下拉**：`categoryOptions()` 同样只给文玩三分类
      6. **统计页/成就页**：`statItems = focusVisible(allItems)` 传给 `Stats.computeStats / funFacts / getAchievements / distributions / renderCalendar` 和成就海报 → 数字与列表一致
    - **关键设计（不会掉级）**：**「等级/经验」仍按全量 `allItems` 算**（`Game.computeXp(allItems,...)`）——隐藏只是显示层的事，这样关掉/开启开关等级都一模一样，不会出现"开了专注模式掉级"。端到端实测：开/关都是 `Lv.3600 / 3600XP` ✓
    - **设置页新增开关** `#focusSwitch`（默认开）：标题「🎯 文玩专注模式 · 只显示文玩类（菩提/水晶/玉石）」，说明「数据一条都不会删，关掉开关立刻全部回来」，并动态显示**「当前已隐藏 N 件非文玩宝贝」**。开关持久化在 `localStorage["ww_focus"]`（默认 "1"=开）。
    - **验证**：真 app.js 端到端 **20/20** 全绿：默认开启时分类 tab 隐藏、列表只剩 4 件文玩（拼图/手办/盲盒全不显示）、`#/cat` 自动回首页、分类 chips 只有 全部/菩提/水晶/玉石、`#/box/拼图` 被拦且有"数据没删"提示、统计页「全部宝贝 4 / 在库 4」且分布里只有 绿/菩提/水晶/玉石/盘玩中/已挂瓷/常规在库、设置页显示「已隐藏 4 件非文玩宝贝」；**关掉开关后 8 件全部回来、分类页也能进、然后再开又隐藏**；开关前后等级经验完全一致。缓存 v93
76. **🍡 挂瓷精灵 + 导航「分类→精灵」（v94）**：用户要求「把分类那一格换成精灵」，并把之前聊的**养成系统**落成第一版。
    - **导航换位**：`index.html` 里把 `#tabCat`（分类）的**位置**换成新的 `#tabSpirit`（🍡 精灵，`data-tab="spirit"`），原分类 tab 元素**保留但 `style="display:none"`**（用户要求"暂时隐藏，不要删"）。路由加 `#/spirit`；`updateTabbar()` / tab 点击 / `goBack()` 都补了 spirit 分支。现在导航是 **首页 / 精灵 / 喜欢 / ＋ / 任务 / 成就 / 设置**（喜欢没被换，仍在原位）。
    - **新模块 `js/spirits.js`**（挂在 `window.Spirits`，`index.html` 在 app.js 之前引入）：
      - `promptFor(item)`：按 **主色 + 软糯程度** 拼英文 prompt，风格**锁死为用户要的 2D 日漫手绘**：`2D anime illustration, cel-shaded flat colors, bold outlines, hand-drawn, original cute creature mascot in the style of a pokemon, solid oval eyes + highlight, full body, fills the frame, white background, no 3D render, no realistic face, no human`。
      - 形象三通道：① 免密钥 **Pollinations**（`image.pollinations.ai/prompt/...&seed=`，seed 由 `hash(串id)+variant*7919` 决定 → **同一串永远同一张脸**，"换形象"才换 seed）；② 国内 API（**硅基流动 / 火山方舟 / 智谱 / 自定义 OpenAI 兼容**，配置存 `localStorage["ww_imgcfg"]`）；③ **本地程序化 SVG 小精灵**（用主色画身体、软糯决定圆润度和笑脸弧度 + 耳朵样式按 id hash 变化）——**断网/出图失败自动回退，永远有形象**。
      - 性格 / 小剧场 / 来信：**DeepSeek**（复用「设置 → AI 助手密钥」的 `ww_dskey`，`thinking:{type:"disabled"}`）；**没配 key 时全部走本地模板**（颜色+软糯决定称号/性格词/口头禅/信件内容），所以**零配置也能玩**。
    - **精灵页 `#/spirit`**：顶部**每日来信卡**（每天第一次进来自动投一封，当天只投一封，存 `lastLetterDay`）；下面「我的精灵（N）」列表 = 头像 + 名字 + 称号 + 口头禅 + 性格词 + 「N 天没盘」；点卡片开弹层：大形象 + 称号 + 口头禅 + 颜色/软糯/闲置信息 + **🔁 换形象 / 💬 它们聊天（抽 2-3 只写小剧场，气泡对话）/ 💌 给我写信**。
    - **只有「已挂瓷 + 在库 + 文玩类」的串会成精**（`spiritItems()`）；没挂瓷时显示空态「把一串盘到挂瓷，它就会成精」。
    - **设置页新增**「🍡 挂瓷精灵 · 🎨 精灵形象 · 绘图通道」入口：显示当前通道 + 已诞生精灵数；点开可切换 5 种通道（免密钥/硅基流动/火山方舟/智谱/自定义）并填 **API Key**（提示"只存本机、不入开源仓库"）、模型名、接口地址。**用户开好国内 API 后在这里填 key 即可切换，代码不用改。**
    - **踩坑修复**：`ensureSpiritData()` 第一版"每生成一只就 re-render 并提前 return"，但 `_spiritBusy` 在 re-render 之后才置 false，导致重渲染被自己拦住、只生成了第一只精灵就停住（性格/来信都卡住）。改成**一次把缺的性格全补完再统一重渲染**（重渲染期间 busy 仍为 true 防递归），最后再生成当天来信。
    - **验证**：① `spirits.js` 单元测试 **22/22**（prompt 含颜色/软糯/2D 风格且明确 no 3D；seed 稳定且换形象会变；本地 SVG 兜底随颜色变化；本地性格稳定且软糯/微糯/未标各不相同；无 key 时 persona/聊天/来信全走模板）；② 真 app.js 端到端 **30/30**：导航第 2 格是精灵且分类已隐藏、喜欢仍在、点精灵进页面、只有 3 只挂瓷串成精、每张图要么走绘图通道要么已自动回退本地（"通道,回退本地,通道"）、无 key 也有性格且标签渲染、**当天自动收到一封信且只投一封**、弹层三大按钮（换形象换 seed / 聊天 5 条气泡 / 写信带落款）全部可用、设置里显示"当前：免密钥"且有 4 家通道可选可填 key。缓存 v94
77. **🎨 风格预设 + 通道扩充（v95）**：用户发来一张**扁平 2D 贴纸风**参考图（粗描边、几乎无渐变/阴影、马卡龙配色、Q 版比例），说之前那些"太丑"，并考虑注册国内绘图。**实测排查结论（重要）**：
    - **免费通道退化了**：`GET https://image.pollinations.ai/models` 现在只返回 **`["sana"]`** —— 传 `model=flux` / `turbo` / `gptimage` 返回的**字节数完全相同**（16330），说明 model 参数被忽略，全部由 sana 出图；`model=kontext` 直接 500。**sana 是小模型，跟随风格指令的能力很弱**：即使 prompt 里写满 `flat 2D illustration, bold dark outlines, flat colors, no shading, no gradient, sticker art`，它依然出"柔光半写实/3D 球体"。
    - **所以"丑"不是 prompt 的问题，是模型能力问题** → 结论：要那种扁平贴纸风**必须换模型**（Kolors / Seedream / FLUX / CogView / Qwen-Image 这类），用户的判断是对的。
    - **四个国内端点实测都通**（`api-inference.modelscope.cn` 200、`api.siliconflow.cn` 404-on-GET 但可达、`open.bigmodel.cn` 401、`ark.cn-beijing.volces.com` 401 —— 401/404 都是"可达但需要 key/正确方法"）。
    - **新增 4 个风格预设** `STYLE_PRESETS`（存 `imgcfg.style`，**默认 `flat`**）：`flat`扁平贴纸风（照着用户参考图写的：`flat 2D illustration, clean bold dark outlines, flat colors with almost no shading or gradient, pastel palette, sticker art, minimal geometric shapes, no shading, no gradient, no 3D render, no realistic face, no human`）、`creature`宝可梦式生物、`chibi`Q版拟人娃娃、`ink`国风水墨。`promptFor(item, styleKey)` / `pollinationsUrl(item, variant, styleKey)` 都吃风格参数（不传则取当前配置）；颜色与软糯描述依然拼在风格之前。
    - **通道从 5 个扩到 6 个**：新增 **魔搭 ModelScope**（`https://api-inference.modelscope.cn/v1/images/generations`，国内、送免费额度、OpenAI 兼容），并给每个通道标注了推荐度（如"硅基流动（注册送额度，推荐）"、"免密钥 · Pollinations（只有 sana 小模型，风格不稳）"）。
    - **设置弹层新增「形象风格」一行**（4 个 chips）；保存时**清空所有精灵的形象缓存**（`imgUrl="" / variant=0`），下次进精灵页按新通道/新风格重新出图。
    - **验证**：① `spirits.js` 单元测试 **10/10**（预设≥4 且含 flat、默认 flat、扁平预设含 flat/粗描边/no shading/no gradient 且仍排除 3D 真人、所有预设都带颜色+软糯、文案互不相同、通道含魔搭等 5 家、默认配置带 style、URL 跟随风格变化）；② 端到端 **9/9**（弹层里 6 个通道 + 4 个风格 chips、默认选中扁平、切成水墨保存后 `cfg.style==="ink"` 且出图 URL 带上水墨文案、切回扁平成功、精灵页不受影响）。缓存 v95
78. **💰 国内绘图 API 选型调研 + 通道补到 7 家（v96）**：用户问"哪家便宜效果还行"。调研结论（价格随时会变，以官方为准）：
    | 服务 | 参考单价 | 免费额度 | 能否纯前端直连 |
    |---|---|---|---|
    | **智谱 CogView-4** | **~¥0.06/张（最便宜之一）** | 首次送体验 | ✅ OpenAI 兼容 |
    | 腾讯混元轻量版 | ¥0.066~0.099/张 | 50 次 | ❌ **TC3-HMAC-SHA256 签名接口，浏览器直连会被签名/CORS 挡住** |
    | 阿里百炼 通义万相 wan2.6 | ~¥0.2/张 | **50 张（开通后 90 天）** | ❌ 实测预检 404 无 CORS 头（见第 79 条） |
    | 火山方舟 即梦/Seedream | 订阅制或按张 | 每日/新模型免费额度 | ✅ 类 OpenAI |
    | 魔搭 ModelScope | 送免费额度 | 有 | ✅ OpenAI 兼容 |
    | 百度文心一格 Pro | ~¥0.5/张 | 无 | 一般 |
    - **用量测算**：本 App 出图量极小 —— 挂瓷串数 × 尝试次数 ≈ 几十到 100+ 张；按 ¥0.06/张算 **100 张≈6 元**，所以"便宜"不是关键，**有免费额度 + 能直连 + 风格够用**才是。
    - 代码改动：**新增「阿里百炼 通义万相」通道**；**智谱默认模型从 `cogview-3-flash` 改成 `cogview-4`**（更便宜且中文强）；各通道 label 直接标上价格与免费额度提示。
    - **给用户的推荐**：想最省 → 智谱 CogView-4；想省心且有免费额度 → 硅基流动；**已有火山方舟免费额度 → 直接用它**（见第 79 条，已打通）；不推荐腾讯混元（签名）。缓存 v96
79. **🔌 打通「API 通道真正出图」+ CORS 实测（v97）**：用户说他手上有**火山方舟的免费 token**，问能不能用。查证两件事：
    - **CORS 实测（纯前端架构的决定性前提）**：`OPTIONS` 预检带 `Origin: https://beibei1014.github.io`：
      | 服务 | 预检 | 允许来源 |
      |---|---|---|
      | **火山方舟 Ark** | 200 | **回显 beibei1014.github.io** ✅ |
      | 智谱 BigModel | 200 | 回显 origin ✅ |
      | 硅基流动 | 204 | `*` ✅ |
      | 魔搭 ModelScope | 204 | `*` ✅ |
      | DeepSeek（现用文字） | 200 | 回显 origin ✅ |
      | **阿里百炼 compatible-mode** | **404 且无 CORS 头** ❌ | 纯前端调不了 → 标签降级为「浏览器直连受限，不推荐」 |
    - **补上缺失的关键链路**：v94 只实现了"免密钥通道把 URL 交给 `<img>`"，**API 通道的 POST 出图根本没写**（用户填了 key 也只会看到本地 SVG）。本次新增 `Spirits.generateImage(item, variant, styleKey)`：`POST {endpoint}` 带 `Authorization: Bearer {key}`，body `{model, prompt, n:1, size:"1024x1024"}`，兼容 `data[0].b64_json` 与 `data[0].url` 两种返回；非 2xx 时把服务端 `error.message` 抛出来（方便用户截图排查）。
    - **app.js 侧**：`ensureSpiritImages(list)` 在精灵页渲染后**逐个补图**（`_imgBusy` 防并发；`imgAt` 20 小时内视为新鲜、不重复出图 —— 因为**方舟返回的图片 URL 只有 24 小时有效**）；b64 结果用 `shrinkToDataUri()` 经 canvas 压成 **384px JPEG data URI 长期存本地**（不受链接过期影响）；「🔁 换形象」在 API 通道下**重新 POST 一次**（免密钥通道仍是换 seed 出 URL）；出图失败**不白屏**（退回本地 SVG）并把原因写进 `rec._imgErr` 供排查。
    - **验证**：用**模拟火山方舟接口**端到端 **17/17**：b64/url/报错三种返回都能解析、请求带上 Bearer key 与模型名、prompt 用的是扁平预设、进精灵页自动出图并缓存（每串恰好 1 次调用）、缓存是 data URI、卡片显示 AI 图、换形象重新出图 1 次且 variant 递增、失败时退回本地形象且记录原因、免密钥通道完全不发 POST。
    - **⚠️ 事故记录**：本次为了改版本号用了 PowerShell `(Get-Content -Raw) -replace ... | Set-Content`，**把 `DEVELOPMENT.md` 的中文写成了乱码**（正是本文档第 175 行警告过的坑，我自己踩了）；已用 `git checkout 5109465 -- DEVELOPMENT.md` 恢复干净版本并重做本条。**结论：这些文件一律只用 `edit`/`write` 工具改，绝不用 PowerShell 读写。**（`sw.js` 当时用 `Get-Content` 看到"乱码"只是控制台编码问题，文件本身是好的。）缓存 v97
80. **🎌 默认风格改「日漫风」+ 打通文字通道（v98）**：用户明确说「用日漫风啊！」。
    - **风格预设重做**（`STYLE_PRESETS`，**默认 `anime`**）：`anime` 日漫风·Q版角色（`Japanese anime illustration, 2D anime style, cute chibi character, big sparkling anime eyes with white highlights, cel shading, flat anime coloring, clean bold line art, soft pastel color palette, small gentle smile, soft blush, chibi proportion, full body, plain solid pastel background, hand-drawn 2D anime art, no 3D render, no realistic face, no photo`）、`animepet` 日漫风·小生物（宝可梦式）、`flat` 扁平贴纸风、`ink` 国风水墨。
    - `promptFor()` 现在**按风格区分主体描述**：`anime` 用「a cute chibi anime character with {颜色} hair and {颜色} outfit」（颜色落在头发+衣服上，更贴参考图），其余用「a cute little mascot creature whose body color is {颜色}」；软糯程度继续影响体型与表情（软糯＝圆脸困困眼，微糯＝平静端正）。修掉了 `getImageCfg()` 里遗留的 `style:"flat"` 硬编码（默认风格常量已改但没同步，导致默认仍出扁平风）。
    - **新增「文字通道」** `TEXT_PROVIDERS` / `getTextCfg` / `setTextCfg` / `textInfo` / `textChat`：可选 **DeepSeek 官方**（默认，沿用 `ww_dskey`）/**火山方舟**/**自定义（OpenAI 兼容）**；方舟默认文本模型 `deepseek-v4-1-flash-260910`。`spirits.js` 内部 `aiChat` 与 app.js 的 `askAI`（收藏喵助手）**统一走 `textChat`**，所以助手的回答、精灵性格、小剧场、每日来信全部跟随该通道；小剧场页脚也会显示当前通道名。
    - **设置页**：新增「🤖 AI 文字模型（助手 + 精灵性格/来信）」入口（旧的「AI 助手密钥」入口**隐藏**、代码保留）；**绘图通道弹层也补上「换服务商自动填默认模型名/接口地址」**（原来切到方舟后模型名是空的）。
    - **两个「🔍 测试连接」按钮**（绘图弹层 + 文字弹层）：用弹层里**正在填**的配置真发一次请求，成功/失败原样显示服务端原因，并附排查提示（`ModelNotOpen` = 没在控制台点开通；`NotFound` = 模型名写错）；测完**自动还原已保存的配置**，不会误改。
    - **实测用户 key（火山方舟）**：`GET /api/v3/models` 可列目录（key 有效）✓；但**所有 Seedream 文生图模型与文本模型都返回 `ModelNotOpen`**（账号 2132466064 尚未开通任何模型）→ 用户只需去方舟控制台点「开通」。同时查到**当前真实可用的模型 ID**：`doubao-seedream-5-0-flash-260915`、`doubao-seedream-5-0-pro-260628`、`doubao-seedream-5-0-260128`、`doubao-seedream-4-0-20260415`（旧的 `3-0-t2i-250415` 已不存在 → 代码默认已更新为 `5-0-flash`）。
    - **验证**：`spirits.js` 单元 **9/9**（默认 anime、两种日漫预设、prompt 含 Japanese anime/cel shading/大眼睛、颜色落在头发衣服、排除 3D/真人/照片、软糯与微糯表述不同、4 种风格文案互不相同）；端到端 **25/25**（默认日漫风、prompt 正确、设置页两个入口、绘图弹层 4 风格且默认日漫、切方舟自动填新 Seedream ID、测试连接失败显示 ModelNotOpen 并给排查提示、成功显示"出图成功"、保存后精灵页真的 POST 到方舟并显示 AI 图、文字弹层切方舟自动填文本模型、文字测试成功/失败、`textChat` 真的打到方舟、小剧场页脚显示"火山方舟"）。缓存 v98
81. **📋 「拉取我账号里的可用模型」按钮（v99）**：用户发现方舟里 **Doubao-Seedream-5.0-lite** 有「剩 50 / 共 50 张」的安心体验额度，准备去开通；但**控制台显示的名字（5.0-lite）在 API 目录里没有同名 ID** —— 用他的 key 拉 `/api/v3/models`（135 个条目）后确认 Seedream 实际只有 7 个 ID：`doubao-seedream-3-0-t2i-250415`、`4-0-250828`、`4-5-251128`、`5-0-260128`、`4-0-20260415`、`5-0-pro-260628`、`5-0-flash-260915`。
    - 为了让用户开通后**不用猜模型名**，新增 `Spirits.listModels(kind, cfg)`：按配置的 endpoint 推导 `…/models` 并用 Bearer key 拉取，图片类筛 `seedream|kolors|flux|qwen-image|t2i|stable|image`（排除 i2v/t2v/3d/edit/seedance），文本类筛 `deepseek|glm|doubao-seed|qwen|gpt|…`（排除 seedream/seedance/3d/vision/embedding/image/tts/asr）。
    - **两个弹层各加一个「📋 拉取我账号里的可用模型」按钮**：拉到的 ID 渲染成 chips，点一下直接填进模型名输入框。
    - **踩坑修复**：URL 推导第一版写成 `endpoint.replace(/\/[^/]*$/, "/models")` → 把 `…/api/v3/images/generations` 推成了 `…/api/v3/**images**/models`（错的）。改成**先去掉结尾的 `/generations|/completions`，再去掉 `/images|/chat`，最后拼 `/models`**，并单测覆盖 4 种真实地址（方舟 images/chat、硅基流动、智谱）全部正确。
    - **验证**：单元 **6/6**（4 种 endpoint 的 models 地址推导 + 图片/文本清单过滤正确）。
    - **给用户的结论**：先开通 **Doubao-Seedream-5.0-lite**（50 张免费），然后在 App 里点「📋 拉取我账号里的可用模型」挑一个 ID 填上（推荐先试 `doubao-seedream-5-0-flash-260915`）；如果报 ModelNotOpen 说明还没开通、报 NotFound 说明 ID 不对。缓存 v99
82. **🔧 模型名自动纠正（v100）**：用户手机上实测报错：
```
出图失败：The model or endpoint doubao-seedream-5.0-lite does not exist or you do not have access to it.
```
    → **他把控制台显示名（`Doubao-Seedream-5.0-lite`）填进了「模型名」**，而 API 只认模型 ID（`doubao-seedream-5-0-flash-260915` 这种）或接入点 `ep-…`。这是接入方舟**最高频的坑**，所以在代码里直接兜住：
    - `normModelName(s)`：小写、`._空格`→`-`、去末尾日期、压缩连字符；`pickBestModel(typed, candidates)` 三级匹配：① 规整后全等 → ② 去日期后全等 → ③ **同族打分**（按词命中数，且 **`lite` 与 `flash` 视为同一档**，因为控制台叫 lite、API 叫 flash），得分不足则**返回空**（不乱改用户填的东西）。
    - `generateImage()` 遇到 `NotFound / does not exist / InvalidEndpointOrModel` 时：拉一次账号模型列表 → `pickBestModel` 挑一个 → **写回配置并自动重试一次**（`_autoFixed` 只做一次，避免死循环），成功后返回 `autoFixed` 字段，界面 toast「模型名不对，已自动改用：xxx」。之后所有出图直接用纠正后的 ID，不再浪费失败请求。
    - 「🔍 测试连接」的报错提示也升级：NotFound 时明确写出「控制台显示名不能直接用，要点『📋 拉取我账号里的可用模型』挑真实 ID，或填接入点 ep-…」。
    - **验证**：单元 **8/8**（显示名规整、lite→flash 同档匹配、精确 ID 不动、乱填不改、填显示名时自动纠正并出图成功、纠正写回配置、请求序列为「错名 → 正确 ID」、后续不再重复纠正）。
    - **⚠️ 事故复盘（网络层，与代码无关）**：用户这次错误的根因是**控制台 UI 显示名 ≠ API 模型 ID**，而方舟的 `/api/v3/models` 目录里也确实**没有 lite 这个 ID**（135 条里 Seedream 只有 7 个 ID，见第 81 条），所以只能靠「拉取真实列表 / 用接入点 ep- / 自动纠正」三者之一解决。缓存 v100
83. **🧭 定位「Failed to fetch + 模型名不对」两个真因（v101）**：用户发来方舟控制台「快速开始」页 + App 设置页截图，两个错误一目了然：
    1. **API Key 填的是密钥的「名称」**：控制台密钥下拉里显示的是 `api-key-20260927150936`（**名称**），真正的密钥是下面那串 `ark-b5e5e9c3-…`（要点 👁 显示 / 📋 复制）。用户把名称填进了 App。
    2. **模型名填的是控制台显示文字**：`doubao-seedream-5.0-lite 260128`（带点、带空格、带版本号），API 只认模型 ID。
    - **关键实测（决定了报错为什么难懂）**：用 `curl -i` 带 `Origin` 打 `GET /api/v3/models` ——
      · 用「密钥名称」当 Bearer → **HTTP 401 且响应里没有任何 CORS 头**；用真 key（已失效的那把）→ 同样 401 无 CORS 头。
      · **结论：方舟只在成功时才返回跨域头，401 时不给** → 浏览器把响应整个拦掉，前端只能看到 `Failed to fetch`，用户完全看不出是"key 不对"。这条已写进代码注释和错误提示。
    - 代码兜住三件事：
      · **`keyHint(key, provider)`**：识别「把密钥名称当 key」（`api-key-…` 开头）→ 明确提示"这是密钥的**名称**，请复制 ark- 开头的密钥本体"；方舟 key 不以 `ark-` 开头也给提示。保存/测试前先体检，不合格直接拦下并提示，不浪费一次请求。
      · **`listModels` / 测试连接 / 出图失败**：遇到 `Failed to fetch` 就翻译成"几乎都是 API Key 不对（方舟 key 错误时不返回跨域头）"。
      · **`pickBestModel` 用上版本号**：`normModelName` 原来会把末尾 6 位版本号剥掉，导致"最强线索"丢失 → 拆成 `normModelName`（**保留**版本号）+ `stripVer()`，并给"候选里含用户填的版本号"**+4 分**。于是用户那句 `doubao-seedream-5.0-lite 260128` 能**精确命中 `doubao-seedream-5-0-260128`**（就是控制台里那个已开通的 lite 模型的 API ID），而不是之前误判成 `…-5-0-flash-260915`。
    - **验证**：单元 **11/11**（保留版本号的规整、★版本号命中 260128、只写显示名时 lite→flash、标准 ID 原样返回、乱填不改、识破密钥名称当 key、正确 key 放行、识别 Failed to fetch、端到端从显示名自动纠正到 `doubao-seedream-5-0-260128` 并出图成功、纠正写回配置）。
    - **给用户的最终填法（已确认）**：API Key = **`ark-` 开头**那串完整密钥；模型名 = **`doubao-seedream-5-0-260128`**（或点「📋 拉取我账号里的可用模型」自动选）；接口地址 = **留空**（默认就是截图 cURL 里那个 `https://ark.cn-beijing.volces.com/api/v3/images/generations`）；风格 = 日漫风·Q版角色。缓存 v101
84. **🖼 立绘化 + 聊天带头像（v102）**：用户截图显示 key/模型都对上了，只剩 `size` 报错：**`image size must be at least 3686400 pixels`** —— Seedream 5.0 最小要 368 万像素，我原来写死的 `1024x1024`（104 万）太小。同时用户提了两条产品要求：**要立绘（不要只有个头）+ 聊天时带上各自头像**。
    - **尺寸**：新增 `DEFAULT_SIZE = "2K"`（2048² ≈ 419 万像素，稳过）与 `SIZE_PRESETS`（`2K` / `1728x2304` 竖版立绘 3:4 / `2048x2048` / `4K`），存 `imgcfg.size`；**设置弹层新增「出图尺寸」一行**（默认选中 2K）。`generateImage()` 遇到 `isSizeErr()`（"size not valid / at least N pixels"）会**自动把尺寸改成 2K 并重试一次**（写回配置 + toast 提示），和模型名自动纠正同一套思路。
    - **立绘 prompt**：`promptFor()` 的日漫角色分支改成**要全身立绘**：`full body character illustration, standing pose, whole body visible from head to toe, detailed outfit and shoes, character design sheet style, vertical composition, centered with comfortable margin around the character`（小生物分支同样加了 full body / 留边）。
    - **弹层看全身**：`.spirit-img.big` 由 `object-fit:cover`（会裁成头）改成 **`contain` + `max-height:46vh` + 自适应宽高**，立绘完整显示不裁切。
    - **聊天带头像**：小剧场每条都渲染成 `.spirit-row`（头像一个、气泡一个，**按说话人左右交替**）；头像是**该精灵自己的 AI 立绘**（没有则本地 SVG），并用「名字包含匹配」把 AI 台词里的 `who` 对应到具体精灵（AI 可能用简称）。CSS 新增 `.spirit-avatar`（38px 圆形带白边阴影）。
    - **验证**：单元 **9/9**（立绘 prompt 含全身/站姿/从头到脚/竖版/留边、小生物也全身、默认尺寸 2K、预设含 3:4、尺寸被拒→自动改 2K→成功、请求序列 `1024x1024→2K`、写回配置、后续直接用 2K）；端到端 **15/15**（自动改尺寸并出图、prompt 是全身立绘、每串只烧一次额度、弹层有 4 档尺寸且默认 2K、竖版尺寸 3,981,312 像素合规、保存成功、弹层立绘 `contain` 且高度 346px 不裁切、聊天 4 行各带头像、头像用上 AI 立绘、不同精灵头像不同、气泡仍有说话人名字）。
    - ⚠️ 教训：测试桩返回的 8×8 小图导致"头像都一样/立绘只有 9px"两条假失败 —— **验证图片相关功能时，桩必须返回尺寸/内容各异的真实图**（本次改成用 canvas 现画 512×768 渐变图，按 prompt 哈希取色）。缓存 v102
85. **🌟 精灵进阶系统：四形态 · 三次突破（v103）**：用户要求「刚挂瓷的精灵都是小小的，盘到一定程度可以突破/进阶，通过 2-3 次突破变成完成体（很帅/很酷/很美的日漫角色）」，并强调**生成形象时的文字描述要注意**（不同阶段要有不同描述）。
    - **四形态**（`STAGES`，写在 `spirits.js`）：**🥚 幼生期 → 🌱 成长期 → ⚡ 觉醒期 → 👑 完成体**，门槛 `need = [0, 30, 90, 180]`。
    - **成长值**：`growthOf(item, days) = 盘玩次数 × 3 + 陪伴天数 × 1`（陪伴天数由 app.js 用 `DB.daysWith` 传入）。所以「今日盘过」+1 次盘玩 = +3 成长值，**盘串能肉眼看到进度条涨**。
    - **★ 每个形态有各自的外形描述**（用户重点要求，写在 `STAGES[].look`，由 `promptFor(item, style, stage)` 拼进 prompt；颜色与性格描述一路贯穿，保证是"同一个角色在长大"）：
      · 幼生期 `a tiny newborn baby version, very small chubby body, big head and tiny limbs, minimal details, sleepy innocent eyes, just awakened, extremely cute and soft`
      · 成长期 `a small child version, slightly taller and more defined, lively bright eyes, simple but neat outfit, energetic pose`
      · 觉醒期 `a cool teenage version, confident dynamic pose, stylish detailed outfit, glowing aura and light particles, sharp determined eyes, cinematic lighting`
      · 完成体 `a stunning fully-realized adult anime character, magnificent ornate outfit, powerful graceful aura, beautiful and cool, masterpiece quality, epic composition`
    - **固定种子保连贯**：方舟出图带 `seed = seedOf(item.id, 0)`（`callImageApi` 里仅对 ark 端点加 `seed` 字段）→ **各形态看起来是同一个"人"在长大**，而不是换了个角色。
    - **突破流程**：卡片显示形态徽章 + 成长值进度条（`3 / 30 → 成长期`）；够条件时卡片加 `.can-break` 金边 + 「✨ 可突破」呼吸标签；弹层里出现「✨ 突破 →成长期」按钮（成长值不够则不显示，只显示还差多少）。点突破 → **按新形态 prompt 重新出图** → 记入进化史 → 弹出**突破演出**（新立绘 + 「突 破 成 功」+ 新旧形态名 + 鼓励文案）→ 卡片形态更新。
    - **进化史**（`rec.imgHistory`，最多 8 条）：弹层里横向展示各形态缩略图（当前形态高亮），能直观看到「幼生期 → 完成体」的成长过程。**首次出图也计入**，且突破时对"旧形态"做**去重**（避免同图记两次）。
    - **其他联动**：`spiritDesc()` 带上形态名（如"（觉醒期）"），AI 写的小剧场/来信会自然体现它的成长状态；`ensureSpiritImages` 出图时带上当前 `stage`。
    - **验证**：单元 **14/14**（四形态与门槛、四种形态 prompt 各含对应关键词（newborn/child/teenage/完成体"masterpiece"）、四段 prompt 互不相同、颜色贯穿、都保持全身立绘、成长值公式、刚挂瓷不能突破、30 分可突破、完成后不再提示、进度百分比与差值）；端到端 **20/20**（卡片形态徽章与进度、可突破标记、幼生期出图用 newborn 描述、带固定 seed、弹层突破按钮与成长值、首次出图记入进化史、突破只重新出图一次、**突破后 prompt 变成 child 描述**、突破演出弹窗、stage 写回 2、进化史为 `1,2`、卡片形态更新、成长值不够时无突破按钮但显示差值）。
    - **给用户的说明**：门槛是「成长值 = 盘玩×3 + 陪伴天数」，所以**多盘就长得快**（盘 10 次 + 陪 30 天 = 60 成长值，可直接从幼生期冲到成长期）。缓存 v103
86. **🆔 修「突破后变性/全员长一样」：外观锚点 + 图生图参考（v104）**：用户实测反馈「突破了之后性别都变了，一会儿男孩一会儿女孩，而且所有人都长得差不多」。
    - **根因**：v103 的 prompt 只写了颜色，**性别、发型、瞳色、配饰全由模型随机**，每次突破都重掷骰子；不同精灵之间也只有颜色区分 → 颜色相同的就长得一样。
    - **① 外观锚点（每只精灵的固定人设）**：新增 `HAIR_STYLES`(6) / `EYE_COLORS`(6) / `ACCESSORIES`(8) / `VIBES`(6)，由 `appearanceOf(item, seedN) = hash(串id + 外观种子)` 决定 → 得到 `{ gender, hair, eyes, acc, vibe }`。**四个形态的 prompt 都会先写死"这个人是谁"**（`appearancePrompt()`：`a boy/girl character with short spiky hair, amber eyes, wearing a silk scarf, calm and reliable personality`），再写"他现在多大"（形态描述）。
    - **② prompt 里加强约束**：新增 `CONSISTENCY` 常量，每次出图都拼上 —— `same character across all ages, keep exactly the same gender, same hair style and hair color, same eye color, same accessory and same overall design, only grow older, character evolution sheet, do not change gender, do not change identity`。
    - **③ 图生图参考（最可靠的一致性手段）**：突破和「换形象」时，把**上一形态那张图**作为 `image` 字段传给方舟 Seedream（`generateImage(..., { ref })`）；**若该模型/尺寸不支持 image，会自动去掉参考图重试一次**，并置 `_noRef = true` —— 关键是**下次出图第一发就不再带 image**（第一版只在重试里判断 `_noRef`，导致每次都先失败一次，已修）。
    - **④ 用户可控**：弹层新增「🔒 人设行」显示固定特征（如 `👦 男孩 · short spiky · amber eyes · a silk scarf`），旁边有「🎲 换外观设定」按钮（`rec.appearanceSeed++`）→ 只有用户主动点才会重掷人设，然后按新设定重画。
    - **验证**：单元 **13/13 + 6/6**：外观锚点字段齐全、同串同种子稳定、换种子会变、**不同串设定不同**、四形态 prompt 都带同一性别/发型/瞳色/配饰、都含"不许改性别"硬约束、形态差异仍在（newborn vs masterpiece）、突破时首次带参考图→被拒→自动去掉重试成功→**之后直接从文本锚点一次出图（不再浪费请求）**。
    - **说明**：文本锚点保证"不会变性、不会换人"是 100% 生效的（不依赖模型能力）；参考图是锦上添花（模型支持时相似度更高）。缓存 v104
87. **🖼 修「缩略图和进化/突破的图不一样 + 到底出了多少张图」：一张图走天下 + 出图计数（v105）**：用户实测反馈「缩略图和进化突破展示的图也不一样，到底生成了多少图？缩略图不是应该直接引用生成好的立绘吗？」
    - **根因（两个）**：① 每条出图路径各写各的存档代码，**同一个动作存两遍图**（突破时先把 `hist.push(旧图)` 再 `hist.push(新图)`，弹层演出用一张、卡片缩略图读另一张）；② **缩略图尺寸各异**（首出 384px、换形象 384px、手动重画 640px、突破 640px）→ 同一次出图在卡片和弹层里清晰度/裁切观感不同，看起来像"生成了好几张"。
    - **① 唯一存档入口 `saveSpiritImage(item, rec, res, stage)`**：**所有**出图路径（首次补图 / 手动重画 / 换形象 / 突破）都只走这一个函数 —— 统一压成 **512px JPEG data URI**（`SPIRIT_IMG_SIZE`）、写 `rec.imgUrl` / `rec.imgAt`、按形态追加 `rec.imgHistory`（最多 8 条，同图去重）、清零 `_imgErr`、并 `bumpGenCount(rec)`。
    - **② 缩略图 = 立绘本体，不再另存一张**：卡片缩略图直接引用 `rec.imgUrl`（同一张图），只是裁切方式不同（**v106 起改为裁头像，见第 88 条**）—— 弹层 `.spirit-img.big { object-fit:contain; max-height:46vh }` 看清全身。
    - **③ 不再重复出图（省额度）**：新增 `spiritImgStale(rec)` —— **data URI 是永久的，永不重出**；只有 http(s) 外链（方舟的图 24 小时过期）才在 20 小时后续期。旧的判断只看时间（`Date.now() - imgAt < 20h`），导致**每次进精灵页/每次重开都把本地存好的图重新生成一遍**，白烧用户 50 张免费额度。
    - **④ 换形象/重画不再"先清空再画"**：以前点「🔁 换形象」先把 `imgUrl=""`（旧图立刻消失、失败就白图），现在保留旧图、把它当参考图传给模型，出图成功后再原地换 `src`；失败也能继续看着旧图。
    - **⑤ 出图计数（帮用户盯额度）**：`rec.genCount`（这只精灵出了几张）+ `localStorage["ww_gen_total"]`（本机累计），弹层人设行下方显示「已为它出图 N 张 · 本机累计 N 张」，设置页绘图通道那一行也显示"本机累计出图 N 张"。
    - **⑥ 换通道/画风/尺寸前先问一句**：这些改动会让已有立绘全部作废重画，现在先弹 `confirmModal`「要重画 N 只精灵吗？…会消耗 N 次出图额度（每只 1 张）」，确认才清缓存；取消则把配置弹层还回来（不要白点一次）。另外**不再重置 `variant`**（换通道不该顺手换形象设定）。
    - **验证**：单元 + 端到端 **12/12**（首次进入 2 只精灵各出 1 张=2 次、本机累计=2、**★再次进入精灵页 0 次新出图**、缩略图是 data URI、**★缩略图 src 与存档立绘完全一致**、**★弹层立绘与缩略图同一张**、弹层显示「已为它出图 N 张」与本机累计、换形象只出 1 张且**带参考图**、换形象后弹层立绘原地更新、计数累加到 3）。
    - **注意（测试套路）**：假出图桩如果按 prompt 哈希取色，同 prompt 会画出**完全相同的图** → "换形象后图变了"这类断言会假失败。桩要带上请求序号（`makeB64(prompt + "#" + n)`），模拟"同 prompt 也会画出不同的图"。缓存 v105
88. **🔧 修「出图失败：size must be at least 3686400 pixels」+ 缩略图改裁「立绘的头像」（v106）**：用户在手机上看到红条报错 `The parameter size specified in the request is not valid: image size must be at least 3686400 pixels`。
    - **根因（是一个优先级 bug）**：`generateImage` 的兜底分支顺序反了 —— 第 ① 条是"参考图不被支持就去掉 image 重试"，它的判据 `/image|InvalidParameter|not support|参数/i` **会被尺寸报错误命中**（报错信息里有 "image size must be at least…"），于是：带着参考图的路径（**突破 / 换形象**）拿到尺寸报错 → 被当成"不支持参考图" → 去掉参考图、**拿同一个坏尺寸再试一次** → 还是同一个错 → 直接抛给用户。**"尺寸自动改 2K"的那条分支永远轮不到执行**，所以看着像"尺寸修复失效"。
    - **① 修法（最小改动）**：把尺寸判断提到第一位，并在参考图分支上加 `!isSizeErr(msg)` 兜底；**不再新增任何尺寸校验/自动升降档逻辑**（用户明确要求"别对尺寸做太多限制"）。坏尺寸（如老配置里的 `1024x1024`）被服务端拒一次后会自动改成 2K 并写回配置。
    - **② 缩略图改成裁「立绘的头像」**：新增 `<span class="spirit-thumb">` 方框（`overflow:hidden`）+ `spiritImgHtml(..., face)` / `spiritThumbHtml()`，图在框内 `object-fit:cover; object-position:center top; transform:scale(2); transform-origin:50% 0` → 画面正好落在立绘头部（约上部 1/3），弹层里的全身立绘不参与裁切。
    - **③ 兜底形象不能被裁**：本地程序化小精灵本身就是一张**方形脸贴图**，放大 2 倍会变成"一只眼睛" → 只有存在 AI 立绘时才加 `face` 类；图片加载失败切回兜底图时 `bindSpiritImgFallback` 会 `classList.remove("face")`。
    - **验证**：端到端 **12/12**（坏尺寸 `txt:1024x1024` → 自动 `txt:2K` 成功且配置写回 2K；**带参考图的换形象：`ref:1024x1024` → `ref:2K` 成功，全程没有任何一次"去掉参考图"的重试**；`.spirit-thumb` 有裁切框、缩略图带 `face` 类且与立绘同源、弹层立绘不带 `face`、`transform:matrix(2,0,0,2,0,0)` origin `48px 0px`；无 AI 图时不加 `face`）。另用「色块假立绘」（头 3~25%、上身 25~50%、腿 50~100%）截屏肉眼验收：缩略图里粉色头部占满方框、下方露一点上身 ✓
    - **测试桩经验**：坏尺寸必须在**每次**出图前重新塞回 `localStorage`（第一条用例通过后配置已被自动修正成 2K，后面的"带参考图+坏尺寸"用例就测不到目标分支了）。缓存 v106
89. **🚻 修「一张立绘画出两个人 + 女孩太多 + 头像预览不完整」（v107）**：用户实测截图反馈三点：① 一张图的立绘里有**两个角色**，还带 `NEWBORN` / `YOUNG BOY` 标题字；② 串的性别女孩太多；③ 卡片头像预览"没有完整"（有的只拍到头发、有的拍到一片空白）。
    - **① 元凶是 prompt 里的 "character evolution sheet"**：v104 为了"同一个角色长大"写了 `character evolution sheet`，"character design sheet style" 也是从 v102 一路带下来的 —— 模型看到 `sheet`（图鉴/设定集）就真的画成**多格角色设定图**：排版成 NEWBORN / YOUNG BOY 两格、还自己把形态名当标题写在图上。修法：`promptFor()` 里**彻底删掉 sheet / turnaround 这些词**（连 `no character sheet` 这种否定写法都不留，避免反向带偏），改成 `SINGLE` 常量：`solo, single character only, exactly one figure in the whole image, one person, plain simple background, no other characters, no clones, no panels, no collage, no multiple views, no background characters, no text, no letters, no words, no numbers, no title, no labels, no captions, no watermark, no signature, no logo`。
    - **② 性别：默认偏男 + 可手动指定**：`appearanceOf(item, seedN, gender)` —— 没指定时按 **2/3 男孩**（原来 `h % 2` 是五五开，用户反馈"女孩太多"）；详情页「🔒 人设行」新增「👦 换成男孩 / 👧 换成女孩」按钮（写 `rec.gender`，**只翻性别**，发型/瞳色/配饰都不动，重画 1 张）。所有出图路径（补图/换形象/换外观设定/突破/换性别）都会把 `rec.gender` 带进 `generateImage`。
    - **③ 头像取景改成"按图片内容自动找脑袋"**：固定比例裁切必然出错——出图构图每张都不同（角色有时很小居中、有时贴顶、有时还是多格图鉴）：`transform:scale(2)` 那版在用户手机上就出现"只拍到头发"和"拍到一片空白"。新做法 `analyzeFaceBox(url)`：用小画布① 用**四角颜色认背景色**（生成图基本纯色背景）② 扫出**人物外接框** ③ 取外接框**最上面 40%**（头 + 一点肩）④ 横向以"最上面 20% 那一段的**像素重心**"为中心（抬手/歪头的也不会偏），返回比例 `{l,t,w,ar}` 存进 `rec.face`；渲染时 `spiritThumbHtml()` 换算成 img 的 `width` + `left/top` 偏移放进 `.spirit-thumb`（`overflow:hidden` 的方框）里。**老图不用重出**：进精灵页时 `ensureSpiritFaces()` 补算一次并存起来；实在算不出来（纯色图等）就记 `{w:0}` 交给 CSS 固定比例兜底（`.spirit-img.face`），不会反复重算。
    - **④ 新增「🖌 全部重画」**：prompt 升级后老图都要重画，精灵页标题右侧一个按钮 → `confirmModal`「要重画全部 N 只精灵吗？…消耗 N 次出图额度」→ 清空 `imgUrl/imgAt/face/imgHistory` → 重新出图（`imgHistory` 也清掉，因为进化史里的旧图就是那些多格图鉴）。
    - **验证**：端到端 **20/20**：prompt 里已无 `sheet`、含 single/one person/no text/no panels、性别写进 prompt（boy/girl 各测一次）；300 次随机**男孩 193/300（64%）**、强制性别发型瞳色不变；**三种构图（小小一只居中 / 顶天立地贴顶 / Q版大头）用色块假立绘**（头 39~49% / 4~26% / 8~42%）自动取景后**脑袋全部完整入框**（取景 0.38-0.54 / 0.02-0.42 / 0.06-0.45），缩略图 img 比框大且偏移正确；「换性别」只出 1 张且 prompt 按新性别写、取景跟着重算；「全部重画」先弹确认、重画 3 只、prompt 都带"只画一个人"。另截屏肉眼验收：三种构图下缩略图都是"完整脑袋 + 一点肩" ✓ 缓存 v107
90. **🚻 修「男孩顶着双马尾」+ 修「尺寸报错反复弹」（v108）**：用户实测反馈「男孩子为什么会有这样的长头发，男孩子为什么会有双马尾，这个怎么又失败了」。
    - **① 发型按性别分池**：v104 的 `HAIR_STYLES` 是**男女共用一张表**，男孩也会抽到 `long straight` / `twin tails`。现在拆成 `BOY_HAIR`（6 种短发）与 `GIRL_HAIR`（长发/双马尾/齐肩/长卷/高马尾/双麻花），`appearanceOf` 按性别取池；`appearancePrompt` 还额外写死 `clearly male, boyish face, short masculine hair style … no long hair, no twin tails, no ponytail`（只写 "boy" 模型偶尔照样给长发，所以把**异性发型明确排除**）。
    - **② 人设行改中文**：新增 `HAIR_ZH / EYES_ZH / ACC_ZH / VIBE_ZH` 词典（prompt 仍用英文），`appearanceText` 输出如 `👦 男孩 · 清爽短发 · 深棕色眼睛 · 额头珠链（手串同款珠子）`，不用再对着英文猜。
    - **③ 尺寸：不再用 "2K" 这种简写**。官方要求是「总像素 3,686,400 ~ 16,777,216、宽高比 1/16~16」，`size` 可写 `1K/2K/3K/4K` 或 `宽x高`；但**不同模型对 "2K" 的解释不一样**（有的当 2048²，有的当 1024² → 直接报 3686400）。改为：`DEFAULT_SIZE = "1728x2304"`（398 万像素，正好是立绘 3:4），`getImageCfg()` 读到旧的 `1K/2K/4K` 简写**自动迁移**成明确宽×高，并新增 `callWithSizeFallback()` 尺寸阶梯（`1728x2304 → 2048x2048 → 3072x3072`），第一个能出图的档位**写回配置**，全都被拒才报错，错误信息带上可操作建议（"请到 设置 → 精灵形象 换尺寸"）。
    - **④ 「怎么又失败了」的真正原因：旧错误信息没被清掉**。`saveSpiritImage()` 里清的是 `rec.imgErr`，而错误分支写、列表页读的是 `rec._imgErr` —— **笔误导致出图成功后旧错误永远留着**，于是那行红字"出图失败：…size must be at least…"会在每次进精灵页时反复弹出，其实图早就出好了（用户截图里新立绘都在，红字却还在）。修：成功时同时清 `_imgErr`，并加 `_lastImgErrShown` 让**同一条错误只提示一次**。
    - **⑤ 顺带修两个浪费额度的坑**：失败时**不再清空 `imgUrl`**（旧图继续显示）；记 `_imgErrAt`，**10 分钟内不再重试**这只精灵（配置错时不会每次进页面都白烧一次额度）。所有"重画"入口（换形象/换设定/换性别/全部重画）都会一起清 `_imgErrAt`。
    - **验证**：端到端 **18/18**：400 个男孩无一长发/双马尾、400 个女孩无一男性发型；男孩 prompt 含 clearly male/short masculine/no long hair；人设行是中文；老配置「2K」读取即迁成 1728x2304；**1024x1024 被拒 → 自动改用 1728x2304 成功且写回配置**；**出图成功后无残留错误、页面无红字**；全部尺寸被拒时按 3 档阶梯试完才报错且提示可操作；**10 分钟内再进页面 0 次请求**；恢复后自动重出且清空错误。缓存 v108
91. **🏠 精灵改版：独立详情页 + 小房间 + 契合度剧情 + 精灵日记（v109）**：用户提出「每个精灵一个独立页面（200-300 字中文人物设定 + 原手串照片 + 形象贴近原串颜色）」「精灵栏目做成小房间，房间自由放精灵，同房增加契合度，达标触发剧情，栏目界面有提示、点进去才能看」「精灵的信改成精灵日记，在详情页看」。
    - **① 新模块 `js/rooms.js`（纯逻辑，可单测）**：`ww_rooms` 存房间（名字/emoji/顺序），成员关系存在精灵记录里（`rec.roomId`，**一只精灵同时只住一间**）；`ww_bonds` 存两两契合度 `{affinity, lastDay, stories[]}`。`tick(items)` 每天推进一次：**同住 +1/天；两只最近 3 天内都盘过 → 当天 +2**；跨过门槛（**7 / 20 / 40 / 70 / 110**，档名 初识→熟悉→默契→交心→知己）就在 `stories` 里落一个"待写"的坑。另有 `roomAffinity`（房间内两两平均 + 最合拍的一对）、`unreadStories` / `pendingStories` / `storiesOfRoom` / `markRead`。
    - **② 剧情生成**：进精灵页/房间页时 `tickRooms()` 先 `Rooms.tick()`，再把"待写"的坑（一次最多 3 段，别把额度打光）交给 `Spirits.roomStory(a, b, level, roomName, aff)` 生成正文（**AI 优先，无 key / 失败用本地模板**），写回 `Rooms.writeStory`。**栏目里有提示**：精灵 tab 上一个小红点（`.tab-dot`）+ 房间卡片上「📖 N」；房间页里未读剧情是金色高亮行，**点开才算看过**（`markRead` 后红点消失）——完全按用户要求"点进去才能看"。
    - **③ 精灵独立详情页 `#/spirit/<id>`**（点卡片进，不再是弹层）：立绘（点开看大图）+ 名字/形态/称号/口头禅/性格标签 + **📝 人物设定（200-300 字中文）** + 🔒 中文人设行 + 🎨 立绘主色来源 + **📿 原型手串（照片、颜色、品种、陪伴天数、盘玩次数、跳转手串详情）** + 🌱 成长与进化史 + **⚙️ 形象与进阶**（打开原弹层做突破/换形象/换设定/换性别，旧代码零风险复用） + **🏠 住的房间（同屋精灵 + 各自契合度进度条）** + **📔 日记本** + 💬 它们聊天。房间页 `#/room/<id>`：成员网格、契合度总览、剧情列表、`＋ 放入精灵`、房间设置（改名/换图标/成员搬出/删除房间）。
    - **④ 中文人物设定 `Spirits.personaZh()`**：AI 版要求「200-300 字、第三人称、必须含外形/性格/与主人关系、不要 Markdown」，**无 key 或失败时用本地模板**（`personaZhLocal` 拼外形+性格+小习惯+陪伴天数，实测 268 字）；按 `性别|发型|瞳色|配饰|颜色|名字` 缓存，人设变了才重写。
    - **⑤ 精灵日记 `Spirits.ensureDiary()`**：每天按 `hash(id+日期)` 排期 **0-2 篇**（25% 零篇、50% 一篇、25% 两篇）在 8/11/14/17/20/22 点写；到点且还没写就补一篇（AI 优先、本地模板兜底，正文 60-140 字，带"第 N 天 · 形态"抬头，最多存 40 篇）。详情页显示最近 8 篇，还有「✍️ 让它现在写一篇」= `Spirits.diaryNow()`。**「每日来信」正式退役**：精灵页顶部改成「📔 今天的日记」（显示今天最新的一篇 + 提示"点精灵看它自己的日记本"），弹层里「💌 给我写信」按钮改成「📔 写日记」。
    - **⑥ 立绘颜色贴近原串**：`Spirits.detectBeadColor(item)` 从**手串照片中心采样**算出真实主色 hex（结果存 `ww_beadcolor`，按色相/明度还给一个英文色名如 `clear jade green`），`promptFor` 优先用这个词，并往 prompt 里塞 `the exact color sampled from the real bracelet is #7fb069, keep the character close to this color`；拿不到照片才退回原来的 7 色分类。详情页会显示「立绘主色取自原串照片：#xxx」让用户看得见。
    - **验证**：端到端 **31/31**：Rooms 门槛表/档名（6 点无、7 点「初识」）；**同住 3 天、两只都在盘 → 5 变 11**；跨门槛自动生成第 1 段剧情（本地模板，正文含两只精灵名字）；房间卡「📖 1」+ tab 小红点；点房间卡进房间页 → 点剧情看全文 → 「看完了」后 `read=true` 且小红点消失；`#/spirit/d1` 独立页面含 人物设定/原型手串/成长/住的房间/日记本，**中文人设 268 字**、手串照片在、契合度行在；「✍️ 让它现在写一篇」真的写进日记本；「安排入住」列房间并能把没入住的精灵住进去；新建房间后房间页直达、房间区变 2 间；房间卡成员头像 42×42 正方形不拉伸。另截屏肉眼验收详情页/列表页排版 ✓ 缓存 v109

> 🧪 **可复用的端到端测试套路（推荐）**：把 `index.html` 的 body 注入一个临时页面 → 在脚本前定义 `window.SUPABASE_CONFIG` 与假 `window.supabase.createClient`（`auth.getSession/getUser` 返回假 session，`from(t)` 返回链式对象，`then` 直接 resolve 固定数据）→ 按原顺序动态 `appendChild` 加载 `js/*.js` → `location.hash` 切路由 + 断言。这样能用真实 `app.js` 验证交互，不用登录、不碰线上库。

> ⚠️ 教训：**不要用 PowerShell `Get-Content`/`Set-Content` 批量替换这些文件**（中文会被当 GBK 读写导致双重编码乱码，v77 开发中曾误损坏 app.js）。改代码请用 `edit` 工具；若损坏，用 `git checkout -- <file>` 从已提交版本恢复后重做。

## 六、用户偏好与重要决策（历史讨论结论）

- ❌ **不做强迫式每日打卡签到**（用户讨厌"打卡像上班"）——但 **v76-77 按用户主动要求加了"连续打卡"**，原则是**轻量有趣、不惩罚**：无每日任务压迫、无补签/断签惩罚，且 **XP 用「历史最长连续」只增不减**，断签只会让火苗熄灭、不会掉经验掉级
- ❌ **OCR 默认关闭**，不做设置开关（识别不准，订单截图仅保存）
- ✅ 邀请制，无公开注册；管理员 Supabase 建号
- ✅ 图片压缩 ≤200KB（批量上传快）
- ✅ 分类叫"收藏盒子"
- ✅ GitHub Pages 为主托管（用户决定保留 GitHub 不迁移）
- ✅ 照片数据不上国内节点
- ✅ 首页标题显示昵称（如"杯杯的大漂亮们收藏馆"）
- ✅ 状态系统取代旧的 played 布尔（played 字段兼容保留）
- ✅ 任务每天随机换一批，不要每天都一样
- ✅ 状态机简化成 4 态（去掉"放置中"，用 lastPlayedAt 推算盘玩时长）——v37 用户确认
- ✅ 盘玩时长用「今天 − 上次盘玩时间」，够 1 天才能重新被抽卡——v37 用户确认
- ✅ 海报改成一行 2 个大图、无边框、浅色质感展厅——v42 用户确认
- ✅ 抠图功能**已移除**（效果不稳定，开关无效），回退完整图显示——v43 用户确认
- ✅ 颜色功能 = 自动识别 + 可手动改 + 批量设色——v44-46 用户确认
- ✅ 盘玩计划 = **轻量温和提醒，非打卡**（用户讨厌"打卡像上班"）——不做进度条/不做连续打卡/不强制完成，仅按闲置天数排序并标红"该盘"——v52 用户确认
- ✅ 未记价的宝贝在价格排序时**永远排最后**（不参与升降序穿插）——v52 用户确认

## 七、发布流程（发版必须做的事）

1. 修改代码
2. **bump `sw.js` 的 `CACHE = "wenwan-vXX"`**（否则用户 PWA 拿旧文件）
3. **若改了 CSS，bump `index.html` 里 `<link href="css/style.css?v=YYYYMMDD">`**（CSS 缓存）
4. `git add -A && git commit && git push` → GitHub Pages 自动部署（约 1-2 分钟）
5. 用 headless Chrome 验证线上（或让用户刷新验证）
6. **新增数据库字段时，要让用户执行 alter SQL**（见第四节），db.js 会降级不崩

> ⚠️ **推送一定要确认真的成功了**：本机网络对 `github.com` 经常 `Recv failure: Connection was reset`（GitHub 的解析 IP 会变，老 IP `140.82.x.x` 已连不通 TLS，2026 年可用 `20.27.177.113`）。v82 那次就是推送失败但没复查，导致用户手机上一直是旧 CSS、以为「图还是有大有小」。做法：临时在 hosts 里把 `github.com/api.github.com/codeload.github.com` 指到可用 IP → 循环重试 `git push` → **推送后必须还原 hosts**（用 `git status -sb` 确认 `## main...origin/main` 没有 `[ahead N]`）。

> 注意：仓库文件行尾是 CRLF；js 是 IIFE 闭包，外部无法直接调用内部函数；新增字段要在 db.js 的 `toDB/toFront` + `OPTIONAL_FIELDS` 里都加。

## 八、本地开发

```bash
python -m http.server 8899 --directory "G:\个人\wenwan-collection"
# 或任意目录起静态服务后打开 index.html
```

测试账号（Supabase 邮箱未确认，仅供本地 mock，不能登录真实环境）：
- `wwtest_27896175@qq.com` / `Wenwan123!`
- 用户真实账号：`kyokokey@qq.com`（密码在用户手里，只有用户自己知道）

## 九、历史提交时间线（近 20 条，完整见 git log）

```
ff3fd5b 珠型词条改名与排序(v72):桶珠->正桶,老型珠->老型桶;最常买四种(圆珠/苹果圆/正桶/老型桶)排最前且相邻;v值不变;缓存v72
de67a06 批量编辑支持珠型(v71):多选后批量设置/清空珠型;多选列表显示珠型标签;缓存v71
0a66dd5 珠型(v70):详情可选择/修改+编辑表单chips+列表卡片标签+筛选面板多选(带计数/清除);db加bead_shape字段;缓存v70
72b88f3 排序:创建时间改为放置时间(按距上次盘玩时长,desc=放置最长在前,无盘玩记录排最后;缓存v69)
d676585 展示界面增加'隐藏已送人'开关(默认隐藏,关闭显示全部;手动筛已送人时始终显示)
b9b463e 筛选改多选(状态+颜色可同时勾选,含清除按钮);修复排序箭头不显示(点击后重新渲染首页)
8918c32 多选编辑列表增加主色标签+盘玩状态标签(复用colorTagHtml/beadStatus)
a51212e 首页卡片/列表展示主色标签(未分色醒目标红);多选改成列表形式勾选(复选框)
47ec5e9 更新开发档案颜色分类描述到v47(7类+浅→深排序)
8c83be2 颜色分类更新为绿/多宝敦煌/黑灰/黄棕/白原生态/浅花/深花(浅→深排序顺序)+旧值兼容映射;排序改3按钮(入库/创建/颜色)点击切换升降序带箭头
9f81103 更新开发档案DEVELOPMENT.md到v46：覆盖状态机4态/颜色识别/抽卡/海报改版/修改密码等全部功能与SQL
0bdcbaf 批量编辑新增批量设置主色(色块chips选择+应用到所选)
92a9bd0 修复颜色功能:详情页Color变量引用错误(改window.Color)+编辑表单加主色手动选择chips+保存优先手动色
b397dd3 新增手串主色识别(color.js):保存/补色自动识别中心主色,详情可改,颜色排序+颜色筛选chips
be99f0b 移除海报抠图功能(开关无效,回退至完整图显示);保留一行2个+无边框+浅色展厅布局
2fc1f99 展示柜海报改版:一行2个大图+去边框沉浸式+浅色质感展厅+自动去背景抠图(可切完整图开关)
5b1d80f 修复分享海报排版:文字固定在卡片底部预留区不溢出+图片contain保持比例居中(不拉伸)
033f2d0 设置页新增修改密码功能(弹窗校验新密码/确认一致,调Supabase updateUser)
0e37f04 批量编辑上次盘玩时间改为日历选择器(可清除)+修复多选/批量编辑返回跳错页(goBack钩子统一回首页)
b255d64 详情页盘玩时长对所有菩提显示(含设置上次盘玩按钮)+批量编辑加批量设置上次盘玩时间(今天/昨天/清除)
fc4f3b7 状态机简化为4态(去掉放置中):盘玩中显示已放置X天+详情页盘玩时长可手动设置上次盘玩时间+进池条件用lastPlayedAt推算
8f00e6b 修复：放置中(resting)无盘玩时间时错误显示未盘玩——beadStatusText漏判resting分支
e361cf7 修复：1)5个盘玩状态5种颜色 2)抽卡重抽可变化(盐) 3)db保存精确降级(只删缺失列,保留play_status/fav)
38f5a5e 修复今日心选抽卡陈列：改为横向滑动大卡片+图片contain不裁剪+1:1方形格子
3ed883f 喜欢页沉浸式大图浏览(滑动+圆点)+展柜海报+公开可访问的动态展厅网页(gallery.html)
9977771 优化收藏缺fav列的提示文案，文档记录fav SQL指引
4caa789 新增喜欢/收藏展示柜(fav字段跨设备同步)+底部导航6+1(首页/分类/喜欢/＋/任务/成就/设置)
36563f3 盘玩状态机/盘玩记忆/今日心选抽卡仅限菩提分类，其他珠子只显示在库/已送人
a12db69 珠子状态机重构(未盘玩/待盘玩/盘玩中/放置中/已盘好)+盘玩记忆(lastPlayedAt)+今日心选抽卡系统
```

## 十、给新 AI/开发者的建议

- 改 UI 逻辑主战场是 `js/app.js`（IIFE，函数内部闭包）
- 状态字段读写经 `js/db.js` 的 `toDB/toFront` 转换（camelCase ↔ snake_case）
- 改天数/统计逻辑会同时影响 stats.js / game.js / poster.js（都调 `DB.daysWith`）
- **新增可空字段**：db.js 的 `toDB/toFront` 加映射 + `OPTIONAL_FIELDS` 数组加字段名（防止未建列时报错降级）
- 颜色识别逻辑在 `js/color.js`（`detectColor/classifyRgb/COLOR_LIST`），排序用 `window.Color.COLOR_LIST` 顺序
- 珠型（bead shape）在 `js/app.js` 的 `SHAPE_LIST`（唯一数据源）：加/改珠型只改这个数组；筛选靠 `selectShapes` Set + `data-mshape` chips，展示靠 `shapeLabel()` / `shapeTagHtml()`
- 新增可空字段（v70 例：`bead_shape`）：db.js 的 `toDB/toFront` 加映射 + `OPTIONAL_FIELDS` 加字段名，**并让用户执行 alter SQL**
- 每次改动后 `node --check js/*.js` 验语法；本地起服务用 headless Chrome 实测
- 用户是中文交流，回复请用中文