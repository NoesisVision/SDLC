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

Useful one-liner for a quick summary:

```bash
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));s=d['stats']; print(f\"reward mean={s['evals'][next(iter(s['evals']))]['metrics'][0]['mean']}, cost=\${s['cost_usd']:.3f}, in={s['n_input_tokens']:,} cache={s['n_cache_tokens']:,} out={s['n_output_tokens']:,}\")" "$JOB"/result.json
```

# Prerequisites

nasde-toolkit must be installed (PyPI; `analyze-conversation` requires `>= 0.4.0`):

```bash
uv tool install nasde-toolkit
```

To verify: `nasde --version`
