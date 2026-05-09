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

describe("DesignDocsServiceNew — canonical paths, locks, sealing on implemented, actor lifecycle", () => {
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

  test("Preparing a design doc path mints a UUID and a canonical path when no id is supplied", async () => {
    const result = await ctx.designDocs.prepareDesignDocPath({ name: "auth" });
    expect(result.status).toBe("Ok");
    if (result.status !== "Ok") return;
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.canonical_path).toContain("/noesis/design-docs/auth-");
    expect(result.canonical_path).toMatch(/-[0-9a-f]{8}\.json$/);
  });

  test("Preparing a design doc path for an already-implemented doc is rejected as sealed", async () => {
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

  test("Persisting a renamed design doc writes the new canonical path and removes the previous file", async () => {
    let firstPath = "";
    let secondPath = "";

    await given("a design doc persisted under the name 'billing'", () => {
      firstPath = ctx.designDocs.persistFile(
        designDoc({ name: "billing" }),
      );
    });
    await when("the design doc is renamed to 'invoicing' and persisted again", () => {
      secondPath = ctx.designDocs.persistFile(
        designDoc({ name: "invoicing" }),
      );
    });
    await then("the new canonical path is distinct and reflects the new name", () => {
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

  test("Indexing a design doc inserts it and registers each declared actor in the catalog", async () => {
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
    await when("indexing the design doc", async () => {
      outcome = await ctx.designDocs.indexFile(path);
    });
    await then("the operation reports the design doc as indexed", () => {
      expect(outcome?.status).toBe("indexed");
    });
    await and("the actor catalog contains both declared names", async () => {
      const actors = await ctx.designDocsRepository.listActors();
      expect(actors.map((a) => a.name).sort()).toEqual(["Approver", "Customer"]);
    });
  });

  test("Two design docs declaring the same actor name share a single Actor node", async () => {
    await given("two design docs that both declare a Customer actor", async () => {
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

  test("Editing a locked design doc name without user confirmation is refused", async () => {
    let thrown: Error | null = null;

    await given("a design doc whose name is locked", async () => {
      const file = designDoc({ name_locked: true });
      const path = writeDesignDocFile(ctx.projectDir, "billing-ddd.json", file);
      await ctx.designDocs.indexFile(path);
    });
    await when("an edit tries to rename the design doc without confirmation", async () => {
      try {
        await ctx.designDocs.editTopFieldsAndLock(
          "01928000-0000-7000-8000-000000000001",
          { name: "Different" },
          false,
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service refuses with a lock violation", () => {
      expect(thrown?.message).toContain("locked");
    });
  });

  test("Marking a design doc as implemented seals it from further edits", async () => {
    let path = "";

    await given("an indexed design doc", async () => {
      path = writeDesignDocFile(
        ctx.projectDir,
        "billing-eee.json",
        designDoc(),
      );
      await ctx.designDocs.indexFile(path);
    });
    await when("the design doc is marked as implemented", async () => {
      await ctx.designDocs.markImplemented(
        "01928000-0000-7000-8000-000000000001",
      );
    });
    await then("the on-disk file records the implemented flag as true", () => {
      const file = DesignDocFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.implemented).toBe(true);
    });
    await and("the persisted record records the implemented flag as true", async () => {
      const flag = await ctx.designDocsRepository.readImplementedFlag(
        "01928000-0000-7000-8000-000000000001",
      );
      expect(flag).toBe(true);
    });
    await and("further edits to the sealed design doc are refused", async () => {
      let thrown: Error | null = null;
      try {
        await ctx.designDocs.editTopFieldsAndLock(
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

  test("Deleting a design doc removes the design doc and prunes actors that have no other references", async () => {
    let path = "";

    await given("an indexed design doc whose only actor is unique to it", async () => {
      path = writeDesignDocFile(
        ctx.projectDir,
        "billing-fff.json",
        designDoc({ actors: [{ name: "OnlyActor", description: "x." }] }),
      );
      await ctx.designDocs.indexFile(path);
    });
    await when("deletion is requested for the design doc's canonical path", async () => {
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
    await and("the orphan actor is pruned from the catalog", async () => {
      const actors = await ctx.designDocsRepository.listActors();
      expect(actors.find((a) => a.name === "OnlyActor")).toBeUndefined();
    });
  });

  test("Removing an actor from one design doc keeps the actor when another design doc still references it", async () => {
    let pathA = "";
    let pathB = "";

    await given("two design docs that both declare the same Customer actor", async () => {
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
    await when("the first design doc is re-indexed without the Customer actor", async () => {
      const updated = designDoc({
        id: "01928000-0000-7000-8000-aaaa00000001",
        name: "billing-shared",
        actors: [],
      });
      writeDesignDocFile(ctx.projectDir, "billing-ggg.json", updated);
      await ctx.designDocs.indexFile(pathA);
    });
    await then("the Customer actor is preserved because the second design doc still references it", async () => {
      const actors = await ctx.designDocsRepository.listActors();
      expect(actors.find((a) => a.name === "Customer")).toBeDefined();
    });

    void pathB;
  });
});

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
