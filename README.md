# Mining Ops Analytics (Weyland-Yutani)

Static web dashboard (no backend) that reads the **Data** tab of the public Google Sheet produced by the
"Mining Ops Simulator" generator and analyses it in the browser.

Live: see the link in the e-mail / repository description (GitHub Pages).

## What it shows
- For every mine and for the total: mean, standard deviation, median, IQR (+ Q1, Q3, min, max).
- Four anomaly tests with adjustable parameters: IQR rule, z-score, distance from a moving average, Grubbs' test.
  Optional pre-processing (weekday pattern and polynomial trend removed) so only real spikes/drops are flagged.
- Line, bar and stacked charts; flagged days highlighted; polynomial trendline of degree 1-4.
- Anomaly list (groups of consecutive flagged days) and a data table.
- **Download PDF report**: summary tables, parameters, charts for every series, anomaly register, a separate
  section for each spike or drop, and the methodology.
- Refresh button and optional auto-refresh (30 s). Dark/light theme.

## Data source
Set the sheet link in `config.js` (`sheetUrl`), or paste it in the *Data source* panel, or open `?sheet=<link>`.
The sheet must be shared as *Anyone with the link* and contain a tab named `Data`
(`Date`, one column per mine, `Total`). The dashboard reads
`https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=Data`.
Without a readable sheet it falls back to built-in demo data (clearly labelled); a CSV can also be uploaded.

## Files
`index.html` page and styles, `app.js` UI, `stats.js` statistics and tests, `chartkit.js` chart configuration,
`report.js` PDF report, `demo.js` demo data, libraries: Chart.js 4.4.4, jsPDF 2.5.2, jsPDF-AutoTable 3.8.4.

## Methods
- Quartiles: linear interpolation (Excel QUARTILE.INC). Standard deviation: sample (n-1).
- IQR rule: outside [Q1 - k*IQR, Q3 + k*IQR]. z-score: |z| > threshold.
- Moving average: mean of the neighbouring days (centered window, the day itself excluded) or of the previous days
  (trailing); outlier if farther than the chosen percentage.
- Grubbs: two-sided, iterative, critical value from the Student t distribution (verified against SciPy).
- Trend: least-squares polynomial (verified against NumPy `polyfit`).
