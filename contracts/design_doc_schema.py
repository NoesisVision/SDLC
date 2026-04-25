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


class BehaviorType(str, Enum):
    COMMAND = "Command"
    EVENT = "Event"
    QUERY = "Query"


class Property(BaseModel):
    name: str
    type: str | None = Field(
        default=None, description="BuildingBlock name or primitive type name"
    )


class Rule(BaseModel):
    """A business or domain rule that constrains behaviour."""

    model_config = {"populate_by_name": True}

    name: str
    rule_type: RuleType | None = Field(default=None, alias="ruleType")
    description: str | None = None


class Scenario(BaseModel):
    """A BDD-style scenario"""

    name: str = Field(description="Concise title, a few words")
    description: str = Field(description="What the scenario verifies")
    given: str = Field(description="Precondition or initial context")
    when: str = Field(description="Action or event that triggers the scenario")
    then: str = Field(description="Expected outcome or postcondition")


class ChangeSet[T](BaseModel):
    """Diff for a collection of elements.

    `added` contains new elements (all fields should be populated).
    `removed` contains element ids or names.
    `modified` contains only the changed fields, matched by id or name.
    """

    added: list[T] = Field(default_factory=list)
    removed: list[str] = Field(
        default_factory=list, description="Names of elements to remove"
    )
    modified: list[T] = Field(
        default_factory=list, description="Elements with only changed fields set"
    )


class Behaviour(BaseModel):
    """An operation or action that a building block can perform."""

    model_config = {"populate_by_name": True}

    name: str = Field(description="Concise name, a few words")
    description: str | None = None
    type: BehaviorType | None = None
    input: ChangeSet[str] | None = Field(
        default=None, description="Input BuildingBlock names"
    )
    output: ChangeSet[str] | None = Field(
        default=None, description="Output BuildingBlock names"
    )
    used_building_blocks: ChangeSet[str] | None = Field(
        default=None,
        alias="usedBuildingBlocks",
        description="Referenced BuildingBlock names",
    )
    rules: ChangeSet[Rule] | None = None
    scenarios: ChangeSet[Scenario] | None = None
    is_public: bool = False
    actor: str | None = Field(
        default=None, description="Name of the actor who initiates this behaviour"
    )


class Actor(BaseModel):
    """A person, system, or role that interacts with the domain."""

    name: str
    description: str | None = None


class QualityAttribute(BaseModel):
    """A non-functional requirement or quality characteristic."""

    name: str
    type: QualityAttributeType | None = None
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

    name: str
    type: BuildingBlockType | None = None
    description: str | None = None
    properties: ChangeSet[Property] | None = None
    behaviours: ChangeSet[Behaviour] | None = None
    rules: ChangeSet[Rule] | None = None
    scenarios: ChangeSet[Scenario] | None = None


class DomainModule(BaseModel):
    """Modification of a DomainModule.

    When used in `added`: all scalar fields must be populated.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    name: str
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

    name: str
    description: str | None = Field(
        default=None, description="Scope and responsibility of this context"
    )
    modules: ChangeSet[DomainModule] | None = None
    building_blocks: ChangeSet[BuildingBlock] | None = Field(
        default=None,
        alias="buildingBlocks",
        description="Building blocks not belonging to any module",
    )

class DesignDoc(BaseModel):
    """Describes changes to a design.

    Each field is None when there are no changes to that collection.
    First iteration is a diff from empty state (everything in `added`).
    """

    model_config = {"populate_by_name": True}

    description: str = Field(description="Summary of what this design change covers")
    actors: ChangeSet[Actor] | None = None
    bounded_contexts: ChangeSet[BoundedContext] | None = Field(
        default=None, alias="boundedContexts"
    )
