from pathlib import Path

from beverage_rag.rag.generation import LocalGenerator
from beverage_rag.rag.pipeline import answer_passes_quality_gate
from beverage_rag.rag.reranking import Reranker
from beverage_rag.rag.retrieval import reciprocal_rank_fusion
from beverage_rag.schemas import Chunk, RetrievedChunk
from beverage_rag.settings import RerankingSettings, Settings


ROOT = Path(__file__).resolve().parents[1]


def result(chunk_id: str, score: float = 0.5) -> RetrievedChunk:
    return RetrievedChunk(
        chunk=Chunk(
            id=chunk_id,
            document_id=f"doc-{chunk_id}",
            source="test_fixture",
            document_type="publication",
            external_id=chunk_id,
            title=f"Test {chunk_id}",
            section="abstract",
            position=0,
            text="Test-only evidence.",
        ),
        score=score,
    )


def test_reciprocal_rank_fusion_rewards_cross_query_evidence() -> None:
    fused = reciprocal_rank_fusion(
        [[result("a"), result("b")], [result("b"), result("c")]], rrf_k=60
    )
    assert [item.chunk.id for item in fused] == ["b", "a", "c"]
    assert fused[0].score > fused[1].score


def test_query_decomposition_accepts_json_and_deduplicates(monkeypatch) -> None:
    generator = LocalGenerator(Settings.load(ROOT / "config" / "soda.yaml").generation)
    monkeypatch.setattr(
        generator,
        "_complete",
        lambda *args, **kwargs: (
            '```json\n{"queries":["citral oxidation", "emulsion haze", '
            '"citral oxidation"]}\n```'
        ),
    )
    assert generator.decompose_question("test", max_queries=6) == [
        "citral oxidation",
        "emulsion haze",
    ]


def test_answer_quality_gate_requires_structure_and_valid_citations() -> None:
    answer = """## Diagnostic
## Causes hiérarchisées [S1]
## Données précises [S2]
## Données manquantes
## Essais de confirmation [S3]
## Actions correctives
## Incertitudes
## Sources utilisées
"""
    assert answer_passes_quality_gate(answer, valid_source_count=3)
    assert not answer_passes_quality_gate("Réponse générale [S1]", valid_source_count=3)


def test_http_reranker_batches_and_globally_sorts(monkeypatch) -> None:
    calls: list[list[str]] = []

    class FakeResponse:
        def __init__(self, documents: list[str]) -> None:
            self.documents = documents

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "results": [
                    {"index": index, "relevance_score": float(document.rsplit(" ", 1)[-1])}
                    for index, document in enumerate(self.documents)
                ]
            }

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def post(self, url: str, json: dict) -> FakeResponse:
            calls.append(json["documents"])
            assert json["top_n"] == len(json["documents"])
            return FakeResponse(json["documents"])

    monkeypatch.setattr("beverage_rag.rag.reranking.httpx.Client", FakeClient)
    candidates = [result(str(index), score=0.0) for index in range(5)]
    for index, candidate in enumerate(candidates):
        candidate.chunk.text = f"evidence {index}"
    reranker = Reranker(
        RerankingSettings(
            enabled=True,
            provider="http",
            request_batch_size=2,
            top_n=3,
        )
    )

    ranked = reranker.rerank("question", candidates)

    assert [len(batch) for batch in calls] == [2, 2, 1]
    assert [item.chunk.id for item in ranked] == ["4", "3", "2"]
