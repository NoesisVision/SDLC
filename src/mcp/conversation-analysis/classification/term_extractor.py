"""
Domain term extraction and aggregation.

This module aggregates terms extracted during IBIS classification
into DomainTerm objects with sentence references.
"""

from collections import defaultdict
from typing import Dict, List
from uuid import UUID

from ...models import DomainTerm


def aggregate_terms(sentence_terms: Dict[UUID, List[str]]) -> List[DomainTerm]:
    """
    Aggregate extracted terms into DomainTerm objects.

    Groups sentences by term and creates DomainTerm objects with
    references to all sentences where each term appears.

    Args:
        sentence_terms: Dict mapping sentence UUID to list of terms

    Returns:
        List of DomainTerm objects
    """
    # Create reverse mapping: term -> list of sentence IDs
    term_to_sentences: Dict[str, List[UUID]] = defaultdict(list)

    for sentence_id, terms in sentence_terms.items():
        for term in terms:
            # Normalize term (lowercase, strip whitespace)
            normalized_term = term.strip().lower()
            if normalized_term:
                term_to_sentences[normalized_term].append(sentence_id)

    # Create DomainTerm objects
    domain_terms = []
    for term, sentence_ids in term_to_sentences.items():
        domain_term = DomainTerm(
            term=term,
            sentence_ids=list(set(sentence_ids)),  # Remove duplicates
            standardized_term=None,  # Will be set in Phase 4
        )
        domain_terms.append(domain_term)

    return domain_terms


def get_term_frequencies(domain_terms: List[DomainTerm]) -> Dict[str, int]:
    """
    Get frequency count for each term.

    Args:
        domain_terms: List of DomainTerm objects

    Returns:
        Dict mapping term to frequency count
    """
    return {term.term: len(term.sentence_ids) for term in domain_terms}


def get_top_terms(domain_terms: List[DomainTerm], top_n: int = 20) -> List[DomainTerm]:
    """
    Get the most frequently occurring terms.

    Args:
        domain_terms: List of DomainTerm objects
        top_n: Number of top terms to return

    Returns:
        List of top N DomainTerm objects sorted by frequency
    """
    sorted_terms = sorted(domain_terms, key=lambda t: len(t.sentence_ids), reverse=True)
    return sorted_terms[:top_n]


def filter_terms_by_frequency(
    domain_terms: List[DomainTerm], min_frequency: int = 2
) -> List[DomainTerm]:
    """
    Filter terms by minimum frequency.

    Removes terms that appear in fewer than min_frequency sentences.

    Args:
        domain_terms: List of DomainTerm objects
        min_frequency: Minimum number of occurrences

    Returns:
        Filtered list of DomainTerm objects
    """
    return [term for term in domain_terms if len(term.sentence_ids) >= min_frequency]
