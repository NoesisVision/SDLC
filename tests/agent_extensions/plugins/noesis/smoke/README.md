# Noesis end-to-end smoke test

Drives a real `claude -p` session through the full noesis skill chain and
asserts the resulting graph against the UI view endpoints.

## What it does

1. Builds a fresh, empty plugin data dir + project dir under `$TMPDIR`.
2. Copies the fixtures (`fixtures/transcript.md`, `fixtures/design-draft.md`,
   `fixtures/extra-requirements.md`) into the project dir.
3. Spawns `claude -p` once per skill, with the noesis plugin loaded:
   - `/noesis:analyze-conversation`
   - `/noesis:analyze-design-draft` (creates a new Design Doc JSON in the project)
   - `/noesis:create-design-doc` (iterates the Design Doc with the extra
     requirements file)
4. Boots the dev backend on the same data directory with `NOESIS_DEV_NO_SEED=1`
   (so the only data is what the skills produced).
5. Asserts each UI view endpoint (`/api/ui/topics`, `/decisions`,
   `/design-docs`, `/schema-explorer`, `/model-explorer`) responds with
   non-empty, structurally correct data.
6. Leaves the backend running and prints its URL so a human (or Claude using
   Playwright MCP) can finish the visual UI sanity check.

## Cost

This test calls a real Anthropic model (default `sonnet`) through three
multi-step skill workflows. Expect tens of thousands of tokens per run.

## Running

The test refuses to start unless `NOESIS_SMOKE_CONFIRM=1` is set — the user
must explicitly approve the token spend each time:

```bash
NOESIS_SMOKE_CONFIRM=1 bun run smoke:noesis
```

Press Ctrl+C to terminate the backend once the visual check is done.
