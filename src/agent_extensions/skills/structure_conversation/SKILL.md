---
name: Structure Conversation
description: Structure a conversation transcript into topics with classified idea units. Use it when user wants to analyze, structure, or organize a conversation transcript file.
---

# Structure Conversation

Structure a conversation transcript (markdown file) into semantically grouped topics with classified idea units (Issue, Position, Argument, Decision).

## Setup

- **MCP server:** `noesis_local` (all tools are registered there)
- **File path:** Get from `$ARGUMENTS` (the conversation markdown file path)

## Workflow

### Step 0: Register Conversation

Call the `add_conversation` MCP tool:
- `file_path`: absolute path to the conversation markdown file

Parse the response to get `conversation_id`. Use this ID for **all** subsequent tool calls.

NEWER load the whole file into LLM context.

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

Call the `prepare_extraction_batches` MCP tool with `conversation_id`.

Parse the response to get `batch_count`.

### Step 3: Extract Idea Units (Parallel Subagents)

Launch Task subagents to process batches. Use **haiku** model. Launch up to 3 in parallel.

For each batch index `N` (from 0 to batch_count-1), launch a Task subagent with this prompt:

```
Call the `get_extraction_batch` MCP tool with conversation_id="<conversation_id>" and batch_index=<N>.
The response contains a "prompt" key with extraction instructions.
Follow the instructions in that prompt exactly. Output ONLY the raw JSON array as specified — no markdown fences, no explanation.
Then call the `store_extraction_result` MCP tool with conversation_id="<conversation_id>", batch_index=<N>, and result=<the JSON you produced>.
```

Wait for all subagents to complete before proceeding.

### Step 4: Validate & Merge

Call the `validate_and_merge_idea_units` MCP tool with `conversation_id`.

Parse the response:
- If `status` is `"success"` — proceed to Step 5
- If `status` is `"retry_needed"` — check `failed_batches` array, re-launch subagents for those batches (up to 3 total attempts per batch). If a batch fails 3 times, report failure to the user and stop.

### Step 5: Compute Embeddings

Call the `embed_idea_units` MCP tool with `conversation_id`.

This may take a moment for large conversations. Proceed when done.

### Step 6: Assign Topics (Iterative)

Call the `assign_topics` MCP tool with `conversation_id`.

Parse the response:
- If `status` is `"success"` — proceed to Step 7. The response includes `topics_for_labeling`.
- If `status` is `"arbitration_needed"`:
  1. The response contains `arbitration_request` with: `fragment` (the text), `category`, and `candidates` (each with `topic_id`, `score`, and `representative_texts`)
  2. Decide: does the fragment belong to one of the candidate topics, or is it a new topic?
     - Compare the fragment's meaning with the representative texts of each candidate
     - If it clearly fits a candidate: use that `topic_id`
     - If it introduces a genuinely new subject: use `"NEW"`
  3. Call the `apply_topic_arbitration` MCP tool with `conversation_id` and `topic_id` (the chosen ID or `"NEW"`)
  4. Parse the response — it may return another `arbitration_needed` or `success`. Repeat until `success`.

### Step 7: Generate Topic Labels & Summaries

Use the `topics_for_labeling` array from the successful Step 6 response. Each entry contains `topic_id`, `representative_texts`, and `categories`.

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

### Step 8: Build Final Output

Call the `finalize_conversation` MCP tool with:
- `conversation_id`: the ID from Step 0
- `topics_refined`: the JSON string from Step 7

The response contains:
- `title`, `date`, and `topics` (name + summary for each)
- `output_path`: path to the written `<file_stem>_structured.json` file

Present the summary to the user. Include the output file path.
