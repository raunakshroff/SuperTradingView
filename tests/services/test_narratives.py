import json
from pathlib import Path

import pytest

from services.narratives import load_narratives, list_narratives


def test_list_narratives_returns_seeded_themes(tmp_path):
    data = {"narratives": [
        {"id": "a", "title": "A", "desc": "", "symbols": [{"source": "yfinance", "symbol": "AAA"}]},
    ]}
    p = tmp_path / "narratives.json"
    p.write_text(json.dumps(data))
    result = list_narratives(p)
    assert result == data["narratives"]


def test_list_narratives_missing_file_returns_empty(tmp_path):
    p = tmp_path / "absent.json"
    result = list_narratives(p)
    assert result == []


def test_list_narratives_malformed_file_returns_empty(tmp_path):
    p = tmp_path / "narratives.json"
    p.write_text("{not valid json")
    result = list_narratives(p)
    assert result == []


def test_load_narratives_reads_real_file():
    repo_root = Path(__file__).resolve().parents[2]
    real = repo_root / "narratives.json"
    if not real.exists():
        pytest.skip("narratives.json not seeded yet")
    items = list_narratives(real)
    assert len(items) >= 6
    ids = {n["id"] for n in items}
    assert {"ai", "energy", "war", "cuts", "reflation", "mag7"}.issubset(ids)
