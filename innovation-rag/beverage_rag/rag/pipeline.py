from __future__ import annotations

from datetime import date

from beverage_rag.indexing.qdrant_store import QdrantHybridStore
from beverage_rag.rag.citations import CITATION_RE, build_references, ensure_citations
from beverage_rag.rag.generation import LocalGenerator
from beverage_rag.rag.reranking import Reranker
from beverage_rag.rag.retrieval import HybridRetriever, reciprocal_rank_fusion
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
        classes = ", ".join((chunk.ipc_classes + chunk.cpc_classes)[:8]) or "non indiqué"
        sections.append(
            f"[{label}] {chunk.citation_label()} | IDENTIFIANT={chunk.citation_label()}\n"
            f"TYPE={chunk.document_type}; SOURCE={chunk.source}; TITRE={chunk.title}\n"
            f"DATE={chunk.publication_date or 'non indiquée'}; PAYS={chunk.country or 'non indiqué'}; "
            f"SECTION={chunk.section}; CLASSES={classes}; SCORE_RERANK={result.score:.4f}\n"
            f"EXTRAIT:\n{chunk.text}"
        )
    return "\n\n".join(sections)


def answer_passes_quality_gate(answer: str, valid_source_count: int) -> bool:
    normalized = answer.casefold()
    required_markers = (
        "diagnostic",
        "causes hiérarchisées",
        "données précises",
        "données manquantes",
        "essais de confirmation",
        "actions correctives",
        "incertitudes",
        "sources utilisées",
    )
    if not all(marker in normalized for marker in required_markers):
        return False
    valid_ids = {f"S{number}" for number in range(1, valid_source_count + 1)}
    cited_ids = {f"S{number}" for number in CITATION_RE.findall(answer)} & valid_ids
    return len(cited_ids) >= min(3, valid_source_count)


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
        self.reranker = Reranker(settings.reranking)

    def _retrieve_evidence(
        self,
        question: str,
        source: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> list[RetrievedChunk]:
        retrieval = self.settings.retrieval
        queries = [question]
        if retrieval.multi_query_enabled:
            try:
                queries.extend(
                    self.generator.decompose_question(
                        question, max_queries=retrieval.max_subqueries
                    )
                )
            except Exception:
                # Retrieval remains available if the remote decomposition call fails.
                pass
        queries = list(dict.fromkeys(query.strip() for query in queries if query.strip()))
        ranked_lists = [
            self.retriever.retrieve(
                query,
                source,
                date_from,
                date_to,
                top_k=retrieval.candidates_per_query,
            )
            for query in queries
        ]
        if source is None and retrieval.source_balancing_enabled:
            # Add dedicated evidence lanes so a globally dominant patent corpus cannot
            # completely hide peer-reviewed evidence, or vice versa.
            for source_name in ("google_patents_bigquery", "semantic_scholar"):
                ranked_lists.append(
                    self.retriever.retrieve(
                        question,
                        source_name,
                        date_from,
                        date_to,
                        top_k=retrieval.candidates_per_query,
                    )
                )
        fused = reciprocal_rank_fusion(ranked_lists, rrf_k=retrieval.rrf_k)
        reranked = self.reranker.rerank(question, fused)
        return reranked[: retrieval.top_k]

    def ask(
        self,
        question: str,
        source: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> RagAnswer:
        if not question.strip():
            raise ValueError("Question cannot be empty")
        results = self._retrieve_evidence(question, source, date_from, date_to)
        references = build_references(results)
        if not results:
            return RagAnswer(
                answer="Aucune source pertinente n'a été trouvée dans l'index local.",
                sources=[],
            )
        # Materialize LlamaIndex nodes at the orchestration boundary so callers can
        # extend this pipeline with rerankers without changing the storage layer.
        self.retriever.llama_nodes(results)
        context = build_context(results)
        answer = self.generator.generate(question, context)
        if (
            self.settings.generation.quality_gate_enabled
            and not answer_passes_quality_gate(answer, len(references))
        ):
            answer = self.generator.revise_answer(question, context, answer)
        return RagAnswer(answer=ensure_citations(answer, references), sources=references)
