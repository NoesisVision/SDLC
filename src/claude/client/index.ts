/**
 * Claude Client - TypeScript wrapper for Claude Code CLI
 *
 * This module provides a TypeScript client for interacting with Claude Code CLI
 * as a subprocess, with support for:
 * - Model selection (sonnet, opus, haiku)
 * - Dual streaming (raw output + parsed events)
 * - Session preservation (automatic session management)
 * - Question handling (promise-based API)
 *
 * @example
 * ```typescript
 * import { ClaudeClient } from './tools/claude/client';
 *
 * const client = new ClaudeClient({
 *   projectPath: '/path/to/project',
 *   model: 'sonnet'
 * });
 *
 * client.on('text', (event) => {
 *   console.log(event.content);
 * });
 *
 * const result = await client.prompt('Explain this codebase');
 * console.log('Result:', result);
 *
 * await client.dispose();
 * ```
 */

export { ClaudeClient } from './core/ClaudeClient';

// Export types
export type { ClaudeConfig, ClaudeModel, PermissionMode } from './types/config';
export type {
  ClaudeEvent,
  BaseEvent,
  SystemInitEvent,
  TextEvent,
  ThinkingEvent,
  ToolUseEvent,
  ToolResultEvent,
  QuestionEvent,
  AssistantMessageEvent,
  ResultEvent,
  RawLineEvent,
  ErrorEvent
} from './types/events';
export type { Question, QuestionOption, QuestionAnswer } from './types/question';
export type { SessionMetadata, SessionIndex, JsonlMessage } from './types/session';
