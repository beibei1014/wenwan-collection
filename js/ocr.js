/* =========================================================
 * ocr.js — 订单截图识别（可选增强）
 * 按需从 CDN 加载 Tesseract.js + 中文语言包；
 * 支持：淘宝/闲鱼/微信/小红书 等格式，以及一屏多订单拆分。
 * ========================================================= */
(function () {
  "use strict";

  let _tesseract = null;
  let _loading = false;

  const TESS_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const LANG = "chi_sim";

  function ensureTesseract() {
    return new Promise((resolve, reject) => {
      if (_tesseract) return resolve(_tesseract);
      if (_loading) {
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (_tesseract) { clearInterval(iv); resolve(_tesseract); }
          else if (Date.now() - t0 > 120000) { clearInterval(iv); reject(new Error("加载超时")); }
        }, 200);
        return;
      }
      _loading = true;
      if (typeof Tesseract !== "undefined") {
        _tesseract = Tesseract;
        _loading = false;
        return resolve(_tesseract);
      }
      const s = document.createElement("script");
      s.src = TESS_CDN;
      s.onload = () => {
        _tesseract = window.Tesseract;
        _loading = false;
        resolve(_tesseract);
      };
      s.onerror = () => { _loading = false; reject(new Error("OCR 库加载失败，请检查网络")); };
      document.head.appendChild(s);
    });
  }

  /* 识别图片 → 纯文本 */
  async function recognize(blob, onProgress) {
    const T = await ensureTesseract();
    const worker = await T.createWorker(LANG, 1, {
      logger: (m) => { if (onProgress && m.status === "recognizing text") onProgress(m.progress); },
    });
    const { data } = await worker.recognize(blob);
    await worker.terminate();
    return data.text || "";
  }

  /* ---------- 多订单拆分 ---------- */

  // 平台名（不作为店铺名）
  const PLATFORMS = /^(微信支付|支付宝|淘宝|天猫|闲鱼|京东|拼多多|小红书|抖音|快手|唯品会|苏宁|美团|饿了么)$/;

  // 价格匹配：¥1280 / ￥1280 / 1280.00 元 / 实付款 1280
  function matchPrice(line) {
    let m = line.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
    if (m) return parseFloat(m[1]);
    m = line.match(/(?:实付|实付款|合计|成交价|价格|金额|总价|共|现价|到手价)[^\d¥￥]{0,6}(\d+(?:\.\d{1,2})?)/);
    if (m) return parseFloat(m[1]);
    m = line.match(/^(\d+(?:\.\d{1,2})?)\s*元$/);
    if (m) return parseFloat(m[1]);
    return null;
  }

  function hasPrice(line) {
    return matchPrice(line) != null && /[¥￥]|元|实付|价格|金额|合计|成交/.test(line);
  }

  // 日期提取：2024-01-15 / 2024年1月15日 / 2024.1.15 / 下单时间：...
  function matchDate(line) {
    let m = line.match(/(?:下单时间|成交时间|付款时间|创建时间|拍下时间|购买时间|订单时间)[^\d]{0,6}(\d{4})[年.\-/](\d{1,2})[月.\-/](\d{1,2})/);
    if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    m = line.match(/(\d{4})[年.\-/](\d{1,2})[月.\-/](\d{1,2})/);
    if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    return null;
  }

  // 从一行中提取店铺名（关键词后内容，或整行作为店名）
  function extractShop(line) {
    const kws = ["店铺名", "店铺", "卖家", "来自店铺", "商家", "购买店铺", "收款方", "收款人", "转账给", "小店"];
    for (const kw of kws) {
      if (line.includes(kw)) {
        let m = line.replace(new RegExp("^.*?" + kw), "").replace(/^[:：\s]+/, "").replace(/["""」』】]/g, "").trim();
        m = m.replace(PLATFORMS, "").trim();
        m = m.replace(/^[:：]\s*/, "").trim();
        if (m && m.length >= 2 && m.length <= 30 && !/[¥￥]/.test(m) && !m.includes("元")) return m;
      }
    }
    return "";
  }

  /* 主解析：文本 → 订单数组 */
  function parseOrders(text) {
    if (!text) return [];
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    // 第一步：找到所有"价格行"作为订单锚点
    const priceIdx = [];
    lines.forEach((l, i) => { if (hasPrice(l)) priceIdx.push(i); });

    // 如果没有任何价格锚点，整段当一个订单试解析
    if (!priceIdx.length) {
      const single = parseSingleOrder(lines);
      return single && (single.shop || single.name || single.price) ? [single] : [];
    }

    const orders = [];
    // 对每个价格锚点，向上找店铺/商品，向下找日期
    for (let k = 0; k < priceIdx.length; k++) {
      const pi = priceIdx[k];
      const nextPi = k + 1 < priceIdx.length ? priceIdx[k + 1] : lines.length;
      // 块起点：从上一个价格锚点之后开始（避免把前一订单的内容包进来）
      const prevEnd = k > 0 ? priceIdx[k - 1] + 1 : 0;
      const blockStart = Math.max(prevEnd, pi - 8);

      const block = lines.slice(blockStart, Math.min(lines.length, nextPi));
      const order = parseSingleOrder(block);
      // 去重：如果与上一个订单信息几乎相同（同一价格+店铺），跳过
      const last = orders[orders.length - 1];
      if (last && order.price != null && last.price === order.price && last.shop === order.shop) {
        continue;
      }
      orders.push(order);
    }
    return orders;
  }

  /* 单订单块解析（一块文本 → {shop, price, date, name}） */
  function parseSingleOrder(lines) {
    const out = { shop: "", price: null, date: "", name: "" };
    if (!lines || !lines.length) return out;

    // 价格：块内第一个价格
    for (const l of lines) {
      const p = matchPrice(l);
      if (p != null) { out.price = p; break; }
    }

    // 日期：块内第一个日期
    for (const l of lines) {
      const d = matchDate(l);
      if (d) { out.date = d; break; }
    }

    // 店铺：优先关键词行
    for (const l of lines) {
      const s = extractShop(l);
      if (s) { out.shop = s; break; }
    }
    // 店铺兜底：价格行上方 1-4 行内的短行（含"店/铺/坊/斋/堂/工作室"等文玩常见后缀）
    if (!out.shop) {
      const pi = lines.findIndex((l) => matchPrice(l) != null);
      const start = Math.max(0, pi - 4);
      for (let i = start; i < pi; i++) {
        const l = lines[i];
        if (l.length >= 2 && l.length <= 24 && !hasPrice(l) && !matchDate(l) &&
            !PLATFORMS.test(l) && !/[¥￥]/.test(l) && !l.includes("元") && !/订单号|订单编号|物流|发货|售后|退款/.test(l)) {
          const cand = l.replace(/^[:：]\s*/, "");
          if (cand.length >= 2 && cand.length <= 24 && (cand.includes("店") || cand.includes("铺") || cand.includes("坊") || cand.includes("斋") || cand.includes("堂") || cand.includes("室") || cand.includes("工作室") || cand.includes("文玩") || cand.includes("珠宝") || cand.includes("玉") || cand.includes("串") || cand.includes("珠") || cand.includes("工坊") || cand.includes("精选") || cand.includes("严选") || cand.includes("官方") || cand.includes("旗舰"))) {
            out.shop = cand;
            break;
          }
        }
      }
    }

    // 商品名：价格行上方最近的非店铺长行；或包含"商品/宝贝/标题/名称"关键词的行
    const pi = lines.findIndex((l) => matchPrice(l) != null);
    for (const kw of ["商品名称", "商品", "宝贝标题", "宝贝", "标题", "名称"]) {
      const idx = lines.findIndex((l) => l.includes(kw) && !hasPrice(l));
      if (idx >= 0) {
        const line = lines[idx];
        const afterColon = line.split(/[:：]/).slice(1).join(":").trim();
        const cand = afterColon || (lines[idx + 1] || "");
        if (cand.length >= 4 && cand.length <= 50 && !cand.includes("￥") && !cand.includes("¥") && !cand.includes("元") && !matchDate(cand)) {
          out.name = cand;
          break;
        }
      }
    }
    if (!out.name && pi >= 0) {
      // 价格行上方找商品名（跳过店铺行）
      for (let i = pi - 1; i >= Math.max(0, pi - 6); i--) {
        const l = lines[i];
        if (l.length >= 5 && l.length <= 50 && !hasPrice(l) && !matchDate(l) &&
            !/[¥￥]/.test(l) && !l.includes("元") && !PLATFORMS.test(l) &&
            !/订单号|订单编号|物流|发货|售后|退款|状态|时间/.test(l)) {
          if (out.shop && l === out.shop) continue;
          // 若该行看起来像店名（短+含店/铺），跳过；否则作为商品名
          if (l.length >= 5) { out.name = l; break; }
        }
      }
    }

    // 名字清理：去掉常见前缀
    if (out.name) {
      out.name = out.name.replace(/^(已付款|已下单|订单详情|购买成功|待发货|待收货|已完成|交易成功)/, "").trim();
    }
    return out;
  }

  // 兼容旧调用：返回单个订单（取第一个）
  function parseOrder(text) {
    const arr = parseOrders(text);
    return arr.length ? arr[0] : { shop: "", price: null, date: "", name: "" };
  }

  window.OCR = { recognize, parseOrder, parseOrders };
})();