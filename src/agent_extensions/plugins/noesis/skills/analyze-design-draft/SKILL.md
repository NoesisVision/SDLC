---
name: noesis:analyze-design-draft
description: Analyze a software design draft (Markdown document) and integrate it into the knowledge graph. Extracts topics and decisions, attaches new evidence to existing decisions where applicable, and — when the document describes a domain model — captures it as a Design Doc.
---

# Analyze Design Draft

The main agent does the reasoning. Use the Read tool freely to load as much (or as little) of the source document as you need to keep output quality high — full document, partial windows, overlapping re-reads — that judgement is yours. The knowledge graph lives in the `noesis-graph` MCP server. Persist via the dedicated tools — `save_design_doc` for the design model (Step 6) and `merge_document` for topics, fragments, decisions, and attachments (Step 7) — never write graph data directly.

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

- **design_doc_path** — required when not `skip`. Absolute path under `<projectDir>/noesis/design-docs/` where the design doc JSON should be persisted. Default: `<projectDir>/noesis/design-docs/<id-prefix>-<slug>.json` where `<id-prefix>` is the first 8 chars of the design-doc UUIDv7 and `<slug>` is the kebab-case title truncated to 15 chars. The save tool rejects paths outside `noesis/design-docs/`.

## Workflow

### Step 1: Prepare

Run `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/document/prepare.ts <document_path> "<title>" "<date>"` plus optional flags `--design_doc_id <id>` or `--design_doc_title <title>`.

The script generates a `document_id` (or reuses one stamped in the source's first line as `<!-- document_id: X -->`), parses the source Markdown into a section tree + fragment list (with offsets against the raw source), creates a private working directory under the plugin's per-project data dir, and initializes `<working_dir>/output.json` (matching `AnalyzeDesignDraftOutput`: `{ document, fragments, section_tree, topics: [], decision_attachments: [], potential_topics: { topics: [] }, design_doc_id, design_doc_title, design_doc_extracted: false }`) plus `<working_dir>/section_tree.md`. The source file is **not** modified and **no** sidecar file is written next to it.

It returns:
```json
{
  "status": "Ok",
  "working_dir": "<absolute path returned by the script>",
  "document_id": "<id>",
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

Prefer `<section_tree_path>` for structural questions and selective fragment reads from `<output_path>` for content questions. Only read `<document_path>` (the source) end-to-end when you need flowing narrative across sections; otherwise an end-to-end read of a 50 KB document is wasted work.

Read `<output_path>` to see the fragment list (under `fragments`) with `index`, `start_offset`, `end_offset`, `section_path`, `kind`, `text`.

For every fragment:
- Assign one or more categories (`Information`, `Position`, `Argument`, `Decision`, `Irrelevant`).
- For non-Irrelevant fragments, assign a topic — reuse from `output.json:potential_topics` or create a new one (`is_new: true`, sensible `parent_id`, fresh UUID, path). Append every newly-created topic to `potential_topics.topics`.

Edit `<output_path>` (Edit tool):
- For each fragment in `fragments`, set its `categories` array.
- Build `topics: [...]` — one `Topic` per touched topic, each with empty summaries, `items: [DocumentFragmentRef, ...]`, empty `decisions`, `reviewed: false`, `decisions_extracted: false`.

`DocumentFragmentRef`: `{ "type": "document_fragment_ref", "document_id": "<id>", "start_offset": N, "end_offset": N }` — copy `start_offset` / `end_offset` directly from the fragment.

#### Bulk-edit pattern

For documents with >100 fragments, editing `output.json` line-by-line with the Edit tool is impractical (250-KB files do not respond well to hundreds of precise edits). Write a short Python helper next to `output.json` (load JSON → mutate in memory → dump JSON) and invoke it via Bash. Re-use the same helper across iterations. Do **not** write helpers speculatively — only when you have a concrete bulk operation in hand.

#### Decision-coverage check

After categorising, run:

```
bun run ${CLAUDE_PLUGIN_ROOT}/scripts/document/check-decision-coverage.ts <output_path>
```

The script flags sections whose heading matches `decision|adr|reguły|polityka` and have <30% Decision-categorised fragments. If it warns, revisit those sections — narrative decisions (`ponieważ`, `zamiast`, `zdecydowaliśmy się na`, `we chose`, `rather than`) are easy to miss when scanning for explicit `Decision:`-shaped paragraphs. The script exits 0 either way; the warning is informational.

### Step 4: Find existing decisions

Collect every topic id that ended up in `output.json`'s `topics`. For each id, call `noesis-graph:list_decisions` with `topic_id: <id>` and read the returned file. Discard decisions whose context/title is clearly unrelated to `<main_topic>`. When in doubt, keep — Step 5 makes the final per-fragment attach/skip judgement.

If no topic ids were collected (the document maps entirely to new topics), call `noesis-graph:list_decisions` with no filter to scan top-level decisions.

Note candidate decisions for use in Step 5 — keep a working list in your context, no on-disk file needed.

### Step 5: Review topics, generate summaries, extract or attach decisions

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/references/analyze-document-topic.md`.

Two execution modes:

**Iterative** (default — use when ≤10 unreviewed topics remain):

1. Call `noesis-graph:get_topic_for_document_review` with `output_path: <output_path>`. If `{ "status": "Done" }`, exit.
2. Otherwise read the returned file. It contains the topic's fragments (current document + prior documents from the graph, with `[from <doc title>]` markers).
3. Decide on summaries, fragment reassignments, and decisions per the REFERENCE.
4. Edit `<output_path>`: update this topic's `short_summary` / `long_summary` under `topics[]`, set `reviewed: true` and `decisions_extracted: true`. For decisions:
   - **CREATE** new `Decision` records → add them to this topic's `decisions` array.
   - **ATTACH** to an existing decision → append an `AttachToDecision` entry to the top-level `decision_attachments` array.
5. Repeat from sub-step 1.

**Batch** (use when >10 unreviewed topics remain):

1. Call `noesis-graph:list_unreviewed_topics_for_document` with `output_path: <output_path>`. The tool returns one tmp file containing every unreviewed topic's enriched view (current + prior-document fragments, with `[from <doc>]` markers) separated by `<!-- topic_id: ... -->` headers.
2. Read the bundle. For each topic, decide summaries / reassignments / decisions per the REFERENCE.
3. Apply all updates to `<output_path>` in one Edit/Write pass (typically via the bulk-edit helper from Step 3).
4. **Per-topic verification is mandatory**: walk every topic you wrote a summary for and confirm any `[from <doc title>]` prior-document fragments were folded into the summary. The batch shortcut is only safe if this pass actually happens.

In both modes: each topic's `reviewed: true` and `decisions_extracted: true` flags must be flipped, the `short_summary` / `long_summary` regenerated from current+prior fragments, and decisions either CREATE-d locally or ATTACH-ed via `decision_attachments`.

### Step 6: Extract design model (conditional)

Skip if the user replied `skip` in Setup.

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/references/extract-design-model.md` AND `${CLAUDE_PLUGIN_ROOT}/shared-contracts/design-doc-schema.md` (only at this step — these files are large).

Decide whether the document genuinely describes a domain model (Bounded Contexts / Modules / Building Blocks / Behaviours, with Rules, Scenarios and Quality Attributes nested at the level they apply). Actors are graph-global and attach only to `application_service` behaviours via `behaviour.actor`. If the document describes none of this, skip the rest of this step.

Before extracting, call `noesis-graph:list_actors` and keep the catalog handy — it is the source of truth for `behaviour.actor` reuse. Introduce a new actor only when no existing entry fits, and register it with `noesis-graph:upsert_actor({ name, description })` **before** `save_design_doc`.

If `<design_doc_id>` is provided, call `noesis-graph:read_design_doc` with that id, read the returned file, and produce a ChangeSet diff against the cached state. The rendering's header line `Implemented: yes/no` tells you whether the doc has been sealed by `implement-design-doc`. **If `Implemented: yes`, stop the normal flow** and ask the user via `AskUserQuestion` whether to (a) create a brand new design doc instead (drop the supplied id and switch to `design_doc_title`, then call `noesis-graph:prepare_design_doc_path` with only `{ name }` for a fresh id), or (b) skip the design-extraction step entirely and proceed only with topic / decision merge in Step 7. Otherwise produce a first-iteration design with everything in `added`.

Before writing JSON, call `noesis-graph:prepare_design_doc_path` with `{ name, id? }` (id when iterating, omit when creating). The tool returns either `{ status: "Ok", id, canonical_path }` or `{ status: "AlreadyImplemented", design_doc_id, name }` — apply the same branch as above on `AlreadyImplemented`.

Write the validated `DesignDoc` payload directly to `<design_doc_path>` (canonical, under `noesis/design-docs/`). For every new actor referenced by any `behaviour.actor`, call `noesis-graph:upsert_actor` first — `save_design_doc` validates that referenced actors exist in the catalog and that actors only appear on `application_service` behaviours. Then call MCP tool `noesis-graph:save_design_doc` with `path: <design_doc_path>` and `confirmed_edits: []` (or the approved paths when overriding user-edited elements — see the **Respect user edits** Rule). The tool returns `{ status: "Ok", design_doc_id, canonical_path }` on success, or `{ status: "AlreadyImplemented", design_doc_id, name }` if the doc was sealed between checks (handle as above). On rename, `canonical_path` may differ from the input path and the input is removed. Validation or storage failures surface as a tool error — fix the input and call the tool again. Once the save succeeds, set `<output_path>`'s `design_doc_extracted: true`.

### Step 7: Merge into the knowledge graph

Call MCP tool `noesis-graph:merge_document` with `working_dir: <working_dir>`. The server reads `output.json` and persists the Document, upserts Topics with parent linking, attaches `DocumentFragmentRef` items, creates Decisions, and applies attachments.

Report `topics_added`, `topics_updated`, `decisions_added`, and `decision_attachments` to the user.

## Rules

- Read tool is fine for `<document_path>` (the source), `<output_path>`, `<section_tree_path>`, `<design_doc_path>`, and any path returned by an MCP tool. Do not browse the working dir for other files.
- Persist graph state only via `noesis-graph` MCP tools. Edit `output.json` / write the design doc JSON to `<design_doc_path>` with Edit/Write.
- Do NOT load `${CLAUDE_PLUGIN_ROOT}/shared-contracts/design-doc-schema.md` unless Step 6 is actually entered — it is large.
- Generate all titles, summaries, and free-text fields in the same language as the source document.
- Reuse before promote: prefer an existing topic over a new one, an existing decision over a new one, whenever the fit is reasonable.
- **Respect user edits.** Before changing any existing topic, decision, or design-doc element whose on-disk record is marked `edited_by_user: true`, ask for explicit user acceptance via `AskUserQuestion`. For design-doc elements, pass each approved element-path in the `confirmed_edits` array of `save_design_doc`; the save rejects user-edited overrides that are not in that list. **Never include a path in `confirmed_edits` without explicit user approval.** For topics/decisions, the splitter still skips files flagged `edited_by_user: true` at the file level. If the user declines, leave the entity unchanged and route the new evidence elsewhere (different topic, new topic, item-only attachment, or skip the design-doc update).
