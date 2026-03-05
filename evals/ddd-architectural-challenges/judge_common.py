"""Common utilities for LLM-as-a-judge evaluation across observability platforms.

Provides ATIF trajectory parsing, judge prompt construction, and Anthropic API
caller shared by Opik, Phoenix, and Langfuse judge scripts.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv()

JUDGE_MODEL = "claude-sonnet-4-6"


@dataclass
class StepMetrics:
    """Token usage metrics for a single ATIF step."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    total_tokens: int = 0


@dataclass
class ToolCall:
    """A tool call within an ATIF step."""

    tool_call_id: str
    function_name: str
    arguments: dict
    result: str = ""


@dataclass
class TrajectoryStep:
    """A single step in an ATIF trajectory."""

    step_id: int
    timestamp: str
    source: str
    message: str = ""
    model_name: str = ""
    metrics: StepMetrics = field(default_factory=StepMetrics)
    tool_calls: list[ToolCall] = field(default_factory=list)
    is_sidechain: bool = False


@dataclass
class TrialData:
    """Parsed trial data from ATIF trajectory and result files."""

    trial_name: str
    task_name: str
    agent_name: str
    model_name: str
    session_id: str
    steps: list[TrajectoryStep]
    reward: float
    total_input_tokens: int
    total_output_tokens: int
    total_cached_tokens: int
    started_at: str
    finished_at: str
    duration_sec: float
    task_instruction: str
    verifier_rewards: dict[str, float] = field(default_factory=dict)


@dataclass
class JudgeScores:
    """Evaluation scores from LLM-as-a-judge."""

    ddd_quality: int
    ddd_quality_reason: str
    trajectory_efficiency: int
    trajectory_efficiency_reason: str
    cost_efficiency: int
    cost_efficiency_reason: str


def load_trial_data(trial_dir: str | Path) -> TrialData:
    """Load and parse ATIF trajectory and result data from a trial directory.

    Args:
        trial_dir: Path to the trial directory containing agent/trajectory.json
            and result.json.

    Returns:
        Parsed TrialData with all steps, metrics, and metadata.
    """
    trial_path = Path(trial_dir)
    trajectory = _load_json(trial_path / "agent" / "trajectory.json")
    result = _load_json(trial_path / "result.json")

    steps = _parse_steps(trajectory.get("steps", []))
    task_instruction = _extract_task_instruction(steps)
    duration_sec = _compute_duration(result)

    agent_result = result.get("agent_result", {})
    verifier_result = result.get("verifier_result", {})

    return TrialData(
        trial_name=result.get("trial_name", trial_path.name),
        task_name=result.get("task_name", ""),
        agent_name=trajectory.get("agent", {}).get("name", ""),
        model_name=trajectory.get("agent", {}).get("model_name", ""),
        session_id=trajectory.get("session_id", ""),
        steps=steps,
        reward=verifier_result.get("rewards", {}).get("reward", 0.0),
        total_input_tokens=agent_result.get("n_input_tokens", 0),
        total_output_tokens=agent_result.get("n_output_tokens", 0),
        total_cached_tokens=agent_result.get("n_cache_tokens", 0),
        started_at=result.get("started_at", ""),
        finished_at=result.get("finished_at", ""),
        duration_sec=duration_sec,
        task_instruction=task_instruction,
        verifier_rewards=verifier_result.get("rewards", {}),
    )


def extract_final_code(steps: list[TrajectoryStep]) -> str:
    """Extract the final code written by the agent from Write/Edit tool calls.

    Args:
        steps: List of trajectory steps to search through.

    Returns:
        Concatenated code from the last Write/Edit tool calls.
    """
    code_snippets = []
    for step in steps:
        for tc in step.tool_calls:
            if tc.function_name in ("Write", "Edit", "NotebookEdit"):
                args = tc.arguments
                file_path = args.get("file_path", "unknown")
                content = args.get("content", args.get("new_string", ""))
                if content:
                    code_snippets.append(f"--- {file_path} ---\n{content}")
    return "\n\n".join(code_snippets[-10:]) if code_snippets else "(no code written)"


def build_judge_prompt(
    task_instruction: str,
    final_code: str,
    reward: float,
    tool_call_count: int,
    total_tokens: int,
    duration_sec: float,
) -> str:
    """Build the evaluation prompt for LLM-as-a-judge.

    Args:
        task_instruction: The original task given to the agent.
        final_code: The code produced by the agent.
        reward: Verifier reward score (0.0 or 1.0).
        tool_call_count: Total number of tool calls in the trajectory.
        total_tokens: Total tokens consumed.
        duration_sec: Duration of agent execution in seconds.

    Returns:
        Formatted prompt string for the judge model.
    """
    return f"""You are an expert evaluator of AI coding agents working on Domain-Driven Design (DDD) tasks.

Evaluate the agent's performance on the following dimensions, scoring each from 1 (poor) to 5 (excellent).

## Task Instruction
{task_instruction}

## Agent's Final Code Output
{final_code}

## Execution Metrics
- Verifier reward: {reward}
- Total tool calls: {tool_call_count}
- Total tokens consumed: {total_tokens}
- Execution duration: {duration_sec:.0f} seconds

## Evaluation Criteria

### 1. DDD Quality (1-5)
- Does the code follow DDD tactical patterns (Value Objects, Entities, Aggregates)?
- Does it fit into the existing hexagonal architecture?
- Does it follow the codebase conventions (naming, file placement, style)?
- Are tests written following existing test conventions?

### 2. Trajectory Efficiency (1-5)
- Was the agent's exploration focused and purposeful?
- Did it avoid unnecessary tool calls or redundant exploration?
- Did it converge on a solution quickly?
- Was the tool call count reasonable for the task complexity?

### 3. Cost Efficiency (1-5)
- Was token usage reasonable for the task?
- Did the agent avoid unnecessarily large context windows?
- Was the execution time reasonable?

## Response Format
Respond ONLY with valid JSON (no markdown fences):
{{
  "ddd_quality": <1-5>,
  "ddd_quality_reason": "<brief explanation>",
  "trajectory_efficiency": <1-5>,
  "trajectory_efficiency_reason": "<brief explanation>",
  "cost_efficiency": <1-5>,
  "cost_efficiency_reason": "<brief explanation>"
}}"""


def call_judge(prompt: str) -> JudgeScores:
    """Call Anthropic API with the judge prompt and parse the response.

    Args:
        prompt: The evaluation prompt.

    Returns:
        Parsed JudgeScores from the model response.
    """
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=JUDGE_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    raw_text = response.content[0].text.strip()
    return _parse_judge_response(raw_text)


def count_tool_calls(steps: list[TrajectoryStep]) -> int:
    """Count total tool calls across all steps.

    Args:
        steps: List of trajectory steps.

    Returns:
        Total number of tool calls.
    """
    return sum(len(step.tool_calls) for step in steps)


def compute_total_tokens_from_steps(steps: list[TrajectoryStep]) -> int:
    """Compute total tokens from step-level metrics.

    Args:
        steps: List of trajectory steps.

    Returns:
        Sum of prompt + completion tokens across all agent steps.
    """
    return sum(
        step.metrics.prompt_tokens + step.metrics.completion_tokens
        for step in steps
        if step.source == "agent"
    )


# --- Private helpers ---


def _load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def _parse_steps(raw_steps: list[dict]) -> list[TrajectoryStep]:
    parsed = []
    for raw in raw_steps:
        metrics = _parse_metrics(raw.get("metrics", {}))
        tool_calls = _parse_tool_calls(raw)
        extra = raw.get("extra", {})
        parsed.append(
            TrajectoryStep(
                step_id=raw.get("step_id", 0),
                timestamp=raw.get("timestamp", ""),
                source=raw.get("source", ""),
                message=raw.get("message", ""),
                model_name=raw.get("model_name", ""),
                metrics=metrics,
                tool_calls=tool_calls,
                is_sidechain=extra.get("is_sidechain", False),
            )
        )
    return parsed


def _parse_metrics(raw: dict) -> StepMetrics:
    return StepMetrics(
        prompt_tokens=raw.get("prompt_tokens", 0),
        completion_tokens=raw.get("completion_tokens", 0),
        cached_tokens=raw.get("cached_tokens", 0),
        total_tokens=raw.get("prompt_tokens", 0) + raw.get("completion_tokens", 0),
    )


def _parse_tool_calls(raw_step: dict) -> list[ToolCall]:
    tool_calls = []
    for tc in raw_step.get("tool_calls", []):
        result_text = _extract_tool_result(raw_step, tc.get("tool_call_id", ""))
        tool_calls.append(
            ToolCall(
                tool_call_id=tc.get("tool_call_id", ""),
                function_name=tc.get("function_name", ""),
                arguments=tc.get("arguments", {}),
                result=result_text,
            )
        )
    return tool_calls


def _extract_tool_result(raw_step: dict, tool_call_id: str) -> str:
    observation = raw_step.get("observation", {})
    for result in observation.get("results", []):
        if result.get("source_call_id") == tool_call_id:
            content = result.get("content", "")
            if isinstance(content, str):
                return content[:2000]
            if isinstance(content, dict):
                return json.dumps(content)[:2000]
    return ""


def _extract_task_instruction(steps: list[TrajectoryStep]) -> str:
    for step in steps:
        if step.source == "user" and step.message:
            return step.message
    return "(no task instruction found)"


def _compute_duration(result: dict) -> float:
    from datetime import datetime, timezone

    started = result.get("started_at", "")
    finished = result.get("finished_at", "")
    if not started or not finished:
        return 0.0
    try:
        start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(finished.replace("Z", "+00:00"))
        return (end_dt - start_dt).total_seconds()
    except (ValueError, TypeError):
        return 0.0


def _parse_judge_response(raw_text: str) -> JudgeScores:
    parsed = json.loads(raw_text)
    return JudgeScores(
        ddd_quality=parsed["ddd_quality"],
        ddd_quality_reason=parsed["ddd_quality_reason"],
        trajectory_efficiency=parsed["trajectory_efficiency"],
        trajectory_efficiency_reason=parsed["trajectory_efficiency_reason"],
        cost_efficiency=parsed["cost_efficiency"],
        cost_efficiency_reason=parsed["cost_efficiency_reason"],
    )
