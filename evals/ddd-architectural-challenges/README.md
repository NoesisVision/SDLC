# DDD Architectural Challenges Benchmark

Harbor benchmark evaluating AI agents' ability to extend complex DDD codebases.

## Tasks

| Task | Difficulty | Focus |
|------|-----------|-------|
| `ddd-threshold-discount` | Intermediate (30 min) | Value Objects, Discriminated Union pattern |
| `ddd-weather-discount` | Advanced (90 min) | External API integration, Hexagonal Architecture, Refactoring |

Both tasks use the [DDD-starter-dotnet](https://github.com/itlibrium/DDD-starter-dotnet) codebase (.NET 8, C#, xUnit).

## Structure

```
evals/ddd-architectural-challenges/
├── local-registry.json              # Harbor registry (both tasks)
├── run-benchmark.sh                 # Benchmark runner
├── tasks/
│   ├── ddd-threshold-discount/      # Intermediate challenge
│   │   ├── instruction.md
│   │   ├── architecture_criteria.md
│   │   ├── environment/Dockerfile
│   │   └── tests/test.sh
│   └── ddd-weather-discount/        # Advanced challenge
│       ├── instruction.md
│       ├── architecture_criteria.md
│       ├── environment/Dockerfile
│       └── tests/test.sh
├── variants/
│   ├── baseline/                    # No MCP tools
│   └── with-mcp/                   # With Sourcebot MCP
└── jobs/                            # Trial results (gitignored)
```

## Running

```bash
# All tasks (default)
./evals/ddd-architectural-challenges/run-benchmark.sh with-mcp

# Single task
./evals/ddd-architectural-challenges/run-benchmark.sh --tasks ddd-threshold-discount with-mcp

# Multiple specific tasks
./evals/ddd-architectural-challenges/run-benchmark.sh --tasks ddd-threshold-discount,ddd-weather-discount with-mcp

# With Opik tracking + architecture evaluation
./evals/ddd-architectural-challenges/run-benchmark.sh --with-opik --with-arch-eval --tasks ddd-threshold-discount with-mcp

# Custom model and timeout
./evals/ddd-architectural-challenges/run-benchmark.sh --model claude-opus-4-6 --timeout 1200 --tasks ddd-weather-discount with-mcp
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--tasks <list>` | Comma-separated task names to run | all tasks |
| `--with-opik` | Enable Opik experiment tracking | off |
| `--with-arch-eval` | Run post-hoc architecture evaluation via Claude Code SDK | off |
| `--model <model>` | Model for the agent | `claude-sonnet-4-6` |
| `--timeout <seconds>` | Agent timeout per task | `720` |

### Variants

- **`with-mcp`** — Agent gets Sourcebot MCP server for codebase search
- **`baseline`** — Agent works without MCP tools

## Architecture Evaluation

When `--with-arch-eval` is enabled, each trial is evaluated by Claude Code SDK against task-specific criteria in `architecture_criteria.md`. Scores (0-25 per dimension, 100 total) are:

- Saved to `architecture_eval.json` in the trial directory
- Uploaded as feedback scores to Opik (when `--with-opik` is also enabled)

## Prerequisites

Both `harbor-ai` and `opik` must be in the same venv. Use `uv run` for all commands:

```bash
uv run harbor run --config config.json       # correct
uv run opik harbor run --config config.json   # correct (with Opik)
```
