# Implementation guidelines

## General
1. Use functional paradigm for data transformation.
2. Use procedural paradigm for use cases coordination logic.
3. Structure code base on capabilities not technical patterns (like entities, repositories, services).
4. Mimic `src` structure in `tests`.
5. Use **snake_case** for directory and file name.

## TypeScript
1. Use ESM modules — all imports must use `.js` extensions (even for `.ts` files).
2. Use path alias `@utils/*` for imports from `src/utils/`.
3. Strict TypeScript — no `any` types without justification.

## Python
1. Use type hints for all public functions.
2. Use `@dataclass` for entities in internal logic.
3. Use `Pydantic` for DTOs used in API.
4. Use `pytest` for tests.
5. Use docstrings with Google style for inline documentation.