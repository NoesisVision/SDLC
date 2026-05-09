import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import {
  DecisionFileNewSchema,
  DocumentFileNewSchema,
  TopicFileNewSchema,
  type DecisionFileNew,
  type DocumentFileNew,
} from "@noesis/shared-contracts/source-file-schemas.js";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
} from "@noesis/shared-contracts/design-doc-new.js";
import { LockedFieldsBlockedError } from "@noesis/mcp/noesis-graph/knowledge/documents/documents.service.js";
import {
  decisionJsonPath,
  documentJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("DocumentsService — accept skill output, validate, split, save", () => {
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

  test("Uploading an analyze-design-draft output writes the document, topic and decision files to canonical paths", async () => {
    let result: {
      document_id: string;
      topic_paths: string[];
      decision_paths: string[];
      decision_attachments: number;
      design_doc_path: string | null;
    } | null = null;

    await given("an analyze-design-draft output with topic and decision", () => {
      writeWorkingDirOutput(workingDir, makeOutput());
    });
    await when("the skill output is uploaded without an extracted design doc", async () => {
      result = await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: null,
      });
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
      const topic = readTopic(ctx, "doc-topic-1");
      expect(topic.items.length).toBeGreaterThan(0);
      for (const item of topic.items) {
        expect(item.source_sha).toBeDefined();
      }
      const decision = readDecision(ctx, "doc-decision-1");
      expect(decision.referenced_items.length).toBeGreaterThan(0);
      for (const item of decision.referenced_items) {
        expect(item.source_sha).toBeDefined();
      }
    });
    await and("the result enumerates the produced canonical paths and reports no design-doc and no cleared locks", () => {
      expect(result?.document_id).toBe("doc-1");
      expect(result?.topic_paths).toEqual([
        topicJsonPath(ctx.projectDir, "doc-topic-1"),
      ]);
      expect(result?.decision_paths).toEqual([
        decisionJsonPath(ctx.projectDir, "doc-decision-1"),
      ]);
      expect(result?.decision_attachments).toBe(0);
      expect(result?.design_doc_path).toBeNull();
    });
  });

  test("Uploading a follow-up document attaches its fragments to a previously uploaded decision", async () => {
    let appended = 0;

    await given("an existing decision file referencing one fragment from a prior upload", async () => {
      writeWorkingDirOutput(workingDir, makeOutput());
      await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: null,
      });
    });
    await when("a second document is uploaded with an attachment to the prior decision", async () => {
      const second = makeOutput({
        documentId: "doc-2",
        topicId: "doc-topic-2",
        decisionId: "doc-decision-2",
        attachToDecisionId: "doc-decision-1",
      });
      writeWorkingDirOutput(workingDir, second);
      const result = await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: null,
      });
      appended = result.decision_attachments;
    });
    await then("the attachment count reports one new reference appended", () => {
      expect(appended).toBe(1);
    });
    await and("the prior decision now references a fragment from the new document", () => {
      const decision = readDecision(ctx, "doc-decision-1");
      expect(decision.referenced_items.length).toBeGreaterThanOrEqual(2);
      expect(
        decision.referenced_items.some((i) => i.type === "document_fragment_ref"),
      ).toBe(true);
    });
  });

  test("Uploading an extracted design doc persists it under the canonical noesis/design-docs path", async () => {
    let designDocPath: string | null = null;

    await given("a working dir with a document output and a separate extracted design-doc payload", () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({
          designDocExtracted: true,
          designDocId: "01928000-0000-7000-8000-aaaaaaaaaaaa",
        }),
      );
      writeWorkingDirDesignDoc(
        workingDir,
        makeDesignDocFile("01928000-0000-7000-8000-aaaaaaaaaaaa", "billing"),
      );
    });
    await when("the document and design doc are uploaded together", async () => {
      const result = await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: join(workingDir, "design-doc.json"),
      });
      designDocPath = result.design_doc_path;
    });
    await then("the design doc lands at noesis/design-docs/<slug>-<suffix>.json", () => {
      expect(designDocPath).not.toBeNull();
      expect(designDocPath).toContain("/noesis/design-docs/billing-");
      const dir = join(ctx.projectDir, "noesis", "design-docs");
      const entries = readdirSync(dir).filter((e) => e.endsWith(".json"));
      expect(entries).toHaveLength(1);
      const parsed = DesignDocFileNewSchema.parse(
        JSON.parse(readFileSync(join(dir, entries[0]), "utf-8")),
      );
      expect(parsed.id).toBe("01928000-0000-7000-8000-aaaaaaaaaaaa");
    });
  });

  test("Uploading rejects an extracted design doc payload when the skill did not flag it as extracted", async () => {
    let thrown: Error | null = null;

    await given("a working dir whose output disclaims design doc extraction", () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({ designDocExtracted: false, designDocId: "x" }),
      );
      writeWorkingDirDesignDoc(
        workingDir,
        makeDesignDocFile("01928000-0000-7000-8000-bbbbbbbbbbbb", "billing"),
      );
    });
    await when("the upload is attempted with both paths", async () => {
      try {
        await ctx.documents.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
          designDocJsonPath: join(workingDir, "design-doc.json"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the upload is rejected with a message about the design-doc-extracted contradiction", () => {
      expect(thrown?.message).toContain("design_doc_extracted");
    });
  });

  test("Uploading without confirmation rejects with the list of topic locked fields whose value would change", async () => {
    let thrown: Error | null = null;

    await given("a topic on disk with a locked title and locked short_summary", () => {
      seedTopicFile(ctx, {
        id: "doc-topic-1",
        title: "User-set title",
        title_locked: true,
        short_summary: "User-set summary",
        short_summary_locked: true,
      });
    });
    await when("the skill output proposing different title and short_summary is uploaded with no confirmed_edits", async () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({
          topicTitle: "Skill-proposed title",
          topicShortSummary: "Skill-proposed summary",
        }),
      );
      try {
        await ctx.documents.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
          designDocJsonPath: null,
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the upload is rejected with a LockedFieldsBlockedError listing every locked topic field that would have changed", () => {
      expect(thrown).toBeInstanceOf(LockedFieldsBlockedError);
      const blocked = (thrown as LockedFieldsBlockedError).blocked;
      expect(blocked).toEqual([
        { kind: "topic", topic_id: "doc-topic-1", field: "title" },
        { kind: "topic", topic_id: "doc-topic-1", field: "short_summary" },
      ]);
    });
    await and("the on-disk topic file is left exactly as it was before the upload", () => {
      const topic = readTopic(ctx, "doc-topic-1");
      expect(topic.title).toBe("User-set title");
      expect(topic.short_summary).toBe("User-set summary");
    });
  });

  test("Uploading without confirmation succeeds when locked field values match the skill output exactly", async () => {
    await given("a topic on disk whose locked title matches the title the skill is about to upload", () => {
      seedTopicFile(ctx, {
        id: "doc-topic-1",
        title: "Feature X",
        title_locked: true,
      });
    });
    await when("the skill output is uploaded with no confirmed_edits", async () => {
      writeWorkingDirOutput(workingDir, makeOutput({ topicTitle: "Feature X" }));
      await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: null,
      });
    });
    await then("the on-disk topic file keeps the title locked at the same value", () => {
      const topic = readTopic(ctx, "doc-topic-1");
      expect(topic.title).toBe("Feature X");
      expect(topic.title_locked).toBe(true);
    });
  });

  test("Uploading with confirmed_edits for a locked topic field overwrites the value and clears the lock", async () => {
    let cleared: unknown[] = [];

    await given("a topic on disk with a locked title differing from the skill output", () => {
      seedTopicFile(ctx, {
        id: "doc-topic-1",
        title: "User-set title",
        title_locked: true,
      });
    });
    await when("the skill re-uploads with confirmed_edits for the topic title", async () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({ topicTitle: "Skill-proposed title" }),
      );
      const result = await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: null,
        confirmed_edits: [
          { kind: "topic", topic_id: "doc-topic-1", field: "title" },
        ],
      });
      cleared = result.cleared_locks;
    });
    await then("the topic title is replaced with the skill's value and the lock is cleared", () => {
      const topic = readTopic(ctx, "doc-topic-1");
      expect(topic.title).toBe("Skill-proposed title");
      expect(topic.title_locked).toBe(false);
    });
    await and("the result reports the cleared lock", () => {
      expect(cleared).toEqual([
        { kind: "topic", topic_id: "doc-topic-1", field: "title" },
      ]);
    });
  });

  test("Uploading with partial confirmed_edits applies confirmed edits and preserves unconfirmed locked fields", async () => {
    await given("a topic on disk whose title and short_summary are both locked", () => {
      seedTopicFile(ctx, {
        id: "doc-topic-1",
        title: "User-set title",
        title_locked: true,
        short_summary: "User-set summary",
        short_summary_locked: true,
      });
    });
    await when("the skill re-uploads with different title and short_summary, confirming only the title edit", async () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({
          topicTitle: "Skill-proposed title",
          topicShortSummary: "Skill-proposed summary",
        }),
      );
      await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: null,
        confirmed_edits: [
          { kind: "topic", topic_id: "doc-topic-1", field: "title" },
        ],
      });
    });
    await then("the title takes the new value with its lock cleared", () => {
      const topic = readTopic(ctx, "doc-topic-1");
      expect(topic.title).toBe("Skill-proposed title");
      expect(topic.title_locked).toBe(false);
    });
    await and("the unconfirmed short_summary keeps its user-set value with the lock still set", () => {
      const topic = readTopic(ctx, "doc-topic-1");
      expect(topic.short_summary).toBe("User-set summary");
      expect(topic.short_summary_locked).toBe(true);
    });
  });

  test("Uploading without confirmation rejects when a locked decision field would change", async () => {
    let thrown: Error | null = null;

    await given("a decision with a locked decision.text", () => {
      seedDecisionFile(ctx, {
        id: "doc-decision-1",
        decision: {
          text: "User-set decision text",
          text_locked: true,
          rationale: "Customer demand.",
          rationale_locked: false,
          supporting_item_indices: [],
        },
      });
    });
    await when("the skill output proposing a different decision.text is uploaded with no confirmed_edits", async () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({ decisionText: "Skill-proposed decision text" }),
      );
      try {
        await ctx.documents.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
          designDocJsonPath: null,
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the upload is rejected with a LockedFieldsBlockedError pointing at the decision field", () => {
      expect(thrown).toBeInstanceOf(LockedFieldsBlockedError);
      const blocked = (thrown as LockedFieldsBlockedError).blocked;
      expect(blocked).toEqual([
        { kind: "decision", decision_id: "doc-decision-1", field: "decision.text" },
      ]);
    });
  });

  test("Uploading with confirmed_edits for a locked decision field overwrites the value and clears the lock", async () => {
    await given("a decision with a locked decision text differing from the skill output", () => {
      seedDecisionFile(ctx, {
        id: "doc-decision-1",
        decision: {
          text: "User-set decision text",
          text_locked: true,
          rationale: "Customer demand.",
          rationale_locked: false,
          supporting_item_indices: [],
        },
      });
    });
    await when("the skill re-uploads with a different decision.text and confirms the edit", async () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({ decisionText: "Skill-proposed decision text" }),
      );
      await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: null,
        confirmed_edits: [
          { kind: "decision", decision_id: "doc-decision-1", field: "decision.text" },
        ],
      });
    });
    await then("the decision text takes the skill's value with its lock cleared", () => {
      const decision = readDecision(ctx, "doc-decision-1");
      expect(decision.decision.text).toBe("Skill-proposed decision text");
      expect(decision.decision.text_locked).toBe(false);
    });
  });

  test("Uploading without confirmation rejects when a locked design doc field would change", async () => {
    let thrown: Error | null = null;
    const designDocId = "01928000-0000-7000-8000-aaaaaaaaaaaa";

    await given("a design doc on disk with a locked name", async () => {
      const seeded: DesignDocFileNew = makeDesignDocFile(designDocId, "billing", {
        name_locked: true,
      });
      await ctx.designDocs.persistFile(seeded);
    });
    await when("the skill output proposing a different design-doc name is uploaded with no confirmed_edits", async () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({ designDocExtracted: true, designDocId }),
      );
      writeWorkingDirDesignDoc(
        workingDir,
        makeDesignDocFile(designDocId, "invoicing"),
      );
      try {
        await ctx.documents.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
          designDocJsonPath: join(workingDir, "design-doc.json"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the upload is rejected with a LockedFieldsBlockedError pointing at the design-doc name", () => {
      expect(thrown).toBeInstanceOf(LockedFieldsBlockedError);
      const blocked = (thrown as LockedFieldsBlockedError).blocked;
      expect(blocked).toEqual([
        { kind: "design_doc", design_doc_id: designDocId, field: "name" },
      ]);
    });
  });

  test("Uploading with confirmed_edits for a locked design doc field overwrites the value and clears the lock", async () => {
    let clearedLocks: unknown[] = [];
    const designDocId = "01928000-0000-7000-8000-aaaaaaaaaaaa";

    await given("a design doc on disk with a locked name differing from the skill output", async () => {
      await ctx.designDocs.persistFile(
        makeDesignDocFile(designDocId, "billing", { name_locked: true }),
      );
    });
    await when("the skill re-uploads with the new name and confirms the edit", async () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({ designDocExtracted: true, designDocId }),
      );
      writeWorkingDirDesignDoc(
        workingDir,
        makeDesignDocFile(designDocId, "invoicing"),
      );
      const result = await ctx.documents.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        designDocJsonPath: join(workingDir, "design-doc.json"),
        confirmed_edits: [
          { kind: "design_doc", design_doc_id: designDocId, field: "name" },
        ],
      });
      clearedLocks = result.cleared_locks;
    });
    await then("the design doc on disk takes the new name with its lock cleared", () => {
      const persisted = readDesignDocById(ctx, designDocId);
      expect(persisted.name).toBe("invoicing");
      expect(persisted.name_locked).toBe(false);
    });
    await and("the result reports the cleared design-doc lock", () => {
      expect(clearedLocks).toEqual([
        { kind: "design_doc", design_doc_id: designDocId, field: "name" },
      ]);
    });
  });

  test("Uploading without confirmation lists conflicts across topics, decisions and the design doc in one error", async () => {
    let thrown: Error | null = null;
    const designDocId = "01928000-0000-7000-8000-aaaaaaaaaaaa";

    await given("a topic with a locked title, a decision with a locked rationale, and a design doc with a locked name", async () => {
      seedTopicFile(ctx, {
        id: "doc-topic-1",
        title: "User-set title",
        title_locked: true,
      });
      seedDecisionFile(ctx, {
        id: "doc-decision-1",
        decision: {
          text: "Ship feature X.",
          text_locked: false,
          rationale: "User-set rationale",
          rationale_locked: true,
          supporting_item_indices: [],
        },
      });
      await ctx.designDocs.persistFile(
        makeDesignDocFile(designDocId, "billing", { name_locked: true }),
      );
    });
    await when("the skill output proposing different topic.title, decision.rationale and design-doc name is uploaded with no confirmed_edits", async () => {
      writeWorkingDirOutput(
        workingDir,
        makeOutput({
          topicTitle: "Skill-proposed title",
          decisionRationale: "Skill-proposed rationale",
          designDocExtracted: true,
          designDocId,
        }),
      );
      writeWorkingDirDesignDoc(
        workingDir,
        makeDesignDocFile(designDocId, "invoicing"),
      );
      try {
        await ctx.documents.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
          designDocJsonPath: join(workingDir, "design-doc.json"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the LockedFieldsBlockedError lists the topic, decision, and design-doc conflicts together", () => {
      expect(thrown).toBeInstanceOf(LockedFieldsBlockedError);
      const blocked = (thrown as LockedFieldsBlockedError).blocked;
      expect(blocked).toEqual([
        { kind: "topic", topic_id: "doc-topic-1", field: "title" },
        { kind: "decision", decision_id: "doc-decision-1", field: "decision.rationale" },
        { kind: "design_doc", design_doc_id: designDocId, field: "name" },
      ]);
    });
  });

  test("Indexing a document file projects it into Document and DocumentFragment nodes", async () => {
    let path = "";

    await given("a structured document file on disk that has not yet been indexed", () => {
      path = documentJsonPath(ctx.projectDir, "doc-1");
      ctx.documentsRepository.writeFile(path, sampleDocumentFile());
    });
    await when("indexing the document file", async () => {
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

    await given("a structured document file indexed once", async () => {
      path = documentJsonPath(ctx.projectDir, "doc-1");
      ctx.documentsRepository.writeFile(path, sampleDocumentFile());
      await ctx.documents.indexFile(path);
    });
    await when("indexing the file a second time without any disk changes", async () => {
      secondOutcome = await ctx.documents.indexFile(path);
    });
    await then("the operation reports the document as unchanged", () => {
      expect(secondOutcome?.status).toBe("unchanged");
    });
  });

  test("Deleting a document while its source file is still on disk removes both the DB row and the file", async () => {
    let path = "";

    await given("an indexed document whose source file lives on disk", async () => {
      path = documentJsonPath(ctx.projectDir, "doc-1");
      ctx.documentsRepository.writeFile(path, sampleDocumentFile());
      await ctx.documents.indexFile(path);
    });
    await when("deletion is requested for the document's canonical path", async () => {
      const result = await ctx.documents.deleteForFile(path);
      expect(result?.document_id).toBe("doc-1");
    });
    await then("the document no longer exists in DB", async () => {
      expect(await ctx.documentsRepository.exists("doc-1")).toBe(false);
    });
    await and("the source file is removed from disk", () => {
      expect(existsSync(path)).toBe(false);
    });
  });

  test("Deleting a document whose source file is already gone still removes the DB row", async () => {
    let path = "";

    await given("an indexed document whose source file has been removed from disk", async () => {
      path = documentJsonPath(ctx.projectDir, "doc-1");
      ctx.documentsRepository.writeFile(path, sampleDocumentFile());
      await ctx.documents.indexFile(path);
      rmSync(path, { force: true });
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
  topicShortSummary?: string;
  topicLongSummary?: string;
  decisionTitle?: string;
  decisionStatus?: "accepted" | "proposed";
  decisionContextText?: string;
  decisionText?: string;
  decisionRationale?: string;
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
        short_summary: b.topicShortSummary ?? "Decision on feature X.",
        long_summary:
          b.topicLongSummary ?? "We chose to ship feature X based on the draft.",
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
            title: b.decisionTitle ?? "Ship feature X",
            status: b.decisionStatus ?? "accepted",
            referenced_items: [
              {
                type: "document_fragment_ref",
                document_id: documentId,
                start_offset: 25,
                end_offset: 60,
              },
            ],
            context: {
              text: b.decisionContextText ?? "Need feature X.",
              supporting_item_indices: [0],
            },
            decision: {
              text: b.decisionText ?? "Ship feature X.",
              rationale: b.decisionRationale ?? "Customer demand.",
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
      b.attachToDecisionId === undefined || b.attachToDecisionId === null
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
          short_summary: b.topicShortSummary ?? "Decision on feature X.",
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

function makeDesignDocFile(
  id: string,
  name: string,
  overrides: Partial<DesignDocFileNew> = {},
): DesignDocFileNew {
  return DesignDocFileNewSchema.parse({
    id,
    name,
    description: "Created via analyze-design-draft.",
    actors: [],
    boundedContexts: { added: [], removed: [], modified: [] },
    implemented: false,
    ...overrides,
  });
}

function sampleDocumentFile(): DocumentFileNew {
  return DocumentFileNewSchema.parse({
    document_id: "doc-1",
    title: "Design Draft",
    date: "2026-04-17",
    content: "Some intro paragraph here.We decided to ship feature X soon.",
    fragments: [
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
    ],
    section_tree: [
      {
        level: 1,
        title: "Doc",
        path: [],
        fragment_indices: [0, 1],
        children: [],
      },
    ],
  });
}

function seedTopicFile(
  ctx: KnowledgeNewTestContext,
  overrides: Record<string, unknown>,
): void {
  ctx.topicsRepository.writeFile(
    topicJsonPath(ctx.projectDir, (overrides.id as string | undefined) ?? "doc-topic-1"),
    TopicFileNewSchema.parse({
      id: "doc-topic-1",
      parent_id: null,
      title: "Feature X",
      short_summary: "Decision on feature X.",
      long_summary: "We chose to ship feature X based on the draft.",
      items: [],
      reviewed: true,
      decisions_extracted: true,
      ...overrides,
    }),
  );
}

function seedDecisionFile(
  ctx: KnowledgeNewTestContext,
  overrides: Partial<DecisionFileNew> & { id?: string },
): void {
  const id = overrides.id ?? "doc-decision-1";
  ctx.decisionsRepository.writeFile(
    decisionJsonPath(ctx.projectDir, id),
    DecisionFileNewSchema.parse({
      id,
      topic_id: "doc-topic-1",
      title: "Ship feature X",
      status: "accepted",
      referenced_items: [],
      context: {
        text: "Need feature X.",
        supporting_item_indices: [],
      },
      decision: {
        text: "Ship feature X.",
        rationale: "Customer demand.",
        supporting_item_indices: [],
      },
      alternative_options: [],
      ...overrides,
    }),
  );
}

function readTopic(ctx: KnowledgeNewTestContext, id: string) {
  return TopicFileNewSchema.parse(
    JSON.parse(readFileSync(topicJsonPath(ctx.projectDir, id), "utf-8")),
  );
}

function readDecision(ctx: KnowledgeNewTestContext, id: string) {
  return DecisionFileNewSchema.parse(
    JSON.parse(readFileSync(decisionJsonPath(ctx.projectDir, id), "utf-8")),
  );
}

function readDesignDocById(
  ctx: KnowledgeNewTestContext,
  designDocId: string,
): DesignDocFileNew {
  const dir = join(ctx.projectDir, "noesis", "design-docs");
  const entries = readdirSync(dir).filter(
    (e) => e.endsWith(".json") && e.includes(designDocId.slice(-8)),
  );
  if (entries.length === 0) {
    throw new Error(`No design-doc file found for ${designDocId} in ${dir}`);
  }
  return DesignDocFileNewSchema.parse(
    JSON.parse(readFileSync(join(dir, entries[0]), "utf-8")),
  );
}

function writeWorkingDirOutput(workingDir: string, output: unknown): void {
  mkdirSync(workingDir, { recursive: true });
  writeFileSync(join(workingDir, "output.json"), JSON.stringify(output, null, 2));
}

function writeWorkingDirDesignDoc(
  workingDir: string,
  designDoc: DesignDocFileNew,
): void {
  mkdirSync(workingDir, { recursive: true });
  writeFileSync(
    join(workingDir, "design-doc.json"),
    JSON.stringify(designDoc, null, 2),
  );
}
