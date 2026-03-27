"""Collect topic groups from extraction results."""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


def collect_topic_groups(work_dir: Path) -> dict:
    """Group non-Irrelevant idea units by their topic labels.

    Args:
        work_dir: Working directory containing parsed.json and extractions/.

    Returns:
        Status dict with path to topic_groups.json.
    """
    parsed = json.loads((work_dir / "parsed.json").read_text(encoding="utf-8"))
    turns = parsed["turns"]

    extraction_files = sorted(
        (work_dir / "extractions").glob("batch_*.json"),
        key=lambda p: int(p.stem.split("_")[1]),
    )
    if not extraction_files:
        _fail("No extraction files found")

    flat_units = _flatten_extractions(turns, extraction_files)
    groups = _group_by_topic(flat_units)
    topic_groups = _build_topic_groups(groups)

    output_path = work_dir / "topic_groups.json"
    output_path.write_text(
        json.dumps({"topic_groups": topic_groups}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return {
        "status": "success",
        "topic_group_count": len(topic_groups),
        "output_path": str(output_path),
    }


def _build_topic_groups(
    groups: dict[str, list[dict]],
) -> list[dict]:
    topic_groups = []
    for label in sorted(groups.keys()):
        units = groups[label]
        categories = sorted({u["category"] for u in units})
        representative_texts = [
            f"[{u['speaker']}, {u['time']}] {' '.join(u['sentences'])}"
            for u in units[:8]
        ]
        topic_groups.append(
            {
                "label": label,
                "count": len(units),
                "categories": categories,
                "representative_texts": representative_texts,
            }
        )
    return topic_groups


def _flatten_extractions(
    turns: list[dict], extraction_files: list[Path]
) -> list[dict]:
    turn_lookup = {t["turn_id"]: t for t in turns}

    all_extraction_turns = []
    for ef in extraction_files:
        batch_result = json.loads(ef.read_text(encoding="utf-8"))
        all_extraction_turns.extend(batch_result)

    flat_units = []
    for extraction_turn in all_extraction_turns:
        turn_id = extraction_turn["turn_id"]
        source_turn = turn_lookup[turn_id]
        for iu in extraction_turn.get("idea_units", []):
            category = iu.get("category", "Irrelevant")
            if category == "Irrelevant":
                continue
            topic = iu.get("topic")
            if not topic:
                continue
            flat_units.append(
                {
                    "speaker": source_turn["speaker"],
                    "time": source_turn["time"],
                    "sentences": iu["sentences"],
                    "category": category,
                    "topic": topic,
                }
            )

    return flat_units


def _group_by_topic(flat_units: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for unit in flat_units:
        groups[unit["topic"]].append(unit)
    return groups


def _fail(message: str) -> None:
    print(json.dumps({"status": "error", "error": message}))
    sys.exit(1)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Collect topic groups from extractions")
    parser.add_argument("work_dir", type=Path, help="Working directory")
    args = parser.parse_args()

    if not args.work_dir.exists():
        _fail(f"Working directory not found: {args.work_dir}")

    result = collect_topic_groups(args.work_dir)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _main()
