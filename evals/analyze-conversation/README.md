# analyze-conversation benchmark

End-to-end nasde benchmark for the `noesis:analyze-conversation` skill. The agent
runs the full 5-step pipeline against a synthetic parcel-locker design transcript
and merges the result into the noesis knowledge graph via the `noesis-graph` MCP
server.

**Requires `nasde-toolkit >= 0.4.0`** (uses the `[nasde.plugin]` feature to
ship the live noesis plugin from `src/agent_extensions/plugins/noesis` into the
Docker sandbox; not runnable on older nasde).

## Quick start

```bash
# 1. Install nasde 0.4.0+
uv tool install nasde-toolkit

# 2. Authenticate Claude (subscription OAuth — no per-token cost)
source ~/.claude/skills/nasde-benchmark-runner/scripts/export_oauth_token.sh

# 3. From this benchmark dir, run both variants in parallel
cd evals/analyze-conversation
make run            # vanilla + with-skill in parallel, with LLM-judge eval
```

See `make help` for all targets.

## Layout

```
Makefile                         convenience wrappers (`make run`, …)
nasde.toml                       project config (model, opik, dimensions)
assessment_dimensions.json       5 LLM-judge dimensions (total 100)
tasks/analyze-synthetic-conversation/
  task.toml                      nasde 0.4.0 task config + [nasde.plugin]
  instruction.md                 variant-neutral task statement
  assessment_criteria.md         0->max scoring ladder per dimension
  transcript.md                  FROZEN synthetic transcript (26 turns) — CANONICAL
  ground_truth/                  gold reference — NOT exposed to the agent
  environment/
    Dockerfile                   minimal base; nasde appends the plugin stage
    transcript.md                COPY of the canonical transcript, baked to /app/
    seed/noesis/topics/          2 pre-seeded topics (Goldilocks reuse path)
  tests/test.sh + verify.ts      deterministic structural verifier — validates
                                 the PERSISTED graph, not the transient output
  solution/solve.sh              token-free smoke solver (not used by normal runs)
variants/vanilla/                no skill — baseline
variants/with-skill/             runs the analyze-conversation skill + MCP
```

Generated at run time and gitignored:

- `tasks/*/environment/_nasde-plugin/` — live plugin staged by `[nasde.plugin]`
- `variants/*/harbor_config.json` — derived sandbox_files (`make help` shows flags)
- `jobs/` — run artifacts

## Deterministic facts

- `conversation_id` = `2c4ba4b1-d85d-6389-0452-e26f10c9de66` (content hash of the
  frozen `transcript.md`). If the transcript changes this id changes and ALL
  `ground_truth/*` files must be regenerated (re-run `scripts/conversation/prepare.ts`
  and re-derive the catalog / expected output).
- Pre-seeded topics: `Parcel Locker Platform` (root, id `1111…`) and its child
  `Locker Hardware` (id `2222…`). The skill must reuse the root via Goldilocks,
  not create a new one.
- The transcript is baked into the image at `/app/transcript.md` (nasde does
  not stage task input files; Harbor only delivers `instruction.md` as the
  agent prompt). Keep `tasks/.../environment/transcript.md` byte-identical to
  `tasks/.../transcript.md` or `verify.ts` check #2 (content-hash match) fails
  every trial.

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
`ground_truth/` is the LLM-judge's job (`make run` includes it; `NOEVAL=1`
skips it).
