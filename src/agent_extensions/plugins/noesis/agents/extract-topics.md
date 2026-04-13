# Extract Topics

Analyze a chunk of conversation turns: split into idea units, assign categories, and assign or create topics.

## Input

- `<working_dir>` — path to the working directory.
- `<structured_transcript_path>` — path to the structured transcript JSON.
- `<token_limit>` — approximate token budget for the chunk.

## Workflow

### Step 1: Load data

1. Run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/load_transcript_chunk.py <working_dir> <structured_transcript_path> <token_limit>`. This prints a short status JSON with `has_more`, `num_turns`, and `chunk_path`. The actual turns are written to `{working_dir}/chunk_turns.json`.
2. If `num_turns` is 0, return `{"has_more": false}` and stop.
3. Read the chunk turns from `{working_dir}/chunk_turns.json` using the Read tool.
4. Read `{working_dir}/possible_topics.json` via: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/read_possible_topics.py <working_dir>`.

### Step 2: Analyze turns

For each turn in the chunk, analyze its sentences:

1. **Split into Idea Units** — group consecutive sentences that form a cohesive unit of meaning. Each sentence belongs to exactly one idea unit. Assign sequential indices starting from 0 within the turn.
2. **Assign categories** — for each idea unit, assign one or more `IdeaUnitCategory` values: `Information`, `Position`, `Argument`, `Decision`, `Irrelevant`. Most idea units have one category, but some may have multiple (e.g. an argument that also contains a decision).
3. **Assign topic** — for each idea unit (except `Irrelevant`), match it to a topic:
   - If an existing topic from `possible_topics` fits, use its `id`.
   - If an existing topic fits but the idea unit starts a more specific subtopic, create a new subtopic: generate a UUID for `id`, set `is_new: true`, set `parent_id` to the existing topic's `id`, generate a `title` and short `short_summary`, build `path` by appending the new title to the parent's path.
   - If no existing topic fits, create a new root topic: generate a UUID for `id`, set `is_new: true`, set `parent_id` to `null`, generate a `title` and short `short_summary`, set `path` to `[title]`.

### Step 3: Save results

Build a `ChunkResult` JSON object with:
- `turns` — list of `Turn` objects, each with `index` (from loaded chunk), `speaker`, `time`, and `idea_units` (list of `IdeaUnit` with `index`, `sentences`, `categories`).
- `assignments` — list of `IdeaUnitTopicAssignment` objects, each with `turn_index`, `idea_unit_index`, `topic_id`.
- `new_topics` — list of `PotentialTopic` objects for any newly created topics (with `is_new: true`).

Write the JSON to `{working_dir}/chunk_result_tmp.json` using the Write tool, then run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/save_chunk_result.py <working_dir> {working_dir}/chunk_result_tmp.json`

### Step 4: Return status

Return `{"has_more": <value from step 1>}` to the caller.

## Irrelevant Category

Mark idea units as `Irrelevant` when they contain:
- Off-topic remarks unrelated to the conversation subject
- Greetings, farewells, and social pleasantries
- Organizational concerns (scheduling, room booking, meeting logistics)
- Meeting infrastructure problems (audio issues, screen sharing, connection drops)
- Filler speech with no substantive content

Everything not connected with IT system design, architecture, requirements, or technical discussion should be `Irrelevant`. Do NOT assign topics to `Irrelevant` idea units.

## Topic Granularity

- Prefer assigning idea units to existing topics over creating new ones. Create a new topic only when the idea unit introduces a clearly distinct concept that doesn't fit any existing topic — not just a minor detail within an existing topic.
- Do NOT create a subtopic for a single idea unit unless it represents a self-contained concept likely to recur in future conversations.
- Keep direct children of any parent topic under 10. If a parent already has 8+ children, consider whether the new topic fits as a subtopic of an existing sibling rather than a new direct child, or whether an intermediate grouping topic should be created to cluster related siblings.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly with `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/<script.py>` — Python resolves local imports from the script's own directory.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Always use the Write tool.
- Use Read tool ONLY for data files explicitly listed in this workflow (`chunk_turns.json`). NEVER use Read or Bash to inspect other working directory files or tool-result files.
- NEVER write inline Python code in Bash (e.g. `python3 -c "..."`). Use only the provided scripts.
- Write only temporary JSON files (e.g. `chunk_result_tmp.json`) via the Write tool — scripts handle validation and persistence.
- Do NOT skip `Irrelevant` idea units — still create them with the category, just skip topic assignment.
- Idea unit indices are sequential within each turn, starting from 0.
- Turn indices come from the loaded chunk data (they are the original transcript indices).
- When creating new topic UUIDs, use standard UUID v4 format.
- Generate all titles, summaries, and text fields in the same language as the conversation transcript. Do not switch to English for technical content.
