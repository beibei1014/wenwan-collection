/* =========================================================
 * color.js — 手串主色调自动识别 + 颜色分类
 * 颜色类别（按浅→深排序，排序直接依赖此顺序）：
 * 白/原生态 > 绿 > 黄棕 > 黑灰 > 多宝/敦煌 > 浅花 > 深花
 * 提供：detectColor / COLOR_LIST / colorLabel / colorHex / normColor
 * ========================================================= */
(function () {
  "use strict";

  // 颜色类别（顺序 = 浅→深，用于排序）
  var COLOR_LIST = [
    { v: "white",       label: "白/原生态", hex: "#f0ead8" },
    { v: "green",       label: "绿",        hex: "#4caf50" },
    { v: "yellowbrown", label: "黄棕",      hex: "#c69c4e" },
    { v: "blackgray",   label: "黑灰",      hex: "#3c4043" },
    { v: "duo",         label: "多宝/敦煌", hex: "#b06bd9" },
    { v: "lightflower", label: "浅花",      hex: "#dfa36a" },
    { v: "deepflower",  label: "深花",      hex: "#7a4a2b" },
  ];
  var COLOR_MAP = {};
  COLOR_LIST.forEach(function (c) { COLOR_MAP[c.v] = c; });

  // 旧颜色值 → 新类别 的兼容映射
  var OLD_TO_NEW = {
    "yellow": "yellowbrown", "brown": "yellowbrown", "amber": "yellowbrown",
    "black": "blackgray", "gray": "blackgray", "grey": "blackgray",
    "red": "deepflower", "purple": "duo", "blue": "duo", "mixed": "duo",
    "green": "green", "white": "white",
  };

  function colorLabel(v) { return (COLOR_MAP[v] || {}).label || "未分色"; }
  function colorHex(v) { return (COLOR_MAP[v] || {}).hex || "#9e9e9e"; }
  // 归一化颜色（旧值映射到新类别）
  function normColor(v) {
    if (!v) return v;
    if (COLOR_MAP[v]) return v;
    return OLD_TO_NEW[v] || "";
  }

  function loadImg(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("加载失败")); };
      img.src = src;
    });
  }

  function detectCenterColor(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    var cv = document.createElement("canvas");
    var scale = Math.min(1, 100 / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    cv.width = cw; cv.height = ch;
    var c = cv.getContext("2d");
    c.drawImage(img, 0, 0, cw, ch);
    var data;
    try { data = c.getImageData(0, 0, cw, ch).data; } catch (e) { return null; }
    var x0 = Math.floor(cw * 0.19), x1 = Math.floor(cw * 0.81);
    var y0 = Math.floor(ch * 0.19), y1 = Math.floor(ch * 0.81);
    var r = 0, g = 0, b = 0, n = 0;
    // 记录颜色多样性（标准差近似）
    var r2 = 0, g2 = 0, b2 = 0;
    for (var y = y0; y < y1; y += 2) {
      for (var x = x0; x < x1; x += 2) {
        var i = (y * cw + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2];
        r2 += data[i] * data[i]; g2 += data[i + 1] * data[i + 1]; b2 += data[i + 2] * data[i + 2];
        n++;
      }
    }
    if (!n) return null;
    r /= n; g /= n; b /= n;
    // 颜色方差（多样性）：色相分散大 → 花/多宝
    var variance = (r2 / n - r * r) + (g2 / n - g * g) + (b2 / n - b * b) / 1;
    var spread = Math.sqrt(Math.max(0, variance)) / 255; // 0~1 越大约杂
    return classifyRgb(r, g, b, spread);
  }

  function classifyRgb(r, g, b, spread) {
    var rn = r / 255, gn = g / 255, bn = b / 255;
    var max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    var l = (max + min) / 2;
    var sat = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
    var h = 0;
    if (max !== min) {
      if (max === rn) h = ((gn - bn) / (max - min)) % 6;
      else if (max === gn) h = (bn - rn) / (max - min) + 2;
      else h = (rn - gn) / (max - min) + 4;
      h = (h * 60 + 360) % 360;
    }

    // 颜色分散度大 → 花 / 多宝
    if (spread && spread > 0.14) {
      // 多层次颜色：亮浅→浅花；含黑/深→深花；鲜艳多彩→多宝
      if (sat > 0.45 && l > 0.4) return "duo";        // 鲜艳多彩 → 多宝/敦煌
      return l > 0.5 ? "lightflower" : "deepflower";   // 按亮度分浅花/深花
    }

    // 低饱和：白或黑灰
    if (sat < 0.24) {
      if (l > 0.68) return "white";
      if (l < 0.42) return "blackgray";
    }
    if (l < 0.22) return "blackgray";

    // 高亮度低饱和→白；否则按色相
    if (h >= 15 && h < 45) return "yellowbrown";   // 黄～棕
    if (h >= 45 && h < 75) return "yellowbrown";   // 黄
    if (h >= 75 && h < 165) return "green";        // 绿
    // 红/蓝/紫/温暖色 → 归多宝或黄棕：暖色偏黄棕/深花，冷色偏多宝
    if (l > 0.5) return "duo";
    return "deepflower";
  }

  async function detectFromSource(src) {
    try { var img = await loadImg(src); return detectCenterColor(img); }
    catch (e) { return null; }
  }

  async function detectColor(src) { return await detectFromSource(src); }

  window.Color = { detectColor: detectColor, detectFromSource: detectFromSource, detectCenterColor: detectCenterColor, classifyRgb: classifyRgb, COLOR_LIST: COLOR_LIST, colorLabel: colorLabel, colorHex: colorHex, normColor: normColor };
})();