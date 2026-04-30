# Design Doc Schema Reference

This file is loaded only when Step 6 of `noesis:analyze-design-draft` is reached. It captures (a) the JSON schema the produced design doc must conform to, (b) the heuristics for recognising model-describing content in a design draft, and (c) ChangeSet semantics.

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
  implements?: string[]                              // BB names this block implements (OOP-style polymorphism)
  properties?: ChangeSet<DesignedProperty>
  behaviours?: ChangeSet<DesignedBehaviour>
  rules?: ChangeSet<DesignedRule>
  scenarios?: ChangeSet<DesignedScenario>
}

DesignedProperty {
  name
  type?                          // BuildingBlock name OR primitive
  description?                   // free-form per-property note (range, format, special semantics)
  nullable?: boolean             // default false
  collection?: boolean           // default false — true means "list of <type>"
}

DesignedBehaviour {
  name
  description           // Required ≥400 chars on `added`; omit on `modified` when not changing.
                        // For application_service behaviours or those using ≥3 building blocks,
                        // embed a ```mermaid sequence diagram (warning, not error, when missing).
  type?: "Command"|"Event"|"Query"
  input?: ChangeSet<string>            // BuildingBlock names
  output?: ChangeSet<string>           // BuildingBlock names
  usedBuildingBlocks?: ChangeSet<string>
  rules?: ChangeSet<DesignedRule>
  scenarios?: ChangeSet<DesignedScenario>
  isPublic: boolean                    // default false
  actor?: string                       // Actor name initiating this behaviour
}

DesignedRule {
  name
  ruleType?: "Consistency"|"Structure"|"Computation"|"State change"
  description           // Required ≥80 chars on `added`; omit on `modified` when not changing.
                        // Server rejects tautologies that paraphrase `name`.
}
DesignedScenario { name; description; given; when; then }

ChangeSet<T> { added: T[]; modified: T[]; removed: string[] }    // removed by name
```

## 3. ChangeSet rules

The diff baseline is the **currently implemented codebase** (what `noesis:implement-design-doc` will read as the starting state of the codebase), **not** the prior Design Doc record. Bucket every item by asking *"is this item already in code?"*:

- **Not in code** → `added`. The implementer needs to bring it into existence.
- **In code, definition unchanged** → omit (don't restate).
- **In code, definition changed** → `modified` with only the changed sub-fields plus the identity `name`.
- **In code, no longer wanted** → `removed` (by name).

For nested `ChangeSet`s (e.g. `DesignedBuildingBlock.properties`), recurse with the same baseline question per item. A `modified` building block whose only change is a new property emits `{ name: "...", properties: { added: [{name, type}] } }`.

When all of `added`, `modified` and `removed` are empty for a given collection field, **omit the field entirely** rather than emitting `{ "added": [], "modified": [], "removed": [] }`.

**Implementation status — pin the baseline before authoring the diff.**

- **Green-field implementation status** (no `implement-design-doc` run has materialised this design in code yet — the typical case for a first or second authoring pass): every item belongs in `added`, even when a prior Design Doc record already lists them. `modified` and `removed` stay empty until implementation has happened. A second authoring pass against the same unimplemented design keeps items in `added` (with refined definitions); it does **not** move them to `modified`.
- **Post-implementation status** (one or more `implement-design-doc` runs have produced code from this design): the diff is against the resulting code. The prior Design Doc record is a *hint* about what was last asked-for; the system of record is the code.

**Identity.** `name` is the identity key for every entity. A rename of an item already in code is `removed: ["<old>"]` + `added: [<new>]`, plus a sweep of cross-references (`input`, `output`, `usedBuildingBlocks`, `properties[].type`, `implements`) to point at the new name. A rename of an item *not* in code is just `added: [<new>]` — the prior design doc's `<old>` is irrelevant because no code has it yet.

## 4. Naming conventions

- BuildingBlock names: `PascalCase` (e.g. `OrderAggregate`, `PriceCalculated`).
- Behaviour names: `PascalCase` matching the type — Commands as imperative (`PlaceOrder`), Events past tense (`OrderPlaced`), Queries noun + `By...` (`OrderById`).
- Actor names: free-form (`Customer`, `External Pricing Service`).
- BoundedContext / Module names: domain-language nouns (`Pricing`, `InventoryManagement`).
- Re-use names that already exist in the knowledge graph (check by reading the current design doc first); only introduce new names when no semantic match exists.

## 5. Modelling conventions

### 5.1 Interchangeable Building Blocks

When two or more BBs need to be interchangeable in some context (heterogeneous collection elements, polymorphic property values, behaviour I/O), introduce an explicit **base Building Block** that models the common abstraction. Implementing BBs declare `implements: ["<BaseBB>"]`; property / input / output `type` then references the **base BB by name**.

The base BB is a real domain concept — name the role and the shared shape, not "Anything" or "Item". Do not invent a phantom umbrella BB just to satisfy the schema. If the polymorphism does not correspond to a real shared abstraction, rethink the model rather than fabricate a base.

**Worked example.** A composite component tree — a `CompositeComponent` whose `children` is a list of either `CompositeComponent` or `SimpleComponent`:

```jsonc
{
  "name": "Component",
  "type": "value_object",
  "description": "Common abstraction over composite and leaf components in an emissions breakdown tree.",
  "properties": { "added": [
    { "name": "id", "type": "ComponentId" },
    { "name": "label", "type": "String" }
  ] }
},
{
  "name": "CompositeComponent",
  "type": "value_object",
  "implements": ["Component"],
  "properties": { "added": [
    { "name": "children", "type": "Component", "collection": true }
  ] }
},
{
  "name": "SimpleComponent",
  "type": "value_object",
  "implements": ["Component"]
}
```

The validator resolves every `implements` entry against declared BBs (in this doc or in the prior model). Property `type` values like `"Component"` are valid because `Component` is declared.

### 5.2 Mermaid blocks inside `description` fields

Embed mermaid diagrams in JSON `description` fields with `\n`-separated lines:

```json
"description": "...behaviour body...\n\n```mermaid\nsequenceDiagram\n  Actor->>Service: trigger\n  Service-->>Actor: ack\n```"
```

The triple-backtick `mermaid` opener and the trailing triple-backtick close the block. Use this for application_service behaviours and any behaviour using ≥3 Building Blocks. Authoring the diagram in §3.5 of `noesis:create-design-doc` is preferred over deferring it to a save-warning round-trip.

## 6. Producing the JSON

1. If iterating, call `noesis-graph:read_design_doc` first; cache the rendered Markdown, never load the JSON wholesale. Treat it as a hint — the diff baseline is the implemented codebase (§3).
2. Walk model-bearing fragments grouped by Bounded Context.
3. For each entity built, set its name from the source heading or the first declarative sentence; do NOT invent names that are absent from the draft.
4. Validate locally: every `usedBuildingBlocks` / `input` / `output` reference, every `properties[].type`, and every entry in `implements` must resolve to a BuildingBlock name present in the same DesignDoc (existing or `added`). Unknown references are bugs in extraction — flag and either drop the reference or promote the missing block to `added`.
5. SKILL.md Step 4 owns the Save flow (write the JSON, run the pre-save check, call `save_design_doc`). Do not duplicate Save instructions here.

## 7. Worked examples

### 7.1 Green-field iteration (no code yet)

Second authoring pass on a Design Doc whose `implement-design-doc` has **not** run. The prior Design Doc record lists `PlaceOrder` with `description: "..."` (300 chars). The new authoring pass refines the description to 480 chars and adds a new property to `Order`.

Correct ChangeSets:

```jsonc
{
  "boundedContexts": { "added": [
    {
      "name": "Sales",
      "buildingBlocks": { "added": [
        {
          "name": "Order",
          "type": "aggregate",
          "properties": { "added": [
            { "name": "id", "type": "OrderId" },
            { "name": "customerId", "type": "CustomerId" },
            { "name": "couponCode", "type": "String", "nullable": true }   // newly modelled this pass
          ] },
          "behaviours": { "added": [
            { "name": "PlaceOrder", "type": "Command", "description": "...refined 480-char description...", "isPublic": true }
          ] }
        }
      ] }
    }
  ] }
}
```

Both `Order` and `PlaceOrder` stay in `added` because no code exists yet. `modified` and `removed` are absent.

### 7.2 Post-implementation rename

Code exists. The design renames `Lock` → `PriceStateLock`. The aggregate keeps its body; only the name changes. `Lock.quantity` is also referenced from `PriceState.lock`.

```jsonc
{
  "boundedContexts": { "modified": [
    {
      "name": "Pricing",
      "buildingBlocks": {
        "removed": ["Lock"],
        "added": [
          {
            "name": "PriceStateLock",
            "type": "aggregate",
            "properties": { "added": [{ "name": "id", "type": "PriceStateLockId" }, { "name": "quantity", "type": "Quantity" }] },
            "behaviours": { "added": [/* full new spec — same body, new name */] }
          }
        ]
      }
    }
  ] }
}
```

Plus a sweep so `PriceState.lock`'s property `type` and any `usedBuildingBlocks` referencing the old name now reference `PriceStateLock`. The validator rejects a save where `removed: ["Lock"]` coexists with any reference to `"Lock"` elsewhere.

## 8. Things this agent must NOT do

- Do not invent business rules, scenarios, or properties not stated in the source. The draft is the source of truth; gap-filling is the architect's job, not the extractor's.
- Do not classify discussion / comparison content as model content. Comparison tables ("Vector RAG vs PageIndex") are NOT Building Blocks.
- Do not invent module names from arbitrary headings. Modules must reflect actual cohesion in the model — not arbitrary heading structure in the source. **However**, once a Bounded Context contains more than ~15 Building Blocks, group them into 3–7 Modules along natural cohesion axes (typically the topic structure pulled in Step 2). Reuse those topic names rather than inventing fresh module names. A Module with fewer than 3 Building Blocks is a smell — fold it back into the BC or merge with a sibling. `save_design_doc` emits a warning when a Bounded Context has >20 building blocks and zero modules.
- Do not produce an empty DesignDoc (no actors, no contexts, no quality attributes). If extraction yields nothing, skip writing the design doc JSON and skip the `save_design_doc` call.
- Do not invent a phantom umbrella Building Block to satisfy a heterogeneous collection — model the real abstraction or omit `type` (§5.1).
