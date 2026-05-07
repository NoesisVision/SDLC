import { Injectable } from "@nestjs/common";
import { existsSync, statSync } from "fs";
import { DatabaseService } from "../database/database.service.js";
import {
  ConversationSidecarSchema,
  DecisionFileSchema,
  DocumentSidecarSchema,
  TopicFileSchema,
} from "../../../shared-contracts/source-file-schemas.js";
import { DesignDocSchema } from "../../../shared-contracts/design-doc.js";
import { readSidecar, type SourceFileKind } from "../../../shared-contracts/source-files.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import type { z } from "zod";

export interface ProjectionRequest {
  kind: SourceFileKind;
  ext: ".md" | ".json";
  id: string;
  absPath: string;
  sha: string;
  editedByUser: boolean;
}

@Injectable()
export class GraphProjectionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly designDocs: DesignDocsRepository,
  ) {}

  async project(request: ProjectionRequest): Promise<void> {
    switch (request.kind) {
      case "conversation":
        await (request.ext === ".md"
          ? this.projectConversationMd(request)
          : this.projectConversationSidecar(request));
        return;
      case "document":
        await (request.ext === ".md"
          ? this.projectDocumentMd(request)
          : this.projectDocumentSidecar(request));
        return;
      case "topic":
        await this.projectTopic(request);
        return;
      case "decision":
        await this.projectDecision(request);
        return;
      case "design_doc":
        await this.projectDesignDoc(request);
        return;
    }
  }

  private async projectConversationMd(req: ProjectionRequest): Promise<void> {
    await this.db.query(
      "MERGE (c:Conversation {id: $id}) SET c.md_sha = $sha",
      { id: req.id, sha: req.sha },
    );
  }

  private async projectConversationSidecar(req: ProjectionRequest): Promise<void> {
    const sidecar = loadIfExists(req.absPath, ConversationSidecarSchema);
    if (sidecar === null) return;
    await this.db.query(
      "MERGE (c:Conversation {id: $id}) SET c.time = $time, c.main_topic = $main_topic, c.source_sha = $sha, c.edited_by_user = $edited",
      {
        id: req.id,
        time: sidecar.time,
        main_topic: sidecar.main_topic,
        sha: req.sha,
        edited: req.editedByUser,
      },
    );
  }

  private async projectDocumentMd(req: ProjectionRequest): Promise<void> {
    await this.db.query(
      "MERGE (d:Document {id: $id}) SET d.md_sha = $sha",
      { id: req.id, sha: req.sha },
    );
  }

  private async projectDocumentSidecar(req: ProjectionRequest): Promise<void> {
    const sidecar = loadIfExists(req.absPath, DocumentSidecarSchema);
    if (sidecar === null) return;
    await this.db.query(
      "MERGE (d:Document {id: $id}) SET d.title = $title, d.date = $date, d.source_sha = $sha, d.edited_by_user = $edited",
      {
        id: req.id,
        title: sidecar.title,
        date: sidecar.date,
        sha: req.sha,
        edited: req.editedByUser,
      },
    );
  }

  private async projectTopic(req: ProjectionRequest): Promise<void> {
    const topic = loadIfExists(req.absPath, TopicFileSchema);
    if (topic === null) return;
    await this.db.query(
      "MERGE (t:Topic {id: $id}) SET t.title = $title, t.short_summary = $short_summary, t.long_summary = $long_summary, t.source_sha = $sha, t.edited_by_user = $edited",
      {
        id: req.id,
        title: topic.title,
        short_summary: topic.short_summary,
        long_summary: topic.long_summary,
        sha: req.sha,
        edited: req.editedByUser,
      },
    );
  }

  private async projectDecision(req: ProjectionRequest): Promise<void> {
    const decision = loadIfExists(req.absPath, DecisionFileSchema);
    if (decision === null) return;
    await this.db.query(
      "MERGE (d:Decision {id: $id}) SET d.title = $title, d.status = $status, d.source_sha = $sha, d.edited_by_user = $edited",
      {
        id: req.id,
        title: decision.title,
        status: decision.status,
        sha: req.sha,
        edited: req.editedByUser,
      },
    );
  }

  private async projectDesignDoc(req: ProjectionRequest): Promise<void> {
    const doc = loadIfExists(req.absPath, DesignDocSchema);
    if (doc === null) return;
    await this.designDocs.replaceDesignDoc(doc, fileMtimeDate(req.absPath));
    await this.db.query(
      "MATCH (dd:DesignDoc) WHERE dd.id = $id SET dd.source_sha = $sha, dd.edited_by_user = $edited",
      { id: req.id, sha: req.sha, edited: req.editedByUser },
    );
  }
}

function fileMtimeDate(absPath: string): string {
  return statSync(absPath).mtime.toISOString().slice(0, 10);
}

function loadIfExists<T>(path: string, schema: z.ZodType<T>): T | null {
  if (!existsSync(path)) return null;
  try {
    return readSidecar(path, schema);
  } catch {
    return null;
  }
}
