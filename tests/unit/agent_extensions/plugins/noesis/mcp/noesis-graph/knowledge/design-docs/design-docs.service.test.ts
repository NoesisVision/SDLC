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
import { FileLoaderService } from "@noesis/mcp/noesis-graph/file-sync/file-loader.service.js";
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
        FileLoaderService,
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
});
