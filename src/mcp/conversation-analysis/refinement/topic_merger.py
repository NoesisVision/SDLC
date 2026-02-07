"""
Topic merging and hierarchy formation using LLM.

This module consolidates PotentialTopics into RealTopics with hierarchical
relationships and merged adjacent topics based on term overlap.
"""

import json
from typing import Any, Dict, List, Set, Tuple
from uuid import UUID, uuid4

from mcp.server.fastmcp import Context
from mcp.types import SamplingMessage, TextContent

from ...models import DomainTerm, PotentialTopic, RealTopic
from ...prompts import TOPIC_HIERARCHY_PROMPT, format_topics_for_hierarchy


def extract_topic_terms(
    potential_topics: List[PotentialTopic], sentence_terms: Dict[UUID, List[str]]
) -> List[Dict[str, Any]]:
    """
    Extract terms for each topic from sentence-level terms.

    Args:
        potential_topics: List of PotentialTopic objects
        sentence_terms: Dict mapping sentence UUID to list of terms

    Returns:
        List of dicts with 'id' and 'terms' keys
    """
    topics_with_terms = []

    for topic in potential_topics:
        # Collect all terms from sentences in this topic
        topic_terms: Set[str] = set()

        for sentence in topic.sentences:
            if sentence.id in sentence_terms:
                topic_terms.update(sentence_terms[sentence.id])

        topics_with_terms.append(
            {
                "id": str(topic.id),
                "terms": list(topic_terms),
            }
        )

    return topics_with_terms


def parse_hierarchy_response(response_text: str) -> Dict[str, Any]:
    """
    Parse JSON response from LLM into hierarchy structure.

    Expected format:
    {
        "merges": [["topic-id-1", "topic-id-2"]],
        "hierarchies": [{"parent": "topic-id-3", "children": ["topic-id-4"]}],
        "renamed": {"topic-id-5": "New Name"}
    }

    Args:
        response_text: Raw LLM response text

    Returns:
        Parsed hierarchy structure

    Raises:
        ValueError: If JSON is invalid
    """
    # Clean up response
    response_text = response_text.strip()

    # Remove markdown code blocks if present
    if response_text.startswith("```json"):
        response_text = response_text[7:]
    elif response_text.startswith("```"):
        response_text = response_text[3:]

    if response_text.endswith("```"):
        response_text = response_text[:-3]

    response_text = response_text.strip()

    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse JSON response: {e}\nResponse: {response_text[:200]}")

    if not isinstance(parsed, dict):
        raise ValueError(f"Expected dict, got {type(parsed)}")

    # Ensure all expected keys exist
    result = {
        "merges": parsed.get("merges", []),
        "hierarchies": parsed.get("hierarchies", []),
        "renamed": parsed.get("renamed", {}),
    }

    return result


async def get_topic_hierarchy_with_llm(
    topics_with_terms: List[Dict[str, Any]], ctx: Context, max_retries: int = 3
) -> Dict[str, Any]:
    """
    Get topic hierarchy and merges using LLM via MCP Sampling.

    Args:
        topics_with_terms: List of dicts with topic IDs and terms
        ctx: MCP Context for sampling
        max_retries: Maximum retry attempts

    Returns:
        Dict with 'merges', 'hierarchies', and 'renamed' keys

    Raises:
        RuntimeError: If hierarchy detection fails after retries
    """
    # Format for LLM
    formatted_topics = format_topics_for_hierarchy(topics_with_terms)

    # Create prompt
    prompt = TOPIC_HIERARCHY_PROMPT.format(topics_with_terms=formatted_topics)

    # Try hierarchy detection with retries
    for attempt in range(max_retries):
        try:
            # Call LLM via MCP Sampling
            result = await ctx.session.create_message(
                messages=[
                    SamplingMessage(
                        role="user",
                        content=TextContent(type="text", text=prompt),
                    )
                ],
                max_tokens=2000,
                temperature=0.1,
            )

            # Extract text from response
            response_text = result.content.text

            # Parse JSON response
            hierarchy = parse_hierarchy_response(response_text)

            return hierarchy

        except (json.JSONDecodeError, ValueError) as e:
            if attempt == max_retries - 1:
                raise RuntimeError(f"Failed to detect hierarchy after {max_retries} attempts: {e}")

            # Add clearer instructions for next retry
            prompt += "\n\nIMPORTANT: Return ONLY valid JSON object, no markdown, no explanations."

    # Should not reach here
    raise RuntimeError("Topic hierarchy detection failed unexpectedly")


def merge_potential_topics(
    potential_topics: List[PotentialTopic],
    merges: List[List[str]],
    domain_terms: List[DomainTerm],
    sentence_terms: Dict[UUID, List[str]],
) -> List[RealTopic]:
    """
    Merge PotentialTopics based on LLM suggestions.

    Args:
        potential_topics: List of PotentialTopic objects
        merges: List of merge groups (each group is a list of topic IDs)
        domain_terms: List of DomainTerm objects
        sentence_terms: Dict mapping sentence UUID to list of terms

    Returns:
        List of RealTopic objects
    """
    # Create mapping from ID to PotentialTopic
    topic_map = {str(t.id): t for t in potential_topics}

    # Track which topics have been merged
    merged_ids: Set[str] = set()

    real_topics: List[RealTopic] = []

    # Process merges
    for merge_group in merges:
        if len(merge_group) < 2:
            continue

        # Collect all sentences and terms from merged topics
        merged_sentences = []
        merged_terms: Set[str] = set()

        for topic_id in merge_group:
            if topic_id in topic_map:
                topic = topic_map[topic_id]
                merged_sentences.extend(topic.sentences)

                # Collect terms
                for sentence in topic.sentences:
                    if sentence.id in sentence_terms:
                        merged_terms.update(sentence_terms[sentence.id])

                merged_ids.add(topic_id)

        # Create RealTopic from merged topics
        if merged_sentences:
            # Generate name from dominant terms
            term_frequencies = {}
            for term in merged_terms:
                # Find corresponding DomainTerm
                matching_terms = [dt for dt in domain_terms if dt.term == term]
                if matching_terms:
                    term_frequencies[term] = len(matching_terms[0].sentence_ids)
                else:
                    term_frequencies[term] = 1

            # Get top 3 terms for name
            top_terms = sorted(term_frequencies.items(), key=lambda x: x[1], reverse=True)[:3]
            topic_name = ", ".join([t[0].title() for t, _ in top_terms])

            real_topic = RealTopic(
                name=topic_name,
                sentence_ids=[s.id for s in merged_sentences],
                domain_terms=list(merged_terms),
            )
            real_topics.append(real_topic)

    # Convert remaining unmerged topics to RealTopics
    for topic in potential_topics:
        topic_id_str = str(topic.id)

        if topic_id_str not in merged_ids:
            # Extract terms for this topic
            topic_terms: Set[str] = set()
            for sentence in topic.sentences:
                if sentence.id in sentence_terms:
                    topic_terms.update(sentence_terms[sentence.id])

            # Generate name from terms
            if topic_terms:
                topic_name = ", ".join(list(topic_terms)[:3])
            else:
                topic_name = f"Topic {len(real_topics) + 1}"

            real_topic = RealTopic(
                name=topic_name.title(),
                sentence_ids=[s.id for s in topic.sentences],
                domain_terms=list(topic_terms),
            )
            real_topics.append(real_topic)

    return real_topics


def apply_hierarchies(
    real_topics: List[RealTopic], hierarchies: List[Dict[str, Any]]
) -> List[RealTopic]:
    """
    Apply parent-child relationships to RealTopics.

    Args:
        real_topics: List of RealTopic objects
        hierarchies: List of hierarchy specifications

    Returns:
        Updated list of RealTopic objects with parent-child relationships
    """
    # Create mapping from topic name/ID to RealTopic
    # (Since we may have renamed topics, this is a best-effort match)

    for hierarchy in hierarchies:
        parent_id = hierarchy.get("parent")
        child_ids = hierarchy.get("children", [])

        # Find parent topic (simplified matching by checking if ID substring is in topic)
        parent_topic = None
        for topic in real_topics:
            if str(topic.id).startswith(parent_id[:8]):  # Match first 8 chars of UUID
                parent_topic = topic
                break

        if not parent_topic:
            continue

        # Find child topics
        for child_id in child_ids:
            for topic in real_topics:
                if str(topic.id).startswith(child_id[:8]):
                    topic.parent_topic_id = parent_topic.id
                    parent_topic.child_topic_ids.append(topic.id)
                    break

    return real_topics


async def refine_topics(
    potential_topics: List[PotentialTopic],
    domain_terms: List[DomainTerm],
    sentence_terms: Dict[UUID, List[str]],
    ctx: Context,
) -> List[RealTopic]:
    """
    Refine PotentialTopics into RealTopics with hierarchies.

    Main entry point for Phase 4 topic refinement.

    Args:
        potential_topics: List of PotentialTopic objects
        domain_terms: List of DomainTerm objects
        sentence_terms: Dict mapping sentence UUID to list of terms
        ctx: MCP Context for LLM sampling

    Returns:
        List of RealTopic objects with hierarchies
    """
    if not potential_topics:
        return []

    # Extract terms for each topic
    topics_with_terms = extract_topic_terms(potential_topics, sentence_terms)

    # Get hierarchy and merges from LLM
    hierarchy_data = await get_topic_hierarchy_with_llm(topics_with_terms, ctx)

    # Merge topics based on LLM suggestions
    real_topics = merge_potential_topics(
        potential_topics,
        hierarchy_data["merges"],
        domain_terms,
        sentence_terms,
    )

    # Apply hierarchies
    real_topics = apply_hierarchies(real_topics, hierarchy_data["hierarchies"])

    # Apply renames if any
    renamed = hierarchy_data.get("renamed", {})
    for topic in real_topics:
        topic_id_str = str(topic.id)
        if topic_id_str in renamed:
            topic.name = renamed[topic_id_str]

    return real_topics
