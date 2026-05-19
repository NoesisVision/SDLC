# analyze-conversation benchmark

End-to-end nasde benchmark for the `noesis:analyze-conversation` skill. The agent
runs the full 5-step pipeline against a synthetic parcel-locker design transcript
and merges the result into the noesis knowledge graph via the `noesis-graph` MCP
server (baked into the Docker image).

## Layout

```
nasde.toml                       project config (model, opik, dimensions)
assessment_dimensions.json       5 LLM-judge dimensions (total 100)
tasks/analyze-synthetic-conversation/
  task.toml                      0.3.3: [task] (nasde) + [metadata]/[agent]/[environment]/[verifier] (Harbor)
  instruction.md                 variant-neutral task statement
  assessment_criteria.md         0->max scoring ladder per dimension
  transcript.md                  FROZEN synthetic transcript (26 turns) — CANONICAL
  ground_truth/                  gold reference — NOT exposed to the agent
  environment/
    Dockerfile                   bakes the plugin, bun install at build time
    _plugin-staging/             frozen noesis-plugin snapshot (build context)
    seed/noesis/topics/          2 pre-seeded topics (Goldilocks reuse path)
    transcript.md                COPY of the canonical transcript, baked to /app/
  tests/test.sh + verify.ts      deterministic structural verifier — validates
                                 the PERSISTED graph, not the transient output
  solution/solve.sh              token-free smoke solver (not used by normal runs)
variants/vanilla/                no skill, no tooling — capability-gap baseline
variants/with-skill/             runs the analyze-conversation skill + MCP
```

## Deterministic facts

- `conversation_id` = `2c4ba4b1-d85d-6389-0452-e26f10c9de66` (content hash of the
  frozen `transcript.md`). If the transcript changes this id changes and ALL
  `ground_truth/*` files must be regenerated (re-run `scripts/conversation/prepare.ts`
  and re-derive the catalog / expected output).
- **Transcript staging**: nasde only stages `variants/<name>/CLAUDE.md` + `skills/`
  into the sandbox; Harbor delivers `instruction.md` as the agent prompt. Neither
  stages the transcript. So `tasks/.../transcript.md` is **copied** to
  `environment/transcript.md` and baked to `/app/transcript.md` by the Dockerfile.
  The canonical copy is `tasks/.../transcript.md`; after editing it, re-copy:
  `cp tasks/analyze-synthetic-conversation/transcript.md tasks/analyze-synthetic-conversation/environment/transcript.md`
  then rebuild. Drift is self-detecting: `verify.ts` check #2 fails every trial if
  the baked transcript's hash != the produced `conversation_id`.
- Pre-seeded topics: `Parcel Locker Platform` (root, id `1111…`) and its child
  `Locker Hardware` (id `2222…`). The skill must reuse the root via Goldilocks,
  not create a new one.

## Verifier contract (why it checks the persisted graph)

`tests/verify.ts` validates the **persisted `/app/noesis/` graph**, NOT the
skill's transient `output.json`. Reasons:

- The skill writes `output.json` under `/opt/noesis-data/...` — Harbor only
  captures `/app` (`artifacts/workspace`), so that file is never even available
  post-run.
- `output.json` carries only the topics the run *touched*. When the skill reuses
  a pre-seeded topic via Goldilocks, the new topics' `parent_id` points at the
  seeded root whose canonical record is the on-disk `/app/noesis/topics` file.
  Validating `output.json` as self-contained wrongly reports "0 roots".

So for **with-skill**, verify.ts parses `/app/noesis/{conversations,topics,
decisions}/*.json` with the canonical on-disk schemas (`ConversationSchema`,
`TopicFileSchema`, `DecisionFileSchema`) and builds the full tree **including the
seed files**. For **vanilla** (no MCP/merge) it validates `/app/output.json`,
resolving `parent_id` against its own topics OR the seed ids it can see on disk.

**Topology rule**: exactly one *top-level attachment* — a node whose `parent_id`
is null OR points to a resolvable id outside the run's own node set (the seed).
with-skill: the seed files are in the set, so the genuine root has `parent_id`
null. vanilla: the seed is external, so its subtree legitimately attaches under
a seed id (one attachment, parent = seed id). Zero or multiple attachments, a
dangling parent, or a cycle → reward 0.

Reward 0/1 is structural only; categorization/decision/summary *quality* vs
`ground_truth/` is the LLM-judge's job (run without `--without-eval`).

## Refreshing the plugin snapshot (R7 — snapshot drift)

`environment/_plugin-staging/` and `variants/with-skill/skills/analyze-conversation/`
are frozen copies of the plugin under test. Refresh them deliberately when the
plugin changes, then bump `task.toml [metadata].plugin_snapshot_ref`:

```bash
cd <SDLC root>
SRC=src/agent_extensions/plugins/noesis/
DST=evals/analyze-conversation/tasks/analyze-synthetic-conversation/environment/_plugin-staging/
rsync -a --delete \
  --exclude 'node_modules/' --exclude '.serena/' --exclude 'noesis/' \
  --exclude '.git/' --exclude 'mcp/noesis-graph/ui/dist/' \
  --exclude 'NEW-DESIGN.md' --exclude 'REVIEW-*.md' \
  "$SRC" "$DST"
cp -R "$DST/skills/analyze-conversation" \
  evals/analyze-conversation/variants/with-skill/skills/analyze-conversation
git -C . rev-parse HEAD   # put this in task.toml [metadata].plugin_snapshot_ref
```

After refreshing, re-run the token-free smoke (see below) before any paid run.

## Running

Token-free smoke first (build + MCP boot + verifier, no LLM tokens) — see the
project worklog. Then:

```bash
nasde run --variant vanilla    --tasks analyze-synthetic-conversation -C evals/analyze-conversation --without-eval   # dry
nasde run --variant with-skill --tasks analyze-synthetic-conversation -C evals/analyze-conversation --without-eval   # dry
nasde run --variant vanilla    -C evals/analyze-conversation --with-opik
nasde run --variant with-skill -C evals/analyze-conversation --with-opik
```

`nasde run` consumes LLM tokens. The smoke steps do not.
