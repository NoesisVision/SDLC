"""Cleaning and parsing of conversation transcripts."""

import re

import pysbd
from langdetect import LangDetectException, detect

from .models import CONVERSATION_ID_PATTERN, RawConversationMetadata, RawSpeakerTurn

_PYSBD_LANGUAGES = set(pysbd.languages.LANGUAGE_CODES.keys())
_SEGMENTER_CACHE: dict[str, pysbd.Segmenter] = {}
_LANGUAGE_SAMPLE_SIZE = 1000

_INVISIBLE_CHARS = re.compile(r"[\u200b\u200c\u200d\u200e\u200f\ufeff\u2028\u2029]")
_MULTI_SPACES = re.compile(r" {2,}")
_CAPITALIZE_AFTER_PUNCTUATION = re.compile(r"([.!?]\s+)([a-z])")
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

_TIME = r"\d{1,2}:\d{2}(?::\d{2})?"
_TURN_PATTERN = re.compile(
    rf"^\*\*({_TIME})\*\*\s*\n" r"(.+?)\n" rf"([\s\S]*?)(?=^\*\*{_TIME}\*\*|\Z)",
    re.MULTILINE,
)
_BROKEN_TIME_MARKER = re.compile(rf"^\*\*\s*({_TIME})\s*\*\*", re.MULTILINE)
_SPEAKER_ON_TIMESTAMP_LINE = re.compile(rf"^(\*\*{_TIME}\*\*)[ \t]+(.+)$", re.MULTILINE)
_TITLE_PATTERN = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_DATE_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2})$", re.MULTILINE)


def parse_transcript(raw_text: str) -> tuple[RawConversationMetadata, list[RawSpeakerTurn]]:
    """Parse a transcript into metadata and speaker turns.

    Args:
        raw_text: Raw transcript text (without conversation_id line).

    Returns:
        Tuple of (metadata, speaker_turns).

    Raises:
        ValueError: If no speaker turns are found.
    """
    normalized = _normalize_encoding(raw_text)
    metadata, body = _extract_metadata(normalized)
    language = _detect_language(body)
    turns = _parse_speaker_turns(body, language)
    if not turns:
        raise ValueError("No recognizable speaker turns found")
    return metadata, turns


def strip_conversation_id_line(text: str) -> str:
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


def _extract_metadata(text: str) -> tuple[RawConversationMetadata, str]:
    title_match = _TITLE_PATTERN.search(text)
    title = title_match.group(1).strip() if title_match else None

    date_match = _DATE_PATTERN.search(text)
    date = date_match.group(1).strip() if date_match else None

    body = text
    if title_match:
        body = body[title_match.end() :]
    if date_match:
        body = body.replace(date_match.group(0), "", 1)

    return RawConversationMetadata(title=title, date=date), body.strip()


def _parse_speaker_turns(body: str, language: str) -> list[RawSpeakerTurn]:
    body = _normalize_turn_headers(body)
    turns: list[RawSpeakerTurn] = []

    for match in _TURN_PATTERN.finditer(body):
        time_raw = match.group(1)
        speaker = match.group(2).strip()
        raw_text = match.group(3)

        cleaned = _clean_text_block(raw_text)
        if not cleaned:
            continue

        sentences = _split_sentences(cleaned, language)
        if sentences:
            turns.append(
                RawSpeakerTurn(
                    speaker=speaker,
                    time=_normalize_time(time_raw),
                    sentences=sentences,
                )
            )

    return turns


def _normalize_time(time_str: str) -> str:
    parts = time_str.split(":")
    if len(parts) == 2:
        return f"00:{parts[0].zfill(2)}:{parts[1].zfill(2)}"
    return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{parts[2].zfill(2)}"


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
    text = _CAPITALIZE_AFTER_PUNCTUATION.sub(lambda m: m.group(1) + m.group(2).upper(), text)
    return text


def _split_sentences(text: str, language: str) -> list[str]:
    segmenter = _get_segmenter(language)
    sentences = segmenter.segment(text)
    return [stripped for s in sentences if (stripped := s.strip())]


def _get_segmenter(language: str) -> pysbd.Segmenter:
    if language not in _SEGMENTER_CACHE:
        _SEGMENTER_CACHE[language] = pysbd.Segmenter(language=language, clean=False)
    return _SEGMENTER_CACHE[language]
