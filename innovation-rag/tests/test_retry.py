import httpx
import respx

from beverage_rag.ingestion.base import get_with_retry


@respx.mock
def test_public_api_retry_recovers_from_rate_limit(monkeypatch) -> None:
    monkeypatch.setattr("beverage_rag.ingestion.base.time.sleep", lambda _: None)
    route = respx.get("https://example.org/api").mock(
        side_effect=[
            httpx.Response(429, headers={"retry-after": "0"}),
            httpx.Response(200, json={"ok": True}),
        ]
    )

    with httpx.Client() as client:
        response = get_with_retry(client, "https://example.org/api", params={})

    assert response.json() == {"ok": True}
    assert route.call_count == 2
