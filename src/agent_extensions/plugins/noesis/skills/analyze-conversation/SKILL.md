---
name: noesis:analyze-conversation
description: Analyze a conversation transcript to build a knowledge graph. Extracts topics and captures decisions. Use to integrate new conversation transcript into knowledge graph.
---

# Analyze Conversation

## Core Principles

- NEVER load the whole conversation file into LLM context.

## Environment

- Run all scripts as: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts <args>`. Do NOT prepend `cd`.

## Setup

- **Transcript path:** Get from `$ARGUMENTS`, ask user if missing. Use for `<transcript_path>`.
- **Knowledge graph path:** Get from `$ARGUMENTS`, ask user if missing. If the file does not exist, run `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/knowledge-graph/init-knowledge-graph.ts <knowledge_graph_path>` to create an empty knowledge graph. Use for `<knowledge_graph_path>`.
- **Conversation time:** Get from `$ARGUMENTS`, ask user if missing. Format: `YYYY-MM-DD HH:MM:SS`. Use for `<time>`.
- **Main topic:** Get from `$ARGUMENTS`, ask user if missing. Short description. Use for `<main_topic>`.

## Workflow

### Step 1: Prepare analysis

Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/prepare-analysis.ts <transcript_path> <knowledge_graph_path> <time> <main_topic>`.

This single script creates the working directory, checks/generates conversation ID, structures the transcript, initializes `conversation.json`, and generates all chunks upfront.

Output:
```json
{
  "status": "Ok" | "ConversationAlreadyAdded",
  "working_dir": "<path>",
  "conversation_id": "<id>",
  "chunks": [
    { "chunk_id": 0, "file": "<path>/chunk_0.md", "num_turns": 5 },
    { "chunk_id": 1, "file": "<path>/chunk_1.md", "num_turns": 4 }
  ],
  "structured_transcript_path": "<path>"
}
```

- If status is `ConversationAlreadyAdded`, inform user and finish.
- Use returned `working_dir`, `chunks`, and `structured_transcript_path` in subsequent steps.

### Step 2: Extract topics

1. Invoke `find-topics` subagent with `<knowledge_graph_path>`, `<main_topic>` as query, and `<working_dir>`. The subagent saves matching existing topics to `{working_dir}/potential_topics.json` (or an empty array if none match).
2. **Loop** — for each chunk from Step 1 output, invoke `extract-topics` subagent sequentially with `<working_dir>` and `<chunk-id>`. The chunk file is at `{working_dir}/chunk_{chunk_id}.md`. Repeat for all chunks. Do NOT parallelize — each invocation depends on the previous one's output.

### Step 3: Analyze topics

**Loop** — for each topic, review it and extract its decisions in a single subagent call:

1. Invoke `analyze-topic` subagent with `<working_dir>` and `<knowledge_graph_path>`. The subagent reviews the topic, generates summaries, and extracts decisions if the topic contains Decision-category idea units. It returns `{"has_topic": true/false, "topic_id": "<id>"}`. If `has_topic` is `false`, exit the loop.
2. Repeat from sub-step 1.

Do NOT parallelize — the subagent reads and writes `conversation.json`, so concurrent execution would cause data loss.

### Step 4: Save to knowledge graph

Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/knowledge-graph/merge-to-knowledge-graph.ts <working_dir> <knowledge_graph_path>`. Merges conversation topics, decisions, and summary into the knowledge graph. New data takes priority over existing (summaries, re-parenting, idea unit changes).
