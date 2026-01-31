import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { SessionIndex, SessionMetadata } from '../types/session';
import { encodeProjectPath } from '../../../utils/path-encoding.utils';

/**
 * Manages Claude Code sessions
 */
export class SessionManager {
  private projectPath: string;
  private sessionDir: string;
  private indexPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    const encodedPath = encodeProjectPath(projectPath);
    this.sessionDir = join(homedir(), '.claude', 'projects', encodedPath);
    this.indexPath = join(this.sessionDir, 'sessions-index.json');
  }

  /**
   * Get or create a session for the current project
   */
  async getOrCreateSession(): Promise<string> {
    // Check if session directory exists
    if (!existsSync(this.sessionDir)) {
      return this.createNewSession();
    }

    // Load most recent session
    const sessions = await this.listSessions();
    if (sessions.length === 0) {
      return this.createNewSession();
    }

    // Return most recent session
    const mostRecent = sessions.sort(
      (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()
    )[0];

    return mostRecent!.sessionId;
  }

  /**
   * List all sessions for the project
   */
  async listSessions(): Promise<SessionMetadata[]> {
    if (!existsSync(this.indexPath)) {
      return [];
    }

    try {
      const content = readFileSync(this.indexPath, 'utf-8');
      const index: SessionIndex = JSON.parse(content);
      return index.entries;
    } catch (error) {
      console.error('Failed to read sessions index:', error);
      return [];
    }
  }

  /**
   * Create a new session ID
   */
  private createNewSession(): string {
    return uuidv4();
  }

  /**
   * Get session file path
   */
  getSessionFilePath(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.jsonl`);
  }
}
