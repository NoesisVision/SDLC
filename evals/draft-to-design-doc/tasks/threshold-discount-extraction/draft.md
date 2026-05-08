# Threshold-activated percentage discount

Author: Sales Product Team + Architecture
Date: 2026-05-07
Status: Draft for review

## Background

Our sales reps already have two ways to grant discounts on a single product:

- **Percentage discount** — e.g. 10% off, applied to any price.
- **Value discount** — e.g. 50 PLN off, capped at the price (never goes negative).

Both live in `Sales.DeepModel.Pricing.Discounts` as immutable value objects, and they are exposed to the rest of the system through a single `Discount` discriminated-union type (so callers don't have to know which variant they hold).

A percentage discount applies regardless of the underlying price. Reps have been complaining that this is too blunt for premium products: a 10% promotion on a 50-PLN accessory doesn't move the needle, but the same promo on a 600-PLN device is a real margin hit. They want a discount type that **only kicks in once the price clears a certain bar** — below that bar, the customer pays the original price.

## Business requirement

Add a third kind of discount: a **threshold-activated percentage discount**.

It carries two parameters:

- a **percentage** (same shape as in `PercentageDiscount`),
- a **price threshold** (a `Money` amount that the price must *exceed* to activate).

Behaviour when applied to a price:

- if the price is **above** the threshold → return the price reduced by the percentage,
- if the price is **at** the threshold or **below** it → return the price unchanged.

The new discount must be usable everywhere the existing `Discount` type is used today — no new caller, no parallel union, no separate wiring. From the outside, a `Discount` should now have three variants instead of two.

## Worked examples

| Price | Threshold | Percentage | Result | Why |
|---|---|---|---|---|
| 600 PLN | 500 PLN | 10% | 540 PLN | price > threshold → discount applies |
| 500 PLN | 500 PLN | 10% | 500 PLN | price == threshold → no discount (strict greater-than) |
| 300 PLN | 500 PLN | 10% | 300 PLN | price < threshold → unchanged |
| 1000 PLN | 0 PLN | 25% | 750 PLN | any positive price clears a 0 threshold |

## Acceptance criteria

1. The `Discount` discriminated union has a **third variant**. Existing call sites that build a percentage or value discount keep working unchanged — no breaking change to their public surface.
2. `Discount.ApplyOn(price)` dispatches correctly to the new variant.
3. Construction of the new variant is **fail-fast**: an instance with a percentage outside the legal range, or with a non-positive threshold, cannot exist.
4. Existing `PercentageDiscount` and `ValueDiscount` are **not modified** — their behaviour and tests stay green.
5. Tests cover at minimum: above-threshold, at-threshold (boundary), below-threshold, zero-price, factory rejection on invalid percentage, factory rejection on non-positive threshold, equality of two equivalent instances.

## Architectural decisions

These were resolved during the design review on 2026-05-06. They are not up for re-debate during implementation; if a constraint conflicts with one of them, escalate.

### A1. New value object: `ThresholdDiscount`

A new Building Block in the `Sales.DeepModel.Pricing.Discounts` module. Type: **value object**, mirroring the shape of `PercentageDiscount` and `ValueDiscount`:

- C# `readonly struct` annotated with `[DddValueObject]`.
- Implements the existing `PriceModifier` interface (provides `ApplyOn(Money price)`).
- Implements `IEquatable<ThresholdDiscount>`, with `Equals(object?)`, `GetHashCode()`, and a sensible `ToString()` consistent with the two existing discount value objects.
- Internal state is **two private fields**: a `Percentage` and a `Money` threshold. No public getters — equality, application and `ToString` are the only externally observable behaviours.
- Construction goes through a **static factory method** (`Of(Percentage value, Money threshold)`, mirroring `PercentageDiscount.Of` and `ValueDiscount.Of`). The constructor is private. The factory enforces the invariant from §A4.

### A2. `ApplyOn(Money price)` semantics

`ApplyOn` returns:

- `price * (Percentage.Of100 - percentage)` when `price > threshold`,
- `price` otherwise.

The `>` comparison is **strict** (price equal to threshold returns `price` unchanged). This matches the worked examples and the way reps describe the rule ("the price has to *exceed* the threshold").

### A3. `Discount` union — third variant

The `Discount` discriminated union in `Discount.cs` is **modified**, not replaced or paralleled:

- A new private discriminator state must be introduced. The current `bool _isPercentage` is no longer sufficient; replace it with a small enum-like discriminator (e.g. a private nested enum or three named constants) so that the three cases are exhaustively distinguishable inside `ApplyOn`. Keep the field private.
- Add a third field `private readonly ThresholdDiscount _thresholdDiscount;` next to the two existing variant fields.
- Add a public static factory `Discount.Threshold(Percentage value, Money threshold)`, mirroring `Discount.Percentage(...)` and `Discount.Value(...)`.
- `ApplyOn(Money price)` dispatches on the discriminator across all three branches.
- `Equals`, `GetHashCode` and `ToString` continue to cover all three variants.
- The two existing factory methods (`Discount.Percentage`, `Discount.Value`) keep their signature exactly as today — call sites must not need any change.

### A4. Construction invariants

`ThresholdDiscount.Of(Percentage value, Money threshold)` rejects invalid inputs at construction time:

- `value` outside `[0%, 100%]` → reject (this validation already lives in the `Percentage` value object; rely on it, do not duplicate).
- `threshold` non-positive (≤ zero in its currency) → reject with a clear domain error indicating the threshold must be strictly positive.

Apply-time code does **not** re-validate. The factory is the only invariant gatekeeper.

### A5. Persistence

The SQL repository in `Sales.Adapters/Pricing/Discounts/DiscountsSqlRepository.cs` already round-trips the `Discount` union. Extend it minimally to handle the third variant — same shape of change as the two existing variants. No schema migration is in scope of this draft (the storage representation is whatever the repository today maps onto; if the existing serialisation is shape-flexible enough, no DB change is needed).

### A6. Out of scope

- Multi-product / cart-level threshold discounts (this is per single product price).
- Time-bounded promotions (a discount valid only in a date range).
- Stacking rules between discount types — unchanged.
- Renaming or refactoring the existing `PercentageDiscount`, `ValueDiscount`, or the `Discount` discriminator field.
