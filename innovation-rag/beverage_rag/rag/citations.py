from __future__ import annotations

import re

from beverage_rag.schemas import RetrievedChunk, SourceReference


CITATION_RE = re.compile(r"\[S(\d+)\]")


def build_references(results: list[RetrievedChunk]) -> list[SourceReference]:
    references: list[SourceReference] = []
    seen_documents: set[str] = set()
    for item in results:
        chunk = item.chunk
        if chunk.document_id in seen_documents:
            continue
        seen_documents.add(chunk.document_id)
        references.append(
            SourceReference(
                citation_id=f"S{len(references) + 1}",
                label=chunk.citation_label(),
                title=chunk.title,
                source=chunk.source,
                section=chunk.section,
                url=chunk.url,
                score=item.score,
            )
        )
    return references


def ensure_citations(answer: str, references: list[SourceReference]) -> str:
    if not references:
        return answer
    valid_ids = {reference.citation_id for reference in references}
    cited_ids = {f"S{number}" for number in CITATION_RE.findall(answer)}
    cited_ids &= valid_ids
    if cited_ids:
        return answer
    labels = ", ".join(f"[{reference.citation_id}]" for reference in references[:3])
    return f"{answer.rstrip()}\n\nSources documentaires consultées : {labels}."


def format_source_list(references: list[SourceReference]) -> str:
    lines = []
    for source in references:
        url = f" — {source.url}" if source.url else ""
        lines.append(
            f"[{source.citation_id}] {source.label} — {source.title} "
            f"({source.source}, section {source.section}){url}"
        )
    return "\n".join(lines)

