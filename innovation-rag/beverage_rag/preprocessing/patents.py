from __future__ import annotations

import re

from beverage_rag.preprocessing.cleaning import clean_text


CLAIM_RE = re.compile(
    r"(?m)(?=^\s*(?:claim\s+)?\d+[\.)]\s+|^\s*what is claimed is\s*:?)",
    re.IGNORECASE,
)


def patent_sections(sections: dict[str, str]) -> list[tuple[str, str]]:
    """Preserve patent legal sections and split individually numbered claims."""
    output: list[tuple[str, str]] = []
    for name in ("abstract", "claims", "description"):
        text = clean_text(sections.get(name, ""))
        if not text:
            continue
        if name != "claims":
            output.append((name, text))
            continue
        claims = [part.strip() for part in CLAIM_RE.split(text) if part.strip()]
        if len(claims) <= 1:
            output.append(("claims", text))
        else:
            output.extend((f"claim_{index}", claim) for index, claim in enumerate(claims, 1))
    return output

