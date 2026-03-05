"""Phoenix LLM-as-a-judge evaluator.

Imports ATIF trajectory data as OpenTelemetry spans to Phoenix Cloud,
runs LLM-as-a-judge evaluation, and sends annotations back.

Usage:
    uv run evals/ddd-architectural-challenges/judge_phoenix.py --trial-dir trials/ddd-threshold-discount__dXn2tT2
"""

import argparse
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from openinference.semconv.trace import SpanAttributes
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from phoenix.otel import register

from judge_common import (
    JudgeScores,
    TrialData,
    build_judge_prompt,
    call_judge,
    compute_total_tokens_from_steps,
    count_tool_calls,
    extract_final_code,
    load_trial_data,
)

load_dotenv()

PHOENIX_CLOUD_BASE = "https://app.phoenix.arize.com"


def main() -> None:
    args = _parse_args()
    trial_path = _resolve_trial_path(args.trial_dir)

    print(f"Loading trial data from {trial_path}")
    trial = load_trial_data(trial_path)

    print("Sending spans to Phoenix...")
    span_ids = _send_spans_to_phoenix(trial)

    print("Running LLM-as-a-judge...")
    scores = _run_judge(trial)
    _print_scores(scores)

    print("Sending evaluations to Phoenix...")
    _send_evaluations(span_ids["root_span_id"], scores)

    print("Done!")


def _send_spans_to_phoenix(trial: TrialData) -> dict[str, str]:
    """Send ATIF trajectory as OTel spans to Phoenix Cloud.

    Args:
        trial: Parsed trial data.

    Returns:
        Dictionary with root_span_id for evaluation attachment.
    """
    provider = register(
        endpoint=PHOENIX_CLOUD_BASE,
        project_name="harbor-eval",
        api_key=os.environ.get("PHOENIX_API_KEY", ""),
        batch=False,
        set_global_tracer_provider=False,
        verbose=False,
    )

    tracer = provider.get_tracer("harbor-eval")
    root_span_id = _create_agent_trace(tracer, trial)

    provider.force_flush()
    provider.shutdown()

    time.sleep(2)

    return {"root_span_id": root_span_id}


def _create_agent_trace(tracer: trace.Tracer, trial: TrialData) -> str:
    """Create the root AGENT span with nested LLM and TOOL spans."""
    final_code = extract_final_code(trial.steps)

    with tracer.start_as_current_span(
        name=trial.trial_name,
        attributes={
            SpanAttributes.OPENINFERENCE_SPAN_KIND: "AGENT",
            SpanAttributes.INPUT_VALUE: trial.task_instruction[:4000],
            SpanAttributes.OUTPUT_VALUE: final_code[:4000],
            "trial.task_name": trial.task_name,
            "trial.agent_name": trial.agent_name,
            "trial.model_name": trial.model_name,
            "trial.reward": trial.reward,
            "trial.duration_sec": trial.duration_sec,
        },
    ) as root_span:
        root_span_id = format(root_span.get_span_context().span_id, "016x")

        for step in trial.steps:
            if step.source != "agent":
                continue

            _create_llm_span(tracer, step)

        root_span.set_status(StatusCode.OK if trial.reward > 0 else StatusCode.ERROR)

    return root_span_id


def _create_llm_span(tracer: trace.Tracer, step: "TrajectoryStep") -> None:
    """Create an LLM span for an agent step with nested TOOL spans."""
    attributes = {
        SpanAttributes.OPENINFERENCE_SPAN_KIND: "LLM",
        SpanAttributes.LLM_MODEL_NAME: step.model_name or "unknown",
        SpanAttributes.LLM_TOKEN_COUNT_PROMPT: step.metrics.prompt_tokens,
        SpanAttributes.LLM_TOKEN_COUNT_COMPLETION: step.metrics.completion_tokens,
        SpanAttributes.LLM_TOKEN_COUNT_TOTAL: step.metrics.total_tokens,
        SpanAttributes.INPUT_VALUE: step.message[:2000] if step.message else "",
    }

    with tracer.start_as_current_span(
        name=f"step_{step.step_id}",
        attributes=attributes,
    ) as llm_span:
        for tc in step.tool_calls:
            _create_tool_span(tracer, tc)

        llm_span.set_status(StatusCode.OK)


def _create_tool_span(tracer: trace.Tracer, tc: "ToolCall") -> None:
    """Create a TOOL span for a tool call within a step."""
    with tracer.start_as_current_span(
        name=tc.function_name,
        attributes={
            SpanAttributes.OPENINFERENCE_SPAN_KIND: "TOOL",
            SpanAttributes.TOOL_NAME: tc.function_name,
            SpanAttributes.INPUT_VALUE: str(tc.arguments)[:2000],
            SpanAttributes.OUTPUT_VALUE: tc.result[:2000] if tc.result else "",
        },
    ) as tool_span:
        tool_span.set_status(StatusCode.OK)


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


def _send_evaluations(root_span_id: str, scores: JudgeScores) -> None:
    """Send judge scores as annotations to Phoenix via REST API.

    Args:
        root_span_id: The hex span ID to annotate.
        scores: Judge scores to send as annotations.
    """
    phoenix_api_key = os.environ.get("PHOENIX_API_KEY", "")
    annotations = _build_annotation_payload(root_span_id, scores)

    try:
        response = httpx.post(
            f"{PHOENIX_CLOUD_BASE}/v1/span_annotations?sync=false",
            json={"data": annotations},
            headers={"api_key": phoenix_api_key},
            timeout=30,
        )
        response.raise_for_status()
        print(f"  Evaluations sent for span {root_span_id}")
    except Exception as e:
        print(f"  Warning: Could not send evaluations: {e}")
        print("  Spans were still exported successfully via OTel.")
        print("  You can add evaluations manually in the Phoenix UI.")


def _build_annotation_payload(
    span_id: str, scores: JudgeScores
) -> list[dict]:
    return [
        {
            "span_id": span_id,
            "name": "ddd_quality",
            "annotator_kind": "LLM",
            "result": {
                "label": "ddd_quality",
                "score": scores.ddd_quality,
                "explanation": scores.ddd_quality_reason,
            },
        },
        {
            "span_id": span_id,
            "name": "trajectory_efficiency",
            "annotator_kind": "LLM",
            "result": {
                "label": "trajectory_efficiency",
                "score": scores.trajectory_efficiency,
                "explanation": scores.trajectory_efficiency_reason,
            },
        },
        {
            "span_id": span_id,
            "name": "cost_efficiency",
            "annotator_kind": "LLM",
            "result": {
                "label": "cost_efficiency",
                "score": scores.cost_efficiency,
                "explanation": scores.cost_efficiency_reason,
            },
        },
    ]


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
    parser = argparse.ArgumentParser(description="Phoenix LLM-as-a-judge evaluator")
    parser.add_argument(
        "--trial-dir",
        required=True,
        help="Path to trial directory containing agent/trajectory.json and result.json",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
