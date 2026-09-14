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
from beverage_rag.rag.diagnostics import (
    DiagnosticCollector,
    DiagnosticJsonlWriter,
    DiagnosticPolicy,
)
from beverage_rag.rag.evidence import (
    EvidenceControlResult,
    EvidencePolicy,
    ProofAssessment,
    apply_evidence_controls,
    build_gap_answer,
    build_quality_failure_answer,
    citation_result_map,
    find_evidence_gaps,
    gap_clauses,
    independent_source_key,
    insert_under_section,
    proof_claim_key,
)
from beverage_rag.rag.generation import LocalGenerator
from beverage_rag.rag.reranking import Reranker
from beverage_rag.rag.retrieval import HybridRetriever, reciprocal_rank_fusion
from beverage_rag.schemas import (
    RagAnswer,
    RagDiagnosticReport,
    RagDiagnostics,
    RetrievedChunk,
)
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
    results: list[RetrievedChunk] | None = None,
) -> bool:
    return not quality_gate_failures(
        answer,
        valid_source_count,
        evidence_control,
        chemistry_control,
        required_gap_clauses,
        results,
    )


def quality_gate_failures(
    answer: str,
    valid_source_count: int,
    evidence_control: EvidenceControlResult | None = None,
    chemistry_control: ChemistryControlResult | None = None,
    required_gap_clauses: list[str] | None = None,
    results: list[RetrievedChunk] | None = None,
) -> list[str]:
    """Return stable diagnostic codes while preserving the existing gate policy."""
    failures: list[str] = []
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
        failures.append("missing_required_section")
    required_tables = (
        ("rang", "cause", "mecanisme", "probabilite", "score de preuve calcule", "justification", "sources"),
        ("parametre/observation", "valeur et conditions", "portee", "source"),
        ("hypothese", "mesure", "protocole comparatif", "critere de decision", "delai"),
        ("action", "preuve", "impact cout", "impact gout", "impact procede", "risque/limite"),
    )
    if not all(markdown_table_has_schema(answer, schema) for schema in required_tables):
        failures.append("invalid_or_missing_table_schema")
    valid_ids = {f"S{number}" for number in range(1, valid_source_count + 1)}
    cited_ids = {f"S{number}" for number in CITATION_RE.findall(answer)} & valid_ids
    if evidence_control is None and chemistry_control is None:
        if len(cited_ids) < min(3, valid_source_count):
            failures.append("insufficient_distinct_citations")
        return failures
    if evidence_control is None or not evidence_control.proof_table_found:
        failures.append("proof_table_not_detected")
    elif evidence_control.controlled_rows < 1:
        failures.append("no_controlled_cause_row")
    if not re.search(r"\b\d{1,3}/100\s+[—-]\s+(?:Fort|Modéré|Non soutenue)\b", answer):
        failures.append("calculated_proof_score_missing")
    if chemistry_control is None or not chemistry_control.action_table_found:
        failures.append("action_table_not_detected")
    elif chemistry_control.unsafe_action_remaining:
        failures.append("unsafe_action_remaining")
    if not action_rows_have_valid_citations(answer, valid_ids):
        failures.append("uncited_action_row")
    if results is not None and not data_rows_have_traceable_values(answer, results):
        failures.append("untraceable_data_row")
    if required_gap_clauses and not all(
        clause in answer for clause in required_gap_clauses
    ):
        failures.append("required_gap_clause_missing")
    if not cited_ids and "Aucune cause suffisamment soutenue" not in answer:
        failures.append("no_valid_citation")
    return failures


def markdown_table_has_schema(answer: str, expected: tuple[str, ...]) -> bool:
    lines = answer.splitlines()
    wanted = tuple(normalize_table_header(item) for item in expected)
    for index, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        headers = tuple(
            normalize_table_header(cell)
            for cell in line.strip().strip("|").split("|")
        )
        if headers != wanted or index + 2 >= len(lines):
            continue
        separator = [
            cell.strip() for cell in lines[index + 1].strip().strip("|").split("|")
        ]
        row = [
            cell.strip() for cell in lines[index + 2].strip().strip("|").split("|")
        ]
        if len(separator) != len(wanted) or not all(
            re.fullmatch(r":?-{3,}:?", cell) for cell in separator
        ):
            continue
        if len(row) == len(wanted):
            return True
    return False


def normalize_table_header(value: str) -> str:
    normalized = value.casefold()
    normalized = (
        normalized.replace("é", "e")
        .replace("è", "e")
        .replace("ê", "e")
        .replace("à", "a")
        .replace("û", "u")
        .replace("ô", "o")
        .replace("ù", "u")
    )
    return re.sub(r"\s+", " ", normalized).strip()


def normalize_generated_markdown(answer: str) -> str:
    """Repair a common small-model table prefix without changing row content."""
    normalized: list[str] = []
    for line in answer.splitlines():
        stripped = line.strip()
        if stripped.casefold().startswith("tableau:") and "|" in stripped:
            header = stripped.split(":", 1)[1].strip().strip("|").strip()
            normalized.append(f"| {header} |")
        else:
            normalized.append(line)
    return "\n".join(normalized)


def extract_cause_claims(answer: str) -> list[tuple[str, str, set[str]]]:
    """Extract cause/mechanism/citation triples from the generated cause table."""
    lines = normalize_generated_markdown(answer).splitlines()
    for index, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        headers = [
            normalize_table_header(cell)
            for cell in line.strip().strip("|").split("|")
        ]
        if "cause" not in headers or "mecanisme" not in headers:
            continue
        cause_index = headers.index("cause")
        mechanism_index = headers.index("mecanisme")
        claims: list[tuple[str, str, set[str]]] = []
        row_index = index + 2
        while row_index < len(lines) and lines[row_index].strip().startswith("|"):
            cells = [
                cell.strip()
                for cell in lines[row_index].strip().strip("|").split("|")
            ]
            if len(cells) == len(headers):
                citations = {
                    f"S{number}" for number in CITATION_RE.findall(" ".join(cells))
                }
                claims.append(
                    (cells[cause_index], cells[mechanism_index], citations)
                )
            row_index += 1
        return claims
    return []


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


def data_rows_have_traceable_values(
    answer: str, results: list[RetrievedChunk]
) -> bool:
    """Reject invented numbers and meaningless scope cells in the data table."""
    mapped = citation_result_map(results)
    expected = (
        "parametre/observation",
        "valeur et conditions",
        "portee",
        "source",
    )
    lines = answer.splitlines()
    for index, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        headers = [
            normalize_table_header(cell)
            for cell in line.strip().strip("|").split("|")
        ]
        if tuple(headers) != expected:
            continue
        row_index = index + 2
        while row_index < len(lines) and lines[row_index].strip().startswith("|"):
            cells = [
                cell.strip()
                for cell in lines[row_index].strip().strip("|").split("|")
            ]
            if len(cells) != len(expected):
                return False
            if not data_row_is_traceable(cells, mapped):
                return False
            row_index += 1
        return True
    return False


def data_row_is_traceable(
    cells: list[str], mapped: dict[str, list[RetrievedChunk]]
) -> bool:
    value, scope, source = cells[1], cells[2], cells[3]
    if normalize_table_header(value) == normalize_table_header(scope):
        return False
    numbers = re.findall(r"(?<![\w])\d+(?:[.,]\d+)?", value)
    if not numbers:
        return True
    citation_ids = {f"S{number}" for number in CITATION_RE.findall(source)}
    cited_text = " ".join(
        f"{item.chunk.title} {item.chunk.text}"
        for citation_id in citation_ids
        for item in mapped.get(citation_id, [])
    ).replace(",", ".")
    return bool(citation_ids) and all(
        number.replace(",", ".") in cited_text for number in numbers
    )


def sanitize_data_rows(answer: str, results: list[RetrievedChunk]) -> str:
    """Remove only untraceable data rows instead of rejecting the full answer."""
    lines = answer.splitlines()
    mapped = citation_result_map(results)
    expected = (
        "parametre/observation",
        "valeur et conditions",
        "portee",
        "source",
    )
    for index, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        headers = [
            normalize_table_header(cell)
            for cell in line.strip().strip("|").split("|")
        ]
        if tuple(headers) != expected:
            continue
        row_index = index + 2
        kept = 0
        while row_index < len(lines) and lines[row_index].strip().startswith("|"):
            cells = [
                cell.strip()
                for cell in lines[row_index].strip().strip("|").split("|")
            ]
            if len(cells) != len(expected) or not data_row_is_traceable(cells, mapped):
                del lines[row_index]
                continue
            kept += 1
            row_index += 1
        if kept == 0:
            lines.insert(
                row_index,
                "| Aucune donnée quantitative traçable | non documenté | "
                "Aucune valeur directement transposable | — |",
            )
        break
    return "\n".join(lines)


def sanitize_action_rows(answer: str, valid_ids: set[str]) -> str:
    """Remove uncited recommendations while preserving the rest of the answer."""
    lines = answer.splitlines()
    expected = (
        "action",
        "preuve",
        "impact cout",
        "impact gout",
        "impact procede",
        "risque/limite",
    )
    for index, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        headers = [
            normalize_table_header(cell)
            for cell in line.strip().strip("|").split("|")
        ]
        if tuple(headers) != expected:
            continue
        row_index = index + 2
        kept = 0
        while row_index < len(lines) and lines[row_index].strip().startswith("|"):
            cells = [
                cell.strip()
                for cell in lines[row_index].strip().strip("|").split("|")
            ]
            if len(cells) != len(expected):
                del lines[row_index]
                continue
            action = cells[0]
            cited = {f"S{number}" for number in CITATION_RE.findall(" ".join(cells))}
            if not action.startswith("Aucune action corrective") and not cited.intersection(valid_ids):
                del lines[row_index]
                continue
            kept += 1
            row_index += 1
        if kept == 0:
            lines.insert(
                row_index,
                "| Aucune action corrective suffisamment documentée | — | — | — | — | "
                "Preuves insuffisantes |",
            )
        break
    return "\n".join(lines)


class RagPipeline:
    def __init__(
        self,
        settings: Settings,
        store: QdrantHybridStore | None = None,
        generator: LocalGenerator | None = None,
    ) -> None:
        self.settings = settings
        self.retriever = HybridRetriever(
            store
            or QdrantHybridStore(
                settings, sparse_only=settings.retrieval.sparse_only
            )
        )
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
        self.diagnostic_policy = (
            DiagnosticPolicy.load(settings.resolve_path(settings.diagnostics_file))
            if settings.diagnostics_file
            else None
        )
        self.diagnostic_writer = (
            DiagnosticJsonlWriter(self.diagnostic_policy)
            if self.diagnostic_policy and self.diagnostic_policy.enabled
            else None
        )
        self.last_diagnostic_report: RagDiagnosticReport | None = None

    def _new_diagnostic_collector(
        self, question: str, *, explicit_mode: bool = False
    ) -> DiagnosticCollector | None:
        if not self.diagnostic_policy or not self.evidence_policy:
            return None
        return DiagnosticCollector(
            question,
            str(self.settings.config_path),
            self.diagnostic_policy,
            self.evidence_policy,
            include_question_text=(
                explicit_mode
                or self.diagnostic_policy.include_question_text_in_production
            ),
            include_query_text=(
                explicit_mode
                or self.diagnostic_policy.include_query_text_in_production
            ),
        )

    def _finish_diagnostic(
        self,
        collector: DiagnosticCollector | None,
        final_decision: str,
        *,
        persist: bool,
    ) -> RagDiagnosticReport | None:
        if collector is None:
            return None
        report = collector.finish(final_decision)
        self.last_diagnostic_report = report
        has_rejection = final_decision != "generated" or any(
            query.category != "eligible"
            for attempt in report.attempts
            for query in attempt.queries
        )
        if persist and has_rejection and self.diagnostic_writer:
            self.diagnostic_writer.write(report)
        return report

    def _retrieve_evidence(
        self,
        question: str,
        source: str | None,
        date_from: date | None,
        date_to: date | None,
        collector: DiagnosticCollector | None = None,
    ) -> list[RetrievedChunk]:
        retrieval = self.settings.retrieval
        query_specs: list[tuple[str, str, str | None]] = [
            (question, "original", source)
        ]
        if retrieval.multi_query_enabled:
            canonical_queries: list[str] = []
            if self.evidence_policy:
                for rule in self.evidence_policy.mechanisms_named_in(question):
                    # Umbrella mechanisms (for example "juice browning") are
                    # satisfied by several chemically distinct mechanisms. Query
                    # each child lane once instead of diluting all vocabulary into
                    # one broad request.
                    evidence_rules = self.evidence_policy.evidence_rules_for(
                        rule, question
                    )
                    if evidence_rules:
                        for evidence_rule in evidence_rules:
                            canonical_queries.extend(evidence_rule.search_queries[:1])
                    else:
                        canonical_queries.extend(rule.search_queries[:1])
            if canonical_queries:
                query_specs.extend(
                    (query, "canonical", source)
                    for query in canonical_queries[: retrieval.max_subqueries]
                )
            else:
                try:
                    decomposed = self.generator.decompose_question(
                        question, max_queries=retrieval.max_subqueries
                    )
                    query_specs.extend(
                        (query, "llm_decomposition", source)
                        for query in decomposed
                    )
                except Exception:
                    # Retrieval remains available if the remote decomposition call fails.
                    if collector:
                        collector.errors.append("llm_decomposition_failed")
        deduplicated: list[tuple[str, str, str | None]] = []
        seen_specs: set[tuple[str, str | None]] = set()
        for query, kind, query_source in query_specs:
            normalized = query.strip()
            key = (normalized, query_source)
            if normalized and key not in seen_specs:
                deduplicated.append((normalized, kind, query_source))
                seen_specs.add(key)
        query_specs = deduplicated
        query_runs: list[tuple[str, str, str | None, list[RetrievedChunk]]] = []
        for query, kind, query_source in query_specs:
            candidates = self.retriever.retrieve(
                query,
                query_source,
                date_from,
                date_to,
                top_k=retrieval.candidates_per_query,
            )
            query_runs.append((query, kind, query_source, candidates))
        if source is None and retrieval.source_balancing_enabled:
            # Add dedicated evidence lanes so a globally dominant patent corpus cannot
            # completely hide peer-reviewed evidence, or vice versa.
            for source_name in ("google_patents_bigquery", "semantic_scholar"):
                candidates = self.retriever.retrieve(
                    question,
                    source_name,
                    date_from,
                    date_to,
                    top_k=retrieval.candidates_per_query,
                )
                query_runs.append(
                    (question, "source_balancing", source_name, candidates)
                )
        ranked_lists = [item[3] for item in query_runs]
        fused = reciprocal_rank_fusion(ranked_lists, rrf_k=retrieval.rrf_k)
        reranked = self.reranker.rerank(question, fused)
        if collector:
            for index, (query, kind, query_source, candidates) in enumerate(query_runs):
                collector.record_query(
                    attempt=1,
                    query_kind=kind,
                    query_text=query,
                    candidates=candidates,
                    reranked=reranked,
                    score_basis="initial_fused_ranked_against_original_question",
                    source_filter=query_source,
                    parent_query_id=None if index == 0 else "a1-q1",
                )
        return reranked[: retrieval.top_k]

    def _retry_missing_mechanisms(
        self,
        question: str,
        gaps,
        results: list[RetrievedChunk],
        source: str | None,
        date_from: date | None,
        date_to: date | None,
        collector: DiagnosticCollector | None = None,
    ) -> list[RetrievedChunk]:
        retrieval = self.settings.retrieval
        retry_queries: list[str] = []
        for rule in gaps:
            evidence_rules = self.evidence_policy.evidence_rules_for(
                rule, question
            ) if self.evidence_policy else [rule]
            query_rules = evidence_rules or [rule]
            for evidence_rule in query_rules:
                candidates = (
                    evidence_rule.search_queries[1:]
                    or evidence_rule.search_queries
                )
                if candidates:
                    retry_queries.append(candidates[0])
        retry_queries = list(dict.fromkeys(retry_queries))[
            : retrieval.max_subqueries * 2
        ]
        by_chunk = {item.chunk.id: item for item in results}
        lane_winners: list[RetrievedChunk] = []
        lane_candidate_limit = min(
            retrieval.candidates_per_query,
            self.settings.reranking.request_batch_size,
        )
        for query in retry_queries:
            candidates = self.retriever.retrieve(
                query,
                source,
                date_from,
                date_to,
                top_k=lane_candidate_limit,
            )
            # Score each evidence lane against its own precise technical query.
            # A single combined query diluted relevant citral/PET evidence below
            # threshold when several unrelated mechanisms were investigated.
            reranked = self.reranker.rerank(query, candidates)
            if collector:
                collector.record_query(
                    attempt=2,
                    query_kind="mechanism_retry",
                    query_text=query,
                    candidates=candidates,
                    reranked=reranked,
                    score_basis="dedicated_mechanism_query",
                    source_filter=source,
                    parent_query_id="a1-q1",
                )
            for item in reranked[:2]:
                previous = by_chunk.get(item.chunk.id)
                if previous is None or item.score > previous.score:
                    by_chunk[item.chunk.id] = item
                lane_winners.append(by_chunk[item.chunk.id])
        limit = max(retrieval.top_k, self.settings.reranking.top_n)
        selected: list[RetrievedChunk] = []
        seen: set[str] = set()
        for item in sorted(lane_winners, key=lambda value: value.score, reverse=True):
            if item.chunk.id not in seen:
                selected.append(item)
                seen.add(item.chunk.id)
        for item in sorted(by_chunk.values(), key=lambda value: value.score, reverse=True):
            if item.chunk.id not in seen:
                selected.append(item)
                seen.add(item.chunk.id)
        return selected[:limit]

    def _apply_strict_controls(
        self,
        answer: str,
        question: str,
        results: list[RetrievedChunk],
        clauses: list[str],
        dynamic_assessments: dict[str, ProofAssessment] | None = None,
    ) -> tuple[str, EvidenceControlResult, ChemistryControlResult]:
        assert self.evidence_policy is not None
        assert self.chemistry_policy is not None
        normalized_answer = normalize_generated_markdown(answer)
        evidence = apply_evidence_controls(
            normalized_answer,
            results,
            self.evidence_policy,
            question,
            dynamic_assessments=dynamic_assessments,
        )
        controlled_answer = insert_under_section(
            evidence.answer, "données manquantes", clauses
        )
        chemistry = apply_chemistry_guardrails(
            controlled_answer,
            question,
            self.chemistry_policy,
            self.evidence_policy.no_safe_action_message,
        )
        valid_ids = set(citation_result_map(results))
        sanitized_answer = sanitize_data_rows(chemistry.answer, results)
        sanitized_answer = sanitize_action_rows(sanitized_answer, valid_ids)
        sanitized_chemistry = ChemistryControlResult(
            answer=sanitized_answer,
            action_table_found=chemistry.action_table_found,
            blocked_actions=chemistry.blocked_actions,
            warnings_added=chemistry.warnings_added,
            unsafe_action_remaining=chemistry.unsafe_action_remaining,
        )
        return sanitized_answer, evidence, sanitized_chemistry

    def _assess_dynamic_claims(
        self,
        answer: str,
        question: str,
        results: list[RetrievedChunk],
        collector: DiagnosticCollector | None = None,
    ) -> dict[str, ProofAssessment]:
        """Verify unmapped mechanisms with dedicated cross-encoder evidence lanes."""
        assert self.evidence_policy is not None
        mapped = citation_result_map(results)
        assessments: dict[str, ProofAssessment] = {}
        for claim_index, (cause, mechanism, citation_ids) in enumerate(
            extract_cause_claims(answer), start=1
        ):
            cited = [
                item
                for citation_id in citation_ids
                for item in mapped.get(citation_id, [])
            ]
            if not cited:
                continue
            verification_query = (
                "Evaluate documentary evidence for this beverage failure mechanism. "
                f"Industrial question: {question} Cause: {cause}. "
                f"Mechanism: {mechanism}."
            )
            verified = self.reranker.rerank(verification_query, cited)
            if collector:
                collector.record_query(
                    attempt=collector.latest_attempt,
                    query_kind="dynamic_claim_verification",
                    query_text=verification_query,
                    candidates=cited,
                    reranked=verified,
                    score_basis="claim_specific_cross_encoder",
                    parent_query_id="a1-q1",
                )
            best_score = max((item.score for item in verified), default=0.0)
            supporting = [
                item
                for item in verified
                if item.score >= self.evidence_policy.supporting_source_min_score
            ]
            source_count = len(
                {independent_source_key(item) for item in supporting}
            )
            source_credit = (
                0.0
                if source_count == 0
                else self.evidence_policy.single_source_credit
                if source_count == 1
                else 1.0
            )
            calculated = round(
                100
                * (
                    self.evidence_policy.reranker_weight * best_score
                    + self.evidence_policy.source_weight * source_credit
                )
            )
            strong = self.evidence_policy.strong
            moderate = self.evidence_policy.moderate
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
                calculated = min(
                    calculated,
                    int(strong["minimum_calculated_score"]) - 1,
                )
            else:
                level = None
            assessments[proof_claim_key(cause, mechanism)] = ProofAssessment(
                mechanism_id=f"dynamic:{claim_index}",
                mechanism_match=best_score >= self.evidence_policy.gap_max_score,
                best_reranker_score=best_score,
                independent_sources=source_count,
                calculated_score=calculated,
                level=level,
            )
        return assessments

    def diagnose(
        self,
        question: str,
        source: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        *,
        include_query_text: bool = True,
    ) -> RagDiagnosticReport:
        """Run production retrieval/evidence decisions without final generation."""
        if not question.strip():
            raise ValueError("Question cannot be empty")
        if not self.diagnostic_policy or not self.evidence_policy:
            raise RuntimeError("Diagnostic mode requires diagnostics and evidence policies")
        collector = DiagnosticCollector(
            question,
            str(self.settings.config_path),
            self.diagnostic_policy,
            self.evidence_policy,
            include_question_text=include_query_text,
            include_query_text=include_query_text,
        )
        results = self._retrieve_evidence(
            question, source, date_from, date_to, collector
        )
        required = self.evidence_policy.mechanisms_named_in(question)
        collector.record_mechanisms(1, required, results)
        if not results:
            return collector.finish("no_candidates")
        gaps = find_evidence_gaps(question, results, self.evidence_policy)
        if gaps and self.evidence_policy.maximum_retrieval_attempts > 1:
            results = self._retry_missing_mechanisms(
                question, gaps, results, source, date_from, date_to, collector
            )
            gaps = find_evidence_gaps(question, results, self.evidence_policy)
            collector.record_mechanisms(2, required, results)
        if not required:
            decision = "unmapped_question"
        elif len(gaps) == len(required):
            decision = "evidence_gap"
        else:
            decision = "evidence_available"
        return collector.finish(decision)

    def ask(
        self,
        question: str,
        source: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> RagAnswer:
        if not question.strip():
            raise ValueError("Question cannot be empty")
        collector = self._new_diagnostic_collector(question)
        results = self._retrieve_evidence(
            question, source, date_from, date_to, collector
        )
        retrieval_attempts = 1
        all_results = list(results)
        rejected_results: list[RetrievedChunk] = []
        if not results:
            self._finish_diagnostic(
                collector, "no_candidates", persist=True
            )
            return RagAnswer(
                answer="Aucune source pertinente n'a été trouvée dans l'index local.",
                sources=[],
                diagnostics=RagDiagnostics(
                    status="no_results",
                    retrieval_attempts=retrieval_attempts,
                    generation_invoked=False,
                ),
            )
        strict = bool(
            self.evidence_policy
            and self.evidence_policy.enabled
            and self.chemistry_policy
            and self.chemistry_policy.enabled
            and self.settings.reranking.enabled
        )
        gaps = []
        canonical_mechanism_labels: list[str] = []
        if strict:
            assert self.evidence_policy is not None
            required = self.evidence_policy.mechanisms_named_in(question)
            gaps = find_evidence_gaps(question, results, self.evidence_policy)
            if collector:
                collector.record_mechanisms(1, required, results)
            if gaps and self.evidence_policy.maximum_retrieval_attempts > 1:
                results = self._retry_missing_mechanisms(
                    question, gaps, results, source, date_from, date_to, collector
                )
                retrieval_attempts += 1
                all_results = list(results)
                gaps = find_evidence_gaps(question, results, self.evidence_policy)
                if collector:
                    collector.record_mechanisms(2, required, results)
            if required:
                applicable_rules = {
                    evidence_rule.mechanism_id: evidence_rule
                    for rule in required
                    for evidence_rule in self.evidence_policy.evidence_rules_for(
                        rule, question
                    )
                }
                canonical_mechanism_labels = [
                    rule.label for rule in applicable_rules.values()
                ]
                mechanism_results = [
                    item
                    for item in results
                    if any(
                        rule.supports(f"{item.chunk.title}\n{item.chunk.text}")
                        and item.score >= self.evidence_policy.gap_max_score
                        for rule in applicable_rules.values()
                    )
                ]
                if mechanism_results:
                    accepted_ids = {item.chunk.id for item in mechanism_results}
                    rejected_results = [
                        item for item in all_results if item.chunk.id not in accepted_ids
                    ]
                    results = mechanism_results
                    gaps = find_evidence_gaps(
                        question, results, self.evidence_policy
                    )
            if required and len(gaps) == len(required):
                clauses = gap_clauses(gaps, self.evidence_policy)
                self._finish_diagnostic(
                    collector, "evidence_gap", persist=True
                )
                return RagAnswer(
                    answer=build_gap_answer(clauses),
                    sources=[],
                    retrieved_candidates=build_references(all_results),
                    diagnostics=RagDiagnostics(
                        status="evidence_gap",
                        retrieved_chunks=len(all_results),
                        evidence_chunks=0,
                        max_reranker_score=max(item.score for item in all_results),
                        retrieval_attempts=retrieval_attempts,
                        required_mechanisms=[item.label for item in required],
                        missing_mechanisms=[item.label for item in gaps],
                        generation_invoked=False,
                    ),
                )
        references = build_references(results)
        # Materialize LlamaIndex nodes at the orchestration boundary so callers can
        # extend this pipeline with rerankers without changing the storage layer.
        self.retriever.llama_nodes(results)
        context = build_context(
            results, max_chars=self.settings.generation.max_context_chars
        )
        if canonical_mechanism_labels:
            labels = "\n".join(
                f"- {label}" for label in canonical_mechanism_labels
            )
            context += (
                "\n\nMÉCANISMES CANONIQUES AUTORISÉS\n"
                "Dans la colonne Mécanisme, recopie exactement un des libellés "
                "ci-dessous uniquement s'il est explicitement établi par les "
                "extraits cités. N'invente pas de variante:\n"
                f"{labels}"
            )
        clauses = gap_clauses(gaps, self.evidence_policy) if strict else []
        if clauses:
            context += "\n\nLACUNES À REPRENDRE MOT POUR MOT:\n" + "\n".join(clauses)
        answer = self.generator.generate(question, context)
        generation_attempts = 1
        if strict:
            assert self.evidence_policy is not None
            attempts = max(1, self.evidence_policy.maximum_generation_attempts)
            for attempt in range(attempts):
                dynamic_assessments = (
                    self._assess_dynamic_claims(
                        answer, question, results, collector
                    )
                    if not required
                    else None
                )
                controlled, evidence, chemistry = self._apply_strict_controls(
                    answer,
                    question,
                    results,
                    clauses,
                    dynamic_assessments=dynamic_assessments,
                )
                if answer_passes_quality_gate(
                    controlled,
                    len(references),
                    evidence,
                    chemistry,
                    clauses,
                    results,
                ):
                    self._finish_diagnostic(
                        collector, "generated", persist=True
                    )
                    return RagAnswer(
                        answer=controlled,
                        sources=references,
                        retrieved_candidates=build_references(rejected_results),
                        diagnostics=RagDiagnostics(
                            status="generated",
                            retrieved_chunks=len(all_results),
                            evidence_chunks=len(results),
                            max_reranker_score=max(item.score for item in all_results),
                            retrieval_attempts=retrieval_attempts,
                            required_mechanisms=[item.label for item in self.evidence_policy.mechanisms_named_in(question)],
                            missing_mechanisms=[item.label for item in gaps],
                            generation_invoked=True,
                            generation_attempts=generation_attempts,
                        ),
                    )
                if collector:
                    failures = quality_gate_failures(
                        controlled,
                        len(references),
                        evidence,
                        chemistry,
                        clauses,
                        results,
                    )
                    collector.errors.append(
                        f"generation_attempt_{attempt + 1}:" + ",".join(failures)
                    )
                if attempt + 1 < attempts:
                    answer = self.generator.revise_answer(question, context, controlled)
                    generation_attempts += 1
            self._finish_diagnostic(
                collector, "quality_failure", persist=True
            )
            return RagAnswer(
                answer=build_quality_failure_answer(
                    self.evidence_policy.quality_failure_message, clauses
                ),
                sources=[],
                retrieved_candidates=build_references(all_results),
                diagnostics=RagDiagnostics(
                    status="quality_failure",
                    retrieved_chunks=len(all_results),
                    evidence_chunks=len(results),
                    max_reranker_score=max(item.score for item in all_results),
                    retrieval_attempts=retrieval_attempts,
                    required_mechanisms=[item.label for item in self.evidence_policy.mechanisms_named_in(question)],
                    missing_mechanisms=[item.label for item in gaps],
                    generation_invoked=True,
                    generation_attempts=generation_attempts,
                ),
            )
        if (
            self.settings.generation.quality_gate_enabled
            and not answer_passes_quality_gate(answer, len(references))
        ):
            answer = self.generator.revise_answer(question, context, answer)
        self._finish_diagnostic(collector, "generated", persist=True)
        return RagAnswer(
            answer=ensure_citations(answer, references),
            sources=references,
            retrieved_candidates=build_references(rejected_results),
            diagnostics=RagDiagnostics(
                status="generated",
                retrieved_chunks=len(all_results),
                evidence_chunks=len(results),
                max_reranker_score=max(item.score for item in all_results),
                retrieval_attempts=retrieval_attempts,
                generation_invoked=True,
                generation_attempts=generation_attempts,
            ),
        )
