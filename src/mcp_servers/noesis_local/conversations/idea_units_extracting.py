"""Batch extraction and validation of idea units from conversation transcripts."""

import json
import logging

from pydantic import TypeAdapter, ValidationError

from .models import (
    ExtractionBatch,
    GetBatchResponse,
    IdeaUnit,
    PrepareBatchesResponse,
    SpeakerTurn,
    StoreBatchResultResponse,
)
from .registry import get_conversation

logger = logging.getLogger(__name__)

_BATCH_SIZE = 8
_OVERLAP = 3
_speaker_turns_serializer = TypeAdapter(list[SpeakerTurn])

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

    if state.turns is None:
        raise ValueError(f"No cleaned data found for conversation {conversation_id}")

    turns = state.turns
    batch_ranges = _compute_batch_ranges(len(turns))
    state.batches = []

    for context_start, batch_start, batch_end in batch_ranges:
        batch_turns = turns[context_start:batch_end]
        formatted_turns = _serialize_batch_turns(batch_turns)
        expected_turns = turns[batch_start:batch_end]

        state.batches.append(ExtractionBatch(
            batch_index=len(state.batches),
            turns=formatted_turns,
            expected_turns=expected_turns,
        ))

    return PrepareBatchesResponse(status="success", batch_count=len(state.batches))


async def get_extraction_batch(conversation_id: str, batch_index: int) -> GetBatchResponse:
    """Retrieve the formatted turns for a specific batch.

    Args:
        conversation_id: UUID identifying the conversation.
        batch_index: Zero-based index of the batch to retrieve.

    Returns:
        The formatted conversation turns and batch index.
    """
    state = get_conversation(conversation_id)

    if batch_index < 0 or batch_index >= len(state.batches):
        raise ValueError(f"Batch index {batch_index} out of range (0..{len(state.batches) - 1})")

    batch = state.batches[batch_index]
    return GetBatchResponse(turns=batch.turns, batch_index=batch_index)


async def store_extraction_result(
    conversation_id: str, batch_index: int, result: str
) -> StoreBatchResultResponse:
    """Parse, validate, and store an LLM extraction result for a specific batch.

    The result is validated against expected turns immediately. Only valid
    results are stored. When all batches have been stored, idea units are
    automatically merged into ``state.idea_units``.

    Args:
        conversation_id: UUID identifying the conversation.
        batch_index: Zero-based index of the batch.
        result: Raw JSON string from the LLM extraction.

    Returns:
        Status indicating success, invalid_json, or validation_failed
        with actionable error_details on failure.
    """
    state = get_conversation(conversation_id)

    if batch_index < 0 or batch_index >= len(state.batches):
        raise ValueError(f"Batch index {batch_index} out of range (0..{len(state.batches) - 1})")

    parsed = _parse_llm_response(result)
    if isinstance(parsed, str):
        return StoreBatchResultResponse(status="invalid_json", error_details=parsed)

    expected_turns = state.batches[batch_index].expected_turns
    validated = _validate_llm_response(parsed, expected_turns)
    if isinstance(validated, str):
        return StoreBatchResultResponse(status="validation_failed", error_details=validated)

    for turn, idea_units in zip(expected_turns, validated):
        turn.idea_units = idea_units

    return StoreBatchResultResponse(status="success")



def _compute_batch_ranges(total_turns: int) -> list[tuple[int, int, int]]:
    ranges: list[tuple[int, int, int]] = []
    position = 0

    while position < total_turns:
        batch_end = min(position + _BATCH_SIZE, total_turns)
        context_start = max(0, position - _OVERLAP)
        batch_start = position
        ranges.append((context_start, batch_start, batch_end))
        position = batch_end

    return ranges


def _serialize_batch_turns(turns: list[SpeakerTurn]) -> str:
    return _speaker_turns_serializer.dump_json(turns, indent=2).decode()



def _parse_llm_response(raw: str) -> list[dict] | str:
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
    except json.JSONDecodeError as e:
        return f"JSON parse error: {e}"

    if not isinstance(parsed, list):
        return f"Expected a JSON array at top level, got {type(parsed).__name__}"

    return parsed


def _validate_llm_response(parsed: list[dict], expected_turns: list[SpeakerTurn]) -> list[list[IdeaUnit]] | str:
    if len(parsed) != len(expected_turns):
        return (
            f"Turn count mismatch: expected {len(expected_turns)}, got {len(parsed)}"
        )

    results: list[list[IdeaUnit]] = []
    for turn_data, expected_turn in zip(parsed, expected_turns):
        turn_result = _validate_single_turn(turn_data, expected_turn)
        if isinstance(turn_result, str):
            return turn_result
        results.append(turn_result)

    return results


def _validate_single_turn(turn_data: dict, expected_turn: SpeakerTurn) -> list[IdeaUnit] | str:
    if not isinstance(turn_data, dict):
        return (
            f"Invalid turn structure for {expected_turn.speaker} at {expected_turn.time}: "
            f"expected object, got {type(turn_data).__name__}"
        )

    raw_idea_units = turn_data.get("idea_units")
    if not isinstance(raw_idea_units, list):
        return (
            f"Invalid turn structure for {expected_turn.speaker} at {expected_turn.time}: "
            f"expected 'idea_units' list"
        )

    try:
        idea_units = [IdeaUnit(**iu) for iu in raw_idea_units]
    except (ValidationError, TypeError) as e:
        return (
            f"Invalid turn structure for {expected_turn.speaker} at {expected_turn.time}: {e}"
        )

    output_sentences = [s for iu in idea_units for s in iu.sentences]
    expected_set = set(expected_turn.sentences)
    output_set = set(output_sentences)

    if expected_set != output_set:
        parts = []
        missing = expected_set - output_set
        extra = output_set - expected_set
        if missing:
            parts.append(f"missing sentences: {sorted(missing)}")
        if extra:
            parts.append(f"extra sentences: {sorted(extra)}")
        return (
            f"Sentence mismatch for {expected_turn.speaker} at {expected_turn.time}: "
            + "; ".join(parts)
        )

    if len(output_sentences) != len(set(output_sentences)):
        return f"Duplicate sentences found for {expected_turn.speaker} at {expected_turn.time}"

    return idea_units
