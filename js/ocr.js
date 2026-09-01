/* =========================================================
 * ocr.js — 订单截图识别（可选增强）
 * 按需从 CDN 加载 Tesseract.js + 中文语言包；
 * 识别后尽力提取：店铺名、价格、日期、商品名，返回给表单填充。
 * ========================================================= */
(function () {
  "use strict";

  let _tesseract = null;
  let _worker = null;
  let _loading = false;

  const TESS_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const LANG = "chi_sim";

  function ensureTesseract(onProgress) {
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

  async function getWorker() {
    if (_worker) return _worker;
    const T = await ensureTesseract();
    _worker = await T.createWorker(LANG, 1, {
      logger: (m) => { if (m.status === "recognizing text") window.dispatchEvent(new CustomEvent("ocr-progress", { detail: m.progress })); },
    });
    return _worker;
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

  /* 从文本中尽力提取字段 */
  function parseOrder(text) {
    const out = { shop: "", price: null, date: "", name: "" };
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    // 店铺：常见关键词后跟店名（含微信/支付宝收款方）
    const shopKws = ["店铺名", "店铺", "卖家", "来自店铺", "商家", "购买店铺", "收款方", "收款人", "转账给"];
    for (const kw of shopKws) {
      const line = lines.find((l) => l.includes(kw) && !l.includes("平台"));
      if (line) {
        let m = line.replace(new RegExp("^.*?" + kw), "").replace(/^[:：]\s*/, "").trim();
        // 过滤平台名与无意义值
        m = m.replace(/^微信支付$|^支付宝$|^淘宝$|^闲鱼$|^转账$/, "").trim();
        if (m && m.length < 30 && !m.includes("￥") && !m.includes("¥") && !m.includes("元")) { out.shop = m; break; }
      }
    }
    if (!out.shop) {
      // 有的订单截图第一行就是店名（跳过平台名/金额行/日期行）
      for (const l of lines.slice(0, 4)) {
        const clean = l.replace(/^[:：]\s*/, "").trim();
        if (clean.length >= 3 && clean.length <= 20 && !clean.includes("元") && !clean.includes("￥") && !clean.includes("¥") &&
            !/\d{4}[-/年]/.test(clean) && !/^(微信支付|支付宝|淘宝|闲鱼|京东|拼多多)$/.test(clean)) {
          out.shop = clean;
          break;
        }
      }
    }

    // 价格：实付款/实付/合计/价格/￥/¥
    const priceRe = /(?:实付|实付款|合计|成交价|价格|金额|总价|共)[^\d¥￥]{0,6}[¥￥]?\s*(\d+(?:\.\d{1,2})?)/;
    const pm = text.match(priceRe);
    if (pm) out.price = parseFloat(pm[1]);
    if (out.price == null) {
      const m2 = text.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
      if (m2) out.price = parseFloat(m2[1]);
    }

    // 日期：下单时间/成交时间/付款时间/2024年/2024-xx-xx
    const dateRe = /(?:下单时间|成交时间|付款时间|创建时间|拍下时间|购买时间)[^\d]{0,4}(\d{4})[年.\-/](\d{1,2})[月.\-/](\d{1,2})/;
    const dm = text.match(dateRe);
    if (dm) out.date = dm[1] + "-" + dm[2].padStart(2, "0") + "-" + dm[3].padStart(2, "0");
    if (!out.date) {
      const m2 = text.match(/(\d{4})[年.\-/](\d{1,2})[月.\-/](\d{1,2})/);
      if (m2) out.date = m2[1] + "-" + m2[2].padStart(2, "0") + "-" + m2[3].padStart(2, "0");
    }

    // 商品名：优先取关键词行冒号后的内容；否则下一行；否则最长行
    for (const kw of ["商品名称", "商品", "宝贝标题", "宝贝", "标题", "名称", "订单详情"]) {
      const idx = lines.findIndex((l) => l.includes(kw));
      if (idx >= 0) {
        const line = lines[idx];
        const afterColon = line.split(/[:：]/).slice(1).join(":").trim();
        const cand = afterColon || (lines[idx + 1] || "");
        if (cand.length >= 4 && cand.length <= 40 && !cand.includes("￥") && !cand.includes("¥")) {
          out.name = cand;
          break;
        }
      }
    }
    if (!out.name) {
      const long = lines.filter((l) => l.length >= 8 && l.length <= 40 && !/\d{4}[-/年]/.test(l) && !l.includes("￥") && !l.includes("¥") && !l.includes("实付") && !l.includes("成交"));
      if (long.length) out.name = long[0];
    }

    return out;
  }

  window.OCR = { recognize, parseOrder };
})();