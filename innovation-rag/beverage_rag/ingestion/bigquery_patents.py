from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import datetime
from typing import Any

from beverage_rag.ingestion.base import SourceConnector
from beverage_rag.schemas import RawDocument


class BigQueryPatentsConnector(SourceConnector):
    source_name = "patents"

    def _build_query(
        self, include_description: bool = True
    ) -> tuple[str, list[tuple[str, str]]]:
        scope = self.settings.scope
        parameters: list[tuple[str, str]] = []
        keyword_clauses: list[str] = []
        for index, keyword in enumerate(scope.keywords):
            name = f"keyword_{index}"
            parameters.append((name, keyword.lower()))
            keyword_clauses.append(
                f"STRPOS(searchable_text, LOWER(@{name})) > 0"
            )

        class_clauses: list[str] = []
        for index, prefix in enumerate(scope.patents.ipc_prefixes):
            name = f"ipc_{index}"
            parameters.append((name, prefix))
            class_clauses.append(
                f"EXISTS (SELECT 1 FROM UNNEST(ipc) x WHERE STARTS_WITH(x.code, @{name}))"
            )
        for index, prefix in enumerate(scope.patents.cpc_prefixes):
            name = f"cpc_{index}"
            parameters.append((name, prefix))
            class_clauses.append(
                f"EXISTS (SELECT 1 FROM UNNEST(cpc) x WHERE STARTS_WITH(x.code, @{name}))"
            )

        class_filter = " OR ".join(class_clauses) or "TRUE"
        keyword_filter = " OR ".join(keyword_clauses) or "TRUE"
        description_projection = (
            "ARRAY_TO_STRING(ARRAY(SELECT x.text FROM UNNEST(description_localized) x "
            "WHERE x.language IN UNNEST(@languages)), '\\n') AS description_text"
            if include_description
            else "CAST('' AS STRING) AS description_text"
        )
        sql = f"""
        WITH selected AS (
          SELECT
            publication_number,
            country_code,
            publication_date,
            title_localized,
            abstract_localized,
            claims_localized,
            description_localized,
            ipc,
            cpc,
            LOWER(CONCAT(
              ARRAY_TO_STRING(ARRAY(SELECT x.text FROM UNNEST(title_localized) x), ' '), ' ',
              ARRAY_TO_STRING(ARRAY(SELECT x.text FROM UNNEST(abstract_localized) x), ' '), ' ',
              ARRAY_TO_STRING(ARRAY(SELECT x.text FROM UNNEST(claims_localized) x), ' ')
            )) AS searchable_text
          FROM `patents-public-data.patents.publications`
          WHERE publication_date BETWEEN @date_from AND @date_to
            AND country_code IN UNNEST(@countries)
            AND ({class_filter})
        )
        SELECT
          publication_number,
          country_code,
          publication_date,
          (SELECT x.text FROM UNNEST(title_localized) x
            WHERE x.language IN UNNEST(@languages) ORDER BY x.language = 'en' DESC LIMIT 1) AS title_text,
          ARRAY_TO_STRING(ARRAY(SELECT x.text FROM UNNEST(abstract_localized) x
            WHERE x.language IN UNNEST(@languages)), '\\n') AS abstract_text,
          ARRAY_TO_STRING(ARRAY(SELECT x.text FROM UNNEST(claims_localized) x
            WHERE x.language IN UNNEST(@languages)), '\\n') AS claims_text,
          {description_projection},
          ARRAY(SELECT DISTINCT x.code FROM UNNEST(ipc) x WHERE x.code IS NOT NULL) AS ipc_codes,
          ARRAY(SELECT DISTINCT x.code FROM UNNEST(cpc) x WHERE x.code IS NOT NULL) AS cpc_codes
        FROM selected
        WHERE ({keyword_filter})
        ORDER BY publication_date DESC
        LIMIT @result_limit
        """
        return sql, parameters

    def _query_parameters(self, bigquery: Any, limit: int, keyword_parameters):
        scope = self.settings.scope
        query_parameters: list[Any] = [
            bigquery.ScalarQueryParameter(
                "date_from", "INT64", int(scope.date_from.strftime("%Y%m%d"))
            ),
            bigquery.ScalarQueryParameter(
                "date_to", "INT64", int(scope.date_to.strftime("%Y%m%d"))
            ),
            bigquery.ArrayQueryParameter("countries", "STRING", scope.patents.countries),
            bigquery.ArrayQueryParameter("languages", "STRING", scope.languages),
            bigquery.ScalarQueryParameter("result_limit", "INT64", limit),
        ]
        query_parameters.extend(
            bigquery.ScalarQueryParameter(name, "STRING", value)
            for name, value in keyword_parameters
        )
        return query_parameters

    def estimate_bytes(self, limit: int, include_description: bool = True) -> int:
        try:
            from google.cloud import bigquery
        except ImportError as exc:
            raise RuntimeError(
                "Patent ingestion requires: pip install -e '.[bigquery]'"
            ) from exc
        project = os.getenv("GCP_PROJECT_ID")
        if not project:
            raise RuntimeError("GCP_PROJECT_ID is required for BigQuery patent ingestion")
        sql, keyword_parameters = self._build_query(include_description=include_description)
        job_config = bigquery.QueryJobConfig(
            query_parameters=self._query_parameters(bigquery, limit, keyword_parameters),
            dry_run=True,
            use_query_cache=False,
        )
        job = bigquery.Client(project=project).query(
            sql, job_config=job_config, location="US"
        )
        return int(job.total_bytes_processed or 0)

    @staticmethod
    def _date_from_integer(value: int | str | None):
        if value is None:
            return None
        return datetime.strptime(str(value), "%Y%m%d").date()

    def fetch(self, limit: int) -> Iterator[RawDocument]:
        try:
            from google.cloud import bigquery
        except ImportError as exc:
            raise RuntimeError(
                "Patent ingestion requires: pip install -e '.[bigquery]'"
            ) from exc

        project = os.getenv("GCP_PROJECT_ID")
        if not project:
            raise RuntimeError("GCP_PROJECT_ID is required for BigQuery patent ingestion")

        sql, keyword_parameters = self._build_query(
            include_description=self.settings.scope.patents.include_description
        )
        scope = self.settings.scope
        query_parameters = self._query_parameters(bigquery, limit, keyword_parameters)
        maximum_bytes = int(os.getenv("BIGQUERY_MAX_BYTES_BILLED", "5000000000"))
        job_config = bigquery.QueryJobConfig(
            query_parameters=query_parameters,
            maximum_bytes_billed=maximum_bytes,
            use_query_cache=True,
        )
        client = bigquery.Client(project=project)

        for row in client.query(sql, job_config=job_config).result():
            external_id = str(row.publication_number)
            sections = {
                "abstract": row.abstract_text or "",
                "claims": row.claims_text or "",
                "description": row.description_text or "",
            }
            yield RawDocument(
                id=RawDocument.stable_id(self.source_name, external_id),
                source="google_patents_bigquery",
                document_type="patent",
                external_id=external_id,
                title=row.title_text or external_id,
                publication_date=self._date_from_integer(row.publication_date),
                language=scope.languages[0] if scope.languages else None,
                country=row.country_code,
                url=f"https://patents.google.com/patent/{external_id}",
                ipc_classes=list(row.ipc_codes or []),
                cpc_classes=list(row.cpc_codes or []),
                keywords=scope.keywords,
                sections=sections,
                metadata={"dataset": "patents-public-data.patents.publications"},
            )
