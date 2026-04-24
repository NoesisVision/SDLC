import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import type { Invocation } from "./invocation-graph.js";

const SCHEMA_STATEMENTS = [
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOR_INVOKES_BEHAVIOR(FROM Behavior TO Behavior)",
];

@Injectable()
export class InvocationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async clearInvocations(): Promise<void> {
    const conn = this.db.getConnection();
    await conn.query("MATCH ()-[r:BEHAVIOR_INVOKES_BEHAVIOR]->() DELETE r");
  }

  async getInvocations(filter?: {
    sourceBehaviorId?: string;
    destinationBehaviorId?: string;
  }): Promise<Invocation[]> {
    if (filter?.sourceBehaviorId && filter?.destinationBehaviorId) {
      throw new Error(
        "Pass at most one of sourceBehaviorId or destinationBehaviorId",
      );
    }

    const conn = this.db.getConnection();
    const where =
      filter?.sourceBehaviorId !== undefined
        ? "WHERE s.id = $id"
        : filter?.destinationBehaviorId !== undefined
        ? "WHERE d.id = $id"
        : "";
    const params: Record<string, string> = {};
    if (filter?.sourceBehaviorId !== undefined) {
      params["id"] = filter.sourceBehaviorId;
    } else if (filter?.destinationBehaviorId !== undefined) {
      params["id"] = filter.destinationBehaviorId;
    }

    const stmt = await conn.prepare(
      `MATCH (s:Behavior)-[:BEHAVIOR_INVOKES_BEHAVIOR]->(d:Behavior) ${where} ` +
        "RETURN s.id AS source, d.id AS destination ORDER BY s.id, d.id",
    );
    const result = await conn.execute(stmt, params);
    const rows = asArray(result).getAllSync() as Invocation[];
    return rows;
  }

  async initSchema(): Promise<void> {
    const conn = this.db.getConnection();
    for (const stmt of SCHEMA_STATEMENTS) {
      await conn.query(stmt);
    }
  }

  async insertInvocation(invocation: Invocation): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (s:Behavior), (d:Behavior) WHERE s.id = $sourceId AND d.id = $destinationId " +
        "CREATE (s)-[:BEHAVIOR_INVOKES_BEHAVIOR]->(d)",
    );
    await conn.execute(stmt, {
      sourceId: invocation.source,
      destinationId: invocation.destination,
    });
  }
}

function asArray(result: unknown): { getAllSync(): unknown[] } {
  if (Array.isArray(result)) return result[0];
  return result as { getAllSync(): unknown[] };
}
