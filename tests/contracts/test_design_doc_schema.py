from contracts.design_doc_schema import (
    Actor,
    Behaviour,
    BehaviorType,
    BoundedContext,
    BuildingBlock,
    BuildingBlockType,
    ChangeSet,
    DesignDoc,
    DomainModule,
    Property,
    QualityAttribute,
    QualityAttributeType,
    Rule,
    RuleType,
    Scenario,
)


class TestEnums:
    def test_rule_type_values(self) -> None:
        assert RuleType.CONSISTENCY == "Consistency"
        assert RuleType.STRUCTURE == "Structure"
        assert RuleType.COMPUTATION == "Computation"
        assert RuleType.STATE_CHANGE == "State change"

    def test_behavior_type_values(self) -> None:
        assert BehaviorType.COMMAND == "Command"
        assert BehaviorType.EVENT == "Event"
        assert BehaviorType.QUERY == "Query"

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
        b = Behaviour(name="place")
        assert b.description is None
        assert b.type is None
        assert b.input is None
        assert b.output is None
        assert b.rules is None
        assert b.is_public is False
        assert b.actor is None

    def test_behaviour_with_rules(self) -> None:
        b = Behaviour(
            name="place",
            description="Places an order",
            type=BehaviorType.COMMAND,
            input=ChangeSet[str](added=["bb-1"]),
            output=ChangeSet[str](added=["bb-2"]),
            rules=ChangeSet[Rule](
                added=[Rule(name="validity", ruleType="Consistency", description="test")]
            ),
        )
        assert b.input.added == ["bb-1"]
        assert len(b.rules.added) == 1

    def test_behaviour_public_with_actor(self) -> None:
        b = Behaviour(name="place", is_public=True, actor="a-1")
        assert b.actor == "a-1"
        assert b.is_public is True

    def test_behaviour_private_without_actor(self) -> None:
        b = Behaviour(name="place", is_public=False)
        assert b.actor is None

    def test_rule(self) -> None:
        r = Rule(name="validity", ruleType="Consistency", description="Must be valid")
        assert r.rule_type == RuleType.CONSISTENCY

    def test_rule_alias(self) -> None:
        r = Rule.model_validate({"name": "validity", "ruleType": "Consistency", "description": "test"})
        assert r.rule_type == RuleType.CONSISTENCY

    def test_actor(self) -> None:
        a = Actor(name="Customer", description="End user")
        assert a.name == "Customer"

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
        qa = QualityAttribute(name="Latency", type="performance", description="< 500ms")
        assert qa.type == QualityAttributeType.PERFORMANCE


class TestChangeSet:
    def test_empty(self) -> None:
        cs = ChangeSet[Actor]()
        assert cs.added == []
        assert cs.removed == []
        assert cs.modified == []

    def test_with_elements(self) -> None:
        cs = ChangeSet[Actor](
            added=[Actor(name="Admin", description="System admin")],
            removed=["Operator"],
            modified=[Actor(name="Customer", description="Updated")],
        )
        assert len(cs.added) == 1
        assert cs.removed == ["Operator"]
        assert cs.modified[0].name == "Customer"


class TestBuildingBlockMod:
    def test_as_add(self) -> None:
        mod = BuildingBlock(
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
            name="Order",
            properties=ChangeSet[Property](
                added=[Property(name="discount", type="Decimal")],
            ),
            behaviours=ChangeSet[Behaviour](
                removed=["old_method"],
            ),
        )
        assert mod.properties.added[0].name == "discount"
        assert mod.behaviours.removed == ["old_method"]

    def test_scalar_change(self) -> None:
        mod = BuildingBlock(
            name="Order",
            description="New description",
            type=BuildingBlockType.ENTITY,
        )
        assert mod.description == "New description"


class TestDomainModuleMod:
    def test_add_building_block(self) -> None:
        mod = DomainModule(
            name="Orders",
            buildingBlocks=ChangeSet[BuildingBlock](
                added=[
                    BuildingBlock(
                        name="DiscountCode",
                        type=BuildingBlockType.VALUE_OBJECT,
                        description="Discount code",
                    )
                ],
            ),
        )
        assert mod.building_blocks.added[0].name == "DiscountCode"

    def test_modify_building_block(self) -> None:
        mod = DomainModule(
            name="Orders",
            buildingBlocks=ChangeSet[BuildingBlock](
                modified=[
                    BuildingBlock(
                        name="Order",
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
            name="Ordering",
            modules=ChangeSet[DomainModule](
                added=[
                    DomainModule(
                        name="Shipping", description="Shipping module",
                        buildingBlocks=ChangeSet[BuildingBlock](
                            added=[
                                BuildingBlock(
                                    name="Shipment",
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
            name="Ordering",
            modules=ChangeSet[DomainModule](
                modified=[
                    DomainModule(
                        name="Order Management",
                        buildingBlocks=ChangeSet[BuildingBlock](
                            modified=[
                                BuildingBlock(
                                    name="Order",
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


class TestDesignDoc:
    def test_empty_diff(self) -> None:
        diff = DesignDoc(description="No changes")
        assert diff.actors is None
        assert diff.bounded_contexts is None

    def test_first_iteration(self) -> None:
        diff = DesignDoc(
            description="Initial implementation",
            actors=ChangeSet[Actor](
                added=[Actor(name="Customer", description="End user")]
            ),
            boundedContexts=ChangeSet[BoundedContext](
                added=[
                    BoundedContext(
                        name="Ordering", description="Order lifecycle",
                        modules=ChangeSet[DomainModule](
                            added=[
                                DomainModule(
                                    name="Order Management", description="Core orders",
                                    buildingBlocks=ChangeSet[BuildingBlock](
                                        added=[
                                            BuildingBlock(
                                                name="Order",
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
        diff = DesignDoc(
            description="Add discount property to Order aggregate",
            boundedContexts=ChangeSet[BoundedContext](
                modified=[
                    BoundedContext(
                        name="Ordering",
                        modules=ChangeSet[DomainModule](
                            modified=[
                                DomainModule(
                                    name="Order Management",
                                    buildingBlocks=ChangeSet[BuildingBlock](
                                        modified=[
                                            BuildingBlock(
                                                name="Order",
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
        diff = DesignDoc(
            description="Add shipping, remove legacy, update ordering",
            actors=ChangeSet[Actor](
                added=[Actor(name="Warehouse", description="Warehouse staff")],
            ),
            boundedContexts=ChangeSet[BoundedContext](
                added=[BoundedContext(name="Shipping", description="Shipping context")],
                removed=["Legacy"],
                modified=[BoundedContext(name="Ordering", description="Updated ordering context")],
            ),
        )
        assert len(diff.actors.added) == 1
        assert len(diff.bounded_contexts.added) == 1
        assert diff.bounded_contexts.removed == ["Legacy"]
        assert diff.bounded_contexts.modified[0].description == "Updated ordering context"

    def test_round_trip(self) -> None:
        diff = DesignDoc(
            description="Round trip test",
            actors=ChangeSet[Actor](
                added=[Actor(name="Admin", description="Admin")],
                removed=["Operator"],
            ),
            boundedContexts=ChangeSet[BoundedContext](
                modified=[
                    BoundedContext(
                        name="Ordering",
                        modules=ChangeSet[DomainModule](
                            modified=[
                                DomainModule(
                                    name="Order Management",
                                    buildingBlocks=ChangeSet[BuildingBlock](
                                        added=[
                                            BuildingBlock(
                                                name="DiscountCode",
                                                type=BuildingBlockType.VALUE_OBJECT,
                                                description="Discount",
                                            )
                                        ],
                                        modified=[
                                            BuildingBlock(
                                                name="Order",
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
        restored = DesignDoc.model_validate(exported)
        assert restored == diff

    def test_from_json_with_aliases(self) -> None:
        data = {
            "description": "Alias test",
            "boundedContexts": {
                "added": [],
                "removed": ["Legacy"],
                "modified": [
                    {
                        "name": "Ordering",
                        "modules": {
                            "modified": [
                                {
                                    "name": "Order Management",
                                    "buildingBlocks": {
                                        "removed": ["Obsolete"],
                                        "modified": [
                                            {
                                                "name": "Order",
                                                "properties": {
                                                    "added": [{"name": "f", "type": "int"}],
                                                },
                                                "behaviours": {
                                                    "modified": [
                                                        {
                                                            "name": "place",
                                                            "usedBuildingBlocks": {
                                                                "added": ["DiscountCode"],
                                                            },
                                                        }
                                                    ],
                                                },
                                            }
                                        ],
                                    },
                                }
                            ],
                        },
                    }
                ],
            },
        }
        diff = DesignDoc.model_validate(data)
        assert diff.bounded_contexts.removed == ["Legacy"]
        bc_mod = diff.bounded_contexts.modified[0]
        mod_mod = bc_mod.modules.modified[0]
        assert mod_mod.building_blocks.removed == ["Obsolete"]
        assert mod_mod.building_blocks.modified[0].properties.added[0].name == "f"
        bb_mod = mod_mod.building_blocks.modified[0]
        assert bb_mod.behaviours.modified[0].used_building_blocks.added == ["DiscountCode"]

    def test_json_schema_generation(self) -> None:
        schema = DesignDoc.model_json_schema()
        assert schema["type"] == "object"
        assert "$defs" in schema
        assert "BuildingBlock" in schema["$defs"]
        assert "BoundedContext" in schema["$defs"]
