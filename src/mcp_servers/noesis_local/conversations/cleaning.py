"""Tools for cleaning and parsing conversation transcripts."""

import logging
import re

import pysbd
from langdetect import LangDetectException, detect

from .models import CleanResponse, ConversationStatus, SetMetadataResponse, SpeakerTurn
from .registry import CONVERSATION_ID_PATTERN, get_conversation

logger = logging.getLogger(__name__)

_PYSBD_LANGUAGES = set(pysbd.languages.LANGUAGE_CODES.keys())
_SEGMENTER_CACHE: dict[str, pysbd.Segmenter] = {}
_LANGUAGE_SAMPLE_SIZE = 1000

_INVISIBLE_CHARS = re.compile(r"[\u200b\u200c\u200d\u200e\u200f\ufeff\u2028\u2029]")
_MULTI_SPACES = re.compile(r" {2,}")
_CAPITALIZE_AFTER_PUNCTATION = re.compile(r"([.!?]\s+)([a-z])")
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
    r"^\*\*(\d{1,2}:\d{2})\*\*\s*\n" r"(.+?)\n" r"([\s\S]*?)(?=^\*\*\d{1,2}:\d{2}\*\*|\Z)",
    re.MULTILINE,
)
_BROKEN_TIME_MARKER = re.compile(r"^\*\*\s*(\d{1,2}:\d{2})\s*\*\*", re.MULTILINE)
_SPEAKER_ON_TIMESTAMP_LINE = re.compile(r"^(\*\*\d{1,2}:\d{2}\*\*)[ \t]+(.+)$", re.MULTILINE)
_TITLE_PATTERN = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_DATE_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2})$", re.MULTILINE)


async def clean_conversation(conversation_id: str) -> CleanResponse:
    """Clean and parse a conversation transcript from a markdown file.

    Reads the file, normalizes encoding, extracts metadata, detects language,
    and parses speaker turns into sentences. Stores results in memory.

    Args:
        conversation_id: UUID identifying the conversation.

    Returns:
        Status indicating success or missing metadata fields.
    """
    state = get_conversation(conversation_id)
    raw_text = state.source_path.read_text(encoding="utf-8")
    raw_text = _strip_conversation_id_line(raw_text)

    if not raw_text.strip():
        raise ValueError(f"File is empty: {state.source_path}")

    normalized_text = _normalize_encoding(raw_text)
    state.normalized_text = normalized_text
    state.status = ConversationStatus.NORMALIZED

    title, date, body = _extract_metadata(normalized_text)
    language = _detect_language(body)
    turns = _parse_speaker_turns(body, language)
    if not turns:
        raise ValueError(f"No recognizable speaker turns found in: {state.source_path}")
    state.turns = turns
    state.status = ConversationStatus.SPEAKER_TURNS_EXTRACTED

    state.title = title
    state.date = date
    missing = []
    if not title:
        missing.append("title")
    if not date:
        missing.append("date")
    if len(missing) > 0:
        return CleanResponse(status="incomplete", missing=missing)

    state.status = ConversationStatus.METADATA_ASSIGNED
    return CleanResponse(status="success", missing=[])


async def set_conversation_metadata(conversation_id: str, title: str = "", date: str = "") -> SetMetadataResponse:
    """Apply missing metadata and finalize cleaned conversation data.

    Reads typed fields from state, applies provided title/date overrides.

    Args:
        conversation_id: UUID identifying the conversation.
        title: Conversation title (uses existing value if empty).
        date: Conversation date in YYYY-MM-DD format (uses existing value if empty).

    Returns:
        Status indicating success.
    """
    state = get_conversation(conversation_id)

    if state.turns is None:
        raise ValueError(f"No speaker turns found for conversation {conversation_id}")

    resolved_title = title or state.title
    if not resolved_title:
        raise ValueError("Title is required but not provided")
    state.title = resolved_title

    resolved_date = date or state.date
    if not resolved_date:
        raise ValueError("Date is required but not provided")
    state.date = resolved_date

    state.status = ConversationStatus.METADATA_ASSIGNED
    return SetMetadataResponse(status="success")


def _strip_conversation_id_line(text: str) -> str:
    first_line, _, rest = text.partition("\n")
    if CONVERSATION_ID_PATTERN.match(first_line):
        return rest
    return text


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


def _parse_speaker_turns(body: str, language: str) -> list[SpeakerTurn]:
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


def _detect_language(text: str) -> str:
    sample = text[:_LANGUAGE_SAMPLE_SIZE]
    try:
        detected = detect(sample)
    except LangDetectException:
        return "en"
    return detected if detected in _PYSBD_LANGUAGES else "en"


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
    text = _CAPITALIZE_AFTER_PUNCTATION.sub(lambda m: m.group(1) + m.group(2).upper(), text)
    return text


def _split_sentences(text: str, language: str) -> list[str]:
    segmenter = _get_segmenter(language)
    sentences = segmenter.segment(text)
    return [stripped for s in sentences if (stripped := s.strip())]


def _get_segmenter(language: str) -> pysbd.Segmenter:
    if language not in _SEGMENTER_CACHE:
        _SEGMENTER_CACHE[language] = pysbd.Segmenter(language=language, clean=False)
    return _SEGMENTER_CACHE[language]
