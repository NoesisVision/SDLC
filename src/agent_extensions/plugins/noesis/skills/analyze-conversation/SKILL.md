---
name: noesis:analyze-conversation
description: Analyze a conversation transcript and integrate it into the knowledge graph. Extracts idea units, assigns topics, generates topic summaries, and captures decisions.
---

# Analyze Conversation

The main agent does the reasoning. Use the Read tool freely to load as much (or as little) of the cleaned transcript as you need to keep output quality high — full document, partial windows, overlapping re-reads — that judgement is yours. The knowledge graph lives in the `noesis-graph` MCP server. Persist via `merge_conversation`; never write graph data directly.

## Setup

Get from `$ARGUMENTS`, ask the user if missing:

- **transcript_path** — absolute path to the raw transcript Markdown.
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

1. Call MCP tool `noesis-graph:list_topics` (no `parent_topic_id`). Read the file path it returns.
2. For each root topic, judge relevance to `<main_topic>` from its title and short summary.
3. For relevant topics with `has_subtopics: yes`, call `noesis-graph:list_topics` with `parent_topic_id: <id>` and apply the Goldilocks rule:
   - **Too broad** — children match more accurately → drop the parent, recurse into matching children.
   - **Too narrow** — children only cover a fraction → keep the parent, ignore the children.
   - **Worse fit** — children are fragmented tangents → keep the parent, abort drill-down.
   - **Just right** — a child comprehensively covers the subject → keep it; still consider its subtopics.
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
- `topics` — list of `Topic` objects covering all non-Irrelevant idea units. Reuse existing topics from `output.json:potential_topics` when they fit; only create new topics when nothing existing fits. Each `Topic`: `{ id, title, short_summary: "", long_summary: "", items: [IdeaUnitRef, ...], decisions: [], reviewed: false, decisions_extracted: false }`. Use a fresh UUID for new topics. Leave summaries empty — they are produced in Step 4.
- For new topics that should sit under an existing parent, append the new entry to `output.json:potential_topics.topics` with `is_new: true` and `parent_id: <existing parent id>` so the merge step can wire the parent.

`IdeaUnitRef`: `{ "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": N, "idea_unit_index": N }`.

Use the Write tool to overwrite `<working_dir>/output.json` with the full populated object. Validate the JSON you produce mentally against the schema described in REFERENCE.

### Step 4: Review topics, generate summaries, extract decisions

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-conversation/references/analyze-topic.md`.

Loop:

1. Call MCP tool `noesis-graph:get_topic_for_review` with `output_path: <working_dir>/output.json`. If the response is `{ "status": "Done" }`, exit the loop.
2. Otherwise it returns `{ "status": "Ok", "file": "<path>.md", topic_id, num_items, has_decision_units, ... }`. Read the file — it lists this topic's idea units (current conversation + prior conversations from the graph, with `[prior conversation]` markers).
3. Decide on summaries and (if `has_decision_units`) decisions per the REFERENCE.
4. Edit `<working_dir>/output.json` (Edit tool) to update this topic in place under `conversation.topics[]`:
   - Set `short_summary` and `long_summary`.
   - Set `decisions` (array of `Decision` — see schema in REFERENCE). Empty array if none.
   - Set `reviewed: true` and `decisions_extracted: true`. These flags drive loop termination.
5. Repeat from sub-step 1.

Do not parallelize. Each iteration depends on the previous edit.

### Step 5: Merge into the knowledge graph

Call MCP tool `noesis-graph:merge_conversation` with `working_dir: <working_dir>`. The server reads `output.json` and persists Conversation, Turns, IdeaUnits, Topics (with parent linking from `potential_topics`), Items, and Decisions.

Report `topics_added`, `topics_updated`, and `decisions_added` to the user.

## Rules

- Read tool is fine for `<cleaned_path>` and any path returned by an MCP tool. Do not browse the working dir.
- Persist graph state only via `noesis-graph` MCP tools. Edit `output.json` directly with Edit/Write.
- Generate all titles, summaries, and free-text fields in the same language as the transcript.
- Reuse before promote: prefer an existing topic over a new one whenever the fit is reasonable.
