/**
 * Test script for Claude Client
 *
 * This script demonstrates how to use the Claude Client to interact with
 * Claude Code CLI programmatically.
 *
 * Usage:
 *   ts-node examples/test_claude_client.ts
 */

import { ClaudeClient } from '../tools/claude/client';
import * as readline from 'readline';

async function getUserInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log('=== Claude Client Test ===\n');

  // Create client
  const client = new ClaudeClient({
    projectPath: process.cwd(),
    model: 'sonnet',
    permissionMode: 'default'
  });

  // Listen to text events
  client.on('text', (event) => {
    process.stdout.write(event.content);
  });

  // Listen to thinking events
  client.on('thinking', (event) => {
    console.log('\n[Thinking]:', event.content.substring(0, 100) + '...');
  });

  // Listen to tool use events
  client.on('tool_use', (event) => {
    console.log(`\n[Tool]: ${event.toolName}`);
  });

  // Handle questions
  client.on('question', async (question) => {
    console.log(`\n\n${question.header}: ${question.question}`);
    question.options.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${opt.label}${opt.description ? ' - ' + opt.description : ''}`);
    });

    const choice = await getUserInput('\nSelect option (1-' + question.options.length + '): ');
    const selectedIndex = parseInt(choice) - 1;

    if (selectedIndex >= 0 && selectedIndex < question.options.length) {
      const selected = question.options[selectedIndex];
      console.log(`Selected: ${selected.label}\n`);
      await client.answerQuestion(question.questionId, [selected.label]);
    } else {
      console.log('Invalid selection, using first option\n');
      await client.answerQuestion(question.questionId, [question.options[0].label]);
    }
  });

  // Handle errors
  client.on('error', (event) => {
    console.error('\n[Error]:', event.message);
  });

  try {
    console.log('Sending prompt to Claude...\n');

    // Send a simple prompt
    const result = await client.prompt('What are the main directories in this project? List them briefly.');

    console.log('\n\n=== Result ===');
    console.log(result);

    // Get session info
    console.log('\n=== Session Info ===');
    console.log('Session ID:', client.getSessionId());

    // List all sessions
    const sessions = await client.listSessions();
    console.log('Total sessions for this project:', sessions.length);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Cleanup
    await client.dispose();
    console.log('\n=== Test Complete ===');
  }
}

// Run the test
main().catch(console.error);
