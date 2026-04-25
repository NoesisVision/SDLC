# Find Decisions

Find existing decisions in the knowledge graph that could be augmented by the analyzed document. Returns the decisions whose context, decision, or rationale plausibly relate to the document's main topic and the topics touched in this analysis.

## Input

- `<working_dir>` — path to the working directory.
- `<topic_ids>` — JSON array of topic ids to inspect (typically the topics touched during topic extraction).
- `<query>` — short description of the document's main topic.

## Workflow

### Step 1: Collect candidate decisions

For each topic id in `<topic_ids>`:

1. Call MCP tool `noesis-graph:list_decisions` with `topic_id: <id>`. The response is JSON `{ "file": "<path>.md", ... }`. Read that file with the Read tool — it is Markdown with one `##` section per decision (id, topic, status, context).
2. Collect the (decision_id, topic_id, title, status, short context) tuples.

If `<topic_ids>` is empty, also call `noesis-graph:list_decisions` with no `topic_id` to get an unfiltered list — but only do this when no topic context is available.

### Step 2: Evaluate relevance

Discard decisions whose title and context summary are clearly unrelated to `<query>`. A decision is **potentially relevant** when its context or decision text touches the same domain concept, problem, or design choice the document discusses. When in doubt, keep it — Step 5 of the parent skill (`analyze-document-topic`) makes the final attach/skip call per fragment.

### Step 3: Save results

Build a `PotentialDecisions` JSON object:
```json
{
  "decisions": [
    {
      "id": "<decision_id>",
      "topic_id": "<topic_id>",
      "title": "<decision title>",
      "status": "<accepted|proposed>",
      "short_summary": "<one sentence: what was decided + key context>"
    }
  ]
}
```

If no relevant decisions were found, write `{"decisions": []}`.

Write the JSON to `{working_dir}/potential_decisions_tmp.json` using the Write tool, then run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/documents/save-potential-decisions.ts <working_dir> {working_dir}/potential_decisions_tmp.json`

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Use the Write tool for JSON inputs that scripts read.
- Query the knowledge graph ONLY via `noesis-graph:list_decisions` / `noesis-graph:read_decision`. Both return a tmp file path in their JSON response — always read that file with the Read tool.
- Prefer precision over recall. A smaller list of accurate matches is better than a broad list of vague ones.
- Do NOT load `read_decision` for every decision — only for the ones you cannot judge from `list_decisions` alone.
