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

## Idea Units

### [T<turn_index>:IU<idea_unit_index>] <HH:MM:SS> — <speaker> [<categories>]
<sentences joined as text>
```

Idea units come from BOTH the current conversation AND prior conversations already attached to this topic in the graph. Prior-conversation units carry a `[prior conversation]` marker.

Use `[prior conversation]` units as context, but never reassign or modify them — they belong to other conversations.

`Irrelevant`-only idea units are already filtered out.

## Coherence check

Validate that each current-conversation idea unit truly belongs to this topic. A reassignment is justified ONLY when the mismatch is clear AND another existing topic in `potential_topics.json` is a better match. When in doubt, keep the unit where it is.

If a current-conversation unit fits no existing topic, create a new topic (placeholder UUID, `is_new: true`, sensible `parent_id`, path) and append it to `potential_topics.json` — then remove the unit from this topic's `items` and add it to the new topic's `items` (in `conversation.json`).

## Summaries

Always regenerate both summaries from ALL idea units (current + prior). If you reassigned units away, recompute on the remaining set. If after reassignment only `[prior conversation]` units remain, set both summaries to empty strings.

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

```json
{
  "id": "<uuid>",
  "title": "Short descriptive title",
  "status": "accepted" | "proposed",
  "context": {
    "text": "1–2 sentence problem statement",
    "supporting_items": [ IdeaUnitRef, ... ]
  },
  "decision": {
    "text": "What was decided",
    "rationale": "Why",
    "supporting_items": [ IdeaUnitRef, ... ]
  },
  "alternative_options": [
    {
      "text": "Rejected option",
      "rationale": "Why considered, why rejected",
      "supporting_items": [ IdeaUnitRef, ... ]
    }
  ]
}
```

`IdeaUnitRef`: `{ "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": N, "idea_unit_index": N }`. All refs use the **current** `conversation_id` — only current-conversation units may be cited (prior-conversation refs already exist in the graph and will be linked by Step 5).

`status: "proposed"` if the discussion did not converge; `accepted` otherwise.

`alternative_options` is `[]` when no alternatives were debated.

Keep `context.text`, `decision.text`, `rationale` to 1–2 sentences each.

## Updating conversation.json

After processing one topic, edit `<working_dir>/conversation.json` (Edit tool). For the topic with this `topic_id` set:

- `short_summary`, `long_summary` — generated above.
- `decisions` — array of `Decision` (may be `[]`).
- `reviewed: true` — required to advance the loop.
- `decisions_extracted: true` — required to advance the loop.

Leave all other topics untouched.

## Language

Match the language of the source transcript for all titles, summaries, and free-text fields.
