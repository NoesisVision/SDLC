# Sales — Order Placement design draft

## Bounded Context

The **Sales** bounded context owns order placement and pricing. It exposes one
public command — `PlaceOrder` — and emits `OrderPlaced` once the order is
accepted.

## Modules

- `Sales.Orders` — the order lifecycle plus pricing rules.

## Building blocks

### Order (aggregate)

Holds the order lifecycle. Properties:

- `id: OrderId` — opaque identifier.
- `customerId: CustomerId`
- `total: Money`

Behaviours:

- `PlaceOrder` (Command, public) — accepts an `OrderId` and a list of items,
  computes the total via `PricingPolicy`, and emits `OrderPlaced`.
  Rule: total must be non-negative.

### PricingPolicy (domain service)

Computes order totals and applies discounts.

Rule: `NonNegativePrice` — every line price after discount must be ≥ 0. This
prevents the negative-subtotal bug observed last month.

Scenario: when a 100% promo is applied to a subtotal of 50, the resulting
total is exactly 0 (not negative).
