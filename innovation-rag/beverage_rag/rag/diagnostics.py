from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import yaml

from beverage_rag.rag.evidence import (
    EvidencePolicy,
    MechanismRule,
    assess_mechanism_evidence,
    independent_source_key,
)
from beverage_rag.schemas import (
    DiagnosticCandidate,
    MechanismDiagnosticTrace,
    QueryDiagnosticTrace,
    RagDiagnosticReport,
    RetrievalAttemptDiagnostic,
    RetrievedChunk,
)


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class DiagnosticPolicy:
    enabled: bool
    log_path: Path
    include_question_text_in_production: bool
    include_query_text_in_production: bool
    near_threshold_margin: float
    max_bytes: int
    backup_count: int
    retention_days: int
    automatic_query_rewrite_enabled: bool
    maximum_extra_attempts: int

    @classmethod
    def load(cls, path: Path) -> "DiagnosticPolicy":
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        rotation = payload.get("rotation", {})
        rewrite = payload.get("automatic_query_rewrite", {})
        log_path = Path(payload.get("log_path", "data/diagnostics/rag-evidence.jsonl"))
        if not log_path.is_absolute():
            log_path = (path.parent.parent / log_path).resolve()
        policy = cls(
            enabled=bool(payload.get("enabled", True)),
            log_path=log_path,
            include_question_text_in_production=bool(
                payload.get("include_question_text_in_production", False)
            ),
            include_query_text_in_production=bool(
                payload.get("include_query_text_in_production", False)
            ),
            near_threshold_margin=float(payload.get("near_threshold_margin", 0.05)),
            max_bytes=int(rotation.get("max_bytes", 26_214_400)),
            backup_count=int(rotation.get("backup_count", 5)),
            retention_days=int(rotation.get("retention_days", 30)),
            automatic_query_rewrite_enabled=bool(rewrite.get("enabled", False)),
            maximum_extra_attempts=int(rewrite.get("maximum_extra_attempts", 1)),
        )
        if not 0 <= policy.near_threshold_margin <= 1:
            raise ValueError("near_threshold_margin must be between 0 and 1")
        if policy.maximum_extra_attempts > 1:
            raise ValueError("At most one automatic rewrite attempt is permitted")
        return policy


class DiagnosticCollector:
    def __init__(
        self,
        question: str,
        config_file: str,
        policy: DiagnosticPolicy,
        evidence_policy: EvidencePolicy,
        *,
        include_question_text: bool,
        include_query_text: bool,
    ) -> None:
        self.question = question
        self.config_file = config_file
        self.policy = policy
        self.evidence_policy = evidence_policy
        self.include_question_text = include_question_text
        self.include_query_text = include_query_text
        self.request_id = str(uuid4())
        self.created_at = datetime.now(timezone.utc).isoformat()
        self._attempts: dict[int, RetrievalAttemptDiagnostic] = {}
        self.errors: list[str] = []

    @property
    def latest_attempt(self) -> int:
        return max(self._attempts, default=1)

    def _attempt(self, attempt: int) -> RetrievalAttemptDiagnostic:
        return self._attempts.setdefault(
            attempt, RetrievalAttemptDiagnostic(attempt=attempt)
        )

    def record_query(
        self,
        *,
        attempt: int,
        query_kind: str,
        query_text: str,
        candidates: list[RetrievedChunk],
        reranked: list[RetrievedChunk],
        score_basis: str,
        source_filter: str | None = None,
        parent_query_id: str | None = None,
        error: str | None = None,
    ) -> None:
        candidate_ids = {item.chunk.id for item in candidates}
        relevant_reranked = [
            item for item in reranked if item.chunk.id in candidate_ids
        ]
        best = max((item.score for item in relevant_reranked), default=None)
        threshold = self.evidence_policy.gap_max_score
        margin = None if best is None else best - threshold
        if not candidates:
            category = "no_candidates"
        elif best is None or best < threshold - self.policy.near_threshold_margin:
            category = "far_below_threshold"
        elif best < threshold:
            category = "near_threshold"
        else:
            category = "eligible"
        supporting = [
            item
            for item in relevant_reranked
            if item.score >= self.evidence_policy.supporting_source_min_score
        ]
        independent_sources = len(
            {independent_source_key(item) for item in supporting}
        )
        query_id = f"a{attempt}-q{len(self._attempt(attempt).queries) + 1}"
        self._attempt(attempt).queries.append(
            QueryDiagnosticTrace(
                query_id=query_id,
                parent_query_id=parent_query_id,
                query_kind=query_kind,
                attempt=attempt,
                query_text=query_text if self.include_query_text else None,
                query_hash=stable_hash(query_text),
                source_filter=source_filter,
                hybrid_candidate_count=len(candidates),
                reranked_count=len(relevant_reranked),
                best_reranker_score=best,
                reranker_threshold=threshold,
                reranker_margin=margin,
                independent_sources=independent_sources,
                category=category,
                score_basis=score_basis,
                top_candidates=[
                    DiagnosticCandidate(
                        chunk_id=item.chunk.id,
                        document_id=item.chunk.document_id,
                        title=item.chunk.title,
                        score=item.score,
                    )
                    for item in relevant_reranked[:5]
                ],
                error=error,
            )
        )

    def record_mechanisms(
        self,
        attempt: int,
        rules: list[MechanismRule],
        results: list[RetrievedChunk],
    ) -> None:
        traces: list[MechanismDiagnosticTrace] = []
        overall_best = max((item.score for item in results), default=None)
        moderate = self.evidence_policy.moderate
        required_sources = int(moderate["minimum_independent_sources"])
        required_score = int(moderate["minimum_calculated_score"])
        for rule in rules:
            assessment = assess_mechanism_evidence(
                rule, results, self.evidence_policy, self.question
            )
            best = assessment.best_reranker_score
            margin = None if best is None else best - self.evidence_policy.gap_max_score
            if not results:
                category = "no_candidates"
            elif not assessment.mechanism_match and (
                overall_best is not None
                and overall_best >= self.evidence_policy.gap_max_score
            ):
                category = "above_threshold_no_mechanism_match"
            elif best is None or best < (
                self.evidence_policy.gap_max_score
                - self.policy.near_threshold_margin
            ):
                category = "far_below_threshold"
            elif best < self.evidence_policy.gap_max_score:
                category = "near_threshold"
            else:
                category = "eligible"
            traces.append(
                MechanismDiagnosticTrace(
                    mechanism_id=rule.mechanism_id,
                    mechanism_label=rule.label,
                    attempt=attempt,
                    matching_chunks=assessment.matching_chunks,
                    mechanism_match=assessment.mechanism_match,
                    best_reranker_score=best,
                    reranker_threshold=self.evidence_policy.gap_max_score,
                    reranker_margin=margin,
                    independent_sources=assessment.independent_sources,
                    required_independent_sources=required_sources,
                    source_deficit=assessment.independent_sources - required_sources,
                    calculated_score=assessment.calculated_score,
                    required_calculated_score=required_score,
                    proof_margin=assessment.calculated_score - required_score,
                    category=category,
                    blocking_condition=assessment.blocking_condition,
                )
            )
        self._attempt(attempt).mechanisms = traces

    def finish(self, final_decision: str) -> RagDiagnosticReport:
        return RagDiagnosticReport(
            request_id=self.request_id,
            created_at=self.created_at,
            question_hash=stable_hash(self.question),
            question_text=self.question if self.include_question_text else None,
            config_file=self.config_file,
            near_threshold_margin=self.policy.near_threshold_margin,
            attempts=[self._attempts[key] for key in sorted(self._attempts)],
            final_decision=final_decision,
            rewrite_attempted=False,
            rewrite_changed_decision=None,
            errors=self.errors,
        )


class DiagnosticJsonlWriter:
    def __init__(self, policy: DiagnosticPolicy) -> None:
        self.policy = policy

    def write(self, report: RagDiagnosticReport) -> None:
        path = self.policy.log_path
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = report.model_dump_json(exclude_none=True) + "\n"
        self._purge_expired(path)
        if path.exists() and path.stat().st_size + len(payload.encode("utf-8")) > self.policy.max_bytes:
            self._rotate(path)
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)

    def _rotate(self, path: Path) -> None:
        oldest = path.with_name(f"{path.name}.{self.policy.backup_count}")
        if oldest.exists():
            oldest.unlink()
        for index in range(self.policy.backup_count - 1, 0, -1):
            source = path.with_name(f"{path.name}.{index}")
            if source.exists():
                os.replace(source, path.with_name(f"{path.name}.{index + 1}"))
        if path.exists() and self.policy.backup_count:
            os.replace(path, path.with_name(f"{path.name}.1"))

    def _purge_expired(self, path: Path) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=self.policy.retention_days)
        for candidate in path.parent.glob(f"{path.name}.*"):
            modified = datetime.fromtimestamp(candidate.stat().st_mtime, timezone.utc)
            if modified < cutoff:
                candidate.unlink()
