import "reflect-metadata";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraph,
  countNodes,
  countRels,
  createKnowledgeTestModule,
  type KnowledgeTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import { documentMdPath } from "@noesis/shared-contracts/source-files.js";
import { DecisionsService } from "@noesis/mcp/noesis-graph/knowledge/decisions/decisions.service.js";
import { DocumentsService } from "@noesis/mcp/noesis-graph/knowledge/documents/documents.service.js";
import { TopicsService } from "@noesis/mcp/noesis-graph/knowledge/topics/topics.service.js";

describe("DocumentsService — recording, merging, and reviewing design documents", () => {
  let ctx: KnowledgeTestContext;
  let documents: DocumentsService;
  let topics: TopicsService;
  let decisions: DecisionsService;

  beforeAll(async () => {
    ctx = await createKnowledgeTestModule();
    documents = ctx.module.get(DocumentsService);
    topics = ctx.module.get(TopicsService);
    decisions = ctx.module.get(DecisionsService);
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraph(ctx.db);
  });

  test("loading a document file persists it as a Document node", async () => {
    let path: string;
    let result: Awaited<ReturnType<DocumentsService["addDocumentFromFile"]>>;

    await given("a document JSON file describing a fresh design draft", async () => {
      path = join(ctx.tmpDir, "doc.json");
      await writeFile(
        path,
        JSON.stringify({
          id: "doc-1",
          title: "Spec",
          date: "2026-04-17",
          content: "hello",
        }),
      );
    });
    await when("the service ingests the file", async () => {
      result = await documents.addDocumentFromFile(path);
    });
    await then("the result echoes the document id", () => {
      expect(result).toEqual({ id: "doc-1" });
    });
    await and("a single Document node is recorded in the graph", async () => {
      expect(await countNodes(ctx.db, "Document")).toBe(1);
    });
  });

  test("re-adding a document with the same id is rejected", async () => {
    let path: string;
    let thrown: Error | null = null;

    await given(
      "a document that has already been recorded in the graph",
      async () => {
        path = join(ctx.tmpDir, "doc-dup.json");
        await writeFile(
          path,
          JSON.stringify({
            id: "doc-dup",
            title: "Spec",
            date: "2026-04-17",
            content: "hello",
          }),
        );
        await documents.addDocumentFromFile(path);
      },
    );
    await when("the same document is offered for ingestion a second time", async () => {
      try {
        await documents.addDocumentFromFile(path);
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service refuses with an explicit duplication error", () => {
      expect(thrown?.message).toMatch(/already exists/);
    });
  });

  test("hasDocument flips from false to true when the document is ingested", async () => {
    let path: string;
    let beforeFlag: boolean;
    let afterFlag: boolean;

    await given(
      "an empty graph and a document file ready on disk",
      async () => {
        path = join(ctx.tmpDir, "doc-h.json");
        await writeFile(
          path,
          JSON.stringify({
            id: "doc-h",
            title: "T",
            date: "2026-04-24",
            content: "x",
          }),
        );
      },
    );
    await when("the caller queries presence, ingests the document, and queries again", async () => {
      beforeFlag = await documents.hasDocument("doc-h");
      await documents.addDocumentFromFile(path);
      afterFlag = await documents.hasDocument("doc-h");
    });
    await then("the flag is false before the insert and true afterwards", () => {
      expect(beforeFlag).toBe(false);
      expect(afterFlag).toBe(true);
    });
  });

  test("getDocumentDetail rejects requests for an unknown document", async () => {
    let thrown: Error | null = null;

    await given("an empty graph", () => {});
    await when(
      "the consumer asks for a non-existent document's detail",
      async () => {
        try {
          await documents.getDocumentDetail("ghost");
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then("the request fails with a not-found error", () => {
      expect(thrown?.message).toMatch(/Document not found/);
    });
  });

  test(
    "merging an analyze-design-draft output upserts topics, attaches fragments, " +
      "and applies decision attachments to existing decisions",
    async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-merge-doc-"));
      let result: Awaited<ReturnType<DocumentsService["mergeDocument"]>>;

      try {
        await given(
          "a graph with one existing topic and decision plus a complete output bundle",
          async () => {
            await topics.addTopic({
              id: "existing-topic",
              title: "Existing",
              short_summary: "",
            });
            await decisions.addDecision("existing-topic", {
              id: "existing-dec-1",
              title: "Existing decision",
              status: "accepted",
              referenced_items: [],
              context: { text: "", supporting_item_indices: [] },
              decision: {
                text: "",
                rationale: "",
                supporting_item_indices: [],
              },
              alternative_options: [],
            });

            const documentContent = "First paragraph.\n\nSecond paragraph.\n";
            const output = {
              document: {
                id: "doc-merge-1",
                title: "Doc",
                date: "2026-04-24",
                content: documentContent,
              },
              fragments: [
                {
                  index: 0,
                  start_offset: 0,
                  end_offset: 16,
                  section_path: [],
                  kind: "paragraph",
                  text: "First paragraph.",
                  categories: ["Information"],
                },
                {
                  index: 1,
                  start_offset: 18,
                  end_offset: 35,
                  section_path: [],
                  kind: "paragraph",
                  text: "Second paragraph.",
                  categories: ["Decision"],
                },
              ],
              section_tree: [],
              topics: [
                {
                  id: "new-topic-1",
                  title: "Fresh",
                  short_summary: "s",
                  long_summary: "l",
                  items: [
                    {
                      type: "document_fragment_ref",
                      document_id: "doc-merge-1",
                      start_offset: 0,
                      end_offset: 16,
                    },
                    {
                      type: "document_fragment_ref",
                      document_id: "doc-merge-1",
                      start_offset: 18,
                      end_offset: 35,
                    },
                  ],
                  decisions: [
                    {
                      id: "new-dec-1",
                      title: "New decision",
                      status: "accepted",
                      referenced_items: [],
                      context: { text: "ctx", supporting_item_indices: [] },
                      decision: {
                        text: "do it",
                        rationale: "because",
                        supporting_item_indices: [],
                      },
                      alternative_options: [],
                    },
                  ],
                  reviewed: true,
                  decisions_extracted: true,
                },
              ],
              decision_attachments: [
                {
                  decision_id: "existing-dec-1",
                  slot: "context",
                  alternative_index: null,
                  fragment_indices: [0],
                },
              ],
              potential_topics: {
                topics: [
                  {
                    id: "new-topic-1",
                    title: "Fresh",
                    short_summary: "s",
                    path: ["Fresh"],
                    is_new: true,
                    parent_id: null,
                  },
                ],
              },
              design_doc_id: null,
              design_doc_title: null,
              design_doc_extracted: false,
            };
            await writeFile(
              join(workingDir, "output.json"),
              JSON.stringify(output),
            );
            const sourceMd = documentMdPath(ctx.tmpDir, "doc-merge-1");
            mkdirSync(dirname(sourceMd), { recursive: true });
            writeFileSync(sourceMd, "<!-- document_id: doc-merge-1 -->\n# T\n");
          },
        );
        await when("the service merges the output bundle", async () => {
          result = await documents.mergeDocument(workingDir);
        });
        await then(
          "the report counts one new topic, one new decision, and one attachment",
          () => {
            expect(result).toMatchObject({
              document_id: "doc-merge-1",
              topics_added: 1,
              topics_updated: 0,
              decisions_added: 1,
              decision_attachments: 1,
            });
            expect(result.files_written).toBeGreaterThan(0);
          },
        );
        await and(
          "the graph now contains the document, both fragments, and the new links",
          async () => {
            expect(await countNodes(ctx.db, "Document")).toBe(1);
            expect(await countNodes(ctx.db, "DocumentFragment")).toBe(2);
            expect(await countRels(ctx.db, "DOCUMENT_HAS_FRAGMENT")).toBe(2);
            expect(await countRels(ctx.db, "TOPIC_HAS_DOCUMENT_FRAGMENT")).toBe(
              2,
            );
            expect(
              await countRels(ctx.db, "CONTEXT_SUPPORTED_BY_DOC_FRAGMENT"),
            ).toBe(1);
            expect(await countRels(ctx.db, "TOPIC_HAS_DECISION")).toBe(2);
          },
        );
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    },
  );

  test(
    "getTopicForDocumentReview returns the next unreviewed topic with its fragment markdown",
    async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-doc-review-"));
      let result: Awaited<ReturnType<DocumentsService["getTopicForDocumentReview"]>>;

      try {
        await given(
          "an analyze-design-draft output with one reviewed topic followed by one unreviewed topic",
          async () => {
            const output = {
              document: {
                id: "doc-rev",
                title: "Spec",
                date: "2026-04-24",
                content: "alpha bravo charlie",
              },
              fragments: [
                {
                  index: 0,
                  start_offset: 0,
                  end_offset: 5,
                  section_path: [],
                  kind: "paragraph",
                  text: "alpha",
                  categories: ["Information"],
                },
              ],
              section_tree: [],
              topics: [
                {
                  id: "done",
                  title: "Already reviewed",
                  short_summary: "",
                  long_summary: "",
                  items: [],
                  decisions: [],
                  reviewed: true,
                  decisions_extracted: true,
                },
                {
                  id: "todo",
                  title: "Up next",
                  short_summary: "s",
                  long_summary: "l",
                  items: [
                    {
                      type: "document_fragment_ref",
                      document_id: "doc-rev",
                      start_offset: 0,
                      end_offset: 5,
                    },
                  ],
                  decisions: [],
                  reviewed: false,
                  decisions_extracted: false,
                },
              ],
              decision_attachments: [],
              potential_topics: { topics: [] },
              design_doc_id: null,
              design_doc_title: null,
              design_doc_extracted: false,
            };
            await writeFile(
              join(workingDir, "output.json"),
              JSON.stringify(output),
            );
          },
        );
        await when("the agent asks for the next topic to review", async () => {
          result = await documents.getTopicForDocumentReview(
            join(workingDir, "output.json"),
          );
        });
        await then(
          "the response identifies the unreviewed topic and reports one fragment to inspect",
          () => {
            expect(result).not.toBeNull();
            expect(result!.topic_id).toBe("todo");
            expect(result!.topic_title).toBe("Up next");
            expect(result!.num_items).toBe(1);
          },
        );
        await and("the rendered markdown contains the fragment text", () => {
          expect(result!.markdown).toContain("alpha");
        });
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    },
  );

  test("getTopicForDocumentReview returns null once every topic is marked reviewed", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "noesis-doc-review-done-"));
    let result: Awaited<ReturnType<DocumentsService["getTopicForDocumentReview"]>>;

    try {
      await given(
        "an analyze-design-draft output where every topic carries reviewed=true",
        async () => {
          const output = {
            document: {
              id: "doc-done",
              title: "Spec",
              date: "2026-04-24",
              content: "x",
            },
            fragments: [],
            section_tree: [],
            topics: [
              {
                id: "t-1",
                title: "T1",
                short_summary: "",
                long_summary: "",
                items: [],
                decisions: [],
                reviewed: true,
                decisions_extracted: true,
              },
            ],
            decision_attachments: [],
            potential_topics: { topics: [] },
            design_doc_id: null,
            design_doc_title: null,
            design_doc_extracted: false,
          };
          await writeFile(
            join(workingDir, "output.json"),
            JSON.stringify(output),
          );
        },
      );
      await when("the agent asks for the next topic to review", async () => {
        result = await documents.getTopicForDocumentReview(
          join(workingDir, "output.json"),
        );
      });
      await then("the response is null so the agent can move past the review loop", () => {
        expect(result).toBeNull();
      });
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
