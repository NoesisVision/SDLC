"""Data structures for the conversation structuring pipeline."""

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

import numpy as np
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


class SpeakerTurn(BaseModel):
    """A single speaker turn in the conversation."""

    speaker: str = Field(description="Name of the speaker")
    time: str = Field(
        description="Time of the statement relative to the beginning of the conversation in HH:MM format"
    )
    sentences: list[str] = Field(description="Individual sentences from the speaker's text")


class ConversationStatus(str, Enum):
    """Pipeline progress status for a conversation."""

    REGISTERED = "REGISTERED"
    NORMALIZED = "NORMALIZED"
    SPEAKER_TURNS_EXTRACTED = "SPEAKER_TURNS_EXTRACTED"
    METADATA_ASSIGNED = "METADATA_ASSIGNED"
    BATCHED = "BATCHED"
    IDEA_UNITS_EXTRACTED = "IDEA_UNITS_EXTRACTED"
    EMBEDDINGS_COMPUTED = "EMBEDDINGS_COMPUTED"
    TOPICS_ASSIGNED = "TOPICS_ASSIGNED"
    FINALIZED = "FINALIZED"



@dataclass
class ExtractionBatch:
    """A single batch of speaker turns prepared for idea-unit extraction."""

    batch_index: int
    turns: str
    expected_turns: list[SpeakerTurn]


@dataclass
class ConversationState:
    """Holds all intermediate state for a single conversation being structured."""

    source_path: Path
    status: ConversationStatus = ConversationStatus.REGISTERED
    normalized_text: str | None = None
    title: str | None = None
    date: str | None = None
    turns: list[SpeakerTurn] | None = None
    batches: list[ExtractionBatch] = field(default_factory=list)
    batch_results: dict[int, list[TurnIdeaUnits]] = field(default_factory=dict)
    idea_units: list[TurnIdeaUnits] | None = None
    embeddings: dict[int, np.ndarray] = field(default_factory=dict)
    assignment_state: dict | None = None
    topics_draft: dict | None = None


class IdeaUnitCategory(str, Enum):
    """Classification categories for idea units in a conversation."""

    Issue = "Issue"
    Position = "Position"
    Argument = "Argument"
    Decision = "Decision"
    Irrelevant = "Irrelevant"


class IdeaUnit(BaseModel):
    """A coherent fragment of a speaker's statement carrying one piece of information."""

    sentences: list[str] = Field(description="Consecutive sentences forming one coherent idea")
    category: IdeaUnitCategory = Field(description="Discourse classification of the idea unit")


class TurnIdeaUnits(BaseModel):
    """A single speaker turn split into idea units."""

    speaker: str = Field(description="Name of the speaker")
    time: str = Field(description="Time of the statement in HH:MM format")
    idea_units: list[IdeaUnit] = Field(description="Idea units extracted from this turn")


# ---------------------------------------------------------------------------
# Response models — registry
# ---------------------------------------------------------------------------


class AddConversationResponse(BaseModel):
    """Response from add_conversation."""

    conversation_id: str = Field(description="UUID identifying the conversation")


# ---------------------------------------------------------------------------
# Response models — cleaning
# ---------------------------------------------------------------------------


class CleanResponse(BaseModel):
    """Response from clean_conversation."""

    status: str = Field(description="'success' or 'incomplete'")
    missing: list[str] = Field(default_factory=list, description="Missing metadata fields")


class SetMetadataResponse(BaseModel):
    """Response from set_conversation_metadata."""

    status: str = Field(description="'success'")


# ---------------------------------------------------------------------------
# Response models — idea unit extraction
# ---------------------------------------------------------------------------


class GetBatchResponse(BaseModel):
    """Response from get_extraction_batch."""

    turns: str = Field(description="JSON array of speaker turns for this batch")
    batch_index: int = Field(description="Index of this batch")


class PrepareBatchesResponse(BaseModel):
    """Response from prepare_extraction_batches."""

    status: str = Field(description="'success'")
    batch_count: int = Field(description="Number of batches created")


class StoreBatchResultResponse(BaseModel):
    """Response from store_extraction_result."""

    status: str = Field(description="'success', 'invalid_json', or 'validation_failed'")
    error_details: str | None = Field(
        default=None,
        description="Actionable description of what went wrong. Present when status is not 'success'.",
    )



# ---------------------------------------------------------------------------
# Response models — topic assignment
# ---------------------------------------------------------------------------


class EmbedResponse(BaseModel):
    """Response from embed_idea_units."""

    status: str = Field(description="'success'")
    embedded_count: int = Field(description="Number of idea units embedded")


class ArbitrationCandidate(BaseModel):
    """A candidate topic for arbitration."""

    topic_id: str = Field(description="Topic identifier")
    score: float = Field(description="Cosine similarity score")
    representative_texts: list[str] = Field(description="Sample texts from this topic")


class ArbitrationRequest(BaseModel):
    """Returned when assignment needs LLM arbitration."""

    fragment: str = Field(description="The idea unit text needing arbitration")
    category: str = Field(description="Idea unit category")
    candidates: list[ArbitrationCandidate] = Field(description="Top candidate topics")


class TopicForLabeling(BaseModel):
    """Lightweight topic data for LLM labeling in Step 7."""

    topic_id: str = Field(description="Topic identifier")
    representative_texts: list[str] = Field(description="Sample texts from this topic")
    categories: list[str] = Field(description="Idea unit categories in this topic")


class AssignResponse(BaseModel):
    """Response from assign_topics or apply_topic_arbitration."""

    status: str = Field(description="'success' or 'arbitration_needed'")
    topic_count: int = Field(default=0, description="Number of topics (when successful)")
    arbitration_request: ArbitrationRequest | None = Field(default=None, description="Present when arbitration needed")
    topics_for_labeling: list[TopicForLabeling] | None = Field(
        default=None, description="Present when status='success'; topic data for LLM labeling"
    )


# ---------------------------------------------------------------------------
# Response models — conversation output
# ---------------------------------------------------------------------------


class TopicStatement(BaseModel):
    """A speaker's contribution to a topic."""

    speaker: str = Field(description="Name of the speaker")
    time: str = Field(description="Time in HH:MM format")
    idea_units: list[IdeaUnit] = Field(description="Idea units from this speaker on this topic")


class Topic(BaseModel):
    """A discussion topic with summary and statements."""

    name: str = Field(description="Short topic name")
    summary: str = Field(description="1-3 sentence description")
    statements: list[TopicStatement] = Field(description="Speaker statements in this topic")


class StructuredConversation(BaseModel):
    """Full structured conversation output."""

    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time in YYYY-MM-DD HH:MM format")
    topics: list[Topic] = Field(description="Topics discussed")


class TopicSummary(BaseModel):
    """Lightweight topic summary."""

    name: str = Field(description="Short topic name")
    summary: str = Field(description="1-3 sentence description")


class FinalizeResponse(BaseModel):
    """Response from finalize_conversation."""

    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time in YYYY-MM-DD HH:MM format")
    topics: list[TopicSummary] = Field(description="Summary of each topic")
    output_path: str = Field(description="Path to the output JSON file")
