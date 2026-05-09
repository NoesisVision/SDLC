import { Injectable } from "@nestjs/common";
import { existsSync } from "fs";
import { z } from "zod";
import {
  DecisionFileNewSchema,
  type DecisionFileNew,
} from "../../../../shared-contracts/source-file-schemas-new.js";
import {
  computeFileSha,
  decisionJsonPath,
  readSidecar,
  writeSidecar,
} from "../../../../shared-contracts/source-files.js";
import { DatabaseService } from "../../database/database.service.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS Decision(" +
    "id STRING, sha STRING, topic_id STRING, " +
    "title STRING, title_locked BOOLEAN DEFAULT false, " +
    "status STRING, status_locked BOOLEAN DEFAULT false, " +
    "is_stale BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
];

const StoredDecisionRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  topic_id: z.string(),
  title: z.string(),
  title_locked: z.boolean(),
  status: z.string(),
  status_locked: z.boolean(),
  is_stale: z.boolean(),
});
type StoredDecisionRow = z.infer<typeof StoredDecisionRowSchema>;

const StaleRowSchema = z.object({ is_stale: z.boolean() });
const PathRowSchema = z.object({ id: z.string(), sha: z.string() });

export interface StoredDecision {
  id: string;
  sha: string;
  topic_id: string;
  title: string;
  title_locked: boolean;
  status: string;
  status_locked: boolean;
  is_stale: boolean;
}

@Injectable()
export class DecisionsRepositoryNew {
  constructor(private readonly db: DatabaseService) {}

  canonicalPath(projectDir: string, decisionId: string): string {
    return decisionJsonPath(projectDir, decisionId);
  }

  async delete(decisionId: string): Promise<void> {
    await this.db.query(
      "MATCH (d:Decision) WHERE d.id = $id DETACH DELETE d",
      { id: decisionId },
    );
  }

  async exists(decisionId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      "MATCH (d:Decision) WHERE d.id = $id RETURN d.id AS id LIMIT 1",
      { id: decisionId },
    );
    return rows.length > 0;
  }

  fileExists(absPath: string): boolean {
    return existsSync(absPath);
  }

  fileSha(absPath: string): string {
    return computeFileSha(absPath);
  }

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
  }

  async listAll(): Promise<StoredDecision[]> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Decision) RETURN " +
        "d.id AS id, d.sha AS sha, d.topic_id AS topic_id, " +
        "d.title AS title, d.title_locked AS title_locked, " +
        "d.status AS status, d.status_locked AS status_locked, " +
        "d.is_stale AS is_stale ORDER BY d.id",
    );
    return z.array(StoredDecisionRowSchema).parse(rows).map(toStoredDecision);
  }

  async listAllStoredFiles(
    projectDir: string,
  ): Promise<Array<{ id: string; path: string; sha: string }>> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Decision) RETURN d.id AS id, d.sha AS sha",
    );
    return z.array(PathRowSchema).parse(rows).map((r) => ({
      id: r.id,
      sha: r.sha,
      path: decisionJsonPath(projectDir, r.id),
    }));
  }

  async read(decisionId: string): Promise<StoredDecision | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Decision) WHERE d.id = $id RETURN " +
        "d.id AS id, d.sha AS sha, d.topic_id AS topic_id, " +
        "d.title AS title, d.title_locked AS title_locked, " +
        "d.status AS status, d.status_locked AS status_locked, " +
        "d.is_stale AS is_stale LIMIT 1",
      { id: decisionId },
    );
    if (rows.length === 0) return null;
    return toStoredDecision(StoredDecisionRowSchema.parse(rows[0]));
  }

  readFile(absPath: string): DecisionFileNew {
    return readSidecar(absPath, DecisionFileNewSchema);
  }

  async readStaleFlag(decisionId: string): Promise<boolean | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Decision) WHERE d.id = $id RETURN d.is_stale AS is_stale LIMIT 1",
      { id: decisionId },
    );
    if (rows.length === 0) return null;
    return StaleRowSchema.parse(rows[0]).is_stale;
  }

  async upsert(file: DecisionFileNew, sha: string): Promise<void> {
    await this.db.query(
      "MERGE (d:Decision {id: $id}) SET " +
        "d.sha = $sha, d.topic_id = $topic_id, " +
        "d.title = $title, d.title_locked = $title_locked, " +
        "d.status = $status, d.status_locked = $status_locked, " +
        "d.is_stale = $is_stale",
      {
        id: file.id,
        sha,
        topic_id: file.topic_id,
        title: file.title,
        title_locked: file.title_locked,
        status: file.status,
        status_locked: file.status_locked,
        is_stale: file.is_stale,
      },
    );
  }

  writeFile(absPath: string, file: DecisionFileNew): void {
    writeSidecar(absPath, file, DecisionFileNewSchema);
  }

  async writeStaleFlag(decisionId: string, isStale: boolean): Promise<void> {
    await this.db.query(
      "MATCH (d:Decision) WHERE d.id = $id SET d.is_stale = $is_stale",
      { id: decisionId, is_stale: isStale },
    );
  }
}

function toStoredDecision(row: StoredDecisionRow): StoredDecision {
  return {
    id: row.id,
    sha: row.sha,
    topic_id: row.topic_id,
    title: row.title,
    title_locked: row.title_locked,
    status: row.status,
    status_locked: row.status_locked,
    is_stale: row.is_stale,
  };
}
