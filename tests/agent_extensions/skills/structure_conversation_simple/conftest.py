"""Shared fixtures for structure_conversation_simple skill tests."""

import json
import subprocess
from pathlib import Path

import pytest

_SDLC_ROOT = Path(__file__).resolve().parents[4]
_SCRIPTS_DIR = _SDLC_ROOT / "src" / "agent_extensions" / "skills" / "structure_conversation_simple" / "scripts"

_BASIC_CONVERSATION = """\
# Sprint Planning Meeting
2025-03-01
**10:00**
Jan Kowalski
We need to decide on the database technology. Should we use PostgreSQL or MongoDB?
**10:02**
Anna Nowak
I think PostgreSQL is better for our use case. It has strong ACID compliance and we need transactional guarantees.
**10:04**
Jan Kowalski
Good point. Let's go with PostgreSQL then. I will set up the development instance by Friday.
**10:06**
Anna Nowak
We also need to discuss the deployment pipeline. Are we using Docker or Kubernetes?
"""

_CONVERSATION_NO_TITLE = """\
2025-02-19
**14:00**
Speaker1
Hello world. This is a test conversation.
"""

_CONVERSATION_NO_DATE = """\
# Some Meeting
**08:30**
Speaker1
Good morning everyone. Let's start the meeting.
"""

_CONVERSATION_METADATA_ONLY = """\
# Title Only
2025-01-01
"""


def _run_script(script_path, args, cwd=_SDLC_ROOT):
    result = subprocess.run(
        ["uv", "run", "python", str(script_path), *args],
        capture_output=True,
        text=True,
        cwd=str(cwd),
        timeout=60,
    )
    parsed = None
    if result.stdout.strip():
        try:
            parsed = json.loads(result.stdout)
        except json.JSONDecodeError:
            pass
    return result.returncode, parsed, result.stdout


@pytest.fixture()
def sdlc_root():
    return _SDLC_ROOT


@pytest.fixture()
def scripts_dir():
    return _SCRIPTS_DIR


@pytest.fixture()
def run_script():
    """Return the run_script callable."""
    return _run_script


@pytest.fixture()
def test_project(tmp_path):
    """Create a temporary directory with .git for project root detection."""
    (tmp_path / ".git").mkdir()
    return tmp_path


@pytest.fixture()
def basic_conversation():
    return _BASIC_CONVERSATION


@pytest.fixture()
def conversation_no_title():
    return _CONVERSATION_NO_TITLE


@pytest.fixture()
def conversation_no_date():
    return _CONVERSATION_NO_DATE


@pytest.fixture()
def conversation_metadata_only():
    return _CONVERSATION_METADATA_ONLY
