# Design Doc Schema Reference

This file is loaded by the `extract-design-model` subagent. It captures (a) the JSON schema the produced `design_doc.json` must conform to, (b) the heuristics for recognising model-describing content in a design draft, and (c) ChangeSet semantics.

## 1. Recognising model content in a draft

A section is treated as **model-describing** when its heading or body contains terms from the following lexicon. The match is fuzzy — "Bounded Context", "BC", "Context: Pricing" all count.

| Concept | Heading / inline cues |
|---|---|
| Actor | "Actor", "User Role", "Persona" |
| Bounded Context | "Bounded Context", "BC", "Context:", "Subdomain" |
| Module | "Module", "Domain Module", "Package" |
| Building Block | "Aggregate", "Entity", "Value Object", "Domain Event", "Command", "Query", "Domain Service", "Application Service", "Repository", "Factory", "External Integration" |
| Behaviour | "Behaviour", "Use case", "Operation", "Scenario name" |
| Rule | "Business rule", "Invariant", "Constraint", "Rule:" |
| Scenario | "Scenario:", "Given/When/Then", "Acceptance criteria" |
| Quality Attribute | "Performance", "Availability", "Security", "Quality attribute", "NFR" |

A section that contains none of the above (e.g. background discussion, narrative, comparison tables) is NOT a model section. Skip it.

## 2. JSON schema (TypeScript / Zod, mirrors `shared-contracts/design-doc.ts`)

All field names are **camelCase**. All collection fields are wrapped in a `ChangeSet`.

```ts
DesignDoc {
  id?: string                                  // omit for first iteration → server generates UUID
  name: string                                 // stable human-readable, e.g. "pageindex-tree-search"
  description: string                          // 1–2 sentences, what this design covers
  actors?: ChangeSet<DesignedActor>
  boundedContexts?: ChangeSet<DesignedBoundedContext>
  qualityAttributes?: ChangeSet<DesignedQualityAttribute>
}

DesignedActor { name; description? }
DesignedQualityAttribute { name; type?: "performance"|"availability"|"security"|"other"; description? }

DesignedBoundedContext {
  name
  description?
  modules?: ChangeSet<DesignedDomainModule>
  buildingBlocks?: ChangeSet<DesignedBuildingBlock>   // blocks not belonging to any module
}

DesignedDomainModule {
  name; description?
  buildingBlocks?: ChangeSet<DesignedBuildingBlock>
}

DesignedBuildingBlock {
  name
  type?: "aggregate"|"entity"|"value_object"|"domain_event"|"domain_command"|"domain_query"
       | "domain_service"|"application_service"|"repository"|"factory"|"external_integration"
  description?
  properties?: ChangeSet<DesignedProperty>           // { name; type? } — type = BuildingBlock name OR primitive
  behaviours?: ChangeSet<DesignedBehaviour>
  rules?: ChangeSet<DesignedRule>
  scenarios?: ChangeSet<DesignedScenario>
}

DesignedBehaviour {
  name
  description?
  type?: "Command"|"Event"|"Query"
  input?: ChangeSet<string>            // BuildingBlock names
  output?: ChangeSet<string>           // BuildingBlock names
  usedBuildingBlocks?: ChangeSet<string>
  rules?: ChangeSet<DesignedRule>
  scenarios?: ChangeSet<DesignedScenario>
  isPublic: boolean                    // default false
  actor?: string                       // Actor name initiating this behaviour
}

DesignedRule { name; ruleType?: "Consistency"|"Structure"|"Computation"|"State change"; description? }
DesignedScenario { name; description; given; when; then }

ChangeSet<T> { added: T[]; modified: T[]; removed: string[] }    // removed by name
```

## 3. ChangeSet rules

- **First-time design** (no `<design_doc_id>` provided): everything goes into `added`. Leave `modified` and `removed` empty.
- **Iteration on existing design** (`<design_doc_id>` provided): always diff against the result of `noesis-graph:read_design_doc`.
    - `added`: items present in the draft but absent from the current design.
    - `modified`: items present in both, but with at least one changed field. Include only the changed sub-fields plus `name` (which is the identity key).
    - `removed`: list of `name` strings for items present in the current design but absent from the draft.
- For nested `ChangeSet`s (e.g. `DesignedBuildingBlock.properties`), the same rules apply recursively. A `modified` building block whose only change is a new property emits `{ name: "...", properties: { added: [{name, type}], modified: [], removed: [] } }`.
- **Identity**: `name` is the identity key for every entity. Renames must be expressed as `removed` + `added`.

## 4. Naming conventions

- BuildingBlock names: `PascalCase` (e.g. `OrderAggregate`, `PriceCalculated`).
- Behaviour names: `PascalCase` matching the type — Commands as imperative (`PlaceOrder`), Events past tense (`OrderPlaced`), Queries noun + `By...` (`OrderById`).
- Actor names: free-form (`Customer`, `External Pricing Service`).
- BoundedContext / Module names: domain-language nouns (`Pricing`, `InventoryManagement`).
- Re-use names that already exist in the knowledge graph (check by reading the current design doc first); only introduce new names when no semantic match exists.

## 5. Producing the JSON

1. If iterating, call `noesis-graph:read_design_doc` first; cache the rendered Markdown, never load the JSON wholesale.
2. Walk model-bearing fragments grouped by Bounded Context.
3. For each entity built, set its name from the source heading or the first declarative sentence; do NOT invent names that are absent from the draft.
4. Validate locally: every `usedBuildingBlocks` / `input` / `output` reference must resolve to a BuildingBlock name present in the same DesignDoc (existing or `added`). Unknown references are bugs in extraction — flag and either drop the reference or promote the missing block to `added`.
5. Write the result to `{working_dir}/design_doc.json`.
6. Do NOT call `save_design_doc` directly — `merge_document` (Step 8 of the parent skill) does it.

## 6. Things this agent must NOT do

- Do not invent business rules, scenarios, or properties not stated in the source. The draft is the source of truth; gap-filling is the architect's job, not the extractor's.
- Do not classify discussion / comparison content as model content. Comparison tables ("Vector RAG vs PageIndex") are NOT Building Blocks.
- Do not promote a heading to a Module unless a separate Building Block sub-heading is nested under it. Modules group blocks; lone-heading sections become Building Blocks directly under the BoundedContext.
- Do not produce an empty DesignDoc (no actors, no contexts, no quality attributes). If extraction yields nothing, return `{ "status": "NoModel" }` from the subagent and skip the merge step for the design doc.
