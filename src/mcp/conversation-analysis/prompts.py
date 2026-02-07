"""
LLM prompt templates for conversation analysis.

This module contains prompt templates used for Phases 3-4 (Classification and Refinement).
All prompts are designed for token efficiency with structured JSON outputs.
"""

# Phase 3: IBIS Classification and Term Extraction
IBIS_CLASSIFICATION_PROMPT = """You are analyzing a meeting transcript to categorize statements using the IBIS framework.

For each sentence below, determine:
1. Category: Issue (question/problem), Position (solution/idea), Argument (reasoning/pro/con), or Statement (default)
2. Domain Terms: Key technical or domain-specific terms (2-5 words max)

Input:
{topics}

Output JSON format:
[
  {{"id": "ID-01", "category": "Position", "terms": ["Python", "Backend"]}},
  {{"id": "ID-02", "category": "Issue", "terms": ["Database", "Scalability"]}}
]

Rules:
- Return ONLY valid JSON, no explanations
- Use exact IDs from input
- Keep terms concise and relevant
- Default to "Statement" if uncertain
- Categories must be: Issue, Position, Argument, or Statement
"""

# Phase 4: Term Standardization
TERM_STANDARDIZATION_PROMPT = """You are standardizing domain terminology from a meeting transcript.

Extracted terms (with frequencies):
{terms_with_counts}

Tasks:
1. Group synonyms/variants (e.g., "Py", "Python 3" → "Python")
2. Fix typos/abbreviations
3. Create standardized canonical forms

Output JSON format:
[
  {{"original": "Py", "standardized": "Python"}},
  {{"original": "Python 3", "standardized": "Python"}},
  {{"original": "DB", "standardized": "Database"}}
]

Rules:
- Return ONLY valid JSON, no explanations
- Preserve technical accuracy
- Use most common/formal variant as standard
- Only include terms that need standardization
"""

# Phase 4: Topic Hierarchy and Merging
TOPIC_HIERARCHY_PROMPT = """You are organizing topics into a hierarchy based on domain terms.

Topics with their terms:
{topics_with_terms}

Tasks:
1. Identify parent-child relationships (e.g., "Backend Architecture" contains "Database Design")
2. Merge adjacent topics with high term overlap (>60%)
3. Suggest topic names based on dominant terms

Output JSON format:
{{
  "merges": [["topic-id-1", "topic-id-2"], ["topic-id-3", "topic-id-4"]],
  "hierarchies": [
    {{"parent": "topic-id-5", "children": ["topic-id-6", "topic-id-7"]}}
  ],
  "renamed": {{"topic-id-8": "New Topic Name"}}
}}

Rules:
- Return ONLY valid JSON, no explanations
- Use exact topic IDs from input
- Be conservative with merges (high confidence only)
- Topic names should be concise (2-5 words)
- Empty arrays/objects are acceptable if no merges/hierarchies found
"""


def format_topics_for_ibis(topics_data: list) -> str:
    """
    Format topics as markdown list for IBIS classification.

    Args:
        topics_data: List of dicts with 'id', 'speaker', 'text' keys

    Returns:
        Formatted markdown string
    """
    lines = []
    for item in topics_data:
        line = f"[{item['id']}] {item['speaker']}: {item['text']}"
        lines.append(line)
    return "\n".join(lines)


def format_terms_for_standardization(terms_with_counts: dict) -> str:
    """
    Format terms with frequencies for standardization.

    Args:
        terms_with_counts: Dict mapping term -> count

    Returns:
        Formatted string
    """
    lines = []
    for term, count in sorted(terms_with_counts.items(), key=lambda x: x[1], reverse=True):
        lines.append(f"- {term} ({count})")
    return "\n".join(lines)


def format_topics_for_hierarchy(topics_with_terms: list) -> str:
    """
    Format topics with their terms for hierarchy detection.

    Args:
        topics_with_terms: List of dicts with 'id' and 'terms' keys

    Returns:
        Formatted string
    """
    lines = []
    for topic in topics_with_terms:
        terms_str = ", ".join(topic["terms"])
        lines.append(f"Topic {topic['id']}: {terms_str}")
    return "\n".join(lines)
