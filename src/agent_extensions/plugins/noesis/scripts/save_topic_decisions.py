# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Save extracted decisions to conversation.json and mark topic as processed."""

import json
import sys
from pathlib import Path

from models_core import Conversation, Topic
from models_extraction import DecisionExtractionResult


def save_topic_decisions(working_dir: Path, result: DecisionExtractionResult) -> None:
    """Append decisions to conversation.json and mark the topic as decisions_extracted.

    Args:
        working_dir: Path to the working directory.
        result: Extracted decisions and the source topic id.
    """
    conversation = _load_conversation(working_dir)
    topic = _find_topic(conversation, result.topic_id)

    _append_decisions(conversation, result)
    _mark_decisions_extracted(topic)

    _write_conversation(working_dir, conversation)


def _load_conversation(working_dir: Path) -> Conversation:
    path = working_dir / "conversation.json"
    return Conversation.model_validate_json(path.read_bytes())


def _find_topic(conversation: Conversation, topic_id: str) -> Topic:
    for topic in conversation.topics:
        if topic.id == topic_id:
            return topic
    raise ValueError(f"Topic not found: {topic_id}")


def _append_decisions(
    conversation: Conversation,
    result: DecisionExtractionResult,
) -> None:
    conversation.decisions.extend(result.decisions)


def _mark_decisions_extracted(topic: Topic) -> None:
    topic.decisions_extracted = True


def _write_conversation(working_dir: Path, conversation: Conversation) -> None:
    path = working_dir / "conversation.json"
    path.write_text(conversation.model_dump_json(indent=2), encoding="utf-8")


def _main() -> None:
    if len(sys.argv) != 3:
        print(json.dumps({
            "status": "Error",
            "message": "Usage: save_topic_decisions.py <working_dir> <input_file>",
        }))
        sys.exit(1)

    working_dir = Path(sys.argv[1])
    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)

    raw_input = Path(sys.argv[2]).read_text(encoding="utf-8")
    result = DecisionExtractionResult.model_validate_json(raw_input)

    save_topic_decisions(working_dir, result)
    print(json.dumps({
        "status": "Ok",
        "topic_id": result.topic_id,
        "decisions_saved": len(result.decisions),
    }))


if __name__ == "__main__":
    _main()
