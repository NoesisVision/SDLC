"""Tests for working_dir.py — working directory creation and resolution."""

from pathlib import Path

from working_dir import get_working_dir


class TestWorkingDirPath:
    def test_placed_next_to_transcript(self, tmp_path: Path) -> None:
        transcript = tmp_path / "sprint_review.md"
        result = get_working_dir(transcript)
        assert result.parent == tmp_path

    def test_named_after_transcript_with_work_suffix(self, tmp_path: Path) -> None:
        transcript = tmp_path / "sprint_review.md"
        result = get_working_dir(transcript)
        assert result.name == "sprint_review_work"

    def test_strips_extension_before_adding_suffix(self, tmp_path: Path) -> None:
        transcript = tmp_path / "meeting.notes.md"
        result = get_working_dir(transcript)
        assert result.name == "meeting.notes_work"

    def test_consistent_for_same_transcript(self, tmp_path: Path) -> None:
        transcript = tmp_path / "meeting.md"
        assert get_working_dir(transcript) == get_working_dir(transcript)
