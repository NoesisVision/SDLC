# Draft → Design Doc

Quick eval comparing how Claude Code extracts a Design Doc JSON from a Markdown design draft, across three levels of scaffolding:

| Variant | Task | Prompt | Plugin / MCP | Expected output |
|---|---|---|---|---|
| `vanilla` | `threshold-discount-extraction` | minimal | none | `/app/output/design-doc.json` |
| `guided` | `threshold-discount-extraction` | extended (mirrors `analyze-design-draft` reference) | none | `/app/output/design-doc.json` |
| `noesis` | `threshold-discount-extraction-noesis` | "use the skill" | full plugin + `noesis-graph` MCP | `/app/noesis/design-docs/<slug>-<id>.json` |

## TDD note (read this first)

`tests/test.sh` is **TDD-style** — it asserts the *expected correct behaviour*, not the current behaviour of the noesis plugin. It is **identical** for all three variants (one spec, three implementations).

Currently `noesis-graph:save_design_doc` enforces a green-field ChangeSet shape: every collection's `added` is populated and `modified` / `removed` are empty. That's a bug — the Design Doc is supposed to express the diff against the implemented codebase. The DDD-starter-dotnet repo is mounted at `/app/repo/`; the agent should use it as the diff baseline.

The test asserts:

- `Sales` BC in `boundedContexts.modified` (it already exists in `/app/repo/Sources/Sales/`)
- `Sales.Pricing.Discounts` module in `Sales.modules.modified` (already exists)
- `ThresholdDiscount` in `buildingBlocks.added` under that module (genuinely new)
- `Discount` in `buildingBlocks.modified` (already exists; the draft adds a new `Threshold` factory behaviour)

Until the green-field constraint is lifted, **all three variants will FAIL**. That's the intended TDD signal — when the bug is fixed, runs that produce the correct shape start passing.

Each task ships its own copy of `test.sh`, but the assertions are byte-for-byte identical. The two paths exist only because Harbor binds `task.toml` → one Dockerfile → one verifier per task, and the noesis variant needs a different sandbox (Bun + plugin install + MCP server).

## Auth

```bash
source ~/Documents/git/noesis/sdlc-projects/nasde-toolkit/scripts/export_oauth_token.sh
```

## Run

The two non-noesis variants share a single task:

```bash
nasde run --variant vanilla --tasks threshold-discount-extraction --without-eval -C evals/draft-to-design-doc
nasde run --variant guided  --tasks threshold-discount-extraction --without-eval -C evals/draft-to-design-doc
```

The noesis variant has a dedicated task (different sandbox: bun + plugin install + MCP server). Stage the plugin sources into the docker build context once, then run:

```bash
bash evals/draft-to-design-doc/tasks/threshold-discount-extraction-noesis/environment/prepare-context.sh
nasde run --variant noesis --tasks threshold-discount-extraction-noesis --without-eval -C evals/draft-to-design-doc
```

Re-run `prepare-context.sh` whenever the plugin sources under `src/agent_extensions/plugins/noesis/` change — it's a `rsync` mirror so it stays cheap.

## Inspect output

```bash
LATEST=$(ls -td evals/draft-to-design-doc/jobs/*__<variant>__*/ | head -1)
DOC=$(find "$LATEST" -name "design-doc.json" -o -name "*.json" -path "*noesis/design-docs/*" | head -1)
jq '.' "$DOC" | less
```

## Notes

- `--without-eval` skips the LLM-as-Judge phase. `assessment_dimensions.json` is intentionally empty here — quality grading is owned by manual inspection until the dimensions are designed.
- The vanilla and guided variants do NOT pass `--with-opik` (no Opik tracking by default). Add the flag when comparing across runs.
- Per-variant results live under `jobs/<timestamp>__<variant>__<suffix>/<task>__<trial>/`. The produced design doc is in `artifacts/workspace/output/design-doc.json` (vanilla/guided) or `artifacts/workspace/noesis/design-docs/<file>.json` (noesis).
