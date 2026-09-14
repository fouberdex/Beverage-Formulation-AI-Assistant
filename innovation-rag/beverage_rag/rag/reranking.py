from __future__ import annotations

import os

import httpx

from beverage_rag.schemas import RetrievedChunk
from beverage_rag.settings import RerankingSettings


class Reranker:
    def __init__(self, settings: RerankingSettings) -> None:
        self.settings = settings
        self._local_model = None

    def rerank(
        self, question: str, candidates: list[RetrievedChunk]
    ) -> list[RetrievedChunk]:
        if not self.settings.enabled or not candidates:
            return candidates
        pool = candidates[: self.settings.candidate_pool_size]
        if self.settings.provider == "http":
            return self._rerank_http(question, pool)
        return self._rerank_local(question, pool)

    def _rerank_http(
        self, question: str, candidates: list[RetrievedChunk]
    ) -> list[RetrievedChunk]:
        headers: dict[str, str] = {}
        api_key = os.getenv("RERANKER_API_KEY") or os.getenv("VLLM_API_KEY")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        url = self.settings.base_url.rstrip("/") + "/rerank"
        ranked: list[RetrievedChunk] = []
        try:
            with httpx.Client(timeout=self.settings.timeout_seconds, headers=headers) as client:
                batch_size = self.settings.request_batch_size
                for offset in range(0, len(candidates), batch_size):
                    batch = candidates[offset : offset + batch_size]
                    response = client.post(
                        url,
                        json={
                            "model": self.settings.model,
                            "query": question,
                            "documents": [item.chunk.text for item in batch],
                            # All batch scores are needed for the final global ranking.
                            "top_n": len(batch),
                        },
                    )
                    response.raise_for_status()
                    for result in response.json()["results"]:
                        index = int(result["index"])
                        if index < 0 or index >= len(batch):
                            continue
                        ranked.append(
                            RetrievedChunk(
                                chunk=batch[index].chunk,
                                score=float(result["relevance_score"]),
                            )
                        )
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text.strip()[:800]
            raise RuntimeError(
                f"Le reranker GPU a refusé la requête (HTTP "
                f"{exc.response.status_code}): {detail or 'aucun détail'}. "
                "Si /health fonctionne, réduisez la taille ou le nombre de passages "
                "par lot; sinon relancez le tunnel Kaggle."
            ) from exc
        except httpx.RequestError as exc:
            raise RuntimeError(
                f"Le reranker GPU est inaccessible ({type(exc).__name__}). "
                "La recherche locale Qdrant peut "
                "fonctionner, mais le tunnel Kaggle a expiré ou la cellule serveur "
                "est arrêtée. Relancez les cellules serveur/tunnel Kaggle, téléchargez "
                "le nouveau fichier de connexion, puis redémarrez Streamlit."
            ) from exc
        if not ranked:
            raise RuntimeError("The reranker returned no valid result")
        ranked.sort(key=lambda item: item.score, reverse=True)
        return ranked[: self.settings.top_n]

    def _rerank_local(
        self, question: str, candidates: list[RetrievedChunk]
    ) -> list[RetrievedChunk]:
        if self._local_model is None:
            try:
                from sentence_transformers import CrossEncoder
            except ImportError as exc:
                raise RuntimeError(
                    "Local reranking requires: pip install -e '.[rag]'"
                ) from exc
            self._local_model = CrossEncoder(self.settings.model)
        scores = self._local_model.predict(
            [(question, item.chunk.text) for item in candidates],
            show_progress_bar=False,
        )
        ranked = sorted(
            (
                RetrievedChunk(chunk=item.chunk, score=float(score))
                for item, score in zip(candidates, scores, strict=True)
            ),
            key=lambda item: item.score,
            reverse=True,
        )
        return ranked[: self.settings.top_n]
