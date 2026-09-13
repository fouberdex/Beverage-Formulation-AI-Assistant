from __future__ import annotations

import re
from datetime import date

from beverage_rag.indexing.qdrant_store import QdrantHybridStore
from beverage_rag.rag.chemistry import (
    ChemistryControlResult,
    ChemistryPolicy,
    apply_chemistry_guardrails,
)
from beverage_rag.rag.citations import CITATION_RE, build_references, ensure_citations
from beverage_rag.rag.evidence import (
    EvidenceControlResult,
    EvidencePolicy,
    apply_evidence_controls,
    build_gap_answer,
    build_quality_failure_answer,
    find_evidence_gaps,
    gap_clauses,
    insert_under_section,
)
from beverage_rag.rag.generation import LocalGenerator
from beverage_rag.rag.reranking import Reranker
from beverage_rag.rag.retrieval import HybridRetriever, reciprocal_rank_fusion
from beverage_rag.schemas import RagAnswer, RetrievedChunk
from beverage_rag.settings import Settings


def build_context(
    results: list[RetrievedChunk], max_chars: int | None = None
) -> str:
    document_labels: dict[str, str] = {}
    sections: list[str] = []
    for result in results:
        chunk = result.chunk
        if chunk.document_id not in document_labels:
            document_labels[chunk.document_id] = f"S{len(document_labels) + 1}"
        label = document_labels[chunk.document_id]
        classes = ", ".join((chunk.ipc_classes + chunk.cpc_classes)[:8]) or "non indiqué"
        section = (
            f"[{label}] {chunk.citation_label()} | IDENTIFIANT={chunk.citation_label()}\n"
            f"TYPE={chunk.document_type}; SOURCE={chunk.source}; TITRE={chunk.title}\n"
            f"DATE={chunk.publication_date or 'non indiquée'}; PAYS={chunk.country or 'non indiqué'}; "
            f"SECTION={chunk.section}; CLASSES={classes}; SCORE_RERANK={result.score:.4f}\n"
            f"EXTRAIT:\n{chunk.text}"
        )
        projected_size = sum(len(item) for item in sections) + len(section) + 2 * len(sections)
        if max_chars is not None and projected_size > max_chars:
            if not sections:
                sections.append(section[:max_chars].rstrip() + "\n[EXTRAIT TRONQUÉ]")
            break
        sections.append(section)
    return "\n\n".join(sections)


def answer_passes_quality_gate(
    answer: str,
    valid_source_count: int,
    evidence_control: EvidenceControlResult | None = None,
    chemistry_control: ChemistryControlResult | None = None,
    required_gap_clauses: list[str] | None = None,
) -> bool:
    normalized = answer.casefold()
    required_markers = (
        "diagnostic",
        "causes hiérarchisées",
        "données précises",
        "données manquantes",
        "essais de confirmation",
        "actions correctives",
        "incertitudes",
        "sources utilisées",
    )
    if not all(marker in normalized for marker in required_markers):
        return False
    valid_ids = {f"S{number}" for number in range(1, valid_source_count + 1)}
    cited_ids = {f"S{number}" for number in CITATION_RE.findall(answer)} & valid_ids
    if evidence_control is None and chemistry_control is None:
        return len(cited_ids) >= min(3, valid_source_count)
    if evidence_control is None or not evidence_control.proof_table_found:
        return False
    if evidence_control.controlled_rows < 1:
        return False
    if not re.search(r"\b\d{1,3}/100\s+[—-]\s+(?:Fort|Modéré|Non soutenue)\b", answer):
        return False
    if chemistry_control is None or not chemistry_control.action_table_found:
        return False
    if chemistry_control.unsafe_action_remaining:
        return False
    if not action_rows_have_valid_citations(answer, valid_ids):
        return False
    if required_gap_clauses and not all(
        clause in answer for clause in required_gap_clauses
    ):
        return False
    return bool(cited_ids) or "Aucune cause suffisamment soutenue" in answer


def action_rows_have_valid_citations(answer: str, valid_ids: set[str]) -> bool:
    lines = answer.splitlines()
    for index, line in enumerate(lines):
        if "|" not in line:
            continue
        headers = [cell.strip().casefold() for cell in line.strip().strip("|").split("|")]
        if not any(header == "action" for header in headers):
            continue
        action_index = headers.index("action")
        row_index = index + 1
        if row_index < len(lines) and re.fullmatch(
            r"\s*\|?\s*:?-{3,}.*", lines[row_index]
        ):
            row_index += 1
        while row_index < len(lines) and lines[row_index].strip().startswith("|"):
            cells = [cell.strip() for cell in lines[row_index].strip().strip("|").split("|")]
            if len(cells) != len(headers):
                row_index += 1
                continue
            action = cells[action_index]
            if action.startswith("Aucune action corrective"):
                row_index += 1
                continue
            cited = {f"S{number}" for number in CITATION_RE.findall(" ".join(cells))}
            if not cited.intersection(valid_ids):
                return False
            row_index += 1
        return True
    return False


class RagPipeline:
    def __init__(
        self,
        settings: Settings,
        store: QdrantHybridStore | None = None,
        generator: LocalGenerator | None = None,
    ) -> None:
        self.settings = settings
        self.retriever = HybridRetriever(store or QdrantHybridStore(settings))
        self.generator = generator or LocalGenerator(settings.generation)
        self.reranker = Reranker(settings.reranking)
        self.evidence_policy = (
            EvidencePolicy.load(settings.resolve_path(settings.evidence_policy_file))
            if settings.evidence_policy_file
            else None
        )
        self.chemistry_policy = (
            ChemistryPolicy.load(settings.resolve_path(settings.chemistry_rules_file))
            if settings.chemistry_rules_file
            else None
        )

    def _retrieve_evidence(
        self,
        question: str,
        source: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> list[RetrievedChunk]:
        retrieval = self.settings.retrieval
        queries = [question]
        if retrieval.multi_query_enabled:
            canonical_queries: list[str] = []
            if self.evidence_policy:
                for rule in self.evidence_policy.mechanisms_named_in(question):
                    canonical_queries.extend(rule.search_queries[:1])
            if canonical_queries:
                queries.extend(canonical_queries[: retrieval.max_subqueries])
            else:
                try:
                    queries.extend(
                        self.generator.decompose_question(
                            question, max_queries=retrieval.max_subqueries
                        )
                    )
                except Exception:
                    # Retrieval remains available if the remote decomposition call fails.
                    pass
        queries = list(dict.fromkeys(query.strip() for query in queries if query.strip()))
        ranked_lists = [
            self.retriever.retrieve(
                query,
                source,
                date_from,
                date_to,
                top_k=retrieval.candidates_per_query,
            )
            for query in queries
        ]
        if source is None and retrieval.source_balancing_enabled:
            # Add dedicated evidence lanes so a globally dominant patent corpus cannot
            # completely hide peer-reviewed evidence, or vice versa.
            for source_name in ("google_patents_bigquery", "semantic_scholar"):
                ranked_lists.append(
                    self.retriever.retrieve(
                        question,
                        source_name,
                        date_from,
                        date_to,
                        top_k=retrieval.candidates_per_query,
                    )
                )
        fused = reciprocal_rank_fusion(ranked_lists, rrf_k=retrieval.rrf_k)
        reranked = self.reranker.rerank(question, fused)
        return reranked[: retrieval.top_k]

    def _retry_missing_mechanisms(
        self,
        gaps,
        results: list[RetrievedChunk],
        source: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> list[RetrievedChunk]:
        retrieval = self.settings.retrieval
        by_chunk = {item.chunk.id: item for item in results}
        for rule in gaps:
            retry_queries = rule.search_queries[1:] or rule.search_queries
            for query in retry_queries:
                candidates = self.retriever.retrieve(
                    query,
                    source,
                    date_from,
                    date_to,
                    top_k=retrieval.candidates_per_query,
                )
                for item in self.reranker.rerank(query, candidates):
                    previous = by_chunk.get(item.chunk.id)
                    if previous is None or item.score > previous.score:
                        by_chunk[item.chunk.id] = item
        limit = max(retrieval.top_k, self.settings.reranking.top_n)
        return sorted(by_chunk.values(), key=lambda item: item.score, reverse=True)[:limit]

    def _apply_strict_controls(
        self,
        answer: str,
        question: str,
        results: list[RetrievedChunk],
        clauses: list[str],
    ) -> tuple[str, EvidenceControlResult, ChemistryControlResult]:
        assert self.evidence_policy is not None
        assert self.chemistry_policy is not None
        evidence = apply_evidence_controls(answer, results, self.evidence_policy)
        controlled_answer = insert_under_section(
            evidence.answer, "données manquantes", clauses
        )
        chemistry = apply_chemistry_guardrails(
            controlled_answer,
            question,
            self.chemistry_policy,
            self.evidence_policy.no_safe_action_message,
        )
        return chemistry.answer, evidence, chemistry

    def ask(
        self,
        question: str,
        source: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> RagAnswer:
        if not question.strip():
            raise ValueError("Question cannot be empty")
        results = self._retrieve_evidence(question, source, date_from, date_to)
        if not results:
            return RagAnswer(
                answer="Aucune source pertinente n'a été trouvée dans l'index local.",
                sources=[],
            )
        strict = bool(
            self.evidence_policy
            and self.evidence_policy.enabled
            and self.chemistry_policy
            and self.chemistry_policy.enabled
            and self.settings.reranking.enabled
        )
        gaps = []
        if strict:
            assert self.evidence_policy is not None
            gaps = find_evidence_gaps(question, results, self.evidence_policy)
            if gaps and self.evidence_policy.maximum_retrieval_attempts > 1:
                results = self._retry_missing_mechanisms(
                    gaps, results, source, date_from, date_to
                )
                gaps = find_evidence_gaps(question, results, self.evidence_policy)
            required = self.evidence_policy.mechanisms_named_in(question)
            if required and len(gaps) == len(required):
                clauses = gap_clauses(gaps, self.evidence_policy)
                return RagAnswer(answer=build_gap_answer(clauses), sources=[])
        references = build_references(results)
        # Materialize LlamaIndex nodes at the orchestration boundary so callers can
        # extend this pipeline with rerankers without changing the storage layer.
        self.retriever.llama_nodes(results)
        context = build_context(
            results, max_chars=self.settings.generation.max_context_chars
        )
        clauses = gap_clauses(gaps, self.evidence_policy) if strict else []
        if clauses:
            context += "\n\nLACUNES À REPRENDRE MOT POUR MOT:\n" + "\n".join(clauses)
        answer = self.generator.generate(question, context)
        if strict:
            assert self.evidence_policy is not None
            attempts = max(1, self.evidence_policy.maximum_generation_attempts)
            for attempt in range(attempts):
                controlled, evidence, chemistry = self._apply_strict_controls(
                    answer, question, results, clauses
                )
                if answer_passes_quality_gate(
                    controlled,
                    len(references),
                    evidence,
                    chemistry,
                    clauses,
                ):
                    return RagAnswer(answer=controlled, sources=references)
                if attempt + 1 < attempts:
                    answer = self.generator.revise_answer(question, context, controlled)
            return RagAnswer(
                answer=build_quality_failure_answer(
                    self.evidence_policy.quality_failure_message, clauses
                ),
                sources=[],
            )
        if (
            self.settings.generation.quality_gate_enabled
            and not answer_passes_quality_gate(answer, len(references))
        ):
            answer = self.generator.revise_answer(question, context, answer)
        return RagAnswer(answer=ensure_citations(answer, references), sources=references)
