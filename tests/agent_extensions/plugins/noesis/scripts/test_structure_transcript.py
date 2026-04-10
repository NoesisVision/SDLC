"""Tests for structure_transcript.py — transcript parsing and normalization."""

from pathlib import Path

from models_transcript import RawTranscript
from structure_transcript import structure_transcript
from sample_data import (
    SAMPLE_CONVERSATION_ID,
    SAMPLE_TRANSCRIPT_WITH_ID,
)


class TestTranscriptParsing:
    def test_produces_json_in_working_directory(self, transcript_path: Path) -> None:
        working_dir = transcript_path.parent / f"{transcript_path.stem}_work"
        working_dir.mkdir()
        result = structure_transcript(transcript_path, SAMPLE_CONVERSATION_ID)
        assert result["status"] == "Ok"
        assert Path(result["output_path"]).exists()
        assert Path(result["output_path"]).parent == working_dir

    def test_extracts_all_speaker_turns(self, transcript_path: Path) -> None:
        working_dir = transcript_path.parent / f"{transcript_path.stem}_work"
        working_dir.mkdir()
        result = structure_transcript(transcript_path, SAMPLE_CONVERSATION_ID)
        transcript = RawTranscript.model_validate_json(Path(result["output_path"]).read_bytes())
        assert len(transcript.turns) == 5

    def test_preserves_speaker_names(self, transcript_path: Path) -> None:
        working_dir = transcript_path.parent / f"{transcript_path.stem}_work"
        working_dir.mkdir()
        result = structure_transcript(transcript_path, SAMPLE_CONVERSATION_ID)
        transcript = RawTranscript.model_validate_json(Path(result["output_path"]).read_bytes())
        speakers = [t.speaker for t in transcript.turns]
        assert speakers == ["Alice", "Bob", "Alice", "Bob", "Alice"]

    def test_normalizes_short_timestamps_to_hh_mm_ss(self, transcript_path: Path) -> None:
        working_dir = transcript_path.parent / f"{transcript_path.stem}_work"
        working_dir.mkdir()
        result = structure_transcript(transcript_path, SAMPLE_CONVERSATION_ID)
        transcript = RawTranscript.model_validate_json(Path(result["output_path"]).read_bytes())
        assert transcript.turns[0].time == "00:00:05"
        assert transcript.turns[2].time == "00:01:15"

    def test_splits_text_into_sentences(self, transcript_path: Path) -> None:
        working_dir = transcript_path.parent / f"{transcript_path.stem}_work"
        working_dir.mkdir()
        result = structure_transcript(transcript_path, SAMPLE_CONVERSATION_ID)
        transcript = RawTranscript.model_validate_json(Path(result["output_path"]).read_bytes())
        first_turn = transcript.turns[0]
        assert len(first_turn.sentences) >= 2

    def test_stores_conversation_id_in_output(self, transcript_path: Path) -> None:
        working_dir = transcript_path.parent / f"{transcript_path.stem}_work"
        working_dir.mkdir()
        result = structure_transcript(transcript_path, SAMPLE_CONVERSATION_ID)
        transcript = RawTranscript.model_validate_json(Path(result["output_path"]).read_bytes())
        assert transcript.conversation_id == SAMPLE_CONVERSATION_ID


class TestTranscriptNormalization:
    def test_replaces_smart_quotes(self, tmp_path: Path) -> None:
        path = tmp_path / "smart.md"
        working_dir = tmp_path / "smart_work"
        working_dir.mkdir()
        path.write_text("**00:05**\nAlice\nShe said \u201chello\u201d and it\u2019s fine.\n")
        result = structure_transcript(path, "conv-1")
        transcript = RawTranscript.model_validate_json(Path(result["output_path"]).read_bytes())
        text = " ".join(transcript.turns[0].sentences)
        assert "\u201c" not in text
        assert "\u2019" not in text

    def test_strips_conversation_id_line_before_parsing(self, tmp_path: Path) -> None:
        path = tmp_path / "with_id.md"
        working_dir = tmp_path / "with_id_work"
        working_dir.mkdir()
        path.write_text(SAMPLE_TRANSCRIPT_WITH_ID)
        result = structure_transcript(path, SAMPLE_CONVERSATION_ID)
        transcript = RawTranscript.model_validate_json(Path(result["output_path"]).read_bytes())
        first_sentence = transcript.turns[0].sentences[0]
        assert "conversation_id" not in first_sentence


class TestTranscriptErrors:
    def test_returns_error_for_empty_file(self, tmp_path: Path) -> None:
        path = tmp_path / "empty.md"
        path.write_text("")
        result = structure_transcript(path, "conv-1")
        assert result["status"] == "Error"

    def test_returns_error_when_no_turns_found(self, tmp_path: Path) -> None:
        path = tmp_path / "no_turns.md"
        path.write_text("Just some random text without any speaker turns.")
        result = structure_transcript(path, "conv-1")
        assert result["status"] == "Error"
