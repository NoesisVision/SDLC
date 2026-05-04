# Quality Attributes

Used by `noesis:implement-design-doc` Step 4 / Step 5 subagents whose Building Block slice contains any `qualityAttributes` entries.

A Quality Attribute is a **technical concern**: an operational expectation about *how* the system behaves (latency, throughput, availability, security, observability, …) — distinct from a `Rule`, which is a domain concern about *what* the system enforces. Treat them with the same rigour you give Rules, but materialise them in the technical-concern artefacts of the platform, not in domain code.

## Where each QA attaches

The doc declares the attachment point. Implement at exactly that scope — no narrower, no wider:

| Doc level | Code-side artefact scope |
| --- | --- |
| `Behaviour` | The C# method (or a wrapper around it). |
| `BuildingBlock` | The class. |
| `DesignedDomainModule` | The module project. |
| `DesignedBoundedContext` | The bounded-context project. |

## How to materialise — by type

### `performance`

Translate the description into a measurable target (`p95 ≤ X ms`, `≥ Y RPS`, `≤ Z MB peak`) and produce **at least one** of:

- A **performance / load test** at the corresponding scope. For Behaviour-level QAs use BenchmarkDotNet or a focused integration-load test asserting the threshold with a small tolerance. For Module / BC scope, prefer a service-level load harness invoked from CI.
- A **runtime check** (e.g. a timing middleware, OpenTelemetry instrumentation, a `RequestTimeout`) that fails fast when the threshold is breached in production.

When the description gives a specific target, encode it in the test as a constant — do not hand-wave with "fast enough".

### `availability`

Translate the description into the operational shape it implies (replicas, retry, circuit-breaker, idempotency, fallback) and produce:

- The **runtime configuration / code** that implements the shape (e.g. a Polly retry policy, an idempotency key on a command handler, a health check endpoint, an external `IRetryPolicy` registration in DI).
- An **integration test** that exercises the failure mode the QA defends against (e.g. transient adapter failure → retried successfully; downstream slow → circuit-breaker open).

### `security`

Translate the description into platform constraints and produce:

- The **enforcement code** (authorisation attribute, validation middleware, encryption-at-rest configuration, secret-management lookup, …) at the declared scope.
- A **security test** asserting the negative case (unauthorised request rejected, payload without required claim refused, sensitive field redacted in logs).

When the QA mentions a specific scheme (`OAuth2`, `mTLS`, `AES-256`), wire that scheme — do not substitute a weaker mechanism on the assumption "it's only a test environment".

### `other`

The description must state both the intent and how to verify it. Common patterns:

- Observability — emit a metric / structured log entry; assert with a test that captures the emitted record.
- Traceability / audit — write an audit-log entry on the relevant transition; assert via a test that the entry shows up.
- Data-protection (retention, redaction, anonymisation) — wire the policy at the storage adapter and add a test that verifies the policy applied.

If the description is too vague to act on, the right move is to **stop and `AskUserQuestion`** rather than guess. Quality attributes affect operational behaviour the user cares about — silent reinterpretation is worse than blocking.

## Tests, not docs

Every Quality Attribute that lands at the Behaviour or BuildingBlock level must have at least one corresponding **automated test** that fails when the QA is violated. Module / BC-level QAs may rely on a single test at the highest scope they cover, when a per-Behaviour test would be redundant.

Place tests with the rest of the BC / Module's tests, not in a separate "non-functional" tree. Name them after the QA (e.g. `Performance_PlaceOrderLatency_p95Under200ms`).

## Modifications

When a QA is in `modified`, treat the change like a Rule modification: identify the existing test/configuration the QA produced, update it to match the new target, run the build + tests, and ensure no other QA on the same parent has been silently affected.

When a QA is in `removed`, delete the corresponding test and any platform configuration that exists solely for it. Be explicit about what you remove in the subagent report.

## Coordination with Rules

A constraint that appears as both a Rule and a Quality Attribute (the doc's discriminator: domain truth → Rule; operational envelope → QA) ships as **two separate artefacts**:

- The Rule → a domain-side enforcement + business-scenario test.
- The QA → the operational artefact described above.

Do not merge them into one test. The two artefacts capture different intents and decay independently.

## Reporting back

When the slice contained quality attributes, list them in the subagent report:
- Which artefacts were produced (test names, config keys, attribute names).
- Any QA that was deferred or that the subagent could not implement deterministically — surface it so the coordinator can `AskUserQuestion` if needed.

Quality attributes that the Step 7 comparator does **not** verify (everything except the `[Actor("…")]` annotation, which is its own check) are entirely the subagent's responsibility — there is no second deterministic check to catch a missed QA.
