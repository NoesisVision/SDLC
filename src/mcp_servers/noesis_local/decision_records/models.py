"""Data models and internal cache for decision record extraction."""

import uuid
from dataclasses import dataclass, field
from enum import Enum

from pydantic import BaseModel, Field



class DesignConcern(str, Enum):
    """Category of design concern that a decision affects."""

    BUSINESS_RULE = "BusinessRule"
    DOMAIN_MODEL = "DomainModel"
    QUALITY_ATTRIBUTE = "QualityAttribute"
    TECHNOLOGY = "Technology"
    INFRASTRUCTURE = "Infrastructure"
    OTHER = "Other"


class AlternativeDecisionOption(BaseModel):
    """Option that was considered but not chosen."""

    description: str = Field(description="What the option entails")
    rejection_rationale: str = Field(description="Why this option was not chosen")


class ChosenDecisionOption(BaseModel):
    """Option that was ultimately selected."""

    description: str = Field(description="What was decided")
    rationale: str = Field(description="Why this option was chosen")
    consequences: str = Field(
        description="Expected outcomes and trade-offs of this decision"
    )


class DecisionRecord(BaseModel):
    """Decision record extracted from a conversation topic.

    Used for FalkorDB storage and API contracts. Source conversation and topic
    are expressed via graph relationships, not fields on this model.
    """

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier (UUID v4)",
    )
    context: str = Field(
        description="Problem description synthesized from Issue-category idea units"
    )
    decision: ChosenDecisionOption = Field(
        description="Chosen path with reasoning from Decision and Argument-category idea units"
    )
    alternative_options: list[AlternativeDecisionOption] = Field(
        description="Alternatives considered from Position-category idea units"
    )
    design_concerns: list[DesignConcern] = Field(
        description="Design concern categories affected by this decision"
    )


class TopicOverview(BaseModel):
    """Lightweight topic summary for listing purposes."""

    index: int = Field(description="Zero-based topic index")
    name: str = Field(description="Short topic name")
    summary: str = Field(description="1-3 sentence topic description")


class GetConversationTopicsResponse(BaseModel):
    """Response from get_conversation_topics."""

    conversation_title: str = Field(description="Title of the conversation")
    topic_count: int = Field(description="Number of topics in the conversation")
    topics: list[TopicOverview] = Field(description="Overview of each topic")


class GetTopicDataResponse(BaseModel):
    """Response from get_topic_data."""

    topic_name: str = Field(description="Short topic name")
    topic_summary: str = Field(description="1-3 sentence topic description")
    statements: str = Field(
        description="JSON array of {speaker, time, idea_units[{sentences, category}]}"
    )


class StoreDecisionRecordResponse(BaseModel):
    """Response from store_decision_record."""

    status: str = Field(description="'success' or 'skipped'")
    output_path: str | None = Field(
        default=None, description="Path to the written markdown file"
    )


@dataclass
class LoadedConversation:
    """In-memory cache entry for a loaded structured conversation."""

    title: str
    source_stem: str
    topics: list[dict] = field(default_factory=list)
