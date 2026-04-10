# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Create a valid empty knowledge graph file."""

import json
import sys
from pathlib import Path

from models_knowledge_graph import KnowledgeGraph


def init_knowledge_graph(path: Path) -> None:
    """Create an empty knowledge graph at the given path.

    Args:
        path: File path for the new knowledge graph.
    """
    kg = KnowledgeGraph(conversations=[], topics=[], decisions=[])
    path.write_text(kg.model_dump_json(indent=2), encoding="utf-8")


def _main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({"status": "Error", "message": "Expected 1 argument: <knowledge_graph_path>"}))
        sys.exit(1)

    path = Path(sys.argv[1])
    if path.exists():
        print(json.dumps({"status": "AlreadyExists", "path": str(path)}))
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    init_knowledge_graph(path)
    print(json.dumps({"status": "Ok", "path": str(path)}))


if __name__ == "__main__":
    _main()
