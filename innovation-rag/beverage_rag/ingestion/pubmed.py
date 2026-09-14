from __future__ import annotations

import os
import xml.etree.ElementTree as ET
from collections.abc import Iterator

import httpx

from beverage_rag.ingestion.base import SourceConnector, get_with_retry
from beverage_rag.schemas import RawDocument


class PubMedConnector(SourceConnector):
    source_name = "pubmed"
    base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    def fetch(self, limit: int) -> Iterator[RawDocument]:
        scope = self.settings.scope
        query = " OR ".join(f'"{word}"[Title/Abstract]' for word in scope.keywords)
        query = (
            f"({query}) AND free full text[sb] AND "
            f"({scope.date_from}[Date - Publication] : {scope.date_to}[Date - Publication])"
        )
        common = {"tool": "BeverageDzAI-Innovation-RAG"}
        if email := os.getenv("OPENALEX_EMAIL"):
            common["email"] = email
        if api_key := os.getenv("NCBI_API_KEY"):
            common["api_key"] = api_key

        with httpx.Client(timeout=self.settings.ingestion.request_timeout_seconds) as client:
            search = get_with_retry(
                client,
                f"{self.base_url}/esearch.fcgi",
                params={**common, "db": "pubmed", "term": query, "retmax": limit, "retmode": "json"},
            )
            ids = search.json().get("esearchresult", {}).get("idlist", [])
            if not ids:
                return
            self.throttle()
            fetch = get_with_retry(
                client,
                f"{self.base_url}/efetch.fcgi",
                params={**common, "db": "pubmed", "id": ",".join(ids), "retmode": "xml"},
            )
            root = ET.fromstring(fetch.content)
            for article in root.findall(".//PubmedArticle"):
                document = self._normalize(article)
                if document is not None:
                    yield document

    def fetch_ids(self, pmids: list[str]) -> Iterator[RawDocument]:
        """Fetch an explicit, bounded set of public PubMed abstracts."""
        ids = list(dict.fromkeys(pmid.strip() for pmid in pmids if pmid.strip()))
        if not ids:
            return
        if any(not pmid.isdigit() for pmid in ids):
            raise ValueError("PubMed identifiers must contain digits only")
        common = {"tool": "BeverageDzAI-Innovation-RAG"}
        if email := os.getenv("OPENALEX_EMAIL"):
            common["email"] = email
        if api_key := os.getenv("NCBI_API_KEY"):
            common["api_key"] = api_key
        with httpx.Client(timeout=self.settings.ingestion.request_timeout_seconds) as client:
            response = get_with_retry(
                client,
                f"{self.base_url}/efetch.fcgi",
                params={
                    **common,
                    "db": "pubmed",
                    "id": ",".join(ids),
                    "retmode": "xml",
                },
            )
        root = ET.fromstring(response.content)
        for article in root.findall(".//PubmedArticle"):
            document = self._normalize(article)
            if document is not None:
                yield document

    def _normalize(self, article: ET.Element) -> RawDocument | None:
        citation = article.find("MedlineCitation")
        if citation is None:
            return None
        pmid = citation.findtext("PMID")
        title_node = citation.find(".//ArticleTitle")
        abstracts = citation.findall(".//Abstract/AbstractText")
        if not pmid or not abstracts:
            return None
        sections: list[str] = []
        for node in abstracts:
            text = "".join(node.itertext()).strip()
            if text:
                label = node.attrib.get("Label")
                sections.append(f"{label}: {text}" if label else text)
        doi = None
        for identifier in article.findall(".//ArticleId"):
            if identifier.attrib.get("IdType") == "doi":
                doi = identifier.text
                break
        year = citation.findtext(".//PubDate/Year")
        publication_date = f"{year}-01-01" if year and year.isdigit() else None
        return RawDocument(
            id=RawDocument.stable_id(self.source_name, pmid),
            source=self.source_name,
            document_type="publication",
            external_id=pmid,
            title="".join(title_node.itertext()).strip() if title_node is not None else pmid,
            publication_date=publication_date,
            doi=doi,
            url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            keywords=self.settings.scope.keywords,
            sections={"abstract": "\n".join(sections)},
            metadata={"database": "PubMed"},
        )
