# Phase 4: Cross-cutting Verification

## Step 1: Compile

```bash
dotnet build [project-path]
```

If build fails, fix errors directly. Common causes:
- Missing `using` statements
- Type name mismatches between files
- Missing base class or interface implementations
- Circular dependencies between aggregates (indicates a boundary problem — fix the design, not just the reference)

Do not proceed to tests until the build is clean.

## Step 2: Run Tests

```bash
dotnet test [test-project-path] --filter "FullyQualifiedName~Domain"
```

If tests fail:
- Fix the implementation, not the test — tests encode invariants from the sketch
- Exception: if a test has a mechanical error (wrong method name, setup bug), fix the test
- If a test reveals a genuine design issue, fix the design and note it

## Step 3: Domain Integrity Review

Single pass through all generated files. Check each item below. If any check fails, fix the code immediately — do not produce a report to fix later.

### Invariant Coverage

For every invariant listed in the sketch:
- [ ] There is enforcement code in exactly one place (aggregate root method or domain service)
- [ ] There is at least one test that exercises the invariant
- [ ] The invariant cannot be bypassed through public API (no public setter that skips validation)

### Aggregate Isolation

For every aggregate:
- [ ] Does not hold an object reference to another aggregate (only IDs)
- [ ] Does not call methods on another aggregate directly
- [ ] Does not expose its internal collections as mutable (returns IReadOnlyCollection or similar)
- [ ] Child entities are not accessible except through the aggregate root's methods

### Encapsulation

For every entity and aggregate root:
- [ ] No public setters for properties that represent state modified through behaviors
- [ ] Constructor or factory method validates required fields
- [ ] State changes happen through named methods, not property assignment

### Anemic Model Detection

For every entity and aggregate root:
- [ ] Has at least one method with business logic (not just getters/setters)
- [ ] Invariant enforcement lives inside the class, not in an external service
- [ ] If a class has only properties and no behavior, it should probably be a value object

### Value Object Correctness

For every value object:
- [ ] Implements value equality (record type, or overrides Equals/GetHashCode)
- [ ] Is immutable (no public setters, readonly fields or init-only properties)
- [ ] Validates its own constraints in the constructor (e.g., negative amounts, empty strings)

### Domain Event Completeness

For every domain event in the sketch:
- [ ] Event class exists with appropriate properties
- [ ] Is emitted from the correct aggregate method
- [ ] Carries enough data for consumers (at minimum: aggregate ID, timestamp, key state)

## Step 4: Summary

Write a brief summary (one short paragraph, not a report). Cover:
- How many classes were generated (aggregates, entities, VOs, services, events)
- Key design decisions that affect future work
- Anything the user should pay attention to (e.g., "the AvailabilityChecker service assumes synchronous aggregate loading — if you use eventual consistency, this needs adjustment")
- Suggest next steps if applicable (e.g., "repository implementations, application service layer, integration tests")

Do not repeat what the code already says. Do not list every file generated. The user can see the files.
