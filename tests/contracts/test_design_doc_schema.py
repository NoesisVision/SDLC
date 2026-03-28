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
            rules=[Rule(id="r-1", ruleType="Consistency", description="test")],
        )
        assert b.input == ["bb-1"]
        assert b.output == ["bb-2"]
        assert len(b.rules) == 1

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
        assert bb.rules == []
        assert bb.scenarios == []


class TestOrganizationalStructure:
    def test_domain_module(self) -> None:
        dm = DomainModule(
            id="mod-1",
            name="Order Management",
            description="Core orders",
            buildingBlocks=[
                BuildingBlock(id="bb-1", name="Order", type="aggregate", description="Order")
            ],
        )
        assert len(dm.building_blocks) == 1
        assert dm.building_blocks[0].id == "bb-1"

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
                    buildingBlocks=[
                        BuildingBlock(id="bb-1", name="Order", type="aggregate", description="Order")
                    ],
                )
            ],
            buildingBlocks=[
                BuildingBlock(id="bb-5", name="Shared", type="value_object", description="Shared VO")
            ],
        )
        assert len(bc.modules) == 1
        assert len(bc.building_blocks) == 1

    def test_bounded_context_with_domain_concepts(self) -> None:
        bc = BoundedContext(
            id="bc-1",
            name="Ordering",
            description="Order context",
            domainConcepts=[
                DomainConcept(id="dc-1", name="Order", description="A purchase request")
            ],
        )
        assert len(bc.domain_concepts) == 1

    def test_bounded_context_with_use_cases(self) -> None:
        bc = BoundedContext(
            id="bc-1",
            name="Ordering",
            description="Order context",
            useCases=[
                UseCase(id="uc-1", name="Place Order", actor="a-1", type="Command")
            ],
        )
        assert len(bc.use_cases) == 1


class TestUseCase:
    def test_use_case_full(self) -> None:
        uc = UseCase(
            id="uc-1",
            name="Place Order",
            actor="actor-1",
            type="Command",
            description="Customer places order",
            businessGoals=["bg-1"],
            input=["bb-3"],
            output=["bb-4"],
            usedBuildingBlocks=["bb-1", "bb-2"],
            rules=[Rule(id="r-1", ruleType="Consistency", description="test")],
            scenarios=[
                Scenario(
                    name="Happy path",
                    description="Success",
                    given="Items in cart",
                    when="Submit",
                    then="Order placed",
                )
            ],
            quality_attributes=["qa-1"],
        )
        assert uc.business_goals == ["bg-1"]
        assert uc.used_building_blocks == ["bb-1", "bb-2"]
        assert len(uc.scenarios) == 1
        assert uc.quality_attributes == ["qa-1"]

    def test_use_case_defaults(self) -> None:
        uc = UseCase(
            id="uc-1",
            name="List Orders",
            actor="actor-1",
            type="Query",
        )
        assert uc.description == ""
        assert uc.business_goals == []
        assert uc.input == []
        assert uc.used_building_blocks == []
        assert uc.scenarios == []
        assert uc.quality_attributes == []


class TestDesignDoc:
    def test_full_design_doc_from_json(self, sample_design_doc_data: dict) -> None:
        doc = DesignDoc.model_validate(sample_design_doc_data)
        assert len(doc.actors) == 1
        assert len(doc.business_goals) == 1
        assert len(doc.quality_attributes) == 1
        assert len(doc.bounded_contexts) == 1
        bc = doc.bounded_contexts[0]
        assert len(bc.domain_concepts) == 2
        assert len(bc.modules) == 1
        assert len(bc.modules[0].building_blocks) == 4
        assert len(bc.use_cases) == 1

    def test_design_doc_round_trip(self, sample_design_doc_data: dict) -> None:
        doc = DesignDoc.model_validate(sample_design_doc_data)
        exported = doc.model_dump(by_alias=True)
        doc_again = DesignDoc.model_validate(exported)
        assert doc == doc_again

    def test_design_doc_minimal(self) -> None:
        doc = DesignDoc()
        assert doc.actors == []
        assert doc.bounded_contexts == []

    def test_json_schema_generation(self) -> None:
        schema = DesignDoc.model_json_schema()
        assert schema["type"] == "object"
        assert "$defs" in schema
        assert "BuildingBlock" in schema["$defs"]
        assert "BuildingBlockType" in schema["$defs"]


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
            "businessGoals": ["bg-1"],
            "usedBuildingBlocks": ["bb-1"],
        })
        assert uc.business_goals == ["bg-1"]
        assert uc.used_building_blocks == ["bb-1"]

    def test_domain_module_accepts_alias(self) -> None:
        dm = DomainModule.model_validate({
            "id": "mod-1",
            "name": "Test",
            "description": "Test module",
            "buildingBlocks": [
                {"id": "bb-1", "name": "Order", "type": "aggregate", "description": "Order"}
            ],
        })
        assert len(dm.building_blocks) == 1

    def test_bounded_context_accepts_alias(self) -> None:
        bc = BoundedContext.model_validate({
            "id": "bc-1",
            "name": "Test",
            "description": "Test context",
            "buildingBlocks": [
                {"id": "bb-1", "name": "Order", "type": "aggregate", "description": "Order"}
            ],
            "domainConcepts": [
                {"id": "dc-1", "name": "Order", "description": "Order concept"}
            ],
            "useCases": [
                {"id": "uc-1", "name": "Test", "actor": "a-1", "type": "Command"}
            ],
        })
        assert len(bc.building_blocks) == 1
        assert len(bc.domain_concepts) == 1
        assert len(bc.use_cases) == 1
