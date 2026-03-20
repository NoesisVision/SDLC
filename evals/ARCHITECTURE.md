# Decision-Extraction Benchmark

## Overview

This benchmark evaluates how well an AI agent extracts software design decisions from team conversation transcripts. It tests the `extract_decisions` skill against a baseline (no skill) approach.

The benchmark infrastructure is provided by [nasde-toolkit](https://github.com/noesis/nasde-toolkit) — see its [ARCHITECTURE.md](../../nasde-toolkit/ARCHITECTURE.md) for the full evaluation framework design (Harbor orchestration, LLM-as-a-Judge assessment, Opik integration).

## Task: extract-decisions-from-review

**Input:** A transcript of an architecture review meeting discussing the [DDD-starter-dotnet](https://github.com/itlibrium/DDD-starter-dotnet) codebase.

**Expected output:** 3 major software design decisions extracted as structured JSON records, plus a structured conversation summary.

### Ground truth decisions

1. **Marten Document Store for Order aggregate (write side)** — JSONB flexibility, pragmatic vs Event Sourcing complexity
2. **EF Core for read side queries (CQRS)** — Team familiarity with LINQ vs Marten query capabilities
3. **Synchronous Sales-RiskManagement integration** — YAGNI principle vs async complexity

### Assessment criteria

Each trial is scored by an LLM-as-a-Judge across 4 dimensions (25 points each, 100 total):

- **Completeness** — all 3 major decisions identified with full detail
- **Accuracy** — correct decisions with faithful rationale and speaker attribution
- **Structure Quality** — well-formed JSON with clear context, rationale, consequences, alternatives
- **Context Relevance** — correct codebase references (OrderSqlRepository variants, PlaceOrderHandler, bounded contexts)

## Variants

- **vanilla** — agent works without the skill, given only the output schema and task description
- **with-skill** — agent uses the `extract_decisions` skill workflow (batch parsing, topic extraction via subagents, parallel decision record writing)
