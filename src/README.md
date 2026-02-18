# TypeScript Tools

This directory contains TypeScript utilities and scripts for SDLC tooling.

## Directory Structure

```
tools/
├── p3/                       # P3 Model related tools
│   ├── schema_types.ts       # P3 Model TypeScript type definitions
│   └── validate_model_changes.ts  # P3 model changes validator script
├── utils/                    # Shared utility functions
│   ├── validation_utils.ts   # JSON schema validation with AJV
│   └── file_utils.ts         # File system helpers
├── claude/                   # Claude AI skills and commands
│   ├── skills/              # Reusable AI skills
│   └── commands/            # CLI commands
└── README.md                # This file
```

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm (comes with Node.js)

### Installation

Dependencies are managed at the repository root:

```bash
# Install dependencies
npm install
```

### Development

Run TypeScript scripts directly during development:

```bash
# Run a script with tsx
npm run dev tools/p3/validate_model_changes.ts <args>

# Or use the convenience script
npm run validate:model path/to/model-changes.json
```

### Production Build

Compile TypeScript to JavaScript:

```bash
# Build all scripts
npm run build

# Run compiled JavaScript
node dist/p3/validate_model_changes.js <args>

# Clean build artifacts
npm run clean
```

### Code Quality

```bash
# Type checking (without emitting files)
npm run type-check

# Lint TypeScript code
npm run lint

# Format code with Prettier
npm run format

# Check formatting without modifying files
npm run format:check
```

## Writing New Scripts

### 1. Choose the Right Directory

- `p3/` - P3 Model related tools and validators
- `utils/` - Shared utility functions
- Create new directories as needed for other categories

### 2. Use Path Aliases for Imports

Use configured path aliases to avoid relative path issues:

```typescript
// ✓ Good - using path aliases
import { validateJsonAgainstSchema } from '@utils/validation_utils.js';
import { fileExists } from '@utils/file_utils.js';

// ✗ Avoid - brittle relative paths
import { validateJsonAgainstSchema } from '../utils/validation_utils.js';
```

**Available path aliases:**
- `@utils/*` → `tools/utils/*`

### 3. ESM Module Format

All scripts use ES modules (ESM). Remember:

```typescript
// Import with .js extension (TypeScript compiles .ts to .js)
import { something } from './module.js';

// Get __dirname in ESM
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### 4. Add Shebang for Executable Scripts

For scripts meant to be run directly:

```typescript
#!/usr/bin/env node

// Your script code here
```

### 5. Example Script Template

```typescript
#!/usr/bin/env node
/**
 * Brief description of what this script does
 *
 * Usage:
 *   npm run script-name <args>
 *   tsx tools/category/script_name.ts <args>
 */

import { resolve } from 'path';
import { someUtil } from '@utils/some_utils.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Your script logic here

  if (success) {
    console.log('✓ Success message');
    process.exit(0);
  } else {
    console.error('✗ Error message');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('✗ Fatal error:', error);
  process.exit(1);
});
```

### 6. Add npm Script (Optional)

For frequently used scripts, add a convenience npm script in `package.json`:

```json
{
  "scripts": {
    "script-name": "tsx tools/category/script_name.ts"
  }
}
```

## Creating Shared Utilities

### Utility Functions (`utils/`)

Create focused utility modules in the `utils/` directory:

```typescript
// utils/my_utils.ts

/**
 * Does something useful
 * @param input - Description of input
 * @returns Description of return value
 */
export function doSomething(input: string): string {
  return input.toUpperCase();
}
```

**Best practices for utilities:**
- One responsibility per file
- Export only what's needed
- Add JSDoc comments for public functions
- Include usage examples in comments
- Add unit tests (place next to source: `my_utils.test.ts`)

## Examples

### Example: Validate P3 Model Changes

The [validate_model_changes.ts](p3/validate_model_changes.ts) script demonstrates:
- Using shared utilities (`@utils/validation_utils.js`, `@utils/file_utils.js`)
- Using shared types ([schema_types.ts](p3/schema_types.ts))
- Proper error handling and exit codes
- Clear user feedback with ✓/✗ symbols
- ESM module structure

```bash
# Run with npm script
npm run validate:model path/to/model-changes.json

# Run with tsx directly
npm run dev tools/p3/validate_model_changes.ts path/to/model-changes.json

# Run compiled version
npm run build
node dist/p3/validate_model_changes.js path/to/model-changes.json
```

## Troubleshooting

### Path Alias Not Resolving

If your IDE shows errors for path aliases:

1. Restart your TypeScript server
2. Check that `tsconfig.json` includes your file
3. Verify the path alias is defined in `tsconfig.json` paths

### Module Not Found Errors

Remember to use `.js` extensions in imports even though files are `.ts`:

```typescript
// ✓ Correct
import { x } from './module.js';

// ✗ Wrong
import { x } from './module';
import { x } from './module.ts';
```

### Type Errors with JSON Imports

Ensure `resolveJsonModule` is enabled in `tsconfig.json` (already configured):

```typescript
import schema from './schema.json' assert { type: 'json' };
```

## Configuration Files

Key configuration files at repository root:

- [package.json](../package.json) - Dependencies and npm scripts
- [tsconfig.json](../tsconfig.json) - TypeScript compiler configuration
- [.eslintrc.json](../.eslintrc.json) - ESLint rules
- [.prettierrc](../.prettierrc) - Code formatting rules
- [.gitignore](../.gitignore) - Ignored files and directories
