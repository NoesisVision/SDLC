"""Post-hoc architecture evaluation using Claude Code SDK.

Analyzes AI-generated code from Harbor trials for DDD/Hexagonal Architecture
quality. Scores are written locally and optionally uploaded to Opik as
feedback scores on existing traces.

Usage:
    uv run python evals/eval-platforms/evaluate_architecture.py \
        --trial-dir evals/<benchmark>/jobs/<ts>/<trial>
    uv run python evals/eval-platforms/evaluate_architecture.py \
        --job-dir evals/<benchmark>/jobs/<ts> --with-opik
"""

import argparse
import asyncio
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from claude_code_sdk import ClaudeCodeOptions, query
from claude_code_sdk._internal import client as _sdk_client
from claude_code_sdk._internal import message_parser as _mp
from claude_code_sdk.types import AssistantMessage, TextBlock

# ---------------------------------------------------------------------------
# Monkeypatch: claude-code-sdk 0.0.25 — unknown message type crash
#
# Bug:     SDK's parse_message() raises MessageParseError on message types it
#          doesn't recognize (e.g. "rate_limit_event"). This crashes the entire
#          async query stream — there is no way to catch it per-message because
#          the exception is raised inside the SDK's async generator.
#
# Fix:     Replace parse_message in the client module (where it's imported as a
#          local name) with a wrapper that returns None for unknown types.
#          The async for loop in _run_claude_code_evaluation() skips None.
#
# Why monkeypatch (not .patch file):
#          This is a pure function replacement — simpler than opik's case which
#          requires patching class __init__/__setattr__ with specific timing.
#          Monkeypatch survives `uv sync` without manual re-application.
#
# When to remove:  when claude-code-sdk handles unknown message types gracefully.
#                  Check: `grep "Unknown message type" .venv/.../message_parser.py`
#                  If the line raises logger.debug instead of MessageParseError,
#                  this monkeypatch is no longer needed.
#
# Affected version: 0.0.25 (latest as of 2026-03-10)
# ---------------------------------------------------------------------------
_original_parse_message = _mp.parse_message


def _patched_parse_message(data: dict) -> object:
    try:
        return _original_parse_message(data)
    except _mp.MessageParseError:
        return None


_sdk_client.parse_message = _patched_parse_message

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_PROJECT = "ddd-architectural-challenges"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class DimensionScore:
    name: str
    score: int
    max_score: int = 25
    reasoning: str = ""


@dataclass
class ArchitectureEvaluation:
    task_name: str
    trial_name: str
    agent_name: str
    evaluator_model: str
    timestamp: str
    dimensions: list[DimensionScore] = field(default_factory=list)
    total_score: int = 0
    normalized_score: float = 0.0
    summary: str = ""
    harbor_reward: float = 0.0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    args = _parse_args()
    trial_dirs = _collect_trial_dirs(args)

    if not trial_dirs:
        print("No trial directories found.")
        sys.exit(1)

    for trial_dir in trial_dirs:
        print(f"\n{'='*60}")
        print(f"Evaluating: {trial_dir.name}")
        print(f"{'='*60}")
        evaluation = asyncio.run(evaluate_trial(trial_dir))
        if evaluation:
            _write_evaluation_result(trial_dir, evaluation)
            if args.with_opik:
                _upload_to_opik(evaluation)


async def evaluate_trial(trial_dir: Path) -> ArchitectureEvaluation | None:
    """Orchestrate architecture evaluation for a single trial."""
    workspace_path = trial_dir / "artifacts" / "workspace"
    if not workspace_path.exists():
        print(f"  SKIP: No artifacts/workspace/ in {trial_dir.name}")
        return None

    result_json = _load_json(trial_dir / "result.json")
    task_name = _resolve_task_name(result_json)
    task_dir = _resolve_task_dir(result_json)
    trial_name = result_json.get("trial_name", trial_dir.name)
    agent_name = _resolve_agent_name(trial_dir)
    harbor_reward = result_json.get("verifier_result", {}).get("rewards", {}).get("reward", 0.0)

    criteria_path = task_dir / "architecture_criteria.md"
    if not criteria_path.exists():
        print(f"  SKIP: No architecture_criteria.md for task '{task_name}'")
        return None

    instruction_path = task_dir / "instruction.md"
    criteria = criteria_path.read_text()
    instruction = instruction_path.read_text() if instruction_path.exists() else ""

    prompt = _build_evaluator_prompt(instruction, criteria)
    print(f"  Task: {task_name}")
    print(f"  Workspace: {workspace_path}")
    print("  Running Claude Code evaluation...")

    raw_response = await _run_claude_code_evaluation(prompt, workspace_path)
    evaluation = _parse_evaluation_response(raw_response)

    if not evaluation:
        print("  ERROR: Failed to parse evaluation response")
        return None

    evaluation.task_name = task_name
    evaluation.trial_name = trial_name
    evaluation.agent_name = agent_name
    evaluation.harbor_reward = harbor_reward
    evaluation.evaluator_model = "claude-code-sdk"
    evaluation.timestamp = datetime.now(timezone.utc).isoformat()

    print(f"  Score: {evaluation.total_score}/100 ({evaluation.normalized_score:.2f})")
    for dim in evaluation.dimensions:
        print(f"    {dim.name}: {dim.score}/{dim.max_score}")

    return evaluation


# ---------------------------------------------------------------------------
# Resolution helpers
# ---------------------------------------------------------------------------


def _collect_trial_dirs(args: argparse.Namespace) -> list[Path]:
    if args.trial_dir:
        return [Path(args.trial_dir)]
    if args.job_dir:
        job_path = Path(args.job_dir)
        return sorted(
            [d for d in job_path.iterdir() if d.is_dir() and (d / "result.json").exists()],
            key=lambda p: p.name,
        )
    return []


def _resolve_agent_name(trial_dir: Path) -> str:
    trajectory_path = trial_dir / "agent" / "trajectory.json"
    if trajectory_path.exists():
        trajectory = _load_json(trajectory_path)
        return trajectory.get("agent", {}).get("name", "")
    return ""


def _resolve_task_dir(result: dict) -> Path:
    task_path = result.get("task_id", {}).get("path", "")
    if task_path:
        return REPO_ROOT / task_path
    task_name = result.get("task_name", "")
    source = result.get("source", "")
    if source and task_name:
        return REPO_ROOT / "evals" / source / "tasks" / task_name
    return Path()


def _resolve_task_name(result: dict) -> str:
    return result.get("task_name", "")


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


def _build_evaluator_prompt(instruction: str, criteria: str) -> str:
    return f"""You are an expert software architect evaluating AI-generated C# code for DDD and Hexagonal Architecture quality.

## Your task

Analyze the codebase in the current working directory. This code was generated by an AI agent that was given the following task instruction:

<task_instruction>
{instruction}
</task_instruction>

## Evaluation criteria

Score the code on the following dimensions. Each dimension is 0–25 points. Follow the rubric EXACTLY — assign the score that matches the description, not higher.

<criteria>
{criteria}
</criteria>

## How to evaluate

1. Use `Glob` to understand the project structure (find all .cs files).
2. Use `Read` to examine the key files: the new discount type, the Discount union, tests, and any infrastructure code.
3. Use `Grep` to search for specific patterns (IEquatable, readonly struct, interface implementations, etc.).
4. For each dimension, find concrete evidence in the code before assigning a score.

## Output format

After your analysis, output a single JSON block with your evaluation. The JSON MUST be the last code block in your response:

```json
{{
  "dimensions": [
    {{"name": "<dimension_snake_case>", "score": <0-25>, "max_score": 25, "reasoning": "<1-3 sentences with specific file/line references>"}},
    ...
  ],
  "total_score": <sum of all dimension scores>,
  "normalized_score": <total_score / 100.0>,
  "summary": "<2-3 sentence overall assessment>"
}}
```

IMPORTANT:
- Be precise — reference specific files and patterns you found.
- Do NOT inflate scores. If evidence is missing, score lower.
- The dimension names must be snake_case and match the criteria headings.
- Output exactly 4 dimensions.
"""


# ---------------------------------------------------------------------------
# Claude Code SDK interaction
# ---------------------------------------------------------------------------


async def _run_claude_code_evaluation(prompt: str, workspace_path: Path) -> str:
    _build_auth_env()  # validate auth is available

    text_parts: list[str] = []
    async for message in query(
        prompt=prompt,
        options=ClaudeCodeOptions(
            allowed_tools=["Read", "Glob", "Grep"],
            cwd=str(workspace_path),
            max_turns=30,
            model="claude-sonnet-4-6",
            env={"CLAUDECODE": ""},
        ),
    ):
        if message is None:
            continue
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    text_parts.append(block.text)

    return "\n".join(text_parts)


def _build_auth_env() -> dict[str, str]:
    env = {}
    for key in ("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"):
        val = os.environ.get(key)
        if val:
            env[key] = val
    if not env:
        print("ERROR: Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN")
        sys.exit(1)
    return env


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def _parse_evaluation_response(raw: str) -> ArchitectureEvaluation | None:
    json_blocks = re.findall(r"```json\s*\n(.*?)\n```", raw, re.DOTALL)
    if not json_blocks:
        return None

    try:
        data = json.loads(json_blocks[-1])
    except json.JSONDecodeError:
        return None

    dimensions = [
        DimensionScore(
            name=d["name"],
            score=max(0, min(25, int(d["score"]))),
            max_score=d.get("max_score", 25),
            reasoning=d.get("reasoning", ""),
        )
        for d in data.get("dimensions", [])
    ]

    total = sum(d.score for d in dimensions)

    return ArchitectureEvaluation(
        task_name="",
        trial_name="",
        agent_name="",
        evaluator_model="",
        timestamp="",
        dimensions=dimensions,
        total_score=total,
        normalized_score=round(total / 100.0, 4),
        summary=data.get("summary", ""),
    )


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def _write_evaluation_result(trial_dir: Path, evaluation: ArchitectureEvaluation) -> None:
    output_path = trial_dir / "architecture_eval.json"
    with open(output_path, "w") as f:
        json.dump(asdict(evaluation), f, indent=2)
    print(f"  Written: {output_path}")


# ---------------------------------------------------------------------------
# Opik integration
# ---------------------------------------------------------------------------


def _upload_to_opik(evaluation: ArchitectureEvaluation) -> None:
    try:
        import opik
    except ImportError:
        print("  WARN: opik not installed, skipping upload")
        return

    client = opik.Opik()
    trace_id = _find_opik_trace(client, evaluation.trial_name, evaluation.agent_name)

    if not trace_id:
        print(f"  Creating new trace for {evaluation.trial_name}")
        new_trace = client.trace(
            name=f"{evaluation.trial_name}__arch-eval",
            project_name=DEFAULT_PROJECT,
            input={"task_name": evaluation.task_name},
            output={"summary": evaluation.summary},
        )
        trace_id = new_trace.id

    scores = [
        {
            "id": trace_id,
            "name": f"arch_{dim.name}",
            "value": float(dim.score) / float(dim.max_score),
            "reason": dim.reasoning,
        }
        for dim in evaluation.dimensions
    ]
    scores.append(
        {
            "id": trace_id,
            "name": "arch_total",
            "value": evaluation.normalized_score,
            "reason": evaluation.summary,
        }
    )

    client.log_traces_feedback_scores(scores, project_name=DEFAULT_PROJECT)
    client.flush()
    print(f"  Uploaded {len(scores)} feedback scores to Opik (trace {trace_id})")


def _find_opik_trace(client: "opik.Opik", trial_name: str, agent_name: str) -> str | None:
    """Find an existing Opik trace for this trial."""
    # opik harbor run creates traces named "{agent_name}/{trial_name}"
    search_names = []
    if agent_name:
        search_names.append(f"{agent_name}/{trial_name}")
    search_names.append(trial_name)

    for name in search_names:
        try:
            traces = client.search_traces(
                project_name=DEFAULT_PROJECT,
                filter_string=f'name = "{name}"',
                max_results=1,
            )
            if traces:
                print(f"  Found Opik trace: {name} ({traces[0].id})")
                return traces[0].id
        except Exception as e:
            print(f"  WARN: Opik search failed for '{name}': {e}")

    return None


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate architecture quality of Harbor trial artifacts")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--trial-dir", help="Path to a single trial directory")
    group.add_argument("--job-dir", help="Path to a job directory (evaluates all trials)")
    parser.add_argument("--with-opik", action="store_true", help="Upload scores to Opik")
    return parser.parse_args()


if __name__ == "__main__":
    main()
