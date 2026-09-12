from __future__ import annotations

import os

import httpx

from beverage_rag.settings import GenerationSettings


SYSTEM_PROMPT = """Tu es un analyste en innovation pour l'industrie des boissons.
Réponds uniquement à partir des extraits publics fournis. Chaque affirmation technique
doit être suivie d'au moins une citation [S1], [S2], etc. N'invente jamais une référence,
un résultat expérimental ou une portée juridique. Distingue clairement brevet publié,
preuve scientifique et hypothèse. Si les extraits sont insuffisants, dis-le explicitement.
Réponds dans la langue de la question."""


class LocalGenerator:
    def __init__(self, settings: GenerationSettings) -> None:
        self.settings = settings

    def generate(self, question: str, context: str) -> str:
        user_prompt = f"CONTEXTE PUBLIC\n{context}\n\nQUESTION\n{question}"
        if self.settings.provider == "ollama":
            return self._ollama(user_prompt)
        return self._vllm(user_prompt)

    def _ollama(self, user_prompt: str) -> str:
        url = self.settings.base_url.rstrip("/") + "/api/chat"
        with httpx.Client(timeout=self.settings.timeout_seconds) as client:
            response = client.post(
                url,
                json={
                    "model": self.settings.model,
                    "stream": False,
                    "options": {"temperature": self.settings.temperature},
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                },
            )
            response.raise_for_status()
            return response.json()["message"]["content"].strip()

    def _vllm(self, user_prompt: str) -> str:
        url = self.settings.base_url.rstrip("/") + "/chat/completions"
        headers = {}
        if api_key := os.getenv("VLLM_API_KEY"):
            headers["Authorization"] = f"Bearer {api_key}"
        with httpx.Client(timeout=self.settings.timeout_seconds, headers=headers) as client:
            response = client.post(
                url,
                json={
                    "model": self.settings.model,
                    "temperature": self.settings.temperature,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"].strip()

