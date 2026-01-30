# Tactical DDD Patterns Cheat Sheet

- **Entities**  
  Identity-centric objects whose lifecycle spans multiple state changes. Keep equality by identity, capture behavior that mutates state, and guard invariants through methods rather than exposing setters.

- **Value Objects**  
  Describe concepts with no inherent identity. Make them immutable, validate on creation, and model meaning through rich APIs (e.g., calculations, formatting) instead of primitive fields.

- **Aggregates**  
  Clusters of entities and value objects managed as a unit. Choose a root entity to enforce invariants, limit references to the root, and keep transactions within aggregate boundaries small to avoid contention.

- **Domain Events**  
  Immutable records of something meaningful that happened in the domain. Name them in the past tense, attach minimal context needed by subscribers, and store or publish them atomically with aggregate changes.

- **Domain Services**  
  Stateless operations that live in the domain when behavior does not naturally fit an entity or value object. Keep inputs and outputs domain concepts and ensure services coordinate aggregates without owning state.

- **Application Services**  
  Orchestrate use cases by invoking domain services, aggregates, and repositories. Handle transactions, security, and integration; leave domain rules to the domain layer.

- **Repositories**  
  Collection-like interfaces for retrieving and persisting aggregates. Work with fully formed domain objects, express intent (e.g., `findActiveOrdersFor(customer)`), and hide storage details to keep the domain model pure.

- **Factories**  
  Encapsulate complex creation logic for aggregates or value objects. Validate invariants at construction, return fully initialized objects, and prefer static factory methods or dedicated builder objects over exposing constructors.

- **Modules**  
  Packages of closely related concepts that reduce coupling. Name modules using ubiquitous language, keep inter-module dependencies explicit, and align module boundaries with bounded contexts to simplify integration.

- **Specifications**  
  Predicate objects that describe domain rules and can be combined (e.g., `and`, `or`, `not`). Reuse them for validation, querying, and policy checks to keep rule logic cohesive and testable.
