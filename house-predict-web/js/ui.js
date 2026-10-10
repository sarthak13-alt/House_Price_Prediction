// ui.js - connects the buttons and forms on the page with the code in data.js, compare.js and charts.js

const STATE = { df: null, original: null, trained: null };   // the dataset and the trained models
let INFO = null;        // information about the current dataset (shown in cards and tables)
let currentPage = 1;    // page number of the Dataset table

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ small helpers
function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// highlightName: the table row whose first cell equals this text is shown in green (best model)
function tableHTML(t, highlightName = null) {
  if (!t || !t.columns) return "<p>No data.</p>";
  const head = t.columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = t.rows.map((row) =>
    `<tr class="${row[0] === highlightName ? "best-row" : ""}">` +
    row.map((v) => (v === null || v === undefined ? '<td class="null">missing</td>' : `<td>${esc(v)}</td>`)).join("") + "</tr>"
  ).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function card(value, label, style = "") {
  const small = String(value).length > 14 ? ' style="font-size:15px"' : "";   // long text such as file names
  return `<div class="card ${style}"><div class="num"${small}>${esc(value)}</div><div class="lbl">${esc(label)}</div></div>`;
}

function errorBox(message) { return `<div class="error-box">${esc(message)}</div>`; }
function notesHTML(notes) { return (notes || []).map((n) => `<div class="note-box">${esc(n)}</div>`).join(""); }
function bestBanner(text) { return `<div class="best-banner">${text}</div>`; }
function chartSlot(name) { return `<div class="img-box" data-chart="${name}"></div>`; }
function putChart(box, name, canvas) { box.querySelector(`[data-chart="${name}"]`).appendChild(canvas); }

function showGlobalMessage(text, ok = false) {
  const box = $("global-message");
  box.textContent = text;
  box.className = "message" + (ok ? " ok" : "");
  if (ok) setTimeout(() => box.classList.add("hidden"), 3500);
}

// Runs one step: shows "Running...", then the result, or a simple error message (never a stack trace).
async function runAndShow(button, resultBox, task, render, after) {
  button.disabled = true;
  resultBox.innerHTML = '<div class="loading">Running, please wait... (training the models can take 10-20 seconds)</div>';
  await pause();
  try {
    const data = await task();
    resultBox.innerHTML = render(data);
    if (after) after(data, resultBox);
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    resultBox.innerHTML = errorBox(e instanceof UserError ? e.message
      : "Something went wrong while running this step. Please check the selected columns and try again.");
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------ navigation
const PAGE_TITLES = { dashboard: "Dashboard", dataset: "Dataset", preprocessing: "Preprocessing", analysis: "Analysis", regression: "Price Prediction",
  classification: "Price Category", compareall: "Compare All Algorithms", predict: "Predict a House", admin: "Admin Panel" };
function showPage(name) {
  if (!Auth.canOpen(name)) { showGlobalMessage("This page is only for admins."); name = "dashboard"; }
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  $("page-" + name).classList.remove("hidden");
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  window.scrollTo(0, 0);
  $("page-title").textContent = PAGE_TITLES[name] || "Dashboard";
  if (name === "compareall") renderAcross();
  if (name === "predict") loadPredictForm();
  if (name === "admin" && typeof renderAdminPanel === "function") renderAdminPanel();
  if (name === "dashboard" && typeof renderDashboardHistory === "function") renderDashboardHistory();
}
document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => showPage(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => showPage(b.dataset.go)));

// ------------------------------------------------------------ upload / sample
function useNewDataset(df) {
  STATE.original = df;
  STATE.df = copyDataset(df);
  STATE.trained = null;
  refreshDataset();
}

$("csv-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!Auth.isAdmin()) { showGlobalMessage("Only an admin can upload a CSV dataset."); event.target.value = ""; return; }
  if (!file.name.toLowerCase().endsWith(".csv")) { showGlobalMessage("Please choose a .csv file."); event.target.value = ""; return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      useNewDataset(createDataset(reader.result, file.name));
      Log.add(Auth.current().username, `Uploaded the dataset '${file.name}'`);
      showGlobalMessage(`"${file.name}" uploaded successfully.`, true);
    } catch (e) {
      if (!(e instanceof UserError)) console.error(e);
      showGlobalMessage(e instanceof UserError ? e.message : "This file could not be read. Please check that it is a valid CSV file.");
    }
  };
  reader.onerror = () => showGlobalMessage("The file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
});

$("load-sample").addEventListener("click", () => {
  try {
    useNewDataset(createDataset(SAMPLE_CSV, "sample_house_prices.csv"));
    Log.add(Auth.current().username, "Loaded the sample dataset");
    showGlobalMessage("Sample dataset loaded.", true);
  } catch (e) { showGlobalMessage(e.message); }
});

// ------------------------------------------------------------ fill the page after a dataset is loaded
function isIdLike(name) {
  const column = INFO.columnInfo.find((c) => c.name === name);
  // an ID is a column named "...id", or a text column where almost every value is different
  return /(^|[_\s])id$/i.test(name) || (column && column.type === "Categorical" && column.unique > 0.9 * INFO.rows);
}

// Guess which column is the price: a name like price/cost/rent, otherwise the last numerical column
function guessPriceColumn() {
  const byName = INFO.numeric.find((n) => /price|cost|rent|value|amount/i.test(n));
  return byName || INFO.numeric[INFO.numeric.length - 1] || INFO.columnInfo[INFO.columnInfo.length - 1].name;
}

function optionsHTML(names, selected, withNone = false) {
  const none = withNone ? '<option value="">(none)</option>' : "";
  return none + names.map((n) => `<option value="${esc(n)}" ${n === selected ? "selected" : ""}>${esc(n)}</option>`).join("");
}

function renderChecks(containerId, names, checked) {
  $(containerId).innerHTML = names.map((n) =>
    `<label><input type="checkbox" value="${esc(n)}" ${checked.includes(n) ? "checked" : ""}> ${esc(n)}</label>`).join("");
}

function getChecked(containerId) {
  return [...$(containerId).querySelectorAll("input:checked")].map((i) => i.value);
}

function refreshDataset() {
  const df = STATE.df;
  INFO = datasetInfo(df);
  const info = INFO;
  $("global-message").classList.add("hidden");
  $("dataset-name").textContent = info.name;
  const allNames = df.columns;

  const cardsHTML = [
    card(info.name, "Dataset name"), card(info.rows.toLocaleString(), "Records"), card(info.columns, "Columns"),
    card(info.missing.toLocaleString(), "Missing values"), card(info.duplicates.toLocaleString(), "Duplicate rows"),
    card(info.numeric.length, "Numerical columns"), card(info.categorical.length, "Categorical columns"),
  ].join("");
  ["dash-cards", "dataset-cards", "analysis-cards"].forEach((id) => ($(id).innerHTML = cardsHTML));
  $("dash-empty").classList.add("hidden");

  const columnTable = { columns: ["Column", "Data type", "Kind", "Missing values", "Unique values"],
    rows: info.columnInfo.map((c) => [c.name, c.dtype, c.type, c.missing, c.unique]) };
  $("column-table").innerHTML = tableHTML(columnTable);
  $("numeric-stats").innerHTML = info.numericStats ? tableHTML(info.numericStats) : "<p>&nbsp;No numerical columns.</p>";
  $("categorical-stats").innerHTML = info.categoricalStats ? tableHTML(info.categoricalStats) : "<p>&nbsp;No categorical columns.</p>";
  $("analysis-stats").innerHTML = $("numeric-stats").innerHTML + "<br>" + $("categorical-stats").innerHTML;
  loadRows(1);

  // preprocessing
  renderChecks("pp-drop", allNames, []);
  $("pp-outlier").innerHTML = optionsHTML(info.numeric, "", true);

  // analysis
  $("ch-x").innerHTML = optionsHTML(allNames, allNames[0]);
  $("ch-y").innerHTML = optionsHTML(info.numeric, "", true);
  $("ch-result").innerHTML = "";
  updateChartControls();
  renderQuickButtons();

  // model pages
  const price = guessPriceColumn();
  $("rg-target").innerHTML = optionsHTML(info.numeric, price);
  $("cl-target").innerHTML = optionsHTML(allNames, price);
  $("al-target").innerHTML = optionsHTML(info.numeric, price);
  ["rg", "cl", "al"].forEach((prefix) => {
    renderFeatureChecks(prefix, null);
    $(prefix + "-result").innerHTML = "";
  });
  $("predict-form-box").innerHTML = "";
  $("predict-result").innerHTML = "";
}

// Feature checkboxes: everything except the target and ID-like columns
function renderFeatureChecks(prefix, keepFrom) {
  const target = $(prefix + "-target").value;
  const names = INFO.columnInfo.map((c) => c.name).filter((n) => n !== target);
  const keep = keepFrom ? keepFrom.filter((n) => n !== target) : names.filter((n) => !isIdLike(n));
  renderChecks(prefix + "-features", names, keep);
}
["rg", "cl", "al"].forEach((prefix) => {
  $(prefix + "-target").addEventListener("change", () => renderFeatureChecks(prefix, getChecked(prefix + "-features")));
});
document.addEventListener("click", (event) => {
  const link = event.target.closest("a.tiny-link");
  if (!link) return;
  event.preventDefault();
  const id = link.dataset.all || link.dataset.none;
  $(id).querySelectorAll("input").forEach((i) => (i.checked = !!link.dataset.all));
});

// ------------------------------------------------------------ dataset page rows (15 per page)
function loadRows(page) {
  const df = STATE.df;
  const pages = Math.max(1, Math.ceil(df.rows.length / 15));
  currentPage = Math.min(Math.max(page, 1), pages);
  const slice = df.rows.slice((currentPage - 1) * 15, currentPage * 15);
  $("rows-table").innerHTML = tableHTML({ columns: df.columns, rows: slice.map((r) => df.columns.map((c) => r[c])) });
  $("page-label").textContent = `Page ${currentPage} of ${pages}  (${df.rows.length.toLocaleString()} rows)`;
  $("prev-page").disabled = currentPage <= 1;
  $("next-page").disabled = currentPage >= pages;
}
$("prev-page").addEventListener("click", () => loadRows(currentPage - 1));
$("next-page").addEventListener("click", () => loadRows(currentPage + 1));

// ------------------------------------------------------------ preprocessing
function needDataset() {
  if (!STATE.df) throw new UserError("Please upload a CSV file or click 'Load Sample Dataset' first.");
  return STATE.df;
}

$("pp-apply").addEventListener("click", () => {
  try {
    if (!Auth.isAdmin()) throw new UserError("Only an admin can preprocess the data.");
    const result = preprocessDataset(needDataset(), {
      removeDuplicates: $("pp-duplicates").checked,
      missing: document.querySelector("input[name=pp-missing]:checked").value,
      outlierColumn: $("pp-outlier").value,
      dropColumns: getChecked("pp-drop"),
    });
    STATE.df = result.df;
    STATE.trained = null;
    refreshDataset();
    const box = (title, c) => `<div class="panel"><h4>${title}</h4>Rows: <b>${c.rows.toLocaleString()}</b><br>
      Columns: <b>${c.columns}</b><br>Missing values: <b>${c.missing.toLocaleString()}</b><br>
      Duplicate rows: <b>${c.duplicates.toLocaleString()}</b></div>`;
    $("pp-result").innerHTML = `<h3>Result</h3><div class="ba-grid">${box("Before", result.before)}${box("After", result.after)}</div>
      <div class="panel"><b>What was done:</b><ul>${result.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    $("pp-result").innerHTML = errorBox(e instanceof UserError ? e.message : "Preprocessing failed. Please try different options.");
  }
});

$("pp-reset").addEventListener("click", () => {
  try {
    needDataset();
    STATE.df = copyDataset(STATE.original);
    STATE.trained = null;
    refreshDataset();
    $("pp-result").innerHTML = '<div class="note-box" style="background:#e9f7ee;border-color:#bfe3cc;color:#1f6b3a">The original dataset has been restored.</div>';
  } catch (e) { $("pp-result").innerHTML = errorBox(e.message); }
});

// ------------------------------------------------------------ analysis charts
const QUICK_CHARTS = [
  { label: "Price distribution", type: "hist", x: "Price_Lakhs" },
  { label: "Average price by city", type: "bar", x: "City", y: "Price_Lakhs", agg: "mean" },
  { label: "Area vs price", type: "scatter", x: "Area_sqft", y: "Price_Lakhs" },
  { label: "Average price by property type", type: "bar", x: "Property_Type", y: "Price_Lakhs", agg: "mean" },
  { label: "Price by age of house", type: "line", x: "Age_of_House", y: "Price_Lakhs", agg: "mean" },
  { label: "Houses by bedrooms", type: "bar", x: "Bedrooms" },
  { label: "Correlation heatmap", type: "heatmap" },
];

function updateChartControls() {
  const type = $("ch-type").value;
  $("ch-x-box").classList.toggle("hidden", type === "heatmap");
  $("ch-y-box").classList.toggle("hidden", type === "hist" || type === "pie" || type === "heatmap");
  $("ch-agg-box").classList.toggle("hidden", type !== "bar" && type !== "line");
  $("ch-x-label").textContent = type === "scatter" ? "X column" : "Column";
  $("ch-y-box").querySelector("label").textContent = type === "scatter" ? "Y column" : "Y column (optional)";
}
$("ch-type").addEventListener("change", updateChartControls);

function renderQuickButtons() {
  const names = STATE.df.columns;
  const usable = QUICK_CHARTS.filter((q) => (q.type === "heatmap" ? INFO.numeric.length >= 2 : names.includes(q.x))
    && (!q.y || names.includes(q.y)));
  $("quick-box").classList.toggle("hidden", usable.length === 0);
  $("quick-buttons").innerHTML = usable.map((q, i) => `<button class="btn small" data-quick="${i}">${q.label}</button> `).join("");
  $("quick-buttons").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const q = usable[b.dataset.quick];
    $("ch-type").value = q.type;
    if (q.x) $("ch-x").value = q.x;
    $("ch-y").value = q.y || "";
    $("ch-agg").value = q.agg || "count";
    updateChartControls();
    drawChart();
  }));
}

// Groups the data for bar and line charts. Numbers with many values (like Age) are put into 6 ranges.
function chartData(df, x, y, agg) {
  const rows = df.rows.filter((r) => r[x] !== null && (agg === "count" || !y || r[y] !== null));
  const isNum = df.types[x] === "num";
  const binned = isNum && new Set(rows.map((r) => r[x])).size > 15;
  let keyOf = (r) => String(r[x]);
  let order = null;
  if (binned) {
    const values = rows.map((r) => r[x]);
    const min = Math.min(...values), max = Math.max(...values), bins = 6, width = (max - min) / bins;
    order = Array.from({ length: bins }, (_, i) => `${(min + i * width).toFixed(0)}-${(min + (i + 1) * width).toFixed(0)}`);
    keyOf = (r) => order[Math.min(bins - 1, Math.max(0, Math.ceil((r[x] - min) / width) - 1))];
  }
  const groups = {};
  rows.forEach((r) => {
    const g = (groups[keyOf(r)] = groups[keyOf(r)] || { n: 0, sum: 0 });
    g.n++;
    if (y && agg !== "count") g.sum += r[y];
  });
  let keys = Object.keys(groups);
  const value = (k) => (agg === "count" || !y ? groups[k].n : agg === "mean" ? groups[k].sum / groups[k].n : groups[k].sum);
  if (binned) keys = order.filter((k) => groups[k]);
  else if (isNum) keys.sort((a, b) => Number(a) - Number(b));
  else keys.sort();
  return { labels: keys, values: keys.map((k) => r2dp(value(k))), binned, isNum };
}

function buildChart(df, o) {
  const numeric = numericCols(df);
  if (o.type === "heatmap") {
    if (numeric.length < 2) throw new UserError("A correlation heatmap needs at least two numerical columns.");
    const correlation = (a, b) => {
      const pairs = df.rows.filter((r) => r[a] !== null && r[b] !== null);
      const ma = mean(pairs.map((r) => r[a])), mb = mean(pairs.map((r) => r[b]));
      let sab = 0, saa = 0, sbb = 0;
      pairs.forEach((r) => { sab += (r[a] - ma) * (r[b] - mb); saa += (r[a] - ma) ** 2; sbb += (r[b] - mb) ** 2; });
      return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
    };
    return heatmapChart(numeric, numeric.map((a) => numeric.map((b) => correlation(a, b))), "Correlation between numerical columns");
  }
  const x = o.x;
  if (!x || !df.columns.includes(x)) throw new UserError("Please select a valid X column.");
  const y = o.y && df.columns.includes(o.y) ? o.y : null;

  if (o.type === "bar" || o.type === "line") {
    if (y && o.agg !== "count" && df.types[y] !== "num") throw new UserError(`'${y}' is not numerical. Choose a numerical column for Y or use 'count'.`);
    let d = chartData(df, x, y, o.agg);
    const ylabel = o.agg === "count" || !y ? "Count" : `${o.agg === "mean" ? "Average" : "Sum"} of ${y}`;
    if (o.type === "line") {
      if (d.labels.length > 30) throw new UserError("Too many different values on the X axis. Choose a column with fewer values.");
      return lineChart({ labels: d.labels, values: d.values, title: `${ylabel} by ${x}`, xLabel: x, yLabel: ylabel });
    }
    if (!d.binned && !d.isNum) {            // text: biggest bars first, top 15
      const order = d.labels.map((l, i) => i).sort((a, b) => d.values[b] - d.values[a]).slice(0, 15);
      d = { labels: order.map((i) => d.labels[i]), values: order.map((i) => d.values[i]) };
    }
    return barChart({ labels: d.labels, values: d.values, title: `${ylabel} by ${x}`, xLabel: x, yLabel: ylabel });
  }
  if (o.type === "pie") {
    const counts = {};
    df.rows.forEach((r) => { if (r[x] !== null) counts[r[x]] = (counts[r[x]] || 0) + 1; });
    let keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    let labels = keys.slice(0, 7), values = labels.map((k) => counts[k]);
    if (keys.length > 8) { labels.push("Other"); values.push(keys.slice(7).reduce((s, k) => s + counts[k], 0)); }
    else { labels = keys; values = keys.map((k) => counts[k]); }
    return pieChart(labels, values, `Distribution of ${x}`);
  }
  if (o.type === "hist") {
    if (df.types[x] !== "num") throw new UserError("A histogram needs a numerical column. Please choose a numerical column for X.");
    return histogramChart(df.rows.map((r) => r[x]).filter((v) => v !== null), `Histogram of ${x}`, x);
  }
  if (o.type === "scatter") {
    if (!y || df.types[x] !== "num" || df.types[y] !== "num") throw new UserError("A scatter plot needs two numerical columns (X and Y).");
    let pairs = df.rows.filter((r) => r[x] !== null && r[y] !== null);
    if (pairs.length > 3000) pairs = shuffle(pairs, makeRng(1)).slice(0, 3000);
    return scatterChart({ xs: pairs.map((r) => r[x]), ys: pairs.map((r) => r[y]), title: `${y} vs ${x}`, xLabel: x, yLabel: y });
  }
  throw new UserError("Please choose a chart type.");
}

function drawChart() {
  const body = { type: $("ch-type").value, x: $("ch-x").value, y: $("ch-y").value, agg: $("ch-agg").value };
  if ((body.type === "bar" || body.type === "line") && body.y && body.agg === "count") body.agg = "mean";
  runAndShow($("ch-draw"), $("ch-result"), () => buildChart(needDataset(), body), () => '<div data-chart="main"></div>',
    (canvas, box) => putChart(box, "main", canvas));
}
$("ch-draw").addEventListener("click", drawChart);

// ------------------------------------------------------------ regression comparison
$("rg-run").addEventListener("click", () =>
  runAndShow($("rg-run"), $("rg-result"),
    () => tracked("Price Prediction", async () => compareRegression(needDataset(), $("rg-target").value, getChecked("rg-features"), Number($("rg-depth").value)),
      (d) => `${d.best} (R² ${d.results.find((r) => r.name === d.best).r2})`),
    (d) => {
      const table = { columns: ["Model", "R² (test)", "R² (train)", "MAE", "RMSE", "Time (sec)"],
        rows: d.results.map((r) => [r.name, r.r2, r.trainR2, r.mae, r.rmse, r.seconds]) };
      const best = d.results.find((r) => r.name === d.best);
      const overfit = d.results.filter((r) => r.trainR2 - r.r2 > 0.1).map((r) => r.name);
      return `<h3>Results</h3>
        <div class="panel"><b>Target (price):</b> ${esc(d.target)}<br><b>Features used:</b> ${d.features.map(esc).join(", ")}<br>
          <small>Trained on ${d.trainRows.toLocaleString()} houses, tested on ${d.testRows.toLocaleString()} houses.</small></div>
        ${notesHTML(d.notes)}
        ${bestBanner(`Best model: <b>${esc(d.best)}</b> - R² = ${best.r2}, so it explains about ${(best.r2 * 100).toFixed(1)}% of the price changes. Average mistake (MAE) = ${best.mae}.`)}
        <div class="table-wrap">${tableHTML(table, d.best)}</div>
        ${overfit.length ? `<div class="note-box">Possible overfitting (Train R² is much higher than Test R²): ${overfit.map(esc).join(", ")}.</div>` : ""}
        <h3>Model Comparison Charts</h3>
        <div class="result-grid">${chartSlot("r2")}${chartSlot("rmse")}</div>
        <div class="result-grid">
          <div><h3>Actual vs Predicted (${esc(d.best)})</h3>${chartSlot("actual")}
            <small>Dots near the dashed line = accurate predictions.</small></div>
          <div><h3>What affects the price most?</h3><small>From the Random Forest (higher = more important).</small>${tableHTML({ columns: ["Feature", "Importance"], rows: d.importance })}</div>
        </div>`;
    },
    (d, box) => {
      const names = d.results.map((r) => r.name);
      putChart(box, "r2", barChart({ labels: names, values: d.results.map((r) => r.r2), title: "R² score (higher is better)" }, 520, 400));
      putChart(box, "rmse", barChart({ labels: names, values: d.results.map((r) => r.rmse), title: "RMSE error (lower is better)", color: "#f0a35e" }, 520, 400));
      let idx = [...Array(d.actual.length).keys()];
      if (idx.length > 1500) idx = shuffle(idx, makeRng(3)).slice(0, 1500);
      putChart(box, "actual", scatterChart({ xs: idx.map((i) => d.actual[i]), ys: idx.map((i) => d.predicted[i]), diagonal: true,
        title: `Actual vs predicted - ${d.best}`, xLabel: `Actual ${d.target}`, yLabel: `Predicted ${d.target}` }, 520, 480));
    }));

// ------------------------------------------------------------ classification comparison
function confusionHTML(labels, matrix) {
  const head = labels.map((l) => `<th>Pred: ${esc(l)}</th>`).join("");
  const rows = matrix.map((row, i) => `<tr><th>Actual: ${esc(labels[i])}</th>` +
    row.map((v, j) => `<td class="${i === j ? "diag" : ""}">${v}</td>`).join("") + "</tr>").join("");
  return `<table class="cm"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

$("cl-run").addEventListener("click", () =>
  runAndShow($("cl-run"), $("cl-result"),
    () => tracked("Price Category", async () => compareClassification(needDataset(), $("cl-target").value, getChecked("cl-features"),
      Number($("cl-classes").value), Number($("cl-depth").value)),
      (d) => `${d.best} (accuracy ${d.results.find((r) => r.name === d.best).accuracy}%)`),
    (d) => {
      const table = { columns: ["Model", "Accuracy %", "Precision %", "Recall %", "F1-score %", "Time (sec)"],
        rows: d.results.map((r) => [r.name, r.accuracy, r.precision, r.recall, r.f1, r.seconds]) };
      const best = d.results.find((r) => r.name === d.best);
      const j48 = d.results.find((r) => r.name.startsWith("J48"));
      const matrices = d.results.map((r) =>
        `<div class="result-block"><h4>${esc(r.name)} - ${r.accuracy}%</h4>${confusionHTML(d.labels, d.matrices[r.name])}</div>`).join("");
      return `<h3>Results</h3>
        <div class="panel"><b>Target:</b> ${esc(d.target)}<br>
          ${d.ranges ? `<b>Price categories (equal-sized groups):</b> ${d.ranges.map(esc).join(" &nbsp;|&nbsp; ")}<br>` : ""}
          <b>Features used:</b> ${d.features.map(esc).join(", ")}<br>
          <small>Trained on ${d.trainRows.toLocaleString()} houses, tested on ${d.testRows.toLocaleString()} houses.</small></div>
        ${notesHTML(d.notes)}
        ${bestBanner(`Best model: <b>${esc(d.best)}</b> - ${best.accuracy}% of the test houses were placed in the correct category. J48 scored ${j48.accuracy}%.`)}
        <div class="table-wrap">${tableHTML(table, d.best)}</div>
        <h3>Model Comparison Chart</h3>${chartSlot("compare")}
        <h3>Confusion Matrix of Every Model</h3><small>Green = correct predictions. Other cells = mistakes.</small>
        <div class="result-grid">${matrices}</div>
        <h3>J48 Tree (${d.j48Leaves} leaves)</h3>
        
        <pre class="tree-text">${esc(d.j48Text)}</pre>`;
    },
    (d, box) => putChart(box, "compare", groupedBarChart(d.results.map((r) => r.name),
      [{ label: "Accuracy", values: d.results.map((r) => r.accuracy) }, { label: "Precision", values: d.results.map((r) => r.precision) },
       { label: "Recall", values: d.results.map((r) => r.recall) }, { label: "F1-score", values: d.results.map((r) => r.f1) }],
      "Classification models compared (%)", "Percent"))));

// Saves a line in the comparison history (shown on the Dashboard and in the Admin Panel)
async function tracked(type, task, summarize, extra) {
  const data = await task();
  try { History.add({ user: Auth.current().username, type, dataset: STATE.df.name, best: summarize(data), ...(extra ? extra(data) : {}) }); } catch (e) { /* history is optional */ }
  return data;
}

// ------------------------------------------------------------ compare ALL algorithms
const ALL_ALGOS = ["Gradient Boosting", "Random Forest", "Linear Regression", "Decision Tree", "KNN (K=5)", "J48 (C4.5)", "Naive Bayes"];
const SHORT = { "Linear Regression": "Linear Reg.", "Gradient Boosting": "Grad. Boost", "Random Forest": "Random Forest", "Decision Tree": "Decision Tree",
                "KNN (K=5)": "KNN", "J48 (C4.5)": "J48", "Naive Bayes": "Naive Bayes" };
const MEDAL = ["🥇", "🥈", "🥉"];

// the "who beats whom" table. Cell = measures the row algorithm wins - measures it loses against the column algorithm.
function headToHeadHTML(items, table, beats, total) {
  const head = items.map((m) => `<th>${esc(SHORT[m.name] || m.name)}</th>`).join("");
  const rows = items.map((m, i) => `<tr><th>${esc(m.name)}</th>` + table[i].map((cell) => {
    if (!cell) return '<td class="h2h-self">-</td>';
    const cls = cell.wins > cell.losses ? "h2h-win" : cell.wins < cell.losses ? "h2h-lose" : "h2h-draw";
    return `<td class="${cls}">${cell.wins} - ${cell.losses}</td>`;
  }).join("") + `<td><b>${beats[i]}</b> of ${total}</td></tr>`).join("");
  return `<div class="table-wrap"><table class="h2h"><thead><tr><th>Row vs Column</th>${head}<th>Beats</th></tr></thead><tbody>${rows}</tbody></table></div>
    <small>"4 - 1" = the row algorithm wins 4 measures and loses 1 against the column algorithm. Green = row wins, red = row loses.</small>`;
}

function kindLabel(m) {
  if (!m.price) return "Classifier";
  return m.cat.usedAs.startsWith("Predicts the price") ? "Regressor" : "Classifier + Regressor";
}

function winnerHeroHTML(d) {
  const top = d.byCategory[0], second = d.byCategory[1];
  const fastest = [...d.byCategory].sort((a, b) => a.seconds - b.seconds)[0];
  const priceTop = d.byPrice[0];
  return `<div class="winner-hero">
    <div>
      <div class="wh-eyebrow">🏆 Best algorithm for this dataset</div>
      <div class="wh-name">${esc(top.name)}</div>
      <div class="wh-sub">Dataset <b>${esc(d.datasetName)}</b> · ${d.rowsUsed.toLocaleString()} houses · ${d.features.length} features</div>
      <div class="chips">
        <span class="chip">F1-score ${top.cat.f1}%</span>
        <span class="chip">Beats ${top.cat.beats} of ${d.byCategory.length - 1} algorithms</span>
        <span class="chip">Runner-up: ${esc(second.name)} (${second.cat.accuracy}%)</span>
        <span class="chip">Best exact price: ${esc(priceTop.name)} (R² ${priceTop.price.r2})</span>
        <span class="chip">Fastest: ${esc(fastest.name)}</span>
      </div>
    </div>
    <div class="ring" style="--p:${top.cat.accuracy}"><div class="ring-in"><b>${top.cat.accuracy}%</b><span>accuracy</span></div></div>
  </div>`;
}

function whyHTML(d) {
  const cat = d.byCategory, top = cat[0], second = cat[1], worst = cat[cat.length - 1];
  const gap = r2dp(top.cat.score - second.cat.score);
  const pts = [];
  pts.push(gap < 1
    ? `<b>${esc(top.name)}</b> and <b>${esc(second.name)}</b> are almost tied (only ${gap} points apart) - either is a good choice.`
    : `<b>${esc(top.name)}</b> is ${gap} points ahead of the runner-up <b>${esc(second.name)}</b> and the weakest here is <b>${esc(worst.name)}</b> (${worst.cat.accuracy}%).`);
  const p = d.byPrice[0].price;
  pts.push(`For the <b>exact price</b>, <b>${esc(d.priceWinner)}</b> is best: R² ${p.r2}, average error ${p.mae}, and ${p.within10}% of test houses are predicted within ±10% of the real price.`);
  const overfit = [...new Set([...cat.filter((m) => m.cat.trainAccuracy - m.cat.accuracy > 10).map((m) => m.name),
    ...d.byPrice.filter((m) => m.price.trainR2 - m.price.r2 > 0.1).map((m) => m.name)])];
  const valuePick = [...cat].filter((m) => top.cat.score - m.cat.score <= 3 && m.name !== top.name).sort((a, b) => a.seconds - b.seconds)[0];
  if (overfit.length) pts.push(`Possible overfitting (memorises training houses): ${overfit.map(esc).join(", ")}.`);
  else if (valuePick && valuePick.seconds < top.seconds / 2) pts.push(`Need speed? <b>${esc(valuePick.name)}</b> is within 3 points and trains in ${r2dp(valuePick.seconds)} s.`);
  return `<ul class="why">${pts.map((t) => `<li>${t}</li>`).join("")}</ul>`;
}

function accuracyListHTML(d) {
  const rows = d.byCategory.map((m) => {
    const best = m.name === d.winner;
    return `<div class="acc-row ${best ? "best" : ""}">
      <div class="acc-rank">${MEDAL[m.cat.rank - 1] || m.cat.rank}</div>
      <div class="acc-name">${esc(m.name)}${best ? '<span class="pill good">BEST</span>' : ""}<small>${kindLabel(m)}</small></div>
      <div class="acc-bar"><div class="acc-fill" style="width:${m.cat.accuracy}%"></div></div>
      <div class="acc-val">${m.cat.accuracy}%</div>
      <div class="acc-extra"><b>${m.cat.f1}%</b><small>F1-score</small></div>
      <div class="acc-extra"><b>${m.price ? m.price.within10 + "%" : "-"}</b><small>price ±10%</small></div>
      <div class="acc-extra"><b>${r2dp(m.seconds)}s</b><small>train time</small></div></div>`;
  }).join("");
  return `<div class="acc-list"><div class="acc-head"><span></span><span>Algorithm</span><span>Accuracy (price category)</span><span></span><span>F1</span><span>Exact price</span><span>Time</span></div>${rows}</div>
    <small>Accuracy = % of unseen test houses placed in the correct price category. "Price ±10%" = % of test houses whose predicted price is within 10% of the real price (only for algorithms that predict a price).</small>`;
}

function datasetHTML(d) {
  const maxImp = Math.max(...d.importance.map((i) => i[1]), 0.0001);
  const imp = d.importance.map(([n, v]) => `<div class="fi-row"><span>${esc(n)}</span><div class="fi-bar"><i style="width:${(v / maxImp * 100).toFixed(0)}%"></i></div><b>${(v * 100).toFixed(0)}%</b></div>`).join("");
  return `<div class="ds-grid">
    <div class="panel"><h4>📁 Dataset used for this comparison</h4>
      <table><tbody>
        <tr><td>Dataset</td><td><b>${esc(d.datasetName)}</b></td></tr>
        <tr><td>Houses used</td><td><b>${d.rowsUsed.toLocaleString()}</b> (${d.trainRows.toLocaleString()} training, ${d.testRows.toLocaleString()} testing)</td></tr>
        <tr><td>${esc(d.target)}</td><td>${d.priceMin} to ${d.priceMax} (average ${d.priceMean})</td></tr>
        <tr><td>Features</td><td>${d.features.length}</td></tr></tbody></table>
      <div style="margin-top:10px">${d.ranges.map((r) => `<span class="range-chip">${esc(r)}</span>`).join("")}</div></div>
    <div class="panel"><h4>🔎 What affects the price most in this dataset</h4>${imp}<small>From the Random Forest. A higher % means the column matters more.</small></div>
  </div>`;
}

// results of every earlier "Compare All" run, one row per dataset, so algorithms can be compared dataset by dataset
function renderAcross() {
  const box = $("al-across");
  const seen = new Set(), runs = [];
  History.all().filter((h) => h.type === "All Algorithms" && h.scores).forEach((h) => { if (!seen.has(h.label)) { seen.add(h.label); runs.push(h); } });
  if (!runs.length) { box.innerHTML = ""; return; }
  const rows = runs.slice(0, 8).map((h) => {
    const best = Math.max(...ALL_ALGOS.map((a) => h.scores[a] ?? -1));
    return `<tr><td><b>${esc(h.label)}</b></td>` + ALL_ALGOS.map((a) => `<td class="${h.scores[a] === best ? "cell-best" : ""}">${h.scores[a] ?? "-"}%</td>`).join("") + `<td><b>${esc(h.winner)}</b></td></tr>`;
  }).join("");
  box.innerHTML = `<h3>Accuracy on each dataset</h3>
    <div class="table-wrap"><table><thead><tr><th>Dataset</th>${ALL_ALGOS.map((a) => `<th>${esc(SHORT[a])}</th>`).join("")}<th>Best</th></tr></thead><tbody>${rows}</tbody></table></div>
    <small>Every comparison is saved here. Preprocess the data or load another dataset and compare again to see how each algorithm behaves on different data.</small>`;
}

$("al-run").addEventListener("click", () =>
  runAndShow($("al-run"), $("al-result"),
    () => tracked("All Algorithms", async () => compareAllAlgorithms(needDataset(), $("al-target").value, getChecked("al-features"),
      Number($("al-classes").value), Number($("al-depth").value)),
      (d) => `${d.winner} (accuracy ${d.byCategory[0].cat.accuracy}%)`,
      (d) => ({ label: `${d.datasetName} (${d.rowsUsed.toLocaleString()} houses)`, houses: d.rowsUsed, winner: d.winner,
                scores: Object.fromEntries(d.byCategory.map((m) => [m.name, m.cat.accuracy])) })),
    (d) => {
      const t1 = {
        columns: ["Rank", "Algorithm", "Accuracy %", "Precision %", "Recall %", "F1-score %", "Overall score %", "Train accuracy %", "Time (sec)"],
        rows: d.byCategory.map((m) => [m.cat.rank, m.name, m.cat.accuracy, m.cat.precision, m.cat.recall, m.cat.f1, m.cat.score, m.cat.trainAccuracy, m.cat.seconds]),
      };
      const t2 = {
        columns: ["Rank", "Algorithm", "R² (test)", "Price within ±10 %", "MAE", "RMSE", "R² (train)", "Time (sec)"],
        rows: d.byPrice.map((m) => [m.price.rank, m.name, m.price.r2, m.price.within10, m.price.mae, m.price.rmse, m.price.trainR2, m.price.seconds]),
      };
      const matrices = d.byCategory.map((m) =>
        `<div class="result-block"><h4>${esc(m.name)} - ${m.cat.accuracy}%</h4>${confusionHTML(d.labels, m.cat.matrix)}</div>`).join("");
      return `${notesHTML(d.notes)}
        ${winnerHeroHTML(d)}
        ${whyHTML(d)}

        <h3>Accuracy of every algorithm</h3>
        ${accuracyListHTML(d)}

        <h3>Based on your dataset</h3>
        ${datasetHTML(d)}

        <h3>Detailed scores - price category</h3>
        <div class="table-wrap">${tableHTML(t1, d.winner)}</div>
        <div style="margin-top:14px">${chartSlot("t1-grouped")}</div>

        <h3>Detailed scores - exact price</h3>
        <div class="table-wrap">${tableHTML(t2, d.priceWinner)}</div>
        <small>J48 and Naive Bayes only predict categories, so they are not part of the exact-price table.</small>
        <div class="result-grid" style="margin-top:14px">${chartSlot("t2-r2")}${chartSlot("t2-rmse")}</div>

        <details class="more"><summary>⚔️ Head-to-head: every algorithm against every other (price category)</summary>
          <div style="margin-top:12px">${headToHeadHTML(d.catItems, d.catTable, d.byCategory.map((m) => m.cat.beats), d.byCategory.length - 1)}</div></details>
        <details class="more"><summary>⚔️ Head-to-head: exact price predictors</summary>
          <div style="margin-top:12px">${headToHeadHTML(d.priceItems, d.priceTable, d.byPrice.map((m) => m.price.beats), d.byPrice.length - 1)}</div></details>
        <details class="more"><summary>🧮 Confusion matrix of every algorithm</summary>
          <div class="result-grid" style="margin-top:12px">${matrices}</div></details>
        <details class="more"><summary>🌳 J48 tree (${d.j48Leaves} leaves)</summary><pre class="tree-text">${esc(d.j48Text)}</pre></details>`;
    },
    (d, box) => {
      putChart(box, "t1-grouped", groupedBarChart(d.byCategory.map((m) => SHORT[m.name] || m.name), [
        { label: "Accuracy", values: d.byCategory.map((m) => m.cat.accuracy) }, { label: "Precision", values: d.byCategory.map((m) => m.cat.precision) },
        { label: "Recall", values: d.byCategory.map((m) => m.cat.recall) }, { label: "F1-score", values: d.byCategory.map((m) => m.cat.f1) }],
        "Price category - all algorithms (%)", "Percent"));
      const priceNames = d.byPrice.map((m) => m.name);
      putChart(box, "t2-r2", barChart({ labels: priceNames, values: d.byPrice.map((m) => m.price.r2), title: "R² score (higher is better)" }, 520, 400));
      putChart(box, "t2-rmse", barChart({ labels: priceNames, values: d.byPrice.map((m) => m.price.rmse), title: "RMSE error (lower is better)", color: "#f59e0b" }, 520, 400));
      renderAcross();
    }));

// ------------------------------------------------------------ predict a house
function loadPredictForm() {
  const box = $("predict-form-box");
  const fields = predictionFields();
  if (!fields) {
    box.innerHTML = `<div class="note-box">The models are not trained yet. Go to <b>Compare: Price Prediction</b> (or <b>Compare All Algorithms</b>) and run
      the comparison first.</div>`;
    return;
  }
  const inputs = fields.map((f) => f.kind === "number"
    ? `<div class="field"><label>${esc(f.name)}</label><input type="number" step="any" data-feature="${esc(f.name)}" value="${f.value}"></div>`
    : `<div class="field"><label>${esc(f.name)}</label><select data-feature="${esc(f.name)}">${optionsHTML(f.options, f.value)}</select></div>`).join("");
  box.innerHTML = `<div class="panel"><div class="row">${inputs}</div>
    <button class="btn primary" id="predict-run">Predict ${esc(STATE.trained.target)}</button></div>`;
  $("predict-run").addEventListener("click", () => {
    const values = {};
    box.querySelectorAll("[data-feature]").forEach((el) => (values[el.dataset.feature] = el.value));
    runAndShow($("predict-run"), $("predict-result"), () => predictHouse(values), (r) => {
      const prices = r.predictions.map((p) => p.price);
      const table = { columns: ["Model", "Predicted " + r.target], rows: r.predictions.map((p) => [p.name, p.price]) };
      return `<h3>Predictions</h3>
        ${bestBanner(`Most accurate model on test data: <b>${esc(r.best)}</b> predicts <b>${r.predictions.find((p) => p.name === r.best).price}</b>`)}
        <div class="table-wrap">${tableHTML(table, r.best)}</div>
        <small>The models predict between ${Math.min(...prices)} and ${Math.max(...prices)}. The closer the numbers, the more the models agree.</small>`;
    });
  });
}
