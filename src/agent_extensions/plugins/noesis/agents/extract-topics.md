# Extract Topics

Analyze a chunk of conversation turns: split into idea units, assign categories, and assign or create topics.

## Input

- `<working_dir>` — path to the working directory.
- `<chunk-id>` — numeric ID of the chunk to process.

## Workflow

### Step 1: Load data

1. Read the chunk from `{working_dir}/chunk_{chunk_id}.md` using the Read tool. The file is markdown with one section per turn:
   ```
   ### [<index>] <time> — <speaker>
   - <sentence 1>
   - <sentence 2>
   ```
2. If the chunk file is empty or has no turns, return and stop.
3. Read `{working_dir}/potential_topics.json` via: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/read-potential-topics.ts <working_dir>`.

### Step 2: Analyze turns

For each turn in the chunk, analyze its sentences:

1. **Split into Idea Units** — group consecutive sentences that form a cohesive unit of meaning. Each sentence belongs to exactly one idea unit. Assign sequential indices starting from 0 within the turn.
2. **Assign categories** — for each idea unit, assign one or more `IdeaUnitCategory` values: `Information`, `Position`, `Argument`, `Decision`, `Irrelevant`. Most idea units have one category, but some may have multiple (e.g. an argument that also contains a decision).
3. **Assign topic** — for each idea unit (except `Irrelevant`), match it to a topic:
   - If an existing topic from `potential_topics` fits, use its `id`.
   - If an existing topic fits but the idea unit starts a more specific subtopic, create a new subtopic: use a placeholder `id` (e.g. `new-1`, `new-2` — the save script will replace with real UUIDs), set `is_new: true`, set `parent_id` to the existing topic's `id`, generate a `title` and short `short_summary`, build `path` by appending the new title to the parent's path.
   - If no existing topic fits, create a new root topic: use a placeholder `id` (e.g. `new-1`), set `is_new: true`, set `parent_id` to `null`, generate a `title` and short `short_summary`, set `path` to `[title]`.

### Step 3: Save results

Build a `ChunkResult` JSON object with:
- `turns` — list of `Turn` objects, each with `index` (from loaded chunk), `speaker`, `time`, and `idea_units` (list of `IdeaUnit` with `index`, `sentences`, `categories`).
- `assignments` — list of `IdeaUnitTopicAssignment` objects, each with `turn_index`, `idea_unit_index`, `topic_id`.
- `new_topics` — list of `PotentialTopic` objects for any newly created topics (with `is_new: true`).

Write the JSON to `{working_dir}/chunk_result_tmp.json` using the Write tool, then run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/save-chunk-result.ts <working_dir> {working_dir}/chunk_result_tmp.json`

## Irrelevant Category

Mark idea units as `Irrelevant` when they contain:
- Off-topic remarks unrelated to the conversation subject
- Greetings, farewells, and social pleasantries
- Organizational concerns (scheduling, room booking, meeting logistics)
- Meeting infrastructure problems (audio issues, screen sharing, connection drops)
- Filler speech with no substantive content

Everything not connected with IT system design, architecture, requirements, or technical discussion should be `Irrelevant`. Do NOT assign topics to `Irrelevant` idea units.

## Topic Hierarchy

Think of topics as **chapters in a system design document**. A software architect looking for information about a specific concept should be able to navigate the topic tree intuitively. Use this test: "Would a software architect expect to find this under [parent topic]?"

**Structure:** Build a tree of 2–3 levels:
- **Root topics** — high-level business or system domains (e.g. "Inventory Management", "Pricing", "User Authentication"). A conversation typically has 2–5 root topics, rarely more.
- **Functional areas** — children of root topics covering distinct functional concerns (e.g. under "Pricing": "Cost Calculation", "Currency Handling", "Discount Rules").
- **Specific topics** — leaf-level topics for narrow, self-contained concepts that are likely to recur in future conversations.

**Rules:**
- **Reuse before creating.** Always check existing topics (including their subtopics) before creating a new root. Most idea units belong under an existing topic.
- **Aim for 3–7 children** per parent. If a parent is approaching 7 children, look for related siblings that could be grouped under a new intermediate topic.
- **Create intermediate groupings proactively.** When two or more new subtopics are related (e.g. "Import duties" and "Customs clearance" both relate to cross-border costs), create a grouping parent rather than adding them flat alongside unrelated siblings.
- **Do NOT create a subtopic for a single idea unit** unless it represents a self-contained concept likely to recur in future conversations.
- **Depth over breadth.** A deep, well-organized tree with 3–5 roots is better than a flat list of 10+ roots. If you have created more than 5 root topics, reconsider whether some could be grouped under a shared parent.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly with `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts`.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Always use the Write tool.
- Use Read tool ONLY for data files explicitly listed in this workflow (`chunk_{chunk_id}.md`). NEVER use Read or Bash to inspect other working directory files or tool-result files.
- NEVER write inline code in Bash. Use only the provided scripts.
- Write only temporary JSON files (e.g. `chunk_result_tmp.json`) via the Write tool — scripts handle validation and persistence.
- Do NOT skip `Irrelevant` idea units — still create them with the category, just skip topic assignment.
- Idea unit indices are sequential within each turn, starting from 0.
- Turn indices come from the loaded chunk data (they are the original transcript indices).
- When creating new topics, use simple placeholder IDs (e.g. `new-1`, `new-2`). The save script replaces these with real UUIDs.
- Generate all titles, summaries, and text fields in the same language as the conversation transcript. Do not switch to English for technical content.
