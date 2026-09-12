from pathlib import Path

from beverage_rag.ingestion.bigquery_patents import BigQueryPatentsConnector
from beverage_rag.ingestion.openalex import OpenAlexConnector, rebuild_abstract
from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]


def test_openalex_abstract_reconstruction() -> None:
    index = {"Beverage": [0], "stability": [2], "improves": [1]}
    assert rebuild_abstract(index) == "Beverage improves stability"


def test_openalex_normalization_retains_public_identifiers() -> None:
    connector = OpenAlexConnector(Settings.load(ROOT / "config" / "soda.yaml"))
    document = connector._normalize(
        {
            "id": "https://openalex.org/W123",
            "doi": "https://doi.org/10.1000/test-only",
            "title": "Test-only public record fixture",
            "publication_date": "2024-01-02",
            "language": "en",
            "abstract_inverted_index": {"Carbonation": [0], "study": [1]},
            "primary_location": {
                "landing_page_url": "https://example.org/test-only",
                "pdf_url": "https://example.org/test-only.pdf",
                "source": {"display_name": "Fixture Journal"},
            },
            "open_access": {"oa_url": "https://example.org/test-only.pdf"},
            "authorships": [],
            "type": "article",
        }
    )

    assert document is not None
    assert document.external_id == "W123"
    assert document.doi == "10.1000/test-only"
    assert document.sections["abstract"] == "Carbonation study"


def test_patent_query_uses_parameters_for_user_keywords() -> None:
    connector = BigQueryPatentsConnector(Settings.load(ROOT / "config" / "soda.yaml"))
    sql, parameters = connector._build_query()

    assert "@keyword_0" in sql
    assert "patents-public-data.patents.publications" in sql
    assert all(value not in sql for name, value in parameters if name.startswith("keyword_"))

