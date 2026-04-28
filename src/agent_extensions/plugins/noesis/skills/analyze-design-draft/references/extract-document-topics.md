# Assign categories and topics to fragments

Used by `noesis:analyze-design-draft` Step 3.

## Inputs

- `<document_path>` — the source document (Markdown). Use it to read fragment content in context. The prep script does not modify the source and does not write a sidecar copy — fragment offsets refer directly to this file.
- `<analysis_path>` — `analysis.json`. The `fragments` array is pre-populated by the prep script:
  ```json
  {
    "index": 0,
    "start_offset": 0,
    "end_offset": 42,
    "section_path": ["Section A"],
    "kind": "paragraph|list|code_block|table|blockquote",
    "text": "...",
    "categories": []
  }
  ```
- `<section_tree_path>` — Markdown rendering of the heading hierarchy. Useful for orientation, optional.
- `{working_dir}/potential_topics.json` — existing topics from the graph plus any new topics you introduce.

Treat fragment indices and offsets as authoritative — copy them verbatim into `DocumentFragmentRef`.

## Categories

Per fragment, assign one or more from `IdeaUnitCategory`:

- `Information` — most fragments in design drafts. Factual content, descriptions, requirements.
- `Position` — author asserts a stance or recommendation.
- `Argument` — reasoning that supports a position.
- `Decision` — chosen approach with rationale (e.g. "Use X because Y", "Decision: …", explicit trade-offs landing on a choice).
- `Irrelevant` — off-topic OR structurally empty. Author-curated documents have few of these in absolute terms, but several patterns reliably belong here:
  - Fragments of `kind: "structural"` — the prep tool emits these for orphan section markers like `**Powiązane scenariusze:**` with no content beneath them.
  - Any fragment whose trimmed text is shorter than 80 chars AND matches a header pattern (e.g. `^\*\*[^*]+:?\*\*$`, `^\*[^*]+\*$`, `**Aktorzy:**`, `**Cel:**`, `**Moduły:**`).
  - Pure cross-reference lists ("see also", "Powiązane scenariusze:", section-of-contents bullets, `- Scenariusz [A-Z]+-\d+` cross-link bullets).
  - Genuine boilerplate, pure rhetoric, uncited tangents.

  These contribute zero domain content; carrying them in topic items poisons search and inflates topic size.

Most fragments are `Information` only. Combine categories only when both genuinely apply.

### Decision: examples that the eye easily misses

A fragment is `Decision` content when it picks an option from alternatives, even when phrased as narrative — not only when it is labelled "Decision:" or "DP-N":

- "We use append-only deltas because…" → `Decision` (option chosen + rationale).
- "Instead of recomputing, we store…" → `Decision` (alternative ruled out).
- "FIFO over LIFO because…" → `Decision`.
- Polish/other-language equivalents of "ponieważ", "zamiast", "zdecydowaliśmy się na" / "we decided to" / "we chose" / "rather than" all signal a decision in narrative form.

Combine with `Information` if the fragment also explains the chosen option. Combine with `Argument` if it states a load-bearing reason.

### Position+Argument: rule statements that don't look like rules

A `Position` fragment asserts a stance or invariant, even when not labelled `INVARIANT:` / `RULE:` / `RB-N`:

- "Every order must have at least one line item." → `Position` (rule expressed as assertion).
- "Source-document line ids are never reused." → `Position`.
- "If a delta arrives out of order, drop it." → `Position` + `Argument` when the "if/then" embeds a reason.

Combine with `Argument` when the same fragment carries the reasoning ("…because reusing them would break audit trails.").

## Topic assignment

Reuse before promote. For every non-Irrelevant fragment:

1. Existing topic in `potential_topics.json` fits → reference it by `id`.
2. Existing topic fits but the fragment opens a more specific concept → new subtopic (`is_new: true`, `parent_id: <existing>`, fresh UUID, path appended).
3. Nothing existing fits → new root topic (`is_new: true`, `parent_id: null`, fresh UUID, path `[title]`).

`section_path` is a HINT, not authoritative. A single section may map to one topic, split across multiple subtopics, or merge with sibling sections.

Append every newly-created topic to `potential_topics.json` so `merge_document` can wire `parent_id` correctly.

### Primary subject vs side mention

A topic is the **primary subject** of a fragment, not a *side mention*. If the fragment's main concern is X and it incidentally references Y, assign it to the topic for X — not for Y. Side-mention assignments dilute search quality and inflate topic size:

- A UC variant whose main subject is "ręczna przecena" but mentions "permissions" in a precondition belongs in the price-correction topic, not in the permissions topic.
- A glossary bullet whose main subject is `Lock` belongs in the locking topic, not in every topic that ever uses a lock.

A new topic that ends up with >40 items is a smell — half of those assignments are likely incidental. Step 5's coherence pass exists to clean this up.

### Decision-coverage checkpoint

After assigning categories to every fragment, run the decision-coverage check (described in SKILL.md Step 3). For sections whose heading matches `decision|adr|reguły|polityka`, **at least 30% of fragments must be `Decision`-categorised** (alone or combined with `Information` / `Argument`). If the tally is short, re-read those sections looking for narrative decisions in the form covered above ("Decision: examples that the eye easily misses"). 0% Decision in a 50-fragment "Reguły biznesowe" section is a near-certain sign of mechanical "rules → Position" classification.

### Topic hierarchy rules

Topics form a hierarchy that humans must be able to navigate. The agent's job is to keep that hierarchy legible.

1. **Single root per document.** In most cases a document or conversation has one root topic that frames the whole subject. Multiple unrelated roots are a smell — usually they should hang under a shared parent that names what binds them.
2. **First-level breadth ≤ 10.** No more than ~10 sibling topics directly under a root. If you find yourself producing more, the categorisation axis is probably too narrow — group along a coarser axis and demote the current ones one level down.
3. **Reuse the existing structure.** Before adding a new topic — and especially before adding a new first-level topic — read the existing topic tree end to end. New topics at the first level are added only when there is concrete evidence that no existing branch fits.
4. **Re-shape when needed.** Merging, splitting, and re-parenting existing topics is part of the job, not an exception. If a previously created topic no longer fits the cleaned document's actual structure, change it.
5. **Reason from semantic axes, not counts.** Item count is a smell, not a verdict. A 1-item topic is fine if it is genuinely orthogonal; a 30-item topic is fine if all 30 belong to one tightly-coupled algorithm. Always decide based on the underlying semantic axes (command vs algorithm, happy-path vs edge-case, data-model vs behaviour, …) — never on a numeric threshold alone.

Within a parent, aim for 3–7 children when the material naturally supports that shape. Group related new subtopics under a shared intermediate parent rather than dropping them flat. Don't create a subtopic for a single fragment unless it is a self-contained, recurring concept.

## Updating analysis.json

For each fragment, set its `categories` array (do not move/reorder fragments).

Build `topics: [...]` — one `Topic` per touched topic id:

```json
{
  "id": "<uuid>",
  "title": "...",
  "short_summary": "",
  "long_summary": "",
  "items": [
    { "type": "document_fragment_ref", "document_id": "<doc_id>", "start_offset": N, "end_offset": N }
  ],
  "decisions": [],
  "reviewed": false,
  "decisions_extracted": false
}
```

`document_id` matches `analysis.json`'s top-level `document_id`. `start_offset` / `end_offset` come from the fragment.

Leave summaries and decisions empty here — Step 5 fills them.

Skip Irrelevant fragments when populating topic `items`.

## Language

Match the source document's language for all titles. Do not switch to English for technical content.
