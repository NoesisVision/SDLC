# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Initialize conversation.json in the working directory."""

import json
import sys
from pathlib import Path

from models_core import Conversation


def init_conversation(working_dir: Path, conversation_id: str, time: str, main_topic: str) -> str:
    """Create conversation.json with metadata and empty analysis fields.

    Args:
        working_dir: Path to the working directory.
        conversation_id: Unique identifier for the conversation.
        time: Conversation time in YYYY-MM-DD HH:MM:SS format.
        main_topic: Short description of the main topic.

    Returns:
        Path to the created file as string.
    """
    conversation = Conversation(
        conversation_id=conversation_id,
        time=time,
        main_topic=main_topic,
        turns=[],
        topics=[],
        decisions=[],
    )
    output_path = working_dir / "conversation.json"
    output_path.write_text(conversation.model_dump_json(indent=2), encoding="utf-8")
    return str(output_path)


def _main() -> None:
    if len(sys.argv) != 5:
        print(json.dumps({"status": "Error", "message": "Expected 4 arguments: <working_dir> <conversation_id> <time> <main_topic>"}))
        sys.exit(1)

    working_dir = Path(sys.argv[1])
    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)

    conversation_id = sys.argv[2]
    time = sys.argv[3]
    main_topic = sys.argv[4]

    output_path = init_conversation(working_dir, conversation_id, time, main_topic)
    print(json.dumps({"status": "Ok", "output_path": output_path}))


if __name__ == "__main__":
    _main()
