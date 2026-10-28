const assert = require("assert");
const core = require("../assets/js/financials-core.js");

const rows = [
  { code: "600519", name: "贵州茅台", mcap: 2000000000000, q_np: 200 },
  { code: "000001", name: "平安银行", mcap: 300000000000, q_np: 50 },
  { code: "300750", name: "宁德时代", mcap: 1000000000000, q_np: -10 },
  { code: "600000", name: "浦发银行", mcap: null, q_np: null },
];

assert.strictEqual(core.formatYi(123456789012), "1,234.57");
assert.strictEqual(core.formatYi(null), "—");
assert.strictEqual(core.formatPct(12.345), "+12.35%");
assert.strictEqual(core.formatPct(-5), "-5.00%");
assert.strictEqual(core.formatPct(null), "—");
assert.strictEqual(core.formatNum(12.345, 1), "12.3");
assert.strictEqual(core.periodLabel("2026-03-31"), "2026一季报");
assert.strictEqual(core.periodLabel("2026-06-30"), "2026二季报");
assert.strictEqual(core.periodLabel("2026-09-30"), "2026三季报");
assert.strictEqual(core.periodLabel("2025-12-31"), "2025四季报");

assert.deepStrictEqual(
  core.filterRows(rows, "茅台").map((r) => r.code),
  ["600519"]
);
assert.deepStrictEqual(
  core.filterRows(rows, "600").map((r) => r.code),
  ["600519", "600000"]
);
assert.deepStrictEqual(
  core.filterRows(rows, "  ").map((r) => r.code),
  ["600519", "000001", "300750", "600000"]
);

// 多列：先按 mcap 降序，再按 q_np 升序；空值置底
const sorted = core.sortRows(rows, [
  { key: "mcap", dir: -1 },
  { key: "q_np", dir: 1 },
]);
assert.deepStrictEqual(sorted.map((r) => r.code), ["600519", "300750", "000001", "600000"]);

const sorted2 = core.sortRows(rows, [{ key: "q_np", dir: 1 }]);
assert.deepStrictEqual(sorted2.map((r) => r.code), ["300750", "000001", "600519", "600000"]);

const sortedText = core.sortRows(rows, [{ key: "code", dir: 1 }]);
assert.deepStrictEqual(sortedText.map((r) => r.code), ["000001", "300750", "600000", "600519"]);

const { items, pages } = core.paginate(rows, 1, 2);
assert.strictEqual(pages, 2);
assert.strictEqual(items.length, 2);

const YI = 1e8;
const history = [
  { date: "2025-03-31", rev: 100 * YI, np: 10 * YI, gross: 30 * YI },
  { date: "2025-06-30", rev: 260 * YI, np: 26 * YI, gross: 78 * YI },
  { date: "2025-09-30", rev: 480 * YI, np: 48 * YI, gross: 144 * YI },
  { date: "2025-12-31", rev: 700 * YI, np: 70 * YI, gross: 210 * YI },
  { date: "2026-03-31", rev: 120 * YI, np: 12 * YI, gross: 36 * YI },
  { date: "2026-06-30", rev: 300 * YI, np: 30 * YI, gross: 90 * YI },
];
const q = core.trendSeries(history, "q", 12);
assert.deepStrictEqual(q.labels, ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"]);
assert.deepStrictEqual(q.revenue, [100, 160, 220, 220, 120, 180]);
assert.deepStrictEqual(q.profit, [10, 16, 22, 22, 12, 18]);
const y = core.trendSeries(history, "y", 6);
assert.deepStrictEqual(y.labels, ["2025"]);
assert.deepStrictEqual(y.revenue, [700]);
assert.strictEqual(y.gm[0], 30);

// 银行没有毛利润：季度毛利率为空，但年度仍要出现
const bank = core.trendSeries(
  [
    { date: "2025-03-31", rev: 100 * YI, np: 10 * YI, gross: null },
    { date: "2025-06-30", rev: 260 * YI, np: 26 * YI, gross: null },
    { date: "2025-09-30", rev: 480 * YI, np: 48 * YI, gross: null },
    { date: "2025-12-31", rev: 700 * YI, np: 70 * YI, gross: null },
  ],
  "y",
  6
);
assert.deepStrictEqual(bank.labels, ["2025"]);
assert.strictEqual(bank.gm[0], null);
assert.strictEqual(bank.revenue[0], 700);

// fromSnapshot：new_codes 透出为字符串数组，缺失时为空
const snapFields = ["code", "name", "period"];
const s1 = core.fromSnapshot({
  fields: snapFields, rows: [["600519", "贵州茅台", "2026-09-30"]],
  new_codes: [600519, "000001"],
});
assert.deepStrictEqual(s1.newCodes, ["600519", "000001"]);
const s2 = core.fromSnapshot({ fields: snapFields, rows: [] });
assert.deepStrictEqual(s2.newCodes, []);

// 筛选：季度口径、空值不匹配、亏损保护、年度口径切换
const fRows = [
  { code: "A", period: "2026-09-30", q_np: 10, y_np: 20, rev_qoq: 25, np_qoq: 35,
    y_rev_yoy: 10, y_np_yoy: -5, pe_dyn: 12, pb: 2, mcap: 200 * 1e8,
    q_gm: 40, y_gm: 35, q_nm: 12, y_nm: 9, q_deduct: 9, y_deduct: 18 },
  { code: "B", period: "2026-06-30", q_np: -5, y_np: -8, rev_qoq: -10, np_qoq: null,
    y_rev_yoy: 20, y_np_yoy: 15, pe_dyn: null, pb: 1, mcap: 50 * 1e8,
    q_gm: null, y_gm: null, q_nm: -3, y_nm: -2, q_deduct: -4, y_deduct: -6 },
  { code: "C", period: "2026-09-30", q_np: 8, y_np: 9, rev_qoq: 12, np_qoq: 0,
    y_rev_yoy: 5, y_np_yoy: 0, pe_dyn: 80, pb: 5, mcap: 1000 * 1e8,
    q_gm: 38, y_gm: 39, q_nm: 20, y_nm: 21, q_deduct: 7, y_deduct: 8 },
];
const codes = (list) => list.map((r) => r.code);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, {}, "q")), ["A", "B", "C"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { periods: ["2026-09-30"] }, "q")), ["A", "C"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { profit: "profit" }, "q")), ["A", "C"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { profit: "loss" }, "q")), ["B"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { revQoqMin: 20 }, "q")), ["A"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { npQoqMin: 0 }, "q")), ["A", "C"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { peMin: 10, peMax: 50 }, "q")), ["A"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { mcapMin: 100 * 1e8 }, "q")), ["A", "C"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { gmMin: 30 }, "q")), ["A", "C"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { deductRatioMin: 85 }, "q")), ["A", "C"]);
// 年度口径：毛利/净利/扣非改用 y_*，报告期与环比筛选忽略
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { gmMin: 36 }, "y")), ["C"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { periods: ["2026-09-30"] }, "y")), ["A", "B", "C"]);
assert.deepStrictEqual(codes(core.filterByConditions(fRows, { revQoqMin: 20, npQoqMin: 0 }, "y")), ["A", "B", "C"]);

console.log("financials-core tests passed");
