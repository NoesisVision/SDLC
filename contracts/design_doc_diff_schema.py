from typing import Generic, TypeVar

from pydantic import BaseModel, Field

from contracts.design_doc_schema import (
    Actor,
    Behaviour,
    BuildingBlockType,
    BusinessGoal,
    DomainConcept,
    Property,
    QualityAttribute,
    Rule,
    Scenario,
    UseCaseType,
)

T = TypeVar("T")


class ChangeSet(BaseModel, Generic[T]):
    """Diff for a collection of elements.

    `added` contains new elements (all fields should be populated).
    `removed` contains element ids or names.
    `modified` contains only the changed fields, matched by id or name.
    """

    added: list[T] = []
    removed: list[str] = []
    modified: list[T] = []


class BuildingBlockMod(BaseModel):
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


class UseCaseMod(BaseModel):
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


class DomainModuleMod(BaseModel):
    """Modification of a DomainModule.

    When used in `added`: all scalar fields must be populated.
    When used in `modified`: only changed fields are set (None = no change).
    """

    model_config = {"populate_by_name": True}

    id: str
    name: str | None = None
    description: str | None = None
    building_blocks: ChangeSet[BuildingBlockMod] | None = Field(
        default=None, alias="buildingBlocks"
    )


class BoundedContextMod(BaseModel):
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
    modules: ChangeSet[DomainModuleMod] | None = None
    building_blocks: ChangeSet[BuildingBlockMod] | None = Field(
        default=None, alias="buildingBlocks"
    )
    use_cases: ChangeSet[UseCaseMod] | None = Field(
        default=None, alias="useCases"
    )


class DesignDocDiff(BaseModel):
    """Describes changes to a DesignDoc.

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
    bounded_contexts: ChangeSet[BoundedContextMod] | None = Field(
        default=None, alias="boundedContexts"
    )
