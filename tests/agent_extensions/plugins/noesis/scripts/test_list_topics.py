"""Tests for list_topics.py — knowledge graph topic navigation."""

from pathlib import Path

from list_topics import list_root_topics, list_subtopics


class TestListRootTopics:
    def test_returns_all_root_topics(self, knowledge_graph_path: Path) -> None:
        topics = list_root_topics(knowledge_graph_path)
        titles = {t.title for t in topics}
        assert titles == {"Authentication", "API Design"}

    def test_includes_id_title_summary(self, knowledge_graph_path: Path) -> None:
        topics = list_root_topics(knowledge_graph_path)
        auth = next(t for t in topics if t.title == "Authentication")
        assert auth.id == "topic-auth"
        assert auth.summary == "Authentication and identity management"

    def test_marks_topics_with_children(self, knowledge_graph_path: Path) -> None:
        topics = list_root_topics(knowledge_graph_path)
        auth = next(t for t in topics if t.title == "Authentication")
        api = next(t for t in topics if t.title == "API Design")
        assert auth.has_subtopics is True
        assert api.has_subtopics is False

    def test_root_topic_path_contains_only_itself(self, knowledge_graph_path: Path) -> None:
        topics = list_root_topics(knowledge_graph_path)
        auth = next(t for t in topics if t.title == "Authentication")
        assert auth.path == ["Authentication"]

    def test_returns_empty_list_for_graph_with_no_topics(self, empty_knowledge_graph_path: Path) -> None:
        topics = list_root_topics(empty_knowledge_graph_path)
        assert topics == []


class TestListSubtopics:
    def test_returns_children_of_parent(self, knowledge_graph_path: Path) -> None:
        children = list_subtopics(knowledge_graph_path, "topic-auth")
        assert len(children) == 1
        assert children[0].title == "JWT Implementation"

    def test_child_path_includes_ancestors(self, knowledge_graph_path: Path) -> None:
        children = list_subtopics(knowledge_graph_path, "topic-auth")
        assert children[0].path == ["Authentication", "JWT Implementation"]

    def test_returns_empty_for_leaf_topic(self, knowledge_graph_path: Path) -> None:
        children = list_subtopics(knowledge_graph_path, "topic-api")
        assert children == []

    def test_returns_empty_for_unknown_parent(self, knowledge_graph_path: Path) -> None:
        children = list_subtopics(knowledge_graph_path, "nonexistent-id")
        assert children == []
