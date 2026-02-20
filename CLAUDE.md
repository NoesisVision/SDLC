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
8. Use **snake_case** for directory and file name.

## TypeScript

1. Use ESM modules — all imports must use `.js` extensions (even for `.ts` files).
2. Use path alias `@utils/*` for imports from `src/utils/`.
3. Strict TypeScript — no `any` types without justification.

## Python

1. Use PEP 8 guidelines.
2. Use type hints for all public functions.
3. Use `@dataclass` for entities in internal logic.
4. Use `Pydantic` for DTOs used in API.
5. Use `pytest` for tests.
6. Use docstrings with Google style for inline documentation.
7. Do NOT use comments in method bodies. Use descriptive function and variable names.
8. Use ONLY `uv` to run scripts.