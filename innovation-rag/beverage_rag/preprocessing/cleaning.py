from __future__ import annotations

import html
import re
import unicodedata


TAG_RE = re.compile(r"<[^>]+>")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
PAGE_ARTIFACT_RE = re.compile(r"(?im)^\s*(?:page\s+)?\d+\s*(?:of\s+\d+)?\s*$")


def clean_text(value: str) -> str:
    """Normalize public-source text without changing technical symbols."""
    text = html.unescape(value or "")
    text = TAG_RE.sub(" ", text)
    text = unicodedata.normalize("NFKC", text)
    text = CONTROL_RE.sub(" ", text)
    text = PAGE_ARTIFACT_RE.sub(" ", text)
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\t\f\v ]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_words(
    text: str,
    size: int,
    overlap: int,
    minimum: int,
) -> list[str]:
    words = text.split()
    if len(words) < minimum:
        return []
    if len(words) <= size:
        return [" ".join(words)]

    step = size - overlap
    chunks: list[str] = []
    start = 0
    while start < len(words):
        window = words[start : start + size]
        if len(window) < minimum and chunks:
            tail = words[max(0, start - overlap) :]
            chunks[-1] = " ".join(chunks[-1].split()[: size - overlap] + tail)
            break
        chunks.append(" ".join(window))
        if start + size >= len(words):
            break
        start += step
    return chunks

