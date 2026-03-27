# Design Doc Contract Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 11-class design doc schema with a simplified unified BuildingBlock model, add DomainConcept, structured Scenario, and generate JSON Schema.

**Architecture:** Single Pydantic schema file (`contracts/design_doc_schema.py`) serves as source of truth. A script generates `contracts/design-doc-schema.json` from it. Tests validate both schema correctness and round-trip JSON parsing.

**Tech Stack:** Python 3.14, Pydantic v2, pytest, uv

**Spec:** `docs/superpowers/specs/2026-03-27-design-doc-contract-design.md`

**Branch:** `design-doc` (existing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `contracts/design_doc_schema.py` | Modify | Pydantic schema — source of truth |
| `contracts/design-doc-schema.json` | Regenerate | Generated JSON Schema for Java validation |
| `contracts/generate_json_schema.py` | Create | Script to generate JSON Schema from Pydantic |
| `tests/contracts/test_design_doc_schema.py` | Create | Schema validation tests |
| `tests/contracts/conftest.py` | Create | Shared fixtures (sample design doc data) |

---

## Chunk 0: Prerequisites

### Task 0: Ensure pydantic is in project dependencies

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Check if pydantic is already a transitive dependency**

Run: `uv run python -c "import pydantic; print(pydantic.__version__)"`

- [ ] **Step 2: If not available, add pydantic to dependencies in pyproject.toml**

Add `"pydantic>=2.0.0"` to the `dependencies` list in `pyproject.toml`.

- [ ] **Step 3: Run uv sync**

Run: `uv sync`

- [ ] **Step 4: Commit if changed**

```bash
git add pyproject.toml uv.lock
git commit -m "chore: add pydantic to project dependencies"
```

---

## Chunk 1: Schema Implementation

### Task 1: Write tests for enums and base types

**Files:**
- Create: `tests/contracts/__init__.py`
- Create: `tests/contracts/conftest.py`
- Create: `tests/contracts/test_design_doc_schema.py`

- [ ] **Step 1: Create test directory and empty init**

```bash
mkdir -p tests/contracts
touch tests/contracts/__init__.py
```

- [ ] **Step 2: Write conftest with sample data fixture**

Create `tests/contracts/conftest.py`:

```python
import pytest


@pytest.fixture
def sample_design_doc_data() -> dict:
    return {
        "actors": [
            {"id": "actor-1", "name": "Customer", "description": "End user placing orders"}
        ],
        "businessGoals": [
            {"id": "bg-1", "name": "Enable online ordering", "description": "Allow customers to place orders online"}
        ],
        "domainConcepts": [
            {"id": "dc-1", "name": "Order", "description": "A request to purchase products"},
            {"id": "dc-2", "name": "OrderItem", "description": "A single product line within an order"},
        ],
        "rules": [
            {
                "id": "rule-1",
                "ruleType": "Consistency",
                "description": "Order total must equal sum of item prices",
            },
            {
                "id": "rule-2",
                "ruleType": "State change",
                "description": "Order can only be cancelled before shipping",
            },
        ],
        "qualityAttributes": [
            {
                "id": "qa-1",
                "name": "Order placement latency",
                "type": "performance",
                "description": "Order placement must complete within 500ms",
            }
        ],
        "boundedContexts": [
            {
                "id": "bc-1",
                "name": "Ordering",
                "description": "Handles order lifecycle",
                "modules": [
                    {
                        "id": "mod-1",
                        "name": "Order Management",
                        "description": "Core order processing",
                        "buildingBlocks": ["bb-1", "bb-2", "bb-3", "bb-4"],
                    }
                ],
                "buildingBlocks": [],
            }
        ],
        "buildingBlocks": [
            {
                "id": "bb-1",
                "name": "Order",
                "type": "aggregate",
                "description": "Order aggregate root. Contains OrderItem entities.",
                "properties": [
                    {"name": "id", "type": "OrderId"},
                    {"name": "status", "type": "OrderStatus"},
                    {"name": "total", "type": "Money"},
                ],
                "behaviours": [
                    {
                        "name": "place",
                        "description": "Places a new order",
                        "input": ["bb-3"],
                        "output": ["bb-4"],
                        "rules": ["rule-1"],
                    }
                ],
            },
            {
                "id": "bb-2",
                "name": "OrderItem",
                "type": "entity",
                "description": "A line item within an Order aggregate",
                "properties": [
                    {"name": "productId", "type": "ProductId"},
                    {"name": "quantity", "type": "int"},
                    {"name": "price", "type": "Money"},
                ],
                "behaviours": [],
            },
            {
                "id": "bb-3",
                "name": "PlaceOrder",
                "type": "domain_command",
                "description": "Command to place a new order",
                "properties": [
                    {"name": "customerId", "type": "CustomerId"},
                    {"name": "items", "type": "list[OrderItemData]"},
                ],
                "behaviours": [],
            },
            {
                "id": "bb-4",
                "name": "OrderPlaced",
                "type": "domain_event",
                "description": "Event emitted when an order is successfully placed",
                "properties": [
                    {"name": "orderId", "type": "OrderId"},
                    {"name": "customerId", "type": "CustomerId"},
                    {"name": "total", "type": "Money"},
                ],
                "behaviours": [],
            },
        ],
        "useCases": [
            {
                "id": "uc-1",
                "name": "Place Order",
                "actor": "actor-1",
                "type": "Command",
                "description": "Customer places a new order with selected products",
                "businessGoal": "bg-1",
                "input": ["bb-3"],
                "output": ["bb-4"],
                "usedBuildingBlocks": ["bb-1", "bb-2"],
                "rules": ["rule-1", "rule-2"],
                "scenarios": [
                    {
                        "name": "Successful order placement",
                        "description": "Customer places an order with valid items",
                        "given": "A customer with items in cart",
                        "when": "The customer submits the order",
                        "then": "An OrderPlaced event is emitted and order status is PLACED",
                    }
                ],
                "qualities": ["qa-1"],
            }
        ],
        "scenarios": [
            {
                "name": "Successful order placement",
                "description": "Customer places an order with valid items",
                "given": "A customer with items in cart",
                "when": "The customer submits the order",
                "then": "An OrderPlaced event is emitted and order status is PLACED",
            }
        ],
    }
```

- [ ] **Step 3: Write failing tests**

Create `tests/contracts/test_design_doc_schema.py`:

```python
from contracts.design_doc_schema import (
    Actor,
    Behaviour,
    BuildingBlock,
    BuildingBlockType,
    BoundedContext,
    BusinessGoal,
    DesignDoc,
    DomainConcept,
    DomainModule,
    Property,
    QualityAttribute,
    QualityAttributeType,
    Rule,
    RuleType,
    Scenario,
    UseCase,
    UseCaseType,
)


class TestEnums:
    def test_rule_type_values(self) -> None:
        assert RuleType.CONSISTENCY == "Consistency"
        assert RuleType.STRUCTURE == "Structure"
        assert RuleType.COMPUTATION == "Computation"
        assert RuleType.STATE_CHANGE == "State change"

    def test_use_case_type_values(self) -> None:
        assert UseCaseType.COMMAND == "Command"
        assert UseCaseType.EVENT == "Event"
        assert UseCaseType.QUERY == "Query"

    def test_quality_attribute_type_values(self) -> None:
        assert QualityAttributeType.PERFORMANCE == "performance"
        assert QualityAttributeType.AVAILABILITY == "availability"
        assert QualityAttributeType.SECURITY == "security"
        assert QualityAttributeType.OTHER == "other"

    def test_quality_attribute_type_has_no_capex_opex(self) -> None:
        values = [e.value for e in QualityAttributeType]
        assert "CAPEX" not in values
        assert "OPEX" not in values

    def test_building_block_type_values(self) -> None:
        expected = {
            "aggregate", "entity", "value_object",
            "domain_event", "domain_command", "domain_query",
            "domain_service", "application_service",
            "repository", "factory", "external_integration",
        }
        actual = {e.value for e in BuildingBlockType}
        assert actual == expected


class TestBaseTypes:
    def test_property_creation(self) -> None:
        prop = Property(name="orderId", type="UUID")
        assert prop.name == "orderId"
        assert prop.type == "UUID"

    def test_behaviour_with_defaults(self) -> None:
        b = Behaviour(name="place", description="Places an order")
        assert b.input == []
        assert b.output == []
        assert b.rules == []

    def test_behaviour_with_references(self) -> None:
        b = Behaviour(
            name="place",
            description="Places an order",
            input=["bb-1"],
            output=["bb-2"],
            rules=["rule-1"],
        )
        assert b.input == ["bb-1"]
        assert b.output == ["bb-2"]
        assert b.rules == ["rule-1"]

    def test_rule_creation(self) -> None:
        r = Rule(id="r-1", ruleType="Consistency", description="Must be valid")
        assert r.id == "r-1"
        assert r.rule_type == RuleType.CONSISTENCY
        assert r.description == "Must be valid"


class TestDomainElements:
    def test_actor(self) -> None:
        a = Actor(id="a-1", name="Customer", description="End user")
        assert a.id == "a-1"

    def test_business_goal(self) -> None:
        bg = BusinessGoal(id="bg-1", name="Revenue", description="Increase revenue")
        assert bg.id == "bg-1"

    def test_domain_concept(self) -> None:
        dc = DomainConcept(id="dc-1", name="Order", description="A purchase request")
        assert dc.id == "dc-1"

    def test_scenario_structured(self) -> None:
        s = Scenario(
            name="Happy path",
            description="Order is placed successfully",
            given="A customer with items",
            when="Customer submits order",
            then="Order is created",
        )
        assert s.given == "A customer with items"
        assert s.when == "Customer submits order"
        assert s.then == "Order is created"

    def test_quality_attribute(self) -> None:
        qa = QualityAttribute(
            id="qa-1", name="Latency", type="performance", description="< 500ms"
        )
        assert qa.type == QualityAttributeType.PERFORMANCE


class TestBuildingBlock:
    def test_building_block_creation(self) -> None:
        bb = BuildingBlock(
            id="bb-1",
            name="Order",
            type="aggregate",
            description="Order aggregate root",
            properties=[Property(name="id", type="OrderId")],
            behaviours=[Behaviour(name="place", description="Places order")],
        )
        assert bb.type == BuildingBlockType.AGGREGATE
        assert len(bb.properties) == 1
        assert len(bb.behaviours) == 1

    def test_building_block_defaults(self) -> None:
        bb = BuildingBlock(
            id="bb-1",
            name="OrderPlaced",
            type="domain_event",
            description="Event emitted on order placement",
        )
        assert bb.properties == []
        assert bb.behaviours == []


class TestOrganizationalStructure:
    def test_domain_module(self) -> None:
        dm = DomainModule(
            id="mod-1",
            name="Order Management",
            description="Core orders",
            buildingBlocks=["bb-1", "bb-2"],
        )
        assert dm.building_blocks == ["bb-1", "bb-2"]

    def test_bounded_context_with_modules(self) -> None:
        bc = BoundedContext(
            id="bc-1",
            name="Ordering",
            description="Order context",
            modules=[
                DomainModule(
                    id="mod-1",
                    name="Order Management",
                    description="Core orders",
                    buildingBlocks=["bb-1"],
                )
            ],
            buildingBlocks=["bb-5"],
        )
        assert len(bc.modules) == 1
        assert bc.building_blocks == ["bb-5"]


class TestUseCase:
    def test_use_case_full(self) -> None:
        uc = UseCase(
            id="uc-1",
            name="Place Order",
            actor="actor-1",
            type="Command",
            description="Customer places order",
            businessGoal="bg-1",
            input=["bb-3"],
            output=["bb-4"],
            usedBuildingBlocks=["bb-1", "bb-2"],
            rules=["rule-1"],
            scenarios=[
                Scenario(
                    name="Happy path",
                    description="Success",
                    given="Items in cart",
                    when="Submit",
                    then="Order placed",
                )
            ],
            qualities=["qa-1"],
        )
        assert uc.business_goal == "bg-1"
        assert uc.used_building_blocks == ["bb-1", "bb-2"]
        assert len(uc.scenarios) == 1

    def test_use_case_optional_fields(self) -> None:
        uc = UseCase(
            id="uc-1",
            name="List Orders",
            actor="actor-1",
            type="Query",
        )
        assert uc.description is None
        assert uc.business_goal is None
        assert uc.input == []
        assert uc.used_building_blocks == []
        assert uc.scenarios == []


class TestDesignDoc:
    def test_full_design_doc_from_json(self, sample_design_doc_data: dict) -> None:
        doc = DesignDoc.model_validate(sample_design_doc_data)
        assert len(doc.actors) == 1
        assert len(doc.business_goals) == 1
        assert len(doc.domain_concepts) == 2
        assert len(doc.rules) == 2
        assert len(doc.quality_attributes) == 1
        assert len(doc.bounded_contexts) == 1
        assert len(doc.building_blocks) == 4
        assert len(doc.use_cases) == 1
        assert len(doc.scenarios) == 1

    def test_design_doc_round_trip(self, sample_design_doc_data: dict) -> None:
        doc = DesignDoc.model_validate(sample_design_doc_data)
        exported = doc.model_dump(by_alias=True)
        doc_again = DesignDoc.model_validate(exported)
        assert doc == doc_again

    def test_design_doc_minimal(self) -> None:
        doc = DesignDoc()
        assert doc.actors == []
        assert doc.building_blocks == []
        assert doc.use_cases == []

    def test_json_schema_generation(self) -> None:
        schema = DesignDoc.model_json_schema()
        assert schema["type"] == "object"
        assert "$defs" in schema
        assert "BuildingBlock" in schema["$defs"]
        assert "BuildingBlockType" in schema["$defs"]
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `uv run pytest tests/contracts/test_design_doc_schema.py -v`
Expected: FAIL — imports fail because schema still has old structure (no `BuildingBlock`, no `BuildingBlockType`, etc.)

- [ ] **Step 5: Commit failing tests**

```bash
git add tests/contracts/
git commit -m "test: add tests for simplified design doc schema"
```

---

### Task 2: Rewrite schema to match new design

**Files:**
- Modify: `contracts/design_doc_schema.py` (full rewrite)

- [ ] **Step 1: Rewrite the schema**

Replace entire content of `contracts/design_doc_schema.py` with:

```python
from enum import Enum

from pydantic import BaseModel, Field


class BuildingBlockType(str, Enum):
    AGGREGATE = "aggregate"
    ENTITY = "entity"
    VALUE_OBJECT = "value_object"
    DOMAIN_EVENT = "domain_event"
    DOMAIN_COMMAND = "domain_command"
    DOMAIN_QUERY = "domain_query"
    DOMAIN_SERVICE = "domain_service"
    APPLICATION_SERVICE = "application_service"
    REPOSITORY = "repository"
    FACTORY = "factory"
    EXTERNAL_INTEGRATION = "external_integration"


class QualityAttributeType(str, Enum):
    PERFORMANCE = "performance"
    AVAILABILITY = "availability"
    SECURITY = "security"
    OTHER = "other"


class RuleType(str, Enum):
    CONSISTENCY = "Consistency"
    STRUCTURE = "Structure"
    COMPUTATION = "Computation"
    STATE_CHANGE = "State change"


class UseCaseType(str, Enum):
    COMMAND = "Command"
    EVENT = "Event"
    QUERY = "Query"


class Property(BaseModel):
    name: str
    type: str


class Behaviour(BaseModel):
    name: str
    description: str
    input: list[str] = Field(default_factory=list, description="List of BuildingBlock ids")
    output: list[str] = Field(default_factory=list, description="List of BuildingBlock ids")
    rules: list[str] = Field(default_factory=list, description="List of Rule ids")


class Rule(BaseModel):
    id: str
    rule_type: RuleType = Field(alias="ruleType")
    description: str


class Actor(BaseModel):
    id: str
    name: str
    description: str


class BusinessGoal(BaseModel):
    id: str
    name: str
    description: str


class DomainConcept(BaseModel):
    id: str
    name: str
    description: str


class QualityAttribute(BaseModel):
    id: str
    name: str
    type: QualityAttributeType
    description: str


class Scenario(BaseModel):
    name: str
    description: str
    given: str
    when: str
    then: str


class BuildingBlock(BaseModel):
    id: str
    name: str
    type: BuildingBlockType
    description: str
    properties: list[Property] = []
    behaviours: list[Behaviour] = []


class DomainModule(BaseModel):
    id: str
    name: str
    description: str
    building_blocks: list[str] = Field(
        default_factory=list, alias="buildingBlocks", description="List of BuildingBlock ids"
    )


class BoundedContext(BaseModel):
    id: str
    name: str
    description: str
    modules: list[DomainModule] = []
    building_blocks: list[str] = Field(
        default_factory=list,
        alias="buildingBlocks",
        description="List of BuildingBlock ids not in any module",
    )


class UseCase(BaseModel):
    id: str
    name: str
    actor: str = Field(description="Reference to an Actor id")
    type: UseCaseType
    description: str | None = None
    business_goal: str | None = Field(
        default=None, alias="businessGoal", description="Reference to a BusinessGoal id"
    )
    input: list[str] = Field(default_factory=list, description="List of BuildingBlock ids")
    output: list[str] = Field(default_factory=list, description="List of BuildingBlock ids")
    used_building_blocks: list[str] = Field(
        default_factory=list, alias="usedBuildingBlocks", description="List of BuildingBlock ids"
    )
    rules: list[str] = Field(default_factory=list, description="List of Rule ids")
    scenarios: list[Scenario] = []
    qualities: list[str] = Field(default_factory=list, description="List of QualityAttribute ids")


class DesignDoc(BaseModel):
    model_config = {"populate_by_name": True}

    actors: list[Actor] = []
    business_goals: list[BusinessGoal] = Field(default_factory=list, alias="businessGoals")
    domain_concepts: list[DomainConcept] = Field(default_factory=list, alias="domainConcepts")
    rules: list[Rule] = []
    quality_attributes: list[QualityAttribute] = Field(
        default_factory=list, alias="qualityAttributes"
    )
    bounded_contexts: list[BoundedContext] = Field(
        default_factory=list, alias="boundedContexts"
    )
    building_blocks: list[BuildingBlock] = Field(
        default_factory=list, alias="buildingBlocks"
    )
    use_cases: list[UseCase] = Field(default_factory=list, alias="useCases")
    scenarios: list[Scenario] = []
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `uv run pytest tests/contracts/test_design_doc_schema.py -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add contracts/design_doc_schema.py
git commit -m "refactor: replace 11 separate BB classes with unified BuildingBlock model"
```

---

### Task 3: Generate JSON Schema and create generation script

**Files:**
- Create: `contracts/generate_json_schema.py`
- Regenerate: `contracts/design-doc-schema.json`

- [ ] **Step 1: Create generation script**

Create `contracts/generate_json_schema.py`:

```python
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
```

- [ ] **Step 2: Run the script to regenerate JSON Schema**

Run: `cd contracts && uv run python generate_json_schema.py`
Expected: `design-doc-schema.json` is regenerated with new schema structure

- [ ] **Step 3: Verify generated schema contains key definitions**

Run: `uv run python -c "import json; s = json.load(open('contracts/design-doc-schema.json')); defs = list(s.get('\\$defs', {}).keys()); print(sorted(defs))"`
Expected: `['Actor', 'Behaviour', 'BoundedContext', 'BuildingBlock', 'BuildingBlockType', 'BusinessGoal', 'DomainConcept', 'DomainModule', 'Property', 'QualityAttribute', 'QualityAttributeType', 'Rule', 'RuleType', 'Scenario', 'UseCase', 'UseCaseType']`

- [ ] **Step 4: Commit**

```bash
git add contracts/generate_json_schema.py contracts/design-doc-schema.json
git commit -m "feat: add JSON Schema generation script and regenerate schema"
```

---

## Chunk 2: Validation and Cleanup

### Task 4: Add populate_by_name to nested models that use aliases

**Files:**
- Modify: `contracts/design_doc_schema.py`
- Modify: `tests/contracts/test_design_doc_schema.py`

- [ ] **Step 1: Write test for alias round-trip on nested models**

Add to `tests/contracts/test_design_doc_schema.py`:

```python
class TestAliasHandling:
    def test_rule_accepts_alias(self) -> None:
        r = Rule.model_validate({"id": "r-1", "ruleType": "Consistency", "description": "test"})
        assert r.rule_type == RuleType.CONSISTENCY

    def test_use_case_accepts_alias(self) -> None:
        uc = UseCase.model_validate({
            "id": "uc-1",
            "name": "Test",
            "actor": "a-1",
            "type": "Command",
            "businessGoal": "bg-1",
            "usedBuildingBlocks": ["bb-1"],
        })
        assert uc.business_goal == "bg-1"
        assert uc.used_building_blocks == ["bb-1"]

    def test_domain_module_accepts_alias(self) -> None:
        dm = DomainModule.model_validate({
            "id": "mod-1",
            "name": "Test",
            "description": "Test module",
            "buildingBlocks": ["bb-1"],
        })
        assert dm.building_blocks == ["bb-1"]

    def test_bounded_context_accepts_alias(self) -> None:
        bc = BoundedContext.model_validate({
            "id": "bc-1",
            "name": "Test",
            "description": "Test context",
            "buildingBlocks": ["bb-1"],
        })
        assert bc.building_blocks == ["bb-1"]
```

- [ ] **Step 2: Run tests — check if aliases work on nested models**

Run: `uv run pytest tests/contracts/test_design_doc_schema.py::TestAliasHandling -v`
Expected: May fail if nested models need `populate_by_name` config

- [ ] **Step 3: Add model_config to nested models with aliases**

Add `model_config = {"populate_by_name": True}` to `Rule`, `UseCase`, `DomainModule`, `BoundedContext`. These models use `alias=` on fields and need `populate_by_name` to accept both Python field names and JSON aliases.

- [ ] **Step 4: Run all tests**

Run: `uv run pytest tests/contracts/test_design_doc_schema.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/design_doc_schema.py tests/contracts/test_design_doc_schema.py
git commit -m "fix: ensure alias handling works on all nested models"
```

---

### Task 5: Final verification and cleanup

**Files:**
- Modify: `contracts/design-doc-schema.json` (regenerate if needed)

- [ ] **Step 1: Run full test suite to check nothing else broke**

Run: `uv run pytest tests/ -v`
Expected: ALL PASS (no other tests depend on old schema)

- [ ] **Step 2: Regenerate JSON Schema after any alias fixes**

Run: `cd contracts && uv run python generate_json_schema.py`

- [ ] **Step 3: Verify old types are gone from schema**

Run: `uv run python -c "from contracts.design_doc_schema import DesignDoc; print([f.alias or name for name, f in DesignDoc.model_fields.items()])"`
Expected: No references to `Aggregate`, `Entity`, `ValueObject`, or other old separate BB types

- [ ] **Step 4: Final commit**

```bash
git add contracts/
git commit -m "chore: regenerate JSON Schema and verify cleanup"
```
