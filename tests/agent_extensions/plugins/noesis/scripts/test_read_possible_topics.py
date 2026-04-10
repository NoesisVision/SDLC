"""Tests for read_possible_topics.py — reading saved potential topics."""

from pathlib import Path

from models_core import PotentialTopic, PotentialTopics
from read_possible_topics import read_possible_topics
from save_potential_topics import save_potential_topics


class TestReadPossibleTopics:
    def test_reads_saved_topics(self, working_dir: Path) -> None:
        save_potential_topics(working_dir, [
            PotentialTopic(id="t-1", title="Auth", summary="Authentication", path=["Auth"]),
        ])
        result = read_possible_topics(working_dir)
        assert len(result.topics) == 1
        assert result.topics[0].title == "Auth"

    def test_reads_empty_topic_list(self, working_dir: Path) -> None:
        save_potential_topics(working_dir, [])
        result = read_possible_topics(working_dir)
        assert result.topics == []

    def test_preserves_new_topic_metadata(self, working_dir: Path) -> None:
        save_potential_topics(working_dir, [
            PotentialTopic(
                id="t-new", title="Security", summary="Security",
                path=["Auth", "Security"], is_new=True, parent_id="t-1",
            ),
        ])
        result = read_possible_topics(working_dir)
        topic = result.topics[0]
        assert topic.is_new is True
        assert topic.parent_id == "t-1"
        assert topic.path == ["Auth", "Security"]

    def test_returns_valid_pydantic_model(self, possible_topics_json: Path) -> None:
        working_dir = possible_topics_json.parent
        result = read_possible_topics(working_dir)
        assert isinstance(result, PotentialTopics)
        assert all(isinstance(t, PotentialTopic) for t in result.topics)
