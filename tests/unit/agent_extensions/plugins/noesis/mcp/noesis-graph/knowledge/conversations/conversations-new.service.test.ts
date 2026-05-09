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
} from "@tests/helpers/knowledge-new-test-context.js";
import {
  ConversationFileNewSchema,
  DecisionFileNewSchema,
  TopicFileNewSchema,
} from "@noesis/shared-contracts/source-file-schemas-new.js";
import {
  conversationJsonPath,
  decisionJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("ConversationsServiceNew — accept skill output, validate, split, save", () => {
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

  test("Merging an analyze-conversation output writes the conversation, topics and decisions to canonical paths", async () => {
    let result: { conversation_id: string; topic_paths: string[]; decision_paths: string[] } | null = null;

    await given("an analyze-conversation working dir with valid output and cleaned md", () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput(),
        "# Authentication\n\nalice: We should use JWTs.\n",
      );
    });
    await when("the skill output and cleaned transcript are merged", async () => {
      result = await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
    });
    await then("the conversation file lands at noesis/conversations/<id>.json", () => {
      const conversationPath = conversationJsonPath(ctx.projectDir, "conv-1");
      const conversation = ConversationFileNewSchema.parse(
        JSON.parse(readFileSync(conversationPath, "utf-8")),
      );
      expect(conversation.conversation_id).toBe("conv-1");
      expect(conversation.turns).toHaveLength(1);
    });
    await and("the topic file lands at noesis/topics/<id>.json with parent_id null and source sha set", () => {
      const topicPath = topicJsonPath(ctx.projectDir, "topic-1");
      const topic = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(topicPath, "utf-8")),
      );
      expect(topic.parent_id).toBeNull();
      expect(topic.title_locked).toBe(false);
      expect(topic.items).toHaveLength(1);
      expect(topic.items[0].source_sha).toBeDefined();
    });
    await and("the decision file lands at noesis/decisions/<id>.json with source sha set on each reference", () => {
      const decisionPath = decisionJsonPath(ctx.projectDir, "decision-1");
      const decision = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(decisionPath, "utf-8")),
      );
      expect(decision.title).toBe("Adopt JWT");
      expect(decision.referenced_items[0].source_sha).toBeDefined();
    });
    await and("the result enumerates the produced canonical paths", () => {
      expect(result?.topic_paths).toHaveLength(1);
      expect(result?.decision_paths).toHaveLength(1);
    });
  });

  test("Merging an analyze-conversation output containing an unreviewed topic is rejected", async () => {
    let thrown: Error | null = null;

    await given("a working dir whose topic has not been reviewed", () => {
      const output = makeSkillOutput() as { conversation: { topics: { reviewed: boolean }[] } };
      output.conversation.topics[0].reviewed = false;
      writeWorkingDirFiles(workingDir, output, "# any");
    });
    await when("the skill output is merged", async () => {
      try {
        await ctx.conversations.merge({
          outputJsonPath: join(workingDir, "output.json"),
          cleanedMdPath: join(workingDir, "cleaned.md"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the merge is rejected before any file is written, with a clear message about the review pass", () => {
      expect(thrown?.message).toContain("reviewed");
    });
  });

  test("Merging preserves a user-locked topic title across skill re-runs", async () => {
    await given("a topic written by an earlier merge whose title was then edited by the user", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput(),
        "# any\n",
      );
      await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
      await ctx.topics.editFieldsAndLock(
        "topic-1",
        { title: "User-set title" },
        false,
      );
    });
    await when("the skill produces a different title and the conversation is merged again", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({ topicTitle: "Skill-proposed title" }),
        "# any\n",
      );
      await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
    });
    await then("the on-disk topic title remains the user-set value, not the skill's", () => {
      const topicPath = topicJsonPath(ctx.projectDir, "topic-1");
      const topic = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(topicPath, "utf-8")),
      );
      expect(topic.title).toBe("User-set title");
      expect(topic.title_locked).toBe(true);
    });
  });

  test("Indexing a conversation file projects it into Conversation, Turn and IdeaUnit nodes", async () => {
    let path = "";

    await given("a merged conversation on disk", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput(),
        "# any\n",
      );
      await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
      path = conversationJsonPath(ctx.projectDir, "conv-1");
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
        "MATCH (c:Conversation)-[:CONVERSATION_HAS_TURN]->(t:Turn) WHERE c.id = $cid " +
          "RETURN t.id AS id, t.conversation_id AS conversation_id, t.turn_index AS turn_index, " +
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
        "MATCH (t:Turn)-[:TURN_HAS_IDEA_UNIT]->(u:IdeaUnit) WHERE u.conversation_id = $cid " +
          "RETURN u.id AS id, u.conversation_id AS conversation_id, u.turn_index AS turn_index, " +
          "u.idea_unit_index AS idea_unit_index, u.sentences AS sentences, u.categories AS categories " +
          "ORDER BY u.turn_index, u.idea_unit_index",
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

  test("Deleting a conversation by its canonical file path removes the corresponding row from DB", async () => {
    let path = "";

    await given("a merged and indexed conversation on disk", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput(),
        "# any\n",
      );
      await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
      path = conversationJsonPath(ctx.projectDir, "conv-1");
      await ctx.conversations.indexFile(path);
    });
    await when("deletion is requested for the conversation's canonical path", async () => {
      const result = await ctx.conversations.deleteForFile(path);
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
          title: b.topicTitle ?? "JWT decision",
          short_summary: "Authentication choice.",
          long_summary: "We chose JWTs for stateless authentication.",
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
              title: "Adopt JWT",
              status: "accepted",
              referenced_items: [
                {
                  type: "idea_unit_ref",
                  conversation_id: conversationId,
                  turn_index: 0,
                  idea_unit_index: 0,
                },
              ],
              context: {
                text: "Need stateless auth.",
                supporting_item_indices: [0],
              },
              decision: {
                text: "Use JWT.",
                rationale: "Standard.",
                supporting_item_indices: [0],
              },
              alternative_options: [],
            },
          ],
          reviewed: true,
          decisions_extracted: true,
        },
      ],
    },
    potential_topics: {
      topics: [
        {
          id: topicId,
          title: b.topicTitle ?? "JWT decision",
          short_summary: "Authentication choice.",
          path: ["JWT decision"],
          is_new: true,
          parent_id: null,
        },
      ],
    },
  };
}

function writeWorkingDirFiles(
  workingDir: string,
  output: unknown,
  cleanedMd: string,
): { outputJsonPath: string; cleanedMdPath: string } {
  mkdirSync(workingDir, { recursive: true });
  const outputJsonPath = join(workingDir, "output.json");
  const cleanedMdPath = join(workingDir, "cleaned.md");
  writeFileSync(outputJsonPath, JSON.stringify(output, null, 2));
  writeFileSync(cleanedMdPath, cleanedMd);
  return { outputJsonPath, cleanedMdPath };
}
