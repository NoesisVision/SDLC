"""Conversation file cleaning tool for the Noesis Local MCP server."""

import logging
import re
from pathlib import Path

import pysbd
from langdetect import LangDetectException, detect
from mcp.server.fastmcp import Context
from mcp.types import SamplingMessage, TextContent
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

_PYSBD_LANGUAGES = set(pysbd.languages.LANGUAGE_CODES.keys())
_SEGMENTER_CACHE: dict[str, pysbd.Segmenter] = {}
_LANGUAGE_SAMPLE_SIZE = 1000

_INVISIBLE_CHARS = re.compile(r"[\u200b\u200c\u200d\u200e\u200f\ufeff\u2028\u2029]")
_MULTI_SPACES = re.compile(r" {2,}")
_CAPITALIZE_AFTER_PUNCT = re.compile(r"([.!?]\s+)([a-z])")
_ENCODING_ARTIFACTS: list[tuple[str, str]] = [
    ("\u00c3\u00a9", "\u00e9"),
    ("\u00c3\u00a8", "\u00e8"),
    ("\u00c3\u00bc", "\u00fc"),
    ("\u00c3\u00b6", "\u00f6"),
    ("\u00c3\u00a4", "\u00e4"),
]
_SMART_QUOTES: list[tuple[str, str]] = [
    ("\u201c", '"'),
    ("\u201d", '"'),
    ("\u2018", "'"),
    ("\u2019", "'"),
    ("\u2013", "-"),
    ("\u2014", "--"),
]
_TURN_PATTERN = re.compile(
    r"^\*\*(\d{1,2}:\d{2})\*\*\s*\n"
    r"(.+?)\n"
    r"([\s\S]*?)(?=^\*\*\d{1,2}:\d{2}\*\*|\Z)",
    re.MULTILINE,
)
_BROKEN_TIME_MARKER = re.compile(r"^\*\*\s*(\d{1,2}:\d{2})\s*\*\*", re.MULTILINE)
_SPEAKER_ON_TIMESTAMP_LINE = re.compile(
    r"^(\*\*\d{1,2}:\d{2}\*\*)[ \t]+(.+)$", re.MULTILINE
)
_TITLE_PATTERN = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_DATE_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2})$", re.MULTILINE)


class SpeakerTurn(BaseModel):
    """A single speaker turn in the conversation."""

    speaker: str = Field(description="Name of the speaker")
    time: str = Field(description="Time of the statement relative to the beginning of the conversation in HH:MM format")
    sentences: list[str] = Field(description="Individual sentences from the speaker's text")


class CleanedConversation(BaseModel):
    """Cleaned and structured conversation transcript."""

    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time of the first statement in YYYY-MM-DD HH:MM format")
    turns: list[SpeakerTurn] = Field(min_length=1, description="Ordered list of speaker turns")


async def clean_conversation_file(file_path: str, ctx: Context) -> CleanedConversation:
    """Clean and structure a conversation transcript from a markdown file.

    Parses speaker turns, fixes broken syntax (line breaks, whitespace,
    encoding artifacts, smart quotes, invisible characters), splits text
    into individual sentences using pysbd, and returns structured JSON.
    If title or date is missing from the file, prompts the user to provide them.

    Args:
        file_path: Absolute or relative path to the conversation markdown file.
        ctx: MCP context for LLM access (used to ask user for missing metadata).

    Returns:
        Structured conversation with title, date, and sentence-split statements.

    Raises:
        FileNotFoundError: If the file doesn't exist.
        ValueError: If the file is empty or contains no recognizable statements.
    """
    resolved_path = Path(file_path)

    if not resolved_path.exists():
        raise FileNotFoundError(f"File not found: {resolved_path}")

    if not resolved_path.is_file():
        raise ValueError(f"Path is not a file: {resolved_path}")

    try:
        raw_text = resolved_path.read_text(encoding="utf-8")
    except PermissionError:
        logger.exception("Permission denied reading file %s", resolved_path)
        raise

    if not raw_text.strip():
        raise ValueError(f"File is empty: {resolved_path}")

    cleaned_text = _normalize_encoding(raw_text)
    title, date, body = _extract_metadata(cleaned_text)
    language = _detect_language(body)
    statements = _parse_statements(body, language)

    if not statements:
        raise ValueError(f"No recognizable speaker turns found in: {resolved_path}")

    title = title or await _ask_user_for_metadata(ctx, "title", resolved_path)
    first_time = statements[0].time
    if date:
        date_with_time = f"{date} {first_time}"
    else:
        asked_date = await _ask_user_for_metadata(ctx, "date", resolved_path)
        date_with_time = f"{asked_date} {first_time}"

    return CleanedConversation(
        title=title,
        date=date_with_time,
        turns=statements,
    )


def _normalize_encoding(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ")
    text = _INVISIBLE_CHARS.sub("", text)

    for bad, good in _ENCODING_ARTIFACTS:
        text = text.replace(bad, good)

    for smart, straight in _SMART_QUOTES:
        text = text.replace(smart, straight)

    return text


def _extract_metadata(text: str) -> tuple[str | None, str | None, str]:
    title_match = _TITLE_PATTERN.search(text)
    title = title_match.group(1).strip() if title_match else None

    date_match = _DATE_PATTERN.search(text)
    date = date_match.group(1).strip() if date_match else None

    body = text
    if title_match:
        body = body[title_match.end() :]
    if date_match:
        body = body.replace(date_match.group(0), "", 1)

    return title, date, body.strip()


def _parse_statements(body: str, language: str) -> list[SpeakerTurn]:
    body = _normalize_turn_headers(body)
    statements: list[SpeakerTurn] = []

    for match in _TURN_PATTERN.finditer(body):
        time = match.group(1)
        speaker = match.group(2).strip()
        raw_text = match.group(3)

        cleaned = _clean_text_block(raw_text)
        if not cleaned:
            continue

        sentences = _split_sentences(cleaned, language)
        if sentences:
            statements.append(SpeakerTurn(speaker=speaker, time=time, sentences=sentences))

    return statements


def _normalize_turn_headers(text: str) -> str:
    text = _BROKEN_TIME_MARKER.sub(r"**\1**", text)
    text = _SPEAKER_ON_TIMESTAMP_LINE.sub(r"\1\n\2", text)
    return text


def _clean_text_block(text: str) -> str:
    text = text.strip()
    lines = text.split("\n")
    lines = [stripped for line in lines if (stripped := line.strip())]
    text = " ".join(lines)
    text = _MULTI_SPACES.sub(" ", text)
    text = _CAPITALIZE_AFTER_PUNCT.sub(lambda m: m.group(1) + m.group(2).upper(), text)
    return text


def _detect_language(text: str) -> str:
    sample = text[:_LANGUAGE_SAMPLE_SIZE]
    try:
        detected = detect(sample)
    except LangDetectException:
        return "en"
    return detected if detected in _PYSBD_LANGUAGES else "en"


def _split_sentences(text: str, language: str) -> list[str]:
    segmenter = _get_segmenter(language)
    sentences = segmenter.segment(text)
    return [stripped for s in sentences if (stripped := s.strip())]

def _get_segmenter(language: str) -> pysbd.Segmenter:
    if language not in _SEGMENTER_CACHE:
        _SEGMENTER_CACHE[language] = pysbd.Segmenter(language=language, clean=False)
    return _SEGMENTER_CACHE[language]

async def _ask_user_for_metadata(ctx: Context, field: str, file_path: Path) -> str:
    result = await ctx.session.create_message(
        messages=[
            SamplingMessage(
                role="user",
                content=TextContent(
                    type="text",
                    text=(
                        f"The conversation file '{file_path.name}' is missing a {field}. "
                        f"Please provide the {field} for this conversation. "
                        f"Reply with ONLY the {field} value, nothing else."
                    ),
                ),
            )
        ],
        max_tokens=200,
        temperature=0.0,
    )
    return result.content.text.strip()
