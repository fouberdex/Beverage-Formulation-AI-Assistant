from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import Iterator
from typing import Any

import httpx

from beverage_rag.schemas import RawDocument
from beverage_rag.settings import Settings


class SourceConnector(ABC):
    source_name: str

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @abstractmethod
    def fetch(self, limit: int) -> Iterator[RawDocument]:
        """Yield at most ``limit`` normalized public documents."""

    def throttle(self) -> None:
        time.sleep(1 / self.settings.ingestion.requests_per_second)


def requested_limit(settings: Settings, source: str, override: int | None) -> int:
    configured = settings.ingestion.per_source_limit.get(source, 0)
    if configured <= 0:
        raise ValueError(f"No positive ingestion limit configured for {source}")
    return min(configured, override) if override is not None else configured


def get_with_retry(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any],
    attempts: int = 4,
) -> httpx.Response:
    """GET with bounded, rate-limit-aware retries for public APIs."""
    for attempt in range(attempts):
        response = client.get(url, params=params)
        if response.status_code not in {429, 500, 502, 503, 504}:
            response.raise_for_status()
            return response
        if attempt == attempts - 1:
            response.raise_for_status()
        retry_after = response.headers.get("retry-after")
        try:
            delay = float(retry_after) if retry_after else 2 ** (attempt + 1)
        except ValueError:
            delay = 2 ** (attempt + 1)
        time.sleep(min(max(delay, 1), 30))
    raise RuntimeError("Unreachable retry state")
