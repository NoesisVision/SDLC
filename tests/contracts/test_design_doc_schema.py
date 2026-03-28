from contracts.design_doc_schema import (
    Actor,
    Behaviour,
    BoundedContext,
    BuildingBlock,
    BuildingBlockType,
    BusinessGoal,
    ChangeSet,
    DesignDocDiff,
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

    def test_building_block_type_values(self) -> None:
        expected = {
            "aggregate", "entity", "value_object",
            "domain_event", "domain_command", "domain_query",
            "domain_service", "application_service",
            "repository", "factory", "external_integration",
        }
        actual = {e.value for e in BuildingBlockType}
        assert actual == expected


class TestLeafTypes:
    def test_property(self) -> None:
        prop = Property(name="orderId", type="UUID")
        assert prop.name == "orderId"
        assert prop.type == "UUID"

    def test_behaviour_defaults(self) -> None:
        b = Behaviour(name="place", description="Places an order")
        assert b.input == []
        assert b.output == []
        assert b.rules == []

    def test_behaviour_with_rules(self) -> None:
        b = Behaviour(
            name="place",
            description="Places an order",
            input=["bb-1"],
            output=["bb-2"],
            rules=[Rule(id="r-1", ruleType="Consistency", description="test")],
        )
        assert b.input == ["bb-1"]
        assert len(b.rules) == 1

    def test_rule(self) -> None:
        r = Rule(id="r-1", ruleType="Consistency", description="Must be valid")
        assert r.rule_type == RuleType.CONSISTENCY

    def test_rule_alias(self) -> None:
        r = Rule.model_validate({"id": "r-1", "ruleType": "Consistency", "description": "test"})
        assert r.rule_type == RuleType.CONSISTENCY

    def test_actor(self) -> None:
        a = Actor(id="a-1", name="Customer", description="End user")
        assert a.id == "a-1"

    def test_business_goal(self) -> None:
        bg = BusinessGoal(id="bg-1", name="Revenue", description="Increase revenue")
        assert bg.id == "bg-1"

    def test_domain_concept(self) -> None:
        dc = DomainConcept(id="dc-1", name="Order", description="A purchase request")
        assert dc.id == "dc-1"

    def test_scenario(self) -> None:
        s = Scenario(
            name="Happy path",
            description="Order is placed successfully",
            given="A customer with items",
            when="Customer submits order",
            then="Order is created",
        )
        assert s.given == "A customer with items"

    def test_quality_attribute(self) -> None:
        qa = QualityAttribute(
            id="qa-1", name="Latency", type="performance", description="< 500ms"
        )
        assert qa.type == QualityAttributeType.PERFORMANCE


class TestChangeSet:
    def test_empty(self) -> None:
        cs = ChangeSet[Actor]()
        assert cs.added == []
        assert cs.removed == []
        assert cs.modified == []

    def test_with_elements(self) -> None:
        cs = ChangeSet[Actor](
            added=[Actor(id="a-2", name="Admin", description="System admin")],
            removed=["a-3"],
            modified=[Actor(id="a-1", name="Updated", description="Updated")],
        )
        assert len(cs.added) == 1
        assert cs.removed == ["a-3"]
        assert cs.modified[0].name == "Updated"


class TestBuildingBlockMod:
    def test_as_add(self) -> None:
        mod = BuildingBlock(
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
        mod = BuildingBlock(
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
        mod = BuildingBlock(
            id="bb-1",
            description="New description",
            type=BuildingBlockType.ENTITY,
        )
        assert mod.description == "New description"
        assert mod.name is None


class TestUseCaseMod:
    def test_as_add(self) -> None:
        mod = UseCase(
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
        mod = UseCase(
            id="uc-1",
            usedBuildingBlocks=ChangeSet[str](added=["bb-10"], removed=["bb-2"]),
            businessGoals=ChangeSet[str](added=["bg-2"]),
            qualityAttributes=ChangeSet[str](added=["qa-2"]),
        )
        assert mod.used_building_blocks.added == ["bb-10"]
        assert mod.business_goals.added == ["bg-2"]
        assert mod.quality_attributes.added == ["qa-2"]


class TestDomainModuleMod:
    def test_add_building_block(self) -> None:
        mod = DomainModule(
            id="mod-1",
            buildingBlocks=ChangeSet[BuildingBlock](
                added=[
                    BuildingBlock(
                        id="bb-10", name="DiscountCode",
                        type=BuildingBlockType.VALUE_OBJECT,
                        description="Discount code",
                    )
                ],
            ),
        )
        assert mod.building_blocks.added[0].name == "DiscountCode"

    def test_modify_building_block(self) -> None:
        mod = DomainModule(
            id="mod-1",
            buildingBlocks=ChangeSet[BuildingBlock](
                modified=[
                    BuildingBlock(
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
        mod = BoundedContext(
            id="bc-1",
            modules=ChangeSet[DomainModule](
                added=[
                    DomainModule(
                        id="mod-2", name="Shipping", description="Shipping module",
                        buildingBlocks=ChangeSet[BuildingBlock](
                            added=[
                                BuildingBlock(
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
        mod = BoundedContext(
            id="bc-1",
            modules=ChangeSet[DomainModule](
                modified=[
                    DomainModule(
                        id="mod-1",
                        buildingBlocks=ChangeSet[BuildingBlock](
                            modified=[
                                BuildingBlock(
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
        mod = BoundedContext(
            id="bc-1",
            useCases=ChangeSet[UseCase](
                added=[UseCase(id="uc-2", name="Cancel Order", actor="a-1", type="Command")],
            ),
        )
        assert mod.use_cases.added[0].name == "Cancel Order"

    def test_add_domain_concept(self) -> None:
        mod = BoundedContext(
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
            boundedContexts=ChangeSet[BoundedContext](
                added=[
                    BoundedContext(
                        id="bc-1", name="Ordering", description="Order lifecycle",
                        modules=ChangeSet[DomainModule](
                            added=[
                                DomainModule(
                                    id="mod-1", name="Order Management", description="Core orders",
                                    buildingBlocks=ChangeSet[BuildingBlock](
                                        added=[
                                            BuildingBlock(
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
        bc = diff.bounded_contexts.added[0]
        bb = bc.modules.added[0].building_blocks.added[0]
        assert bb.name == "Order"
        assert bb.properties.added[0].name == "id"

    def test_leaf_change_surgical(self) -> None:
        diff = DesignDocDiff(
            description="Add discount property to Order aggregate",
            boundedContexts=ChangeSet[BoundedContext](
                modified=[
                    BoundedContext(
                        id="bc-1",
                        modules=ChangeSet[DomainModule](
                            modified=[
                                DomainModule(
                                    id="mod-1",
                                    buildingBlocks=ChangeSet[BuildingBlock](
                                        modified=[
                                            BuildingBlock(
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
            boundedContexts=ChangeSet[BoundedContext](
                added=[BoundedContext(id="bc-2", name="Shipping", description="Shipping context")],
                removed=["bc-legacy"],
                modified=[BoundedContext(id="bc-1", description="Updated ordering context")],
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
            boundedContexts=ChangeSet[BoundedContext](
                modified=[
                    BoundedContext(
                        id="bc-1",
                        modules=ChangeSet[DomainModule](
                            modified=[
                                DomainModule(
                                    id="mod-1",
                                    buildingBlocks=ChangeSet[BuildingBlock](
                                        added=[
                                            BuildingBlock(
                                                id="bb-10", name="DiscountCode",
                                                type=BuildingBlockType.VALUE_OBJECT,
                                                description="Discount",
                                            )
                                        ],
                                        modified=[
                                            BuildingBlock(
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
                            "modified": [
                                {
                                    "id": "mod-1",
                                    "buildingBlocks": {
                                        "removed": ["bb-99"],
                                        "modified": [
                                            {
                                                "id": "bb-1",
                                                "properties": {
                                                    "added": [{"name": "f", "type": "int"}],
                                                },
                                            }
                                        ],
                                    },
                                }
                            ],
                        },
                        "useCases": {
                            "modified": [
                                {
                                    "id": "uc-1",
                                    "usedBuildingBlocks": {
                                        "added": ["bb-10"],
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
