# 股析 StockInsight

静态股票分析报告网站，由 CodeBuddy 生成报告数据，GitHub Pages 托管渲染。
访问地址：<https://kemmy-du.github.io/stock>

## 架构

```
CodeBuddy（stock-report skill）
  ① ifind-finance-data / market-data 取数（行情、财务、新闻）
  ② CodeBuddy 内置大模型完成分析并撰写结论
  ③ scripts/build_report.py 组装 JSON
  ④ scripts/publish.sh 通过 gh api 提交到本仓库
        ↓
GitHub Pages（main 分支根目录）→ 网页读取 reports/*.json 渲染
```

## 目录结构

```
├── index.html            # 首页：大盘条 + 最新报告卡片
├── library.html          # 报告库：侧边栏（市场→标的）+ 搜索筛选
├── report.html           # 报告详情：章节锚点菜单 + ECharts
├── market.html           # 市场概览：指数速览 + 已覆盖标的
├── about.html            # 关于与免责声明
├── assets/
│   ├── css/style.css     # 灰色精致主题（web-design skill 令牌体系）
│   ├── js/common.js      # 导航 / 格式化 / 数据加载
│   ├── js/charts.js      # ECharts 灰色主题（K线 + 迷你走势）
│   └── js/render.js      # 各页面渲染逻辑
├── data/market.json      # 指数快照
└── reports/
    ├── index.json        # 报告索引
    └── <市场>-<代码>-<日期>.json
```

## 报告 JSON Schema

```jsonc
{
  "id": "US-AAPL-2026-10-18",
  "symbol": "AAPL", "market": "US", "name": "苹果",
  "generated_at": "ISO8601",
  "company": { "full_name", "industry", "listed_at", "exchange", "main_business" },
  "overview": { "price", "change_pct", "currency", "as_of" },
  "cover": "一句话结论",
  "price_series": [ { "date", "open", "high", "low", "close", "volume", "change_pct" } ],
  "indicators": { "ma5", "ma20", "ema20", "rsi14", "macd": { "dif", "dea", "hist" } },
  "financials": { "revenue", "revenue_yoy", "net_profit", "net_profit_yoy", "roe", "pe_ttm", "pb", "report_period" },
  "news": [ { "title", "source", "date", "sentiment", "summary" } ],
  "analysis": { "rating", "summary", "bull_points": [], "bear_points": [] }
}
```

## 生成新报告

在 CodeBuddy 中触发 `stock-report` 技能：

```
生成 600519 分析报告
生成 AAPL 分析报告
```

技能会完成取数 → 分析 → 组装 → 发布全流程，本网站自动更新。

## 设计说明

- 视觉：浅灰纸面（`#F4F5F7` 底 / 白色卡片）+ 深灰文字 + 红涨绿跌，唯一强调色为深灰
- 令牌：三层 CSS 令牌（原始值 → 语义别名 → 组件），8px 间距基数，1.25 字阶
- 可访问性：语义化 HTML、`:focus-visible` 焦点环、`prefers-reduced-motion` 降级
- 响应式：<640px 单列 + 汉堡菜单，640–1024px 折叠侧边栏，>1024px 完整布局

## 免责声明

内容由自动化流程基于公开数据生成，仅供学习研究参考，不构成投资建议。
