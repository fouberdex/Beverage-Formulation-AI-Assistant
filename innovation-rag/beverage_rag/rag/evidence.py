from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from beverage_rag.rag.citations import CITATION_RE
from beverage_rag.schemas import RetrievedChunk


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = normalized.replace("’", "'").replace("‑", "-").replace("–", "-")
    return re.sub(r"\s+", " ", normalized).strip()


def contains_term(text: str, term: str) -> bool:
    haystack = normalize_text(text)
    needle = normalize_text(term)
    return bool(
        needle
        and re.search(rf"(?<![\w]){re.escape(needle)}(?![\w])", haystack)
    )


def contains_any(text: str, terms: list[str]) -> bool:
    return any(contains_term(text, term) for term in terms)


@dataclass(frozen=True)
class MechanismRule:
    mechanism_id: str
    label: str
    aliases: list[str]
    entity_groups: list[list[str]]
    outcomes: list[str]
    context: list[str]
    search_queries: list[str]

    def supports(self, text: str) -> bool:
        sentences = [
            item.strip()
            for item in re.split(r"(?<=[.!?])\s+|[\r\n]+", text)
            if item.strip()
        ]
        windows = list(sentences)
        windows.extend(
            f"{sentences[index]} {sentences[index + 1]}"
            for index in range(len(sentences) - 1)
        )
        for window in windows or [text]:
            if self.entity_groups and not all(
                contains_any(window, group) for group in self.entity_groups
            ):
                continue
            if self.outcomes and not contains_any(window, self.outcomes):
                continue
            if self.context and not contains_any(window, self.context):
                continue
            return True
        return False

    def is_named_in(self, text: str) -> bool:
        if contains_any(text, self.aliases):
            return True
        return bool(
            self.entity_groups
            and all(contains_any(text, group) for group in self.entity_groups)
            and (not self.outcomes or contains_any(text, self.outcomes))
        )


@dataclass(frozen=True)
class EvidencePolicy:
    path: Path
    enabled: bool
    gap_max_score: float
    supporting_source_min_score: float
    maximum_retrieval_attempts: int
    reranker_weight: float
    source_weight: float
    single_source_credit: float
    strong: dict[str, float | int]
    moderate: dict[str, float | int]
    remove_unsupported_causes: bool
    maximum_generation_attempts: int
    retrieval_failure_message: str
    quality_failure_message: str
    no_safe_action_message: str
    mechanisms: dict[str, MechanismRule]

    @classmethod
    def load(cls, path: Path) -> "EvidencePolicy":
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        relevance = payload["relevance"]
        proof = payload["proof"]
        fallback = payload["fallback"]
        mechanisms = {
            mechanism_id: MechanismRule(
                mechanism_id=mechanism_id,
                label=value["label"],
                aliases=list(value.get("aliases", [])),
                entity_groups=[list(group) for group in value.get("entity_groups", [])],
                outcomes=list(value.get("outcomes", [])),
                context=list(value.get("context", [])),
                search_queries=list(value.get("search_queries", [])),
            )
            for mechanism_id, value in payload.get("mechanisms", {}).items()
        }
        policy = cls(
            path=path,
            enabled=bool(payload.get("enabled", True)),
            gap_max_score=float(relevance["gap_max_score"]),
            supporting_source_min_score=float(
                relevance["supporting_source_min_score"]
            ),
            maximum_retrieval_attempts=int(relevance["maximum_retrieval_attempts"]),
            reranker_weight=float(proof["reranker_weight"]),
            source_weight=float(proof["source_weight"]),
            single_source_credit=float(proof["single_source_credit"]),
            strong=dict(proof["strong"]),
            moderate=dict(proof["moderate"]),
            remove_unsupported_causes=bool(
                payload.get("display", {}).get("remove_unsupported_causes", True)
            ),
            maximum_generation_attempts=int(fallback["maximum_generation_attempts"]),
            retrieval_failure_message=str(fallback["retrieval_failure_message"]),
            quality_failure_message=str(fallback["quality_failure_message"]),
            no_safe_action_message=str(fallback["no_safe_action_message"]),
            mechanisms=mechanisms,
        )
        if abs(policy.reranker_weight + policy.source_weight - 1.0) > 1e-9:
            raise ValueError("Evidence proof weights must sum to 1.0")
        bounded_scores = (
            policy.gap_max_score,
            policy.supporting_source_min_score,
            float(policy.strong["minimum_best_reranker_score"]),
            float(policy.moderate["minimum_best_reranker_score"]),
        )
        if any(score < 0 or score > 1 for score in bounded_scores):
            raise ValueError("Evidence reranker thresholds must be between 0 and 1")
        return policy

    def mechanisms_named_in(self, text: str) -> list[MechanismRule]:
        return [rule for rule in self.mechanisms.values() if rule.is_named_in(text)]

    def resolve_cause_mechanism(self, text: str) -> MechanismRule | None:
        matches = self.mechanisms_named_in(text)
        if not matches:
            return None
        return max(
            matches,
            key=lambda rule: (
                len(rule.entity_groups),
                max((len(alias) for alias in rule.aliases), default=0),
            ),
        )


@dataclass(frozen=True)
class ProofAssessment:
    mechanism_id: str | None
    mechanism_match: bool
    best_reranker_score: float
    independent_sources: int
    calculated_score: int
    level: str | None


@dataclass(frozen=True)
class EvidenceControlResult:
    answer: str
    proof_table_found: bool
    controlled_rows: int
    removed_causes: tuple[str, ...]


def independent_source_key(result: RetrievedChunk) -> str:
    chunk = result.chunk
    if chunk.document_type == "publication" and chunk.doi:
        return f"doi:{chunk.doi.casefold()}"
    patent_family = chunk.metadata.get("family_id") or chunk.metadata.get("familyId")
    if chunk.document_type == "patent" and patent_family:
        return f"patent-family:{patent_family}"
    return f"document:{chunk.document_id}"


def citation_result_map(results: list[RetrievedChunk]) -> dict[str, list[RetrievedChunk]]:
    document_labels: dict[str, str] = {}
    mapped: dict[str, list[RetrievedChunk]] = {}
    for result in results:
        document_id = result.chunk.document_id
        if document_id not in document_labels:
            document_labels[document_id] = f"S{len(document_labels) + 1}"
        mapped.setdefault(document_labels[document_id], []).append(result)
    return mapped


def assess_proof(
    cause_and_mechanism: str,
    cited_results: list[RetrievedChunk],
    policy: EvidencePolicy,
) -> ProofAssessment:
    rule = policy.resolve_cause_mechanism(cause_and_mechanism)
    if rule is None:
        return ProofAssessment(None, False, 0.0, 0, 0, None)
    matching = [item for item in cited_results if rule.supports(item.chunk.text)]
    if not matching:
        return ProofAssessment(rule.mechanism_id, False, 0.0, 0, 0, None)
    best_score = max(item.score for item in matching)
    supporting = [
        item
        for item in matching
        if item.score >= policy.supporting_source_min_score
    ]
    source_count = len({independent_source_key(item) for item in supporting})
    if source_count == 0:
        source_credit = 0.0
    elif source_count == 1:
        source_credit = policy.single_source_credit
    else:
        source_credit = 1.0
    calculated = round(
        100
        * (
            policy.reranker_weight * best_score
            + policy.source_weight * source_credit
        )
    )
    strong = policy.strong
    moderate = policy.moderate
    if (
        best_score >= float(strong["minimum_best_reranker_score"])
        and source_count >= int(strong["minimum_independent_sources"])
        and calculated >= int(strong["minimum_calculated_score"])
    ):
        level = "Fort"
    elif (
        best_score >= float(moderate["minimum_best_reranker_score"])
        and source_count >= int(moderate["minimum_independent_sources"])
        and calculated >= int(moderate["minimum_calculated_score"])
    ):
        level = "Modéré"
        calculated = min(calculated, int(strong["minimum_calculated_score"]) - 1)
    else:
        level = None
    return ProofAssessment(
        rule.mechanism_id,
        True,
        best_score,
        source_count,
        calculated,
        level,
    )


def find_evidence_gaps(
    question: str,
    results: list[RetrievedChunk],
    policy: EvidencePolicy,
) -> list[MechanismRule]:
    gaps: list[MechanismRule] = []
    for rule in policy.mechanisms_named_in(question):
        matching_scores = [
            item.score for item in results if rule.supports(item.chunk.text)
        ]
        if not matching_scores or max(matching_scores) < policy.gap_max_score:
            gaps.append(rule)
    return gaps


def gap_clauses(gaps: list[MechanismRule], policy: EvidencePolicy) -> list[str]:
    return [
        policy.retrieval_failure_message.format(mechanism=rule.label)
        for rule in gaps
    ]


def _table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_separator(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def _header_index(headers: list[str], *names: str) -> int | None:
    normalized = [normalize_text(header) for header in headers]
    for index, header in enumerate(normalized):
        if any(name in header for name in names):
            return index
    return None


def insert_under_section(answer: str, marker: str, additions: list[str]) -> str:
    additions = [addition for addition in additions if addition not in answer]
    if not additions:
        return answer
    lines = answer.splitlines()
    marker_normalized = normalize_text(marker)
    heading_index = next(
        (
            index
            for index, line in enumerate(lines)
            if line.lstrip().startswith("#") and marker_normalized in normalize_text(line)
        ),
        None,
    )
    block = [f"- {addition}" for addition in additions]
    if heading_index is None:
        return answer.rstrip() + "\n\n## Données manquantes pour trancher\n" + "\n".join(block)
    insertion = heading_index + 1
    while insertion < len(lines) and not lines[insertion].strip():
        insertion += 1
    lines[insertion:insertion] = block + [""]
    return "\n".join(lines)


def apply_evidence_controls(
    answer: str,
    results: list[RetrievedChunk],
    policy: EvidencePolicy,
) -> EvidenceControlResult:
    lines = answer.splitlines()
    mapped = citation_result_map(results)
    removed: list[str] = []
    controlled_rows = 0
    table_found = False
    index = 0
    while index < len(lines):
        if "|" not in lines[index]:
            index += 1
            continue
        headers = _table_cells(lines[index])
        cause_index = _header_index(headers, "cause")
        mechanism_index = _header_index(headers, "mecanisme")
        proof_index = _header_index(headers, "niveau de preuve", "score de preuve")
        source_index = _header_index(headers, "source")
        if None in (cause_index, mechanism_index, proof_index, source_index):
            index += 1
            continue
        table_found = True
        headers[proof_index] = "Score de preuve calculé"
        lines[index] = "| " + " | ".join(headers) + " |"
        row_index = index + 1
        if row_index < len(lines) and _is_separator(_table_cells(lines[row_index])):
            row_index += 1
        kept_rows = 0
        while row_index < len(lines) and lines[row_index].strip().startswith("|"):
            cells = _table_cells(lines[row_index])
            if len(cells) != len(headers) or _is_separator(cells):
                row_index += 1
                continue
            citation_ids = {
                f"S{number}"
                for number in CITATION_RE.findall(" ".join(cells))
            }
            cited_results = [
                item for citation_id in citation_ids for item in mapped.get(citation_id, [])
            ]
            assessment = assess_proof(
                f"{cells[cause_index]} {cells[mechanism_index]}",
                cited_results,
                policy,
            )
            if assessment.level is None and policy.remove_unsupported_causes:
                removed.append(cells[cause_index])
                del lines[row_index]
                continue
            level = assessment.level or "Non soutenue"
            cells[proof_index] = f"{assessment.calculated_score}/100 — {level}"
            lines[row_index] = "| " + " | ".join(cells) + " |"
            controlled_rows += 1
            kept_rows += 1
            row_index += 1
        if kept_rows == 0:
            placeholder = ["—"] * len(headers)
            placeholder[cause_index] = "Aucune cause suffisamment soutenue"
            placeholder[mechanism_index] = "—"
            placeholder[proof_index] = "0/100 — Non soutenue"
            placeholder[source_index] = "—"
            lines.insert(row_index, "| " + " | ".join(placeholder) + " |")
            controlled_rows += 1
        index = row_index + 1
    controlled_answer = "\n".join(lines)
    missing = [
        f"Hypothèse « {cause} » non soutenue par les sources récupérées ; données ciblées nécessaires pour l’évaluer."
        for cause in removed
    ]
    controlled_answer = insert_under_section(
        controlled_answer, "données manquantes", missing
    )
    return EvidenceControlResult(
        answer=controlled_answer,
        proof_table_found=table_found,
        controlled_rows=controlled_rows,
        removed_causes=tuple(removed),
    )


def build_gap_answer(clauses: list[str]) -> str:
    joined = "\n".join(f"- {clause}" for clause in clauses)
    return f"""## 1. Diagnostic synthétique
{joined}

## 2. Causes hiérarchisées
Aucune cause suffisamment soutenue ne peut être retenue.

## 3. Données précises extraites des documents
Aucune donnée pertinente disponible pour le mécanisme demandé.

## 4. Données manquantes pour trancher
{joined}

## 5. Essais de confirmation prioritaires
Définir un protocole comparatif contre témoin avant toute modification de formulation.

## 6. Actions correctives et arbitrages industriels
Aucune recommandation technique n’est fournie en l’absence de preuve pertinente.

## 7. Incertitudes et limites
Le corpus actuel ne couvre pas suffisamment le mécanisme demandé.

## 8. Sources utilisées
Aucune source pertinente retenue."""


def build_quality_failure_answer(message: str, clauses: list[str]) -> str:
    missing = "\n".join(f"- {clause}" for clause in clauses) or "- Preuves insuffisantes."
    return f"""## 1. Diagnostic synthétique
{message}

## 2. Causes hiérarchisées
Aucune cause n’est publiée car les contrôles de preuve ont échoué.

## 3. Données précises extraites des documents
Aucune donnée n’est présentée comme concluante.

## 4. Données manquantes pour trancher
{missing}

## 5. Essais de confirmation prioritaires
Définir un protocole comparatif contre témoin avant toute modification de formulation.

## 6. Actions correctives et arbitrages industriels
Aucune recommandation technique n’est fournie.

## 7. Incertitudes et limites
Le contrôle automatique n’a pas pu établir une réponse suffisamment fiable.

## 8. Sources utilisées
Aucune source publiée comme preuve."""
