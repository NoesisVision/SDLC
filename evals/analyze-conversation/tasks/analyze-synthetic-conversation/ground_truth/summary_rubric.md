# Summary Rubric — gold reference

Reference for the **summary_quality** dimension. Per topic: what `short_summary`
and `long_summary` MUST contain and MUST NOT do. Wording is the agent's; the
substance below is the bar.

General rules (from the skill REFERENCE, enforced here):
- `short_summary` ≤ 3 sentences, search-optimized: subject + scope + distinguishing aspect.
- `long_summary` 10–20 sentences, written as **established knowledge** for a coding agent
  preparing a design doc. Cover requirements, design decisions + rationale, domain
  concepts, system behaviour.
- **No meeting-narration**: must not contain "the team discussed", "X proposed",
  "participants agreed", "in the meeting", etc. Past-tense decision wording is fine
  ("Codes are persisted in Postgres"), meeting framing is not.
- Container/hybrid summaries are synthesized from children + own units; never empty.
- Language: English (matches the transcript).

---

## "Parcel Locker Platform" (reused root, container)

- **short_summary**: must position it as the platform-level umbrella and now reference
  the pickup-code lifecycle as a covered area. Must remain broad (it still also covers
  locker hardware).
- **long_summary**: synthesized from children. Must mention both the pre-existing scope
  (locker hardware) and the new pickup-code lifecycle subtree. Must NOT be empty and
  must NOT be rewritten to be *only* about pickup codes (that would lose the seeded scope).

## "Pickup-Code Lifecycle" (hybrid)

- **short_summary**: subject = the end-to-end lifecycle of a parcel-locker pickup code
  (issue → validity → expiry → retry/lockout); distinguishing aspect = the cross-cutting
  rule that every code state change is audited.
- **long_summary** must cover:
  - **Domain concept**: a pickup code is the short numeric code a customer enters on the
    locker keypad to open their compartment.
  - **Cross-cutting rule**: every state change of a pickup code (issued, used, expired,
    locked) must be written to the audit trail; this applies across storage, retry and
    duration, not to one component.
  - A synthesis of the three child areas (storage, retry/lockout, validity duration).
  - Written as established knowledge, not "Dev raised a rule".

## "Code Storage & Persistence" (leaf)

- **short_summary**: storage model for pickup codes — Postgres authoritative, Redis cache.
- **long_summary** must cover:
  - **Decision**: the pickup code and its expiry timestamp are persisted in the Postgres
    `pickup_code` row as the source of truth; Redis is only a hot-path cache for the
    validity check.
  - **Rationale**: an auditable history of every code and its expiry is required; a
    pure-Redis TTL leaves no record after eviction so support cannot investigate.
  - **Rejected alternative**: Redis-with-TTL (operationally simple, no cleanup job) and a
    log-line mirror (untrustworthy side channel).
  - **Behaviour**: on expiry the authoritative record remains in Postgres; Redis entry
    may simply be absent/stale and is not trusted as truth.
  - Must NOT present Redis-TTL as the adopted approach.

## "Retry & Lockout Policy" (leaf)

- **short_summary**: failed-entry handling — three attempts then slot lock + support
  notification.
- **long_summary** must cover:
  - **Requirement/behaviour**: after three failed code entries the compartment slot is
    locked and a notification is pushed to the support queue for human intervention.
  - **Edge**: the third failure hard-fails; there is no grace retry after a delay.
  - **Rationale**: three is the usual ceiling and prevents brute forcing; product had no
    objections.
  - No alternatives existed (state this as fact, not "no one proposed an alternative in
    the meeting").

## "Code Validity Duration" (leaf)

- **short_summary**: pickup-code validity window — tentatively 48h, unconfirmed pending
  ops occupancy review; window is configurable.
- **long_summary** must cover:
  - **Open decision**: validity duration is not finalized; tentatively 48 hours across
    the board, pending an ops review of compartment-occupancy impact, to be confirmed.
  - **Trade-off**: 24h suits fast transit-hub lockers; 48h protects weekend collection at
    low-traffic residential lockers; a single value is simpler than per-locker tuning.
  - **Behaviour/implementation**: the expiry job treats the window as configurable so
    work is not blocked on the final number.
  - Must convey this is unresolved (proposed), not a settled decision.
