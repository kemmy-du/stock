/* 股析 StockInsight — 财报汇总页 */
(function () {
  "use strict";
  const { $, $$, failHint } = window.SI;
  const C = window.FinCore;

  const VIEW_COLUMNS = {
    q: [
      { key: "code", label: "代码", cls: "fin-c1", type: "text", hint: "股票代码" },
      { key: "name", label: "名称", cls: "fin-c2", type: "name", hint: "股票中文简称" },
      { key: "period", label: "报告期", cls: "fin-c3", type: "period", hint: "该行单季数据所属季度，如 2026二季报（4–6 月）" },
      { key: "q_rev", label: "营收", type: "yi", hint: "单季营业总收入" },
      { key: "q_np", label: "归母净利", type: "yi", hint: "单季归母净利润" },
      { key: "q_deduct", label: "扣非净利", type: "yi", hint: "单季扣非归母净利润" },
      { key: "q_gm", label: "毛利率", type: "pct", hint: "单季毛利润 ÷ 单季营收" },
      { key: "q_nm", label: "净利率", type: "pct", hint: "单季归母净利 ÷ 单季营收" },
      { key: "pe_dyn", label: "动态 PE", type: "num", hint: "总市值 ÷ 年化归母净利" },
      { key: "pb", label: "PB", type: "num", hint: "市净率（MRQ）" },
      { key: "mcap", label: "总市值", type: "yi", hint: "总市值（亿元）" },
      { key: "fcap", label: "流通市值", type: "yi", hint: "流通市值（亿元）" },
      { key: "rev_qoq", label: "营收环比", type: "pctSigned", hint: "本季单季营收 vs 上一单季营收" },
      { key: "np_qoq", label: "归母环比", type: "pctSigned", hint: "本季单季归母净利 vs 上一单季" },
      { key: "rev_yoy", label: "营收同比", type: "pctSigned", hint: "本季单季营收 vs 去年同季单季" },
      { key: "np_yoy", label: "归母同比", type: "pctSigned", hint: "本季单季归母净利 vs 去年同季单季" },
    ],
    y: [
      { key: "code", label: "代码", cls: "fin-c1", type: "text", hint: "股票代码" },
      { key: "name", label: "名称", cls: "fin-c2", type: "name", hint: "股票中文简称" },
      { key: "period", label: "报告期", cls: "fin-c3", type: "period", hint: "年度数据所属报告期，如 2025年报" },
      { key: "y_rev", label: "营收", type: "yi", hint: "上一完整年度营业总收入" },
      { key: "y_np", label: "归母净利", type: "yi", hint: "上一完整年度归母净利润" },
      { key: "y_deduct", label: "扣非净利", type: "yi", hint: "上一完整年度扣非归母净利润" },
      { key: "y_gm", label: "毛利率", type: "pct", hint: "年度毛利润 ÷ 年度营收" },
      { key: "y_nm", label: "净利率", type: "pct", hint: "年度归母净利 ÷ 年度营收" },
      { key: "pe_dyn", label: "动态 PE", type: "num", hint: "总市值 ÷ 年化归母净利" },
      { key: "pb", label: "PB", type: "num", hint: "市净率（MRQ）" },
      { key: "mcap", label: "总市值", type: "yi", hint: "总市值（亿元）" },
      { key: "fcap", label: "流通市值", type: "yi", hint: "流通市值（亿元）" },
      { key: "y_rev_yoy", label: "营收同比", type: "pctSigned", hint: "年度营收相对上一年度" },
      { key: "y_np_yoy", label: "归母同比", type: "pctSigned", hint: "年度归母净利相对上一年度" },
    ],
  };

  const state = {
    fields: C.FIELDS, rows: [], view: "q",
    query: "", page: 1, size: 100,
    sortKeys: [{ key: "mcap", dir: -1 }],
    chartMode: "q", current: null, historyCache: {},
    newCodes: new Set(), onlyNew: false,
    filters: emptyFilters(), periodOptions: [],
    generatedAt: "—", tradeDate: "—", pushed: false,
  };

  const NUM_INPUTS = {
    revYoyMin: "f-rev-yoy", npYoyMin: "f-np-yoy",
    peMin: "f-pe-min", peMax: "f-pe-max",
    pbMin: "f-pb-min", pbMax: "f-pb-max",
    mcapMin: "f-mcap-min", mcapMax: "f-mcap-max",
    gmMin: "f-gm", nmMin: "f-nm", deductRatioMin: "f-deduct",
  };
  const SINGLE_FILTERS = {
    revYoy: ["revYoyMin"], npYoy: ["npYoyMin"],
    gm: ["gmMin"], nm: ["nmMin"], deduct: ["deductRatioMin"],
  };
  const RANGE_FILTERS = {
    pe: ["peMin", "peMax"], pb: ["pbMin", "pbMax"], mcap: ["mcapMin", "mcapMax"],
  };

  function emptyFilters() {
    return {
      periods: [], profit: "all",
      revYoyMin: null, npYoyMin: null,
      peMin: null, peMax: null, pbMin: null, pbMax: null,
      mcapMin: null, mcapMax: null,
      gmMin: null, nmMin: null, deductRatioMin: null,
    };
  }

  const els = {};
  let timer = null;
  let filterTimer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const clsOf = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");

  function fmtCell(col, v) {
    switch (col.type) {
      case "yi": return C.formatYi(v);
      case "pct": return v == null ? "—" : C.formatNum(v, 1) + "%";
      case "pctSigned": return C.formatPct(v);
      case "num": return C.formatNum(v, v != null && Math.abs(v) < 100 ? 2 : 1);
      default: return v == null ? "—" : String(v);
    }
  }
  function cellCls(col, v) {
    if (col.type === "pctSigned") return "num " + clsOf(v);
    if (col.type === "yi" && (col.key === "q_np" || col.key === "y_np")) {
      return "num " + clsOf(v);
    }
    if (col.type === "yi" || col.type === "num" || col.type === "pct") return "num";
    return "";
  }

  function isNew(code) {
    return state.newCodes.has(String(code));
  }

  function currentRows() {
    let rows = C.filterRows(state.rows, state.query);
    if (state.onlyNew) rows = rows.filter((r) => isNew(r.code));
    rows = C.filterByConditions(rows, toConditions(), state.view);
    return C.sortRows(rows, state.sortKeys);
  }

  function renderHead() {
    const cols = VIEW_COLUMNS[state.view];
    els.head.innerHTML = "<tr>" + cols.map((col) => {
      const idx = state.sortKeys.findIndex((k) => k.key === col.key);
      const dir = idx >= 0 ? (state.sortKeys[idx].dir < 0 ? "desc" : "asc") : "";
      const badge = state.sortKeys.length > 1 && idx >= 0
        ? '<span class="fin-sort-badge">' + (idx + 1) + "</span>" : "";
      return '<th class="sortable ' + (col.cls || "num") + " " + dir +
        '" data-key="' + col.key + '" title="' + esc(col.hint) +
        '；点击排序，Shift+点击追加">' + col.label + badge + "</th>";
    }).join("") + "</tr>";
  }

  function periodText(row, mode) {
    if (!row || !row.period) return "—";
    if (mode === "y") return (Number(String(row.period).slice(0, 4)) - 1) + "年报";
    return C.periodLabel(row.period);
  }

  function renderBody() {
    const cols = VIEW_COLUMNS[state.view];
    const rows = currentRows();
    const pg = C.paginate(rows, state.page, state.size);
    state.page = pg.page;
    if (!pg.items.length) {
      const narrowed = activeFilterCount() > 0 || state.query.trim() || state.onlyNew;
      els.body.innerHTML = '<tr><td colspan="' + cols.length +
        '" class="empty-state" style="border:0">' +
        (narrowed ? "无匹配股票，试试放宽筛选或搜索" : "无匹配股票") + "</td></tr>";
    } else {
      els.body.innerHTML = pg.items.map((r) => {
        const tds = cols.map((col) => {
          if (col.key === "code") {
            return '<td class="fin-c1"><span class="num">' + esc(r.code) + "</span></td>";
          }
          if (col.key === "name") {
            return '<td class="fin-c2"><span>' + esc(r.name) + "</span>" +
              (isNew(r.code) ? '<span class="fin-badge-new">新</span>' : "") + "</td>";
          }
          if (col.key === "period") {
            return '<td class="fin-c3">' + esc(periodText(r, state.view)) + "</td>";
          }
          return '<td class="' + cellCls(col, r[col.key]) + '">' + fmtCell(col, r[col.key]) + "</td>";
        }).join("");
        return '<tr data-code="' + esc(r.code) + '" tabindex="0">' + tds + "</tr>";
      }).join("");
    }
    renderPager(rows.length, pg);
    els.total.textContent = "共 " + rows.length + " 只 · 快照 " + state.generatedAt +
      " · 仅供研究参考，不构成投资建议。";
    updateFilterSummary(rows.length);
  }

  function renderPager(total, pg) {
    const pages = pg.pages;
    const btns = [];
    const add = (label, page, disabled, active) =>
      btns.push('<button type="button" data-page="' + page + '"' +
        (disabled ? " disabled" : "") + (active ? ' class="active"' : "") + ">" + label + "</button>");
    add("上一页", pg.page - 1, pg.page <= 1);
    const start = Math.max(1, Math.min(pg.page - 2, pages - 4));
    for (let p = start; p <= Math.min(pages, start + 4); p++) add(String(p), p, false, p === pg.page);
    add("下一页", pg.page + 1, pg.page >= pages);
    els.pager.innerHTML = btns.join("") +
      '<span>共 <b class="num">' + total + "</b> 只 · " + pages + " 页</span>" +
      '<select id="fin-size" aria-label="每页条数">' +
      [50, 100, 200].map((n) => '<option value="' + n + '"' +
        (n === state.size ? " selected" : "") + ">每页 " + n + "</option>").join("") +
      "</select>";
    const sel = els.pager.querySelector("#fin-size");
    if (sel) sel.addEventListener("change", () => {
      state.size = +sel.value;
      state.page = 1;
      scrollTableTop();
      renderBody();
    });
  }

  function scrollTableTop() {
    if (els.wrap) els.wrap.scrollTop = 0;
  }

  function updateStatus() {
    if (!els.status) return;
    els.status.innerHTML = "交易日 <span class=\"num\">" + esc(state.tradeDate) +
      "</span> · 覆盖 <b class=\"num\">" + state.rows.length + "</b> 只 A 股";
  }

  function updateNewChip() {
    const chip = els.newChip;
    if (!chip) return;
    const n = state.newCodes.size;
    chip.hidden = n === 0;
    chip.classList.toggle("active", state.onlyNew && n > 0);
    chip.setAttribute("aria-pressed", state.onlyNew ? "true" : "false");
    const cnt = $("#fin-new-cnt");
    if (cnt) cnt.textContent = String(n);
    if (n === 0 && state.onlyNew) state.onlyNew = false;
  }

  /* ---------- 筛选 ---------- */

  function numValue(id) {
    const el = document.getElementById(id);
    if (!el || el.value.trim() === "") return null;
    const n = Number(el.value);
    return isFinite(n) ? n : null;
  }

  function setNumValue(key, value) {
    const el = document.getElementById(NUM_INPUTS[key]);
    if (el) el.value = value == null ? "" : String(value);
  }

  function syncNumberFilters() {
    Object.keys(NUM_INPUTS).forEach((k) => { state.filters[k] = numValue(NUM_INPUTS[k]); });
  }

  function toConditions() {
    const f = state.filters;
    return {
      periods: f.periods, profit: f.profit,
      revYoyMin: f.revYoyMin, npYoyMin: f.npYoyMin,
      peMin: f.peMin, peMax: f.peMax, pbMin: f.pbMin, pbMax: f.pbMax,
      mcapMin: f.mcapMin == null ? null : f.mcapMin * 1e8,
      mcapMax: f.mcapMax == null ? null : f.mcapMax * 1e8,
      gmMin: f.gmMin, nmMin: f.nmMin, deductRatioMin: f.deductRatioMin,
    };
  }

  function activeFilterCount() {
    const f = state.filters;
    let n = state.view === "y" ? 0 : f.periods.length;
    if (f.profit !== "all") n += 1;
    ["revYoyMin", "npYoyMin", "gmMin", "nmMin", "deductRatioMin"].forEach((k) => {
      if (f[k] != null) n += 1;
    });
    if (f.peMin != null || f.peMax != null) n += 1;
    if (f.pbMin != null || f.pbMax != null) n += 1;
    if (f.mcapMin != null || f.mcapMax != null) n += 1;
    return n;
  }

  function updateFilterBadge() {
    if (!els.filterBtn) return;
    const n = activeFilterCount();
    els.filterCnt.hidden = n === 0;
    els.filterCnt.textContent = String(n);
    els.filterBtn.classList.toggle("active", n > 0);
  }

  function updatePeriodGroup() {
    const group = $("#fin-group-period");
    if (group) group.hidden = state.view === "y";
  }

  function renderPeriodChips() {
    if (!els.periods) return;
    const selected = state.filters.periods;
    let html = '<button type="button" class="chip' + (selected.length ? "" : " active") +
      '" data-period="">全部</button>';
    html += state.periodOptions.map((p) =>
      '<button type="button" class="chip' + (selected.indexOf(p) >= 0 ? " active" : "") +
      '" data-period="' + esc(p) + '">' + esc(C.periodLabel(p)) + "</button>").join("");
    els.periods.innerHTML = html;
  }

  function renderProfitChips() {
    $$("#fin-profit .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.profit === state.filters.profit));
  }

  function filterChip(kind, text, value) {
    return '<button type="button" data-clear="' + kind + '"' +
      (value ? ' data-value="' + esc(value) + '"' : "") +
      ' aria-label="移除筛选：' + esc(text) + '">' + esc(text) + " ×</button>";
  }

  function rangeText(min, max) {
    if (min != null && max != null) return min + "–" + max;
    if (min != null) return "≥" + min;
    return "≤" + max;
  }

  function renderActiveFilters() {
    const box = els.activeFilters;
    if (!box) return;
    const f = state.filters;
    const parts = [];
    if (state.view !== "y") {
      f.periods.forEach((p) => parts.push(filterChip("period", "报告期 " + C.periodLabel(p), p)));
    }
    if (f.profit !== "all") parts.push(filterChip("profit", f.profit === "profit" ? "仅盈利" : "仅亏损"));
    if (f.revYoyMin != null) parts.push(filterChip("revYoy", "营收同比 ≥" + f.revYoyMin + "%"));
    if (f.npYoyMin != null) parts.push(filterChip("npYoy", "归母同比 ≥" + f.npYoyMin + "%"));
    if (f.peMin != null || f.peMax != null) parts.push(filterChip("pe", "PE " + rangeText(f.peMin, f.peMax)));
    if (f.pbMin != null || f.pbMax != null) parts.push(filterChip("pb", "PB " + rangeText(f.pbMin, f.pbMax)));
    if (f.mcapMin != null || f.mcapMax != null) {
      parts.push(filterChip("mcap", "市值 " + rangeText(f.mcapMin, f.mcapMax) + " 亿"));
    }
    if (f.gmMin != null) parts.push(filterChip("gm", "毛利率 ≥" + f.gmMin + "%"));
    if (f.nmMin != null) parts.push(filterChip("nm", "净利率 ≥" + f.nmMin + "%"));
    if (f.deductRatioMin != null) parts.push(filterChip("deduct", "扣非/归母 ≥" + f.deductRatioMin + "%"));
    box.hidden = parts.length === 0;
    box.innerHTML = parts.join("");
  }

  function refreshQuick() {
    $$("#f-mcap-quick .chip").forEach((c) => {
      c.classList.toggle("active",
        state.filters.mcapMax == null && state.filters.mcapMin != null &&
        Number(c.dataset.min) === state.filters.mcapMin);
    });
  }

  function applyFilters() {
    state.page = 1;
    scrollTableTop();
    renderActiveFilters();
    updateFilterBadge();
    renderBody();
  }

  function clearFilter(kind, value) {
    const f = state.filters;
    if (kind === "period") {
      f.periods = f.periods.filter((p) => p !== value);
      renderPeriodChips();
    } else if (kind === "profit") {
      f.profit = "all";
      renderProfitChips();
    } else {
      const keys = SINGLE_FILTERS[kind] || RANGE_FILTERS[kind];
      if (!keys) return;
      keys.forEach((k) => { f[k] = null; setNumValue(k, null); });
      if (kind === "mcap") refreshQuick();
    }
    applyFilters();
  }

  function resetFilters() {
    state.filters = emptyFilters();
    Object.keys(NUM_INPUTS).forEach((k) => setNumValue(k, null));
    renderPeriodChips();
    renderProfitChips();
    refreshQuick();
    applyFilters();
  }

  function updateFilterSummary(total) {
    const el = $("#fin-filter-summary");
    if (!el) return;
    el.textContent = "当前命中 " + total +
      " 只 · 同比/毛利率/扣非占比按当前视图口径（季度=单季，年度=全年）；报告期筛选仅季度视图生效。";
  }

  function syncSortKeys() {
    const cols = VIEW_COLUMNS[state.view];
    state.sortKeys = state.sortKeys.filter((k) => cols.some((c) => c.key === k.key));
    if (!state.sortKeys.length) state.sortKeys = [{ key: "mcap", dir: -1 }];
  }

  async function load() {
    try {
      const res = await fetch("data/financials.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("快照加载失败 " + res.status);
      const snap = C.fromSnapshot(await res.json());
      state.rows = snap.rows;
      state.newCodes = new Set(snap.newCodes);
      state.generatedAt = snap.generatedAt;
      state.tradeDate = snap.tradeDate;
      state.periodOptions = Array.from(new Set(state.rows.map((r) => r.period).filter(Boolean)))
        .sort().reverse();
      renderPeriodChips();
      renderProfitChips();
      updatePeriodGroup();
      renderActiveFilters();
      updateFilterBadge();
      updateNewChip();
      updateStatus();
      renderHead();
      renderBody();
      openFromHash();
    } catch (e) {
      els.body.innerHTML = '<tr><td colspan="' + VIEW_COLUMNS[state.view].length +
        '" class="empty-state" style="border:0">数据加载失败，请稍后重试。</td></tr>';
      failHint("财报数据加载失败，请稍后重试。");
    }
  }

  function bindEvents() {
    els.search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = els.search.value;
        state.page = 1;
        scrollTableTop();
        renderBody();
      }, 120);
    });
    $$("#fin-view .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (state.view === chip.dataset.view) return;
        state.view = chip.dataset.view;
        $$("#fin-view .chip").forEach((c) => c.classList.toggle("active", c === chip));
        state.page = 1;
        syncSortKeys();
        updatePeriodGroup();
        renderActiveFilters();
        updateFilterBadge();
        scrollTableTop();
        renderHead();
        renderBody();
      });
    });
    els.reset.addEventListener("click", () => {
      state.sortKeys = [{ key: "mcap", dir: -1 }];
      state.page = 1;
      renderHead();
      renderBody();
    });
    if (els.newChip) {
      els.newChip.addEventListener("click", () => {
        state.onlyNew = !state.onlyNew;
        state.page = 1;
        updateNewChip();
        scrollTableTop();
        renderBody();
      });
    }
    if (els.filterBtn) {
      els.filterBtn.addEventListener("click", () => {
        const open = els.filterPanel.hidden;
        els.filterPanel.hidden = !open;
        els.filterBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      els.filterClear.addEventListener("click", resetFilters);
      els.periods.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-period]");
        if (!btn) return;
        const p = btn.dataset.period;
        const list = state.filters.periods;
        if (!p) {
          list.length = 0;
        } else {
          const i = list.indexOf(p);
          if (i >= 0) list.splice(i, 1); else list.push(p);
          if (list.length === state.periodOptions.length) list.length = 0;
        }
        renderPeriodChips();
        applyFilters();
      });
      els.profit.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-profit]");
        if (!btn) return;
        state.filters.profit = btn.dataset.profit;
        renderProfitChips();
        applyFilters();
      });
      const quick = $("#f-mcap-quick");
      if (quick) {
        quick.addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-min]");
          if (!btn) return;
          setNumValue("mcapMin", btn.dataset.min);
          setNumValue("mcapMax", null);
          syncNumberFilters();
          refreshQuick();
          applyFilters();
        });
      }
      Object.keys(NUM_INPUTS).forEach((k) => {
        const el = document.getElementById(NUM_INPUTS[k]);
        if (!el) return;
        el.addEventListener("input", () => {
          clearTimeout(filterTimer);
          filterTimer = setTimeout(() => {
            syncNumberFilters();
            refreshQuick();
            applyFilters();
          }, 200);
        });
      });
      els.activeFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-clear]");
        if (btn) clearFilter(btn.dataset.clear, btn.dataset.value);
      });
    }
    els.head.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-key]");
      if (!th) return;
      const key = th.dataset.key;
      const idx = state.sortKeys.findIndex((k) => k.key === key);
      if (e.shiftKey) {
        if (idx >= 0) {
          if (state.sortKeys[idx].dir < 0) state.sortKeys[idx].dir = 1;
          else state.sortKeys.splice(idx, 1);
        } else {
          state.sortKeys.push({ key, dir: -1 });
        }
      } else if (idx >= 0 && state.sortKeys.length === 1) {
        state.sortKeys = state.sortKeys[idx].dir < 0
          ? [{ key, dir: 1 }]
          : [{ key: "mcap", dir: -1 }];
      } else {
        state.sortKeys = [{ key, dir: -1 }];
      }
      state.page = 1;
      renderHead();
      renderBody();
    });
    els.pager.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-page]");
      if (!btn || btn.disabled) return;
      state.page = +btn.dataset.page;
      scrollTableTop();
      renderBody();
    });
    els.body.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-code]");
      if (tr) openDrawer(tr.dataset.code);
    });
    els.body.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const tr = e.target.closest("tr[data-code]");
      if (tr) openDrawer(tr.dataset.code);
    });
  }

  /* ---------- 个股抽屉 / 全屏面板 ---------- */

  function exCode(code) {
    if (/^6/.test(code)) return code + ".SH";
    if (/^[03]/.test(code)) return code + ".SZ";
    return code + ".BJ";
  }

  async function loadHistory(code) {
    if (state.historyCache[code]) return state.historyCache[code];
    const url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
      + "?reportName=RPT_F10_FINANCE_MAINFINADATA"
      + "&columns=SECURITY_CODE,REPORT_DATE,TOTALOPERATEREVE,PARENTNETPROFIT,MLR,UPDATE_DATE"
      + "&filter=" + encodeURIComponent('(SECUCODE="' + exCode(code) + '")')
      + "&pageSize=60&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1"
      + "&source=WEB&client=WEB";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("历史数据请求失败 " + res.status);
    const json = await res.json();
    const rows = ((json.result || {}).data) || [];
    const byDate = {};
    for (const r of rows) {
      const d = (r.REPORT_DATE || "").slice(0, 10);
      if (!d) continue;
      if (!byDate[d] || (r.UPDATE_DATE || "") >= (byDate[d].UPDATE_DATE || "")) {
        byDate[d] = {
          date: d,
          rev: r.TOTALOPERATEREVE,
          np: r.PARENTNETPROFIT,
          gross: r.MLR,
          UPDATE_DATE: r.UPDATE_DATE,
        };
      }
    }
    const history = Object.values(byDate);
    state.historyCache[code] = history;
    return history;
  }

  function rowByCode(code) {
    return state.rows.find((r) => String(r.code) === String(code)) || null;
  }

  function metricRow(label, value, wide, cls) {
    return '<div' + (wide ? ' class="wide"' : "") + "><span>" + label +
      '</span><b class="num' + (cls ? " " + cls : "") + '">' + value + "</b></div>";
  }
  function yiSuffix(v) {
    const s = C.formatYi(v);
    return s === "—" ? s : s + " 亿";
  }
  function pctCell(v) {
    return [ C.formatPct(v), v > 0 ? "up" : v < 0 ? "down" : "" ];
  }

  function renderDrawerMetrics(row) {
    const isY = state.chartMode === "y";
    const v = (k) => (row ? row[k] : null);
    const rev = isY ? v("y_rev") : v("q_rev");
    const np = isY ? v("y_np") : v("q_np");
    const ded = isY ? v("y_deduct") : v("q_deduct");
    const gm = isY ? v("y_gm") : v("q_gm");
    const nm = isY ? v("y_nm") : v("q_nm");
    const qoqRev = pctCell(isY ? null : v("rev_qoq"));
    const qoqNp = pctCell(isY ? null : v("np_qoq"));
    const yoyRev = pctCell(isY ? v("y_rev_yoy") : v("rev_yoy"));
    const yoyNp = pctCell(isY ? v("y_np_yoy") : v("np_yoy"));
    const rows = [
      metricRow(isY ? "全年营收" : "单季营收", yiSuffix(rev)),
      metricRow(isY ? "全年归母" : "单季归母", yiSuffix(np)),
      metricRow("扣非净利", yiSuffix(ded)),
      metricRow("毛利率", gm == null ? "—" : C.formatNum(gm, 1) + "%"),
      metricRow("净利率", nm == null ? "—" : C.formatNum(nm, 1) + "%"),
    ];
    if (!isY) {
      rows.push(
        metricRow("单季营收环比", qoqRev[0], false, qoqRev[1]),
        metricRow("单季归母环比", qoqNp[0], false, qoqNp[1]),
      );
    }
    rows.push(
      metricRow(isY ? "全年营收同比" : "单季营收同比", yoyRev[0], false, yoyRev[1]),
      metricRow(isY ? "全年归母同比" : "单季归母同比", yoyNp[0], false, yoyNp[1]),
      metricRow("动态 PE / PB", C.formatNum(v("pe_dyn"), 1) + " / " + C.formatNum(v("pb"), 2)),
      metricRow("总市值 / 流通", yiSuffix(v("mcap")) + " / " + yiSuffix(v("fcap")), true),
    );
    $("#fin-drawer-metrics").innerHTML = rows.join("");
  }

  async function renderChart() {
    const code = state.current;
    const el = $("#fin-chart");
    if (!code || !el) return;
    el.innerHTML = '<div class="chart-fallback">加载历史数据…</div>';
    try {
      const history = await loadHistory(code);
      if (state.current !== code) return;
      const series = C.trendSeries(history, state.chartMode, state.chartMode === "y" ? 6 : 12);
      el.innerHTML = "";
      window.SICharts.initFinancialTrend(el, series);
    } catch (e) {
      el.innerHTML = '<div class="chart-fallback">历史数据加载失败，请稍后重试。</div>';
    }
  }

  function openDrawer(code) {
    const row = rowByCode(code);
    if (!row) return;
    state.current = code;
    $("#fin-drawer-title").textContent = row.name + "（" + row.code + "）";
    $("#fin-drawer-sub").textContent = periodText(row, state.chartMode) + " · 估值 " + state.tradeDate;
    renderDrawerMetrics(row);
    renderChart();
    const drawer = $("#fin-drawer");
    const mask = $("#fin-mask");
    drawer.hidden = false;
    mask.hidden = false;
    // 强制重排后再加 class，保证过渡动画生效；不用 rAF（后台标签页里 rAF 会停）
    void drawer.offsetWidth;
    drawer.classList.add("open");
    mask.classList.add("open");
    document.body.style.overflow = "hidden";
    if (location.hash !== "#" + code) {
      history.pushState({ code }, "", "#" + code);
      state.pushed = true;
    }
    const btn = $("#fin-close");
    if (btn) btn.focus();
  }

  function closeDrawer(fromHistory) {
    const drawer = $("#fin-drawer");
    const mask = $("#fin-mask");
    if (!drawer || !drawer.classList.contains("open")) return;
    drawer.classList.remove("open");
    mask.classList.remove("open");
    document.body.style.overflow = "";
    state.current = null;
    setTimeout(() => {
      drawer.hidden = true;
      mask.hidden = true;
    }, 260);
    if (fromHistory) {
      state.pushed = false;
      return;
    }
    if (state.pushed) {
      state.pushed = false;
      history.back();
    } else if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function openFromHash() {
    const code = location.hash.replace("#", "");
    if (code && rowByCode(code)) openDrawer(code);
  }

  function bindDrawer() {
    const mask = $("#fin-mask");
    if (mask) mask.addEventListener("click", () => closeDrawer(false));
    const close = $("#fin-close");
    if (close) close.addEventListener("click", () => closeDrawer(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawer(false);
    });
    window.addEventListener("popstate", () => {
      if (!location.hash) closeDrawer(true);
    });
    $$("#fin-chart-view .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (state.chartMode === chip.dataset.view) return;
        state.chartMode = chip.dataset.view;
        $$("#fin-chart-view .chip").forEach((c) => c.classList.toggle("active", c === chip));
        const row = rowByCode(state.current);
        $("#fin-drawer-sub").textContent = periodText(row, state.chartMode) +
          " · 估值 " + state.tradeDate;
        renderDrawerMetrics(row);
        renderChart();
      });
    });
  }

  function init() {
    els.status = $("#fin-status");
    els.search = $("#fin-search");
    els.reset = $("#fin-reset");
    els.newChip = $("#fin-new-chip");
    els.filterBtn = $("#fin-filter-btn");
    els.filterCnt = $("#fin-filter-cnt");
    els.filterPanel = $("#fin-filter-panel");
    els.filterClear = $("#fin-filter-clear");
    els.periods = $("#f-periods");
    els.profit = $("#fin-profit");
    els.activeFilters = $("#fin-active-filters");
    els.head = $("#fin-head");
    els.body = $("#fin-body");
    els.pager = $("#fin-pager");
    els.total = $("#fin-total");
    els.wrap = $(".fin-table-wrap");
    bindEvents();
    bindDrawer();
    renderHead();
    load();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
