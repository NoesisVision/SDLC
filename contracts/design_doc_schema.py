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


class Actor(BaseModel):
    id: str
    name: str
    description: str


class BusinessGoal(BaseModel):
    id: str
    name: str
    description: str


class Attribute(BaseModel):
    name: str
    type: str


class Behaviour(BaseModel):
    name: str
    description: str
    input: list[str] = Field(default_factory=list, description="List of building block ids")
    output: list[str] = Field(default_factory=list, description="List of building block ids")
    rules: list[str] = Field(default_factory=list, description="List of Rule ids")
    emits: list[str] = Field(default_factory=list, description="List of DomainEvent ids")


class Aggregate(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    attributes: list[Attribute] = []
    behaviours: list[Behaviour] = []
    entities: list[str] = Field(default_factory=list, description="List of Entity ids")
    value_objects: list[str] = Field(default_factory=list, alias="valueObjects", description="List of ValueObject ids")
    domain_events: list[str] = Field(default_factory=list, alias="domainEvents", description="List of DomainEvent ids")


class Entity(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    attributes: list[Attribute] = []
    behaviours: list[Behaviour] = []


class ValueObject(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    attributes: list[Attribute] = []
    behaviours: list[Behaviour] = []


class DomainEvent(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    attributes: list[Attribute] = []


class DomainCommand(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    attributes: list[Attribute] = []


class DomainQuery(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    attributes: list[Attribute] = []


class DomainService(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    behaviours: list[Behaviour] = []


class ApplicationService(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    behaviours: list[Behaviour] = []


class Repository(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    behaviours: list[Behaviour] = []


class Factory(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    behaviours: list[Behaviour] = []


class ExternalIntegration(BaseModel):
    id: str
    name: str
    description: str
    owner: str | None = Field(default=None, description="BoundedContext or DomainModule id")
    behaviours: list[Behaviour] = []


class DomainModule(BaseModel):
    id: str
    name: str
    description: str
    aggregates: list[str] = Field(default_factory=list, description="List of Aggregate ids")
    entities: list[str] = Field(default_factory=list, description="List of Entity ids")
    value_objects: list[str] = Field(default_factory=list, alias="valueObjects", description="List of ValueObject ids")
    domain_events: list[str] = Field(default_factory=list, alias="domainEvents", description="List of DomainEvent ids")
    domain_commands: list[str] = Field(default_factory=list, alias="domainCommands", description="List of DomainCommand ids")
    domain_queries: list[str] = Field(default_factory=list, alias="domainQueries", description="List of DomainQuery ids")
    domain_services: list[str] = Field(default_factory=list, alias="domainServices", description="List of DomainService ids")
    application_services: list[str] = Field(default_factory=list, alias="applicationServices", description="List of ApplicationService ids")
    repositories: list[str] = Field(default_factory=list, description="List of Repository ids")
    factories: list[str] = Field(default_factory=list, description="List of Factory ids")
    external_integrations: list[str] = Field(default_factory=list, alias="externalIntegrations", description="List of ExternalIntegration ids")


class BoundedContext(BaseModel):
    id: str
    name: str
    description: str
    modules: list[DomainModule] = []
    use_cases: list[str] = Field(default_factory=list, alias="useCases", description="List of UseCase ids")
    aggregates: list[str] = Field(default_factory=list, description="List of Aggregate ids")
    entities: list[str] = Field(default_factory=list, description="List of Entity ids")
    value_objects: list[str] = Field(default_factory=list, alias="valueObjects", description="List of ValueObject ids")
    domain_events: list[str] = Field(default_factory=list, alias="domainEvents", description="List of DomainEvent ids")
    domain_commands: list[str] = Field(default_factory=list, alias="domainCommands", description="List of DomainCommand ids")
    domain_queries: list[str] = Field(default_factory=list, alias="domainQueries", description="List of DomainQuery ids")
    domain_services: list[str] = Field(default_factory=list, alias="domainServices", description="List of DomainService ids")
    application_services: list[str] = Field(default_factory=list, alias="applicationServices", description="List of ApplicationService ids")
    repositories: list[str] = Field(default_factory=list, description="List of Repository ids")
    factories: list[str] = Field(default_factory=list, description="List of Factory ids")
    external_integrations: list[str] = Field(default_factory=list, alias="externalIntegrations", description="List of ExternalIntegration ids")


class Rule(BaseModel):
    id: str
    rule_type: RuleType = Field(alias="ruleType")
    state: State
    rule_description: str = Field(alias="ruleDescription")


class UseCase(BaseModel):
    id: str
    name: str
    actor: str = Field(description="Reference to an Actor id")
    bounded_context: str | None = Field(default=None, alias="boundedContext", description="Reference to a BoundedContext id")
    business_goal: str = Field(alias="businessGoal", description="Reference to a BusinessGoal id")
    uc_description: str | None = Field(default=None, alias="UCDescription")
    uc_type: UseCaseType = Field(alias="UseCaseType")
    state: State
    input: list[str] = Field(default_factory=list, description="List of building block ids")
    rules: list[str] = Field(default_factory=list, description="List of Rule ids")
    output: list[str] = Field(default_factory=list, description="List of building block ids")
    side_effects: list[str] = Field(default_factory=list, alias="sideEffects")
    scenarios: list[str] = Field(default_factory=list, description="List of Scenario names")
    qualities: list[str] = Field(default_factory=list, description="List of QualityAttribute ids")


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
    scenarios: list[Scenario] = []
    quality_attributes: list[QualityAttribute] = Field(default_factory=list, alias="qualityAttributes")
    bounded_contexts: list[BoundedContext] = Field(default_factory=list, alias="boundedContexts")
    aggregates: list[Aggregate] = []
    entities: list[Entity] = []
    value_objects: list[ValueObject] = Field(default_factory=list, alias="valueObjects")
    domain_events: list[DomainEvent] = Field(default_factory=list, alias="domainEvents")
    domain_commands: list[DomainCommand] = Field(default_factory=list, alias="domainCommands")
    domain_queries: list[DomainQuery] = Field(default_factory=list, alias="domainQueries")
    domain_services: list[DomainService] = Field(default_factory=list, alias="domainServices")
    application_services: list[ApplicationService] = Field(default_factory=list, alias="applicationServices")
    repositories: list[Repository] = []
    factories: list[Factory] = []
    external_integrations: list[ExternalIntegration] = Field(default_factory=list, alias="externalIntegrations")
