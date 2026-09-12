from pathlib import Path

from beverage_rag.rag.citations import build_references, ensure_citations
from beverage_rag.rag.pipeline import RagPipeline, build_context
from beverage_rag.schemas import Chunk, RetrievedChunk
from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]


def result(document_id: str, external_id: str, doi: str | None = None) -> RetrievedChunk:
    return RetrievedChunk(
        chunk=Chunk(
            id=Chunk.stable_id(document_id, "abstract", 0, "Evidence text."),
            document_id=document_id,
            source="test_fixture",
            document_type="publication" if doi else "patent",
            external_id=external_id,
            title="Test-only source",
            section="abstract",
            position=0,
            text="Evidence text.",
            doi=doi,
            url="https://example.org/test-only",
        ),
        score=0.75,
    )


def test_references_are_deduplicated_by_document() -> None:
    first = result("doc-1", "US-TEST")
    duplicate = first.model_copy(deep=True)
    duplicate.chunk.id = Chunk.stable_id("doc-1", "abstract", 1, "Other evidence.")
    duplicate.chunk.position = 1
    duplicate.chunk.text = "Other evidence."

    references = build_references([first, duplicate])

    assert len(references) == 1
    assert references[0].citation_id == "S1"
    assert references[0].label == "US-TEST"


def test_missing_inline_citation_is_made_explicit() -> None:
    references = build_references([result("doc-2", "W123", "10.1000/test-only")])
    answer = ensure_citations("Grounded answer.", references)

    assert "[S1]" in answer
    assert references[0].label == "DOI: 10.1000/test-only"


def test_context_and_reference_labels_match() -> None:
    results = [result("doc-a", "US-A"), result("doc-b", "US-B")]
    context = build_context(results)
    references = build_references(results)

    assert "[S1] US-A" in context
    assert "[S2] US-B" in context
    assert [item.citation_id for item in references] == ["S1", "S2"]


def test_rag_pipeline_returns_structured_grounded_answer() -> None:
    evidence = [result("doc-a", "US-A")]

    class FakeStore:
        def search(self, *args, **kwargs):
            return evidence

    class FakeGenerator:
        def generate(self, question: str, context: str) -> str:
            assert question == "Test question?"
            assert "[S1] US-A" in context
            return "Test-only grounded answer [S1]."

    pipeline = RagPipeline(
        Settings.load(ROOT / "config" / "soda.yaml"),
        store=FakeStore(),
        generator=FakeGenerator(),
    )
    answer = pipeline.ask("Test question?")

    assert answer.answer.endswith("[S1].")
    assert answer.sources[0].label == "US-A"
