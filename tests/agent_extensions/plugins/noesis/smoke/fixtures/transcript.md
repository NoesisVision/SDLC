# Order placement and pricing — review

2026-04-15

**10:00**
Alice
Last sprint we agreed the Sales bounded context owns order placement.
The current pain point is pricing — it lives inside the Order aggregate, which makes it hard to evolve discounts without touching order rules.

**10:02**
Bob
Right. I'd like to extract a PricingPolicy as a separate building block in Sales.Orders.
That keeps Order focused on lifecycle invariants and lets us iterate on discounting independently.

**10:03**
Alice
Agreed. Let's also state explicitly that prices cannot be negative — we had a bug last month where a promo accidentally produced a negative subtotal.

**10:04**
Bob
Good call. So the decision is: introduce a PricingPolicy domain service in Sales.Orders, with a hard rule that discounted prices must remain non-negative.
The alternative we discussed — keeping pricing inline in Order — we rejected because it couples discount logic to order lifecycle.

**10:06**
Alice
On the side, I read that React 19 has new compiler features. Worth checking some day, but unrelated to today.

**10:07**
Bob
Noted, off-topic. Let's wrap on the pricing decision.
