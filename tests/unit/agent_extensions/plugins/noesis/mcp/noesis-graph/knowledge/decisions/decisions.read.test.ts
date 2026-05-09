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
  ConversationFileNewSchema,
  DecisionFileNewSchema,
  DocumentFileNewSchema,
  TopicFileNewSchema,
  type ConversationFileNew,
  type DecisionFileNew,
  type DocumentFileNew,
  type TopicFileNew,
} from "@noesis/shared-contracts/source-file-schemas.js";
import {
  conversationJsonPath,
  decisionJsonPath,
  documentJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("DecisionsService — page, detail, slot lookups, source filtering", () => {
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

  test("The decisions page lists every decision with the latest source date as its date", async () => {
    let page: Awaited<ReturnType<typeof ctx.decisions.getDecisionsPage>> | null = null;

    await given(
      "a decision referencing two conversations with different times and one earlier document",
      async () => {
        await indexConversation(ctx, conversationFile({ conversation_id: "c-old", time: "2026-01-01T10:00:00Z" }));
        await indexConversation(ctx, conversationFile({ conversation_id: "c-new", time: "2026-04-01T10:00:00Z" }));
        await indexDocument(ctx, documentFile({ document_id: "d-1", date: "2026-02-15" }));
        await indexTopic(ctx, topicFile({ id: "topic-1", title: "Auth" }));
        await indexDecision(
          ctx,
          decisionFile({
            id: "d-1",
            topic_id: "topic-1",
            referenced_items: [
              {
                type: "idea_unit_ref",
                conversation_id: "c-old",
                turn_index: 0,
                idea_unit_index: 0,
              },
              {
                type: "idea_unit_ref",
                conversation_id: "c-new",
                turn_index: 0,
                idea_unit_index: 0,
              },
              {
                type: "document_fragment_ref",
                document_id: "d-1",
                start_offset: 0,
                end_offset: 5,
              },
            ],
          }),
        );
      },
    );
    await when("requesting the decisions page", async () => {
      page = await ctx.decisions.getDecisionsPage();
    });
    await then("the decision's date is the most recent source time", () => {
      expect(page?.decisions).toHaveLength(1);
      expect(page?.decisions[0].date).toBe("2026-04-01T10:00:00Z");
    });
  });

  test("A decision with a locked top field is reported as edited_by_user on the decisions page", async () => {
    let page: Awaited<ReturnType<typeof ctx.decisions.getDecisionsPage>> | null = null;

    await given("two decisions, one with a locked title", async () => {
      await indexTopic(ctx, topicFile({ id: "topic-1", title: "Auth" }));
      await indexDecision(
        ctx,
        decisionFile({ id: "locked", topic_id: "topic-1", title: "Locked", title_locked: true }),
      );
      await indexDecision(
        ctx,
        decisionFile({ id: "open", topic_id: "topic-1", title: "Open" }),
      );
    });
    await when("requesting the decisions page", async () => {
      page = await ctx.decisions.getDecisionsPage();
    });
    await then("only the decision with locks is flagged", () => {
      const byId = new Map(page!.decisions.map((d) => [d.id, d.edited_by_user]));
      expect(byId.get("locked")).toBe(true);
      expect(byId.get("open")).toBe(false);
    });
  });

  test("Decision detail returns each slot's distinct conversation and document refs", async () => {
    let detail: Awaited<ReturnType<typeof ctx.decisions.getDecisionDetail>> | null = null;

    await given(
      "a decision whose context references conv-1, decision references conv-2, and alternative 0 references doc-1",
      async () => {
        await indexConversation(ctx, conversationFile({ conversation_id: "conv-1", time: "2026-01-01T10:00:00Z" }));
        await indexConversation(ctx, conversationFile({ conversation_id: "conv-2", time: "2026-02-01T10:00:00Z" }));
        await indexDocument(ctx, documentFile({ document_id: "doc-1", date: "2026-01-05" }));
        await indexTopic(ctx, topicFile({ id: "topic-1", title: "Auth" }));
        await indexDecision(
          ctx,
          decisionFile({
            id: "d-1",
            topic_id: "topic-1",
            title: "Pick OAuth",
            referenced_items: [
              {
                type: "idea_unit_ref",
                conversation_id: "conv-1",
                turn_index: 0,
                idea_unit_index: 0,
              },
              {
                type: "idea_unit_ref",
                conversation_id: "conv-2",
                turn_index: 0,
                idea_unit_index: 0,
              },
              {
                type: "document_fragment_ref",
                document_id: "doc-1",
                start_offset: 0,
                end_offset: 5,
              },
            ],
            context: { text: "ctx", text_locked: false, supporting_item_indices: [0] },
            decision: {
              text: "go", text_locked: false, rationale: "x", rationale_locked: false,
              supporting_item_indices: [1],
            },
            alternative_options: [
              { text: "alt", text_locked: false, rationale: "alt-r", rationale_locked: false, supporting_item_indices: [2] },
            ],
          }),
        );
      },
    );
    await when("requesting the decision detail", async () => {
      detail = await ctx.decisions.getDecisionDetail("d-1");
    });
    await then("the context slot returns conv-1 only", () => {
      expect(detail?.context_conversations.map((c) => c.conversation_id)).toEqual(["conv-1"]);
      expect(detail?.context_documents).toEqual([]);
    });
    await and("the decision slot returns conv-2 only", () => {
      expect(detail?.decision_conversations.map((c) => c.conversation_id)).toEqual(["conv-2"]);
    });
    await and("alternative 0 returns doc-1 only and exposes its option_index", () => {
      expect(detail?.alternatives[0].option_index).toBe(0);
      expect(detail?.alternatives[0].documents.map((d) => d.document_id)).toEqual(["doc-1"]);
      expect(detail?.alternatives[0].conversations).toEqual([]);
    });
    await and("the topic title is resolved from the linked topic", () => {
      expect(detail?.topic_title).toBe("Auth");
    });
  });

  test("Decision-slot conversation detail returns only the idea units referenced by that slot", async () => {
    let detail: Awaited<
      ReturnType<typeof ctx.decisions.getDecisionConversationDetail>
    > | null = null;

    await given(
      "a decision whose decision-slot cites two idea units of conv-1 and whose context cites a different one",
      async () => {
        await indexConversation(
          ctx,
          conversationFile({
            conversation_id: "conv-1",
            turns: [
              {
                index: 0,
                speaker: "Alice",
                time: "2026-01-01T10:00:00Z",
                idea_units: [
                  { index: 0, sentences: ["Context."], categories: ["Information"] },
                  { index: 1, sentences: ["First decision unit."], categories: ["Position"] },
                  { index: 2, sentences: ["Second decision unit."], categories: ["Argument"] },
                ],
              },
            ],
          }),
        );
        await indexTopic(ctx, topicFile({ id: "topic-1", title: "Auth" }));
        await indexDecision(
          ctx,
          decisionFile({
            id: "d-1",
            topic_id: "topic-1",
            referenced_items: [
              { type: "idea_unit_ref", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 0 },
              { type: "idea_unit_ref", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 1 },
              { type: "idea_unit_ref", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 2 },
            ],
            context: { text: "ctx", text_locked: false, supporting_item_indices: [0] },
            decision: { text: "go", text_locked: false, rationale: "x", rationale_locked: false, supporting_item_indices: [1, 2] },
            alternative_options: [],
          }),
        );
      },
    );
    await when("requesting the decision-slot conversation detail for the decision slot", async () => {
      detail = await ctx.decisions.getDecisionConversationDetail("d-1", "decision", "conv-1");
    });
    await then("only the two decision-slot idea units are returned", () => {
      expect(detail?.idea_units.map((iu) => iu.idea_unit_index)).toEqual([1, 2]);
    });
    await and("the slot label reads 'Decision'", () => {
      expect(detail?.slot_label).toBe("Decision");
    });
  });

  test("Decision-slot document detail slices each fragment text from the document content", async () => {
    let detail: Awaited<
      ReturnType<typeof ctx.decisions.getDecisionDocumentDetail>
    > | null = null;

    await given(
      "a decision whose alternative 1 cites two ranges of document doc-1 with content 'Hello world!'",
      async () => {
        await indexDocument(
          ctx,
          documentFile({
            document_id: "doc-1",
            content: "Hello world!",
            fragments: [
              { kind: "paragraph", index: 0, start_offset: 0, end_offset: 5, section_path: [], text: "Hello" },
              { kind: "paragraph", index: 1, start_offset: 6, end_offset: 11, section_path: [], text: "world" },
            ],
          }),
        );
        await indexTopic(ctx, topicFile({ id: "topic-1", title: "Auth" }));
        await indexDecision(
          ctx,
          decisionFile({
            id: "d-1",
            topic_id: "topic-1",
            referenced_items: [
              { type: "document_fragment_ref", document_id: "doc-1", start_offset: 0, end_offset: 5 },
              { type: "document_fragment_ref", document_id: "doc-1", start_offset: 6, end_offset: 11 },
            ],
            alternative_options: [
              { text: "alt-0", text_locked: false, rationale: "r", rationale_locked: false, supporting_item_indices: [] },
              { text: "alt-1", text_locked: false, rationale: "r", rationale_locked: false, supporting_item_indices: [0, 1] },
            ],
          }),
        );
      },
    );
    await when("requesting the slot-document detail for alternative-1", async () => {
      detail = await ctx.decisions.getDecisionDocumentDetail("d-1", "alternative-1", "doc-1");
    });
    await then("each fragment's text is sliced from the content", () => {
      expect(detail?.fragments).toEqual([
        { start_offset: 0, end_offset: 5, text: "Hello" },
        { start_offset: 6, end_offset: 11, text: "world" },
      ]);
    });
    await and("the slot label reads 'Option 2' (1-based)", () => {
      expect(detail?.slot_label).toBe("Option 2");
    });
  });

  test("Listing decisions for a specific topic id returns only decisions of that topic", async () => {
    let ids: string[] | null = null;

    await given("decisions belonging to two different topics", async () => {
      await indexTopic(ctx, topicFile({ id: "t-a", title: "Alpha" }));
      await indexTopic(ctx, topicFile({ id: "t-b", title: "Beta" }));
      await indexDecision(ctx, decisionFile({ id: "d-a1", topic_id: "t-a", title: "A1" }));
      await indexDecision(ctx, decisionFile({ id: "d-a2", topic_id: "t-a", title: "A2" }));
      await indexDecision(ctx, decisionFile({ id: "d-b1", topic_id: "t-b", title: "B1" }));
    });
    await when("listing decisions for topic 't-a'", async () => {
      const overviews = await ctx.decisions.listDecisions("t-a");
      ids = overviews.map((d) => d.id);
    });
    await then("only decisions belonging to 't-a' are returned", () => {
      expect(ids).toEqual(["d-a1", "d-a2"]);
    });
  });

  test("Listing decisions for sources returns only decisions whose referenced items include any given conversation or document", async () => {
    let titles: string[] | null = null;

    await given(
      "two decisions: 'Match' references conv-1, 'Skip' references only conv-2",
      async () => {
        await indexConversation(ctx, conversationFile({ conversation_id: "conv-1" }));
        await indexConversation(ctx, conversationFile({ conversation_id: "conv-2" }));
        await indexTopic(ctx, topicFile({ id: "topic-1", title: "Auth" }));
        await indexDecision(
          ctx,
          decisionFile({
            id: "match",
            title: "Match",
            topic_id: "topic-1",
            referenced_items: [
              { type: "idea_unit_ref", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 0 },
            ],
          }),
        );
        await indexDecision(
          ctx,
          decisionFile({
            id: "skip",
            title: "Skip",
            topic_id: "topic-1",
            referenced_items: [
              { type: "idea_unit_ref", conversation_id: "conv-2", turn_index: 0, idea_unit_index: 0 },
            ],
          }),
        );
      },
    );
    await when("listing decisions whose sources include conv-1", async () => {
      const result = await ctx.decisions.listDecisionsForSources(["conv-1"], []);
      titles = result.map((d) => d.title);
    });
    await then("only the matching decision is returned", () => {
      expect(titles).toEqual(["Match"]);
    });
  });

  test("readDecision returns the full file projection or null when missing", async () => {
    await given("an indexed decision with one alternative option", async () => {
      await indexTopic(ctx, topicFile({ id: "topic-1", title: "Auth" }));
      await indexDecision(
        ctx,
        decisionFile({
          id: "d-1",
          topic_id: "topic-1",
          alternative_options: [
            { text: "alt", text_locked: false, rationale: "r", rationale_locked: false, supporting_item_indices: [] },
          ],
        }),
      );
    });
    await when("reading the decision", async () => {
      const detail = await ctx.decisions.readDecision("d-1");
      expect(detail?.id).toBe("d-1");
      expect(detail?.alternatives).toEqual([
        { option_index: 0, text: "alt", rationale: "r" },
      ]);
    });
    await then("reading a missing id returns null", async () => {
      expect(await ctx.decisions.readDecision("ghost")).toBeNull();
    });
  });
});

function topicFile(overrides: Partial<TopicFileNew> = {}): TopicFileNew {
  return TopicFileNewSchema.parse({
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

function conversationFile(
  overrides: Partial<ConversationFileNew> = {},
): ConversationFileNew {
  return ConversationFileNewSchema.parse({
    conversation_id: "conv-1",
    time: "2026-01-01T10:00:00Z",
    main_topic: "Project kickoff",
    turns: [
      {
        index: 0,
        speaker: "Alice",
        time: "2026-01-01T10:00:00Z",
        idea_units: [
          { index: 0, sentences: ["Hello."], categories: ["Information"] },
        ],
      },
    ],
    ...overrides,
  });
}

function documentFile(overrides: Partial<DocumentFileNew> = {}): DocumentFileNew {
  return DocumentFileNewSchema.parse({
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

function decisionFile(overrides: Partial<DecisionFileNew> = {}): DecisionFileNew {
  return DecisionFileNewSchema.parse({
    id: "d-1",
    topic_id: "topic-1",
    title: "A decision",
    title_locked: false,
    status: "proposed",
    status_locked: false,
    referenced_items: [],
    context: { text: "ctx", text_locked: false, supporting_item_indices: [] },
    decision: {
      text: "go",
      text_locked: false,
      rationale: "because",
      rationale_locked: false,
      supporting_item_indices: [],
    },
    alternative_options: [],
    is_stale: false,
    ...overrides,
  });
}

async function indexTopic(
  ctx: KnowledgeNewTestContext,
  file: TopicFileNew,
): Promise<void> {
  const path = topicJsonPath(ctx.projectDir, file.id);
  mkdirSync(join(ctx.projectDir, "noesis", "topics"), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.topics.indexFile(path);
}

async function indexConversation(
  ctx: KnowledgeNewTestContext,
  file: ConversationFileNew,
): Promise<void> {
  const path = conversationJsonPath(ctx.projectDir, file.conversation_id);
  mkdirSync(join(ctx.projectDir, "noesis", "conversations"), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.conversations.indexFile(path);
}

async function indexDocument(
  ctx: KnowledgeNewTestContext,
  file: DocumentFileNew,
): Promise<void> {
  const path = documentJsonPath(ctx.projectDir, file.document_id);
  mkdirSync(join(ctx.projectDir, "noesis", "documents"), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.documents.indexFile(path);
}

async function indexDecision(
  ctx: KnowledgeNewTestContext,
  file: DecisionFileNew,
): Promise<void> {
  const path = decisionJsonPath(ctx.projectDir, file.id);
  mkdirSync(join(ctx.projectDir, "noesis", "decisions"), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.decisions.indexFile(path);
}
