import "reflect-metadata";
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { DatabaseService } from "../database/database.service.js";
import { DATA_DIR } from "../config/config.module.js";
import { KnowledgeRepository } from "./knowledge.repository.js";
import { KnowledgeService } from "./knowledge.service.js";
import {
  alternativeOptionNodeId,
  documentFragmentNodeId,
  ideaUnitNodeId,
  turnNodeId,
} from "./knowledge.types.js";

const NODE_LABELS = [
  "AlternativeOption",
  "Decision",
  "Topic",
  "IdeaUnit",
  "Turn",
  "Conversation",
  "DocumentFragment",
  "Document",
];

describe("KnowledgeService", () => {
  let module: TestingModule;
  let service: KnowledgeService;
  let db: DatabaseService;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-kg-test-"));
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        KnowledgeRepository,
        KnowledgeService,
        { provide: DATA_DIR, useValue: tmpDir },
      ],
    }).compile();
    await module.init();
    db = module.get(DatabaseService);
    service = module.get(KnowledgeService);
  });

  afterAll(async () => {
    await module.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const conn = db.getConnection();
    for (const label of NODE_LABELS) {
      await conn.query(`MATCH (n:${label}) DETACH DELETE n`);
    }
  });

  async function countNodes(label: string): Promise<number> {
    const result = await db.getConnection().query(
      `MATCH (n:${label}) RETURN COUNT(n) AS c`,
    );
    const rows = asArray(result).getAllSync() as Array<{ c: number | bigint }>;
    return Number(rows[0].c);
  }

  async function countRels(relName: string): Promise<number> {
    const result = await db.getConnection().query(
      `MATCH ()-[r:${relName}]->() RETURN COUNT(r) AS c`,
    );
    const rows = asArray(result).getAllSync() as Array<{ c: number | bigint }>;
    return Number(rows[0].c);
  }

  describe("addTopic", () => {
    test("creates a top-level topic with provided id", async () => {
      const { id } = await service.addTopic({
        id: "topic-1",
        title: "Auth",
        short_summary: "Authentication scope",
      });
      expect(id).toBe("topic-1");
      expect(await countNodes("Topic")).toBe(1);
    });

    test("generates a uuid when id omitted", async () => {
      const { id } = await service.addTopic({
        title: "Auth",
        short_summary: "Authentication scope",
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    test("fails on duplicate id", async () => {
      await service.addTopic({ id: "dup", title: "A", short_summary: "" });
      await expect(
        service.addTopic({ id: "dup", title: "B", short_summary: "" }),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe("addSubtopic", () => {
    test("creates a child topic under an existing parent", async () => {
      await service.addTopic({ id: "p", title: "Parent", short_summary: "" });
      const { id } = await service.addSubtopic("p", {
        id: "c",
        title: "Child",
        short_summary: "",
      });
      expect(id).toBe("c");
      expect(await countRels("TOPIC_HAS_SUBTOPIC")).toBe(1);
    });

    test("fails when the parent is missing", async () => {
      await expect(
        service.addSubtopic("missing", {
          id: "c",
          title: "Child",
          short_summary: "",
        }),
      ).rejects.toThrow(/Topic not found/);
    });
  });

  describe("reparentTopic", () => {
    test("moves a topic from one parent to another", async () => {
      await service.addTopic({ id: "a", title: "A", short_summary: "" });
      await service.addTopic({ id: "b", title: "B", short_summary: "" });
      await service.addSubtopic("a", { id: "c", title: "C", short_summary: "" });

      await service.reparentTopic("c", "b");

      const conn = db.getConnection();
      const result = await conn.query(
        "MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(c:Topic {id: 'c'}) RETURN p.id AS pid",
      );
      const rows = asArray(result).getAllSync() as Array<{ pid: string }>;
      expect(rows.map((r) => r.pid)).toEqual(["b"]);
    });

    test("makes a topic top-level when new parent is null", async () => {
      await service.addTopic({ id: "a", title: "A", short_summary: "" });
      await service.addSubtopic("a", { id: "c", title: "C", short_summary: "" });
      await service.reparentTopic("c", null);
      expect(await countRels("TOPIC_HAS_SUBTOPIC")).toBe(0);
    });

    test("fails on self-parenting", async () => {
      await service.addTopic({ id: "a", title: "A", short_summary: "" });
      await expect(service.reparentTopic("a", "a")).rejects.toThrow(
        /its own parent/,
      );
    });

    test("fails when new parent missing", async () => {
      await service.addTopic({ id: "c", title: "C", short_summary: "" });
      await expect(service.reparentTopic("c", "ghost")).rejects.toThrow(
        /Topic not found/,
      );
    });
  });

  describe("addConversationFromFile", () => {
    test("creates Conversation, Turn, and IdeaUnit nodes", async () => {
      const path = join(tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));

      const result = await service.addConversationFromFile(path);
      expect(result).toEqual({
        conversation_id: "conv-1",
        turns: 2,
        idea_units: 3,
      });
      expect(await countNodes("Conversation")).toBe(1);
      expect(await countNodes("Turn")).toBe(2);
      expect(await countNodes("IdeaUnit")).toBe(3);
      expect(await countRels("CONVERSATION_HAS_TURN")).toBe(2);
      expect(await countRels("TURN_HAS_IDEA_UNIT")).toBe(3);
    });

    test("uses synthetic ids for turns and idea units", async () => {
      const path = join(tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));
      await service.addConversationFromFile(path);

      const expectedTurnId = turnNodeId("conv-1", 0);
      const expectedIuId = ideaUnitNodeId("conv-1", 0, 0);

      const turn = await db
        .getConnection()
        .query(`MATCH (t:Turn {id: '${expectedTurnId}'}) RETURN t.id AS id`);
      expect(asArray(turn).getAllSync()).toEqual([{ id: expectedTurnId }]);

      const iu = await db
        .getConnection()
        .query(`MATCH (u:IdeaUnit {id: '${expectedIuId}'}) RETURN u.id AS id`);
      expect(asArray(iu).getAllSync()).toEqual([{ id: expectedIuId }]);
    });

    test("fails when conversation id already exists", async () => {
      const path = join(tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-dup")));
      await service.addConversationFromFile(path);
      await expect(service.addConversationFromFile(path)).rejects.toThrow(
        /already exists/,
      );
    });
  });

  describe("addDocumentFromFile", () => {
    test("creates a Document node", async () => {
      const path = join(tmpDir, "doc.json");
      await writeFile(
        path,
        JSON.stringify({
          id: "doc-1",
          title: "Spec",
          date: "2026-04-17",
          content: "hello",
        }),
      );
      const result = await service.addDocumentFromFile(path);
      expect(result).toEqual({ id: "doc-1" });
      expect(await countNodes("Document")).toBe(1);
    });

    test("fails when document id already exists", async () => {
      const path = join(tmpDir, "doc.json");
      await writeFile(
        path,
        JSON.stringify({
          id: "doc-dup",
          title: "Spec",
          date: "2026-04-17",
          content: "hello",
        }),
      );
      await service.addDocumentFromFile(path);
      await expect(service.addDocumentFromFile(path)).rejects.toThrow(
        /already exists/,
      );
    });
  });

  describe("addItemsToTopic", () => {
    test("links existing idea units to a topic", async () => {
      const path = join(tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));
      await service.addConversationFromFile(path);
      await service.addTopic({ id: "t1", title: "T1", short_summary: "" });

      const result = await service.addItemsToTopic("t1", [
        {
          type: "conversation_idea_unit",
          conversation_id: "conv-1",
          turn_index: 0,
          idea_unit_index: 0,
        },
      ]);
      expect(result).toEqual({ added: 1 });
      expect(await countRels("TOPIC_HAS_IDEA_UNIT")).toBe(1);
    });

    test("creates document fragment on demand and links it", async () => {
      const docPath = join(tmpDir, "doc.json");
      await writeFile(
        docPath,
        JSON.stringify({
          id: "doc-1",
          title: "D",
          date: "2026-04-17",
          content: "some text",
        }),
      );
      await service.addDocumentFromFile(docPath);
      await service.addTopic({ id: "t1", title: "T1", short_summary: "" });

      await service.addItemsToTopic("t1", [
        {
          type: "document_fragment",
          document_id: "doc-1",
          start_offset: 0,
          end_offset: 4,
        },
      ]);

      expect(await countNodes("DocumentFragment")).toBe(1);
      expect(await countRels("TOPIC_HAS_DOCUMENT_FRAGMENT")).toBe(1);
      expect(await countRels("DOCUMENT_HAS_FRAGMENT")).toBe(1);

      const fragId = documentFragmentNodeId("doc-1", 0, 4);
      const frag = await db
        .getConnection()
        .query(`MATCH (f:DocumentFragment {id: '${fragId}'}) RETURN f.id AS id`);
      expect(asArray(frag).getAllSync()).toEqual([{ id: fragId }]);
    });

    test("fails when idea unit does not exist", async () => {
      await service.addTopic({ id: "t1", title: "T1", short_summary: "" });
      await expect(
        service.addItemsToTopic("t1", [
          {
            type: "conversation_idea_unit",
            conversation_id: "ghost",
            turn_index: 0,
            idea_unit_index: 0,
          },
        ]),
      ).rejects.toThrow(/Idea unit not found/);
    });

    test("fails when document does not exist", async () => {
      await service.addTopic({ id: "t1", title: "T1", short_summary: "" });
      await expect(
        service.addItemsToTopic("t1", [
          {
            type: "document_fragment",
            document_id: "ghost",
            start_offset: 0,
            end_offset: 1,
          },
        ]),
      ).rejects.toThrow(/Document not found/);
    });
  });

  describe("addDecision", () => {
    test("creates Decision, Alternatives, and per-slot supporting edges", async () => {
      const convPath = join(tmpDir, "conv.json");
      await writeFile(convPath, JSON.stringify(sampleConversation("conv-1")));
      await service.addConversationFromFile(convPath);
      await service.addTopic({ id: "t1", title: "T", short_summary: "" });

      const iuContext = {
        type: "conversation_idea_unit" as const,
        conversation_id: "conv-1",
        turn_index: 0,
        idea_unit_index: 0,
      };
      const iuDecision = {
        type: "conversation_idea_unit" as const,
        conversation_id: "conv-1",
        turn_index: 0,
        idea_unit_index: 1,
      };
      const iuAlt = {
        type: "conversation_idea_unit" as const,
        conversation_id: "conv-1",
        turn_index: 1,
        idea_unit_index: 0,
      };

      const { id } = await service.addDecision("t1", {
        id: "dec-1",
        title: "Pick Postgres",
        status: "accepted",
        context: { text: "We need a DB.", supporting_items: [iuContext] },
        decision: {
          text: "Use Postgres.",
          rationale: "Team knows it.",
          supporting_items: [iuDecision],
        },
        alternative_options: [
          {
            text: "Use MySQL.",
            rationale: "Slightly faster.",
            supporting_items: [iuAlt],
          },
        ],
      });

      expect(id).toBe("dec-1");
      expect(await countRels("TOPIC_HAS_DECISION")).toBe(1);
      expect(await countNodes("AlternativeOption")).toBe(1);
      expect(await countRels("DECISION_HAS_ALTERNATIVE")).toBe(1);
      expect(await countRels("CONTEXT_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
      expect(await countRels("DECISION_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
      expect(await countRels("ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT")).toBe(1);

      const expectedAltId = alternativeOptionNodeId("dec-1", 0);
      const alt = await db
        .getConnection()
        .query(
          `MATCH (a:AlternativeOption {id: '${expectedAltId}'}) RETURN a.option_index AS idx`,
        );
      expect(asArray(alt).getAllSync()).toEqual([{ idx: 0 }]);
    });

    test("fails when referenced idea unit is missing", async () => {
      await service.addTopic({ id: "t1", title: "T", short_summary: "" });
      await expect(
        service.addDecision("t1", {
          id: "dec-1",
          title: "X",
          status: "proposed",
          context: {
            text: "",
            supporting_items: [
              {
                type: "conversation_idea_unit",
                conversation_id: "ghost",
                turn_index: 0,
                idea_unit_index: 0,
              },
            ],
          },
          decision: { text: "", rationale: "", supporting_items: [] },
          alternative_options: [],
        }),
      ).rejects.toThrow(/Idea unit not found/);
    });

    test("fails when target topic is missing", async () => {
      await expect(
        service.addDecision("missing", {
          id: "dec-1",
          title: "X",
          status: "proposed",
          context: { text: "", supporting_items: [] },
          decision: { text: "", rationale: "", supporting_items: [] },
          alternative_options: [],
        }),
      ).rejects.toThrow(/Topic not found/);
    });
  });

  describe("addItemsToDecisionSlot", () => {
    test("routes items to the correct slot", async () => {
      const convPath = join(tmpDir, "conv.json");
      await writeFile(convPath, JSON.stringify(sampleConversation("conv-1")));
      await service.addConversationFromFile(convPath);
      await service.addTopic({ id: "t1", title: "T", short_summary: "" });
      await service.addDecision("t1", {
        id: "dec-1",
        title: "X",
        status: "proposed",
        context: { text: "", supporting_items: [] },
        decision: { text: "", rationale: "", supporting_items: [] },
        alternative_options: [
          { text: "Alt", rationale: "", supporting_items: [] },
        ],
      });

      const iu = {
        type: "conversation_idea_unit" as const,
        conversation_id: "conv-1",
        turn_index: 0,
        idea_unit_index: 0,
      };

      await service.addItemsToDecisionSlot("dec-1", { slot: "context" }, [iu]);
      await service.addItemsToDecisionSlot("dec-1", { slot: "decision" }, [iu]);
      await service.addItemsToDecisionSlot(
        "dec-1",
        { slot: "alternative", alternative_index: 0 },
        [iu],
      );

      expect(await countRels("CONTEXT_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
      expect(await countRels("DECISION_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
      expect(await countRels("ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
    });

    test("fails when alternative index does not exist", async () => {
      await service.addTopic({ id: "t1", title: "T", short_summary: "" });
      await service.addDecision("t1", {
        id: "dec-1",
        title: "X",
        status: "proposed",
        context: { text: "", supporting_items: [] },
        decision: { text: "", rationale: "", supporting_items: [] },
        alternative_options: [],
      });

      await expect(
        service.addItemsToDecisionSlot(
          "dec-1",
          { slot: "alternative", alternative_index: 5 },
          [],
        ),
      ).rejects.toThrow(/Alternative option not found/);
    });
  });
});

function asArray(
  result: unknown,
): { getNumTuples(): number; getAllSync(): unknown[] } {
  if (Array.isArray(result)) return result[0];
  return result as { getNumTuples(): number; getAllSync(): unknown[] };
}

function sampleConversation(id: string): unknown {
  return {
    conversation_id: id,
    time: "2026-04-17T10:00:00Z",
    main_topic: "Sample",
    turns: [
      {
        index: 0,
        speaker: "alice",
        time: "2026-04-17T10:00:00Z",
        idea_units: [
          { index: 0, sentences: ["hello"], categories: ["Information"] },
          { index: 1, sentences: ["world"], categories: ["Position"] },
        ],
      },
      {
        index: 1,
        speaker: "bob",
        time: "2026-04-17T10:01:00Z",
        idea_units: [
          { index: 0, sentences: ["ok"], categories: ["Argument"] },
        ],
      },
    ],
    topics: [],
    decisions: [],
  };
}
