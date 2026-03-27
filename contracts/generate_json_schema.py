"""Generate JSON Schema from Pydantic DesignDoc model."""

import json
from pathlib import Path

from contracts.design_doc_schema import DesignDoc


def main() -> None:
    schema = DesignDoc.model_json_schema()
    output_path = Path(__file__).parent / "design-doc-schema.json"
    output_path.write_text(json.dumps(schema, indent=2) + "\n")
    print(f"JSON Schema written to {output_path}")


if __name__ == "__main__":
    main()
