from enum import Enum
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


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
    rules: list["Rule"] = []


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


class ChangeSet(BaseModel, Generic[T]):
    """Diff for a collection of elements.

    `added` contains new elements (all fields should be populated).
    `removed` contains element ids or names.
    `modified` contains only the changed fields, matched by id or name.
    """

    added: list[T] = []
    removed: list[str] = []
    modified: list[T] = []


class BuildingBlock(BaseModel):
    """Modification of a BuildingBlock.

    When used in `added`: all scalar fields must be populated,
    sub-elements go into their ChangeSet's `added`.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    id: str
    name: str | None = None
    type: BuildingBlockType | None = None
    description: str | None = None
    properties: ChangeSet[Property] | None = None
    behaviours: ChangeSet[Behaviour] | None = None
    rules: ChangeSet[Rule] | None = None
    scenarios: ChangeSet[Scenario] | None = None


class UseCase(BaseModel):
    """Modification of a UseCase.

    When used in `added`: all scalar fields must be populated.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    id: str
    name: str | None = None
    actor: str | None = None
    type: UseCaseType | None = None
    description: str | None = None
    business_goals: ChangeSet[str] | None = Field(
        default=None, alias="businessGoals"
    )
    input: ChangeSet[str] | None = None
    output: ChangeSet[str] | None = None
    used_building_blocks: ChangeSet[str] | None = Field(
        default=None, alias="usedBuildingBlocks"
    )
    rules: ChangeSet[Rule] | None = None
    scenarios: ChangeSet[Scenario] | None = None
    quality_attributes: ChangeSet[str] | None = Field(
        default=None, alias="qualityAttributes"
    )


class DomainModule(BaseModel):
    """Modification of a DomainModule.

    When used in `added`: all scalar fields must be populated.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    id: str
    name: str | None = None
    description: str | None = None
    building_blocks: ChangeSet[BuildingBlock] | None = Field(
        default=None, alias="buildingBlocks"
    )


class BoundedContext(BaseModel):
    """Modification of a BoundedContext.

    When used in `added`: all scalar fields must be populated.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    id: str
    name: str | None = None
    description: str | None = None
    domain_concepts: ChangeSet[DomainConcept] | None = Field(
        default=None, alias="domainConcepts"
    )
    modules: ChangeSet[DomainModule] | None = None
    building_blocks: ChangeSet[BuildingBlock] | None = Field(
        default=None, alias="buildingBlocks"
    )
    use_cases: ChangeSet[UseCase] | None = Field(
        default=None, alias="useCases"
    )


class DesignDoc(BaseModel):
    """Describes changes to a design.

    Each field is None when there are no changes to that collection.
    First iteration is a diff from empty state (everything in `added`).
    """

    model_config = {"populate_by_name": True}

    description: str
    actors: ChangeSet[Actor] | None = None
    business_goals: ChangeSet[BusinessGoal] | None = Field(
        default=None, alias="businessGoals"
    )
    quality_attributes: ChangeSet[QualityAttribute] | None = Field(
        default=None, alias="qualityAttributes"
    )
    bounded_contexts: ChangeSet[BoundedContext] | None = Field(
        default=None, alias="boundedContexts"
    )
