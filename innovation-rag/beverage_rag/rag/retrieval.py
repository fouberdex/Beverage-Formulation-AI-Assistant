from __future__ import annotations

from datetime import date

from beverage_rag.indexing.qdrant_store import QdrantHybridStore
from beverage_rag.schemas import RetrievedChunk


class HybridRetriever:
    """LlamaIndex-compatible retrieval boundary over Qdrant hybrid search."""

    def __init__(self, store: QdrantHybridStore) -> None:
        self.store = store

    def retrieve(
        self,
        question: str,
        source: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        top_k: int | None = None,
    ) -> list[RetrievedChunk]:
        return self.store.search(
            question,
            top_k=top_k,
            source=source,
            date_from=date_from,
            date_to=date_to,
        )

    def llama_nodes(self, results: list[RetrievedChunk]):
        try:
            from llama_index.core.schema import NodeWithScore, TextNode
        except ImportError as exc:
            raise RuntimeError("RAG support requires: pip install -e '.[rag]'") from exc
        return [
            NodeWithScore(
                node=TextNode(
                    id_=item.chunk.id,
                    text=item.chunk.text,
                    metadata=item.chunk.model_dump(mode="json", exclude={"text"}),
                ),
                score=item.score,
            )
            for item in results
        ]


def reciprocal_rank_fusion(
    ranked_lists: list[list[RetrievedChunk]], rrf_k: int = 60
) -> list[RetrievedChunk]:
    """Fuse independently retrieved subqueries without trusting incomparable raw scores."""
    by_chunk: dict[str, RetrievedChunk] = {}
    fused_scores: dict[str, float] = {}
    for ranked in ranked_lists:
        for rank, item in enumerate(ranked, start=1):
            chunk_id = item.chunk.id
            by_chunk.setdefault(chunk_id, item)
            fused_scores[chunk_id] = fused_scores.get(chunk_id, 0.0) + 1.0 / (
                rrf_k + rank
            )
    return sorted(
        (
            RetrievedChunk(chunk=by_chunk[chunk_id].chunk, score=score)
            for chunk_id, score in fused_scores.items()
        ),
        key=lambda item: item.score,
        reverse=True,
    )
