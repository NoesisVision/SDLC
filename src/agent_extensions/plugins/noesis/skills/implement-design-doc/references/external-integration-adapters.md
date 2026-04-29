# External Integration Adapter Implementation (C#)

Loaded by the subagent that implements external-integration adapters at Step 5. Do not load from the coordinator. The port (interface) was created in Step 4 — see `external-integration.md`.

## Responsibilities

<!-- TODO: implement the external-integration port using the actual transport (HTTP client, message queue, SDK, …); translate transport errors to domain errors -->

## Class shape

<!-- TODO: class implementing the port; constructor injects HttpClient / SDK client; configuration via options pattern -->

## Mapping

<!-- TODO: external DTOs ↔ domain types; never leak external types into the domain -->

## Resilience

<!-- TODO: retries, timeouts, circuit-breaking — only when the design doc calls for them; do not add silently -->

## Tests

<!-- TODO: integration tests against a stubbed remote (WireMock / TestServer) covering the port methods -->

## Example

<!-- TODO: full annotated example of one HTTP adapter with mapping, error translation, and one integration test -->
