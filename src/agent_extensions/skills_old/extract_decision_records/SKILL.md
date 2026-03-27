---
name: Extract Decision Records
description: Extract decision records from a previously structured conversation. Use when user wants to extract decisions from a structured conversation.
---

# Extract Decision Records

Extract decision records from a structured conversation transcript, capturing context, considered options, and final decisions for each topic.

## Core Principles

- NEVER load the whole structured conversation file into LLM context.
- Use MCP tools to access conversation data topic by topic.

## Setup

- **MCP server:** `noesis_local` (all tools are registered there)
- **Conversation ID:** Get from `$ARGUMENTS`

## Workflow

### Step 1: Get Conversation Topics

- Call the `get_conversation_topics` MCP tool with the `conversation_id` from `$ARGUMENTS`.
- Parse the response to get `conversation_title`, `topic_count`, and `topics` list.
- Present the topics to the user for awareness:
  - Show the conversation title
  - List each topic with its index, name, and summary

### Step 2: Extract Decision Records (Parallel Subagents)

For each topic index (0 to `topic_count - 1`), launch a `decision_record_writer` subagent.

Launch up to 3 subagents in parallel. For each topic:
- **subagent_type:** `decision_record_writer`
- **prompt:** `Extract decision record from conversation_id="<conversation_id>", topic_index=<N>.`

Wait for all subagents to complete. Each subagent handles its own retries. If a subagent reports failure, inform the user.

### Step 3: Present Summary

Collect results from all subagents and present a summary:
- Which topics had decisions extracted (with output file paths)
- Which topics had no decision found
- Any errors encountered
