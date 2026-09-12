from __future__ import annotations

from collections.abc import Iterable
from typing import Any


class SparseEmbeddingModel:
    def __init__(self, sparse_model: str) -> None:
        try:
            from fastembed import SparseTextEmbedding
        except ImportError as exc:
            raise RuntimeError(
                "Sparse indexing requires: pip install -e '.[indexing]'"
            ) from exc
        self.sparse = SparseTextEmbedding(model_name=sparse_model)

    def embed_sparse(self, texts: list[str]) -> list[tuple[list[int], list[float]]]:
        embeddings: Iterable[Any] = self.sparse.embed(texts)
        return [
            (embedding.indices.tolist(), embedding.values.tolist())
            for embedding in embeddings
        ]


class EmbeddingModels:
    def __init__(self, dense_model: str, sparse_model: str) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "Indexing requires: pip install -e '.[indexing]'"
            ) from exc
        self.dense = SentenceTransformer(dense_model)
        self.sparse_model = SparseEmbeddingModel(sparse_model)

    def embed_dense(self, texts: list[str]) -> list[list[float]]:
        vectors = self.dense.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return [vector.tolist() for vector in vectors]

    def embed_sparse(self, texts: list[str]) -> list[tuple[list[int], list[float]]]:
        return self.sparse_model.embed_sparse(texts)
