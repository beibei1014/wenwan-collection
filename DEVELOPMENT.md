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
js/color.js         # V手串主色识别（中心区域主色→10类颜色）+ COLOR_LIST
js/db.js            # 数据层：CRUD + 图片上传/删除 + 精确降级 + 天数计算
js/app.js           # 全部 UI 与逻辑（约 3200 行，IIFE）
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
`id, user_id, name, species, craft, arrived_at, price, shop, gifted, gifted_at, played, played_note, note, photos(jsonb), screenshots(jsonb), created_at, updated_at, bead_size, category, finished_at, piece_count, accessory_type, play_status, last_played_at, fav, color`

**用户需自行执行的 alter SQL**（db.js 会静默降级不崩，但字段保存无效）：
- `play_status`：`alter table public.bracelets add column if not exists play_status text not null default '';`
- `last_played_at`：`alter table public.bracelets add column if not exists last_played_at timestamptz;`
- `fav`：`alter table public.bracelets add column if not exists fav boolean not null default false;`
- `color`：`alter table public.bracelets add column if not exists color text not null default '';`

**字段含义**：
- `play_status`：菩提类 `unplayed`(未盘玩) / `ready`(待盘玩) / `playing`(盘玩中) / `done`(已盘好)；拼图类 `puzzle_pending` / `puzzle_done`；`` '' `` 归一为 unplayed
- `last_played_at`：上次盘玩时间（timestamptz），盘玩时长/抽卡进池判断靠它
- `fav`：特别喜欢标记（boolean），喜欢展示柜用
- `color`：主色类别（text，如 green/brown/mixed/other 等），颜色排序筛选用
- `category`：菩提/水晶/玉石/拼图/动漫周边/盲盒/其他（用户可自定义增删，存 localStorage `ww_categories`）
- `photos`/`screenshots`：jsonb 数组，每项 `{url, name, ...}`（Blob 只在本地上传前存在）
- `profiles` 表：`id, display_name, updated_at`（昵称）

**Storage**：bucket `bracelet-images`，按用户隔离（RLS），公开读取（public read policy）。

## 五、功能清单（截至 v46）

1. **收藏录入/编辑**：名称、分类联动品种/品牌、工艺（干磨/水磨）、到货时间、陪伴时长（自然日自动算）、价格（隐藏小眼睛）、店铺（记忆常用）、状态（**菩提 4 态** + 拼图 2 态 + 已送人；水晶/玉石等只显示在库/已送人）、**主色（自动识别+可手动选）**、拼图完成时间、拼图片数（500/1000/1500/2000）、动漫周边类型、照片+订单截图（各≤9张、批量上传自动压缩≤200KB）、备注、盘玩记录
2. **底部导航（6+1）**：首页 | 分类 | 喜欢 | ＋（居中新建）| 任务 | 成就 | 设置；`#/quest`(任务) 和 `#/fav`(喜欢) 也从底部直达
3. **喜欢/收藏展示柜（fav 字段）**：卡片/列表右下角 **❤️/🤍** 一键标记喜欢（存数据库 `fav` 字段，跨设备同步）；底部"喜欢"tab 进入展示柜页（renderFavPage），展示所有喜欢的宝贝；详情页也有"喜欢"按钮
4. **喜欢页沉浸式大图**：一屏一个宝贝（左右滑动 + ◀▶ 按钮 + 圆点切换 + 第 X/N 件计数），深色展柜背板 + 射光灯效；含"查看详情"按钮
5. **喜爱展柜分享（两种）**——
   - **🏛 海报**：`Poster.favPoster()` 生成**浅色质感展厅**海报（一行 2 个大图、无边框沉浸式、图片 contain 完整显示不裁剪不拉伸、铜牌名称+品种），存 JPG 到相册/微信
   - **🔗 动态展厅**：生成公开可访问的动态网页链接 `gallery.html?data=<编码数据>`，任何人（无需登录）打开即见深色展柜 + 射灯扫光 + 旋转光晕动画，左右滑动切换；数据只含公开信息（名称/图片URL/分类/品种/尺寸），图片 URL 公开可访问
6. **菩提盘玩状态机（v37 简化为 4 态，仅「菩提」分类）**：`unplayed`(未盘玩) / `ready`(待盘玩) / `playing`(盘玩中) / `done`(已盘好)。每个菩提记录 `lastPlayedAt`；**盘玩中显示"已放置 X 天"**（今天−上次盘玩）；点状态徽章弹状态选择器，含"✅ 今日盘过"（记录今天盘了→转盘玩中）；详情页"盘玩时长"字段可**手动设置上次盘玩时间**（日历）
   - 兼容：旧 `resting`(放置中) → `playing`；旧 `idle` → `ready`；旧 `"" / null` → `unplayed`（在 `loadItems()` 和 `normBeadStatus()` 处理）
7. **今日心选抽卡（仅抽菩提）**：首页"🎴 今日心选"栏目，用户**主动点击抽取**，候选池 = 待盘玩/盘玩中（距上次盘玩>1天或从未盘过）+ 已盘好（随时可抽）；按**当天日期种子**随机抽 3 串，当天固定、次日变化；点"🔄 重抽"用随机盐换一批；结果存 localStorage（`ww_draw_YYYY-M-D`）；拼图/周边/水晶/玉石不参与
8. **手串主色识别（js/color.js，v44）**：分析照片**中心区域**主色映射到 10 类（绿/黄/棕/黑/红/白/紫/蓝/花/其他）。保存宝贝时自动识别；**登录后后台给无颜色且有照片的旧宝贝补色**（backfillColors）；详情/编辑可手动改色；**排序加"🎨 颜色"、筛选 chips 加颜色**；批量编辑加"批量设置主色"
9. **大图查看器**：点图放大，底部数字按钮切换多图（每次切换重新绑定事件）
10. **分类盒子页**：按分类展示 + 收集进度（品种/品牌收集率）
11. **批量录入**：一次填多行；**多选操作**：勾选卡片（≤20）批量编辑（转分类/状态/上次盘玩时间/大小/品种/主色/删除）+ 生成图鉴海报
12. **分享海报**：单条海报 + 图鉴长图 + 成就海报（Canvas 生成，系统分享/保存）
13. **统计页**：GitHub 风月历热力图（按月翻看）、花费统计、成就徽章（囤囤鼠系列 tier：囤囤新鼠→囤囤鼠→囤囤大仙→囤货龙王等，点击设置展示称号，最多 6 个）
14. **游戏化**：XP/等级称号（收藏萌新→异世界收藏王）、**每日任务 4 个**（当日型池 5 选 2 + 达成型池 11 选 2，按日期种子随机，当天一致次日变化）、不买挑战（隐藏自动累计）、升级弹窗
15. **有趣发现**（统计页底部）：最贵/最省/性价比之王/陪伴最久/平均单价/最宠爱的品种/在库率/送出的宝贝
16. **Tips 知识库**：按材质/分类显示养护、禁忌、盘玩、冷知识
17. **修改密码**（设置页 → 数据与账户 → 修改密码）：弹窗输入新密码+确认，调 Supabase `updatePassword`（`auth.updateUser({password})`）
18. **多账号 + 云同步** + **PWA 离线可用** + **数据导出/导入 JSON**

## 六、用户偏好与重要决策（历史讨论结论）

- ❌ **不做每日打卡签到**（用户讨厌"打卡像上班"）
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

## 七、发布流程（发版必须做的事）

1. 修改代码
2. **bump `sw.js` 的 `CACHE = "wenwan-vXX"`**（否则用户 PWA 拿旧文件）
3. **若改了 CSS，bump `index.html` 里 `<link href="css/style.css?v=YYYYMMDD">`**（CSS 缓存）
4. `git add -A && git commit && git push` → GitHub Pages 自动部署（约 1-2 分钟）
5. 用 headless Chrome 验证线上（或让用户刷新验证）
6. **新增数据库字段时，要让用户执行 alter SQL**（见第四节），db.js 会降级不崩

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
0bdcbaf 批量编辑新增批量设置主色
92a9bd0 修复颜色功能(详情页Color变量错)+编辑表单手动选色
b397dd3 新增手串主色识别(color.js)+颜色排序筛选
be99f0b 移除海报抠图功能(回退完整图)
2fc1f99 展示柜海报改版(一行2个/无边框/浅色展厅/抠图)
5b1d80f 修复分享海报排版(文字不溢出+图片contain)
033f2d0 设置页新增修改密码
0e37f04 批量编辑上次盘玩时间改日历+修复返回跳错页
b255d64 详情页盘玩时长对所有菩提显示+批量设置上次盘玩时间
fc4f3b7 状态机简化为4态(去掉放置中)
8f00e6b 修复放置中无时间错误显示未盘玩
e361cf7 修复5色/抽卡重抽/数据库精确降级
38f5a5e 修复今日心选抽卡陈列(大卡片+contain)
3ed883f 喜欢页沉浸式大图+展柜海报+动态展厅
9977771 优化收藏缺fav列提示
4caa789 新增喜欢收藏展示柜+底部导航6+1
36563f3 盘玩状态机仅限菩提分类
a12db69 珠子状态机重构+盘玩记忆+抽卡系统
413ecf5 新增 DEVELOPMENT.md 开发档案
759dac8 每日任务每日随机更新
```

## 十、给新 AI/开发者的建议

- 改 UI 逻辑主战场是 `js/app.js`（IIFE，函数内部闭包）
- 状态字段读写经 `js/db.js` 的 `toDB/toFront` 转换（camelCase ↔ snake_case）
- 改天数/统计逻辑会同时影响 stats.js / game.js / poster.js（都调 `DB.daysWith`）
- **新增可空字段**：db.js 的 `toDB/toFront` 加映射 + `OPTIONAL_FIELDS` 数组加字段名（防止未建列时报错降级）
- 颜色识别逻辑在 `js/color.js`（`detectColor/classifyRgb/COLOR_LIST`），排序用 `window.Color.COLOR_LIST` 顺序
- 每次改动后 `node --check js/*.js` 验语法；本地起服务用 headless Chrome 实测
- 用户是中文交流，回复请用中文