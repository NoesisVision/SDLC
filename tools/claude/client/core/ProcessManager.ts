import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

/**
 * Manages the Claude Code CLI subprocess
 */
export class ProcessManager extends EventEmitter {
  private executable: string;
  private timeout: number;
  private process?: ChildProcess;
  private stdinStream?: Writable;

  constructor(executable: string, timeout: number = 120000) {
    super();
    this.executable = executable;
    this.timeout = timeout;
  }

  /**
   * Start the Claude Code process
   */
  async start(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.executable, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env }
        });

        if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
          throw new Error('Failed to create process streams');
        }

        this.stdinStream = this.process.stdin;

        // Set up stream handlers
        this.process.stdout.on('data', (data) => {
          this.emit('stdout', data);
        });

        this.process.stderr.on('data', (data) => {
          this.emit('stderr', data);
        });

        this.process.on('error', (error) => {
          this.emit('error', error);
          reject(error);
        });

        this.process.on('exit', (code) => {
          this.emit('exit', code);
        });

        // Wait a bit to ensure process started
        setTimeout(() => resolve(), 100);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the process
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      this.process.once('exit', () => {
        this.process = undefined;
        this.stdinStream = undefined;
        resolve();
      });

      this.process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  /**
   * Get stdin stream for writing
   */
  getStdin(): Writable {
    if (!this.stdinStream) {
      throw new Error('Process not started');
    }
    return this.stdinStream;
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return this.process !== undefined && !this.process.killed;
  }
}
