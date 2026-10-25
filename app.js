(function () {
  "use strict";
  var S = Stats, CK = ChartKit;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var fmt = CK.fmt;
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem("wy_" + k)); localStorage.setItem("wy_" + k, JSON.stringify(v)); } catch (e) { return null; } }

  var DEFAULTS = { preprocess: "both", trendDeg: 2, enabled: { iqr: true, z: true, ma: true, grubbs: true }, iqrK: 1.5, zThr: 3, maWindow: 15, maPct: 75, maMode: "centered", alpha: 0.05 };
  var saved = store("params");
  var state = { dates: [], dow: [], series: [], analysis: [], clusters: [], sel: 0, type: store("type") || "line", trend: store("trend") == null ? 1 : store("trend"),
    view: "chart", params: Object.assign({}, DEFAULTS, saved || {}), source: "", hash: "", updated: null, sheetId: null };
  state.params.enabled = Object.assign({}, DEFAULTS.enabled, (saved && saved.enabled) || {});
  var chart = null, timer = null;

  // ---------------------------------------------------------------- CSV / data
  function parseCSV(text) {
    var rows = [], row = [], cur = "", q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function parseDate(s) {
    s = String(s).trim(); var m;
    if ((m = /^Date\((\d+),(\d+),(\d+)/.exec(s))) return m[1] + "-" + pad(+m[2] + 1) + "-" + pad(+m[3]);
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return m[3] + "-" + pad(+m[1]) + "-" + pad(+m[2]);
    if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) return m[3] + "-" + pad(+m[2]) + "-" + pad(+m[1]);
    return null;
  }
  function dowOf(iso) { var p = iso.split("-"); return (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7; }  // Mon = 0

  function ingest(text) {
    var rows = parseCSV(text).filter(function (r) { return r.length > 1; });
    if (rows.length < 2) throw new Error("The data tab is empty.");
    var header = rows[0].map(function (s) { return s.trim(); }), cols = [];
    header.forEach(function (h, i) { if (i > 0 && h && !/^total$/i.test(h)) cols.push({ name: h, i: i }); });
    if (!cols.length) throw new Error("No mine columns found (the header row of the Data tab has no mine names).");
    var dates = [], vals = cols.map(function () { return []; });
    rows.slice(1).forEach(function (r) {
      var d = parseDate(r[0] || ""); if (!d) return;
      var v = cols.map(function (c) { return parseFloat(String(r[c.i]).replace(",", ".")); });
      if (v.some(function (x) { return !isFinite(x); })) return;
      dates.push(d); v.forEach(function (x, k) { vals[k].push(x); });
    });
    if (dates.length < 5) throw new Error("Need at least 5 days of data; found " + dates.length + ".");
    var total = dates.map(function (_, i) { return Math.round(vals.reduce(function (s, a) { return s + a[i]; }, 0) * 100) / 100; });
    state.dates = dates; state.dow = dates.map(dowOf);
    state.series = [{ name: "Total", values: total }].concat(cols.map(function (c, k) { return { name: c.name, values: vals[k] }; }));
    if (state.sel >= state.series.length) state.sel = 0;
  }

  // ---------------------------------------------------------------- analysis
  function recompute() {
    var p = state.params;
    var ap = { preprocess: p.preprocess, trendDeg: p.trendDeg, iqrK: p.iqrK, zThr: p.zThr, maWindow: p.maWindow, maPct: p.maPct, maMode: p.maMode, alpha: p.alpha, enabled: p.enabled };
    state.analysis = state.series.map(function (s) { return S.analyse(s.values, state.dow, ap); });
    state.clusters = [];
    state.series.forEach(function (s, k) {
      S.clusters(state.analysis[k], s.values, state.dates).forEach(function (c) { c.series = k; state.clusters.push(c); });
    });
    state.clusters.sort(function (a, b) { return a.start - b.start || a.series - b.series; });
    state.stats = state.series.map(function (s) { return S.describe(s.values); });
  }
  function themeName() {
    var t = document.documentElement.dataset.theme;
    return t ? t : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }

  // ---------------------------------------------------------------- rendering
  function renderKpis() {
    var box = $("kpis"); clear(box);
    var tot = state.stats[0], nm = state.series.length - 1;
    var items = [
      ["Period start", state.dates[0], "to " + state.dates[state.dates.length - 1] + " · " + state.dates.length + " days · " + nm + " mine" + (nm === 1 ? "" : "s")],
      ["Total output", fmt(tot.sum), "all mines, whole period"],
      ["Mean daily output", fmt(tot.mean), "σ " + fmt(tot.std) + " · median " + fmt(tot.median)],
      ["Anomalies", String(state.clusters.length), state.analysis.reduce(function (s, a) { return s + a.counts.any; }, 0) + " flagged mine-days"]
    ];
    items.forEach(function (it) {
      var k = el("div", "kpi"); k.appendChild(el("div", "l", it[0])); k.appendChild(el("div", "v", it[1])); k.appendChild(el("div", "s", it[2])); box.appendChild(k);
    });
  }

  function numField(label, key, step, min, max, int) {
    var f = el("label", "field"); f.appendChild(el("span", null, label));
    var i = el("input"); i.type = "number"; i.step = step; i.min = min; i.max = max; i.value = state.params[key];
    i.addEventListener("input", function () {
      var v = parseFloat(i.value); if (!isFinite(v)) return; v = Math.min(max, Math.max(min, int ? Math.round(v) : v)); state.params[key] = v; changed();
    });
    f.appendChild(i); return f;
  }
  function selField(label, key, opts, num) {
    var f = el("label", "field" + (opts.length > 3 ? " stack" : "")); f.appendChild(el("span", null, label));
    var s = el("select");
    opts.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; if (String(state.params[key]) === String(o[0])) op.selected = true; s.appendChild(op); });
    s.addEventListener("change", function () { state.params[key] = num ? parseFloat(s.value) : s.value; changed(); });
    f.appendChild(s); return f;
  }
  function testCard(title, key, fields) {
    var c = el("div", "tset" + (state.params.enabled[key] ? "" : " off")), t = el("div", "t");
    t.appendChild(el("span", null, title));
    var lab = el("label", "check"), cb = el("input"); cb.type = "checkbox"; cb.checked = !!state.params.enabled[key];
    cb.setAttribute("aria-label", "Enable " + title);
    cb.addEventListener("change", function () { state.params.enabled[key] = cb.checked; c.classList.toggle("off", !cb.checked); changed(); });
    lab.appendChild(cb); lab.appendChild(document.createTextNode(" on")); t.appendChild(lab); c.appendChild(t);
    fields.forEach(function (f) { c.appendChild(f); }); return c;
  }
  function renderSettings() {
    var box = $("settings"); clear(box);
    var pre = el("div", "tset"), t = el("div", "t"); t.appendChild(el("span", null, "Pre-processing")); pre.appendChild(t);
    pre.appendChild(selField("Tests run on", "preprocess", [["none", "Raw values"], ["weekday", "Weekday pattern removed"], ["trend", "Trend removed"], ["both", "Weekday + trend removed"]]));
    pre.appendChild(numField("Detrend degree", "trendDeg", 1, 1, 4, true));
    pre.appendChild(el("div", "note", "Removes the weekly cycle and the long-term trend so only real spikes and drops remain."));
    box.appendChild(pre);
    box.appendChild(testCard("IQR rule", "iqr", [numField("Multiplier k", "iqrK", 0.1, 0.5, 5)]));
    box.appendChild(testCard("z-score", "z", [numField("Threshold |z|", "zThr", 0.1, 1, 6)]));
    box.appendChild(testCard("Moving average", "ma", [numField("Window (days)", "maWindow", 1, 3, 61, true),
      selField("Window", "maMode", [["centered", "Centered"], ["trailing", "Trailing"]]), numField("Distance (%)", "maPct", 5, 5, 500)]));
    box.appendChild(testCard("Grubbs' test", "grubbs", [selField("Significance α", "alpha", [["0.1", "0.10"], ["0.05", "0.05"], ["0.01", "0.01"]], true)]));
  }

  function renderStats() {
    var tb = $("stats"); clear(tb);
    var heads = ["Series", "Mean", "Std dev", "Median", "IQR", "Q1", "Q3", "Min", "Max", "IQR rule", "z-score", "Mov. avg", "Grubbs", "Anomalies"];
    var tr = el("tr"); heads.forEach(function (h) { tr.appendChild(el("th", null, h)); }); var th = el("thead"); th.appendChild(tr); tb.appendChild(th);
    var body = el("tbody");
    state.series.forEach(function (s, k) {
      var d = state.stats[k], a = state.analysis[k], r = el("tr", "click" + (k === state.sel ? " active" : ""));
      r.tabIndex = 0; r.setAttribute("aria-label", "Chart " + s.name);
      var c0 = el("td"), sw = el("span", "sw"); sw.style.background = CK.seriesColor(themeName(), k); c0.appendChild(sw); c0.appendChild(document.createTextNode(s.name)); r.appendChild(c0);
      [d.mean, d.std, d.median, d.iqr, d.q1, d.q3, d.min, d.max].forEach(function (v) { r.appendChild(el("td", null, fmt(v))); });
      var en = state.params.enabled;
      [["iqr", a.counts.iqr], ["z", a.counts.z], ["ma", a.counts.ma], ["grubbs", a.counts.grubbs]].forEach(function (x) {
        r.appendChild(el("td", x[1] > 0 ? "flag" : null, en[x[0]] ? String(x[1]) : "off"));
      });
      var cl = state.clusters.filter(function (c) { return c.series === k; }).length;
      r.appendChild(el("td", cl > 0 ? "flag" : null, cl + " (" + a.counts.any + " d)"));
      function pick() { state.sel = k; renderStats(); renderChart(); }
      r.addEventListener("click", pick); r.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      body.appendChild(r);
    });
    tb.appendChild(body);
  }

  function seg(box, items, current, onpick) {
    clear(box);
    items.forEach(function (it) {
      var b = el("button", null, it[1]); b.type = "button"; b.setAttribute("aria-pressed", String(String(current) === String(it[0])));
      b.addEventListener("click", function () { onpick(it[0]); }); box.appendChild(b);
    });
  }
  function renderControls() {
    var chips = $("serieschips"); clear(chips);
    state.series.forEach(function (s, k) {
      var b = el("button", "chip"); b.type = "button"; b.setAttribute("aria-pressed", String(k === state.sel));
      var sw = el("span", "sw"); sw.style.background = CK.seriesColor(themeName(), k); b.appendChild(sw); b.appendChild(document.createTextNode(s.name));
      b.addEventListener("click", function () { state.sel = k; renderStats(); renderControls(); renderChart(); }); chips.appendChild(b);
    });
    seg($("typeseg"), [["line", "Line"], ["bar", "Bar"], ["stacked", "Stacked"]], state.type, function (v) { state.type = v; store("type", v); renderControls(); renderChart(); });
    seg($("trendseg"), [[0, "Off"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]], state.trend, function (v) { state.trend = +v; store("trend", +v); renderControls(); renderChart(); });
    seg($("viewseg"), [["chart", "Chart"], ["table", "Data table"]], state.view, function (v) { state.view = v; renderControls(); renderChart(); });
  }

  function renderKey() {
    var k = $("key"); clear(k);
    function item(i, text) { var s = el("span"); s.appendChild(i); s.appendChild(document.createTextNode(text)); k.appendChild(s); }
    var T = CK.THEME[themeName()];
    if (state.type === "stacked") {
      state.series.slice(1).forEach(function (s, q) { var b = el("i", "k-box"); b.style.background = CK.seriesColor(themeName(), q + 1); item(b, s.name); });
    } else {
      var i = el("i", state.type === "bar" ? "k-box" : "k-line"); i.style.background = CK.seriesColor(themeName(), state.sel); item(i, state.series[state.sel].name);
    }
    var d = el("i", "k-dia"); item(d, state.type === "bar" ? "Anomaly (red bar)" : "Anomaly");
    if (state.trend) { var t = el("i", "k-dash"); t.style.borderColor = T.trend; item(t, "Trend, polynomial degree " + state.trend + (state.type === "stacked" ? " (Total)" : "")); }
  }

  function renderChart() {
    $("chartview").hidden = state.view !== "chart"; $("tableview").hidden = state.view !== "table";
    if (state.view === "table") { renderDataTable(); return; }
    renderKey();
    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart($("chart"), CK.buildConfig({ theme: themeName(), type: state.type, dates: state.dates, dow: state.dow, series: state.series,
      analysis: state.analysis, sel: state.sel, trendDeg: state.trend, animate: true }));
    $("chartnote").textContent = state.type === "stacked"
      ? "Stacked: every mine is a segment; segments with a red outline are flagged for that mine, red diamonds mark days where the Total is flagged."
      : "Showing " + state.series[state.sel].name + ". Red marks are days flagged by at least one enabled test; hover for the tests that fired.";
  }

  function renderDataTable() {
    var tb = $("datatable"); clear(tb);
    var tr = el("tr"); ["Date", "Day"].concat(state.series.map(function (s) { return s.name; })).forEach(function (h, i) { tr.appendChild(el("th", i < 2 ? "l" : null, h)); });
    var th = el("thead"); th.appendChild(tr); tb.appendChild(th);
    var body = el("tbody");
    state.dates.forEach(function (d, i) {
      var r = el("tr"); r.appendChild(el("td", "l", d)); r.appendChild(el("td", "l", CK.WD[state.dow[i]]));
      state.series.forEach(function (s, k) {
        var a = state.analysis[k], f = a.flags[i], sign = f ? (a.y[i] >= (isFinite(a.ma.ma[i]) ? a.ma.ma[i] : S.median(a.y)) ? "+ " : "– ") : "";
        var td = el("td", f ? "flag" : null, sign + fmt(s.values[i])); if (f) td.title = "Flagged by " + a.tests[i].join(", "); r.appendChild(td);
      });
      body.appendChild(r);
    });
    tb.appendChild(body);
  }

  function renderAnoms() {
    var tb = $("anoms"); clear(tb);
    $("anomhint").textContent = state.clusters.length + " anomalies in " + state.series.length + " series";
    var heads = ["Series", "Type", "From", "To", "Days", "Peak day", "Value", "Expected", "Deviation", "z", "Tests"];
    var tr = el("tr"); heads.forEach(function (h, i) { tr.appendChild(el("th", i === 0 || i === 1 || i === 10 ? "l" : null, h)); }); var th = el("thead"); th.appendChild(tr); tb.appendChild(th);
    var body = el("tbody");
    if (!state.clusters.length) { var r0 = el("tr"), td0 = el("td", "empty", "No anomalies with the current parameters."); td0.colSpan = heads.length; r0.appendChild(td0); body.appendChild(r0); }
    state.clusters.slice(0, 400).forEach(function (c) {
      var r = el("tr", "click"); r.tabIndex = 0;
      var c0 = el("td", "l"), sw = el("span", "sw"); sw.style.background = CK.seriesColor(themeName(), c.series); c0.appendChild(sw); c0.appendChild(document.createTextNode(state.series[c.series].name)); r.appendChild(c0);
      r.appendChild(el("td", "l " + (c.dir === "spike" ? "tag-spike" : "tag-drop"), c.dir === "spike" ? "▲ Spike" : "▼ Drop"));
      r.appendChild(el("td", null, c.startDate)); r.appendChild(el("td", null, c.endDate)); r.appendChild(el("td", null, String(c.length)));
      r.appendChild(el("td", null, c.peakDate)); r.appendChild(el("td", null, fmt(c.value))); r.appendChild(el("td", null, fmt(c.expected)));
      r.appendChild(el("td", "flag", (c.devPct > 0 ? "+" : "") + c.devPct.toFixed(0) + "%")); r.appendChild(el("td", null, c.z.toFixed(2)));
      var tt = el("td", "l"); c.tests.forEach(function (t) { tt.appendChild(el("span", "badge", t)); }); r.appendChild(tt);
      function pick() { state.sel = c.series; state.view = "chart"; renderStats(); renderControls(); renderChart(); $("chart").scrollIntoView({ behavior: "smooth", block: "center" }); }
      r.addEventListener("click", pick); r.addEventListener("keydown", function (e) { if (e.key === "Enter") pick(); });
      body.appendChild(r);
    });
    tb.appendChild(body);
  }

  function renderAll() { renderKpis(); renderSettings(); renderStats(); renderControls(); renderChart(); renderAnoms(); $("main").hidden = false; }
  function changed() {
    store("params", state.params); clearTimeout(timer);
    timer = setTimeout(function () { recompute(); renderKpis(); renderStats(); renderChart(); renderAnoms(); }, 120);
  }

  // ---------------------------------------------------------------- data sources
  function setStatus(text, kind) { $("status").textContent = text; $("dot").className = "dot" + (kind ? " " + kind : ""); }
  function hhmmss() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function sheetId(s) { var m = /\/d\/([\w-]+)/.exec(s || ""); return m ? m[1] : (/^[\w-]{25,}$/.test((s || "").trim()) ? s.trim() : null); }

  function apply(text, label, kind) {
    var h = text.length + ":" + text.slice(0, 200) + text.slice(-200) + text.replace(/[^0-9]/g, "").length;
    var first = !state.series.length, same = h === state.hash;
    if (!same || first) { ingest(text); state.hash = h; recompute(); renderAll(); }
    state.updated = hhmmss(); state.source = label;
    var nm = state.series.length - 1;
    setStatus((kind === "live" ? "Live · " : "") + label + " · " + state.dates.length + " days × " + nm + " mine" + (nm === 1 ? "" : "s") + " · checked " + state.updated + (same && !first ? " (no changes)" : ""), kind);
    return !same;
  }
  async function fetchSheet(link, silent) {
    var id = sheetId(link); if (!id) throw new Error("That does not look like a Google Sheets link.");
    var url = "https://docs.google.com/spreadsheets/d/" + id + "/gviz/tq?tqx=out:csv&sheet=Data&headers=1";
    var res;
    try { res = await fetch(url, { cache: "no-store" }); }
    catch (e) { throw new Error("The browser could not reach Google Sheets (network or CORS). Check the link and that the sheet is shared as 'Anyone with the link'."); }
    var text = await res.text();
    if (!res.ok || /^\s*</.test(text)) throw new Error("Google did not return data. Make sure the sheet is shared with 'Anyone with the link' and has a tab named Data.");
    state.sheetId = id; return text;
  }
  async function loadFromSheet(link, silent) {
    try {
      var text = await fetchSheet(link, silent);
      apply(text, "Google Sheet", "live"); $("srcerr").textContent = ""; store("url", link); return true;
    } catch (e) {
      $("srcerr").textContent = e.message;
      var empty = !state.series.length;
      if (empty) { apply(window.DEMO_CSV, "DEMO data", "err"); $("srcpanel").hidden = false; $("srcbtn").setAttribute("aria-expanded", "true"); }
      setStatus((empty ? "Showing DEMO data. Could not read the Google Sheet: " : "Could not refresh: ") + e.message, "err"); return false;
    }
  }

  function wire() {
    $("srcbtn").addEventListener("click", function () { var h = $("srcpanel").hidden; $("srcpanel").hidden = !h; $("srcbtn").setAttribute("aria-expanded", String(h)); });
    $("load").addEventListener("click", function () { var v = $("url").value.trim(); if (v) { setStatus("Loading…"); loadFromSheet(v); } });
    $("url").addEventListener("keydown", function (e) { if (e.key === "Enter") $("load").click(); });
    $("demo").addEventListener("click", function () { state.hash = ""; state.series = []; apply(window.DEMO_CSV, "DEMO data", "err"); $("srcerr").textContent = ""; });
    $("file").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { try { state.series = []; state.hash = ""; apply(String(r.result), "File " + f.name, "err"); $("srcerr").textContent = ""; } catch (err) { $("srcerr").textContent = err.message; } };
      r.readAsText(f);
    });
    $("refresh").addEventListener("click", function () {
      var link = $("url").value.trim() || store("url");
      if (state.sheetId && link) { setStatus("Refreshing…"); loadFromSheet(link); } else setStatus("Demo/file data has nothing to refresh. Link a Google Sheet in 'Data source'.", "err");
    });
    var auto = null;
    $("auto").addEventListener("change", function (e) {
      clearInterval(auto); store("auto", e.target.checked);
      if (e.target.checked) auto = setInterval(function () { var link = $("url").value.trim() || store("url"); if (state.sheetId && link) loadFromSheet(link, true); }, 30000);
    });
    $("theme").addEventListener("click", function () {
      document.documentElement.dataset.theme = themeName() === "dark" ? "light" : "dark"; if (state.series.length) { renderStats(); renderControls(); renderChart(); renderAnoms(); }
    });
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (state.series.length && !document.documentElement.dataset.theme) { renderStats(); renderControls(); renderChart(); } });
    $("pdf").addEventListener("click", function () {
      if (!state.series.length) return; var b = $("pdf"); b.disabled = true; b.textContent = "Generating PDF…";
      setTimeout(function () {
        try {
          Report.build({ state: state, source: state.source, sheetId: state.sheetId }).save("Mining-Ops-Report_" + state.dates[0] + "_" + state.dates[state.dates.length - 1] + ".pdf");
        } catch (err) { setStatus("PDF failed: " + err.message, "err"); console.error(err); }
        b.disabled = false; b.textContent = "Download PDF report";
      }, 60);
    });
  }

  function init() {
    wire();
    var q = new URLSearchParams(location.search).get("sheet");
    var link = q || (window.CONFIG && window.CONFIG.sheetUrl) || store("url") || "";
    $("url").value = link;
    if (store("auto")) { $("auto").checked = true; $("auto").dispatchEvent(new Event("change")); }
    if (link) { setStatus("Loading Google Sheet…"); loadFromSheet(link); }
    else { apply(window.DEMO_CSV, "DEMO data (no sheet linked yet)", "err"); $("srcpanel").hidden = false; }
  }
  window.WY = { state: state, ingest: ingest, recompute: recompute, renderAll: renderAll };   // used by automated tests
  init();
})();
