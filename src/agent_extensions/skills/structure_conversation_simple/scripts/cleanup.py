"""Remove temporary working directory created during skill execution."""

import argparse
import json
import shutil
import sys
from pathlib import Path


def cleanup(work_dir: Path) -> dict:
    """Remove the temporary working directory.

    Args:
        work_dir: Path to the temporary working directory to remove.

    Returns:
        Status dict indicating success or error.
    """
    if not work_dir.exists():
        return {"status": "success", "message": "Directory already removed"}

    shutil.rmtree(work_dir)
    return {"status": "success", "message": f"Removed {work_dir}"}


def _fail(message: str) -> None:
    print(json.dumps({"status": "error", "error": message}))
    sys.exit(1)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Clean up temporary working directory")
    parser.add_argument("work_dir", type=Path, help="Working directory to remove")
    args = parser.parse_args()

    result = cleanup(args.work_dir)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _main()
