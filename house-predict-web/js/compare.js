// compare.js - trains all models, measures them and returns the results for the page.
// Both functions are async only so the page can show "Running..." between the models.

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
const r2dp = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// Time how long one model takes to train and test
async function timeModel(trainFunction) {
  await pause();
  const start = performance.now();
  const result = trainFunction();
  return { result, seconds: (performance.now() - start) / 1000 };
}

// ================================================================ regression (predict the price)
async function compareRegression(df, target, requestedFeatures, depth) {
  const numeric = numericCols(df);
  if (!numeric.length) throw new UserError("Price prediction requires a numerical price column, but this dataset has no numerical columns.");
  if (!target || !df.columns.includes(target)) throw new UserError("Please select a valid price (target) column.");
  if (df.types[target] !== "num") {
    throw new UserError(`Price prediction requires a numerical target column. '${target}' contains text. Please choose a numerical column such as Price.`);
  }
  const { rows, features, notes } = cleanFeatures(df.rows, df, target, requestedFeatures);
  if (rows.length < 50) throw new UserError("Too few records. At least 50 rows without missing values are needed.");
  if (new Set(rows.map((r) => r[target])).size < 5) {
    throw new UserError(`'${target}' has very few different values, so it does not look like a price column.`);
  }

  const encoder = buildEncoder(rows, features, df);
  const X = rows.map(encoder.encode), y = rows.map((r) => r[target]);
  const split = splitIndices(rows.length, 0.2, makeRng(42));
  const Xtrain = split.train.map((i) => X[i]), ytrain = split.train.map((i) => y[i]);
  const Xtest = split.test.map((i) => X[i]), ytest = split.test.map((i) => y[i]);

  const definitions = [
    ["Linear Regression", () => trainLinear(Xtrain, ytrain)],
    ["Decision Tree", () => trainDecisionTree(Xtrain, ytrain, { maxDepth: depth, nClasses: 0 })],
    ["KNN (K=5)", () => trainKnn(Xtrain, ytrain, { k: 5, nClasses: 0 })],
    ["Random Forest", () => trainForest(Xtrain, ytrain, { nTrees: 100, nClasses: 0 })],
    ["Gradient Boosting", () => trainGradientBoosting(Xtrain, ytrain)],
  ];

  const results = [], models = {}, testPredictions = {};
  for (const [name, train] of definitions) {
    const { result: model, seconds } = await timeModel(train);
    const predicted = model.predict(Xtest);
    const test = regressionMetrics(ytest, predicted);
    const trainScore = regressionMetrics(ytrain, model.predict(Xtrain));
    models[name] = model;
    testPredictions[name] = predicted;
    results.push({ name, r2: r2dp(test.r2, 4), trainR2: r2dp(trainScore.r2, 4), mae: r2dp(test.mae), rmse: r2dp(test.rmse),
                   seconds: r2dp(seconds) });
  }
  const best = results.reduce((a, b) => (b.r2 > a.r2 ? b : a)).name;

  const forest = models["Random Forest"];
  const importance = encoder.names.map((n, i) => [n, forest.importance[i]])
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, v]) => [n, r2dp(v, 3)]);

  // keep the trained models so the Predict page can use them
  STATE.trained = { target, features, rows, df, encoder, models, best };
  return { target, features, notes, best, results, trainRows: split.train.length, testRows: split.test.length,
           maxDepth: depth, actual: ytest, predicted: testPredictions[best], importance };
}

// ================================================================ classification (price category)
const CLASS_ORDER = ["Very Low", "Low", "Medium", "High", "Very High"];

// Uses a text column as it is, or splits a number column (like Price) into equal-sized groups.
function makeClasses(df, target, nClasses) {
  const values = df.rows.map((r) => r[target]);
  const present = values.filter((v) => v !== null);
  const unique = new Set(present);
  if (df.types[target] === "cat" || unique.size <= 20) {
    if (unique.size < 2 || unique.size > 20) throw new UserError(`'${target}' must have between 2 and 20 different categories.`);
    return { classes: values.map((v) => (v === null ? null : String(v))), ranges: null };
  }
  if (nClasses < 2 || nClasses > 5) throw new UserError("Number of price categories must be between 2 and 5.");
  const names = { 2: ["Low", "High"], 3: ["Low", "Medium", "High"], 4: ["Low", "Medium", "High", "Very High"],
                  5: ["Very Low", "Low", "Medium", "High", "Very High"] }[nClasses];
  const sorted = [...present].sort((a, b) => a - b);
  const edges = Array.from({ length: nClasses + 1 }, (_, i) => quantileSorted(sorted, i / nClasses));
  if (new Set(edges).size < edges.length) throw new UserError("This column cannot be split into equal price categories. Try fewer categories.");
  const classes = values.map((v) => {
    if (v === null) return null;
    for (let i = 0; i < nClasses; i++) if (v <= edges[i + 1]) return names[i];
    return names[nClasses - 1];
  });
  const ranges = names.map((nm, i) => `${nm}: ${edges[i].toFixed(1)} to ${edges[i + 1].toFixed(1)}`);
  return { classes, ranges };
}

async function compareClassification(df, target, requestedFeatures, nClasses, depth) {
  if (!target || !df.columns.includes(target)) throw new UserError("Please select a valid target column.");
  const { classes, ranges } = makeClasses(df, target, nClasses);
  const withClass = df.rows.map((r, i) => ({ ...r, __class__: classes[i] }));
  // the price column must not be used to predict its own category
  const wanted = requestedFeatures.filter((f) => f !== target);
  if (!wanted.length) throw new UserError("Please select at least one feature column (not the price column itself).");
  const cleaned = cleanFeatures(withClass, df, "__class__", wanted);
  const { rows, features, notes } = cleaned;
  if (rows.length < 50) throw new UserError("Too few records. At least 50 rows without missing values are needed.");

  const present = [...new Set(rows.map((r) => r.__class__))];
  const labels = present.every((c) => CLASS_ORDER.includes(c)) ? CLASS_ORDER.filter((c) => present.includes(c)) : present.sort();
  const counts = {};
  rows.forEach((r) => (counts[r.__class__] = (counts[r.__class__] || 0) + 1));
  if (Math.min(...Object.values(counts)) < 5) throw new UserError("One category has fewer than 5 records. Use fewer categories.");
  const K = labels.length;
  const y = rows.map((r) => labels.indexOf(r.__class__));

  const encoder = buildEncoder(rows, features, df);
  const X = rows.map(encoder.encode);
  const split = splitIndices(rows.length, 0.2, makeRng(42), y);
  const pick = (arr, idx) => idx.map((i) => arr[i]);
  const Xtrain = pick(X, split.train), Xtest = pick(X, split.test);
  const ytrain = pick(y, split.train), ytest = pick(y, split.test);
  const rawTrain = pick(rows, split.train), rawTest = pick(rows, split.test);
  const numericSet = new Set(features.filter((f) => df.types[f] === "num"));

  let j48Model = null;
  const definitions = [
    ["Decision Tree", () => trainDecisionTree(Xtrain, ytrain, { maxDepth: depth, minLeaf: 5, nClasses: K }), Xtest],
    ["J48 (C4.5)", () => (j48Model = trainJ48(rawTrain, ytrain, features, numericSet, labels, { minLeaf: 20, maxDepth: depth })), rawTest],
    ["Naive Bayes", () => trainNaiveBayes(Xtrain, ytrain, K), Xtest],
    ["KNN (K=5)", () => trainKnn(Xtrain, ytrain, { k: 5, nClasses: K }), Xtest],
    ["Random Forest", () => trainForest(Xtrain, ytrain, { nTrees: 100, nClasses: K }), Xtest],
  ];

  const results = [], matrices = {};
  for (const [name, train, testInput] of definitions) {
    const { result: model, seconds } = await timeModel(train);
    const m = classificationMetrics(ytest, model.predict(testInput), K);
    results.push({ name, accuracy: r2dp(m.accuracy * 100), precision: r2dp(m.precision * 100), recall: r2dp(m.recall * 100),
                   f1: r2dp(m.f1 * 100), seconds: r2dp(seconds) });
    matrices[name] = m.matrix;
  }
  const best = results.reduce((a, b) => (b.accuracy > a.accuracy || (b.accuracy === a.accuracy && b.f1 > a.f1) ? b : a)).name;
  return { target, features, notes, best, results, labels, matrices, ranges, j48Text: j48Model.text, j48Leaves: j48Model.leaves,
           trainRows: split.train.length, testRows: split.test.length, maxDepth: depth };
}

// ================================================================ compare ALL algorithms with each other
// All 7 algorithms are tested on the SAME houses with the SAME 80/20 split.
//   Test 1 - Price Category : all 7 algorithms compete. The regression algorithms (Linear Regression, Gradient Boosting)
//            predict a price, and that price is turned into a category (Low / Medium / High), so they can
//            be judged with the same Accuracy / Precision / Recall / F1 as J48 and Naive Bayes.
//   Test 2 - Exact Price    : the 5 algorithms that can predict a number compete (R2, MAE, RMSE).
// Then every algorithm is compared head-to-head with every other one.

// items: [{ name, values: { metric: number } }], metrics: [{ key, higher: true/false }]
// returns a table where cell [a][b] = how many metrics algorithm a wins / loses against algorithm b
function headToHead(items, metrics) {
  return items.map((a) => items.map((b) => {
    if (a === b) return null;
    let wins = 0, losses = 0;
    metrics.forEach((m) => {
      const x = a.values[m.key], y = b.values[m.key];
      if (x === y) return;                            // a tie counts for nobody
      if (m.higher ? x > y : x < y) wins++; else losses++;
    });
    return { wins, losses };
  }));
}

// how many opponents each algorithm beats (more metric wins than losses)
function matchupWins(items, table) {
  return items.map((_, i) => table[i].filter((cell) => cell && cell.wins > cell.losses).length);
}

async function compareAllAlgorithms(df, target, requestedFeatures, nClasses, depth) {
  if (!target || !df.columns.includes(target)) throw new UserError("Please select a valid price (target) column.");
  if (df.types[target] !== "num") {
    throw new UserError(`Comparing all algorithms needs a numerical price column. '${target}' contains text. Please choose a column such as Price.`);
  }
  const priceValues = df.rows.map((r) => r[target]).filter((v) => v !== null);
  if (new Set(priceValues).size <= 20) throw new UserError(`'${target}' has very few different values, so it does not look like a price column.`);
  const wanted = requestedFeatures.filter((f) => f !== target);
  if (!wanted.length) throw new UserError("Please select at least one feature column (not the price column itself).");

  const { classes, ranges } = makeClasses(df, target, nClasses);
  const withClass = df.rows.map((r, i) => ({ ...r, __class__: classes[i] }));
  const { rows, features, notes } = cleanFeatures(withClass, df, "__class__", wanted);
  if (rows.length < 50) throw new UserError("Too few records. At least 50 rows without missing values are needed.");

  const present = [...new Set(rows.map((r) => r.__class__))];
  const labels = present.every((c) => CLASS_ORDER.includes(c)) ? CLASS_ORDER.filter((c) => present.includes(c)) : present.sort();
  const counts = {};
  rows.forEach((r) => (counts[r.__class__] = (counts[r.__class__] || 0) + 1));
  if (Math.min(...Object.values(counts)) < 5) throw new UserError("One category has fewer than 5 records. Use fewer categories.");
  const K = labels.length;
  const yClass = rows.map((r) => labels.indexOf(r.__class__));
  const yPrice = rows.map((r) => r[target]);

  // cut-off prices between neighbouring categories (used to turn a predicted price into a category)
  const lowest = new Array(K).fill(Infinity), highest = new Array(K).fill(-Infinity);
  rows.forEach((r, i) => {
    lowest[yClass[i]] = Math.min(lowest[yClass[i]], yPrice[i]);
    highest[yClass[i]] = Math.max(highest[yClass[i]], yPrice[i]);
  });
  const cuts = Array.from({ length: K - 1 }, (_, c) => (highest[c] + lowest[c + 1]) / 2);
  const toClass = (p) => { for (let c = 0; c < K - 1; c++) if (p <= cuts[c]) return c; return K - 1; };

  const encoder = buildEncoder(rows, features, df);
  const X = rows.map(encoder.encode);
  const split = splitIndices(rows.length, 0.2, makeRng(42), yClass);
  const pick = (arr, idx) => idx.map((i) => arr[i]);
  const Xtrain = pick(X, split.train), Xtest = pick(X, split.test);
  const cTrain = pick(yClass, split.train), cTest = pick(yClass, split.test);
  const pTrain = pick(yPrice, split.train), pTest = pick(yPrice, split.test);
  const rawTrain = pick(rows, split.train), rawTest = pick(rows, split.test);
  const numericSet = new Set(features.filter((f) => df.types[f] === "num"));
  const accuracyOf = (actual, predicted) => actual.filter((a, i) => a === predicted[i]).length / actual.length * 100;

  // one record per algorithm
  const names = ["Linear Regression", "Decision Tree", "KNN (K=5)", "Random Forest", "Gradient Boosting", "J48 (C4.5)", "Naive Bayes"];
  const info = {};
  names.forEach((n) => (info[n] = { name: n, price: null, cat: null, seconds: 0 }));

  // ---- Test 2 first: the models that predict a price (their prices are reused for Test 1)
  const regressors = [
    ["Linear Regression", () => trainLinear(Xtrain, pTrain)],
    ["Decision Tree", () => trainDecisionTree(Xtrain, pTrain, { maxDepth: depth, nClasses: 0 })],
    ["KNN (K=5)", () => trainKnn(Xtrain, pTrain, { k: 5, nClasses: 0 })],
    ["Random Forest", () => trainForest(Xtrain, pTrain, { nTrees: 100, nClasses: 0 })],
    ["Gradient Boosting", () => trainGradientBoosting(Xtrain, pTrain)],
  ];
  const regModels = {};
  for (const [name, train] of regressors) {
    const { result: model, seconds } = await timeModel(train);
    regModels[name] = model;
    const test = regressionMetrics(pTest, model.predict(Xtest));
    const trainScore = regressionMetrics(pTrain, model.predict(Xtrain));
    const predictedTest = model.predict(Xtest);
    const within10 = pTest.filter((a, i) => a !== 0 && Math.abs(predictedTest[i] - a) / Math.abs(a) <= 0.10).length / pTest.length * 100;   // % of houses predicted within +-10% of the real price
    info[name].price = { r2: r2dp(test.r2, 4), trainR2: r2dp(trainScore.r2, 4), mae: r2dp(test.mae), rmse: r2dp(test.rmse), seconds: r2dp(seconds), within10: r2dp(within10, 1) };
    info[name].seconds += seconds;
  }

  // ---- Test 1: price category
  const scoreCategory = (name, predictedTest, predictedTrain, seconds, usedAs) => {
    const m = classificationMetrics(cTest, predictedTest, K);
    const trainAccuracy = r2dp(accuracyOf(cTrain, predictedTrain));
    const cat = { accuracy: r2dp(m.accuracy * 100), precision: r2dp(m.precision * 100), recall: r2dp(m.recall * 100), f1: r2dp(m.f1 * 100),
                  trainAccuracy, seconds: r2dp(seconds), usedAs, matrix: m.matrix };
    cat.score = r2dp((cat.accuracy + cat.precision + cat.recall + cat.f1) / 4);
    info[name].cat = cat;
  };
  // Linear Regression and Gradient Boosting: predicted price -> category
  for (const name of ["Linear Regression", "Gradient Boosting"]) {
    scoreCategory(name, regModels[name].predict(Xtest).map(toClass), regModels[name].predict(Xtrain).map(toClass),
                  info[name].price.seconds, "Predicts the price, then the price is turned into a category");
  }
  const classifiers = [
    ["Decision Tree", () => trainDecisionTree(Xtrain, cTrain, { maxDepth: depth, minLeaf: 5, nClasses: K }), Xtest, Xtrain],
    ["J48 (C4.5)", () => trainJ48(rawTrain, cTrain, features, numericSet, labels, { minLeaf: 20, maxDepth: depth }), rawTest, rawTrain],
    ["Naive Bayes", () => trainNaiveBayes(Xtrain, cTrain, K), Xtest, Xtrain],
    ["KNN (K=5)", () => trainKnn(Xtrain, cTrain, { k: 5, nClasses: K }), Xtest, Xtrain],
    ["Random Forest", () => trainForest(Xtrain, cTrain, { nTrees: 100, nClasses: K }), Xtest, Xtrain],
  ];
  let j48Model = null;
  for (const [name, train, testInput, trainInput] of classifiers) {
    const { result: model, seconds } = await timeModel(train);
    if (name === "J48 (C4.5)") j48Model = model;
    scoreCategory(name, model.predict(testInput), model.predict(trainInput), seconds, "Directly predicts the category");
    info[name].seconds += seconds;
  }

  // ---- ranking and head-to-head
  const all = names.map((n) => info[n]);
  const byCategory = [...all].sort((a, b) => b.cat.score - a.cat.score || a.cat.seconds - b.cat.seconds);
  byCategory.forEach((m, i) => (m.cat.rank = i + 1));
  const catItems = byCategory.map((m) => ({ name: m.name, values: { accuracy: m.cat.accuracy, precision: m.cat.precision,
    recall: m.cat.recall, f1: m.cat.f1, seconds: m.cat.seconds } }));
  const catMetrics = [{ key: "accuracy", higher: true }, { key: "precision", higher: true }, { key: "recall", higher: true },
                      { key: "f1", higher: true }, { key: "seconds", higher: false }];
  const catTable = headToHead(catItems, catMetrics);
  const catBeats = matchupWins(catItems, catTable);
  byCategory.forEach((m, i) => (m.cat.beats = catBeats[i]));

  const byPrice = all.filter((m) => m.price).sort((a, b) => b.price.r2 - a.price.r2 || a.price.rmse - b.price.rmse);
  byPrice.forEach((m, i) => (m.price.rank = i + 1));
  const priceItems = byPrice.map((m) => ({ name: m.name, values: { r2: m.price.r2, mae: m.price.mae, rmse: m.price.rmse, seconds: m.price.seconds } }));
  const priceMetrics = [{ key: "r2", higher: true }, { key: "mae", higher: false }, { key: "rmse", higher: false }, { key: "seconds", higher: false }];
  const priceTable = headToHead(priceItems, priceMetrics);
  const priceBeats = matchupWins(priceItems, priceTable);
  byPrice.forEach((m, i) => (m.price.beats = priceBeats[i]));

  // keep the trained price models so the Predict page can use them
  STATE.trained = { target, features, rows, df, encoder, models: regModels, best: byPrice[0].name };

  return {
    target, features, notes, labels, ranges, trainRows: split.train.length, testRows: split.test.length, maxDepth: depth,
    datasetName: df.name, rowsUsed: rows.length, priceMin: Math.min(...yPrice), priceMax: Math.max(...yPrice), priceMean: r2dp(mean(yPrice)),
    importance: encoder.names.map((n, i) => [n, regModels["Random Forest"].importance[i]]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, v]) => [n, r2dp(v, 3)]),
    byCategory, byPrice, catItems, catTable, catMetrics, priceItems, priceTable, priceMetrics,
    winner: byCategory[0].name, priceWinner: byPrice[0].name, j48Text: j48Model.text, j48Leaves: j48Model.leaves,
  };
}

// ================================================================ predict one new house
function predictionFields() {
  const t = STATE.trained;
  if (!t) return null;
  return t.features.map((f) => {
    const values = t.rows.map((r) => r[f]);
    if (t.df.types[f] === "num") return { name: f, kind: "number", value: r2dp(median(values)) };
    const counts = {};
    values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
    const options = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    return { name: f, kind: "choice", options, value: options[0] };
  });
}

function predictHouse(values) {
  const t = STATE.trained;
  if (!t) throw new UserError("Please run the Regression comparison first. The models are trained there.");
  const row = {};
  t.features.forEach((f) => {
    const v = values[f];
    if (v === undefined || v === null || String(v).trim() === "") throw new UserError(`Please enter a value for '${f}'.`);
    if (t.df.types[f] === "num") {
      if (isNaN(Number(v))) throw new UserError(`'${f}' must be a number.`);
      row[f] = Number(v);
    } else row[f] = String(v);
  });
  const x = t.encoder.encode(row);
  const predictions = Object.keys(t.models).map((name) => ({ name, price: r2dp(t.models[name].predict([x])[0]) }));
  return { target: t.target, best: t.best, predictions };
}
