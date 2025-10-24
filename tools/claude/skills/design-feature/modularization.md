# Modularization

- Domain Modules form hierarchy. First level should be treated as DDD Bounded Context, next levels should be treated as DDD Modules.
- Domain Modules MUST NOT reflect be technical divisions like design patterns (Entities, Repositories, API, etc.) or architecture patterns (Application, Infrastructure, etc.).
- Domain Module must have clear domain name that reflect domain concept (business capability or responsibility) of Elements from that module.
- Create new Domain Module when there are several Elements strongly connected to each other and/or focused on a single domain concept.
- Plane newly created Domain Modul below existing Domain Module that models nearest domain concept with a wider scope. Domain Modules hierarchy is a structure of the model. What is near in domain have to be near in the model.
- Never create first level Domain Module (Bounded Context) without asking user for acceptance.