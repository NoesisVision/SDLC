"""Tests for load_topic_for_review.py — loading next unreviewed topic with enriched details."""

from pathlib import Path

from models_core import (
    Conversation,
    IdeaUnit,
    IdeaUnitCategory,
    IdeaUnitRef,
    PotentialTopic,
    PotentialTopics,
    Topic,
    Turn,
)
from load_topic_for_review import load_topic_for_review
from sample_data import SAMPLE_CONVERSATION_ID


def _make_conversation(topics: list[Topic], turns: list[Turn]) -> Conversation:
    return Conversation(
        conversation_id=SAMPLE_CONVERSATION_ID,
        time="2026-04-10 14:00:00",
        main_topic="Authentication module redesign",
        turns=turns,
        topics=topics,
        decisions=[],
    )


def _sample_turns() -> list[Turn]:
    return [
        Turn(
            index=0,
            speaker="Alice",
            time="00:00:05",
            idea_units=[
                IdeaUnit(index=0, sentences=["We need authentication."], categories=[IdeaUnitCategory.Information]),
                IdeaUnit(index=1, sentences=["Let us use JWT."], categories=[IdeaUnitCategory.Position]),
            ],
        ),
        Turn(
            index=1,
            speaker="Bob",
            time="00:00:32",
            idea_units=[
                IdeaUnit(index=0, sentences=["JWT scales better."], categories=[IdeaUnitCategory.Argument]),
            ],
        ),
    ]


def _sample_topic(reviewed: bool = False) -> Topic:
    return Topic(
        id="topic-auth",
        title="Authentication",
        summary="Authentication discussion",
        idea_units=[
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=0),
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=1, idea_unit_index=0),
        ],
        subtopics=[],
        reviewed=reviewed,
    )


def _write_conversation(working_dir: Path, conversation: Conversation) -> None:
    path = working_dir / "conversation.json"
    path.write_text(conversation.model_dump_json(indent=2), encoding="utf-8")


def _write_possible_topics(working_dir: Path) -> None:
    topics = PotentialTopics(topics=[
        PotentialTopic(id="topic-auth", title="Authentication", summary="Auth stuff", path=["Authentication"]),
        PotentialTopic(id="topic-api", title="API Design", summary="API patterns", path=["API Design"]),
    ])
    path = working_dir / "possible_topics.json"
    path.write_text(topics.model_dump_json(indent=2), encoding="utf-8")


class TestFindNextUnreviewed:
    def test_returns_first_unreviewed_topic(self, working_dir: Path) -> None:
        turns = _sample_turns()
        topic = _sample_topic(reviewed=False)
        conversation = _make_conversation([topic], turns)
        _write_conversation(working_dir, conversation)
        _write_possible_topics(working_dir)

        result, _ = load_topic_for_review(working_dir)

        assert result is not None
        assert result.id == "topic-auth"

    def test_skips_reviewed_topics(self, working_dir: Path) -> None:
        turns = _sample_turns()
        reviewed_topic = _sample_topic(reviewed=True)
        unreviewed_topic = Topic(
            id="topic-jwt",
            title="JWT",
            summary="JWT discussion",
            idea_units=[
                IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=1),
            ],
            subtopics=[],
            reviewed=False,
        )
        conversation = _make_conversation([reviewed_topic, unreviewed_topic], turns)
        _write_conversation(working_dir, conversation)
        _write_possible_topics(working_dir)

        result, _ = load_topic_for_review(working_dir)

        assert result is not None
        assert result.id == "topic-jwt"

    def test_returns_none_when_all_reviewed(self, working_dir: Path) -> None:
        turns = _sample_turns()
        topic = _sample_topic(reviewed=True)
        conversation = _make_conversation([topic], turns)
        _write_conversation(working_dir, conversation)
        _write_possible_topics(working_dir)

        result, _ = load_topic_for_review(working_dir)

        assert result is None


class TestEnrichIdeaUnits:
    def test_enriches_idea_units_with_turn_details(self, working_dir: Path) -> None:
        turns = _sample_turns()
        topic = _sample_topic(reviewed=False)
        conversation = _make_conversation([topic], turns)
        _write_conversation(working_dir, conversation)
        _write_possible_topics(working_dir)

        result, _ = load_topic_for_review(working_dir)

        assert result is not None
        assert len(result.idea_units) == 2

        first = result.idea_units[0]
        assert first.turn_index == 0
        assert first.idea_unit_index == 0
        assert first.speaker == "Alice"
        assert first.time == "00:00:05"
        assert first.sentences == ["We need authentication."]
        assert first.categories == [IdeaUnitCategory.Information]

        second = result.idea_units[1]
        assert second.speaker == "Bob"
        assert second.turn_index == 1


class TestPotentialTopics:
    def test_returns_potential_topics(self, working_dir: Path) -> None:
        turns = _sample_turns()
        topic = _sample_topic(reviewed=False)
        conversation = _make_conversation([topic], turns)
        _write_conversation(working_dir, conversation)
        _write_possible_topics(working_dir)

        _, potential_topics = load_topic_for_review(working_dir)

        assert len(potential_topics) == 2
        ids = {t["id"] for t in potential_topics}
        assert "topic-auth" in ids
        assert "topic-api" in ids

    def test_returns_empty_when_no_possible_topics_file(self, working_dir: Path) -> None:
        turns = _sample_turns()
        topic = _sample_topic(reviewed=False)
        conversation = _make_conversation([topic], turns)
        _write_conversation(working_dir, conversation)

        _, potential_topics = load_topic_for_review(working_dir)

        assert potential_topics == []
