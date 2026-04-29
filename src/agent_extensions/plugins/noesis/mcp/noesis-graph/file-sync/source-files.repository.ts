import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";

const SourceFileRowSchema = z.object({
  path: z.string(),
  kind: z.string(),
  entity_id: z.string(),
  sha: z.string(),
  indexed_at: z.string(),
});
export type SourceFileRow = z.infer<typeof SourceFileRowSchema>;

@Injectable()
export class SourceFilesRepository {
  constructor(private readonly db: DatabaseService) {}

  async listAll(): Promise<SourceFileRow[]> {
    const rows = await this.db.query<SourceFileRow>(
      "MATCH (s:SourceFile) RETURN s.path AS path, s.kind AS kind, s.entity_id AS entity_id, s.sha AS sha, s.indexed_at AS indexed_at",
    );
    return z.array(SourceFileRowSchema).parse(rows);
  }

  async get(path: string): Promise<SourceFileRow | null> {
    const rows = await this.db.query<SourceFileRow>(
      "MATCH (s:SourceFile) WHERE s.path = $path RETURN s.path AS path, s.kind AS kind, s.entity_id AS entity_id, s.sha AS sha, s.indexed_at AS indexed_at LIMIT 1",
      { path },
    );
    if (rows.length === 0) return null;
    return SourceFileRowSchema.parse(rows[0]);
  }

  async upsert(row: SourceFileRow): Promise<void> {
    await this.db.query(
      "MERGE (s:SourceFile {path: $path}) SET s.kind = $kind, s.entity_id = $entity_id, s.sha = $sha, s.indexed_at = $indexed_at",
      row,
    );
  }

  async remove(path: string): Promise<void> {
    await this.db.query(
      "MATCH (s:SourceFile) WHERE s.path = $path DELETE s",
      { path },
    );
  }
}
