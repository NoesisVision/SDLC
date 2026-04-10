"""Tests for save_topic_decisions.py — persisting extracted decisions."""

from pathlib import Path

from models_core import (
    Conversation,
    Decision,
    DecisionContext,
    DecisionOption,
    IdeaUnit,
    IdeaUnitCategory,
    IdeaUnitRef,
    Topic,
    Turn,
)
from models_extraction import DecisionExtractionResult
from save_topic_decisions import save_topic_decisions
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


def _auth_topic() -> Topic:
    return Topic(
        id="topic-auth",
        title="Authentication",
        summary="Authentication discussion",
        idea_units=[
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=0),
            IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=1, idea_unit_index=0),
        ],
        subtopics=[],
        reviewed=True,
    )


def _sample_decision() -> Decision:
    return Decision(
        title="Use JWT for authentication",
        status="accepted",
        context=DecisionContext(
            text="The team needed to choose an authentication mechanism.",
            supporting_idea_units=[
                IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=0),
            ],
        ),
        decision=DecisionOption(
            text="Use JWT tokens for session management.",
            rationale="Stateless and scales better with microservices.",
            supporting_idea_units=[
                IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=1, idea_unit_index=0),
            ],
        ),
        alternative_options=[],
    )


def _make_conversation(topics: list[Topic] | None = None) -> Conversation:
    return Conversation(
        conversation_id=SAMPLE_CONVERSATION_ID,
        time="2026-04-10 14:00:00",
        main_topic="Authentication module redesign",
        turns=_sample_turns(),
        topics=topics or [_auth_topic()],
        decisions=[],
    )


def _setup(working_dir: Path, topics: list[Topic] | None = None) -> None:
    conversation = _make_conversation(topics)
    (working_dir / "conversation.json").write_text(
        conversation.model_dump_json(indent=2), encoding="utf-8",
    )


def _load_conversation(working_dir: Path) -> Conversation:
    return Conversation.model_validate_json((working_dir / "conversation.json").read_bytes())


class TestMarkDecisionsExtracted:
    def test_marks_topic_as_decisions_extracted(self, working_dir: Path) -> None:
        _setup(working_dir)
        result = DecisionExtractionResult(
            topic_id="topic-auth",
            decisions=[_sample_decision()],
        )
        save_topic_decisions(working_dir, result)

        conv = _load_conversation(working_dir)
        assert conv.topics[0].decisions_extracted is True

    def test_marks_extracted_even_with_no_decisions(self, working_dir: Path) -> None:
        _setup(working_dir)
        result = DecisionExtractionResult(
            topic_id="topic-auth",
            decisions=[],
        )
        save_topic_decisions(working_dir, result)

        conv = _load_conversation(working_dir)
        assert conv.topics[0].decisions_extracted is True


class TestSaveDecisions:
    def test_appends_decisions_to_conversation(self, working_dir: Path) -> None:
        _setup(working_dir)
        result = DecisionExtractionResult(
            topic_id="topic-auth",
            decisions=[_sample_decision()],
        )
        save_topic_decisions(working_dir, result)

        conv = _load_conversation(working_dir)
        assert len(conv.decisions) == 1
        assert conv.decisions[0].title == "Use JWT for authentication"
        assert conv.decisions[0].status == "accepted"

    def test_preserves_decision_structure(self, working_dir: Path) -> None:
        _setup(working_dir)
        decision = Decision(
            title="Token lifetime",
            status="accepted",
            context=DecisionContext(
                text="Need to set token lifetime.",
                supporting_idea_units=[
                    IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=0, idea_unit_index=0),
                ],
            ),
            decision=DecisionOption(
                text="15-minute access token lifetime.",
                rationale="Balances security and user experience.",
                supporting_idea_units=[
                    IdeaUnitRef(conversation_id=SAMPLE_CONVERSATION_ID, turn_index=1, idea_unit_index=0),
                ],
            ),
            alternative_options=[
                DecisionOption(
                    text="60-minute access token lifetime.",
                    rationale="More convenient but less secure.",
                    supporting_idea_units=[],
                ),
            ],
        )
        result = DecisionExtractionResult(
            topic_id="topic-auth",
            decisions=[decision],
        )
        save_topic_decisions(working_dir, result)

        conv = _load_conversation(working_dir)
        saved = conv.decisions[0]
        assert saved.context.text == "Need to set token lifetime."
        assert len(saved.context.supporting_idea_units) == 1
        assert saved.decision.text == "15-minute access token lifetime."
        assert len(saved.alternative_options) == 1
        assert saved.alternative_options[0].text == "60-minute access token lifetime."

    def test_saves_empty_decisions_list(self, working_dir: Path) -> None:
        _setup(working_dir)
        result = DecisionExtractionResult(
            topic_id="topic-auth",
            decisions=[],
        )
        save_topic_decisions(working_dir, result)

        conv = _load_conversation(working_dir)
        assert len(conv.decisions) == 0


class TestAccumulateDecisions:
    def test_accumulates_decisions_across_topics(self, working_dir: Path) -> None:
        api_topic = Topic(
            id="topic-api",
            title="API Design",
            summary="API patterns",
            idea_units=[],
            subtopics=[],
            reviewed=True,
        )
        _setup(working_dir, topics=[_auth_topic(), api_topic])

        result1 = DecisionExtractionResult(
            topic_id="topic-auth",
            decisions=[_sample_decision()],
        )
        save_topic_decisions(working_dir, result1)

        result2 = DecisionExtractionResult(
            topic_id="topic-api",
            decisions=[Decision(
                title="Use REST",
                status="accepted",
                context=DecisionContext(text="API style needed.", supporting_idea_units=[]),
                decision=DecisionOption(text="REST API.", rationale="Standard.", supporting_idea_units=[]),
                alternative_options=[],
            )],
        )
        save_topic_decisions(working_dir, result2)

        conv = _load_conversation(working_dir)
        assert len(conv.decisions) == 2
        titles = {d.title for d in conv.decisions}
        assert "Use JWT for authentication" in titles
        assert "Use REST" in titles
