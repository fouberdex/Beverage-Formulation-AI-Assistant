from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


DocumentType = Literal["patent", "publication"]


class RawDocument(BaseModel):
    """Normalized exchange format emitted by every public-source connector."""

    id: str
    source: str
    document_type: DocumentType
    external_id: str
    title: str
    publication_date: date | None = None
    language: str | None = None
    country: str | None = None
    doi: str | None = None
    url: HttpUrl | None = None
    open_access_url: HttpUrl | None = None
    ipc_classes: list[str] = Field(default_factory=list)
    cpc_classes: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    sections: dict[str, str] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    ingested_at: datetime = Field(default_factory=lambda: datetime.now().astimezone())

    @field_validator("sections")
    @classmethod
    def discard_empty_sections(cls, value: dict[str, str]) -> dict[str, str]:
        return {name: text for name, text in value.items() if text and text.strip()}

    @classmethod
    def stable_id(cls, source: str, external_id: str) -> str:
        value = f"{source}:{external_id}".encode("utf-8")
        return hashlib.sha256(value).hexdigest()[:32]

    def json_line(self) -> str:
        return self.model_dump_json(exclude_none=True)


class Chunk(BaseModel):
    id: str
    document_id: str
    source: str
    document_type: DocumentType
    external_id: str
    title: str
    section: str
    position: int
    text: str
    publication_date: date | None = None
    language: str | None = None
    country: str | None = None
    doi: str | None = None
    url: str | None = None
    ipc_classes: list[str] = Field(default_factory=list)
    cpc_classes: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def stable_id(cls, document_id: str, section: str, position: int, text: str) -> str:
        digest = hashlib.sha256(
            f"{document_id}:{section}:{position}:{text}".encode("utf-8")
        ).hexdigest()
        return str(uuid.UUID(digest[:32]))

    def citation_label(self) -> str:
        if self.document_type == "patent":
            return self.external_id
        if self.doi:
            return f"DOI: {self.doi}"
        return self.title

    def json_line(self) -> str:
        return self.model_dump_json(exclude_none=True)


class RetrievedChunk(BaseModel):
    chunk: Chunk
    score: float


class SourceReference(BaseModel):
    citation_id: str
    label: str
    title: str
    source: str
    section: str
    url: str | None = None
    score: float


class RagDiagnostics(BaseModel):
    status: Literal["no_results", "evidence_gap", "generated", "quality_failure"]
    retrieved_chunks: int = 0
    evidence_chunks: int = 0
    max_reranker_score: float | None = None
    retrieval_attempts: int = 0
    required_mechanisms: list[str] = Field(default_factory=list)
    missing_mechanisms: list[str] = Field(default_factory=list)
    generation_invoked: bool = False
    generation_attempts: int = 0


class DiagnosticCandidate(BaseModel):
    chunk_id: str
    document_id: str
    title: str
    score: float


class QueryDiagnosticTrace(BaseModel):
    query_id: str
    parent_query_id: str | None = None
    query_kind: Literal[
        "original",
        "canonical",
        "llm_decomposition",
        "source_balancing",
        "mechanism_retry",
        "dynamic_claim_verification",
        "rewrite",
    ]
    attempt: int
    query_text: str | None = None
    query_hash: str
    source_filter: str | None = None
    hybrid_candidate_count: int
    reranked_count: int
    best_reranker_score: float | None = None
    reranker_threshold: float
    reranker_margin: float | None = None
    independent_sources: int = 0
    category: Literal[
        "no_candidates",
        "far_below_threshold",
        "near_threshold",
        "above_threshold_no_mechanism_match",
        "eligible",
    ]
    score_basis: str
    top_candidates: list[DiagnosticCandidate] = Field(default_factory=list)
    error: str | None = None


class MechanismDiagnosticTrace(BaseModel):
    mechanism_id: str
    mechanism_label: str
    attempt: int
    matching_chunks: int
    mechanism_match: bool
    best_reranker_score: float | None = None
    reranker_threshold: float
    reranker_margin: float | None = None
    independent_sources: int
    required_independent_sources: int
    source_deficit: int
    calculated_score: int
    required_calculated_score: int
    proof_margin: int
    category: Literal[
        "no_candidates",
        "far_below_threshold",
        "near_threshold",
        "above_threshold_no_mechanism_match",
        "eligible",
    ]
    blocking_condition: str | None = None


class RetrievalAttemptDiagnostic(BaseModel):
    attempt: int
    queries: list[QueryDiagnosticTrace] = Field(default_factory=list)
    mechanisms: list[MechanismDiagnosticTrace] = Field(default_factory=list)


class RagDiagnosticReport(BaseModel):
    schema_version: int = 1
    request_id: str
    created_at: str
    question_hash: str
    question_text: str | None = None
    config_file: str
    near_threshold_margin: float
    attempts: list[RetrievalAttemptDiagnostic] = Field(default_factory=list)
    final_decision: Literal[
        "no_candidates",
        "evidence_gap",
        "evidence_available",
        "unmapped_question",
        "quality_failure",
        "generated",
    ]
    rewrite_attempted: bool = False
    rewrite_changed_decision: bool | None = None
    errors: list[str] = Field(default_factory=list)


class RagAnswer(BaseModel):
    answer: str
    sources: list[SourceReference]
    retrieved_candidates: list[SourceReference] = Field(default_factory=list)
    diagnostics: RagDiagnostics | None = None


def read_jsonl(path: Path, model: type[BaseModel]) -> list[Any]:
    records: list[Any] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                records.append(model.model_validate_json(line))
            except Exception as exc:
                raise ValueError(f"Invalid JSONL record at {path}:{line_number}") from exc
    return records


def write_jsonl(path: Path, records: list[BaseModel]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(record.model_dump_json(exclude_none=True) + "\n")
    temporary.replace(path)


def write_manifest(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
