"""Static checks on the frontend source and build output (no browser needed)."""

import re
from pathlib import Path

import pytest

from app.config import APP_NAME

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend" / "src"
DIST = ROOT / "frontend" / "dist"

# Same patterns as frontend/e2e/fixtures.ts FORBIDDEN.
LEAK_PATTERNS = [
    r"world_truth",
    r"/_env\b",
    r"\bscenarios?\b",
    r"\bbreakout\b",
    r"\bfakeout\b",
    r"\bsharp_drop\b",
    r"\bvolume_surge\b",
    r"\bspike\b",
    r"\bt[1-4]_sec\b",
]


def source_files() -> list[Path]:
    return [p for p in SRC.rglob("*") if p.suffix in {".ts", ".tsx", ".css"}]


def test_frontend_never_reads_real_time():
    pattern = re.compile(r"Date\.now|new Date\b|performance\.now|Date\(")
    offenders = [str(p) for p in source_files() if pattern.search(p.read_text())]
    assert offenders == []


def test_colors_only_in_theme_tokens():
    hex_color = re.compile(r"#[0-9a-fA-F]{3,8}\b")
    offenders = [
        str(p) for p in source_files() if p.name != "theme.ts" and hex_color.search(p.read_text())
    ]
    assert offenders == []


def test_app_name_not_hardcoded_in_frontend():
    offenders = [str(p) for p in source_files() if APP_NAME.lower() in p.read_text().lower()]
    index = (ROOT / "frontend" / "index.html").read_text()
    assert offenders == [] and APP_NAME not in index


@pytest.mark.skipif(not (DIST / "index.html").exists(), reason="frontend not built (npm run build)")
def test_built_assets_have_no_leaks_or_source_maps():
    files = [p for p in DIST.rglob("*") if p.is_file()]
    assert not [p for p in files if p.suffix == ".map"]
    for p in files:
        text = p.read_text(errors="ignore")
        assert "sourceMappingURL" not in text, p
        for pat in LEAK_PATTERNS:
            assert not re.search(pat, text), f"{pat} found in {p}"
