# Extract Document Topics

Analyze a chunk of document fragments: assign categories, and assign or create topics.

## Input

- `<working_dir>` — path to the working directory.
- `<chunk-id>` — numeric ID of the chunk to process.

## Workflow

### Step 1: Load data

1. Read the chunk from `{working_dir}/chunk_{chunk_id}.md` using the Read tool. The file is markdown grouped by section:
   ```
   ## Section: <section path>

   ### [F<index>] <kind> _(offsets <start>-<end>)_
   <fragment text>
   ```
2. If the chunk file is empty or has no fragments, return and stop.
3. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/read-potential-topics.ts <working_dir> > {working_dir}/tmp_potential_topics.json`.
4. Read `{working_dir}/tmp_potential_topics.json` using the Read tool.

### Step 2: Analyze fragments

For each fragment in the chunk:

1. **Assign categories** — assign one or more `IdeaUnitCategory` values: `Information`, `Position`, `Argument`, `Decision`, `Irrelevant`. Most fragments in design drafts are `Information`. Use `Decision` when the fragment states a chosen approach with rationale (e.g. "Use X because Y", "Decision: …", explicit trade-offs landing on a choice). Use `Irrelevant` only for genuinely off-topic fragments (rare in author-curated documents — boilerplate, pure rhetoric, uncited tangents).
2. **Assign topic** — for each fragment (except `Irrelevant`), match it to a topic:
   - Treat the fragment's `section_path` as a HINT, not authoritative — section headings often align with topics, but a single section may belong under one existing topic, or split into multiple subtopics, or be merged with sibling sections.
   - If an existing topic from `potential_topics` fits, use its `id`.
   - If an existing topic fits but the fragment starts a more specific subtopic, create a new subtopic: use a placeholder `id` (e.g. `new-1`, `new-2` — the save script replaces with real UUIDs), set `is_new: true`, set `parent_id` to the existing topic's `id`, generate a `title` and `short_summary`, build `path` by appending the new title to the parent's path.
   - If no existing topic fits, create a new root topic: placeholder `id`, `is_new: true`, `parent_id: null`, generate `title` and `short_summary`, set `path` to `[title]`.

### Step 3: Save results

Build a `ChunkResult` JSON object with:
- `fragment_categories` — list of `{fragment_index, categories}` pairs (one entry per processed fragment, including those marked `Irrelevant`).
- `assignments` — list of `{fragment_index, topic_id}` entries for non-`Irrelevant` fragments only.
- `new_topics` — list of `PotentialTopic` objects for any newly created topics (with `is_new: true`).

Write the JSON to `{working_dir}/chunk_result_tmp.json` using the Write tool, then run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/documents/save-chunk-result.ts <working_dir> {working_dir}/chunk_result_tmp.json`

## Topic Hierarchy

Think of topics as **chapters in a system design document**. A software architect looking for information about a specific concept should be able to navigate the topic tree intuitively. Use this test: "Would a software architect expect to find this under [parent topic]?"

**Structure:** Build a tree of 2–3 levels:
- **Root topics** — high-level business or system domains (e.g. "Inventory Management", "Pricing", "User Authentication"). A document typically maps to 1–5 root topics, rarely more.
- **Functional areas** — children of root topics covering distinct functional concerns.
- **Specific topics** — leaf-level topics for narrow, self-contained concepts likely to recur in future analyses.

**Rules:**
- **Reuse before creating.** Always check existing topics (including their subtopics) before creating a new root. Most fragments belong under an existing topic.
- **Aim for 3–7 children** per parent.
- **Create intermediate groupings proactively.** When two or more new subtopics are related, create a grouping parent rather than adding them flat alongside unrelated siblings.
- **Do NOT create a subtopic for a single fragment** unless it represents a self-contained concept likely to recur.
- **Depth over breadth.** A deep, well-organized tree with 3–5 roots is better than a flat list of 10+ roots.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly with `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts`.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Use `>` ONLY to capture script stdout to tmp files. Use the Write tool for all other file writes.
- Use Read tool ONLY for data files explicitly listed in this workflow (`chunk_{chunk_id}.md`, `tmp_potential_topics.json`). NEVER use Read or Bash to inspect other working directory files.
- NEVER write inline code in Bash. Use only the provided scripts.
- Write only temporary JSON files (e.g. `chunk_result_tmp.json`) via the Write tool — scripts handle validation and persistence.
- Always emit a `fragment_categories` entry for every processed fragment (even `Irrelevant` ones). Skip topic assignment only for `Irrelevant` fragments.
- Fragment indices come from the `[F<index>]` markers in the chunk file.
- When creating new topics, use simple placeholder IDs (e.g. `new-1`, `new-2`). The save script replaces these with real UUIDs.
- Generate all titles, summaries, and text fields in the same language as the source document. Do not switch to English for technical content.
