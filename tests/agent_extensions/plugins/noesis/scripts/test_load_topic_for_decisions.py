"""Tests for load_topic_for_decisions.py — loading next topic for decision extraction."""

from pathlib import Path

from load_topic_for_decisions import load_topic_for_decisions
from models_core import (
    Conversation,
    IdeaUnit,
    IdeaUnitCategory,
    IdeaUnitRef,
    Topic,
    Turn,
)
from sample_data import SAMPLE_CONVERSATION_ID


def _sample_turns() -> list[Turn]:
    return [
        Turn(
            index=0,
            speaker="Alice",
            time="00:00:05",
            idea_units=[
                IdeaUnit(index=0, sentences=["We need authentication."], categories=[IdeaUnitCategory.Information]),
                IdeaUnit(index=1, sentences=["Let us use JWT."], categories=[IdeaUnitCategory.Position]),
                IdeaUnit(index=2, sentences=["Hello everyone."], categories=[IdeaUnitCategory.Irrelevant]),
            ],
        ),
        Turn(
            index=1,
            speaker="Bob",
            time="00:00:32",
            idea_units=[
                IdeaUnit(index=0, sentences=["Agreed, JWT it is."], categories=[IdeaUnitCategory.Decision]),
            ],
        ),
    ]


def _topic_with_refs(
    topic_id: str = "topic-auth",
    decisions_extracted: bool = False,
) -> Topic:
    return Topic(
        id=topic_id,
        title="Authentication",
        summary="Authentication discussion",
        idea_units=[
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=0),
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=1),
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=2),
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=1, idea_unit_index=0),
        ],
        subtopics=[],
        reviewed=True,
        decisions_extracted=decisions_extracted,
    )


def _make_conversation(topics: list[Topic]) -> Conversation:
    return Conversation(
        conversation_id=SAMPLE_CONVERSATION_ID,
        time="2026-04-10 14:00:00",
        main_topic="Authentication module redesign",
        turns=_sample_turns(),
        topics=topics,
        decisions=[],
    )


def _write_conversation(working_dir: Path, conversation: Conversation) -> None:
    path = working_dir / "conversation.json"
    path.write_text(conversation.model_dump_json(indent=2), encoding="utf-8")


class TestFindNextTopic:
    def test_returns_first_unextracted_topic(self, working_dir: Path) -> None:
        conversation = _make_conversation([_topic_with_refs()])
        _write_conversation(working_dir, conversation)

        result = load_topic_for_decisions(working_dir)

        assert result is not None
        assert result.id == "topic-auth"

    def test_skips_already_extracted_topics(self, working_dir: Path) -> None:
        extracted = _topic_with_refs("topic-auth", decisions_extracted=True)
        unextracted = Topic(
            id="topic-api",
            title="API Design",
            summary="API patterns",
            idea_units=[
                IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=0),
            ],
            subtopics=[],
            reviewed=True,
            decisions_extracted=False,
        )
        conversation = _make_conversation([extracted, unextracted])
        _write_conversation(working_dir, conversation)

        result = load_topic_for_decisions(working_dir)

        assert result is not None
        assert result.id == "topic-api"

    def test_returns_none_when_all_extracted(self, working_dir: Path) -> None:
        topic = _topic_with_refs(decisions_extracted=True)
        conversation = _make_conversation([topic])
        _write_conversation(working_dir, conversation)

        result = load_topic_for_decisions(working_dir)

        assert result is None


class TestFilterIrrelevant:
    def test_excludes_irrelevant_idea_units(self, working_dir: Path) -> None:
        conversation = _make_conversation([_topic_with_refs()])
        _write_conversation(working_dir, conversation)

        result = load_topic_for_decisions(working_dir)

        assert result is not None
        assert len(result.idea_units) == 3
        for detail in result.idea_units:
            assert IdeaUnitCategory.Irrelevant not in detail.categories

    def test_preserves_non_irrelevant_categories(self, working_dir: Path) -> None:
        conversation = _make_conversation([_topic_with_refs()])
        _write_conversation(working_dir, conversation)

        result = load_topic_for_decisions(working_dir)

        assert result is not None
        categories = [detail.categories for detail in result.idea_units]
        assert [IdeaUnitCategory.Information] in categories
        assert [IdeaUnitCategory.Position] in categories
        assert [IdeaUnitCategory.Decision] in categories


class TestEnrichment:
    def test_enriches_with_speaker_and_time(self, working_dir: Path) -> None:
        conversation = _make_conversation([_topic_with_refs()])
        _write_conversation(working_dir, conversation)

        result = load_topic_for_decisions(working_dir)

        assert result is not None
        first = result.idea_units[0]
        assert first.speaker == "Alice"
        assert first.time == "00:00:05"
        assert first.sentences == ["We need authentication."]

    def test_includes_topic_metadata(self, working_dir: Path) -> None:
        conversation = _make_conversation([_topic_with_refs()])
        _write_conversation(working_dir, conversation)

        result = load_topic_for_decisions(working_dir)

        assert result is not None
        assert result.title == "Authentication"
        assert result.summary == "Authentication discussion"
