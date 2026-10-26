/* 股析 StockInsight — 公共逻辑：导航 / 格式化 / 数据加载 */
(function () {
  "use strict";

  const NAV_ITEMS = [
    { href: "index.html", label: "首页" },
    { href: "library.html", label: "报告库" },
    { href: "market.html", label: "市场概览" },
    { href: "citic.html", label: "中信多空" },
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
  // 防御：root 可能是 null 或不具备 querySelectorAll 的对象
  const $$ = (sel, root) => {
    const ctx = root || document;
    return ctx && typeof ctx.querySelectorAll === "function"
      ? Array.from(ctx.querySelectorAll(sel))
      : [];
  };

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
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", () => {
        toggle.setAttribute("aria-expanded", String(el.classList.toggle("open")));
      });
      // 点击菜单项后自动收起
      el.addEventListener("click", (e) => {
        if (e.target.closest(".nav-link")) {
          el.classList.remove("open");
          toggle.setAttribute("aria-expanded", "false");
        }
      });
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
  // opts.noCache = true：跳过内存缓存并追加时间戳参数，用于定时刷新时拿最新数据
  // 注意缓存 key 始终用原始 url，避免时间戳导致缓存无限增长
  async function loadJSON(url, opts) {
    const noCache = !!(opts && opts.noCache);
    if (!noCache && jsonCache[url]) return jsonCache[url];
    const reqUrl = noCache
      ? url + (url.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now()
      : url;
    const res = await fetch(reqUrl, { cache: "no-store" });
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

  /* ---------- 兼容性与兜底 ---------- */
  const UA = navigator.userAgent || "";
  const isWeChat = /MicroMessenger/i.test(UA);
  if (isWeChat) document.documentElement.classList.add("is-wechat");

  // 旧内核探测：无可选链支持时打标，便于 CSS 降级
  try {
    new Function("a?.b"); // eslint-disable-line no-new-func
  } catch (e) {
    document.documentElement.classList.add("legacy-webview");
  }

  // 把骨架屏替换为可读提示，避免用户面对无限加载动画
  function replaceSkeletons(msg) {
    let n = 0;
    $$(".skeleton").forEach((el) => {
      if (el.dataset.failed) return;
      el.dataset.failed = "1";
      el.classList.remove("skeleton");
      el.style.height = "auto";
      el.style.minHeight = "56px";
      el.textContent = msg;
      n++;
    });
    return n;
  }

  function failHint(msg) {
    const replaced = replaceSkeletons(msg || "页面加载异常，请重试或在系统浏览器中打开。");
    if (replaced > 0 && isWeChat && !document.getElementById("si-wechat-tip")) {
      const tip = document.createElement("div");
      tip.id = "si-wechat-tip";
      tip.textContent = "微信内置浏览器兼容性有限，建议点右上角「···」在浏览器中打开";
      document.body.appendChild(tip);
    }
  }

  // 脚本解析错误 / 脚本加载失败：旧内核语法不兼容时 render.js 整文件失效，靠这里兜底
  window.addEventListener("error", (e) => {
    const fromScript = !!(e.error && e.error instanceof Error) ||
      !!(e.target && e.target.tagName === "SCRIPT");
    if (!fromScript) return;
    console.error("[SI] script error:", e.message || e.target.src);
    failHint();
  }, true);

  // 看门狗：12 秒后仍是骨架屏（如请求挂起）则提示
  setTimeout(() => {
    if (document.querySelector(".skeleton")) failHint("加载超时，请检查网络后重试。");
  }, 12000);

  /* JSONP 请求：用于跨域调用支持 callback 参数的接口（如东方财富数据中心），绕过浏览器 CORS */
  function loadJSONP(url, opts) {
    opts = opts || {};
    const name = "si_jsonp_" + Math.random().toString(36).slice(2);
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    const target = url + sep + "callback=" + name + "&_=" + Date.now();
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true; cleanup();
        reject(new Error("JSONP 请求超时"));
      }, opts.timeout || 15000);
      function cleanup() {
        try { delete window[name]; } catch (e) {}
        if (script && script.parentNode) script.parentNode.removeChild(script);
        clearTimeout(timer);
      }
      window[name] = function (data) {
        if (done) return;
        done = true; cleanup();
        resolve(data);
      };
      const script = document.createElement("script");
      script.src = target;
      script.onerror = function () {
        if (done) return;
        done = true; cleanup();
        reject(new Error("JSONP 脚本加载失败"));
      };
      (document.head || document.body).appendChild(script);
    });
  }

  window.SI = {
    $, $$, loadJSON, loadJSONP, fmtPrice, fmtPct, pctClass, fmtVolume, fmtMoney,
    ratingBadge, sentimentBadge, marketBadge, basePath, MARKET_LABEL,
    isWeChat, failHint,
  };
})();
