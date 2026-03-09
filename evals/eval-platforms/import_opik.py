"""Opik ATIF trajectory importer.

Imports ATIF trajectory data as Opik traces with nested spans.
Evaluation (LLM-as-a-judge) is configured in Opik using its evaluation framework.

Usage:
    uv run evals/eval-platforms/import_opik.py --trial-dir evals/ddd-architectural-challenges/trials/ddd-threshold-discount__dXn2tT2
"""

import argparse
from pathlib import Path

import opik
from dotenv import load_dotenv

from atif_parser import (
    TrialData,
    extract_final_code,
    load_trial_data,
)

load_dotenv()

DEFAULT_PROJECT = "ddd-architectural-challenges"


def main() -> None:
    args = _parse_args()
    trial_path = Path(args.trial_dir)

    print(f"Loading trial data from {trial_path}")
    trial = load_trial_data(trial_path)

    _import_to_opik(trial)


def _import_to_opik(trial: TrialData) -> None:
    """Create a trace in Opik from ATIF trial data with nested spans."""
    client = opik.Opik()

    trace = client.trace(
        name=trial.trial_name,
        project_name=DEFAULT_PROJECT,
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

    _create_spans_from_steps(trace, trial)

    client.flush()
    print(f"Imported to Opik project '{DEFAULT_PROJECT}', trace {trace.id}")


def _create_spans_from_steps(trace: opik.Trace, trial: TrialData) -> None:
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


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import ATIF trajectories to Opik")
    parser.add_argument(
        "--trial-dir",
        required=True,
        help="Path to trial directory containing agent/trajectory.json and result.json",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
