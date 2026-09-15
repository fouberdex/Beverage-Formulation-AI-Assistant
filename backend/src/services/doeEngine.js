import { createHash } from 'node:crypto';

export const DOE_ENGINE_VERSION = '1.1.0';

const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
};
const signature = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

function setting(factor, coded) {
  const midpoint = (factor.low + factor.high) / 2;
  const halfRange = (factor.high - factor.low) / 2;
  return { coded, value: round(midpoint + coded * halfRange), unit: factor.unit || '' };
}

function factorialRows(factorCount) {
  return Array.from({ length: 2 ** factorCount }, (_, index) =>
    Array.from({ length: factorCount }, (_, position) => ((index >> (factorCount - position - 1)) & 1 ? 1 : -1)));
}

export function generateDoeDesign(input) {
  const normalized = {
    type: input.type,
    factors: input.factors.map(item => ({ key: item.key, label: item.label, low: Number(item.low), high: Number(item.high), unit: item.unit || '' })),
    responses: input.responses.map(item => ({ key: item.key, label: item.label, goal: item.goal, target: item.target ?? null, unit: item.unit || '' })),
    center_points: Number(input.center_points || 0),
    replicates: Number(input.replicates || 1),
  };
  const designSignature = signature({ engine: DOE_ENGINE_VERSION, ...normalized });
  const baseRows = factorialRows(normalized.factors.length);
  if (normalized.type === 'response_surface') {
    normalized.factors.forEach((_, factorIndex) => {
      const low = Array(normalized.factors.length).fill(0); low[factorIndex] = -1;
      const high = Array(normalized.factors.length).fill(0); high[factorIndex] = 1;
      baseRows.push(low, high);
    });
  }
  const uniqueRows = [...new Map(baseRows.map(row => [row.join(','), row])).values()];
  const designRows = [...uniqueRows, ...Array.from({ length: normalized.center_points }, () => Array(normalized.factors.length).fill(0))];
  const runs = [];
  for (let replicate = 1; replicate <= normalized.replicates; replicate += 1) {
    designRows.forEach((row, rowIndex) => {
      const standardOrder = (replicate - 1) * designRows.length + rowIndex + 1;
      runs.push({
        id: `DOE-${designSignature.slice(0, 8).toUpperCase()}-${String(standardOrder).padStart(3, '0')}`,
        standard_order: standardOrder,
        replicate,
        factor_settings: Object.fromEntries(normalized.factors.map((factor, index) => [factor.key, setting(factor, row[index])])),
      });
    });
  }
  return {
    engine_version: DOE_ENGINE_VERSION,
    signature: designSignature,
    design_type: normalized.type,
    factors: normalized.factors,
    responses: normalized.responses,
    center_points: normalized.center_points,
    replicates: normalized.replicates,
    run_count: runs.length,
    runs,
    generated_at: new Date().toISOString(),
  };
}

function solve(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    if (Math.abs(augmented[pivot][pivot]) < 1e-10) return null;
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const multiplier = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) augmented[row][column] -= multiplier * augmented[pivot][column];
    }
  }
  return augmented.map(row => row[size]);
}

function logGamma(value) {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.9999999999998099; const shifted = value - 1;
  coefficients.forEach((coefficient, index) => { x += coefficient / (shifted + index + 1); });
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaFraction(a, b, x) {
  const maxIterations = 200; const epsilon = 3e-12; const floor = 1e-30;
  const qab = a + b; const qap = a + 1; const qam = a - 1;
  let c = 1; let d = 1 - qab * x / qap; if (Math.abs(d) < floor) d = floor; d = 1 / d; let h = d;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const twice = 2 * iteration;
    let aa = iteration * (b - iteration) * x / ((qam + twice) * (a + twice));
    d = 1 + aa * d; if (Math.abs(d) < floor) d = floor; c = 1 + aa / c; if (Math.abs(c) < floor) c = floor; d = 1 / d; h *= d * c;
    aa = -(a + iteration) * (qab + iteration) * x / ((a + twice) * (qap + twice));
    d = 1 + aa * d; if (Math.abs(d) < floor) d = floor; c = 1 + aa / c; if (Math.abs(c) < floor) c = floor; d = 1 / d;
    const delta = d * c; h *= delta; if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function regularizedBeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? front * betaFraction(a, b, x) / a : 1 - front * betaFraction(b, a, 1 - x) / b;
}

function fSurvival(fStatistic, numeratorDf, denominatorDf) {
  if (!Number.isFinite(fStatistic)) return fStatistic === Infinity ? 0 : null;
  if (fStatistic < 0 || numeratorDf <= 0 || denominatorDf <= 0) return null;
  return regularizedBeta(denominatorDf / (denominatorDf + numeratorDf * fStatistic), denominatorDf / 2, numeratorDf / 2);
}

function termsFor(design, sampleCount) {
  const terms = [{ name: 'intercept', evaluate: () => 1 }];
  design.factors.forEach(factor => terms.push({ name: factor.key, evaluate: row => row[factor.key].coded }));
  if (sampleCount >= 1 + design.factors.length + (design.factors.length * (design.factors.length - 1)) / 2 + 1) {
    for (let first = 0; first < design.factors.length; first += 1) for (let second = first + 1; second < design.factors.length; second += 1) {
      const a = design.factors[first].key; const b = design.factors[second].key;
      terms.push({ name: `${a}:${b}`, evaluate: row => row[a].coded * row[b].coded });
    }
  }
  if (design.design_type === 'response_surface' && sampleCount > terms.length + design.factors.length) {
    design.factors.forEach(factor => terms.push({ name: `${factor.key}²`, evaluate: row => row[factor.key].coded ** 2 }));
  }
  return terms;
}

function fit(design, samples, response) {
  const usable = samples.filter(sample => Number.isFinite(sample.responses?.[response.key]));
  const terms = termsFor(design, usable.length);
  if (usable.length < Math.max(3, terms.length)) return { status: 'insufficient_data', observations: usable.length, required: Math.max(3, terms.length) };
  const x = usable.map(sample => terms.map(term => term.evaluate(sample.factor_settings)));
  const y = usable.map(sample => Number(sample.responses[response.key]));
  const xtx = terms.map((_, i) => terms.map((__, j) => x.reduce((sum, row) => sum + row[i] * row[j], 0) + (i === j ? 1e-9 : 0)));
  const xty = terms.map((_, i) => x.reduce((sum, row, rowIndex) => sum + row[i] * y[rowIndex], 0));
  const beta = solve(xtx, xty);
  if (!beta) return { status: 'singular_design', observations: usable.length };
  const predictions = x.map(row => row.reduce((sum, value, index) => sum + value * beta[index], 0));
  const mean = y.reduce((sum, value) => sum + value, 0) / y.length;
  const ssTotal = y.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const ssResidual = y.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
  const ssModel = Math.max(0, ssTotal - ssResidual);
  const dfModel = Math.max(1, terms.length - 1); const dfResidual = y.length - terms.length;
  const rSquared = ssTotal === 0 ? 1 : 1 - ssResidual / ssTotal;
  const fStatistic = dfResidual > 0 && ssResidual > 0 ? (ssModel / dfModel) / (ssResidual / dfResidual) : null;
  const groups = new Map();
  usable.forEach((sample, index) => {
    const key = design.factors.map(factor => sample.factor_settings[factor.key].coded).join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(y[index]);
  });
  let pureErrorSumSquares = 0; let pureErrorDf = 0;
  groups.forEach(values => {
    if (values.length < 2) return;
    const groupMean = values.reduce((sum, value) => sum + value, 0) / values.length;
    pureErrorSumSquares += values.reduce((sum, value) => sum + (value - groupMean) ** 2, 0);
    pureErrorDf += values.length - 1;
  });
  const lackOfFitDf = groups.size - terms.length;
  const lackOfFitSumSquares = Math.max(0, ssResidual - pureErrorSumSquares);
  let lackOfFitF = null; let lackOfFitP = null;
  if (pureErrorDf > 0 && lackOfFitDf > 0) {
    if (pureErrorSumSquares === 0) lackOfFitF = lackOfFitSumSquares > 0 ? Infinity : null;
    else lackOfFitF = (lackOfFitSumSquares / lackOfFitDf) / (pureErrorSumSquares / pureErrorDf);
    lackOfFitP = lackOfFitF === null ? null : fSurvival(lackOfFitF, lackOfFitDf, pureErrorDf);
  }
  return {
    status: 'fitted', observations: usable.length,
    coefficients: Object.fromEntries(terms.map((term, index) => [term.name, round(beta[index])])),
    diagnostics: { r_squared: round(rSquared), adjusted_r_squared: dfResidual > 0 ? round(1 - (1 - rSquared) * (y.length - 1) / dfResidual) : null, rmse: round(Math.sqrt(ssResidual / y.length)), residual_degrees_of_freedom: dfResidual },
    anova: { model_sum_squares: round(ssModel), residual_sum_squares: round(ssResidual), total_sum_squares: round(ssTotal), model_degrees_of_freedom: dfModel, residual_degrees_of_freedom: dfResidual, f_statistic: fStatistic === null ? null : round(fStatistic), p_value: fStatistic === null ? null : round(fSurvival(fStatistic, dfModel, dfResidual)), note: dfResidual > 0 ? 'Model p-value calculated from the F distribution; review residual assumptions before inference.' : 'Insufficient residual degrees of freedom for a model p-value.' },
    lack_of_fit: { status: pureErrorDf > 0 && lackOfFitDf > 0 ? 'available' : 'not_evaluable', pure_error_sum_squares: round(pureErrorSumSquares), pure_error_degrees_of_freedom: pureErrorDf, lack_of_fit_sum_squares: round(lackOfFitSumSquares), lack_of_fit_degrees_of_freedom: Math.max(0, lackOfFitDf), f_statistic: lackOfFitF === Infinity ? 'Infinity' : lackOfFitF === null ? null : round(lackOfFitF), p_value: lackOfFitP === null ? null : round(lackOfFitP), conclusion: pureErrorDf === 0 ? 'Replicated factor settings are required to estimate pure error.' : lackOfFitDf <= 0 ? 'Additional distinct design points are required to test lack of fit.' : lackOfFitP !== null && lackOfFitP < 0.05 ? 'Significant lack-of-fit signal; do not use this model for optimization.' : 'No significant lack-of-fit signal at alpha 0.05; residual diagnostics still require review.' },
    terms,
  };
}

function predict(model, factorSettings) {
  return Object.entries(model.coefficients).reduce((sum, [term, coefficient]) => {
    if (term === 'intercept') return sum + coefficient;
    if (term.endsWith('²')) return sum + coefficient * factorSettings[term.slice(0, -1)].coded ** 2;
    if (term.includes(':')) { const [a, b] = term.split(':'); return sum + coefficient * factorSettings[a].coded * factorSettings[b].coded; }
    return sum + coefficient * factorSettings[term].coded;
  }, 0);
}

function responseSurface(design, model) {
  if (model.status !== 'fitted') return null;
  const first = design.factors[0]; const second = design.factors[1];
  const codedLevels = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  const baseline = Object.fromEntries(design.factors.map(factor => [factor.key, setting(factor, 0)]));
  if (!second) return { kind: 'curve', x_factor: first, y_factor: null, points: codedLevels.map(level => { const settings = { ...baseline, [first.key]: setting(first, level) }; return { x: settings[first.key].value, y: null, prediction: round(predict(model, settings)) }; }) };
  return { kind: 'surface', x_factor: first, y_factor: second, points: codedLevels.flatMap(xLevel => codedLevels.map(yLevel => { const settings = { ...baseline, [first.key]: setting(first, xLevel), [second.key]: setting(second, yLevel) }; return { x: settings[first.key].value, y: settings[second.key].value, prediction: round(predict(model, settings)) }; })) };
}

export function analyzeDoeDesign(design, batches = []) {
  const runMap = new Map(design.runs.map(run => [run.id, run]));
  const samples = batches.filter(batch => batch.doe_run_id && runMap.has(batch.doe_run_id) && batch.response_values)
    .map(batch => ({ run_id: batch.doe_run_id, factor_settings: runMap.get(batch.doe_run_id).factor_settings, responses: batch.response_values, batch_id: batch.id }));
  const models = Object.fromEntries(design.responses.map(response => [response.key, fit(design, samples, response)]));
  const completed = new Set(samples.map(sample => sample.run_id));
  const remaining = design.runs.filter(run => !completed.has(run.id));
  let recommendation = null;
  if (remaining.length) {
    const primary = design.responses[0]; const model = models[primary.key];
    if (model.status === 'fitted') {
      const scored = remaining.map(run => ({ run, prediction: predict(model, run.factor_settings) }));
      scored.sort((a, b) => primary.goal === 'minimize' ? a.prediction - b.prediction : primary.goal === 'target' ? Math.abs(a.prediction - primary.target) - Math.abs(b.prediction - primary.target) : b.prediction - a.prediction);
      recommendation = { run_id: scored[0].run.id, standard_order: scored[0].run.standard_order, factor_settings: scored[0].run.factor_settings, predicted_primary_response: round(scored[0].prediction), response_key: primary.key, basis: 'fitted_recorded_data', warning: 'Screening recommendation only; execute and measure this run before making a product decision.' };
    } else {
      const next = remaining[0];
      recommendation = { run_id: next.id, standard_order: next.standard_order, factor_settings: next.factor_settings, predicted_primary_response: null, response_key: primary.key, basis: 'deterministic_design_order', warning: 'Insufficient recorded results for model-based selection; this is the next unexecuted design run.' };
    }
  }
  const publishedModels = Object.fromEntries(Object.entries(models).map(([key, model]) => [key, model.status === 'fitted' ? { ...model, surface: responseSurface(design, model), terms: undefined } : model]));
  const primaryModel = models[design.responses[0].key];
  const inferentialReady = primaryModel?.status === 'fitted' && primaryModel.lack_of_fit?.status === 'available' && primaryModel.lack_of_fit.p_value !== null && primaryModel.lack_of_fit.p_value >= 0.05;
  return { engine_version: DOE_ENGINE_VERSION, design_signature: design.signature, observation_count: samples.length, completed_run_count: completed.size, remaining_run_count: remaining.length, models: publishedModels, next_run: recommendation, applicability: { inferential_claims_allowed: Boolean(inferentialReady), reason: inferentialReady ? 'Primary model has residual degrees of freedom, replicated pure-error data and no significant lack-of-fit signal at alpha 0.05; domain review remains required.' : 'Inferential claims are blocked until replication, residual degrees of freedom and lack-of-fit checks are all adequate.' } };
}

const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function buildDoeReportCsv(design, batches = []) {
  const analysis = analyzeDoeDesign(design, batches);
  const batchByRun = new Map(batches.filter(batch => batch.doe_run_id).map(batch => [batch.doe_run_id, batch]));
  const rows = [[
    'record_type', 'design_signature', 'engine_version', 'run_id', 'standard_order', 'replicate', 'batch_id', 'batch_code', 'batch_status', 'factor_settings_json', 'response_values_json', 'analysis_json',
  ]];
  design.runs.forEach(run => {
    const batch = batchByRun.get(run.id);
    rows.push(['run', design.signature, design.engine_version, run.id, run.standard_order, run.replicate, batch?.id || '', batch?.batch_code || '', batch?.status || 'not_started', JSON.stringify(run.factor_settings), JSON.stringify(batch?.response_values || {}), '']);
  });
  Object.entries(analysis.models).forEach(([responseKey, model]) => rows.push(['model', design.signature, analysis.engine_version, '', '', '', '', '', model.status, '', '', JSON.stringify({ response_key: responseKey, ...model })]));
  if (analysis.next_run) rows.push(['next_run', design.signature, analysis.engine_version, analysis.next_run.run_id, analysis.next_run.standard_order, '', '', '', analysis.next_run.basis, JSON.stringify(analysis.next_run.factor_settings), '', JSON.stringify(analysis.next_run)]);
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
