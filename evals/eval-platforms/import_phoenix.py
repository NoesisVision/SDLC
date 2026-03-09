"""Phoenix ATIF trajectory importer.

Imports ATIF trajectory data as OpenTelemetry spans to Phoenix Cloud.
Evaluation (LLM-as-a-judge) is configured in Phoenix UI or via SDK evaluators.

Usage:
    uv run evals/eval-platforms/import_phoenix.py --trial-dir evals/ddd-architectural-challenges/trials/ddd-threshold-discount__dXn2tT2
"""

import argparse
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from openinference.semconv.trace import SpanAttributes
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from phoenix.otel import register

from atif_parser import (
    ToolCall,
    TrajectoryStep,
    TrialData,
    extract_final_code,
    load_trial_data,
)

load_dotenv()

PHOENIX_CLOUD_BASE = "https://app.phoenix.arize.com"


def main() -> None:
    args = _parse_args()
    trial_path = Path(args.trial_dir)

    print(f"Loading trial data from {trial_path}")
    trial = load_trial_data(trial_path)

    print("Sending spans to Phoenix...")
    _send_spans_to_phoenix(trial)

    print("Done!")


def _send_spans_to_phoenix(trial: TrialData) -> None:
    """Send ATIF trajectory as OTel spans to Phoenix Cloud.

    Args:
        trial: Parsed trial data.
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
    _create_agent_trace(tracer, trial)

    provider.force_flush()
    provider.shutdown()

    time.sleep(2)


def _create_agent_trace(tracer: trace.Tracer, trial: TrialData) -> None:
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
        for step in trial.steps:
            if step.source != "agent":
                continue

            _create_llm_span(tracer, step)

        root_span.set_status(StatusCode.OK if trial.reward > 0 else StatusCode.ERROR)


def _create_llm_span(tracer: trace.Tracer, step: TrajectoryStep) -> None:
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


def _create_tool_span(tracer: trace.Tracer, tc: ToolCall) -> None:
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


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import ATIF trajectories to Phoenix")
    parser.add_argument(
        "--trial-dir",
        required=True,
        help="Path to trial directory containing agent/trajectory.json and result.json",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
