# implement-design-doc-java

Skill that translates DesignDoc JSON contracts into Java domain model code, adapting to the target project's coding style.

## Installation

```bash
claude install-skill src/agent_extensions/skills/implement_design_doc_java/implement_design_doc_java.skill
```

Or copy `SKILL.md` and `references/` into your project's `.claude/skills/` directory.

## Usage

Provide a DesignDoc JSON file (conforming to `contracts/design-doc-schema.json`) and point to your Java project:

```
Implement the DesignDoc JSON into my Java project.
DesignDoc: path/to/design-doc.json
Project: path/to/java-project/
```

The skill will:
1. Read existing code to detect project conventions (Lombok, records, Either, sealed interfaces, facade pattern, etc.)
2. Parse the DesignDoc JSON and resolve building block references
3. Search for existing shared types (IDs, Money) and import them instead of creating duplicates
4. Generate Java classes in dependency order: value objects → events → entities → aggregates → services → repositories → application services
5. Match the project's package structure, error handling, encapsulation, and naming conventions

## What it handles

- **Building block types**: aggregate, entity, value_object, domain_event, domain_command, domain_query, domain_service, application_service, repository, factory, external_integration
- **Style adaptation**: Lombok, plain Java, Java records, sealed interfaces, Vavr Either, Spring Configuration, facade pattern, command/handler pattern, service-per-use-case
- **Reuse detection**: finds existing classes by name before creating new ones
- **Encapsulation**: entities within aggregates get package-private visibility
- **Cross-module**: places building blocks in correct packages based on bounded context / module hierarchy

## DesignDoc JSON schema

The input JSON follows the DesignDoc schema with these top-level fields:

```json
{
  "actors": [],
  "businessGoals": [],
  "domainConcepts": [],
  "rules": [],
  "qualityAttributes": [],
  "boundedContexts": [],
  "buildingBlocks": [],
  "useCases": [],
  "scenarios": []
}
```

Each `buildingBlock` has `id`, `name`, `type`, `description`, `properties`, and `behaviours`. Behaviours reference other building blocks by ID (`input`/`output`) and rules by ID.

See `references/designdoc_mapping.md` for detailed mapping rules from JSON to Java.

## Eval results

Tested on 4 discriminating scenarios with neutral prompts (no hints):

| Scenario | With Skill | Without Skill | Delta |
|---|---|---|---|
| Pricing (Plain Java + Vavr) | 9/9 | 7/9 | +22% |
| Payroll (Mixed patterns) | 9/9 | 7/9 | +22% |
| Receiving (Unusual conventions) | 8/8 | 6/8 | +25% |
| Returns (Cross-module) | 9/9 | 9/9 | 0% |
| **Total** | **35/35 (100%)** | **29/35 (83%)** | **+17pp** |

Key skill advantages over baseline Claude:
- Reuses existing shared types instead of creating duplicates
- Detects package-private encapsulation for entities within aggregates
- Follows service-per-use-case pattern when project uses it
