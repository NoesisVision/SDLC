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
    rules: list[Rule] = []


class Rule(BaseModel):
    model_config = {"populate_by_name": True}

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
    rules: list[Rule] = []
    scenarios: list[Scenario] = []


class DomainModule(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    name: str
    description: str
    building_blocks: list[BuildingBlock] = Field(default_factory=list, alias="buildingBlocks",
                                                 description="List of BuildingBlocks")


class BoundedContext(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    name: str
    description: str
    domain_concepts: list[DomainConcept] = Field(default_factory=list, alias="domainConcepts")
    modules: list[DomainModule] = []
    building_blocks: list[BuildingBlock] = Field(default_factory=list, alias="buildingBlocks",
                                                 description="List of BuildingBlocks not in any module")
    use_cases: list[UseCase] = Field(default_factory=list, alias="useCases")


class UseCase(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    name: str
    actor: str = Field(description="Reference to an Actor id")
    type: UseCaseType
    description: str = ""
    business_goals: list[str] = Field(
        default_factory=list, alias="businessGoals", description="List of BusinessGoal ids"
    )
    input: list[str] = Field(default_factory=list, description="List of BuildingBlock ids")
    output: list[str] = Field(default_factory=list, description="List of BuildingBlock ids")
    used_building_blocks: list[str] = Field(
        default_factory=list, alias="usedBuildingBlocks", description="List of BuildingBlock ids"
    )
    rules: list[Rule] = []
    scenarios: list[Scenario] = []
    quality_attributes: list[str] = Field(default_factory=list, description="List of QualityAttribute ids")


class DesignDoc(BaseModel):
    model_config = {"populate_by_name": True}

    actors: list[Actor] = []
    business_goals: list[BusinessGoal] = Field(default_factory=list, alias="businessGoals")
    quality_attributes: list[QualityAttribute] = Field(default_factory=list, alias="qualityAttributes")
    bounded_contexts: list[BoundedContext] = Field(default_factory=list, alias="boundedContexts")
