from pathlib import Path

from beverage_rag.preprocessing.pipeline import chunk_document
from beverage_rag.schemas import RawDocument
from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]


def test_patent_sections_keep_claim_metadata() -> None:
    settings = Settings.load(ROOT / "config" / "soda.yaml")
    settings.preprocessing.minimum_chunk_words = 3
    document = RawDocument(
        id=RawDocument.stable_id("patents", "US-TEST-ONLY"),
        source="google_patents_bigquery",
        document_type="patent",
        external_id="US-TEST-ONLY",
        title="Test-only fixture",
        sections={
            "abstract": "A carbonated beverage with improved flavor stability.",
            "claims": "1. A beverage composition with a preservative.\n2. The beverage of claim 1 with flavor.",
        },
    )

    chunks = chunk_document(document, settings)

    assert {chunk.section for chunk in chunks} >= {"abstract", "claim_1", "claim_2"}
    assert all(chunk.external_id == "US-TEST-ONLY" for chunk in chunks)
    assert len({chunk.id for chunk in chunks}) == len(chunks)


def test_article_heading_detection() -> None:
    settings = Settings.load(ROOT / "config" / "soda.yaml")
    settings.preprocessing.minimum_chunk_words = 2
    document = RawDocument(
        id=RawDocument.stable_id("test", "ARTICLE-TEST-ONLY"),
        source="test_fixture",
        document_type="publication",
        external_id="ARTICLE-TEST-ONLY",
        title="Test-only fixture",
        sections={
            "full_text": "METHODS\nSamples were carbonated.\nRESULTS\nAroma retention improved.\nCONCLUSION\nFurther study is needed."
        },
    )

    chunks = chunk_document(document, settings)

    assert [chunk.section for chunk in chunks] == ["methods", "results", "conclusion"]

