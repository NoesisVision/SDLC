# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Load a batch file for processing by the topics extractor subagent."""

import argparse
import json
from pathlib import Path

from models import Batch


def load_batch(work_dir: Path, batch_index: int) -> dict:
    """Load and validate a batch file.

    Args:
        work_dir: Working directory containing the batches subdirectory.
        batch_index: Zero-based index of the batch to load.

    Returns:
        Dict with status and batch data.
    """
    batch_path = work_dir / "batches" / f"batch_{batch_index:03d}.json"
    if not batch_path.exists():
        raise Exception(f"Batch file not found: {batch_path}")

    batch = Batch.model_validate_json(batch_path.read_text(encoding="utf-8"))

    return {"status": "success", "batch": batch.model_dump()}


def _main() -> None:
    parser = argparse.ArgumentParser(description="Load a batch file for processing")
    parser.add_argument("--work-dir", type=Path, required=True, help="Working directory with batches")
    parser.add_argument("--batch-index", type=int, required=True, help="Batch index to load")
    args = parser.parse_args()

    try:
        result = load_batch(args.work_dir, args.batch_index)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    _main()
