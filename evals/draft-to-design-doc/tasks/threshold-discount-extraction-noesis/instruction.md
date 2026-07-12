# Extract a Design Doc using the noesis:analyze-design-draft skill

The Noesis plugin is installed in this sandbox and exposes the `noesis:analyze-design-draft` skill plus the `noesis-graph` MCP server. Use them.

## Inputs

- `/app/draft.md` — the design draft to analyse.
- `/app/repo/` — the target codebase the Design Doc describes (DDD-starter-dotnet, cloned from upstream). The skill / MCP `scan_to_tmp` tool can use this to determine what is already implemented and what is genuinely new.

## Output

- The skill persists the extracted Design Doc as a JSON file under `/app/noesis/design-docs/`. The filename is derived from the design doc's name and id by `prepare_design_doc_path`. Do not write the JSON manually — let the skill do it via `save_design_doc`.

## How to invoke the skill

Invoke the skill with the draft path and a design-doc title:

```
@/app/draft.md title="Threshold-activated discount" date=2026-05-08 main_topic="Discount value objects in Sales pricing" design_doc_title="threshold-activated-discount"
```

When the skill asks (during Setup) for the `design_doc_path`, answer:

```
/app/noesis/design-docs/
```

(the skill computes the canonical filename from the title and id; just give it the directory under `noesis/`).

The skill will:

1. Run `prepare.ts` on the draft → working dir + section tree + fragment list.
2. Find existing topics in the graph (Goldilocks).
3. Categorise fragments + assign topics.
4. Find existing decisions.
5. Review topics, generate summaries, extract decisions.
6. Extract the design model (per `extract-design-model.md` + `design-doc-schema.md`) and persist via `save_design_doc`. The diff baseline is the implemented codebase — call `noesis-graph:scan_to_tmp` first if you need to see what already exists in `/app/repo/`.
7. Merge topics, fragments and decisions via `merge_document`.

Follow the skill's workflow exactly; don't shortcut steps. The MCP server is `noesis-graph` (already registered in the sandbox's Claude config).

## Diff baseline

Per `extract-design-model.md` and `design-doc-schema.md` Section 3, the Design Doc is a diff against the **currently implemented codebase** under `/app/repo/`. For each element, ask: *is this already in /app/repo/, and is the draft changing it?*

- **Already in /app/repo, draft changes it** → goes in `modified`.
- **Not in /app/repo** → goes in `added`.
- **Already in /app/repo, no change** → omit.
- **In /app/repo, draft removes it** → `removed` (by name).

For this draft specifically:
- `Sales` BC already exists in `/app/repo/Sources/Sales/`. → `boundedContexts.modified`.
- `Sales.Pricing.Discounts` module already exists. → `modules.modified` under Sales.
- `Discount`, `PercentageDiscount`, `ValueDiscount` value objects already exist. → `modified` if changed, else omitted.
- `ThresholdDiscount` is genuinely new. → `buildingBlocks.added`.

## Rules

- Do not modify `/app/draft.md` or `/app/repo/`.
- Do not write JSON files outside the path the `save_design_doc` MCP tool returns.
- Do not bypass the skill — write the design doc through `save_design_doc`, never with `Write` directly.
