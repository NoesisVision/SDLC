"""Shared fixtures for extract_decisions skill tests."""

import sys
from pathlib import Path

import pytest

_SDLC_ROOT = Path(__file__).resolve().parents[4]
_SCRIPTS_DIR = _SDLC_ROOT / "src" / "agent_extensions" / "skills" / "extract_decisions" / "scripts"
_TESTS_DIR = str(Path(__file__).resolve().parent)

sys.path.insert(0, str(_SCRIPTS_DIR))
sys.path.insert(0, _TESTS_DIR)


@pytest.fixture()
def sdlc_root():
    return _SDLC_ROOT


@pytest.fixture()
def scripts_dir():
    return _SCRIPTS_DIR


@pytest.fixture()
def work_dir(tmp_path):
    """Create a working directory with a batches subdirectory."""
    (tmp_path / "batches").mkdir()
    return tmp_path
