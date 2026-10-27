/* 股析 StockInsight — 中信期货多空持仓实时展示 */
(function () {
  "use strict";
  const { $, $$ } = window.SI;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 东方财富数据中心 · 期货龙虎榜（会员成交持仓），按机构简称筛选中信期货
  // 关键：仅对中文值做 encodeURIComponent，外层用双引号，括号与引号不编码
  const API_ROOT = "https://datacenter-web.eastmoney.com/api/data/v1/get";
  const MEMBER_FILTER = "(ORG_NAME_ABBR_NEW=\"" + encodeURIComponent("中信期货") + "\")";

  function buildUrl(extraFilter, sort) {
    let url = API_ROOT
      + "?reportName=RPT_FUTU_DAILYPOSITION&columns=ALL"
      + "&filter=" + MEMBER_FILTER + (extraFilter || "")
      + "&pageSize=500&source=WEB&client=WEB";
    if (sort) url += "&sortColumns=TRADE_DATE&sortTypes=-1";
    return url;
  }

  // 两步取数：1) 取最新交易日；2) 拉该日全量（避免混入历史旧日期）
  async function fetchCitic() {
    const head = await fetch(buildUrl("", true), { cache: "no-store" });
    if (!head.ok) throw new Error("接口请求失败 " + head.status);
    const hj = await head.json();
    const hd = hj && hj.result && hj.result.data && hj.result.data[0];
    if (!hd) throw new Error("暂无中信期货持仓数据");
    const latestDate = (hd.TRADE_DATE || "").slice(0, 10);

    const all = await fetch(buildUrl("", true), { cache: "no-store" });
    if (!all.ok) throw new Error("接口请求失败 " + all.status);
    const aj = await all.json();
    const allData = (aj && aj.result && aj.result.data) || [];

    const dateSet = new Set();
    const dateMap = {};
    for (const r of allData) {
      const d = (r.TRADE_DATE || "").slice(0, 10);
      if (!d || d > latestDate) continue;
      dateSet.add(d);
      (dateMap[d] = dateMap[d] || []).push(r);
    }
    const dates = Array.from(dateSet).sort().reverse();
    return { date: latestDate, rows: dateMap[latestDate] || [], dateMap, dates };
  }

  // 交易所代码后缀 → 交易所
  const EX_MAP = { CFE: "CFFEX", SHF: "SHFE", DCE: "DCE", CZC: "CZCE", GFE: "GFEX", INE: "INE" };
  const EX_LABEL = { CFFEX: "中金所", SHFE: "上期所", DCE: "大商所", CZCE: "郑商所", GFEX: "广期所", INE: "能源中心" };

  function exOf(code) {
    const m = /\.([A-Z]{3})$/.exec(code || "");
    return m ? (EX_MAP[m[1]] || m[1]) : "";
  }
  function fmtInt(n) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("zh-CN");
  }
  function fmtDelta(n) {
    if (n == null || isNaN(n)) return "—";
    const v = Number(n);
    return (v > 0 ? "+" : "") + v.toLocaleString("zh-CN");
  }
  function clsOf(n) { return n > 0 ? "up" : n < 0 ? "down" : "flat"; }

  // 每天 07:00 的下一个时刻
  function next7() {
    const now = new Date();
    const n = new Date(now);
    n.setHours(7, 0, 0, 0);
    if (n <= now) n.setDate(n.getDate() + 1);
    return n;
  }
  function next7Label() {
    const n = next7();
    return (n.getDate() === new Date().getDate() ? "今天" : "明天") + " 07:00";
  }

  async function initCitic() {
    const body = $("#citic-body");
    if (!body) return;

    const statusEl = $("#citic-status");
    const searchEl = $("#citic-search");
    const exEl = $("#citic-exchange");

    const state = {
      rows: [], date: "", dateMap: {}, prevDate: "",
      filter: "ALL", q: "", sort: "long", dir: -1,
      timer: null, ticker: null, nextAt: 0, busy: false, fail: 0, loaded: false,
    };

    let rsMain = null, rsTick = null, rsBtn = null;
    if (statusEl) {
      statusEl.innerHTML =
        '<span class="rs-main"></span>' +
        '<span class="rs-live"><i class="rs-dot"></i><span class="rs-tick">—</span></span>' +
        '<button type="button" class="rs-btn" id="citic-refresh-btn" aria-label="立即刷新">刷新</button>';
      rsMain = $(".rs-main", statusEl);
      rsTick = $(".rs-tick", statusEl);
      rsBtn = $("#citic-refresh-btn");
      if (rsBtn) rsBtn.addEventListener("click", () => { refresh(true); });
    }

    function setTick(text, failed) {
      if (!rsTick) return;
      rsTick.textContent = text;
      if (rsTick.parentNode) rsTick.parentNode.classList.toggle("is-failed", !!failed);
    }
    function countdown() {
      if (state.busy || !rsTick) return;
      if (state.fail) {
        const left = Math.max(0, Math.round((state.nextAt - Date.now()) / 1000));
        setTick(`刷新失败，${Math.max(1, Math.ceil(left / 60))} 分钟后重试`, true);
        return;
      }
      const left = Math.max(0, Math.round((next7() - Date.now()) / 1000));
      const hh = String(Math.floor(left / 3600)).padStart(2, "0");
      const mm = String(Math.floor((left % 3600) / 60)).padStart(2, "0");
      const ss = String(left % 60).padStart(2, "0");
      setTick(`下次更新 ${next7Label()}（${hh}:${mm}:${ss} 后）`, false);
    }
    function schedule() {
      clearTimeout(state.timer);
      // 成功后每天 7 点；失败则指数退避重试（1/2/4/8… 分钟，上限 10 分钟）
      const wait = state.fail === 0
        ? next7() - Date.now()
        : Math.min(60000 * Math.pow(2, state.fail - 1), 600000);
      state.nextAt = Date.now() + wait;
      state.timer = setTimeout(() => { refresh(false); }, wait);
      countdown();
    }

    function renderKPIs(rows) {
      const long = rows.reduce((s, r) => s + (+r.LONG_POSITION || 0), 0);
      const short = rows.reduce((s, r) => s + (+r.SHORT_POSITION || 0), 0);
      const net = long - short;
      $("#kpi-long").textContent = fmtInt(long);
      $("#kpi-short").textContent = fmtInt(short);
      const netEl = $("#kpi-net");
      netEl.textContent = (net > 0 ? "+" : "") + fmtInt(net);
      netEl.className = "kpi-value num " + clsOf(net);
      $("#kpi-date").textContent = state.date;
    }

    function visibleRows() {
      let list = state.rows;
      if (state.filter !== "ALL") list = list.filter((r) => exOf(r.SECURITY_CODE) === state.filter);
      if (state.q) {
        const q = state.q.toLowerCase();
        list = list.filter((r) => (r.SECURITY_CODE || "").toLowerCase().indexOf(q) >= 0);
      }
      const dir = state.dir, key = state.sort;
      return list.slice().sort((a, b) => {
        let av, bv;
        switch (key) {
          case "long": av = +a.LONG_POSITION || 0; bv = +b.LONG_POSITION || 0; break;
          case "short": av = +a.SHORT_POSITION || 0; bv = +b.SHORT_POSITION || 0; break;
          case "lp": av = +a.LP_CHANGE || 0; bv = +b.LP_CHANGE || 0; break;
          case "sp": av = +a.SP_CHANGE || 0; bv = +b.SP_CHANGE || 0; break;
          case "net": av = (+a.LONG_POSITION || 0) - (+a.SHORT_POSITION || 0); bv = (+b.LONG_POSITION || 0) - (+b.SHORT_POSITION || 0); break;
          case "np": av = (+a.LP_CHANGE || 0) - (+a.SP_CHANGE || 0); bv = (+b.LP_CHANGE || 0) - (+b.SP_CHANGE || 0); break;
          default: av = (a.SECURITY_CODE || ""); bv = (b.SECURITY_CODE || "");
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }

    function renderTable() {
      const list = visibleRows();
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty-state">无匹配合约</td></tr>';
        return;
      }
      body.innerHTML = list.map((r) => {
        const long = +r.LONG_POSITION || 0;
        const short = +r.SHORT_POSITION || 0;
        const net = long - short;
        const lp = +r.LP_CHANGE || 0;
        const sp = +r.SP_CHANGE || 0;
        const np = lp - sp;
        const ex = exOf(r.SECURITY_CODE);
        return `
        <tr>
          <td class="c-cell-code"><span class="c-code num">${esc(r.SECURITY_CODE)}</span><span class="c-ex">${EX_LABEL[ex] || ex}</span></td>
          <td class="num">${fmtInt(long)}</td>
          <td class="num ${clsOf(lp)}">${fmtDelta(lp)}</td>
          <td class="num">${fmtInt(short)}</td>
          <td class="num ${clsOf(sp)}">${fmtDelta(sp)}</td>
          <td class="num ${clsOf(net)}">${(net > 0 ? "+" : "") + fmtInt(net)}</td>
          <td class="num ${clsOf(np)}">${fmtDelta(np)}</td>
        </tr>`;
      }).join("");
    }

    function sumField(rows, field) {
      let s = 0;
      for (const r of rows) s += (+r[field] || 0);
      return s;
    }

    function renderComparison() {
      const wrap = document.getElementById("citic-compare-body");
      const dateEl = document.getElementById("citic-compare-date");
      if (!wrap || !dateEl) return;
      const dm = state.dateMap;
      const dates = Object.keys(dm).sort().reverse();
      if (dates.length < 2) {
        wrap.innerHTML = '<tr><td colspan="4" class="empty-state">暂无历史数据，无法对比</td></tr>';
        dateEl.textContent = "";
        return;
      }
      const latest = dates[0], prev = dates[1];
      const lRows = dm[latest], pRows = dm[prev];
      const lLong = sumField(lRows, "LONG_POSITION");
      const lShort = sumField(lRows, "SHORT_POSITION");
      const lNet = lLong - lShort;
      const pLong = sumField(pRows, "LONG_POSITION");
      const pShort = sumField(pRows, "SHORT_POSITION");
      const pNet = pLong - pShort;

      dateEl.textContent = prev + " → " + latest;
      const cell = (val, isDelta) => {
        const cls = isDelta ? clsOf(val) : (val > 0 ? "up" : val < 0 ? "down" : "");
        const txt = isDelta ? fmtDelta(val) : fmtInt(val);
        return '<td class="num ' + cls + '">' + txt + '</td>';
      };
      const row = (label, pVal, lVal) => {
        const d = lVal - pVal;
        return '<tr><td class="c-cell-code"><span class="c-code num">' + esc(label) + '</span></td>'
          + cell(pVal, false) + cell(lVal, false) + cell(d, true) + '</tr>';
      };
      wrap.innerHTML = row("多单（多头持仓）", pLong, lLong)
        + row("空单（空头持仓）", pShort, lShort)
        + row("净持仓", pNet, lNet);
    }

    function renderStatus() {
      if (!rsMain) return;
      rsMain.innerHTML = `数据日期 <span class="num">${esc(state.date)}</span> · 共 <b class="num">${state.rows.length}</b> 个合约持仓`;
    }

    async function refresh(manual) {
      if (state.busy) return;
      state.busy = true;
      if (rsBtn) { rsBtn.disabled = true; rsBtn.classList.add("is-busy"); rsBtn.textContent = "刷新中"; }
      if (manual) setTick("正在刷新…", false);
      try {
        const { date, rows, dateMap, dates } = await fetchCitic();
        state.date = date;
        state.rows = rows;
        state.dateMap = dateMap || {};
        state.prevDate = (dates && dates[1]) || "";
        state.fail = 0;
        renderStatus();
        renderKPIs(rows);
        renderTable();
        renderComparison();
        state.loaded = true;
      } catch (e) {
        state.fail++;
        if (!state.loaded) {
          body.innerHTML = '<tr><td colspan="7" class="empty-state">数据加载失败，将自动重试。</td></tr>';
        }
      } finally {
        state.busy = false;
        if (rsBtn) { rsBtn.disabled = false; rsBtn.classList.remove("is-busy"); rsBtn.textContent = "刷新"; }
        schedule();
      }
    }

    // 搜索
    if (searchEl) searchEl.addEventListener("input", () => { state.q = searchEl.value.trim(); renderTable(); });
    // 交易所筛选
    if (exEl) $$("#citic-exchange .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.filter = chip.dataset.ex;
        $$("#citic-exchange .chip").forEach((c) => c.classList.toggle("active", c === chip));
        renderTable();
      });
    });
    // 表头排序
    $$(".citic-table th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (state.sort === k) state.dir *= -1;
        else { state.sort = k; state.dir = k === "code" ? 1 : -1; }
        $$(".citic-table th.sortable").forEach((t) => t.classList.remove("active", "asc", "desc"));
        th.classList.add("active", state.dir > 0 ? "asc" : "desc");
        renderTable();
      });
    });

    // 后台标签页暂停倒计时，回前台补刷
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

  document.addEventListener("DOMContentLoaded", () => { initCitic(); });
})();
