# Business Scenarios as Tests (C#)

Loaded by every Step 4 / Step 5 subagent whose Building Block slice contains at least one `Rule` or `Scenario` from the design doc. Do not load from the coordinator.

## Principle

Every `Rule` from the design doc must be exercised by at least one business-scenario test. The test attaches at the level the design doc specifies:

- Scenario attached to a Behaviour → test the Behaviour end-to-end.
- Scenario attached to a Building Block → test the BB across multiple Behaviours.
- Scenario attached directly to a Rule → test the single transition the Rule guards.

## Test framework

<!-- TODO: chosen framework (xUnit / NUnit / SpecFlow / Reqnroll); naming convention; project layout mirroring src -->

## Given-When-Then mapping

<!-- TODO: how Given/When/Then from the design doc map to Arrange/Act/Assert in the test; whether to use Gherkin tooling or plain test methods -->

## Scenario name → test name

<!-- TODO: convention for translating scenario names from the design doc into test method names -->

## Test data

<!-- TODO: fixtures, builders, object mothers; do not introduce randomness; reproducible inputs -->

## Don'ts

<!-- TODO: never invent rules or scenarios not in the design doc; never weaken assertions to make a test pass — fix the implementation instead -->

## Example

<!-- TODO: full annotated example mapping one design-doc scenario to one test -->
