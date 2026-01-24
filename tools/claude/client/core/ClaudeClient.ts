import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { ClaudeConfig } from '../types/config';
import { ClaudeEvent, ResultEvent, ErrorEvent, ToolUseEvent } from '../types/events';
import { Question, QuestionAnswer } from '../types/question';
import { SessionMetadata } from '../types/session';
import { ProcessManager } from './ProcessManager';
import { SessionManager } from './SessionManager';
import { StreamParser } from './StreamParser';
import { QuestionHandler } from './QuestionHandler';

/**
 * Main client class for Claude Code CLI
 *
 * @example
 * ```typescript
 * const client = new ClaudeClient({
 *   projectPath: '/path/to/project',
 *   model: 'sonnet'
 * });
 *
 * // Send a prompt and handle events
 * const response = await client.prompt('Explain this codebase');
 *
 * // Listen to parsed events
 * client.on('text', (event) => {
 *   console.log('Text:', event.content);
 * });
 *
 * // Handle questions
 * client.on('question', async (question) => {
 *   const answer = await getUserInput(question);
 *   await client.answerQuestion(question.questionId, answer);
 * });
 *
 * // Get raw stream
 * const stream = client.getRawStream();
 * stream.pipe(process.stdout);
 * ```
 */
export class ClaudeClient extends EventEmitter {
  private config: ClaudeConfig;
  private processManager: ProcessManager;
  private sessionManager: SessionManager;
  private streamParser: StreamParser;
  private questionHandler: QuestionHandler;
  private rawStream: Readable;
  private currentSessionId?: string;

  constructor(config: ClaudeConfig) {
    super();
    this.config = this.validateConfig(config);

    // Initialize managers
    this.sessionManager = new SessionManager(config.projectPath);
    this.processManager = new ProcessManager(
      config.claudeExecutable || 'claude',
      config.timeout
    );
    this.streamParser = new StreamParser();
    this.questionHandler = new QuestionHandler();
    this.rawStream = new Readable({ read() {} });

    // Wire up event handlers
    this.setupEventHandlers();
  }

  /**
   * Send a prompt to Claude Code
   *
   * @param prompt - The prompt text
   * @param options - Optional override options
   * @returns Promise that resolves when complete or rejects on error
   */
  async prompt(
    prompt: string,
    options?: Partial<ClaudeConfig>
  ): Promise<string> {
    const config = { ...this.config, ...options };

    // Get or create session
    this.currentSessionId = config.sessionId ||
      await this.sessionManager.getOrCreateSession();

    // Build CLI arguments
    const args = this.buildCliArgs(prompt, config);

    // Start process
    await this.processManager.start(args);

    // Return promise that resolves when result event received
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Prompt timeout'));
      }, config.timeout || 120000);

      this.once('result', (event: ResultEvent) => {
        clearTimeout(timeout);
        if (event.isError) {
          reject(new Error(event.error || 'Unknown error'));
        } else {
          resolve(event.result || '');
        }
      });

      this.once('error', (event: ErrorEvent) => {
        clearTimeout(timeout);
        reject(event.error);
      });
    });
  }

  /**
   * Send a prompt and wait for the first question
   *
   * @param prompt - The prompt text
   * @returns Promise that resolves with the first question or null if no question
   */
  async promptAndWaitForQuestion(prompt: string): Promise<Question | null> {
    // Start the prompt
    const promptPromise = this.prompt(prompt);

    // Race between question and completion
    return new Promise((resolve, reject) => {
      const questionHandler = (question: Question) => {
        this.removeListener('result', resultHandler);
        resolve(question);
      };

      const resultHandler = () => {
        this.removeListener('question', questionHandler);
        resolve(null);
      };

      this.once('question', questionHandler);
      this.once('result', resultHandler);

      promptPromise.catch(reject);
    });
  }

  /**
   * Answer a pending question
   *
   * @param questionId - ID of the question to answer
   * @param selectedOptions - Array of selected option labels
   */
  async answerQuestion(
    questionId: string,
    selectedOptions: string[]
  ): Promise<void> {
    const answer: QuestionAnswer = {
      questionId,
      selectedOptions
    };

    await this.questionHandler.sendAnswer(
      this.processManager.getStdin(),
      answer
    );
  }

  /**
   * Get raw output stream (pass-through of stdout)
   *
   * @returns Readable stream of raw output
   */
  getRawStream(): Readable {
    return this.rawStream;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | undefined {
    return this.currentSessionId;
  }

  /**
   * List all sessions for the project
   */
  async listSessions(): Promise<SessionMetadata[]> {
    return this.sessionManager.listSessions();
  }

  /**
   * Resume a specific session
   */
  async resumeSession(sessionId: string): Promise<void> {
    this.currentSessionId = sessionId;
    this.config.sessionId = sessionId;
  }

  /**
   * Stop the Claude Code process
   */
  async stop(): Promise<void> {
    await this.processManager.stop();
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    await this.stop();
    this.removeAllListeners();
  }

  // Private methods

  private validateConfig(config: ClaudeConfig): ClaudeConfig {
    if (!config.projectPath) {
      throw new Error('projectPath is required');
    }
    return {
      model: 'sonnet',
      permissionMode: 'default',
      verbose: false,
      timeout: 120000,
      ...config
    };
  }

  private buildCliArgs(prompt: string, config: ClaudeConfig): string[] {
    const args = [
      '--print',
      '--verbose',
      '--output-format=stream-json'
    ];

    if (config.model) {
      args.push('--model', config.model);
    }

    if (config.permissionMode) {
      args.push('--permission-mode', config.permissionMode);
    }

    if (config.sessionId) {
      args.push('--session-id', config.sessionId);
    }

    if (config.maxBudgetUsd) {
      args.push('--max-budget-usd', config.maxBudgetUsd.toString());
    }

    if (config.additionalArgs) {
      args.push(...config.additionalArgs);
    }

    args.push(prompt);

    return args;
  }

  private setupEventHandlers(): void {
    // Parse stdout into events
    this.processManager.on('stdout', (data: Buffer) => {
      const chunk = data.toString();

      // Emit to raw stream
      this.rawStream.push(chunk);

      // Parse into events
      const events = this.streamParser.parse(chunk);
      events.forEach(event => {
        // Check for questions
        if (event.type === 'tool_use' &&
            (event as ToolUseEvent).toolName === 'AskUserQuestion') {
          const question = this.questionHandler.extractQuestion(
            event as ToolUseEvent
          );
          if (question) {
            this.emit('question', question);
          }
        }

        // Emit parsed event
        this.emit(event.type, event);
        this.emit('event', event);
      });
    });

    // Handle stderr
    this.processManager.on('stderr', (data: Buffer) => {
      const error = new Error(data.toString());
      this.emit('error', {
        type: 'error',
        timestamp: new Date(),
        error,
        message: error.message
      });
    });

    // Handle process exit
    this.processManager.on('exit', (code: number) => {
      this.rawStream.push(null); // End stream
      if (code !== 0) {
        this.emit('error', {
          type: 'error',
          timestamp: new Date(),
          error: new Error(`Process exited with code ${code}`),
          message: `Process exited with code ${code}`
        });
      }
    });
  }
}
