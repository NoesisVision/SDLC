"""Shared test helpers for extract_decisions skill tests."""

import json

from models import IdeaUnit, StructuredConversation, Topic


def make_idea_unit(turn_id, speaker, time, sentences, category="Position"):
    """Build an idea-unit dict suitable for passing to write_structured."""
    return {
        "turn_id": turn_id,
        "speaker": speaker,
        "time": time,
        "sentences": sentences,
        "category": category,
    }


def write_structured(path, topics):
    """Serialize a StructuredConversation with the given topics to *path*."""
    prepared = []
    for t in topics:
        topic = dict(t)
        if "idea_units" in topic:
            topic["idea_units"] = [IdeaUnit(**iu) for iu in topic["idea_units"]]
        prepared.append(Topic(**topic))
    structured = StructuredConversation(
        conversation_id="test-conv-id",
        title="Test Conversation",
        date="2025-03-01 14:00",
        topics=prepared,
    )
    path.write_text(json.dumps(structured.model_dump()), encoding="utf-8")
