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


class BehaviorType(str, Enum):
    COMMAND = "Command"
    EVENT = "Event"
    QUERY = "Query"


class Property(BaseModel):
    """A named property of a building block."""

    name: str = Field(description="Property name")
    type: str | None = Field(
        default=None, description="BuildingBlock id or primitive type name"
    )


class Rule(BaseModel):
    """A business or domain rule that constrains behaviour."""

    model_config = {"populate_by_name": True}

    name: str = Field(description="Rule name")
    rule_type: RuleType | None = Field(
        default=None, alias="ruleType", description="Type of the rule"
    )
    description: str | None = Field(
        default=None, description="Human-readable rule description"
    )


class Scenario(BaseModel):
    """A BDD-style scenario"""

    name: str = Field(description="Short scenario title")
    description: str = Field(description="What the scenario verifies")
    given: str = Field(description="Precondition or initial context")
    when: str = Field(description="Action or event that triggers the scenario")
    then: str = Field(description="Expected outcome or postcondition")


class ChangeSet(BaseModel, Generic[T]):
    """Diff for a collection of elements.

    `added` contains new elements (all fields should be populated).
    `removed` contains element ids or names.
    `modified` contains only the changed fields, matched by id or name.
    """

    added: list[T] = Field(default_factory=list, description="New elements to add")
    removed: list[str] = Field(
        default_factory=list, description="Ids or names of elements to remove"
    )
    modified: list[T] = Field(
        default_factory=list, description="Elements with only changed fields set"
    )


class Behaviour(BaseModel):
    """An operation or action that a building block can perform."""

    model_config = {"populate_by_name": True}

    name: str = Field(description="Short behaviour name")
    description: str | None = Field(
        default=None, description="What this behaviour does"
    )
    type: BehaviorType | None = Field(
        default=None, description="Whether this is a command, event, or query"
    )
    input: ChangeSet[str] | None = Field(
        default=None, description="List of input BuildingBlock ids"
    )
    output: ChangeSet[str] | None = Field(
        default=None, description="List of output BuildingBlock ids"
    )
    used_building_blocks: ChangeSet[str] | None = Field(
        default=None,
        alias="usedBuildingBlocks",
        description="Changes to referenced BuildingBlock ids",
    )
    rules: ChangeSet[Rule] | None = Field(
        default=None, description="Rules governing this behaviour"
    )
    scenarios: ChangeSet[Scenario] | None = Field(
        default=None, description="Changes to BDD scenarios"
    )
    is_public: bool = Field(
        default=False, description="Whether this is a public API"
    )
    actor: str | None = Field(
        default=None, description="Actor id who initiates this behavior"
    )


class Actor(BaseModel):
    """A person, system, or role that interacts with the domain."""

    name: str = Field(description="Actor name")
    description: str | None = Field(
        default=None, description="What this actor represents"
    )


class QualityAttribute(BaseModel):
    """A non-functional requirement or quality characteristic."""

    name: str = Field(description="Quality attribute name")
    type: QualityAttributeType | None = Field(
        default=None, description="Category of quality attribute"
    )
    description: str | None = Field(
        default=None, description="Measurable quality expectation"
    )


class BuildingBlock(BaseModel):
    """Modification of a BuildingBlock.

    When used in `added`: all scalar fields must be populated,
    sub-elements go into their ChangeSet's `added`.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    name: str = Field(description="Building block name")
    type: BuildingBlockType | None = Field(
        default=None, description="DDD building block type"
    )
    description: str | None = Field(
        default=None, description="Purpose of this building block"
    )
    properties: ChangeSet[Property] | None = Field(
        default=None, description="Changes to properties"
    )
    behaviours: ChangeSet[Behaviour] | None = Field(
        default=None, description="Changes to behaviours"
    )
    rules: ChangeSet[Rule] | None = Field(
        default=None, description="Changes to business rules"
    )
    scenarios: ChangeSet[Scenario] | None = Field(
        default=None, description="Changes to BDD scenarios"
    )


class DomainModule(BaseModel):
    """Modification of a DomainModule.

    When used in `added`: all scalar fields must be populated.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    name: str = Field(description="Module name")
    description: str | None = Field(
        default=None, description="Purpose of this module"
    )
    building_blocks: ChangeSet[BuildingBlock] | None = Field(
        default=None,
        alias="buildingBlocks",
        description="Changes to building blocks in this module",
    )


class BoundedContext(BaseModel):
    """Modification of a BoundedContext.

    When used in `added`: all scalar fields must be populated.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    name: str = Field(description="Bounded context name")
    description: str | None = Field(
        default=None, description="Scope and responsibility of this context"
    )
    modules: ChangeSet[DomainModule] | None = Field(
        default=None, description="Changes to domain modules"
    )
    building_blocks: ChangeSet[BuildingBlock] | None = Field(
        default=None,
        alias="buildingBlocks",
        description="Changes to top-level building blocks",
    )

class DesignDoc(BaseModel):
    """Describes changes to a design.

    Each field is None when there are no changes to that collection.
    First iteration is a diff from empty state (everything in `added`).
    """

    model_config = {"populate_by_name": True}

    description: str = Field(description="Summary of what this design change covers")
    actors: ChangeSet[Actor] | None = Field(
        default=None, description="Changes to actors"
    )
    bounded_contexts: ChangeSet[BoundedContext] | None = Field(
        default=None,
        alias="boundedContexts",
        description="Changes to bounded contexts",
    )
