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


class RagAnswer(BaseModel):
    answer: str
    sources: list[SourceReference]


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
