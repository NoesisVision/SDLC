import "reflect-metadata";
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { documentMdPath } from "../../../../shared-contracts/source-files.js";
import {
  clearGraph,
  countNodes,
  countRels,
  createKnowledgeTestModule,
  type KnowledgeTestContext,
} from "../test-helpers.js";
import { DecisionsService } from "../decisions/decisions.service.js";
import { TopicsService } from "../topics/topics.service.js";
import { DocumentsService } from "./documents.service.js";

describe("DocumentsService", () => {
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

  describe("addDocumentFromFile", () => {
    test("creates a Document node", async () => {
      const path = join(ctx.tmpDir, "doc.json");
      await writeFile(
        path,
        JSON.stringify({
          id: "doc-1",
          title: "Spec",
          date: "2026-04-17",
          content: "hello",
        }),
      );
      const result = await documents.addDocumentFromFile(path);
      expect(result).toEqual({ id: "doc-1" });
      expect(await countNodes(ctx.db, "Document")).toBe(1);
    });

    test("fails when document id already exists", async () => {
      const path = join(ctx.tmpDir, "doc.json");
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
      await expect(documents.addDocumentFromFile(path)).rejects.toThrow(
        /already exists/,
      );
    });
  });

  describe("hasDocument", () => {
    test("returns true after insertion", async () => {
      expect(await documents.hasDocument("ghost")).toBe(false);
      const path = join(ctx.tmpDir, "doc-h.json");
      await writeFile(
        path,
        JSON.stringify({
          id: "doc-h",
          title: "T",
          date: "2026-04-24",
          content: "x",
        }),
      );
      await documents.addDocumentFromFile(path);
      expect(await documents.hasDocument("doc-h")).toBe(true);
    });
  });

  describe("mergeDocument", () => {
    test("inserts document, upserts topics, attaches fragments and decisions, applies attachments", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-merge-doc-"));
      try {
        const documentContent = "First paragraph.\n\nSecond paragraph.\n";

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
          decision: { text: "", rationale: "", supporting_item_indices: [] },
          alternative_options: [],
        });

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
        writeFileSync(sourceMd, "<!-- document_id: doc-merge-1 -->\n# Test\n");

        const result = await documents.mergeDocument(workingDir);
        expect(result).toMatchObject({
          document_id: "doc-merge-1",
          topics_added: 1,
          topics_updated: 0,
          decisions_added: 1,
          decision_attachments: 1,
        });
        expect(result.files_written).toBeGreaterThan(0);

        expect(await countNodes(ctx.db, "Document")).toBe(1);
        expect(await countNodes(ctx.db, "DocumentFragment")).toBe(2);
        expect(await countRels(ctx.db, "DOCUMENT_HAS_FRAGMENT")).toBe(2);
        expect(await countRels(ctx.db, "TOPIC_HAS_DOCUMENT_FRAGMENT")).toBe(2);
        expect(await countRels(ctx.db, "CONTEXT_SUPPORTED_BY_DOC_FRAGMENT")).toBe(1);
        expect(await countRels(ctx.db, "TOPIC_HAS_DECISION")).toBe(2);
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });
  });
});
