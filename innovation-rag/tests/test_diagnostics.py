from dataclasses import replace
from pathlib import Path

import pytest

from beverage_rag.rag.diagnostics import (
    DiagnosticCollector,
    DiagnosticJsonlWriter,
    DiagnosticPolicy,
)
from beverage_rag.rag.evidence import EvidencePolicy
from beverage_rag.rag.pipeline import RagPipeline
from beverage_rag.schemas import Chunk, RetrievedChunk
from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = EvidencePolicy.load(ROOT / "config" / "evidence-policy.yaml")
DIAGNOSTICS = DiagnosticPolicy.load(ROOT / "config" / "diagnostics.yaml")


def result(identifier: str, text: str, score: float) -> RetrievedChunk:
    return RetrievedChunk(
        chunk=Chunk(
            id=identifier,
            document_id=f"doc-{identifier}",
            source="test_fixture",
            document_type="publication",
            external_id=identifier,
            title=f"Fixture {identifier}",
            section="abstract",
            position=0,
            text=text,
        ),
        score=score,
    )


def test_trace_preserves_continuous_margin_but_redacts_text() -> None:
    question = "Question confidentielle sur un soda citron trouble"
    candidate = result(
        "near",
        "A citrus beverage emulsion became unstable and caused turbidity.",
        0.39,
    )
    collector = DiagnosticCollector(
        question,
        "test.yaml",
        DIAGNOSTICS,
        EVIDENCE,
        include_question_text=False,
        include_query_text=False,
    )
    collector.record_query(
        attempt=1,
        query_kind="original",
        query_text=question,
        candidates=[candidate],
        reranked=[candidate],
        score_basis="test",
    )
    report = collector.finish("evidence_gap")
    trace = report.attempts[0].queries[0]

    assert trace.category == "near_threshold"
    assert trace.reranker_margin == pytest.approx(-0.01)
    assert trace.query_text is None
    assert report.question_text is None
    assert question not in report.model_dump_json()
    assert candidate.chunk.text not in report.model_dump_json()


def test_diagnostic_mode_never_calls_final_generation() -> None:
    relevant = result(
        "emulsion",
        "A citrus beverage emulsion became unstable and caused turbidity and sediment.",
        0.85,
    )

    class FakeStore:
        def search(self, *args, **kwargs):
            return [relevant]

    class NoFinalGeneration:
        def decompose_question(self, *args, **kwargs):
            return []

        def generate(self, *args, **kwargs):
            raise AssertionError("diagnose() must not generate the final answer")

    pipeline = RagPipeline(
        Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml"),
        store=FakeStore(),
        generator=NoFinalGeneration(),
    )
    pipeline.reranker.rerank = lambda question, candidates: candidates

    report = pipeline.diagnose(
        "L'agent de trouble d'un soda citron forme un dépôt.",
        include_query_text=True,
    )

    assert report.final_decision == "evidence_available"
    assert any(
        query.query_kind == "canonical"
        for attempt in report.attempts
        for query in attempt.queries
    )
    assert report.question_text is not None


def test_writer_rotates_without_storing_unbounded_file(tmp_path: Path) -> None:
    policy = replace(
        DIAGNOSTICS,
        log_path=tmp_path / "trace.jsonl",
        max_bytes=400,
        backup_count=2,
    )
    collector = DiagnosticCollector(
        "test",
        "test.yaml",
        policy,
        EVIDENCE,
        include_question_text=False,
        include_query_text=False,
    )
    report = collector.finish("evidence_gap")
    writer = DiagnosticJsonlWriter(policy)

    writer.write(report)
    writer.write(report)

    assert policy.log_path.exists()
    assert policy.log_path.with_name("trace.jsonl.1").exists()


def test_llm_decomposition_subqueries_are_traced_without_final_generation() -> None:
    noise = result("noise", "Generic beverage document.", 0.2)

    class FakeStore:
        def search(self, *args, **kwargs):
            return [noise]

    class PlanningOnlyGenerator:
        def decompose_question(self, *args, **kwargs):
            return ["specialized technical vocabulary"]

        def generate(self, *args, **kwargs):
            raise AssertionError("diagnose() must not generate the final answer")

    pipeline = RagPipeline(
        Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml"),
        store=FakeStore(),
        generator=PlanningOnlyGenerator(),
    )
    pipeline.reranker.rerank = lambda question, candidates: candidates

    report = pipeline.diagnose("Question sans mécanisme canonique connu")

    assert report.final_decision == "unmapped_question"
    assert any(
        query.query_kind == "llm_decomposition"
        and query.query_text == "specialized technical vocabulary"
        for query in report.attempts[0].queries
    )


def test_orange_browning_uses_specific_canonical_lanes_without_llm_decomposition() -> None:
    noise = result("noise", "Generic beverage document.", 0.2)

    class RecordingStore:
        def __init__(self) -> None:
            self.queries = []

        def search(self, query, *args, **kwargs):
            self.queries.append(query)
            return [noise]

    class NoDecompositionGenerator:
        def decompose_question(self, *args, **kwargs):
            raise AssertionError("A canonical mechanism must avoid LLM decomposition")

        def generate(self, *args, **kwargs):
            raise AssertionError("diagnose() must not generate the final answer")

    store = RecordingStore()
    pipeline = RagPipeline(
        Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml"),
        store=store,
        generator=NoDecompositionGenerator(),
    )
    pipeline.reranker.rerank = lambda query, candidates: candidates

    report = pipeline.diagnose(
        "Un jus d'orange pasteurisé perd sa couleur et devient brunâtre après stockage."
    )

    first_attempt = report.attempts[0].queries
    canonical_queries = {
        trace.query_text for trace in first_attempt if trace.query_kind == "canonical"
    }
    assert report.final_decision == "evidence_gap"
    assert len(canonical_queries) == 4
    assert any("ascorbic acid" in query for query in canonical_queries)
    assert any("carotenoid" in query for query in canonical_queries)
    assert all(trace.query_kind != "llm_decomposition" for trace in first_attempt)


def test_production_trace_is_separate_and_pseudonymized() -> None:
    question = "Formulation confidentielle citron trouble"
    noise = result("noise", "The orange beverage had a pH measurement.", 0.2)

    class FakeStore:
        def search(self, *args, **kwargs):
            return [noise]

    class NoGeneration:
        def decompose_question(self, *args, **kwargs):
            return []

        def generate(self, *args, **kwargs):
            raise AssertionError("A full evidence gap must stop before generation")

    class CaptureWriter:
        def __init__(self) -> None:
            self.reports = []

        def write(self, report) -> None:
            self.reports.append(report)

    pipeline = RagPipeline(
        Settings.load(ROOT / "config" / "beverages-20k-gpu.yaml"),
        store=FakeStore(),
        generator=NoGeneration(),
    )
    pipeline.reranker.rerank = lambda query, candidates: candidates
    capture = CaptureWriter()
    pipeline.diagnostic_writer = capture

    response = pipeline.ask(question)

    assert capture.reports
    serialized = capture.reports[0].model_dump_json()
    assert question not in serialized
    assert all(
        query.query_text is None
        for attempt in capture.reports[0].attempts
        for query in attempt.queries
    )
    assert "hybrid_candidate_count" not in response.answer
    assert capture.reports[0].request_id not in response.answer
