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
    ) -> list[RetrievedChunk]:
        return self.store.search(
            question,
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

