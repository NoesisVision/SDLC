#!/usr/bin/env node
/**
 * Exec wrapper for Claude Code - for use with promptfoo
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
  console.error(`[Claude] Starting evaluation...`);
  console.error(`[Claude] Prompt preview: ${promptPreview}`);

  // Create temporary file for the prompt
  const tempFile = path.join('/tmp', `claude-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, prompt);

  // Invoke Claude Code in non-interactive mode
  let output;
  const timeout = 600000; // 10 minutes
  const startTime = Date.now();

  try {
    // Method 1: Using --print flag with file input
    output = execSync(`claude --print --dangerously-skip-permissions < "${tempFile}"`, {
      encoding: 'utf8',
      timeout: timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      cwd: process.cwd()
    });
  } catch (e1) {
    try {
      // Method 2: Using --print with direct prompt argument
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      output = execSync(`claude --print --dangerously-skip-permissions '${escapedPrompt}'`, {
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
  console.error(`[Claude] ✓ Completed in ${duration}s (${outputLength} chars)`);

  // Output the result
  console.log(output);
} catch (error) {
  console.error('Error executing Claude Code:', error.message);
  process.exit(1);
}