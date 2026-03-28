"""Generate JSON Schema from Pydantic DesignDoc and DesignDocDiff models."""

import json
from pathlib import Path

from contracts.design_doc_diff_schema import DesignDocDiff
from contracts.design_doc_schema import DesignDoc


def _write_schema(model: type, filename: str) -> None:
    schema = model.model_json_schema()
    output_path = Path(__file__).parent / filename
    output_path.write_text(json.dumps(schema, indent=2) + "\n")
    print(f"JSON Schema written to {output_path}")


def main() -> None:
    _write_schema(DesignDoc, "design-doc-schema.json")
    _write_schema(DesignDocDiff, "design-doc-diff-schema.json")


if __name__ == "__main__":
    main()
