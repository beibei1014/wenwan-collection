/* =========================================================
 * color.js — 手串主色调自动识别 + 颜色分类
 * 分析照片中心区域的主色，映射到常见颜色类别
 * 提供：detectColor / COLOR_LIST / colorLabel / colorDot / detectFromSource
 * ========================================================= */
(function () {
  "use strict";

  // 颜色类别（绿/黄/棕/黑/红/花/白/紫/蓝/其他）
  var COLOR_LIST = [
    { v: "green", label: "绿色", hex: "#4caf50" },
    { v: "yellow", label: "黄色", hex: "#fbc02d" },
    { v: "brown", label: "棕色", hex: "#8d6e4a" },
    { v: "black", label: "黑色", hex: "#263238" },
    { v: "red", label: "红色", hex: "#e53935" },
    { v: "white", label: "白色", hex: "#f5f5f5" },
    { v: "purple", label: "紫色", hex: "#8e24aa" },
    { v: "blue", label: "蓝色", hex: "#1976d2" },
    { v: "mixed", label: "花色", hex: "mix" },
    { v: "other", label: "其他", hex: "#9e9e9e" },
  ];
  var COLOR_MAP = {};
  COLOR_LIST.forEach(function (c) { COLOR_MAP[c.v] = c; });

  function colorLabel(v) { return (COLOR_MAP[v] || {}).label || "其他"; }
  function colorHex(v) { return (COLOR_MAP[v] || {}).hex || "#9e9e9e"; }

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
    for (var y = y0; y < y1; y += 2) {
      for (var x = x0; x < x1; x += 2) {
        var i = (y * cw + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    if (!n) return null;
    r /= n; g /= n; b /= n;
    return classifyRgb(r, g, b);
  }

  function classifyRgb(r, g, b) {
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
    if (sat < 0.22) {
      if (l > 0.7) return "white";
      if (l < 0.35) return "black";
      return "other";
    }
    if (l < 0.2) return "black";
    if (h >= 15 && h < 45) return (l > 0.55 && sat > 0.4) ? "yellow" : "brown";
    if (h >= 45 && h < 75) return l > 0.5 ? "yellow" : "brown";
    if (h >= 75 && h < 165) return "green";
    if (h >= 165 && h < 255) return "blue";
    if (h >= 255 && h < 290) return "purple";
    if (h >= 290 || h < 15) return "red";
    return "other";
  }

  async function detectFromSource(src) {
    try { var img = await loadImg(src); return detectCenterColor(img); }
    catch (e) { return null; }
  }

  async function detectColor(src) { return await detectFromSource(src); }

  window.Color = { detectColor: detectColor, detectFromSource: detectFromSource, detectCenterColor: detectCenterColor, classifyRgb: classifyRgb, COLOR_LIST: COLOR_LIST, colorLabel: colorLabel, colorHex: colorHex };
})();