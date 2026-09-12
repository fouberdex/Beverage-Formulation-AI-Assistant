from __future__ import annotations

import os
from collections.abc import Iterator
from math import ceil
from typing import Any

import httpx

from beverage_rag.ingestion.base import SourceConnector, get_with_retry
from beverage_rag.schemas import RawDocument


class SemanticScholarConnector(SourceConnector):
    source_name = "semantic_scholar"
    endpoint = "https://api.semanticscholar.org/graph/v1/paper/search/bulk"

    def fetch(self, limit: int) -> Iterator[RawDocument]:
        scope = self.settings.scope
        headers = {"User-Agent": "BeverageDzAI-Innovation-RAG/0.1"}
        api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY")
        if api_key:
            headers["x-api-key"] = api_key
        seen: set[str] = set()
        yielded = 0
        year_range = f"{scope.date_from.year}-{scope.date_to.year}"
        theme_limit = ceil(limit / len(scope.themes))

        with httpx.Client(
            timeout=self.settings.ingestion.request_timeout_seconds,
            headers=headers,
            follow_redirects=True,
        ) as client:
            for theme, keywords in scope.themes.items():
                if yielded >= limit:
                    break
                query = " | ".join(f'"{keyword}"' for keyword in keywords)
                token: str | None = None
                theme_yielded = 0
                while yielded < limit and theme_yielded < theme_limit:
                    params = {
                        "query": query,
                        "year": year_range,
                        "openAccessPdf": "",
                        "sort": "publicationDate:desc",
                        "fields": (
                            "paperId,title,abstract,year,publicationDate,externalIds,url,"
                            "openAccessPdf,authors,venue,fieldsOfStudy"
                        ),
                    }
                    if token:
                        params["token"] = token
                    response = get_with_retry(client, self.endpoint, params=params)
                    payload = response.json()
                    papers = payload.get("data", [])
                    if not papers:
                        break
                    for paper in papers:
                        paper_id = paper.get("paperId")
                        open_pdf = (paper.get("openAccessPdf") or {}).get("url")
                        if (
                            not paper_id
                            or paper_id in seen
                            or not paper.get("abstract")
                            or not open_pdf
                        ):
                            continue
                        seen.add(paper_id)
                        yield self._normalize(paper, theme)
                        yielded += 1
                        theme_yielded += 1
                        if yielded >= limit:
                            break
                    token = payload.get("token")
                    if not token:
                        break
                    self.throttle()

            # Narrow themes can be exhausted before their balanced allocation.
            # Fill the remaining corpus from the first, broadest configured term
            # while preserving global paper-ID deduplication and OA requirements.
            if yielded < limit:
                query = f'"{scope.keywords[0]}"'
                token = None
                while yielded < limit:
                    params = {
                        "query": query,
                        "year": year_range,
                        "openAccessPdf": "",
                        "sort": "publicationDate:desc",
                        "fields": (
                            "paperId,title,abstract,year,publicationDate,externalIds,url,"
                            "openAccessPdf,authors,venue,fieldsOfStudy"
                        ),
                    }
                    if token:
                        params["token"] = token
                    response = get_with_retry(client, self.endpoint, params=params)
                    payload = response.json()
                    papers = payload.get("data", [])
                    if not papers:
                        break
                    for paper in papers:
                        paper_id = paper.get("paperId")
                        open_pdf = (paper.get("openAccessPdf") or {}).get("url")
                        if (
                            not paper_id
                            or paper_id in seen
                            or not paper.get("abstract")
                            or not open_pdf
                        ):
                            continue
                        seen.add(paper_id)
                        yield self._normalize(paper, "beverage_domain_fallback")
                        yielded += 1
                        if yielded >= limit:
                            break
                    token = payload.get("token")
                    if not token:
                        break
                    self.throttle()

    def _normalize(self, paper: dict[str, Any], theme: str) -> RawDocument:
        external_ids = paper.get("externalIds") or {}
        doi = external_ids.get("DOI")
        oa = paper.get("openAccessPdf") or {}
        paper_id = paper["paperId"]
        return RawDocument(
            id=RawDocument.stable_id(self.source_name, paper_id),
            source=self.source_name,
            document_type="publication",
            external_id=paper_id,
            title=paper.get("title") or paper_id,
            publication_date=paper.get("publicationDate"),
            doi=doi,
            url=paper.get("url"),
            open_access_url=oa.get("url"),
            keywords=self.settings.scope.keywords,
            sections={"abstract": paper.get("abstract", "")},
            metadata={
                "theme": theme,
                "venue": paper.get("venue"),
                "authors": [a.get("name") for a in paper.get("authors", []) if a.get("name")],
                "fields_of_study": paper.get("fieldsOfStudy") or [],
                "external_ids": external_ids,
            },
        )
