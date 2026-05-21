# Idea-Unit Catalog — gold reference

Conversation id: `2c4ba4b1-d85d-6389-0452-e26f10c9de66`
Source: the prepared `cleaned.md` for `transcript.md` (26 turns, indices 0–25).

This is the per-turn gold split of idea units, with the expected `categories` and the
rationale. It is the reference for the **idea_unit_categorization** dimension. Sentence
text is exactly as segmented by the prepare script (do not re-segment).

Notation: `T<turn>:IU<n>` — turn index : idea-unit index (idea-unit indices restart at 0 per turn).
"→ no topic" means the unit is `Irrelevant` and must NOT appear in any topic's `items`.

---

## T0 — Maya 00:00:00
- **IU0** = sentences 0–2 ("Morning everyone." / "Can you all hear me?" / "My headset was acting up yesterday.")
  - categories: `["Irrelevant"]` — greeting + audio check, no system content. → no topic

## T1 — Tom 00:00:12
- **IU0** = sentences 0–1 ("Yeah, you come through fine." / "Let's give Priya a minute, she pinged that she's grabbing coffee.")
  - categories: `["Irrelevant"]` — audio ack + scheduling. The "Yeah" is a transitional
    interjection merged into the unit, not standalone. → no topic

## T2 — Dev 00:00:25
- **IU0** = sentences 0–1 ("No rush." / "The weather is finally decent today, first sun in a week.")
  - categories: `["Irrelevant"]` — social filler. → no topic

## T3 — Priya 00:00:40
- **IU0** = sentence 0 ("I'm here, sorry.")
  - categories: `["Irrelevant"]` — arrival pleasantry. → no topic
- **IU1** = sentences 1–2 ("Okay, so the topic today is the pickup-code lifecycle for the parcel lockers." / "We need to nail down expiry and what happens on repeated failed attempts.")
  - categories: `["Information"]` — frames the meeting subject. The "Okay" is a transitional
    interjection merged in. Belongs to the **Pickup-Code Lifecycle** container topic.

## T4 — Maya 00:01:05
- **IU0** = sentence 0 ("Right.")
  - categories: `["Irrelevant"]` — bare acknowledgement, no content, isolated. → no topic
- **IU1** = sentences 1–3 ("Let's frame the scope first." / "A pickup code is the short numeric code a customer types on the locker keypad to open their compartment." / "We're deciding how long that code stays valid and how the system reacts when someone keeps entering it wrong.")
  - categories: `["Information"]` — domain definition + scope. Belongs to the
    **Pickup-Code Lifecycle** container topic.

## T5 — Tom 00:01:40
- **IU0** = sentences 0–2 ("On storage: the simplest thing is to store the code in Redis with a TTL equal to the validity window." / "When the TTL elapses the key just disappears and the code is dead." / "No cleanup job, Redis handles eviction for us.")
  - categories: `["Position","Argument"]` — proposes the Redis-TTL storage approach and
    argues for it (no cleanup job). This is the option later **overturned** → it is the
    alternative in the storage decision, not the decision. Topic: **Code Storage & Persistence**.

## T6 — Priya 00:02:10
- **IU0** = sentences 0–1 ("That's attractive operationally." / "Does it cover the case where support needs to see why a customer's code stopped working?")
  - categories: `["Position","Argument"]` — concedes appeal, raises the auditability concern
    that drives the decision. Topic: **Code Storage & Persistence**.

## T7 — Maya 00:02:30
- **IU0** = sentences 0–2 ("That's exactly my concern." / "If the code only lives in Redis and then evaporates, we have no record that the code ever existed once it expires." / "Support gets a ticket two days later and there's nothing to look at, no expiry timestamp, no audit trail.")
  - categories: `["Argument"]` — argues against pure-Redis: loss of audit record.
    Topic: **Code Storage & Persistence**.

## T8 — Tom 00:03:05
- **IU0** = sentences 0–1 ("Hm." / "We could mirror it into a log line, but that's a side channel nobody will trust as the source of truth.")
  - categories: `["Position","Argument"]` — the "Hm." is a transitional interjection merged
    in; the unit floats and rejects a log-mirror sub-option. Topic: **Code Storage & Persistence**.

## T9 — Maya 00:03:25
- **IU0** = sentence 0 ("Because we need an auditable history of every code and exactly when it expired, we'll persist the pickup code and its expiry timestamp in the Postgres pickup_code row.")
  - categories: `["Argument","Decision"]` — **dual-category**: an argument that lands on the
    storage decision (Postgres authoritative). This is the final decision unit.
    Topic: **Code Storage & Persistence**.
- **IU1** = sentence 1 ("Redis stays purely as a hot-path cache for the validity check, not the source of truth.")
  - categories: `["Decision"]` — completes the decision (Redis demoted to cache).
    Topic: **Code Storage & Persistence**.

## T10 — Tom 00:03:55
- **IU0** = sentence 0 ("Yes.")
  - categories: `["Irrelevant"]` — **acknowledgement-token trap**: a bare standalone "Yes."
    right after Maya's committed decision in T9. It carries no content of its own; the
    load-bearing commitment is T9. It is NOT a Decision and gets → no topic.

## T11 — Priya 00:04:10
- **IU0** = sentence 0 ("Good.")
  - categories: `["Irrelevant"]` — bare acknowledgement, isolated. → no topic
- **IU1** = sentences 1–2 ("So Postgres is authoritative, Redis is the cache." / "That settles storage.")
  - categories: `["Information"]` — restates the settled decision (closure summary).
    Topic: **Code Storage & Persistence**.

## T12 — Dev 00:04:30
- **IU0** = sentences 0–1 ("Quick one while I'm thinking about it -- there's a separate cross-cutting rule we keep coming back to: every state change on a pickup code, issued, used, expired, locked, has to be written to the audit trail." / "That's not specific to storage, it applies everywhere we touch a code.")
  - categories: `["Position"]` — introduces a cross-cutting auditing rule that belongs to
    NO single child. This is the unit that makes **Pickup-Code Lifecycle** a *hybrid*
    topic (it owns this cross-cutting IU in addition to having child topics).

## T13 — Maya 00:05:00
- **IU0** = sentence 0 ("Agreed, treat that as a general rule over the whole code lifecycle, not something owned by one part.")
  - categories: `["Position"]` — affirms the cross-cutting rule scope. The "Agreed" is part
    of the substantive statement, not a standalone token. Topic: **Pickup-Code Lifecycle** (hybrid own-IU).
- **IU1** = sentences 1–2 ("Now, the retry behaviour." / "What do we do when a customer fumbles the code?")
  - categories: `["Information"]` — opens the retry sub-topic. Topic: **Retry & Lockout Policy**.

## T14 — Tom 00:05:30
- **IU0** = sentences 0–2 ("I'd say three attempts." / "After the third wrong entry we lock that compartment slot and notify support so a human can step in." / "Three is the usual ceiling and it stops brute forcing.")
  - categories: `["Position","Argument"]` — proposes the 3-attempt lockout and argues for
    it. Converges immediately (no counter-proposal). Topic: **Retry & Lockout Policy**.

## T15 — Priya 00:05:55
- **IU0** = sentence 0 ("Three then lock and notify support works for me. No objections from product.")
  - categories: `["Position"]` — product agreement with substantive content (not a bare
    token). Topic: **Retry & Lockout Policy**.

## T16 — Maya 00:06:10
- **IU0** = sentence 0 ("Then that's decided: three failed attempts, lock the slot, push a notification to the support queue.")
  - categories: `["Decision"]` — the retry decision, cleanly accepted, no alternatives.
    Topic: **Retry & Lockout Policy**.
- **IU1** = sentence 1 ("No alternative on the table, it's clean.")
  - categories: `["Information"]` — explicitly notes there were no alternatives.
    Topic: **Retry & Lockout Policy**.

## T17 — Dev 00:06:35
- **IU0** = sentence 0 ("So just to be sure I wire the guard correctly -- we hard-fail and lock on the third attempt, we don't give a grace retry after a delay?")
  - categories: `["Position"]` — a clarifying yes/no question that pins down the decision's
    edge (no grace retry). Topic: **Retry & Lockout Policy**.

## T18 — Maya 00:06:50
- **IU0** = sentence 0 ("Yes.")
  - categories: `["Decision"]` — **acknowledgement-token trap, opposite case**: here the
    standalone "Yes." IS the load-bearing answer to Dev's yes/no question in T17 (confirms
    hard-fail, no grace retry). It is kept as its own idea unit and carries `Decision`
    because the next speaker depends on it. Topic: **Retry & Lockout Policy**.

## T19 — Priya 00:07:05
- **IU0** = sentences 0–1 ("Last open item: the actual validity duration." / "Is a code good for 24 hours or 48?")
  - categories: `["Information"]` — opens the unresolved duration question.
    Topic: **Code Validity Duration**.

## T20 — Tom 00:07:20
- **IU0** = sentences 0–2 ("Lockers in transit hubs get picked up fast, 24 is plenty." / "But residential lockers in low-traffic areas, people sometimes come on the weekend." / "48 is safer there.")
  - categories: `["Position","Argument"]` — argues both sides, no commitment.
    Topic: **Code Validity Duration**.

## T21 — Maya 00:07:45
- **IU0** = sentences 0–1 ("I lean 48 across the board for simplicity, one number is easier to reason about than per-locker tuning." / "But I don't want to commit until ops confirms the compartment occupancy impact of holding slots for two days.")
  - categories: `["Position","Argument"]` — leans 48 but explicitly refuses to commit
    (this is why the decision status is `proposed`, not `accepted`).
    Topic: **Code Validity Duration**.

## T22 — Priya 00:08:10
- **IU0** = sentences 0–2 ("Let's leave duration open then." / "Tentatively 48, pending the ops occupancy review." / "We'll confirm next week.")
  - categories: `["Decision"]` — a *proposed* (non-converged) decision: tentatively 48,
    pending review. Status `proposed`. Topic: **Code Validity Duration**.

## T23 — Dev 00:08:30
- **IU0** = sentence 0 ("Sounds good.")
  - categories: `["Irrelevant"]` — bare acknowledgement, isolated. → no topic
- **IU1** = sentence 1 ("I'll prototype the expiry job assuming a configurable window so we're not blocked on the exact number.")
  - categories: `["Information"]` — implementation note that the window will be
    configurable. Topic: **Code Validity Duration**.

## T24 — Maya 00:08:50
- **IU0** = sentences 0–3 ("Perfect." / "That's everything." / "I'll write this up." / "Thanks all, talk next week.")
  - categories: `["Irrelevant"]` — closing pleasantries. → no topic

## T25 — Tom 00:09:00
- **IU0** = sentence 0 ("Thanks, bye.")
  - categories: `["Irrelevant"]` — sign-off. → no topic

---

## Acknowledgement-token traps (the crux of this dimension)

| Unit | Text | Verdict | Why |
|------|------|---------|-----|
| T10:IU0 | "Yes." | `Irrelevant`, no topic | Bare ack after a decision already stated in T9. Load-bearing content is T9, not here. |
| T18:IU0 | "Yes." | `Decision`, on Retry topic | Standalone, but it IS the answer to Dev's yes/no question in T17 — the next step depends on it. Kept as its own IU and carries Decision. |
| T1:IU0 "Yeah,…" / T3:IU1 "Okay,…" / T4:IU1 / T13:IU0 "Agreed,…" | leading interjection | merged into the surrounding substantive IU | Transitional interjection with following content — never a standalone unit. |
| T4:IU0 "Right." / T11:IU0 "Good." / T23:IU0 "Sounds good." | bare token | `Irrelevant`, no topic | Isolated acknowledgement, no following content in the same idea, not answering a yes/no question. |
