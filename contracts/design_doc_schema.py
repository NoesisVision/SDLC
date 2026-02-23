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


class UCType(str, Enum):
    COMMAND = "Command"
    EVENT = "Event"
    QUERY = "Query"


class QAType(str, Enum):
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
    uc_type: UCType = Field(alias="UCType")
    state: State
    input: list[DomainConceptRef] | None = None
    rules: list[RuleRef] | None = None
    output: list[DomainConceptRef] | None = None
    side_effects: list[str] | None = Field(default=None, alias="sideEffects")
    scenarios: list[ScenarioRef] | None = None
    qualities: list[QualityAttributeRef] | None = None


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
    qa_type: QAType = Field(alias="QAType")
    qa_description: str = Field(alias="QADescription")


class DesignDoc(BaseModel):
    rules: list[Rule] | None = None
    use_cases: list[UseCase] | None = Field(default=None, alias="useCases")
    domain_concepts: list[DomainConcept] | None = Field(default=None, alias="domainConcepts")
    scenarios: list[Scenario] | None = None
    quality_attributes: list[QualityAttribute] | None = Field(default=None, alias="qualityAttributes")

    model_config = {"populate_by_name": True}