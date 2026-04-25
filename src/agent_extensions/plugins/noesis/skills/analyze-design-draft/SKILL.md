---
name: noesis:analyze-design-draft
description: Analyze a software design draft (Markdown document) and integrate it into the knowledge graph. Extracts topics and decisions, attaches new evidence to existing decisions where applicable, and — when the document describes a domain model — captures it as a Design Doc.
---

# Analyze Design Draft

The main agent does the reasoning. Use the Read tool freely to load as much (or as little) of the cleaned document as you need to keep output quality high — full document, partial windows, overlapping re-reads — that judgement is yours. The knowledge graph lives in the `noesis-graph` MCP server. Persist via `merge_document`; never write graph data directly.

A document is a **monologue**: one author, no off-topic noise. The atomic item is a `DocumentFragment` (offset range), not an idea unit. Headings are **hints** — the topic structure must respect existing graph topics first; promote a heading to a topic only when no existing topic fits.

## Setup

Get from `$ARGUMENTS`, ask if missing:

- **document_path** — absolute path to the source Markdown.
- **title** — falls back to the document's first `#` heading or the filename stem.
- **date** — `YYYY-MM-DD`, falls back to today.
- **main_topic** — short description used to seed topic search.
- **Design Doc target** — one of:
  - `design_doc_id` — attach the extracted model to an existing Design Doc.
  - `design_doc_title` — create a new Design Doc with this name.
  - `skip` — the document does not describe a domain model.

  If none provided, ask: *"Should I attach the extracted model to an existing Design Doc (provide id) or create a new one (provide title)? Reply `id=<uuid>`, `title=<name>`, or `skip`."*

- **design_doc_path** — required when not `skip`. Absolute path in the repository where the design doc JSON should be persisted. Ask if missing — suggest `work_items/<name>.json` or similar.

## Workflow

### Step 1: Prepare

Run `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/document/prepare.ts <document_path> "<title>" "<date>"` plus optional flags `--design_doc_id <id>` or `--design_doc_title <title>`.

The script generates a stable `document_id`, writes `<document>-cleaned.md` next to the source (with the id stamped at the top), parses Markdown into a section tree + fragment list (with offsets), creates a private working directory under the plugin's per-project data dir, and initializes `<working_dir>/output.json` (matching `AnalyzeDesignDraftOutput`: `{ document, fragments, section_tree, topics: [], decision_attachments: [], potential_topics: { topics: [] }, design_doc_id, design_doc_title, design_doc_extracted: false }`) plus `<working_dir>/section_tree.md`.

It returns:
```json
{
  "status": "Ok",
  "working_dir": "<absolute path returned by the script>",
  "document_id": "<id>",
  "cleaned_path": "<document>-cleaned.md",
  "output_path": "<working_dir>/output.json",
  "section_tree_path": "<working_dir>/section_tree.md",
  "num_fragments": <n>,
  "design_doc_id": <id|null>,
  "design_doc_title": <title|null>
}
```

Treat `working_dir` as an opaque absolute path — always use the value returned by the script, never construct it yourself.

Then call MCP tool `noesis-graph:has_document` with `document_id`:
- `exists: true` AND no Design-Doc target → "Document already in the graph", stop.
- `exists: true` AND a target was provided → skip Steps 2–5 and jump to Step 6 (re-extract design model only, then merge in Step 7).
- Otherwise proceed.

### Step 2: Find existing topics (Goldilocks)

Identify topics in the graph already covering the document's subject area, so Step 3 can reuse them.

1. Call `noesis-graph:list_topics` (no `parent_topic_id`). Read the returned file.
2. Judge relevance against `<main_topic>`.
3. Drill into relevant topics with `has_subtopics: yes` via `noesis-graph:list_topics` with `parent_topic_id: <id>`. Apply Goldilocks:
   - **Too broad** — children match more accurately → drop the parent, recurse.
   - **Too narrow** — children only cover a fraction → keep the parent.
   - **Worse fit** — children are tangents → keep the parent, abort drill-down.
   - **Just right** — child comprehensively covers the subject → keep it; consider its subtopics.
4. Edit `<working_dir>/output.json`'s `potential_topics` field:
   ```json
   { "topics": [ { "id": "...", "title": "...", "short_summary": "...", "path": ["..."], "is_new": false, "parent_id": null } ] }
   ```
   Empty `topics` array if nothing matches.

### Step 3: Assign categories and topics to fragments

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/references/extract-document-topics.md`.

Read `<cleaned_path>` to understand the document. Read `<output_path>` to see the fragment list (under `fragments`) with `index`, `start_offset`, `end_offset`, `section_path`, `kind`, `text`. Read `<section_tree_path>` for hierarchy hints if useful.

For every fragment:
- Assign one or more categories (`Information`, `Position`, `Argument`, `Decision`, `Irrelevant`).
- For non-Irrelevant fragments, assign a topic — reuse from `output.json:potential_topics` or create a new one (`is_new: true`, sensible `parent_id`, fresh UUID, path). Append every newly-created topic to `potential_topics.topics`.

Edit `<output_path>` (Edit tool):
- For each fragment in `fragments`, set its `categories` array.
- Build `topics: [...]` — one `Topic` per touched topic, each with empty summaries, `items: [DocumentFragmentRef, ...]`, empty `decisions`, `reviewed: false`, `decisions_extracted: false`.

`DocumentFragmentRef`: `{ "type": "document_fragment_ref", "document_id": "<id>", "start_offset": N, "end_offset": N }` — copy `start_offset` / `end_offset` directly from the fragment.

### Step 4: Find existing decisions

Collect every topic id that ended up in `output.json`'s `topics`. For each id, call `noesis-graph:list_decisions` with `topic_id: <id>` and read the returned file. Discard decisions whose context/title is clearly unrelated to `<main_topic>`. When in doubt, keep — Step 5 makes the final per-fragment attach/skip judgement.

If no topic ids were collected (the document maps entirely to new topics), call `noesis-graph:list_decisions` with no filter to scan top-level decisions.

Note candidate decisions for use in Step 5 — keep a working list in your context, no on-disk file needed.

### Step 5: Review topics, generate summaries, extract or attach decisions

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/references/analyze-document-topic.md`.

Loop:

1. Call `noesis-graph:get_topic_for_document_review` with `output_path: <output_path>`. If `{ "status": "Done" }`, exit.
2. Otherwise read the returned file. It contains the topic's fragments (current document + prior documents from the graph, with `[from <doc title>]` markers).
3. Decide on summaries, fragment reassignments, and decisions per the REFERENCE.
4. Edit `<output_path>`: update this topic's `short_summary` / `long_summary` under `topics[]`, set `reviewed: true` and `decisions_extracted: true`. For decisions:
   - **CREATE** new `Decision` records → add them to this topic's `decisions` array.
   - **ATTACH** to an existing decision → append an `AttachToDecision` entry to the top-level `decision_attachments` array.
5. Repeat from sub-step 1.

Do not parallelize. Each iteration depends on the previous edit.

### Step 6: Extract design model (conditional)

Skip if the user replied `skip` in Setup.

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/references/extract-design-model.md` AND `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/references/design-doc-schema.md` (only at this step — these files are large).

Decide whether the document genuinely describes a domain model (Bounded Contexts / Modules / Building Blocks / Behaviours / Quality Attributes / Actors). If it does not, skip the rest of this step.

If `<design_doc_id>` is provided, call `noesis-graph:read_design_doc` with that id, read the returned file, and produce a ChangeSet diff against the cached state. Otherwise produce a first-iteration design with everything in `added`.

Write the validated `DesignDoc` payload directly to `<design_doc_path>` (the user-provided repository location — this file is version-controlled, not transient). Then call MCP tool `noesis-graph:save_design_doc` with `path: <design_doc_path>` to persist it into the knowledge graph. Set `<output_path>`'s `design_doc_extracted: true`.

### Step 7: Merge into the knowledge graph

Call MCP tool `noesis-graph:merge_document` with `working_dir: <working_dir>`. The server reads `output.json` and persists the Document, upserts Topics with parent linking, attaches `DocumentFragmentRef` items, creates Decisions, and applies attachments.

Report `topics_added`, `topics_updated`, `decisions_added`, and `decision_attachments` to the user.

## Rules

- Read tool is fine for `<cleaned_path>`, `<output_path>`, `<section_tree_path>`, `<design_doc_path>`, and any path returned by an MCP tool. Do not browse the working dir for other files.
- Persist graph state only via `noesis-graph` MCP tools. Edit `output.json` / write the design doc JSON to `<design_doc_path>` with Edit/Write.
- Do NOT load `references/design-doc-schema.md` unless Step 6 is actually entered — it is large.
- Generate all titles, summaries, and free-text fields in the same language as the source document.
- Reuse before promote: prefer an existing topic over a new one, an existing decision over a new one, whenever the fit is reasonable.
