from datetime import date
from pathlib import Path

from beverage_rag.schemas import RawDocument, read_jsonl, write_jsonl


def test_jsonl_round_trip_is_lossless(tmp_path: Path) -> None:
    document = RawDocument(
        id=RawDocument.stable_id("test", "record-1"),
        source="test_fixture",
        document_type="publication",
        external_id="record-1",
        title="Test-only fixture",
        publication_date=date(2025, 1, 1),
        sections={"abstract": "Public fixture text."},
    )
    path = tmp_path / "documents.jsonl"

    write_jsonl(path, [document])
    loaded = read_jsonl(path, RawDocument)

    assert loaded[0].model_dump() == document.model_dump()

