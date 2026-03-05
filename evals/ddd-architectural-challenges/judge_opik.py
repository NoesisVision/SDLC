"""Opik LLM-as-a-judge evaluator.

Fetches traces from Opik API for a given project, runs LLM-as-a-judge
evaluation, and sends feedback scores back to Opik.

Usage:
    uv run evals/ddd-architectural-challenges/judge_opik.py
    uv run evals/ddd-architectural-challenges/judge_opik.py --project ddd-architectural-challenges
    uv run evals/ddd-architectural-challenges/judge_opik.py --trial-dir trials/ddd-threshold-discount__dXn2tT2
"""

import argparse
import sys
from pathlib import Path

import opik
from dotenv import load_dotenv
from opik.rest_api.types.trace_public import TracePublic
from opik.types import BatchFeedbackScoreDict

from judge_common import (
    JudgeScores,
    build_judge_prompt,
    call_judge,
    count_tool_calls,
    compute_total_tokens_from_steps,
    extract_final_code,
    load_trial_data,
)

load_dotenv()

DEFAULT_PROJECT = "ddd-architectural-challenges"


def main() -> None:
    args = _parse_args()

    if args.trial_dir:
        _evaluate_from_trial(args.trial_dir)
    else:
        _evaluate_from_opik_api(args.project)


def _evaluate_from_trial(trial_dir: str) -> None:
    """Evaluate a trial by loading ATIF data and sending scores to Opik."""
    trial_path = Path(trial_dir)
    if not trial_path.is_absolute():
        trial_path = Path(__file__).parent / trial_dir

    print(f"Loading trial data from {trial_path}")
    trial = load_trial_data(trial_path)

    scores = _run_judge(trial)
    _log_scores_to_opik(trial, scores)


def _evaluate_from_opik_api(project_name: str) -> None:
    """Fetch traces from Opik API and evaluate each."""
    client = opik.Opik()
    traces = client.search_traces(project_name=project_name)

    if not traces:
        print(f"No traces found in project '{project_name}'")
        sys.exit(1)

    print(f"Found {len(traces)} traces in project '{project_name}'")

    for trace in traces:
        print(f"\nEvaluating trace: {trace.id} ({trace.name})")
        scores = _evaluate_trace(trace)
        _send_feedback_scores(client, trace.id, scores)


def _evaluate_trace(trace: TracePublic) -> JudgeScores:
    """Evaluate a single Opik trace using LLM-as-a-judge."""
    task_instruction = trace.input or "(no input recorded)"
    output = trace.output or "(no output recorded)"
    metadata = trace.metadata or {}

    tool_call_count = metadata.get("tool_call_count", 0)
    total_tokens = metadata.get("total_tokens", 0)
    duration_sec = metadata.get("duration_sec", 0)

    prompt = build_judge_prompt(
        task_instruction=str(task_instruction),
        final_code=str(output),
        reward=metadata.get("reward", 0.0),
        tool_call_count=tool_call_count,
        total_tokens=total_tokens,
        duration_sec=duration_sec,
    )

    print("  Calling judge...")
    return call_judge(prompt)


def _run_judge(trial: "TrialData") -> JudgeScores:
    """Run LLM-as-a-judge on parsed trial data."""
    from judge_common import TrialData

    final_code = extract_final_code(trial.steps)
    tool_call_count = count_tool_calls(trial.steps)
    total_tokens = compute_total_tokens_from_steps(trial.steps)

    prompt = build_judge_prompt(
        task_instruction=trial.task_instruction,
        final_code=final_code,
        reward=trial.reward,
        tool_call_count=tool_call_count,
        total_tokens=total_tokens or trial.total_input_tokens + trial.total_output_tokens,
        duration_sec=trial.duration_sec,
    )

    print("Calling judge...")
    return call_judge(prompt)


def _log_scores_to_opik(trial: "TrialData", scores: JudgeScores) -> None:
    """Create a trace in Opik from trial data and attach judge scores."""
    client = opik.Opik()
    project_name = DEFAULT_PROJECT

    trace = client.trace(
        name=trial.trial_name,
        project_name=project_name,
        input={"task_instruction": trial.task_instruction},
        output={"final_code": extract_final_code(trial.steps)},
        metadata={
            "task_name": trial.task_name,
            "agent_name": trial.agent_name,
            "model_name": trial.model_name,
            "reward": trial.reward,
            "total_input_tokens": trial.total_input_tokens,
            "total_output_tokens": trial.total_output_tokens,
            "duration_sec": trial.duration_sec,
        },
    )

    _create_spans_from_steps(client, trace, trial, project_name)

    trace_id = trace.id
    _send_feedback_scores(client, trace_id, scores)

    client.flush()
    print(f"Scores logged to Opik project '{project_name}', trace {trace_id}")


def _create_spans_from_steps(
    client: opik.Opik,
    trace: opik.Trace,
    trial: "TrialData",
    project_name: str,
) -> None:
    """Create nested spans in Opik for each agent step."""
    for step in trial.steps:
        if step.source != "agent":
            continue

        span = trace.span(
            name=f"step_{step.step_id}",
            input={"message": step.message[:500] if step.message else ""},
            metadata={
                "model_name": step.model_name,
                "prompt_tokens": step.metrics.prompt_tokens,
                "completion_tokens": step.metrics.completion_tokens,
                "cached_tokens": step.metrics.cached_tokens,
                "is_sidechain": step.is_sidechain,
            },
        )

        for tc in step.tool_calls:
            span.span(
                name=tc.function_name,
                input={"arguments": str(tc.arguments)[:500]},
                output={"result": tc.result[:500] if tc.result else ""},
            )

        span.end()


def _send_feedback_scores(
    client: opik.Opik,
    trace_id: str,
    scores: JudgeScores,
) -> None:
    """Send judge scores as feedback to an Opik trace."""
    score_entries: list[BatchFeedbackScoreDict] = [
        {"id": trace_id, "name": "ddd_quality", "value": scores.ddd_quality, "reason": scores.ddd_quality_reason},
        {"id": trace_id, "name": "trajectory_efficiency", "value": scores.trajectory_efficiency, "reason": scores.trajectory_efficiency_reason},
        {"id": trace_id, "name": "cost_efficiency", "value": scores.cost_efficiency, "reason": scores.cost_efficiency_reason},
    ]

    client.log_traces_feedback_scores(
        project_name=DEFAULT_PROJECT,
        scores=score_entries,
    )
    _print_scores(scores)


def _print_scores(scores: JudgeScores) -> None:
    """Print judge scores to stdout."""
    print(f"  DDD Quality:           {scores.ddd_quality}/5 - {scores.ddd_quality_reason}")
    print(f"  Trajectory Efficiency: {scores.trajectory_efficiency}/5 - {scores.trajectory_efficiency_reason}")
    print(f"  Cost Efficiency:       {scores.cost_efficiency}/5 - {scores.cost_efficiency_reason}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Opik LLM-as-a-judge evaluator")
    parser.add_argument(
        "--project",
        default=DEFAULT_PROJECT,
        help="Opik project name to fetch traces from",
    )
    parser.add_argument(
        "--trial-dir",
        help="Path to trial directory (imports ATIF data to Opik)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
