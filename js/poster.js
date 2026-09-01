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
  async function galleryPoster(items) {
    const count = Math.min(items.length, 12);
    const cols = 3;
    const rows = Math.ceil(count / cols);
    const cardW = 320, cardH = 430, gap = 36;
    const padX = 60, padTop = 160, padBottom = 140;
    const W = padX * 2 + cols * cardW + (cols - 1) * gap;
    const H = padTop + rows * cardH + (rows - 1) * gap + padBottom;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#f7f1e6");
    bg.addColorStop(1, "#ead9c0");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 顶部标题
    ctx.fillStyle = "#3d2b1f";
    ctx.font = "bold 52px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("我的文玩收藏图鉴", W / 2, 90);
    ctx.fillStyle = "#b8860b";
    ctx.font = "30px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("共 " + count + " 件藏品 · " + (opts && opts.username ? opts.username + " @ " : "") + "我的收藏馆", W / 2, 138);

    // 绘制每个卡片
    for (let i = 0; i < count; i++) {
      const item = items[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padX + col * (cardW + gap);
      const y = padTop + row * (cardH + gap);

      // 卡片背景
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, x, y, cardW, cardH, 18);
      ctx.fill();

      // 照片（上半部分）
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
        ctx.font = "90px serif";
        ctx.textAlign = "center";
        ctx.fillText("📿", x + cardW / 2, y + 14 + (cardW - 28) / 2 + 35);
      }

      // 名称
      ctx.fillStyle = "#3d2b1f";
      ctx.font = "bold 30px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(escText(item.name || "未命名").slice(0, 8), x + cardW / 2, y + cardW + 8 + 34);

      // 珠子大小
      ctx.fillStyle = "#b8860b";
      ctx.font = "26px 'PingFang SC','Microsoft YaHei',sans-serif";
      const bead = item.beadSize ? item.beadSize + "mm" : "";
      ctx.fillText(bead || (item.species || "").slice(0, 6), x + cardW / 2, y + cardW + 8 + 74);
    }

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
    const W = 1080, H = 1920;
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

    // 等级称号卡
    ctx.fillStyle = "#3d2b1f";
    roundRect(ctx, 70, 160, W - 140, 130, 20);
    ctx.fill();
    ctx.fillStyle = "#f5f0e8";
    ctx.font = "28px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(lv.icon + " " + lv.name + "  Lv." + lv.level, 110, 210);
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.font = "22px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(lv.xp + " XP · " + "已解锁成就 " + achievements.reduce((s,g)=>s+g.unlockedCount,0) + " 个", 110, 250);

    // 徽章区
    const badgeIds = opts.badgeIds || [];
    const badgeAch = [];
    achievements.forEach((g) => g.items.forEach((a) => { if (a.unlocked && badgeIds.includes(a.id)) badgeAch.push(a); }));
    if (badgeAch.length) {
      ctx.fillStyle = "#8a7a68";
      ctx.font = "24px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("我的徽章", 90, 350);
      let bx = 90;
      badgeAch.slice(0, 8).forEach((b) => {
        ctx.fillStyle = "#b8860b";
        roundRect(ctx, bx, 370, 110, 110, 14);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "44px serif";
        ctx.textAlign = "center";
        const name = b.tierResolved && b.tierResolved.current ? b.tierResolved.current.name : b.name;
        ctx.fillText(b.tierResolved && b.tierResolved.current ? b.tierResolved.current.icon : b.icon, bx + 55, 425);
        ctx.font = "16px 'PingFang SC','Microsoft YaHei',sans-serif";
        ctx.fillText(String(name).slice(0, 6), bx + 55, 460);
        bx += 124;
      });
    }

    // 有趣发现
    ctx.fillStyle = "#8a7a68";
    ctx.font = "24px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("有趣发现", 90, 560);
    let fy = 600;
    facts.slice(0, 5).forEach((f) => {
      ctx.fillStyle = "#3d2b1f";
      ctx.font = "24px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.fillText(f.icon + " " + String(f.text).slice(0, 24), 90, fy);
      fy += 44;
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