import { Inject, Injectable } from "@nestjs/common";
import type { TopicFileNew } from "../../../../shared-contracts/source-file-schemas-new.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { TopicsRepositoryNew } from "./topics-new.repository.js";

export type LockedField = "title" | "short_summary" | "long_summary";

export interface TopicEditableFields {
  title?: string;
  short_summary?: string;
  long_summary?: string;
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  topic_id: string;
}

export interface SourceShaSnapshot {
  conversation: Map<string, string>;
  document: Map<string, string>;
}

@Injectable()
export class TopicsServiceNew {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: TopicsRepositoryNew,
  ) {}

  canonicalPath(topicId: string): string {
    return this.repository.canonicalPath(this.projectDir, topicId);
  }

  async deleteForFile(absPath: string): Promise<{ topic_id: string } | null> {
    const id = inferTopicIdFromPath(absPath);
    if (id === null) return null;
    if (!(await this.repository.exists(id))) return null;
    await this.repository.delete(id);
    return { topic_id: id };
  }

  async editFieldsAndLock(
    topicId: string,
    fields: TopicEditableFields,
    confirmedByUser: boolean,
  ): Promise<{ updated: LockedField[] }> {
    const path = this.canonicalPath(topicId);
    if (!this.repository.fileExists(path)) {
      throw new Error(`Topic file not found: ${path}`);
    }
    const file = this.repository.readFile(path);
    const next = applyTopicEdits(file, fields, confirmedByUser);
    if (next.changes.length === 0) return { updated: [] };
    this.repository.writeFile(path, next.file);
    return { updated: next.changes };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readFile(absPath);
    const stored = await this.repository.read(file.id);
    if (stored !== null && stored.sha === sha) {
      return { status: "unchanged", topic_id: file.id };
    }
    await this.repository.upsert(file, sha);
    return { status: "indexed", topic_id: file.id };
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles(this.projectDir);
  }

  async readStaleFlag(topicId: string): Promise<boolean | null> {
    return this.repository.readStaleFlag(topicId);
  }

  async refreshStaleFlags(snapshot: SourceShaSnapshot): Promise<number> {
    const stored = await this.repository.listAll();
    let staleCount = 0;
    for (const topic of stored) {
      const path = this.canonicalPath(topic.id);
      if (!this.repository.fileExists(path)) continue;
      const file = this.repository.readFile(path);
      const isStale = computeStaleFromItems(file.items, snapshot);
      if (isStale !== file.is_stale) {
        const updated: TopicFileNew = { ...file, is_stale: isStale };
        this.repository.writeFile(path, updated);
      }
      if (isStale !== topic.is_stale) {
        await this.repository.writeStaleFlag(topic.id, isStale);
      }
      if (isStale) staleCount++;
    }
    return staleCount;
  }
}

interface ApplyResult {
  file: TopicFileNew;
  changes: LockedField[];
}

function applyTopicEdits(
  file: TopicFileNew,
  fields: TopicEditableFields,
  confirmedByUser: boolean,
): ApplyResult {
  const changes: LockedField[] = [];
  let next: TopicFileNew = file;
  if (fields.title !== undefined) {
    next = applyEdit(next, "title", "title_locked", fields.title, confirmedByUser, changes);
  }
  if (fields.short_summary !== undefined) {
    next = applyEdit(
      next,
      "short_summary",
      "short_summary_locked",
      fields.short_summary,
      confirmedByUser,
      changes,
    );
  }
  if (fields.long_summary !== undefined) {
    next = applyEdit(
      next,
      "long_summary",
      "long_summary_locked",
      fields.long_summary,
      confirmedByUser,
      changes,
    );
  }
  return { file: next, changes };
}

function applyEdit(
  file: TopicFileNew,
  fieldKey: "title" | "short_summary" | "long_summary",
  lockKey: "title_locked" | "short_summary_locked" | "long_summary_locked",
  newValue: string,
  confirmedByUser: boolean,
  changes: LockedField[],
): TopicFileNew {
  if (file[fieldKey] === newValue) return file;
  if (file[lockKey] && !confirmedByUser) {
    throw new Error(
      `Topic ${file.id}: field "${fieldKey}" is locked; pass confirmedByUser=true to override.`,
    );
  }
  changes.push(fieldKey);
  return { ...file, [fieldKey]: newValue, [lockKey]: true };
}

function computeStaleFromItems(
  items: TopicFileNew["items"],
  snapshot: SourceShaSnapshot,
): boolean {
  for (const item of items) {
    if (item.source_sha === undefined) continue;
    const currentSha =
      item.type === "idea_unit_ref"
        ? snapshot.conversation.get(item.conversation_id)
        : snapshot.document.get(item.document_id);
    if (currentSha !== undefined && currentSha !== item.source_sha) return true;
  }
  return false;
}

function inferTopicIdFromPath(absPath: string): string | null {
  const match = /\/topics\/([^/]+)\.json$/.exec(absPath);
  return match === null ? null : match[1];
}
