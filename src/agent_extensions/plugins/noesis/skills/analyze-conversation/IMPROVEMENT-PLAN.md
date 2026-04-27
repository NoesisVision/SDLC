# `analyze-conversation` — Improvement Plan

Source: post-mortem after the first run of `noesis:analyze-conversation` on a real Polish sales-call transcript (`2026-02-10-cz1_short.md`). The pipeline completed successfully; the issues below are quality-of-life and correctness improvements derived from observed friction.

This document groups every reported issue with: **what the agent saw**, **root cause in code**, and the **agreed fix**. Open questions raised during the post-mortem have been resolved with the maintainer and folded into the agreed fixes. Sequencing for implementation is at the end.

---

## 1. 🟡 Documentation inconsistency in `references/extract-topics.md`

### Observed
`references/extract-topics.md:67` says:

> Overwrite `<working_dir>/conversation.json` with: ...

The actual artifact created by the prepare script is `<working_dir>/output.json`, and its shape is `{ conversation: {...}, potential_topics: {...} }` — not a bare conversation. A new agent following the reference verbatim would write the wrong file with the wrong wrapping shape.

### Root cause
- `scripts/conversation/prepare.ts:96` — `outputPath = join(workingDir, "output.json")`.
- `shared-contracts/skills/analyze-conversation/output.ts:5` — schema is `{ conversation, potential_topics }`.
- The reference doc was written before the wrapping was introduced and never updated.

The same drift appears in `references/analyze-topic.md:102` ("edit `<working_dir>/conversation.json`") and the heading on line 100 ("Updating conversation.json").

### Agreed fix
1. In `references/extract-topics.md`:
   - Replace `conversation.json` with `output.json` (line 67, file header).
   - Replace the bare-`conversation` JSON example (lines 69–99) with the wrapped shape, keeping the example **inline** (friendlier to agents — single-source-of-truth pointer alone is too indirect). Show that `topics` lives at `output.conversation.topics`, and that `potential_topics.topics` is appended to the top-level sibling key — not nested inside `conversation`.
   - Add a short cross-link to `shared-contracts/skills/analyze-conversation/output.ts` for the canonical schema, immediately after the example.
2. In `references/analyze-topic.md`:
   - Same file-name and shape correction in the "Updating conversation.json" section (lines 100–109). Topics are at `conversation.topics[]`, not `topics[]`.

---

## 2. 🟡 Container topics (no direct items) need explicit summary rules

### Observed
The agent created 4 root container topics (e.g. *Stan cenowy – koncept*, *Wycena dokumentów i okresów*) that have only subtopics, no direct idea-unit items. The skill rules don't address this case:

- `analyze-topic.md:40` — "Always regenerate both summaries from ALL idea units" — degenerates to no-op when `num_items: 0`.
- `get_topic_for_review` still returns these topics with `num_items: 0`, forcing the agent to invent empty summaries and set `reviewed: true` to escape the loop.

### Root cause
- `conversations.service.ts:74` — `getTopicForReview` picks the first topic where `!t.reviewed`, regardless of item count and of whether subtopic summaries are ready.
- `conversations.service.ts:120-126` — emits the topic with `num_items` derived from filtered details (excludes Irrelevant + dedup), but does not include any view of the topic's children.
- The skill says "leaf-level for narrow self-contained concepts" (extract-topics.md:54-56) but explicitly endorses functional-area parents that don't carry items themselves — there's no contract for what their summaries should be.

### Agreed fix
**Container topics are desirable** — they give the topic tree shape and parallel chapters in a system-design document. They must not be eliminated. Instead, define a clear summary rule and make sure the agent has the inputs it needs.

**Skill-level rule (extract-topics.md and analyze-topic.md).** Add:

> ### Summaries when a topic has subtopics
>
> A topic's summaries always cover the union of its own idea units **and** the
> material represented by its subtopics. Concretely:
>
> - **Topic with idea units, no subtopics.** Summaries come from those idea units.
> - **Topic with subtopics, no own idea units (a "container" topic).** Both
>   `short_summary` and `long_summary` are written from the children's
>   summaries — synthesise an umbrella view that names the area covered and
>   what the child topics contribute. Never leave a container's summaries
>   empty.
> - **Topic with both.** Start from the topic's own idea units, then weave in
>   the children's contributions where they extend or qualify the picture. The
>   children's summaries are context to take into account, not a separate
>   section to glue on.

**Server-level support.** `get_topic_for_review` must give the agent the children's titles and `short_summary`s so it can apply the rule above without extra round trips.

- Extend the returned Markdown with a `## Subtopics` block listing each direct child as `- **<title>** — <short_summary>`. Empty / not-yet-reviewed children render as `- **<title>** — _(pending review)_`.
- Compute the child list from `output.json:potential_topics.topics` (parent edges for `is_new` topics) plus `noesis-graph` (existing parent edges) — the same map already used by `mergeConversation`.

**Review ordering.** A parent topic's summary depends on its children's summaries. `getTopicForReview` must therefore return topics in a **post-order traversal**: leaves first, parents last. With this ordering, every container topic sees finalized child summaries by the time it is its turn.

- Implementation: build a parent map from current-conversation topics (deriving root-or-parent for each), then walk the topic forest post-order. Return the first un-reviewed topic in that order. Topics outside the current conversation's parent map (e.g. orphan reuse) fall back to declaration order at the end.

**Empty-after-filter case.** If, even with the above, a topic legitimately has no items and no children (degenerate), the loop still reaches it; the agent should remove it from `output.json:conversation.topics` and rely on the skill rule "do not create container topics without children" in `extract-topics.md`. We do **not** add an auto-skip server response — empty topics are an authoring bug, not a normal flow.

---

## 3. 🟡 Review loop chattiness is a topic-structure-quality problem

### Observed
16 topics → 16 × (`get_topic_for_review` → `Read` → `Edit`) round trips. The pain isn't the per-topic cost — it's that the resulting tree was too flat (many first-level topics) and the agent had to consider reassigning items between siblings during the review loop.

### Root cause
- `conversations.service.ts:70-127` returns one topic per call. The contract is "one step / one tool" (per `mcp/noesis-graph/CLAUDE.md` "One step → one struct → one MCP tool"); per-topic review is the right granularity for a flow that allows reassignment.
- `analyze-topic.md:32-37` — reassignment is explicitly conditional ("ONLY when the mismatch is clear AND another existing topic in `potential_topics.json` is a better match"). It is rare but real, and on a mature graph where many conversations contribute to the same topic it will become more common.
- `references/extract-topics.md:50-63` — current hierarchy guidance is brief ("aim for 3–7 children per parent", "depth over breadth") and doesn't enforce hierarchy hygiene at Step 3 the way `analyze-design-draft`'s rewritten guidance does. The result is a flat tree with too many first-level topics, which in turn makes per-topic reassignment more costly because every new conversation may shuffle items across a broader set of siblings.

### Agreed fix
**Keep the per-topic review loop and the reassignment mechanism.** They will earn their keep on a mature graph. The lever to pull is the **quality of the topic tree** the loop operates on — fewer, better-shaped topics mean less reassignment churn.

**Topic-hierarchy guidance (extract-topics.md).** Replace the current short-list of rules with the same explicit hierarchy contract that landed in `analyze-design-draft` §5:

> ### Topic hierarchy
>
> Topics form a hierarchy that humans must be able to navigate. The agent's
> job is to keep that hierarchy legible.
>
> 1. **Single root per conversation when possible.** Most conversations have
>    one root topic that frames the subject. Multiple unrelated roots are a
>    smell — usually they should hang under a shared parent that names what
>    binds them.
> 2. **First-level breadth ≤ 10.** No more than ~10 sibling topics directly
>    under a root. If the categorisation axis produces more, group along a
>    coarser axis and demote the current ones one level down.
> 3. **Reuse the existing structure.** Before adding a new topic — and
>    especially before adding a new first-level topic — read the existing
>    topic tree end to end. New topics at the first level are added only when
>    no existing branch fits.
> 4. **Re-shape when needed.** Merging, splitting, and re-parenting existing
>    topics is part of the job, not an exception. If a previously created
>    topic no longer fits the cleaned conversation's structure, change it.
> 5. **Reason from semantic axes, not counts.** Item count is a smell, not a
>    verdict. A 1-item topic is fine if it is genuinely orthogonal; a 30-item
>    topic is fine if all 30 belong to one tightly-coupled algorithm.

**Do not introduce batched review (`get_topics_for_review_batch`).** The chattiness will not be the dominant cost once the tree is well-shaped, and batching loses the reassignment-aware re-fetch path. Re-evaluate only if a future production run still shows per-topic round trips dominating end-to-end time.

### Note on §2 interaction
With §2 in place, the previously proposed "auto-skip empty topics" optimisation is not needed: containers are no longer empty work, they have summaries to write. The combined effect of §2 (each topic has real work) and §3 (a smaller, better tree) is the intended replacement for batching.

---

## 4. ⏭️ Transcript ASR artefacts survive cleaning — deferred

### Observed
The transcript contained Polish ASR errors that propagated into idea-unit text and were quoted verbatim in summaries (*SAT* / *SAD*, *TN-eum*, *Kłody o kosztach* / *Chodzi o koszty*, *pstryczek w ich nos*, *peletkę* / *paletkę*).

### Decision
Leave for now. Two constraints govern this:

- The transcript is the canonical input. We can't modify it with an LLM at this step — only deterministic transformations are permitted in the prepare path (`agent_extensions/CLAUDE.md` keeps API access out of data prep).
- ASR quality won't improve in the near term, and one transcript is not enough evidence to over-fit a cleaning rule.

No `clean-transcript` skill, no `--normalize-asr` flag, no dictionary pass. Revisit only if multiple production runs show systematic, fixable artefacts.

---

## 5. 🟡 `Decision` category semantics are misleading

### Observed
The `has_decision_units` flag is true if **any** idea unit carries the `Decision` category. But Decision quality varies:

- T28 was just *"Tak, tak."* — formally `Decision`, only meaningful with T26-27 context.
- T46 contained the substantive *"nie wiem czy chcę z niej rezygnować"* (a real decision) **without** a `Decision` tag.

So the flag both over-fires (on confirmations) and under-fires (on substantive commitments not labelled as such).

### Root cause
This is an **agent-side categorisation quality issue**, not a server bug. The instructions in `extract-topics.md:32-36` define `Decision` as "explicit agreement / chosen approach" — but in practice the agent applied it to confirmation tokens (`"Tak, tak."`) and missed implicit commitments. There is also a coupling with §9.2: an interjection like `"Tak, tak."` should rarely be a standalone idea unit in the first place; if it is, it usually doesn't carry the decision content — that lives in the surrounding sentences.

### Agreed fix
Sharpen the rule in `extract-topics.md`. Keep the existing `Decision` line but expand it to:

> `Decision` — a unit that **commits** the speaker (or the group) to a course
> of action. To qualify, the unit must itself name the chosen course;
> agreement on its own is not enough.
>
> **Acknowledgement tokens** (`"yes"`, `"okay"`, `"tak"`, `"dobrze"`, `"jasne"`) should
> rarely be standalone idea units — group them into the surrounding idea unit
> that contains the actual commitment (see "Idea units" rules below). When an
> acknowledgement does end up as its own idea unit, it is almost always
> `Irrelevant`, not `Decision`: the load-bearing content is in the previous or
> next idea unit, which is the one that carries `Decision` if any.
>
> Conversely, narrative-style commitments without explicit decision wording
> still qualify. Examples:
>
> - *"I'm not sure I want to drop it"* (Polish: *"nie wiem czy chcę z niej
>   rezygnować"*) → `Decision` if it states the speaker's settled stance.
> - *"We'll go with the FIFO approach because…"* → `Decision` (the chosen
>   course is named).
> - *"Yes."* / *"Tak."* alone → not a Decision; merge into the surrounding IU.

No new `has_decision_arc` flag yet. Keep `has_decision_units` as the server-side derived signal — once the tagging rule is sharpened, the over/under-fire pattern should largely resolve. Revisit only if the next production run still shows the same noise.

---

## 6. 🟡 `potential_topics` ambiguity for new root topics

### Observed
`extract-topics.md:69` says:

> For new topics that should sit under an existing parent, append the new entry to `output.json:potential_topics.topics` with `is_new: true` and `parent_id: <existing parent id>` so the merge step can wire the parent.

This is silent about new **roots** (no existing parent). The agent included them anyway with `parent_id: null`, and the merge worked fine — but the rule is implicit.

### Root cause
- `conversations.service.ts:236-244` — `buildParentMap` already accepts `parent_id: null` and clears the parent edge accordingly. Code is correct; doc is incomplete.

### Agreed fix
Reword `extract-topics.md:69` to:

> For every newly-created topic, append an entry to
> `output.json:potential_topics.topics` with `is_new: true`. Set `parent_id`
> to the existing parent's id, or to `null` if the topic is a new root.

Mirror the same wording in `SKILL.md:69`.

---

## 7. 🟡 File-path resolution in Setup

### Observed
The user invocation passed `2026-02-10-cz1_short.md`, but the actual file lived at `conversations/wycena-dokumentów/2026-02-10-cz1_short.md`. The skill's Setup says:

> **transcript_path** — absolute path to the raw transcript Markdown.

…but doesn't tell the agent how to recover when the path is **not** absolute. The agent had to glob the filename.

### Root cause
- `SKILL.md:14` requires absolute path.
- `scripts/conversation/prepare.ts:133` calls `requireFile` which fails on non-existent paths but does not search.

### Agreed fix
Agent-side resolution. We have no canonical conversations directory yet, so don't bake one into the skill — search the workspace.

In `SKILL.md` Setup, after the `transcript_path` description add:

> If `transcript_path` is not absolute or the file does not exist at the given
> path, resolve it via Glob (`**/<basename>`) within the current working
> directory. If multiple matches exist, ask the user which one. Do not extend
> `prepare.ts` with a search step — the script remains a strict file
> consumer.

`prepare.ts` itself stays unchanged.

---

## 8. ⏭️ No re-merge or repair path — deferred

### Observed
`has_conversation` returns early if the conversation already exists. If a downstream review reveals errors (wrong topic assignment, missing decision), the only recovery is to delete the conversation manually and re-run.

### Decision
For the POC the in-memory graph and "clear DB and re-run" workflow are sufficient. Defer until persistence lands and a real "redo this analysis" use case emerges. When it does, the simpler `replace_conversation(working_dir)` (delete + re-insert) is preferred over an idempotent merge.

---

## 9. 🟡 Minor friction (apply fixes)

### 9.1 UUID generation moves out of the agent

#### Observed
The agent generated 30 decision UUIDs upfront and used 7. It also fabricated UUIDs for new topics during Step 3. This is harmless but conceptually wrong: the agent shouldn't be in the UUID-minting business. Pre-generating IDs during planning also leads to dead IDs that linger in `output.json` drafts.

#### Agreed fix
**Server / scripts mint IDs; the agent receives them.**

**For decisions.** The simpler half. `DecisionSchema` already has `id: z.string().default(() => randomUUID())`. The skill must stop emitting `id` — the field is filled in when `output.json` is parsed by `merge_conversation`.

- `references/analyze-topic.md` — the Decision shape example (lines 67–90) drops the leading `"id": "<uuid>"` field. Replace with a one-line note: _"Do not set `id`. The server fills it during merge."_.
- No schema change required (the default already covers the omitted case), but tighten by changing `id` to `id: z.string().optional().default(() => randomUUID())` so omitting from agent output is explicit in the contract.

**For topics.** New topics need IDs that are referenced from two places in `output.json` (the `conversation.topics[].id` and `potential_topics.topics[].id`), so the agent does need a stable identifier at authoring time. Provide it via a small MCP tool.

- New tool `noesis-graph:generate_topic_ids({ count: number })` returning `{ ids: string[] }` — `count` is bounded (e.g. 1–50). Pure function, no graph touch.
- Skill flow:
  - **Step 2 (Goldilocks).** When existing topics are reused, no new IDs are needed.
  - **Step 3 (extract).** After the agent has decided which idea units need new topics and how many — call `generate_topic_ids` once with the total count. Use the returned IDs for both `conversation.topics[].id` (for new entries) and the matching `potential_topics.topics[].id` (with `is_new: true`).
  - **Step 4 (review/reassign).** If the agent creates an additional topic during reassignment, call `generate_topic_ids({ count: 1 })` again.
- Update `SKILL.md` Step 3 wording: "Use a fresh UUID for new topics" → "Call `generate_topic_ids({ count: <N> })` once you know how many new topics you need; use the returned IDs for both `conversation.topics[].id` and the matching `potential_topics.topics[].id`."
- Drop any "fresh UUID" references in `references/extract-topics.md` and replace with the same instruction.

**TS-side cleanup.** `randomUUID` imports in skill-facing scripts (currently only `prepare.ts:3`, which is correct because it generates the conversation_id) stay where they are. The new `generate_topic_ids` lives in `conversations.service.ts` (or a new tiny `ids.service.ts` if we want a dedicated home for ID provisioning). Wire it through the MCP tool registration.

### 9.2 One-word interjections inflate idea units

#### Observed
*"Słucham?"* (T34:IU1) — a one-word interjection. The IU-grouping rules let the agent tag it `Irrelevant`, but the rule against tiny IUs in `extract-topics.md` is silent on transitional one-word fragments. This couples directly to §5: the same problem produced the `"Tak, tak."` Decision noise.

#### Agreed fix
Add to `extract-topics.md` Idea units section, right under the existing grouping rule:

> **Transitional interjections** (one-word acknowledgements like *"yes"*,
> *"okay"*, *"hmm"*, *"tak"*, *"słucham?"*) should be merged into the
> surrounding idea unit when they don't carry meaning on their own. Do not
> emit them as standalone idea units. The exception is when the interjection
> is itself the substantive content of a turn — e.g. an answer to a yes/no
> question that the next speaker depends on; in that case keep it as its own
> idea unit and pair it with the appropriate category.

This rule, combined with the §5 sharpening, should suppress most of the spurious-`Decision` and tiny-IU noise.

### 9.3 Decision JSON deduplication

#### Observed
`supporting_items` repetition (same `IdeaUnitRef` referenced across `context`, `decision`, and `alternative_options[i]`) inflates `output.json` size. For long Polish-language transcripts with multi-sentence IUs this becomes meaningful.

#### Agreed fix
Deduplicate at the Decision root. Each `Decision` carries a single `referenced_items` list; slots reference items by index.

**Schema change (`shared-contracts/topics.ts`).**

```ts
export const DecisionContextSchema = z.object({
  text: z.string(),
  supporting_item_indices: z.array(z.number().int().nonnegative()),
});

export const DecisionOptionSchema = z.object({
  text: z.string(),
  rationale: z.string(),
  supporting_item_indices: z.array(z.number().int().nonnegative()),
});

export const DecisionSchema = z.object({
  id: z.string().optional().default(() => randomUUID()),
  title: z.string(),
  status: DecisionStatusSchema,
  referenced_items: z.array(TopicItemSchema),
  context: DecisionContextSchema,
  decision: DecisionOptionSchema,
  alternative_options: z.array(DecisionOptionSchema),
});
```

**Validation rule.** All `supporting_item_indices` values must be valid indices into `referenced_items`. Add a `.superRefine` (or post-parse check) on `DecisionSchema` that returns a Zod issue when an index is out of range.

**Server consumption (`decisions.service.ts:36-67`).** Resolve each index to the corresponding `TopicItem` before linking. The `linkSlotToItem` / `linkAlternativeToItem` helpers don't change — they still take a `TopicItem`. Adjust `addDecision` to walk by index:

```ts
for (const i of decision.context.supporting_item_indices) {
  const item = decision.referenced_items[i];
  await this.linkSlotToItem(decision.id, { slot: "context" }, item);
}
```

`requireSupportingItems` is called once on `referenced_items` instead of three times across the slots.

**Skill prompts.** Update `references/analyze-topic.md` Decision shape (lines 67–90) to:

```json
{
  "title": "Short descriptive title",
  "status": "accepted" | "proposed",
  "referenced_items": [ IdeaUnitRef, ... ],
  "context": {
    "text": "1–2 sentence problem statement",
    "supporting_item_indices": [0, 2]
  },
  "decision": {
    "text": "What was decided",
    "rationale": "Why",
    "supporting_item_indices": [1, 3]
  },
  "alternative_options": [
    {
      "text": "Rejected option",
      "rationale": "Why considered, why rejected",
      "supporting_item_indices": [4]
    }
  ]
}
```

with a short note:

> List every idea unit cited by any slot once in `referenced_items`. Each
> slot references those items by their index in that array. Do not repeat the
> same `IdeaUnitRef` across slots. Do not include items that no slot
> references.

UI / read-side projections (`getDecisionDetail`, `listConversationsForDecisionSlot`, etc.) operate on the persisted graph rather than raw JSON, so the deduplication is invisible to them — no UI change required.

---

## Implementation plan (recommended sequencing)

Backward-compatibility is not a concern — no production data yet.

### P0 — Pure-doc fixes (one PR, no code)
- §1: rewrite `extract-topics.md` and `analyze-topic.md` to reference `output.json` and the wrapped shape; keep examples inline; add cross-link to `output.ts`.
- §6: clarify the `parent_id: null` rule for new roots in both `extract-topics.md` and `SKILL.md`.
- §7: add the path-resolution note to `SKILL.md` Setup.
- §5: tighten the `Decision` category definition with the acknowledgement-token sharpening and 2–3 worked examples (Polish + English).
- §9.2: add the transitional-interjection grouping rule to `extract-topics.md`.
- §3: replace the existing topic-hierarchy bullets in `extract-topics.md` with the explicit hierarchy contract (single root, ≤10 first-level, reuse, re-shape, semantic axes).
- §2 (skill half): add the "summaries when a topic has subtopics" rule to `extract-topics.md` and `analyze-topic.md`.

Risk: low. Pure prompt evolution. Verify by re-running on `2026-02-10-cz1_short.md` and inspecting the produced topic tree and idea-unit tagging.

### P1 — Container-topic support in the server (one PR, code)
- §2 (server half): `getTopicForReview` returns topics in post-order; the returned Markdown includes a `## Subtopics` section with each child's title and `short_summary`.
- Build the parent map for current-conversation topics from `output.json:potential_topics.topics`; orphan / reused topics fall back to declaration order.
- Tests: post-order ordering on a 3-level tree; subtopics section present for parents and absent for leaves; `short_summary` of an unreviewed child renders as `_(pending review)_`.

### P2 — UUID provisioning (one PR, code + prompts)
- §9.1: new MCP tool `noesis-graph:generate_topic_ids({ count })`. Schema for `DecisionSchema.id` becomes `.optional().default(...)`.
- Update `SKILL.md` Step 3 and `references/analyze-topic.md` Decision shape per §9.1.
- Tests: tool returns the requested number of unique UUIDs; `DecisionSchema.parse` fills `id` when omitted; `merge_conversation` inserts a decision with a server-filled id.

### P3 — Decision JSON deduplication (one PR, schema + service + prompt)
- §9.3: change `DecisionContextSchema` and `DecisionOptionSchema` to `supporting_item_indices`; add `referenced_items` to `DecisionSchema`; `superRefine` for index range.
- Update `decisions.service.ts:addDecision` to resolve indices.
- Update `references/analyze-topic.md` example.
- Tests: round-trip a decision with shared items across slots; reject out-of-range indices with a clear Zod issue.

### Deferred (out of scope for now)
- §4 ASR cleaning — revisit if multiple transcripts show systematic, fixable artefacts.
- §8 re-merge / `replace_conversation` — revisit when persistence lands.
- Batched review (`get_topics_for_review_batch`, originally §3 Option B) — revisit only if the per-topic loop still dominates time after P0–P2 land.
