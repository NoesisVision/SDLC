# Approach

Use the **nasde-toolkit** CLI for all benchmark operations. Do NOT write custom
evaluation code — nasde handles Harbor orchestration, assessment evaluation,
and Opik integration.

# Directory structure

```
evals/
└── decision-extraction/        # Benchmark: architectural decision extraction
    ├── nasde.toml              # Project config (nasde-toolkit format)
    ├── assessment_dimensions.json
    ├── .env                    # Opik credentials (gitignored)
    ├── tasks/
    │   └── extract-decisions-from-review/
    │       ├── task.json       # Task metadata
    │       ├── task.toml       # Agent/verifier timeouts
    │       ├── instruction.md
    │       ├── assessment_criteria.md
    │       ├── ground_truth_decisions.json
    │       ├── transcript.md
    │       ├── environment/Dockerfile
    │       └── tests/test.sh
    └── variants/
        ├── vanilla/            # Baseline (no skill)
        └── with-skill/         # Uses extract_decisions skill
```

# Running benchmarks

```bash
# All tasks, default variant (vanilla)
nasde run -C evals/decision-extraction

# Specific variant with Opik tracking
nasde run --variant with-skill --with-opik -C evals/decision-extraction

# Skip assessment evaluation
nasde run --variant vanilla --without-eval -C evals/decision-extraction

# Re-evaluate existing results
nasde eval evals/decision-extraction/jobs/<timestamp> -C evals/decision-extraction --with-opik
```

# Prerequisites

nasde-toolkit must be installed:

```bash
uv tool install git+ssh://git@github.com/NoesisVision/nasde-toolkit.git
```

To verify: `nasde --version`
