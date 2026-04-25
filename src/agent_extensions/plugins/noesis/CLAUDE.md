# Noesis plugin — design rules

Layered on `src/agent_extensions/CLAUDE.md` and `SDLC/CLAUDE.md`. Only the noesis-specific delta is captured here.

## Models

- **Skill output**: each skill has a `{SkillName}Output` Zod schema at `shared-contracts/skills/<skill>/output.ts`. Skills that build a result incrementally persist it as `<working_dir>/output.json` and edit it in place across steps.
- **UI read models**: each view (page or independently-loaded section) has its own contract type. Define one type per view shaped to exactly what the screen needs; assemble it server-side so the UI does one fetch per view when possible.
- **UI contract location**: per-view contracts live at `mcp/<package>/ui-contracts/<view>/<view>-data.ts` and are imported directly by both the backend service and the UI (the UI's `tsconfig.json` includes `../ui-contracts` so types are not duplicated). No separate "ui-data" layer.
- **Shared contracts**: top-level `shared-contracts/` holds cross-skill, cross-domain models grouped by domain; `shared-contracts/skills/<skill>/` holds skill-specific output and helpers. Reuse a top-level model whenever it fits as-is.
- **Type minimalism**: prefer passing a bit too much data over introducing a new type. Aliases and structural shapes beat fresh interfaces when the shape already exists.

## Architecture

- **Repositories**: granular DB ops only (`exists`, `insertX`, `linkX`, `listXForY`, `updateXFields`). Used **only by services** — never from MCP handlers, controllers, or other repositories.
- **Services**: orchestrate use cases AND assemble UI view models. They read + validate input, call the repositories they need (own-domain plus same-graph cross-domain when the view requires it), and shape rows into the contract type the view expects. The only callers of repositories.
- **HTTP controllers**: live in the same domain dir as their service (`<domain>/<domain>.controller.ts`), registered in that domain's NestJS module. Thin — parse args, call a service method, return the result. No separate UI-data layer of controllers or services.
- **MCP tools**: thin too — parse args, call a service method, shape the response.
- **One step → one struct → one MCP tool**: each workflow step gets a single dedicated structure returned by a single tool. Avoid chatty round-trips.
- **Minimal returns**: return only what the agent or UI needs next. `{ status: "Ok" }` or `{ id }` is fine; per-slot breakdowns usually aren't.

## Boundaries

- **No LLM in the MCP server**: `noesis-graph` has no Anthropic API access. All semantic reasoning (Goldilocks topic search, summarisation, decision/design extraction) happens in the agent driving the skill. The server provides deterministic data access only.
