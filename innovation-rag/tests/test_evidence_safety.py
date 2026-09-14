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


def gpu_settings_without_diagnostic_log() -> Settings:
    settings = Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml")
    settings.diagnostics_file = None
    return settings


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
| Paramètre/observation | Valeur et conditions | Portée | Source |
|---|---|---|---|
| Observation | Valeur test | Conditions de la fixture | [S1] |

## 4. Données manquantes pour trancher
Mesures complémentaires nécessaires.

## 5. Essais de confirmation prioritaires
| Hypothèse | Mesure | Protocole comparatif | Critère de décision | Délai |
|---|---|---|---|---|
| Hypothèse test | Mesure | Essai contre témoin | Différence mesurable | À définir [S1] |

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


def test_preservative_and_acidity_reductions_are_blocked_for_acid_soda() -> None:
    answer = full_answer(
        "| 1 | Instabilité de l’émulsion | Instabilité de l’émulsion ou de l’agent de trouble | Moyenne | AUTO | Observation | [S1] |",
        "| Réduire la dose de benzoate de sodium | [S1] | Faible | Faible | Simple | Aucun |\n"
        "| Réduire l’acidité | [S1] | Faible | Faible | Simple | Aucun |",
    )
    question = (
        "Soda citron-lime avec acide citrique, benzoate de sodium et acide "
        "ascorbique : trouble et arôme altéré."
    )

    guarded = apply_chemistry_guardrails(
        answer,
        question,
        CHEMISTRY_POLICY,
        EVIDENCE_POLICY.no_safe_action_message,
    )

    assert set(guarded.blocked_actions) == {
        "Réduire la dose de benzoate de sodium",
        "Réduire l’acidité",
    }
    assert "challenge microbiologique" in guarded.answer
    assert "association benzoate–ascorbate" in guarded.answer
    assert "Point de vigilance indépendant du trouble" in guarded.answer


def test_generic_physical_symptom_cannot_be_published_as_a_cause() -> None:
    evidence = [
        result(
            "generic-haze",
            "A carbonated beverage developed turbidity and sediment during storage.",
            0.90,
        )
    ]
    answer = full_answer(
        "| 1 | Acidité excessive | Précipitation ou turbidité physique | Moyenne | AUTO | Observation | [S1] |",
        "| Mesurer la turbidité | [S1] | Faible | Aucun | Simple | À valider |",
    )

    controlled = apply_evidence_controls(
        answer,
        evidence,
        EVIDENCE_POLICY,
        "Soda citron-lime trouble au stockage.",
    )

    assert "Aucune cause suffisamment soutenue" in controlled.answer
    assert "90/100" not in controlled.answer


def test_pectin_protein_source_is_inapplicable_when_ingredients_are_absent() -> None:
    evidence = [
        result(
            "protein-haze",
            "Pectin and whey protein aggregated and caused turbidity in an acidic beverage.",
            0.91,
        )
    ]
    answer = full_answer(
        "| 1 | Floculation pectine-protéine | Interaction pectine-protéine et floculation | Moyenne | AUTO | Relation observée | [S1] |",
        "| Mesurer la turbidité | [S1] | Faible | Aucun | Simple | À valider |",
    )

    controlled = apply_evidence_controls(
        answer,
        evidence,
        EVIDENCE_POLICY,
        "Soda citron-lime avec acide citrique, benzoate et acide ascorbique.",
    )

    assert "Aucune cause suffisamment soutenue" in controlled.answer
    assert "91/100" not in controlled.answer


def test_formula_entities_trigger_distinct_physical_and_flavor_mechanisms() -> None:
    question = (
        "Soda citron-lime avec acide citrique, benzoate de sodium et acide "
        "ascorbique en bouteille PET : léger trouble et arôme altéré."
    )

    mechanism_ids = {
        rule.mechanism_id for rule in EVIDENCE_POLICY.mechanisms_named_in(question)
    }

    assert "physical_precipitation_turbidity" in mechanism_ids
    assert "clouding_emulsion_instability" in mechanism_ids
    assert "benzoic_acid_crystallization" in mechanism_ids
    assert "citrus_flavor_oxidation" in mechanism_ids
    assert "ascorbate_flavor_oxidation" in mechanism_ids
    assert "pet_oxygen_ingress" in mechanism_ids


def test_orange_juice_browning_maps_to_an_umbrella_with_specific_mechanisms() -> None:
    question = (
        "Un jus d'orange pasteurisé perd sa couleur orangée et devient brunâtre "
        "après 3 mois de stockage."
    )

    named = EVIDENCE_POLICY.mechanisms_named_in(question)
    named_ids = {rule.mechanism_id for rule in named}
    umbrella = next(
        rule for rule in named if rule.mechanism_id == "orange_juice_browning"
    )
    evidence_ids = {
        rule.mechanism_id
        for rule in EVIDENCE_POLICY.evidence_rules_for(umbrella, question)
    }

    assert named_ids == {"orange_juice_browning"}
    assert evidence_ids == {
        "ascorbic_acid_browning",
        "juice_nonenzymatic_browning",
        "carotenoid_oxidation_color_loss",
        "residual_enzyme_juice_browning",
    }


def test_orange_juice_browning_requires_a_beverage_mechanism_not_generic_color() -> None:
    umbrella = EVIDENCE_POLICY.mechanisms["orange_juice_browning"]
    question = "Jus d'orange pasteurisé devenu brunâtre pendant le stockage."
    rules = EVIDENCE_POLICY.evidence_rules_for(umbrella, question)
    supported = (
        "During storage of orange juice, ascorbic acid degradation produced "
        "furfural and was associated with browning and color loss."
    )
    dental_noise = (
        "The dental restorative material showed color loss and darkening "
        "after accelerated storage."
    )

    assert any(rule.supports(supported) for rule in rules)
    assert not any(rule.supports(dental_noise) for rule in rules)


def test_question_context_disambiguates_ascorbate_browning_from_flavor_rule() -> None:
    question = "Un jus d'orange pasteurisé devient brunâtre pendant le stockage."
    cause = (
        "Brunissement non enzymatique dû à la dégradation de l'ascorbic acid; "
        "des carbonyles réactifs entraînent le brunissement."
    )

    resolved = EVIDENCE_POLICY.resolve_cause_mechanism(cause, question)

    assert resolved is not None
    assert resolved.mechanism_id == "ascorbic_acid_browning"


def test_french_nonenzymatic_browning_word_order_resolves_to_juice_rule() -> None:
    question = "Un jus d'orange pasteurisé devient brunâtre pendant le stockage."
    cause = (
        "Réaction non enzymatique de brunissement; les composés formés "
        "entraînent le brunissement du jus."
    )

    resolved = EVIDENCE_POLICY.resolve_cause_mechanism(cause, question)

    assert resolved is not None
    assert resolved.mechanism_id == "juice_nonenzymatic_browning"


def test_official_mechanism_label_is_always_recognized() -> None:
    question = "Un jus d'orange pasteurisé devient brunâtre pendant le stockage."
    label = EVIDENCE_POLICY.mechanisms["ascorbic_acid_browning"].label

    resolved = EVIDENCE_POLICY.resolve_cause_mechanism(
        f"Cause probable | {label}", question
    )

    assert resolved is not None
    assert resolved.mechanism_id == "ascorbic_acid_browning"


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
        gpu_settings_without_diagnostic_log(),
        store=FakeStore(),
        generator=GeneratorMustNotRun(),
    )
    pipeline.reranker.rerank = lambda question, candidates: candidates

    response = pipeline.ask("précipitation trouble soda citron-lime")

    assert "Aucune source pertinente trouvée" in response.answer
    assert "citrate" not in response.answer.casefold()
    assert "pectine" not in response.answer.casefold()
    assert response.sources == []
    assert len(response.retrieved_candidates) == 1
    assert response.diagnostics is not None
    assert response.diagnostics.status == "evidence_gap"
    assert response.diagnostics.generation_invoked is False


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
        gpu_settings_without_diagnostic_log(),
        store=store,
        generator=NoDecompositionGenerator(),
    )
    pipeline.reranker.rerank = lambda question, candidates: candidates

    pipeline.ask("précipitation trouble soda citron-lime")

    assert any("citrus beverage emulsion" in query for query in store.queries)
    assert any("citrus beverage emulsion instability" in query for query in store.queries)
    assert not any("calcium citrate precipitation" in query for query in store.queries)
    assert not any("pectin protein flocculation" in query for query in store.queries)


def test_pipeline_blocks_unsafe_calcium_carbonate_recommendation() -> None:
    relevant = result(
        "relevant",
        "A citrus beverage emulsion became unstable and produced turbidity and "
        "sediment in a carbonated soft drink during storage.",
        0.85,
    )
    draft = full_answer(
        "| 1 | Instabilité de l’émulsion | Instabilité de l’émulsion ou de l’agent de trouble | Moyenne | AUTO | Trouble observé | [S1] |",
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
        gpu_settings_without_diagnostic_log(),
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
    assert response.diagnostics is not None
    assert response.diagnostics.generation_invoked is True
