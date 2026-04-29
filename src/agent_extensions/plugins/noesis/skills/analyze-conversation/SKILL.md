---
name: noesis:analyze-conversation
description: Analyze a conversation transcript and integrate it into the knowledge graph. Extracts idea units, assigns topics, generates topic summaries, and captures decisions.
---

# Analyze Conversation

The main agent does the reasoning. Use the Read tool freely to load as much (or as little) of the cleaned transcript as you need to keep output quality high — full document, partial windows, overlapping re-reads — that judgement is yours. The knowledge graph lives in the `noesis-graph` MCP server. Persist via `merge_conversation`; never write graph data directly.

## Setup

Get from `$ARGUMENTS`, ask the user if missing:

- **transcript_path** — absolute path to the raw transcript Markdown. If the value is not absolute or the file does not exist at the given path, resolve it via Glob (`**/<basename>`) within the current working directory; if multiple matches exist, ask the user which one. Do not extend `prepare.ts` with a search step — the script remains a strict file consumer.
- **conversation_time** — `YYYY-MM-DD HH:MM:SS`.
- **main_topic** — short description of the conversation's subject.

## Workflow

### Step 1: Prepare

Run `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/conversation/prepare.ts <transcript_path> "<conversation_time>" "<main_topic>"`.

The script generates a stable `conversation_id`, sentence-segments the transcript, writes `<transcript>-cleaned.md` next to the source, creates a private working directory under the plugin's per-project data dir, and initializes `<working_dir>/output.json` (matching `AnalyzeConversationOutput`: `{ conversation: { conversation_id, time, main_topic, turns: [], topics: [] }, potential_topics: { topics: [] } }`).

It returns:
```json
{
  "status": "Ok",
  "working_dir": "<absolute path returned by the script>",
  "conversation_id": "<id>",
  "cleaned_path": "<transcript>-cleaned.md",
  "output_path": "<working_dir>/output.json",
  "num_turns": <n>
}
```

Treat `working_dir` as an opaque absolute path — always use the value returned by the script, never construct it yourself.

Then call MCP tool `noesis-graph:has_conversation` with `conversation_id`. If `exists: true`, report "Conversation already in the graph" and stop.

### Step 2: Find existing topics (Goldilocks)

Goal: identify the existing topics in the graph that already cover the conversation's subject area, so Step 3 can reuse them instead of duplicating.

1. Call MCP tool `noesis-graph:list_topics` (no `parent_topic_id`). Read the file path it returns. The listing is slim — `title`, `short_summary`, `path`, `has_subtopics` only. Use `read_topic` if a row's short summary is not enough to judge relevance.
2. For each root topic, judge relevance to `<main_topic>` from its title and short summary.
3. **Drill every relevant candidate that can be drilled.** For *every* relevant topic with `has_subtopics: yes`, call `noesis-graph:list_topics` with `parent_topic_id: <id>` before promoting that candidate to `potential_topics`. Apply the Goldilocks rule:
   - **Too broad** — children match more accurately → drop the parent, recurse into matching children.
   - **Too narrow** — children only cover a fraction → keep the parent, ignore the children.
   - **Worse fit** — children are fragmented tangents → keep the parent, abort drill-down.
   - **Just right** — a child comprehensively covers the subject → keep it; still recurse into its subtopics if any.

   A candidate may only be added to `potential_topics` once you have either listed its subtopics or confirmed `has_subtopics: no`. Stopping early because "the parent looks fine" is the failure mode this rule prevents — Step 3 will then mis-assign idea units into the parent that actually belonged in a child.
4. Collect candidates as a flat `PotentialTopics` list. Each candidate: `{ id, title, short_summary, path, is_new: false, parent_id }`. May be empty.
5. Edit `<working_dir>/output.json` (Edit tool) to set `potential_topics` to:
```json
{ "topics": [ { "id": "...", "title": "...", "short_summary": "...", "path": ["..."], "is_new": false, "parent_id": null } ] }
```
This list is consumed by `merge_conversation` for parent linking and is the input set for Step 3.

### Step 3: Extract idea units and assign topics

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-conversation/references/extract-topics.md`.

Read `<cleaned_path>` (Read tool — windowing is up to you). Edit `<working_dir>/output.json` to populate `conversation`:

- `conversation_id`, `time`, `main_topic` — already set from Step 1.
- `turns` — one `Turn` per cleaned-md `### [N] <time> — <speaker>` block. Group consecutive sentences within a turn into idea units, assign categories. `IdeaUnit` shape: `{ index, sentences, categories }`.
- `topics` — list of `Topic` objects covering all non-Irrelevant idea units. Reuse existing topics from `output.json:potential_topics` when they fit; only create new topics when nothing existing fits. Each `Topic`: `{ id, title, short_summary: "", long_summary: "", items: [IdeaUnitRef, ...], decisions: [], reviewed: false, decisions_extracted: false }`. For new topics, call MCP tool `noesis-graph:generate_topic_ids` with `{ "count": <number of new topics> }` once you know how many you need; use the returned ids. Leave summaries empty — they are produced in Step 4.
- For every newly-created topic, append an entry to `output.json:potential_topics.topics` with `is_new: true`. Set `parent_id` to the existing parent's id, or to `null` if the topic is a new root. The `id` MUST match the corresponding `conversation.topics[].id`.

`IdeaUnitRef`: `{ "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": N, "idea_unit_index": N }`.

Use the Write tool to overwrite `<working_dir>/output.json` with the full populated object. Then call MCP tool `noesis-graph:validate_output` with `working_dir: <working_dir>`. On `{ "status": "Errors", errors }`, fix the listed paths (each error carries a JSON-pointer-style `path`) and re-validate. Do not advance to Step 4 until the response is `{ "status": "Ok" }`. Treat `warnings` as advisory — they do not block.

### Step 4: Review topics, generate summaries, extract decisions

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-conversation/references/analyze-topic.md`.

1. Call MCP tool `noesis-graph:prepare_review_bundle` with `output_path: <working_dir>/output.json`. The response includes `topic_count`, `topics_with_prior_units`, and a `file` path to the bundle Markdown. Read the bundle with the Read tool.
2. The bundle is a single Markdown document with one section per topic, in **post-order** (leaves first, parents last). Each section is preceded by HTML-comment metadata `<!-- topic_id: ... -->`, `<!-- num_items: ... -->`, `<!-- has_decision_units: ... -->`, and sections are separated by `---`.
3. Process the bundle's sections in the order they appear. For each topic, decide on summaries and (if `has_decision_units`) decisions per the REFERENCE. Container summaries reference what has already been written for children — exactly because the bundle is post-ordered.
4. Once you have processed every section, write all updates in a single `Write` of the entire `<working_dir>/output.json` (avoid `Edit` for `long_summary` fields — see REFERENCE). For each topic under `conversation.topics[]` set:
   - `short_summary` and `long_summary`.
   - `decisions` (array of `Decision` — see schema in REFERENCE). Empty array if none.
   - `reviewed: true` and `decisions_extracted: true`.

If processing reveals that an idea unit belongs to a different topic, update `output.json:conversation.topics[]` accordingly during the same write, and recompute the affected summaries. Reassignment is rare; the entire tree is in front of you, no fresh fetch is needed.

5. Call MCP tool `noesis-graph:validate_output` with `working_dir: <working_dir>` again. Fix and re-validate until `Ok` before proceeding to Step 5.

### Step 5: Merge into the knowledge graph

Call MCP tool `noesis-graph:merge_conversation` with `working_dir: <working_dir>`. The server runs `validate_output` as a pre-flight gate, then reads `output.json` and persists Conversation, Turns, IdeaUnits, Topics (with parent linking from `potential_topics`), Items, and Decisions.

Report `topics_added`, `topics_updated`, and `decisions_added` to the user.

## Rules

- Read tool is fine for `<cleaned_path>` and any path returned by an MCP tool. Do not browse the working dir.
- Persist graph state only via `noesis-graph` MCP tools. Edit `output.json` directly with Edit/Write.
- Generate all titles, summaries, and free-text fields in the same language as the transcript.
- Reuse before promote: prefer an existing topic over a new one whenever the fit is reasonable.
- **Respect user edits.** Before changing any existing topic or decision whose on-disk file is marked `edited_by_user: true`, ask for explicit user acceptance via `AskUserQuestion`. The splitter will skip user-edited files at merge time regardless; this rule additionally surfaces the intended overwrite so the user can keep their version, accept the new one, or merge manually. If the user declines, leave the entity unchanged and route the new evidence elsewhere (different topic, new topic, item-only attachment).
