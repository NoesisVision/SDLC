# Review topic, generate summaries, extract decisions

Used by `noesis:analyze-conversation` Step 4.

## Input

`get_topic_for_review` returns a Markdown file like:

```
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
```

Idea units come from BOTH the current conversation AND prior conversations already attached to this topic in the graph. Prior-conversation units carry a `[prior conversation]` marker.

Use `[prior conversation]` units as context, but never reassign or modify them — they belong to other conversations.

`Irrelevant`-only idea units are already filtered out.

The `## Subtopics` block lists the topic's direct children with their finalized `short_summary`. Topics are returned by the server in **post-order** (leaves first, parents last), so by the time you review a parent every child summary is final. A child rendered as `_(pending review)_` only appears in degenerate cases (e.g. an orphan that the post-order skipped); treat it as missing context.

The `## Subtopics` block is omitted when the topic has no children.

## Coherence check

Validate that each current-conversation idea unit truly belongs to this topic. A reassignment is justified ONLY when the mismatch is clear AND another existing topic in `output.json:potential_topics.topics` is a better match. When in doubt, keep the unit where it is.

If a current-conversation unit fits no existing topic, create a new topic — call `noesis-graph:generate_topic_ids` with `{ "count": 1 }` for its id, set `is_new: true`, sensible `parent_id`, and `path` — and append it to `output.json:potential_topics.topics`. Then remove the unit from this topic's `items` and add it to the new topic's `items` (in `conversation.topics[]`).

## Summaries

Both summaries are always regenerated. The exact rule depends on the topic's shape:

- **Topic with idea units, no subtopics.** Summaries come from those idea units (current + prior).
- **Topic with subtopics, no own idea units (a "container" topic).** Both `short_summary` and `long_summary` are written from the children's summaries listed in the `## Subtopics` block — synthesise an umbrella view that names the area covered and what the child topics contribute. Never leave a container's summaries empty.
- **Topic with both.** Start from the topic's own idea units, then weave in the children's contributions where they extend or qualify the picture. The children's summaries are context to take into account, not a separate section to glue on.

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

After processing one topic, edit `<working_dir>/output.json` (Edit tool). For the topic with this `topic_id` under `conversation.topics[]` set:

- `short_summary`, `long_summary` — generated above.
- `decisions` — array of `Decision` (may be `[]`).
- `reviewed: true` — required to advance the loop.
- `decisions_extracted: true` — required to advance the loop.

Leave all other topics untouched.

## Language

Match the language of the source transcript for all titles, summaries, and free-text fields.
