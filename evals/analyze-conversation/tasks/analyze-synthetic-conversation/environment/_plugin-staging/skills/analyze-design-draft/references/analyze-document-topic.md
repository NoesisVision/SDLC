# Review topic, generate summaries, extract or attach decisions

Used by `noesis:analyze-design-draft` Step 5.

## Iterative vs batch mode

SKILL.md Step 5 describes two execution modes:

- **Iterative**: one `get_topic_for_document_review` call per topic, edit `output.json` between calls. Default and safest. Use when ≤10 unreviewed topics remain — the per-topic round-trips are cheap and the linear flow makes coherence checks easy.
- **Batch**: one `list_unreviewed_topics_for_document` call returns every unreviewed topic in one Markdown bundle (one section per topic, separated by `<!-- topic_id: ... -->` markers). Apply all updates to `output.json` in one Edit/Write pass. Use when >10 topics remain — sequential round-trips on a 250-KB output.json are expensive.

Batch mode trades round-trips for a per-topic verification pass that you must perform manually after writing the bundle of updates. The verification pass walks every topic and confirms two things: (a) any `[from <doc title>]` prior-document fragments were folded into the new summary; (b) the coherence check from "Coherence check" below was applied. If you skip the pass, batch mode is unsafe.

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

Validate that each current-document fragment truly belongs to this topic. Reassign ONLY when the mismatch is clear AND another topic already present in `output.json:topics` is a better match.

If a current-document fragment fits no existing topic, create a new `AnalyzedTopic` entry directly in `output.json:topics` with `is_new: true` and a sensible `parent_id`, then move the fragment ref from this topic's `items` to the new topic's `items`.

### Oversaturated topics (>40 items)

When a topic has more than 40 items, run an extra coherence pass before generating the summary: read every item and verify the topic is the fragment's *primary* subject (see "Primary subject vs side mention" in `extract-document-topics.md`). Items that turn out to be side mentions belong elsewhere — reassign them via the existing reassignment mechanism, even if it means moving 20+ refs out of this topic.

Tally the count before and after the pass; mention both numbers in your internal notes (e.g. "Uprawnieniа w module wyceny: 67 → 14 after coherence pass"). Oversaturated topics are usually the result of a `SECTION_MAP` rule that fires on every section mentioning the concept rather than the concept being the section's primary subject; this pass is the last chance to recover from that.

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

Each slot inlines the `SourceContentRef`s that support it under `supporting_content`. The same fragment may appear in more than one slot if it genuinely supports each; there is no shared top-level list.

```json
{
  "title": "...",
  "status": "accepted" | "proposed",
  "context": {
    "text": "1–2 sentence problem statement",
    "supporting_content": [ DocumentFragmentRef, ... ]
  },
  "decision": {
    "text": "What was decided",
    "rationale": "Why",
    "supporting_content": [ DocumentFragmentRef ]
  },
  "alternative_options": [
    {
      "text": "Rejected option",
      "rationale": "Why considered, why rejected",
      "supporting_content": [ DocumentFragmentRef ]
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
