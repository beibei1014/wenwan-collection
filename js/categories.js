/* =========================================================
 * categories.js — 分类 → 品种/材质/品牌 联动配置
 * 选择分类后，品种/材质输入框自动填充对应选项（可自由修改）
 * ========================================================= */
(function () {
  "use strict";

  // 分类 → 选项列表（datalist）
  // 字段说明：field = "species"（品种材质）或 "brand"（品牌/IP）
  const CATEGORY_CONFIG = {
    "菩提": {
      field: "species",
      label: "品种/材质",
      options: ["菩提根", "星月菩提", "金刚菩提", "凤眼菩提", "千眼菩提", "菩提根·白玉", "紫金鼠", "椰壳", "象牙果", "核桃", "橄榄核", "菩提根·老料"]
    },
    "水晶": {
      field: "species",
      label: "品种",
      options: ["白水晶", "粉晶", "紫水晶", "黄水晶", "茶晶", "发晶", "幽灵水晶", "草莓晶", "月光石", "石榴石", "黑曜石", "玛瑙", "碧玺", "海蓝宝"]
    },
    "玉石": {
      field: "species",
      label: "玉种",
      options: ["和田玉", "翡翠", "南红玛瑙", "绿松石", "蜜蜡", "琥珀", "玛瑙", "岫玉", "独山玉", "黄龙玉", "青金石"]
    },
    "拼图": {
      field: "brand",
      label: "品牌",
      options: [
        "TOI图益", "猫的天空之城", "肯研DREAM FRIEND", "3D-JP", "蓝兔子Blue Rabbit", "Kasi卡西", "申侯SHENHOU", "云图", "拾光拼图", "纸居",
        "HEYE", "Ravensburger", "Educa", "Clementoni", "Galison", "Jumbo", "Art Puzzle", "Pomegranate", "Springbok", "Epoch", "Tenyo", "Mudpuppy", "NYPC", "SunsOut", "Eurographics", "Schmidt"
      ]
    },
    "动漫周边": {
      field: "accessory",
      label: "周边类型",
      options: ["手办", "吧唧", "镭射卡", "立牌", "亚克力挂件", "徽章", "色纸", "海报", "毛绒", "一番赏", "谷子", "粘土人", "景品"]
    },
    "盲盒": {
      field: "brand",
      label: "IP/系列",
      options: ["泡泡玛特", "Skullpanda", "Dimoo", "Molly", "LABUBU", "Hirono", "PUCKY", "Sadness", "Crybaby", "Sonny Angel", "52TOYS", "寻找独角兽"]
    }
  };

  // 通用分类（无预设选项）
  const DEFAULT_FIELD = "species";
  const DEFAULT_LABEL = "品种/材质";

  /* 获取分类配置 */
  function getCategoryConfig(category) {
    const cfg = CATEGORY_CONFIG[category] || { field: DEFAULT_FIELD, label: DEFAULT_LABEL, options: [] };
    // 尺寸字段：拼图→pieces，动漫周边/盲盒→none，其他珠子类→bead
    if (category === "拼图") cfg.sizeField = "pieces";
    else if (category === "动漫周边" || category === "盲盒") cfg.sizeField = "none";
    else cfg.sizeField = "bead";
    return cfg;
  }

  /* 判断是否品牌类分类（拼图/动漫周边/盲盒） */
  function isBrandCategory(category) {
    const f = getCategoryConfig(category).field;
    return f === "brand" || f === "accessory";
  }

  /* 是否需要拼图完成时间 */
  function isPuzzleCategory(category) {
    return category === "拼图";
  }

  /* 生成品种/材质输入框的 datalist 选项 */
  function speciesOptionsHtml(category, selected) {
    const cfg = getCategoryConfig(category);
    let h = "";
    const list = cfg.options.length ? cfg.options : ["其他", "自定义"];
    list.forEach((s) => {
      h += '<option value="' + esc2(s) + '"' + (selected === s ? "" : "") + ">";
    });
    return h;
  }

  function esc2(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.Categories = { getCategoryConfig, isBrandCategory, isPuzzleCategory, speciesOptionsHtml, getSizeField: (c) => getCategoryConfig(c).sizeField };
})();
