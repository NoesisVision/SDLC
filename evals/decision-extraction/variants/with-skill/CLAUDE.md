# Agent Instructions

## Task

Extract software design decisions from the conversation transcript at `/app/transcript.md` using the `extract_decisions` skill.

## How to proceed

1. Read the skill definition at `/app/skills/extract_decisions/SKILL.md`.
2. Follow the skill workflow exactly, using:
   - `{file_path}` = `/app/transcript.md`
   - `{skill_dir}` = `/app/skills/extract_decisions`
3. The skill will produce `_structured.json` and `_decisions/` outputs next to the transcript file.
4. After the skill workflow completes, copy the outputs to the expected locations:
   - Copy the structured JSON to `/app/output/structured.json`
   - Copy all decision record files to `/app/output/decisions/`

## Codebase reference

The codebase discussed in the transcript is available at `/app/repo/`. Use it to verify file names, class names, and architectural patterns mentioned in the conversation.

## Agent definitions

The skill workflow uses subagents. Their definitions are at:
- `/app/agents/topics_extractor.md`
- `/app/agents/decision_record_file_writer.md`
