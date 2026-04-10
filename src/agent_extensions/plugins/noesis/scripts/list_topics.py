# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""List topics from knowledge graph at a given hierarchy level."""

import json
import sys
from pathlib import Path

from models_core import Topic
from models_knowledge_graph import KnowledgeGraph, TopicOverview


def list_root_topics(knowledge_graph_path: Path) -> list[TopicOverview]:
    """Return root-level topics from the knowledge graph.

    Args:
        knowledge_graph_path: Path to the knowledge graph JSON file.

    Returns:
        List of topic overviews with id, title, short_summary, long_summary, has_subtopics, path.
    """
    graph = _load_graph(knowledge_graph_path)
    return [_topic_overview(topic, []) for topic in graph.topics]


def list_subtopics(knowledge_graph_path: Path, parent_id: str) -> list[TopicOverview]:
    """Return children of a topic identified by parent_id.

    Args:
        knowledge_graph_path: Path to the knowledge graph JSON file.
        parent_id: ID of the parent topic.

    Returns:
        List of topic overviews with id, title, short_summary, long_summary, has_subtopics, path.
    """
    graph = _load_graph(knowledge_graph_path)
    parent = _find_topic_by_id(graph.topics, parent_id)
    if parent is None:
        return []
    parent_path = _build_ancestor_path(graph.topics, parent_id)
    return [_topic_overview(child, parent_path) for child in parent.subtopics]


def _load_graph(knowledge_graph_path: Path) -> KnowledgeGraph:
    return KnowledgeGraph.model_validate_json(knowledge_graph_path.read_bytes())


def _find_topic_by_id(topics: list[Topic], topic_id: str) -> Topic | None:
    for topic in topics:
        if topic.id == topic_id:
            return topic
        found = _find_topic_by_id(topic.subtopics, topic_id)
        if found is not None:
            return found
    return None


def _build_ancestor_path(topics: list[Topic], target_id: str) -> list[str]:
    """Return list of ancestor titles (including the target) from root to target."""
    path: list[str] = []
    _collect_path(topics, target_id, path)
    return path


def _collect_path(topics: list[Topic], target_id: str, path: list[str]) -> bool:
    for topic in topics:
        path.append(topic.title)
        if topic.id == target_id:
            return True
        if _collect_path(topic.subtopics, target_id, path):
            return True
        path.pop()
    return False


def _topic_overview(topic: Topic, ancestor_path: list[str]) -> TopicOverview:
    return TopicOverview(
        id=topic.id,
        title=topic.title,
        short_summary=topic.short_summary,
        long_summary=topic.long_summary,
        has_subtopics=len(topic.subtopics) > 0,
        path=[*ancestor_path, topic.title],
    )


def _main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"status": "Error", "message": "Expected: <knowledge_graph_path> [--parent-id <id>]"}))
        sys.exit(1)

    knowledge_graph_path = Path(sys.argv[1])
    if not knowledge_graph_path.exists():
        print(json.dumps({"status": "Error", "message": f"File not found: {knowledge_graph_path}"}))
        sys.exit(1)

    parent_id = _parse_parent_id(sys.argv[2:])

    if parent_id is None:
        topics = list_root_topics(knowledge_graph_path)
    else:
        topics = list_subtopics(knowledge_graph_path, parent_id)

    print(json.dumps({"status": "Ok", "topics": [t.model_dump() for t in topics]}))


def _parse_parent_id(args: list[str]) -> str | None:
    if "--parent-id" in args:
        idx = args.index("--parent-id")
        if idx + 1 < len(args):
            return args[idx + 1]
    return None


if __name__ == "__main__":
    _main()
