/* 股析 StockInsight — ECharts 灰色主题图表 */
(function () {
  "use strict";

  const C = {
    grid: "#ECEEF1",
    axis: "#A8ADB5",
    text2: "#757A83",
    up: "#C2402F",
    down: "#1F7A4D",
    ma5: "#8A8F98",
    ma20: "#4E535B",
    volUp: "rgba(194,64,47,0.45)",
    volDown: "rgba(31,122,77,0.45)",
  };

  function ensureEcharts(onReady) {
    if (window.echarts) return onReady();
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";
    s.onload = onReady;
    s.onerror = () => {
      $$(".chart-kline").forEach((el) => {
        el.innerHTML =
          '<div class="chart-fallback">图表组件加载失败（网络原因）。价格数据请见下方数据表。</div>';
      });
    };
    document.head.appendChild(s);
  }

  function baseOption(currency) {
    return {
      animationDuration: 400,
      textStyle: { fontFamily: "-apple-system, PingFang SC, sans-serif" },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", lineStyle: { color: C.axis, width: 1 } },
        backgroundColor: "rgba(255,255,255,0.96)",
        borderColor: "#E2E4E8",
        textStyle: { color: "#17191C", fontSize: 12 },
        extraCssText: "box-shadow:0 4px 14px rgba(23,25,28,.08);border-radius:8px;",
        valueFormatter: (v) =>
          typeof v === "number"
            ? v.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
            : v,
      },
      grid: { left: 64, right: 16, top: 28, height: "58%" },
      xAxis: {
        type: "category",
        boundaryGap: true,
        axisLine: { lineStyle: { color: C.grid } },
        axisTick: { show: false },
        axisLabel: { color: C.text2, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.text2, fontSize: 11 },
      },
    };
  }

  function renderKline(el, series, currency) {
    const dates = series.map((d) => d.date.slice(5));
    const ohlc = series.map((d) => [d.open, d.close, d.low, d.high]);
    const vol = series.map((d) => d.volume);
    const closes = series.map((d) => d.close);
    const ma = (n) => {
      const out = [];
      for (let i = 0; i < closes.length; i++) {
        if (i < n - 1) { out.push("-"); continue; }
        let s = 0;
        for (let j = i - n + 1; j <= i; j++) s += closes[j];
        out.push(+(s / n).toFixed(2));
      }
      return out;
    };

    const chart = echarts.init(el);
    const opt = baseOption(currency);
    Object.assign(opt, {
      legend: {
        data: ["K线", "MA5", "MA20"],
        top: 0,
        textStyle: { color: C.text2, fontSize: 11 },
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 4,
      },
      tooltip: Object.assign({}, opt.tooltip, {
        formatter: (params) => {
          const i = params[0].dataIndex;
          const d = series[i];
          const chg = d.change_pct;
          const cls = chg > 0 ? C.up : chg < 0 ? C.down : C.text2;
          return `<div style="font-size:12px;line-height:1.7">
            <div style="color:#757A83;margin-bottom:2px">${d.date}</div>
            <div>开 <b>${d.open}</b>　收 <b>${d.close}</b></div>
            <div>高 ${d.high}　低 ${d.low}</div>
            <div style="color:${cls}">涨跌幅 ${chg > 0 ? "+" : ""}${chg}%</div>
            <div style="color:#757A83">成交量 ${window.SI.fmtVolume(d.volume)}</div>
          </div>`;
        },
      }),
      xAxis: [
        Object.assign({}, opt.xAxis, { data: dates }),
        Object.assign({}, opt.xAxis, {
          gridIndex: 1,
          axisLabel: { show: false },
          axisLine: { show: false },
        }),
      ],
      yAxis: [
        opt.yAxis,
        Object.assign({}, opt.yAxis, {
          gridIndex: 1,
          splitNumber: 2,
          axisLabel: {
            color: C.text2,
            fontSize: 10,
            formatter: (v) => window.SI.fmtVolume(v),
          },
        }),
      ],
      grid: [
        { left: 64, right: 16, top: 30, height: "52%" },
        { left: 64, right: 16, top: "68%", height: "16%" },
      ],
      series: [
        {
          name: "K线", type: "candlestick", data: ohlc,
          itemStyle: { color: C.up, color0: C.down, borderColor: C.up, borderColor0: C.down },
        },
        { name: "MA5", type: "line", data: ma(5), smooth: true, symbol: "none", lineStyle: { width: 1, color: C.ma5 } },
        { name: "MA20", type: "line", data: ma(20), smooth: true, symbol: "none", lineStyle: { width: 1, color: C.ma20 } },
        {
          name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vol,
          barWidth: "60%",
          itemStyle: {
            color: (p) => (series[p.dataIndex].close >= series[p.dataIndex].open ? C.volUp : C.volDown),
          },
        },
      ],
    });
    chart.setOption(opt);
    window.addEventListener("resize", () => chart.resize());
    return chart;
  }

  function renderSparkline(el, closes) {
    if (window.echarts) {
      const chart = echarts.init(el);
      chart.setOption({
        animation: false,
        grid: { left: 0, right: 0, top: 2, bottom: 2 },
        xAxis: { type: "category", show: false, boundaryGap: false },
        yAxis: { type: "value", show: false, scale: true },
        series: [{
          type: "line", data: closes, smooth: true, symbol: "none",
          lineStyle: { width: 1.5, color: "#757A83" },
          areaStyle: {
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(117,122,131,0.18)" },
                { offset: 1, color: "rgba(117,122,131,0)" },
              ],
            },
          },
        }],
      });
      window.addEventListener("resize", () => chart.resize());
      return;
    }
    // 无 ECharts 时用 SVG 兜底
    const w = el.clientWidth || 300, h = 44;
    const min = Math.min(...closes), max = Math.max(...closes);
    const pts = closes
      .map((v, i) => `${(i / (closes.length - 1)) * w},${h - 4 - ((v - min) / (max - min || 1)) * (h - 8)}`)
      .join(" ");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}"><polyline points="${pts}" fill="none" stroke="#757A83" stroke-width="1.5"/></svg>`;
  }

  function initReportChart(series, currency) {
    ensureEcharts(() => {
      const el = document.getElementById("kline-chart");
      if (el) renderKline(el, series, currency);
    });
  }

  function initSparklines() {
    const els = document.querySelectorAll("[data-spark]");
    if (!els.length) return;
    ensureEcharts(() => {
      els.forEach((el) => {
        renderSparkline(el, el.dataset.spark.split(",").map(Number));
      });
    });
  }

  window.SICharts = { initReportChart, initSparklines };
})();
