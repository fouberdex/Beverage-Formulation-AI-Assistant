from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from typing import Literal

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field, model_validator


class PatentScope(BaseModel):
    countries: list[str] = Field(default_factory=list)
    ipc_prefixes: list[str] = Field(default_factory=list)
    cpc_prefixes: list[str] = Field(default_factory=list)
    include_description: bool = True


class ScopeSettings(BaseModel):
    domain: str
    themes: dict[str, list[str]]
    languages: list[str] = Field(default_factory=lambda: ["en"])
    date_from: date
    date_to: date
    patents: PatentScope

    @model_validator(mode="after")
    def check_dates_and_keywords(self) -> "ScopeSettings":
        if self.date_from > self.date_to:
            raise ValueError("scope.date_from must precede scope.date_to")
        if not any(self.themes.values()):
            raise ValueError("At least one configured keyword is required")
        return self

    @property
    def keywords(self) -> list[str]:
        return list(dict.fromkeys(word for words in self.themes.values() for word in words))


class IngestionSettings(BaseModel):
    enabled_sources: list[str]
    pilot_limit_total: int = Field(gt=0)
    per_source_limit: dict[str, int]
    request_timeout_seconds: float = Field(default=30, gt=0)
    requests_per_second: float = Field(default=1, gt=0)
    output_dir: Path
    manifest_dir: Path = Path("data/manifests")


class PreprocessingSettings(BaseModel):
    input_dir: Path
    output_file: Path
    chunk_size_words: int = Field(default=420, ge=50)
    chunk_overlap_words: int = Field(default=60, ge=0)
    minimum_chunk_words: int = Field(default=25, ge=1)

    @model_validator(mode="after")
    def check_chunk_overlap(self) -> "PreprocessingSettings":
        if self.chunk_overlap_words >= self.chunk_size_words:
            raise ValueError("chunk_overlap_words must be smaller than chunk_size_words")
        return self


class IndexingSettings(BaseModel):
    qdrant_url: str
    collection_name: str
    dense_model: str
    sparse_model: str
    batch_size: int = Field(default=16, gt=0)
    dense_vector_name: str = "dense"
    sparse_vector_name: str = "sparse"


class RetrievalSettings(BaseModel):
    dense_candidates: int = Field(default=30, gt=0)
    sparse_candidates: int = Field(default=30, gt=0)
    top_k: int = Field(default=8, gt=0)
    multi_query_enabled: bool = False
    source_balancing_enabled: bool = False
    max_subqueries: int = Field(default=6, ge=1, le=12)
    candidates_per_query: int = Field(default=12, ge=1)
    rrf_k: int = Field(default=60, ge=1)


class RerankingSettings(BaseModel):
    enabled: bool = False
    provider: Literal["local", "http"] = "local"
    model: str = "BAAI/bge-reranker-v2-m3"
    base_url: str = "http://localhost:8000"
    candidate_pool_size: int = Field(default=40, gt=0)
    request_batch_size: int = Field(default=8, gt=0)
    top_n: int = Field(default=10, gt=0)
    timeout_seconds: float = Field(default=180, gt=0)


class GenerationSettings(BaseModel):
    provider: Literal["ollama", "vllm"] = "ollama"
    model: str
    base_url: str
    temperature: float = Field(default=0.1, ge=0, le=2)
    timeout_seconds: float = Field(default=120, gt=0)
    max_output_tokens: int = Field(default=1200, ge=128, le=8192)
    max_context_chars: int = Field(default=18000, ge=2000, le=100000)
    quality_gate_enabled: bool = False


class Settings(BaseModel):
    scope: ScopeSettings
    ingestion: IngestionSettings
    preprocessing: PreprocessingSettings
    indexing: IndexingSettings
    retrieval: RetrievalSettings
    reranking: RerankingSettings = Field(default_factory=RerankingSettings)
    generation: GenerationSettings
    evidence_policy_file: Path | None = None
    chemistry_rules_file: Path | None = None
    diagnostics_file: Path | None = None
    config_path: Path = Field(exclude=True)
    root_dir: Path = Field(exclude=True)

    def resolve_path(self, path: Path) -> Path:
        return path if path.is_absolute() else (self.root_dir / path).resolve()

    @classmethod
    def load(cls, config_path: str | Path) -> "Settings":
        path = Path(config_path).resolve()
        load_dotenv(path.parent.parent / ".env", override=False)
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        settings = cls.model_validate(
            {**payload, "config_path": path, "root_dir": path.parent.parent}
        )
        settings.indexing.qdrant_url = os.getenv(
            "QDRANT_URL", settings.indexing.qdrant_url
        )
        settings.generation.base_url = os.getenv(
            "OLLAMA_BASE_URL" if settings.generation.provider == "ollama" else "VLLM_BASE_URL",
            settings.generation.base_url,
        )
        settings.reranking.base_url = os.getenv(
            "RERANKER_BASE_URL", settings.reranking.base_url
        )
        return settings
