"""Tests for save_topic_review.py — persisting topic review results."""

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
from models_extraction import IdeaUnitReassignment, TopicReviewResult
from sample_data import SAMPLE_CONVERSATION_ID
from save_topic_review import save_topic_review


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


def _make_conversation(topics: list[Topic]) -> Conversation:
    return Conversation(
        conversation_id=SAMPLE_CONVERSATION_ID,
        time="2026-04-10 14:00:00",
        main_topic="Authentication module redesign",
        turns=_sample_turns(),
        topics=topics,
        decisions=[],
    )


def _auth_topic() -> Topic:
    return Topic(
        id="topic-auth",
        title="Authentication",
        summary="Authentication discussion",
        idea_units=[
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=0),
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=1),
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=1, idea_unit_index=0),
        ],
        subtopics=[],
    )


def _setup(working_dir: Path, topics: list[Topic] | None = None) -> None:
    if topics is None:
        topics = [_auth_topic()]
    conversation = _make_conversation(topics)
    (working_dir / "conversation.json").write_text(
        conversation.model_dump_json(indent=2), encoding="utf-8",
    )
    possible = PotentialTopics(topics=[
        PotentialTopic(id="topic-auth", title="Authentication", summary="Auth stuff", path=["Authentication"]),
        PotentialTopic(id="topic-api", title="API Design", summary="API patterns", path=["API Design"]),
    ])
    (working_dir / "possible_topics.json").write_text(
        possible.model_dump_json(indent=2), encoding="utf-8",
    )


def _load_conversation(working_dir: Path) -> Conversation:
    return Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())


class TestMarkReviewed:
    def test_marks_topic_as_reviewed(self, working_dir: Path) -> None:
        _setup(working_dir)
        review = TopicReviewResult(
            topic_id="topic-auth",
            reassignments=[],
            new_topics=[],
        )
        save_topic_review(working_dir, review)

        conv = _load_conversation(working_dir)
        assert conv.topics[0].reviewed is True

    def test_marks_reviewed_even_with_no_changes(self, working_dir: Path) -> None:
        _setup(working_dir)
        review = TopicReviewResult(
            topic_id="topic-auth",
            reassignments=[],
            new_topics=[],
        )
        save_topic_review(working_dir, review)

        conv = _load_conversation(working_dir)
        assert conv.topics[0].reviewed is True
        assert conv.topics[0].summary == "Authentication discussion"


class TestUpdateSummary:
    def test_updates_summary_when_provided(self, working_dir: Path) -> None:
        _setup(working_dir)
        review = TopicReviewResult(
            topic_id="topic-auth",
            updated_summary="Revised authentication and JWT token discussion",
            reassignments=[],
            new_topics=[],
        )
        save_topic_review(working_dir, review)

        conv = _load_conversation(working_dir)
        assert conv.topics[0].summary == "Revised authentication and JWT token discussion"

    def test_preserves_summary_when_null(self, working_dir: Path) -> None:
        _setup(working_dir)
        review = TopicReviewResult(
            topic_id="topic-auth",
            updated_summary=None,
            reassignments=[],
            new_topics=[],
        )
        save_topic_review(working_dir, review)

        conv = _load_conversation(working_dir)
        assert conv.topics[0].summary == "Authentication discussion"


class TestReassignments:
    def test_moves_idea_unit_to_existing_topic(self, working_dir: Path) -> None:
        api_topic = Topic(
            id="topic-api",
            title="API Design",
            summary="API patterns",
            idea_units=[],
            subtopics=[],
        )
        _setup(working_dir, topics=[_auth_topic(), api_topic])
        review = TopicReviewResult(
            topic_id="topic-auth",
            reassignments=[
                IdeaUnitReassignment(turn_index=0, idea_unit_index=1, new_topic_id="topic-api"),
            ],
            new_topics=[],
        )
        save_topic_review(working_dir, review)

        conv = _load_conversation(working_dir)
        auth = next(t for t in conv.topics if t.id == "topic-auth")
        api = next(t for t in conv.topics if t.id == "topic-api")

        assert len(auth.idea_units) == 2
        assert all(ref.idea_unit_index != 1 or ref.turn_index != 0 for ref in auth.idea_units)
        assert len(api.idea_units) == 1
        assert api.idea_units[0].turn_index == 0
        assert api.idea_units[0].idea_unit_index == 1

    def test_creates_new_topic_for_reassignment(self, working_dir: Path) -> None:
        _setup(working_dir)
        new_topic = PotentialTopic(
            id="topic-jwt-new",
            title="JWT Strategy",
            summary="JWT token implementation strategy",
            path=["Authentication", "JWT Strategy"],
            is_new=True,
            parent_id="topic-auth",
        )
        review = TopicReviewResult(
            topic_id="topic-auth",
            reassignments=[
                IdeaUnitReassignment(turn_index=0, idea_unit_index=1, new_topic_id="topic-jwt-new"),
            ],
            new_topics=[new_topic],
        )
        save_topic_review(working_dir, review)

        conv = _load_conversation(working_dir)
        assert len(conv.topics) == 2
        jwt_topic = next(t for t in conv.topics if t.id == "topic-jwt-new")
        assert jwt_topic.title == "JWT Strategy"
        assert len(jwt_topic.idea_units) == 1

    def test_removes_reassigned_unit_from_source(self, working_dir: Path) -> None:
        _setup(working_dir)
        new_topic = PotentialTopic(
            id="topic-new",
            title="New Topic",
            summary="New",
            path=["New Topic"],
            is_new=True,
        )
        review = TopicReviewResult(
            topic_id="topic-auth",
            reassignments=[
                IdeaUnitReassignment(turn_index=0, idea_unit_index=0, new_topic_id="topic-new"),
                IdeaUnitReassignment(turn_index=1, idea_unit_index=0, new_topic_id="topic-new"),
            ],
            new_topics=[new_topic],
        )
        save_topic_review(working_dir, review)

        conv = _load_conversation(working_dir)
        auth = next(t for t in conv.topics if t.id == "topic-auth")
        assert len(auth.idea_units) == 1
        assert auth.idea_units[0].turn_index == 0
        assert auth.idea_units[0].idea_unit_index == 1


class TestNewTopicsInPossibleTopics:
    def test_appends_new_topics_to_possible_topics(self, working_dir: Path) -> None:
        _setup(working_dir)
        new_topic = PotentialTopic(
            id="topic-jwt-new",
            title="JWT Strategy",
            summary="JWT discussion",
            path=["JWT Strategy"],
            is_new=True,
        )
        review = TopicReviewResult(
            topic_id="topic-auth",
            reassignments=[
                IdeaUnitReassignment(turn_index=0, idea_unit_index=1, new_topic_id="topic-jwt-new"),
            ],
            new_topics=[new_topic],
        )
        save_topic_review(working_dir, review)

        pt = PotentialTopics.model_validate_json((working_dir / "possible_topics.json").read_bytes())
        ids = {t.id for t in pt.topics}
        assert "topic-jwt-new" in ids
        assert "topic-auth" in ids

    def test_does_not_duplicate_existing_potential_topics(self, working_dir: Path) -> None:
        _setup(working_dir)
        new_topic = PotentialTopic(
            id="topic-jwt-new",
            title="JWT Strategy",
            summary="JWT discussion",
            path=["JWT Strategy"],
            is_new=True,
        )
        review = TopicReviewResult(
            topic_id="topic-auth",
            reassignments=[
                IdeaUnitReassignment(turn_index=0, idea_unit_index=1, new_topic_id="topic-jwt-new"),
            ],
            new_topics=[new_topic],
        )
        save_topic_review(working_dir, review)
        save_topic_review(working_dir, review)

        pt = PotentialTopics.model_validate_json((working_dir / "possible_topics.json").read_bytes())
        count = sum(1 for t in pt.topics if t.id == "topic-jwt-new")
        assert count == 1
