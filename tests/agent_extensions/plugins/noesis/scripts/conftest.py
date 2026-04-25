import json
from pathlib import Path

import pytest
from models_core import Conversation, PotentialTopic, PotentialTopics
from models_transcript import RawTranscript, RawTurn
from sample_data import (
    SAMPLE_CONVERSATION_ID,
    SAMPLE_KNOWLEDGE_GRAPH,
    SAMPLE_TRANSCRIPT,
    SAMPLE_TRANSCRIPT_WITH_ID,
)


@pytest.fixture
def transcript_path(tmp_path: Path) -> Path:
    """Markdown transcript with conversation_id already present."""
    path = tmp_path / "meeting.md"
    path.write_text(SAMPLE_TRANSCRIPT_WITH_ID, encoding="utf-8")
    return path


@pytest.fixture
def transcript_without_id(tmp_path: Path) -> Path:
    """Markdown transcript without a conversation_id line."""
    path = tmp_path / "meeting.md"
    path.write_text(SAMPLE_TRANSCRIPT, encoding="utf-8")
    return path


@pytest.fixture
def knowledge_graph_path(tmp_path: Path) -> Path:
    """Knowledge graph JSON file with sample topics."""
    path = tmp_path / "knowledge_graph.json"
    path.write_text(json.dumps(SAMPLE_KNOWLEDGE_GRAPH, indent=2), encoding="utf-8")
    return path


@pytest.fixture
def empty_knowledge_graph_path(tmp_path: Path) -> Path:
    """Knowledge graph JSON file with no topics."""
    path = tmp_path / "knowledge_graph.json"
    path.write_text(json.dumps({"conversations": [], "topics": [], "decisions": []}), encoding="utf-8")
    return path


@pytest.fixture
def working_dir(tmp_path: Path) -> Path:
    """Pre-created working directory (as working_dir.py would create it)."""
    wd = tmp_path / "meeting_work"
    wd.mkdir()
    return wd


@pytest.fixture
def structured_transcript(working_dir: Path) -> Path:
    """Structured transcript JSON (as structure_transcript.py would produce)."""
    transcript = RawTranscript(
        conversation_id=SAMPLE_CONVERSATION_ID,
        turns=[
            RawTurn(speaker="Alice", time="00:00:05", sentences=[
                "We need to discuss the authentication module design.",
                "The current implementation uses session cookies.",
            ]),
            RawTurn(speaker="Bob", time="00:00:32", sentences=[
                "I think we should migrate to JWT tokens for session management.",
                "They are stateless and scale better with our microservices architecture.",
            ]),
            RawTurn(speaker="Alice", time="00:01:15", sentences=[
                "Good point.",
                "What about refresh token rotation for security?",
                "We had issues with token theft last quarter.",
            ]),
            RawTurn(speaker="Bob", time="00:01:45", sentences=[
                "Agreed.",
                "Let us implement refresh token rotation with a 15-minute access token lifetime.",
                "That is the decision then.",
            ]),
            RawTurn(speaker="Alice", time="00:02:10", sentences=[
                "Sounds good.",
                "Oh by the way, is the conference room booked for tomorrow's standup?",
            ]),
        ],
    )
    path = working_dir / "meeting.json"
    path.write_text(transcript.model_dump_json(indent=2), encoding="utf-8")
    return path


@pytest.fixture
def conversation_json(working_dir: Path) -> Path:
    """Initialized conversation.json with metadata and empty analysis fields."""
    conversation = Conversation(
        conversation_id=SAMPLE_CONVERSATION_ID,
        time="2026-04-10 14:00:00",
        main_topic="Authentication module redesign",
        turns=[],
        topics=[],
        decisions=[],
    )
    path = working_dir / "conversation.json"
    path.write_text(conversation.model_dump_json(indent=2), encoding="utf-8")
    return path


@pytest.fixture
def possible_topics_json(working_dir: Path) -> Path:
    """possible_topics.json with two sample topics from knowledge graph."""
    topics = PotentialTopics(topics=[
        PotentialTopic(
            id="topic-auth",
            title="Authentication",
            summary="Authentication and identity management",
            path=["Authentication"],
        ),
        PotentialTopic(
            id="topic-api",
            title="API Design",
            summary="REST API design patterns and standards",
            path=["API Design"],
        ),
    ])
    path = working_dir / "possible_topics.json"
    path.write_text(topics.model_dump_json(indent=2), encoding="utf-8")
    return path
