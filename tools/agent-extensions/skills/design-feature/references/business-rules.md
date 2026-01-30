# Business Rules Pattern Catalog

## Constraint Patterns

### Structural Contract
Shape rules for domain artifacts so invalid forms are unrepresentable.  
- **Applies to:** `ValueObject`, `Entity`, `Aggregate`, `Command`, `Event`, `Query`  
- **Examples:** `FlightSegment` needs `DepartureAirportCode/ArrivalAirportCode/DepartureDate/AirlineCode`; `Address` needs `Street/City/PostalCode/CountryCode`; `PublishArticle` command needs `ArticleId/Title/Body`; `PaymentCaptured` event needs `PaymentId/OrderId/Amount/Currency/OccurredAt`  
- **Quick check:** Does the rule safeguard mandatory fields or formats so malformed instances become nonsensical?

### Validations
Semantic invariants on state (cardinality, ranges, dependencies, temporal overlaps).  
- **Applies to:** `ValueObject`, `Entity`, `Aggregate`, `Command`, `Event`, `Query`  
- **Examples:** departure airport != arrival airport; price intervals never overlap; if card payments is selected card number is required; inventory never negative  
- **Quick check:** Is violation detectable from the object's data alone and worth enforcing via code or DB constraint?

## Computed Rule Patterns

### Calculation
Deterministic, side-effect-free formulas that yield numeric or structured results. Capture inputs, outputs (name/type/units/precision), representation (expression or code), rounding/defaulting/null handling, governance (tech vs. business), tests, and optional effective dating.  
- **Applies to:** value objects, domain services, DMN boxed expressions  
- **Examples:** prorated fee = price × remainingDays/periodDays; ETA = departure + duration + layovers; loyalty points = floor(amount/10) with rounding  
- **Quick check:** Is it best expressed as a pure function where units and precision dominate concerns?

### Categorization
Deterministic mapping from conditions to a single outcome in a finite set, often in a decision table with a hit policy. Record inputs, outcome codes, representation, hit policy (UNIQUE/FIRST/ANY/COLLECT/PRIORITY), completeness and defaults, tie-breakers, governance, versioning/effective dating, audit rationale, and test coverage (no overlap, regression).  
- **Applies to:** domain services, policies/specifications, DMN decision tables  
- **Examples:** risk tier bands; shipping method by weight/dimensions; eligibility by age/residency; approval flag by amount/product  
- **Quick check:** Are we selecting from named outcomes where business thresholds change and traceability matters?

## Obligation Patterns

### State-Change
Guards that allow or forbid a single operation on a long-lived entity at a moment in time, possibly with temporal windows. Document target action, triggering command, guard reference (predicate or computed rule), temporal constraints with clock source, effect (`forbid`/`require`), enforcement point (aggregate or app service), audit/sanctions, and command-level tests.  
- **Applies to:** aggregates, application services  
- **Examples:** block workspace archive when invoices open; no seat change after check-in; forbid wire transfer if beneficiary on sanctions list  
- **Quick check:** Does it gate a single transition that would otherwise produce a valid state?

### Process-Flow
Routing or termination rules steering multi-step processes; often driven by categorization outcomes and executed in workflows or sagas. Capture process target, trigger (event/decision/timer), route options and termination conditions, decision reference, SLAs/timers/retries, compensation steps, scope (cross aggregates/services), enforcement mechanism, and end-to-end tests.  
- **Applies to:** workflows, sagas, process managers, cross-service orchestration  
- **Examples:** KYC fail terminates onboarding else fund; refunds over €1,000 trigger manager review else auto-refund; on payment capture issue license, on failure retry then escalate  
- **Quick check:** Does it choose the next step (or stop) across multiple steps or services with timing or compensation needs?
