import { analyzeStabilityProgram } from './stabilityEngine.js';

export const LABEL_STABILITY_EVIDENCE_VERSION = '1.0.0';
const DAYS_PER_LABEL_MONTH = 30;

const maximumDay = observations => Math.max(0, ...observations.map(item => Number(item.timepoint_days) || 0));

export function buildLabelStabilityEvidence({
  formulationVersionId,
  requestedShelfLifeMonths,
  programs = [],
  observations = [],
  evidenceStorageAvailable = true,
}) {
  const requestedMonths = Number(requestedShelfLifeMonths);
  const requestedDays = requestedMonths * DAYS_PER_LABEL_MONTH;
  const versionPrograms = programs.filter(item => item.formulation_version_id === formulationVersionId);
  const programIds = new Set(versionPrograms.map(item => item.id));
  const versionObservations = observations.filter(item =>
    item.formulation_version_id === formulationVersionId && programIds.has(item.program_id)
  );
  const assessedPrograms = versionPrograms.map(program => {
    const programObservations = versionObservations.filter(item => item.program_id === program.id);
    const analysis = analyzeStabilityProgram(program, programObservations);
    const protocolComplete = program.status === 'completed' && analysis.overall_status === 'complete_pass';
    return {
      program_id: program.id,
      program_name: program.name,
      declared_status: program.status,
      analysis_status: analysis.overall_status,
      observed_coverage_days: maximumDay(programObservations),
      protocol_complete_without_observed_failure: protocolComplete,
      observation_ids: programObservations.map(item => item.id),
    };
  });
  const acceptedPrograms = assessedPrograms.filter(item => item.protocol_complete_without_observed_failure);
  const observedCoverageDays = maximumDay(versionObservations);
  const validatedCoverageDays = Math.max(0, ...acceptedPrograms.map(item => item.observed_coverage_days));
  const substantiated = evidenceStorageAvailable && validatedCoverageDays >= requestedDays;
  const status = !evidenceStorageAvailable
    ? 'evidence_storage_unavailable'
    : substantiated ? 'substantiated' : 'not_substantiated';

  return {
    engine_version: LABEL_STABILITY_EVIDENCE_VERSION,
    formulation_version_id: formulationVersionId,
    requested_shelf_life: {
      months: requestedMonths,
      comparison_days: requestedDays,
      conversion_basis: `${DAYS_PER_LABEL_MONTH} days per requested label month; comparison only`,
    },
    observed_coverage_days: observedCoverageDays,
    validated_coverage_days: validatedCoverageDays,
    gap_days: Math.max(0, requestedDays - validatedCoverageDays),
    status,
    review_gate: {
      status: substantiated ? 'eligible_after_regulatory_review' : 'blocked',
      reason: substantiated
        ? 'A completed, fully observed stability protocol covers the requested duration without an observed limit failure. Regulatory review is still required.'
        : !evidenceStorageAvailable
          ? 'Stability storage is unavailable, so the requested duration cannot be substantiated.'
          : 'The requested duration exceeds completed, fully observed stability evidence for this exact formulation version.',
    },
    evidence_refs: {
      program_ids: acceptedPrograms.map(item => item.program_id),
      observation_ids: acceptedPrograms.flatMap(item => item.observation_ids),
    },
    assessed_programs: assessedPrograms,
    limitations: [
      'Coverage is based only on recorded timepoints for this exact formulation version.',
      'No shelf-life extrapolation is performed.',
      'Accelerated and real-time conditions are not treated as equivalent by this calculation.',
    ],
  };
}
