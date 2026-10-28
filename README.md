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
├── index.html            # 首页：股票雷达（下拉选标的 + 实时同步）+ 最新报告
├── library.html          # 报告库：侧边栏（市场→标的）+ 搜索筛选
├── report.html           # 报告详情：章节锚点菜单 + ECharts
├── market.html           # 市场概览：指数速览 + 已覆盖标的
├── financials.html       # 财报汇总：全 A 股指标列表 + 个股趋势
├── citic.html            # 中信多空：股指期货会员持仓（IF/IH/IC/IM）
├── about.html            # 关于与免责声明
├── assets/
│   ├── css/style.css     # 灰色精致主题（web-design skill 令牌体系）
│   ├── js/common.js      # 导航 / 格式化 / 数据加载
│   ├── js/charts.js      # ECharts 灰色主题（K线 + 迷你走势 + 财报趋势）
│   ├── js/financials-core.js  # 财报纯逻辑（排序/搜索/分页/趋势序列，可 Node 测试）
│   ├── js/financials.js  # 财报列表与个股面板
│   └── js/render.js      # 各页面渲染逻辑
├── data/market.json      # 指数快照
├── data/radar.json       # 雷达快照（新闻条目，由报告流程生成）
├── data/financials.json  # 财报汇总快照（脚本生成）
├── scripts/
│   ├── financials_calc.py       # 单季/同比/年化计算
│   ├── build_financials.py      # 财报快照生成
│   ├── test_financials_calc.py  # 计算单元测试
│   └── test_financials_core.js  # 前端逻辑测试
├── .github/workflows/financials.yml  # 每交易日 18:30 自动更新快照
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

## 股票雷达

- 数据分两层：`data/radar.json` 是离线快照（报告流程生成）；页面再按当前选中标的调用东方财富新闻搜索接口 `search-api-web.eastmoney.com/search/jsonp` 拉取实时新闻，与快照合并去重后按时间倒序展示。
- 交互：顶部下拉框选择单一标的（不再整屏罗列全部标的），分类 chips 只统计当前标的；状态条显示快照时间、实时条数、最近同步时刻。
- 刷新：默认每 60 秒自动同步一次当前标的，"同步"按钮可立即拉取；有新条目时插入顶部并打 `NEW`，失败按指数退避重试。

## 财报汇总

- 数据：东方财富 `RPT_F10_FINANCE_MAINFINADATA`（财报指标）+ `RPT_VALUEANALYSIS_DET`（最新交易日估值），覆盖全部 A 股（含北交所）
- 口径：单季金额由累计值差分；毛利率 = 单季毛利润 ÷ 单季营收；动态 PE = 总市值 ÷ 年化归母净利；未披露最新报告期的个股回退上一期，「报告期」列标注该行数据所属季度（如 2026三季报，可排序）；连续两个季度无财报的退市整理股不纳入
- 年度视图：取最新报告期的上一年度，四个单季齐全才汇总
- 更新：GitHub Actions 每交易日 18:30（北京时间）运行 `scripts/build_financials.py`，数据有变化才提交；也可在 Actions 页手动触发 `workflow_dispatch`
- 本地：`python3 scripts/build_financials.py` 生成 `data/financials.json`，再打开 `financials.html`
- 测试：`cd scripts && python3 -m unittest test_financials_calc -v`、`node scripts/test_financials_core.js`

## 设计说明

- 视觉：浅灰纸面（`#F4F5F7` 底 / 白色卡片）+ 深灰文字 + 红涨绿跌，唯一强调色为深灰
- 令牌：三层 CSS 令牌（原始值 → 语义别名 → 组件），8px 间距基数，1.25 字阶
- 可访问性：语义化 HTML、`:focus-visible` 焦点环、`prefers-reduced-motion` 降级
- 响应式：<640px 单列 + 汉堡菜单，640–1024px 折叠侧边栏，>1024px 完整布局

## 免责声明

内容由自动化流程基于公开数据生成，仅供学习研究参考，不构成投资建议。
