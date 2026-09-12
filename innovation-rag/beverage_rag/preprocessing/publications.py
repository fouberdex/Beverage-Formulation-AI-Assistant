from __future__ import annotations

import re

from beverage_rag.preprocessing.cleaning import clean_text


SECTION_ALIASES = {
    "abstract": "abstract",
    "résumé": "abstract",
    "introduction": "introduction",
    "background": "introduction",
    "materials and methods": "methods",
    "materials & methods": "methods",
    "methods": "methods",
    "méthodes": "methods",
    "results": "results",
    "résultats": "results",
    "discussion": "discussion",
    "conclusion": "conclusion",
    "conclusions": "conclusion",
}
HEADING_RE = re.compile(
    r"(?im)^\s*(?:\d+(?:\.\d+)*[.)]?\s+)?("
    + "|".join(re.escape(name) for name in SECTION_ALIASES)
    + r")\s*:?\s*$"
)


def split_detected_sections(text: str) -> list[tuple[str, str]]:
    matches = list(HEADING_RE.finditer(text))
    if not matches:
        return [("full_text", text)] if text else []
    sections: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            sections.append((SECTION_ALIASES[match.group(1).lower()], body))
    return sections


def publication_sections(sections: dict[str, str]) -> list[tuple[str, str]]:
    output: list[tuple[str, str]] = []
    for name, raw_text in sections.items():
        text = clean_text(raw_text)
        if not text:
            continue
        normalized_name = SECTION_ALIASES.get(name.lower(), name.lower())
        if normalized_name in {"full_text", "body", "text"}:
            output.extend(split_detected_sections(text))
        else:
            output.append((normalized_name, text))
    return output

