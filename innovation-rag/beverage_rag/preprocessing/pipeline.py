from __future__ import annotations

from pathlib import Path

from beverage_rag.preprocessing.cleaning import chunk_words
from beverage_rag.preprocessing.patents import patent_sections
from beverage_rag.preprocessing.publications import publication_sections
from beverage_rag.schemas import Chunk, RawDocument, read_jsonl, write_jsonl
from beverage_rag.settings import Settings


def chunk_document(document: RawDocument, settings: Settings) -> list[Chunk]:
    config = settings.preprocessing
    sections = (
        patent_sections(document.sections)
        if document.document_type == "patent"
        else publication_sections(document.sections)
    )
    chunks: list[Chunk] = []
    for section_name, section_text in sections:
        pieces = chunk_words(
            section_text,
            size=config.chunk_size_words,
            overlap=config.chunk_overlap_words,
            minimum=config.minimum_chunk_words,
        )
        for position, text in enumerate(pieces):
            chunks.append(
                Chunk(
                    id=Chunk.stable_id(document.id, section_name, position, text),
                    document_id=document.id,
                    source=document.source,
                    document_type=document.document_type,
                    external_id=document.external_id,
                    title=document.title,
                    section=section_name,
                    position=position,
                    text=text,
                    publication_date=document.publication_date,
                    language=document.language,
                    country=document.country,
                    doi=document.doi,
                    url=str(document.url or document.open_access_url or "") or None,
                    ipc_classes=document.ipc_classes,
                    cpc_classes=document.cpc_classes,
                    metadata=document.metadata,
                )
            )
    return chunks


def preprocess(settings: Settings) -> tuple[Path, int]:
    input_dir = settings.resolve_path(settings.preprocessing.input_dir)
    paths = [
        input_dir / source / "documents.jsonl"
        for source in settings.ingestion.enabled_sources
        if (input_dir / source / "documents.jsonl").exists()
    ]
    # Curated PubMed additions are kept separate from the large source exports so
    # targeted evidence enrichment never overwrites the 10k-paper corpus.
    curated_pubmed = input_dir / "curated_pubmed" / "documents.jsonl"
    if curated_pubmed.exists():
        paths.append(curated_pubmed)
    if not paths:
        raise FileNotFoundError(f"No ingestion files found below {input_dir}")
    documents: dict[str, RawDocument] = {}
    for path in paths:
        for document in read_jsonl(path, RawDocument):
            canonical_key = f"doi:{document.doi.lower()}" if document.doi else document.id
            existing = documents.get(canonical_key)
            if existing is None or sum(map(len, document.sections.values())) > sum(
                map(len, existing.sections.values())
            ):
                documents[canonical_key] = document
    chunks = [
        chunk
        for document in documents.values()
        for chunk in chunk_document(document, settings)
    ]
    output_path = settings.resolve_path(settings.preprocessing.output_file)
    write_jsonl(output_path, chunks)
    return output_path, len(chunks)
