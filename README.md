# 文玩手串收藏馆 📿

一个手机优先的 **PWA 网页应用**，用来记录和展示你的文玩手串收藏 —— 像图鉴一样的收藏展示柜。

**多账号 + 云端同步**：登录自己的账号，任何手机、任何地点打开，看到的都是你自己的手串收藏；不同账号的数据互相隔离。

> 💡 开发者/接手人请看 **[DEVELOPMENT.md](./DEVELOPMENT.md)** —— 项目完整开发档案（架构、功能、数据库、历史决策、发布流程）。

---

## ✨ 功能一览

| 功能 | 说明 |
|------|------|
| 👤 多账号 | 邮箱+密码注册/登录，每个账号数据独立（Supabase RLS 行级安全隔离） |
| 📡 跨设备同步 | 数据存云端，换手机登录同一账号，收藏自动同步 |
| 📿 手串档案 | 名字、品种/材质、工艺（干磨/水磨）、到货时间、入手价格、购买店铺、在库/已送人、盘玩记录、备注 |
| ⏳ 陪伴时长 | 自动计算"已陪伴 X 年 X 个月" |
| 📷 多图记录 | 照片/截图上传到云端存储（Supabase Storage），详情页大图浏览 |
| 🧾 订单截图识别 | 上传订单截图，自动识别店铺、价格、时间、商品名填入表单 |
| 🗂 图鉴式展示 | 卡片网格收藏柜 + 状态筛选 + 搜索 |
| 📤 备份导出/导入 | 一键导出全部数据为 JSON |

## 🚀 部署步骤

### 1. 准备 Supabase（后端：账号 + 数据库 + 图片）

1. 打开 https://supabase.com/dashboard 注册/登录
2. **New project** → 填名称、设数据库密码、Region 选 Singapore
3. 创建完成后：**⚙ Settings → API**，复制 **Project URL** 和 **anon public key**
4. 填入本项目的 `js/config.js`：

```js
window.SUPABASE_CONFIG = {
  url: "https://你的项目.supabase.co",
  anonKey: "你的anon key"
};
```

5. **SQL Editor** → New query → 粘贴 `supabase-schema.sql` 全部内容 → **Run**
   （建好 bracelets 表和图片存储桶，并开启用户数据隔离）

### 2. 本地测试

```bash
python -m http.server 8899
```

打开 `http://127.0.0.1:8899` → 注册账号 → 添加手串 → 换手机/换浏览器登录同一账号验证同步。

### 3. 部署到 GitHub Pages

```bash
# 初始化 git 并推送（需先创建 GitHub 仓库）
git init
git add .
git commit -m "文玩手串收藏馆"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在 GitHub 仓库 → **Settings → Pages** → Source 选 **Deploy from a branch** → 分支 `main` → Save。
等 1–2 分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

### 4. 手机使用

手机浏览器打开部署后的网址 → 登录账号 → 添加到主屏幕，像 App 一样用。

## 📂 项目结构

```
wenwan-collection/
├── index.html          # 入口页面
├── manifest.json       # PWA 配置
├── sw.js               # Service Worker（离线缓存）
├── supabase-schema.sql # Supabase 建表脚本（重要！）
├── css/style.css
├── js/
│   ├── config.js       # ← 填入你的 Supabase URL 和 Key
│   ├── db.js           # 数据层：Supabase 云端读写 + 图片上传
│   ├── ocr.js          # 订单截图识别
│   └── app.js          # 页面路由与 UI
└── icons/
```

## ⚠️ 注意事项

- **先建表再使用**：部署前必须在 Supabase SQL Editor 执行 `supabase-schema.sql`
- 免费额度：数据库 500MB、图片存储 1GB、每月 5 万活跃用户，个人收藏完全够用
- 每个账号的数据通过行级安全（RLS）严格隔离，他人无法看到你的数据