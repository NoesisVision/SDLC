import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../../database/database.service.js";
import type { Invocation } from "./invocation-graph.js";

const SCHEMA_STATEMENTS = [
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOR_INVOKES_BEHAVIOR(FROM Behavior TO Behavior)",
];

const InvocationRowSchema = z.object({
  source: z.string(),
  destination: z.string(),
});
type InvocationRow = z.infer<typeof InvocationRowSchema>;

@Injectable()
export class InvocationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async clearInvocations(): Promise<void> {
    await this.db.query("MATCH ()-[r:BEHAVIOR_INVOKES_BEHAVIOR]->() DELETE r");
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

    const rawRows = await this.db.query<InvocationRow>(
      `MATCH (s:Behavior)-[:BEHAVIOR_INVOKES_BEHAVIOR]->(d:Behavior) ${where} ` +
        "RETURN s.id AS source, d.id AS destination ORDER BY s.id, d.id",
      params,
    );
    return z.array(InvocationRowSchema).parse(rawRows);
  }

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
  }

  async insertInvocation(invocation: Invocation): Promise<void> {
    await this.db.query(
      "MATCH (s:Behavior), (d:Behavior) WHERE s.id = $sourceId AND d.id = $destinationId " +
        "CREATE (s)-[:BEHAVIOR_INVOKES_BEHAVIOR]->(d)",
      {
        sourceId: invocation.source,
        destinationId: invocation.destination,
      },
    );
  }
}
