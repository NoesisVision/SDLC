from contracts.design_doc_diff_schema import (
    BoundedContextMod,
    BuildingBlockMod,
    ChangeSet,
    DesignDocDiff,
    DomainModuleMod,
    UseCaseMod,
)
from contracts.design_doc_schema import (
    Actor,
    Behaviour,
    BuildingBlockType,
    BusinessGoal,
    DomainConcept,
    Property,
    QualityAttribute,
    Rule,
    Scenario,
)


class TestChangeSet:
    def test_empty(self) -> None:
        cs = ChangeSet[Actor]()
        assert cs.added == []
        assert cs.removed == []
        assert cs.modified == []

    def test_simple_type(self) -> None:
        cs = ChangeSet[Actor](
            added=[Actor(id="a-2", name="Admin", description="System admin")],
            removed=["a-3"],
            modified=[Actor(id="a-1", name="Updated", description="Updated actor")],
        )
        assert len(cs.added) == 1
        assert cs.removed == ["a-3"]
        assert cs.modified[0].name == "Updated"


class TestBuildingBlockMod:
    def test_as_add(self) -> None:
        mod = BuildingBlockMod(
            id="bb-10",
            name="DiscountCode",
            type=BuildingBlockType.VALUE_OBJECT,
            description="Discount code",
            properties=ChangeSet[Property](
                added=[Property(name="code", type="str")],
            ),
        )
        assert mod.name == "DiscountCode"
        assert mod.properties.added[0].name == "code"

    def test_as_modify(self) -> None:
        mod = BuildingBlockMod(
            id="bb-1",
            properties=ChangeSet[Property](
                added=[Property(name="discount", type="Decimal")],
            ),
            behaviours=ChangeSet[Behaviour](
                removed=["old_method"],
            ),
        )
        assert mod.name is None
        assert mod.properties.added[0].name == "discount"
        assert mod.behaviours.removed == ["old_method"]

    def test_scalar_change(self) -> None:
        mod = BuildingBlockMod(
            id="bb-1",
            description="New description",
            type=BuildingBlockType.ENTITY,
        )
        assert mod.description == "New description"
        assert mod.name is None

    def test_modify_scenario(self) -> None:
        mod = BuildingBlockMod(
            id="bb-1",
            scenarios=ChangeSet[Scenario](
                modified=[
                    Scenario(
                        name="Happy path", description="Updated",
                        given="G", when="W", then="T",
                    )
                ],
            ),
        )
        assert mod.scenarios.modified[0].description == "Updated"

    def test_add_rule(self) -> None:
        mod = BuildingBlockMod(
            id="bb-1",
            rules=ChangeSet[Rule](
                added=[Rule(id="r-1", ruleType="Consistency", description="Must match")],
            ),
        )
        assert mod.rules.added[0].id == "r-1"


class TestUseCaseMod:
    def test_as_add(self) -> None:
        mod = UseCaseMod(
            id="uc-2",
            name="Cancel Order",
            actor="a-1",
            type="Command",
            description="Cancel an order",
            input=ChangeSet[str](added=["bb-20"]),
        )
        assert mod.name == "Cancel Order"
        assert mod.input.added == ["bb-20"]

    def test_as_modify(self) -> None:
        mod = UseCaseMod(
            id="uc-1",
            usedBuildingBlocks=ChangeSet[str](added=["bb-10"], removed=["bb-2"]),
            businessGoals=ChangeSet[str](added=["bg-2"]),
            qualityAttributes=ChangeSet[str](added=["qa-2"]),
            scenarios=ChangeSet[Scenario](
                added=[
                    Scenario(
                        name="Error case", description="Fails",
                        given="Invalid", when="Submit", then="Error",
                    )
                ],
            ),
        )
        assert mod.used_building_blocks.added == ["bb-10"]
        assert mod.business_goals.added == ["bg-2"]
        assert mod.quality_attributes.added == ["qa-2"]
        assert len(mod.scenarios.added) == 1


class TestDomainModuleMod:
    def test_add_building_block(self) -> None:
        mod = DomainModuleMod(
            id="mod-1",
            buildingBlocks=ChangeSet[BuildingBlockMod](
                added=[
                    BuildingBlockMod(
                        id="bb-10", name="DiscountCode",
                        type=BuildingBlockType.VALUE_OBJECT,
                        description="Discount code",
                    )
                ],
            ),
        )
        assert mod.building_blocks.added[0].name == "DiscountCode"

    def test_modify_building_block(self) -> None:
        mod = DomainModuleMod(
            id="mod-1",
            buildingBlocks=ChangeSet[BuildingBlockMod](
                modified=[
                    BuildingBlockMod(
                        id="bb-1",
                        properties=ChangeSet[Property](
                            added=[Property(name="discount", type="Decimal")],
                        ),
                    )
                ],
            ),
        )
        bb_mod = mod.building_blocks.modified[0]
        assert bb_mod.properties.added[0].name == "discount"


class TestBoundedContextMod:
    def test_add_module(self) -> None:
        mod = BoundedContextMod(
            id="bc-1",
            modules=ChangeSet[DomainModuleMod](
                added=[
                    DomainModuleMod(
                        id="mod-2", name="Shipping", description="Shipping module",
                        buildingBlocks=ChangeSet[BuildingBlockMod](
                            added=[
                                BuildingBlockMod(
                                    id="bb-20", name="Shipment",
                                    type=BuildingBlockType.AGGREGATE,
                                    description="Shipment aggregate",
                                )
                            ],
                        ),
                    )
                ],
            ),
        )
        assert mod.modules.added[0].building_blocks.added[0].name == "Shipment"

    def test_nested_drill_down(self) -> None:
        mod = BoundedContextMod(
            id="bc-1",
            modules=ChangeSet[DomainModuleMod](
                modified=[
                    DomainModuleMod(
                        id="mod-1",
                        buildingBlocks=ChangeSet[BuildingBlockMod](
                            modified=[
                                BuildingBlockMod(
                                    id="bb-1",
                                    properties=ChangeSet[Property](
                                        added=[Property(name="discount", type="Decimal")],
                                    ),
                                )
                            ],
                        ),
                    )
                ],
            ),
        )
        bb_mod = mod.modules.modified[0].building_blocks.modified[0]
        assert bb_mod.properties.added[0].name == "discount"

    def test_add_use_case(self) -> None:
        mod = BoundedContextMod(
            id="bc-1",
            useCases=ChangeSet[UseCaseMod](
                added=[
                    UseCaseMod(
                        id="uc-2", name="Cancel Order",
                        actor="a-1", type="Command",
                    )
                ],
            ),
        )
        assert mod.use_cases.added[0].name == "Cancel Order"

    def test_add_domain_concept(self) -> None:
        mod = BoundedContextMod(
            id="bc-1",
            domainConcepts=ChangeSet[DomainConcept](
                added=[DomainConcept(id="dc-3", name="Discount", description="Price reduction")],
            ),
        )
        assert mod.domain_concepts.added[0].name == "Discount"


class TestDesignDocDiff:
    def test_empty_diff(self) -> None:
        diff = DesignDocDiff(description="No changes")
        assert diff.actors is None
        assert diff.business_goals is None
        assert diff.quality_attributes is None
        assert diff.bounded_contexts is None

    def test_first_iteration(self) -> None:
        diff = DesignDocDiff(
            description="Initial implementation",
            actors=ChangeSet[Actor](
                added=[Actor(id="a-1", name="Customer", description="End user")]
            ),
            businessGoals=ChangeSet[BusinessGoal](
                added=[BusinessGoal(id="bg-1", name="Online ordering", description="Allow online orders")]
            ),
            qualityAttributes=ChangeSet[QualityAttribute](
                added=[QualityAttribute(id="qa-1", name="Latency", type="performance", description="< 500ms")]
            ),
            boundedContexts=ChangeSet[BoundedContextMod](
                added=[
                    BoundedContextMod(
                        id="bc-1", name="Ordering", description="Order lifecycle",
                        modules=ChangeSet[DomainModuleMod](
                            added=[
                                DomainModuleMod(
                                    id="mod-1", name="Order Management", description="Core orders",
                                    buildingBlocks=ChangeSet[BuildingBlockMod](
                                        added=[
                                            BuildingBlockMod(
                                                id="bb-1", name="Order",
                                                type=BuildingBlockType.AGGREGATE,
                                                description="Order aggregate",
                                                properties=ChangeSet[Property](
                                                    added=[Property(name="id", type="OrderId")],
                                                ),
                                            )
                                        ],
                                    ),
                                )
                            ],
                        ),
                    )
                ]
            ),
        )
        assert len(diff.actors.added) == 1
        assert len(diff.business_goals.added) == 1
        bc = diff.bounded_contexts.added[0]
        bb = bc.modules.added[0].building_blocks.added[0]
        assert bb.name == "Order"
        assert bb.properties.added[0].name == "id"

    def test_leaf_change_surgical(self) -> None:
        diff = DesignDocDiff(
            description="Add discount property to Order aggregate",
            boundedContexts=ChangeSet[BoundedContextMod](
                modified=[
                    BoundedContextMod(
                        id="bc-1",
                        modules=ChangeSet[DomainModuleMod](
                            modified=[
                                DomainModuleMod(
                                    id="mod-1",
                                    buildingBlocks=ChangeSet[BuildingBlockMod](
                                        modified=[
                                            BuildingBlockMod(
                                                id="bb-1",
                                                properties=ChangeSet[Property](
                                                    added=[Property(name="discount", type="Decimal")],
                                                ),
                                            )
                                        ],
                                    ),
                                )
                            ],
                        ),
                    )
                ]
            ),
        )
        bb_mod = (
            diff.bounded_contexts.modified[0]
            .modules.modified[0]
            .building_blocks.modified[0]
        )
        assert bb_mod.properties.added[0].name == "discount"

    def test_mixed_operations(self) -> None:
        diff = DesignDocDiff(
            description="Add shipping, remove legacy, update ordering",
            actors=ChangeSet[Actor](
                added=[Actor(id="a-2", name="Warehouse", description="Warehouse staff")],
            ),
            boundedContexts=ChangeSet[BoundedContextMod](
                added=[
                    BoundedContextMod(id="bc-2", name="Shipping", description="Shipping context")
                ],
                removed=["bc-legacy"],
                modified=[
                    BoundedContextMod(id="bc-1", description="Updated ordering context")
                ],
            ),
        )
        assert len(diff.actors.added) == 1
        assert len(diff.bounded_contexts.added) == 1
        assert diff.bounded_contexts.removed == ["bc-legacy"]
        assert diff.bounded_contexts.modified[0].description == "Updated ordering context"

    def test_round_trip(self) -> None:
        diff = DesignDocDiff(
            description="Round trip test",
            actors=ChangeSet[Actor](
                added=[Actor(id="a-2", name="Admin", description="Admin")],
                removed=["a-3"],
            ),
            boundedContexts=ChangeSet[BoundedContextMod](
                modified=[
                    BoundedContextMod(
                        id="bc-1",
                        modules=ChangeSet[DomainModuleMod](
                            modified=[
                                DomainModuleMod(
                                    id="mod-1",
                                    buildingBlocks=ChangeSet[BuildingBlockMod](
                                        added=[
                                            BuildingBlockMod(
                                                id="bb-10", name="DiscountCode",
                                                type=BuildingBlockType.VALUE_OBJECT,
                                                description="Discount",
                                            )
                                        ],
                                        modified=[
                                            BuildingBlockMod(
                                                id="bb-1",
                                                properties=ChangeSet[Property](
                                                    added=[Property(name="discount", type="Decimal")],
                                                ),
                                            )
                                        ],
                                    ),
                                )
                            ],
                        ),
                    )
                ],
            ),
        )
        exported = diff.model_dump(by_alias=True)
        restored = DesignDocDiff.model_validate(exported)
        assert restored == diff

    def test_from_json_with_aliases(self) -> None:
        data = {
            "description": "Alias test",
            "businessGoals": {
                "added": [{"id": "bg-2", "name": "Goal", "description": "New"}],
                "removed": [],
                "modified": [],
            },
            "boundedContexts": {
                "added": [],
                "removed": ["bc-old"],
                "modified": [
                    {
                        "id": "bc-1",
                        "modules": {
                            "added": [],
                            "removed": [],
                            "modified": [
                                {
                                    "id": "mod-1",
                                    "buildingBlocks": {
                                        "added": [],
                                        "removed": ["bb-99"],
                                        "modified": [
                                            {
                                                "id": "bb-1",
                                                "properties": {
                                                    "added": [{"name": "f", "type": "int"}],
                                                    "removed": [],
                                                    "modified": [],
                                                },
                                            }
                                        ],
                                    },
                                }
                            ],
                        },
                        "useCases": {
                            "added": [],
                            "removed": [],
                            "modified": [
                                {
                                    "id": "uc-1",
                                    "usedBuildingBlocks": {
                                        "added": ["bb-10"],
                                        "removed": [],
                                        "modified": [],
                                    },
                                }
                            ],
                        },
                    }
                ],
            },
        }
        diff = DesignDocDiff.model_validate(data)
        assert diff.business_goals.added[0].id == "bg-2"
        assert diff.bounded_contexts.removed == ["bc-old"]
        bc_mod = diff.bounded_contexts.modified[0]
        mod_mod = bc_mod.modules.modified[0]
        assert mod_mod.building_blocks.removed == ["bb-99"]
        assert mod_mod.building_blocks.modified[0].properties.added[0].name == "f"
        assert bc_mod.use_cases.modified[0].used_building_blocks.added == ["bb-10"]

    def test_json_schema_generation(self) -> None:
        schema = DesignDocDiff.model_json_schema()
        assert schema["type"] == "object"
        assert "$defs" in schema
        assert "BuildingBlockMod" in schema["$defs"]
        assert "BoundedContextMod" in schema["$defs"]
