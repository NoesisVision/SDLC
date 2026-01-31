/**
 * Model aliases supported by Claude Code CLI
 */
export type ClaudeModel = 'sonnet' | 'opus' | 'haiku' | string;

/**
 * Permission modes for Claude Code
 */
export type PermissionMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'delegate'
  | 'dontAsk'
  | 'plan';

/**
 * Configuration for Claude Client
 */
export interface ClaudeConfig {
  /** Path to the project directory */
  projectPath: string;

  /** Model to use (sonnet, opus, haiku, or full model name) */
  model?: ClaudeModel;

  /** Permission mode */
  permissionMode?: PermissionMode;

  /** Maximum budget in USD for API calls */
  maxBudgetUsd?: number;

  /** Session ID to resume (auto-detected if not provided) */
  sessionId?: string;

  /** Enable verbose output */
  verbose?: boolean;

  /** Additional CLI arguments */
  additionalArgs?: string[];

  /** Path to claude executable (defaults to 'claude') */
  claudeExecutable?: string;

  /** Timeout for subprocess operations in ms */
  timeout?: number;
}
