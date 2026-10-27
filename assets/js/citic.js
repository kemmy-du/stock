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
  // 只取页面用到的列，响应体约为 columns=ALL 的 1/6
  const COLUMNS = "SECURITY_CODE,TRADE_DATE,LONG_POSITION,SHORT_POSITION,LP_CHANGE,SP_CHANGE";
  const PAGE_SIZE = 500;   // 服务端单页硬上限
  const TARGET_DAYS = 5;   // 对比展示的完整交易日数
  const MAX_PAGES = 10;

  function buildUrl(pageNumber) {
    return API_ROOT
      + "?reportName=RPT_FUTU_DAILYPOSITION&columns=" + COLUMNS
      + "&filter=" + MEMBER_FILTER
      + "&pageSize=" + PAGE_SIZE
      + "&pageNumber=" + pageNumber
      + "&sortColumns=TRADE_DATE&sortTypes=-1"
      + "&source=WEB&client=WEB";
  }

  function fetchPage(pageNumber) {
    return fetch(buildUrl(pageNumber), { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error("接口请求失败 " + res.status);
      return res.json();
    }).then((j) => (j && j.result && j.result.data) || []);
  }

  // 单页上限 500 行，一天约 290 行，需翻页聚合；最老一天可能被页边界截断，需丢弃
  async function fetchCitic() {
    const dateMap = {};
    let reachedEnd = false;

    function consume(data) {
      if (!data || !data.length) { reachedEnd = true; return; }
      for (const r of data) {
        const d = (r.TRADE_DATE || "").slice(0, 10);
        if (d) (dateMap[d] = dateMap[d] || []).push(r);
      }
      if (data.length < PAGE_SIZE) reachedEnd = true;
    }

    // 前 4 页并行（约覆盖 6 个交易日，足够 5 个完整日）
    const first = await Promise.all([1, 2, 3, 4].map(fetchPage));
    first.forEach(consume);

    // 极端情况下数据不足，继续顺序补页
    let page = 5;
    while (!reachedEnd && Object.keys(dateMap).length <= TARGET_DAYS && page <= MAX_PAGES) {
      consume(await fetchPage(page));
      page++;
    }

    const sorted = Object.keys(dateMap).sort().reverse();
    // 未取到数据末尾时，最老的一天可能不完整 → 丢弃
    const complete = reachedEnd ? sorted : sorted.slice(0, Math.max(0, sorted.length - 1));
    const useDates = complete.slice(0, TARGET_DAYS);
    if (!useDates.length) throw new Error("暂无中信期货持仓数据");

    const prunedMap = {};
    for (const d of useDates) prunedMap[d] = dateMap[d];
    return { date: useDates[0], rows: prunedMap[useDates[0]], dateMap: prunedMap, dates: useDates };
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

  const POLL_START = 15 * 60 + 30;  // 盘后 15:30 起开始检查当日数据
  const POLL_STOP = 21 * 60;        // 21:00 后不再轮询
  const POLL_STEP = 10 * 60 * 1000; // 每 10 分钟一次

  const pad2 = (n) => String(n).padStart(2, "0");
  const localDate = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());

  // 每天 07:00 的下一个时刻
  function next7() {
    const now = new Date();
    const n = new Date(now);
    n.setHours(7, 0, 0, 0);
    if (n <= now) n.setDate(n.getDate() + 1);
    return n;
  }

  async function initCitic() {
    const body = $("#citic-body");
    if (!body) return;

    const statusEl = $("#citic-status");
    const searchEl = $("#citic-search");
    const exEl = $("#citic-exchange");

    const state = {
      rows: [], date: "", dateMap: {}, dates: [],
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
    function clockLabel(d) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const target = new Date(d); target.setHours(0, 0, 0, 0);
      const diff = Math.round((target - today) / 86400000);
      const prefix = diff === 0 ? "今天" : diff === 1 ? "明天" : "周" + "日一二三四五六"[d.getDay()];
      return prefix + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }

    // 交易日盘后 15:30-21:00 每 10 分钟检查当日持仓是否已公布；
    // 当日数据已到位、非交易日或窗口外，则退化为次日 07:00 兜底
    function nextRunAt() {
      const now = new Date();
      const weekday = now.getDay() >= 1 && now.getDay() <= 5;
      const stop = new Date(now); stop.setHours(Math.floor(POLL_STOP / 60), POLL_STOP % 60, 0, 0);
      if (weekday && now < stop && state.date !== localDate(now)) {
        const slot = new Date(now); slot.setHours(Math.floor(POLL_START / 60), POLL_START % 60, 0, 0);
        if (slot <= now) {
          slot.setTime(slot.getTime() + (Math.floor((now - slot) / POLL_STEP) + 1) * POLL_STEP);
        }
        if (slot <= stop) return slot;
      }
      return next7();
    }

    function countdown() {
      if (state.busy || !rsTick) return;
      if (state.fail) {
        const left = Math.max(0, Math.round((state.nextAt - Date.now()) / 1000));
        setTick(`刷新失败，${Math.max(1, Math.ceil(left / 60))} 分钟后重试`, true);
        return;
      }
      const left = Math.max(0, Math.round((state.nextAt - Date.now()) / 1000));
      const hh = String(Math.floor(left / 3600)).padStart(2, "0");
      const mm = String(Math.floor((left % 3600) / 60)).padStart(2, "0");
      const ss = String(left % 60).padStart(2, "0");
      setTick(`下次更新 ${clockLabel(new Date(state.nextAt))}（${hh}:${mm}:${ss} 后）`, false);
    }
    function schedule() {
      clearTimeout(state.timer);
      // 成功后按 nextRunAt 计划；失败则指数退避重试（1/2/4/8… 分钟，上限 10 分钟）
      const wait = state.fail === 0
        ? Math.max(1000, nextRunAt() - Date.now())
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
          <td class="num up">${fmtInt(long)}</td>
          <td class="num ${clsOf(lp)}">${fmtDelta(lp)}</td>
          <td class="num down">${fmtInt(short)}</td>
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
      const dates = (state.dates && state.dates.length ? state.dates : Object.keys(dm).sort().reverse()).slice(0, TARGET_DAYS);
      if (dates.length < 2) {
        wrap.innerHTML = '<tr><td colspan="7" class="empty-state">暂无历史数据，无法对比</td></tr>';
        dateEl.textContent = "";
        return;
      }

      const sums = dates.map((d) => {
        const rows = dm[d];
        const l = sumField(rows, "LONG_POSITION");
        const s = sumField(rows, "SHORT_POSITION");
        return { date: d, long: l, short: s, net: l - s };
      });

      dateEl.textContent = "近 " + sums.length + " 个交易日 · 截至 " + sums[0].date.slice(5);
      wrap.innerHTML = sums.map((cur, i) => {
        const prev = i < sums.length - 1 ? sums[i + 1] : null;
        const ld = prev ? cur.long - prev.long : null;
        const sd = prev ? cur.short - prev.short : null;
        const nd = prev ? cur.net - prev.net : null;
        const cell = (val, isDelta, color) => {
          if (val == null) return '<td class="num flat">—</td>';
          let cls;
          if (isDelta) cls = clsOf(val);
          else if (color === "up" || color === "down") cls = color;
          else cls = val > 0 ? "up" : val < 0 ? "down" : "";
          const txt = isDelta ? fmtDelta(val) : fmtInt(val);
          return '<td class="num ' + cls + '">' + txt + '</td>';
        };
        return '<tr>'
          + '<td class="c-cell-code"><span class="c-code num">' + esc(cur.date.slice(5)) + '</span></td>'
          + cell(cur.long, false, "up") + cell(ld, true)
          + cell(cur.short, false, "down") + cell(sd, true)
          + cell(cur.net, false, "") + cell(nd, true)
          + '</tr>';
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
        const { date, rows, dateMap, dates } = await fetchCitic();
        state.date = date;
        state.rows = rows;
        state.dateMap = dateMap || {};
        state.dates = dates || [];
        state.fail = 0;
        renderStatus();
        renderKPIs(rows);
        renderTable();
        renderComparison();
        state.loaded = true;
      } catch (e) {
        state.fail++;
        if (!state.loaded) {
          const fail = '<tr><td colspan="7" class="empty-state">数据加载失败，将自动重试。</td></tr>';
          body.innerHTML = fail;
          const cmp = document.getElementById("citic-compare-body");
          if (cmp) cmp.innerHTML = fail;
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
