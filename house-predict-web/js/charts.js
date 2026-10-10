// charts.js - simple charts drawn on a <canvas> (no chart library needed).
// Every function returns a canvas element that can be added to the page.

const BLUE = "#6366f1";
const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#06b6d4", "#f97316", "#94a3b8"];
const FONT = "13px 'Segoe UI', Arial, sans-serif";

function newCanvas(width = 800, height = 440) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.font = FONT;
  ctx.fillStyle = "#222";
  return { canvas, ctx, width, height };
}

function formatNumber(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e4) return (v / 1e3).toFixed(0) + "k";
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return (Math.round(v * 100) / 100).toString();
  return (Math.round(v * 1000) / 1000).toString();
}

// Nice round axis values, for example 0, 200, 400, 600
function niceAxis(min, max, ticks = 5) {
  if (min === max) { max = min + 1; }
  const rough = (max - min) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const values = [];
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Math.round(v / step) * step);
  return { min: lo, max: hi, values };
}

// Draws the title, axis lines, grid and numbers. Returns the plotting area.
function drawFrame(c, title, yAxis, xLabel, yLabel, margin) {
  const { ctx, width, height } = c;
  const area = { left: margin.left, top: margin.top, right: width - margin.right, bottom: height - margin.bottom };
  ctx.textAlign = "center";
  ctx.font = "bold 15px 'Segoe UI', Arial";
  ctx.fillText(title, width / 2, 24);
  ctx.font = FONT;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  yAxis.values.forEach((v) => {
    const y = area.bottom - ((v - yAxis.min) / (yAxis.max - yAxis.min)) * (area.bottom - area.top);
    ctx.strokeStyle = "#e3e8ee";
    ctx.beginPath(); ctx.moveTo(area.left, y); ctx.lineTo(area.right, y); ctx.stroke();
    ctx.fillStyle = "#444";
    ctx.fillText(formatNumber(v), area.left - 8, y);
  });
  ctx.strokeStyle = "#888";
  ctx.beginPath(); ctx.moveTo(area.left, area.top); ctx.lineTo(area.left, area.bottom); ctx.lineTo(area.right, area.bottom); ctx.stroke();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = "#222";
  if (xLabel) ctx.fillText(xLabel, (area.left + area.right) / 2, height - 8);
  if (yLabel) {
    ctx.save();
    ctx.translate(16, (area.top + area.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }
  area.yOf = (v) => area.bottom - ((v - yAxis.min) / (yAxis.max - yAxis.min)) * (area.bottom - area.top);
  return area;
}

function drawLabel(ctx, text, x, y, rotate) {
  ctx.fillStyle = "#444";
  if (rotate) {
    ctx.save();
    ctx.translate(x, y + 6);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = "right";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else {
    ctx.textAlign = "center";
    ctx.fillText(text, x, y + 16);
  }
}

// ---------------------------------------------------------------- bar chart
// opts: { labels, values, title, xLabel, yLabel, color, gap, labelEvery }
function barChart(opts, width = 800, height = 440) {
  const c = newCanvas(width, height);
  const { labels, values } = opts;
  const yAxis = niceAxis(Math.min(0, ...values), Math.max(0, ...values));
  const area = drawFrame(c, opts.title, yAxis, opts.xLabel, opts.yLabel, { left: 70, right: 20, top: 40, bottom: 95 });
  const slot = (area.right - area.left) / labels.length;
  const gap = opts.gap === undefined ? 0.25 : opts.gap;
  const rotate = labels.length > 6 || labels.some((l) => String(l).length > 9);
  labels.forEach((label, i) => {
    const x = area.left + i * slot + (slot * gap) / 2;
    const y = area.yOf(values[i]), zero = area.yOf(0);
    c.ctx.fillStyle = opts.color || BLUE;
    c.ctx.fillRect(x, Math.min(y, zero), slot * (1 - gap), Math.abs(zero - y));
    if (!opts.labelEvery || i % opts.labelEvery === 0) drawLabel(c.ctx, String(label), area.left + i * slot + slot / 2, area.bottom + 2, rotate);
  });
  return c.canvas;
}

// ---------------------------------------------------------------- histogram (20 bars)
function histogramChart(values, title, xLabel) {
  const min = Math.min(...values), max = Math.max(...values), bins = 20;
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  values.forEach((v) => counts[Math.min(bins - 1, Math.floor((v - min) / width))]++);
  const labels = counts.map((_, i) => formatNumber(min + i * width));
  return barChart({ labels, values: counts, title, xLabel, yLabel: "Frequency", gap: 0.04, labelEvery: 3 });
}

// ---------------------------------------------------------------- line chart
function lineChart(opts, width = 800, height = 440) {
  const c = newCanvas(width, height);
  const { labels, values } = opts;
  const yAxis = niceAxis(Math.min(0, ...values), Math.max(...values));
  const area = drawFrame(c, opts.title, yAxis, opts.xLabel, opts.yLabel, { left: 70, right: 20, top: 40, bottom: 95 });
  const slot = (area.right - area.left) / labels.length;
  const rotate = labels.length > 6 || labels.some((l) => String(l).length > 9);
  const ctx = c.ctx;
  ctx.strokeStyle = BLUE; ctx.lineWidth = 2; ctx.beginPath();
  values.forEach((v, i) => { const x = area.left + i * slot + slot / 2; i ? ctx.lineTo(x, area.yOf(v)) : ctx.moveTo(x, area.yOf(v)); });
  ctx.stroke(); ctx.lineWidth = 1;
  values.forEach((v, i) => {
    const x = area.left + i * slot + slot / 2;
    ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(x, area.yOf(v), 3.5, 0, 7); ctx.fill();
    if (labels.length <= 30) drawLabel(ctx, String(labels[i]), x, area.bottom + 2, rotate);
  });
  return c.canvas;
}

// ---------------------------------------------------------------- scatter plot
// opts: { xs, ys, title, xLabel, yLabel, diagonal, extraLabel }
function scatterChart(opts, width = 800, height = 440) {
  const c = newCanvas(width, height);
  const yAxis = niceAxis(Math.min(...opts.ys), Math.max(...opts.ys));
  const xAxis = niceAxis(Math.min(...opts.xs), Math.max(...opts.xs));
  const area = drawFrame(c, opts.title, yAxis, opts.xLabel, opts.yLabel, { left: 70, right: 20, top: 40, bottom: 60 });
  const ctx = c.ctx;
  const xOf = (v) => area.left + ((v - xAxis.min) / (xAxis.max - xAxis.min)) * (area.right - area.left);
  ctx.textAlign = "center";
  xAxis.values.forEach((v) => { ctx.fillStyle = "#444"; ctx.fillText(formatNumber(v), xOf(v), area.bottom + 18); });
  if (opts.diagonal) {                              // the "perfect prediction" line
    const lo = Math.max(xAxis.min, yAxis.min), hi = Math.min(xAxis.max, yAxis.max);
    ctx.strokeStyle = "#d9534f"; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(xOf(lo), area.yOf(lo)); ctx.lineTo(xOf(hi), area.yOf(hi)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#d9534f"; ctx.textAlign = "left"; ctx.fillText("- - Perfect prediction", area.left + 10, area.top + 16);
  }
  ctx.fillStyle = "rgba(79,143,214,0.5)";
  opts.xs.forEach((x, i) => { ctx.beginPath(); ctx.arc(xOf(x), area.yOf(opts.ys[i]), 3, 0, 7); ctx.fill(); });
  return c.canvas;
}

// ---------------------------------------------------------------- pie chart
function pieChart(labels, values, title) {
  const c = newCanvas(800, 420);
  const { ctx } = c;
  const total = values.reduce((s, v) => s + v, 0);
  ctx.textAlign = "center"; ctx.font = "bold 15px 'Segoe UI', Arial"; ctx.fillText(title, 400, 24); ctx.font = FONT;
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const slice = (v / total) * Math.PI * 2;
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.beginPath(); ctx.moveTo(250, 225); ctx.arc(250, 225, 150, angle, angle + slice); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.stroke();
    if (v / total > 0.04) {
      const mid = angle + slice / 2;
      ctx.fillStyle = "#fff"; ctx.textAlign = "center";
      ctx.fillText(((v / total) * 100).toFixed(1) + "%", 250 + Math.cos(mid) * 105, 225 + Math.sin(mid) * 105 + 4);
    }
    angle += slice;
  });
  ctx.textAlign = "left";
  labels.forEach((l, i) => {
    ctx.fillStyle = COLORS[i % COLORS.length]; ctx.fillRect(470, 100 + i * 28, 16, 16);
    ctx.fillStyle = "#222"; ctx.fillText(`${l} (${values[i]})`, 495, 113 + i * 28);
  });
  return c.canvas;
}

// ---------------------------------------------------------------- correlation heatmap
function heatmapChart(names, matrix, title) {
  const cell = 62, left = 150, top = 60;
  const size = Math.max(560, left + names.length * cell + 40);
  const c = newCanvas(size, top + names.length * cell + 150);
  const { ctx } = c;
  ctx.textAlign = "center"; ctx.font = "bold 15px 'Segoe UI', Arial"; ctx.fillText(title, size / 2, 24); ctx.font = "12px 'Segoe UI', Arial";
  matrix.forEach((row, i) => row.forEach((v, j) => {
    const strength = Math.abs(v);
    ctx.fillStyle = `rgb(${Math.round(255 - 176 * strength)},${Math.round(255 - 112 * strength)},${Math.round(255 - 45 * strength)})`;
    ctx.fillRect(left + j * cell, top + i * cell, cell - 2, cell - 2);
    ctx.fillStyle = strength > 0.6 ? "#fff" : "#222"; ctx.textAlign = "center";
    ctx.fillText(v.toFixed(2), left + j * cell + cell / 2, top + i * cell + cell / 2 + 4);
  }));
  names.forEach((n, i) => {
    ctx.fillStyle = "#222"; ctx.textAlign = "right"; ctx.fillText(n, left - 8, top + i * cell + cell / 2 + 4);
    ctx.save(); ctx.translate(left + i * cell + cell / 2, top + names.length * cell + 8); ctx.rotate(-Math.PI / 4);
    ctx.textAlign = "right"; ctx.fillText(n, 0, 0); ctx.restore();
  });
  return c.canvas;
}

// ---------------------------------------------------------------- grouped bars (model comparison)
// groups: model names; series: [{label, values}]
function groupedBarChart(groups, series, title, yLabel) {
  const c = newCanvas(860, 440);
  const all = series.flatMap((s) => s.values);
  const yAxis = niceAxis(0, Math.max(...all));
  const area = drawFrame(c, title, yAxis, "", yLabel, { left: 70, right: 20, top: 60, bottom: 70 });
  const slot = (area.right - area.left) / groups.length, barWidth = (slot * 0.8) / series.length;
  const { ctx } = c;
  groups.forEach((g, i) => {
    series.forEach((s, k) => {
      const x = area.left + i * slot + slot * 0.1 + k * barWidth;
      ctx.fillStyle = COLORS[k]; ctx.fillRect(x, area.yOf(s.values[i]), barWidth - 2, area.bottom - area.yOf(s.values[i]));
    });
    drawLabel(ctx, g, area.left + i * slot + slot / 2, area.bottom + 2, false);
  });
  ctx.textAlign = "left";
  series.forEach((s, k) => {      // legend
    ctx.fillStyle = COLORS[k]; ctx.fillRect(area.left + k * 110, 36, 12, 12);
    ctx.fillStyle = "#222"; ctx.fillText(s.label, area.left + k * 110 + 17, 47);
  });
  return c.canvas;
}
