/* 股析 StockInsight — 页面渲染逻辑 */
(function () {
  "use strict";
  const { $, $$, loadJSON, fmtPrice, fmtPct, pctClass, fmtVolume, fmtMoney,
    ratingBadge, sentimentBadge, marketBadge } = window.SI;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function reportCardHTML(r, idx) {
    const closes = r.price_series.map((d) => d.close).slice(-40).join(",");
    return `
    <a class="card card-hover report-card stagger-item" style="animation-delay:${idx * 60}ms"
       href="report.html?id=${encodeURIComponent(r.id)}">
      <div class="card-top">
        <div>
          <div class="stock-name">${esc(r.name)}</div>
          <div class="stock-symbol">${esc(r.symbol)} · ${esc(r.company.industry)}</div>
        </div>
        <div class="price-line">
          <div class="price">${fmtPrice(r.overview.price, r.overview.currency)}</div>
          <div class="chg ${pctClass(r.overview.change_pct)}">${fmtPct(r.overview.change_pct)}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${marketBadge(r.market)}${ratingBadge(r.analysis.rating)}</div>
      <div class="cover">${esc(r.cover)}</div>
      <div class="spark" data-spark="${closes}"></div>
      <div class="card-foot"><span>${esc(r.overview.as_of)} 收盘</span><span>查看报告 →</span></div>
    </a>`;
  }

  async function initIndex() {
    if (!$("#report-grid")) return;
    try {
      const reports = await Promise.all(
        (await loadJSON("reports/index.json")).map((r) => loadJSON(`reports/${r.id}.json`))
      );
      $("#report-grid").innerHTML = reports.map(reportCardHTML).join("");
      $("#stat-reports").textContent = reports.length;
      const stocks = new Set(reports.map((r) => r.symbol + r.market));
      $("#stat-stocks").textContent = stocks.size;
      window.SICharts.initSparklines();
    } catch (e) {
      $("#report-grid").innerHTML = `<div class="empty-state">报告加载失败：${esc(e.message)}</div>`;
    }
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

  async function initLibrary() {
    if (!$("#lib-list")) return;
    let all = [];
    try {
      all = await Promise.all(
        (await loadJSON("reports/index.json")).map((r) => loadJSON(`reports/${r.id}.json`))
      );
    } catch (e) {
      $("#lib-list").innerHTML = `<div class="empty-state">报告加载失败：${esc(e.message)}</div>`;
      return;
    }

    const state = { stock: null, market: "ALL", q: "" };

    // 侧边栏：按市场分组 → 股票
    const byMarket = { CN: [], US: [] };
    all.forEach((r) => (byMarket[r.market] || (byMarket[r.market] = [])).push(r));
    const groups = Object.keys(byMarket).filter((m) => byMarket[m].length);
    $("#lib-sidebar").innerHTML = groups.map((m) => {
      const list = byMarket[m];
      const byStock = {};
      list.forEach((r) => { (byStock[r.symbol] = byStock[r.symbol] || []).push(r); });
      const items = Object.entries(byStock).map(([sym, rs]) => `
        <button class="side-item" data-stock="${esc(sym)}" data-market="${m}">
          <span>${esc(rs[0].name)} <span style="color:var(--color-text-3);font-size:11px">${esc(sym)}</span></span>
          <span class="cnt">${rs.length}</span>
        </button>`).join("");
      return `<div class="side-group">
        <div class="group-head"><span>${window.SI.MARKET_LABEL[m] || m}</span><span class="count">${list.length}</span></div>
        ${items}
      </div>`;
    }).join("");

    const rows = () => {
      let list = all.slice().sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1));
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

    const renderRows = () => {
      const list = rows();
      if (!list.length) {
        $("#lib-list").innerHTML = `<div class="empty-state">没有符合条件的报告</div>`;
        return;
      }
      $("#lib-list").innerHTML = list.map((r) => `
        <a class="card card-hover report-row" href="report.html?id=${encodeURIComponent(r.id)}">
          <div class="row-main">
            <div class="row-title">
              <span class="nm">${esc(r.name)}</span>
              <span style="color:var(--color-text-3);font-size:12px" class="num">${esc(r.symbol)}</span>
              ${marketBadge(r.market)}${ratingBadge(r.analysis.rating)}
            </div>
            <div class="row-cover">${esc(r.cover)}</div>
          </div>
          <div class="row-side">
            <div class="num" style="font-weight:700">${fmtPrice(r.overview.price, r.overview.currency)}</div>
            <div class="num ${pctClass(r.overview.change_pct)}" style="font-size:13px">${fmtPct(r.overview.change_pct)}</div>
            <div class="row-date num">${esc(r.generated_at.slice(0, 10))}</div>
          </div>
        </a>`).join("");
    };

    $$("#lib-sidebar .side-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sym = btn.dataset.stock;
        state.stock = state.stock === sym ? null : sym;
        $$("#lib-sidebar .side-item").forEach((b) =>
          b.classList.toggle("active", b.dataset.stock === state.stock));
        renderRows();
      });
    });

    $$(".chip[data-market]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.market = chip.dataset.market;
        $$(".chip[data-market]").forEach((c) => c.classList.toggle("active", c === chip));
        renderRows();
      });
    });

    $("#lib-search").addEventListener("input", (e) => {
      state.q = e.target.value.trim();
      renderRows();
    });

    renderRows();
  }

  async function initReport() {
    const id = new URLSearchParams(location.search).get("id");
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
        ${["概览", "行情走势", "技术指标", "财务摘要", "新闻公告", "AI 结论"]
          .map((t) => `<button class="section-tab" data-target="sec-${encodeURIComponent(t)}">${t}</button>`).join("")}
      </nav>

      <section class="card panel" id="sec-概览">
        <div class="panel-head"><h2>概览</h2><span class="hint">生成于 ${esc(r.generated_at)}</span></div>
        <div class="kv-grid">
          <div class="kv"><div class="k">最新价</div><div class="v num">${fmtPrice(r.overview.price, ccy)} <small>${ccy}</small></div></div>
          <div class="kv"><div class="k">当日涨跌</div><div class="v num ${pctClass(r.overview.change_pct)}">${fmtPct(r.overview.change_pct)}</div></div>
          <div class="kv"><div class="k">PE (TTM)</div><div class="v num">${fin.pe_ttm ?? "—"}</div></div>
          <div class="kv"><div class="k">PB</div><div class="v num">${fin.pb ?? "—"}</div></div>
          <div class="kv"><div class="k">ROE</div><div class="v num">${fin.roe ?? "—"}<small>%</small></div></div>
          <div class="kv"><div class="k">综合评级</div><div class="v" style="font-size:var(--text-lg)">${ratingBadge(r.analysis.rating)}</div></div>
        </div>
        <p class="analysis-summary" style="margin-top:var(--space-5)">${esc(r.cover)}</p>
      </section>

      <section class="card panel" id="sec-行情走势">
        <div class="panel-head"><h2>行情走势</h2><span class="hint">近 ${r.price_series.length} 个交易日 · 日 K + 成交量</span></div>
        <div class="chart-kline" id="kline-chart" role="img" aria-label="${esc(r.name)} K线图"></div>
      </section>

      <section class="card panel" id="sec-技术指标">
        <div class="panel-head"><h2>技术指标</h2><span class="hint">基于日线收盘计算</span></div>
        <div class="kv-grid">
          <div class="kv"><div class="k">MA5</div><div class="v num">${ind.ma5 ?? "—"}</div></div>
          <div class="kv"><div class="k">MA20</div><div class="v num">${ind.ma20 ?? "—"}</div></div>
          <div class="kv"><div class="k">EMA20</div><div class="v num">${ind.ema20 ?? "—"}</div></div>
          <div class="kv"><div class="k">RSI 14</div><div class="v num">${ind.rsi14 ?? "—"}</div></div>
          <div class="kv"><div class="k">MACD DIF</div><div class="v num">${ind.macd?.dif ?? "—"}</div></div>
          <div class="kv"><div class="k">MACD DEA</div><div class="v num">${ind.macd?.dea ?? "—"}</div></div>
          <div class="kv"><div class="k">MACD 柱</div><div class="v num ${pctClass(ind.macd?.hist)}">${ind.macd?.hist ?? "—"}</div></div>
          <div class="kv"><div class="k">区间振幅参考</div><div class="v num">${(() => {
            const cs = r.price_series.map((d) => d.close);
            const mx = Math.max(...cs), mn = Math.min(...cs);
            return ((mx - mn) / mn * 100).toFixed(1) + "%";
          })()}</div></div>
        </div>
      </section>

      <section class="card panel" id="sec-财务摘要">
        <div class="panel-head"><h2>财务摘要</h2><span class="hint">${esc(fin.report_period || "最新报告期")}</span></div>
        <table class="data-table">
          <thead><tr><th>指标</th><th>数值</th><th>同比</th></tr></thead>
          <tbody>
            <tr><td>营业收入</td><td>${fmtMoney(fin.revenue, ccy)}</td><td class="${pctClass(fin.revenue_yoy)}">${fin.revenue_yoy == null ? "—" : fmtPct(fin.revenue_yoy)}</td></tr>
            <tr><td>净利润</td><td>${fmtMoney(fin.net_profit, ccy)}</td><td class="${pctClass(fin.net_profit_yoy)}">${fin.net_profit_yoy == null ? "—" : fmtPct(fin.net_profit_yoy)}</td></tr>
            <tr><td>ROE</td><td>${fin.roe ?? "—"}%</td><td>—</td></tr>
            <tr><td>市盈率 PE(TTM)</td><td>${fin.pe_ttm ?? "—"}</td><td>—</td></tr>
            <tr><td>市净率 PB</td><td>${fin.pb ?? "—"}</td><td>—</td></tr>
          </tbody>
        </table>
      </section>

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
    initIndex();
    initMarket();
    initLibrary();
    initReport();
  });
})();
