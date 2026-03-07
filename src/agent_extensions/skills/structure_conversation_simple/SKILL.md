---
name: noesis:structure-conversation-simple
description: Structure a conversation transcript into topics with classified idea units. No MCP server dependency — uses Python scripts and LLM instructions. Use it when user wants to analyze, structure, or organize a conversation transcript file.
---

# Structure Conversation (Simple)

Structure a conversation transcript (markdown file) into semantically grouped topics with classified idea units (Issue, Position, Argument, Decision).

## Core Principles

- NEVER load the whole conversation file into LLM context.

## Setup

- **File path:** Get from `$ARGUMENTS` (the conversation markdown file path)
- **Skill directory:** Resolve the directory containing this SKILL.md file. All scripts are in `{skill_dir}/scripts/`.

## Workflow

### Step 0: Parse Conversation

Run:
```
uv run --script {skill_dir}/scripts/parse_conversation.py <file_path>
```

Parse the JSON output:
- If `status` is `"success"` — note `conversation_id` and `work_dir`, proceed to Step 1
- If `status` is `"incomplete"` — check `missing` array for `"title"` and/or `"date"`, then:
  1. Use AskUserQuestion to ask the user for missing values
  2. Re-run with overrides: `uv run --script {skill_dir}/scripts/parse_conversation.py <file_path> --title "..." --date "..."`
  3. Proceed to Step 1

### Step 1: Prepare Batches

Run:
```
uv run --script {skill_dir}/scripts/prepare_batches.py <work_dir>
```

Parse the JSON output to get `batch_count`.

### Step 2: Extract Idea Units (Parallel Subagents)

Launch `idea_unit_extractor_simple` subagents to process batches. Launch up to 3 in parallel.

For each batch index `N` (from 0 to batch_count-1), launch a Task subagent with:
- **subagent_type:** `idea_unit_extractor_simple`
- **prompt:**
  ```
  Extract idea units from batch file at "<work_dir>/batches/batch_<N>.json".
  Write result to "<work_dir>/extractions/batch_<N>.json".
  Validate with: uv run --script {skill_dir}/scripts/validate_extraction.py <work_dir>/batches/batch_<N>.json <work_dir>/extractions/batch_<N>.json
  ```

Wait for all subagents to complete. Each subagent handles its own retries. If a subagent reports failure, ask the user what to do.

Create the `<work_dir>/extractions/` directory before launching subagents.

### Step 3: Collect Topic Groups

Run:
```
uv run --script {skill_dir}/scripts/collect_topic_groups.py <work_dir>
```

This groups all non-Irrelevant idea units by their topic labels (assigned during extraction). The output is `topic_groups.json` in `<work_dir>`.

### Step 4: Merge Topics

Read `<work_dir>/topic_groups.json`. It contains `topic_groups` — an array where each entry has `label`, `count`, `categories`, and `representative_texts`.

Your task: merge similar topic groups into final topics. Write the result to `<work_dir>/merged_topics.json`.

**Merge guidelines:**
- Aim for **5-25 final topics** depending on conversation length and diversity.
- Merge by **subject overlap**, not by category similarity (e.g., merge "API Authentication" and "OAuth Token Flow" into one topic, but don't merge "API Authentication" and "Database Indexing" just because both contain Arguments).
- Every source label must appear in exactly one final topic's `source_labels`.
- Generate labels and summaries **in the same language as the representative_texts**.
- Keep groups that are already distinct as separate topics.

**Output format** for `merged_topics.json`:
```json
{
  "topics": [
    {
      "label": "Final Topic Name",
      "summary": "1-2 sentence description of what was discussed",
      "source_labels": ["Original Label A", "Original Label B"]
    }
  ]
}
```

A topic with a single source label is valid — not everything needs to be merged.

### Step 5: Build Final Output

Run:
```
uv run --script {skill_dir}/scripts/build_output.py <work_dir>
```

The JSON output contains:
- `title`, `date`, and `topics` (name + summary for each)
- `output_path`: path to the written `<file_stem>_structured.json` file

Present the summary to the user. Include the output file path.

## Reference Files

- `references/output_format.md` — Final JSON output schema documentation. Read this if you need to understand or verify the output structure.
