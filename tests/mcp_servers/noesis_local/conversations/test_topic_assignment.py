"""End-to-end tests for topic assignment tools."""

from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.conversations.models import (
    AssignResponse,
    EmbedResponse,
    IdeaUnit,
    IdeaUnitCategory,
    SpeakerTurn,
)
from mcp_servers.noesis_local.conversations.registry import get_conversation, register_conversation, reset_store
from mcp_servers.noesis_local.server import noesis_server

IDEA_UNITS_TURNS = [
    SpeakerTurn(
        speaker="Jan Kowalski",
        time="10:00",
        sentences=["We need to decide on the database technology.", "Should we use PostgreSQL or MongoDB?"],
        idea_units=[
            IdeaUnit(
                sentences=["We need to decide on the database technology.", "Should we use PostgreSQL or MongoDB?"],
                category=IdeaUnitCategory.Issue,
            )
        ],
    ),
    SpeakerTurn(
        speaker="Anna Nowak",
        time="10:02",
        sentences=["I think PostgreSQL is better for our use case.", "It has strong ACID compliance and we need transactional guarantees."],
        idea_units=[
            IdeaUnit(
                sentences=["I think PostgreSQL is better for our use case.", "It has strong ACID compliance and we need transactional guarantees."],
                category=IdeaUnitCategory.Argument,
            )
        ],
    ),
    SpeakerTurn(
        speaker="Jan Kowalski",
        time="10:04",
        sentences=["Good point.", "Let's go with PostgreSQL then.", "I will set up the development instance by Friday."],
        idea_units=[
            IdeaUnit(sentences=["Good point."], category=IdeaUnitCategory.Irrelevant),
            IdeaUnit(sentences=["Let's go with PostgreSQL then."], category=IdeaUnitCategory.Decision),
            IdeaUnit(sentences=["I will set up the development instance by Friday."], category=IdeaUnitCategory.Decision),
        ],
    ),
    SpeakerTurn(
        speaker="Anna Nowak",
        time="10:06",
        sentences=["We also need to discuss the deployment pipeline.", "Are we using Docker or Kubernetes?"],
        idea_units=[
            IdeaUnit(
                sentences=["We also need to discuss the deployment pipeline.", "Are we using Docker or Kubernetes?"],
                category=IdeaUnitCategory.Issue,
            )
        ],
    ),
]

MERGEABLE_IDEA_UNITS_TURNS = [
    SpeakerTurn(
        speaker="Jan Kowalski",
        time="10:00",
        sentences=["We need to decide on the database technology."],
        idea_units=[
            IdeaUnit(sentences=["We need to decide on the database technology."], category=IdeaUnitCategory.Issue),
        ],
    ),
    SpeakerTurn(
        speaker="Anna Nowak",
        time="10:02",
        sentences=["PostgreSQL has strong ACID compliance."],
        idea_units=[
            IdeaUnit(sentences=["PostgreSQL has strong ACID compliance."], category=IdeaUnitCategory.Argument),
        ],
    ),
    SpeakerTurn(
        speaker="Jan Kowalski",
        time="10:04",
        sentences=["We should use Docker for deployment."],
        idea_units=[
            IdeaUnit(sentences=["We should use Docker for deployment."], category=IdeaUnitCategory.Position),
        ],
    ),
    SpeakerTurn(
        speaker="Anna Nowak",
        time="10:06",
        sentences=["Kubernetes can orchestrate Docker containers."],
        idea_units=[
            IdeaUnit(sentences=["Kubernetes can orchestrate Docker containers."], category=IdeaUnitCategory.Argument),
        ],
    ),
    SpeakerTurn(
        speaker="Jan Kowalski",
        time="10:08",
        sentences=["We also need a database migration strategy."],
        idea_units=[
            IdeaUnit(sentences=["We also need a database migration strategy."], category=IdeaUnitCategory.Issue),
        ],
    ),
]


AMBIGUOUS_IDEA_UNITS_TURNS = [
    SpeakerTurn(
        speaker="Alice",
        time="10:00",
        sentences=["We should use React for the frontend."],
        idea_units=[
            IdeaUnit(sentences=["We should use React for the frontend."], category=IdeaUnitCategory.Position),
        ],
    ),
    SpeakerTurn(
        speaker="Bob",
        time="10:02",
        sentences=["The backend should use FastAPI."],
        idea_units=[
            IdeaUnit(sentences=["The backend should use FastAPI."], category=IdeaUnitCategory.Position),
        ],
    ),
    SpeakerTurn(
        speaker="Alice",
        time="10:04",
        sentences=["The API design needs to connect frontend and backend."],
        idea_units=[
            IdeaUnit(sentences=["The API design needs to connect frontend and backend."], category=IdeaUnitCategory.Issue),
        ],
    ),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_store():
    reset_store()
    yield
    reset_store()


def _make_fake_embeddings():
    rng = np.random.default_rng(42)
    db_embedding = rng.standard_normal(384).astype(np.float32)
    db_embedding = db_embedding / np.linalg.norm(db_embedding)

    raw = rng.standard_normal(384).astype(np.float32)
    deploy_embedding = raw - np.dot(raw, db_embedding) * db_embedding
    deploy_embedding = deploy_embedding / np.linalg.norm(deploy_embedding)

    def fake_encode(texts, show_progress_bar=False):
        results = []
        for text in texts:
            if "deploy" in text.lower() or "docker" in text.lower() or "kubernetes" in text.lower():
                vec = deploy_embedding + rng.standard_normal(384).astype(np.float32) * 0.03
            else:
                vec = db_embedding + rng.standard_normal(384).astype(np.float32) * 0.03
            vec = vec / np.linalg.norm(vec)
            results.append(vec)
        return np.array(results)

    return fake_encode


def _make_mergeable_embeddings():
    rng = np.random.default_rng(77)
    base = rng.standard_normal(384).astype(np.float32)
    base = base / np.linalg.norm(base)

    raw = rng.standard_normal(384).astype(np.float32)
    other = raw - np.dot(raw, base) * base
    other = other / np.linalg.norm(other)

    raw2 = rng.standard_normal(384).astype(np.float32)
    third = raw2 - np.dot(raw2, base) * base - np.dot(raw2, other) * other
    third = third / np.linalg.norm(third)

    outlier = 0.60 * base + 0.80 * third
    outlier = outlier / np.linalg.norm(outlier)

    directions = [base, base, other, other, outlier]

    def fake_encode(texts, show_progress_bar=False):
        results = []
        for i, _text in enumerate(texts):
            vec = directions[i] + rng.standard_normal(384).astype(np.float32) * 0.005
            vec = vec / np.linalg.norm(vec)
            results.append(vec)
        return np.array(results)

    return fake_encode


def _make_ambiguous_embeddings():
    rng = np.random.default_rng(99)
    base = rng.standard_normal(384).astype(np.float32)
    base = base / np.linalg.norm(base)

    raw2 = rng.standard_normal(384).astype(np.float32)
    other = raw2 - np.dot(raw2, base) * base
    other = other / np.linalg.norm(other)

    midpoint = (base + other) / 2.0
    midpoint = midpoint / np.linalg.norm(midpoint)

    call_count = [0]

    def fake_encode(texts, show_progress_bar=False):
        results = []
        for text in texts:
            idx = call_count[0]
            call_count[0] += 1
            if idx == 0:
                vec = base + rng.standard_normal(384).astype(np.float32) * 0.01
            elif idx == 1:
                vec = other + rng.standard_normal(384).astype(np.float32) * 0.01
            else:
                vec = midpoint + rng.standard_normal(384).astype(np.float32) * 0.01
            vec = vec / np.linalg.norm(vec)
            results.append(vec)
        return np.array(results)

    return fake_encode


def _setup_state_with_embeddings(conversation_id: str, tmp_path: Path, turns: list[SpeakerTurn], fake_encode) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text("dummy", encoding="utf-8")
    state = register_conversation(conversation_id, conv_file.resolve())
    state.turns = turns

    texts: list[str] = []
    idea_unit_refs: list[IdeaUnit] = []
    for turn in turns:
        for iu in turn.idea_units:
            if iu.category != IdeaUnitCategory.Irrelevant:
                texts.append(" ".join(iu.sentences))
                idea_unit_refs.append(iu)

    vectors = fake_encode(texts)
    for iu, vec in zip(idea_unit_refs, vectors):
        iu.embedding = vec


async def _call_tool(tool_name: str, arguments: dict) -> str:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.content[0].text


# ---------------------------------------------------------------------------
# Tests: embed_idea_units
# ---------------------------------------------------------------------------


async def test_embed(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-embed-id"
    conv_file = tmp_path / "conv.md"
    conv_file.write_text("dummy", encoding="utf-8")
    state = register_conversation(conversation_id, conv_file.resolve())
    state.turns = IDEA_UNITS_TURNS

    fake_encode = _make_fake_embeddings()
    with patch("mcp_servers.noesis_local.conversations.topics_assigning.SentenceTransformer") as mock_st:
        mock_st.return_value.encode = fake_encode
        raw = await _call_tool("embed_idea_units", {"conversation_id": conversation_id})

    result = EmbedResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.embedded_count == 5

    state = get_conversation(conversation_id)
    embedded_count = sum(
        1 for t in state.turns for iu in t.idea_units if iu.embedding is not None
    )
    assert embedded_count == 5


# ---------------------------------------------------------------------------
# Tests: assign_topics
# ---------------------------------------------------------------------------


async def test_assign_no_arbitration(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-assign-no-arb-id"
    fake_encode = _make_fake_embeddings()
    _setup_state_with_embeddings(conversation_id, tmp_path, IDEA_UNITS_TURNS, fake_encode)

    raw = await _call_tool("assign_topics", {"conversation_id": conversation_id})
    result = AssignResponse.model_validate_json(raw)

    while result.status == "arbitration_needed":
        topic_id = result.arbitration_request.candidates[0].topic_id
        raw = await _call_tool(
            "apply_topic_arbitration",
            {"conversation_id": conversation_id, "topic_id": topic_id},
        )
        result = AssignResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.topic_count >= 1
    assert result.topics_for_labeling is not None
    assert len(result.topics_for_labeling) >= 1

    state = get_conversation(conversation_id)
    assert state.topics_draft is not None


# ---------------------------------------------------------------------------
# Tests: small topic merging
# ---------------------------------------------------------------------------


async def test_assign_merges_small_topics(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-merge-id"
    fake_encode = _make_mergeable_embeddings()
    _setup_state_with_embeddings(conversation_id, tmp_path, MERGEABLE_IDEA_UNITS_TURNS, fake_encode)

    raw = await _call_tool("assign_topics", {"conversation_id": conversation_id})
    result = AssignResponse.model_validate_json(raw)

    while result.status == "arbitration_needed":
        topic_id = result.arbitration_request.candidates[0].topic_id
        raw = await _call_tool(
            "apply_topic_arbitration",
            {"conversation_id": conversation_id, "topic_id": topic_id},
        )
        result = AssignResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.topic_count == 2

    state = get_conversation(conversation_id)
    assert state.topics_draft is not None
    assert len(state.topics_draft.topics) == 2

# ---------------------------------------------------------------------------
# Tests: assign_topics with arbitration
# ---------------------------------------------------------------------------


async def test_assign_with_arbitration(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-assign-arb-id"
    fake_encode = _make_ambiguous_embeddings()
    _setup_state_with_embeddings(conversation_id, tmp_path, AMBIGUOUS_IDEA_UNITS_TURNS, fake_encode)

    raw = await _call_tool("assign_topics", {"conversation_id": conversation_id})
    result = AssignResponse.model_validate_json(raw)

    assert result.status == "arbitration_needed"
    assert result.arbitration_request is not None
    assert len(result.arbitration_request.candidates) >= 1

    raw2 = await _call_tool(
        "apply_topic_arbitration",
        {"conversation_id": conversation_id, "topic_id": result.arbitration_request.candidates[0].topic_id},
    )
    result2 = AssignResponse.model_validate_json(raw2)

    assert result2.status == "success"
    assert result2.topic_count >= 1
    assert result2.topics_for_labeling is not None

    state = get_conversation(conversation_id)
    assert state.topics_draft is not None
