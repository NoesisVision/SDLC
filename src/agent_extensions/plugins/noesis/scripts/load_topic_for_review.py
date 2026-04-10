# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Load the next unreviewed topic with enriched idea units from conversation and knowledge graph."""

import json
import sys
from pathlib import Path

from models_core import (
    Conversation,
    EnrichedTopic,
    IdeaUnit,
    IdeaUnitDetail,
    IdeaUnitRef,
    PotentialTopics,
    Topic,
    Turn,
)
from models_knowledge_graph import ConversationSummary, KnowledgeGraph


def load_topic_for_review(
    working_dir: Path,
    knowledge_graph_path: Path,
) -> tuple[EnrichedTopic | None, list[dict]]:
    """Find the first unreviewed topic and enrich its idea units with full text.

    Loads idea units from both the current conversation and the knowledge graph
    to provide all available context for summary generation.

    Args:
        working_dir: Path to the working directory.
        knowledge_graph_path: Path to the knowledge graph JSON file.

    Returns:
        Tuple of (topic for review or None, list of potential topics as dicts).
    """
    conversation = _load_conversation(working_dir)
    potential_topics = _load_potential_topics(working_dir)

    topic = _find_next_unreviewed(conversation)
    if topic is None:
        return None, potential_topics

    kg = _load_knowledge_graph(knowledge_graph_path)
    kg_topic = _find_topic_in_hierarchy(kg.topics, topic.id)

    turn_map = _build_turn_map(conversation)
    kg_turn_maps = _build_kg_turn_maps(kg, conversation.conversation_id)

    all_refs = _collect_all_refs(topic, kg_topic, conversation.conversation_id)
    enriched = _enrich_topic(topic, all_refs, turn_map, kg_turn_maps)
    return enriched, potential_topics


def _load_conversation(working_dir: Path) -> Conversation:
    path = working_dir / "conversation.json"
    return Conversation.model_validate_json(path.read_bytes())


def _load_knowledge_graph(path: Path) -> KnowledgeGraph:
    if not path.exists():
        return KnowledgeGraph(conversations=[], topics=[], decisions=[])
    return KnowledgeGraph.model_validate_json(path.read_bytes())


def _load_potential_topics(working_dir: Path) -> list[dict]:
    path = working_dir / "possible_topics.json"
    if not path.exists():
        return []
    topics = PotentialTopics.model_validate_json(path.read_bytes())
    return [t.model_dump() for t in topics.topics]


def _find_next_unreviewed(conversation: Conversation) -> Topic | None:
    for topic in conversation.topics:
        if not topic.reviewed:
            return topic
    return None


def _find_topic_in_hierarchy(topics: list[Topic], topic_id: str) -> Topic | None:
    for topic in topics:
        if topic.id == topic_id:
            return topic
        found = _find_topic_in_hierarchy(topic.subtopics, topic_id)
        if found is not None:
            return found
    return None


def _build_turn_map(conversation: Conversation) -> dict[int, Turn]:
    return {turn.index: turn for turn in conversation.turns}


def _build_kg_turn_maps(
    kg: KnowledgeGraph,
    current_conversation_id: str,
) -> dict[str, dict[int, Turn]]:
    """Build turn maps for all KG conversations except the current one.

    Args:
        kg: The knowledge graph.
        current_conversation_id: ID of the conversation being analyzed (skip it).

    Returns:
        Dict mapping conversation_id to turn index map.
    """
    result: dict[str, dict[int, Turn]] = {}
    for conv_summary in kg.conversations:
        if conv_summary.conversation_id == current_conversation_id:
            continue
        result[conv_summary.conversation_id] = {
            turn.index: turn for turn in conv_summary.turns
        }
    return result


def _collect_all_refs(
    conv_topic: Topic,
    kg_topic: Topic | None,
    current_conversation_id: str,
) -> list[IdeaUnitRef]:
    """Collect idea unit refs from current conversation topic and KG topic.

    Deduplicates by (conversation_id, turn_index, idea_unit_index).

    Args:
        conv_topic: Topic from current conversation.
        kg_topic: Same topic from knowledge graph (may have refs from other conversations).
        current_conversation_id: ID of the current conversation.

    Returns:
        Combined list of unique idea unit refs.
    """
    seen: set[tuple[str, int, int]] = set()
    all_refs: list[IdeaUnitRef] = []

    for ref in conv_topic.idea_units:
        key = (ref.conversation_id, ref.turn_index, ref.idea_unit_index)
        if key not in seen:
            seen.add(key)
            all_refs.append(ref)

    if kg_topic is not None:
        for ref in kg_topic.idea_units:
            key = (ref.conversation_id, ref.turn_index, ref.idea_unit_index)
            if key not in seen:
                seen.add(key)
                all_refs.append(ref)

    return all_refs


def _enrich_topic(
    topic: Topic,
    all_refs: list[IdeaUnitRef],
    current_turn_map: dict[int, Turn],
    kg_turn_maps: dict[str, dict[int, Turn]],
) -> EnrichedTopic:
    details: list[IdeaUnitDetail] = []
    for ref in all_refs:
        idea_unit = _resolve_ref(ref, current_turn_map, kg_turn_maps)
        if idea_unit is not None:
            details.append(idea_unit)

    return EnrichedTopic(
        id=topic.id,
        title=topic.title,
        short_summary=topic.short_summary,
        long_summary=topic.long_summary,
        idea_units=details,
    )


def _resolve_ref(
    ref: IdeaUnitRef,
    current_turn_map: dict[int, Turn],
    kg_turn_maps: dict[str, dict[int, Turn]],
) -> IdeaUnitDetail | None:
    turn_map = kg_turn_maps.get(ref.conversation_id, current_turn_map)
    turn = turn_map.get(ref.turn_index)
    if turn is None:
        return None
    idea_unit = _find_idea_unit(turn, ref.idea_unit_index)
    if idea_unit is None:
        return None
    return IdeaUnitDetail(
        turn_index=ref.turn_index,
        idea_unit_index=ref.idea_unit_index,
        speaker=turn.speaker,
        time=turn.time,
        sentences=idea_unit.sentences,
        categories=idea_unit.categories,
    )


def _find_idea_unit(turn: Turn, idea_unit_index: int) -> IdeaUnit | None:
    for iu in turn.idea_units:
        if iu.index == idea_unit_index:
            return iu
    return None


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

    topic, potential_topics = load_topic_for_review(working_dir, knowledge_graph_path)

    if topic is None:
        print(json.dumps({"status": "Ok", "has_topic": False}))
        return

    print(json.dumps({
        "status": "Ok",
        "has_topic": True,
        "topic": topic.model_dump(),
        "potential_topics": potential_topics,
    }))


if __name__ == "__main__":
    _main()
