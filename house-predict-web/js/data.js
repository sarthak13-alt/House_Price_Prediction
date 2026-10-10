// data.js - reading the CSV, detecting column types, statistics and preprocessing.
// A dataset is a simple object:
//   { name, columns: [...], types: {column: "num" | "cat"}, rows: [ {column: value, ...}, ... ] }
// Missing values are stored as null.

class UserError extends Error {}   // an error whose message is safe to show to the user

const MISSING_WORDS = ["", "na", "n/a", "nan", "null"];

function isMissing(v) {
  return v === null || v === undefined || (typeof v === "number" && isNaN(v)) ||
    (typeof v === "string" && MISSING_WORDS.includes(v.trim().toLowerCase()));
}

// ---------------------------------------------------------------- small statistics helpers
function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function std(a) {            // sample standard deviation (n - 1)
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
function quantileSorted(sorted, q) {   // linear interpolation, same as pandas
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function median(a) { return quantileSorted([...a].sort((x, y) => x - y), 0.5); }
function round2(v) { return Math.round(v * 100) / 100; }

// ---------------------------------------------------------------- CSV reading
// Splits CSV text into rows of text cells. Handles "quoted, cells" and "" inside quotes.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // remove BOM
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (inQuotes) throw new UserError("This does not look like a valid CSV file (a quote was never closed).");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Builds a dataset from CSV text. Numerical columns are detected automatically.
function createDataset(text, name) {
  if (!text || !text.trim()) throw new UserError("The CSV file is empty.");
  const table = parseCSV(text);
  if (table.length === 0) throw new UserError("The CSV file is empty.");
  let header = table[0].map((h) => h.trim());
  if (header.length < 2) throw new UserError("Only one column was found. Please check that the file is comma-separated.");
  if (table.length < 2) throw new UserError("The CSV file has no data rows.");

  // make column names unique and non-empty
  const seen = {};
  header = header.map((h, i) => {
    h = h || "Column_" + (i + 1);
    seen[h] = (seen[h] || 0) + 1;
    return seen[h] > 1 ? `${h}_${seen[h]}` : h;
  });

  const body = table.slice(1);
  const types = {};
  header.forEach((col, j) => {
    const values = body.map((r) => (r[j] === undefined ? "" : r[j])).filter((v) => !isMissing(v));
    const numbers = values.filter((v) => !isNaN(Number(v)));
    types[col] = values.length > 0 && numbers.length >= 0.9 * values.length ? "num" : "cat";
  });

  const rows = body.map((r) => {
    const obj = {};
    header.forEach((col, j) => {
      const v = r[j] === undefined ? "" : r[j];
      if (isMissing(v)) obj[col] = null;
      else if (types[col] === "num") obj[col] = isNaN(Number(v)) ? null : Number(v);
      else obj[col] = v.trim();
    });
    return obj;
  });
  return { name, columns: header, types, rows };
}

function numericCols(df) { return df.columns.filter((c) => df.types[c] === "num"); }
function categoricalCols(df) { return df.columns.filter((c) => df.types[c] === "cat"); }
function copyDataset(df) {
  return { name: df.name, columns: [...df.columns], types: { ...df.types }, rows: df.rows.map((r) => ({ ...r })) };
}

// ---------------------------------------------------------------- dataset information
function rowKey(df, row) { return JSON.stringify(df.columns.map((c) => row[c])); }

function countDuplicates(df) {
  const seen = new Set();
  let duplicates = 0;
  df.rows.forEach((r) => { const k = rowKey(df, r); if (seen.has(k)) duplicates++; else seen.add(k); });
  return duplicates;
}

function basicCounts(df) {
  let missing = 0;
  df.rows.forEach((r) => df.columns.forEach((c) => { if (r[c] === null) missing++; }));
  return { rows: df.rows.length, columns: df.columns.length, missing, duplicates: countDuplicates(df) };
}

function datasetInfo(df) {
  const info = { name: df.name, ...basicCounts(df), numeric: numericCols(df), categorical: categoricalCols(df), columnInfo: [] };
  const numericRows = [], categoricalRows = [];
  df.columns.forEach((c) => {
    const values = df.rows.map((r) => r[c]).filter((v) => v !== null);
    const unique = new Set(values).size;
    info.columnInfo.push({ name: c, dtype: df.types[c] === "num" ? "number" : "text",
      type: df.types[c] === "num" ? "Numerical" : "Categorical",
      missing: df.rows.length - values.length, unique });
    if (df.types[c] === "num" && values.length) {
      const sorted = [...values].sort((a, b) => a - b);
      numericRows.push([c, values.length, round2(mean(values)), round2(std(values)), sorted[0],
        round2(quantileSorted(sorted, 0.25)), round2(quantileSorted(sorted, 0.5)),
        round2(quantileSorted(sorted, 0.75)), sorted[sorted.length - 1]]);
    } else if (df.types[c] === "cat") {
      const counts = {};
      values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      categoricalRows.push([c, values.length, unique, top === undefined ? null : top, top === undefined ? null : counts[top]]);
    }
  });
  info.numericStats = numericRows.length ? { columns: ["Column", "Count", "Mean", "Std", "Min", "25%", "50%", "75%", "Max"], rows: numericRows } : null;
  info.categoricalStats = categoricalRows.length ? { columns: ["Column", "Count", "Unique", "Most common", "Frequency"], rows: categoricalRows } : null;
  return info;
}

// ---------------------------------------------------------------- preprocessing
// options: { dropColumns: [], removeDuplicates: bool, missing: "fill"|"drop"|"none", outlierColumn: "" }
// Returns { df, before, after, steps }. The original dataset is not changed.
function preprocessDataset(original, options) {
  const df = copyDataset(original);
  const before = basicCounts(df);
  const steps = [];

  const drop = (options.dropColumns || []).filter((c) => df.columns.includes(c));
  if (drop.length) {
    if (drop.length >= df.columns.length - 1) throw new UserError("Please keep at least two columns.");
    df.columns = df.columns.filter((c) => !drop.includes(c));
    df.rows.forEach((r) => drop.forEach((c) => delete r[c]));
    steps.push(`Removed ${drop.length} column(s): ${drop.join(", ")}.`);
  }

  if (options.removeDuplicates) {
    const seen = new Set();
    const kept = df.rows.filter((r) => { const k = rowKey(df, r); if (seen.has(k)) return false; seen.add(k); return true; });
    steps.push(`Removed ${df.rows.length - kept.length} duplicate row(s).`);
    df.rows = kept;
  }

  if (options.missing === "drop") {
    const kept = df.rows.filter((r) => df.columns.every((c) => r[c] !== null));
    steps.push(`Dropped ${df.rows.length - kept.length} row(s) that had missing values.`);
    df.rows = kept;
  } else if (options.missing === "fill") {
    df.columns.forEach((c) => {
      const values = df.rows.map((r) => r[c]).filter((v) => v !== null);
      if (values.length === 0 || values.length === df.rows.length) return;
      let fillValue;
      if (df.types[c] === "num") fillValue = median(values);
      else {                                   // most common text value
        const counts = {};
        values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
        fillValue = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      }
      df.rows.forEach((r) => { if (r[c] === null) r[c] = fillValue; });
    });
    steps.push("Filled missing numbers with the median and missing text with the most common value.");
  }

  if (options.outlierColumn) {
    const c = options.outlierColumn;
    if (df.types[c] !== "num") throw new UserError("Outliers can only be removed from a numerical column.");
    const sorted = df.rows.map((r) => r[c]).filter((v) => v !== null).sort((a, b) => a - b);
    const q1 = quantileSorted(sorted, 0.25), q3 = quantileSorted(sorted, 0.75);
    const low = q1 - 1.5 * (q3 - q1), high = q3 + 1.5 * (q3 - q1);
    const kept = df.rows.filter((r) => r[c] === null || (r[c] >= low && r[c] <= high));
    steps.push(`Removed ${df.rows.length - kept.length} outlier row(s) in '${c}' (values outside ${low.toFixed(1)} to ${high.toFixed(1)}).`);
    df.rows = kept;
  }

  if (df.rows.length < 2) throw new UserError("Too few rows would be left with these options. Nothing was changed.");
  if (!steps.length) steps.push("No operation was selected, so the dataset was not changed.");
  return { df, before, after: basicCounts(df), steps };
}

// ---------------------------------------------------------------- preparing data for the models
// Keeps rows that have no missing value in the used columns, skips text columns with too many values.
function cleanFeatures(rows, df, target, requested) {
  const features = requested.filter((f) => df.columns.includes(f) && f !== target);
  if (!features.length) throw new UserError("Please select at least one feature column.");
  const used = [...features, target];
  const complete = rows.filter((r) => used.every((c) => r[c] !== null && r[c] !== undefined));
  const notes = [];
  if (complete.length < rows.length) {
    notes.push(`${rows.length - complete.length} rows with missing values were ignored. You can fill them in the Preprocessing page.`);
  }
  const tooMany = features.filter((f) => df.types[f] === "cat" && new Set(complete.map((r) => r[f])).size > 30);
  let kept = features;
  if (tooMany.length) {
    kept = features.filter((f) => !tooMany.includes(f));
    notes.push(`Skipped columns with too many different values: ${tooMany.join(", ")}.`);
    if (!kept.length) throw new UserError("None of the selected features can be used. Please select other columns.");
  }
  return { rows: complete, features: kept, notes };
}

// Turns text columns into 0/1 columns (one-hot encoding). Numbers stay as they are.
function buildEncoder(rows, features, df) {
  const parts = features.map((f) => {
    if (df.types[f] === "num") return { feature: f, numeric: true, names: [f] };
    const counts = {};
    rows.forEach((r) => (counts[r[f]] = (counts[r[f]] || 0) + 1));
    const categories = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    return { feature: f, numeric: false, categories, names: categories.map((c) => `${f}_${c}`) };
  });
  const names = parts.flatMap((p) => p.names);
  const encode = (row) => {
    const out = [];
    parts.forEach((p) => {
      if (p.numeric) out.push(Number(row[p.feature]));
      else p.categories.forEach((c) => out.push(String(row[p.feature]) === c ? 1 : 0));
    });
    return out;
  };
  return { names, encode };
}
