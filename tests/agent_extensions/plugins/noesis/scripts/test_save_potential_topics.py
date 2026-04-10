"""Tests for save_potential_topics.py — saving find-topics results."""

from pathlib import Path

from models_core import PotentialTopic, PotentialTopics
from save_potential_topics import save_potential_topics


class TestSavePotentialTopics:
    def test_creates_possible_topics_file(self, working_dir: Path) -> None:
        save_potential_topics(working_dir, [])
        assert (working_dir / "possible_topics.json").exists()

    def test_saves_empty_list(self, working_dir: Path) -> None:
        save_potential_topics(working_dir, [])
        result = PotentialTopics.model_validate_json((working_dir / "possible_topics.json").read_bytes())
        assert result.topics == []

    def test_saves_existing_topics(self, working_dir: Path) -> None:
        topics = [
            PotentialTopic(id="t-1", title="Auth", summary="Authentication", path=["Auth"]),
            PotentialTopic(id="t-2", title="API", summary="API design", path=["API"]),
        ]
        save_potential_topics(working_dir, topics)
        result = PotentialTopics.model_validate_json((working_dir / "possible_topics.json").read_bytes())
        assert len(result.topics) == 2
        assert result.topics[0].title == "Auth"
        assert result.topics[1].title == "API"

    def test_preserves_new_topic_flags(self, working_dir: Path) -> None:
        topics = [
            PotentialTopic(
                id="t-new", title="Security", summary="Security concerns",
                path=["Auth", "Security"], is_new=True, parent_id="t-1",
            ),
        ]
        save_potential_topics(working_dir, topics)
        result = PotentialTopics.model_validate_json((working_dir / "possible_topics.json").read_bytes())
        saved = result.topics[0]
        assert saved.is_new is True
        assert saved.parent_id == "t-1"

    def test_overwrites_previous_file(self, working_dir: Path) -> None:
        save_potential_topics(working_dir, [
            PotentialTopic(id="old", title="Old", summary="Old topic", path=["Old"]),
        ])
        save_potential_topics(working_dir, [
            PotentialTopic(id="new", title="New", summary="New topic", path=["New"]),
        ])
        result = PotentialTopics.model_validate_json((working_dir / "possible_topics.json").read_bytes())
        assert len(result.topics) == 1
        assert result.topics[0].id == "new"
