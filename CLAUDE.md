# Implementation guidelines

## General
1. Use functional paradigm for data transformation.
2. Use procedural paradigm for use cases coordination logic.
3. Structure code base on capabilities not technical patterns (like entities, repositories, services).
4. Mimic `src` structure in `tests`.
5. Use **snake_case** for directory and file name.

## Python
1. Use `@dataclass` for entities in internal logic.
2. Use `Pydantic` for DTOs used in API.
3. Use `pytest` for tests.
4. Use docstrings with Google style for inline documentation.