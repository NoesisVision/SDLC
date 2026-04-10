"""Tests for init_conversation.py — conversation.json initialization."""

from pathlib import Path

from init_conversation import init_conversation
from models_core import Conversation


class TestInitConversation:
    def test_creates_conversation_json_in_working_dir(self, working_dir: Path) -> None:
        init_conversation(working_dir, "conv-1", "2026-04-10 14:00:00", "Auth redesign")
        assert (working_dir / "conversation.json").exists()

    def test_stores_metadata_fields(self, working_dir: Path) -> None:
        init_conversation(working_dir, "conv-1", "2026-04-10 14:00:00", "Auth redesign")
        conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
        assert conv.conversation_id == "conv-1"
        assert conv.time == "2026-04-10 14:00:00"
        assert conv.main_topic == "Auth redesign"

    def test_starts_with_empty_analysis_fields(self, working_dir: Path) -> None:
        init_conversation(working_dir, "conv-1", "2026-04-10 14:00:00", "Auth redesign")
        conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
        assert conv.turns == []
        assert conv.topics == []
        assert conv.decisions == []

    def test_returns_output_path(self, working_dir: Path) -> None:
        result = init_conversation(working_dir, "conv-1", "2026-04-10 14:00:00", "Auth redesign")
        assert Path(result).exists()
