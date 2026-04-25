import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../../database/database.service.js";
import type { Document } from "../../../../shared-contracts/documents.js";
import { documentFragmentNodeId } from "./node-ids.js";

const IdRowSchema = z.object({ id: z.string() });
type IdRow = z.infer<typeof IdRowSchema>;

const DocumentFragmentJoinRowSchema = z.object({
  document_id: z.string(),
  document_title: z.string(),
  document_content: z.string(),
  start_offset: z.union([z.number(), z.bigint()]),
  end_offset: z.union([z.number(), z.bigint()]),
});
type DocumentFragmentJoinRow = z.infer<typeof DocumentFragmentJoinRowSchema>;

const DocumentRefRowSchema = z.object({
  document_id: z.string(),
  title: z.string(),
  date: z.string(),
});
type DocumentRefRow = z.infer<typeof DocumentRefRowSchema>;

const DocumentFragmentRowSchema = z.object({
  start_offset: z.union([z.number(), z.bigint()]),
  end_offset: z.union([z.number(), z.bigint()]),
  document_content: z.string(),
});
type DocumentFragmentRow = z.infer<typeof DocumentFragmentRowSchema>;

export interface DocumentFragmentDetail {
  document_id: string;
  document_title: string;
  start_offset: number;
  end_offset: number;
  text: string;
  section_path: string[];
}

export interface DocumentRef {
  document_id: string;
  title: string;
  date: string;
}

export interface TopicDocumentFragment {
  start_offset: number;
  end_offset: number;
  text: string;
}

@Injectable()
export class DocumentsRepository {
  constructor(private readonly db: DatabaseService) {}

  async ensureFragmentNode(
    documentId: string,
    startOffset: number,
    endOffset: number,
  ): Promise<string> {
    await this.requireDocument(documentId);
    const fragId = documentFragmentNodeId(documentId, startOffset, endOffset);
    if (await this.fragmentExists(fragId)) {
      return fragId;
    }
    await this.db.query(
      "CREATE (f:DocumentFragment {id: $id, document_id: $document_id, start_offset: $start_offset, end_offset: $end_offset})",
      {
        id: fragId,
        document_id: documentId,
        start_offset: startOffset,
        end_offset: endOffset,
      },
    );
    await this.db.query(
      "MATCH (d:Document), (f:DocumentFragment) WHERE d.id = $documentId AND f.id = $fragId CREATE (d)-[:DOCUMENT_HAS_FRAGMENT]->(f)",
      { documentId, fragId },
    );
    return fragId;
  }

  async ensureNotExists(documentId: string): Promise<void> {
    if (await this.exists(documentId)) {
      throw new Error(`Document already exists: ${documentId}`);
    }
  }

  async exists(documentId: string): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      "MATCH (d:Document) WHERE d.id = $id RETURN d.id AS id LIMIT 1",
      { id: documentId },
    );
    return rows.length > 0;
  }

  async getPriorDocumentFragments(
    topicId: string,
    excludeDocumentId: string,
  ): Promise<DocumentFragmentDetail[]> {
    const rawRows = await this.db.query<DocumentFragmentJoinRow>(
      "MATCH (t:Topic)-[:TOPIC_HAS_DOCUMENT_FRAGMENT]->(f:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(d:Document) " +
        "WHERE t.id = $topicId AND d.id <> $excludeDocumentId " +
        "RETURN d.id AS document_id, d.title AS document_title, d.content AS document_content, " +
        "f.start_offset AS start_offset, f.end_offset AS end_offset " +
        "ORDER BY d.id, f.start_offset",
      { topicId, excludeDocumentId },
    );
    const rows = z.array(DocumentFragmentJoinRowSchema).parse(rawRows);
    return rows.map((r) => {
      const start = Number(r.start_offset);
      const end = Number(r.end_offset);
      return {
        document_id: r.document_id,
        document_title: r.document_title,
        start_offset: start,
        end_offset: end,
        text: r.document_content.slice(start, end).trim(),
        section_path: [],
      };
    });
  }

  async listDocumentsForTopic(topicId: string): Promise<DocumentRef[]> {
    const rawRows = await this.db.query<DocumentRefRow>(
      "MATCH (t:Topic)-[:TOPIC_HAS_DOCUMENT_FRAGMENT]->(:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(d:Document) " +
        "WHERE t.id = $topicId " +
        "RETURN DISTINCT d.id AS document_id, d.title AS title, d.date AS date " +
        "ORDER BY d.date DESC",
      { topicId },
    );
    return z.array(DocumentRefRowSchema).parse(rawRows);
  }

  async listFragmentsForTopicAndDocument(
    topicId: string,
    documentId: string,
  ): Promise<TopicDocumentFragment[]> {
    const rawRows = await this.db.query<DocumentFragmentRow>(
      "MATCH (t:Topic)-[:TOPIC_HAS_DOCUMENT_FRAGMENT]->(f:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(d:Document) " +
        "WHERE t.id = $topicId AND d.id = $documentId " +
        "RETURN f.start_offset AS start_offset, f.end_offset AS end_offset, d.content AS document_content " +
        "ORDER BY f.start_offset",
      { topicId, documentId },
    );
    const rows = z.array(DocumentFragmentRowSchema).parse(rawRows);
    return rows.map((r) => {
      const start = Number(r.start_offset);
      const end = Number(r.end_offset);
      return {
        start_offset: start,
        end_offset: end,
        text: r.document_content.slice(start, end),
      };
    });
  }

  async insertDocument(document: Document): Promise<void> {
    await this.ensureNotExists(document.id);
    await this.db.query(
      "CREATE (d:Document {id: $id, title: $title, date: $date, content: $content})",
      {
        id: document.id,
        title: document.title,
        date: document.date,
        content: document.content,
      },
    );
  }

  async requireDocument(documentId: string): Promise<void> {
    if (!(await this.exists(documentId))) {
      throw new Error(`Document not found: ${documentId}`);
    }
  }

  private async fragmentExists(fragId: string): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      "MATCH (f:DocumentFragment) WHERE f.id = $id RETURN f.id AS id LIMIT 1",
      { id: fragId },
    );
    return rows.length > 0;
  }
}
