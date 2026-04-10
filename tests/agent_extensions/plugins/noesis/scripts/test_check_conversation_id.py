"""Tests for check_conversation_id.py — conversation ID extraction and validation."""

import json
from pathlib import Path

from check_conversation_id import (
    extract_conversation_id,
    is_id_in_knowledge_graph,
    prepend_conversation_id,
)
from sample_data import SAMPLE_CONVERSATION_ID


class TestExtractConversationId:
    def test_extracts_id_from_first_line(self, transcript_path: Path) -> None:
        result = extract_conversation_id(transcript_path)
        assert result == SAMPLE_CONVERSATION_ID

    def test_returns_none_when_no_id_present(self, transcript_without_id: Path) -> None:
        result = extract_conversation_id(transcript_without_id)
        assert result is None

    def test_returns_none_for_malformed_marker(self, tmp_path: Path) -> None:
        path = tmp_path / "bad.md"
        path.write_text("<!-- wrong_tag: abc -->\n**00:05**\nAlice\nHello.\n")
        assert extract_conversation_id(path) is None


class TestPrependConversationId:
    def test_adds_id_line_and_preserves_content(self, transcript_without_id: Path) -> None:
        original = transcript_without_id.read_text()
        prepend_conversation_id("new-id-123", transcript_without_id)

        updated = transcript_without_id.read_text()
        assert updated.startswith("<!-- conversation_id: new-id-123 -->\n")
        assert updated.endswith(original)

    def test_id_is_extractable_after_prepend(self, transcript_without_id: Path) -> None:
        prepend_conversation_id("new-id-456", transcript_without_id)
        assert extract_conversation_id(transcript_without_id) == "new-id-456"


class TestIsIdInKnowledgeGraph:
    def test_returns_true_when_conversation_exists(self, tmp_path: Path) -> None:
        kg_path = tmp_path / "kg.json"
        kg_path.write_text(json.dumps({
            "conversations": [{"conversation_id": "existing-id", "time": "", "main_topic": "", "turns": []}],
            "topics": [],
            "decisions": [],
        }))
        assert is_id_in_knowledge_graph("existing-id", kg_path) is True

    def test_returns_false_when_conversation_not_found(self, knowledge_graph_path: Path) -> None:
        assert is_id_in_knowledge_graph("nonexistent-id", knowledge_graph_path) is False

    def test_returns_false_when_file_does_not_exist(self, tmp_path: Path) -> None:
        assert is_id_in_knowledge_graph("any-id", tmp_path / "missing.json") is False
