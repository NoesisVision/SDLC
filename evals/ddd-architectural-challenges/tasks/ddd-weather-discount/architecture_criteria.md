# Architecture Criteria: Weather-Based Discount

Evaluate the AI-generated code across four dimensions. Each dimension is scored 0–25 points.

## 1. Hexagonal Architecture (0–25)

Evaluate separation of domain logic from infrastructure (HTTP API calls).

| Score | Criteria |
|-------|----------|
| 0     | HttpClient used directly in domain logic, no separation |
| 5     | Some separation attempted but domain still references `System.Net.Http` or concrete HTTP types |
| 10    | Interface/port exists for weather data, but domain logic still depends on HTTP concepts (URLs, status codes) |
| 15    | Clean port interface in domain (e.g. `IWeatherProvider` returning domain types), adapter in infrastructure, but port design is too specific (only precipitation, not extensible) |
| 20    | Good separation: domain port uses domain types, infrastructure adapter handles HTTP, but minor issues (e.g. port in wrong namespace, adapter not properly registered in DI) |
| 25    | Excellent hexagonal design: domain port (`IWeatherProvider` or similar) in domain layer returning domain value types, infrastructure adapter in separate project/namespace handling HTTP + JSON, proper DI registration, domain has zero reference to infrastructure |

**Key checks:**
- Does a port/interface exist in the domain layer for weather data?
- Does the port use domain types (not `HttpResponseMessage`, `JsonElement`, etc.)?
- Is the HTTP adapter in an infrastructure/adapter layer?
- Does the domain project have any reference to `System.Net.Http`?
- Is the adapter registered in DI container?

## 2. Extensibility Design (0–25)

Evaluate how easy it is to add future weather-based discounts (temperature, wind, UV, etc.).

| Score | Criteria |
|-------|----------|
| 0     | Hardcoded precipitation logic, no extensibility consideration |
| 5     | Single weather discount class with if/else for different conditions — adding new ones requires modifying existing code |
| 10    | Some abstraction exists but adding a new weather discount requires changes in multiple places |
| 15    | Strategy/Policy pattern used — new weather discounts can be added as new classes, but the weather provider interface only supports precipitation (need to change interface for new parameters) |
| 20    | Good design: Strategy pattern for discount rules, weather provider can return multiple parameters, but minor issues (e.g. configuration not flexible, or registration requires manual wiring) |
| 25    | Excellent: Strategy/Policy pattern, weather provider returns flexible data (multiple current parameters), new weather discounts are just new classes implementing a common interface, auto-discovery or simple registration, Open-Closed Principle fully respected |

**Key checks:**
- Is there an abstraction for weather-based discount rules (interface/base class)?
- Can a new weather discount (e.g. temperature-based) be added by only creating a new class?
- Does the weather provider support fetching multiple parameters (not just precipitation)?
- Is there a composition mechanism (list of rules, pipeline, etc.)?
- Would adding UV index discount require changing existing classes?

## 3. Error Handling & Resilience (0–25)

Evaluate graceful degradation when the weather API is unavailable.

| Score | Criteria |
|-------|----------|
| 0     | No error handling — API failure crashes the application or throws unhandled exception |
| 5     | Try-catch exists but swallows exceptions silently or returns wrong default |
| 10    | Catches HTTP exceptions and returns "no discount" default, but no logging or timeout configuration |
| 15    | Proper error handling with logging, returns safe default (no discount), but no timeout/retry configuration |
| 20    | Good resilience: timeout configured, exceptions caught and logged, safe default returned, but missing some edge cases (e.g. malformed JSON, unexpected API response shape) |
| 25    | Excellent: HTTP timeout configured, all failure modes handled (network error, timeout, non-200 status, malformed JSON, unexpected response), safe default (no discount), proper logging, optionally circuit breaker or retry pattern |

**Key checks:**
- Does API failure result in "no discount" (not an exception propagating up)?
- Is HttpClient timeout configured?
- Are different failure modes handled (network error, non-200, bad JSON)?
- Is there logging for API failures?
- Does the system continue to work when API is permanently down?

## 4. Test Quality & Isolation (0–25)

Evaluate test coverage and proper isolation from external services.

| Score | Criteria |
|-------|----------|
| 0     | No tests, or tests that call the real API |
| 5     | Basic tests exist but call real HTTP endpoints (flaky, environment-dependent) |
| 10    | Mock/stub for HTTP client exists, but only tests happy path |
| 15    | Good mock isolation, tests happy path and API failure, but missing edge cases or unit/integration separation |
| 20    | Comprehensive: mocked HTTP client, tests for precipitation > 0 (discount), precipitation = 0 (no discount), API failure (no discount), but minor gaps (e.g. no test for malformed response, or test naming inconsistent) |
| 25    | Excellent: HTTP client properly mocked/stubbed, unit tests for domain logic (discount calculation), integration tests for adapter (with mock HTTP handler), tests cover: happy path, no precipitation, API failure, malformed response, follows project test conventions |

**Key checks:**
- Is HttpClient mocked (e.g. `MockHttpMessageHandler` or `NSubstitute`/`Moq`)?
- Tests for: precipitation present (discount applies), no precipitation (no discount)?
- Tests for: API failure returns no discount?
- Are unit tests separated from integration tests?
- Do tests follow project naming conventions?
- Is there a test for the domain logic independent of infrastructure?
