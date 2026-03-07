"""Tests for parse_conversation.py script."""

import json
from pathlib import Path


def test_parse_complete_conversation(test_project, scripts_dir, run_script, basic_conversation):
    conv_file = test_project / "meeting.md"
    conv_file.write_text(basic_conversation, encoding="utf-8")

    code, result, _ = run_script(scripts_dir / "parse_conversation.py", [str(conv_file)])

    assert code == 0
    assert result["status"] == "success"
    assert result["conversation_id"]
    assert result["missing"] == []

    work_dir = Path(result["work_dir"])
    parsed = json.loads((work_dir / "parsed.json").read_text())
    assert parsed["title"] == "Sprint Planning Meeting"
    assert parsed["date"] == "2025-03-01"
    assert len(parsed["turns"]) == 4

    updated_text = conv_file.read_text(encoding="utf-8")
    assert updated_text.startswith("<!-- conversation_id:")


def test_parse_missing_title(test_project, scripts_dir, run_script, conversation_no_title):
    conv_file = test_project / "no_title.md"
    conv_file.write_text(conversation_no_title, encoding="utf-8")

    code, result, _ = run_script(scripts_dir / "parse_conversation.py", [str(conv_file)])

    assert code == 0
    assert result["status"] == "incomplete"
    assert "title" in result["missing"]


def test_parse_missing_date(test_project, scripts_dir, run_script, conversation_no_date):
    conv_file = test_project / "no_date.md"
    conv_file.write_text(conversation_no_date, encoding="utf-8")

    code, result, _ = run_script(scripts_dir / "parse_conversation.py", [str(conv_file)])

    assert code == 0
    assert result["status"] == "incomplete"
    assert "date" in result["missing"]


def test_parse_with_overrides(test_project, scripts_dir, run_script, conversation_no_title):
    conv_file = test_project / "override.md"
    conv_file.write_text(conversation_no_title, encoding="utf-8")

    code, result, _ = run_script(
        scripts_dir / "parse_conversation.py",
        [str(conv_file), "--title", "Custom Title", "--date", "2025-06-15"],
    )

    assert code == 0
    assert result["status"] == "success"
    assert result["missing"] == []

    work_dir = Path(result["work_dir"])
    parsed = json.loads((work_dir / "parsed.json").read_text())
    assert parsed["title"] == "Custom Title"
    assert parsed["date"] == "2025-06-15"


def test_parse_reuses_existing_conversation_id(test_project, scripts_dir, run_script, basic_conversation):
    existing_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    conv_file = test_project / "reuse_id.md"
    conv_file.write_text(
        f"<!-- conversation_id: {existing_id} -->\n{basic_conversation}",
        encoding="utf-8",
    )

    code, result, _ = run_script(scripts_dir / "parse_conversation.py", [str(conv_file)])

    assert code == 0
    assert result["conversation_id"] == existing_id


def test_parse_empty_file(test_project, scripts_dir, run_script):
    conv_file = test_project / "empty.md"
    conv_file.write_text("", encoding="utf-8")

    code, result, _ = run_script(scripts_dir / "parse_conversation.py", [str(conv_file)])

    assert code == 1
    assert result["status"] == "error"


def test_parse_no_turns(test_project, scripts_dir, run_script, conversation_metadata_only):
    conv_file = test_project / "no_turns.md"
    conv_file.write_text(conversation_metadata_only, encoding="utf-8")

    code, result, _ = run_script(scripts_dir / "parse_conversation.py", [str(conv_file)])

    assert code == 1
    assert result["status"] == "error"


def test_parse_sentence_splitting(test_project, scripts_dir, run_script, basic_conversation):
    conv_file = test_project / "sentences.md"
    conv_file.write_text(basic_conversation, encoding="utf-8")

    code, result, _ = run_script(scripts_dir / "parse_conversation.py", [str(conv_file)])

    assert code == 0
    work_dir = Path(result["work_dir"])
    parsed = json.loads((work_dir / "parsed.json").read_text())

    first_turn = parsed["turns"][0]
    assert isinstance(first_turn["sentences"], list)
    assert len(first_turn["sentences"]) >= 2
    assert all(isinstance(s, str) for s in first_turn["sentences"])
