import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import { ConversationSchema } from "@noesis/shared-contracts/conversation.js";
import { DecisionFileSchema } from "@noesis/shared-contracts/decision.js";
import { TopicFileSchema } from "@noesis/shared-contracts/topic.js";
import { LockedFieldsBlockedError } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations.service.js";
import {
  conversationJsonPath,
  decisionJsonPath,
  findDecisionJsonById,
  findTopicJsonById,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("ConversationsService — accept skill output, validate, split, save", () => {
  let ctx: KnowledgeNewTestContext;
  let workingDir: string;

  beforeAll(async () => {
    ctx = await createKnowledgeNewTestModule();
    workingDir = join(ctx.projectDir, "working");
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

  test("Uploading an analyze-conversation output writes the conversation, topics and decisions files to canonical paths", async () => {
    let result: { conversation_id: string; topic_paths: string[]; decision_paths: string[] } | null = null;

    await given("an analyze-conversation working dir with valid output proposing a JWT topic and decision, and a cleaned md", () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({
          topicTitle: "JWT decision",
          decisionTitle: "Adopt JWT",
        }),
        "# Authentication\n\nalice: We should use JWTs.\n",
      );
    });
    await when("the skill output is uploaded", async () => {
      result = await ctx.conversations.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
      });
    });
    await then("the conversation file lands at the slug-prefixed canonical path", () => {
      const conversationPath = conversationJsonPath(
        ctx.projectDir,
        "conv-1",
        "Authentication strategy",
      );
      const conversation = ConversationSchema.parse(
        JSON.parse(readFileSync(conversationPath, "utf-8")),
      );
      expect(conversation.conversation_id).toBe("conv-1");
      expect(conversation.turns).toHaveLength(1);
    });
    await and("the topic file lands at the slug-prefixed canonical path with source sha set", () => {
      const topic = readTopic(ctx, "topic-1");
      expect(topic.parent_id).toBeNull();
      expect(topic.title_locked).toBe(false);
      expect(topic.items.length).toBeGreaterThan(0);
      for (const item of topic.items) {
        expect(item.source_sha).toBeDefined();
      }
    });
    await and("the decision file lands at the slug-prefixed canonical path with source sha set on each reference", () => {
      const decision = readDecision(ctx, "decision-1");
      expect(decision.title).toBe("Adopt JWT");
      const refs = [
        ...decision.context.supporting_content,
        ...decision.decision.supporting_content,
        ...decision.alternative_options.flatMap((a) => a.supporting_content),
      ];
      expect(refs.length).toBeGreaterThan(0);
      for (const item of refs) {
        expect(item.source_sha).toBeDefined();
      }
    });
    await and("the result enumerates the produced canonical paths", () => {
      expect(result?.topic_paths).toEqual([
        topicJsonPath(ctx.projectDir, "topic-1", "JWT decision"),
      ]);
      expect(result?.decision_paths).toEqual([
        decisionJsonPath(ctx.projectDir, "decision-1", "Adopt JWT"),
      ]);
    });
  });

  test("Uploading an analyze-conversation output containing an unreviewed topic is rejected", async () => {
    let thrown: Error | null = null;

    await given("a working dir whose topic has not been reviewed", () => {
      const output = makeSkillOutput() as { conversation: { topics: { reviewed: boolean }[] } };
      output.conversation.topics[0].reviewed = false;
      writeWorkingDirFiles(workingDir, output, "# any");
    });
    await when("the skill output is uploaded", async () => {
      try {
        await ctx.conversations.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the upload is rejected before any file is written, with a clear message about the review pass", () => {
      expect(thrown?.message).toContain("reviewed");
    });
  });

  test("Uploading without confirmation rejects with the list of topic locked fields whose value would change", async () => {
    let thrown: Error | null = null;

    await given("a topic on disk with a locked title and locked short_summary", () => {
      seedTopicFile(ctx, {
        title: "User-set title",
        title_locked: true,
        short_summary: "User-set summary",
        short_summary_locked: true,
      });
    });
    await when("the skill output proposing different title and short_summary is uploaded with no confirmed_edits", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({
          topicTitle: "Skill-proposed title",
          topicShortSummary: "Skill-proposed summary",
        }),
        "# any\n",
      );
      try {
        await ctx.conversations.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the upload is rejected with a LockedFieldsBlockedError listing every locked field that would have changed", () => {
      expect(thrown).toBeInstanceOf(LockedFieldsBlockedError);
      const blocked = (thrown as LockedFieldsBlockedError).blocked;
      expect(blocked).toEqual([
        { kind: "topic", topic_id: "topic-1", field: "title" },
        { kind: "topic", topic_id: "topic-1", field: "short_summary" },
      ]);
    });
    await and("the on-disk topic file is left exactly as it was before the upload", () => {
      const topic = readTopic(ctx, "topic-1");
      expect(topic.title).toBe("User-set title");
      expect(topic.title_locked).toBe(true);
      expect(topic.short_summary).toBe("User-set summary");
      expect(topic.short_summary_locked).toBe(true);
    });
  });

  test("Uploading without confirmation succeeds when locked field values match the skill output exactly", async () => {
    await given("a topic on disk whose locked title matches the title the skill is about to upload", () => {
      seedTopicFile(ctx, {
        title: "JWT decision",
        title_locked: true,
      });
    });
    await when("the skill output is uploaded with no confirmed_edits", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({ topicTitle: "JWT decision" }),
        "# any\n",
      );
      await ctx.conversations.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
      });
    });
    await then("the on-disk topic file keeps the title locked at the same value", () => {
      const topic = readTopic(ctx, "topic-1");
      expect(topic.title).toBe("JWT decision");
      expect(topic.title_locked).toBe(true);
    });
  });

  test("Uploading with confirmed_edits for a locked topic field overwrites the value and clears the lock", async () => {
    let result: { cleared_locks: unknown[] } | null = null;

    await given("a topic on disk with a locked title differing from the skill output", () => {
      seedTopicFile(ctx, {
        title: "User-set title",
        title_locked: true,
      });
    });
    await when("the skill re-uploads with confirmed_edits for the topic title", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({ topicTitle: "Skill-proposed title" }),
        "# any\n",
      );
      result = await ctx.conversations.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        confirmed_edits: [
          { kind: "topic", topic_id: "topic-1", field: "title" },
        ],
      });
    });
    await then("the topic title is replaced with the skill's value and the lock is cleared", () => {
      const topic = readTopic(ctx, "topic-1");
      expect(topic.title).toBe("Skill-proposed title");
      expect(topic.title_locked).toBe(false);
    });
    await and("the result reports the cleared lock", () => {
      expect(result?.cleared_locks).toEqual([
        { kind: "topic", topic_id: "topic-1", field: "title" },
      ]);
    });
  });

  test("Uploading with partial confirmed_edits applies confirmed edits and preserves unconfirmed locked fields", async () => {
    await given("a topic on disk whose title and short_summary are both locked", () => {
      seedTopicFile(ctx, {
        title: "User-set title",
        title_locked: true,
        short_summary: "User-set summary",
        short_summary_locked: true,
      });
    });
    await when("the skill re-uploads with different title and short_summary, confirming only the title edit", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({
          topicTitle: "Skill-proposed title",
          topicShortSummary: "Skill-proposed summary",
        }),
        "# any\n",
      );
      await ctx.conversations.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        confirmed_edits: [
          { kind: "topic", topic_id: "topic-1", field: "title" },
        ],
      });
    });
    await then("the title takes the new value with its lock cleared", () => {
      const topic = readTopic(ctx, "topic-1");
      expect(topic.title).toBe("Skill-proposed title");
      expect(topic.title_locked).toBe(false);
    });
    await and("the unconfirmed short_summary keeps its user-set value with the lock still set", () => {
      const topic = readTopic(ctx, "topic-1");
      expect(topic.short_summary).toBe("User-set summary");
      expect(topic.short_summary_locked).toBe(true);
    });
  });

  test("Uploading without confirmation rejects when a locked decision field would change", async () => {
    let thrown: Error | null = null;

    await given("a decision with a locked decision.text", () => {
      seedDecisionFile(ctx, {
        decision: {
          text: "User-set decision text",
          text_locked: true,
          rationale: "Standard.",
          supporting_content: [],
        },
      });
    });
    await when("the skill output proposing a different decision.text is uploaded with no confirmed_edits", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({ decisionText: "Skill-proposed decision text" }),
        "# any\n",
      );
      try {
        await ctx.conversations.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the upload is rejected with a LockedFieldsBlockedError pointing at the decision field", () => {
      expect(thrown).toBeInstanceOf(LockedFieldsBlockedError);
      const blocked = (thrown as LockedFieldsBlockedError).blocked;
      expect(blocked).toEqual([
        { kind: "decision", decision_id: "decision-1", field: "decision.text" },
      ]);
    });
  });

  test("Uploading with confirmed_edits for a locked decision field overwrites the value and clears the lock", async () => {
    await given("a decision with a locked decision text differing from the skill output", () => {
      seedDecisionFile(ctx, {
        decision: {
          text: "User-set decision text",
          text_locked: true,
          rationale: "Standard.",
          supporting_content: [],
        },
      });
    });
    await when("the skill re-uploads with a different decision.text and confirms the edit", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({ decisionText: "Skill-proposed decision text" }),
        "# any\n",
      );
      await ctx.conversations.uploadAnalysis({
        outputJsonPath: join(workingDir, "output.json"),
        confirmed_edits: [
          { kind: "decision", decision_id: "decision-1", field: "decision.text" },
        ],
      });
    });
    await then("the decision text takes the skill's value with its lock cleared", () => {
      const decision = readDecision(ctx, "decision-1");
      expect(decision.decision.text).toBe("Skill-proposed decision text");
      expect(decision.decision.text_locked).toBe(false);
    });
  });

  test("Uploading without confirmation lists conflicts across both topics and decisions in one error", async () => {
    let thrown: Error | null = null;

    await given("a topic with a locked title and a decision with a locked rationale", () => {
      seedTopicFile(ctx, {
        title: "User-set title",
        title_locked: true,
      });
      seedDecisionFile(ctx, {
        decision: {
          text: "Use JWT.",
          rationale: "User-set rationale",
          rationale_locked: true,
          supporting_content: [],
        },
      });
    });
    await when("the skill output proposing different topic.title and decision.rationale is uploaded with no confirmed_edits", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({
          topicTitle: "Skill-proposed title",
          decisionRationale: "Skill-proposed rationale",
        }),
        "# any\n",
      );
      try {
        await ctx.conversations.uploadAnalysis({
          outputJsonPath: join(workingDir, "output.json"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the LockedFieldsBlockedError lists both the topic and the decision conflict", () => {
      expect(thrown).toBeInstanceOf(LockedFieldsBlockedError);
      const blocked = (thrown as LockedFieldsBlockedError).blocked;
      expect(blocked).toEqual([
        { kind: "topic", topic_id: "topic-1", field: "title" },
        { kind: "decision", decision_id: "decision-1", field: "decision.rationale" },
      ]);
    });
  });

  test("Indexing a conversation file projects it into Conversation, SpeakerTurn and IdeaUnit nodes", async () => {
    let path = "";

    await given("a structured conversation file on disk that has not yet been indexed", () => {
      path = conversationJsonPath(ctx.projectDir, "conv-1", "Authentication strategy");
      ctx.conversationsRepository.writeJsonFile(path, sampleConversationFile());
    });
    await when("indexing the conversation file", async () => {
      const outcome = await ctx.conversations.indexFile(path);
      expect(outcome.status).toBe("indexed");
    });
    await then("the persisted Conversation carries the file's time and main topic", async () => {
      const stored = await ctx.conversationsRepository.read("conv-1");
      expect(stored?.id).toBe("conv-1");
      expect(stored?.time).toBe("2026-04-17T10:00:00Z");
      expect(stored?.main_topic).toBe("Authentication strategy");
    });
    await and("the persisted Turn rows mirror the file's turn list (speaker, index, time)", async () => {
      const turns = await ctx.db.query<{
        id: string;
        conversation_id: string;
        turn_index: number | bigint;
        speaker: string;
        time: string;
      }>(
        "MATCH (c:Conversation)-[:CONVERSATION_HAS_SPEAKER_TURN]->(t:SpeakerTurn) WHERE c.id = $cid " +
          "RETURN t.id AS id, c.id AS conversation_id, t.turn_index AS turn_index, " +
          "t.speaker AS speaker, t.time AS time ORDER BY t.turn_index",
        { cid: "conv-1" },
      );
      expect(turns.map((t) => ({ ...t, turn_index: Number(t.turn_index) }))).toEqual([
        {
          id: "conv-1|T0",
          conversation_id: "conv-1",
          turn_index: 0,
          speaker: "alice",
          time: "2026-04-17T10:00:00Z",
        },
      ]);
    });
    await and("the persisted IdeaUnit rows mirror the file's idea units (sentences, categories)", async () => {
      const ideaUnits = await ctx.db.query<{
        id: string;
        conversation_id: string;
        turn_index: number | bigint;
        idea_unit_index: number | bigint;
        sentences: string[];
        categories: string[];
      }>(
        "MATCH (c:Conversation)-[:CONVERSATION_HAS_SPEAKER_TURN]->(t:SpeakerTurn)-[:SPEAKER_TURN_HAS_IDEA_UNIT]->(u:IdeaUnit) " +
          "WHERE c.id = $cid " +
          "RETURN u.id AS id, c.id AS conversation_id, t.turn_index AS turn_index, " +
          "u.idea_unit_index AS idea_unit_index, u.sentences AS sentences, u.categories AS categories " +
          "ORDER BY t.turn_index, u.idea_unit_index",
        { cid: "conv-1" },
      );
      expect(
        ideaUnits.map((u) => ({
          ...u,
          turn_index: Number(u.turn_index),
          idea_unit_index: Number(u.idea_unit_index),
        })),
      ).toEqual([
        {
          id: "conv-1|T0|IU0",
          conversation_id: "conv-1",
          turn_index: 0,
          idea_unit_index: 0,
          sentences: ["We should use JWTs."],
          categories: ["Position"],
        },
        {
          id: "conv-1|T0|IU1",
          conversation_id: "conv-1",
          turn_index: 0,
          idea_unit_index: 1,
          sentences: ["Stateless and standard."],
          categories: ["Argument"],
        },
      ]);
    });
  });

  test("Deleting a conversation while its structured conversation file is still on disk removes both the DB row and the file", async () => {
    let jsonPath = "";

    await given("an indexed conversation whose structured conversation file lives on disk", async () => {
      jsonPath = conversationJsonPath(ctx.projectDir, "conv-1", "Authentication strategy");
      ctx.conversationsRepository.writeJsonFile(jsonPath, sampleConversationFile());
      await ctx.conversations.indexFile(jsonPath);
    });
    await when("deletion is requested for the conversation's canonical path", async () => {
      const result = await ctx.conversations.deleteForFile(jsonPath);
      expect(result?.conversation_id).toBe("conv-1");
    });
    await then("the conversation no longer exists in DB", async () => {
      expect(await ctx.conversationsRepository.exists("conv-1")).toBe(false);
    });
    await and("the structured conversation file is removed from disk", () => {
      expect(existsSync(jsonPath)).toBe(false);
    });
  });

  test("Deleting a conversation whose structured conversation file is already gone still removes the DB row", async () => {
    let jsonPath = "";

    await given("an indexed conversation whose structured conversation file has been removed from disk", async () => {
      jsonPath = conversationJsonPath(ctx.projectDir, "conv-1", "Authentication strategy");
      ctx.conversationsRepository.writeJsonFile(jsonPath, sampleConversationFile());
      await ctx.conversations.indexFile(jsonPath);
      rmSync(jsonPath, { force: true });
    });
    await when("deletion is requested for the conversation's canonical path", async () => {
      const result = await ctx.conversations.deleteForFile(jsonPath);
      expect(result?.conversation_id).toBe("conv-1");
    });
    await then("the conversation no longer exists in DB", async () => {
      expect(await ctx.conversationsRepository.exists("conv-1")).toBe(false);
    });
  });
});

interface SkillOutputBuilder {
  conversationId?: string;
  topicId?: string;
  decisionId?: string;
  decisionTitleLocked?: boolean;
  topicTitleLocked?: boolean;
  topicTitle?: string;
  topicShortSummary?: string;
  topicLongSummary?: string;
  decisionTitle?: string;
  decisionStatus?: "accepted" | "proposed";
  decisionContextText?: string;
  decisionText?: string;
  decisionRationale?: string;
}

function makeSkillOutput(b: SkillOutputBuilder = {}): unknown {
  const conversationId = b.conversationId ?? "conv-1";
  const topicId = b.topicId ?? "topic-1";
  const decisionId = b.decisionId ?? "decision-1";
  return {
    conversation: {
      conversation_id: conversationId,
      time: "2026-04-17T10:00:00Z",
      main_topic: "Authentication strategy",
      turns: [
        {
          index: 0,
          speaker: "alice",
          time: "2026-04-17T10:00:00Z",
          idea_units: [
            {
              index: 0,
              sentences: ["We should use JWTs."],
              categories: ["Position"],
            },
            {
              index: 1,
              sentences: ["Stateless and standard."],
              categories: ["Argument"],
            },
          ],
        },
      ],
      topics: [
        {
          id: topicId,
          parent_id: null,
          is_new: true,
          title: b.topicTitle ?? "JWT decision",
          short_summary: b.topicShortSummary ?? "Authentication choice.",
          long_summary:
            b.topicLongSummary ?? "We chose JWTs for stateless authentication.",
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: conversationId,
              turn_index: 0,
              idea_unit_index: 0,
            },
          ],
          decisions: [
            {
              id: decisionId,
              title: b.decisionTitle ?? "Adopt JWT",
              status: b.decisionStatus ?? "accepted",
              context: {
                text: b.decisionContextText ?? "Need stateless auth.",
                supporting_content: [
                  {
                    type: "idea_unit_ref",
                    conversation_id: conversationId,
                    turn_index: 0,
                    idea_unit_index: 0,
                  },
                ],
              },
              decision: {
                text: b.decisionText ?? "Use JWT.",
                rationale: b.decisionRationale ?? "Standard.",
                supporting_content: [
                  {
                    type: "idea_unit_ref",
                    conversation_id: conversationId,
                    turn_index: 0,
                    idea_unit_index: 0,
                  },
                ],
              },
              alternative_options: [],
            },
          ],
          reviewed: true,
          decisions_extracted: true,
        },
      ],
    },
  };
}

function seedTopicFile(
  ctx: KnowledgeNewTestContext,
  overrides: Record<string, unknown>,
): void {
  const file = TopicFileSchema.parse({
    id: "topic-1",
    title: "JWT decision",
    short_summary: "Authentication choice.",
    long_summary: "We chose JWTs for stateless authentication.",
    items: [],
    reviewed: true,
    decisions_extracted: true,
    ...overrides,
  });
  ctx.topicsRepository.writeFile(
    topicJsonPath(ctx.projectDir, file.id, file.title),
    file,
  );
}

function seedDecisionFile(
  ctx: KnowledgeNewTestContext,
  overrides: Record<string, unknown>,
): void {
  const file = DecisionFileSchema.parse({
    id: "decision-1",
    topic_id: "topic-1",
    title: "Adopt JWT",
    status: "accepted",
    context: {
      text: "Need stateless auth.",
      supporting_content: [],
    },
    decision: {
      text: "Use JWT.",
      rationale: "Standard.",
      supporting_content: [],
    },
    alternative_options: [],
    ...overrides,
  });
  ctx.decisionsRepository.writeFile(
    decisionJsonPath(ctx.projectDir, file.id, file.title),
    file,
  );
}

function readTopic(ctx: KnowledgeNewTestContext, id: string) {
  const path = findTopicJsonById(ctx.projectDir, id);
  if (path === null) throw new Error(`Topic not found on disk: ${id}`);
  return TopicFileSchema.parse(
    JSON.parse(readFileSync(path, "utf-8")),
  );
}

function readDecision(ctx: KnowledgeNewTestContext, id: string) {
  const path = findDecisionJsonById(ctx.projectDir, id);
  if (path === null) throw new Error(`Decision not found on disk: ${id}`);
  return DecisionFileSchema.parse(
    JSON.parse(readFileSync(path, "utf-8")),
  );
}

function sampleConversationFile() {
  return ConversationSchema.parse({
    conversation_id: "conv-1",
    time: "2026-04-17T10:00:00Z",
    main_topic: "Authentication strategy",
    turns: [
      {
        index: 0,
        speaker: "alice",
        time: "2026-04-17T10:00:00Z",
        idea_units: [
          {
            index: 0,
            sentences: ["We should use JWTs."],
            categories: ["Position"],
          },
          {
            index: 1,
            sentences: ["Stateless and standard."],
            categories: ["Argument"],
          },
        ],
      },
    ],
  });
}

function writeWorkingDirFiles(
  workingDir: string,
  output: unknown,
  _cleanedMd: string,
): { outputJsonPath: string } {
  mkdirSync(workingDir, { recursive: true });
  const outputJsonPath = join(workingDir, "output.json");
  writeFileSync(outputJsonPath, JSON.stringify(output, null, 2));
  return { outputJsonPath };
}
