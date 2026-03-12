# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Validate and save a decision record JSON file to the output directory."""

import argparse
import json
from pathlib import Path

from models import DecisionRecord
from pydantic import ValidationError


def save_decision_record(output_dir: Path, topic_id: str, input_file: Path) -> dict:
    """Validate and save a decision record to the output directory.

    Args:
        output_dir: Directory where decision record files are stored.
        topic_id: Topic ID this decision belongs to.
        input_file: Path to JSON file with the decision record data.

    Returns:
        Status dict with the saved file path and decision index.
    """
    if not output_dir.exists():
        raise Exception(f"Output directory not found: {output_dir}")

    if not input_file.exists():
        raise Exception(f"Input file not found: {input_file}")

    try:
        record = DecisionRecord.model_validate_json(input_file.read_text(encoding="utf-8"))
    except ValidationError as e:
        raise Exception(f"Invalid decision record: {e}") from e

    decision_index = _next_decision_index(output_dir, topic_id)
    filename = f"{topic_id}_decision_{decision_index:03d}.json"
    file_path = output_dir / filename

    file_path.write_text(json.dumps(record.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8")

    return {
        "status": "success",
        "file_path": str(file_path),
        "decision_index": decision_index,
    }


def _next_decision_index(output_dir: Path, topic_id: str) -> int:
    existing = sorted(output_dir.glob(f"{topic_id}_decision_*.json"))
    if not existing:
        return 1
    last_name = existing[-1].stem
    last_index_str = last_name.rsplit("_", 1)[-1]
    return int(last_index_str) + 1


def _main() -> None:
    parser = argparse.ArgumentParser(description="Save a decision record")
    parser.add_argument("--output-dir", type=Path, required=True, help="Decision records output directory")
    parser.add_argument("--topic-id", required=True, help="Topic ID this decision belongs to")
    parser.add_argument("--input-file", type=Path, required=True, help="JSON file with decision record data")
    args = parser.parse_args()

    try:
        result = save_decision_record(args.output_dir, args.topic_id, args.input_file)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    _main()
