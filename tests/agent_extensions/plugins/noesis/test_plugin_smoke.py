"""Smoke test for the noesis plugin in Claude Code CLI.

Launches Claude Code with the noesis plugin directory and verifies
that the plugin is loaded, skills are registered, and all noesis-graph
MCP tools are available.
"""

import json
import subprocess
from pathlib import Path

import pytest

_SDLC_ROOT = Path(__file__).resolve().parents[4]
_PLUGIN_DIR = _SDLC_ROOT / "src" / "agent_extensions" / "plugins" / "noesis"

_EXPECTED_MCP_TOOLS = [
    "create_cross_references",
    "create_topics",
    "export_conversation_document",
    "finalize_conversation",
    "get_conversation_summary",
    "get_decision_chain",
    "get_decisions",
    "get_next_turn_batch",
    "get_raw_speaker_turns",
    "get_topic_detail",
    "get_topic_history",
    "get_topic_idea_units",
    "get_topic_nodes",
    "get_topic_tree",
    "merge_topics",
    "register_conversation",
    "reorder_topic",
    "reparent_topic",
    "search",
    "set_conversation_metadata",
    "set_summaries",
    "store_decisions",
    "store_idea_units",
]

_EXPECTED_SKILLS = [
    "noesis:analyze-conversation",
]

_EXPECTED_AGENTS = [
    "noesis:batch_analyzer",
    "noesis:decision_writer",
    "noesis:topic_reviewer",
]


def _get_init_message() -> dict:
    """Launch Claude CLI with noesis plugin and return the init system message."""
    result = subprocess.run(
        [
            "claude",
            "-p",
            "respond with just the word OK",
            "--plugin-dir",
            str(_PLUGIN_DIR),
            "--output-format",
            "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
            "--no-session-persistence",
            "--max-budget-usd",
            "0.15",
        ],
        capture_output=True,
        text=True,
        cwd=str(_SDLC_ROOT),
        timeout=120,
    )
    assert result.returncode == 0, (
        f"Claude CLI failed (exit {result.returncode}):\nstderr: {result.stderr}"
    )

    for line in result.stdout.strip().splitlines():
        msg = json.loads(line)
        if msg.get("type") == "system" and msg.get("subtype") == "init":
            return msg

    pytest.fail("No init system message found in stream-json output")


@pytest.fixture(scope="module")
def init_message() -> dict:
    return _get_init_message()


@pytest.mark.e2e
class TestNoesisPluginSmoke:
    """Verify the noesis plugin loads correctly in Claude Code CLI."""

    def test_plugin_registered(self, init_message: dict) -> None:
        """Plugin appears in the plugins list."""
        plugin_names = [p["name"] for p in init_message["plugins"]]
        assert "noesis" in plugin_names

    def test_mcp_server_connected(self, init_message: dict) -> None:
        """The noesis-graph MCP server connects successfully."""
        servers = {s["name"]: s["status"] for s in init_message["mcp_servers"]}
        assert "plugin:noesis:noesis-graph" in servers
        assert servers["plugin:noesis:noesis-graph"] == "connected"

    def test_all_mcp_tools_available(self, init_message: dict) -> None:
        """All expected noesis-graph MCP tools are registered."""
        noesis_tools = {
            t.removeprefix("mcp__plugin_noesis_noesis-graph__")
            for t in init_message["tools"]
            if t.startswith("mcp__plugin_noesis_noesis-graph__")
        }
        missing = set(_EXPECTED_MCP_TOOLS) - noesis_tools
        unexpected = noesis_tools - set(_EXPECTED_MCP_TOOLS)
        assert not missing, f"Missing MCP tools: {sorted(missing)}"
        assert not unexpected, f"Unexpected MCP tools: {sorted(unexpected)}"

    def test_skills_available(self, init_message: dict) -> None:
        """All expected noesis skills are registered."""
        skills = set(init_message["skills"])
        missing = set(_EXPECTED_SKILLS) - skills
        assert not missing, f"Missing skills: {sorted(missing)}"

    def test_agents_available(self, init_message: dict) -> None:
        """All expected noesis agents are registered."""
        agents = set(init_message["agents"])
        missing = set(_EXPECTED_AGENTS) - agents
        assert not missing, f"Missing agents: {sorted(missing)}"
