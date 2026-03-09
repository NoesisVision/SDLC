#Approach

Always check documentation before implementing anything!! Make attempts to find solutions which are confirmed and recommended in documentation instead of following tempting ideas to extend capabilities by custom code!
Hacky integration ideas using custom scripts are STRONGLY DISCOURAGED. 

Do not write custom code until necessary

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