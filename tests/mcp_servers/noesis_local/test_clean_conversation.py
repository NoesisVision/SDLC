"""End-to-end tests for the clean_conversation_file MCP tool."""

import json

from mcp import types
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.server import noesis_server


def _make_sampling_callback(response_text: str):
    async def callback(context, params):
        return types.CreateMessageResult(
            role="assistant",
            content=types.TextContent(type="text", text=response_text),
            model="fake-model",
        )

    return callback


BASIC_CONVERSATION = """\
# System Modularization
2026-02-19
**12:13**
Jan Kowalski
In my opinion we should do this. Without that it will not work.
**12:15**
Anna Nowak
I agree with Jan. Let's proceed with this option.
"""


async def test_basic_conversation_parsing(tmp_path, monkeypatch) -> None:
    """Test parsing a well-formed conversation file."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    assert data["title"] == "System Modularization"
    assert data["date"] == "2026-02-19 12:13"
    assert len(data["statements"]) == 2

    first = data["statements"][0]
    assert first["speaker"] == "Jan Kowalski"
    assert first["time"] == "12:13"
    assert len(first["sentences"]) == 2
    assert "In my opinion" in first["sentences"][0]
    assert "Without that" in first["sentences"][1]

    second = data["statements"][1]
    assert second["speaker"] == "Anna Nowak"
    assert second["time"] == "12:15"
    assert len(second["sentences"]) == 2


CONVERSATION_WITH_DIRTY_TEXT = """\
# Dirty Conversation
2026-01-15
**09:00**
Speaker1
This  has   multiple   spaces.   And\u00a0non-breaking\u00a0spaces.
Also \u201csmart quotes\u201d and \u2018single\u2019 ones.
**09:05**
Speaker2
Contains a zero\u200bwidth char. and lowercase after period.
"""


async def test_text_cleaning(tmp_path, monkeypatch) -> None:
    """Test that all Tier 2 cleaning methods are applied."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "dirty.md"
    conv_file.write_text(CONVERSATION_WITH_DIRTY_TEXT, encoding="utf-8")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    first_text = " ".join(data["statements"][0]["sentences"])
    assert "  " not in first_text
    assert "\u00a0" not in first_text
    assert "\u201c" not in first_text
    assert "\u2018" not in first_text
    assert '"smart quotes"' in first_text
    assert "'single'" in first_text

    second_text = " ".join(data["statements"][1]["sentences"])
    assert "\u200b" not in second_text
    assert "zerowidth" in second_text
    assert "And lowercase" in second_text


CONVERSATION_WITH_LINE_BREAKS = """\
# Line Break Test
2026-03-01
**10:00**
Jan Kowalski
This sentence is split
across multiple lines
for no good reason.
And this is a second sentence.
"""


async def test_line_break_joining(tmp_path, monkeypatch) -> None:
    """Test that unnecessary line breaks within a speaker's text are joined."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "breaks.md"
    conv_file.write_text(CONVERSATION_WITH_LINE_BREAKS, encoding="utf-8")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    sentences = data["statements"][0]["sentences"]
    assert len(sentences) == 2
    assert "split across multiple lines for no good reason" in sentences[0]


CONVERSATION_NO_TITLE = """\
2026-02-19
**14:00**
Speaker1
Hello world.
"""


async def test_missing_title_asks_user(tmp_path, monkeypatch) -> None:
    """Test that missing title triggers LLM callback to ask the user."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "no_title.md"
    conv_file.write_text(CONVERSATION_NO_TITLE, encoding="utf-8")

    callback = _make_sampling_callback("Weekly Standup")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True, sampling_callback=callback
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    assert data["title"] == "Weekly Standup"
    assert data["date"] == "2026-02-19 14:00"


CONVERSATION_NO_DATE = """\
# Some Meeting
**08:30**
Speaker1
Good morning everyone.
"""


async def test_missing_date_asks_user(tmp_path, monkeypatch) -> None:
    """Test that missing date triggers LLM callback to ask the user."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "no_date.md"
    conv_file.write_text(CONVERSATION_NO_DATE, encoding="utf-8")

    callback = _make_sampling_callback("2026-03-15")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True, sampling_callback=callback
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    assert data["title"] == "Some Meeting"
    assert data["date"] == "2026-03-15 08:30"


CONVERSATION_WITH_WINDOWS_ENDINGS = (
    "# Test\r\n2026-01-01\r\n**10:00**\r\nSpeaker1\r\nHello world.\r\n"
)


async def test_windows_line_endings(tmp_path, monkeypatch) -> None:
    """Test that Windows line endings are normalized."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "windows.md"
    conv_file.write_bytes(CONVERSATION_WITH_WINDOWS_ENDINGS.encode("utf-8"))

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    assert data["title"] == "Test"
    assert len(data["statements"]) == 1


async def test_file_not_found(tmp_path, monkeypatch) -> None:
    """Test that a missing file raises an error through MCP."""
    monkeypatch.chdir(tmp_path)

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": "/nonexistent/file.md"}
        )

    assert result.isError


async def test_empty_file(tmp_path, monkeypatch) -> None:
    """Test that an empty file raises an error through MCP."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "empty.md"
    conv_file.write_text("", encoding="utf-8")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )

    assert result.isError


CONVERSATION_ENCODING_ARTIFACTS = """\
# Encoding Test
2026-01-01
**11:00**
Speaker1
The meeting\u2014scheduled for today\u2014went well.
He said \u201chello\u201d to everyone.
"""


async def test_encoding_artifact_cleanup(tmp_path, monkeypatch) -> None:
    """Test that smart quotes and em dashes are normalized."""
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "encoding.md"
    conv_file.write_text(CONVERSATION_ENCODING_ARTIFACTS, encoding="utf-8")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    all_text = " ".join(
        s for stmt in data["statements"] for s in stmt["sentences"]
    )
    assert "\u2014" not in all_text
    assert "\u201c" not in all_text
    assert "\u201d" not in all_text


async def test_sentence_splitting_with_abbreviations(tmp_path, monkeypatch) -> None:
    """Test that abbreviations like Dr. or e.g. don't cause false splits."""
    monkeypatch.chdir(tmp_path)
    conversation = """\
# Abbreviation Test
2026-01-01
**10:00**
Speaker1
Dr. Smith arrived at 9 A.M. He started the meeting immediately.
"""
    conv_file = tmp_path / "abbrev.md"
    conv_file.write_text(conversation, encoding="utf-8")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    sentences = data["statements"][0]["sentences"]
    assert len(sentences) == 2
    assert "Dr. Smith" in sentences[0]


async def test_tool_is_listed(tmp_path, monkeypatch) -> None:
    """Test that the clean_conversation_file tool is registered and discoverable."""
    monkeypatch.chdir(tmp_path)
    async with create_connected_server_and_client_session(noesis_server) as client:
        result = await client.list_tools()
        tools = result.tools

        clean_tool = next(
            (t for t in tools if t.name == "clean_conversation_file"), None
        )
        assert clean_tool is not None
        assert clean_tool.inputSchema is not None
        assert "file_path" in clean_tool.inputSchema["properties"]


async def test_capitalization_after_period(tmp_path, monkeypatch) -> None:
    """Test that lowercase letters after sentence-ending punctuation are capitalized."""
    monkeypatch.chdir(tmp_path)
    conversation = """\
# Cap Test
2026-01-01
**10:00**
Speaker1
First sentence. second sentence. third one here.
"""
    conv_file = tmp_path / "cap.md"
    conv_file.write_text(conversation, encoding="utf-8")

    async with create_connected_server_and_client_session(
        noesis_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "clean_conversation_file", {"file_path": str(conv_file)}
        )
        data = json.loads(result.content[0].text)

    sentences = data["statements"][0]["sentences"]
    for sentence in sentences:
        assert sentence[0].isupper(), f"Sentence should start with uppercase: {sentence}"
