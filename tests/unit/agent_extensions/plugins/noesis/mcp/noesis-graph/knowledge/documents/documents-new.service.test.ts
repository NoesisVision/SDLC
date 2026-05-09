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

  test("merge writes document, topic and decision to canonical paths", async () => {
    let outputJsonPath = "";

    await given("a working dir with a valid analyze-design-draft output.json", () => {
      mkdirSync(workingDir, { recursive: true });
      outputJsonPath = join(workingDir, "output.json");
      writeFileSync(outputJsonPath, JSON.stringify(makeOutput(), null, 2));
    });

    await when("the documents service merges the output", async () => {
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
    await then("the document json is at noesis/documents/<id>.json", () => {
      const file = DocumentFileNewSchema.parse(
        JSON.parse(
          readFileSync(documentJsonPath(ctx.projectDir, "doc-1"), "utf-8"),
        ),
      );
      expect(file.title).toBe("Design Draft");
      expect(file.fragments).toHaveLength(2);
    });
    await and("the topic and decision files exist with source_sha set", () => {
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

  test("merge appends decision_attachments to an existing decision file", async () => {
    let outputJsonPath = "";

    await given("an existing decision file referencing one fragment", async () => {
      // Seed by running merge once to produce decision file.
      mkdirSync(workingDir, { recursive: true });
      outputJsonPath = join(workingDir, "output.json");
      writeFileSync(outputJsonPath, JSON.stringify(makeOutput(), null, 2));
      await ctx.documents.merge({ outputJsonPath, designDocJsonPath: null });
    });
    await when("a second merge supplies a decision_attachments entry", async () => {
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
    await then("the original decision file gained an additional referenced_item", () => {
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

  test("merge persists the design doc to its canonical path when designDocJsonPath is supplied", async () => {
    let outputJsonPath = "";
    let designDocWorkingPath = "";

    await given("a working dir with output.json and a separate design-doc JSON", () => {
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
    await when("merge is invoked with both paths", async () => {
      const result = await ctx.documents.merge({
        outputJsonPath,
        designDocJsonPath: designDocWorkingPath,
      });
      expect(result.design_doc_path).not.toBeNull();
      expect(result.design_doc_path).toContain("/noesis/design-docs/billing-");
    });
    await then("the design doc lands at the canonical noesis/design-docs/<slug>-<suffix>.json path", () => {
      const dir = join(ctx.projectDir, "noesis", "design-docs");
      const entries = readdirSync(dir).filter((e) => e.endsWith(".json"));
      expect(entries).toHaveLength(1);
      const parsed = DesignDocFileNewSchema.parse(
        JSON.parse(readFileSync(join(dir, entries[0]), "utf-8")),
      );
      expect(parsed.id).toBe("01928000-0000-7000-8000-aaaaaaaaaaaa");
    });
  });

  test("merge rejects when designDocJsonPath is supplied but design_doc_extracted is false", async () => {
    let thrown: Error | null = null;
    let outputJsonPath = "";
    let designDocWorkingPath = "";

    await given("a working dir whose output.json has design_doc_extracted=false", () => {
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
    await when("merge runs with the design-doc path", async () => {
      try {
        await ctx.documents.merge({
          outputJsonPath,
          designDocJsonPath: designDocWorkingPath,
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service rejects the merge with a validation error", () => {
      expect(thrown?.message).toContain("design_doc_extracted");
    });
  });

  test("indexFile projects a Document json into Document and DocumentFragment nodes", async () => {
    let outputJsonPath = "";

    await given("a merged document on disk", async () => {
      mkdirSync(workingDir, { recursive: true });
      outputJsonPath = join(workingDir, "output.json");
      writeFileSync(outputJsonPath, JSON.stringify(makeOutput(), null, 2));
      await ctx.documents.merge({ outputJsonPath, designDocJsonPath: null });
    });
    await when("the indexer projects the document file", async () => {
      const path = documentJsonPath(ctx.projectDir, "doc-1");
      const outcome = await ctx.documents.indexFile(path);
      expect(outcome.status).toBe("indexed");
    });
    await then("the Document row carries the title and date", async () => {
      const stored = await ctx.documentsRepository.read("doc-1");
      expect(stored?.title).toBe("Design Draft");
      expect(stored?.date).toBe("2026-04-17");
    });
  });
});
