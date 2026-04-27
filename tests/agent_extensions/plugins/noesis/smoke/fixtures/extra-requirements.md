# Bulk discount addendum

The Sales bounded context must support **bulk discounts** in addition to the
existing flat-percentage promos.

A bulk discount is a tiered rule:

- `minQty` — the minimum order quantity to activate the tier.
- `percentage` — the discount applied to that tier and above.

Tiers are monotone: a higher quantity must never produce a smaller discount
(`TierMonotonicity` rule).

Bulk discounts are applied by `PricingPolicy` during `PlaceOrder`, after the
existing non-negative-price check.

## Actor

`PricingAdmin` — back-office user who configures discount tiers.
