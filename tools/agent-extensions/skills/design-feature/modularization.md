# Modularization

- Domain Modules form hierarchy. First level should be treated as DDD Bounded Context, next levels should be treated as DDD Modules.
- Domain Modules MUST NOT reflect be technical divisions like design patterns (Entities, Repositories, API, etc.) or architecture patterns (Application, Infrastructure, etc.).
- Domain Module must have clear domain name that reflect domain concept (business capability or responsibility) of Elements from that module.
- Create new Domain Module when there are several Elements strongly connected to each other and/or focused on a single domain concept.
- Place the newly created domain module below the existing domain module that models the closest domain concept with a broader scope. Domain Modules hierarchy is a structure of the model. What is near in domain MUST to be near in the model.
- Never create first-level Domain Module (Bounded Context) without user approval via AskUserQuestion tool.