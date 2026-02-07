"""
Pydantic models for MCP API boundaries.

This module contains Pydantic models used for request/response validation
at the MCP API boundaries following the CLAUDE.md guidelines.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class AnalyzeConversationRequest(BaseModel):
    """Request to analyze a complete conversation transcript."""

    transcript: str = Field(
        ..., description="Raw transcript text in **{Time}**\\n{Speaker}\\n{Text} format"
    )
    conversation_id: str = Field(..., description="Unique identifier for this conversation")
    confidence_threshold: float = Field(
        default=0.5,
        description="Threshold for LLM augmentation in segmentation (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )


class AnalyzeConversationResponse(BaseModel):
    """Response after analyzing a conversation with statistics."""

    conversation_id: str
    sentences_processed: int = Field(..., description="Number of sentences extracted")
    topics_identified: int = Field(..., description="Number of final topics identified")
    issues_count: int = Field(..., description="Number of Issues (IBIS)")
    positions_count: int = Field(..., description="Number of Positions (IBIS)")
    arguments_count: int = Field(..., description="Number of Arguments (IBIS)")
    domain_terms_count: int = Field(..., description="Number of unique domain terms")
    graph_nodes_created: int = Field(..., description="Total nodes created in graph")
    graph_relationships_created: int = Field(
        ..., description="Total relationships created in graph"
    )


class IncrementalAnalysisRequest(BaseModel):
    """Request to run a specific analysis phase incrementally."""

    phase: Literal["ingestion", "segmentation", "classification", "refinement", "graph"] = Field(
        ..., description="Analysis phase to execute"
    )
    conversation_id: str = Field(..., description="Conversation identifier")
    input_data: Optional[dict] = Field(
        None, description="Input data for the phase (if resuming from previous state)"
    )


class IncrementalAnalysisResponse(BaseModel):
    """Response from incremental analysis containing phase-specific results."""

    conversation_id: str
    phase: str
    status: Literal["success", "failed", "partial"]
    results: dict = Field(..., description="Phase-specific results")
    error_message: Optional[str] = None


class QueryConversationRequest(BaseModel):
    """Request to query the conversation graph with Cypher."""

    conversation_id: str = Field(..., description="Conversation identifier to query")
    cypher_query: str = Field(
        ..., description="Cypher query to execute against the conversation graph"
    )


class QueryConversationResponse(BaseModel):
    """Response from graph query containing results."""

    conversation_id: str
    results: List[dict] = Field(..., description="Query results as list of dictionaries")
    row_count: int = Field(..., description="Number of rows returned")
