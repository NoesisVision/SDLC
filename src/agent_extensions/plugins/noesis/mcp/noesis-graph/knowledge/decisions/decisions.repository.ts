import { Injectable } from "@nestjs/common";
import { existsSync, unlinkSync } from "fs";
import { z } from "zod";
import {
  DecisionFileNewSchema,
  type DecisionFileNew,
  type DecisionContextNew,
  type DecisionOptionNew,
} from "../../../../shared-contracts/source-file-schemas.js";
import type { SourceContentRef } from "../../../../shared-contracts/source-content.js";
import {
  computeFileSha,
  decisionJsonPath,
  findDecisionJsonById,
  readSourceFile,
  writeSourceFile,
} from "../../../../shared-contracts/source-files.js";
import { DatabaseService, type QueryParams } from "../../database/database.service.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS Decision(" +
    "id STRING, sha STRING, " +
    "title STRING, title_locked BOOLEAN DEFAULT false, " +
    "status STRING, status_locked BOOLEAN DEFAULT false, " +
    "is_stale BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DecisionContext(" +
    "id STRING, text STRING, text_locked BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DecisionOption(" +
    "id STRING, option_index INT64, " +
    "text STRING, text_locked BOOLEAN DEFAULT false, " +
    "rationale STRING, rationale_locked BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS DECISION_BELONGS_TO_TOPIC(FROM Decision TO Topic)",
  "CREATE REL TABLE IF NOT EXISTS DECISION_HAS_CONTEXT(FROM Decision TO DecisionContext)",
  "CREATE REL TABLE IF NOT EXISTS DECISION_HAS_CHOSEN_OPTION(FROM Decision TO DecisionOption)",
  "CREATE REL TABLE IF NOT EXISTS DECISION_HAS_ALTERNATIVE_OPTION(FROM Decision TO DecisionOption)",
  "CREATE REL TABLE IF NOT EXISTS DECISION_CONTEXT_IS_DEFINED_BY_IDEA_UNIT(" +
    "FROM DecisionContext TO IdeaUnit, source_sha STRING DEFAULT '')",
  "CREATE REL TABLE IF NOT EXISTS DECISION_CONTEXT_IS_DEFINED_BY_DOCUMENT_FRAGMENT(" +
    "FROM DecisionContext TO DocumentFragment, source_sha STRING DEFAULT '')",
  "CREATE REL TABLE IF NOT EXISTS DECISION_OPTION_IS_DEFINED_BY_IDEA_UNIT(" +
    "FROM DecisionOption TO IdeaUnit, source_sha STRING DEFAULT '')",
  "CREATE REL TABLE IF NOT EXISTS DECISION_OPTION_IS_DEFINED_BY_DOCUMENT_FRAGMENT(" +
    "FROM DecisionOption TO DocumentFragment, source_sha STRING DEFAULT '')",
];

const STORED_PROJECTION =
  "d.id AS id, d.sha AS sha, topic.id AS topic_id, " +
  "d.title AS title, d.title_locked AS title_locked, " +
  "d.status AS status, d.status_locked AS status_locked, " +
  "d.is_stale AS is_stale";

const StoredDecisionRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  topic_id: z.string().nullable(),
  title: z.string(),
  title_locked: z.boolean(),
  status: z.string(),
  status_locked: z.boolean(),
  is_stale: z.boolean(),
});
type StoredDecisionRow = z.infer<typeof StoredDecisionRowSchema>;

const StaleRowSchema = z.object({ is_stale: z.boolean() });
const PathRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  title: z.string(),
});

export interface StoredDecision {
  id: string;
  sha: string;
  topic_id: string | null;
  title: string;
  title_locked: boolean;
  status: string;
  status_locked: boolean;
  is_stale: boolean;
}

@Injectable()
export class DecisionsRepository {
  constructor(private readonly db: DatabaseService) {}

  canonicalPath(projectDir: string, decisionId: string, title: string): string {
    return decisionJsonPath(projectDir, decisionId, title);
  }

  async delete(decisionId: string): Promise<void> {
    await this.deleteChildren(decisionId);
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

  deleteFile(absPath: string): void {
    if (existsSync(absPath)) unlinkSync(absPath);
  }

  fileExists(absPath: string): boolean {
    return existsSync(absPath);
  }

  fileSha(absPath: string): string {
    return computeFileSha(absPath);
  }

  findFileById(projectDir: string, decisionId: string): string | null {
    return findDecisionJsonById(projectDir, decisionId);
  }

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
  }

  async listAll(): Promise<StoredDecision[]> {
    return this.queryStored(
      "MATCH (d:Decision) " +
        "OPTIONAL MATCH (d)-[:DECISION_BELONGS_TO_TOPIC]->(topic:Topic) " +
        "RETURN " + STORED_PROJECTION + " ORDER BY d.id",
    );
  }

  async listByTopicId(topicId: string): Promise<StoredDecision[]> {
    return this.queryStored(
      "MATCH (d:Decision)-[:DECISION_BELONGS_TO_TOPIC]->(topic:Topic) " +
        "WHERE topic.id = $topicId " +
        `RETURN ${STORED_PROJECTION} ORDER BY d.title`,
      { topicId },
    );
  }

  async listAllStoredFiles(
    projectDir: string,
  ): Promise<Array<{ id: string; path: string; sha: string }>> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:Decision) RETURN d.id AS id, d.sha AS sha, d.title AS title",
    );
    return z.array(PathRowSchema).parse(rows).map((r) => ({
      id: r.id,
      sha: r.sha,
      path: decisionJsonPath(projectDir, r.id, r.title),
    }));
  }

  async read(decisionId: string): Promise<StoredDecision | null> {
    const rows = await this.queryStored(
      "MATCH (d:Decision) WHERE d.id = $id " +
        "OPTIONAL MATCH (d)-[:DECISION_BELONGS_TO_TOPIC]->(topic:Topic) " +
        `RETURN ${STORED_PROJECTION} LIMIT 1`,
      { id: decisionId },
    );
    return rows[0] ?? null;
  }

  readFile(absPath: string): DecisionFileNew {
    return readSourceFile(absPath, DecisionFileNewSchema);
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
        "d.sha = $sha, " +
        "d.title = $title, d.title_locked = $title_locked, " +
        "d.status = $status, d.status_locked = $status_locked, " +
        "d.is_stale = $is_stale",
      {
        id: file.id,
        sha,
        title: file.title,
        title_locked: file.title_locked,
        status: file.status,
        status_locked: file.status_locked,
        is_stale: file.is_stale,
      },
    );
    await this.db.query(
      "MATCH (d:Decision)-[r:DECISION_BELONGS_TO_TOPIC]->(:Topic) WHERE d.id = $id DELETE r",
      { id: file.id },
    );
    await this.db.query(
      "MATCH (d:Decision), (topic:Topic) WHERE d.id = $id AND topic.id = $topicId " +
        "CREATE (d)-[:DECISION_BELONGS_TO_TOPIC]->(topic)",
      { id: file.id, topicId: file.topic_id },
    );
    await this.deleteChildren(file.id);
    await this.createContext(file);
    await this.createChosenOption(file);
    await this.createAlternativeOptions(file);
  }

  writeFile(absPath: string, file: DecisionFileNew): void {
    writeSourceFile(absPath, file, DecisionFileNewSchema);
  }

  async writeStaleFlag(decisionId: string, isStale: boolean): Promise<void> {
    await this.db.query(
      "MATCH (d:Decision) WHERE d.id = $id SET d.is_stale = $is_stale",
      { id: decisionId, is_stale: isStale },
    );
  }

  private async createContext(file: DecisionFileNew): Promise<void> {
    const contextId = `${file.id}|context`;
    await this.db.query(
      "CREATE (c:DecisionContext {id: $id, text: $text, text_locked: $text_locked})",
      {
        id: contextId,
        text: file.context.text,
        text_locked: file.context.text_locked,
      },
    );
    await this.db.query(
      "MATCH (d:Decision), (c:DecisionContext) WHERE d.id = $did AND c.id = $cid " +
        "CREATE (d)-[:DECISION_HAS_CONTEXT]->(c)",
      { did: file.id, cid: contextId },
    );
    await this.linkSlotItems(contextId, "DecisionContext", file.context);
  }

  private async createChosenOption(file: DecisionFileNew): Promise<void> {
    const optionId = `${file.id}|chosen`;
    await this.db.query(
      "CREATE (o:DecisionOption {id: $id, option_index: NULL, " +
        "text: $text, text_locked: $text_locked, " +
        "rationale: $rationale, rationale_locked: $rationale_locked})",
      {
        id: optionId,
        text: file.decision.text,
        text_locked: file.decision.text_locked,
        rationale: file.decision.rationale,
        rationale_locked: file.decision.rationale_locked,
      },
    );
    await this.db.query(
      "MATCH (d:Decision), (o:DecisionOption) WHERE d.id = $did AND o.id = $oid " +
        "CREATE (d)-[:DECISION_HAS_CHOSEN_OPTION]->(o)",
      { did: file.id, oid: optionId },
    );
    await this.linkSlotItems(optionId, "DecisionOption", file.decision);
  }

  private async createAlternativeOptions(file: DecisionFileNew): Promise<void> {
    for (let i = 0; i < file.alternative_options.length; i++) {
      const option = file.alternative_options[i];
      const optionId = `${file.id}|alt:${i}`;
      await this.db.query(
        "CREATE (o:DecisionOption {id: $id, option_index: $option_index, " +
          "text: $text, text_locked: $text_locked, " +
          "rationale: $rationale, rationale_locked: $rationale_locked})",
        {
          id: optionId,
          option_index: i,
          text: option.text,
          text_locked: option.text_locked,
          rationale: option.rationale,
          rationale_locked: option.rationale_locked,
        },
      );
      await this.db.query(
        "MATCH (d:Decision), (o:DecisionOption) WHERE d.id = $did AND o.id = $oid " +
          "CREATE (d)-[:DECISION_HAS_ALTERNATIVE_OPTION]->(o)",
        { did: file.id, oid: optionId },
      );
      await this.linkSlotItems(optionId, "DecisionOption", option);
    }
  }

  private async deleteChildren(decisionId: string): Promise<void> {
    await this.db.query(
      "MATCH (d:Decision)-[:DECISION_HAS_CONTEXT]->(c:DecisionContext) WHERE d.id = $id DETACH DELETE c",
      { id: decisionId },
    );
    await this.db.query(
      "MATCH (d:Decision)-[:DECISION_HAS_CHOSEN_OPTION]->(o:DecisionOption) WHERE d.id = $id DETACH DELETE o",
      { id: decisionId },
    );
    await this.db.query(
      "MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE_OPTION]->(o:DecisionOption) WHERE d.id = $id DETACH DELETE o",
      { id: decisionId },
    );
  }

  private async linkSlotItems(
    slotId: string,
    slotLabel: "DecisionContext" | "DecisionOption",
    slot: DecisionContextNew | DecisionOptionNew,
  ): Promise<void> {
    const ideaUnitRel =
      slotLabel === "DecisionContext"
        ? "DECISION_CONTEXT_IS_DEFINED_BY_IDEA_UNIT"
        : "DECISION_OPTION_IS_DEFINED_BY_IDEA_UNIT";
    const fragmentRel =
      slotLabel === "DecisionContext"
        ? "DECISION_CONTEXT_IS_DEFINED_BY_DOCUMENT_FRAGMENT"
        : "DECISION_OPTION_IS_DEFINED_BY_DOCUMENT_FRAGMENT";
    for (const item of slot.supporting_content) {
      await this.linkSourceContent(slotId, slotLabel, ideaUnitRel, fragmentRel, item);
    }
  }

  private async linkSourceContent(
    slotId: string,
    slotLabel: "DecisionContext" | "DecisionOption",
    ideaUnitRel: string,
    fragmentRel: string,
    item: SourceContentRef,
  ): Promise<void> {
    const sourceSha = item.source_sha ?? "";
    if (item.type === "idea_unit_ref") {
      const ideaUnitId = `${item.conversation_id}|T${item.turn_index}|IU${item.idea_unit_index}`;
      await this.db.query(
        `MATCH (s:${slotLabel}), (u:IdeaUnit) WHERE s.id = $sid AND u.id = $uid ` +
          `CREATE (s)-[:${ideaUnitRel} {source_sha: $sha}]->(u)`,
        { sid: slotId, uid: ideaUnitId, sha: sourceSha },
      );
    } else {
      const fragmentId = `${item.document_id}|F${item.start_offset}-${item.end_offset}`;
      await this.db.query(
        `MATCH (s:${slotLabel}), (f:DocumentFragment) WHERE s.id = $sid AND f.id = $fid ` +
          `CREATE (s)-[:${fragmentRel} {source_sha: $sha}]->(f)`,
        { sid: slotId, fid: fragmentId, sha: sourceSha },
      );
    }
  }

  private async queryStored(
    cypher: string,
    params: QueryParams = {},
  ): Promise<StoredDecision[]> {
    const rows = await this.db.query<unknown>(cypher, params);
    return z.array(StoredDecisionRowSchema).parse(rows).map(toStoredDecision);
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
