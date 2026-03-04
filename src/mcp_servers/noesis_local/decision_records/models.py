"""Response models and internal cache for decision record extraction."""

from dataclasses import dataclass, field

from pydantic import BaseModel, Field


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
