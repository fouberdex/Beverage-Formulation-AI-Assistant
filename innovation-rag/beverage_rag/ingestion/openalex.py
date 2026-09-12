from __future__ import annotations

from collections.abc import Iterator
from math import ceil
from typing import Any

import httpx

from beverage_rag.ingestion.base import SourceConnector, get_with_retry
from beverage_rag.schemas import RawDocument


def rebuild_abstract(inverted_index: dict[str, list[int]] | None) -> str:
    if not inverted_index:
        return ""
    positioned = [
        (position, word)
        for word, positions in inverted_index.items()
        for position in positions
    ]
    return " ".join(word for _, word in sorted(positioned))


class OpenAlexConnector(SourceConnector):
    source_name = "openalex"
    endpoint = "https://api.openalex.org/works"

    def fetch(self, limit: int) -> Iterator[RawDocument]:
        scope = self.settings.scope
        yielded = 0
        seen: set[str] = set()
        headers = {"User-Agent": "BeverageDzAI-Innovation-RAG/0.1"}
        email = __import__("os").getenv("OPENALEX_EMAIL")

        with httpx.Client(
            timeout=self.settings.ingestion.request_timeout_seconds,
            headers=headers,
            follow_redirects=True,
        ) as client:
            theme_limit = ceil(limit / len(scope.themes))
            for theme, keywords in scope.themes.items():
                cursor = "*"
                theme_yielded = 0
                search = " OR ".join(f'"{word}"' for word in keywords)
                while yielded < limit and theme_yielded < theme_limit and cursor:
                    params: dict[str, Any] = {
                        "search": search,
                        "filter": (
                            f"from_publication_date:{scope.date_from},"
                            f"to_publication_date:{scope.date_to},is_oa:true"
                        ),
                        "select": (
                            "id,doi,title,publication_date,language,abstract_inverted_index,"
                            "primary_location,open_access,authorships,type"
                        ),
                        "per-page": min(100, limit - yielded, theme_limit - theme_yielded),
                        "cursor": cursor,
                    }
                    if email:
                        params["mailto"] = email
                    response = get_with_retry(client, self.endpoint, params=params)
                    payload = response.json()
                    results = payload.get("results", [])
                    if not results:
                        break
                    for work in results:
                        external_id = str(work.get("id", "")).rsplit("/", 1)[-1]
                        if not external_id or external_id in seen:
                            continue
                        document = self._normalize(work, theme)
                        if document is not None:
                            seen.add(external_id)
                            yield document
                            yielded += 1
                            theme_yielded += 1
                            if yielded >= limit:
                                break
                    cursor = payload.get("meta", {}).get("next_cursor")
                    if yielded < limit and cursor:
                        self.throttle()
                if yielded >= limit:
                    break

    def _normalize(self, work: dict[str, Any], theme: str | None = None) -> RawDocument | None:
        abstract = rebuild_abstract(work.get("abstract_inverted_index"))
        if not abstract:
            return None
        external_id = str(work["id"]).rsplit("/", 1)[-1]
        doi = (work.get("doi") or "").removeprefix("https://doi.org/") or None
        primary = work.get("primary_location") or {}
        open_access = work.get("open_access") or {}
        source = primary.get("source") or {}
        landing_url = primary.get("landing_page_url") or work.get("doi") or work.get("id")
        oa_url = primary.get("pdf_url") or open_access.get("oa_url")
        return RawDocument(
            id=RawDocument.stable_id(self.source_name, external_id),
            source=self.source_name,
            document_type="publication",
            external_id=external_id,
            title=work.get("title") or external_id,
            publication_date=work.get("publication_date"),
            language=work.get("language"),
            doi=doi,
            url=landing_url,
            open_access_url=oa_url,
            keywords=self.settings.scope.keywords,
            sections={"abstract": abstract},
            metadata={
                "work_type": work.get("type"),
                "theme": theme,
                "venue": source.get("display_name"),
                "authors": [
                    item.get("author", {}).get("display_name")
                    for item in work.get("authorships", [])
                    if item.get("author", {}).get("display_name")
                ],
            },
        )
