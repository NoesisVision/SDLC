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
| Rule | "Business rule", "Invariant", "Constraint", "Rule:" — must be a **domain concern** |
| Scenario | "Scenario:", "Given/When/Then", "Acceptance criteria" |
| Quality Attribute | "Performance", "Availability", "Security", "Quality attribute", "NFR", "SLA", "SLO" — must be a **technical concern** |

A section that contains none of the above (e.g. background discussion, narrative, comparison tables) is NOT a model section. Skip it.

**Rule vs Quality Attribute discriminator.** Rules describe *what the business says is true* (invariants over domain state, transitions, computations). Quality attributes describe *how the system must behave technically* (latency, throughput, availability targets, authn/authz constraints, data-protection requirements). When in doubt, ask: does the constraint live in the ubiquitous language of the domain, or in the operational vocabulary of the platform? Domain → Rule. Platform → Quality Attribute.

## 2. JSON schema (TypeScript / Zod, mirrors `shared-contracts/design-doc.ts`)

All field names are **camelCase**. All collection fields are wrapped in a `ChangeSet`.

```ts
DesignDoc {
  id?: string                                  // omit for first iteration → server generates UUID
  name: string                                 // stable human-readable, e.g. "pageindex-tree-search"
  description: string                          // 1–2 sentences, what this design covers
  boundedContexts?: ChangeSet<DesignedBoundedContext>
}

DesignedBoundedContext {
  name
  description?
  modules?: ChangeSet<DesignedDomainModule>
  buildingBlocks?: ChangeSet<DesignedBuildingBlock>   // blocks not belonging to any module
  qualityAttributes?: ChangeSet<DesignedQualityAttribute>   // BC-wide technical concerns
}

DesignedDomainModule {
  name; description?
  buildingBlocks?: ChangeSet<DesignedBuildingBlock>
  qualityAttributes?: ChangeSet<DesignedQualityAttribute>   // Module-wide technical concerns
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
  qualityAttributes?: ChangeSet<DesignedQualityAttribute>   // BB-wide technical concerns
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
  qualityAttributes?: ChangeSet<DesignedQualityAttribute>   // Behaviour-scoped technical concerns
  isPublic: boolean                    // default false
  actor?: string                       // Graph-global actor name. Only valid when host BuildingBlock type === "application_service".
}

DesignedRule {
  name
  ruleType?: "Consistency"|"Structure"|"Computation"|"State change"
  description           // Domain concern. Required ≥80 chars on `added`; omit on `modified` when not changing.
                        // Server rejects tautologies that paraphrase `name`.
}
DesignedScenario { name; description; given; when; then }
DesignedQualityAttribute {
  name
  type?: "performance"|"availability"|"security"|"other"
  description           // Technical concern. Required ≥80 chars on `added`; omit on `modified` when not changing.
                        // State a measurable expectation (target metric, threshold, scope).
}

ChangeSet<T> { added: T[]; modified: T[]; removed: string[] }    // removed by name
```

**Actors are not part of the DesignDoc tree.** They live as a graph-global catalog. Use them via three side channels:

1. `noesis-graph:list_actors` returns the catalog `[{ name, description }, …]`. Call it before authoring to see what already exists.
2. Reference an actor on an `application_service` behaviour by setting `behaviour.actor = "<name>"`. Reuse names verbatim from the catalog whenever the persona matches.
3. Introduce a new actor with `noesis-graph:upsert_actor` (`{ name, description }`) **before** calling `save_design_doc`. The save validates that every referenced actor exists in the catalog and that `actor` is set only on `application_service` behaviours; both are hard errors.

`save_design_doc` rejects:
- A `qualityAttributes` ChangeSet attached at the wrong level when the same QA name is also declared at a wider scope in the same doc (pick one — the narrowest level that covers the constraint).
- An `actor` set on a behaviour whose host BuildingBlock type is anything other than `application_service`.
- A `behaviour.actor` whose name is not present in the actor catalog.

## 3. ChangeSet rules

The diff baseline is the **currently implemented codebase as a whole** (what `noesis:implement-design-doc` will read as the starting state) — *not* "the code this particular design doc has produced," and *not* the prior Design Doc record. Bucket every item by asking *"is this item already in code, anywhere in the codebase?"*:

- **Not in code** → `added`. The implementer needs to bring it into existence.
- **In code, definition unchanged** → omit (don't restate). References to it from this doc still resolve against the prior model (see §6.5), so there is no need to re-declare it just to reference it.
- **In code, definition changed** → `modified` with only the changed sub-fields plus the identity `name`.
- **In code, no longer wanted** → `removed` (by name).

For nested `ChangeSet`s (e.g. `DesignedBuildingBlock.properties`), recurse with the same baseline question per item. A `modified` building block whose only change is a new property emits `{ name: "...", properties: { added: [{name, type}] } }`.

When all of `added`, `modified` and `removed` are empty for a given collection field, **omit the field entirely** rather than emitting `{ "added": [], "modified": [], "removed": [] }`.

**Identity.** `name` is the identity key for every entity. A rename of an item already in code is `removed: ["<old>"]` + `added: [<new>]`, plus a sweep of cross-references (`input`, `output`, `usedBuildingBlocks`, `properties[].type`, `implements`, `behaviour.actor`) to point at the new name. A rename of an item *not* in code is just `added: [<new>]` — the prior design doc's `<old>` is irrelevant because no code has it yet.

## 4. Naming conventions

- BuildingBlock names: `PascalCase` (e.g. `OrderAggregate`, `PriceCalculated`).
- Behaviour names: `PascalCase` matching the type — Commands as imperative (`PlaceOrder`), Events past tense (`OrderPlaced`), Queries noun + `By...` (`OrderById`).
- Actor names: free-form (`Customer`, `Warehouse Operator`). **Always check `list_actors` for an existing match before introducing a new one.**
- BoundedContext / Module names: domain-language nouns (`Pricing`, `InventoryManagement`).
- Quality attribute names: `<Type>:<Subject>` is a useful convention (`Performance:OrderListLatency`, `Security:CardholderData`), but free-form is allowed when a single descriptive token is clearer.
- Re-use names that already exist in the knowledge graph (check by reading the current design doc first); only introduce new names when no semantic match exists.

## 5. Modelling conventions

### 5.1 Quality attribute placement — narrowest level that applies

Each quality attribute attaches at exactly one of: `Behaviour`, `BuildingBlock`, `DesignedDomainModule`, `DesignedBoundedContext`. Pick the **narrowest** scope that covers the constraint:

- The constraint applies only to one specific behaviour (e.g. *"`PlaceOrder` p95 ≤ 200 ms"*) → attach to that `Behaviour`.
- The constraint applies to a BuildingBlock as a whole (e.g. *"`OrderRepository` reads must be served by a read replica"*) → attach to that `BuildingBlock`.
- The constraint spans sibling BuildingBlocks in one Module (e.g. *"`Pricing.Calculation` must be deterministic and pure"*) → attach to that `DesignedDomainModule`.
- The constraint covers the whole Bounded Context (e.g. *"`Billing` must redact PII from all logs"*) → attach to that `DesignedBoundedContext`.

Do not duplicate a QA across levels. If you find yourself attaching the same QA to multiple levels, lift it to the lowest common ancestor.

### 5.2 Rule vs Quality Attribute

- **Rule** = domain concern. Belongs to the ubiquitous language. Examples: *"An invoice cannot be issued before the order has been paid in full."*, *"A discount of more than 30% requires manager approval."*. Verified at runtime by domain code, exercised by Scenarios.
- **Quality Attribute** = technical concern. Belongs to operations, security, performance, availability vocabulary. Examples: *"`PlaceOrder` p95 ≤ 200 ms under 100 RPS sustained"*, *"All requests authenticated via OAuth2 bearer."*, *"Service availability ≥ 99.9% measured monthly."*. Verified by tests/SLOs/policies, not by domain rule machinery.

A constraint that fits both buckets is almost always a Rule with one or more derived Quality Attributes — express the domain truth as a Rule, then add a QA only when the technical envelope is also part of the contract.

### 5.3 Interchangeable Building Blocks

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

### 5.4 Mermaid blocks inside `description` fields

Embed mermaid diagrams in JSON `description` fields with `\n`-separated lines:

```json
"description": "...behaviour body...\n\n```mermaid\nsequenceDiagram\n  Actor->>Service: trigger\n  Service-->>Actor: ack\n```"
```

The triple-backtick `mermaid` opener and the trailing triple-backtick close the block. Use this for application_service behaviours and any behaviour using ≥3 Building Blocks. Authoring the diagram in §3.5 of `noesis:create-design-doc` is preferred over deferring it to a save-warning round-trip.

## 6. Producing the JSON

1. If iterating, call `noesis-graph:read_design_doc` first; cache the rendered Markdown, never load the JSON wholesale. Treat it as a hint — the diff baseline is the implemented codebase (§3).
2. Call `noesis-graph:list_actors` and keep the catalog handy — it is the deduplication source for `behaviour.actor` names.
3. Walk model-bearing fragments grouped by Bounded Context.
4. For each entity built, set its name from the source heading or the first declarative sentence; do NOT invent names that are absent from the draft.
5. Validate locally: every `usedBuildingBlocks` / `input` / `output` reference, every `properties[].type`, every entry in `implements`, and every `behaviour.actor` must resolve. BB references resolve against either (a) BBs declared in this doc (in `added` or `modified`), or (b) BBs already present in the prior model (i.e. in the implemented codebase). Do NOT re-declare a BB in `added` just to satisfy a reference when it already exists in the prior model and you are not changing it. Actor names resolve against the catalog (or new actors you will introduce). Unknown references are bugs in extraction — flag and either drop the reference, promote a genuinely-missing block to `added`, or call `upsert_actor` for a new actor before save.
6. Before `save_design_doc`, call `noesis-graph:upsert_actor` for every new actor name introduced — the save fails if a referenced actor isn't in the catalog.
7. SKILL.md Step 4 owns the Save flow (write the JSON, run the pre-save check, call `save_design_doc`). Do not duplicate Save instructions here.

## 7. Worked examples

### 7.1 Green-field iteration (no code yet)

Second authoring pass on a Design Doc whose `implement-design-doc` has **not** run, and whose Bounded Context does not yet exist in code. The prior Design Doc record lists `PlaceOrder` with `description: "..."` (300 chars). The new authoring pass refines the description to 480 chars, adds a new property to `Order`, attaches an actor and a behaviour-scoped quality attribute.

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
            { "name": "couponCode", "type": "String", "nullable": true }
          ] }
        },
        {
          "name": "PlaceOrderService",
          "type": "application_service",
          "behaviours": { "added": [
            {
              "name": "PlaceOrder",
              "type": "Command",
              "isPublic": true,
              "actor": "Customer",
              "description": "...refined 480-char description...",
              "qualityAttributes": { "added": [
                {
                  "name": "Performance:PlaceOrderLatency",
                  "type": "performance",
                  "description": "p95 ≤ 200 ms at 100 RPS sustained, measured at the API boundary; degrades to p95 ≤ 500 ms at 250 RPS."
                }
              ] }
            }
          ] }
        }
      ] }
    }
  ] }
}
```

Both Order and PlaceOrder stay in `added` because no code exists yet. `modified` and `removed` are absent. The QA hangs off the behaviour because it is specific to `PlaceOrder` and would not survive being lifted to the BC.

The skill must have called `upsert_actor({ name: "Customer", description: "..." })` before this save — `Customer` either reuses the catalog entry or is freshly registered.

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

- Do not invent business rules, scenarios, properties, or quality attributes not stated in the source. The draft is the source of truth; gap-filling is the architect's job, not the extractor's.
- Do not classify discussion / comparison content as model content. Comparison tables ("Vector RAG vs PageIndex") are NOT Building Blocks.
- Do not invent module names from arbitrary headings. Modules must reflect actual cohesion in the model — not arbitrary heading structure in the source. **However**, once a Bounded Context contains more than ~15 Building Blocks, group them into 3–7 Modules along natural cohesion axes (typically the topic structure pulled in Step 2). Reuse those topic names rather than inventing fresh module names. A Module with fewer than 3 Building Blocks is a smell — fold it back into the BC or merge with a sibling. `save_design_doc` emits a warning when a Bounded Context has >20 building blocks and zero modules.
- Do not produce an empty DesignDoc (no contexts). If extraction yields no model material, skip writing the design doc JSON and skip the `save_design_doc` call.
- Do not invent a phantom umbrella Building Block to satisfy a heterogeneous collection — model the real abstraction or omit `type` (§5.3).
- Do not classify a domain invariant as a Quality Attribute or vice versa (§5.2). The discriminator is "domain concern vs technical concern".
- Do not attach a Quality Attribute at a level wider than its actual scope (§5.1) — pick the narrowest container.
- Do not place an `actor` on a behaviour whose host is not an `application_service` — `save_design_doc` rejects it.
- Do not reference an actor name that is not in the catalog. Either reuse from `list_actors` or call `upsert_actor` first.
