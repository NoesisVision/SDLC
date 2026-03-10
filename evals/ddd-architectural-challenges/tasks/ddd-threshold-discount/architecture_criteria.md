# Architecture Criteria: Threshold Discount

Evaluate the AI-generated code across four dimensions. Each dimension is scored 0–25 points.

## 1. DDD Pattern Compliance (0–25)

Evaluate how well the ThresholdDiscount follows DDD patterns established by PercentageDiscount and ValueDiscount.

| Score | Criteria |
|-------|----------|
| 0     | No ThresholdDiscount type exists, or it is a plain class with mutable state |
| 5     | ThresholdDiscount exists but is a class (not a value object), or misses key DDD traits |
| 10    | ThresholdDiscount is a `readonly struct` but lacks proper equality (no `IEquatable<T>`) or factory method |
| 15    | ThresholdDiscount is a `readonly struct` with `IEquatable<T>`, but missing factory method or validation |
| 20    | ThresholdDiscount is a `readonly struct`, implements `IEquatable<T>`, has factory method, validates inputs (percentage 0–100, threshold > 0), but minor issues (e.g. missing `GetHashCode` override, inconsistent naming) |
| 25    | ThresholdDiscount is a `readonly struct`, implements `IEquatable<T>`, has static factory method (`Create` or `Of`), validates all inputs, overrides `Equals`/`GetHashCode`/`==`/`!=`, is fully immutable — matches quality of existing value objects |

**Key checks:**
- Is it a `readonly struct`?
- Does it implement `IEquatable<ThresholdDiscount>`?
- Does it have a static factory method (not just public constructor)?
- Are fields `readonly` / init-only?
- Does it validate percentage (0–100) and threshold (> 0)?

## 2. Discriminated Union Integration (0–25)

Evaluate how ThresholdDiscount is integrated into the existing `Discount` discriminated union.

| Score | Criteria |
|-------|----------|
| 0     | Discount union not modified, or ThresholdDiscount used standalone |
| 5     | Discount union modified but existing variants broken (PercentageDiscount/ValueDiscount changed or removed) |
| 10    | Third variant added to Discount but `Apply`/`Match` methods missing or incomplete |
| 15    | Third variant added, `Apply` works, but `Match`/pattern matching not updated — callers can't distinguish all three |
| 20    | Full integration: third variant, `Apply` correct, `Match` updated, but minor issues (e.g. missing XML docs, inconsistent with existing style) |
| 25    | Seamless integration: third variant in Discount, `Apply` method correct, `Match`/`Switch` patterns updated, all existing callers compile, no breaking changes, consistent XML documentation |

**Key checks:**
- Does `Discount` have a third case/variant for ThresholdDiscount?
- Does `Apply(Money price)` return correct result (apply only when price > threshold)?
- Are pattern matching methods (`Match`, `Switch`, or C# pattern match) updated?
- Do existing PercentageDiscount and ValueDiscount cases still work unchanged?
- Are there any breaking changes to the public API?

## 3. Code Conventions & Style (0–25)

Evaluate adherence to the project's existing code conventions.

| Score | Criteria |
|-------|----------|
| 0     | Files in wrong location, wrong namespace, completely different style |
| 5     | Correct directory but wrong namespace, or significant style deviations |
| 10    | Correct location and namespace, but naming inconsistencies (e.g. `ThresholdPercentageDiscount` vs project convention) |
| 15    | Good location, namespace, naming, but missing XML documentation or inconsistent formatting |
| 20    | Follows conventions well: correct namespace (`Sales.DeepModel.Pricing.Discounts`), file in `Discounts/` directory, proper naming, XML docs present but minor style differences |
| 25    | Perfect convention adherence: namespace, directory, file naming, XML doc style, `using` order, bracket style, all match existing code exactly |

**Key checks:**
- File placed in `Sources/Sales/Sales.DeepModel/Pricing/Discounts/`?
- Namespace is `Sales.DeepModel.Pricing.Discounts`?
- Naming follows existing pattern (PascalCase, consistent with PercentageDiscount/ValueDiscount)?
- XML documentation present and follows existing style?
- Code formatting matches (braces, spacing, using directives order)?

## 4. Test Quality (0–25)

Evaluate the quality and coverage of tests for ThresholdDiscount.

| Score | Criteria |
|-------|----------|
| 0     | No tests written |
| 5     | One or two basic tests, no edge cases |
| 10    | Tests exist for basic apply logic but miss edge cases (at-threshold, zero price, boundary) |
| 15    | Good coverage of apply logic including threshold boundary, but missing equality tests or factory validation tests |
| 20    | Comprehensive: apply above/below/at threshold, factory validation, equality checks, but minor issues (e.g. not following existing test naming convention, missing some boundary) |
| 25    | Excellent: tests cover apply (above, below, at threshold, zero), factory validation (invalid percentage, negative threshold), equality/inequality, follows existing test class structure and naming conventions exactly |

**Key checks:**
- Tests for: price above threshold (discount applies), price below threshold (no discount), price exactly at threshold (no discount)?
- Tests for factory validation (invalid percentage, zero/negative threshold)?
- Tests for value object equality?
- Test file location mirrors source structure?
- Test naming convention matches existing tests (e.g. `Should_...`, `When_...`, `[Fact]`/`[Theory]`)?
