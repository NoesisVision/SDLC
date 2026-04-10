# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Load the next topic without extracted decisions, with non-Irrelevant idea units."""

import json
import sys
from pathlib import Path

from models_core import (
    Conversation,
    EnrichedTopic,
    IdeaUnitCategory,
    IdeaUnitDetail,
    Topic,
    Turn,
)


def load_topic_for_decisions(
    working_dir: Path,
    topic_id: str | None = None,
) -> EnrichedTopic | None:
    """Find a topic without extracted decisions and enrich its idea units.

    Args:
        working_dir: Path to the working directory.
        topic_id: Specific topic ID to load. If None, loads the first unprocessed topic.

    Returns:
        Topic with enriched non-Irrelevant idea units, or None if all done.
    """
    conversation = _load_conversation(working_dir)
    if topic_id is not None:
        topic = _find_topic_by_id(conversation, topic_id)
    else:
        topic = _find_next_topic(conversation)
    if topic is None:
        return None

    turn_map = _build_turn_map(conversation)
    return _enrich_topic(topic, turn_map, conversation.conversation_id)


def _load_conversation(working_dir: Path) -> Conversation:
    path = working_dir / "conversation.json"
    return Conversation.model_validate_json(path.read_bytes())


def _find_topic_by_id(conversation: Conversation, topic_id: str) -> Topic | None:
    for topic in conversation.topics:
        if topic.id == topic_id:
            return topic
    return None


def _find_next_topic(conversation: Conversation) -> Topic | None:
    for topic in conversation.topics:
        if not topic.decisions_extracted:
            return topic
    return None


def _build_turn_map(conversation: Conversation) -> dict[int, Turn]:
    return {turn.index: turn for turn in conversation.turns}


def _enrich_topic(
    topic: Topic,
    turn_map: dict[int, Turn],
    conversation_id: str,
) -> EnrichedTopic:
    details = []
    for ref in topic.idea_units:
        if ref.conversation_id != conversation_id:
            continue
        turn = turn_map.get(ref.turn_index)
        if turn is None:
            continue
        idea_unit = _find_idea_unit(turn, ref.idea_unit_index)
        if idea_unit is None:
            continue
        if idea_unit.categories == [IdeaUnitCategory.Irrelevant]:
            continue
        details.append(IdeaUnitDetail(
            turn_index=ref.turn_index,
            idea_unit_index=ref.idea_unit_index,
            speaker=turn.speaker,
            time=turn.time,
            sentences=idea_unit.sentences,
            categories=idea_unit.categories,
        ))
    return EnrichedTopic(
        id=topic.id,
        title=topic.title,
        short_summary=topic.short_summary,
        long_summary=topic.long_summary,
        idea_units=details,
    )


def _find_idea_unit(turn: Turn, idea_unit_index: int):
    for iu in turn.idea_units:
        if iu.index == idea_unit_index:
            return iu
    return None


def _parse_args() -> tuple[Path, str | None]:
    args = sys.argv[1:]
    topic_id = None
    positional = []

    i = 0
    while i < len(args):
        if args[i] == "--topic-id" and i + 1 < len(args):
            topic_id = args[i + 1]
            i += 2
        else:
            positional.append(args[i])
            i += 1

    if len(positional) != 1:
        print(json.dumps({
            "status": "Error",
            "message": "Expected 1 argument: <working_dir> [--topic-id <id>]",
        }))
        sys.exit(1)

    return Path(positional[0]), topic_id


def _main() -> None:
    working_dir, topic_id = _parse_args()

    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)

    topic = load_topic_for_decisions(working_dir, topic_id=topic_id)

    if topic is None:
        print(json.dumps({"status": "Ok", "has_topic": False}))
        return

    print(json.dumps({
        "status": "Ok",
        "has_topic": True,
        "topic": topic.model_dump(),
    }))


if __name__ == "__main__":
    _main()
