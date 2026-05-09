import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-new-test-context.js";
import {
  DecisionFileNewSchema,
  DocumentFileNewSchema,
  TopicFileNewSchema,
  type DecisionFileNew,
} from "@noesis/shared-contracts/source-file-schemas-new.js";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
} from "@noesis/shared-contracts/design-doc-new.js";
import {
  decisionJsonPath,
  documentJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("DocumentsServiceNew — accept skill output, validate, split, save", () => {
  let ctx: KnowledgeNewTestContext;
  let workingDir: string;

  beforeAll(async () => {
    ctx = await createKnowledgeNewTestModule();
    workingDir = join(ctx.projectDir, "doc-working");
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.projectDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraphNew(ctx.db);
    rmSync(workingDir, { recursive: true, force: true });
    rmSync(join(ctx.projectDir, "noesis"), { recursive: true, force: true });
  });

  test("Merging an analyze-design-draft output writes the document, topic and decision to canonical paths", async () => {
    let outputJsonPath = "";

    await given("a working dir with a valid analyze-design-draft output", () => {
      mkdirSync(workingDir, { recursive: true });
      outputJsonPath = join(workingDir, "output.json");
      writeFileSync(outputJsonPath, JSON.stringify(makeOutput(), null, 2));
    });

    await when("the skill output is merged without an extracted design doc", async () => {
      const result = await ctx.documents.merge({
        outputJsonPath,
        designDocJsonPath: null,
      });
      expect(result.document_id).toBe("doc-1");
      expect(result.topic_paths).toHaveLength(1);
      expect(result.decision_paths).toHaveLength(1);
      expect(result.decision_attachments).toBe(0);
      expect(result.design_doc_path).toBeNull();
    });
    await then("the document file lands at noesis/documents/<id>.json with all fragments", () => {
      const file = DocumentFileNewSchema.parse(
        JSON.parse(
          readFileSync(documentJsonPath(ctx.projectDir, "doc-1"), "utf-8"),
        ),
      );
      expect(file.title).toBe("Design Draft");
      expect(file.fragments).toHaveLength(2);
    });
    await and("the topic and decision files exist with source sha set on each reference", () => {
      const t = TopicFileNewSchema.parse(
        JSON.parse(
          readFileSync(topicJsonPath(ctx.projectDir, "doc-topic-1"), "utf-8"),
        ),
      );
      expect(t.items[0].source_sha).toBeDefined();
      const d = DecisionFileNewSchema.parse(
        JSON.parse(
          readFileSync(
            decisionJsonPath(ctx.projectDir, "doc-decision-1"),
            "utf-8",
          ),
        ),
      );
      expect(d.referenced_items[0].source_sha).toBeDefined();
    });
  });

  test("Merging a follow-up document attaches its fragments to a previously merged decision", async () => {
    let outputJsonPath = "";

    await given("an existing decision file referencing one fragment", async () => {
      mkdirSync(workingDir, { recursive: true });
      outputJsonPath = join(workingDir, "output.json");
      writeFileSync(outputJsonPath, JSON.stringify(makeOutput(), null, 2));
      await ctx.documents.merge({ outputJsonPath, designDocJsonPath: null });
    });
    await when("a second document is merged with an attachment to the prior decision", async () => {
      const second = makeOutput({
        documentId: "doc-2",
        topicId: "doc-topic-2",
        decisionId: "doc-decision-2",
        attachToDecisionId: "doc-decision-1",
      });
      writeFileSync(outputJsonPath, JSON.stringify(second, null, 2));
      const result = await ctx.documents.merge({
        outputJsonPath,
        designDocJsonPath: null,
      });
      expect(result.decision_attachments).toBe(1);
    });
    await then("the prior decision now references a fragment from the new document", () => {
      const decision = DecisionFileNewSchema.parse(
        JSON.parse(
          readFileSync(
            decisionJsonPath(ctx.projectDir, "doc-decision-1"),
            "utf-8",
          ),
        ),
      ) as DecisionFileNew;
      expect(decision.referenced_items.length).toBeGreaterThanOrEqual(2);
      expect(
        decision.referenced_items.some((i) => i.type === "document_fragment_ref"),
      ).toBe(true);
    });
  });

  test("Merging an extracted design doc persists it under the canonical noesis/design-docs path", async () => {
    let outputJsonPath = "";
    let designDocWorkingPath = "";

    await given("a working dir with a document output and a separate extracted design-doc payload", () => {
      mkdirSync(workingDir, { recursive: true });
      outputJsonPath = join(workingDir, "output.json");
      designDocWorkingPath = join(workingDir, "design-doc.json");
      writeFileSync(
        outputJsonPath,
        JSON.stringify(
          makeOutput({
            designDocExtracted: true,
            designDocId: "01928000-0000-7000-8000-aaaaaaaaaaaa",
          }),
          null,
          2,
        ),
      );
      writeFileSync(
        designDocWorkingPath,
        JSON.stringify(
          makeDesignDocFile(
            "01928000-0000-7000-8000-aaaaaaaaaaaa",
            "billing",
          ),
          null,
          2,
        ),
      );
    });
    await when("the document and design doc are merged together", async () => {
      const result = await ctx.documents.merge({
        outputJsonPath,
        designDocJsonPath: designDocWorkingPath,
      });
      expect(result.design_doc_path).not.toBeNull();
      expect(result.design_doc_path).toContain("/noesis/design-docs/billing-");
    });
    await then("the design doc lands at noesis/design-docs/<slug>-<suffix>.json", () => {
      const dir = join(ctx.projectDir, "noesis", "design-docs");
      const entries = readdirSync(dir).filter((e) => e.endsWith(".json"));
      expect(entries).toHaveLength(1);
      const parsed = DesignDocFileNewSchema.parse(
        JSON.parse(readFileSync(join(dir, entries[0]), "utf-8")),
      );
      expect(parsed.id).toBe("01928000-0000-7000-8000-aaaaaaaaaaaa");
    });
  });

  test("Merging rejects an extracted design doc payload when the skill did not flag it as extracted", async () => {
    let thrown: Error | null = null;
    let outputJsonPath = "";
    let designDocWorkingPath = "";

    await given("a working dir whose output disclaims design doc extraction", () => {
      mkdirSync(workingDir, { recursive: true });
      outputJsonPath = join(workingDir, "output.json");
      designDocWorkingPath = join(workingDir, "design-doc.json");
      writeFileSync(
        outputJsonPath,
        JSON.stringify(
          makeOutput({ designDocExtracted: false, designDocId: "x" }),
          null,
          2,
        ),
      );
      writeFileSync(
        designDocWorkingPath,
        JSON.stringify(
          makeDesignDocFile(
            "01928000-0000-7000-8000-bbbbbbbbbbbb",
            "billing",
          ),
          null,
          2,
        ),
      );
    });
    await when("the merge is attempted with both paths", async () => {
      try {
        await ctx.documents.merge({
          outputJsonPath,
          designDocJsonPath: designDocWorkingPath,
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the merge is rejected with a message about the design-doc-extracted contradiction", () => {
      expect(thrown?.message).toContain("design_doc_extracted");
    });
  });

  test("Indexing a document file projects it into Document and DocumentFragment nodes", async () => {
    let outputJsonPath = "";

    await given("a merged document on disk", async () => {
      mkdirSync(workingDir, { recursive: true });
      outputJsonPath = join(workingDir, "output.json");
      writeFileSync(outputJsonPath, JSON.stringify(makeOutput(), null, 2));
      await ctx.documents.merge({ outputJsonPath, designDocJsonPath: null });
    });
    await when("indexing the document file", async () => {
      const path = documentJsonPath(ctx.projectDir, "doc-1");
      const outcome = await ctx.documents.indexFile(path);
      expect(outcome.status).toBe("indexed");
    });
    await then("the persisted Document carries the file's title and date", async () => {
      const stored = await ctx.documentsRepository.read("doc-1");
      expect(stored?.title).toBe("Design Draft");
      expect(stored?.date).toBe("2026-04-17");
    });
  });

  test("Indexing the same document file twice without disk changes is a no-op", async () => {
    let path = "";
    let secondOutcome: { status: string } | null = null;

    await given("a merged document indexed once", async () => {
      mkdirSync(workingDir, { recursive: true });
      const outputJsonPath = join(workingDir, "output.json");
      writeFileSync(outputJsonPath, JSON.stringify(makeOutput(), null, 2));
      await ctx.documents.merge({ outputJsonPath, designDocJsonPath: null });
      path = documentJsonPath(ctx.projectDir, "doc-1");
      await ctx.documents.indexFile(path);
    });
    await when("indexing the file a second time without any disk changes", async () => {
      secondOutcome = await ctx.documents.indexFile(path);
    });
    await then("the operation reports the document as unchanged", () => {
      expect(secondOutcome?.status).toBe("unchanged");
    });
  });

  test("Deleting a document by its canonical file path removes the corresponding row from DB", async () => {
    let path = "";

    await given("a merged and indexed document on disk", async () => {
      mkdirSync(workingDir, { recursive: true });
      const outputJsonPath = join(workingDir, "output.json");
      writeFileSync(outputJsonPath, JSON.stringify(makeOutput(), null, 2));
      await ctx.documents.merge({ outputJsonPath, designDocJsonPath: null });
      path = documentJsonPath(ctx.projectDir, "doc-1");
      await ctx.documents.indexFile(path);
    });
    await when("deletion is requested for the document's canonical path", async () => {
      const result = await ctx.documents.deleteForFile(path);
      expect(result?.document_id).toBe("doc-1");
    });
    await then("the document no longer exists in DB", async () => {
      expect(await ctx.documentsRepository.exists("doc-1")).toBe(false);
    });
  });
});

interface SkillOutputBuilder {
  documentId?: string;
  topicId?: string;
  decisionId?: string;
  topicTitle?: string;
  attachToDecisionId?: string | null;
  designDocExtracted?: boolean;
  designDocId?: string | null;
}

function makeOutput(b: SkillOutputBuilder = {}): unknown {
  const documentId = b.documentId ?? "doc-1";
  const topicId = b.topicId ?? "doc-topic-1";
  const decisionId = b.decisionId ?? "doc-decision-1";
  const fragments = [
    {
      index: 0,
      start_offset: 0,
      end_offset: 25,
      section_path: ["Intro"],
      kind: "paragraph",
      text: "Some intro paragraph here.",
      categories: ["Information"],
    },
    {
      index: 1,
      start_offset: 25,
      end_offset: 60,
      section_path: ["Decision"],
      kind: "paragraph",
      text: "We decided to ship feature X soon.",
      categories: ["Decision"],
    },
  ];
  return {
    document: {
      id: documentId,
      title: "Design Draft",
      date: "2026-04-17",
      content: "Some intro paragraph here.We decided to ship feature X soon.",
    },
    fragments,
    section_tree: [
      {
        level: 1,
        title: "Doc",
        path: [],
        fragment_indices: [0, 1],
        children: [],
      },
    ],
    topics: [
      {
        id: topicId,
        title: b.topicTitle ?? "Feature X",
        short_summary: "Decision on feature X.",
        long_summary: "We chose to ship feature X based on the draft.",
        items: [
          {
            type: "document_fragment_ref",
            document_id: documentId,
            start_offset: 25,
            end_offset: 60,
          },
        ],
        decisions: [
          {
            id: decisionId,
            title: "Ship feature X",
            status: "accepted",
            referenced_items: [
              {
                type: "document_fragment_ref",
                document_id: documentId,
                start_offset: 25,
                end_offset: 60,
              },
            ],
            context: {
              text: "Need feature X.",
              supporting_item_indices: [0],
            },
            decision: {
              text: "Ship feature X.",
              rationale: "Customer demand.",
              supporting_item_indices: [0],
            },
            alternative_options: [],
          },
        ],
        reviewed: true,
        decisions_extracted: true,
      },
    ],
    decision_attachments:
      b.attachToDecisionId === undefined
        ? []
        : b.attachToDecisionId === null
          ? []
          : [
              {
                decision_id: b.attachToDecisionId,
                slot: "context",
                alternative_index: null,
                fragment_indices: [0],
              },
            ],
    potential_topics: {
      topics: [
        {
          id: topicId,
          title: b.topicTitle ?? "Feature X",
          short_summary: "Decision on feature X.",
          path: ["Feature X"],
          is_new: true,
          parent_id: null,
        },
      ],
    },
    design_doc_id: b.designDocId ?? null,
    design_doc_title: null,
    design_doc_extracted: b.designDocExtracted ?? false,
  };
}

function makeDesignDocFile(id: string, name: string): DesignDocFileNew {
  return DesignDocFileNewSchema.parse({
    id,
    name,
    description: "Created via analyze-design-draft.",
    actors: [],
    boundedContexts: { added: [], removed: [], modified: [] },
    implemented: false,
  });
}
