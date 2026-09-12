from __future__ import annotations

import hashlib
import json
from pathlib import Path

from beverage_rag.indexing.qdrant_store import QdrantHybridStore
from beverage_rag.schemas import Chunk, read_jsonl
from beverage_rag.settings import Settings


def index_chunks(settings: Settings, recreate: bool = False) -> int:
    path = settings.resolve_path(settings.preprocessing.output_file)
    if not path.exists():
        raise FileNotFoundError(f"Chunk file not found: {path}; run preprocess first")
    chunks = read_jsonl(path, Chunk)
    return QdrantHybridStore(settings).upsert(chunks, recreate=recreate)


def _ordered_ids_digest(chunks: list[Chunk]) -> str:
    return hashlib.sha256(
        "\n".join(chunk.id for chunk in chunks).encode("utf-8")
    ).hexdigest()


def index_precomputed(
    settings: Settings,
    embeddings_path: str | Path,
    manifest_path: str | Path,
    recreate: bool = False,
) -> int:
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("Precomputed import requires NumPy") from exc

    chunks_path = settings.resolve_path(settings.preprocessing.output_file)
    chunks = read_jsonl(chunks_path, Chunk)
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    if manifest.get("model") != settings.indexing.dense_model:
        raise ValueError(
            f"Embedding model mismatch: {manifest.get('model')} != "
            f"{settings.indexing.dense_model}"
        )
    if manifest.get("chunk_count") != len(chunks):
        raise ValueError("Manifest chunk count does not match the local chunk file")
    if manifest.get("ordered_chunk_ids_sha256") != _ordered_ids_digest(chunks):
        raise ValueError("Chunk order or content changed after GPU embedding generation")
    dense_vectors = np.load(Path(embeddings_path), mmap_mode="r")
    if dense_vectors.ndim != 2 or dense_vectors.shape[0] != len(chunks):
        raise ValueError("Invalid dense embedding array shape")
    if manifest.get("dimensions") != dense_vectors.shape[1]:
        raise ValueError("Manifest dimensions do not match the embedding array")
    store = QdrantHybridStore(settings, initialize_embeddings=False)
    return store.upsert_precomputed(chunks, dense_vectors, recreate=recreate)
