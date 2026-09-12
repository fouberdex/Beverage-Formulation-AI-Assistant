from __future__ import annotations

from datetime import date

from beverage_rag.indexing.qdrant_store import QdrantHybridStore
from beverage_rag.rag.citations import build_references, ensure_citations
from beverage_rag.rag.generation import LocalGenerator
from beverage_rag.rag.retrieval import HybridRetriever
from beverage_rag.schemas import RagAnswer, RetrievedChunk
from beverage_rag.settings import Settings


def build_context(results: list[RetrievedChunk]) -> str:
    document_labels: dict[str, str] = {}
    sections: list[str] = []
    for result in results:
        chunk = result.chunk
        if chunk.document_id not in document_labels:
            document_labels[chunk.document_id] = f"S{len(document_labels) + 1}"
        label = document_labels[chunk.document_id]
        sections.append(
            f"[{label}] {chunk.citation_label()} | {chunk.title} | "
            f"section={chunk.section}\n{chunk.text}"
        )
    return "\n\n".join(sections)


class RagPipeline:
    def __init__(
        self,
        settings: Settings,
        store: QdrantHybridStore | None = None,
        generator: LocalGenerator | None = None,
    ) -> None:
        self.settings = settings
        self.retriever = HybridRetriever(store or QdrantHybridStore(settings))
        self.generator = generator or LocalGenerator(settings.generation)

    def ask(
        self,
        question: str,
        source: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> RagAnswer:
        if not question.strip():
            raise ValueError("Question cannot be empty")
        results = self.retriever.retrieve(question, source, date_from, date_to)
        references = build_references(results)
        if not results:
            return RagAnswer(
                answer="Aucune source pertinente n'a été trouvée dans l'index local.",
                sources=[],
            )
        # Materialize LlamaIndex nodes at the orchestration boundary so callers can
        # extend this pipeline with rerankers without changing the storage layer.
        self.retriever.llama_nodes(results)
        answer = self.generator.generate(question, build_context(results))
        return RagAnswer(answer=ensure_citations(answer, references), sources=references)

