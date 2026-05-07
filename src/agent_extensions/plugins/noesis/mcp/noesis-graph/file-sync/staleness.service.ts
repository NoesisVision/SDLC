import { Injectable } from "@nestjs/common";
import { existsSync } from "fs";
import { DatabaseService } from "../database/database.service.js";
import {
  DecisionFileSchema,
  TopicFileSchema,
  type TopicFileItem,
} from "../../../shared-contracts/source-file-schemas.js";
import { readSidecar } from "../../../shared-contracts/source-files.js";
import {
  SourceFilesRepository,
  type SourceFileRow,
} from "./source-files.repository.js";
import type { z } from "zod";

@Injectable()
export class StalenessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sourceFiles: SourceFilesRepository,
  ) {}

  async refreshStaleFlags(): Promise<number> {
    const allFiles = await this.sourceFiles.listAll();
    const shaByEntity = buildShaIndex(allFiles);
    let staleCount = 0;
    for (const file of allFiles) {
      if (file.kind === "topic") {
        const isStale = computeStale(
          loadIfExists(file.path, TopicFileSchema)?.items ?? [],
          shaByEntity,
        );
        await this.db.query(
          "MATCH (t:Topic) WHERE t.id = $id SET t.is_stale = $is_stale",
          { id: file.entity_id, is_stale: isStale },
        );
        if (isStale) staleCount++;
      } else if (file.kind === "decision") {
        const isStale = computeStale(
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
}

function computeStale(
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

function loadIfExists<T>(path: string, schema: z.ZodType<T>): T | null {
  if (!existsSync(path)) return null;
  try {
    return readSidecar(path, schema);
  } catch {
    return null;
  }
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
