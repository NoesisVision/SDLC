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
  ConversationSchema,
  type Conversation,
} from "@noesis/shared-contracts/conversation.js";
import {
  DecisionFileNewSchema,
  TopicFileNewSchema,
  type DecisionFileNew,
  type TopicFileNew,
} from "@noesis/shared-contracts/source-file-schemas.js";
import {
  conversationJsonPath,
  decisionJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("ConversationsService — page, detail, validate, prepareReviewBundle", () => {
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

  test("hasConversation returns true for an indexed conversation and false otherwise", async () => {
    await indexConversation(ctx, conversationFile({ conversation_id: "conv-1" }));
    expect(await ctx.conversations.hasConversation("conv-1")).toBe(true);
    expect(await ctx.conversations.hasConversation("conv-x")).toBe(false);
  });

  test("The conversations page lists every indexed conversation projected as id/title/date", async () => {
    let page: Awaited<ReturnType<typeof ctx.conversations.getConversationsPage>> | null = null;

    await given("two conversations indexed with different titles and dates", async () => {
      await indexConversation(
        ctx,
        conversationFile({
          conversation_id: "conv-a",
          main_topic: "Alpha kickoff",
          time: "2026-01-01T10:00:00Z",
        }),
      );
      await indexConversation(
        ctx,
        conversationFile({
          conversation_id: "conv-b",
          main_topic: "Beta retro",
          time: "2026-02-01T10:00:00Z",
        }),
      );
    });
    await when("requesting the conversations page", async () => {
      page = await ctx.conversations.getConversationsPage();
    });
    await then("both conversations are projected with the canonical fields", () => {
      const byId = new Map(page!.conversations.map((c) => [c.id, c]));
      expect(byId.get("conv-a")).toEqual({
        id: "conv-a",
        title: "Alpha kickoff",
        date: "2026-01-01T10:00:00Z",
      });
      expect(byId.get("conv-b")).toEqual({
        id: "conv-b",
        title: "Beta retro",
        date: "2026-02-01T10:00:00Z",
      });
    });
  });

  test("Conversation detail collects the topics and decisions that reference this conversation", async () => {
    let detail: Awaited<ReturnType<typeof ctx.conversations.getConversationDetail>> | null = null;

    await given(
      "a conversation referenced by topic 'Auth' and decision 'd-1', plus an unrelated topic 'Other'",
      async () => {
        await indexConversation(ctx, conversationFile({ conversation_id: "conv-1" }));
        await indexTopic(
          ctx,
          topicFile({
            id: "auth",
            title: "Auth",
            items: [
              {
                type: "idea_unit_ref",
                conversation_id: "conv-1",
                turn_index: 0,
                idea_unit_index: 0,
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
                  type: "idea_unit_ref",
                  conversation_id: "conv-1",
                  turn_index: 0,
                  idea_unit_index: 0,
                },
              ],
            },
          }),
        );
      },
    );
    await when("requesting the conversation detail", async () => {
      detail = await ctx.conversations.getConversationDetail("conv-1");
    });
    await then("the detail includes only the linked topic", () => {
      expect(detail?.topics).toEqual([{ topic_id: "auth", title: "Auth" }]);
    });
    await and("the detail includes the linked decision with status", () => {
      expect(detail?.decisions).toEqual([
        { decision_id: "d-1", title: "Pick OAuth", status: "proposed" },
      ]);
    });
  });

  test("Conversation detail throws when the conversation is not indexed", async () => {
    let thrown: Error | null = null;
    try {
      await ctx.conversations.getConversationDetail("ghost");
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain("ghost");
  });

  test("Validating output flags an idea unit that no topic claims", async () => {
    let result: Awaited<ReturnType<typeof ctx.conversations.validateOutput>> | null = null;
    let workingDir = "";

    await given(
      "a working dir whose output.json leaves a non-Irrelevant idea unit unassigned",
      () => {
        workingDir = makeWorkingDir(ctx.projectDir, "conv-1");
        writeFileSync(
          join(workingDir, "output.json"),
          JSON.stringify(unassignedIdeaUnitOutput()),
        );
      },
    );
    await when("validating that working dir", async () => {
      result = await ctx.conversations.validateOutput(workingDir);
    });
    await then("the validator reports the unassigned idea unit as an error", () => {
      expect(result?.status).toBe("Errors");
      if (result?.status === "Errors") {
        const messages = result.errors.map((e) => e.message).join("\n");
        expect(messages).toContain("not assigned to any topic");
      }
    });
  });

  test("Validating well-formed output returns Ok", async () => {
    let result: Awaited<ReturnType<typeof ctx.conversations.validateOutput>> | null = null;
    let workingDir = "";

    await given("a working dir with a valid analyze-conversation output", () => {
      workingDir = makeWorkingDir(ctx.projectDir, "conv-1");
      writeFileSync(
        join(workingDir, "output.json"),
        JSON.stringify(validOutput()),
      );
    });
    await when("validating that working dir", async () => {
      result = await ctx.conversations.validateOutput(workingDir);
    });
    await then("the validator reports Ok", () => {
      expect(result?.status).toBe("Ok");
    });
  });

  test("prepareReviewBundle marks topics that already have prior idea units from earlier conversations", async () => {
    let bundle: Awaited<
      ReturnType<typeof ctx.conversations.prepareReviewBundle>
    > | null = null;
    let outputPath = "";

    await given(
      "a topic 'Auth' previously indexed with one prior idea unit from conv-old, and a current output for conv-new also assigning to 'Auth'",
      async () => {
        await indexConversation(
          ctx,
          conversationFile({
            conversation_id: "conv-old",
            time: "2026-01-01T10:00:00Z",
          }),
        );
        await indexTopic(
          ctx,
          topicFile({
            id: "auth",
            title: "Auth",
            items: [
              {
                type: "idea_unit_ref",
                conversation_id: "conv-old",
                turn_index: 0,
                idea_unit_index: 0,
              },
            ],
          }),
        );
        const workingDir = makeWorkingDir(ctx.projectDir, "conv-new");
        outputPath = join(workingDir, "output.json");
        writeFileSync(
          outputPath,
          JSON.stringify(validOutput({ conversationId: "conv-new", topicId: "auth", isExistingTopic: true })),
        );
      },
    );
    await when("preparing the review bundle", async () => {
      bundle = await ctx.conversations.prepareReviewBundle(outputPath);
    });
    await then("the bundle reports one topic with prior units", () => {
      expect(bundle?.topic_count).toBe(1);
      expect(bundle?.topics_with_prior_units).toBe(1);
    });
    await and("the bundle markdown carries the topic id header", () => {
      expect(bundle?.markdown).toContain("topic_id: auth");
    });
  });

  test("prepareReviewBundle returns zero topics-with-prior-units when no prior data exists", async () => {
    let bundle: Awaited<
      ReturnType<typeof ctx.conversations.prepareReviewBundle>
    > | null = null;
    let outputPath = "";

    await given("a fresh output for a brand-new topic with no graph history", () => {
      const workingDir = makeWorkingDir(ctx.projectDir, "conv-new");
      outputPath = join(workingDir, "output.json");
      writeFileSync(outputPath, JSON.stringify(validOutput()));
    });
    await when("preparing the review bundle", async () => {
      bundle = await ctx.conversations.prepareReviewBundle(outputPath);
    });
    await then("the bundle reports the topic with no priors", () => {
      expect(bundle?.topic_count).toBe(1);
      expect(bundle?.topics_with_prior_units).toBe(0);
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
  overrides: Partial<Conversation> = {},
): Conversation {
  return ConversationSchema.parse({
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

function decisionFile(overrides: Partial<DecisionFileNew> = {}): DecisionFileNew {
  return DecisionFileNewSchema.parse({
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
  file: TopicFileNew,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "topics"), { recursive: true });
  const path = topicJsonPath(ctx.projectDir, file.id, file.title);
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.topics.indexFile(path);
}

async function indexConversation(
  ctx: KnowledgeNewTestContext,
  file: Conversation,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "conversations"), { recursive: true });
  const path = conversationJsonPath(
    ctx.projectDir,
    file.conversation_id,
    file.main_topic,
  );
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.conversations.indexFile(path);
}

async function indexDecision(
  ctx: KnowledgeNewTestContext,
  file: DecisionFileNew,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "decisions"), { recursive: true });
  const path = decisionJsonPath(ctx.projectDir, file.id, file.title);
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.decisions.indexFile(path);
}

function makeWorkingDir(projectDir: string, conversationId: string): string {
  const dir = join(projectDir, "working", conversationId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface ValidOutputOpts {
  conversationId?: string;
  topicId?: string;
  isExistingTopic?: boolean;
}

function validOutput(opts: ValidOutputOpts = {}): unknown {
  const conversationId = opts.conversationId ?? "conv-1";
  const topicId = opts.topicId ?? "topic-1";
  const isNew = !(opts.isExistingTopic ?? false);
  return {
    conversation: {
      conversation_id: conversationId,
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
      topics: [
        {
          id: topicId,
          parent_id: null,
          is_new: isNew,
          title: "Auth",
          short_summary: "S",
          long_summary: "L",
          reviewed: true,
          decisions_extracted: true,
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: conversationId,
              turn_index: 0,
              idea_unit_index: 0,
            },
          ],
          decisions: [],
        },
      ],
    },
  };
}

function unassignedIdeaUnitOutput(): unknown {
  return {
    conversation: {
      conversation_id: "conv-1",
      time: "2026-01-01T10:00:00Z",
      main_topic: "Project kickoff",
      turns: [
        {
          index: 0,
          speaker: "Alice",
          time: "2026-01-01T10:00:00Z",
          idea_units: [
            { index: 0, sentences: ["Useful."], categories: ["Information"] },
            { index: 1, sentences: ["Also useful."], categories: ["Information"] },
          ],
        },
      ],
      topics: [
        {
          id: "topic-1",
          parent_id: null,
          is_new: true,
          title: "Auth",
          short_summary: "S",
          long_summary: "L",
          reviewed: true,
          decisions_extracted: true,
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: "conv-1",
              turn_index: 0,
              idea_unit_index: 0,
            },
          ],
          decisions: [],
        },
      ],
    },
  };
}
