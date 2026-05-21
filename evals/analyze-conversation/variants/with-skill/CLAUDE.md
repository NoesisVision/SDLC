# Agent Instructions — with-skill

The noesis plugin is baked into this environment at `/opt/noesis-plugin` and the
`noesis-graph` MCP server is already configured and available to you.

## Before you start

Export the plugin root so the skill's scripts resolve (the plugin is baked, not
installed as a Claude Code plugin, so this is not set for you):

```bash
export CLAUDE_PLUGIN_ROOT=/opt/noesis-plugin
```

## What to do

Use the **`noesis:analyze-conversation`** skill to complete the task in
`/app/instruction.md`. Run the skill's full workflow end to end — every step,
in order — with these inputs:

- `transcript_path` = `/app/transcript.md`
- `conversation_time` = `2026-05-18 10:00:00`
- `main_topic` = `Parcel locker pickup-code expiry and retry design`

Follow the skill's `SKILL.md` exactly:

1. Run its prepare step (Step 1) and check for a duplicate via the MCP server.
2. Do the Goldilocks topic search (Step 2) — the graph is **not empty**; reuse
   existing topics that fit instead of creating duplicates.
3. Extract idea units, assign topics, validate the output (Step 3).
4. Review topics, write summaries, extract decisions, validate again (Step 4).
5. Merge into the knowledge graph with `merge_conversation` (Step 5).

Do not stop until `merge_conversation` has succeeded. Persist graph state only
through the `noesis-graph` MCP tools — never write graph files by hand.
