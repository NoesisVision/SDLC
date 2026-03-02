---
name: Structure Conversation
description: Structure a conversation transcript into topics with classified idea units. Use it when user wants to analyze, structure, or organize a conversation transcript file.
---

# Structure Conversation

Structure a conversation transcript (markdown file) into semantically grouped topics with classified idea units (Issue, Position, Argument, Decision).

## Core Principles

- NEVER load the whole conversation file into LLM context.

## Setup

- **MCP server:** `noesis_local` (all tools are registered there)
- **File path:** Get from `$ARGUMENTS` (the conversation markdown file path)

## Workflow

### Step 0: Register Conversation

- Call the `add_conversation` MCP tool. Pass absolute path to the conversation markdown file as `file_path`.
- Parse the response to get `conversation_id`. Use this ID for **all** subsequent tool calls.

### Step 1: Clean & Parse

Call the `clean_conversation` MCP tool:
- `conversation_id`: the ID from Step 0

Parse the response:
- If `status` is `"success"` — proceed to Step 2
- If `status` is `"incomplete"` — check `missing` array for `"title"` and/or `"date"`, then:
  1. Use AskUserQuestion to ask the user for missing values
  2. Call the `set_conversation_metadata` MCP tool with `conversation_id`, `title`, and/or `date`
  3. Proceed to Step 2

### Step 2: Prepare Batches

- Call the `prepare_extraction_batches` MCP tool with `conversation_id`.
- Parse the response to get `batch_count`.

### Step 3: Extract Idea Units (Parallel Subagents)

Launch `idea_unit_extractor` subagents to process batches. Launch up to 3 in parallel.

For each batch index `N` (from 0 to batch_count-1), launch a Task subagent with:
- **subagent_type:** `idea_unit_extractor`
- **prompt:** `Extract idea units from conversation_id="<conversation_id>", batch_index=<N>.`

Wait for all subagents to complete. Each subagent handles its own retries. If a subagent reports failure, ask the user what to do.

### Step 4: Compute Embeddings

Call the `embed_idea_units` MCP tool with `conversation_id`.

This may take a moment for large conversations. Proceed when done.

### Step 5: Assign Topics (Iterative)

Call the `assign_topics` MCP tool with `conversation_id`.

Parse the response:
- If `status` is `"success"` — proceed to Step 6. The response includes `topics_for_labeling`.
- If `status` is `"arbitration_needed"`:
  1. The response contains `arbitration_request` with: `fragment` (the text), `category`, and `candidates` (each with `topic_id`, `score`, and `representative_texts`)
  2. Decide: does the fragment belong to one of the candidate topics, or is it a new topic?
     - Compare the fragment's meaning with the representative texts of each candidate
     - If it clearly fits a candidate: use that `topic_id`
     - If it introduces a genuinely new subject: use `"NEW"`
  3. Call the `apply_topic_arbitration` MCP tool with `conversation_id` and `topic_id` (the chosen ID or `"NEW"`)
  4. Parse the response — it may return another `arbitration_needed` or `success`. Repeat until `success`.

### Step 6: Generate Topic Labels & Summaries

Use the `topics_for_labeling` array from the successful Step 5 response. Each entry contains `topic_id`, `representative_texts`, and `categories`.

For each topic, generate:
- **label**: A 2-5 word topic name based on the `representative_texts` and `categories`
- **summary**: A 1-2 sentence description of what was discussed in this topic

Build a JSON string in this format:
```json
{
  "topics": [
    {"topic_id": "topic_001", "label": "Database Technology Choice", "summary": "Discussion about choosing..."},
    ...
  ]
}
```

### Step 7: Build Final Output

Call the `finalize_conversation` MCP tool with:
- `conversation_id`: the ID from Step 0
- `topics_refined`: the JSON string from Step 7

The response contains:
- `title`, `date`, and `topics` (name + summary for each)
- `output_path`: path to the written `<file_stem>_structured.json` file

Present the summary to the user. Include the output file path.
