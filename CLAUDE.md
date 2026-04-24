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

## Python

1. Use PEP 8 guidelines.
2. Use type hints for all public functions.
3. Always use strong types.
4. Use `@dataclass` for entities in internal logic.
5. Use `Pydantic` for DTOs used in API.
6. Use `pytest` for tests.
7. Use docstrings with Google style for inline documentation.
8. Do NOT use comments in method bodies. Use descriptive function and variable names.
9. Use ONLY `uv` to run scripts.
10. Access Pydantic model fields via **typed attributes** (`result.id`, `result.items[0].name`), never via dict keys. Use `.model_dump()` only at serialization boundaries (API responses, file I/O).
11. Use `None` for optional arguments in functions.
12. PEP 723 scripts executed with `uv run` cannot import from Python packages (directories with `__init__.py`). Keep all shared modules as flat `.py` files in the same directory.