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

  /* ECharts CDN 多源故障转移：国内网络（含鸿蒙）访问 jsdelivr 常被限速或不通，
     逐个源尝试并设超时，任一源成功即止 */
  const ECHARTS_SOURCES = [
    "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js",
    "https://unpkg.com/echarts@5.5.0/dist/echarts.min.js",
  ];
  const ECHARTS_TIMEOUT = 8000;

  let echartsPromise = null;

  function showChartFallback() {
    document.querySelectorAll(".chart-kline").forEach((el) => {
      el.innerHTML =
        '<div class="chart-fallback">图表组件加载失败（网络原因）。价格数据请见下方数据表。</div>';
    });
    document.querySelectorAll("[data-spark]").forEach((el) => { el.innerHTML = ""; });
    document.querySelectorAll(".chart-line").forEach((el) => { el.innerHTML = ""; });
  }

  function ensureEcharts(onReady, onFail) {
    if (window.echarts) { onReady(); return; }
    if (!echartsPromise) {
      echartsPromise = new Promise((resolve, reject) => {
        let idx = 0;
        const tryNext = () => {
          if (idx >= ECHARTS_SOURCES.length) { reject(new Error("echarts cdn unavailable")); return; }
          const s = document.createElement("script");
          s.src = ECHARTS_SOURCES[idx++];
          s.async = true;
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            s.onload = s.onerror = null;
            s.remove();
            tryNext();
          }, ECHARTS_TIMEOUT);
          s.onload = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
          s.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); tryNext(); };
          document.head.appendChild(s);
        };
        tryNext();
      });
    }
    // then(onReady, onFail) 而非 .catch：避免 onReady 内部异常被误判成加载失败
    echartsPromise.then(onReady, () => {
      showChartFallback();
      if (onFail) onFail();
    });
  }

  /* resize 防抖 + 尺寸守卫：鸿蒙等设备地址栏收起/键盘弹出会连续触发 resize，
     仅当容器尺寸真实变化才重绘，杜绝自激循环 */
  function onResize(el, fn) {
    let timer, lastW = 0, lastH = 0;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const w = el.clientWidth, h = el.clientHeight;
        if (w === lastW && h === lastH) return;
        lastW = w; lastH = h;
        fn();
      }, 150);
    });
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
        confine: true,
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

  /* 窄屏收紧边距与字号，避免 375px 屏绘图区被坐标轴过度挤压 */
  function applyResponsive(chart) {
    if (!window.matchMedia("(max-width: 640px)").matches) return;
    chart.setOption({
      legend: { textStyle: { fontSize: 10 } },
      tooltip: { textStyle: { fontSize: 11 } },
      grid: [
        { left: 44, right: 8, top: 26, height: "50%" },
        { left: 44, right: 8, top: "67%", height: "13%" },
      ],
      xAxis: [{ axisLabel: { fontSize: 9 } }, {}],
      yAxis: [{ axisLabel: { fontSize: 9 } }, { axisLabel: { fontSize: 9 } }],
    });
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
        { left: 56, right: 10, top: 30, height: "50%" },
        { left: 56, right: 10, top: "67%", height: "13%" },
      ],
      dataZoom: [
        // 移动端禁用单指平移：否则单指滑动会被图表吃掉，页面无法滚动（双指缩放仍可用）
        { type: "inside", xAxisIndex: [0, 1], start: 0, end: 100, moveOnMouseMove: true, moveOnTouch: false },
        {
          type: "slider", xAxisIndex: [0, 1], start: 0, end: 100,
          height: 18, bottom: 6, borderColor: "#E2E4E8",
          fillerColor: "rgba(117,122,131,0.08)",
          dataBackground: { lineStyle: { color: "#D3D6DC" }, areaStyle: { color: "rgba(117,122,131,0.06)" } },
          selectedDataBackground: { lineStyle: { color: "#A8ADB5" }, areaStyle: { color: "rgba(117,122,131,0.12)" } },
          handleStyle: { color: "#757A83" }, moveHandleStyle: { color: "#757A83" },
          textStyle: { color: "#757A83", fontSize: 10 }, showDetail: false, brushSelect: false,
        },
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
    applyResponsive(chart);
    onResize(el, () => { chart.resize(); applyResponsive(chart); });
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
      onResize(el, () => chart.resize());
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

  /* ---------- 纯 SVG 图表（无外部依赖，弱网/离线/内嵌浏览器均可用） ---------- */

  // 折线图：毛利率趋势。annual 为年度参考位（虚线）
  function initLineChart(elId, labels, values, annual, unit) {
    const el = document.getElementById(elId);
    if (!el || !labels.length) return;
    const u = unit || "%";
    const draw = () => {
      const W = Math.max(el.clientWidth || 320, 260);
      const H = 300;
      const P = { l: 48, r: 16, t: 26, b: 46 };
      const iw = W - P.l - P.r;
      const ih = H - P.t - P.b;
      const all = values.slice();
      (annual || []).forEach((a) => all.push(a.value));
      let vmin = Math.min.apply(null, all);
      let vmax = Math.max.apply(null, all);
      const pad = (vmax - vmin) * 0.18 || 1;
      const lo = vmin - pad, hi = vmax + pad;
      const X = (i) => P.l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
      const Y = (v) => P.t + ih - ((v - lo) / (hi - lo)) * ih;

      let grid = "", ylab = "";
      for (let g = 0; g <= 4; g++) {
        const v = lo + ((hi - lo) * g) / 4;
        const yy = Y(v).toFixed(1);
        grid += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="#ECEEF1" stroke-width="1"/>`;
        ylab += `<text x="${P.l - 8}" y="${yy}" fill="#757A83" font-size="10" text-anchor="end" dominant-baseline="middle">${v.toFixed(1)}</text>`;
      }

      const rotate = labels.length >= 8;
      let xlab = "";
      labels.forEach((lb, i) => {
        const xx = X(i).toFixed(1);
        if (rotate) {
          const ty = (H - P.b + 14).toFixed(1);
          xlab += `<text x="${xx}" y="${ty}" fill="#757A83" font-size="10" text-anchor="end" dominant-baseline="middle" transform="rotate(-45 ${xx} ${ty})">${lb}</text>`;
        } else {
          xlab += `<text x="${xx}" y="${H - P.b + 16}" fill="#757A83" font-size="10" text-anchor="middle">${lb}</text>`;
        }
      });

      let marks = "";
      (annual || []).forEach((a) => {
        const yy = Y(a.value).toFixed(1);
        marks += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="#A8ADB5" stroke-width="1" stroke-dasharray="5 4"/>`;
        marks += `<text x="${W - P.r - 2}" y="${(Y(a.value) - 6).toFixed(1)}" fill="#757A83" font-size="9" text-anchor="end">${a.period} ${a.value}${u}</text>`;
      });

      const pts = values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
      const base = (P.t + ih).toFixed(1);
      const area = `M ${X(0).toFixed(1)},${base} ` +
        values.map((v, i) => `L ${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ") +
        ` L ${X(values.length - 1).toFixed(1)},${base} Z`;
      let dots = "";
      values.forEach((v, i) => {
        dots += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" fill="#4E535B"/>`;
      });

      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="毛利率趋势图">` +
        `<path d="${area}" fill="rgba(78,83,91,0.07)"/>` + grid + ylab + marks +
        `<polyline points="${pts}" fill="none" stroke="#4E535B" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
        dots + xlab + `</svg>`;
    };
    draw();
    onResize(el, draw);
  }

  // 条形图：同业指标对比（支持负值，指标可切换）
  const PEER_METRICS = {
    value: { name: "毛利率", unit: "%" },
    net_margin: { name: "净利率", unit: "%" },
    roe: { name: "ROE", unit: "%" },
    pb: { name: "PB", unit: "倍" },
  };

  function initPeerChart(elId, peers, metric, subjectName) {
    const el = document.getElementById(elId);
    if (!el || !peers || !peers.length) return;
    const meta = PEER_METRICS[metric] || PEER_METRICS.value;
    const draw = () => {
      const W = Math.max(el.clientWidth || 320, 260);
      const H = 260;
      const P = { l: 48, r: 16, t: 24, b: 46 };
      const iw = W - P.l - P.r;
      const ih = H - P.t - P.b;
      const vals = peers.map((p) => p[metric]);
      const vmin = Math.min.apply(null, vals);
      const vmax = Math.max.apply(null, vals);
      const span = (vmax - vmin) || Math.abs(vmax) || 1;
      const lo = Math.min(0, vmin - span * 0.2);
      const hi = vmax + span * 0.2;
      const Y = (v) => P.t + ih - ((v - lo) / (hi - lo)) * ih;
      const slot = iw / peers.length;
      const bw = Math.min(slot * 0.46, 54);
      const zeroY = Y(0);

      let grid = "", ylab = "";
      for (let g = 0; g <= 4; g++) {
        const v = lo + ((hi - lo) * g) / 4;
        const yy = Y(v).toFixed(1);
        grid += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="#ECEEF1" stroke-width="1"/>`;
        ylab += `<text x="${P.l - 8}" y="${yy}" fill="#757A83" font-size="10" text-anchor="end" dominant-baseline="middle">${v.toFixed(1)}</text>`;
      }

      let bars = "", xlab = "";
      peers.forEach((p, i) => {
        const cx = P.l + slot * (i + 0.5);
        const v = p[metric];
        const isSubj = p.name === subjectName;
        const color = isSubj ? "#22262B" : "#A8ADB5";
        const yTop = v >= 0 ? Y(v) : zeroY;
        const h = Math.max(Math.abs(Y(v) - zeroY), 1);
        bars += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}"/>`;
        const ly = v >= 0 ? (yTop - 6).toFixed(1) : (yTop + h + 14).toFixed(1);
        bars += `<text x="${cx.toFixed(1)}" y="${ly}" fill="#757A83" font-size="10" font-weight="600" text-anchor="middle">${v}</text>`;
        xlab += `<text x="${cx.toFixed(1)}" y="${H - P.b + 16}" fill="#757A83" font-size="10" font-weight="${isSubj ? 700 : 400}" text-anchor="middle">${p.name}</text>`;
      });

      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="同业${meta.name}对比图">` +
        grid + ylab +
        `<line x1="${P.l}" y1="${zeroY.toFixed(1)}" x2="${W - P.r}" y2="${zeroY.toFixed(1)}" stroke="#D3D6DC" stroke-width="1"/>` +
        bars + xlab + `</svg>`;
    };
    draw();
    onResize(el, draw);
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

  /* 财报趋势：营收/归母柱状 + 毛利率/净利率折线（双轴） */
  let finChart = null;
  let finResizeBound = false;

  function initFinancialTrend(el, data) {
    if (!el) return;
    ensureEcharts(() => {
      if (!data || !data.labels.length) {
        el.innerHTML = '<div class="chart-fallback">暂无可展示的历史数据</div>';
        return;
      }
      if (finChart && !finChart.isDisposed()) finChart.dispose();
      finChart = window.echarts.init(el);
      finChart.setOption({
        animationDuration: 400,
        textStyle: { fontFamily: "-apple-system, PingFang SC, sans-serif" },
        tooltip: {
          trigger: "axis",
          confine: true,
          backgroundColor: "rgba(255,255,255,0.96)",
          borderColor: "#E2E4E8",
          textStyle: { color: "#17191C", fontSize: 12 },
          extraCssText: "box-shadow:0 4px 14px rgba(23,25,28,.08);border-radius:8px;",
        },
        legend: { top: 0, right: 0, textStyle: { color: "#757A83", fontSize: 11 } },
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
            splitLine: { lineStyle: { color: "#ECEEF1" } },
            axisLabel: { color: "#757A83", fontSize: 10 },
          },
          {
            type: "value",
            splitLine: { show: false },
            axisLabel: { color: "#757A83", fontSize: 10 },
          },
        ],
        series: [
          {
            name: "营收", type: "bar", data: data.revenue, yAxisIndex: 0,
            barMaxWidth: 16, itemStyle: { color: "rgba(194,64,47,0.75)", borderRadius: [2, 2, 0, 0] },
            tooltip: { valueFormatter: (v) => (v == null ? "—" : v + " 亿") },
          },
          {
            name: "归母净利", type: "bar", data: data.profit, yAxisIndex: 0,
            barMaxWidth: 16, itemStyle: { color: "rgba(117,122,131,0.75)", borderRadius: [2, 2, 0, 0] },
            tooltip: { valueFormatter: (v) => (v == null ? "—" : v + " 亿") },
          },
          {
            name: "毛利率", type: "line", data: data.gm, yAxisIndex: 1,
            symbol: "circle", symbolSize: 5, connectNulls: true,
            lineStyle: { width: 2, color: "#22262B" }, itemStyle: { color: "#22262B" },
            tooltip: { valueFormatter: (v) => (v == null ? "—" : v + "%") },
          },
          {
            name: "净利率", type: "line", data: data.nm, yAxisIndex: 1,
            symbol: "circle", symbolSize: 5, connectNulls: true,
            lineStyle: { width: 2, color: "#A8ADB5" }, itemStyle: { color: "#A8ADB5" },
            tooltip: { valueFormatter: (v) => (v == null ? "—" : v + "%") },
          },
        ],
      }, true);
      if (!finResizeBound) {
        finResizeBound = true;
        onResize(el, () => {
          if (finChart && !finChart.isDisposed()) finChart.resize();
        });
      }
    }, () => {
      el.innerHTML = '<div class="chart-fallback">图表组件加载失败（网络原因）。</div>';
    });
  }

  window.SICharts = { initReportChart, initSparklines, initLineChart, initPeerChart, initFinancialTrend };
})();
