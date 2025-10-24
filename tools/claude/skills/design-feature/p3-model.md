# P3 Model semantic

Common element properties:
- Id: system-wide unique (across repos)
- Type: one of {DomainModule, DomainObject, DomainBehavior}
- Name: meaningful to the development team
- Tags: concise metadata (patterns, cross-cutting concerns, additional semantic, etc.)

## DomainModule
Purpose: primary unit to organize domain concepts; supports nesting and maps to both monolith and microservice styles.
Relations: contains DomainModule (nested), contains DomainObject, contains DomainBehavior

## DomainObject
Purpose: fundamental domain concept holding data and behaviors.
Relations: contains DomainBehavior; uses/is used by DomainObject/DomainBehavior; belongs to DomainModule
Common tags:
- Traditional: Entity, Service, Repository, DTO
- DDD: Aggregate, Entity, ValueObject, DomainService, ApplicationService, Repository, Factory

## DomainBehavior
Purpose: active operation; standalone or attached to a DomainObject.
Relations: uses DomainObject; invokes DomainBehavior; belongs to DomainModule / DomainObject;
Common tags: EntryPoint, ModuleInterface, InternalInterface, EventHandler, CommandHandler, QueryHandler