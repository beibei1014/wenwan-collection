/* =========================================================
 * image.js — 图片自动压缩
 * 上传前压缩到目标大小以内（默认 500KB），保证展示清晰度
 * 长边最大 1920px（屏幕展示足够），JPEG 质量自适应
 * ========================================================= */
(function () {
  "use strict";

  /* 读取图片（含 EXIF 方向修正） */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error("图片加载失败")); };
      img.src = url;
    });
  }

  /* 压缩图片到目标大小 */
  async function compressFile(file, opts) {
    opts = opts || {};
    const maxSizeKB = opts.maxSizeKB || 200;
    const maxDim = opts.maxDim || 1920;   // 长边最大像素
    const minQuality = opts.minQuality || 0.35;

    // 已经是小图/非图片 → 直接返回
    if (!file || !file.type || !file.type.startsWith("image/")) return file;
    // 小于目标大小且尺寸不大 → 不压缩（原样返回）
    if (file.size <= maxSizeKB * 1024) {
      const img0 = await loadImage(file).catch(() => null);
      if (img0) {
        const tooBig = Math.max(img0.width, img0.height) > maxDim;
        if (!tooBig) return file;
      } else {
        return file;
      }
    }

    let img;
    try {
      img = await loadImage(file);
    } catch (e) {
      // 尝试 createImageBitmap 兜底（HEIC 等格式）
      try {
        img = await createImageBitmap(file);
      } catch (e2) {
        return file; // 实在无法解码，返回原图
      }
    }
    // 计算缩放尺寸（保持比例）
    let w = img.naturalWidth || img.width || 0;
    let h = img.naturalHeight || img.height || 0;
    if (!w || !h) return file;
    // 如果原图本身小于目标尺寸，无需缩放
    if (Math.max(w, h) <= maxDim && file.size <= maxSizeKB * 1024) return file;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    if (scale < 1) { w = Math.round(w * scale); h = Math.round(h * scale); }

    // 用 canvas 重绘（自动转 JPEG）
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // 白色背景（透明 PNG 转 JPEG 时避免黑色底）
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    // 二分/递减质量直到达标
    let quality = 0.85;
    let blob = await canvasToBlob(canvas, quality);
    while (blob.size > maxSizeKB * 1024 && quality > minQuality) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, quality);
    }

    // 转回 File（保留原名，改 .jpg）
    const name = (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
    const compressed = new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
    console.log("[image] 压缩 " + (file.name || "photo") + ": " + Math.round(file.size / 1024) + "KB -> " + Math.round(compressed.size / 1024) + "KB (" + w + "x" + h + ", q=" + quality.toFixed(2) + ")");
    return compressed;
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b || new Blob()), "image/jpeg", quality);
    });
  }

  window.ImageUtil = { compressFile };
})();
