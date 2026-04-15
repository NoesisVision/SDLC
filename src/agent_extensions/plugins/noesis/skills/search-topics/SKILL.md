---
name: noesis:search-topics
description: Search the knowledge graph for topics relevant to a query. Navigates the topic hierarchy using semantic evaluation to find the most relevant topics — not too broad, not too narrow. Use when you need context about a specific subject from past conversations.
---

# Search Topics

## Core Principles

- Find the **sweet spot** — topics that comprehensively cover the query without being too broad or too narrow.
- Prefer precision over recall. A few accurate results are better than many vague ones.
- A mid-level topic can be the best answer. Do not always drill to leaves.

## Environment

- Run all scripts as: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts <args> > <tmp_file>`. Do NOT prepend `cd`.
- After every script invocation, read `<tmp_file>` using the Read tool.
- Use `/tmp/noesis-search-tmp.json` as `<tmp_file>` for all script outputs.

## Setup

- **Knowledge graph path:** Get from `$ARGUMENTS`, ask user if missing. Use for `<knowledge_graph_path>`.
- **Query:** Get from `$ARGUMENTS`, ask user if missing. Use for `<query>`.

## Workflow

### Step 1: Explore root topics

1. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/list-topics.ts <knowledge_graph_path> > <tmp_file>`.
2. Read `<tmp_file>` using the Read tool. The output is JSON: `{"status": "Ok", "topics": [{"id", "title", "short_summary", "long_summary", "has_subtopics", "path"}, ...]}`.
3. Semantically evaluate each topic's `title`, `short_summary`, and `long_summary` against `<query>`.
4. If **none** are potentially related, report that no relevant topics were found and go to Step 4.
5. Collect IDs of all potentially related root topics.

### Step 2: Drill into subtopics (recursive)

For each potentially related topic from the previous step:

1. If `has_subtopics` is `false`, keep this topic as a **sweet spot** candidate and move on.
2. If `has_subtopics` is `true`, run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/list-topics.ts <knowledge_graph_path> --parent_id <topic_id> > <tmp_file>`.
3. Read `<tmp_file>` using the Read tool.
4. Apply the **Goldilocks Rule**:
   - **Too Broad** — the parent topic encompasses the query but is too high-level, and some children match more accurately → drop the parent, recurse into those children (repeat from sub-step 1).
   - **Too Narrow** — child topics cover only a fraction of the query → discard these children, keep the parent as a sweet spot candidate.
   - **Worse Fit (Retreat)** — children are fragmented tangents or collectively worse than the parent → abort drill-down, keep the parent as a sweet spot candidate.
   - **Just Right** — a child comprehensively covers the query → keep it as a sweet spot candidate (still check its subtopics if it has them).

Iterate until 1–3 sweet spot paths are identified.

### Step 3: Read sweet spot topics

For each sweet spot candidate:

1. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/read-node.ts <knowledge_graph_path> <topic_id> > <tmp_file>`.
2. Read `<tmp_file>` using the Read tool. The output is JSON: `{"status": "Ok", "id", "title", "path", "short_summary", "long_summary"}`.
3. Collect the `long_summary` and `path` for the final answer.

### Step 4: Synthesize and clean up

1. Synthesize a final answer for the user based on the collected `long_summary` content from sweet spot topics. Reference topic paths so the user knows where the information comes from.
2. Delete the tmp file: run `rm -f <tmp_file>`.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly with `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts`.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Use `>` ONLY to capture script stdout to `<tmp_file>`.
- Use Read tool ONLY for `<tmp_file>`. NEVER use Read or Bash to inspect the knowledge graph file directly.
- NEVER write inline code in Bash. Use only the provided scripts.
- Prefer precision over recall. A smaller list of accurate matches is better than a broad list of vague ones.
- A mid-level topic can be the best answer. Do not always drill to leaves.
- Use the `path` field to understand hierarchy context when judging "too broad vs too narrow."
- Aim for 1–3 sweet spot topics. If the query is very specific, one topic may be enough. If it spans multiple areas, up to 3 is acceptable.
