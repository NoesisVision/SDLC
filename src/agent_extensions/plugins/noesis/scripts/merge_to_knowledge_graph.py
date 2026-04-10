# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Merge conversation.json into knowledge_graph.json."""

import json
import sys
from pathlib import Path

from models_core import Conversation, IdeaUnitRef, PotentialTopics, Topic
from models_knowledge_graph import ConversationSummary, KnowledgeGraph


def merge_to_knowledge_graph(
    working_dir: Path,
    knowledge_graph_path: Path,
) -> None:
    """Merge conversation results into the knowledge graph.

    Args:
        working_dir: Path to the working directory containing conversation.json
            and possible_topics.json.
        knowledge_graph_path: Path to the knowledge graph JSON file.
    """
    conversation = _load_conversation(working_dir)
    kg = _load_knowledge_graph(knowledge_graph_path)
    parent_map = _load_parent_map(working_dir)

    _merge_conversation_summary(kg, conversation)
    _merge_topics(kg, conversation, parent_map)
    _merge_decisions(kg, conversation)

    _write_knowledge_graph(knowledge_graph_path, kg)


def _load_conversation(working_dir: Path) -> Conversation:
    path = working_dir / "conversation.json"
    return Conversation.model_validate_json(path.read_bytes())


def _load_knowledge_graph(path: Path) -> KnowledgeGraph:
    if not path.exists():
        return KnowledgeGraph(conversations=[], topics=[], decisions=[])
    return KnowledgeGraph.model_validate_json(path.read_bytes())


def _load_parent_map(working_dir: Path) -> dict[str, str | None]:
    path = working_dir / "possible_topics.json"
    if not path.exists():
        return {}
    topics = PotentialTopics.model_validate_json(path.read_bytes())
    return {t.id: t.parent_id for t in topics.topics}


def _merge_conversation_summary(
    kg: KnowledgeGraph,
    conversation: Conversation,
) -> None:
    summary = ConversationSummary(
        conversation_id=conversation.conversation_id,
        time=conversation.time,
        main_topic=conversation.main_topic,
        turns=conversation.turns,
    )
    for i, existing in enumerate(kg.conversations):
        if existing.conversation_id == conversation.conversation_id:
            kg.conversations[i] = summary
            return
    kg.conversations.append(summary)


def _merge_topics(
    kg: KnowledgeGraph,
    conversation: Conversation,
    parent_map: dict[str, str | None],
) -> None:
    for conv_topic in conversation.topics:
        _merge_single_topic(kg, conv_topic, parent_map)


def _merge_single_topic(
    kg: KnowledgeGraph,
    conv_topic: Topic,
    parent_map: dict[str, str | None],
) -> None:
    target_parent_id = parent_map.get(conv_topic.id)
    existing = _find_topic_in_hierarchy(kg.topics, conv_topic.id)

    if existing is not None:
        current_parent_id = _find_parent_id(kg.topics, conv_topic.id)
        _update_existing_topic(existing, conv_topic)
        if current_parent_id != target_parent_id:
            _reparent_topic(kg, existing, current_parent_id, target_parent_id)
    else:
        new_topic = _build_kg_topic(conv_topic)
        _insert_topic(kg, new_topic, target_parent_id)


def _update_existing_topic(existing: Topic, conv_topic: Topic) -> None:
    existing.title = conv_topic.title
    existing.short_summary = conv_topic.short_summary
    existing.long_summary = conv_topic.long_summary

    existing_keys = {
        (ref.conversation_id, ref.turn_index, ref.idea_unit_index)
        for ref in existing.idea_units
    }
    for ref in conv_topic.idea_units:
        key = (ref.conversation_id, ref.turn_index, ref.idea_unit_index)
        if key not in existing_keys:
            existing.idea_units.append(ref)


def _build_kg_topic(conv_topic: Topic) -> Topic:
    return Topic(
        id=conv_topic.id,
        title=conv_topic.title,
        short_summary=conv_topic.short_summary,
        long_summary=conv_topic.long_summary,
        idea_units=list(conv_topic.idea_units),
        subtopics=[],
    )


def _insert_topic(
    kg: KnowledgeGraph,
    topic: Topic,
    parent_id: str | None,
) -> None:
    if parent_id is None:
        kg.topics.append(topic)
        return

    parent = _find_topic_in_hierarchy(kg.topics, parent_id)
    if parent is not None:
        parent.subtopics.append(topic)
    else:
        kg.topics.append(topic)


def _reparent_topic(
    kg: KnowledgeGraph,
    topic: Topic,
    old_parent_id: str | None,
    new_parent_id: str | None,
) -> None:
    _remove_topic_from_parent(kg, topic.id, old_parent_id)
    _insert_topic(kg, topic, new_parent_id)


def _remove_topic_from_parent(
    kg: KnowledgeGraph,
    topic_id: str,
    parent_id: str | None,
) -> None:
    if parent_id is None:
        kg.topics = [t for t in kg.topics if t.id != topic_id]
    else:
        parent = _find_topic_in_hierarchy(kg.topics, parent_id)
        if parent is not None:
            parent.subtopics = [t for t in parent.subtopics if t.id != topic_id]


def _find_topic_in_hierarchy(
    topics: list[Topic],
    topic_id: str,
) -> Topic | None:
    for topic in topics:
        if topic.id == topic_id:
            return topic
        found = _find_topic_in_hierarchy(topic.subtopics, topic_id)
        if found is not None:
            return found
    return None


_NOT_FOUND = object()


def _find_parent_id(
    topics: list[Topic],
    topic_id: str,
) -> str | None:
    """Find the parent id of a topic in the hierarchy.

    Args:
        topics: Root-level topics to search.
        topic_id: The topic to find.

    Returns:
        Parent topic id, or None if the topic is at root level.
    """
    result = _find_parent_id_recursive(topics, topic_id, None)
    if result is _NOT_FOUND:
        return None
    return result


def _find_parent_id_recursive(
    topics: list[Topic],
    topic_id: str,
    parent_id: str | None,
) -> str | None | object:
    for topic in topics:
        if topic.id == topic_id:
            return parent_id
        result = _find_parent_id_recursive(topic.subtopics, topic_id, topic.id)
        if result is not _NOT_FOUND:
            return result
    return _NOT_FOUND


def _merge_decisions(kg: KnowledgeGraph, conversation: Conversation) -> None:
    kg.decisions.extend(conversation.decisions)


def _write_knowledge_graph(path: Path, kg: KnowledgeGraph) -> None:
    path.write_text(kg.model_dump_json(indent=2), encoding="utf-8")


def _main() -> None:
    if len(sys.argv) != 3:
        print(json.dumps({
            "status": "Error",
            "message": "Expected 2 arguments: <working_dir> <knowledge_graph_path>",
        }))
        sys.exit(1)

    working_dir = Path(sys.argv[1])
    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)

    knowledge_graph_path = Path(sys.argv[2])

    merge_to_knowledge_graph(working_dir, knowledge_graph_path)
    print(json.dumps({"status": "Ok"}))


if __name__ == "__main__":
    _main()
