"""Step-specific I/O DTOs for agent-produced JSON validation."""

from pydantic import BaseModel

from models_core import (
    Decision,
    IdeaUnitRef,
    PotentialTopic,
    Turn,
)


class IdeaUnitTopicAssignment(BaseModel):
    turn_index: int
    idea_unit_index: int
    topic_id: str


class ChunkResult(BaseModel):
    turns: list[Turn]
    assignments: list[IdeaUnitTopicAssignment]
    new_topics: list[PotentialTopic]


class IdeaUnitReassignment(BaseModel):
    turn_index: int
    idea_unit_index: int
    new_topic_id: str


class TopicReviewResult(BaseModel):
    topic_id: str
    short_summary: str
    long_summary: str
    reassignments: list[IdeaUnitReassignment]
    new_topics: list[PotentialTopic]


class DecisionExtractionResult(BaseModel):
    topic_id: str
    decisions: list[Decision]
