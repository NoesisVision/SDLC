"""Assemble final structured conversation JSON from intermediate artifacts."""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


def build_output(work_dir: Path) -> dict:
    """Build the final structured conversation JSON.

    Args:
        work_dir: Working directory with parsed.json, extractions/, merged_topics.json.

    Returns:
        Status dict with output_path and summary.
    """
    parsed = json.loads((work_dir / "parsed.json").read_text(encoding="utf-8"))
    merged_topics = json.loads((work_dir / "merged_topics.json").read_text(encoding="utf-8"))

    extraction_files = sorted((work_dir / "extractions").glob("batch_*.json"))
    if not extraction_files:
        _fail("No extraction files found")

    label_map = _build_label_map(merged_topics)
    flat_units = _flatten_extractions(parsed["turns"], extraction_files)
    topics = _group_into_topics(flat_units, label_map, merged_topics)

    structured = {
        "conversation_id": parsed["conversation_id"],
        "title": parsed["title"],
        "date": parsed["date"],
        "topics": topics,
    }

    source_path = Path(parsed["source_path"])
    output_path = source_path.parent / f"{parsed['source_stem']}_structured.json"
    output_path.write_text(json.dumps(structured, indent=2, ensure_ascii=False), encoding="utf-8")

    topic_summaries = [{"name": t["name"], "summary": t["summary"]} for t in topics]
    return {
        "status": "success",
        "output_path": str(output_path),
        "title": structured["title"],
        "date": structured["date"],
        "topics": topic_summaries,
    }


def _build_label_map(merged_topics: dict) -> dict[str, str]:
    """Build reverse mapping from source_label to final topic label."""
    label_map: dict[str, str] = {}
    for topic in merged_topics["topics"]:
        final_label = topic["label"]
        for source_label in topic.get("source_labels", []):
            label_map[source_label] = final_label
    return label_map


def _flatten_extractions(
    turns: list[dict], extraction_files: list[Path]
) -> list[dict]:
    """Flatten all extraction batches into a list of idea units with metadata."""
    all_extraction_turns = []
    for ef in extraction_files:
        batch_result = json.loads(ef.read_text(encoding="utf-8"))
        all_extraction_turns.extend(batch_result)

    flat_units = []
    turn_index = 0
    for extraction_turn in all_extraction_turns:
        if turn_index >= len(turns):
            break
        turn = turns[turn_index]
        for iu in extraction_turn.get("idea_units", []):
            category = iu.get("category", "Irrelevant")
            if category == "Irrelevant":
                continue
            flat_units.append(
                {
                    "speaker": turn["speaker"],
                    "time": turn["time"],
                    "sentences": iu["sentences"],
                    "category": category,
                    "topic": iu.get("topic", ""),
                }
            )
        turn_index += 1

    return flat_units


def _group_into_topics(
    flat_units: list[dict],
    label_map: dict[str, str],
    merged_topics: dict,
) -> list[dict]:
    """Group idea units into final topics using the label mapping."""
    topic_order = [t["label"] for t in merged_topics["topics"]]
    summary_map = {t["label"]: t.get("summary", "") for t in merged_topics["topics"]}

    units_by_topic: dict[str, list[dict]] = defaultdict(list)
    for unit in flat_units:
        source_label = unit["topic"]
        final_label = label_map.get(source_label, source_label)
        units_by_topic[final_label].append(unit)

    topics = []
    seen_labels = set()
    for label in topic_order:
        seen_labels.add(label)
        units = units_by_topic.get(label, [])
        if not units:
            continue
        topics.append(_build_topic(label, summary_map.get(label, ""), units))

    for label in sorted(units_by_topic.keys()):
        if label in seen_labels:
            continue
        topics.append(_build_topic(label, "", units_by_topic[label]))

    return topics


def _build_topic(label: str, summary: str, units: list[dict]) -> dict:
    """Build a topic dict with grouped statements."""
    statements_by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for unit in units:
        key = (unit["speaker"], unit["time"])
        statements_by_key[key].append(
            {"sentences": unit["sentences"], "category": unit["category"]}
        )

    statements = [
        {
            "speaker": speaker,
            "time": time,
            "idea_units": idea_units,
        }
        for (speaker, time), idea_units in statements_by_key.items()
    ]

    return {"name": label, "summary": summary, "statements": statements}


def _fail(message: str) -> None:
    print(json.dumps({"status": "error", "error": message}))
    sys.exit(1)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Build final structured conversation output")
    parser.add_argument("work_dir", type=Path, help="Working directory")
    args = parser.parse_args()

    if not args.work_dir.exists():
        _fail(f"Working directory not found: {args.work_dir}")

    for required_file in ["parsed.json", "merged_topics.json"]:
        if not (args.work_dir / required_file).exists():
            _fail(f"Required file not found: {args.work_dir / required_file}")

    if not list((args.work_dir / "extractions").glob("batch_*.json")):
        _fail(f"No extraction files found in: {args.work_dir / 'extractions'}")

    result = build_output(args.work_dir)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _main()
