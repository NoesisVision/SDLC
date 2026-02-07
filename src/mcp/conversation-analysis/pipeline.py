"""
Main orchestrator for the conversation analysis pipeline.

This module coordinates all 5 phases of the analysis:
1. Ingestion: Parse and split transcript
2. Segmentation: Detect topic boundaries
3. Classification: IBIS categorization and term extraction
4. Refinement: Standardize terms and merge topics
5. Graph Construction: Build knowledge graph
"""

from datetime import datetime
from typing import Any, Dict

from mcp.server.fastmcp import Context

from .capabilities.classification.ibis_classifier import classify_topics_ibis
from .capabilities.classification.term_extractor import aggregate_terms
from .capabilities.graph.builder import GraphBuilder
from .capabilities.ingestion.cleaner import extract_speaker_turns
from .capabilities.ingestion.splitter import SentenceSplitter
from .capabilities.refinement.term_standardizer import standardize_domain_terms
from .capabilities.refinement.topic_merger import refine_topics
from .capabilities.segmentation.embedder import SentenceEmbedder
from .capabilities.segmentation.valley_detector import segment_by_valleys
from .models import ConversationAnalysisState
from .types import AnalyzeConversationResponse


class ConversationPipeline:
    """
    Orchestrates the 5-phase conversation analysis pipeline.

    Coordinates all phases from ingestion through graph construction,
    maintaining state and handling errors gracefully.
    """

    def __init__(
        self,
        nlp: Any,
        embedder: SentenceEmbedder,
        graph: Any,
        ctx: Context,
    ) -> None:
        """
        Initialize the pipeline with required resources.

        Args:
            nlp: Spacy NLP model
            embedder: Sentence embedding model
            graph: FalkorDB graph connection
            ctx: MCP Context for LLM sampling
        """
        self.nlp = nlp
        self.embedder = embedder
        self.graph = graph
        self.ctx = ctx

        # Initialize components
        self.splitter = SentenceSplitter()
        self.graph_builder = GraphBuilder(graph)

    async def run_phase_1_ingestion(self, state: ConversationAnalysisState) -> None:
        """
        Phase 1: Parse transcript and split into sentences.

        Deterministic processing using regex and spacy.

        Args:
            state: Conversation analysis state to update
        """
        state.current_phase = "ingestion"
        state.phase_timestamps["ingestion"] = {"start": datetime.now().isoformat()}

        # Extract speaker turns
        turns = extract_speaker_turns(state.raw_transcript)

        # Split turns into sentences
        state.sentences = self.splitter.split_turns(turns)

        state.phase_timestamps["ingestion"]["end"] = datetime.now().isoformat()
        state.phase_timestamps["ingestion"]["status"] = "success"

    async def run_phase_2_segmentation(self, state: ConversationAnalysisState) -> None:
        """
        Phase 2: Segment sentences into topics using embeddings.

        Vector-based processing using sentence-transformers.

        Args:
            state: Conversation analysis state to update
        """
        state.current_phase = "segmentation"
        state.phase_timestamps["segmentation"] = {"start": datetime.now().isoformat()}

        # Generate embeddings for all sentences
        embeddings = self.embedder.embed_sentences(state.sentences)

        # Detect topic boundaries
        state.potential_topics = segment_by_valleys(state.sentences, embeddings, use_max_min=True)

        state.phase_timestamps["segmentation"]["end"] = datetime.now().isoformat()
        state.phase_timestamps["segmentation"]["status"] = "success"

    async def run_phase_3_classification(self, state: ConversationAnalysisState) -> None:
        """
        Phase 3: Classify sentences using IBIS and extract terms.

        LLM-based processing via MCP Sampling.

        Args:
            state: Conversation analysis state to update
        """
        state.current_phase = "classification"
        state.phase_timestamps["classification"] = {"start": datetime.now().isoformat()}

        # Classify topics with IBIS and extract terms
        ibis_categories, sentence_terms = await classify_topics_ibis(
            state.potential_topics, self.ctx
        )

        state.ibis_categories = ibis_categories

        # Aggregate terms into DomainTerm objects
        state.domain_terms = aggregate_terms(sentence_terms)

        # Store sentence_terms for Phase 4
        state._sentence_terms = sentence_terms  # type: ignore

        state.phase_timestamps["classification"]["end"] = datetime.now().isoformat()
        state.phase_timestamps["classification"]["status"] = "success"

    async def run_phase_4_refinement(self, state: ConversationAnalysisState) -> None:
        """
        Phase 4: Standardize terms and refine topics.

        Neuro-symbolic processing combining LLM and rule-based logic.

        Args:
            state: Conversation analysis state to update
        """
        state.current_phase = "refinement"
        state.phase_timestamps["refinement"] = {"start": datetime.now().isoformat()}

        # Standardize domain terms
        state.domain_terms = await standardize_domain_terms(state.domain_terms, self.ctx)

        # Refine topics with hierarchies
        sentence_terms = getattr(state, "_sentence_terms", {})
        state.real_topics = await refine_topics(
            state.potential_topics, state.domain_terms, sentence_terms, self.ctx
        )

        state.phase_timestamps["refinement"]["end"] = datetime.now().isoformat()
        state.phase_timestamps["refinement"]["status"] = "success"

    async def run_phase_5_graph(self, state: ConversationAnalysisState) -> Dict[str, int]:
        """
        Phase 5: Build knowledge graph in FalkorDB.

        Deterministic graph construction using Cypher queries.

        Args:
            state: Conversation analysis state to update

        Returns:
            Dict with node and relationship counts
        """
        state.current_phase = "graph"
        state.phase_timestamps["graph"] = {"start": datetime.now().isoformat()}

        # Build graph
        stats = self.graph_builder.build_graph(state)

        state.phase_timestamps["graph"]["end"] = datetime.now().isoformat()
        state.phase_timestamps["graph"]["status"] = "success"

        return stats

    async def analyze(
        self,
        transcript: str,
        conversation_id: str,
        confidence_threshold: float = 0.5,
    ) -> AnalyzeConversationResponse:
        """
        Run the complete 5-phase analysis pipeline.

        Args:
            transcript: Raw transcript text
            conversation_id: Unique conversation identifier
            confidence_threshold: Threshold for LLM augmentation (currently unused)

        Returns:
            AnalyzeConversationResponse with statistics
        """
        # Initialize state
        state = ConversationAnalysisState(
            conversation_id=conversation_id, raw_transcript=transcript
        )

        try:
            # Phase 1: Ingestion
            await self.run_phase_1_ingestion(state)

            # Phase 2: Segmentation
            await self.run_phase_2_segmentation(state)

            # Phase 3: Classification
            await self.run_phase_3_classification(state)

            # Phase 4: Refinement
            await self.run_phase_4_refinement(state)

            # Phase 5: Graph Construction
            graph_stats = await self.run_phase_5_graph(state)

            # Build response
            response = AnalyzeConversationResponse(
                conversation_id=conversation_id,
                sentences_processed=len(state.sentences),
                topics_identified=len(state.real_topics),
                issues_count=len([c for c in state.ibis_categories if c.category == "Issue"]),
                positions_count=len([c for c in state.ibis_categories if c.category == "Position"]),
                arguments_count=len([c for c in state.ibis_categories if c.category == "Argument"]),
                domain_terms_count=len(state.domain_terms),
                graph_nodes_created=graph_stats["nodes_created"],
                graph_relationships_created=graph_stats["relationships_created"],
            )

            return response

        except Exception as e:
            # Log error and re-raise with context
            raise RuntimeError(f"Pipeline failed in phase '{state.current_phase}': {str(e)}") from e
