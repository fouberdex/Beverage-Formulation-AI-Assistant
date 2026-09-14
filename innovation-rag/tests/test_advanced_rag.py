from pathlib import Path

from beverage_rag.rag.generation import LocalGenerator
from beverage_rag.rag.pipeline import (
    RagPipeline,
    action_rows_have_valid_citations,
    answer_passes_quality_gate,
    data_rows_have_traceable_values,
    normalize_generated_markdown,
    sanitize_action_rows,
    sanitize_data_rows,
)
from beverage_rag.rag.reranking import Reranker
from beverage_rag.rag.retrieval import reciprocal_rank_fusion
from beverage_rag.schemas import Chunk, RetrievedChunk
from beverage_rag.settings import RerankingSettings, Settings


ROOT = Path(__file__).resolve().parents[1]


def test_small_model_table_prefix_is_normalized_deterministically() -> None:
    answer = "Tableau: Rang | Cause | Mécanisme\n| --- | --- | --- |"

    normalized = normalize_generated_markdown(answer)

    assert normalized.splitlines()[0] == "| Rang | Cause | Mécanisme |"


def test_unmapped_mechanism_gets_claim_specific_deterministic_proof() -> None:
    settings = Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml")
    pipeline = RagPipeline(settings, store=object())
    pipeline.reranker.rerank = lambda query, candidates: candidates
    evidence = [result("one", 0.88), result("two", 0.82)]
    answer = """## 2. Causes hiérarchisées
| Rang | Cause | Mécanisme | Probabilité | Score de preuve | Justification | Sources |
|---|---|---|---|---|---|---|
| 1 | Défaut inédit | Réaction spécialisée absente de la taxonomie | Moyenne | AUTO | Relation décrite | [S1], [S2] |"""

    assessments = pipeline._assess_dynamic_claims(
        answer, "Question boisson inédite", evidence
    )

    assert len(assessments) == 1
    assessment = next(iter(assessments.values()))
    assert assessment.mechanism_id == "dynamic:1"
    assert assessment.level == "Fort"
    assert assessment.independent_sources == 2


def test_full_pipeline_publishes_an_evidence_backed_unmapped_mechanism() -> None:
    evidence = [result("novel-one", 0.88), result("novel-two", 0.82)]
    evidence[0].chunk.text = (
        "In the botanical beverage, iron complexation with anthocyanins was "
        "associated with a metallic sensory note during storage."
    )
    evidence[1].chunk.text = (
        "Anthocyanin metal complexes in the stored drink coincided with the "
        "metallic sensory defect."
    )

    class FakeStore:
        def search(self, *args, **kwargs):
            return evidence

    class FakeGenerator:
        def decompose_question(self, *args, **kwargs):
            return ["anthocyanin iron complex metallic sensory beverage"]

        def generate(self, *args, **kwargs):
            return """## 1. Diagnostic synthétique
Une complexation métallique est documentée [S1].

## 2. Causes hiérarchisées
| Rang | Cause | Mécanisme | Probabilité | Score de preuve | Justification | Sources |
|---|---|---|---|---|---|---|
| 1 | Note métallique | Complexation fer-anthocyanes | Élevée | AUTO | Relation documentée | [S1], [S2] |

## 3. Données précises extraites des documents
| Paramètre/observation | Valeur et conditions | Portée | Source |
|---|---|---|---|
| Association sensorielle | documentée | Boisson botanique stockée | [S1] |

## 4. Données manquantes pour trancher
- Teneur en fer du lot.

## 5. Essais de confirmation prioritaires
| Hypothèse | Mesure | Protocole comparatif | Critère de décision | Délai |
|---|---|---|---|---|
| Complexation | Fer dissous | Comparer au témoin | Écart contre témoin | À définir |

## 6. Actions correctives et arbitrages industriels
| Action | Preuve | Impact coût | Impact goût | Impact procédé | Risque/limite |
|---|---|---|---|---|---|
| Contrôler le fer dissous | [S1] | Faible | Aucun attendu | Faible | À valider |

## 7. Incertitudes et limites
- Applicabilité industrielle à confirmer.

## 8. Sources utilisées
- [S1] Étude 1
- [S2] Étude 2"""

        def revise_answer(self, *args, **kwargs):
            raise AssertionError("The first structured answer should pass")

    settings = Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml")
    pipeline = RagPipeline(settings, store=FakeStore(), generator=FakeGenerator())
    pipeline.reranker.rerank = lambda query, candidates: [
        RetrievedChunk(chunk=item.chunk, score=0.88 - 0.06 * index)
        for index, item in enumerate(candidates)
    ]

    response = pipeline.ask(
        "Une boisson botanique développe une note métallique après stockage."
    )

    assert response.diagnostics is not None
    assert response.diagnostics.status == "generated"
    assert "Complexation fer-anthocyanes" in response.answer
    assert "/100 — Fort" in response.answer


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
    answer = """## Diagnostic [S1]
## Causes hiérarchisées
| Rang | Cause | Mécanisme | Probabilité | Score de preuve calculé | Justification | Sources |
|---|---|---|---|---|---|---|
| 1 | Cause | Mécanisme | Moyenne | 60/100 — Modéré | Test | [S1] |
## Données précises
| Paramètre/observation | Valeur et conditions | Portée | Source |
|---|---|---|---|
| Paramètre | Valeur | Essai | [S2] |
## Données manquantes
## Essais de confirmation
| Hypothèse | Mesure | Protocole comparatif | Critère de décision | Délai |
|---|---|---|---|---|
| Hypothèse | Mesure | Témoin | Critère | 1 jour [S3] |
## Actions correctives
| Action | Preuve | Impact coût | Impact goût | Impact procédé | Risque/limite |
|---|---|---|---|---|---|
| Action | [S1] | Faible | Faible | Faible | À valider |
## Incertitudes
## Sources utilisées
"""
    assert answer_passes_quality_gate(answer, valid_source_count=3)
    assert not answer_passes_quality_gate(
        answer.replace("| Rang | Cause |", "| RangCause |"),
        valid_source_count=3,
    )
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


def test_every_action_row_requires_its_own_valid_citation() -> None:
    valid_ids = {"S1", "S2"}
    cited = """| Action | Preuve | Risque/limite |
|---|---|---|
| Tester A | [S1] | À valider |
| Tester B | [S2] | À valider |"""
    missing = cited.replace("| [S2] |", "| non documenté |")

    assert action_rows_have_valid_citations(cited, valid_ids)
    assert not action_rows_have_valid_citations(missing, valid_ids)


def test_numeric_data_must_exist_in_the_cited_chunk() -> None:
    evidence = [result("numeric", score=0.8)]
    evidence[0].chunk.text = "The beverage was stored for 8 weeks at 25 °C."
    answer = """| Paramètre/observation | Valeur et conditions | Portée | Source |
|---|---|---|---|
| Stockage | 8 semaines à 25 °C | Soda étudié, stockage ambiant | [S1] |"""
    invented = answer.replace("25 °C", "40 °C")
    duplicated_scope = answer.replace(
        "Soda étudié, stockage ambiant", "8 semaines à 25 °C"
    )

    assert data_rows_have_traceable_values(answer, evidence)
    assert not data_rows_have_traceable_values(invented, evidence)
    assert not data_rows_have_traceable_values(duplicated_scope, evidence)


def test_sanitizers_remove_only_invalid_rows() -> None:
    evidence = [result("numeric", score=0.8)]
    evidence[0].chunk.text = "Storage lasted 8 weeks at 25 °C."
    answer = """| Paramètre/observation | Valeur et conditions | Portée | Source |
|---|---|---|---|
| Stockage | 8 semaines à 25 °C | Soda étudié | [S1] |
| Dose inventée | 99 % | Soda étudié | [S1] |

| Action | Preuve | Impact coût | Impact goût | Impact procédé | Risque/limite |
|---|---|---|---|---|---|
| Contrôler l'oxygène | [S1] | Faible | Aucun | Faible | À valider |
| Modifier la formule | — | Faible | Inconnu | Faible | À valider |"""

    sanitized = sanitize_data_rows(answer, evidence)
    sanitized = sanitize_action_rows(sanitized, {"S1"})

    assert "8 semaines à 25 °C" in sanitized
    assert "99 %" not in sanitized
    assert "Contrôler l'oxygène" in sanitized
    assert "Modifier la formule" not in sanitized
