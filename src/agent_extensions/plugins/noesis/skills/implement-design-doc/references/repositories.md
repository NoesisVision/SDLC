# Repository Port Implementation (C#)

Loaded by the subagent that implements `repository` Building Blocks at Step 4. This file covers the **port** (interface in the domain layer). The infrastructure-side adapter is implemented in Step 5 — see `repository-adapters.md`.

## Responsibilities

<!-- TODO: collection-like access to one aggregate; intent-revealing methods; hides storage details -->

## Interface shape

<!-- TODO: interface naming, method signatures (Add / GetById / Find... by domain criteria); async patterns; cancellation tokens -->

## Methods

<!-- TODO: each Behaviour from the design doc maps to one interface method; return aggregates fully formed; no leaking storage types -->

## Rules

<!-- TODO: this layer carries no business rules; rules live on the aggregate -->

## Tests

<!-- TODO: ports themselves are not unit-tested; adapter tests live in repository-adapters.md -->

## Example

<!-- TODO: full annotated example of one repository port -->
