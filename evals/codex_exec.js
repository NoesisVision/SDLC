#!/usr/bin/env node
/**
 * Exec wrapper for Codex - for use with promptfoo
 * Receives prompt as command-line arguments
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get prompt from command-line arguments
const prompt = process.argv.slice(2).join(' ');

if (!prompt) {
  console.error('Error: No prompt provided');
  process.exit(1);
}

try {
  // Log to stderr so it doesn't interfere with stdout (which promptfoo reads)
  const promptPreview = prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '');
  console.error(`[Codex] Starting evaluation...`);
  console.error(`[Codex] Prompt preview: ${promptPreview}`);

  // Create temporary file for the prompt
  const tempFile = path.join('/tmp', `codex-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, prompt);

  // Invoke Codex in non-interactive mode
  let output;
  const timeout = 600000; // 10 minutes
  const startTime = Date.now();

  try {
    // Method 1: Using exec subcommand with file input
    output = execSync(`codex exec < "${tempFile}"`, {
      encoding: 'utf8',
      timeout: timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      cwd: process.cwd()
    });
  } catch (e1) {
    try {
      // Method 2: Using exec subcommand with direct prompt argument
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      output = execSync(`codex exec '${escapedPrompt}'`, {
        encoding: 'utf8',
        timeout: timeout,
        maxBuffer: 10 * 1024 * 1024,
        cwd: process.cwd()
      });
    } catch (e2) {
      throw new Error(`All methods failed. Last error: ${e2.message}`);
    }
  }

  // Cleanup
  try {
    fs.unlinkSync(tempFile);
  } catch (e) {
    // Ignore cleanup errors
  }

  // Log completion
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const outputLength = output.length;
  console.error(`[Codex] ✓ Completed in ${duration}s (${outputLength} chars)`);

  // Output the result
  console.log(output);
} catch (error) {
  console.error('Error executing Codex:', error.message);
  process.exit(1);
}