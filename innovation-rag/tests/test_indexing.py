from pathlib import Path

import pytest

pytest.importorskip("qdrant_client")

from beverage_rag.indexing.qdrant_store import QdrantHybridStore
from beverage_rag.rag.retrieval import HybridRetriever
from beverage_rag.schemas import Chunk
from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]


class FakeEmbeddings:
    def embed_dense(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, float("carbon" in text.lower()), 0.25] for text in texts]

    def embed_sparse(self, texts: list[str]) -> list[tuple[list[int], list[float]]]:
        return [([1, 2], [1.0, float("carbon" in text.lower()) + 0.1]) for text in texts]


def make_chunk(position: int, text: str) -> Chunk:
    return Chunk(
        id=Chunk.stable_id("test-document", "abstract", position, text),
        document_id="test-document",
        source="test_fixture",
        document_type="publication",
        external_id="TEST-ONLY",
        title="Test-only source",
        section="abstract",
        position=position,
        text=text,
    )


def test_qdrant_named_vectors_and_rrf_search() -> None:
    settings = Settings.load(ROOT / "config" / "soda.yaml")
    settings.indexing.qdrant_url = ":memory:"
    settings.indexing.collection_name = "test_collection"
    store = QdrantHybridStore(settings, embeddings=FakeEmbeddings())
    chunks = [
        make_chunk(0, "Carbon dioxide retention in a beverage."),
        make_chunk(1, "A neutral test-only control passage."),
    ]

    assert store.upsert(chunks) == 2
    results = store.search("carbon beverage", top_k=2)

    assert len(results) == 2
    assert results[0].chunk.external_id == "TEST-ONLY"
    assert results[0].score > 0
    nodes = HybridRetriever(store).llama_nodes(results)
    assert nodes[0].node.text == results[0].chunk.text
    assert nodes[0].node.metadata["external_id"] == "TEST-ONLY"


def test_qdrant_accepts_precomputed_dense_vectors() -> None:
    settings = Settings.load(ROOT / "config" / "soda.yaml")
    settings.indexing.qdrant_url = ":memory:"
    settings.indexing.collection_name = "precomputed_collection"
    store = QdrantHybridStore(settings, embeddings=FakeEmbeddings())
    chunks = [
        make_chunk(0, "Carbonated beverage evidence."),
        make_chunk(1, "Sweetener stability evidence."),
    ]
    vectors = [[1.0, 1.0, 0.25], [1.0, 0.0, 0.25]]

    assert store.upsert_precomputed(chunks, vectors) == 2
    assert store.client.count(settings.indexing.collection_name, exact=True).count == 2
