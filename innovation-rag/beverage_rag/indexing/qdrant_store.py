from __future__ import annotations

import os
from collections.abc import Sequence
from datetime import date
from typing import Any

from beverage_rag.indexing.embeddings import EmbeddingModels, SparseEmbeddingModel
from beverage_rag.schemas import Chunk, RetrievedChunk
from beverage_rag.settings import Settings


class QdrantHybridStore:
    def __init__(
        self,
        settings: Settings,
        embeddings: EmbeddingModels | SparseEmbeddingModel | None = None,
        initialize_embeddings: bool = True,
    ) -> None:
        try:
            from qdrant_client import QdrantClient
        except ImportError as exc:
            raise RuntimeError(
                "Qdrant support requires: pip install -e '.[indexing]'"
            ) from exc
        self.settings = settings
        self.config = settings.indexing
        if self.config.qdrant_url == ":memory:":
            self.client = QdrantClient(location=":memory:")
        else:
            self.client = QdrantClient(
                url=self.config.qdrant_url,
                api_key=os.getenv("QDRANT_API_KEY") or None,
            )
        self.embeddings = embeddings
        if self.embeddings is None and initialize_embeddings:
            self.embeddings = EmbeddingModels(
                self.config.dense_model, self.config.sparse_model
            )

    def ensure_collection(self, dense_size: int, recreate: bool = False) -> None:
        from qdrant_client.http import models

        exists = self.client.collection_exists(self.config.collection_name)
        if exists and recreate:
            self.client.delete_collection(self.config.collection_name)
            exists = False
        if not exists:
            self.client.create_collection(
                collection_name=self.config.collection_name,
                vectors_config={
                    self.config.dense_vector_name: models.VectorParams(
                        size=dense_size,
                        distance=models.Distance.COSINE,
                    )
                },
                sparse_vectors_config={
                    self.config.sparse_vector_name: models.SparseVectorParams(
                        index=models.SparseIndexParams(on_disk=False)
                    )
                },
            )
            return
        info = self.client.get_collection(self.config.collection_name)
        vectors = info.config.params.vectors
        configured = vectors.get(self.config.dense_vector_name) if isinstance(vectors, dict) else vectors
        if configured and configured.size != dense_size:
            raise ValueError(
                "Dense embedding size differs from the existing collection. "
                "Use --recreate only if deleting the old index is intended."
            )

    @staticmethod
    def _payload(chunk: Chunk) -> dict[str, Any]:
        return chunk.model_dump(mode="json", exclude_none=True)

    def upsert(self, chunks: Sequence[Chunk], recreate: bool = False) -> int:
        from qdrant_client.http import models

        if not chunks:
            return 0
        if self.embeddings is None or not hasattr(self.embeddings, "embed_dense"):
            raise RuntimeError("Dense embedding model is not initialized")
        batch_size = self.config.batch_size
        first_dense = self.embeddings.embed_dense([chunks[0].text])[0]
        self.ensure_collection(len(first_dense), recreate=recreate)
        for start in range(0, len(chunks), batch_size):
            batch = list(chunks[start : start + batch_size])
            dense_vectors = self.embeddings.embed_dense([chunk.text for chunk in batch])
            sparse_vectors = self.embeddings.embed_sparse([chunk.text for chunk in batch])
            points = [
                models.PointStruct(
                    id=chunk.id,
                    vector={
                        self.config.dense_vector_name: dense,
                        self.config.sparse_vector_name: models.SparseVector(
                            indices=sparse[0], values=sparse[1]
                        ),
                    },
                    payload=self._payload(chunk),
                )
                for chunk, dense, sparse in zip(batch, dense_vectors, sparse_vectors, strict=True)
            ]
            self.client.upsert(
                collection_name=self.config.collection_name,
                points=points,
                wait=True,
            )
        return len(chunks)

    def upsert_precomputed(
        self,
        chunks: Sequence[Chunk],
        dense_vectors: Any,
        recreate: bool = False,
    ) -> int:
        """Index ordered GPU-generated dense vectors plus locally generated sparse vectors."""
        from qdrant_client.http import models

        if not chunks:
            return 0
        if len(chunks) != len(dense_vectors):
            raise ValueError("Chunk and dense-vector counts differ")
        dense_size = len(dense_vectors[0])
        self.ensure_collection(dense_size, recreate=recreate)
        sparse_embedder = self.embeddings
        if sparse_embedder is None or not hasattr(sparse_embedder, "embed_sparse"):
            sparse_embedder = SparseEmbeddingModel(self.config.sparse_model)
        batch_size = self.config.batch_size
        for start in range(0, len(chunks), batch_size):
            batch = list(chunks[start : start + batch_size])
            batch_dense = dense_vectors[start : start + len(batch)]
            sparse_vectors = sparse_embedder.embed_sparse([chunk.text for chunk in batch])
            points = [
                models.PointStruct(
                    id=chunk.id,
                    vector={
                        self.config.dense_vector_name: dense.tolist()
                        if hasattr(dense, "tolist")
                        else list(dense),
                        self.config.sparse_vector_name: models.SparseVector(
                            indices=sparse[0], values=sparse[1]
                        ),
                    },
                    payload=self._payload(chunk),
                )
                for chunk, dense, sparse in zip(
                    batch, batch_dense, sparse_vectors, strict=True
                )
            ]
            self.client.upsert(
                collection_name=self.config.collection_name,
                points=points,
                wait=True,
            )
        return len(chunks)

    def search(
        self,
        query: str,
        top_k: int | None = None,
        source: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> list[RetrievedChunk]:
        from qdrant_client.http import models

        if self.embeddings is None or not hasattr(self.embeddings, "embed_dense"):
            raise RuntimeError("Dense embedding model is not initialized")
        dense = self.embeddings.embed_dense([query])[0]
        sparse_indices, sparse_values = self.embeddings.embed_sparse([query])[0]
        conditions: list[Any] = []
        if source:
            conditions.append(
                models.FieldCondition(key="source", match=models.MatchValue(value=source))
            )
        if date_from or date_to:
            conditions.append(
                models.FieldCondition(
                    key="publication_date",
                    range=models.DatetimeRange(
                        gte=date_from.isoformat() if date_from else None,
                        lte=date_to.isoformat() if date_to else None,
                    ),
                )
            )
        query_filter = models.Filter(must=conditions) if conditions else None
        retrieval = self.settings.retrieval
        response = self.client.query_points(
            collection_name=self.config.collection_name,
            prefetch=[
                models.Prefetch(
                    query=dense,
                    using=self.config.dense_vector_name,
                    limit=retrieval.dense_candidates,
                    filter=query_filter,
                ),
                models.Prefetch(
                    query=models.SparseVector(indices=sparse_indices, values=sparse_values),
                    using=self.config.sparse_vector_name,
                    limit=retrieval.sparse_candidates,
                    filter=query_filter,
                ),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=top_k or retrieval.top_k,
            with_payload=True,
        )
        return [
            RetrievedChunk(chunk=Chunk.model_validate(point.payload), score=float(point.score))
            for point in response.points
        ]
