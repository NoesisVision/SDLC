# Expected Topic Tree — gold reference

Conversation id: `2c4ba4b1-d85d-6389-0452-e26f10c9de66`
Reference for the **topic_tree_correctness** dimension.

Topic ids are non-deterministic (`generate_topic_ids` → UUID v7), so topics here
are keyed by **title path**, not id. The judge matches on title + parent path +
shape + item set, never on the literal id.

## Pre-seeded graph state (already in /app/noesis/ before the agent runs)

```
[ROOT, seeded]  "Parcel Locker Platform"        id = 11111111-1111-7111-8111-111111111111
  └─ [leaf, seeded] "Locker Hardware"           id = 22222222-2222-7222-8222-222222222222
```

`Parcel Locker Platform` is a deliberately broad existing root. Step 2 (Goldilocks)
must find it via `list_topics`, judge it "too broad but the right parent", drill into
its child `Locker Hardware`, find that child does NOT cover pickup codes, and therefore
**reuse the root** (`is_new: false`, keep its id) while attaching NEW children under it.
`Locker Hardware` is irrelevant to this conversation and must NOT receive any items.

## Expected tree after analysis

```
"Parcel Locker Platform"                      [REUSED root, is_new:false, id kept = 1111...]
├─ "Locker Hardware"                          [seeded, untouched, is_new:false, no new items]
└─ "Pickup-Code Lifecycle"                    [NEW, is_new:true, parent = Parcel Locker Platform]
   │                                           SHAPE: hybrid
   │   own items (cross-cutting, belong to no single child):
   │     T3:IU1, T4:IU1, T12:IU0, T13:IU0
   ├─ "Code Storage & Persistence"            [NEW, is_new:true, parent = Pickup-Code Lifecycle]
   │     SHAPE: leaf
   │     items: T5:IU0, T6:IU0, T7:IU0, T8:IU0, T9:IU0, T9:IU1, T11:IU1
   │     decision: storage (final = Postgres; alternative = Redis-TTL)
   ├─ "Retry & Lockout Policy"                [NEW, is_new:true, parent = Pickup-Code Lifecycle]
   │     SHAPE: leaf
   │     items: T13:IU1, T14:IU0, T15:IU0, T16:IU0, T16:IU1, T17:IU0, T18:IU0
   │     decision: 3-attempt lockout (accepted, no alternatives)
   └─ "Code Validity Duration"               [NEW, is_new:true, parent = Pickup-Code Lifecycle]
         SHAPE: leaf
         items: T19:IU0, T20:IU0, T21:IU0, T22:IU0, T23:IU1
         decision: validity duration (proposed, not converged)
```

### Shape rationale

- **`Parcel Locker Platform`** — container (seeded). After analysis it gains a new child
  subtree but owns no idea units itself. `is_new: false`, id unchanged. Its
  `short_summary`/`long_summary` may be regenerated to fold in the new child.
- **`Pickup-Code Lifecycle`** — **hybrid**. It owns the framing/scope units (T3:IU1,
  T4:IU1) and the cross-cutting audit rule (T12:IU0, T13:IU0) that belongs to no single
  child, AND it has three child leaves. This is the one legitimate hybrid: the audit rule
  applies across storage, retry and duration, so it cannot be pushed into any one child.
- **`Code Storage & Persistence`**, **`Retry & Lockout Policy`**, **`Code Validity
  Duration`** — leaves. Each owns its own discussion units and exactly one decision.

### Hard constraints (deterministically checkable by test.sh, semantically by judge)

1. **Exactly one root** in the conversation's contribution: the reused
   `Parcel Locker Platform` (parent_id null). No second root. (Creating a fresh root
   instead of reusing the seeded one is the main failure mode → low score.)
2. `Parcel Locker Platform` has `is_new: false` and its original seeded id
   `11111111-1111-7111-8111-111111111111`. Same for `Locker Hardware`
   (`22222222-2222-7222-8222-222222222222`), which gets no new items.
3. First-level breadth under the root ≤ 10 (here: 2 — `Locker Hardware`,
   `Pickup-Code Lifecycle`).
4. Every non-`Irrelevant` idea unit appears in **exactly one** topic's `items`.
   Every `Irrelevant` idea unit appears in **no** topic. (Irrelevant set:
   T0:IU0, T1:IU0, T2:IU0, T3:IU0, T4:IU0, T10:IU0, T11:IU0, T23:IU0, T24:IU0, T25:IU0.)
5. `parent_id` of every new topic resolves to another topic in `conversation.topics[]`
   (or to the seeded root id). No cycles, no dangling parent_id.
6. All topics `reviewed: true` and `decisions_extracted: true` after Step 4.

### Acceptable variation (do not penalize)

- Splitting `Code Storage & Persistence` into a parent + a `Redis caching layer` child
  is acceptable if the decision and items stay coherent.
- Folding T11:IU1 (closure restatement) into a slightly different topic is acceptable.
- Title wording may differ ("Code Expiry & Storage" vs "Code Storage & Persistence")
  as long as scope matches.
- Putting the framing units (T3:IU1, T4:IU1) on the root instead of `Pickup-Code
  Lifecycle` is acceptable. What is NOT acceptable: creating a brand-new root, leaving a
  container with empty summaries, or scattering the cross-cutting audit rule into a leaf.
