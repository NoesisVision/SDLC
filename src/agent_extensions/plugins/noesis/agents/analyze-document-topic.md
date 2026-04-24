# Analyze Document Topic

Review a single topic from the document analysis — check fragment coherence, generate summaries, and extract decisions or attach fragments to existing decisions.

## Input

- `<working_dir>` — path to the working directory.

## Workflow

### Step 1: Load topic for review

1. Call MCP tool `noesis-graph:get_topic_for_document_review` with `analysis_path: {working_dir}/analysis.json`. The response is JSON:
   - If it is `{ "status": "Done" }`, return `{"has_topic": false}` and stop.
   - Otherwise it is `{ "status": "Ok", "file": "<path>.md", ... }`. Read the `file` path with the Read tool. The file starts with HTML-comment metadata (`topic_id`, `num_items`, `has_decision_units`) followed by the enriched topic Markdown:
     ```
     <!-- topic_id: <id> -->
     <!-- num_items: <n> -->
     <!-- has_decision_units: true|false -->

     # <topic title>
     - **ID:** <topic_id>
     - **Document:** <document_id>
     - **Summary:** <short_summary>
     - **Long summary:** <long_summary>

     ## Fragments

     ### [F<fragment_index>] <section_path> — <kind> [<categories>]
     <fragment text>
     ```
   - Purely Irrelevant fragments are already filtered out. Fragments prefixed with `[from <doc title>]` come from prior documents in the knowledge graph — use them for context when generating summaries, but do NOT reassign them (they belong to a different document).
2. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/read-potential-topics.ts <working_dir> > {working_dir}/tmp_potential_topics.json`.
3. Read `{working_dir}/tmp_potential_topics.json` using the Read tool.
4. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/documents/read-potential-decisions.ts <working_dir> > {working_dir}/tmp_potential_decisions.json`.
5. Read `{working_dir}/tmp_potential_decisions.json` using the Read tool.

### Step 2: Evaluate fragment coherence

For each fragment in the topic:

1. **Check internal coherence** — does this fragment belong to this topic given the topic's `title` and `short_summary`? Consider the fragment's `text`, `section_path`, and `categories`.
2. **Check for better fit** — scan `potential_topics` to see if another topic is a more accurate match. Only reassign when the alternative clearly fits better, not when the match is marginal.
3. **Handle orphaned fragments** — if a fragment does not fit this topic AND no existing potential topic is a good match, create a new topic: placeholder `id` (e.g. `new-1`), `is_new: true`, `parent_id: null` (or an existing topic's `id` if subtopic), generate `title`/`short_summary`, set `path` to the topic's hierarchical path.

Collect all reassignments and any new topics to create.

### Step 3: Generate topic summaries

Generate two summaries based on the fragments remaining after excluding any you marked for reassignment in Step 2. Include `[from <doc title>]` prior fragments as context:

1. **`short_summary`** (max 3 sentences) — concise summary optimized for search. Should let an LLM quickly determine whether this topic is relevant to a given query. Focus on the key subject, scope, and distinguishing aspects.
2. **`long_summary`** (10–20 sentences) — knowledge summary for coding agents preparing design documents. Focus on:
   - **Requirements** — what the system must do, business rules, constraints.
   - **Design decisions** — what was decided and why (rationale, trade-offs).
   - **Domain concepts** — definitions, relationships between entities, terminology.
   - **System behavior** — expected flows, edge cases, error handling.

   Do NOT describe the document itself — no "the document explains", "the author proposes". Write as established knowledge, not a summary of prose.

If all current-document fragments are reassigned away and only prior-document fragments remain, set both summaries to empty strings.

### Step 4: Save review result

Build a `TopicReviewResult` JSON object with:
- `topic_id`
- `short_summary`
- `long_summary`
- `reassignments` — list of `{fragment_index, new_topic_id}` entries.
- `new_topics` — list of `PotentialTopic` objects for any newly created topics (with `is_new: true`).

Write to `{working_dir}/topic_review_tmp.json` using the Write tool, then run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/documents/save-topic-review.ts <working_dir> {working_dir}/topic_review_tmp.json`

### Step 5: Extract or attach decisions (conditional)

If `has_decision_units` (from Step 1 metadata) is `false`, skip to Step 6.

1. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/documents/load-topic-for-decisions.ts <working_dir> --topic_id <topic_id> > {working_dir}/tmp_decisions_status.json`. The enriched topic is written to `{working_dir}/decisions_topic.md`.
2. Read `{working_dir}/tmp_decisions_status.json` and `{working_dir}/decisions_topic.md` using the Read tool. Same markdown format as Step 1, but only fragments from the current document (non-Irrelevant).

3. **For each `Decision`-category fragment, decide first whether to ATTACH or CREATE:**
   - **ATTACH** to an existing decision in `potential_decisions.json` if the document fragment plainly belongs to that decision's arc — provides additional context, articulates an alternative not yet captured, or strengthens the rationale. Build an `AttachToDecision` record:
     - `decision_id` — the existing decision's id.
     - `slot` — `"context"`, `"decision"`, or `"alternative"`.
     - `alternative_index` — required when `slot === "alternative"`; the 0-based index of the alternative being augmented (read it via `noesis-graph:read_decision` if you don't already know).
     - `fragment_indices` — list of fragment indices supporting the attachment.
   - **CREATE** a new `Decision` if the fragment introduces a decision arc that is not yet in the graph. Trace context (`Information`/`Position` fragments) and alternatives (`Position`/`Argument` fragments) within this topic. Build a `Decision` object using `DocumentFragmentRef` for `supporting_items`:
     ```json
     {"type": "document_fragment_ref", "document_id": "<doc_id>", "start_offset": <n>, "end_offset": <n>}
     ```
     Use the offsets shown in the fragment header. The `document_id` matches the topic's `Document:` field.

4. Build a `DecisionExtractionResult` JSON object:
   ```json
   {
     "topic_id": "<id>",
     "decisions": [Decision, ...],
     "attachments": [AttachToDecision, ...]
   }
   ```

5. Write to `{working_dir}/decisions_tmp.json` using the Write tool, then run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/documents/save-topic-decisions.ts <working_dir> {working_dir}/decisions_tmp.json`

### Step 6: Return status

Return `{"has_topic": true, "topic_id": "<reviewed topic's id>"}` to the caller.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly.
- NEVER use Bash to write files. Use `>` ONLY to capture script stdout to tmp files. Use the Write tool for all other file writes.
- Use Read tool ONLY for files explicitly listed in this workflow plus paths returned in MCP tool responses. NEVER use Read or Bash to inspect other working directory files.
- Query the knowledge graph ONLY via `noesis-graph` MCP tools. Read-style tools return a tmp file path — always read that file with the Read tool.
- Write only temporary JSON files (e.g. `topic_review_tmp.json`, `decisions_tmp.json`) via the Write tool — scripts handle validation and persistence.
- Only reassign a fragment when the mismatch is clear. When in doubt, keep it.
- NEVER reassign `[from <doc title>]` fragments — they belong to other documents.
- When creating new topics, use simple placeholder IDs (e.g. `new-1`). The save script replaces these with real UUIDs.
- Do NOT review or modify topics other than the one loaded in Step 1.
- Always generate both summaries from ALL fragments provided (including prior-document context).
- Prefer ATTACH over CREATE when augmenting an existing decision arc — duplicating decisions hurts the knowledge graph.
- Keep `context.text`, `decision.text`, and `rationale` concise — one to two sentences each.
- Generate all titles, summaries, and text fields in the same language as the source document.
