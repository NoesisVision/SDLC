---
name: noesis:search-topics
description: Search the knowledge graph for topics relevant to a query. Navigates the topic hierarchy using semantic evaluation to find the most relevant topics — not too broad, not too narrow. Use when you need context about a specific subject from past conversations.
---

# Search Topics

## Core Principles

- Find the **sweet spot** — topics that comprehensively cover the query without being too broad or too narrow.
- Prefer precision over recall. A few accurate results are better than many vague ones.
- A mid-level topic can be the best answer. Do not always drill to leaves.
- Query the knowledge graph ONLY via `noesis-graph` MCP tools.

## Setup

- **Query:** Get from `$ARGUMENTS`, ask user if missing. Use for `<query>`.

## Workflow

### Step 1: Explore root topics

1. Call MCP tool `noesis-graph:list_topics` with no `parent_topic_id`. The response is JSON `{ "file": "<path>.md", ... }`. Read that file with the Read tool — it is Markdown with one `##` section per topic (id, path, has_subtopics, short/long summary).
2. Semantically evaluate each topic's title and summaries against `<query>`.
3. If **none** are potentially related, report that no relevant topics were found and stop.
4. Collect IDs of all potentially related root topics.

### Step 2: Drill into subtopics (recursive)

For each potentially related topic from the previous step:

1. If `has_subtopics` is `no`, keep this topic as a **sweet spot** candidate and move on.
2. If `has_subtopics` is `yes`, call MCP tool `noesis-graph:list_topics` with `parent_topic_id: <topic_id>`, then read the file path returned in the response with the Read tool.
3. Apply the **Goldilocks Rule**:
   - **Too Broad** — the parent topic encompasses the query but is too high-level, and some children match more accurately → drop the parent, recurse into those children (repeat from sub-step 1).
   - **Too Narrow** — child topics cover only a fraction of the query → discard these children, keep the parent as a sweet spot candidate.
   - **Worse Fit (Retreat)** — children are fragmented tangents or collectively worse than the parent → abort drill-down, keep the parent as a sweet spot candidate.
   - **Just Right** — a child comprehensively covers the query → keep it as a sweet spot candidate (still check its subtopics if it has them).

Iterate until 1–3 sweet spot paths are identified.

### Step 3: Read sweet spot topics

For each sweet spot candidate, call MCP tool `noesis-graph:read_topic` with `topic_id: <id>`. The response is JSON `{ "file": "<path>.md", ... }`. Read that file with the Read tool — it is Markdown with `id`, `path`, short summary, and long summary. Collect the long summary and path for the final answer.

### Step 4: Synthesize

Synthesize a final answer for the user based on the collected long-summary content from sweet spot topics. Reference topic paths so the user knows where the information comes from.

## Rules

- Query the knowledge graph ONLY via `noesis-graph:list_topics` / `noesis-graph:read_topic` MCP tools. Both return a tmp file path in their JSON response — always read that file with the Read tool to see the actual content.
- Prefer precision over recall. A smaller list of accurate matches is better than a broad list of vague ones.
- A mid-level topic can be the best answer. Do not always drill to leaves.
- Use the `path` field to understand hierarchy context when judging "too broad vs too narrow."
- Aim for 1–3 sweet spot topics. If the query is very specific, one topic may be enough. If it spans multiple areas, up to 3 is acceptable.
