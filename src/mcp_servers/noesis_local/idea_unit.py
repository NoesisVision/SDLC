"""Idea unit extraction and classification from conversation turns.

Processes speaker turns in batches with contextual windowing, using an LLM to
identify coherent information fragments and classify them into discourse categories.
"""

import json
import logging
from enum import Enum

from mcp.server.fastmcp import Context
from mcp.types import SamplingMessage, TextContent
from pydantic import BaseModel, Field, ValidationError

from .clean_conversation import SpeakerTurn

logger = logging.getLogger(__name__)

_BATCH_SIZE = 8
_OVERLAP = 3
_MAX_RETRIES = 3

_EXTRACTION_PROMPT = """\
Extract idea units from each turn below. An idea unit groups consecutive sentences \
carrying one coherent piece of information.

CATEGORIES (exactly one per unit):
- Issue: question or problem raised for discussion
- Position: proposed solution, opinion, or stance
- Argument: evidence or reasoning for/against a position
- Decision: agreed conclusion or action item
- Irrelevant: filler, greetings, procedural remarks

RULES:
1. Every sentence must appear in exactly one idea unit
2. Preserve sentence text verbatim
3. Later turns may reference earlier ones - use full context

TURNS:
{turns}

JSON response - array with one object per turn, in order:
[{{"speaker":"...","time":"HH:MM","idea_units":[{{"sentences":["..."],"category":"Issue|Position|Argument|Decision|Irrelevant"}}]}}]"""


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


async def extract_idea_units(turns: list[SpeakerTurn], ctx: Context) -> list[TurnIdeaUnits]:
    """Extract and classify idea units from conversation turns using batched LLM calls.

    Processes turns in overlapping batches for contextual continuity.
    Each turn's sentences are grouped into idea units and classified.

    Args:
        turns: Ordered list of speaker turns from a cleaned conversation.
        ctx: MCP context for LLM access.

    Returns:
        List of TurnIdeaUnits, one per input turn, preserving order.

    Raises:
        ValueError: If LLM output fails validation after retries.
    """
    results: list[TurnIdeaUnits] = []
    batch_ranges = _compute_batch_ranges(len(turns))

    for batch_start, batch_end, extract_start in batch_ranges:
        batch_turns = turns[batch_start:batch_end]
        extract_offset = extract_start - batch_start
        batch_results = await _extract_batch(batch_turns, extract_offset, ctx)
        results.extend(batch_results)

    return results


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


async def _extract_batch(
    batch_turns: list[SpeakerTurn],
    extract_offset: int,
    ctx: Context,
) -> list[TurnIdeaUnits]:
    prompt = _build_extraction_prompt(batch_turns)
    expected_turns = batch_turns[extract_offset:]

    for attempt in range(_MAX_RETRIES):
        raw_response = await _call_llm(ctx, prompt)
        parsed = _parse_llm_response(raw_response)

        if parsed is None:
            logger.warning("LLM response parsing failed (attempt %d/%d)", attempt + 1, _MAX_RETRIES)
            prompt = _append_retry_hint(prompt)
            continue

        all_turn_results = _validate_and_build(parsed, batch_turns)
        if all_turn_results is None:
            logger.warning("Validation failed (attempt %d/%d)", attempt + 1, _MAX_RETRIES)
            prompt = _append_retry_hint(prompt)
            continue

        return all_turn_results[extract_offset:]

    raise ValueError(f"Failed to extract idea units after {_MAX_RETRIES} attempts")


def _build_extraction_prompt(turns: list[SpeakerTurn]) -> str:
    formatted_turns = "\n".join(
        f"[{turn.time}] {turn.speaker}: {' | '.join(turn.sentences)}" for turn in turns
    )
    return _EXTRACTION_PROMPT.format(turns=formatted_turns)


def _append_retry_hint(prompt: str) -> str:
    return prompt + "\n\nIMPORTANT: Return ONLY valid JSON array. Every input sentence must appear exactly once."


async def _call_llm(ctx: Context, prompt: str) -> str:
    result = await ctx.session.create_message(
        messages=[SamplingMessage(role="user", content=TextContent(type="text", text=prompt))],
        max_tokens=8000,
        temperature=0.1,
    )
    return result.content.text.strip()


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
