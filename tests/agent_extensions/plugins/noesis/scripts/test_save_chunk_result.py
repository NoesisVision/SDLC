"""Tests for save_chunk_result.py — persisting topic extraction results."""

from pathlib import Path

from models_core import (
    Conversation,
    IdeaUnit,
    IdeaUnitCategory,
    PotentialTopic,
    PotentialTopics,
    Turn,
)
from models_extraction import ChunkResult, IdeaUnitTopicAssignment
from save_chunk_result import save_chunk_result
from sample_data import SAMPLE_CONVERSATION_ID


def _sample_turn(index: int) -> Turn:
    return Turn(
        index=index,
        speaker="Alice",
        time="00:00:05",
        idea_units=[
            IdeaUnit(index=0, sentences=["We need authentication."], categories=[IdeaUnitCategory.Information]),
            IdeaUnit(index=1, sentences=["Let us use JWT."], categories=[IdeaUnitCategory.Position]),
        ],
    )


def _sample_new_topic() -> PotentialTopic:
    return PotentialTopic(
        id="new-topic-1",
        title="Token Strategy",
        summary="JWT vs session token discussion",
        path=["Authentication", "Token Strategy"],
        is_new=True,
        parent_id="topic-auth",
    )


class TestAppendTurns:
    def test_adds_turns_to_conversation(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        chunk = ChunkResult(
            turns=[_sample_turn(0), _sample_turn(1)],
            assignments=[],
            new_topics=[],
        )
        save_chunk_result(working_dir, chunk)
        conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
        assert len(conv.turns) == 2

    def test_appends_to_existing_turns(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        first_chunk = ChunkResult(turns=[_sample_turn(0)], assignments=[], new_topics=[])
        save_chunk_result(working_dir, first_chunk)

        second_chunk = ChunkResult(turns=[_sample_turn(1)], assignments=[], new_topics=[])
        save_chunk_result(working_dir, second_chunk)

        conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
        assert len(conv.turns) == 2
        assert conv.turns[0].index == 0
        assert conv.turns[1].index == 1


class TestTopicAssignments:
    def test_creates_topic_entry_for_existing_topic(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        chunk = ChunkResult(
            turns=[_sample_turn(0)],
            assignments=[
                IdeaUnitTopicAssignment(turn_index=0, idea_unit_index=0, topic_id="topic-auth"),
            ],
            new_topics=[],
        )
        save_chunk_result(working_dir, chunk)
        conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
        assert len(conv.topics) == 1
        assert conv.topics[0].id == "topic-auth"

    def test_adds_idea_unit_ref_to_topic(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        chunk = ChunkResult(
            turns=[_sample_turn(0)],
            assignments=[
                IdeaUnitTopicAssignment(turn_index=0, idea_unit_index=0, topic_id="topic-auth"),
                IdeaUnitTopicAssignment(turn_index=0, idea_unit_index=1, topic_id="topic-auth"),
            ],
            new_topics=[],
        )
        save_chunk_result(working_dir, chunk)
        conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
        refs = conv.topics[0].idea_units
        assert len(refs) == 2
        assert refs[0].conversation_id == SAMPLE_CONVERSATION_ID
        assert refs[0].turn_index == 0
        assert refs[0].idea_unit_index == 0

    def test_creates_topic_from_new_topic_metadata(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        new_topic = _sample_new_topic()
        chunk = ChunkResult(
            turns=[_sample_turn(0)],
            assignments=[
                IdeaUnitTopicAssignment(turn_index=0, idea_unit_index=0, topic_id=new_topic.id),
            ],
            new_topics=[new_topic],
        )
        save_chunk_result(working_dir, chunk)
        conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
        topic = conv.topics[0]
        assert topic.id == new_topic.id
        assert topic.title == "Token Strategy"

    def test_accumulates_refs_across_chunks(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        chunk1 = ChunkResult(
            turns=[_sample_turn(0)],
            assignments=[IdeaUnitTopicAssignment(turn_index=0, idea_unit_index=0, topic_id="topic-auth")],
            new_topics=[],
        )
        save_chunk_result(working_dir, chunk1)

        chunk2 = ChunkResult(
            turns=[_sample_turn(1)],
            assignments=[IdeaUnitTopicAssignment(turn_index=1, idea_unit_index=0, topic_id="topic-auth")],
            new_topics=[],
        )
        save_chunk_result(working_dir, chunk2)

        conv = Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())
        assert len(conv.topics) == 1
        assert len(conv.topics[0].idea_units) == 2


class TestNewTopicsInPossibleTopics:
    def test_appends_new_topics_to_possible_topics(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        new_topic = _sample_new_topic()
        chunk = ChunkResult(
            turns=[_sample_turn(0)],
            assignments=[IdeaUnitTopicAssignment(turn_index=0, idea_unit_index=0, topic_id=new_topic.id)],
            new_topics=[new_topic],
        )
        save_chunk_result(working_dir, chunk)
        pt = PotentialTopics.model_validate_json((working_dir / "possible_topics.json").read_bytes())
        ids = {t.id for t in pt.topics}
        assert new_topic.id in ids
        assert "topic-auth" in ids  # original topic preserved

    def test_does_not_duplicate_existing_topics(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        new_topic = _sample_new_topic()
        chunk = ChunkResult(
            turns=[_sample_turn(0)],
            assignments=[IdeaUnitTopicAssignment(turn_index=0, idea_unit_index=0, topic_id=new_topic.id)],
            new_topics=[new_topic],
        )
        save_chunk_result(working_dir, chunk)
        save_chunk_result(working_dir, chunk)

        pt = PotentialTopics.model_validate_json((working_dir / "possible_topics.json").read_bytes())
        new_count = sum(1 for t in pt.topics if t.id == new_topic.id)
        assert new_count == 1

    def test_skips_possible_topics_update_when_no_new_topics(
        self, working_dir: Path, conversation_json: Path, possible_topics_json: Path,
    ) -> None:
        original = (working_dir / "possible_topics.json").read_bytes()
        chunk = ChunkResult(turns=[_sample_turn(0)], assignments=[], new_topics=[])
        save_chunk_result(working_dir, chunk)
        assert (working_dir / "possible_topics.json").read_bytes() == original
