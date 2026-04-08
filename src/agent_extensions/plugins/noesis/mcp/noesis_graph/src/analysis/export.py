"""Export tool for generating conversation summary documents.

Queries the knowledge graph for topics and decisions related to a conversation,
then writes a structured markdown document to disk.
"""

import json
import logging
from pathlib import Path

from redislite.falkordb_client import Graph

from noesis_graph.analysis.models import AlternativeInput, ExportConversationDocumentResponse

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def export_conversation_document(
    conversation_id: str,
    output_path: str,
) -> ExportConversationDocumentResponse:
    """Export a markdown document summarizing topics and decisions from a conversation.

    Generates a structured document listing all topics mentioned or modified
    in the conversation (with full ancestor paths and descriptions) and all
    decisions made during the conversation (with full ADR data).

    Args:
        conversation_id: UUID of the conversation to export.
        output_path: File path where the markdown document will be saved.

    Returns:
        Export status with counts of topics and decisions included.
    """
    graph = _require_graph()

    conversation = _fetch_conversation(graph, conversation_id)
    topics = _fetch_conversation_topics(graph, conversation_id)
    enriched_topics = [
        _enrich_topic_with_path(graph, topic) for topic in topics
    ]
    decisions = _fetch_conversation_decisions(graph, conversation_id)

    markdown = _render_document(conversation, enriched_topics, decisions)
    _write_document(output_path, markdown)

    return ExportConversationDocumentResponse(
        status="success",
        topics_count=len(enriched_topics),
        decisions_count=len(decisions),
        output_path=output_path,
    )


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _fetch_conversation(graph: Graph, conversation_id: str) -> dict:
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        " RETURN c.conversation_id, c.title, c.date, c.summary",
        params={"cid": conversation_id},
    )
    if not result.result_set:
        raise KeyError(f"Unknown conversation_id: {conversation_id}")
    row = result.result_set[0]
    return {
        "conversation_id": row[0],
        "title": row[1],
        "date": row[2],
        "summary": row[3],
    }


def _fetch_conversation_topics(graph: Graph, conversation_id: str) -> list[dict]:
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_RAW_TURN]->(turn:RawSpeakerTurn)"
        "-[:CONTAINS]->(iu:IdeaUnit)-[:BELONGS_TO]->(t:Topic)"
        " RETURN DISTINCT t.topic_id, t.title, t.summary"
        " ORDER BY t.title",
        params={"cid": conversation_id},
    )
    return [
        {"topic_id": row[0], "title": row[1], "summary": row[2]}
        for row in result.result_set
    ]


def _enrich_topic_with_path(graph: Graph, topic: dict) -> dict:
    ancestors = _fetch_ancestor_chain(graph, topic["topic_id"])
    full_path = " - ".join(ancestors + [topic["title"]])
    return {**topic, "full_path": full_path}


def _fetch_ancestor_chain(graph: Graph, topic_id: str) -> list[str]:
    ancestors: list[str] = []
    current_id = topic_id

    while True:
        result = graph.query(
            "MATCH (t:Topic {topic_id: $tid})-[:SUBTOPIC_OF]->(p:Topic)"
            " RETURN p.topic_id, p.title",
            params={"tid": current_id},
        )
        if not result.result_set:
            break
        current_id = result.result_set[0][0]
        ancestors.append(result.result_set[0][1])

    ancestors.reverse()
    return ancestors


def _fetch_conversation_decisions(graph: Graph, conversation_id: str) -> list[dict]:
    result = graph.query(
        "MATCH (d:Decision)-[:MADE_IN]->(c:RawConversation {conversation_id: $cid}),"
        " (d)-[:ABOUT]->(t:Topic)"
        " RETURN d.decision_id, d.title, d.context, d.decision,"
        " d.rationale, d.consequences, d.alternatives, d.status,"
        " t.title"
        " ORDER BY t.title, d.title",
        params={"cid": conversation_id},
    )
    return [_row_to_decision(row) for row in result.result_set]


def _row_to_decision(row: list) -> dict:
    alternatives_raw = row[6]
    if isinstance(alternatives_raw, str):
        alternatives = [
            AlternativeInput(**alt) for alt in json.loads(alternatives_raw)
        ]
    else:
        alternatives = []

    return {
        "decision_id": row[0],
        "title": row[1],
        "context": row[2],
        "decision": row[3],
        "rationale": row[4],
        "consequences": row[5],
        "alternatives": alternatives,
        "status": row[7],
        "topic_title": row[8],
    }


def _render_document(
    conversation: dict,
    topics: list[dict],
    decisions: list[dict],
) -> str:
    lines: list[str] = []

    _render_header(lines, conversation)
    _render_topics_section(lines, topics)
    _render_decisions_section(lines, decisions)

    return "\n".join(lines) + "\n"


def _render_header(lines: list[str], conversation: dict) -> None:
    lines.append(f"# {conversation['title']}")
    lines.append("")
    if conversation["date"]:
        lines.append(f"**Date:** {conversation['date']}")
        lines.append("")
    if conversation["summary"]:
        lines.append(conversation["summary"])
        lines.append("")


def _render_topics_section(lines: list[str], topics: list[dict]) -> None:
    lines.append("## Topics")
    lines.append("")

    if not topics:
        lines.append("No topics found for this conversation.")
        lines.append("")
        return

    for topic in topics:
        lines.append(f"### {topic['full_path']}")
        lines.append("")
        if topic["summary"]:
            lines.append(topic["summary"])
        else:
            lines.append("*No summary available.*")
        lines.append("")


def _render_decisions_section(lines: list[str], decisions: list[dict]) -> None:
    lines.append("## Decisions")
    lines.append("")

    if not decisions:
        lines.append("No decisions recorded for this conversation.")
        lines.append("")
        return

    for decision in decisions:
        _render_single_decision(lines, decision)


def _render_single_decision(lines: list[str], decision: dict) -> None:
    lines.append(f"### {decision['title']}")
    lines.append("")
    lines.append(f"**Status:** {decision['status']}")
    lines.append("")
    lines.append(f"**Topic:** {decision['topic_title']}")
    lines.append("")

    lines.append("**Context:**")
    lines.append("")
    lines.append(decision["context"])
    lines.append("")

    lines.append("**Decision:**")
    lines.append("")
    lines.append(decision["decision"])
    lines.append("")

    lines.append("**Rationale:**")
    lines.append("")
    lines.append(decision["rationale"])
    lines.append("")

    lines.append("**Consequences:**")
    lines.append("")
    lines.append(decision["consequences"])
    lines.append("")

    if decision["alternatives"]:
        lines.append("**Alternatives considered:**")
        lines.append("")
        for alt in decision["alternatives"]:
            lines.append(f"- **{alt.option}** — {alt.rationale_against}")
        lines.append("")


def _write_document(output_path: str, content: str) -> None:
    resolved = Path(output_path).resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(content, encoding="utf-8")
