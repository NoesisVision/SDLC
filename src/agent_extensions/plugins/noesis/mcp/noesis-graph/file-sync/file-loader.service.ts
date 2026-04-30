import { Inject, Injectable, Logger } from "@nestjs/common";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { extname, sep } from "path";
import { DatabaseService } from "../database/database.service.js";
import { PROJECT_DIR } from "../config/config.module.js";
import {
  computeFileSha,
  noesisRoot,
  readSidecar,
  type SourceFileKind,
} from "../../../shared-contracts/source-files.js";
import {
  ConversationSidecarSchema,
  DecisionFileSchema,
  DocumentSidecarSchema,
  TopicFileSchema,
  type TopicFileItem,
} from "../../../shared-contracts/source-file-schemas.js";
import { DesignDocSchema } from "../../../shared-contracts/design-doc.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import {
  SourceFilesRepository,
  type SourceFileRow,
} from "./source-files.repository.js";

export interface DetectedFile {
  kind: SourceFileKind;
  id: string;
  ext: ".md" | ".json";
}

export interface LoadResult {
  kind: SourceFileKind;
  id: string;
  sha: string;
  user_edit_detected: boolean;
}

const SUBDIR_KIND: Record<string, SourceFileKind> = {
  conversations: "conversation",
  documents: "document",
  topics: "topic",
  decisions: "decision",
  "design-docs": "design_doc",
};

@Injectable()
export class FileLoaderService {
  private readonly logger = new Logger(FileLoaderService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sourceFiles: SourceFilesRepository,
    private readonly designDocs: DesignDocsRepository,
    @Inject(PROJECT_DIR) private readonly projectDir: string,
  ) {}

  detect(absPath: string): DetectedFile | null {
    const root = noesisRoot(this.projectDir);
    if (!absPath.startsWith(`${root}${sep}`)) return null;
    const rel = absPath.slice(root.length + 1);
    const segments = rel.split(sep);
    if (segments.length < 2) return null;
    const subdir = segments[0];
    const filename = segments[segments.length - 1];
    const kind = SUBDIR_KIND[subdir];
    if (kind === undefined) return null;
    const ext = extname(filename);
    if (ext !== ".md" && ext !== ".json") return null;
    const id =
      kind === "design_doc" && ext === ".json"
        ? readDesignDocId(absPath)
        : filename.slice(0, -ext.length);
    if (id === null) return null;
    return { kind, id, ext };
  }

  async loadFile(absPath: string): Promise<LoadResult | null> {
    const detected = this.detect(absPath);
    if (detected === null) return null;
    if (!existsSync(absPath)) return null;

    const sha = computeFileSha(absPath);
    const prior = await this.sourceFiles.get(absPath);
    const userEditDetected = prior !== null && prior.sha !== sha
      ? await this.handleUserEdit(absPath, detected)
      : false;

    const finalSha = userEditDetected ? computeFileSha(absPath) : sha;

    await this.upsertEntityMetadata(absPath, detected, finalSha);
    await this.sourceFiles.upsert({
      path: absPath,
      kind: detected.kind,
      entity_id: detected.id,
      sha: finalSha,
      indexed_at: new Date().toISOString(),
    });
    return { kind: detected.kind, id: detected.id, sha: finalSha, user_edit_detected: userEditDetected };
  }

  async registerWritten(absPath: string): Promise<LoadResult | null> {
    const detected = this.detect(absPath);
    if (detected === null || !existsSync(absPath)) return null;
    const sha = computeFileSha(absPath);
    await this.upsertEntityMetadata(absPath, detected, sha);
    await this.sourceFiles.upsert({
      path: absPath,
      kind: detected.kind,
      entity_id: detected.id,
      sha,
      indexed_at: new Date().toISOString(),
    });
    return { kind: detected.kind, id: detected.id, sha, user_edit_detected: false };
  }

  async removeFile(absPath: string): Promise<SourceFileRow | null> {
    const row = await this.sourceFiles.get(absPath);
    if (row === null) return null;
    await this.sourceFiles.remove(absPath);
    return row;
  }

  async refreshStaleFlags(): Promise<number> {
    const allFiles = await this.sourceFiles.listAll();
    const shaByEntity = buildShaIndex(allFiles);
    let staleCount = 0;
    for (const file of allFiles) {
      if (file.kind === "topic") {
        const isStale = this.computeStale(
          loadIfExists(file.path, TopicFileSchema)?.items ?? [],
          shaByEntity,
        );
        await this.db.query(
          "MATCH (t:Topic) WHERE t.id = $id SET t.is_stale = $is_stale",
          { id: file.entity_id, is_stale: isStale },
        );
        if (isStale) staleCount++;
      } else if (file.kind === "decision") {
        const isStale = this.computeStale(
          loadIfExists(file.path, DecisionFileSchema)?.referenced_items ?? [],
          shaByEntity,
        );
        await this.db.query(
          "MATCH (d:Decision) WHERE d.id = $id SET d.is_stale = $is_stale",
          { id: file.entity_id, is_stale: isStale },
        );
        if (isStale) staleCount++;
      }
    }
    return staleCount;
  }

  private computeStale(
    items: TopicFileItem[],
    shaByEntity: Map<string, string>,
  ): boolean {
    for (const item of items) {
      if (item.source_sha === undefined) continue;
      const lookupKey =
        item.type === "idea_unit_ref"
          ? `conversation:${item.conversation_id}`
          : `document:${item.document_id}`;
      const currentSha = shaByEntity.get(lookupKey);
      if (currentSha !== undefined && currentSha !== item.source_sha) {
        return true;
      }
    }
    return false;
  }

  private async handleUserEdit(
    absPath: string,
    detected: DetectedFile,
  ): Promise<boolean> {
    if (detected.ext !== ".json") return true;
    try {
      const raw = readFileSync(absPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.edited_by_user === true) return true;
      parsed.edited_by_user = true;
      writeFileSync(absPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
      this.logger.log(
        `Detected user edit on ${absPath}; flagged edited_by_user=true`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to flag user edit on ${absPath}: ${(err as Error).message}`,
      );
      return true;
    }
  }

  private async upsertEntityMetadata(
    absPath: string,
    detected: DetectedFile,
    sha: string,
  ): Promise<void> {
    const editedByUser = await readEditedByUserFlag(absPath, detected);
    switch (detected.kind) {
      case "conversation":
        if (detected.ext === ".md") {
          await this.upsertConversationMd(detected.id, sha);
        } else {
          await this.upsertConversationSidecar(absPath, detected.id, sha, editedByUser);
        }
        return;
      case "document":
        if (detected.ext === ".md") {
          await this.upsertDocumentMd(detected.id, sha);
        } else {
          await this.upsertDocumentSidecar(absPath, detected.id, sha, editedByUser);
        }
        return;
      case "topic":
        await this.upsertTopicFile(absPath, detected.id, sha, editedByUser);
        return;
      case "decision":
        await this.upsertDecisionFile(absPath, detected.id, sha, editedByUser);
        return;
      case "design_doc":
        await this.upsertDesignDocFile(absPath, detected.id, sha, editedByUser);
        return;
    }
  }

  private async upsertConversationMd(id: string, sha: string): Promise<void> {
    await this.db.query(
      "MERGE (c:Conversation {id: $id}) SET c.md_sha = $sha",
      { id, sha },
    );
  }

  private async upsertConversationSidecar(
    absPath: string,
    id: string,
    sha: string,
    editedByUser: boolean,
  ): Promise<void> {
    const sidecar = loadIfExists(absPath, ConversationSidecarSchema);
    if (sidecar === null) return;
    await this.db.query(
      "MERGE (c:Conversation {id: $id}) SET c.time = $time, c.main_topic = $main_topic, c.source_sha = $sha, c.edited_by_user = $edited",
      {
        id,
        time: sidecar.time,
        main_topic: sidecar.main_topic,
        sha,
        edited: editedByUser,
      },
    );
  }

  private async upsertDocumentMd(id: string, sha: string): Promise<void> {
    await this.db.query(
      "MERGE (d:Document {id: $id}) SET d.md_sha = $sha",
      { id, sha },
    );
  }

  private async upsertDocumentSidecar(
    absPath: string,
    id: string,
    sha: string,
    editedByUser: boolean,
  ): Promise<void> {
    const sidecar = loadIfExists(absPath, DocumentSidecarSchema);
    if (sidecar === null) return;
    await this.db.query(
      "MERGE (d:Document {id: $id}) SET d.title = $title, d.date = $date, d.source_sha = $sha, d.edited_by_user = $edited",
      {
        id,
        title: sidecar.title,
        date: sidecar.date,
        sha,
        edited: editedByUser,
      },
    );
  }

  private async upsertTopicFile(
    absPath: string,
    id: string,
    sha: string,
    editedByUser: boolean,
  ): Promise<void> {
    const topic = loadIfExists(absPath, TopicFileSchema);
    if (topic === null) return;
    await this.db.query(
      "MERGE (t:Topic {id: $id}) SET t.title = $title, t.short_summary = $short_summary, t.long_summary = $long_summary, t.source_sha = $sha, t.edited_by_user = $edited",
      {
        id,
        title: topic.title,
        short_summary: topic.short_summary,
        long_summary: topic.long_summary,
        sha,
        edited: editedByUser,
      },
    );
  }

  private async upsertDecisionFile(
    absPath: string,
    id: string,
    sha: string,
    editedByUser: boolean,
  ): Promise<void> {
    const decision = loadIfExists(absPath, DecisionFileSchema);
    if (decision === null) return;
    await this.db.query(
      "MERGE (d:Decision {id: $id}) SET d.title = $title, d.status = $status, d.source_sha = $sha, d.edited_by_user = $edited",
      {
        id,
        title: decision.title,
        status: decision.status,
        sha,
        edited: editedByUser,
      },
    );
  }

  private async upsertDesignDocFile(
    absPath: string,
    id: string,
    sha: string,
    editedByUser: boolean,
  ): Promise<void> {
    const doc = loadIfExists(absPath, DesignDocSchema);
    if (doc === null) return;
    await this.designDocs.applyDesignDoc(doc, fileMtimeDate(absPath));
    await this.db.query(
      "MATCH (dd:DesignDoc) WHERE dd.id = $id SET dd.source_sha = $sha, dd.edited_by_user = $edited",
      { id, sha, edited: editedByUser },
    );
  }
}

function fileMtimeDate(absPath: string): string {
  return statSync(absPath).mtime.toISOString().slice(0, 10);
}

function loadIfExists<T>(
  path: string,
  schema: Parameters<typeof readSidecar<T>>[1],
): T | null {
  if (!existsSync(path)) return null;
  try {
    return readSidecar(path, schema);
  } catch {
    return null;
  }
}

async function readEditedByUserFlag(
  absPath: string,
  detected: DetectedFile,
): Promise<boolean> {
  if (detected.ext !== ".json") return false;
  try {
    const raw = readFileSync(absPath, "utf-8");
    const parsed = JSON.parse(raw) as { edited_by_user?: boolean };
    return parsed.edited_by_user === true;
  } catch {
    return false;
  }
}

function readDesignDocId(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absPath, "utf-8")) as {
      id?: unknown;
    };
    if (typeof parsed.id === "string" && parsed.id !== "") return parsed.id;
  } catch {
    // fall through
  }
  return null;
}

function buildShaIndex(files: SourceFileRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    if (file.kind === "conversation" && file.path.endsWith(".json")) {
      map.set(`conversation:${file.entity_id}`, file.sha);
    } else if (file.kind === "document" && file.path.endsWith(".json")) {
      map.set(`document:${file.entity_id}`, file.sha);
    }
  }
  return map;
}
