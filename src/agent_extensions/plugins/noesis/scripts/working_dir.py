# /// script
# dependencies = []
# ///
"""Create and resolve working directory for conversation analysis."""

import json
import sys
from pathlib import Path


def get_working_dir(transcript_path: Path) -> Path:
    """Return working directory path for a given transcript.

    Args:
        transcript_path: Path to the conversation transcript file.

    Returns:
        Path to the working directory next to the transcript.
    """
    return transcript_path.parent / f"{transcript_path.stem}_work"


def _main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({"status": "Error", "message": "Expected 1 argument: <transcript_path>"}))
        sys.exit(1)

    transcript_path = Path(sys.argv[1])
    if not transcript_path.exists():
        print(json.dumps({"status": "Error", "message": f"File not found: {transcript_path}"}))
        sys.exit(1)

    working_dir = get_working_dir(transcript_path)
    working_dir.mkdir(exist_ok=True)

    print(json.dumps({"status": "Ok", "working_dir": str(working_dir)}))


if __name__ == "__main__":
    _main()
