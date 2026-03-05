"""Langfuse LLM-as-a-judge evaluator.

Imports ATIF trajectory data as Langfuse traces with generations and spans,
runs LLM-as-a-judge evaluation, and sends scores back.

Uses Langfuse REST API directly (httpx) to avoid Pydantic v1 compatibility
issues with Python 3.14+.

Usage:
    uv run evals/ddd-architectural-challenges/judge_langfuse.py --trial-dir trials/ddd-threshold-discount__dXn2tT2
"""

import argparse
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

from judge_common import (
    JudgeScores,
    TrajectoryStep,
    TrialData,
    build_judge_prompt,
    call_judge,
    compute_total_tokens_from_steps,
    count_tool_calls,
    extract_final_code,
    load_trial_data,
)

load_dotenv()


def main() -> None:
    args = _parse_args()
    trial_path = _resolve_trial_path(args.trial_dir)

    print(f"Loading trial data from {trial_path}")
    trial = load_trial_data(trial_path)

    print("Creating Langfuse trace...")
    client = _create_client()
    trace_id = _create_langfuse_trace(client, trial)

    print("Running LLM-as-a-judge...")
    scores = _run_judge(trial)
    _print_scores(scores)

    print("Sending scores to Langfuse...")
    _send_scores(client, trace_id, scores)

    print(f"Done! Trace ID: {trace_id}")


def _create_client() -> httpx.Client:
    """Create an httpx client configured for Langfuse REST API."""
    host = os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com")
    public_key = os.environ.get("LANGFUSE_PUBLIC_KEY", "")
    secret_key = os.environ.get("LANGFUSE_SECRET_KEY", "")

    return httpx.Client(
        base_url=host,
        auth=(public_key, secret_key),
        timeout=30,
    )


def _create_langfuse_trace(client: httpx.Client, trial: TrialData) -> str:
    """Create a Langfuse trace with nested generations and spans from ATIF data.

    Args:
        client: Configured httpx client for Langfuse API.
        trial: Parsed trial data.

    Returns:
        The Langfuse trace ID.
    """
    final_code = extract_final_code(trial.steps)
    trace_id = str(uuid.uuid4())

    events = []
    events.append(_trace_event(trace_id, trial, final_code))

    for step in trial.steps:
        if step.source != "agent":
            continue
        events.extend(_generation_events(trace_id, step))

    _batch_ingest(client, events)

    return trace_id


def _run_judge(trial: TrialData) -> JudgeScores:
    """Run LLM-as-a-judge on the trial data."""
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

    return call_judge(prompt)


def _send_scores(client: httpx.Client, trace_id: str, scores: JudgeScores) -> None:
    """Send judge scores to Langfuse as trace-level scores."""
    score_defs = [
        ("ddd_quality", scores.ddd_quality, scores.ddd_quality_reason),
        ("trajectory_efficiency", scores.trajectory_efficiency, scores.trajectory_efficiency_reason),
        ("cost_efficiency", scores.cost_efficiency, scores.cost_efficiency_reason),
    ]
    for name, value, comment in score_defs:
        response = client.post(
            "/api/public/scores",
            json={
                "traceId": trace_id,
                "name": name,
                "value": value,
                "comment": comment,
            },
        )
        response.raise_for_status()

    print(f"  Scores sent to trace {trace_id}")


# --- Private helpers ---


def _trace_event(trace_id: str, trial: TrialData, final_code: str) -> dict:
    return {
        "type": "trace-create",
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "body": {
            "id": trace_id,
            "name": trial.trial_name,
            "sessionId": trial.session_id,
            "input": trial.task_instruction,
            "output": final_code[:4000],
            "metadata": {
                "task_name": trial.task_name,
                "agent_name": trial.agent_name,
                "model_name": trial.model_name,
                "reward": trial.reward,
                "total_input_tokens": trial.total_input_tokens,
                "total_output_tokens": trial.total_output_tokens,
                "duration_sec": trial.duration_sec,
            },
            "tags": [trial.task_name, trial.agent_name, trial.model_name],
        },
    }


def _generation_events(trace_id: str, step: TrajectoryStep) -> list[dict]:
    events = []
    generation_id = str(uuid.uuid4())
    start_time = step.timestamp or datetime.now(timezone.utc).isoformat()

    events.append({
        "type": "generation-create",
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "body": {
            "id": generation_id,
            "traceId": trace_id,
            "name": f"step_{step.step_id}",
            "model": step.model_name or "unknown",
            "startTime": start_time,
            "input": step.message[:2000] if step.message else "",
            "usage": {
                "input": step.metrics.prompt_tokens,
                "output": step.metrics.completion_tokens,
                "total": step.metrics.total_tokens,
                "unit": "TOKENS",
            },
            "metadata": {
                "cached_tokens": step.metrics.cached_tokens,
                "is_sidechain": step.is_sidechain,
            },
        },
    })

    for tc in step.tool_calls:
        events.append({
            "type": "span-create",
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "body": {
                "id": str(uuid.uuid4()),
                "traceId": trace_id,
                "parentObservationId": generation_id,
                "name": tc.function_name,
                "startTime": start_time,
                "input": str(tc.arguments)[:2000],
                "output": tc.result[:2000] if tc.result else "",
            },
        })

    return events


def _batch_ingest(client: httpx.Client, events: list[dict]) -> None:
    """Send events to Langfuse batch ingestion endpoint."""
    batch_size = 50
    for i in range(0, len(events), batch_size):
        batch = events[i : i + batch_size]
        response = client.post(
            "/api/public/ingestion",
            json={"batch": batch},
        )
        response.raise_for_status()

    print(f"  Ingested {len(events)} events to Langfuse")


def _print_scores(scores: JudgeScores) -> None:
    """Print judge scores to stdout."""
    print(f"  DDD Quality:           {scores.ddd_quality}/5 - {scores.ddd_quality_reason}")
    print(f"  Trajectory Efficiency: {scores.trajectory_efficiency}/5 - {scores.trajectory_efficiency_reason}")
    print(f"  Cost Efficiency:       {scores.cost_efficiency}/5 - {scores.cost_efficiency_reason}")


def _resolve_trial_path(trial_dir: str) -> Path:
    trial_path = Path(trial_dir)
    if not trial_path.is_absolute():
        trial_path = Path(__file__).parent / trial_dir
    return trial_path


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Langfuse LLM-as-a-judge evaluator")
    parser.add_argument(
        "--trial-dir",
        required=True,
        help="Path to trial directory containing agent/trajectory.json and result.json",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
