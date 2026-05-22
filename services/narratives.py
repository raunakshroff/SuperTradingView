"""Narratives — curated themed groupings of symbols.

Reads from `narratives.json` at the project root. Schema:

    {"narratives": [
        {"id": "ai", "title": "AI boom", "desc": "...", "symbols": [{"source": ..., "symbol": ...}]}
    ]}
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_narratives(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"narratives": []}


def list_narratives(path: Path) -> list[dict[str, Any]]:
    data = load_narratives(path)
    items = data.get("narratives", [])
    return items if isinstance(items, list) else []
