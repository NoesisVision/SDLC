import "reflect-metadata";
import { describe, test, beforeAll, afterAll, expect } from "bun:test";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { and, given, then, when } from "@tests/bdd.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { DATA_DIR } from "@noesis/mcp/noesis-graph/config/config.module.js";
import { SchemaService } from "@noesis/mcp/noesis-graph/knowledge/schema/schema.service.js";

describe("SchemaService — knowledge graph schema bootstrap and inspection", () => {
  let module: TestingModule;
  let db: DatabaseService;
  let schema: SchemaService;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-schema-test-"));
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        SchemaService,
        { provide: DATA_DIR, useValue: tmpDir },
      ],
    }).compile();
    await module.init();
    db = module.get(DatabaseService);
    schema = module.get(SchemaService);
  });

  afterAll(async () => {
    await module.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("module init creates the entire knowledge graph node and rel catalogue", async () => {
    let schemaSnapshot: Awaited<ReturnType<SchemaService["getSchema"]>>;

    await given(
      "a freshly bootstrapped SchemaService backed by an empty database",
      async () => {
        // beforeAll has already run module.init which fires SchemaService.onModuleInit
        // verify the underlying database is reachable
        const rows = await db.query<{ x: number | bigint }>("RETURN 1 AS x");
        expect(rows.map((r) => Number(r.x))).toEqual([1]);
      },
    );
    await when("the consumer asks the service for the current schema", async () => {
      schemaSnapshot = await schema.getSchema();
    });
    await then(
      "every node table required by the knowledge model is present",
      () => {
        const nodeTableNames = schemaSnapshot.nodeTables
          .map((t) => t.name)
          .sort();
        expect(nodeTableNames).toEqual(
          [
            "AlternativeOption",
            "Conversation",
            "Decision",
            "Document",
            "DocumentFragment",
            "IdeaUnit",
            "SourceFile",
            "Topic",
            "Turn",
          ].sort(),
        );
      },
    );
    await and(
      "every relationship table required by the knowledge model is present",
      () => {
        const relTableNames = schemaSnapshot.relTables
          .map((t) => t.name)
          .sort();
        expect(relTableNames).toEqual(
          [
            "ALTERNATIVE_SUPPORTED_BY_DOC_FRAGMENT",
            "ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT",
            "CONTEXT_SUPPORTED_BY_DOC_FRAGMENT",
            "CONTEXT_SUPPORTED_BY_IDEA_UNIT",
            "CONVERSATION_HAS_TURN",
            "DECISION_HAS_ALTERNATIVE",
            "DECISION_SUPPORTED_BY_DOC_FRAGMENT",
            "DECISION_SUPPORTED_BY_IDEA_UNIT",
            "DOCUMENT_HAS_FRAGMENT",
            "TOPIC_HAS_DECISION",
            "TOPIC_HAS_DOCUMENT_FRAGMENT",
            "TOPIC_HAS_IDEA_UNIT",
            "TOPIC_HAS_SUBTOPIC",
            "TURN_HAS_IDEA_UNIT",
          ].sort(),
        );
      },
    );
  });

  test("each node table reports its column names and types", async () => {
    let topicTable:
      | { name: string; properties: Array<{ name: string; type: string }> }
      | undefined;

    await given("an initialized schema exposing node table metadata", () => {});
    await when("the caller fetches the schema and locates the Topic table", async () => {
      const snapshot = await schema.getSchema();
      topicTable = snapshot.nodeTables.find((nt) => nt.name === "Topic");
    });
    await then("the property list matches the declared columns", () => {
      const propNames = (topicTable?.properties ?? [])
        .map((p) => p.name)
        .sort();
      expect(propNames).toEqual(
        [
          "id",
          "title",
          "short_summary",
          "long_summary",
          "source_sha",
          "is_stale",
          "edited_by_user",
        ].sort(),
      );
    });
    await and("each property carries a non-empty type label", () => {
      for (const p of topicTable?.properties ?? []) {
        expect(p.type.length).toBeGreaterThan(0);
      }
    });
  });

  test("each relationship table records its source and destination node types", async () => {
    let topicHasSubtopic: { from: string; to: string } | undefined;
    let conversationHasTurn: { from: string; to: string } | undefined;

    await given("an initialized schema exposing relationship metadata", () => {});
    await when("the caller fetches the schema and reads two well-known relations", async () => {
      const snapshot = await schema.getSchema();
      topicHasSubtopic = snapshot.relTables.find(
        (r) => r.name === "TOPIC_HAS_SUBTOPIC",
      );
      conversationHasTurn = snapshot.relTables.find(
        (r) => r.name === "CONVERSATION_HAS_TURN",
      );
    });
    await then("a self-referential parent/child relation links Topic to Topic", () => {
      expect(topicHasSubtopic).toEqual({
        name: "TOPIC_HAS_SUBTOPIC",
        from: "Topic",
        to: "Topic",
        properties: [],
      });
    });
    await and("Conversation-to-Turn ownership is reflected in the from/to pair", () => {
      expect(conversationHasTurn?.from).toBe("Conversation");
      expect(conversationHasTurn?.to).toBe("Turn");
    });
  });

  test("re-running schema bootstrap is idempotent", async () => {
    let beforeCounts: { nodes: number; rels: number };
    let afterCounts: { nodes: number; rels: number };

    await given("an already-bootstrapped schema with N node and rel tables", async () => {
      const snap = await schema.getSchema();
      beforeCounts = {
        nodes: snap.nodeTables.length,
        rels: snap.relTables.length,
      };
    });
    await when("the bootstrap statements run a second time", async () => {
      await schema.onModuleInit();
    });
    await then("the table catalogue is unchanged", async () => {
      const snap = await schema.getSchema();
      afterCounts = {
        nodes: snap.nodeTables.length,
        rels: snap.relTables.length,
      };
      expect(afterCounts).toEqual(beforeCounts);
    });
  });
});
