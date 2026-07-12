# Extract a Design Doc JSON from a design draft

Your task is to read the design draft at `/app/draft.md` and produce a Design Doc JSON file at `/app/output/design-doc.json`.

The Design Doc JSON must conform to the schema described at `/app/schema-reference.md`. Read the schema reference before writing the JSON — it is the contract the file is validated against.

## Inputs

- `/app/draft.md` — the design draft (Markdown). It mixes business requirements with explicit architectural decisions; treat the *Architectural decisions* section as authoritative for every "how" choice and the *Business requirement* / *Worked examples* / *Acceptance criteria* sections as authoritative for every "what" choice.
- `/app/schema-reference.md` — the JSON schema and modelling rules the Design Doc must satisfy.
- `/app/repo/` — the target codebase the Design Doc describes (DDD-starter-dotnet, cloned from upstream). Inspect it to determine what is already implemented and what is genuinely new.

## Output

- `/app/output/design-doc.json` — a single JSON document conforming to the schema.

## What "good" looks like

The Design Doc must be **faithful**: every Building Block, Behaviour, Rule, Scenario, Property and Quality Attribute corresponds to something stated in the draft. Do not invent elements the draft does not describe; do not omit decisions the draft makes explicit.

The Design Doc must be **schema-valid**: ChangeSets are correctly populated; every referenced Building Block name resolves; descriptions meet the length and structure requirements stated in the schema reference.

The Design Doc must be a **correct diff against the implemented codebase**. Per `schema-reference.md` Section 3, the diff baseline is the currently implemented codebase — i.e. `/app/repo/`. For each element in the doc, ask: *is this already in /app/repo/, and is the draft changing it?*

- **Already in /app/repo, draft changes it** → goes in `modified` (with only the changed sub-fields plus the identity `name`).
- **Not in /app/repo** → goes in `added`.
- **Already in /app/repo, no change** → omit (don't restate).
- **In /app/repo, draft removes it** → `removed` (by name).

Example for this draft:
- The `Sales` Bounded Context already exists in `/app/repo/Sources/Sales/`. → `boundedContexts.modified`.
- The `Sales.Pricing.Discounts` module already exists. → `modules.modified` under Sales.
- `Discount`, `PercentageDiscount`, `ValueDiscount` value objects already exist. → if the draft changes them, `buildingBlocks.modified`; if not, omit.
- `ThresholdDiscount` is genuinely new. → `buildingBlocks.added`.

## Rules

- Do not modify `/app/draft.md`, `/app/schema-reference.md`, or `/app/repo/`.
- Do not add files outside `/app/output/`.
- All JSON keys are camelCase.
- Write a single JSON file; do not split the doc across multiple files.
