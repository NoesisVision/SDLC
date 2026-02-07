"""
IBIS classification using LLM via MCP Sampling.

This module categorizes sentences according to the IBIS framework
(Issue, Position, Argument, Statement) using LLM calls through MCP.
"""

import json
from typing import Any, Dict, List, Optional
from uuid import UUID

from mcp.server.fastmcp import Context
from mcp.types import SamplingMessage, TextContent

from ...models import IBISCategory, PotentialTopic, Sentence
from ...prompts import IBIS_CLASSIFICATION_PROMPT, format_topics_for_ibis


def estimate_tokens(text: str) -> int:
    """
    Estimate the number of tokens in text.

    Uses a simple heuristic: ~4 characters per token.

    Args:
        text: Text to estimate

    Returns:
        Estimated token count
    """
    return len(text) // 4


def create_batches(
    potential_topics: List[PotentialTopic], max_tokens_per_batch: int = 6000
) -> List[List[Dict[str, Any]]]:
    """
    Split topics into token-efficient batches for LLM processing.

    Args:
        potential_topics: List of PotentialTopic objects
        max_tokens_per_batch: Maximum tokens per batch

    Returns:
        List of batches, each containing formatted sentence data
    """
    batches: List[List[Dict[str, Any]]] = []
    current_batch: List[Dict[str, Any]] = []
    current_tokens = 0

    for topic in potential_topics:
        for sentence in topic.sentences:
            # Format sentence data
            sentence_data = {
                "id": str(sentence.id),
                "speaker": sentence.speaker,
                "text": sentence.text,
            }

            # Estimate tokens
            estimated_tokens = estimate_tokens(
                f"{sentence_data['id']} {sentence_data['speaker']}: {sentence_data['text']}"
            )

            # Check if adding this sentence would exceed batch size
            if current_tokens + estimated_tokens > max_tokens_per_batch and current_batch:
                batches.append(current_batch)
                current_batch = [sentence_data]
                current_tokens = estimated_tokens
            else:
                current_batch.append(sentence_data)
                current_tokens += estimated_tokens

    # Add final batch
    if current_batch:
        batches.append(current_batch)

    return batches


def parse_ibis_json_response(response_text: str) -> List[Dict[str, Any]]:
    """
    Parse JSON response from LLM into structured data.

    Expected format:
    [
        {"id": "uuid", "category": "Position", "terms": ["Python", "Backend"]},
        ...
    ]

    Args:
        response_text: Raw LLM response text

    Returns:
        Parsed list of classification results

    Raises:
        ValueError: If JSON is invalid or format is incorrect
    """
    # Try to extract JSON from the response
    # Sometimes LLMs wrap JSON in markdown code blocks
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

    if not isinstance(parsed, list):
        raise ValueError(f"Expected list, got {type(parsed)}")

    return parsed


async def classify_batch_with_llm(
    batch: List[Dict[str, Any]], ctx: Context, max_retries: int = 3
) -> List[Dict[str, Any]]:
    """
    Classify a batch of sentences using LLM via MCP Sampling.

    Args:
        batch: List of sentence data dictionaries
        ctx: MCP Context for sampling
        max_retries: Maximum retry attempts

    Returns:
        List of classification results

    Raises:
        RuntimeError: If classification fails after retries
    """
    # Format batch as markdown
    markdown_input = format_topics_for_ibis(batch)

    # Create prompt
    prompt = IBIS_CLASSIFICATION_PROMPT.format(topics=markdown_input)

    # Try classification with retries
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
                max_tokens=4000,
                temperature=0.1,  # Low temperature for consistency
            )

            # Extract text from response
            response_text = result.content.text

            # Parse JSON response
            classifications = parse_ibis_json_response(response_text)

            return classifications

        except (json.JSONDecodeError, ValueError) as e:
            if attempt == max_retries - 1:
                raise RuntimeError(f"Failed to classify batch after {max_retries} attempts: {e}")

            # Add clearer instructions for next retry
            prompt += "\n\nIMPORTANT: Return ONLY valid JSON array, no markdown, no explanations."

    # Should not reach here
    raise RuntimeError("Classification failed unexpectedly")


async def classify_topics_ibis(
    potential_topics: List[PotentialTopic], ctx: Context
) -> tuple[List[IBISCategory], Dict[UUID, List[str]]]:
    """
    Classify all sentences in topics using IBIS framework via LLM.

    Also extracts domain terms for each sentence.

    Args:
        potential_topics: List of PotentialTopic objects
        ctx: MCP Context for LLM sampling

    Returns:
        Tuple of (ibis_categories, sentence_terms_map)
        - ibis_categories: List of IBISCategory objects
        - sentence_terms_map: Dict mapping sentence UUID to list of terms
    """
    # Create batches
    batches = create_batches(potential_topics)

    ibis_categories: List[IBISCategory] = []
    sentence_terms: Dict[UUID, List[str]] = {}

    # Process each batch
    for batch in batches:
        classifications = await classify_batch_with_llm(batch, ctx)

        # Convert to IBISCategory objects
        for item in classifications:
            sentence_id = UUID(item["id"])
            category = item.get("category", "Statement")
            terms = item.get("terms", [])

            # Validate category
            valid_categories = ["Issue", "Position", "Argument", "Statement"]
            if category not in valid_categories:
                category = "Statement"

            # Create IBISCategory
            ibis_cat = IBISCategory(
                sentence_id=sentence_id,
                category=category,  # type: ignore
            )
            ibis_categories.append(ibis_cat)

            # Store terms
            if terms:
                sentence_terms[sentence_id] = terms

    return ibis_categories, sentence_terms
