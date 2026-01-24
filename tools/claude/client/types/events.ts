import { QuestionOption } from './question';

/**
 * Base event emitted from Claude Code
 */
export interface BaseEvent {
  type: string;
  timestamp: Date;
}

/**
 * System initialization event
 */
export interface SystemInitEvent extends BaseEvent {
  type: 'system';
  subtype: 'init';
  sessionId: string;
  cwd: string;
  tools: string[];
  mcp_servers: string[];
  model: string;
  permissionMode: string;
  slash_commands: string[];
  agents: string[];
  skills: string[];
  plugins: Array<{ name: string; path: string }>;
}

/**
 * Text content event from assistant
 */
export interface TextEvent extends BaseEvent {
  type: 'text';
  content: string;
}

/**
 * Thinking block event (extended thinking)
 */
export interface ThinkingEvent extends BaseEvent {
  type: 'thinking';
  content: string;
}

/**
 * Tool use event
 */
export interface ToolUseEvent extends BaseEvent {
  type: 'tool_use';
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
}

/**
 * Tool result event
 */
export interface ToolResultEvent extends BaseEvent {
  type: 'tool_result';
  toolName: string;
  toolUseId: string;
  result: unknown;
  isError: boolean;
}

/**
 * Question event (AskUserQuestion detected)
 */
export interface QuestionEvent extends BaseEvent {
  type: 'question';
  questionId: string;
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/**
 * Assistant message event
 */
export interface AssistantMessageEvent extends BaseEvent {
  type: 'assistant';
  messageId: string;
  model: string;
  content: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
}

/**
 * Result event (final outcome)
 */
export interface ResultEvent extends BaseEvent {
  type: 'result';
  subtype: 'success' | 'error';
  isError: boolean;
  result?: string;
  error?: string;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  usage: Record<string, unknown>;
}

/**
 * Raw line event (unparsed output)
 */
export interface RawLineEvent extends BaseEvent {
  type: 'raw';
  line: string;
}

/**
 * Error event
 */
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  error: Error;
  message: string;
}

/**
 * Union of all event types
 */
export type ClaudeEvent =
  | SystemInitEvent
  | TextEvent
  | ThinkingEvent
  | ToolUseEvent
  | ToolResultEvent
  | QuestionEvent
  | AssistantMessageEvent
  | ResultEvent
  | RawLineEvent
  | ErrorEvent;
