# Review topics, generate summaries, extract decisions

Used by `noesis:analyze-conversation` Step 4.

## Reviewing the bundle

`prepare_review_bundle` returns a single Markdown file containing every topic in **post-order** (leaves first, parents last). Each topic's section is preceded by HTML-comment metadata and separated from the next by `---`:

```
# Topics for review

<!-- topic_id: <id> -->
<!-- num_items: <n> -->
<!-- has_decision_units: true|false -->

# <topic title>
- **ID:** <topic_id>
- **Conversation:** <conversation_id>
- **Summary:** <short_summary>
- **Long summary:** <long_summary>

## Subtopics

- **<child title>** — <child short_summary>
- **<child title>** — _(pending review)_

## Idea Units

### [T<turn_index>:IU<idea_unit_index>] <HH:MM:SS> — <speaker> [<categories>]
<sentences joined as text>

---

<!-- topic_id: <next id> -->
...
```

Process the sections in the order they appear. Because the bundle is post-ordered, every child topic is already analysed by the time you reach its parent — write the children's `short_summary` first, then weave them into the parent.

Idea units come from BOTH the current conversation AND prior conversations already attached to this topic in the graph. Prior-conversation units carry a `[prior conversation]` marker.

Use `[prior conversation]` units as context, but never reassign or modify them — they belong to other conversations.

`Irrelevant`-only idea units are already filtered out.

The `## Subtopics` block lists the topic's direct children with the finalized `short_summary` you just wrote (or the value already in `output.json` from a prior run). A child rendered as `_(pending review)_` is one whose summary you have not yet written — make sure to fill that child's section earlier in the same pass before treating its summary as final.

The `## Subtopics` block is omitted when the topic has no children.

## Coherence check

For each section, validate that each current-conversation idea unit truly belongs to this topic. A reassignment is justified ONLY when the mismatch is clear AND another topic (already in `output.json` or freshly created) is a better match. When in doubt, keep the unit where it is.

If a current-conversation unit fits no existing topic, create a new topic — call `noesis-graph:generate_topic_ids` with `{ "count": 1 }` for its id, set `is_new: true`, sensible `parent_id`, and `path` — and append it to `output.json:potential_topics.topics`. Then remove the unit from the original topic's `items` and add it to the new topic's `items` (in `conversation.topics[]`).

If a reassignment changes a topic whose section you have already finalised in the same pass, recompute that topic's summary against its updated item set. The validator (`validate_output`) runs against the final state; an out-of-sync summary is your responsibility, not the server's.

## Summaries

Both summaries are always regenerated. The exact rule depends on the topic's shape:

- **Leaf** — has idea units, no subtopics. Summaries come from those idea units (current + prior).
- **Container** — has subtopics, no own idea units. Both `short_summary` and `long_summary` are synthesised from the children's finalized summaries (from the `## Subtopics` block when populated, or from the summaries you just wrote earlier in this pass when the bundle still shows `_(pending review)_`). Never leave a container's summaries empty.
- **Hybrid** — has both subtopics and own idea units. Summarise the topic's own idea units first, then weave in what each child contributes. If the result feels like two unrelated paragraphs glued together, the topic is probably mis-shaped — promote the IU into a child topic and re-summarise as a container.

If you reassigned units away, recompute on the remaining set. If after reassignment only `[prior conversation]` units remain and the topic has no subtopics, set both summaries to empty strings.

- **`short_summary`** — max 3 sentences. Optimize for search: subject, scope, distinguishing aspect. An LLM should be able to judge query relevance from this alone.
- **`long_summary`** — 10–20 sentences. Knowledge for coding agents preparing design docs. Cover:
  - **Requirements** — what the system must do, business rules, constraints.
  - **Design decisions** — what was decided and why (rationale, trade-offs).
  - **Domain concepts** — definitions, relationships between entities, terminology.
  - **System behavior** — expected flows, edge cases, error handling.

  Write as established knowledge, not as a meeting summary. No "the team discussed", "X proposed", "participants agreed".

## Decision extraction

Skip if `has_decision_units: false` (in the file's HTML-comment metadata).

Otherwise, walk idea units in chronological order (`turn_index`, then `idea_unit_index`):

1. **Find decision points** — units with `Decision` in their categories.
2. **Trace the arc** — for each decision point, look back and forward for:
   - **Context** — `Information` / `Position` units that set up the problem.
   - **Options** — `Position` / `Argument` units that propose or debate alternatives.
   - **Final decision** — the `Decision` unit reflecting the agreed-upon outcome.
3. **Group** — cluster idea units into one or more `Decision` records. A topic may have zero, one, or many decisions.

A `Decision` proposed early but later overturned is an **alternative**, not the decision. Use the final outcome.

### Decision shape

Do not set `id`. The server fills it during merge.

Each `Decision` lists every cited idea unit once in `referenced_items`; the slots reference those items by index. Do not repeat the same `IdeaUnitRef` across slots; do not include items that no slot references.

```json
{
  "title": "Short descriptive title",
  "status": "accepted",
  "referenced_items": [
    { "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": 26, "idea_unit_index": 0 },
    { "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": 27, "idea_unit_index": 1 },
    { "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": 28, "idea_unit_index": 0 }
  ],
  "context": {
    "text": "1–2 sentence problem statement",
    "supporting_item_indices": [0]
  },
  "decision": {
    "text": "What was decided",
    "rationale": "Why",
    "supporting_item_indices": [1, 2]
  },
  "alternative_options": [
    {
      "text": "Rejected option",
      "rationale": "Why considered, why rejected",
      "supporting_item_indices": [0]
    }
  ]
}
```

`IdeaUnitRef`: `{ "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": N, "idea_unit_index": N }`. All refs use the **current** `conversation_id` — only current-conversation units may be cited (prior-conversation refs already exist in the graph and will be linked by Step 5).

`status: "proposed"` if the discussion did not converge; `accepted` otherwise.

`alternative_options` is `[]` when no alternatives were debated.

Keep `context.text`, `decision.text`, `rationale` to 1–2 sentences each.

## Updating output.json

Once you have processed every section in the bundle, write all updates with a single Edit/Write of `<working_dir>/output.json`. For each topic under `conversation.topics[]` set:

- `short_summary`, `long_summary` — generated above.
- `decisions` — array of `Decision` (may be `[]`).
- `reviewed: true` — required to satisfy the workflow.
- `decisions_extracted: true` — required to satisfy the workflow.

Then call `noesis-graph:validate_output`. Fix and re-validate until `Ok` before calling `merge_conversation`.

## Language

Match the language of the source transcript for all titles, summaries, and free-text fields.
