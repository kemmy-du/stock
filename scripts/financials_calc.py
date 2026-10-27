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

    def single(field, date):
        return single_from_cum({d: v.get(field) for d, v in series.items()}, date)

    vals = {f: pick(f, latest) for f in ("rev", "np", "deduct", "gross")}
    q_rev = single("rev", latest)
    q_np = single("np", latest)
    q_deduct = single("deduct", latest)
    q_gross = single("gross", latest)

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
