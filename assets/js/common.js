/* 股析 StockInsight — 公共逻辑：导航 / 格式化 / 数据加载 */
(function () {
  "use strict";

  const NAV_ITEMS = [
    { href: "index.html", label: "首页" },
    { href: "library.html", label: "报告库" },
    { href: "market.html", label: "市场概览" },
    { href: "about.html", label: "关于" },
  ];

  const RATING_META = {
    "买入": { cls: "rating-buy" },
    "增持": { cls: "rating-add" },
    "中性": { cls: "rating-neutral" },
    "减持": { cls: "rating-reduce" },
  };

  const SENTIMENT_META = {
    positive: { label: "利好", cls: "rating-buy" },
    neutral: { label: "中性", cls: "rating-neutral" },
    negative: { label: "利空", cls: "rating-reduce" },
  };

  const MARKET_LABEL = { CN: "A股", US: "美股" };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function currentPage() {
    const path = location.pathname.split("/").pop();
    return path === "" ? "index.html" : path;
  }

  function renderNav() {
    const page = currentPage();
    const el = $("#nav-links");
    if (!el) return;
    el.innerHTML = NAV_ITEMS.map(
      (it) =>
        `<a class="nav-link${it.href === page ? " active" : ""}" href="${it.href}">${it.label}</a>`
    ).join("");
    const toggle = $("#nav-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => el.classList.toggle("open"));
    }
  }

  function fmtPrice(v, currency) {
    if (v == null) return "—";
    const digits = currency === "USD" ? 2 : 2;
    return v.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtPct(v) {
    if (v == null) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }

  function pctClass(v) {
    if (v == null) return "flat";
    return v > 0 ? "up" : v < 0 ? "down" : "flat";
  }

  function fmtVolume(v) {
    if (v == null) return "—";
    if (v >= 1e8) return (v / 1e8).toFixed(2) + " 亿";
    if (v >= 1e4) return (v / 1e4).toFixed(1) + " 万";
    return String(v);
  }

  function fmtMoney(v, currency) {
    if (v == null) return "—";
    const unit = currency === "USD" ? "亿美元" : "亿元";
    return v.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + " " + unit;
  }

  function ratingBadge(rating) {
    const meta = RATING_META[rating] || RATING_META["中性"];
    return `<span class="badge ${meta.cls}"><span class="dot"></span>${rating}</span>`;
  }

  function sentimentBadge(s) {
    const meta = SENTIMENT_META[s] || SENTIMENT_META.neutral;
    return `<span class="badge ${meta.cls}"><span class="dot"></span>${meta.label}</span>`;
  }

  function marketBadge(market) {
    return `<span class="badge market-${market}">${MARKET_LABEL[market] || market}</span>`;
  }

  const jsonCache = {};
  async function loadJSON(url) {
    if (jsonCache[url]) return jsonCache[url];
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`加载失败: ${url} (${res.status})`);
    const data = await res.json();
    jsonCache[url] = data;
    return data;
  }

  function renderFooter() {
    const el = $("#footer");
    if (!el) return;
    const year = new Date().getFullYear();
    el.innerHTML = `
      <div class="container footer-inner">
        <span>股析 StockInsight · 由 CodeBuddy 生成的静态股票分析报告站</span>
        <span>数据来源：同花顺 iFinD · 仅供研究参考，不构成投资建议 · © ${year}</span>
      </div>`;
  }

  function basePath() {
    // 仓库发布在 /stock/ 下，资源引用统一加前缀
    const p = location.pathname;
    return p.replace(/(index|library|report|market|about)\.html.*$/, "").replace(/[^/]*$/, "");
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderNav();
    renderFooter();
  });

  window.SI = {
    $, $$, loadJSON, fmtPrice, fmtPct, pctClass, fmtVolume, fmtMoney,
    ratingBadge, sentimentBadge, marketBadge, basePath, MARKET_LABEL,
  };
})();
