---
name: noesis:analyze-conversation
description: Analyze a conversation transcript to build a knowledge graph. Extracts topics and captures decisions. Use to integrate new conversation transcript into knowledge graph.
---

# Analyze Conversation

## Core Principles

- NEVER load the whole conversation file into LLM context.
- Knowledge graph storage lives in the `noesis-graph` MCP server.

## Environment

- Run all scripts as: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts <args>`. Do NOT prepend `cd`.

## Setup

- **Transcript path:** Get from `$ARGUMENTS`, ask user if missing. Use for `<transcript_path>`.
- **Conversation time:** Get from `$ARGUMENTS`, ask user if missing. Format: `YYYY-MM-DD HH:MM:SS`. Use for `<time>`.
- **Main topic:** Get from `$ARGUMENTS`, ask user if missing. Short description. Use for `<main_topic>`.

## Workflow

### Step 1: Prepare analysis

Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/prepare-analysis.ts <transcript_path> <time> <main_topic>`.

This script creates the working directory, checks/generates the conversation ID, structures the transcript, initializes `conversation.json`, and generates all chunks upfront.

Output:
```json
{
  "status": "Ok",
  "working_dir": "<path>",
  "conversation_id": "<id>",
  "chunks": [
    { "chunk_id": 0, "file": "<path>/chunk_0.md", "num_turns": 5 },
    { "chunk_id": 1, "file": "<path>/chunk_1.md", "num_turns": 4 }
  ],
  "structured_transcript_path": "<path>"
}
```

Then call the MCP tool `noesis-graph:has_conversation` with `conversation_id` from the output:
- If `exists: true`, inform the user "Conversation already added" and finish.
- Otherwise proceed.

Use returned `working_dir`, `chunks`, and `structured_transcript_path` in subsequent steps.

### Step 2: Extract topics

1. Invoke `find-topics` subagent with `<main_topic>` as query and `<working_dir>`. The subagent saves matching existing topics to `{working_dir}/potential_topics.json` (or an empty array if none match).
2. **Loop** — for each chunk from Step 1 output, invoke `extract-topics` subagent sequentially with `<working_dir>` and `<chunk-id>`. The chunk file is at `{working_dir}/chunk_{chunk_id}.md`. Repeat for all chunks. Do NOT parallelize — each invocation depends on the previous one's output.

### Step 3: Analyze topics

**Loop** — for each topic, review it and extract its decisions in a single subagent call:

1. Invoke `analyze-topic` subagent with `<working_dir>`. The subagent reviews the topic, generates summaries, and extracts decisions if the topic contains Decision-category idea units. It returns `{"has_topic": true/false, "topic_id": "<id>"}`. If `has_topic` is `false`, exit the loop.
2. Repeat from sub-step 1.

Do NOT parallelize — the subagent reads and writes `conversation.json`, so concurrent execution would cause data loss.

### Step 4: Merge into the knowledge graph

Call the MCP tool `noesis-graph:merge_conversation` with `working_dir: <working_dir>`. The server reads `conversation.json` plus `potential_topics.json` and persists the Conversation, Turns, IdeaUnits, Topics (with parent linking), Items, and Decisions into the graph. Report `topics_added`, `topics_updated`, and `decisions_added` to the user.
