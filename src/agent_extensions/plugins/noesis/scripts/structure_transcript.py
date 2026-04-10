# /// script
# dependencies = [
#     "pysbd",
#     "langdetect",
#     "pydantic",
# ]
# ///
"""Clean, normalize, parse, and segment a conversation transcript."""

import json
import re
import sys
from pathlib import Path

import pysbd
from langdetect import LangDetectException, detect
from models_transcript import CONVERSATION_ID_PATTERN, RawTranscript, RawTurn
from working_dir import get_working_dir

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


def structure_transcript(file_path: Path, conversation_id: str) -> dict:
    """Parse a conversation markdown file, write structured JSON next to it.

    Args:
        file_path: Path to the conversation markdown file.
        conversation_id: Unique identifier for the conversation.

    Returns:
        Status dict with 'status' and 'output_path'.
    """
    raw_text = file_path.read_text(encoding="utf-8")

    body = _strip_conversation_id_line(raw_text)
    if not body.strip():
        return {"status": "Error", "message": f"File is empty: {file_path}"}

    body = _normalize_encoding(body)
    body = _strip_preamble(body)

    language = _detect_language(body)
    turns = _parse_speaker_turns(body, language)
    if not turns:
        return {"status": "Error", "message": f"No recognizable speaker turns found in: {file_path}"}

    transcript = RawTranscript(conversation_id=conversation_id, turns=turns)
    output_path = get_working_dir(file_path) / f"{file_path.stem}.json"
    _write_json(output_path, transcript)

    return {"status": "Ok", "output_path": str(output_path)}


def _strip_conversation_id_line(text: str) -> str:
    first_line, _, rest = text.partition("\n")
    if CONVERSATION_ID_PATTERN.match(first_line):
        return rest
    return text


def _strip_preamble(text: str) -> str:
    first_turn = _TURN_PATTERN.search(text)
    if first_turn:
        return text[first_turn.start():]
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


def _parse_speaker_turns(body: str, language: str) -> list[RawTurn]:
    body = _normalize_turn_headers(body)
    turns: list[RawTurn] = []

    for match in _TURN_PATTERN.finditer(body):
        time = match.group(1)
        speaker = match.group(2).strip()
        raw_text = match.group(3)

        cleaned = _clean_text_block(raw_text)
        if not cleaned:
            continue

        sentences = _split_sentences(cleaned, language)
        if sentences:
            turns.append(RawTurn(speaker=speaker, time=_normalize_time(time), sentences=sentences))

    return turns


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


def _write_json(path: Path, transcript: RawTranscript) -> None:
    path.write_text(transcript.model_dump_json(indent=2), encoding="utf-8")


def _main() -> None:
    if len(sys.argv) != 3:
        print(json.dumps({"status": "Error", "message": "Expected 2 arguments: <transcript_path> <conversation_id>"}))
        sys.exit(1)

    file_path = Path(sys.argv[1])
    conversation_id = sys.argv[2]

    if not file_path.exists():
        print(json.dumps({"status": "Error", "message": f"File not found: {file_path}"}))
        sys.exit(1)

    result = structure_transcript(file_path, conversation_id)
    print(json.dumps(result))


if __name__ == "__main__":
    _main()
