"""
Graph construction functions for building the conversation knowledge graph.

This module provides functions to populate the FalkorDB graph with nodes
and relationships from the conversation analysis results.
"""

from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID

from ...models import (
    ConversationAnalysisState,
    DomainTerm,
    IBISCategory,
    RealTopic,
    Sentence,
)
from . import schema


class GraphBuilder:
    """
    Builds the conversation knowledge graph in FalkorDB.

    Executes Cypher queries to create nodes and relationships based on
    the analysis results from all 5 phases.
    """

    def __init__(self, graph: Any) -> None:
        """
        Initialize the builder with a FalkorDB graph connection.

        Args:
            graph: FalkorDB graph object
        """
        self.graph = graph

    def create_conversation_node(self, conversation_id: str) -> None:
        """
        Create the root Conversation node.

        Args:
            conversation_id: Unique conversation identifier
        """
        self.graph.query(
            schema.CREATE_CONVERSATION_NODE,
            {
                "conversation_id": conversation_id,
                "created_at": datetime.now().isoformat(),
            },
        )

    def create_sentence_nodes(self, sentences: List[Sentence], conversation_id: str) -> None:
        """
        Create Sentence nodes and link them to the Conversation and Person nodes.

        Args:
            sentences: List of Sentence objects
            conversation_id: Conversation identifier
        """
        # Track unique speakers
        speakers = set()

        for sentence in sentences:
            sentence_id_str = str(sentence.id)

            # Create Sentence node
            self.graph.query(
                schema.CREATE_SENTENCE_NODE,
                {
                    "sentence_id": sentence_id_str,
                    "text": sentence.text,
                    "timestamp": sentence.timestamp,
                    "sequence_index": sentence.sequence_index,
                },
            )

            # Create Person node if first time seeing this speaker
            if sentence.speaker not in speakers:
                self.graph.query(schema.CREATE_PERSON_NODE, {"name": sentence.speaker})
                speakers.add(sentence.speaker)

                # Link Person to Conversation
                self.graph.query(
                    schema.CREATE_CONVERSATION_ATTENDED_BY_PERSON,
                    {
                        "conversation_id": conversation_id,
                        "person_name": sentence.speaker,
                    },
                )

            # Link Sentence to Conversation
            self.graph.query(
                schema.CREATE_CONVERSATION_CONTAINS_SENTENCE,
                {
                    "conversation_id": conversation_id,
                    "sentence_id": sentence_id_str,
                },
            )

            # Link Person to Sentence
            self.graph.query(
                schema.CREATE_PERSON_SPOKE_SENTENCE,
                {
                    "person_name": sentence.speaker,
                    "sentence_id": sentence_id_str,
                },
            )

    def create_topic_nodes(self, topics: List[RealTopic]) -> None:
        """
        Create Topic nodes and their hierarchies.

        Args:
            topics: List of RealTopic objects
        """
        for topic in topics:
            topic_id_str = str(topic.id)

            # Create Topic node
            self.graph.query(
                schema.CREATE_TOPIC_NODE,
                {
                    "topic_id": topic_id_str,
                    "name": topic.name,
                },
            )

            # Create parent-child relationships
            if topic.parent_topic_id:
                self.graph.query(
                    schema.CREATE_TOPIC_PARENT_OF_TOPIC,
                    {
                        "parent_id": str(topic.parent_topic_id),
                        "child_id": topic_id_str,
                    },
                )

    def create_domain_term_nodes(self, domain_terms: List[DomainTerm]) -> None:
        """
        Create DomainTerm nodes.

        Args:
            domain_terms: List of DomainTerm objects
        """
        for term_obj in domain_terms:
            self.graph.query(
                schema.CREATE_DOMAIN_TERM_NODE,
                {
                    "term": term_obj.term,
                    "standardized_term": term_obj.standardized_term or term_obj.term,
                },
            )

    def link_topics_to_terms(self, topics: List[RealTopic]) -> None:
        """
        Create relationships between Topics and DomainTerms.

        Args:
            topics: List of RealTopic objects
        """
        for topic in topics:
            topic_id_str = str(topic.id)

            for term in topic.domain_terms:
                self.graph.query(
                    schema.CREATE_TOPIC_RELATES_TO_DOMAIN_TERM,
                    {
                        "topic_id": topic_id_str,
                        "term": term,
                    },
                )

    def create_ibis_nodes(
        self, ibis_categories: List[IBISCategory], topics: List[RealTopic]
    ) -> None:
        """
        Create IBIS category nodes (Issue, Position, Argument) and link them.

        Args:
            ibis_categories: List of IBISCategory objects
            topics: List of RealTopic objects for linking
        """
        # Build sentence-to-topic mapping
        sentence_to_topic: Dict[UUID, UUID] = {}
        for topic in topics:
            for sentence_id in topic.sentence_ids:
                sentence_to_topic[sentence_id] = topic.id

        for ibis in ibis_categories:
            sentence_id_str = str(ibis.sentence_id)
            category = ibis.category

            if category == "Issue":
                issue_id = f"issue-{ibis.sentence_id}"
                self.graph.query(
                    schema.CREATE_ISSUE_NODE,
                    {
                        "issue_id": issue_id,
                        "sentence_id": sentence_id_str,
                    },
                )
                self.graph.query(
                    schema.CREATE_ISSUE_DEFINED_IN_SENTENCE,
                    {
                        "issue_id": issue_id,
                        "sentence_id": sentence_id_str,
                    },
                )

                # Link to topic if available
                if ibis.sentence_id in sentence_to_topic:
                    topic_id = str(sentence_to_topic[ibis.sentence_id])
                    self.graph.query(
                        schema.CREATE_TOPIC_HAS_ISSUE,
                        {
                            "topic_id": topic_id,
                            "issue_id": issue_id,
                        },
                    )

            elif category == "Position":
                position_id = f"position-{ibis.sentence_id}"
                self.graph.query(
                    schema.CREATE_POSITION_NODE,
                    {
                        "position_id": position_id,
                        "sentence_id": sentence_id_str,
                    },
                )
                self.graph.query(
                    schema.CREATE_POSITION_STATED_IN_SENTENCE,
                    {
                        "position_id": position_id,
                        "sentence_id": sentence_id_str,
                    },
                )

                # Link to topic if available
                if ibis.sentence_id in sentence_to_topic:
                    topic_id = str(sentence_to_topic[ibis.sentence_id])
                    self.graph.query(
                        schema.CREATE_TOPIC_HAS_POSITION,
                        {
                            "topic_id": topic_id,
                            "position_id": position_id,
                        },
                    )

            elif category == "Argument":
                argument_id = f"argument-{ibis.sentence_id}"
                self.graph.query(
                    schema.CREATE_ARGUMENT_NODE,
                    {
                        "argument_id": argument_id,
                        "sentence_id": sentence_id_str,
                    },
                )
                self.graph.query(
                    schema.CREATE_ARGUMENT_EVIDENCED_BY_SENTENCE,
                    {
                        "argument_id": argument_id,
                        "sentence_id": sentence_id_str,
                    },
                )

                # Link to topic if available
                if ibis.sentence_id in sentence_to_topic:
                    topic_id = str(sentence_to_topic[ibis.sentence_id])
                    self.graph.query(
                        schema.CREATE_TOPIC_HAS_ARGUMENT,
                        {
                            "topic_id": topic_id,
                            "argument_id": argument_id,
                        },
                    )

    def build_graph(self, state: ConversationAnalysisState) -> Dict[str, int]:
        """
        Build the complete conversation graph from analysis state.

        Args:
            state: Complete conversation analysis state

        Returns:
            Dictionary with counts of nodes and relationships created
        """
        # Create root conversation node
        self.create_conversation_node(state.conversation_id)

        # Create sentence nodes and link to conversation/people
        self.create_sentence_nodes(state.sentences, state.conversation_id)

        # Create topic nodes and hierarchies
        self.create_topic_nodes(state.real_topics)

        # Create domain term nodes
        self.create_domain_term_nodes(state.domain_terms)

        # Link topics to terms
        self.link_topics_to_terms(state.real_topics)

        # Create IBIS nodes and link them
        self.create_ibis_nodes(state.ibis_categories, state.real_topics)

        # Count nodes and relationships
        stats = {
            "nodes_created": (
                1  # Conversation
                + len(state.sentences)
                + len(set(s.speaker for s in state.sentences))  # Unique speakers
                + len(state.real_topics)
                + len(state.domain_terms)
                + len(state.ibis_categories)  # IBIS nodes
            ),
            "relationships_created": (
                len(state.sentences) * 2  # CONTAINS + SPOKE
                + len(set(s.speaker for s in state.sentences))  # ATTENDED_BY
                + len(state.real_topics) * len(state.domain_terms)  # Topic-Term links (approx)
                + len([t for t in state.real_topics if t.parent_topic_id])  # Parent-child
                + len(state.ibis_categories) * 2  # IBIS + sentence links
            ),
        }

        return stats
