/* 股析 StockInsight — 中信期货多空持仓实时展示 */
(function () {
  "use strict";
  const { $, $$, loadJSONP } = window.SI;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 东方财富数据中心 · 期货龙虎榜（会员成交持仓），按机构简称筛选中信期货
  const API = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    + "?reportName=RPT_FUTU_DAILYPOSITION&columns=ALL"
    + "&filter=" + encodeURIComponent("(ORG_NAME_ABBR_NEW='中信期货')")
    + "&pageSize=500&source=WEB&client=WEB";

  const REFRESH_MS = 5 * 60 * 1000;

  // 合约代码后缀 → 交易所
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

  async function initCitic() {
    const body = $("#citic-body");
    if (!body) return;

    const statusEl = $("#citic-status");
    const searchEl = $("#citic-search");
    const exEl = $("#citic-exchange");

    const state = {
      rows: [], date: "",
      filter: "ALL", q: "", sort: "long", dir: -1,
      timer: null, ticker: null, nextAt: 0, busy: false, fail: 0, loaded: false,
    };

    // 状态条：一次构建，后续仅改文本
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
      const left = Math.max(0, Math.round((state.nextAt - Date.now()) / 1000));
      setTick(state.fail ? `刷新失败，${left}s 后重试` : `${left}s 后刷新`, !!state.fail);
    }
    function schedule() {
      clearTimeout(state.timer);
      const wait = state.fail ? Math.min(REFRESH_MS * Math.pow(2, state.fail), 600000) : REFRESH_MS;
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
        const json = await loadJSONP(API, { timeout: 15000 });
        const data = (json && json.result && json.result.data) || [];
        if (!data.length) throw new Error("接口返回为空");
        // 取最新交易日
        let maxDate = "";
        data.forEach((r) => {
          const d = (r.TRADE_DATE || "").slice(0, 10);
          if (d > maxDate) maxDate = d;
        });
        const rows = data.filter((r) => (r.TRADE_DATE || "").slice(0, 10) === maxDate);
        state.date = maxDate;
        state.rows = rows;
        state.fail = 0;
        renderStatus();
        renderKPIs(rows);
        renderTable();
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

    // 后台标签页暂停轮询，回前台补刷
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
