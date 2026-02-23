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


class DomainConceptRef(BaseModel):
    id: str = Field(description="Reference to a DomainConcept id")


class RuleRef(BaseModel):
    id: str = Field(description="Reference to a Rule id")


class ScenarioRef(BaseModel):
    name: str = Field(description="Reference to a Scenario name")


class QualityAttributeRef(BaseModel):
    id: str = Field(description="Reference to a QualityAttribute id")


class Rule(BaseModel):
    id: str
    rule_type: RuleType = Field(alias="ruleType")
    state: State
    rule_description: str = Field(alias="ruleDescription")


class UseCase(BaseModel):
    id: str
    name: str
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
    rules: list[Rule] = []
    use_cases: list[UseCase] = Field(default_factory=list, alias="useCases")
    domain_concepts: list[DomainConcept] = Field(default_factory=list, alias="domainConcepts")
    scenarios: list[Scenario] = []
    quality_attributes: list[QualityAttribute] = Field(default_factory=list, alias="qualityAttributes")
