# /// script
# dependencies = [
#     "pydantic",
# ]
# ///

"""Check conversation_id presence in transcript and knowledge graph."""

import json
import sys
import uuid
from pathlib import Path

from models_transcript import CONVERSATION_ID_PATTERN


def extract_conversation_id(transcript_path: Path) -> str | None:
    with open(transcript_path) as f:
        first_line = f.readline()
    match = CONVERSATION_ID_PATTERN.match(first_line)
    return match.group(1) if match else None


def is_id_in_knowledge_graph(conversation_id: str, knowledge_graph_path: Path) -> bool:
    if not knowledge_graph_path.exists():
        return False
    text = knowledge_graph_path.read_text()
    return f'"conversation_id": "{conversation_id}"' in text


def prepend_conversation_id(conversation_id: str, transcript_path: Path) -> None:
    content = transcript_path.read_text()
    transcript_path.write_text(f"<!-- conversation_id: {conversation_id} -->\n{content}")


def main() -> None:
    if len(sys.argv) != 3:
        print(json.dumps({"status": "Error", "message": "Expected 2 arguments: <transcript_path> <knowledge_graph_path>"}))
        sys.exit(1)

    transcript_path = Path(sys.argv[1])
    knowledge_graph_path = Path(sys.argv[2])

    conversation_id = extract_conversation_id(transcript_path)

    if conversation_id is None:
        conversation_id = str(uuid.uuid4())
        prepend_conversation_id(conversation_id, transcript_path)
        result = {"status": "IdGenerated", "conversation_id": conversation_id}
    elif is_id_in_knowledge_graph(conversation_id, knowledge_graph_path):
        result = {"status": "ConversationAlreadyAdded", "conversation_id": conversation_id}
    else:
        result = {"status": "Ok", "conversation_id": conversation_id}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
