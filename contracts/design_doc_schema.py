from enum import Enum
from pydantic import BaseModel, Field


class RuleType(str, Enum):
    CONSISTENCY = "Consistency"
    STRUCTURE = "Structure"
    COMPUTATION = "Computation"
    STATE_CHANGE = "State change"


class State(str, Enum):
    CONFIRMED = "Confirmed"
    ASSUMED = "Assumed"


class UseCaseType(str, Enum):
    COMMAND = "Command"
    EVENT = "Event"
    QUERY = "Query"


class QualityAttributeType(str, Enum):
    PERFORMANCE = "performance"
    AVAILABILITY = "availability"
    CAPEX = "CAPEX"
    OPEX = "OPEX"
    SECURITY = "security"
    OTHER = "other"


class BuildingBlockType(str, Enum):
    AGGREGATE = "Aggregate"
    ENTITY = "Entity"
    VALUE_OBJECT = "Value object"
    DOMAIN_EVENT = "Domain event"
    DOMAIN_SERVICE = "Domain service"
    REPOSITORY = "Repository"
    FACTORY = "Factory"
    OBJECT = "Object"


class Actor(BaseModel):
    id: str
    name: str
    description: str


class BusinessGoal(BaseModel):
    id: str
    name: str
    description: str


class ActorRef(BaseModel):
    id: str = Field(description="Reference to an Actor id")


class BusinessGoalRef(BaseModel):
    id: str = Field(description="Reference to a BusinessGoal id")


class DomainConceptRef(BaseModel):
    id: str = Field(description="Reference to a DomainConcept id")


class RuleRef(BaseModel):
    id: str = Field(description="Reference to a Rule id")


class ScenarioRef(BaseModel):
    name: str = Field(description="Reference to a Scenario name")


class QualityAttributeRef(BaseModel):
    id: str = Field(description="Reference to a QualityAttribute id")


class BuildingBlockRef(BaseModel):
    id: str = Field(description="Reference to a BuildingBlock id")


class Attribute(BaseModel):
    name: str
    type: str


class Behaviour(BaseModel):
    name: str
    description: str
    input: list[DomainConceptRef] = []
    output: list[DomainConceptRef] = []
    rules: list[RuleRef] = []
    emits: list[BuildingBlockRef] = []


class Relation(BaseModel):
    target: BuildingBlockRef
    relation_type: str = Field(alias="relationType")


class BuildingBlock(BaseModel):
    id: str
    name: str
    description: str
    block_type: BuildingBlockType = Field(alias="blockType")
    attributes: list[Attribute] = []
    behaviours: list[Behaviour] = []
    relations: list[Relation] = []


class Rule(BaseModel):
    id: str
    rule_type: RuleType = Field(alias="ruleType")
    state: State
    rule_description: str = Field(alias="ruleDescription")


class UseCase(BaseModel):
    id: str
    name: str
    actor: ActorRef
    business_goal: BusinessGoalRef = Field(alias="businessGoal")
    uc_description: str | None = Field(default=None, alias="UCDescription")
    uc_type: UseCaseType = Field(alias="UseCaseType")
    state: State
    input: list[DomainConceptRef] = []
    rules: list[RuleRef] = []
    output: list[DomainConceptRef] = []
    side_effects: list[str] = Field(default_factory=list, alias="sideEffects")
    scenarios: list[ScenarioRef] = []
    qualities: list[QualityAttributeRef] = []


class DomainConcept(BaseModel):
    id: str
    name: str
    definition: str


class Scenario(BaseModel):
    name: str
    scenario_description: str = Field(alias="ScenarioDescription")
    content: str


class QualityAttribute(BaseModel):
    id: str
    name: str
    qa_type: QualityAttributeType = Field(alias="QualityAttributeType")
    qa_description: str = Field(alias="QADescription")


class DesignDoc(BaseModel):
    actors: list[Actor] = []
    business_goal: BusinessGoal = Field(alias="businessGoal")
    rules: list[Rule] = []
    use_cases: list[UseCase] = Field(default_factory=list, alias="useCases")
    domain_concepts: list[DomainConcept] = Field(default_factory=list, alias="domainConcepts")
    scenarios: list[Scenario] = []
    quality_attributes: list[QualityAttribute] = Field(default_factory=list, alias="qualityAttributes")
    building_blocks: list[BuildingBlock] = Field(default_factory=list, alias="buildingBlocks")
