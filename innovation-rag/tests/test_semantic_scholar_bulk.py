from pathlib import Path

import httpx
import respx

from beverage_rag.ingestion.semantic_scholar import SemanticScholarConnector
from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]


def paper(identifier: str) -> dict:
    return {
        "paperId": identifier,
        "title": f"Test-only paper {identifier}",
        "abstract": "A test-only abstract about carbonated beverage stability.",
        "year": 2025,
        "publicationDate": "2025-01-01",
        "externalIds": {"DOI": f"10.1000/{identifier}"},
        "url": f"https://example.org/{identifier}",
        "openAccessPdf": {"url": f"https://example.org/{identifier}.pdf"},
        "authors": [{"name": "Test Author"}],
        "venue": "Test Venue",
        "fieldsOfStudy": ["Food Science"],
    }


@respx.mock
def test_bulk_search_uses_continuation_token(monkeypatch) -> None:
    settings = Settings.load(ROOT / "config" / "soda.yaml")
    settings.scope.themes = {"only_theme": ["carbonated beverage"]}
    settings.ingestion.requests_per_second = 1000
    monkeypatch.setattr("beverage_rag.ingestion.base.time.sleep", lambda _: None)
    route = respx.get(SemanticScholarConnector.endpoint).mock(
        side_effect=[
            httpx.Response(200, json={"total": 2, "token": "next-page", "data": [paper("A")]}),
            httpx.Response(200, json={"total": 2, "data": [paper("B")]}),
        ]
    )

    documents = list(SemanticScholarConnector(settings).fetch(2))

    assert [item.external_id for item in documents] == ["A", "B"]
    assert route.calls[1].request.url.params["token"] == "next-page"
    assert "openAccessPdf" in route.calls[0].request.url.params
