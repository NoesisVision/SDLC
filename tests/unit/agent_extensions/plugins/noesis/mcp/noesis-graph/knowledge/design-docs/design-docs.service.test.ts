import "reflect-metadata";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { and, given, then, when } from "@tests/bdd.js";
import {
  designDocCanonicalPath,
  noesisSubdirPath,
} from "@noesis/shared-contracts/source-files.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import {
  DATA_DIR,
  PROJECT_DIR,
} from "@noesis/mcp/noesis-graph/config/config.module.js";
import { FileSyncService } from "@noesis/mcp/noesis-graph/file-sync/file-sync.service.js";
import { GraphProjectionService } from "@noesis/mcp/noesis-graph/file-sync/graph-projection.service.js";
import { SourceFilesRepository } from "@noesis/mcp/noesis-graph/file-sync/source-files.repository.js";
import { SchemaService } from "@noesis/mcp/noesis-graph/knowledge/schema/schema.service.js";
import { DesignDocsRepository } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.repository.js";
import { DesignDocsService } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.service.js";

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

describe("DesignDocsService — saving, listing, and locking design documents", () => {
  let module: TestingModule;
  let service: DesignDocsService;
  let db: DatabaseService;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-dd-test-"));
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        SchemaService,
        DesignDocsRepository,
        DesignDocsService,
        SourceFilesRepository,
        FileSyncService,
        GraphProjectionService,
        { provide: DATA_DIR, useValue: tmpDir },
        { provide: PROJECT_DIR, useValue: tmpDir },
      ],
    }).compile();
    await module.init();
    db = module.get(DatabaseService);
    service = module.get(DesignDocsService);
    mkdirSync(noesisSubdirPath(tmpDir, "design_doc"), { recursive: true });
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

  async function writeDocFile(doc: {
    id: string;
    name: string;
    description?: string;
  }): Promise<string> {
    const path = designDocCanonicalPath(tmpDir, doc.id, doc.name);
    await writeFile(path, JSON.stringify(doc, null, 2), "utf-8");
    return path;
  }

  test("a minimal design doc can be saved and re-read through the listing", async () => {
    let saveResult: Awaited<ReturnType<DesignDocsService["saveDesignDocFromFile"]>>;
    let docs: Awaited<ReturnType<DesignDocsService["listDesignDocs"]>>;

    await given(
      "a JSON file at the canonical path with id, name, and description",
      async () => {
        await writeDocFile({
          id: "dd-1",
          name: "auth",
          description: "Auth system",
        });
      },
    );
    await when("the service saves the doc from that file", async () => {
      const path = designDocCanonicalPath(tmpDir, "dd-1", "auth");
      saveResult = await service.saveDesignDocFromFile(path);
      docs = await service.listDesignDocs();
    });
    await then("the save status is Ok and references the design doc id", () => {
      expect(saveResult.status).toBe("Ok");
      expect(saveResult.design_doc_id).toBe("dd-1");
    });
    await and(
      "the design doc appears exactly once in the catalogue listing",
      () => {
        expect(docs).toHaveLength(1);
        expect(docs[0].id).toBe("dd-1");
        expect(docs[0].name).toBe("auth");
      },
    );
  });

  test("saving from a non-canonical path is refused so files stay where they belong", async () => {
    let thrown: Error | null = null;

    await given(
      "a design doc JSON sitting at a non-canonical filename",
      async () => {
        const dir = noesisSubdirPath(tmpDir, "design_doc");
        const wrongPath = join(dir, "rogue-name.json");
        await writeFile(
          wrongPath,
          JSON.stringify(
            { id: "dd-x", name: "auth", description: "Auth" },
            null,
            2,
          ),
          "utf-8",
        );
      },
    );
    await when("the service is asked to save from that file path", async () => {
      const dir = noesisSubdirPath(tmpDir, "design_doc");
      const wrongPath = join(dir, "rogue-name.json");
      try {
        await service.saveDesignDocFromFile(wrongPath);
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then(
      "the operation fails and points the agent at prepare_design_doc_path",
      () => {
        expect(thrown?.message).toMatch(/canonical/);
        expect(thrown?.message).toMatch(/prepare_design_doc_path/);
      },
    );
  });

  test("prepareDesignDocPath returns the canonical path for a fresh doc", async () => {
    let result: Awaited<ReturnType<DesignDocsService["prepareDesignDocPath"]>>;

    await given("a brand new design doc id and name", () => {});
    await when("the agent asks where to write the file", async () => {
      result = await service.prepareDesignDocPath("payments", "dd-prep-1");
    });
    await then("the response is Ok and includes the canonical path", () => {
      expect(result.status).toBe("Ok");
      if (result.status !== "Ok") return;
      expect(result.id).toBe("dd-prep-1");
      expect(result.canonical_path).toBe(
        designDocCanonicalPath(tmpDir, "dd-prep-1", "payments"),
      );
    });
  });

  test("prepareDesignDocPath warns when the existing doc is already implemented", async () => {
    let result: Awaited<ReturnType<DesignDocsService["prepareDesignDocPath"]>>;

    await given(
      "a saved design doc that has been marked implemented",
      async () => {
        await writeDocFile({
          id: "dd-impl",
          name: "shipping",
          description: "Ship",
        });
        await service.saveDesignDocFromFile(
          designDocCanonicalPath(tmpDir, "dd-impl", "shipping"),
        );
        await service.markDesignDocImplemented("dd-impl");
      },
    );
    await when("the agent asks to reuse that id for a fresh write", async () => {
      result = await service.prepareDesignDocPath("shipping", "dd-impl");
    });
    await then(
      "the service responds AlreadyImplemented to redirect the agent",
      () => {
        expect(result.status).toBe("AlreadyImplemented");
        if (result.status !== "AlreadyImplemented") return;
        expect(result.design_doc_id).toBe("dd-impl");
        expect(result.name).toBe("shipping");
      },
    );
  });

  test("attempting to overwrite an implemented design doc is rejected", async () => {
    let thrown: Error | null = null;

    await given(
      "a design doc that has been saved and marked implemented",
      async () => {
        await writeDocFile({
          id: "dd-locked",
          name: "billing",
          description: "Bill",
        });
        await service.saveDesignDocFromFile(
          designDocCanonicalPath(tmpDir, "dd-locked", "billing"),
        );
        await service.markDesignDocImplemented("dd-locked");
      },
    );
    await when(
      "a second save tries to mutate the same id from another file",
      async () => {
        await writeDocFile({
          id: "dd-locked",
          name: "billing",
          description: "Bill v2",
        });
        try {
          await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-locked", "billing"),
          );
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then(
      "the operation fails because implemented docs are read-only",
      () => {
        expect(thrown?.message).toMatch(/implemented/);
        expect(thrown?.message).toMatch(/read-only/);
      },
    );
  });

  test("upsertActor adds a fresh actor to the catalogue", async () => {
    let result: Awaited<ReturnType<DesignDocsService["upsertActor"]>>;
    let actors: Awaited<ReturnType<DesignDocsService["listActors"]>>;

    await given("an empty actor catalogue", () => {});
    await when("the agent upserts a customer actor", async () => {
      result = await service.upsertActor({
        name: "Customer",
        description: "Pays for things",
      });
      actors = await service.listActors();
    });
    await then("the upsert returns Ok with the actor name", () => {
      expect(result).toEqual({ status: "Ok", name: "Customer" });
    });
    await and("the catalogue lists exactly the customer actor", () => {
      expect(actors.map((a) => a.name)).toEqual(["Customer"]);
    });
  });

  test("upsertActor rejects a blank actor name", async () => {
    let thrown: Error | null = null;

    await given("an empty actor catalogue", () => {});
    await when("the agent upserts an actor whose name is whitespace only", async () => {
      try {
        await service.upsertActor({ name: "   ", description: "blank" });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then(
      "the operation fails because actor names must not be empty",
      () => {
        expect(thrown?.message).toMatch(/Actor name must not be empty/);
      },
    );
  });

  test("getDesignDocDetail rejects unknown design doc ids", async () => {
    let thrown: Error | null = null;

    await given("an empty design doc catalogue", () => {});
    await when(
      "the consumer asks for the detail of an unknown design doc",
      async () => {
        try {
          await service.getDesignDocDetail("ghost");
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then("the request fails with a not-found error", () => {
      expect(thrown?.message).toMatch(/DesignDoc not found/);
    });
  });

  test("prepareDesignDocPath mints a fresh UUID when no id is supplied", async () => {
    let result: Awaited<ReturnType<DesignDocsService["prepareDesignDocPath"]>>;

    await given("an authoring agent that has no candidate id yet", () => {});
    await when("the agent asks for a path with id=null", async () => {
      result = await service.prepareDesignDocPath("brand-new", null);
    });
    await then("the response carries a freshly minted UUID id", () => {
      expect(result.status).toBe("Ok");
      if (result.status !== "Ok") return;
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
    await and("the canonical path is rooted at that minted id and the supplied name", () => {
      if (result.status !== "Ok") return;
      expect(result.canonical_path).toBe(
        designDocCanonicalPath(tmpDir, result.id, "brand-new"),
      );
    });
  });

  test("markDesignDocImplemented seals an existing doc as read-only", async () => {
    let beforeFlag: boolean;
    let afterFlag: boolean;

    await given("a saved design doc that has not yet been implemented", async () => {
      await writeDocFile({ id: "dd-seal", name: "seal", description: "x" });
      await service.saveDesignDocFromFile(
        designDocCanonicalPath(tmpDir, "dd-seal", "seal"),
      );
      beforeFlag = await service.isDesignDocImplemented("dd-seal");
    });
    await when("the agent marks the design doc implemented", async () => {
      await service.markDesignDocImplemented("dd-seal");
      afterFlag = await service.isDesignDocImplemented("dd-seal");
    });
    await then(
      "the implemented flag flips from false to true so future writes are blocked",
      () => {
        expect(beforeFlag).toBe(false);
        expect(afterFlag).toBe(true);
      },
    );
  });

  test("markDesignDocImplemented rejects unknown design doc ids", async () => {
    let thrown: Error | null = null;

    await given("an empty design doc catalogue", () => {});
    await when(
      "the agent tries to seal a design doc id that does not exist",
      async () => {
        try {
          await service.markDesignDocImplemented("ghost");
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then("the request fails with a not-found error", () => {
      expect(thrown?.message).toMatch(/DesignDoc not found/);
    });
  });

  test("readDesignDoc returns the stored doc, or null when the id is unknown", async () => {
    let stored: Awaited<ReturnType<DesignDocsService["readDesignDoc"]>>;
    let missing: Awaited<ReturnType<DesignDocsService["readDesignDoc"]>>;

    await given("a saved design doc with id and name", async () => {
      await writeDocFile({ id: "dd-read", name: "reader", description: "r" });
      await service.saveDesignDocFromFile(
        designDocCanonicalPath(tmpDir, "dd-read", "reader"),
      );
    });
    await when("the consumer reads a known and an unknown id", async () => {
      stored = await service.readDesignDoc("dd-read");
      missing = await service.readDesignDoc("ghost");
    });
    await then("the known id returns its full record", () => {
      expect(stored).not.toBeNull();
      expect(stored!.id).toBe("dd-read");
      expect(stored!.name).toBe("reader");
    });
    await and("the unknown id returns null", () => {
      expect(missing).toBeNull();
    });
  });

  test("deleteDesignDoc removes the doc from the catalogue", async () => {
    let listBefore: Awaited<ReturnType<DesignDocsService["listDesignDocs"]>>;
    let listAfter: Awaited<ReturnType<DesignDocsService["listDesignDocs"]>>;

    await given("a single saved design doc in the catalogue", async () => {
      await writeDocFile({ id: "dd-del", name: "deletable", description: "d" });
      await service.saveDesignDocFromFile(
        designDocCanonicalPath(tmpDir, "dd-del", "deletable"),
      );
      listBefore = await service.listDesignDocs();
    });
    await when("the consumer deletes it by id", async () => {
      await service.deleteDesignDoc("dd-del");
      listAfter = await service.listDesignDocs();
    });
    await then("the catalogue contained the doc before deletion", () => {
      expect(listBefore.map((d) => d.id)).toEqual(["dd-del"]);
    });
    await and("the catalogue is empty after deletion", () => {
      expect(listAfter).toEqual([]);
    });
  });

  test("the quality gate rejects an added rule whose description is shorter than 80 chars", async () => {
    let thrown: Error | null = null;

    await given(
      "a design doc whose only rule has a one-line description (<80 chars)",
      async () => {
        const path = designDocCanonicalPath(tmpDir, "dd-rule", "rule-doc");
        await writeFile(
          path,
          JSON.stringify({
            id: "dd-rule",
            name: "rule-doc",
            description: "rule",
            boundedContexts: {
              added: [
                {
                  name: "BC",
                  buildingBlocks: {
                    added: [
                      {
                        name: "Order",
                        type: "aggregate",
                        rules: {
                          added: [
                            { name: "Total positive", description: "too short" },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          }),
        );
      },
    );
    await when("the agent saves the design doc", async () => {
      try {
        await service.saveDesignDocFromFile(
          designDocCanonicalPath(tmpDir, "dd-rule", "rule-doc"),
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then(
      "the save is rejected and the error names the offending rule and the 80-char minimum",
      () => {
        expect(thrown?.message).toMatch(/Rule.*Total positive/);
        expect(thrown?.message).toMatch(/80/);
      },
    );
  });

  test(
    "the quality gate rejects an added behaviour whose description is shorter than 400 chars",
    async () => {
      let thrown: Error | null = null;

      await given(
        "a design doc whose only behaviour has a short description (<400 chars)",
        async () => {
          const path = designDocCanonicalPath(tmpDir, "dd-bh", "bh-doc");
          await writeFile(
            path,
            JSON.stringify({
              id: "dd-bh",
              name: "bh-doc",
              description: "bh",
              boundedContexts: {
                added: [
                  {
                    name: "BC",
                    buildingBlocks: {
                      added: [
                        {
                          name: "Order",
                          type: "aggregate",
                          behaviours: {
                            added: [
                              { name: "Place", description: "too short" },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          );
        },
      );
      await when("the agent saves the design doc", async () => {
        try {
          await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-bh", "bh-doc"),
          );
        } catch (e) {
          thrown = e as Error;
        }
      });
      await then(
        "the save is rejected with a behaviour-description length error",
        () => {
          expect(thrown?.message).toMatch(/Behaviour.*Place/);
          expect(thrown?.message).toMatch(/400/);
        },
      );
    },
  );

  test(
    "the quality gate rejects a behaviour referencing an actor that is not in the catalogue",
    async () => {
      let thrown: Error | null = null;
      const longDescription = "Description ".repeat(50);

      await given(
        "a design doc with a behaviour whose actor name is not yet registered",
        async () => {
          const path = designDocCanonicalPath(
            tmpDir,
            "dd-actor",
            "actor-doc",
          );
          await writeFile(
            path,
            JSON.stringify({
              id: "dd-actor",
              name: "actor-doc",
              description: "x",
              boundedContexts: {
                added: [
                  {
                    name: "BC",
                    buildingBlocks: {
                      added: [
                        {
                          name: "Checkout",
                          type: "application_service",
                          behaviours: {
                            added: [
                              {
                                name: "PlaceOrder",
                                description: longDescription,
                                actor: "UnknownPersona",
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          );
        },
      );
      await when("the agent saves the design doc", async () => {
        try {
          await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-actor", "actor-doc"),
          );
        } catch (e) {
          thrown = e as Error;
        }
      });
      await then(
        "the save is rejected and points the agent at upsert_actor / list_actors",
        () => {
          expect(thrown?.message).toMatch(/UnknownPersona/);
          expect(thrown?.message).toMatch(/upsert_actor/);
        },
      );
    },
  );

  test(
    "the quality gate rejects a behaviour with an actor when the host BB is not an application_service",
    async () => {
      let thrown: Error | null = null;
      const longDescription = "Description ".repeat(50);

      await given(
        "a registered actor and a behaviour with that actor on an aggregate (non-application_service) BB",
        async () => {
          await service.upsertActor({ name: "Customer", description: "c" });
          const path = designDocCanonicalPath(tmpDir, "dd-bbtype", "bbtype");
          await writeFile(
            path,
            JSON.stringify({
              id: "dd-bbtype",
              name: "bbtype",
              description: "x",
              boundedContexts: {
                added: [
                  {
                    name: "BC",
                    buildingBlocks: {
                      added: [
                        {
                          name: "Order",
                          type: "aggregate",
                          behaviours: {
                            added: [
                              {
                                name: "Place",
                                description: longDescription,
                                actor: "Customer",
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          );
        },
      );
      await when("the agent saves the design doc", async () => {
        try {
          await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-bbtype", "bbtype"),
          );
        } catch (e) {
          thrown = e as Error;
        }
      });
      await then(
        "the save is rejected because actors are only valid on application_service hosts",
        () => {
          expect(thrown?.message).toMatch(/application_service/);
        },
      );
    },
  );

  test(
    "a second save that omits a previously persisted bounded context is rejected unless confirmed_drops authorizes it",
    async () => {
      let firstResult: Awaited<ReturnType<DesignDocsService["saveDesignDocFromFile"]>>;
      let dropError: Error | null = null;
      let confirmedResult: Awaited<ReturnType<DesignDocsService["saveDesignDocFromFile"]>>;
      let detailAfter: Awaited<ReturnType<DesignDocsService["getDesignDocDetail"]>>;

      await given(
        "a saved design doc whose first version contains two bounded contexts (Sales and Billing)",
        async () => {
          await writeDocFile({
            id: "dd-drop",
            name: "drops",
            description: "Drop-detection scenario",
            boundedContexts: {
              added: [
                { name: "Sales", description: "owns orders" },
                { name: "Billing", description: "owns invoices" },
              ],
              modified: [],
              removed: [],
            },
          } as Parameters<typeof writeDocFile>[0]);
          firstResult = await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-drop", "drops"),
          );
        },
      );
      await when(
        "the agent overwrites the file with a second version that re-emits only Sales (Billing missing)",
        async () => {
          await writeDocFile({
            id: "dd-drop",
            name: "drops",
            description: "Drop-detection scenario",
            boundedContexts: {
              added: [{ name: "Sales", description: "owns orders" }],
              modified: [],
              removed: [],
            },
          } as Parameters<typeof writeDocFile>[0]);
          try {
            await service.saveDesignDocFromFile(
              designDocCanonicalPath(tmpDir, "dd-drop", "drops"),
            );
          } catch (e) {
            dropError = e as Error;
          }
        },
      );
      await then(
        "the first save succeeded and the second save is rejected naming the dropped bounded context path",
        () => {
          expect(firstResult.status).toBe("Ok");
          expect(dropError?.message).toMatch(/boundedContexts\/Billing/);
          expect(dropError?.message).toMatch(/confirmed_drops/);
        },
      );
      await and(
        "re-attempting the save with the dropped path in confirmed_drops succeeds and the graph reflects only the surviving bounded context",
        async () => {
          confirmedResult = await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-drop", "drops"),
            [],
            ["boundedContexts/Billing"],
          );
          detailAfter = await service.getDesignDocDetail("dd-drop");
          expect(confirmedResult.status).toBe("Ok");
          const bcs = detailAfter.source.boundedContexts?.added ?? [];
          expect(bcs.map((b) => b.name)).toEqual(["Sales"]);
        },
      );
    },
  );

  test(
    "a re-save that re-emits the same bounded context with new content replaces the prior projection wholesale (no orphan nodes)",
    async () => {
      let detailV1: Awaited<ReturnType<DesignDocsService["getDesignDocDetail"]>>;
      let detailV2: Awaited<ReturnType<DesignDocsService["getDesignDocDetail"]>>;

      await given(
        "a saved design doc with a bounded context Sales containing building blocks Order and PricingPolicy",
        async () => {
          await writeDocFile({
            id: "dd-replace",
            name: "replace",
            description: "Wholesale-replace scenario",
            boundedContexts: {
              added: [
                {
                  name: "Sales",
                  description: "v1",
                  buildingBlocks: {
                    added: [
                      { name: "Order", type: "aggregate", description: null },
                      { name: "PricingPolicy", type: "domain_service", description: null },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          } as Parameters<typeof writeDocFile>[0]);
          await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-replace", "replace"),
          );
          detailV1 = await service.getDesignDocDetail("dd-replace");
        },
      );
      await when(
        "the agent re-saves the doc with PricingPolicy authorized as a drop and Order re-emitted with a refined description",
        async () => {
          await writeDocFile({
            id: "dd-replace",
            name: "replace",
            description: "Wholesale-replace scenario v2",
            boundedContexts: {
              added: [
                {
                  name: "Sales",
                  description: "v2",
                  buildingBlocks: {
                    added: [
                      {
                        name: "Order",
                        type: "aggregate",
                        description: "Order aggregate root with refined definition.",
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          } as Parameters<typeof writeDocFile>[0]);
          await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-replace", "replace"),
            [],
            ["boundedContexts/Sales/buildingBlocks/PricingPolicy"],
          );
          detailV2 = await service.getDesignDocDetail("dd-replace");
        },
      );
      await then(
        "the first detail listed both building blocks under Sales",
        () => {
          const bbsV1 =
            detailV1.source.boundedContexts?.added[0].buildingBlocks?.added ?? [];
          expect(bbsV1.map((b) => b.name).sort()).toEqual([
            "Order",
            "PricingPolicy",
          ]);
        },
      );
      await and(
        "after the second save the graph contains only Order with the refined description and no orphan PricingPolicy",
        () => {
          const bcsV2 = detailV2.source.boundedContexts?.added ?? [];
          expect(bcsV2).toHaveLength(1);
          expect(bcsV2[0].name).toBe("Sales");
          expect(bcsV2[0].description).toBe("v2");
          const bbsV2 = bcsV2[0].buildingBlocks?.added ?? [];
          expect(bbsV2.map((b) => b.name)).toEqual(["Order"]);
          expect(bbsV2[0].description).toBe(
            "Order aggregate root with refined definition.",
          );
        },
      );
    },
  );

  test(
    "saveDesignDocFromFile rejects a doc whose ChangeSet has non-empty modified or removed (post-implementation diff is not allowed at the save boundary)",
    async () => {
      let thrown: Error | null = null;

      await given(
        "a design doc whose modules ChangeSet contains a modified entry",
        async () => {
          await writeDocFile({
            id: "dd-greenfield",
            name: "greenfield",
            description: "Greenfield-only scenario",
            boundedContexts: {
              added: [
                {
                  name: "Sales",
                  description: null,
                  modules: {
                    added: [],
                    modified: [{ name: "Orders", description: "modified path" }],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          } as Parameters<typeof writeDocFile>[0]);
        },
      );
      await when("the agent saves the design doc", async () => {
        try {
          await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-greenfield", "greenfield"),
          );
        } catch (e) {
          thrown = e as Error;
        }
      });
      await then(
        "the save is rejected with a green-field violation naming the offending path",
        () => {
          expect(thrown?.message).toMatch(/green-field/);
          expect(thrown?.message).toMatch(/modules/);
        },
      );
    },
  );

  test(
    "getDesignDocDetail reads the design doc from the graph and returns it as a ChangeSet tree with everything in 'added'",
    async () => {
      let detail: Awaited<ReturnType<DesignDocsService["getDesignDocDetail"]>>;

      await given(
        "a saved design doc with a bounded context, module, and building block",
        async () => {
          await writeDocFile({
            id: "dd-detail",
            name: "detail",
            description: "Detail read scenario",
            boundedContexts: {
              added: [
                {
                  name: "Sales",
                  description: "owns orders",
                  modules: {
                    added: [
                      {
                        name: "Orders",
                        description: "lifecycle",
                        buildingBlocks: {
                          added: [
                            {
                              name: "Order",
                              type: "aggregate",
                              description: "root",
                            },
                          ],
                          modified: [],
                          removed: [],
                        },
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          } as Parameters<typeof writeDocFile>[0]);
          await service.saveDesignDocFromFile(
            designDocCanonicalPath(tmpDir, "dd-detail", "detail"),
          );
        },
      );
      await when("the consumer requests the design doc detail", async () => {
        detail = await service.getDesignDocDetail("dd-detail");
      });
      await then(
        "the detail returns the full nested tree assembled from the graph projection",
        () => {
          const bc = detail.source.boundedContexts?.added[0];
          expect(bc?.name).toBe("Sales");
          expect(bc?.description).toBe("owns orders");
          const mod = bc?.modules?.added[0];
          expect(mod?.name).toBe("Orders");
          expect(mod?.description).toBe("lifecycle");
          const bb = mod?.buildingBlocks?.added[0];
          expect(bb?.name).toBe("Order");
          expect(bb?.description).toBe("root");
        },
      );
    },
  );
});
