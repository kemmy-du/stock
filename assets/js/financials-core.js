/* 股析 StockInsight — 财报汇总纯逻辑（浏览器挂 window.FinCore，Node 可 require） */
(function (root) {
  "use strict";

  const FIELDS = [
    "code", "name", "period",
    "q_rev", "q_np", "q_deduct", "q_gm", "q_nm",
    "rev_qoq", "np_qoq", "rev_yoy", "np_yoy",
    "pe_dyn", "pb", "mcap", "fcap",
    "y_rev", "y_np", "y_deduct", "y_gm", "y_nm", "y_rev_yoy", "y_np_yoy",
  ];

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

  function formatYi(v) {
    const n = num(v);
    if (n === null) return "—";
    return (n / 1e8).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function formatNum(v, digits) {
    const n = num(v);
    if (n === null) return "—";
    const d = digits == null ? 2 : digits;
    return n.toLocaleString("zh-CN", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
  function formatPct(v) {
    const n = num(v);
    if (n === null) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function periodLabel(dateStr) {
    if (!dateStr) return "—";
    const year = dateStr.slice(0, 4);
    const md = dateStr.slice(5);
    if (md === "03-31") return year + "一季报";
    if (md === "06-30") return year + "二季报";
    if (md === "09-30") return year + "三季报";
    if (md === "12-31") return year + "四季报";
    return dateStr;
  }

  function fromSnapshot(data) {
    const fields = (data && data.fields) || FIELDS;
    const rows = ((data && data.rows) || []).map((r) => {
      const o = {};
      fields.forEach((f, i) => { o[f] = r[i]; });
      return o;
    });
    return {
      fields,
      rows,
      generatedAt: (data && data.generated_at) || "—",
      tradeDate: (data && data.trade_date) || "—",
    };
  }

  function filterRows(rows, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.code || "").toLowerCase().includes(q) ||
      String(r.name || "").toLowerCase().includes(q));
  }

  function cmp(a, b) {
    if (typeof a === "string" || typeof b === "string") {
      return String(a).localeCompare(String(b), "zh-CN");
    }
    return a - b;
  }
  function sortRows(rows, keys) {
    const out = rows.slice();
    out.sort((ra, rb) => {
      for (const { key, dir } of keys) {
        const a = ra[key];
        const b = rb[key];
        const an = a == null || a === "";
        const bn = b == null || b === "";
        if (an && bn) continue;
        if (an) return 1;   // 空值永远置底
        if (bn) return -1;
        const c = cmp(a, b);
        if (c !== 0) return c * dir;
      }
      return 0;
    });
    return out;
  }

  function paginate(rows, page, size) {
    const pages = Math.max(1, Math.ceil(rows.length / size) || 1);
    const cur = Math.min(Math.max(1, page), pages);
    return { items: rows.slice((cur - 1) * size, cur * size), pages, page: cur };
  }

  const Q_BY_MONTH = { "03": 1, "06": 2, "09": 3, "12": 4 };
  const PREV_MD = { 2: "03-31", 3: "06-30", 4: "09-30" };
  function prevDate(dateStr) {
    const y = +dateStr.slice(0, 4);
    const q = Q_BY_MONTH[dateStr.slice(5, 7)];
    if (q === 1) return (y - 1) + "-12-31";
    return y + "-" + PREV_MD[q];
  }

  function trendSeries(history, mode, limit) {
    const byDate = {};
    for (const r of history || []) {
      if (r && r.date) byDate[r.date] = r;
    }
    const dates = Object.keys(byDate).sort();
    const singles = dates.map((d) => {
      const cur = byDate[d];
      const prev = byDate[prevDate(d)];
      const single = (f) => {
        if (cur[f] == null) return null;
        if (d.slice(5) === "03-31") return cur[f];
        return prev && prev[f] != null ? cur[f] - prev[f] : null;
      };
      return { date: d, rev: single("rev"), np: single("np"), gross: single("gross") };
    });

    if (mode === "y") {
      const years = {};
      for (const s of singles) {
        const y = s.date.slice(0, 4);
        const a = years[y] = years[y] || { rev: 0, np: 0, gross: 0, n: 0, ok: true, grossOk: true };
        a.n++;
        if (s.rev == null || s.np == null) a.ok = false;
        if (s.gross == null) a.grossOk = false;
        a.rev += s.rev || 0;
        a.np += s.np || 0;
        a.gross += s.gross || 0;
      }
      const list = Object.keys(years).sort()
        .filter((y) => years[y].ok && years[y].n === 4)
        .slice(-(limit || 6))
        .map((y) => {
          const a = years[y];
          return { label: y, rev: a.rev, np: a.np, gross: a.grossOk ? a.gross : null };
        });
      return toSeries(list);
    }

    const list = singles.slice(-(limit || 12)).map((s) => ({
      label: s.date.slice(0, 4) + "Q" + Q_BY_MONTH[s.date.slice(5, 7)],
      rev: s.rev, np: s.np, gross: s.gross,
    }));
    return toSeries(list);
  }

  function toSeries(list) {
    const yi = (v) => (v == null ? null : Math.round(v / 1e8 * 100) / 100);
    const pct = (a, b) => (a == null || b == null || b === 0 ? null : Math.round(a / b * 10000) / 100);
    return {
      labels: list.map((x) => x.label),
      revenue: list.map((x) => yi(x.rev)),
      profit: list.map((x) => yi(x.np)),
      gm: list.map((x) => pct(x.gross, x.rev)),
      nm: list.map((x) => pct(x.np, x.rev)),
    };
  }

  const api = {
    FIELDS, formatYi, formatNum, formatPct, periodLabel,
    fromSnapshot, filterRows, sortRows, paginate, trendSeries,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FinCore = api;
})(typeof window !== "undefined" ? window : globalThis);
