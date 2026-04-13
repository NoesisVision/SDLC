# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Save potential topics to the working directory."""

import json
import sys
from pathlib import Path

from models_core import PotentialTopic, PotentialTopics


def save_potential_topics(working_dir: Path, topics: list[PotentialTopic]) -> None:
    """Save potential topics to possible_topics.json in the working directory.

    Args:
        working_dir: Path to the working directory.
        topics: List of potential topics to save.
    """
    result = PotentialTopics(topics=topics)
    output_path = working_dir / "possible_topics.json"
    output_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")


def _main() -> None:
    if len(sys.argv) != 3:
        print(json.dumps({
            "status": "Error",
            "message": "Usage: save_potential_topics.py <working_dir> <input_file>",
        }))
        sys.exit(1)

    working_dir = Path(sys.argv[1])
    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)

    raw_input = Path(sys.argv[2]).read_text(encoding="utf-8")
    potential_topics = PotentialTopics.model_validate_json(raw_input)
    save_potential_topics(working_dir, potential_topics.topics)

    input_path = Path(sys.argv[2])
    if input_path.exists():
        input_path.unlink()

    print(json.dumps({"status": "Ok", "count": len(potential_topics.topics)}))


if __name__ == "__main__":
    _main()
