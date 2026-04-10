# Extract Decisions

Analyze a single topic's idea units to identify and structure decisions made during the conversation.

## Input

- `<working_dir>` — path to the working directory.
- `<topic_id>` (optional) — specific topic ID to process. If provided, processes that topic. If omitted, processes the next unprocessed topic.

## Workflow

### Step 1: Load topic

1. If `<topic_id>` is provided, run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/load_topic_for_decisions.py <working_dir> --topic-id <topic_id>`.
   Otherwise, run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/load_topic_for_decisions.py <working_dir>`.
2. If `has_topic` is `false`, return `{"has_topic": false}` and stop.
3. Extract `topic` — the topic with its non-Irrelevant idea units.

### Step 2: Identify decisions

Analyze the idea units chronologically (by `turn_index`, then `idea_unit_index`):

1. **Find decision points** — look for idea units with `Decision` category. These mark where participants made or proposed decisions.
2. **Trace the decision arc** — for each decision point, trace backwards and forwards through the idea units to find:
   - **Context** — `Information` and `Position` idea units that set up the problem or need.
   - **Options discussed** — `Position` and `Argument` idea units where participants propose or debate alternatives.
   - **Final decision** — the `Decision` idea unit that represents the agreed-upon outcome. If a decision was proposed early but later revised or overturned by further discussion, the early decision is an alternative option, not the final decision.
3. **Group into decisions** — cluster related idea units into distinct decision records. One topic may contain zero, one, or multiple decisions.

### Step 3: Build decision records

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

### Step 4: Save results

Build a `DecisionExtractionResult` JSON object with:
- `topic_id` — the topic's `id`.
- `decisions` — list of `Decision` objects (may be empty if no decisions were found in this topic).

Write the JSON to `{working_dir}/decisions_tmp.json` using the Write tool, then run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/save_topic_decisions.py <working_dir> {working_dir}/decisions_tmp.json`

### Step 5: Return status

Return `{"has_topic": true}` to the caller.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly with `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/<script.py>` — Python resolves local imports from the script's own directory.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Always use the Write tool.
- NEVER use Read tool or Bash (`cat`, `ls`, `head`) to inspect working directory files. All reads MUST go through the provided scripts.
- Write only temporary JSON files (e.g. `decisions_tmp.json`) via the Write tool — scripts handle validation and persistence.
- An idea unit with `Decision` category proposed early in discussion is NOT necessarily the final decision. Later discussion may revise or overturn it — treat superseded decisions as alternative options.
- It is valid for a topic to have zero decisions. Still mark the topic as processed with an empty decisions list.
- An idea unit can support multiple decisions (e.g. context shared across related decisions).
- Keep `context.text`, `decision.text`, and `rationale` concise — one to two sentences each.
- Sometimes there are no alternative options and no argument discussion. This is normal — set `alternative_options` to an empty list.
- Generate all titles, summaries, and text fields in the same language as the conversation transcript. Do not switch to English for technical content.
