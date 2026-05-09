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
} from "@tests/helpers/knowledge-test-context.js";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
} from "@noesis/shared-contracts/design-doc-new.js";
import { designDocCanonicalPath } from "@noesis/shared-contracts/source-files.js";
import { DesignDocImplementedError } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.service.js";

describe("DesignDocsService — page, detail, deletion, actors, element edits", () => {
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

  test("The design-docs page lists every indexed doc with its bounded-context count and edited flag", async () => {
    let page: Awaited<ReturnType<typeof ctx.designDocs.getDesignDocsPage>> | null = null;

    await given(
      "two indexed design docs, one with a locked field, one without",
      async () => {
        await indexDesignDoc(
          ctx,
          file({ id: "dd-locked", name: "Locked", description_locked: true }),
        );
        await indexDesignDoc(ctx, file({ id: "dd-open", name: "Open" }));
      },
    );
    await when("requesting the design-docs page", async () => {
      page = await ctx.designDocs.getDesignDocsPage();
    });
    await then("both docs appear and only the locked one is flagged as edited", () => {
      const byId = new Map(page!.docs.map((d) => [d.id, d]));
      expect(byId.get("dd-locked")?.edited_by_user).toBe(true);
      expect(byId.get("dd-open")?.edited_by_user).toBe(false);
    });
  });

  test("Reading the design-doc detail returns the on-disk source tree projected to the UI shape", async () => {
    let detail: Awaited<
      ReturnType<typeof ctx.designDocs.getDesignDocDetail>
    > | null = null;

    await given("a design doc with one bounded context 'Auth'", async () => {
      await indexDesignDoc(
        ctx,
        file({
          id: "dd-1",
          name: "Vision",
          description: "Vision desc",
          boundedContexts: {
            added: [
              {
                name: "Auth",
                name_locked: false,
                description: "auth desc",
                description_locked: false,
              },
            ],
            modified: [],
            removed: [],
          },
        }),
      );
    });
    await when("requesting the design-doc detail", async () => {
      detail = await ctx.designDocs.getDesignDocDetail("dd-1");
    });
    await then("the source tree is included with bounded contexts", () => {
      expect(detail?.id).toBe("dd-1");
      expect(detail?.name).toBe("Vision");
      expect(detail?.source.boundedContexts?.added[0].name).toBe("Auth");
    });
  });

  test("Listing design docs returns one overview per indexed doc with its bounded-context count", async () => {
    await indexDesignDoc(
      ctx,
      file({
        id: "dd-1",
        name: "Charter",
        boundedContexts: {
          added: [
            { name: "BC1", name_locked: false, description: "", description_locked: false },
            { name: "BC2", name_locked: false, description: "", description_locked: false },
          ],
          modified: [],
          removed: [],
        },
      }),
    );
    const overviews = await ctx.designDocs.listDesignDocs();
    expect(overviews).toHaveLength(1);
    expect(overviews[0].bounded_context_count).toBe(2);
  });

  test("Reading the bounded-context map projects every BC across docs with their modules", async () => {
    let entries: Awaited<
      ReturnType<typeof ctx.designDocs.readBoundedContextMap>
    > | null = null;

    await given(
      "a design doc with one BC 'Auth' that owns two modules 'Login' and 'Signup'",
      async () => {
        await indexDesignDoc(
          ctx,
          file({
            id: "dd-1",
            name: "Vision",
            boundedContexts: {
              added: [
                {
                  name: "Auth",
                  name_locked: false,
                  description: "auth",
                  description_locked: false,
                  modules: {
                    added: [
                      {
                        name: "Login",
                        name_locked: false,
                        description: "login mod",
                        description_locked: false,
                      },
                      {
                        name: "Signup",
                        name_locked: false,
                        description: "signup mod",
                        description_locked: false,
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
          }),
        );
      },
    );
    await when("reading the bounded-context map", async () => {
      entries = await ctx.designDocs.readBoundedContextMap();
    });
    await then("the BC entry exposes both modules in declaration order", () => {
      expect(entries).toHaveLength(1);
      expect(entries?.[0].modules.map((m) => m.name)).toEqual(["Login", "Signup"]);
    });
  });

  test("Reading the model for a target restricted to a module returns only that module", async () => {
    let contexts: Awaited<
      ReturnType<typeof ctx.designDocs.readModelForTargets>
    > | null = null;

    await given(
      "a design doc with two modules 'Keep' and 'Drop' under bounded context 'Auth'",
      async () => {
        await indexDesignDoc(
          ctx,
          file({
            id: "dd-1",
            name: "Vision",
            boundedContexts: {
              added: [
                {
                  name: "Auth",
                  name_locked: false,
                  description: "",
                  description_locked: false,
                  modules: {
                    added: [
                      {
                        name: "Keep",
                        name_locked: false,
                        description: "",
                        description_locked: false,
                      },
                      {
                        name: "Drop",
                        name_locked: false,
                        description: "",
                        description_locked: false,
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
          }),
        );
      },
    );
    await when("reading the model narrowed to module 'Keep'", async () => {
      contexts = await ctx.designDocs.readModelForTargets([
        {
          design_doc_id: "dd-1",
          bounded_context_name: "Auth",
          module_name: "Keep",
        },
      ]);
    });
    await then("only the 'Keep' module is included in the projected BC", () => {
      expect(contexts?.[0].modules?.added.map((m) => m.name)).toEqual(["Keep"]);
    });
  });

  test("Deleting a design doc by id removes it from DB and disk", async () => {
    await indexDesignDoc(ctx, file({ id: "dd-1", name: "Vision" }));
    expect(await ctx.designDocsRepository.exists("dd-1")).toBe(true);
    await ctx.designDocs.deleteDesignDoc("dd-1");
    expect(await ctx.designDocsRepository.exists("dd-1")).toBe(false);
  });

  test("Upserting an actor stores the actor row in DB and listActors returns it", async () => {
    await ctx.designDocs.upsertActor({
      name: "Customer",
      description: "Pays for service.",
    });
    const actors = await ctx.designDocs.listActors();
    expect(actors.find((a) => a.name === "Customer")?.description).toBe(
      "Pays for service.",
    );
  });

  test("Upserting an actor with a blank name is rejected", async () => {
    let thrown: Error | null = null;
    try {
      await ctx.designDocs.upsertActor({ name: "   ", description: null });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain("must not be empty");
  });

  test("updateElement edits the targeted element's description on disk and sets its lock", async () => {
    await indexDesignDoc(
      ctx,
      file({
        id: "dd-1",
        name: "Vision",
        boundedContexts: {
          added: [
            {
              name: "Auth",
              name_locked: false,
              description: "old auth",
              description_locked: false,
            },
          ],
          modified: [],
          removed: [],
        },
      }),
    );
    const path = designDocCanonicalPath(ctx.projectDir, "dd-1", "Vision");

    await ctx.designDocs.updateElement(
      "dd-1",
      [{ kind: "boundedContext", name: "Auth" }],
      { description: "new auth" },
    );

    const updated = DesignDocFileNewSchema.parse(
      JSON.parse(readFileSync(path, "utf-8")),
    );
    const bc = updated.boundedContexts?.added[0];
    expect(bc?.description).toBe("new auth");
    expect(bc?.description_locked).toBe(true);
  });

  test("updateElement refuses to edit a doc that has been marked implemented", async () => {
    await indexDesignDoc(
      ctx,
      file({
        id: "dd-1",
        name: "Vision",
        implemented: true,
        boundedContexts: {
          added: [
            { name: "Auth", name_locked: false, description: "", description_locked: false },
          ],
          modified: [],
          removed: [],
        },
      }),
    );
    let thrown: Error | null = null;
    try {
      await ctx.designDocs.updateElement(
        "dd-1",
        [{ kind: "boundedContext", name: "Auth" }],
        { description: "new auth" },
      );
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(DesignDocImplementedError);
  });
});

function file(overrides: Partial<DesignDocFileNew> = {}): DesignDocFileNew {
  return DesignDocFileNewSchema.parse({
    id: "dd-1",
    name: "Vision",
    name_locked: false,
    description: "A vision doc.",
    description_locked: false,
    actors: [],
    boundedContexts: { added: [], modified: [], removed: [] },
    implemented: false,
    ...overrides,
  });
}

async function indexDesignDoc(
  ctx: KnowledgeNewTestContext,
  ddFile: DesignDocFileNew,
): Promise<void> {
  const path = designDocCanonicalPath(ctx.projectDir, ddFile.id, ddFile.name);
  mkdirSync(join(ctx.projectDir, "noesis", "design-docs"), { recursive: true });
  writeFileSync(path, JSON.stringify(ddFile, null, 2));
  await ctx.designDocs.indexFile(path);
}
