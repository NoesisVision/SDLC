"""End-to-end tests for the structure_conversation MCP tool."""

import json
from pathlib import Path
from unittest.mock import patch

from mcp import types
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.structure_conversation import ConversationSummary
from mcp_servers.noesis_local.server import noesis_server


BASIC_CONVERSATION = """\
# Sprint Planning Meeting
2026-03-01
**10:00**
Jan Kowalski
We need to decide on the database technology. Should we use PostgreSQL or MongoDB?
**10:02**
Anna Nowak
I think PostgreSQL is better for our use case. It has strong ACID compliance and we need transactional guarantees.
**10:04**
Jan Kowalski
Good point. Let's go with PostgreSQL then. I will set up the development instance by Friday.
**10:06**
Anna Nowak
We also need to discuss the deployment pipeline. Are we using Docker or Kubernetes?
"""

PHASE1_RESPONSE_BASIC = json.dumps([
    {
        "speaker": "Jan Kowalski",
        "time": "10:00",
        "idea_units": [
            {
                "sentences": [
                    "We need to decide on the database technology.",
                    "Should we use PostgreSQL or MongoDB?"
                ],
                "category": "Issue",
            }
        ],
    },
    {
        "speaker": "Anna Nowak",
        "time": "10:02",
        "idea_units": [
            {
                "sentences": [
                    "I think PostgreSQL is better for our use case.",
                    "It has strong ACID compliance and we need transactional guarantees."
                ],
                "category": "Argument",
            }
        ],
    },
    {
        "speaker": "Jan Kowalski",
        "time": "10:04",
        "idea_units": [
            {
                "sentences": ["Good point."],
                "category": "Irrelevant",
            },
            {
                "sentences": ["Let's go with PostgreSQL then."],
                "category": "Decision",
            },
            {
                "sentences": ["I will set up the development instance by Friday."],
                "category": "Decision",
            },
        ],
    },
    {
        "speaker": "Anna Nowak",
        "time": "10:06",
        "idea_units": [
            {
                "sentences": [
                    "We also need to discuss the deployment pipeline.",
                    "Are we using Docker or Kubernetes?"
                ],
                "category": "Issue",
            }
        ],
    },
])

NEW_TOPIC_RESPONSE_DB = json.dumps({
    "label": "Database Technology Choice",
    "summary": "Discussion about choosing between PostgreSQL and MongoDB for the project database.",
})

SUMMARY_UPDATE_RESPONSE_DB_DECISION = json.dumps({
    "summary": "Team chose PostgreSQL for ACID compliance. Jan will set up the dev instance by Friday.",
})

NEW_TOPIC_RESPONSE_DEPLOY = json.dumps({
    "label": "Deployment Pipeline",
    "summary": "Discussion about choosing between Docker and Kubernetes for deployment.",
})

SUMMARY_UPDATE_RESPONSE_DB_ARGUMENT = json.dumps({
    "summary": "PostgreSQL selected for strong ACID compliance and transactional guarantees needed by the project.",
})


def _make_sampling_callback():
    call_count = 0

    async def callback(context, params):
        nonlocal call_count
        call_count += 1
        prompt_text = params.messages[0].content.text

        if "CATEGORIES (exactly one per unit)" in prompt_text:
            response_text = PHASE1_RESPONSE_BASIC
        elif "Create a topic label" in prompt_text:
            if "deployment" in prompt_text.lower() or "docker" in prompt_text.lower():
                response_text = NEW_TOPIC_RESPONSE_DEPLOY
            else:
                response_text = NEW_TOPIC_RESPONSE_DB
        elif "Revise this topic summary" in prompt_text:
            if "PostgreSQL then" in prompt_text or "development instance" in prompt_text:
                response_text = SUMMARY_UPDATE_RESPONSE_DB_DECISION
            else:
                response_text = SUMMARY_UPDATE_RESPONSE_DB_ARGUMENT
        elif "Does this fragment belong" in prompt_text:
            response_text = json.dumps({"topic_id": "topic_001"})
        else:
            response_text = json.dumps({"label": "Unknown", "summary": "Unknown topic"})

        return types.CreateMessageResult(
            role="assistant",
            content=types.TextContent(type="text", text=response_text),
            model="fake-model",
        )

    return callback


def _make_fake_embeddings():
    import numpy as np

    rng = np.random.default_rng(42)
    db_embedding = rng.standard_normal(384).astype(np.float32)
    db_embedding = db_embedding / np.linalg.norm(db_embedding)

    raw = rng.standard_normal(384).astype(np.float32)
    deploy_embedding = raw - np.dot(raw, db_embedding) * db_embedding
    deploy_embedding = deploy_embedding / np.linalg.norm(deploy_embedding)

    call_count = 0

    def fake_encode(texts, show_progress_bar=False):
        nonlocal call_count
        results = []
        for text in texts:
            if "deploy" in text.lower() or "docker" in text.lower() or "kubernetes" in text.lower():
                vec = deploy_embedding + rng.standard_normal(384).astype(np.float32) * 0.03
            else:
                vec = db_embedding + rng.standard_normal(384).astype(np.float32) * 0.03
            vec = vec / np.linalg.norm(vec)
            results.append(vec)
            call_count += 1
        return np.array(results)

    return fake_encode


async def test_basic_structuring(tmp_path, monkeypatch) -> None:
    """Test end-to-end structuring of a multi-topic conversation."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "meeting.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    callback = _make_sampling_callback()
    fake_encode = _make_fake_embeddings()

    with patch("mcp_servers.noesis_local.topic_registry.SentenceTransformer") as mock_st:
        mock_instance = mock_st.return_value
        mock_instance.encode = fake_encode

        result = await _call_structure_conversation(str(conv_file), callback)

    assert result.title == "Sprint Planning Meeting"
    assert result.date == "2026-03-01 10:00"
    assert len(result.topics) >= 1

    topic_names = [t.name for t in result.topics]
    assert any("Database" in name or "database" in name for name in topic_names)


async def test_structured_json_saved(tmp_path, monkeypatch) -> None:
    """Test that structured JSON file is saved alongside the input."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "meeting.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    callback = _make_sampling_callback()
    fake_encode = _make_fake_embeddings()

    with patch("mcp_servers.noesis_local.topic_registry.SentenceTransformer") as mock_st:
        mock_instance = mock_st.return_value
        mock_instance.encode = fake_encode

        await _call_structure_conversation(str(conv_file), callback)

    output_file = tmp_path / "meeting_structured.json"
    assert output_file.exists()

    structured = json.loads(output_file.read_text(encoding="utf-8"))
    assert structured["title"] == "Sprint Planning Meeting"
    assert structured["date"] == "2026-03-01 10:00"
    assert "topics" in structured
    assert len(structured["topics"]) >= 1

    first_topic = structured["topics"][0]
    assert "name" in first_topic
    assert "summary" in first_topic
    assert "statements" in first_topic
    assert len(first_topic["statements"]) >= 1

    first_statement = first_topic["statements"][0]
    assert "speaker" in first_statement
    assert "time" in first_statement
    assert "idea_units" in first_statement


async def test_file_not_found(tmp_path, monkeypatch) -> None:
    """Test that a missing file raises an error through MCP."""
    monkeypatch.chdir(tmp_path)

    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(
            "structure_conversation", {"file_path": "/nonexistent/file.md"}
        )

    assert result.isError


async def test_empty_file(tmp_path, monkeypatch) -> None:
    """Test that an empty file raises an error through MCP."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "empty.md"
    conv_file.write_text("", encoding="utf-8")

    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(
            "structure_conversation", {"file_path": str(conv_file)}
        )

    assert result.isError


async def test_tool_is_listed(tmp_path, monkeypatch) -> None:
    """Test that the structure_conversation tool is registered and discoverable."""
    monkeypatch.chdir(tmp_path)
    async with create_connected_server_and_client_session(noesis_server) as client:
        result = await client.list_tools()
        tools = result.tools

        tool = next((t for t in tools if t.name == "structure_conversation"), None)
        assert tool is not None
        assert tool.description is not None
        assert tool.inputSchema is not None
        assert "file_path" in tool.inputSchema["properties"]


MULTI_TOPIC_CONVERSATION = """\
# Architecture Review
2026-04-10
**14:00**
Alice
We should migrate to microservices. The monolith is becoming unmanageable.
**14:02**
Bob
I agree the monolith has scaling issues. But microservices add operational complexity.
**14:04**
Alice
Let's also talk about testing strategy. We need more integration tests.
**14:06**
Bob
For testing, I suggest we adopt contract testing between services.
**14:08**
Alice
Going back to the architecture, I think we start with two services: auth and billing.
**14:10**
Bob
That sounds reasonable. Let's proceed with auth and billing as the first extraction.
"""

PHASE1_RESPONSE_MULTI = json.dumps([
    {
        "speaker": "Alice",
        "time": "14:00",
        "idea_units": [
            {
                "sentences": [
                    "We should migrate to microservices.",
                    "The monolith is becoming unmanageable."
                ],
                "category": "Position",
            }
        ],
    },
    {
        "speaker": "Bob",
        "time": "14:02",
        "idea_units": [
            {
                "sentences": ["I agree the monolith has scaling issues."],
                "category": "Argument",
            },
            {
                "sentences": ["But microservices add operational complexity."],
                "category": "Argument",
            },
        ],
    },
    {
        "speaker": "Alice",
        "time": "14:04",
        "idea_units": [
            {
                "sentences": [
                    "Let's also talk about testing strategy.",
                    "We need more integration tests."
                ],
                "category": "Issue",
            }
        ],
    },
    {
        "speaker": "Bob",
        "time": "14:06",
        "idea_units": [
            {
                "sentences": ["For testing, I suggest we adopt contract testing between services."],
                "category": "Position",
            }
        ],
    },
    {
        "speaker": "Alice",
        "time": "14:08",
        "idea_units": [
            {
                "sentences": [
                    "Going back to the architecture, I think we start with two services: auth and billing."
                ],
                "category": "Position",
            }
        ],
    },
    {
        "speaker": "Bob",
        "time": "14:10",
        "idea_units": [
            {
                "sentences": [
                    "That sounds reasonable.",
                    "Let's proceed with auth and billing as the first extraction."
                ],
                "category": "Decision",
            }
        ],
    },
])


def _make_multi_topic_callback():
    async def callback(context, params):
        prompt_text = params.messages[0].content.text

        if "CATEGORIES (exactly one per unit)" in prompt_text:
            response_text = PHASE1_RESPONSE_MULTI
        elif "Create a topic label" in prompt_text:
            if "testing" in prompt_text.lower() or "contract" in prompt_text.lower() or "integration" in prompt_text.lower():
                response_text = json.dumps({
                    "label": "Testing Strategy",
                    "summary": "Discussion about improving testing with integration and contract tests.",
                })
            else:
                response_text = json.dumps({
                    "label": "Microservices Migration",
                    "summary": "Proposal to migrate from monolith to microservices architecture.",
                })
        elif "Revise this topic summary" in prompt_text:
            if "testing" in prompt_text.lower() or "contract" in prompt_text.lower():
                response_text = json.dumps({
                    "summary": "Team plans to adopt contract testing between extracted services for integration assurance.",
                })
            else:
                response_text = json.dumps({
                    "summary": "Team decided to start microservices migration with auth and billing as first extractions from the monolith.",
                })
        elif "Does this fragment belong" in prompt_text:
            if "testing" in prompt_text.lower() or "contract" in prompt_text.lower():
                response_text = json.dumps({"topic_id": "topic_002"})
            else:
                response_text = json.dumps({"topic_id": "topic_001"})
        else:
            response_text = json.dumps({"label": "Unknown", "summary": "Unknown"})

        return types.CreateMessageResult(
            role="assistant",
            content=types.TextContent(type="text", text=response_text),
            model="fake-model",
        )

    return callback


def _make_multi_topic_embeddings():
    import numpy as np

    rng = np.random.default_rng(10)
    arch_base = rng.standard_normal(384).astype(np.float32)
    arch_base = arch_base / np.linalg.norm(arch_base)

    raw = rng.standard_normal(384).astype(np.float32)
    test_base = raw - np.dot(raw, arch_base) * arch_base
    test_base = test_base / np.linalg.norm(test_base)

    call_count = 0

    def fake_encode(texts, show_progress_bar=False):
        nonlocal call_count
        results = []
        for text in texts:
            lower = text.lower()
            if "testing" in lower or "contract" in lower or "integration" in lower:
                vec = test_base + rng.standard_normal(384).astype(np.float32) * 0.03
            else:
                vec = arch_base + rng.standard_normal(384).astype(np.float32) * 0.03
            vec = vec / np.linalg.norm(vec)
            results.append(vec)
            call_count += 1
        return np.array(results)

    return fake_encode


async def test_multi_topic_conversation(tmp_path, monkeypatch) -> None:
    """Test that a conversation with topic switching creates multiple topics."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "review.md"
    conv_file.write_text(MULTI_TOPIC_CONVERSATION, encoding="utf-8")

    callback = _make_multi_topic_callback()
    fake_encode = _make_multi_topic_embeddings()

    with patch("mcp_servers.noesis_local.topic_registry.SentenceTransformer") as mock_st:
        mock_instance = mock_st.return_value
        mock_instance.encode = fake_encode

        result = await _call_structure_conversation(str(conv_file), callback)

    assert len(result.topics) >= 2

    topic_names_lower = [t.name.lower() for t in result.topics]
    assert any("microservice" in n or "architecture" in n or "migration" in n for n in topic_names_lower)
    assert any("testing" in n or "test" in n for n in topic_names_lower)


async def _call_structure_conversation(
    file_path: str, sampling_callback=None
) -> ConversationSummary:
    kwargs = {"raise_exceptions": True}
    if sampling_callback is not None:
        kwargs["sampling_callback"] = sampling_callback
    async with create_connected_server_and_client_session(
        noesis_server, **kwargs
    ) as client:
        result = await client.call_tool(
            "structure_conversation", {"file_path": file_path}
        )
        return ConversationSummary.model_validate_json(result.content[0].text)
