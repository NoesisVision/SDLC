# Approach

Always check documentation before implementing anything!! Make attempts to find solutions which are confirmed and recommended in documentation instead of following tempting ideas to extend capabilities by custom code!
Hacky integration ideas using custom scripts are STRONGLY DISCOURAGED.

Do not write custom code until necessary

# Directory structure

```
evals/
├── eval-platforms/          # Reusable framework: parsers, importers, evaluators
│   ├── evaluate_architecture.py   # Architecture evaluator (Claude Code SDK + Opik)
│   ├── atif_parser.py             # ATIF trajectory parser
│   ├── import_opik.py             # Opik importer (deprecated)
│   └── patches/                   # Vendor patches
└── <benchmark-name>/        # Benchmark-specific: tasks, variants, runner
    ├── run-benchmark.sh           # Benchmark runner
    ├── tasks/<task>/
    │   ├── instruction.md         # What the agent must do
    │   └── architecture_criteria.md  # Evaluation rubric (per task)
    └── variants/                  # Agent configurations
```

**Rule:** Code that could work with any benchmark goes in `eval-platforms/`.
Task definitions, evaluation criteria, and benchmark runners go in the
benchmark directory. The evaluator discovers task paths from `result.json`
(`task_id.path`), not from hardcoded paths.

# Environment setup

Both `harbor-ai` and `opik` must be installed in the **same** Python virtual environment
so that `opik harbor run` can import the Harbor module.

The project uses `uv` with a single `.venv` at the repo root. All CLI tools
(harbor, opik) must be invoked via `uv run` — never via globally-installed
`uv tool` shims, which run in isolated venvs and cannot see each other's packages.

```bash
# Correct — uses project .venv where both packages coexist:
uv run opik harbor run --config config.json
uv run harbor run --config config.json

# Wrong — isolated uv tool venvs, opik cannot import harbor:
opik harbor run --config config.json
```

# Vendor patches

Two patching approaches are used in this project. See `evals/README.md` for
detailed trade-off analysis.

## File patches (re-apply after `uv sync`)

After reinstalling opik (`uv pip install opik` or `uv sync`), re-apply patches:

```bash
./evals/eval-platforms/patches/apply_opik_patches.sh          # apply
./evals/eval-platforms/patches/apply_opik_patches.sh --check   # verify
```

**opik_harbor_deferred_metrics.patch** (opik 1.10.26):
Fixes token usage being None in Opik spans. Root cause: Harbor's claude_code
agent assigns `step.metrics` after `Step.__init__`, but Opik reads metrics
during `__init__`. Patch defers span creation to `__setattr__` hook.
Remove when opik changelog mentions harbor token/metrics fix.

## Runtime monkeypatches (no action needed after reinstall)

**claude-code-sdk unknown message types** (claude-code-sdk 0.0.25):
In `eval-platforms/evaluate_architecture.py`. SDK crashes on `rate_limit_event` messages.
Monkeypatch replaces `parse_message` to ignore unknown types.
Remove when: `grep "Unknown message type" .venv/.../message_parser.py`
shows `logger.debug` instead of `raise MessageParseError`.