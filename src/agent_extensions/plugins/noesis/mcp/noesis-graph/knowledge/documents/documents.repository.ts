import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  DocumentFileNewSchema,
  type DocumentFileNew,
} from "../../../../shared-contracts/source-file-schemas.js";
import {
  computeFileSha,
  documentJsonPath,
  readSidecar,
  writeSidecar,
} from "../../../../shared-contracts/source-files.js";
import { DatabaseService } from "../../database/database.service.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS Document(" +
    "id STRING, sha STRING, title STRING, date STRING, content STRING, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DocumentFragment(" +
    "id STRING, start_offset INT64, end_offset INT64, " +
    "kind STRING, text STRING, " +
    "PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS DOCUMENT_HAS_FRAGMENT(FROM Document TO DocumentFragment)",
];

const PathRowSchema = z.object({ id: z.string(), sha: z.string() });
const StoredDocumentRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  title: z.string(),
  date: z.string(),
});

const ContentRowSchema = z.object({ content: z.string() });

export interface StoredDocument {
  id: string;
  sha: string;
  title: string;
  date: string;
}

@Injectable()
export class DocumentsRepository {
  constructor(private readonly db: DatabaseService) {}

  canonicalPath(projectDir: string, documentId: string): string {
    return documentJsonPath(projectDir, documentId);
  }

  async delete(documentId: string): Promise<void> {
    await this.deleteFragments(documentId);
    await this.db.query(
      "MATCH (d:Document) WHERE d.id = $id DETACH DELETE d",
      { id: documentId },
    );
  }

  async exists(documentId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      "MATCH (d:Document) WHERE d.id = $id RETURN d.id AS id LIMIT 1",
      { id: documentId },
    );
    return rows.length > 0;
  }

  fileSha(absPath: string): string {
    return computeFileSha(absPath);
  }

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
  }

  async listAll(): Promise<StoredDocument[]> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Document) RETURN d.id AS id, d.sha AS sha, d.title AS title, d.date AS date " +
        "ORDER BY d.id",
    );
    return z.array(StoredDocumentRowSchema).parse(rows);
  }

  async listByIds(ids: string[]): Promise<StoredDocument[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.query<unknown>(
      "MATCH (d:Document) WHERE d.id IN $ids " +
        "RETURN d.id AS id, d.sha AS sha, d.title AS title, d.date AS date " +
        "ORDER BY d.date",
      { ids },
    );
    return z.array(StoredDocumentRowSchema).parse(rows);
  }

  async readContent(documentId: string): Promise<string | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Document) WHERE d.id = $id RETURN d.content AS content LIMIT 1",
      { id: documentId },
    );
    if (rows.length === 0) return null;
    return ContentRowSchema.parse(rows[0]).content;
  }

  async listAllStoredFiles(
    projectDir: string,
  ): Promise<Array<{ id: string; path: string; sha: string }>> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Document) RETURN d.id AS id, d.sha AS sha",
    );
    return z.array(PathRowSchema).parse(rows).map((r) => ({
      id: r.id,
      sha: r.sha,
      path: documentJsonPath(projectDir, r.id),
    }));
  }

  async read(documentId: string): Promise<StoredDocument | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Document) WHERE d.id = $id RETURN " +
        "d.id AS id, d.sha AS sha, d.title AS title, d.date AS date LIMIT 1",
      { id: documentId },
    );
    if (rows.length === 0) return null;
    return StoredDocumentRowSchema.parse(rows[0]);
  }

  readFile(absPath: string): DocumentFileNew {
    return readSidecar(absPath, DocumentFileNewSchema);
  }

  async upsert(file: DocumentFileNew, sha: string): Promise<void> {
    await this.db.query(
      "MERGE (d:Document {id: $id}) SET " +
        "d.sha = $sha, d.title = $title, d.date = $date, d.content = $content",
      {
        id: file.document_id,
        sha,
        title: file.title,
        date: file.date,
        content: file.content,
      },
    );
    await this.replaceFragments(file.document_id, file.fragments);
  }

  writeFile(absPath: string, file: DocumentFileNew): void {
    writeSidecar(absPath, file, DocumentFileNewSchema);
  }

  private async replaceFragments(
    documentId: string,
    fragments: DocumentFileNew["fragments"],
  ): Promise<void> {
    await this.deleteFragments(documentId);
    for (const frag of fragments) {
      const fragId = `${documentId}|F${frag.start_offset}-${frag.end_offset}`;
      await this.db.query(
        "CREATE (f:DocumentFragment {id: $id, start_offset: $startOffset, end_offset: $endOffset, kind: $kind, text: $text})",
        {
          id: fragId,
          startOffset: frag.start_offset,
          endOffset: frag.end_offset,
          kind: frag.kind,
          text: frag.text,
        },
      );
      await this.db.query(
        "MATCH (d:Document), (f:DocumentFragment) WHERE d.id = $did AND f.id = $fid CREATE (d)-[:DOCUMENT_HAS_FRAGMENT]->(f)",
        { did: documentId, fid: fragId },
      );
    }
  }

  private async deleteFragments(documentId: string): Promise<void> {
    await this.db.query(
      "MATCH (d:Document)-[:DOCUMENT_HAS_FRAGMENT]->(f:DocumentFragment) " +
        "WHERE d.id = $did DETACH DELETE f",
      { did: documentId },
    );
  }
}
