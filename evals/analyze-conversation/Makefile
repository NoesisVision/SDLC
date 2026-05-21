# analyze-conversation benchmark — convenience targets.
#
# Wraps `nasde run` for the common cases. The main reason this exists: the
# default `nasde run --all-variants` runs variants SEQUENTIALLY in one process.
# For Claude variants that means ~8–10 min × N variants in a row. `make run`
# launches one `nasde run` per variant in parallel (`&` + `wait`), so a 2-variant
# run finishes in ~max(times) instead of sum(times).
#
# Prerequisites:
# - `nasde` on PATH (`uv tool install nasde-toolkit==0.4.0` or newer)
# - Claude auth: `source ~/.claude/skills/nasde-benchmark-runner/scripts/export_oauth_token.sh`
#   (or `export ANTHROPIC_API_KEY=...`) BEFORE running these targets.
# - Docker Desktop running with enough memory. Each Claude variant container
#   uses ~2–4 GB; running both in parallel needs ~16 GB to avoid OOM (exit 137).
#
# Usage:
#   make run             # both variants, parallel, with assessment eval
#   make run-vanilla     # vanilla variant only
#   make run-with-skill  # with-skill variant only
#   make run OPIK=1      # also upload to Opik (any target)
#   make run NOEVAL=1    # skip LLM-judge eval
#   make run EXTRA="--job-suffix smoke"  # any extra nasde flags

PROJECT_DIR := .
TASK ?= analyze-synthetic-conversation

# Flag composition — toggleable via env vars.
OPIK_FLAG := $(if $(OPIK),--with-opik,)
NOEVAL_FLAG := $(if $(NOEVAL),--without-eval,)
NASDE_FLAGS := --tasks $(TASK) -C $(PROJECT_DIR) $(OPIK_FLAG) $(NOEVAL_FLAG) $(EXTRA)

.PHONY: run run-vanilla run-with-skill help

help:
	@echo "Targets:"
	@echo "  run             — both variants in parallel (recommended for full eval)"
	@echo "  run-vanilla     — vanilla variant only"
	@echo "  run-with-skill  — with-skill variant only"
	@echo ""
	@echo "Flags (env vars):"
	@echo "  OPIK=1          — upload scores to Opik"
	@echo "  NOEVAL=1        — skip LLM-judge eval (verifier-only)"
	@echo "  EXTRA=\"…\"       — pass-through to nasde run"

run-vanilla:
	nasde run --variant vanilla $(NASDE_FLAGS)

run-with-skill:
	nasde run --variant with-skill $(NASDE_FLAGS)

# Parallel: each variant gets its own `nasde run` process (`&`) with a distinct
# job suffix so the jobs/ directory does not collide. `wait` blocks until both
# finish; `set -e` + a check on $$? lets a failure in either propagate.
run:
	@echo "Launching vanilla + with-skill in parallel (Ctrl-C cancels both)…"
	@set -e; \
	nasde run --variant vanilla    --job-suffix make-vanilla    $(NASDE_FLAGS) & v=$$!; \
	nasde run --variant with-skill --job-suffix make-with-skill $(NASDE_FLAGS) & s=$$!; \
	wait $$v; rc_v=$$?; \
	wait $$s; rc_s=$$?; \
	echo ""; echo "vanilla exit:    $$rc_v"; echo "with-skill exit: $$rc_s"; \
	test $$rc_v -eq 0 -a $$rc_s -eq 0
