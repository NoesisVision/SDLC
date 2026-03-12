# Eval System Architecture

## Overview

The system evaluates AI agent (Claude Code) quality on programming tasks. It uses **Harbor** as the engine running agents in isolated environments (sandboxed containers) and **Opik** as the observability platform for tracking results.

Key design: evaluation is **two-stage** — Harbor assesses functional correctness (tests pass/fail), then a separate evaluator (Claude Code SDK) assesses architectural quality of the generated code.

---

## End-to-end flow

```mermaid
flowchart TB
    subgraph LAUNCH ["1. Launch"]
        CLI["./run-benchmark.sh<br/>--with-opik --with-assessment with-mcp"]
        CLI --> MERGE["Merge configuration<br/>(variant config + dataset registry)"]
        MERGE --> HARBOR_CMD{{"uv run opik harbor run<br/>--config merged.json"}}
    end

    subgraph HARBOR ["2. Harbor — trial execution (isolated environment, e.g. Docker)"]
        HARBOR_CMD --> SANDBOX["Isolated environment<br/>(e.g. Docker)"]
        SANDBOX --> SETUP["ConfigurableClaude.setup()<br/>→ upload CLAUDE.md, .claude.json"]
        SETUP --> AGENT["Claude Code agent<br/>works on the task"]
        AGENT --> TEST["test.sh — functional verification"]
        TEST --> REWARD["reward: 0.0 or 1.0"]
        REWARD --> ARTIFACTS["Artifacts copied to host<br/>→ jobs/ts/trial/artifacts/"]
    end

    subgraph OPIK_TRACE ["  Opik (tracing)"]
        HARBOR_CMD -.->|"opik harbor run<br/>automatic tracing"| TRACE["Trace: agent_name/trial_name<br/>+ spans, tokens, duration"]
    end

    subgraph ASSESSMENT ["3. Assessment evaluation (host machine, outside Harbor)"]
        ARTIFACTS -->|"Harbor done,<br/>environments torn down"| EVAL["evaluate_assessment.py"]
        EVAL --> SDK["Claude Code SDK<br/>(local subprocess, sonnet)<br/>tools: Read/Glob/Grep<br/>cwd = artifacts/workspace/"]
        SDK --> SCORE["Score across 4 dimensions<br/>0-25 pts each"]
        SCORE --> JSON_OUT["assessment_eval.json"]
        SCORE --> OPIK_FB["Opik feedback scores<br/>arch_*, reward, duration"]
    end

    TRACE -.-> OPIK_FB

    style LAUNCH fill:#e8f4fd,stroke:#2196F3
    style HARBOR fill:#fff3e0,stroke:#FF9800
    style OPIK_TRACE fill:#f3e5f5,stroke:#9C27B0
    style ASSESSMENT fill:#e8f5e9,stroke:#4CAF50
```

---

## What happens inside Harbor

Harbor is a framework for evaluating AI agents. Out of the box you provide an agent, a dataset, and run `harbor run`. This project adds minimal but important customizations on top.

### Trial lifecycle

```mermaid
sequenceDiagram
    participant H as Harbor
    participant D as Isolated Environment
    participant A as ConfigurableClaude
    participant CC as Claude Code
    participant T as test.sh

    H->>D: Create isolated environment
    H->>A: setup(environment)
    A->>A: super().setup() — standard init
    A->>D: upload CLAUDE.md → /app/CLAUDE.md
    A->>D: upload .claude.json → /logs/agent/sessions/
    H->>A: solve(task) with instruction.md
    A->>CC: Launch Claude Code in sandbox
    CC->>CC: Reads CLAUDE.md, configures MCP
    CC->>CC: Analyzes codebase, implements solution
    CC-->>A: Done (artifacts in /app/Sources)
    H->>T: Run test.sh in sandbox
    T->>T: dotnet test
    T-->>H: exit code → reward 0.0 or 1.0
    H->>H: Save trajectory.json, result.json, artifacts
```

### Inside the isolated environment

```mermaid
flowchart LR
    subgraph Sandbox["Isolated Environment (e.g. Docker)"]
        direction TB
        APP["/app/ — source code<br/>(DDD-starter-dotnet)"]
        CLAUDE_MD["/app/CLAUDE.md<br/>(injected)"]
        CLAUDE_JSON["/logs/agent/sessions/.claude.json<br/>(MCP config, injected)"]
        AGENT["Claude Code<br/>works on the task"]
        TESTS["test.sh → dotnet test"]

        CLAUDE_MD --> AGENT
        CLAUDE_JSON -.->|"MCP: Sourcebot"| AGENT
        APP --> AGENT
        AGENT -->|"modifies code"| APP
        APP --> TESTS
    end

    TESTS -->|"exit code"| REWARD{"reward:<br/>0.0 / 1.0"}
```

Harbor only measures **functional correctness** — tests pass or fail, yielding a binary reward. Whether the agent wrote the code *well* is not something Harbor measures. That's where assessment evaluation comes in.

---

## Assessment evaluation — LLM-as-a-Judge

This is the key extension beyond default Harbor and it runs **entirely on the host machine**, outside of Harbor. After Harbor finishes all trials and environments are torn down, `run-benchmark.sh` invokes `evaluate_assessment.py` as a separate step. The evaluator uses Claude Code SDK (a local subprocess, not a container) to analyze artifacts that Harbor already copied from the environment to `jobs/<ts>/<trial>/artifacts/workspace/` on the host filesystem.

```mermaid
flowchart TB
    subgraph Inputs["Inputs (per task)"]
        ARTIFACTS["artifacts/workspace/<br/>(agent-generated output)"]
        CRITERIA["assessment_criteria.md<br/>(scoring rubric)"]
        DIMS["assessment_dimensions.json<br/>(dimension definitions)"]
        INSTRUCTION["instruction.md<br/>(original task prompt)"]
        EXTRA["additional reference files<br/>(optional, e.g. ground truth)"]
    end

    subgraph Evaluator["Claude Code SDK as evaluator"]
        PROMPT["Composite prompt:<br/>instruction + rubric +<br/>dimension constraints +<br/>reference data"]
        SDK_RUN["query() with tools:<br/>Read, Glob, Grep<br/>cwd = workspace<br/>model = sonnet<br/>max_turns = 30"]
        PARSE["Parse JSON from<br/>last json code block"]
    end

    subgraph Output["Output"]
        SCORE["N dimensions × 0-25 pts each"]
        FILE["assessment_eval.json"]
        OPIK["Opik feedback scores"]
    end

    ARTIFACTS --> SDK_RUN
    CRITERIA --> PROMPT
    DIMS --> PROMPT
    INSTRUCTION --> PROMPT
    EXTRA -.-> PROMPT
    PROMPT --> SDK_RUN
    SDK_RUN --> PARSE
    PARSE --> SCORE
    SCORE --> FILE
    SCORE --> OPIK
```

The evaluator gets `Read`, `Glob`, `Grep` tools and freely explores the workspace containing the agent's artifacts. It scores according to a rubric defined per task.

Each benchmark defines its own dimensions in `assessment_dimensions.json` and per-task rubrics in `assessment_criteria.md`. Tasks can also include optional reference files (e.g. ground truth) that the evaluator uses to judge completeness and accuracy.

---

## Opik integration

```mermaid
flowchart LR
    subgraph Harbor_Run["During harbor run"]
        OPIK_WRAP["opik harbor run<br/>(wrapper)"]
        TRACE["Automatic trace<br/>name: agent/trial<br/>+ spans per step<br/>+ token usage"]
    end

    subgraph Assessment_Upload["After assessment eval"]
        EVAL["evaluate_assessment.py"]
        SEARCH["search_traces()<br/>by name agent/trial"]
        FB["log_traces_feedback_scores()"]
    end

    OPIK_WRAP --> TRACE
    TRACE -.->|"trace_id"| SEARCH
    EVAL --> SEARCH
    SEARCH --> FB

    FB --> SCORES["Feedback scores:<br/>arch_domain_modeling<br/>arch_architecture_compliance<br/>arch_extensibility<br/>arch_test_quality<br/>arch_total<br/>reward<br/>duration_sec"]
```

Two integration points:
1. **`opik harbor run`** — Opik's wrapper around Harbor. Automatically creates traces with agent steps, token usage, and duration
2. **`evaluate_assessment.py --with-opik`** — finds the existing trace by name `agent_name/trial_name`, attaches feedback scores

---

## `ConfigurableClaude` — the only custom class

```mermaid
classDiagram
    class ClaudeCode {
        <<Harbor built-in>>
        +setup(environment)
        +solve(task)
    }
    class ConfigurableClaude {
        -_sandbox_files: dict~str, str~
        +setup(environment)
        -_upload_sandbox_files(environment)
        +name() str
    }
    ClaudeCode <|-- ConfigurableClaude

    note for ConfigurableClaude "Only reason to exist: Harbor has no\nmechanism for injecting files into\nthe sandbox (e.g. CLAUDE.md, MCP config)"
```

Harbor natively handles auth, MCP servers, model selection, and timeout. `ConfigurableClaude` adds **one thing**: declarative file mapping from host to the isolated environment via `sandbox_files` in the JSON config.

---

## Agent variants

Each benchmark defines its **own set of variants** — there are no globally shared variants. A variant represents a specific agent configuration to be compared against other variants on the same set of tasks. This is a core architectural concept: the same tasks are solved by agents with different instructions, tools, or constraints, and the results are compared.

Each variant is a directory under `<benchmark>/variants/<variant-name>/` containing:
- `harbor_config.json` — agent import path + `sandbox_files` mapping (required)
- `CLAUDE.md` — instructions injected into the environment (required)
- `claude_config.json` — MCP server configuration (optional)

Variants can differ along many axes:
- **Instruction specificity**: minimal vs detailed architectural guidance
- **Tool access**: no MCP vs code search MCP vs documentation MCP
- **Constraints**: specific restrictions or requirements
- **Prompting techniques**: chain-of-thought, examples, domain glossary

The `run-benchmark.sh` script takes a variant name as a positional argument and runs all (or filtered) tasks with that variant's configuration.

---

## Orchestration — `run-benchmark.sh`

```mermaid
sequenceDiagram
    participant User
    participant Script as run-benchmark.sh
    participant Python as Inline Python
    participant Harbor as opik harbor run
    participant Eval as evaluate_assessment.py

    User->>Script: --with-opik --with-assessment with-mcp
    Script->>Script: Load .env (Opik credentials)
    Script->>Script: Check auth (API key / Keychain)
    Script->>Python: Merge variant config + registry + CLI params
    Python-->>Script: /tmp/harbor-run-XXXXXX.json

    Script->>Harbor: uv run opik harbor run --config merged.json
    Harbor-->>Script: Results in jobs/timestamp/

    Script->>Script: unset CLAUDECODE
    Script->>Eval: --job-dir latest --with-opik
    Eval->>Eval: For each trial in job-dir
    Eval-->>Script: assessment_eval.json + Opik feedback
```

The script builds a **merged config** by combining three sources:
- `variants/<name>/harbor_config.json` — agent definition (import path, sandbox_files)
- `local-registry.json` — task list from the dataset
- CLI parameters — model, timeout, task filter

---

## Changes from default Harbor + Opik

### Harbor customizations

| Aspect | Default Harbor | This project |
|--------|---------------|-------------|
| Agent | `ClaudeCode` (built-in) | `ConfigurableClaude` — adds `sandbox_files` for file injection |
| Evaluation | Only `test.sh` → reward 0/1 | + assessment eval (LLM-as-a-Judge, N dimensions × 25 pts) |
| Configuration | Static JSON | Dynamic merge (variant + registry + CLI params) in run-benchmark.sh |
| Auth | Manual env variable setup | Auto-extraction of `CLAUDE_CODE_OAUTH_TOKEN` from macOS Keychain via `export_oauth_token.sh` |

### Opik customizations

| Aspect | Default Opik + Harbor | This project |
|--------|----------------------|-------------|
| Token usage | Bug: always `None` (opik 1.10.26) | Patch: deferred span creation via `__setattr__` hook |
| Feedback scores | None | `arch_*`, `reward`, `duration_sec` attached post-hoc |
| Verification | Opik UI | REST API (programmatic) |

### Claude Code SDK workarounds

| Aspect | Default SDK 0.0.25 | This project |
|--------|-------------------|-------------|
| Unknown message types | Crash (`MessageParseError`) | Monkeypatch: returns `None` instead of raising |
| Nested session detection | Detects `CLAUDECODE` env → refuses | `unset CLAUDECODE` + `env={"CLAUDECODE": ""}` |

---

## Trial result structure

```
jobs/2026-03-12__14-30-00/
└── ddd-threshold-discount__with-mcp__0/
    ├── result.json              # reward, duration, task_id, source
    ├── config.json              # Agent config used for this trial
    ├── assessment_eval.json     # LLM-as-a-Judge evaluation result
    ├── agent/
    │   └── trajectory.json      # ATIF: agent steps, tool calls, tokens
    └── artifacts/
        └── workspace/           # Modified files from /app/Sources
```

---

## Directory structure

```
evals/
├── claude_custom_agents.py          # ConfigurableClaude — agent with file injection
├── export_oauth_token.sh            # OAuth token extraction from macOS Keychain
│
├── eval-platforms/                  # Shared framework (benchmark-agnostic)
│   ├── evaluate_assessment.py       # Assessment evaluator (Claude Code SDK + Opik)
│   ├── atif_parser.py               # ATIF trajectory parser
│   ├── .env                         # Opik credentials
│   └── patches/                     # Vendor library patches
│       ├── apply_opik_patches.sh
│       └── opik_harbor_deferred_metrics.patch
│
├── ddd-architectural-challenges/    # Benchmark: DDD architecture
│   ├── run-benchmark.sh
│   ├── local-registry.json          # Harbor task registry
│   ├── assessment_dimensions.json   # Evaluation dimension definitions
│   ├── tasks/
│   │   ├── ddd-threshold-discount/  # Task: extend a discount discriminated union
│   │   └── ddd-weather-discount/    # Task: weather API integration in domain layer
│   └── variants/
│       ├── baseline/
│       ├── guided/
│       └── with-mcp/
│
└── decision-extraction/             # Benchmark: architectural decision extraction
    ├── run-benchmark.sh
    ├── tasks/extract-decisions-from-review/
    └── variants/{vanilla, with-skill}/
```
