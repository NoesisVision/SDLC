# Review topic, generate summaries, extract or attach decisions

Used by `noesis:analyze-design-draft` Step 5.

## Input

`get_topic_for_document_review` returns a Markdown file like:

```
<!-- topic_id: <id> -->
<!-- num_items: <n> -->
<!-- has_decision_units: true|false -->

# <topic title>
- **ID:** <topic_id>
- **Document:** <document_id>
- **Summary:** <short_summary>
- **Long summary:** <long_summary>

## Fragments

### [F<fragment_index>] <section_path> — <kind> [<categories>]
<fragment text>
```

Fragments come from BOTH the current document AND prior documents already attached to this topic. Prior-document fragments carry a `[from <doc title>]` marker.

Use `[from <doc title>]` fragments as context, but never reassign or modify them — they belong to other documents.

`Irrelevant`-only fragments are already filtered out.

`potential_decisions.json` (from Step 4) lists candidates for attachment. Read it before deciding decisions.

## Coherence check

Validate that each current-document fragment truly belongs to this topic. Reassign ONLY when the mismatch is clear AND another existing topic in `potential_topics.json` is a better match.

If a current-document fragment fits no existing topic, create a new topic, append it to `potential_topics.json`, and move the fragment ref in `analysis.json` from this topic's `items` to the new topic's `items`.

## Summaries

Always regenerate both summaries from ALL fragments (current + prior). If you reassign fragments away, recompute on the remaining set. If only `[from <doc title>]` fragments remain after reassignment, set both to empty strings.

- **`short_summary`** — max 3 sentences. Optimize for search: subject, scope, distinguishing aspect.
- **`long_summary`** — 10–20 sentences. Knowledge for coding agents preparing design docs:
  - **Requirements** — what the system must do, business rules, constraints.
  - **Design decisions** — what was decided and why.
  - **Domain concepts** — definitions, relationships, terminology.
  - **System behavior** — flows, edge cases, error handling.

  Write as established knowledge, not prose summary. No "the document explains", "the author proposes".

## Decision handling

Skip if `has_decision_units: false`.

For each fragment with `Decision` in its categories, decide first whether to **ATTACH** to an existing decision or **CREATE** a new one. Prefer ATTACH whenever the fragment plainly belongs to an existing decision's arc — duplicating decisions hurts the graph.

### ATTACH

The fragment provides additional context, articulates an alternative not yet captured, or strengthens the rationale of an existing decision listed in `potential_decisions.json`.

Append an entry to `analysis.json`'s top-level `decision_attachments` array:

```json
{
  "decision_id": "<existing decision id>",
  "slot": "context" | "decision" | "alternative",
  "alternative_index": <0-based index when slot is "alternative", else null>,
  "fragment_indices": [<index>, ...]
}
```

For `slot: "alternative"` you need the `alternative_index`. If you don't know it from `potential_decisions.json`, call `noesis-graph:read_decision` for that decision.

**Attach at most 5 fragments per slot per decision.** Pick the most directly supportive evidence. If more than 5 fragments touch the slot, prefer ones that:

1. State the rule / option / consequence explicitly (verbatim wording wins).
2. Show a concrete code-side artefact (field, handler, type) that anchors the rule.
3. Cover a distinct perspective — don't attach the same paragraph twice.

Tangential mentions in coverage tables, recap sections, or table-of-contents entries should not be attached.

### CREATE

The fragment introduces a decision arc not yet in the graph. Trace context (`Information`/`Position` fragments) and alternatives (`Position`/`Argument` fragments) within this topic. Build a `Decision`:

Do not set `id`. The server fills it during merge.

Each `Decision` lists every cited fragment once in `referenced_items`; the slots reference those fragments by index. Do not repeat the same `DocumentFragmentRef` across slots; do not include items that no slot references.

```json
{
  "title": "...",
  "status": "accepted" | "proposed",
  "referenced_items": [ DocumentFragmentRef, ... ],
  "context": {
    "text": "1–2 sentence problem statement",
    "supporting_item_indices": [0, 1]
  },
  "decision": {
    "text": "What was decided",
    "rationale": "Why",
    "supporting_item_indices": [2]
  },
  "alternative_options": [
    {
      "text": "Rejected option",
      "rationale": "Why considered, why rejected",
      "supporting_item_indices": [3]
    }
  ]
}
```

`DocumentFragmentRef`: `{ "type": "document_fragment_ref", "document_id": "<doc_id>", "start_offset": N, "end_offset": N }` — copy the offsets directly from the fragment header in the input file.

Add the new `Decision` to this topic's `decisions` array (in `analysis.json`).

`alternative_options` is `[]` when no alternatives appear in the document.

Keep `context.text`, `decision.text`, and `rationale` to 1–2 sentences each.

## Updating analysis.json

For the topic with this `topic_id`:

- Set `short_summary`, `long_summary`.
- Append created decisions to `decisions`.
- Set `reviewed: true` and `decisions_extracted: true`.

For ATTACH operations, append entries to the top-level `decision_attachments` array (not on the topic).

For reassignments, move `DocumentFragmentRef` entries between topics' `items` arrays.

Leave all other topics untouched.

## Language

Match the source document's language for all titles, summaries, and free-text fields.
