/**
 * Validation utilities for JSON schema validation using AJV
 */

import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';

/**
 * Result of a validation operation
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates JSON data against a JSON schema
 *
 * @param dataPath - Path to the JSON data file to validate
 * @param schemaPath - Path to the JSON schema file
 * @returns Validation result with boolean valid flag and array of error messages
 *
 * @example
 * ```typescript
 * const result = await validateJsonAgainstSchema(
 *   'data/model-changes.json',
 *   'schemas/model-changes-schema.json'
 * );
 *
 * if (result.valid) {
 *   console.log('Validation passed!');
 * } else {
 *   console.error('Validation failed:', result.errors);
 * }
 * ```
 */
export async function validateJsonAgainstSchema(
  dataPath: string,
  schemaPath: string
): Promise<ValidationResult> {
  try {
    // Initialize AJV with strict schema validation
    const ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: true,
    });

    // Add format validators (date, email, uri, etc.)
    addFormats(ajv);

    // Load and parse schema
    const schemaContent = readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent) as object;

    // Load and parse data
    const dataContent = readFileSync(dataPath, 'utf-8');
    const data = JSON.parse(dataContent) as unknown;

    // Compile and validate
    const validate = ajv.compile(schema);
    const valid = validate(data);

    if (!valid && validate.errors) {
      return {
        valid: false,
        errors: formatValidationErrors(validate.errors),
      };
    }

    return { valid: true, errors: [] };
  } catch (error) {
    // Handle file reading or JSON parsing errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      errors: [`Validation error: ${errorMessage}`],
    };
  }
}

/**
 * Formats AJV error objects into human-readable error messages
 *
 * @param errors - Array of AJV error objects
 * @returns Array of formatted error strings
 */
function formatValidationErrors(errors: ErrorObject[]): string[] {
  return errors.map((error) => {
    const path = error.instancePath || 'root';
    const message = error.message || 'validation failed';

    // Add additional context for specific error types
    if (error.keyword === 'required') {
      const missingProp = error.params.missingProperty as string;
      return `${path}: missing required property '${missingProp}'`;
    }

    if (error.keyword === 'enum') {
      const allowedValues = (error.params.allowedValues as string[]).join(', ');
      return `${path}: ${message}. Allowed values: ${allowedValues}`;
    }

    if (error.keyword === 'type') {
      const expectedType = error.params.type as string;
      return `${path}: ${message} (expected ${expectedType})`;
    }

    return `${path}: ${message}`;
  });
}

/**
 * Validates JSON data against a schema and throws if invalid
 *
 * @param dataPath - Path to the JSON data file to validate
 * @param schemaPath - Path to the JSON schema file
 * @throws Error with validation messages if validation fails
 *
 * @example
 * ```typescript
 * try {
 *   await validateOrThrow('data.json', 'schema.json');
 *   console.log('Validation passed!');
 * } catch (error) {
 *   console.error('Validation failed:', error.message);
 * }
 * ```
 */
export async function validateOrThrow(dataPath: string, schemaPath: string): Promise<void> {
  const result = await validateJsonAgainstSchema(dataPath, schemaPath);

  if (!result.valid) {
    throw new Error(`Validation failed:\n${result.errors.join('\n')}`);
  }
}
