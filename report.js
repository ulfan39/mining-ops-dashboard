/* PDF report: cover + statistics + charts + anomaly register + one section per anomaly + methodology. */
(function (root) {
  "use strict";
  var S = Stats, CK = ChartKit;
  var C = { navy: [15, 27, 45], accent: [42, 120, 214], ink: [11, 11, 11], ink2: [82, 81, 78], muted: [137, 135, 129], line: [227, 226, 220], wash: [245, 246, 248], crit: [208, 59, 59], critWash: [251, 233, 233] };
  var MAX_DETAIL = 40;

  function f2(v) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function sgn(v, d) { return (v > 0 ? "+" : "") + v.toFixed(d == null ? 0 : d) + "%"; }

  function chartImage(opts, wpx, hpx) {
    var cv = document.createElement("canvas"); cv.width = wpx; cv.height = hpx;
    var cfg = CK.buildConfig(Object.assign({ theme: "light", fixedSize: true, animate: false, dpr: 1, noTooltip: true, noCrosshair: true, fontSize: 19, maxTicks: 12, scale: 2.1 }, opts));
    cfg.options.responsive = false; cfg.options.animation = false; cfg.options.devicePixelRatio = 1;
    var ch = new Chart(cv, cfg); var url = cv.toDataURL("image/png"); ch.destroy(); return url;
  }

  function build(ctx) {
    var st = ctx.state, p = st.params, jsPDF = window.jspdf.jsPDF, doc = new jsPDF({ unit: "mm", format: "a4" });
    var W = 210, H = 297, M = 15, CW = W - 2 * M, n = st.dates.length, nm = st.series.length - 1, now = new Date();
    var stamp = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2) + " " + ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
    var chartType = st.type === "stacked" ? "line" : st.type, trend = st.trend;

    function setC(kind, c) { doc["set" + kind + "Color"](c[0], c[1], c[2]); }
    function text(t, x, y, size, style, color, opt) { doc.setFont("helvetica", style || "normal"); doc.setFontSize(size); setC("Text", color || C.ink); doc.text(String(t), x, y, opt); }
    function newPage() { doc.addPage(); return 22; }
    function need(y, h) { return y + h > H - 18 ? newPage() : y; }
    function h2(y, t) { y = need(y, 16); text(t, M, y, 13.5, "bold", C.navy); setC("Fill", C.accent); doc.rect(M, y + 2, 14, 0.9, "F"); return y + 9; }
    function para(y, t, size, color) {
      var lines = doc.splitTextToSize(t, CW); doc.setFont("helvetica", "normal"); doc.setFontSize(size || 9.5);
      lines.forEach(function (l) { y = need(y, 5); text(l, M, y, size || 9.5, "normal", color || C.ink2); y += (size || 9.5) * 0.5; });
      return y + 1.5;
    }
    function table(y, head, body, colStyles, opts) {
      doc.autoTable(Object.assign({ startY: y, head: [head], body: body, margin: { left: M, right: M, top: 20, bottom: 18 }, theme: "grid",
        styles: { font: "helvetica", fontSize: 8, cellPadding: 1.7, textColor: C.ink, lineColor: C.line, lineWidth: 0.2, overflow: "linebreak" },
        headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: "bold", halign: "left" },
        alternateRowStyles: { fillColor: C.wash }, columnStyles: colStyles || {} }, opts || {}));
      return doc.lastAutoTable.finalY + 6;
    }

    // ------------------------------------------------------------ cover
    setC("Fill", C.navy); doc.rect(0, 0, W, 52, "F"); setC("Fill", C.accent); doc.rect(0, 52, W, 1.6, "F");
    setC("Fill", [240, 239, 236]); doc.roundedRect(M, 14, 17, 17, 2.5, 2.5, "F"); text("W-Y", M + 8.5, 25.2, 11.5, "bold", C.navy, { align: "center" });
    text("Mining Ops Analytics Report", M + 23, 22, 20, "bold", [255, 255, 255]);
    text("Weyland-Yutani Corporation  |  daily resource extraction", M + 23, 29.5, 10.5, "normal", [170, 179, 194]);
    text("Period " + st.dates[0] + " to " + st.dates[n - 1] + "   |   " + n + " days   |   " + nm + " mine" + (nm === 1 ? "" : "s") + "   |   generated " + stamp, M, 43, 9, "normal", [170, 179, 194]);

    var y = 64, tot = st.stats[0], boxW = (CW - 9) / 4;
    var tiles = [["TOTAL OUTPUT", f2(tot.sum), "all mines, whole period"], ["MEAN DAILY OUTPUT", f2(tot.mean), "std dev " + f2(tot.std)], ["MEDIAN / IQR", f2(tot.median), "IQR " + f2(tot.iqr)], ["ANOMALIES", String(st.clusters.length), st.analysis.reduce(function (s, a) { return s + a.counts.any; }, 0) + " flagged mine-days"]];
    tiles.forEach(function (t, i) {
      var x = M + i * (boxW + 3); setC("Fill", C.wash); setC("Draw", C.line); doc.roundedRect(x, y, boxW, 24, 2, 2, "FD");
      text(t[0], x + 3.5, y + 6, 7, "bold", C.muted); text(t[1], x + 3.5, y + 14.5, 14, "bold", i === 3 && st.clusters.length ? C.crit : C.ink); text(t[2], x + 3.5, y + 20.5, 7.5, "normal", C.muted);
    });
    y += 34;
    y = h2(y, "1. Summary statistics");
    y = para(y, "Mean, standard deviation (sample, n-1), median and interquartile range (IQR = Q3 - Q1, inclusive quartiles) of the raw daily output of every mine and of the total, for the whole period.", 9);
    var colSt = {}; for (var c = 1; c <= 8; c++) colSt[c] = { halign: "right" };
    var rows = st.series.map(function (s, k) { var d = st.stats[k]; return [s.name, f2(d.mean), f2(d.std), f2(d.median), f2(d.iqr), f2(d.q1), f2(d.q3), f2(d.min), f2(d.max)]; });
    y = table(y, ["Series", "Mean", "Std dev", "Median", "IQR", "Q1", "Q3", "Min", "Max"], rows, colSt, {
      didParseCell: function (d) { if (d.section === "body" && d.row.index === 0) { d.cell.styles.fontStyle = "bold"; } if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right"; } });

    y = h2(y, "2. Analysis parameters");
    var pre = { none: "Raw values (no adjustment)", weekday: "Weekday pattern removed", trend: "Trend removed (degree " + p.trendDeg + ")", both: "Weekday pattern + trend removed (degree " + p.trendDeg + ")" }[p.preprocess];
    var en = p.enabled;
    y = table(y, ["Setting", "Value"], [
      ["Pre-processing before the tests", pre],
      ["IQR rule", (en.iqr ? "on" : "off") + "  |  outlier if outside [Q1 - k*IQR, Q3 + k*IQR], k = " + p.iqrK],
      ["z-score", (en.z ? "on" : "off") + "  |  outlier if |z| > " + p.zThr],
      ["Distance from moving average", (en.ma ? "on" : "off") + "  |  " + p.maMode + " window of " + p.maWindow + " days, outlier if farther than " + p.maPct + "%"],
      ["Grubbs' test", (en.grubbs ? "on" : "off") + "  |  two-sided, iterative, alpha = " + p.alpha],
      ["Chart type / trendline", (st.type === "stacked" ? "stacked (overview) and line (per mine)" : st.type) + "  |  " + (trend ? "polynomial degree " + trend : "no trendline")],
      ["Data source", (ctx.source || "") + (ctx.sheetId ? "  (Google Sheet " + ctx.sheetId.slice(0, 8) + "...)" : "")]
    ], { 0: { cellWidth: 55, fontStyle: "bold" } });

    // ------------------------------------------------------------ detection summary
    y = newPage();
    y = h2(y, "3. Anomaly detection summary");
    y = para(y, "Number of days flagged by each test, and the number of anomalies (groups of consecutive flagged days in the same direction). A day is an anomaly when at least one enabled test flags it.", 9);
    var arows = st.series.map(function (s, k) {
      var a = st.analysis[k], cl = st.clusters.filter(function (c) { return c.series === k; }).length;
      return [s.name, en.iqr ? a.counts.iqr : "off", en.z ? a.counts.z : "off", en.ma ? a.counts.ma : "off", en.grubbs ? a.counts.grubbs : "off", a.counts.any, cl];
    });
    var acs = {}; for (c = 1; c <= 6; c++) acs[c] = { halign: "right" };
    y = table(y, ["Series", "IQR rule", "z-score", "Moving avg", "Grubbs", "Days flagged", "Anomalies"], arows, acs, {
      didParseCell: function (d) { if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right"; } });

    // ------------------------------------------------------------ charts
    y = h2(y, "4. Output charts");
    y = para(y, "Red diamonds (or red bars) mark flagged days; the dashed line is the polynomial trend. The first chart stacks all mines (flagged segments are outlined in red, red diamonds mark days on which the Total is flagged); the others show each series on its own.", 9);
    var CH = 62;
    y = need(y, CW * 560 / 1500 + 8);
    doc.addImage(chartImage({ type: "stacked", dates: st.dates, dow: st.dow, series: st.series, analysis: st.analysis, sel: 0, trendDeg: trend }, 1500, 560), "PNG", M, y, CW, CW * 560 / 1500);
    y += CW * 560 / 1500 + 6;
    st.series.forEach(function (s, k) {
      y = need(y, CH + 14);
      var d = st.stats[k], a = st.analysis[k];
      text(s.name + (k === 0 ? "  (all mines)" : ""), M, y, 10.5, "bold", C.navy);
      text("mean " + f2(d.mean) + "  |  std dev " + f2(d.std) + "  |  median " + f2(d.median) + "  |  IQR " + f2(d.iqr) + "  |  " + a.counts.any + " flagged day" + (a.counts.any === 1 ? "" : "s"), W - M, y, 8, "normal", C.ink2, { align: "right" });
      y += 2.5;
      doc.addImage(chartImage({ type: chartType, dates: st.dates, dow: st.dow, series: st.series, analysis: st.analysis, sel: k, trendDeg: trend }, 1500, 520), "PNG", M, y, CW, CW * 520 / 1500);
      y += CW * 520 / 1500 + 10;
    });

    // ------------------------------------------------------------ anomaly register
    y = newPage();
    y = h2(y, "5. Anomaly register");
    if (!st.clusters.length) y = para(y, "No anomalies were detected with the current parameters.", 10);
    else {
      y = para(y, "All " + st.clusters.length + " anomalies, in chronological order. Expected value = local moving-average reference (on the pre-processed series, converted back to output units); deviation is measured against it.", 9);
      var rrows = st.clusters.map(function (c, i) {
        return [i + 1, st.series[c.series].name, c.dir === "spike" ? "SPIKE (+)" : "DROP (-)", c.startDate === c.endDate ? c.startDate : c.startDate + " to " + c.endDate, c.length, f2(c.value), f2(c.expected), sgn(c.devPct), c.z.toFixed(2), c.tests.join(", ")];
      });
      var rcs = { 0: { halign: "right", cellWidth: 8 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } };
      y = table(y, ["#", "Series", "Type", "Dates", "Days", "Peak value", "Expected", "Deviation", "z", "Tests"], rrows, rcs, {
        styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.4, textColor: C.ink, lineColor: C.line, lineWidth: 0.2 },
        didParseCell: function (d) { if (d.section === "head" && [0, 4, 5, 6, 7, 8].indexOf(d.column.index) >= 0) d.cell.styles.halign = "right";
          if (d.section === "body" && d.column.index === 2) d.cell.styles.fontStyle = "bold"; } });
    }

    // ------------------------------------------------------------ one section per anomaly
    var detail = st.clusters.map(function (c, i) { c.no = i + 1; return c; });
    var capped = detail.length > MAX_DETAIL;
    if (capped) detail = detail.slice().sort(function (a, b) { return Math.abs(b.devPct) - Math.abs(a.devPct); }).slice(0, MAX_DETAIL).sort(function (a, b) { return a.no - b.no; });
    if (detail.length) {
      y = newPage(); y = h2(y, "6. Anomaly details");
      y = para(y, capped ? "The " + MAX_DETAIL + " strongest of " + st.clusters.length + " anomalies are described below (the full list is in section 5)." : "Each anomaly has its own section: key facts, a short description and a chart of the surrounding weeks (the affected days are shaded).", 9);
      detail.forEach(function (c) {
        var s = st.series[c.series], a = st.analysis[c.series], blockH = 80;
        y = need(y, blockH);
        setC("Fill", C.critWash); doc.rect(M, y, CW, 9, "F"); setC("Fill", C.crit); doc.rect(M, y, 1.8, 9, "F");
        text("#" + c.no + "   " + (c.dir === "spike" ? "SPIKE (+)" : "DROP (-)") + "   " + s.name + "   " + (c.startDate === c.endDate ? c.startDate : c.startDate + " to " + c.endDate), M + 5, y + 6, 10.5, "bold", C.ink);
        y += 12;
        var wd = CK.WD[st.dow[c.peak]];
        doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: "grid", body: [
          ["Peak day", c.peakDate + " (" + wd + ")", "Peak value", f2(c.value), "Expected", f2(c.expected)],
          ["Duration", c.length + " day" + (c.length === 1 ? "" : "s"), "Deviation", sgn(c.devPct, 1), "z-score", c.z.toFixed(2)]],
          styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.2, textColor: C.ink, lineColor: C.line, lineWidth: 0.2 },
          columnStyles: { 0: { fontStyle: "bold", fillColor: C.wash, cellWidth: 24 }, 2: { fontStyle: "bold", fillColor: C.wash, cellWidth: 24 }, 4: { fontStyle: "bold", fillColor: C.wash, cellWidth: 24 } } });
        y = doc.lastAutoTable.finalY + 4;
        var totFlag = c.idx.some(function (i) { return st.analysis[0].flags[i]; }), pct = Math.abs(c.devPct);
        var msg = "On " + c.peakDate + " (" + wd + ") " + s.name + (c.dir === "spike" ? " produced " : " produced only ") + f2(c.value) + ", about " + pct.toFixed(0) + "% " + (c.dir === "spike" ? "above" : "below") +
          " the expected " + f2(c.expected) + ". The anomaly lasted " + c.length + " day" + (c.length === 1 ? "" : "s") + " and was flagged by: " + c.tests.join(", ") + ". ";
        if (c.series === 0) msg += "It concerns the combined output of all mines.";
        else msg += totFlag ? "The Total output was also flagged in the same period, so the event was visible company-wide." : "The Total output was not flagged, so the event was local to this mine.";
        y = para(y, msg, 9, C.ink2);
        var lo = Math.max(0, c.start - 10), hi = Math.min(n - 1, c.end + 10);
        doc.addImage(chartImage({ type: chartType === "bar" ? "bar" : "line", dates: st.dates, dow: st.dow, series: st.series, analysis: st.analysis, sel: c.series, trendDeg: 0,
          shade: [c.start, c.end], xRange: [lo, hi], fontSize: 20, maxTicks: 9, noYTitle: true }, 1500, 300), "PNG", M, y, CW, CW * 300 / 1500);
        y += CW * 300 / 1500 + 8;
      });
    }

    // ------------------------------------------------------------ methodology
    y = newPage(); y = h2(y, detail.length ? "7. Methodology" : "6. Methodology");
    [
      ["Pre-processing", "Weekday pattern: each weekday's average is divided by the overall average and every value is divided by its weekday factor. Trend: a polynomial of the chosen degree is fitted by least squares to the (weekday-adjusted) series and every value is divided by the fitted trend (rescaled to its mean). The tests then run on the adjusted series; charts and tables show the original values."],
      ["IQR rule", "Q1 and Q3 are the 25th and 75th percentiles (linear interpolation). A value is an outlier when it is below Q1 - k*IQR or above Q3 + k*IQR."],
      ["z-score", "z = (x - mean) / s with the sample standard deviation s. A value is an outlier when |z| exceeds the threshold."],
      ["Distance from moving average", "The reference is the mean of the neighbouring days in a window of the chosen length (centered windows exclude the day itself; trailing windows use the previous days). A value is an outlier when it differs from the reference by more than the chosen percentage."],
      ["Grubbs' test", "Two-sided test for a single outlier: G = max|x - mean| / s is compared with the critical value built from the Student t distribution with significance alpha. The most extreme point is removed and the test repeats until no further outlier is found."],
      ["Anomaly grouping", "Consecutive flagged days with the same direction (above or below the reference) form one anomaly; its peak is the day with the largest relative deviation."],
      ["Trendline", "Least-squares polynomial of degree 1 to 4 fitted to the daily values of the plotted series (x scaled to [-1, 1] for numerical stability)."]
    ].forEach(function (m) { y = need(y, 18); text(m[0], M, y, 10, "bold", C.navy); y += 4.5; y = para(y, m[1], 9, C.ink2) + 1.5; });

    // ------------------------------------------------------------ headers / footers
    var pages = doc.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      if (i > 1) { text("Mining Ops Analytics Report", M, 11, 8, "bold", C.muted); text(st.dates[0] + " to " + st.dates[n - 1], W - M, 11, 8, "normal", C.muted, { align: "right" }); setC("Draw", C.line); doc.setLineWidth(0.3); doc.line(M, 13.5, W - M, 13.5); }
      setC("Draw", C.line); doc.setLineWidth(0.3); doc.line(M, H - 13, W - M, H - 13);
      text("Weyland-Yutani Corporation  |  Mining Ops Analytics  |  generated " + stamp, M, H - 8, 7.5, "normal", C.muted);
      text("Page " + i + " of " + pages, W - M, H - 8, 7.5, "normal", C.muted, { align: "right" });
    }
    return doc;
  }

  root.Report = { build: build };
})(typeof window !== "undefined" ? window : this);
