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
import { DatabaseService } from "../../database/database.service.js";
import { DATA_DIR } from "../../config/config.module.js";
import { DesignDocsRepository } from "./design-docs.repository.js";
import { DesignDocsService } from "./design-docs.service.js";

const NODE_LABELS = [
  "DesignedScenario",
  "DesignedRule",
  "DesignedBehaviour",
  "DesignedBuildingBlock",
  "DesignedDomainModule",
  "DesignedBoundedContext",
  "DesignedActor",
  "DesignedQualityAttribute",
  "DesignDoc",
];

describe("DesignDocsService", () => {
  let module: TestingModule;
  let service: DesignDocsService;
  let db: DatabaseService;
  let tmpDir: string;
  let workDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-dd-test-"));
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        DesignDocsRepository,
        DesignDocsService,
        { provide: DATA_DIR, useValue: tmpDir },
      ],
    }).compile();
    await module.init();
    db = module.get(DatabaseService);
    service = module.get(DesignDocsService);
    workDir = mkdtempSync(join(tmpdir(), "noesis-dd-work-"));
  });

  afterAll(async () => {
    await module.close();
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const conn = db.getConnection();
    for (const label of NODE_LABELS) {
      await conn.query(`MATCH (n:${label}) DETACH DELETE n`);
    }
  });

  async function writeDoc(doc: unknown, name: string): Promise<string> {
    const path = join(workDir, name);
    await writeFile(path, JSON.stringify(doc, null, 2), "utf-8");
    return path;
  }

  async function countNodes(label: string): Promise<number> {
    const result = await db.getConnection().query(
      `MATCH (n:${label}) RETURN COUNT(n) AS c`,
    );
    const rows = asArray(result).getAllSync() as Array<{ c: number | bigint }>;
    return Number(rows[0].c);
  }

  describe("saveDesignDocFromFile", () => {
    test("persists a minimal DesignDoc with only metadata", async () => {
      const path = await writeDoc(
        { id: "dd-1", name: "auth", description: "Auth system" },
        "minimal.json",
      );
      const result = await service.saveDesignDocFromFile(path);
      expect(result.design_doc_id).toBe("dd-1");
      expect(await countNodes("DesignDoc")).toBe(1);
    });

    test("creates actors, BCs, modules, BBs, behaviours, rules, scenarios", async () => {
      const doc = {
        id: "dd-2",
        name: "orders",
        description: "Order management",
        actors: {
          added: [{ name: "Customer", description: "Buys things" }],
        },
        boundedContexts: {
          added: [
            {
              name: "Sales",
              description: "Sales context",
              modules: {
                added: [
                  {
                    name: "Ordering",
                    buildingBlocks: {
                      added: [
                        {
                          name: "Order",
                          type: "aggregate",
                          properties: {
                            added: [
                              { name: "id", type: "OrderId" },
                              { name: "total", type: "Money" },
                            ],
                          },
                          behaviours: {
                            added: [
                              {
                                name: "Place",
                                type: "Command",
                                isPublic: true,
                                actor: "Customer",
                                input: { added: ["PlaceOrderRequest"] },
                                output: { added: ["OrderPlaced"] },
                                rules: {
                                  added: [
                                    {
                                      name: "PositiveTotal",
                                      ruleType: "Computation",
                                      description: "Total > 0",
                                    },
                                  ],
                                },
                                scenarios: {
                                  added: [
                                    {
                                      name: "Happy path",
                                      description: "Customer places valid order",
                                      given: "Cart with items",
                                      when: "PlaceOrder is invoked",
                                      then: "OrderPlaced event is emitted",
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
        qualityAttributes: {
          added: [
            { name: "Throughput", type: "performance", description: "1000 rps" },
          ],
        },
      };
      const path = await writeDoc(doc, "full.json");
      const result = await service.saveDesignDocFromFile(path);

      expect(result.status).toBe("Ok");
      expect(result.design_doc_id).toBe("dd-2");
      expect(await countNodes("DesignedActor")).toBe(1);
      expect(await countNodes("DesignedBoundedContext")).toBe(1);
      expect(await countNodes("DesignedDomainModule")).toBe(1);
      expect(await countNodes("DesignedBuildingBlock")).toBe(1);
      expect(await countNodes("DesignedBehaviour")).toBe(1);
      expect(await countNodes("DesignedRule")).toBe(1);
      expect(await countNodes("DesignedScenario")).toBe(1);
      expect(await countNodes("DesignedQualityAttribute")).toBe(1);
    });

    test("modified ChangeSet updates only changed fields", async () => {
      const initial = {
        id: "dd-4",
        name: "evolve",
        description: "v1",
        boundedContexts: {
          added: [{ name: "Core", description: "first version" }],
        },
      };
      await service.saveDesignDocFromFile(
        await writeDoc(initial, "v1.json"),
      );

      const delta = {
        id: "dd-4",
        name: "evolve",
        description: "v2",
        boundedContexts: {
          modified: [{ name: "Core", description: "second version" }],
        },
      };
      const result = await service.saveDesignDocFromFile(
        await writeDoc(delta, "v2.json"),
      );
      expect(result.status).toBe("Ok");
      const read = await service.readDesignDoc("dd-4");
      expect(read?.description).toBe("v2");
      expect(read?.boundedContexts?.added[0].description).toBe(
        "second version",
      );
    });

    test("round-trips a behaviour with omitted input/output/usedBuildingBlocks", async () => {
      const doc = {
        id: "dd-roundtrip",
        name: "rt",
        description: "Behaviour with no IO ChangeSets",
        boundedContexts: {
          added: [
            {
              name: "BC",
              buildingBlocks: {
                added: [
                  {
                    name: "BB",
                    type: "aggregate",
                    behaviours: {
                      added: [
                        {
                          name: "Plain",
                          type: "Command",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      };
      await service.saveDesignDocFromFile(
        await writeDoc(doc, "roundtrip.json"),
      );
      const read = await service.readDesignDoc("dd-roundtrip");
      expect(read).not.toBeNull();
      const bh =
        read?.boundedContexts?.added[0].buildingBlocks?.added[0].behaviours
          ?.added[0];
      expect(bh?.name).toBe("Plain");
      expect(bh?.input?.added).toEqual([]);
      expect(bh?.output?.added).toEqual([]);
      expect(bh?.usedBuildingBlocks?.added).toEqual([]);
    });

    test("rejects null in place of a ChangeSet", async () => {
      const path = await writeDoc(
        {
          id: "dd-nullcs",
          name: "nullcs",
          description: "should reject null",
          actors: null,
        },
        "nullcs.json",
      );
      await expect(service.saveDesignDocFromFile(path)).rejects.toThrow();
    });

    test("removed ChangeSet deletes by name", async () => {
      const initial = {
        id: "dd-5",
        name: "drop",
        description: "v1",
        actors: {
          added: [
            { name: "Alpha" },
            { name: "Beta" },
          ],
        },
      };
      await service.saveDesignDocFromFile(
        await writeDoc(initial, "v1.json"),
      );
      expect(await countNodes("DesignedActor")).toBe(2);

      const delta = {
        id: "dd-5",
        name: "drop",
        description: "v1",
        actors: { removed: ["Alpha"] },
      };
      await service.saveDesignDocFromFile(
        await writeDoc(delta, "v2.json"),
      );
      expect(await countNodes("DesignedActor")).toBe(1);
    });
  });

  describe("readDesignDoc", () => {
    test("returns null for unknown id", async () => {
      const doc = await service.readDesignDoc("nope");
      expect(doc).toBeNull();
    });

    test("returns full nested DesignDoc", async () => {
      const path = await writeDoc(
        {
          id: "dd-r",
          name: "read-test",
          description: "d",
          actors: { added: [{ name: "A" }] },
          boundedContexts: {
            added: [
              {
                name: "BC",
                buildingBlocks: {
                  added: [{ name: "BB", type: "entity" }],
                },
              },
            ],
          },
        },
        "r.json",
      );
      await service.saveDesignDocFromFile(path);
      const doc = await service.readDesignDoc("dd-r");
      expect(doc).not.toBeNull();
      expect(doc?.actors?.added.map((a) => a.name)).toEqual(["A"]);
      expect(doc?.boundedContexts?.added[0].name).toBe("BC");
      expect(
        doc?.boundedContexts?.added[0].buildingBlocks?.added[0].name,
      ).toBe("BB");
    });
  });

  describe("listDesignDocs", () => {
    test("returns overview rows for all design docs", async () => {
      await service.saveDesignDocFromFile(
        await writeDoc(
          {
            id: "dd-a",
            name: "alpha",
            description: "first",
            actors: { added: [{ name: "X" }] },
          },
          "a.json",
        ),
      );
      await service.saveDesignDocFromFile(
        await writeDoc(
          { id: "dd-b", name: "beta", description: "second" },
          "b.json",
        ),
      );
      const docs = await service.listDesignDocs();
      expect(docs).toHaveLength(2);
      const alpha = docs.find((d) => d.id === "dd-a");
      expect(alpha?.actor_count).toBe(1);
    });
  });

  describe("readBoundedContextMap", () => {
    test("returns BCs grouped by design doc with their modules", async () => {
      await service.saveDesignDocFromFile(
        await writeDoc(
          {
            id: "dd-map-a",
            name: "alpha",
            description: "first",
            boundedContexts: {
              added: [
                {
                  name: "Sales",
                  description: "Sales context",
                  modules: { added: [{ name: "Ordering" }] },
                },
                { name: "Catalog", description: "Catalog context" },
              ],
            },
          },
          "map-a.json",
        ),
      );
      await service.saveDesignDocFromFile(
        await writeDoc(
          {
            id: "dd-map-b",
            name: "beta",
            description: "second",
            boundedContexts: {
              added: [{ name: "Billing" }],
            },
          },
          "map-b.json",
        ),
      );

      const map = await service.readBoundedContextMap();
      expect(map).toHaveLength(3);
      const sales = map.find((e) => e.bounded_context_name === "Sales")!;
      expect(sales.design_doc_id).toBe("dd-map-a");
      expect(sales.description).toBe("Sales context");
      expect(sales.modules.map((m) => m.name)).toEqual(["Ordering"]);
      const billing = map.find((e) => e.bounded_context_name === "Billing")!;
      expect(billing.design_doc_id).toBe("dd-map-b");
      expect(billing.modules).toEqual([]);
    });

    test("returns empty list when no design docs exist", async () => {
      expect(await service.readBoundedContextMap()).toEqual([]);
    });
  });

  describe("readModelForTargets", () => {
    test("returns the full BC when module_name is null", async () => {
      await service.saveDesignDocFromFile(
        await writeDoc(
          {
            id: "dd-target",
            name: "t",
            description: "d",
            boundedContexts: {
              added: [
                {
                  name: "Sales",
                  modules: {
                    added: [
                      {
                        name: "Ordering",
                        buildingBlocks: {
                          added: [{ name: "Order", type: "aggregate" }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          "target.json",
        ),
      );

      const ctxList = await service.readModelForTargets([
        {
          design_doc_id: "dd-target",
          bounded_context_name: "Sales",
          module_name: null,
        },
      ]);
      expect(ctxList).toHaveLength(1);
      expect(ctxList[0].name).toBe("Sales");
      expect(ctxList[0].modules?.added.map((m) => m.name)).toEqual(["Ordering"]);
    });

    test("filters to a single module when module_name is provided", async () => {
      await service.saveDesignDocFromFile(
        await writeDoc(
          {
            id: "dd-multi",
            name: "m",
            description: "d",
            boundedContexts: {
              added: [
                {
                  name: "Sales",
                  modules: {
                    added: [
                      { name: "Ordering" },
                      { name: "Pricing" },
                    ],
                  },
                  buildingBlocks: {
                    added: [{ name: "BareBlock" }],
                  },
                },
              ],
            },
          },
          "multi.json",
        ),
      );

      const ctxList = await service.readModelForTargets([
        {
          design_doc_id: "dd-multi",
          bounded_context_name: "Sales",
          module_name: "Pricing",
        },
      ]);
      expect(ctxList).toHaveLength(1);
      const modules = ctxList[0].modules?.added.map((m) => m.name);
      expect(modules).toEqual(["Pricing"]);
      expect(ctxList[0].buildingBlocks?.added).toEqual([]);
    });

    test("skips targets that do not exist", async () => {
      const ctxList = await service.readModelForTargets([
        {
          design_doc_id: "ghost",
          bounded_context_name: "X",
          module_name: null,
        },
      ]);
      expect(ctxList).toEqual([]);
    });
  });

  describe("deleteDesignDoc", () => {
    test("removes a DesignDoc and all descendants", async () => {
      await service.saveDesignDocFromFile(
        await writeDoc(
          {
            id: "dd-del",
            name: "x",
            description: "d",
            actors: { added: [{ name: "A" }] },
            boundedContexts: {
              added: [
                {
                  name: "BC",
                  buildingBlocks: { added: [{ name: "BB" }] },
                },
              ],
            },
          },
          "del.json",
        ),
      );
      await service.deleteDesignDoc("dd-del");
      expect(await countNodes("DesignDoc")).toBe(0);
      expect(await countNodes("DesignedActor")).toBe(0);
      expect(await countNodes("DesignedBoundedContext")).toBe(0);
      expect(await countNodes("DesignedBuildingBlock")).toBe(0);
    });
  });
});

function asArray(
  result: unknown,
): { getNumTuples(): number; getAllSync(): unknown[] } {
  if (Array.isArray(result)) return result[0];
  return result as { getNumTuples(): number; getAllSync(): unknown[] };
}
