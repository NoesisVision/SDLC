"""Tests for merge_to_knowledge_graph.py — merging conversation into knowledge graph."""

import json
from pathlib import Path

from models_core import (
    Conversation,
    Decision,
    DecisionContext,
    DecisionOption,
    IdeaUnit,
    IdeaUnitCategory,
    IdeaUnitRef,
    PotentialTopic,
    PotentialTopics,
    Topic,
    Turn,
)
from models_knowledge_graph import KnowledgeGraph
from merge_to_knowledge_graph import merge_to_knowledge_graph
from sample_data import SAMPLE_CONVERSATION_ID


def _ref(turn_index: int, idea_unit_index: int) -> IdeaUnitRef:
    return IdeaUnitRef(
        conversation_id=SAMPLE_CONVERSATION_ID,
        turn_index=turn_index,
        idea_unit_index=idea_unit_index,
    )


def _sample_turns() -> list[Turn]:
    return [
        Turn(
            index=0,
            speaker="Alice",
            time="00:00:05",
            idea_units=[
                IdeaUnit(index=0, sentences=["We need authentication."], categories=[IdeaUnitCategory.Information]),
            ],
        ),
    ]


def _sample_decision() -> Decision:
    return Decision(
        title="Use JWT",
        status="accepted",
        context=DecisionContext(text="Need auth.", supporting_idea_units=[_ref(0, 0)]),
        decision=DecisionOption(text="JWT.", rationale="Stateless.", supporting_idea_units=[_ref(0, 0)]),
        alternative_options=[],
    )


def _write_conversation(working_dir: Path, conversation: Conversation) -> None:
    (working_dir / "conversation.json").write_text(
        conversation.model_dump_json(indent=2), encoding="utf-8",
    )


def _write_kg(path: Path, kg: KnowledgeGraph) -> None:
    path.write_text(kg.model_dump_json(indent=2), encoding="utf-8")


def _write_possible_topics(working_dir: Path, topics: list[PotentialTopic]) -> None:
    pt = PotentialTopics(topics=topics)
    (working_dir / "possible_topics.json").write_text(
        pt.model_dump_json(indent=2), encoding="utf-8",
    )


def _load_kg(path: Path) -> KnowledgeGraph:
    return KnowledgeGraph.model_validate_json(path.read_bytes())


def _empty_kg() -> KnowledgeGraph:
    return KnowledgeGraph(conversations=[], topics=[], decisions=[])


class TestConversationSummary:
    def test_adds_new_conversation_summary(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth redesign",
            turns=_sample_turns(),
            topics=[],
            decisions=[],
        )
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, _empty_kg())
        _write_possible_topics(working_dir, [])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.conversations) == 1
        assert kg.conversations[0].conversation_id == SAMPLE_CONVERSATION_ID
        assert kg.conversations[0].main_topic == "Auth redesign"

    def test_replaces_existing_conversation_summary(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Updated topic",
            turns=_sample_turns(),
            topics=[],
            decisions=[],
        )
        kg = _empty_kg()
        from models_knowledge_graph import ConversationSummary
        kg.conversations.append(ConversationSummary(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Old topic",
            turns=[],
        ))
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, kg)
        _write_possible_topics(working_dir, [])

        merge_to_knowledge_graph(working_dir, kg_path)

        result = _load_kg(kg_path)
        assert len(result.conversations) == 1
        assert result.conversations[0].main_topic == "Updated topic"


class TestNewTopics:
    def test_inserts_new_root_topic(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        topic = Topic(
            id="topic-new",
            title="New Topic",
            summary="Brand new",
            idea_units=[_ref(0, 0)],
            subtopics=[],
        )
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[topic],
            decisions=[],
        )
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, _empty_kg())
        _write_possible_topics(working_dir, [
            PotentialTopic(id="topic-new", title="New Topic", summary="Brand new", path=["New Topic"], is_new=True),
        ])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.topics) == 1
        assert kg.topics[0].id == "topic-new"
        assert kg.topics[0].idea_units[0].turn_index == 0

    def test_inserts_new_subtopic_under_parent(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        topic = Topic(
            id="topic-jwt",
            title="JWT Strategy",
            summary="JWT details",
            idea_units=[_ref(0, 0)],
            subtopics=[],
        )
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[topic],
            decisions=[],
        )
        kg = _empty_kg()
        kg.topics.append(Topic(
            id="topic-auth",
            title="Authentication",
            summary="Auth stuff",
            idea_units=[],
            subtopics=[],
        ))
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, kg)
        _write_possible_topics(working_dir, [
            PotentialTopic(
                id="topic-jwt", title="JWT Strategy", summary="JWT details",
                path=["Authentication", "JWT Strategy"], is_new=True, parent_id="topic-auth",
            ),
        ])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.topics) == 1
        assert kg.topics[0].id == "topic-auth"
        assert len(kg.topics[0].subtopics) == 1
        assert kg.topics[0].subtopics[0].id == "topic-jwt"

    def test_falls_back_to_root_when_parent_not_found(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        topic = Topic(
            id="topic-orphan",
            title="Orphan",
            summary="Parent missing",
            idea_units=[_ref(0, 0)],
            subtopics=[],
        )
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[topic],
            decisions=[],
        )
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, _empty_kg())
        _write_possible_topics(working_dir, [
            PotentialTopic(
                id="topic-orphan", title="Orphan", summary="Parent missing",
                path=["Missing", "Orphan"], is_new=True, parent_id="topic-missing",
            ),
        ])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.topics) == 1
        assert kg.topics[0].id == "topic-orphan"


class TestExistingTopicUpdate:
    def test_updates_summary_from_conversation(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        conv_topic = Topic(
            id="topic-auth",
            title="Authentication",
            summary="Updated summary from conversation",
            idea_units=[_ref(0, 0)],
            subtopics=[],
        )
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[conv_topic],
            decisions=[],
        )
        kg = _empty_kg()
        kg.topics.append(Topic(
            id="topic-auth",
            title="Authentication",
            summary="Old summary",
            idea_units=[],
            subtopics=[],
        ))
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, kg)
        _write_possible_topics(working_dir, [
            PotentialTopic(id="topic-auth", title="Authentication", summary="Updated summary from conversation", path=["Authentication"]),
        ])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert kg.topics[0].summary == "Updated summary from conversation"

    def test_adds_new_idea_unit_refs(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        existing_ref = IdeaUnitRef(conversation_id="old-conv", turn_index=0, idea_unit_index=0)
        conv_topic = Topic(
            id="topic-auth",
            title="Authentication",
            summary="Auth",
            idea_units=[_ref(0, 0)],
            subtopics=[],
        )
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[conv_topic],
            decisions=[],
        )
        kg = _empty_kg()
        kg.topics.append(Topic(
            id="topic-auth",
            title="Authentication",
            summary="Auth",
            idea_units=[existing_ref],
            subtopics=[],
        ))
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, kg)
        _write_possible_topics(working_dir, [
            PotentialTopic(id="topic-auth", title="Authentication", summary="Auth", path=["Authentication"]),
        ])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.topics[0].idea_units) == 2
        conv_ids = {ref.conversation_id for ref in kg.topics[0].idea_units}
        assert "old-conv" in conv_ids
        assert SAMPLE_CONVERSATION_ID in conv_ids

    def test_does_not_duplicate_existing_refs(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        conv_topic = Topic(
            id="topic-auth",
            title="Authentication",
            summary="Auth",
            idea_units=[_ref(0, 0)],
            subtopics=[],
        )
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[conv_topic],
            decisions=[],
        )
        kg = _empty_kg()
        kg.topics.append(Topic(
            id="topic-auth",
            title="Authentication",
            summary="Auth",
            idea_units=[_ref(0, 0)],
            subtopics=[],
        ))
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, kg)
        _write_possible_topics(working_dir, [
            PotentialTopic(id="topic-auth", title="Authentication", summary="Auth", path=["Authentication"]),
        ])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.topics[0].idea_units) == 1


class TestReparenting:
    def test_moves_topic_from_root_to_subtopic(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        conv_topic = Topic(
            id="topic-jwt",
            title="JWT",
            summary="JWT updated",
            idea_units=[_ref(0, 0)],
            subtopics=[],
        )
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[conv_topic],
            decisions=[],
        )
        kg = _empty_kg()
        kg.topics.append(Topic(id="topic-auth", title="Auth", summary="Auth", idea_units=[], subtopics=[]))
        kg.topics.append(Topic(id="topic-jwt", title="JWT", summary="JWT old", idea_units=[], subtopics=[]))
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, kg)
        _write_possible_topics(working_dir, [
            PotentialTopic(id="topic-jwt", title="JWT", summary="JWT updated", path=["Auth", "JWT"], parent_id="topic-auth"),
        ])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        root_ids = {t.id for t in kg.topics}
        assert "topic-jwt" not in root_ids
        assert len(kg.topics[0].subtopics) == 1
        assert kg.topics[0].subtopics[0].id == "topic-jwt"
        assert kg.topics[0].subtopics[0].summary == "JWT updated"

    def test_moves_topic_from_subtopic_to_root(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        conv_topic = Topic(
            id="topic-jwt",
            title="JWT",
            summary="JWT standalone",
            idea_units=[],
            subtopics=[],
        )
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[conv_topic],
            decisions=[],
        )
        kg = _empty_kg()
        jwt_topic = Topic(id="topic-jwt", title="JWT", summary="JWT old", idea_units=[], subtopics=[])
        kg.topics.append(Topic(id="topic-auth", title="Auth", summary="Auth", idea_units=[], subtopics=[jwt_topic]))
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, kg)
        _write_possible_topics(working_dir, [
            PotentialTopic(id="topic-jwt", title="JWT", summary="JWT standalone", path=["JWT"], parent_id=None),
        ])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.topics) == 2
        root_ids = {t.id for t in kg.topics}
        assert "topic-jwt" in root_ids
        assert len(kg.topics[0].subtopics) == 0


class TestDecisionsMerge:
    def test_appends_decisions(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[],
            decisions=[_sample_decision()],
        )
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, _empty_kg())
        _write_possible_topics(working_dir, [])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.decisions) == 1
        assert kg.decisions[0].title == "Use JWT"

    def test_accumulates_with_existing_decisions(
        self, working_dir: Path, tmp_path: Path,
    ) -> None:
        conv = Conversation(
            conversation_id=SAMPLE_CONVERSATION_ID,
            time="2026-04-10 14:00:00",
            main_topic="Auth",
            turns=_sample_turns(),
            topics=[],
            decisions=[_sample_decision()],
        )
        kg = _empty_kg()
        kg.decisions.append(Decision(
            title="Use REST",
            status="accepted",
            context=DecisionContext(text="API style.", supporting_idea_units=[]),
            decision=DecisionOption(text="REST.", rationale="Standard.", supporting_idea_units=[]),
            alternative_options=[],
        ))
        kg_path = tmp_path / "kg.json"
        _write_conversation(working_dir, conv)
        _write_kg(kg_path, kg)
        _write_possible_topics(working_dir, [])

        merge_to_knowledge_graph(working_dir, kg_path)

        kg = _load_kg(kg_path)
        assert len(kg.decisions) == 2
        titles = {d.title for d in kg.decisions}
        assert "Use JWT" in titles
        assert "Use REST" in titles
