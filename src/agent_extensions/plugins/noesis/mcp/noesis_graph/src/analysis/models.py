"""Data models for the analysis layer."""

from pydantic import BaseModel, Field

_CHARS_PER_TOKEN = 4


def estimate_token_count(text: str) -> int:
    """Estimate token count using character-based heuristic."""
    return len(text) // _CHARS_PER_TOKEN


# --- Turn Batching ---


class BatchTurn(BaseModel):
    """A speaker turn within a batch."""

    order: int = Field(description="Turn order in the conversation (0-based)")
    speaker: str = Field(description="Speaker name")
    time: str = Field(description="Turn time in HH:MM:SS format")
    text: str = Field(description="Full turn text (sentences joined)")


class GetNextTurnBatchResponse(BaseModel):
    """Response from get_next_turn_batch."""

    primary_turns: list[BatchTurn] = Field(description="Turns for idea unit extraction")
    lookahead_turns: list[BatchTurn] = Field(description="Read-only context turns")
    has_more: bool = Field(description="Whether more turns remain after this batch")


# --- Topic Management ---


class TopicInput(BaseModel):
    """Input for creating a single topic."""

    title: str = Field(description="Topic title")
    parent_topic_id: str | None = Field(default=None, description="Parent topic UUID")
    sort_order: int = Field(default=0, description="Ordering among siblings")


class TopicCreated(BaseModel):
    """Result of creating a single topic."""

    topic_id: str = Field(description="Generated UUID for the topic")
    title: str = Field(description="Topic title")


class CreateTopicsResponse(BaseModel):
    """Response from create_topics."""

    topics: list[TopicCreated] = Field(description="Created topics with IDs")


# --- Idea Unit Storage ---


class IdeaUnitInput(BaseModel):
    """Input for storing a single idea unit."""

    turn_order: int = Field(description="Order of the source turn in the conversation")
    sequence_in_turn: int = Field(description="Position within the turn (0-based)")
    text: str = Field(description="Idea unit text")
    sentence_indices: list[int] = Field(description="Indices into the turn's sentences array")
    categories: list[str] = Field(
        description="One or more of: Information, Position, Argument, Decision, NotRelevant"
    )
    topic_id: str = Field(description="UUID of the assigned topic")


class StoreIdeaUnitsResponse(BaseModel):
    """Response from store_idea_units."""

    count: int = Field(description="Number of idea units stored")


# --- Decision Storage ---


class AlternativeInput(BaseModel):
    """A rejected alternative in a decision."""

    option: str = Field(description="Description of the alternative")
    rationale_against: str = Field(description="Why this alternative was rejected")


class DecisionInput(BaseModel):
    """Input for storing a single decision."""

    title: str = Field(description="Decision title")
    context: str = Field(description="Situation or problem that prompted this decision")
    decision: str = Field(description="What was decided")
    rationale: str = Field(description="Why this option was chosen")
    consequences: str = Field(description="Expected impact, trade-offs, risks")
    alternatives: list[AlternativeInput] = Field(
        default_factory=list, description="Rejected alternatives"
    )
    status: str = Field(description="'taken' or 'proposed'")
    topic_id: str = Field(description="UUID of the related topic")
    conversation_id: str = Field(description="UUID of the source conversation")
    supporting_idea_unit_ids: list[str] = Field(
        default_factory=list, description="IDs of supporting idea units"
    )
    opposing_idea_unit_ids: list[str] = Field(
        default_factory=list, description="IDs of opposing idea units"
    )
    supersedes_decision_id: str | None = Field(
        default=None, description="ID of the decision this supersedes"
    )


class DecisionCreated(BaseModel):
    """Result of creating a single decision."""

    decision_id: str = Field(description="Generated UUID for the decision")


class StoreDecisionsResponse(BaseModel):
    """Response from store_decisions."""

    decisions: list[DecisionCreated] = Field(description="Created decisions with IDs")


# --- Cross-References ---


class CrossReferenceInput(BaseModel):
    """Input for creating a single cross-reference."""

    from_topic_id: str = Field(description="Source topic UUID")
    to_topic_id: str = Field(description="Target topic UUID")
    type: str = Field(
        description="Relationship type: depends_on, contradicts, refines, supersedes, related_to"
    )
    description: str = Field(description="Description of the relationship")
    source_conversation_id: str = Field(description="Conversation that revealed this relationship")


class CreateCrossReferencesResponse(BaseModel):
    """Response from create_cross_references."""

    count: int = Field(description="Number of cross-references created")


# --- Summaries ---


class TopicSummaryInput(BaseModel):
    """Input for setting a single topic summary."""

    topic_id: str = Field(description="Topic UUID")
    summary: str = Field(description="Updated summary text")


class ConversationSummaryInput(BaseModel):
    """Input for setting a conversation summary."""

    conversation_id: str = Field(description="Conversation UUID")
    summary: str = Field(description="Conversation summary text")


class SetSummariesResponse(BaseModel):
    """Response from set_summaries."""

    status: str = Field(description="'success'")


# --- Context Retrieval ---


class TopicNode(BaseModel):
    """A topic node returned by get_topic_nodes."""

    topic_id: str = Field(description="Topic UUID")
    title: str = Field(description="Topic title")
    summary: str | None = Field(default=None, description="Topic summary")
    children_count: int = Field(description="Number of direct children")
    sort_order: int = Field(description="Ordering among siblings")


class GetTopicNodesResponse(BaseModel):
    """Response from get_topic_nodes."""

    topics: list[TopicNode] = Field(description="Topic nodes at the requested level")


class TopicRef(BaseModel):
    """A lightweight topic reference."""

    topic_id: str = Field(description="Topic UUID")
    title: str = Field(description="Topic title")


class GetTopicsWithCategoriesResponse(BaseModel):
    """Response from get_topics_with_categories."""

    topics: list[TopicRef] = Field(
        description="Topics that have idea units with the requested categories"
    )


class IdeaUnitDetail(BaseModel):
    """An idea unit with turn context."""

    idea_unit_id: str = Field(description="Idea unit UUID")
    text: str = Field(description="Idea unit text")
    categories: list[str] = Field(description="Idea unit categories")
    speaker: str = Field(description="Speaker name from the source turn")
    time: str = Field(description="Turn time in HH:MM:SS format")
    turn_order: int = Field(description="Turn order in the conversation")


class GetTopicIdeaUnitsResponse(BaseModel):
    """Response from get_topic_idea_units."""

    idea_units: list[IdeaUnitDetail] = Field(description="Idea units for the topic")


class DecisionDetail(BaseModel):
    """A decision with context."""

    decision_id: str = Field(description="Decision UUID")
    title: str = Field(description="Decision title")
    context: str = Field(description="Situation that prompted this decision")
    decision: str = Field(description="What was decided")
    rationale: str = Field(description="Why this option was chosen")
    consequences: str = Field(description="Expected impact, trade-offs, risks")
    alternatives: list[AlternativeInput] = Field(description="Rejected alternatives")
    status: str = Field(description="'taken' or 'proposed'")
    topic_title: str = Field(description="Title of the related topic")
    conversation_title: str = Field(description="Title of the source conversation")


class GetDecisionsResponse(BaseModel):
    """Response from get_decisions."""

    decisions: list[DecisionDetail] = Field(description="Decisions matching the query")


# --- Restructuring ---


class MergeTopicsResponse(BaseModel):
    """Response from merge_topics."""

    moved_idea_units: int = Field(description="Number of idea units reassigned")
    moved_decisions: int = Field(description="Number of decisions reassigned")
    moved_cross_refs: int = Field(description="Number of cross-references reassigned")


class ReparentTopicResponse(BaseModel):
    """Response from reparent_topic."""

    status: str = Field(description="'success'")


class ReorderTopicResponse(BaseModel):
    """Response from reorder_topic."""

    status: str = Field(description="'success'")


# --- Finalization ---


class StructuralWarning(BaseModel):
    """A topic with too many children, flagging a potential split."""

    topic_id: str = Field(description="Topic UUID")
    title: str = Field(description="Topic title")
    children_count: int = Field(description="Number of direct children")


class FinalizeConversationResponse(BaseModel):
    """Response from finalize_conversation."""

    status: str = Field(description="'success' or 'error'")
    topics_updated: int = Field(
        default=0, description="Number of topics with recomputed token counts"
    )
    structural_warnings: list[StructuralWarning] = Field(
        default_factory=list,
        description="Topics with >7 children that may need splitting",
    )
    reason: str | None = Field(
        default=None, description="Error reason if status is 'error'"
    )


# --- Retrieval ---


class TopicTreeNode(BaseModel):
    """A topic node in the tree with children."""

    topic_id: str = Field(description="Topic UUID")
    title: str = Field(description="Topic title")
    summary: str | None = Field(default=None, description="Topic summary")
    sort_order: int = Field(description="Ordering among siblings")
    children: list["TopicTreeNode"] = Field(default_factory=list, description="Child topics")


class GetTopicTreeResponse(BaseModel):
    """Response from get_topic_tree."""

    topics: list[TopicTreeNode] = Field(description="Root-level topics with nested children")


class TopicDetailResponse(BaseModel):
    """Response from get_topic_detail."""

    topic_id: str = Field(description="Topic UUID")
    title: str = Field(description="Topic title")
    summary: str | None = Field(default=None, description="Topic summary")
    idea_unit_counts_by_category: dict[str, int] = Field(
        description="Count of idea units per category"
    )
    decisions: list[DecisionDetail] = Field(description="Decisions for this topic")
    cross_references: list[CrossReferenceInput] = Field(
        description="Cross-references involving this topic"
    )
    conversations: list[str] = Field(description="Conversation titles that contributed")


class TopicHistoryEntry(BaseModel):
    """A conversation's contribution to a topic."""

    conversation_id: str = Field(description="Conversation UUID")
    title: str = Field(description="Conversation title")
    date: str = Field(description="Conversation date")
    idea_unit_count: int = Field(description="Number of idea units from this conversation")


class GetTopicHistoryResponse(BaseModel):
    """Response from get_topic_history."""

    entries: list[TopicHistoryEntry] = Field(description="Conversations that touched this topic")


class DecisionChainEntry(BaseModel):
    """A decision in the supersession chain."""

    decision_id: str = Field(description="Decision UUID")
    title: str = Field(description="Decision title")
    decision: str = Field(description="What was decided")
    status: str = Field(description="'taken' or 'proposed'")
    conversation_title: str = Field(description="Source conversation title")


class GetDecisionChainResponse(BaseModel):
    """Response from get_decision_chain."""

    chain: list[DecisionChainEntry] = Field(
        description="Ordered supersession chain (newest first)"
    )


class SearchResultItem(BaseModel):
    """A single search result."""

    idea_unit_id: str = Field(description="Idea unit UUID")
    text: str = Field(description="Idea unit text")
    categories: list[str] = Field(description="Idea unit categories")
    topic_title: str = Field(description="Title of the assigned topic")
    speaker: str = Field(description="Speaker name")
    time: str = Field(description="Turn time")
    conversation_title: str = Field(description="Source conversation title")


class SearchResponse(BaseModel):
    """Response from search."""

    results: list[SearchResultItem] = Field(description="Matching idea units")


class ConversationSummaryResponse(BaseModel):
    """Response from get_conversation_summary."""

    conversation_id: str = Field(description="Conversation UUID")
    title: str = Field(description="Conversation title")
    date: str = Field(description="Conversation date")
    summary: str | None = Field(default=None, description="Conversation summary")
    topics_touched: list[str] = Field(description="Titles of topics with idea units")


# --- Export ---


class ExportConversationDocumentResponse(BaseModel):
    """Response from export_conversation_document."""

    status: str = Field(description="'success'")
    topics_count: int = Field(description="Number of topics included in the document")
    decisions_count: int = Field(description="Number of decisions included in the document")
    output_path: str = Field(description="Path where the document was saved")


# --- Batch Pipeline ---


class BatchIdeaUnit(BaseModel):
    """An idea unit from batch analysis, before topic resolution."""

    turn_order: int = Field(description="Order of the source turn in the conversation")
    sequence_in_turn: int = Field(description="Position within the turn (0-based)")
    text: str = Field(description="Idea unit text (original language)")
    sentence_indices: list[int] = Field(description="Indices into the turn's sentences array")
    categories: list[str] = Field(
        description="One or more of: Information, Position, Argument, Decision, NotRelevant"
    )
    preliminary_topic: str = Field(description="Short descriptive topic label from batch analysis")
    parent_topic_hint: str = Field(
        description="'existing:<topic_id>' if matching an existing topic, or 'new'"
    )


class PreliminaryTopic(BaseModel):
    """A preliminary topic identified during batch analysis."""

    title: str = Field(description="Topic title (English)")
    parent: str = Field(description="'existing:<topic_id>' or 'new'")
    summary_hint: str = Field(description="Brief summary of the topic content")


class StoreBatchResultsResponse(BaseModel):
    """Response from store_batch_results."""

    batch_number: int = Field(description="Batch number that was stored")
    idea_unit_count: int = Field(description="Number of idea units in this batch")
    preliminary_topic_count: int = Field(description="Number of preliminary topics in this batch")


class SimilarityGroup(BaseModel):
    """A group of preliminary topics that likely refer to the same subject.

    Detected by turn-overlap heuristic: topics whose idea units come
    from largely the same turns are likely duplicates.
    """

    titles: list[str] = Field(description="Preliminary topic titles in this group")
    shared_turn_count: int = Field(description="Number of turns shared by all topics in the group")


class GetBatchResultsResponse(BaseModel):
    """Response from get_batch_results."""

    preliminary_topics: list[PreliminaryTopic] = Field(
        description="Deduplicated preliminary topics across all batches"
    )
    similarity_groups: list[SimilarityGroup] = Field(
        default_factory=list,
        description="Groups of preliminary topics that may be duplicates (by turn overlap)",
    )
    active_state_json: str = Field(description="Active state JSON from the last batch")
    last_primary_turn_order: int = Field(description="Last turn order from the last batch")
    has_more: bool = Field(description="Whether more turns remain after the last batch")
    total_batches: int = Field(description="Number of batches stored")
    idea_units: list[BatchIdeaUnit] | None = Field(
        default=None,
        description="All idea units across batches. Only populated when summary_only=False.",
    )


class GetLatestBatchStateResponse(BaseModel):
    """Response from get_latest_batch_state."""

    batch_number: int = Field(description="Most recent batch number")
    active_state_json: str = Field(description="Active state JSON from the latest batch")
    last_primary_turn_order: int = Field(description="Last turn order from the latest batch")
    has_more: bool = Field(description="Whether more turns remain after the latest batch")


class TopicMappingEntry(BaseModel):
    """Maps a preliminary topic name to a resolved topic_id."""

    preliminary_topic: str = Field(description="Preliminary topic title from batch analysis")
    topic_id: str = Field(description="UUID of the resolved topic")


class StoreReviewerResultResponse(BaseModel):
    """Response from store_reviewer_result."""

    status: str = Field(description="'success'")


class ResolveAndStoreIdeaUnitsResponse(BaseModel):
    """Response from resolve_and_store_idea_units."""

    stored_count: int = Field(description="Number of idea units stored")
    skipped_not_relevant: int = Field(description="Number of NotRelevant-only units skipped")
    unresolved_topics: list[str] = Field(
        description="Preliminary topic titles that could not be resolved"
    )
