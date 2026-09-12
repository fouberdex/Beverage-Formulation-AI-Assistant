from pathlib import Path

from beverage_rag.rag.generation import LocalGenerator
from beverage_rag.rag.pipeline import answer_passes_quality_gate
from beverage_rag.rag.retrieval import reciprocal_rank_fusion
from beverage_rag.schemas import Chunk, RetrievedChunk
from beverage_rag.settings import Settings


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
