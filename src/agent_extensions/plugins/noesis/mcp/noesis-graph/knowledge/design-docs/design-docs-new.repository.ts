import { Injectable } from "@nestjs/common";
import { existsSync, unlinkSync } from "fs";
import { z } from "zod";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
} from "../../../../shared-contracts/design-doc-new.js";
import {
  computeFileSha,
  designDocCanonicalPath,
  findDesignDocFileById,
  readSidecar,
  writeSidecar,
} from "../../../../shared-contracts/source-files.js";
import { DatabaseService } from "../../database/database.service.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS DesignDoc(" +
    "id STRING, sha STRING, name STRING, name_locked BOOLEAN DEFAULT false, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "implemented BOOLEAN DEFAULT false, source_path STRING, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Actor(" +
    "name STRING, description STRING, description_locked BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(name))",
  "CREATE REL TABLE IF NOT EXISTS DESIGNDOC_HAS_ACTOR(FROM DesignDoc TO Actor)",
];

const PathRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  source_path: z.string(),
});
const StoredDesignDocRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  name: z.string(),
  name_locked: z.boolean(),
  description: z.string(),
  description_locked: z.boolean(),
  implemented: z.boolean(),
  source_path: z.string(),
});

const ImplementedRowSchema = z.object({
  implemented: z.boolean().nullable().optional(),
});

const ActorRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  description_locked: z.boolean(),
});

export interface StoredDesignDoc {
  id: string;
  sha: string;
  name: string;
  name_locked: boolean;
  description: string;
  description_locked: boolean;
  implemented: boolean;
  source_path: string;
}

export interface StoredActor {
  name: string;
  description: string;
  description_locked: boolean;
}

@Injectable()
export class DesignDocsRepositoryNew {
  constructor(private readonly db: DatabaseService) {}

  canonicalPath(projectDir: string, id: string, name: string): string {
    return designDocCanonicalPath(projectDir, id, name);
  }

  async delete(designDocId: string): Promise<void> {
    await this.db.query(
      "MATCH (d:DesignDoc)-[r:DESIGNDOC_HAS_ACTOR]->(:Actor) WHERE d.id = $id DELETE r",
      { id: designDocId },
    );
    await this.db.query(
      "MATCH (d:DesignDoc) WHERE d.id = $id DETACH DELETE d",
      { id: designDocId },
    );
    await this.pruneOrphanActors();
  }

  deleteFile(absPath: string): void {
    if (existsSync(absPath)) unlinkSync(absPath);
  }

  async exists(designDocId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      "MATCH (d:DesignDoc) WHERE d.id = $id RETURN d.id AS id LIMIT 1",
      { id: designDocId },
    );
    return rows.length > 0;
  }

  fileSha(absPath: string): string {
    return computeFileSha(absPath);
  }

  findFileById(projectDir: string, id: string): string | null {
    return findDesignDocFileById(projectDir, id);
  }

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
  }

  async listActors(): Promise<StoredActor[]> {
    const rows = await this.db.query<unknown>(
      "MATCH (a:Actor) RETURN a.name AS name, a.description AS description, " +
        "a.description_locked AS description_locked ORDER BY a.name",
    );
    return z.array(ActorRowSchema).parse(rows);
  }

  async listAll(): Promise<StoredDesignDoc[]> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc) RETURN " +
        "d.id AS id, d.sha AS sha, d.name AS name, d.name_locked AS name_locked, " +
        "d.description AS description, d.description_locked AS description_locked, " +
        "d.implemented AS implemented, d.source_path AS source_path " +
        "ORDER BY d.id",
    );
    return z.array(StoredDesignDocRowSchema).parse(rows);
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    const rows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc) RETURN d.id AS id, d.sha AS sha, d.source_path AS source_path",
    );
    return z.array(PathRowSchema).parse(rows).map((r) => ({
      id: r.id,
      sha: r.sha,
      path: r.source_path,
    }));
  }

  async read(designDocId: string): Promise<StoredDesignDoc | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc) WHERE d.id = $id RETURN " +
        "d.id AS id, d.sha AS sha, d.name AS name, d.name_locked AS name_locked, " +
        "d.description AS description, d.description_locked AS description_locked, " +
        "d.implemented AS implemented, d.source_path AS source_path LIMIT 1",
      { id: designDocId },
    );
    if (rows.length === 0) return null;
    return StoredDesignDocRowSchema.parse(rows[0]);
  }

  readFile(absPath: string): DesignDocFileNew {
    return readSidecar(absPath, DesignDocFileNewSchema);
  }

  async readImplementedFlag(designDocId: string): Promise<boolean | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc) WHERE d.id = $id RETURN d.implemented AS implemented LIMIT 1",
      { id: designDocId },
    );
    if (rows.length === 0) return null;
    return ImplementedRowSchema.parse(rows[0]).implemented ?? false;
  }

  async upsert(
    file: DesignDocFileNew,
    sha: string,
    sourcePath: string,
  ): Promise<void> {
    await this.db.query(
      "MERGE (d:DesignDoc {id: $id}) SET " +
        "d.sha = $sha, d.name = $name, d.name_locked = $name_locked, " +
        "d.description = $description, d.description_locked = $description_locked, " +
        "d.implemented = $implemented, d.source_path = $source_path",
      {
        id: file.id,
        sha,
        name: file.name,
        name_locked: file.name_locked,
        description: file.description,
        description_locked: file.description_locked,
        implemented: file.implemented,
        source_path: sourcePath,
      },
    );
    await this.db.query(
      "MATCH (d:DesignDoc)-[r:DESIGNDOC_HAS_ACTOR]->(:Actor) WHERE d.id = $id DELETE r",
      { id: file.id },
    );
    for (const actor of file.actors) {
      await this.db.query(
        "MERGE (a:Actor {name: $name}) SET " +
          "a.description = $description, a.description_locked = $description_locked",
        {
          name: actor.name,
          description: actor.description ?? "",
          description_locked: actor.description_locked,
        },
      );
      await this.db.query(
        "MATCH (d:DesignDoc), (a:Actor) WHERE d.id = $did AND a.name = $name " +
          "CREATE (d)-[:DESIGNDOC_HAS_ACTOR]->(a)",
        { did: file.id, name: actor.name },
      );
    }
    await this.pruneOrphanActors();
  }

  writeFile(absPath: string, file: DesignDocFileNew): void {
    writeSidecar(absPath, file, DesignDocFileNewSchema);
  }

  async writeImplementedFlag(
    designDocId: string,
    implemented: boolean,
  ): Promise<void> {
    await this.db.query(
      "MATCH (d:DesignDoc) WHERE d.id = $id SET d.implemented = $implemented",
      { id: designDocId, implemented },
    );
  }

  private async pruneOrphanActors(): Promise<void> {
    await this.db.query(
      "MATCH (a:Actor) WHERE NOT EXISTS { MATCH (:DesignDoc)-[:DESIGNDOC_HAS_ACTOR]->(a) } DETACH DELETE a",
    );
  }
}
