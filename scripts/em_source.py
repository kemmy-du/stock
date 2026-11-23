#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""公开行情数据源（腾讯 / 新浪 / 东方财富），免 iFinD MCP 额度。

供三处复用：
- scripts/build_market.py（GitHub Actions 每日指数快照）
- ~/.codebuddy/stock-analysis/radar.py（新闻雷达）
- ~/.codebuddy/stock-analysis/prefetch.py（报告预取）

约定：
- 腾讯 qt.gtimg.cn / web.ifzq.gtimg.cn、新浪 hq.sinajs.cn、东财 datacenter / search
  均支持 HTTP/1.1，直接用 urllib。
- 东财 push2 与公告接口只回 HTTP/2，公告改用 curl --http2。
- 部分网络下东财 IPv6 返回空响应，统一强制 IPv4。
"""
import json
import re
import socket
import subprocess
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
CST = ZoneInfo("Asia/Shanghai")
EST = ZoneInfo("America/New_York")

_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        infos = _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
    except OSError:
        infos = []
    if infos:
        return infos
    return _orig_getaddrinfo(host, port, family, type, proto, flags)


socket.getaddrinfo = _ipv4_getaddrinfo


def _get(url, referer, timeout=25, encoding="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": referer})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return raw.decode(encoding, "replace")


def _get_json(url, referer, timeout=25):
    return json.loads(_get(url, referer, timeout))


def _get_http2(url, referer, timeout=25):
    """东财公告接口只接受 HTTP/2，用系统 curl。"""
    proc = subprocess.run(
        ["curl", "-4", "--http2", "-sS", "--max-time", str(timeout),
         "-H", f"User-Agent: {UA}", "-H", f"Referer: {referer}", url],
        capture_output=True, text=True)
    if proc.returncode != 0 or not (proc.stdout or "").strip():
        raise RuntimeError(f"HTTP/2 请求失败（curl {proc.returncode}）: {url}")
    return proc.stdout


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def secid(code):
    """600519.SH -> 1.600519；000001.SZ -> 0.000001（东财 secid）"""
    body, _, suffix = code.partition(".")
    prefix = {"SH": "1", "SZ": "0", "BJ": "0"}.get(suffix.upper(), "0")
    return f"{prefix}.{body}"


def tx_symbol(code):
    """600519.SH -> sh600519；000001.SZ -> sz000001；430047.BJ -> bj430047"""
    body, _, suffix = code.partition(".")
    return suffix.lower()[:2] + body


# ---------------- 指数快照 ----------------
CN_INDEX_MAP = {
    "000001": ("上证指数", "000001.SH"),
    "399001": ("深证成指", "399001.SZ"),
    "000300": ("沪深300", "000300.SH"),
}

SINA_INDICES = [
    ("gb_ixic", "纳斯达克综指", "IXIC.GI"),
    ("gb_$inx", "标普500", "SPX.GI"),
    ("gb_$dji", "道琼斯工业", "DJI.GI"),
]


def _parse_tx_quotes(text):
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("v_"):
            continue
        key, _, rest = line.partition("=")
        fields = rest.strip().strip('";').split("~")
        if len(fields) < 47:
            continue
        out[key[2:]] = fields
    return out


def fetch_cn_indices():
    url = "https://qt.gtimg.cn/q=sh000001,sz399001,sh000300"
    quotes = _parse_tx_quotes(_get(url, "https://gu.qq.com/", encoding="gbk"))
    out = []
    for key in ("sh000001", "sz399001", "sh000300"):
        fields = quotes.get(key)
        if not fields:
            continue
        close, chg = _num(fields[3]), _num(fields[32])
        mapped = CN_INDEX_MAP.get(fields[2])
        if not mapped or close is None or close <= 0:
            continue
        stamp = fields[30]
        trade_date = (f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}"
                      if len(stamp) >= 8 else None)
        out.append({
            "name": mapped[0], "code": mapped[1], "market": "CN",
            "close": round(close, 2),
            "change_pct": round(chg, 4) if chg is not None else None,
            "_date": trade_date,
        })
    if len(out) < 3:
        raise RuntimeError(f"腾讯 A 股指数缺失（{len(out)}/3）")
    return out


def fetch_us_indices():
    keys = ",".join(k for k, _, _ in SINA_INDICES)
    text = _get("https://hq.sinajs.cn/list=" + keys,
                "https://finance.sina.com.cn", encoding="gbk")
    by_key = {}
    for line in text.splitlines():
        m = re.match(r'var hq_str_([^=]+)="(.*)";', line.strip())
        if m:
            by_key[m.group(1)] = m.group(2)
    out = []
    for key, name, code in SINA_INDICES:
        fields = (by_key.get(key) or "").split(",")
        if len(fields) < 4:
            continue
        try:
            close = float(fields[1])
            chg = float(fields[2])
            stamp = datetime.strptime(fields[3], "%Y-%m-%d %H:%M:%S").replace(tzinfo=CST)
        except (ValueError, IndexError):
            continue
        if close <= 0:
            continue
        out.append({
            "name": name, "code": code, "market": "US",
            "close": round(close, 2),
            "change_pct": round(chg, 4),
            "_date": stamp.astimezone(EST).date().isoformat(),
        })
    if len(out) < 3:
        raise RuntimeError(f"新浪美股指数缺失（{len(out)}/3）")
    return out


def build_market_snapshot():
    """返回 data/market.json 的完整内容。任一源缺失即抛错，避免写半份快照。"""
    rows = fetch_cn_indices() + fetch_us_indices()
    dates = [r.pop("_date") for r in rows if r.get("_date")]
    if not dates:
        raise RuntimeError("指数快照无交易日期")
    return {"as_of": max(dates), "indices": rows}


# ---------------- 个股行情 ----------------
def fetch_stock_quote(code):
    """腾讯实时/收盘快照。mcap/fcap 单位亿元，amount 单位元。"""
    key = tx_symbol(code)
    quotes = _parse_tx_quotes(_get(f"https://qt.gtimg.cn/q={key}",
                                   "https://gu.qq.com/", encoding="gbk"))
    fields = quotes.get(key)
    if not fields:
        raise RuntimeError(f"行情缺失: {code}")
    def f(i):
        return _num(fields[i]) if i < len(fields) else None
    return {
        "code": fields[2],
        "name": fields[1],
        "price": f(3),
        "prev_close": f(4),
        "open": f(5),
        "volume_lots": f(6),
        "change_pct": f(32),
        "high": f(33),
        "low": f(34),
        "amount": (f(37) or 0) * 1e4 if f(37) is not None else None,
        "pe_ttm": f(39),
        "fcap": f(44) * 1e8 if f(44) is not None else None,
        "mcap": f(45) * 1e8 if f(45) is not None else None,
        "pb": f(46),
        "as_of": (fields[30][:4] + "-" + fields[30][4:6] + "-" + fields[30][6:8]
                  if len(fields[30]) >= 8 else None),
    }


def fetch_kline(code, start="", end="20500101", count=320):
    """腾讯前复权日 K，返回升序列表；volume 单位统一为「股」。"""
    key = tx_symbol(code)
    if start and len(start) == 8:
        start = f"{start[:4]}-{start[4:6]}-{start[6:8]}"
    if end and len(end) == 8 and end != "20500101":
        end = f"{end[:4]}-{end[4:6]}-{end[6:8]}"
    elif end == "20500101":
        end = datetime.now(CST).strftime("%Y-%m-%d")
    param = f"{key},day,{start or '1990-01-01'},{end},{count},qfq"
    url = ("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param="
           + urllib.parse.quote(param))
    body = _get_json(url, "https://gu.qq.com/")
    data = (body.get("data") or {}).get(key) or {}
    raw = data.get("qfqday") or data.get("day") or []
    rows, prev_close = [], None
    for item in raw:
        if len(item) < 6:
            continue
        try:
            close = float(item[2])
            vol = float(item[5])
        except ValueError:
            continue
        rows.append({
            "date": item[0],
            "open": float(item[1]),
            "close": close,
            "high": float(item[3]),
            "low": float(item[4]),
            "volume": int(round(vol * 100)),
            "change_pct": (round((close - prev_close) / prev_close * 100, 4)
                           if prev_close else None),
        })
        prev_close = close
    rows.sort(key=lambda r: r["date"])
    return rows


# ---------------- F10 基本面 ----------------
def fetch_fundamentals(code):
    """最新一期主要财务指标（东财 F10）。"""
    params = {
        "reportName": "RPT_F10_FINANCE_MAINFINADATA",
        "columns": "ALL",
        "filter": f'(SECUCODE="{code}")',
        "pageNumber": 1, "pageSize": 1,
        "sortColumns": "REPORT_DATE", "sortTypes": -1,
        "source": "HSF10", "client": "PC",
    }
    url = ("https://datacenter.eastmoney.com/securities/api/data/v1/get?"
           + urllib.parse.urlencode(params))
    body = _get_json(url, "https://emweb.securities.eastmoney.com/")
    rows = (body.get("result") or {}).get("data") or []
    if not rows:
        raise RuntimeError(f"财务指标缺失: {code}")
    return rows[0]


def fetch_company(code):
    params = {
        "reportName": "RPT_F10_BASIC_ORGINFO",
        "columns": "SECUCODE,SECURITY_NAME_ABBR,EM2016,INDUSTRYCSRC1,"
                   "MAIN_BUSINESS,LISTING_DATE",
        "filter": f'(SECUCODE="{code}")',
        "pageNumber": 1, "pageSize": 1,
        "source": "HSF10", "client": "PC",
    }
    url = ("https://datacenter.eastmoney.com/securities/api/data/v1/get?"
           + urllib.parse.urlencode(params))
    body = _get_json(url, "https://emweb.securities.eastmoney.com/")
    rows = (body.get("result") or {}).get("data") or []
    if not rows:
        raise RuntimeError(f"公司资料缺失: {code}")
    return rows[0]


# ---------------- 公告与新闻 ----------------
def fetch_announcements(code, start_date, size=50):
    """个股公告；start_date 为 YYYY-MM-DD。"""
    body_code = code.split(".")[0]
    url = ("https://np-anotice-stock.eastmoney.com/api/security/ann?"
           f"sr=-1&page_size={size}&page_index=1&ann_type=A&client_source=web"
           f"&stock_list={body_code}")
    body = json.loads(_get_http2(url, "https://data.eastmoney.com/"))
    items = []
    for row in (body.get("data") or {}).get("list") or []:
        date = (row.get("notice_date") or "")[:10]
        title = (row.get("title_ch") or row.get("title") or "").strip()
        if not date or not title or date < start_date:
            continue
        art = row.get("art_code") or ""
        columns = "".join(c.get("column_name") or ""
                          for c in (row.get("columns") or []))
        items.append({
            "title": title,
            "date": date,
            "url": f"https://data.eastmoney.com/notices/detail/{body_code}/{art}.html",
            "content": columns,
            "source": "公告",
        })
    return items


_EM_TAG = re.compile(r"</?em>", re.I)


def fetch_news(name, start_date, size=20):
    """东财全文搜索，按时间倒序，返回窗口内资讯。"""
    param = {
        "uid": "", "keyword": name, "type": ["cmsArticleWebOld"],
        "client": "web", "clientType": "web", "clientVersion": "curr",
        "param": {"cmsArticleWebOld": {
            "searchScope": "default", "sort": "time",
            "pageIndex": 1, "pageSize": size,
            "preTag": "<em>", "postTag": "</em>",
        }},
    }
    url = ("https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param="
           + urllib.parse.quote(json.dumps(param, ensure_ascii=False)))
    raw = _get(url, "https://so.eastmoney.com/")
    start, end = raw.find("("), raw.rfind(")")
    if start < 0 or end <= start:
        raise RuntimeError("东财资讯搜索返回格式异常")
    body = json.loads(raw[start + 1:end])
    items = []
    for row in ((body.get("result") or {}).get("cmsArticleWebOld") or []):
        stamp = (row.get("date") or "")[:10]
        title = _EM_TAG.sub("", row.get("title") or "").strip()
        if not stamp or not title or stamp < start_date:
            continue
        items.append({
            "title": title,
            "date": stamp,
            "url": (row.get("url") or "").strip(),
            "content": _EM_TAG.sub("", row.get("content") or "").strip(),
            "source": (row.get("mediaName") or "东方财富").strip(),
        })
    return items