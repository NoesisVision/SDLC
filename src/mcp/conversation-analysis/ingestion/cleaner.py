"""
Transcript cleaning and parsing functions.

This module provides deterministic text cleaning and speaker turn extraction
using regex patterns. No LLM is used in this phase.
"""

import re
from dataclasses import dataclass
from typing import List


@dataclass
class SpeakerTurn:
    """
    Represents a single speaker turn extracted from the transcript.

    A speaker turn consists of a timestamp, speaker name, and the text they spoke.
    """

    timestamp: str
    speaker: str
    text: str


def clean_markdown(text: str) -> str:
    """
    Remove markdown formatting from text.

    Removes bold (**text**), italic (*text*), and fixes broken line breaks.

    Args:
        text: Raw text with markdown formatting

    Returns:
        Cleaned text without markdown formatting
    """
    # Remove bold markdown
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)

    # Remove italic markdown
    text = re.sub(r"\*(.+?)\*", r"\1", text)

    # Fix broken line breaks (multiple consecutive newlines)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Remove leading/trailing whitespace from each line
    lines = [line.strip() for line in text.split("\n")]
    text = "\n".join(lines)

    return text


def extract_speaker_turns(transcript: str) -> List[SpeakerTurn]:
    """
    Extract speaker turns from a transcript.

    Expected format:
    ```
    **{Time}**
    {Speaker}
    {Text}

    **{Time}**
    {Speaker}
    {Text}
    ```

    Args:
        transcript: Raw transcript text

    Returns:
        List of SpeakerTurn objects
    """
    # Pattern to match speaker turns
    # Matches: **timestamp** followed by speaker name and text
    pattern = r"\*\*(.+?)\*\*\s+([^\n]+)\s+(.+?)(?=\*\*|$)"

    turns = []
    for match in re.finditer(pattern, transcript, re.DOTALL):
        timestamp = match.group(1).strip()
        speaker = match.group(2).strip()
        text = match.group(3).strip()

        # Clean the text
        text = clean_markdown(text)

        # Remove extra whitespace
        text = " ".join(text.split())

        if timestamp and speaker and text:
            turns.append(
                SpeakerTurn(
                    timestamp=timestamp,
                    speaker=speaker,
                    text=text,
                )
            )

    return turns


def clean_transcript(transcript: str) -> str:
    """
    Clean a transcript by removing markdown and normalizing whitespace.

    This is a simpler cleaning function that just cleans the text
    without extracting structure.

    Args:
        transcript: Raw transcript text

    Returns:
        Cleaned transcript text
    """
    # Remove markdown formatting
    cleaned = clean_markdown(transcript)

    # Normalize whitespace
    cleaned = " ".join(cleaned.split())

    return cleaned
