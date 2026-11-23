#!/usr/bin/env python3
"""生成 data/market.json：A 股 + 美股主要指数快照（东财 / 新浪公开接口，免额度）。"""

import json
import os
import sys

from em_source import build_market_snapshot

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "market.json")


def main():
    payload = build_market_snapshot()
    indices = payload["indices"]
    if len(indices) < 6:
        raise SystemExit(f"指数数量不足：{len(indices)}")
    for row in indices:
        if not row.get("close") or row["close"] <= 0:
            raise SystemExit(f"指数价格异常：{row}")

    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, OUT)
    print(f"wrote {os.path.normpath(OUT)}: as_of {payload['as_of']}, "
          f"{len(indices)} indices", file=sys.stderr)


if __name__ == "__main__":
    main()