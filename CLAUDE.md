# Implementation guidelines

## General

1. Use functional paradigm for data transformation.
2. Use procedural paradigm for use cases coordination logic.
3. Structure code base on capabilities not technical patterns (like entities, repositories, services).
4. Split a large function into a hierarchical structure of private functions with descriptive names.
5. Structure function declaration in such a way whenever possible:
    - public functions in alphabetical order
    - private functions after public functions that use them.
    - private functions in an order that makes understanding easier (dependency after dependant)
6. Check and adjust (if needed) code structure on EVERY modification. 
7. Mimic `src` structure in `tests`.
8. Naming:
   - **Directories and Files:** `kebab-case`
   - **Types, Interfaces, Enums:** `PascalCase`
   - **Functions, methods, variables:** `camelCase`
   - **Constants:** `UPPER_SNAKE_CASE`
9. All code, comments, documentation, and commit messages must be in **English**.

## TypeScript

1. **Bun** as runtime and package manager (`bun install`, `bun run`, `bunx`).
2. **NestJS** for backend servers.
3. **React + Vite** for UI applications.
4. Strict TypeScript — no `any` types without justification.
5. Narrow discriminated unions (and any closed string-literal union) with `switch` on the discriminator plus an `assertNever(x)` default — never `if`/`else if` chains or ternaries. This gives compile-time exhaustiveness when a new variant is added. The `assertNever` helper lives in `shared-contracts/assert-never.ts`.

## UI verification

1. Every UI change MUST be verified in a real browser via the **Playwright MCP** server (`.mcp.json`) before reporting the task as complete. Type checks alone are not sufficient.
2. Start everything automatically — do not ask the user to launch processes:
   - **Backend**: `bun run dev:backend` (root) — boots NestJS, seeds the dev DB, writes a discovery file the UI proxy reads.
   - **UI**: `cd src/agent_extensions/plugins/noesis/mcp/noesis-graph/ui && bun run dev` — Vite proxies `/api/*` to the backend via the discovery file.
   - **Browser**: open the Vite URL with `mcp__playwright__browser_navigate`, then drive interactions and assert state with `browser_snapshot` / `browser_evaluate` / `browser_console_messages`.
   Run backend and UI dev servers with `run_in_background: true`.
3. After verification, ALWAYS delete any PNG screenshots saved to the repo via `browser_take_screenshot` (whether at the repo root or elsewhere). They are throwaway verification artifacts and must not be left behind before reporting the task as complete.

## End-to-end smoke test

`bun run smoke:noesis` drives a real `claude -p` session through the full skill chain (`analyze-conversation` → `analyze-design-draft` → `create-design-doc`) and verifies every UI view endpoint against the produced graph. See `tests/agent_extensions/plugins/noesis/smoke/README.md`.

**It consumes LLM tokens.** Do NOT run it autonomously. Always:

1. Ask the user for explicit approval first.
2. Only after approval, run with `NOESIS_SMOKE_CONFIRM=1 bun run smoke:noesis`. Without that env var the test refuses to start.