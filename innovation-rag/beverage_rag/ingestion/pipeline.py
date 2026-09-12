from __future__ import annotations

from datetime import datetime
from pathlib import Path

from beverage_rag.ingestion.base import requested_limit
from beverage_rag.ingestion.bigquery_patents import BigQueryPatentsConnector
from beverage_rag.ingestion.openalex import OpenAlexConnector
from beverage_rag.ingestion.pubmed import PubMedConnector
from beverage_rag.ingestion.semantic_scholar import SemanticScholarConnector
from beverage_rag.schemas import write_jsonl, write_manifest
from beverage_rag.settings import Settings


CONNECTORS = {
    "patents": BigQueryPatentsConnector,
    "openalex": OpenAlexConnector,
    "semantic_scholar": SemanticScholarConnector,
    "pubmed": PubMedConnector,
}


def ingest_source(
    settings: Settings, source: str, limit: int | None = None
) -> tuple[Path, int]:
    if source not in CONNECTORS:
        raise ValueError(f"Unknown source {source!r}; expected one of {sorted(CONNECTORS)}")
    actual_limit = requested_limit(settings, source, limit)
    connector = CONNECTORS[source](settings)
    documents = list(connector.fetch(actual_limit))
    output_dir = settings.resolve_path(settings.ingestion.output_dir) / source
    output_path = output_dir / "documents.jsonl"
    write_jsonl(output_path, documents)
    manifest = {
        "source": source,
        "created_at": datetime.now().astimezone().isoformat(),
        "config": str(settings.config_path),
        "requested_limit": actual_limit,
        "document_count": len(documents),
        "output": str(output_path),
        "public_sources_only": True,
    }
    manifest_path = settings.resolve_path(settings.ingestion.manifest_dir) / f"{source}.json"
    write_manifest(manifest_path, manifest)
    return output_path, len(documents)


def ingest_all(settings: Settings, limit: int | None = None) -> dict[str, int]:
    counts: dict[str, int] = {}
    remaining = min(limit or settings.ingestion.pilot_limit_total, settings.ingestion.pilot_limit_total)
    for source in settings.ingestion.enabled_sources:
        if remaining <= 0:
            break
        _, count = ingest_source(settings, source, remaining)
        counts[source] = count
        remaining -= count
    return counts
