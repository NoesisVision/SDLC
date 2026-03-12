---
name: benchmark-creator
description: |
  Create and run custom coding agent benchmarks using Harbor. Use this skill whenever the user wants to:
  - Create a new benchmark (set of tasks for evaluating coding agents)
  - Add tasks to an existing benchmark
  - Create or modify agent variants (configurations that control how the agent behaves during evaluation)
  - Run benchmarks in different configurations (all variants, single task, specific variant+task combo)
  - Set up assessment criteria for evaluating agent output quality
  - Understand the benchmark system structure or troubleshoot benchmark runs
  - Verify benchmark results in Opik (traces, feedback scores, experiments)
  Even if the user doesn't say "benchmark" explicitly — if they're talking about evaluating coding agents, testing agent configurations, or creating coding challenges for agents, this skill applies.
  After every benchmark run that uses --with-opik, ALWAYS verify results in Opik via REST API — don't wait for the user to ask.
---

# Benchmark Creator

This skill helps create and run coding agent benchmarks using the Harbor evaluation framework. The system evaluates how well AI coding agents solve programming challenges inside isolated environments (e.g. Docker containers).

## System overview

```
evals/
├── eval-platforms/                    # Shared framework (benchmark-agnostic)
│   ├── evaluate_assessment.py         # Post-hoc quality evaluator (Claude Code SDK)
│   ├── atif_parser.py                 # Trajectory parser
│   └── patches/                       # Vendor patches
├── claude_custom_agents.py            # Harbor agent wrapper (file injection)
├── export_oauth_token.sh              # macOS Keychain auth
└── <benchmark-name>/                  # One directory per benchmark
    ├── run-benchmark.sh               # Runner script
    ├── local-registry.json            # Task registry (Harbor dataset)
    ├── dataset.json                   # Dataset metadata
    ├── assessment_dimensions.json     # Evaluation dimension definitions
    ├── tasks/                         # Task definitions
    │   └── <task-name>/
    │       ├── task.json              # Task metadata
    │       ├── instruction.md         # What the agent must do
    │       ├── assessment_criteria.md # Evaluation rubric (per task)
    │       ├── environment/Dockerfile # Docker environment
    │       ├── tests/test.sh          # Verifier script (pass/fail)
    │       └── solution/solve.sh      # Reference solution (optional)
    ├── variants/                      # Agent configurations
    │   └── <variant-name>/
    │       ├── harbor_config.json     # Agent import + sandbox_files
    │       ├── CLAUDE.md              # Agent instructions
    │       └── claude_config.json     # MCP server config (optional)
    └── jobs/                          # Trial results (gitignored)
```

## Creating a new benchmark

### Step 1: Understand what the user wants to evaluate

Before creating files, clarify:
- What programming language/framework? (determines Dockerfile)
- What kind of coding challenges? (feature implementation, refactoring, bug fixing, etc.)
- What source repository should the agent work on? (git URL cloned in Dockerfile)
- What quality dimensions should be assessed? (this is benchmark-specific — NOT hardcoded)

### Step 2: Create the benchmark directory structure

```bash
evals/<benchmark-name>/
├── run-benchmark.sh
├── local-registry.json
├── dataset.json
├── assessment_dimensions.json
├── tasks/
├── variants/
│   └── baseline/
│       ├── harbor_config.json
│       └── CLAUDE.md
└── jobs/               # Will be created by Harbor
```

### Step 3: Define assessment dimensions

Each benchmark has its OWN assessment dimensions — these are the quality criteria used to evaluate agent output beyond pass/fail. Create `assessment_dimensions.json`:

```json
{
  "dimensions": [
    {
      "name": "snake_case_dimension_name",
      "title": "Human-Readable Title",
      "max_score": 25,
      "description": "What this dimension measures"
    }
  ]
}
```

Dimensions should reflect what matters for THIS benchmark's domain. Examples:
- For a refactoring benchmark: `code_clarity`, `test_preservation`, `api_compatibility`, `performance_impact`
- For an API integration benchmark: `error_handling`, `api_usage_correctness`, `test_coverage`, `documentation`
- For a security challenge: `vulnerability_detection`, `fix_correctness`, `regression_safety`, `explanation_quality`

Total dimensions typically 3-5, with scores summing to 100.

### Step 4: Create task files

Each task needs these files (all are required by Harbor unless noted):

#### task.json (required)

```json
{
  "name": "<task-name>",
  "description": "Brief description of what the agent must do",
  "difficulty": "intermediate",
  "estimated_time_minutes": 30,
  "tags": ["relevant", "skill", "tags"],
  "environment": {
    "type": "docker",
    "dockerfile": "./environment/Dockerfile"
  },
  "instruction": "./instruction.md",
  "evaluation": {
    "type": "script",
    "script": "./tests/test.sh",
    "timeout_seconds": 300
  },
  "metadata": {
    "language": "C#",
    "framework": ".NET 8",
    "domain": "E-Commerce"
  }
}
```

#### instruction.md (required)

Agent-facing task description. Structure:

```markdown
# Task: <Name>

## Context
Working environment description, codebase location (/app), technology stack.

## Requirement
What the agent must implement/fix/change. Include concrete examples with inputs and expected outputs.

## Scope
Boundaries of the work — what's in scope, what's not.

## Quality Expectations
Architecture/code quality expectations.

## Success Criteria
Numbered list matching what test.sh verifies.

## Constraints
What the agent must NOT do (e.g., don't modify existing tests, don't change public API).
```

#### environment/Dockerfile (required)

Sets up the Docker container where the agent works. Pattern:

```dockerfile
FROM <base-image>

# Install tools the agent might need
RUN apt-get update && apt-get install -y git curl wget ca-certificates && rm -rf /var/lib/apt/lists/*

# Clone source repository
WORKDIR /app
RUN git clone <repository-url> .

# Pre-install dependencies (so the agent doesn't waste time)
RUN <dependency-install-command>

# Verify the environment works
RUN <build-or-compile-command>

CMD ["/bin/bash"]
```

The Dockerfile MUST be self-contained — the agent should be able to start working immediately without installing dependencies.

#### tests/test.sh (required — Harbor verifier)

Bash script that verifies the agent's work. Harbor runs this script and reads the reward from `/logs/verifier/reward.txt`.

```bash
#!/bin/bash

cd /app

# Step 1: Check compilation/build
echo "Step 1: Verifying build..."
if <build-command>; then
    echo "✓ Build succeeded"
else
    echo "✗ Build failed"
    echo 0 > /logs/verifier/reward.txt
    exit 1
fi

# Step 2: Run tests
echo "Step 2: Running tests..."
if <test-command>; then
    echo "✓ Tests pass"
else
    echo "✗ Tests failed"
    echo 0 > /logs/verifier/reward.txt
    exit 1
fi

# Step 3+: Task-specific checks
# Check for expected files, patterns, API usage, etc.

echo "EVALUATION PASSED ✓"
echo 1 > /logs/verifier/reward.txt
exit 0
```

Key rules for test.sh:
- Every failure path MUST write `echo 0 > /logs/verifier/reward.txt` and `exit 1`
- The final success path MUST write `echo 1 > /logs/verifier/reward.txt` and `exit 0`
- Steps should be ordered from most fundamental (build) to most specific (implementation details)
- Use `grep`, `find`, and file content checks for structural verification

#### assessment_criteria.md (required for post-hoc evaluation)

Per-task evaluation rubric scored by the assessment evaluator. Structure:

```markdown
# Assessment Criteria: <Task Name>

Evaluate the AI-generated code across N dimensions. Each dimension is scored 0–<max_score> points.

## 1. <Dimension Name> (0–<max_score>)

| Score | Criteria |
|-------|----------|
| 0     | <worst case> |
| <mid> | <middle case> |
| <max> | <best case> |

**Key checks:**
- Specific things to look for in the code
```

Scores should be granular enough (at least 5 levels) to differentiate output quality.

#### solution/solve.sh (optional — reference solution)

A bash script that applies a known-good solution. Useful for verifying that test.sh works correctly. Not executed by Harbor.

### Step 5: Create the registry files

#### local-registry.json

```json
[
  {
    "name": "<benchmark-name>",
    "description": "What this benchmark evaluates",
    "version": "1.0.0",
    "difficulty": "advanced",
    "tasks": [
      {
        "name": "<task-name>",
        "path": "./evals/<benchmark-name>/tasks/<task-name>"
      }
    ],
    "metadata": {
      "domain": "...",
      "technologies": ["..."],
      "skills_tested": ["..."]
    }
  }
]
```

#### dataset.json

```json
{
  "name": "<benchmark-name>",
  "description": "What this benchmark evaluates",
  "version": "1.0.0",
  "tasks": [
    {
      "name": "<task-name>",
      "path": "./tasks/<task-name>/task.json"
    }
  ],
  "metadata": {
    "domain": "...",
    "technologies": ["..."],
    "skills_tested": ["..."]
  }
}
```

### Step 6: Create the baseline variant

Every benchmark needs at least a `baseline` variant. See the "Agent variants" section below.

### Step 7: Create run-benchmark.sh

Use the existing `evals/ddd-architectural-challenges/run-benchmark.sh` as a template. Read that file and adapt it for the new benchmark. Key things to change:
- Dataset name in the merged config
- Artifacts source path (what directory to copy from the container after the trial)
- Default model and timeout values
- Flag name from `--with-arch-eval` to `--with-assessment`

The runner script handles:
- Argument parsing (variant, `--with-opik`, `--with-assessment`, `--tasks`, `--model`, `--timeout`)
- Prerequisite checks (Harbor installed, auth available)
- Config merging (variant config + registry + metadata)
- Running `uv run harbor run` (or `uv run opik harbor run` with `--with-opik`)
- Post-hoc assessment evaluation (if `--with-assessment`)

## Agent variants

Variants are the most important configuration mechanism. **Each benchmark defines its own set of variants** — there are no globally shared or predefined variant names. A variant represents a specific agent configuration to be compared against other variants on the same set of tasks.

### Variant structure

Each variant is a directory under `<benchmark>/variants/<variant-name>/`:

```
variants/<variant-name>/
├── harbor_config.json     # Required: agent import path + sandbox_files
├── CLAUDE.md              # Required: instructions injected into /app/CLAUDE.md
└── claude_config.json     # Optional: MCP server configuration
```

### harbor_config.json

```json
{
  "agents": [
    {
      "import_path": "evals.claude_custom_agents:ConfigurableClaude",
      "name": "<variant-name>",
      "kwargs": {
        "sandbox_files": {
          "/app/CLAUDE.md": "evals/<benchmark>/variants/<variant>/CLAUDE.md"
        }
      }
    }
  ]
}
```

Critical rules:
- `"name"` field is REQUIRED — without it, Opik tagging breaks (adds `None` to tags)
- `import_path` always points to `evals.claude_custom_agents:ConfigurableClaude`
- `sandbox_files` maps container paths to host paths (relative to repo root)
- For MCP variants, add the claude_config.json mapping:
  ```json
  "/logs/agent/sessions/.claude.json": "evals/<benchmark>/variants/<variant>/claude_config.json"
  ```

### CLAUDE.md for variants

This file is injected as `/app/CLAUDE.md` inside the isolated environment. It controls agent behavior. Variant names and instructions are benchmark-specific — design them based on what dimensions you want to compare. Common patterns include:

- A **minimal** variant with bare instructions (baseline measurement)
- A **guided** variant with detailed domain-specific guidance
- A **tool-augmented** variant with MCP server access for codebase exploration
- Any other combination of instructions, constraints, or techniques relevant to the benchmark

### claude_config.json (for MCP variants)

```json
{
  "mcpServers": {
    "<server-name>": {
      "type": "stdio",
      "command": "<command>",
      "args": ["..."],
      "env": {
        "KEY": "${ENV_VAR}"
      }
    }
  }
}
```

### Variant design ideas

Variants can test many dimensions:
- **Instruction specificity**: baseline vs guided vs detailed-step-by-step
- **Tool access**: no MCP vs code search MCP vs documentation MCP
- **Model selection**: controlled via `--model` flag, not variant (but could be combined)
- **Constraints**: time limits, tool restrictions, code style requirements
- **Prompting techniques**: chain-of-thought guidance, examples, domain glossary

## Running benchmarks

All commands are run from the repo root.

### Run all tasks with all variants

Run the benchmark script once per variant:

```bash
# Run with each variant
./evals/<benchmark>/run-benchmark.sh baseline
./evals/<benchmark>/run-benchmark.sh with-mcp
./evals/<benchmark>/run-benchmark.sh guided
```

### Run a single task across all variants

```bash
./evals/<benchmark>/run-benchmark.sh --tasks <task-name> baseline
./evals/<benchmark>/run-benchmark.sh --tasks <task-name> with-mcp
./evals/<benchmark>/run-benchmark.sh --tasks <task-name> guided
```

### Run a specific variant+task combination

```bash
./evals/<benchmark>/run-benchmark.sh --tasks <task-name> <variant-name>
```

### With Opik tracing and assessment evaluation

```bash
./evals/<benchmark>/run-benchmark.sh --with-opik --with-assessment <variant-name>
```

### Custom model and timeout

```bash
./evals/<benchmark>/run-benchmark.sh --model claude-opus-4-6 --timeout 1200 <variant-name>
```

### Viewing results

After a run, results are in `evals/<benchmark>/jobs/<timestamp>/`:

```bash
# View job summary
cat evals/<benchmark>/jobs/<latest-timestamp>/result.json | python3 -m json.tool

# View per-trial results
cat evals/<benchmark>/jobs/<latest-timestamp>/<trial-id>/result.json | python3 -m json.tool

# View verifier output
cat evals/<benchmark>/jobs/<latest-timestamp>/<trial-id>/verifier/test-stdout.txt

# View assessment scores (if --with-assessment was used)
cat evals/<benchmark>/jobs/<latest-timestamp>/<trial-id>/assessment_eval.json | python3 -m json.tool
```

### Verifying results in Opik

After every benchmark run that uses `--with-opik`, verify the uploaded data in Opik via REST API. This is not optional — Opik has known issues with long-running trials (Harbor's opik streamer may close before registering all feedback scores), so always confirm the data arrived.

#### How to verify

Use Python `urllib.request` (never curl — it drops the `Comet-Workspace` header). Load credentials from `evals/eval-platforms/.env`:

```python
uv run python3 -c "
import urllib.request, json, os
from dotenv import load_dotenv
load_dotenv('evals/eval-platforms/.env')

api_key = os.environ['OPIK_API_KEY']
workspace = os.environ.get('OPIK_WORKSPACE', '')
trace_id = '<trace-id-from-benchmark-output>'

url = f'https://www.comet.com/opik/api/v1/private/traces/{trace_id}'
req = urllib.request.Request(url, headers={
    'authorization': api_key,
    'Comet-Workspace': workspace,
})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())

print('Trace name:', data.get('name'))
print('Feedback scores:')
for s in sorted(data.get('feedback_scores', []), key=lambda x: x['name']):
    print(f'  {s[\"name\"]}: {s[\"value\"]}')
print('Duration:', data.get('duration'))
print('End time:', data.get('end_time'))
"
```

#### What to check

For each trace, verify:

1. **Feedback scores present** — should include:
   - `reward` (from Harbor verifier)
   - `duration_sec` (trial execution time)
   - `arch_<dimension>` for each assessment dimension
   - `arch_total` (normalized 0-1 total score)
2. **Duration and end_time** — if `None`, the Harbor opik streamer closed prematurely (known issue for trials >5 min). The evaluate_architecture.py workaround uploads reward and duration as feedback scores, so check those are present even if trace-level fields are missing.
3. **Consistent columns** — all traces in the same benchmark should have identical feedback score names (unified dimensions ensure this).

#### Finding trace IDs

The trace ID is printed in the benchmark output:
```
OPIK: Started logging traces to the "ddd-architectural-challenges" project at https://...?trace_id=<TRACE_ID>&...
```

Alternatively, use the Opik Python SDK to search:
```python
import opik
client = opik.Opik()
traces = client.search_traces(
    project_name='<benchmark-name>',
    filter_string='name = "<agent-name>/<trial-name>"',
    max_results=1,
    wait_for_at_least=1,
    wait_for_timeout=10,
)
```

#### Opik REST API auth

- Header: `authorization: <OPIK_API_KEY>` (not `Comet-Api-Key`)
- Workspace header: `Comet-Workspace: <OPIK_WORKSPACE>`
- Both values live in `evals/eval-platforms/.env`

## Token cost heuristic

When authentication uses `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription — no per-token cost), benchmark runs can be launched freely without worrying about token costs. Use this heuristic:

- **Free to run**: total estimated task time under 30 minutes (sum of all tasks × number of variants in one run). Run these without asking.
- **Ask first**: total estimated time over 30 minutes, OR when using `ANTHROPIC_API_KEY` (API billing). Confirm with the user before launching.

Task estimated times are in `task.json` → `estimated_time_minutes`. When `--tasks` filters are used, only count the selected tasks.

This means for benchmarks like the DDD challenges (threshold: 5 min + weather: 12 min = ~17 min), a single-variant run is always safe to launch. Running both tasks across 3 variants (~51 min total) should be confirmed first.

## Verifying a new benchmark works

Before running with a real agent, verify the setup:

1. **Build the Docker image** to check it works:
   ```bash
   docker build -t <benchmark>-test -f evals/<benchmark>/tasks/<task>/environment/Dockerfile .
   ```

2. **Run test.sh in the container** with the reference solution:
   ```bash
   docker run --rm -it <benchmark>-test bash
   # Inside container:
   /path/to/solution/solve.sh   # Apply reference solution
   /path/to/tests/test.sh       # Verify it passes
   ```

3. **Dry run with Harbor** on a single task:
   ```bash
   ./evals/<benchmark>/run-benchmark.sh --tasks <task-name> --timeout 300 baseline
   ```

## Updating the assessment evaluator

When creating a new benchmark, the shared evaluator (`eval-platforms/evaluate_assessment.py`) needs to know how to find and use the benchmark's assessment dimensions. The evaluator discovers task paths from `result.json` and looks for `assessment_criteria.md` and `assessment_dimensions.json` relative to the task directory.

If the new benchmark uses the same file naming convention (`assessment_criteria.md`, `assessment_dimensions.json`), no changes to the evaluator are needed.

If the existing evaluator file is still named `evaluate_architecture.py` with `architecture_criteria.md`/`architecture_dimensions.json`, either:
- Rename to the generic names (preferred — one-time migration)
- Or adapt the new benchmark to use the existing names (pragmatic short-term)

Check the current file names before creating a new benchmark and align accordingly.
