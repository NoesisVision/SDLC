# Modularization

- Modules form hierarchy. First level is Bounded Context, next levels are DDD Modules. Bounded Context can be treated as first level Module.
- Modules MUST NOT reflect be technical divisions like design patterns (Entities, Repositories, API, etc.) or architecture patterns (Application, Infrastructure, etc.).
- Module must have clear domain name that reflect domain concept (business capability or responsibility) of Building Blocks from that module.
- Create new Module when there are several Building Blocks strongly connected to each other and/or focused on a single domain concept.
- Place the newly created Module below the existing Module that models the closest domain concept with a broader scope. Modules hierarchy is a structure of the model. What is near in domain MUST to be near in the model.
- Never create first-level Module (Bounded Context) without user approval via AskUserQuestion tool.