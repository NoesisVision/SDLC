"""Tests for load_transcript_chunk.py — chunked transcript reading for topic extraction."""

from pathlib import Path

from load_transcript_chunk import load_transcript_chunk
from models_core import Conversation, IdeaUnit, IdeaUnitCategory, Turn


class TestFirstChunk:
    def test_returns_turns_from_beginning(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=10000)
        assert result["status"] == "Ok"
        assert len(result["turns"]) == 5
        assert result["turns"][0]["speaker"] == "Alice"
        assert result["turns"][0]["index"] == 0

    def test_all_turns_fit_returns_has_more_false(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=10000)
        assert result["has_more"] is False


class TestTokenLimit:
    def test_respects_token_limit(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=50)
        assert len(result["turns"]) < 5
        assert result["has_more"] is True

    def test_always_returns_at_least_one_turn(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=1)
        assert len(result["turns"]) >= 1


class TestResumption:
    def test_skips_already_processed_turns(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        _mark_turns_processed(working_dir, turn_count=2)
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=10000)
        assert result["turns"][0]["index"] == 2
        assert result["turns"][0]["speaker"] == "Alice"

    def test_returns_empty_when_all_turns_processed(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        _mark_turns_processed(working_dir, turn_count=5)
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=10000)
        assert result["turns"] == []
        assert result["has_more"] is False

    def test_has_more_reflects_remaining_after_resumption(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        _mark_turns_processed(working_dir, turn_count=4)
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=10000)
        assert len(result["turns"]) == 1
        assert result["has_more"] is False


class TestTurnIndices:
    def test_indices_match_original_transcript_positions(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=10000)
        indices = [t["index"] for t in result["turns"]]
        assert indices == [0, 1, 2, 3, 4]

    def test_indices_correct_after_resumption(
        self, working_dir: Path, structured_transcript: Path, conversation_json: Path,
    ) -> None:
        _mark_turns_processed(working_dir, turn_count=3)
        result = load_transcript_chunk(working_dir, structured_transcript, token_limit=10000)
        indices = [t["index"] for t in result["turns"]]
        assert indices == [3, 4]


def _mark_turns_processed(working_dir: Path, turn_count: int) -> None:
    """Simulate previous chunk processing by adding stub turns to conversation.json."""
    conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
    for i in range(turn_count):
        conv.turns.append(Turn(
            index=i,
            speaker="stub",
            time="00:00:00",
            idea_units=[IdeaUnit(index=0, sentences=["stub"], categories=[IdeaUnitCategory.Irrelevant])],
        ))
    (working_dir / "conversation.json").write_text(conv.model_dump_json(indent=2), encoding="utf-8")
