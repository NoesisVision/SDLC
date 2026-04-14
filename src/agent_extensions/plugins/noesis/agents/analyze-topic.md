# Analyze Topic

Review a single topic from the conversation — check idea unit coherence, generate summaries, and extract decisions if applicable.

## Input

- `<working_dir>` — path to the working directory.
- `<knowledge_graph_path>` — path to the knowledge graph JSON file.

## Workflow

### Step 1: Load topic for review

1. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/load-topic-for-review.ts <working_dir> <knowledge_graph_path>`. This prints a short status JSON with `has_topic`, `topic_id`, `topic_title`, `num_idea_units`, `has_decision_units`, and `topic_path`. The enriched topic is written to `{working_dir}/review_topic.md`.
2. If `has_topic` is `false`, return `{"has_topic": false}` and stop.
3. Read the enriched topic from `{working_dir}/review_topic.md` using the Read tool. The file is markdown:
   ```
   # <topic title>
   - **ID:** <topic_id>
   - **Conversation:** <conversation_id>
   - **Summary:** <short_summary>
   - **Long summary:** <long_summary>

   ## Idea Units

   ### [T<turn_index>:IU<idea_unit_index>] <time> — <speaker> [<categories>]
   <sentences joined as text>
   ```
   Purely Irrelevant units are already filtered out. Idea units marked `[prior conversation]` come from the knowledge graph — use them for context when generating summaries, but do NOT reassign them (they belong to a different conversation).
4. Read potential topics via: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/read-potential-topics.ts <working_dir>`. Returns `{"status": "Ok", "topics": [{"id", "title", "short_summary", "path", "is_new", "parent_id"}, ...]}` — a flat list of all known topics with their hierarchy paths.

### Step 2: Evaluate idea unit coherence

For each idea unit in the topic:

1. **Check internal coherence** — does this idea unit belong to this topic given the topic's `title` and `short_summary`? Consider the idea unit's `sentences`, `speaker`, and `categories`.
2. **Check for better fit** — scan `potential_topics` to see if another topic is a more accurate match. A reassignment is warranted only when the idea unit clearly fits another topic better, not when the match is marginal.
3. **Handle orphaned units** — if an idea unit does not fit this topic AND no existing potential topic is a good match, create a new topic: use a placeholder `id` (e.g. `new-1` — the save script replaces with real UUIDs), set `is_new: true`, set `parent_id` to `null` (or an existing topic's `id` if it is a subtopic), generate a `title` and short `short_summary`, set `path` to the topic's hierarchical path from root to leaf (e.g. `["Architecture", "API Design", "Authentication"]`; for a new root-level topic use `[title]`; for a subtopic prepend the parent's path).

Collect all reassignments (idea units to move) and any new topics to create.

### Step 3: Generate topic summaries

Generate two summaries based on the idea units remaining after excluding any you marked for reassignment in Step 2. Include `[prior conversation]` units in the summary — they provide historical context:

1. **`short_summary`** (max 3 sentences) — a concise summary optimized for search. It should allow an LLM to quickly determine whether this topic is relevant to a given query. Focus on the key subject, scope, and distinguishing aspects.

2. **`long_summary`** (10–20 sentences) — a knowledge summary for coding agents preparing design documents. Focus on:
   - **Requirements** — what the system must do, business rules, constraints.
   - **Design decisions** — what was decided and why (rationale, trade-offs).
   - **Domain concepts** — definitions, relationships between entities, terminology.
   - **System behavior** — expected flows, edge cases, error handling.

   Do NOT describe the discussion itself — no "the team discussed", "X proposed", "participants agreed". Write as established knowledge, not meeting minutes.

Both summaries must always be generated fresh, regardless of whether any reassignments occurred. If all current-conversation idea units are reassigned away and only `[prior conversation]` units remain, set both summaries to empty strings.

### Step 4: Save review result

Build a `TopicReviewResult` JSON object with:
- `topic_id` — the reviewed topic's `id`.
- `short_summary` — the generated short summary.
- `long_summary` — the generated long summary.
- `reassignments` — list of `IdeaUnitReassignment` objects, each with `turn_index`, `idea_unit_index`, `new_topic_id`.
- `new_topics` — list of `PotentialTopic` objects for any newly created topics (with `is_new: true`).

Write the JSON to `{working_dir}/topic_review_tmp.json` using the Write tool, then run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/save-topic-review.ts <working_dir> {working_dir}/topic_review_tmp.json`

### Step 5: Extract decisions (conditional)

If `has_decision_units` from Step 1 is `false`, skip to Step 7.

1. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/load-topic-for-decisions.ts <working_dir> --topic_id <topic_id>`. The enriched topic is written to `{working_dir}/decisions_topic.md`.
2. Read the enriched topic from `{working_dir}/decisions_topic.md` using the Read tool. Same markdown format as `review_topic.md`, but contains only idea units from the current conversation (non-Irrelevant).

### Step 6: Identify and save decisions

Analyze the idea units chronologically (by `turn_index`, then `idea_unit_index`):

1. **Find decision points** — look for idea units with `Decision` category. These mark where participants made or proposed decisions.
2. **Trace the decision arc** — for each decision point, trace backwards and forwards through the idea units to find:
   - **Context** — `Information` and `Position` idea units that set up the problem or need.
   - **Options discussed** — `Position` and `Argument` idea units where participants propose or debate alternatives.
   - **Final decision** — the `Decision` idea unit that represents the agreed-upon outcome. If a decision was proposed early but later revised or overturned by further discussion, the early decision is an alternative option, not the final decision.
3. **Group into decisions** — cluster related idea units into distinct decision records. One topic may contain zero, one, or multiple decisions.

For each identified decision, build a `Decision` object:

- `title` — short descriptive title of what was decided.
- `status` — `"accepted"` for confirmed decisions, `"proposed"` if discussion was inconclusive.
- `context` — a `DecisionContext` with:
  - `text` — one to two sentences summarizing the problem or need that prompted the decision.
  - `supporting_idea_units` — list of `IdeaUnitRef` objects pointing to the context idea units.
- `decision` — a `DecisionOption` with:
  - `text` — what was decided.
  - `rationale` — why this option was chosen.
  - `supporting_idea_units` — list of `IdeaUnitRef` referencing the idea units that support the final decision.
- `alternative_options` — list of `DecisionOption` objects for rejected or superseded alternatives. Each with `text`, `rationale` (why it was considered), and `supporting_idea_units`. May be empty if no alternatives were discussed.

For `IdeaUnitRef`, use the `conversation_id` from the topic's idea unit details (all belong to the current conversation).

Build a `DecisionExtractionResult` JSON object with:
- `topic_id` — the topic's `id`.
- `decisions` — list of `Decision` objects (may be empty if no decisions were found in this topic).

Write the JSON to `{working_dir}/decisions_tmp.json` using the Write tool, then run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/save-topic-decisions.ts <working_dir> {working_dir}/decisions_tmp.json`

### Step 7: Return status

Return `{"has_topic": true, "topic_id": "<reviewed topic's id>"}` to the caller.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly with `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts`.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Always use the Write tool.
- Use Read tool ONLY for data files explicitly listed in this workflow (`review_topic.md`, `decisions_topic.md`). NEVER use Read or Bash to inspect other working directory files or tool-result files.
- NEVER write inline code in Bash. Use only the provided scripts.
- Write only temporary JSON files (e.g. `topic_review_tmp.json`, `decisions_tmp.json`) via the Write tool — scripts handle validation and persistence.
- Only reassign an idea unit when the mismatch is clear. When in doubt, keep it in the current topic.
- NEVER reassign `[prior conversation]` idea units — they are from the knowledge graph and are included for context only.
- When creating new topics, use simple placeholder IDs (e.g. `new-1`, `new-2`). The save script replaces these with real UUIDs.
- Do NOT review or modify topics other than the one loaded in Step 1. Other topics will be reviewed in subsequent iterations.
- Always generate both summaries from ALL idea units provided (including those from prior conversations in the knowledge graph).
- An idea unit with `Decision` category proposed early in discussion is NOT necessarily the final decision. Later discussion may revise or overturn it — treat superseded decisions as alternative options.
- It is valid for a topic to have zero decisions. Still mark the topic as processed with an empty decisions list.
- An idea unit can support multiple decisions (e.g. context shared across related decisions).
- Keep `context.text`, `decision.text`, and `rationale` concise — one to two sentences each.
- Sometimes there are no alternative options and no argument discussion. This is normal — set `alternative_options` to an empty list.
- Generate all titles, summaries, and text fields in the same language as the conversation transcript. Do not switch to English for technical content.
