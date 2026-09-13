from pathlib import Path

import pytest

from beverage_rag.rag.chemistry import ChemistryPolicy, apply_chemistry_guardrails
from beverage_rag.rag.evidence import (
    EvidencePolicy,
    apply_evidence_controls,
    build_gap_answer,
    find_evidence_gaps,
    gap_clauses,
)
from beverage_rag.rag.pipeline import RagPipeline
from beverage_rag.schemas import Chunk, RetrievedChunk
from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_POLICY = EvidencePolicy.load(ROOT / "config" / "evidence-policy.yaml")
CHEMISTRY_POLICY = ChemistryPolicy.load(ROOT / "config" / "chemistry-rules.yaml")


def result(
    identifier: str,
    text: str,
    score: float,
    *,
    document_id: str | None = None,
) -> RetrievedChunk:
    return RetrievedChunk(
        chunk=Chunk(
            id=identifier,
            document_id=document_id or f"doc-{identifier}",
            source="test_fixture",
            document_type="publication",
            external_id=identifier,
            title=f"Fixture {identifier}",
            section="results",
            position=0,
            text=text,
        ),
        score=score,
    )


def full_answer(cause_row: str, action_row: str) -> str:
    return f"""## 1. Diagnostic synthétique
Diagnostic test [S1].

## 2. Causes hiérarchisées
| Rang | Cause | Mécanisme | Probabilité | Score de preuve | Justification | Sources |
|---|---|---|---|---|---|---|
{cause_row}

## 3. Données précises extraites des documents
Observation test [S1].

## 4. Données manquantes pour trancher
Mesures complémentaires nécessaires.

## 5. Essais de confirmation prioritaires
Essai contre témoin [S1].

## 6. Actions correctives et arbitrages industriels
| Action | Preuve | Impact coût | Impact goût | Impact procédé | Risque/limite |
|---|---|---|---|---|---|
{action_row}

## 7. Incertitudes et limites
Essai pilote requis.

## 8. Sources utilisées
[S1]."""


def test_proof_is_calculated_and_requires_two_independent_sources_for_strong() -> None:
    text = (
        "In a carbonated beverage containing citric acid and calcium, calcium citrate "
        "precipitated and caused visible turbidity."
    )
    evidence = [result("a", text, 0.82), result("b", text, 0.78)]
    answer = full_answer(
        "| 1 | Citrate de calcium | Précipitation de citrate de calcium | Élevée | Fort | Relation observée | [S1] [S2] |",
        "| Contrôler le calcium | [S1] | Faible | Faible | Simple | À valider |",
    )

    controlled = apply_evidence_controls(answer, evidence, EVIDENCE_POLICY)

    assert "86/100 — Fort" in controlled.answer
    assert "| Fort |" not in controlled.answer


def test_policy_rejects_weights_that_do_not_sum_to_one(tmp_path: Path) -> None:
    content = (ROOT / "config" / "evidence-policy.yaml").read_text(encoding="utf-8")
    path = tmp_path / "invalid-policy.yaml"
    path.write_text(content.replace("reranker_weight: 0.80", "reranker_weight: 0.70"), encoding="utf-8")

    with pytest.raises(ValueError, match="sum to 1.0"):
        EvidencePolicy.load(path)


def test_unrelated_high_score_ph_chunk_cannot_validate_precipitation() -> None:
    evidence = [
        result(
            "orange-ph",
            "The orange soft drink had a measured pH of 3.53 during storage.",
            0.95,
        )
    ]
    answer = full_answer(
        "| 1 | Citrate de calcium | Précipitation de citrate de calcium | Élevée | Fort | pH proche | [S1] |",
        "| Mesurer la turbidité | [S1] | Faible | Aucun | Simple | Aucun |",
    )

    controlled = apply_evidence_controls(answer, evidence, EVIDENCE_POLICY)

    assert "Aucune cause suffisamment soutenue" in controlled.answer
    assert "Hypothèse « Citrate de calcium » non soutenue" in controlled.answer
    assert "95/100" not in controlled.answer


def test_precipitation_query_reports_corpus_gap_without_inventing_mechanisms() -> None:
    evidence = [
        result(
            "noise",
            "The orange soft drink had a measured pH of 3.53 during storage.",
            0.97,
        )
    ]
    question = "précipitation trouble soda citron-lime"

    gaps = find_evidence_gaps(question, evidence, EVIDENCE_POLICY)
    answer = build_gap_answer(gap_clauses(gaps, EVIDENCE_POLICY))

    assert "Aucune source pertinente trouvée" in answer
    assert "précipitation ou turbidité physique" in answer
    assert "citrate" not in answer.casefold()
    assert "pectine" not in answer.casefold()


def test_calcium_carbonate_action_is_removed_and_warned() -> None:
    answer = full_answer(
        "| 1 | Précipitation | Précipitation ou turbidité physique | Modérée | AUTO | Observation | [S1] |",
        "| Ajouter du carbonate de calcium pour augmenter le pH | [S1] | Faible | Minéral | Simple | Aucun |",
    )

    guarded = apply_chemistry_guardrails(
        answer,
        "Soda citron-lime contenant de l'acide citrique et présentant un dépôt.",
        CHEMISTRY_POLICY,
        EVIDENCE_POLICY.no_safe_action_message,
    )

    assert guarded.blocked_actions == (
        "Ajouter du carbonate de calcium pour augmenter le pH",
    )
    assert "| Ajouter du carbonate de calcium" not in guarded.answer
    assert "citrate de calcium peu soluble" in guarded.answer
    assert "Aucune action corrective à la fois sûre" in guarded.answer


def test_pipeline_returns_gap_before_generation_for_the_real_turbidity_query() -> None:
    noise = result(
        "noise",
        "The orange soft drink had a measured pH of 3.53 during storage.",
        0.97,
    )

    class FakeStore:
        def search(self, *args, **kwargs):
            return [noise]

    class GeneratorMustNotRun:
        def decompose_question(self, *args, **kwargs):
            return []

        def generate(self, *args, **kwargs):
            raise AssertionError("Generation must not run when the required mechanism is absent")

    pipeline = RagPipeline(
        Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml"),
        store=FakeStore(),
        generator=GeneratorMustNotRun(),
    )
    pipeline.reranker.rerank = lambda question, candidates: candidates

    response = pipeline.ask("précipitation trouble soda citron-lime")

    assert "Aucune source pertinente trouvée" in response.answer
    assert "citrate" not in response.answer.casefold()
    assert "pectine" not in response.answer.casefold()
    assert response.sources == []


def test_known_mechanism_uses_canonical_query_without_llm_decomposition() -> None:
    noise = result(
        "noise",
        "The orange soft drink had a measured pH of 3.53 during storage.",
        0.97,
    )

    class FakeStore:
        def __init__(self) -> None:
            self.queries: list[str] = []

        def search(self, query, *args, **kwargs):
            self.queries.append(query)
            return [noise]

    class NoDecompositionGenerator:
        def decompose_question(self, *args, **kwargs):
            raise AssertionError("Canonical mechanisms must not call the LLM decomposer")

    store = FakeStore()
    pipeline = RagPipeline(
        Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml"),
        store=store,
        generator=NoDecompositionGenerator(),
    )
    pipeline.reranker.rerank = lambda question, candidates: candidates

    pipeline._retrieve_evidence(
        "précipitation trouble soda citron-lime", None, None, None
    )

    assert any("precipitation turbidity" in query for query in store.queries)


def test_pipeline_blocks_unsafe_calcium_carbonate_recommendation() -> None:
    relevant = result(
        "relevant",
        "A carbonated soft drink developed precipitation and turbidity during storage.",
        0.85,
    )
    draft = full_answer(
        "| 1 | Précipitation physique | Précipitation ou turbidité physique | Moyenne | AUTO | Trouble observé | [S1] |",
        "| Ajouter du carbonate de calcium pour augmenter le pH | [S1] | Faible | Minéral | Simple | Aucun |",
    )

    class FakeStore:
        def search(self, *args, **kwargs):
            return [relevant]

    class FakeGenerator:
        def decompose_question(self, *args, **kwargs):
            return []

        def generate(self, *args, **kwargs):
            return draft

        def revise_answer(self, *args, **kwargs):
            return draft

    pipeline = RagPipeline(
        Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml"),
        store=FakeStore(),
        generator=FakeGenerator(),
    )
    pipeline.reranker.rerank = lambda question, candidates: [relevant]
    pipeline.retriever.llama_nodes = lambda results: []

    response = pipeline.ask(
        "Mon soda citron-lime à l'acide citrique est trouble. Comment corriger son pH ?"
    )

    assert "79/100 — Modéré" in response.answer
    assert "| Ajouter du carbonate de calcium" not in response.answer
    assert "citrate de calcium peu soluble" in response.answer
    assert "Aucune action corrective à la fois sûre" in response.answer
