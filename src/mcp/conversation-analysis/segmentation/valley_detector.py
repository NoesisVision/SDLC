"""
Topic boundary detection using the "Embedding Valley" method.

This module implements semantic segmentation by detecting valleys in
cosine similarity between adjacent sliding windows of sentence embeddings.
"""

from typing import List, Tuple

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from ...models import PotentialTopic, Sentence


def compute_similarities(embeddings: List[List[float]], window_size: int = 3) -> List[float]:
    """
    Compute cosine similarities between adjacent sliding windows.

    Args:
        embeddings: List of embedding vectors
        window_size: Size of sliding window (default: 3)

    Returns:
        List of similarity scores between adjacent windows
    """
    if len(embeddings) < window_size * 2:
        return []

    similarities = []

    for i in range(len(embeddings) - window_size):
        # Get two adjacent windows
        window1 = embeddings[i : i + window_size]
        window2 = embeddings[i + window_size : i + window_size * 2]

        if len(window2) < window_size:
            break

        # Compute average embeddings for each window
        avg1 = np.mean(window1, axis=0).reshape(1, -1)
        avg2 = np.mean(window2, axis=0).reshape(1, -1)

        # Compute cosine similarity
        sim = cosine_similarity(avg1, avg2)[0][0]
        similarities.append(float(sim))

    return similarities


def detect_valleys(
    similarities: List[float], percentile: int = 10, min_valley_depth: float = 0.05
) -> List[int]:
    """
    Detect topic boundaries using dynamic threshold based on percentile.

    Identifies local minima (valleys) in similarity scores that fall below
    a dynamic threshold computed from the distribution.

    Args:
        similarities: List of similarity scores
        percentile: Percentile for dynamic threshold (default: 10th percentile)
        min_valley_depth: Minimum depth for a valley to be significant

    Returns:
        List of indices where valleys occur (topic boundaries)
    """
    if len(similarities) < 3:
        return []

    # Compute dynamic threshold
    threshold = np.percentile(similarities, percentile)

    valleys = []

    for i in range(1, len(similarities) - 1):
        # Check if this is a local minimum
        is_local_min = (
            similarities[i] < similarities[i - 1] and similarities[i] < similarities[i + 1]
        )

        # Check if it's below threshold
        is_below_threshold = similarities[i] < threshold

        # Check valley depth (how much lower than neighbors)
        depth = min(similarities[i - 1] - similarities[i], similarities[i + 1] - similarities[i])
        is_significant = depth >= min_valley_depth

        if is_local_min and is_below_threshold and is_significant:
            valleys.append(i)

    return valleys


def create_potential_topics(
    sentences: List[Sentence], embeddings: List[List[float]], valley_indices: List[int]
) -> List[PotentialTopic]:
    """
    Group sentences into PotentialTopic blocks based on valley boundaries.

    Args:
        sentences: List of Sentence objects
        embeddings: Corresponding sentence embeddings
        valley_indices: Indices where topic boundaries occur

    Returns:
        List of PotentialTopic objects
    """
    if not sentences:
        return []

    topics = []

    # Add 0 as the first boundary and len(sentences) as the last
    boundaries = [0] + [v + 3 for v in valley_indices] + [len(sentences)]  # +3 for window offset

    for i in range(len(boundaries) - 1):
        start_idx = boundaries[i]
        end_idx = min(boundaries[i + 1], len(sentences))

        if start_idx >= end_idx:
            continue

        topic_sentences = sentences[start_idx:end_idx]
        topic_embeddings = embeddings[start_idx:end_idx]

        # Compute average embedding for the topic
        avg_embedding = np.mean(topic_embeddings, axis=0).tolist()

        topic = PotentialTopic(
            sentences=topic_sentences,
            start_index=start_idx,
            end_index=end_idx,
            embedding=avg_embedding,
        )

        topics.append(topic)

    return topics


def apply_max_min_chunking(
    sentences: List[Sentence],
    embeddings: List[List[float]],
    cohesion_threshold: float = 0.7,
    boundary_threshold: float = 0.6,
) -> List[PotentialTopic]:
    """
    Apply Max-Min semantic chunking to prevent micro-chunking.

    A sentence is added to a chunk only if:
    1. It is sufficiently similar to existing sentences (cohesion)
    2. Similarity to next sentence is significantly lower (boundary strength)

    Args:
        sentences: List of Sentence objects
        embeddings: Corresponding sentence embeddings
        cohesion_threshold: Minimum similarity within chunk
        boundary_threshold: Maximum similarity to next chunk

    Returns:
        List of PotentialTopic objects
    """
    if not sentences or len(sentences) < 2:
        return (
            [
                PotentialTopic(
                    sentences=sentences,
                    start_index=0,
                    end_index=len(sentences),
                    embedding=embeddings[0] if embeddings else None,
                )
            ]
            if sentences
            else []
        )

    topics = []
    current_chunk = [0]  # Start with first sentence index

    embeddings_array = np.array(embeddings)

    for i in range(1, len(sentences)):
        # Compute similarity to current chunk
        chunk_embeddings = embeddings_array[current_chunk]
        current_embedding = embeddings_array[i].reshape(1, -1)

        # Min similarity within chunk (cohesion)
        similarities_to_chunk = cosine_similarity(current_embedding, chunk_embeddings)[0]
        min_chunk_similarity = float(np.min(similarities_to_chunk))

        # Similarity to next sentence (boundary strength)
        if i < len(sentences) - 1:
            next_embedding = embeddings_array[i + 1].reshape(1, -1)
            next_similarity = float(cosine_similarity(current_embedding, next_embedding)[0][0])
        else:
            next_similarity = 0.0  # Last sentence

        # Decision: add to current chunk or start new chunk
        is_cohesive = min_chunk_similarity >= cohesion_threshold
        is_boundary = next_similarity < boundary_threshold

        if is_cohesive and not is_boundary:
            # Add to current chunk
            current_chunk.append(i)
        else:
            # Finalize current chunk and start new one
            chunk_sentences = [sentences[idx] for idx in current_chunk]
            chunk_embeddings = [embeddings[idx] for idx in current_chunk]
            avg_embedding = np.mean(chunk_embeddings, axis=0).tolist()

            topics.append(
                PotentialTopic(
                    sentences=chunk_sentences,
                    start_index=current_chunk[0],
                    end_index=current_chunk[-1] + 1,
                    embedding=avg_embedding,
                )
            )

            current_chunk = [i]

    # Add final chunk
    if current_chunk:
        chunk_sentences = [sentences[idx] for idx in current_chunk]
        chunk_embeddings = [embeddings[idx] for idx in current_chunk]
        avg_embedding = np.mean(chunk_embeddings, axis=0).tolist()

        topics.append(
            PotentialTopic(
                sentences=chunk_sentences,
                start_index=current_chunk[0],
                end_index=current_chunk[-1] + 1,
                embedding=avg_embedding,
            )
        )

    return topics


def segment_by_valleys(
    sentences: List[Sentence],
    embeddings: List[List[float]],
    window_size: int = 3,
    percentile: int = 10,
    use_max_min: bool = True,
) -> List[PotentialTopic]:
    """
    Segment sentences into potential topics using the Embedding Valley method.

    Main entry point for Phase 2 segmentation.

    Args:
        sentences: List of Sentence objects
        embeddings: Corresponding sentence embeddings
        window_size: Sliding window size for similarity computation
        percentile: Percentile for dynamic threshold
        use_max_min: Whether to apply Max-Min chunking refinement

    Returns:
        List of PotentialTopic objects
    """
    if not sentences or not embeddings:
        return []

    if use_max_min:
        # Use Max-Min semantic chunking
        return apply_max_min_chunking(sentences, embeddings)
    else:
        # Use basic valley detection
        similarities = compute_similarities(embeddings, window_size=window_size)
        valleys = detect_valleys(similarities, percentile=percentile)
        topics = create_potential_topics(sentences, embeddings, valleys)
        return topics
