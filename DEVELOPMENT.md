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
index.html          # 入口：5 个底部 Tab + 大图查看器 DOM + 模块加载
sw.js               # Service Worker（网络优先）；每次发版必须 bump CACHE = "wenwan-vXX"
manifest.json       # PWA 清单
js/config.js        # SUPABASE_CONFIG（url + anonKey，publishable key，客户端安全）
js/db.js            # 数据层：CRUD + 图片上传/删除 + 天数计算（daysWith 按自然日）
js/app.js           # 全部 UI 与逻辑（约 2500 行，IIFE）
js/categories.js    # 分类 → 品种/品牌联动；拼图分类才有 pieceCount/finishedAt
js/stats.js         # 统计：月历热力图、成就分组、有趣发现
js/game.js          # 游戏化：XP/等级/每日任务（按日期种子随机）/不买挑战
js/poster.js        # Canvas 生成分享海报（单条 + 图鉴 + 成就）
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
`id, user_id, name, species, craft, arrived_at, price, shop, gifted, gifted_at, played, played_note, note, photos(jsonb), screenshots(jsonb), created_at, updated_at, bead_size, category, finished_at, piece_count, accessory_type, play_status`

- `play_status`：`''`(待盘玩) / `playing`(在盘玩) / `puzzle_pending`(待拼) / `puzzle_done`(已拼)；**若用户库缺此列需执行 `alter table public.bracelets add column if not exists play_status text not null default '';`**（db.js 会静默降级，不会崩，但状态保存无效）
- `category`：菩提/水晶/玉石/拼图/动漫周边/盲盒/其他（用户可自定义增删，存 localStorage `ww_categories`）
- `photos`/`screenshots`：jsonb 数组，每项 `{url, name, ...}`（Blob 只在本地上传前存在）
- `profiles` 表：`id, display_name, updated_at`（昵称）

**Storage**：bucket `bracelet-images`，按用户隔离（RLS）。

## 五、功能清单（截至 v29）

1. **收藏录入/编辑**：名称、分类联动品种/品牌、工艺（干磨/水磨）、到货时间、陪伴时长（自然日自动算）、价格（隐藏小眼睛）、店铺（记忆常用）、状态（待盘玩/在盘玩/待拼/已拼/已送人）、拼图完成时间、拼图片数（500/1000/1500/2000）、动漫周边类型、照片+订单截图（各≤9张、批量上传自动压缩≤200KB）、备注、盘玩记录
2. **图鉴展示**：卡片视图 / 列表视图（可切换、记忆）；状态筛选、分类筛选、搜索（含工艺/状态/价格/珠径/片数）；**排序 4 种：入库最新/最早、创建时间最新/最早**（记忆 `ww_sortmode`）
3. **状态快捷切换**：卡片右上角 / 列表右侧状态按钮点击即切换（不进入详情），手串↔待盘玩/在盘玩，拼图↔待拼/已拼，已送人不切换
4. **大图查看器**：点图放大，底部数字按钮切换多图（每次切换重新绑定事件）
5. **分类盒子页**：按分类展示 + 收集进度（品种/品牌收集率）
6. **批量录入**：一次填多行；**多选操作**：勾选卡片（≤20）批量编辑（转分类/状态/尺寸/品牌/删除）+ 生成图鉴海报
7. **分享海报**：单条海报 + 图鉴长图 + 成就海报（Canvas 生成，系统分享/保存）
8. **统计页**：GitHub 风月历热力图（按月翻看）、花费统计、成就徽章（囤囤鼠系列 tier：囤囤新鼠→囤囤鼠→囤囤大仙→囤货龙王等，点击设置展示称号，最多 6 个）
9. **游戏化**：XP/等级称号（收藏萌新→异世界收藏王）、**每日任务 4 个**（当日型池 5 选 2 + 达成型池 11 选 2，按日期种子随机，当天一致次日变化）、不买挑战（隐藏自动累计）、升级弹窗
10. **有趣发现**（统计页底部）：最贵/最省/性价比之王/陪伴最久/平均单价/最宠爱的品种/在库率/送出的宝贝
11. **Tips 知识库**：按材质/分类显示养护、禁忌、盘玩、冷知识
12. **多账号 + 云同步** + **PWA 离线可用** + **数据导出/导入 JSON**

## 六、用户偏好与重要决策（历史讨论结论）

- ❌ **不做每日打卡签到**（用户讨厌"打卡像上班"）
- ❌ **OCR 默认关闭**，不做设置开关（识别不准，订单截图仅保存）
- ✅ 邀请制，无公开注册；管理员 Supabase 建号
- ✅ 图片压缩 ≤200KB（批量上传快）
- ✅ 分类叫"收藏盒子"
- ✅ GitHub Pages 为主托管（即使讨论过 Tencent Cloud，用户决定保留 GitHub 不迁移）
- ✅ 照片数据不上国内节点
- ✅ 首页标题显示昵称（如"杯杯的大漂亮们收藏馆"）
- ✅ 状态系统取代旧的 played 布尔（played 字段兼容保留）
- ✅ 任务每天随机换一批，不要每天都一样

## 七、发布流程（发版必须做 3 件事）

1. 修改代码
2. **bump `sw.js` 的 `CACHE = "wenwan-vXX"`**（否则用户 PWA 拿旧文件）
3. **bump `index.html` 里 `<link href="css/style.css?v=YYYYMMDD">`**（CSS 缓存）
4. `git add -A && git commit && git push` → GitHub Pages 自动部署（约 1-2 分钟）
5. 用 headless Chrome 验证线上（或让用户刷新验证）

> 注意：仓库文件行尾是 CRLF；js 是 IIFE 闭包，外部无法直接调用内部函数。

## 八、本地开发

```bash
python -m http.server 8899 --directory "G:\个人\wenwan-collection"
# 或任意目录起静态服务后打开 index.html
```

测试账号（Supabase 邮箱未确认，仅供本地 mock，不能登录真实环境）：
- `wwtest_27896175@qq.com` / `Wenwan123!`
- 用户真实账号：`kyokokey@qq.com`（密码在用户手里，只有用户自己知道）

## 九、历史提交时间线（近 10 条，完整见 git log）

```
759dac8 每日任务每日随机更新（当日型+达成型任务池按日期种子抽取）
47b9f4b 新增创建时间排序(升降序)、列表/卡片状态快捷切换、入库天数按自然日计算
8db6acc 修复大图查看器多图切换卡死 + viewer 定位兼容旧浏览器
a580fe4 图片压缩上限 500KB→200KB，批量上传更快
76a3ca3 移除订单识别开关、有趣发现替换累计陪伴统计
5de00d4 设置页加订单识别开关
55eca08 海报优化：图鉴最后一行居中、成就海报徽章加大
1a396ec 搜索扩展：工艺/状态/分类/价格/珠子大小/拼图片数
6cc058a 修复图鉴海报分享后返回首页
6de40dc 录入保存后自动返回宝贝列表页
```

## 十、给新 AI/开发者的建议

- 改 UI 逻辑主战场是 `js/app.js`（IIFE，函数内部闭包）
- 状态字段读写经 `js/db.js` 的 `toDB/toFront` 转换（camelCase ↔ snake_case）
- 改天数/统计逻辑会同时影响 stats.js / game.js / poster.js（都调 `DB.daysWith`）
- 每次改动后 `node --check js/*.js` 验语法；本地起服务用 headless Chrome 实测
- 用户是中文交流，回复请用中文