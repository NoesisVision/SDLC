# Repository Structure

This document describes the organization and best practices for the SDLC repository.

## Overview

This is a polyglot monorepo containing:
- **TypeScript** tools and utilities (primary language)
- **Python** MCP (Model Context Protocol) servers
- **Markdown** AI agent skills and commands

## Directory Structure

```
SDLC/
├── src/                        # All source code
│   ├── agent_extensions/       # Claude agent skills and commands
│   │   ├── commands/           # CLI command definitions
│   │   └── skills/             # Reusable AI skills
│   │
│   ├── claude/                 # Claude Code CLI integration
│   │   └── client/             # TypeScript SDK
│   │       ├── core/           # Implementation classes
│   │       └── types/          # Type definitions
│   │
│   ├── mcp/                    # Model Context Protocol servers (Python)
│   │   └── noesis_local/       # Example MCP server
│   │       ├── server.py       # Main server implementation
│   │       └── README.md
│   │
│   ├── p3/                     # P3 model validation tools
│   │   ├── schema_types.ts
│   │   └── validate_model_changes.ts
│   │
│   └── utils/                  # Shared TypeScript utilities
│       ├── validation_utils.ts
│       ├── file_utils.ts
│       ├── jsonl_parser_utils.ts
│       └── path_encoding_utils.ts
│
├── tests/                      # All tests (mirrors src/ structure)
│   └── mcp/
│       └── noesis_local/
│           └── test_server.py
│
├── dist/                       # TypeScript build output
├── node_modules/               # Node.js dependencies
│
├── package.json                # Node.js dependencies and scripts
├── pyproject.toml              # Python dependencies and configuration
├── tsconfig.json               # TypeScript configuration
├── .eslintrc.json              # ESLint configuration
├── .prettierrc                 # Prettier configuration
│
└── README.md                   # Main repository documentation
```

## Language-Specific Guidelines

### TypeScript

**Source Location:** `src/`

**Build System:**
- Uses `tsc` (TypeScript Compiler) for production builds
- Output goes to `dist/` directory
- Uses `tsx` for development (no build step)

**Module System:**
- ESM modules (`type: "module"` in package.json)
- Target: ES2022
- All imports must use `.js` extensions (even for `.ts` files)

**Path Aliases:**
```typescript
// Use path alias for shared utilities
import { validateJsonAgainstSchema } from '@utils/validation_utils.js';

// Configured in tsconfig.json:
"paths": {
  "@utils/*": ["./src/utils/*"]
}
```

**Scripts:**
```bash
npm run build          # Compile TypeScript to dist/
npm run build:watch    # Watch mode compilation
npm run type-check     # Type check without emitting files
npm run lint           # Run ESLint
npm run format         # Format code with Prettier
npm run format:check   # Check formatting
```

**Code Style:**
- Strict TypeScript configuration
- ESLint + Prettier for formatting
- No unused variables or parameters
- Explicit return types required

### Python

**Source Location:** `src/mcp/` (and other Python modules)

**Test Location:** `tests/` (mirrors `src/` structure)

**Dependency Management:**
- **Primary source of truth:** `pyproject.toml` (at repository root)
- **NO** `requirements.txt` or `setup.py` files
- Install with: `pip install -e .` or `pip install -e ".[dev]"`

**Test Naming Convention:**
- Test files: `test_*.py`
- Test classes: `Test*`
- Test functions: `test_*`

**Scripts:**
```bash
npm run test           # Run pytest
npm run test:verbose   # Run pytest with verbose output
pytest tests/          # Run all tests
pytest tests/mcp/      # Run specific module tests
```

**Code Style:**
- Black for formatting (line length: 100)
- isort for import sorting
- mypy for type checking
- Ruff for linting
- Python 3.8+ compatibility

**Configuration:**
All Python tools are configured in `pyproject.toml`:
- `[tool.black]` - Black formatter settings
- `[tool.isort]` - Import sorting
- `[tool.mypy]` - Type checking
- `[tool.ruff]` - Linting rules
- `[tool.pytest.ini_options]` - Test configuration

## Adding New Code

### Adding a New TypeScript Utility

1. Create file in `src/utils/`:
   ```bash
   touch src/utils/new_feature_utils.ts
   ```

2. Export from the file and use path alias in other files:
   ```typescript
   // src/utils/new_feature_utils.ts
   export function myFunction() { /* ... */ }

   // src/p3/some_file.ts
   import { myFunction } from '@utils/new_feature_utils.js';
   ```

3. Run type-check and lint:
   ```bash
   npm run type-check
   npm run lint
   ```

### Adding a New MCP Server

1. Create server directory:
   ```bash
   mkdir -p src/mcp/my_new_server
   touch src/mcp/my_new_server/server.py
   touch src/mcp/my_new_server/README.md
   ```

2. Create test directory:
   ```bash
   mkdir -p tests/mcp/my_new_server
   touch tests/mcp/my_new_server/__init__.py
   touch tests/mcp/my_new_server/test_server.py
   ```

3. Add dependencies to `pyproject.toml` if needed:
   ```toml
   [project]
   dependencies = [
       "mcp>=1.0.0",
       "your-new-dep>=1.0.0",
   ]
   ```

4. Write tests and run:
   ```bash
   pytest tests/mcp/my_new_server/
   ```

### Adding a New Python Module (Non-MCP)

1. Create module in `src/`:
   ```bash
   mkdir -p src/my_module
   touch src/my_module/__init__.py
   touch src/my_module/main.py
   ```

2. Create corresponding tests:
   ```bash
   mkdir -p tests/my_module
   touch tests/my_module/__init__.py
   touch tests/my_module/test_main.py
   ```

3. Update `pyproject.toml` if needed:
   ```toml
   [tool.setuptools.packages.find]
   where = ["src"]
   include = ["mcp*", "my_module*"]
   ```

## Best Practices

### General

1. **Mirror structure in tests:** Tests should mirror the `src/` directory structure
2. **One source of truth:** Use `pyproject.toml` for Python, `package.json` for Node.js
3. **No generated files in git:** `dist/`, `node_modules/`, `__pycache__/`, `.pytest_cache/`
4. **Consistent naming:**
   - Python: `snake_case.py`
   - TypeScript: `snake_case.ts`

### TypeScript

1. **Always use path aliases** for imports from `src/utils/`
2. **Include `.js` extension** in imports (even for `.ts` files)
3. **Strict type checking** - no `any` types without justification
4. **Document complex functions** with JSDoc comments

### Python

1. **Type hints required** for all public functions
2. **Docstrings required** for modules, classes, and public functions
3. **Tests required** for all new code
4. **Follow PEP 8** (enforced by Black and Ruff)

## Migration from Old Structure

Previously, the repository used `tools/` instead of `src/`. The migration included:

1. Renamed `tools/` → `src/`
2. Created `tests/` directory at root level
3. Moved test files from source directories to `tests/`
4. Created `pyproject.toml` to replace scattered `requirements.txt` files
5. Updated all configuration files (tsconfig.json, package.json)

All references to `tools/` should now use `src/`.

## Questions?

For questions about:
- **TypeScript setup:** Check `tsconfig.json` and `package.json`
- **Python setup:** Check `pyproject.toml`
- **MCP servers:** See `src/mcp/noesis_local/README.md` for an example
- **Repository structure:** This file (STRUCTURE.md)
