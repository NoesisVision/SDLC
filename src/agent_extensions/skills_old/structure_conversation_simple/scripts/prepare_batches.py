"""Create overlapping extraction batches from a parsed conversation."""

import argparse
import json
import sys
from pathlib import Path

_BATCH_SIZE = 25
_OVERLAP = 5


def prepare_batches(work_dir: Path) -> dict:
    """Create overlapping batches from parsed conversation turns.

    Args:
        work_dir: Working directory containing parsed.json.

    Returns:
        Status dict with batch_count.
    """
    parsed_path = work_dir / "parsed.json"
    if not parsed_path.exists():
        _fail(f"parsed.json not found in {work_dir}")

    parsed = json.loads(parsed_path.read_text(encoding="utf-8"))
    turns = parsed["turns"]

    batch_ranges = _compute_batch_ranges(len(turns))
    batches_dir = work_dir / "batches"
    batches_dir.mkdir(parents=True, exist_ok=True)

    for batch_index, (context_start, batch_start, batch_end) in enumerate(batch_ranges):
        context_turns = turns[context_start:batch_start] if context_start < batch_start else None
        extraction_turns = turns[batch_start:batch_end]

        batch_data = {
            "context_turns": context_turns,
            "extraction_turns": extraction_turns,
            "expected_turns_count": len(extraction_turns),
        }

        batch_path = batches_dir / f"batch_{batch_index:03d}.json"
        batch_path.write_text(json.dumps(batch_data, indent=2, ensure_ascii=False), encoding="utf-8")

    return {"status": "success", "batch_count": len(batch_ranges)}


def _compute_batch_ranges(total_turns: int) -> list[tuple[int, int, int]]:
    ranges: list[tuple[int, int, int]] = []
    position = 0

    while position < total_turns:
        batch_end = min(position + _BATCH_SIZE, total_turns)
        context_start = max(0, position - _OVERLAP)
        batch_start = position
        ranges.append((context_start, batch_start, batch_end))
        position = batch_end

    return ranges


def _fail(message: str) -> None:
    print(json.dumps({"status": "error", "error": message}))
    sys.exit(1)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Prepare extraction batches")
    parser.add_argument("work_dir", type=Path, help="Working directory")
    args = parser.parse_args()

    if not args.work_dir.exists():
        _fail(f"Working directory not found: {args.work_dir}")

    result = prepare_batches(args.work_dir)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _main()
