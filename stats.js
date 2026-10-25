/* Pure statistics helpers: descriptive stats, four anomaly tests, polynomial trend, clustering. */
(function (root) {
  "use strict";
  var S = {};

  // ---------- descriptive ----------
  S.sum = function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; };
  S.mean = function (a) { return a.length ? S.sum(a) / a.length : NaN; };
  S.std = function (a) {                                   // sample standard deviation (n-1)
    if (a.length < 2) return 0;
    var m = S.mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  };
  S.quantile = function (a, q) {                           // linear interpolation, inclusive (Excel QUARTILE.INC / numpy default)
    if (!a.length) return NaN;
    var b = a.slice().sort(function (x, y) { return x - y; });
    var pos = (b.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return b[lo] + (b[hi] - b[lo]) * (pos - lo);
  };
  S.median = function (a) { return S.quantile(a, 0.5); };
  S.describe = function (a) {
    var q1 = S.quantile(a, 0.25), q3 = S.quantile(a, 0.75);
    return { n: a.length, mean: S.mean(a), std: S.std(a), median: S.median(a), q1: q1, q3: q3, iqr: q3 - q1,
             min: Math.min.apply(null, a), max: Math.max.apply(null, a), sum: S.sum(a) };
  };

  // ---------- Student t (for Grubbs) ----------
  function lgamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
    var s = 1.000000000190015;
    for (var j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  function betacf(a, b, x) {
    var MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
      var del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  S.ibeta = function (x, a, b) {                           // regularized incomplete beta I_x(a,b)
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  };
  S.tcdf = function (t, nu) {
    var x = nu / (nu + t * t), p = 0.5 * S.ibeta(x, nu / 2, 0.5);
    return t > 0 ? 1 - p : p;
  };
  S.tinv = function (p, nu) {                              // quantile of Student t, p in (0,1)
    if (p === 0.5) return 0;
    if (p < 0.5) return -S.tinv(1 - p, nu);
    var lo = 0, hi = 1; while (S.tcdf(hi, nu) < p) hi *= 2;
    for (var i = 0; i < 200; i++) { var mid = (lo + hi) / 2; if (S.tcdf(mid, nu) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };

  // ---------- anomaly tests: each returns {flags:Bool[], ...} aligned with the input ----------
  S.testIQR = function (y, k) {
    var q1 = S.quantile(y, 0.25), q3 = S.quantile(y, 0.75), r = q3 - q1, lo = q1 - k * r, hi = q3 + k * r;
    return { flags: y.map(function (v) { return v < lo || v > hi; }), lo: lo, hi: hi, q1: q1, q3: q3 };
  };
  S.zscores = function (y) { var m = S.mean(y), s = S.std(y); return y.map(function (v) { return s > 0 ? (v - m) / s : 0; }); };
  S.testZ = function (y, thr) {
    var z = S.zscores(y); return { flags: z.map(function (v) { return Math.abs(v) > thr; }), z: z };
  };
  // local reference: moving average of the neighbours ("centered", the point itself excluded) or of the previous w days ("trailing")
  S.movingAverage = function (y, w, mode) {
    var n = y.length, out = new Array(n), half = Math.floor(w / 2);
    for (var i = 0; i < n; i++) {
      var a, b;
      if (mode === "trailing") { a = Math.max(0, i - w); b = i - 1; } else { a = Math.max(0, i - half); b = Math.min(n - 1, i + half); }
      var s = 0, c = 0;
      for (var j = a; j <= b; j++) { if (mode !== "trailing" && j === i) continue; s += y[j]; c++; }
      out[i] = c >= 2 ? s / c : NaN;
    }
    return out;
  };
  S.testMA = function (y, w, pct, mode) {
    var ma = S.movingAverage(y, w, mode);
    var dev = y.map(function (v, i) { return ma[i] > 0 ? (v - ma[i]) / ma[i] * 100 : NaN; });
    return { flags: dev.map(function (d) { return isFinite(d) && Math.abs(d) > pct; }), ma: ma, dev: dev };
  };
  S.grubbsCritical = function (n, alpha) {                 // two-sided critical value
    var t = S.tinv(1 - alpha / (2 * n), n - 2);
    return (n - 1) / Math.sqrt(n) * Math.sqrt(t * t / (n - 2 + t * t));
  };
  S.testGrubbs = function (y, alpha) {                     // iterative: remove the most extreme point while it is significant
    var idx = y.map(function (_, i) { return i; }), flags = y.map(function () { return false; }), steps = [];
    while (idx.length >= 3) {
      var vals = idx.map(function (i) { return y[i]; }), m = S.mean(vals), s = S.std(vals);
      if (!(s > 0)) break;
      var best = 0; for (var k = 1; k < idx.length; k++) if (Math.abs(vals[k] - m) > Math.abs(vals[best] - m)) best = k;
      var G = Math.abs(vals[best] - m) / s, Gc = S.grubbsCritical(idx.length, alpha);
      if (G > Gc) { flags[idx[best]] = true; steps.push({ index: idx[best], G: G, Gcrit: Gc }); idx.splice(best, 1); } else break;
    }
    return { flags: flags, steps: steps };
  };

  // ---------- polynomial trend (least squares on x scaled to [-1,1]) ----------
  S.polyfit = function (x, y, deg) {
    var n = x.length; deg = Math.max(0, Math.min(deg, n - 1));
    var x0 = Math.min.apply(null, x), x1 = Math.max.apply(null, x), sc = (x1 - x0) / 2 || 1, mid = (x0 + x1) / 2;
    var t = x.map(function (v) { return (v - mid) / sc; }), m = deg + 1, A = [], b = [], i, j, k;
    for (i = 0; i < m; i++) { A.push(new Array(m).fill(0)); b.push(0); }
    for (k = 0; k < n; k++) { var pw = [1]; for (i = 1; i < 2 * m; i++) pw.push(pw[i - 1] * t[k]);
      for (i = 0; i < m; i++) { b[i] += y[k] * pw[i]; for (j = 0; j < m; j++) A[i][j] += pw[i + j]; } }
    for (i = 0; i < m; i++) {                               // Gaussian elimination with partial pivoting
      var p = i; for (j = i + 1; j < m; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var tmp = A[i]; A[i] = A[p]; A[p] = tmp; var tb = b[i]; b[i] = b[p]; b[p] = tb;
      for (j = i + 1; j < m; j++) { var f = A[j][i] / A[i][i]; for (k = i; k < m; k++) A[j][k] -= f * A[i][k]; b[j] -= f * b[i]; }
    }
    var c = new Array(m).fill(0);
    for (i = m - 1; i >= 0; i--) { var s = b[i]; for (j = i + 1; j < m; j++) s -= A[i][j] * c[j]; c[i] = s / A[i][i]; }
    return { coef: c, mid: mid, scale: sc, deg: deg, eval: function (xv) { var tv = (xv - mid) / sc, r = 0; for (var q = c.length - 1; q >= 0; q--) r = r * tv + c[q]; return r; } };
  };

  // ---------- pre-processing before the tests ----------
  // mode: "none" | "weekday" | "trend" | "both"; returns adjusted series y and the multiplier x/y for every point
  S.adjust = function (x, dow, mode, deg) {
    var n = x.length, y = x.slice(), adj = x.map(function () { return 1; }), info = {};
    function apply(f) { for (var i = 0; i < n; i++) { if (f[i] > 0) { y[i] = y[i] / f[i]; adj[i] *= f[i]; } } }
    if (mode === "weekday" || mode === "both") {
      var sums = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0], m = S.mean(y);
      for (var i = 0; i < n; i++) { sums[dow[i]] += y[i]; cnt[dow[i]]++; }
      var fac = sums.map(function (s, k) { return cnt[k] >= 2 && m > 0 ? (s / cnt[k]) / m : 1; });
      info.weekday = fac; apply(dow.map(function (d) { return fac[d]; }));
    }
    if (mode === "trend" || mode === "both") {
      var idx = x.map(function (_, i) { return i; }), fit = S.polyfit(idx, y, deg), tv = idx.map(function (i) { return fit.eval(i); });
      var base = S.mean(tv), floor = Math.max(1e-9, Math.abs(base) * 0.05);
      var f2 = tv.map(function (v) { return Math.max(v, floor) / base; }); info.trendFit = fit; apply(f2);
    }
    return { y: y, adj: adj, info: info };
  };

  // ---------- one series, all four tests ----------
  S.analyse = function (x, dow, p) {
    var pre = S.adjust(x, dow, p.preprocess, p.trendDeg || 1), y = pre.y;
    var iqr = S.testIQR(y, p.iqrK), z = S.testZ(y, p.zThr), ma = S.testMA(y, p.maWindow, p.maPct, p.maMode), gr = S.testGrubbs(y, p.alpha);
    var on = p.enabled, n = x.length, flags = [], tests = [];
    for (var i = 0; i < n; i++) {
      var t = [];
      if (on.iqr && iqr.flags[i]) t.push("IQR"); if (on.z && z.flags[i]) t.push("Z"); if (on.ma && ma.flags[i]) t.push("MA"); if (on.grubbs && gr.flags[i]) t.push("Grubbs");
      tests.push(t); flags.push(t.length > 0);
    }
    var counts = { iqr: count(iqr.flags, on.iqr), z: count(z.flags, on.z), ma: count(ma.flags, on.ma), grubbs: count(gr.flags, on.grubbs), any: count(flags, true) };
    return { y: y, adj: pre.adj, info: pre.info, iqr: iqr, z: z, ma: ma, grubbs: gr, flags: flags, tests: tests, counts: counts };
  };
  function count(f, on) { var c = 0; if (on) for (var i = 0; i < f.length; i++) if (f[i]) c++; return c; }

  // ---------- group consecutive flagged days (same direction) into one anomaly ----------
  S.clusters = function (a, x, dates) {
    var out = [], cur = null, med = S.median(a.y);
    for (var i = 0; i < x.length; i++) {
      var ref = isFinite(a.ma.ma[i]) ? a.ma.ma[i] : med, dir = a.y[i] >= ref ? "spike" : "drop";
      if (a.flags[i]) {
        if (cur && cur.dir === dir && cur.end === i - 1) { cur.end = i; cur.idx.push(i); }
        else { cur = { dir: dir, start: i, end: i, idx: [i] }; out.push(cur); }
      } else cur = null;
    }
    out.forEach(function (c) {
      var best = c.idx[0], bd = -1;
      c.idx.forEach(function (i) { var r = isFinite(a.ma.ma[i]) ? a.ma.ma[i] : med, d = r ? Math.abs(a.y[i] - r) / Math.abs(r) : 0; if (d > bd) { bd = d; best = i; } });
      c.peak = best; c.value = x[best];
      var ref = isFinite(a.ma.ma[best]) ? a.ma.ma[best] : med;
      c.expected = ref * a.adj[best]; c.devPct = ref ? (a.y[best] - ref) / ref * 100 : NaN;
      c.z = a.z.z[best]; c.length = c.idx.length;
      var ts = {}; c.idx.forEach(function (i) { a.tests[i].forEach(function (t) { ts[t] = 1; }); }); c.tests = Object.keys(ts);
      c.startDate = dates[c.start]; c.endDate = dates[c.end]; c.peakDate = dates[best];
    });
    return out;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = S; else root.Stats = S;
})(typeof window !== "undefined" ? window : this);
