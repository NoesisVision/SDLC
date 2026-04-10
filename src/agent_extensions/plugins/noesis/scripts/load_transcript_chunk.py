# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Load next unprocessed turns from structured transcript."""

import json
import sys
from pathlib import Path

from models_core import Conversation
from models_transcript import RawTranscript, RawTurn

_CHARS_PER_TOKEN = 4


def load_transcript_chunk(
    working_dir: Path,
    structured_transcript_path: Path,
    token_limit: int,
) -> dict:
    """Load next chunk of unprocessed turns from structured transcript.

    Args:
        working_dir: Path to the working directory.
        structured_transcript_path: Path to the structured transcript JSON.
        token_limit: Approximate token budget for the chunk.

    Returns:
        Dict with status, turns (with indices), and has_more flag.
    """
    transcript = _load_transcript(structured_transcript_path)
    start_index = _find_start_index(working_dir)

    remaining_turns = transcript.turns[start_index:]
    if not remaining_turns:
        return {"status": "Ok", "turns": [], "has_more": False}

    selected = _select_turns_within_limit(remaining_turns, start_index, token_limit)
    has_more = start_index + len(selected) < len(transcript.turns)

    turns_with_indices = [
        {"index": start_index + i, **turn.model_dump()}
        for i, turn in enumerate(selected)
    ]

    return {"status": "Ok", "turns": turns_with_indices, "has_more": has_more}


def _load_transcript(path: Path) -> RawTranscript:
    return RawTranscript.model_validate_json(path.read_bytes())


def _find_start_index(working_dir: Path) -> int:
    conversation_path = working_dir / "conversation.json"
    if not conversation_path.exists():
        return 0
    conversation = Conversation.model_validate_json(conversation_path.read_bytes())
    if not conversation.turns:
        return 0
    return conversation.turns[-1].index + 1


def _select_turns_within_limit(
    turns: list[RawTurn],
    start_index: int,
    token_limit: int,
) -> list[RawTurn]:
    char_limit = token_limit * _CHARS_PER_TOKEN
    selected: list[RawTurn] = []
    char_count = 0

    for turn in turns:
        turn_chars = _estimate_turn_chars(turn)
        if selected and char_count + turn_chars > char_limit:
            break
        selected.append(turn)
        char_count += turn_chars

    return selected


def _estimate_turn_chars(turn: RawTurn) -> int:
    return sum(len(s) for s in turn.sentences) + len(turn.speaker) + len(turn.time)


def _main() -> None:
    if len(sys.argv) != 4:
        print(json.dumps({
            "status": "Error",
            "message": "Expected 3 arguments: <working_dir> <structured_transcript_path> <token_limit>",
        }))
        sys.exit(1)

    working_dir = Path(sys.argv[1])
    structured_transcript_path = Path(sys.argv[2])
    token_limit = int(sys.argv[3])

    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)
    if not structured_transcript_path.exists():
        print(json.dumps({"status": "Error", "message": f"File not found: {structured_transcript_path}"}))
        sys.exit(1)

    result = load_transcript_chunk(working_dir, structured_transcript_path, token_limit)
    print(json.dumps(result))


if __name__ == "__main__":
    _main()
