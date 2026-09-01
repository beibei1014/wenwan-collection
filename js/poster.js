/* =========================================================
 * poster.js — 分享海报生成（Canvas 绘制 → JPG 下载/分享）
 * 支持：单条海报 / 多选图鉴海报
 * ========================================================= */
(function () {
  "use strict";

  /* 加载图片（URL 或 Blob → Image） */
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = src;
    });
  }

  /* 圆角矩形裁剪绘制 */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 绘制带圆角的图片 */
  function drawRoundImage(ctx, img, x, y, w, h, r) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  function escText(s) {
    return String(s == null ? "" : s);
  }

  /* ---------- 单条手串海报 ---------- */
  async function singlePoster(item, opts) {
    const W = 1080, H = 1620; // 3:4 竖版海报
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // 背景（暖木渐变）
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#f7f1e6");
    bg.addColorStop(1, "#ead9c0");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 顶部装饰线
    ctx.fillStyle = "#b8860b";
    ctx.fillRect(0, 0, W, 14);

    // 照片（主图，方形 1:1）
    const photo = item.photos && item.photos[0];
    if (photo) {
      try {
        const img = await loadImg(photo.url || (photo.data ? URL.createObjectURL(photo.data) : ""));
        drawRoundImage(ctx, img, 90, 120, 900, 900, 24);
      } catch (e) {
        ctx.fillStyle = "#e0d5c0";
        roundRect(ctx, 90, 120, 900, 900, 24);
        ctx.fill();
        ctx.fillStyle = "#b8860b";
        ctx.font = "140px serif";
        ctx.textAlign = "center";
        ctx.fillText("📿", W / 2, 120 + 500);
      }
    } else {
      ctx.fillStyle = "#e0d5c0";
      roundRect(ctx, 90, 120, 900, 900, 24);
      ctx.fill();
      ctx.fillStyle = "#b8860b";
      ctx.font = "140px serif";
      ctx.textAlign = "center";
      ctx.fillText("📿", W / 2, 120 + 500);
    }

    // 名称
    ctx.fillStyle = "#3d2b1f";
    ctx.font = "bold 58px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(escText(item.name || "文玩手串").slice(0, 14), W / 2, 1170);

    // 珠子大小 + 分类标签
    ctx.fillStyle = "#b8860b";
    ctx.font = "36px 'PingFang SC','Microsoft YaHei',sans-serif";
    const bead = item.beadSize ? item.beadSize + " mm" : "";
    const cat = item.category || "";
    const tagParts = [bead, item.craft || "", cat].filter(Boolean);
    ctx.fillText(tagParts.join(" · "), W / 2, 1240);

    // 陪伴时长
    ctx.fillStyle = "#8a7a68";
    ctx.font = "34px 'PingFang SC','Microsoft YaHei',sans-serif";
    const days = DB.formatDays(DB.daysWith(item));
    ctx.fillText("已陪伴 " + days, W / 2, 1320);

    // 店铺
    if (item.shop) {
      ctx.fillStyle = "#8a7a68";
      ctx.font = "30px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.fillText("来自 " + escText(item.shop).slice(0, 16), W / 2, 1390);
    }

    // 底部落款：用户名@我的收藏馆
    ctx.fillStyle = "rgba(61,43,31,.45)";
    ctx.font = "28px 'PingFang SC','Microsoft YaHei',sans-serif";
    const byline = (opts && opts.username ? opts.username + " @ " : "") + "我的收藏馆";
    ctx.fillText(byline, W / 2, 1540);

    return canvas;
  }

  /* ---------- 多选图鉴海报 ---------- */
  async function galleryPoster(items, opts) {
    // 版式：固定 3:4 竖屏基准（1080x1440），宝贝多时扩展为 2-3 屏长图
    const count = Math.min(items.length, 20);
    const W = 1080;
    const cols = 3;
    const rows = Math.ceil(count / cols);
    const cardW = 300, cardH = 380, gap = 30;
    const padX = 40;
    const titleH = 190, footerH = 120;
    // 基础高度按 3:4（W * 4/3 = 1440）；行数多时按行扩展
    const baseH = 1440;
    const contentH = rows * cardH + (rows - 1) * gap;
    const H = Math.max(baseH, titleH + contentH + footerH);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#f7f1e6");
    bg.addColorStop(1, "#ead9c0");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#b8860b";
    ctx.fillRect(0, 0, W, 14);

    // 顶部标题（居中）
    ctx.fillStyle = "#3d2b1f";
    ctx.font = "bold 50px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("我的收藏图鉴", W / 2, 85);
    ctx.fillStyle = "#b8860b";
    ctx.font = "28px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("共 " + count + " 件藏品 · " + (opts && opts.username ? opts.username + " @ " : "") + "我的收藏馆", W / 2, 132);

    // 内容区水平居中：计算总宽
    const totalW = cols * cardW + (cols - 1) * gap;
    const startX = (W - totalW) / 2;   // 居中偏移

    // 绘制卡片（每行按实际数量居中，最后一行不满也居中）
    for (let i = 0; i < count; i++) {
      const item = items[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      // 本行宝贝数（最后一行可能不满 cols）
      const rowStart = row * cols;
      const rowCount = Math.min(cols, count - rowStart);
      const rowWidth = rowCount * cardW + (rowCount - 1) * gap;
      const rowStartX = (W - rowWidth) / 2;   // 本行居中偏移
      const x = rowStartX + col * (cardW + gap);
      const y = titleH + row * (cardH + gap);

      // 卡片背景（圆角白卡）
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, x, y, cardW, cardH, 18);
      ctx.fill();

      // 照片（居中方形区）
      const photo = item.photos && item.photos[0];
      if (photo) {
        try {
          const img = await loadImg(photo.url || (photo.data ? URL.createObjectURL(photo.data) : ""));
          drawRoundImage(ctx, img, x + 14, y + 14, cardW - 28, cardW - 28, 12);
        } catch (e) {}
      } else {
        ctx.fillStyle = "#efe9dd";
        roundRect(ctx, x + 14, y + 14, cardW - 28, cardW - 28, 12);
        ctx.fill();
        ctx.fillStyle = "#c9b89c";
        ctx.font = "80px serif";
        ctx.textAlign = "center";
        ctx.fillText("📿", x + cardW / 2, y + 14 + (cardW - 28) / 2 + 30);
      }

      // 名称
      ctx.fillStyle = "#3d2b1f";
      ctx.font = "bold 28px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(escText(item.name || "未命名").slice(0, 8), x + cardW / 2, y + cardW + 4 + 32);

      // 副信息（大小/品种）
      ctx.fillStyle = "#b8860b";
      ctx.font = "24px 'PingFang SC','Microsoft YaHei',sans-serif";
      const sub = item.beadSize ? item.beadSize + "mm" : (item.pieceCount ? item.pieceCount + "片" : (item.species || "").slice(0, 6));
      ctx.fillText(sub, x + cardW / 2, y + cardW + 4 + 68);
    }

    // 底部落款
    ctx.fillStyle = "rgba(61,43,31,.45)";
    ctx.font = "26px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText((opts && opts.username ? opts.username + " @ " : "") + "我的收藏馆", W / 2, H - 50);

    return canvas;
  }

  /* 下载海报 */
  function downloadCanvas(canvas, filename) {
    const link = document.createElement("a");
    link.download = filename || "poster.jpg";
    link.href = canvas.toDataURL("image/jpeg", 0.92);
    link.click();
  }

  /* ---------- 成就海报（称号 + 徽章 + 月历 + 有趣发现） ---------- */
  async function achievementPoster(opts) {
    const items = opts.items || [];
    const stats = window.Stats.computeStats(items);
    const achievements = window.Stats.getAchievements(items);
    const facts = window.Stats.funFacts(items, stats);
    const lv = window.Game.getLevel(window.Game.computeXp(items).xp);
    const username = opts.username || "";
    const W = 1080;
    const badgeIds2 = opts.badgeIds || [];
    const badgeCount2 = Math.min(achievements.reduce((s, g) => s + g.items.filter((a) => a.unlocked && badgeIds2.includes(a.id)).length, 0), 12);
    const factsCount = Math.min(facts.length, 6);
    const badgeRows = badgeCount2 ? Math.ceil(badgeCount2 / 5) : 0;
    const baseH = 1920;
    // 徽章行数越多越高，发现越多越高
    const extraH = badgeRows > 1 ? (badgeRows - 1) * 220 : 0;
    const factsH = factsCount > 5 ? (factsCount - 5) * 78 : 0;
    const H = baseH + extraH + factsH;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#f7f1e6");
    bg.addColorStop(1, "#ead9c0");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#b8860b";
    ctx.fillRect(0, 0, W, 14);

    // 标题
    ctx.fillStyle = "#3d2b1f";
    ctx.font = "bold 52px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText((username ? username + " 的" : "") + "收藏成就", W / 2, 110);

    // 等级称号卡（大图标 + 大字）
    ctx.fillStyle = "#3d2b1f";
    roundRect(ctx, 70, 160, W - 140, 170, 24);
    ctx.fill();
    // 左侧大圆形图标
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.beginPath();
    ctx.arc(190, 245, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f5f0e8";
    ctx.font = "64px serif";
    ctx.textAlign = "center";
    ctx.fillText(lv.icon, 190, 268);
    // 称号大字
    ctx.fillStyle = "#f5f0e8";
    ctx.font = "bold 40px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(lv.name, 285, 225);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = "24px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("Lv." + lv.level + " · " + lv.xp + " XP", 285, 262);
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.font = "20px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("已解锁成就 " + achievements.reduce((s,g)=>s+g.unlockedCount,0) + " 个", 285, 296);

    // 徽章区（加大 + 居中）
    const badgeIds = opts.badgeIds || [];
    const badgeAch = [];
    achievements.forEach((g) => g.items.forEach((a) => { if (a.unlocked && badgeIds.includes(a.id)) badgeAch.push(a); }));
    let factsY = 620;
    if (badgeAch.length) {
      // 板块标题
      ctx.fillStyle = "#3d2b1f";
      ctx.font = "bold 34px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("我 的 徽 章", W / 2, 420);

      // 徽章卡加大：140 宽，每行 5 个（5*140+4*16=764 < 940），居中
      const badgeW = 140, badgeH = 200, bGap = 16;
      const perRow = 5;
      const showCount = Math.min(badgeAch.length, 12);
      const rows2 = Math.ceil(showCount / perRow);
      const rowW = Math.min(badgeAch.length, perRow) * badgeW + (Math.min(badgeAch.length, perRow) - 1) * bGap;
      let startBX = (W - rowW) / 2;
      badgeAch.slice(0, 12).forEach((b, bi) => {
        const col = bi % perRow;
        const row = Math.floor(bi / perRow);
        // 本行宝贝数（最后一行居中）
        const inRow = Math.min(perRow, badgeAch.length - row * perRow);
        const thisRowW = inRow * badgeW + (inRow - 1) * bGap;
        const rowBX = (W - thisRowW) / 2;
        const bx = rowBX + col * (badgeW + bGap);
        const by = 455 + row * (badgeH + 20);

        // 徽章卡：渐变底
        const bg2 = ctx.createLinearGradient(bx, 0, bx + badgeW, 0);
        bg2.addColorStop(0, bi % 2 ? "#b8860b" : "#a06b2c");
        bg2.addColorStop(1, bi % 2 ? "#d4a96a" : "#c9a15a");
        ctx.fillStyle = bg2;
        roundRect(ctx, bx, by, badgeW, badgeH, 20);
        ctx.fill();
        // 圆形图标区（更大）
        ctx.fillStyle = "rgba(255,255,255,.22)";
        ctx.beginPath();
        ctx.arc(bx + badgeW / 2, by + 60, 42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "46px serif";
        ctx.textAlign = "center";
        const icon = b.tierResolved && b.tierResolved.current ? b.tierResolved.current.icon : b.icon;
        ctx.fillText(icon, bx + badgeW / 2, by + 76);
        // 名称（大）
        const name = b.tierResolved && b.tierResolved.current ? b.tierResolved.current.name : b.name;
        ctx.font = "bold 24px 'PingFang SC','Microsoft YaHei',sans-serif";
        ctx.fillText(String(name).slice(0, 6), bx + badgeW / 2, by + 130);
        ctx.font = "18px 'PingFang SC','Microsoft YaHei',sans-serif";
        ctx.fillStyle = "rgba(255,255,255,.75)";
        ctx.fillText("已解锁", bx + badgeW / 2, by + 162);
      });
      // 徽章区高度
      factsY = 455 + rows2 * (badgeH + 20) + 30;
    } else {
      ctx.fillStyle = "#8a7a68";
      ctx.font = "26px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("（在设置里选择要展示的徽章）", W / 2, 480);
    }

    // 有趣发现（居中卡片式）
    ctx.fillStyle = "#3d2b1f";
    ctx.font = "bold 34px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("有 趣 发 现", W / 2, factsY);
    let fy = factsY + 55;
    facts.slice(0, 6).forEach((f) => {
      // 发现条目卡片
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, 60, fy - 32, W - 120, 58, 12);
      ctx.fill();
      ctx.fillStyle = "#3d2b1f";
      ctx.font = "26px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(f.icon + " " + String(f.text).slice(0, 20), 90, fy);
      fy += 78;
    });

    // 落款
    ctx.fillStyle = "rgba(61,43,31,.45)";
    ctx.font = "26px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText((username ? username + " @ " : "") + "我的收藏馆", W / 2, H - 60);

    return canvas;
  }

  /* 分享海报（优先系统分享，否则下载） */
  async function shareCanvas(canvas, filename) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: "image/jpeg" })] })) {
      try {
        await navigator.share({
          files: [new File([blob], filename, { type: "image/jpeg" })],
          title: "文玩手串收藏馆",
        });
        return "shared";
      } catch (e) { /* 用户取消 */ }
    }
    downloadCanvas(canvas, filename);
    return "downloaded";
  }

  window.Poster = { singlePoster, galleryPoster, achievementPoster, downloadCanvas, shareCanvas };
})();