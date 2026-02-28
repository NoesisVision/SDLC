"""Idea unit models, batch extraction, and validation for conversation analysis."""

import json
import logging
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

from .conversations_cleaning import SpeakerTurn
from .conversations_registry import get_conversation

logger = logging.getLogger(__name__)

_BATCH_SIZE = 8
_OVERLAP = 3

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_EXTRACTION_PROMPT = (_PROMPTS_DIR / "idea_extraction.md").read_text(encoding="utf-8")


class IdeaUnitCategory(str, Enum):
    """Classification categories for idea units in a conversation."""

    Issue = "Issue"
    Position = "Position"
    Argument = "Argument"
    Decision = "Decision"
    Irrelevant = "Irrelevant"


class IdeaUnit(BaseModel):
    """A coherent fragment of a speaker's statement carrying one piece of information."""

    sentences: list[str] = Field(description="Consecutive sentences forming one coherent idea")
    category: IdeaUnitCategory = Field(description="Discourse classification of the idea unit")


class TurnIdeaUnits(BaseModel):
    """A single speaker turn split into idea units."""

    speaker: str = Field(description="Name of the speaker")
    time: str = Field(description="Time of the statement in HH:MM format")
    idea_units: list[IdeaUnit] = Field(description="Idea units extracted from this turn")


class GetBatchResponse(BaseModel):
    """Response from get_extraction_batch."""

    prompt: str = Field(description="Extraction prompt for the LLM")
    batch_index: int = Field(description="Index of this batch")


class PrepareBatchesResponse(BaseModel):
    """Response from prepare_extraction_batches."""

    status: str = Field(description="'success'")
    batch_count: int = Field(description="Number of batches created")


class StoreBatchResultResponse(BaseModel):
    """Response from store_extraction_result."""

    status: str = Field(description="'success'")


class ValidateAndMergeResponse(BaseModel):
    """Response from validate_and_merge_idea_units."""

    status: str = Field(description="'success' or 'retry_needed'")
    failed_batches: list[int] = Field(default_factory=list, description="Batch indices that failed validation")
    turn_count: int = Field(default=0, description="Number of validated turns (when successful)")


async def get_extraction_batch(conversation_id: str, batch_index: int) -> GetBatchResponse:
    """Retrieve the extraction prompt for a specific batch.

    Args:
        conversation_id: UUID identifying the conversation.
        batch_index: Zero-based index of the batch to retrieve.

    Returns:
        The extraction prompt and batch index.
    """
    state = get_conversation(conversation_id)

    if batch_index < 0 or batch_index >= len(state.batches):
        raise ValueError(f"Batch index {batch_index} out of range (0..{len(state.batches) - 1})")

    batch = state.batches[batch_index]
    return GetBatchResponse(prompt=batch["prompt"], batch_index=batch_index)


async def prepare_extraction_batches(conversation_id: str) -> PrepareBatchesResponse:
    """Prepare extraction batches from a cleaned conversation.

    Reads cleaned data from memory, computes overlapping batch ranges, and
    stores batch definitions in memory.

    Args:
        conversation_id: UUID identifying the conversation.

    Returns:
        Status and the number of batches created.
    """
    state = get_conversation(conversation_id)

    if state.cleaned is None:
        raise ValueError(f"No cleaned data found for conversation {conversation_id}")

    turns = [SpeakerTurn(**t) for t in state.cleaned["turns"]]
    batch_ranges = _compute_batch_ranges(len(turns))
    state.batches = []

    for context_start, batch_end, extract_start in batch_ranges:
        batch_turns = turns[context_start:batch_end]
        extract_offset = extract_start - context_start
        prompt = _build_extraction_prompt(batch_turns)
        expected_turns = [t.model_dump() for t in batch_turns[extract_offset:]]

        state.batches.append({
            "batch_index": len(state.batches),
            "extract_offset": extract_offset,
            "prompt": prompt,
            "expected_turns": expected_turns,
        })

    return PrepareBatchesResponse(status="success", batch_count=len(state.batches))


async def store_extraction_result(
    conversation_id: str, batch_index: int, result: str
) -> StoreBatchResultResponse:
    """Store an LLM extraction result for a specific batch.

    Args:
        conversation_id: UUID identifying the conversation.
        batch_index: Zero-based index of the batch.
        result: Raw JSON string from the LLM extraction.

    Returns:
        Status indicating success.
    """
    state = get_conversation(conversation_id)

    if batch_index < 0 or batch_index >= len(state.batches):
        raise ValueError(f"Batch index {batch_index} out of range (0..{len(state.batches) - 1})")

    state.batch_results[batch_index] = result
    return StoreBatchResultResponse(status="success")


async def validate_and_merge_idea_units(conversation_id: str) -> ValidateAndMergeResponse:
    """Validate LLM batch results and merge into idea units.

    Reads batch definitions and results from memory, validates each result
    against expected turns, and merges valid results.

    Args:
        conversation_id: UUID identifying the conversation.

    Returns:
        Status, failed batch indices (if any), and validated turn count.
    """
    state = get_conversation(conversation_id)
    failed_batches: list[int] = []
    all_turn_idea_units: list[dict] = []

    for batch_data in state.batches:
        batch_index = batch_data["batch_index"]

        if batch_index not in state.batch_results:
            failed_batches.append(batch_index)
            logger.warning("Missing result for batch %d", batch_index)
            continue

        raw_result = state.batch_results[batch_index]
        parsed = _parse_llm_response(raw_result)

        if parsed is None:
            failed_batches.append(batch_index)
            logger.warning("Failed to parse result for batch %d", batch_index)
            continue

        expected_turns = [SpeakerTurn(**t) for t in batch_data["expected_turns"]]
        validated = _validate_and_build(parsed, expected_turns)

        if validated is None:
            failed_batches.append(batch_index)
            logger.warning("Validation failed for batch %d", batch_index)
            continue

        all_turn_idea_units.extend([t.model_dump() for t in validated])

    if failed_batches:
        return ValidateAndMergeResponse(status="retry_needed", failed_batches=failed_batches)

    state.idea_units = all_turn_idea_units
    return ValidateAndMergeResponse(status="success", turn_count=len(all_turn_idea_units))


def _compute_batch_ranges(total_turns: int) -> list[tuple[int, int, int]]:
    ranges: list[tuple[int, int, int]] = []
    position = 0

    while position < total_turns:
        batch_end = min(position + _BATCH_SIZE, total_turns)
        context_start = max(0, position - _OVERLAP) if position > 0 else 0
        extract_start = position
        ranges.append((context_start, batch_end, extract_start))
        position = batch_end

    return ranges


def _build_extraction_prompt(turns: list[SpeakerTurn]) -> str:
    formatted_turns = "\n".join(
        f"[{turn.time}] {turn.speaker}: {' | '.join(turn.sentences)}" for turn in turns
    )
    return _EXTRACTION_PROMPT.format(turns=formatted_turns)


def _parse_llm_response(raw: str) -> list[dict] | None:
    text = raw
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, list):
        return None

    return parsed


def _validate_and_build(parsed: list[dict], expected_turns: list[SpeakerTurn]) -> list[TurnIdeaUnits] | None:
    if len(parsed) != len(expected_turns):
        logger.warning("Turn count mismatch: expected %d, got %d", len(expected_turns), len(parsed))
        return None

    results: list[TurnIdeaUnits] = []
    for turn_data, expected_turn in zip(parsed, expected_turns):
        turn_result = _validate_single_turn(turn_data, expected_turn)
        if turn_result is None:
            return None
        results.append(turn_result)

    return results


def _validate_single_turn(turn_data: dict, expected_turn: SpeakerTurn) -> TurnIdeaUnits | None:
    try:
        turn_idea_units = TurnIdeaUnits(**turn_data)
    except (ValidationError, TypeError):
        logger.warning("Failed to parse turn data for %s at %s", expected_turn.speaker, expected_turn.time)
        return None

    output_sentences = [s for iu in turn_idea_units.idea_units for s in iu.sentences]
    expected_set = set(expected_turn.sentences)
    output_set = set(output_sentences)

    if expected_set != output_set:
        missing = expected_set - output_set
        extra = output_set - expected_set
        if missing:
            logger.warning("Missing sentences for %s at %s: %s", expected_turn.speaker, expected_turn.time, missing)
        if extra:
            logger.warning("Extra sentences for %s at %s: %s", expected_turn.speaker, expected_turn.time, extra)
        return None

    if len(output_sentences) != len(set(output_sentences)):
        logger.warning("Duplicate sentences for %s at %s", expected_turn.speaker, expected_turn.time)
        return None

    return turn_idea_units
