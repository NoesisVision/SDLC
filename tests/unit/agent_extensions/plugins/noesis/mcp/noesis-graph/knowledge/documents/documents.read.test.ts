import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import {
  DecisionFileSchema,
  type DecisionFile,
} from "@noesis/shared-contracts/decision.js";
import {
  DocumentFileSchema,
  type DocumentFile,
} from "@noesis/shared-contracts/document.js";
import {
  TopicFileSchema,
  type TopicFile,
} from "@noesis/shared-contracts/topic.js";
import {
  decisionJsonPath,
  documentJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("DocumentsService — page, detail, review prep", () => {
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
    rmSync(join(ctx.projectDir, "noesis"), { recursive: true, force: true });
  });

  test("hasDocument returns true for an indexed document and false otherwise", async () => {
    await indexDocument(ctx, documentFile({ document_id: "doc-1" }));
    expect(await ctx.documents.hasDocument("doc-1")).toBe(true);
    expect(await ctx.documents.hasDocument("doc-x")).toBe(false);
  });

  test("The documents page lists every indexed document with its id, title, and date", async () => {
    let page: Awaited<ReturnType<typeof ctx.documents.getDocumentsPage>> | null = null;

    await given("two documents indexed with distinct titles and dates", async () => {
      await indexDocument(
        ctx,
        documentFile({ document_id: "doc-a", title: "Alpha vision", date: "2026-01-01" }),
      );
      await indexDocument(
        ctx,
        documentFile({ document_id: "doc-b", title: "Beta charter", date: "2026-02-01" }),
      );
    });
    await when("requesting the documents page", async () => {
      page = await ctx.documents.getDocumentsPage();
    });
    await then("each document is projected with the canonical fields", () => {
      const byId = new Map(page!.documents.map((d) => [d.id, d]));
      expect(byId.get("doc-a")).toEqual({
        id: "doc-a",
        title: "Alpha vision",
        date: "2026-01-01",
      });
      expect(byId.get("doc-b")).toEqual({
        id: "doc-b",
        title: "Beta charter",
        date: "2026-02-01",
      });
    });
  });

  test("Document detail collects the topics and decisions that reference this document", async () => {
    let detail: Awaited<ReturnType<typeof ctx.documents.getDocumentDetail>> | null = null;

    await given(
      "a document referenced by topic 'Auth' and decision 'd-1', plus an unrelated topic 'Other'",
      async () => {
        await indexDocument(ctx, documentFile({ document_id: "doc-1" }));
        await indexTopic(
          ctx,
          topicFile({
            id: "auth",
            title: "Auth",
            items: [
              {
                type: "document_fragment_ref",
                document_id: "doc-1",
                start_offset: 0,
                end_offset: 5,
              },
            ],
          }),
        );
        await indexTopic(ctx, topicFile({ id: "other", title: "Other" }));
        await indexDecision(
          ctx,
          decisionFile({
            id: "d-1",
            topic_id: "auth",
            title: "Pick OAuth",
            decision: {
              text: "go",
              text_locked: false,
              rationale: "because",
              rationale_locked: false,
              supporting_content: [
                {
                  type: "document_fragment_ref",
                  document_id: "doc-1",
                  start_offset: 0,
                  end_offset: 5,
                },
              ],
            },
          }),
        );
      },
    );
    await when("requesting the document detail", async () => {
      detail = await ctx.documents.getDocumentDetail("doc-1");
    });
    await then("only the linked topic appears in the topics list", () => {
      expect(detail?.topics).toEqual([{ topic_id: "auth", title: "Auth" }]);
    });
    await and("the linked decision appears with its status", () => {
      expect(detail?.decisions).toEqual([
        { decision_id: "d-1", title: "Pick OAuth", status: "proposed" },
      ]);
    });
  });

  test("Document detail throws when the document is not indexed", async () => {
    let thrown: Error | null = null;
    try {
      await ctx.documents.getDocumentDetail("ghost");
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain("ghost");
  });

  test("getTopicForDocumentReview returns the first unreviewed topic with a markdown bundle", async () => {
    let review: Awaited<
      ReturnType<typeof ctx.documents.getTopicForDocumentReview>
    > | null = null;

    await given("a working output with two topics, one reviewed and one not", () => {
      const dir = makeWorkingDir(ctx.projectDir, "doc-1");
      writeFileSync(
        join(dir, "output.json"),
        JSON.stringify(
          designDraftOutput({
            documentId: "doc-1",
            topics: [
              { id: "topic-a", title: "Already done", reviewed: true },
              { id: "topic-b", title: "Up next", reviewed: false },
            ],
          }),
        ),
      );
    });
    await when("requesting the next topic for document review", async () => {
      review = await ctx.documents.getTopicForDocumentReview(
        join(makeWorkingDir(ctx.projectDir, "doc-1"), "output.json"),
      );
    });
    await then("the unreviewed topic is returned with its bundle", () => {
      expect(review?.topic_id).toBe("topic-b");
      expect(review?.markdown).toContain("Up next");
    });
  });

  test("getTopicForDocumentReview returns null when every topic is already reviewed", async () => {
    let review: Awaited<
      ReturnType<typeof ctx.documents.getTopicForDocumentReview>
    > | null = null;

    const dir = makeWorkingDir(ctx.projectDir, "doc-1");
    writeFileSync(
      join(dir, "output.json"),
      JSON.stringify(
        designDraftOutput({
          documentId: "doc-1",
          topics: [{ id: "topic-a", title: "Done", reviewed: true }],
        }),
      ),
    );
    review = await ctx.documents.getTopicForDocumentReview(
      join(dir, "output.json"),
    );
    expect(review).toBeNull();
  });

  test("getAllUnreviewedTopicsForDocument returns every unreviewed topic in order", async () => {
    let reviews: Awaited<
      ReturnType<typeof ctx.documents.getAllUnreviewedTopicsForDocument>
    > | null = null;

    const dir = makeWorkingDir(ctx.projectDir, "doc-1");
    writeFileSync(
      join(dir, "output.json"),
      JSON.stringify(
        designDraftOutput({
          documentId: "doc-1",
          topics: [
            { id: "topic-a", title: "First", reviewed: false },
            { id: "topic-b", title: "Mid", reviewed: true },
            { id: "topic-c", title: "Last", reviewed: false },
          ],
        }),
      ),
    );
    reviews = await ctx.documents.getAllUnreviewedTopicsForDocument(
      join(dir, "output.json"),
    );
    expect(reviews?.map((r) => r.topic_id)).toEqual(["topic-a", "topic-c"]);
  });

  test("Document review surfaces prior fragments from earlier documents that share the topic", async () => {
    let review: Awaited<
      ReturnType<typeof ctx.documents.getTopicForDocumentReview>
    > | null = null;

    await given(
      "topic 'shared' previously linked to a fragment in doc-old, plus a new draft for doc-new",
      async () => {
        await indexDocument(
          ctx,
          documentFile({
            document_id: "doc-old",
            title: "Old paper",
            content: "Prior insight here.",
          }),
        );
        await indexTopic(
          ctx,
          topicFile({
            id: "shared",
            title: "Shared",
            items: [
              {
                type: "document_fragment_ref",
                document_id: "doc-old",
                start_offset: 0,
                end_offset: 14,
              },
            ],
          }),
        );
        const dir = makeWorkingDir(ctx.projectDir, "doc-new");
        writeFileSync(
          join(dir, "output.json"),
          JSON.stringify(
            designDraftOutput({
              documentId: "doc-new",
              topics: [{ id: "shared", title: "Shared", reviewed: false }],
            }),
          ),
        );
      },
    );
    await when("preparing the topic review for the new document", async () => {
      review = await ctx.documents.getTopicForDocumentReview(
        join(makeWorkingDir(ctx.projectDir, "doc-new"), "output.json"),
      );
    });
    await then("the review markdown carries the prior fragment text labeled by source", () => {
      expect(review?.markdown).toContain("from Old paper");
      expect(review?.markdown).toContain("Prior insight");
    });
  });
});

function topicFile(overrides: Partial<TopicFile> = {}): TopicFile {
  return TopicFileSchema.parse({
    id: "topic-1",
    parent_id: null,
    title: "Topic",
    short_summary: "Short",
    long_summary: "Long",
    items: [],
    reviewed: true,
    decisions_extracted: false,
    is_stale: false,
    ...overrides,
  });
}

function documentFile(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return DocumentFileSchema.parse({
    document_id: "doc-1",
    title: "Vision",
    date: "2026-01-02",
    content: "Hello world!",
    fragments: [
      { kind: "paragraph", index: 0, start_offset: 0, end_offset: 5, section_path: [], text: "Hello" },
    ],
    section_tree: [],
    ...overrides,
  });
}

function decisionFile(overrides: Partial<DecisionFile> = {}): DecisionFile {
  return DecisionFileSchema.parse({
    id: "d-1",
    topic_id: "topic-1",
    title: "A decision",
    title_locked: false,
    status: "proposed",
    status_locked: false,
    context: { text: "ctx", text_locked: false, supporting_content: [] },
    decision: {
      text: "go",
      text_locked: false,
      rationale: "because",
      rationale_locked: false,
      supporting_content: [],
    },
    alternative_options: [],
    is_stale: false,
    ...overrides,
  });
}

async function indexTopic(
  ctx: KnowledgeNewTestContext,
  file: TopicFile,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "topics"), { recursive: true });
  const path = topicJsonPath(ctx.projectDir, file.id, file.title);
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.topics.indexFile(path);
}

async function indexDocument(
  ctx: KnowledgeNewTestContext,
  file: DocumentFile,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "documents"), { recursive: true });
  const path = documentJsonPath(ctx.projectDir, file.document_id, file.title);
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.documents.indexFile(path);
}

async function indexDecision(
  ctx: KnowledgeNewTestContext,
  file: DecisionFile,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "decisions"), { recursive: true });
  const path = decisionJsonPath(ctx.projectDir, file.id, file.title);
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.decisions.indexFile(path);
}

function makeWorkingDir(projectDir: string, label: string): string {
  const dir = join(projectDir, "working", label);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface DraftOpts {
  documentId: string;
  topics: Array<{ id: string; title: string; reviewed: boolean }>;
}

function designDraftOutput(opts: DraftOpts): unknown {
  return {
    document: {
      document_id: opts.documentId,
      title: "Draft",
      date: "2026-01-02",
      content: "fragment-zero fragment-one",
      fragments: [
        {
          index: 0,
          start_offset: 0,
          end_offset: 13,
          section_path: [],
          kind: "paragraph",
          text: "fragment-zero",
          categories: ["Information"],
        },
      ],
      section_tree: [],
    },
    topics: opts.topics.map((t) => ({
      id: t.id,
      parent_id: null,
      is_new: true,
      title: t.title,
      short_summary: "S",
      long_summary: "L",
      reviewed: t.reviewed,
      decisions_extracted: false,
      items: [
        {
          type: "document_fragment_ref",
          document_id: opts.documentId,
          start_offset: 0,
          end_offset: 13,
        },
      ],
      decisions: [],
    })),
    decision_attachments: [],
    design_doc_extracted: false,
  };
}
