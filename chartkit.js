/* Chart.js configuration shared by the dashboard and the PDF report. */
(function (root) {
  "use strict";
  var THEME = {
    light: { surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", crit: "#d03b3b",
             total: "#0d366b", trend: "#52514e",
             cat: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"], other: "#898781" },
    dark:  { surface: "#1a1a19", ink: "#f0efec", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835", crit: "#e66767",
             total: "#9ec5f4", trend: "#c3c2b7",
             cat: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"], other: "#898781" }
  };
  var FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  var WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function seriesColor(theme, idx) {            // idx 0 = Total, 1.. = mines (colour follows the entity)
    var T = THEME[theme];
    if (idx === 0) return T.total;
    return idx - 1 < T.cat.length ? T.cat[idx - 1] : T.other;
  }
  function fmt(v) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // o: { theme, type: line|bar|stacked, dates, dow, series:[{name,values}], analysis:[...], sel, trendDeg, fontSize, shade:[i0,i1], xRange:[min,max], animate }
  function buildConfig(o) {
    var T = THEME[o.theme || "light"], theme = o.theme || "light", datasets = [], i;
    var fs = o.fontSize || 11, n = o.dates.length, sc = o.scale || 1;
    var sel = o.series[o.sel], an = o.analysis[o.sel];
    function trendOf(vals) {
      if (!o.trendDeg || vals.length < 2) return null;
      var x = vals.map(function (_, k) { return k; }), fit = Stats.polyfit(x, vals, o.trendDeg);
      return x.map(function (k) { return +fit.eval(k).toFixed(4); });
    }
    var trendLabel = "Trend (polynomial, degree " + o.trendDeg + ")";

    if (o.type === "stacked") {
      var mines = o.series.slice(1);
      mines.forEach(function (s, k) {
        var a = o.analysis[k + 1];
        datasets.push({ type: "bar", label: s.name, data: s.values, stack: "mines", order: 3, borderSkipped: false,
          backgroundColor: seriesColor(theme, k + 1), barPercentage: 0.85, categoryPercentage: 0.9,
          borderColor: function (c) { return a.flags[c.dataIndex] ? T.crit : T.surface; },
          borderWidth: function (c) { return (a.flags[c.dataIndex] ? 2.5 : 1.5) * sc; } });
      });
      var tot = o.series[0], ta = o.analysis[0];
      datasets.push({ type: "line", label: "Total flagged", data: tot.values.map(function (v, k) { return ta.flags[k] ? v : null; }),
        showLine: false, pointStyle: "rectRot", pointRadius: 7 * sc, pointHoverRadius: 8, backgroundColor: T.crit, borderColor: T.surface, borderWidth: 2 * sc, order: 1 });
      var tr = trendOf(tot.values);
      if (tr) datasets.push({ type: "line", label: trendLabel + " of Total", data: tr, borderColor: T.trend, borderDash: [7 * sc, 5 * sc], borderWidth: 2 * sc, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 2 });
    } else {
      var col = seriesColor(theme, o.sel), flags = an.flags;
      if (o.type === "bar") {
        datasets.push({ type: "bar", label: sel.name, data: sel.values, order: 2, barPercentage: 0.8, categoryPercentage: 0.9,
          backgroundColor: function (c) { return flags[c.dataIndex] ? T.crit : col; },
          borderRadius: { topLeft: 3 * sc, topRight: 3 * sc }, borderSkipped: "bottom" });
      } else {
        datasets.push({ type: "line", label: sel.name, data: sel.values, order: 2, borderColor: col, borderWidth: 2 * sc, tension: 0, fill: false,
          pointRadius: function (c) { return flags[c.dataIndex] ? 6 * sc : 0; }, pointHoverRadius: 5, pointHitRadius: 10,
          pointStyle: function (c) { return flags[c.dataIndex] ? "rectRot" : "circle"; },
          pointBackgroundColor: function (c) { return flags[c.dataIndex] ? T.crit : col; },
          pointBorderColor: T.surface, pointBorderWidth: 2 * sc });
      }
      var t2 = trendOf(sel.values);
      if (t2) datasets.push({ type: "line", label: trendLabel, data: t2, borderColor: T.trend, borderDash: [7 * sc, 5 * sc], borderWidth: 2 * sc, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 1 });
    }

    var plugins = [{
      id: "wyOverlay",
      beforeDatasetsDraw: function (chart) {                  // shaded window around one anomaly (PDF detail charts)
        if (!o.shade) return;
        var x = chart.scales.x, a = chart.chartArea, ctx = chart.ctx;
        var half = (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
        var l = x.getPixelForValue(o.shade[0]) - half, r = x.getPixelForValue(o.shade[1]) + half;
        ctx.save(); ctx.fillStyle = T.crit; ctx.globalAlpha = 0.10; ctx.fillRect(l, a.top, r - l, a.bottom - a.top); ctx.restore();
      },
      afterDatasetsDraw: function (chart) {                    // hover crosshair
        var act = chart.tooltip && chart.tooltip.getActiveElements && chart.tooltip.getActiveElements();
        if (!act || !act.length || o.type === "bar" || o.noCrosshair) return;
        var x = act[0].element.x, a = chart.chartArea, ctx = chart.ctx;
        ctx.save(); ctx.strokeStyle = T.muted; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
      }
    }];

    var xScale = { type: "category", grid: { display: false }, border: { color: T.axis },
      ticks: { color: T.muted, font: { family: FONT, size: fs }, maxRotation: 0, autoSkip: true, maxTicksLimit: o.maxTicks || 10 } };
    if (o.xRange) { xScale.min = o.xRange[0]; xScale.max = o.xRange[1]; }

    return {
      type: "bar",
      data: { labels: o.dates, datasets: datasets },
      options: {
        responsive: !o.fixedSize, maintainAspectRatio: false, devicePixelRatio: o.dpr || undefined,
        animation: o.animate ? { duration: 250 } : false,
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 8, right: 6 } },
        scales: {
          x: xScale,
          y: { beginAtZero: true, stacked: o.type === "stacked", grid: { color: T.grid, lineWidth: 1 }, border: { display: false },
               ticks: { color: T.muted, font: { family: FONT, size: fs }, maxTicksLimit: 6 },
               title: { display: !o.noYTitle, text: "Daily output", color: T.muted, font: { family: FONT, size: fs } } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !o.noTooltip, backgroundColor: T.surface, titleColor: T.ink, bodyColor: T.ink2, borderColor: T.axis, borderWidth: 1, padding: 10,
            titleFont: { family: FONT, size: 12, weight: "600" }, bodyFont: { family: FONT, size: 12 }, boxPadding: 4, cornerRadius: 8,
            callbacks: {
              title: function (items) { var k = items[0].dataIndex; return (o.dow ? WD[o.dow[k]] + " " : "") + o.dates[k]; },
              label: function (c) {
                if (c.dataset.label === "Total flagged") return "Total: " + fmt(c.parsed.y) + " (anomaly)";
                return c.dataset.label + ": " + fmt(c.parsed.y);
              },
              afterBody: function (items) {
                var k = items[0].dataIndex, out = [];
                if (o.type !== "stacked" && an.flags[k]) out.push("Anomaly: " + an.tests[k].join(", "));
                if (o.type === "stacked") o.series.forEach(function (s, q) { if (q > 0 && o.analysis[q].flags[k]) out.push("Anomaly in " + s.name + ": " + o.analysis[q].tests[k].join(", ")); });
                return out;
              }
            }
          }
        }
      },
      plugins: plugins
    };
  }

  root.ChartKit = { THEME: THEME, buildConfig: buildConfig, seriesColor: seriesColor, WD: WD, fmt: fmt };
})(typeof window !== "undefined" ? window : this);
