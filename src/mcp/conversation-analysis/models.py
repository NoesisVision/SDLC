"""
Data models for conversation analysis.

This module contains dataclasses representing the internal data structures
used throughout the conversation analysis pipeline.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID, uuid4


@dataclass
class Sentence:
    """
    Atomic unit of conversation.

    Represents a single sentence extracted from the transcript with metadata
    about its speaker, timing, and position in the conversation.
    """

    id: UUID = field(default_factory=uuid4)
    text: str = ""
    speaker: str = ""
    timestamp: str = ""  # Original format from transcript (e.g., "09:00 AM")
    sequence_index: int = 0


@dataclass
class PotentialTopic:
    """
    Semantically coherent group of sentences identified by vector similarity.

    Represents a preliminary topic grouping based on embedding similarity
    before LLM-based refinement and standardization.
    """

    id: UUID = field(default_factory=uuid4)
    sentences: List[Sentence] = field(default_factory=list)
    start_index: int = 0
    end_index: int = 0
    embedding: Optional[List[float]] = None  # Average embedding of sentences


@dataclass
class IBISCategory:
    """
    IBIS (Issue-Based Information System) categorization result.

    Categorizes a sentence according to the IBIS framework:
    - Issue: Question or problem statement
    - Position: Proposed solution or idea
    - Argument: Reasoning, pro, or con
    - Statement: Neutral statement (default)
    """

    sentence_id: UUID = field(default_factory=uuid4)
    category: Literal["Issue", "Position", "Argument", "Statement"] = "Statement"
    confidence: Optional[float] = None


@dataclass
class DomainTerm:
    """
    Extracted domain-specific terminology.

    Represents a term identified in the conversation with references
    to sentences where it appears. Can be standardized later.
    """

    term: str = ""
    sentence_ids: List[UUID] = field(default_factory=list)
    standardized_term: Optional[str] = None  # Set in Phase 4: Refinement


@dataclass
class RealTopic:
    """
    Refined, hierarchical topic with standardized terminology.

    Final topic structure after LLM-based refinement, merging,
    and hierarchy formation.
    """

    id: UUID = field(default_factory=uuid4)
    name: str = ""
    sentence_ids: List[UUID] = field(default_factory=list)
    domain_terms: List[str] = field(default_factory=list)
    parent_topic_id: Optional[UUID] = None
    child_topic_ids: List[UUID] = field(default_factory=list)


@dataclass
class ConversationAnalysisState:
    """
    Complete state of conversation analysis across all phases.

    Maintains the full pipeline state including intermediate and final results
    from all 5 phases. Supports incremental processing and checkpointing.
    """

    conversation_id: str = ""
    raw_transcript: str = ""

    # Phase outputs
    sentences: List[Sentence] = field(default_factory=list)
    potential_topics: List[PotentialTopic] = field(default_factory=list)
    ibis_categories: List[IBISCategory] = field(default_factory=list)
    domain_terms: List[DomainTerm] = field(default_factory=list)
    real_topics: List[RealTopic] = field(default_factory=list)

    # Metadata
    current_phase: str = "not_started"
    phase_timestamps: dict = field(default_factory=dict)
