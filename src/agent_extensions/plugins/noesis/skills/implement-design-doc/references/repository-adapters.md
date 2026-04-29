# Repository Adapter Implementation (C#)

Loaded by the subagent that implements repository adapters at Step 5. Do not load from the coordinator. The port (interface) was created in Step 4 — see `repository.md`.

## Responsibilities

<!-- TODO: implement the repository port against a concrete store (EF Core, Dapper, Mongo, …); map between persistence and domain types -->

## Class shape

<!-- TODO: class implementing the port; constructor injects DbContext / connection / client -->

## Mapping

<!-- TODO: persistence model ↔ aggregate; loading whole aggregates; tracking change for save -->

## Transactions and unit-of-work

<!-- TODO: how the adapter participates in the application-service transaction boundary -->

## Tests

<!-- TODO: integration tests against a real database (per CLAUDE.md guidance); cover the methods from the port -->

## Example

<!-- TODO: full annotated example of one EF Core repository adapter with mapping and one integration test -->
