# /// script
# dependencies = [
#     "pysbd",
#     "langdetect",
#     "pydantic",
# ]
# ///
"""Clean, normalize, parse, and segment a conversation transcript."""

import argparse
import json
import re
from pathlib import Path

import pysbd
from langdetect import LangDetectException, detect
from models import CleanedConversation, SpeakerTurn, CONVERSATION_ID_PATTERN

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
_DATE_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2}(?: \d{1,2}:\d{2})?)$", re.MULTILINE)
_COMPLETE_START_TIME_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$")


def parse_conversation(
    file_path: Path,
    conversation_id: str,
    cleaned_path: Path,
    title_override: str | None,
    date_override: str | None,
) -> dict:
    """Parse a conversation markdown file, write cleaned output file.

    Args:
        file_path: Path to the conversation markdown file.
        conversation_id: Unique identifier for the conversation.
        cleaned_path: Path where the cleaned JSON output will be written.
        title_override: Optional title to use instead of extracted one.
        date_override: Optional date to use instead of extracted one.

    Returns:
        Status dict: 'success' after writing files, or 'incomplete' with missing fields.
    """
    raw_text = file_path.read_text(encoding="utf-8")

    text_without_id = _strip_conversation_id_line(raw_text)
    if not text_without_id.strip():
        raise Exception(f"File is empty: {file_path}")

    normalized = _normalize_encoding(text_without_id)
    title, date, body = _extract_metadata(normalized)
    title = title_override or title
    date = date_override or date

    language = _detect_language(body)
    turns = _parse_speaker_turns(body, language)
    if not turns:
        raise Exception(f"No recognizable speaker turns found in: {file_path}")

    missing: list[str] = []
    if not title:
        missing.append("title")
    if not _is_complete_start_time(date):
        missing.append("date")

    if missing:
        return {"status": "incomplete", "missing": missing}

    cleaned = CleanedConversation(
        conversation_id=conversation_id,
        title=title,
        date=date,
        source_path=str(file_path.resolve()),
        turns=turns,
    )

    _write_cleaned_json(cleaned_path, cleaned)

    return {"status": "success"}


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
    first_turn = _TURN_PATTERN.search(text)
    preamble = text[: first_turn.start()] if first_turn else text

    title_match = _TITLE_PATTERN.search(preamble)
    title = title_match.group(1).strip() if title_match else None

    date_match = _DATE_PATTERN.search(preamble)
    date = date_match.group(1).strip() if date_match else None

    body = text
    if title_match:
        body = body[title_match.end() :]
    if date_match:
        body = body.replace(date_match.group(0), "", 1)

    return title, date, body.strip()


def _is_complete_start_time(date: str | None) -> bool:
    return date is not None and _COMPLETE_START_TIME_PATTERN.match(date) is not None


def _detect_language(text: str) -> str:
    mid = len(text) // 2
    half_sample = _LANGUAGE_SAMPLE_SIZE // 2
    start_sample = text[:half_sample]
    mid_sample = text[mid - half_sample : mid + half_sample]
    sample = start_sample + " " + mid_sample
    try:
        detected = detect(sample)
    except LangDetectException:
        return "en"
    return detected if detected in _PYSBD_LANGUAGES else "en"


def _parse_speaker_turns(body: str, language: str) -> list[SpeakerTurn]:
    body = _normalize_turn_headers(body)
    turns: list[SpeakerTurn] = []

    for match in _TURN_PATTERN.finditer(body):
        time = match.group(1)
        speaker = match.group(2).strip()
        raw_text = match.group(3)

        cleaned = _clean_text_block(raw_text)
        if not cleaned:
            continue

        sentences = _split_sentences(cleaned, language)
        if sentences:
            turns.append(SpeakerTurn(speaker=speaker, time=_normalize_time(time), sentences=sentences))

    for i, turn in enumerate(turns):
        turn.turn_id = _generate_turn_id(i)

    return turns


def _generate_turn_id(index: int) -> str:
    return f"turn_{index + 1:03d}"


def _normalize_time(time_str: str) -> str:
    parts = time_str.split(":")
    if len(parts) == 2:
        return f"00:{int(parts[0]):02d}:{int(parts[1]):02d}"
    return f"{int(parts[0]):02d}:{int(parts[1]):02d}:{int(parts[2]):02d}"


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


def _write_cleaned_json(cleaned_path: Path, cleaned: CleanedConversation) -> None:
    cleaned_path.write_text(
        json.dumps(cleaned.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _main() -> None:
    parser = argparse.ArgumentParser(description="Parse a conversation transcript")
    parser.add_argument("file_path", type=Path, help="Path to conversation markdown")
    parser.add_argument("conversation_id", type=str, help="Unique conversation identifier")
    parser.add_argument("cleaned_path", type=Path, help="Output path for cleaned JSON")
    parser.add_argument("--title", type=str, default=None, help="Override title")
    parser.add_argument("--date", type=str, default=None, help="Override start time (YYYY-MM-DD HH:MM)")
    args = parser.parse_args()

    try:
        if not args.file_path.exists():
            raise Exception(f"File not found: {args.file_path}")
        result = parse_conversation(
            args.file_path, args.conversation_id, args.cleaned_path,
            args.title, args.date,
        )
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    _main()
