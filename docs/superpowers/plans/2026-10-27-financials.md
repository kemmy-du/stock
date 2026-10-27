# 财报汇总页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增覆盖全部 A 股的财报汇总页：多列组合排序、搜索、分页、季度/年度切换、个股趋势图（桌面抽屉 / 手机全屏面板）。

**Architecture:** 用 Python 脚本把东方财富的财报指标与估值数据聚合为 `data/financials.json` 快照（GitHub Actions 每交易日自动更新）；前端 `financials.html` + `assets/js/financials-core.js`（纯函数，可 Node 测试）+ `assets/js/financials.js`（DOM）读取快照，本地排序/搜索/分页；个股趋势按需请求单股历史并在浏览器内计算单季序列。

**Tech Stack:** 原生 HTML/CSS/JS、ECharts（复用 `assets/js/charts.js` 的加载器）、Python 3 标准库、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-27-financials-design.md`

## Global Constraints

- 不引入新的前端依赖；ECharts 只走现有 CDN 加载器。
- 金额在 JSON 中存「元」，页面统一显示「亿元」两位小数。
- 缺失值显示「—」，排序时永远置底。
- 移动端断点沿用站点 `640px`；触控目标 ≥ 40px。
- 东方财富接口非官方：脚本失败时保留旧快照并非零退出。
- 每个任务完成后单独 commit（中文提交信息，沿用仓库风格）。

---

### Task 1: 单季/同比/年化计算核心

**Files:**
- Create: `scripts/financials_calc.py`
- Test: `scripts/test_financials_calc.py`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `quarter_no(date_str) -> int`（1–4）
  - `prev_quarter_end(date_str) -> str`
  - `same_quarter_last_year(date_str) -> str`
  - `single_from_cum(cum: dict[str, float|None], date: str) -> float|None`
  - `pct(cur, prev) -> float|None`
  - `ratio(num, den) -> float|None`（百分数）
  - `annual_sum(cum: dict, year: int) -> float|None`（四个单季齐全才返回合计）
  - `build_metrics(series: dict, latest: str) -> dict`

- [ ] **Step 1: 写失败测试**

`scripts/test_financials_calc.py`:

```python
import unittest
from financials_calc import (
    quarter_no, prev_quarter_end, same_quarter_last_year,
    single_from_cum, pct, ratio, annual_sum, build_metrics,
)


class TestDerive(unittest.TestCase):
    def test_quarter_no(self):
        self.assertEqual(quarter_no("2026-03-31"), 1)
        self.assertEqual(quarter_no("2026-06-30"), 2)
        self.assertEqual(quarter_no("2026-09-30"), 3)
        self.assertEqual(quarter_no("2026-12-31"), 4)

    def test_prev_quarter_end(self):
        self.assertEqual(prev_quarter_end("2026-09-30"), "2026-06-30")
        self.assertEqual(prev_quarter_end("2026-03-31"), "2025-12-31")

    def test_same_quarter_last_year(self):
        self.assertEqual(same_quarter_last_year("2026-09-30"), "2025-09-30")

    def test_single_from_cum(self):
        cum = {"2026-03-31": 100.0, "2026-06-30": 260.0, "2026-09-30": 480.0}
        self.assertEqual(single_from_cum(cum, "2026-03-31"), 100.0)
        self.assertEqual(single_from_cum(cum, "2026-06-30"), 160.0)
        self.assertEqual(single_from_cum(cum, "2026-09-30"), 220.0)
        self.assertIsNone(single_from_cum(cum, "2026-12-31"))

    def test_pct_and_ratio(self):
        self.assertAlmostEqual(pct(120.0, 100.0), 20.0)
        self.assertAlmostEqual(pct(-50.0, 100.0), -150.0)
        self.assertIsNone(pct(100.0, 0))
        self.assertIsNone(pct(100.0, None))
        self.assertAlmostEqual(ratio(25.0, 100.0), 25.0)
        self.assertIsNone(ratio(25.0, 0))

    def test_annual_sum(self):
        cum = {
            "2025-03-31": 100.0, "2025-06-30": 260.0,
            "2025-09-30": 480.0, "2025-12-31": 700.0,
        }
        self.assertEqual(annual_sum(cum, 2025), 700.0)
        self.assertIsNone(annual_sum(cum, 2024))

    def test_build_metrics_q3(self):
        series = {
            "2025-09-30": {"rev": 300.0, "np": 30.0, "deduct": 28.0, "gross": 90.0},
            "2025-12-31": {"rev": 1000.0, "np": 100.0, "deduct": 95.0, "gross": 300.0},
            "2026-03-31": {"rev": 120.0, "np": 12.0, "deduct": 11.0, "gross": 36.0},
            "2026-06-30": {"rev": 300.0, "np": 30.0, "deduct": 29.0, "gross": 90.0},
            "2026-09-30": {"rev": 540.0, "np": 54.0, "deduct": 52.0, "gross": 162.0},
            "2024-12-31": {"rev": 800.0, "np": 80.0, "deduct": 78.0, "gross": 240.0},
            "2025-06-30": {"rev": 260.0, "np": 26.0, "deduct": 25.0, "gross": 78.0},
        }
        m = build_metrics(series, "2026-09-30")
        self.assertEqual(m["q_rev"], 240.0)          # 540 - 300
        self.assertEqual(m["q_np"], 24.0)            # 54 - 30
        self.assertEqual(m["q_deduct"], 23.0)        # 52 - 29
        self.assertAlmostEqual(m["q_gm"], 30.0)      # 72 / 240
        self.assertAlmostEqual(m["q_nm"], 10.0)      # 24 / 240
        self.assertAlmostEqual(m["rev_qoq"], 60.0)   # 240 vs 150
        self.assertAlmostEqual(m["np_qoq"], 60.0)    # 24 vs 15
        self.assertAlmostEqual(m["rev_yoy"], 20.0)   # 240 vs 200
        self.assertAlmostEqual(m["np_yoy"], 20.0)    # 24 vs 20
        self.assertAlmostEqual(m["y_rev"], 1000.0)
        self.assertAlmostEqual(m["y_rev_yoy"], 25.0)  # 1000 vs 800
        self.assertAlmostEqual(m["y_nm"], 10.0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd scripts && python3 -m unittest test_financials_calc -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'financials_calc'`）

- [ ] **Step 3: 实现 `scripts/financials_calc.py`**

```python
"""财报指标计算：累计值差分出单季，环比/同比/年化。"""

QUARTER_BY_MONTH = {3: 1, 6: 2, 9: 3, 12: 4}
QUARTER_MONTH = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}


def quarter_no(date_str):
    return QUARTER_BY_MONTH[int(date_str[5:7])]


def prev_quarter_end(date_str):
    year, q = int(date_str[:4]), quarter_no(date_str)
    if q == 1:
        return f"{year - 1}-12-31"
    return f"{year}-{QUARTER_MONTH[q - 1]}"


def same_quarter_last_year(date_str):
    return f"{int(date_str[:4]) - 1}{date_str[4:]}"


def single_from_cum(cum, date):
    if date not in cum or cum[date] is None:
        return None
    if quarter_no(date) == 1:
        return cum[date]
    prev = cum.get(prev_quarter_end(date))
    return None if prev is None else cum[date] - prev


def pct(cur, prev):
    if cur is None or prev is None or prev == 0:
        return None
    return (cur - prev) / abs(prev) * 100.0


def ratio(num, den):
    if num is None or den is None or den == 0:
        return None
    return num / den * 100.0


def annual_sum(cum, year):
    dates = [f"{year}-{m}" for m in QUARTER_MONTH.values()]
    vals = [single_from_cum(cum, d) for d in dates]
    return None if any(v is None for v in vals) else sum(vals)


def build_metrics(series, latest):
    """series: {date: {rev,np,deduct,gross}}；latest: 最新报告期。"""
    year = int(latest[:4])
    cur_q = quarter_no(latest)
    prev_date = prev_quarter_end(latest)
    yoy_date = same_quarter_last_year(latest)

    def pick(field, date):
        return (series.get(date) or {}).get(field)

    vals = {f: pick(f, latest) for f in ("rev", "np", "deduct", "gross")}
    q_rev = single_from_cum({d: v.get("rev") for d, v in series.items()}, latest)
    q_np = single_from_cum({d: v.get("np") for d, v in series.items()}, latest)
    q_deduct = single_from_cum({d: v.get("deduct") for d, v in series.items()}, latest)
    q_gross = single_from_cum({d: v.get("gross") for d, v in series.items()}, latest)

    def single(field, date):
        return single_from_cum({d: v.get(field) for d, v in series.items()}, date)

    prev_rev = single("rev", prev_date) if prev_date in series else None
    prev_np = single("np", prev_date) if prev_date in series else None
    yoy_rev = single("rev", yoy_date) if yoy_date in series else None
    yoy_np = single("np", yoy_date) if yoy_date in series else None

    y_rev = annual_sum({d: v.get("rev") for d, v in series.items()}, year - 1)
    y_np = annual_sum({d: v.get("np") for d, v in series.items()}, year - 1)
    y_deduct = annual_sum({d: v.get("deduct") for d, v in series.items()}, year - 1)
    y_gross = annual_sum({d: v.get("gross") for d, v in series.items()}, year - 1)
    prev_y_rev = annual_sum({d: v.get("rev") for d, v in series.items()}, year - 2)
    prev_y_np = annual_sum({d: v.get("np") for d, v in series.items()}, year - 2)

    return {
        "period": latest,
        "q_rev": q_rev, "q_np": q_np, "q_deduct": q_deduct,
        "q_gm": ratio(q_gross, q_rev), "q_nm": ratio(q_np, q_rev),
        "rev_qoq": pct(q_rev, prev_rev), "np_qoq": pct(q_np, prev_np),
        "rev_yoy": pct(q_rev, yoy_rev), "np_yoy": pct(q_np, yoy_np),
        "y_rev": y_rev, "y_np": y_np, "y_deduct": y_deduct,
        "y_gm": ratio(y_gross, y_rev), "y_nm": ratio(y_np, y_rev),
        "y_rev_yoy": pct(y_rev, prev_y_rev), "y_np_yoy": pct(y_np, prev_y_np),
        "cum_np": vals["np"], "cum_q": cur_q,
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd scripts && python3 -m unittest test_financials_calc -v`
Expected: 全部 PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add scripts/financials_calc.py scripts/test_financials_calc.py
git commit -m "feat(financials): 单季/环比/同比/年度聚合计算核心与测试"
```

---

### Task 2: 快照生成脚本与首个快照

**Files:**
- Create: `scripts/build_financials.py`
- Output: `data/financials.json`

**Interfaces:**
- Consumes: `financials_calc.build_metrics`（Task 1）。
- Produces: JSON 结构（后续前端依赖）：
  - `fields: ["code","name","period","q_rev","q_np","q_deduct","q_gm","q_nm","rev_qoq","np_qoq","rev_yoy","np_yoy","pe_dyn","pb","mcap","fcap","y_rev","y_np","y_deduct","y_gm","y_nm","y_rev_yoy","y_np_yoy"]`
  - `rows[i]` 顺序与 `fields` 一致；金额单位元、比率为 %。

- [ ] **Step 1: 实现抓取与组装**

`scripts/build_financials.py`:

```python
#!/usr/bin/env python3
"""生成 data/financials.json：全 A 股财报指标 + 最新估值快照。"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date

from financials_calc import build_metrics

API = "https://datacenter-web.eastmoney.com/api/data/v1/get"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"}
PAGE = 500
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "financials.json")

FIELDS = [
    "code", "name", "period",
    "q_rev", "q_np", "q_deduct", "q_gm", "q_nm",
    "rev_qoq", "np_qoq", "rev_yoy", "np_yoy",
    "pe_dyn", "pb", "mcap", "fcap",
    "y_rev", "y_np", "y_deduct", "y_gm", "y_nm", "y_rev_yoy", "y_np_yoy",
]


def fetch(report, columns, filt, page_number, sort_columns=None, sort_types=None):
    params = {
        "reportName": report, "columns": columns, "filter": filt,
        "pageSize": PAGE, "pageNumber": page_number,
        "source": "WEB", "client": "WEB",
    }
    if sort_columns:
        params["sortColumns"] = sort_columns
        params["sortTypes"] = sort_types or "-1"
    url = API + "?" + urllib.parse.urlencode(params, safe="(),='\"%")
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            result = body.get("result") or {}
            if body.get("success") is False and not result:
                return []
            return result.get("data") or []
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)
    return []


def fetch_all(report, columns, filt, sort_columns=None, sort_types=None):
    rows, page = [], 1
    while True:
        data = fetch(report, columns, filt, page, sort_columns, sort_types)
        rows.extend(data)
        if len(data) < PAGE:
            break
        page += 1
        time.sleep(0.08)
    return rows


def quarter_ends(today, count=8):
    ends, y, q = [], today.year, (today.month - 1) // 3 + 1
    for _ in range(count + 1):
        month = q * 3
        day = 31 if month in (3, 12) else 30
        d = date(y, month, day)
        if d <= today:
            ends.append(d.isoformat())
        q -= 1
        if q == 0:
            q, y = 4, y - 1
        if len(ends) == count:
            break
    return ends


def load_valuation():
    for _ in range(6):
        latest = fetch("RPT_VALUEANALYSIS_DET", "ALL", "", 1,
                       "TRADE_DATE", "-1")
        if not latest:
            time.sleep(2)
            continue
        trade_date = latest[0]["TRADE_DATE"][:10]
        rows = fetch_all("RPT_VALUEANALYSIS_DET", "ALL",
                         f"(TRADE_DATE='{trade_date}')")
        return trade_date, rows
    raise RuntimeError("估值数据为空")


def to_float(v):
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def main():
    today = date.today()
    dates = quarter_ends(today)
    trade_date, valuation = load_valuation()
    universe = {}
    for v in valuation:
        code = v.get("SECURITY_CODE")
        if not code:
            continue
        universe[code] = {
            "name": v.get("SECURITY_NAME_ABBR") or "",
            "mcap": to_float(v.get("TOTAL_MARKET_CAP")),
            "fcap": to_float(v.get("NOTLIMITED_MARKETCAP_A")),
            "pb": to_float(v.get("PB_MRQ")),
            "close": to_float(v.get("CLOSE_PRICE")),
        }

    series = {}  # code -> {date: {rev,np,deduct,gross}}
    coverage = {}
    for d in dates:
        rows = fetch_all(
            "RPT_F10_FINANCE_MAINFINADATA",
            "SECURITY_CODE,REPORT_DATE,TOTALOPERATEREVE,PARENTNETPROFIT,"
            "KCFJCXSYJLR,MLR,UPDATE_DATE",
            f"(REPORT_DATE='{d}')")
        latest_by_code = {}
        for r in rows:
            code = r.get("SECURITY_CODE")
            if code not in universe:
                continue
            prev = latest_by_code.get(code)
            if prev is None or (r.get("UPDATE_DATE") or "") >= (prev.get("UPDATE_DATE") or ""):
                latest_by_code[code] = r
        coverage[d] = len(latest_by_code)
        for code, r in latest_by_code.items():
            series.setdefault(code, {})[d] = {
                "rev": to_float(r.get("TOTALOPERATEREVE")),
                "np": to_float(r.get("PARENTNETPROFIT")),
                "deduct": to_float(r.get("KCFJCXSYJLR")),
                "gross": to_float(r.get("MLR")),
            }
        print(f"{d}: {len(rows)} rows, {len(latest_by_code)} A-share", file=sys.stderr)

    out_rows = []
    for code, info in universe.items():
        s = series.get(code)
        if not s:
            continue
        latest = max(s.keys())
        m = build_metrics(s, latest)
        cum_np, q = m.pop("cum_np"), m.pop("cum_q")
        pe_dyn = mcap / (cum_np * 4 / q) if mcap >= 0 else None
        row = {
            "code": code, "name": info["name"], "period": latest,
            **m,
            "pe_dyn": pe_dyn if cum_np and cum_np > 0 else None,
            "pb": info["pb"], "mcap": info["mcap"], "fcap": info["fcap"],
        }
        out_rows.append([row[f] for f in FIELDS])

    out_rows.sort(key=lambda r: (r[FIELDS.index("mcap")] is None,
                                 -(r[FIELDS.index("mcap")] or 0)))
    payload = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M"),
        "trade_date": trade_date,
        "coverage": {"dates": coverage, "total": len(out_rows)},
        "fields": FIELDS,
        "rows": out_rows,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"wrote {OUT}: {len(out_rows)} rows, "
          f"{os.path.getsize(OUT) / 1024:.0f} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行脚本生成快照**

Run: `cd scripts && python3 build_financials.py`
Expected: 终端输出 8 个报告期行数、`wrote .../data/financials.json: 5xxx rows, 8xx–15xx KB`

- [ ] **Step 3: 校验快照**

```bash
python3 - <<'EOF'
import json
d=json.load(open("data/financials.json"))
rows=d["rows"]; f=d["fields"]
i={k:n for n,k in enumerate(f)}
print("rows", len(rows), "trade_date", d["trade_date"], "generated", d["generated_at"])
for code in ("600519","000001","300750"):
    r=next((x for x in rows if x[i["code"]]==code), None)
    print(code, r and {k: r[i[k]] for k in ("name","period","q_rev","q_np","q_gm","q_nm","pe_dyn","pb","mcap","rev_yoy")})
EOF
```

Expected: 三只股票均有数据；`period` 为 2026-09-30 或 2026-06-30；金额量级合理（贵州茅台单季营收约数百亿）。

- [ ] **Step 4: 抽查与东方财富页面一致**

用浏览器打开 `https://data.eastmoney.com/notices/stock/600519.html` 或 F10 财务分析页，核对 2026 三季报单季营收/归母/扣非与快照一致（允许接口更新时间差异，若不一致以脚本计算过程复核）。

- [ ] **Step 5: 提交**

```bash
git add scripts/build_financials.py data/financials.json
git commit -m "feat(financials): 全 A 股财报快照生成脚本与首份数据"
```

---

### Task 3: 页面骨架与样式

**Files:**
- Create: `financials.html`
- Modify: `assets/css/style.css`（末尾追加）
- Modify: `assets/js/common.js:5-11`（导航）

**Interfaces:**
- Produces: 下列 DOM id 供 JS 使用：`fin-status`、`fin-search`、`fin-view`（chips 容器）、`fin-reset`、`fin-head`、`fin-body`、`fin-pager`、`fin-total`、`fin-drawer`、`fin-mask`、`fin-close`、`fin-drawer-body`、`fin-chart`、`fin-drawer-title`。

- [ ] **Step 1: 新建 `financials.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#F4F5F7" />
  <title>财报汇总 · 股析 StockInsight</title>
  <meta name="description" content="全 A 股财报汇总：营收、归母净利、扣非、毛利率、净利率、估值与环比同比，多列排序与个股趋势图。" />
  <link rel="stylesheet" href="assets/css/style.css?v=20261027e" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Crect%20width='100'%20height='100'%20rx='22'%20fill='%2322262B'/%3E%3Ctext%20x='50'%20y='68'%20font-size='52'%20text-anchor='middle'%20fill='white'%20font-family='sans-serif'%20font-weight='700'%3E%E6%9E%90%3C/text%3E%3C/svg%3E" />
</head>
<body>
  <header class="nav">
    <div class="nav-inner">
      <a class="brand" href="index.html">
        <span class="brand-mark">析</span>
        <span>股析 <small>STOCKINSIGHT</small></span>
      </a>
      <button class="nav-toggle" id="nav-toggle" aria-label="打开菜单">菜单</button>
      <nav class="nav-links" id="nav-links" aria-label="主导航"></nav>
    </div>
  </header>

  <main class="page-main">
    <div class="container">
      <section class="hero">
        <p class="eyebrow">全 A 股 · 财报汇总</p>
        <h1>一屏看完全 A 股的财报成色。</h1>
        <p>营收、归母净利、扣非净利、毛利率、净利率与估值指标，按最新报告期汇总；支持多列组合排序、搜索与个股趋势图。</p>
      </section>

      <div class="fin-toolbar">
        <label class="search-box">
          <span aria-hidden="true" style="color:var(--color-text-3)">⌕</span>
          <input id="fin-search" type="search" placeholder="搜索代码或名称，如 600519、茅台…" aria-label="搜索股票" />
        </label>
        <div class="citic-exchange" id="fin-view" role="group" aria-label="视图切换">
          <button class="chip active" data-view="q">季度</button>
          <button class="chip" data-view="y">年度</button>
        </div>
        <button type="button" class="chip" id="fin-reset">重置排序</button>
        <div class="radar-status" id="fin-status">正在加载快照…</div>
      </div>

      <div class="citic-table-wrap fin-table-wrap">
        <table class="citic-table fin-table">
          <thead id="fin-head"></thead>
          <tbody id="fin-body">
            <tr><td colspan="15"><div class="skeleton" style="height:320px"></div></td></tr>
          </tbody>
        </table>
      </div>

      <div class="fin-pager" id="fin-pager"></div>
      <p class="citic-note" id="fin-total">仅供研究参考，不构成投资建议。</p>
      <p class="citic-note">数据来源：东方财富财报指标与估值数据。金额单位为亿元；动态市盈率 = 总市值 ÷ 年化归母净利；环比/同比为单季口径。</p>
    </div>
  </main>

  <div class="fin-mask" id="fin-mask" hidden></div>
  <aside class="fin-drawer" id="fin-drawer" role="dialog" aria-modal="true" aria-labelledby="fin-drawer-title" hidden>
    <div class="fin-drawer-head">
      <div>
        <h2 id="fin-drawer-title">—</h2>
        <p class="fin-drawer-sub" id="fin-drawer-sub"></p>
      </div>
      <button type="button" class="fin-close" id="fin-close" aria-label="关闭">关闭</button>
    </div>
    <div class="fin-drawer-body" id="fin-drawer-body">
      <div class="citic-exchange" id="fin-chart-view" role="group" aria-label="趋势口径">
        <button class="chip active" data-view="q">按季度</button>
        <button class="chip" data-view="y">按年度</button>
      </div>
      <div class="fin-chart" id="fin-chart"></div>
      <div class="fin-drawer-metrics" id="fin-drawer-metrics"></div>
    </div>
  </aside>

  <footer class="footer" id="footer"></footer>

  <script defer src="assets/js/common.js?v=20261027e"></script>
  <script defer src="assets/js/charts.js?v=20261027e"></script>
  <script defer src="assets/js/financials-core.js?v=20261027e"></script>
  <script defer src="assets/js/financials.js?v=20261027e"></script>
</body>
</html>
```

- [ ] **Step 2: 追加样式到 `assets/css/style.css`**

```css
/* ---------- 财报汇总 ---------- */
.fin-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-6) 0 var(--space-4);
}
.fin-toolbar .radar-status { margin-left: auto; }
.fin-table-wrap { max-height: 72vh; overflow: auto; }
.fin-table { font-size: var(--text-sm); }
.fin-table th, .fin-table td { padding: var(--space-2) var(--space-3); }
.fin-table thead th { position: sticky; top: 0; z-index: 3; background: var(--color-surface-2); }
.fin-table .fin-c1 { position: sticky; left: 0; z-index: 4; background: var(--color-surface); text-align: left; min-width: 76px; }
.fin-table .fin-c2 { position: sticky; left: 76px; z-index: 4; background: var(--color-surface); text-align: left; min-width: 116px; }
.fin-table thead .fin-c1, .fin-table thead .fin-c2 { background: var(--color-surface-2); z-index: 5; }
.fin-table tbody tr { cursor: pointer; }
.fin-table .fin-period { display: block; font-size: var(--text-xs); color: var(--color-text-3); }
.fin-sort-badge { font-size: 10px; margin-left: 2px; color: var(--color-text-2); }
.fin-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-2);
}
.fin-pager button {
  min-width: 36px; min-height: 36px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--r-sm);
  color: var(--color-text-2);
  cursor: pointer;
}
.fin-pager button.active { background: var(--gray-800); border-color: var(--gray-800); color: var(--gray-0); }
.fin-pager button:disabled { opacity: 0.45; cursor: default; }
.fin-pager select { min-height: 36px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--color-surface); }
.fin-mask {
  position: fixed; inset: 0; z-index: 55;
  background: rgba(23, 25, 28, 0.34);
  opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
}
.fin-mask.open { opacity: 1; pointer-events: auto; }
.fin-drawer {
  position: fixed; top: 0; right: 0; z-index: 60;
  display: flex; flex-direction: column;
  width: min(520px, 92vw); height: 100dvh;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  transform: translateX(100%);
  transition: transform 0.25s ease;
}
.fin-drawer.open { transform: none; }
.fin-drawer-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border);
}
.fin-drawer-head h2 { font-size: var(--text-xl); margin: 0; }
.fin-drawer-sub { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--color-text-2); }
.fin-close {
  min-height: 40px; padding: 6px 14px;
  border: 1px solid var(--color-border); border-radius: var(--r-sm);
  background: var(--color-surface); color: var(--color-text-2); cursor: pointer;
}
.fin-drawer-body { flex: 1; overflow: auto; padding: var(--space-4) var(--space-5) var(--space-8); }
.fin-chart { height: 360px; margin-top: var(--space-3); }
.fin-chart .chart-fallback { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-3); font-size: var(--text-sm); }
.fin-drawer-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2) var(--space-4); margin-top: var(--space-4); }
.fin-drawer-metrics div { display: flex; justify-content: space-between; font-size: var(--text-sm); border-bottom: 1px dashed var(--color-border); padding: var(--space-2) 0; }
.fin-drawer-metrics span { color: var(--color-text-2); }
.fin-drawer-metrics b { font-variant-numeric: tabular-nums; }

@media (max-width: 640px) {
  .fin-toolbar { gap: var(--space-2); }
  .fin-toolbar .radar-status { margin-left: 0; width: 100%; }
  .fin-table-wrap { max-height: 65vh; }
  .fin-drawer {
    top: auto; bottom: 0; width: 100%; height: 100dvh;
    border-left: 0; border-top: 1px solid var(--color-border);
    border-radius: 12px 12px 0 0;
    transform: translateY(100%);
  }
  .fin-drawer.open { transform: none; }
  .fin-chart { height: 320px; }
  .fin-drawer-metrics { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: 导航加入「财报」**

`assets/js/common.js` 第 5–11 行：

```js
  const NAV_ITEMS = [
    { href: "index.html", label: "首页" },
    { href: "library.html", label: "报告库" },
    { href: "market.html", label: "市场概览" },
    { href: "financials.html", label: "财报" },
    { href: "citic.html", label: "中信多空" },
    { href: "about.html", label: "关于" },
  ];
```

- [ ] **Step 4: 本地打开验证骨架**

Run: `python3 -m http.server 8899`（仓库根目录）
Expected: `http://127.0.0.1:8899/financials.html` 页面出现骨架屏与工具栏，导航含「财报」，控制台无语法错误。

- [ ] **Step 5: 提交**

```bash
git add financials.html assets/css/style.css assets/js/common.js
git commit -m "feat(financials): 页面骨架、样式与导航入口"
```

---

### Task 4: 前端纯逻辑（排序/搜索/分页/趋势序列）

**Files:**
- Create: `assets/js/financials-core.js`
- Test: `scripts/test_financials_core.js`

**Interfaces:**
- Produces（`window.FinCore`，Node 下 `module.exports` 同名对象）：
  - `FIELDS`（与快照 `fields` 顺序一致的数组）
  - `formatYi(v) -> string`（`123.46`，缺失 `—`）
  - `formatPct(v) -> string`（`+12.34%`）
  - `formatNum(v, digits=2) -> string`
  - `periodLabel("2026-09-30") -> "2026三季报"`
  - `filterRows(rows, fmap, query) -> rows`
  - `sortRows(rows, keys) -> rows`（`keys: [{key, dir}]`，`dir: 1|-1`，空值置底）
  - `paginate(rows, page, size) -> {items, pages}`
  - `trendSeries(history, mode, limit) -> {labels, revenue, profit, gm, nm}`（金额亿元，比率 %）

- [ ] **Step 1: 写失败测试**

`scripts/test_financials_core.js`:

```js
const assert = require("assert");
const core = require("../assets/js/financials-core.js");

const fmap = { code: 0, name: 1, mcap: 2, q_np: 3 };
const rows = [
  ["600519", "贵州茅台", 2000000000000, 200],
  ["000001", "平安银行", 300000000000, 50],
  ["300750", "宁德时代", 1000000000000, -10],
  ["600000", "浦发银行", null, null],
];

assert.strictEqual(core.formatYi(123456789012), "1234.57");
assert.strictEqual(core.formatYi(null), "—");
assert.strictEqual(core.formatPct(12.345), "+12.35%");
assert.strictEqual(core.formatPct(-5), "-5.00%");
assert.strictEqual(core.formatPct(null), "—");
assert.strictEqual(core.periodLabel("2026-09-30"), "2026三季报");
assert.strictEqual(core.periodLabel("2025-12-31"), "2025年报");

assert.deepStrictEqual(
  core.filterRows(rows, fmap, "茅台").map((r) => r[0]),
  ["600519"]
);
assert.deepStrictEqual(
  core.filterRows(rows, fmap, "600").map((r) => r[0]),
  ["600519", "600000"]
);

// 多列：先按 mcap 降序，再按 q_np 升序；空值置底
const sorted = core.sortRows(rows, [
  { key: "mcap", dir: -1 },
  { key: "q_np", dir: 1 },
]);
assert.deepStrictEqual(sorted.map((r) => r[0]), ["600519", "300750", "000001", "600000"]);

const sorted2 = core.sortRows(rows, [{ key: "q_np", dir: 1 }]);
assert.deepStrictEqual(sorted2.map((r) => r[0]), ["300750", "000001", "600519", "600000"]);

const { items, pages } = core.paginate(rows, 1, 2);
assert.strictEqual(pages, 2);
assert.strictEqual(items.length, 2);

const history = [
  { date: "2025-03-31", rev: 100, np: 10, gross: 30 },
  { date: "2025-06-30", rev: 260, np: 26, gross: 78 },
  { date: "2025-09-30", rev: 480, np: 48, gross: 144 },
  { date: "2025-12-31", rev: 700, np: 70, gross: 210 },
  { date: "2026-03-31", rev: 120, np: 12, gross: 36 },
  { date: "2026-06-30", rev: 300, np: 30, gross: 90 },
];
const q = core.trendSeries(history, "q", 12);
assert.deepStrictEqual(q.labels, ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"]);
assert.deepStrictEqual(q.revenue, [1, 1.6, 2.2, 2.2, 1.2, 1.8]);
const y = core.trendSeries(history, "y", 6);
assert.deepStrictEqual(y.labels, ["2025"]);
assert.deepStrictEqual(y.revenue, [7]);
assert.strictEqual(y.gm[0], 30);

console.log("financials-core tests passed");
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/test_financials_core.js`
Expected: FAIL（`Cannot find module '../assets/js/financials-core.js'`）

- [ ] **Step 3: 实现 `assets/js/financials-core.js`**

```js
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
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function formatPct(v) {
    const n = num(v);
    if (n === null) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function formatNum(v, digits) {
    const n = num(v);
    if (n === null) return "—";
    return n.toLocaleString("zh-CN", {
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits,
    });
  }
  function periodLabel(dateStr) {
    if (!dateStr) return "—";
    const year = dateStr.slice(0, 4);
    const md = dateStr.slice(5);
    if (md === "03-31") return year + "一季报";
    if (md === "06-30") return year + "中报";
    if (md === "09-30") return year + "三季报";
    if (md === "12-31") return year + "年报";
    return dateStr;
  }
  function filterRows(rows, fmap, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return rows;
    const ci = fmap.code, ni = fmap.name;
    return rows.filter((r) => String(r[ci]).toLowerCase().includes(q) ||
      String(r[ni] || "").toLowerCase().includes(q));
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
        const a = ra[key], b = rb[key];
        const an = a == null, bn = b == null;
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
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const cur = Math.min(Math.max(1, page), pages);
    return { items: rows.slice((cur - 1) * size, cur * size), pages, page: cur };
  }
  const qMap = { "03": 1, "06": 2, "09": 3, "12": 4 };
  function prevDate(dateStr) {
    const y = +dateStr.slice(0, 4), q = qMap[dateStr.slice(5, 7)];
    return q === 1 ? (y - 1) + "-12-31" : y + "-" + String(q * 3 - 3).padStart(2, "0") + "-30";
  }
  function trendSeries(history, mode, limit) {
    const byDate = {};
    for (const r of history) {
      if (!r || !r.date) continue;
      byDate[r.date] = r;
    }
    const dates = Object.keys(byDate).sort();
    const singles = [];
    for (const d of dates) {
      const cur = byDate[d];
      const prev = byDate[prevDate(d)];
      const single = (f) => {
        if (cur[f] == null) return null;
        if (d.slice(5) === "03-31") return cur[f];
        return prev && prev[f] != null ? cur[f] - prev[f] : null;
      };
      singles.push({ date: d, rev: single("rev"), np: single("np"), gross: single("gross") });
    }
    if (mode === "y") {
      const years = {};
      for (const s of singles) {
        const y = s.date.slice(0, 4);
        const a = years[y] = years[y] || { rev: 0, np: 0, gross: 0, n: 0, ok: true };
        a.n++;
        if (s.rev == null || s.np == null || s.gross == null) a.ok = false;
        a.rev += s.rev || 0; a.np += s.np || 0; a.gross += s.gross || 0;
      }
      const list = Object.keys(years).sort().filter((y) => years[y].ok && years[y].n === 4)
        .slice(-(limit || 6))
        .map((y) => {
          const a = years[y];
          return { label: y, rev: a.rev, np: a.np, gross: a.gross };
        });
      return toSeries(list, (x) => x.label);
    }
    const list = singles.slice(-(limit || 12)).map((s) => ({
      label: s.date.slice(0, 4) + "Q" + qMap[s.date.slice(5, 7)],
      rev: s.rev, np: s.np, gross: s.gross,
    }));
    return toSeries(list, (x) => x.label);
  }
  function toSeries(list, labelOf) {
    const yi = (v) => (v == null ? null : Math.round(v / 1e8 * 100) / 100);
    const pct = (a, b) => (a == null || b == null || b === 0 ? null : Math.round(a / b * 10000) / 100);
    return {
      labels: list.map(labelOf),
      revenue: list.map((x) => yi(x.rev)),
      profit: list.map((x) => yi(x.np)),
      gm: list.map((x) => pct(x.gross, x.rev)),
      nm: list.map((x) => pct(x.np, x.rev)),
    };
  }

  const api = {
    FIELDS, formatYi, formatPct, formatNum, periodLabel,
    filterRows, sortRows, paginate, trendSeries,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FinCore = api;
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_financials_core.js`
Expected: `financials-core tests passed`

- [ ] **Step 5: 提交**

```bash
git add assets/js/financials-core.js scripts/test_financials_core.js
git commit -m "feat(financials): 前端排序/搜索/分页/趋势序列纯逻辑与测试"
```

---

### Task 5: 列表渲染（加载、视图切换、排序、搜索、分页）

**Files:**
- Create: `assets/js/financials.js`
- Modify: `financials.html`（若无改动可跳过）

**Interfaces:**
- Consumes: `window.SI`、`window.FinCore`、`data/financials.json` 结构（Task 2）、DOM id（Task 3）。
- Produces: `openDrawer(code)` / `closeDrawer()` 内部函数（Task 6 复用同一文件）。

- [ ] **Step 1: 实现列表逻辑**

`assets/js/financials.js`（本任务先实现到列表，抽屉函数留到 Task 6 填充；为避免占位符，这里直接写完整文件，包含 Task 6 的抽屉实现也可，按本计划顺序执行时 Task 6 只做校验）：

```js
/* 股析 StockInsight — 财报汇总页 */
(function () {
  "use strict";
  const { $, $$, failHint } = window.SI;
  const C = window.FinCore;

  const VIEW_COLUMNS = {
    q: [
      { key: "code", label: "代码", cls: "fin-c1", sortable: true, type: "text" },
      { key: "name", label: "名称", cls: "fin-c2", sortable: true, type: "name" },
      { key: "q_rev", label: "营收", sortable: true, type: "yi" },
      { key: "q_np", label: "归母净利", sortable: true, type: "yi" },
      { key: "q_deduct", label: "扣非净利", sortable: true, type: "yi" },
      { key: "q_gm", label: "毛利率", sortable: true, type: "pct" },
      { key: "q_nm", label: "净利率", sortable: true, type: "pct" },
      { key: "pe_dyn", label: "动态 PE", sortable: true, type: "num" },
      { key: "pb", label: "PB", sortable: true, type: "num" },
      { key: "mcap", label: "总市值", sortable: true, type: "yi" },
      { key: "fcap", label: "流通市值", sortable: true, type: "yi" },
      { key: "rev_qoq", label: "营收环比", sortable: true, type: "pctSigned" },
      { key: "np_qoq", label: "归母环比", sortable: true, type: "pctSigned" },
      { key: "rev_yoy", label: "营收同比", sortable: true, type: "pctSigned" },
      { key: "np_yoy", label: "归母同比", sortable: true, type: "pctSigned" },
    ],
    y: [
      { key: "code", label: "代码", cls: "fin-c1", sortable: true, type: "text" },
      { key: "name", label: "名称", cls: "fin-c2", sortable: true, type: "name" },
      { key: "y_rev", label: "营收", sortable: true, type: "yi" },
      { key: "y_np", label: "归母净利", sortable: true, type: "yi" },
      { key: "y_deduct", label: "扣非净利", sortable: true, type: "yi" },
      { key: "y_gm", label: "毛利率", sortable: true, type: "pct" },
      { key: "y_nm", label: "净利率", sortable: true, type: "pct" },
      { key: "pe_dyn", label: "动态 PE", sortable: true, type: "num" },
      { key: "pb", label: "PB", sortable: true, type: "num" },
      { key: "mcap", label: "总市值", sortable: true, type: "yi" },
      { key: "fcap", label: "流通市值", sortable: true, type: "yi" },
      { key: "y_rev_yoy", label: "营收同比", sortable: true, type: "pctSigned" },
      { key: "y_np_yoy", label: "归母同比", sortable: true, type: "pctSigned" },
    ],
  };

  const state = {
    fields: C.FIELDS, fmap: {}, rows: [], view: "q",
    query: "", page: 1, size: 100,
    sortKeys: [{ key: "mcap", dir: -1 }],
    loaded: false, chartMode: "q", current: null, historyCache: {},
  };

  const els = {};
  let timer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const clsOf = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
  const cellVal = (row, key) => row[state.fmap[key]];

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
    if (col.type === "num" || col.type === "yi" || col.type === "pct") {
      return "num" + (col.key === "q_np" || col.key === "y_np" ? " " + clsOf(v) : "");
    }
    return "";
  }

  function currentRows() {
    let rows = C.filterRows(state.rows, state.fmap, state.query);
    rows = C.sortRows(rows, state.sortKeys);
    return rows;
  }

  function renderHead() {
    const cols = VIEW_COLUMNS[state.view];
    els.head.innerHTML = "<tr>" + cols.map((col) => {
      const keys = state.sortKeys;
      const idx = keys.findIndex((k) => k.key === col.key);
      const dir = idx >= 0 ? (keys[idx].dir < 0 ? "desc" : "asc") : "";
      const badge = state.sortKeys.length > 1 && idx >= 0
        ? '<span class="fin-sort-badge">' + (idx + 1) + "</span>" : "";
      return '<th class="sortable num ' + (col.cls || "") + " " + dir +
        '" data-key="' + col.key + '" title="点击排序，Shift+点击追加">' +
        col.label + badge + "</th>";
    }).join("");
  }

  function renderBody() {
    const cols = VIEW_COLUMNS[state.view];
    const rows = currentRows();
    const pg = C.paginate(rows, state.page, state.size);
    state.page = pg.page;
    if (!pg.items.length) {
      els.body.innerHTML = '<tr><td colspan="' + cols.length +
        '" class="empty-state">无匹配股票</td></tr>';
    } else {
      els.body.innerHTML = pg.items.map((r) => {
        const code = r[state.fmap.code];
        return '<tr data-code="' + esc(code) + '">' + cols.map((col) => {
          const v = cellVal(r, col.key);
          if (col.key === "code") return '<td class="fin-c1"><span class="num">' + esc(code) + "</span></td>";
          if (col.key === "name") {
            return '<td class="fin-c2"><span>' + esc(v) + '</span><span class="fin-period">' +
              esc(C.periodLabel(r[state.fmap.period])) + "</span></td>";
          }
          return '<td class="' + cellCls(col, v) + '">' + fmtCell(col, v) + "</td>";
        }).join("") + "</tr>";
      }).join("");
    }
    renderPager(rows.length, pg);
    els.total.textContent = "共 " + rows.length + " 只 · 数据生成于 " + state.generatedAt +
      " · 仅供研究参考，不构成投资建议。";
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
      '<select id="fin-size">' +
      [50, 100, 200].map((n) => '<option value="' + n + '"' +
        (n === state.size ? " selected" : "") + ">每页 " + n + "</option>").join("") +
      "</select>";
    const sel = els.pager.querySelector("#fin-size");
    if (sel) sel.addEventListener("change", () => {
      state.size = +sel.value; state.page = 1; renderBody();
    });
  }

  function updateStatus() {
    if (!els.status) return;
    els.status.innerHTML = "交易日 <span class=\"num\">" + esc(state.tradeDate) +
      "</span> · 覆盖 <b class=\"num\">" + state.rows.length + "</b> 只 A 股";
  }

  async function load() {
    try {
      const res = await fetch("data/financials.json", { cache: "no-store" });
      if (!res.ok) throw new Error("快照加载失败 " + res.status);
      const data = await res.json();
      state.fields = data.fields || C.FIELDS;
      state.fmap = {};
      state.fields.forEach((f, i) => { state.fmap[f] = i; });
      state.rows = data.rows || [];
      state.generatedAt = data.generated_at || "—";
      state.tradeDate = data.trade_date || "—";
      state.loaded = true;
      updateStatus();
      renderHead();
      renderBody();
    } catch (e) {
      els.body.innerHTML = '<tr><td colspan="15" class="empty-state">数据加载失败，请稍后重试。</td></tr>';
      failHint("财报数据加载失败，请稍后重试。");
    }
  }

  function bindEvents() {
    els.search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = els.search.value;
        state.page = 1;
        renderBody();
      }, 120);
    });
    $$("#fin-view .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (state.view === chip.dataset.view) return;
        state.view = chip.dataset.view;
        $$("#fin-view .chip").forEach((c) => c.classList.toggle("active", c === chip));
        state.page = 1;
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
    els.head.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-key]");
      if (!th) return;
      const key = th.dataset.key;
      const idx = state.sortKeys.findIndex((k) => k.key === key);
      if (e.shiftKey) {
        if (idx >= 0) {
          if (state.sortKeys[idx].dir < 0) state.sortKeys[idx].dir = 1;
          else state.sortKeys.splice(idx, 1);
        } else state.sortKeys.push({ key, dir: -1 });
      } else if (idx >= 0 && state.sortKeys.length === 1) {
        state.sortKeys = state.sortKeys[idx].dir < 0
          ? [{ key, dir: 1 }] : [{ key: "mcap", dir: -1 }];
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
      renderBody();
    });
    els.body.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-code]");
      if (tr) openDrawer(tr.dataset.code);
    });
  }

  function init() {
    els.status = $("#fin-status");
    els.search = $("#fin-search");
    els.reset = $("#fin-reset");
    els.head = $("#fin-head");
    els.body = $("#fin-body");
    els.pager = $("#fin-pager");
    els.total = $("#fin-total");
    bindEvents();
    load();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
```

- [ ] **Step 2: 本地验证列表**

Run: `python3 -m http.server 8899`（仓库根目录）
在浏览器打开 `http://127.0.0.1:8899/financials.html?t=1`，等待加载后检查：

- 状态条显示交易日与覆盖只数（约 5400–5500）
- 表格 15 列、金额两位小数、缺失显示「—」
- 点击「营收」表头降序；Shift 点击「归母净利」出现 ①②
- 搜索「茅台」只剩贵州茅台；清空恢复
- 切到「年度」为 13 列；分页按钮/每页条数可用
- 控制台无报错

- [ ] **Step 3: 提交**

```bash
git add assets/js/financials.js
git commit -m "feat(financials): 列表加载、季度年度切换、多列排序、搜索与分页"
```

---

### Task 6: 个股抽屉/全屏面板与趋势图

**Files:**
- Modify: `assets/js/charts.js`（新增 `initFinancialTrend` 并导出）
- Modify: `assets/js/financials.js`（补 `openDrawer/closeDrawer/loadHistory/renderDrawer`）
- Modify: `financials.html`（无改动）

**Interfaces:**
- Consumes: `window.SICharts.initFinancialTrend(el, series)`；`window.FinCore.trendSeries(history, mode, limit)`。
- Produces: 全局面板交互与 `#code` 深链。

- [ ] **Step 1: 在 charts.js 增加趋势图**

在 `window.SICharts` 导出行之前加入：

```js
  /* 财报趋势：营收/归母柱状 + 毛利率/净利率折线（双轴） */
  function initFinancialTrend(el, data) {
    if (!el) return;
    ensureEcharts(() => {
      if (!data || !data.labels.length) {
        el.innerHTML = '<div class="chart-fallback">暂无可展示的历史数据</div>';
        return;
      }
      const chart = echarts.getInstanceByDom(el) || echarts.init(el);
      chart.setOption({
        animationDuration: 400,
        textStyle: { fontFamily: "-apple-system, PingFang SC, sans-serif" },
        color: ["#C2402F", "#757A83", "#22262B", "#A8ADB5"],
        tooltip: {
          trigger: "axis",
          confine: true,
          backgroundColor: "rgba(255,255,255,0.96)",
          borderColor: "#E2E4E8",
          textStyle: { color: "#17191C", fontSize: 12 },
          extraCssText: "box-shadow:0 4px 14px rgba(23,25,28,.08);border-radius:8px;",
        },
        legend: { top: 0, textStyle: { color: "#757A83", fontSize: 11 } },
        grid: { left: 52, right: 44, top: 40, bottom: 28 },
        xAxis: {
          type: "category",
          data: data.labels,
          axisLine: { lineStyle: { color: "#ECEEF1" } },
          axisTick: { show: false },
          axisLabel: { color: "#757A83", fontSize: 10 },
        },
        yAxis: [
          {
            type: "value",
            name: "亿元",
            nameTextStyle: { color: "#A8ADB5", fontSize: 10 },
            splitLine: { lineStyle: { color: "#ECEEF1" } },
            axisLabel: { color: "#757A83", fontSize: 10 },
          },
          {
            type: "value",
            name: "%",
            nameTextStyle: { color: "#A8ADB5", fontSize: 10 },
            splitLine: { show: false },
            axisLabel: { color: "#757A83", fontSize: 10 },
          },
        ],
        series: [
          {
            name: "营收", type: "bar", data: data.revenue, yAxisIndex: 0,
            barMaxWidth: 16, itemStyle: { color: "rgba(194,64,47,0.75)", borderRadius: [2, 2, 0, 0] },
          },
          {
            name: "归母净利", type: "bar", data: data.profit, yAxisIndex: 0,
            barMaxWidth: 16, itemStyle: { color: "rgba(117,122,131,0.75)", borderRadius: [2, 2, 0, 0] },
          },
          {
            name: "毛利率", type: "line", data: data.gm, yAxisIndex: 1,
            symbol: "circle", symbolSize: 5, connectNulls: true,
            lineStyle: { width: 2, color: "#22262B" }, itemStyle: { color: "#22262B" },
          },
          {
            name: "净利率", type: "line", data: data.nm, yAxisIndex: 1,
            symbol: "circle", symbolSize: 5, connectNulls: true,
            lineStyle: { width: 2, color: "#A8ADB5" }, itemStyle: { color: "#A8ADB5" },
          },
        ],
      }, true);
      onResize(el, () => chart.resize());
    });
  }
```

并把导出改为：

```js
  window.SICharts = { initReportChart, initSparklines, initLineChart, initPeerChart, initFinancialTrend };
```

- [ ] **Step 2: 在 financials.js 增加抽屉逻辑**

在 `init()` 之前加入：

```js
  function exCode(code) {
    if (/^[6]/.test(code)) return code + ".SH";
    if (/^[03]/.test(code)) return code + ".SZ";
    return code + ".BJ";
  }

  async function loadHistory(code) {
    if (state.historyCache[code]) return state.historyCache[code];
    const url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
      + "?reportName=RPT_F10_FINANCE_MAINFINADATA"
      + "&columns=SECURITY_CODE,REPORT_DATE,TOTALOPERATEREVE,PARENTNETPROFIT,MLR"
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
        };
      }
    }
    const history = Object.values(byDate);
    state.historyCache[code] = history;
    return history;
  }

  function rowByCode(code) {
    return state.rows.find((r) => String(r[state.fmap.code]) === String(code)) || null;
  }

  function metricRow(label, value) {
    return "<div><span>" + label + "</span><b class=\"num\">" + value + "</b></div>";
  }

  function renderDrawerMetrics(row) {
    const v = (k) => row[state.fmap[k]];
    const isY = state.chartMode === "y";
    const rev = isY ? v("y_rev") : v("q_rev");
    const np = isY ? v("y_np") : v("q_np");
    const ded = isY ? v("y_deduct") : v("q_deduct");
    const gm = isY ? v("y_gm") : v("q_gm");
    const nm = isY ? v("y_nm") : v("q_nm");
    const yoyRev = isY ? v("y_rev_yoy") : v("rev_yoy");
    const yoyNp = isY ? v("y_np_yoy") : v("np_yoy");
    $("#fin-drawer-metrics").innerHTML = [
      metricRow(isY ? "全年营收" : "单季营收", C.formatYi(rev) + " 亿"),
      metricRow(isY ? "全年归母" : "单季归母", C.formatYi(np) + " 亿"),
      metricRow("扣非净利", C.formatYi(ded) + " 亿"),
      metricRow("毛利率", gm == null ? "—" : C.formatNum(gm, 1) + "%"),
      metricRow("净利率", nm == null ? "—" : C.formatNum(nm, 1) + "%"),
      metricRow("营收同比", C.formatPct(yoyRev)),
      metricRow("归母同比", C.formatPct(yoyNp)),
      metricRow("动态 PE / PB", C.formatNum(v("pe_dyn"), 1) + " / " + C.formatNum(v("pb"), 2)),
      metricRow("总市值 / 流通", C.formatYi(v("mcap")) + " / " + C.formatYi(v("fcap")) + " 亿"),
    ].join("");
  }

  async function renderChart() {
    const code = state.current;
    const el = $("#fin-chart");
    if (!code || !el) return;
    el.innerHTML = '<div class="chart-fallback">加载历史数据…</div>';
    try {
      const history = await loadHistory(code);
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
    const name = row[state.fmap.name];
    $("#fin-drawer-title").textContent = name + "（" + code + "）";
    $("#fin-drawer-sub").textContent = C.periodLabel(row[state.fmap.period]) + " · 估值 " + state.tradeDate;
    renderDrawerMetrics(row);
    renderChart();
    const drawer = $("#fin-drawer"), mask = $("#fin-mask");
    drawer.hidden = false; mask.hidden = false;
    requestAnimationFrame(() => {
      drawer.classList.add("open");
      mask.classList.add("open");
    });
    document.body.style.overflow = "hidden";
    if (location.hash !== "#" + code) history.pushState({ code }, "", "#" + code);
    const btn = $("#fin-close");
    if (btn) btn.focus();
  }

  function closeDrawer(fromHistory) {
    const drawer = $("#fin-drawer"), mask = $("#fin-mask");
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove("open");
    mask.classList.remove("open");
    document.body.style.overflow = "";
    state.current = null;
    const done = () => { drawer.hidden = true; mask.hidden = true; };
    setTimeout(done, 260);
    if (!fromHistory && location.hash) history.back();
    else if (!fromHistory) history.replaceState(null, "", location.pathname + location.search);
  }
```

更新 `init()`：

```js
  function init() {
    els.status = $("#fin-status");
    els.search = $("#fin-search");
    els.reset = $("#fin-reset");
    els.head = $("#fin-head");
    els.body = $("#fin-body");
    els.pager = $("#fin-pager");
    els.total = $("#fin-total");
    bindEvents();
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
        if (row) renderDrawerMetrics(row);
        renderChart();
      });
    });
    const code = location.hash.replace("#", "");
    if (code) setTimeout(() => openDrawer(code), 300);
    load();
  }
```

- [ ] **Step 3: 本地验证抽屉**

1. 打开 `http://127.0.0.1:8899/financials.html?t=2`
2. 点击贵州茅台 → 右侧抽屉出现，URL 变为 `#600519`，图为柱+线
3. 切「按年度」→ x 轴为年份，图重绘；关闭后按浏览器返回键不会跳页
4. 直接访问 `financials.html#600519` → 自动打开
5. 375px 宽（DevTools 设备模拟）→ 面板从底部全屏弹出，关闭按钮可点
6. 断网重试：图区显示「历史数据加载失败」，列表不受影响

- [ ] **Step 4: 提交**

```bash
git add assets/js/charts.js assets/js/financials.js
git commit -m "feat(financials): 个股趋势图与桌面抽屉/移动端全屏面板"
```

---

### Task 7: 自动更新工作流与文档

**Files:**
- Create: `.github/workflows/financials.yml`
- Modify: `README.md`

- [ ] **Step 1: 新建工作流**

`.github/workflows/financials.yml`：

```yaml
name: Update financials snapshot

on:
  schedule:
    - cron: "30 10 * * 1-5"   # 北京时间 18:30（周一至周五）
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: financials-snapshot
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Run tests
        run: python3 -m unittest discover -s scripts -p "test_*.py" -v
      - name: Build snapshot
        run: python3 scripts/build_financials.py
      - name: Commit if changed
        run: |
          if [ -z "$(git status --porcelain -- data/financials.json)" ]; then
            echo "no changes"
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/financials.json
          git commit -m "chore(financials): 更新财报快照"
          git push
```

- [ ] **Step 2: 更新 README**

在目录结构中补充：

```md
├── financials.html       # 财报汇总：全 A 股指标列表 + 个股趋势
├── data/financials.json  # 财报汇总快照（脚本生成）
├── scripts/
│   ├── financials_calc.py       # 单季/同比/年化计算
│   ├── build_financials.py      # 快照生成
│   └── test_financials_calc.py  # 计算单元测试
└── .github/workflows/financials.yml  # 每交易日 18:30 自动更新快照
```

新增一节「财报汇总」：

```md
## 财报汇总

- 数据：东方财富 `RPT_F10_FINANCE_MAINFINADATA`（财报指标）+ `RPT_VALUEANALYSIS_DET`（估值）
- 口径：单季金额由累计值差分；动态 PE = 总市值 ÷ 年化归母净利；未披露最新报告期的个股回退上一期并标注
- 更新：GitHub Actions 每交易日 18:30（北京时间）运行 `scripts/build_financials.py`，有变化才提交；也可手动 `workflow_dispatch`
- 本地：`python3 scripts/build_financials.py` 后打开 `financials.html`
```

- [ ] **Step 3: 验证工作流语法与测试**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/financials.yml'))" 2>/dev/null || echo "yaml module missing, skip"`
Run: `cd scripts && python3 -m unittest test_financials_calc -v`
Expected: 测试全部 PASS；YAML 无解析错误（若本机无 PyYAML 忽略该检查）

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/financials.yml README.md
git commit -m "chore(financials): 每日自动更新快照的 Actions 与文档"
```

---

### Task 8: 端到端验证与收尾

**Files:**
- Modify: 视验证结果可能修正以上文件

- [ ] **Step 1: 全量验证清单**

Run: `python3 -m http.server 8899`（仓库根目录）

浏览器逐项确认：

1. `financials.html` 首次加载 < 3 秒（本地），无骨架残留、无控制台报错
2. 状态条：交易日、覆盖只数正确
3. 季度/年度切换列数分别为 15 / 13，数值口径正确
4. Shift 多列排序：3 个键时表头显示 ①②③，取消键后恢复
5. 搜索中文名/代码、清空恢复
6. 分页：首页/末页/每页 50/200；翻页后滚动位置合理
7. 抽屉：打开、切换季度/年度、ESC 关闭、返回键关闭、深链 `#600519` 打开
8. 移动端 375px：表格横向滚动且前两列固定；抽屉全屏；图高 320px
9. `citic.html`、`index.html` 回归：导航正常、无样式串扰

- [ ] **Step 2: 数据抽查**

Run:

```bash
python3 - <<'EOF'
import json
d=json.load(open("data/financials.json")); i={k:n for n,k in enumerate(d["fields"])}
for code in ("600519","000001","300750"):
    r=next(x for x in d["rows"] if x[i["code"]]==code)
    print(code, r[i["name"]], r[i["period"]], "q_rev", r[i["q_rev"]], "q_np", r[i["q_np"]], "pe", r[i["pe_dyn"]])
EOF
```

与东方财富个股财务页人工比对，确认数量级与口径一致。

- [ ] **Step 3: 提交收尾**

```bash
git add -A
git commit -m "test(financials): 端到端验证修正"
```

（若无改动则跳过提交。）
