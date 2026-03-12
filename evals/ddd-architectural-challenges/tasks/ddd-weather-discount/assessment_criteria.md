# Architecture Criteria: Weather-Based Discount

Evaluate the AI-generated code across four dimensions. Each dimension is scored 0–25 points.

## 1. Domain Modeling (0–25)

Evaluate how well weather-related concepts are modeled using DDD building blocks.

| Score | Criteria |
|-------|----------|
| 0     | No domain types for weather data — raw HTTP responses or primitive types used in domain logic |
| 5     | Some domain types exist but weather data modeled as DTOs or anemic data holders, not proper value objects |
| 10    | Weather data has domain types but they leak infrastructure concerns (JSON annotations, HTTP status codes) |
| 15    | Clean domain types for weather data (e.g. precipitation as value object), but discount logic not modeled as a domain service or policy |
| 20    | Good domain modeling: weather data as value objects, discount logic as domain service/policy, but error handling uses infrastructure exceptions instead of domain-appropriate patterns |
| 25    | Excellent: weather conditions modeled as proper value objects, discount logic encapsulated in domain service/policy, failures handled through domain patterns (Result types, domain exceptions, or safe defaults), domain layer has zero infrastructure dependencies |

**Key checks:**
- Does a port/interface exist in the domain layer for weather data?
- Does the port use domain types (not `HttpResponseMessage`, `JsonElement`, etc.)?
- Is discount calculation logic in a domain service or policy (not in the adapter)?
- Are weather conditions modeled as value objects with proper semantics?

## 2. Architecture Compliance (0–25)

Evaluate separation of concerns, layer isolation, and adherence to project conventions.

| Score | Criteria |
|-------|----------|
| 0     | HttpClient used directly in domain logic, no separation |
| 5     | Some separation attempted but domain still references `System.Net.Http` or concrete HTTP types |
| 10    | Interface/port exists for weather data, but domain logic still depends on HTTP concepts (URLs, status codes) |
| 15    | Clean port interface in domain, adapter in infrastructure, but missing proper error handling — API failures crash the application or propagate infrastructure exceptions |
| 20    | Good separation: domain port with domain types, infrastructure adapter handles HTTP + JSON + error handling, proper DI registration, but minor issues (e.g. no timeout configuration, port in wrong namespace) |
| 25    | Excellent: domain port in domain layer returning domain value types, infrastructure adapter in separate project/namespace handling HTTP + JSON, timeout configured, all failure modes handled gracefully (network error, non-200, malformed JSON), safe default on failure, proper logging, proper DI registration, domain has zero reference to infrastructure |

**Key checks:**
- Is the HTTP adapter in an infrastructure/adapter layer?
- Does the domain project have any reference to `System.Net.Http`?
- Is the adapter registered in DI container?
- Is HttpClient timeout configured?
- Are different failure modes handled (network error, non-200, bad JSON)?
- Does API failure result in "no discount" (not an exception propagating up)?
- Is there logging for API failures?

## 3. Extensibility (0–25)

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

## 4. Test Quality (0–25)

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
