const LANCZOS_COEFFICIENTS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + ((sorted[lower + 1] - sorted[lower]) * fraction);
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function tCritical95(degreesOfFreedom) {
  if (degreesOfFreedom <= 0) return null;
  const exact = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
  if (degreesOfFreedom <= 10) return exact[degreesOfFreedom];
  const z = 1.959963984540054;
  const df = degreesOfFreedom;
  return z
    + ((z ** 3) + z) / (4 * df)
    + ((5 * (z ** 5)) + (16 * (z ** 3)) + (3 * z)) / (96 * (df ** 2))
    + ((3 * (z ** 7)) + (19 * (z ** 5)) + (17 * (z ** 3)) - (15 * z)) / (384 * (df ** 3));
}

function confidenceInterval(values, minimum, maximum) {
  const average = mean(values);
  const deviation = sampleStandardDeviation(values);
  if (average === null || deviation === null) return null;
  const margin = tCritical95(values.length - 1) * deviation / Math.sqrt(values.length);
  return { lower: round(Math.max(minimum, average - margin)), upper: round(Math.min(maximum, average + margin)) };
}

function logGamma(value) {
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.99999999999980993;
  const adjusted = value - 1;
  LANCZOS_COEFFICIENTS.forEach((coefficient, index) => { x += coefficient / (adjusted + index + 1); });
  const t = adjusted + LANCZOS_COEFFICIENTS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + ((adjusted + 0.5) * Math.log(t)) - t + Math.log(x);
}

function betaContinuedFraction(a, b, x) {
  const maxIterations = 200;
  const epsilon = 3e-10;
  const floor = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x / qap);
  if (Math.abs(d) < floor) d = floor;
  d = 1 / d;
  let result = d;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const doubled = 2 * iteration;
    let coefficient = iteration * (b - iteration) * x / ((qam + doubled) * (a + doubled));
    d = 1 + (coefficient * d); if (Math.abs(d) < floor) d = floor;
    c = 1 + (coefficient / c); if (Math.abs(c) < floor) c = floor;
    d = 1 / d; result *= d * c;
    coefficient = -((a + iteration) * (qab + iteration) * x) / ((a + doubled) * (qap + doubled));
    d = 1 + (coefficient * d); if (Math.abs(d) < floor) d = floor;
    c = 1 + (coefficient / c); if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return result;
}

function regularizedBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + (a * Math.log(x)) + (b * Math.log(1 - x)));
  return x < ((a + 1) / (a + b + 2))
    ? factor * betaContinuedFraction(a, b, x) / a
    : 1 - (factor * betaContinuedFraction(b, a, 1 - x) / b);
}

function fSurvivalProbability(fStatistic, dfBetween, dfWithin) {
  if (!Number.isFinite(fStatistic)) return fStatistic === Infinity ? 0 : null;
  if (fStatistic <= 0) return 1;
  const x = (dfBetween * fStatistic) / ((dfBetween * fStatistic) + dfWithin);
  return Math.max(0, Math.min(1, 1 - regularizedBeta(x, dfBetween / 2, dfWithin / 2)));
}

function regularizedGammaQ(shape, value) {
  if (value < 0 || shape <= 0) return null;
  if (value === 0) return 1;
  const epsilon = 1e-14;
  const maxIterations = 200;
  if (value < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    let denominator = shape;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      denominator += 1;
      term *= value / denominator;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * epsilon) break;
    }
    const lower = sum * Math.exp(-value + (shape * Math.log(value)) - logGamma(shape));
    return Math.max(0, Math.min(1, 1 - lower));
  }
  let b = value + 1 - shape;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let result = d;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const coefficient = -iteration * (iteration - shape);
    b += 2;
    d = (coefficient * d) + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + (coefficient / c);
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-value + (shape * Math.log(value)) - logGamma(shape)) * result));
}

function averageRanks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  let tieAdjustment = 0;
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const averageRank = ((start + 1) + end) / 2;
    for (let index = start; index < end; index++) ranks[sorted[index].index] = averageRank;
    const tieSize = end - start;
    if (tieSize > 1) tieAdjustment += (tieSize ** 3) - tieSize;
    start = end;
  }
  return { ranks, tieAdjustment };
}

function descriptiveInference(reason, design, warnings = []) {
  return {
    method: 'descriptive_only', design, valid_for_inference: false, reason,
    statistic_name: null, statistic: null, p_value: null, effect_size: null,
    assumptions: [], warnings, significant_at_0_05: false,
    f_statistic: null, infinite_f: false, df_between: null, df_within: null, eta_squared: null,
    friedman: null,
  };
}

function calculateRepeatedMeasuresInference(study, responses, attribute) {
  const sampleIds = study.samples.map(sample => sample.id);
  if (sampleIds.length < 2) return descriptiveInference('At least two samples are required for comparative inference.', 'single_sample');
  if (responses.length < 2) return descriptiveInference('At least two complete panelist blocks are required for repeated-measures inference.', 'insufficient_repeated_measures');
  if (new Set(responses.map(response => String(response.panelist_code).toLowerCase())).size !== responses.length) {
    return descriptiveInference('Panelist codes are not unique, so independent blocks cannot be identified.', 'invalid_repeated_measures');
  }
  const rows = responses.map(response => {
    const valuesBySample = new Map();
    let duplicate = false;
    for (const sample of response.samples || []) {
      if (!sampleIds.includes(sample.sample_id)) continue;
      if (valuesBySample.has(sample.sample_id)) duplicate = true;
      valuesBySample.set(sample.sample_id, sample.scores?.[attribute.key]);
    }
    const values = sampleIds.map(id => valuesBySample.get(id));
    return { duplicate, values, complete: !duplicate && values.every(Number.isFinite) };
  });
  const completeBlocks = rows.filter(row => row.complete).length;
  if (completeBlocks !== responses.length) {
    return descriptiveInference(
      `Only ${completeBlocks} of ${responses.length} panelist blocks contain one finite ${attribute.label} score for every sample. A mixed-effects model is required for valid unbalanced inference.`,
      'incomplete_or_unbalanced_repeated_measures',
      ['No p-value or statistical-significance claim is produced for incomplete repeated measures.'],
    );
  }

  const matrix = rows.map(row => row.values.map(Number));
  const blockCount = matrix.length;
  const treatmentCount = sampleIds.length;
  const allValues = matrix.flat();
  const grandMean = mean(allValues);
  const treatmentMeans = sampleIds.map((_, column) => mean(matrix.map(row => row[column])));
  const blockMeans = matrix.map(row => mean(row));
  const totalSumSquares = allValues.reduce((sum, value) => sum + ((value - grandMean) ** 2), 0);
  const treatmentSumSquares = blockCount * treatmentMeans.reduce((sum, value) => sum + ((value - grandMean) ** 2), 0);
  const blockSumSquares = treatmentCount * blockMeans.reduce((sum, value) => sum + ((value - grandMean) ** 2), 0);
  const errorSumSquares = Math.max(0, totalSumSquares - treatmentSumSquares - blockSumSquares);
  const treatmentDf = treatmentCount - 1;
  const errorDf = (treatmentCount - 1) * (blockCount - 1);
  const treatmentMeanSquare = treatmentSumSquares / treatmentDf;
  const errorMeanSquare = errorSumSquares / errorDf;
  const fStatistic = errorMeanSquare === 0 ? (treatmentMeanSquare === 0 ? 0 : Infinity) : treatmentMeanSquare / errorMeanSquare;
  const pValue = fSurvivalProbability(fStatistic, treatmentDf, errorDf);
  const partialEtaSquared = treatmentSumSquares + errorSumSquares > 0 ? treatmentSumSquares / (treatmentSumSquares + errorSumSquares) : 0;
  const parametricValid = blockCount >= 5;

  const rankedRows = matrix.map(averageRanks);
  const rankSums = sampleIds.map((_, column) => rankedRows.reduce((sum, row) => sum + row.ranks[column], 0));
  const uncorrectedFriedman = (12 / (blockCount * treatmentCount * (treatmentCount + 1)))
    * rankSums.reduce((sum, value) => sum + (value ** 2), 0) - (3 * blockCount * (treatmentCount + 1));
  const tieDenominator = blockCount * ((treatmentCount ** 3) - treatmentCount);
  const tieCorrection = 1 - (rankedRows.reduce((sum, row) => sum + row.tieAdjustment, 0) / tieDenominator);
  const friedmanStatistic = tieCorrection > 0 ? uncorrectedFriedman / tieCorrection : 0;
  const friedmanP = regularizedGammaQ((treatmentCount - 1) / 2, friedmanStatistic / 2);
  const friedmanValid = blockCount >= 5;
  const smallPanelWarning = blockCount < 5 ? ['Fewer than five complete blocks; asymptotic Friedman inference is not reported as valid.'] : [];

  return {
    method: 'randomized_complete_block_anova',
    design: 'complete_balanced_repeated_measures',
    valid_for_inference: parametricValid,
    reason: parametricValid
      ? `Every one of ${blockCount} panelists evaluated every sample once for this attribute; panelist is modeled as a block.`
      : `The ${blockCount} complete panelist blocks are too few for a supported inferential claim; statistics remain exploratory.`,
    statistic_name: 'F',
    statistic: fStatistic === Infinity ? null : round(fStatistic),
    p_value: parametricValid ? round(pValue, 5) : null,
    effect_size: { name: 'partial_eta_squared', value: round(partialEtaSquared) },
    assumptions: ['Independent panelists', 'Additive panelist and sample effects', 'Approximately normal residuals', treatmentCount === 2 ? 'Sphericity is automatic for two samples' : 'Sphericity is assumed and not tested'],
    warnings: [
      ...(parametricValid ? [] : ['At least five complete panelist blocks are required before p-values are reported.']),
      ...(treatmentCount > 2 ? ['Review the sphericity assumption before confirmatory use.'] : []),
    ],
    f_statistic: fStatistic === Infinity ? null : round(fStatistic),
    infinite_f: fStatistic === Infinity,
    df_between: treatmentDf,
    df_within: errorDf,
    eta_squared: round(partialEtaSquared),
    significant_at_0_05: parametricValid && pValue !== null && pValue < 0.05,
    friedman: {
      method: 'friedman_test', design: 'complete_balanced_repeated_measures', valid_for_inference: friedmanValid,
      reason: friedmanValid ? 'Non-parametric repeated-measures comparison using within-panelist ranks.' : 'The chi-square approximation is not considered reliable with fewer than five complete blocks.',
      statistic_name: 'chi_squared', statistic: round(friedmanStatistic), p_value: friedmanValid ? round(friedmanP, 5) : null,
      effect_size: { name: 'kendalls_w', value: round(friedmanStatistic / (blockCount * (treatmentCount - 1))) },
      assumptions: ['Independent panelists', 'Ordinal or continuous responses', 'Complete matched blocks'], warnings: smallPanelWarning,
      significant_at_0_05: friedmanValid && friedmanP !== null && friedmanP < 0.05,
    },
  };
}

function summarize(values, scale) {
  const average = mean(values);
  return {
    count: values.length,
    mean: round(average),
    median: round(quantile(values, 0.5)),
    standard_deviation: round(sampleStandardDeviation(values)),
    minimum: values.length ? round(Math.min(...values)) : null,
    maximum: values.length ? round(Math.max(...values)) : null,
    confidence_interval_95: confidenceInterval(values, scale.minimum, scale.maximum),
  };
}

function pearson(pairs) {
  if (pairs.length < 3) return null;
  const xMean = mean(pairs.map(pair => pair[0]));
  const yMean = mean(pairs.map(pair => pair[1]));
  const numerator = pairs.reduce((sum, pair) => sum + ((pair[0] - xMean) * (pair[1] - yMean)), 0);
  const xDenominator = Math.sqrt(pairs.reduce((sum, pair) => sum + ((pair[0] - xMean) ** 2), 0));
  const yDenominator = Math.sqrt(pairs.reduce((sum, pair) => sum + ((pair[1] - yMean) ** 2), 0));
  return xDenominator && yDenominator ? numerator / (xDenominator * yDenominator) : null;
}

function makeBins(scale, values) {
  const width = (scale.maximum - scale.minimum) / 5;
  return Array.from({ length: 5 }, (_, index) => {
    const lower = scale.minimum + (index * width);
    const upper = index === 4 ? scale.maximum : lower + width;
    return {
      label: `${round(lower, 1)}–${round(upper, 1)}`,
      count: values.filter(value => value >= lower && (index === 4 ? value <= upper : value < upper)).length,
    };
  });
}

function calculateAnova(groups) {
  const populated = groups.filter(group => group.values.length > 0);
  const allValues = populated.flatMap(group => group.values);
  if (populated.length < 2 || allValues.length <= populated.length) return null;
  const grandMean = mean(allValues);
  const between = populated.reduce((sum, group) => sum + (group.values.length * ((mean(group.values) - grandMean) ** 2)), 0);
  const within = populated.reduce((sum, group) => {
    const groupMean = mean(group.values);
    return sum + group.values.reduce((inner, value) => inner + ((value - groupMean) ** 2), 0);
  }, 0);
  const dfBetween = populated.length - 1;
  const dfWithin = allValues.length - populated.length;
  const fStatistic = within === 0 ? (between === 0 ? 0 : Infinity) : (between / dfBetween) / (within / dfWithin);
  const pValue = fSurvivalProbability(fStatistic, dfBetween, dfWithin);
  const total = between + within;
  return {
    f_statistic: fStatistic === Infinity ? null : round(fStatistic),
    infinite_f: fStatistic === Infinity,
    p_value: round(pValue, 5),
    df_between: dfBetween,
    df_within: dfWithin,
    eta_squared: total ? round(between / total) : 0,
    significant_at_0_05: pValue !== null && pValue < 0.05,
  };
}

function overallAttributeKey(study) {
  return study.attributes.find(attribute => attribute.category === 'overall')?.key
    || study.attributes.find(attribute => ['overall_liking', 'overall_acceptance'].includes(attribute.key))?.key
    || study.attributes.at(-1)?.key;
}

export function analyzeSensoryStudy(study, responses = []) {
  const scale = { minimum: study.scale_min ?? 0, maximum: study.scale_max ?? 10 };
  const overallKey = overallAttributeKey(study);
  const evaluations = responses.flatMap(response => (response.samples || []).map(sample => ({
    response_id: response.id,
    panelist_code: response.panelist_code,
    segment: response.segment || 'Unspecified',
    duration_seconds: response.session?.duration_seconds,
    sample_id: sample.sample_id,
    scores: sample.scores || {},
    jar: sample.jar || {},
    purchase_intent: sample.purchase_intent,
    preference_rank: sample.preference_rank,
  })));
  const sampleMap = new Map(study.samples.map(sample => [sample.id, sample]));
  const sampleSummaries = study.samples.map(sample => {
    const sampleEvaluations = evaluations.filter(evaluation => evaluation.sample_id === sample.id);
    const attributes = study.attributes.map(attribute => {
      const observations = sampleEvaluations
        .filter(evaluation => Number.isFinite(evaluation.scores[attribute.key]))
        .map(evaluation => ({ value: evaluation.scores[attribute.key], panelist_code: evaluation.panelist_code, response_id: evaluation.response_id }));
      const values = observations.map(observation => observation.value);
      const q1 = quantile(values, 0.25);
      const q3 = quantile(values, 0.75);
      const iqr = q1 === null || q3 === null ? null : q3 - q1;
      const lower = values.length >= 4 ? q1 - (1.5 * iqr) : null;
      const upper = values.length >= 4 ? q3 + (1.5 * iqr) : null;
      return {
        key: attribute.key,
        label: attribute.label,
        category: attribute.category,
        ...summarize(values, scale),
        missing: sampleEvaluations.length - values.length,
        distribution: makeBins(scale, values),
        outliers: lower === null ? [] : observations.filter(observation => observation.value < lower || observation.value > upper).map(observation => ({
          ...observation,
          sample_id: sample.id,
          attribute_key: attribute.key,
          reason: `Outside Tukey fences (${round(lower)}–${round(upper)})`,
        })),
      };
    });
    const overall = attributes.find(attribute => attribute.key === overallKey);
    const purchaseIntentValues = sampleEvaluations.map(evaluation => evaluation.purchase_intent).filter(Number.isFinite);
    const preferenceRankValues = sampleEvaluations.map(evaluation => evaluation.preference_rank).filter(Number.isFinite);
    return {
      sample_id: sample.id,
      sample_code: sample.sample_code,
      blind_code: sample.blind_code,
      label: sample.label,
      response_count: sampleEvaluations.length,
      overall: overall || summarize([], scale),
      purchase_intent: summarize(purchaseIntentValues, { minimum: 1, maximum: 5 }),
      preference_rank: summarize(preferenceRankValues, { minimum: 1, maximum: study.samples.length }),
      attributes,
    };
  });

  const anova = study.attributes.map(attribute => ({
    attribute_key: attribute.key,
    attribute_label: attribute.label,
    result: calculateRepeatedMeasuresInference(study, responses, attribute),
  }));

  const correlations = study.attributes.flatMap(rowAttribute => study.attributes.map(columnAttribute => {
    const pairs = evaluations.filter(evaluation => Number.isFinite(evaluation.scores[rowAttribute.key]) && Number.isFinite(evaluation.scores[columnAttribute.key]))
      .map(evaluation => [evaluation.scores[rowAttribute.key], evaluation.scores[columnAttribute.key]]);
    return { row: rowAttribute.key, column: columnAttribute.key, value: rowAttribute.key === columnAttribute.key ? 1 : round(pearson(pairs)), count: pairs.length };
  }));

  const jarDimensions = [...new Set(evaluations.flatMap(evaluation => Object.keys(evaluation.jar)))];
  const jarPenalty = study.samples.flatMap(sample => jarDimensions.flatMap(dimension => {
    const relevant = evaluations.filter(evaluation => evaluation.sample_id === sample.id && Number.isFinite(evaluation.jar[dimension]) && Number.isFinite(evaluation.scores[overallKey]));
    const jar = relevant.filter(evaluation => evaluation.jar[dimension] === 0).map(evaluation => evaluation.scores[overallKey]);
    return [
      { direction: 'too_low', values: relevant.filter(evaluation => evaluation.jar[dimension] < 0).map(evaluation => evaluation.scores[overallKey]) },
      { direction: 'too_high', values: relevant.filter(evaluation => evaluation.jar[dimension] > 0).map(evaluation => evaluation.scores[overallKey]) },
    ].map(group => ({
      sample_id: sample.id,
      dimension,
      direction: group.direction,
      count: group.values.length,
      percent: relevant.length ? round((group.values.length / relevant.length) * 100, 1) : 0,
      mean_drop: jar.length && group.values.length ? round(mean(jar) - mean(group.values)) : null,
      actionable: relevant.length >= 10 && (group.values.length / relevant.length) >= 0.2 && jar.length > 0 && group.values.length > 0 && (mean(jar) - mean(group.values)) >= 1,
    }));
  }));

  const segments = [...new Set(responses.map(response => response.segment || 'Unspecified'))].flatMap(segment => study.samples.map(sample => {
    const values = evaluations.filter(evaluation => evaluation.segment === segment && evaluation.sample_id === sample.id && Number.isFinite(evaluation.scores[overallKey])).map(evaluation => evaluation.scores[overallKey]);
    return { segment, sample_id: sample.id, count: values.length, mean: round(mean(values)) };
  }));

  const expectedEvaluations = responses.length * study.samples.length;
  const expectedScores = expectedEvaluations * study.attributes.length;
  const observedScores = evaluations.reduce((sum, evaluation) => sum + study.attributes.filter(attribute => Number.isFinite(evaluation.scores[attribute.key])).length, 0);
  const qualityFlags = [];
  for (const response of responses) {
    const completedSamples = new Set((response.samples || []).map(sample => sample.sample_id));
    if (completedSamples.size < study.samples.length) qualityFlags.push({ type: 'incomplete_samples', panelist_code: response.panelist_code, message: `${study.samples.length - completedSamples.size} sample(s) missing.` });
    if (Number.isFinite(response.session?.duration_seconds) && response.session.duration_seconds < 60) qualityFlags.push({ type: 'rapid_completion', panelist_code: response.panelist_code, message: `Completed in ${response.session.duration_seconds} seconds; verify protocol adherence.` });
    for (const sample of response.samples || []) {
      const values = study.attributes.map(attribute => sample.scores?.[attribute.key]).filter(Number.isFinite);
      if (values.length >= 4 && new Set(values).size === 1) qualityFlags.push({ type: 'straightlining', panelist_code: response.panelist_code, sample_id: sample.sample_id, message: 'Identical scores across every completed attribute.' });
    }
  }

  const outliers = sampleSummaries.flatMap(sample => sample.attributes.flatMap(attribute => attribute.outliers.map(outlier => ({
    ...outlier,
    sample_label: sampleMap.get(sample.sample_id)?.label,
    attribute_label: attribute.label,
  }))));
  const ranking = [...sampleSummaries].sort((a, b) => (b.overall.mean ?? -Infinity) - (a.overall.mean ?? -Infinity));
  const warnings = [];
  if (responses.length < 5) warnings.push({ code: 'small_panel', message: 'Fewer than five completed panelist responses are available; inferential results are unstable.' });
  if (study.samples.length < 2) warnings.push({ code: 'single_sample', message: 'Add at least two samples for comparative analysis.' });
  if (observedScores < expectedScores) warnings.push({ code: 'missing_scores', message: `${expectedScores - observedScores} expected attribute score(s) are missing.` });

  return {
    generated_at: new Date().toISOString(),
    methodology: {
      observation_unit: 'panelist_sample_evaluation',
      confidence_intervals: 'Two-sided 95% Student t intervals.',
      inference: 'Complete balanced panels use randomized complete block ANOVA with panelist as block plus a Friedman sensitivity analysis. Incomplete or unbalanced repeated measures remain descriptive only.',
      outliers: 'Tukey 1.5×IQR flags; observations remain included.',
      jar_penalty: 'Mean overall-liking drop versus JAR respondents; actionable threshold requires n≥10, ≥20% affected, and ≥1 point mean drop.',
    },
    coverage: {
      response_count: responses.length,
      evaluation_count: evaluations.length,
      expected_evaluations: expectedEvaluations,
      score_completion_percent: expectedScores ? round((observedScores / expectedScores) * 100, 1) : 0,
      segment_count: new Set(responses.map(response => response.segment || 'Unspecified')).size,
    },
    overall_attribute_key: overallKey,
    samples: sampleSummaries,
    ranking,
    anova,
    correlations,
    jar_penalty: jarPenalty,
    segments,
    quality: { flags: qualityFlags, outliers },
    warnings,
  };
}

export { calculateAnova, fSurvivalProbability };
