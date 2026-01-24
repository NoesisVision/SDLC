/**
 * Session metadata from sessions-index.json
 */
export interface SessionMetadata {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

/**
 * Session index structure
 */
export interface SessionIndex {
  version: number;
  entries: SessionMetadata[];
}

/**
 * JSONL message types
 */
export interface JsonlMessage {
  type: string;
  sessionId?: string;
  timestamp?: string;
  uuid?: string;
  [key: string]: unknown;
}
