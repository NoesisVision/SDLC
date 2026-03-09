"""Langfuse ATIF trajectory importer.

Imports ATIF trajectory data as Langfuse traces with generations and spans.
Evaluation (LLM-as-a-judge) is configured in Langfuse UI via Evaluators.

Uses Langfuse REST API directly (httpx) to avoid Pydantic v1 compatibility
issues with Python 3.14+.

Usage:
    uv run evals/eval-platforms/import_langfuse.py --trial-dir evals/ddd-architectural-challenges/trials/ddd-threshold-discount__dXn2tT2
"""

import argparse
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

from atif_parser import (
    TrajectoryStep,
    TrialData,
    extract_final_code,
    load_trial_data,
)

load_dotenv()


def main() -> None:
    args = _parse_args()
    trial_path = Path(args.trial_dir)

    print(f"Loading trial data from {trial_path}")
    trial = load_trial_data(trial_path)

    print("Creating Langfuse trace...")
    client = _create_client()
    trace_id = _create_langfuse_trace(client, trial)

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


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import ATIF trajectories to Langfuse")
    parser.add_argument(
        "--trial-dir",
        required=True,
        help="Path to trial directory containing agent/trajectory.json and result.json",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
