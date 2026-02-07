"""
Sentence splitting using spacy.

This module provides deterministic sentence segmentation using the spacy
NLP library. No LLM is used in this phase.
"""

from typing import Any, List

import spacy

from ...models import Sentence
from .cleaner import SpeakerTurn


class SentenceSplitter:
    """
    Splits speaker turns into individual sentences using spacy.

    Uses the en_core_web_sm model for accurate sentence boundary detection.
    """

    def __init__(self) -> None:
        """Initialize the splitter with the spacy model."""
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except OSError:
            # If model not found, provide helpful error message
            raise RuntimeError(
                "Spacy model 'en_core_web_sm' not found. "
                "Please install it using: python -m spacy download en_core_web_sm"
            )

    def split_turn(self, turn: SpeakerTurn) -> List[str]:
        """
        Split a speaker turn into individual sentences.

        Args:
            turn: Speaker turn to split

        Returns:
            List of sentence strings
        """
        doc = self.nlp(turn.text)
        sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
        return sentences

    def split_turns(self, turns: List[SpeakerTurn]) -> List[Sentence]:
        """
        Split multiple speaker turns into Sentence objects with metadata.

        Assigns UUIDs and sequence indices to each sentence.

        Args:
            turns: List of speaker turns

        Returns:
            List of Sentence objects with metadata
        """
        sentences = []
        sequence_index = 0

        for turn in turns:
            sentence_texts = self.split_turn(turn)

            for text in sentence_texts:
                sentence = Sentence(
                    text=text,
                    speaker=turn.speaker,
                    timestamp=turn.timestamp,
                    sequence_index=sequence_index,
                )
                sentences.append(sentence)
                sequence_index += 1

        return sentences


def create_splitter() -> SentenceSplitter:
    """
    Factory function to create a SentenceSplitter instance.

    Returns:
        Configured SentenceSplitter instance
    """
    return SentenceSplitter()
