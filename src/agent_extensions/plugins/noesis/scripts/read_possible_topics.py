# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Read possible_topics.json from the working directory."""

import json
import sys
from pathlib import Path

from models_core import PotentialTopics


def read_possible_topics(working_dir: Path) -> PotentialTopics:
    """Read and validate possible_topics.json from the working directory.

    Args:
        working_dir: Path to the working directory.

    Returns:
        Validated PotentialTopics instance.
    """
    path = working_dir / "possible_topics.json"
    return PotentialTopics.model_validate_json(path.read_bytes())


def _main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({"status": "Error", "message": "Expected 1 argument: <working_dir>"}))
        sys.exit(1)

    working_dir = Path(sys.argv[1])
    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)

    path = working_dir / "possible_topics.json"
    if not path.exists():
        print(json.dumps({"status": "Ok", "topics": []}))
        return

    potential_topics = read_possible_topics(working_dir)
    print(json.dumps({"status": "Ok", **potential_topics.model_dump()}))


if __name__ == "__main__":
    _main()
