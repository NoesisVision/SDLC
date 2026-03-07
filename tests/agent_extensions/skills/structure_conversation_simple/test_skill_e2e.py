"""End-to-end test for structure_conversation_simple skill using Claude CLI."""

import json
import subprocess
from pathlib import Path

import pytest

_SDLC_ROOT = Path(__file__).resolve().parents[4]
_VALID_CATEGORIES = {"Issue", "Position", "Argument", "Information", "Agreement", "Decision", "Irrelevant"}

_E2E_CONVERSATION = """\
# Database Selection Meeting
2025-03-15 10:00
**10:00**
Jan Kowalski
We need to decide on the database technology for our new project. Should we use PostgreSQL or MongoDB?
**10:02**
Anna Nowak
I think PostgreSQL is better for our use case. It has strong ACID compliance and we need transactional guarantees for financial data.
**10:04**
Jan Kowalski
Good point. Let's go with PostgreSQL then. I will set up the development instance by Friday.
"""


@pytest.mark.e2e
def test_e2e_complete_workflow(tmp_path):
    (tmp_path / ".git").mkdir()

    conv_file = tmp_path / "db_meeting.md"
    conv_file.write_text(_E2E_CONVERSATION, encoding="utf-8")

    result = subprocess.run(
        [
            "claude",
            "-p",
            f"/noesis:structure-conversation-simple {conv_file}",
            "--dangerously-skip-permissions",
            "--output-format", "json",
            "--no-session-persistence",
            "--max-budget-usd", "1.00",
        ],
        capture_output=True,
        text=True,
        cwd=str(_SDLC_ROOT),
        timeout=300,
    )

    assert result.returncode == 0, f"Claude CLI failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"

    noesis_dir = tmp_path / ".noesis" / "conversations"
    assert noesis_dir.exists(), f"Expected .noesis/conversations/ directory in {tmp_path}"

    structured_files = list(noesis_dir.glob("*_structured.json"))
    assert len(structured_files) >= 1, (
        f"Expected at least one _structured.json file in {noesis_dir}, "
        f"found: {list(noesis_dir.rglob('*'))}"
    )

    output = json.loads(structured_files[0].read_text(encoding="utf-8"))
    assert "conversation_id" in output
    assert "title" in output
    assert "date" in output
    assert "topics" in output
    assert isinstance(output["topics"], list)
    assert len(output["topics"]) >= 1

    for topic in output["topics"]:
        assert "name" in topic
        assert "summary" in topic
        assert "statements" in topic
        assert isinstance(topic["statements"], list)

        for statement in topic["statements"]:
            assert "speaker" in statement
            assert "time" in statement
            assert "idea_units" in statement
            assert isinstance(statement["idea_units"], list)

            for iu in statement["idea_units"]:
                assert "sentences" in iu
                assert isinstance(iu["sentences"], list)
                assert "category" in iu
                assert iu["category"] in _VALID_CATEGORIES
