---
name: noesis:analyze-design-draft
description: Analyze a software design draft (Markdown document) to build the knowledge graph. Extracts topics, decisions, and — when the document describes a domain model — maps Bounded Contexts, Modules, Building Blocks, and Behaviours into a Design Doc. Use to integrate a new design draft into the knowledge graph.
---

# Analyze Design Draft

## Core Principles

- NEVER load the whole document into LLM context. Always work via fragments and chunks.
- Headings are **hints**, not authoritative topics. The final topic structure must respect existing knowledge-graph topics first; promote a heading to a topic only when no existing topic fits.
- A document is treated as a **monologue** — one author, no off-topic noise — but with the same `Topic` / `Decision` / `TopicItem` semantics as a conversation. The atomic item is a **DocumentFragment** (offset range), not an IdeaUnit.
- Reuse existing decisions before creating new ones. Search them with the same hierarchical / Goldilocks logic used for topics.
- Knowledge-graph storage lives in the `noesis-graph` MCP server. The agent never writes to the graph directly.

## Environment

- Run all scripts as: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts <args>`. Do NOT prepend `cd`.
- Do NOT load `REFERENCE-design-doc-schema.md` unless Step 7 is reached (design-model extraction).

## Setup

- **Document path:** Get from `$ARGUMENTS`, ask user if missing. Use for `<document_path>`.
- **Document title:** Get from `$ARGUMENTS`, derive from the document's first `#` heading if absent. Use for `<title>`.
- **Document date:** Get from `$ARGUMENTS`, fall back to today's date in `YYYY-MM-DD`. Use for `<date>`.
- **Main topic:** Get from `$ARGUMENTS`, ask user if missing. Short description used to seed topic search. Use for `<main_topic>`.
- **Design Doc target:** Get one of:
    - `<design_doc_id>` — attach extracted model to an existing Design Doc, OR
    - `<design_doc_title>` — create a new Design Doc with this name.

  If neither is present in `$ARGUMENTS`, ask the user: *"Should I attach the model to an existing Design Doc (provide id) or create a new one (provide title)? Reply with `id=<uuid>` or `title=<name>`. Reply `skip` if the document does not describe a domain model."*

## Workflow

### Step 1: Prepare analysis

Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/documents/prepare-document-analysis.ts <document_path> <title> <date>` plus optional flags `--design_doc_id <id>` and `--design_doc_title <title>` if provided in Setup.

The script:

1. Computes (or reads) a stable `document_id` (UUID embedded as `<!-- document_id: ... -->` in the file's first line).
2. Creates working directory `<document_path>_design_work/` next to the input file.
3. Parses the Markdown into a section tree (`^(#{1,6})\s+(.+)$`, skipping headers inside fenced code blocks) and fragments (paragraph / list / code_block / table / blockquote, with `start_offset`/`end_offset` measured in characters).
4. If no headings are found, treats the whole document as a monologue and fragments by paragraph.
5. Writes `document.json`, `analysis.json`, `section_tree.md`, and chunk files.

Output:
```json
{
  "status": "Ok",
  "working_dir": "<path>",
  "document_id": "<id>",
  "design_doc_id": "<id-or-null>",
  "design_doc_title": "<title-or-null>",
  "section_tree_path": "<path>/section_tree.md",
  "document_path": "<path>/document.json",
  "analysis_path": "<path>/analysis.json",
  "chunks": [
    { "chunk_id": 0, "file": "<path>/chunk_0.md", "fragment_indices": [0, 1, 2], "num_fragments": 3, "section_paths": [["Part 1"]] }
  ]
}
```

Then call MCP tool `noesis-graph:has_document` with `document_id`:
- If `exists: true` AND the user did not pass a Design-Doc target, inform "Document already added" and finish.
- If `exists: true` AND the user passed `<design_doc_id>`/`<design_doc_title>`, skip Steps 2–6 and jump to Step 7 (re-extract design model only).
- Otherwise proceed.

### Step 2: Find existing topics

Invoke the `find-topics` subagent with `<main_topic>` as `<query>` and `<working_dir>`. The subagent reuses the existing hierarchical Goldilocks search and writes `{working_dir}/potential_topics.json`.

### Step 3: Extract topics from chunks

**Loop** — for each chunk from Step 1, invoke the `extract-document-topics` subagent sequentially with `<working_dir>` and `<chunk-id>`. Each chunk file is at `{working_dir}/chunk_{chunk_id}.md`. Do NOT parallelize — each invocation reads the previous chunk's accumulated topics from `analysis.json`.

The subagent assigns each fragment one or more `IdeaUnitCategory` values (`Information`, `Position`, `Argument`, `Decision`, `Irrelevant`) and a topic. Headings are scoring hints, not authoritative. Persistence runs through `scripts/documents/save-chunk-result.ts`.

### Step 4: Find existing decisions

Collect the topic ids touched in Step 3 from `analysis.json`. Invoke the `find-decisions` subagent with `<working_dir>`, the topic id list, and `<main_topic>` as the query. The subagent walks `noesis-graph:list_decisions` per topic and writes `{working_dir}/potential_decisions.json`. May be empty.

### Step 5 & 6: Analyze topics, extract or attach decisions

**Loop** — invoke the `analyze-document-topic` subagent with `<working_dir>`:

1. The subagent calls `noesis-graph:get_topic_for_document_review`. If the response is `{ "status": "Done" }`, exit the loop.
2. Otherwise the subagent reviews fragment-to-topic assignments, regenerates summaries, and (if `has_decision_units` is true) either attaches fragments to an existing decision listed in `potential_decisions.json` (via `AttachToDecision` records) or creates a new `Decision` with `DocumentFragmentRef` supporting items.
3. The subagent returns `{"has_topic": true, "topic_id": "<id>"}` and the loop continues.

Do NOT parallelize — the subagent reads and writes `analysis.json`.

### Step 7: Extract design model (conditional)

Skip this step if the user replied `skip` in Setup. Invoke the `extract-design-model` subagent with `<working_dir>`, `<design_doc_id>` (may be null), and `<design_doc_title>` (may be null). The subagent loads `REFERENCE-design-doc-schema.md`, decides whether the document describes a model, and either writes `{working_dir}/design_doc.json` (returning `{"status": "Ok"}`) or returns `{"status": "NoModel"}`. Persistence happens in Step 8 via `merge_document`.

### Step 8: Merge into the knowledge graph

Call MCP tool `noesis-graph:merge_document` with `working_dir: <working_dir>`. The server reads `document.json`, `analysis.json`, and (if present) `design_doc.json`; persists the Document, upserts topics with parent linking, attaches `DocumentFragmentRef` items, creates new Decisions, applies attachments via `add_items_to_decision`, and (if a design_doc is present) applies it via `save_design_doc`.

Report to the user: `topics_added`, `topics_updated`, `decisions_added`, `decision_attachments`, and Design-Doc counts.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly.
- NEVER use Bash to write files (`cat`, `echo`, heredoc, redirect). Use `>` ONLY to capture script stdout to tmp files. Use the Write tool for all other writes.
- Read tool is reserved for files explicitly listed in this workflow plus the file paths returned in MCP tool responses.
- Query/persist via `noesis-graph` MCP tools — never write graph data directly to disk.
- Generate all titles, summaries, and free-text fields in the same language as the source document.
- Do NOT load `REFERENCE-design-doc-schema.md` unless Step 7 is actually entered.
- A heading is a hint; reuse before promote. A new top-level topic is the rarest outcome.
- An existing decision should be **augmented**, not duplicated. Only create a new decision when the document genuinely introduces a new decision arc.
