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

### Step 0: Parse Conversation

Run:
```
uv run {skill_dir}/scripts/parse_conversation.py {file_path}
```

Parse the JSON output:
- If `status` is `"success"`:
  1. get `conversation_id` and use it whenever `{conversation_id}` is mentioned
  2. get `work_dir` and use it whenever `{work_dir}` is mentioned
  3. get `cleaned_path` and use it whenever `{cleaned_path}` is mentioned
  4. proceed to Step 1
- If `status` is `"incomplete"` — check `missing` array for `"title"` and/or `"date"` (start datetime in `YYYY-MM-DD HH:MM` format), then:
  1. Use AskUserQuestion to ask the user for missing values (for date, ask for the full start datetime, e.g. `"2025-03-01 14:00"`)
  2. Re-run this step with overrides: `uv run {skill_dir}/scripts/parse_conversation.py {file_path} --title "..." --date "..."`

### Step 1: Prepare Batches

Run:
```
uv run {skill_dir}/scripts/prepare_batches.py {work_dir} --cleaned-path {cleaned_path}
```

Parse the JSON output to get `batch_count` and use it whenever `{batch_count}` is mentioned.

### Step 2: Initialize Structured Output

Run:
```
uv run {skill_dir}/scripts/init_topics.py --cleaned-path {cleaned_path} --structured-path <structured_path>
```

Parse the JSON output:
- If `resumed` is `true` — the structured file already existed with topics (crash recovery). Note `existing_topic_count` and inform the user that previous progress was preserved. **You may skip already-processed batches** by checking which batch result manifests already exist in `{work_dir}/results/`.
- If `resumed` is `false` — a fresh empty structured file was created.
- Use `--force` flag to explicitly overwrite an existing structured file if the user requests a fresh start.

This file accumulates topics incrementally during extraction — the working format is the final output format.

### Step 3: Extract Topics (Sequential Subagents)

For each batch index `n` (from `0` to `{batch_count}-1`), launch a `topics_extractor` subagent **SEQUENTIALLY**.
You MUST wait for each subagent to complete before launching the next one. This is required because each subagent reads and writes to the shared structured output file.
If a subagent reports failure, ask the user what to do.

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

After all subagents complete, present a summary to the user: list each topic's name and short description, and include the `{structured_path}`.

### Step 4: Write Decision Records (Parallel Subagents)

Run:
```
uv run {skill_dir}/scripts/init_decision_records.py --structured-path <structured_path>
```

Parse JSON output to get `decisions_dir` and `topic_ids`.

For each topic_id, launch a `decision_record_file_writer` subagent in parallel (up to 5 at a time):
- **subagent_type:** `decision_record_file_writer`
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
uv run {skill_dir}/scripts/cleanup.py <work_dir>
```

This removes the temporary working directory. The `_cleaned.json` and `_structured.json` files next to the original are preserved.

## Reference Files

- `references/output_format.md` — Final JSON output schema documentation, including decision record format.
