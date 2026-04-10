---
name: noesis:analyze-conversation
description: Analyze a conversation transcript to build a knowledge graph. Extracts topics and captures decisions. Use to integrate new conversation transcript into knowledge graph.
---

# Analyze Conversation

## Core Principles

- NEVER load the whole conversation file into LLM context.

## Environment

- Run all scripts as: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/<script.py> <args>`. Do NOT prepend `cd` — Python resolves local imports from the script's own directory.

## Setup

- **Transcript path:** Get from `$ARGUMENTS`, ask user if missing.  Use for `<transcript_path>`.
- **Knowledge graph path:** Get from `$ARGUMENTS`, ask user if missing. If the file does not exist, run `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/init_knowledge_graph.py <knowledge_graph_path>` to create an empty knowledge graph. Use for `<knowledge_graph_path>`.
- **Conversation time:** Get from `$ARGUMENTS`, ask user if missing. Format: `YYYY-MM-DD HH:MM:SS`. Use for `<time>`.
- **Main topic:** Get from `$ARGUMENTS`, ask user if missing. Short description. Use for `<main_topic>`.

## Workflow

### Step 1: Prepare analysis

1. Run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/working_dir.py <transcript_path>`. Creates working directory for the analysis. Use returned `working_dir` in subsequent steps.
2. Run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/check_conversation_id.py <transcript_path> <knowledge_graph_path>`. If status is `ConversationAlreadyAdded` inform user and finish.
3. Run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/structure_transcript.py <transcript_path> <conversation_id>`. Uses `conversation_id` from step above. Produces a JSON file in the working directory.
4. Run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/init_conversation.py <working_dir> <conversation_id> <time> <main_topic>`. Creates `conversation.json` in the working directory with metadata and empty analysis fields.

### Step 2: Extract topics

1. Invoke `find-topics` subagent with `<knowledge_graph_path>`, `<main_topic>` as query, and `<working_dir>`. The subagent saves matching existing topics to `{working_dir}/possible_topics.json` (or an empty array if none match).
2. Use `<structured_transcript_path>` from Step 1.3 output.
3. **Loop** — invoke `extract-topics` subagent sequentially with `<working_dir>`, `<structured_transcript_path>`, and token limit `8000`. The subagent returns `{"has_more": true/false}`. Repeat until `has_more` is `false`. Do NOT parallelize — each invocation depends on the previous one's output.

### Step 3: Review topics and capture decisions

**Loop** — for each topic, review it and then immediately extract its decisions before moving to the next topic:

1. Invoke `review-topics` subagent with `<working_dir>` and `<knowledge_graph_path>`. The subagent returns `{"has_topic": true/false, "topic_id": "<id>"}`. If `has_topic` is `false`, exit the loop.
2. Invoke `extract-decisions` subagent with `<working_dir>` and the `topic_id` returned by the review subagent. The subagent extracts decisions for that specific reviewed topic.
3. Repeat from sub-step 1.

Do NOT parallelize — both subagents read and write `conversation.json`, so concurrent execution would cause data loss.

### Step 4: Save to knowledge graph

Run: `uv run ${CLAUDE_PLUGIN_ROOT}/scripts/merge_to_knowledge_graph.py <working_dir> <knowledge_graph_path>`. Merges conversation topics, decisions, and summary into the knowledge graph. New data takes priority over existing (summaries, re-parenting, idea unit changes).