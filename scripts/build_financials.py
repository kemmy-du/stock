#!/usr/bin/env python3
"""生成 data/financials.json：全 A 股财报指标 + 最新估值快照。"""

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

from financials_calc import build_metrics, new_codes

API = "https://datacenter-web.eastmoney.com/api/data/v1/get"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"}
PAGE = 500
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "financials.json")
CST = timezone(timedelta(hours=8))

FIELDS = [
    "code", "name", "period",
    "q_rev", "q_np", "q_deduct", "q_gm", "q_nm",
    "rev_qoq", "np_qoq", "rev_yoy", "np_yoy",
    "pe_dyn", "pb", "mcap", "fcap",
    "y_rev", "y_np", "y_deduct", "y_gm", "y_nm", "y_rev_yoy", "y_np_yoy",
]


def fetch(report, columns, filt, page_number, page_size=PAGE,
          sort_columns=None, sort_types=None):
    params = {
        "reportName": report, "columns": columns, "filter": filt,
        "pageSize": page_size, "pageNumber": page_number,
        "source": "WEB", "client": "WEB",
    }
    if sort_columns:
        params["sortColumns"] = sort_columns
        params["sortTypes"] = sort_types or "-1"
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=40) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            result = body.get("result") or {}
            return result.get("data") or []
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    return []


def fetch_all(report, columns, filt, sort_columns=None, sort_types=None):
    rows, page = [], 1
    while True:
        data = fetch(report, columns, filt, page, PAGE, sort_columns, sort_types)
        rows.extend(data)
        if len(data) < PAGE:
            break
        page += 1
        time.sleep(0.05)
    return rows


def quarter_ends(today, count=12):
    ends, y, q = [], today.year, (today.month - 1) // 3 + 1
    while len(ends) < count:
        month = q * 3
        day = 31 if month in (3, 12) else 30
        d = date(y, month, day)
        if d <= today:
            ends.append(d.isoformat())
        q -= 1
        if q == 0:
            q, y = 4, y - 1
    return ends


def load_valuation():
    for _ in range(6):
        latest = fetch("RPT_VALUEANALYSIS_DET", "TRADE_DATE", "", 1, 1,
                       "TRADE_DATE", "-1")
        if not latest:
            time.sleep(3)
            continue
        trade_date = latest[0]["TRADE_DATE"][:10]
        rows = fetch_all(
            "RPT_VALUEANALYSIS_DET",
            "SECURITY_CODE,SECURITY_NAME_ABBR,TOTAL_MARKET_CAP,"
            "NOTLIMITED_MARKETCAP_A,PB_MRQ,CLOSE_PRICE",
            f"(TRADE_DATE='{trade_date}')")
        if rows:
            return trade_date, rows
        time.sleep(3)
    raise RuntimeError("估值数据为空")


def to_float(v):
    try:
        f = None if v is None else float(v)
    except (TypeError, ValueError):
        return None
    return f if f is not None and math.isfinite(f) else None


def tidy(v):
    """页面只展示两位小数；同时去掉多余小数位以缩小快照体积。"""
    if not isinstance(v, float):
        return v
    v = round(v, 2)
    return int(v) if v.is_integer() else v


def load_periods(path):
    """读取旧快照的 {code: period}；文件缺失或损坏时按空处理。"""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return {str(r[0]): r[FIELDS.index("period")]
                for r in data.get("rows", []) if r and r[0]}
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        return {}


def main():
    now = datetime.now(CST)
    today = now.date()
    dates = quarter_ends(today)
    print("quarter ends:", ", ".join(dates), file=sys.stderr)

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
        }
    print(f"valuation {trade_date}: {len(universe)} codes", file=sys.stderr)

    series = {}
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
        print(f"  {d}: {len(rows)} rows, {len(latest_by_code)} in universe",
              file=sys.stderr)

    out_rows = []
    for code, info in universe.items():
        s = series.get(code)
        if not s:
            continue
        latest = max(s.keys())
        if latest < dates[1]:
            # 连续两个季度无财报，多为退市整理股，移出汇总
            continue
        m = build_metrics(s, latest)
        cum_np, q = m.pop("cum_np"), m.pop("cum_q")
        mcap = info["mcap"]
        annualized = cum_np * 4 / q if cum_np and cum_np > 0 else None
        pe_dyn = mcap / annualized if mcap and annualized else None
        row = {
            "code": code, "name": info["name"], "period": latest,
            **m,
            "pe_dyn": pe_dyn,
            "pb": info["pb"], "mcap": mcap, "fcap": info["fcap"],
        }
        out_rows.append([tidy(row[f]) for f in FIELDS])

    mi = FIELDS.index("mcap")
    out_rows.sort(key=lambda r: (r[mi] is None, -(r[mi] or 0)))
    pi = FIELDS.index("period")
    cur_periods = {str(r[0]): r[pi] for r in out_rows if r and r[0]}
    added = new_codes(load_periods(OUT), cur_periods)
    print(f"  new disclosures: {len(added)}", file=sys.stderr)
    payload = {
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
        "trade_date": trade_date,
        "coverage": {"dates": coverage, "total": len(out_rows)},
        "new_codes": added,
        "fields": FIELDS,
        "rows": out_rows,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"wrote {os.path.normpath(OUT)}: {len(out_rows)} rows, "
          f"{os.path.getsize(OUT) / 1024:.0f} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
