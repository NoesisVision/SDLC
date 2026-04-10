# Review Topics

Review a single topic from the conversation: check idea unit coherence, reassign mismatched units, and generate topic summaries.

## Input

- `<working_dir>` — path to the working directory.
- `<knowledge_graph_path>` — path to the knowledge graph JSON file.

## Workflow

### Step 1: Load topic for review

1. Run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/load_topic_for_review.py <working_dir> <knowledge_graph_path>`.
2. If `has_topic` is `false`, return `{"has_topic": false}` and stop.
3. Extract `topic` (the topic under review, with idea units from all conversations) and `potential_topics` (all available topics).

### Step 2: Evaluate idea unit coherence

For each idea unit in the topic:

1. **Check internal coherence** — does this idea unit belong to this topic given the topic's `title` and `short_summary`? Consider the idea unit's `sentences`, `speaker`, and `categories`.
2. **Check for better fit** — scan `potential_topics` to see if another topic is a more accurate match. A reassignment is warranted only when the idea unit clearly fits another topic better, not when the match is marginal.
3. **Handle orphaned units** — if an idea unit does not fit this topic AND no existing potential topic is a good match, create a new topic: generate a UUID v4 for `id`, set `is_new: true`, set `parent_id` to `null` (or an existing topic's `id` if it is a subtopic), generate a `title` and short `short_summary`, set `path` accordingly.

Collect all reassignments (idea units to move) and any new topics to create.

### Step 3: Generate topic summaries

After reassignments, consider all remaining idea units still assigned to this topic. Generate two summaries based on the full set of idea units:

1. **`short_summary`** (max 3 sentences) — a concise summary optimized for search. It should allow an LLM to quickly determine whether this topic is relevant to a given query. Focus on the key subject, scope, and distinguishing aspects.

2. **`long_summary`** (10–20 sentences) — a comprehensive summary suitable for design work by a human or AI agent. Cover the main points, arguments, positions, decisions, and context discussed. Preserve important nuances and relationships between ideas.

Both summaries must always be generated fresh from all idea units, regardless of whether any reassignments occurred.

### Step 4: Save review result

Build a `TopicReviewResult` JSON object with:
- `topic_id` — the reviewed topic's `id`.
- `short_summary` — the generated short summary.
- `long_summary` — the generated long summary.
- `reassignments` — list of `IdeaUnitReassignment` objects, each with `turn_index`, `idea_unit_index`, `new_topic_id`.
- `new_topics` — list of `PotentialTopic` objects for any newly created topics (with `is_new: true`).

Write the JSON to `{working_dir}/topic_review_tmp.json` using the Write tool, then run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/save_topic_review.py <working_dir> {working_dir}/topic_review_tmp.json`

### Step 5: Return status

Return `{"has_topic": true, "topic_id": "<reviewed topic's id>"}` to the caller.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly with `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/<script.py>` — Python resolves local imports from the script's own directory.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Always use the Write tool.
- NEVER use Read tool or Bash (`cat`, `ls`, `head`) to inspect working directory files. All reads MUST go through the provided scripts.
- Write only temporary JSON files (e.g. `topic_review_tmp.json`) via the Write tool — scripts handle validation and persistence.
- Only reassign an idea unit when the mismatch is clear. When in doubt, keep it in the current topic.
- When creating new topic UUIDs, use standard UUID v4 format.
- Do NOT review or modify topics other than the one loaded in Step 1. Other topics will be reviewed in subsequent iterations.
- Always generate both summaries from ALL idea units provided (including those from prior conversations in the knowledge graph).
- Generate all titles, summaries, and text fields in the same language as the conversation transcript. Do not switch to English for technical content.
