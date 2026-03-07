# /// script
# dependencies = [
#     "pysbd",
#     "langdetect",
# ]
# ///
"""Clean, normalize, parse, and segment a conversation transcript."""

import argparse
import json
import re
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pysbd
from langdetect import LangDetectException, detect

_PYSBD_LANGUAGES = set(pysbd.languages.LANGUAGE_CODES.keys())
_SEGMENTER_CACHE: dict[str, pysbd.Segmenter] = {}
_LANGUAGE_SAMPLE_SIZE = 1000

_CONVERSATION_ID_PATTERN = re.compile(r"^<!--\s*conversation_id:\s*([\w-]+)\s*-->")

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


def parse_conversation(file_path: Path, title_override: str | None, date_override: str | None) -> dict:
    """Parse a conversation markdown file into structured turn data.

    Args:
        file_path: Path to the conversation markdown file.
        title_override: Optional title to use instead of extracted one.
        date_override: Optional date to use instead of extracted one.

    Returns:
        Status dict with conversation_id, work_dir, and any missing metadata.
    """
    raw_text = file_path.read_text(encoding="utf-8")
    conversation_id, raw_text = _ensure_conversation_id(file_path, raw_text)
    work_dir = _create_work_dir(file_path)

    text_without_id = _strip_conversation_id_line(raw_text)
    if not text_without_id.strip():
        _fail(f"File is empty: {file_path}")

    normalized = _normalize_encoding(text_without_id)
    title, date, body = _extract_metadata(normalized)
    title = title_override or title
    date = date_override or date

    language = _detect_language(body)
    turns = _parse_speaker_turns(body, language, date)
    if not turns:
        _fail(f"No recognizable speaker turns found in: {file_path}")

    missing = []
    if not title:
        missing.append("title")
    if not _is_complete_start_time(date):
        missing.append("date")

    parsed = {
        "conversation_id": conversation_id,
        "title": title,
        "date": date,
        "language": language,
        "source_path": str(file_path.resolve()),
        "source_stem": file_path.stem,
        "turns": turns,
    }

    parsed_path = work_dir / "parsed.json"
    parsed_path.write_text(json.dumps(parsed, indent=2, ensure_ascii=False), encoding="utf-8")

    status = "success" if not missing else "incomplete"
    return {
        "status": status,
        "conversation_id": conversation_id,
        "work_dir": str(work_dir),
        "missing": missing,
    }


def _ensure_conversation_id(file_path: Path, raw_text: str) -> tuple[str, str]:
    first_line, _, _ = raw_text.partition("\n")
    match = _CONVERSATION_ID_PATTERN.match(first_line)
    if match:
        return match.group(1), raw_text

    conversation_id = str(uuid.uuid4())
    id_line = f"<!-- conversation_id: {conversation_id} -->\n"
    updated_text = id_line + raw_text
    file_path.write_text(updated_text, encoding="utf-8")
    return conversation_id, updated_text


def _create_work_dir(file_path: Path) -> Path:
    project_root = _find_project_root(file_path)
    execution_id = str(uuid.uuid4())
    work_dir = project_root / ".noesis" / "tmp" / execution_id
    work_dir.mkdir(parents=True, exist_ok=True)
    return work_dir


def _find_project_root(start: Path) -> Path:
    current = start.resolve().parent
    while current != current.parent:
        if (current / ".git").exists():
            return current
        current = current.parent
    return start.resolve().parent


def _strip_conversation_id_line(text: str) -> str:
    first_line, _, rest = text.partition("\n")
    if _CONVERSATION_ID_PATTERN.match(first_line):
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


def _is_complete_start_time(date: str | None) -> bool:
    """Return True only if the date string includes both date and time components."""
    return date is not None and _COMPLETE_START_TIME_PATTERN.match(date) is not None


def _detect_language(text: str) -> str:
    sample = text[:_LANGUAGE_SAMPLE_SIZE]
    try:
        detected = detect(sample)
    except LangDetectException:
        return "en"
    return detected if detected in _PYSBD_LANGUAGES else "en"


def _parse_speaker_turns(body: str, language: str, start_datetime: str | None) -> list[dict]:
    body = _normalize_turn_headers(body)
    turns: list[dict] = []

    for match in _TURN_PATTERN.finditer(body):
        time = match.group(1)
        speaker = match.group(2).strip()
        raw_text = match.group(3)

        cleaned = _clean_text_block(raw_text)
        if not cleaned:
            continue

        sentences = _split_sentences(cleaned, language)
        if sentences:
            turns.append({"speaker": speaker, "time": time, "sentences": sentences})

    for i, turn in enumerate(turns):
        turn["turn_id"] = _generate_turn_id(i)

    if start_datetime and _COMPLETE_START_TIME_PATTERN.match(start_datetime) and turns:
        base_relative_time = turns[0]["time"]
        for turn in turns:
            turn["time"] = _calculate_absolute_time(
                start_datetime, turn["time"], base_relative_time
            )

    return turns


def _generate_turn_id(index: int) -> str:
    return f"turn_{index + 1:03d}"


def _calculate_absolute_time(
    start_datetime: str, relative_time: str, base_relative_time: str
) -> str:
    base_dt = datetime.strptime(start_datetime, "%Y-%m-%d %H:%M")
    has_seconds = len(relative_time.split(":")) == 3

    fmt = "%H:%M:%S" if len(relative_time.split(":")) == 3 else "%H:%M"
    base_fmt = "%H:%M:%S" if len(base_relative_time.split(":")) == 3 else "%H:%M"

    current = datetime.strptime(relative_time, fmt)
    base = datetime.strptime(base_relative_time, base_fmt)
    delta = timedelta(
        hours=current.hour - base.hour,
        minutes=current.minute - base.minute,
        seconds=current.second - base.second,
    )

    absolute = base_dt + delta
    output_fmt = "%Y-%m-%d %H:%M:%S" if has_seconds else "%Y-%m-%d %H:%M"
    return absolute.strftime(output_fmt)


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


def _fail(message: str) -> None:
    print(json.dumps({"status": "error", "error": message}))
    sys.exit(1)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Parse a conversation transcript")
    parser.add_argument("file_path", type=Path, help="Path to conversation markdown")
    parser.add_argument("--title", type=str, default=None, help="Override title")
    parser.add_argument("--date", type=str, default=None, help="Override start time (YYYY-MM-DD HH:MM)")
    args = parser.parse_args()

    if not args.file_path.exists():
        _fail(f"File not found: {args.file_path}")

    result = parse_conversation(args.file_path, args.title, args.date)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _main()
