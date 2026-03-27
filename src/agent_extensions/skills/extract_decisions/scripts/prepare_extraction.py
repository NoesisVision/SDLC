# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Check for existing extraction outputs, create file paths and working directory."""

import argparse
import json
import uuid
from pathlib import Path

from models import CONVERSATION_ID_PATTERN


def prepare_extraction(file_path: Path, force: bool = False) -> dict:
    """Check for existing output files and prepare working directory.

    Args:
        file_path: Path to the conversation markdown file.
        force: If True, delete existing output files and proceed.

    Returns:
        Status dict with computed paths or info about existing files.
    """
    cleaned_path = file_path.parent / f"{file_path.stem}_cleaned.json"
    structured_path = file_path.parent / f"{file_path.stem}_structured.json"

    existing_files = [str(p) for p in [cleaned_path, structured_path] if p.exists()]
    if existing_files and not force:
        return {
            "status": "exists",
            "existing_files": existing_files,
        }

    _delete_if_exists(cleaned_path)
    _delete_if_exists(structured_path)

    conversation_id = _ensure_conversation_id(file_path)
    work_dir = _create_work_dir(file_path, conversation_id)

    return {
        "status": "success",
        "conversation_id": conversation_id,
        "work_dir": str(work_dir),
        "cleaned_path": str(cleaned_path.resolve()),
        "structured_path": str(structured_path.resolve()),
    }


def _delete_if_exists(path: Path) -> None:
    if path.exists():
        path.unlink()


def _ensure_conversation_id(file_path: Path) -> str:
    raw_text = file_path.read_text(encoding="utf-8")
    first_line, _, _ = raw_text.partition("\n")
    match = CONVERSATION_ID_PATTERN.match(first_line)
    if match:
        return match.group(1)

    conversation_id = str(uuid.uuid4())
    id_line = f"<!-- conversation_id: {conversation_id} -->\n"
    file_path.write_text(id_line + raw_text, encoding="utf-8")
    return conversation_id


def _create_work_dir(file_path: Path, conversation_id: str) -> Path:
    project_root = _find_project_root(file_path)
    work_dir = project_root / ".noesis" / "tmp" / conversation_id
    work_dir.mkdir(parents=True, exist_ok=True)
    return work_dir


def _find_project_root(start: Path) -> Path:
    current = start.resolve().parent
    while current != current.parent:
        if (current / ".git").exists():
            return current
        current = current.parent
    return start.resolve().parent


def _main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare conversation for decision extraction"
    )
    parser.add_argument("file_path", type=Path, help="Path to conversation markdown")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Delete existing output files and proceed",
    )
    args = parser.parse_args()

    try:
        if not args.file_path.exists():
            raise FileNotFoundError(f"File not found: {args.file_path}")
        result = prepare_extraction(args.file_path, args.force)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    _main()
