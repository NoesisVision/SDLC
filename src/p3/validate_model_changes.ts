#!/usr/bin/env node
/**
 * Validates P3 model changes JSON files against the schema
 *
 * This is a TypeScript implementation of the bash script:
 * tools/claude/skills/design_feature/validate_model_changes.sh
 *
 * Usage:
 *   npm run validate:model <path-to-model-changes.json>
 *   tsx tools/p3/validate_model_changes.ts <path-to-model-changes.json>
 *   node dist/p3/validate_model_changes.js <path-to-model-changes.json>
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateJsonAgainstSchema } from '@utils/validation_utils.js';
import { fileExists } from '@utils/file_utils.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the schema file (relative to this script)
const SCHEMA_PATH = resolve(
  __dirname,
  '../claude/skills/design_feature/model_changes_schema.json'
);

/**
 * Prints usage information
 */
function printUsage(): void {
  console.error('Usage: validate_model_changes <path-to-model-changes.json>');
  console.error('');
  console.error('Validates a P3 model changes JSON file against the schema.');
  console.error('');
  console.error('Examples:');
  console.error('  npm run validate:model specs/feature-1/model-changes.json');
  console.error('  tsx tools/p3/validate_model_changes.ts data.json');
  console.error('  node dist/p3/validate_model_changes.js data.json');
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const dataPath = resolve(process.cwd(), args[0] ?? '');

  // Validate that files exist
  if (!fileExists(dataPath)) {
    console.error(`✗ Error: File not found: ${dataPath}`);
    process.exit(1);
  }

  if (!fileExists(SCHEMA_PATH)) {
    console.error(`✗ Error: Schema file not found: ${SCHEMA_PATH}`);
    console.error('This is likely a configuration issue.');
    process.exit(1);
  }

  // Perform validation
  console.log(`Validating: ${dataPath}`);
  console.log(`Schema: ${SCHEMA_PATH}`);
  console.log('');

  try {
    const result = await validateJsonAgainstSchema(dataPath, SCHEMA_PATH);

    if (result.valid) {
      console.log('✓ Validation passed');
      console.log('The model changes file is valid according to the schema.');
      process.exit(0);
    } else {
      console.error('✗ Validation failed');
      console.error('');
      console.error('Errors:');
      result.errors.forEach((err, index) => {
        console.error(`  ${index + 1}. ${err}`);
      });
      console.error('');
      console.error('Please fix the errors above and try again.');
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Unexpected error during validation:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Execute main function and handle any unhandled errors
main().catch((error) => {
  console.error('✗ Fatal error:');
  console.error(error);
  process.exit(1);
});
