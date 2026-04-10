"""Shared domain types for conversation analysis."""

from enum import StrEnum

from pydantic import BaseModel


class IdeaUnitCategory(StrEnum):
    """Classification categories for idea units in a conversation."""

    Information = "Information"
    Position = "Position"
    Argument = "Argument"
    Decision = "Decision"
    Irrelevant = "Irrelevant"


class IdeaUnit(BaseModel):
    index: int
    sentences: list[str]
    categories: list[IdeaUnitCategory]


class Turn(BaseModel):
    index: int
    speaker: str
    time: str
    idea_units: list[IdeaUnit]


class IdeaUnitRef(BaseModel):
    conversation_id: str
    turn_index: int
    idea_unit_index: int


class Topic(BaseModel):
    id: str
    title: str
    short_summary: str
    long_summary: str
    idea_units: list[IdeaUnitRef]
    subtopics: list["Topic"]
    reviewed: bool = False
    decisions_extracted: bool = False


class PotentialTopic(BaseModel):
    id: str
    title: str
    short_summary: str
    path: list[str]
    is_new: bool = False
    parent_id: str | None = None


class PotentialTopics(BaseModel):
    topics: list[PotentialTopic]


class DecisionContext(BaseModel):
    text: str
    supporting_idea_units: list[IdeaUnitRef]


class DecisionOption(BaseModel):
    text: str
    rationale: str
    supporting_idea_units: list[IdeaUnitRef]


class Decision(BaseModel):
    title: str
    status: str
    context: DecisionContext
    decision: DecisionOption
    alternative_options: list[DecisionOption]


class Conversation(BaseModel):
    conversation_id: str
    time: str
    main_topic: str
    turns: list[Turn]
    topics: list[Topic]
    decisions: list[Decision]


class IdeaUnitDetail(BaseModel):
    turn_index: int
    idea_unit_index: int
    speaker: str
    time: str
    sentences: list[str]
    categories: list[IdeaUnitCategory]


class EnrichedTopic(BaseModel):
    id: str
    title: str
    short_summary: str
    long_summary: str
    idea_units: list[IdeaUnitDetail]
