/* 股析 StockInsight — 页面渲染逻辑 */
(function () {
  "use strict";
  const { $, $$, loadJSON, fmtPrice, fmtPct, pctClass, fmtVolume, fmtMoney,
    ratingBadge, sentimentBadge, marketBadge } = window.SI;

  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* 报告卡片：数据源为 index.json 条目（不含 price_series，迷你走势懒加载） */
  function reportCardHTML(r, idx) {
    return `
    <a class="card card-hover report-card stagger-item" style="animation-delay:${idx * 60}ms"
       href="report.html#${encodeURIComponent(r.id)}">
      <div class="card-top">
        <div>
          <div class="stock-name">${esc(r.name)}</div>
          <div class="stock-symbol">${esc(r.symbol)} · ${esc(r.industry)}</div>
        </div>
        <div class="price-line">
          <div class="price">${fmtPrice(r.price, r.currency)}</div>
          <div class="chg ${pctClass(r.change_pct)}">${fmtPct(r.change_pct)}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${marketBadge(r.market)}${ratingBadge(r.rating)}${r.deep ? '<span class="badge" style="color:var(--gray-700)">深度</span>' : ""}</div>
      <div class="cover">${esc(r.cover)}</div>
      <div class="spark" data-report="${esc(r.id)}"></div>
      <div class="card-foot"><span>${esc(r.as_of)} 收盘</span><span>查看报告 →</span></div>
    </a>`;
  }

  /* 迷你走势懒加载：仅对进入视口且数量受限的卡片拉取单份报告 JSON */
  function lazySparks(scope, limit) {
    const cards = $$("[data-report]", scope).filter((el) => !el.dataset.loaded);
    if (!cards.length) return;
    const queue = cards.slice(0, limit || 24);
    if (!("IntersectionObserver" in window)) { queue.forEach(loadSpark); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        loadSpark(en.target);
      });
    }, { rootMargin: "120px" });
    queue.forEach((el) => io.observe(el));

    async function loadSpark(el) {
      if (el.dataset.loaded) return;
      el.dataset.loaded = "1";
      try {
        const rep = await loadJSON(`reports/${el.dataset.report}.json`);
        const closes = rep.price_series.map((d) => d.close).slice(-40).join(",");
        el.dataset.spark = closes;
        window.SICharts.initSparklines();
      } catch (e) { /* 迷你图失败不影响卡片主体 */ }
    }
  }

  async function initIndex() {
    if (!$("#report-grid")) return;
    try {
      const all = await loadJSON("reports/index.json");
      const reports = all.slice(0, 12);
      $("#report-grid").innerHTML = reports.map(reportCardHTML).join("");
      $("#stat-reports").textContent = all.length;
      const stocks = new Set(all.map((r) => r.symbol + r.market));
      $("#stat-stocks").textContent = stocks.size;
      // 雷达监控数（取雷达数据的 monitored 字段）
      try {
        const radar = await loadJSON("data/radar.json");
        $("#stat-radar").textContent = radar.monitored || "—";
      } catch (e) { /* 雷达数据缺失时忽略 */ }
      lazySparks($("#report-grid"), 12);
    } catch (e) {
      $("#report-grid").innerHTML = `<div class="empty-state">报告加载失败：${esc(e.message)}</div>`;
    }
  }

  /* ---------- 股票雷达：重点股票突发新闻 ---------- */
  const RADAR_FILTERS = [
    { key: "all", label: "全部" },
    { key: "突发", label: "突发" },
    { key: "利好", label: "利好" },
    { key: "利空", label: "利空" },
    { key: "公告", label: "公告" },
    { key: "实时", label: "实时" },
  ];

  const RADAR_REFRESH_MS = 60000;    // 实时新闻同步周期
  const RADAR_SNAP_MS = 5 * 60000;   // 快照（radar.json）重取间隔
  const RADAR_LIVE_SIZE = 12;        // 单次拉取的实时条数
  const RADAR_STORE_KEY = "si.radar.stock";
  // 东方财富新闻搜索：带 CORS 头，返回值包在 JSONP 里，取回后剥壳解析
  const NEWS_SEARCH_API = "https://search-api-web.eastmoney.com/search/jsonp";

  // 美股代码为纯字母，用于修正数据中偶发的 market 标记错误
  const isUSCode = (code) => /^[A-Za-z][A-Za-z.\-]*$/.test(String(code || ""));
  const stripHTML = (s) => String(s === null || s === undefined ? "" : s)
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  const normKey = (s) => String(s === null || s === undefined ? "" : s)
    .replace(/[\s"'“”‘’·,，.。、;；:：!！?？()（）\[\]【】《》<>—\-_/\\|]/g, "").toLowerCase();

  // 兼容 "2026-10-24" 与 "2026-10-27 09:20" 两种日期，统一成本地时间戳
  function radarTime(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || ""));
    if (!m) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
  }

  function clockLabel(d) {
    const x = d || new Date();
    const p = (n) => ("0" + n).slice(-2);
    return p(x.getHours()) + ":" + p(x.getMinutes()) + ":" + p(x.getSeconds());
  }

  function readSavedStock() {
    try { return sessionStorage.getItem(RADAR_STORE_KEY) || ""; } catch (e) { return ""; }
  }
  function saveStock(code) {
    try { sessionStorage.setItem(RADAR_STORE_KEY, code); } catch (e) { /* 隐私模式忽略 */ }
  }

  async function fetchLiveNews(stock) {
    const keyword = isUSCode(stock.code) ? stock.code : stock.name + " " + stock.code;
    const q = {
      uid: "",
      keyword: keyword,
      type: ["cmsArticleWebOld"],
      client: "web",
      clientType: "web",
      clientVersion: "curr",
      param: {
        cmsArticleWebOld: {
          searchScope: "default", sort: "time", pageIndex: 1,
          pageSize: RADAR_LIVE_SIZE, preTag: "", postTag: "",
        },
      },
    };
    const url = NEWS_SEARCH_API + "?cb=si&param=" + encodeURIComponent(JSON.stringify(q));
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("实时接口 " + res.status);
    const text = await res.text();
    const wrapped = /^[^(]*\(([\s\S]*)\)\s*;?\s*$/.exec(text.trim());
    const data = JSON.parse(wrapped ? wrapped[1] : text);
    if (!data || data.code !== 0) throw new Error((data && data.msg) || "实时接口返回异常");
    const rows = (data.result && data.result.cmsArticleWebOld) || [];
    const name = String(stock.name || "");
    const code = String(stock.code || "");
    const lcCode = code.toLowerCase();
    return rows.map((r) => {
      const dt = String(r.date || "").slice(0, 16).replace("T", " ");
      return {
        id: "live:" + (r.code || r.url || r.title),
        title: stripHTML(r.title),
        summary: stripHTML(r.content),
        stock_code: code,
        stock_name: name,
        market: stock.market,
        date: dt,
        sentiment: "neutral",
        tags: ["实时"],
        source: r.mediaName || "东方财富",
        url: r.url || "",
        has_report: !!stock.reportId,
        report_id: stock.reportId || "",
        live: true,
      };
    }).filter((it) => {
      const hay = it.title + it.summary;
      return it.title && (hay.indexOf(name) >= 0 || hay.toLowerCase().indexOf(lcCode) >= 0);
    });
  }

  function radarItemHTML(it, isNew) {
    const market = isUSCode(it.stock_code) ? "US" : it.market;
    const cls = it.sentiment === "negative" ? "is-negative"
      : it.sentiment === "positive" ? "is-positive" : "";
    const tags = (it.tags || []).map((t) => {
      const tc = t === "利空" ? "tag-neg"
        : t === "利好" ? "tag-pos"
          : t === "突发" ? "tag-hot"
            : t === "实时" ? "tag-live" : "";
      return `<span class="ri-tag ${tc}">${esc(t)}</span>`;
    }).join("");
    const links = [];
    if (it.has_report && it.report_id) {
      links.push(`<a class="ri-report" href="report.html#${encodeURIComponent(it.report_id)}">查看报告 →</a>`);
    }
    if (it.url) {
      links.push(`<a class="ri-report" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(it.source || "原文")} ↗</a>`);
    }
    const sum = it.summary ? `<p class="ri-sum">${esc(it.summary)}</p>` : "";
    return `
   <article class="radar-item ${cls}${isNew ? " is-new" : ""}">
     <div class="ri-head">
       <span class="ri-stock">${marketBadge(market)}${esc(it.stock_name)}<span class="ri-code num">${esc(it.stock_code)}</span></span>
       <span class="ri-tags">${isNew ? '<span class="ri-new">NEW</span>' : ""}${tags}</span>
     </div>
     <h3 class="ri-title">${esc(it.title)}</h3>
     ${sum}
     <div class="ri-meta">
       <span class="num">${esc(it.date)}</span>
       <span class="ri-links">${links.join("")}</span>
     </div>
   </article>`;
  }

  async function initRadar() {
    const box = $("#radar-list");
    if (!box) return;

    const statusEl = $("#radar-status");
    const chipsEl = $("#radar-filters");
    const toolEl = $("#radar-toolbar");

    const state = {
      items: [],        // 快照条目（全部标的）
      meta: {},
      stocks: [],       // 下拉框里的标的
      selected: "",     // 当前选中标的代码
      live: [],         // 当前标的的实时新闻
      liveAt: "",       // 最近一次实时同步时刻
      fresh: {},        // 最近一次同步中新增的条目 id，渲染时打 NEW
      filter: "all",
      sig: "",          // 快照指纹：无变化则不重绘
      newCount: 0,
      stockLoaded: false, // 当前标的是否已完成首轮实时同步（避免切换标的时全部误标 NEW）
      timer: null,
      ticker: null,
      nextAt: 0,
      busy: false,
      pending: false,
      fail: 0,
      loaded: false,
      snapAt: 0,
    };

    /* 状态条：只构建一次，后续仅更新文本，避免闪烁与事件丢失 */
    let rsMain = null, rsTick = null, rsBtn = null;
    if (statusEl) {
      statusEl.innerHTML =
        '<span class="rs-main">正在接入雷达…</span>' +
        '<span class="rs-live"><i class="rs-dot"></i><span class="rs-tick">—</span></span>' +
        '<button type="button" class="rs-btn" id="radar-refresh-btn" aria-label="立即同步雷达">同步</button>';
      rsMain = $(".rs-main", statusEl);
      rsTick = $(".rs-tick", statusEl);
      rsBtn = $("#radar-refresh-btn");
      if (rsBtn) rsBtn.addEventListener("click", () => { refresh(true); });
    }

    /* 标的下拉框：一次只看一只标的，不再把全部新闻罗列出来 */
    let selectEl = null, hintEl = null;
    if (toolEl) {
      toolEl.innerHTML =
        '<label class="radar-picker"><span class="rp-label">监控标的</span>' +
        '<select id="radar-stock-select" aria-label="选择要查看的标的"></select></label>' +
        '<span class="radar-hint" id="radar-hint"></span>';
      selectEl = $("#radar-stock-select", toolEl);
      hintEl = $("#radar-hint", toolEl);
      if (selectEl) {
        selectEl.addEventListener("change", () => {
          state.selected = selectEl.value;
          saveStock(state.selected);
          state.live = [];
          state.liveAt = "";
          state.fresh = {};
          state.newCount = 0;
          state.stockLoaded = false;
          state.filter = "all";
          renderStatus();
          renderChips();
          renderList();
          refresh(true);
        });
      }
    }

    function currentStock() {
      const code = state.selected;
      for (let i = 0; i < state.stocks.length; i++) {
        if (state.stocks[i].code === code) return state.stocks[i];
      }
      return state.stocks[0] || null;
    }

    /* 同标的的快照条目 + 实时条目合并去重，按时间倒序 */
    function currentItems() {
      const stock = currentStock();
      if (!stock) return [];
      const seen = {};
      const out = [];
      const push = (it) => {
        const keys = [it.id, normKey(it.title)].filter(Boolean);
        if (!keys.length) return;
        for (let i = 0; i < keys.length; i++) if (seen[keys[i]]) return;
        keys.forEach((k) => { seen[k] = true; });
        out.push(it);
      };
      state.live.forEach(push);
      state.items.forEach((it) => {
        if ((it.stock_code || it.stock_name) === stock.code) push(it);
      });
      return out.sort((a, b) => radarTime(b.date) - radarTime(a.date));
    }

    function renderStockOptions() {
      if (!selectEl) return;
      const groups = { CN: [], US: [] };
      state.stocks.forEach((s) => { (s.market === "US" ? groups.US : groups.CN).push(s); });
      selectEl.innerHTML = ["CN", "US"].filter((m) => groups[m].length).map((m) =>
        `<optgroup label="${esc(window.SI.MARKET_LABEL[m] || m)}">` +
        groups[m].map((s) => `<option value="${esc(s.code)}">${esc(s.name)} ${esc(s.code)}</option>`).join("") +
        "</optgroup>").join("");
      if (state.selected) selectEl.value = state.selected;
    }

    function renderHint() {
      if (!hintEl) return;
      hintEl.textContent = `共 ${state.stocks.length} 只标的 · 当前 ${currentItems().length} 条动态`;
    }

    function renderStatus() {
      if (!rsMain) return;
      const stock = currentStock();
      const seg = [];
      seg.push(`监控 <b class="num">${state.meta.monitored || state.stocks.length}</b> 只重点标的`);
      seg.push(`快照 <b class="num">${state.items.length}</b> 条` +
        (state.meta.generated_at ? ` <span class="rs-sub">（${esc(state.meta.generated_at)}）</span>` : ""));
      if (stock) seg.push(`当前 <b>${esc(stock.name)}</b> 实时 <b class="num">${state.live.length}</b> 条`);
      if (state.liveAt) {
        seg.push(`<span class="rs-sub">同步于 <span class="num">${esc(state.liveAt)}</span></span>`);
      }
      if (state.newCount) seg.push(`<b class="rs-new">新增 ${state.newCount} 条</b>`);
      rsMain.innerHTML = seg.map((s) => `<span class="rs-seg">${s}</span>`).join("");
      renderHint();
    }

    function renderChips() {
      if (!chipsEl) return;
      const all = currentItems();
      const count = (key) => key === "all"
        ? all.length
        : all.filter((i) => (i.tags || []).indexOf(key) >= 0).length;
      const filters = RADAR_FILTERS.filter((f) => f.key === "all" || count(f.key) > 0);
      if (!filters.some((f) => f.key === state.filter)) state.filter = "all";
      chipsEl.innerHTML = filters.map((f) => `
        <button class="chip${state.filter === f.key ? " active" : ""}" data-filter="${f.key}">
          ${f.label}<span class="chip-cnt num">${count(f.key)}</span>
        </button>`).join("");
      $$("#radar-filters .chip", chipsEl).forEach((chip) => {
        chip.addEventListener("click", () => {
          state.filter = chip.dataset.filter;
          $$("#radar-filters .chip", chipsEl).forEach((c) =>
            c.classList.toggle("active", c === chip));
          renderList();
        });
      });
    }

    function renderList() {
      const all = currentItems();
      const list = state.filter === "all"
        ? all
        : all.filter((i) => (i.tags || []).indexOf(state.filter) >= 0);
      if (!list.length) {
        box.innerHTML = `<div class="empty-state">${all.length ? "该分类下暂无动态" : "该标的近期暂无动态"}</div>`;
        return;
      }
      // 有新条目插到顶部会顶高列表，滚动位置在列表下方时补偿，保持视口内容不动
      const hasNew = Object.keys(state.fresh).length > 0;
      const topAbs = box.getBoundingClientRect().top + window.pageYOffset;
      const h0 = box.offsetHeight;
      box.innerHTML = list.map((it) => radarItemHTML(it, !!state.fresh[it.id])).join("");
      const delta = box.offsetHeight - h0;
      if (hasNew && delta > 0 && window.pageYOffset > topAbs) {
        window.scrollTo(0, window.pageYOffset + delta);
      }
    }

    function applySnapshot(d) {
      const items = d.items || [];
      const sig = (d.generated_at || "") + "|" + items.map((i) => i.id).join(",");
      if (sig === state.sig) return;
      state.items = items;
      state.sig = sig;
      state.meta = {
        monitored: d.monitored,
        window_days: d.window_days,
        generated_at: d.generated_at,
      };
      state.stocks = buildStocks(items);
      const exists = state.selected && state.stocks.some((s) => s.code === state.selected);
      if (!exists) {
        state.selected = pickDefaultStock(state.stocks);
        state.live = [];
        state.liveAt = "";
        state.stockLoaded = false;
      }
      renderStockOptions();
      renderHint();
      renderStatus();
      renderChips();
      renderList();
    }

    function applyLive(rows) {
      const prev = {};
      state.live.forEach((it) => { prev[it.id] = true; });
      const fresh = {};
      let added = 0;
      if (state.stockLoaded) {
        rows.forEach((it) => {
          if (!prev[it.id]) { fresh[it.id] = true; added++; }
        });
      }
      state.live = rows;
      state.fresh = fresh;
      state.newCount = state.stockLoaded ? added : 0;
      state.liveAt = clockLabel();
      state.stockLoaded = true;
      renderStatus();
      renderChips();
      renderList();
    }

    function setTick(text, failed) {
      if (!rsTick) return;
      rsTick.textContent = text;
      if (rsTick.parentNode) rsTick.parentNode.classList.toggle("is-failed", !!failed);
    }

    function countdown() {
      if (state.busy || !rsTick) return;
      const left = Math.max(0, Math.round((state.nextAt - Date.now()) / 1000));
      setTick(state.fail ? `实时同步失败，${left}s 后重试` : `实时同步 ${left}s 后`, !!state.fail);
    }

    function schedule() {
      clearTimeout(state.timer);
      // 失败后指数退避，上限 5 分钟
      const wait = state.fail
        ? Math.min(RADAR_REFRESH_MS * Math.pow(2, state.fail), 300000)
        : RADAR_REFRESH_MS;
      state.nextAt = Date.now() + wait;
      state.timer = setTimeout(() => { refresh(false); }, wait);
      countdown();
    }

    async function refresh(manual) {
      if (state.busy) {
        // 同步进行中又切换了标的 / 点了同步：本轮结束后补一次
        if (manual) state.pending = true;
        return;
      }
      state.busy = true;
      if (rsBtn) {
        rsBtn.disabled = true;
        rsBtn.classList.add("is-busy");
        rsBtn.textContent = "同步中";
      }
      if (manual) setTick("正在同步…", false);
      try {
        // 1) 快照：首次、手动同步、或超过 5 分钟才重取
        if (!state.loaded || manual || Date.now() - state.snapAt > RADAR_SNAP_MS) {
          const d = await loadJSON("data/radar.json", { noCache: true });
          applySnapshot(d);
          state.snapAt = Date.now();
        }
        state.loaded = true;
        // 2) 实时：只拉当前标的，保证每次同步都有新数据
        const stock = currentStock();
        if (stock) {
          try {
            const rows = await fetchLiveNews(stock);
            state.fail = 0;
            applyLive(rows);
          } catch (e) {
            state.fail++;
          }
        }
      } catch (e) {
        state.fail++;
        if (!state.loaded) {
          box.innerHTML = `<div class="empty-state">雷达快照暂未生成，将自动重试。</div>`;
        }
      } finally {
        state.busy = false;
        if (rsBtn) {
          rsBtn.disabled = false;
          rsBtn.classList.remove("is-busy");
          rsBtn.textContent = "同步";
        }
        schedule();
        if (state.pending) { state.pending = false; refresh(true); }
      }
    }

    // 标签页隐藏时停止轮询，回到前台立即补刷一次
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearTimeout(state.timer);
        clearInterval(state.ticker);
        state.ticker = null;
      } else {
        refresh(false);
        if (!state.ticker) state.ticker = setInterval(countdown, 1000);
      }
    });

    await refresh(false);
    if (!state.ticker) state.ticker = setInterval(countdown, 1000);
  }

  /* 快照条目 → 下拉框标的清单（按最近动态时间排序） */
  function buildStocks(items) {
    const map = {};
    items.forEach((it) => {
      const code = it.stock_code || it.stock_name;
      if (!code) return;
      const market = isUSCode(code) ? "US" : (it.market || "CN");
      let s = map[code];
      if (!s) {
        s = map[code] = { code, name: it.stock_name || code, market, count: 0, score: 0, latest: 0, reportId: "" };
      }
      s.count++;
      if ((it.score || 0) > s.score) s.score = it.score || 0;
      const t = radarTime(it.date);
      if (t > s.latest) {
        s.latest = t;
        if (it.has_report && it.report_id) s.reportId = it.report_id;
      }
    });
    return Object.keys(map).map((k) => map[k])
      .sort((a, b) => (b.latest - a.latest) || (b.count - a.count));
  }

  /* 默认选中：上次选过的标的，否则取快照里分数最高的（最热的）那只 */
  function pickDefaultStock(stocks) {
    const saved = readSavedStock();
    if (saved && stocks.some((s) => s.code === saved)) return saved;
    let best = stocks[0] || null;
    stocks.forEach((s) => {
      if ((s.score || 0) > ((best && best.score) || 0)) best = s;
    });
    return best ? best.code : "";
  }

  async function initMarket() {
    if (!$("#index-grid")) return;
    try {
      const data = await loadJSON("data/market.json");
      $("#index-grid").innerHTML = data.indices.map((ix) => `
        <div class="card market-card">
          <div class="m-name">${esc(ix.name)}</div>
          <div class="m-val num">${ix.close.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="m-chg num ${pctClass(ix.change_pct)}">${fmtPct(ix.change_pct)}</div>
        </div>`).join("");
      $("#market-asof").textContent = data.as_of;
    } catch (e) {
      $("#index-grid").innerHTML = `<div class="empty-state">行情加载失败：${esc(e.message)}</div>`;
    }
  }

  const LIB_PAGE_SIZE = 50;
  const LIB_SIDE_LIMIT = 40;   // 侧边栏每个市场最多展示的标的数

  async function initLibrary() {
    if (!$("#lib-list")) return;
    let all = [];
    try {
      all = await loadJSON("reports/index.json");
    } catch (e) {
      $("#lib-list").innerHTML = `<div class="empty-state">报告加载失败：${esc(e.message)}</div>`;
      return;
    }

    const state = { stock: null, market: "ALL", q: "", page: 1 };

    // 侧边栏：按市场分组 → 股票（限量展示，全量请用搜索）
    const byMarket = {};
    all.forEach((r) => { (byMarket[r.market] = byMarket[r.market] || []).push(r); });
    const groups = Object.keys(byMarket).filter((m) => byMarket[m].length);
    $("#lib-sidebar").innerHTML = groups.map((m) => {
      const list = byMarket[m];
      const byStock = {};
      list.forEach((r) => { (byStock[r.symbol] = byStock[r.symbol] || []).push(r); });
      const entries = Object.keys(byStock)
        .map((sym) => ({ sym, rs: byStock[sym] }))
        .sort((a, b) => (a.rs[0].date < b.rs[0].date ? 1 : -1));
      const shown = entries.slice(0, LIB_SIDE_LIMIT);
      const hidden = entries.length - shown.length;
      const items = shown.map((e) => `
        <button class="side-item" data-stock="${esc(e.sym)}" data-market="${m}">
          <span>${esc(e.rs[0].name)} <span style="color:var(--color-text-3);font-size:11px">${esc(e.sym)}</span></span>
          <span class="cnt">${e.rs.length}</span>
        </button>`).join("");
      const more = hidden > 0
        ? `<div class="side-more">另有 ${hidden} 只标的，请用上方搜索</div>` : "";
      // 桌面端默认展开分组；移动端默认收起，避免侧边栏在列表上方占满首屏
      const openDesktop = window.matchMedia("(min-width: 641px)").matches ? " open" : "";
      return `<details class="side-group"${openDesktop}>
        <summary class="group-head"><span>${window.SI.MARKET_LABEL[m] || m}</span><span class="count">${list.length}</span></summary>
        ${items}${more}
      </details>`;
    }).join("");

    const rows = () => {
      let list = all.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      if (state.market !== "ALL") list = list.filter((r) => r.market === state.market);
      if (state.stock) list = list.filter((r) => r.symbol === state.stock);
      if (state.q) {
        const q = state.q.toLowerCase();
        list = list.filter((r) =>
          r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q) ||
          (r.cover || "").toLowerCase().includes(q));
      }
      return list;
    };

    const pager = (total, page) => {
      const pages = Math.max(1, Math.ceil(total / LIB_PAGE_SIZE));
      const cur = Math.min(Math.max(1, page), pages);
      let nums = "";
      const from = Math.max(1, cur - 2), to = Math.min(pages, cur + 2);
      if (from > 1) nums += `<button class="pg-btn" data-page="1">1</button>` + (from > 2 ? '<span class="pg-gap">…</span>' : "");
      for (let i = from; i <= to; i++) nums += `<button class="pg-btn${i === cur ? " active" : ""}" data-page="${i}">${i}</button>`;
      if (to < pages) nums += (to < pages - 1 ? '<span class="pg-gap">…</span>' : "") + `<button class="pg-btn" data-page="${pages}">${pages}</button>`;
      return `
        <div class="lib-pager" id="lib-pager">
          <span class="pg-info num">共 ${total} 份 · 第 ${cur}/${pages} 页</span>
          <div class="pg-controls">
            <button class="pg-btn" data-page="${cur - 1}"${cur <= 1 ? " disabled" : ""}>上一页</button>
            ${nums}
            <button class="pg-btn" data-page="${cur + 1}"${cur >= pages ? " disabled" : ""}>下一页</button>
          </div>
        </div>`;
    };

    const renderRows = () => {
      const list = rows();
      if (!list.length) {
        $("#lib-list").innerHTML = `<div class="empty-state">没有符合条件的报告</div>`;
        $("#lib-pager-wrap").innerHTML = "";
        return;
      }
      const pages = Math.max(1, Math.ceil(list.length / LIB_PAGE_SIZE));
      if (state.page > pages) state.page = pages;
      const start = (state.page - 1) * LIB_PAGE_SIZE;
      const pageItems = list.slice(start, start + LIB_PAGE_SIZE);
      $("#lib-list").innerHTML = pageItems.map((r) => `
        <a class="card card-hover report-row" href="report.html#${encodeURIComponent(r.id)}">
          <div class="row-main">
            <div class="row-title">
              <span class="nm">${esc(r.name)}</span>
              <span style="color:var(--color-text-3);font-size:12px" class="num">${esc(r.symbol)}</span>
              ${marketBadge(r.market)}${ratingBadge(r.rating)}${r.deep ? '<span class="badge" style="color:var(--gray-700)">深度</span>' : ""}
            </div>
            <div class="row-cover">${esc(r.cover)}</div>
          </div>
          <div class="row-side">
            <div class="num" style="font-weight:700">${fmtPrice(r.price, r.currency)}</div>
            <div class="num ${pctClass(r.change_pct)}" style="font-size:13px">${fmtPct(r.change_pct)}</div>
            <div class="row-date num">${esc(r.date)}</div>
          </div>
        </a>`).join("");
      $("#lib-pager-wrap").innerHTML = pager(list.length, state.page);
      $$("#lib-pager .pg-btn").forEach((btn) => {
        if (btn.disabled) return;
        btn.addEventListener("click", () => {
          const p = parseInt(btn.dataset.page, 10);
          if (!isNaN(p)) { state.page = p; renderRows(); }
        });
      });
    };

    $$("#lib-sidebar .side-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sym = btn.dataset.stock;
        state.stock = state.stock === sym ? null : sym;
        state.page = 1;
        $$("#lib-sidebar .side-item").forEach((b) =>
          b.classList.toggle("active", b.dataset.stock === state.stock));
        renderRows();
      });
    });

    $$(".chip[data-market]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.market = chip.dataset.market;
        state.page = 1;
        $$(".chip[data-market]").forEach((c) => c.classList.toggle("active", c === chip));
        renderRows();
      });
    });

    $("#lib-search").addEventListener("input", (e) => {
      state.q = e.target.value.trim();
      state.page = 1;
      renderRows();
    });

    renderRows();
  }

  async function initReport() {
    // 必须加页面守卫：本函数在每个页面都会被执行，
    // 若无 #report-body 也继续走，就会对所有页面触发跳转，导致 library.html 无限重定向自身
    if (!$("#report-body")) return;
    // 优先取 hash（微信等环境会剥离 query 参数，hash 更可靠），并兼容旧的 ?id= 形式
    const hashId = (location.hash || "").replace(/^#/, "");
    const id = hashId || new URLSearchParams(location.search).get("id");
    if (!id) { location.replace("library.html"); return; }
    let r;
    try {
      r = await loadJSON(`reports/${id}.json`);
    } catch (e) {
      $("#report-body").innerHTML = `<div class="empty-state">报告不存在或加载失败：${esc(id)}</div>`;
      return;
    }
    document.title = `${r.name} 分析报告 · 股析 StockInsight`;

    const ind = r.indicators;
    const fin = r.financials;
    const ccy = r.overview.currency;
    // 兼容旧版 WebView（微信 X5 等 Chromium < 80 内核）：不使用可选链与空值合并运算符
    const nz = (v, d) => (v === null || v === undefined ? d : v);
    const md = ind.macd || {};
    // 深度分析模块（旧报告无此字段，对应章节自动隐藏）
    const da = r.deep_analysis || null;
    const gm = da ? da.gross_margin : null;
    const sectionTabs = ["概览", "行情走势", "技术指标"];
    if (gm) sectionTabs.push("盈利能力与毛利率");
    sectionTabs.push("财务摘要");
    if (da && da.valuation) sectionTabs.push("估值与情景");
    if (da && da.risks) sectionTabs.push("风险与证伪");
    sectionTabs.push("新闻公告", "AI 结论");

    const riskLevelCls = (lv) => {
      const s = String(lv || "");
      if (s.indexOf("高") === 0) return "risk-high";
      if (s.indexOf("中高") === 0) return "risk-midhigh";
      return "risk-mid";
    };
    const scenarioCls = (name) => {
      const s = String(name || "");
      if (s.indexOf("乐观") === 0) return "scn-bull";
      if (s.indexOf("悲观") === 0) return "scn-bear";
      return "scn-base";
    };

    /* ---------- 深度分析章节片段 ---------- */
    // 概览：治理与筹码
    const governanceCardsHTML = (da && da.governance) ? `
          <div class="kv"><div class="k">实际控制人</div><div class="v" style="font-size:var(--text-base)">${esc(da.governance.controller)} <small>${esc(da.governance.controller_ratio)}%</small></div></div>
          <div class="kv"><div class="k">前十大股东合计</div><div class="v num">${esc(da.governance.top10_ratio)}<small>%</small></div></div>
          <div class="kv"><div class="k">机构持股比例</div><div class="v num">${esc(da.governance.institutional_ratio)}<small>%</small></div></div>
          <div class="kv"><div class="k">股东户数变动</div><div class="v num ${da.governance.shareholder_change_pct > 50 ? "up" : "flat"}">${esc(da.governance.shareholder_change_pct)}<small>%</small></div></div>
    ` : "";

    // 盈利能力与毛利率（核心章节）
    const gmSectionHTML = gm ? `
      <section class="card panel" id="sec-盈利能力与毛利率">
        <div class="panel-head">
          <h2>盈利能力与毛利率</h2>
          <span class="hint">${esc(gm.trend === "contracting" ? "毛利率趋势下行" : gm.trend === "expanding" ? "毛利率趋势上行" : "毛利率趋势平稳")} · 区间 ${esc(gm.range_low)}% — ${esc(gm.range_high)}%</span>
        </div>

        <h3 class="sub-head">个股毛利率趋势</h3>
        <div class="chart-line" id="gm-trend-chart" role="img" aria-label="${esc(r.name)} 单季毛利率趋势图"></div>
        <p class="chart-note">实线为单季毛利率（由累计口径拆算），虚线为年度毛利率参考位</p>

        <h3 class="sub-head">同业对比</h3>
        <div class="metric-switch" id="gm-metric-switch" role="group" aria-label="对比指标切换">
          <button class="chip active" data-metric="value">毛利率</button>
          <button class="chip" data-metric="net_margin">净利率</button>
          <button class="chip" data-metric="roe">ROE</button>
          <button class="chip" data-metric="pb">PB</button>
        </div>
        <div class="chart-line" id="gm-peer-chart" role="img" aria-label="同业指标对比图"></div>
        <p class="chart-note">深色柱为 ${esc(r.name)}，浅色柱为可比公司</p>

        <h3 class="sub-head">毛利率变动归因</h3>
        <ul class="attr-list">
          ${gm.attribution ? Object.keys(gm.attribution).map((k, i) => {
            const tags = ["主因", "次因", "补充"];
            return `<li><span class="attr-tag">${tags[i] || "补充"}</span><span>${esc(gm.attribution[k])}</span></li>`;
          }).join("") : ""}
        </ul>
        <p class="analysis-summary">${esc(gm.note || "")}</p>
      </section>
    ` : "";

    // 财务摘要：资产负债与盈利质量
    const balanceSheetCardsHTML = (da && da.balance_sheet) ? (() => {
      const b = da.balance_sheet;
      const kv = (k, v, unit, cls) => `          <div class="kv"><div class="k">${k}</div><div class="v num ${cls || ""}">${esc(v)}<small>${unit}</small></div></div>`;
      return `
        <h3 class="sub-head">资产负债与盈利质量</h3>
        <div class="kv-grid">
${kv("货币资金", b.cash, "亿元")}
${kv("带息债务", b.interest_bearing_debt, "亿元")}
${kv("短期借款", b.short_term_debt, "亿元")}
${kv("应收账款", b.accounts_receivable, "亿元")}
${kv("应收 / 营收", b.receivable_to_revenue, "%")}
${kv("存货", b.inventory, "亿元")}
${kv("商誉", b.goodwill, "亿元")}
${kv("研发费用率", b.rd_ratio, "%")}
${kv("经营现金流", b.operating_cash_flow, "亿元", b.operating_cash_flow >= 0 ? "up" : "down")}
${kv("资产负债率", b.asset_liability_ratio, "%")}
        </div>`;
    })() : "";

    // 估值与情景
    const valuationSectionHTML = (da && da.valuation) ? `
      <section class="card panel" id="sec-估值与情景">
        <div class="panel-head"><h2>估值与情景</h2><span class="hint">同业估值对照 · 三档情景推演</span></div>
        <div class="kv-grid">
          <div class="kv"><div class="k">总市值</div><div class="v num">${esc(da.valuation.market_cap)}<small>亿元</small></div></div>
          <div class="kv"><div class="k">PB</div><div class="v num">${esc(da.valuation.pb)}<small>倍</small></div></div>
          <div class="kv"><div class="k">PS (TTM)</div><div class="v num">${esc(da.valuation.ps_ttm)}<small>倍</small></div></div>
          <div class="kv"><div class="k">同业 PB 区间</div><div class="v num">${esc((da.valuation.peer_pb_range || []).join(" — "))}<small>倍</small></div></div>
        </div>
        <div class="callout"><strong>估值倒推</strong>${esc(da.valuation.implied_assumption || "")}</div>
        <p class="analysis-summary">${esc(da.valuation.note || "")}</p>

        <h3 class="sub-head">三档情景</h3>
        <div class="scenario-grid">
          ${(da.scenarios || []).map((s) => `
            <div class="scn-card ${scenarioCls(s.name)}">
              <div class="scn-head"><span class="scn-name">${esc(s.name)}</span><span class="scn-upside num">${esc(s.upside)}</span></div>
              <div class="scn-row"><span class="scn-label">假设</span><p>${esc(s.assumption)}</p></div>
              <div class="scn-row"><span class="scn-label">估值</span><p>${esc(s.valuation)}</p></div>
            </div>`).join("")}
        </div>

        <h3 class="sub-head">催化剂日历</h3>
        <ul class="catalyst-list">
          ${(da.catalysts || []).map((c) => `<li>${esc(c)}</li>`).join("")}
        </ul>
      </section>
    ` : "";

    // 风险与证伪
    const riskSectionHTML = (da && da.risks) ? `
      <section class="card panel" id="sec-风险与证伪">
        <div class="panel-head"><h2>风险与证伪</h2><span class="hint">风险清单 · 逻辑证伪条件 · 关键跟踪指标</span></div>
        <div class="table-scroll">
          <table class="data-table risk-table">
            <thead><tr><th>风险类型</th><th>等级</th><th>说明</th></tr></thead>
            <tbody>
              ${da.risks.map((rk) => `
                <tr>
                  <td>${esc(rk.type)}</td>
                  <td><span class="risk-badge ${riskLevelCls(rk.severity)}">${esc(rk.severity)}</span></td>
                  <td class="risk-detail">${esc(rk.detail)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>

        <h3 class="sub-head">证伪条件（出现即应重新评估）</h3>
        <ul class="falsify-list">
          ${(da.falsification || []).map((f) => `<li>${esc(f)}</li>`).join("")}
        </ul>

        <h3 class="sub-head">关键跟踪指标</h3>
        <div class="table-scroll">
          <table class="data-table kpi-table">
            <thead><tr><th>跟踪指标</th><th>阈值 / 目标</th></tr></thead>
            <tbody>
              ${(da.kpi_tracking || []).map((k) => {
                const s = String(k);
                const i = s.indexOf("（");
                const name = i > 0 ? s.slice(0, i) : s;
                const thr = i > 0 ? s.slice(i) : "";
                return `<tr><td>${esc(name)}</td><td class="kpi-thr">${esc(thr)}</td></tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>
    ` : "";

    $("#report-body").innerHTML = `
      <header class="card stock-header">
        <div>
          <div class="sh-name">${esc(r.name)}</div>
          <div class="sh-symbol">${esc(r.symbol)} · ${esc(r.company.exchange)} · ${esc(r.company.full_name)}</div>
          <div class="sh-meta">
            ${marketBadge(r.market)}
            <span class="badge">${esc(r.company.industry)}</span>
            <span class="badge">上市 ${esc(r.company.listed_at)}</span>
            ${ratingBadge(r.analysis.rating)}
          </div>
        </div>
        <div class="sh-price">
          <div class="p num">${fmtPrice(r.overview.price, ccy)}</div>
          <div class="c num ${pctClass(r.overview.change_pct)}">${fmtPct(r.overview.change_pct)} · ${esc(r.overview.as_of)} 收盘</div>
        </div>
      </header>

      <nav class="section-tabs" id="section-tabs" aria-label="报告章节">
        ${sectionTabs.map((t) => `<button class="section-tab" data-target="sec-${encodeURIComponent(t)}">${t}</button>`).join("")}
      </nav>

      <section class="card panel" id="sec-概览">
        <div class="panel-head"><h2>概览</h2><span class="hint">生成于 ${esc(r.generated_at)}</span></div>
        <div class="kv-grid">
          <div class="kv"><div class="k">最新价</div><div class="v num">${fmtPrice(r.overview.price, ccy)} <small>${ccy}</small></div></div>
          <div class="kv"><div class="k">当日涨跌</div><div class="v num ${pctClass(r.overview.change_pct)}">${fmtPct(r.overview.change_pct)}</div></div>
          <div class="kv"><div class="k">PE (TTM)</div><div class="v num">${nz(fin.pe_ttm, "—")}</div></div>
          <div class="kv"><div class="k">PB</div><div class="v num">${nz(fin.pb, "—")}</div></div>
          <div class="kv"><div class="k">ROE</div><div class="v num">${nz(fin.roe, "—")}<small>%</small></div></div>
          <div class="kv"><div class="k">综合评级</div><div class="v" style="font-size:var(--text-lg)">${ratingBadge(r.analysis.rating)}</div></div>
${governanceCardsHTML}        </div>
        <p class="analysis-summary" style="margin-top:var(--space-5)">${esc(r.cover)}</p>
      </section>

      <section class="card panel" id="sec-行情走势">
        <div class="panel-head"><h2>行情走势</h2><span class="hint">近 ${r.price_series.length} 个交易日 · 日 K + 成交量</span></div>
        <div class="chart-kline" id="kline-chart" role="img" aria-label="${esc(r.name)} K线图"></div>
      </section>

      <section class="card panel" id="sec-技术指标">
        <div class="panel-head"><h2>技术指标</h2><span class="hint">基于日线收盘计算</span></div>
        <div class="kv-grid">
          <div class="kv"><div class="k">MA5</div><div class="v num">${nz(ind.ma5, "—")}</div></div>
          <div class="kv"><div class="k">MA20</div><div class="v num">${nz(ind.ma20, "—")}</div></div>
          <div class="kv"><div class="k">EMA20</div><div class="v num">${nz(ind.ema20, "—")}</div></div>
          <div class="kv"><div class="k">RSI 14</div><div class="v num">${nz(ind.rsi14, "—")}</div></div>
          <div class="kv"><div class="k">MACD DIF</div><div class="v num">${nz(md.dif, "—")}</div></div>
          <div class="kv"><div class="k">MACD DEA</div><div class="v num">${nz(md.dea, "—")}</div></div>
          <div class="kv"><div class="k">MACD 柱</div><div class="v num ${pctClass(md.hist)}">${nz(md.hist, "—")}</div></div>
          <div class="kv"><div class="k">区间振幅参考</div><div class="v num">${(() => {
            const cs = r.price_series.map((d) => d.close);
            const mx = Math.max(...cs), mn = Math.min(...cs);
            return ((mx - mn) / mn * 100).toFixed(1) + "%";
          })()}</div></div>
        </div>
      </section>

${gmSectionHTML}
      <section class="card panel" id="sec-财务摘要">
        <div class="panel-head"><h2>财务摘要</h2><span class="hint">${esc(fin.report_period || "最新报告期")}</span></div>
        <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>指标</th><th>数值</th><th>同比</th></tr></thead>
          <tbody>
            <tr><td>营业收入</td><td>${fmtMoney(fin.revenue, ccy)}</td><td class="${pctClass(fin.revenue_yoy)}">${fin.revenue_yoy == null ? "—" : fmtPct(fin.revenue_yoy)}</td></tr>
            <tr><td>净利润</td><td>${fmtMoney(fin.net_profit, ccy)}</td><td class="${pctClass(fin.net_profit_yoy)}">${fin.net_profit_yoy == null ? "—" : fmtPct(fin.net_profit_yoy)}</td></tr>
            <tr><td>ROE</td><td>${nz(fin.roe, "—")}%</td><td>—</td></tr>
            <tr><td>市盈率 PE(TTM)</td><td>${nz(fin.pe_ttm, "—")}</td><td>—</td></tr>
            <tr><td>市净率 PB</td><td>${nz(fin.pb, "—")}</td><td>—</td></tr>
          </tbody>
        </table>
        </div>
${balanceSheetCardsHTML}      </section>

${valuationSectionHTML}${riskSectionHTML}
      <section class="card panel" id="sec-新闻公告">
        <div class="panel-head"><h2>新闻公告</h2><span class="hint">近期相关资讯 · 情绪标注仅供参考</span></div>
        <div class="news-list">
          ${r.news.map((n) => `
            <div class="news-item">
              <div>
                <div class="n-title">${esc(n.title)}</div>
                <div class="n-sum">${esc(n.summary)}</div>
                <div class="n-meta"><span>${esc(n.source)}</span><span class="num">${esc(n.date)}</span></div>
              </div>
              <div class="n-sent">${sentimentBadge(n.sentiment)}</div>
            </div>`).join("")}
        </div>
      </section>

      <section class="card panel" id="sec-AI 结论">
        <div class="panel-head"><h2>AI 结论</h2><span class="hint">由 CodeBuddy 基于上述数据生成</span></div>
        <div class="analysis-rating">
          <span style="color:var(--color-text-3);font-size:var(--text-sm)">综合评级</span>
          <span class="big num">${esc(r.analysis.rating)}</span>
        </div>
        <p class="analysis-summary">${esc(r.analysis.summary)}</p>
        <div class="bull-bear">
          <div class="bb-col bull"><h3>多空要点 · 积极</h3><ul>${r.analysis.bull_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>
          <div class="bb-col bear"><h3>多空要点 · 风险</h3><ul>${r.analysis.bear_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>
        </div>
      </section>
    `;

    window.SICharts.initReportChart(r.price_series, ccy);

    // 深度分析图表：毛利率趋势 + 同业对比（指标可切换）
    if (gm) {
      const qs = gm.series_quarterly || [];
      window.SICharts.initLineChart(
        "gm-trend-chart",
        qs.map((p) => p.period),
        qs.map((p) => p.value),
        gm.series_annual || [],
        "%"
      );
      const peers = gm.peer_compare || [];
      window.SICharts.initPeerChart("gm-peer-chart", peers, "value", r.name);
      $$("#gm-metric-switch .chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          $$("#gm-metric-switch .chip").forEach((c) => c.classList.toggle("active", c === chip));
          window.SICharts.initPeerChart("gm-peer-chart", peers, chip.dataset.metric, r.name);
        });
      });
    }

    // 章节锚点 + scrollspy
    const tabs = $$("#section-tabs .section-tab");
    tabs.forEach((t) => t.addEventListener("click", () => {
      const el = document.getElementById(decodeURIComponent(t.dataset.target));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    const secs = $$(".panel[id]");
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          tabs.forEach((t) =>
            t.classList.toggle("active", decodeURIComponent(t.dataset.target) === en.target.id));
        }
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    secs.forEach((s) => spy.observe(s));
  }

  document.addEventListener("DOMContentLoaded", () => {
    initRadar();
    initIndex();
    initMarket();
    initLibrary();
    initReport();
  });
})();
