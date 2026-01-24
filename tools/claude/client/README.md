# Claude Client

TypeScript wrapper for Claude Code CLI that provides programmatic access to Claude Code with full TypeScript type safety.

## Features

- **Model Selection**: Choose between sonnet, opus, and haiku models
- **Dual Streaming**: Access both raw output stream and parsed event emitters
- **Session Preservation**: Automatic session management across multiple interactions
- **Question Handling**: Promise-based API for handling Claude's questions
- **Full TypeScript Support**: Complete type definitions for all events and configurations

## Installation

Dependencies are already installed in this repository. The client uses:
- `uuid` - For generating session IDs
- `@types/uuid` - TypeScript definitions for uuid

## Quick Start

```typescript
import { ClaudeClient } from './tools/claude/client';

// Create a client
const client = new ClaudeClient({
  projectPath: '/path/to/your/project',
  model: 'sonnet'
});

// Listen to text output
client.on('text', (event) => {
  console.log(event.content);
});

// Send a prompt
const result = await client.prompt('Explain this codebase');
console.log('Result:', result);

// Clean up
await client.dispose();
```

## Configuration Options

```typescript
interface ClaudeConfig {
  projectPath: string;              // Required: path to project
  model?: 'sonnet' | 'opus' | 'haiku';  // Default: 'sonnet'
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'plan';
  sessionId?: string;               // Auto-detected if not provided
  maxBudgetUsd?: number;            // Budget limit
  verbose?: boolean;                // Verbose output
  timeout?: number;                 // Default: 120000ms
  claudeExecutable?: string;        // Default: 'claude'
  additionalArgs?: string[];        // Extra CLI arguments
}
```

## Event Types

The client emits the following events:

- `text` - Text content from Claude
- `thinking` - Extended thinking blocks
- `tool_use` - Tool invocations
- `tool_result` - Tool results
- `question` - Questions from AskUserQuestion tool
- `assistant` - Full assistant messages
- `result` - Final result with usage stats
- `error` - Error events
- `event` - Catch-all for any event

## Handling Questions

```typescript
client.on('question', async (question) => {
  console.log(`${question.header}: ${question.question}`);

  // Display options
  question.options.forEach((opt, i) => {
    console.log(`  ${i+1}. ${opt.label} - ${opt.description}`);
  });

  // Get user input
  const choice = await getUserInput('Select: ');
  const selected = question.options[choice - 1];

  // Answer the question
  await client.answerQuestion(question.questionId, [selected.label]);
});

await client.prompt('Design a new feature');
```

## Multiple Interactions (Session Preservation)

```typescript
const client = new ClaudeClient({
  projectPath: '/path/to/project',
  model: 'sonnet'
});

// First interaction
await client.prompt('Create a user model');

// Second interaction (same session automatically)
await client.prompt('Add validation to the user model');

// Third interaction
await client.prompt('Write tests for the user model');

// All interactions share the same session
console.log('Session ID:', client.getSessionId());
```

## Streaming Output

```typescript
// Get both raw stream AND parsed events
const client = new ClaudeClient({ projectPath: process.cwd() });

// Raw output stream
client.getRawStream().pipe(process.stdout);

// Parsed events
client.on('text', (event) => {
  // Process structured text events
  console.log('Received text:', event.content);
});

client.on('tool_use', (event) => {
  console.log('Tool used:', event.toolName);
});

await client.prompt('Analyze the codebase');
```

## Session Management

```typescript
// List all sessions for the project
const sessions = await client.listSessions();
console.log('Available sessions:', sessions.length);

// Resume a specific session
await client.resumeSession(sessions[0].sessionId);
await client.prompt('What were we discussing?');
```

## Error Handling

```typescript
client.on('error', (event) => {
  console.error('Error:', event.message);
});

try {
  await client.prompt('...');
} catch (error) {
  console.error('Failed:', error);
}
```

## Architecture

```
ClaudeClient (main API)
├── ProcessManager (subprocess lifecycle)
│   └── Spawns 'claude' CLI with stream-json output
├── SessionManager (automatic session detection)
│   └── Reads ~/.claude/projects/ for session state
├── StreamParser (parse stream-json to events)
│   └── Converts JSON lines to typed events
└── QuestionHandler (detect & answer questions)
    └── Handles AskUserQuestion tool interactions
```

## File Structure

```
tools/claude/client/
├── index.ts                   # Main exports
├── types/
│   ├── config.ts             # Configuration types
│   ├── events.ts             # Event type definitions
│   ├── question.ts           # Question types
│   └── session.ts            # Session metadata types
└── core/
    ├── ClaudeClient.ts       # Main client class
    ├── ProcessManager.ts     # Subprocess management
    ├── SessionManager.ts     # Session handling
    ├── StreamParser.ts       # Output parsing
    └── QuestionHandler.ts    # Question/answer logic
```

## Testing

Run the test example:

```bash
npx ts-node examples/test-claude-client.ts
```

## API Reference

### ClaudeClient

#### Methods

- `prompt(text: string, options?: Partial<ClaudeConfig>): Promise<string>`
  - Send a prompt and wait for completion
  - Returns the final result text

- `promptAndWaitForQuestion(text: string): Promise<Question | null>`
  - Send a prompt and return the first question
  - Returns null if no question is asked

- `answerQuestion(questionId: string, selectedOptions: string[]): Promise<void>`
  - Answer a pending question

- `getRawStream(): Readable`
  - Get the raw output stream

- `getSessionId(): string | undefined`
  - Get the current session ID

- `listSessions(): Promise<SessionMetadata[]>`
  - List all sessions for the project

- `resumeSession(sessionId: string): Promise<void>`
  - Resume a specific session

- `stop(): Promise<void>`
  - Stop the Claude process

- `dispose(): Promise<void>`
  - Clean up all resources

#### Events

All events extend `BaseEvent` with `type` and `timestamp` fields.

See `tools/claude/client/types/events.ts` for complete type definitions.

## License

Part of the SDLC repository.
