// models.js - all data mining algorithms, written from scratch (no libraries).
//
// Regression models   : Linear Regression, Decision Tree, KNN, Random Forest, Gradient Boosting
// Classification      : Decision Tree, J48 (C4.5), Naive Bayes, KNN, Random Forest
//
// X is always an array of rows (each row is an array of numbers).
// Every train function returns an object with a predict(X) method.

// ---------------------------------------------------------------- helpers
function makeRng(seed) {                 // small random number generator (same seed = same results)
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 80% training / 20% testing. With labels, every class is split in the same proportion.
function splitIndices(n, testFraction, rng, labels) {
  if (!labels) {
    const idx = shuffle([...Array(n).keys()], rng);
    const nTest = Math.round(n * testFraction);
    return { test: idx.slice(0, nTest), train: idx.slice(nTest) };
  }
  const groups = {};
  labels.forEach((l, i) => (groups[l] = groups[l] || []).push(i));
  const train = [], test = [];
  Object.values(groups).forEach((g) => {
    shuffle(g, rng);
    const nTest = Math.max(1, Math.round(g.length * testFraction));
    test.push(...g.slice(0, nTest));
    train.push(...g.slice(nTest));
  });
  return { train: shuffle(train, rng), test: shuffle(test, rng) };
}

// Scale every column to mean 0 and standard deviation 1 (needed for Linear Regression and KNN)
function fitScaler(X) {
  const p = X[0].length, n = X.length;
  const means = new Array(p).fill(0), stds = new Array(p).fill(0);
  X.forEach((r) => r.forEach((v, j) => (means[j] += v / n)));
  X.forEach((r) => r.forEach((v, j) => (stds[j] += (v - means[j]) ** 2 / n)));
  for (let j = 0; j < p; j++) stds[j] = Math.sqrt(stds[j]) || 1;
  return { transform: (A) => A.map((r) => r.map((v, j) => (v - means[j]) / stds[j])) };
}

function toColumns(X) {
  const p = X[0].length;
  return Array.from({ length: p }, (_, j) => Float64Array.from(X, (r) => r[j]));
}

// ================================================================ 1. Linear Regression
// Finds the weights w that minimise the squared error, by solving the normal equations.
function trainLinear(X, y) {
  const scaler = fitScaler(X);
  const Z = scaler.transform(X);
  const n = Z.length, p = Z[0].length, m = p + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));   // augmented matrix [XtX | Xty]
  for (let i = 0; i < n; i++) {
    const row = [1, ...Z[i]];
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) A[a][b] += row[a] * row[b];
      A[a][m] += row[a] * y[i];
    }
  }
  for (let a = 1; a < m; a++) A[a][a] += 1e-4 * n;      // tiny penalty keeps the maths stable
  for (let col = 0; col < m; col++) {                   // Gaussian elimination
    let pivot = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const factor = A[r][col] / A[col][col];
      for (let c = col; c <= m; c++) A[r][c] -= factor * A[col][c];
    }
  }
  const w = Array.from({ length: m }, (_, i) => A[i][m] / A[i][i]);
  return {
    predict: (Xq) => scaler.transform(Xq).map((r) => r.reduce((s, v, j) => s + v * w[j + 1], w[0])),
  };
}

// ================================================================ 2. Decision tree (CART)
// One tree builder used for regression (predict a number) and classification (predict a class).
// Regression : choose the split that reduces the squared error the most.
// Classification : choose the split with the lowest Gini impurity.
// opt = { maxDepth, minLeaf, maxFeatures, rng, nClasses (0 = regression), importance: [] }
function buildTree(Xc, y, idx, opt, depth) {
  const n = idx.length, p = Xc.length, K = opt.nClasses;
  const isClass = K > 0;

  // statistics of this node
  let counts, sumAll = 0, sqAll = 0, leaf;
  if (isClass) {
    counts = new Array(K).fill(0);
    idx.forEach((i) => counts[y[i]]++);
    leaf = { leaf: true, value: counts.indexOf(Math.max(...counts)) };
    sqAll = counts.reduce((s, c) => s + c * c, 0);
    if (counts.filter((c) => c > 0).length === 1) return leaf;      // pure node
  } else {
    let sumSq = 0;
    idx.forEach((i) => { sumAll += y[i]; sumSq += y[i] * y[i]; });
    leaf = { leaf: true, value: sumAll / n };
    if (sumSq - (sumAll * sumAll) / n < 1e-12) return leaf;          // all values equal
  }
  if (depth >= opt.maxDepth || n < 2 * opt.minLeaf) return leaf;

  // which features to try (a random subset for Random Forest)
  let features = [...Array(p).keys()];
  if (opt.maxFeatures && opt.maxFeatures < p) features = shuffle(features, opt.rng).slice(0, opt.maxFeatures);

  let best = null;
  for (const f of features) {
    const col = Xc[f];
    const order = Int32Array.from(idx).sort((a, b) => col[a] - col[b]);
    if (col[order[0]] === col[order[n - 1]]) continue;
    let cL, cR, sqL, sqR, sumL = 0;
    if (isClass) { cL = new Array(K).fill(0); cR = counts.slice(); sqL = 0; sqR = sqAll; }
    for (let i = 0; i < n - 1; i++) {
      const k = order[i];
      if (isClass) {
        const c = y[k];
        sqL += 2 * cL[c] + 1; cL[c]++;
        sqR -= 2 * cR[c] - 1; cR[c]--;
      } else sumL += y[k];
      const nL = i + 1, nR = n - nL;
      if (col[k] === col[order[i + 1]]) continue;         // cannot split between equal values
      if (nL < opt.minLeaf || nR < opt.minLeaf) continue;
      const score = isClass ? -((nL - sqL / nL) + (nR - sqR / nR))
                            : (sumL * sumL) / nL + ((sumAll - sumL) ** 2) / nR;
      if (!best || score > best.score) best = { score, f, threshold: (col[k] + col[order[i + 1]]) / 2 };
    }
  }
  if (!best) return leaf;
  const gain = isClass ? (n - sqAll / n) + best.score : best.score - (sumAll * sumAll) / n;
  if (gain <= 1e-12) return leaf;
  if (opt.importance) opt.importance[best.f] += gain;

  const col = Xc[best.f];
  const left = idx.filter((i) => col[i] <= best.threshold);
  const right = idx.filter((i) => col[i] > best.threshold);
  return { leaf: false, f: best.f, threshold: best.threshold,
           left: buildTree(Xc, y, left, opt, depth + 1), right: buildTree(Xc, y, right, opt, depth + 1) };
}

function predictTreeRow(node, x) {
  while (!node.leaf) node = x[node.f] <= node.threshold ? node.left : node.right;
  return node.value;
}

function trainDecisionTree(X, y, opt) {
  const Xc = toColumns(X);
  const tree = buildTree(Xc, y, [...Array(X.length).keys()], { minLeaf: 5, rng: makeRng(1), ...opt }, 0);
  return { predict: (Xq) => Xq.map((x) => predictTreeRow(tree, x)) };
}

// ================================================================ 3. KNN
// Finds the k most similar training rows (closest distance) and averages / votes.
function trainKnn(X, y, opt) {
  const scaler = fitScaler(X);
  const Z = scaler.transform(X);
  const k = opt.k || 5;
  return {
    predict: (Xq) => scaler.transform(Xq).map((q) => {
      const bestD = new Array(k).fill(Infinity), bestI = new Array(k).fill(-1);
      for (let i = 0; i < Z.length; i++) {
        let d = 0;
        const row = Z[i];
        for (let j = 0; j < q.length; j++) { const diff = row[j] - q[j]; d += diff * diff; }
        if (d < bestD[k - 1]) {                     // insert into the sorted list of k nearest
          let pos = k - 1;
          while (pos > 0 && bestD[pos - 1] > d) { bestD[pos] = bestD[pos - 1]; bestI[pos] = bestI[pos - 1]; pos--; }
          bestD[pos] = d; bestI[pos] = i;
        }
      }
      if (opt.nClasses > 0) {
        const votes = new Array(opt.nClasses).fill(0);
        bestI.forEach((i) => votes[y[i]]++);
        return votes.indexOf(Math.max(...votes));
      }
      return bestI.reduce((s, i) => s + y[i], 0) / k;
    }),
  };
}

// ================================================================ 4. Random Forest
// Many trees, each trained on a random sample of the rows (and random features). Average / vote.
function trainForest(X, y, opt) {
  const Xc = toColumns(X);
  const n = X.length, p = Xc.length, rng = makeRng(42);
  const isClass = opt.nClasses > 0;
  const importance = new Array(p).fill(0);
  const maxFeatures = isClass ? Math.max(1, Math.round(Math.sqrt(p))) : Math.max(1, Math.floor(p / 3));
  const trees = [];
  for (let t = 0; t < (opt.nTrees || 100); t++) {
    const sample = Array.from({ length: n }, () => Math.floor(rng() * n));     // bootstrap sample
    trees.push(buildTree(Xc, y, sample, { maxDepth: 14, minLeaf: isClass ? 2 : 3, maxFeatures, rng,
                                            nClasses: opt.nClasses || 0, importance }, 0));
  }
  const total = importance.reduce((s, v) => s + v, 0) || 1;
  return {
    importance: importance.map((v) => v / total),
    predict: (Xq) => Xq.map((x) => {
      if (isClass) {
        const votes = new Array(opt.nClasses).fill(0);
        trees.forEach((tree) => votes[predictTreeRow(tree, x)]++);
        return votes.indexOf(Math.max(...votes));
      }
      return trees.reduce((s, tree) => s + predictTreeRow(tree, x), 0) / trees.length;
    }),
  };
}

// ================================================================ 5. Gradient Boosting (regression)
// Starts with the average price, then adds small trees one by one; each tree learns the
// mistakes (residuals) that are left.
function trainGradientBoosting(X, y) {
  const Xc = toColumns(X);
  const n = X.length, rate = 0.1, nTrees = 100;
  const start = mean(y);
  const current = new Array(n).fill(start);
  const trees = [];
  for (let t = 0; t < nTrees; t++) {
    const residual = y.map((v, i) => v - current[i]);
    const tree = buildTree(Xc, residual, [...Array(n).keys()], { maxDepth: 3, minLeaf: 5, nClasses: 0 }, 0);
    trees.push(tree);
    for (let i = 0; i < n; i++) current[i] += rate * predictTreeRow(tree, X[i]);
  }
  return { predict: (Xq) => Xq.map((x) => trees.reduce((s, tree) => s + rate * predictTreeRow(tree, x), start)) };
}

// ================================================================ 6. Naive Bayes (Gaussian)
// For every class it remembers the mean and spread of each column, then picks the class
// with the highest probability for a new row.
function trainNaiveBayes(X, y, nClasses) {
  const p = X[0].length, n = X.length;
  const stats = [];
  let maxVar = 0;
  const overallMean = new Array(p).fill(0), overallVar = new Array(p).fill(0);
  X.forEach((r) => r.forEach((v, j) => (overallMean[j] += v / n)));
  X.forEach((r) => r.forEach((v, j) => (overallVar[j] += (v - overallMean[j]) ** 2 / n)));
  maxVar = Math.max(...overallVar);
  const epsilon = 1e-9 * maxVar;                     // avoids dividing by zero
  for (let c = 0; c < nClasses; c++) {
    const rows = X.filter((_, i) => y[i] === c);
    const m = new Array(p).fill(0), v = new Array(p).fill(0);
    rows.forEach((r) => r.forEach((val, j) => (m[j] += val / rows.length)));
    rows.forEach((r) => r.forEach((val, j) => (v[j] += (val - m[j]) ** 2 / rows.length)));
    stats.push({ m, v: v.map((x) => x + epsilon), logPrior: Math.log(rows.length / n) });
  }
  return {
    predict: (Xq) => Xq.map((x) => {
      let bestClass = 0, bestScore = -Infinity;
      stats.forEach((s, c) => {
        let score = s.logPrior;
        for (let j = 0; j < p; j++) score += -0.5 * Math.log(2 * Math.PI * s.v[j]) - ((x[j] - s.m[j]) ** 2) / (2 * s.v[j]);
        if (score > bestScore) { bestScore = score; bestClass = c; }
      });
      return bestClass;
    }),
  };
}

// ================================================================ 7. J48 (C4.5)
// J48 is Weka's version of the C4.5 algorithm. Main ideas:
//   1. Choose the split with the best GAIN RATIO (based on entropy).
//   2. Numerical columns are split with a threshold (value <= t / value > t).
//   3. Text columns get one branch for every value.
//   4. The finished tree is PRUNED (simple version) to avoid overfitting.
// This is a simplified teaching version, so results can differ a little from Weka.
function entropy(counts) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  return -counts.filter((c) => c > 0).reduce((s, c) => s + (c / total) * Math.log2(c / total), 0);
}

// rows: objects with the raw values; labels: class index of each row
function trainJ48(rows, labels, features, numericSet, classNames, opt) {
  const K = classNames.length;
  const minLeaf = opt.minLeaf, maxDepth = opt.maxDepth;
  const cols = {};
  features.forEach((f) => (cols[f] = rows.map((r) => (numericSet.has(f) ? r[f] : String(r[f])))));

  const countClasses = (idx) => { const c = new Array(K).fill(0); idx.forEach((i) => c[labels[i]]++); return c; };
  const makeLeaf = (counts) => ({ leaf: true, label: counts.indexOf(Math.max(...counts)), counts });

  // gain and gain ratio of a split into branches
  const score = (branches, parentEntropy) => {
    const sizes = branches.map((b) => b.reduce((s, c) => s + c, 0));
    const total = sizes.reduce((s, c) => s + c, 0);
    const weighted = branches.reduce((s, b, i) => s + (sizes[i] / total) * entropy(b), 0);
    const gain = parentEntropy - weighted, splitInfo = entropy(sizes);
    return { gain, ratio: splitInfo > 0 ? gain / splitInfo : 0 };
  };

  const numericSplit = (f, idx, parentEntropy) => {
    const col = cols[f];
    const values = idx.map((i) => col[i]);
    const unique = [...new Set(values)].sort((a, b) => a - b);
    if (unique.length < 2) return null;
    let thresholds;
    if (unique.length > 30) {                              // try only 30 thresholds so it stays fast
      const sorted = [...values].sort((a, b) => a - b);
      thresholds = [...new Set(Array.from({ length: 30 }, (_, k) => quantileSorted(sorted, 0.03 + (0.94 * k) / 29)))];
    } else thresholds = unique.slice(0, -1).map((v, k) => (v + unique[k + 1]) / 2);
    let best = null;
    for (const t of thresholds) {
      const left = new Array(K).fill(0), right = new Array(K).fill(0);
      let nL = 0;
      idx.forEach((i) => { if (col[i] <= t) { left[labels[i]]++; nL++; } else right[labels[i]]++; });
      if (nL < minLeaf || idx.length - nL < minLeaf) continue;
      const s = score([left, right], parentEntropy);
      if (!best || s.gain > best.gain) best = { feature: f, kind: "num", threshold: t, ...s };
    }
    return best;
  };

  const categoricalSplit = (f, idx, parentEntropy) => {
    const col = cols[f];
    const valueCounts = {};
    idx.forEach((i) => (valueCounts[col[i]] = (valueCounts[col[i]] || 0) + 1));
    const ordered = Object.keys(valueCounts).sort((a, b) => valueCounts[b] - valueCounts[a]);
    const keep = ordered.filter((v) => valueCounts[v] >= minLeaf);
    if (keep.length < 2) return null;
    const fallback = ordered[0];                           // biggest branch also takes rare / unseen values
    const groups = {};
    keep.forEach((v) => (groups[v] = []));
    idx.forEach((i) => groups[keep.includes(col[i]) ? col[i] : fallback].push(i));
    const s = score(keep.map((v) => countClasses(groups[v])), parentEntropy);
    return { feature: f, kind: "cat", groups, fallback, ...s };
  };

  const build = (idx, depth) => {
    const counts = countClasses(idx);
    if (counts.filter((c) => c > 0).length === 1 || depth >= maxDepth || idx.length < 2 * minLeaf) return makeLeaf(counts);
    const parentEntropy = entropy(counts);
    const candidates = features
      .map((f) => (numericSet.has(f) ? numericSplit(f, idx, parentEntropy) : categoricalSplit(f, idx, parentEntropy)))
      .filter((c) => c !== null);
    if (!candidates.length) return makeLeaf(counts);
    // C4.5 rule: only look at splits with gain >= average gain, then pick the best gain ratio
    const averageGain = mean(candidates.map((c) => c.gain));
    const good = candidates.filter((c) => c.gain >= averageGain - 1e-12 && c.gain > 1e-6);
    if (!good.length) return makeLeaf(counts);
    const best = good.reduce((a, b) => (b.ratio > a.ratio ? b : a));

    const node = { leaf: false, feature: best.feature, kind: best.kind, counts, label: counts.indexOf(Math.max(...counts)) };
    if (best.kind === "num") {
      node.threshold = best.threshold;
      const col = cols[best.feature];
      node.children = { "<=": build(idx.filter((i) => col[i] <= best.threshold), depth + 1),
                        ">": build(idx.filter((i) => col[i] > best.threshold), depth + 1) };
    } else {
      node.fallback = best.fallback;
      node.children = {};
      Object.keys(best.groups).forEach((v) => (node.children[v] = build(best.groups[v], depth + 1)));
    }
    return node;
  };

  // simple pessimistic pruning: turn a subtree into a leaf if that is not worse
  const leafError = (counts) => counts.reduce((s, c) => s + c, 0) - Math.max(...counts) + 0.5;
  const prune = (node) => {
    if (node.leaf) return leafError(node.counts);
    const subtreeError = Object.values(node.children).reduce((s, child) => s + prune(child), 0);
    const asLeaf = leafError(node.counts);
    if (asLeaf <= subtreeError + 1e-9) {
      const leaf = makeLeaf(node.counts);
      Object.keys(node).forEach((k) => delete node[k]);
      Object.assign(node, leaf);
      return asLeaf;
    }
    return subtreeError;
  };

  const root = build([...Array(rows.length).keys()], 0);
  prune(root);

  const predictRow = (row) => {
    let node = root;
    while (!node.leaf) {
      if (node.kind === "num") node = Number(row[node.feature]) <= node.threshold ? node.children["<="] : node.children[">"];
      else node = node.children[String(row[node.feature])] || node.children[node.fallback];
    }
    return node.label;
  };

  const leafText = (node) => {
    const total = node.counts.reduce((s, c) => s + c, 0), errors = total - Math.max(...node.counts);
    return `${classNames[node.label]} (${total}${errors ? "/" + errors : ""})`;
  };
  const lines = [];
  const writeText = (node, depth) => {
    if (node.leaf) { if (depth === 0) lines.push(": " + leafText(node)); return; }
    Object.keys(node.children).forEach((key) => {
      const child = node.children[key];
      const condition = node.kind === "num" ? `${node.feature} ${key} ${node.threshold.toFixed(2)}` : `${node.feature} = ${key}`;
      if (child.leaf) lines.push(`${"|   ".repeat(depth)}${condition} : ${leafText(child)}`);
      else { lines.push(`${"|   ".repeat(depth)}${condition}`); writeText(child, depth + 1); }
    });
  };
  writeText(root, 0);
  const countLeaves = (node) => (node.leaf ? 1 : Object.values(node.children).reduce((s, c) => s + countLeaves(c), 0));

  return { predict: (Xrows) => Xrows.map(predictRow), text: lines.join("\n"), leaves: countLeaves(root) };
}

// ================================================================ metrics
function regressionMetrics(actual, predicted) {
  const n = actual.length, avg = mean(actual);
  let ssRes = 0, ssTot = 0, abs = 0;
  actual.forEach((a, i) => { ssRes += (a - predicted[i]) ** 2; ssTot += (a - avg) ** 2; abs += Math.abs(a - predicted[i]); });
  return { r2: 1 - ssRes / ssTot, mae: abs / n, rmse: Math.sqrt(ssRes / n) };
}

// actual / predicted are class numbers 0..K-1
function classificationMetrics(actual, predicted, K) {
  const matrix = Array.from({ length: K }, () => new Array(K).fill(0));
  actual.forEach((a, i) => matrix[a][predicted[i]]++);
  const n = actual.length;
  let correct = 0, precision = 0, recall = 0, f1 = 0;
  for (let c = 0; c < K; c++) {
    const tp = matrix[c][c];
    const support = matrix[c].reduce((s, v) => s + v, 0);
    const predictedCount = matrix.reduce((s, row) => s + row[c], 0);
    const p = predictedCount ? tp / predictedCount : 0, r = support ? tp / support : 0;
    const f = p + r ? (2 * p * r) / (p + r) : 0;
    correct += tp;
    precision += (p * support) / n; recall += (r * support) / n; f1 += (f * support) / n;     // weighted average
  }
  return { accuracy: correct / n, precision, recall, f1, matrix };
}
