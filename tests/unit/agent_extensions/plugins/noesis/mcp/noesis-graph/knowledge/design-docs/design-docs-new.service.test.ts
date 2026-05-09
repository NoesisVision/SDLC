import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-new-test-context.js";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
} from "@noesis/shared-contracts/design-doc-new.js";

function designDoc(overrides: Partial<DesignDocFileNew> = {}): DesignDocFileNew {
  return DesignDocFileNewSchema.parse({
    id: "01928000-0000-7000-8000-000000000001",
    name: "billing",
    description: "Billing context.",
    actors: [],
    boundedContexts: { added: [], removed: [], modified: [] },
    implemented: false,
    ...overrides,
  });
}

function writeDesignDocFile(
  projectDir: string,
  filename: string,
  file: DesignDocFileNew,
): string {
  const path = join(projectDir, "noesis", "design-docs", filename);
  mkdirSync(join(projectDir, "noesis", "design-docs"), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  return path;
}

describe("DesignDocsServiceNew — canonical paths, locks, mark implemented, actor dedup", () => {
  let ctx: KnowledgeNewTestContext;

  beforeAll(async () => {
    ctx = await createKnowledgeNewTestModule();
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.projectDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraphNew(ctx.db);
  });

  test("prepareDesignDocPath mints a UUID and returns the canonical path when no id is supplied", async () => {
    const result = await ctx.designDocs.prepareDesignDocPath({ name: "auth" });
    expect(result.status).toBe("Ok");
    if (result.status !== "Ok") return;
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.canonical_path).toContain("/noesis/design-docs/auth-");
    expect(result.canonical_path).toMatch(/-[0-9a-f]{8}\.json$/);
  });

  test("prepareDesignDocPath returns AlreadyImplemented when the id was sealed", async () => {
    await given("an implemented design doc in DB", async () => {
      const file = designDoc({ implemented: true });
      const path = writeDesignDocFile(ctx.projectDir, "billing-doc.json", file);
      await ctx.designDocsRepository.upsert(file, "sha", path);
    });

    const id = "01928000-0000-7000-8000-000000000001";
    const result = await ctx.designDocs.prepareDesignDocPath({
      id,
      name: "billing",
    });
    expect(result.status).toBe("AlreadyImplemented");
  });

  test("persistFile writes to the canonical path and removes a renamed-from file", async () => {
    let firstPath = "";
    let secondPath = "";

    await given("a design doc persisted under name 'billing'", () => {
      firstPath = ctx.designDocs.persistFile(
        designDoc({ name: "billing" }),
      );
    });
    await when("the design doc is renamed to 'invoicing' and persisted again", () => {
      secondPath = ctx.designDocs.persistFile(
        designDoc({ name: "invoicing" }),
      );
    });
    await then("the new path differs from the previous one", () => {
      expect(secondPath).not.toBe(firstPath);
      expect(secondPath).toContain("/invoicing-");
    });
    await and("the previous file no longer exists on disk", () => {
      let existsAfter = true;
      try {
        readFileSync(firstPath);
      } catch {
        existsAfter = false;
      }
      expect(existsAfter).toBe(false);
    });
  });

  test("indexFile inserts DesignDoc and registers actors deduped by name", async () => {
    let path = "";

    await given("a design doc file referencing two actors", () => {
      path = writeDesignDocFile(
        ctx.projectDir,
        "billing-aaa.json",
        designDoc({
          actors: [
            { name: "Customer", description: "End-user purchasing." },
            { name: "Approver", description: "Approves invoices." },
          ],
        }),
      );
    });
    let outcome: { status: string } | null = null;
    await when("the indexer projects the design doc", async () => {
      outcome = await ctx.designDocs.indexFile(path);
    });
    await then("the design doc is reported as indexed", () => {
      expect(outcome?.status).toBe("indexed");
    });
    await and("the actor catalog contains both names", async () => {
      const actors = await ctx.designDocsRepository.listActors();
      expect(actors.map((a) => a.name).sort()).toEqual(["Approver", "Customer"]);
    });
  });

  test("indexing two design docs that share an actor name produces a single Actor node", async () => {
    await given("two design docs that both define a Customer actor", async () => {
      const a = writeDesignDocFile(
        ctx.projectDir,
        "billing-bbb.json",
        designDoc({
          id: "01928000-0000-7000-8000-aaaaaaaaaaaa",
          name: "billing",
          actors: [{ name: "Customer", description: "Billing customer." }],
        }),
      );
      const b = writeDesignDocFile(
        ctx.projectDir,
        "support-ccc.json",
        designDoc({
          id: "01928000-0000-7000-8000-bbbbbbbbbbbb",
          name: "support",
          actors: [{ name: "Customer", description: "Support customer." }],
        }),
      );
      await ctx.designDocs.indexFile(a);
      await ctx.designDocs.indexFile(b);
    });
    await then("the catalog still has exactly one Customer actor", async () => {
      const actors = await ctx.designDocsRepository.listActors();
      expect(actors.filter((a) => a.name === "Customer")).toHaveLength(1);
    });
  });

  test("editTopFields rejects a write to a locked name without confirmation", async () => {
    let thrown: Error | null = null;

    await given("a design doc whose name is locked", async () => {
      const file = designDoc({ name_locked: true });
      const path = writeDesignDocFile(ctx.projectDir, "billing-ddd.json", file);
      await ctx.designDocs.indexFile(path);
    });
    await when("an unconfirmed update tries to rename the doc", async () => {
      try {
        await ctx.designDocs.editTopFields(
          "01928000-0000-7000-8000-000000000001",
          { name: "Different" },
          false,
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service refuses the write", () => {
      expect(thrown?.message).toContain("locked");
    });
  });

  test("markImplemented seals the file and DB so subsequent edits are rejected", async () => {
    let path = "";

    await given("an indexed design doc", async () => {
      path = writeDesignDocFile(
        ctx.projectDir,
        "billing-eee.json",
        designDoc(),
      );
      await ctx.designDocs.indexFile(path);
    });
    await when("the service marks the doc as implemented", async () => {
      await ctx.designDocs.markImplemented(
        "01928000-0000-7000-8000-000000000001",
      );
    });
    await then("the file's implemented flag is true", () => {
      const file = DesignDocFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.implemented).toBe(true);
    });
    await and("the DB's implemented flag is true", async () => {
      const flag = await ctx.designDocsRepository.readImplementedFlag(
        "01928000-0000-7000-8000-000000000001",
      );
      expect(flag).toBe(true);
    });
    await and("further edits are rejected", async () => {
      let thrown: Error | null = null;
      try {
        await ctx.designDocs.editTopFields(
          "01928000-0000-7000-8000-000000000001",
          { description: "Anything" },
          true,
        );
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown?.message).toContain("implemented");
    });
  });

  test("deleteForFile removes the design doc and prunes orphan actors", async () => {
    let path = "";

    await given("an indexed design doc with one unique actor", async () => {
      path = writeDesignDocFile(
        ctx.projectDir,
        "billing-fff.json",
        designDoc({ actors: [{ name: "OnlyActor", description: "x." }] }),
      );
      await ctx.designDocs.indexFile(path);
    });
    await when("the file is removed and deleteForFile is called", async () => {
      const result = await ctx.designDocs.deleteForFile(path);
      expect(result?.design_doc_id).toBe(
        "01928000-0000-7000-8000-000000000001",
      );
    });
    await then("the design doc no longer exists in DB", async () => {
      expect(
        await ctx.designDocsRepository.exists(
          "01928000-0000-7000-8000-000000000001",
        ),
      ).toBe(false);
    });
    await and("the orphan Actor was pruned", async () => {
      const actors = await ctx.designDocsRepository.listActors();
      expect(actors.find((a) => a.name === "OnlyActor")).toBeUndefined();
    });
  });

  test("removing an actor from one of two docs keeps the actor when the other doc still references it", async () => {
    let pathA = "";
    let pathB = "";

    await given("two design docs that both reference Customer", async () => {
      pathA = writeDesignDocFile(
        ctx.projectDir,
        "billing-ggg.json",
        designDoc({
          id: "01928000-0000-7000-8000-aaaa00000001",
          name: "billing-shared",
          actors: [{ name: "Customer", description: "Shared." }],
        }),
      );
      pathB = writeDesignDocFile(
        ctx.projectDir,
        "support-hhh.json",
        designDoc({
          id: "01928000-0000-7000-8000-bbbb00000002",
          name: "support-shared",
          actors: [{ name: "Customer", description: "Shared." }],
        }),
      );
      await ctx.designDocs.indexFile(pathA);
      await ctx.designDocs.indexFile(pathB);
    });
    await when("design doc A is re-indexed without the Customer actor", async () => {
      const updated = designDoc({
        id: "01928000-0000-7000-8000-aaaa00000001",
        name: "billing-shared",
        actors: [],
      });
      writeDesignDocFile(ctx.projectDir, "billing-ggg.json", updated);
      await ctx.designDocs.indexFile(pathA);
    });
    await then("the Customer actor remains because design doc B still references it", async () => {
      const actors = await ctx.designDocsRepository.listActors();
      expect(actors.find((a) => a.name === "Customer")).toBeDefined();
    });

    void pathB;
  });
});
