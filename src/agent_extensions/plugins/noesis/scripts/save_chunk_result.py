# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Save topic extraction chunk result to conversation.json and possible_topics.json."""

import json
import sys
from pathlib import Path

from models_core import Conversation, IdeaUnitRef, PotentialTopics, Topic
from models_extraction import ChunkResult


def save_chunk_result(working_dir: Path, chunk_result: ChunkResult) -> None:
    """Atomically save chunk result to conversation.json and possible_topics.json.

    Args:
        working_dir: Path to the working directory.
        chunk_result: Processed turns, topic assignments, and new topics.
    """
    conversation = _load_conversation(working_dir)
    _append_turns(conversation, chunk_result)
    _apply_assignments(conversation, chunk_result)
    _write_conversation(working_dir, conversation)

    if chunk_result.new_topics:
        _append_new_topics(working_dir, chunk_result)


def _load_conversation(working_dir: Path) -> Conversation:
    path = working_dir / "conversation.json"
    return Conversation.model_validate_json(path.read_bytes())


def _append_turns(conversation: Conversation, chunk_result: ChunkResult) -> None:
    conversation.turns.extend(chunk_result.turns)


def _apply_assignments(conversation: Conversation, chunk_result: ChunkResult) -> None:
    topic_map = _build_topic_map(conversation)

    for assignment in chunk_result.assignments:
        topic = topic_map.get(assignment.topic_id)
        if topic is None:
            topic = _create_conversation_topic(assignment.topic_id, chunk_result)
            conversation.topics.append(topic)
            topic_map[topic.id] = topic

        topic.idea_units.append(IdeaUnitRef(
            conversation_id=conversation.conversation_id,
            turn_index=assignment.turn_index,
            idea_unit_index=assignment.idea_unit_index,
        ))


def _build_topic_map(conversation: Conversation) -> dict[str, Topic]:
    return {topic.id: topic for topic in conversation.topics}


def _create_conversation_topic(topic_id: str, chunk_result: ChunkResult) -> Topic:
    for new_topic in chunk_result.new_topics:
        if new_topic.id == topic_id:
            return Topic(
                id=topic_id,
                title=new_topic.title,
                short_summary=new_topic.short_summary,
                long_summary="",
                idea_units=[],
                subtopics=[],
            )
    return Topic(
        id=topic_id,
        title="",
        short_summary="",
        long_summary="",
        idea_units=[],
        subtopics=[],
    )


def _write_conversation(working_dir: Path, conversation: Conversation) -> None:
    path = working_dir / "conversation.json"
    path.write_text(conversation.model_dump_json(indent=2), encoding="utf-8")


def _append_new_topics(working_dir: Path, chunk_result: ChunkResult) -> None:
    path = working_dir / "possible_topics.json"
    potential_topics = PotentialTopics.model_validate_json(path.read_bytes())

    existing_ids = {t.id for t in potential_topics.topics}
    for new_topic in chunk_result.new_topics:
        if new_topic.id not in existing_ids:
            potential_topics.topics.append(new_topic)

    path.write_text(potential_topics.model_dump_json(indent=2), encoding="utf-8")


def _main() -> None:
    if len(sys.argv) != 3:
        print(json.dumps({
            "status": "Error",
            "message": "Usage: save_chunk_result.py <working_dir> <input_file>",
        }))
        sys.exit(1)

    working_dir = Path(sys.argv[1])
    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)

    raw_input = Path(sys.argv[2]).read_text(encoding="utf-8")
    chunk_result = ChunkResult.model_validate_json(raw_input)

    save_chunk_result(working_dir, chunk_result)

    input_path = Path(sys.argv[2])
    if input_path.exists():
        input_path.unlink()

    print(json.dumps({"status": "Ok", "turns_saved": len(chunk_result.turns), "new_topics": len(chunk_result.new_topics)}))


if __name__ == "__main__":
    _main()
