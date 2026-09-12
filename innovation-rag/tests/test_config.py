from pathlib import Path

import pytest

from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]


def test_default_scope_is_narrow_and_configurable() -> None:
    settings = Settings.load(ROOT / "config" / "soda.yaml")

    assert settings.scope.domain == "boissons gazeuses"
    assert "A23L2" in settings.scope.patents.ipc_prefixes
    assert len(settings.scope.keywords) == 10
    assert settings.preprocessing.chunk_overlap_words < settings.preprocessing.chunk_size_words


def test_invalid_date_range_is_rejected(tmp_path: Path) -> None:
    config = (ROOT / "config" / "soda.yaml").read_text(encoding="utf-8")
    config = config.replace('date_from: "2018-01-01"', 'date_from: "2027-01-01"')
    path = tmp_path / "invalid.yaml"
    path.write_text(config, encoding="utf-8")

    with pytest.raises(ValueError, match="date_from"):
        Settings.load(path)
