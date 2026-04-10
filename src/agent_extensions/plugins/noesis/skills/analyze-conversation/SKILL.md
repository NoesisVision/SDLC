---
name: noesis:analyze-conversation
description: Analyze a conversation transcript to build a knowledge graph. Extracts idea units, assigns topics, captures decisions, and generates summaries. Use after registering a conversation with register_conversation.
---

# Analyze Conversation

Build a knowledge graph from a registered conversation transcript. Extracts atomic idea units, assigns them to a global topic tree, captures ADR-style decisions, and generates summaries.

## Setup

- **conversation_id:** Get from `$ARGUMENTS`. Use whenever `{conversation_id}` is mentioned.

## Workflow

