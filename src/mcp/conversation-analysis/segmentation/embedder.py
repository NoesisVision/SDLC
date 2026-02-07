"""
Sentence embedding generation using sentence-transformers.

This module provides semantic embedding generation for sentences using
the sentence-transformers library. Per spec, uses all-MiniLM-L6-v2 model.
"""

from typing import Any, List

import numpy as np
from sentence_transformers import SentenceTransformer

from ...models import Sentence


class SentenceEmbedder:
    """
    Generates semantic embeddings for sentences.

    Uses the sentence-transformers/all-MiniLM-L6-v2 model for fast,
    high-quality sentence embeddings (384 dimensions).
    """

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> None:
        """
        Initialize the embedder with the specified model.

        Args:
            model_name: Hugging Face model identifier
        """
        self.model = SentenceTransformer(model_name)
        self.model_name = model_name

    def embed_sentence(self, sentence: Sentence) -> List[float]:
        """
        Generate embedding for a single sentence.

        Args:
            sentence: Sentence object to embed

        Returns:
            Embedding vector as list of floats
        """
        embedding = self.model.encode(sentence.text, convert_to_numpy=True)
        return embedding.tolist()

    def embed_sentences(self, sentences: List[Sentence]) -> List[List[float]]:
        """
        Generate embeddings for multiple sentences in batch.

        Batch processing is more efficient than processing one at a time.

        Args:
            sentences: List of Sentence objects

        Returns:
            List of embedding vectors
        """
        if not sentences:
            return []

        texts = [s.text for s in sentences]
        embeddings = self.model.encode(texts, convert_to_numpy=True, show_progress_bar=False)

        return embeddings.tolist()

    def compute_average_embedding(self, embeddings: List[List[float]]) -> List[float]:
        """
        Compute the average of multiple embeddings.

        Useful for representing a topic by averaging its sentence embeddings.

        Args:
            embeddings: List of embedding vectors

        Returns:
            Average embedding vector
        """
        if not embeddings:
            return []

        embeddings_array = np.array(embeddings)
        average = np.mean(embeddings_array, axis=0)

        return average.tolist()


def create_embedder(model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> SentenceEmbedder:
    """
    Factory function to create a SentenceEmbedder instance.

    Args:
        model_name: Hugging Face model identifier

    Returns:
        Configured SentenceEmbedder instance
    """
    return SentenceEmbedder(model_name=model_name)
