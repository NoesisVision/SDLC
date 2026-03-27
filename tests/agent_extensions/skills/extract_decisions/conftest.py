"""Shared fixtures for extract_decisions skill tests."""

from pathlib import Path

import pytest

_SDLC_ROOT = Path(__file__).resolve().parents[4]
_SCRIPTS_DIR = _SDLC_ROOT / "src" / "agent_extensions" / "skills" / "extract_decisions" / "scripts"


@pytest.fixture()
def sdlc_root():
    return _SDLC_ROOT


@pytest.fixture()
def scripts_dir():
    return _SCRIPTS_DIR


@pytest.fixture()
def work_dir(tmp_path):
    """Create a working directory with batch and result subdirectories."""
    (tmp_path / "batches").mkdir()
    (tmp_path / "results").mkdir()
    return tmp_path
