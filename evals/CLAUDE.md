# Approach

Use the **nasde-toolkit** CLI for all benchmark operations. Do NOT write custom
evaluation code — nasde handles Harbor orchestration, assessment evaluation,
and Opik integration.

Each benchmark may also ship a `Makefile` wrapping the common `nasde run` invocations
(see `analyze-conversation/Makefile` — `make run` launches both variants in parallel
to work around nasde's sequential `--all-variants`).

# Directory structure

```
evals/
├── decision-extraction/         # Older benchmark (nasde 0.3.x format — task.json + task.toml)
│   └── …
└── analyze-conversation/        # Newer benchmark (nasde 0.4.0+, uses [nasde.plugin])
    ├── Makefile                 # `make run` / `make run-vanilla` / `make run-with-skill`
    ├── nasde.toml               # Project config (model, opik, dimensions)
    ├── assessment_dimensions.json
    ├── tasks/
    │   └── analyze-synthetic-conversation/
    │       ├── task.toml        # [task] + [nasde.plugin] + [agent]/[environment]/[verifier]
    │       ├── instruction.md
    │       ├── assessment_criteria.md
    │       ├── transcript.md
    │       ├── ground_truth/
    │       ├── environment/Dockerfile
    │       └── tests/test.sh + verify.ts
    └── variants/
        ├── vanilla/             # Baseline (no skill)
        └── with-skill/          # Uses analyze-conversation skill
```

# Running benchmarks

```bash
# Convenience (analyze-conversation): both variants in parallel + LLM-judge
make -C evals/analyze-conversation run

# Direct nasde — all tasks, default variant from nasde.toml
nasde run -C evals/<benchmark>

# Specific variant with Opik tracking
nasde run --variant with-skill --with-opik -C evals/<benchmark>

# Skip assessment evaluation
nasde run --variant vanilla --without-eval -C evals/<benchmark>

# Re-evaluate existing results
nasde eval evals/<benchmark>/jobs/<timestamp> -C evals/<benchmark> --with-opik
```

# Reading results

`nasde run` prints a banner, a per-trial progress bar (`Mean: X ━━ wallclock`),
and a final "Results by agent/dataset" table. It does **not** print token
counts, $USD cost, or per-phase timing — those are written to JSON files and
must be read out of the job dir:

```bash
JOB=evals/<benchmark>/jobs/<timestamp>__<variant>__<suffix>

# Cost + tokens (input / cache-read / output) + reward summary, job-wide
cat "$JOB"/result.json | python3 -m json.tool | grep -E 'cost_usd|n_.*tokens|n_completed|n_errored|"mean"'

# Per-trial timing: environment_setup / agent_setup / agent_execution / verifier
cat "$JOB"/*/result.json | python3 -m json.tool | grep -E 'started_at|finished_at|cost_usd'

# LLM-judge scores per dimension (only if assessment ran)
cat "$JOB"/*/assessment_eval.json | python3 -m json.tool
```

Useful one-liners:

```bash
# Job-wide: reward + cost + token breakdown (from stats in top-level result.json)
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));s=d['stats']; print(f\"reward mean={s['evals'][next(iter(s['evals']))]['metrics'][0]['mean']}, cost=\${s['cost_usd']:.3f}, in={s['n_input_tokens']:,} cache={s['n_cache_tokens']:,} out={s['n_output_tokens']:,}\")" "$JOB"/result.json
```

LLM-judge scores are stored per trial (one `assessment_eval.json` per trial,
not aggregated at the job level), so a side-by-side variant comparison means
iterating over multiple job dirs:

```bash
# Per-variant total + per-dimension breakdown across one or more jobs (glob).
# Heredoc keeps the f-strings readable; copy this verbatim.
python3 - "evals/<benchmark>/jobs/<glob-or-single-job>" <<'PY'
import json, sys, glob
for job in sorted(glob.glob(sys.argv[1])):
    for f in sorted(glob.glob(f"{job}/*/assessment_eval.json")):
        d = json.load(open(f))
        max_total = sum(x["max_score"] for x in d["dimensions"])
        parts = [f'{x["name"][:14]}={x["score"]}/{x["max_score"]}' for x in d["dimensions"]]
        print(f'{d["agent_name"]:12} total={d["total_score"]:3}/{max_total} ({d["normalized_score"]:.2f})  ' + '  '.join(parts))
PY
```

Output example (from a real analyze-conversation paid run):

```
vanilla      total= 70/100 (0.70)  idea_unit_cate=22/25  topic_tree_cor=10/20  decision_extra=24/25  summary_qualit=6/20  pipeline_execu=8/10
with-skill   total= 78/100 (0.78)  idea_unit_cate=17/25  topic_tree_cor=12/20  decision_extra=22/25  summary_qualit=17/20  pipeline_execu=10/10
```

For full reasoning per dimension (long LLM-judge prose explaining each score),
read the raw `assessment_eval.json` — it has a `reasoning` field on every
dimension.

# Prerequisites

nasde-toolkit must be installed (PyPI; `analyze-conversation` requires `>= 0.4.0`):

```bash
uv tool install nasde-toolkit
```

To verify: `nasde --version`
