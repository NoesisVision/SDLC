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
7. Naming:
   - **Directories and Files:** `kebab-case`
   - **Types, Interfaces, Enums:** `PascalCase`
   - **Functions, methods, variables:** `camelCase`
   - **Constants:** `UPPER_SNAKE_CASE`
8. All code, comments, documentation, and commit messages must be in **English**.

## TypeScript

1. **Bun** as runtime and package manager (`bun install`, `bun run`, `bunx`).
2. **NestJS** for backend servers.
3. **React + Vite** for UI applications.
4. Strict TypeScript — no `any` types without justification.
5. Narrow discriminated unions (and any closed string-literal union) with `switch` on the discriminator plus an `assertNever(x)` default — never `if`/`else if` chains or ternaries. This gives compile-time exhaustiveness when a new variant is added. The `assertNever` helper lives in `shared-contracts/assert-never.ts`.

## Tests

- All test code lives under `tests/` — never colocated with `src/`. Unit tests mirror the `src/` tree: `src/<path>/foo.ts` → `tests/unit/<path>/foo.test.ts`. Protocol-level / entry-point tests likewise mirror the `src/` tree under `tests/e2e/`, located at the entry point's path: `src/<path>/foo.mcp.ts` → `tests/e2e/<path>/foo.mcp.test.ts`. Shared fixtures and test helpers live under `tests/` (e.g. `tests/helpers/`, `tests/fixtures/`), never inside `src/`.
- **Always use the TS path aliases for test imports** — never deep-relative chains like `../../../../src/...`. The aliases live in the SDLC root `tsconfig.json` and are honored by Bun:
   - `@noesis/*` → `src/agent_extensions/plugins/noesis/*` — for any source under the noesis plugin (services, repositories, shared-contracts, ui-contracts, etc.).
   - `@tests/*` → `tests/*` — for `tests/bdd.ts`, `tests/helpers/*`, `tests/fixtures/*`.
   Examples: `import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";`, `import { given, when, then } from "@tests/bdd.js";`. When adding new top-level test directories (e.g. plugin-specific helpers), extend `tsconfig.json` `paths` rather than introducing relative imports.
- Use BDD syntax with `tests/bdd.ts` helpers for all tests. Pay close attention to each step description - it must reflect domain relevant information. These scenarios are not only tests but also documentation.
   - **Step roles**: `given` sets up preconditions, `when` performs the action under test, `then` asserts the outcome. Never put the action in `given` while leaving `when` empty — the `when` body IS the documentation of what is being tested.
   - **Descriptions read like prose**, not like restated code: state the domain fact, not the variable name or the call site. Avoid descriptions that just paraphrase the next assertion.
   - **One scenario, one outcome**: do not bundle unrelated success and failure paths (e.g. "adds X and rejects Y") into a single test — split them.
- Test each behavior at exactly **one** layer — never re-assert the same outcome in service, handler, controller, and e2e tests:
   - **Services** own all business-logic and DB-shape assertions.
   - **MCP handler unit tests** are limited to formatting/presentation helpers (e.g. Markdown rendering); never test handlers themselves.
   - **Controllers** have no unit tests — entry-point coverage comes from e2e tests.
   - **E2E tests** (`tests/e2e/`) — one or more tests per entry point (MCP tool, HTTP endpoint, UI page), split by distinct output (e.g. success path, validation errors, auth failures) when the entry point produces more than one. Drive each at its protocol boundary: JSON-RPC over stdio for MCP, HTTP over the wire for API endpoints, Playwright for UI pages. Verify only wiring, schema/contract validation, presentation logic, and error formatting — never re-test business rules.
- Completeness checklist:
   - Every `*.service.ts` has a matching `*.service.test.ts` under `tests/unit/`.
   - Every entry point (MCP tool in `*.mcp.ts`, HTTP endpoint in `*.controller.ts`, UI page) has at least one test under `tests/e2e/` at the mirrored path, plus one additional test per distinct output.
   - Every public function in `scripts/` has unit tests.
- Asserts on data read from the DB compare whole rows (or the full set of relevant fields). Presence/count helpers (`countNodes`, `countRels`, `toHaveLength`) and single-field projections (`.map(r => r.id)`) are acceptable only as **additional** sanity checks, never as the sole assertion.
- Reuse seed data from `dev-seed.ts` and shared test helpers under `tests/helpers/` (e.g. a `sampleConversation()` fixture builder, a `setupKnowledgeTests()` lifecycle wrapper) instead of constructing fresh fixtures or copy-pasting `beforeAll` / `afterAll` / `beforeEach` blocks per test.

## UI verification

1. Every UI change MUST be verified in a real browser via the **Playwright MCP** server (`.mcp.json`) before reporting the task as complete. Type checks alone are not sufficient.
2. Start everything automatically — do not ask the user to launch processes:
   - **Backend**: `bun run dev:backend` (root) — boots NestJS, seeds the dev DB, writes a discovery file the UI proxy reads.
   - **UI**: `cd src/agent_extensions/plugins/noesis/mcp/noesis-graph/ui && bun run dev` — Vite proxies `/api/*` to the backend via the discovery file.
   - **Browser**: open the Vite URL with `mcp__playwright__browser_navigate`, then drive interactions and assert state with `browser_snapshot` / `browser_evaluate` / `browser_console_messages`.
   Run backend and UI dev servers with `run_in_background: true`.
3. After verification, ALWAYS delete throwaway Playwright MCP artifacts before reporting the task as complete:
   - Any PNG screenshots saved via `browser_take_screenshot` (at the repo root or elsewhere).
   - The contents of `.playwright-mcp/` (console `*.log` files and page `*.yml` snapshots auto-written by `browser_console_messages` / `browser_snapshot`). The directory itself is gitignored, but its files accumulate across sessions and must be removed.

## End-to-end smoke test

`bun run test:smoke` drives a real `claude -p` session through the full skill chain (`analyze-conversation` → `analyze-design-draft` → `create-design-doc`) and verifies every UI view endpoint against the produced graph. See `tests/agent_extensions/plugins/noesis/smoke/README.md`.

**It consumes LLM tokens.** Do NOT run it autonomously. Always:

1. Ask the user for explicit approval first.
2. Only after approval, run with `NOESIS_SMOKE_CONFIRM=1 bun run smoke:noesis`. Without that env var the test refuses to start.