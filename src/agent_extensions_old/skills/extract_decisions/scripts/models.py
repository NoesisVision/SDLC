"""Data structures for decision extraction pipeline."""

import re
from enum import StrEnum

from pydantic import BaseModel, Field

CONVERSATION_ID_PATTERN = re.compile(r"^<!--\s*conversation_id:\s*([\w-]+)\s*-->")


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class IdeaUnitCategory(StrEnum):
    """Classification categories for idea units in a conversation."""

    Issue = "Issue"
    Position = "Position"
    Argument = "Argument"
    Decision = "Decision"
    Information = "Information"
    Agreement = "Agreement"
    Irrelevant = "Irrelevant"



class DesignConcern(StrEnum):
    """Design concern categories for decision records."""

    BusinessRule = "BusinessRule"
    DomainModel = "DomainModel"
    QualityAttribute = "QualityAttribute"
    Technology = "Technology"
    Infrastructure = "Infrastructure"
    Other = "Other"


# ---------------------------------------------------------------------------
# Conversation models
# ---------------------------------------------------------------------------


class SpeakerTurn(BaseModel):
    """A single speaker turn in the conversation."""

    turn_id: str | None = Field(default=None, description="Unique turn identifier, assigned after parsing")
    speaker: str = Field(description="Name of the speaker")
    time: str = Field(
        description="Time of the statement relative to the beginning of the conversation in HH:MM:SS format"
    )
    sentences: list[str] = Field(description="Individual sentences from the speaker's text")


class CleanedConversation(BaseModel):
    """Conversation data with normalized text and speaker turns."""

    conversation_id: str = Field(description="UUID identifying the conversation")
    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time in YYYY-MM-DD HH:MM format")
    source_path: str = Field(description="Absolute path to the source file")
    turns: list[SpeakerTurn] = Field(description="Speaker turns in the conversation")


# ---------------------------------------------------------------------------
# Structured conversation models (output format)
# ---------------------------------------------------------------------------


class IdeaUnit(BaseModel):
    """A coherent fragment of a speaker's statement carrying one piece of information."""

    turn_id: str = Field(description="ID of the source turn")
    speaker: str = Field(description="Name of the speaker")
    time: str = Field(description="Time of the speaker turn relative to the beginning of the conversation in HH:MM:SS format")
    sentences: list[str] = Field(description="Consecutive sentences forming one coherent idea")
    category: IdeaUnitCategory = Field(description="Discourse classification of the idea unit")


class Topic(BaseModel):
    """A discussion topic with summary and statements."""

    topic_id: str = Field(description="Unique topic identifier")
    name: str = Field(description="Short topic name, 2-5 words")
    summary: str = Field(description="Dense summary, max 50 tokens")
    description: str = Field(description="Comprehensive description, max 500 tokens")
    idea_units: list[IdeaUnit] = Field(default_factory=list)


class StructuredConversation(BaseModel):
    """Full structured conversation with topics and idea units."""

    conversation_id: str = Field(description="UUID identifying the conversation")
    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time in YYYY-MM-DD HH:MM format")
    topics: list[Topic] = Field(default_factory=list, description="Topics discussed")


# ---------------------------------------------------------------------------
# Batch processing models
# ---------------------------------------------------------------------------


class Batch(BaseModel):
    """A batch of speaker turns for sequential processing."""

    previous_turn: SpeakerTurn | None = Field(default=None, description="Last turn from the previous batch for context")
    extraction_turns: list[SpeakerTurn] = Field(description="Turns to extract topics from in this batch")
    expected_turn_count: int = Field(description="Number of turns expected to be processed")


# ---------------------------------------------------------------------------
# Batch results input models (agent -> save_batch_results)
# ---------------------------------------------------------------------------


class NewTopicInput(BaseModel):
    """Input for creating a new topic."""

    name: str = Field(description="Short topic name")
    summary: str = Field(description="Dense summary, max 50 tokens")
    description: str = Field(description="Comprehensive description, max 500 tokens")
    placeholder_id: str | None = Field(
        default=None, description="Temporary ID used by the agent before real ID assignment"
    )


class UpdatedTopicInput(BaseModel):
    """Input for updating an existing topic's metadata."""

    topic_id: str = Field(description="ID of the topic to update")
    name: str = Field(description="Updated short topic name")
    summary: str = Field(description="Updated dense summary")
    description: str = Field(description="Updated comprehensive description")


class IdeaUnitGroup(BaseModel):
    """A group of idea units to assign to a topic."""

    topic_id: str = Field(description="Target topic ID (may be a placeholder)")
    units: list[IdeaUnit] = Field(description="Idea units to add to the topic")


class BatchResultsInput(BaseModel):
    """Complete batch extraction results from the agent."""

    new_topics: list[NewTopicInput] = Field(default_factory=list)
    updated_topics: list[UpdatedTopicInput] = Field(default_factory=list)
    idea_units: list[IdeaUnitGroup] = Field(default_factory=list)
    discarded_units: list[IdeaUnit] = Field(
        default_factory=list,
        description="Idea units categorized as Irrelevant, not assigned to any topic",
    )


# ---------------------------------------------------------------------------
# Decision record models
# ---------------------------------------------------------------------------


class DecisionDetail(BaseModel):
    """The chosen decision with rationale."""

    description: str = Field(description="What was decided")
    rationale: str = Field(description="Why this option was chosen")
    consequences: str = Field(description="Expected outcomes and trade-offs")


class AlternativeOption(BaseModel):
    """A rejected alternative to the chosen decision."""

    description: str = Field(description="What this alternative entails")
    rejection_rationale: str = Field(description="Why it was not chosen")


class DecisionRecord(BaseModel):
    """A software design decision extracted from a topic."""

    topic_id: str = Field(description="ID of the source topic")
    topic_name: str = Field(description="Name of the source topic")
    context: str = Field(description="Problem description synthesized from Issue-category idea units")
    decision: DecisionDetail = Field(description="The chosen option")
    alternative_options: list[AlternativeOption] = Field(description="Rejected alternatives")
    design_concerns: list[DesignConcern] = Field(description="Applicable design concern categories")
