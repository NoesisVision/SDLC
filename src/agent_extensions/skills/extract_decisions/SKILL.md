---
name: noesis:extract-decisions
description: Extract decisions, positions, arguments, and key information from a conversation transcript (markdown file). Use this skill to structure a conversation and extract software design decisions.
---

# Extract Decisions

Extract decisions, positions, arguments, and key information from a conversation transcript (markdown file).

## Core Principles

- NEVER load the whole conversation file into LLM context.

## Setup

- **File path:** Get from `$ARGUMENTS`, use whenever `{file_path}` is mentioned.
- **Skill directory:** Resolve the directory containing this SKILL.md file, use whenever `{skill_dir}` is mentioned. All scripts are in `{skill_dir}/scripts/`.

## Workflow

### Step 0: Prepare Extraction

Run:
```
uv run {skill_dir}/scripts/prepare_extraction.py {file_path}
```

Parse the JSON output:
- If `status` is `"exists"`:
  1. Use AskUserQuestion to ask the user if extraction should be performed. **Warn that existing files will be overridden.**
  2. If user says **no** — stop the workflow entirely.
  3. If user says **yes** — re-run with `--force`: `uv run {skill_dir}/scripts/prepare_extraction.py {file_path} --force`
- If `status` is `"success"`:
  1. get `conversation_id` and use it whenever `{conversation_id}` is mentioned
  2. get `work_dir` and use it whenever `{work_dir}` is mentioned
  3. get `cleaned_path` and use it whenever `{cleaned_path}` is mentioned
  4. get `structured_path` and use it whenever `{structured_path}` is mentioned
  5. proceed to Step 1

### Step 1: Clean Conversation

Run:
```
uv run {skill_dir}/scripts/clean_conversation.py {file_path} {conversation_id} {cleaned_path}
```

Parse the JSON output:
- If `status` is `"incomplete"` — check `missing` array for `"title"` and/or `"date"` (start datetime in `YYYY-MM-DD HH:MM` format), then:
  1. Use AskUserQuestion to ask the user for missing values (for date, ask for the full start datetime, e.g. `"2025-03-01 14:00"`)
  2. Re-run with overrides: `uv run {skill_dir}/scripts/clean_conversation.py {file_path} {conversation_id} {cleaned_path} --title "..." --date "..."`
- If `status` is `"success"` — proceed to Step 2.

### Step 2: Prepare Batches

Run:
```
uv run {skill_dir}/scripts/prepare_batches.py {work_dir} --cleaned-path {cleaned_path}
```

Parse the JSON output to get `batch_count` and use it whenever `{batch_count}` is mentioned.

### Step 3: Extract Topics (Sequential Subagents)

For each batch index `n` (from `0` to `{batch_count}-1`), launch a `topics_extractor` subagent **SEQUENTIALLY**.
You MUST wait for each subagent to complete before launching the next one. This is required because each subagent reads and writes to the shared structured output file.
If a subagent reports failure, you MUST ask the user what to do.

For each batch, launch a Task subagent with:
- **subagent_type:** `topics_extractor`
- **prompt:**
  ```
  Process batch file at "{work_dir}/batches/batch_{n}.json".
  Skill directory: "{skill_dir}"
  Work directory: "{work_dir}"
  Structured path: "{structured_path}"
  Batch index: {n}
  ```

After all subagents complete, present a summary to the user: list each topic's name and summary.

### Step 4: Write Decision Records (Parallel Subagents)

Run:
```
uv run {skill_dir}/scripts/init_decision_records.py --structured-path {structured_path}
```

Parse JSON output:
- get `decisions_dir` and use it whenever `{decisions_dir}` is mentioned
- get `topic_ids` and use it whenever `{topic_ids}` is mentioned

For each topic_id, launch a `decision_record_writer` subagent in parallel (up to 5 at a time):
- **subagent_type:** `decision_record_writer`
- **prompt:**
  ```
  Analyze topic "{topic_id}" for software design decisions.
  Skill directory: "{skill_dir}"
  Work directory: "{work_dir}"
  Structured path: "{structured_path}"
  Decisions directory: "{decisions_dir}"
  ```

Wait for all subagents to complete. Present summary: decisions written, topics with/without decisions, and the `decisions_dir` path.

### Step 5: Cleanup

**Always run this step** — after Step 4 succeeds, or if any earlier step fails.

Run:
```
uv run {skill_dir}/scripts/cleanup.py {work_dir}
```

This removes the temporary working directory. The `_cleaned.json`, `_structured.json` files next to the original file and all files added to `{decisions_dir}` MUST be preserved.
