"""
Term standardization using LLM.

This module consolidates term variants (synonyms, abbreviations, typos)
into standardized canonical forms using LLM analysis.
"""

import json
from typing import Dict, List

from mcp.server.fastmcp import Context
from mcp.types import SamplingMessage, TextContent

from ...models import DomainTerm
from ...prompts import TERM_STANDARDIZATION_PROMPT, format_terms_for_standardization


def parse_standardization_response(response_text: str) -> Dict[str, str]:
    """
    Parse JSON response from LLM into term mappings.

    Expected format:
    [
        {"original": "Py", "standardized": "Python"},
        {"original": "DB", "standardized": "Database"}
    ]

    Args:
        response_text: Raw LLM response text

    Returns:
        Dict mapping original term to standardized term

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

    if not isinstance(parsed, list):
        raise ValueError(f"Expected list, got {type(parsed)}")

    # Convert to dict
    standardization_map = {}
    for item in parsed:
        original = item.get("original", "").strip().lower()
        standardized = item.get("standardized", "").strip().lower()
        if original and standardized:
            standardization_map[original] = standardized

    return standardization_map


async def standardize_terms_with_llm(
    domain_terms: List[DomainTerm], ctx: Context, max_retries: int = 3
) -> Dict[str, str]:
    """
    Standardize terms using LLM via MCP Sampling.

    Args:
        domain_terms: List of DomainTerm objects
        ctx: MCP Context for sampling
        max_retries: Maximum retry attempts

    Returns:
        Dict mapping original term to standardized term

    Raises:
        RuntimeError: If standardization fails after retries
    """
    # Get term frequencies
    terms_with_counts = {term.term: len(term.sentence_ids) for term in domain_terms}

    # Format for LLM
    formatted_terms = format_terms_for_standardization(terms_with_counts)

    # Create prompt
    prompt = TERM_STANDARDIZATION_PROMPT.format(terms_with_counts=formatted_terms)

    # Try standardization with retries
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
            standardization_map = parse_standardization_response(response_text)

            return standardization_map

        except (json.JSONDecodeError, ValueError) as e:
            if attempt == max_retries - 1:
                raise RuntimeError(f"Failed to standardize terms after {max_retries} attempts: {e}")

            # Add clearer instructions for next retry
            prompt += "\n\nIMPORTANT: Return ONLY valid JSON array, no markdown, no explanations."

    # Should not reach here
    raise RuntimeError("Term standardization failed unexpectedly")


def apply_standardization(
    domain_terms: List[DomainTerm], standardization_map: Dict[str, str]
) -> List[DomainTerm]:
    """
    Apply standardization mapping to domain terms.

    Updates the standardized_term field for each DomainTerm based on the mapping.

    Args:
        domain_terms: List of DomainTerm objects
        standardization_map: Dict mapping original to standardized terms

    Returns:
        Updated list of DomainTerm objects
    """
    for term in domain_terms:
        normalized_term = term.term.strip().lower()

        # Check if term needs standardization
        if normalized_term in standardization_map:
            term.standardized_term = standardization_map[normalized_term]
        else:
            # Use original term as standardized if no mapping found
            term.standardized_term = term.term

    return domain_terms


async def standardize_domain_terms(
    domain_terms: List[DomainTerm], ctx: Context
) -> List[DomainTerm]:
    """
    Standardize domain terms using LLM.

    Main entry point for Phase 4 term standardization.

    Args:
        domain_terms: List of DomainTerm objects
        ctx: MCP Context for LLM sampling

    Returns:
        Updated list of DomainTerm objects with standardized terms
    """
    if not domain_terms:
        return domain_terms

    # Get standardization mapping from LLM
    standardization_map = await standardize_terms_with_llm(domain_terms, ctx)

    # Apply standardization
    standardized_terms = apply_standardization(domain_terms, standardization_map)

    return standardized_terms
